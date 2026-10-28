"""台詞の読みを pyopenjtalk でモーラにし、torchaudio の MMS_FA でモーラごとの子音・母音の時刻を取る（強制整列）。

python align.py <wav> [読み]   （読みを省くとファイル名から作る）
"""
import re
import sys
from pathlib import Path

import config  # noqa: F401  SPEECH_PYLIB を sys.path へ足す
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyopenjtalk  # noqa: E402
import torch  # noqa: E402
import torchaudio  # noqa: E402

SR = 16000
VOWELS = set("aiueoAIUEO")
_bundle = torchaudio.pipelines.MMS_FA
_model = None
_dict = None


def get_model():
    global _model, _dict
    if _model is None:
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        _model = _bundle.get_model(with_star=False).to(dev)
        _dict = _bundle.get_dict(star=None)
    return _model, _dict


def text_from_name(path):
    s = Path(path).stem
    s = re.sub(r"^\s*\d+\s*", "", s)  # 先頭の連番
    s = re.sub(r"[wｗ]+", "", s)  # 笑い
    s = re.sub(r"[☆★♪♡・…\.]+", "、", s)
    return s.strip()


def morae_from_text(text):
    """pyopenjtalk の音素列をモーラにまとめる（子音+母音 / N / cl）。"""
    ph = pyopenjtalk.g2p(text).split()
    out, cur = [], []
    for p in ph:
        if p == "pau":
            if cur:
                out.append(cur)
                cur = []
            continue
        if p in ("N", "cl"):
            out.append([p])
            continue
        cur.append(p)
        if p in VOWELS:
            out.append(cur)
            cur = []
    return out


def roman(ph):
    """MMS_FA の文字（a-z）へ。"""
    m = {"N": "n", "cl": "q", "ch": "ch", "ts": "ts", "sh": "sh", "j": "j", "y": "y", "f": "f", "v": "v"}
    s = ""
    for p in ph:
        s += m.get(p, p.lower())
    return s


def align(path, text=None):
    text = text or text_from_name(path)
    morae = morae_from_text(text)
    if not morae:
        return None
    model, dic = get_model()
    y_full, _ = librosa.load(path, sr=SR, mono=True)
    # 声のある区間だけを整列にかける（無音やこだまへモーラを押し込ませない）
    rms = librosa.feature.rms(y=y_full, frame_length=400, hop_length=160)[0]
    on = np.flatnonzero(rms > 0.05 * rms.max())
    a = max(0, on[0] * 160 - int(0.05 * SR)) if len(on) else 0
    b = min(len(y_full), (on[-1] + 1) * 160 + int(0.05 * SR)) if len(on) else len(y_full)
    y, offset = y_full[a:b], a / SR
    words = [roman(m) for m in morae]
    tokens = [dic[c] for w in words for c in w if c in dic]
    with torch.inference_mode():
        em, _ = model(torch.from_numpy(y).float()[None].to(next(model.parameters()).device))
    T = em.shape[1]
    if len(tokens) == 0 or len(tokens) > T:
        return None
    ali, scores = torchaudio.functional.forced_align(em, torch.tensor([tokens], device=em.device), blank=0)
    ali, scores = ali[0].cpu().numpy(), scores[0].exp().cpu().numpy()
    spans = torchaudio.functional.merge_tokens(torch.from_numpy(ali), torch.from_numpy(scores))
    sec = len(y) / SR / T
    out, i = [], 0
    for m, w in zip(morae, words):
        n = sum(1 for c in w if c in dic)
        sp = spans[i : i + n]
        i += n
        if not sp:
            continue
        ends_vowel = w[-1] in "aiueo" and len(sp) > 1
        out.append({
            "mora": "".join(m),
            "start": offset + sp[0].start * sec,
            # 母音の頭（拍に合わせる点）。子音だけのモーラは頭と同じ
            "vstart": offset + (sp[-1].start if ends_vowel else sp[0].start) * sec,
            "end": offset + sp[-1].end * sec,
            "score": float(np.mean([s.score for s in sp])),
            "vowel": m[-1].lower() if m[-1] not in ("N", "cl") else m[-1],
        })
    # 次のモーラの頭までを長さとする（母音の伸びを含める）
    for a, b in zip(out, out[1:]):
        a["end"] = max(a["end"], min(b["start"], a["end"] + 0.4))
    return {"text": text, "morae": out, "dur": len(y_full) / SR}


if __name__ == "__main__":
    r = align(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(r["text"])
    for m in r["morae"]:
        print(f"{m['start']:.2f}-{m['end']:.2f} {m['mora']:5s} {m['score']:.2f}")
