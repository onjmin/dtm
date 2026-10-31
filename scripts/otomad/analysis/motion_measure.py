"""動画の動きの量を測る（使い捨て）。160x120 灰色に落とし、隣のコマとの差の平均と、大きな切り替え（カット）の数を10秒ごとに出す。

python -I motion_measure.py <mp4> [<mp4> ...]
"""
import subprocess
import sys

import numpy as np

W, H, FPS = 160, 120, 30
for path in sys.argv[1:]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    v = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    # 焼き込みコメントの多い上下の帯を外す
    v = v[:, 20:100]
    d = np.abs(np.diff(v, axis=0)).mean(axis=(1, 2))
    cut = d > 25
    still = d < 1.0
    n = len(d)
    print(path, "sec", round(n / FPS, 1), "meanDiff", round(float(d.mean()), 2), "median", round(float(np.median(d)), 2),
          "cuts/min", round(cut.sum() / (n / FPS / 60), 1), "stillFrac", round(float(still.mean()), 2))
    seg = 10 * FPS
    print("  per10s diff:", " ".join(f"{d[i:i + seg].mean():.1f}" for i in range(0, n, seg)))
    print("  per10s cuts:", " ".join(f"{int(cut[i:i + seg].sum())}" for i in range(0, n, seg)))
