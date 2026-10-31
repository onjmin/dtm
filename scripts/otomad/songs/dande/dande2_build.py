"""クッキー☆ × Dandelion biscuit☆型 2（notes-dande2.md）。伴奏まで Python で鳴らす。使い捨て。

霊夢の神社に客が1人ずつ来る筋書き。台詞は作者の手順（16分へ伸縮 → モーラごとにペンタ → 採譜 → 2拍ごとの和音を旋律から）。
来た人ごとに声の楽器が1つ増える。「ん？」で止めて D マイナーの暗転（JOKER）、MZ の「じゃいくぞ」で戻し、全音上げて6人で回す。
python -I dande2_build.py <outdir>   → song.wav・offset.txt・placement.json
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import cookie_v1 as C  # noqa: E402
import techno1_build as T  # noqa: E402

FS = 44100
BPM = 126
SIX = 15 / BPM
BAR = 16
HEAD = 0.1
K = V.K
SRC = paths.WORK / "cookie_src"
WHO = {"RU": "RU姉貴", "UDK": "UDK姉貴", "HNS": "HNS姉貴", "BNK": "BNKRG姉貴", "MZ": "MZ姉貴", "JOK": "JOKER姉貴"}


def v(who, name, text):
    return C.q(SRC / WHO[who] / f"{name}.wav", text)


# 区間（0始まりの小節）
SECS = [("intro", 0, 8), ("A", 8, 16), ("hns", 16, 24), ("bnk", 24, 32), ("rise", 32, 36), ("dark", 36, 44), ("mz", 44, 52),
        ("final", 52, 72), ("outro", 72, 76)]
NBARS = 76
MOD_BAR = 52
# 台詞: (小節, 人, ファイル名, 読み)。同じ小節に2つあれば同時にしゃべる
SCRIPT = [
    (8, "UDK", "おーっすお願いします", "おーっすおねがいします"), (9, "RU", "今日もいい天気", "きょうもいいてんき"),
    (10, "UDK", "ゆっくりしていってね", "ゆっくりしていってね"), (11, "RU", "お、いいっすねぇ～！", "お、いいっすねえ"),
    (12, "UDK", "伸びた？伸びない？", "のびた、のびない"), (13, "RU", "なにそれ", "なにそれ"),
    (14, "UDK", "弾幕はパワーだぜ", "だんまくわぱわーだぜ"), (15, "RU", "つよそう", "つよそう"),
    (16, "HNS", "あのさぁ…", "あのさあ"), (17, "RU", "びっくり", "びっくり"),
    (18, "HNS", "よろちこ", "よろちこ"), (19, "UDK", "イエーイ", "いえーい"),
    (20, "HNS", "暑い…", "あつい"), (21, "UDK", "がんばれがんばれやれる", "がんばれがんばれやれる"),
    (22, "HNS", "それってYO！", "それってよ"), (23, "RU", "そーなのかー", "そーなのかー"),
    (24, "BNK", "ハロー", "はろー"), (25, "RU", "いいよこいよ", "いいよこいよ"),
    (26, "BNK", "うまうま", "うまうま"), (27, "HNS", "やったぜ.", "やったぜ"),
    (28, "BNK", "ふふーん♪", "ふふーん"), (29, "UDK", "グッジョブ、よくやった", "ぐっじょぶ、よくやった"),
    (30, "BNK", "なんでや！", "なんでや"), (31, "RU", "ちょっと待って", "ちょっとまって"),
    (36, "BNK", "ん？", "ん"), (37, "JOK", "レディースアーンドジェントルマーン！", "れでぃーすあーんどじぇんとるまーん"),
    (39, "JOK", "めんどくさ", "めんどくさ"), (40, "RU", "待てコラガキ", "まてこらがき"),
    (41, "JOK", "うにゃ！", "うにゃ"), (42, "UDK", "嘘、ってオイ！", "うそ、っておい"), (43, "RU", "正体現したね", "しょうたいあらわしたね"),
    (44, "MZ", "じゃいくぞ", "じゃいくぞ"), (45, "HNS", "オナシャス", "おなしゃす"),
    (46, "MZ", "いっちゃえ", "いっちゃえ"), (47, "BNK", "おっけー", "おっけー"),
    (48, "UDK", "がんばれがんばれやれる", "がんばれがんばれやれる"), (49, "RU", "仲良くしたい", "なかよくしたい"),
    (50, "MZ", "はーい", "はーい"),
    (52, "RU", "今日もいい天気", "きょうもいいてんき"), (53, "UDK", "弾幕はパワーだぜ", "だんまくわぱわーだぜ"),
    (54, "HNS", "好きだよ", "すきだよ"), (55, "BNK", "にゃーん", "にゃーん"),
    (56, "MZ", "ありがとう", "ありがとう"), (57, "JOK", "大好きだよ", "だいすきだよ"),
    (58, "RU", "仲良くしたい", "なかよくしたい"), (59, "UDK", "ゆっくりしていってね", "ゆっくりしていってね"),
    (60, "HNS", "はえ～", "はえー"), (61, "BNK", "おかえりー", "おかえりー"),
    (62, "MZ", "愛してるよ", "あいしてるよ"), (63, "JOK", "かしこまり！", "かしこまり"),
    (64, "RU", "イエーイ", "いえーい"), (64, "UDK", "イエーイ", "いえーい"),
    (66, "HNS", "やったぜ.", "やったぜ"), (66, "BNK", "やったぜ。", "やったぜ"),
    (68, "RU", "やったね。", "やったね"), (68, "BNK", "やったね。", "やったね"),
    (70, "MZ", "じゃいくぞ", "じゃいくぞ"), (70, "JOK", "大好きだ～！", "だいすきだー"),
    (72, "RU", "じゃあな！", "じゃあな"), (73, "MZ", "ばいばーい", "ばいばーい"), (74, "JOK", "アリーヴェデルチ", "ありーゔぇでるち"),
]
# 声の楽器
AU = v("RU", "あう！", "あう")
UU = v("UDK", "うー☆", "うー")
HAU = v("HNS", "はうはう～", "はうはうー")
NYA = v("BNK", "にゃーん", "にゃーん")
UNYA = v("JOK", "うにゃ！", "うにゃ")
SUWA = v("MZ", "すわわっ！", "すわわっ")
PUHA = v("RU", "ぷはー", "ぷはー")

PENT = np.array([5, 7, 9, 0, 2])  # F メジャーペンタ（D マイナーペンタと同じ音）
CH = {"FM7": [53, 57, 60, 64], "Gm7": [55, 58, 62, 65], "Am7": [57, 60, 64, 67], "BbM7": [58, 62, 65, 69],
      "C7": [48, 52, 55, 58], "Dm7": [50, 53, 57, 60], "A7": [57, 61, 64, 67], "D7": [50, 54, 57, 60]}
ROOT = {"FM7": 41, "Gm7": 43, "Am7": 45, "BbM7": 46, "C7": 36, "Dm7": 38, "A7": 45, "D7": 38}
MAJOR = ["BbM7", "C7", "Am7", "Dm7", "Gm7", "C7", "FM7", "FM7"]  # 2拍ごと、4小節周期
MINOR = ["Dm7", "Dm7", "BbM7", "BbM7", "Gm7", "Gm7", "A7", "A7"]
RISE = ["BbM7", "BbM7", "C7", "C7", "BbM7", "BbM7", "C7", "C7"]
VOCAB = {"dark": ["Dm7", "BbM7", "Gm7", "A7", "FM7"]}
PAN = {"RU姉貴": (0.85, 0.45), "UDK姉貴": (0.45, 0.85), "HNS姉貴": (0.8, 0.55), "BNKRG姉貴": (0.55, 0.8), "MZ姉貴": (0.7, 0.7),
       "JOKER姉貴": (0.7, 0.7)}


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
    lines = [(bar, v(w, n, t)) for bar, w, n, t in SCRIPT]
    clips = [c for _, c in lines] + [AU, UU, HAU, NYA, UNYA, SUWA, PUHA]
    keys = {K(c): c for c in clips}
    V.SECTIONS = [("all", [(k, 1) for k in keys])]
    cache = V.load_clips()
    two_bar = {K(clip) for bar, clip in lines if not any(b2 == bar + 1 for b2, _ in lines)}
    for c in cache.values():
        c["pos"] = V.place(c)
        if c["pos"][-1] + 2 > BAR and K(next(cl for cl in clips if cache[K(cl)] is c)) not in two_bar:
            c["pos"] = V.place(c, lmax=BAR - 2)  # 次の人が次の小節頭でしゃべるので1小節に収める
        # 素材ごとに雑音が違うので、モーラの音程は WORLD の harvest でそろえて取る
        f0 = G.world(c["path"])[0]
        ok = (f0 > 110) & (f0 < 800)
        cm = 12 * np.log2(np.median(f0[ok]) / 440) + 69 if ok.any() else 65.0
        mid = []
        for mo in c["snd"]:
            seg = f0[int(mo["vstart"] * 200):int(mo["end"] * 200) + 1]
            seg = seg[(seg > 110) & (seg < 800)]
            if len(seg) < 3 or mo["vowel"] == "cl":
                mid.append(np.nan)
                continue
            m_ = float(np.median(12 * np.log2(seg / 440) + 69))
            mid.append(m_ - 12 * np.sign(m_ - cm) if abs(m_ - cm) > 9 else m_)
        c["midi"] = np.array(mid)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 65.0
        c["tr"] = float(np.clip(round(66 - med), -3, 3))
        c["who"] = Path(c["path"]).parent.name

    placed, melody, slot_notes = [], [], {}
    for bar, clip in lines:
        c = cache[K(clip)]
        tr = 2 if bar >= MOD_BAR else 0
        q = B.correct(c["midi"] + c["tr"], np.array([(x + tr) % 12 for x in PENT]))
        p = {"key": K(clip), "at": bar * BAR, "tr": tr, "who": c["who"], "q": q, "sec": sec_of(bar)}
        placed.append(p)
        for i in range(len(c["pos"])):
            if not np.isfinite(q[i]):
                continue
            pos = p["at"] + int(c["pos"][i])
            w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            slot_notes.setdefault(pos // 8, []).append((q[i], w))
            melody.append((pos, int(min(max(w, 1), 4)), float(q[i]), c["who"]))

    # 和音は旋律から（作者の手順の4）。区間の型ごとの既定の進行へ寄せる。前奏の高まり（rise）は固定
    harm = []
    for slot in range(NBARS * 2):
        bar = slot // 2
        s = sec_of(bar)
        tr = 2 if bar >= MOD_BAR else 0
        default = (MINOR if s == "dark" else RISE if s == "rise" else MAJOR)[slot % 8]
        notes = slot_notes.get(slot, [])
        if not notes or s == "rise":
            harm.append((default, tr))
            continue
        vocab = VOCAB.get(s, ["FM7", "Gm7", "Am7", "BbM7", "C7", "Dm7"])
        best = max(vocab, key=lambda nm: sum(w * (1 if int(round(mm)) % 12 in pcs(nm, tr) else -1) for mm, w in notes)
                   + (1.5 if nm == default else 0))
        harm.append((best, tr))
    harm[-4:] = [("FM7", 2)] * 4
    harm[MOD_BAR * 2 - 2:MOD_BAR * 2] = [("D7", 0), ("D7", 0)]  # 全音上げる前の小節は G への属七

    N = int((t_of(NBARS * BAR) + 3.0) * FS)
    lay = {k: np.zeros(N) for k in ("kick", "snare", "hat", "rim", "bass", "keys", "pluck", "pad", "au", "uu", "hau", "nya", "unya", "suwa")}
    PANL = {"au": (0.9, 0.4), "uu": (0.4, 0.9), "hau": (0.85, 0.5), "nya": (0.5, 0.85)}
    kk, cl, ch, oh = T.kick(), T.clap(), T.hat(0.02), T.hat(0.1)
    rim = G.burst(cache[K(PUHA)], 0, 0.06)
    grains = {}

    def grain(clip, mi, m, d):
        c = cache[K(clip)]
        key = (K(clip), mi, round(m), round(d, 3))
        if key not in grains:
            g = G.chop(c, min(mi, len(c["snd"]) - 1), m, d)
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

    # HNS の「はうはう～」を自分の抑揚どおりに弾く短い動機（声の楽器）
    hc = cache[K(HAU)]
    hq = B.correct(hc["midi"] + hc["tr"], PENT)
    hq = np.where(np.isfinite(hq), hq, np.nanmedian(hq) if np.isfinite(hq).any() else 65)
    HMOT = [(int(p), i, float(m)) for i, (p, m) in enumerate(zip(hc["pos"], hq)) if p < 8]

    for bar in range(NBARS):
        s = sec_of(bar)
        base = bar * BAR
        has = {
            "keys": s not in ("dark",), "au8": s == "intro", "au": s in ("A", "hns", "bnk", "rise", "final") or (s == "mz" and bar >= 46),
            "uu": s in ("A", "hns", "bnk", "rise", "final") or (s == "mz" and bar >= 46), "hau": s in ("hns", "bnk", "final"),
            "nya": s in ("bnk", "final"), "bass": s in ("A", "hns", "bnk", "rise", "final") or (s == "mz" and bar >= 46),
            "pluck": s in ("bnk", "final"), "pad": s in ("dark", "mz", "final"), "unya": s == "dark",
        }
        for half in range(2):
            name, tr = harm[bar * 2 + half]
            notes = [x + tr for x in CH[name]]
            root = ROOT[name] + tr
            h0 = base + half * 8
            arp = sorted(notes) + [sorted(notes)[0] + 12]
            if has["keys"]:
                offs = (0,) if s in ("intro", "outro") else (0, 3, 6)
                for off in offs:
                    n = int((8 - off) * SIX * FS) if len(offs) == 1 else int(3 * SIX * FS)
                    for m in notes:
                        place(lay["keys"], epiano(m + 12, n), t_of(h0 + off), 0.6 if off else 0.8)
            if has["au8"]:  # 前奏: 霊夢ひとりの「あう」の8分アルペジオ
                for k in range(0, 8, 2):
                    place(lay["au"], grain(AU, 0, arp[(k // 2) % 4] + 12, 1.8 * SIX), t_of(h0 + k), 0.6)
            if has["au"]:
                for k in (2, 6):
                    place(lay["au"], grain(AU, 0, sorted(notes)[1] + 12, 0.8 * SIX), t_of(h0 + k), 0.55)
            if has["uu"]:
                for k in range(8):
                    place(lay["uu"], grain(UU, 0, arp[k % len(arp)] + 12, 0.9 * SIX), t_of(h0 + k), 0.5 if k % 2 else 0.7)
            if has["bass"]:
                for k in ((0, 3, 6) if s != "bnk" else (2, 6)):
                    n = int(1.8 * SIX * FS)
                    oct_ = 12 if (s == "bnk" and k == 6) else 0
                    place(lay["bass"], T.lp(T.saw(T.hz(root + oct_), n, (0, 5)), 900) * T.env(n, 0.003, 0.04), t_of(h0 + k))
            if has["pluck"]:
                for k in range(0, 8, 2):
                    place(lay["pluck"], pluck(arp[::-1][(k // 2) % 4] + 24, int(1.8 * SIX * FS)), t_of(h0 + k), 0.5)
            if has["pad"]:
                n = int(8 * SIX * FS)
                x = sum(T.saw(T.hz(m), n, (-12, 0, 12)) for m in notes) / 4
                place(lay["pad"], T.lp(x, 1400 if s == "dark" else 2600) * T.env(n, 0.08, 0.1), t_of(h0))
                if s == "dark":  # 暗転のベースは長く低く
                    n2 = int(8 * SIX * FS)
                    place(lay["bass"], T.lp(T.saw(T.hz(root), n2, (0, 4)), 300) * T.env(n2, 0.05, 0.2), t_of(h0), 0.8)
            if has["nya"]:
                for k in (3, 7):
                    place(lay["nya"], grain(NYA, 0, sorted(notes)[2] + 12, 0.7 * SIX), t_of(h0 + k), 0.6)
        if has["hau"] and bar % 2 == 1:  # 2小節目の後半に HNS の動機
            for p, i, m in HMOT:
                place(lay["hau"], grain(HAU, i, m + 12 + harm[bar * 2][1], 1.6 * SIX), t_of(base + 8 + p), 0.75)
        if has["unya"]:  # JOKER の「う」を低く、小節頭に
            name, tr = harm[bar * 2]
            place(lay["unya"], grain(UNYA, 0, ROOT[name] + 24, 3.5 * SIX), t_of(base), 0.8)

        # ドラム（区間ごとに型を替える）
        for p16 in range(16):
            t = t_of(base + p16)
            if s in ("A", "bnk", "final") or (s == "mz" and 46 <= bar < 50) or (s == "rise"):
                if p16 % 4 == 0:
                    place(lay["kick"], kk, t)
                if p16 in (4, 12) and s != "rise":
                    place(lay["snare"], cl, t, 0.9)
                    place(lay["rim"], rim, t)
                if p16 % 2 == 1:
                    place(lay["hat"], ch, t, 0.4)
                if p16 % 4 == 2 and s in ("bnk", "final"):
                    place(lay["hat"], oh, t, 0.6)
            elif s == "hns":  # 半分の速さに落とし、16分のハットで細かく
                if p16 in (0, 10):
                    place(lay["kick"], kk, t)
                if p16 == 8:
                    place(lay["snare"], cl, t, 0.9)
                    place(lay["rim"], rim, t)
                place(lay["hat"], ch, t, 0.45 if p16 % 2 else 0.25)
            elif s == "dark" and p16 in (0, 3):  # 心音
                place(lay["kick"], kk, t, 0.5 if p16 == 0 else 0.3)
        if s == "rise" or (s == "mz" and bar >= 50):  # 連打で高める。最後の拍は空ける
            step = 2 if bar in (32, 33, 50) else 1
            for p16 in range(0, 16, step):
                if bar in (35, 51) and p16 >= 12:
                    break
                g = 0.3 + 0.6 * ((bar - (32 if s == "rise" else 50)) * 16 + p16) / (64 if s == "rise" else 32)
                place(lay["snare"], cl, t_of(base + p16), min(g, 1.0))
                if s == "mz":
                    place(lay["suwa"], grain(SUWA, 0, 65 + p16 % 5, 0.8 * SIX), t_of(base + p16), 0.3)
        if s == "final" and bar % 4 == 3:  # MZ の「すわわっ」の合いの手
            for k, p16 in enumerate((12, 13, 14, 15)):
                place(lay["suwa"], grain(SUWA, 0, 67 + 2 * k, 0.8 * SIX), t_of(base + p16), 0.45)

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
        if sec_of(bar) in ("A", "bnk", "final") or 46 <= bar < 50:
            for b4 in range(4):
                a = int(t_of(bar * BAR + b4 * 4) * FS)
                m = min(int(0.2 * FS), N - a)
                sc[a:a + m] = np.minimum(sc[a:a + m], 1 - 0.5 * np.exp(-np.arange(m) / FS / 0.07))
    gains = {"kick": 0.85, "snare": 0.35, "rim": 0.25, "hat": 0.3, "bass": 0.35, "keys": 0.10, "pluck": 0.12, "pad": 0.11,
             "au": 0.22, "uu": 0.22, "hau": 0.24, "nya": 0.2, "unya": 0.3, "suwa": 0.25}
    duck = {"bass", "keys", "pluck", "pad", "au", "uu", "hau", "nya"}
    left, right = np.zeros(N), np.zeros(N)
    for k, x in lay.items():
        y = gains[k] * (x * sc if k in duck else x)
        gl, gr = PANL.get(k, (0.75, 0.75))
        left += gl * y
        right += gr * y
    inst = np.stack([left, right])

    def act_rms(x):
        r = np.sqrt(np.convolve(x ** 2, np.ones(2048) / 2048, mode="same"))
        return float(np.median(r[r > 0.1 * r.max()]))
    vg = 10 ** (-3 / 20) * act_rms(inst.mean(0)) / (act_rms((VL + VR) / 2) + 1e-9)
    mix = inst + vg * np.stack([VL, VR])
    pk = np.abs(mix).max()
    out = np.tanh(1.3 * mix / pk) / np.tanh(1.3)
    out *= 0.95 / np.abs(out).max()
    end = int((t_of(NBARS * BAR) + 1.5) * FS)
    sf.write(outdir / "song.wav", out[:, :end].T.astype(np.float32), FS)
    (outdir / "offset.txt").write_text(f"{HEAD:.4f}", encoding="utf-8")

    # 渡す前の物差し（合否ではなく目安）
    heads, strong, agree, fit, over = [], [], [], [], []
    seen = set()
    starts = sorted({p["at"] for p in placed})
    for p in placed:
        c = cache[p["key"]]
        pos = p["at"] + c["pos"]
        nxt = next((s_ for s_ in starts if s_ > p["at"]), 10 ** 9)
        if pos[-1] + 2 > nxt:
            over.append((p["at"] // BAR + 1, c["text"]))
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
    info = {"bpm": BPM, "key": "F major (bars 37-44 D minor) → G major (bar 53)", "bars": NBARS, "endStep": NBARS * BAR * 12, "head": HEAD,
            "modBar": MOD_BAR + 1, "sections": [{"name": s, "from": a + 1, "to": b} for s, a, b in SECS],
            "chords": [harm[i][0] + ("+2" if harm[i][1] else "") for i in range(NBARS * 2)],
            "measures": measures, "placed": out_placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(measures, ensure_ascii=False), "seconds", round(end / FS, 1))
    print("overlaps next line:", over)


if __name__ == "__main__":
    main()
