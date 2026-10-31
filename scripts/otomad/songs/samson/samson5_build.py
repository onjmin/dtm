"""サムソン5（使い捨て）。台詞イントネーション作曲、作者の手順どおり（台詞合わせ→モーラ単位にペンタへ→採譜→旋律から和音）。

狙い: 「わっわっわっわっわっわ」の同じ音の連打を主題にして小節頭へ何度も戻し、和音は採譜した旋律から選んだ2つだけを曲中ずっと往復する。
python -I samson5_build.py <outdir>
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
HERE = paths.WORK
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_v1 as S  # noqa: E402
from samson_build import correct, pent_minor  # noqa: E402

FS = 44100
BPM = 125
SIX = 15 / BPM
BAR = 16
K = V.K
NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
HOOK = S.WAWAWA
TARGET_CENTER = 60.0

# (区間の頭の小節, [(台詞, 小節頭に置くか)])。区間の中は前の台詞の後ろへ半小節単位で詰める
H = (HOOK, True)
PLAN = [
    ("intro", 3, [H]),
    ("A", 5, [H, (S.KOWAI, False), H, (S.MATTETE, False), H, (S.AITATATA, False), H, (S.SENTI, False)]),
    ("B", None, [(S.DAMEDAME, True), (S.PSYCHO, False), (S.SUGOIYO, False), (S.KANJI, False), (S.ASHI, False),
                 (S.MOUIKKAI, False)]),
    ("hook", None, [H, (S.KURUKURU, False), H, (S.HICHEW, False), H, (S.JACKIE, False), H, H, (S.SAIKOU, False)]),
    ("end", None, [H]),
]
LEAD_SECTIONS = {"hook", "end"}


def chord_vocab(root):
    """自然短音階のセブンス（ii は除く）。(名前, 根音, 構成音の集合)"""
    sc = [(root + s) % 12 for s in (0, 2, 3, 5, 7, 8, 10)]
    names = ["m7", None, "M7", "m7", "m7", "M7", "7"]
    roman = ["i", None, "III", "iv", "v", "VI", "VII"]
    return [(f"{NAMES[sc[d]]}{names[d]}({roman[d]})", sc[d], {sc[(d + k) % 7] for k in (0, 2, 4, 6)})
            for d in range(7) if names[d]]


def pick_two(bar_notes, vocab, nbars):
    """2つの和音を1小節ごと（または2小節ごと）に往復させ、旋律の音が構成音に入る重みが最大の組。"""
    best = None
    for a in vocab:
        for b in vocab:
            if a is b:
                continue
            for span in (1, 2):
                sc = 0.0
                for bar in range(nbars):
                    ch = a if (bar // span) % 2 == 0 else b
                    sc += sum(w * (1 if int(round(m)) % 12 in ch[2] else -1) for m, w in bar_notes.get(bar, []))
                if best is None or sc > best[0]:
                    best = (sc, a, b, span)
    return best


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    used = {K(c): c for _sec, _b, items in PLAN for c, _ in items}
    V.SECTIONS = [("all", [(k, 1) for k in used])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else TARGET_CENTER
        c["tr"] = float(np.clip(round(TARGET_CENTER - med), -3, 3))

    # 主音: 主題の最後の音
    hk = cache[K(HOOK)]
    root = int(round([m for m in hk["midi"] if np.isfinite(m)][-1] + hk["tr"])) % 12
    pcs = pent_minor(root)
    for c in cache.values():
        c["q"] = correct(c["midi"] + c["tr"], pcs)

    placed, cur, sec_bars = [], 0, {}
    for sec, b0, items in PLAN:
        start = (b0 - 1) * BAR if b0 else math.ceil(cur / BAR) * BAR
        cur = max(cur, start)
        sec_bars[sec] = cur // BAR
        for clip, on_bar in items:
            c = cache[K(clip)]
            at = math.ceil(cur / (BAR if on_bar else 8)) * (BAR if on_bar else 8)
            placed.append({"key": K(clip), "at": at, "sec": sec})
            cur = at + int(c["pos"][-1]) + 3
    nbars = math.ceil(cur / BAR) + 1

    bar_notes, melody = {}, []
    for p in placed:
        c = cache[p["key"]]
        for i, q in enumerate(c["q"]):
            if not np.isfinite(q):
                continue
            pos = p["at"] + int(c["pos"][i])
            w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            bar_notes.setdefault(pos // BAR, []).append((q, w))
            melody.append({"pos16": pos, "len16": int(min(w, 4)), "midi": q, "sec": p["sec"], "hook": p["key"] == K(HOOK)})
    score, ca, cb, span = pick_two(bar_notes, chord_vocab(root), nbars)
    prog = [ca if (b // span) % 2 == 0 else cb for b in range(nbars)]

    N = int((nbars * BAR * SIX + 3) * FS)
    voice = np.zeros(N)
    rendered = {}
    for p in placed:
        c = cache[p["key"]]
        if p["key"] not in rendered:
            ratios = [2 ** ((q - m) / 12) if np.isfinite(q) and np.isfinite(m) else 2 ** (c["tr"] / 12)
                      for q, m in zip(c["q"], c["midi"])]
            rendered[p["key"]] = P.line(c, c["pos"] * SIX, ratios)
        x, d0 = rendered[p["key"]]
        V.add(voice, x, p["at"] * SIX + d0)
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)

    st = 12
    tracks = {"t0": [], "t4": [], "t7": [], "t6": []}
    for n in melody:
        if n["sec"] in LEAD_SECTIONS and n["hook"]:
            tracks["t0"].append({"startStep": n["pos16"] * st, "durationSteps": n["len16"] * st - 2, "midi": int(n["midi"]) + 12})
    last = nbars - 1
    for b, (_name, r, tones) in enumerate(prog):
        if b == last:  # 最後の小節は主題の和音を1つ伸ばすだけ
            r, tones = ca[1], ca[2]
        dur = 190
        for pc in sorted(tones):
            m = 55 + (pc - 55) % 12
            tracks["t6"].append({"startStep": b * 192, "durationSteps": dur, "midi": m + 12})
            if b == last:
                tracks["t7"].append({"startStep": b * 192, "durationSteps": dur, "midi": m})
            else:
                for k in (2, 6, 10, 14):  # エレピは裏の8分で刻む
                    tracks["t7"].append({"startStep": b * 192 + k * st, "durationSteps": 18, "midi": m})
        bass = 36 + (r - 36) % 12
        if b == last:
            tracks["t4"].append({"startStep": b * 192, "durationSteps": dur, "midi": bass})
        else:
            for k in range(8):
                tracks["t4"].append({"startStep": b * 192 + k * 24, "durationSteps": 20, "midi": bass + (12 if k % 2 else 0)})
    daw = {"bpm": BPM, "drum": "four_clap_16hat", "bars": nbars, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t7": "Electric Piano 1", "t6": "Pad 2 (warm)"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")

    # 渡す前の物差し: 句頭の拍頭率・強い音節の拍頭率・抑揚の上下の一致率
    heads, strong, agree = [], [], []
    for p in placed:
        c = cache[p["key"]]
        pos = p["at"] + c["pos"]
        heads.append(pos[0] % 4 == 0)
        thr = np.quantile(c["strength"], 0.75)
        strong += [pos[i] % 4 == 0 for i in range(len(pos)) if c["strength"][i] >= thr]
    for c in cache.values():  # 抑揚は台詞ごとに1回（主題の繰り返しで水増ししない）
        m, q = c["midi"], c["q"]
        for i in range(1, len(m)):
            if np.isfinite(m[i]) and np.isfinite(m[i - 1]) and abs(m[i] - m[i - 1]) >= 0.5:
                agree.append(int(np.sign(q[i] - q[i - 1]) * np.sign(m[i] - m[i - 1])))
    info = {
        "bpm": BPM, "root": NAMES[root], "scale": "minor pentatonic", "bars": nbars,
        "loop": [ca[0], cb[0]], "loopSpanBars": span, "loopFit": round(float(score), 1),
        "sections": {k: v + 1 for k, v in sec_bars.items()},
        "measures": {"phraseHeadOnBeat": round(float(np.mean(heads)), 2), "strong25OnBeat": round(float(np.mean(strong)), 2),
                     "contourSame/flat/reversed": [agree.count(1), agree.count(0), agree.count(-1)]},
        "placed": [{"bar": round(p["at"] / 16 + 1, 2), "sec": p["sec"], "text": cache[p["key"]]["text"],
                    "transpose": cache[p["key"]]["tr"],
                    "notes": [NAMES[int(q) % 12] if np.isfinite(q) else "-" for q in cache[p["key"]]["q"]],
                    "correctionCents": [round(float((q - m) * 100)) for q, m in zip(cache[p["key"]]["q"], cache[p["key"]]["midi"] + cache[p["key"]]["tr"]) if np.isfinite(q) and np.isfinite(m)]}
                   for p in placed],
    }
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "melody.npy", np.array([(n["pos16"], n["len16"], n["midi"]) for n in melody]))
    print(json.dumps({k: info[k] for k in ("root", "bars", "loop", "loopSpanBars", "sections", "measures")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
