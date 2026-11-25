"""SF2（声のサウンドフォント。虹.のレ淫棒など）を Python で 1 音ずつ鳴らす。

    sf = Sf2(r"C:/_own/SoundFont/Rainbow_SoundFont_最新ver/Rainbow_SoundFont.sf2")
    y = sf.note(72, 1, 69, 0.3)          # バンク 72・音色 1（NYN「ないです」）で A4 を 0.3 秒 → モノラルの波形（44.1 kHz）
    sf.keys(128, 32)                     # ドラムキットの鍵盤ごとの標本名

- 音MADで知られた声の楽器（UDK・NYN「ないです」・RRM「こんなもの」・便乗ベース・野獣の咆哮など）がそのまま使える。
  自分で母音を探して WORLD で作り直すより、元の波形のままで、聞き覚えのある音になる（okashiya1、2026-11-21）。
- 標本は元の波形を再生の速さで高さを変えるだけ（作り直さない）。ゾーンの鍵盤範囲・ループ・音量の包絡を読む。
- SF2 は他の方の配布物。git に入れない。場所は呼ぶ側で渡す。
"""
import logging

import numpy as np
from scipy.signal import butter, sosfilt

FS = 44100


def _gens(bag):
    out = {}
    for k, v in bag.gens.items():
        a = v.amount if hasattr(v, "amount") else v
        if isinstance(a, int) and k not in (43, 44) and a > 32767:
            a -= 65536
        out[k] = a
    return out


def _tc(v, default):
    return 2.0 ** ((v if v is not None else default) / 1200.0)


class Sf2:
    def __init__(self, path):
        from sf2utils.sf2parse import Sf2File
        logging.disable(logging.WARNING)      # 標本のループ位置の警告が数百行出るので止めたままにする
        self._f = open(path, "rb")
        self._sf = Sf2File(self._f)
        self.presets = {(p.bank, p.preset): p for p in self._sf.presets if hasattr(p, "bank")}
        self._z = {}

    def zones(self, bank, prog):
        if (bank, prog) in self._z:
            return self._z[(bank, prog)]
        p = self.presets[(bank, prog)]
        pglob, zs = {}, []
        for pb in p.bags:
            pg = _gens(pb)
            if pb.instrument is None:
                pglob = pg
                continue
            pg = {**pglob, **pg}
            iglob = {}
            for ib in pb.instrument.bags:
                ig = _gens(ib)
                if ib.sample is None:
                    iglob = ig
                    continue
                g = {**iglob, **ig}
                for k in (48, 51, 52, 34, 36, 38, 17):
                    if k in pg:
                        g[k] = g.get(k, 0) + pg[k]
                kr = ib.key_range or (0, 127)
                pkr = pb.key_range or (0, 127)
                kr = (max(kr[0], pkr[0]), min(kr[1], pkr[1]))
                if kr[0] > kr[1]:
                    continue
                sm = ib.sample
                x = np.frombuffer(sm.raw_sample_data, "<i2").astype(np.float32) / 32768.0
                zs.append((kr, sm, x, g))
        self._z[(bank, prog)] = zs
        return zs

    def keys(self, bank, prog):
        """鍵盤 → 標本名（ドラムキットの中身を見る用）。"""
        out = {}
        for kr, sm, _, _ in self.zones(bank, prog):
            for k in range(kr[0], kr[1] + 1):
                out.setdefault(k, sm.name)
        return out

    def note(self, bank, prog, m, dur, vel=1.0, max_tail=1.2, vib=None, scoop=None):
        """vib=(深さセント, 遅れ秒): 伸ばす音の途中から揺らす（速さは音色の設定、無ければ 5 Hz）。
        scoop=(半音, 秒): 頭をその半音だけずらして入り、その秒で狙いの高さへ滑る（負で下から）。"""
        zs = self.zones(bank, prog)
        hits = [z for z in zs if z[0][0] <= m <= z[0][1]]
        if not hits:
            hits = [min(zs, key=lambda z: min(abs(m - z[0][0]), abs(m - z[0][1])))]
        out = None
        for kr, sm, x, g in hits:
            root = g.get(58, sm.original_pitch if sm.original_pitch <= 127 else 60)
            tune = g.get(51, 0) * 100 + g.get(52, 0) + sm.pitch_correction
            ratio = 2.0 ** (((m - root) * g.get(56, 100) / 100.0 + tune / 100.0) / 12.0) * sm.sample_rate / FS
            loop = g.get(54, 0) in (1, 3) and sm.end_loop - sm.start_loop > 8
            a, h, d = _tc(g.get(34), -12000), _tc(g.get(35), -12000), _tc(g.get(36), -12000)
            sus = 10.0 ** (-max(0, g.get(37, 0)) / 200.0)
            r = min(_tc(g.get(38), -12000), max_tail)
            total = dur + r if loop else min((len(x) - 1) / ratio / FS, dur + r)
            n = max(1, int(total * FS))
            if vib or scoop:
                tt = np.arange(n) / FS
                cents = np.zeros(n)
                if vib and loop:
                    rate = 8.176 * 2.0 ** (g.get(24, -851) / 1200.0)
                    ramp = np.clip((tt - vib[1]) / 0.25, 0, 1)
                    cents += vib[0] * ramp * np.sin(2 * np.pi * rate * (tt - vib[1]))
                if scoop:
                    cents += scoop[0] * 100 * np.clip(1 - tt / scoop[1], 0, 1) ** 2
                pos = np.concatenate([[0.0], np.cumsum(ratio * 2.0 ** (cents[:-1] / 1200.0))])
            else:
                pos = np.arange(n) * ratio
            if loop:
                ls, le = sm.start_loop, sm.end_loop
                over = pos >= le
                pos[over] = ls + np.mod(pos[over] - ls, le - ls)
            pos = np.clip(pos, 0, len(x) - 2)
            y = np.interp(pos, np.arange(len(x)), x)
            t = np.arange(n) / FS
            env = np.where(t < a, t / max(a, 1e-4), np.where(t < a + h, 1.0, sus + (1.0 - sus) * np.exp(-(t - a - h) / max(d / 5.0, 1e-4))))
            ri = int(dur * FS)
            if ri < n:
                env[ri:] = env[ri] * np.exp(-(t[ri:] - dur) / max(r / 5.0, 1e-3))
            f = min(n, int(0.01 * FS))
            env[n - f:] *= np.linspace(1, 0, f)
            fc = g.get(8)
            if fc is not None and fc < 13500:
                y = sosfilt(butter(2, min(8.176 * 2.0 ** (fc / 1200.0), FS * .45), "low", fs=FS, output="sos"), y)
            y = y * env * 10.0 ** (-(g.get(48, 0) / 10.0 * 0.4) / 20.0) * (vel ** 1.5)
            if out is None:
                out = y
            else:
                k = max(len(out), len(y))
                out = np.pad(out, (0, k - len(out))) + np.pad(y, (0, k - len(y)))
        return out
