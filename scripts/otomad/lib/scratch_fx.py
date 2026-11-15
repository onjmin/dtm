"""Scratch の文字PV（界隈曲の PV）でよく使う演出を、時刻 t の関数として描く部品。

座標は Scratch の舞台と同じ（中心が原点・上が +y・縦 360）。数値を Scratch 作品から写しやすくするため。
Scratch のコマ単位の動き（毎コマ「x += (目標 - x) / k」「v *= 5/6」「v -= 0.3」）は 30fps の閉じた式に直してあるので、
どの t から描いても同じ絵になる（コマを順に回さなくてよい）。

部品（使い方は scripts/otomad/tools/scratch_fx_demo.py、技の説明は docs/otomad/techniques/scratch-fx.md）:
  BeatBoard     拍ごとに満ちる箱の盤（1拍1箱・縦8行で2小節・キックとスネアの2列・4拍ごとに外へずれて消える）。縦⇔横の組み替え。
  FramePop      中央の枠。サビ前に段々縮み、サビ頭で 180° 回りながら元の大きさへ戻る＋白い閃光。
  ScatterText   大きな字を散らして置き、置いた瞬間に1方向へ滑って止まる。カメラ（回転・拡大・ずらし）・枠での切り抜き・重力で崩れ落ちる。
  VerticalLyrics 縦書きの歌詞を右から左へ1行ずつ積む。
  Subtitle      下の1行字幕。
  blink         出る瞬間のちらつき（0.02 秒で 4 回）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS_SCRATCH = 30.0
FONT_PATH = 'C:/Windows/Fonts/YuGothB.ttc'


# ---- Scratch のコマ単位の動きを時間の式へ ----
def approach(start, target, k, dt):
    """毎コマ x += (target - x) / k を dt 秒続けた値。dt < 0 は start のまま"""
    if dt <= 0:
        return start
    return target + (start - target) * (1 - 1 / k) ** (dt * FPS_SCRATCH)


def drift_total(v0, r=5 / 6):
    return v0 / (1 - r)


def drift(v0, dt, r=5 / 6):
    """毎コマ v だけ進み v *= r で減る動きの、dt 秒後までの道のり（最大 v0 / (1 - r)）"""
    if dt <= 0:
        return 0.0
    n = dt * FPS_SCRATCH
    return v0 * (1 - r ** n) / (1 - r)


def fall(v0, dt, g=0.3):
    """毎コマ y += v、v -= g の dt 秒後の変位（v0 は最初の上向きの速さ）"""
    n = max(0.0, dt * FPS_SCRATCH)
    return n * v0 - g * n * (n - 1) / 2


def ghost(per_frame, dt):
    """毎コマ透明度 +per_frame（%）で消える不透明度 0..1"""
    return float(np.clip(1 - per_frame * max(0.0, dt) * FPS_SCRATCH / 100, 0, 1))


def blink(t, t0, n=4, half=0.02):
    """t0 から half 秒ごとに出る・消えるを n 回、その後は出たまま。t0 より前は消えている"""
    if t < t0:
        return False
    k = int((t - t0) / half)
    return k >= 2 * n or k % 2 == 0


# ---- 舞台 ----
@dataclass
class Stage:
    W: int = 1920
    H: int = 1080

    @property
    def s(self):
        return self.H / 360

    def px(self, x, y):
        return self.W / 2 + x * self.s, self.H / 2 - y * self.s

    def new(self, rgb=(0, 0, 0)):
        return Image.new('RGBA', (self.W, self.H), tuple(rgb) + (255,))


_fonts = {}
def font(size, path=FONT_PATH):
    key = (path, int(size))
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, int(size))
    return _fonts[key]


_glyphs = {}
def glyph(ch, size_px, fill=(0, 0, 0), path=FONT_PATH):
    """1字の RGBA 画像（字の中心が画像の中心）"""
    key = (ch, int(size_px), fill, path)
    if key not in _glyphs:
        f = font(size_px, path)
        l, t, r, b = f.getbbox(ch)
        w = max(r - l, int(size_px * 0.6)); h = max(b - t, int(size_px * 0.6))
        pad = 4
        im = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((pad - l + (w - (r - l)) / 2, pad - t + (h - (b - t)) / 2), ch, font=f, fill=tuple(fill) + (255,))
        _glyphs[key] = im
    return _glyphs[key]


def paste(canvas, im, cx, cy, rot=0.0, scale=1.0, alpha=1.0):
    """im を中心 (cx, cy)（画素）へ、rot 度（反時計回り）・scale 倍・不透明度 alpha で重ねる"""
    if alpha <= 0.003 or scale <= 0.01:
        return
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BICUBIC)
    if rot:
        im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 1:
        a = im.getchannel('A').point(lambda v: int(v * alpha))
        im = im.copy(); im.putalpha(a)
    canvas.alpha_composite(im, (int(round(cx - im.width / 2)), int(round(cy - im.height / 2))))


# ---- 箱の盤（拍ごとに満ちる箱） ----
# 手本の規則: 箱1つ = 1拍、縦8行 = 2小節。列は2本（中央寄りがキック、外がスネア）で、4拍ごとに全部が1列外へずれ、
# 3本目（隠し列）へ入った箱は滑りながら薄れて消える。箱は 22×22 ドットで、外周はぎざぎざの白い板＋内側に黒い線。
# 中身は静止した柄ではなく、打った瞬間から1コマずつ白く満ちる:
#   kick   滴が3つ落ち、底で跳ねて器の形 → 両端がせり上がる水面 → 満ちる（7コマ）
#   accent 滴のあと左半分が満ち、続いて右半分が満ちる（13コマ）。2小節の句の最後の拍
#   snare  中心の点から十字に光線が走り、区画が窓のように満ちて、白地に細い「#」の線が残る（6コマ）
#   snare2 snare と同じ満ち方を区画ごとに順に（左上 → 右下 → 左下 → 右上、12コマ）
# 絵は手本の画像を写さず、この規則から描く。
BOX_PX = 22          # 箱の外寸（ドット）
BOX_IN = 16          # 中の満ちる所（ドット）


def _box_plate():
    """外周の白い板（ぎざぎざの切り欠きつき）と、その内側の黒い1ドットの線。→ (白, 黒) のマスク"""
    white = np.zeros((BOX_PX, BOX_PX), bool)
    white[:2, :] = white[-2:, :] = white[:, :2] = white[:, -2:] = True
    notch = [3, 6, 8, 13, 15, 18]                    # 板の切り欠き（外側と内側に交互に）
    for k, i in enumerate(notch):
        o = 0 if k % 2 == 0 else 1
        white[o, i] = white[BOX_PX - 1 - o, i] = white[i, o] = white[i, BOX_PX - 1 - o] = False
    for i in (7, 11, 14):                            # 縁に食い込む黒い点
        white[i, 1] = white[i, BOX_PX - 2] = False
    black = np.zeros((BOX_PX, BOX_PX), bool)
    black[2, 2:20] = black[19, 2:20] = black[2:20, 2] = black[2:20, 19] = True
    black |= ~white & ~np.pad(np.ones((16, 16), bool), 3)
    black[3:19, 3:19] = False
    return white, black


def _kick_stages(n=BOX_IN):
    """液が満ちる段: 滴3つ → 底で跳ねた器の形 → 両端がせり上がった水面 → 上の真ん中だけ欠ける → 満ちる"""
    yy, xx = np.mgrid[0:n, 0:n]
    c = (n - 1) / 2
    S = []
    for top, h in ((0, 1), (4, 2), (9, 3)):
        m = np.zeros((n, n), bool); m[top:top + h, 7:9] = True; S.append(m)
    cup = (yy >= 13) | ((yy >= 10) & ((xx <= 1) | (xx >= n - 2))) | ((yy == 11) & ((xx == 6) | (xx == 9)))
    S.append(cup)
    arch = ~((((xx - c) / 6.5) ** 2 + ((yy - 1) / 9) ** 2) < 1) & (yy >= 1)   # 丸い水面の窪み
    S.append(arch)
    S.append(~((yy < 2) & (abs(xx - c) < 3)))
    S.append(np.ones((n, n), bool))
    return S


def _hash_final(n=BOX_IN):
    """十字に弾けた後の形: 白地に「#」の細い黒線（真ん中の帯は白）"""
    yy, xx = np.mgrid[0:n, 0:n]
    m = np.ones((n, n), bool)
    m[((xx == 6) | (xx == 9)) & ((yy < 6) | (yy > 9))] = False
    m[((yy == 6) | (yy == 9)) & ((xx < 3) | (xx > 12))] = False
    return m


