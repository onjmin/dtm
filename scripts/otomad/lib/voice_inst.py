"""声を楽器にする部品（サムソン × 2号式の build から切り出し）。

WORLD で分析した母音の芯を伸ばした「声のシンセ」（vsyn）、音節を切った1粒（chop）、子音の破裂の打楽器（burst）。
"""
import librosa
import numpy as np
import pyworld

FS = 44100
_W = {}


def world(path):
    if path not in _W:
        y, _ = librosa.load(str(path), sr=FS, mono=True)
        y = y.astype(np.float64)
        f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=5.0)
        _W[path] = (f0, pyworld.cheaptrick(y, f0, t, FS), pyworld.d4c(y, f0, t, FS))
    return _W[path]


def stable_vowel(path, win=24):
    """有声で音高が一番平らな 120ms（母音の芯）。→ (sp, ap, スコア)"""
    f0, sp, ap = world(path)
    e = np.log(sp.sum(axis=1) + 1e-12)
    best = None
    for a in range(0, len(f0) - win):
        w = f0[a:a + win]
        if (w <= 0).any():
            continue
        s = float(np.std(np.log(w))) - 0.02 * float(e[a:a + win].mean())
        if best is None or s < best[0]:
            best = (s, a)
    s, a = best
    return sp[a:a + win], ap[a:a + win], s


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def vsyn(src, midi, dur, att=0.012, rel=0.05, bright=0.5):
    """母音の芯を往復で伸ばし、f0 を一定の音程にした「声のシンセ」1音。"""
    sp, ap, _ = src
    nf = max(4, int(dur * 200) + 1)
    k = len(sp)
    idx = np.array([(i % (2 * k - 2)) for i in range(nf)])
    idx = np.where(idx < k, idx, 2 * k - 2 - idx)
    f0 = np.full(nf, hz(midi)) * (1 + 0.003 * np.sin(np.arange(nf) / 200 * 2 * np.pi * 5.5))
    x = pyworld.synthesize(f0, sp[idx].copy(), np.clip(ap[idx] * bright, 0, 1), FS, 5.0)
    env = np.ones(len(x))
    a, r = int(att * FS), min(len(x) // 2, int(rel * FS))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return x * env


def chop(c, mi, midi, length):
    """音節 mi を子音頭から length 秒だけ切り、有声部の f0 を midi に揃えた1粒。"""
    f0, sp, ap = world(c["path"])
    m = c["snd"][mi]
    a = int(max(0, m["start"] - 0.005) * 200)
    b = min(len(f0), a + max(3, int(length * 200)))
    f = f0[a:b].copy()
    if midi is not None:
        f[f > 0] = hz(midi)
    x = pyworld.synthesize(f, sp[a:b].copy(), ap[a:b].copy(), FS, 5.0)
    r = min(len(x) // 2, int(0.03 * FS))
    x[-r:] *= np.linspace(1, 0, r)
    x[:64] *= np.linspace(0, 1, 64)
    return x


def burst(c, mi, length=0.07):
    """子音の破裂（打楽器）。高域だけ残す。"""
    x = chop(c, mi, None, length)
    x = x - np.convolve(x, np.ones(9) / 9, mode="same")
    return x * np.exp(-np.arange(len(x)) / (0.02 * FS))


def place(buf, x, t, g=1.0):
    a = int(t * FS)
    m = min(len(x), len(buf) - a)
    if m > 0:
        buf[a:a + m] += g * x[:m]


def near(pc_midi, lo=57, hi=69):
    m = pc_midi
    while m < lo:
        m += 12
    while m > hi:
        m -= 12
    return m
