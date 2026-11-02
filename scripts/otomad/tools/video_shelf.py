"""BB劇場・音MAD の動画を見返すページ scratch/videos/index.html を書き出す（素材の絵と音を含むので手元だけで開く）。

見た目は scripts/misc/song-shelf.html と同じ（左に一覧、右に詳細）。載せるのは作品台帳の一覧
（docs/otomad/works/README.md の表）にある作品のうち、動画が手元にあるもの。動画の場所は台帳の
「書き出し: `…`」、無ければ scratch/<作品>/out/video.mp4、<作業フォルダ>/<作品>/video.mp4 の順に探す。
詳細には台帳（<作品>.md）の本文を出し、緩急計画の「区間（秒）」の行を押すとその秒へ移る。
コマの一覧（8枚）は scratch/videos/thumbs/ に作り、動画が新しくなったときだけ作り直す。

  python -I scripts/otomad/tools/video_shelf.py      → scratch/videos/index.html をブラウザで開く（file:// のままでよい）
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  作業フォルダ（OTOMAD_WORK）の場所
import imageio_ffmpeg  # noqa: E402

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
REPO = paths.REPO
WORKS = REPO / "docs" / "otomad" / "works"
OUT = REPO / "scratch" / "videos"
FRAMES = 8  # コマの一覧の枚数
JST = timezone(timedelta(hours=9))  # tzdata が無い Windows でも動くよう固定（日本に夏時間は無い）
MODEL = "Claude Opus 5.5"  # 作ったモデル（ほかの棚と同じく一覧に出す）。台帳に「モデル: …」があればそちら


def table_rows():
    """作品台帳の一覧の表 → [{id, date, kind, aim}]（表の順）。"""
    rows = []
    for line in (WORKS / "README.md").read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 4 and line.startswith("|") and cells[0] not in ("作品", "---"):
            rows.append({"id": cells[0], "date": cells[1], "kind": cells[2], "aim": cells[3]})
    return rows


def find_video(wid, md):
    m = re.search(r"書き出し:\s*`([^`]+\.mp4)`", md)
    cands = [REPO / m.group(1)] if m else []
    cands += [REPO / "scratch" / wid / "out" / "video.mp4", paths.WORK / wid / "video.mp4", paths.WORK / wid / "video_15fps.mp4"]
    return next((p for p in cands if p.exists()), None)


def probe(video):
    """ffmpeg -i の表示から長さ・大きさ・fps。"""
    err = subprocess.run([FFMPEG, "-hide_banner", "-i", str(video)], capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    f = {}
    if m := re.search(r"Duration: (\d+):(\d+):([\d.]+)", err):
        f["seconds"] = round(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]), 1)
    if m := re.search(r"Video:.*?(\d{3,5})x(\d{3,5})", err):
        f["size"] = f"{m[1]}x{m[2]}"
    if m := re.search(r"([\d.]+) fps", err):
        f["fps"] = float(m[1])
    return f


def frames(wid, video, seconds):
    """動画を等分した位置のコマを JPEG で書く（動画が新しくなったときだけ）。→ [{t, src}]"""
    d = OUT / "thumbs" / wid
    d.mkdir(parents=True, exist_ok=True)
    stamp = d / "stamp.txt"
    key = f"{video} {video.stat().st_mtime_ns}"
    times = [round(seconds * (i + 0.5) / FRAMES, 1) for i in range(FRAMES)]
    fresh = stamp.exists() and stamp.read_text(encoding="utf-8") == key
    for i, t in enumerate(times):
        jpg = d / f"{i:02d}.jpg"
        if fresh and jpg.exists():
            continue
        subprocess.run([FFMPEG, "-v", "error", "-y", "-ss", str(t), "-i", str(video), "-frames:v", "1",
                        "-vf", "scale=320:-2", "-q:v", "4", str(jpg)], check=True)
    stamp.write_text(key, encoding="utf-8")
    return [{"t": t, "src": f"thumbs/{wid}/{i:02d}.jpg"} for i, t in enumerate(times)]


def href(p):
    """index.html から動画への参照。同じドライブなら相対、違えば file:///。"""
    try:
        return Path(os.path.relpath(p, OUT)).as_posix()
    except ValueError:
        return p.resolve().as_uri()


def verdicts(md):
    """「所有者の評価」の箇条（中身のあるものだけ）。"""
    m = re.search(r"^## 所有者の評価\s*\n(.*?)(?=^## |\Z)", md, re.S | re.M)
    items = re.findall(r"^- (.+)$", m.group(1), re.M) if m else []
    return [x.strip() for x in items if x.strip() and not x.strip().startswith("<MM-DD>")]


def main():
    works, missing = [], []
    for r in table_rows():
        p = WORKS / f"{r['id']}.md"
        md = p.read_text(encoding="utf-8") if p.exists() else ""
        video = find_video(r["id"], md)
        if not video:
            missing.append(r["id"])
            continue
        f = probe(video)
        h1 = re.search(r"^# (.+)$", md, re.M)
        model = re.search(r"^- モデル:\s*(.+)$", md, re.M)
        v = verdicts(md)
        works.append({
            "id": r["id"], "title": h1[1] if h1 else r["id"], "kind": r["kind"], "aim": r["aim"],
            "at": datetime.fromtimestamp(video.stat().st_mtime, JST).strftime("%Y-%m-%d %H:%M"),
            "model": model[1].strip() if model else MODEL,
            "video": href(video), "videoPath": str(video), "facts": f,
            "frames": frames(r["id"], video, f["seconds"]) if f.get("seconds") else [],
            "verdict": v[-1] if v else "評価なし", "md": md or None,
        })
    works.sort(key=lambda x: x["at"], reverse=True)  # 一覧は新しい作品が上
    data = json.dumps({"works": works, "missing": missing}, ensure_ascii=False).replace("</", "<\\/")
    tpl = (Path(__file__).with_name("video_shelf.html")).read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(tpl.replace("/*SHELF*/{}", data), encoding="utf-8")
    print(OUT / "index.html", len(works), "videos;", "no video:", " ".join(missing) or "-")


if __name__ == "__main__":
    main()
