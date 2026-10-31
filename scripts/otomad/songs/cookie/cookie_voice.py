"""2号兄貴リスペクト（ハ短調）にクッキー☆（UDK姉貴）の語録を載せる（使い捨て）。

python -I cookie_voice.py <cookie_nigo.json> <cookie_acc.wav> <outdir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import cookie_v1 as C  # noqa: E402
import inmu_v3 as V  # noqa: E402
import kaisen_voice as KV  # noqa: E402

K = KV.K
USE = [C.OSS, C.YUKKURI, C.NOBITA, C.DANMAKU, C.REU4, C.UU, C.REUCHOTTO, C.SOONANOKA, C.JUDGE, C.IYAIYA,
       C.URUSEE, C.YAMETE, C.NAICHAU, C.OMOTE, C.YURUSANAI]
V.SECTIONS = [("all", [(K(c), 1) for c in USE])]  # load_clips が読む台詞
KV.LOOP_KEYS = set()
KV.NO_DELAY = True
KV.HARMONY_TRACKS = ("3", "4", "5", "7", "13")  # 低いノコギリ・ベース2本・和音の刻み・木琴
HOOK = [(K(C.REU4), 1), (K(C.UU), 1), (K(C.REUCHOTTO), 1)]


def hooks(bar0, bar1):
    return [(b, b + 3, HOOK) for b in range(bar0, bar1, 4)]


KV.PLAN = [
    (3, 4, [(K(C.OSS), 1)]),
    (5, 12, [(K(C.YUKKURI), 1), (K(C.NOBITA), 1), (K(C.DANMAKU), 1)]),
    *hooks(13, 29),
    (29, 36, [(K(C.SOONANOKA), 1), (K(C.JUDGE), 1), (K(C.IYAIYA), 1), (K(C.URUSEE), 1)]),
    *hooks(37, 53),
    (53, 60, [(K(C.YAMETE), 1), (K(C.NAICHAU), 1), (K(C.OMOTE), 1)]),
    *hooks(61, 89),
    (89, 92, [(K(C.YURUSANAI), 1), (K(C.YUKKURI), 1)]),
]

if __name__ == "__main__":
    KV.main()
