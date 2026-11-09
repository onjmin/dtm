"""淫ク☆サウンドフォント: 淫夢・クッキー☆の声から作ったシンセを、.sf2 と WebAudioFont（JS）にまとめる。

作り方は docs/otomad/techniques/voice-instrument.md の「サウンドフォントにまとめる」。
声は voice_synth_export.py と同じ WORLD の作り（息 ×0.25・響きのならし・高い所 −8 dB）で、
音域に短3度おきに置いた音を、継ぎ目を周期にそろえてクロスフェードした前向きのループにする。

  python -I scripts/otomad/tools/inku_soundfont.py [--out tmp/淫ク☆サウンドフォント]
素材は C:/_own/音MAD素材 から読む（git に入れない）。
出力: inku.sf2（4音色）、webaudiofont/<番号>0_Inku_sf2_file.js（80 YMN・81 UDK・82 野獣・83 MUR）、list.txt、確かめ用の wav。
"""
import argparse
import base64
import struct
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_synth_export import FS, VoiceTone, f0of, note_name  # noqa: E402

M = "C:/_own/音MAD素材/"
RK = M + "Pandora's Box/クッキー☆/★クッキー☆/立教大学前まで/"
IS = M + "AI/淫夢/パック/INMシンセ/【INM】シンセ/シンセ化音声素材/"
MUR = M + "淫夢/淫夢アルティメットスターターパック2024ver1.1/一軍その１/MURまとめ/MUR音声/COAT 『BS27 誘惑のラビリンス 第三章 空手部・性の裏技』　MUR音声/"

# 名前, GM の番号, 素材, 切る所, 繰り返す所（None は平らな所を探す）, 高さの読み取りの下限
VOICES = [
    ("YMN", 80, RK + "YMN/SIK「わたしも食べさせるぅ＾～」.wav", (2.14, 2.72), (2.32, 2.61), 150),  # 「るぅ＾～」
    ("UDK", 81, RK + "UDK/あーっ・・・.wav", (0.0, 0.85), None, 100),
    ("YJ", 82, IS + "淫夢シンセ/野獣シンセ G4.wav", (0.0, 0.50), None, 150),
    ("MUR", 83, MUR + "いいゾ～これ.wav", (0.28, 0.50), None, 60),  # 「ゾ～」。0.28 から z の摩擦
]
SR = 32000  # 書き出しの標本化周波数（4.5 kHz から上は下げてあるので足りる）
LO, HI, STEP = 36, 84, 3  # C2〜C6 を短3度おき（上はいちばん上の音を広げる。C7 まで作ると声が細すぎ、高さも読めなかった）
LEN, LS, LE = .85, .25, .75  # 1本の長さ・ループの頭・ループの終わりのめど（秒）
XF = .03  # ループの継ぎ目のクロスフェード（秒）
RELEASE = .12


