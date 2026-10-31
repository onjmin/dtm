"""2号兄貴の候補曲から、クッキー☆の台詞に和音が一番合う曲を選ぶ（使い捨て）。

python -I cookie_select.py rec/out/cand_*.json
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402

import cookie_v1 as C  # noqa: E402
import inmu_v3 as V  # noqa: E402
import kaisen_voice as KV  # noqa: E402

K = KV.K
LEAD = {"0", "1", "2", "14"}
VERSE_LINES = [[K(C.YUKKURI), K(C.NOBITA), K(C.DANMAKU)],
               [K(C.SOONANOKA), K(C.JUDGE), K(C.IYAIYA), K(C.URUSEE)],
               [K(C.YAMETE), K(C.NAICHAU), K(C.OMOTE)]]
HOOK = [(K(C.REU4), 1), (K(C.UU), 1), (K(C.REUCHOTTO), 1)]


def sections(song):
    """小節ごとに サビ（リード2 が鳴る）/ Aメロ（リード0 だけ）/ 前奏 を見分け、連続区間にまとめる。"""
    B = 192
    bars = int(math.ceil(max(x["start"] + x["dur"] for ns in song["tracks"].values() for x in ns) / B))
    lab = []
    for b in range(bars):
        on = lambda t: any(b * B <= x["start"] < (b + 1) * B for x in song["tracks"].get(t, []))  # noqa: E731
        lab.append("chorus" if on("2") else "verse" if on("0") else "intro")
    out, s = [], 0
    for b in range(1, bars + 1):
        if b == bars or lab[b] != lab[s]:
            out.append((lab[s], s + 1, b))
            s = b
    return out, bars


def make_plan(song):
    secs, bars = sections(song)
    plan, vi = [], 0
    first_verse = next(s for s in secs if s[0] == "verse")
    plan.append((max(1, first_verse[1] - 2), first_verse[1] - 1, [(K(C.OSS), 1)]))
    for lab, b0, b1 in secs:
        if lab == "verse" and vi < len(VERSE_LINES):
            plan.append((b0, b1, [(k, 1) for k in VERSE_LINES[vi]]))
            vi += 1
        elif lab == "chorus":
            plan += [(b, min(b + 3, b1), HOOK) for b in range(b0, b1 - 2, 4)]
    plan.append((bars - 3, bars, [(K(C.YURUSANAI), 1), (K(C.YUKKURI), 1)]))
    return plan, secs, bars


def place_all(song, cache, plan):
    six = 15 / song["bpm"]
    V.SIX = six
    for key, c in cache.items():
        c["pos"] = V.place(c)
    harm = tuple(t for t, ns in song["tracks"].items() if t not in LEAD and np.median([x["midi"] for x in ns]) < 80)
    KV.HARMONY_TRACKS = harm
    n16 = int(math.ceil(max(x["start"] + x["dur"] for ns in song["tracks"].values() for x in ns) / 12)) + 16
    H = KV.harmony_grid(song, n16)
    root, mode = V.choose_key(H.sum(0))
    sc = V.scale_set(root, mode)
    base = {}
    for key, c in cache.items():
        w = np.diff(np.append(c["pos"], c["pos"][-1] + 2)).astype(float)
        base[key] = V.best_transpose(c["midi"], w, sc)
    placed, cur = [], 0
    for b0, b1, items in plan:
        cur = max(cur, (b0 - 1) * 16)
        for key, rep in items:
            c = cache[key]
            ln = int(c["pos"][-1]) + max(2, 4 - int(c["pos"][-1]) % 4)
            for _ in range(rep):
                at = math.ceil(cur / 8) * 8
                best = max((KV.fit_score(c, at, t, H), t) for t in base[key] + np.arange(-2, 3))
                placed.append((key, at, float(best[1])))
                cur = at + ln + 1
    return placed, H


def fit_by_shift(placed, cache, H):
    rates = []
    for sh in range(12):
        s = w = 0.0
        for key, at, t in placed:
            c = cache[key]
            for i, mi in enumerate(c["midi"]):
                if not np.isfinite(mi):
                    continue
                a = at + int(c["pos"][i])
                ww = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
                if a >= len(H):
                    continue
                h = H[a:a + max(1, int(ww))].mean(0)
                s += ww * (h[(int(round(mi + t)) + sh) % 12] > 0.15)
                w += ww
        rates.append(s / w)
    return rates


def main():
    V.SECTIONS = [("all", [(K(c), 1) for c in C.ALL if c not in (C.KYOMI, C.NAKUTO)])]
    cache = V.load_clips()
    rows = []
    for p in sys.argv[1:]:
        song = json.load(open(p, encoding="utf-8"))
        plan, secs, bars = make_plan(song)
        placed, H = place_all(song, cache, plan)
        r = fit_by_shift(placed, cache, H)
        margin = r[0] - max(r[1:])
        rows.append((margin, r[0], p, song["bpm"], song["meta"]["seed"], bars, [f"{a}{b}-{c}" for a, b, c in secs]))
    for row in sorted(rows, reverse=True):
        print(f"margin {row[0]:+.3f} shift0 {row[1]:.3f} {Path(row[2]).name} bpm {row[3]} seed {row[4]} bars {row[5]} {row[6]}")


if __name__ == "__main__":
    main()
