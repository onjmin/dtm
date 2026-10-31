"""samson_2go の伴奏・リード・声の楽器・生の台詞を混ぜる（使い捨て）。

声の楽器は伴奏の −4 dB、生の台詞は −6 dB（2号兄貴の作で −5〜−12 dB）。曲を切る点のあとは生の台詞だけ。
python -I samson2go_mix.py <outdir> [acc.wav lead.wav リードの dB]   （既定は rec/out/samson2go_acc.wav, _lead.wav, −1 dB）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa
import numpy as np
import soundfile as sf

FS = 44100
HERE = paths.WORK
od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
six = 15 / info["bpm"]
acc_p, lead_p = (sys.argv[2], sys.argv[3]) if len(sys.argv) > 3 else (HERE / "rec/out/samson2go_acc.wav", HERE / "rec/out/samson2go_lead.wav")
lead_db = float(sys.argv[4]) if len(sys.argv) > 4 else -1.0
raw_db = float(sys.argv[5]) if len(sys.argv) > 5 else -6.0  # 生の台詞の中央値（伴奏比）
acc, _ = librosa.load(acc_p, sr=FS, mono=False)
lead, _ = librosa.load(lead_p, sr=FS, mono=False)
lead[:, :int(0.11 * FS)] = 0  # 録り始めのクリック
vinst, _ = librosa.load(od / "vinst.wav", sr=FS)
vraw, _ = librosa.load(od / "vraw.wav", sr=FS)


def phase(y, off):
    env = librosa.onset.onset_strength(y=y, sr=22050, hop_length=128)
    fr = librosa.onset.onset_detect(onset_envelope=env, sr=22050, hop_length=128)
    x = (fr * 128 / 22050 - off) / six
    z = np.mean(np.exp(2j * np.pi * x))
    return float(np.angle(z) / (2 * np.pi) * six), float(abs(z))


a = np.abs(acc.mean(0))
first = np.argmax(a > 0.01 * a.max()) / FS
if len(sys.argv) > 6:  # 伴奏の頭の音が録れずに落ちたとき、1小節目の時刻をリードの最初の音から測って渡す
    first = float(sys.argv[6])
pa, ra = phase(librosa.resample(acc.mean(0), orig_sr=FS, target_sr=22050), first)
# 声の楽器の時刻は、格子どおりに置いた打楽器の層があればそれで測る（低い声のベースは立ち上がりが遅く読まれる）
ref = librosa.load(od / "vinst_perc.wav", sr=FS)[0] if (od / "vinst_perc.wav").exists() else vinst
pv, rv = phase(librosa.resample(ref, orig_sr=FS, target_sr=22050), 0)
off = first + pa - pv
print("first", round(first, 4), "acc phase ms", round(pa * 1000, 1), round(ra, 2), "vinst phase ms", round(pv * 1000, 1), round(rv, 2), "offset", round(off, 4))

end_t = off + info["endStep"] / 12 * six
total = max(acc.shape[1], int((off + len(vraw) / FS) * FS))
inst = np.zeros((2, total))
n = min(acc.shape[1], lead.shape[1])
inst[:, :n] = acc[:, :n] + 10 ** (lead_db / 20) * lead[:, :n]


def shift(v):
    out = np.zeros(total)
    i = int(off * FS)
    m = min(len(v), total - i)
    out[i:i + m] = v[:m]
    return out


vi, vr = shift(vinst), shift(vraw)
e = int(end_t * FS)
fade = np.ones(total)
fade[e:e + int(0.08 * FS)] = np.linspace(1, 0, int(0.08 * FS))
fade[e + int(0.08 * FS):] = 0
inst *= fade
vi *= fade


def rms_act(x, ref=None):
    win = 2048
    r = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same"))
    act = r > 0.1 * r.max()
    return float(np.median(r[act])), act


ri, _ = rms_act(inst.mean(0))
gi = 10 ** (-4 / 20) * ri / (rms_act(vi)[0] + 1e-9)
gr = 10 ** (raw_db / 20) * ri / (rms_act(vr)[0] + 1e-9)
mix = inst + gi * vi[None, :] + gr * vr[None, :]
pk = np.abs(mix).max()
sf.write(od / "song.wav", (0.95 * mix / pk).T.astype(np.float32), FS)
sf.write(od / "song_inst.wav", (0.95 * (inst + gi * vi[None, :]) / pk).T.astype(np.float32), FS)
(od / "offset.txt").write_text(f"{off:.4f}", encoding="utf-8")
print("gains vinst", round(gi, 3), "vraw", round(gr, 3), "seconds", round(total / FS, 1))
