"""cookie2go1 の動画を作る（使い捨て）。2号の映像の型（nigo-video-research.md）に合わせる:
中央の窓1つ・周りは単色系の万華鏡・キックで絵を入れ替える・49小節目まで顔を隠し、台詞が出る所で顔を出す。

python -I cookie_video.py <outdir>   （<outdir>/song.wav・offset.txt・placement.json を読み、video.mp4 を書く）
"""
import colorsys
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1280, 720, 30
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
FONT = ImageFont.truetype("C:/Windows/Fonts/BIZ-UDMinchoM.ttc", 44)
WIN = 420

od = Path(sys.argv[1])
# 曲ごとの設定: 演者・色の1系統・顔を出す小節・曲を切る小節・ブリッジで影から本物へ寄せる量・台詞ごとの顔
SONGS = {
    "cookie2go1": dict(char="UDK", hue=0.53, show=49, cut=64.6, reveal_img=15, final_face=31, default_face=9,
                       reveal={41: 0.0, 42: 0.0, 43: 0.25, 44: 0.25, 45: 0.5, 46: 0.5, 47: 0.8, 48: 0.8},
                       bg={"intro": 50, "verse": 0, "verse2": 25, "bridge": 40, "hook": 25},
                       faces={"おーっすお願いします": 28, "弾幕はパワーだぜ": 26, "なんだようるせぇなぁ": 43, "そーなのかー": 7,
                              "ジャッジメントですの": 35, "伸びた、伸びない": 19, "泣いちゃう、もう泣いちゃう": 23,
                              "泣くとマッドになります": 39, "うー": 31, "ゆっくりしていってね": 9}),
    "amber1": dict(char="RU", hue=0.09, show=57, cut=72.6, reveal_img=17, final_face=30, default_face=27,
                   reveal={b: v for b, v in zip(range(41, 57), [0.0] * 4 + [0.25] * 4 + [0.5] * 4 + [0.8] * 4)},
                   bg={"intro": 23, "verse": 24, "verse2": 11, "bridge": 43, "hook": 27},
                   faces={"オムライスが大好き": 13, "カルボナーラが好き": 45, "しらたきも大好き": 9, "イカスミ焼き": 28,
                          "いいよね切り干し大根て": 3, "梅酒うめーっしゅ": 18, "私も食べさせるー": 10, "結婚ねいいよね結婚": 36,
                          "じゃあ私結婚します": 30, "そうだよ": 16},
                   display={"おむらいすがだいすき": "オムライスが大好き", "かるぼなーらがすき": "カルボナーラが好き",
                            "しらたきもだいすき": "しらたきも大好き", "いかすみやき": "イカスミ焼き",
                            "いいよねきりぼしだいこんて": "いいよね切り干し大根て", "うめしゅうめーっしゅ": "梅酒うめーっしゅ",
                            "わたしもたべさせるー": "私も食べさせるー", "けっこんねいいよねけっこん": "結婚ねいいよね結婚",
                            "じゃあわたしけっこんします": "じゃあ私結婚します", "ぷはーきょうもいいてんき": "ぷはー今日もいい天気",
                            "ぷはーきょ…": "ぷはー今日…"}),
}
CFG = SONGS[od.name]
HUE, CHAR = CFG["hue"], CFG["char"]
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
OFF = float((od / "offset.txt").read_text())
BEAT = 60 / info["bpm"]
BARS = BEAT * 4
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
kinds = {}
for b in info["blocks"]:
    for k in range(4):
        kinds[b["bar"] + k] = b["kind"]


def img(kind, i):
    return Image.open(next((PACK / kind / CHAR).glob(f"{CHAR}_{i:02d}{kind[0]}*.png"))).convert("RGBA")


# CRN静画規格 1.0: 画像の中心が基準点（scene=体の中心線の重心、face=頭の中心）で、大きさも規格内でそろっている
# （face は頭の半径 ≈200px）。だから絵ごとに合わせず、中心から決まった画素数で切れば並べても大きさが跳ねない。
CROP_PX = {"face": 640, "scene": 900, "icon": 800}


def fit(im, box, kind):
    w, h = im.size
    s = CROP_PX[kind]
    im = im.crop((int((w - s) / 2), int((h - s) / 2), int((w + s) / 2), int((h + s) / 2)))  # はみ出しは透明で埋まる
    return im.resize((box, box), Image.LANCZOS)


