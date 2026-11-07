"""海鬼月の背景を油絵っぽいドット絵で描く（倍の大きさで下地→筆の跡を重ねる→縮めて色数を絞る）。
平らな塗りと線だけだと「AI slop 臭い」と所有者（11-03）。手本は光源の広がり・質感・奥行き・まとまった色の 128px の絵。
python -I scratch/kaikizuki/bgpaint.py  → bg/<名前>.png（幅 360。動画では横へゆっくり流す）
"""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'bg'); os.makedirs(OUT, exist_ok=True)
W, H, K = 360, 180, 2           # 出来上がりの大きさと、下地の倍率
WW, HH = W * K, H * K
HOR = 112 * K                   # 水平線（video.py の HORIZON）
Y = np.arange(HH)[:, None].astype(float); X = np.arange(WW)[None, :].astype(float)

def noise(seed, sx, sy, octaves=5):
    """横 sx・縦 sy 個の格子から始める fbm（0〜1）"""
    rng = np.random.default_rng(seed); out = np.zeros((HH, WW)); amp = 1; tot = 0
    for o in range(octaves):
        g = rng.random((max(2, int(sy * 2 ** o)), max(2, int(sx * 2 ** o))))
        out += amp * np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((WW, HH), Image.BICUBIC), float) / 255
        tot += amp; amp *= 0.5
    return out / tot

def grad(stops):
    """縦の色の段（(y, (r,g,b)), ...）→ HH×WW×3"""
    ys = [s[0] * K for s in stops]; img = np.zeros((HH, WW, 3))
    for c in range(3):
        img[:, :, c] = np.interp(Y[:, 0], ys, [s[1][c] for s in stops])[:, None]
    return img

def glow(img, cx, cy, r, col, a=1.0, power=1.6):
    d = np.sqrt((X - cx * K) ** 2 + ((Y - cy * K) * 1.15) ** 2) / (r * K)
    g = np.clip(1 - d, 0, 1) ** power * a
    return img + g[:, :, None] * np.array(col, float)

def mix(img, mask, col):
    m = np.clip(mask, 0, 1)[:, :, None]
    return img * (1 - m) + m * np.array(col, float) if not isinstance(col, np.ndarray) else img * (1 - m) + m * col

def clouds(img, seed, y0, y1, col_dark, col_lit, light_x, cover=0.55, stretch=6):
    n = noise(seed, 3, 3 * stretch / 6, 6)
    n2 = noise(seed + 1, 1.2, 1.2 * stretch / 6, 3)
    band = np.clip(np.minimum((Y - y0 * K) / 30, (y1 * K - Y) / 30), 0, 1)
    m = np.clip((n * 0.7 + n2 * 0.5 - cover) * 5, 0, 1) * band
    # 下側と光の方から明るく
    lit = np.clip((n - np.roll(n, -6, axis=0)) * 12 + 0.5, 0, 1)
    side = np.clip(1 - np.abs(X - light_x * K) / (WW * 0.6), 0, 1)
    c = np.array(col_dark, float) + (lit * (0.4 + 0.6 * side))[:, :, None] * (np.array(col_lit, float) - np.array(col_dark, float))
    return mix(img, m * 0.92, c)

def sea(img, top, bottom, refl_x, refl_col, seed, width=40, strength=1.0):
    m = Y >= HOR
    base = grad([(0, top), (112, top), (180, bottom)])
    img = np.where(m[:, :, None], base, img)
    # 横に長い波（濃淡）と、光の道
    n = noise(seed, 2, 40, 4)
    k = np.clip((Y - HOR) / (HH - HOR), 0, 1)
    img = img + (m * (n - 0.5) * 50 * (0.4 + k))[:, :, None]
    if refl_x is not None:
        w = (width * K) * (0.3 + 1.2 * k)
        col = np.clip(1 - np.abs(X - refl_x * K) / w, 0, 1) ** 1.2
        streak = np.clip((noise(seed + 9, 3, 60, 3) - 0.45) * 4, 0, 1)
        img = img + (m * col * streak * strength)[:, :, None] * np.array(refl_col, float)
    return img

