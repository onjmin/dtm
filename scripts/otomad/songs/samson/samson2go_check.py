"""2号式の曲を2号兄貴の作の測り方で測る（使い捨て）。python -I samson2go_check.py <outdir> [build モジュール] → check.json"""
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402

M = importlib.import_module(sys.argv[2] if len(sys.argv) > 2 else "samson_2go_build")

od = Path(sys.argv[1])
info = json.loads((od / "placement.json").read_text(encoding="utf-8"))
SR = 22050
six = M.SIX
off = float((od / "offset.txt").read_text())

# リード: ペンタ率・拍頭の和音との半音衝突・16分率・音域
lead = np.load(od / "lead.npy")
pent = getattr(M, "PENT", {2, 5, 7, 9, 0})
in_pent = np.mean([int(m) % 12 in pent for _, _, m in lead])
clash, beat_ct, on_beats = 0, 0, 0
for s, l, m in lead:
    step = int(round(s * 12))
    if step % 48:
        continue
    on_beats += 1
    ch = M.CH[M.chord_at(step)]
    pcs = {c % 12 for c in ch}
    beat_ct += int(m) % 12 in pcs
    clash += int(m) % 12 not in pcs and any(abs((int(m) - c) % 12) in (1, 11) for c in pcs)
dur16 = np.mean(np.isclose(lead[:, 1], 10 / 12, atol=0.05))

# 声: 楽器と生の台詞の鳴っている時間、音量差、立ち上がりの格子
vi, _ = librosa.load(od / "vinst.wav", sr=SR)
vr, _ = librosa.load(od / "vraw.wav", sr=SR)
mix, _ = librosa.load(od / "song_inst.wav", sr=SR)


def active(x):
    r = librosa.feature.rms(y=x, hop_length=256)[0]
    return r > r.max() * 10 ** (-30 / 20)


ai, ar = active(vi), active(vr)
env = librosa.onset.onset_strength(y=vi, sr=SR, hop_length=128)
on = librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=128) * 128 / SR / six
song, _ = librosa.load(od / "song.wav", sr=SR)
raw_n = sum(1 for p in info["placed"] if p.get("kind") == "raw")
# 生の台詞が鳴る所での 台詞 − 曲 の差（混ぜた後）
inst_only, _ = librosa.load(od / "song_inst.wav", sr=SR)
k = min(len(song), len(inst_only))
voice_part = song[:k] - inst_only[:k]
fr = librosa.feature.rms(y=voice_part, hop_length=256)[0]
fi = librosa.feature.rms(y=inst_only[:k], hop_length=256)[0]
act = fr > fr.max() * 0.1
end_fr = int((off + info["endStep"] / 12 * six) * SR / 256)
act[end_fr:] = False
out = {
    "leadPentatonic": round(float(in_pent), 2), "leadOnBeatChordTone": round(beat_ct / max(1, on_beats), 2),
    "leadOnBeatSemitoneClash": clash, "lead16thShare": round(float(dur16), 2),
    "leadRangeSemitones": int(lead[:, 2].max() - lead[:, 2].min()),
    "voiceInstrumentShareOfTime": round(float(ai.mean()), 2), "rawSpeechShareOfTime": round(float(ar.mean()), 2),
    "rawSpeechPlacements": raw_n,
    "rawMinusSongDb": round(float(20 * np.log10(np.median(fr[act]) / np.median(fi[act]))), 1),
    "vinstOnsetsWithinQuarter16th": round(float(np.mean(np.abs(on - np.round(on)) < 0.25)), 2),
    "vowelSources": info.get("vowelSources"),
}
(od / "check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False))
