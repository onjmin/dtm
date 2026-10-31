"""海鮮版の測定（使い捨て）。python -I kaisen_check.py <outdir> <inst.wav> <曲頭のずれ秒>"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
d = Path(sys.argv[1])
off = float(sys.argv[3])
six = 15 / json.loads((d / "placement.json").read_text(encoding="utf-8"))["bpm"]
out = {}
v, _ = librosa.load(d / "voice.wav", sr=SR)

# 1. 声の立ち上がり（曲の時間）と16分格子
env = librosa.onset.onset_strength(y=v, sr=SR, hop_length=128)
fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=128)
x = fr * 128 / SR / six
dev = np.abs(x - np.round(x))
out["voiceOnsetsWithinQuarter16"] = round(float(np.mean(dev < 0.25)), 2)
out["voiceOnsetDevMs p50"] = round(float(np.median(dev) * six * 1000), 1)
q = np.round(x).astype(int) % 4
ok = dev < 0.25
out["posInBeat"] = [round(float(v_), 2) for v_ in np.bincount(q[ok], minlength=4) / ok.sum()]
top = (env[fr] >= np.percentile(env[fr], 75)) & ok
out["posInBeat strong25%"] = [round(float(v_), 2) for v_ in np.bincount(q[top], minlength=4) / top.sum()]

# 2. 伴奏の拍と格子（録音のずれ off を引く）
inst, _ = librosa.load(sys.argv[2], sr=SR)
ei = librosa.onset.onset_strength(y=inst, sr=SR, hop_length=128)
fi = librosa.onset.onset_detect(onset_envelope=ei, sr=SR, hop_length=128)
xi = (fi * 128 / SR - off) / six
di = np.abs(xi - np.round(xi))
out["accompOnsetsWithinQuarter16"] = round(float(np.mean(di < 0.25)), 2)

# 3. 声の音名と伴奏の和音（16分ごとの音名の重み）: 半音ずらし
notes = np.load(d / "notes.npy")
H = np.load(d / "harmony16.npy")
rates = []
for sh in range(12):
    s = w = 0.0
    for pos, ww, mi, _st in notes:
        a = int(pos)
        if a >= len(H):
            continue
        h = H[a:a + max(1, int(ww))].mean(0)
        pc = (int(round(mi)) + sh) % 12
        s += ww * (h[pc] > 0.15)
        w += ww
    rates.append(round(s / w, 3))
out["voicePcInAccomp(>15%) by shift"] = rates
(d / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
