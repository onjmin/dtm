"""クッキー☆ × Plasticookie☆Adventure型 2（notes-plasti1.md の「plasti2」）。台詞イントネーション作曲に組み直した版。使い捨て。

plasti1 は主旋律を母音の伸ばしで鳴らしていて「ただのシンセ」だった。ここでは作者の手順どおり、台詞を丸ごと
16分へ伸縮（強い音節を拍頭へ）→ モーラごとに音の中心をペンタへ（揺れは残す）→ 採譜 → 旋律から2拍ごとの和音、とする。
前半は MZ姉貴の台詞、57小節目から E♭ へ上げて野獣先輩（第4章）の台詞（一転攻勢）。
python -I plasti2_build.py <outdir>
"""
import json
import math
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
import plasti_build as PB  # noqa: E402

FS = 44100
BPM = 132
SIX = 15 / BPM
BAR = 16  # 16分単位
NBARS = 76
MOD_BAR = 56  # 0始まり。ここから半音上
K = V.K
q = C.q
D = PB.D
Y = PB.Y


def m(name, text):
    return q(D / f"{name}.wav", text)


def y(name, text):
    return q(Y / f"野獣「{name}」.wav", text)


HELLO = m("こんにちは", "こんにちわ")
YOROSHIKU = m("宜しくお願いします", "よろしくおねがいします")
MAGIC = m("うちマジックアイテムあるけど寄ってかない？", "うちまじっくあいてむあるけどよってかない")
BROWNIE = m("やっぱアリスの作るブラウニーは美味いな", "やっぱありすのつくるぶらうにーわうまいな")
VANHOU = m("さっき冷蔵庫開けたらバンホーテンあった", "さっきれいぞうこあけたらばんほーてんあった")
VANHOU2 = m("バンホーテン美味しいよ", "ばんほーてんおいしいよ")
RAMEN = m("ラーメン食べたい", "らーめんたべたい")
SAMUI = m("寒い夜にはラーメン", "さむいよるにわらーめん")
IKUZO = m("じゃいくぞ", "じゃいくぞ")
KARITE = m("借りてくぜーい", "かりてくぜーい")
KISEKI = m("奇跡も魔法もあるんだよ", "きせきもまほうもあるんだよ")
NIDAIME = m("そうだぜ私が二代目の霧雨魔理沙なんだぜ", "そうだぜわたしがにだいめのきりさめまりさなんだぜ")
KONEKO = m("私は子猫じゃないんだぜ", "わたしわこねこじゃないんだぜ")
ODORE = m("皆踊れー今日は宴会だぜ", "みなおどれーきょうわえんかいだぜ")
SOUNANO = m("そーなのかー", "そーなのかー")
SUWAWA = m("すわわっ！", "すわわっ")
MONDAI = m("大丈夫だ、問題ない", "だいじょうぶだもんだいない")
KOI = m("恋の媚薬まぜまぜよ", "こいのびやくまぜまぜよ")
BAIBAI = m("ばいばーい", "ばいばーい")
KYUN = m("キュン", "きゅん")
PIKA = m("ピカチュウ", "ぴかちゅう")
ICETEA = y("アイスティーしかなかったけど良いかな？", "あいすてぃーしかなかったけどいいかな")
OMATASE = y("おまたせ", "おまたせ")
KOKO = y("こ↑こ↓", "ここ")
WAKAN = y("これもうわかんねぇな", "これもうわかんねえな")
TASHO = y("ま、多少はね？", "ま、たしょうはね")
DOUZO = y("入って、どうぞ", "はいって、どうぞ")
KUIARA = y("悔い改めて", "くいあらためて")
DAIJOBU = y("大丈夫でしょ", "だいじょうぶでしょ")
SUKI = q(Y / "野獣「お前のことが好きだったんだよ！(迫真)」.wav", "おまえのことがすきだったんだよ")
FA = y("ファッ！？", "ふぁっ")

