"""作例の声と伴奏の関係を測る（使い捨て）。

python -I ref_analyze.py <name> <vocals.wav> <accomp.wav> [raw_speech_dir]
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 256  # 11.6ms


def f0_track(y):
    f0, vf, _ = librosa.pyin(y, fmin=70, fmax=1000, sr=SR, hop_length=HOP, frame_length=2048)
    return np.where(vf & np.isfinite(f0), f0, np.nan)


def tuning_cents(midi):
    """全音高の、最寄り半音からのずれ（セント）を、最適な基準のずれを引いて返す。"""
    m = midi[np.isfinite(midi)]
    best = None
    for off in np.arange(-50, 50, 1):
        d = ((m * 100 - off + 50) % 100) - 50
        e = np.mean(np.abs(d))
        if best is None or e < best[0]:
            best = (e, off, d)
    return best  # (平均|ずれ|, 基準のずれ, ずれ配列)


def plateau_share(midi, win=4, tol=0.15):
    """win フレーム（約46ms）の間、音高が tol 半音以内に留まる有声フレームの割合。"""
    ok = np.isfinite(midi)
    n = 0
    tot = 0
    for i in range(len(midi) - win):
        w = midi[i:i + win]
        if np.all(np.isfinite(w)):
            tot += 1
            n += np.ptp(w) < tol
    return n / max(1, tot)


def profile_voice(y):
    m = librosa.hz_to_midi(f0_track(y))
    e, off, d = tuning_cents(m)
    return {
        "voiced": float(np.mean(np.isfinite(m))),
        "tuningOffsetCents": float(off),
        "meanAbsCentsFromGrid": round(float(e), 1),
        "within15c": round(float(np.mean(np.abs(d) < 15)), 3),
        "plateau46ms": round(plateau_share(m), 3),
        "midi": m,
    }


def main():
    name, vpath, apath = sys.argv[1:4]
    raw_dir = sys.argv[4] if len(sys.argv) > 4 else None
    v, _ = librosa.load(vpath, sr=SR)
    a, _ = librosa.load(apath, sr=SR)
    n = min(len(v), len(a))
    v, a = v[:n], a[:n]
    out = {"name": name}

    pv = profile_voice(v)
    midi = pv.pop("midi")
    out["voice"] = pv
    out["accompTuningCents"] = round(float(librosa.estimate_tuning(y=a, sr=SR) * 100), 1)

    tempo, beats = librosa.beat.beat_track(y=a, sr=SR, hop_length=HOP, units="time")
    tempo = float(np.atleast_1d(tempo)[0])
    out["tempo"] = round(tempo, 1)
    # 声の立ち上がりと16分グリッド（拍の時刻から補間）
    on = librosa.onset.onset_detect(y=v, sr=SR, hop_length=HOP, units="time")
    if len(beats) > 4:
        grid = []
        for b0, b1 in zip(beats, beats[1:]):
            grid += list(np.linspace(b0, b1, 5)[:-1])
        grid = np.array(grid)
        inside = on[(on > beats[0]) & (on < beats[-1])]
        d = np.array([np.min(np.abs(grid - t)) for t in inside])
        six = 60 / tempo / 4
        out["onsetToGrid16"] = {
            "n": int(len(inside)),
            "medianMs": round(float(np.median(d)) * 1000, 1),
            "within20ms": round(float(np.mean(d < 0.02)), 3),
            # でたらめな時刻なら |ずれ| は一様で、20ms 以内の割合は 0.04/six
            "randomWithin20ms": round(min(1.0, 0.04 / six), 3),
        }
        # 拍頭（4分）に乗る立ち上がりの割合
        db = np.array([np.min(np.abs(beats - t)) for t in inside])
        out["onsetOnBeat30ms"] = round(float(np.mean(db < 0.03)), 3)
        out["randomOnBeat30ms"] = round(min(1.0, 0.06 / (60 / tempo)), 3)

    # 声の音が伴奏の和音の音か: 伴奏のクロマ上位3音に声の音名が入るか
    C = librosa.feature.chroma_cqt(y=a, sr=SR, hop_length=HOP)
    k = min(C.shape[1], len(midi))
    pcs = np.round(midi[:k] - out["voice"]["tuningOffsetCents"] / 100) % 12
    ok = np.isfinite(pcs)
    top3 = np.argsort(-C[:, :k], axis=0)[:3]
    hit = np.array([pcs[i] in top3[:, i] for i in range(k) if ok[i]])
    # 基準: 声の音名を ±数秒ずらして同じことをした時（偶然の一致）
    shift = int(3.0 * SR / HOP)
    base = np.array([pcs[i] in top3[:, (i + shift) % k] for i in range(k) if ok[i]])
    out["voicePcInAccompTop3"] = round(float(hit.mean()), 3)
    out["voicePcInAccompTop3_shifted3s"] = round(float(base.mean()), 3)
    # 伴奏が声をなぞっているか: 声の音名のクロマ値の、伴奏クロマ平均に対する比
    cv = np.array([C[int(pcs[i]), i] / (C[:, i].mean() + 1e-9) for i in range(k) if ok[i]])
    cb = np.array([C[int(pcs[i]), (i + shift) % k] / (C[:, (i + shift) % k].mean() + 1e-9) for i in range(k) if ok[i]])
    out["voicePcChromaRatio"] = round(float(cv.mean()), 3)
    out["voicePcChromaRatio_shifted3s"] = round(float(cb.mean()), 3)

    if raw_dir:
        files = sorted(Path(raw_dir).glob("*.wav"))[:40]
        ys = np.concatenate([librosa.load(str(f), sr=SR)[0] for f in files])
        rp = profile_voice(ys)
        rp.pop("midi")
        out["rawSpeechBaseline"] = rp

    Path(f"ana_{name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
