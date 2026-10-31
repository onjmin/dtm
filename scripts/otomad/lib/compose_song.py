"""台詞を16分×音階へ固定して歌わせ、2コードの伴奏を付ける試作（使い捨て）。

python -I compose_song.py <aligned.json> <outdir>
"""
import json
import sys
from pathlib import Path

import librosa  # noqa: E402
import mido  # noqa: E402
import numpy as np  # noqa: E402
import pyworld  # noqa: E402
import soundfile as sf  # noqa: E402

FS = 44100
BPM = 150
SIX = 15 / BPM  # 16分の秒
BAR = 16
MAJOR = np.array([0, 2, 4, 5, 7, 9, 11])
HOOK = "11 "  # みなさん盛り上がっていきましょお
FRAME_MS = 5.0
LEAD = 0.25


def hz2midi(hz):
    return 69 + 12 * np.log2(hz / 440)


def midi2hz(m):
    return 440 * 2 ** ((m - 69) / 12)


# ── 台詞 → 16分の音符列 ──────────────────────────────

def to_notes(clip, scale=None):
    """モーラ → 16分の音符列。pos は母音の頭（子音はその手前に出す）。

    scale を渡すと元のリズムを保つ: 母音の頭の時刻を一律 scale 倍してから16分へ丸める
    （長さを1つずつ丸めないので、繰り返しの句がずれない）。
    """
    base = hz2midi(clip["medHz"])
    out, pos, prev = [], 0, None
    morae = clip["morae"]
    vs = [m.get("vstart", m["start"]) for m in morae]
    for i, m in enumerate(morae):
        last = i == len(morae) - 1
        if scale:
            pos = max(pos, int(round((vs[i] - vs[0]) * scale / SIX)))
            tail = max(1, int(round((m["end"] - vs[i]) * scale / SIX)))
            if last:
                n = min(8, tail)
            else:
                nxt = max(pos + 1, int(round((vs[i + 1] - vs[0]) * scale / SIX)))
                n = nxt - pos
        else:
            ioi = (vs[i + 1] - vs[i]) if not last else (m["end"] - vs[i])
            gap = 0.0 if last else morae[i + 1]["start"] - m["end"]
            rest = int(min(4, round(gap / SIX))) if gap > 0.15 else 0  # 息継ぎ・読点は休符として残す
            dur = ioi - (gap if rest else 0)
            n = int(np.clip(round(dur / SIX), 1, 4 if len(morae) > 1 else 16))
        if m["vowel"] == "cl":
            pitch = None
        elif m.get("st") is not None:
            pitch = base + m["st"]
        else:
            pitch = prev  # 無声化など: 前の音のまま
        out.append({"pos": pos, "len": n, "pitch": pitch, "mora": m["mora"],
                    "src": (m["start"], vs[i], m["end"])})
        if pitch is not None:
            prev = pitch
        pos += n + (0 if scale else rest)
    return out


def snap(m, root):
    rel = m - root
    o = np.floor(rel / 12)
    c = np.array([o * 12 + s + k * 12 for k in (-1, 0, 1) for s in MAJOR])
    return root + c[np.abs(c - rel).argmin()]


def choose_key(all_pitches):
    best = None
    for root in np.arange(48, 60):
        err = sum(abs(snap(p, root) - p) for p in all_pitches)
        if best is None or err < best[0]:
            best = (err, root)
    return int(best[1])


# 2コードの候補（長調の度数、ルートからの半音）
LOOPS = {
    "I-IV": [[0, 4, 7], [5, 9, 12]],
    "vi-IV": [[9, 12, 16], [5, 9, 12]],
    "I-bVII": [[0, 4, 7], [10, 14, 17]],
    "IV-V": [[5, 9, 12], [7, 11, 14]],
    "vi-V": [[9, 12, 16], [7, 11, 14]],
    "I-V": [[0, 4, 7], [7, 11, 14]],
}


