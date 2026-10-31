"""inmu_v2 の書き出しを、作例と同じ物差しで測る（使い捨て）。

python -I inmu2_check.py <outdir>
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR, HOP = 22050, 128
d = Path(sys.argv[1])
info = json.loads((d / "song.json").read_text(encoding="utf-8"))
beat = info["beatSec"]
v, _ = librosa.load(d / "voice.wav", sr=SR)
a, _ = librosa.load(d / "accomp.wav", sr=SR)
out = {}

# 1. 声の音高が原音から動いていないか: 置いた各音の予定音高 vs 書き出しの pyin
notes = np.load(d / "notes.npy")
f0, vf, _ = librosa.pyin(v, fmin=60, fmax=800, sr=SR, hop_length=256, frame_length=2048)
m = librosa.hz_to_midi(np.where(vf & np.isfinite(f0), f0, np.nan))
six = beat / 4
diffs = []
for pos, w, mi in notes:
    t0, t1 = pos * six, (pos + min(w, 2)) * six
    seg = m[int(t0 * SR / 256):int(t1 * SR / 256)]
    seg = seg[np.isfinite(seg)]
    if len(seg) >= 2:
        dd = (np.median(seg) - mi) * 100
        dd = (dd + 600) % 1200 - 600  # オクターブ誤りを畳む
        diffs.append(dd)
diffs = np.abs(diffs)
out["pitchVsOriginalCents p50/p90"] = [round(float(np.percentile(diffs, q)), 1) for q in (50, 90)]

# 2. 立ち上がりの偏り（拍は書き出しの格子そのもの）
on = librosa.onset.onset_detect(y=v, sr=SR, hop_length=HOP, units="time")
pos = on / beat


def R(ph):
    z = np.exp(2j * np.pi * ph)
    return round(float(abs(z.mean())), 3)


out["R16/R8/R4"] = [R(pos * 4), R(pos * 2), R(pos)]
out["onsets"] = int(len(on))

# 3. 声の音名と伴奏（打楽器を除く）の一致、半音ずらし
mm = m[: int(len(a) / 256)]
C = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(a), sr=SR, hop_length=256)
k = min(C.shape[1], len(mm))
idx = np.flatnonzero(np.isfinite(mm[:k]))
pc = np.round(mm[idx]).astype(int) % 12
top3 = np.argsort(-C[:, idx], axis=0)[:3]
hits = []
for sh in range(12):
    p = (pc + sh) % 12
    hits.append(round(float(np.mean([p[i] in top3[:, i] for i in range(len(idx))])), 3))
out["voicePcInTop3 by shift"] = hits

# 4. ベースの下降
prog = info["progression"].split()
names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
roots = [names.index(x.split("(")[0]) for x in prog]
moves = [(b - a) % 12 for a, b in zip(roots, roots[1:]) if a != b]
out["rootMovesDownStep"] = round(float(np.mean([mv in (10, 11) for mv in moves])), 3)
out["rootChanges"] = len(moves)
(d / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
