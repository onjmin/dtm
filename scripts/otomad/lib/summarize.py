"""measure.py の結果を集計し、音程の写し方を比べる（使い捨て）。"""
import json
import sys
from collections import defaultdict

import numpy as np

MAJOR = np.array([0, 2, 4, 5, 7, 9, 11])
MINOR_PENTA = np.array([0, 3, 5, 7, 10])


def snap(x, scale):
    """半音値 x を音階（全オクターブ）の最寄りへ。"""
    octs = np.floor(x / 12)
    cands = (octs[:, None] + np.array([-1, 0, 1])[None, :])[:, :, None] * 12 + scale[None, None, :]
    cands = cands.reshape(len(x), -1)
    return cands[np.arange(len(x)), np.abs(cands - x[:, None]).argmin(1)]


def best_snap(x, scale):
    best = None
    for off in np.arange(0, 12, 0.5):
        q = snap(x + off, scale) - off
        err = np.abs(q - x).mean()
        if best is None or err < best[0]:
            best = (err, q)
    return best[1]


def dirs(v, eps):
    d = np.diff(v)
    return np.where(np.abs(d) < eps, 0, np.sign(d))


def compare(med, times, scale):
    """写し方ごとに、上下の向きの一致・同音連続・誤差を返す。"""
    out = {}
    detr = med - np.polyval(np.polyfit(times, med, 1), times) if len(med) >= 4 else med
    orig_dir = dirs(med, 0.5)
    for name, src, gain in [
        ("raw", med, 1.0),
        ("x2", med, 2.0),
        ("detrend", detr, 1.0),
        ("detrend_x2", detr, 2.0),
    ]:
        q = best_snap(src * gain, scale)
        qd = dirs(q, 0.01)
        moving = orig_dir != 0
        out[name] = {
            # 原音で動いている所の向きが保たれた割合
            "dirKeep": float((qd[moving] == orig_dir[moving]).mean()) if moving.any() else None,
            # 量子化後の同音連続
            "repeat": float((qd == 0).mean()),
            "span": float(q.max() - q.min()),
        }
    # 順位写し: 句の中の高低順位を音階の度数へ（重複は同じ度数）
    order = np.argsort(np.argsort(detr))
    deg = np.round(order / max(1, len(detr) - 1) * 7).astype(int)  # 8 段（1オクターブ）
    q = np.array([12 * (k // len(scale)) + scale[k % len(scale)] for k in deg])
    qd = dirs(q.astype(float), 0.01)
    moving = orig_dir != 0
    out["rank"] = {
        "dirKeep": float((qd[moving] == orig_dir[moving]).mean()) if moving.any() else None,
        "repeat": float((qd == 0).mean()),
        "span": float(q.max() - q.min()),
    }
    return out


def pct(a, ps=(10, 50, 90)):
    a = np.array([v for v in a if v is not None], float)
    return " / ".join(f"{np.percentile(a, p):.2f}" for p in ps) if len(a) else "-"


def main():
    res = json.load(open(sys.argv[1], encoding="utf-8"))
    ok = [r for r in res if "range90" in r]
    print(f"clips {len(res)} usable {len(ok)} skipped {len(res)-len(ok)}")
    print("指標: p10 / p50 / p90")
    print("F0 幅 (5-95%, 半音)      ", pct([r["range90"] for r in ok]))
    print("下がり (半音/秒)          ", pct([r["slope"] for r in ok]))
    print("onset/秒                  ", pct([r["onsetRate"] for r in ok]))
    print("中央 F0 Hz                ", pct([r["medHz"] for r in ok]))
    segs = [s for r in ok for s in r["segs"]]
    print("区間長 秒                 ", pct([s["len"] for s in segs]))
    print("区間内の滑り (半音)       ", pct([s["glide"] for s in segs]))
    print("|滑り|>1半音の区間率      ", f"{np.mean([abs(s['glide']) > 1 for s in segs]):.2f}")
    steps = [abs(b["med"] - a["med"]) for r in ok for a, b in zip(r["segs"], r["segs"][1:])]
    print("区間間の段差 |半音|       ", pct(steps))
    print("段差<0.5半音の率          ", f"{np.mean(np.array(steps) < 0.5):.2f}")
    print("段差<1半音の率            ", f"{np.mean(np.array(steps) < 1):.2f}")

    print("\n話者フォルダ別 (F0幅 p50 / 下がり p50 / onset/秒 p50 / 本数)")
    byf = defaultdict(list)
    for r in ok:
        byf[r["folder"]].append(r)
    for f, rs in sorted(byf.items(), key=lambda kv: -np.median([r["range90"] for r in kv[1]])):
        print(
            f"  {np.median([r['range90'] for r in rs]):5.1f}  "
            f"{np.median([r['slope'] for r in rs if r['slope'] is not None]):6.2f}  "
            f"{np.median([r['onsetRate'] for r in rs]):5.1f}  {len(rs):3d}  {f.split(chr(92))[-1]}"
        )

    for sname, scale in [("長音階", MAJOR), ("短5音", MINOR_PENTA)]:
        agg = defaultdict(lambda: defaultdict(list))
        for r in ok:
            if len(r["segs"]) < 4:
                continue
            med = np.array([s["med"] for s in r["segs"]])
            t = np.array([s["t"] for s in r["segs"]])
            for k, m in compare(med, t, scale).items():
                for mk, mv in m.items():
                    agg[k][mk].append(mv)
        print(f"\n写し方の比較（{sname}、区間4以上の台詞、p50 / 平均）")
        print("  方式         向き保持        同音連続        音域(半音)")
        for k, m in agg.items():
            row = []
            for mk in ("dirKeep", "repeat", "span"):
                a = np.array([v for v in m[mk] if v is not None])
                row.append(f"{np.median(a):5.2f}/{a.mean():5.2f}")
            print(f"  {k:11s}  " + "   ".join(row))


if __name__ == "__main__":
    main()