def pal(v, s=0.75):
    return tuple(int(255 * c) for c in colorsys.hsv_to_rgb(HUE, s, v))


def tint(im):
    """絵を1系統の色の濃淡だけにする（地の万華鏡用）。"""
    g = np.asarray(im.convert("L"), dtype=np.float32) / 255
    a = np.asarray(im.split()[3], dtype=np.float32) / 255
    lo, hi = np.array(pal(0.08)), np.array(pal(0.95, 0.45))
    rgb = lo + (hi - lo) * (g * a)[..., None]
    return rgb


def silhouette(im, reveal=0.0):
    """顔を隠した影。reveal で本物へ寄せる（0=影だけ、1=本物）。"""
    a = im.split()[3]
    shadow = Image.new("RGBA", im.size, pal(0.32, 0.8) + (255,))  # 窓の地（0.04）より明るく、形だけ見せる
    shadow.putalpha(a)
    rim = a.filter(ImageFilter.MaxFilter(7))
    edge = Image.new("RGBA", im.size, pal(1.0, 0.25) + (255,))
    edge.putalpha(Image.eval(Image.merge("L", [rim]).point(lambda v: v), lambda v: v))
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(edge)
    out.alpha_composite(shadow)
    return Image.blend(out, im, reveal) if reveal > 0 else out


NIMG = len(list((PACK / "scene" / CHAR).glob("*.png")))
SCENES = [i for i in range(NIMG) if np.asarray(fit(img("scene", i), 64, "scene").split()[3]).mean() < 0.6 * 255]  # 窓を埋め尽くす寄りの絵は影にすると四角になる
FACE_OF = CFG["faces"]
raw = [p for p in info["placed"] if p["kind"] == "raw"]
for p in raw:
    p["t"] = OFF + (p["bar"] - 1) * BARS
    p["text"] = CFG.get("display", {}).get(p["text"], p["text"])  # 置き場所の文字は区切り用のかななので、字幕は漢字に戻す
cache = {}


def get(key, fn):
    if key not in cache:
        cache[key] = fn()
    return cache[key]


# 万華鏡の写像（640x360 で作って倍にする）
KW, KH = W // 2, H // 2
yy, xx = np.mgrid[0:KH, 0:KW].astype(np.float32)
dx, dy = xx - KW / 2, yy - KH / 2
R = np.hypot(dx, dy)
TH = np.arctan2(dy, dx)
NSEG = 8
WEDGE = np.pi / NSEG


def kaleido(src, rot, zoom):
    th = np.mod(TH + rot, 2 * WEDGE)
    th = np.where(th > WEDGE, 2 * WEDGE - th, th)
    h, w = src.shape[:2]
    r = R * zoom
    sx = np.clip((w / 2 + r * np.cos(th + 0.6)).astype(np.int32), 0, w - 1)
    sy = np.clip((h * 0.35 + r * np.sin(th + 0.6)).astype(np.int32), 0, h - 1)
    out = src[sy, sx]
    out *= np.clip(1.15 - R / (KW * 0.75), 0.25, 1.0)[..., None]  # 周辺を暗く
    return np.repeat(np.repeat(out, 2, 0), 2, 1)


def polygon(t, beat_ph):
    """前奏の窓: 影も出さず、回る多角形だけ。"""
    im = Image.new("RGBA", (WIN, WIN), pal(0.06, 0.9) + (255,))
    d = ImageDraw.Draw(im)
    for k in range(5):
        rr = WIN * (0.42 - 0.07 * k) * (1 + 0.08 * np.exp(-beat_ph * 6))
        ang = t * (0.6 + 0.25 * k) * (-1) ** k
        pts = [(WIN / 2 + rr * np.cos(ang + j * 2 * np.pi / 6), WIN / 2 + rr * np.sin(ang + j * 2 * np.pi / 6)) for j in range(6)]
        d.polygon(pts, outline=pal(1.0 - 0.12 * k, 0.4), width=3)
    return im


