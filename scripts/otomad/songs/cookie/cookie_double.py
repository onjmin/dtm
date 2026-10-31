"""フックの台詞（HNS 神社閉店の日）の音を書き起こし、シンセで重ねる音符にする（使い捨て）。

音階（ハ短調）へ丸め、元の上下（0.5 半音以上）は丸めた後も保つ。声の 1 オクターブ上。
python -I cookie_double.py <placement.json> <out.json>
"""
import json
import sys

import numpy as np

SCALE = np.array([0, 2, 3, 5, 7, 8, 10])  # ハ短調


def snap(m):
    o = np.floor(m / 12)
    c = np.array([(o + k) * 12 + s for k in (-1, 0, 1) for s in SCALE])
    return float(c[np.argmin(np.abs(c - m))])


def step(q, up):
    k = q + (1 if up else -1)
    while snap(k) != k:
        k += 1 if up else -1
    return k


d = json.load(open(sys.argv[1], encoding="utf-8"))
notes = []
for p in d["placed"]:
    if not (p["text"] == "神社閉店の日" and p["who"].startswith("HNS")):
        continue
    prev = None
    for pos16, w, mi in p["notes"]:
        q = snap(mi)
        if prev is not None:
            dm = mi - prev[0]
            if dm >= 0.5 and q <= prev[1]:
                q = step(prev[1], True)
            elif dm <= -0.5 and q >= prev[1]:
                q = step(prev[1], False)
            elif abs(dm) < 0.5:
                q = prev[1]
        notes.append({"startStep": int(pos16) * 12, "durationSteps": max(6, int(w) * 12 - 2), "midi": int(q) + 12})
        prev = (mi, q)
json.dump(notes, open(sys.argv[2], "w", encoding="utf-8"))
print(len(notes), "notes; midi range", min(n["midi"] for n in notes), max(n["midi"] for n in notes))
print("first phrase", [n["midi"] for n in notes[:9]])
