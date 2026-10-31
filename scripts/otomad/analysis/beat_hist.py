"""声の立ち上がりを16分へ寄せ、拍の中の位置（0=拍頭,1,2,3）ごとに数える（使い捨て）。

R4 は4位置に均等だと0になり「拍頭に乗る点があるか」を測れないため、位置ごとの割合で見る。
"""
import json

import librosa
import numpy as np

SR, HOP = 22050, 128
PAIRS = {
    "meme": ("ana_demucs/htdemucs/sm34094775/vocals.wav", "refs/520648113.wav", 0.3123),
    "okaeshi": ("ana_demucs/htdemucs/sm38275737/vocals.wav", "ana_demucs/htdemucs/sm38275737/no_vocals.wav", 0.0),
}
out = {}
for name, (vp, ap, off) in PAIRS.items():
    v, _ = librosa.load(vp, sr=SR)
    a, _ = librosa.load(ap, sr=SR)
    a = a[int(off * SR):]
    _, beats = librosa.beat.beat_track(y=a, sr=SR, hop_length=HOP, units="time")
    env = librosa.onset.onset_strength(y=v, sr=SR, hop_length=HOP)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP)
    on = fr * HOP / SR
    strength = env[fr]
    rms = librosa.feature.rms(y=v, hop_length=HOP)[0]
    loud = np.array([rms[f:f + 8].max() for f in fr])
    sel = (on > beats[0]) & (on < beats[-1])
    on, strength, loud = on[sel], strength[sel], loud[sel]
    k = np.searchsorted(beats, on) - 1
    pos = (on - beats[k]) / (beats[k + 1] - beats[k]) * 4  # 拍の中の16分単位
    # 拍検出の一定のずれを除く（位相の平均を引く）
    phase = np.angle(np.mean(np.exp(2j * np.pi * pos))) / (2 * np.pi)
    q = np.round(pos - phase).astype(int) % 4
    dev = np.abs((pos - phase) - np.round(pos - phase))
    on_grid = dev < 0.25  # 16分の ±1/4 以内
    res = {"n": int(len(on)), "phaseOffset16": round(float(phase), 3), "onGrid": round(float(on_grid.mean()), 2)}
    for label, w in (("count", np.ones(len(q))), ("strength", strength), ("loudness", loud)):
        h = np.array([w[(q == i) & on_grid].sum() for i in range(4)])
        res[label] = [round(float(x), 3) for x in h / h.sum()]
    # 強い立ち上がり上位25%だけ
    top = strength >= np.percentile(strength, 75)
    h = np.array([((q == i) & on_grid & top).sum() for i in range(4)])
    res["top25%strength"] = [round(float(x), 3) for x in h / h.sum()]
    out[name] = res
open("beat_hist.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
print(json.dumps(out, ensure_ascii=False))
