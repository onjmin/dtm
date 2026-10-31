"""クッキー☆ × Plasticookie☆Adventure型 1（notes-plasti1.md）。MZ姉貴の声だけ。使い捨て。

前半（1〜40小節）は主旋律を声の音節で1音ずつ歌わせ、伴奏はレトロゲームの冒険曲。57小節目で半音上へ転調し、
主旋律を矩形波へ渡して、声は本人の淫夢語録の原液に替える（一転攻勢）。声の楽器・生の台詞の扱いは amber1 と同じ。
python -I plasti_build.py <outdir>
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import pyworld  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import psola_voice as P  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import cookie_v1 as C  # noqa: E402

FS = 44100
BPM = 132
SIX = 15 / BPM
BAR = 192
NBARS = 76
MOD_BAR = 56  # 0始まり。ここから半音上
K = V.K
D = paths.WORK / "cookie_src" / "MZ姉貴"
q = C.q
ODORE = q(D / "皆踊れー今日は宴会だぜ.wav", "みなおどれーきょうわえんかいだぜ")
MAGIC = q(D / "恋の媚薬まぜまぜよ.wav", "こいのびやくまぜまぜよ")
YUKKURI = q(D / "そーなのかー.wav", "そーなのかー")
KYUN = q(D / "キュン.wav", "きゅん")
PIKA = q(D / "ピカチュウ.wav", "ぴかちゅう")
VOO = q(D / "ヴォー.wav", "ゔぉー")
MEE = q(D / "メェ～.wav", "めえ")
HAAI = q(D / "はーい.wav", "はーい")
UUN = q(D / "うーん….wav", "うーん")
IKUZO = q(D / "じゃいくぞ.wav", "じゃいくぞ")
KARITE = q(D / "借りてくぜーい.wav", "かりてくぜーい")
# 一転攻勢の後は本物の淫夢素材。演者は野獣先輩（第4章）ひとりにそろえる
Y = (paths.MATERIAL / "淫夢/淫夢SPパック_分割⑤/第４章「昏睡レイプ！野獣と化した先輩」/野獣")
ICETEA = q(Y / "野獣「アイスティーしかなかったけど良いかな？」.wav", "あいすてぃーしかなかったけどいいかな")
OMATASE = q(Y / "野獣「おまたせ」.wav", "おまたせ")
KOKO = q(Y / "野獣「こ↑こ↓」.wav", "ここ")
WAKAN = q(Y / "野獣「これもうわかんねぇな」.wav", "これもうわかんねえな")
TASHO = q(Y / "野獣「ま、多少はね？」.wav", "ま、たしょうはね")
DOUZO = q(Y / "野獣「入って、どうぞ」.wav", "はいって、どうぞ")
KUIARA = q(Y / "野獣「悔い改めて」.wav", "くいあらためて")
DAIJOBU = q(Y / "野獣「大丈夫でしょ」.wav", "だいじょうぶでしょ")
SUKI = q(Y / "野獣「お前のことが好きだったんだよ！(迫真)」.wav", "おまえのことがすきだったんだよ")
FA = q(Y / "野獣「ファッ！？」.wav", "ふぁっ")
ALL = [ODORE, MAGIC, YUKKURI, KYUN, PIKA, VOO, MEE, HAAI, UUN, IKUZO, KARITE,
       ICETEA, OMATASE, KOKO, WAKAN, TASHO, DOUZO, KUIARA, DAIJOBU, SUKI, FA]

CH = {
    "DM7": [62, 66, 69, 73], "F#m7": [61, 64, 66, 69], "Bm7": [62, 66, 69, 71], "A7": [61, 64, 67, 69],
    "GM7": [62, 66, 67, 71], "Em7": [62, 64, 67, 71], "F#7": [61, 64, 66, 70], "D7": [60, 62, 66, 69],
    "Cm7": [60, 63, 67, 70], "Bb7": [58, 62, 65, 68],
}
ROOT = {"DM7": 38, "F#m7": 42, "Bm7": 35, "A7": 33, "GM7": 43, "Em7": 40, "F#7": 42, "D7": 38, "Cm7": 36, "Bb7": 34}
HOOK1 = ["DM7", "A7", "Bm7", "F#m7", "GM7", "DM7", "Em7", "A7"]
HOOK2 = ["GM7", "A7", "F#m7", "Bm7", "Em7", "A7", "DM7", "D7"]
HOOK_END = HOOK2[:6] + ["DM7", "DM7"]
VERSE = ["DM7", "F#m7", "Bm7", "A7", "GM7", "F#m7", "Em7", "A7"]
PRE = ["GM7", "A7", "F#m7", "Bm7", "Em7", "F#7", "GM7", "A7"]
BRK = ["Bm7", "Bm7", "GM7", "GM7", "Em7", "Em7", "F#7", "F#7"]  # 明るさを抜く。2小節ずつ
BRK2A = ["GM7", "A7", "F#m7", "Bm7", "Em7", "A7", "Em7", "A7"]
BRK2B = BRK2A[:6] + ["Cm7", "Bb7"]  # E♭ への ii–V
OUTRO = ["DM7"] * 8


def n(p, l, m):
    return (p, l, m)


# 旋律はすべて手書き（D メジャー、16分単位）。声が歌うので A4〜D6 に収める
VMEL = [  # Aメロ: 8分中心で語るように
    n(0, 2, 74), n(2, 2, 76), n(4, 4, 78), n(8, 2, 81), n(10, 2, 78), n(12, 4, 76),
    n(16, 2, 74), n(18, 2, 73), n(20, 4, 74), n(24, 2, 76), n(26, 2, 73), n(28, 4, 69),
    n(32, 2, 71), n(34, 2, 74), n(36, 4, 78), n(40, 2, 76), n(42, 2, 74), n(44, 4, 73),
    n(48, 2, 71), n(50, 2, 74), n(52, 4, 79), n(56, 6, 76), n(62, 2, 69),
]
PMEL = [  # Bメロ: 同じ音の16分連打で駆け上がる
    n(0, 1, 78), n(1, 1, 78), n(2, 2, 78), n(4, 2, 79), n(6, 2, 81),
    n(8, 1, 76), n(9, 1, 76), n(10, 2, 76), n(12, 2, 78), n(14, 2, 81),
    n(16, 1, 81), n(17, 1, 81), n(18, 2, 81), n(20, 2, 80), n(22, 2, 85),
    n(24, 2, 83), n(26, 2, 81), n(28, 4, 78),
    n(32, 1, 79), n(33, 1, 79), n(34, 2, 79), n(36, 2, 81), n(38, 2, 83),
    n(40, 2, 82), n(42, 2, 85), n(44, 4, 82),
    n(48, 2, 83), n(50, 2, 86), n(52, 4, 83), n(56, 2, 81), n(58, 2, 83), n(60, 4, 85),
]
HMEL1 = [
    n(0, 2, 78), n(2, 2, 81), n(4, 2, 83), n(6, 2, 81),
    n(8, 3, 85), n(11, 3, 81), n(14, 2, 76),
    n(16, 3, 78), n(19, 3, 74), n(22, 2, 73),
    n(24, 4, 81), n(28, 2, 78), n(30, 2, 76),
    n(32, 2, 74), n(34, 2, 76), n(36, 2, 78), n(38, 2, 81),
    n(40, 3, 83), n(43, 3, 81), n(46, 2, 78),
    n(48, 3, 79), n(51, 3, 78), n(54, 2, 76),
    n(56, 4, 73), n(60, 2, 76), n(62, 2, 81),
]
HMEL2 = [
    n(0, 3, 83), n(3, 3, 81), n(6, 2, 78),
    n(8, 2, 81), n(10, 2, 83), n(12, 2, 85), n(14, 2, 86),
    n(16, 4, 85), n(20, 2, 81), n(22, 2, 78),
    n(24, 3, 78), n(27, 3, 81), n(30, 2, 86),
    n(32, 3, 83), n(35, 3, 79), n(38, 2, 76),
    n(40, 2, 76), n(42, 2, 78), n(44, 2, 79), n(46, 2, 85),
    n(48, 6, 81), n(54, 2, 78),
    n(56, 3, 72), n(59, 3, 78), n(62, 2, 84),
]
HMEL_END = HMEL2[:-5] + [n(48, 4, 81), n(52, 4, 78), n(56, 8, 74)]

BLOCKS = [(0, "intro"), (4, "intro2"), (8, "verse"), (12, "verse"), (16, "pre"), (20, "pre"),
          (24, "hook1"), (28, "hook2"), (32, "hook1"), (36, "hookEnd"),
          (40, "brk"), (44, "brk"), (48, "brk2a"), (52, "brk2b"),
          (56, "hook1"), (60, "hook2"), (64, "hook1"), (68, "hookEnd"), (72, "outro")]
END_STEP = 72 * BAR + 96
HARM = {"intro": HOOK1, "intro2": HOOK1, "verse": VERSE, "pre": PRE, "hook1": HOOK1, "hook2": HOOK2, "hookEnd": HOOK_END,
        "brk": BRK, "brk2a": BRK2A, "brk2b": BRK2B, "outro": OUTRO}
MEL = {"verse": VMEL, "pre": PMEL, "hook1": HMEL1, "hook2": HMEL2, "hookEnd": HMEL_END}


def tr_of(bar):
    return 1 if bar >= MOD_BAR else 0


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            return HARM[kind][((step - b0 * BAR) // 96) % 8]
    return "DM7"


def sing(c, mi, midi, dur):
    """音節 mi を子音頭から歌う1音: 子音と母音の入りはそのまま、母音の一番平らな 60ms を往復で伸ばし、f0 を midi に貼る。"""
    f0, sp, ap = G.world(c["path"])
    m = c["snd"][mi]
    a = int(max(0, m["start"] - 0.005) * 200)
    b = min(len(f0), max(a + 6, int(m["end"] * 200)))
    vo = [i for i in range(a, b) if f0[i] > 0]
    if len(vo) < 6:
        return level(G.chop(c, mi, midi, dur))
    w = min(12, len(vo))
    best = min(range(len(vo) - w + 1), key=lambda j: float(np.std(np.log(f0[vo[j]:vo[j] + w] + 1e-9))) if f0[vo[j]:vo[j] + w].min() > 0 else 9)
    ws = vo[best]
    nf = max(6, int(dur * 200))
    head = list(range(a, min(ws, a + nf)))
    loop = []
    k = 0
    while len(head) + len(loop) < nf:
        j = k % (2 * w - 2)
        loop.append(ws + (j if j < w else 2 * w - 2 - j))
        k += 1
    idx = np.array(head + loop)
    f = f0[idx].copy()
    tt = np.arange(len(idx)) / 200
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * tt) * np.clip((tt - 0.18) / 0.15, 0, 1)
    f[len(head):] = 1.0
    f = np.where(f > 0, G.hz(midi) * vib, 0.0)
    x = pyworld.synthesize(f, sp[idx].copy(), ap[idx].copy(), FS, 5.0)
    r = min(len(x) // 2, int(0.035 * FS))
    x[-r:] *= np.linspace(1, 0, r)
    x[:64] *= np.linspace(0, 1, 64)
    return level(x)


def level(x, target=0.1, cap=8.0):
    """音節ごとの録音レベル差（語尾の「ー」は10分の1ほど）をならす。息だけの粒を持ち上げすぎないよう上限つき。"""
    e = np.sqrt(np.convolve(x ** 2, np.ones(512) / 512, mode="same"))
    loud = e[e >= np.percentile(e, 50)]
    return x * min(cap, target / max(float(loud.mean()), 1e-9))


# 生の台詞: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部)
RAW = [
    (17, 0, IKUZO, None), (40, 2, KARITE, None),
    (41, 0, ICETEA, 2), (45, 0, ICETEA, 5), (49, 0, ICETEA, 9), (53, 0, ICETEA, None),  # 「ん？」: 少しずつ分かる
    (57, 0, OMATASE, None), (59, 0, KOKO, None), (61, 0, WAKAN, None), (63, 0, TASHO, None),
    (65, 0, DOUZO, None), (67, 0, KUIARA, None), (69, 0, DAIJOBU, None), (71, 0, SUKI, None),
    (74, 2, FA, None),
]
LYRIC = {"verse": MAGIC, "pre": YUKKURI, "hook1": ODORE, "hook2": ODORE, "hookEnd": ODORE}


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    G.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(64.0 - med), -3, 3))

    names = [("うぉー", VOO), ("めえ", MEE), ("はーい", HAAI), ("うーん", UUN)]
    cands = {k: G.stable_vowel(cache[K(cl)]["path"]) for k, cl in names}
    src_path = dict(names)
    ranked = sorted(cands, key=lambda k: cands[k][2])
    riff_src, guide_src = cands[ranked[0]], cands[ranked[1]]
    print("vowel sources", [(k, round(cands[k][2], 3)) for k in ranked])

    N = int((NBARS * 16 * SIX + 3) * FS)
    layer = {k: np.zeros(N) for k in ("sing", "vowel", "chop", "perc")}
    vraw = np.zeros(N)
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used = []
    vnotes = {k: 0 for k in layer}
    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t8": []}
    prog = []
    for b0, kind in BLOCKS:
        harm = HARM[kind]
        tr = tr_of(b0)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm, "transpose": tr})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            notes = [m + tr for m in CH[name]]
            root = ROOT[name] + tr
            if kind == "outro":
                if st < END_STEP:
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in notes]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": root})
                    tracks["t7"] += [{"startStep": st, "durationSteps": 46, "midi": m + 12} for m in notes]
                continue
            if kind in ("intro", "brk"):
                tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in notes]
            if kind != "intro" and not (kind == "brk" and b0 == 40):
                # レトロ音源のベース: 8分でルートとオクターブ上を交互に
                for e in range(4):
                    tracks["t4"].append({"startStep": st + e * 24, "durationSteps": 20, "midi": root + (12 if e % 2 else 0)})
            if kind in ("verse", "pre", "brk2a", "brk2b") or kind.startswith("hook"):
                # エレピは拍頭と2拍目の裏（8分のシンコペーション）
                tracks["t7"] += [{"startStep": st, "durationSteps": 20, "midi": m + 12} for m in notes]
                tracks["t7"] += [{"startStep": st + 60, "durationSteps": 20, "midi": m + 12} for m in notes]
            if kind in ("intro2", "pre", "brk2b") or kind.startswith("hook"):
                # 木琴の16分アルペジオ（和音を上がって下りる）
                arp = sorted(m + 12 for m in notes)
                pat = arp + [arp[0] + 12] + arp[::-1][:3]
                for s in range(8):
                    tracks["t8"].append({"startStep": st + s * 12, "durationSteps": 10, "midi": pat[s % len(pat)]})
            if kind in ("intro", "intro2", "brk2a", "brk2b"):
                # 母音シンセのリフ: 和音の 3度・5度・7度 を 3・3・2 で
                tones = sorted(notes)[1:] if len(notes) > 3 else notes
                for p, l, m in ((0, 3, tones[0] + 12), (3, 3, tones[1] + 12), (6, 2, tones[2] + 12)):
                    G.place(layer["vowel"], G.vsyn(riff_src, m, l * SIX - 0.015), t_of(st + p * 12), 1.0)
                    vnotes["vowel"] += 1
            if kind == "brk" or (kind.startswith("hook") and b0 >= MOD_BAR):
                g = sorted(notes)[1]
                G.place(layer["vowel"], G.vsyn(guide_src, g + 12, (8 if kind == "brk" else 5) * SIX - 0.02), t_of(st), 0.7)
                vnotes["vowel"] += 1
        if kind in MEL:
            mel = MEL[kind]
            if b0 < MOD_BAR:  # 前半は声が歌う
                lc = cache[K(LYRIC[kind])]
                ns = len(lc["snd"])
                for j, (p, l, m) in enumerate(mel):
                    G.place(layer["sing"], sing(lc, j % ns, m + tr, l * SIX - 0.01), t_of(b0 * BAR + p * 12), 1.0)
                    vnotes["sing"] += 1
                used.append({"bar": b0 + 1, "text": f"（歌: {lc['text']} の音節を1音ずつ）", "who": D.name, "file": str(lc["path"]), "kind": "sing"})
            else:  # 一転攻勢: 旋律は矩形波へ
                for p, l, m in mel:
                    tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m + tr})

    # 刻み: 「キュン」をサビの8分裏に（和音の3度）、「ぴ」を2・4拍のリム、Bメロ以降は16分のゴースト
    kc, pc, fc = cache[K(KYUN)], cache[K(PIKA)], cache[K(FA)]
    for b0, kind in BLOCKS:
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind.startswith("hook") or kind == "brk2b":
                for p in (2, 6, 10, 14):
                    third = sorted(CH[chord_at(base + p * 12)])[1] + tr_of(bar)
                    if bar >= MOD_BAR:  # 一転攻勢: 刻みも野獣の「ファッ」へ
                        G.place(layer["chop"], level(G.chop(fc, 0, G.near(third, 52, 64), 1.0 * SIX)), t_of(base + p * 12), 0.35)
                    else:
                        G.place(layer["chop"], G.chop(kc, 0, G.near(third, 64, 76), 1.0 * SIX), t_of(base + p * 12), 0.5)
                    vnotes["chop"] += 1
            if kind in ("verse", "pre", "brk2a", "brk2b") or kind.startswith("hook"):
                for p in (4, 12):
                    G.place(layer["perc"], G.burst(pc, 0), t_of(base + p * 12), 1.1)
                vnotes["perc"] += 2
                if kind != "verse":
                    for p, g in ((7, 0.3), (14, 0.35), (15, 0.45)):
                        G.place(layer["perc"], G.burst(pc, 0, 0.04), t_of(base + p * 12), g)
                    vnotes["perc"] += 3
        if kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（刻み: キュン を8分裏に）", "who": D.name, "file": str(kc["path"]), "kind": "chop"})
        if kind in ("intro", "intro2", "brk2a", "brk2b"):
            used.append({"bar": b0 + 1, "text": f"（母音シンセのリフ: {ranked[0]}）", "who": D.name, "file": str(src_path[ranked[0]][0]), "kind": "instrument"})

    placed = []
    for bar, beat, clip, upto in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        qq = B.correct(c["midi"] + tr, np.array([(x + tr_of(bar - 1)) % 12 for x in (2, 4, 6, 9, 11)]))  # D メジャーペンタ（転調後は E♭）
        ratios = [2 ** ((a - m) / 12) if np.isfinite(a) and np.isfinite(m) else 2 ** (tr / 12) for a, m in zip(qq, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        if upto is not None:
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        G.place(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        text = c["text"] if upto is None else c["text"][:upto] + "…"
        placed.append({"bar": bar + beat / 4, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "transpose": tr, "kind": "raw"})

    # 歌は声の楽器の中で一番前に出す
    layer["sing"] *= 1.6
    vinst = sum(layer.values())
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    daw = {"bpm": BPM, "drum": "16beat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)",
                           "t7": "Electric Piano 1", "t8": "Xylophone"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "D major → E♭ major (bar 57)", "bars": NBARS, "endStep": END_STEP, "modBar": MOD_BAR + 1,
            "blocks": prog, "vowelSources": ranked[:2], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    lead = [(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]
    np.save(outdir / "lead.npy", np.array(lead))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
