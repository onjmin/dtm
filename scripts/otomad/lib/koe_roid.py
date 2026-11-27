"""dtm の koe 音源（.koe）を Python で歌わせる。替え歌をロイドで発音させるとき用（docs/otomad/techniques/roid-unison.md）。

.koe は先頭 `KOE\\0`、4 バイトの長さ、JSON（sampleRate・phonemes の offset/length/pre/overlap/consonant/pitch）、16 ビットの波形。
1 音ごとに WORLD で響き（sp）と息（ap）に分け、子音（consonant まで）は元の速さ、母音を音符の長さまで行って戻る繰り返しで伸ばし、
高さは音符へ置き直す（再生速度で変えないので声質が保たれる）。音の頭は UTAU と同じく pre のぶん前へ置く。

    roid = KoeRoid("mgroid.koe")
    y = roid.sing([(秒, 長さ秒, MIDI, "か"), ...], 全体の長さ秒)

かなは 1 モーラずつ。「ー」は前の母音を高さだけ変えて伸ばす、「っ」は休み。
"""
import json
import struct

import numpy as np
import pyworld
from scipy.ndimage import uniform_filter1d
from scipy.signal import resample_poly

FS = 44100
FP = 5.0
VOWEL = {}
for v, row in (("あ", "あかがさざただなはばぱまやらわゃ"), ("い", "いきぎしじちぢにひびぴみり"), ("う", "うくぐすずつづぬふぶぷむゆるゅ"),
               ("え", "えけげせぜてでねへべぺめれぇ"), ("お", "おこごそぞとどのほぼぽもよろをょ"), ("ん", "ん")):
    for c in row:
        VOWEL[c] = v
SMALL = set("ゃゅょぁぃぅぇぉ")
SUB = {"ぁ": "あ", "ぃ": "い", "ぅ": "う", "ぇ": "え", "ぉ": "お", "ゔ": "ぶ", "ぢ": "じ", "づ": "ず"}


def moras(text):
    out = []
    for c in text:
        if c in "ゃゅょ" and out:
            out[-1] += c
        else:
            out.append(c)
    return out


def vowel_of(kana):
    return VOWEL.get(kana[-1], "あ")


def load_koe(path):
    d = open(path, "rb").read()
    assert d[:4] == b"KOE\0"
    n = struct.unpack("<I", d[4:8])[0]
    head = json.loads(d[8:8 + n])
    wav = np.frombuffer(d[8 + n:], dtype="<i2").astype(np.float64) / 32768
    return head, wav


