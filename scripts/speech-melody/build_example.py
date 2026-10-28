"""曲の build の見本（2号スタイル: 旋律・セブンスの和音は手書きで主役、台詞は合いの手）。

1曲ごとにこのファイルを写して、旋律・和音・構成・台詞の置き場所（SPEECH）を書き換える。
1小節 = 192 ステップ、16分 = 12、3連8分 = 16（DAW の格子）。
出力（SPEECH_OUT_DIR/<曲名>/）: voice.wav（曲頭=0）、daw.json（DAW へ書くトラック）、placement.json（小節ごとの台詞）、meta.json（棚の表示）

python build_example.py <曲名> --lines <台詞の定義.py>
"""
import argparse
import importlib.util
import json
from pathlib import Path

import numpy as np
import soundfile as sf

import config
import voice as V

BPM = 145
SIX = 15 / BPM
BAR = 192
ROOT_PC = 9  # A マイナーペンタ（A C D E G）へ台詞を寄せる

# ── 和音（セブンス、中音域）。半小節ずつ、タプルは1拍ずつ ──
CH = {
    "Am7": [57, 60, 64, 67], "Dm7": [62, 65, 69, 72], "G7": [55, 59, 62, 65], "CM7": [60, 64, 67, 71],
    "FM7": [53, 57, 60, 64], "Em7": [52, 55, 59, 62], "E7": [56, 59, 62, 64], "Bm7b5": [59, 62, 65, 69],
}
ROOT = {"Am7": 45, "Dm7": 38, "G7": 43, "CM7": 36, "FM7": 41, "Em7": 40, "E7": 40, "Bm7b5": 47}
VERSE = ["Am7", "Dm7", "G7", "CM7", "FM7", "Em7", "Am7", "E7"]
HOOK = ["FM7", "G7", "Em7", "Am7", "Dm7", "G7", ("Bm7b5", "E7"), "Am7"]


def n(p, l, m):  # (16分位置, 長さ16分, MIDI)
    return (p, l, m)


def T(p, ms):  # 1拍の3連
    return (p, "T", ms)


A4, C5, D5, E5, G5, A5, C6, D6, E6, G6, A6 = 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93
RIFF = [  # Aメロ: 16分のリフ（4小節）
    n(0, 1, A4), n(1, 1, C5), n(2, 2, E5), n(4, 1, D5), n(5, 1, C5), n(6, 2, A4), n(8, 1, C5), n(9, 1, D5), n(10, 2, E5),
    n(12, 2, G5), n(14, 2, E5),
    n(16, 2, D5), n(18, 1, E5), n(19, 1, D5), n(20, 2, C5), n(22, 2, A4), T(24, [C5, D5, E5]), n(28, 4, D5),
    n(32, 1, A4), n(33, 1, C5), n(34, 2, E5), n(36, 1, G5), n(37, 1, A5), n(38, 2, G5), n(40, 2, E5), n(42, 1, D5),
    n(43, 1, E5), n(44, 2, G5), n(46, 2, A5),
    n(48, 3, C6), n(51, 1, A5), n(52, 2, G5), n(54, 2, E5), T(56, [D5, E5, G5]), n(60, 4, A5),
]
HOOK_MEL = [  # サビ: 上から下りて3小節目で最高音へ
    n(0, 3, E6), n(3, 1, D6), n(4, 2, C6), n(6, 2, A5), n(8, 2, C6), n(10, 2, D6), n(12, 4, E6),
    n(16, 3, D6), n(19, 1, C6), n(20, 2, A5), n(22, 2, G5), n(24, 2, A5), n(26, 2, C6), n(28, 4, D6),
    n(32, 3, E6), n(35, 1, G6), n(36, 2, A6), n(38, 2, G6), T(40, [E6, D6, C6]), n(44, 2, A5), n(46, 2, C6),
    n(48, 6, E6), n(54, 2, D6), n(56, 2, C6), n(58, 2, A5), n(60, 2, G5), n(62, 2, A5),
]
HOOK_END = HOOK_MEL[:-6] + [n(48, 8, E6), n(56, 8, A6)]

# (開始小節0始まり, 種類)。4小節ブロック
BLOCKS = [(0, "intro"), (4, "A"), (8, "hook"), (12, "hookend"), (16, "outro")]
NBARS = 20

