"""2号兄貴リスペクトの伴奏に淫夢の台詞を載せる（使い捨て）。配置の仕組みは kaisen_voice と同じ。

python -I nigo_voice.py <nigo.json> <nigo_acc.wav> <outdir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import inmu_v1 as M  # noqa: E402
import kaisen_voice as KV  # noqa: E402

K = KV.K
# ベース2本・低いリード（ベース寄りの線）・和音/エレピ
KV.HARMONY_TRACKS = ("3", "4", "5", "7", "8", "9", "13")
HOOK = [(K(M.YARI), 4), (K(M.JAKEN), 1)]  # 4小節の単位: やりますねぇ×4（2小節）→ じゃけん
def hooks(bar0, bar1):
    """フックは4小節ごとの区間に分ける（組の頭を4小節の頭にそろえる）。"""
    return [(b, b + 3, HOOK) for b in range(bar0, bar1, 4)]


KV.PLAN = [
    (5, 8, [(K(M.OSS), 1)]),
    (9, 16, [(K(M.NUA), 1), (K(M.OKUJO), 1)]),
    *hooks(17, 33),
    (33, 40, [(K(M.AGE), 1), (K(M.GAKU), 1), (K(M.OKANO), 1)]),
    *hooks(41, 57),
    (57, 64, [(K(M.FA), 2), (K(M.SOUDAYO), 1), (K(M.MITOKE), 1)]),
    (65, 72, [(K(M.AKUSHIRO), 1), (K(M.NUA), 1)]),
    *hooks(73, 105),
    (105, 108, [(K(M.SUKI), 1)]),
]

if __name__ == "__main__":
    KV.main()