# (区間, 頭の小節(1始まり), 終わりの小節(含まない), [(台詞, 小節頭に置くか, 先頭からのモーラ数 None=全部)])
# 区間の中は前の台詞の後ろへ半小節単位で詰め、はみ出す台詞は捨てる
T = (ODORE, True, None)
PLAN = [
    ("intro", 5, 9, [(HELLO, True, None), (YOROSHIKU, True, None)]),
    ("verse", 9, 17, [(MAGIC, True, None), (BROWNIE, False, None), (VANHOU, True, None), (VANHOU2, False, None),
                      (RAMEN, True, None), (SAMUI, False, None)]),
    ("pre", 17, 25, [(IKUZO, True, None), (KARITE, False, None), (KISEKI, True, None), (KONEKO, False, None),
                     (NIDAIME, True, None)]),
    ("hook", 25, 41, [T, (SOUNANO, False, None), T, (SUWAWA, False, None), T, (MONDAI, False, None), T, (KOI, False, None),
                      T, (SOUNANO, False, None), T, (BAIBAI, False, None)]),
    ("brk", 41, 57, [(ICETEA, True, 2), (ICETEA, True, 5), (ICETEA, True, 9), (ICETEA, True, None)]),
    ("twist", 57, 73, [(OMATASE, True, None), (KOKO, True, None), (WAKAN, True, None), (TASHO, True, None),
                       (DOUZO, True, None), (KUIARA, True, None), (DAIJOBU, True, None), (SUKI, True, None)]),
]
GAPS = {"brk": 4, "twist": 2}  # この区間は台詞を n 小節ごとに置く（ため・一転攻勢は間を空ける）
LEAD = {"hook": lambda c: c is ODORE, "twist": lambda c: True}  # 採譜した旋律を矩形波で重ねる区間と台詞
CENTER = {"MZ姉貴": 66.0, "野獣": 57.0}
END_STEP16 = 72 * BAR + 8

CH = PB.CH
ROOT = PB.ROOT
VOCAB = ["DM7", "Em7", "F#m7", "GM7", "A7", "Bm7"]  # D メジャーの全音階のセブンス


