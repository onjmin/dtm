"""サムソン × 2号式 3（notes-samson-2go3.md）。samson_2go_build の型をそのまま使い、旋律・和音・台詞だけを差し替える。使い捨て。

声の楽器の量・刻み・打楽器・台詞の数と並べ方・曲の形は samson2go1 と同じ。生の台詞だけ PSOLA で子音を残す。
python -I samson_2go3_build.py <outdir>
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

FS = 44100
BPM = 150
SIX = 15 / BPM
BAR = 192
NBARS = 68
K = V.K
PENT = {4, 7, 9, 11, 2}  # E マイナーペンタ

CH = {
    "CM7": [60, 64, 67, 71], "D7": [57, 60, 62, 66], "Bm7": [57, 59, 62, 66], "Em7": [59, 62, 64, 67],
    "Am7": [57, 60, 64, 67], "GM7": [59, 62, 66, 67], "B7": [57, 59, 63, 66], "Cm7": [58, 60, 63, 67],
    "Bb7": [56, 58, 62, 65], "E7": [56, 59, 62, 64],
}
ROOT = {"CM7": 36, "D7": 38, "Bm7": 47, "Em7": 40, "Am7": 45, "GM7": 43, "B7": 47, "Cm7": 36, "Bb7": 46, "E7": 40}
VERSE = ["Em7", "Em7", "CM7", "CM7", "Am7", "Am7", "B7", "B7"]
HOOK = ["CM7", "D7", "Bm7", "Em7", "Am7", "D7", "GM7", "B7"]  # 王道進行
HOOK_END = HOOK[:-1] + ["Em7"]
BRIDGE = ["CM7", "Cm7", "Bm7", "Bb7", "Am7", "D7", "B7", "B7"]  # 根音が半音ずつ下がる


def n(p, l, m):
    return (p, l, m)


def T(p, ms):
    return (p, "T", ms)


E4, G4, A4, B4, C5, D5, Ds5, E5, Fs5, G5 = 64, 67, 69, 71, 72, 74, 75, 76, 78, 79
A5, B5, D6, E6, G6, A6, B6, D7, E7 = 81, 83, 86, 88, 91, 93, 95, 98, 100

# 母音シンセのリフ（3・3・2 の付点を2回、2小節目と4小節目は 2・1・3 で崩す）。和音の音だけを踏む
VSYN_RIFF = [
    n(0, 3, E5), n(3, 3, B4), n(6, 2, D5), n(8, 3, E5), n(11, 3, B4), n(14, 2, G5),
    n(16, 2, E5), n(18, 1, C5), n(19, 3, G4), n(22, 2, B4), n(24, 3, C5), n(27, 3, E5), n(30, 2, G5),
    n(32, 3, A4), n(35, 3, E5), n(38, 2, C5), n(40, 3, A4), n(43, 3, G5), n(46, 2, E5),
    n(48, 2, Fs5), n(50, 1, Ds5), n(51, 3, B4), n(54, 2, A4), n(56, 3, B4), n(59, 3, Ds5), n(62, 2, Fs5),
]
# サビ・ブレイクの母音シンセ: 和音の3度・7度をなるべく半音・全音で下る導音の線
GUIDE = {"CM7": 64, "D7": 66, "Bm7": 66, "Em7": 67, "Am7": 67, "GM7": 66, "B7": 63, "Cm7": 63, "Bb7": 62, "E7": 64}
HOOK_MEL = [  # 手書きのリード（E マイナーペンタ E G A B D だけ）
    n(0, 3, B5), n(3, 3, E6), n(6, 2, G6),
    n(8, 6, A6), n(14, 1, G6), n(15, 1, E6),
    n(16, 2, D6), n(18, 1, B5), n(19, 1, D6), n(20, 2, E6), n(22, 2, D6),
    T(24, [B6, A6, G6]), n(28, 4, E6),
    n(32, 3, A5), n(35, 3, D6), n(38, 2, E6),
    n(40, 2, A6), n(42, 1, B6), n(43, 1, A6), n(44, 2, D6), n(46, 1, E6), n(47, 1, G6),
    n(48, 6, B6), n(54, 1, A6), n(55, 1, G6),
    n(56, 2, B6), n(58, 1, A6), n(59, 1, B6), n(60, 3, A6), n(63, 1, A5),
]
HOOK_MEL_END = HOOK_MEL[:-5] + [n(56, 4, E6), n(60, 4, E7)]

BLOCKS = [(0, "intro"), (4, "intro2"), (8, "verse"), (12, "verse"), (16, "hook"), (20, "hook"),
          (24, "verse2"), (28, "verse2"), (32, "hook"), (36, "hook"), (40, "bridge"), (44, "bridge"),
          (48, "hook3"), (52, "hook3"), (56, "hook3"), (60, "hook3end"), (64, "outro")]
END_STEP = 64 * BAR + 96


def harm_of(kind):
    return {"hook3end": HOOK_END}.get(kind) or (HOOK if kind.startswith("hook") else BRIDGE if kind == "bridge" else VERSE)


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            return harm_of(kind)[((step - b0 * BAR) // 96) % 8]
    return "Em7"


# 生の台詞: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部)
RAW = [
    (16, 2, S.ARCHER, None),
    (41, 0, S.DAMEDAME, 1), (43, 0, S.DAMEDAME, 3), (45, 0, S.DAMEDAME, 5), (47, 0, S.DAMEDAME, None),
    (49, 0, S.MOUIKKAI, None), (51, 0, S.ZOU, None), (53, 0, S.STEINER, None), (55, 0, S.NYA, None),
    (57, 0, S.KOWAI, None), (59, 0, S.ASHI, None), (61, 0, S.MATTETE, None), (63, 0, S.SENTI, None),
    (66, 2, S.AITATATA, None),
]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    G.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))

    # 母音シンセの音源は samson2go1 で使っていない台詞から、一番平らな芯を選ぶ
    names = [("にゃー", S.NYA), ("せんちめんたる", S.SENTI), ("だめだめ", S.DAMEDAME), ("こわいねぇ", S.KOWAI), ("どぅーいっと", S.DOIT)]
    cands = {k: G.stable_vowel(cache[K(cl)]["path"]) for k, cl in names}
    src_path = dict(names)
    ranked = sorted(cands, key=lambda k: cands[k][2])
    riff_src, guide_src = cands[ranked[0]], cands[ranked[1]]
    print("vowel sources", [(k, round(cands[k][2], 3)) for k in ranked])

    N = int((NBARS * 16 * SIX + 3) * FS)
    layer = {k: np.zeros(N) for k in ("vowel", "chop", "perc")}
    vraw = np.zeros(N)
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used = []
    vnotes = {"vowel": 0, "chop": 0, "perc": 0}

    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t13": []}
    prog = []
    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            notes = CH[name]
            if kind == "outro":
                if st < END_STEP:
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Em7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 40})
                continue
            tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in notes]
            if kind not in ("intro",):
                for k in range(0, 96, 24):
                    if kind == "bridge" and b0 == 40:
                        break
                    tracks["t4"].append({"startStep": st + k, "durationSteps": 20, "midi": ROOT[name] + (12 if (k // 24) % 2 else 0)})
            if kind in ("verse", "verse2", "hook", "hook3", "hook3end"):
                for k in range(12, 96, 24):
                    tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for m in notes]
            if kind.startswith("hook"):
                seq = sorted(notes) + [sorted(notes)[0] + 12]
                order = seq + seq[-2:0:-1]
                for k in range(0, 96, 12):
                    tracks["t13"].append({"startStep": st + k, "durationSteps": 10, "midi": order[(k // 12) % len(order)] + 24})
            if kind.startswith("hook") or kind == "bridge":
                g = GUIDE[name]
                G.place(layer["vowel"], G.vsyn(guide_src, g, 5 * SIX - 0.02), t_of(st), 0.8)
                G.place(layer["vowel"], G.vsyn(guide_src, g + 12, 2 * SIX - 0.02, rel=0.03), t_of(st + 72), 0.5)
                vnotes["vowel"] += 2
        if kind.startswith("hook"):
            mel = HOOK_MEL_END if kind == "hook3end" else HOOK_MEL
            for item in mel:
                if item[1] == "T":
                    for k, m in enumerate(item[2]):
                        tracks["t0"].append({"startStep": b0 * BAR + item[0] * 12 + k * 16, "durationSteps": 15, "midi": m})
                else:
                    p, l, m = item
                    tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m})
        if kind in ("intro", "intro2", "verse", "verse2"):
            for p, l, m in VSYN_RIFF:
                G.place(layer["vowel"], G.vsyn(riff_src, m, l * SIX - 0.015), t_of(b0 * BAR + p * 12), 1.0)
                vnotes["vowel"] += 1
            used.append({"bar": b0 + 1, "text": f"（母音シンセのリフ: {ranked[0]} の母音）", "who": src_path[ranked[0]][0].parent.name, "file": str(src_path[ranked[0]][0]), "kind": "instrument"})
        if kind.startswith("hook") or kind == "bridge":
            used.append({"bar": b0 + 1, "text": f"（母音シンセの導音: {ranked[1]} の母音）", "who": src_path[ranked[1]][0].parent.name, "file": str(src_path[ranked[1]][0]), "kind": "instrument"})

    # 刻み: 「く・る」を16分に1粒ずつ（Aメロ2）、「わっ」を8分裏（サビ）、「て」の破裂をスネア
    kc = cache[K(S.KURUKURU)]
    wc = cache[K(S.WAWAWA)]
    tc = cache[K(S.TEI)]
    CHOP_A = [(0, 0), (3, 1), (6, 0), (8, 1), (11, 0), (14, 1)]
    for b0, kind in BLOCKS:
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind == "verse2":
                for p, mi in CHOP_A:
                    root = ROOT[chord_at(base + p * 12)] % 12
                    G.place(layer["chop"], G.chop(kc, mi, G.near(root + 12 * 4), 1.6 * SIX), t_of(base + p * 12), 0.9)
                    vnotes["chop"] += 1
            if kind.startswith("hook"):
                for p in (2, 6, 10, 14):
                    third = sorted(CH[chord_at(base + p * 12)])[1]
                    G.place(layer["chop"], G.chop(wc, 0, G.near(third, 60, 72), 1.0 * SIX), t_of(base + p * 12), 0.55)
                    vnotes["chop"] += 1
            if kind in ("verse", "verse2") or kind.startswith("hook"):
                for p in (4, 12):
                    G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 1.2)
                G.place(layer["perc"], G.burst(tc, 0, 0.04), t_of(base + 15 * 12), 0.5)
                vnotes["perc"] += 3
        if kind == "verse2":
            used.append({"bar": b0 + 1, "text": "（刻み: く・る を16分に1粒ずつ）", "who": Path(kc["path"]).parent.name, "file": str(kc["path"]), "kind": "chop"})
        if kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（刻み: わっ を8分裏に）", "who": Path(wc["path"]).parent.name, "file": str(wc["path"]), "kind": "chop"})
        if kind in ("verse", "verse2") or kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（打楽器: てぃー の「て」の破裂）", "who": Path(tc["path"]).parent.name, "file": str(tc["path"]), "kind": "perc"})

    placed = []
    for bar, beat, clip, upto in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(4))
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        if upto is not None:
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        fr = np.abs(x) > 0.05 * np.abs(x).max()  # 台詞ごとの録音レベル差（5倍以上）をならす
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        G.place(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        text = c["text"] if upto is None else c["text"][:upto] + "…"
        placed.append({"bar": bar + beat / 4, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "transpose": tr, "kind": "raw"})

    vinst = sum(layer.values())
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 2 (sawtooth)", "t4": "Synth Bass 2", "t6": "Pad 2 (warm)", "t7": "Electric Piano 1",
                           "t13": "Glockenspiel"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "E minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog,
            "vowelSources": ranked[:2], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
