"""クッキー☆ × Dandelion biscuit☆型の動画 1（使い捨て）。YouTube の再掲（refs/nigo/dandelion_yt.mp4）で見た型に合わせる。

型: 淡い灰色の万華鏡の地がずっと流れ続け、その上に絵の板を立体的に傾けて並べる。最初は左右に小さな板2枚（霊夢・魔理沙）、
曲が進むと後ろに大きな寄りの板が足され、自分を囲む湾曲した壁になる。終盤は真ん中の板の色を熱画像の色に置き換える。
しゃべっている側の板が台詞の頭で跳ねる。全画面の計算は torch（GPU）。
python -I dande1_video.py <outdir> [確認用の秒 ...]   FPS=15 で確認用（video_15fps.mp4）
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

W, H = 960, 720
FPS = int(os.environ.get("FPS", "30"))
DEV = torch.device("cuda" if torch.cuda.is_available() else "cpu")
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
HEADT = info["head"]
BEAT = 60 / info["bpm"]
BARS = BEAT * 4
SECS = [(s["name"], s["from"] - 1, s["to"]) for s in info["sections"]]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
LINES = [(HEADT + (p["bar"] - 1) * BARS, p["who"]) for p in info["placed"]]


def sec_at(t):
    bar = (t - HEADT) / BARS
    for s, a_, b_ in SECS:
        if a_ <= bar < b_:
            return s, bar - a_, bar
    return ("outro" if bar >= 0 else "pre"), bar, bar


# ── 絵の板（白い台紙に絵を載せる） ──
def card(path, w=512, h=384):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").point(lambda v: 255 if v > 32 else 0).getbbox()
    im = im.crop(bb) if bb else im
    sc = max(w / im.width, h / im.height)  # 台紙いっぱいに（はみ出しは切る。縦長は上を残す）
    im = im.resize((max(w, int(im.width * sc)), max(h, int(im.height * sc))), Image.LANCZOS)
    x0, y0 = (im.width - w) // 2, int((im.height - h) * 0.12)
    c = Image.new("RGBA", (w, h), (244, 242, 238, 255))
    c.alpha_composite(im.crop((x0, y0, x0 + w, y0 + h)))
    a = torch.from_numpy(np.array(c)).to(DEV).float().permute(2, 0, 1)[None] / 255
    return a


def pick(who, kind, idx):
    fs = sorted((PACK / kind / who).glob("*.png"))
    return [card(fs[i % len(fs)]) for i in idx]


RU_SMALL = pick("RU", "face", [4, 22, 40])
UD_SMALL = pick("UDK", "face", [3, 17, 33])
WALL = pick("RU", "face", [9, 31, 58, 77]) + pick("UDK", "face", [8, 25, 44, 60]) + pick("RU", "scene", [5, 50]) + pick("UDK", "scene", [10, 40])
WALL = [WALL[i] for i in (0, 4, 1, 5, 2, 6, 3, 7, 8, 10, 9, 11)]  # 霊夢と魔理沙を交互に

# ── 万華鏡の地: 絵を灰色にぼかした模様を鏡写しで敷き詰め、回しながら流す ──
_src = Image.open(sorted((PACK / "scene" / "RU").glob("*.png"))[12]).convert("RGBA")
_bgc = Image.new("RGBA", _src.size, (200, 196, 190, 255))
_bgc.alpha_composite(_src)
from PIL import ImageFilter  # noqa: E402
_g = np.asarray(_bgc.convert("L").resize((512, 512)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
BG_SRC = torch.from_numpy(0.82 + 0.08 * (_g - _g.mean()) / (_g.std() + 1e-6)).clamp(0.5, 0.95).to(DEV)[None, None]
yy, xx = torch.meshgrid(torch.linspace(-1, 1, H, device=DEV), torch.linspace(-W / H, W / H, W, device=DEV), indexing="ij")
RR = torch.sqrt(xx ** 2 + yy ** 2)
VIG = (1 - 0.45 * ((RR - 0.75) / 0.8).clamp(0, 1) ** 1.5)[None]
PIX = torch.stack([(xx * H / 2 + W / 2).flatten(), ((yy + 1) * H / 2).flatten(), torch.ones(H * W, device=DEV)])


def tri(v):
    return 1 - torch.abs(torch.remainder(v, 2) - 1)  # 鏡写しの敷き詰め


def background(t):
    a = 0.22 * t
    sc = 1.3 + 0.35 * np.sin(t * 0.5)
    u = (xx * np.cos(a) - yy * np.sin(a)) * sc + 0.35 * t
    v = (xx * np.sin(a) + yy * np.cos(a)) * sc + 0.2 * t
    u, v = tri(u * 1.6), tri(v * 1.6)
    # 4つ折り: 中心の対称（万華鏡）
    g = torch.stack([2 * u - 1, 2 * v - 1], -1)[None]
    x = F.grid_sample(BG_SRC, g, mode="bilinear", padding_mode="reflection", align_corners=False)[0]
    return x.repeat(3, 1, 1) * torch.tensor([1.0, 0.99, 0.96], device=DEV)[:, None, None]


# ── 立体の板: 3次元の四隅を写して、画面→板の射影を GPU で引く ──
FOCAL = 620.0


def project(p):
    x, y, z = p
    return np.array([W / 2 + FOCAL * x / z, H / 2 + FOCAL * y / z])


def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    h = np.linalg.solve(np.array(A, np.float64), np.array(dst, np.float64).flatten())
    return np.append(h, 1).reshape(3, 3)


def panel(canvas, tex, center, w, h, yaw=0.0, pitch=0.0, roll=0.0, alpha=1.0, thermal=False):
    cy_, sy_ = np.cos(yaw), np.sin(yaw)
    cp, sp = np.cos(pitch), np.sin(pitch)
    cr, sr_ = np.cos(roll), np.sin(roll)
    corners = []
    for ux, uy in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
        x, y, z = ux * w, uy * h, 0.0
        x, y = x * cr - y * sr_, x * sr_ + y * cr
        y, z = y * cp - z * sp, y * sp + z * cp
        x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
        corners.append((center[0] + x, center[1] + y, center[2] + z))
    if min(c[2] for c in corners) < 0.15:
        return
    scr = [project(c) for c in corners]
    Hm = homography(scr, [(0, 0), (1, 0), (1, 1), (0, 1)])  # 画面 → 板の uv
    uvw = torch.from_numpy(Hm).float().to(DEV) @ PIX
    u = (uvw[0] / uvw[2]).view(H, W)
    v = (uvw[1] / uvw[2]).view(H, W)
    g = torch.stack([2 * u - 1, 2 * v - 1], -1)[None]
    s = F.grid_sample(tex, g, mode="bilinear", padding_mode="zeros", align_corners=False)[0]
    rgb, a = s[:3], s[3:4] * alpha
    if thermal:
        lum = (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]).clamp(0, 1)
        rgb = torch.stack([(1.5 - (4 * lum - 3).abs()).clamp(0, 1), (1.5 - (4 * lum - 2).abs()).clamp(0, 1),
                           (1.5 - (4 * lum - 1).abs()).clamp(0, 1)])  # 熱画像の色（青→水→緑→黄→赤）
    canvas.mul_(1 - a).add_(rgb * a)


def line_pop(t, who):
    """その人の台詞の頭で跳ねる（すぐ戻す）"""
    best = 0.0
    for t0, w in LINES:
        if w == who and 0 <= t - t0 < 0.6:
            best = max(best, np.exp(-(t - t0) / 0.15))
    return best


def frame_at(f):
    t = f / FPS
    s, rel, bar = sec_at(t)
    beats = (t - HEADT) / BEAT
    bob = np.exp(-(beats % 1) * 5) if s not in ("intro", "pre") else 0.0
    canvas = background(t)
    # 湾曲した壁（後ろ）: build で1枚 → A で5枚 → solo で回り出す → B から7枚、thermal は真ん中を熱画像に
    n_wall = {"build": 1, "A": 5, "solo": 5, "B": 7, "thermal": 7}.get(s, 0)
    fade = 1.0
    if s == "build":
        fade = min(1.0, rel / 2)
    if s == "outro":
        n_wall, fade = 7, max(0.0, 1 - rel / 2)
    drift = 0.0 if s in ("build", "A") else 0.05 * np.sin((t - HEADT) * 0.35)
    if s == "solo":
        drift = 0.12 * np.sin((t - HEADT) * 0.8)
    Rc = 2.7
    order = sorted(range(n_wall), key=lambda k: -abs(k - (n_wall - 1) / 2))
    for k in order:
        ang = (k - (n_wall - 1) / 2) * 0.44 + drift
        if s == "build":
            ang = -0.32
        c = (Rc * np.sin(ang), 0.05 * np.sin(beats * np.pi / 2 + k), Rc * np.cos(ang) - 0.9)
        tex = WALL[(k + (2 if s == "B" or s == "thermal" else 0) + int(max(0, bar - 40) // 2) * (s == "thermal")) % len(WALL)]
        hot = s == "thermal" and (abs(k - (n_wall - 1) / 2) < 0.6 or (int(bar) % 2 == 1 and abs(k - (n_wall - 1) / 2) < 1.6))
        panel(canvas, tex, c, 1.25, 1.2, yaw=-ang, alpha=fade, thermal=hot)
    # 手前の小さな板2枚（左 霊夢・右 魔理沙）。拍で揺れ、台詞の頭で跳ねる
    for side, who, texs in ((-1, "RU姉貴", RU_SMALL), (1, "UDK姉貴", UD_SMALL)):
        pop = line_pop(t, who)
        sz = 1.0 + 0.18 * pop + 0.03 * bob
        idx = int(max(0, bar) // 8) % len(texs)
        yaw = side * (0.45 + 0.12 * np.sin(t * 1.1 + side)) * -1
        c = (side * 0.95, -0.05 - 0.06 * pop, 2.3 - 0.25 * pop)
        op = 1.0 if s != "outro" else max(0.0, 1 - max(0.0, rel - 2) / 1.5)
        panel(canvas, texs[idx], c, 0.62 * sz, 0.5 * sz, yaw=yaw, pitch=0.08 * np.sin(t * 0.9 + side), roll=0.04 * side * bob,
              alpha=op, thermal=(s == "thermal" and int(bar) % 4 == 3))
    out = canvas * VIG
    if s == "outro" and rel > 3:
        out = out * max(0.0, 1 - (rel - 3) * 1.2)
    if bar < 0.2:
        out = out * max(0.0, (bar + 0.05) / 0.25)
    return (out.clamp(0, 1) * 255).to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy()


def main():
    only = [int(v) for v in sys.argv[2:]]
    if only:
        for sec in only:
            Image.fromarray(frame_at(int(sec * FPS))).save(od / f"frame_{sec:03d}.png")
        return
    import time
    from multiprocessing import Pool
    out_name = "video.mp4" if FPS == 30 else f"video_{FPS}fps.mp4"
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-i", str(od / "song.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", str(od / out_name)], stdin=subprocess.PIPE)
    t0 = time.time()
    with Pool(int(os.environ.get("JOBS", "4"))) as pool:
        for f, fr in enumerate(pool.imap(frame_at, range(NF), chunksize=8)):
            ff.stdin.write(fr.tobytes())
    ff.stdin.close()
    ff.wait()
    print("done", od / out_name, round(time.time() - t0, 1), "s")


if __name__ == "__main__":
    main()
