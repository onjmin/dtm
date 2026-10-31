"""関西クレーマー × 2号スタイル（notes-cpr.md）。旋律・和音は手書き、台詞は合いの手。使い捨て。

1小節 = 192 ステップ、16分 = 12、3連8分 = 16。
出力: voice.wav（曲頭=0）、daw.json（DAW へ書くトラック）、placement.json（小節ごとの素材）
python -I kary_build.py <outdir>
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import kary_v1 as S  # noqa: E402
import samson_build as B  # noqa: E402

BPM = 145
SIX = 15 / BPM
BAR = 192
K = V.K
F, Ab, Bb, C, Db, Eb, E, G = 65, 68, 70, 72, 73, 75, 76, 67

# ── 和音（2拍ごと、セブンス）──────────────────────────
CH = {
    "Fm7": [65, 68, 72, 75], "Bbm7": [58, 61, 65, 68], "Eb7": [63, 67, 70, 73], "AbM7": [56, 60, 63, 67],
    "DbM7": [61, 65, 68, 72], "Cm7": [60, 63, 67, 70], "C7": [60, 64, 67, 70], "Gm7b5": [55, 58, 61, 65],
}
ROOT = {"Fm7": 41, "Bbm7": 46, "Eb7": 39, "AbM7": 44, "DbM7": 37, "Cm7": 36, "C7": 36, "Gm7b5": 43}
VERSE = ["Fm7", "Bbm7", "Eb7", "AbM7", "DbM7", "Cm7", "Fm7", "C7"]  # 4小節（半小節ずつ）
HOOK = ["DbM7", "Cm7", "Bbm7", "Eb7", "AbM7", ("Gm7b5", "C7"), "Fm7", "Fm7"]  # 3小節目後半は1拍ずつ


# ── リード（手書き）: (16分位置, 長さ16分, MIDI)。3連は (位置, 'T', [3音]) で1拍 ──
def n(p, l, m):
    return (p, l, m)


RIFF_A = [  # Aメロ: F マイナーペンタの16分リフ
    n(0, 1, 77), n(1, 1, 80), n(2, 1, 84), n(4, 2, 82), n(6, 1, 80), n(7, 1, 77),
    n(8, 1, 82), n(9, 1, 84), n(10, 2, 87), n(12, 1, 84), n(13, 1, 82), n(14, 2, 80),
    n(16, 1, 82), n(17, 1, 84), n(18, 2, 87), n(20, 2, 89), n(22, 1, 87), n(23, 1, 84),
    n(24, 3, 80), n(27, 1, 84), n(28, 2, 87), n(30, 1, 84), n(31, 1, 80),
    n(32, 1, 80), n(33, 1, 82), n(34, 2, 84), n(36, 1, 87), n(37, 1, 84), n(38, 1, 82), n(39, 1, 80),
    (40, "T", [84, 87, 84]), n(44, 2, 82), n(46, 1, 80), n(47, 1, 77),
    n(48, 2, 77), n(50, 1, 80), n(51, 1, 84), n(52, 4, 89), n(56, 1, 87), n(57, 1, 84), n(58, 1, 82), n(59, 1, 80),
    n(60, 2, 84), n(62, 1, 82), n(63, 1, 80),
]
HOOK_B = [  # サビ: 歌える動機（付点と3連）、4小節目で次へ駆け上がる
    n(0, 3, 87), n(3, 1, 89), n(4, 2, 87), n(6, 2, 84), n(8, 3, 82), n(11, 1, 84), n(12, 4, 87),
    n(16, 3, 89), n(19, 1, 87), n(20, 2, 84), n(22, 2, 82), n(24, 2, 87), n(26, 1, 84), n(27, 1, 82), n(28, 4, 80),
    n(32, 3, 84), n(35, 1, 87), n(36, 2, 89), n(38, 2, 92), (40, "T", [89, 87, 84]), n(44, 2, 82), n(46, 2, 84),
    n(48, 6, 89), n(54, 1, 87), n(55, 1, 84), n(56, 2, 80), n(58, 1, 82), n(59, 1, 84), n(60, 2, 87), n(62, 1, 84), n(63, 1, 82),
]
HOOK_B_END = HOOK_B[:-7] + [n(48, 8, 89), n(56, 4, 92), n(60, 4, 89)]  # 締めの4小節目


def lead_notes(block, at_bar, shift=0):
    out = []
    for item in block:
        if item[1] == "T":
            for k, m in enumerate(item[2]):
                out.append({"startStep": (at_bar * BAR) + item[0] * 12 + k * 16, "durationSteps": 15, "midi": m + shift})
        else:
            p, l, m = item
            out.append({"startStep": at_bar * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m + shift})
    return out


# ── 構成（4小節ブロック）: (開始小節0始まり, 種類, 和声, リード, 移調) ──
BLOCKS = []
for b, kind in [(0, "intro"), (4, "intro_lead"), (8, "A"), (12, "A"), (16, "B"), (20, "B"), (24, "A"), (28, "A"),
                (32, "B"), (36, "B"), (40, "break"), (44, "build"), (48, "B"), (52, "B"), (56, "B+"), (60, "B+end"),
                (64, "outro")]:
    BLOCKS.append((b, kind))
NBARS = 68


def block_spec(kind):
    if kind.startswith("B"):
        return HOOK, (HOOK_B_END if kind.endswith("end") else HOOK_B), (2 if "+" in kind else 0)
    if kind in ("intro", "break", "outro"):
        return VERSE, None, 0
    return VERSE, RIFF_A, 0


# ── 台詞（合いの手）: (小節1始まり, 拍0-3, 台詞) ──
SPEECH = [
    (7, 0, S.KAITAI_START),
    (9, 0, S.ROOM), (10, 2, S.DOUSHITE), (12, 0, S.OKANE), (14, 2, S.JOUSHI),
    (17, 0, S.INARI), (18, 2, S.SEII), (19, 0, S.INARI), (20, 2, S.DOUSHITE), (21, 0, S.INARI), (22, 2, S.SEII),
    (23, 0, S.INARI), (24, 0, S.KEISATSU),
    (25, 0, S.SUSHIYA), (26, 0, S.INARI_NAI), (28, 0, S.JIHAKU), (30, 0, S.OYAKATA),
    (33, 0, S.INARI), (34, 2, S.SEII), (35, 0, S.INARI), (36, 2, S.UNMEI), (37, 0, S.INARI), (38, 2, S.SEII),
    (39, 0, S.INARI), (40, 0, S.KEISATSU),
    (41, 0, S.SHINU), (43, 0, S.MUNI), (45, 0, S.IKIKAERE), (46, 2, S.IKIKAERE), (47, 0, S.IKIKAERE),
    (49, 0, S.INARI), (50, 2, S.SEII), (51, 0, S.INARI), (52, 2, S.SAIKOU), (53, 0, S.INARI), (54, 2, S.SEII),
    (55, 0, S.INARI), (56, 2, S.UNMEI),
    (57, 0, S.INARI), (58, 2, S.SEII), (59, 0, S.INARI), (60, 2, S.SAIKOU), (61, 0, S.INARI), (62, 2, S.OISHII),
    (65, 0, S.YURUSHITARU), (67, 0, S.ISHA),
]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))

    tracks = {"t0": [], "t4": [], "t6": [], "t7": []}
    mod_bars = set()
    for b0, kind in BLOCKS:
        harm, lead, shift = block_spec(kind)
        if shift:
            mod_bars |= set(range(b0, b0 + 4))
        # 和音: 半小節ごと（タプルは1拍ずつ）
        for i, h in enumerate(harm):
            hs = h if isinstance(h, tuple) else (h,)
            for j, name in enumerate(hs):
                st = (b0 * BAR) + i * 96 + j * (96 // len(hs))
                ln = 96 // len(hs)
                if kind != "build":
                    for m in CH[name]:
                        tracks["t6"].append({"startStep": st, "durationSteps": ln - 2, "midi": m + shift})
                if kind not in ("intro", "break", "outro"):
                    for k in range(0, ln, 24):  # セブンスの刻み: 8分裏
                        for m in CH[name]:
                            tracks["t7"].append({"startStep": st + k + 12, "durationSteps": 10, "midi": m + 12 + shift})
                if kind not in ("break",):
                    for k in range(0, ln, 24):  # 8分オクターブのベース
                        r = ROOT[name] + shift
                        tracks["t4"].append({"startStep": st + k, "durationSteps": 20, "midi": r + (12 if (k // 24) % 2 else 0)})
        if lead:
            tracks["t0"] += lead_notes(lead, b0, shift)

    # 台詞
    N = int((NBARS * 16 * SIX + 3) * 44100)
    voice = np.zeros(N)
    placed, rendered = [], {}
    for bar, beat, clip in SPEECH:
        c = cache[K(clip)]
        mod = (bar - 1) in mod_bars
        root = 7 if mod else 5  # G / F
        pcs = B.pent_minor(root)
        key = (K(clip), mod)
        if key not in rendered:
            q = B.correct(c["midi"] + c["tr"] + (2 if mod else 0), pcs)
            ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** ((c["tr"] + (2 if mod else 0)) / 12)
                      for qq, m in zip(q, c["midi"])]
            rendered[key] = (B.render_voice(c, c["pos"] * SIX, ratios), q)
        (x, d0), q = rendered[key]
        at16 = (bar - 1) * 16 + beat * 4
        V.add(voice, x, at16 * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": c["text"], "file": str(Path(c["path"]).relative_to(S.R)),
                       "transpose": c["tr"] + (2 if mod else 0),
                       "correctionCents": [round(float((a - (m + c["tr"] + (2 if mod else 0))) * 100)) for a, m in zip(q, c["midi"]) if np.isfinite(a) and np.isfinite(m)]})
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), 44100)

    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 2 (sawtooth)", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)", "t7": "Electric Piano 2"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    prog = []
    for b0, kind in BLOCKS:
        harm, _l, shift = block_spec(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "transpose": shift, "chords": [h if isinstance(h, str) else "/".join(h) for h in harm]})
    info = {"bpm": BPM, "key": "F minor（57〜64小節は G minor）", "bars": NBARS, "blocks": prog, "placed": placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    mel = [(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]
    np.save(outdir / "lead.npy", np.array(mel))
    print("bars", NBARS, "lead notes", len(tracks["t0"]), "speech", len(placed))


if __name__ == "__main__":
    main()
