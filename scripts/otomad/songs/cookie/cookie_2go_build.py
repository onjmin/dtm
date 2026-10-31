"""クッキー☆ × 2号式 1（notes-cookie-2go1.md）。samson_2go_build の型で、UDK姉貴の声だけを使い、旋律・和音・台詞を差し替える。使い捨て。

声の楽器の量・刻み・打楽器・台詞の数と並べ方・曲の形は samson2go1 と同じ。生の台詞だけ PSOLA で子音を残す。
python -I cookie_2go_build.py <outdir>
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
import cookie_v1 as C  # noqa: E402

FS = 44100
BPM = 150
SIX = 15 / BPM
BAR = 192
NBARS = 68
K = V.K
PENT = {9, 0, 2, 4, 7}  # A マイナーペンタ
D, U = C.D, C.S
q = C.q
YUKKURI, REU4, OSS, DANMAKU, URUSEE = C.YUKKURI, C.REU4, C.OSS, C.DANMAKU, C.URUSEE
SOONANOKA, JUDGE, NOBITA, NAICHAU, NAKUTO, UU = C.SOONANOKA, C.JUDGE, C.NOBITA, C.NAICHAU, C.NAKUTO, C.UU
AA = q(U / "あー.wav", "あー")
ARIGATTO = q(U / "ありがっとぉーー.wav", "ありがっとぉー")
YUYUSAMA = q(D / "幽々様～！.wav", "ゆゆさまー")
RANRAN = q(D / "ランランルー.wav", "らんらんるー")
UWA = q(U / "うわっ！.wav", "うわっ")
POPORO = q(U / "ポポロクロイス.wav", "ぽぽろくろいす")
ALL = [YUKKURI, REU4, OSS, DANMAKU, URUSEE, SOONANOKA, JUDGE, NOBITA, NAICHAU, NAKUTO, UU,
       AA, ARIGATTO, YUYUSAMA, RANRAN, UWA, POPORO, C.YAMETE]

CH = {
    "Am7": [57, 60, 64, 67], "Dm7": [57, 60, 62, 65], "G7": [59, 62, 65, 67], "CM7": [59, 60, 64, 67],
    "FM7": [57, 60, 64, 65], "Bm7b5": [57, 59, 62, 65], "E7": [56, 59, 62, 64], "A7": [57, 61, 64, 67],
    "Fm7": [56, 60, 63, 65], "Em7": [59, 62, 64, 67], "Eb7": [58, 61, 63, 67],
}
ROOT = {"Am7": 45, "Dm7": 38, "G7": 43, "CM7": 36, "FM7": 41, "Bm7b5": 47, "E7": 40, "A7": 45, "Fm7": 41, "Em7": 40, "Eb7": 39}
VERSE = ["Am7", "Am7", "Dm7", "G7", "CM7", "FM7", "Bm7b5", "E7"]  # 5度圏で下る
HOOK = ["Dm7", "G7", "CM7", "FM7", "Bm7b5", "E7", "Am7", "A7"]
HOOK_END = HOOK[:-1] + ["Am7"]
BRIDGE = ["FM7", "Fm7", "Em7", "Eb7", "Dm7", "G7", "E7", "E7"]  # 根音が半音ずつ下がる


def n(p, l, m):
    return (p, l, m)


def T(p, ms):
    return (p, "T", ms)


A4, B4, C5, D5, E5, F5, G5, Gs5, A5, B5 = 69, 71, 72, 74, 76, 77, 79, 80, 81, 83
C6, D6, E6, G6, A6, C7 = 84, 86, 88, 91, 93, 96

# 母音シンセのリフ（2・2・3・1 ＋ 2・3・3 を毎小節、終わりの小節だけ8分で下る）。和音の音だけを踏む
VSYN_RIFF = [
    n(0, 2, A4), n(2, 2, E5), n(4, 3, G5), n(7, 1, E5), n(8, 2, A5), n(10, 3, G5), n(13, 3, E5),
    n(16, 2, D5), n(18, 2, F5), n(20, 3, A5), n(23, 1, F5), n(24, 2, G5), n(26, 3, F5), n(29, 3, D5),
    n(32, 2, E5), n(34, 2, G5), n(36, 3, B5), n(39, 1, G5), n(40, 2, A5), n(42, 3, F5), n(45, 3, E5),
    n(48, 2, D5), n(50, 2, F5), n(52, 3, A5), n(55, 1, F5), n(56, 2, Gs5), n(58, 2, E5), n(60, 2, D5), n(62, 2, B4),
]
# サビ・ブレイクの母音シンセ: 和音の3度・7度をなるべく半音・全音で下る導音の線
GUIDE = {"Dm7": 65, "G7": 65, "CM7": 64, "FM7": 64, "Bm7b5": 62, "E7": 62, "Am7": 60, "A7": 61,
         "Fm7": 63, "Em7": 62, "Eb7": 61}
HOOK_MEL = [  # 手書きのリード（A マイナーペンタ A C D E G だけ）
    n(0, 2, D6), n(2, 2, E6), n(4, 4, A6), n(8, 3, G6), n(11, 1, E6), n(12, 2, D6), n(14, 2, C6),
    n(16, 3, E6), n(19, 3, G6), n(22, 2, E6), n(24, 4, A6), n(28, 2, G6), n(30, 2, E6),
    n(32, 2, D6), n(34, 1, C6), n(35, 1, D6), n(36, 4, A5), n(40, 3, E6), n(43, 3, D6), n(46, 2, E6),
    T(48, [C7, A6, G6]), n(52, 4, A6), n(56, 3, E6), n(59, 1, G6), n(60, 2, A6), n(62, 2, G6),
]
HOOK_MEL_END = HOOK_MEL[:-4] + [n(56, 4, E6), n(60, 4, A6)]

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
    return "Am7"


# 生の台詞: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部)
RAW = [
    (16, 2, YUKKURI, None),
    (41, 0, REU4, 1), (43, 0, REU4, 3), (45, 0, REU4, 5), (47, 0, REU4, None),
    (49, 0, OSS, None), (51, 0, DANMAKU, None), (53, 0, URUSEE, None), (55, 0, SOONANOKA, None),
    (57, 0, JUDGE, None), (59, 0, NOBITA, None), (61, 0, NAICHAU, None), (63, 0, NAKUTO, None),
    (66, 2, UU, None),
]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    G.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(64.0 - med), -3, 3))  # 女声の真ん中へ

    # 母音シンセの音源は、生の台詞に使わない語から一番平らな芯を選ぶ
    names = [("あー", AA), ("ありがっとぉー", ARIGATTO), ("ゆゆさまー", YUYUSAMA), ("やめてよー", C.YAMETE)]
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
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Am7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 45})
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

    # 刻み: 「ら・ん」を16分に1粒ずつ（Aメロ2）、「わっ」を8分裏（サビ）、「ぽ」の破裂をスネア
    kc = cache[K(RANRAN)]
    wc = cache[K(UWA)]
    tc = cache[K(POPORO)]
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
                    G.place(layer["chop"], G.chop(wc, 1, G.near(third, 60, 72), 1.0 * SIX), t_of(base + p * 12), 0.55)
                    vnotes["chop"] += 1
            if kind in ("verse", "verse2") or kind.startswith("hook"):
                for p in (4, 12):
                    G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 1.2)
                G.place(layer["perc"], G.burst(tc, 0, 0.04), t_of(base + 15 * 12), 0.5)
                vnotes["perc"] += 3
        if kind == "verse2":
            used.append({"bar": b0 + 1, "text": "（刻み: ら・ん を16分に1粒ずつ）", "who": Path(kc["path"]).parent.name, "file": str(kc["path"]), "kind": "chop"})
        if kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（刻み: わっ を8分裏に）", "who": Path(wc["path"]).parent.name, "file": str(wc["path"]), "kind": "chop"})
        if kind in ("verse", "verse2") or kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（打楽器: ぽぽろくろいす の「ぽ」の破裂）", "who": Path(tc["path"]).parent.name, "file": str(tc["path"]), "kind": "perc"})

    placed = []
    for bar, beat, clip, upto in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(9))
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
    info = {"bpm": BPM, "key": "A minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog,
            "vowelSources": ranked[:2], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
