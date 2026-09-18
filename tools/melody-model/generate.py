"""学習したモデルで旋律を生成し、フレーズバンクとして書き出す。

    python tools/melody-model/generate.py --model tmp/melody-model.pt \
        --out src/compose-melodies.ts --n 2000

## なぜ2小節のフレーズとして出すのか

モデルが学ぶのは任意長の旋律だが、書き出しは `src/compose-phrases.ts` と**同じ形**
（2小節の `rhythm` / `degrees`）にしてある。生成側の配線をそのまま使えるので、
「コーパスの実在フレーズ」と「モデルが作ったフレーズ」を差し替えて比べられる。

曲まるごとを素材にするのは次の段階。先に**同じ土俵で比較できる形**を作る。

## 選別について

ここで落とせるのは「形として壊れているもの」だけ（音数が足りない・音域が広すぎる・
跳躍が大きすぎる）。**キャッチーかどうかを判定する基準は持っていない**——17指標も
隣接音程のヒストグラムも、それを分けないことが実測で分かっている。
最終的な選別は耳でやる。それがこの方式のコストで、**1回払えば以後は効く**のが
実行時に毎回引き直すのとの違い。
"""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter
from pathlib import Path

import torch
import torch.nn.functional as F

import tokenizer as tk
from train import MelodyGPT

WINDOW = tk.STEPS_PER_BAR * 2


@torch.no_grad()
def sample(
    model: MelodyGPT, dev: str, length: int, temp: float, top_k: int
) -> list[int]:
    idx = torch.tensor([[tk.STOI[tk.BOS]]], device=dev)
    out: list[int] = []
    for _ in range(length):
        logits = model(idx[:, -model.ctx :])[:, -1, :] / max(1e-6, temp)
        if top_k > 0:
            v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
            logits[logits < v[:, [-1]]] = float("-inf")
        nxt = torch.multinomial(F.softmax(logits, dim=-1), 1)
        tok = int(nxt.item())
        if tok == tk.STOI[tk.EOS]:
            break
        out.append(tok)
        idx = torch.cat([idx, nxt], dim=1)
    return out