def pcs(name, tr):
    return {(n + tr) % 12 for n in CH[name]}


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    G.SIX = SIX
    keys = {}
    for _s, _a, _b, items in PLAN:
        for c, _, _ in items:
            keys[K(c)] = c
    for c in (KYUN, PIKA, FA):
        keys[K(c)] = c
    V.SECTIONS = [("all", [(k, 1) for k in keys])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        who = Path(c["path"]).parent.name
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else CENTER[who]
        c["tr"] = float(np.clip(round(CENTER[who] - med), -3, 3))

    # 台詞の配置（16分）
    placed = []
    for sec, a, b, items in PLAN:
        cur, start, end = (a - 1) * BAR, (a - 1) * BAR, (b - 1) * BAR
        for j, (clip, on_bar, upto) in enumerate(items):
            c = cache[K(clip)]
            if sec in GAPS:
                at = start + j * GAPS[sec] * BAR
            else:
                at = math.ceil(cur / (BAR if on_bar else 8)) * (BAR if on_bar else 8)
            n = len(c["pos"]) if upto is None else upto
            last = at + int(c["pos"][n - 1]) + 2
            if last > end:
                print("skip", sec, c["text"])
                continue
            placed.append({"key": K(clip), "at": at, "sec": sec, "upto": upto, "tr": 1 if at >= MOD_BAR * BAR else 0})
            cur = last + 1

    # モーラごとにペンタへ（D メジャーペンタ＝最後の音を主音にした B マイナーペンタと同じ音。転調後は半音上）
    melody, slot_notes = [], {}
    for p in placed:
        c = cache[p["key"]]
        pent = np.array([(x + p["tr"]) % 12 for x in (2, 4, 6, 9, 11)])
        qq = B.correct(c["midi"] + c["tr"], pent)
        p["q"] = qq
        n = len(c["pos"]) if p["upto"] is None else p["upto"]
        for i in range(n):
            if not np.isfinite(qq[i]):
                continue
            pos = p["at"] + int(c["pos"][i])
            w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            slot_notes.setdefault(pos // 8, []).append((qq[i], w))
            if p["sec"] in LEAD and LEAD[p["sec"]](keys[p["key"]]):
                melody.append({"pos16": pos, "len16": int(min(max(w, 1), 4)), "midi": float(qq[i])})

    # 和音は旋律から: 2拍ごとに、旋律の音が構成音に入る重み＋手書きの進行への寄り
    harm = []
    for slot in range(NBARS * 2):
        bar = slot // 2
        kind = next(k for b0, k in PB.BLOCKS if b0 <= bar < b0 + 4) if bar < 76 else "outro"
        default = PB.HARM[kind][(slot - next(b0 for b0, k in PB.BLOCKS if b0 <= bar < b0 + 4) * 2) % 8] if bar < 76 else "DM7"
        tr = 1 if bar >= MOD_BAR else 0
        notes = slot_notes.get(slot, [])
        if not notes or kind in ("outro",) or default in ("Cm7", "Bb7", "F#7", "D7"):
            harm.append((default, tr))
            continue
        best = max(VOCAB, key=lambda nm: sum(w * (1 if int(round(mm)) % 12 in pcs(nm, tr) else -1) for mm, w in notes)
                   + (1.5 if nm == default else 0))
        harm.append((best, tr))

    # 伴奏
    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t8": [], "t9": [], "t10": []}
    for slot, (name, tr) in enumerate(harm):
        st = slot * 96
        if st >= END_STEP16 * 12:
            break
        bar = slot // 2
        kind = next(k for b0, k in PB.BLOCKS if b0 <= bar < b0 + 4)
        notes = [x + tr for x in CH[name]]
        root = ROOT[name] + tr
        if kind == "outro":
            tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": x} for x in notes]
            tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": root})
            tracks["t7"] += [{"startStep": st, "durationSteps": 46, "midi": x + 12} for x in notes]
            continue
        if kind in ("intro", "brk"):
            tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": x} for x in notes]
        if bar >= MOD_BAR:
            for e in range(8):
                tracks["t4"].append({"startStep": st + e * 12, "durationSteps": 10, "midi": root + (12 if e % 2 else 0)})
            for e in range(4):
                tracks["t9"] += [{"startStep": st + e * 24, "durationSteps": 14, "midi": x + 12} for x in notes]
            arp = sorted(x + 24 for x in notes)
            for s16 in range(8):
                tracks["t10"].append({"startStep": st + s16 * 12, "durationSteps": 10, "midi": arp[(s16 * 3) % 4]})
        elif kind != "intro" and not (kind == "brk" and bar < 44):
            for e in range(4):
                tracks["t4"].append({"startStep": st + e * 24, "durationSteps": 20, "midi": root + (12 if e % 2 else 0)})
        if kind in ("verse", "pre", "brk2a", "brk2b") or kind.startswith("hook"):
            tracks["t7"] += [{"startStep": st, "durationSteps": 20, "midi": x + 12} for x in notes]
            tracks["t7"] += [{"startStep": st + 60, "durationSteps": 20, "midi": x + 12} for x in notes]
        if kind in ("intro2", "pre", "brk2b") or kind.startswith("hook"):
            arp = sorted(x + 12 for x in notes)
            pat = arp + [arp[0] + 12] + arp[::-1][:3]
            for s in range(8):
                tracks["t8"].append({"startStep": st + s * 12, "durationSteps": 10, "midi": pat[s % len(pat)]})
    for n in melody:
        tracks["t0"].append({"startStep": n["pos16"] * 12, "durationSteps": n["len16"] * 12 - 2, "midi": int(round(n["midi"])) + 12})

    # 台詞の声（主役）
    N = int((NBARS * BAR * SIX + 3) * FS)
    vraw = np.zeros(N)
    out_placed = []
    for p in placed:
        c = cache[p["key"]]
        ratios = [2 ** ((a - b) / 12) if np.isfinite(a) and np.isfinite(b) else 2 ** (c["tr"] / 12) for a, b in zip(p["q"], c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        if p["upto"] is not None and p["upto"] < len(c["pos"]):
            cut = int((c["pos"][p["upto"]] * SIX - d0) * FS)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        G.place(vraw, x, p["at"] * SIX + d0)
        text = c["text"] if p["upto"] is None else c["text"][:p["upto"]] + "…"
        out_placed.append({"bar": p["at"] / BAR + 1, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]),
                           "transpose": c["tr"], "kind": "raw", "sec": p["sec"],
                           "len16": int(c["pos"][(p["upto"] or len(c["pos"])) - 1]) + 2})
    # 落とし: 曲を切った後に「ファッ！？」（音程は付けない）
    fc = cache[K(FA)]
    x, d0 = P.line(fc, fc["pos"] * SIX, [1.0] * len(fc["pos"]))
    fr = np.abs(x) > 0.05 * np.abs(x).max()
    x = x * (0.12 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
    G.place(vraw, x, (73 * BAR + 8) * SIX + d0)
    out_placed.append({"bar": 74.5, "text": fc["text"], "who": "野獣", "file": str(fc["path"]), "transpose": 0, "kind": "raw", "sec": "end", "len16": 4})

    # 声の刻み・打楽器（前半は「キュン」、一転攻勢から「ファッ」）
    layer = {k: np.zeros(N) for k in ("chop", "perc")}
    kc, pc, yc = cache[K(KYUN)], cache[K(PIKA)], cache[K(KOKO)]
    t_of = lambda s16: s16 * SIX  # noqa: E731
    for bar in range(72):
        kind = next(k for b0, k in PB.BLOCKS if b0 <= bar < b0 + 4)
        base = bar * BAR
        if kind.startswith("hook"):
            for p16 in (2, 6, 10, 14):
                name, tr = harm[(base + p16) // 8]
                third = sorted(CH[name])[1] + tr
                if bar >= MOD_BAR:
                    G.place(layer["chop"], PB.level(G.chop(fc, 0, G.near(third, 52, 64), 1.0 * SIX)), t_of(base + p16), 0.3)
                else:
                    G.place(layer["chop"], G.chop(kc, 0, G.near(third, 64, 76), 1.0 * SIX), t_of(base + p16), 0.4)
        if bar >= MOD_BAR:  # 一転攻勢: 声は全部野獣。打楽器は「こ」、16分で埋める
            for p16 in range(16):
                g = 1.2 if p16 in (4, 12) else (0.45 if p16 % 2 else 0.3)
                G.place(layer["perc"], G.burst(yc, 0, 0.07 if p16 in (4, 12) else 0.035), t_of(base + p16), g)
            continue
        if kind in ("verse", "pre", "brk2a", "brk2b") or kind.startswith("hook"):
            for p16 in (4, 12):
                G.place(layer["perc"], G.burst(pc, 0), t_of(base + p16), 1.1)
            if kind != "verse":
                for p16, g in ((7, 0.3), (14, 0.35), (15, 0.45)):
                    G.place(layer["perc"], G.burst(pc, 0, 0.04), t_of(base + p16), g)
    # 一転攻勢のどもり: 次の台詞の頭の1モーラを、直前の2拍に16分で8回（和音の根音→5度で上がる）
    for p in placed:
        if p["sec"] != "twist":
            continue
        c = cache[p["key"]]
        for k in range(8):
            s16 = p["at"] - 8 + k
            name, tr = harm[s16 // 8]
            mm = G.near(ROOT[name] + tr + (7 if k >= 4 else 0), 50, 62)
            G.place(layer["chop"], PB.level(G.chop(c, 0, mm, 0.9 * SIX)), t_of(s16), 0.25 + 0.05 * k)
    vinst = layer["chop"] + layer["perc"]
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)

    daw = {"bpm": BPM, "drum": "16beat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t6": "Pad 3 (polysynth)",
                           "t7": "Electric Piano 1", "t8": "Xylophone", "t9": "Lead 2 (sawtooth)", "t10": "Lead 1 (square)"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")

    # 渡す前の物差し: 句頭の拍頭率・強い音節の拍頭率・抑揚の上下の一致率・和音に入る旋律の率
    heads, strong, agree, fit = [], [], [], []
    seen = set()
    for p in placed:
        c = cache[p["key"]]
        n = len(c["pos"]) if p["upto"] is None else p["upto"]
        pos = p["at"] + c["pos"][:n]
        heads.append(pos[0] % 4 == 0)
        thr = np.quantile(c["strength"], 0.75)
        strong += [pos[i] % 4 == 0 for i in range(n) if c["strength"][i] >= thr]
        for i in range(n):
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
                "melodyInChord": round(float(np.mean(fit)), 2)}
    blocks = [{"bar": b0 + 1, "kind": k, "chords": [harm[(b0 + i // 2) * 2 + i % 2][0] for i in range(8)]} for b0, k in PB.BLOCKS]
    info = {"bpm": BPM, "key": "D major → E♭ major (bar 57)", "bars": NBARS, "endStep": END_STEP16 * 12, "modBar": MOD_BAR + 1,
            "blocks": blocks, "measures": measures, "placed": out_placed}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("placed", len(placed), "lead notes", len(tracks["t0"]), json.dumps(measures, ensure_ascii=False))
    occ = np.zeros(76 * BAR)
    for p in out_placed:
        a = int((p["bar"] - 1) * BAR)
        occ[a:a + p["len16"]] = 1
    print("voice occupancy bars 9-72", round(float(occ[8 * BAR:72 * BAR].mean()), 2))


if __name__ == "__main__":
    main()
