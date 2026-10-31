"""伴奏・走るリード・主旋律のシンセ・台詞を混ぜる（使い捨て）。

python -I cookie_mix.py <acc> <lead> <double> <voice> <out> <声のずれ秒> <曲頭秒> <bpm> <サビ区間 "17-32,49-64">
"""
import sys

import librosa
import numpy as np
import soundfile as sf

FS = 44100
acc, lead, dbl = (librosa.load(p, sr=FS, mono=False)[0] for p in sys.argv[1:4])
voice, _ = librosa.load(sys.argv[4], sr=FS, mono=True)
off, head, bpm = float(sys.argv[6]), float(sys.argv[7]), float(sys.argv[8])
choruses = [tuple(int(x) for x in s.split("-")) for s in sys.argv[9].split(",")]
n = min(acc.shape[1], lead.shape[1], dbl.shape[1])
bar = 240 / bpm
t = np.arange(n) / FS
# 走るリード: サビは -12dB、それ以外は -6dB（0.2 秒でつなぐ）
g = np.full(n, -6.0)
for b0, b1 in choruses:
    g[(t >= head + (b0 - 1) * bar) & (t < head + b1 * bar)] = -12.0
k = int(0.2 * FS)
g = np.convolve(g, np.ones(k) / k, mode="same")
inst = acc[:, :n] + lead[:, :n] * 10 ** (g / 20) + dbl[:, :n] * 10 ** (-4 / 20)
v = np.zeros(n)
a = int(off * FS)
m = min(len(voice), n - a)
v[a:a + m] = voice[:m]
win = 2048
rv = np.sqrt(np.convolve(v ** 2, np.ones(win) / win, mode="same"))
ri = np.sqrt(np.convolve(acc[:, :n].mean(0) ** 2, np.ones(win) / win, mode="same"))
act = rv > 0.1 * rv.max()
gv = 10 ** (3 / 20) * np.median(ri[act]) / (np.median(rv[act]) + 1e-9)
mix = inst + gv * v[None, :]
mix = 0.95 * mix / np.abs(mix).max()
sf.write(sys.argv[5], mix.T.astype(np.float32), FS)
print("voice gain", round(float(gv), 3))
