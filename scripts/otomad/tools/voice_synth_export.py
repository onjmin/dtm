"""台詞の伸ばし（語尾など）を、高さが平らなシンセ音にしてサンプラー用に書き出す。

作り方は docs/otomad/techniques/voice-instrument.md の「台詞の語尾をシンセにする」。
WORLD で響き（sp）と息（ap）に分け、目標の高さで組み立て直す（再生速度で高さを変えない）。
息を減らし、響きを時間方向にならし、高い所を下げてかすれを抑える。伸ばす所は行って戻る繰り返し。

例（桔梗☆の YMN「るぅ＾～」）:
  python -I scripts/otomad/tools/voice_synth_export.py "<素材>/SIK「わたしも食べさせるぅ＾～」.wav" \
      --cut 2.14 2.72 --loop 2.32 2.61 --name YMN_ru --out tmp/YMN_るぅシンセ
--loop を省くと、切った中でいちばん平らな所を探す。書き出した後に各ファイルの高さを測って表示する。
声の素材から作った音なので、公開の asset リポジトリには入れず、git に入らない tmp/ に置く。
"""
import argparse
from pathlib import Path

import numpy as np
import pyworld
import soundfile as sf
from scipy.ndimage import uniform_filter1d
from scipy.signal import resample_poly

FS = 44100
FP = 5.0  # WORLD のフレーム（ms）
NAMES = "C Cs D Ds E F Fs G Gs A As B".split()


def note_name(m):
    return f"{NAMES[m % 12]}{m // 12 - 1}"


def read(path):
    y, sr = sf.read(path, always_2d=True)
    y = y.mean(1).astype(float)
    return resample_poly(y, FS, sr) if sr != FS else y


def f0of(y, lo, hi=900):
    f0, t = pyworld.harvest(y, FS, f0_floor=lo, f0_ceil=hi, frame_period=FP)
    return pyworld.stonemask(y, f0, t, FS)


def flat_seg(y, lo, tol=1.0):
    """半音以内で平らに続く、いちばん長い有声の区間（秒）。"""
    f = f0of(y, lo)
    best = (0, 0)
    for a in range(len(f)):
        if f[a] <= 0:
            continue
        b = a
        while b + 1 < len(f) and f[b + 1] > 0 and abs(12 * np.log2(f[b + 1] / f[a])) < tol:
            b += 1
        if b - a > best[1] - best[0]:
            best = (a, b)
    return best[0] * FP / 1000, best[1] * FP / 1000


def env(n, a=.004, d=.1, s=.85, r=.05):
    e = np.full(n, s)
    na = min(int(a * FS), n)
    nd = min(int(d * FS), n - na)
    nr = min(int(r * FS), n // 2 + 1)
    e[:na] = np.linspace(0, 1, na, endpoint=False)
    if nd > 0:
        e[na:na + nd] = s + (1 - s) * np.exp(-np.arange(nd) / max(1, nd / 3))
    if nr > 0:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


class VoiceTone:
    def __init__(self, src, cut, loop=None, apk=.25, smooth=5, tilt_db=-8, fc=4500, f0lo=150):
        a, b = cut
        y = np.ascontiguousarray(read(src)[int(a * FS):int(b * FS)])
        if loop is None:
            la, lb = flat_seg(y, f0lo)
            loop = (a + la, a + lb)
        f0 = f0of(y, f0lo)
        t = np.arange(len(f0)) * FP / 1000
        sp = pyworld.cheaptrick(y, f0, t, FS)
        ap = pyworld.d4c(y, f0, t, FS)
        # 無声のフレーム（子音など）は近くの有声フレームの響きで埋める
        idx = np.where(f0 > 0)[0]
        near = idx[np.clip(np.searchsorted(idx, np.arange(len(f0))), 0, len(idx) - 1)]
        sp = np.exp(uniform_filter1d(np.log(sp[near] + 1e-12), smooth, axis=0))
        fr = np.linspace(0, FS / 2, sp.shape[1])
        sp = sp * 10 ** (tilt_db / 10 * np.clip((fr - fc) / 3000, 0, 1))
        self.sp, self.ap = sp, np.maximum(ap[near] * apk, .001)
        step = FP / 1000
        self.l0 = int((loop[0] - a) / step)
        self.l1 = min(len(sp) - 1, max(self.l0 + 4, int((loop[1] - a) / step)))
        self.root = 69 + 12 * np.log2(np.median(f0[f0 > 0]) / 440)
        self.loop = loop

    def play(self, midi, n):
        k = int(np.ceil(n / FS / (FP / 1000))) + 2
        L = self.l1 - self.l0
        fi = np.arange(k)
        over = fi > self.l1  # 繰り返しは行って戻る（継ぎ目で響きが跳ばないように）
        q = (fi[over] - self.l1) % (2 * L)
        fi[over] = np.where(q < L, self.l1 - q, self.l0 + (q - L))
        F = np.full(k, 440 * 2 ** ((midi - 69) / 12))
        z = pyworld.synthesize(F, np.ascontiguousarray(self.sp[fi]), np.ascontiguousarray(self.ap[fi]), FS, FP)[:n]
        return np.pad(z, (0, max(0, n - len(z)))) * env(n)


def save(path, z):
    z = z / (np.abs(z).max() + 1e-9) * 10 ** (-1 / 20)  # ピーク −1 dB
    sf.write(path, z.astype(np.float32), FS, subtype="PCM_24")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("--cut", nargs=2, type=float, required=True, help="切る所（秒）。頭の子音を残し、前の音の摩擦が終わった所から")
    ap.add_argument("--loop", nargs=2, type=float, help="繰り返す所（秒）。省くといちばん平らな所")
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lo", type=int, default=48, help="いちばん低い音（MIDI）")
    ap.add_argument("--hi", type=int, default=84, help="いちばん高い音（MIDI）")
    ap.add_argument("--step", type=int, default=3, help="何半音ごとに書き出すか")
    ap.add_argument("--sec", type=float, default=2.0, help="1本の長さ（秒）")
    ap.add_argument("--f0lo", type=float, default=150, help="高さの読み取りの下限（男声は 60。高い声で下げると低く読み違える）")
    ap.add_argument("--apk", type=float, default=.25, help="息の量（1 で元のまま）")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    v = VoiceTone(a.src, a.cut, a.loop, apk=a.apk, f0lo=a.f0lo)
    r = int(round(v.root))
    print(f"元の高さ {v.root:.2f}（{note_name(r)}）、繰り返し {v.loop[0]:.2f}〜{v.loop[1]:.2f} 秒")
    save(out / f"{a.name}_元の高さ_{note_name(r)}_4s.wav", v.play(r, 4 * FS))
    for m in range(a.lo, a.hi + 1, a.step):
        save(out / f"{a.name}_{m:03d}_{note_name(m)}.wav", v.play(m, int(a.sec * FS)))
    save(out / f"{a.name}_加工前_切り出しのみ.wav", read(a.src)[int(a.cut[0] * FS):int(a.cut[1] * FS)])
    # 書き出した高さを測って、名前とずれていないか見る
    for p in sorted(out.glob(f"{a.name}_*.wav")):
        y, _ = sf.read(p)
        f = f0of(y[:int(1.5 * FS)], 80, 1200)
        f = f[f > 0]
        print(p.name, f"{69 + 12 * np.log2(np.median(f) / 440):.2f}" if len(f) else "-")


if __name__ == "__main__":
    main()