class KoeRoid:
    def __init__(self, path, f0lo=100, f0hi=800, apk=.6):
        self.head, wav = load_koe(path)
        self.sr = self.head["sampleRate"]
        self.ph = self.head["phonemes"]
        self.wav = wav
        self.f0lo, self.f0hi, self.apk = f0lo, f0hi, apk
        self.cons_min = .7   # 短い音で子音を縮める下限（元の長さの割合）
        self.cache = {}

    def _seg(self, alias):
        p = self.ph[alias]
        o = p["offset"] // 2   # offset は波形の頭からのバイト数、length はサンプル数
        y = self.wav[o:o + p["length"]]
        return resample_poly(y, FS, self.sr) if self.sr != FS else y.copy(), p

    def analyse(self, alias):
        """→ (f0, sp, ap, 子音のフレーム数, pre 秒, 母音の音量)。無声のフレームの響きは近くの有声で埋めない（子音を残す）。"""
        if alias in self.cache:
            return self.cache[alias]
        y, p = self._seg(alias)
        # 素片は 0.2 秒ほどと短く、そのままだと harvest がヒープを壊して落ちる。前後に無音を足して測り、その分を切る
        pad = int(.1 * FS)
        yp = np.ascontiguousarray(np.r_[np.zeros(pad), y, np.zeros(pad)])
        f0, t = pyworld.harvest(yp, FS, f0_floor=self.f0lo, f0_ceil=self.f0hi, frame_period=FP)
        f0 = pyworld.stonemask(yp, f0, t, FS)
        sp = pyworld.cheaptrick(yp, f0, t, FS)
        ap = pyworld.d4c(yp, f0, t, FS)
        k0 = int(round(pad / FS * 1000 / FP))
        k1 = k0 + int(np.ceil(len(y) / FS * 1000 / FP))
        f0, sp, ap = f0[k0:k1], sp[k0:k1], ap[k0:k1]
        cons = int(round(p["consonant"] / self.sr * 1000 / FP))
        pre = p["pre"] / self.sr
        voiced = np.where(f0 > 0)[0]
        # 母音の所は時間方向にならし（ぶつぶつを消す）、息を減らす
        v0 = max(cons, int(voiced[0]) if len(voiced) else cons)
        v1 = int(voiced[-1]) if len(voiced) else len(f0) - 1
        v0 = min(v0, max(0, v1 - 4))
        sm = np.exp(uniform_filter1d(np.log(sp + 1e-12), 3, axis=0))
        sp = sp.copy()
        sp[v0:] = sm[v0:]
        ap = ap.copy()
        ap[v0:] = np.maximum(ap[v0:] * self.apk, .001)
        rms = float(np.sqrt(np.mean(y[int(v0 * FP / 1000 * FS):int((v1 + 1) * FP / 1000 * FS)] ** 2) + 1e-12))
        r = dict(f0=f0, sp=sp, ap=ap, cons=cons, v0=v0, v1=max(v0 + 2, v1), pre=pre, rms=rms)
        self.cache[alias] = r
        return r

    def alias_of(self, kana):
        k = SUB.get(kana, kana)
        if k in self.ph:
            return k
        if k[-1] in SMALL and k[:-1] in self.ph:
            return k[:-1]
        return vowel_of(k) if vowel_of(k) in self.ph else "あ"

    def _frames(self, a, n_total, n_note, skip_cons=False):
        """音 a のフレームの並び（長さ n_total）。子音は等速、母音は v0..v1 を行って戻る。
        短い音は子音が音符を食って母音が消えるので、母音が音符の 6 割は残るよう子音を縮める（最短で元の cons_min＝7 割）。"""
        start = a["v0"] if skip_cons else 0
        head = np.arange(start, a["v0"])
        room = n_total - int(.6 * n_note)
        if len(head) > room:
            k = max(int(self.cons_min * len(head)), room, 1)
            head = np.round(np.linspace(start, a["v0"] - 1, k)).astype(int)
        head = list(head)
        L = a["v1"] - a["v0"]
        need = n_total - len(head)
        if need <= 0:
            return np.array(head[:n_total], int)
        if need <= L + 1:
            body = np.round(np.linspace(a["v0"], a["v0"] + min(L, need - 1), need)).astype(int)
        else:
            # まず通しで流し、残りは母音の後ろ 2/3 を行って戻る
            first = np.arange(a["v0"], a["v1"] + 1)
            l0 = a["v0"] + L // 3
            seg = np.r_[np.arange(a["v1"], l0, -1), np.arange(l0, a["v1"] + 1)]
            reps = int(np.ceil((need - len(first)) / max(1, len(seg)))) + 1
            body = np.r_[first, np.tile(seg, reps)][:need]
        return np.r_[np.array(head, int), body].astype(int)

    def sing(self, notes, total, vib=(5.6, .22, .28), port=.045, level=.1, gate=.7):
        """notes: [(秒, 長さ秒, MIDI, かな)] を時刻順に。→ 波形（長さ total 秒）。
        同じ母音の「ー」は前の音とつないで 1 つにする（言い直さない）。っ は休み。"""
        out = np.zeros(int(total * FS) + FS)
        units = []
        for t, d, m, k in sorted(notes, key=lambda x: x[0]):
            if k in ("っ", "ッ", "R", ""):
                units.append(None)
                continue
            if k in ("ー", "〜", "～") or (k in SMALL and units and units[-1] is not None):
                if units and units[-1] is not None:
                    units[-1]["segs"].append((t, d, m))
                    continue
                k = "あ"
            units.append({"alias": self.alias_of(k), "segs": [(t, d, m)]})
        units = [u for u in units if u is not None]
        prev_m = None
        for i, u in enumerate(units):
            a = self.analyse(u["alias"])
            t0 = u["segs"][0][0]
            full = u["segs"][-1][0] + u["segs"][-1][1]
            t_end = full * .97 + t0 * .03
            # 次の音とつながる所は、次の子音の頭から 25ms 重ねて切る（重ねすぎると子音が埋もれる。sunameri1 の測定で聞き取り 0.43→0.61）。
            # gate は音符の長さのうち必ず残す割合。休符の前は切らない
            if i + 1 < len(units):
                nxt = units[i + 1]
                na = self.analyse(nxt["alias"])
                t_next = nxt["segs"][0][0] - na["pre"]
                if nxt["segs"][0][0] - full < .03:
                    t_end = min(full, max(u["segs"][-1][0] + u["segs"][-1][1] * gate, t_next + .025))
            start = t0 - a["pre"]
            n_tot = max(4, int(np.ceil((t_end - start) / (FP / 1000))))
            fi = self._frames(a, n_tot, max(1, int((t_end - t0) / (FP / 1000))))
            ft = start + np.arange(n_tot) * FP / 1000
            # 高さ: 音符の段（ー でつないだ所も段）、頭は前の音から滑る、長い所はビブラート
            tgt = np.zeros(n_tot)
            for (ts, ds, ms) in u["segs"]:
                tgt[ft >= ts - .02] = ms
            tgt[ft < u["segs"][0][0] - .02] = u["segs"][0][2]
            if prev_m is not None and i > 0:
                w = np.clip((ft - (t0 - a["pre"])) / port, 0, 1)
                w = w * w * (3 - 2 * w)
                tgt = tgt + (prev_m - tgt) * (1 - w) * (ft < t0 + port)
            for j in range(1, len(u["segs"])):    # ー の高さの変わり目も滑らかに
                ts = u["segs"][j][0]
                pm, nm = u["segs"][j - 1][2], u["segs"][j][2]
                w = np.clip((ft - (ts - .03)) / .06, 0, 1)
                sel = (ft >= ts - .03) & (ft < ts + .03)
                tgt[sel] = pm + (nm - pm) * (w[sel] * w[sel] * (3 - 2 * w[sel]))
            rate, depth, after = vib
            age = ft - t0
            vd = depth * np.clip((age - after) / .25, 0, 1)
            tgt = tgt + vd * np.sin(2 * np.pi * rate * np.maximum(age, 0))
            F = 440 * 2 ** ((tgt - 69) / 12)
            src_f0 = a["f0"][fi]
            unv = (src_f0 <= 0) & (fi < a["v0"])
            F[unv] = 0
            sp = np.ascontiguousarray(a["sp"][fi])
            ap = np.ascontiguousarray(a["ap"][fi])
            z = pyworld.synthesize(F, sp, ap, FS, FP)
            z *= level / a["rms"] * .5
            n = len(z)
            fi_ = int(.004 * FS)
            fo = min(int(.03 * FS), n // 3)
            z[:fi_] *= np.linspace(0, 1, fi_)
            z[-fo:] *= np.linspace(1, 0, fo)
            s = int(round(start * FS))
            if s < 0:
                z, s = z[-s:], 0
            e = min(len(out), s + len(z))
            out[s:e] += z[:e - s]
            prev_m = u["segs"][-1][2]
        return out[:int(total * FS)]


class OtoRoid(KoeRoid):
    """UTAU の単独音フォルダ（かな.wav が並ぶ 50 音）を KoeRoid と同じ口で歌わせる。

    oto.ini は当てにしない（配布の 50 音は先行発声が 0 のものがある）。声の出始め（最初の有声フレーム）を測って、
    そこを子音の終わり・先行発声にする。男声は f0lo=60 で読む。
    """

    def __init__(self, folder, f0lo=60, f0hi=420, apk=.6):
        import soundfile as sf
        from pathlib import Path
        self.sr = FS
        self.f0lo, self.f0hi, self.apk = f0lo, f0hi, apk
        self.cons_min = .7
        self.cache = {}
        self.ph = {}
        chunks, pos = [], 0
        for p in sorted(Path(folder).glob("*.wav")):
            y, sr = sf.read(str(p), always_2d=True)
            y = y.mean(1)
            if sr != FS:
                y = resample_poly(y, FS, sr)
            pk = np.abs(y).max()
            if pk < 1e-4 or len(y) < int(.06 * FS):
                continue
            idx = np.where(np.abs(y) > .04 * pk)[0]
            y = y[max(0, idx[0] - int(.005 * FS)):idx[-1] + int(.01 * FS)] / pk * .8
            pad = int(.1 * FS)
            yp = np.ascontiguousarray(np.r_[np.zeros(pad), y, np.zeros(pad)])
            f0, _ = pyworld.harvest(yp, FS, f0_floor=f0lo, f0_ceil=f0hi, frame_period=FP)
            v = np.where(f0 > 0)[0]
            on = max(0, int(v[0] * FP / 1000 * FS) - pad) if len(v) else 0
            on = min(on, int(.14 * FS), max(0, len(y) - int(.05 * FS)))
            self.ph[p.stem] = {"offset": pos * 2, "length": len(y), "pre": on, "overlap": 0, "consonant": on}
            chunks.append(y)
            pos += len(y)
        self.wav = np.concatenate(chunks)

    def splice(self, new, cons_from, vowel_from):
        """無い音を作る: cons_from の子音（声の出始めまで）に vowel_from の母音をつなぐ（ち＋あ → ちゃ）。"""
        c, v = self.ph[cons_from], self.ph[vowel_from]
        a = self.wav[c["offset"] // 2:c["offset"] // 2 + c["pre"]]
        b = self.wav[v["offset"] // 2 + v["pre"]:v["offset"] // 2 + v["length"]]
        x = min(int(.008 * FS), len(a), len(b))
        y = np.r_[a[:len(a) - x], a[len(a) - x:] * np.linspace(1, 0, x) + b[:x] * np.linspace(0, 1, x), b[x:]]
        self.ph[new] = {"offset": len(self.wav) * 2, "length": len(y), "pre": len(a), "overlap": 0, "consonant": len(a)}
        self.wav = np.r_[self.wav, y]
