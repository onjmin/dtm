"""BB素材（ブルーバック・グリーンバックの淫夢・クッキー☆素材動画）を集めて、使う範囲を透過の連番 PNG にする。

  python -I bb_fetch.py search ガバ穴ダディー BB素材          # ニコニコで探す（再生数順。--check で取れるかも見る）
  python -I bb_fetch.py get sm28427080                      # 落とす → <AI>/<ジャンル>/BB/<id>/source.mp4・info.json
  python -I bb_fetch.py key sm28427080 現場監督_ドッスン --ss 0 --to 5
                                                            # 範囲を切って透過 → <AI>/<ジャンル>/BB/<id>/<名前>/0001.png…・sheet.png・meta.json
  python -I bb_fetch.py ls                                  # 集めた素材の一覧

- 地の色は既定で画面の縁から推定する（--color 0000FF のように手で渡してもよい）。縁の1〜2px を削り、地の色のにじみ（despill）を消す。
- 動画の書き出し（*_video.py）からは PIL で 0001.png… を順に読んで貼る。meta.json に fps・絵の外接矩形（bbox）がある。
- 取れるのはニコニコの「日本国内のみ」でない動画だけ（クラウドから）。YouTube はクラウドから取れないことがある。取れないものは手元の PC で同じコマンドを流す。
- 置き場は <AI> = OTOMAD_AI_DIR（既定 <SPEECH_MATERIAL_DIR>/AI、lib/paths.py）。ジャンルはタグから決める（クッキー☆ → エア本 → 淫夢 → その他 の順に見る）。
  外れたら get --genre で渡す。所有者が手で置いた素材（素材フォルダ直下）には書かない。
- <AI>/index.json に、集めた動画と切り抜きの一覧（ジャンル・題・URL・場所）を書き足していく。
- 素材は git に入れない・公開しない。
"""
import argparse
import json
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import numpy as np  # noqa: E402
from paths import AI, GENRES  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402

INDEX = AI / "index.json"


def guess_genre(tags):
    t = " ".join(tags or [])
    if "クッキー☆" in t or "ク☆" in t:
        return "クッキー☆"
    if "エア本" in t:
        return "エア本"
    if "淫夢" in t or "例のアレ" in t:
        return "淫夢"
    return "その他"


def find(cid):
    """<AI>/<ジャンル>/BB/<id> を探す。"""
    for g in GENRES:
        if (AI / g / "BB" / cid).is_dir():
            return AI / g / "BB" / cid
    sys.exit(f"{cid} はまだ落としていない（get を先に）")


def index_put(cid, **kw):
    ix = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}
    e = ix.setdefault(cid, {"cuts": {}})
    cuts = kw.pop("cut", None)
    e.update(kw)
    if cuts:
        e["cuts"].update(cuts)
    AI.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(ix, ensure_ascii=False, indent=1), encoding="utf-8")
SEARCH = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search"
UA = "dtm-otomad-bb-fetch"


def nico_search(q, limit):
    qs = urllib.parse.urlencode({
        "q": q, "targets": "title,tags", "_sort": "-viewCounter", "_limit": limit,
        "fields": "contentId,title,viewCounter,lengthSeconds,tags",
    })
    with urllib.request.urlopen(urllib.request.Request(f"{SEARCH}?{qs}", headers={"User-Agent": UA}), timeout=30) as r:
        return json.load(r)["data"]


def available(cid):
    r = subprocess.run(["yt-dlp", "--no-warnings", "--simulate", "--print", "id", f"https://www.nicovideo.jp/watch/{cid}"],
                       capture_output=True, text=True)
    return r.returncode == 0


def cmd_search(a):
    for x in nico_search(" ".join(a.query), a.limit):
        ok = "" if not a.check else ("取れる " if available(x["contentId"]) else "取れない ")
        print(f'{x["contentId"]}\t{x["lengthSeconds"]}s\t{x["viewCounter"]}\t{ok}{x["title"]}\t| {x["tags"][:100]}')


def url_of(src):
    return src if "://" in src else f"https://www.nicovideo.jp/watch/{src}"


def cmd_get(a):
    url = url_of(a.src)
    info = json.loads(subprocess.run(["yt-dlp", "--no-warnings", "-J", url], capture_output=True, text=True, check=True).stdout)
    genre = a.genre or guess_genre(info.get("tags"))
    d = AI / genre / "BB" / info["id"]
    d.mkdir(parents=True, exist_ok=True)
    subprocess.run(["yt-dlp", "--no-warnings", "-q", "-f", f"bv*[height<={a.height}]+ba/b", "--merge-output-format", "mp4",
                    "-o", str(d / "source.%(ext)s"), url], check=True)
    keep = {k: info.get(k) for k in ["id", "title", "webpage_url", "uploader", "upload_date", "duration", "tags", "description"]}
    (d / "info.json").write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
    sheet(d / "source.mp4", d / "sheet.png", info.get("duration") or 60)
    index_put(info["id"], genre=genre, title=info.get("title"), url=info.get("webpage_url"), dir=str(d.relative_to(AI)))
    print(d)


def sheet(src, out, dur, n=20):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", f"fps={n}/{max(dur, 1)},scale=240:-1,tile=5x4",
                    "-frames:v", "1", str(out)], check=True)


def probe(src):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate",
                        "-of", "json", str(src)], capture_output=True, text=True, check=True)
    s = json.loads(r.stdout)["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return s["width"], s["height"], float(num) / float(den)


def read_frames(src, ss, to, fps):
    w, h, f0 = probe(src)
    vf = [f"fps={fps}"] if fps else []
    cmd = ["ffmpeg", "-v", "error", "-ss", str(ss), "-to", str(to), "-i", str(src)]
    cmd += (["-vf", ",".join(vf)] if vf else []) + ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3), fps or f0


