"""サムソン4：歓喜のネオソウル狂詩曲 (Samson 4: Neo-Soul Rhapsody)
台詞イントネーション作曲（PSOLA再合成・Dマイナーペンタ・ネオソウル裏コード進行・完全終止・豪華7トラック伴奏）

AGENTS.md 方針:
1. 意図: 都会的で哀愁漂うネオソウル・フュージョンの和声（裏コードとサブドミナントマイナー）の上で、
   サムソンの泥臭い台詞イントネーションをDマイナーペンタトニックの16分シンコペーションで疾走させ、
   最高音の咆哮からDm9への完全終止で昇天させる台詞イントネーション歌唱狂詩曲。
2. 振り切る2軸:
   - 軸1: 徹底的な16分シンコペーション・ペンタトニックの疾走と跳躍（Aメロ低音語り MIDI 57〜62 と サビのオクターブ跳躍ペンタ旋律 MIDI 69〜77 の対比）
   - 軸2: 都会的なネオソウル和声（B♭M7→B♭m6→Am7→A♭7→Gm7→C7→FM7→A7alt）と第63〜64小節の劇的な完全終止（Em7♭5→A7alt→Dm9）
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
BPM = 130
SIX = 15 / BPM
BAR_STEPS = 192  # 1小節 = 16分音符 16個 * 12ステップ = 192ステップ
NBARS = 64
K = V.K
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# D minor pentatonic: D, F, G, A, C (2, 5, 7, 9, 0) + leading tone C# (1) on A7
PENT_D = np.array([2, 5, 7, 9, 0])
PENT_D_LEAD = np.array([2, 5, 7, 9, 0, 1])

CHORDS = {
    "Dm7":   {"root": 38, "tones": [57, 60, 62, 65], "pad": [57, 62, 65, 69], "bass": 38}, # D2, A3, D4, F4, A4
    "Gm7":   {"root": 31, "tones": [55, 58, 62, 65], "pad": [55, 58, 62, 65], "bass": 31}, # G1, G3, Bb3, D4, F4
    "C7":    {"root": 36, "tones": [55, 58, 60, 64], "pad": [55, 58, 60, 64], "bass": 36}, # C2, G3, Bb3, C4, E4
    "FM7":   {"root": 29, "tones": [53, 57, 60, 64], "pad": [57, 60, 64, 69], "bass": 29}, # F1, A3, C4, E4, A4
    "B♭M7":  {"root": 34, "tones": [53, 57, 58, 62], "pad": [57, 58, 62, 65], "bass": 34}, # Bb1, A3, Bb3, D4, F4
    "B♭m6":  {"root": 34, "tones": [53, 55, 58, 61], "pad": [55, 58, 61, 65], "bass": 34}, # Bb1, G3, Bb3, Db4, F4 (Subdominant minor!)
    "Am7":   {"root": 33, "tones": [57, 60, 64, 67], "pad": [57, 60, 64, 67], "bass": 33}, # A1, A3, C4, E4, G4
    "A♭7":   {"root": 32, "tones": [56, 58, 60, 64], "pad": [56, 60, 64, 66], "bass": 32}, # Ab1, Ab3, C4, E4, Gb4 (Tritone sub / 裏コード!)
    "Em7♭5": {"root": 28, "tones": [52, 55, 58, 62], "pad": [55, 58, 62, 64], "bass": 28}, # E1, G3, Bb3, D4, E4
    "A7alt": {"root": 33, "tones": [55, 57, 61, 64], "pad": [55, 61, 64, 67], "bass": 33}, # A1, G3, C#4, E4, G4 (with C# leading tone!)
    "Dm9":   {"root": 38, "tones": [57, 60, 62, 65], "pad": [57, 62, 64, 65, 69], "bass": 38}, # D2, A3, D4, E4, F4, A4 (Dm9 resolution)
}

# 64小節の和声進行
PROG = [
    # Bars 1-8: Intro
    "Dm7", "Dm7", "B♭M7", "B♭M7", "Gm7", "Am7", "B♭M7", "A7alt",
    # Bars 9-24: Verse A1 (低音日常スタッカート詠唱)
    "Dm7", "Gm7", "C7", "FM7", "B♭M7", "Em7♭5", "A7alt", "Dm7",
    "Dm7", "Gm7", "C7", "FM7", "B♭M7", "Gm7", "Em7♭5", "A7alt",
    # Bars 25-40: Chorus B1 (ネオソウル裏コード進行・高音ペンタ飛翔)
    "B♭M7", "B♭m6", "Am7", "A♭7", "Gm7", "C7", "FM7", "A7alt",
    "B♭M7", "B♭m6", "Am7", "A♭7", "Gm7", "C7", "FM7", "A7alt",
    # Bars 41-48: Interlude / Funk Breakdown
    "Gm7", "C7", "FM7", "B♭M7", "Em7♭5", "Em7♭5", "A7alt", "A7alt",
    # Bars 49-64: Chorus B2 & The Grand Cadence
    "B♭M7", "B♭m6", "Am7", "A♭7", "Gm7", "C7", "FM7", "A7alt",
    "B♭M7", "B♭m6", "Am7", "A♭7", "Gm7", "A7alt", "Em7♭5", "Dm9",
]

# 台詞配置プラン: (開始小節 1始まり, 小節内16分位置 0-15, 素材, 移調目標中心, フック判定)
SPEECH_PLAN = [
    # Bars 1-8: Intro
    (1, 8, S.DOIT, 62.0, False),
    (3, 8, S.HEREWEGO, 65.0, False),
    (5, 8, S.SUGOIYO, 67.0, False),
    (7, 8, S.PSYCHO, 65.0, False),

    # Bars 9-24: Verse A1 (低音日常スタッカート詠唱)
    (9, 0, S.KOWAI, 57.0, False),
    (11, 0, S.MATTETE, 57.0, False),
    (13, 0, S.MOUIKKAI, 60.0, False),
    (15, 0, S.SENTI, 57.0, False),
    (17, 0, S.AITATATA, 57.0, False),
    (19, 0, S.DAMEDAME, 60.0, False),
    (21, 0, S.ASHI, 57.0, False),
    (23, 0, S.KANJI, 62.0, False),

    # Bars 25-40: Chorus B1 (高音ペンタ飛翔・ネオソウル旋律)
    (25, 0, S.KURUKURU, 74.0, True),
    (27, 0, S.HICHEW, 72.0, True),
    (29, 0, S.KURUKURU, 74.0, True),
    (31, 0, S.JACKIE, 77.0, True),
    (33, 0, S.KURUKURU, 74.0, True),
    (35, 0, S.HICHEW, 72.0, True),
    (37, 0, S.KURUKURU, 74.0, True),
    (39, 0, S.JACKIE, 77.0, True),

    # Bars 41-48: Interlude
    (41, 0, S.AIIN, 57.0, False),
    (42, 0, S.DOARA, 62.0, False),
    (43, 0, S.STEINER, 60.0, False),
    (44, 0, S.ZOU, 57.0, False),
    (45, 0, S.ARCHER, 65.0, False),
    (47, 0, S.GORILLA, 62.0, False),

    # Bars 49-64: Chorus B2 & Finale
    (49, 0, S.KURUKURU, 74.0, True),
    (51, 0, S.HICHEW, 72.0, True),
    (53, 0, S.KURUKURU, 74.0, True),
    (55, 0, S.SAIKOU, 77.0, True),
    (57, 0, S.KURUKURU, 74.0, True),
    (59, 0, S.HICHEW, 72.0, True),
    # Bars 61-64: The Grand Cadence
    (61, 0, S.MOUIKKAI, 67.0, True),
    (62, 4, S.MATTETE, 65.0, True),
    (63, 0, S.JACKIE, 77.0, True),  # Leading tone C# (73/85) -> Bar 64 downbeat Root D (62/74)
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
    print("Loading speech clips from cache...")
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

        # 和音に応じた音階選択（A7alt小節では導音C#を許可）
        chord_name = PROG[bar_num - 1]
        pcs = PENT_D_LEAD if "A7alt" in chord_name else PENT_D
        q = correct_melody(c["midi"] + tr, pcs)

        # PSOLAによる母音伸長＆音程補正
        ratios = [
            2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12)
            for qq, m in zip(q, c["midi"])
        ]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)

        # 音量バランスの均一化
        rms_val = np.sqrt((x ** 2).mean())
        if rms_val > 1e-4:
            x = x * (0.08 / rms_val)

        # 曲タイムラインへ配置
        t_start = ((bar_num - 1) * 16 + beat16) * SIX + d0
        idx_start = int(round(t_start * FS))
        idx_end = idx_start + len(x)
        if idx_end <= len(voice_audio):
            voice_audio[idx_start:idx_end] += x
        elif idx_start < len(voice_audio):
            rem = len(voice_audio) - idx_start
            voice_audio[idx_start:] += x[:rem]

        # 旋律データの抽出（後で伴奏リードやMMLのガイドに利用）
        for mora_idx, (qq, m_pos) in enumerate(zip(q, c["pos"])):
            pos16 = (bar_num - 1) * 16 + beat16 + int(round(m_pos))
            dur16 = 1
            pitch = qq if np.isfinite(qq) else target_mid
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
            lead_pitch = m if m >= 69 else m + 12
            tracks["t0"].append({"startStep": st, "durationSteps": dur, "midi": lead_pitch})
            if n["bar"] >= 49:
                tracks["t13"].append({"startStep": st, "durationSteps": dur, "midi": lead_pitch - 12})

    # 間奏 (bars 41-48) のリード1 オブリガート（Dmペンタの上昇・下降パッセージ）
    obbligato = [
        (41, 0, 74, 10), (41, 4, 77, 10), (41, 8, 79, 10), (41, 12, 81, 10),
        (42, 0, 84, 22), (42, 4, 81, 10), (42, 8, 79, 22),
        (43, 0, 77, 10), (43, 4, 79, 10), (43, 8, 81, 10), (43, 12, 84, 10),
        (44, 0, 86, 22), (44, 4, 84, 10), (44, 8, 81, 22),
        (45, 0, 79, 10), (45, 4, 81, 10), (45, 8, 84, 10), (45, 12, 86, 10),
        (46, 0, 89, 22), (46, 4, 86, 10), (46, 8, 84, 22),
        # Bars 47-48: Em7b5 -> A7alt 劇的な上昇カデンツ (85 = C#6 leading tone!)
        (47, 0, 79, 10), (47, 4, 81, 10), (47, 8, 82, 10), (47, 12, 85, 10),
        (48, 0, 86, 22), (48, 4, 85, 10), (48, 8, 86, 22), (48, 12, 91, 22),
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
            # Dm9 和音を全音符で力強く響かせる
            for m in ch["pad"]:
                tracks["t6"].append({"startStep": b_st, "durationSteps": 190, "midi": m})
                tracks["t7"].append({"startStep": b_st, "durationSteps": 190, "midi": m})
            tracks["t4"].append({"startStep": b_st, "durationSteps": 190, "midi": ch["bass"]})
            tracks["t5"].append({"startStep": b_st, "durationSteps": 190, "midi": ch["bass"] - 12})
            tracks["t0"].append({"startStep": b_st, "durationSteps": 190, "midi": 74}) # Root D5
            tracks["t13"].append({"startStep": b_st, "durationSteps": 190, "midi": 62}) # Root D4
            continue

        # 1. t6: Pad 2 (warm) - 和音パッド
        for m in ch["pad"]:
            tracks["t6"].append({"startStep": b_st, "durationSteps": 188, "midi": m})

        # 2. t7: Electric Piano 1 - ファンキーな16分シンコペーション裏拍刻み
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
            # D minor pentatonic arpeggio sequence
            arp_tones = [74, 77, 81, 84, 86, 89, 93, 96, 93, 89, 86, 84, 81, 77, 81, 84]
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
        "root": "D",
        "key": "D minor",
        "scale": "minor pentatonic",
        "bars": NBARS,
        "progression": " ".join(PROG),
        "intent": "都会的で哀愁漂うネオソウル・フュージョンの和声（裏コードとサブドミナントマイナー）の上で、サムソンの泥臭い台詞イントネーションをDマイナーペンタトニックの16分シンコペーションで疾走させ、最高音の咆哮からDm9への完全終止で昇天させる台詞イントネーション歌唱狂詩曲。",
        "axes": [
            "徹底的な16分シンコペーション・ペンタトニックの疾走と跳躍（Aメロ低音語り MIDI 57〜62 と サビのオクターブ跳躍ペンタ旋律 MIDI 69〜77 の対比）",
            "都会的なネオソウル和声（B♭M7→B♭m6→Am7→A♭7→Gm7→C7→FM7→A7alt）と第63〜64小節の劇的な完全終止（Em7♭5→A7alt→Dm9）"
        ],
        "placed": placed_meta
    }
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "melody.npy", np.array([(n["pos16"], n["dur16"], n["midi"]) for n in melody_notes]))
    print(f"placement.json and melody.npy written")


if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "samson4"
    build_composition(out_dir)
