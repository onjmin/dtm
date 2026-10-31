"""クッキー☆ × Dandelion biscuit☆型の動画 2（使い捨て）。dande1 の型（淡い万華鏡の地・傾けた絵の板・湾曲した壁）に筋書きを足す。

霊夢ひとり → 魔理沙が右から入る → HNS が上から → BNKRG が下から（来るたびに手前の板が並び直し、壁も増える）→ 高まりで板が回る →
「ん？」で止まって全員落ち、暗転の中央に JOKER（熱画像の色）→ MZ が奥から飛んできて明るさが戻り、皆が1人ずつ戻る →
全音上げたら6人の板が回転木馬のように回り、しゃべる人が前で跳ねる → 1人ずつ去って暗転。
python -I dande2_video.py <outdir> [確認用の秒 ...]   FPS=15 で確認用（video_15fps.mp4）
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
from PIL import Image, ImageFilter

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
CODE = {"RU姉貴": "RU", "UDK姉貴": "UDK", "HNS姉貴": "HNS", "BNKRG姉貴": "BNK", "MZ姉貴": "MZ", "JOKER姉貴": "JOK"}
LINES = [(HEADT + (p["bar"] - 1) * BARS, CODE[p["who"]]) for p in info["placed"]]
DIR = {"RU": "RU", "UDK": "UDK", "HNS": "HNS", "BNK": "BNKRG", "MZ": "MZ", "JOK": "JOKER"}


def tb(bar):
    return HEADT + bar * BARS


def sec_at(t):
    bar = (t - HEADT) / BARS
    for s, a_, b_ in SECS:
        if a_ <= bar < b_:
            return s, bar - a_, bar
    return ("outro" if bar >= 0 else "pre"), bar, bar


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


# ── 絵の板 ──
def card(path, w=512, h=384):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").point(lambda v: 255 if v > 32 else 0).getbbox()
    im = im.crop(bb) if bb else im
    sc = max(w / im.width, h / im.height)
    im = im.resize((max(w, int(im.width * sc)), max(h, int(im.height * sc))), Image.LANCZOS)
    x0, y0 = (im.width - w) // 2, int((im.height - h) * 0.12)
    c = Image.new("RGBA", (w, h), (244, 242, 238, 255))
    c.alpha_composite(im.crop((x0, y0, x0 + w, y0 + h)))
    return torch.from_numpy(np.array(c)).to(DEV).float().permute(2, 0, 1)[None] / 255


def faces(code, n, seed):
    fs = sorted((PACK / "face" / DIR[code]).glob("*.png"))
    rng = np.random.default_rng(seed)
    return [card(fs[i]) for i in rng.choice(len(fs), size=min(n, len(fs)), replace=False)]


SMALL = {c: faces(c, 3, i) for i, c in enumerate(DIR)}
WALLS = {c: faces(c, 4, 100 + i) for i, c in enumerate(DIR)}

# ── 万華鏡の地 ──
_src = Image.open(sorted((PACK / "scene" / "RU").glob("*.png"))[12]).convert("RGBA")
_bgc = Image.new("RGBA", _src.size, (200, 196, 190, 255))
_bgc.alpha_composite(_src)
_g = np.asarray(_bgc.convert("L").resize((512, 512)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
BG_SRC = torch.from_numpy(0.82 + 0.08 * (_g - _g.mean()) / (_g.std() + 1e-6)).clamp(0.5, 0.95).to(DEV)[None, None]
yy, xx = torch.meshgrid(torch.linspace(-1, 1, H, device=DEV), torch.linspace(-W / H, W / H, W, device=DEV), indexing="ij")
RR = torch.sqrt(xx ** 2 + yy ** 2)
VIG = (1 - 0.45 * ((RR - 0.75) / 0.8).clamp(0, 1) ** 1.5)[None]
PIX = torch.stack([(xx * H / 2 + W / 2).flatten(), ((yy + 1) * H / 2).flatten(), torch.ones(H * W, device=DEV)])


def tri(v):
    return 1 - torch.abs(torch.remainder(v, 2) - 1)


def background(tt, speed):
    a = 0.22 * tt * speed
    sc = 1.3 + 0.35 * np.sin(tt * 0.5)
    u = (xx * np.cos(a) - yy * np.sin(a)) * sc + 0.35 * tt * speed
    v = (xx * np.sin(a) + yy * np.cos(a)) * sc + 0.2 * tt * speed
    g = torch.stack([2 * tri(u * 1.6) - 1, 2 * tri(v * 1.6) - 1], -1)[None]
    x = F.grid_sample(BG_SRC, g, mode="bilinear", padding_mode="reflection", align_corners=False)[0]
    return x.repeat(3, 1, 1) * torch.tensor([1.0, 0.99, 0.96], device=DEV)[:, None, None]


FOCAL = 620.0


def homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    h = np.linalg.solve(np.array(A, np.float64), np.array(dst, np.float64).flatten())
    return np.append(h, 1).reshape(3, 3)


def thermal(rgb):
    lum = (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]).clamp(0, 1)
    return torch.stack([(1.5 - (4 * lum - 3).abs()).clamp(0, 1), (1.5 - (4 * lum - 2).abs()).clamp(0, 1), (1.5 - (4 * lum - 1).abs()).clamp(0, 1)])


def panel(canvas, tex, center, w, h, yaw=0.0, pitch=0.0, roll=0.0, alpha=1.0, hot=False, light=1.0):
    if alpha <= 0.01:
        return
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
    if min(c[2] for c in corners) < 0.2:
        return
    scr = [(W / 2 + FOCAL * x / z, H / 2 + FOCAL * y / z) for x, y, z in corners]
    if max(abs(sx - W / 2) for sx, _ in scr) > 4 * W or max(abs(sy - H / 2) for _, sy in scr) > 4 * H:
        return
    Hm = homography(scr, [(0, 0), (1, 0), (1, 1), (0, 1)])
    uvw = torch.from_numpy(Hm).float().to(DEV) @ PIX
    g = torch.stack([2 * (uvw[0] / uvw[2]) - 1, 2 * (uvw[1] / uvw[2]) - 1], -1).view(1, H, W, 2)
    s = F.grid_sample(tex, g, mode="bilinear", padding_mode="zeros", align_corners=False)[0]
    rgb, a = s[:3], s[3:4] * alpha
    if hot:
        rgb = thermal(rgb)
    canvas.mul_(1 - a).add_(rgb * light * a)


def pop(t, code):
    best = 0.0
    for t0, w in LINES:
        if w == code and 0 <= t - t0 < 0.6:
            best = max(best, np.exp(-(t - t0) / 0.15))
    return best


def speaking(t, code):
    """直近の台詞の主が自分なら 1（次の台詞が始まるまで）"""
    last = [w for t0, w in LINES if t0 <= t]
    starts = [t0 for t0, _ in LINES if t0 <= t]
    if not last:
        return 0.0
    tl = max(starts)
    return 1.0 if code in [w for t0, w in LINES if t0 == tl] and t - tl < 2 * BARS else 0.0


# ── 手前の板の並び: 来た順に横へ並べ、来るたび並び直す ──
ARRIVE = {"RU": (0, None), "UDK": (8, "right"), "HNS": (16, "top"), "BNK": (24, "bottom")}
RETURN = {"MZ": 44, "HNS": 45, "BNK": 47, "UDK": 48, "RU": 49}


def row_x(order, code):
    n = len(order)
    i = order.index(code)
    return (i - (n - 1) / 2) * min(1.05, 2.9 / max(n - 1, 1)) if n > 1 else 0.0


def row_layout(bar, members):
    """members: 並ぶ順の人。いまの並びと、最後に人が増えた小節からの経過で、横位置をなめらかに替える"""
    out = {}
    for code in members:
        out[code] = row_x(members, code)
    return out


def small_panels(t, s, rel, bar, beats, bob):
    """(code, center, yaw, pitch, roll, size, alpha, hot, light) の並び"""
    items = []
    if s in ("intro", "A", "hns", "bnk", "rise") or (s == "dark" and bar < 36.5):
        members = [c for c in ("RU", "UDK", "HNS", "BNK") if bar >= ARRIVE[c][0]]
        last = max(ARRIVE[c][0] for c in members)
        prev = [c for c in members if ARRIVE[c][0] < last] or members
        k = ease((bar - last) / 0.5)
        for code in members:
            x1 = row_x(members, code)
            x0 = row_x(prev, code) if code in prev else x1
            x = x0 + (x1 - x0) * k
            y, z = -0.05, 2.6
            spin = 0.0
            if code not in prev and ARRIVE[code][1]:  # 入ってくる
                e = ease((bar - ARRIVE[code][0]) / 0.75)
                side = ARRIVE[code][1]
                if side == "right":
                    x += (1 - e) * 2.5
                if side == "top":
                    y -= (1 - e) * 2.0
                if side == "bottom":
                    y += (1 - e) * 2.0
                spin = (1 - e) * 3.0
            if s == "rise":  # 高まり: 板が回り出す
                spin += (bar - 32) ** 2 * 0.25 * np.sin(beats * np.pi / 2 + x)
            if s == "dark":  # 「ん？」: 半小節止まってから落ちる
                fall = ease((bar - 36.25) / 0.25)
                y += fall * 2.5
                spin += fall * 1.5
            items.append((code, (x, y, z), -x * 0.4 + spin, 0.06 * np.sin(t * 0.9 + x), 0.03 * bob * (1 if x > 0 else -1),
                          1.0, 1.0, False, 1.0))
    if s == "dark" or (s == "mz" and bar < 46):  # JOKER: 暗転の中央に大きく。MZ が来たら奥へ下がる
        back = ease((bar - 44) / 1.5)
        z = 2.0 + back * 2.5
        sway = 0.25 * np.sin(t * 0.7)
        items.append(("JOK", (0.0, 0.0, z), sway, 0.05 * np.sin(t * 0.5), 0.0, 1.35, 1.0 - 0.5 * back, True, 1.0))
        # 暗転の中で返す人は脇から顔を出す
        for code, b0 in (("RU", 40), ("UDK", 42), ("RU", 43)):
            if b0 <= bar < b0 + 1:
                e = ease((bar - b0) / 0.3) * (1 - ease((bar - b0 - 0.7) / 0.3))
                side = -1 if code == "RU" else 1
                items.append((code, (side * (2.4 - 1.1 * e), 0.1, 2.3), -side * 0.5, 0.0, 0.0, 1.0, 1.0, False, 1.0))
    if s == "mz":
        members = [c for c in ("MZ", "HNS", "BNK", "UDK", "RU") if bar >= RETURN[c]]
        for code in members:
            x = row_x(members, code)
            e = ease((bar - RETURN[code]) / 0.6)
            z = 2.6 + (1 - e) * 6.0 if code == "MZ" else 2.6
            y = -0.05 + ((1 - e) * -2.0 if code != "MZ" else 0.0)
            items.append((code, (x * (0.6 + 0.4 * e), y, z), -x * 0.4 + (1 - e) * 4.0, 0.0, 0.0, 1.0, e if code != "MZ" else 1.0, False, 1.0))
    if s in ("final", "outro"):  # 回転木馬: 6人が円を回る。しゃべる人が前で跳ねる
        order = ["RU", "UDK", "HNS", "BNK", "MZ", "JOK"]
        rot = (t - tb(52)) * 0.55
        intro_k = ease((bar - 52) / 0.75)
        leave = {"RU": 72, "MZ": 73, "JOK": 74, "UDK": 75, "HNS": 75, "BNK": 75}
        for i, code in enumerate(order):
            th = rot + 2 * np.pi * i / 6
            r = 1.7 * intro_k
            x, z = r * np.sin(th), 3.1 - r * np.cos(th) * 0.9
            y = 0.0
            al = 1.0
            if bar >= leave[code]:
                e = ease((bar - leave[code]) / 0.6)
                y -= e * 2.5
                al = 1 - e
            items.append((code, (x, y, z), -th * 0.6, 0.0, 0.03 * bob, 1.0, al, False, 0.75 + 0.25 * np.cos(th)))
    return items


def frame_at(f):
    t = f / FPS
    s, rel, bar = sec_at(t)
    beats = (t - HEADT) / BEAT
    bob = np.exp(-(beats % 1) * 5) if s not in ("intro", "pre", "dark") else 0.0
    # 「ん？」の半小節は地も止める
    tt = t if not (36 <= bar < 36.5) else tb(36)
    speed = 1.0 + (2.5 * (bar - 32) / 4 if s == "rise" else 0.0) + (0.6 if s == "final" else 0.0)
    canvas = background(tt, speed)
    light = 1.0
    if s == "dark":
        light = 0.16 if bar >= 36.5 else 1.0
    if s == "mz":
        light = 0.16 + 0.84 * ease((bar - 44) / 2.0)
    if s == "dark" or s == "mz":
        canvas = canvas * light * torch.tensor([1.0, 0.55, 0.6], device=DEV)[:, None, None] ** (1 - light)
    if s == "final":  # 全音上げた後は地を少し暖かく
        canvas = canvas * torch.tensor([1.03, 0.97, 0.9], device=DEV)[:, None, None]
    # 後ろの湾曲した壁: 来た人の絵が増えていく
    pool = {"intro": [], "A": ["RU", "UDK"], "hns": ["RU", "UDK", "HNS"], "bnk": ["RU", "UDK", "HNS", "BNK"],
            "rise": ["RU", "UDK", "HNS", "BNK"], "dark": ["JOK"], "mz": ["MZ", "RU", "UDK", "HNS", "BNK"],
            "final": ["RU", "UDK", "HNS", "BNK", "MZ", "JOK"], "outro": ["RU", "UDK", "HNS", "BNK", "MZ", "JOK"]}.get(s, [])
    n_wall = {"A": 3, "hns": 5, "bnk": 5, "rise": 5, "dark": 3, "mz": 5, "final": 7, "outro": 7}.get(s, 0)
    wall_al = 1.0
    if s == "A":
        wall_al = ease(rel / 1.0)
    if s == "dark":
        wall_al = 0.0 if bar < 37 else 0.5
    if s == "outro":
        wall_al = max(0.0, 1 - rel / 2)
    drift = 0.0
    if s in ("rise", "final"):
        drift = 0.15 * np.sin((t - HEADT) * 0.6)
    Rc = 3.1
    for k in sorted(range(n_wall), key=lambda k: -abs(k - (n_wall - 1) / 2)):
        ang = (k - (n_wall - 1) / 2) * 0.44 + drift
        code = pool[(k + int(max(0, bar)) // 4) % len(pool)]
        tex = WALLS[code][(k + int(max(0, bar)) // 8) % len(WALLS[code])]
        c = (Rc * np.sin(ang), 0.05 * np.sin(beats * np.pi / 2 + k), Rc * np.cos(ang) - 0.9)
        panel(canvas, tex, c, 1.25, 1.2, yaw=-ang, alpha=wall_al, hot=(s == "dark"), light=0.8 * light if s != "dark" else 0.6)
    # 手前の板（奥から順に描く）
    items = small_panels(t, s, rel, bar, beats, bob)
    for code, c, yaw, pitch, roll, size, al, hot, lt in sorted(items, key=lambda it: -it[1][2]):
        p = pop(t, code)
        sz = size * (1.0 + 0.2 * p + 0.03 * bob)
        idx = int(max(0, bar) // 8) % len(SMALL[code])
        lt2 = lt * (light if s in ("mz",) and code != "MZ" else 1.0)
        panel(canvas, SMALL[code][idx], (c[0], c[1] - 0.07 * p, c[2] - 0.3 * p), 0.92 * sz, 0.74 * sz, yaw, pitch, roll, al, hot, lt2)
    out = canvas * VIG
    if s == "rise" and bar >= 35 and (beats % 1) < 0.15:  # 高まりの最後の小節は拍で白く
        out = out + 0.35
    if s == "mz" and 44 <= bar < 44.15:  # MZ が来た瞬間
        out = out + 0.6 * (1 - (bar - 44) / 0.15)
    if bar < 0.2:
        out = out * max(0.0, (bar + 0.05) / 0.25)
    if s == "outro" and rel > 3:
        out = out * max(0.0, 1 - (rel - 3) * 1.2)
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
    with Pool(int(os.environ.get("JOBS", "6"))) as pool:
        for fr in pool.imap(frame_at, range(NF), chunksize=8):
            ff.stdin.write(fr.tobytes())
    ff.stdin.close()
    ff.wait()
    print("done", od / out_name, round(time.time() - t0, 1), "s")


if __name__ == "__main__":
    main()
