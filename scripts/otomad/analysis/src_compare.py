"""曲の台詞と元配信の同じ台詞を DTW で対応させ、伸縮・移調・拍頭との関係を測る（使い捨て）。"""
import json

import librosa
import numpy as np

SR, HOP = 22050, 256
FPS = SR / HOP
song_v, _ = librosa.load("ana_demucs/htdemucs/sm34094775/vocals.wav", sr=SR)
src_v, _ = librosa.load("ana_demucs/htdemucs/src_pHgl3vGfYkE/vocals.wav", sr=SR)
inst, _ = librosa.load("refs/520648113.wav", sr=SR)
inst = inst[int(0.3123 * SR):]
tempo, beats = librosa.beat.beat_track(y=inst, sr=SR, hop_length=HOP, units="time")
tempo = float(np.atleast_1d(tempo)[0])

# (名前, 曲の区間, 配信の探索窓)
PAIRS = [
    ("大丈夫じゃない…やばいやばい#1", (37.5, 40.5), (373.0, 382.0)),
    ("大丈夫じゃない…やばいやばい#2", (51.5, 54.5), (373.0, 382.0)),
    ("乗ってるかーい", (57.5, 60.0), (322.0, 328.0)),
    ("サイコロが#1", (104.0, 110.0), (962.0, 973.0)),
    ("サイコロが#2", (126.0, 128.5), (962.0, 973.0)),
]


def feats(y):
    m = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=20)[1:]
    return (m - m.mean(1, keepdims=True)) / (m.std(1, keepdims=True) + 1e-9)


def f0(y):
    f, vf, _ = librosa.pyin(y, fmin=70, fmax=1000, sr=SR, hop_length=HOP, frame_length=2048)
    return librosa.hz_to_midi(np.where(vf & np.isfinite(f), f, np.nan))


out = {"tempo": round(tempo, 1)}
for name, (a0, a1), (b0, b1) in PAIRS:
    q = song_v[int(a0 * SR):int(a1 * SR)]
    r = src_v[int(b0 * SR):int(b1 * SR)]
    D, wp = librosa.sequence.dtw(X=feats(q), Y=feats(r), subseq=True, metric="cosine")
    wp = wp[::-1]
    cost = float(D[-1, :].min() / len(q) * HOP)
    qi, ri = wp[:, 0], wp[:, 1]
    src_start = b0 + ri[0] / FPS
    src_end = b0 + ri[-1] / FPS
    # 伸縮: 曲の時間 / 配信の時間（全体と、0.25秒ごとの局所）
    total = (qi[-1] - qi[0]) / max(1, ri[-1] - ri[0])
    loc = []
    step = int(0.25 * FPS)
    for k in range(0, len(wp) - step, step):
        dq = qi[k + step] - qi[k]
        dr = ri[k + step] - ri[k]
        if dr > 0:
            loc.append(dq / dr)
    # 音高差（曲 − 配信）を対応したフレームで
    fq, fr = f0(q), f0(r)
    d = np.array([fq[i] - fr[j] for i, j in wp if np.isfinite(fq[i]) and np.isfinite(fr[j])])
    # 拍頭に乗っている曲側の立ち上がりと、その点の配信側の対応
    on = librosa.onset.onset_detect(y=q, sr=SR, hop_length=HOP, units="time") + a0
    near = [float(np.min(np.abs(beats - t))) for t in on]
    out[name] = {
        "srcSpan": [round(src_start, 2), round(src_end, 2)],
        "dtwCost": round(cost, 3),
        "stretchTotal(song/src)": round(float(total), 3),
        "stretchLocal p10/p50/p90": [round(float(np.percentile(loc, p)), 2) for p in (10, 50, 90)] if loc else None,
        "pitchDiff semitone p10/p50/p90": [round(float(np.percentile(d, p)), 2) for p in (10, 50, 90)] if len(d) > 10 else None,
        "pitchDiffSpread(p90-p10)": round(float(np.percentile(d, 90) - np.percentile(d, 10)), 2) if len(d) > 10 else None,
        "voicedPairs": int(len(d)),
        "onsetsOnBeat(<30ms)/onsets": f"{sum(x < 0.03 for x in near)}/{len(near)}",
    }
open("src_compare.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
