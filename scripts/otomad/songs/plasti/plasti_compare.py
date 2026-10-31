"""Plasticookie☆Adventure（本編）と MusMus 原曲を比べる（使い捨て）。BPM・調・原曲がどの区間で鳴っているか。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa  # noqa: E402
import numpy as np  # noqa: E402

R = paths.WORK / "refs" / "nigo"
SR = 22050
HOP = 512
mad, _ = librosa.load(R / "sm18319732.wav", sr=SR, mono=True)
org, _ = librosa.load(R / "musmus_plastic.wav", sr=SR, mono=True)
print("len mad %.1f org %.1f" % (len(mad) / SR, len(org) / SR))
for name, y in (("mad", mad), ("org", org)):
    t, b = librosa.beat.beat_track(y=y, sr=SR, hop_length=HOP)
    ch = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP).mean(1)
    names = "C C# D D# E F F# G G# A A# B".split()
    top = [names[i] for i in np.argsort(-ch)[:7]]
    print(name, "tempo", np.round(t, 1), "chroma top", top)

# 原曲の各区間（4秒）が本編のどこに似た音で現れるか（chroma の相互相関）
cm = librosa.feature.chroma_cqt(y=mad, sr=SR, hop_length=HOP)
co = librosa.feature.chroma_cqt(y=org, sr=SR, hop_length=HOP)
cm = cm / (np.linalg.norm(cm, axis=0) + 1e-9)
co = co / (np.linalg.norm(co, axis=0) + 1e-9)
fps = SR / HOP
W = int(4 * fps)
print("\n本編の4秒ごと: 原曲で一番似ている位置と類似度")
for s in range(0, cm.shape[1] - W, W):
    seg = cm[:, s:s + W]
    best, bi = -1, 0
    for o in range(0, co.shape[1] - W, 4):
        v = float((seg * co[:, o:o + W]).sum() / W)
        if v > best:
            best, bi = v, o
    rms = float(np.sqrt((mad[int(s / fps * SR):int((s + W) / fps * SR)] ** 2).mean()))
    print("%6.1fs  org@%6.1fs  sim %.2f  rms %.3f" % (s / fps, bi / fps, best, rms))
