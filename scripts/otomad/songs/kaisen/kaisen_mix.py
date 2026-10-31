"""録った伴奏と台詞を混ぜる（使い捨て）。python -I kaisen_mix.py <inst.wav> <voice.wav> <out.wav> <曲頭のずれ秒>"""
import sys

import librosa
import numpy as np
import soundfile as sf

FS = 44100
inst, _ = librosa.load(sys.argv[1], sr=FS, mono=False)
voice, _ = librosa.load(sys.argv[2], sr=FS, mono=True)
off = float(sys.argv[4])
v = np.zeros(inst.shape[1])
a = int(off * FS)
n = min(len(voice), len(v) - a)
v[a:a + n] = voice[:n]
# 声が鳴っている所で、声が伴奏より 3dB 大きくなるように合わせる
win = 2048
rv = np.sqrt(np.convolve(v ** 2, np.ones(win) / win, mode="same"))
ri = np.sqrt(np.convolve(inst.mean(0) ** 2, np.ones(win) / win, mode="same"))
act = rv > 0.1 * rv.max()
g = 10 ** (3 / 20) * np.median(ri[act]) / (np.median(rv[act]) + 1e-9)
mix = inst + g * v[None, :]
mix = 0.95 * mix / np.abs(mix).max()
sf.write(sys.argv[3], mix.T.astype(np.float32), FS)
print("voice gain", round(float(g), 3))
