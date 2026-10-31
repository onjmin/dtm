"""サムソン3：くるくるチェン大狂詩曲 (Samson 3: Kurukuru Jackie Rhapsody)
台詞イントネーション作曲（PSOLA再合成・Aマイナーペンタ・王道進行・完全終止・豪華7トラック伴奏）

AGENTS.md 方針:
1. 意図: 低音域の日常的な会話型スタッカート詠唱から、サビで1オクターブ跳躍するペンタトニックの疾走旋律へと急展開し、
   最後はE7(♭9)の導音G#から主音A（Am9）への完璧な終止で解脱する、落差と和声のカタルシスに振り切った台詞イントネーション歌唱曲。
2. 振り切る2軸:
   - 軸1: 極端な音域・抑揚コントラスト（Aメロの平坦な低音語り MIDI 57〜64 と サビのオクターブ跳躍ペンタ旋律 MIDI 69〜76 の対比）
   - 軸2: 和声のカタルシスと終止（王道4-5-3-6セブンス進行から、第63〜64小節の E7(♭9) 導音G# → Am9 主音A への完全終止）
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
HERE = paths.WORK

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_v1 as S  # noqa: E402

FS = 44100
BPM = 126
SIX = 15 / BPM
BAR_STEPS = 192  # 1小節 = 16分音符 16個 * 12ステップ = 192ステップ
NBARS = 64
K = V.K
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# A minor pentatonic: A, C, D, E, G (9, 0, 2, 4, 7) + leading tone G# (8) on dominant
PENT_A = np.array([9, 0, 2, 4, 7])
PENT_A_LEAD = np.array([9, 0, 2, 4, 7, 8])

CHORDS = {
    "Am7":   {"root": 33, "tones": [57, 60, 64, 67], "pad": [57, 64, 67, 71], "bass": 33}, # A3, E4, G4, B4 (Am9)
    "Dm7":   {"root": 38, "tones": [53, 57, 60, 65], "pad": [57, 60, 62, 65], "bass": 38}, # A3, C4, D4, F4
    "G7":    {"root": 31, "tones": [55, 59, 62, 65], "pad": [53, 59, 62, 67], "bass": 31}, # F3, B3, D4, G4
    "CM7":   {"root": 36, "tones": [52, 55, 59, 64], "pad": [55, 59, 60, 64], "bass": 36}, # G3, B3, C4, E4
    "FM7":   {"root": 29, "tones": [53, 57, 60, 64], "pad": [57, 60, 64, 69], "bass": 29}, # A3, C4, E4, A4
    "Em7":   {"root": 28, "tones": [52, 55, 59, 62], "pad": [55, 59, 62, 67], "bass": 28}, # G3, B3, D4, G4
    "Bm7b5": {"root": 35, "tones": [53, 57, 59, 62], "pad": [53, 57, 59, 62], "bass": 35}, # F3, A3, B3, D4
    "E7sus4":{"root": 28, "tones": [52, 57, 59, 62], "pad": [57, 59, 62, 64], "bass": 28}, # A3, B3, D4, E4
    "E7":    {"root": 28, "tones": [52, 56, 59, 62], "pad": [56, 59, 62, 65], "bass": 28}, # G#3, B3, D4, F4 (E7b9)
    "Am9":   {"root": 33, "tones": [57, 60, 64, 67], "pad": [57, 60, 64, 67, 71], "bass": 33}, # Full Am9 resolution
}

# 64小節の和声進行
PROG = [
    # Bars 1-8: Intro
    "Am7", "Am7", "FM7", "FM7", "Dm7", "Em7", "FM7", "E7",
    # Bars 9-24: Verse A1 (低音日常詠唱)
    "Am7", "Dm7", "G7", "CM7", "FM7", "Bm7b5", "E7", "Am7",
    "Am7", "Dm7", "G7", "CM7", "FM7", "Dm7", "E7sus4", "E7",
    # Bars 25-40: Chorus B1 (王道進行・高音ペンタ飛翔)
    "FM7", "G7", "Em7", "Am7", "FM7", "G7", "E7", "Am7",
    "FM7", "G7", "Em7", "Am7", "FM7", "G7", "E7", "Am7",
    # Bars 41-48: Interlude / Breakdown
    "Dm7", "G7", "CM7", "FM7", "Bm7b5", "Bm7b5", "E7sus4", "E7",
    # Bars 49-64: Chorus B2 & The Grand Cadence
    "FM7", "G7", "Em7", "Am7", "FM7", "G7", "E7", "Am7",
    "FM7", "G7", "Em7", "Am7", "Dm7", "G7", "E7", "Am9",
]

# 台詞配置プラン: (開始小節 1始まり, 小節内16分位置 0-15, 素材, 移調目標中心, フック判定)
# Aメロは低音域(58-62付近)、サビはオクターブ上の高音域(70-74付近)へ振り切る
SPEECH_PLAN = [
    # Bars 1-8: Intro
    (1, 8, S.DOIT, 57.0, False),
    (3, 8, S.HEREWEGO, 60.0, False),
    (5, 8, S.SUGOIYO, 62.0, False),
    (7, 8, S.PSYCHO, 60.0, False),

    # Bars 9-24: Verse A1 (低音日常スタッカート詠唱)
    (9, 0, S.KOWAI, 57.0, False),
    (11, 0, S.MATTETE, 57.0, False),
    (13, 0, S.MOUIKKAI, 60.0, False),
    (15, 0, S.SENTI, 57.0, False),
    (17, 0, S.AITATATA, 57.0, False),
    (19, 0, S.DAMEDAME, 60.0, False),
    (21, 0, S.ASHI, 57.0, False),
    (23, 0, S.KANJI, 62.0, False),

    # Bars 25-40: Chorus B1 (高音ペンタ飛翔・くるくるチェン)
    (25, 0, S.KURUKURU, 71.0, True),
    (27, 0, S.HICHEW, 69.0, True),
    (29, 0, S.KURUKURU, 71.0, True),
    (31, 0, S.JACKIE, 74.0, True),
    (33, 0, S.KURUKURU, 71.0, True),
    (35, 0, S.HICHEW, 69.0, True),
    (37, 0, S.KURUKURU, 71.0, True),
    (39, 0, S.JACKIE, 74.0, True),

    # Bars 41-48: Interlude
    (41, 0, S.AIIN, 57.0, False),
    (42, 0, S.DOARA, 62.0, False),
    (43, 0, S.STEINER, 60.0, False),
    (44, 0, S.ZOU, 57.0, False),
    (45, 0, S.ARCHER, 64.0, False),
    (47, 0, S.GORILLA, 62.0, False),

    # Bars 49-64: Chorus B2 & Finale
    (49, 0, S.KURUKURU, 72.0, True),
    (51, 0, S.HICHEW, 71.0, True),
    (53, 0, S.KURUKURU, 72.0, True),
    (55, 0, S.SAIKOU, 74.0, True),
    (57, 0, S.KURUKURU, 72.0, True),
    (59, 0, S.HICHEW, 71.0, True),
    # Bars 61-64: The Grand Cadence
    (61, 0, S.MOUIKKAI, 65.0, True),
    (62, 4, S.MATTETE, 64.0, True),
    (63, 0, S.JACKIE, 74.0, True),  # Leading tone G# (71/80) -> Bar 64 downbeat Root A (69/81)
]

def snap_to(m, pcs):
    cands = np.array([o * 12 + p for o in range(int(m // 12) - 1, int(m // 12) + 2) for p in pcs], float)
    return float(cands[np.argmin(np.abs(cands - m))])

def step_in(q, pcs, up):
    k = q + (1 if up else -1)
    while k % 12 not in pcs:
        k += 1 if up else -1
    return float(k)

def correct_melody(midis, pcs):
    """モーラごとの音高を音階へ吸着。元の上下と横ばいを維持する。"""
    out, prev = [], None
    for m in midis:
        if not np.isfinite(m):
            out.append(np.nan)
            continue
        q = snap_to(m, pcs)
        near = q
        if prev is not None:
            d = m - prev[0]
            if d >= 0.5 and q <= prev[1]:
                q = step_in(prev[1], pcs, True)
            elif d <= -0.5 and q >= prev[1]:
                q = step_in(prev[1], pcs, False)
            elif abs(d) < 0.5:
                q = prev[1]
        if abs(q - m) > 1.8:
            q = near
        out.append(q)
        prev = (m, q)
    return np.array(out)

def build_composition(outdir: Path):
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ["ANCHOR"] = "1.0"
    V.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for key, c in cache.items():
        c["pos"] = V.place(c)

    # 1. 台詞の配置・音程補正・再合成
    N_samples = int((NBARS * 16 * SIX + 4) * FS)
    voice_audio = np.zeros(N_samples)
    melody_notes = []
    placed_meta = []

    print(f"Placing {len(SPEECH_PLAN)} speech segments across {NBARS} bars...")
    for bar_num, beat16, clip_tuple, target_mid, is_hook in SPEECH_PLAN:
        c = cache[K(clip_tuple)]
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else target_mid
        tr = float(round(target_mid - med))  # 目標音域への移調

        # 和音に応じた音階選択（E7小節では導音G#を許可）
        chord_name = PROG[bar_num - 1]
        pcs = PENT_A_LEAD if "E7" in chord_name else PENT_A
        q = correct_melody(c["midi"] + tr, pcs)

        # PSOLAによる母音伸長＆音程補正
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12)
                  for qq, m in zip(q, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)

        # 音量バランス調整
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        rms = float(np.sqrt((x[fr] ** 2).mean())) if fr.any() else 1.0
        x = x * (0.12 / max(rms, 1e-9))

        start_pos16 = (bar_num - 1) * 16 + beat16
        V.add(voice_audio, x, start_pos16 * SIX + d0)

        # 採譜
        for i, pitch in enumerate(q):
            if not np.isfinite(pitch):
                continue
            pos16 = start_pos16 + int(c["pos"][i])
            w16 = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            dur16 = int(min(max(1, w16), 4))
            melody_notes.append({
                "pos16": pos16, "dur16": dur16, "midi": pitch, "hook": is_hook,
                "bar": bar_num
            })

        placed_meta.append({
            "bar": bar_num + beat16 / 16,
            "text": c["text"],
            "who": Path(c["path"]).parent.name,
            "transpose": tr,
            "targetCenter": target_mid,
            "isHook": is_hook,
            "chord": chord_name,
            "correctionCents": [
                round(float((qq - (m + tr)) * 100))
                for qq, m in zip(q, c["midi"]) if np.isfinite(qq) and np.isfinite(m)
            ]
        })

    # 音声正規化＆保存
    max_pk = np.abs(voice_audio).max()
    if max_pk > 0:
        voice_audio = 0.92 * voice_audio / max_pk
    sf.write(outdir / "voice.wav", voice_audio.astype(np.float32), FS)
    print(f"voice.wav written ({len(voice_audio)/FS:.1f}s)")

    # 2. DAW トラックの構築 (16分=12ステップ、1小節=192ステップ)
    tracks = {
        "t0": [],   # Lead 1 (square)
        "t4": [],   # Synth Bass 1 (groovy 8th octaves)
        "t5": [],   # Synth Bass 2 (deep sub bass)
        "t6": [],   # Pad 2 (warm)
        "t7": [],   # Electric Piano 1 (funky 16th comping)
        "t10": [],  # Celesta (shimmering arpeggios & bells)
        "t13": [],  # Lead 2 (sawtooth) - Chorus B2 doubling
    }

    # t0 / t13: リードシンセ（サビで台詞旋律をなぞり、間奏でオブリガート）
    for n in melody_notes:
        st = n["pos16"] * 12
        dur = n["dur16"] * 12 - 2
        m = int(round(n["midi"]))
        if n["hook"]:
            # サビではリード1が1オクターブ上で台詞をなぞる
            lead_pitch = m if m >= 69 else m + 12
            tracks["t0"].append({"startStep": st, "durationSteps": dur, "midi": lead_pitch})
            # ラスサビ (bars 49-64) ではリード2がオクターブ下で重厚にユニゾン
            if n["bar"] >= 49:
                tracks["t13"].append({"startStep": st, "durationSteps": dur, "midi": lead_pitch - 12})

    # 間奏 (bars 41-48) のリード1 オブリガート（Amペンタの上昇・下降パッセージ）
    obbligato = [
        (41, 0, 72, 10), (41, 4, 74, 10), (41, 8, 76, 10), (41, 12, 79, 10),
        (42, 0, 81, 22), (42, 4, 79, 10), (42, 8, 76, 22),
        (43, 0, 74, 10), (43, 4, 76, 10), (43, 8, 79, 10), (43, 12, 81, 10),
        (44, 0, 84, 22), (44, 4, 81, 10), (44, 8, 79, 22),
        (45, 0, 76, 10), (45, 4, 79, 10), (45, 8, 81, 10), (45, 12, 84, 10),
        (46, 0, 86, 22), (46, 4, 84, 10), (46, 8, 81, 22),
        # Bars 47-48: E7sus4 -> E7 劇的な上昇カデンツ
        (47, 0, 76, 10), (47, 4, 77, 10), (47, 8, 79, 10), (47, 12, 80, 10), # 80 = G#5 leading tone!
        (48, 0, 83, 22), (48, 4, 80, 10), (48, 8, 83, 22), (48, 12, 88, 22),
    ]
    for b, p16, mid, dur in obbligato:
        st = ((b - 1) * 16 + p16) * 12
        tracks["t0"].append({"startStep": st, "durationSteps": dur * 12 - 2, "midi": mid})

    # 伴奏の構築 (bars 0 to 63)
    for b in range(NBARS):
        chord_key = PROG[b]
        ch = CHORDS[chord_key]
        b_st = b * BAR_STEPS

        # 終止小節 (bar 64, index 63) の完璧な全音符終止
        if b == 63:
            # Am9 和音を全音符で力強く響かせる
            for m in ch["pad"]:
                tracks["t6"].append({"startStep": b_st, "durationSteps": 190, "midi": m})
                tracks["t7"].append({"startStep": b_st, "durationSteps": 190, "midi": m})
            tracks["t4"].append({"startStep": b_st, "durationSteps": 190, "midi": ch["bass"]})
            tracks["t5"].append({"startStep": b_st, "durationSteps": 190, "midi": ch["bass"] - 12})
            tracks["t0"].append({"startStep": b_st, "durationSteps": 190, "midi": 69}) # Root A
            tracks["t13"].append({"startStep": b_st, "durationSteps": 190, "midi": 57})
            continue

        # 1. t6: Pad 2 (warm) - 和音パッド
        for m in ch["pad"]:
            tracks["t6"].append({"startStep": b_st, "durationSteps": 188, "midi": m})

        # 2. t7: Electric Piano 1 - ファンキーな16分シンコペーション裏拍刻み
        # 拍の裏や3:3:2のグルーヴを刻む
        ep_steps = [24, 60, 96, 132, 168]
        for ep_s in ep_steps:
            for m in ch["tones"]:
                tracks["t7"].append({"startStep": b_st + ep_s, "durationSteps": 14, "midi": m})

        # 3. t4: Synth Bass 1 - 8分オクターブ＋3:3:2グルーヴ
        r = ch["bass"]
        bass_pattern = [
            (0, r, 20), (24, r + 12, 18), (48, r, 20), (72, r + 12, 18),
            (96, r, 20), (120, r + 12, 18), (144, r + 12, 18), (168, r, 20)
        ]
        for step_off, note_mid, d_step in bass_pattern:
            tracks["t4"].append({"startStep": b_st + step_off, "durationSteps": d_step, "midi": note_mid})

        # 4. t5: Synth Bass 2 - サブベース（1拍目・3拍目に重低音の柱）
        tracks["t5"].append({"startStep": b_st, "durationSteps": 84, "midi": r - 12 if r >= 36 else r})
        tracks["t5"].append({"startStep": b_st + 96, "durationSteps": 84, "midi": r - 12 if r >= 36 else r})

        # 5. t10: Celesta - サビ (bars 25-40, 49-60) で煌めく16分ペンタトニック・アルペジオ
        is_chorus = (24 <= b < 40) or (48 <= b < 60)
        if is_chorus:
            # A minor pentatonic arpeggio sequence
            arp_tones = [69, 72, 76, 79, 81, 84, 88, 91, 88, 84, 81, 79, 76, 72, 76, 79]
            for step_idx in range(16):
                tracks["t10"].append({
                    "startStep": b_st + step_idx * 12,
                    "durationSteps": 10,
                    "midi": arp_tones[step_idx % len(arp_tones)]
                })

    # daw.json の書き出し
    daw_data = {
        "bpm": BPM,
        "drum": "four_clap_16hat",
        "bars": NBARS,
        "tracks": tracks,
        "instruments": {
            "t0": "Lead 1 (square)",
            "t4": "Synth Bass 1",
            "t5": "Synth Bass 2",
            "t6": "Pad 2 (warm)",
            "t7": "Electric Piano 1",
            "t10": "Celesta",
            "t13": "Lead 2 (sawtooth)",
        }
    }
    (outdir / "daw.json").write_text(json.dumps(daw_data, indent=1), encoding="utf-8")
    print(f"daw.json written ({sum(len(v) for v in tracks.values())} notes total across 7 tracks)")

    # placement.json の書き出し
    info = {
        "bpm": BPM,
        "root": "A",
        "key": "A minor",
        "scale": "minor pentatonic",
        "bars": NBARS,
        "progression": " ".join(PROG),
        "intent": "低音域の日常的な会話型スタッカート詠唱から、サビで1オクターブ跳躍するペンタトニックの疾走旋律へと急展開し、最後はE7(♭9)の導音G#から主音A（Am9）への完璧な終止で解脱する、落差と和声のカタルシスに振り切った台詞イントネーション歌唱曲。",
        "axes": [
            "極端な音域・抑揚コントラスト（Aメロの平坦な低音語り詠唱 MIDI 57〜64 と サビのオクターブ跳躍ペンタ旋律 MIDI 69〜76 の対比）",
            "和声のカタルシスと終止（王道4-5-3-6セブンス進行から、第63〜64小節の E7(♭9) 導音G# → Am9 主音A への完全終止）"
        ],
        "placed": placed_meta
    }
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "melody.npy", np.array([(n["pos16"], n["dur16"], n["midi"]) for n in melody_notes]))
    print(f"placement.json and melody.npy written")

if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "samson3"
    build_composition(out_dir)
