"""BB劇場の配役の点検: 台詞の話し手（音声のフォルダ・ファイル名）と、画面でしゃべる人物が同じかを見る。

python -I scripts/otomad/analysis/cast_check.py <voices.json か build.py> [...]
- voices.json: {"<人物>_<名前>": "<音声のパス>"}（bb33 以降の voice_paths.json の形）
- build.py: ("WHO", "名前"): <パス> の VOICE_MAP の行を読む
人物は OTOMAD_DOCS/research/cast-roster.tsv の code（別名 aliases も可）。
食い違い（別人の声）・名簿に無い人物・声まね／捏造の素材を出し、配役した人の本家の役と持ち役を並べる。
食い違いがあれば終了コード 1。わざと別人の声を当てるときは、その行を台帳に書いて --allow <キー> で通す。
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import paths  # noqa: E402  OTOMAD_DOCS の場所

ROSTER = paths.DOCS / "research" / "cast-roster.tsv"
# 本人でない声（声まね・吹き替え・作り物）。使うなら台帳に書く。
NOT_SELF = ["YTR", "声まね", "捏造", "合成", "AI音声"]


def load_roster():
    rows = {}
    lines = ROSTER.read_text(encoding="utf-8").splitlines()
    head = lines[0].split("\t")
    for line in lines[1:]:
        if not line.strip():
            continue
        r = dict(zip(head, line.split("\t")))
        r["aliases"] = [a for a in r["aliases"].split(",") if a]
        rows[r["code"]] = r
    return rows


def who_of(label, roster):
    for code, r in roster.items():
        if label.lower() == code.lower() or label.lower() in (a.lower() for a in r["aliases"]):
            return code
    return None


def hit(alias, path):
    if re.fullmatch(r"[A-Za-z]+", alias):
        return re.search(rf"(?<![A-Za-z]){re.escape(alias)}(?![A-Za-z])", path) is not None
    return alias in path


def speakers(path, roster):
    # 人物のフォルダ（一番深い一致）を話し手とする。ファイル名は頭の「X「…」」だけ見る
    # （「木村も今日疲れたろお？」「RIMにもう一回」のように台詞の中の名前は話し手ではない）。
    parts = [s.strip(' "\',)') for s in re.split(r"[\\/]", path)]
    found = []
    for i, seg in enumerate(parts):
        if i == len(parts) - 1:
            m = re.match(r"^[\d.\s]*([^「」]+?)「", seg)
            if not m:
                continue
            seg = m.group(1)
        for code, r in roster.items():
            if any(hit(a, seg) for a in r["aliases"]):
                found.append((i, code))
    if not found:
        return set()
    deepest = max(i for i, _ in found)
    return {c for i, c in found if i == deepest}


def read_entries(src):
    p = Path(src)
    if p.suffix == ".json":
        return [(k.split("_")[0], k, v) for k, v in json.loads(p.read_text(encoding="utf-8")).items()]
    text = p.read_text(encoding="utf-8")
    # V_X = ULT / "..." のような置き場の変数を、パスの式に戻して話し手を読めるようにする
    var = dict(re.findall(r'^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$', text, re.M))

    def expand(expr):
        for _ in range(3):
            expr = re.sub(r"\b([A-Z][A-Z0-9_]*)\b", lambda m: var.get(m.group(1), m.group(1)), expr)
        return expr

    out = []
    for n, line in enumerate(text.splitlines(), 1):
        m = re.search(r'\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)\s*:\s*(.+)', line)
        if m:
            out.append((m.group(1), f"{m.group(1)}_{m.group(2)}", expand(m.group(3))))
            continue
        m = re.search(r'\(\s*[\d.]+\s*,\s*"([^"]+)"\s*,\s*([A-Z][A-Z0-9_]*\s*/[^,]+)', line)
        if m:
            out.append((m.group(1), f"{m.group(1)}_L{n}", expand(m.group(2))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="+")
    ap.add_argument("--allow", action="append", default=[], help="わざと別人の声を当てるキー")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    roster = load_roster()
    bad = 0
    cast = set()
    for src in args.src:
        print(f"## {src}")
        for label, key, path in read_entries(src):
            if label.lower() in ("se", "bgm", "sfx"):
                continue
            who = who_of(label, roster)
            if who is None:
                print(f"  名簿に無い  {key}  （cast-roster.tsv に足す）")
                bad += 1
                continue
            cast.add(who)
            sp = speakers(path, roster)
            note = [w for w in NOT_SELF if w in path]
            if sp and who not in sp:
                tag = "許可" if key in args.allow else "別人の声"
                print(f"  {tag}  {key}: 画面は {who}、声は {'/'.join(sorted(sp))}  {path[-80:]}")
                bad += key not in args.allow
            elif not sp:
                print(f"  話し手不明  {key}  {path[-80:]}")
            if note:
                print(f"  本人でない？  {key}: {','.join(note)}  {path[-80:]}")
    print("## 配役した人の本家の役と持ち役（台帳の配役と照らす）")
    for c in sorted(cast):
        r = roster[c]
        print(f"  {c}: {r['本家の役']} ／ {r['界隈の持ち役・関係']}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