def _burst_stages(n=BOX_IN):
    """中心から十字に弾ける段: 点 → 短い十字と火花 → 端まで届く光線とひび → 区画が窓のように満ちる → 窓の穴が残る → #"""
    yy, xx = np.mgrid[0:n, 0:n]
    band = lambda w, L: ((abs(xx - 7.5) < w) & (abs(yy - 7.5) < L)) | ((abs(yy - 7.5) < w) & (abs(xx - 7.5) < L))
    final = _hash_final(n)
    S = [band(1, 1)]
    S.append(band(1, 3) | ((yy == 5) & (xx == 10)) | ((yy == 10) & (xx == 5)) | ((xx == 4) & (yy == 7)))
    rays = band(1, 8) | (((xx == 6) | (xx == 9)) & (abs(yy - 7.5) > 3)) | (((yy == 6) | (yy == 9)) & (abs(xx - 7.5) > 3))
    S.append(rays & ~((abs(xx - 7.5) > 6) & (abs(yy - 7.5) > 6)))
    quad = (abs(xx - 7.5) > 3) & (abs(yy - 7.5) > 3)
    win = quad & ~(((xx % 5) == 2) & ((yy % 5) == 2))
    S.append(band(1, 8) | (quad & ((xx < 2) | (xx > 13) | (yy < 2) | (yy > 13))) | (win & ((xx + yy) % 3 == 0)))
    holes = ((abs(xx - 7.5) > 4) & (abs(xx - 7.5) < 6.5) & (abs(yy - 7.5) > 4) & (abs(yy - 7.5) < 6.5))
    S.append(final & ~holes)
    S.append(final)
    return S


