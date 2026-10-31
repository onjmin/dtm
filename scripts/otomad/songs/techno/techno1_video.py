"""淫夢 × TECHNO MUSIC先輩型の動画 1（使い捨て）。焼き込みコメント無しの再掲（refs/nigo/sm16432546_yt.mp4）で見た型に合わせる。

型: 黒地に放射状の扇形が回る円盤1つを、最初から最後まで切らずに続ける（切り替え毎分1回台）。紫・青・桃の1系統。
音の帯ごとの強さで扇の長さが伸び縮みする。前奏は暗く、明るさを段階的に上げる。人物は隠しておき、
中心の小さな円に1コマずつちらつかせる → 41小節目で顔を大きく落とす → 抜きから人物を円周に並べた万華鏡 → 山は顔と万華鏡の両方。
python -I techno1_video.py <outdir>   （<outdir>/song.wav・placement.json → video.mp4）
FPS=15 で確認用（video_15fps.mp4）。全画面の計算（扇・円・弧・にじみ）は torch で GPU、顔と人物の貼り込みだけ PIL。
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
BBDIR = (paths.MATERIAL / "淫夢/簡易版BB・音声スターターパック/迫真空手部feat.遠野/BB/野獣先輩")
od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
HEADT = info["head"]
BEAT = 60 / info["bpm"]
SIX = BEAT / 4
BARS = BEAT * 4
SECS = [(s["name"], s["from"] - 1, s["to"]) for s in info["sections"]]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
RAW_BARS = [p["bar"] - 1 for p in info["placed"]]

# ── 音: 帯ごとの強さ（立ち上がりは即、減衰 0.15 秒） ──
sr = 22050
a = subprocess.run(["ffmpeg", "-v", "error", "-i", str(od / "song.wav"), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                   capture_output=True).stdout
x = np.frombuffer(a, np.float32)
hop = sr // FPS
nfr = len(x) // hop
spec = np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(np.pad(x, (1024, 1024)), 2048)[::hop][:nfr] * np.hanning(2048), axis=1))
freqs = np.fft.rfftfreq(2048, 1 / sr)
edges = np.geomspace(50, 9000, 9)
band = np.stack([spec[:, (freqs >= edges[i]) & (freqs < edges[i + 1])].mean(1) for i in range(8)], 1)
band = np.log1p(band / (np.percentile(band, 95, axis=0) + 1e-9) * 8) / np.log1p(8)
for i in range(1, len(band)):
    band[i] = np.maximum(band[i], band[i - 1] * np.exp(-1 / (0.15 * FPS)))
band = np.clip(band, 0, 1.3)


def sec_at(t):
    bar = (t - HEADT) / BARS
    for s, a_, b_ in SECS:
        if a_ <= bar < b_:
            return s, bar - a_, bar
    return ("outro" if bar >= 0 else "pre"), bar, bar


def kick_env(t):
    s, _, bar = sec_at(t)
    if s in ("intro", "brk", "pre") or int(bar) == 39 or bar >= 78:
        return 0.0
    ph = ((t - HEADT) / BEAT) % 1
    return float(np.exp(-ph * BEAT / 0.09))


def brightness(t):
    s, rel, bar = sec_at(t)
    return {"intro": 0.12 + 0.4 * rel / 8, "build": 0.55 + 0.15 * rel / 8, "rise": 0.7 + 0.3 * rel / 8, "main": 1.0, "reveal": 0.95,
            "brk": 0.55 + 0.45 * rel / 8, "peak": 1.12, "outro": max(0.0, 0.9 - 0.25 * rel)}.get(s, 0.0)


# ── 極座標の格子（GPU） ──
yy, xx = torch.meshgrid(torch.arange(H, dtype=torch.float32, device=DEV), torch.arange(W, dtype=torch.float32, device=DEV), indexing="ij")
DX, DY = xx - W / 2, yy - H / 2
R0 = torch.hypot(DX, DY) / (H / 2)
TH = torch.atan2(DY, DX)
PAL = torch.tensor([[40, 70, 255], [140, 60, 255], [255, 110, 220], [60, 190, 255], [90, 40, 200]], dtype=torch.float32, device=DEV) / 255
TWO_PI = 2 * np.pi


def col(rgb):
    return torch.tensor(rgb, dtype=torch.float32, device=DEV)


def sstep(e0, e1, v):
    k = ((v - e0) / (e1 - e0)).clamp(0, 1)
    return k * k * (3 - 2 * k)


def wrap(d):
    return torch.remainder(d + np.pi, TWO_PI) - np.pi


def fans(t, f, R, n, rot, amp, rin, base, bands_off=0, width=0.3):
    # 扇どうしは重ならない（width < π/n）ので、画素ごとに一番近い扇を1回で決める
    step = TWO_PI / n
    u = (TH - rot) / step
    kf = torch.round(u)
    d = (u - kf).abs() * step
    k = torch.remainder(kf.long(), n)
    rk = torch.tensor(base + amp * band[min(f, len(band) - 1), (np.arange(n) + bands_off) % 8], dtype=torch.float32, device=DEV)[k]
    m = sstep(width, width - 0.03, d) * sstep(rin - 0.01, rin + 0.01, R) * sstep(rk + 0.01, rk - 0.01, R)
    shade = 0.55 + 0.45 * (R - rin) / (rk - rin).clamp(min=1e-3)
    return (m * shade)[..., None] * PAL[torch.arange(n, device=DEV) % len(PAL)][k]


def ticks(t, f, R, n, rot, r, thick, lit):
    """外周の細い弧（16分で点く）"""
    m = sstep(thick, thick * 0.6, (R - r).abs())
    seg = (torch.remainder(TH - rot, TWO_PI) / TWO_PI * n).long()
    on = torch.tensor(lit, dtype=torch.float32, device=DEV)[seg % len(lit)]
    gap = sstep(0.0, 0.05, (torch.remainder(wrap((TH - rot) * n / 2), np.pi) - np.pi / 2).abs() / (np.pi / 2))
    return (m * on * gap)[..., None] * col([0.75, 0.7, 1.0])


def hub(t, R, rot, rad):
    m = sstep(rad + 0.008, rad - 0.008, R)
    facet = torch.remainder(torch.floor(torch.remainder(TH - rot, TWO_PI) / TWO_PI * 8), 2)
    c = (0.25 + 0.2 * facet + 0.25 * (1 - R / rad).clamp(0, 1))[..., None] * col([0.35, 0.45, 1.0])
    ring = sstep(0.012, 0.0, (R - rad).abs())[..., None] * col([0.6, 0.7, 1.0])
    return m, c * m[..., None] + ring


def gauss_blur(x, sigma):
    r = int(3 * sigma)
    g = torch.exp(-torch.arange(-r, r + 1, dtype=torch.float32, device=DEV) ** 2 / (2 * sigma ** 2))
    g = (g / g.sum()).view(1, 1, 1, -1).repeat(3, 1, 1, 1)
    x = F.conv2d(F.pad(x, (r, r, 0, 0), mode="replicate"), g, groups=3)
    return F.conv2d(F.pad(x, (0, 0, r, r), mode="replicate"), g.transpose(2, 3), groups=3)


# ── 淫夢の BB（性的な場面のものは使わない）。顔と、円周に並べる立ち姿 ──
def load_bb(rel, secs, size):
    raw_ = subprocess.run(["ffmpeg", "-v", "error", "-i", str(BBDIR / rel), "-t", str(secs), "-vf", f"fps={FPS},scale={size[0]}:{size[1]}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    fs = size[0] * size[1] * 3
    out = []
    for i in range(len(raw_) // fs):
        v = np.frombuffer(raw_, np.uint8, fs, i * fs).reshape(size[1], size[0], 3).astype(np.float32)
        key = np.clip((v[..., 2] - np.maximum(v[..., 0], v[..., 1]) - 60) / 60.0, 0, 1)
        lum = np.clip(((0.3 * v[..., 0] + 0.59 * v[..., 1] + 0.11 * v[..., 2]) / 255 - 0.12) / 0.75, 0, 1) ** 1.2
        tint = np.stack([lum * 0.62 + 0.08, lum * 0.42 + 0.05, lum * 1.0 + 0.12], -1).clip(0, 1)  # 紫に染める
        im = Image.fromarray(np.concatenate([(tint * 255).astype(np.uint8), ((1 - key) * 255).astype(np.uint8)[..., None]], -1), "RGBA")
        bb = im.getchannel("A").point(lambda p: 255 if p > 128 else 0).getbbox()
        out.append(im.crop(bb) if bb else im)
    return out


def cached_bb():
    """切り抜き済みの BB を pickle に置き、並列の各プロセスは読むだけにする。"""
    import pickle
    p = paths.WORK / "scratch_techno" / f"bb_cache_{FPS}.pkl"
    if not p.exists():
        p.parent.mkdir(exist_ok=True)
        p.write_bytes(pickle.dumps((load_bb("表情/野獣先輩フェイスBB　sm12432743.mp4", 6, (1280, 960)),
                                    load_bb("立ち/ゲス顔野獣先輩BB(改訂版)_mp4.mp4", 8, (480, 360)))))
    return pickle.loads(p.read_bytes())


FACE, GESU = cached_bb()


def pingpong(seq, t):
    n = len(seq)
    i = int(t * FPS) % (2 * n - 2)
    return seq[i if i < n else 2 * n - 2 - i]


def fit(im, h):
    s = h / im.height
    return im.resize((max(1, int(im.width * s)), max(1, int(h))), Image.BILINEAR)


def paste(canvas, im, cx, cy, ang=0.0, opacity=1.0):
    if ang:
        im = im.rotate(ang, Image.BILINEAR, expand=True)
    if opacity < 1:
        im = im.copy()
        im.putalpha(im.getchannel("A").point(lambda p: int(p * opacity)))
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def circle_mask(im, rad_px):
    m = Image.new("L", im.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).ellipse([im.width / 2 - rad_px, im.height / 2 - rad_px, im.width / 2 + rad_px, im.height / 2 + rad_px], fill=255)
    a_ = Image.fromarray(np.minimum(np.array(im.getchannel("A")), np.array(m)))
    im.putalpha(a_)
    return im


VIG = (1 - 0.75 * sstep(0.7, 1.45, R0))[..., None]


def frame_at(f):
    t = f / FPS
    s, rel, bar = sec_at(t)
    kp = kick_env(t)
    br = brightness(t)
    # 41小節目の落としと、山の頭で画面を揺らす（最初の数コマに一番強く、すぐ収める）
    shake = 0.0
    for b0 in (40, 64):
        dt = t - (HEADT + b0 * BARS)
        if 0 <= dt < 1.2:
            shake = max(shake, np.exp(-dt / 0.25))
    zoom = 1 + 0.045 * kp + 0.08 * shake
    R = R0 / zoom
    beats = (t - HEADT) / BEAT
    spin = 0.35 * beats * 2 * np.pi / 8  # 2小節で1周弱
    jolt = 0.25 * (1 - np.exp(-(beats % 1) * 4)) + np.floor(beats) * 0.25  # 拍ごとにカクッと回る
    n = {"intro": 3, "build": 4, "rise": 5, "main": 6, "reveal": 6, "brk": 4, "peak": 8, "outro": 4}.get(s, 3)
    big = s in ("reveal", "peak")
    img = fans(t, f, R, n, jolt + 0.2 * spin, 0.36, 0.26 if not big else 0.4, 0.5 if not big else 0.6, width=0.5 if n <= 5 else 0.36)
    img += 0.6 * fans(t, f, R, n, -spin * 0.6, 0.18, 0.24, 0.30, bands_off=3, width=0.22)
    lit = (np.random.default_rng(int((t - HEADT) / SIX) + 10**6).random(16) < 0.25 + 0.6 * band[min(f, len(band) - 1), 6]).astype(np.float32)
    img += ticks(t, f, R, 16, spin * 0.3, 0.95 if not big else 1.02, 0.018, lit)
    hm, hc = hub(t, R, -spin * 1.5, 0.2)
    img = img * (1 - hm[..., None]) + hc
    img *= br
    frame = Image.fromarray((img.clamp(0, 1) * 255).to(torch.uint8).cpu().numpy(), "RGB").convert("RGBA")

    # 人物（隠す → ちらつかせる → 落とす）
    age = t - HEADT
    if s in ("build", "rise", "main"):  # 中心の円に小さく出し続け、区間ごとに濃くする（点滅だけでは顔が見えないと所有者 10-31）
        op = {"build": 0.55 + 0.2 * rel / 8, "rise": 0.8 + 0.2 * rel / 8, "main": 1.0}[s]
        rad = {"build": 0.2, "rise": 0.23, "main": 0.26}[s] * H / 2 * 2 * zoom
        fc = circle_mask(fit(pingpong(FACE, age), 2.1 * rad), rad)
        paste(frame, fc, W / 2, H / 2, 10 * np.sin(2 * np.pi * beats / 8), opacity=op)
    if s == "reveal" or (s == "peak") or (s == "outro" and bar >= 78):
        size = 0.82 * H if s == "reveal" else 0.5 * H
        ang = 28 * np.sin(2 * np.pi * beats / 8) + 12 * shake * np.sin(t * 50)
        if s == "outro":
            size = 0.82 * H
        fc = circle_mask(fit(pingpong(FACE, age), size * zoom), size * zoom * 0.47)
        paste(frame, fc, W / 2 + 18 * shake * np.sin(t * 37), H / 2 + 14 * shake * np.cos(t * 41), ang,
              opacity=1.0 if s != "outro" else max(0.0, 1 - (bar - 78) * 0.8))
    if s in ("brk", "peak"):
        k_n = 6 if s == "brk" else 8
        op = min(1.0, rel / 2) if s == "brk" else 1.0
        g = fit(pingpong(GESU, age), 0.34 * H)
        rot = 360 * beats / 32 * (1 if s == "brk" else -1.5)
        for k in range(k_n):
            th = np.deg2rad(rot + 360 * k / k_n)
            r = (0.62 if s == "brk" else 0.7) * H / 2 * zoom
            paste(frame, g, W / 2 + r * np.cos(th), H / 2 + r * np.sin(th), -np.rad2deg(th) - 90, opacity=op * min(1.0, br))

    # 光のにじみ・周辺減光
    rgb = torch.from_numpy(np.array(frame.convert("RGB"))).to(DEV).float().permute(2, 0, 1)[None] / 255
    small = F.interpolate(rgb, size=(H // 8, W // 8), mode="bilinear", antialias=True, align_corners=False)
    glow = F.interpolate(gauss_blur(small, 3.0), size=(H, W), mode="bilinear", align_corners=False)
    arr = (rgb + 0.55 * glow)[0].permute(1, 2, 0) * VIG
    if shake > 0.6:  # 落としの最初の2コマを白く飛ばす
        arr = arr + (shake - 0.6) * 1.2
    return (arr.clamp(0, 1) * 255).to(torch.uint8).cpu().numpy()


def main():
    only = [int(v) for v in sys.argv[2:]]  # 確認用: 指定した秒のコマだけ PNG に書く
    if only:
        for sec in only:
            Image.fromarray(frame_at(int(sec * FPS))).save(od / f"frame_{sec:03d}.png")
        return
    import os
    import time
    from multiprocessing import Pool
    out_name = "video.mp4" if FPS == 30 else f"video_{FPS}fps.mp4"
    enc = os.environ.get("VENC", "libx264")
    vopt = ["-c:v", "libx264", "-preset", "medium", "-crf", "20"] if enc == "libx264" else ["-c:v", enc, "-cq", "20", "-preset", "p5"]
    ff = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-i", str(od / "song.wav"), *vopt, "-pix_fmt", "yuv420p",
                           "-c:a", "aac", "-b:a", "192k", "-shortest", str(od / out_name)], stdin=subprocess.PIPE)
    t0 = time.time()
    with Pool(int(os.environ.get("JOBS", 4 if DEV.type == "cuda" else max(1, (os.cpu_count() or 2) - 2)))) as pool:
        for f, fr in enumerate(pool.imap(frame_at, range(NF), chunksize=8)):
            ff.stdin.write(fr.tobytes())
            if f % 900 == 0:
                print(f, "/", NF, round(time.time() - t0, 1), "s", flush=True)
    ff.stdin.close()
    ff.wait()
    print("done", od / out_name, round(time.time() - t0, 1), "s")


if __name__ == "__main__":
    main()
