"""Plasticookie☆Adventure型の動画（使い捨て）。本編（refs/nigo/sm18319732）の画面の型に合わせる:
- 地は紺の唐草の壁紙。後ろで青い輪が回る。ひし形の窓・両脇の板・窓の中の万華鏡で MZ の絵を出す。
- 41小節目から輪の中が砂嵐になり、野獣の台詞が字幕で少しずつ出る。57小節目（一転攻勢）からは青い格子の砂嵐の地に、
  赤・黄のモザイクの窓。絵の無い淫夢素材は、本編と同じくモザイクで隠したまま字幕だけ出す。

python -I plasti_video.py <outdir>   （<outdir>/song.wav・offset.txt・placement.json → video.mp4）
"""
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 30
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
CROP_PX = {"face": 640, "scene": 900}
CHAR = "MZ"
FONT = "C:/Windows/Fonts/yumindb.ttf"

od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
OFF = float((od / "offset.txt").read_text())
BEAT = 60 / info["bpm"]
SIX = BEAT / 4
BARS = BEAT * 4
MOD = info["modBar"]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
kinds = {}
for b in info["blocks"]:
    for k in range(4):
        kinds[b["bar"] + k] = b["kind"]
raw = [p for p in info["placed"] if p["kind"] == "raw"]
for p in raw:
    p["t"] = OFF + (p["bar"] - 1) * BARS
    m = re.search(r"「(.+?)」", Path(p["file"]).stem)
    full = re.sub(r"[(（].*?[)）]", "", m.group(1)) if m else p["text"]
    p["show"] = full if not p["text"].endswith("…") else p["text"]
KICKS = (0, 8, 9)  # 16beat のキックの16分位置
rng = np.random.default_rng(11)
_cache = {}


