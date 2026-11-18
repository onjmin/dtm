"""動画の1コマを GPU（torch・CUDA）で組み立てる部品。画面は (3, H, W) の float32（0〜255）、絵は (4, h, w) のまっすぐなアルファ。

  cv = Canvas(1920, 1080); cv.fill((255, 240, 220))
  cv.paste(tex(pil_img), cx, cy, scale=1.2, rot=8)     # PIL の paste と同じ: 中心 (cx, cy)、rot は反時計回りの度
  cv.warp(tex(arr), M)                                  # cv2.warpAffine と同じ 2x3 の行列（絵→画面）
  ffmpeg.stdin.write(cv.bytes())

絵は tex() で一度だけ GPU へ送ってキャッシュする（同じ PIL 画像・配列なら同じテクスチャ）。縮めて貼るときは
半分ずつ縮めた段（mip）から選ぶので、細い線がちらつかない。変形は貼る範囲だけ grid_sample で引く。
"""
import math
import numpy as np
import torch
import torch.nn.functional as F

DEV = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


class Tex:
    """GPU 上の絵。levels[0] が元の大きさ、levels[k] は 1/2^k（掛け済みアルファ (4, h, w)、0〜1）"""
    def __init__(self, rgba):
        a = rgba[3:4]
        pm = torch.cat([rgba[:3] * a, a], 0)
        self.levels = [pm]
        while min(self.levels[-1].shape[1:]) > 16:
            self.levels.append(F.avg_pool2d(self.levels[-1][None], 2, ceil_mode=True)[0])
        self.h, self.w = rgba.shape[1:]

    def level(self, scale):
        k = 0
        while k + 1 < len(self.levels) and scale * (2 ** (k + 1)) <= 1.0: k += 1
        return self.levels[k]


_cache = {}
def tex(img, key=None):
    """PIL 画像か (h, w, 3|4) の uint8 配列を Tex に。key を省くと id で覚える（同じ物を何度渡しても1回だけ送る）"""
    k = key if key is not None else id(img)
    t = _cache.get(k)
    if t is not None and t[0] is img: return t[1]
    a = np.asarray(img.convert('RGBA') if hasattr(img, 'convert') else img)
    if a.shape[2] == 3: a = np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    T = Tex(torch.from_numpy(np.array(a, np.uint8, copy=True)).to(DEV).permute(2, 0, 1).float() / 255)
    _cache[k] = (img, T)
    if len(_cache) > 4000: _cache.pop(next(iter(_cache)))
    return T


def tex_now(rgba):
    """毎コマ変わる絵（(4, h, w) の torch、0〜1、まっすぐなアルファ）。キャッシュしない"""
    return Tex(rgba)


def gauss(x, sigma):
    """(C, H, W) をガウスでぼかす（縦横に分けて畳み込む）"""
    r = max(1, int(sigma * 3)); k = torch.arange(-r, r + 1, device=x.device, dtype=x.dtype)
    k = torch.exp(-k ** 2 / (2 * sigma ** 2)); k = k / k.sum(); C = x.shape[0]
    y = F.conv2d(F.pad(x[None], (r, r, 0, 0), mode='replicate'), k.view(1, 1, 1, -1).repeat(C, 1, 1, 1), groups=C)
    y = F.conv2d(F.pad(y, (0, 0, r, r), mode='replicate'), k.view(1, 1, -1, 1).repeat(C, 1, 1, 1), groups=C)
    return y[0]


def dilate(a, k):
    """(H, W) の最大値フィルタ（k×k）"""
    if k <= 1: return a
    p = k // 2
    return F.max_pool2d(F.pad(a[None, None], (p, k - 1 - p, p, k - 1 - p)), k, 1)[0, 0]


def hsv2rgb(h, s, v):
    """h・s・v は同じ形の torch（0〜1）。(3, ...) の 0〜1 を返す"""
    i = torch.floor(h * 6) % 6; f = h * 6 - torch.floor(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    sel = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]
    out = torch.zeros((3,) + h.shape, device=h.device)
    for n, (a, b, c) in enumerate(sel):
        m = (i == n)
        out[0][m] = a[m]; out[1][m] = b[m]; out[2][m] = c[m]
    return out


