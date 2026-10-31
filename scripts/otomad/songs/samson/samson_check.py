"""サムソン版の測定（使い捨て）。python -I samson_check.py <outdir>"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
d = Path(sys.argv[1])
info = json.loads((d / "placement.json").read_text(encoding="utf-8"))
six = 15 / info["bpm"]
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
root = NAMES.index(info["root"])
pent = {(root + s) % 12 for s in (0, 3, 5, 7, 10)}
out = {}
v, _ = librosa.load(d / "voice.wav", sr=SR)

# 1. 立ち上がりと格子
env = librosa.onset.onset_strength(y=v, sr=SR, hop_length=128)
fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=128)
x = fr * 128 / SR / six
dev = np.abs(x - np.round(x))
ok = dev < 0.25
q = np.round(x).astype(int) % 4
top = (env[fr] >= np.percentile(env[fr], 75)) & ok
out["onsetsWithinQuarter16"] = round(float(ok.mean()), 2)
out["posInBeat"] = [round(float(a), 2) for a in np.bincount(q[ok], minlength=4) / ok.sum()]
out["posInBeat strong25%"] = [round(float(a), 2) for a in np.bincount(q[top], minlength=4) / top.sum()]

# 2. 旋律と和音（名前）: 半音ずらし
steps = [0, 2, 3, 5, 7, 8, 10]
sc = [(root + s) % 12 for s in steps]
names = ["i", "ii°", "III", "iv", "v", "VI", "VII"]
tones = {names[k]: {sc[k], sc[(k + 2) % 7], sc[(k + 4) % 7]} for k in range(7)}
prog = info["progression"].split()
mel = np.load(d / "melody.npy")
rates = []
for sh in range(12):
    hit = [((int(m) + sh) % 12) in tones[prog[int(p) // 16]] for p, w, m in mel if int(p) // 16 < len(prog)]
    rates.append(round(float(np.average(hit, weights=[w for p, w, m in mel if int(p) // 16 < len(prog)])), 3))
out["melodyInChord by shift"] = rates

# 3. 補正後の声の音高: ペンタに乗るか、半音からのずれ
f0, vf, _ = librosa.pyin(v, fmin=60, fmax=800, sr=SR, hop_length=256, frame_length=2048)
mm = librosa.hz_to_midi(f0[vf & np.isfinite(f0)])
out["voicedFramesInPentatonic"] = round(float(np.mean([int(round(a)) % 12 in pent for a in mm])), 2)
out["voiceCentsFromSemitone p50"] = round(float(np.median(np.abs(mm - np.round(mm))) * 100), 1)
corr = [abs(c) for p in info["placed"] for c in p["correctionCents"]]
out["correctionCents p50/p90/max"] = [float(np.median(corr)), float(np.percentile(corr, 90)), float(max(corr))]
(d / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
