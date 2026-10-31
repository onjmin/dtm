"""サムソン × 2号式 2（notes-samson-2go2.md）。ペンタの跳躍と変化するリズムの手書きリード、声の母音シンセが2本目のリフ。使い捨て。

- vinst.wav（と vinst_<層>.wav）: 声の楽器、vraw.wav: 生の台詞（PSOLA）
- daw.json: 伴奏とリード（手書き）、placement.json: 小節ごとの素材
1小節 = 192 ステップ、16分 = 12。python -I samson_2go2_build.py <outdir>
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import samson_v1 as S  # noqa: E402
import yaju_2go_build as Y2  # noqa: E402

FS = G.FS
BPM = 152
SIX = 15 / BPM
BAR = 192
NBARS = 64
K = V.K
PENT = {0, 3, 5, 7, 10}  # C マイナーペンタ（check 用）

CH = {
    "Cm7": [58, 60, 63, 67], "Bb7": [58, 62, 65, 68], "AbM7": [60, 63, 67, 68], "G7": [59, 62, 65, 67],
    "Fm7": [60, 63, 65, 68], "EbM7": [58, 62, 63, 67], "Gm7": [58, 62, 65, 67],
}
ROOT = {"Cm7": 36, "Bb7": 34, "AbM7": 44, "G7": 43, "Fm7": 41, "EbM7": 39, "Gm7": 43}
VERSE = ["AbM7", "AbM7", "G7", "G7", "Cm7", "Cm7", "Bb7", "Bb7"]  # 半小節ずつ
PRE = ["Fm7", "Fm7", "AbM7", "AbM7", "Bb7", "Bb7", "G7", "G7"]
HOOK = ["Cm7", "Bb7", "AbM7", "G7", "Fm7", "Bb7", "EbM7", "G7"]
HOOK_END = HOOK[:-1] + ["Cm7"]
BRIDGE = ["Fm7", "Fm7", "Gm7", "Gm7", "AbM7", "AbM7", "G7", "G7"]


def T(p, ms):
    return (p, "T", ms)  # 1拍の3連


# サビのリード（手書き、C マイナーペンタだけ）: (16分位置, 長さ, MIDI)
HOOK_A = [
    (0, 3, 79), (3, 1, 82), (4, 2, 84), (6, 2, 87),
    (8, 4, 89), (12, 1, 84), (13, 1, 82), (14, 2, 79),  # B♭7 の4拍目に E♭（D と半音）を置かない
    T(16, [84, 82, 79]), (20, 2, 75), (22, 2, 79),
    (24, 6, 77), (30, 1, 79), (31, 1, 82),
    (32, 2, 84), (34, 1, 82), (35, 1, 79), (36, 3, 77), (39, 1, 75),
    (40, 2, 77), (42, 2, 82), (44, 4, 89),
    (48, 3, 91), (51, 1, 89), (52, 2, 87), (54, 2, 82),
    T(56, [79, 77, 79]), (60, 4, 77),
]
HOOK_B = HOOK_A[:-9] + [(40, 2, 77), (42, 1, 82), (43, 1, 84), (44, 4, 89),
                        (48, 1, 91), (49, 1, 89), (50, 1, 87), (51, 1, 84), (52, 4, 82), (56, 8, 79)]
HOOK_Z = HOOK_B[:-1] + [(56, 8, 84)]  # 最後は Cm7 の上で C
# サビ前: 1小節ずつ伸ばして上る
PRE_MEL = [(0, 12, 72), (12, 4, 77), (16, 12, 75), (28, 4, 79), (32, 12, 77), (44, 4, 82), (48, 16, 74)]
# 声のリフ（母音シンセ）: 2・1・2・3｜2・2・1・3 の切り方で和音の音を跳ねる。(位置, 長さ, MIDI)
VRIFF = [
    (0, 2, 72), (2, 1, 75), (3, 2, 79), (5, 3, 75), (8, 2, 70), (10, 2, 72), (12, 1, 75), (13, 3, 67),
    (16, 2, 67), (18, 1, 71), (19, 2, 74), (21, 3, 77), (24, 2, 74), (26, 2, 71), (28, 1, 74), (29, 3, 79),
    (32, 2, 75), (34, 1, 79), (35, 2, 82), (37, 3, 79), (40, 2, 75), (42, 2, 72), (44, 1, 75), (45, 3, 67),
    (48, 2, 77), (50, 1, 74), (51, 2, 70), (53, 3, 77), (56, 2, 80), (58, 2, 77), (60, 1, 74), (61, 3, 72),
]
# 刻み（PSOLA）: (16分位置, モーラ, MIDI, 長さ)。くるくる 0く 1る 2く 3る 4く 5る、シュタイナー 0しゅ 1た 2い 3な 4ー
KURU_A = [(25, 0, 67, 1), (26, 1, 65, 1), (27, 2, 62, 1), (28, 3, 59, 2)]
KURU_B = KURU_A + [(57, 0, 67, 1), (58, 1, 65, 1), (59, 2, 62, 1), (60, 3, 59, 1), (61, 4, 62, 1), (62, 5, 67, 2)]
# 「しゅ」は息だけなので使わず、た・い・な・ー を元の声の高さの近くで（上げすぎると Praat の上限 600Hz を超える）
SHUTA = [(28, 1, 55, 1), (29, 2, 59, 1), (30, 3, 62, 1), (31, 4, 65, 1), (60, 1, 58, 1), (61, 2, 62, 1), (62, 3, 65, 1), (63, 4, 68, 1)]

BLOCKS = [(0, "intro"), (4, "verse"), (8, "verse"), (12, "pre"), (16, "hookA"), (20, "hookB"),
          (24, "verse2"), (28, "verse2"), (32, "hookA"), (36, "hookB"), (40, "bridge"), (44, "bridge"),
          (48, "hookA"), (52, "hookB"), (56, "hookZ"), (60, "outro")]
END_STEP = 60 * BAR + 48  # 61小節目の1拍で曲を切り、あとは生の台詞だけ

RAW = [  # (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部, 表示)
    (16, 2, S.DOIT, None, None),
    (41, 0, S.AITATATA, 1, "あ…"), (43, 0, S.AITATATA, 2, "あい…"), (45, 0, S.AITATATA, 3, "あいた…"),
    (47, 0, S.AITATATA, None, None),
    (61, 2, S.SAIKOU, None, None), (63, 2, S.SUGOIYO, None, None),
]


def harm_of(kind):
    if kind == "hookZ":
        return HOOK_END
    if kind.startswith("hook"):
        return HOOK
    return {"pre": PRE, "bridge": BRIDGE}.get(kind, VERSE)


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            return harm_of(kind)[((step - b0 * BAR) // 96) % 8]
    return "Cm7"


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = B.SIX = Y2.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))
    kuru, shuta, tei = cache[K(S.KURUKURU)], cache[K(S.STEINER)], cache[K(S.TEI)]
    senti = cache[K(S.SENTI)]
    riff_src = G.stable_vowel(senti["path"])

    N = int((NBARS * 16 * SIX + 4) * FS)
    vraw = np.zeros(N)
    layer = {k: np.zeros(N) for k in ("chop", "vowel", "perc")}
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used, prog = [], []
    vnotes = {"chop": 0, "vowel": 0, "perc": 0}
    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t13": []}

    def mark(bar, text, c, kind):
        used.append({"bar": bar, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "kind": kind})

    def lead(b0, mel):
        for it in mel:
            if it[1] == "T":
                tracks["t0"] += [{"startStep": b0 * BAR + it[0] * 12 + k * 16, "durationSteps": 15, "midi": m} for k, m in enumerate(it[2])]
            else:
                p, ln, m = it
                tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": ln * 12 - 2, "midi": m})

    def chops(b0, c, fl, text):
        for p, mi, m, ln in fl:
            x = P.chop(c, mi, G.hz(m), ln * SIX - 0.01)
            x = x * (0.12 / (np.sqrt(np.mean(x ** 2)) + 1e-9))  # 粒ごとの音量をそろえる
            Y2.put(layer["chop"], x, t_of(b0 * BAR + p * 12) - P.lead(c, mi), 2.5)
            vnotes["chop"] += 1
        mark(b0 + 1, text, c, "chop")

    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            if kind == "outro":
                if st < END_STEP:  # 最後の Cm7 を1拍だけ
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Cm7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 36})
                    tracks["t0"].append({"startStep": st, "durationSteps": 46, "midi": 84})
                continue
            tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in CH[name]]
            calm = kind == "intro" or (kind == "bridge" and b0 == 40)
            if calm:
                tracks["t4"].append({"startStep": st, "durationSteps": 90, "midi": ROOT[name]})
            else:
                tracks["t4"] += [{"startStep": st + k, "durationSteps": 20, "midi": ROOT[name] + (12 if (k // 24) % 2 else 0)}
                                 for k in range(0, 96, 24)]
                tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for k in range(12, 96, 24) for m in CH[name]]
            if kind.startswith("hook"):
                seq = sorted(CH[name]) + [sorted(CH[name])[0] + 12]
                order = seq + seq[-2:0:-1]
                tracks["t13"] += [{"startStep": st + k, "durationSteps": 10, "midi": order[(k // 12) % len(order)] + 24} for k in range(0, 96, 12)]
        if kind.startswith("hook"):
            lead(b0, {"hookA": HOOK_A, "hookB": HOOK_B, "hookZ": HOOK_Z}[kind])
            chops(b0, kuru, KURU_A if kind == "hookA" else KURU_B, "（刻み: くるくる を伸ばしの下に16分で）")
        if kind == "pre":
            lead(b0, PRE_MEL)
        if kind in ("intro", "verse", "verse2"):
            for p, ln, m in VRIFF:
                if kind == "verse2" and (28 <= p < 32 or 60 <= p):  # 句末は刻みに譲る
                    continue
                Y2.put(layer["vowel"], G.vsyn(riff_src, m, ln * SIX - 0.015), t_of(b0 * BAR + p * 12), 1.0)
                vnotes["vowel"] += 1
            mark(b0 + 1, "（声のリフ: センチメンタル の母音シンセ）", senti, "instrument")
        if kind == "verse2":
            chops(b0, shuta, SHUTA, "（刻み: シュタイナー を句末に16分で上る）")
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
                for p in (4, 12):
                    Y2.put(layer["perc"], G.burst(tei, 0), t_of(base + p * 12), 18.0)
                    vnotes["perc"] += 1
        if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
            mark(b0 + 1, "（打楽器: てゐー の「て」のスネア）", tei, "perc")

    placed = []
    for bar, beat, clip, upto, label in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(0))  # C マイナーペンタ
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        if upto is not None:  # ため: 先頭のモーラだけ
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        Y2.put(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": label or c["text"], "who": Path(c["path"]).parent.name, "file": str(c["path"]),
                       "transpose": tr, "kind": "raw"})

    vinst = sum(layer.values())
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    daw = {"bpm": BPM, "drum": "four_clap_16hat_snare", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 2 (sawtooth)", "t4": "Synth Bass 2", "t6": "Pad 2 (warm)", "t7": "Electric Piano 1",
                           "t13": "Glockenspiel"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "C minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog, "voiceNotes": vnotes,
            "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
