"""一転攻勢の区間だけ音圧を上げる（使い捨て）。song.wav を上書きし、元は song_premaster.wav に残す。

前半はほぼそのまま、modBar の1拍前から歪みの強い飽和（tanh）へ切り替えて、最後にピークをそろえる。
python -I plasti_master.py <outdir> [一転攻勢の駆動の強さ]
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

od = Path(sys.argv[1])
drive = float(sys.argv[2]) if len(sys.argv) > 2 else 3.0
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
off = float((od / "offset.txt").read_text())
bar = 240 / info["bpm"]
pre = od / "song_premaster.wav"
if not pre.exists():
    shutil.copy(od / "song.wav", pre)
x, sr = sf.read(pre)
t = np.arange(len(x)) / sr
t0 = off + (info["modBar"] - 1) * bar - bar / 4
k = np.clip((t - t0) / (bar / 4), 0, 1)[:, None]
d = 1.0 + (drive - 1.0) * k
y = np.tanh(d * x / np.abs(x).max()) / np.tanh(d)
y = 0.95 * y / np.abs(y).max()
sf.write(od / "song.wav", y.astype(np.float32), sr)


def rms_db(a, b):
    s = y[int(a * sr):int(b * sr)]
    return 20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9)


print("RMS dB first-half hook", round(rms_db(off + 24 * bar, off + 40 * bar), 1), "twist", round(rms_db(off + 56 * bar, off + 72 * bar), 1))
