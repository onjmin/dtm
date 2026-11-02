"""ブロックの世界を光線で描く部品（bb19）。CPU の numba で 1 コマ 0.1〜0.5 秒。

世界は 1 ブロックごとに「いつ現れて、いつ消えて、消えたあと何になるか」を持つ。時刻 t を渡すだけでその瞬間の世界が描けるので、
コマを順番どおりに描かなくてよく（multiprocessing でばらばらに描ける）、スローや巻き戻しも時刻を変えるだけで済む。

- World: ids / after / on / off の格子。fill・box・build（順に建てる）・carve（爆発で削る）で組む
- Giant: 絵（BB の 1 コマ）を、縁ほど薄い立体のブロックにしたもの。毎コマ差し替えられる（Giant.from_rgba）
- render: 色と奥行きを返す。人物の板・破片は奥行きで前後を判定して重ねる（board・debris）

  pip install --target <SPEECH_PYLIB> --no-deps numba llvmlite
"""
import math

import cv2
import numpy as np
from numba import njit
from PIL import Image

# ---------------------------------------------------------------- ブロックの種類

NAMES = ["air", "grass", "dirt", "stone", "cobble", "plank", "log", "leaf", "glass", "sand", "brick", "obsidian", "tnt", "diamond",
         "gold", "iron", "coal", "lava", "water", "tofu", "kuso", "roof", "concrete", "glow", "steel", "red", "blue", "yellow", "biscuit",
         "choco", "cream", "bedrock", "orange", "pink", "black", "white"]
B = {n: i for i, n in enumerate(NAMES)}
TRANSPARENT = np.zeros(len(NAMES), np.bool_)
TRANSPARENT[[B["glass"], B["water"]]] = True
EMISSIVE = np.zeros(len(NAMES), np.float32)
EMISSIVE[B["lava"]] = 0.62
EMISSIVE[B["glow"]] = 0.9


def _noise(rng, base, amp, n=16):
    return np.clip(np.array(base, np.float32) + (rng.standard_normal((n, n, 1)) * amp), 0, 255)


def _ore(rng, col):
    t = _noise(rng, (125, 125, 125), 11)
    for _ in range(4):
        x, y = rng.integers(1, 13, 2)
        t[y:y + 2, x:x + 3] = np.array(col, np.float32) + rng.standard_normal(3) * 8
    return t


def _bricks(rng, base, line, bw=8, bh=4):
    t = _noise(rng, base, 8)
    for r in range(0, 16, bh):
        t[r, :] = line
        off = bw // 2 if (r // bh) % 2 else 0
        t[r:r + bh, (off + bw - 1) % 16] = line
        t[r:r + bh, (off + bw * 2 - 1) % 16] = line
    return t


def _flat(rng, col, amp=4):
    return _noise(rng, col, amp)


def make_atlas():
    """16×16 の絵を種類×面（上・横・下）で手続きで描く。返り値は [種類, 面, y, x, 色] の float32（0〜1）。"""
    rng = np.random.default_rng(114514)
    n = len(NAMES)
    at = np.zeros((n, 3, 16, 16, 3), np.float32)

    def put(name, top, side=None, bot=None):
        at[B[name], 0] = top
        at[B[name], 1] = top if side is None else side
        at[B[name], 2] = (top if side is None else side) if bot is None else bot

    dirt = _noise(rng, (134, 96, 67), 13)
    grass_top = _noise(rng, (108, 158, 62), 15)
    grass_side = dirt.copy()
    edge = rng.integers(2, 6, 16)
    for x in range(16):
        grass_side[:edge[x], x] = grass_top[:edge[x], x]
    put("grass", grass_top, grass_side, dirt)
    put("dirt", dirt)
    put("stone", _noise(rng, (127, 127, 127), 9))
    cob = _noise(rng, (120, 120, 120), 22)
    cob[::5, :] *= 0.6
    cob[:, ::6] *= 0.72
    put("cobble", cob)
    pl = _noise(rng, (162, 130, 78), 7)
    pl[::4, :] *= 0.66
    put("plank", pl)
    lg = _noise(rng, (102, 78, 46), 9)
    lg[:, ::3] *= 0.75
    put("log", _noise(rng, (160, 130, 82), 10), lg)
    lf = _noise(rng, (58, 120, 40), 26)
    lf[rng.random((16, 16)) < 0.16] *= 0.45
    put("leaf", lf)
    gl = np.full((16, 16, 3), (205, 232, 240), np.float32)
    gl[0, :] = gl[15, :] = gl[:, 0] = gl[:, 15] = (248, 252, 255)
    for i in range(3, 9):
        gl[i, 12 - i] = (250, 255, 255)
    put("glass", gl)
    put("sand", _noise(rng, (219, 207, 160), 7))
    put("brick", _bricks(rng, (150, 86, 70), (196, 186, 176)))
    put("obsidian", _noise(rng, (28, 20, 44), 7))
    tn = _noise(rng, (196, 44, 34), 10)
    tn[6:10, :] = (232, 226, 214)
    for x, y in [(2, 7), (3, 7), (4, 7), (3, 8), (3, 9), (6, 7), (6, 8), (6, 9), (7, 8), (8, 9), (8, 8), (8, 7), (11, 7), (12, 7), (13, 7), (12, 8), (12, 9)]:
        tn[y - 0, x] = (20, 20, 20)
    put("tnt", _noise(rng, (190, 170, 150), 12), tn)
    put("diamond", _ore(rng, (98, 232, 224)))
    put("gold", _ore(rng, (248, 214, 70)))
    put("iron", _ore(rng, (216, 172, 142)))
    put("coal", _ore(rng, (36, 36, 36)))
    lv = _noise(rng, (232, 104, 16), 34)
    lv[rng.random((16, 16)) < 0.18] = (255, 216, 70)
    put("lava", lv)
    wt = _noise(rng, (46, 92, 186), 13)
    put("water", wt)
    tf = _noise(rng, (248, 246, 236), 2.5)
    tf[0, :] = tf[15, :] = tf[:, 0] = tf[:, 15] = (238, 235, 222)
    put("tofu", tf)
    ks = _noise(rng, (92, 62, 28), 11)
    for i in range(1, 15, 3):
        ks[i, (i * 5) % 12:(i * 5) % 12 + 4] = (62, 40, 16)
    put("kuso", ks)
    rf = _noise(rng, (70, 62, 84), 5)
    rf[::4, :] *= 0.68
    put("roof", rf)
    put("concrete", _noise(rng, (176, 176, 172), 4))
    gw = _noise(rng, (250, 214, 130), 22)
    put("glow", gw)
    st = _noise(rng, (120, 126, 134), 4)
    st[:, 7:9] *= 0.72
    put("steel", st)
    put("red", _flat(rng, (178, 46, 42)))
    put("blue", _flat(rng, (54, 72, 170)))
    put("yellow", _flat(rng, (226, 192, 50)))
    bs = _noise(rng, (210, 164, 104), 8)
    put("biscuit", bs)
    ch = _noise(rng, (88, 52, 30), 5)
    ch[::5, :] *= 0.7
    ch[:, ::5] *= 0.7
    put("choco", ch)
    put("cream", _noise(rng, (248, 232, 214), 3))
    put("bedrock", _noise(rng, (58, 58, 58), 26))
    put("orange", _flat(rng, (222, 124, 40)))
    put("pink", _flat(rng, (238, 150, 176)))
    put("black", _flat(rng, (28, 28, 32)))
    put("white", _flat(rng, (232, 232, 232)))
    return at / 255.0


