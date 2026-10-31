"""完成版から inst 版を引いて台詞だけを取り出す（使い捨て）。

python -I ref_extract.py <full.wav> <inst.wav> <out_dir>
"""
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve

SR = 44100
full, inst, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
F, _ = librosa.load(full, sr=SR, mono=False)
I, _ = librosa.load(inst, sr=SR, mono=False)
fm, im = F.mean(0), I.mean(0)

# 粗い位置合わせ: 8kHz に落として相互相関
f8 = librosa.resample(fm, orig_sr=SR, target_sr=8000)
i8 = librosa.resample(im, orig_sr=SR, target_sr=8000)
xc = fftconvolve(f8, i8[::-1], mode="full")
lag8 = int(np.argmax(xc)) - (len(i8) - 1)
lag = lag8 * SR // 8000
# 細かく: ±20 サンプル
best = None
for d in range(lag - 20, lag + 21):
    a0, b0 = max(0, d), max(0, -d)
    n = min(len(fm) - a0, len(im) - b0, SR * 60)
    c = float(np.dot(fm[a0:a0 + n], im[b0:b0 + n]) / (np.linalg.norm(fm[a0:a0 + n]) * np.linalg.norm(im[b0:b0 + n]) + 1e-9))
    if best is None or c > best[0]:
        best = (c, d)
corr, lag = best
print(f"lag {lag} samples ({lag / SR * 1000:.1f} ms), corr {corr:.3f}")

a0, b0 = max(0, lag), max(0, -lag)
n = min(F.shape[1] - a0, I.shape[1] - b0)
Fa, Ia = F[:, a0:a0 + n], I[:, b0:b0 + n]
# 周波数ごとの複素ゲインで引く（マスタリング・コーデックの差を吸収）
res = []
for ch in range(2):
    SF = librosa.stft(Fa[ch], n_fft=4096, hop_length=1024)
    SI = librosa.stft(Ia[ch], n_fft=4096, hop_length=1024)
    g = (SF * SI.conj()).sum(1) / ((np.abs(SI) ** 2).sum(1) + 1e-9)
    R = SF - g[:, None] * SI
    res.append(librosa.istft(R, hop_length=1024, length=n))
V = np.stack(res)
sf.write(out / "voice_sub.wav", V.T, SR)
e_full = np.sqrt(np.mean(Fa ** 2))
e_res = np.sqrt(np.mean(V ** 2))
print(f"residual/full rms {20 * np.log10(e_res / e_full):.1f} dB")
