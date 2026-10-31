"""配置の記録が無い曲の「小節 → 台詞・素材」を、今のコードで計算し直して shelf/layouts.json に書く（使い捨て）。

書き出し時の小節数（song.json の bars）と比べ、合わない曲は印を付ける（コードが後から変わったため）。
python -I shelf_layouts.py
"""
import json
import math
import os
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
HERE = paths.WORK
import numpy as np  # noqa: E402

OUT = HERE / "shelf"
OUT.mkdir(exist_ok=True)


def rows_from(entries):
    """(16分位置, path, 表示テキスト, 移調) → 表の行。"""
    return [{"bar": round(at / 16 + 1, 2), "text": text, "path": str(path), "transpose": tr} for at, path, text, tr in entries]


def song34():
    import compose_quotes3 as Q
    entries, secs = Q.layout()
    bars = secs[-1]["bar0"] + secs[-1]["bars"]
    return rows_from((e["at"], e["clip"]["path"], e["clip"]["text"], None) for e in entries), bars


def setting_song(sections):
    import setting
    lay = setting.make_layout(sections)
    entries, secs = lay()
    bars = secs[-1]["bar0"] + secs[-1]["bars"]
    return rows_from((e["at"], e["clip"]["path"], e["clip"]["text"], None) for e in entries), bars


def inmu2():
    import inmu_v2 as V2
    cache = V2.load_clips()
    ioi = np.concatenate([np.diff(c["on"]) for c in cache.values() if len(c["on"]) > 1])
    bpm = int(round(np.clip(15 / np.median(ioi[ioi > 0.02]), 110, 150)))
    six, BAR = 15 / bpm, 16
    out, secs, cur = [], [], 0
    for label, items in V2.SECTIONS:
        start = math.ceil(cur / BAR) * BAR
        cur = start
        for key, rep in items:
            c = cache[key]
            g = V2.quantize(c["on"], six, c["anchors"])
            tail16 = max(2, int(round(min(0.5, (c["sounding"][-1]["end"] - c["on"][-1])) / six)))
            ln = int(g[-1]) + tail16
            for _ in range(rep):
                out.append((cur, c["path"], c["text"], None))
                cur += ln + 1
        n = max(1, math.ceil((cur - start) / BAR))
        if label == "end":
            n += 2
        secs.append((start // BAR, n))
        cur = start + n * BAR
    return rows_from(out), secs[-1][0] + secs[-1][1]


def inmu3():
    os.environ["ANCHOR"] = "0.0"  # inmu3 の書き出し時の値
    import inmu_v1 as M
    import inmu_v3 as V
    cache = V.load_clips()
    for key, c in cache.items():
        c["pos"] = V.place(c, lmax=7) if key == V.K(M.YARI) else V.place(c)

    def hist(shift):
        h = np.zeros(12)
        for c in cache.values():
            t = c.get("tr", 0) if shift else 0
            w = np.diff(np.append(c["pos"], c["pos"][-1] + 2))
            for mi, ww in zip(c["midi"], w):
                if np.isfinite(mi):
                    h[int(round(mi + t)) % 12] += ww
        return h

    root, mode = V.choose_key(hist(False))
    sc = V.scale_set(root, mode)
    for c in cache.values():
        c["tr"] = V.best_transpose(c["midi"], np.diff(np.append(c["pos"], c["pos"][-1] + 2)).astype(float), sc)
    out, secs, cur = [], [], 0
    for label, items in V.SECTIONS:
        start = math.ceil(cur / V.BAR) * V.BAR
        cur = start
        for key, rep in items:
            c = cache[key]
            ln = int(c["pos"][-1]) + max(2, 4 - int(c["pos"][-1]) % 4)
            if key == V.K(M.YARI):
                ln = V.HALF - 1
            for _ in range(rep):
                cur = math.ceil(cur / V.HALF) * V.HALF
                out.append((cur, c["path"], c["text"], float(c["tr"])))
                cur += ln + 1
        n = max(1, math.ceil((cur - start) / V.BAR))
        if label == "end":
            n += 2
        secs.append((start // V.BAR, n))
        cur = start + n * V.BAR
    return rows_from(out), secs[-1][0] + secs[-1][1]


def main():
    result = {}
    jobs = {
        "song3": song34, "song4": song34,
        "song5": lambda: setting_song(__import__("eahon_v5").sections),
        "inmu1": lambda: setting_song(__import__("inmu_v1").SECTIONS),
        "inmu2": inmu2,
        "inmu3": inmu3,
    }
    done = {}
    for name, fn in jobs.items():
        expected = json.loads((HERE / name / "song.json").read_text(encoding="utf-8")).get("bars")
        try:
            key = fn.__name__ if fn.__name__ != "<lambda>" else name
            if key in done:
                rows, bars = done[key]
            else:
                rows, bars = fn()
                done[key] = (rows, bars)
            result[name] = {"rows": rows, "bars": bars, "expectedBars": expected, "match": bars == expected}
            print(name, "rows", len(rows), "bars", bars, "expected", expected)
        except Exception as e:  # 計算し直せない曲は記録なしとする
            result[name] = {"rows": [], "error": f"{type(e).__name__}: {e}"}
            traceback.print_exc()
    (OUT / "layouts.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