def zone_sample(v, m):
    """1つの高さの音を作り、ループ点（標本の番号）を返す。"""
    n = int(LEN * FS)
    z = v.play(m, n + int(.1 * FS))[:n]  # 終わりの減衰（env の切れ）は入れない
    y = resample_poly(z, SR, FS)
    f = 440 * 2 ** ((m - 69) / 12)
    P = SR / f
    ls = int(LS * SR)
    n0 = max(1, int(round((LE * SR - ls) / P)))
    # 周期の整数倍が標本の整数に近い回数を選ぶ（継ぎ目で位相がずれない）
    N = min(range(max(1, n0 - 12), n0 + 13), key=lambda k: abs(k * P - round(k * P)))
    le = ls + int(round(N * P))
    X = min(int(XF * SR), ls)
    w = np.sin(np.linspace(0, np.pi / 2, X)) ** 2
    y[le - X:le] = y[le - X:le] * (1 - w) + y[ls - X:ls] * w
    y = np.concatenate([y[:le], y[ls:ls + 64]])  # ループの後ろに頭の写しを少し（SF2 の決まり）
    return y, ls, le


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    (out / "webaudiofont").mkdir(exist_ok=True)
    (out / "check").mkdir(exist_ok=True)
    insts = []
    for name, prog, src, cut, loop, f0lo in VOICES:
        v = VoiceTone(src, cut, loop, f0lo=f0lo)
        print(f"{name}: 元の高さ {v.root:.2f}（{note_name(int(round(v.root)))}）繰り返し {v.loop[0]:.2f}〜{v.loop[1]:.2f}", flush=True)
        zs = []
        for m in range(LO, HI + 1, STEP):
            y, ls, le = zone_sample(v, m)
            zs.append(dict(root=m, y=y, ls=ls, le=le))
        # ループの所の大きさを楽器の中でそろえ、いちばん大きいピークを −1 dB に
        for z in zs:
            z["y"] = z["y"] / (np.sqrt(np.mean(z["y"][z["ls"]:z["le"]] ** 2)) + 1e-9)
        pk = max(np.abs(z["y"]).max() for z in zs)
        for i, z in enumerate(zs):
            z["y"] = z["y"] / pk * 10 ** (-1 / 20)
            z["lo"] = 0 if i == 0 else z["root"] - 1
            z["hi"] = 127 if i == len(zs) - 1 else z["root"] + 1
        insts.append(dict(name=name, prog=prog, zones=zs, src=Path(src).name))
    write_sf2(out / "inku.sf2", insts)
    lines = []
    for ins in insts:
        fn = f"_tone_{ins['prog']:03d}0_Inku_sf2_file"  # dtm のバンクの形（PPPV_<バンク>）。音色は GM の番号で分ける
        write_waf(out / "webaudiofont" / f"{fn[6:]}.js", fn, ins)
        lines.append(f"{fn[6:]}	{ins['prog']}	{ins['name']}	{ins['src']}")
    (out / "webaudiofont" / "list.txt").write_text("\n".join(lines) + "\n", encoding="utf8")
    check(out, insts)


def i16(y):
    return np.clip(np.round(y * 32767), -32768, 32767).astype("<i2")


def chunk(tag, data):
    if len(data) % 2:
        data += b"\0"
    return tag + struct.pack("<I", len(data)) + data


def lst(tag, body):
    return chunk(b"LIST", tag + body)


def name20(s):
    return s.encode("ascii")[:19].ljust(20, b"\0")


def write_sf2(path, insts):
    smpl = b""; shdr = b""; pos = 0; sid = 0
    phdr = b""; pbag = b""; pgen = b""; inst = b""; ibag = b""; igen = b""
    nib = nig = 0
    for k, ins in enumerate(insts):
        phdr += name20(f"Inku {ins['name']}") + struct.pack("<HHHIII", ins["prog"], 0, k, 0, 0, 0)
        pbag += struct.pack("<HH", k, 0)
        pgen += struct.pack("<HH", 41, k)  # instrument
        inst += name20(f"Inku {ins['name']}") + struct.pack("<H", nib)
        for z in ins["zones"]:
            d = i16(z["y"]).tobytes()
            start = pos; end = pos + len(z["y"])
            smpl += d + b"\0" * 92  # 標本の後ろに 46 個の 0
            pos = end + 46
            shdr += name20(f"{ins['name']}_{note_name(z['root'])}") + struct.pack(
                "<IIIIIBbHH", start, end, start + z["ls"], start + z["le"], SR, z["root"], 0, 0, 1)
            ibag += struct.pack("<HH", nig, 0); nib += 1
            igen += struct.pack("<HBB", 43, z["lo"], z["hi"])  # keyRange
            igen += struct.pack("<Hh", 34, int(1200 * np.log2(.004)))  # attackVolEnv
            igen += struct.pack("<Hh", 38, int(1200 * np.log2(RELEASE)))  # releaseVolEnv
            igen += struct.pack("<HH", 54, 1)  # sampleModes: 鳴らしている間ループ
            igen += struct.pack("<HH", 53, sid)  # sampleID
            nig += 5; sid += 1
    phdr += name20("EOP") + struct.pack("<HHHIII", 0, 0, len(insts), 0, 0, 0)
    pbag += struct.pack("<HH", len(insts), 0)
    pmod = b"\0" * 10
    pgen += b"\0" * 4
    inst += name20("EOI") + struct.pack("<H", nib)
    ibag += struct.pack("<HH", nig, 0)
    imod = b"\0" * 10
    igen += b"\0" * 4
    shdr += name20("EOS") + b"\0" * 26
    info = lst(b"INFO", chunk(b"ifil", struct.pack("<HH", 2, 1)) + chunk(b"isng", b"EMU8000\0")
               + chunk(b"INAM", "Inku SoundFont\0".encode()) + chunk(b"ICMT", "淫夢・クッキー☆の声から作ったシンセ。onjmin/dtm scripts/otomad/tools/inku_soundfont.py\0".encode("utf8")))
    sdta = lst(b"sdta", chunk(b"smpl", smpl))
    pdta = lst(b"pdta", b"".join(chunk(t, d) for t, d in [
        (b"phdr", phdr), (b"pbag", pbag), (b"pmod", pmod), (b"pgen", pgen),
        (b"inst", inst), (b"ibag", ibag), (b"imod", imod), (b"igen", igen), (b"shdr", shdr)]))
    path.write_bytes(chunk(b"RIFF", b"sfbk" + info + sdta + pdta))
    print(path, f"{path.stat().st_size / 1e6:.1f} MB")


