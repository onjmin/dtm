"""MMD モデル（pmx）を正面・横・後ろから正射影で描き出す（ドット絵の形の確認用。Blender なしで）。
.venv-speech/Scripts/python -I scripts/otomad/tools/model_view.py <pmx のパス> <出力 png> [幅=900]
上段に全身の正面・右横・後ろ、下段に頭の正面・右横を並べる。光は左上から、明るさで立体を見る"""
import os, struct, sys
import numpy as np
from PIL import Image


class R:
    def __init__(self, b): self.b, self.p = b, 0
    def take(self, n): v = self.b[self.p:self.p + n]; self.p += n; return v
    def i(self, fmt): v = struct.unpack_from('<' + fmt, self.b, self.p); self.p += struct.calcsize('<' + fmt); return v
    def text(self, enc):
        n, = self.i('i'); return self.take(n).decode('utf-16-le' if enc == 0 else 'utf-8', 'replace')
    def idx(self, size, signed=True):
        return self.i({1: 'b', 2: 'h', 4: 'i'}[size] if signed else {1: 'B', 2: 'H', 4: 'i'}[size])[0]


def load_pmx(path):
    r = R(open(path, 'rb').read())
    assert r.take(4) == b'PMX ', 'pmx ではない'
    r.i('f'); n, = r.i('B'); g = r.i('%dB' % n)
    enc, addv, vsz, tsz, msz, bsz = g[:6]
    for _ in range(4): r.text(enc)
    nv, = r.i('i')
    pos = np.zeros((nv, 3), np.float32); nor = np.zeros((nv, 3), np.float32); uv = np.zeros((nv, 2), np.float32)
    for k in range(nv):
        v = r.i('8f'); pos[k], nor[k], uv[k] = v[0:3], v[3:6], v[6:8]
        r.take(16 * addv)
        w, = r.i('B')
        if w == 0: r.take(bsz)
        elif w == 1: r.take(2 * bsz + 4)
        elif w in (2, 4): r.take(4 * bsz + 16)
        elif w == 3: r.take(2 * bsz + 4 + 36)
        r.take(4)
    ni, = r.i('i')
    fmt = {1: 'B', 2: 'H', 4: 'i'}[vsz]
    ind = np.array(r.i('%d%s' % (ni, fmt)), np.int64).reshape(-1, 3)
    nt, = r.i('i'); tex = [r.text(enc).replace('\\', '/') for _ in range(nt)]
    nm, = r.i('i'); mats = []
    for _ in range(nm):
        name = r.text(enc); r.text(enc)
        diff = r.i('4f'); r.i('3f'); r.i('f'); r.i('3f'); r.i('B'); r.i('4f'); r.i('f')
        ti = r.idx(tsz); r.idx(tsz); r.i('B'); ref, = r.i('B')
        if ref == 0: r.idx(tsz)
        else: r.i('B')
        r.text(enc); cnt, = r.i('i')
        mats.append((name, diff, ti, cnt // 3))
    return pos, nor, uv, ind, tex, mats


def render(pos, nor, uv, ind, texs, mats, view, W, Hh, box):
    """view: (右へ進む軸, 上へ進む軸, 奥へ進む軸)。box: 映す範囲 (x0, x1, y0, y1)（モデル座標）"""
    ax, ay, az = view
    X, Y, Z = pos @ ax, pos @ ay, pos @ az
    x0, x1, y0, y1 = box
    sx = (X - x0) / (x1 - x0) * W; sy = (y1 - Y) / (y1 - y0) * Hh
    img = np.zeros((Hh, W, 3), np.float32) + 0.16; zb = np.full((Hh, W), np.inf, np.float32)
    light = np.array([-0.5, 0.6, -0.6]); light /= np.linalg.norm(light)
    lam = np.clip(nor @ light, 0, 1) * 0.55 + 0.45
    f0 = 0
    for name, diff, ti, cnt in mats:
        T = texs[ti] if 0 <= ti < len(texs) else None
        for a, b, c in ind[f0:f0 + cnt]:
            xs = np.array([sx[a], sx[b], sx[c]]); ys = np.array([sy[a], sy[b], sy[c]])
            bx0, bx1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, W - 1)
            by0, by1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, Hh - 1)
            if bx0 > bx1 or by0 > by1: continue
            den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
            if abs(den) < 1e-9: continue
            gx, gy = np.meshgrid(np.arange(bx0, bx1 + 1) + 0.5, np.arange(by0, by1 + 1) + 0.5)
            w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / den
            w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / den
            w2 = 1 - w0 - w1
            m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not m.any(): continue
            z = w0 * Z[a] + w1 * Z[b] + w2 * Z[c]
            sub = zb[by0:by1 + 1, bx0:bx1 + 1]
            m &= z < sub
            if not m.any(): continue
            col = np.broadcast_to(np.array(diff[:3], np.float32), m.shape + (3,)).copy()
            if T is not None:
                u = w0 * uv[a, 0] + w1 * uv[b, 0] + w2 * uv[c, 0]; v = w0 * uv[a, 1] + w1 * uv[b, 1] + w2 * uv[c, 1]
                th, tw = T.shape[:2]
                tx = (np.mod(u, 1) * tw).astype(int).clip(0, tw - 1); ty = (np.mod(v, 1) * th).astype(int).clip(0, th - 1)
                tc = T[ty, tx]
                m &= tc[..., 3] > 0.5
                col = tc[..., :3]
            l = w0 * lam[a] + w1 * lam[b] + w2 * lam[c]
            sub[m] = z[m]
            img[by0:by1 + 1, bx0:bx1 + 1][m] = (col * l[..., None])[m]
        f0 += cnt
    return Image.fromarray((img.clip(0, 1) * 255).astype(np.uint8))


