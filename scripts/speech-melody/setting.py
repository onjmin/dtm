"""台詞1本の下ごしらえ: 強制整列 → 母音頭を音響の立ち上がりで確かめる → モーラごとの音高（台詞の中央値からの半音）。"""
import librosa
import numpy as np
import pyopenjtalk

from align import align


def hz2midi(hz):
    return 69 + 12 * np.log2(hz / 440)


def phrase_info(text, n_morae):
    """モーラ番号 → 句頭か、と 息継ぎの直後か。"""
    heads, i = set(), 0
    for nd in pyopenjtalk.run_frontend(text):
        k = nd["mora_size"]
        if k <= 0:
            continue
        if nd["chain_flag"] != 1:
            heads.add(i)
        i += k
    pauses, count, prev_pau = set(), 0, False
    for p in pyopenjtalk.g2p(text).split():
        if p == "pau":
            prev_pau = True
            continue
        if p in ("N", "cl") or p in "aiueoAIUEO":
            if prev_pau:
                pauses.add(count)
                prev_pau = False
            count += 1
    if i != n_morae:
        heads = {0}
    return heads, pauses


def refine_onsets(y, sr, ms):
    """整列の母音頭を音響の立ち上がりで確かめ、合えば吸着、合わなければ音響だけで割り当てる。

    戻り値: (方式, 一致率)。一致率は、声のあるモーラのうち母音頭の ±50ms に立ち上がり候補がある割合。
    """
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=160)
    cand_f = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=160, delta=0.02, wait=4)
    cand = cand_f * 0.01
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=160)[0]
    loud = rms > 0.25 * rms.max()
    sounding = [m for m in ms if m["vowel"] != "cl"]
    near = [m for m in sounding if len(cand) and np.min(np.abs(cand - m["vstart"])) <= 0.05
            and loud[min(len(loud) - 1, int(m["vstart"] * 100)):int(m["vstart"] * 100) + 10].any()]
    agree = len(near) / max(1, len(sounding))
    if agree >= 0.5:
        prev = -1.0
        for m in ms:
            d = np.abs(cand - m["vstart"]) if len(cand) else np.array([])
            if len(d) and d.min() <= 0.07 and cand[d.argmin()] > prev:
                shift = cand[d.argmin()] - m["vstart"]
                m["vstart"] += shift
                m["start"] = min(m["start"] + shift, m["vstart"])
            prev = m["vstart"]
        return "align+snap", agree
    # 音響だけ: 声のある区間の強い立ち上がりを、声のあるモーラの数だけ時刻順に割り当てる
    on = np.flatnonzero(loud)
    t0, t1 = on[0] * 0.01, (on[-1] + 1) * 0.01
    inside = [(env[f], f * 0.01) for f in cand_f if t0 - 0.03 <= f * 0.01 <= t1]
    n = len(sounding)
    picked = []
    for _s, t in sorted(inside, reverse=True):
        if all(abs(t - p) >= 0.06 for p in picked):
            picked.append(t)
        if len(picked) == n:
            break
    picked = sorted(picked)
    while len(picked) < n:  # 足りなければ最長の間を割る
        gaps = np.diff([t0] + picked + [t1])
        k = int(np.argmax(gaps))
        lo = ([t0] + picked)[k]
        picked.insert(k, lo + gaps[k] / 2)
        picked = sorted(picked)
    it = iter(picked)
    for m in ms:
        if m["vowel"] != "cl":
            t = next(it)
            m["vstart"], m["start"] = t, t - 0.03
    for a, b in zip(ms, ms[1:]):
        a["end"] = b["start"] if b["start"] > a["vstart"] else a["vstart"] + 0.05
    ms[-1]["end"] = max(ms[-1]["vstart"] + 0.08, t1)
    return "acoustic", agree


def clip_data(path, text):
    y, sr = librosa.load(str(path), sr=16000)
    r = align(str(path), text)
    if r is None:
        raise ValueError(f"整列できない: {path}（{text}）")
    ms = r["morae"]
    heads, pauses = phrase_info(text, len(ms))
    method, agree = refine_onsets(y, sr, ms)
    f0, vf, _ = librosa.pyin(y, fmin=60, fmax=700, sr=sr, hop_length=160, frame_length=1024)
    ok = vf & np.isfinite(f0)
    med = float(np.median(f0[ok])) if ok.sum() else 200.0
    for m in ms:
        a, b = int(m["vstart"] * 100), int(m["end"] * 100) + 1
        seg = f0[a:b][ok[a:b]]
        if len(seg) < 2:
            a = int(m["start"] * 100)
            seg = f0[a:b][ok[a:b]]
        if len(seg) >= 2 and m["vowel"] != "cl":
            st = float(np.median(12 * np.log2(seg / med)))
            if abs(st) > 9:
                st -= 12 * np.sign(st)  # オクターブ誤り
            m["st"] = st
        else:
            m["st"] = None
    return {"path": str(path), "text": text, "morae": ms, "heads": heads, "pauses": pauses,
            "medMidi": float(hz2midi(med)), "score": float(np.mean([m["score"] for m in ms])),
            "method": method, "agree": agree}
