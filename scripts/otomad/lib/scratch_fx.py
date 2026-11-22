"""Scratch の文字PV（界隈曲の PV）でよく使う演出を、時刻 t の関数として描く部品。

座標は Scratch の舞台と同じ（中心が原点・上が +y・縦 360）。数値を Scratch 作品から写しやすくするため。
Scratch のコマ単位の動き（毎コマ「x += (目標 - x) / k」「v *= 5/6」「v -= 0.3」）は 30fps の閉じた式に直してあるので、
どの t から描いても同じ絵になる（コマを順に回さなくてよい）。

部品は3つの単位で使う（どれも draw(canvas, t) を持ち、spans の区間だけ出る。compose() で重ねる）。
  左   BeatColumn  拍ごとに満ちる箱の縦の盤（1拍1箱・縦8行で2小節・キックとスネアの2列・4拍ごとに外へずれて消える）
  下   BeatRow     同じ盤の横向き。enter_from=左の盤 で、区間の頭に左の位置から滑ってくる
  真ん中 LyricPV   枠のパーン・語ごとに滑り込む字・カメラ・崩れ落ち・右上の縦書きをまとめた文字PV
  ほか Subtitle（下の1行字幕）。細かく組むときは FramePop・ScatterText・VerticalLyrics を直接使う。
使い方は scripts/otomad/tools/scratch_fx_demo.py、技の説明は docs/otomad/techniques/scratch-fx.md。
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


# ---- 太鼓ごとの「白からの引き算」の箱（geo） ----
# 箱の中身を、満タンの白い四角から、その拍で鳴る太鼓ごとの形を引いて作る（手本: nicovideo sm38799922 の箱。絵は写さず、決まりだけ）。
# kind は geo_kind(flags, 1拍の秒) で作る。flags は太鼓の頭文字を並べた文字列:
#   K キック     まんなかの丸い穴（打った瞬間は大きく、1拍かけて閉じて満タンに戻る。キックだけの拍は白い四角で終わる）
#   C クラップ   4辺のまんなかから中心へ伸びる切り欠き（十字に欠ける）
#   S スネア     クラップの切り欠きを中心までつなぐ（田の字に割れる）
#   T タンバリン 外側の四角い溝（内から外へ広がる）
#   o 開いたハット（裏の8分）   中ほどの四角い溝（内側に現れ、外へ広がる）
#   h 閉じたハット（裏の8分）   内側の小さな四角い溝
#   H 閉じたハット（16分の裏）  四隅の欠け
# どの形も上下・左右・斜めの線対称で、180°回しても同じ（点対称）。太鼓には向きが無く、盤が横へずれても読み方が変わらない。
# 形は「四角い溝」と十字の系統に揃える（丸い点・ひし形は 2026-11-22 に所有者が不採用）。
# 拍が終わると最後の形のまま残り、その拍で何が鳴ったかの記録になる。
DRUM_KEY_NAMES = {'bassDrum1': 'kick', 'handClap': 'clap', 'acousticSnare': 'snare', 'tambourine': 'tamb',
                  'closedHihat': 'hat_c', 'openHihat': 'hat_o'}
FILL_ORDER = (3, 4, 2, 5, 1, 6, 0, 7)   # フィルで箱が点く行の順（まんなかから外へ）


def geo_kind(flags, beat_sec):
    """太鼓の頭文字の列（'KCSh' など）と1拍の秒から、箱の kind を作る。1拍のコマ数が形の変化の長さになる"""
    return f'geo:{flags}:{max(6, int(round(beat_sec * FPS_SCRATCH)))}'


def _geo_frames(flags, frames):
    n = BOX_IN
    yy, xx = np.mgrid[0:n, 0:n]
    ax, ay = np.abs(xx - 7.5), np.abs(yy - 7.5)
    cheb = np.maximum(ax, ay)
    groove = lambda g: ~((cheb <= g) & (cheb > g - 1))   # 四角い溝（幅1）
    out = []
    for f in range(frames + 1):
        p = f / frames
        m = np.ones((n, n), bool)
        if 'K' in flags:
            m &= np.hypot(ax, ay) > 7.2 * (1 - p) ** 1.4
        if 'C' in flags:
            L = 5.5 * min(1.0, p * 2.5)
            m &= ~(((ax < 1) & (ay > 7.5 - L)) | ((ay < 1) & (ax > 7.5 - L)))
        if 'S' in flags:
            m &= ~(((ax < 1) | (ay < 1)) & (cheb <= 3.0 * min(1.0, p * 2.5)))
        if 'T' in flags:
            m &= groove(4.5 + 2.5 * min(1.0, p * 2.0))
        if 'o' in flags and p >= 0.5:
            m &= groove(3.5 + 2.0 * min(1.0, (p - 0.5) * 2.4))
        if 'h' in flags and p >= 0.5:
            m &= groove(1.5 + 1.5 * min(1.0, (p - 0.5) * 2.4))
        if 'H' in flags and p >= 0.75:
            sz = 1 + int(min(1.0, (p - 0.75) * 6) * 1.6)
            m &= ~((ax > 7.5 - sz) & (ay > 7.5 - sz))
        out.append(m)
    return out


def read_drum_pattern(name, config_path):
    """dtm の固定パターン（src/instruments/drum-config.ts）を定義からそのまま読む → {'kick': (step, ...), 'clap': ..., ...}。
    step は1小節 192 のうちの位置。手で写すと抜ける（31LDK でタンバリンとスネアを落とした）ので、必ずここから読む"""
    import re
    src = open(config_path, encoding='utf-8').read()
    body = re.search(r'\n\t' + re.escape(name) + r': \{(.*?)\n\t\},', src, re.S).group(1)
    pat = {}
    for st, key in re.findall(r'step: (\d+), pitch: DRUM_KEYS\.(\w+)', body):
        if key in DRUM_KEY_NAMES:
            pat.setdefault(DRUM_KEY_NAMES[key], []).append(int(st))
    return {k: tuple(v) for k, v in pat.items()}


def geo_flags(pattern, beat):
    """パターン（read_drum_pattern の形）の beat 拍目（0〜3）で鳴る太鼓の頭文字の列"""
    s0 = beat * 48
    fl = ''.join(f for f, k in (('K', 'kick'), ('C', 'clap'), ('S', 'snare'), ('T', 'tamb')) if s0 in pattern.get(k, ()))
    fl += 'o' if s0 + 24 in pattern.get('hat_o', ()) else ''
    fl += 'h' if s0 + 24 in pattern.get('hat_c', ()) else ''
    fl += 'H' if s0 + 36 in pattern.get('hat_c', ()) else ''
    return fl


def geo_beats(bar_sec, n_bars, pattern_of_bar, skip_bars=()):
    """1拍ごとの Beat の列を作る。pattern_of_bar(小節番号) はその小節のパターン（鳴らない小節は None か {}）。
    中央寄りの列はその拍で鳴る太鼓ぜんぶ、外の列は裏拍の太鼓（クラップ・スネア・タンバリン）だけ。
    skip_bars の小節は空にする（add_fill でフィルにする小節）。"""
    beat = bar_sec / 4
    out = []
    for bar in range(n_bars):
        pat = None if bar in skip_bars else pattern_of_bar(bar)
        for q in range(4):
            fl = geo_flags(pat, q) if pat else ''
            back = ''.join(c for c in fl if c in 'CST')
            out.append(Beat((bar * 4 + q) * beat, geo_kind(fl, beat) if fl else None, geo_kind(back, beat) if back else None))
    return out


def _fill_frames(kind):
    """中 16×16 の白（True）のコマ列"""
    n = BOX_IN
    if kind.startswith('geo:'):
        _, flags, frames = kind.split(':')
        return _geo_frames(flags, int(frames))
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


def _in_spans(spans, t):
    """spans が None なら常に、[(始め, 終わり)] ならその中だけ True。終わりが None はずっと"""
    if spans is None:
        return True
    return any(a <= t and (b is None or t < b) for a, b in spans)


def _span_start(spans, t):
    """t を含む区間の始め（無ければ None）"""
    for a, b in spans or []:
        if a <= t and (b is None or t < b):
            return a
    return None


@dataclass
class _BeatBoardBase:
    """拍ごとに満ちる箱の盤の共通部分。beats は1拍ずつ（休みの拍も Beat(t, None, None) で入れる）。拍の通し番号 k の箱は
    行 k % rows に置かれ、列は「レーン + (今の4拍のまとまり - 置いた時のまとまり)」。2 を超えたら消える。
    spans の区間だけ描く。enter_from に別の盤を渡すと、区間の頭で箱がその盤の位置から滑ってくる（左 → 下の組み替え）。"""
    stage: Stage
    beats: list
    spans: list | None = None
    enter_from: object = None
    rows: int = 8
    group: int = 4                  # 何拍ごとに1列ずれるか
    step: float = 40.0              # 行の間隔（Scratch 単位）
    box_size: float = 37.4          # 箱の一辺（Scratch 単位。手本は 22 単位 × 大きさ 170%）
    stagger: float = 0.02           # 滑ってくるとき箱ごとに遅らせる秒
    fills: list | None = None       # フィルの区間 [(始め, 終わり, 打点の秒の列, 1拍の秒)]。add_fill で足す

    def __post_init__(self):
        self.beats = sorted(self.beats, key=lambda b: b.t)
        self._ts = np.array([b.t for b in self.beats])
        self._px = int(round(self.box_size * self.stage.s))

    def slot(self, col, row):
        raise NotImplementedError

    def _handover(self, s):
        """区間の頭 s が enter_from の区間の終わりと同じ（＝向こうから受け継ぐ）か"""
        o = self.enter_from
        return o is not None and s is not None and any(b is not None and abs(b - s) < 1e-6 for a, b in (o.spans or []))

    def _pos(self, t, col, row):
        x1, y1 = self.slot(col, row)
        s = _span_start(self.spans, t)
        if not self._handover(s):
            return x1, y1
        x0, y0 = self.enter_from.slot(col, row)
        dt = t - s - (col * self.rows + row) * self.stagger
        return approach(x0, x1, 2.0, dt), approach(y0, y1, 3.0, dt)

    def _zone_start(self, z):
        i = z * self.group
        return self._ts[i] if i < len(self._ts) else 1e9

    def add_fill(self, t0, t1, hits, beat_sec):
        """t0〜t1 を「フィル」にする（サビ前など）。枠は動かさず、頭で点いていた箱が全部消えて空の枠だけになり、
        hits の打点ごとに、まんなかの行から外へ向かって、2列いっぺんに箱が点く（1拍1箱の順送りをやめる）。
        t1 で空に戻り、ふつうの順送りへ戻る。この区間の拍は beats に入れない（geo_beats の skip_bars）。"""
        self.fills = (self.fills or []) + [(t0, t1, sorted(hits), beat_sec)]

    def _draw_fill(self, canvas, t, hits, beat_sec):
        empty = box_frames(None, self._px)[0]
        for col in (0, 1):
            for row in range(self.rows):
                paste(canvas, empty, *self.stage.px(*self.slot(col, row)), alpha=0.5)
        for n, th in enumerate(hits):
            if t < th:
                break
            fr = box_frames(geo_kind('KC' if n % 2 else 'K', beat_sec), self._px)
            i = min(len(fr) - 1, int((t - th) * FPS_SCRATCH * 2))   # 8分で形が出来上がるよう、倍の速さで進める
            for col in (0, 1):
                paste(canvas, fr[i], *self.stage.px(*self.slot(col, FILL_ORDER[n % len(FILL_ORDER)] % self.rows)))

    def draw(self, canvas, t):
        if not _in_spans(self.spans, t):
            return
        for t0, t1, hits, beat_sec in self.fills or []:
            if t0 <= t < t1:
                self._draw_fill(canvas, t, hits, beat_sec)
                return
        s = _span_start(self.spans, t)
        if self._handover(s) or s is None or blink(t, s):
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


@dataclass
class BeatColumn(_BeatBoardBase):
    """左の縦の盤。列 0 が中央寄り（x）、古い列ほど左（x + col_dx）。行は上から下へ"""
    x: float = -160.0
    top: float = 140.0              # 1行目の y
    col_dx: tuple = (0.0, -40.0, -100.0)   # 3本目は隠し列

    def slot(self, col, row):
        return self.x + self.col_dx[min(col, 2)], self.top - self.step * row


@dataclass
class BeatRow(_BeatBoardBase):
    """下の横の盤。列 0 が上（y）、古い列ほど下（y + col_dy）。行は左から右へ"""
    x0: float = -140.0              # 1行目の x
    y: float = -100.0
    col_dy: tuple = (0.0, -40.0, -80.0)

    def slot(self, col, row):
        return self.x0 + self.step * row, self.y + self.col_dy[min(col, 2)]


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
    """字を置いた瞬間に1方向へ滑らせて止める。カメラで層ごと回す・寄る。clip_to の枠で切り抜く。
    fall_at（時刻か時刻の並び）で、それまでに置いた字が崩れ落ちる。"""
    stage: Stage
    glyphs: list
    camera: object = None          # camera(t) -> (x, y, rot_deg, scale)
    clip_to: FramePop | None = None
    clears: list = field(default_factory=list)   # この時刻より前に置いた字は消す
    fall_at: object = None         # 崩れ落ちる時刻（1つか並び）。落ちている間は枠で切らない
    fall_secs: float = 2.5         # 落ち始めてから枠で切らない秒
    pivot: tuple = (0.0, 0.0)      # カメラが回る・寄る中心（Scratch 単位）
    fall_color: tuple | None = (255, 255, 255)  # 落ちる間の字の色（枠の地が消えて黒地に出るため）
    seed: int = 1
    unit_px: float = 40.0          # 大きさ 100% の字の高さ（Scratch 単位）

    def __post_init__(self):
        rng = np.random.default_rng(self.seed)
        self._fall_v = rng.uniform(0.5, 1.2, len(self.glyphs))
        fa = self.fall_at
        self._falls = sorted([fa] if isinstance(fa, (int, float)) else (fa or []))

    def _fall_of(self, g):
        """その字が落ちる時刻（置いてから最初の崩れ落ち。落ち始めて1秒以内に置いた字も落ちる）"""
        for f in self._falls:
            if g.t <= f + 1.0:
                return f
        return None

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
        falling = any(f <= t < f + self.fall_secs for f in self._falls)
        for i, g in enumerate(self.glyphs):
            if not self._visible(g, t):
                continue
            f = self._fall_of(g)
            g_fall = f is not None and t >= f
            if g_fall and t >= f + self.fall_secs:
                continue
            d = drift(g.speed, min(t, max(f, g.t)) - g.t if g_fall else t - g.t)
            th = math.radians(g.move_dir)
            x = g.x + d * math.sin(th); y = g.y + d * math.cos(th)
            if g_fall:
                y += fall(self._fall_v[i], t - max(f, g.t))
                if y < -260:
                    continue
            px, py = self.stage.px(x, y)
            col = self.fall_color if g_fall and self.fall_color else g.color
            im = glyph(g.ch, self.unit_px * self.stage.s * g.size / 100, col)
            paste(lay, im, px, py, rot=90 - g.angle)
            any_ = True
        if not any_:
            return
        if self.camera is not None:
            cx, cy, rot, sc = self.camera(t)
            if (cx, cy, rot, sc) != (0, 0, 0, 1):
                ox, oy = self.stage.px(*self.pivot)
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


# ---- 真ん中の文字PV（枠・散らし字・縦書きをまとめた部品） ----
@dataclass
class LyricPV:
    """真ん中の文字PV。spans の各区間（サビなど）で、頭に枠が回ってパーン、語ごとに字を枠の中へ滑り込ませ、
    小節ごとにカメラを振り、区間の最後の1小節で字が崩れ落ちる。右上に縦書きで歌詞を積む（vertical=False で消す）。
    words は [(始め, 終わり, 語, [各字の時刻])]。区間の外の語は使わない。枠は frame_spans の間（既定は常に）出ている。"""
    stage: Stage
    words: list
    spans: list
    bar: float                       # 1小節の秒（カメラの拍と崩れ落ちに使う）
    center: tuple = (0.0, 20.0)
    size: float = 120.0
    frame_spans: list | None = None
    fill: tuple = (215, 215, 215)
    vertical: bool = True
    camera: bool = True
    fall: bool = True
    seed: int = 7

    def __post_init__(self):
        st, bar = self.stage, self.bar
        rng = np.random.default_rng(self.seed)
        self.frame = FramePop(st, pops=[a for a, e in self.spans], size=self.size, center=self.center,
                              fill=[x for a, e in self.spans for x in ((a, self.fill), (e - bar if self.fall else e, None))])
        glyphs, vlines, clears, cam_keys, falls = [], [], [], [], []
        dirs = [0, 90, 180, -90, 45, -45, 135, -135]
        for a, e in self.spans:
            for k, b in enumerate(np.arange(a, e - bar / 2, bar)):
                cam_keys.append((b, 0, 0, (20 if k % 2 else -12) * (k % 3 != 2), 1.15 if k % 2 else 0.9))
            cam_keys.append((e - bar, 0, 0, 0, 1.0))
            if self.fall:
                falls.append(e - bar)
        cx, cy = self.center
        inner = self.size * 0.93
        for t0, t1, w, ts in self.words:
            if not _in_spans(self.spans, t0) or any(f - 0.05 <= t0 < f + bar for f in falls):
                continue
            vlines.append((t0, w))
            clears.append(t0 - 0.01)             # 語ごとに枠の中を入れ替える
            # 語の字を枠の中の格子へ。置いた所から滑って、格子の位置で止まるよう出発点を逆算する
            n = len(w); cols = min(3, n) if n <= 6 else 3 if n <= 9 else 4
            rows = -(-n // cols); cell = inner / max(cols, rows)
            for j, (ch, t) in enumerate(zip(w, ts)):
                r, c = divmod(j, cols)
                fx_ = cx + (c - (cols - 1) / 2) * cell + rng.uniform(-4, 4)
                fy = cy - (r - (rows - 1) / 2) * cell + rng.uniform(-4, 4)
                d = float(rng.choice(dirs)); sp = rng.uniform(5, 10); L = drift_total(sp)
                th = np.radians(d)
                glyphs.append(Glyph(t, ch, fx_ - L * np.sin(th), fy - L * np.cos(th), size=cell / 40 * 100 * 0.9,
                                    angle=90 + float(rng.choice([0, 0, 0, 0, 15, -15, 90])), move_dir=d, speed=sp))
        self.scatter = ScatterText(st, glyphs, camera=camera_keys(cam_keys) if self.camera else None, clip_to=self.frame,
                                   clears=clears, fall_at=falls, seed=self.seed)
        self.vert = VerticalLyrics(st, vlines, clears=[e for a, e in self.spans]) if self.vertical else None

    def draw(self, canvas, t):
        if _in_spans(self.frame_spans, t):
            self.frame.draw_back(canvas, t)
        self.scatter.draw(canvas, t)
        if _in_spans(self.frame_spans, t):
            self.frame.draw_front(canvas, t)
        if self.vert is not None:
            self.vert.draw(canvas, t)


def compose(stage, parts, t, bg=(0, 0, 0)):
    """部品を順に重ねた1コマ（RGB の配列）。parts は draw(canvas, t) を持つものの並び（先が奥）"""
    cv = stage.new(bg)
    for p in parts:
        p.draw(cv, t)
    return np.asarray(cv.convert('RGB'))