class Canvas:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.img = torch.zeros((3, H, W), device=DEV)
        ys, xs = torch.meshgrid(torch.arange(H, device=DEV, dtype=torch.float32), torch.arange(W, device=DEV, dtype=torch.float32), indexing='ij')
        self.XS, self.YS = xs, ys

    def fill(self, rgb):
        self.img[:] = torch.as_tensor(rgb, device=DEV, dtype=torch.float32).view(3, 1, 1)

    def rect(self, x0, y0, x1, y1, rgb):
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(self.W, int(x1)), min(self.H, int(y1))
        if x1 > x0 and y1 > y0: self.img[:, y0:y1, x0:x1] = torch.as_tensor(rgb, device=DEV, dtype=torch.float32).view(3, 1, 1)

    def blend(self, rgb, a):
        """a は (H, W) の 0〜1。rgb は色（3つ）か (3, H, W)"""
        c = torch.as_tensor(rgb, device=DEV, dtype=torch.float32)
        if c.dim() == 1: c = c.view(3, 1, 1)
        self.img = self.img * (1 - a) + c * a

    def _sample(self, T, scale, inv, box):
        """box の範囲の画面の画素 → 絵の正規化座標 inv(x, y) で引いて重ねる"""
        x0, y0, x1, y1 = box
        x0, y0, x1, y1 = max(0, int(math.floor(x0))), max(0, int(math.floor(y0))), min(self.W, int(math.ceil(x1))), min(self.H, int(math.ceil(y1)))
        if x1 <= x0 or y1 <= y0: return
        xs = self.XS[y0:y1, x0:x1] + 0.5; ys = self.YS[y0:y1, x0:x1] + 0.5
        gx, gy = inv(xs, ys)
        src = T.level(scale)
        s = F.grid_sample(src[None], torch.stack([gx, gy], -1)[None], mode='bilinear', padding_mode='zeros', align_corners=False)[0]
        return x0, y0, x1, y1, s

    def _over(self, r, alpha=1.0):
        if r is None: return
        x0, y0, x1, y1, s = r
        a = s[3:4] * alpha
        reg = self.img[:, y0:y1, x0:x1]
        self.img[:, y0:y1, x0:x1] = reg * (1 - a) + s[:3] * 255 * alpha

    def paste(self, T, cx, cy, scale=1.0, rot=0.0, alpha=1.0, flip=False):
        """PIL の rotate(rot, expand=True) → 拡大 → 中心 (cx, cy) へ貼るのと同じ"""
        if not isinstance(T, Tex): T = tex(T)
        if alpha <= 0: return
        w, h = T.w * scale, T.h * scale
        r = math.hypot(w, h) / 2 if rot else None
        box = (cx - r, cy - r, cx + r, cy + r) if rot else (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))

        def inv(xs, ys):
            dx, dy = xs - cx, ys - cy
            u = (dx * ca - dy * sa) / scale; v = (dx * sa + dy * ca) / scale
            if flip: u = -u
            return u / (T.w / 2), v / (T.h / 2)
        self._over(self._sample(T, scale, inv, box), alpha)

    def warp(self, T, M):
        """cv2.warpAffine(img, M) を重ねるのと同じ（M は絵→画面の 2x3）"""
        if not isinstance(T, Tex): T = tex(T)
        A = np.vstack([np.asarray(M, np.float64), [0, 0, 1]]); Ai = np.linalg.inv(A)
        corners = A @ np.array([[0, 0, 1], [T.w, 0, 1], [0, T.h, 1], [T.w, T.h, 1]], np.float64).T
        box = (corners[0].min(), corners[1].min(), corners[0].max(), corners[1].max())
        scale = math.sqrt(abs(np.linalg.det(A[:2, :2])))

        def inv(xs, ys):
            u = Ai[0, 0] * xs + Ai[0, 1] * ys + Ai[0, 2]; v = Ai[1, 0] * xs + Ai[1, 1] * ys + Ai[1, 2]
            return u / T.w * 2 - 1, v / T.h * 2 - 1
        self._over(self._sample(T, scale, inv, box))

    def array(self):
        return self.img.clamp(0, 255).to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy()

    def bytes(self):
        return self.array().tobytes()
