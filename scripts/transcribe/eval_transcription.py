#!/usr/bin/env python
"""
自動採譜（耳コピ）の評価実験。

音声（mp3/wav）を transcribe_audio.py の分離・採譜（Demucs → Basic Pitch。ドラムはオンセット検出＋帯域分類）に
掛け、**人力の耳コピ MIDI を正解**にしてパートごとの音符一致率（F1）を出す。

    # 1. 音声と耳コピ MIDI の対応表を作り、完成度（長さの比・音数・ドラムの有無）で並べる
    python scripts/transcribe/eval_transcription.py inventory \
        --audio "C:/Users/frgk2/Music/_own/他作/界隈曲" --midi "C:/Users/frgk2/Music/_own/自作/界隈曲" \
        --out tmp/transcribe-eval

    # 2. 対応表（JSON。inventory が書く candidates.json から選ぶ）で評価を回す
    python scripts/transcribe/eval_transcription.py run --pairs tmp/transcribe-eval/pairs.json --out tmp/transcribe-eval

    # 3. 方式（transcribe_audio.PRESETS）を変えて同じ曲で比べる。結果は summary-<preset>.md に分かれる
    python scripts/transcribe/eval_transcription.py run --pairs tmp/transcribe-eval/pairs.json --out tmp/transcribe-eval --preset v1

## 正解側の扱い

- 耳コピ MIDI はテンポも小節頭も音声と一致している保証が無い（DAW の既定テンポのまま書かれた
  ものが混ざる）。そこで **MIDI の全オンセットを音声のオンセット強度と相互相関で合わせ**、
  時間の倍率（±3%）とずれ（±20秒）を曲ごとに推定してから比べる。倍率が 1 から離れた曲は
  「MIDI のテンポが実際と違う」曲なので、報告に倍率を出す。
- 正解のパート分け（主旋律・ベース・その他・ドラム）はトラック名に頼らず規則で決める
  （主旋律＝単旋律で鳴っている時間が最長、ベース＝音高中央値が最低）。選んだトラック名を
  報告に出すので、外れていたら手で直す。

## 指標

- 音符 F1（mir_eval.transcription）: オンセット ±50ms・音高 ±50セント、オフセットは見ない。
- クロマ F1: 同じ条件でオクターブを無視する（オクターブ誤りの量が分かる）。
- ドラム: オンセット F1（±50ms）。全打点と、キック／スネア（クラップ含む）／ハイハットの3分類。
- テンポ・調・小節ごとの三和音の一致率。三和音の正解は MIDI から同じ規則で推定した値なので、
  ここだけは「正解」も推定を含む。

## 前提

pip: demucs basic-pitch mir_eval pretty_midi librosa soundfile。ffmpeg が PATH にあること。
Windows のコンソールで日本語を出すときは PYTHONIOENCODING=utf-8。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from transcribe_audio import DEFAULT_PRESET, HOP, PRESETS, SR, log, transcribe  # noqa: E402

# ============================================================
# 共通
# ============================================================

ONSET_TOL = 0.05
PITCH_TOL_CENTS = 50.0

KICK = {35, 36}
SNARE = {37, 38, 40, 39}  # 界隈曲はクラップがスネアの代わりに置かれるので同じ組に入れる
HAT = {42, 44, 46}


def norm_title(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[\s\u3000_\-–—・･.。、,，!！?？「」『』【】\[\]()（）'\"]", "", s)
    return s.lower()


def ffprobe_duration(path: str) -> float | None:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True,
        text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


# ============================================================
# 正解（耳コピ MIDI）
# ============================================================


PERC_NAME = re.compile(r"(drum|perc|ドラム|パーカス|打楽器)", re.I)
VOCAL_NAME = re.compile(r"(vocal|\bvo\b|vo_|voice|ウタ|うた|歌|ボーカル|ボイス|メロ|melo|lead|リード|主旋律|main)", re.I)
# 声もの全部（リードに加えてハモリ・コーラス・2本目の歌。音源分離では全部 vocals 側へ行く）
VOICE_GROUP_NAME = re.compile(
    r"(vocal|\bvo\b|vo_|voice|ウタ|うた|歌|ボーカル|ボイス|メロ|melo|主旋律|副旋律|chorus|コーラス|ハモ|harm|鳴花|ミク|テト|ずんだ|号)",
    re.I,
)
NOT_VOCAL_NAME = re.compile(r"(chorus|コーラス|ハモ|harm|sub|サブ|intro|イントロ|2|３|3)", re.I)


def decode_track_name(name: str) -> str:
    """pretty_midi は latin-1 で読むので、Shift_JIS のトラック名は化ける。戻せるなら戻す。"""
    try:
        raw = name.encode("latin-1")
    except UnicodeEncodeError:
        return name
    for enc in ("cp932", "utf-8"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return name


def midi_stats(path: str) -> dict:
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(path)
    notes = sum(len(i.notes) for i in pm.instruments)
    drums = sum(len(i.notes) for i in pm.instruments if i.is_drum)
    tracks = len([i for i in pm.instruments if len(i.notes) > 0])
    _, tempi = pm.get_tempo_changes()
    return {
        "notes": notes,
        "drumNotes": drums,
        "tracks": tracks,
        "dur": round(float(pm.get_end_time()), 2),
        "bpm": round(float(tempi[0]), 3) if len(tempi) else None,
        "tempoChanges": int(len(tempi)),
        "size": os.path.getsize(path),
    }


def load_ground_truth(path: str) -> dict:
    """耳コピ MIDI をパートへ分ける。時間は MIDI 自身のテンポで秒にしたもの（位置合わせ前）。"""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(path)
    end = float(pm.get_end_time())
    _, tempi = pm.get_tempo_changes()
    bpm = float(tempi[0]) if len(tempi) else 120.0

    drums: list[tuple[float, int]] = []
    pitched: list[dict] = []
    percussive: list[dict] = []
    for idx, inst in enumerate(pm.instruments):
        if len(inst.notes) == 0:
            continue
        if inst.is_drum:
            drums.extend((float(n.start), int(n.pitch)) for n in inst.notes)
            continue
        name = decode_track_name(inst.name)
        # 打楽器を音程トラックに書いたもの（Agogo/Woodblock/Taiko 等、名前が Drum）は音程の正解にしない
        if inst.program in (113, 115, 116, 117, 118, 119) or PERC_NAME.search(name):
            percussive.append({"index": idx, "name": name, "program": int(inst.program), "count": len(inst.notes)})
            continue
        ns = sorted(((float(n.start), float(n.end), int(n.pitch)) for n in inst.notes), key=lambda x: x[0])
        # 単旋律の度合い: 同時に始まる音（±10ms）の割合
        starts = np.array([n[0] for n in ns])
        same = np.sum(np.abs(np.diff(starts)) < 0.01)
        poly_ratio = float(same / max(1, len(ns) - 1))
        # 鳴っている時間（区間の和集合）
        covered = 0.0
        cur_s, cur_e = ns[0][0], ns[0][1]
        for s, e, _ in ns[1:]:
            if s <= cur_e:
                cur_e = max(cur_e, e)
            else:
                covered += cur_e - cur_s
                cur_s, cur_e = s, e
        covered += cur_e - cur_s
        pitches = np.array([n[2] for n in ns])
        leaps = np.abs(np.diff(pitches))
        big_leap = float(np.mean(leaps > 12)) if len(leaps) else 0.0
        pitched.append(
            {
                "index": idx,
                "name": name,
                "program": int(inst.program),
                "notes": ns,
                "count": len(ns),
                "polyRatio": poly_ratio,
                "coverage": covered / max(end, 1e-6),
                "medianPitch": float(np.median(pitches)),
                "bigLeap": big_leap,
                "notesPerSec": len(ns) / max(end, 1e-6),
            }
        )

    # 主旋律: 単旋律（同時発音 <15%）・大跳躍が少ない・歌える高さ・鳴っている時間が最長
    def melody_ok(t: dict) -> bool:
        return (
            t["polyRatio"] < 0.15
            and t["bigLeap"] < 0.2
            and 52 <= t["medianPitch"] <= 88
            and t["coverage"] >= 0.2
            and t["notesPerSec"] <= 9
        )

    # トラック名に歌を示す語があればそれを優先する（コーラス・ハモリは除く）。無ければ規則で選ぶ。
    named = [
        t
        for t in pitched
        if VOCAL_NAME.search(t["name"]) and not NOT_VOCAL_NAME.search(t["name"]) and t["coverage"] >= 0.15
    ]
    named.sort(key=lambda t: -t["coverage"])
    mel_cands = named if named else sorted([t for t in pitched if melody_ok(t)], key=lambda t: -t["coverage"])
    melody = mel_cands[0] if mel_cands else None
    melody_how = "name" if named else "rule"
    # ベース: 音高中央値が最低。被覆 20% 以上・50音以上
    bass_cands = sorted(
        [t for t in pitched if t["coverage"] >= 0.2 and t["count"] >= 50 and t is not melody],
        key=lambda t: t["medianPitch"],
    )
    bass = bass_cands[0] if bass_cands and bass_cands[0]["medianPitch"] <= 55 else None
    voice_group = [t for t in pitched if t is melody or (VOICE_GROUP_NAME.search(t["name"]) and t is not bass)]
    others = [t for t in pitched if t is not melody and t is not bass]
    inst = [t for t in others if t not in voice_group]

    def flat(ts: list[dict]) -> list[tuple[float, float, int]]:
        out: list[tuple[float, float, int]] = []
        for t in ts:
            out.extend(t["notes"])
        return sorted(out)

    return {
        "bpm": bpm,
        "end": end,
        "drums": sorted(drums),
        "melody": melody["notes"] if melody else [],
        "bass": bass["notes"] if bass else [],
        "other": flat(others),
        "voiceGroup": flat(voice_group),
        "inst": flat(inst),
        "all": flat(pitched),
        "tracks": [
            {
                "index": t["index"],
                "name": t["name"],
                "program": t["program"],
                "count": t["count"],
                "poly": round(t["polyRatio"], 3),
                "coverage": round(t["coverage"], 3),
                "medianPitch": t["medianPitch"],
                "role": "melody" if t is melody else "bass" if t is bass else "voice" if t in voice_group else "other",
            }
            for t in pitched
        ],
        "melodyCandidates": [(t["name"], round(t["coverage"], 3)) for t in mel_cands[:3]],
        "melodyHow": melody_how,
        "percussiveTracks": percussive,
        "pitchedTracks": [
            {"index": t["index"], "name": t["name"], "notes": t["notes"], "medianPitch": t["medianPitch"]} for t in pitched
        ],
    }


# ============================================================
# 位置合わせ（MIDI 時間 → 音声時間）
# ============================================================


def onset_envelope(y: np.ndarray, sr: int, hop: int) -> np.ndarray:
    import librosa

    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    env = env - np.median(env)
    env[env < 0] = 0
    return env / (np.max(env) + 1e-9)


def align_midi_to_audio(gt_onsets: np.ndarray, env: np.ndarray, sr: int, hop: int) -> dict:
    """倍率 s とずれ d を、MIDI のオンセット列（インパルス）と音声のオンセット強度の相互相関で決める。
    t_audio = s * t_midi + d。"""
    from scipy.signal import fftconvolve

    frame = hop / sr
    n = len(env)
    # ずれの探索幅（秒）。曲頭の無音や、MIDI が1小節目から始まっている分を吸収する。
    max_shift = int(20 / frame)
    best = {"scale": 1.0, "offset": 0.0, "corr": -1.0}
    kernel = np.exp(-0.5 * (np.arange(-3, 4) / 1.0) ** 2)
    kernel /= kernel.sum()
    env_c = env - env.mean()
    env_norm = np.linalg.norm(env_c) + 1e-9
    for s in np.round(np.arange(0.97, 1.0301, 0.001), 4):
        pos = np.round(gt_onsets * s / frame).astype(int)
        L = n + 2 * max_shift
        imp = np.zeros(L)
        pos = pos + max_shift
        pos = pos[(pos >= 0) & (pos < L)]
        np.add.at(imp, pos, 1.0)
        imp = np.convolve(imp, kernel, mode="same")
        imp_c = imp - imp.mean()
        # 相関: env を imp 上でずらす
        corr = fftconvolve(imp_c, env_c[::-1], mode="valid")  # 長さ 2*max_shift+1
        k = int(np.argmax(corr))
        val = float(corr[k] / (env_norm * (np.linalg.norm(imp_c) + 1e-9)))
        # imp の位置 = pos + max_shift。env の frame i が imp の frame (i + k) に対応
        # → MIDI 時間 t は音声時間 (t*s + max_shift*frame) - k*frame
        offset = (max_shift - k) * frame
        if val > best["corr"]:
            best = {"scale": float(s), "offset": float(offset), "corr": val}
    return best


def chroma_frames(y: np.ndarray, sr: int, hop: int) -> np.ndarray:
    import librosa

    c = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    c = c - c.mean(axis=0, keepdims=True)
    return c


def align_by_chroma(notes: list, audio_chroma: np.ndarray, sr: int, hop: int) -> dict:
    """倍率 s・ずれ d・移調 k（半音、0〜11）を、正解の音符から作ったクロマ列と音声のクロマ列の
    相互相関で決める。オンセットだけの合わせ方と違い、**MIDI が音源と別の調で書かれていても**合う。
    t_audio = s * t_midi + d、音高 = MIDI の音高 + k（mod 12）。"""
    from scipy.signal import fftconvolve

    frame = hop / sr
    n = audio_chroma.shape[1]
    max_shift = int(20 / frame)
    L = n + 2 * max_shift
    a_norm = np.linalg.norm(audio_chroma) + 1e-9
    best = {"scale": 1.0, "offset": 0.0, "shift": 0, "corr": -1.0}
    for sc in np.round(np.arange(0.97, 1.0301, 0.001), 4):
        g = np.zeros((12, L))
        for st, en, pch in notes:
            f0 = int(round(st * sc / frame)) + max_shift
            f1 = int(round(en * sc / frame)) + max_shift
            if f1 <= f0:
                f1 = f0 + 1
            if f0 < 0 or f0 >= L:
                continue
            g[int(pch) % 12, f0 : min(f1, L)] += 1.0
        g = g - g.mean(axis=0, keepdims=True)
        g_norm = np.linalg.norm(g) + 1e-9
        for k in range(12):
            gk = np.roll(g, k, axis=0)
            corr = np.zeros(2 * max_shift + 1)
            for b in range(12):
                corr += fftconvolve(gk[b], audio_chroma[b][::-1], mode="valid")
            i = int(np.argmax(corr))
            val = float(corr[i] / (a_norm * g_norm))
            if val > best["corr"]:
                best = {"scale": float(sc), "offset": float((max_shift - i) * frame), "shift": k, "corr": val}
    if best["shift"] > 6:
        best["shift"] -= 12
    return best


def refine_offset(onsets_scaled: np.ndarray, env: np.ndarray, sr: int, hop: int, center: float, radius: float) -> float:
    """ずれ d を center±radius の範囲で 1 フレーム刻みに探し、打点インパルス列と打点包絡の相関が最大の d を返す。"""
    frame = hop / sr
    n = len(env)
    kernel = np.exp(-0.5 * (np.arange(-2, 3) / 1.0) ** 2)
    best_d, best_v = center, -1.0
    for d in np.arange(center - radius, center + radius + 1e-9, frame):
        pos = np.round((onsets_scaled + d) / frame).astype(int)
        pos = pos[(pos >= 0) & (pos < n)]
        imp = np.zeros(n)
        np.add.at(imp, pos, 1.0)
        imp = np.convolve(imp, kernel, mode="same")
        v = float(np.dot(imp, env) / (np.linalg.norm(imp) * np.linalg.norm(env) + 1e-9))
        if v > best_v:
            best_d, best_v = float(d), v
    return best_d


# ============================================================
# 指標
# ============================================================


def hz(p: np.ndarray) -> np.ndarray:
    return 440.0 * 2 ** ((p - 69) / 12)


def note_f1(ref: list, est: list, chroma: bool = False) -> dict:
    import mir_eval

    if len(ref) == 0:
        return {"P": 0.0, "R": 0.0, "F": 0.0, "nRef": 0, "nEst": len(est)}
    r = np.array(ref, dtype=float)
    ri = np.stack([r[:, 0], np.maximum(r[:, 1], r[:, 0] + 0.001)], axis=1)
    rp = r[:, 2]
    if len(est) == 0:
        return {"P": 0.0, "R": 0.0, "F": 0.0, "nRef": len(ref), "nEst": 0}
    e = np.array(est, dtype=float)
    ei = np.stack([e[:, 0], np.maximum(e[:, 1], e[:, 0] + 0.001)], axis=1)
    ep = e[:, 2]
    if chroma:
        rp = 60 + (rp % 12)
        ep = 60 + (ep % 12)
    P, R, F, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ri, hz(rp), ei, hz(ep), onset_tolerance=ONSET_TOL, pitch_tolerance=PITCH_TOL_CENTS, offset_ratio=None
    )
    return {"P": round(float(P), 3), "R": round(float(R), 3), "F": round(float(F), 3), "nRef": len(ref), "nEst": len(est)}


def onset_f1(ref: np.ndarray, est: np.ndarray) -> dict:
    import mir_eval

    if len(ref) == 0:
        return {"P": 0.0, "R": 0.0, "F": 0.0, "nRef": 0, "nEst": int(len(est))}
    if len(est) == 0:
        return {"P": 0.0, "R": 0.0, "F": 0.0, "nRef": int(len(ref)), "nEst": 0}
    F, P, R = mir_eval.onset.f_measure(np.sort(ref), np.sort(est), window=ONSET_TOL)
    return {"P": round(float(P), 3), "R": round(float(R), 3), "F": round(float(F), 3), "nRef": int(len(ref)), "nEst": int(len(est))}


KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def key_from_chroma(ch: np.ndarray) -> tuple[int, str]:
    best, out = -2.0, (0, "major")
    for mode, prof in (("major", KS_MAJOR), ("minor", KS_MINOR)):
        for k in range(12):
            c = np.corrcoef(np.roll(prof, k), ch)[0, 1]
            if c > best:
                best, out = c, (k, mode)
    return out


def chroma_of_notes(notes: list, t0: float, t1: float) -> np.ndarray:
    ch = np.zeros(12)
    for s, e, p in notes:
        a, b = max(s, t0), min(e, t1)
        if b > a:
            ch[int(p) % 12] += b - a
    return ch


def triad_of_chroma(ch: np.ndarray) -> tuple[int, str] | None:
    if ch.sum() <= 0:
        return None
    ch = ch / ch.sum()
    best, out = -1.0, None
    for root in range(12):
        for q, iv in (("maj", (0, 4, 7)), ("min", (0, 3, 7))):
            tmpl = np.zeros(12)
            for i in iv:
                tmpl[(root + i) % 12] = 1
            score = float(np.dot(ch, tmpl)) - 0.5 * float(np.dot(ch, 1 - tmpl))
            if score > best:
                best, out = score, (root, q)
    return out


# ============================================================
# 対応表
# ============================================================


def cmd_inventory(args: argparse.Namespace) -> None:
    audio_root, midi_root = Path(args.audio), Path(args.midi)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    audios = []
    for p in audio_root.rglob("*"):
        if p.suffix.lower() in (".mp3", ".wav", ".flac", ".m4a", ".ogg"):
            audios.append({"path": str(p), "rel": str(p.relative_to(audio_root)), "dur": ffprobe_duration(str(p))})
    bad_words = ("カバー", "cover", "arrange", "アレンジ", "歌ってみた", "inst", "remix", "short", "模倣")
    rows = []
    for p in midi_root.rglob("*.mid"):
        rel = p.relative_to(midi_root)
        parts = rel.parts
        if "History" in parts:
            continue
        stem = p.stem.lower()
        if any(w in stem for w in ("gomi", "cookie", "piano", "muted", "_base", "_drum", "_dram", "_other", "arpeggio", "sabi", "imported", "short", "omit", "mod", "split")):
            continue
        # 曲名フォルダ。日付だけのフォルダ（220310 など）は版の区別なので、その上を曲名にする
        dirs = [d for d in parts[:-1] if not re.fullmatch(r"[\d_]+", d)]
        title = dirs[-1] if dirs else p.stem
        artist = dirs[0] if len(dirs) >= 2 else ""
        try:
            st = midi_stats(str(p))
        except Exception as e:  # noqa: BLE001
            continue
        nt = norm_title(title)
        cands = [a for a in audios if nt and nt in norm_title(Path(a["rel"]).stem)]
        if not cands:
            continue

        def rank(a: dict) -> tuple:
            name = a["rel"].lower()
            penalty = sum(w in name for w in bad_words)
            same_artist = 0 if artist and norm_title(artist) in norm_title(a["rel"]) else 1
            return (penalty, same_artist, len(name))

        a = sorted(cands, key=rank)[0]
        ratio = st["dur"] / a["dur"] if a["dur"] else None
        rows.append(
            {
                "title": title,
                "artist": artist,
                "midi": str(p),
                "audio": a["path"],
                "audioRel": a["rel"],
                "audioDur": round(a["dur"], 1) if a["dur"] else None,
                "ratio": round(ratio, 3) if ratio else None,
                # 完成度: 音数とドラムの有無を主に、長さの比は 0.9〜1.2 まで許す（MIDI が既定テンポのまま書かれた
                # 完成品を落とさない）。0.95〜1.05 の外は警告として残す
                "complete": bool(ratio and 0.9 <= ratio <= 1.2 and st["drumNotes"] > 100 and st["notes"] >= 1000),
                "ratioWarn": bool(ratio and not (0.95 <= ratio <= 1.05)),
                "sameArtist": bool(artist and norm_title(artist) in norm_title(a["rel"])),
                "mtime": int(p.stat().st_mtime),
                **st,
            }
        )
    rows.sort(key=lambda r: (not r["complete"], -(r["notes"])))
    json.dump(rows, open(out / "candidates.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"{'complete':8} {'ratio':>7} {'notes':>6} {'drum':>5} {'tr':>3} {'bpm':>6}  title  <-  audio   (ratio の * は 0.95〜1.05 の外、audio の ? は作者名が一致しない対応)")
    for r in rows:
        log(
            f"{'OK' if r['complete'] else '-':8} {r['ratio'] or 0:>6.3f}{'*' if r['ratioWarn'] else ' '} {r['notes']:>6} {r['drumNotes']:>5} {r['tracks']:>3} {r['bpm'] or 0:>6.1f}  {r['artist']}/{r['title']}  <-  {'' if r['sameArtist'] or not r['artist'] else '? '}{r['audioRel']}"
        )
    log(f"wrote {out / 'candidates.json'} ({len(rows)} pairs, {sum(r['complete'] for r in rows)} complete)")


# ============================================================
# 評価
# ============================================================


def evaluate_pair(pair: dict, out_root: Path, device: str, force: bool, preset: str) -> dict:
    import librosa
    import pretty_midi

    name = pair["name"]
    out = out_root / name
    out.mkdir(parents=True, exist_ok=True)
    log(f"=== {name}")
    gt = load_ground_truth(pair["midi"])
    log(f"  GT tracks: " + "; ".join(f"{t['role']}:{t['name'] or '(no name)'}#{t['index']}(p{t['program']},n{t['count']},cov{t['coverage']})" for t in gt["tracks"]))

    # --- 位置合わせ ---
    y, sr = librosa.load(pair["audio"], sr=SR, mono=True)
    env = onset_envelope(y, sr, HOP)
    gt_onsets = np.array([t for t, _ in gt["drums"]] + [s for s, _, _ in gt["all"]])
    al_onset = align_midi_to_audio(gt_onsets, env, sr, HOP)
    al = align_by_chroma(gt["all"], chroma_frames(y, sr, HOP), sr, HOP)
    # クロマは音高の変わり目でしか時刻を決められず数十msぶれる。倍率と移調はクロマの値を採り、
    # ずれだけを打点包絡との相関で ±0.25 秒の範囲で詰め直す（採譜結果は使わない）
    al["offsetCoarse"] = al["offset"]
    # 探索幅は16分音符の半分未満にする。広いと打点包絡の周期性で隣の拍へ飛ぶ（実測: 144bpm の曲で ±0.25 秒だと 0.18 秒ずれた）
    sixteenth = 60 / (gt["bpm"] / al["scale"]) / 4
    al["offset"] = refine_offset(gt_onsets * al["scale"], env, sr, HOP, al["offset"], min(0.08, 0.45 * sixteenth))
    s, d, kshift = al["scale"], al["offset"], al["shift"]
    log(
        f"  align(chroma): scale={s:.4f} offset={d:+.3f}s shift={kshift:+d} corr={al['corr']:.3f} | (onset): scale={al_onset['scale']:.4f} offset={al_onset['offset']:+.3f}s corr={al_onset['corr']:.3f}  (audio {len(y)/sr:.1f}s, midi {gt['end']:.1f}s)"
    )

    def A(notes: list) -> list:
        # 位置合わせで曲頭より前へ出た音符（音声に存在しない）は落とす。移調ずれは正解へ掛ける
        out = [(st * s + d, en * s + d, p + kshift) for st, en, p in notes]
        return [(a, b, p) for a, b, p in out if a >= 0]

    gt_a = {k: A(gt[k]) for k in ("melody", "bass", "other", "voiceGroup", "inst", "all")}
    gt_drums = [(t * s + d, p) for t, p in gt["drums"] if t * s + d >= 0]
    gt_drums_t = np.array([t for t, _ in gt_drums])
    gt_kick = np.array([t for t, p in gt_drums if p in KICK])
    gt_snare = np.array([t for t, p in gt_drums if p in SNARE])
    gt_hat = np.array([t for t, p in gt_drums if p in HAT])

    # --- 分離・採譜 ---
    est = transcribe(pair["audio"], out, device, force, preset, with_mix=True)
    stems, dr = est["stems"], est["drums"]
    est["stems_union"] = sorted(est["vocals"] + est["bass"] + est["other"])

    # --- 指標 ---
    res: dict = {
        "name": name,
        "preset": preset,
        "audio": pair["audio"],
        "midi": pair["midi"],
        "align": al,
        "alignOnset": al_onset,
        "gtTracks": gt["tracks"],
        "melodyCandidates": gt["melodyCandidates"],
        "melody": note_f1(gt_a["melody"], est["vocals"]),
        "melodyChroma": note_f1(gt_a["melody"], est["vocals"], chroma=True),
        "bass": note_f1(gt_a["bass"], est["bass"]),
        "bassChroma": note_f1(gt_a["bass"], est["bass"], chroma=True),
        "voiceGroup": note_f1(gt_a["voiceGroup"], est["vocals"]),
        "voiceGroupChroma": note_f1(gt_a["voiceGroup"], est["vocals"], chroma=True),
        "other": note_f1(gt_a["inst"], est["other"]),
        "otherChroma": note_f1(gt_a["inst"], est["other"], chroma=True),
        "allStems": note_f1(gt_a["all"], est["stems_union"]),
        "allMix": note_f1(gt_a["all"], est["mix"]),
        "allMixChroma": note_f1(gt_a["all"], est["mix"], chroma=True),
        "drumsAll": onset_f1(gt_drums_t, dr["all"]),
        "kick": onset_f1(gt_kick, dr["kick"]),
        "snare": onset_f1(gt_snare, dr["snare"]),
        "hat": onset_f1(gt_hat, dr["hat"]),
    }

    # --- 診断 ---
    # 主旋律の正解が、どの系統の採譜にいちばん載っているか（歌声が vocals に分離されなかった曲を見つける）
    res["melodyByStem"] = {k: note_f1(gt_a["melody"], est[k])["F"] for k in ("vocals", "other", "mix", "bass")}
    # vocals 系統の採譜に最も合う正解トラック（正解のパート分けが外れていないかの検算）
    best_track = None
    for t in gt["pitchedTracks"]:
        f = note_f1(A(t["notes"]), est["vocals"])["F"]
        if best_track is None or f > best_track[1]:
            best_track = (f"#{t['index']} {t['name']}", f)
    res["vocalsBestTrack"] = best_track
    res["melodyHow"] = gt["melodyHow"]
    res["percussiveTracks"] = gt["percussiveTracks"]
    # 移調の検算: 位置合わせが選んだ移調 k を掛けた正解に対し、さらに半音ずらして全音符クロマ F1 が上がらないか
    tr = {}
    for k in range(-6, 6):
        shifted = [(a, b, p + k) for a, b, p in gt_a["all"]]
        tr[k] = note_f1(shifted, est["stems_union"], chroma=True)["F"]
    best_k = max(tr, key=tr.get)
    res["transpose"] = {"applied": kshift, "bestExtraShift": best_k, "F_at_best": tr[best_k], "F_at_0": tr[0]}
    # ドラム: 正解の音番号ごとに、推定のどの分類に最も合うか（曲ごとに音番号の割り当てが違うため）
    from collections import Counter

    per_pitch = []
    for p, cnt in Counter(p for _, p in gt_drums).most_common():
        if cnt < 30:
            continue
        ts = np.array([t for t, q in gt_drums if q == p])
        scores = {cls: onset_f1(ts, dr[cls])["F"] for cls in ("kick", "snare", "hat")}
        cls = max(scores, key=scores.get)
        per_pitch.append({"pitch": p, "count": cnt, "bestClass": cls, "F": scores[cls]})
    res["drumsPerPitch"] = per_pitch
    # 全打点 F1 を読むための基準。正解の打点は16分格子に張り付いていて密なので、
    # (1) 同数の一様乱数＝偶然の水準、(2) 8分音符のメトロノーム＝4つ打ちなら何もしなくても出る水準、
    # (3) 同時打ち（キック＋ハット）は onset F1 が 1対1 対応なので上限＝固有時刻数÷打点数。
    gt_bpm_audio = gt["bpm"] / s
    dur_s = len(y) / sr
    rng = np.random.default_rng(0)
    res["drumsAllChance"] = round(
        float(np.mean([onset_f1(gt_drums_t, np.sort(rng.uniform(0, dur_s, len(dr["all"]))))["F"] for _ in range(20)])), 3
    )
    metro = np.arange(d, dur_s, 60 / gt_bpm_audio / 2)
    res["drumsAllMetronome"] = onset_f1(gt_drums_t, metro[metro >= 0])["F"]
    res["drumsAllCeiling"] = round(len(np.unique(np.round(gt_drums_t, 3))) / max(1, len(gt_drums_t)), 3)
    # キックは4つ打ちだと1拍ずらしても当たる。ずらして同じ値なら「拍を当てただけ」
    res["kickShifted"] = onset_f1(gt_kick, dr["kick"] + 60 / gt_bpm_audio)

    # テンポ: 音声から推定 vs 正解（MIDI の BPM を倍率で補正したもの）
    tempo_est = float(np.atleast_1d(librosa.feature.tempo(y=y, sr=sr, hop_length=HOP, start_bpm=120))[0])
    ratio = tempo_est / gt_bpm_audio
    res["tempo"] = {
        "gt": round(gt_bpm_audio, 2),
        "midiBpm": gt["bpm"],
        "est": round(tempo_est, 2),
        "errPct": round((ratio - 1) * 100, 2),
        "octaveErr": bool(abs(math.log2(max(ratio, 1e-9))) > 0.4),
    }

    # 調: 音声のクロマ vs 正解の音符
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP).mean(axis=1)
    gt_ch = chroma_of_notes(gt_a["all"], -1e9, 1e9)  # 移調ずれは A() で掛けてある
    k_est, k_gt = key_from_chroma(chroma), key_from_chroma(gt_ch / (gt_ch.sum() + 1e-9))
    rel = (k_gt[1] == "major" and k_est[1] == "minor" and (k_gt[0] - k_est[0]) % 12 == 3) or (
        k_gt[1] == "minor" and k_est[1] == "major" and (k_est[0] - k_gt[0]) % 12 == 3
    )
    est_ch = chroma_of_notes(est["stems_union"], -1e9, 1e9)
    pc_corr = float(np.corrcoef(gt_ch, est_ch)[0, 1]) if gt_ch.sum() > 0 and est_ch.sum() > 0 else 0.0
    res["key"] = {
        "pcCorr": round(pc_corr, 3),
        "gt": f"{PC_NAMES[k_gt[0]]} {k_gt[1]}",
        "est": f"{PC_NAMES[k_est[0]]} {k_est[1]}",
        "match": "exact" if k_est == k_gt else "relative" if rel else "fifth" if (k_est[0] - k_gt[0]) % 12 in (5, 7) and k_est[1] == k_gt[1] else "wrong",
    }

    # 小節ごとの三和音: 正解は MIDI の非主旋律、推定は bass+other の分離音からのクロマ
    # 界隈曲は2拍で和音が変わるので半小節の窓で測る（1小節窓だと位相で値が2倍動く）
    win_sec = 2 * 60 / gt_bpm_audio
    n_win = int(gt["end"] * s / win_sec)

    yb, srb = librosa.load(str(stems["bass"]), sr=SR, mono=True)
    yo, sro = librosa.load(str(stems["other"]), sr=SR, mono=True)
    ymix = yb[: min(len(yb), len(yo))] + yo[: min(len(yb), len(yo))]
    ch_frames = librosa.feature.chroma_cqt(y=ymix, sr=SR, hop_length=HOP)
    frame_t = HOP / SR
    gt_harm = gt_a["bass"] + gt_a["inst"]
    same, root_same, counted = 0, 0, 0
    for b in range(n_win):
        t0 = d + b * win_sec
        t1 = t0 + win_sec
        g = triad_of_chroma(chroma_of_notes(gt_harm, t0, t1))
        f0, f1 = int(max(0, t0 / frame_t)), int(min(ch_frames.shape[1], t1 / frame_t))
        if g is None or f1 <= f0:
            continue
        e = triad_of_chroma(ch_frames[:, f0:f1].mean(axis=1))
        if e is None:
            continue
        counted += 1
        same += int(e == g)
        root_same += int(e[0] == g[0])
    res["chords"] = {
        "window": "half-bar",
        "windows": counted,
        "rootQualityAcc": round(same / counted, 3) if counted else None,
        "rootAcc": round(root_same / counted, 3) if counted else None,
    }

    # --- 採譜結果を MIDI に落とす（DAW に取り込んで聴くため） ---
    pm = pretty_midi.PrettyMIDI(initial_tempo=gt_bpm_audio)
    for kind, program, notes in (("melody(vocals)", 80, est["vocals"]), ("bass", 38, est["bass"]), ("other", 0, est["other"])):
        inst = pretty_midi.Instrument(program=program, name=kind)
        for st, en, p in notes:
            inst.notes.append(pretty_midi.Note(velocity=96, pitch=int(p), start=float(st), end=float(max(en, st + 0.03))))
        pm.instruments.append(inst)
    dinst = pretty_midi.Instrument(program=0, is_drum=True, name="drums")
    for cls, pitch in (("kick", 36), ("snare", 38), ("hat", 42)):
        for t in dr[cls]:
            dinst.notes.append(pretty_midi.Note(velocity=100, pitch=pitch, start=float(t), end=float(t) + 0.05))
    pm.instruments.append(dinst)
    pm.write(str(out / f"transcribed-{preset}.mid"))

    json.dump(res, open(out / f"result-{preset}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"  melody GT={gt['melodyHow']} {gt['melodyCandidates'][:1]}; by stem {res['melodyByStem']}; vocals best track {best_track}; transpose {res['transpose']}")
    log(f"  drums per pitch: {per_pitch}; chance={res['drumsAllChance']} metronome={res['drumsAllMetronome']} ceiling={res['drumsAllCeiling']} kick+1beat={res['kickShifted']['F']}")
    log(
        f"  melody F={res['melody']['F']} (chroma {res['melodyChroma']['F']})  bass F={res['bass']['F']} (chroma {res['bassChroma']['F']})  "
        f"other F={res['other']['F']}  all(stems) F={res['allStems']['F']}  drums F={res['drumsAll']['F']} kick {res['kick']['F']} snare {res['snare']['F']} hat {res['hat']['F']}  "
        f"tempo {res['tempo']['est']} vs {res['tempo']['gt']}  key {res['key']['est']} vs {res['key']['gt']} ({res['key']['match']})  chords {res['chords']['rootQualityAcc']}"
    )
    return res


def write_summary(results: list[dict], out_root: Path, preset: str) -> None:
    cols = [
        ("声もの全部", "voiceGroup"),
        ("リード歌", "melody"),
        ("リード歌(クロマ)", "melodyChroma"),
        ("ベース", "bass"),
        ("ベース(クロマ)", "bassChroma"),
        ("楽器", "other"),
        ("全音符(分離)", "allStems"),
        ("全音符(ミックス)", "allMix"),
    ]
    cfg = PRESETS[preset]
    lines = [f"# 自動採譜の評価（人力の耳コピ MIDI を正解、音符 F1）— {preset}", ""]
    lines.append(f"方式 {preset}: 分離 {cfg['model']}、しきい値(onset, frame) {cfg['th']}、小音量ゲート {cfg['gate_db']} dB。")
    lines.append("")
    lines.append("オンセット ±50ms・音高 ±50セント・オフセット無視。クロマ＝オクターブを無視。歌は「声もの全部」（ハモリ・コーラス込み）を主に読む（ヤツメ穴は歌が2トラックに割れている）。")
    lines.append("")
    lines.append("| 曲 | " + " | ".join(c for c, _ in cols) + " | テンポ誤差 | 音高クラス相関 | 調(KS) | 三和音(半小節) |")
    lines.append("|---|" + "---|" * (len(cols) + 4))
    means: dict[str, list[float]] = {k: [] for _, k in cols}
    for r in results:
        cells = []
        for _, k in cols:
            f = r[k]["F"]
            cells.append(f"{f:.2f}")
            means[k].append(f)
        lines.append(
            f"| {r['name']} | " + " | ".join(cells) + f" | {r['tempo']['errPct']:+.1f}% | {r['key']['pcCorr']:.2f} | {r['key']['match']} | {r['chords']['rootQualityAcc']} |"
        )
    lines.append("| **平均** | " + " | ".join(f"{np.mean(means[k]):.2f}" for _, k in cols) + " | | | | |")
    lines.append("")
    lines.append("## ドラム（オンセット F1 ±50ms）")
    lines.append("")
    lines.append("全打点は「偶然（同数の一様乱数）」「メトロノーム（8分音符を全部置く）」「上限（同時打ちの分だけ届かない）」と並べて読む。キック列は GM 35/36 を使う曲だけ。「+1拍」はキックを1拍ずらした値で、同じなら拍を当てただけ。")
    lines.append("")
    lines.append("| 曲 | 全打点 | 偶然 | メトロノーム | 上限 | キック(GM) | キック +1拍 |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in results:
        kick = f"{r['kick']['F']:.2f}" if r["kick"]["nRef"] > 0 else "n/a"
        kick2 = f"{r['kickShifted']['F']:.2f}" if r["kick"]["nRef"] > 0 else "n/a"
        lines.append(
            f"| {r['name']} | {r['drumsAll']['F']:.2f} | {r['drumsAllChance']:.2f} | {r['drumsAllMetronome']:.2f} | {r['drumsAllCeiling']:.2f} | {kick} | {kick2} |"
        )
    lines.append("")
    lines.append("## 診断")
    lines.append("")
    lines.append("| 曲 | 位置合わせ(倍率/ずれ/移調/相関) | リード歌の正解の選び方 | リード歌が最も載る系統 | vocals に最も合う正解トラック | 追加の移調で上がるか | 正解から外した打楽器トラック |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in results:
        bs = max(r["melodyByStem"], key=r["melodyByStem"].get)
        vt = r["vocalsBestTrack"]
        tp = r["transpose"]
        a = r["align"]
        perc = ", ".join(f"#{t['index']} {t['name']} p{t['program']}" for t in r.get("percussiveTracks", [])) or "-"
        lines.append(
            f"| {r['name']} | {a['scale']:.3f} / {a['offset']:+.2f}s / {a['shift']:+d} / {a['corr']:.2f} | {r['melodyHow']} | {bs} ({r['melodyByStem'][bs]:.2f}) | {vt[0]} ({vt[1]:.2f}) | {tp['bestExtraShift']:+d} ({tp['F_at_best']:.2f} / 0: {tp['F_at_0']:.2f}) | {perc} |"
        )
    lines.append("")
    lines.append("### ドラムの音番号ごとの一致（正解の音番号 → 最も合う推定分類）")
    lines.append("")
    for r in results:
        lines.append(f"- {r['name']}: " + ", ".join(f"{d['pitch']}×{d['count']}→{d['bestClass']} {d['F']:.2f}" for d in r["drumsPerPitch"]))
    lines.append("")
    lines.append("## 位置合わせと正解トラック")
    lines.append("")
    for r in results:
        a = r["align"]
        lines.append(f"- **{r['name']}**: scale {a['scale']:.4f} / offset {a['offset']:+.3f}s / 移調 {a['shift']:+d} / corr {a['corr']:.3f}; MIDI BPM {r['tempo']['midiBpm']} → 音声換算 {r['tempo']['gt']}; テンポ推定 {r['tempo']['est']}; 調 推定 {r['key']['est']} / 正解（移調適用後） {r['key']['gt']}")
        for t in r["gtTracks"]:
            lines.append(f"  - {t['role']:6} #{t['index']} {t['name'] or '(no name)'} p{t['program']} n={t['count']} poly={t['poly']} cov={t['coverage']} med={t['medianPitch']}")
    lines.append("")
    lines.append("## 音符数（正解 / 推定）")
    lines.append("")
    for r in results:
        lines.append(f"- {r['name']}: lead {r['melody']['nRef']}/{r['melody']['nEst']}, voiceGroup {r['voiceGroup']['nRef']}/{r['voiceGroup']['nEst']}, bass {r['bass']['nRef']}/{r['bass']['nEst']}, inst {r['other']['nRef']}/{r['other']['nEst']}, drums {r['drumsAll']['nRef']}/{r['drumsAll']['nEst']} (kick {r['kick']['nRef']}/{r['kick']['nEst']}, snare {r['snare']['nRef']}/{r['snare']['nEst']}, hat {r['hat']['nRef']}/{r['hat']['nEst']})")
    (out_root / f"summary-{preset}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    json.dump(results, open(out_root / f"results-{preset}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"wrote {out_root / f'summary-{preset}.md'}")


def cmd_run(args: argparse.Namespace) -> None:
    pairs = json.load(open(args.pairs, encoding="utf-8"))
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)
    prev_path = out_root / f"results-{args.preset}.json"
    prev = {r["name"]: r for r in json.load(open(prev_path, encoding="utf-8"))} if prev_path.exists() else {}
    for pair in pairs:
        if args.only and pair["name"] not in args.only:
            continue
        prev[pair["name"]] = evaluate_pair(pair, out_root, args.device, args.force, args.preset)
    # pairs.json の順に並べる。--only で絞っても他の曲の結果は残す
    results = [prev[p["name"]] for p in pairs if p["name"] in prev]
    write_summary(results, out_root, args.preset)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("inventory")
    inv.add_argument("--audio", required=True)
    inv.add_argument("--midi", required=True)
    inv.add_argument("--out", default="tmp/transcribe-eval")
    run = sub.add_parser("run")
    run.add_argument("--pairs", required=True)
    run.add_argument("--out", default="tmp/transcribe-eval")
    run.add_argument("--device", default="cuda")
    run.add_argument("--force", action="store_true")
    run.add_argument("--only", nargs="*")
    run.add_argument("--preset", default=DEFAULT_PRESET, choices=list(PRESETS))
    args = ap.parse_args()
    if args.cmd == "inventory":
        cmd_inventory(args)
    else:
        cmd_run(args)


if __name__ == "__main__":
    main()
