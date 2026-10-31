"""クッキー☆ 歌詞文字PV の動画（使い捨て）。notes-dande3.md・notes-inmu-cookie-staging.md の引き出し 1・2・4。

単色の地に台詞の単語を、鳴る16分ちょうどに太いゴシックで打ち込む（0.13秒で縮みながら出る）。強い語は大きく、ひらがな2字までの語は小さく。
UDK と RU は文字の色で分ける。出方は台詞ごとに入れ替える（横から滑る・落ちる・1字ずつ・帯で拭う・グリッチ・回る・縦書き）。
行のあいだ少しずつ寄り、去り際にまとめて縮む。サビは拍で脈打ち、サビ2は波打つ。B は帯の中を台詞が流れる。短い台詞（サビの「ランランルー」など）は残りの拍で同じ文字を縁取りだけで画面に敷き詰める。
区間の頭で地の色を斜めにぬり替え、隅に漢字1字の札。括弧のト書きは4か所だけ。
python -I dande3_video.py <outdir> [確認用の秒 ...]   FPS=15 で確認用（video_15fps.mp4）
"""
import json
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 960, 720
FPS = int(os.environ.get("FPS", "30"))
PACK = (paths.MATERIAL / "クッキー☆/正規化済み汎用クッキー☆静画素材パック")
# 字の役割: 台詞はコーポレート・ロゴ、サビは Noto Sans JP の Black、止め・ト書き・札はクラフト明朝、流れる帯は美咲ゴシック
FONTS = {"logo": str(paths.USER_FONTS / "Corporate-Logo-Bold-ver3.otf"), "black": "C:/Windows/Fonts/NotoSansJP-VF.ttf",
         "mincho": str(paths.USER_FONTS / "craftmincho.otf"), "pixel": str(paths.USER_FONTS / "misaki_gothic.ttf")}
od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
HEADT = info["head"]
SIX = 15 / info["bpm"]
BEAT = 4 * SIX
BARS = 16 * SIX
SECS = [(s["name"], s["from"] - 1, s["to"]) for s in info["sections"]]
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(od / "song.wav")],
                           capture_output=True, text=True).stdout)
NF = int(dur * FPS)
CODE = {"RU姉貴": "RU", "UDK姉貴": "UDK"}

# 区間ごとの (地, UDK の字と縁, RU の字と縁, 敷き詰めの色)
PAL = {
    "intro": ((54, 190, 236), ((255, 255, 255), (20, 30, 60)), ((20, 30, 60), (255, 255, 255)), (255, 255, 255)),
    "A": ((54, 190, 236), ((255, 255, 255), (20, 30, 60)), ((20, 30, 60), (255, 255, 255)), (255, 255, 255)),
    "hook": ((250, 212, 40), ((228, 48, 60), (255, 255, 255)), ((25, 25, 25), (255, 255, 255)), (255, 255, 255)),
    "B": ((60, 196, 140), ((255, 255, 255), (20, 60, 45)), ((20, 50, 40), (255, 255, 255)), (255, 255, 255)),
    "brk": ((12, 12, 14), ((255, 255, 255), (0, 0, 0)), ((235, 60, 70), (0, 0, 0)), (90, 90, 90)),
    "hook2": ((232, 65, 60), ((255, 255, 255), (60, 10, 10)), ((255, 228, 60), (60, 10, 10)), (255, 200, 190)),
    "outro": ((246, 244, 240), ((25, 25, 25), (255, 255, 255)), ((25, 25, 25), (255, 255, 255)), (200, 200, 200)),
}
FUDA = {"A": "壱", "hook": "弐", "B": "参", "brk": "止", "hook2": "伍"}
TOGAKI = {"デュフフフフ": "（意味深）", "怖いよーホモ怖いよ": "（迫真）", "嘘、ってオイ！": "（大嘘）", "泣くとMADになりますから": "（震え声）"}
SMALL_KANA = set("ぁぃぅぇぉっゃゅょー")


def t_of(step):
    return HEADT + step * SIX


def sec_of_bar(bar):
    for s, a, b in SECS:
        if a <= bar < b:
            return s, a
    return ("outro", SECS[-1][1]) if bar >= 0 else ("intro", 0)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return 1 - (1 - x) ** 3


