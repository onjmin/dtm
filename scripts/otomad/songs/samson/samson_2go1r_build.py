"""samson2go1 のリメイク（notes-samson-2go1r.md）。伴奏・リード・声の楽器は samson2go1 のまま、生の台詞だけ作り直す。使い捨て。

- vraw.wav: 生の台詞（28か所）。ブレイク 41〜48 小節は和音の音へ寄せた主旋律。
- vinst.wav・daw.json は samson2go1/ から写す。placement.json は楽器の行を引き継ぎ、台詞の行を差し替える。
python -I samson_2go1r_build.py <outdir>   → mix: python -I samson2go_mix.py <outdir>
"""
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
HERE = paths.WORK
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import samson_2go_build as G  # noqa: E402
import samson_build as B  # noqa: E402
import samson_v1 as S  # noqa: E402

FS = G.FS
SIX = G.SIX
GABA = S.GABA


def g(num, text):
    return (S.find(GABA, f"{num}*.wav"), None, text, None, 1)


OPPARIYA = g("０１１９☆", "あー、おっぱりや")
ROCKMAN = g("０１７６☆", "おまんころっくまん")
SHABURI = g("００１２☆", "んー、しゃぶりたいむ")
PERO = g("００９２☆", "ぺろぺろなめち")
TUNA = g("００８５☆", "ふとい、しーちきんがほしい")
PALADIN = g("００７０☆", "んー、ないてもないてもおっぱらでぃん")
PSYGUN = g("００８０☆", "んんー、さいこがん")
SHICHIKURI = g("０１００☆", "きもちよくしちくり")
SAIKIN = g("００４３☆", "あー、さいきんはいっちゃう")
GAMAN = g("０１４２☆", "がまんできない")
HOWAN = g("０１０８☆", "あーそこ、ほわーん")
GEDDON = g("０１０９☆", "そこっ、おっ、おっぱげどん")
SAKYU = g("００４５☆", "さきゅう、あなにはいっちゃう")
CHINPO = g("０１７５☆", "ああー、きもちんぽ")
HAICCHAU = g("０１７７☆", "はいっちゃうはいっちゃうはいっちゃう")
DELIGHT = g("０１９６☆", "でぃらいと、いいいい")
IPPAI = g("００３１☆", "いっぱい、はいっちゃ")
IKU = g("０２５１☆", "いくいくいくいくいく、いくよお、いく")

# (小節1始まり, 拍, 台詞, 和音へ寄せるか, 着地: None か (モーラ番号, 小節, 拍) でそのモーラを指定の拍へ)
RAW = [
    (11, 0, S.KOWAI, False, None), (15, 0, S.MATTETE, False, None),
    (16, 2, S.HEREWEGO, False, None),
    (20, 0, OPPARIYA, False, None), (24, 0, ROCKMAN, False, None),
    (25, 2, SHABURI, False, None), (27, 0, PERO, False, None), (29, 0, TUNA, False, None), (31, 0, PALADIN, False, None),
    (34, 0, PSYGUN, False, None), (36, 0, SHICHIKURI, False, None), (38, 0, SAIKIN, False, None), (40, 0, GAMAN, False, None),
    (41, 0, HOWAN, True, None), (42, 2, GEDDON, True, None), (44, 1, SAKYU, True, None), (46, 2, S.AIIN, True, None),
    (47, 0, CHINPO, True, ("ki", 49, 0)),  # 「アア～～」でためて、49小節の頭に「き」
    (51, 0, S.JACKIE, False, None), (53, 1, S.HICHEW, False, None), (54, 1, ROCKMAN, False, None),
    (55, 3, S.DOARA, False, None), (57, 0, HAICCHAU, False, None),
    (59, 3, DELIGHT, False, None), (61, 2, IPPAI, False, None), (63, 0, S.SAIKOU, False, None),
    (65, 3, IKU, False, None),  # 曲を切ったあと
    (69, 0, S.GORILLA, False, None),
]
NBARS_TAIL = 71


def allowed_at(step):
    """その時刻の和音の音＋和音と半音でぶつからないペンタの音。"""
    ch = {m % 12 for m in G.CH[G.chord_at(step)]}
    pent = {int(p) for p in B.pent_minor(2)}
    ok = {p for p in pent if all(min((p - c) % 12, (c - p) % 12) != 1 for c in ch)}
    return np.array(sorted(ch | ok))


