"""クッキー☆ × Dandelion biscuit☆型 1（notes-dande1.md）。伴奏まで Python で鳴らす。使い捨て。

魔理沙（UDK姉貴、右）が振り、霊夢（RU姉貴、左）が返す掛け合いを、作者の手順（16分へ伸縮 → モーラごとに F メジャーペンタ →
採譜 → 2拍ごとの和音を旋律から）で旋律にする。層は8小節ごとに足すだけ。49小節目から全音上げて2人を同時にしゃべらせる。
python -I dande1_build.py <outdir>   → song.wav・offset.txt・placement.json
"""
import json
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
import techno1_build as T  # noqa: E402

FS = 44100
BPM = 123
SIX = 15 / BPM
BAR = 16
NBARS = 64
HEAD = 0.1
MOD_BAR = 48  # 0始まり。ここから全音上
K = V.K
SRC = paths.WORK / "cookie_src"


def ru(name, text):
    return C.q(SRC / "RU姉貴" / f"{name}.wav", text)


def ud(name, text):
    return C.q(SRC / "UDK姉貴" / f"{name}.wav", text)


# 掛け合い: (魔理沙の振り, 霊夢の返し)
PAIRS = [
    (ud("おーっすお願いします", "おーっすおねがいします"), ru("今日もいい天気", "きょうもいいてんき")),
    (ud("ゆっくりしていってね", "ゆっくりしていってね"), ru("お、いいっすねぇ～！", "お、いいっすねえ")),
    (ud("伸びた？伸びない？", "のびた、のびない"), ru("なにそれ", "なにそれ")),
    (ud("弾幕はパワーだぜ", "だんまくわぱわーだぜ"), ru("つよそう", "つよそう")),
    (ud("がんばれがんばれやれる", "がんばれがんばれやれる"), ru("やったね。", "やったね")),
    (ud("グッジョブ、よくやった", "ぐっじょぶ、よくやった"), ru("ありがてえぜ。", "ありがてえぜ")),
    (ud("モノクマかわいいよねぇ", "ものくまかわいいよねえ"), ru("かわいいよ", "かわいいよ")),
    (ud("一年・・・普通だな！", "いちねん、ふつうだな"), ru("そーなのかー", "そーなのかー")),
]
# 全音上げた後は2人同時に: (魔理沙, 霊夢)
DUETS = [
    (ud("イエーイ", "いえーい"), ru("イエーイ", "いえーい")),
    (ud("弾幕はパワーだぜ", "だんまくわぱわーだぜ"), ru("皆踊れー！", "みなおどれー")),
    (ud("がんばれがんばれやれる", "がんばれがんばれやれる"), ru("仲良くしたい", "なかよくしたい")),
    (ud("ゆっくりしていってね", "ゆっくりしていってね"), ru("私も好きです", "わたしもすきです")),
    (ud("グッジョブ、よくやった", "ぐっじょぶ、よくやった"), ru("やったね。", "やったね")),
    (ud("伸びた？伸びない？", "のびた、のびない"), ru("どやー", "どやー")),
]
BYE = ru("じゃあな！", "じゃあな")
UU = ud("うー☆", "うー")  # 声の楽器: 右の16分アルペジオ
AU = ru("あう！", "あう")  # 声の楽器: 左の裏拍の刻み
PUHA = ru("ぷはー", "ぷはー")  # 声の打楽器: 2・4拍のリム

SECS = [("intro", 0, 8), ("build", 8, 16), ("A", 16, 32), ("solo", 32, 40), ("B", 40, 48), ("thermal", 48, 60), ("outro", 60, 64)]
PENT = np.array([5, 7, 9, 0, 2])  # F メジャーペンタ
CH = {"FM7": [53, 57, 60, 64], "Gm7": [55, 58, 62, 65], "Am7": [57, 60, 64, 67], "BbM7": [58, 62, 65, 69],
      "C7": [48, 52, 55, 58], "Dm7": [50, 53, 57, 60]}
ROOT = {"FM7": 41, "Gm7": 43, "Am7": 45, "BbM7": 46, "C7": 36, "Dm7": 38}
DEFAULT = ["BbM7", "C7", "Am7", "Dm7", "Gm7", "C7", "FM7", "FM7"]  # 2拍ごと、4小節周期
PAN = {"RU姉貴": (0.85, 0.45), "UDK姉貴": (0.45, 0.85)}  # (左, 右)


