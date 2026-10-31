"""元の波形を残したまま音程と長さを変える（Praat の PSOLA）。WORLD の作り直しで子音とフォルマントがなまるのを避ける。使い捨て。

子音（モーラの頭から母音頭まで）は伸び縮みさせず、母音だけを伸ばす。音程は母音の周期を並べ直すだけなので、
スペクトルの形（フォルマント）は元の声のまま。
"""
import sys
from pathlib import Path

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import parselmouth  # noqa: E402
from parselmouth.praat import call  # noqa: E402

FS = 44100
_S = {}


def sound(path):
    if path not in _S:
        y, _ = librosa.load(str(path), sr=FS, mono=True)
        _S[path] = parselmouth.Sound(y.astype(np.float64), FS)
    return _S[path]


def _render(snd, dur_points, pitch, floor=50, ceil=600):
    """snd を Manipulation にし、長さ（(時刻, 倍率) の列、区間ごとに一定）と音程を差し替えて重ね合わせで作り直す。
    pitch: [(t0, t1, 倍率)] で元の音程に掛ける区間、または [(t0, t1, ("hz", 値))] でその区間を一定の高さに。
    音程の印は台詞まるごとで付ける（短い切れ端だと低い声の周期が見つからず、無声のまま残る）。"""
    m = call(snd, "To Manipulation", 0.005, floor, ceil)
    d = snd.get_total_duration()
    pt = call(m, "Extract pitch tier")
    for t0, t1, r in pitch:
        t0, t1 = max(0.0, t0), min(d, t1)
        if isinstance(r, tuple):
            call(pt, "Remove points between", t0, t1)
            for t in np.arange(t0, t1 + 1e-9, 0.01):
                call(pt, "Add point", float(t), float(r[1]))
        elif abs(r - 1) > 1e-4:
            call(pt, "Multiply frequencies", t0, t1, float(r))
    call([pt, m], "Replace pitch tier")
    dt = call("Create DurationTier", "d", 0, d)
    for (t0, f), (t1, _) in zip(dur_points, dur_points[1:] + [(d, None)]):
        call(dt, "Add point", max(0.0, t0 + 1e-4), float(f))
        call(dt, "Add point", max(0.0, t1 - 1e-4), float(f))
    call([m, dt], "Replace duration tier")
    out = call(m, "Get resynthesis (overlap-add)")
    return out.values[0].copy()


def chop(c, mi, hz, length):
    """モーラ mi を子音頭から次のモーラ頭まで元の波形で切り、母音だけを伸び縮みさせて length 秒、音程は hz 一定。
    作り直しは台詞まるごとで行い、この区間より前は長さを変えないので、出力でも t0 から切り出せる。"""
    snd_full = sound(c["path"])
    snd = c["snd"]
    m = snd[mi]
    t0 = max(0.0, m["start"] - 0.01)
    t1 = snd[mi + 1]["start"] if mi + 1 < len(snd) else m["end"] + 0.03
    t1 = min(t1, snd_full.get_total_duration() - 0.01)
    tv = min(max(m["vstart"], t0 + 0.01), t1 - 0.02)
    cons, vow = tv - t0, t1 - tv
    f = float(np.clip((length - cons) / vow, 0.3, 12.0))
    x = _render(snd_full, [(0.0, 1.0), (tv, f), (t1, 1.0)], [(t0 - 0.03, t1 + 0.03, ("hz", hz))])
    a = int(t0 * FS)
    n = int(length * FS)
    x = x[a:a + n]
    x = x if len(x) >= n else np.pad(x, (0, n - len(x)))
    r = min(len(x) // 2, int(0.025 * FS))
    x[-r:] *= np.linspace(1, 0, r)
    x[:32] *= np.linspace(0, 1, 32)
    return x


def line(c, grid_t, ratios):
    """台詞まるごと: 母音頭 c["on"] を grid_t へ写す。伸び縮みは各区間の母音部だけ（子音は元の長さ）、音程はモーラごとに ratios 倍。
    → (波形, 曲の上での開始時刻)"""
    snd_full = sound(c["path"])
    snd = c["snd"]
    on = list(c["on"])
    pre = min(0.15, on[0])
    t0 = on[0] - pre
    tail = max(0.05, min(0.6, snd[-1]["end"] - on[-1]))
    t1 = min(snd_full.get_total_duration(), on[-1] + tail + 0.05)
    part = call(snd_full, "Extract part", t0, t1, "rectangular", 1, "no")
    pts = [(0.0, 1.0)]
    for i in range(len(on) - 1):
        a, b = on[i] - t0, on[i + 1] - t0
        cons_next = max(0.0, min(b - a - 0.02, snd[i + 1]["vstart"] - snd[i + 1]["start"]))
        want = grid_t[i + 1] - grid_t[i]
        vow = (b - a) - cons_next
        f = float(np.clip((want - cons_next) / max(vow, 0.02), 0.3, 6.0))
        pts.append((a, f))
        pts.append((b - cons_next, 1.0))
    hold = max(tail, (grid_t[-1] - grid_t[-2]) if len(grid_t) > 1 else tail)
    pts.append((on[-1] - t0, float(np.clip(hold / tail, 0.5, 4.0))))
    pts = sorted({round(t, 5): f for t, f in pts}.items())
    bounds = [on[i] - t0 - 0.04 for i in range(len(on))] + [t1 - t0]
    pitch = [(max(0, bounds[i]), bounds[i + 1], ratios[i]) for i in range(len(on))]
    x = _render(part, pts, pitch)
    f = int(0.01 * FS)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x, grid_t[0] - pre


def lead(c, mi):
    """chop が母音頭より前に持つ長さ（秒）。この分だけ早く置くと母音頭が格子に乗る。"""
    m = c["snd"][mi]
    return float(np.clip(m["vstart"] - max(0.0, m["start"] - 0.01), 0.0, 0.08))
