"""語録をモーラごとに直して音符へ合わせる部品（docs/otomad/techniques/voice-cleanup.md・speech-melody.md）。

load(path)            読み込み・環境音を引く・言葉の間を切る・前後の無音を落とす
boundaries(y, kana)   読みに合わせてモーラの区切りを探す（音の変わり目と音量の谷）
fit(y, bd, notes)     モーラごとに音符の長さと高さへ TD-PSOLA で合わせる。波形を残し、子音は伸ばさない
sus_sample / note_of  声の安定した所をループにして楽器にする
hit(path, kind)       短い物音を打楽器の形に切る。聞こえる大きさでそろえる
plate / limiter       残響とリミッタ
"""
import numpy as np
import pyworld
import soundfile as sf
from scipy.ndimage import maximum_filter1d, median_filter
from scipy.signal import butter, fftconvolve, istft, resample_poly, sosfilt, stft

FS = 44100
_rng = np.random.default_rng(25)
SMALL = set("ゃゅょぁぃぅぇぉャュョァィゥェォ")
UNVOICED = set("かきくけこさしすせそたちつてとはひふへほぱぴぷぺぽっカキクケコサシスセソタチツテトハヒフヘホパピプペポッ")


def lp(x, fc, o=2):
    return sosfilt(butter(o, min(fc, FS * .45), "low", fs=FS, output="sos"), x, axis=0)


def hp(x, fc, o=2):
    return sosfilt(butter(o, fc, "high", fs=FS, output="sos"), x, axis=0)


def rd(path):
    y, sr = sf.read(path, always_2d=True)
    y = y.mean(1).astype(float)
    return resample_poly(y, FS, sr) if sr != FS else y


def clean(y, floor=.08, gate=.09):
    """静かな所からノイズの形を測って引き、言葉の間をゲートで切る。戻り値は (波形, SNR)。"""
    y = hp(y, 80)
    nper, hop = 1024, 256
    _, _, Z = stft(y, FS, nperseg=nper, noverlap=nper - hop)
    P = np.abs(Z) ** 2
    E = P.sum(0)
    N = P[:, E <= np.percentile(E, 12)].mean(1, keepdims=True) + 1e-12
    snr = 10 * np.log10(np.percentile(E, 90) / (np.percentile(E, 12) + 1e-12))
    alpha = float(np.clip((42 - snr) / 12, 1., 3.))
    G = np.clip(1 - alpha * N / (P + 1e-12), floor ** 2, 1) ** .5
    G = median_filter(G, size=(3, 5))
    _, x = istft(Z * G, FS, nperseg=nper, noverlap=nper - hop)
    x = np.pad(x[:len(y)], (0, max(0, len(y) - len(x))))
    n = int(.02 * FS)
    e = np.sqrt(np.convolve(x ** 2, np.ones(n) / n, "same"))
    g = np.convolve((e > np.percentile(e, 95) * gate).astype(float), np.ones(int(.03 * FS)), "same") > 0
    k = int(.008 * FS)
    g = np.convolve(g.astype(float), np.ones(k) / k, "same")
    return x * (.02 + .98 * g), snr


def trim(y, th=.05):
    fr = 441
    e = np.sqrt(np.convolve(y ** 2, np.ones(fr) / fr, "same"))
    idx = np.where(e > max(e.max() * th, 1e-4))[0]
    return y[max(0, idx[0] - 200):min(len(y), idx[-1] + 700)]


def load(path, denoise=True):
    y = rd(path)
    if denoise:
        y, _ = clean(y)
    return trim(y)


def morae(kana):
    out = []
    for c in kana:
        if c in SMALL and out:
            out[-1] += c
        else:
            out.append(c)
    return out


