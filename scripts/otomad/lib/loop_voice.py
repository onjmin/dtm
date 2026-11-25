"""台詞の伸ばした母音 1 つを、伸ばせる声の楽器にする（サウンドフォントに無い人の声でコーラスを鳴らす用）。

    v = LoopVoice(wav, t0=0.15)          # t0 秒から読み、高さの安定した所を繰り返しにする
    y = v.note(60, 0.8, vib=(20, 0.28))  # MIDI 60 を 0.8 秒 → モノラル 44.1 kHz。v.root が元の高さ

- 波形は作り直さない。再生の速さで高さを変えるだけ（sf2_voice と同じ）。頭は台詞の入りのまま、途中から繰り返す。
- 繰り返しは声の周期の整数倍で切り、20 ms 重ねてつなぐ。
"""
import numpy as np
import pyworld
import soundfile as sf

FS = 44100


class LoopVoice:
    def __init__(self, path, t0=0.0, max_loop=0.3):
        y, sr = sf.read(str(path), always_2d=True)
        y = y.mean(1)
        if sr != FS:
            from scipy.signal import resample_poly
            y = resample_poly(y, FS, sr)
        y = y[int(t0 * FS):]
        f0, t = pyworld.harvest(np.ascontiguousarray(y), FS, f0_floor=70, f0_ceil=700, frame_period=5)
        m = 69 + 12 * np.log2(np.maximum(f0, 1) / 440)
        best, i = (0, 0), 0
        while i < len(m):                      # いちばん長い、高さが 0.7 半音に収まる区間
            if f0[i] <= 0:
                i += 1
                continue
            j, lo, hi = i, m[i], m[i]
            while j + 1 < len(m) and f0[j + 1] > 0 and max(hi, m[j + 1]) - min(lo, m[j + 1]) < .7:
                j += 1
                lo, hi = min(lo, m[j]), max(hi, m[j])
            if j - i > best[0]:
                best = (j - i, i)
            i = j + 1
        a, b = best[1] * 5e-3 + .04, (best[1] + best[0]) * 5e-3 - .02
        b = min(b, a + max_loop)
        hz = float(np.median(f0[int(a / 5e-3):int(b / 5e-3) + 1]))
        self.root = 69 + 12 * np.log2(hz / 440)
        per = FS / hz
        ls = int(a * FS)
        ll = int(round(round((b - a) * FS / per) * per))
        xf = int(.02 * FS)
        loop = y[ls:ls + ll].copy()
        w = np.linspace(0, 1, xf)
        loop[:xf] = loop[:xf] * w + y[ls + ll:ls + ll + xf] * (1 - w)     # 繰り返しの継ぎ目を重ねる
        # 繰り返しの中の音量の波（3 Hz 前後のうなりに聞こえる）を均す
        k = int(per * 2)
        e = np.sqrt(np.convolve(np.tile(loop, 3) ** 2, np.ones(k) / k, "same"))[ll:2 * ll]
        loop = loop * (e.mean() / np.maximum(e, e.mean() * .3))
        self.head = y[:ls] * np.linspace(1, e.mean() / max(e[0], e.mean() * .3), ls)
        g = 1 / (np.abs(loop).max() + 1e-9)
        self.head, self.loop = self.head * g, loop * g

    def note(self, m, dur, vib=None, rel=.08):
        n = int((dur + rel) * FS)
        tt = np.arange(n) / FS
        cents = np.zeros(n)
        if vib:
            cents += vib[0] * np.clip((tt - vib[1]) / .25, 0, 1) * np.sin(2 * np.pi * 5.0 * (tt - vib[1]))
        ratio = 2 ** ((m - self.root) / 12)
        pos = np.concatenate([[0.0], np.cumsum(ratio * 2 ** (cents[:-1] / 1200))])
        nh, nl = len(self.head), len(self.loop)
        src = np.concatenate([self.head, self.loop, self.loop[:2]])
        over = pos >= nh
        pos[over] = nh + np.mod(pos[over] - nh, nl)
        y = np.interp(pos, np.arange(len(src)), src)
        env = np.minimum(1, tt / .005)
        ri = int(dur * FS)
        env[ri:] *= np.exp(-(tt[ri:] - dur) / (rel / 4))
        return y * env
