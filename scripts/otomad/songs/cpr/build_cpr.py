"""cpr1: 「生き返れ生き返れ」を ♩=110（心臓マッサージの速さ）で毎小節、和音は Dm9 と G9 の往復だけ。

build_example.py の写し。python build_cpr.py cpr1 --lines lines_cpr_local.py --title ...
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

sys.path.insert(0, str(paths.REPO / "scripts" / "speech-melody"))
import config  # noqa: E402

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import voice as V  # noqa: E402

BPM = 110
SIX = 15 / BPM
BAR = 192
ROOT_PC = 2  # D マイナーペンタ（D F G A C）

CH = {"Dm9": [50, 53, 57, 60, 64], "G9": [55, 59, 62, 65, 69]}
ROOT = {"Dm9": 38, "G9": 43}
NBARS = 34

D5, F5, G5, A5, C6, D6, F6, G6, A6 = 74, 77, 79, 81, 84, 86, 89, 91, 93


def n(p, l, m, v=None):
    return (p, l, m, v)


# 合いの手: 台詞（毎小節0〜10の16分）の後ろ 11〜15 に入る2小節の型
ANS_HI = [n(11, 1, A5), n(12, 2, C6), n(14, 2, D6),
          n(27, 1, D6), n(28, 1, C6), n(29, 1, A5), n(30, 2, G5)]
ANS_HI2 = [n(11, 1, A5), n(12, 2, C6), n(14, 2, D6),
           n(27, 1, F6), n(28, 1, G6), n(29, 1, F6), n(30, 2, D6)]
ANS_LO = [(p, l, m - 12, v) for p, l, m, v in ANS_HI[:3]]  # A では「生き返れ」の小節の後ろだけ

# (開始小節0始まり, 小節数, 種類)
BLOCKS = [(0, 4, "intro"), (4, 8, "A"), (12, 8, "hook"), (20, 4, "break"), (24, 8, "hook"), (32, 2, "outro")]
LAYERS = {  # パッド, 刻み, ベース, 心電図, 合いの手
    "intro": (True, False, True, True, None),
    "A": (True, True, True, False, ANS_LO),
    "hook": (True, True, True, False, None),
    "break": (True, False, True, True, None),
    "outro": (True, False, False, False, None),
}
# 台詞の置き場所: (小節1始まり, 台詞の名前)。拍頭から
SPEECH = [(2, "AKAN"), (4, "IKIKAERE"),
          (5, "MU"), (6, "IKIKAERE"), (7, "MUZU"), (8, "IKIKAERE"), (9, "TSUGI"), (10, "IKIKAERE"), (11, "DAIJI"), (12, "IKIKAERE"),
          *[(b, "IKIKAERE") for b in range(13, 21)],
          (21, "WAKARU"), (23, "CHANCE"),
          *[(b, "IKIKAERE") for b in range(25, 33)],
          (33, "AKAN")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--lines", required=True)
    ap.add_argument("--title")
    a = ap.parse_args()
    sp = importlib.util.spec_from_file_location("speech_lines", a.lines)
    S = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(S)
    outdir = config.song_dir(a.song)

    names = sorted({nm for _, nm in SPEECH})
    keys = {nm: getattr(S, nm) for nm in names}
    cache = V.load_clips(list(keys.values()), S.ANCHOR)
    for c in cache.values():
        c["pos"] = V.place(c, SIX)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else S.CENTER
        c["tr"] = float(np.clip(round(S.CENTER - med), -3, 3))

    tracks = {"t0": [], "t2": [], "t4": [], "t6": [], "t7": []}
    prog = []
    for b0, nb, kind in BLOCKS:
        pad, stab, bass, beep, ans = LAYERS[kind]
        prog.append({"bar": b0 + 1, "kind": kind, "chords": ["Dm9", "G9"]})
        for b in range(b0, b0 + nb):
            name = "Dm9" if b % 2 == 0 else "G9"
            st = b * BAR
            last = b == NBARS - 1
            if pad:
                tracks["t6"] += [{"startStep": st, "durationSteps": BAR - 2, "midi": m} for m in CH[name]]
            if stab:  # 8分裏の刻み
                for k in range(24, BAR, 48):
                    tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for m in CH[name]]
            if bass:  # 心音「ドクン」: 拍頭と16分あと、1・3拍目
                for p, oct_ in ((0, 0), (1, 0), (6, 12), (8, 0), (9, 0), (14, 12)):
                    tracks["t4"].append({"startStep": st + p * 12, "durationSteps": 10, "midi": ROOT[name] + oct_,
                                         "velocity": 0.6 if p in (1, 9) else 1.0})
            if beep:  # 心電図の「ピッ」を毎拍
                tracks["t2"] += [{"startStep": st + k * 48, "durationSteps": 8, "midi": A6} for k in range(4)]
            if kind == "outro" and last:  # 平らになる
                tracks["t2"].append({"startStep": st, "durationSteps": BAR, "midi": A6})
        if kind == "hook":
            for b in range(b0, b0 + nb, 2):
                pat = ANS_HI2 if (b - b0) % 4 == 2 else ANS_HI
                tracks["t0"] += [{"startStep": b * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m} for p, l, m, _ in pat]
        elif ans:
            for b in range(b0 + 1, b0 + nb, 2):  # 台詞のある偶数小節の前（奇数小節）から
                tracks["t0"] += [{"startStep": b * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m} for p, l, m, _ in ans]

    pcs = V.pent_minor(ROOT_PC)
    voice = np.zeros(int((NBARS * 16 * SIX + 3) * V.FS))
    placed, rendered, end16 = [], {}, -1
    for bar, nm in SPEECH:
        c = cache[keys[nm]]
        if nm not in rendered:
            rendered[nm] = V.tune_line(c, SIX, c["tr"], pcs)
        x, d0, q = rendered[nm]
        at16 = (bar - 1) * 16
        if at16 <= end16:
            print("重なり:", bar, nm)
        end16 = at16 + int(c["pos"][-1])
        V.add(voice, x, at16 * SIX + d0)
        placed.append({"bar": bar, "text": c["text"], "file": config.relative_to_material(c["path"]), "transpose": c["tr"],
                       "correctionCents": [round(float((qq - (m + c["tr"])) * 100)) for qq, m in zip(q, c["midi"])
                                           if np.isfinite(qq) and np.isfinite(m)]})
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), V.FS)

    daw = {"bpm": BPM, "drum": "four_openhat_snare", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t2": "Ocarina", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)",
                           "t7": "Electric Piano 2"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "D minor", "root": "D", "scale": "minor pentatonic", "bars": NBARS, "blocks": prog,
            "progression": "Dm9 | G9 の往復のみ", "placed": placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    mp = outdir / "meta.json"
    meta = json.loads(mp.read_text(encoding="utf-8")) if mp.exists() else {}
    meta.setdefault("material", "関西クレーマー「心臓マッサージ」")
    meta.setdefault("accomp", "build_cpr.py（Dm9–G9 の2和音ループ）")
    meta["title"] = a.title or meta.get("title") or a.song
    mp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(outdir, "bars", NBARS, {k: len(v) for k, v in tracks.items()}, "speech", len(placed))


if __name__ == "__main__":
    main()
