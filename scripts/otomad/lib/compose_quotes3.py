"""エア本語録 試作3: 声は試作2のまま、和音付け・展開・音色を作り直す（使い捨て）。

python -I compose_quotes3.py <outdir>
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy.signal import fftconvolve, lfilter  # noqa: E402

from align import align, morae_from_text  # noqa: E402
from align_batch import pitch_morae  # noqa: E402
from compose_quotes import CH, S2, find  # noqa: E402
from compose_song import BAR, FS, LEAD, SIX, choose_key, midi2hz, render_clip, snap, to_notes  # noqa: E402

SHABA = (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ", None, 1)
FOO = (S2, 4, "ふー", None, 1)
SECTIONS = [
    ("intro", [(S2, 1, "んーーーー", None, 1), (S2, 2, "ワンツーワンツースリー", None, 1)]),
    ("A", [
        (S2, 44, "もしもしっ！って言って", "もしもしっ", 2),
        (S2, 46, "あたしねぇって信心したのよ！って言われたんです", "あたしねぇって信心したのよ", 1),
        (S2, 48, "もう受話器持ってイエエエエ！みたいな", "もう受話器持ってイエエエエ", 1),
        (S2, 56, "もうダブルオドロキですよね", "もうダブルオドロキ", 2),
        (S2, 58, "あのっ！？っていうくらい", "あのっ", 2),
    ]),
    ("hook", [SHABA, FOO]),
    ("B", [
        (S2, 62, "この信心はねって", "この信心はね", 1),
        (S2, 63, "自分が自分らしく輝いていく仏法なんだよ！って言われたんです", "自分が自分らしく輝いていく仏法なんだよ", 1),
        (S2, 65, "グサッってきましてね", "グサッ", 2),
        (S2, 84, "絶対なれる！っていうに仰っていただいて", "絶対なれる", 2),
        (S2, 26, "やったるムンムンカマしたらぁー！みたいな気持ちで来たんですけどもね", "やったるムンムンカマしたらぁー", 1),
    ]),
    ("hook", [SHABA, FOO]),
    ("break", [
        (S2, 128, "ルネッサンスおめでとー！っていうことであの", "ルネッサンスおめでとー", 1),
        (S2, 132, "面白かったねー！って", "面白かったねー", 2),
        (S2, 5, "はぁい、私エアリスジェラルドハニー", None, 1),
        (CH, 229, "マハーロー、マハーロー", None, 1),
        (CH, 218, "みんな、高等精神病です今", None, 1),
    ]),
    ("build", []),
    ("hook2", [SHABA, FOO, SHABA, FOO]),
    ("end", [(S2, 135, "パーン！ってなりましたね頭が", None, 1)]),
]


# ── 声の配置（試作2と同じ）──────────────────────────

def load_clip(cache, folder, num, text, keep):
    path = find(folder, num)
    key = (str(path), text, keep)
    if key in cache:
        return cache[key]
    r = pitch_morae(str(path), align(str(path), text))
    if keep:
        r["morae"] = r["morae"][: len(morae_from_text(keep))]
    ms = r["morae"]
    if np.mean([m["score"] for m in ms]) < 0.15:
        sts = [m["st"] for m in ms if m.get("st") is not None]
        r["morae"] = [{**ms[0], "end": ms[-1]["end"], "mora": keep or text,
                       "st": float(np.median(sts)) if sts else None}]
    if num == 3 and folder == S2:
        notes = phrase_notes(r, 7)
    else:
        notes = to_notes(r)
    cache[key] = {"path": str(path), "notes": notes, "text": keep or text}
    return cache[key]


def phrase_notes(r, per):
    """リズムを持った素材（シャバダバ）: 句ごとに元の拍を保って伸縮し、各句を小節頭へ置く。

    句の周期（母音の頭どうし）を3拍＝12個の16分に合わせて一律に縮め、
    句の最後の音を小節の終わりまで伸ばす。
    """
    ms = r["morae"]
    vs = [m.get("vstart", m["start"]) for m in ms]
    heads = [vs[i] for i in range(0, len(ms), per)]
    period = float(np.median(np.diff(heads)))
    scale = 12 * SIX / period
    phrases = [to_notes({**r, "morae": ms[i0:i0 + per]}, scale=scale) for i0 in range(0, len(ms), per)]
    # 繰り返しの句は同じリズムで鳴らす: 句ごとの位置の中央値を型にする
    full = [ph for ph in phrases if len(ph) == per]
    tpl = [int(np.median([ph[i]["pos"] for ph in full])) for i in range(per)]
    out = []
    for k, ph in enumerate(phrases):
        if len(ph) == per:
            for i, n in enumerate(ph):
                n["pos"] = tpl[i]
                n["len"] = (tpl[i + 1] - tpl[i]) if i + 1 < per else BAR - tpl[i]
        else:
            ph[-1]["len"] = max(ph[-1]["len"], BAR - ph[-1]["pos"])
        out += [{**n, "pos": n["pos"] + k * BAR} for n in ph]
    return out


def layout():
    cache, entries, secs, cursor = {}, [], [], 0
    for label, items in SECTIONS:
        start = math.ceil(cursor / BAR) * BAR
        cursor = start
        for folder, num, text, keep, rep in items:
            c = load_clip(cache, folder, num, text, keep)
            ln = c["notes"][-1]["pos"] + c["notes"][-1]["len"]
            unit = math.ceil(ln / 8) * 8
            cursor = math.ceil(cursor / 8) * 8
            for i in range(rep):
                entries.append({"clip": c, "at": cursor + i * unit, "sec": label})
            cursor += unit * rep
        n = max(1, math.ceil((cursor - start) / BAR))
        if label in ("hook", "hook2", "build"):
            n = max(n, 2 if label != "build" else 1)
            n += n % 2 if label != "build" else 0
        if label == "end":
            n = 3  # パーンの後の余韻
        secs.append({"label": label, "bar0": start // BAR, "bars": n})
        cursor = start + n * BAR
    return entries, secs


# ── 和音付け（小節ごと・DP）────────────────────────

TRIADS = {"I": [0, 4, 7], "ii": [2, 5, 9], "iii": [4, 7, 11], "IV": [5, 9, 0], "V": [7, 11, 2], "vi": [9, 0, 4]}
NAMES = list(TRIADS)
OUDOU = {("IV", "V"), ("V", "iii"), ("iii", "vi"), ("vi", "IV")}
GOOD = {("V", "I"), ("V", "vi"), ("I", "IV"), ("I", "V"), ("ii", "V"), ("IV", "I"),
        ("vi", "ii"), ("I", "vi"), ("vi", "V"), ("iii", "IV"), ("IV", "ii")}


def trans(a, b):
    if (a, b) in OUDOU:
        return 3.0
    if (a, b) in GOOD:
        return 1.5
    if a == b:
        return -1.0
    return 0.0


def harmonize(timeline, root, secs, bars):
    w = np.zeros((bars, len(NAMES)))
    for n in timeline:
        if n["pitch"] is None:
            continue
        b = n["pos"] // BAR
        if b >= bars:
            continue
        pc = (round(snap(n["pitch"], root)) - root) % 12
        for k, nm in enumerate(NAMES):
            ch = {c % 12 for c in TRIADS[nm]}
            if pc in ch:
                w[b, k] += 2 * n["len"] / 4
            elif any((pc - c) % 12 in (1, 11) for c in ch):
                w[b, k] -= 1 * n["len"] / 4
    bonus = np.zeros_like(w)
    for i, s in enumerate(secs):
        last = s["bar0"] + s["bars"] - 1
        nxt = secs[i + 1]["label"] if i + 1 < len(secs) else None
        if nxt and nxt.startswith("hook"):
            bonus[last, NAMES.index("V")] += 4
        if s["label"].startswith("hook"):
            bonus[s["bar0"], NAMES.index("IV")] += 2
        if s["label"] == "end":
            bonus[s["bar0"]:, NAMES.index("I")] += 8
    w += bonus
    # Viterbi
    score = w[0].copy()
    back = np.zeros((bars, len(NAMES)), int)
    for b in range(1, bars):
        new = np.empty(len(NAMES))
        for k, nm in enumerate(NAMES):
            cand = [score[j] + trans(NAMES[j], nm) for j in range(len(NAMES))]
            back[b, k] = int(np.argmax(cand))
            new[k] = max(cand) + w[b, k]
        score = new
    path = [int(np.argmax(score))]
    for b in range(bars - 1, 0, -1):
        path.append(back[b, path[-1]])
    return [NAMES[k] for k in reversed(path)]


# ── 音色 ──────────────────────────────────────────

RNG = np.random.default_rng(3)


def expenv(n, a, r):
    t = np.arange(n) / FS
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)


def lp(x, cutoff):
    a = 1 - np.exp(-2 * np.pi * cutoff / FS)
    return lfilter([a], [1, a - 1], x)


def hp(x, cutoff):
    return x - lp(x, cutoff)


def kick():
    n = int(0.35 * FS)
    t = np.arange(n) / FS
    ph = 2 * np.pi * np.cumsum(48 + 140 * np.exp(-t / 0.025)) / FS
    body = np.sin(ph) * expenv(n, 0.001, 0.18)
    click = hp(RNG.standard_normal(n), 3000) * expenv(n, 0.0005, 0.004) * 0.5
    return np.tanh(1.5 * (body + click))


def snare():
    n = int(0.3 * FS)
    t = np.arange(n) / FS
    tone = (np.sin(2 * np.pi * 185 * t) + 0.5 * np.sin(2 * np.pi * 330 * t)) * expenv(n, 0.001, 0.05)
    noise = hp(RNG.standard_normal(n), 1500) * expenv(n, 0.001, 0.11)
    return 0.5 * tone + 0.7 * noise


def clap():
    n = int(0.25 * FS)
    x = hp(lp(RNG.standard_normal(n), 3500), 900)
    e = np.zeros(n)
    for d in (0, 0.009, 0.018):
        i = int(d * FS)
        e[i:] += expenv(n - i, 0.0005, 0.012 if d < 0.018 else 0.09)
    return x * e * 0.8


def chat():
    n = int(0.05 * FS)
    return hp(RNG.standard_normal(n), 7000) * expenv(n, 0.0005, 0.012)


def ohat():
    n = int(0.3 * FS)
    return hp(RNG.standard_normal(n), 6000) * expenv(n, 0.001, 0.09)


def crash():
    n = int(2.0 * FS)
    return hp(RNG.standard_normal(n), 4000) * expenv(n, 0.001, 0.7) * 0.6


def supersaw(hz, n, voices=5, spread=0.012, seed=0):
    t = np.arange(n) / FS
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for v in range(voices):
        d = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
        out += 2 * ((t * hz * (1 + d) + rng.random()) % 1) - 1
    return out / voices


def pulse(hz, n, duty=0.25):
    t = np.arange(n) / FS
    return np.where((t * hz) % 1 < duty, 1.0, -1.0)


def add(buf, x, at):
    i = int(round(at * FS))
    if i >= len(buf) or i < 0:
        return
    x = x[: len(buf) - i]
    buf[i: i + len(x)] += x


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    entries, secs = layout()
    bars = secs[-1]["bar0"] + secs[-1]["bars"]
    timeline = [{**n, "pos": n["pos"] + e["at"], "sec": e["sec"]} for e in entries for n in e["clip"]["notes"]]
    root = choose_key([n["pitch"] for n in timeline if n["pitch"] is not None])
    prog = harmonize(timeline, root, secs, bars)
    sec_of_bar = {}
    for s in secs:
        for b in range(s["bar0"], s["bar0"] + s["bars"]):
            sec_of_bar[b] = s
    end_bar = secs[-1]["bar0"]

    total = bars * BAR * SIX + 3
    N = int(total * FS)
    bus = {k: np.zeros(N) for k in ("voice", "kick", "snare", "hat", "crash", "bass", "pad_l", "pad_r", "stab_l", "stab_r", "arp", "lead", "riser")}

    rendered = {}
    for e in entries:
        k = id(e["clip"])
        if k not in rendered:
            rendered[k] = render_clip(e["clip"]["path"], e["clip"]["notes"], root)
        add(bus["voice"], rendered[k], e["at"] * SIX - LEAD)

    K, Sn, Cl, CH_, OH, CR = kick(), snare(), clap(), chat(), ohat(), crash()
    duck = np.ones(N)
    for b in range(bars):
        s = sec_of_bar[b]
        lab = s["label"]
        ch = TRIADS[prog[b]]
        rootpc = root + ch[0] % 12
        last_of_sec = b == s["bar0"] + s["bars"] - 1
        full = lab in ("hook", "hook2")
        t0 = b * BAR * SIX
        if b == s["bar0"] and lab in ("A", "hook", "B", "hook2", "end"):
            add(bus["crash"], CR, t0)
        if lab == "end":
            if b == end_bar:
                add(bus["kick"], 1.2 * K, t0)
                add(bus["snare"], Sn + np.pad(Cl, (0, len(Sn) - len(Cl))), t0)
            # 余韻: I のパッドだけ
        for st in range(BAR):
            at = t0 + st * SIX
            if lab in ("A", "B", "hook", "hook2"):
                if st % 4 == 0:
                    add(bus["kick"], K, at)
                    i = int(at * FS)
                    m = int(0.15 * FS)
                    duck[i:i + m] = np.minimum(duck[i:i + m], np.linspace(0.25, 1, m)[: len(duck[i:i + m])])
                if lab != "A" and st in (4, 12):
                    add(bus["snare"], 0.7 * Sn + 0.6 * np.pad(Cl, (0, len(Sn) - len(Cl))), at)
                if full and st % 4 == 2:
                    add(bus["hat"], 0.5 * OH, at)
                elif lab in ("B", "hook", "hook2") or st % 4 == 2:
                    add(bus["hat"], (0.35 if st % 2 else 0.22) * CH_, at)
                # 区間末のフィル
                if last_of_sec and lab in ("A", "B") and st >= 12:
                    add(bus["snare"], (0.4 + 0.1 * (st - 12)) * Sn, at)
                # 裏拍オクターブベース
                if st % 2 == 0:
                    n = int(SIX * 1.8 * FS)
                    hz = midi2hz(rootpc - 24 + (12 if st % 4 == 2 else 0))
                    add(bus["bass"], lp(supersaw(hz, n, 3, 0.004, b), 900) * expenv(n, 0.002, 0.15), at)
                # 裏拍のコード刻み
                if lab != "A" and st % 4 == 2:
                    n = int(SIX * 1.6 * FS)
                    for j, c in enumerate(ch):
                        hz = midi2hz(root + 12 + c)
                        add(bus["stab_l"], supersaw(hz, n, 5, 0.01, j) * expenv(n, 0.002, 0.08), at)
                        add(bus["stab_r"], supersaw(hz, n, 5, 0.01, j + 7) * expenv(n, 0.002, 0.08), at)
            # 16分アルペジオ
            if lab in ("hook", "hook2", "break", "build"):
                order = [0, 1, 2, 1] if lab == "break" else [0, 1, 2, 3]
                tones = [root + 24 + c for c in ch] + [root + 36 + ch[0]]
                n = int(SIX * 0.9 * FS)
                hz = midi2hz(tones[order[st % 4]])
                add(bus["arp"], pulse(hz, n, 0.25) * expenv(n, 0.001, 0.07) * (0.6 if lab == "break" else 1), at)
            # 盛り上げ: スネアロールとライザー
            if lab == "build":
                if st % 4 == 0 or st >= 8 and st % 2 == 0:
                    add(bus["kick"], 0.8 * K, at)
                add(bus["snare"], (0.3 + 0.7 * st / BAR) * Sn, at)
                if st % 2 == 0 and st >= 8:
                    add(bus["snare"], 0.5 * (st / BAR) * Sn, at + SIX / 2)
        if lab == "build":
            n = int(BAR * SIX * FS)
            x = hp(RNG.standard_normal(n), 2000) * np.linspace(0, 1, n) ** 2
            add(bus["riser"], x, t0)
        # パッド（前奏・ブレイク・Aは厚め、ほかは薄く）
        n = int(BAR * SIX * FS) + int(0.05 * FS)
        if True:
            gain = 1.0 if lab in ("intro", "break", "A", "end", "build") else 0.5
            fade = np.minimum(1, np.arange(n) / (0.04 * FS)) * np.minimum(1, (n - np.arange(n)) / (0.05 * FS))
            if lab == "build":
                fade = fade * np.linspace(0.6, 1.4, n)
            if lab == "end":
                fade = fade * np.exp(-np.arange(n) / FS / 2.5) if b > end_bar else fade
            for j, c in enumerate(ch + [ch[0] + 12]):
                hz = midi2hz(root + c)
                add(bus["pad_l"], gain * supersaw(hz, n, 5, 0.008, j) * fade, t0)
                add(bus["pad_r"], gain * supersaw(hz, n, 5, 0.008, j + 11) * fade, t0)

    # フックでは声の旋律をシンセが重ねる
    for nt in timeline:
        if nt["pitch"] is None or nt["sec"] not in ("hook", "hook2"):
            continue
        n = int(nt["len"] * SIX * FS * 0.9)
        hz = midi2hz(snap(nt["pitch"], root) + 12)
        add(bus["lead"], (0.6 * pulse(hz, n, 0.5) + 0.4 * supersaw(hz, n, 3, 0.006)) * expenv(n, 0.002, 0.25), nt["pos"] * SIX)

    def nrm(x):
        return x / (np.abs(x).max() + 1e-9)

    for k in ("pad_l", "pad_r"):
        bus[k] = lp(bus[k], 1800)
    for k in ("stab_l", "stab_r"):
        bus[k] = lp(bus[k], 4000)
    bus["arp"] = lp(bus["arp"], 5000)
    bus["lead"] = lp(bus["lead"], 3500)

    v = nrm(bus["voice"])
    v = np.tanh(2.0 * v) / np.tanh(2.0)  # 軽い圧縮で台詞を前へ
    gains = {"kick": 0.5, "snare": 0.32, "hat": 0.14, "crash": 0.16, "bass": 0.3,
             "pad": 0.13, "stab": 0.12, "arp": 0.07, "lead": 0.10, "riser": 0.22}

    def g(k, x):
        return gains[k] * nrm(x)

    pad_l, pad_r = g("pad", bus["pad_l"]) * duck, g("pad", bus["pad_r"]) * duck
    st_l, st_r = g("stab", bus["stab_l"]) * duck, g("stab", bus["stab_r"]) * duck
    bass = g("bass", bus["bass"]) * (0.5 + 0.5 * duck)
    hat = g("hat", bus["hat"])
    arp = g("arp", bus["arp"]) * duck
    center = 1.15 * v + g("kick", bus["kick"]) + g("snare", bus["snare"]) + bass + g("lead", bus["lead"]) + g("crash", bus["crash"]) * 0.7
    L = center + pad_l + st_l + 0.8 * hat + 1.0 * arp + g("riser", bus["riser"])
    R = center + pad_r + st_r + 0.6 * hat + 0.6 * arp + g("riser", bus["riser"])

    # 残響（センド）
    n = int(1.6 * FS)
    t = np.arange(n) / FS
    irl = RNG.standard_normal(n) * np.exp(-t / 0.35)
    irr = RNG.standard_normal(n) * np.exp(-t / 0.35)
    send = 0.10 * v + 0.6 * (pad_l + pad_r) / 2 + 0.5 * g("snare", bus["snare"]) + 0.4 * (st_l + st_r) / 2
    send = lp(hp(send, 300), 6000)
    wl = fftconvolve(send, irl)[:N]
    wr = fftconvolve(send, irr)[:N]
    L += 0.18 * nrm(wl) * np.abs(send).max()
    R += 0.18 * nrm(wr) * np.abs(send).max()

    out = np.stack([L, R], 1)
    out = np.tanh(1.1 * out / (np.abs(out).max() + 1e-9) * 1.4) / np.tanh(1.54)
    out = 0.92 * out / np.abs(out).max()
    sf.write(outdir / "song.wav", out.astype(np.float32), FS)
    sf.write(outdir / "voice.wav", (0.9 * v).astype(np.float32), FS)

    info = {
        "key": librosa.midi_to_note(root, unicode=False) + " major",
        "bars": bars,
        "seconds": round(bars * BAR * SIX, 1),
        "sections": [f"{s['label']}@{s['bar0'] + 1}x{s['bars']}" for s in secs],
        "progression": " ".join(prog),
    }
    fit = []
    for nt in timeline:
        if nt["pitch"] is None:
            continue
        b = nt["pos"] // BAR
        pc = (round(snap(nt["pitch"], root)) - root) % 12
        fit.append((pc in {c % 12 for c in TRIADS[prog[b]]}, nt["len"]))
    info["chordToneFit"] = round(sum(l for ok, l in fit if ok) / sum(l for _, l in fit), 3)
    (outdir / "song.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
