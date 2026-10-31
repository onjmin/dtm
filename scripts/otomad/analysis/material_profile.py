"""素材（語録の集まり）から曲の性格を逆算するための量を測る（使い捨て）。

python -I material_profile.py eahon_v5 inmu_v1
"""
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402

import compose_quotes3  # noqa: E402
from setting import clip_data  # noqa: E402

SCALES = {
    "長調": [0, 2, 4, 5, 7, 9, 11],
    "自然短調": [0, 2, 3, 5, 7, 8, 10],
    "長5音": [0, 2, 4, 7, 9],
    "短5音": [0, 3, 5, 7, 10],
    "ミクソリディア": [0, 2, 4, 5, 7, 9, 10],
    "ドリア": [0, 2, 3, 5, 7, 9, 10],
}


def scale_err(pitches, sc):
    best = None
    for r in np.arange(0, 12, 0.25):
        rel = (pitches - r) % 12
        d = np.min(np.abs(rel[:, None] - np.array(sc + [12])[None, :]), axis=1)
        e = float(np.mean(d))
        if best is None or e < best[0]:
            best = (e, r)
    return best


out = {}
for name in sys.argv[1:]:
    mod = importlib.import_module(name)
    secs = getattr(mod, "SECTIONS", None) or mod.sections
    seen, clips = set(), []
    for _, its in secs:
        for f, n, t, k, _r in its:
            if (f, n, t, k) in seen:
                continue
            seen.add((f, n, t, k))
            p = f if n is None else compose_quotes3.find(f, n)
            clips.append(clip_data(p, t, k))
    rates, ioi, sts, ranges, finals, meds = [], [], [], [], [], []
    for c in clips:
        ms = [m for m in c["morae"] if m["vowel"] != "cl"]
        if len(ms) >= 4:
            span = ms[-1]["vstart"] - ms[0]["vstart"]
            if span > 0:
                rates.append((len(ms) - 1) / span)
            ioi += list(np.diff([m["vstart"] for m in ms]))
        s = [m["st"] for m in ms if m["st"] is not None]
        if len(s) >= 3:
            sts += [x + c["medMidi"] for x in s]
            ranges.append(np.percentile(s, 90) - np.percentile(s, 10))
            finals.append(s[-1] - np.median(s))
        meds.append(c["medMidi"])
    sts = np.array(sts)
    rate = float(np.median(rates))
    ioi = np.array([x for x in ioi if 0.03 < x < 0.6])
    prof = {
        "台詞数": len(clips),
        "話速(モーラ/秒)": round(rate, 2),
        "16分=1モーラのテンポ": round(rate * 60 / 4),
        "8分=1モーラのテンポ": round(rate * 60 / 2),
        "モーラ間隔 p25/p50/p75 (秒)": [round(float(np.percentile(ioi, q)), 3) for q in (25, 50, 75)],
        "声の中心 (MIDI)": round(float(np.median(meds)), 1),
        "抑揚の幅 p10-p90 (半音, 台詞内の中央値)": round(float(np.median(ranges)), 1),
        "語尾の高さ (半音, 中央値基準)": round(float(np.median(finals)), 1),
        "語尾が上がる台詞の割合": round(float(np.mean(np.array(finals) > 1)), 2),
        "音階への丸め誤差 (半音)": {k: round(scale_err(sts, v)[0], 3) for k, v in SCALES.items()},
    }
    out[name] = prof
(paths.WORK / "material_profile.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
