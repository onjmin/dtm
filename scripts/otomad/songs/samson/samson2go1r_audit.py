"""samson2go1r の渡す前の確認（使い捨て）: 句頭・強い音節の拍頭率、抑揚の上下、ブレイクの和音との半音衝突、台詞の時間率、整列図。"""
import json
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

import samson_2go_build as G  # noqa: E402

d = Path(sys.argv[1] if len(sys.argv) > 1 else "samson2go1r")
info = json.loads((d / "placement.json").read_text(encoding="utf-8"))
raw = [p for p in info["placed"] if p.get("kind") == "raw"]
six = G.SIX
head_on, strong_on, same, flat, rev, clash, nbreak = [], [], 0, 0, 0, 0, 0
for p in raw:
    o = p["origin16"]
    on_beat = [abs(((o + q) / 4) - round((o + q) / 4)) < 1e-6 for q in p["pos16"]]
    head_on += [on_beat[h] for h in p["heads"]]
    s = np.array(p["strength"])
    top = s >= np.quantile(s, 0.75)
    strong_on += [b for b, t in zip(on_beat, top) if t]
    src, q = p["src"], p["notes"]
    for i in range(1, len(q)):
        if None in (src[i], src[i - 1], q[i], q[i - 1]):
            continue
        ds, dq = src[i] - src[i - 1], q[i] - q[i - 1]
        if abs(ds) < 0.5:
            continue
        if dq == 0:
            flat += 1
        elif np.sign(dq) == np.sign(ds):
            same += 1
        else:
            rev += 1
    if p["byChord"]:
        for k, m in zip(p["pos16"], q):
            if m is None:
                continue
            ch = {x % 12 for x in G.CH[G.chord_at(int(round((o + k) * 12)))]}
            nbreak += 1
            clash += any(min((int(m) - c) % 12, (c - int(m)) % 12) == 1 for c in ch)

v, sr = librosa.load(d / "vraw.wav", sr=22050)
act = librosa.feature.rms(y=v, frame_length=2048, hop_length=512)[0]
share = float(np.mean(act[: int(64 * 16 * six * sr / 512)] > 0.05 * act.max()))
res = {"rawPlacements": len(raw), "phraseHeadOnBeat": round(float(np.mean(head_on)), 2),
       "strongTop25OnBeat": round(float(np.mean(strong_on)), 2), "contour": {"same": same, "flattened": flat, "reversed": rev},
       "breakSemitoneClash": f"{clash}/{nbreak}", "rawShareOfTime_bars1to64": round(share, 2)}
print(json.dumps(res, ensure_ascii=False))
(d / "check_raw.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

bar = 16 * six
fig, axs = plt.subplots(3, 1, figsize=(16, 11))
for ax, b0 in zip(axs, (41, 45, 57)):
    a, e = int((b0 - 1) * bar * sr), int((b0 + 3) * bar * sr)
    S = librosa.amplitude_to_db(np.abs(librosa.stft(v[a:e], n_fft=1024, hop_length=128)), ref=np.max)
    librosa.display.specshow(S, sr=sr, hop_length=128, x_axis="time", y_axis="log", ax=ax, cmap="magma")
    for k in range(65):
        ax.axvline(k * six, color="w", lw=1.4 if k % 16 == 0 else (0.8 if k % 4 == 0 else 0.25), alpha=0.6)
    for p in raw:
        for k, m in zip(p["pos16"], p["notes"]):
            t = (p["origin16"] + k) * six - (b0 - 1) * bar
            if m is not None and 0 <= t < 4 * bar:
                ax.plot([t, t + six * 0.9], [librosa.midi_to_hz(m)] * 2, color="c", lw=3)
    ax.set_ylim(60, 4000)
    ax.set_title(f"bars {b0}-{b0 + 3}  (cyan = corrected mora center, thick white = bar)")
plt.tight_layout()
plt.savefig(d / "align.png", dpi=72)