def window_content(t, bar, kind, bi, beat_ph):
    """その瞬間に窓へ出す絵（RGBA, WIN 四方）と字幕。"""
    line = next((p for p in reversed(raw) if p["t"] <= t < p["t"] + BARS * 1.6), None)
    if kind in ("intro", "intro2"):
        return polygon(t, beat_ph), None
    if kind == "outro" or t > OFF + CFG["cut"] * BARS:
        p = raw[-1]
        if t >= p["t"]:
            ff = CFG["final_face"]
            return get(("face", ff), lambda: fit(img("face", ff), WIN, "face")), p["text"]
        return polygon(t, beat_ph), None
    if bar >= CFG["show"] and line is not None:
        fi = FACE_OF.get(line["text"].rstrip("…"), CFG["default_face"])
        return get(("face", fi), lambda: fit(img("face", fi), WIN, "face")), line["text"]
    if kind == "bridge":
        # 「れうさん」を少しずつ出すのに合わせ、影から本物へ 2小節ごとに寄せる
        reveal = CFG["reveal"].get(bar, 0.0)
        ri = CFG["reveal_img"]
        return get(("rev", reveal), lambda: silhouette(fit(img("scene", ri), WIN, "scene"), reveal)), (line["text"] if line else None)
    step = 1 if kind.startswith("hook") else 2  # サビは毎拍、Aメロは2拍ごとに替える
    idx = SCENES[(bi // step * 7) % len(SCENES)]
    if bar >= CFG["show"]:
        return get(("scene", idx), lambda: fit(img("scene", idx), WIN, "scene")), None
    return get(("sil", idx), lambda: silhouette(fit(img("scene", idx), WIN, "scene"))), None


bg_src = {k: get(("bg", k), lambda k=k: tint(img("scene", k).resize((700, 700)))) for k in set(CFG["bg"].values())}


def bg_for(kind):
    return bg_src[CFG["bg"]["hook" if kind.startswith("hook") else "intro" if kind.startswith("intro") or kind == "outro" else kind]]


ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                       "-i", str(od / "song.wav"), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                       "-c:a", "aac", "-b:a", "192k", "-shortest", str(od / "video.mp4")], stdin=subprocess.PIPE)
for f in range(NF):
    t = f / FPS
    tb = (t - OFF) / BEAT
    bi = int(np.floor(tb))
    beat_ph = (tb - bi) * BEAT  # 拍頭からの秒
    bar = int(np.floor((t - OFF) / BARS)) + 1
    kind = kinds.get(bar, "intro" if bar < 1 else "outro")
    kick = np.exp(-beat_ph / 0.12) if bar >= 1 else 0.0
    bright = {"intro": 0.55, "intro2": 0.7, "bridge": 0.6}.get(kind, 1.0)
    bg = kaleido(bg_for(kind), 0.15 * t + (0.4 if kind.startswith("hook") else 0) * np.sin(t), 1.1 - 0.05 * kick)
    bg = np.clip(bg * (bright * (0.75 + 0.35 * kick)), 0, 255).astype(np.uint8)
    frame = Image.fromarray(bg).convert("RGBA")
    content, caption = window_content(t, bar, kind, bi, beat_ph)
    s = int(WIN * (1 + 0.06 * kick))
    box = Image.new("RGBA", (s + 12, s + 12), pal(1.0, 0.2) + (255,))
    inner = Image.new("RGBA", (s, s), pal(0.04, 0.9) + (255,))
    inner.alpha_composite(content.resize((s, s), Image.BILINEAR))
    box.paste(inner, (6, 6))
    frame.alpha_composite(box, ((W - s - 12) // 2, (H - s - 12) // 2 - 30))
    if caption:
        d = ImageDraw.Draw(frame)
        tw = d.textlength(caption, font=FONT)
        d.rectangle(((W - tw) / 2 - 20, H - 104, (W + tw) / 2 + 20, H - 40), fill=(0, 0, 0, 200))
        d.text(((W - tw) / 2, H - 98), caption, font=FONT, fill=(255, 255, 255, 255))
    lf = next((p for p in raw if 0 <= t - p["t"] < 0.12), None)
    if lf is not None and bar >= CFG["show"]:  # 台詞の頭に白く光らせる
        frame = Image.blend(frame, Image.new("RGBA", (W, H), (255, 255, 255, 255)), 0.35 * (1 - (t - lf["t"]) / 0.12))
    if t > dur - 1.5:
        frame = Image.blend(frame, Image.new("RGBA", (W, H), (0, 0, 0, 255)), min(1, (t - dur + 1.5) / 1.5))
    ff.stdin.write(frame.convert("RGB").tobytes())
    if f % 300 == 0:
        print(f, "/", NF, "bar", bar, kind, flush=True)
ff.stdin.close()
ff.wait()
print("done", od / "video.mp4")