def _fill_frames(kind):
    """中 16×16 の白（True）のコマ列"""
    n = BOX_IN
    yy, xx = np.mgrid[0:n, 0:n]
    if kind == 'kick':
        return _kick_stages()
    if kind == 'accent':                             # 滴のあと、左半分が満ちてから右半分が満ちる
        K = _kick_stages()
        left, right = xx < 8, xx >= 8
        F = K[:3]
        F += [K[i] & left for i in (3, 4, 5, 6, 6, 6)]
        F += [left | (K[i] & right) for i in (4, 5, 6)]
        F.append(np.ones((n, n), bool))
        return F
    if kind == 'snare':
        return _burst_stages()
    if kind == 'snare2':                             # 区画が1つずつ: 左上 → 右下 → 左下 → 右上（風車の順）
        B = _burst_stages()
        quads = [(xx < 8) & (yy < 8), (xx >= 8) & (yy >= 8), (xx < 8) & (yy >= 8), (xx >= 8) & (yy < 8)]
        start = [0, 4, 6, 8]
        F = []
        for f in range(12):
            m = np.zeros((n, n), bool)
            for q, s in zip(quads, start):
                if f >= s:
                    m |= B[min(len(B) - 1, f - s)] & q
            F.append(m)
        return F
    raise ValueError(kind)


BOX_KINDS = ('kick', 'accent', 'snare', 'snare2')
_box_cache = {}
def box_frames(kind, px):
    """kind のコマ列（RGBA 画像）。kind=None は空の枠（中は透明）"""
    key = (kind, px)
    if key not in _box_cache:
        white, black = _box_plate()
        fills = [np.zeros((BOX_IN, BOX_IN), bool)] if kind is None else _fill_frames(kind)
        ims = []
        for f in fills:
            a = np.zeros((BOX_PX, BOX_PX, 4), np.uint8)
            a[black] = (0, 0, 0, 255)
            a[white] = (255, 255, 255, 255)
            if kind is not None:
                a[3:19, 3:19] = (0, 0, 0, 255)       # 点いた箱の中は黒で、下の空の枠を隠す
                a[3:19, 3:19][f] = (255, 255, 255, 255)
            ims.append(Image.fromarray(a, 'RGBA').resize((px, px), Image.NEAREST))
        _box_cache[key] = ims
    return _box_cache[key]