@lru_cache(maxsize=256)
def font(sz, face="logo"):
    f = ImageFont.truetype(FONTS[face], sz)
    if face == "black":
        f.set_variation_by_axes([900])
    return f


@lru_cache(maxsize=8192)
def word_img(w, sz, fill, stroke, outline_only=False, face="logo"):
    """字の箱は送り幅×（アセント＋ディセント）でそろえる。1字ずつ並べても高さと間隔が崩れない"""
    f = font(sz, face)
    sw = max(2, sz // 14)
    asc, desc = f.getmetrics()
    im = Image.new("RGBA", (int(f.getlength(w)) + 2 * sw + 2, asc + desc + 2 * sw), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if outline_only:
        d.text((sw, sw), w, font=f, fill=(0, 0, 0, 0), stroke_width=sw, stroke_fill=fill + (255,))
    else:
        d.text((sw, sw), w, font=f, fill=fill + (255,), stroke_width=sw, stroke_fill=stroke + (255,))
    return im


def is_small(w):
    core = w.rstrip("、。！？…☆～")
    return len(core) <= 2 and all("\u3041" <= ch <= "\u309f" for ch in core) and len(core) > 0


def layout(words, face="logo"):
    """単語を行へ詰める。強い語 1.0・小さい語 0.55 の大きさで、画面の 88%×58% に入る最大の大きさを探す"""
    rel = [0.55 if is_small(w) else 1.0 for w in words]
    for S in range(250, 40, -6):
        rows, cur, cw = [], [], 0.0
        for w, r in zip(words, rel):
            sz = max(18, int(S * r))
            ww = font(sz, face).getlength(w) + sz * 0.08
            if cur and cw + ww > W * 0.88:
                rows.append(cur)
                cur, cw = [], 0.0
            cur.append((w, sz, ww))
            cw += ww
        rows.append(cur)
        heights = [max(sz for _, sz, _ in r) * 1.12 for r in rows]
        if sum(heights) <= H * 0.58 and len(rows) <= 4 and max(sum(ww for _, _, ww in r) for r in rows) <= W * 0.9:
            break
    out, y = [], H * 0.40 - sum(heights) / 2
    for r, hh in zip(rows, heights):
        x = (W - sum(ww for _, _, ww in r)) / 2
        for w, sz, ww in r:
            out.append((w, sz, x, y + (hh - sz * 1.12)))  # 下ぞろえ
            x += ww
        y += hh
    return out


def layout_tate(words):
    """縦書き: 右から左へ柱を立てる。1柱 4 字まで、「ー」は縦棒に"""
    chars = [(wi, ch.replace("ー", "｜").replace("～", "｜")) for wi, w in enumerate(words) for ch in w]
    ncol = (len(chars) + 3) // 4
    per = (len(chars) + ncol - 1) // ncol
    sz = int(min(170, H * 0.66 / per / 1.02, W * 0.8 / ncol / 1.1))
    out = []
    for k, (wi, ch) in enumerate(chars):
        col, row = divmod(k, per)
        x = W / 2 + (ncol - 1) * sz * 0.55 - col * sz * 1.1 - sz / 2
        y = H * 0.40 - per * sz * 1.02 / 2 + row * sz * 1.02
        out.append((wi, ch, sz, x, y))
    return out


MODES = ["slide", "drop", "type", "wipe", "glitch", "spin"]
TAIL = set("ぁぃぅぇぉゃゅょゎァィゥェォャュョ、。！？…☆～・")


def char_times(w, ms):
    """語の各字が出る時刻。字はその字のモーラが鳴る16分で出す（小さい字・記号は前の字と一緒）"""
    base = [j for j, ch in enumerate(w) if ch not in TAIL or j == 0]
    out, cur = [], t_of(ms[0])
    for j in range(len(w)):
        if j in base:
            cur = t_of(ms[min(len(ms) - 1, base.index(j) * len(ms) // len(base))])
        out.append(cur)
    return out

# 台詞ごとの表示: 出る時刻・消える時刻・単語の配置
LINES = []
pl = info["placed"]
starts = sorted({int(round((p["bar"] - 1) * 16)) for p in pl})
for i, p in enumerate(pl):
    st = int(round((p["bar"] - 1) * 16))
    bar0 = st // 16
    sname, sa = sec_of_bar(bar0)
    sec_end = next(b for s, a, b in SECS if s == sname) * 16
    nxt = min([s for s in starts if s > st] + [sec_end])
    merged = []  # 「・」や記号だけの語と「ー」で始まる語は前の語へつなぐ
    for w in p["words"]:
        if merged and (all(ch in "・、。！？…" for ch in w["w"]) or w["w"][0] in "ーぁぃぅぇぉ"):
            merged[-1] = dict(merged[-1], w=merged[-1]["w"] + w["w"])
        else:
            merged.append(dict(w))
    for w in merged:
        w["w"] = w["w"].replace("・・・", "…")
    words = [w["w"] for w in merged]
    who = CODE[p["who"]]
    together = sum(1 for q in pl if q["bar"] == p["bar"]) > 1
    steps = [w["step"] for w in merged] + [10 ** 9]
    wms = [[m for m in p["morae"] if steps[k] <= m < steps[k + 1]] or [steps[k]] for k in range(len(merged))]
    ctimes = [char_times(w, ms) for w, ms in zip(words, wms)]
    # 出方: サビは落下と回転と横滑り、止めはグリッチ、他は台詞ごとに入れ替え。短い台詞は1つおきに縦書き
    if sname in ("hook", "hook2"):
        mode = ["drop", "spin", "drop", "slide"][i % 4]
    elif sname == "brk":
        mode = "glitch"
    elif sname in ("A", "B") and len(p["text"]) <= 9 and i % 2 == 0 and not together:
        mode = "tate"
    else:
        mode = MODES[i % len(MODES)]
    face = "black" if sname in ("hook", "hook2") else "mincho" if sname == "brk" else "logo"
    pieces = []  # (出る時刻, 文字, 大きさ, x, y, 向き)
    if mode == "tate":
        tl = layout_tate(words)
        cnt = {}
        for wi, ch, sz, x, y in tl:
            j = cnt.get(wi, 0)
            cnt[wi] = j + 1
            pieces.append((ctimes[wi][j], ch, sz, x, y, 1))
    else:
        lay = layout(words, face)
        if together:  # 2人同時は上下に分ける
            dy = -H * 0.14 if who == "UDK" else H * 0.14
            lay = [(w, int(sz * 0.8), W / 2 + (x - W / 2) * 0.8, H * 0.40 + (y - H * 0.40) * 0.8 + dy) for w, sz, x, y in lay]
        for k, (w, sz, x, y) in enumerate(lay):
            sign = 1 if k % 2 else -1
            for j, ch in enumerate(w):  # どの出方も1字ずつ、その字のモーラの時刻で
                pieces.append((ctimes[k][j], ch, sz, x + font(sz, face).getlength(w[:j]), y, sign))
    LINES.append({"t0": t_of(st), "t1": t_of(nxt), "who": who, "sec": sname, "text": p["text"], "mode": mode, "face": face,
                  "words": pieces, "len16": p["len16"], "st": st,
                  "short": len(p["text"]) <= 6 and sname in ("hook", "hook2"), "tilt": (-5 if i % 3 == 1 else 4 if i % 3 == 2 else 0)
                  if sname in ("hook", "hook2", "B") else 0})


# ── 人物 ──
def sprite(path, h):
    im = Image.open(path).convert("RGBA")
    bb = im.getchannel("A").point(lambda v: 255 if v > 32 else 0).getbbox()
    im = im.crop(bb) if bb else im
    return im.resize((max(1, int(im.width * h / im.height)), h), Image.LANCZOS)


def faces(code, n, seed):
    fs = sorted((PACK / "face" / code).glob("*.png"))
    rng = np.random.default_rng(seed)
    return [sprite(fs[i], int(H * 0.44)) for i in rng.choice(len(fs), size=min(n, len(fs)), replace=False)]


FACES = {"RU": faces("RU", 4, 3), "UDK": faces("UDK", 4, 4)}


def shadow(im, col):
    a = im.getchannel("A")
    s = Image.new("RGBA", im.size, col + (255,))
    s.putalpha(a)
    return s


def paste(canvas, im, cx, cy, scale=1.0, rot=0.0, alpha=1.0):
    if scale != 1.0:
        im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BILINEAR)
    if rot:
        im = im.rotate(rot, resample=Image.BILINEAR, expand=True)
    if alpha < 1.0:
        im = im.copy()
        im.putalpha(im.getchannel("A").point(lambda v: int(v * alpha)))
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))


def tint(im, col, a=0.75):
    s_ = Image.new("RGBA", im.size, col + (255,))
    s_.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    return s_


def draw_piece(layer, im, cx, cy, age, mode, sign, zoom, alpha, dark, seed):
    """1語（または1字）を出方に合わせて描く。age は出てからの秒"""
    sc, rot = zoom, 0.0
    if mode in ("pop", "type", "tate"):
        sc *= 1 + 0.45 * (1 - ease(age / 0.13))
    elif mode == "slide":
        cx += sign * (1 - ease(age / 0.16)) * 200
        alpha *= ease(age / 0.08)
    elif mode == "drop":  # 上から落ちて少し行き過ぎて戻る
        q = min(age / 0.22, 1.0) - 1
        cy -= (1 - (1 + 2.7 * q ** 3 + 1.7 * q ** 2)) * 170
    elif mode == "spin":
        rot = sign * (1 - ease(age / 0.2)) * 90
        sc *= 0.4 + 0.6 * ease(age / 0.2)
    elif mode == "wipe" and age < 0.22:  # 帯が通ったあとに文字が残る
        p_ = age / 0.22
        w_ = im.width * sc
        x0 = cx - w_ / 2
        shown = max(0.0, (p_ - 0.35) / 0.65)
        if shown > 0:
            part = im.crop((0, 0, max(1, int(im.width * shown)), im.height))
            paste(layer, part, x0 + part.width * sc / 2, cy, sc, alpha=alpha)
        a_, b_ = shown, min(1.0, p_ / 0.45)
        if b_ > a_:
            ImageDraw.Draw(layer).rectangle((x0 + a_ * w_, cy - im.height * sc * 0.42, x0 + b_ * w_, cy + im.height * sc * 0.42),
                                            fill=dark + (255,))
        return
    elif mode == "glitch" and age < 0.22:  # 色ずれと横の裂け目
        k = 1 - age / 0.22
        rng = np.random.default_rng(seed % (2 ** 32) + int(age * 60))
        a = np.array(im)
        h4 = max(1, a.shape[0] // 4)
        for band in range(4):
            a[band * h4:(band + 1) * h4] = np.roll(a[band * h4:(band + 1) * h4], int(rng.integers(-30, 31) * k), 1)
        g = Image.fromarray(a)
        d = 14 * k
        paste(layer, tint(g, (255, 40, 200)), cx + d, cy, sc, alpha=alpha)
        paste(layer, tint(g, (40, 230, 255)), cx - d, cy, sc, alpha=alpha)
        paste(layer, g, cx, cy, sc, alpha=alpha * (0.5 + 0.5 * (rng.random() > 0.3 * k)))
        return
    paste(layer, im, cx, cy, sc, rot, alpha)


def marquee(canvas, t, ln, band_col, text_col):
    """帯の中を台詞が右から左へ流れる（B 区間）"""
    y0 = int(H * 0.84)
    ImageDraw.Draw(canvas).rectangle((0, y0, W, y0 + 84), fill=band_col + (255,))
    im = word_img(ln["text"].replace("・・・", "…") + "　", 56, text_col, band_col, face="pixel")
    x = -((t - ln["t0"]) * 240) % im.width - im.width
    while x < W:
        canvas.alpha_composite(im, (int(x), y0 + (84 - im.height) // 2))
        x += im.width


def last_line_of(t, who):
    ls = [ln for ln in LINES if ln["who"] == who and ln["t0"] <= t]
    return ls[-1] if ls else None


def draw_people(canvas, t, sname, bar, beats, col_shadow):
    if sname == "brk" and bar >= 52.0 and bar < 53.0:
        pass
    for who, side in (("RU", -1), ("UDK", 1)):
        ln = last_line_of(t, who)
        cur = [x for x in LINES if x["t0"] <= t < x["t1"]]
        speaking = any(x["who"] == who for x in cur)
        age = t - ln["t0"] if ln else 9.0
        hop = np.exp(-age / 0.12) if age >= 0 else 0.0
        if sname == "intro":  # 前奏は2人が左右から入る
            k = ease((bar - (1 if who == "RU" else 3)) / 0.5)
            if k <= 0:
                continue
        else:
            k = 1.0
        scale = (1.0 if speaking else 0.82) * (1 + 0.15 * hop)
        bob = 6 * np.exp(-(beats % 1) * 6) if sname in ("A", "hook", "B", "hook2") else 0
        face = FACES[who][int(max(0, bar) // 8) % len(FACES[who])]
        cx = W / 2 + side * (W * 0.36 + (1 - k) * W * 0.5)
        cy = H - face.height * scale * 0.48 + 10 - 40 * hop + bob
        rot = -side * 4 * np.sin(beats * np.pi / 2) if sname in ("hook", "hook2") else 0
        paste(canvas, shadow(face, col_shadow), cx + 12, cy + 12, scale, rot)
        paste(canvas, face, cx, cy, scale, rot)


def bg_at(t, bar):
    sname, sa = sec_of_bar(int(np.floor(bar)))
    col = PAL[sname][0]
    # 区間の頭で斜めにぬり替える（0.25秒）
    k = (t - (HEADT + sa * BARS)) / 0.25
    img = Image.new("RGBA", (W, H), col + (255,))
    if 0 <= k < 1 and sa > 0:
        prev = PAL[sec_of_bar(sa - 1)[0]][0]
        a = np.array(img)
        yy, xx = np.mgrid[0:H, 0:W]
        a[(xx + 0.6 * yy) > ease(k) * (W + 0.6 * H)] = prev + (255,)
        img = Image.fromarray(a)
    return img, sname, sa


def shade(c):
    return tuple(int(v * 0.72) for v in c)


def frame_at(f):
    t = f / FPS
    bar = (t - HEADT) / BARS
    beats = (t - HEADT) / BEAT
    canvas, sname, sa = bg_at(t, bar)
    bgc, cu, cr, wall = PAL[sname]
    # 敷き詰め（短い台詞）: 台詞が鳴り終わったあと、拍ごとに1行ずつ縁取りの文字が増える
    for ln in LINES:
        if not (ln["t0"] <= t < ln["t1"]) or not ln["short"]:
            continue
        rows = int(max(0, (t - (ln["t0"] + ln["len16"] * SIX)) / BEAT) + 1) if t >= ln["t0"] + ln["len16"] * SIX else 0
        im = word_img(ln["text"], 64, wall, wall, True, ln["face"])
        for r in range(min(rows, 7)):
            y = 40 + r * 92
            off = (r % 2) * im.width / 2 - ((t - ln["t0"]) * 60 * (1 if r % 2 else -1)) % im.width
            x = -im.width + off
            while x < W:
                canvas.alpha_composite(im, (int(x), int(y)))
                x += im.width + 24
    # 前奏の題: 「ランランルー☆」を声の動機に合わせて1字ずつ
    if sname == "intro":
        title = list("ランランルー") + ["☆"]
        steps = [0, 2, 4, 6, 8, 10, 12]
        shown = [ch for ch, s_ in zip(title, steps) if t >= t_of(s_)]
        x = W / 2 - 3.6 * 110
        for i, ch in enumerate(shown):
            age = t - t_of(steps[i])
            im = word_img(ch, 150, (255, 255, 255), (20, 30, 60), face="black")
            paste(canvas, im, x + i * 120 + 60, H * 0.36, 1 + 0.6 * (1 - ease(age / 0.13)))
        if bar >= 2:
            sub = word_img("UDK × RU", 46, (20, 30, 60), (255, 255, 255))
            paste(canvas, sub, W / 2, H * 0.56, alpha=ease((bar - 2) / 0.3))
    if sname == "B":
        cur = next((ln for ln in LINES if ln["t0"] <= t < ln["t1"]), None)
        if cur:
            marquee(canvas, t, cur, shade(bgc), (255, 255, 255))
    draw_people(canvas, t, sname, bar, beats, shade(bgc))
    # 台詞の文字
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pulse = 0.06 * np.exp(-(beats % 1) * 6) if sname in ("hook", "hook2") else 0.0
    for ln in LINES:
        if not (ln["t0"] - 0.01 <= t < ln["t1"]):
            continue
        fill, stroke = cu if ln["who"] == "UDK" else cr
        span = max(ln["t1"] - ln["t0"], 1e-3)
        zoom = 1 + 0.05 * (t - ln["t0"]) / span  # 行のあいだ少しずつ寄る
        ex = ease((t - (ln["t1"] - 0.12)) / 0.12) if span > 0.6 else 0.0  # 去り際にまとめて縮む
        zoom *= (1 - 0.45 * ex) * (1 + pulse)
        for tw, w, sz, x, y, sign in ln["words"]:  # w は1字
            if t < tw:
                continue
            im = word_img(w, sz, fill, stroke, face=ln["face"])
            cx = W / 2 + (x + im.width / 2 - W / 2) * zoom
            cy = H * 0.4 + (y + im.height / 2 - H * 0.4) * zoom
            if sname == "hook2":  # 波
                cy += 10 * np.sin(beats * np.pi + cx / 90)
            draw_piece(layer, im, cx, cy, t - tw, ln["mode"], sign, zoom, 1 - ex, stroke, hash((ln["st"], w, x)))
        tg = TOGAKI.get(ln["text"])
        if tg and t >= ln["t0"] + (ln["len16"] + 4) * SIX:
            age = t - (ln["t0"] + (ln["len16"] + 4) * SIX)
            im = word_img(tg, 60, fill, stroke, False, "mincho")
            last_y = max(y + sz for _, _, sz, _, y, _ in ln["words"])
            paste(layer, im, W / 2, min(last_y + 50, H * 0.78), 1 + 0.3 * (1 - ease(age / 0.13)))
    tilt = next((ln["tilt"] for ln in LINES if ln["t0"] <= t < ln["t1"]), 0)
    if tilt:
        layer = layer.rotate(tilt, resample=Image.BILINEAR, center=(W / 2, H * 0.4))
    canvas.alpha_composite(layer)
    # 漢字1字の札
    if sname in FUDA:
        age = t - (HEADT + sa * BARS)
        badge = Image.new("RGBA", (104, 104), (0, 0, 0, 0))
        d = ImageDraw.Draw(badge)
        d.rounded_rectangle((0, 0, 103, 103), 14, fill=cu[0] + (255,), outline=cu[1] + (255,), width=4)
        d.text((52, 54), FUDA[sname], font=font(70, "mincho"), fill=cu[1] + (255,), anchor="mm")
        paste(canvas, badge, 70, 70, 1 + 0.8 * (1 - ease(age / 0.15)), rot=-8 * (1 - ease(age / 0.3)))
    if sname == "outro" and bar >= 74:
        im = word_img("おわり", 64, (25, 25, 25), (255, 255, 255), face="mincho")
        paste(canvas, im, W / 2, H * 0.62, alpha=ease((bar - 74) / 0.3))
    out = np.array(canvas.convert("RGB"))
    # 揺れ: サビはキックで、止めの最後の小節は16分で
    amp = 0.0
    if sname in ("hook", "hook2"):
        amp = 9 * np.exp(-(beats % 1) * BEAT / 0.05)
    if sname == "brk" and bar >= SECS[[s for s, _, _ in SECS].index("brk")][2] - 1:
        amp = 6 * np.exp(-((beats * 4) % 1) * SIX / 0.04)
    if amp > 0.5:
        rng = np.random.default_rng(int(beats * 4))
        out = np.roll(out, (int(rng.uniform(-amp, amp)), int(rng.uniform(-amp, amp))), (0, 1))
    # 最後のサビは4小節ごとに1拍だけ色を反転
    if sname == "hook2" and (bar - sa) % 4 < 0.25:
        out = 255 - out
    if bar < 0.1:
        out = (out * max(0.0, (bar + 0.05) / 0.15)).astype(np.uint8)
    end_bar = SECS[-1][2]
    if bar > end_bar - 0.5:
        out = (out * max(0.0, 1 - (bar - end_bar + 0.5) / 0.5)).astype(np.uint8)
    return out


def main():
    only = [float(v) for v in sys.argv[2:]]
    if only:
        for sec in only:
            Image.fromarray(frame_at(int(sec * FPS))).save(od / f"frame_{sec:06.1f}.png")
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
