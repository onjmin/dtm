"""2号兄貴MADの声の stem を whisper-small で書き起こし、台詞の区間と文を取る（使い捨て）。

python -I nigo_mad_asr.py <id> ...  → nigo_mad_asr.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa  # noqa: E402
from transformers import pipeline  # noqa: E402

HERE = paths.WORK
asr = pipeline("automatic-speech-recognition", model="openai/whisper-small", device=-1)
out = {}
p = HERE / "nigo_mad_asr.json"
if p.exists():
    out = json.loads(p.read_text(encoding="utf-8"))
for sid in sys.argv[1:]:
    y, _ = librosa.load(HERE / "ana_demucs" / "htdemucs" / sid / "vocals.wav", sr=16000)
    r = asr(y, chunk_length_s=30, return_timestamps=True,
            generate_kwargs={"language": "japanese", "task": "transcribe"})
    out[sid] = [{"t0": c["timestamp"][0], "t1": c["timestamp"][1], "text": c["text"]} for c in r["chunks"]]
    print(sid, len(out[sid]))
    for c in out[sid]:
        print(f"  {c['t0']}-{c['t1']} {c['text']}")
p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
