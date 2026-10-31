"""クッキー☆ 歌詞文字PV（notes-dande3.md）。伴奏まで Python で鳴らす。使い捨て。

UDK のピエロ嫌いを RU がからかう掛け合い。台詞は作者の手順（16分へ伸縮 → モーラごとにペンタ）。
和音は B♭M7–C7 の1小節ずつを最後まで替えない。台詞は前の台詞が終わった次の小節から置く（長い台詞は何小節でも使う）。
映像のために、台詞ごとに単語と鳴る16分を placement.json の words へ書き出す。
python -I dande3_build.py <outdir>   → song.wav・offset.txt・placement.json
"""
import json
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import pyopenjtalk  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import cookie_v1 as C  # noqa: E402
import techno1_build as T  # noqa: E402

FS = 44100
BPM = 150
SIX = 15 / BPM
BAR = 16
HEAD = 0.1
K = V.K
SRC = paths.WORK / "cookie_src"
WHO = {"RU": "RU姉貴", "UDK": "UDK姉貴"}


def v(who, name, text):
    return C.q(SRC / WHO[who] / f"{name}.wav", text)


# 区間ごとの台詞: (人, ファイル名, 読み)。None は1小節休む。同じ組の2つ目に "+" を付けると前と同時にしゃべる
BLOCKS = [
    ("intro", 8, []),
    ("A", None, [("UDK", "おーっすお願いします", "おーっすおねがいします"), ("RU", "今日もいい天気", "きょうもいいてんき"),
                 ("UDK", "ランランルー", "らんらんるー"), ("RU", "なにそれ", "なにそれ"),
                 ("UDK", "すいません私本当にピエロ駄目なんですよ。本当に嫌だからやめて！", "すいませんわたしほんとうにぴえろだめなんですよ、ほんとうにいやだからやめて"),
                 ("RU", "ホラホラー", "ほらほらー"), ("UDK", "やぁめぇてってだから！", "やあめえてってだから"), ("RU", "デュフフフフ", "でゅふふふふ")]),
    ("hook", 8, [("UDK", "ランランルー", "らんらんるー"), None, ("RU", "ホラホラー", "ほらほらー"), None,
                 ("UDK", "ランランルー", "らんらんるー"), None, ("RU", "皆踊れー！", "みんなおどれー"), None]),
    ("B", None, [("UDK", "ほんとにピエロが苦手で・・・ピエロが大嫌いなんですよ怖いんですよ", "ほんとにぴえろがにがてで、ぴえろがだいきらいなんですよこわいんですよ"),
                 ("RU", "怖いよーホモ怖いよ", "こわいよーほもこわいよ"),
                 ("UDK", "私ほんとピエロ苦手だってだからドナルドとかそのぽこたのあらやめてよぉ～", "わたしほんとぴえろにがてだってだからどなるどとかそのぽこたのあらやめてよお"),
                 ("RU", "ごめんなさい☆", "ごめんなさい"), ("UDK", "泣いちゃう、もう泣いちゃう", "ないちゃう、もうないちゃう"),
                 ("RU", "泣くとMADになりますから", "なくとまっどになりますから"), ("UDK", "違う私ここだ！", "ちがうわたしここだ"),
                 ("RU", "無限ループって怖くね？", "むげんるーぷってこわくね")]),
    ("brk", 4, [("RU", "今なんでもするって言ったよね？", "いまなんでもするっていったよね"), None, ("UDK", "嘘、ってオイ！", "うそっておい")]),
    ("hook2", 16, [("UDK", "ランランルー", "らんらんるー"), None, ("RU", "ホラホラー", "ほらほらー"), None,
                   ("UDK", "ゴーゴゴー", "ごーごごー"), None, ("RU", "皆踊れー！", "みんなおどれー"), None,
                   ("UDK", "ランランルー", "らんらんるー"), None, ("RU", "無限ループって怖くね？", "むげんるーぷってこわくね"), None,
                   ("UDK", "イエーイ", "いえーい"), ("+RU", "イエーイ", "いえーい")]),
    ("outro", 4, [("RU", "じゃあな！", "じゃあな")]),
]
# 声の楽器
LAN = v("UDK", "ランランルー", "らんらんるー")
AU = v("RU", "あう！", "あう")
PUHA = v("RU", "ぷはー", "ぷはー")

PENT = np.array([5, 7, 9, 0, 2])  # F メジャーペンタ
CH = {"BbM7": [58, 62, 65, 69], "C7": [48, 52, 55, 58]}
ROOT = {"BbM7": 46, "C7": 36}
LOOP = ["BbM7", "C7"]  # 1小節ずつ、最後まで
PAN = {"RU姉貴": (0.85, 0.45), "UDK姉貴": (0.45, 0.85)}


def t_of(s16):
    return HEAD + s16 * SIX


def place(buf, x, t, g=1.0):
    T.place(buf, x, t, g)


def pcs(name):
    return {n % 12 for n in CH[name]}


