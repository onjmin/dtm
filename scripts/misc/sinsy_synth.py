"""Sinsy（pysinsy）で MusicXML を歌わせて WAV に書く。sinsy-server.ts が呼ぶ。

    python sinsy_synth.py <in.musicxml> <out.wav>

声は pysinsy に付属の NIT SONG070 F001（CC BY 3.0、名古屋工業大学）。
引数は中継サーバーが作った一時ファイルのパスだけを受ける。
"""

import sys
import wave

import numpy as np
import pysinsy


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: sinsy_synth.py <in.musicxml> <out.wav>", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    audio, sr = pysinsy.synthesize(src)
    audio = np.asarray(audio, dtype=np.float64)
    if not np.all(np.isfinite(audio)):
        audio = np.nan_to_num(audio)
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
