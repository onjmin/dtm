"""野獣先輩 × 2号式（notes-yaju-2go.md）。アイスティーの1句をモーラごとに刻んでサビ旋律にし、低い母音でベースを弾く。使い捨て。

- vinst.wav: 声の楽器（刻みの旋律・リフ、声のベース、子音の打楽器）
- vraw.wav: 生の台詞（ためと落とし）
- daw.json: 伴奏とリード（手書き）、placement.json: 小節ごとの素材
1小節 = 192 ステップ、16分 = 12。python -I yaju_2go_build.py <outdir>
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
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import yaju_v1 as Y  # noqa: E402

FS = G.FS
BPM = 150
SIX = 15 / BPM
BAR = 192
NBARS = 64
K = V.K
PENT = {4, 7, 9, 11, 2}  # E マイナーペンタ（check 用）

CH = {
    "Em7": [64, 67, 71, 74], "A7": [61, 64, 67, 69], "CM7": [60, 64, 67, 71], "B7": [63, 66, 69, 71],
    "Dm7": [62, 65, 69, 72], "G7": [62, 65, 67, 71], "Am7": [60, 64, 67, 69], "D7": [62, 66, 69, 72],
    "GM7": [62, 66, 67, 71], "F#m7b5": [60, 64, 66, 69],
}
ROOT = {"Em7": 40, "A7": 33, "CM7": 36, "B7": 35, "Dm7": 38, "G7": 31, "Am7": 33, "D7": 38, "GM7": 31, "F#m7b5": 30}
VERSE = ["Em7", "A7", "Em7", "A7", "CM7", "B7", "Em7", "B7"]  # 半小節ずつ
HOOK = ["CM7", "B7", "Em7", "Dm7", "CM7", "B7", "Em7", "G7"]
HOOK_END = HOOK[:-1] + ["Em7"]
BRIDGE = ["Am7", "D7", "GM7", "CM7", "F#m7b5", "B7", "Em7", "B7"]

# サビ: アイスティーしかなか（声の出ている9モーラ。「ったけどいいか」は息だけで音程が付かない）を刻む。
# (16分位置, 長さ, モーラ, MIDI)。モーラ: 0あ 1い 2す 3てぃ 5し 6か 7な 8か、-3 は「てぃ」の母音だけ（ー）
HOOK_A = [(0, 2, 0, 67), (2, 1, 1, 64), (3, 1, 2, 67), (4, 3, 3, 71), (7, 1, -3, 71),
          (8, 2, 5, 71), (10, 2, 6, 69), (12, 2, 7, 66), (14, 2, 8, 71),
          (16, 2, 0, 76), (18, 1, 1, 74), (19, 1, 2, 71), (20, 4, 3, 74), (24, 6, -3, 74)]
HOOK_B = [(32, 2, 0, 71), (34, 1, 1, 67), (35, 1, 2, 71), (36, 3, 3, 74), (39, 1, -3, 76),
          (40, 2, 5, 71), (42, 2, 6, 69), (44, 2, 7, 66), (46, 2, 8, 69),
          (48, 2, 0, 67), (50, 1, 1, 71), (51, 1, 2, 74), (52, 4, 3, 76), (56, 8, -3, 74)]
HOOK_B_END = HOOK_B[:-1] + [(56, 8, -3, 64)]
CHOP_OCT = -12  # 刻みは元の声に近い高さで、リードが書いた高さを重ねる

# Aメロのリフ: やりますねぇ を半小節ずつ（や・り・ま ／ す・ね・ぇ）、和音の音を上下
RIFF = [(0, 3, 0, 2), (3, 3, 1, 1), (6, 2, 2, 3), (8, 2, 3, 1), (10, 2, 4, 2), (12, 4, 5, 0)]  # (位置, 長さ, モーラ, 和音の何番目)

BLOCKS = [(0, "intro"), (4, "verse"), (8, "verse"), (12, "pre"), (16, "hook"), (20, "hook"),
          (24, "verse2"), (28, "verse2"), (32, "hook"), (36, "hook"), (40, "bridge"), (44, "bridge"),
          (48, "hook3"), (52, "hook3"), (56, "hook3end"), (60, "outro")]
END_STEP = 60 * BAR + 48  # 61小節目の1拍で曲を切り、あとは生の台詞だけ

# 生の台詞: (小節1始まり, 拍, 台詞, 先頭からのモーラ数 None=全部, 表示)
RAW = [
    (1, 1, Y.OMATASE, None, None),
    (16, 1, Y.DOUZO, None, None),
    (41, 0, Y.TEA, 3, "アイス…"), (43, 0, Y.TEA, 5, "アイスティー…"), (45, 0, Y.TEA, 7, "アイスティーしか…"),
    (47, 0, Y.TEA, 9, "アイスティーしかなかっ…"),
    (61, 2, Y.TEA, None, None),  # 曲が止まったあと、元の1句を原液で
    (63, 2, Y.TASHO, None, None),
]


def harm_of(kind):
    if kind == "hook3end":
        return HOOK_END
    if kind.startswith("hook"):
        return HOOK
    return BRIDGE if kind == "bridge" else VERSE


def chord_at(step):
    b = step // BAR
    for b0, kind in BLOCKS:
        if b0 <= b < b0 + 4:
            return harm_of(kind)[((step - b0 * BAR) // 96) % 8]
    return "Em7"


_W = {}


def world(path):
    """この人の声は句末で 60Hz を割ってきしむので、下限 35Hz で分析する。"""
    if path not in _W:
        y = G.librosa.load(str(path), sr=FS, mono=True)[0].astype(np.float64)
        f0, t = pyworld.harvest(y, FS, f0_floor=35, f0_ceil=800, frame_period=5.0)
        n = pyworld.get_cheaptrick_fft_size(FS, 35)
        _W[path] = (f0, pyworld.cheaptrick(y, f0, t, FS, f0_floor=35, fft_size=n), pyworld.d4c(y, f0, t, FS, fft_size=n))
    return _W[path]


def mchop(c, mi, midi, length):
    """モーラ mi を子音頭から切り、足りない長さは母音を往復で伸ばす。有声部の f0 を midi に。"""
    f0, sp, ap = world(c["path"])
    snd = c["snd"]
    vowel_only = mi < 0  # -k: モーラ k の母音だけ（伸ばし棒を前のモーラの母音で鳴らす）
    mi = abs(mi)
    m = snd[mi]
    a = int(max(0, (m["vstart"] if vowel_only else m["start"] - 0.005)) * 200)
    v = max(a + 1, int(m["vstart"] * 200))
    e = int((snd[mi + 1]["start"] if mi + 1 < len(snd) else m["end"]) * 200)
    e = min(len(f0), max(v + 4, e))
    need = max(4, int(length * 200))
    idx = list(range(a, min(e, a + need)))
    k = e - v
    i = 0
    while len(idx) < need:  # 母音部を往復
        j = i % (2 * k - 2) if k > 1 else 0
        idx.append(v + (j if j < k else 2 * k - 2 - j))
        i += 1
    idx = np.array(idx)
    f = f0[idx].copy()
    if midi is not None:
        vib = 1 + 0.004 * np.sin(np.arange(len(f)) / 200 * 2 * np.pi * 5.5)
        f[f > 0] = G.hz(midi) * vib[f > 0]
    a_ = ap[idx].copy()
    a_[f > 0] *= 0.5  # きしみ声の息を減らして音程を立てる（母音シンセと同じ）
    x = pyworld.synthesize(f, sp[idx].copy(), np.clip(a_, 0, 1), FS, 5.0)
    r = min(len(x) // 2, int(0.025 * FS))
    x[-r:] *= np.linspace(1, 0, r)
    x[:64] *= np.linspace(0, 1, 64)
    return x


def put(buf, x, t, g=1.0):
    """G.place と同じ。早めに置いて曲頭より前へ出た分は切る。"""
    if t < 0:
        x, t = x[int(-t * FS):], 0.0
    G.place(buf, x, t, g)


def bass_early(m):
    """声のベースは WORLD が最初の声門パルスを1周期あとに出すので、1周期ぶん早く置く。"""
    return min(0.025, 1.0 / G.hz(m))


def lead_in(c, mi):
    """子音の長さ（秒）。刻みはこの分だけ早く置き、母音頭を格子に合わせる。"""
    if mi < 0:
        return 0.0
    m = c["snd"][mi]
    return float(np.clip(m["vstart"] - m["start"] + 0.005, 0.0, 0.06))


def tones(name, lo=62, hi=74):
    return sorted({G.near(m, lo, hi) for m in CH[name]})


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in Y.ALL])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))
    tea, yari, wakan = cache[K(Y.TEA)], cache[K(Y.YARI)], cache[K(Y.WAKAN)]
    fa, koko = cache[K(Y.FA)], cache[K(Y.KOKO)]
    bass_src = G.stable_vowel(wakan["path"])

    N = int((NBARS * 16 * SIX + 4) * FS)
    vraw = np.zeros(N)
    layer = {k: np.zeros(N) for k in ("chop", "bass", "perc")}  # 声の楽器を層ごとに（時刻の確かめ用）
    t_of = lambda step: step / 12 * SIX  # noqa: E731
    used = []
    vnotes = {"chop": 0, "bass": 0, "perc": 0}
    tracks = {"t0": [], "t4": [], "t6": [], "t7": [], "t13": []}
    prog = []

    def mark(bar, text, c, kind):
        used.append({"bar": bar, "text": text, "who": Path(c["path"]).parent.name, "file": str(c["path"]), "kind": kind})

    for b0, kind in BLOCKS:
        harm = harm_of(kind)
        prog.append({"bar": b0 + 1, "kind": kind, "chords": harm})
        for i, name in enumerate(harm):
            st = b0 * BAR + i * 96
            if kind == "outro":
                if st < END_STEP:  # 最後の Em7 を1拍だけ
                    tracks["t6"] += [{"startStep": st, "durationSteps": 46, "midi": m} for m in CH["Em7"]]
                    tracks["t4"].append({"startStep": st, "durationSteps": 46, "midi": 40})
                    place_bass = G.vsyn(bass_src, 40, 4 * SIX, att=0.005, rel=0.04, bright=0.3)
                    put(layer["bass"], place_bass, t_of(st) - bass_early(40), 1.0)
                    vnotes["bass"] += 1
                continue
            tracks["t6"] += [{"startStep": st, "durationSteps": 94, "midi": m} for m in CH[name]]
            # 声のベース: 根音を8分のオクターブで（イントロとブレイク前半は2分）
            if kind == "intro" or (kind == "bridge" and b0 == 40):
                put(layer["bass"], G.vsyn(bass_src, ROOT[name], 7.5 * SIX, att=0.01, rel=0.08, bright=0.3), t_of(st) - bass_early(ROOT[name]), 1.0)
                vnotes["bass"] += 1
            else:
                for k in range(0, 96, 24):
                    m = ROOT[name] + (12 if (k // 24) % 2 else 0)
                    put(layer["bass"], G.vsyn(bass_src, m, 1.6 * SIX, att=0.004, rel=0.03, bright=0.3), t_of(st + k) - bass_early(m), 1.0)
                    vnotes["bass"] += 1
            if kind.startswith("hook"):
                tracks["t4"] += [{"startStep": st + k, "durationSteps": 20, "midi": ROOT[name]} for k in range(0, 96, 24)]
            if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
                for k in range(12, 96, 24):
                    tracks["t7"] += [{"startStep": st + k, "durationSteps": 10, "midi": m + 12} for m in CH[name]]
            if kind.startswith("hook") or kind == "verse2":
                seq = sorted(CH[name]) + [sorted(CH[name])[0] + 12]
                order = seq + seq[-2:0:-1]
                step = 12 if kind.startswith("hook") else 24
                for k in range(0, 96, step):
                    tracks["t13"].append({"startStep": st + k, "durationSteps": 10, "midi": order[(k // 12) % len(order)] + 24})
            # Aメロのリフ（やりますねぇ）
            if kind in ("intro", "verse", "verse2") and not (kind == "intro" and b0 * BAR + i * 96 < 2 * BAR):
                t = tones(name)
                half = 0 if i % 2 == 0 else 8
                for p, ln, mi, deg in RIFF:
                    if (p < 8) != (half == 0):
                        continue
                    put(layer["chop"], mchop(yari, mi, t[deg], ln * SIX - 0.01), t_of(st + (p - half) * 12) - lead_in(yari, mi), 0.6)
                    vnotes["chop"] += 1
            # サビ前: こ↑こ↓ を8分で和音の音を上る
            if kind == "pre":
                t = tones(name, 64, 79)
                for k in range(0, 8, 2):
                    m = t[(k // 2 + (i % 2) * 2) % len(t)] + (12 if b0 * BAR + i * 96 >= 15 * BAR else 0)
                    put(layer["chop"], mchop(koko, (k // 2) % 2, m - 12, 1.8 * SIX), t_of(st + k * 12) - lead_in(koko, (k // 2) % 2), 0.8)
                    vnotes["chop"] += 1
        # サビ: アイスティーの刻み（声）とリード（書いた高さ）
        if kind.startswith("hook"):
            mel = HOOK_A + (HOOK_B_END if kind == "hook3end" else HOOK_B)
            for p, ln, mi, m in mel:
                put(layer["chop"], mchop(tea, mi, m + CHOP_OCT, ln * SIX - 0.01), t_of(b0 * BAR + p * 12) - lead_in(tea, mi), 3.5)  # サビの主役なので伴奏より前へ
                vnotes["chop"] += 1
                tracks["t0"].append({"startStep": b0 * BAR + p * 12, "durationSteps": ln * 12 - 2, "midi": m})
            mark(b0 + 1, "（刻み: アイスティーしかなか を1モーラずつ旋律に）", tea, "chop")
        if kind in ("intro", "verse", "verse2"):
            mark(b0 + 1, "（刻み: やりますねぇ のリフ）", yari, "chop")
        if kind == "pre":
            mark(b0 + 1, "（刻み: こ↑こ↓ を8分で上る）", koko, "chop")
        if kind != "outro":
            mark(b0 + 1, "（声のベース: これもうわかんねぇな の母音）", wakan, "instrument")
        # 打楽器: ファッ の「ふ」を2・4拍のスネアに、こ の破裂を16分裏に
        for bar in range(b0, b0 + 4):
            base = bar * BAR
            if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
                for p in (4, 12):
                    put(layer["perc"], G.burst(fa, 0, 0.09), t_of(base + p * 12), 40.0)  # 「ふ」の摩擦は弱いので大きく
                    vnotes["perc"] += 1
            if kind.startswith("hook") or kind == "verse2":
                for p in (2, 6, 10, 14):
                    put(layer["perc"], G.burst(koko, 0, 0.04), t_of(base + p * 12), 12.0)
                    vnotes["perc"] += 1
        if kind in ("verse", "verse2", "pre") or kind.startswith("hook"):
            mark(b0 + 1, "（打楽器: ファッ の「ふ」のスネア）", fa, "perc")

    placed = []
    for bar, beat, clip, upto, label in RAW:
        c = cache[K(clip)]
        tr = c["tr"]
        q = B.correct(c["midi"] + tr, B.pent_minor(4))  # E マイナーペンタ
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = B.render_voice(c, c["pos"] * SIX, ratios)
        if upto is not None:
            cut = int((c["pos"][upto] * SIX - d0) * FS) if upto < len(c["pos"]) else len(x)
            x = x[:max(int(0.08 * FS), cut)].copy()
            r = min(len(x) // 2, int(0.03 * FS))
            x[-r:] *= np.linspace(1, 0, r)
        put(vraw, x, ((bar - 1) * 16 + beat * 4) * SIX + d0)
        placed.append({"bar": bar + beat / 4, "text": label or c["text"], "who": Path(c["path"]).parent.name, "file": str(c["path"]),
                       "transpose": tr, "kind": "raw"})

    vinst = layer["chop"] + layer["bass"] + layer["perc"]
    pk = max(np.abs(vinst).max(), 1e-9)
    sf.write(outdir / "vinst.wav", (0.9 * vinst / pk).astype(np.float32), FS)
    for k, x in layer.items():
        sf.write(outdir / f"vinst_{k}.wav", (0.9 * x / pk).astype(np.float32), FS)
    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    daw = {"bpm": BPM, "drum": "four_openhat", "bars": NBARS, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 2", "t6": "Pad 2 (warm)", "t7": "Electric Piano 1",
                           "t13": "Glockenspiel"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {"bpm": BPM, "key": "E minor", "bars": NBARS, "endStep": END_STEP, "blocks": prog, "voiceNotes": vnotes,
            "placed": sorted(used + placed, key=lambda p: p["bar"])}
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "lead.npy", np.array([(t["startStep"] / 12, t["durationSteps"] / 12, t["midi"]) for t in tracks["t0"]]))
    print("bars", NBARS, {k: len(v) for k, v in tracks.items()}, "voice", vnotes, "raw", len(placed))


if __name__ == "__main__":
    main()
