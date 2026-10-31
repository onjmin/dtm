"""フォルダの台詞をまとめてモーラ整列し、モーラごとの音高を付ける（使い捨て）。

python -I align_batch.py <folder> <out.json>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

from align import SR, align  # noqa: E402

HOP = 160


def pitch_morae(path, r):
    y, _ = librosa.load(path, sr=SR, mono=True)
    f0, vf, _ = librosa.pyin(y, fmin=60, fmax=700, sr=SR, hop_length=HOP, frame_length=1024)
    ok = vf & np.isfinite(f0)
    if ok.sum() < 10:
        return None
    med = float(np.median(f0[ok]))
    for m in r["morae"]:
        a, b = int(m["start"] * SR / HOP), int(m["end"] * SR / HOP) + 1
        seg = f0[a:b][ok[a:b]]
        if len(seg) >= 2:
            st = 12 * np.log2(seg / med)
            m["st"] = float(np.median(st))
            k = max(1, len(st) // 3)
            m["glide"] = float(np.median(st[-k:]) - np.median(st[:k]))
        else:
            m["st"] = None
    r["medHz"] = med
    return r


def main():
    folder, out = Path(sys.argv[1]), Path(sys.argv[2])
    res = []
    for p in sorted(folder.glob("*.wav")):
        try:
            r = align(str(p))
        except Exception as e:  # 読めない台詞（記号だけ等）は飛ばす
            print("skip", p.name, e, file=sys.stderr)
            continue
        if not r or not r["morae"]:
            continue
        r = pitch_morae(str(p), r)
        if r:
            r["path"] = str(p)
            res.append(r)
    out.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    print(len(res), "clips")


if __name__ == "__main__":
    main()