def correct_by_chord(midis, steps):
    """B.correct と同じ規則（上下と横ばいを保つ、±1.5 半音まで）で、音階をモーラの時刻ごとに替える。"""
    out, prev = [], None
    for m, st in zip(midis, steps):
        if not np.isfinite(m):
            out.append(np.nan)
            continue
        pcs = allowed_at(st)
        q = B.snap_to(m, pcs)
        near = q
        if prev is not None:
            d = m - prev[0]
            if d >= 0.5 and q <= prev[1]:
                q = B.step_in(prev[1], pcs, True)
            elif d <= -0.5 and q >= prev[1]:
                q = B.step_in(prev[1], pcs, False)
            elif abs(d) < 0.5 and prev[1] % 12 in pcs:
                q = prev[1]
        if abs(q - m) > 1.5:
            q = near
        out.append(q)
        prev = (m, q)
    return np.array(out)


def heads_snd(c):
    """句頭（c["heads"] は促音込みの番号）を、促音を除いた音節の番号へ。"""
    out, j = [], 0
    for i, m in enumerate(c["morae"]):
        if m["vowel"] == "cl":
            continue
        if i in c["heads"]:
            out.append(j)
        j += 1
    return out


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    src = HERE / "samson2go1"
    for f in ("vinst.wav", "daw.json", "lead.npy"):
        shutil.copy(src / f, outdir / f)
    old = json.loads((src / "placement.json").read_text(encoding="utf-8"))

    os.environ.setdefault("ANCHOR", "1.0")
    V.SIX = SIX
    B.SIX = SIX
    clips = []
    for r in RAW:
        if V.K(r[2]) not in [V.K(c) for c in clips]:
            clips.append(r[2])
    V.SECTIONS = [("all", [(V.K(c), 1) for c in clips])]
    cache = V.load_clips()
    for c in cache.values():
        c["pos"] = V.place(c)
        med = float(np.nanmedian(c["midi"])) if np.isfinite(c["midi"]).any() else 52.0
        c["tr"] = float(np.clip(round(52.0 - med), -3, 3))

    vraw = np.zeros(int((NBARS_TAIL * 16 * SIX + 4) * FS))
    placed, spans = [], []
    for bar, beat, clip, by_chord, land in RAW:
        c = cache[V.K(clip)]
        origin = ((bar - 1) * 16 + beat * 4) * SIX  # pos=0 の時刻
        if land is not None:
            kana, lbar, lbeat = land
            ks = [i for i, m in enumerate(c["snd"]) if m["mora"] == kana]
            k = ks[0] if ks else len(c["pos"]) - 4
            origin = ((lbar - 1) * 16 + lbeat * 4) * SIX - c["pos"][k] * SIX
        steps = [int(round((origin / SIX + p) * 12)) for p in c["pos"]]
        tr = c["tr"]
        if by_chord:
            q = correct_by_chord(c["midi"] + tr, steps)
        else:
            q = B.correct(c["midi"] + tr, B.pent_minor(2))
        ratios = [2 ** ((qq - m) / 12) if np.isfinite(qq) and np.isfinite(m) else 2 ** (tr / 12) for qq, m in zip(q, c["midi"])]
        x, d0 = B.render_voice(c, c["pos"] * SIX, ratios)
        at = origin + d0
        G.place(vraw, x, at)
        spans.append((at, at + len(x) / FS, c["text"]))
        placed.append({"bar": round(1 + at / (16 * SIX), 2), "text": c["text"], "who": Path(c["path"]).parent.name, "file": str(c["path"]),
                       "transpose": tr, "kind": "raw", "byChord": by_chord,
                       "correctionCents": [round(float((a - (m + tr)) * 100)) for a, m in zip(q, c["midi"]) if np.isfinite(a) and np.isfinite(m)],
                       "pos16": [int(p) for p in c["pos"]], "notes": [None if not np.isfinite(a) else float(a) for a in q],
                       "origin16": origin / SIX, "src": [None if not np.isfinite(m) else float(m + tr) for m in c["midi"]],
                       "heads": heads_snd(c), "strength": [float(s) for s in c["strength"]]})

    spans.sort()
    for (a0, a1, t0), (b0, b1, t1) in zip(spans, spans[1:]):
        if b0 < a1 - 0.05:
            print(f"overlap {a1 - b0:.2f}s  {t0} → {t1}  (bar {1 + b0 / (16 * SIX):.2f})")
    for p in placed:
        print(f"bar {p['bar']:6.2f}  {p['text']}  len16={p['pos16'][-1] - p['pos16'][0] + 1}  maxcorr={max(map(abs, p['correctionCents']), default=0)}")

    sf.write(outdir / "vraw.wav", (0.9 * vraw / max(np.abs(vraw).max(), 1e-9)).astype(np.float32), FS)
    info = dict(old)
    info["placed"] = sorted([p for p in old["placed"] if p.get("kind") != "raw"] + placed, key=lambda p: p["bar"])
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print("raw", len(placed))


if __name__ == "__main__":
    main()