@dataclass
class Beat:
    t: float
    lane0: str | None = 'kick'    # 中央寄りの列: 'kick' / 'accent' / None
    lane1: str | None = None      # 外の列: 'snare' / 'snare2' / None


@dataclass
class BeatBoard:
    """拍ごとに満ちる箱の盤。beats は1拍ずつ（休みの拍も Beat(t, None, None) で入れる）。拍の通し番号 k の箱は
    行 k % rows に置かれ、列は「レーン + (今の4拍のまとまり - 置いた時のまとまり)」。2 を超えたら消える。"""
    stage: Stage
    beats: list
    rows: int = 8
    group: int = 4                  # 何拍ごとに1列ずれるか
    xs: tuple = (-160.0, -200.0, -260.0)   # 縦長の列の x（3本目は隠し列）
    top: float = 180.0              # 縦長: 行 r（1..8）の y = top - step * r
    step: float = 40.0
    h_x0: float = -180.0            # 横長: 行 r の x = h_x0 + step * r
    h_ys: tuple = (-100.0, -140.0, -180.0)
    box_size: float = 37.4          # 箱の一辺（Scratch 単位。手本は 22 単位 × 大きさ 170%）
    morphs: list = field(default_factory=list)   # [(時刻, 'v' or 'h')]
    start_layout: str = 'v'
    morph_stagger: float = 0.02
    appear: float = 0.0

    def __post_init__(self):
        self.beats = sorted(self.beats, key=lambda b: b.t)
        self._ts = np.array([b.t for b in self.beats])
        self._px = int(round(self.box_size * self.stage.s))

    def _slot(self, col, row, lay):
        r = row + 1
        if lay == 'v':
            return self.xs[min(col, 2)], self.top - self.step * r
        return self.h_x0 + self.step * r, self.h_ys[min(col, 2)]

    def _pos(self, t, col, row):
        prev, nxt, mt = self.start_layout, self.start_layout, None
        for t_, lay in self.morphs:
            if t_ <= t:
                prev, nxt, mt = nxt, lay, t_
        xa, ya = self._slot(col, row, prev); xb, yb = self._slot(col, row, nxt)
        if mt is None:
            return xb, yb
        dt = t - mt - (col * self.rows + row) * self.morph_stagger
        return approach(xa, xb, 2.0, dt), approach(ya, yb, 3.0, dt)

    def _zone_start(self, z):
        """z 番目の4拍のまとまりが始まった時刻"""
        i = z * self.group
        return self._ts[i] if i < len(self._ts) else 1e9

    def draw(self, canvas, t):
        if t < self.appear:
            return
        if blink(t, self.appear):
            empty = box_frames(None, self._px)[0]
            for col in (0, 1):
                for row in range(self.rows):
                    paste(canvas, empty, *self.stage.px(*self._pos(t, col, row)), alpha=0.5)
        K = int(np.searchsorted(self._ts, t, side='right')) - 1
        if K < 0:
            return
        Z = K // self.group
        for k in range(max(0, (Z - 3) * self.group), K + 1):
            b = self.beats[k]
            z0, row = k // self.group, k % self.rows
            for lane, kind in ((0, b.lane0), (1, b.lane1)):
                if kind is None:
                    continue
                col = lane + Z - z0
                if col > 2:
                    continue
                t_shift = self._zone_start(Z) if Z > z0 else b.t
                x0, y0 = self._pos(t, max(lane, col - 1), row)
                x1, y1 = self._pos(t, col, row)
                x = approach(x0, x1, 2.0, t - t_shift); y = approach(y0, y1, 3.0, t - t_shift)
                alpha = ghost(15, t - t_shift) if col >= 2 else 1.0
                fr = box_frames(kind, self._px)
                i = min(len(fr) - 1, int((t - b.t) * FPS_SCRATCH))
                paste(canvas, fr[i], *self.stage.px(x, y), alpha=alpha)


