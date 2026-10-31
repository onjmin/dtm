"""KBTIT × 2号式（notes-kbt-2go.md）。手書きのリードを主役に、16分の走りと伸ばしの二極。声は合いの手・母音パッド・せり上がり。使い捨て。

- vinst.wav（と vinst_<層>.wav）: 声の楽器、vraw.wav: 生の台詞
- daw.json: 伴奏とリード（手書き）、placement.json: 小節ごとの素材
1小節 = 192 ステップ、16分 = 12。python -I kbt_2go_build.py <outdir>
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
import kbt_v1 as KB  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import yaju_2go_build as Y2  # noqa: E402

FS = G.FS
BPM = 168
SIX = 15 / BPM
BAR = 192
NBARS = 64
K = V.K
PENT = {7, 10, 0, 2, 5}  # G マイナーペンタ（check 用）

CH = {
    "Gm7": [55, 58, 62, 65], "Cm7": [58, 60, 63, 67], "EbM7": [58, 62, 63, 67], "D7": [57, 60, 62, 66],
    "F7": [57, 60, 63, 65], "Dm7": [57, 60, 62, 65], "BbM7": [57, 58, 62, 65],
}
ROOT = {"Gm7": 43, "Cm7": 36, "EbM7": 39, "D7": 38, "F7": 41, "Dm7": 38, "BbM7": 34}
VERSE = ["Gm7", "Gm7", "EbM7", "EbM7", "Cm7", "Cm7", "D7", "D7"]  # 半小節ずつ
PRE = ["Cm7", "Cm7", "Dm7", "Dm7", "EbM7", "EbM7", "D7", "D7"]
HOOK = ["EbM7", "F7", "Dm7", "Gm7", "Cm7", "F7", "BbM7", "D7"]
HOOK_END = HOOK[:-1] + ["Gm7"]
BRIDGE = ["Cm7", "Dm7", "EbM7", "F7", "Cm7", "Dm7", "EbM7", "D7"]

# サビのリード（手書き）: (16分位置, 長さ, MIDI)。伸ばしと16分の走りを交互に
HOOK_A = [
    (0, 6, 79), (6, 1, 81), (7, 1, 82),
    (8, 4, 84), (12, 1, 81), (13, 1, 79), (14, 1, 77), (15, 1, 75),
    (16, 1, 74), (17, 1, 77), (18, 1, 81), (19, 1, 84), (20, 7, 86),
    (27, 1, 84), (28, 1, 82), (29, 1, 81), (30, 1, 79), (31, 1, 77),
    (32, 4, 79), (36, 1, 75), (37, 1, 77), (38, 1, 79), (39, 1, 82),
    (40, 4, 84), (44, 1, 87), (45, 1, 84), (46, 1, 81), (47, 1, 77),
    (48, 6, 81), (54, 1, 82), (55, 1, 84),
    (56, 1, 86), (57, 1, 84), (58, 1, 81), (59, 1, 78), (60, 4, 81),
]
HOOK_B = HOOK_A[:-8] + [(48, 4, 86), (52, 1, 84), (53, 1, 86), (54, 2, 89), (56, 6, 90), (62, 1, 88), (63, 1, 86)]
HOOK_Z = HOOK_A[:-5] + [(56, 1, 86), (57, 1, 82), (58, 1, 79), (59, 1, 74), (60, 4, 79)]  # 最後は G で終える
# Aメロのリード: 8分中心で低く
VERSE_MEL = [
    (0, 2, 74), (2, 2, 77), (4, 4, 79), (8, 2, 77), (10, 2, 74), (12, 4, 70),
    (16, 2, 70), (18, 2, 72), (20, 6, 74),
    (32, 2, 75), (34, 2, 74), (36, 4, 72), (40, 2, 70), (42, 2, 72), (44, 4, 75),
    (48, 2, 74), (50, 2, 72), (52, 4, 69), (56, 4, 66),
]
# 合いの手: 信じらんねぇ（0し 1ん 2じ 3ら 4ん 5ね 6ぇ）を (16分位置, モーラ, MIDI, 長さ)
FILL_VERSE = [(28, 0, 70, 1), (29, 1, 67, 1), (30, 2, 63, 1), (31, 3, 62, 1), (60, 4, 62, 1), (61, 5, 60, 1), (62, 6, 57, 2)]
FILL_HOOK_A = [(21, 0, 69, 1), (22, 1, 65, 1), (23, 2, 62, 1), (24, 3, 67, 1), (25, 4, 62, 1), (26, 5, 58, 1), (27, 6, 55, 2),
               (49, 0, 65, 1), (50, 1, 62, 1), (51, 2, 58, 1), (52, 3, 57, 2)]
FILL_HOOK_B = FILL_HOOK_A[:7] + [(57, 4, 66, 1), (58, 5, 62, 1), (59, 6, 57, 2)]
# サビ前: 卍解～ の母音で和音の音を1拍ずつせり上がる
RISER = [55, 58, 60, 63, 62, 65, 69, 72, 67, 70, 74, 75, 74, 78, 81, 84]

BLOCKS = [(0, "intro"), (4, "verse"), (8, "verse"), (12, "pre"), (16, "hookA"), (20, "hookB"),
          (24, "verse2"), (28, "verse2"), (32, "hookA"), (36, "hookB"), (40, "bridge"), (44, "bridge"),
          (48, "hookA"), (52, "hookB"), (56, "hookZ"), (60, "outro")]
END_STEP = 60 * BAR + 48  # 61小節目の1拍で曲を切り、あとは生の台詞だけ

RAW = [  # (小節1始まり, 拍, 台詞)
    (4, 2, KB.IKUDE),
    (41, 0, KB.N), (43, 0, KB.N), (45, 0, KB.USSO), (47, 0, KB.GORAN),
    (61, 2, KB.NASU),
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
    return "Gm7"


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = B.SIX = Y2.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in KB.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))
    shinji, ikude = cache[K(KB.SHINJI)], cache[K(KB.IKUDE)]
    pad_src = G.stable_vowel(cache[K(KB.OO)]["path"])
    riser_src = G.stable_vowel(cache[K(KB.BANKAI)]["path"])

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
        for p, ln, m in mel:
            tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": ln * 12 - 2, "midi": m})

    def fills(b0, fl):
        for p, mi, m, ln in fl:
            # 刻みは元の波形を PSOLA で（WORLD で作り直すと子音とフォルマントがなまる）
            Y2.put(layer["chop"], P.chop(shinji, mi, G.hz(m), ln * SIX - 0.01), t_of(b0 * BAR + p * 12) - P.lead(shinji, mi), 2.0)
            vnotes["chop"] += 1
        mark(b0 + 1, "（合いの手: 信じらんねぇ を16分に刻む）", shinji, "chop")

    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            if kind == "outro":
                if st < END_STEP:  # 最後の Gm7 を1拍だけ
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Gm7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 43})
                    tracks["t0"].append({"startStep": st, "durationSteps": 46, "midi": 79})
                continue
            tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in CH[name]]
            if kind == "intro" or (kind == "bridge" and b0 == 40):
                tracks["t4"].append({"startStep": st, "durationSteps": 90, "midi": ROOT[name]})
            else:
                tracks["t4"] += [{"startStep": st + k, "durationSteps": 20, "midi": ROOT[name] + (12 if (k // 24) % 2 else 0)}
                                 for k in range(0, 96, 24)]
            if kind != "intro" and not (kind == "bridge" and b0 == 40):
                tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for k in range(12, 96, 24) for m in CH[name]]
            if kind.startswith("hook"):
                seq = sorted(CH[name]) + [sorted(CH[name])[0] + 12]
                order = seq + seq[-2:0:-1]
                tracks["t13"] += [{"startStep": st + k, "durationSteps": 10, "midi": order[(k // 12) % len(order)] + 24} for k in range(0, 96, 12)]
            # 母音パッド（おー）: イントロ・サビ・ブレイクで和音の上3音
            if kind in ("intro", "bridge") or kind.startswith("hook"):
                for m in sorted(CH[name])[1:]:
                    Y2.put(layer["vowel"], G.vsyn(pad_src, m, 7.6 * SIX, att=0.06, rel=0.12, bright=0.4), t_of(st), 0.18)
                    vnotes["vowel"] += 1
        # リード
        if kind.startswith("hook"):
            lead(b0, {"hookA": HOOK_A, "hookB": HOOK_B, "hookZ": HOOK_Z}[kind])
            fills(b0, FILL_HOOK_B if kind == "hookB" else FILL_HOOK_A)
        if kind in ("verse", "verse2"):
            lead(b0, VERSE_MEL)
            fills(b0, FILL_VERSE)
        if kind == "pre":
            for j, m in enumerate(RISER):
                Y2.put(layer["vowel"], G.vsyn(riser_src, m, 3.8 * SIX, att=0.02, rel=0.05, bright=0.5), t_of(b0 * BAR + j * 48), 0.7)
                vnotes["vowel"] += 1
            mark(b0 + 1, "（せり上がり: 卍解～ の母音）", cache[K(KB.BANKAI)], "instrument")
        if kind in ("intro", "bridge") or kind.startswith("hook"):
            mark(b0 + 1, "（母音パッド: おー の母音）", cache[K(KB.OO)], "instrument")
        # 打楽器: 行くでー の「く」を2・4拍のスネアに、信じらんねぇ の「し」を16分裏のハットに
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
                for p in (4, 12):
                    Y2.put(layer["perc"], G.burst(ikude, 1, 0.07), t_of(base + p * 12), 25.0)
                    vnotes["perc"] += 1
            if kind.startswith("hook") or kind == "verse2":
                for p in (2, 6, 10, 14):
                    Y2.put(layer["perc"], G.burst(shinji, 0, 0.04), t_of(base + p * 12), 12.0)
                    vnotes["perc"] += 1
        if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
            mark(b0 + 1, "（打楽器: 行くでー の「く」のスネア）", ikude, "perc")

    placed = []
    for bar, beat, clip in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(7))  # G マイナーペンタ
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        Y2.put(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": c["text"], "who": Path(c["path"]).parent.name, "file": str(c["path"]),
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
    info = {"bpm": BPM, "key": "G minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog, "voiceNotes": vnotes,
            "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
