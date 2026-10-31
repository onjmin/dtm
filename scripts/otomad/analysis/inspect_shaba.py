"""シャバダバの整列・音符・原音の onset を並べて見る（使い捨て）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

from align import align  # noqa: E402
from align_batch import pitch_morae  # noqa: E402
from compose_quotes import S2, find  # noqa: E402
from compose_song import SIX, to_notes  # noqa: E402

p = str(find(S2, 3))
text = "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ"
r = pitch_morae(p, align(p, text))
notes = to_notes(r)
y, sr = librosa.load(p, sr=16000)
print("dur", round(len(y) / sr, 3))
on = librosa.onset.onset_detect(y=y, sr=sr, hop_length=160, units="time", backtrack=False)
print("onsets", np.round(on, 3).tolist())
print("onset gaps", np.round(np.diff(on), 3).tolist())
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=160, units="time")
print("tempo", tempo, "beats", np.round(beats, 3).tolist())
for m, n in zip(r["morae"], notes):
    print(f"{m['mora']:4s} src {m['start']:.3f}-{m['end']:.3f} ({m['end'] - m['start']:.3f}) score {m['score']:.2f} "
          f"-> pos {n['pos']:2d} len {n['len']} (out {n['pos'] * SIX:.2f}s)")
