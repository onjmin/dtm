"""淫夢2軍の台詞イントネーション作曲。作り方は samson_build と同じ（台詞と構成だけ差し替える）。使い捨て。

フック: 関西クレーマー「ルームサービスお願いします」→ KBTIT「うっそだろお前」（4小節ごと）。
python -I inmu2gun_build.py <outdir>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import inmu2gun_v1 as S  # noqa: E402
import samson_build as B  # noqa: E402

K = B.K
B.S = S
B.HOOK_A, B.HOOK_B = S.ROOM, S.USSO
B.PLAN = [
    (1, 2, [(K(S.GORAN), 1)]),
    (3, 4, [(K(S.NASU), 1)]),
    (5, 12, [(K(c), 1) for c in (S.SIGN, S.OTODOKE, S.DOUSHITE, S.KEISATSU)]),
    *B.hook(13, 21),
    (21, 28, [(K(c), 1) for c in (S.SHINU, S.IKIKAERE, S.INARI, S.SHINJI, S.BANKAI, S.WARACCHAU)]),
    *B.hook(29, 37),
    (37, 40, [(K(c), 1) for c in (S.MITOKE, S.AKUSHIRO)]),
    *B.hook(41, 49, S.NASU),
    (49, 52, [(K(S.YOROKONDE), 1), (K(S.KANASHII), 1)]),
]
B.HOOK_BARS = [(13, 20), (29, 36), (41, 48)]

if __name__ == "__main__":
    B.main()