def choose_loop(timeline, root):
    """旋律の音価のうち、その小節の和音構成音に乗る割合が最大の組。"""
    best = None
    for name, chords in LOOPS.items():
        hit = tot = 0
        for n in timeline:
            if n["pitch"] is None:
                continue
            ch = chords[(n["pos"] // BAR) % 2]
            pc = (round(n["pitch"]) - root) % 12
            hit += n["len"] * (pc in {c % 12 for c in ch})
            tot += n["len"]
        if best is None or hit / tot > best[0]:
            best = (hit / tot, name)
    return best[1], best[0]


# ── WORLD で台詞を置き直す ──────────────────────────

def render_clip(path, notes, root):
    y, _ = librosa.load(path, sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=700, frame_period=FRAME_MS)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 1000 / FRAME_MS
    # 出力の 0 は LEAD 秒前（最初の子音を拍の手前に出す余白）
    total = LEAD + (notes[-1]["pos"] + notes[-1]["len"]) * SIX
    nf = int(total * fps) + 1
    of0 = np.zeros(nf)
    osp = np.tile(sp.min(0), (nf, 1)) * 1e-6  # 休符はほぼ無音
    oap = np.ones((nf, sp.shape[1]))
    keep = 0.03  # 母音の頭は等倍で残す秒数
    for n in notes:
        o0, o1 = LEAD + n["pos"] * SIX, LEAD + (n["pos"] + n["len"]) * SIX
        s0, sv, s1 = n["src"]
        pre = min(LEAD, max(0.0, sv - s0))
        s1 = max(s1, sv + 0.02)
        for k in range(max(0, int((o0 - pre) * fps)), min(nf, int(o1 * fps))):
            to = k / fps - o0
            if to < 0:
                ts = sv + to  # 子音は等倍で拍の手前に
            elif to < keep and sv + to < s1:
                ts = sv + to
            else:
                rest_o = max(1e-3, (o1 - o0) - keep)
                ts = min(s1, sv + keep + (to - keep) / rest_o * max(0, (s1 - sv) - keep))
            j = min(len(f0) - 1, max(0, int(ts * fps)))
            osp[k] = sp[j]
            oap[k] = ap[j]
            if f0[j] > 0 and n["pitch"] is not None:
                of0[k] = midi2hz(snap(n["pitch"], root))
    # 音の継ぎ目だけ 25ms のポルタメント
    v = of0 > 0
    sm = of0.copy()
    for k in range(1, nf):
        if v[k] and v[k - 1] and of0[k] != of0[k - 1]:
            a, b = of0[k - 1], of0[k]
            for d in range(5):
                if k + d < nf and v[k + d]:
                    sm[k + d] = a * (b / a) ** ((d + 1) / 5)
    return pyworld.synthesize(sm, osp, oap, FS, FRAME_MS)


# ── 伴奏 ─────────────────────────────────────────

def env(n, a=0.002, r=0.05):
    t = np.arange(n) / FS
    return np.minimum(1, t / a) * np.exp(-t / r)


def kick():
    n = int(0.25 * FS)
    t = np.arange(n) / FS
    ph = 2 * np.pi * np.cumsum(45 + 110 * np.exp(-t / 0.03)) / FS
    return np.sin(ph) * env(n, 0.001, 0.12)


def snare():
    n = int(0.2 * FS)
    rng = np.random.default_rng(0)
    t = np.arange(n) / FS
    return (0.6 * rng.standard_normal(n) * env(n, 0.001, 0.05) + 0.4 * np.sin(2 * np.pi * 190 * t) * env(n, 0.001, 0.04))


def hat():
    n = int(0.05 * FS)
    rng = np.random.default_rng(1)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0)
    return x * env(n, 0.0005, 0.012) * 0.5


def saw(hz, n, detune=0.0):
    t = np.arange(n) / FS
    out = 0
    for d in (-detune, 0, detune) if detune else (0,):
        out = out + 2 * ((t * hz * (1 + d)) % 1) - 1
    return out / (3 if detune else 1)


def square(hz, n):
    t = np.arange(n) / FS
    return np.sign(np.sin(2 * np.pi * hz * t))


def lowpass(x, a):
    y = np.zeros_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def add(buf, x, at):
    i = int(at * FS)
    if i >= len(buf):
        return
    x = x[: len(buf) - i]
    buf[i : i + len(x)] += x


def main():
    clips = json.load(open(sys.argv[1], encoding="utf-8"))
    outdir = Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)

    def usable(c):
        ms = c["morae"]
        if not (8 <= len(ms) <= 28):
            return False
        if np.mean([m["score"] for m in ms]) < 0.4:
            return False
        sts = [m["st"] for m in ms if m.get("st") is not None]
        return len(sts) >= 0.7 * len(ms) and np.ptp(sts) >= 5

    pool = [c for c in clips if usable(c)]
    for c in pool:
        c["notes"] = to_notes(c)
    pool = [c for c in pool if c["notes"][-1]["pos"] + c["notes"][-1]["len"] <= 2 * BAR - 2]
    hook = next(c for c in clips if Path(c["path"]).name.startswith(HOOK))
    hook["notes"] = to_notes(hook)
    rng = np.random.default_rng(7)
    verses = [pool[i] for i in rng.choice(len(pool), size=min(6, len(pool)), replace=False)]

    # 構成: 前奏2 → フック → 台詞4 → フック → 台詞2 → フック×2 → 後奏2（各2小節）
    plan = [None, hook, *verses[:4], hook, *verses[4:6], hook, hook, None]
    timeline = []
    for slot, c in enumerate(plan):
        if c is None:
            continue
        for n in c["notes"]:
            timeline.append({**n, "pos": n["pos"] + slot * 2 * BAR})

    root = choose_key([n["pitch"] for n in timeline if n["pitch"] is not None])
    loop, fit = choose_loop(timeline, root)
    chords = LOOPS[loop]
    bars = len(plan) * 2
    total = bars * BAR * SIX + 2
    voice = np.zeros(int(total * FS))
    for slot, c in enumerate(plan):
        if c is None:
            continue
        add(voice, render_clip(c["path"], c["notes"], root), slot * 2 * BAR * SIX)
    voice /= np.abs(voice).max() + 1e-9

    drums = np.zeros_like(voice)
    bass = np.zeros_like(voice)
    pad = np.zeros_like(voice)
    lead = np.zeros_like(voice)
    K, S, H = kick(), snare(), hat()
    duck = np.ones_like(voice)
    for b in range(bars):
        last = b == bars - 1
        ch = chords[b % 2]
        for s in range(BAR):
            at = (b * BAR + s) * SIX
            if s % 4 == 0:
                add(drums, K, at)
                d = int(at * FS)
                duck[d : d + int(0.12 * FS)] = np.minimum(duck[d : d + int(0.12 * FS)], np.linspace(0.3, 1, int(0.12 * FS))[: len(duck[d : d + int(0.12 * FS)])])
            if s in (4, 12) and b >= 2:
                add(drums, 0.7 * S, at)
            if not last:
                add(drums, (0.35 if s % 2 else 0.2) * H, at)
            if s % 2 == 0:
                n = int(SIX * 2 * FS * 0.9)
                hz = midi2hz(root - 12 + ch[0] % 12)
                add(bass, lowpass(saw(hz, n), 0.08) * env(n, 0.003, 0.2), at)
        n = int(BAR * SIX * FS)
        for c in ch:
            add(pad, saw(midi2hz(root + c), n, 0.004) * np.minimum(1, np.arange(n) / (0.05 * FS)), b * BAR * SIX)
    pad = lowpass(pad, 0.05) * duck
    for n in timeline:
        if n["pitch"] is None:
            continue
        ln = int(n["len"] * SIX * FS * 0.95)
        add(lead, square(midi2hz(snap(n["pitch"], root) + 12), ln) * env(ln, 0.003, 0.3), n["pos"] * SIX)
    lead = lowpass(lead, 0.15)

    def nrm(x):
        return x / (np.abs(x).max() + 1e-9)

    mix = 0.85 * voice + 0.55 * nrm(drums) + 0.4 * nrm(bass) + 0.18 * nrm(pad) + 0.12 * nrm(lead)
    mix = np.tanh(1.2 * mix) / np.tanh(1.2)
    sf.write(outdir / "song.wav", (0.9 * nrm(mix)).astype(np.float32), FS)
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)

    # MIDI（dtm で開いて編集する用。声の代わりに旋律＋歌詞）
    mf = mido.MidiFile(ticks_per_beat=480)
    tpq = 480 // 4

    def track(name, ch, events):
        tr = mido.MidiTrack()
        tr.append(mido.MetaMessage("track_name", name=name, time=0))
        if ch == 0:
            tr.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(BPM), time=0))
        now = 0
        for t, kind, a, b in sorted(events, key=lambda e: (e[0], e[1] == "on")):
            dt = t - now
            now = t
            if kind == "lyric":
                tr.append(mido.MetaMessage("lyrics", text=a, time=dt))
            elif kind == "on":
                tr.append(mido.Message("note_on", channel=ch, note=a, velocity=b, time=dt))
            else:
                tr.append(mido.Message("note_off", channel=ch, note=a, velocity=0, time=dt))
        mf.tracks.append(tr)

    ev = []
    for n in timeline:
        if n["pitch"] is None:
            continue
        p = int(snap(n["pitch"], root))
        t0 = n["pos"] * tpq
        ev += [(t0, "lyric", n["mora"], 0), (t0, "on", p, 100), (t0 + n["len"] * tpq, "off", p, 0)]
    track("Speech melody", 0, ev)
    ev = []
    for b in range(bars):
        for c in chords[b % 2]:
            ev += [(b * BAR * tpq, "on", root + c, 70), ((b + 1) * BAR * tpq, "off", root + c, 0)]
    track("Chords", 1, ev)
    ev = []
    for b in range(bars):
        for s in range(0, BAR, 2):
            p = root - 12 + chords[b % 2][0] % 12
            t0 = (b * BAR + s) * tpq
            ev += [(t0, "on", p, 90), (t0 + 2 * tpq - 10, "off", p, 0)]
    track("Bass", 2, ev)
    ev = []
    for b in range(bars):
        for s in range(BAR):
            t0 = (b * BAR + s) * tpq
            if s % 4 == 0:
                ev += [(t0, "on", 36, 110), (t0 + tpq, "off", 36, 0)]
            if s in (4, 12) and b >= 2:
                ev += [(t0, "on", 38, 100), (t0 + tpq, "off", 38, 0)]
            ev += [(t0, "on", 42, 80 if s % 2 else 60), (t0 + tpq // 2, "off", 42, 0)]
    track("Drums", 9, ev)
    mf.save(outdir / "song.mid")

    info = {
        "key": librosa.midi_to_note(root, unicode=False) + " major",
        "loop": loop,
        "chordToneFit": round(fit, 3),
        "bars": bars,
        "plan": [None if c is None else Path(c["path"]).stem for c in plan],
        "pool": len(pool),
    }
    (outdir / "song.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
