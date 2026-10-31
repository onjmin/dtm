"""曲に使う全台詞の最終的な母音頭（赤）を、スペクトログラムと音量（青）に重ねて PNG にする（使い捨て）。

python -I plot_clips.py <inmu_v1|eahon_v5> <out.png>
"""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import librosa.display  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

import compose_quotes3  # noqa: E402
from setting import clip_data  # noqa: E402

mod = importlib.import_module(sys.argv[1])
secs = getattr(mod, "SECTIONS", None) or getattr(mod, "sections", None) or [("all", list(mod.ALL))]
items, seen = [], set()
for _, its in secs:
    for f, n, t, k, _r in its:
        if (f, n, t, k) not in seen:
            seen.add((f, n, t, k))
            items.append((f, n, t, k))
fig, axes = plt.subplots(len(items), 1, figsize=(14, 2.1 * len(items)))
for ax, (f, n, t, k) in zip(axes, items):
    p = f if n is None else compose_quotes3.find(f, n)
    c = clip_data(p, t, k)
    y, sr = librosa.load(str(p), sr=16000)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=512, hop_length=80)), ref=np.max)
    librosa.display.specshow(S, sr=sr, hop_length=80, x_axis="time", y_axis="linear", ax=ax, cmap="gray_r")
    ax.set_ylim(0, 4000)
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=80)[0]
    ax.plot(np.arange(len(rms)) * 80 / sr, 3800 * rms / rms.max(), color="tab:blue", lw=1)
    for m in c["morae"]:
        ax.axvline(m["vstart"], color="red", lw=1.2)
        ax.text(m["vstart"], 3500, m["mora"], color="red", fontsize=8)
    ax.set_title(f"{c['method']} agree={c['agree']:.2f}", loc="right", fontsize=9)
    ax.set_xlabel("")
plt.tight_layout()
plt.savefig(paths.WORK / sys.argv[2], dpi=55)