ATLAS = make_atlas()
AVG = ATLAS.mean(axis=(2, 3))


def _clouds(n=256):
    rng = np.random.default_rng(810)
    a = rng.random((n // 8, n // 8)).astype(np.float32)
    a = cv2.resize(a, (n, n), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(a, (0, 0), 3)
    return a > np.quantile(a, 0.74)


CLOUDS = _clouds()


# ---------------------------------------------------------------- 世界

class World:
    """x・y・z の格子。y が上。1 マスは 2 つの状態を持つ: [on, off) の間 ids、off 以降は after。"""

    def __init__(self, X, Y, Z):
        self.X, self.Y, self.Z = X, Y, Z
        n = X * Z * Y
        self.ids = np.zeros(n, np.uint8)
        self.after = np.zeros(n, np.uint8)
        self.on = np.full(n, -1e9, np.float32)
        self.off = np.full(n, 1e9, np.float32)
        self.debris = []  # (x, y, z, vx, vy, vz, t0, 寿命, 種類, 回転, 大きさ)

    def idx(self, x, y, z):
        return (x * self.Z + z) * self.Y + y

    def inside(self, x, y, z):
        return 0 <= x < self.X and 0 <= y < self.Y and 0 <= z < self.Z

    def set(self, x, y, z, b, t=-1e9):
        """t 秒にブロックを置く。そのマスが t より前に別の物だったら、その物は t で入れ替わる。"""
        if not self.inside(x, y, z):
            return
        i = self.idx(x, y, z)
        if t > -1e8 and self.ids[i] and self.on[i] < t:
            self.off[i], self.after[i] = min(self.off[i], t), b
        else:
            self.ids[i], self.on[i], self.off[i], self.after[i] = b, t, 1e9, 0

    def get(self, x, y, z, t):
        i = self.idx(x, y, z)
        if self.on[i] <= t < self.off[i]:
            return int(self.ids[i])
        return int(self.after[i]) if t >= self.off[i] else 0

    def box(self, x0, y0, z0, x1, y1, z1, b, t=-1e9):
        """両端を含む直方体を一度に置く。"""
        for x in range(x0, x1 + 1):
            for z in range(z0, z1 + 1):
                for y in range(y0, y1 + 1):
                    self.set(x, y, z, b, t)

    def cells_box(self, x0, y0, z0, x1, y1, z1, b, hollow=False):
        out = []
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                for z in range(z0, z1 + 1):
                    if hollow and x0 < x < x1 and z0 < z < z1 and y0 < y < y1:
                        continue
                    out.append((x, y, z, b))
        return out

    def build(self, cells, t0, t1, seed=1, order="y"):
        """cells（x, y, z, 種類）を t0〜t1 に順に置く。order=y は下から、order=r は順番を乱す。"""
        if not cells:
            return []
        rng = np.random.default_rng(seed)
        if order == "y":
            keyed = sorted(cells, key=lambda c: (c[1], c[0] + c[2] * 0.37 + rng.random() * 3))
        elif order == "r":
            keyed = list(cells)
            rng.shuffle(keyed)
        else:
            keyed = list(cells)
        ts = np.linspace(t0, t1, len(keyed), dtype=np.float64)
        for c, tt in zip(keyed, ts):
            self.set(c[0], c[1], c[2], c[3], float(tt))
        return ts

    def carve(self, cx, cy, cz, r, t, seed=1, n_debris=240, power=1.0, keep=()):
        """t 秒に球を消して破片を飛ばす。縁は乱す。keep に挙げた種類は残る。"""
        rng = np.random.default_rng(seed)
        R = int(r + 2)
        removed = []
        for x in range(int(cx) - R, int(cx) + R + 1):
            for y in range(int(cy) - R, int(cy) + R + 1):
                for z in range(int(cz) - R, int(cz) + R + 1):
                    if not self.inside(x, y, z):
                        continue
                    d = math.dist((x, y, z), (cx, cy, cz))
                    if d > r * (0.82 + 0.3 * rng.random()):
                        continue
                    b = self.get(x, y, z, t)
                    if not b or NAMES[b] in keep or NAMES[b] == "bedrock":
                        continue
                    i = self.idx(x, y, z)
                    if self.on[i] <= t < self.off[i]:
                        self.off[i], self.after[i] = t, 0
                    elif t >= self.off[i]:  # 2 つ目の状態のまま消す: 消えた後を空にする（前の時刻は変えない）
                        self.after[i] = 0
                    removed.append((x, y, z, b))
        if removed:
            pick = rng.permutation(len(removed))[:n_debris]
            for k in pick:
                x, y, z, b = removed[k]
                v = np.array([x - cx, y - cy, z - cz], np.float32)
                v = v / (np.linalg.norm(v) + 0.5) * rng.uniform(6, 24) * power
                v[1] = abs(v[1]) * 0.8 + rng.uniform(4, 16) * power
                self.debris.append((x + 0.5, y + 0.5, z + 0.5, v[0], v[1], v[2], t, rng.uniform(1.4, 3.0), b, rng.uniform(0, 6.28), rng.uniform(0.35, 0.95)))
            for _ in range(int(n_debris * 0.3)):
                v = rng.standard_normal(3)
                v = v / np.linalg.norm(v) * rng.uniform(1, r * 1.1)
                self.debris.append((cx + v[0], cy + abs(v[1]), cz + v[2], v[0] * 0.5, abs(v[1]) * 0.6 + 1.5, v[2] * 0.5, t, rng.uniform(0.7, 1.5), -1, rng.uniform(0, 6.28), rng.uniform(0.8, 1.9)))
        return removed

    def arrays(self):
        """光線の高速化用に、列ごとの一番高いブロックを粗い格子（8×8）で持つ。"""
        solid = (self.ids != 0) | (self.after != 0)
        grid = solid.reshape(self.X, self.Z, self.Y)
        top = np.where(grid.any(axis=2), self.Y - 1 - np.argmax(grid[:, :, ::-1], axis=2), -1)
        cx, cz = (self.X + 7) // 8, (self.Z + 7) // 8
        cm = np.full((cx, cz), -1, np.int32)
        for i in range(cx):
            for j in range(cz):
                cm[i, j] = top[i * 8:(i + 1) * 8, j * 8:(j + 1) * 8].max()
        return self.ids, self.after, self.on, self.off, cm, int(top.max())


# ---------------------------------------------------------------- 光線

@njit(cache=True, nogil=True, fastmath=True)
def _vox(ids, after, on, off, i, t):
    if on[i] <= t:
        if t < off[i]:
            return ids[i]
        return after[i]
    return 0


@njit(cache=True, nogil=True, fastmath=True)
def _march(ids, after, on, off, cm, ymax, X, Y, Z, ox, oy, oz, dx, dy, dz, t, tmax, tcur, transp, skip_transp):
    """返り値: 種類, 軸(0/1/2), 距離, x, y, z。何にも当たらなければ種類 0。"""
    eps = 1e-4
    t0, t1 = tcur, tmax
    Yb = ymax + 1.0
    for o, d, a, c in ((ox, dx, 0.0, float(X)), (oy, dy, 0.0, Yb), (oz, dz, 0.0, float(Z))):
        if abs(d) < 1e-9:
            if o < a or o >= c:
                return 0, 0, 0.0, 0, 0, 0
        else:
            ta, tb = (a - o) / d, (c - o) / d
            if ta > tb:
                ta, tb = tb, ta
            t0, t1 = max(t0, ta), min(t1, tb)
    if t0 >= t1:
        return 0, 0, 0.0, 0, 0, 0
    tc = t0 + eps
    x = int(math.floor(ox + dx * tc))
    y = int(math.floor(oy + dy * tc))
    z = int(math.floor(oz + dz * tc))
    sx, sy, sz = (1 if dx > 0 else -1), (1 if dy > 0 else -1), (1 if dz > 0 else -1)
    ix = 1.0 / dx if abs(dx) > 1e-9 else 1e30
    iy = 1.0 / dy if abs(dy) > 1e-9 else 1e30
    iz = 1.0 / dz if abs(dz) > 1e-9 else 1e30
    ax = 1
    if t0 > tcur:  # 外から入ったときの面
        bx = abs(ox + dx * t0 - round(ox + dx * t0))
        bz = abs(oz + dz * t0 - round(oz + dz * t0))
        by = abs(oy + dy * t0 - round(oy + dy * t0))
        ax = 0 if bx < by and bx < bz else (2 if bz < by else 1)
    for _ in range(1400):
        if x < 0 or x >= X or y < 0 or y > ymax or z < 0 or z >= Z:
            return 0, 0, 0.0, 0, 0, 0
        # 列の一番上より高い所は、粗い格子を丸ごと飛ばす
        h = cm[x >> 3, z >> 3]
        if y > h:
            bx = ((x >> 3) + (1 if sx > 0 else 0)) * 8.0
            bz = ((z >> 3) + (1 if sz > 0 else 0)) * 8.0
            tnx = (bx - ox) * ix
            tnz = (bz - oz) * iz
            tn = min(tnx, tnz)
            nax = 0 if tnx < tnz else 2
            if dy < 0:
                tny = (h + 1.0 - oy) * iy
                if tny < tn:
                    tn, nax = tny, 1
            tn = max(tn, tc)
            if tn >= t1:
                return 0, 0, 0.0, 0, 0, 0
            nx = int(math.floor(ox + dx * (tn + eps)))
            ny = int(math.floor(oy + dy * (tn + eps)))
            nz = int(math.floor(oz + dz * (tn + eps)))
            if nx == x and ny == y and nz == z:
                pass
            else:
                ax = nax
                x, y, z = nx, ny, nz
                tc = tn + eps
                continue
        b = _vox(ids, after, on, off, (x * Z + z) * Y + y, t)
        if b and not (skip_transp and transp[b]):
            return b, ax, tc, x, y, z
        tx = (x + (1 if sx > 0 else 0) - ox) * ix
        ty = (y + (1 if sy > 0 else 0) - oy) * iy
        tz = (z + (1 if sz > 0 else 0) - oz) * iz
        if tx < ty and tx < tz:
            tc, ax = tx, 0
            x += sx
        elif tz < ty:
            tc, ax = tz, 2
            z += sz
        else:
            tc, ax = ty, 1
            y += sy
        if tc >= t1:
            return 0, 0, 0.0, 0, 0, 0
    return 0, 0, 0.0, 0, 0, 0


@njit(cache=True, nogil=True, fastmath=True)
def _giant_hit(gth, gm, ox, oy, oz, dx, dy, dz, tmax):
    """絵の立体（ローカル座標は x: 0〜w, y: 0〜h, z: -D〜D）に光線を当てる。gm = [cx, cy, cz, cos, sin, scale, D, 自ら光る量]。"""
    h, w = gth.shape
    if h < 2:
        return -1.0, 0, 0, 0, 0
    c, s, sc, D = gm[3], gm[4], gm[5], gm[6]
    px, py, pz = ox - gm[0], oy - gm[1], oz - gm[2]
    lx = (c * px + s * pz) / sc + w / 2.0
    ly = py / sc
    lz = (-s * px + c * pz) / sc
    ddx = (c * dx + s * dz) / sc
    ddy = dy / sc
    ddz = (-s * dx + c * dz) / sc
    t0, t1 = 0.0, tmax
    for o, d, a, b_ in ((lx, ddx, 0.0, float(w)), (ly, ddy, 0.0, float(h)), (lz, ddz, -D, D)):
        if abs(d) < 1e-9:
            if o < a or o >= b_:
                return -1.0, 0, 0, 0, 0
        else:
            ta, tb = (a - o) / d, (b_ - o) / d
            if ta > tb:
                ta, tb = tb, ta
            t0, t1 = max(t0, ta), min(t1, tb)
    if t0 >= t1:
        return -1.0, 0, 0, 0, 0
    tc = t0 + 1e-4
    x = int(math.floor(lx + ddx * tc))
    y = int(math.floor(ly + ddy * tc))
    z = int(math.floor(lz + ddz * tc))
    sx, sy, sz = (1 if ddx > 0 else -1), (1 if ddy > 0 else -1), (1 if ddz > 0 else -1)
    ix = 1.0 / ddx if abs(ddx) > 1e-9 else 1e30
    iy = 1.0 / ddy if abs(ddy) > 1e-9 else 1e30
    iz = 1.0 / ddz if abs(ddz) > 1e-9 else 1e30
    bx = abs(lx + ddx * t0 - round(lx + ddx * t0))
    by = abs(ly + ddy * t0 - round(ly + ddy * t0))
    bz = abs(lz + ddz * t0 - round(lz + ddz * t0))
    ax = 0 if bx < by and bx < bz else (2 if bz < by else 1)
    iD = int(D)
    for _ in range(600):
        if x < 0 or x >= w or y < 0 or y >= h or z < -iD or z >= iD:
            return -1.0, 0, 0, 0, 0
        th = gth[h - 1 - y, x]
        if th > 0 and (z >= -th and z < th):
            return tc, ax, x, h - 1 - y, z
        tx = (x + (1 if sx > 0 else 0) - lx) * ix
        ty = (y + (1 if sy > 0 else 0) - ly) * iy
        tz = (z + (1 if sz > 0 else 0) - lz) * iz
        if tx < ty and tx < tz:
            tc, ax = tx, 0
            x += sx
        elif tz < ty:
            tc, ax = tz, 2
            z += sz
        else:
            tc, ax = ty, 1
            y += sy
        if tc >= t1:
            return -1.0, 0, 0, 0, 0
    return -1.0, 0, 0, 0, 0


@njit(cache=True, nogil=True, fastmath=True)
def _sky(dx, dy, dz, sun, sun_col, top, hor, night, t, clouds, oy, ox, oz, cloud_a):
    k = max(0.0, dy)
    k = k ** 0.55
    r = hor[0] + (top[0] - hor[0]) * k
    g = hor[1] + (top[1] - hor[1]) * k
    b = hor[2] + (top[2] - hor[2]) * k
    if dy < 0:
        s = min(1.0, -dy * 4)
        r, g, b = r * (1 - s * 0.45), g * (1 - s * 0.45), b * (1 - s * 0.45)
    # 四角い太陽（太陽の反対に四角い月）
    for sgn, gain in ((1.0, 1.0), (-1.0, 0.8)):
        lx, ly, lz = sun[0] * sgn, sun[1] * sgn, sun[2] * sgn
        c = dx * lx + dy * ly + dz * lz
        if c > 0.9:
            # 面の基底は緯線と経線
            ex, ez = lz, -lx
            n = math.sqrt(ex * ex + ez * ez) + 1e-6
            ex, ez = ex / n, ez / n
            fx, fy, fz = ly * ez, lz * ex - lx * ez, -ly * ex
            u = (dx * ex + dz * ez) / c
            v = (dx * fx + dy * fy + dz * fz) / c
            m = max(abs(u), abs(v))
            if m < 0.075:
                w = gain if sgn > 0 else 0.92 * night
                if sgn > 0:
                    r, g, b = r + (sun_col[0] * 1.6 - r) * w, g + (sun_col[1] * 1.6 - g) * w, b + (sun_col[2] * 1.6 - b) * w
                else:
                    r, g, b = r + (0.86 - r) * w, g + (0.88 - g) * w, b + (0.95 - b) * w
            elif sgn > 0 and m < 0.3:
                w = (0.3 - m) / 0.225
                w = w * w * 0.35
                r, g, b = r + sun_col[0] * w, g + sun_col[1] * w, b + sun_col[2] * w
    if night > 0.6 and dy > 0:
        a = int((dx / (dy + 0.3)) * 170) & 255
        c2 = int((dz / (dy + 0.3)) * 170) & 255
        if ((a * 31 + c2 * 57) ^ (a * c2)) % 251 == 0:
            r, g, b = r + night, g + night, b + night
    # 平たい四角い雲
    if dy > 0.015 and cloud_a > 0:
        ct = (150.0 - oy) / dy
        if ct < 2500:
            px = int(math.floor((ox + dx * ct + t * 1.5) / 6.0)) & 255
            pz = int(math.floor((oz + dz * ct) / 6.0)) & 255
            if clouds[pz, px]:
                f = cloud_a * min(1.0, (2500 - ct) / 1500)
                cr, cg, cb = sun_col[0] + top[0] * 0.3 + 0.1, sun_col[1] + top[1] * 0.3 + 0.1, sun_col[2] + top[2] * 0.3 + 0.1
                r, g, b = r + (cr - r) * f, g + (cg - g) * f, b + (cb - b) * f
    return r, g, b


@njit(cache=True, nogil=True, fastmath=True)
def _ao(ids, after, on, off, X, Y, Z, t, x, y, z, ax, sgn, u, v, transp):
    """面の周りのブロックで角を暗くする。u, v は面の中の 0〜1。"""
    nx, ny, nz = (sgn if ax == 0 else 0), (sgn if ax == 1 else 0), (sgn if ax == 2 else 0)
    if ax == 0:
        e1, e2 = (0, 1, 0), (0, 0, 1)
    elif ax == 1:
        e1, e2 = (1, 0, 0), (0, 0, 1)
    else:
        e1, e2 = (1, 0, 0), (0, 1, 0)
    occ = 0.0
    ms = (-1, -1, 1, 1, -1, 1, -1, 1)
    ns = (-1, 1, -1, 1, 0, 0, 0, 0)
    for k in range(8):
        a, c = (ms[k], ns[k]) if k < 4 else (0, 0)
        if k >= 4:
            a, c = ((-1, 0), (1, 0), (0, -1), (0, 1))[k - 4]
        qx = x + nx + e1[0] * a + e2[0] * c
        qy = y + ny + e1[1] * a + e2[1] * c
        qz = z + nz + e1[2] * a + e2[2] * c
        if qx < 0 or qx >= X or qy < 0 or qy >= Y or qz < 0 or qz >= Z:
            continue
        b = _vox(ids, after, on, off, (qx * Z + qz) * Y + qy, t)
        if not b or transp[b]:
            continue
        du = (u if a < 0 else (1 - u)) if a != 0 else 1.0
        dv = (v if c < 0 else (1 - v)) if c != 0 else 1.0
        if a != 0 and c != 0:
            w = max(0.0, 1 - math.sqrt(du * du + dv * dv))
            occ += w * 0.45
        else:
            w = max(0.0, 1 - min(du, dv) * 1.6)
            occ += w * w * 0.62
    return max(0.35, 1 - occ)


@njit(cache=True, nogil=True, fastmath=True)
def _render(ids, after, on, off, cm, ymax, X, Y, Z, atlas, avg, transp, emissive, clouds,
            pos, right, up, fwd, f, W, H, t, sun, sun_col, amb, top, hor, night, fog, lights, g1i, g1t, g1m, g2i, g2t, g2m, g3i, g3t, g3m, cloud_a, shadow_on):
    rgb = np.empty((H, W, 3), np.float32)
    depth = np.empty((H, W), np.float32)
    fp = f * W
    ox, oy, oz = pos[0], pos[1], pos[2]
    sl = sun[1] > 0.02
    for j in range(H):
        vy = (H / 2.0 - j - 0.5) / fp
        for i in range(W):
            ux = (i - W / 2.0 + 0.5) / fp
            dx = right[0] * ux + up[0] * vy + fwd[0]
            dy = right[1] * ux + up[1] * vy + fwd[1]
            dz = right[2] * ux + up[2] * vy + fwd[2]
            n = math.sqrt(dx * dx + dy * dy + dz * dz)
            dx, dy, dz = dx / n, dy / n, dz / n
            # 透過のブロック（水・ガラス）は 1 回だけ色を重ねる
            tcur = 0.0
            tr, tg, tb, ta = 0.0, 0.0, 0.0, 0.0
            surf_d = -1.0
            r, g, b = 0.0, 0.0, 0.0
            hit_d = 1e6
            for _pass in range(3):
                hit, ax, d, x, y, z = _march(ids, after, on, off, cm, ymax, X, Y, Z, ox, oy, oz, dx, dy, dz, t, 800.0, tcur, transp, False)
                gd, gax, gx, gy, gz, gcol = -1.0, 0, 0, 0, 0, 0
                tlim = d if hit else 800.0
                for gi in range(3):
                    if gi == 0:
                        gt_, gim_, gmm = g1t, g1i, g1m
                    elif gi == 1:
                        gt_, gim_, gmm = g2t, g2i, g2m
                    else:
                        gt_, gim_, gmm = g3t, g3i, g3m
                    q = _giant_hit(gt_, gmm, ox, oy, oz, dx, dy, dz, tlim)
                    if q[0] >= 0 and q[0] < tlim:
                        gd, gax, gx, gy, gz = q
                        gcol = gi
                        tlim = gd
                if gd >= 0:
                    # 絵のブロック
                    gim_ = g1i if gcol == 0 else (g2i if gcol == 1 else g3i)
                    gmm = g1m if gcol == 0 else (g2m if gcol == 1 else g3m)
                    cr, cg, cb = gim_[gy, gx, 0] / 255.0, gim_[gy, gx, 1] / 255.0, gim_[gy, gx, 2] / 255.0
                    px, py, pz = ox + dx * gd, oy + dy * gd, oz + dz * gd
                    c_, s_, sc_ = gmm[3], gmm[4], gmm[5]
                    lx = (c_ * (px - gmm[0]) + s_ * (pz - gmm[2])) / sc_
                    ly = (py - gmm[1]) / sc_
                    lz = (-s_ * (px - gmm[0]) + c_ * (pz - gmm[2])) / sc_
                    if gax == 0:
                        nlx = -1.0 if (c_ * dx + s_ * dz) > 0 else 1.0
                        wnx, wny, wnz = c_ * nlx, 0.0, s_ * nlx
                        uu, vv = lz - math.floor(lz), ly - math.floor(ly)
                    elif gax == 1:
                        wnx, wny, wnz = 0.0, (-1.0 if dy > 0 else 1.0), 0.0
                        uu, vv = lx - math.floor(lx), lz - math.floor(lz)
                    else:
                        nlz = -1.0 if (-s_ * dx + c_ * dz) > 0 else 1.0
                        wnx, wny, wnz = -s_ * nlz, 0.0, c_ * nlz
                        uu, vv = lx - math.floor(lx), ly - math.floor(ly)
                    # ブロックの継ぎ目
                    ed = min(min(uu, 1 - uu), min(vv, 1 - vv))
                    seam = 0.72 if ed < 0.07 else (0.93 if ed < 0.14 else 1.0)
                    seam = 1.0 + (seam - 1.0) * max(0.0, 1.0 - gd / sc_ / 160.0) * (0.3 if gmm[7] > 0 else 1.0)
                    cr, cg, cb = cr * seam, cg * seam, cb * seam
                    ndl = max(0.0, wnx * sun[0] + wny * sun[1] + wnz * sun[2])
                    vis = 1.0
                    if sl and ndl > 0 and shadow_on:
                        sx0, sy0, sz0 = px + wnx * 0.05, py + wny * 0.05, pz + wnz * 0.05
                        hh = _march(ids, after, on, off, cm, ymax, X, Y, Z, sx0, sy0, sz0, sun[0], sun[1], sun[2], t, 120.0, 0.0, transp, True)
                        if hh[0]:
                            vis = 0.0
                    la = amb[0] * (0.68 + 0.32 * wny) + sun_col[0] * ndl * vis
                    lb = amb[1] * (0.68 + 0.32 * wny) + sun_col[1] * ndl * vis
                    lc = amb[2] * (0.68 + 0.32 * wny) + sun_col[2] * ndl * vis
                    for li in range(lights.shape[0]):
                        q0, q1, q2 = lights[li, 0] - px, lights[li, 1] - py, lights[li, 2] - pz
                        dd = q0 * q0 + q1 * q1 + q2 * q2 + 1.0
                        w = lights[li, 6] / dd
                        la, lb, lc = la + lights[li, 3] * w, lb + lights[li, 4] * w, lc + lights[li, 5] * w
                    r, g, b = cr * (la + gmm[7]), cg * (lb + gmm[7]), cb * (lc + gmm[7])
                    hit_d = gd
                    break
                if not hit:
                    r, g, b = _sky(dx, dy, dz, sun, sun_col, top, hor, night, t, clouds, oy, ox, oz, cloud_a)
                    hit_d = 1e6
                    break
                px, py, pz = ox + dx * d, oy + dy * d, oz + dz * d
                sgn = 1 if (dx if ax == 0 else (dy if ax == 1 else dz)) < 0 else -1
                if ax == 0:
                    uu, vv = pz - math.floor(pz), py - math.floor(py)
                    face = 1
                elif ax == 1:
                    uu, vv = px - math.floor(px), pz - math.floor(pz)
                    face = 0 if sgn > 0 else 2
                else:
                    uu, vv = px - math.floor(px), py - math.floor(py)
                    face = 1
                tu = min(15, int(uu * 16))
                tv = min(15, int((1 - vv) * 16)) if ax != 1 else min(15, int(vv * 16))
                bi = int(hit)
                if emissive[bi] and bi == 17:  # 溶岩は流れる
                    tv = (tv + int(t * 3)) & 15
                    tu = (tu + int(t * 1.3 + x * 3)) & 15
                tex = atlas[bi, face, tv, tu]
                # 遠くは平均の色へ寄せてちらつきを消す
                mp = min(1.0, max(0.0, (d - 35.0) / 90.0))
                cr = tex[0] + (avg[bi, face, 0] - tex[0]) * mp
                cg = tex[1] + (avg[bi, face, 1] - tex[1]) * mp
                cb = tex[2] + (avg[bi, face, 2] - tex[2]) * mp
                if transp[bi]:
                    a = 0.62 if bi == 18 else 0.2
                    if ta < 0.01:
                        tr, tg, tb, ta = cr, cg, cb, a
                        surf_d = d
                    tcur = d + 1e-3
                    # 同じ透過の塊の中は飛ばす
                    q = _march(ids, after, on, off, cm, ymax, X, Y, Z, ox, oy, oz, dx, dy, dz, t, 800.0, tcur, transp, True)
                    if q[0]:
                        tcur = q[2] - 1e-3
                    else:
                        tcur = 790.0
                        r, g, b = _sky(dx, dy, dz, sun, sun_col, top, hor, night, t, clouds, oy, ox, oz, cloud_a)
                        hit_d = surf_d
                        break
                    continue
                nx, ny, nz = (sgn if ax == 0 else 0), (sgn if ax == 1 else 0), (sgn if ax == 2 else 0)
                ndl = max(0.0, nx * sun[0] + ny * sun[1] + nz * sun[2])
                vis = 1.0
                if sl and ndl > 0 and shadow_on:
                    sx0, sy0, sz0 = px + nx * 0.02, py + ny * 0.02, pz + nz * 0.02
                    hh = _march(ids, after, on, off, cm, ymax, X, Y, Z, sx0, sy0, sz0, sun[0], sun[1], sun[2], t, 120.0, 0.0, transp, True)
                    if hh[0]:
                        vis = 0.0
                    else:
                        for gi in range(3):
                            if gi == 0:
                                q = _giant_hit(g1t, g1m, sx0, sy0, sz0, sun[0], sun[1], sun[2], 240.0)
                            elif gi == 1:
                                q = _giant_hit(g2t, g2m, sx0, sy0, sz0, sun[0], sun[1], sun[2], 240.0)
                            else:
                                q = _giant_hit(g3t, g3m, sx0, sy0, sz0, sun[0], sun[1], sun[2], 240.0)
                            if q[0] >= 0:
                                vis = 0.0
                                break
                ao = _ao(ids, after, on, off, X, Y, Z, t, x, y, z, ax, sgn, uu, vv, transp) if d < 90 else 1.0
                face_k = 1.0 if ax == 1 else (0.9 if ax == 2 else 0.8)
                up_k = 0.68 + 0.32 * ny
                la = amb[0] * up_k * ao * face_k + sun_col[0] * ndl * vis
                lb = amb[1] * up_k * ao * face_k + sun_col[1] * ndl * vis
                lc = amb[2] * up_k * ao * face_k + sun_col[2] * ndl * vis
                for li in range(lights.shape[0]):
                    q0, q1, q2 = lights[li, 0] - px, lights[li, 1] - py, lights[li, 2] - pz
                    dd = q0 * q0 + q1 * q1 + q2 * q2 + 1.0
                    w = lights[li, 6] / dd * max(0.25, (q0 * nx + q1 * ny + q2 * nz) / math.sqrt(dd) * 0.75 + 0.5)
                    la, lb, lc = la + lights[li, 3] * w, lb + lights[li, 4] * w, lc + lights[li, 5] * w
                em = emissive[bi]
                r = cr * (la + em * 1.25)
                g = cg * (lb + em * 1.25)
                b = cb * (lc + em * 1.25)
                hit_d = d
                break
            # 透過の面
            if ta > 0:
                rr = ta if surf_d > 0 else 0.0
                wet = amb[0] * 0.6 + sun_col[0] * 0.5, amb[1] * 0.6 + sun_col[1] * 0.5, amb[2] * 0.6 + sun_col[2] * 0.5
                r = r + (tr * wet[0] - r) * rr
                g = g + (tg * wet[1] - g) * rr
                b = b + (tb * wet[2] - b) * rr
                hit_d = min(hit_d, surf_d)
            # 霧
            if hit_d < 1e5 and fog > 0:
                k = 1 - math.exp(-fog * hit_d)
                r, g, b = r + (hor[0] - r) * k, g + (hor[1] - g) * k, b + (hor[2] - b) * k
            rgb[j, i, 0], rgb[j, i, 1], rgb[j, i, 2] = r, g, b
            depth[j, i] = hit_d
    return rgb, depth


# ---------------------------------------------------------------- カメラ・時刻

class Cam:
    def __init__(self, pos, target, f=0.8, roll=0.0):
        self.pos = np.array(pos, np.float64)
        self.target = np.array(target, np.float64)
        self.f, self.roll = f, roll
        fw = self.target - self.pos
        fw /= np.linalg.norm(fw) + 1e-9
        rg = np.cross(np.array([0, 1.0, 0]), fw)
        rg /= np.linalg.norm(rg) + 1e-9
        up = np.cross(fw, rg)
        if roll:
            a = math.radians(roll)
            rg, up = rg * math.cos(a) + up * math.sin(a), -rg * math.sin(a) + up * math.cos(a)
        self.fwd, self.right, self.up = fw, rg, up

    @staticmethod
    def orbit(target, az, el, dist, f=0.8, roll=0.0):
        a, e = math.radians(az), math.radians(el)
        tx, ty, tz = target
        return Cam((tx + dist * math.sin(a) * math.cos(e), ty + dist * math.sin(e), tz - dist * math.cos(a) * math.cos(e)), target, f, roll)

    def project(self, p, W, H):
        d = np.asarray(p, np.float64) - self.pos
        z = float(d @ self.fwd)
        if z < 0.2:
            return None
        fp = self.f * W
        return W / 2 + fp * float(d @ self.right) / z, H / 2 - fp * float(d @ self.up) / z, z


def daylight(h):
    """h は時刻（0〜24）。太陽の向き・光・空の色を返す。6 時に東（+x）から昇り 18 時に西へ沈む。"""
    a = (h - 6) / 12 * math.pi
    sun = np.array([math.cos(a), math.sin(a), -0.42], np.float64)
    sun /= np.linalg.norm(sun)
    el = sun[1]
    day = np.clip((el + 0.05) / 0.35, 0, 1)
    dusk = float(np.clip(1 - abs(el - 0.05) / 0.28, 0, 1))
    sun_col = np.array([1.06, 1.0, 0.88]) * day * 0.6 + np.array([1.1, 0.5, 0.2]) * dusk * 0.55 * (el > -0.05)
    amb = np.array([0.46, 0.5, 0.6]) * day + np.array([0.17, 0.2, 0.32]) * (1 - day) + np.array([0.12, 0.05, 0.03]) * dusk
    top = np.array([0.32, 0.53, 0.95]) * day + np.array([0.012, 0.018, 0.055]) * (1 - day)
    hor = np.array([0.72, 0.84, 1.0]) * day + np.array([0.03, 0.04, 0.09]) * (1 - day)
    hor = hor * (1 - dusk * 0.7) + np.array([1.0, 0.56, 0.28]) * dusk * 0.7
    night = float(1 - day)
    return dict(sun=sun.astype(np.float64), sun_col=sun_col, amb=amb, top=top, hor=hor, night=night)


# ---------------------------------------------------------------- 絵の立体

EMPTY_I = np.zeros((1, 1, 3), np.uint8)
EMPTY_T = np.zeros((1, 1), np.int32)
EMPTY_M = np.zeros(8, np.float64)


class Giant:
    """rgba（アルファ付きの絵）から作る立体。height は縦のブロック数、depth は胴の最大の半分の厚み（ブロック数）。"""

    def __init__(self, rgb, thick, cx, cy, cz, yaw=0.0, scale=1.0, glow=0.0):
        self.rgb, self.thick, self.glow = rgb, thick, glow
        self.cx, self.cy, self.cz, self.yaw, self.scale = cx, cy, cz, yaw, scale

    @staticmethod
    def from_rgba(im, height, depth, cx, cy, cz, yaw=0.0, scale=1.0, posterize=26, seed=3, sat=1.12):
        a = np.asarray(im.convert("RGBA"))
        h = height
        w = max(1, round(a.shape[1] * h / a.shape[0]))
        small = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
        alpha = small[..., 3] > 110
        rgb = small[..., :3].astype(np.float32)
        g = rgb.mean(axis=2, keepdims=True)
        rgb = g + (rgb - g) * sat
        # 同じ色のブロックが並ぶように色を丸め、少しだけ乱す
        rng = np.random.default_rng(seed)
        rgb = np.round(rgb / posterize) * posterize + rng.standard_normal((h, w, 1)) * 3.0
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
        dist = cv2.distanceTransform(alpha.astype(np.uint8), cv2.DIST_L2, 3)
        m = max(1.0, float(dist.max()))
        th = np.where(alpha, np.ceil(np.sqrt(np.clip(dist / m, 0, 1)) * depth).astype(np.int32), 0)
        th = np.where(alpha & (th < 1), 1, th).astype(np.int32)
        return Giant(rgb, th, cx, cy, cz, yaw, scale)

    def mat(self):
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        return np.array([self.cx, self.cy, self.cz, c, s, self.scale, float(self.thick.max()) + 1, self.glow], np.float64)


# ---------------------------------------------------------------- 描く

def render(world, arrays, cam, W, H, t, hour=12.0, fog=0.0035, lights=None, giants=(), clouds=1.0, shadow=True, sky=None):
    """色（0〜1 の float32）と奥行きを返す。"""
    ids, after, on, off, cm, ymax = arrays
    dl = sky or daylight(hour)
    sl = np.zeros((0, 7), np.float64) if lights is None or not len(lights) else np.asarray(lights, np.float64)
    gs = list(giants)[:3]
    while len(gs) < 3:
        gs.append(None)
    args = []
    for g in gs:
        if g is None:
            args += [EMPTY_I, EMPTY_T, EMPTY_M]
        else:
            args += [g.rgb, g.thick, g.mat()]
    return _render(ids, after, on, off, cm, ymax, world.X, world.Y, world.Z, ATLAS, AVG, TRANSPARENT, EMISSIVE, CLOUDS,
                   cam.pos, cam.right, cam.up, cam.fwd, cam.f, W, H, float(t), dl["sun"], dl["sun_col"], dl["amb"], dl["top"], dl["hor"], dl["night"],
                   float(fog), sl, *args, float(clouds), bool(shadow))


def tonemap(rgb, bloom=0.5, exposure=1.0):
    """色を 8bit に。明るい所をにじませる。"""
    x = rgb * exposure
    if bloom > 0:
        hi = np.clip(x - 1.0, 0, 4)
        small = cv2.resize(hi, (x.shape[1] // 4, x.shape[0] // 4), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (0, 0), 7)
        x = x + cv2.resize(small, (x.shape[1], x.shape[0]), interpolation=cv2.INTER_LINEAR) * bloom
    # 絵の色はそのまま掛けた値を使い、0.8 より上だけ頭を丸める
    x = np.where(x > 0.8, 0.8 + 0.2 * (1 - np.exp(-(x - 0.8) / 0.2)), x)
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)


def board(img, depth, cam, im, foot, h, alpha=1.0, flip=False, tint=None, light=(1.0, 1.0, 1.0), shadow=0.4, rot=0.0, y_shadow=None):
    """人物などの板を世界の foot（足元）に立て、奥行きで前後を判定して img（H×W×3 の uint8）へ重ねる。"""
    H, W = img.shape[:2]
    pr = cam.project(foot, W, H)
    if pr is None:
        return
    sx, sy, z = pr
    hp = cam.f * W * h / z
    if hp < 3 or hp > H * 12:
        return
    if shadow:
        yy = foot[1] if y_shadow is None else y_shadow
        sh = cam.project((foot[0], yy, foot[2]), W, H)
        if sh is not None:
            r = hp * 0.2
            ry = r * max(0.14, abs(float(cam.fwd[1])) * 0.9)
            x0, x1 = int(sh[0] - r), int(sh[0] + r) + 1
            y0, y1 = int(sh[1] - ry), int(sh[1] + ry) + 1
            x0c, x1c, y0c, y1c = max(0, x0), min(W, x1), max(0, y0), min(H, y1)
            if x1c > x0c and y1c > y0c:
                yy_, xx_ = np.mgrid[y0c:y1c, x0c:x1c]
                d = ((xx_ - sh[0]) / max(r, 1)) ** 2 + ((yy_ - sh[1]) / max(ry, 1)) ** 2
                a = np.clip(1 - d, 0, 1) * shadow * (depth[y0c:y1c, x0c:x1c] < z + 3)
                img[y0c:y1c, x0c:x1c] = (img[y0c:y1c, x0c:x1c] * (1 - a[..., None])).astype(np.uint8)
    w = max(1, round(im.width * hp / im.height))
    hh = max(1, int(hp))
    # 画面の外は切って軽くする
    src = im
    if hp > H:
        keep_top = max(0.0, (sy - hp - 0) / hp)
        vis_top = max(0.0, -(sy - hp) / hp)
        vis_bot = min(1.0, (H - (sy - hp)) / hp)
        s0, s1 = int(vis_top * im.height), max(int(vis_top * im.height) + 1, int(vis_bot * im.height))
        src = im.crop((0, s0, im.width, min(im.height, s1)))
        hh_c = max(1, int(hp * (s1 - s0) / im.height))
        sy = (sy - hp) + hp * s0 / im.height + hh_c
        hh = hh_c
        hp = hh_c
    a = np.asarray(src.convert("RGBA"))
    a = cv2.resize(a, (w, hh), interpolation=cv2.INTER_AREA if hp < src.height else cv2.INTER_LINEAR)
    if flip:
        a = a[:, ::-1]
    if rot:
        c = cv2.getRotationMatrix2D((a.shape[1] / 2, a.shape[0] / 2), rot, 1)
        a = cv2.warpAffine(a, c, (a.shape[1], a.shape[0]))
    x, y = int(sx - a.shape[1] / 2), int(sy - a.shape[0])
    l, tt = max(0, -x), max(0, -y)
    r, b = min(a.shape[1], W - x), min(a.shape[0], H - y)
    if r <= l or b <= tt:
        return
    a = a[tt:b, l:r]
    x, y = x + l, y + tt
    col = a[..., :3].astype(np.float32) * np.array(light, np.float32)
    if tint is not None:
        col = col * (1 - tint[3]) + np.array(tint[:3], np.float32) * tint[3]
    al = a[..., 3:4].astype(np.float32) / 255.0 * alpha
    al = al * (depth[y:y + a.shape[0], x:x + a.shape[1], None] > z)
    dst = img[y:y + a.shape[0], x:x + a.shape[1]]
    img[y:y + a.shape[0], x:x + a.shape[1]] = np.clip(dst * (1 - al) + col * al, 0, 255).astype(np.uint8)


_CUBE = np.array([[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], np.float64)
_FACES = ((0, 1, 2, 3, (0, 0, -1)), (5, 4, 7, 6, (0, 0, 1)), (4, 0, 3, 7, (-1, 0, 0)), (1, 5, 6, 2, (1, 0, 0)), (3, 2, 6, 7, (0, 1, 0)), (4, 5, 1, 0, (0, -1, 0)))


def debris(img, depth, cam, deb, t, ground=31.0, sky=None, gravity=30.0):
    """破片と煙の小さい立方体を描く。deb は World.debris の配列（N×11）。"""
    if deb is None or not len(deb):
        return
    H, W = img.shape[:2]
    dt = t - deb[:, 6]
    live = (dt >= 0) & (dt < deb[:, 7])
    if not live.any():
        return
    d = deb[live]
    dt = dt[live]
    x = d[:, 0] + d[:, 3] * dt
    z = d[:, 2] + d[:, 5] * dt
    is_smoke = d[:, 8] < 0
    y = d[:, 1] + d[:, 4] * dt - np.where(is_smoke, -1.5, gravity * 0.5) * dt * dt * (np.where(is_smoke, 0.0, 1.0)) + np.where(is_smoke, dt * 1.5, 0)
    y = np.maximum(y, ground + d[:, 10] * 0.5)
    rel = np.stack([x, y, z], 1) - cam.pos
    zz = rel @ cam.fwd
    order = np.argsort(-zz)
    dl = sky or daylight(12)
    light = np.clip(dl["amb"] * 0.8 + dl["sun_col"] * 0.6, 0.05, 1.2)
    fp = cam.f * W
    lv = dl["sun"]
    for k in order:
        if zz[k] < 0.5:
            continue
        life = dt[k] / d[k, 7]
        s = d[k, 10] * 0.5
        bid = int(d[k, 8])
        if bid < 0:
            s *= (0.5 + life * 1.1) * (1 - life * life)
            c0 = np.array([0.72, 0.72, 0.72]) * (1 - life * 0.45)
            if dt[k] < 0.18:
                c0 = np.array([1.6, 1.1, 0.5])
        else:
            s *= min(1.0, (1 - life) * 3)
            c0 = AVG[bid, 1]
        p = np.array([x[k], y[k], z[k]])
        cx_ = float(rel[k] @ cam.right) * fp / zz[k] + W / 2
        cy_ = H / 2 - float(rel[k] @ cam.up) * fp / zz[k]
        if not (-60 < cx_ < W + 60 and -60 < cy_ < H + 60):
            continue
        ix, iy = int(np.clip(cx_, 0, W - 1)), int(np.clip(cy_, 0, H - 1))
        if depth[iy, ix] < zz[k] - 0.5:
            continue
        a1 = d[k, 9] + dt[k] * 4 * (0 if bid < 0 else 1)
        a2 = d[k, 9] * 1.7 + dt[k] * 3 * (0 if bid < 0 else 1)
        ca, sa, cb, sb = math.cos(a1), math.sin(a1), math.cos(a2), math.sin(a2)
        R = np.array([[ca, 0, sa], [sa * sb, cb, -ca * sb], [-sa * cb, sb, ca * cb]])
        v = (_CUBE * s) @ R.T + p
        rv = v - cam.pos
        zv = rv @ cam.fwd
        if (zv < 0.3).any():
            continue
        px = np.stack([(rv @ cam.right) * fp / zv + W / 2, H / 2 - (rv @ cam.up) * fp / zv], 1)
        for a, b, c, e, n in _FACES:
            nw = np.array(n, np.float64) @ R.T
            if nw @ (p + nw * s - cam.pos) >= 0:
                continue
            shade = 0.72 + 0.28 * max(0.0, float(nw @ lv))
            col = np.clip(c0 * light * shade, 0, 1) * 255
            cv2.fillConvexPoly(img, px[[a, b, c, e]].astype(np.int32), tuple(float(q) for q in col))


def rgb_to_im(a):
    return Image.fromarray(a)
