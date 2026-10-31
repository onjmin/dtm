"""samson5 の渡す前の確認（使い捨て）: 小節ごとの音量と、整列図（声のスペクトログラム＋16分格子＋モーラの置き場所）。"""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt, librosa, librosa.display
d = Path("samson5"); info = json.loads((d / "placement.json").read_text(encoding="utf-8"))
bar = 4 * 60 / info["bpm"]; off = 0.647
acc, sr = sf.read(d / "acc.wav"); acc = acc.mean(1) if acc.ndim > 1 else acc
lead, _ = sf.read(d / "lead.wav"); lead = lead.mean(1) if lead.ndim > 1 else lead
db = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
rows = []
for b in range(info["bars"]):
    a, e = int((off + b * bar) * sr), int((off + (b + 1) * bar) * sr)
    rows.append((b + 1, round(db(acc[a:e]), 1), round(db(lead[a:e]), 1)))
print("bar accdB leaddB"); print(" ".join(f"{r[0]}:{r[1]}/{r[2]}" for r in rows))
v, vsr = librosa.load(d / "voice.wav", sr=22050)
mel = np.load(d / "melody.npy"); six = bar / 16
fig, axs = plt.subplots(3, 1, figsize=(16, 10))
for ax, b0 in zip(axs, (5, 21, 29)):
    a, e = int((b0 - 1) * bar * vsr), int((b0 + 1) * bar * vsr)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(v[a:e], n_fft=1024, hop_length=128)), ref=np.max)
    librosa.display.specshow(S, sr=vsr, hop_length=128, x_axis="time", y_axis="log", ax=ax, cmap="magma")
    for k in range(33):
        ax.axvline(k * six, color="w", lw=1.2 if k % 4 == 0 else 0.3, alpha=0.6)
    for p, l, m in mel:
        t = p * six - (b0 - 1) * bar
        if 0 <= t < 2 * bar:
            ax.plot([t, t + l * six], [librosa.midi_to_hz(m)] * 2, color="c", lw=3)
    ax.set_ylim(60, 4000); ax.set_title(f"bars {b0}-{b0+1}")
plt.tight_layout(); plt.savefig(d / "align.png", dpi=80)