def to_phrases(notes: list[dict]) -> list[tuple[list[int], list[int]]]:
    """音の並び → 2小節フレーズ（`rhythm`, `degrees`）。

    採用の条件は `scripts/calibrate-phrases.ts` の `usable` と揃えてある。
    片方だけ緩いと、比較したときに「モデルのほうが多様」に見えるだけになる。
    """
    out: list[tuple[list[int], list[int]]] = []
    if not notes:
        return out
    last = max(n["at"] for n in notes)
    for w in range(0, last // WINDOW + 1):
        frm = w * WINDOW
        ns = sorted(
            (n for n in notes if frm <= n["at"] < frm + WINDOW), key=lambda n: n["at"]
        )
        if not (4 <= len(ns) <= 18):
            continue
        degs = [n["deg"] - ns[0]["deg"] for n in ns]
        if max(degs) - min(degs) > 12 or max(degs) == min(degs):
            continue
        if any(abs(degs[i] - degs[i - 1]) > 7 for i in range(1, len(degs))):
            continue

        rhythm: list[int] = []
        cursor = 0
        ok = True
        for i, n in enumerate(ns):
            at = n["at"] - frm
            if at < cursor:
                ok = False
                break
            if at > cursor:
                rhythm.append(-(at - cursor))
            nxt = ns[i + 1]["at"] - frm if i + 1 < len(ns) else WINDOW
            dur = max(1, min(n["dur"], nxt - at, WINDOW - at))
            rhythm.append(dur)
            cursor = at + dur
        if not ok:
            continue
        if cursor < WINDOW:
            rhythm.append(-(WINDOW - cursor))
        if sum(abs(v) for v in rhythm) != WINDOW:
            continue
        # 小節線で割れる形だけ（生成側のリズム型は1小節単位）。
        acc = 0
        if not any(
            (acc := acc + abs(v)) == tk.STEPS_PER_BAR for v in rhythm
        ):  # noqa: E501
            continue
        out.append((rhythm, degs))
    return out


Phrase = tuple[tuple[tuple[int, ...], tuple[int, ...]], int]


def pick_bank(phrases: list[Phrase], keep: int, seed: int) -> list[Phrase]:
    """候補から同梱するぶんだけ選ぶ。**`weight` に比例させた抽出**。

    **上位から切ると休符が落ちる。** 実測で、休符を含むフレーズの割合は
    人間のバンク 78% / 候補全体 62% に対し、**weight 上位801種では 42%** まで下がった。
    モデルが何度も出す形＝切れ目なく続く形なので、山の頂だけ残すと休みが消える。
    比例抽出なら 55% で、モデルが持っている分布の形のまま小さくできる。

    重み付きの非復元抽出（Efraimidis-Spirakis）。`random()**(1/w)` の大きい順に取ると
    weight に比例した標本になる。seed を渡せば同じ選抜を再現できる。
    """
    if keep >= len(phrases):
        return phrases
    rng = random.Random(seed)
    keyed = sorted(phrases, key=lambda kv: -(rng.random() ** (1.0 / kv[1])))
    return sorted(keyed[:keep], key=lambda kv: -kv[1])


HEADER = """/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   python tools/melody-model/generate.py --model <.pt> --out src/compose-melodies.ts
 *
 * 旋律の並び順を学習したモデルが作った**2小節フレーズ**のバンク。形は
 * {@link file://./compose-phrases.ts}（人間の曲から抜き出した実在フレーズ）と同じで、
 * 生成側の配線をそのまま使える。**同じ土俵で差し替えて比べるため**にそろえてある。
 *
 * `weight` は同じ形が何回出たか。モデルが繰り返し出す形＝学習した分布の山で、
 * コーパス側の出現回数と同じ意味で使える。
 *
 * **中身の品質はここでは保証しない。** 落としてあるのは「形として壊れているもの」
 * だけ（音数・音域・跳躍）で、キャッチーかどうかを判定する基準は存在しない
 * （17指標も隣接音程のヒストグラムもそれを分けないことが実測で分かっている）。
 * 最終的な選別は耳で行う。
 *
 * 生成元: __MODEL__ / 引いた本数 __TRIES__ / 同梱 __KEPT__ 種（候補 __FOUND__ 種から
 * `weight` に比例させて抽出。上位から切ると休符が落ちるため——`pick_bank` に実測値）
 */

import type { CorpusPhrase } from "./compose-phrases";

export const MODEL_PHRASES: CorpusPhrase[] = [
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="tmp/melody-model.pt")
    ap.add_argument("--out", default="src/compose-melodies.ts")
    ap.add_argument("--n", type=int, default=500, help="引く旋律の本数")
    ap.add_argument("--length", type=int, default=768, help="1本あたりのトークン数")
    ap.add_argument("--temp", type=float, default=1.0)
    ap.add_argument("--top-k", type=int, default=24)
    ap.add_argument("--seed", type=int, default=0)
    # **同梱する本数。** バンクはブラウザ向けの本体に入るので、行数がそのまま配布物の
    # 大きさになる（2000本引くと2万種・2.7MBで、人間側のバンクの24倍）。0 で全部。
    ap.add_argument("--keep", type=int, default=0)
    # **切らずに出す口。** 2小節へ刻んだ素材では人間の実在フレーズと区別がつかない
    # ことが A/B で分かった（`README.md` の手順4）。刻む前の旋律そのものを比べるには、
    # 引いた音符列をそのまま渡せる必要がある。JSONL で1行1本。
    ap.add_argument("--dump", default=None, help="旋律を刻まずに JSONL へ出す")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = MelodyGPT(len(tk.VOCAB), 512).to(dev)
    model.load_state_dict(torch.load(args.model, map_location=dev))
    model.eval()

    if args.dump:
        dump = Path(args.dump)
        dump.parent.mkdir(parents=True, exist_ok=True)
        with dump.open("w", encoding="utf-8") as f:
            for i in range(args.n):
                ids = sample(model, dev, args.length, args.temp, args.top_k)
                notes = tk.decode(ids)
                bars = max((n["at"] for n in notes), default=0) // tk.STEPS_PER_BAR + 1
                print(json.dumps({"notes": notes, "bars": bars}), file=f)
                print(f"  {i + 1}/{args.n} 本 … {len(notes)}音 / {bars}小節")
        print(f"● 刻まずに書き出した: {dump}")
        return

    found: Counter[tuple[tuple[int, ...], tuple[int, ...]]] = Counter()
    notes_seen = 0
    for i in range(args.n):
        ids = sample(model, dev, args.length, args.temp, args.top_k)
        notes = tk.decode(ids)
        notes_seen += len(notes)
        for rhythm, degs in to_phrases(notes):
            found[(tuple(rhythm), tuple(degs))] += 1
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{args.n} 本 … 採用 {len(found)} 種")

    phrases = sorted(found.items(), key=lambda kv: -kv[1])
    found_total = len(phrases)
    if args.keep > 0:
        phrases = pick_bank(phrases, args.keep, args.seed)
    body = "\n".join(
        f"\t{{ rhythm: [{', '.join(map(str, r))}], degrees: [{', '.join(map(str, d))}], weight: {w} }},"
        for (r, d), w in phrases
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        HEADER.replace("__MODEL__", args.model)
        .replace("__TRIES__", str(args.n))
        .replace("__KEPT__", str(len(phrases)))
        .replace("__FOUND__", str(found_total))
        + body
        + "\n];\n",
        encoding="utf-8",
    )
    print(f"● 書き出した: {out}")
    print(
        f"  {args.n}本から 音 {notes_seen} / フレーズ {found_total} 種"
        + (f" → {len(phrases)} 種を同梱" if args.keep > 0 else "")
    )


if __name__ == "__main__":
    main()
