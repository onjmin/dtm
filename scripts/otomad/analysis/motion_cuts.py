"""動画の切り替え（カット）の時刻を取り、拍の格子に対する位置を数える（使い捨て）。

python -I motion_cuts.py <mp4> <bpm> [<1拍目の秒>]
1拍目を渡さなければ、カットの位相が一番そろう点を探す。
"""
import subprocess
import sys

import numpy as np

path, bpm = sys.argv[1], float(sys.argv[2])
W, H, FPS = 128, 96, 30
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True).stdout
v = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32)
# 色の分布の差で切り替えを見る（動きやズームでは小さく、絵の入れ替えで大きい）
hist = np.stack([np.concatenate([np.histogram(f[..., c], 16, (0, 256))[0] for c in range(3)]) for f in v]).astype(np.float32)
hist /= hist.sum(1, keepdims=True)
d = np.abs(np.diff(hist, axis=0)).sum(1)
cuts = np.where((d > 0.35) & (d >= np.roll(d, 1)) & (d >= np.roll(d, -1)))[0] + 1
t = cuts / FPS
six = 15 / bpm
if len(sys.argv) > 3:
    t0 = float(sys.argv[3])
else:
    cand = np.arange(0, 4 * six, 0.005)
    t0 = cand[np.argmax([abs(np.mean(np.exp(2j * np.pi * (t - c) / (4 * six)))) for c in cand])]
ph = ((t - t0) / six) % 16
print(path, "cuts", len(t), "per min", round(len(t) / (len(v) / FPS / 60), 1), "beat0", round(float(t0), 3))
on16 = np.minimum(ph % 1, 1 - ph % 1) < 0.25
print("  on 16th grid", round(float(on16.mean()), 2))
hist16 = np.bincount(np.round(ph).astype(int) % 16, minlength=16)
print("  position in bar (16ths):", " ".join(str(x) for x in hist16))
gaps = np.diff(t) / six
print("  gap in 16ths  p10/p50/p90:", np.round(np.percentile(gaps, [10, 50, 90]), 1))
seg = 10
for a in range(0, int(len(v) / FPS), seg):
    m = (t >= a) & (t < a + seg)
    g = np.diff(t[m]) / six
    print(f"  {a:4d}s cuts {int(m.sum()):3d}  median gap16 {np.median(g) if len(g) else 0:.1f}")
np.save(path + ".cuts.npy", t)
