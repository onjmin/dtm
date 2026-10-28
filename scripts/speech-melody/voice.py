"""台詞を16分格子へ置き（place）、モーラごとに音の中心をペンタへ寄せて（correct）、WORLD で伸縮・再合成する（render_voice）。

作者（ももも味）の手順: 台詞合わせで先にリズム → モーラ単位に音程補正（台詞の最後の音を主音にしたペンタ）→ 採譜 → 和音は旋律から。
"""
import math

import librosa
import numpy as np
import pyworld

from setting import clip_data

FS = 44100
FRAME_MS = 5.0
BASE_STRETCH = 1.25  # 作例の台詞全体の伸縮 1.15〜2.05 の下寄り


def add(buf, x, at):
    i = int(round(at * FS))
    if i >= len(buf) or i < 0:
        return
    x = x[: len(buf) - i]
    buf[i: i + len(x)] += x


def load_clips(lines, anchor):
    """lines: [(ファイル, 読み)] → {(ファイル, 読み): 台詞の情報}。

    anchor は格子に合わせる点。子音の始まりから母音頭までの anchor 割の位置（1.0 で母音頭）。
    子音・息の長い素材は 1.0、短い素材は 0.0 が合った。
    """
    cache = {}
    for key in lines:
        if key in cache:
            continue
        c = clip_data(*key)
        y, _ = librosa.load(str(key[0]), sr=16000)
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
        c["on"] = np.array([m["start"] + anchor * (m["vstart"] - m["start"]) for m in snd])
        c["midi"] = np.array([c["medMidi"] + m["st"] if m["st"] is not None else np.nan for m in snd])
        c["strength"] = np.array(strength)
        cache[key] = c
    return cache


def place(c, six, w_beat=0.8, kmax=12, lmax=None):
    """全モーラを16分へ。強い音節を拍頭へ置き、伸縮を BASE_STRETCH 付近に保つ DP。戻り値は台詞頭からの16分位置。"""
    on, s = c["on"], c["strength"]
    n = len(on)
    if n == 1:
        return np.array([0])
    L = int(math.ceil((on[-1] - on[0]) * 2.5 / six)) + 4
    if lmax is not None:
        L = lmax  # 最後のモーラを lmax 未満に収める（半小節ループなど）
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


# ── 音程補正 ───────────────────────────────────

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
    """モーラごとの音の中心を音階へ。元の上下（0.5 半音以上）と横ばいを保つ。補正は ±1.5 半音まで。"""
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
        if abs(q - m) > 1.5:  # 向きを保てなくても近い音へ
            q = near
        out.append(q)
        prev = (m, q)
    return np.array(out)


def harmonize(bar_notes, root, nbars):
    """旋律から和音を付ける（作者の手順の4）。自然短音階の三和音から、小節の旋律の音を一番多く含むもの。

    bar_notes: {小節: [(MIDI, 重み)]}。同じ和音の連続は少し減点、よくある進行は加点。
    """
    steps = [0, 2, 3, 5, 7, 8, 10]
    sc = [(root + s) % 12 for s in steps]
    chords = [(sc[d], {sc[d], sc[(d + 2) % 7], sc[(d + 4) % 7]}, ["i", "ii°", "III", "iv", "v", "VI", "VII"][d]) for d in range(7)
              if d != 1]
    good = {("VI", "VII"), ("VII", "i"), ("i", "VI"), ("iv", "v"), ("v", "i"), ("III", "VII"), ("i", "iv"), ("VI", "III"),
            ("iv", "VII"), ("VII", "III"), ("i", "VII"), ("VII", "VI")}
    nc = len(chords)
    back = np.zeros((nbars, nc), int)
    fits = np.zeros((nbars, nc))
    for b in range(nbars):
        for k, ch in enumerate(chords):
            fits[b, k] = sum(w * (2 if (int(m) % 12) in ch[1] else -0.5) for m, w in bar_notes.get(b, []))
    score = fits[0].copy()
    for b in range(1, nbars):
        new = np.empty(nc)
        for k in range(nc):
            cand = [score[i] + (0.8 if (chords[i][2], chords[k][2]) in good else 0) - (0.4 if i == k else 0)
                    for i in range(nc)]
            back[b, k] = int(np.argmax(cand))
            new[k] = max(cand) + fits[b, k]
        score = new
    path = [int(np.argmax(score))]
    for b in range(nbars - 1, 0, -1):
        path.append(back[b, path[-1]])
    return [chords[k] for k in reversed(path)]


# ── 声 ───────────────────────────────────────

def render_voice(c, grid_t, ratios):
    """格子に合わせる点を grid_t（秒）へ写し、モーラごとに f0 を ratios[i] 倍（中心の補正）。揺れは原音のまま。

    戻り値: (波形, 台詞頭からの開始ずれ秒)。置くときは 台詞頭の時刻 + 開始ずれ へ足す。
    """
    y, _ = librosa.load(str(c["path"]), sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=FRAME_MS)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 1000 / FRAME_MS
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
    r = np.convolve(np.log(ratio_src[j]), np.ones(4) / 4, mode="same")  # 補正比のつなぎ目は 20ms でなめらかに
    out = pyworld.synthesize(f0[j] * np.exp(r), sp[j].copy(), ap[j].copy(), FS, FRAME_MS)
    f = int(0.01 * FS)
    out[:f] *= np.linspace(0, 1, f)
    out[-3 * f:] *= np.linspace(1, 0, 3 * f)
    return out, d0


def tune_line(c, six, shift, pcs):
    """台詞を shift 半音移調し、pcs の音階へ補正して描く。→ (波形, 開始ずれ, 補正後の MIDI 列)"""
    q = correct(c["midi"] + shift, pcs)
    ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (shift / 12)
              for qq, m in zip(q, c["midi"])]
    x, d0 = render_voice(c, c["pos"] * six, ratios)
    return x, d0, q
