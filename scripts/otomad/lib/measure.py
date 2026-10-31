"""音MAD 素材の台詞から、旋律化に効く量を測る（使い捨て）。

python -I scratch/speech-melody/measure.py <root> <out.json> [per_folder]
"""
import json
import random
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import librosa
import numpy as np

SR = 16000
HOP = 160  # 10ms


def analyze(path):
    try:
        y, _ = librosa.load(path, sr=SR, mono=True)
    except Exception as e:
        return {"path": path, "error": str(e)}
    dur = len(y) / SR
    if dur < 0.6 or dur > 12:
        return {"path": path, "skip": "dur", "dur": dur}
    f0, vflag, _ = librosa.pyin(y, fmin=60, fmax=700, sr=SR, hop_length=HOP, frame_length=1024)
    voiced = vflag & np.isfinite(f0)
    if voiced.sum() < 20:
        return {"path": path, "skip": "unvoiced", "dur": dur}
    st = np.full_like(f0, np.nan)
    st[voiced] = 12 * np.log2(f0[voiced] / np.nanmedian(f0[voiced]))
    t = np.arange(len(f0)) * HOP / SR
    tv, sv = t[voiced], st[voiced]
    slope = float(np.polyfit(tv, sv, 1)[0]) if tv.ptp() > 0.3 else None

    # 音節の代わりに onset で区切る（モーラ整列が無いので近似）
    onsets = librosa.onset.onset_detect(y=y, sr=SR, hop_length=HOP, units="frames", backtrack=True)
    bounds = list(onsets) + [len(f0)]
    segs = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        m = voiced[a:b]
        if m.sum() < 3:
            continue
        s = st[a:b][m]
        segs.append({
            "t": float(a * HOP / SR),
            "len": float((b - a) * HOP / SR),
            "med": float(np.median(s)),
            # 区間内の滑り（終わり−始め）
            "glide": float(np.median(s[-3:]) - np.median(s[:3])),
        })
    return {
        "path": path,
        "dur": dur,
        "voicedRatio": float(voiced.mean()),
        "medHz": float(np.nanmedian(f0[voiced])),
        "range90": float(np.percentile(sv, 95) - np.percentile(sv, 5)),
        "slope": slope,
        "onsetRate": len(onsets) / dur,
        "segs": segs,
    }


def main():
    root = Path(sys.argv[1])
    out = Path(sys.argv[2])
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    rng = random.Random(1)
    by_dir = {}
    for p in root.rglob("*.wav"):
        by_dir.setdefault(p.parent, []).append(p)
    picks = []
    for d, files in sorted(by_dir.items(), key=lambda kv: -len(kv[1])):
        if len(files) < 60 or "ドラム" in str(d):
            continue
        rng.shuffle(files)
        picks += [(str(d.relative_to(root)), str(f)) for f in files[:per]]
    with ProcessPoolExecutor(max_workers=12) as ex:
        res = list(ex.map(analyze, [f for _, f in picks], chunksize=4))
    for (d, _), r in zip(picks, res):
        r["folder"] = d
    out.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    print(len(res), "clips from", len({d for d, _ in picks}), "folders")


if __name__ == "__main__":
    main()
