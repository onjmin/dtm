"""淫夢 台詞イントネーション作曲 v2（method.md の作り方、notes-inmu2.md の狙い）。使い捨て。

python -I inmu_v2.py <outdir>
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
from compose_quotes3 import add, chat, crash, expenv, hp, kick, lp, ohat, snare, supersaw  # noqa: E402
from setting import clip_data  # noqa: E402

FS = 44100
FRAME_MS = 5.0
RNG = np.random.default_rng(11)

YARI = M.YARI[:4]
SECTIONS = [
    ("intro", [(M.OSS[:4], 1)]),
    ("A", [(M.NUA[:4], 1), (M.OKUJO[:4], 1), (M.AGE[:4], 1), (M.GAKU[:4], 1)]),
    ("hook", [(YARI, 4), (M.JAKEN[:4], 1)]),
    ("B", [(M.OKANO[:4], 1), (M.FA[:4], 2), (M.SOUDAYO[:4], 2), (M.MITOKE[:4], 1), (M.AKUSHIRO[:4], 1)]),
    ("hook", [(YARI, 4), (M.JAKEN[:4], 1)]),
    ("break", [(M.NUA[:4], 1), (M.SUKI[:4], 1)]),
    ("hook2", [(YARI, 6), (M.JAKEN[:4], 1), (YARI, 2)]),
    ("end", [(M.SUKI[:4], 1)]),
]


# ── 素材 ─────────────────────────────────────────

def load_clips():
    cache = {}
    for _, items in SECTIONS:
        for key, _rep in items:
            if key not in cache:
                c = clip_data(key[0], key[2], key[3])
                ms = [m for m in c["morae"] if m["vowel"] != "cl"]
                c["on"] = np.array([m["vstart"] for m in ms])
                c["midi"] = np.array([c["medMidi"] + m["st"] if m["st"] is not None else np.nan for m in ms])
                c["sounding"] = ms
                c["anchors"] = word_anchors(c)
                cache[key] = c
    return cache


def word_anchors(c):
    """16分へ揃える点: 語の頭のモーラと、最後のモーラ（声のあるモーラの番号）。"""
    import pyopenjtalk
    starts, i = set(), 0
    for nd in pyopenjtalk.run_frontend(c["text"]):
        k = nd["mora_size"]
        if k > 0:
            starts.add(i)
            i += k
    snd, out = 0, set()
    for j, m in enumerate(c["morae"]):
        if m["vowel"] == "cl":
            if j in starts:
                starts.add(j + 1)  # 「っ」で始まる語は次のモーラを頭に
            continue
        if j in starts:
            out.add(snd)
        snd += 1
    out |= {0, snd - 1}
    return sorted(out)


def quantize(on, six, anchors):
    """母音頭（秒）→ 16分単位の位置（台詞頭=0）。語の頭だけ整数へ揃え、語の中は元の時刻比で補間する。"""
    rel = on - on[0]
    pos, prev = {}, -1
    for a in anchors:
        k = max(prev + 1, int(round(rel[a] / six)))
        pos[a] = k
        prev = k
    ax = np.array(anchors)
    return np.interp(rel, rel[ax], np.array([pos[a] for a in anchors], float))


def stretch_cost(cache, bpm):
    six = 15 / bpm
    logs = []
    for c in cache.values():
        if len(c["on"]) < 2:
            continue
        g = quantize(c["on"], six, c["anchors"])
        ioi_src = np.diff(c["on"])
        ioi_dst = np.diff(g) * six
        ok = ioi_src > 0.02
        logs += list(np.abs(np.log(ioi_dst[ok] / ioi_src[ok])))
    return float(np.mean(logs)), float(np.percentile(logs, 90))


# ── 調と和音 ───────────────────────────────────────

KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


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


def harmonize(bar_w, vocab, scale):
    """小節ごとの声の音名の重み → 和音列（DP）。ベースの下降を優先する。"""
    def fit(w, ch):
        s = 0.0
        for pc in range(12):
            if w[pc] == 0:
                continue
            if pc in ch[1]:
                s += w[pc]
            elif any((pc - t) % 12 == 1 for t in ch[1]):
                s -= 0.7 * w[pc]
            elif pc in scale:
                s += 0.2 * w[pc]
        return s + (-0.05 if len(ch[1]) == 4 else 0)

    def trans(a, b):
        d = (vocab[b][0] - vocab[a][0]) % 12
        if d in (11, 10):  # 半音・全音で下がる（狙いの軸）
            return 2.5
        if a == b:
            return -0.3
        if vocab[a][0] == vocab[b][0]:
            return 0.1
        if d in (1, 2):  # 半音・全音で上がる
            return -1.0
        return 0.0

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


# ── 声: 時間だけ動かし f0 は原音のまま ─────────────────

def render_voice(path, morae_on, grid_t, lead_pre=0.15):
    y, _ = librosa.load(str(path), sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=FRAME_MS)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 1000 / FRAME_MS
    # 対応点: 最初の子音の手前〜各母音頭〜最後の母音の終わり（等倍）
    src = [max(0.0, morae_on[0] - lead_pre)] + list(morae_on)
    dst = [grid_t[0] - (morae_on[0] - src[0])] + list(grid_t)
    tail = min(0.5, len(y) / FS - morae_on[-1])
    src.append(morae_on[-1] + tail)
    dst.append(grid_t[-1] + tail)
    d0 = dst[0]
    nf = int((dst[-1] - d0) * fps) + 1
    tt = d0 + np.arange(nf) / fps
    ts = np.interp(tt, dst, src)
    j = np.clip((ts * fps).astype(int), 0, len(f0) - 1)
    out = pyworld.synthesize(f0[j].copy(), sp[j].copy(), ap[j].copy(), FS, FRAME_MS)
    fade = int(0.01 * FS)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade * 3:] *= np.linspace(1, 0, fade * 3)
    return out, d0


# ── 音色 ─────────────────────────────────────────

def epiano(hz, n):
    t = np.arange(n) / FS
    mod = 1.2 * np.exp(-t / 0.4) * np.sin(2 * np.pi * hz * 2 * t)
    x = np.sin(2 * np.pi * hz * t + mod) * expenv(n, 0.003, 1.2)
    return x


def sub(hz, n):
    t = np.arange(n) / FS
    return (np.sin(2 * np.pi * hz * t) + 0.25 * np.sin(4 * np.pi * hz * t)) * np.minimum(1, t / 0.005) * np.minimum(1, (n / FS - t) / 0.02)


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    cache = load_clips()

    # テンポ: 伸縮が最小になる値
    # テンポ: 作例どおり 16分≒1モーラ（モーラ間隔の中央値）
    ioi = np.concatenate([np.diff(c["on"]) for c in cache.values() if len(c["on"]) > 1])
    bpm = int(round(np.clip(15 / np.median(ioi[ioi > 0.02]), 110, 150)))
    costs = {bpm: stretch_cost(cache, bpm)}
    six = 15 / bpm
    BAR = 16

    # 配置: 台詞は16分の上で詰めて並べる（拍頭に寄せない）。区間の頭だけ小節頭
    placed, secs, cur = [], [], 0
    for label, items in SECTIONS:
        start = math.ceil(cur / BAR) * BAR
        cur = start
        for key, rep in items:
            c = cache[key]
            g = quantize(c["on"], six, c["anchors"])
            tail16 = max(2, int(round(min(0.5, (c["sounding"][-1]["end"] - c["on"][-1])) / six)))
            ln = int(g[-1]) + tail16
            for _ in range(rep):
                placed.append({"key": key, "at": cur, "g": g, "sec": label})
                cur += ln + 1  # 次の台詞まで16分1個の間
        n = max(1, math.ceil((cur - start) / BAR))
        if label == "end":
            n += 2
        secs.append({"label": label, "bar0": start // BAR, "bars": n})
        cur = start + n * BAR
    bars = secs[-1]["bar0"] + secs[-1]["bars"]

    # 声の音名（原音の音高）を小節ごとに重み付け
    bar_w = np.zeros((bars, 12))
    hist = np.zeros(12)
    notes = []
    for p in placed:
        c = cache[p["key"]]
        for i, (gi, mi) in enumerate(zip(p["g"], c["midi"])):
            if np.isnan(mi):
                continue
            pos = p["at"] + gi
            nxt = p["at"] + (p["g"][i + 1] if i + 1 < len(p["g"]) else gi + 2)
            w = nxt - pos
            pc = int(round(mi)) % 12
            bar_w[int(pos) // BAR, pc] += w
            hist[pc] += w
            notes.append((pos, w, mi))
    root, mode = choose_key(hist)
    vocab, scale = chord_vocab(root, mode)
    prog = harmonize(bar_w, vocab, scale)

    # ── 書き出し ──
    total = bars * BAR * six + 3
    N = int(total * FS)
    voice = np.zeros(N)
    stretch = []
    rendered = {}
    for p in placed:
        c = cache[p["key"]]
        grid_t = (p["at"] + p["g"]) * six
        k = (p["key"], tuple(p["g"]))
        if k not in rendered:
            rendered[k] = render_voice(c["path"], c["on"], p["g"] * six)
        x, d0 = rendered[k]
        add(voice, x, p["at"] * six + d0)
        src_ioi = np.diff(c["on"])
        dst_ioi = np.diff(grid_t)
        ok = src_ioi > 0.02
        stretch += list(dst_ioi[ok] / src_ioi[ok])
    voice /= np.abs(voice).max() + 1e-9

    acc = {k: np.zeros(N) for k in ("kick", "snare", "hat", "crash", "bass", "ep")}
    # キックは音程感を弱める（低域の尾を短く、アタック寄り）
    K = kick()
    K = hp(K, 70) * expenv(len(K), 0.0005, 0.06)
    S, CH, OH, CR = snare(), chat(), ohat(), crash()
    sec_of = {}
    for s in secs:
        for b in range(s["bar0"], s["bar0"] + s["bars"]):
            sec_of[b] = s["label"]
    last_prog_root = None
    for b in range(bars):
        lab = sec_of[b]
        ch = vocab[prog[b]]
        t0 = b * BAR * six
        rootpc = ch[0]
        # ベース: 前の小節より下の音域を選んで降りる
        bmidi = 36 + (rootpc - 0) % 12
        if last_prog_root is not None and bmidi > last_prog_root + 2:
            bmidi -= 12
        if bmidi < 31:
            bmidi += 12
        last_prog_root = bmidi
        end_sec = lab == "end" and b > secs[-1]["bar0"]
        if b == 0 or (lab in ("hook", "hook2") and sec_of.get(b - 1) != lab):
            add(acc["crash"], CR, t0)
        # 電気ピアノ: 小節頭で和音を保つ（台詞を1音ずつ追わない）
        n = int(BAR * six * FS)
        tones = sorted(ch[1])
        for pc in tones:
            m = 60 + (pc - 60) % 12
            if m > 67:
                m -= 12
            add(acc["ep"], epiano(librosa.midi_to_hz(m), n), t0)
        if lab in ("intro",) or end_sec:
            add(acc["bass"], sub(librosa.midi_to_hz(bmidi), n), t0)
            continue
        # ハーフタイム: キック1拍目と3拍目の裏、スネア3拍目
        for st in range(BAR):
            at = t0 + st * six
            if lab != "break" and st in (0, 10):
                add(acc["kick"], K, at)
            if lab != "break" and st == 8:
                add(acc["snare"], 0.9 * S, at)
            if lab in ("hook", "hook2", "B"):
                add(acc["hat"], (0.4 if st % 4 == 2 else 0.18) * (OH if st % 8 == 6 and lab != "B" else CH), at)
            elif lab == "A" and st % 2 == 0:
                add(acc["hat"], 0.18 * CH, at)
        # ベース: 根音を8分で、各小節の最後の8分で次の根音へ半音で寄る
        for st in range(0, BAR, 2):
            nn = int(six * 1.8 * FS)
            m = bmidi
            add(acc["bass"], sub(librosa.midi_to_hz(m), nn) * (1.0 if st % 4 == 0 else 0.7), t0 + st * six)

    def nrm(x):
        return x / (np.abs(x).max() + 1e-9)

    accomp =(0.6 * nrm(acc["kick"]) + 0.3 * nrm(acc["snare"]) + 0.12 * nrm(acc["hat"]) + 0.12 * nrm(acc["crash"])
              + 0.32 * nrm(lp(acc["bass"], 600)) + 0.36 * nrm(lp(acc["ep"], 3000)))
    # 残響（電気ピアノとスネア、声に少し）
    n = int(1.4 * FS)
    ir = RNG.standard_normal(n) * np.exp(-np.arange(n) / FS / 0.3)
    send = lp(hp(0.25 * nrm(acc["ep"]) + 0.2 * nrm(acc["snare"]) + 0.08 * voice, 250), 6000)
    wet = fftconvolve(send, ir)[:N]
    wet = 0.12 * wet / (np.abs(wet).max() + 1e-9)
    mix = 1.0 * voice + accomp + wet
    mix = np.tanh(1.2 * mix / np.abs(mix).max()) / np.tanh(1.2)
    sf.write(outdir / "song.wav", (0.92 * mix / np.abs(mix).max()).astype(np.float32), FS)
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)
    sf.write(outdir / "accomp.wav", (0.9 * nrm(accomp + wet)).astype(np.float32), FS)

    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    info = {
        "bpm": bpm,
        "stretchCost(mean|log|, p90)": [round(v, 3) for v in costs[bpm]],
        "stretchRatio p10/p50/p90": [round(float(np.percentile(stretch, q)), 3) for q in (10, 50, 90)],
        "key": f"{names[root]} {mode}",
        "bars": bars,
        "seconds": round(bars * BAR * six, 1),
        "sections": [f"{s['label']}@{s['bar0'] + 1}x{s['bars']}" for s in secs],
        "progression": " ".join(f"{names[vocab[k][0]]}({vocab[k][2]})" for k in prog),
        "beatSec": 60 / bpm,
    }
    (outdir / "song.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "notes.npy", np.array(notes))
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
