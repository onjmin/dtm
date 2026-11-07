"""海鬼月の全身ドット絵（ずんだもん・めたん・イタコ、幅24・高さ約52、約2.8頭身）。左半分を書いて左右に写す。
差分: eyes='open'|'closed'、mouth='close'|'open'
python -I scratch/kaikizuki/sprites.py  → sprites/<名前>_<目>_<口>.png と確認用の sheet.png
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sprites'); os.makedirs(OUT, exist_ok=True)
W2 = 12  # 左半分の幅
EYE_Y, EYE_X, MOUTH_Y = 15, 6, 20

def hexc(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)

COMMON = {'c': 'ffc6c4', 's': 'ffe6d2', 'S': 'f0b49c', 'b': 'ff9aa4', 'w': 'ffffff', 'W': 'cdd5e8', 'm': '7a2232', 'M': 'e0606e',
          'E': 'ffffff', 'k': '2b1f33', '~': 'd08e80'}

# 目は上まつ毛だけ濃く、横と下は縁取らない。虹彩は上が濃く下が明るい（四方を縁取ると箱に見えた。
# 所有者「目の描き方を変えて」と手本のめたん 11-03）。めたんは手本どおり外に白目の横長のジト目。ずんだもん・イタコは 2 枚目の手本どおり、まつ毛が外の端で下へ回り込み、その内に白い光、虹彩は濃い行と明るい行の 2 行
# 表情の差分（所有者「表情をもっと凝って」11-03）: open 普通／blink まばたき／closed 眠り（︶）／happy にっこり（∩）／half 半目／squeeze ><（驚き・痛い）
EYES = {
    'open':   ["kkkk", "kEYY", ".YYY", ".yyy", "...."],  # 下へ 1px のばし、もとの薄い行は濃い虹彩に同化、薄い色は足した行へ（所有者 11-03）
    'blink':  ["....", "....", "kkkk", "....", "...."],
    'closed': ["....", "....", "k..k", ".kk.", "...."],
    'happy':  ["....", ".kk.", "k..k", "....", "...."],
    'half':   ["....", "kkkk", "kEYY", ".yyy", "...."],
    'squeeze': ["....", "kk..", "..kk", "kk..", "...."],  # >< 驚き・痛い。白目に点の黒目は「怖い」（所有者 11-03）
}
EYES_OF = {'metan': {'open': ["kkkk", "EYYk", "EYYY", ".iyy", "...."], 'half': ["....", "kkkk", "EYYk", ".iyy", "...."]}}
# 口（MOUTH_Y から下へ。cx は顔の真ん中の右側の列）: close ω の笑み／open 小さく開く／sing 大きく開く／flat 一文字／wah 小さな o
MOUTHS = {
    'close': [(-2, 0, 'm'), (1, 0, 'm'), (-1, 1, 'm'), (0, 1, 'm')],
    'open':  [(-2, 0, 'm'), (1, 0, 'm'), (-1, 0, 'm'), (0, 0, 'm'), (-1, 1, 'M'), (0, 1, 'M')],
    'sing':  [(-2, 0, 'm'), (-1, 0, 'm'), (0, 0, 'm'), (1, 0, 'm'), (-1, 1, 'M'), (0, 1, 'M')],
    'flat':  [(-1, 0, 'm'), (0, 0, 'm')],
    'wah':   [(-1, 0, 'm'), (0, 0, 'm'), (-1, 1, 'm'), (0, 1, 'm')],
}
# 服の細い濃い線（しわ）は描かない（所有者「しわはあまり描かない方がいい」11-03）。1px の線になっている濃い色を地の色へ戻す
SOFTEN = {'zundamon': {'Q': 'O'}, 'metan': {'W': 'w', 'r': 'R'}, 'itako': {'n': 'N'}}
# ずんだもんの背伸び（合唱で歌っている子だけ。所有者 11-03）: 脚を 2 行のばし、靴はつま先立ち
# 髪の塗り（所有者「髪の質感をもっと丁寧に」11-03）。地・影・明かり・濃い影の 4 色で、
# 縦の毛筋、頭の丸みに沿って途切れる天使の輪、前髪の下と顔の横の影を描く。(地, 影, 明, 濃, 塗り始めの行)
HAIR = {'zundamon': ('G', 'g', 'l', 'd', 6), 'metan': ('R', 'r', 'h', 'd', 4), 'itako': ('H', 'j', 'J', 'd', 5)}

def shade_hair(grid, name):
    B, S, L, D, top = HAIR[name]
    hair = {B, S, L}
    for y in range(top, len(grid)):
        for x in range(W2):
            if grid[y][x] not in hair: continue
            c = B
            left = grid[y][x - 1] if x else '.'
            col_top = next(yy for yy in range(top, y + 1) if grid[yy][x] in hair)
            dy = y - col_top
            if left in 'o.': c = S                                   # 外側の縁は影
            elif 10 <= y <= 14 and x % 3 == 2: c = S                  # 前髪の毛筋
            elif y >= 15 and x % 3 == 0: c = S                        # 横の髪の毛筋
            ring = top + 3 + (1 if x < 4 else 0)
            if y == ring and x % 3 != 2 and x >= 2: c = L             # 天使の輪（毛筋で途切れる）
            elif y == ring + 1 and x % 3 == 0 and x >= 3: c = L
            if dy == 0 and x >= 3 and x % 2 == 0: c = L if y > top else c
            below = grid[y + 1][x] if y + 1 < len(grid) else '.'
            if below == 's' and y <= 15: c = D                        # 前髪の下の影
            right = grid[y][x + 1] if x + 1 < W2 else '.'
            if right == 's' and y >= 15: c = D                        # 顔の横の影
            if y >= 24 and dy > 0 and x % 3 == 1: c = D               # 長い髪の先の濃い毛筋
            grid[y][x] = c

# 頭の上の角を大きな半径で丸める（所有者「頭はもう少し丸っこく」11-03）。(輪郭の一番上の行, 角の半径)
HEAD = {'zundamon': (6, 9), 'metan': (3, 9), 'itako': (5, 9)}

def round_head(grid, name):
    """左上の角（頭頂〜前髪）で、半径 R の円の外にある髪と輪郭を消し、新しい縁に輪郭線を引き直す"""
    top, R = HEAD[name]; hair = set(HAIR[name][:3]) | {'o'}
    for y in range(top, top + R):
        for x in range(R):
            if (R - x - 0.5) ** 2 + (top + R - y - 0.5) ** 2 > R * R and grid[y][x] in hair: grid[y][x] = '.'
    for y in range(top, 15):
        for x in range(W2):
            if grid[y][x] in hair and grid[y][x] != 'o':
                up = grid[y - 1][x] if y > top else '.'
                if (x == 0 or grid[y][x - 1] == '.') or (up == '.' and y > top): grid[y][x] = 'o'

TIPTOE_SHOES = [".......olllo", ".......oBBBo", ".......oBlBo", "........oBo.", "........oo.."]

# 前髪を目の上まで下ろし、見える顔は目・頬・口・あごの影の 9 行だけ（横長で短い顔）
ZUNDA = [
    "............",  # 0〜5 は枝豆の耳（ZUNDA_EARS を丸めた後に重ねる）
    "............",
    "............",
    "............",
    "............",
    "............",
    "....oooooooo",
    "..ooGGGGGGGG",
    ".oGGlGGGGGGG",
    ".oGlGGGGGGGG",
    "oGGGGGGGGGGG",  # 10
    "oGGGGGGGGGGG",
    "oGGgGGsGGGGG",  # 12 前髪の下の縁は真ん中がふくらんだ M 字。両目の上の額は外の縁が急な細い縦長の弧、
    "oGGgGGsGGGGG",  #    真ん中の束は広く丸くふくらんで目の間へ下りる（とがらせない。束は左右 1px ずつ太く。所有者 11-03）
    "oGGgGGssGGGG",
    "oGGGGgsssGGG",  # 15 目
    "oGGGGgssssGG",
    "oGGGGgssssss",
    "oGGGGgssssss",
    ".oGGGgssssss",
    ".oGGgsssssss",  # 20 頬・口
    "..oGooosssss",
    "........oSss",
    "......oowwPP",
    ".....owWwwpP",
    "...owwWWwwwp",
    "...owwWwOwww",  # 胴は 1px ずつ細く（所有者「胴はもう少し細い」11-03）。腕は 2px 幅（1px は細すぎた。所有者 11-05）
    "...ossWwOQww",
    "...ossoPOOOO",
    "...ossoOOQQQ",  # 胸当てのポケットは線でなく塗りの四角（線はしわに見える）
    "...osSoOOQQQ",
    "...ossoOOQQQ",
    "....oooOOOOO",  # 腰は細くくびれ、下の半ズボンでまたふくらむ（所有者「腰はもう少し細い」11-03）
    "........oooo",  # 腰の切りかえは輪郭と同じ濃い線（所有者 11-03）。Q だと 1px の線を地に戻す処理で消え、d は薄くて見えない
    "......oOOOOO",
    "......oOOOOO",
    "......oPPPoo",
    ".......ossso",
    ".......ossso",
    ".......ossso",
    ".......olllo",
    "......oBBBBo",
    "......oBBlBo",
    ".....oBQBBBo",
    ".....opppPo.",  # 靴底はピンク
]
ZPAL = {'d': '3c7a22', 'i': 'ffe08a', 'o': '2c4a1c', 'G': '8fdc4a', 'l': 'd6f7a0', 'g': '5ea92f', 'y': 'f2b33a', 'Y': 'b8671a', 'P': 'ff8fc0',
        'O': '6aa63a', 'Q': '4a7c26', 'B': '58a32f', 'p': 'd86a9e', 'V': '7ccf3f', 'v': '4e9a2a', 'n': 'e2f07a'}
# 枝豆の耳は頭の上の左右から外へ、少し上向きに横へ張り出すさや。豆が 2 つ透ける（3D モデル。真ん中の芽 2 本は取り違え 11-03）
# めたんのカチューシャ: 白と薄紫が交互のフリルの帯が頭の上を弧に渡り、横はドリルの付け根まで下りる。
# 上に左右ひとつずつ、中がピンクのリボン。縁は灰紫 g（所有者の手本のドット絵。白い四角だけでは違った 11-03）
METAN_HEAD = [  # 白いフリルの扇が頭頂を弧に覆い、根もとの細い濃い線が帯。上の左右にハートの飾り（所有者の手本・立ち絵 11-03）
    ".gg.gg......",
    "gLLgLLg.....",
    "gLuLLLg.....",
    ".gLLLgg.g.g.",
    "..gLg.LgLgLg",
    "...gLgWLWLWL",
    "..ggWLLWLWLW",
    "..LLLWgggggg",
    ".gWWgg......",
    "gLLg........",
    "LWg.........",
    "Wg..........",
    "L...........",
    "g...........",
]
# 前髪の束の頭（6 行目から）。毛先の丸いふくらみが扇の根もとの線にかぶさる
METAN_BANG_TOP = [
    "....ooo.ooo.",
    "...ouuuouuuo",
]
ZUNDA_EARS = ["............"] * 6  # 耳は ZUNDA_PODS（全体の絵の座標）で描く

METAN = [
    "............",
    "............",
    "............",
    "...ooooooooo",
    "..oovuuuuuvq",  # 3〜7 はカチューシャの扇の下
    ".oRvuxxuuuvq",
    ".oRvuxuuuvvq",
    "oRRouuouuuoq",
    "oRRRvuuuuuvq",  # 8 前髪は太い 2 本の束（所有者の手本 3D・立ち絵 11-03）。分け目から外へ下がって額を覆う。
    "oRRvuxxuuvqq",  # 9 束は筒: 縁 v・明 u・つや x・明 u・額側の濃い q。毛筋の縞を入れる処理に塗られない色で描く
    "oRRvuxuvqSss",  # 10 おでこは台形: 上 6px→8→8→10→10。1 行に 2px ずつ広げると三角に見えた（所有者 11-03）。束のすぐ下の額に影 S
    "oRvuxuvqSsss",
    "oRvuxuvqSqqs",  # 12 短い眉。まつ毛を 2px にして 1 行上へのびたので、くっつかないよう 1 行あける（所有者 11-05）
    "oRvuxvqSssss",
    "oRRvuvqSssss",  # 14 束は額の外で終わる。先を外へ巻くとしっぽに見え、顔の横に垂らすともみあげに見えた（所有者 11-03）
    "oRRoRrssssss",  # 15 目（顔は 12×7。kiriko に合わせて小さく。所有者 11-03）
    "oRRRRrssssss",
    "oRRRRrssssss",
    "oRRRRrssssss",
    "oRRRRrssssss",
    "oRRRrsssssss",  # 20 頬・口
    "oRrRooosssss",
    "oRrRo...oSss",
    "orRro.oowTTT",
    "oRrRowwwwTtT",
    ".oRrowWwwwwT",
    ".orRwWWwwDDD",
    "..owWwWwwDwD",
    "..oWwWowwDDw",
    "..oFFFowwDwD",
    "..osssoWwDDw",
    "...oowwwwDDD",
    "...owWwwwDDD",
    "..oFwFwFwFwF",
    ".oFWFWFWFWFW",
    "..oooooooooo",
    ".......ossso",
    ".......ossso",
    ".......ossso",
    ".......owwwo",
    ".......oWwwo",
    "......oLLLLo",
    "......okLLLo",
    ".....oLLLLLo",
    ".....oooooo.",
]
# 髪は地 R・明 u・濃 q の 3 色と輪郭だけ。中間・つや・別の影の色を足すとこてこてで髪の質感から離れた（所有者 11-03）。
# v x h r d は描き分けの記号として残し、色は 3 色のどれかにそろえる
MPAL = {'g': '8a6a8a', 'q': 'c8286e', 'u': 'f8b0d8', 'v': 'e86aa8', 'x': 'f8b0d8', 'd': 'c8286e', 'i': 'c4f0ff', 'o': '5a2440', 'R': 'e86aa8', 'r': 'c8286e', 'h': 'f8b0d8', 'y': '62c6f0', 'Y': '2a78b4', 'F': 'f6eff8',
        'D': '2a2030', 'L': 'f4f0f6', 'W': 'd6c6dc', 'T': 'd8283c', 't': '8c1626'}

# イタコは公式 3D モデル（zunko.jp の itako_pmx_1、model_view.py で正面・横を描き出した）に合わせた（所有者「他のキャラも 3D モデルで」11-03）:
# 頭の上の左右に大きな狐耳（中はピンク）／真っ直ぐな姫カットで真ん中の上に小さな切れ込み／横髪のあごの高さに赤い玉（3D のテクスチャはピンクだが公式の立ち絵は赤。所有者 11-04）／
# 袖は白で裾ほど青緑、襟は紫（白い着物。所有者 11-04）、帯は黒っぽく黄緑とピンクの紐、真ん中に紺の前身ごろ／目は赤紫。赤は後ろの髪留めだけなので前からは描かない
ITAKO = [
    "............",  # 0-4 狐耳は ITAKO_EARS を頭を丸めた後に重ねる
    "............",
    "............",
    "............",
    "............",
    ".oHHHHHHHHHH",
    "oHHJJHHHHHHH",
    "oHJHHHHHHHHH",
    "oHHHHHHHHHoH",  # 8 分け目の上に小さな濃い髪飾り
    "oHHHHHHHHHos",  # 9 前髪は真ん中で分かれ、細い額が目の上まで縦にのぞく（3D モデル。上の小さな切れ込みだけでは違った 11-03）
    "oHHHHHHHHHds",  # 10 分け目の縁は濃い影 d
    "oHHHHHHHHHds",
    "oHHHHHHHHHds",
    "oHHHHHHHHHds",
    "oHHHHHHHHHds",  # 14 前髪は真っ直ぐ目の上まで。分け目は上から下まで同じ細さ
    "oHHHHjssssss",  # 15 目
    "oHHHHjssssss",
    "oHHHHjssssss",
    "oHHHHjssssss",
    "oHHHHjssssss",
    "oGGGjsssssss",  # 20 頬・口。横髪に赤い玉
    "oGGgooosssss",
    "oHggo.ooPPss",  # 22 紫の襟は 2px の帯で V 字に合わさり、内に白い襦袢がのぞく（太いと「太すぎる」。所有者 11-04）
    "oHjHoAAAPPJs",
    "oHjHoAAAAPPJ",
    "oHjoAAAAAAPP",
    "oHjoAWAAoDDD",  # 26 振袖は体と輪郭で分け、裾ほど青緑で下まで垂らす（着物が分かりにくかった 11-04）
    "ojHoAWWAoXKX",
    "oHjoAWJAoDDD",
    "ojHoUUUUoAAT",
    "oHjoUUUJoAAA",
    ".oHoVVVVoANA",
    "..oVVVVooNnN",
    "...oooooonJn",
    ".......oAAAN",  # 34 着物の裾は脚の付け根を隠すまで下ろし、青緑の段で終える（所有者「スカート部分も描いて関節を隠す」11-05）
    "......oUUUAN",
    "......oooooo",
    ".......owwwo",
    ".......owwwo",
    "......oZZZZo",
    "......oTZZZo",
    ".....oZZZZZo",
    ".....oooooo.",
]
ITAKO_EARS = [  # 狐耳は根もとの広い三角で外へ傾ける（細長いとうさぎに見えた）
    "............",
    ".oo.........",
    ".oKoo.......",
    ".oKKHoo.....",
    ".oKKKHHo....",
    "..oKKKHHo...",
    "..oKKHHHHo..",
    "...ooHHHo...",
]
IPAL = {'d': '7a80a0', 'i': 'f4b0dc', 'o': '3a3352', 'H': 'e8ebf4', 'j': 'a8aec8', 'J': 'ffffff', 'y': 'd04aa0', 'Y': '8c1c6c', 'K': 'f4a8c0',
        'A': 'f8f6fb', 'W': 'dcdce8', 'N': '2a3060', 'n': '161a34', 'U': '9fd8e0', 'V': '3a8ca0', 'D': '2a2838', 'X': 'b8d860',
        'T': 'e8394a', 'Z': '2a2030', 'P': '5a3e9e', 'p': '36246a', 'G': 'd8283c', 'g': '8c1626'}

CHARS = {'zundamon': (ZUNDA, ZPAL), 'metan': (METAN, MPAL), 'itako': (ITAKO, IPAL)}

# めたんのドリル（左側。右は写す）。斜めの縞でねじれを見せる
# ずんだもんの頭（3D モデル・公式フィギュアで確かめた。所有者「側頭部・前髪・触角の再現度が低い」11-05）。全体の絵（左右の
# 余白込み）の座標で重ねる。'.' はそのまま、'_' は消す
# - 耳（枝豆のさや）は頭の幅より外まで長く、ほぼ水平で先が少し上がる（斜めに立てるとうさぎの耳に見えた）。豆 3 つが並ぶ。左を描いて右へ写す
ZUNDA_PODS_Y = 2  # さやは頭のてっぺんに載る。根もとは髪の上の縁に重なる
ZUNDA_PODS = [
    "..oooooo.......",
    ".oVnnVnnVoooo..",
    "oVnnVnnVnnVVVo.",
    "oVVVVVVVnnVVVo.",
    ".ovvvVVVVVVvvo.",
    "..oooovvvvvvo..",
    "......oooooo...",
]
# - 前髪：真ん中の束は少し向かって右へ寄って目の間へ下り、先は細くなる。横の束は目の上まで。束の間に額が小さくのぞく
# - 横髪：外の輪郭は元のまま（外へはねると側頭部が突き出た）。内の房は顔に沿って下り、先があごへ向けて内へとがる
ZUNDA_FACE_Y = 11
ZUNDA_FACE = [
    "....oglGGlGGdGlGGGgdGlGlgo....",
    "...oggGGlGGgsGGlGGGgdGGlggo...",
    "...oggGGGgGgsgGGlGgsgGGGggo...",
    ".............sgGG.............",
    ".............sgGg.............",
    ".............ssgs.............",
    "..............................",
    "..............................",
    "..............................",
    "....oggGd............dGggo....",
    ".....ogGo............oGgo.....",
    ".......o..............o.......",
]

DRILL_Y = 10
DRILL = [  # 巻きのひと巻きごとに外側へふくらみ、外の縁に濃い桃の三日月、内は明るい桃、巻きの境は斜めの濃い線（所有者「凝れ」11-03）
    "..ooo.",
    ".oquuo",
    "oqRuhR",
    "oqRuuR",
    "oqqRuR",
    ".oqqRR",
    "..ooqR",
    ".oqRuR",
    "oqRuhR",
    "oqqRuR",
    ".oqqRR",
    "..ooqR",
    ".oqRuR",
    "oqRuhR",
    "oqqRuo",
    ".oqqRo",
    "..ooqo",
    "..oquo",
    "..oqRo",
    "..oqo.",
    "...o..",
]

# 腕の差分（所有者「腕を動かしたり、ちょっとしたダンスを」「補完 frame はコマごとに手書きで」「腕の長さを計算」「上げるのは水平まで」11-05）。
# 左右べつに down（下ろす）→ low（30°）→ mid（60°）→ side（水平）と、side の手首を起こした wave。上げ下げは 1 コマで飛ばさず順に通す。
# 腕の長さは下ろした腕と同じ（肩から手まで、ずんだもん 7px・めたん 5px）。イタコの振袖は腕から下へ垂れて追う。
# コマは手で描いた点の表（絵の左側の座標。'.' はそのまま、'_' は透明）。まず下ろした腕を消し（ERASE）、上に重ねる
ARM_ERASE = {
    'zundamon': (26, 6, ["__o", "__o", "___", "___", "___", "___", ".__"]),
    'metan': (27, 6, ["__o", "___", "___", "___"]),
    'itako': (26, 6, [".____", ".____", ".____", ".____", ".____", ".____", "_____", "_____"]),
}
ARM_PATCH = {
    'zundamon': {  # 上げた腕は 2px 幅の肌、肩に 2×2 の白い袖（1px 幅だと小枝に見えた。所有者 11-05）
        'low':  (26, 3, ["...oww", "..osso", "..osso", ".osso.", ".osso.", "osso..", ".oo..."]),
        # 肩の支点は胴の中。袖は胴の肩の上まで重ね、水平の腕の上の縁は肩の高さ（所有者「肩の支点は体に埋め込む」11-05）
        'mid':  (23, 1, ["......oo..", "....oowwww", "..oossWWWW", ".ossssoo..", "osssoo....", "osso......", ".oo......."]),
        'side': (23, 1, [".ooooooo", "osssswwwww", "ossssWWWWW", ".ooooooo"]),
        # 胸に手を当てる（所有者「胸に手を当てて歌う」11-05）。belly は下ろした手から胸までの途中のコマ。ひじは腰の高さ
        'belly': (27, 6, ["oss.", "oss.", "osssso", "osssso", ".oooo."]),
        'chest': (26, 6, [".....oo.", "oss.osso", "osssssso", "oSsssso.", ".oooooo."]),
        'wave': (22, 1, [".oo", "ossooooo", "osssswwwww", ".oossWWWWW", "...ooooo"]),
    },
    'metan': {  # 袖は 3px の太さのまま腕の向きへ傾け、袖口 F・手 3px も向きにそろえる。肩から手まで 5px（下ろした腕と同じ。
                # 斜めの手が 6px 先にあって長すぎ、袖が細い帯になって不自然だった。所有者 11-05）
        'low':  (26, 3, ["...owW", "..owwW", ".owwWo", "oFFFo", "ossso", ".ooo"]),
        'mid':  (23, 2, ["....ooo", "...owwww", "..owWwWW", ".oFWWWo", "osFWo", "oso", ".o"]),
        'side': (23, 2, [".oooooo", "osFwwwww", "osFwWWwW", "osFWWWWW", ".oooooo"]),
        'belly': (27, 5, ["owWw", "owWWFo", ".oWFsso", "..ooooo"]),
        'chest': (26, 5, ["owWWooo.", "owWWwFso", "owWWwFsso", ".oooooooo"]),
        'wave': (22, 2, [".o", "osoooooo", "osFwwwww", "osFwWWwW", ".oFWWWWW", "..ooooo"]),
    },
    'itako': {  # 振袖は上げた腕から 5px 幅で長く垂れ、裾は青緑の 2 段（短いと振袖に見えなかった。所有者 11-05）
        'low':  (26, 3, ["...oAWAA", "..oAWWAo", "..oAWjAo", "..oAWAAo", "..oUUUUo", "..oUUUdo", ".ooVVVVo", ".oVVVVo.", "..ooooo."]),
        'mid':  (24, 1, ["...oooA.", "..oAAAAA", ".oAAWAAo", "osAWWAAo", "osAWAAAo", ".oAWAAo.", ".oAWAAo.", ".oUUUUo.", ".oVVVVo.", "..oooo.."]),
        'side': (23, 0, [".oooooo.", "osAAAAAA", "osAAWAAA", ".oAAWAAo", ".oAWWAAo", ".oAWAAAo", ".oAWAAAo", ".oUUUUUo", ".oVVVVVo", "..ooooo."]),
        'belly': (26, 6, ["oAWAAo", "oAWAAAo", "oAWAAAsso", ".oUUUUoo", ".oVVVVo", "..oooo."]),
        'chest': (26, 6, ["oAWAAAAoo.", "oAWAAAAsso", "oAWAAAAoo.", ".oUUUUo...", ".oVVVVo...", "..oooo...."]),
        'wave': (22, 0, [".o......", "osoooooo", "osAAAAAA", ".oAAWAAA", ".oAAWAAo", ".oAWWAAo", ".oAWAAAo", ".oAWAAAo", ".oUUUUUo", ".oVVVVVo", "..ooooo."]),
    },
}
POSES = ['down', 'low', 'mid', 'side', 'wave', 'belly', 'chest']
ARM_SETS = [(a, b) for a in POSES for b in POSES]
PAD = 3  # 腕を水平に出す分、全員の左右に足す（めたんはドリルの分もこの中）

def arm_tag(arms):
    return '' if arms == ('down', 'down') else '_a' + ''.join(p[0] for p in arms)

def put_arm(full, name, side, pose):
    wf = len(full[0])
    for y0, x0, rows in (ARM_ERASE[name], ARM_PATCH[name][pose]):
        for dy, r in enumerate(rows):
            for dx, c in enumerate(r):
                if c == '.': continue
                x = x0 + dx if side == 'L' else wf - 1 - (x0 + dx)
                full[y0 + dy][x] = '.' if c == '_' else c

def build(name, eyes='open', mouth='close', tiptoe=False, bend=False, arms=('down', 'down')):
    rows, pal = CHARS[name]
    for i, r in enumerate(rows):
        if len(r) != W2: raise SystemExit(f'{name} 行{i} の長さ {len(r)}: {r!r}')
    rows = list(rows)
    leg = ".......ossso" if ".......ossso" in rows else ".......owwwo"  # イタコは裾が長く、脚は靴下から見える
    if tiptoe:
        k = max(i for i, r in enumerate(rows) if r == leg)
        rows = rows[:k + 1] + [leg] * 2 + TIPTOE_SHOES
    if bend:  # 拍で膝を曲げる差分。脚を 1 行縮め、足は地面に着けたまま体だけ 1px 沈む（全体を 1px 浮かせると微移動に見えた。所有者 11-03）
        k = rows.index(leg); rows = rows[:k] + rows[k + 1:]
    grid = [list(r) for r in rows]
    round_head(grid, name)
    if name in ('itako', 'zundamon', 'metan'):  # 耳・カチューシャは丸めた頭の角に重ねる（先に描くと丸めで根もとが消えて浮いた）
        for y, r in enumerate({'itako': ITAKO_EARS, 'zundamon': ZUNDA_EARS, 'metan': METAN_HEAD}[name]):
            for x, c in enumerate(r):
                if c != '.': grid[y][x] = c
    if name == 'metan':  # 前髪の上部はカチューシャの下の線の上に載せる（帯の線を前髪の手前に描くと平たい。所有者 11-03）
        for y, r in enumerate(METAN_BANG_TOP):
            for x, c in enumerate(r):
                if c != '.': grid[6 + y][x] = c
    shade_hair(grid, name)
    for y in (21,):  # あごの下の影はしわに見えるので肌にする
        grid[y] = ['s' if c == 'S' else c for c in grid[y]]
    grid[22] = ['~' if c in 'sS' else c for c in grid[22]]  # 首はあごの陰。肌の影 S より濃く（所有者 11-03・11-05）
    fr = EYES_OF.get(name, {}).get(eyes, EYES[eyes])
    # まつ毛と閉じ目の横線は高さ 2px。下の行は外へ 1px のばして目尻とそろえ、上の行は外の角を 1px 削った形（所有者 11-05。2px のばすと広すぎた）。目は 1 行上から描く
    i = next((k for k, r in enumerate(fr) if r == 'kkkk'), None)
    fr = fr[:i] + ['kkkk'] + fr[i:] if i is not None else ['....'] + fr
    for y, r in enumerate(fr):
        for j, c in enumerate(r):
            if c != '.': grid[EYE_Y - 1 + y][EYE_X + j] = c
    if i is not None:
        grid[EYE_Y + i][EYE_X - 1] = 'k'
        for y in range(i + 2, len(fr)):  # 目尻も 1px 外へ。下へ回り込むまつ毛は外へ出して跡を白目に、めたんの白目は外へ広げる（所有者 11-05）
            c = fr[y][0]
            if c in 'kE':
                grid[EYE_Y - 1 + y][EYE_X - 1] = c; grid[EYE_Y - 1 + y][EYE_X] = 'E'
    pad = PAD
    full = [list('.' * pad + r + r[::-1] + '.' * pad) for r in (''.join(g) for g in grid)]
    if name == 'zundamon':
        W_ = len(full[0])
        for y, r in enumerate(ZUNDA_PODS):
            for x, c in enumerate(r):
                if c != '.': full[ZUNDA_PODS_Y + y][x] = full[ZUNDA_PODS_Y + y][W_ - 1 - x] = c
        for y, r in enumerate(ZUNDA_FACE):
            for x, c in enumerate(r):
                if c != '.': full[ZUNDA_FACE_Y + y][x] = '.' if c == '_' else c
    if name == 'metan':
        for y, r in enumerate(DRILL):
            for x, c in enumerate(r):
                if c != '.':
                    full[DRILL_Y + y][x] = c
                    full[DRILL_Y + y][len(full[0]) - 1 - x] = c
    soft = SOFTEN.get(name, {})
    src = [r[:] for r in full]
    for y in range(26, len(full)):
        for x in range(len(full[0])):
            c = src[y][x]
            if c in soft:
                same = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and 0 <= y + dy < len(src)
                           and 0 <= x + dx < len(src[0]) and src[y + dy][x + dx] == c)
                if same <= 2: full[y][x] = soft[c]
    for side, pose in zip('LR', arms):
        if pose != 'down': put_arm(full, name, side, pose)
    cx = len(full[0]) // 2
    # 頬の赤みはひとかたまり（2 点だけだと閉じ目のとき途切れてしわに見えた。所有者 11-03）
    # 広さは目の下の半円ほど（所有者 11-05）: 上 2 行は 5px で外の端は薄く、下 1 行も頬の色で 3px（あごの輪郭を避けて 1px 内へ）
    for bx, by, c in ([(x, -1, 'c' if x in (-1, 3) else 'b') for x in range(-1, 4)] + [(x, 0, 'c' if x in (-1, 3) else 'b') for x in range(-1, 4)]
                      + [(x, 1, 'b') for x in range(1, 4)]):
        x_ = EYE_X + pad + bx; y_ = MOUTH_Y + by
        if full[y_][x_] == 's':
            full[y_][x_] = full[y_][len(full[0]) - 1 - x_] = c
    for dx, dy, c in MOUTHS[mouth]:
        full[MOUTH_Y + dy][cx + dx] = c
    p = {**COMMON, **pal}
    im = Image.new('RGBA', (len(full[0]), len(full)), (0, 0, 0, 0))
    for y, r in enumerate(full):
        for x, c in enumerate(r):
            if c != '.': im.putpixel((x, y), hexc(p[c]))
    if name == 'zundamon':  # しっぽは動きに合わせて跳ねるよう video.py の sprite() で体の後ろに描く。ここは描く余白だけ
        big = Image.new('RGBA', (im.width + 4, im.height), (0, 0, 0, 0)); big.alpha_composite(im, (0, 0)); im = big
    if name == 'itako':  # 半透明ピンクの天女の羽衣。肩の後ろから両脇へふくらんで垂れ、前は袖の上を横切る（所有者 11-04）
        big = Image.new('RGBA', (im.width + 6, im.height), (0, 0, 0, 0))
        back = ImageDraw.Draw(big)
        path = [(x + PAD, y) for x, y in [(8, 23), (5, 24), (3, 26), (2, 29), (1, 32), (1, 35), (2, 38), (3, 40)]]
        for pts in (path, [(big.width - 1 - x, y) for x, y in path]):
            back.line(pts, fill=(248, 168, 212, 150), width=2)
        # 腰から下へ垂れる黒い帯。先は赤（所有者 11-04）
        tail = [(x + PAD, y) for x, y in [(8, 30), (6, 34), (5, 38), (5, 41)]]
        for pts in (tail, [(big.width - 1 - x, y) for x, y in tail]):
            back.line(pts, fill=(36, 30, 44, 255), width=2)
            x, y = pts[-1]
            back.rectangle((min(x, x + (1 if x < big.width // 2 else -1)), y - 2, max(x, x + (1 if x < big.width // 2 else -1)), y + 1), fill=(216, 40, 60, 255))
        big.alpha_composite(im, (3, 0))
        front = Image.new('RGBA', big.size, (0, 0, 0, 0)); fd = ImageDraw.Draw(front)
        for x0, x1 in ((3 + PAD, 11 + PAD), (big.width - 12 - PAD, big.width - 4 - PAD)):
            fd.line((x0, 30, x1, 29), fill=(248, 168, 212, 130), width=2)
        big.alpha_composite(front); im = big
    return im

def make():
    for f in os.listdir(OUT):
        if f.endswith('.png'): os.remove(os.path.join(OUT, f))
    sp = {}
    for k in CHARS:
        for e in EYES:
            for m in MOUTHS:
                for tt in ((False, True) if k == 'zundamon' else (False,)):
                    im = build(k, e, m, tt); sp[(k, e, m, tt)] = im
                    im.save(os.path.join(OUT, f'{k}_{e}_{m}' + ('_tiptoe' if tt else '') + '.png'))
                for ar in ARM_SETS:
                    if ar != ('down', 'down'): build(k, e, m, arms=ar).save(os.path.join(OUT, f'{k}_{e}_{m}{arm_tag(ar)}.png'))
                    build(k, e, m, bend=True, arms=ar).save(os.path.join(OUT, f'{k}_{e}_{m}{arm_tag(ar)}_bend.png'))
    keys = [(k, e, m, False) for k in CHARS for e, m in (('open', 'close'), ('open', 'sing'), ('happy', 'open'), ('half', 'flat'), ('squeeze', 'wah'), ('closed', 'flat'))]
    keys += [('zundamon', 'open', 'sing', True)]
    W_ = sum(sp[k].width for k in keys[:6]) + 8 * 6; H_ = (max(sp[k].height for k in keys) + 6) * 4
    sheet = Image.new('RGBA', (W_, H_), (16, 16, 20, 255))
    for i, k in enumerate(keys):
        row, col = divmod(i, 6)
        sheet.alpha_composite(sp[k], (4 + col * (sp[k].width + 8 if False else 34), 3 + row * (H_ // 4) + (H_ // 4 - 6 - sp[k].height)))
    sheet.resize((sheet.width * 5, sheet.height * 5), Image.NEAREST).save(os.path.join(OUT, 'sheet.png'))
    return sp

if __name__ == '__main__':
    make()