def town(img, seed, base_y, col, win_col, h0=10, h1=34):
    rng = np.random.default_rng(seed); d_img = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(d_img)
    x = -10 * K
    while x < WW:
        w = int(rng.integers(14, 40) * K); h = int(rng.integers(h0, h1) * K)
        top = base_y * K - h
        d.rectangle((x, top, x + w, base_y * K), fill=col)
        if rng.random() < 0.35:  # 屋根
            d.polygon([(x - 2 * K, top), (x + w // 2, top - 8 * K), (x + w + 2 * K, top)], fill=col)
        for wy in range(top + 4 * K, base_y * K - 4 * K, 7 * K):
            for wx in range(x + 3 * K, x + w - 4 * K, 6 * K):
                if rng.random() < 0.28:
                    d.rectangle((wx, wy, wx + 2 * K, wy + 3 * K), fill=win_col)
        x += w + int(rng.integers(0, 6) * K)
    return np.asarray(d_img, float)

def strokes(img, seed, n=26000, length=(4, 14), width=(2, 4), jitter=10, angle=0.0, spread=0.35):
    """下地の色を拾って、短い筆の跡を重ねる（大きい筆から小さい筆へ）"""
    rng = np.random.default_rng(seed)
    base = np.clip(img, 0, 255)
    can = Image.fromarray(base.astype(np.uint8)); d = ImageDraw.Draw(can)
    for size in (2, 1):
        for _ in range(n // 2):
            x = rng.integers(0, WW); y = rng.integers(0, HH)
            c = base[y, x] + rng.normal(0, jitter, 3)
            a = angle + rng.normal(0, spread)
            L = rng.uniform(*length) * K * (1.6 if size == 2 else 1)
            dx, dy = np.cos(a) * L / 2, np.sin(a) * L / 2
            d.line((x - dx, y - dy, x + dx, y + dy), fill=tuple(np.clip(c, 0, 255).astype(int)),
                   width=int(rng.integers(*width)) * (size))
    return np.asarray(can, float)

def finish(img, name, colors=40):
    # 背景の 1 ドットは人物の 2 倍（所有者「背景のドットを大きく」11-03）。半分で描いて 2 倍に
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.BOX)
    im = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB').resize((W, H), Image.NEAREST)
    im.save(os.path.join(OUT, name + '.png'))
    im.resize((W * 3, H * 3), Image.NEAREST).save(os.path.join(OUT, '_' + name + '_x3.png'))

def stars(img, seed, n, ymax, col=(255, 250, 230)):
    rng = np.random.default_rng(seed)
    for _ in range(n):
        x, y = rng.integers(0, WW - 2), rng.integers(0, ymax * K)
        b = rng.uniform(0.3, 1.0); s = K if rng.random() < 0.8 else 2 * K
        img[y:y + s, x:x + s] = img[y:y + s, x:x + s] * (1 - b) + np.array(col) * b
    return img

def intro():
    # 夕暮れの名残り。右の水平線に沈んだ日の光、上は夜
    img = grad([(0, (14, 16, 44)), (40, (46, 32, 84)), (80, (150, 70, 104)), (104, (236, 128, 92)), (112, (255, 196, 128))])
    img = glow(img, 290, 112, 120, (120, 60, 20), 1.0)
    img = clouds(img, 2, 30, 100, (40, 26, 66), (250, 150, 120), 290, cover=0.52)
    img = sea(img, (70, 40, 70), (12, 16, 34), 290, (200, 110, 60), 3, width=50)
    img = strokes(img, 4, angle=0.0, spread=0.2)
    img = stars(img, 1, 60, 40)
    finish(img, 'intro')

def dusk():
    # 緋色のしけた町。空を筆で塗ってから街を置き、最後に霧の流れる向きの細い筆を薄く重ねる
    img = grad([(0, (34, 8, 16)), (50, (90, 18, 28)), (100, (190, 60, 48)), (118, (230, 110, 70))])
    img = clouds(img, 11, 0, 90, (40, 10, 18), (170, 60, 50), 180, cover=0.42, stretch=8)
    img = glow(img, 180, 118, 140, (90, 30, 10), 0.8)
    img = strokes(img, 15, angle=0.0, spread=0.25, jitter=8)
    img = town(img, 12, 128, (70, 26, 34), (255, 170, 90), 6, 22)
    img = town(img, 13, 146, (26, 8, 14), (255, 200, 120), 12, 38)
    m = Y >= 146 * K  # 濡れた道
    road = grad([(0, (40, 12, 20)), (146, (70, 20, 26)), (180, (20, 6, 10))])
    img = np.where(m[:, :, None], road, img)
    img = img + (m * np.clip((noise(14, 2, 50, 3) - 0.5) * 3, 0, 1))[:, :, None] * np.array((150, 50, 40))
    img = glow(img, 80, 112, 30, (255, 200, 120), 0.9)  # 標識の灯
    img = strokes(img, 16, n=9000, length=(4, 12), width=(1, 3), angle=0.0, spread=0.12, jitter=5)  # 霧の横に流れる筆（雨の縦筋にしない）
    finish(img, 'dusk')

def dream_night():
    img = grad([(0, (6, 8, 24)), (60, (20, 22, 62)), (112, (52, 54, 110))])
    neb = noise(21, 2, 1.5, 6)
    img = img + (np.clip((neb - 0.5) * 3, 0, 1) * (Y < HOR))[:, :, None] * np.array((70, 30, 90))
    img = glow(img, 160, 48, 110, (120, 120, 150), 1.0, 2.0)
    img = glow(img, 160, 48, 40, (120, 110, 80), 1.0, 1.2)
    img = clouds(img, 23, 70, 108, (24, 26, 64), (170, 170, 210), 160, cover=0.58)
    img = sea(img, (40, 46, 90), (6, 8, 22), 160, (230, 225, 200), 24, width=26, strength=1.1)
    img = strokes(img, 25, angle=0.0, spread=0.3)
    img = stars(img, 22, 120, 100)
    finish(img, 'dream_night')

def dream_morning():
    img = grad([(0, (52, 104, 180)), (60, (130, 180, 225)), (100, (235, 225, 205)), (112, (255, 215, 160))])
    img = glow(img, 160, 48, 120, (120, 90, 40), 0.9, 1.6)
    img = clouds(img, 31, 10, 104, (150, 160, 200), (255, 250, 240), 160, cover=0.5, stretch=4)
    img = sea(img, (120, 190, 205), (24, 92, 130), 160, (255, 240, 200), 32, width=34)
    img = strokes(img, 33, angle=0.0, spread=0.35, jitter=9)
    finish(img, 'dream_morning')

def itako():
    img = grad([(0, (10, 4, 12)), (60, (34, 10, 22)), (112, (90, 20, 30))])
    img = glow(img, 236, 52, 120, (140, 20, 30), 1.0, 1.8)
    img = clouds(img, 42, 60, 108, (30, 8, 18), (200, 50, 50), 236, cover=0.56)
    img = sea(img, (50, 12, 22), (8, 2, 8), 236, (220, 50, 50), 43, width=30)
    img = strokes(img, 44, angle=0.0, spread=0.3)
    img = stars(img, 41, 60, 90, (255, 220, 220))
    finish(img, 'itako')

def train():
    # 朝の海色の町。遠い山と海、線路の手前に土手
    img = grad([(0, (40, 90, 160)), (70, (140, 190, 225)), (112, (220, 230, 225))])
    img = clouds(img, 51, 6, 70, (150, 170, 210), (250, 250, 250), 100, cover=0.55, stretch=4)
    hill = noise(52, 3, 1, 3)[0] * 30 + 92
    img = np.where((Y > hill[None, :] * K - 0)[:, :, None] & (Y < HOR)[:, :, None], np.array((80, 120, 140), float) + (Y - 90 * K)[:, :, None] * 0.0, img)
    img = town(img, 53, 112, (110, 130, 150), (240, 240, 210), 4, 12)
    img = sea(img, (90, 160, 190), (60, 130, 120), None, None, 54)
    m = Y >= 118 * K
    img = np.where(m[:, :, None], grad([(0, (0, 0, 0)), (118, (90, 120, 80)), (180, (40, 60, 40))]), img)
    img = strokes(img, 55, angle=0.0, spread=0.4, jitter=9)
    finish(img, 'train')

def bus(morning):
    # 車内。天井の灯が壁と床に落ちる
    if morning:
        img = grad([(0, (60, 70, 96)), (90, (110, 120, 140)), (120, (70, 70, 84)), (180, (40, 40, 50))])
        lamp = (60, 60, 40)
    else:
        img = grad([(0, (20, 16, 26)), (90, (40, 30, 44)), (120, (26, 20, 30)), (180, (12, 10, 14))])
        lamp = (110, 80, 40)
    for lx in (60, 180, 300):
        img = glow(img, lx, 0, 70, lamp, 0.9, 1.4)
        img = glow(img, lx, 170, 50, tuple(c // 2 for c in lamp), 0.8, 1.6)
    img = img + (np.clip(noise(61 + morning, 20, 6, 3) - 0.5, -1, 1) * 18)[:, :, None]
    img = strokes(img, 62 + morning, angle=np.pi / 2, spread=0.15, jitter=6, n=18000)
    finish(img, 'bus_morning' if morning else 'bus_night')

def rock():
    """イタコの岩場（透かし）。赤い月の側を縁取る"""
    w, h = 220, 60
    can = Image.new('RGBA', (w * K, h * K), (0, 0, 0, 0)); d = ImageDraw.Draw(can)
    pts = [(0, h), (30, 12), (60, 6), (110, 0), (160, 10), (190, 4), (220, h)]
    d.polygon([(x * K, y * K) for x, y in pts], fill=(255, 255, 255, 255))
    a = np.asarray(can)[:, :, 3] > 0
    yy, xx = np.mgrid[0:h * K, 0:w * K]
    n = noise(71, 8, 8, 4)[:h * K, :w * K]
    base = np.array((30, 22, 30)) + ((n - 0.5) * 50)[:, :, None]
    rim = np.clip(1 - (yy - 0) / (14 * K), 0, 1) * np.clip(xx / (w * K), 0, 1)
    base = base + rim[:, :, None] * np.array((150, 40, 40))
    rgb = np.clip(base, 0, 255).astype(np.uint8)
    im = Image.fromarray(np.dstack([rgb, (a * 255).astype(np.uint8)]), 'RGBA').resize((w, h), Image.BOX)
    arr = np.asarray(im).copy(); arr[:, :, 3] = np.where(arr[:, :, 3] > 128, 255, 0)
    Image.fromarray(arr, 'RGBA').save(os.path.join(OUT, 'rock.png'))

if __name__ == '__main__':
    for f in (intro, dusk, dream_night, dream_morning, itako, train, lambda: bus(False), lambda: bus(True), rock):
        f()
    print('wrote', OUT)

def moon(name, r, lit, shade, seed):
    """クレーターの濃淡と、縁がにじむ月（透かし）"""
    n = 2 * r + 8; yy, xx = np.mgrid[0:n * K, 0:n * K] / K - n / 2
    d = np.sqrt(xx ** 2 + yy ** 2) / r
    rng = np.random.default_rng(seed)
    g = rng.random((6, 6)); tex = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((n * K, n * K), Image.BICUBIC), float) / 255
    g2 = rng.random((14, 14)); tex2 = np.asarray(Image.fromarray((g2 * 255).astype(np.uint8)).resize((n * K, n * K), Image.BICUBIC), float) / 255
    k = np.clip(tex * 0.6 + tex2 * 0.4 - 0.35, 0, 1) + np.clip(d - 0.55, 0, 1) * 0.8 + np.clip(xx / r, 0, 1) * 0.3
    rgb = np.array(lit, float) * (1 - k[:, :, None]) + np.array(shade, float) * k[:, :, None]
    alpha = np.clip((1.05 - d) * 8, 0, 1) * 255
    im = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8), 'RGBA').resize((n, n), Image.BOX)
    a = np.asarray(im).copy(); a[:, :, 3] = np.where(a[:, :, 3] > 100, 255, 0)
    Image.fromarray(a, 'RGBA').save(os.path.join(OUT, name + '.png'))

moon('moon', 22, (255, 250, 228), (196, 190, 200), 81)
moon('moon_red', 27, (236, 60, 56), (120, 14, 30), 82)
