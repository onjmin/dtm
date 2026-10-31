"""置いた音符で、語頭・アクセント句頭のモーラが拍のどこに来ているかを数える（使い捨て）。"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import pyopenjtalk  # noqa: E402

from compose_quotes3 import SECTIONS, load_clip  # noqa: E402


def heads(text):
    """モーラ番号 → 語頭か / アクセント句頭か。"""
    out, i = {}, 0
    for nd in pyopenjtalk.run_frontend(text):
        n = nd["mora_size"]
        if n <= 0:
            continue
        out[i] = "phrase" if nd["chain_flag"] != 1 else "word"
        i += n
    return out


cache, cnt = {}, {"phrase": Counter(), "word": Counter(), "all": Counter()}
lens = Counter()
seen = set()
for _, items in SECTIONS:
    for folder, num, text, keep, _rep in items:
        c = load_clip(cache, folder, num, text, keep)
        if c["text"] in seen or len(c["notes"]) < 3:
            continue
        seen.add(c["text"])
        h = heads(c["text"])
        for i, n in enumerate(c["notes"]):
            where = "拍頭" if n["pos"] % 4 == 0 else "8分裏" if n["pos"] % 2 == 0 else "16分"
            cnt["all"][where] += 1
            lens[n["len"]] += 1
            if i in h:
                cnt[h[i]][where] += 1
for k, c in cnt.items():
    tot = sum(c.values())
    print(f"{k:6s} n={tot:3d}  " + "  ".join(f"{w} {c[w] / tot:.2f}" for w in ("拍頭", "8分裏", "16分")))
print("長さ(16分の個数)", sorted(lens.items()))
