"""Scratch の文字PV（界隈曲の PV）でよく使う演出を、時刻 t の関数として描く部品。

座標は Scratch の舞台と同じ（中心が原点・上が +y・縦 360）。数値を Scratch 作品から写しやすくするため。
Scratch のコマ単位の動き（毎コマ「x += (目標 - x) / k」「v *= 5/6」「v -= 0.3」）は 30fps の閉じた式に直してあるので、
どの t から描いても同じ絵になる（コマを順に回さなくてよい）。

部品（使い方は scripts/otomad/tools/scratch_fx_demo.py、技の説明は docs/otomad/techniques/scratch-fx.md）:
  StepGrid      ドラムの打点で点く箱の格子（シーケンサーの見た目）。小節ごとに列が送られ、古い列は薄れて消える。縦⇔横の組み替え。
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


# ---- 箱の格子（シーケンサー） ----
PATTERNS = ('fill', 'check', 'dots', 'cross', 'ring')

def _tile(kind, size, fg=(255, 255, 255)):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    m = max(2, size // 9); a, b = m, size - m - 1
    fgc = tuple(fg) + (255,)
    if kind == 'fill':
        d.rectangle([a, a, b, b], fill=fgc)
    elif kind == 'check':
        c = max(2, (b - a) // 4)
        for i in range(4):
            for j in range(4):
                if (i + j) % 2 == 0:
                    d.rectangle([a + i * c, a + j * c, a + (i + 1) * c - 1, a + (j + 1) * c - 1], fill=fgc)
        d.rectangle([a, a, b, b], outline=fgc, width=max(1, size // 20))
    elif kind == 'dots':
        r = max(1, size // 14)
        for i in range(3):
            for j in range(3):
                x = a + (b - a) * (i + 0.5) / 3; y = a + (b - a) * (j + 0.5) / 3
                d.ellipse([x - r, y - r, x + r, y + r], fill=fgc)
        d.rectangle([a, a, b, b], outline=fgc, width=max(1, size // 20))
    elif kind == 'cross':
        w = max(2, size // 8)
        d.line([a, a, b, b], fill=fgc, width=w); d.line([a, b, b, a], fill=fgc, width=w)
        d.rectangle([a, a, b, b], outline=fgc, width=max(1, size // 20))
    elif kind == 'ring':
        d.rectangle([a, a, b, b], outline=fgc, width=max(2, size // 7))
    return im


def _dashed(size, fg=(255, 255, 255), dash=None):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    m = max(2, size // 9); a, b = m, size - m - 1
    dash = dash or max(3, size // 10); w = max(1, size // 30)
    col = tuple(fg) + (200,)
    for x in range(a, b, dash * 2):
        d.line([x, a, min(x + dash, b), a], fill=col, width=w); d.line([x, b, min(x + dash, b), b], fill=col, width=w)
    for y in range(a, b, dash * 2):
        d.line([a, y, a, min(y + dash, b)], fill=col, width=w); d.line([b, y, b, min(y + dash, b)], fill=col, width=w)
    return im


@dataclass
class Hit:
    t: float       # 打点の時刻（秒）
    bar: int       # 何小節目か（列を送る単位）
    step: int      # 小節の中の位置（0..rows-1）
    kind: str = 'fill'


@dataclass
class StepGrid:
    """打点で点く箱の格子。列 = 小節。新しい小節が col 0（舞台の中央寄り）で、古い列は外側（縦長なら左、横長なら下）へ送られ、
    cols 本を超えた列は外側の隠し列へ滑りながら薄れて消える。手本は見える列が 2 本。
    layout(t) が 'v' のとき左に縦長、'h' のとき下に横長。切り替えは箱ごとに少しずつ遅らせて滑らせる。"""
    stage: Stage
    hits: list
    cols: int = 2
    rows: int = 8
    cell: float = 40.0                 # 箱の間隔（Scratch 単位）
    v_origin: tuple = (-160.0, 140.0)  # 縦長のときの col 0・row 0 の中心（古い列は左へ）
    h_origin: tuple = (-140.0, -100.0)  # 横長のときの col 0・row 0 の中心（古い列は下へ）
    morphs: list = field(default_factory=list)  # [(時刻, 'v' or 'h')]（時刻順）。最初の形は morphs が無ければ 'v'
    start_layout: str = 'v'
    shift_k: float = 2.0               # 列送りのなめらかさ（Scratch の /2）
    morph_k: float = 4.5
    morph_stagger: float = 0.025       # 組み替えで箱ごとに遅らせる秒
    appear: float = 0.0                # 格子の枠が出る時刻（blink つき）

    def __post_init__(self):
        cpx = int(self.cell * self.stage.s)
        self._cpx = cpx
        self._tiles = {k: _tile(k, cpx) for k in PATTERNS}
        self._empty = _dashed(cpx)
        self.hits = sorted(self.hits, key=lambda h: h.t)
        self._bar_start = {}
        for h in self.hits:
            self._bar_start.setdefault(h.bar, h.t)

    def _slot(self, col, row, lay):
        if lay == 'v':
            ox, oy = self.v_origin
            return ox - col * self.cell, oy - row * self.cell
        ox, oy = self.h_origin
        return ox + row * self.cell, oy - col * self.cell

    def _layout_mix(self, t, idx):
        """（前の形, 次の形, 混ぜ具合 0..1）"""
        prev, cur_t = self.start_layout, None
        nxt = prev
        for mt, lay in self.morphs:
            if mt <= t:
                prev, nxt, cur_t = nxt, lay, mt
        if cur_t is None:
            return prev, prev, 1.0
        dt = t - cur_t - idx * self.morph_stagger
        return prev, nxt, 1 - approach(1.0, 0.0, self.morph_k, dt)

    def _pos(self, t, col, row, idx):
        a, b, m = self._layout_mix(t, idx)
        xa, ya = self._slot(col, row, a); xb, yb = self._slot(col, row, b)
        return xa + (xb - xa) * m, ya + (yb - ya) * m

    def draw(self, canvas, t):
        if t < self.appear:
            return
        show = blink(t, self.appear)
        n = self.cols * self.rows
        if show:
            for c in range(self.cols):
                for r in range(self.rows):
                    x, y = self._pos(t, c, r, c * self.rows + r)
                    paste(canvas, self._empty, *self.stage.px(x, y))
        past = [h for h in self.hits if h.t <= t]
        if not past:
            return
        cur = past[-1].bar
        starts = sorted(self._bar_start.items())
        for h in past:
            age = cur - h.bar
            if age > self.cols:
                continue
            # 今の列へ送られた時刻と、送られる前の列
            t_shift = self._bar_start.get(h.bar + age, h.t) if age > 0 else h.t
            prev_col = age - 1 if age > 0 else 0
            idx = min(age, self.cols - 1) * self.rows + h.step
            x0, y0 = self._pos(t, prev_col, h.step, idx)
            x1, y1 = self._pos(t, min(age, self.cols - 1) if age < self.cols else self.cols, h.step, idx)
            x = approach(x0, x1, self.shift_k, t - t_shift)
            y = approach(y0, y1, self.shift_k + 1, t - t_shift)
            alpha = 1.0 if age < self.cols else ghost(15, t - t_shift)
            pop = approach(1.35, 1.0, 2.0, t - h.t)  # 点いた瞬間に少し大きく
            if alpha > 0:
                paste(canvas, self._tiles[h.kind], *self.stage.px(x, y), scale=pop, alpha=alpha)


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