# 台詞（合いの手）を置く枠: (小節1始まり, 拍0-3)。定義の LINES を順に回して入れる
SLOTS = [(3, 0), (5, 0), (6, 2), (7, 0), (9, 0), (10, 2), (11, 0), (13, 0), (14, 2), (15, 0), (17, 0), (19, 0)]


def spec(kind):
    """→ (和声, リード, 層: パッド, 刻み, ベース)"""
    if kind == "hook":
        return HOOK, HOOK_MEL, (True, True, True)
    if kind == "hookend":
        return HOOK, HOOK_END, (True, True, True)
    if kind == "A":
        return VERSE, RIFF, (True, True, True)
    if kind == "intro":
        return VERSE, None, (True, False, True)
    return VERSE, None, (True, False, False)


def lead_notes(block, at_bar):
    out = []
    for item in block:
        if item[1] == "T":
            for k, m in enumerate(item[2]):
                out.append({"startStep": at_bar * BAR + item[0] * 12 + k * 16, "durationSteps": 15, "midi": m})
        else:
            p, l, m = item
            out.append({"startStep": at_bar * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m})
    return out


def load_lines(path):
    spec_ = importlib.util.spec_from_file_location("speech_lines", path)
    mod = importlib.util.module_from_spec(spec_)
    spec_.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--lines", required=True, help="台詞の定義（lines_example.py の書式）")
    ap.add_argument("--title")
    a = ap.parse_args()
    S = load_lines(a.lines)
    outdir = config.song_dir(a.song)

    cache = V.load_clips(S.LINES, getattr(S, "ANCHOR", 0.0))
    center = getattr(S, "CENTER", 52.0)
    for c in cache.values():
        c["pos"] = V.place(c, SIX)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else center
        c["tr"] = float(np.clip(round(center - med), -3, 3))  # 音域をそろえる移調（±3 まで）

    tracks = {"t0": [], "t4": [], "t6": [], "t7": []}
    prog = []
    for b0, kind in BLOCKS:
        harm, lead, (pad, stab, bass) = spec(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": [h if isinstance(h, str) else "/".join(h) for h in harm]})
        for i, h in enumerate(harm):
            hs = h if isinstance(h, tuple) else (h,)
            for j, name in enumerate(hs):
                ln = 96 // len(hs)
                st = b0 * BAR + i * 96 + j * ln
                if pad:
                    tracks["t6"] += [{"startStep": st, "durationSteps": ln - 2, "midi": m} for m in CH[name]]
                if stab:  # セブンスのブロック和音を8分裏で
                    for k in range(12, ln, 24):
                        tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for m in CH[name]]
                if bass:  # 8分オクターブ
                    for k in range(0, ln, 24):
                        tracks["t4"].append({"startStep": st + k, "durationSteps": 20, "midi": ROOT[name] + (12 if (k // 24) % 2 else 0)})
        if lead:
            tracks["t0"] += lead_notes(lead, b0)

    pcs = V.pent_minor(ROOT_PC)
    voice = np.zeros(int((NBARS * 16 * SIX + 3) * V.FS))
    placed, rendered = [], {}
    for k, (bar, beat) in enumerate(SLOTS):
        key = S.LINES[k % len(S.LINES)]
        c = cache[key]
        if key not in rendered:
            rendered[key] = V.tune_line(c, SIX, c["tr"], pcs)
        x, d0, q = rendered[key]
        V.add(voice, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": c["text"], "file": config.relative_to_material(c["path"]),
                       "transpose": c["tr"],
                       "correctionCents": [round(float((qq - (m + c["tr"])) * 100)) for qq, m in zip(q, c["midi"])
                                           if np.isfinite(qq) and np.isfinite(m)]})
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), V.FS)

    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)", "t7": "Electric Piano 2"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "A minor", "root": "A", "scale": "minor pentatonic", "bars": NBARS, "blocks": prog, "placed": placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    # 棚の表示。手で書き足した評価（verdict）などは残す
    mp = outdir / "meta.json"
    meta = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    meta.setdefault("material", Path(a.lines).stem)
    meta.setdefault("accomp", "build_example.py（2号スタイルの見本）")
    meta["title"] = a.title or meta.get("title") or a.song
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(outdir, "bars", NBARS, {k: len(v) for k, v in tracks.items()}, "speech", len(placed))


if __name__ == "__main__":
    main()
