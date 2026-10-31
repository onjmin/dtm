"""声の音名を半音ずつずらしたとき、伴奏クロマとの一致がどう変わるか（使い捨て）。

一致が「ずらさない時だけ」高ければ、伴奏は声の音高に合わせて作られている。
python -I ref_pcshift.py <vocals.wav> <accomp.wav>
"""
import sys

import librosa
import numpy as np

SR, HOP = 22050, 256
v, _ = librosa.load(sys.argv[1], sr=SR)
a, _ = librosa.load(sys.argv[2], sr=SR)
n = min(len(v), len(a))
v, a = v[:n], a[:n]
f0, vf, _ = librosa.pyin(v, fmin=70, fmax=1000, sr=SR, hop_length=HOP, frame_length=2048)
m = librosa.hz_to_midi(np.where(vf & np.isfinite(f0), f0, np.nan))
# 打楽器を除いた伴奏の音程成分
a_h = librosa.effects.harmonic(a)
C = librosa.feature.chroma_cqt(y=a_h, sr=SR, hop_length=HOP)
k = min(C.shape[1], len(m))
idx = np.flatnonzero(np.isfinite(m[:k]))
pc = np.round(m[idx]).astype(int) % 12
Cn = C[:, idx] / (C[:, idx].sum(0, keepdims=True) + 1e-9)
print("ずらし(半音)  伴奏クロマ中の声の音名の重み  上位3音に入る率")
for d in range(12):
    p = (pc + d) % 12
    w = Cn[p, np.arange(len(idx))]
    top3 = np.argsort(-C[:, idx], axis=0)[:3]
    hit = np.mean([p[i] in top3[:, i] for i in range(len(idx))])
    print(f"{d:2d}  {w.mean():.3f}  {hit:.3f}")
# 伴奏が声を追うか: 声の音名が変わった直後に、伴奏のその音名が増えるか
chg = np.flatnonzero(np.diff(pc) != 0)
gain = []
for i in chg:
    j = i + 1
    if j + 8 < len(idx) and idx[j + 8] - idx[j] < 20:
        before = Cn[pc[j], max(0, j - 8):j].mean()
        after = Cn[pc[j], j:j + 8].mean()
        gain.append(after - before)
print("声の音名が変わった時の、伴奏のその音名の重みの変化 平均", round(float(np.mean(gain)), 4), "n", len(gain))
