"""エア本語録を v5 の配置で作り直す（使い捨て）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
from compose_quotes3 import SECTIONS  # noqa: E402
from setting import run  # noqa: E402

SHABA_TEXT = "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ、ダ"
sections = [
    (label, [(f, n, SHABA_TEXT if n == 3 else t, k, r) for f, n, t, k, r in items])
    for label, items in SECTIONS
]
if __name__ == "__main__":
    run(sections, sys.argv[1])
