"""音MAD制作の場所の決まり。import するだけで lib と各曲のフォルダ、外部ライブラリ（pylib）を sys.path へ足す。

場所はリポジトリ直下の .env か環境変数で変える（別PCで再開するときはここだけ合わせる）。
  SPEECH_MATERIAL_DIR  素材のフォルダ（既定 D:/音MAD素材）
  OTOMAD_WORK          作業フォルダ。素材の写し・キャッシュ・書き出した曲（既定 scratch/speech-melody、gitignore）
  SPEECH_PYLIB         pip --target で別に入れた外部ライブラリ（既定 <作業フォルダ>/pylib）
"""
import os
import sys
from pathlib import Path

OTOMAD = Path(__file__).resolve().parents[1]
REPO = OTOMAD.parents[1]


def _env(key):
    if key in os.environ:
        return os.environ[key]
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, _, v = line.partition("=")
            if k.strip() == key:
                return v.strip().strip('"')
    return None


MATERIAL = Path(_env("SPEECH_MATERIAL_DIR") or "D:/音MAD素材")
WORK = Path(_env("OTOMAD_WORK") or REPO / "scratch" / "speech-melody")
PYLIB = Path(_env("SPEECH_PYLIB") or WORK / "pylib")
USER_FONTS = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts"

# 曲の build は他の曲の build を部品として読む（例: dande は techno1_build の伴奏を使う）ので、曲のフォルダも全部足す
for d in [OTOMAD / "lib", *sorted((OTOMAD / "songs").glob("*")), OTOMAD / "analysis", OTOMAD / "tools"]:
    if d.is_dir() and str(d) not in sys.path:
        sys.path.insert(1, str(d))
if PYLIB.is_dir() and str(PYLIB) not in sys.path:
    sys.path.append(str(PYLIB))
