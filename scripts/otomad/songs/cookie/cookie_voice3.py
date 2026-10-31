"""クッキー☆ 複数の姉貴版。cand_7（2号兄貴・ハ短調・140BPM）に掛け合いで載せる（使い捨て）。

フックは HNS姉貴の「神社閉店の日！」を2小節ごとに繰り返し、合いの手の「クォラ！」を姉貴を替えて入れる。
python -I cookie_voice3.py <cand.json> <acc.wav> <outdir>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402

import cookie_select as CS  # noqa: E402
import cookie_v2 as C  # noqa: E402
import inmu_v3 as V  # noqa: E402
import kaisen_voice as KV  # noqa: E402

K = KV.K
song = json.load(open(sys.argv[1], encoding="utf-8"))
V.SECTIONS = [("all", [(K(c), 1) for c in C.ALL])]
KV.LOOP_KEYS = set()
KV.NO_DELAY = True
KV.HARMONY_TRACKS = tuple(t for t, ns in song["tracks"].items()
                          if t not in CS.LEAD and np.median([x["midi"] for x in ns]) < 80)
ANSWERS = [C.KUORA_RU, C.KUORA_BNK, C.KUORA_HNS, C.KUORA_RU]


def hook(bar0, bar1):
    return [(b, b + 1, [(K(C.JINJA_HNS), 1), (K(ANSWERS[i % 4]), 1)]) for i, b in enumerate(range(bar0, bar1, 2))]


KV.PLAN = [
    (1, 16, [(K(c), 1) for c in (C.TITLE, C.PUHA, C.TENKI, C.KYUKEI, C.BROWNIE)]),
    *hook(17, 33),
    (33, 48, [(K(c), 1) for c in (C.IKASUMI, C.TABE_HNS, C.TABE_RU, C.TABE_YMN, C.WASURE_MZ, C.WASURE_RU,
                                   C.KASHIKO_RU, C.KASHIKO_JOKER)]),
    *hook(49, 65),
    (65, 68, [(K(C.SARABA), 1)]),
]

if __name__ == "__main__":
    KV.main()
