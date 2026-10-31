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


def target_curve(notes, n_frames: int, f0_hint=None) -> np.ndarray:
    """5ms ごとの「楽譜の高さ」（Hz。音の無い所は 0）。変わり目は対数の高さでなめらかに。"""
    hop = FRAME_MS / 1000.0
    t = np.arange(n_frames) * hop
    target = np.zeros(n_frames)
    for s, e, midi in notes:
        target[(t >= s) & (t < e)] = 440.0 * 2.0 ** ((midi - 69.0) / 12.0)
    # 楽譜の音が切れた直後も声が残っていることがあるので、直前の音で埋めておく
    last = 0.0
    for i in range(n_frames):
        if target[i] > 0:
            last = target[i]
        else:
            target[i] = last
    n = max(1, int(GLIDE_SEC * 1000 / FRAME_MS))
    voiced = target > 0
    logt = np.where(voiced, np.log(np.maximum(target, 1e-6)), 0.0)
    kernel = np.ones(n) / n
    num = np.convolve(logt, kernel, mode="same")
    den = np.convolve(voiced.astype(float), kernel, mode="same")
    return np.where(den > 0, np.exp(num / np.maximum(den, 1e-9)), 0.0)


def _tune_chunk(args):
    """1区切りぶん: WORLD で分解し、声の出ている所の高さを楽譜の高さに替えて組み立て直す。"""
    import pyworld

    x, sr, target = args
    # 高さはどうせ楽譜に置き換えるので、検出は速い dio＋stonemask で足りる（声の有無と声色用）
    f0, tpos = pyworld.dio(x, sr, frame_period=FRAME_MS)
    f0 = pyworld.stonemask(x, f0, tpos, sr)
    sp = pyworld.cheaptrick(x, f0, tpos, sr)
    ap = pyworld.d4c(x, f0, tpos, sr)
    tg = target[: len(f0)]
    if len(tg) < len(f0):
        tg = np.pad(tg, (0, len(f0) - len(tg)))
    new_f0 = np.where((f0 > 0) & (tg > 0), tg, f0)
    y = pyworld.synthesize(new_f0, sp, ap, sr, frame_period=FRAME_MS)
    y = y[: len(x)]
    if len(y) < len(x):
        y = np.pad(y, (0, len(x) - len(y)))
    return y


def split_points(x: np.ndarray, hop: int, min_gap_frames: int = 30):
    """無音が続く所（5ms×30＝150ms 以上）の真ん中で区切る。区切りは hop の倍数にそろえる。"""
    n_frames = len(x) // hop
    rms = np.sqrt(np.mean(x[: n_frames * hop].reshape(n_frames, hop) ** 2, axis=1))
    silent = rms < 1e-3
    cuts = [0]
    i = 0
    while i < n_frames:
        if silent[i]:
            j = i
            while j < n_frames and silent[j]:
                j += 1
            if j - i >= min_gap_frames and i > 0 and j < n_frames:
                cuts.append(((i + j) // 2) * hop)
            i = j
        else:
            i += 1
    cuts.append(len(x))
    return cuts


def tune(audio: np.ndarray, sr: int, notes) -> np.ndarray:
    """声の出ている所の高さを楽譜の音へ置き換える。

    休符で区切り、区切りごとに別のプロセスで並べて処理する（2026-11-01、harvest を
    dio に替えたのと合わせて、海鬼月のトラックで約 58 秒 → 数秒台）。
    """
    import os
    from concurrent.futures import ProcessPoolExecutor

    x = audio.astype(np.float64) / 32768.0
    hop = int(round(sr * FRAME_MS / 1000.0))
    target = target_curve(notes, len(x) // hop + 2)
    cuts = split_points(x, hop)
    jobs = [
        (x[a:b], sr, target[a // hop : b // hop + 2])
        for a, b in zip(cuts[:-1], cuts[1:])
    ]
    workers = max(1, min(len(jobs), os.cpu_count() or 1))
    if workers == 1:
        parts = [_tune_chunk(j) for j in jobs]
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            parts = list(pool.map(_tune_chunk, jobs))
    return np.concatenate(parts) * 32768.0


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
