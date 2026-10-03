#!/usr/bin/env python
"""
音声 1 本 → 耳コピ MIDI（正解なし）。分離・採譜の本体で、eval_transcription.py はここを呼んで測る。

    PYTHONIOENCODING=utf-8 python scripts/transcribe/transcribe_audio.py <audio> --out tmp/transcribe/<name>

Demucs で vocals / bass / drums / other に分け、Basic Pitch とドラムのオンセット検出で採譜して
`<out>/transcribed.mid` を書く。上級者モード（15トラック）に載せる前提で、伴奏（other）は重なる音を
別トラックへ振り分けて和音を残す（最大6本）。
精度は PRESETS の注記と docs/transcription-eval.md。出発点として使う。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

SR = 22050
HOP = 256  # 11.6ms @ 22050
MAX_VOICES = 6  # 伴奏の最大トラック数。MML の1トラックは単音なので、重なる音を別トラックへ逃がす
DRUM_PITCH = {"kick": 36, "snare": 38, "hat": 42}
RANGES = {"vocals": (80.0, 1600.0), "bass": (30.0, 500.0), "other": (None, None), "mix": (None, None)}

# しきい値は (onset, frame)。界隈曲 5曲（docs/transcription-eval.md）で選び、別の 5曲で確かめた。
# しきい値を下げても弱い音は増えず幻の音が増える（0.3/0.2 で歌 F1 0.48→0.36）。
PRESETS: dict[str, dict] = {
    "v1": {"model": "htdemucs", "th": {k: (0.5, 0.3) for k in RANGES}, "gate_db": None},
    "v2": {
        "model": "htdemucs_ft",
        "th": {"vocals": (0.6, 0.4), "bass": (0.7, 0.4), "other": (0.7, 0.3), "mix": (0.7, 0.3)},
        # 系統の最大から -40dB 未満で鳴る音は分離の漏れ。-50〜-30dB のどこでも同じ値なので境界は鈍い
        "gate_db": -40.0,
    },
}
DEFAULT_PRESET = "v2"


def log(*a: object) -> None:
    print(*a, flush=True)


def separate(audio: str, out_dir: Path, device: str, force: bool, model: str = "htdemucs") -> dict[str, Path]:
    stems = {k: out_dir / f"{k}.wav" for k in ("vocals", "drums", "bass", "other")}
    if not force and all(p.exists() for p in stems.values()):
        return stems
    import random

    import torch
    from demucs.api import Separator, save_audio

    # shifts=1 は乱数でずらすので、固定しないと --force のたびに小数3桁が動く
    random.seed(0)
    torch.manual_seed(0)
    sep = Separator(model=model, device=device, shifts=1, overlap=0.25, progress=False)
    _, separated = sep.separate_audio_file(Path(audio))
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, src in separated.items():
        save_audio(src, str(stems[name]), samplerate=sep.samplerate)
    return stems


def gate_quiet(notes: list, path: Path, db: float) -> list:
    """系統の最大音量から db 未満の区間で鳴る音を落とす（分離の漏れ・無音区間の幻）。"""
    import librosa

    y, _ = librosa.load(str(path), sr=16000, mono=True)
    r = librosa.feature.rms(y=y, frame_length=1024, hop_length=160)[0]  # 10ms
    level = 20 * np.log10(r + 1e-9)
    level -= level.max()
    out = []
    for s, e, p in notes:
        a = int(s * 100)
        seg = level[a : max(a + 1, int(e * 100))]
        if len(seg) and np.median(seg) >= db:
            out.append((s, e, p))
    return out


def transcribe_pitched(
    path: Path, kind: str, cache: Path, force: bool, onset: float = 0.5, frame: float = 0.3, gate_db: float | None = None
) -> list[tuple[float, float, int]]:
    """Basic Pitch。戻り値は (開始秒, 終了秒, MIDI音高)。"""
    if cache.exists() and not force:
        return [tuple(x) for x in json.load(open(cache, encoding="utf-8"))]
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    lo, hi = RANGES[kind]
    kw: dict = {"onset_threshold": onset, "frame_threshold": frame, "minimum_note_length": 58.0, "melodia_trick": True}
    if lo is not None:
        kw.update(minimum_frequency=lo, maximum_frequency=hi)
    _, _, events = predict(str(path), ICASSP_2022_MODEL_PATH, **kw)
    notes = sorted((float(s), float(e), int(p)) for s, e, p, _amp, _bends in events)
    if gate_db is not None:
        notes = gate_quiet(notes, path, gate_db)
    json.dump(notes, open(cache, "w", encoding="utf-8"))
    return notes


def transcribe_drums(path: Path, cache: Path, force: bool) -> dict[str, np.ndarray]:
    """ドラム系統のオンセットを検出し、帯域のエネルギー比でキック／スネア／ハイハットに分ける。"""
    if cache.exists() and not force:
        d = json.load(open(cache, encoding="utf-8"))
        return {k: np.array(v) for k, v in d.items()}
    import librosa
    from scipy.signal import butter, sosfiltfilt

    y, sr = librosa.load(str(path), sr=SR, mono=True)
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    frames = librosa.onset.onset_detect(
        onset_envelope=env, sr=sr, hop_length=HOP, backtrack=False, delta=0.07, wait=2
    )
    times = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    lo = sosfiltfilt(butter(4, 150, "lowpass", fs=sr, output="sos"), y)
    mid = sosfiltfilt(butter(4, [200, 3000], "bandpass", fs=sr, output="sos"), y)
    hi = sosfiltfilt(butter(4, 6000, "highpass", fs=sr, output="sos"), y)
    win = int(0.03 * sr)

    def energies(t: float) -> tuple[float, float, float]:
        i = int(t * sr)
        seg = slice(i, i + win)
        return (
            float(np.sum(lo[seg] ** 2)) + 1e-12,
            float(np.sum(mid[seg] ** 2)) + 1e-12,
            float(np.sum(hi[seg] ** 2)) + 1e-12,
        )

    # **打点は元の音で取り、分類は多重ラベルにする。** 4つ打ちではクラップ・ハットがキックと同時に鳴るので、
    # 1つの打点に1つの分類を付ける方式だと同時打ちの片方が必ず落ちる。帯域ごとに打点を取り直すと
    # 低域の包絡がなまってタイミングが 50ms 以上ずれる（実測でキック F1 0.96→0.71）ので、打点は共通にする。
    # 低域が中高域の 3 割以上あればキック、中域が低域より大きければスネア／クラップ、高域が中域の 6 割以上ならハイハット。
    kick, snare, hat = [], [], []
    for t in times:
        e_lo, e_mid, e_hi = energies(t)
        if e_lo > 0.3 * (e_mid + e_hi):
            kick.append(t)
        if e_mid > e_lo:
            snare.append(t)
        if e_hi > 0.6 * e_mid:
            hat.append(t)
    d = {"all": times, "kick": np.array(kick), "snare": np.array(snare), "hat": np.array(hat)}
    json.dump({k: [float(x) for x in v] for k, v in d.items()}, open(cache, "w", encoding="utf-8"))
    return d


def transcribe(audio: str, out: Path, device: str, force: bool, preset: str = DEFAULT_PRESET, with_mix: bool = False) -> dict:
    """分離→採譜。戻り値は {"stems", "vocals", "bass", "other", ("mix",) "drums"}。キャッシュは preset ごとに分ける。"""
    cfg = PRESETS[preset]
    out.mkdir(parents=True, exist_ok=True)
    stems = separate(audio, out / f"stems_{cfg['model']}", device, force, cfg["model"])
    res: dict = {"stems": stems}
    srcs = {k: stems[k] for k in ("vocals", "bass", "other")}
    if with_mix:
        srcs["mix"] = Path(audio)
    for kind, path in srcs.items():
        on, fr = cfg["th"][kind]
        gate = cfg["gate_db"] if kind != "mix" else None
        res[kind] = transcribe_pitched(path, kind, out / f"notes_{preset}_{kind}.json", force, on, fr, gate)
    res["drums"] = transcribe_drums(stems["drums"], out / f"drums_{cfg['model']}.json", force)
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--preset", default=DEFAULT_PRESET, choices=list(PRESETS))
    a = ap.parse_args()

    import librosa
    import pretty_midi

    out = Path(a.out)
    r = transcribe(a.audio, out, a.device, a.force, a.preset)

    y, sr = librosa.load(a.audio, sr=SR, mono=True)
    tempo = float(np.atleast_1d(librosa.feature.tempo(y=y, sr=sr, hop_length=HOP, start_bpm=120))[0])
    log(f"推定テンポ {tempo:.1f} BPM")

    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo)

    def add(name: str, program: int, ns: list) -> None:
        inst = pretty_midi.Instrument(program=program, name=name)
        for s, e, p in ns:
            inst.notes.append(pretty_midi.Note(velocity=96, pitch=int(p), start=float(s), end=float(max(e, s + 0.03))))
        pm.instruments.append(inst)
        log(f"{name}: {len(ns)} 音")

    add("vocals", 80, r["vocals"])
    add("bass", 38, r["bass"])
    voices: list[list] = []
    for n in sorted(r["other"]):
        for v in voices:
            if v[-1][1] <= n[0] + 0.01:
                v.append(n)
                break
        else:
            if len(voices) < MAX_VOICES:
                voices.append([n])
    for i, v in enumerate(voices):
        add(f"other-{i}", 0 if i % 2 == 0 else 4, v)

    d = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    for kind, pitch in DRUM_PITCH.items():
        for t in r["drums"][kind]:
            d.notes.append(pretty_midi.Note(velocity=100, pitch=pitch, start=float(t), end=float(t) + 0.05))
    pm.instruments.append(d)
    log(f"drums: {len(d.notes)} 打点")

    pm.write(str(out / "transcribed.mid"))
    log(f"書き出し: {out / 'transcribed.mid'}")


if __name__ == "__main__":
    main()
