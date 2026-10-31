"""amber型の動画 2（RU×UDK、使い捨て）。amber_video.py の型（赤い唐草の壁紙・大窓・ひし形・砂嵐の輪・窓の増殖・ハートで終わる）に、
- 透過の切り抜き（CRN の scene は背景が透明）で2人を向かい合わせて立たせる。CRN は右向きが原則なので UDK だけ左右反転。
- 歌っている方（歌1=RU・歌2=UDK の音符）が音符ごとに跳ね、休んでいる方は暗くなる。
- 入退場はイージング（行き過ぎて戻る easeOutBack）、キック（disco の1・3拍）で画面全体が寄って戻る、区間ごとにゆっくり寄るカメラ。
python -I amber2_video.py <outdir>   （<outdir>/song.wav・offset.txt・placement.json と amber2/src6159.json → video.mp4）
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

W, H, FPS = 1280, 720, 30
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
CROP_PX = {"face": 640, "scene": 900}
HERE = paths.WORK

od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
OFF = float((od / "offset.txt").read_text())
BEAT = 60 / info["bpm"]
SIX = BEAT / 4
BARS = BEAT * 4
END_T = OFF + info["endStep"] / 12 * SIX
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
raw = [p for p in info["placed"] if p["kind"] == "raw"]
for p in raw:
    p["t"] = OFF + (p["bar"] - 1) * BARS
    p["char"] = "RU" if p["who"].startswith("RU") else "UDK"
src = json.loads((HERE / "amber2" / "src6159.json").read_text(encoding="utf-8"))["placements"]
SING = {c: np.array(sorted(OFF + p["startStep"] / 12 * SIX for p in src if p["trackIndex"] == t)) for c, t in (("RU", 0), ("UDK", 2))}
rng = np.random.default_rng(7)
_cache = {}


def memo(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


def files(kind, char):
    return memo(("files", kind, char), lambda: sorted((PACK / kind / char).glob("*.png")))


def img(kind, char, i):
    return memo((kind, char, i), lambda: Image.open(files(kind, char)[i % len(files(kind, char))]).convert("RGBA"))


def ease_back(x, s=1.7):
    x = min(max(x, 0.0), 1.0) - 1
    return 1 + x * x * ((s + 1) * x + s)


def ease_io(x):
    x = min(max(x, 0.0), 1.0)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def cover(kind, char, i, w, h, flip=False):
    """基準点を中心に w:h で切り、淡い地の窓にする。"""
    def make():
        im = img(kind, char, i)
        s = CROP_PX[kind]
        cw, ch = (s, s * h / w) if w >= h else (s * w / h, s)
        x0, y0 = (im.width - cw) / 2, (im.height - ch) / 2
        c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((w, h), Image.LANCZOS)
        if flip:
            c = c.transpose(Image.FLIP_LEFT_RIGHT)
        bg = Image.new("RGBA", (w, h), (244, 236, 222, 255))
        bg.alpha_composite(c)
        return bg
    return memo(("cover", kind, char, i, w, h, flip), make)


def cutout(char, i, h):
    """透過の切り抜き（地なし）。高さ h、UDK は左向きへ反転、白い縁取りと影を付ける。"""
    def make():
        im = img("scene", char, i)
        bb = im.split()[3].getbbox()
        c = im.crop(bb)
        c = c.resize((max(1, int(c.width * h / c.height)), h), Image.LANCZOS)
        if char == "UDK":
            c = c.transpose(Image.FLIP_LEFT_RIGHT)
        a = c.split()[3]
        pad = 16
        out = Image.new("RGBA", (c.width + 2 * pad, c.height + 2 * pad))
        rim = Image.new("L", out.size)
        rim.paste(a, (pad, pad))
        rim = rim.filter(ImageFilter.MaxFilter(9))
        out.paste((255, 246, 230, 255), (0, 0), rim)
        out.alpha_composite(c, (pad, pad))
        return out
    return memo(("cut", char, i, h), make)


def pool(char):
    """全身が窓に収まる（寄りすぎない）絵だけ。"""
    def make():
        ok = []
        for i in range(len(files("scene", char))):
            a = np.asarray(img("scene", char, i).split()[3])
            if 0 < a.mean() < 0.45 * 255:
                ok.append(i)
        return ok
    return memo(("pool", char), make)


def face_for(line):
    """台詞と同じ語を名前に持つ顔があればそれ、無ければ台詞ごとに決まった番号。"""
    fs = files("face", line["char"])
    text = line["text"]
    best = (1, None)
    for i, f in enumerate(fs):
        name = f.stem.split("_", 2)[-1]
        k = max((L for L in range(2, 6) for a in range(len(text) - L + 1) if text[a:a + L] in name), default=0)
        if k > best[0]:
            best = (k, i)
    return best[1] if best[1] is not None else (int(line["bar"] * 7) % len(fs))


def wallpaper():
    T = 260
    sil = img("scene", "RU", pool("RU")[3]).split()[3].resize((T // 2, T // 2))
    q = Image.new("L", (T, T))
    q.paste(sil, (0, 0))
    q.paste(sil.transpose(Image.FLIP_LEFT_RIGHT), (T // 2, 0))
    q.paste(q.crop((0, 0, T, T // 2)).transpose(Image.FLIP_TOP_BOTTOM), (0, T // 2))
    edge = ImageChops.subtract(q.filter(ImageFilter.MaxFilter(9)), q.filter(ImageFilter.MinFilter(3)))
    tile = Image.new("L", (T, T))
    tile.paste(edge.rotate(45, resample=Image.BILINEAR), (0, 0))
    big = Image.new("L", (W + 2 * T, H + 2 * T))
    for y in range(0, H + 2 * T, T // 2):
        for x in range(-T, W + 2 * T, T):
            big.paste(tile, (x + (T // 2 if (y // (T // 2)) % 2 else 0), y), tile)
    a = np.asarray(big, np.float32)[..., None] / 255
    base = np.array([58, 10, 6], np.float32)
    ink = np.array([205, 78, 32], np.float32)
    return base + (ink - base) * a


WALL = wallpaper()
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = np.clip(1.25 - np.hypot((xx - W / 2) / (W * 0.55), (yy - H / 2) / (H * 0.62)), 0.15, 1.0)[..., None]


def background(t, pulse, tint=(1.0, 1.0, 1.0)):
    ox, oy = int(t * 14) % 260, int(t * 6) % 130
    a = WALL[oy:oy + H, ox:ox + W] * VIG * (0.8 + 0.35 * pulse) * np.array(tint, np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def paste_shadow(frame, im, x, y):
    sh = Image.new("RGBA", (im.width + 24, im.height + 24), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((12, 12, im.width + 12, im.height + 12), fill=(0, 0, 0, 170))
    frame.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)), (int(x) - 6, int(y) + 4))
    frame.alpha_composite(im, (int(x), int(y)))


def shaped(im, shape):
    m = Image.new("L", im.size, 0)
    w, h = im.size
    d = ImageDraw.Draw(m)
    if shape == "diamond":
        d.polygon([(w / 2, -h * 0.12), (w * 1.08, h / 2), (w / 2, h * 1.12), (-w * 0.08, h / 2)], fill=255)
    elif shape == "oval":
        d.ellipse((0, 0, w, h), fill=255)
    elif shape == "heart":
        return heart(im, 1.0)
    else:
        return im
    out = im.copy()
    out.putalpha(ImageChops.multiply(im.split()[3], m))
    return out


def heart(im, scale):
    w, h = im.size
    m = Image.new("L", (w, h), 0)
    s = np.linspace(0, 2 * np.pi, 120)
    x = 16 * np.sin(s) ** 3
    y = -(13 * np.cos(s) - 5 * np.cos(2 * s) - 2 * np.cos(3 * s) - np.cos(4 * s))
    k = scale * min(w, h) / 34
    ImageDraw.Draw(m).polygon(list(zip(w / 2 + k * x, h / 2 + k * y)), fill=255)
    out = im.copy()
    out.putalpha(ImageChops.multiply(im.split()[3], m))
    return out


def mirror4(im):
    """左半分を左右に折り返す（上下まで折ると髪だけの模様になった）。"""
    w, h = im.size
    q = im.crop((0, 0, w // 2, h))
    out = Image.new("RGBA", (w, h))
    out.paste(q, (0, 0))
    out.paste(q.transpose(Image.FLIP_LEFT_RIGHT), (w // 2, 0))
    return out


def static(w, h, t, tint=(1.0, 1.0, 1.0), coarse=4):
    n = rng.random((h // coarse, w // coarse)) ** 1.6
    rows = (np.sin(np.arange(h // coarse) * 0.9 + t * 40) > 0.6)[:, None] * 0.35
    a = np.clip(n + rows, 0, 1)
    return Image.fromarray((a[..., None] * np.array(tint) * 255).astype(np.uint8)).resize((w, h), Image.NEAREST).convert("RGBA")


def since(arr, t):
    k = np.searchsorted(arr, t, side="right") - 1
    return t - arr[k] if k >= 0 else 1e9


def singing(char, t):
    """直前の音符からの経過（歌っていなければ大きい値）。音符の間が2拍より空けば休み。"""
    s = since(SING[char], t)
    return s if s < 2 * BEAT else 1e9


def kick_index(t):
    s = int(np.floor((t - OFF) / SIX))
    bar, pos = divmod(s, 16)
    return bar * 2 + (pos >= 8)


def figure(frame, char, t, x_home, h, enter_t, from_side, idx):
    """切り抜きの立ち絵。enter_t から 0.45 秒で画面外から行き過ぎて戻り、歌の音符ごとに跳ね、休みは暗く。"""
    k = ease_back((t - enter_t) / 0.45)
    x = x_home + (1 - k) * (from_side * (W * 0.6))
    s = singing(char, t)
    hop = 26 * np.exp(-s / 0.09) if s < 1e8 else 0
    talking = any(p["char"] == char and 0 <= t - p["t"] < max(p.get("dur") or 1.2, 0.6) for p in raw)
    im = cutout(char, idx, h)
    if s > 1e8 and not talking:
        im = ImageEnhance.Brightness(im).enhance(0.55)
    sq = 1 + 0.05 * np.exp(-s / 0.09) if s < 1e8 else 1.0
    if sq != 1.0:
        im = im.resize((int(im.width / sq), int(im.height * sq)), Image.BILINEAR)
    frame.alpha_composite(im, (int(x - im.width / 2), int(H - im.height + 30 - hop)))


def zoomed(frame, z, cx=W / 2, cy=H / 2):
    if abs(z - 1) < 1e-3:
        return frame
    w, h = W / z, H / z
    return frame.crop((int(cx - w / 2), int(cy - h / 2), int(cx + w / 2), int(cy + h / 2))).resize((W, H), Image.BILINEAR)


def frame_at(t):
    rel = t - OFF
    bar = int(np.floor(rel / BARS)) + 1  # 1始まり
    beat_ph = (rel / BEAT) % 1 * BEAT
    pulse = float(np.exp(-beat_ph / 0.1)) if 1 <= bar <= 60 else 0.0
    kick_ph = (rel / (2 * BEAT)) % 1 * 2 * BEAT
    kick = float(np.exp(-kick_ph / 0.12)) if 1 <= bar <= 60 else 0.0
    ki = kick_index(t)
    line = next((p for p in reversed(raw) if p["t"] <= t < p["t"] + max(p.get("dur") or 1.3, 1.0) + 0.3), None)
    ru, ud = pool("RU"), pool("UDK")

    if t >= END_T - 0.05:  # 曲の後: 砂の地に横の切れ目。話す方の顔をハートで切り抜き、最後は2人の顔が縮む
        frame = background(t, 0.0, (0.7, 0.7, 0.7))
        sand = static(W, H, t, (0.55, 0.38, 0.22), coarse=3)
        d = ImageDraw.Draw(sand)
        for j in range(3):
            y = int((t * 90 + j * 260) % (H + 40)) - 20
            d.rectangle((0, y, W, y + 10 + 6 * j), fill=(10, 4, 2, 255))
        frame = Image.blend(frame, sand, 0.85)
        after = [p for p in raw if p["t"] >= END_T - BARS]
        cur = next((p for p in reversed(after) if p["t"] <= t), after[0])
        if cur["text"] == "（笑い声）":
            k = (t - cur["t"]) / max(dur - cur["t"], 1e-3)
            for j, c in enumerate(("RU", "UDK")):
                ln = next(p for p in reversed(after) if p["char"] == c and p is not cur)
                hw = 420
                f = heart(cover("face", c, face_for(ln), hw, hw, flip=c == "UDK"), max(0.15, 1 - 0.85 * k))
                frame.alpha_composite(f, (int(W / 2 - hw + 20 + j * (hw - 40)), (H - hw) // 2))
        else:
            hw = int(560 * (0.85 + 0.15 * ease_back((t - cur["t"]) / 0.35)))
            f = heart(cover("face", cur["char"], face_for(cur), hw, hw, flip=cur["char"] == "UDK"), 1.0)
            frame.alpha_composite(f, ((W - hw) // 2, (H - hw) // 2))
        return frame

    frame = background(t, pulse)
    if bar <= 4:  # 前奏: 大きい長方形の窓に話す方の顔。2人が左右から滑り込む
        if line is not None:
            w, h = 620, 440
            sc = 0.6 + 0.4 * ease_back((t - line["t"]) / 0.35)
            im = cover("face", line["char"], face_for(line), w, h, flip=line["char"] == "UDK")
            im = im.resize((int(w * sc), int(h * sc)), Image.BILINEAR)
            paste_shadow(frame, im, (W - im.width) / 2, 60 + (h - im.height) / 2)
        figure(frame, "RU", t, 200, 560, raw[0]["t"] - 0.2, -1, ru[0])
        figure(frame, "UDK", t, W - 200, 560, raw[1]["t"] - 0.2, 1, ud[0])
    elif bar <= 16:  # 5–12 RU が歌う → 13–16 UDK が返す: ひし形の窓、歌う方の顔がキックで入れ替わる。窓は歌い手の側へ寄る
        sw = ease_io((rel - 12 * BARS) / (BARS * 0.5))
        c = "UDK" if bar > 12 else "RU"
        w, h = 760, 560
        im = shaped(cover("face", c, ki * 3, w, h, flip=c == "UDK"), "diamond")
        s = 1 + 0.05 * kick
        im = im.resize((int(w * s), int(h * s)), Image.BILINEAR)
        cx = W / 2 - 120 + 240 * sw
        frame.alpha_composite(im, (int(cx - im.width / 2), int(H / 2 - im.height / 2 - 20)))
        figure(frame, "RU", t, 170, 520, -10, -1, ru[(bar // 2) % len(ru)])
        figure(frame, "UDK", t, W - 170, 520, -10, 1, ud[(bar // 2) % len(ud)])
    elif bar <= 24:  # 17–24 2人でハモる: ひし形2枚が向かい合い、両脇の板が流れる
        for j, (c, cx) in enumerate((("RU", W / 2 - 250), ("UDK", W / 2 + 250))):
            w, h = 520, 520
            im = shaped(cover("face", c, ki * 2 + j, w, h, flip=c == "UDK"), "diamond")
            k = ease_back((rel - 16 * BARS) / 0.5)
            s = (0.3 + 0.7 * k) * (1 + 0.06 * kick)
            im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)
            frame.alpha_composite(im, (int(cx - im.width / 2), int(H / 2 - im.height / 2 - 30)))
        figure(frame, "RU", t, 120, 420, -10, -1, ru[(bar + 1) % len(ru)])
        figure(frame, "UDK", t, W - 120, 420, -10, 1, ud[(bar + 1) % len(ud)])
    elif bar <= 32:  # 25–32 間奏: 楕円の輪の中の砂嵐。話す方の顔が透けて出る。カメラはゆっくり寄る
        ow, oh = 760, 500
        st = static(ow, oh, t)
        if line is not None:
            a = min(1.0, (t - line["t"]) / 0.25) * 0.85
            st = Image.blend(st, cover("face", line["char"], face_for(line), ow, oh, flip=line["char"] == "UDK"), a)
        st = shaped(st, "oval")
        x0, y0 = (W - ow) // 2, (H - oh) // 2 - 30
        frame.alpha_composite(st, (x0, y0))
        d = ImageDraw.Draw(frame)
        for j, a0 in enumerate(((rel * 60) % 360, (200 - rel * 45) % 360)):
            pad = 24 + 16 * j
            d.arc((x0 - pad, y0 - pad, x0 + ow + pad, y0 + oh + pad), a0, a0 + 110, fill=(236, 214, 170, 255), width=10 - 3 * j)
        figure(frame, "RU", t, 150, 500, -10, -1, ru[5 % len(ru)])
        figure(frame, "UDK", t, W - 150, 500, -10, 1, ud[5 % len(ud)])
        frame = zoomed(frame, 1 + 0.12 * ease_io((rel - 24 * BARS) / (8 * BARS)))
    elif bar <= 56:  # 33–56 サビ: 大窓（キックで RU/UDK 交互、41〜は窓の中の万華鏡）→ 49〜 窓4枚
        if bar <= 48:
            w, h = 760, 540
            c = ("RU", "UDK")[ki % 2]
            im = cover("face", c, ki, w, h, flip=c == "UDK")
            if bar > 40:
                im = mirror4(im)
            s = 1 + 0.06 * kick
            im = im.resize((int(w * s), int(h * s)), Image.BILINEAR)
            paste_shadow(frame, im, (W - im.width) / 2, (H - im.height) / 2 - 30)
            figure(frame, "RU", t, 140, 470, -10, -1, ru[(ki // 4) % len(ru)])
            figure(frame, "UDK", t, W - 140, 470, -10, 1, ud[(ki // 4) % len(ud)])
        else:
            slots = [(70, 40, 560, 310), (650, 40, 560, 310), (70, 370, 560, 310), (650, 370, 560, 310)]
            for j, (x, y, w, h) in enumerate(slots):
                c = ("RU", "UDK")[j % 2]
                d0 = 48 * BARS + j * BEAT / 2
                k = ease_back((rel - d0) / 0.4)
                im = cover("face", c, ki + 3 * j, w, h, flip=c == "UDK")
                s = max(0.05, k) * (1 + 0.04 * kick)
                im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)
                paste_shadow(frame, im, x + (w - im.width) / 2, y + (h - im.height) / 2)
            # 2人の切り抜きが下から覗く
            figure(frame, "RU", t, 330, 300, 48 * BARS + OFF, 0, ru[2])
            figure(frame, "UDK", t, W - 330, 300, 48 * BARS + OFF, 0, ud[2])
        frame = zoomed(frame, 1 + 0.025 * kick)
    else:  # 57–60 RU だけ: RU に寄っていく。「割と…好きだよ？」で顔の窓がハートになる
        k = ease_io((rel - 56 * BARS) / (4 * BARS))
        if line is not None and line["char"] == "RU":
            hw = 520
            f = heart(cover("face", "RU", face_for(line), hw, hw), 0.6 + 0.4 * ease_back((t - line["t"]) / 0.4))
            frame.alpha_composite(f, (W // 2 - hw // 2 + 120, H // 2 - hw // 2 - 20))
        else:
            w, h = 620, 460
            im = cover("face", "RU", ki, w, h)
            paste_shadow(frame, im, W / 2 - w / 2 + 120, H / 2 - h / 2 - 20)
        figure(frame, "RU", t, 200, 560, -10, -1, ru[7 % len(ru)])
        figure(frame, "UDK", t, W - 130, 400, -10, 1, ud[7 % len(ud)])
        frame = zoomed(frame, 1 + 0.18 * k, W / 2 - 160 * k, H / 2)
    lf = next((p for p in raw if 0 <= t - p["t"] < 0.1), None)
    if lf is not None:
        frame = Image.blend(frame, Image.new("RGBA", (W, H), (255, 240, 220, 255)), 0.25 * (1 - (t - lf["t"]) / 0.1))
    return frame


if __name__ == "__main__":
    only = [float(a) for a in sys.argv[2:]]  # 秒を渡すとその時刻の静止画だけ書く（確かめ用）
    if only:
        for t in only:
            frame_at(t).convert("RGB").save(od / f"frame_{t:05.1f}.png")
        sys.exit()
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
