"""BB劇場の筋を読むための台本を作る: whisper-small の書き起こしと時刻つきコメントを 10 秒ごとに並べる。

台詞は BGM ごと書き起こすので聞き違いが混ざる。コメント（視聴者が台詞や出来事を書き込む）と、
bb_theater_measure.py の shots.png（カットごとの最初の絵）と合わせて読む。
python -I bb_story_dump.py <outdir> <mp4> ...   → <outdir>/<id>.story.txt（コメントは refs/nigo/<id>.comments.json）
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa  # noqa: E402
from transformers import pipeline  # noqa: E402

ROW = 10.0
outdir = Path(sys.argv[1])
outdir.mkdir(parents=True, exist_ok=True)
asr = pipeline("automatic-speech-recognition", model="openai/whisper-small", device=-1)
for mp4 in map(Path, sys.argv[2:]):
    sid = mp4.stem
    y, _ = librosa.load(str(mp4), sr=16000)
    r = asr(y, chunk_length_s=30, return_timestamps=True, generate_kwargs={"language": "japanese", "task": "transcribe"})
    # whisper は BGM の上で同じ語を数百回くり返す幻聴を出すので、くり返しは「語×回数」に畳む
    fold = lambda s: re.sub(r"(.{1,12}?)\1{3,}", lambda m: f"{m.group(1)}×{len(m.group(0)) // len(m.group(1))}", s)  # noqa: E731
    lines = [(c["timestamp"][0] or 0.0, fold(c["text"].strip())) for c in r["chunks"] if c["text"].strip()]
    cp = paths.WORK / "refs" / "nigo" / f"{sid}.comments.json"
    info = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else {"description": "", "comments": []}
    coms = [(c["t"], re.sub(r"\s+", " ", c["body"])) for c in info["comments"]]
    dur = len(y) / 16000
    rows = [f"# {sid}  {dur:.0f}s  comments {len(coms)}", f"説明: {re.sub(r'<[^>]+>|&[a-z]+;', ' ', info.get('description', ''))[:300]}", ""]
    t = 0.0
    while t < dur:
        said = " / ".join(s for a, s in lines if t <= a < t + ROW)
        top = Counter(s[:24] for a, s in coms if t <= a < t + ROW).most_common(6)
        n = sum(1 for a, _ in coms if t <= a < t + ROW)
        rows.append(f"[{int(t // 60)}:{int(t % 60):02d}] 台詞: {said}")
        rows.append(f"        コメ{n}: " + "、".join(f"{s}×{k}" if k > 1 else s for s, k in top))
        t += ROW
    (outdir / f"{sid}.story.txt").write_text("\n".join(rows), encoding="utf-8")
    print(sid, len(lines), "lines")
