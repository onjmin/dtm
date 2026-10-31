"""原音のスペクトログラムに整列の境界（頭=灰, 母音頭=赤）を重ねて PNG にする（使い捨て）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import librosa.display  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from align import align  # noqa: E402
from compose_quotes import CH, S2, find  # noqa: E402

CLIPS_OLD = [
    (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ"),
    (S2, 44, "もしもしっ！って言って"),
    (S2, 63, "自分が自分らしく輝いていく仏法なんだよ！って言われたんです"),
    (S2, 56, "もうダブルオドロキですよね"),
]
import inmu_v1 as I
CLIPS = [(str(I.OSS[0]), I.OSS[2]), (str(I.AGE[0]), I.AGE[2]), (str(I.JAKEN[0]), I.JAKEN[2]), (str(I.FA[0]), I.FA[2]), (str(I.YARI[0]), I.YARI[2])]
fig, axes = plt.subplots(len(CLIPS), 1, figsize=(16, 3.2 * len(CLIPS)))
for ax, (p, text) in zip(axes, CLIPS):
    num = Path(p).stem[:20]
    y, sr = librosa.load(p, sr=16000)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(y, n_fft=512, hop_length=80)), ref=np.max)
    librosa.display.specshow(S, sr=sr, hop_length=80, x_axis="time", y_axis="linear", ax=ax, cmap="gray_r")
    ax.set_ylim(0, 5000)
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=80)[0]
    t = np.arange(len(rms)) * 80 / sr
    ax.plot(t, 4800 * rms / rms.max(), color="tab:blue", lw=1)
    r = align(p, text)
    for m in r["morae"]:
        ax.axvline(m["start"], color="0.5", lw=0.8)
        ax.axvline(m["vstart"], color="red", lw=1.2)
        ax.text(m["vstart"], 4500, m["mora"], color="red", fontsize=9)
    ax.set_title(f"{num}", loc="left")
plt.tight_layout()
plt.savefig(paths.WORK / sys.argv[1], dpi=70)
