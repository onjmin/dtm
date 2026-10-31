"""サムソン × 2号式（nigo-mad-analysis.md / notes-samson-2go.md）。声を楽器に作り替え、生の台詞は後半まで隠す。使い捨て。

- vinst.wav: 声の楽器（母音シンセのリフ・導音の線、音節の刻み、子音の打楽器）
- vraw.wav: 生の台詞（ためと落とし、14か所）
- daw.json: 伴奏とリード（手書き）、placement.json: 小節ごとの素材
1小節 = 192 ステップ、16分 = 12。python -I samson_2go_build.py <outdir>
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyworld  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import samson_build as B  # noqa: E402
import samson_v1 as S  # noqa: E402

FS = 44100
BPM = 144
SIX = 15 / BPM
BAR = 192
NBARS = 68
K = V.K

# ── 和音（D マイナー、セブンス）──
CH = {
    "BbM7": [58, 62, 65, 69], "Am7": [57, 60, 64, 67], "Gm7": [55, 58, 62, 65], "C7": [58, 60, 64, 67],
    "FM7": [57, 60, 64, 65], "Em7b5": [55, 58, 62, 64], "A7": [55, 57, 61, 64], "Dm7": [57, 60, 62, 65],
    "D7": [54, 57, 60, 62], "Bbm7": [58, 61, 65, 68], "Ab7": [56, 60, 63, 66],
}
ROOT = {"BbM7": 46, "Am7": 45, "Gm7": 43, "C7": 36, "FM7": 41, "Em7b5": 40, "A7": 45, "Dm7": 38, "D7": 38,
        "Bbm7": 46, "Ab7": 44}
VERSE = ["BbM7", "Am7", "Gm7", "C7", "FM7", "Em7b5", "A7", "Dm7"]  # 半小節ずつ
HOOK = ["Gm7", "C7", "FM7", "BbM7", "Em7b5", "A7", "Dm7", "D7"]  # 5度圏を下る 2-5 の鎖
HOOK_END = HOOK[:-1] + ["Dm7"]
BRIDGE = ["BbM7", "Bbm7", "Am7", "Ab7", "Gm7", "C7", "FM7", "A7"]  # 根音が半音ずつ下がる


def n(p, l, m):
    return (p, l, m)


def T(p, ms):
    return (p, "T", ms)


D4, F4, G4, A4, C5, D5, F5 = 62, 65, 67, 69, 72, 74, 77
G5, A5, C6, D6, F6, G6, A6, C7, D7 = 79, 81, 84, 86, 89, 91, 93, 96, 98

# 母音シンセのリフ（「ンアッー」の型: 3・3・2 の付点で上下）。和音の音だけを踏む
VSYN_RIFF = [
    n(0, 3, A4), n(3, 3, F4), n(6, 2, D5), n(8, 2, C5), n(10, 1, A4), n(11, 3, G4), n(14, 2, A4),
    n(16, 3, G4), n(19, 3, D5), n(22, 2, F4), n(24, 2, G4), n(26, 1, A4), n(27, 3, C5), n(30, 2, D5),
    n(32, 3, A4), n(35, 3, C5), n(38, 2, F5), n(40, 2, D5), n(42, 1, G4), n(43, 3, D5), n(46, 2, G4),
    n(48, 3, A4), n(51, 3, G4), n(54, 2, A4), n(56, 3, D5), n(59, 3, F5), n(62, 2, C5),
]
# サビの母音シンセ: 和音の3度・7度を半音ずつ下る導音の線
GUIDE = {"Gm7": 65, "C7": 64, "FM7": 64, "BbM7": 62, "Em7b5": 62, "A7": 61, "Dm7": 60, "D7": 60,
         "Bbm7": 61, "Ab7": 60, "Am7": 60}
HOOK_MEL = [  # 手書きのリード（D マイナーペンタ D F G A C、A7 の上だけ和音の音）
    n(0, 2, D6), n(2, 1, C6), n(3, 1, D6), n(4, 2, F6), n(6, 2, G6),
    n(8, 3, G6), n(11, 1, F6), n(12, 2, D6), n(14, 2, C6),
    n(16, 2, A5), n(18, 1, C6), n(19, 1, D6), n(20, 4, F6),
    n(24, 3, D6), n(27, 1, C6), n(28, 2, A5), n(30, 1, G5), n(31, 1, A5),
    n(32, 2, G5), n(34, 1, A5), n(35, 1, D6), n(36, 2, G6), n(38, 2, D6),
    T(40, [A6, G6, D6]), n(44, 2, A5), n(46, 1, G5), n(47, 1, A5),
    n(48, 6, D6), n(54, 1, C6), n(55, 1, A5),
    n(56, 2, C6), n(58, 1, D6), n(59, 1, A5), n(60, 2, D6), n(62, 1, A6), n(63, 1, C7),
]
HOOK_MEL_END = HOOK_MEL[:-9] + [n(48, 8, D6), n(56, 4, A6), n(60, 4, D7)]

# (開始小節0始まり, 種類)
BLOCKS = [(0, "intro"), (4, "intro2"), (8, "verse"), (12, "verse"), (16, "hook"), (20, "hook"),
          (24, "verse2"), (28, "verse2"), (32, "hook"), (36, "hook"), (40, "bridge"), (44, "bridge"),
          (48, "hook3"), (52, "hook3"), (56, "hook3"), (60, "hook3end"), (64, "outro")]
END_STEP = 64 * BAR + 96  # 65小節目の2拍目で曲を切り、あとは生の台詞だけ


def harm_of(kind):
    return {"hook3end": HOOK_END}.get(kind) or (HOOK if kind.startswith("hook") else BRIDGE if kind == "bridge" else VERSE)


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            h = harm_of(kind)[((step - b0 * BAR) // 96) % 8]
            return h if isinstance(h, str) else h[0]
    return "Dm7"


# ── 素材: WORLD で分析し、母音・音節を楽器にする ──
_W = {}


def world(path):
    if path not in _W:
        y, _ = librosa.load(str(path), sr=FS, mono=True)
        y = y.astype(np.float64)
        f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=5.0)
        _W[path] = (f0, pyworld.cheaptrick(y, f0, t, FS), pyworld.d4c(y, f0, t, FS))
    return _W[path]


def stable_vowel(path, win=24):
    """有声で音高が一番平らな 120ms（母音の芯）。→ (sp, ap, スコア)"""
    f0, sp, ap = world(path)
    e = np.log(sp.sum(axis=1) + 1e-12)
    best = None
    for a in range(0, len(f0) - win):
        w = f0[a:a + win]
        if (w <= 0).any():
            continue
        s = float(np.std(np.log(w))) - 0.02 * float(e[a:a + win].mean())
        if best is None or s < best[0]:
            best = (s, a)
    s, a = best
    return sp[a:a + win], ap[a:a + win], s


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def vsyn(src, midi, dur, att=0.012, rel=0.05, bright=0.5):
    """母音の芯を往復で伸ばし、f0 を一定の音程にした「声のシンセ」1音。"""
    sp, ap, _ = src
    nf = max(4, int(dur * 200) + 1)
    k = len(sp)
    idx = np.array([(i % (2 * k - 2)) for i in range(nf)])
    idx = np.where(idx < k, idx, 2 * k - 2 - idx)
    f0 = np.full(nf, hz(midi)) * (1 + 0.003 * np.sin(np.arange(nf) / 200 * 2 * np.pi * 5.5))
    x = pyworld.synthesize(f0, sp[idx].copy(), np.clip(ap[idx] * bright, 0, 1), FS, 5.0)
    env = np.ones(len(x))
    a, r = int(att * FS), min(len(x) // 2, int(rel * FS))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return x * env


def chop(c, mi, midi, length):
    """音節 mi を子音頭から length 秒だけ切り、有声部の f0 を midi に揃えた1粒。"""
    f0, sp, ap = world(c["path"])
    m = c["snd"][mi]
    a = int(max(0, m["start"] - 0.005) * 200)
    b = min(len(f0), a + max(3, int(length * 200)))
    f = f0[a:b].copy()
    if midi is not None:
        f[f > 0] = hz(midi)
    x = pyworld.synthesize(f, sp[a:b].copy(), ap[a:b].copy(), FS, 5.0)
    r = min(len(x) // 2, int(0.03 * FS))
    x[-r:] *= np.linspace(1, 0, r)
    x[:64] *= np.linspace(0, 1, 64)
    return x


def burst(c, mi, length=0.07):
    """子音の破裂（打楽器）。高域だけ残す。"""
    x = chop(c, mi, None, length)
    x = x - np.convolve(x, np.ones(9) / 9, mode="same")
    return x * np.exp(-np.arange(len(x)) / (0.02 * FS))


def place(buf, x, t, g=1.0):
    a = int(t * FS)
    m = min(len(x), len(buf) - a)
    if m > 0:
        buf[a:a + m] += g * x[:m]


def near(pc_midi, lo=57, hi=69):
    m = pc_midi
    while m < lo:
        m += 12
    while m > hi:
        m -= 12
    return m


# ── 生の台詞（ためと落とし）: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部) ──
RAW = [
    (16, 2, S.HEREWEGO, None),
    (41, 0, S.AIIN, 1), (43, 0, S.AIIN, 2), (45, 0, S.AIIN, 3), (47, 0, S.AIIN, None),  # 「ん？」: 少しずつ分かる
    (49, 0, S.JACKIE, None), (51, 0, S.KURUKURU, None), (53, 0, S.HICHEW, None), (55, 0, S.DOARA, None),
    (57, 0, S.SUGOIYO, None), (59, 0, S.PSYCHO, None), (61, 0, S.KANJI, None), (63, 0, S.SAIKOU, None),
    (66, 2, S.GORILLA, None),  # 曲が止まったあとの落とし
]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    clips = list(S.ALL)
    V.SECTIONS = [("all", [(K(c), 1) for c in clips])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))

    # 母音シンセの音源: 長い母音のある台詞から、一番平らな芯を選ぶ（リフ用と導音用で別の人の声にはしない: 全部サムソン）
    cands = {name: stable_vowel(cache[K(cl)]["path"]) for name, cl in
             [("にゃー", S.NYA), ("あいーん", S.AIIN), ("どあらー", S.DOARA), ("さいこーっ", S.SAIKOU), ("ひあうぃーごー", S.HEREWEGO)]}
    src_path = {"にゃー": S.NYA, "あいーん": S.AIIN, "どあらー": S.DOARA, "さいこーっ": S.SAIKOU, "ひあうぃーごー": S.HEREWEGO}
    ranked = sorted(cands, key=lambda k: cands[k][2])
    riff_src, guide_src = cands[ranked[0]], cands[ranked[1]]
    print("vowel sources", [(k, round(cands[k][2], 3)) for k in ranked])

    N = int((NBARS * 16 * SIX + 3) * FS)
    vinst = np.zeros(N)
    vraw = np.zeros(N)
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used = []
    vnotes = {"vowel": 0, "chop": 0, "perc": 0}  # 声で鳴らした手書きの音の数（棚の比率用）

    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t13": []}
    prog = []
    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            notes = CH[name]
            if kind == "outro":
                if st < END_STEP:  # 最後の Dm7 を1拍だけ
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Dm7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 38})
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
            # 母音シンセの導音の線（サビとブレイク）
            if kind.startswith("hook") or kind == "bridge":
                g = GUIDE[name]
                place(vinst, vsyn(guide_src, g, 5 * SIX - 0.02), t_of(st), 0.8)
                place(vinst, vsyn(guide_src, g + 12, 2 * SIX - 0.02, rel=0.03), t_of(st + 72), 0.5)
                vnotes["vowel"] += 2
        # リード
        if kind.startswith("hook"):
            mel = HOOK_MEL_END if kind == "hook3end" else HOOK_MEL
            for item in mel:
                if item[1] == "T":
                    for k, m in enumerate(item[2]):
                        tracks["t0"].append({"startStep": b0 * BAR + item[0] * 12 + k * 16, "durationSteps": 15, "midi": m})
                else:
                    p, l, m = item
                    tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m})
        # 母音シンセのリフ（イントロ・Aメロ）
        if kind in ("intro", "intro2", "verse", "verse2"):
            for p, l, m in VSYN_RIFF:
                place(vinst, vsyn(riff_src, m, l * SIX - 0.015), t_of(b0 * BAR + p * 12), 1.0)
                vnotes["vowel"] += 1
            used.append({"bar": b0 + 1, "text": f"（母音シンセのリフ: {ranked[0]} の母音）", "who": src_path[ranked[0]][0].parent.name, "file": str(src_path[ranked[0]][0]), "kind": "instrument"})
        if kind.startswith("hook") or kind == "bridge":
            used.append({"bar": b0 + 1, "text": f"（母音シンセの導音: {ranked[1]} の母音）", "who": src_path[ranked[1]][0].parent.name, "file": str(src_path[ranked[1]][0]), "kind": "instrument"})

    # 刻み: 「ハイ・チュ」を16分に1粒ずつ（Aメロ2・サビ）、和音の根音に揃える
    hc = cache[K(S.HICHEW)]
    wc = cache[K(S.WAWAWA)]
    tc = cache[K(S.TEI)]
    CHOP_A = [(0, 0), (3, 1), (6, 2), (8, 0), (11, 1), (14, 2)]  # (16分位置, 音節)
    for b0, kind in BLOCKS:
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind == "verse2":
                for p, mi in CHOP_A:
                    root = ROOT[chord_at(base + p * 12)] % 12
                    place(vinst, chop(hc, mi, near(root + 12 * 4), 1.6 * SIX), t_of(base + p * 12), 0.9)
                    vnotes["chop"] += 1
            if kind.startswith("hook"):  # 「わっ」を8分裏に、和音の3度で
                for p in (2, 6, 10, 14):
                    nm = chord_at(base + p * 12)
                    third = sorted(CH[nm])[1]
                    place(vinst, chop(wc, 0, near(third, 60, 72), 1.0 * SIX), t_of(base + p * 12), 0.55)
                    vnotes["chop"] += 1
            if kind in ("verse", "verse2") or kind.startswith("hook"):  # 「て」の破裂を2・4拍の裏打ちスネアに
                for p in (4, 12):
                    place(vinst, burst(tc, 0), t_of(base + p * 12), 1.2)
                place(vinst, burst(tc, 0, 0.04), t_of(base + 15 * 12), 0.5)
                vnotes["perc"] += 3
        if kind == "verse2":
            used.append({"bar": b0 + 1, "text": "（刻み: はい・ちゅ を16分に1粒ずつ）", "who": Path(hc["path"]).parent.name, "file": str(hc["path"]), "kind": "chop"})
        if kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（刻み: わっ を8分裏に）", "who": Path(wc["path"]).parent.name, "file": str(wc["path"]), "kind": "chop"})
        if kind in ("verse", "verse2") or kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（打楽器: てぃー の「て」の破裂）", "who": Path(tc["path"]).parent.name, "file": str(tc["path"]), "kind": "perc"})

    # 生の台詞
    placed = []
    for bar, beat, clip, upto in RAW:
        c = cache[K(clip)]
        pcs = B.pent_minor(2)  # D マイナーペンタ
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, pcs)
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = B.render_voice(c, c["pos"] * SIX, ratios)
        if upto is not None:  # ため: 先頭のモーラだけ
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        at = ((bar - 1) * 16 + beat * 4) * SIX + d0
        place(vraw, x, at)
        text = c["text"] if upto is None else c["text"][:upto] + "…"
        placed.append({"bar": bar + beat / 4, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "transpose": tr, "kind": "raw",
                       "correctionCents": [round(float((a - (m + tr)) * 100)) for a, m in zip(q, c["midi"]) if np.isfinite(a) and np.isfinite(m)]})

    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 2 (sawtooth)", "t4": "Synth Bass 2", "t6": "Pad 2 (warm)", "t7": "Electric Piano 1",
                           "t13": "Glockenspiel"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "D minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog,
            "vowelSources": ranked[:2], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "raw", len(placed))


if __name__ == "__main__":
    main()