def boundaries(y, kana):
    """読みのモーラ数に分ける。音の変わり目が強く、長さの見込みに近い組を動的計画法で選ぶ。"""
    mo = morae(kana)
    n = len(mo)
    if n <= 1:
        return np.array([0., len(y) / FS])
    hop, win = 441, np.hanning(1024)
    fr = np.array([np.abs(np.fft.rfft(y[i:i + 1024] * win)) ** .5 for i in range(0, max(1, len(y) - 1024), hop)])
    flux = np.r_[0, np.maximum(0, np.diff(fr, axis=0)).sum(1)]
    flux = np.convolve(flux, np.ones(3) / 3, "same")
    flux /= flux.max() + 1e-9
    e = np.sqrt((fr ** 4).sum(1))
    e /= e.max() + 1e-9
    sc = flux + .6 * np.r_[0, np.maximum(0, np.diff(e))] / (np.maximum(0, np.diff(e)).max() + 1e-9)
    T = len(sc)
    f0, _ = pyworld.harvest(y, FS, f0_floor=70, f0_ceil=900, frame_period=10.0)
    vo = np.pad((f0[:T] > 0).astype(float), (0, max(0, T - len(f0))))
    vdrop = np.convolve(np.r_[0, np.maximum(0, -np.diff(vo))], [.5, 1, .5], "same")
    wts = np.array([{"っ": .75, "ッ": .75, "ん": .85, "ン": .85, "ー": 1.1}.get(m[0], 1.) for m in mo])
    ex = wts / wts.sum() * T
    INF = -1e9
    best = np.full((n, T + 1), INF)
    back = np.zeros((n, T + 1), dtype=int)
    best[0, 0] = 0
    for k in range(1, n):
        lo, hi = max(int(ex[k - 1] * .3), 3), int(ex[k - 1] * 2.4) + 3
        bon = vdrop * 1.3 if mo[k][0] in UNVOICED else 0.
        for t in range(1, T):
            a, b = max(0, t - hi), t - lo
            if b <= a:
                continue
            cand = best[k - 1, a:b] - .55 * (((t - np.arange(a, b)) - ex[k - 1]) / ex[k - 1]) ** 2
            q = int(np.argmax(cand))
            if cand[q] > INF / 2:
                best[k, t] = cand[q] + sc[t] + (bon[t] if not np.isscalar(bon) else 0.)
                back[k, t] = a + q
    ends = best[n - 1, :T] - .55 * (((T - np.arange(T)) - ex[n - 1]) / ex[n - 1]) ** 2
    t = int(np.argmax(ends))
    out = [len(y) / FS]
    for k in range(n - 1, 0, -1):
        out.append(t * hop / FS)
        t = back[k, t]
    out.append(0.)
    return np.array(out[::-1])


def f0_of(y, floor=70):
    f0, t = pyworld.harvest(y, FS, f0_floor=floor, f0_ceil=900, frame_period=5.0)
    return pyworld.stonemask(y, f0, t, FS)


def psola(y, f0, tmap, smap, ratio, dur, fmt=1.0):
    """TD-PSOLA。tmap→smap は出力の秒→元の秒。ratio(t) は音高の倍率。fmt>1 でフォルマントを上げる。"""
    fp = .005
    n_out = int(dur * FS) + 1
    out, wgt = np.zeros(n_out + 4096), np.zeros(n_out + 4096)
    ts = 0.
    while ts < dur:
        s = float(np.interp(ts, tmap, smap))
        f = f0[min(len(f0) - 1, int(s / fp))]
        if f > 0:
            per = FS / f
            c, r = int(s * FS), int(per / 2)
            a, b = max(0, c - r), min(len(y), c + r)
            c = a + int(np.argmax(y[a:b])) if b > a else c
            half, hop, voiced = int(min(per, 900)), per / max(ratio(ts), 1e-3), True
        else:
            c, half, hop, voiced = int(s * FS), 220, 110., False
        a, b = c - half, c + half
        a0, b0 = max(0, a), min(len(y), b)
        if b0 > a0:
            w = np.hanning(2 * half)[a0 - a:b0 - a]
            g = y[a0:b0] * w
            if voiced and abs(fmt - 1) > .005 and len(g) > 8:
                n2 = max(4, int(len(g) / fmt))
                xs = np.linspace(0, len(g) - 1, n2)
                g, w = np.interp(xs, np.arange(len(g)), g), np.interp(xs, np.arange(len(w)), w)
                a0 = c - n2 // 2
            p = int(ts * FS) + (a0 - c)
            p0 = max(0, p)
            g, w = g[p0 - p:], w[p0 - p:]
            e = min(len(out), p0 + len(g))
            if e > p0:
                out[p0:e] += g[:e - p0]
                wgt[p0:e] += w[:e - p0]
        ts += hop / FS
    return (out / np.maximum(wgt, .35))[:n_out]


