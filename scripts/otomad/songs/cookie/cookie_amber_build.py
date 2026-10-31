"""クッキー☆ × 2号 amber型 1（notes-cookie-amber1.md）。samson_2go_build の型を 172 BPM のドラムンベースとセブンスの和音へ替え、RU姉貴の声だけを使う。使い捨て。

声の楽器の量・刻み・打楽器・台詞の数と並べ方・曲の形は samson2go1 と同じ。生の台詞だけ PSOLA で子音を残す。
python -I cookie_amber_build.py <outdir>
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

FS = 44100
BPM = 172
SIX = 15 / BPM
BAR = 192
NBARS = 76
K = V.K
PENT = {5, 7, 9, 0, 2}  # F メジャーペンタ（台詞の補正だけ。リードはテンションを踏む）
D = paths.WORK / "cookie_src" / "RU姉貴"
q = C.q
SOUDAYO = q(D / "そうだよ.wav", "そうだよ")
PUHA_TENKI = q(D / "ぷはー今日もいい天気.wav", "ぷはーきょうもいいてんき")
OMU = q(D / "オムライスが大好き.wav", "おむらいすがだいすき")
CARBO = q(D / "カルボナーラが好き.wav", "かるぼなーらがすき")
SHIRATAKI = q(D / "しらたきも大好き.wav", "しらたきもだいすき")
IKASUMI = q(D / "イカスミ焼き.wav", "いかすみやき")
KIRIBOSHI = q(D / "いいよね切り干し大根て.wav", "いいよねきりぼしだいこんて")
UMESHU = q(D / "梅酒うめーっしゅ.wav", "うめしゅうめーっしゅ")
TABESASE = q(D / "私も食べさせるー.wav", "わたしもたべさせるー")
KEKKONNE = q(D / "結婚ねいいよね結婚.wav", "けっこんねいいよねけっこん")
KEKKON = q(D / "じゃあ私結婚します.wav", "じゃあわたしけっこんします")
AA = q(D / "あー.wav", "あー")
UU = q(D / "うう～.wav", "うう")
VOO = q(D / "ヴぉー.wav", "ゔぉー")
TAMAGO = q(D / "たまごぉ.wav", "たまごぉ")
NYAN = q(D / "にゃんにゃんにゃん.wav", "にゃんにゃんにゃん")
WAN = q(D / "わんわんわん.wav", "わんわんわん")
PUHA = q(D / "ぷはー.wav", "ぷはー")
ALL = [SOUDAYO, PUHA_TENKI, OMU, CARBO, SHIRATAKI, IKASUMI, KIRIBOSHI, UMESHU, TABESASE, KEKKONNE, KEKKON,
       AA, UU, VOO, TAMAGO, NYAN, WAN, PUHA]

CH = {
    "FM7": [57, 60, 64, 65], "Gm7": [58, 62, 65, 67], "Am7": [57, 60, 64, 67], "BbM7": [57, 58, 62, 65],
    "Bbm6": [55, 58, 61, 65], "C7": [58, 60, 64, 67], "C7alt": [58, 63, 64, 68], "Dm7": [57, 60, 62, 65],
    "D7b9": [57, 60, 63, 66], "EbM7": [58, 62, 63, 67], "Em7b5": [58, 62, 64, 67], "A7": [57, 61, 64, 67],
    "Cm7": [58, 60, 63, 67], "F7": [57, 60, 63, 65], "Ab7": [56, 60, 63, 66],
}
ROOT = {"FM7": 41, "Gm7": 43, "Am7": 45, "BbM7": 46, "Bbm6": 46, "C7": 36, "C7alt": 36, "Dm7": 38, "D7b9": 38,
        "EbM7": 39, "Em7b5": 40, "A7": 45, "Cm7": 36, "F7": 41, "Ab7": 44}
VERSE = ["FM7", "FM7", "Em7b5", "A7", "Dm7", "Dm7", "Cm7", "F7"]  # IV への ii–V で終わる
HOOK_A = ["BbM7", "Am7", "Gm7", "C7", "FM7", "Dm7", "Gm7", "C7alt"]
HOOK_B = ["BbM7", "Bbm6", "Am7", "D7b9", "Gm7", "EbM7", "Gm7", "C7alt"]  # IV→iv・♭VII・オルタードで閉じる
HOOK_END = HOOK_B[:-1] + ["FM7"]
BRIDGE = ["Gm7", "C7", "Am7", "Dm7", "BbM7", "Bbm6", "Am7", "Ab7"]  # A♭7 は Gm7 への裏コード
OUTRO = ["FM7"] * 8


def n(p, l, m):
    return (p, l, m)


def T(p, ms):
    return (p, "T", ms)


A4, Bb4, C5, D5, Eb5, E5, F5, G5, Ab5, A5, Bb5 = 69, 70, 72, 74, 75, 76, 77, 79, 80, 81, 82
C6, Cs6, Db6, D6, Eb6, E6, F6, Fs6, G6, A6 = 84, 85, 85, 86, 87, 88, 89, 90, 91, 93

# 母音シンセのリフ（前奏・Aメロ）: 和音の3度・7度・9度を 3・3・2 で踏む
VSYN_RIFF = [
    n(0, 3, E5), n(3, 3, A5), n(6, 2, C6), n(8, 2, G5), n(10, 3, E5), n(13, 3, A4),
    n(16, 3, D5), n(19, 3, G5), n(22, 2, Bb5), n(24, 3, Cs6), n(27, 3, G5), n(30, 2, E5),
    n(32, 3, F5), n(35, 3, A5), n(38, 2, C6), n(40, 2, E6), n(42, 3, C6), n(45, 3, A5),
    n(48, 3, Eb5), n(51, 3, G5), n(54, 2, Bb5), n(56, 3, A5), n(59, 3, Eb6), n(62, 2, C6),
]
# サビ・ブリッジの母音シンセ: 和音の3度・7度の導音
GUIDE = {"FM7": 64, "Gm7": 65, "Am7": 67, "BbM7": 69, "Bbm6": 67, "C7": 64, "C7alt": 63, "Dm7": 65, "D7b9": 66,
         "EbM7": 67, "Em7b5": 62, "A7": 61, "Cm7": 63, "F7": 63, "Ab7": 66}
HOOK_MEL_A = [  # 手書き。和音ごとに 9度・長7度・♯9 などのテンションへ着地する
    n(0, 3, A5), n(3, 3, C6), n(6, 2, D6),
    n(8, 4, E6), n(12, 2, D6), n(14, 2, C6),
    n(16, 3, A5), n(19, 3, Bb5), n(22, 2, D6),
    n(24, 4, E6), n(28, 2, D6), n(30, 2, Bb5),
    n(32, 6, A5), n(38, 2, G5),
    n(40, 3, F5), n(43, 3, A5), n(46, 2, C6),
    n(48, 3, D6), n(51, 3, F6), n(54, 2, E6),
    n(56, 3, Eb6), n(59, 3, Ab5), n(62, 2, Bb5),
]
HOOK_MEL_B = [
    n(0, 3, D6), n(3, 3, F6), n(6, 2, A6),
    n(8, 4, G6), n(12, 2, F6), n(14, 2, Db6),
    n(16, 4, C6), n(20, 2, E6), n(22, 2, G6),
    n(24, 3, Fs6), n(27, 3, Eb6), n(30, 2, C6),
    n(32, 4, D6), n(36, 2, A5), n(38, 2, Bb5),
    n(40, 4, D6), n(44, 2, Bb5), n(46, 2, G5),
    n(48, 2, F5), n(50, 2, A5), n(52, 2, Bb5), n(54, 2, D6),
    n(56, 2, E6), n(58, 2, Eb6), n(60, 4, C6),
]
HOOK_MEL_END = HOOK_MEL_B[:-3] + [n(56, 8, E6)]  # FM7 の長7度で止める

BLOCKS = [(0, "intro"), (4, "intro2"), (8, "verse"), (12, "verse"), (16, "verse2"), (20, "verse2"),
          (24, "hookA"), (28, "hookB"), (32, "hookA"), (36, "hookB"),
          (40, "bridge"), (44, "bridge"), (48, "bridge"), (52, "bridge"),
          (56, "hookA"), (60, "hookB"), (64, "hookA"), (68, "hookBend"), (72, "outro")]
END_STEP = 72 * BAR + 96


def harm_of(kind):
    return {"hookA": HOOK_A, "hookB": HOOK_B, "hookBend": HOOK_END, "bridge": BRIDGE, "outro": OUTRO}.get(kind, VERSE)


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            return harm_of(kind)[((step - b0 * BAR) // 96) % 8]
    return "FM7"


# 生の台詞: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部)
RAW = [
    (24, 2, SOUDAYO, None),
    (41, 0, PUHA_TENKI, 1), (45, 0, PUHA_TENKI, 3), (49, 0, PUHA_TENKI, 5), (53, 0, PUHA_TENKI, None),
    (57, 0, OMU, None), (59, 0, CARBO, None), (61, 0, SHIRATAKI, None), (63, 0, IKASUMI, None),
    (65, 0, KIRIBOSHI, None), (67, 0, UMESHU, None), (69, 0, TABESASE, None), (71, 0, KEKKONNE, None),
    (74, 2, KEKKON, None),
]


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
        c["tr"] = float(np.clip(round(64.0 - med), -3, 3))  # 女声の真ん中へ

    # 母音シンセの音源は、生の台詞に使わない語から一番平らな芯を選ぶ
    names = [("あー", AA), ("うう", UU), ("うぉー", VOO), ("たまごぉ", TAMAGO)]
    cands = {k: G.stable_vowel(cache[K(cl)]["path"]) for k, cl in names}
    src_path = dict(names)
    ranked = sorted(cands, key=lambda k: cands[k][2])
    riff_src, guide_src = cands[ranked[0]], cands[ranked[1]]
    print("vowel sources", [(k, round(cands[k][2], 3)) for k in ranked])

    N = int((NBARS * 16 * SIX + 3) * FS)
    layer = {k: np.zeros(N) for k in ("vowel", "chop", "perc")}
    vraw = np.zeros(N)
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used = []
    vnotes = {"vowel": 0, "chop": 0, "perc": 0}

    # 音色を区間ごとに替える（上級者モードのトラックを重ねずに区間で分ける）。同じ鋸波のリードが全サビで鳴ると耳に痛く、単調になった
    tracks = {t: [] for t in ("t0", "t1", "t2", "t4", "t6", "t7", "t8", "t9", "t10")}
    prog = []
    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            notes = CH[name]
            if kind == "outro":
                if st < END_STEP:
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["FM7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 41})
                continue
            if kind in ("intro", "intro2", "bridge"):  # 172 BPM で鳴りっぱなしのパッドは壁になる。和音はエレピに任せる
                tracks["t10" if kind == "bridge" else "t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in notes]
            if kind not in ("intro",):
                if not (kind == "bridge" and b0 == 40):  # ブリッジの頭4小節はベースを抜く
                    # ドラムンベースのベース: 拍頭と、2拍目の8分裏のオクターブ上。どちらも短く切って低域を空ける
                    tracks["t4"].append({"startStep": st, "durationSteps": 30, "midi": ROOT[name]})
                    tracks["t4"].append({"startStep": st + 72, "durationSteps": 18, "midi": ROOT[name] + 12})
            if kind in ("verse", "verse2") or kind.startswith("hook"):
                # エレピは拍頭と、次の和音の16分前に食う
                comp = {"verse": "t7", "verse2": "t8"}.get(kind, "t9")  # ナイロンギター → エレピ1 → エレピ2
                tracks[comp] += [{"startStep": st, "durationSteps": 34, "midi": m + 12} for m in notes]
                tracks[comp] += [{"startStep": st + 84, "durationSteps": 10, "midi": m + 12} for m in notes]
            if kind.startswith("hook") or kind == "bridge":
                g = GUIDE[name]
                G.place(layer["vowel"], G.vsyn(guide_src, g, 5 * SIX - 0.02), t_of(st), 0.8)
                G.place(layer["vowel"], G.vsyn(guide_src, g + 12, 2 * SIX - 0.02, rel=0.03), t_of(st + 72), 0.5)
                vnotes["vowel"] += 2
        if kind.startswith("hook"):
            mel = {"hookA": HOOK_MEL_A, "hookB": HOOK_MEL_B, "hookBend": HOOK_MEL_END}[kind]
            # サビA はビブラフォン、サビB はフルート（1オクターブ下）、最後のサビは声のリード（1オクターブ下）を声の母音シンセで重ねる
            last = b0 >= 56
            lt, sh = ("t2", -12) if last else ("t0", 0) if kind == "hookA" else ("t1", -12)
            for p, l, m in mel:
                tracks[lt].append({"startStep": b0 * BAR + p * 12, "durationSteps": l * 12 - 2, "midi": m + sh, "orig": m})
                if last:
                    G.place(layer["vowel"], G.vsyn(riff_src, m - 12, l * SIX - 0.02), t_of(b0 * BAR + p * 12), 0.7)
                    vnotes["vowel"] += 1
        if kind in ("intro", "intro2", "verse", "verse2"):
            for p, l, m in VSYN_RIFF:
                G.place(layer["vowel"], G.vsyn(riff_src, m, l * SIX - 0.015), t_of(b0 * BAR + p * 12), 1.0)
                vnotes["vowel"] += 1
            used.append({"bar": b0 + 1, "text": f"（母音シンセのリフ: {ranked[0]} の母音）", "who": src_path[ranked[0]][0].parent.name, "file": str(src_path[ranked[0]][0]), "kind": "instrument"})
        if kind.startswith("hook") or kind == "bridge":
            used.append({"bar": b0 + 1, "text": f"（母音シンセの導音: {ranked[1]} の母音）", "who": src_path[ranked[1]][0].parent.name, "file": str(src_path[ranked[1]][0]), "kind": "instrument"})

    # 刻み: 「にゃ・ん」を16分に1粒ずつ（Aメロ2）、「わ」を8分裏（サビ）、「ぷはー」の「ぷ」をリム（2号の andesite と同じ使い方）
    kc = cache[K(NYAN)]
    wc = cache[K(WAN)]
    tc = cache[K(PUHA)]
    CHOP_A = [(0, 0), (3, 1), (6, 0), (8, 1), (11, 0), (14, 1)]
    for b0, kind in BLOCKS:
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind == "verse2":
                for p, mi in CHOP_A:
                    root = ROOT[chord_at(base + p * 12)] % 12
                    G.place(layer["chop"], G.chop(kc, mi, G.near(root + 12 * 4), 1.6 * SIX), t_of(base + p * 12), 0.9)
                    vnotes["chop"] += 1
            if kind.startswith("hook"):
                for p in (2, 6, 10, 14):
                    third = sorted(CH[chord_at(base + p * 12)])[1]
                    G.place(layer["chop"], G.chop(wc, 0, G.near(third, 60, 72), 1.0 * SIX), t_of(base + p * 12), 0.55)
                    vnotes["chop"] += 1
            if kind in ("verse", "verse2") or kind.startswith("hook"):
                for p in (4, 12):
                    G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 1.2)
                for p, g in ((7, 0.35), (10, 0.45), (15, 0.5)):  # ドラムンベースのゴースト
                    G.place(layer["perc"], G.burst(tc, 0, 0.04), t_of(base + p * 12), g)
                vnotes["perc"] += 5
            elif kind == "bridge" and bar >= 48:  # ブリッジ後半はリムだけで持ち上げる
                for p in (4, 12):
                    G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 0.9)
                vnotes["perc"] += 2
        if kind == "verse2":
            used.append({"bar": b0 + 1, "text": "（刻み: にゃ・ん を16分に1粒ずつ）", "who": Path(kc["path"]).parent.name, "file": str(kc["path"]), "kind": "chop"})
        if kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（刻み: わ を8分裏に）", "who": Path(wc["path"]).parent.name, "file": str(wc["path"]), "kind": "chop"})
        if kind in ("verse", "verse2") or kind.startswith("hook"):
            used.append({"bar": b0 + 1, "text": "（打楽器: ぷはー の「ぷ」の破裂）", "who": Path(tc["path"]).parent.name, "file": str(tc["path"]), "kind": "perc"})

    placed = []
    for bar, beat, clip, upto in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(2))
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        if upto is not None:
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        fr = np.abs(x) > 0.05 * np.abs(x).max()  # 台詞ごとの録音レベル差（5倍以上）をならす
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        G.place(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        text = c["text"] if upto is None else c["text"][:upto] + "…"
        placed.append({"bar": bar + beat / 4, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "transpose": tr, "kind": "raw"})

    vinst = sum(layer.values())
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    lead_all = sorted((x["startStep"], x["durationSteps"], x.pop("orig")) for t in ("t0", "t1", "t2") for x in tracks[t])
    daw = {"bpm": BPM, "drum": "break_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Vibraphone", "t1": "Flute", "t2": "Lead 6 (voice)", "t4": "Electric Bass (finger)", "t6": "Pad 2 (warm)",
                           "t7": "Acoustic Guitar (nylon)", "t8": "Electric Piano 1", "t9": "Electric Piano 2", "t10": "Pad 4 (choir)"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "F major", "bars": NBARS, "endStep": END_STEP, "blocks": prog,
            "vowelSources": ranked[:2], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(st / 12, d / 12, m) for st, d, m in lead_all]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
