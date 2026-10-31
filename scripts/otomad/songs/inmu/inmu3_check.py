"""inmu_v3 の書き出しを測る（使い捨て）。python -I inmu3_check.py <outdir>"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

from inmu_v2 import chord_vocab  # noqa: E402

SR = 22050
SIX = 15 / 120
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
d = Path(sys.argv[1])
info = json.loads((d / "song.json").read_text(encoding="utf-8"))
v, _ = librosa.load(d / "voice.wav", sr=SR)
out = {}

# 1. 立ち上がりと格子（拍は書き出しの格子そのもの）
env = librosa.onset.onset_strength(y=v, sr=SR, hop_length=128)
fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=128)
on = fr * 128 / SR
x = on / SIX
phase = np.angle(np.mean(np.exp(2j * np.pi * x))) / (2 * np.pi)
dev = ((x - phase) - np.round(x - phase)) * SIX * 1000
q = np.round(x - phase).astype(int) % 4
out["detectorPhaseOffsetMs"] = round(float(phase * SIX * 1000), 1)
out["onsetDevFromGridMs p50/p90"] = [round(float(np.percentile(np.abs(dev), p)), 1) for p in (50, 90)]
out["onsetsWithin20ms"] = round(float(np.mean(np.abs(dev) < 20)), 2)
h = np.bincount(q, minlength=4) / len(q)
out["posInBeat(audio)"] = [round(float(v_), 2) for v_ in h]
top = env[fr] >= np.percentile(env[fr], 75)
h2 = np.bincount(q[top], minlength=4) / top.sum()
out["posInBeat strong25%(audio)"] = [round(float(v_), 2) for v_ in h2]

# 2. 音高: 予定（原音+移調）と書き出し
notes = np.load(d / "notes.npy")
f0, vf, _ = librosa.pyin(v, fmin=60, fmax=800, sr=SR, hop_length=256, frame_length=2048)
m = librosa.hz_to_midi(np.where(vf & np.isfinite(f0), f0, np.nan))
diffs = []
for pos, w, mi, _s in notes:
    a = int(pos * SIX * SR / 256)
    seg = m[a:a + max(2, int(min(w, 2) * SIX * SR / 256))]
    seg = seg[np.isfinite(seg)]
    if len(seg) >= 2:
        diffs.append(((np.median(seg) - mi) * 100 + 600) % 1200 - 600)
out["pitchVsPlannedCents p50/p90"] = [round(float(np.percentile(np.abs(diffs), p)), 1) for p in (50, 90)]

# 3. 和音（名前）と声の音名: 半音ずらし
key, mode = info["key"].split()
vocab, _ = chord_vocab(NAMES.index(key), mode)
byname = {f"{NAMES[r]}({n})": s for r, s, n in vocab}
prog = info["progression"].split()
rates = []
for sh in range(12):
    hit = [((int(round(mi)) + sh) % 12) in byname[prog[int(pos) // 16]] for pos, w, mi, _s in notes]
    rates.append(round(float(np.average(hit, weights=notes[:, 1])), 3))
out["voicePcInChord by shift(planned)"] = rates
(d / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
