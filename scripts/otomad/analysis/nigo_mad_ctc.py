"""声の stem から台詞の区間をひらがな CTC（wav2vec2 日本語）で拾う（使い捨て）。シンセの漏れは空白になりやすい。

python -I nigo_mad_ctc.py <id> ...  → nigo_mad_ctc.json（区間 = 非空白トークンが続く所、0.25s 以上の空白で切る）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor  # noqa: E402

HERE = paths.WORK
NAME = "vumichien/wav2vec2-large-xlsr-japanese-hiragana"
proc = Wav2Vec2Processor.from_pretrained(NAME)
model = Wav2Vec2ForCTC.from_pretrained(NAME).eval()
vocab = {v: k for k, v in proc.tokenizer.get_vocab().items()}
blank = proc.tokenizer.pad_token_id
FR = 0.02  # 1フレーム 20ms

out = {}
for sid in sys.argv[1:]:
    y, _ = librosa.load(HERE / "ana_demucs" / "htdemucs" / sid / "vocals.wav", sr=16000)
    toks = []
    W = 16000 * 10
    for s in range(0, len(y), W):
        seg = y[s:s + W]
        if len(seg) < 1600:
            break
        with torch.no_grad():
            lg = model(proc(seg, sampling_rate=16000, return_tensors="pt").input_values).logits[0]
        pr = lg.softmax(-1)
        ids = pr.argmax(-1).numpy()
        conf = pr.max(-1).values.numpy()
        toks += [(s / 16000 + i * FR, int(t), float(c)) for i, (t, c) in enumerate(zip(ids, conf))]
    segs, cur = [], None
    for t, tid, c in toks:
        if tid != blank and c > 0.5:
            ch = vocab.get(tid, "")
            if cur and t - cur["t1"] < 0.25:
                cur["t1"] = t + FR
                if ch != cur["last"]:
                    cur["text"] += ch
            else:
                cur = {"t0": t, "t1": t + FR, "text": ch}
                segs.append(cur)
            cur["last"] = ch
        elif cur and tid == blank:
            cur["last"] = None
    for g in segs:
        g.pop("last", None)
        g["t0"], g["t1"] = round(g["t0"], 2), round(g["t1"], 2)
    out[sid] = segs
    print(sid, len(segs))
(HERE / "nigo_mad_ctc.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
