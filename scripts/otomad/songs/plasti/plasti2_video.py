"""Plasticookie☆Adventure型の動画 2（使い捨て）。plasti_video の型に動きを足した版（参考元より動きが少ないと言われた）。本編（refs/nigo/sm18319732）の画面の型に合わせる:
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


PAL = np.array([[200, 30, 20], [240, 200, 40], [30, 30, 30], [60, 150, 40], [150, 20, 10], [250, 120, 30]])


def mosaic(w, h, seed, cell=28, t=None):
    """本編後半のモザイク: 赤・黄・緑・黒の粗い升目。隠したものが何かは分からない。
    t を渡すと止まらない: 毎コマ升目の3割を塗り替え、行ごとに横へずらし、拍ごとに色を1つ回す。"""
    r = np.random.default_rng(seed)
    gh, gw = h // cell + 1, w // cell + 1
    ids = r.integers(0, len(PAL), (gh, gw))
    if t is not None:
        live = rng.random((gh, gw)) < 0.3
        ids = np.where(live, rng.integers(0, len(PAL), (gh, gw)), ids)
        ids = (ids + int(t / BEAT)) % len(PAL)
    big = Image.fromarray(PAL[ids].astype(np.uint8)).resize((gw * cell, gh * cell), Image.NEAREST).crop((0, 0, w, h))
    if t is not None:
        a = np.asarray(big).copy()
        for j in range(0, h, cell // 2):
            if rng.random() < 0.35:
                a[j:j + cell // 2] = np.roll(a[j:j + cell // 2], int(rng.integers(-cell * 2, cell * 2)), axis=1)
        big = Image.fromarray(a)
    return big.convert("RGBA")


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


SWAPS = (0, 4, 8, 9, 12)  # キック＋スネアの16分位置。サビはここで絵を入れ替える


def kb(kind, i, w, h, u, seed, flip=False):
    """窓の絵を止めない: 入れ替えの間ずっと寄りながら流す（u=0→1）。"""
    big = cover(kind, i, int(w * 1.4), int(h * 1.4), flip)
    z = 1.0 - 0.28 * u
    bw, bh = big.width * z * 0.75, big.height * z * 0.75
    dx, dy = np.random.default_rng(seed).uniform(-1, 1, 2)
    cx = big.width / 2 + dx * (big.width - bw) / 2 * u
    cy = big.height / 2 + dy * (big.height - bh) / 2 * u
    return big.crop((int(cx - bw / 2), int(cy - bh / 2), int(cx + bw / 2), int(cy + bh / 2))).resize((w, h), Image.BILINEAR)


def swap_state(rel, positions):
    """直前の入れ替えからの経過。→ (入れ替えの通し番号, 0..1 の進み, 入れ替えからの秒)"""
    cyc, pos = divmod(max(rel, 0) / SIX, 16)
    marks = [p for p in positions if p <= pos]
    last = max(marks) if marks else 0
    nxt = min([p for p in positions if p > pos] + [16])
    return int(cyc) * len(positions) + len(marks), (pos - last) / max(nxt - last, 1e-9), (pos - last) * SIX


def side_mirrors(frame, im, t, x0, x1):
    """窓の両脇に、同じ絵の鏡写しを縦に流す（本編 40秒の型）。"""
    col = Image.new("RGBA", (im.width, im.height * 2))
    col.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (0, 0))
    col.paste(im.transpose(Image.FLIP_LEFT_RIGHT).transpose(Image.FLIP_TOP_BOTTOM), (0, im.height))
    off = int(t * 260) % im.height
    strip = col.crop((0, off, im.width, off + im.height)).resize((im.width, H))
    dark = Image.blend(strip, Image.new("RGBA", strip.size, (10, 20, 60, 255)), 0.35)
    frame.alpha_composite(dark, (max(0, x0 - im.width), 0))
    frame.alpha_composite(dark.transpose(Image.FLIP_LEFT_RIGHT), (min(W - im.width, x1), 0))


def bands(frame, i, t, n=3):
    """寄りの絵を横帯に切り、帯ごとに逆向きへ流す。帯の間は唐草の帯（本編 130秒の型）。"""
    bh = H // n
    big = cover("face", i, int(W * 1.5), int(bh * 3.2))
    for j in range(n):
        v = 200 * (1 if j % 2 else -1)
        ox = int((big.width - W) / 2 + v * ((t % 1.5) / 1.5 - 0.5))
        oy = int((big.height - bh) * (0.2 + 0.3 * j))
        frame.alpha_composite(big.crop((ox, oy, ox + W, oy + bh)), (0, j * bh))
        if j:
            stripe = Image.fromarray(np.clip(WALL[200:228, 0:W] * 1.6, 0, 255).astype(np.uint8)).convert("RGBA")
            frame.alpha_composite(stripe, (0, j * bh - 14))


def shake(frame, amt, seed):
    if amt < 0.5:
        return frame
    dx, dy = (np.random.default_rng(seed).uniform(-1, 1, 2) * amt).astype(int)
    out = Image.new("RGBA", frame.size, (0, 0, 0, 255))
    out.alpha_composite(frame, (int(dx), int(dy)))
    return out


# 一転攻勢の映像は淫夢の BB（ブルーバック動画）と野獣邸の背景。性的な場面の BB は使わない
BBDIR = (paths.MATERIAL / "淫夢/簡易版BB・音声スターターパック/迫真空手部feat.遠野/BB/野獣先輩")
BGDIR = (paths.MATERIAL / "淫夢/簡易版BB・音声スターターパック/他/背景素材/真夏の夜の淫夢/野獣邸")
BB_FILES = ["移動/野獣先輩ウォーキングＢＢ.mp4", "表情/野獣先輩フェイスBB　sm12432743.mp4", "立ち/ゲス顔野獣先輩BB(改訂版)_mp4.mp4",
            "表情/野獣に目覚めし先輩BB　sm16488434.mp4", "NSDR/まわる！野獣先輩.mp4"]
BBW, BBH, BBN = 480, 360, 150  # 各 BB の頭5秒を 30fps で持つ


def load_bb(name):
    raw_ = subprocess.run(["ffmpeg", "-v", "error", "-i", str(BBDIR / name), "-t", str(BBN / FPS), "-vf", f"fps={FPS},scale={BBW}:{BBH}",
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    v = np.frombuffer(raw_, np.uint8).reshape(-1, BBH, BBW, 3).astype(np.int16)
    r, g, b = v[..., 0], v[..., 1], v[..., 2]
    key = np.clip((b - np.maximum(r, g) - 60) / 60.0, 0, 1)  # 青いほど透明
    a = ((1 - key) * 255).astype(np.uint8)
    return np.concatenate([v.astype(np.uint8), a[..., None]], axis=-1)


BBS = [load_bb(f) for f in BB_FILES]
BGS = [Image.open(p).convert("RGBA").resize((W, H), Image.LANCZOS) for p in sorted(BGDIR.iterdir()) if p.suffix.lower() in (".png", ".jpg")]


def bb_frame(k, age, scale):
    v = BBS[k % len(BBS)]
    im = Image.fromarray(v[int(age * FPS) % len(v)], "RGBA")
    return im.resize((int(BBW * scale), int(BBH * scale)), Image.BILINEAR)


def pixelate(im, cell):
    if cell <= 1:
        return im
    return im.resize((max(1, im.width // cell), max(1, im.height // cell)), Image.NEAREST).resize(im.size, Image.NEAREST)


def frame_at(t):
    rel = t - OFF
    bar = int(np.floor(rel / BARS)) + 1
    kind = kinds.get(bar, "intro" if bar < 1 else "outro")
    beat_ph = (rel / BEAT) % 1 * BEAT
    pulse = float(np.exp(-beat_ph / 0.1)) if bar >= 1 else 0.0
    face = lambda j: (j * 5) % NFACE  # noqa: E731
    line = next((p for p in reversed(raw) if p["t"] <= t < p["t"] + BARS * 1.9), None)
    lstart = next((p for p in raw if 0 <= t - p["t"] < 0.15), None)
    end_t = OFF + info["endStep"] / 12 * SIX
    s16 = int(np.floor(rel / SIX)) if rel >= 0 else -1
    _, _, kage = swap_state(rel, (0, 8, 9))
    kick_amt = 14 * float(np.exp(-kage / 0.06)) if rel >= 0 else 0.0

    if t >= end_t - 0.05:  # 曲を切った後: 砂嵐の地に「ファッ！？」
        frame = static(W, H, t, (0.3, 0.45, 0.9), coarse=3)
        last = raw[-1]
        if t >= last["t"]:
            k = min(1.0, (t - last["t"]) / 0.15)
            frame.alpha_composite(mosaic(520, 520, int(t * 30), cell=int(20 + 30 * k), t=t), ((W - 520) // 2, (H - 520) // 2 - 40))
            subtitle(frame, last["show"], H - 150, size=int(80 + 20 * (1 - k)))
            frame = shake(frame, 30 * (1 - k) + 4, int(t * 60))
        return frame

    if bar >= MOD:  # 一転攻勢: 野獣邸の背景に野獣先輩の BB。台詞ごとに BB と背景を替え、拍でモザイクをかけたり外したりする
        li = next((j for j, p in enumerate(raw) if p is line), 0)
        bg = BGS[li % len(BGS)]
        z = 1.08 + 0.06 * pulse + 0.04 * ((rel / BARS) % 2)
        big = bg.resize((int(W * z), int(H * z)), Image.BILINEAR)
        frame = big.crop(((big.width - W) // 2, (big.height - H) // 2, (big.width - W) // 2 + W, (big.height - H) // 2 + H))
        frame = Image.blend(frame, grid_bg(t, pulse), 0.25 + 0.2 * (s16 % 2))  # 青い格子の砂嵐を薄く重ねる
        age = t - (line["t"] if line is not None else OFF + (MOD - 1) * BARS)
        fig = bb_frame(li, age, 1.55 + 0.12 * pulse)
        cell = (26 if (s16 // 4) % 4 == 3 else 0) + (14 if s16 % 8 == 7 else 0)  # 4拍目の頭と8分裏の最後で一瞬モザイク
        fig = pixelate(fig, cell)
        dx = int(40 * np.sin(rel * 2.1))
        frame.alpha_composite(fig, ((W - fig.width) // 2 + dx, H - fig.height + 30))
        if (s16 // 16) % 2 and s16 % 4 < 2:  # 1小節おきの拍頭は鏡写しを左右に増やす
            small = fig.resize((fig.width // 2, fig.height // 2))
            frame.alpha_composite(small, (20, H - small.height))
            frame.alpha_composite(small.transpose(Image.FLIP_LEFT_RIGHT), (W - small.width - 20, H - small.height))
        if line is not None:
            subtitle(frame, line["show"], H - 130, size=int(58 + 30 * max(0.0, 1 - (t - line["t"]) / 0.12)))
        if lstart is not None:
            frame = Image.blend(frame, Image.new("RGBA", (W, H), (255, 255, 255, 255)), 0.6 * (1 - (t - lstart["t"]) / 0.15))
        return shake(frame, 6 + 22 * pulse, s16 * 7)

    frame = background(t, pulse)
    if kind in ("intro", "intro2"):  # 輪の中の窓。拍（前奏の前半は2拍）ごとに入れ替えて寄る
        rings(frame, t * 1.6, pulse)
        idx, u, _ = swap_state(rel, (0, 4, 8, 12) if kind == "intro2" else (0, 8))
        w, h = 620, 460
        paste_shadow(frame, kb("face", face(idx), w, h, u, idx), (W - w) // 2, (H - h) // 2)
    elif kind == "verse":  # ひし形＋両脇の鏡写し。拍ごとに入れ替え
        idx, u, _ = swap_state(rel, (0, 4, 8, 12))
        w, h = 760, 620
        im = kb("face", face(idx), w, h, u, idx)
        side_mirrors(frame, im.resize((260, 210)), t, (W - w) // 2 + 120, (W + w) // 2 - 120)
        frame.alpha_composite(diamond(im), ((W - w) // 2, (H - h) // 2))
    elif kind == "pre":  # 横帯に切った寄りの絵。偶数小節はひし形を重ねる
        idx, u, _ = swap_state(rel, (0, 8))
        bands(frame, face(idx + 3), t)
        if bar % 2 == 0:
            w, h = 520, 440
            frame.alpha_composite(diamond(kb("face", face(idx), w, h, u, idx)), ((W - w) // 2, (H - h) // 2))
    elif kind.startswith("hook"):  # 輪＋大窓、キックとスネアで入れ替えて寄る。サビ2 は窓の中の万華鏡と横帯
        rings(frame, t * 2.2, pulse, r0=360)
        idx, u, age = swap_state(rel, SWAPS)
        w, h = 760, 540
        if kind == "hook2" and bar % 2 == 0:
            bands(frame, face(idx + 1), t)
        im = kb("face", face(idx), w, h, u, idx, flip=idx % 2 == 1)
        if kind == "hook2":
            im = mirror4(im)
        side_mirrors(frame, im.resize((300, 214)), t, (W - w) // 2, (W + w) // 2)
        sc = 1 + 0.06 * pulse
        im = im.resize((int(w * sc), int(h * sc)), Image.BILINEAR)
        slide = int(-180 * max(0.0, 1 - age / 0.07)) * (1 if idx % 2 else -1)  # 入れ替え直後は横から滑り込む
        paste_shadow(frame, im, (W - im.width) // 2 + slide, (H - im.height) // 2)
    else:  # ため（41〜56）: 輪の中が砂嵐→モザイク。両脇から MZ が押し出されていく
        rings(frame, t * (1.5 + 0.1 * (bar - 41)), pulse, r0=300)
        ow = 520 + int(30 * pulse)
        reveal = min(0.85, 0.12 + (bar - 41) * 0.05)
        st = Image.blend(static(ow, ow, t), mosaic(ow, ow, s16 // (4 if bar < 49 else 2), t=t), reveal)
        if line is not None and "野獣" in line["who"]:  # 台詞が鳴っている間だけ、粗いモザイク越しに顔が透ける
            fv = Image.new("RGBA", (ow, ow), (0, 0, 0, 255))
            f = bb_frame(3, t - line["t"], ow / BBH * 1.1)
            fv.alpha_composite(f, ((ow - f.width) // 2, (ow - f.height) // 2))
            st = Image.blend(st, pixelate(fv, max(6, int(48 - (bar - 41) * 2.6))), min(0.8, 0.25 + (bar - 41) * 0.04))
        mk = Image.new("L", (ow, ow), 0)
        ImageDraw.Draw(mk).ellipse((0, 0, ow, ow), fill=255)
        st.putalpha(mk)
        frame.alpha_composite(st, ((W - ow) // 2, (H - ow) // 2))
        if bar >= 49:
            off = int((bar - 49 + (rel / BARS) % 1) * 30)
            idx, u, _ = swap_state(rel, (0, 8))
            for j, x in enumerate((-120 - off, W - 180 + off)):
                paste_shadow(frame, kb("scene", (idx + j) % NSCENE, 300, 560, u, idx + j, flip=bool(j)), x, 80)
    if line is not None and bar < MOD and "野獣" in line["who"]:
        subtitle(frame, line["show"], H - 120, size=52)
    if lstart is not None and bar >= 9:
        frame = Image.blend(frame, Image.new("RGBA", (W, H), (230, 240, 255, 255)), 0.35 * (1 - (t - lstart["t"]) / 0.15))
    return shake(frame, kick_amt if (kind.startswith("hook") or kind == "pre") else kick_amt * 0.4, s16)


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