def memo(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


def font(size):
    return memo(("font", size), lambda: ImageFont.truetype(FONT, size))


def img(kind, i):
    return memo((kind, i), lambda: Image.open(sorted((PACK / kind / CHAR).glob("*.png"))[i]).convert("RGBA"))


NFACE = len(list((PACK / "face" / CHAR).glob("*.png")))
NSCENE = len(list((PACK / "scene" / CHAR).glob("*.png")))


def cover(kind, i, w, h, flip=False):
    def make():
        im = img(kind, i)
        s = CROP_PX[kind]
        cw, ch = (s, s * h / w) if w >= h else (s * w / h, s)
        x0, y0 = (im.width - cw) / 2, (im.height - ch) / 2
        c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((w, h), Image.LANCZOS)
        if flip:
            c = c.transpose(Image.FLIP_LEFT_RIGHT)
        bg = Image.new("RGBA", (w, h), (232, 238, 250, 255))
        bg.alpha_composite(c)
        return bg
    return memo(("cover", kind, i, w, h, flip), make)


def wallpaper():
    """紺の唐草: 絵の影を4方向に折り返した飾りを互い違いに敷く。"""
    T = 240
    sil = img("scene", 0).split()[3].resize((T // 2, T // 2))
    q = Image.new("L", (T, T))
    q.paste(sil, (0, 0))
    q.paste(sil.transpose(Image.FLIP_LEFT_RIGHT), (T // 2, 0))
    q.paste(q.crop((0, 0, T, T // 2)).transpose(Image.FLIP_TOP_BOTTOM), (0, T // 2))
    edge = ImageChops.subtract(q.filter(ImageFilter.MaxFilter(7)), q.filter(ImageFilter.MinFilter(3)))
    big = Image.new("L", (W + 2 * T, H + 2 * T))
    for yy in range(0, H + 2 * T, T // 2):
        for xx in range(-T, W + 2 * T, T):
            big.paste(edge, (xx + (T // 2 if (yy // (T // 2)) % 2 else 0), yy), edge)
    a = np.asarray(big, np.float32)[..., None] / 255
    base = np.array([8, 14, 44], np.float32)
    ink = np.array([40, 70, 150], np.float32)
    return base + (ink - base) * a * 0.8


WALL = wallpaper()
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = np.clip(1.3 - np.hypot((xx - W / 2) / (W * 0.55), (yy - H / 2) / (H * 0.62)), 0.2, 1.0)[..., None]


def background(t, pulse):
    ox, oy = int(t * 12) % 240, int(t * 5) % 120
    a = WALL[oy:oy + H, ox:ox + W] * VIG * (0.85 + 0.3 * pulse)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def rings(frame, t, pulse, r0=330):
    """本編の青い輪: 太い弧が2本、逆向きに回る。"""
    d = ImageDraw.Draw(frame)
    cx, cy = W / 2, H / 2
    for j, (sp, wd, col) in enumerate(((50, 34, (60, 150, 255, 255)), (-35, 18, (150, 210, 255, 255)))):
        r = r0 + 46 * j + 10 * pulse
        a0 = (t * sp) % 360
        for k in range(3):
            d.arc((cx - r, cy - r, cx + r, cy + r), a0 + k * 120, a0 + k * 120 + 70, fill=col, width=wd)


def paste_shadow(frame, im, x, y):
    sh = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((12, 12, im.width + 12, im.height + 12), fill=(0, 0, 20, 170))
    frame.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)), (x - 6, y + 4))
    frame.alpha_composite(im, (x, y))


def diamond(im):
    m = Image.new("L", im.size, 0)
    w, h = im.size
    ImageDraw.Draw(m).polygon([(w / 2, -h * 0.12), (w * 1.08, h / 2), (w / 2, h * 1.12), (-w * 0.08, h / 2)], fill=255)
    out = im.copy()
    out.putalpha(ImageChops.multiply(im.split()[3], m))
    return out


def mirror4(im):
    w, h = im.size
    q = im.crop((0, 0, w // 2, h // 2))
    out = Image.new("RGBA", (w, h))
    out.paste(q, (0, 0))
    out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (w // 2, 0))
    out.paste(out.crop((0, 0, w, h // 2)).transpose(Image.FLIP_TOP_BOTTOM), (0, h // 2))
    return out


def static(w, h, t, tint=(0.6, 0.8, 1.0), coarse=4):
    n = rng.random((h // coarse, w // coarse)) ** 1.6
    rows = (np.sin(np.arange(h // coarse) * 0.9 + t * 40) > 0.6)[:, None] * 0.35
    a = np.clip(n + rows, 0, 1)
    return Image.fromarray((a[..., None] * np.array(tint) * 255).astype(np.uint8)).resize((w, h), Image.NEAREST).convert("RGBA")


def mosaic(w, h, seed, cell=28):
    """本編後半のモザイク: 赤・黄・緑・黒の粗い升目。隠したものが何かは分からない。"""
    r = np.random.default_rng(seed)
    pal = np.array([[200, 30, 20], [240, 200, 40], [30, 30, 30], [60, 150, 40], [150, 20, 10], [250, 120, 30]])
    g = pal[r.integers(0, len(pal), (h // cell + 1, w // cell + 1))].astype(np.uint8)
    return Image.fromarray(g).resize(((w // cell + 1) * cell, (h // cell + 1) * cell), Image.NEAREST).crop((0, 0, w, h)).convert("RGBA")


def grid_bg(t, pulse):
    """一転攻勢の地: 青い格子の砂嵐。縦横の光る線が流れる。"""
    base = static(W, H, t, (0.25, 0.45, 1.0), coarse=6)
    d = ImageDraw.Draw(base)
    for j in range(9):
        x = int((j * 160 + t * 220) % (W + 80)) - 40
        d.rectangle((x, 0, x + 6 + 4 * (j % 3), H), fill=(200, 230, 255, 255))
    for j in range(5):
        y = int((j * 170 - t * 130) % (H + 60)) - 30
        d.rectangle((0, y, W, y + 5 + 3 * (j % 2)), fill=(220, 240, 255, 255))
    return Image.blend(base, Image.new("RGBA", (W, H), (255, 255, 255, 255)), 0.25 * pulse)


def subtitle(frame, text, y, size=58, col=(255, 255, 255, 255), edge=(170, 0, 0, 255)):
    f = font(size)
    d = ImageDraw.Draw(frame)
    w = d.textlength(text, font=f)
    if w > W - 60:
        f = font(int(size * (W - 60) / w))
        w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=col, stroke_width=4, stroke_fill=edge)


def kick_index(t):
    s = int(np.floor((t - OFF) / SIX))
    bar, pos = divmod(s, 16)
    return bar * 3 + sum(1 for k in KICKS if k <= pos)


def frame_at(t):
    rel = t - OFF
    bar = int(np.floor(rel / BARS)) + 1
    kind = kinds.get(bar, "intro" if bar < 1 else "outro")
    beat_ph = (rel / BEAT) % 1 * BEAT
    pulse = float(np.exp(-beat_ph / 0.1)) if bar >= 1 else 0.0
    ki = kick_index(t)
    face = lambda j: (j * 5) % NFACE  # noqa: E731
    line = next((p for p in reversed(raw) if p["t"] <= t < p["t"] + BARS * 1.9), None)
    end_t = OFF + info["endStep"] / 12 * SIX

    if t >= end_t - 0.05:  # 曲を切った後: 砂嵐の地に最後の「ファッ！？」
        frame = static(W, H, t, (0.3, 0.45, 0.9), coarse=3)
        last = raw[-1]
        if t >= last["t"]:
            k = min(1.0, (t - last["t"]) / 0.15)
            frame.alpha_composite(mosaic(520, 520, 999, cell=int(20 + 30 * k)), ((W - 520) // 2, (H - 520) // 2 - 40))
            subtitle(frame, last["show"], H - 150, size=int(80 + 20 * (1 - k)))
        return frame

    if bar >= MOD:  # 一転攻勢
        frame = grid_bg(t, pulse)
        s = 560 + int(24 * pulse)
        m = mosaic(s, s, ki, cell=32 if kind != "hookEnd" else 24)
        m = diamond(m) if (bar // 2) % 2 else m
        frame.alpha_composite(m, ((W - s) // 2, (H - s) // 2 - 30))
        if line is not None:
            subtitle(frame, line["show"], H - 130)
            if t - line["t"] < 0.12:
                frame = Image.blend(frame, Image.new("RGBA", (W, H), (255, 255, 255, 255)), 0.5 * (1 - (t - line["t"]) / 0.12))
        return frame

    frame = background(t, pulse)
    if kind in ("intro", "intro2"):  # 輪の中に長方形の窓、2小節ごと
        rings(frame, t, pulse)
        w, h = 620, 460
        paste_shadow(frame, cover("face", face(bar // 2), w, h), (W - w) // 2, (H - h) // 2)
    elif kind == "verse":  # ひし形、1小節ごと
        w, h = 900, 640
        frame.alpha_composite(diamond(cover("face", face(bar), w, h)), ((W - w) // 2, (H - h) // 2))
    elif kind == "pre":  # ひし形＋両脇の板が流れる
        w, h = 900, 640
        for j, x in enumerate((-250 + int(rel * 40) % 120, W - 230 - int(rel * 40) % 120)):
            paste_shadow(frame, cover("scene", (bar * 3 + j) % NSCENE, 300, 560, flip=bool(j)), x, 80)
        frame.alpha_composite(diamond(cover("face", face(bar), w, h)), ((W - w) // 2, (H - h) // 2))
    elif kind.startswith("hook"):  # 輪＋大窓、キックで入れ替え。サビ2 は窓の中の万華鏡
        rings(frame, t, pulse, r0=360)
        w, h = 760, 540
        im = cover("face", face(ki), w, h, flip=ki % 2 == 1)
        if kind == "hook2":
            im = mirror4(im)
        s = 1 + 0.035 * pulse
        im = im.resize((int(w * s), int(h * s)), Image.BILINEAR)
        paste_shadow(frame, im, (W - im.width) // 2, (H - im.height) // 2)
    else:  # ため（41〜56）: 輪の中が砂嵐。野獣の声が伸びるほどモザイクが透けて、字幕が出る
        rings(frame, t, pulse, r0=300)
        ow = 520
        reveal = min(0.85, 0.12 + (bar - 41) * 0.05)
        st = Image.blend(static(ow, ow, t), mosaic(ow, ow, bar // 4), reveal)
        mk = Image.new("L", (ow, ow), 0)
        ImageDraw.Draw(mk).ellipse((0, 0, ow, ow), fill=255)
        st.putalpha(mk)
        frame.alpha_composite(st, ((W - ow) // 2, (H - ow) // 2))
        if bar >= 49:  # 後半は MZ の絵が両脇から押し出されていく
            off = int((bar - 49 + (rel / BARS) % 1) * 30)
            for j, x in enumerate((-120 - off, W - 180 + off)):
                paste_shadow(frame, cover("scene", (bar + j) % NSCENE, 300, 560, flip=bool(j)), x, 80)
    if line is not None and bar < MOD and "野獣" in line["who"]:
        subtitle(frame, line["show"], H - 120, size=52)
    return frame


ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                       "-i", str(od / "song.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                       "-c:a", "aac", "-b:a", "192k", "-shortest", str(od / "video.mp4")], stdin=subprocess.PIPE)
for f in range(NF):
    t = f / FPS
    fr = frame_at(t)
    if t > dur - 0.8:
        fr = Image.blend(fr, Image.new("RGBA", (W, H), (0, 0, 0, 255)), min(1, (t - dur + 0.8) / 0.8))
    ff.stdin.write(fr.convert("RGB").tobytes())
    if f % 900 == 0:
        print(f, "/", NF, flush=True)
ff.stdin.close()
ff.wait()
print("done", od / "video.mp4")
