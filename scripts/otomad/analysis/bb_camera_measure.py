"""BB劇場のカメラワークを測る: ショットごとに画面全体の動き（パン・寄り/引き・回転・揺れ）を推定して並べる。

隣り合うコマの特徴点（ORB）を合わせ、相似変換（平行移動・拡大・回転）を推定する。BB劇場のカメラは地の絵ごと動かすので、
画面の大部分を占める地の動きがカメラの動きになる。人だけが動くショットは「据え」に出る。
python -I bb_camera_measure.py <outdir> <mp4> ...   → mp4 ごとに要約1行と <outdir>/<名前>.camera.txt（ショットごと）
"""
import subprocess
import sys
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

FPS, W, H = 10, 320, 180


def frames(mp4):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp4), "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W)


ORB = cv2.ORB_create(400)
BF = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)


def motion(a, b):
    """a→b の相似変換（dx, dy は画面幅に対する割合、s は拡大率、r は度）。合わなければ None。"""
    ka, da = ORB.detectAndCompute(a, None)
    kb, db = ORB.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 12 or len(kb) < 12:
        return None
    m = BF.match(da, db)
    if len(m) < 12:
        return None
    pa = np.float32([ka[x.queryIdx].pt for x in m])
    pb = np.float32([kb[x.trainIdx].pt for x in m])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if M is None or inl.sum() < 10:
        return None
    s = float(np.hypot(M[0, 0], M[1, 0]))
    r = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    # 画面中央を固定したときの平行移動に直す（拡大の中心ずれを平行移動に数えない）
    c = np.array([W / 2, H / 2])
    shift = M[:, :2] @ c + M[:, 2] - c
    return shift[0] / W, shift[1] / W, s, r


def classify(ms, dur):
    """ショットの動きを1語に: 据え・パン・寄り・引き・回転・揺れ（複数は＋でつなぐ）"""
    if not ms:
        return "?", {}
    a = np.array(ms)
    dx, dy, s, r = a[:, 0], a[:, 1], a[:, 2], a[:, 3]
    pan = float(np.hypot(dx.sum(), dy.sum()))  # 合計の移動（画面幅比）
    zoom = float(np.prod(s))  # 合計の拡大率
    rot = float(abs(r.sum()))
    jit = float(np.hypot(np.abs(np.diff(dx)).mean(), np.abs(np.diff(dy)).mean())) if len(a) > 2 else 0.0  # 向きの入れ替わる細かい動き
    kinds = []
    if jit > 0.012:
        kinds.append("揺れ")
    if pan > 0.08:
        kinds.append("パン")
    if zoom > 1.06:
        kinds.append("寄り")
    elif zoom < 1 / 1.06:
        kinds.append("引き")
    if rot > 4:
        kinds.append("回転")
    return ("＋".join(kinds) or "据え"), {"pan": pan, "zoom": zoom, "rot": rot, "jit": jit}


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    for mp4 in map(Path, sys.argv[2:]):
        fr = frames(mp4)
        n = len(fr)
        small = [cv2.resize(f, (64, 36)).astype(np.float32) for f in fr]
        diff = np.array([0.0] + [float(np.abs(small[i] - small[i - 1]).mean()) for i in range(1, n)])
        bright = np.array([float(f.mean()) for f in fr])
        cuts = [0] + [i for i in range(1, n) if diff[i] > 28 and diff[i] > 3 * np.median(diff[max(0, i - 10):i + 10])] + [n]
        rows, tally, kinds_t = [], Counter(), Counter()
        for a, b in zip(cuts, cuts[1:]):
            if b - a < 2:
                continue
            ms = [m for m in (motion(fr[i], fr[i + 1]) for i in range(a, b - 1)) if m is not None]
            dur = (b - a) / FPS
            kind, v = classify(ms, dur)
            flash = int(((bright[a:b] > 225) | (bright[a:b] < 12)).sum())
            tally[kind] += 1
            for k in kind.split("＋"):
                kinds_t[k] += dur
            rows.append(f"{a / FPS:7.1f} {dur:5.1f}s {kind:10s} pan{v.get('pan', 0):5.2f} zoom{v.get('zoom', 1):5.2f} rot{v.get('rot', 0):5.1f} "
                        f"jit{v.get('jit', 0):.3f} flash{flash}")
        total = n / FPS
        moving = sum(c for k, c in tally.items() if k not in ("据え", "?"))
        shots = sum(tally.values())
        (outdir / f"{mp4.stem}.camera.txt").write_text("\n".join(rows), encoding="utf-8")
        share = "、".join(f"{k}{v / total:.0%}" for k, v in kinds_t.most_common())
        print(f"{mp4.stem} {total:.0f}s shots {shots} 動くショット {moving / max(1, shots):.0%} 時間の内訳 {share}")


if __name__ == "__main__":
    main()
