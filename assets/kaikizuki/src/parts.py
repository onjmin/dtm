"""ずんだもんのしっぽ・マスコットの描き方（海鬼月の動画のスクリプトから抜き出したもの）"""
from PIL import Image

TAIL = ["ooo.......",
        "GGGo......",
        "oGGGo.....",
        ".ooGGo....",
        "...oGGo...",
        "...oGGGoo.",
        "..oGGGGGGo",
        ".oGGoooGGo",
        ".oGolGoGGo",
        ".oGGooGGo.",
        "..oGGGGo..",
        "...oooo..."]
TAIL_PAL = {'o': (44, 74, 28, 255), 'G': (150, 222, 120, 255), 'l': (206, 246, 190, 255)}  # 髪より明るい若草色
TAIL_XY = (22, 20)  # 絵の左上からの TAIL の置き場所（1 倍の絵で）。左上の根もとは髪の後ろ

def with_tail(im, dy=0, bend=False):
    lay = Image.new('RGBA', im.size, (0, 0, 0, 0)); px = lay.load()
    off = lambda y: int(round(dy * min(1, max(0, y - 1) / 5)))  # 茎（1〜6 行）だけたわみ、巻いた先はそろって動く
    for y, r in enumerate(TAIL):
        for x, c in enumerate(r):
            if c == '.': continue
            lo, hi = sorted((off(y), off(y - 1) if y <= 6 else off(y)))  # 茎がのびた所は前の行のずれまで埋めて切らさない
            for o in range(lo, hi + 1):
                yy = TAIL_XY[1] + y + o
                if 0 <= yy < im.height and (o == off(y) or not px[TAIL_XY[0] + x, yy][3]): px[TAIL_XY[0] + x, yy] = TAIL_PAL[c]
    lay.alpha_composite(im); return lay

MASCOT_L = [
    ".............",
    "ooo..........",
    "oYGoo........",
    "oGGGGoo......",
    ".oGYYGGo.....",
    ".ogGGGYGo....",
    "..oggGGYGo.oo",
    "...ooggGGooGG",
    ".....oogoGGGG",
    "......oGGGGGG",
    ".....oGGGGGGG",
    ".....oGGGWWWG",
    ".....ogWWWWWW",
    "....oWWWWWWWW",
    "....oWWWWEEWW",
    "....oWWWWEEWW",
    "....oWWWWEEWW",
    ".....oWKKWWWW",
    ".....owWWWWWW",
    "......oowwWWW",
    "........ooooP",
    "......oppoPPP",
    ".......ooPPPP",
    "..........oPP",
    ".........oppo",
    "........oppo.",
    "........opo..",
    "........oo...",
]
MASCOT_EXTRA = {  # (x, y): 字。前髪の房（右寄りに下がる）としっぽ（右の腰から巻き上がる）
    **{(13, 11): 'G', (14, 11): 'G', (13, 12): 'G', (14, 12): 'g', (14, 13): 'g'},
    **{(17, 22): 'o', (18, 21): 'g', (19, 20): 'g', (20, 19): 'G', (20, 18): 'G', (21, 17): 'G', (22, 17): 'G', (23, 18): 'G',
       (23, 19): 'o', (22, 19): 'o', (18, 22): 'o', (19, 21): 'o', (20, 20): 'o', (21, 19): 'o', (21, 18): 'o', (22, 16): 'o',
       (21, 16): 'o', (23, 16): 'o', (24, 17): 'o', (24, 18): 'o', (19, 19): 'o', (20, 17): 'o'},
}
MASCOT_PAL = {'o': (40, 58, 24), 'G': (150, 222, 74), 'g': (96, 168, 44), 'Y': (236, 242, 70), 'W': (255, 250, 244),
              'w': (226, 216, 214), 'E': (16, 16, 20), 'e': (255, 255, 255), 'K': (246, 168, 184), 'M': (240, 128, 150),
              'm': (180, 60, 90), 'P': (250, 232, 236), 'p': (240, 170, 186)}
_MASCOT = {}

def mascot(eyes='open', mouth='close'):
    key = (eyes, mouth)
    if key not in _MASCOT:
        rows = [list(r + r[::-1]) for r in MASCOT_L]
        for (x, y), c in MASCOT_EXTRA.items(): rows[y][x] = c
        if eyes == 'blink':
            for x in (9, 10, 15, 16): rows[14][x] = rows[15][x] = 'W'
        else:
            rows[14][10] = rows[14][15] = 'e'  # 光は内側の上
        # 口は濃い線だけ。開くと下にピンクがのぞく（ピンクで挟むと唇に見えた。所有者 11-04）
        rows[17][12] = rows[17][13] = 'm'
        if mouth in ('open', 'sing'): rows[18][12] = rows[18][13] = 'M'
        if mouth == 'sing': rows[19][12] = rows[19][13] = 'M'
        im = Image.new('RGBA', (len(rows[0]), len(rows)))
        px = im.load()
        for y, r in enumerate(rows):
            for x, c in enumerate(r):
                if c in MASCOT_PAL: px[x, y] = MASCOT_PAL[c] + (255,)
        _MASCOT[key] = im
    return _MASCOT[key]

