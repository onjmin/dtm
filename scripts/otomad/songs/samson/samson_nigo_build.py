"""サムソン × 2号スタイル（notes-samson-nigo.md）。旋律・和音・アルペジオは手書き、台詞は合いの手。使い捨て。

1小節 = 192 ステップ、16分 = 12、3連8分 = 16。
python -I samson_nigo_build.py <outdir>
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
import samson_build as B  # noqa: E402
import samson_v1 as S  # noqa: E402

BPM = 150
SIX = 15 / BPM
BAR = 192
K = V.K

# ── 和音（セブンス、中音域のボイシング）──
CH = {
    "Am7": [57, 60, 64, 67], "Dm7": [62, 65, 69, 72], "G7": [55, 59, 62, 65], "CM7": [60, 64, 67, 71],
    "FM7": [53, 57, 60, 64], "Em7": [52, 55, 59, 62], "E7": [56, 59, 62, 64], "Bm7b5": [59, 62, 65, 69],
    "Gm7": [55, 58, 62, 65], "C7": [60, 64, 67, 70], "Fm7": [53, 56, 60, 63], "A7": [57, 61, 64, 67],
    "Db7": [61, 65, 68, 71], "B7": [59, 63, 66, 69], "Bbm7": [58, 61, 65, 68],
}
ROOT = {"Am7": 45, "Dm7": 38, "G7": 43, "CM7": 36, "FM7": 41, "Em7": 40, "E7": 40, "Bm7b5": 47, "Gm7": 43,
        "C7": 36, "Fm7": 41, "A7": 45, "Db7": 37, "B7": 35, "Bbm7": 34}
# 半小節ずつ（タプルは1拍ずつ）
VERSE = ["Am7", "Dm7", "G7", "CM7", "FM7", "Em7", "Am7", "E7"]
HOOK_A = ["FM7", "Em7", "Dm7", "G7", "CM7", ("Bm7b5", "E7"), "Am7", "Am7"]
HOOK_B = ["FM7", "E7", "Am7", ("Gm7", "C7"), "FM7", "Fm7", "Em7", "A7"]
BRIDGE = ["Dm7", "Db7", "CM7", "B7", "Bbm7", "A7", "Dm7", "E7"]


def n(p, l, m):
    return (p, l, m)


def T(p, ms):
    return (p, "T", ms)


# ── リード（手書き）。A マイナーペンタ: A C D E G ──
A4, C5, D5, E5, G5, A5, C6, D6, E6, G6, A6, C7 = 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96
RIFF = [  # Aメロ: 低めの16分リフ、2号らしく8分を短く切る
    n(0, 1, A4), n(1, 1, C5), n(2, 1, E5), n(4, 1, D5), n(5, 1, E5), n(6, 1, G5), n(7, 1, E5),
    n(8, 1, D5), n(9, 1, A4), n(10, 2, C5), n(12, 1, D5), n(13, 1, E5), n(14, 2, A5),
    n(16, 1, G5), n(17, 1, E5), n(18, 1, D5), n(19, 1, E5), n(20, 2, G5), n(22, 1, A5), n(23, 1, G5),
    n(24, 2, E5), n(26, 1, G5), n(27, 1, E5), n(28, 2, D5), n(30, 1, C5), n(31, 1, D5),
    n(32, 1, A4), n(33, 1, C5), n(34, 1, D5), n(35, 1, E5), n(36, 1, G5), n(37, 1, A5), n(38, 2, C6),
    T(40, [A5, G5, E5]), n(44, 2, D5), n(46, 2, E5),
    n(48, 3, A5), n(51, 1, G5), n(52, 2, E5), n(54, 1, D5), n(55, 1, C5), n(56, 2, E5), n(58, 1, D5), n(59, 1, E5),
    n(60, 2, G5), n(62, 1, A5), n(63, 1, G5),
]
HOOK_A_MEL = [  # サビA: 跳ね上がる動機を2回、3小節目で最高音へ
    n(0, 2, E6), n(2, 1, D6), n(3, 1, E6), n(4, 2, G6), n(6, 2, A6), n(8, 3, G6), n(11, 1, E6), n(12, 2, D6), n(14, 2, E6),
    n(16, 2, A5), n(18, 1, C6), n(19, 1, D6), n(20, 4, E6), n(24, 2, D6), n(26, 1, C6), n(27, 1, A5), n(28, 2, G5), n(30, 2, A5),
    n(32, 2, E6), n(34, 1, D6), n(35, 1, E6), n(36, 2, G6), n(38, 2, A6), T(40, [A6, G6, E6]), n(44, 2, E6), n(46, 1, D6), n(47, 1, E6),
    n(48, 6, A6), n(54, 1, G6), n(55, 1, E6), n(56, 2, D6), n(58, 1, E6), n(59, 1, G6), n(60, 2, A6), n(62, 1, C7), n(63, 1, A6),
]
HOOK_B_MEL = [  # サビB: 上から下りる答え。借用の Fm7 では C を伸ばす
    n(0, 3, C7), n(3, 1, A6), n(4, 2, G6), n(6, 2, E6), n(8, 2, D6), n(10, 2, E6), T(12, [G6, E6, D6]),
    n(16, 2, E6), n(18, 2, A6), n(20, 1, G6), n(21, 1, E6), n(22, 2, D6), n(24, 2, G6), n(26, 2, D6), n(28, 2, E6), n(30, 2, G6),
    n(32, 3, A6), n(35, 1, G6), n(36, 2, E6), n(38, 2, C6), n(40, 2, C6), n(42, 2, G6), n(44, 4, C7),
    n(48, 2, E6), n(50, 2, G6), n(52, 1, D6), n(53, 1, E6), n(54, 2, G6), n(56, 2, A6), n(58, 2, G6), n(60, 2, E6), n(62, 1, G6), n(63, 1, A6),
]
HOOK_B_END = HOOK_B_MEL[:-10] + [n(48, 8, A6), n(56, 8, C7)]
BRIDGE_MEL = [  # ブレイク後半: A7 の上を3連で駆け上がる（B♭m7 の間は休む）
    T(40, [E5, G5, A5]), T(44, [E6, G6, A6]),
    n(48, 4, A6), n(52, 4, G6), n(56, 2, E6), n(58, 2, D6), T(60, [E6, G6, A6]),
]


def lead_notes(block, at_bar, shift=0):
    out = []
    for item in block:
        if item[1] == "T":
            for k, m in enumerate(item[2]):
                out.append({"startStep": at_bar * BAR + item[0] * 12 + k * 16, "durationSteps": 15, "midi": m + shift})
        else:
            p, l, m = item
            out.append({"startStep": at_bar * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m + shift})
    return out


# (開始小節0始まり, 種類)
BLOCKS = [(0, "intro"), (4, "introlead"), (8, "A"), (12, "A"), (16, "HA"), (20, "HB"), (24, "A"), (28, "A"),
          (32, "HA"), (36, "HB"), (40, "bridge"), (44, "bridge2"), (48, "HA"), (52, "HB"), (56, "HA+"), (60, "HBend+"),
          (64, "outro")]
NBARS = 68


def spec(kind):
    """→ (和声, リード, 移調, 層: パッド, 刻み, ベース, アルペジオ)"""
    sh = 2 if "+" in kind else 0
    if kind.startswith("HA"):
        return HOOK_A, HOOK_A_MEL, sh, (True, True, True, True)
    if kind.startswith("HB"):
        return HOOK_B, (HOOK_B_END if "end" in kind else HOOK_B_MEL), sh, (True, True, True, True)
    if kind == "bridge":
        return BRIDGE, None, 0, (True, False, False, True)
    if kind == "bridge2":
        return BRIDGE, BRIDGE_MEL, 0, (True, True, True, False)
    if kind == "intro":
        return VERSE, None, 0, (True, False, True, False)
    if kind == "outro":
        return VERSE, None, 0, (True, False, False, False)
    return VERSE, RIFF, 0, (True, True, True, False)


# ── 台詞（合いの手）: (小節1始まり, 拍0-3, 台詞) ──
SPEECH = [
    (3, 0, S.DOIT), (8, 2, S.HEREWEGO),
    (9, 0, S.KOWAI), (10, 2, S.MATTETE), (12, 0, S.MOUIKKAI), (14, 0, S.AITATATA), (15, 2, S.SENTI),
    (17, 0, S.HICHEW), (18, 2, S.AIIN), (19, 0, S.KURUKURU), (20, 2, S.DOARA),
    (21, 0, S.HICHEW), (22, 2, S.TEI), (23, 0, S.JACKIE),
    (25, 0, S.DAMEDAME), (26, 2, S.PSYCHO), (28, 0, S.SUGOIYO), (29, 2, S.KANJI), (31, 0, S.STEINER), (32, 0, S.ZOU),
    (33, 0, S.HICHEW), (34, 2, S.AIIN), (35, 0, S.KURUKURU), (36, 2, S.DOARA),
    (37, 0, S.HICHEW), (38, 2, S.TEI), (39, 0, S.JACKIE),
    (41, 0, S.WAWAWA), (43, 0, S.SAIKOU), (45, 0, S.ASHI), (47, 0, S.ARCHER),
    (49, 0, S.HICHEW), (50, 2, S.AIIN), (51, 0, S.KURUKURU), (52, 2, S.DOARA),
    (53, 0, S.HICHEW), (54, 2, S.TEI), (55, 0, S.JACKIE),
    (57, 0, S.HICHEW), (58, 2, S.AIIN), (59, 0, S.KURUKURU), (60, 2, S.PSYCHO),
    (61, 0, S.HICHEW), (62, 2, S.SAIKOU), (63, 0, S.JACKIE),
    (65, 0, S.GORILLA), (67, 0, S.NYA),
]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")  # サムソンは子音・息が長いので母音頭を格子へ
    V.SIX = SIX
    B.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))

    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t13": []}
    mod_bars, prog = set(), []
    for b0, kind in BLOCKS:
        harm, lead, sh, (pad, stab, bass, arp) = spec(kind)
        if sh:
            mod_bars |= set(range(b0, b0 + 4))
        prog.append({"bar": b0 + 1, "kind": kind, "transpose": sh, "chords": [h if isinstance(h, str) else "/".join(h) for h in harm]})
        for i, h in enumerate(harm):
            hs = h if isinstance(h, tuple) else (h,)
            for j, name in enumerate(hs):
                ln = 96 // len(hs)
                st = b0 * BAR + i * 96 + j * ln
                notes = [m + sh for m in CH[name]]
                if pad:
                    tracks["t6"] += [{"startStep": st, "durationSteps": ln - 2, "midi": m} for m in notes]
                if stab:  # セブンスのブロック和音を8分裏で
                    for k in range(12, ln, 24):
                        tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for m in notes]
                if bass:  # 8分オクターブ
                    for k in range(0, ln, 24):
                        tracks["t4"].append({"startStep": st + k, "durationSteps": 20, "midi": ROOT[name] + sh + (12 if (k // 24) % 2 else 0)})
                if arp:  # 16分で構成音を上下
                    seq = sorted(notes) + [sorted(notes)[0] + 12]
                    order = seq + seq[-2:0:-1]
                    for k in range(0, ln, 12):
                        tracks["t13"].append({"startStep": st + k, "durationSteps": 10, "midi": order[(k // 12) % len(order)] + 24})
        if lead:
            tracks["t0"] += lead_notes(lead, b0, sh)

    N = int((NBARS * 16 * SIX + 3) * 44100)
    voice = np.zeros(N)
    placed, rendered = [], {}
    for bar, beat, clip in SPEECH:
        c = cache[K(clip)]
        mod = (bar - 1) in mod_bars
        pcs = B.pent_minor(11 if mod else 9)  # B / A マイナーペンタ
        key = (K(clip), mod)
        tr = c["tr"] + (2 if mod else 0)
        if key not in rendered:
            q = B.correct(c["midi"] + tr, pcs)
            ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
            rendered[key] = (B.render_voice(c, c["pos"] * SIX, ratios), q)
        (x, d0), q = rendered[key]
        V.add(voice, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": c["text"], "who": Path(c["path"]).parent.name, "transpose": tr,
                       "correctionCents": [round(float((a - (m + tr)) * 100)) for a, m in zip(q, c["midi"]) if np.isfinite(a) and np.isfinite(m)]})
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), 44100)

    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)", "t7": "Electric Piano 2",
                           "t13": "FX 3 (crystal)"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "A minor（57〜64小節は B minor）", "bars": NBARS, "blocks": prog, "placed": placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "speech", len(placed))


if __name__ == "__main__":
    main()