def write_waf(path, fn, ins):
    zs = []
    for z in ins["zones"]:
        zs.append("{midi:%d,originalPitch:%d,keyRangeLow:%d,keyRangeHigh:%d,loopStart:%d,loopEnd:%d,coarseTune:0,fineTune:0,sampleRate:%d,ahdsr:true,sample:'%s'}" % (
            ins["prog"], z["root"] * 100, z["lo"], z["hi"], z["ls"], z["le"], SR, base64.b64encode(i16(z["y"]).tobytes()).decode()))
    path.write_text(f"console.log('load {fn}');\nvar {fn}={{zones:[\n" + ",\n".join(zs) + "\n]};\n", encoding="utf8")
    print(path.name, f"{path.stat().st_size / 1e6:.1f} MB")


def check(out, insts):
    """ループを回して 2 秒鳴らし、高さと継ぎ目の段差を測る。音色ごとの音階も wav に書く。"""
    for ins in insts:
        worst = 0; seq = []
        for z in ins["zones"]:
            y, ls, le = z["y"], z["ls"], z["le"]
            loop = y[ls:le]
            s = np.concatenate([y[:le]] + [loop] * int(np.ceil(2 * SR / len(loop))))[:2 * SR]
            f = f0of(resample_poly(s, FS, SR), 50, 2500); f = f[f > 0]
            err = 69 + 12 * np.log2(np.median(f) / 440) - z["root"]
            # 継ぎ目の段差: ループの終わり→頭の差を、ループの中の隣どうしの差の 99% 点と比べる
            jump = abs(y[le - 1] - y[ls]) / (np.percentile(np.abs(np.diff(loop)), 99) + 1e-9)
            worst = max(worst, jump)
            print(f"  {ins['name']} {note_name(z['root']):>4} 高さのずれ {err:+.2f} 半音  継ぎ目 {jump:.2f}")
            if z["root"] % 12 == 0:
                seq.append(s[:int(1.2 * SR)] * np.r_[np.ones(int(1.1 * SR)), np.linspace(1, 0, int(.1 * SR))])
        sf.write(out / "check" / f"{ins['name']}_C音階_ループ込み.wav", np.concatenate(seq).astype(np.float32), SR, subtype="PCM_16")
        print(f"{ins['name']}: 継ぎ目の段差の最大 {worst:.2f}（1 以下ならループの中の普通の動きと同じ）")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tmp/淫ク☆サウンドフォント")
    build(Path(ap.parse_args().out))
