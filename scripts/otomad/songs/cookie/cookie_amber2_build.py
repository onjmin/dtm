"""クッキー☆ × 2号 amber型 2（notes-cookie-amber2.md）。伴奏と2声の歌は当たりの自動作曲 tmp/liked/6159.mml から借り、
歌1を RU、歌2を UDK の母音シンセで歌わせる。台詞は前奏・間奏・曲の後だけ。使い捨て。

python -I cookie_amber2_build.py <outdir>   （先に mml_dump.ts で amber2/src6159.json を作る）
daw.json は頭に空き1小節を足して書く（rec_align2.py が伴奏とリードの録り始めのずれを別々に測る）。
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

HERE = paths.WORK
FS = 44100
BPM = 175
SIX = 15 / BPM
BAR = 192
SONG_BARS = 60
END_STEP = 61 * BAR  # 最後の和音（60小節目）が鳴り終わるところで伴奏を切る
NBARS = 68  # 声の長さ（曲の後の台詞まで）
K = V.K
q = C.q
RU = HERE / "cookie_src" / "RU姉貴"
UDK = HERE / "cookie_src" / "UDK姉貴"
UDKS = UDK / "初心者マリナー向け☆UDK音声素材集から抜粋"

R_CALL = q(RU / "UDKー.wav", "ゆーでぃーけー")
U_DOMO = q(UDKS / "あ、どーもでーす.wav", "あ、どーもでーす")
R_SABORI = q(RU / "RIMまたサボり休憩中よ.wav", "りむまたさぼりきゅうけいちゅうよ")
U_NAKA = q(UDKS / "ね、二人ともほんと仲いいねーだって.wav", "ね、ふたりともほんとなかいいねーだって")
R_IYA = q(RU / "いや、UDKは好きだけど.wav", "いや、ゆーでぃーけーはすきだけど")
U_YUJIN = q(UDKS / "仲いいっつーかまぁ友人だな隊長？.wav", "なかいいっつーかまぁゆうじんだなたいちょう")
R_IINAYO = q(RU / "好きって言いなよ.wav", "すきっていいなよ")
U_SONNA = q(UDKS / "そんなのあるのっ.wav", "そんなのあるのっ")
R_WARITO = q(RU / "割と…好きだよ？.wav", "わりと、すきだよ")
U_NANI = q(UDKS / "え、なにそれは.wav", "え、なにそれは")
R_KEKKON = q(RU / "じゃあ私結婚します.wav", "じゃあわたしけっこんします")
R_AA = q(RU / "あー.wav", "あー")
R_UU = q(RU / "うう～.wav", "うう")
U_AA = q(UDKS / "あー.wav", "あー")
U_UU = q(UDK / "うー☆.wav", "うー")
R_WAN = q(RU / "わんわんわん.wav", "わんわんわん")
R_PUHA = q(RU / "ぷはー.wav", "ぷはー")
U_UWA = q(UDKS / "うわっ！.wav", "うわっ")
ALL = [R_CALL, U_DOMO, R_SABORI, U_NAKA, R_IYA, U_YUJIN, R_IINAYO, U_SONNA, R_WARITO, U_NANI, R_KEKKON,
       R_AA, R_UU, U_AA, U_UU, R_WAN, R_PUHA, U_UWA]
LAUGH = UDKS / "笑い声_02.wav"

# 小節（0始まり）・拍、台詞。曲の後（61小節目〜）は伴奏が止まって台詞だけ
RAW = [(0, 1, R_CALL), (1, 0, U_DOMO), (2, 0, R_SABORI),
       (24, 0, U_NAKA), (25, 2, R_IYA), (27, 2, U_YUJIN), (30, 1, R_IINAYO), (31, 0, U_SONNA),
       (59, 2, R_WARITO), (62, 0, U_NANI), (63, 0, R_KEKKON)]
LAUGH_AT = (65, 0)

# 元のトラック → (このトラック, GM 名, 移調, 強さの倍率)。高い層（元 t1・t6）は1オクターブ下げる
MAP = {0: ("t0", "Flute", 0, 0.55), 2: ("t2", "Clarinet", -12, 0.55), 1: ("t12", "Electric Piano 1", -12, 0.8),
       3: ("t3", "Marimba", 0, 0.85), 4: ("t4", "Electric Bass (finger)", 0, 1.0), 5: ("t5", "Electric Bass (finger)", 0, 0.8),
       6: ("t6", "Vibraphone", -12, 0.7), 7: ("t7", "Pad 2 (warm)", 0, 0.8), 8: ("t8", "Electric Piano 2", 0, 0.85),
       9: ("t9", "Acoustic Guitar (nylon)", 0, 0.85), 10: ("t10", "Vibraphone", 0, 0.8), 11: ("t11", "French Horn", 0, 0.9)}
COMP = (3, 7, 8, 9, 10)  # 和音の音名を取る層


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

    src = json.loads((HERE / "amber2" / "src6159.json").read_text(encoding="utf-8"))["placements"]
    by = {}
    for p in src:
        by.setdefault(p["trackIndex"], []).append(p)
    midi_of = lambda p: round(p["pitchUnits"] / 31)  # noqa: E731

    def chord_pcs(step):
        """その時刻に鳴っている伴奏の音名（長さで重み）。"""
        w = {}
        for t in COMP:
            for p in by.get(t, []):
                if p["startStep"] <= step < p["startStep"] + p["durationSteps"]:
                    w[midi_of(p) % 12] = w.get(midi_of(p) % 12, 0) + p["durationSteps"]
        return sorted(w, key=lambda k: -w[k])

    # 母音シンセの音源: 演者ごとに2つから平らな方
    def best(cands):
        r = {k: G.stable_vowel(cache[K(cl)]["path"]) for k, cl in cands}
        k = min(r, key=lambda k: r[k][2])
        return k, r[k], dict(cands)[k]
    ru_k, ru_src, ru_cl = best([("RU あー", R_AA), ("RU うう", R_UU)])
    ud_k, ud_src, ud_cl = best([("UDK あー", U_AA), ("UDK うー", U_UU)])
    print("vowel sources", ru_k, ud_k)

    N = int((NBARS * 16 * SIX + 3) * FS)
    layer = {k: np.zeros(N) for k in ("vowel", "chop", "perc")}
    vraw = np.zeros(N)
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    vnotes = {"vowel": 0, "chop": 0, "perc": 0}
    used = []

    # 歌1 → RU、歌2 → UDK（どちらも1オクターブ下。女声の地声の高さ）
    for t, srcv, g in ((0, ru_src, 0.8), (2, ud_src, 0.75)):
        for p in by[t]:
            d = p["durationSteps"] / 12 * SIX
            G.place(layer["vowel"], G.vsyn(srcv, midi_of(p) - 12, max(0.06, d - 0.02)), t_of(p["startStep"]), g)
            vnotes["vowel"] += 1
    used.append({"bar": 5, "text": f"（歌1: {ru_k} の母音シンセ）", "who": "RU姉貴", "file": str(ru_cl[0]), "kind": "instrument"})
    used.append({"bar": 13, "text": f"（歌2: {ud_k} の母音シンセ）", "who": "UDK姉貴", "file": str(ud_cl[0]), "kind": "instrument"})

    # 打楽器と刻み: ぷ（RU）を2・4拍、わ（RU）をサビの8分裏、うわっの「う」（UDK）を4拍裏のゴースト
    wc, tc, uc = cache[K(R_WAN)], cache[K(R_PUHA)], cache[K(U_UWA)]
    for bar in range(8, SONG_BARS):
        base = bar * BAR
        if 24 <= bar < 32:  # 間奏は台詞のために空ける（ぷだけ）
            for p in (4, 12):
                G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 0.7)
            vnotes["perc"] += 2
            continue
        for p in (4, 12):
            G.place(layer["perc"], G.burst(tc, 0), t_of(base + p * 12), 1.1)
        G.place(layer["perc"], G.burst(uc, 0, 0.05), t_of(base + 14 * 12), 0.45)
        vnotes["perc"] += 3
        if 32 <= bar < 56 or 16 <= bar < 24:
            for p in (2, 6, 10, 14):
                pcs = chord_pcs(base + p * 12)
                if pcs:
                    third = pcs[1] if len(pcs) > 1 else pcs[0]
                    G.place(layer["chop"], G.chop(wc, 0, G.near(third, 60, 72), 1.0 * SIX), t_of(base + p * 12), 0.5)
                    vnotes["chop"] += 1
    used.append({"bar": 9, "text": "（打楽器: ぷはー の「ぷ」・うわっ の「う」）", "who": "RU姉貴/UDK姉貴", "file": str(tc["path"]), "kind": "perc"})
    used.append({"bar": 17, "text": "（刻み: わ を8分裏に）", "who": "RU姉貴", "file": str(wc["path"]), "kind": "chop"})

    placed = []
    for bar, beat, clip in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        qq = B.correct(c["midi"] + tr, B.pent_minor(3))  # 変ト長調のペンタ（E♭マイナーペンタ）
        ratios = [2 ** ((a - m) / 12) if np.isfinite(a) and np.isfinite(m) else 2 ** (tr / 12) for a, m in zip(qq, c["midi"])]
        x, d0 = P.line(c, c["pos"] * SIX, ratios)
        fr = np.abs(x) > 0.05 * np.abs(x).max()
        x = x * (0.1 / max(float(np.sqrt((x[fr] ** 2).mean())), 1e-9))
        G.place(vraw, x, (bar * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + 1 + beat / 4, "text": c["text"], "who": Path(c["path"]).parent.name.replace("初心者マリナー向け☆UDK音声素材集から抜粋", "UDK姉貴"),
                       "file": str(c["path"]), "transpose": tr, "kind": "raw", "dur": round(len(x) / FS, 2)})
    lx, lsr = sf.read(LAUGH)
    lx = lx.mean(1) if lx.ndim > 1 else lx
    if lsr != FS:
        import librosa
        lx = librosa.resample(lx, orig_sr=lsr, target_sr=FS)
    fr = np.abs(lx) > 0.05 * np.abs(lx).max()
    G.place(vraw, lx * (0.08 / max(float(np.sqrt((lx[fr] ** 2).mean())), 1e-9)), (LAUGH_AT[0] * 16 + LAUGH_AT[1] * 4) * SIX)
    placed.append({"bar": LAUGH_AT[0] + 1, "text": "（笑い声）", "who": "UDK姉貴", "file": str(LAUGH), "kind": "raw"})

    vinst = sum(layer.values())
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)

    tracks, inst = {}, {}
    for s, (t, name, sh, vel) in MAP.items():
        inst[t] = name
        tracks[t] = [{"startStep": p["startStep"] + BAR, "durationSteps": p["durationSteps"], "midi": midi_of(p) + sh,
                      "velocity": max(1, min(127, round(p["velocity"] * vel)))} for p in by.get(s, [])]
    daw = {"bpm": BPM, "drum": "disco", "bars": SONG_BARS + 2, "preroll": 1, "tracks": tracks, "instruments": inst}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "G♭ major", "bars": SONG_BARS, "endStep": END_STEP, "source": "tmp/liked/6159.mml",
            "vowelSources": [ru_k, ud_k], "voiceNotes": vnotes, "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print("tracks", {k: len(v) for k, v in tracks.items()}, "voice", vnotes)
    for p in placed:
        print(p["bar"], p["who"], p.get("dur"), p["text"])


if __name__ == "__main__":
    main()