def sec_of(bar):
    return next(s for s, a, b in SECS if a <= bar < b)


def t_of(s16):
    return HEAD + s16 * SIX


def place(buf, x, t, g=1.0):
    T.place(buf, x, t, g)


def pcs(name, tr):
    return {(n + tr) % 12 for n in CH[name]}


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = B.SIX = G.SIX = SIX
    clips = [c for pr in PAIRS + DUETS for c in pr] + [BYE, UU, AU, PUHA]
    keys = {K(c): c for c in clips}
    V.SECTIONS = [("all", [(k, 1) for k in keys])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        f0 = G.world(c["path"])[0]
        ok = (f0 > 120) & (f0 < 800)
        cm = 12 * np.log2(np.median(f0[ok]) / 440) + 69 if ok.any() else 65.0
        mid = []
        for mo in c["snd"]:
            seg = f0[int(mo["vstart"] * 200):int(mo["end"] * 200) + 1]
            seg = seg[(seg > 120) & (seg < 800)]
            if len(seg) < 3 or mo["vowel"] == "cl":
                mid.append(np.nan)
                continue
            m_ = float(np.median(12 * np.log2(seg / 440) + 69))
            mid.append(m_ - 12 * np.sign(m_ - cm) if abs(m_ - cm) > 9 else m_)
        c["midi"] = np.array(mid)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 65.0
        c["tr"] = float(np.clip(round(66 - med), -3, 3))
        c["who"] = Path(c["path"]).parent.name

    # 台詞の配置: 掛け合いは2小節で1組（振りが1小節目、返しが2小節目の頭）。同時の組は2小節ごとに重ねる
    placed = []

    def put(clip, bar, sec):
        c = cache[K(clip)]
        placed.append({"key": K(clip), "at": bar * BAR, "sec": sec, "tr": 2 if bar >= MOD_BAR else 0, "who": c["who"]})
    for j, (u, r) in enumerate(PAIRS):
        put(u, 16 + 2 * j, "A")
        put(r, 17 + 2 * j, "A")
    for j, (u, r) in enumerate([PAIRS[0], PAIRS[1], PAIRS[4], PAIRS[5]]):
        put(u, 40 + 2 * j, "B")
        put(r, 41 + 2 * j, "B")
    for j, (u, r) in enumerate(DUETS):
        put(u, 48 + 2 * j, "thermal")
        put(r, 48 + 2 * j, "thermal")
    put(BYE, 61, "outro")

    melody, slot_notes = [], {}
    for p in placed:
        c = cache[p["key"]]
        p["q"] = B.correct(c["midi"] + c["tr"], np.array([(x + p["tr"]) % 12 for x in PENT]))
        for i in range(len(c["pos"])):
            if not np.isfinite(p["q"][i]):
                continue
            pos = p["at"] + int(c["pos"][i])
            w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            slot_notes.setdefault(pos // 8, []).append((p["q"][i], w))
            melody.append((pos, int(min(max(w, 1), 4)), float(p["q"][i]), p["who"]))

    # 和音は旋律から: 2拍ごとに、旋律の音が構成音に入る重み＋既定の進行への寄り（作者の手順の4）
    harm = []
    for slot in range(NBARS * 2):
        tr = 2 if slot // 2 >= MOD_BAR else 0
        default = DEFAULT[slot % 8]
        notes = slot_notes.get(slot, [])
        if not notes:
            harm.append((default, tr))
            continue
        best = max(CH, key=lambda nm: sum(w * (1 if int(round(mm)) % 12 in pcs(nm, tr) else -1) for mm, w in notes)
                   + (1.5 if nm == default else 0))
        harm.append((best, tr))
    harm[-2:] = [("FM7", 0), ("FM7", 0)]

    N = int((t_of(NBARS * BAR) + 3.0) * FS)
    L = {k: np.zeros(N) for k in ("kick", "clap", "rim", "hat", "bass", "keys", "pluck", "uu", "au", "pad")}
    st = {"uu": "R", "au": "L"}
    kk, cl, ch, oh = T.kick(), T.clap(), T.hat(0.02), T.hat(0.1)
    rim = G.burst(cache[K(PUHA)], 0, 0.06)
    uu, au = cache[K(UU)], cache[K(AU)]
    grains = {}

    def grain(c, m, d):
        key = (c["path"], round(m), d)
        if key not in grains:
            g = G.chop(c, 0, m, d)
            grains[key] = g / (np.abs(g).max() + 1e-9)
        return grains[key]

    def epiano(m, n):
        t = np.arange(n) / FS
        f = T.hz(m)
        x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.25) \
            + 0.12 * np.sin(2 * np.pi * 7 * f * t) * np.exp(-t / 0.04)
        return x * T.env(n, 0.002, 0.05)

    def pluck(m, n):
        return T.lp(T.saw(T.hz(m), n, (-6, 6)), 3500) * np.exp(-np.arange(n) / FS / 0.12) * T.env(n, 0.002, 0.02)

    for bar in range(NBARS):
        s = sec_of(bar)
        base = bar * BAR
        lay = {"intro": 1, "build": 2, "A": 3, "solo": 4, "B": 4, "thermal": 5, "outro": 1}[s]  # 足すだけ（終わりで1つに戻す）
        for half in range(2):
            name, tr = harm[bar * 2 + half]
            notes = [x + tr for x in CH[name]]
            root = ROOT[name] + tr
            h0 = base + half * 8
            # 1層: エレピの和音（2拍ごと、裏で刻み直す）
            for off in (0, 3, 6) if lay >= 3 else (0,):
                n = int((8 - off) * SIX * FS) if lay < 3 else int(3 * SIX * FS)
                for m in notes:
                    place(L["keys"], epiano(m + 12, n), t_of(h0 + off), 0.6 if off else 0.8)
            # 1層: 「うー☆」の16分アルペジオ（右）。前奏は8分
            arp = sorted(notes) + [notes[0] + 12]
            step = 1 if lay >= 2 else 2
            for k in range(0, 8, step):
                m = arp[(k // step) % len(arp)] + 12
                place(L["uu"], grain(uu, m, 0.9 * SIX * step), t_of(h0 + k), 0.5 if k % 2 else 0.7)
            if lay >= 2:  # 2層: ベースと「あう！」の裏拍（左）
                for k in (0, 3, 6):
                    n = int(1.8 * SIX * FS)
                    place(L["bass"], T.lp(T.saw(T.hz(root), n, (0, 5)), 900) * T.env(n, 0.003, 0.04), t_of(h0 + k))
                for k in (2, 6):
                    place(L["au"], grain(au, sorted(notes)[1] + 12, 0.8 * SIX), t_of(h0 + k), 0.6)
            if lay >= 4:  # 4層: 明るいプラック（8分の対旋律）
                for k in range(0, 8, 2):
                    place(L["pluck"], pluck(arp[::-1][(k // 2) % 4] + 24, int(1.8 * SIX * FS)), t_of(h0 + k), 0.5)
            if lay >= 5:  # 5層: パッド
                n = int(8 * SIX * FS)
                x = sum(T.saw(T.hz(m), n, (-12, 0, 12)) for m in notes) / 4
                place(L["pad"], T.lp(x, 2600) * T.env(n, 0.05, 0.1), t_of(h0))
        # ドラム: build は半分、A から全部
        for p16 in range(16):
            t = t_of(base + p16)
            if (lay == 2 and p16 in (0, 10)) or (lay >= 3 and p16 % 4 == 0):
                place(L["kick"], kk, t)
            if lay >= 3 and p16 in (4, 12):
                place(L["clap"], cl, t)
                place(L["rim"], rim, t)
            if lay >= 2 and p16 % 2 == 1:
                place(L["hat"], ch, t, 0.4)
            if lay >= 3 and p16 % 4 == 2:
                place(L["hat"], oh, t, 0.6)

    # 間奏（solo）: 1組目の旋律を「うー☆」で弾き直す（台詞は休む）
    for pos, d, m, who in melody:
        if 16 * BAR <= pos < 18 * BAR:
            for rep in range(4):
                place(L["uu"], grain(uu if who == "UDK姉貴" else au, m + 12, d * SIX), t_of(pos + (32 - 16 + 2 * rep) * BAR), 0.9)

    # 生の台詞
    VL, VR = np.zeros(N), np.zeros(N)
    out_placed = []
    for p in placed:
        c = cache[p["key"]]
        ratios = [2 ** ((a_ - b_) / 12) if np.isfinite(a_) and np.isfinite(b_) else 2 ** ((c["tr"] + p["tr"]) / 12)
                  for a_, b_ in zip(p["q"], c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        gl, gr = PAN[p["who"]]
        place(VL, x, t_of(p["at"]) + d0, gl)
        place(VR, x, t_of(p["at"]) + d0, gr)
        out_placed.append({"bar": p["at"] / BAR + 1, "text": c["text"], "who": p["who"], "sec": p["sec"], "kind": "raw",
                           "len16": int(c["pos"][-1]) + 2, "file": str(c["path"])})

    # ミックス
    sc = np.ones(N)
    for bar in range(NBARS):
        if sec_of(bar) in ("A", "solo", "B", "thermal"):
            for b4 in range(4):
                a = int(t_of(bar * BAR + b4 * 4) * FS)
                m = min(int(0.2 * FS), N - a)
                sc[a:a + m] = np.minimum(sc[a:a + m], 1 - 0.5 * np.exp(-np.arange(m) / FS / 0.07))
    gains = {"kick": 0.85, "clap": 0.35, "rim": 0.25, "hat": 0.3, "bass": 0.35, "keys": 0.10, "pluck": 0.12, "uu": 0.22, "au": 0.22, "pad": 0.10}
    duck = {"bass", "keys", "pluck", "pad", "uu", "au"}
    left = np.zeros(N)
    right = np.zeros(N)
    for k, x in L.items():
        y = gains[k] * (x * sc if k in duck else x)
        gl, gr = {"R": (0.45, 0.9), "L": (0.9, 0.45)}.get(st.get(k), (0.75, 0.75))
        left += gl * y
        right += gr * y
    inst = np.stack([left, right])

    def act_rms(x):
        r = np.sqrt(np.convolve(x ** 2, np.ones(2048) / 2048, mode="same"))
        return float(np.median(r[r > 0.1 * r.max()]))
    vg = 10 ** (-3 / 20) * act_rms(inst.mean(0)) / (act_rms((VL + VR) / 2) + 1e-9)  # 掛け合いが主役なので伴奏の −3 dB
    mix = inst + vg * np.stack([VL, VR])
    pk = np.abs(mix).max()
    out = np.tanh(1.3 * mix / pk) / np.tanh(1.3)
    out *= 0.95 / np.abs(out).max()
    end = int((t_of(NBARS * BAR) + 1.5) * FS)
    sf.write(outdir / "song.wav", out[:, :end].T.astype(np.float32), FS)
    (outdir / "offset.txt").write_text(f"{HEAD:.4f}", encoding="utf-8")

    # 渡す前の物差し（合否ではなく目安）
    heads, strong, agree, fit = [], [], [], []
    seen = set()
    for p in placed:
        c = cache[p["key"]]
        pos = p["at"] + c["pos"]
        heads.append(pos[0] % 4 == 0)
        thr = np.quantile(c["strength"], 0.75)
        strong += [pos[i] % 4 == 0 for i in range(len(pos)) if c["strength"][i] >= thr]
        for i in range(len(pos)):
            if np.isfinite(p["q"][i]):
                name, tr = harm[int(pos[i]) // 8]
                fit.append(int(round(p["q"][i])) % 12 in pcs(name, tr))
        if p["key"] in seen:
            continue
        seen.add(p["key"])
        mm, qq = c["midi"], p["q"]
        for i in range(1, len(mm)):
            if np.isfinite(mm[i]) and np.isfinite(mm[i - 1]) and abs(mm[i] - mm[i - 1]) >= 0.5:
                agree.append(int(np.sign(qq[i] - qq[i - 1]) * np.sign(mm[i] - mm[i - 1])))
    measures = {"phraseHeadOnBeat": round(float(np.mean(heads)), 2), "strong25OnBeat": round(float(np.mean(strong)), 2),
                "contourSame/flat/reversed": [agree.count(1), agree.count(0), agree.count(-1)],
                "melodyInChord": round(float(np.mean(fit)), 2),
                "voicedMorae": round(float(np.mean([np.isfinite(cache[p["key"]]["midi"]).mean() for p in placed])), 2)}
    info = {"bpm": BPM, "key": "F major → G major (bar 49)", "bars": NBARS, "endStep": NBARS * BAR * 12, "head": HEAD, "modBar": MOD_BAR + 1,
            "sections": [{"name": s, "from": a + 1, "to": b} for s, a, b in SECS],
            "chords": [harm[i][0] + ("+2" if harm[i][1] else "") for i in range(0, NBARS * 2)],
            "measures": measures, "placed": out_placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(measures, ensure_ascii=False), "seconds", round(end / FS, 1))
    print("chords A", info["chords"][32:48])


if __name__ == "__main__":
    main()