# ---- 中央の枠 ----
@dataclass
class FramePop:
    """中央の四角い枠。pops の各時刻 tp の前に shrink_steps 回だけ段々縮み、tp で回りながら元へ戻り、白く光って消える。"""
    stage: Stage
    pops: list = field(default_factory=list)   # 時刻（秒）
    size: float = 120.0                         # 一辺（Scratch 単位）
    center: tuple = (0.0, 20.0)
    fill: list = field(default_factory=list)    # [(時刻, (r,g,b) or None)] 枠の中の地の色
    shrink_steps: int = 5
    shrink_dt: float = 0.15
    shrink_pct: float = 12.0
    turn: float = 180.0
    line: int = 3
    appear: float = 0.0

    def scale_rot(self, t):
        s, rot = 1.0, 0.0
        for tp in self.pops:
            t_sh = tp - self.shrink_steps * self.shrink_dt - 0.4
            if t_sh <= t < tp:
                k = min(self.shrink_steps, int((t - t_sh) / self.shrink_dt) + 1)
                s = max(0.05, 1 - k * self.shrink_pct / 100)
            elif t >= tp:
                s0 = max(0.05, 1 - self.shrink_steps * self.shrink_pct / 100)
                s = approach(s0, 1.0, 4.5, t - tp)
                rot = approach(self.turn, 0.0, 4.5, t - tp)
        return s, rot

    def flash(self, t):
        a = 0.0
        for tp in self.pops:
            if t >= tp:
                a = max(a, 1.0 if t - tp < 0.4 else ghost(5, t - tp - 0.4))
        return a

    def fill_at(self, t):
        col = None
        for ft, c in self.fill:
            if ft <= t:
                col = c
        return col

    def rect_px(self, t):
        """枠の内側の 4 隅（画素、回転込み）"""
        s, rot = self.scale_rot(t)
        half = self.size * s / 2
        cx, cy = self.center
        th = math.radians(rot)
        pts = []
        for dx, dy in ((-half, half), (half, half), (half, -half), (-half, -half)):
            x = cx + dx * math.cos(th) - dy * math.sin(th)
            y = cy + dx * math.sin(th) + dy * math.cos(th)
            pts.append(self.stage.px(x, y))
        return pts

    def mask(self, t):
        m = Image.new('L', (self.stage.W, self.stage.H), 0)
        ImageDraw.Draw(m).polygon(self.rect_px(t), fill=255)
        return m

    def draw_back(self, canvas, t):
        if t < self.appear or not blink(t, self.appear):
            return
        col = self.fill_at(t)
        if col is not None:
            ImageDraw.Draw(canvas).polygon(self.rect_px(t), fill=tuple(col) + (255,))

    def draw_front(self, canvas, t):
        if t < self.appear or not blink(t, self.appear):
            return
        pts = self.rect_px(t)
        a = self.flash(t)
        if a > 0:
            lay = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
            ImageDraw.Draw(lay).polygon(pts, fill=(255, 255, 255, int(255 * a)))
            canvas.alpha_composite(lay)
        ImageDraw.Draw(canvas).line(pts + [pts[0]], fill=(255, 255, 255, 255), width=self.line)


# ---- 散らし字 ----
@dataclass
class Glyph:
    t: float           # 置く時刻
    ch: str
    x: float           # 置く位置（Scratch 単位）
    y: float
    size: float = 100  # Scratch の「大きさ %」。100 で字の高さ ≒ 40 単位
    angle: float = 90  # Scratch の向き（90 が正立）
    move_dir: float = 90  # 滑る向き（Scratch の向き。90 = 右、0 = 上）
    speed: float = 10  # 最初の速さ（単位/コマ）。止まるまでに speed × 6 進む
    color: tuple = (0, 0, 0)


