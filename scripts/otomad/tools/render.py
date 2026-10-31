"""台詞1本を旋律に写して聴き比べ WAV を作る（使い捨て）。

python -I render.py <in.wav> <out.wav> [bpm]
出力: 原音 → 写した旋律（サイン波）→ 重ね、の順。
"""
import sys

import librosa
import numpy as np
import soundfile as sf

from pathlib import Path  # noqa: E402

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402,F401
from measure import analyze  # noqa: E402
from summarize import MAJOR, best_snap  # noqa: E402

SR = 16000


def main():
    src, dst = sys.argv[1], sys.argv[2]
    bpm = float(sys.argv[3]) if len(sys.argv) > 3 else 150
    r = analyze(src)
    y, _ = librosa.load(src, sr=SR, mono=True)
    segs = r["segs"]
    med = np.array([s["med"] for s in segs])
    q = best_snap(med, MAJOR)
    six = 15 / bpm
    base = r["medHz"]
    mel = np.zeros_like(y)
    for s, n in zip(segs, q):
        a = int(round(s["t"] / six)) * six  # 頭を16分へ
        ln = max(1, round(s["len"] / six)) * six
        i0, i1 = int(a * SR), min(len(mel), int((a + ln) * SR))
        if i1 <= i0:
            continue
        t = np.arange(i1 - i0) / SR
        hz = base * 2 ** (n / 12)
        env = np.minimum(1, np.minimum(t / 0.01, (t[-1] - t + 1e-9) / 0.03))
        mel[i0:i1] += 0.25 * env * np.sin(2 * np.pi * hz * t)
    y = y / (np.abs(y).max() + 1e-9) * 0.8
    gap = np.zeros(int(0.6 * SR))
    sf.write(dst, np.concatenate([y, gap, mel, gap, 0.7 * y + mel]), SR)
    print(f"{len(segs)} notes, span {q.max() - q.min():.0f} st, base {base:.0f} Hz")


if __name__ == "__main__":
    main()
