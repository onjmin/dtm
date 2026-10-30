"""録音した伴奏・リードと台詞（voice.wav）を混ぜて song.wav を書き出す。

録音は曲頭の前に少し無音が入るので、台詞の頭をずらして伴奏に合わせる。ずれは伴奏の立ち上がりを16分格子へ畳んだ位相
（重み付きの円周平均）で求め、最初の立ち上がりに近い格子点を選ぶ。合わなければ --offset で秒を渡す。

python mix.py <曲名> [--lead-db 0] [--offset 秒]
入力: <曲>/acc.wav, <曲>/lead.wav, <曲>/voice.wav, <曲>/daw.json  出力: <曲>/song.wav, <曲>/song_inst.wav
"""
import argparse
import json

import librosa
import numpy as np
import soundfile as sf

import config

FS = 44100
LEAD = ("t0", "t1", "t2", "t14")  # rec.html がリードとして別に録るトラック


def estimate_offset(acc, daw):
    six = 15 / daw["bpm"]
    steps = [n["startStep"] for notes in daw["tracks"].values() for n in notes]
    if daw.get("drum", "none") != "none":
        steps.append(0)
    first = min(steps) * six / 12
    y = acc.mean(0)
    env = librosa.onset.onset_strength(y=y, sr=FS, hop_length=256)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=FS, hop_length=256)
    t = fr * 256 / FS
    w = env[fr]
    z = np.sum(w * np.exp(2j * np.pi * t / six))
    phase = (np.angle(z) / (2 * np.pi) % 1) * six
    rough = t[0] - first
    off = phase + six * round((rough - phase) / six)
    return float(off), float(abs(z) / (w.sum() + 1e-9))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--lead-db", type=float, default=0.0, help="リードの音量（伴奏に対する dB）")
    ap.add_argument("--offset", type=float, help="台詞の頭のずれ（秒）。省くと伴奏の位相から求める")
    a = ap.parse_args()
    d = config.OUT_DIR / a.song
    acc, _ = librosa.load(d / "acc.wav", sr=FS, mono=False)
    lead, _ = librosa.load(d / "lead.wav", sr=FS, mono=False)
    acc, lead = np.atleast_2d(acc), np.atleast_2d(lead)
    voice, _ = librosa.load(d / "voice.wav", sr=FS, mono=True)
    if a.offset is None:
        off, conc = estimate_offset(acc, json.loads((d / "daw.json").read_text(encoding="utf-8")))
        print(f"offset {off:.3f}s（位相の集中度 {conc:.2f}。0.5 未満なら --offset で確かめる）")
    else:
        off = a.offset
    # リードは別の録音で頭の遅れが伴奏と違う（0.5〜0.8 秒短いことがある）ので、リードの音符だけで求めて伴奏へそろえる
    daw = json.loads((d / "daw.json").read_text(encoding="utf-8"))
    lead_daw = {**daw, "drum": "none", "tracks": {k: v for k, v in daw["tracks"].items() if k in LEAD and v}}
    if lead_daw["tracks"] and np.abs(lead).max() > 1e-4:
        acc_off = estimate_offset(acc, daw)[0]
        lead_off, lead_conc = estimate_offset(lead, lead_daw)
        sh = int(round((acc_off - lead_off) * FS))
        print(f"lead shift {sh / FS:+.3f}s（位相の集中度 {lead_conc:.2f}）")
        lead = np.pad(lead, ((0, 0), (sh, 0))) if sh >= 0 else lead[:, -sh:]
    n = min(acc.shape[1], lead.shape[1])
    inst = acc[:, :n] + 10 ** (a.lead_db / 20) * lead[:, :n]
    v = np.zeros(n)
    i = int(off * FS)
    m = min(len(voice), n - i)
    v[i:i + m] = voice[:m]
    # 台詞は伴奏より 3dB 上（声のある所の RMS の中央値どうしで）
    win = 2048
    rv = np.sqrt(np.convolve(v ** 2, np.ones(win) / win, mode="same"))
    ri = np.sqrt(np.convolve(inst.mean(0) ** 2, np.ones(win) / win, mode="same"))
    act = rv > 0.1 * rv.max()
    g = 10 ** (3 / 20) * np.median(ri[act]) / (np.median(rv[act]) + 1e-9)
    mix = inst + g * v[None, :]
    sf.write(d / "song.wav", (0.95 * mix / np.abs(mix).max()).T.astype(np.float32), FS)
    sf.write(d / "song_inst.wav", (0.95 * inst / np.abs(inst).max()).T.astype(np.float32), FS)
    print(d / "song.wav", "voice gain", round(float(g), 3))


if __name__ == "__main__":
    main()
