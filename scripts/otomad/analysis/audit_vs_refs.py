"""作例と自作を、まだ比べていない量で並べる（使い捨て）。"""
import json

import librosa
import numpy as np

SR, HOP = 22050, 512
PAIRS = {
    "meme": ("ana_demucs/htdemucs/sm34094775/vocals.wav", "ana_demucs/htdemucs/sm34094775/no_vocals.wav"),
    "okaeshi": ("ana_demucs/htdemucs/sm38275737/vocals.wav", "ana_demucs/htdemucs/sm38275737/no_vocals.wav"),
    "inmu2": ("inmu2/voice.wav", "inmu2/accomp.wav"),
}
out = {}
for name, (vp, ap) in PAIRS.items():
    v, _ = librosa.load(vp, sr=SR)
    a, _ = librosa.load(ap, sr=SR)
    n = min(len(v), len(a))
    v, a = v[:n], a[:n]
    rv = librosa.feature.rms(y=v, hop_length=HOP)[0]
    ra = librosa.feature.rms(y=a, hop_length=HOP)[0]
    dbv = 20 * np.log10(rv / rv.max() + 1e-9)
    act = dbv > -25
    f0, vf, _ = librosa.pyin(v, fmin=60, fmax=1000, sr=SR, hop_length=HOP, frame_length=2048)
    m = librosa.hz_to_midi(f0[vf & np.isfinite(f0)])
    tempo, beats = librosa.beat.beat_track(y=a, sr=SR, hop_length=HOP)
    C = librosa.feature.chroma_cqt(y=librosa.effects.harmonic(a), sr=SR, hop_length=HOP)
    Cb = librosa.util.sync(C, beats, aggregate=np.median)
    Cb = Cb / (np.linalg.norm(Cb, axis=0, keepdims=True) + 1e-9)
    chg = 1 - np.sum(Cb[:, 1:] * Cb[:, :-1], axis=0)
    S = np.abs(librosa.stft(a, hop_length=HOP))
    out[name] = {
        "声が鳴っている時間の割合(-25dB)": round(float(act.mean()), 2),
        "声/伴奏の音量差 dB(声が鳴っている所)": round(float(20 * np.log10(np.median(rv[act]) / np.median(ra[act]))), 1),
        "声の音域 p5-p95 半音": round(float(np.percentile(m, 95) - np.percentile(m, 5)), 1),
        "声の音域 中央 MIDI": round(float(np.median(m)), 1),
        "伴奏の立ち上がり/秒": round(len(librosa.onset.onset_detect(y=a, sr=SR, hop_length=HOP)) / (n / SR), 2),
        "伴奏のスペクトル重心 中央 Hz": round(float(np.median(librosa.feature.spectral_centroid(S=S, sr=SR)[0]))),
        "伴奏の高域(>4kHz)エネルギー比": round(float(S[librosa.fft_frequencies(sr=SR) > 4000].sum() / S.sum()), 3),
        "伴奏の拍ごとの和声変化(0..1) 中央": round(float(np.median(chg)), 3),
        "伴奏の和声変化が大きい拍(>0.2)の割合": round(float(np.mean(chg > 0.2)), 2),
    }
open("audit_vs_refs.json", "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