def main():
    path, out = sys.argv[1], sys.argv[2]; W = int(sys.argv[3]) if len(sys.argv) > 3 else 900
    pos, nor, uv, ind, tex, mats = load_pmx(path)
    base = os.path.dirname(path); texs = []
    for t in tex:
        p = os.path.join(base, t)
        try: texs.append(np.asarray(Image.open(p).convert('RGBA'), np.float32) / 255)
        except OSError: texs.append(None)
    print('頂点', len(pos), '面', len(ind), '材質', [m[0] for m in mats])
    lo, hi = pos.min(0), pos.max(0); print('範囲', lo.round(2), hi.round(2))
    # MMD は正面が -Z 向き。正面から見ると画面の右がモデルの左手（-X）
    front = (np.array([-1, 0, 0]), np.array([0, 1, 0]), np.array([0, 0, 1]))
    side = (np.array([0, 0, 1]), np.array([0, 1, 0]), np.array([1, 0, 0]))
    back = (np.array([1, 0, 0]), np.array([0, 1, 0]), np.array([0, 0, -1]))
    hgt = hi[1] - lo[1]; wid = max(hi[0] - lo[0], hi[2] - lo[2]) * 1.05; cw = W // 3
    full = (-wid / 2, wid / 2, lo[1] - 0.02 * hgt, hi[1] + 0.02 * hgt)
    zc = (lo[2] + hi[2]) / 2
    fullz = (zc - wid / 2, zc + wid / 2, full[2], full[3])
    ch = int(cw * (full[3] - full[2]) / (full[1] - full[0]))
    imgs = [render(pos, nor, uv, ind, texs, mats, front, cw, ch, full), render(pos, nor, uv, ind, texs, mats, side, cw, ch, fullz),
            render(pos, nor, uv, ind, texs, mats, back, cw, ch, (-wid / 2, wid / 2, full[2], full[3]))]
    # 頭: 首より上（上から 22%）
    hy0 = hi[1] - 0.24 * hgt; hw = 0.26 * hgt
    head = (-hw / 2, hw / 2, hy0, hi[1] + 0.01 * hgt); hz = (zc - hw / 2, zc + hw / 2, head[2], head[3])
    hs = W // 2; hh = int(hs * (head[3] - head[2]) / (head[1] - head[0]))
    hims = [render(pos, nor, uv, ind, texs, mats, front, hs, hh, head), render(pos, nor, uv, ind, texs, mats, side, hs, hh, hz)]
    sheet = Image.new('RGB', (W, ch + hh), (40, 40, 40))
    for k, im in enumerate(imgs): sheet.paste(im, (k * cw, 0))
    for k, im in enumerate(hims): sheet.paste(im, (k * hs, ch))
    sheet.save(out); print('wrote', out)


if __name__ == '__main__':
    main()
