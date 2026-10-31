"""淫夢 × TECHNO MUSIC先輩型 1（notes-techno1.md）。伴奏まで Python で鳴らす。使い捨て。

「これもうわかんねぇな」を作者の手順（16分へ伸縮 → モーラごとに A マイナーペンタ → 採譜）で旋律にし、それを1小節のリフとして
野獣の叫び「アアッ」の母音で作ったシンセに最初から最後まで弾かせる。和音はリフの音から選ぶ。生の台詞は41小節目まで出さない。
python -I techno1_build.py <outdir>   → song.wav・offset.txt・placement.json
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import scipy.signal as ss  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import cookie_v1 as C  # noqa: E402

FS = 44100
BPM = 124
SIX = 15 / BPM
BAR = 16
NBARS = 80
HEAD = 0.1  # 1小節目の時刻
K = V.K
Y = (paths.MATERIAL / "淫夢/淫夢SPパック_分割⑤/第４章「昏睡レイプ！野獣と化した先輩」/野獣")


def y(name, text):
    return C.q(Y / f"野獣「{name}」.wav", text)


WAKAN = y("これもうわかんねぇな", "これもうわかんねえな")
SHOUT = y("アアッ！アッ！", "ああっあっ")
OMATASE = y("おまたせ", "おまたせ")
KOKO = y("こ↑こ↓", "ここ")
SHOGANAI = y("まぁ大会近いからね、しょうがないね", "まあたいかいちかいからね、しょうがないね")
DAIJOBU = y("大丈夫でしょ", "だいじょうぶでしょ")
KUMOTTE = y("曇ってきたな", "くもってきたな")
DOUZO = y("入って、どうぞ", "はいって、どうぞ")
NAKA = y("中入るか", "なかはいるか")
TASHO = y("ま、多少はね？", "ま、たしょうはね")
KUIARA = y("悔い改めて", "くいあらためて")

# 区間（0始まりの小節）。緩急: 暗い前奏 → 明るむ → 41小節目で台詞と顔を落とす → 抜き → 一番厚い山 → 暗く閉じる
SECS = [("intro", 0, 8), ("build", 8, 16), ("rise", 16, 24), ("main", 24, 40), ("reveal", 40, 56), ("brk", 56, 64),
        ("peak", 64, 76), ("outro", 76, 80)]
# 生の台詞: (0始まりの小節, 台詞)。小節頭に置く
RAW = [(40, WAKAN), (42, OMATASE), (44, KOKO), (46, SHOGANAI), (50, DAIJOBU), (52, KUMOTTE), (54, WAKAN),
       (64, WAKAN), (66, DOUZO), (68, TASHO), (70, NAKA), (72, KUIARA), (74, WAKAN), (78, WAKAN)]
PENT = np.array([9, 0, 2, 4, 7])  # A マイナーペンタ
CH = {"Am7": [57, 60, 64, 67], "FM7": [53, 57, 60, 64], "G7": [55, 59, 62, 65], "Em7": [52, 55, 59, 62],
      "Dm7": [50, 53, 57, 60], "CM7": [48, 52, 55, 59]}
ROOT = {"Am7": 33, "FM7": 29, "G7": 31, "Em7": 28, "Dm7": 38, "CM7": 36}
DEFAULT = ["Am7", "FM7", "G7", "Em7"]


def sec_of(bar):
    return next(s for s, a, b in SECS if a <= bar < b)


def t_of(s16):
    return HEAD + s16 * SIX


def place(buf, x, t, g=1.0):
    a = int(t * FS)
    if a < 0:
        x, a = x[-a:], 0
    m = min(len(x), len(buf) - a)
    if m > 0:
        buf[a:a + m] += g * x[:m]


def hz(m):
    return 440 * 2 ** ((m - 69) / 12)


def saw(f, n, detune=(0,), rng=np.random.default_rng(1)):
    t = np.arange(n) / FS
    return sum(ss.sawtooth(2 * np.pi * f * 2 ** (d / 1200) * t + rng.uniform(0, 6.28)) for d in detune) / len(detune)


def env(n, a, r):
    e = np.ones(n)
    ia, ir = max(1, int(a * FS)), max(1, int(r * FS))
    e[:ia] = np.linspace(0, 1, ia)[:n]
    e[-ir:] *= np.linspace(1, 0, ir)[-min(ir, n):] if ir <= n else np.linspace(1, 0, n)
    return e


def lp(x, fc, order=2):
    return ss.sosfilt(ss.butter(order, min(fc, FS / 2.2) / (FS / 2), "low", output="sos"), x)


def hp(x, fc, order=2):
    return ss.sosfilt(ss.butter(order, fc / (FS / 2), "high", output="sos"), x)


def lp_auto(x, cutoff_of_bar):
    """小節ごとに切り替わるローパス（状態を引き継ぐ）。前奏の開き・抜きの絞りに使う。"""
    out = np.zeros_like(x)
    zi = None
    for bar in range(NBARS + 2):
        a = int(t_of(bar * BAR) * FS) if bar else 0
        b = min(len(x), int(t_of((bar + 1) * BAR) * FS))
        if a >= len(x):
            break
        sos = ss.butter(2, min(cutoff_of_bar(min(bar, NBARS - 1)), 18000) / (FS / 2), "low", output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[a:b], zi = ss.sosfilt(sos, x[a:b], zi=zi)
    return out


RNG = np.random.default_rng(7)


def kick():
    n = int(0.38 * FS)
    t = np.arange(n) / FS
    f = 46 + 110 * np.exp(-t / 0.028)
    x = np.sin(2 * np.pi * np.cumsum(f) / FS) * np.exp(-t / 0.22)
    x[:200] += RNG.normal(0, 0.3, 200) * np.linspace(1, 0, 200)
    return np.tanh(1.6 * x)


def clap():
    n = int(0.22 * FS)
    z = ss.sosfilt(ss.butter(2, [900 / 22050, 2600 / 22050], "band", output="sos"), RNG.normal(0, 1, n))
    t = np.arange(n) / FS
    e = np.exp(-t / 0.07)
    for d in (0.0, 0.011, 0.022):
        e += 0.6 * np.exp(-np.clip(t - d, 0, None) / 0.004) * (t >= d)
    return z * e * 0.5


def hat(decay):
    n = int((decay * 5 + 0.01) * FS)
    return hp(RNG.normal(0, 1, n), 7500, 4) * np.exp(-np.arange(n) / FS / decay) * 0.35


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = B.SIX = G.SIX = SIX
    clips = [WAKAN, SHOUT] + [c for _, c in RAW]
    keys = {K(c): c for c in clips}
    V.SECTIONS = [("all", [(k, 1) for k in keys])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        # この素材は雑音が多く pyin がほぼ全部を無声と読むので、モーラの音程は WORLD の harvest で取り直す
        f0 = G.world(c["path"])[0]
        ok = (f0 > 70) & (f0 < 500)
        cm = 12 * np.log2(np.median(f0[ok]) / 440) + 69
        mid = []
        for mo in c["snd"]:
            seg = f0[int(mo["vstart"] * 200):int(mo["end"] * 200) + 1]
            seg = seg[(seg > 70) & (seg < 500)]
            if len(seg) < 3 or mo["vowel"] == "cl":
                mid.append(np.nan)
                continue
            m_ = float(np.median(12 * np.log2(seg / 440) + 69))
            mid.append(m_ - 12 * np.sign(m_ - cm) if abs(m_ - cm) > 9 else m_)
        c["midi"] = np.array(mid)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 57.0
        print(c["text"], len(c["pos"]), "voiced", int(np.isfinite(c["midi"]).sum()), np.round(c["midi"], 1))
        c["tr"] = float(np.clip(round(57 - med), -3, 3))
        c["q"] = B.correct(c["midi"] + c["tr"], PENT)

    # リフ = 「これもうわかんねぇな」の採譜（1小節に収まらなければ2小節）
    w = cache[K(WAKAN)]
    span = int(w["pos"][-1]) + 2
    LOOP = 16 if span <= 16 else 32
    # 無声で音程の取れないモーラは直前の音で埋める（叫びのシンセはモーラを全部弾く）
    qf = w["q"].copy()
    for i in range(len(qf)):
        if not np.isfinite(qf[i]):
            qf[i] = qf[i - 1] if i and np.isfinite(qf[i - 1]) else qf[np.isfinite(qf)][0]
    riff = []
    for i, p in enumerate(w["pos"]):
        nxt = w["pos"][i + 1] if i + 1 < len(w["pos"]) else min(p + 3, LOOP)
        riff.append((int(p), int(max(1, min(nxt - p, 4))), float(qf[i])))
    print("riff loop", LOOP, "notes", [(p, d, round(m, 1)) for p, d, m in riff])

    # 和音: 4小節周期の各小節で、リフの音が構成音に入る重み＋既定の進行への寄り（作者の手順の4）
    def fit(name, notes):
        return sum(d * (1 if int(round(m)) % 12 in {x % 12 for x in CH[name]} else -1) for _, d, m in notes)
    # リフは1小節で毎小節同じなので、リフ全体に一番よく入る2つを2小節ずつ往復する（主和音 Am7 を先に）
    top2 = sorted(CH, key=lambda nm: -fit(nm, riff))[:2]
    top2.sort(key=lambda nm: nm != "Am7")
    prog = [top2[0], top2[0], top2[1], top2[1]]
    print("progression", prog)

    N = int((t_of(NBARS * BAR) + 3.0) * FS)
    bus = {k: np.zeros(N) for k in ("riff", "riff2", "kick", "clap", "hat", "vperc", "bass", "pad", "raw", "fx")}
    shout = cache[K(SHOUT)]
    raw_bars = {b for b, _ in RAW}

    # リフ（叫びのシンセ）。生の台詞の小節は台詞に譲る（41・79小節目）、40小節目の後半は空ける
    grain = {}
    for bar in range(NBARS):
        s = sec_of(bar)
        if bar in (40, 78, 79) or (s == "outro" and bar >= 78):
            continue
        for p, d, m in riff:
            if (bar * 16) % LOOP != (p // 16) * 16:
                continue
            pos = bar * BAR + p % 16
            if bar == 39 and p % 16 >= 8:
                continue
            key = (round(m), d)
            if key not in grain:
                g = G.chop(shout, 0, m + 12, d * SIX * 0.95)
                g = np.tanh(2.5 * g / (np.abs(g).max() + 1e-9))
                grain[key] = g
            place(bus["riff"], grain[key], t_of(pos))
            if s in ("main", "peak"):
                key2 = (round(m) - 12, d)
                if key2 not in grain:
                    g = G.chop(shout, 0, m, d * SIX * 0.95)
                    grain[key2] = np.tanh(2.5 * g / (np.abs(g).max() + 1e-9))
                place(bus["riff2"], grain[key2], t_of(pos), 0.6)

    def riff_cut(bar):
        s = sec_of(bar)
        a = next(a_ for s_, a_, _ in SECS if s_ == s)
        if s == "intro":
            return 350 * (2500 / 350) ** ((bar - a) / 7)
        if s == "build":
            return 2500 + 250 * (bar - a)
        if s == "brk":
            return 900 * (9000 / 900) ** ((bar - a) / 7)
        if s == "outro":
            return 6000 * (400 / 6000) ** ((bar - a) / 3)
        return 9000
    bus["riff"] = lp_auto(bus["riff"], riff_cut)
    bus["riff2"] = lp(bus["riff2"], 2500)

    # ドラム（自前）と声の打楽器（「こ↑こ↓」の「こ」）
    kk, cl, ch, oh = kick(), clap(), hat(0.025), hat(0.12)
    koko = cache[K(KOKO)]
    vk = G.burst(koko, 0, 0.06)
    kick_times = []
    for bar in range(NBARS):
        s = sec_of(bar)
        base = bar * BAR
        kick_on = s in ("build", "rise", "main", "reveal", "peak") or (s == "outro" and bar < 78)
        if bar == 39:
            kick_on = False  # 落とす前に1小節抜く
        for p16 in range(16):
            t = t_of(base + p16)
            if kick_on and p16 % 4 == 0:
                place(bus["kick"], kk, t)
                kick_times.append(t)
            if s in ("rise", "main", "reveal", "peak") and p16 in (4, 12) and bar != 39:
                place(bus["clap"], cl, t)
            if s in ("main", "reveal", "peak") and p16 % 2 == 1:
                place(bus["hat"], ch, t, 0.5)
            if (s in ("rise", "main", "reveal", "peak") or (s == "intro" and bar >= 4)) and p16 % 4 == 2:
                place(bus["hat"], oh, t, 0.7 if s != "intro" else 0.35)
            if s in ("main", "peak") and p16 in (3, 7, 11, 14, 15):
                place(bus["vperc"], vk, t, 1.0 if p16 != 14 else 0.6)
        if bar == 39:  # どもり: 次に出す台詞の頭「こ」を16分で8回、上がりながら
            for k in range(8):
                g = G.chop(cache[K(WAKAN)], 0, 57 + (k // 2) * 2, 0.9 * SIX)
                place(bus["fx"], g / (np.abs(g).max() + 1e-9), t_of(base + 8 + k), 0.3 + 0.07 * k)
    # 抜きの終わりにノイズの上昇（緩急の「ため」）
    a, b = t_of(62 * BAR), t_of(64 * BAR)
    n = int((b - a) * FS)
    z = RNG.normal(0, 1, n)
    zz = np.zeros(n)
    for j in range(16):
        seg = slice(j * n // 16, (j + 1) * n // 16)
        zz[seg] = ss.sosfilt(ss.butter(2, [300 * 2 ** (j / 3) / 22050, min(0.95, 600 * 2 ** (j / 3) / 22050)], "band", output="sos"), z[seg])
    place(bus["fx"], zz * np.linspace(0, 0.5, n), a)

    # ベースとパッド
    for bar in range(NBARS):
        s = sec_of(bar)
        name = prog[bar % 4]
        base = bar * BAR
        r = ROOT[name]
        if s in ("build", "rise", "main", "reveal") or (s == "outro" and bar < 78):
            for p16 in (2, 6, 10, 14):
                n = int(1.6 * SIX * FS)
                x = lp(saw(hz(r + 12), n, (0, 7)), 700) * env(n, 0.003, 0.03)
                place(bus["bass"], x, t_of(base + p16))
        elif s == "peak":
            for p16 in range(16):
                if p16 % 4 == 0:
                    continue
                n = int(0.9 * SIX * FS)
                x = lp(saw(hz(r + (12 if p16 % 2 else 0) + 12), n, (0, 7)), 900) * env(n, 0.002, 0.02)
                place(bus["bass"], x, t_of(base + p16))
        if s in ("rise", "main", "reveal", "brk", "peak"):
            n = int(16 * SIX * FS)
            x = sum(saw(hz(m), n, (-14, -5, 0, 6, 13)) for m in CH[name]) / 4
            fc = {"rise": 900 + 150 * (bar - 16), "brk": 3500, "peak": 4000}.get(s, 2200)
            place(bus["pad"], lp(x, fc) * env(n, 0.02 if s != "brk" else 0.4, 0.15), t_of(base))

    # 生の台詞（作者の手順: 16分へ伸縮 → モーラごとにペンタ → 揺れは残す）
    placed = []
    for bar, clip in RAW:
        c = cache[K(clip)]
        at = bar * BAR
        ratios = [2 ** ((a_ - b_) / 12) if np.isfinite(a_) and np.isfinite(b_) else 2 ** (c["tr"] / 12) for a_, b_ in zip(c["q"], c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        place(bus["raw"], x, t_of(at) + d0)
        placed.append({"bar": bar + 1, "text": c["text"], "len16": int(c["pos"][-1]) + 2, "kind": "raw",
                       "notes": [(int(at + p), float(m)) for p, m in zip(c["pos"], c["q"]) if np.isfinite(m)]})

    # ミックス: パッド・ベース・リフはキックで沈める
    sc = np.ones(N)
    for t in kick_times:
        a = int(t * FS)
        n = int(0.22 * FS)
        m = min(n, N - a)
        sc[a:a + m] = np.minimum(sc[a:a + m], 1 - 0.65 * np.exp(-np.arange(m) / FS / 0.06)[::-1][::-1])
    gains = {"riff": 0.55, "riff2": 0.22, "kick": 0.9, "clap": 0.45, "hat": 0.35, "vperc": 0.30, "bass": 0.35, "pad": 0.16,
             "raw": 0.0, "fx": 0.35}
    duck = {"pad", "bass", "riff2"}
    inst = sum(gains[k] * (bus[k] * sc if k in duck else bus[k]) for k in bus if k != "raw")
    # 生の台詞は伴奏の −6 dB（2号兄貴の作で −5〜−12 dB）
    def act_rms(x):
        r = np.sqrt(np.convolve(x ** 2, np.ones(2048) / 2048, mode="same"))
        return float(np.median(r[r > 0.1 * r.max()]))
    raw = bus["raw"] * 10 ** (-6 / 20) * act_rms(inst) / (act_rms(bus["raw"]) + 1e-9)
    raw[int(t_of(78 * BAR) * FS):] *= 1.8  # 最後の1本は伴奏が無いぶん上げる
    mix = inst + raw
    # 山だけ飽和を強めて音圧を上げる
    drive = np.ones(N)
    a, b = int(t_of(64 * BAR) * FS), int(t_of(76 * BAR) * FS)
    drive[a:b] = 1.6
    drive = np.convolve(drive, np.ones(4410) / 4410, mode="same")
    pk = np.abs(mix).max()
    out = np.tanh(drive * 1.4 * mix / pk) / np.tanh(1.4)
    out *= 0.95 / np.abs(out).max()
    stereo = np.stack([out, out], 1)
    end = int((t_of(79 * BAR) + 1.6) * FS)
    sf.write(outdir / "song.wav", stereo[:end].astype(np.float32), FS)
    (outdir / "offset.txt").write_text(f"{HEAD:.4f}", encoding="utf-8")

    # 渡す前の物差し（合否ではなく目安）
    heads, strong, agree, infit = [], [], [], []
    for bar, clip in RAW:
        c = cache[K(clip)]
        heads.append(int(c["pos"][0]) % 4 == 0)
        thr = np.quantile(c["strength"], 0.75)
        strong += [int(c["pos"][i]) % 4 == 0 for i in range(len(c["pos"])) if c["strength"][i] >= thr]
        for i in range(len(c["pos"])):
            if np.isfinite(c["q"][i]):
                infit.append(int(round(c["q"][i])) % 12 in {x % 12 for x in CH[prog[(bar + int(c["pos"][i]) // 16) % 4]]})
    for c in cache.values():
        mm, qq = c["midi"], c["q"]
        for i in range(1, len(mm)):
            if np.isfinite(mm[i]) and np.isfinite(mm[i - 1]) and abs(mm[i] - mm[i - 1]) >= 0.5:
                agree.append(int(np.sign(qq[i] - qq[i - 1]) * np.sign(mm[i] - mm[i - 1])))
    measures = {"phraseHeadOnBeat": round(float(np.mean(heads)), 2), "strong25OnBeat": round(float(np.mean(strong)), 2),
                "contourSame/flat/reversed": [agree.count(1), agree.count(0), agree.count(-1)],
                "melodyInChord": round(float(np.mean(infit)), 2)}
    info = {"bpm": BPM, "key": "A minor", "bars": NBARS, "endStep": NBARS * BAR * 12, "head": HEAD, "loop16": LOOP,
            "riff": riff, "progression": prog, "sections": [{"name": s, "from": a + 1, "to": b} for s, a, b in SECS],
            "measures": measures, "placed": placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(measures, ensure_ascii=False), "seconds", round(end / FS, 1))


if __name__ == "__main__":
    main()
