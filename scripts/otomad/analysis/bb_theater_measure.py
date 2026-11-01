"""BB劇場を秒単位で測る（docs/notes-bb-theater.md）。カット・動き・音・コメント（笑い）を同じ時間軸に並べる。

python -I bb_theater_measure.py <outdir> <mp4> [<comments.json>] ...
mp4 ごとに要約を1行、<outdir>/<名前>.timeline.txt（5秒ごと）と <名前>.shots.png（ショットの頭のコマ）を書く。
comments.json は nigo_mad_comments.py の形（{"comments": [{"t", "body"}]}）。
"""
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FPS, W, H = 10, 160, 90
LAUGH = re.compile(r"[ｗwW草笑]|ファッ|ヌッ|汚|きたね|くさ|臭")


def frames(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={FPS},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def loudness(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
    y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    hop = 800  # 0.1 秒
    n = len(y) // hop
    return 20 * np.log10(np.sqrt((y[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-6)


def cuts_of(v):
    """色の分布が大きく変わる所（絵の入れ替え）。動きやズームでは小さい。"""
    hist = np.stack([np.concatenate([np.histogram(f[..., c], 16, (0, 256))[0] for c in range(3)]) for f in v]).astype(np.float32)
    hist /= hist.sum(1, keepdims=True)
    d = np.abs(np.diff(hist, axis=0)).sum(1)
    c = np.where((d > 0.35) & (d >= np.roll(d, 1)) & (d >= np.roll(d, -1)))[0] + 1
    return c[np.concatenate([[True], np.diff(c) > 2])] if len(c) else c  # 0.3 秒以内の連続は1つ


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    args = sys.argv[2:]
    jobs = []
    for a in args:
        if a.endswith(".json"):
            jobs[-1][1] = a
        else:
            jobs.append([a, None])
    for mp4, cj in jobs:
        name = Path(mp4).stem
        v = frames(mp4)
        dur = len(v) / FPS
        g = v.astype(np.float32).mean(3)
        motion = np.abs(np.diff(g, axis=0)).mean((1, 2))
        cuts = cuts_of(v)
        shots = np.diff(np.concatenate([[0], cuts, [len(v)]])) / FPS
        db = loudness(mp4)
        peak = np.percentile(db, 99)
        quiet = db < peak - 30
        com = json.loads(Path(cj).read_text(encoding="utf-8"))["comments"] if cj else []
        ct = np.array([c["t"] for c in com])
        laugh = np.array([c["t"] for c in com if LAUGH.search(c["body"])])

        line = (f"{name} {dur:.0f}s cuts/min {len(cuts) / dur * 60:.0f} shot p50 {np.median(shots):.1f}s p90 {np.percentile(shots, 90):.1f}s "
                f"motion {np.median(motion):.1f} quiet {quiet.mean():.0%}")
        if cj:
            lc = np.histogram(laugh, bins=np.arange(0, dur + 5, 5))[0]
            top = np.argsort(lc)[::-1][:3] * 5
            line += f" comments/min {len(ct) / dur * 60:.0f} laugh {len(laugh) / max(len(ct), 1):.0%} peaks {list(map(int, top))}"
        print(line)

        rows = [line, "", "秒   cuts motion  dB   com laugh 多い書き込み"]
        for a in range(0, int(dur), 5):
            m = (cuts / FPS >= a) & (cuts / FPS < a + 5)
            seg = slice(a * FPS, (a + 5) * FPS)
            near = [c["body"] for c in com if a <= c["t"] < a + 5]
            words = " / ".join(f"{w}×{k}" for w, k in Counter(near).most_common(4))
            rows.append(f"{a:4d} {int(m.sum()):4d} {np.median(motion[seg]) if len(motion[seg]) else 0:6.1f} {np.mean(db[a * 10:(a + 5) * 10]):5.0f} "
                        f"{len(near):4d} {sum(1 for b in near if LAUGH.search(b)):4d}  {words[:80]}")
        (out / f"{name}.timeline.txt").write_text("\n".join(rows), encoding="utf-8")

        heads = np.concatenate([[0], cuts])[:72]
        cols = 8
        sheet = Image.new("RGB", (cols * 240, 150 * ((len(heads) + cols - 1) // cols)), "gray")
        for k, f in enumerate(heads):
            im = Image.fromarray(v[min(f + 3, len(v) - 1)]).resize((236, 133))
            x, y = (k % cols) * 240, (k // cols) * 150
            sheet.paste(im, (x, y))
            ImageDraw.Draw(sheet).text((x + 4, y + 135), f"{f / FPS:.1f}s", fill="white")
        sheet.save(out / f"{name}.shots.png")


if __name__ == "__main__":
    main()