def guess_key(frames):
    """画面の縁の画素でいちばん多い色（量子化して数える）を地の色とする。"""
    f = frames[:: max(1, len(frames) // 10)]
    edge = np.concatenate([x.reshape(-1, 3) for x in (f[:, 0], f[:, -1], f[:, :, 0], f[:, :, -1])])
    q = (edge // 16).astype(np.int32)
    keys, cnt = np.unique(q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2], return_counts=True)
    top = keys[cnt.argmax()]
    m = (q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]) == top
    return edge[m].mean(0)


def key_alpha(rgb, key, tol, soft):
    """色差（Cb・Cr 平面の距離）で透明度を決める。明るさの違いに強い。"""
    def cbcr(x):
        x = x.astype(np.float32)
        y = 0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2]
        return np.stack([x[..., 2] - y, x[..., 0] - y], -1)
    d = np.linalg.norm(cbcr(rgb) - cbcr(np.asarray(key)[None, None]), axis=-1)
    return np.clip((d - tol) / max(soft, 1e-3), 0, 1)


def despill(rgb, key):
    """地の色の成分（いちばん強い原色）が他の2色の最大を超える分を削る。"""
    out = rgb.astype(np.float32)
    c = int(np.argmax(key))
    others = [i for i in range(3) if i != c]
    out[..., c] = np.minimum(out[..., c], out[..., others].max(-1))
    return out.clip(0, 255).astype(np.uint8)


def cmd_key(a):
    d = find(a.id)
    src = d / "source.mp4"
    frames, fps = read_frames(src, a.ss, a.to, a.fps)
    key = np.array([int(a.color[i:i + 2], 16) for i in (0, 2, 4)], np.float32) if a.color else guess_key(frames)
    out = d / a.name
    out.mkdir(parents=True, exist_ok=True)
    for p in out.glob("*.png"):
        p.unlink()
    union = None
    for i, fr in enumerate(frames):
        al = key_alpha(fr, key, a.tol, a.soft)
        am = Image.fromarray((al * 255).astype(np.uint8))
        if a.erode:
            am = am.filter(ImageFilter.MinFilter(a.erode * 2 + 1))
        am = am.filter(ImageFilter.GaussianBlur(0.6))
        im = Image.fromarray(despill(fr, key)).convert("RGBA")
        im.putalpha(am)
        im.save(out / f"{i + 1:04d}.png")
        b = im.getbbox()
        if b:
            union = b if union is None else (min(union[0], b[0]), min(union[1], b[1]), max(union[2], b[2]), max(union[3], b[3]))
    meta = {"source": a.id, "ss": a.ss, "to": a.to, "fps": fps, "frames": len(frames), "key_rgb": [round(float(v)) for v in key],
            "bbox": union, "size": [frames.shape[2], frames.shape[1]]}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    check_sheet(out, len(frames))
    index_put(a.id, cut={a.name: {"dir": str(out.relative_to(AI)), "ss": a.ss, "to": a.to, "frames": len(frames)}})
    print(out, meta)


def check_sheet(out, n, k=10):
    """透過の確かめ用。市松の地に k コマ並べた sheet.png を書く。"""
    idx = np.linspace(1, n, min(k, n)).astype(int)
    ims = [Image.open(out / f"{i:04d}.png") for i in idx]
    w, h = ims[0].size
    s = 200 / w
    tw, th = int(w * s), int(h * s)
    board = Image.new("RGBA", (tw * 5, th * ((len(ims) + 4) // 5)))
    yy, xx = np.indices((board.height, board.width))
    cb = (yy // 12 + xx // 12) % 2
    board = Image.fromarray(np.where(cb[..., None], 200, 120).astype(np.uint8).repeat(4, -1)).convert("RGBA")
    for j, im in enumerate(ims):
        board.alpha_composite(im.resize((tw, th)), (j % 5 * tw, j // 5 * th))
    board.convert("RGB").save(out / "sheet.png")


def cmd_ls(a):
    for d in sorted(AI.glob("*/BB/*")):
        info = json.loads((d / "info.json").read_text(encoding="utf-8")) if (d / "info.json").exists() else {}
        cuts = [p.name for p in d.iterdir() if (p / "meta.json").exists()]
        print(f'{d.parents[1].name}\t{d.name}\t{info.get("title", "")}\t切り抜き: {", ".join(cuts) or "なし"}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(required=True)
    s = sp.add_parser("search")
    s.add_argument("query", nargs="+")
    s.add_argument("--limit", type=int, default=15)
    s.add_argument("--check", action="store_true", help="取れるか（地域制限が無いか）も見る")
    s.set_defaults(f=cmd_search)
    g = sp.add_parser("get")
    g.add_argument("src", help="sm… か URL")
    g.add_argument("--height", type=int, default=720)
    g.add_argument("--genre", choices=GENRES, help="既定はタグから推定")
    g.set_defaults(f=cmd_get)
    k = sp.add_parser("key")
    k.add_argument("id")
    k.add_argument("name", help="切り抜きの名前（フォルダ名になる）")
    k.add_argument("--ss", type=float, default=0)
    k.add_argument("--to", type=float, required=True)
    k.add_argument("--fps", type=float, default=0, help="0 なら元のまま")
    k.add_argument("--color", help="地の色 RRGGBB（既定は縁から推定）")
    k.add_argument("--tol", type=float, default=40, help="地の色からの色差がこれ以下は透明")
    k.add_argument("--soft", type=float, default=30, help="半透明にする幅")
    k.add_argument("--erode", type=int, default=1, help="縁を削る px")
    k.set_defaults(f=cmd_key)
    sp.add_parser("ls").set_defaults(f=cmd_ls)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
