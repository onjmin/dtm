"""Sinsy（pysinsy）で MusicXML を歌わせて WAV に書く。sinsy-server.ts が呼ぶ。

    python sinsy_synth.py <in.musicxml> <out.wav> [--no-tune]

声は pysinsy に付属の NIT SONG070 F001（CC BY 3.0、名古屋工業大学）。
引数は中継サーバーが作った一時ファイルのパスだけを受ける。

Sinsy の声のモデル（HMM）は高さの動きを自分で作るので、楽譜から外れやすい
（2026-11-01、海鬼月の主旋律で「音痴」と言われた）。pyworld があれば、出てきた歌声を
WORLD で分解し、声の出ている所の高さを楽譜の音に置き換えて組み立て直す（声色はそのまま）。
--no-tune か、pyworld が無いときは、Sinsy の出力をそのまま書く。
"""

import sys
import wave
import xml.etree.ElementTree as ET

import numpy as np
import pysinsy

FRAME_MS = 5.0
GLIDE_SEC = 0.03  # 音の変わり目でつなぐ長さ


def score_notes(path: str):
    """MusicXML から (開始秒, 終了秒, MIDI) を並べる（休符は飛ばす。タイは1音につなぐ）。"""
    root = ET.parse(path).getroot()
    divisions = 1.0
    tempo = 120.0
    t = 0.0
    notes = []
    for measure in root.iter("measure"):
        for el in measure:
            if el.tag == "attributes":
                d = el.find("divisions")
                if d is not None and d.text:
                    divisions = max(1.0, float(d.text))
            elif el.tag == "direction":
                s = el.find(".//sound")
                if s is not None and s.get("tempo"):
                    tempo = max(1.0, float(s.get("tempo")))
            elif el.tag == "note":
                dur_el = el.find("duration")
                dur = float(dur_el.text) if dur_el is not None and dur_el.text else 0.0
                sec = dur / divisions * 60.0 / tempo
                pitch = el.find("pitch")
                if pitch is not None:
                    step = pitch.findtext("step", "C")
                    alter = float(pitch.findtext("alter", "0") or 0)
                    octave = int(pitch.findtext("octave", "4"))
                    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[step]
                    midi = (octave + 1) * 12 + base + alter
                    tie_stop = any(x.get("type") == "stop" for x in el.findall("tie"))
                    if tie_stop and notes and notes[-1][1] >= t - 1e-6 and notes[-1][2] == midi:
                        notes[-1] = (notes[-1][0], t + sec, midi)
                    else:
                        notes.append((t, t + sec, midi))
                t += sec
    return notes


def tune(audio: np.ndarray, sr: int, notes) -> np.ndarray:
    """声の出ている所の高さを楽譜の音へ置き換える。"""
    import pyworld

    x = audio.astype(np.float64) / 32768.0
    f0, tpos = pyworld.harvest(x, sr, frame_period=FRAME_MS)
    sp = pyworld.cheaptrick(x, f0, tpos, sr)
    ap = pyworld.d4c(x, f0, tpos, sr)
    target = np.zeros_like(f0)
    for s, e, midi in notes:
        hz = 440.0 * 2.0 ** ((midi - 69.0) / 12.0)
        target[(tpos >= s) & (tpos < e)] = hz
    # 休符の所（楽譜に音が無い）で声が出ていれば、直前・直後の音でつなぐ
    last = 0.0
    for i in range(len(target)):
        if target[i] > 0:
            last = target[i]
        elif f0[i] > 0 and last > 0:
            target[i] = last
    # 変わり目をなめらかに（対数の高さで移動平均）
    n = max(1, int(GLIDE_SEC * 1000 / FRAME_MS))
    voiced_t = target > 0
    logt = np.where(voiced_t, np.log(np.maximum(target, 1e-6)), 0.0)
    kernel = np.ones(n) / n
    num = np.convolve(logt, kernel, mode="same")
    den = np.convolve(voiced_t.astype(float), kernel, mode="same")
    smooth = np.where(den > 0, np.exp(num / np.maximum(den, 1e-9)), 0.0)
    new_f0 = np.where((f0 > 0) & (smooth > 0), smooth, f0)
    y = pyworld.synthesize(new_f0, sp, ap, sr, frame_period=FRAME_MS)
    return y * 32768.0


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        print("usage: sinsy_synth.py <in.musicxml> <out.wav> [--no-tune]", file=sys.stderr)
        return 2
    src, dst = args
    audio, sr = pysinsy.synthesize(src)
    audio = np.nan_to_num(np.asarray(audio, dtype=np.float64))
    if "--no-tune" not in sys.argv:
        try:
            audio = tune(audio, int(sr), score_notes(src))
            audio = np.nan_to_num(audio)
        except ImportError:
            pass  # pyworld が無ければそのまま
    # pysinsy は 16bit の振幅のスケール（±32768 前後）で返す。はみ出しだけ抑える。
    peak = float(np.abs(audio).max()) if audio.size else 0.0
    if peak > 32767:
        audio = audio * (32767 / peak)
    pcm = np.clip(audio, -32768, 32767).astype("<i2")
    with wave.open(dst, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm.tobytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())
