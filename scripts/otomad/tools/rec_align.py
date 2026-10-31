"""頭に空き1小節を足して録った伴奏とリードを、それぞれ自分の音で時刻合わせし、1小節目が 0.1 秒に来るよう切りそろえる（使い捨て）。

伴奏とリードは別々の回で録るので、録り始めの遅れが回ごとに違う（amber1 で約 87ms 食い違い、リードと声が16分1つ遅れた）。
伴奏: 空き小節はドラムだけなので、最初の音＝空き小節の1拍目。リード: 最初の音＝ lead.npy の最初の音。
python -I rec_align.py <outdir> <acc.wav> <lead.wav>  → <outdir>/acc_al.wav, lead_al.wav
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
bar = 240 / info["bpm"]
HEAD = 0.1


def first_sound(x, sr, after=0.0):
    m = np.abs(x).mean(1) if x.ndim > 1 else np.abs(x)
    a = int(after * sr)
    return (a + int(np.argmax(m[a:] > 0.02 * m.max()))) / sr


def drum_origin(x, sr):
    """前奏（パッドとドラムだけ）のキック帯・スネア帯の立ち上がりに、break_openhat の型（キック 0・6・10、スネア 4・12）を当てて小節の頭を出す。
    空き小節の頭も音色の読み込みで欠けることがあるので、最初の音には頼らない。"""
    import librosa
    import scipy.signal as ss
    y = librosa.resample((x.mean(1) if x.ndim > 1 else x)[: int(14 * sr)], orig_sr=sr, target_sr=22050)
    six = bar / 16

    def ons(lo, hi):
        z = ss.sosfiltfilt(ss.butter(4, [lo / 11025, hi / 11025], "band", output="sos"), y)
        e = librosa.onset.onset_strength(y=z, sr=22050, hop_length=32)
        return librosa.onset.onset_detect(onset_envelope=e, sr=22050, hop_length=32, delta=0.2) * 32 / 22050

    k, s = ons(30, 90), ons(1500, 5000)
    best = None
    for org in np.arange(0, bar, 0.001):
        def cost(T, pat):
            p = ((T - org) / six) % 16
            return np.minimum.reduce([np.minimum(np.abs(p - q), 16 - np.abs(p - q)) for q in pat]).clip(0, 1).sum()
        c = cost(k, (0, 6, 10)) + cost(s, (4, 12))
        if best is None or c < best[0]:
            best = (c, org)
    return best[1]


acc, sr = sf.read(sys.argv[2])
lead, _ = sf.read(sys.argv[3])
t_acc = drum_origin(acc, sr)  # 空き小節の頭（小節の長さを法として）
lead_first_bar = float(np.load(od / "lead.npy")[0][0]) / 16 * bar  # 曲の1小節目から測ったリードの最初の音
t_lead = first_sound(lead, sr, after=0.2) - bar - lead_first_bar  # リードの回の空き小節の頭
print("acc latency", round(t_acc, 4), "lead latency", round(t_lead, 4), "diff ms", round(1000 * (t_lead - t_acc), 1))


def cut(x, t0):
    i = int((t0 + bar - HEAD) * sr)
    return x[i:] if i >= 0 else np.concatenate([np.zeros((-i,) + x.shape[1:]), x])


sf.write(od / "acc_al.wav", cut(acc, t_acc).astype(np.float32), sr)
sf.write(od / "lead_al.wav", cut(lead, t_lead).astype(np.float32), sr)
