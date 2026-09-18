"""旋律を「トークンの列」へ写す／戻す。

`scripts/export-dataset.ts` が出した JSONL（1行1曲・主旋律だけ）を読む。
書き出し側で意図的にトークン化していないのは、**何を1トークンにするかがモデルの
設計事項**だから。その決定はここに閉じ込める。

## 形

REMI 風。1音を3トークン（位置・音高・音価）で表す。

    BOS  BAR  POS_0 DEG_0 DUR_4  POS_4 DEG_2 DUR_2  BAR  ...  EOS

- `BAR`   … 小節線。絶対位置を持たせず、区切りの繰り返しで表す。曲の途中から
            切り出しても意味が保たれる（学習は固定長の窓で切るので効く）
- `POS_p` … 小節内の16分位置（0〜15）
- `DEG_d` … **主音からの音階度数**。7度＝1オクターブ。調に依存しないので、
            長調50曲・短調41曲を1つのモデルで扱える
- `DUR_u` … 音価（16分いくつぶん、1〜32）

音高を半音ではなく度数で持つのは、生成側（`src/compose.ts`）が音階の度数で
組み立てるのに合わせるため。半音で学ぶと、出てきた音を音階へ戻す段で崩れる。
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

STEPS_PER_BAR = 192
#: 16分音符のステップ数。コーパスはこの格子へ量子化済み。
GRID = STEPS_PER_BAR // 16
POSITIONS = 16
#: 音価の上限（16分いくつぶん）。32 = 2小節。これを超える音はコーパスにほぼ無い。
MAX_DUR = 32
#: 度数の範囲。7度＝1オクターブなので ±21 で上下3オクターブ。実データはこれより狭い。
MIN_DEG, MAX_DEG = -21, 21

BOS, EOS, BAR = "<bos>", "<eos>", "<bar>"


def build_vocab() -> list[str]:
    """語彙。順番を変えると学習済みモデルと食い違うので、足すときは末尾へ。"""
    vocab = [BOS, EOS, BAR]
    vocab += [f"POS_{p}" for p in range(POSITIONS)]
    vocab += [f"DEG_{d}" for d in range(MIN_DEG, MAX_DEG + 1)]
    vocab += [f"DUR_{u}" for u in range(1, MAX_DUR + 1)]
    return vocab


VOCAB = build_vocab()
STOI = {t: i for i, t in enumerate(VOCAB)}
ITOS = {i: t for t, i in STOI.items()}


@dataclass
class Song:
    source: str
    tonic: int
    minor: bool
    notes: list[dict]


def iter_songs(path: str | Path) -> Iterator[Song]:
    """1行ずつ読んで1曲ずつ返す。

    **全曲をメモリに載せない。** 事前学習のコーパス（PDMX 約20万曲）は JSONL で
    2GB近くあり、`list` に持つと音1つが dict のぶんだけ膨らんで数十GBになる。
    使う側（`train.py`）は1曲ごとにトークン化して捨てられるので、貯める理由がない。
    """
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            yield Song(d["source"], d["tonic"], d["minor"], d["notes"])



def octave_offset(song: Song) -> int:
    """その曲をどれだけ度数で下げれば ±21 の窓に収まるか（7の倍数）。

    `deg` は**主音からの絶対度数**で、主音は MIDI ノート番号の 0〜11 に置かれている。
    そのため実データの度数は 35〜37 のような大きい正の値になり、そのまま語彙へ
    入れると窓から溢れる（実測で音の86%が落ちた）。

    7の倍数でずらすのは、**度数の7剰余＝音階上の位置を保つため**。ドをドのまま、
    ミをミのまま下げる。曲がどのオクターブで歌われるかは音符列の性質ではなく
    声域の話で、そちらは生成側の {@link Register} が別に決める。
    """
    degs = sorted(n["deg"] for n in song.notes)
    if not degs:
        return 0
    median = degs[len(degs) // 2]
    return 7 * round(median / 7)


def encode(song: Song) -> list[int]:
    """1曲 → トークンID列。格子から外れた音・範囲外の音は落とす。"""
    out = [STOI[BOS]]
    bar = -1
    shift = octave_offset(song)
    for n in sorted(song.notes, key=lambda x: x["at"]):
        at = n["at"]
        deg = n["deg"] - shift
        if not (MIN_DEG <= deg <= MAX_DEG):
            continue
        dur = max(1, min(MAX_DUR, round(n["dur"] / GRID)))
        b, rem = divmod(at, STEPS_PER_BAR)
        pos = rem // GRID
        if pos >= POSITIONS:
            continue
        # 小節が飛んだぶんだけ BAR を積む。休みの小節も長さとして表現される。
        while bar < b:
            out.append(STOI[BAR])
            bar += 1
        out.append(STOI[f"POS_{pos}"])
        out.append(STOI[f"DEG_{deg}"])
        out.append(STOI[f"DUR_{dur}"])
    out.append(STOI[EOS])
    return out


def decode(ids: list[int]) -> list[dict]:
    """トークンID列 → 音の並び。壊れた並びは黙って読み飛ばす。

    生成物は文法を守るとは限らない（POS の次が DUR だったりする）ので、
    **3つ揃ったときだけ音にする**。捨てた数は呼び出し側で数えられるよう、
    戻り値の件数と入力の長さを比べれば分かる。
    """
    notes: list[dict] = []
    bar = -1
    pos: int | None = None
    deg: int | None = None
    for i in ids:
        t = ITOS.get(i)
        if t is None or t == BOS:
            continue
        if t == EOS:
            break
        if t == BAR:
            bar += 1
            pos = deg = None
        elif t.startswith("POS_"):
            pos, deg = int(t[4:]), None
        elif t.startswith("DEG_"):
            deg = int(t[4:]) if pos is not None else None
        elif t.startswith("DUR_"):
            if pos is None or deg is None or bar < 0:
                pos = deg = None
                continue
            notes.append(
                {
                    "at": bar * STEPS_PER_BAR + pos * GRID,
                    "dur": int(t[4:]) * GRID,
                    "deg": deg,
                }
            )
            pos = deg = None
    return notes


if __name__ == "__main__":
    import sys

    src = sys.argv[1] if len(sys.argv) > 1 else "tmp/dataset.jsonl"
    # 大きいコーパスでも検算できるよう、1曲ずつ読んで数えるだけにする。
    n_songs = 0
    total = 0
    kept = 0
    tokens = 0
    for s in iter_songs(src):
        ids = encode(s)
        n_songs += 1
        total += len(s.notes)
        kept += len(decode(ids))
        tokens += len(ids)
    print(f"語彙 {len(VOCAB)} 種")
    print(f"{n_songs}曲 / 音 {total} → 往復後 {kept} ({kept / total:.1%})")
    print(f"トークン総数 {tokens}")
