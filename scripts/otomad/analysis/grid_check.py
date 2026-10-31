"""声のトラックの onset が16分グリッドからどれだけずれるかを区間ごとに測る（使い捨て）。

python -I grid_check.py <voice.wav> <song.json>
"""
import json
import sys

import librosa
import numpy as np

SIX = 0.1
BAR = 16
y, sr = librosa.load(sys.argv[1], sr=16000)
info = json.load(open(sys.argv[2], encoding="utf-8"))
on = librosa.onset.onset_detect(y=y, sr=sr, hop_length=80, units="time", backtrack=False)
for s in info["sections"]:
    lab, rest = s.split("@")
    b0, n = (int(v) for v in rest.split("x"))
    t0, t1 = (b0 - 1) * BAR * SIX, (b0 - 1 + n) * BAR * SIX
    o = on[(on >= t0) & (on < t1)]
    if len(o) == 0:
        continue
    dev = (o / SIX - np.round(o / SIX)) * SIX * 1000
    # 拍（4分）の頭に乗るか: 拍の頭から ±30ms
    beat = np.abs(o / (4 * SIX) - np.round(o / (4 * SIX))) * 4 * SIX < 0.03
    print(f"{lab:6s}@{b0:2d} onsets {len(o):3d}  |16分ずれ| p50 {np.median(np.abs(dev)):4.0f}ms p90 {np.percentile(np.abs(dev), 90):4.0f}ms  拍頭 {beat.mean():.2f}")
