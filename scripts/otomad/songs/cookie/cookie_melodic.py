"""台詞ごとの「旋律としての分かりやすさ」を測る（使い捨て）。

段差: 隣のモーラと 1 半音以上動く割合。音域: モーラ音高の p10-p90。平ら: モーラ内の音高の揺れが小さい割合。
python -I cookie_melodic.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

import importlib  # noqa: E402
C = importlib.import_module(sys.argv[1] if len(sys.argv) > 1 else "cookie_v2")
from setting import clip_data  # noqa: E402

rows = []
for clip in C.ALL:
    path, _n, text, keep, _r = clip
    if not path.exists():
        rows.append(f"MISSING {path.name}")
        continue
    c = clip_data(path, text, keep)
    y, sr = librosa.load(str(path), sr=16000)
    f0, vf, _ = librosa.pyin(y, fmin=70, fmax=900, sr=sr, hop_length=160, frame_length=1024)
    st = []
    flat = []
    for m in c["morae"]:
        if m["vowel"] == "cl" or m["st"] is None:
            continue
        st.append(m["st"])
        a, b = int(m["vstart"] * 100), int(m["end"] * 100) + 1
        seg = f0[a:b][vf[a:b] & np.isfinite(f0[a:b])]
        if len(seg) >= 3:
            s = 12 * np.log2(seg / np.median(seg))
            flat.append(np.percentile(s, 90) - np.percentile(s, 10) < 1.0)
    st = np.array(st)
    if len(st) == 0:
        rows.append(f"NOPITCH {c['text']}")
        continue
    steps = np.abs(np.diff(st)) >= 1 if len(st) > 1 else np.array([False])
    rows.append(f"{path.parent.name[-8:]:8s} morae {len(st):2d} 段差 {steps.mean():.2f} 音域 {np.percentile(st, 90) - np.percentile(st, 10):4.1f} "
                f"平ら {np.mean(flat) if flat else 0:.2f} 中心 {c['medMidi']:.1f} {c['method']:10s} {c['agree']:.2f} {c['text']}")
(paths.WORK / f"{C.__name__}_melodic.txt").write_text("\n".join(rows), encoding="utf-8")