def mora_pitch(y, bd):
    """モーラごとの音高（midi の中央値）。無声で測れなければ None。"""
    f0 = f0_of(y)
    out = []
    for a, b in zip(bd[:-1], bd[1:]):
        v = f0[int(a / .005):int(b / .005)]
        v = v[v > 0]
        out.append(float(69 + 12 * np.log2(np.median(v) / 440)) if len(v) > 2 else None)
    return out


def fit(y, bd, notes, keep=.45, head=.04, fmt=1.0, level=True):
    """モーラ i を notes[i]=(始め秒, 終わり秒, midi) に合わせる。音高は音符へ寄せ、元の揺れを keep だけ残す。

    midi が None のモーラは元の高さのまま。子音の頭 head 秒は伸ばさない。戻り値は notes[0] の始めを 0 とする波形。
    """
    f0 = f0_of(y)
    t0 = notes[0][0]
    tm, sm = [], []
    for i, (a, b, _) in enumerate(notes):
        sa, sb = bd[i], bd[i + 1]
        oa, ob = a - t0, b - t0
        h = min(head, (sb - sa) * .4, (ob - oa) * .4)
        tm += [oa, oa + h, ob]
        sm += [sa, sa + h, sb]
    base = mora_pitch(y, bd)
    base = [None if m is None else p for p, (_, _, m) in zip(base, notes)]
    ends = np.array([n[1] - t0 for n in notes])
    dur = float(ends[-1])
    tm, sm = np.array(tm), np.array(sm)

    def ratio(t):
        i = min(int(np.searchsorted(ends, t, side="right")), len(notes) - 1)
        if base[i] is None:
            return 1.
        f = f0[min(len(f0) - 1, int(float(np.interp(t, tm, sm)) / .005))]
        if f <= 0:
            return 2 ** ((notes[i][2] - base[i]) / 12)
        cur = 12 * np.log2(f / 440) + 69
        dev = cur - base[i]
        dev = dev if abs(dev) < 4 else 0.  # 読み違いの飛びは揺れに入れない
        return 2 ** ((notes[i][2] + keep * dev - cur) / 12)

    x = psola(y, f0, tm, sm, ratio, dur + .05, fmt)
    return even(x, [n[0] - t0 for n in notes] + [dur]) if level else x


def even(x, edges, lo=-6, hi=4):
    """モーラごとに音量をそろえる（lo〜hi dB）。"""
    rms = []
    for a, b in zip(edges[:-1], edges[1:]):
        s = x[int(a * FS):int(b * FS)]
        rms.append(np.sqrt((s ** 2).mean()) + 1e-6 if len(s) else 1e-6)
    med = np.median(rms)
    env = np.ones(len(x))
    for a, b, r in zip(edges[:-1], edges[1:], rms):
        env[int(a * FS):int(b * FS)] = 10 ** (np.clip(20 * np.log10(med / r), lo, hi) / 20)
    n = int(.006 * FS)
    return x * np.convolve(env, np.ones(n) / n, "same")


