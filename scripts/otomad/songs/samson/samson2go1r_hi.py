"""高い音の量を比べる（使い捨て）: 伴奏＋リードの 2 kHz 以上と 4 kHz 以上が全体の何 dB 下か、サビ（17〜24小節）で。
python -I samson2go1r_hi.py <acc.wav> <lead.wav> <offset秒> <リードの dB>
"""
import sys
import librosa
import numpy as np

acc, sr = librosa.load(sys.argv[1], sr=44100)
lead, _ = librosa.load(sys.argv[2], sr=44100)
off, ldb = float(sys.argv[3]), float(sys.argv[4])
n = min(len(acc), len(lead))
x = acc[:n] + 10 ** (ldb / 20) * lead[:n]
bar = 4 * 60 / 144
a, b = int((off + 16 * bar) * sr), int((off + 24 * bar) * sr)
S = np.abs(librosa.stft(x[a:b], n_fft=4096)) ** 2
f = librosa.fft_frequencies(sr=sr, n_fft=4096)
tot = S.sum()
L = np.abs(librosa.stft(lead[a:b], n_fft=4096)) ** 2
print({k: round(float(10 * np.log10(S[f >= k].sum() / tot)), 1) for k in (2000, 4000)},
      "lead centroid Hz", round(float((f[:, None] * L).sum() / L.sum())))
