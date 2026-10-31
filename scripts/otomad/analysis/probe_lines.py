"""台詞ごとの置き長さ（16分）・中央音高を見る。python probe_lines.py <lines.py> <BPM>"""
import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

sys.path.insert(0, str(paths.REPO / "scripts" / "speech-melody"))
import numpy as np  # noqa: E402

import config  # noqa: E402,F401
import voice as V  # noqa: E402

spec = importlib.util.spec_from_file_location("L", sys.argv[1])
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
six = 15 / float(sys.argv[2])
cache = V.load_clips(L.LINES, L.ANCHOR)
for key, c in cache.items():
    pos = V.place(c, six)
    print(c["text"], "len16=", int(pos[-1]) + 1, "pos=", list(map(int, pos)), "med=", round(float(np.nanmedian(c["midi"])), 1),
          "st=", [None if not np.isfinite(m) else round(float(m - np.nanmedian(c["midi"])), 1) for m in c["midi"]], c["method"])