@dataclass
class ScatterText:
    """字を置いた瞬間に1方向へ滑らせて止める。カメラで層ごと回す・寄る。clip_to の枠で切り抜く。fall_at で全部が崩れ落ちる。"""
    stage: Stage
    glyphs: list
    camera: object = None          # camera(t) -> (x, y, rot_deg, scale)
    clip_to: FramePop | None = None
    clears: list = field(default_factory=list)   # この時刻より前に置いた字は消す
    fall_at: float | None = None   # 崩れ落ちる時刻（この時は枠で切らない）
    fall_color: tuple | None = (255, 255, 255)  # 落ちる間の字の色（枠の地が消えて黒地に出るため）
    seed: int = 1
    unit_px: float = 40.0          # 大きさ 100% の字の高さ（Scratch 単位）

    def __post_init__(self):
        rng = np.random.default_rng(self.seed)
        self._fall_v = rng.uniform(0.5, 1.2, len(self.glyphs))

    def _visible(self, g, t):
        if g.t > t:
            return False
        for c in self.clears:
            if g.t < c <= t:
                return False
        return True

    def draw(self, canvas, t):
        lay = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        any_ = False
        falling = self.fall_at is not None and t >= self.fall_at
        for i, g in enumerate(self.glyphs):
            if not self._visible(g, t):
                continue
            d = drift(g.speed, min(t, self.fall_at if falling else t) - g.t)
            th = math.radians(g.move_dir)
            x = g.x + d * math.sin(th); y = g.y + d * math.cos(th)
            if falling:
                y += fall(self._fall_v[i], t - self.fall_at)
                if y < -260:
                    continue
            px, py = self.stage.px(x, y)
            col = self.fall_color if falling and self.fall_color else g.color
            im = glyph(g.ch, self.unit_px * self.stage.s * g.size / 100, col)
            paste(lay, im, px, py, rot=90 - g.angle)
            any_ = True
        if not any_:
            return
        if self.camera is not None:
            cx, cy, rot, sc = self.camera(t)
            if (cx, cy, rot, sc) != (0, 0, 0, 1):
                ox, oy = self.stage.px(0, 0)
                M = cv2.getRotationMatrix2D((ox, oy), rot, sc)
                M[0, 2] -= cx * self.stage.s * sc; M[1, 2] += cy * self.stage.s * sc
                arr = cv2.warpAffine(np.asarray(lay), M, lay.size, flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
                lay = Image.fromarray(arr, 'RGBA')
        if self.clip_to is not None and not falling:
            a = np.minimum(np.asarray(lay.getchannel('A')), np.asarray(self.clip_to.mask(t)))
            lay.putalpha(Image.fromarray(a))
        canvas.alpha_composite(lay)


def camera_keys(keys, k=4.5):
    """[(時刻, x, y, rot, scale)] のキーへ、Scratch の /k の寄せ方で近づくカメラ"""
    keys = sorted(keys)

    def cam(t):
        st = (0.0, 0.0, 0.0, 1.0); tt = None
        cur = st
        for kt, *v in keys:
            if kt > t:
                break
            if tt is not None:
                cur = tuple(approach(a, b, k, kt - tt) for a, b in zip(cur, tgt))
            tgt, tt = tuple(v), kt
        if tt is None:
            return st
        return tuple(approach(a, b, k, t - tt) for a, b in zip(cur, tgt))
    return cam


# ---- 縦書きの歌詞の積み上げ ----
@dataclass
class VerticalLyrics:
    stage: Stage
    lines: list          # [(時刻, 文字列)]
    x0: float = 215.0    # 1行目の x（Scratch 単位、右端）
    y0: float = 165.0    # 上端
    col: float = 14.0    # 行の間隔
    size: float = 11.0   # 字の高さ
    clears: list = field(default_factory=list)
    color: tuple = (255, 255, 255)
    per_char: float = 0.06  # 1字ずつ出す間隔（秒）
    max_cols: int = 9       # これを超えたら積み直す

    def draw(self, canvas, t):
        start = max([c for c in self.clears if c <= t], default=-1e9)
        shown = [(lt, s) for lt, s in self.lines if start <= lt <= t]
        shown = shown[(max(0, len(shown) - 1) // self.max_cols) * self.max_cols:]
        for i, (lt, s) in enumerate(shown):
            x = self.x0 - i * self.col
            n = min(len(s), int((t - lt) / self.per_char) + 1)
            for j, ch in enumerate(s[:n]):
                im = glyph(ch, self.size * self.stage.s, self.color)
                paste(canvas, im, *self.stage.px(x, self.y0 - j * self.size * 1.05))


@dataclass
class Subtitle:
    stage: Stage
    lines: list          # [(始め, 終わり, 文字列)]
    y: float = -95.0
    size: float = 10.0
    color: tuple = (255, 255, 255)

    def draw(self, canvas, t):
        for a, b, s in self.lines:
            if a <= t < b:
                f = font(self.size * self.stage.s)
                d = ImageDraw.Draw(canvas)
                w = d.textlength(s, font=f)
                x, y = self.stage.px(0, self.y)
                d.text((x - w / 2, y), s, font=f, fill=tuple(self.color) + (255,))
