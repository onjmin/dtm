"""台詞を16分の格子へ置く部品（淫夢 v3 から切り出し。多くの曲の build が inmu_v3 経由で読む）。

強い音節を拍頭へ置く不均一な伸縮（place）、調の推定と台詞ごとの移調、母音頭を格子へ写す声の合成。
曲ごとの台詞の並び（SECTIONS）や SIX は曲の側が持ち、引数で渡す。
"""
import math
import os

import librosa
import numpy as np
import pyworld

from compose_quotes3 import expenv
from setting import clip_data

FS = 44100
FRAME_MS = 5.0
BASE_STRETCH = 1.25  # 作例の台詞全体の伸縮 1.15〜2.05 の下寄り
KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def K(c):
    return c[:4]


# ── 素材と音節の強さ ───────────────────────────────

def load_clips(sections):
    cache = {}
    for _, items in sections:
        for key, _rep in items:
            if key in cache:
                continue
            c = clip_data(key[0], key[2], key[3])
            y, sr = librosa.load(str(key[0]), sr=16000)
            rms = librosa.feature.rms(y=y, frame_length=400, hop_length=160)[0]
            rms = rms / (rms.max() + 1e-9)
            snd, heads_snd, j = [], set(), 0
            for i, m in enumerate(c["morae"]):
                if m["vowel"] == "cl":
                    continue
                if i in c["heads"]:
                    heads_snd.add(j)
                snd.append(m)
                j += 1
            strength = []
            for j, m in enumerate(snd):
                a = int(m["vstart"] * 100)
                loud = float(rms[a:a + 8].max()) if a < len(rms) else 0.0
                dur = m["end"] - m["vstart"]
                strength.append(loud + (0.3 if j in heads_snd else 0) + (0.2 if dur > 0.15 else 0))
            c["snd"] = snd
            # 格子に合わせる点: 子音の始まりから母音頭までの ANCHOR 割の位置（1.0 で母音頭）
            r_ = float(os.environ.get("ANCHOR", "0.0"))
            c["on"] = np.array([m["start"] + r_ * (m["vstart"] - m["start"]) for m in snd])
            c["midi"] = np.array([c["medMidi"] + m["st"] if m["st"] is not None else np.nan for m in snd])
            c["strength"] = np.array(strength)
            cache[key] = c
    return cache


def place(c, six, w_beat=0.8, kmax=12, lmax=None):
    """全モーラを16分へ。強い音節を拍頭へ置き、伸縮を BASE_STRETCH 付近に保つ DP。"""
    on, s = c["on"], c["strength"]
    n = len(on)
    if n == 1:
        return np.array([0])
    L = int(math.ceil((on[-1] - on[0]) * 2.5 / six)) + 4
    if lmax is not None:
        L = lmax  # 半小節ループ用: 最後のモーラを lmax 未満に収める
    INF = 1e18
    cost = np.full((n, L), INF)
    back = np.zeros((n, L), int)
    for p in range(4):  # 1拍目の中のどこから入ってもよい（弱起）
        cost[0, p] = -w_beat * s[0] * (p % 4 == 0)
    for i in range(1, n):
        ioi = max(0.03, on[i] - on[i - 1])
        for p in range(i, L):
            best, arg = INF, 0
            for k in range(1, kmax + 1):
                q = p - k
                if q < 0 or cost[i - 1, q] >= INF:
                    continue
                st = math.log(k * six / (ioi * BASE_STRETCH))
                v = cost[i - 1, q] + st * st
                if v < best:
                    best, arg = v, q
            if best < INF:
                cost[i, p] = best - w_beat * s[i] * (p % 4 == 0)
                back[i, p] = arg
    p = int(np.argmin(cost[-1]))
    out = [p]
    for i in range(n - 1, 0, -1):
        p = back[i, p]
        out.append(p)
    return np.array(out[::-1])


# ── 調・移調・和音の語彙 ─────────────────────────────

def choose_key(hist):
    best = None
    for r in range(12):
        for mode, prof in (("major", KK_MAJ), ("minor", KK_MIN)):
            c = np.corrcoef(hist, np.roll(prof, r))[0, 1]
            if best is None or c > best[0]:
                best = (c, r, mode)
    return best[1], best[2]


def chord_vocab(root, mode):
    """調の三和音と7の和音（根音pc, 構成音pc集合, 名前）。"""
    steps = [0, 2, 4, 5, 7, 9, 11] if mode == "major" else [0, 2, 3, 5, 7, 8, 10]
    sc = [(root + s) % 12 for s in steps]
    out = []
    for d in range(7):
        tri = [sc[d], sc[(d + 2) % 7], sc[(d + 4) % 7]]
        out.append((sc[d], set(tri), f"{d + 1}"))
        out.append((sc[d], set(tri + [sc[(d + 6) % 7]]), f"{d + 1}7"))
    return out, set(sc)


def scale_set(root, mode):
    steps = [0, 2, 4, 5, 7, 9, 11] if mode == "major" else [0, 2, 3, 5, 7, 8, 10]
    return np.array([(root + x) % 12 for x in steps])


def best_transpose(midi, w, sc):
    """台詞まるごとの移調量（±2半音、0.25刻み）。音階音までの距離（音価重み）が最小のもの。"""
    ok = np.isfinite(midi)
    best = None
    for t in np.arange(-2, 2.01, 0.25):
        x = (midi[ok] + t) % 12
        d = np.min(np.abs(((x[:, None] - sc[None, :]) + 6) % 12 - 6), axis=1)
        e = float(np.average(d, weights=w[ok])) + 0.03 * abs(t)
        if best is None or e < best[0]:
            best = (e, t)
    return best[1]


# ── 声: 母音頭を格子へ写し、f0 は原音×移調比 ──────────────

def render_voice(path, on, grid_t, ratio, last_end):
    y, _ = librosa.load(str(path), sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=FRAME_MS)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 1000 / FRAME_MS
    pre = min(0.15, on[0])
    src = [on[0] - pre] + list(on)
    dst = [grid_t[0] - pre] + list(grid_t)
    tail = max(0.05, min(0.6, last_end - on[-1]))
    hold = max(tail, (grid_t[-1] - grid_t[-2]) if len(grid_t) > 1 else tail)
    src.append(on[-1] + tail)
    dst.append(grid_t[-1] + hold)
    d0 = dst[0]
    nf = int((dst[-1] - d0) * fps) + 1
    ts = np.interp(d0 + np.arange(nf) / fps, dst, src)
    j = np.clip((ts * fps).astype(int), 0, len(f0) - 1)
    out = pyworld.synthesize(f0[j] * ratio, sp[j].copy(), ap[j].copy(), FS, FRAME_MS)
    f = int(0.01 * FS)
    out[:f] *= np.linspace(0, 1, f)
    out[-3 * f:] *= np.linspace(1, 0, 3 * f)
    return out, d0


# ── 伴奏の音色 ─────────────────────────────────────

def epiano(hz, n):
    t = np.arange(n) / FS
    mod = 1.2 * np.exp(-t / 0.4) * np.sin(2 * np.pi * hz * 2 * t)
    x = np.sin(2 * np.pi * hz * t + mod) * expenv(n, 0.003, 1.2)
    return x


def sub(hz, n):
    t = np.arange(n) / FS
    return (np.sin(2 * np.pi * hz * t) + 0.25 * np.sin(4 * np.pi * hz * t)) * np.minimum(1, t / 0.005) * np.minimum(1, (n / FS - t) / 0.02)
