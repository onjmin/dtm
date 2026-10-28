"""voice.wav の測定: 立ち上がりが16分格子に乗るか・拍のどこに来るか、補正後の音高がペンタに乗るか。合否ではなく目安。

python check.py <曲名>  → <曲>/check.json
"""
import json
import sys

import librosa
import numpy as np

import config

SR = 22050
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
d = config.OUT_DIR / sys.argv[1]
info = json.loads((d / "placement.json").read_text(encoding="utf-8"))
six = 15 / info["bpm"]
out = {}
v, _ = librosa.load(d / "voice.wav", sr=SR)

env = librosa.onset.onset_strength(y=v, sr=SR, hop_length=128)
fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=128)
x = fr * 128 / SR / six
ok = np.abs(x - np.round(x)) < 0.25
q = np.round(x).astype(int) % 4
top = (env[fr] >= np.percentile(env[fr], 75)) & ok
out["onsetsWithinQuarter16"] = round(float(ok.mean()), 2)
out["posInBeat"] = [round(float(a), 2) for a in np.bincount(q[ok], minlength=4) / max(1, ok.sum())]
out["posInBeat strong25%"] = [round(float(a), 2) for a in np.bincount(q[top], minlength=4) / max(1, top.sum())]

if info.get("root"):
    root = NAMES.index(info["root"])
    pent = {(root + s) % 12 for s in (0, 3, 5, 7, 10)}
    f0, vf, _ = librosa.pyin(v, fmin=60, fmax=800, sr=SR, hop_length=256, frame_length=2048)
    mm = librosa.hz_to_midi(f0[vf & np.isfinite(f0)])
    out["voicedFramesInPentatonic"] = round(float(np.mean([int(round(a)) % 12 in pent for a in mm])), 2)
    out["voiceCentsFromSemitone p50"] = round(float(np.median(np.abs(mm - np.round(mm))) * 100), 1)
corr = [abs(c) for p in info["placed"] for c in p.get("correctionCents", [])]
if corr:
    out["correctionCents p50/p90/max"] = [float(np.median(corr)), float(np.percentile(corr, 90)), float(max(corr))]
(d / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