def sus_sample(path, want=.35, denoise=False):
    """いちばん音程が安定した所を切り、継ぎ目を重ねてループにする。戻り値は (波形, 実際の midi)。"""
    y = rd(path)
    if denoise:
        y, _ = clean(y)
    f0 = f0_of(y)
    w = int(want / .005)
    best = None
    for i in range(0, max(1, len(f0) - w), 4):
        v = f0[i:i + w]
        if (v > 0).mean() < .95:
            continue
        sc = np.std(np.log(v[v > 0]))
        if best is None or sc < best[0]:
            best = (sc, i)
    i = best[1] if best else 0
    a = int(i * .005 * FS)
    seg = y[a:a + int(want * FS)]
    f = f0[i:i + w]
    root = 69 + 12 * np.log2(np.median(f[f > 0]) / 440) if (f > 0).any() else 60.
    x = min(int(.06 * FS), len(seg) // 3)
    out = seg[:-x].copy()
    r = np.linspace(0, 1, x)
    out[:x] = out[:x] * r + seg[-x:] * (1 - r)
    return out / (np.abs(out).max() + 1e-9), float(root)


def adsr(n, a, d, s, r):
    na, nd, nr = int(a * FS), int(d * FS), int(r * FS)
    e = np.full(n, s, dtype=float)
    e[:min(na, n)] = np.linspace(0, 1, na)[:min(na, n)]
    if nd and na < n:
        p = e[na:na + nd]
        p[:] = np.linspace(1, s, nd)[:len(p)]
    k = min(nr, n)
    if k:
        e[-k:] *= np.linspace(1, 0, k)
    return e


def note_of(smp, root, m, n, a=.004, d=.1, s=.85, r=.04):
    rate = 2 ** ((m - root) / 12)
    y = np.interp((np.arange(n) * rate) % (len(smp) - 1), np.arange(len(smp)), smp)
    return y * adsr(n, a, d, s, r)


LEN = dict(kick=.24, snare=.2, clap=.2, hat=.07, ohat=.16, perc=.14, crash=1., tom=.24)
RMS = dict(kick=.5, snare=.42, clap=.34, hat=.26, ohat=.26, perc=.3, crash=.28, tom=.38)


def hit(path, kind, cut=None):
    """物音を打楽器に切る。立ち上がりから切り、指数で減衰させ、40ms の音量でそろえる。キックは正弦波の胴を足す。"""
    y = rd(path)
    y = y / (np.abs(y).max() + 1e-9)
    n = int(.004 * FS)
    e = np.sqrt(np.convolve(y ** 2, np.ones(n) / n, "same"))
    on = max(0, int(np.argmax(e > .25)) - int(.0015 * FS))
    ln = int((cut or LEN[kind]) * FS)
    y = y[on:on + ln]
    if kind == "kick":
        y = np.pad(lp(resample_poly(y, 8, 5), 2600), (0, ln))[:ln]
        tt = np.arange(ln) / FS
        y = y * .7 + np.sin(2 * np.pi * (52 * tt + 90 * (1 - np.exp(-tt * 40)) / 40)) * np.exp(-tt * 14) * .85
    elif kind in ("snare", "clap", "tom", "perc"):
        y = hp(y, 170)
    elif kind in ("hat", "ohat"):
        y = hp(y, 3200)
    elif kind == "crash":
        y = hp(y, 700)
    y = y * np.exp(-np.arange(len(y)) / FS / ((cut or LEN[kind]) * .38))
    y[-200:] *= np.linspace(1, 0, min(200, len(y)))
    n = int(.04 * FS)
    y = y * RMS[kind] / (np.sqrt(np.convolve(y ** 2, np.ones(n) / n, "same")).max() + 1e-9)
    return np.tanh(y * 1.2) / 1.2


def plate(y, wet, decay=.55, pre=.03, lo=300, hi=6500):
    """y は (n, 2)。"""
    n = int(decay * 3 * FS)
    ir = _rng.standard_normal((n, 2)) * np.exp(-np.arange(n) / FS / decay * 2.2)[:, None]
    ir = np.stack([hp(lp(ir[:, c], hi), lo) for c in (0, 1)], 1)
    ir /= np.sqrt((ir ** 2).sum(0))
    d = int(pre * FS)
    out = y.copy()
    for c in range(2):
        out[d:, c] += wet * fftconvolve(y[:, c], ir[:, c])[:len(y) - d]
    return out


def limiter(x, ceil=.9):
    n = int(.004 * FS)
    a = maximum_filter1d(np.abs(x).max(1), n * 2 + 1)
    g = np.minimum(1, ceil / (a + 1e-9))
    g = np.convolve(maximum_filter1d(1 - g, n * 2 + 1), np.ones(n * 2 + 1) / (n * 2 + 1), "same")
    return x * (1 - g)[:, None]
