"""amber型の動画（使い捨て）。2号 amber.zip の画面の型（refs/nigo/sm18346739 を5秒ごとに見た）に合わせる:
- 地は暗い赤の唐草模様の壁紙（万華鏡ではない）。周りを暗く落とす。
- 大きい窓1つに絵を最初から色つきで出し、キックで入れ替える。窓の形は 長方形 → ひし形 → 両脇の板 → 窓の中の万華鏡 と替わる。
- 中盤は窓が 2枚 → 4枚 に増える。ためは楕円の輪の中の砂嵐。
- 最後は粗い砂の地に横の切れ目が走り、ハートの切り抜きが縮んで終わる。字幕は出さない。

python -I amber_video.py <outdir> <演者>   （<outdir>/song.wav・offset.txt・placement.json → video.mp4）
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H, FPS = 1280, 720, 30
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
CROP_PX = {"face": 640, "scene": 900}  # CRN静画規格: 中心が基準点で大きさもそろっているので、決まった画素数で切る

od = Path(sys.argv[1])
CHAR = sys.argv[2]
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
OFF = float((od / "offset.txt").read_text())
BEAT = 60 / info["bpm"]
SIX = BEAT / 4
BARS = BEAT * 4
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
KICKS = (0, 6, 10)  # break_openhat のキックの16分位置
rng = np.random.default_rng(7)
_cache = {}


def memo(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


def img(kind, i):
    return memo((kind, i), lambda: Image.open(next((PACK / kind / CHAR).glob(f"{CHAR}_{i:02d}{kind[0]}*.png"))).convert("RGBA"))


NIMG = len(list((PACK / "scene" / CHAR).glob("*.png")))


def cover(kind, i, w, h, flip=False):
    """基準点を中心に w:h で切り、窓いっぱいに出す。地は淡い生成り（amber の窓は白っぽい地に絵）。"""
    def make():
        im = img(kind, i)
        s = CROP_PX[kind]
        cw, ch = (s, s * h / w) if w >= h else (s * w / h, s)
        x0, y0 = (im.width - cw) / 2, (im.height - ch) / 2
        c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((w, h), Image.LANCZOS)
        if flip:
            c = c.transpose(Image.FLIP_LEFT_RIGHT)
        bg = Image.new("RGBA", (w, h), (244, 236, 222, 255))
        bg.alpha_composite(c)
        return bg
    return memo(("cover", kind, i, w, h, flip), make)


# 窓を埋め尽くす寄りの絵は入れ替えても形が見えないので外す
SCENES = [i for i in range(NIMG) if np.asarray(cover("scene", i, 64, 48).split()[3]).mean() > 0 and
          np.asarray(img("scene", i).split()[3]).mean() < 0.55 * 255]


def wallpaper():
    """唐草模様の壁紙: 絵の影を4方向に折り返した飾りを、互い違いに敷く。"""
    T = 260
    sil = img("scene", SCENES[3]).split()[3].resize((T // 2, T // 2))
    q = Image.new("L", (T, T))
    q.paste(sil, (0, 0))
    q.paste(sil.transpose(Image.FLIP_LEFT_RIGHT), (T // 2, 0))
    q.paste(q.crop((0, 0, T, T // 2)).transpose(Image.FLIP_TOP_BOTTOM), (0, T // 2))
    edge = ImageChops.subtract(q.filter(ImageFilter.MaxFilter(9)), q.filter(ImageFilter.MinFilter(3)))
    tile = Image.new("L", (T, T))
    tile.paste(edge.rotate(45, resample=Image.BILINEAR), (0, 0))
    big = Image.new("L", (W + 2 * T, H + 2 * T))
    for yy in range(0, H + 2 * T, T // 2):
        for xx in range(-T, W + 2 * T, T):
            big.paste(tile, (xx + (T // 2 if (yy // (T // 2)) % 2 else 0), yy), tile)
    a = np.asarray(big, np.float32)[..., None] / 255
    base = np.array([58, 10, 6], np.float32)
    ink = np.array([205, 78, 32], np.float32)
    return base + (ink - base) * a


WALL = wallpaper()
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = np.clip(1.25 - np.hypot((xx - W / 2) / (W * 0.55), (yy - H / 2) / (H * 0.62)), 0.15, 1.0)[..., None]


def background(t, pulse):
    ox, oy = int(t * 14) % 260, int(t * 6) % 130
    a = WALL[oy:oy + H, ox:ox + W] * VIG * (0.8 + 0.35 * pulse)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def paste_shadow(frame, im, x, y):
    sh = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((12, 12, im.width + 12, im.height + 12), fill=(0, 0, 0, 170))
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
    """窓の中の万華鏡（amber 10秒の型）。左上の4分の1を上下左右に折り返す。"""
    w, h = im.size
    q = im.crop((0, 0, w // 2, h // 2))
    out = Image.new("RGBA", (w, h))
    out.paste(q, (0, 0))
    out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (w // 2, 0))
    bottom = out.crop((0, 0, w, h // 2)).transpose(Image.FLIP_TOP_BOTTOM)
    out.paste(bottom, (0, h // 2))
    return out


def static(w, h, t, tint=(1.0, 1.0, 1.0), coarse=4):
    n = rng.random((h // coarse, w // coarse)) ** 1.6
    rows = (np.sin(np.arange(h // coarse) * 0.9 + t * 40) > 0.6)[:, None] * 0.35
    a = np.clip(n + rows, 0, 1)
    rgb = (a[..., None] * np.array(tint) * 255).astype(np.uint8)
    return Image.fromarray(rgb).resize((w, h), Image.NEAREST).convert("RGBA")


def heart_mask(w, h, scale):
    m = Image.new("L", (w, h), 0)
    s = np.linspace(0, 2 * np.pi, 120)
    x = 16 * np.sin(s) ** 3
    y = -(13 * np.cos(s) - 5 * np.cos(2 * s) - 2 * np.cos(3 * s) - np.cos(4 * s))
    k = scale * min(w, h) / 34
    ImageDraw.Draw(m).polygon(list(zip(w / 2 + k * x, h / 2 + k * y)), fill=255)
    return m


def kick_index(t):
    s = int(np.floor((t - OFF) / SIX))
    bar, pos = divmod(s, 16)
    return bar * 3 + sum(1 for k in KICKS if k <= pos)


def face_for(line):
    return 10 + (int(line["bar"] * 7) % 40)  # 台詞ごとに決まった顔（名前のない番号も含め、同じ台詞は同じ絵）


def frame_at(t):
    rel = t - OFF
    bar = int(np.floor(rel / BARS)) + 1
    kind = kinds.get(bar, "intro" if bar < 1 else "outro")
    beat_ph = (rel / BEAT) % 1 * BEAT
    pulse = float(np.exp(-beat_ph / 0.1)) if bar >= 1 else 0.0
    ki = kick_index(t)
    frame = background(t, pulse)
    pick = lambda j: SCENES[(j * 5) % len(SCENES)]  # noqa: E731
    line = next((p for p in reversed(raw) if p["t"] <= t < p["t"] + BARS * 1.8), None)
    end_t = OFF + info["endStep"] / 12 * SIX

    if t >= end_t - 0.05:  # 曲が止まった後: 砂の地に横の切れ目、最後の台詞の顔をハートで切り抜いて縮める
        k = (t - end_t) / max(dur - end_t, 1e-3)
        sand = static(W, H, t, (0.55, 0.38, 0.22), coarse=3)
        d = ImageDraw.Draw(sand)
        for j in range(3):
            y = int((t * 90 + j * 260) % (H + 40)) - 20
            d.rectangle((0, y, W, y + 10 + 6 * j), fill=(10, 4, 2, 255))
        frame = Image.blend(frame, sand, 0.85)
        last = raw[-1]
        if t >= last["t"]:
            hw = 560
            face = cover("face", face_for(last), hw, hw)
            m = heart_mask(hw, hw, max(0.12, 1.0 - 0.9 * k))
            f2 = face.copy()
            f2.putalpha(m)
            frame.alpha_composite(f2, ((W - hw) // 2, (H - hw) // 2))
        return frame

    if kind in ("intro", "intro2"):  # 長方形の大窓、2小節ごと
        w, h = 760, 540
        im = cover("face", pick(bar // 2), w, h)
        paste_shadow(frame, im, (W - w) // 2, (H - h) // 2)
    elif kind == "verse":  # ひし形、1小節ごと
        w, h = 900, 640
        im = diamond(cover("face", pick(bar), w, h))
        frame.alpha_composite(im, ((W - w) // 2, (H - h) // 2))
    elif kind == "verse2":  # ひし形＋両脇の板が流れる
        w, h = 900, 640
        for j, x in enumerate((-260 + int(rel * 40) % 120, W - 220 - int(rel * 40) % 120)):
            side = cover("scene", pick(bar + 3 + j, ), 300, 560, flip=bool(j))
            paste_shadow(frame, side, x, 80)
        im = diamond(cover("face", pick(bar), w, h))
        frame.alpha_composite(im, ((W - w) // 2, (H - h) // 2))
    elif kind.startswith("hook") and bar < 41:  # 大窓、キックで入れ替え。サビB は窓の中の万華鏡
        w, h = 820, 580
        im = cover("face", pick(ki), w, h, flip=ki % 2 == 1)
        if kind == "hookB":
            im = mirror4(im)
        s = 1 + 0.035 * pulse
        im = im.resize((int(w * s), int(h * s)), Image.BILINEAR)
        paste_shadow(frame, im, (W - im.width) // 2, (H - im.height) // 2)
    elif kind == "bridge":  # ため: 楕円の輪の中の砂嵐。「ぷはー…」が伸びるほど絵が透ける
        ow, oh = 900, 560
        reveal = {41: 0.0, 45: 0.2, 49: 0.4, 53: 0.65}[41 + (bar - 41) // 4 * 4]
        st = static(ow, oh, t)
        if reveal > 0:
            st = Image.blend(st, cover("face", face_for(raw[4]), ow, oh), reveal)
        m = Image.new("L", (ow, oh), 0)
        ImageDraw.Draw(m).ellipse((0, 0, ow, oh), fill=255)
        st.putalpha(m)
        x0, y0 = (W - ow) // 2, (H - oh) // 2
        frame.alpha_composite(st, (x0, y0))
        d = ImageDraw.Draw(frame)
        for j, a0 in enumerate(((rel * 60) % 360, (200 - rel * 45) % 360)):
            pad = 24 + 16 * j
            d.arc((x0 - pad, y0 - pad, x0 + ow + pad, y0 + oh + pad), a0, a0 + 110, fill=(236, 214, 170, 255), width=10 - 3 * j)
    else:  # 57〜72小節: 窓が 2枚 → 4枚。台詞の顔を大きい枠に、ほかはキックで入れ替え
        if bar < 65:
            slots = [(90, 120, 520, 480), (670, 120, 520, 480)]
        else:
            slots = [(70, 40, 560, 310), (650, 40, 560, 310), (70, 370, 560, 310), (650, 370, 560, 310)]
        for j, (x, y, w, h) in enumerate(slots):
            if j == 0 and line is not None:
                im = cover("face", face_for(line), w, h)
            else:
                im = cover("face", pick(ki + 2 * j), w, h, flip=j % 2 == 1)
            paste_shadow(frame, im, x, y)
    lf = next((p for p in raw if 0 <= t - p["t"] < 0.1), None)
    if lf is not None and bar >= 57:
        frame = Image.blend(frame, Image.new("RGBA", (W, H), (255, 240, 220, 255)), 0.3 * (1 - (t - lf["t"]) / 0.1))
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
    if f % 600 == 0:
        print(f, "/", NF, flush=True)
ff.stdin.close()
ff.wait()
print("done", od / "video.mp4")
