"""モーラごとの音の中心を音階へ寄せる部品（サムソンの build から切り出し。作者の手順の「音程」の段）。

元の上下と横ばいを保ったまま音階音へ寄せ（correct）、モーラごとの補正比で声を作り直す（render_voice）。
"""
import librosa
import numpy as np
import pyworld

FS = 44100


def pent_minor(root):
    return np.array([(root + s) % 12 for s in (0, 3, 5, 7, 10)])


def snap_to(m, pcs):
    cands = np.array([o * 12 + p for o in range(int(m // 12) - 1, int(m // 12) + 2) for p in pcs], float)
    return float(cands[np.argmin(np.abs(cands - m))])


def step_in(q, pcs, up):
    k = q + (1 if up else -1)
    while k % 12 not in pcs:
        k += 1 if up else -1
    return float(k)


def correct(midis, pcs):
    """モーラごとの音の中心を音階へ。元の上下（0.5 半音以上）と横ばいを保つ。"""
    out, prev = [], None
    for m in midis:
        if not np.isfinite(m):
            out.append(np.nan)
            continue
        q = snap_to(m, pcs)
        near = q
        if prev is not None:
            d = m - prev[0]
            if d >= 0.5 and q <= prev[1]:
                q = step_in(prev[1], pcs, True)
            elif d <= -0.5 and q >= prev[1]:
                q = step_in(prev[1], pcs, False)
            elif abs(d) < 0.5:
                q = prev[1]
        if abs(q - m) > 1.5:  # 補正は ±1.5 半音まで（向きを保てなくても近い音へ）
            q = near
        out.append(q)
        prev = (m, q)
    return np.array(out)


def render_voice(c, grid_t, ratios):
    """母音頭を格子へ写し、モーラごとに f0 を ratios[i] 倍（中心の補正）。揺れは原音のまま。"""
    y, _ = librosa.load(str(c["path"]), sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=5.0)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 200.0
    on = c["on"]
    # 原音側の各フレームがどのモーラに属するか（母音頭の手前は前のモーラの子音として次へ寄せる）
    ratio_src = np.ones(len(f0))
    bounds = list(on) + [on[-1] + 1.0]
    for i in range(len(on)):
        a = int(max(0, (bounds[i] - (0.06 if i == 0 else 0.04)) * fps))
        b = int((bounds[i + 1] - 0.04) * fps) if i + 1 < len(on) else len(f0)
        ratio_src[a:max(a, b)] = ratios[i]
    pre = min(0.15, on[0])
    src = [on[0] - pre] + list(on)
    dst = [grid_t[0] - pre] + list(grid_t)
    tail = max(0.05, min(0.6, c["snd"][-1]["end"] - on[-1]))
    hold = max(tail, (grid_t[-1] - grid_t[-2]) if len(grid_t) > 1 else tail)
    src.append(on[-1] + tail)
    dst.append(grid_t[-1] + hold)
    d0 = dst[0]
    nf = int((dst[-1] - d0) * fps) + 1
    ts = np.interp(d0 + np.arange(nf) / fps, dst, src)
    j = np.clip((ts * fps).astype(int), 0, len(f0) - 1)
    # 補正比のつなぎ目は 20ms でなめらかに
    r = ratio_src[j]
    r = np.convolve(np.log(r), np.ones(4) / 4, mode="same")
    out = pyworld.synthesize(f0[j] * np.exp(r), sp[j].copy(), ap[j].copy(), FS, 5.0)
    f = int(0.01 * FS)
    out[:f] *= np.linspace(0, 1, f)
    out[-3 * f:] *= np.linspace(1, 0, 3 * f)
    return out, d0