def words_of(text, n_snd):
    """表示用の単語と、その頭のモーラ番号（促音を除いた並びへ比例で写す）"""
    out, acc = [], 0
    feats = [f for f in pyopenjtalk.run_frontend(text) if f["string"].strip()]
    total = sum(max(f["mora_size"], 0) for f in feats) or 1
    for f in feats:
        s = f["string"].replace("・・・", "…")
        if f["mora_size"] <= 0 and out:  # 句読点・記号は前の語へつなぐ
            out[-1][0] += s
            continue
        out.append([s, min(n_snd - 1, int(acc * n_snd / total))])
        acc += f["mora_size"]
    return out


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = B.SIX = G.SIX = SIX
    every = [x for _, _, items in BLOCKS for x in items if x]
    clips = [v(w.lstrip("+"), n, t) for w, n, t in every] + [LAN, AU, PUHA]
    keys = {K(c): c for c in clips}
    V.SECTIONS = [("all", [(k, 1) for k in keys])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
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

    # 台詞を小節へ。固定長の区間は1小節ずつ（長ければ次の小節へ押す）、None 長の区間は前の台詞が終わった次の小節から
    lines, secs, bar = [], [], 0
    for name, nb, items in BLOCKS:
        start = bar
        prev_at = None
        for it in items:
            if it is None:
                bar += 1
                continue
            w, n, t = it
            c = cache[K(v(w.lstrip("+"), n, t))]
            if w.startswith("+"):
                lines.append((prev_at, c))
                continue
            lines.append((bar, c))
            prev_at = bar
            bar += max(1, math.ceil((c["pos"][-1] + 2) / BAR))
        if nb is not None:
            bar = max(bar, start + nb)
        else:
            bar = start + math.ceil((bar - start) / 4) * 4  # 4小節単位にそろえる
        secs.append((name, start, bar))
    NBARS = bar

    def sec_of(b):
        return next(s for s, a, e in secs if a <= b < e)

    placed, slot_notes = [], {}
    for at, c in lines:
        q = B.correct(c["midi"] + c["tr"], PENT)
        placed.append({"c": c, "at": at * BAR, "q": q, "sec": sec_of(at)})

    harm = [LOOP[b % 2] for b in range(NBARS)]
    N = int((t_of(NBARS * BAR) + 3.0) * FS)
    lay = {k: np.zeros(N) for k in ("kick", "snare", "hat", "rim", "bass", "keys", "pluck", "pad", "lan", "au")}
    PANL = {"au": (0.9, 0.4), "lan": (0.45, 0.9)}
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

    # 「ランランルー」を自分の抑揚どおりに弾く動機（ら・ん・ら・ん・る・ー を8分で）
    lc = cache[K(LAN)]
    lq = B.correct(lc["midi"] + lc["tr"], PENT)
    lq = np.where(np.isfinite(lq), lq, np.nanmedian(lq) if np.isfinite(lq).any() else 65)

    for b in range(NBARS):
        s = sec_of(b)
        base = b * BAR
        name = harm[b]
        notes = CH[name]
        root = ROOT[name]
        arp = sorted(notes) + [sorted(notes)[0] + 12]
        full = s in ("A", "hook", "B", "hook2")
        if s != "brk" or b == secs[-3][1]:
            offs = (0,) if s in ("intro", "outro", "brk") else (0, 3, 6, 10, 14)
            for off in offs:
                n = int((16 - off) * SIX * FS) if len(offs) == 1 else int(3 * SIX * FS)
                for m in notes:
                    place(lay["keys"], epiano(m + 12, n), t_of(base + off), 0.55 if off else 0.8)
        if s in ("intro", "hook", "hook2") or (s in ("A", "B") and b % 4 == 3):
            for k, m in enumerate(lq[:6]):  # ランランルーの動機
                place(lay["lan"], grain(LAN, k, m + 12, 1.6 * SIX), t_of(base + 2 * k), 0.75)
        if full:
            for k in (2, 6, 10, 14):
                place(lay["au"], grain(AU, 0, sorted(notes)[1] + 12, 0.8 * SIX), t_of(base + k), 0.5)
            for k in (0, 3, 6, 8, 11, 14):
                n = int(1.8 * SIX * FS)
                place(lay["bass"], T.lp(T.saw(T.hz(root + (12 if k in (6, 14) else 0)), n, (0, 5)), 900) * T.env(n, 0.003, 0.04), t_of(base + k))
        if s in ("hook", "hook2"):
            for k in range(0, 16, 2):
                place(lay["pluck"], pluck(arp[::-1][(k // 2) % 4] + 24, int(1.8 * SIX * FS)), t_of(base + k), 0.5)
            n = int(16 * SIX * FS)
            x = sum(T.saw(T.hz(m), n, (-12, 0, 12)) for m in notes) / 4
            place(lay["pad"], T.lp(x, 2600) * T.env(n, 0.08, 0.1), t_of(base))
        if s == "brk":  # 止める: 頭の小節だけ低く伸ばす
            if b == secs[-3][1]:
                n = int(16 * SIX * FS)
                place(lay["bass"], T.lp(T.saw(T.hz(root), n, (0, 4)), 300) * T.env(n, 0.05, 0.3), t_of(base), 0.8)

        # ドラム
        for p16 in range(16):
            t = t_of(base + p16)
            if full:
                if p16 % 4 == 0:
                    place(lay["kick"], kk, t)
                if p16 in (4, 12):
                    place(lay["snare"], cl, t, 0.9)
                    place(lay["rim"], rim, t)
                if p16 % 2 == 1:
                    place(lay["hat"], ch, t, 0.4)
                if p16 % 4 == 2:
                    place(lay["hat"], oh, t, 0.55 if s in ("hook", "hook2") else 0.35)
            elif s == "intro" and b >= 4 and p16 % 4 == 0:
                place(lay["kick"], kk, t, 0.7)
            elif s == "outro" and p16 == 0 and b == secs[-1][1]:
                place(lay["kick"], kk, t)
        if b in (secs[1][2] - 1, secs[3][2] - 1) or (s == "intro" and b == 7):  # 区間の終わりで連打
            for p16 in range(8, 16):
                place(lay["snare"], cl, t_of(base + p16), 0.3 + 0.08 * (p16 - 8))
        if s == "brk" and b == secs[-3][2] - 1:
            for p16 in range(0, 16):
                place(lay["snare"], cl, t_of(base + p16), 0.25 + 0.045 * p16)

    # 生の台詞
    VL, VR = np.zeros(N), np.zeros(N)
    out_placed = []
    for p in placed:
        c = p["c"]
        ratios = [2 ** ((a_ - b_) / 12) if np.isfinite(a_) and np.isfinite(b_) else 2 ** (c["tr"] / 12) for a_, b_ in zip(p["q"], c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        gl, gr = PAN[c["who"]]
        place(VL, x, t_of(p["at"]) + d0, gl)
        place(VR, x, t_of(p["at"]) + d0, gr)
        disp = Path(c["path"]).stem
        words = [{"w": w, "step": p["at"] + int(c["pos"][i])} for w, i in words_of(disp, len(c["pos"]))]
        out_placed.append({"bar": p["at"] / BAR + 1, "text": disp, "who": c["who"], "sec": p["sec"], "kind": "raw",
                           "len16": int(c["pos"][-1]) + 2, "words": words,
                           "morae": [p["at"] + int(x_) for x_ in c["pos"]], "file": str(c["path"])})

    # ミックス
    sc = np.ones(N)
    for b in range(NBARS):
        if sec_of(b) in ("A", "hook", "B", "hook2"):
            for b4 in range(4):
                a = int(t_of(b * BAR + b4 * 4) * FS)
                m = min(int(0.18 * FS), N - a)
                sc[a:a + m] = np.minimum(sc[a:a + m], 1 - 0.5 * np.exp(-np.arange(m) / FS / 0.06))
    gains = {"kick": 0.85, "snare": 0.35, "rim": 0.25, "hat": 0.3, "bass": 0.35, "keys": 0.10, "pluck": 0.12, "pad": 0.10,
             "lan": 0.24, "au": 0.2}
    duck = {"bass", "keys", "pluck", "pad", "lan", "au"}
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
    heads, strong, agree, fit = [], [], [], []
    for p in placed:
        c = p["c"]
        pos = p["at"] + c["pos"]
        heads.append(pos[0] % 4 == 0)
        thr = np.quantile(c["strength"], 0.75)
        strong += [pos[i] % 4 == 0 for i in range(len(pos)) if c["strength"][i] >= thr]
        for i in range(len(pos)):
            if np.isfinite(p["q"][i]):
                fit.append(int(round(p["q"][i])) % 12 in pcs(harm[int(pos[i]) // BAR]))
        mm, qq = c["midi"], p["q"]
        for i in range(1, len(mm)):
            if np.isfinite(mm[i]) and np.isfinite(mm[i - 1]) and abs(mm[i] - mm[i - 1]) >= 0.5:
                agree.append(int(np.sign(qq[i] - qq[i - 1]) * np.sign(mm[i] - mm[i - 1])))
    measures = {"phraseHeadOnBeat": round(float(np.mean(heads)), 2), "strong25OnBeat": round(float(np.mean(strong)), 2),
                "contourSame/flat/reversed": [agree.count(1), agree.count(0), agree.count(-1)],
                "melodyInChord": round(float(np.mean(fit)), 2),
                "voicedMorae": round(float(np.mean([np.isfinite(p["c"]["midi"]).mean() for p in placed])), 2)}
    info = {"bpm": BPM, "key": "F major, BbM7–C7 loop", "bars": NBARS, "endStep": NBARS * BAR * 12, "head": HEAD,
            "sections": [{"name": s, "from": a + 1, "to": e} for s, a, e in secs], "chords": harm,
            "measures": measures, "placed": out_placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(measures, ensure_ascii=False), "seconds", round(end / FS, 1), "bars", NBARS)
    print([(s, a + 1, e) for s, a, e in secs])


if __name__ == "__main__":
    main()
