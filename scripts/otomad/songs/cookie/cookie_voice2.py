"""選んだ候補曲（cand_7）にクッキー☆の台詞を載せる（使い捨て）。区間と和音トラックは cookie_select と同じ決め方。

python -I cookie_voice2.py <cand.json> <acc.wav> <outdir>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402

import cookie_select as CS  # noqa: E402
import cookie_v1 as C  # noqa: E402
import inmu_v3 as V  # noqa: E402
import kaisen_voice as KV  # noqa: E402

K = KV.K
song = json.load(open(sys.argv[1], encoding="utf-8"))
V.SECTIONS = [("all", [(K(c), 1) for c in C.ALL if c not in (C.KYOMI, C.NAKUTO)])]
KV.LOOP_KEYS = set()
KV.NO_DELAY = True
KV.HARMONY_TRACKS = tuple(t for t, ns in song["tracks"].items()
                          if t not in CS.LEAD and np.median([x["midi"] for x in ns]) < 80)
_, secs, bars = CS.make_plan(song)
print("sections", secs, "harmony", KV.HARMONY_TRACKS)
# cand_7 の構成（Aメロ16・サビ16・Aメロ16・サビ16・Aメロ4）に合わせて手で割り振る
HOOK = CS.HOOK
KV.PLAN = [
    (1, 16, [(K(c), 1) for c in (C.OSS, C.YUKKURI, C.NOBITA, C.DANMAKU, C.SOONANOKA, C.JUDGE)]),
    *[(b, b + 3, HOOK) for b in range(17, 33, 4)],
    (33, 48, [(K(c), 1) for c in (C.IYAIYA, C.URUSEE, C.YAMETE, C.NAICHAU, C.OMOTE)]),
    *[(b, b + 3, HOOK) for b in range(49, 65, 4)],
    (65, 68, [(K(C.YURUSANAI), 1)]),
]

if __name__ == "__main__":
    KV.main()
