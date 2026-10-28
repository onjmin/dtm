"""素材と書き出し先の場所。環境変数か、リポジトリ直下の .env（gitignore）の SPEECH_* で指定する。

SPEECH_MATERIAL_DIR  音MAD素材のフォルダ（必須。例 D:\\音MAD素材）
SPEECH_OUT_DIR       曲の書き出し先（既定 <repo>/scratch/speech-songs。gitignore の下に置く）
SPEECH_PYLIB         pip install --target で別に入れたパッケージのフォルダ（任意。sys.path の末尾へ足す）
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def _load_dotenv():
    p = REPO / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        k, sep, v = line.strip().partition("=")
        if sep and k.startswith("SPEECH_") and k not in os.environ:
            os.environ[k] = v.strip().strip('"').strip("'")


_load_dotenv()
if os.environ.get("SPEECH_PYLIB"):
    # 既存の numpy などを上書きさせないよう末尾へ足す
    sys.path.append(os.environ["SPEECH_PYLIB"])

OUT_DIR = Path(os.environ.get("SPEECH_OUT_DIR") or REPO / "scratch" / "speech-songs")


def material_dir():
    d = os.environ.get("SPEECH_MATERIAL_DIR")
    if not d:
        raise SystemExit("SPEECH_MATERIAL_DIR が未設定です（環境変数か .env で素材のフォルダを指定する）")
    if not Path(d).is_dir():
        raise SystemExit(f"SPEECH_MATERIAL_DIR のフォルダがありません: {d}")
    return Path(d)


def find(folder, name):
    """folder（素材フォルダからの相対パスか絶対パス）の下から name のファイルを探す。"""
    root = Path(folder) if Path(folder).is_absolute() else material_dir() / folder
    hits = sorted(root.rglob(name))
    if not hits:
        raise FileNotFoundError(f"{name}（{root} の下）")
    return hits[0]


def line(folder, name, text):
    """台詞1本の定義: (ファイル, 読み)。読みは pyopenjtalk へ渡す文（漢字かなまじりでよい）。"""
    return (find(folder, name), text)


def song_dir(name):
    d = OUT_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def relative_to_material(path):
    try:
        return str(Path(path).relative_to(material_dir()))
    except ValueError:
        return str(path)
