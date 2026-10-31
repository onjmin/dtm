"""Plasticookie☆Adventure型の動画 3（使い捨て）。コメント無しの本編（refs/nigo/sm18319732_clean.mp4）を30秒ずつ並べて見た型に合わせる。

本編の動きは「切らずに持ち続ける」。切り替えは毎分27回ほどで、0〜20秒・60〜100秒・190秒以降はほぼ切らない。
- 1枚の絵を区間いっぱい持つ。拍で小さく弾み、両脇に同じ絵の鏡写しが滑り込んで出入りし、窓は2小節ごとに1拍だけ小さく縮む。
- 別の絵は 0.5〜2秒の差し込みで入って、すぐ元の絵へ戻る。
- 区間ごとに型を替える: 紺の唐草に四角 → ひし形 → ひし形＋両脇 → 白い帯の通る青いトンネルに四角 → 横帯に切った寄り → 六角の三つ並び。
- 一転攻勢の後は淫夢の動画を長く流し続ける。地は回る青いトンネルとブロック状のグリッチ、ときどき上下の鏡写し。字幕は出さない。

python -I plasti3_video.py <outdir>   （<outdir>/song.wav・offset.txt・placement.json → video.mp4）
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
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック/face/MZ")
BBDIR = (paths.MATERIAL / "淫夢/簡易版BB・音声スターターパック/迫真空手部feat.遠野/BB/野獣先輩")
BGDIR = (paths.MATERIAL / "淫夢/簡易版BB・音声スターターパック/他/背景素材/真夏の夜の淫夢/野獣邸")

od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
OFF = float((od / "offset.txt").read_text())
BEAT = 60 / info["bpm"]
SIX = BEAT / 4
BARS = BEAT * 4
MOD = info["modBar"]
END_T = OFF + info["endStep"] / 12 * SIX
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
raw = [p for p in info["placed"] if p["kind"] == "raw"]
for p in raw:
    p["t"] = OFF + (p["bar"] - 1) * BARS
rng = np.random.default_rng(5)
_cache = {}


def memo(key, fn):
    if key not in _cache:
        _cache[key] = fn()
    return _cache[key]


FACES = sorted(PACK.glob("*.png"))


def face(i, w, h, flip=False):
    """基準点（中心）から 640px 角を w:h で切って、淡い地に置く。"""
    def make():
        im = Image.open(FACES[i]).convert("RGBA")
        s = 640
        cw, ch = (s, s * h / w) if w >= h else (s * w / h, s)
        x0, y0 = (im.width - cw) / 2, (im.height - ch) / 2
        c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((w, h), Image.LANCZOS)
        if flip:
            c = c.transpose(Image.FLIP_LEFT_RIGHT)
        bg = Image.new("RGBA", (w, h), (236, 238, 248, 255))
        bg.alpha_composite(c)
        return bg
    return memo(("face", i, w, h, flip), make)


# ── 地 ──
def damask():
    T = 200
    sil = Image.open(FACES[23]).convert("RGBA").split()[3].resize((T // 2, T // 2))
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
    return np.array([6, 12, 40], np.float32) + (np.array([34, 64, 150], np.float32) - [6, 12, 40]) * a * 0.75


DAM = damask()
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = np.clip(1.35 - np.hypot((xx - W / 2) / (W * 0.55), (yy - H / 2) / (H * 0.6)), 0.15, 1.0)[..., None]
RR = np.hypot(xx - W / 2, yy - H / 2)
AA = np.arctan2(yy - H / 2, xx - W / 2)


def bg_damask(t, pulse):
    ox, oy = int(t * 8) % 200, int(t * 3) % 100
    a = DAM[oy:oy + H, ox:ox + W] * VIG * (0.85 + 0.25 * pulse)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert("RGBA")


def bg_tunnel(t, pulse, speed=1.0, band=True, glitch=0.0):
    """白い帯の通る青いトンネル（本編 70〜100秒・190秒〜）: 太い輪を互い違いに回し、中を唐草で埋める。"""
    rings = np.zeros((H, W), np.float32)
    for k, (r0, wd, sp) in enumerate(((150, 40, 0.9), (260, 55, -0.6), (390, 70, 0.45), (540, 90, -0.3), (700, 110, 0.25))):
        on = np.abs(RR - r0 - 18 * pulse) < wd / 2
        seg = (np.sin(3 * (AA + sp * speed * t * 2.0) + k) > -0.2)
        rings = np.maximum(rings, (on & seg) * (0.55 + 0.1 * k))
    base = DAM[50:50 + H, 30:30 + W] * 0.9
    col = base * (1 - rings[..., None]) + np.array([130, 205, 255], np.float32) * rings[..., None]
    if band:
        b = np.clip(1 - np.abs(yy - H / 2) / (H * 0.24), 0, 1)[..., None] ** 0.6
        col = col * (1 - 0.95 * b) + 250 * 0.95 * b
    col = col * (0.85 + 0.25 * pulse)
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).convert("RGBA")
    if glitch > 0:  # ブロック状のずれ（本編 200秒〜）
        a = np.asarray(img).copy()
        for _ in range(int(90 * glitch)):
            bw, bh = int(rng.integers(20, 120)), int(rng.integers(8, 40))
            x, y = int(rng.integers(0, W - bw)), int(rng.integers(0, H - bh))
            nx = int(np.clip(x + rng.integers(-60, 60), 0, W - bw))
            a[y:y + bh, nx:nx + bw] = np.clip(a[y:y + bh, x:x + bw].astype(np.int16) + 60, 0, 255)
        img = Image.fromarray(a)
    return img


# ── 窓 ──
def shaped(im, kind):
    if kind == "rect":
        return im
    w, h = im.size
    m = Image.new("L", (w, h), 0)
    if kind == "diamond":
        pts = [(w / 2, -h * 0.1), (w * 1.1, h / 2), (w / 2, h * 1.1), (-w * 0.1, h / 2)]
    else:  # hex
        pts = [(w * 0.25, 0), (w * 0.75, 0), (w, h / 2), (w * 0.75, h), (w * 0.25, h), (0, h / 2)]
    ImageDraw.Draw(m).polygon(pts, fill=255)
    out = im.copy()
    out.putalpha(ImageChops.multiply(im.split()[3], m))
    return out


def put(frame, im, cx, cy):
    frame.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def bob(im, pulse, ph):
    """拍で小さく弾む（本編の持ち続ける絵の動き）。"""
    s = 1 + 0.035 * pulse
    out = im.resize((int(im.width * s), int(im.height * s)), Image.BILINEAR)
    return out.rotate(1.2 * np.sin(ph * np.pi), resample=Image.BILINEAR, expand=False) if ph is not None else out


def sides(frame, im, slide, cy):
    """両脇に同じ絵の鏡写し。slide=0 で外、1 で窓の横にぴったり。"""
    if slide <= 0:
        return
    f = im.transpose(Image.FLIP_LEFT_RIGHT)
    w = im.width
    x_l = int(-w + slide * (W / 2 - w / 2))
    x_r = int(W - slide * (W / 2 - w / 2))
    frame.alpha_composite(f, (x_l, int(cy - im.height / 2)))
    frame.alpha_composite(f, (x_r, int(cy - im.height / 2)))


# ── 淫夢の BB（性的な場面のものは使わない） ──
BB_FILES = {"wake": "表情/野獣に目覚めし先輩BB　sm16488434.mp4", "gesu": "立ち/ゲス顔野獣先輩BB(改訂版)_mp4.mp4",
            "face": "表情/野獣先輩フェイスBB　sm12432743.mp4"}
BBW, BBH = 560, 420


def load_bb(name, secs=12):
    raw_ = subprocess.run(["ffmpeg", "-v", "error", "-i", str(BBDIR / BB_FILES[name]), "-t", str(secs), "-vf",
                           f"fps={FPS},scale={BBW}:{BBH}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    v = np.frombuffer(raw_, np.uint8).reshape(-1, BBH, BBW, 3).astype(np.int16)
    key = np.clip((v[..., 2] - np.maximum(v[..., 0], v[..., 1]) - 60) / 60.0, 0, 1)
    return np.concatenate([v.astype(np.uint8), ((1 - key) * 255).astype(np.uint8)[..., None]], axis=-1)


BBS = {k: load_bb(k) for k in BB_FILES}
ROOM = [Image.open(p).convert("RGBA").resize((BBW, BBH), Image.LANCZOS) for p in sorted(BGDIR.iterdir())
        if p.suffix.lower() in (".png", ".jpg")]


def bb_window(name, age, room):
    """野獣邸の部屋に BB を重ねた「映像の窓」。往復で流し続ける。"""
    v = BBS[name]
    n = len(v)
    i = int(age * FPS) % (2 * n - 2)
    i = i if i < n else 2 * n - 2 - i
    out = ROOM[room % len(ROOM)].copy()
    out.alpha_composite(Image.fromarray(v[i], "RGBA"))
    return out


def pixelate(im, cell):
    return im.resize((max(1, im.width // cell), max(1, im.height // cell)), Image.NEAREST).resize(im.size, Image.NEAREST)


# ── 区間の型 ──
# (始まりの小節, 型, 持ち続ける絵)
PLAN = [(1, "intro", 9), (9, "verse", 6), (17, "pre", 23), (25, "hook", 23), (41, "stripes", 41), (49, "hex", 37),
        (57, "twist", None)]
INSERT_POOL = [10, 18, 28, 34, 43, 47, 54, 45, 25]


def section(bar):
    cur = PLAN[0]
    for p in PLAN:
        if bar >= p[0]:
            cur = p
    return cur


# 差し込み: (開始の秒, 長さの秒, 絵 or "yaju")。Aメロは台詞の頭ごとに2拍、Bメロ・サビは4小節に1回1拍、ためは台詞の間だけ野獣
INSERTS = []
for j, p in enumerate(raw):
    b = int(p["bar"])
    kind = section(b)[1]
    if kind == "verse":
        INSERTS.append((p["t"], 2 * BEAT, INSERT_POOL[j % len(INSERT_POOL)]))
    elif kind in ("stripes", "hex") and "野獣" in p["who"]:
        INSERTS.append((p["t"], p["len16"] * SIX, "yaju"))
for b in range(17, 41, 4):
    INSERTS.append((OFF + (b + 2) * BARS + 2 * BEAT, BEAT, INSERT_POOL[b % len(INSERT_POOL)]))
for b in (2, 5):
    INSERTS.append((OFF + b * BARS + 3 * BEAT, 1.5 * BEAT, INSERT_POOL[b]))


def frame_at(t):
    rel = t - OFF
    bar = int(np.floor(rel / BARS)) + 1
    beat = rel / BEAT
    pulse = float(np.exp(-(beat % 1) * BEAT / 0.12)) if rel >= 0 else 0.0
    pos16 = int(np.floor(rel / SIX)) % 32 if rel >= 0 else 0  # 2小節の中の16分
    shrink = pos16 >= 28  # 2小節ごとに最後の1拍だけ窓が縮む
    b0, kind, main = section(max(bar, 1))
    sec_t = t - (OFF + (b0 - 1) * BARS)

    if t >= END_T - 0.02:  # 曲を切った後: 暗転して「ファッ！？」で一瞬だけ顔
        frame = Image.new("RGBA", (W, H), (0, 0, 10, 255))
        last = raw[-1]
        if 0 <= t - last["t"] < 0.6:
            win = bb_window("face", t - last["t"], 2)
            put(frame, win.resize((int(BBW * 1.4), int(BBH * 1.4))), W / 2, H / 2)
        return frame

    if kind == "twist":
        frame = bg_tunnel(t, pulse, speed=1.6, band=False, glitch=0.6 + 0.4 * pulse)
        name = "wake" if bar < 65 else "gesu"
        win = bb_window(name, t - (OFF + (56 if bar < 65 else 64) * BARS), 3 if bar < 65 else 4)
        if (pos16 // 4) % 8 in (3, 7):  # 4拍に1回、上半分を下へ折り返す（本編 270秒）
            top = win.crop((0, 0, BBW, BBH // 2))
            win = win.copy()
            win.paste(top.transpose(Image.FLIP_TOP_BOTTOM), (0, BBH // 2))
        s = 1.45 + 0.05 * pulse
        win = win.resize((int(BBW * s), int(BBH * s)), Image.BILINEAR)
        put(frame, win, W / 2 + 10 * np.sin(rel * 3), H / 2)
        return frame

    ins = next((x for x in INSERTS if x[0] <= t < x[0] + x[1]), None)
    if kind in ("intro", "verse", "pre", "stripes", "hex"):
        frame = bg_damask(t, pulse)
    else:
        frame = bg_tunnel(t, pulse)

    if ins is not None and ins[2] == "yaju":  # ため: 台詞の間だけ、粗いモザイク越しの野獣の顔
        cell = max(5, int(40 - (bar - 41) * 2.2))
        win = pixelate(bb_window("wake", t - ins[0], 3), cell)
        put(frame, shaped(win.resize((640, 480)), "hex" if kind == "hex" else "rect"), W / 2, H / 2)
        return frame
    if ins is not None:  # 差し込み: 別の絵を同じ窓の形で
        shape = {"verse": "diamond", "pre": "diamond", "hook": "rect", "intro": "rect"}.get(kind, "rect")
        put(frame, shaped(face(ins[2], 560, 440), shape), W / 2, H / 2)
        return frame

    ph = beat % 2 if rel >= 0 else None
    if kind == "intro":  # 大きい四角。後半4小節は両脇がゆっくり滑り込む
        im = bob(face(main, 900, 680), pulse, ph)
        sides(frame, face(main, 420, 680), np.clip((sec_t - 4 * BARS) / (2 * BARS), 0, 1) * 0.55, H / 2)
        put(frame, im, W / 2, H / 2 + 20)
    elif kind == "verse":  # ひし形を持ち続ける。縮む拍は小さいひし形だけ
        size = (520, 420) if shrink else (820, 680)
        put(frame, bob(shaped(face(main, *size), "diamond"), pulse, ph), W / 2, H / 2)
    elif kind == "pre":  # ひし形＋両脇の鏡写しが2小節ごとに出入りする
        cyc = (sec_t / (2 * BARS)) % 1
        slide = np.clip(np.sin(np.pi * cyc) * 1.6, 0, 1)
        if not shrink:
            sides(frame, shaped(face(main, 560, 520), "diamond"), slide * 0.9, H / 2)
        size = (480, 400) if shrink else (760, 640)
        put(frame, bob(shaped(face(main, *size), "diamond"), pulse, ph), W / 2, H / 2)
    elif kind == "hook":  # 白い帯の通るトンネルに四角。両脇に同じ絵の半分が覗く
        im = face(main, 560, 440)
        if not shrink:
            sides(frame, face(main, 300, 440), 0.75 + 0.1 * pulse, H / 2)
        put(frame, bob(im if not shrink else im.resize((380, 300)), pulse, ph), W / 2, H / 2)
    elif kind == "stripes":  # 寄りの絵を横帯に切る型と、全身の四角を1小節ごとに替える
        if bar % 2:
            big = face(main, W, int(H * 1.6))
            oy = int((big.height - H) * (0.5 + 0.3 * np.sin(rel * 0.8)))
            frame.alpha_composite(big.crop((0, oy, W, oy + H)))
            band = Image.fromarray(np.clip(DAM[100:100 + 110, 0:W] * 1.4, 0, 255).astype(np.uint8)).convert("RGBA")
            frame.alpha_composite(band, (0, int(H * 0.38 + 30 * np.sin(rel * 1.3))))
        else:
            put(frame, bob(face(main, 700, 560), pulse, ph), W / 2, H / 2)
    elif kind == "hex":  # 六角の三つ並び（真ん中と両脇の鏡写し）と、六角1つを2拍ごとに替える
        trio = (pos16 // 8) % 2 == 0
        hx = shaped(face(main, 520, 520), "hex")
        if trio:
            put(frame, hx.transpose(Image.FLIP_LEFT_RIGHT), W / 2 - 430, H / 2)
            put(frame, hx.transpose(Image.FLIP_LEFT_RIGHT), W / 2 + 430, H / 2)
            put(frame, bob(hx, pulse, ph), W / 2, H / 2)
        else:
            put(frame, bob(shaped(face(main, 400, 400), "hex"), pulse, ph), W / 2, H / 2)
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
