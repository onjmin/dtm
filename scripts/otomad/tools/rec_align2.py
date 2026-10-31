"""頭に空き1小節を足して録った伴奏とリードを、daw.json の音符と照らして時刻合わせし、1小節目が 0.1 秒に来るよう切りそろえる（使い捨て）。

rec_align.py はドラムの型だけで小節頭を出していたが、disco（キック1・3拍、スネア2・4拍）は半小節ごとに同じ形で、
録り始めの遅れが1小節を超えると小節ごとにも決まらない。そこで
  粗: 録音のクロマと daw.json の音符から作ったクロマの相関（和音が半拍ごとに変わるので一意に決まる）
  細: 粗の ±40ms で、期待する立ち上がりと検出した立ち上がりの差の中央値
python -I rec_align2.py <outdir> <acc.wav> <lead.wav> <daw.json>  → <outdir>/acc_al.wav, lead_al.wav
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

od = Path(sys.argv[1])
daw = json.loads(Path(sys.argv[4]).read_text(encoding="utf-8"))
six = 15 / daw["bpm"]
bar = 16 * six
HEAD = 0.1
LEAD = ("t0", "t1", "t2", "t14")
SR, HOP = 22050, 256


def expected(lead):
    notes = [n for t, ns in daw["tracks"].items() if (t in LEAD) == lead for n in ns]
    ons = [n["startStep"] / 12 * six for n in notes]
    if not lead:  # disco: 8分ごとにどれかが鳴る
        ons += [(b * 192 + s) / 12 * six for b in range(daw["preroll"], daw["bars"]) for s in range(0, 192, 24)]
    return notes, np.array(sorted(ons))


def align(path, lead):
    x, sr = sf.read(path)
    y = librosa.resample((x.mean(1) if x.ndim > 1 else x)[: int(60 * sr)], orig_sr=sr, target_sr=SR)
    notes, ons = expected(lead)
    ch = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
    nf = ch.shape[1]
    ref = np.zeros((12, nf + 2000))
    for n in notes:
        a, b = int(n["startStep"] / 12 * six * SR / HOP), int((n["startStep"] + n["durationSteps"]) / 12 * six * SR / HOP)
        ref[n["midi"] % 12, a:max(a + 1, b)] += 1
    ref = ref / (np.linalg.norm(ref, axis=0, keepdims=True) + 1e-9)
    chn = ch / (np.linalg.norm(ch, axis=0, keepdims=True) + 1e-9)
    lags = range(0, int(5 * SR / HOP))
    sc = [float((chn[:, L:] * ref[:, : nf - L]).sum()) for L in lags]
    coarse = int(np.argmax(sc)) * HOP / SR
    second = sorted(sc)[-1] / (sorted(sc)[-int(bar / 2 * SR / HOP)] + 1e-9)
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=64)
    det = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=64, delta=0.1) * 64 / SR
    best = None
    for d in np.arange(coarse - 0.04, coarse + 0.04, 0.001):
        e = ons[ons + d < 58] + d
        k = np.searchsorted(det, e).clip(1, len(det) - 1)
        diff = np.where(np.abs(det[k] - e) < np.abs(det[k - 1] - e), det[k] - e, det[k - 1] - e)
        hit = np.abs(diff) < 0.015
        if best is None or hit.sum() > best[0]:
            best = (int(hit.sum()), d, float(np.median(diff[hit])) if hit.any() else 0.0, len(e))
    hits, d, med, tot = best
    t0 = d + med  # 録音の中での曲頭（空き小節の頭）
    print(Path(path).name, "coarse", round(coarse, 4), "peak/half-bar", round(second, 3), "fine", round(t0, 4), f"hits {hits}/{tot}")
    return x, sr, t0


def cut(x, sr, t0):
    i = int((t0 + daw["preroll"] * bar - HEAD) * sr)
    return x[i:] if i >= 0 else np.concatenate([np.zeros((-i,) + x.shape[1:]), x])


xa, sr, ta = align(sys.argv[2], False)
xl, _, tl = align(sys.argv[3], True)
print("acc latency", round(ta, 4), "lead latency", round(tl, 4), "diff ms", round(1000 * (tl - ta), 1))
sf.write(od / "acc_al.wav", cut(xa, sr, ta).astype(np.float32), sr)
sf.write(od / "lead_al.wav", cut(xl, sr, tl).astype(np.float32), sr)
