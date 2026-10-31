"""伴奏・リード・台詞を混ぜる（使い捨て）。

python -I nigo_mix.py <acc.wav> <lead.wav> <voice.wav> <out.wav> <曲頭のずれ秒> <リードの dB>
"""
import sys

import librosa
import numpy as np
import soundfile as sf

FS = 44100
acc, _ = librosa.load(sys.argv[1], sr=FS, mono=False)
lead, _ = librosa.load(sys.argv[2], sr=FS, mono=False)
voice, _ = librosa.load(sys.argv[3], sr=FS, mono=True)
off, lead_db = float(sys.argv[5]), float(sys.argv[6])
n = min(acc.shape[1], lead.shape[1])
inst = acc[:, :n] + 10 ** (lead_db / 20) * lead[:, :n]
v = np.zeros(n)
a = int(off * FS)
m = min(len(voice), n - a)
v[a:a + m] = voice[:m]
win = 2048
rv = np.sqrt(np.convolve(v ** 2, np.ones(win) / win, mode="same"))
ri = np.sqrt(np.convolve(inst.mean(0) ** 2, np.ones(win) / win, mode="same"))
act = rv > 0.1 * rv.max()
g = 10 ** (3 / 20) * np.median(ri[act]) / (np.median(rv[act]) + 1e-9)
mix = inst + g * v[None, :]
mix = 0.95 * mix / np.abs(mix).max()
sf.write(sys.argv[4], mix.T.astype(np.float32), FS)
sf.write(sys.argv[4].replace(".wav", "_inst.wav"), (0.95 * inst / np.abs(inst).max()).T.astype(np.float32), FS)
print("voice gain", round(float(g), 3))
