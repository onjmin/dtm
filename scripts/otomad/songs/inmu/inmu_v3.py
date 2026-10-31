"""淫夢 台詞イントネーション作曲 v3（notes-inmu3.md）。使い捨て。

強い音節を拍頭へ置くよう台詞ごとに不均一に伸縮し、台詞ごとに移調して、半小節頭から並べる。
python -I inmu_v3.py <outdir>
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyworld  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

import inmu_v1 as M  # noqa: E402
from compose_quotes3 import add, chat, crash, expenv, hp, kick, lp, ohat, snare  # noqa: E402
from inmu_v2 import chord_vocab, choose_key, epiano, sub  # noqa: E402
from setting import clip_data  # noqa: E402

FS = 44100
FRAME_MS = 5.0
BPM = 120
SIX = 15 / BPM
BAR = 16
HALF = 8
BASE_STRETCH = 1.25  # 作例の台詞全体の伸縮 1.15〜2.05 の下寄り
RNG = np.random.default_rng(5)
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

K = lambda c: c[:4]  # noqa: E731
SECTIONS = [
    ("intro", [(K(M.OSS), 1)]),
    ("A", [(K(M.NUA), 1), (K(M.OKUJO), 1), (K(M.AGE), 1), (K(M.GAKU), 1)]),
    ("hook", [(K(M.YARI), 6), (K(M.JAKEN), 1)]),
    ("B", [(K(M.OKANO), 1), (K(M.FA), 2), (K(M.SOUDAYO), 2), (K(M.MITOKE), 1), (K(M.AKUSHIRO), 1)]),
    ("hook", [(K(M.YARI), 6), (K(M.JAKEN), 1)]),
    ("break", [(K(M.NUA), 1), (K(M.GAKU), 1)]),
    ("hook2", [(K(M.YARI), 6), (K(M.JAKEN), 1), (K(M.YARI), 4)]),
    ("end", [(K(M.SUKI), 1)]),
]


# ── 素材と音節の強さ ───────────────────────────────

def load_clips():
    cache = {}
    for _, items in SECTIONS:
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
            import os
            r_ = float(os.environ.get("ANCHOR", "0.0"))
            c["on"] = np.array([m["start"] + r_ * (m["vstart"] - m["start"]) for m in snd])
            c["midi"] = np.array([c["medMidi"] + m["st"] if m["st"] is not None else np.nan for m in snd])
            c["strength"] = np.array(strength)
            cache[key] = c
    return cache


def place(c, w_beat=0.8, kmax=12, lmax=None):
    """全モーラを16分へ。強い音節を拍頭へ置き、伸縮を BASE_STRETCH 付近に保つ DP。"""
    on, s = c["on"], c["strength"]
    n = len(on)
    if n == 1:
        return np.array([0])
    L = int(math.ceil((on[-1] - on[0]) * 2.5 / SIX)) + 4
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
                st = math.log(k * SIX / (ioi * BASE_STRETCH))
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


# ── 移調と和音 ───────────────────────────────────

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


def harmonize(bar_w, vocab, scale):
    def fit(wv, ch):
        sc = 0.0
        for pc in range(12):
            if wv[pc] == 0:
                continue
            if pc in ch[1]:
                sc += wv[pc]
            elif any((pc - t) % 12 == 1 for t in ch[1]):
                sc -= 0.7 * wv[pc]
            elif pc in scale:
                sc += 0.2 * wv[pc]
        return sc - (0.05 if len(ch[1]) == 4 else 0)

    def trans(a, b):
        return -0.3 if a == b else 0.0

    nb, nc = len(bar_w), len(vocab)
    score = np.array([fit(bar_w[0], ch) for ch in vocab])
    back = np.zeros((nb, nc), int)
    for b in range(1, nb):
        new = np.empty(nc)
        for j in range(nc):
            cand = score + np.array([trans(i, j) for i in range(nc)])
            back[b, j] = int(np.argmax(cand))
            new[j] = cand.max() + fit(bar_w[b], vocab[j])
        score = new
    path = [int(np.argmax(score))]
    for b in range(nb - 1, 0, -1):
        path.append(back[b, path[-1]])
    return list(reversed(path))


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


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    cache = load_clips()
    for key, c in cache.items():
        c["pos"] = place(c, lmax=7) if key == K(M.YARI) else place(c)

    # 調（移調前）→ 台詞ごとの移調 → 調を確かめ直す
    def hist(shift=True):
        h = np.zeros(12)
        for c in cache.values():
            t = c.get("tr", 0) if shift else 0
            w = np.diff(np.append(c["pos"], c["pos"][-1] + 2))
            for mi, ww in zip(c["midi"], w):
                if np.isfinite(mi):
                    h[int(round(mi + t)) % 12] += ww
        return h

    root, mode = choose_key(hist(False))
    sc = scale_set(root, mode)
    for c in cache.values():
        w = np.diff(np.append(c["pos"], c["pos"][-1] + 2)).astype(float)
        c["tr"] = best_transpose(c["midi"], w, sc)
    root, mode = choose_key(hist(True))
    sc = scale_set(root, mode)

    # 並べる: 台詞は半小節の頭から（前の台詞の終わり +1 以降）。区間は小節頭から
    placed, secs, cur = [], [], 0
    for label, items in SECTIONS:
        start = math.ceil(cur / BAR) * BAR
        cur = start
        for key, rep in items:
            c = cache[key]
            ln = int(c["pos"][-1]) + max(2, 4 - int(c["pos"][-1]) % 4)
            if key == K(M.YARI):
                ln = HALF - 1  # 半小節ごとに置き続ける
            for _ in range(rep):
                cur = math.ceil(cur / HALF) * HALF
                placed.append({"key": key, "at": cur, "sec": label})
                cur += ln + 1
        n = max(1, math.ceil((cur - start) / BAR))
        if label == "end":
            n += 2
        secs.append({"label": label, "bar0": start // BAR, "bars": n})
        cur = start + n * BAR
    bars = secs[-1]["bar0"] + secs[-1]["bars"]

    # 和音（移調後の声の音名から小節ごと）
    vocab, scale = chord_vocab(root, mode)
    bar_w = np.zeros((bars, 12))
    notes = []
    for p in placed:
        c = cache[p["key"]]
        pos = c["pos"]
        for i, mi in enumerate(c["midi"]):
            if not np.isfinite(mi):
                continue
            a = p["at"] + int(pos[i])
            w = (pos[i + 1] - pos[i]) if i + 1 < len(pos) else 2
            bar_w[a // BAR, int(round(mi + c["tr"])) % 12] += w
            notes.append((a, int(w), float(mi + c["tr"]), float(c["strength"][i]), p["key"][2] if isinstance(p["key"][2], str) else "pieces"))
    prog = harmonize(bar_w, vocab, set(scale))

    # 声
    N = int((bars * BAR * SIX + 3) * FS)
    voice = np.zeros(N)
    rendered = {}
    for p in placed:
        c = cache[p["key"]]
        if p["key"] not in rendered:
            rendered[p["key"]] = render_voice(c["path"], c["on"], c["pos"] * SIX, 2 ** (c["tr"] / 12), c["snd"][-1]["end"])
        x, d0 = rendered[p["key"]]
        add(voice, x, p["at"] * SIX + d0)
    voice /= np.abs(voice).max() + 1e-9

    # 伴奏: 4つ打ち（拍を立てる）、2・4拍にクラップ寄りのスネア、裏の開きハット、和音は保つ
    acc = {k: np.zeros(N) for k in ("kick", "snare", "hat", "crash", "bass", "ep")}
    Kk = kick()
    Kk = hp(Kk, 60) * expenv(len(Kk), 0.0005, 0.08)
    S, CH, OH, CR = snare(), chat(), ohat(), crash()
    sec_of = {b: s["label"] for s in secs for b in range(s["bar0"], s["bar0"] + s["bars"])}
    for b in range(bars):
        lab = sec_of[b]
        ch = vocab[prog[b]]
        t0 = b * BAR * SIX
        if b > 0 and sec_of.get(b - 1) != lab and lab in ("hook", "hook2", "A", "B"):
            add(acc["crash"], CR, t0)
        n = int(BAR * SIX * FS)
        for pc in sorted(ch[1]):
            m = 55 + (pc - 55) % 12
            add(acc["ep"], epiano(librosa.midi_to_hz(m), n), t0)
        bm = 36 + (ch[0] - 36) % 12
        if lab == "intro" or (lab == "end" and b > secs[-1]["bar0"]):
            add(acc["bass"], sub(librosa.midi_to_hz(bm), n), t0)
            continue
        for st in range(BAR):
            at = t0 + st * SIX
            if lab != "break" and st % 4 == 0:
                add(acc["kick"], Kk, at)
            if lab != "break" and st in (4, 12):
                add(acc["snare"], 0.8 * S, at)
            if lab in ("hook", "hook2"):
                add(acc["hat"], (0.45 * OH if st % 4 == 2 else 0.15 * CH), at)
            elif lab in ("A", "B") and st % 4 == 2:
                add(acc["hat"], 0.3 * CH, at)
            if st % 2 == 0 and lab != "break":
                nn = int(SIX * 1.7 * FS)
                add(acc["bass"], sub(librosa.midi_to_hz(bm + (12 if st % 4 == 2 and lab.startswith("hook") else 0)), nn), at)
        if lab == "break":
            add(acc["bass"], sub(librosa.midi_to_hz(bm), n), t0)

    def nrm(x):
        return x / (np.abs(x).max() + 1e-9)

    accomp = (0.55 * nrm(acc["kick"]) + 0.3 * nrm(acc["snare"]) + 0.12 * nrm(acc["hat"]) + 0.1 * nrm(acc["crash"])
              + 0.3 * nrm(lp(acc["bass"], 600)) + 0.32 * nrm(lp(acc["ep"], 3000)))
    n = int(1.2 * FS)
    ir = RNG.standard_normal(n) * np.exp(-np.arange(n) / FS / 0.25)
    send = lp(hp(0.25 * nrm(acc["ep"]) + 0.15 * nrm(acc["snare"]) + 0.06 * voice, 250), 6000)
    wet = fftconvolve(send, ir)[:N]
    wet = 0.1 * wet / (np.abs(wet).max() + 1e-9)
    mix = voice + accomp + wet
    mix = np.tanh(1.2 * mix / np.abs(mix).max()) / np.tanh(1.2)
    sf.write(outdir / "song.wav", (0.92 * mix / np.abs(mix).max()).astype(np.float32), FS)
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)

    # 記録（測定用）
    clips = []
    for key, c in cache.items():
        pos, on = c["pos"], c["on"]
        span_src = on[-1] - on[0]
        span_dst = (pos[-1] - pos[0]) * SIX
        loc = [((pos[i + 1] - pos[i]) * SIX) / max(0.03, on[i + 1] - on[i]) for i in range(len(on) - 1)]
        strong = c["strength"] >= np.percentile(c["strength"], 75) if len(on) > 1 else np.array([True])
        clips.append({
            "text": c["text"], "morae": len(on), "transpose": c["tr"],
            "stretchTotal": round(span_dst / span_src, 2) if span_src > 0 else None,
            "stretchLocal": [round(float(x), 2) for x in loc],
            "posInBeat": [int(p % 4) for p in pos],
            "strongOnBeat": f"{int(np.sum((pos % 4 == 0) & strong))}/{int(strong.sum())}",
        })
    info = {
        "bpm": BPM, "key": f"{NAMES[root]} {mode}", "bars": bars, "seconds": round(bars * BAR * SIX, 1),
        "sections": [f"{s['label']}@{s['bar0'] + 1}x{s['bars']}" for s in secs],
        "progression": " ".join(f"{NAMES[vocab[k][0]]}({vocab[k][2]})" for k in prog),
        "clips": clips,
    }
    (outdir / "song.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "notes.npy", np.array([n[:4] for n in notes]))
    print("ok", info["key"], bars, info["seconds"])


if __name__ == "__main__":
    main()
