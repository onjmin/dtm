"""plasti1 の歌の層を測る（使い捨て）: 1音ごとの音量と、狙いの音高からのずれ（セント）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

import plasti_build as PB  # noqa: E402

od = Path(sys.argv[1])
y, sr = librosa.load(od / "vinst_sing.wav", sr=22050)
six = PB.SIX
rows = []
for b0, kind in PB.BLOCKS:
    if kind not in PB.MEL or b0 >= PB.MOD_BAR:
        continue
    for p, l, m in PB.MEL[kind]:
        t = (b0 * 192 + p * 12) / 12 * six
        a, b = int((t + 0.03) * sr), int((t + l * six - 0.03) * sr)
        seg = y[a:b]
        rms = float(np.sqrt((seg ** 2).mean())) if len(seg) else 0
        f0, vf, _ = librosa.pyin(seg, fmin=150, fmax=1400, sr=sr, frame_length=1024) if len(seg) > 1200 else (np.array([np.nan]), None, None)
        f = f0[np.isfinite(f0)]
        cents = float(np.median(1200 * np.log2(f / PB.G.hz(m)))) if len(f) else np.nan
        rows.append((b0 + 1, kind, p, m, rms, cents, len(f) / max(1, len(f0))))
r = np.array([x[4] for x in rows])
c = np.array([x[5] for x in rows])
print("notes", len(rows), "rms median", round(float(np.median(r)), 4), "quiet(<25% med)", int((r < 0.25 * np.median(r)).sum()))
print("cents |med| median", round(float(np.nanmedian(np.abs(c))), 1), "within 15c", round(float(np.mean(np.abs(c[np.isfinite(c)]) < 15)), 2), "unpitched", int(np.isnan(c).sum()))
for x in rows:
    if x[4] < 0.25 * np.median(r) or not np.isfinite(x[5]) or abs(x[5]) > 50:
        print("  odd", x)
