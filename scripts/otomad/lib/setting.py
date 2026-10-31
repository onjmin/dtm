"""v5: 句頭を拍頭に置き、句の中は1モーラ＝16分で詰める配置（使い捨て）。

素材ごとの曲は SECTIONS を作って run(sections, outdir) を呼ぶ。
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyopenjtalk  # noqa: E402

import compose_quotes3  # noqa: E402
from align import align, morae_from_text  # noqa: E402
from compose_song import BAR, SIX, hz2midi  # noqa: E402

BEAT = 4


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
    # g2p の pau の直後のモーラ番号
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
    for s, t in sorted(inside, reverse=True):
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


def clip_data(path, text, keep):
    """text は読み1本、または ((開始秒, 終了秒, 読み), ...) の区間指定（区間ごとに整列してつなぐ）。"""
    y, sr = librosa.load(str(path), sr=16000)
    if isinstance(text, tuple):
        import soundfile as sf
        tmp = paths.WORK / "tmp_piece.wav"
        morae, methods, agrees = [], [], []
        for a, b, t in text:
            seg = y[int(a * sr):int(b * sr)]
            sf.write(tmp, seg, sr)
            pr = align(str(tmp), t)
            mth, ag = refine_onsets(seg, sr, pr["morae"])
            methods.append(mth)
            agrees.append(ag)
            for m in pr["morae"]:
                for k in ("start", "vstart", "end"):
                    m[k] += a
            morae += pr["morae"]
        r = {"morae": morae}
        joined = "、".join(t for _, _, t in text)
        heads, pauses = phrase_info(joined, len(morae))
        # 区間の境目は息継ぎ扱い
        i = 0
        for _, _, t in text[:-1]:
            i += len(morae_from_text(t))
            pauses.add(i)
            heads.add(i)
        method, agree = "pieces:" + "/".join(methods), float(np.mean(agrees))
        text = joined
    else:
        r = align(str(path), text)
        n_keep = len(morae_from_text(keep)) if keep else len(r["morae"])
        r["morae"] = r["morae"][:n_keep]
        heads, pauses = phrase_info(keep or text, n_keep)
        method, agree = refine_onsets(y, sr, r["morae"])
    f0, vf, _ = librosa.pyin(y, fmin=60, fmax=700, sr=sr, hop_length=160, frame_length=1024)
    ok = vf & np.isfinite(f0)
    med = float(np.median(f0[ok])) if ok.sum() else 200.0
    ms = r["morae"]
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
    score = float(np.mean([m["score"] for m in ms]))
    # 被覆率: 母音の位置に実際に声がある（音量が最大の10%以上）モーラの割合
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=160)[0]
    rms = rms / (rms.max() + 1e-9)
    sounding = [m for m in ms if m["vowel"] != "cl"]
    covered = sum(float(np.median(rms[int(m["vstart"] * 100): int(m["end"] * 100) + 1] if int(m["end"] * 100) + 1 > int(m["vstart"] * 100) else [0])) >= 0.1
                  for m in sounding)
    coverage = covered / max(1, len(sounding))
    return {"path": str(path), "morae": ms, "heads": heads, "pauses": pauses,
            "medMidi": float(hz2midi(med)), "score": score, "coverage": coverage, "method": method, "agree": agree, "text": keep or text}


def set_notes(c, center):
    """モーラ → 音符（pos は台詞頭からの16分、拍頭始まり）。"""
    ms = c["morae"]
    base = center
    if len(ms) == 1:
        sts = [m["st"] for m in ms if m["st"] is not None]
        n = int(np.clip(round((ms[-1]["end"] - ms[0]["vstart"]) / SIX), 2, 16))
        return [{"pos": 0, "len": n, "pitch": base + (np.median(sts) if sts else 0), "mora": c["text"],
                 "src": (ms[0]["start"], ms[0]["vstart"], ms[-1]["end"]), "st": None}]
    out, pos, prev = [], 0, None
    for i, m in enumerate(ms):
        lead = m["mora"] in ("cl", "N") or (i > 0 and m["mora"] in "aiueo" and ms[i - 1]["vowel"] == m["vowel"])
        if i > 0 and i in c["heads"] and not lead:
            nxt = math.ceil(pos / BEAT) * BEAT
            if nxt > pos:
                if i in c["pauses"] or not out or out[-1]["pitch"] is None:
                    pass  # 休符で埋める
                else:
                    out[-1]["len"] += nxt - pos  # 前の音を伸ばす
                pos = nxt
        if m["vowel"] == "cl":
            pitch = None
        elif m["st"] is not None:
            pitch = base + m["st"]
        else:
            pitch = prev if prev is not None else base  # 無声化など: 前の音のまま
        out.append({"pos": pos, "len": 1, "pitch": pitch, "mora": m["mora"],
                    "src": (m["start"], m["vstart"], m["end"]), "st": m["st"]})
        if pitch is not None:
            prev = pitch
        pos += 1
    # 最後の音は次の拍頭まで（最低2個）
    last = [n for n in out if n["pitch"] is not None][-1]
    end = max(last["pos"] + 2, math.ceil((last["pos"] + 1) / BEAT) * BEAT)
    last["len"] = end - last["pos"]
    return [n for n in out if n["pitch"] is not None]


def scale_step(q, root, up):
    """q から音階で1つ上（下）の音。"""
    k = q + (1 if up else -1)
    while compose_quotes3.snap(k, root) != k:
        k += 1 if up else -1
    return k


def quantize_contour(notes, root):
    """音階へ丸め、元の抑揚の上下（0.5半音以上の動き）と横ばいを丸めた後も保つ。"""
    prev = None
    for n in notes:
        q = float(compose_quotes3.snap(n["pitch"], root))
        if prev is not None and n["st"] is not None and prev["st"] is not None:
            d = n["st"] - prev["st"]
            pq = prev["pitch"]
            if d >= 0.5 and q <= pq:
                q = scale_step(pq, root, True)
            elif d <= -0.5 and q >= pq:
                q = scale_step(pq, root, False)
            elif abs(d) < 0.5:
                q = pq
        n["pitch"] = q
        prev = n


def make_layout(sections):
    def layout():
        cache = {}
        for _, items in sections:
            for folder, num, text, keep, _rep in items:
                key = (folder, num, text, keep)
                if key not in cache:
                    path = folder if num is None else compose_quotes3.find(folder, num)
                    cache[key] = clip_data(path, text, keep)
        center = float(np.median([c["medMidi"] for c in cache.values()]))
        for c in cache.values():
            c["notes"] = set_notes(c, center)
        entries, secs, cursor = [], [], 0
        for label, items in sections:
            start = math.ceil(cursor / BAR) * BAR
            cursor = start
            for folder, num, text, keep, rep in items:
                c = cache[(folder, num, text, keep)]
                ln = c["notes"][-1]["pos"] + c["notes"][-1]["len"]
                for _ in range(rep):
                    cursor = math.ceil(cursor / BEAT) * BEAT
                    entries.append({"clip": c, "at": cursor, "sec": label})
                    cursor += ln + 2  # 次の拍頭まで（1拍の間）
            n = max(1, math.ceil((cursor - start) / BAR))
            if label.startswith("hook"):
                n += n % 2
            if label == "build":
                n = 1
            if label == "end":
                n = 3
            secs.append({"label": label, "bar0": start // BAR, "bars": n})
            cursor = start + n * BAR
        root = compose_quotes3.choose_key([n["pitch"] for e in entries for n in e["clip"]["notes"]])
        for c in cache.values():
            quantize_contour(c["notes"], root)
        layout.cache = cache
        layout.entries = entries
        return entries, secs
    return layout


def measure(cache, entries):
    heads_on = heads_tot = 0
    move_ok = move_tot = stay_ok = stay_tot = 0
    for c in cache.values():
        notes = c["notes"]
        idx = {n["src"]: n for n in notes}
        for i, m in enumerate(c["morae"]):
            n = idx.get((m["start"], m["vstart"], m["end"]))
            lead = m["mora"] in ("cl", "N") or (m["mora"] in "aiueo" and c["morae"][i - 1]["vowel"] == m["vowel"])
            if n and i in c["heads"] and i > 0 and not lead:
                heads_tot += 1
                heads_on += n["pos"] % BEAT == 0
        root = measure.root
        seq = [(n["st"], compose_quotes3.snap(n["pitch"], root)) for n in notes if n["st"] is not None]
        for (a, pa), (b, pb) in zip(seq, seq[1:]):
            d = b - a
            if abs(d) >= 0.5:
                move_tot += 1
                move_ok += np.sign(pb - pa) == np.sign(d)
            else:
                stay_tot += 1
                stay_ok += pb == pa
    return {
        "phraseHeadOnBeat": round(heads_on / max(1, heads_tot), 3), "phraseHeads": heads_tot,
        "contourMoveSameDir": round(move_ok / max(1, move_tot), 3), "moves": move_tot,
        "contourStaySame": round(stay_ok / max(1, stay_tot), 3), "stays": stay_tot,
    }


def run(sections, outdir):
    lay = make_layout(sections)
    compose_quotes3.layout = lay
    sys.argv = ["x", str(outdir)]
    compose_quotes3.main()
    info_path = Path(outdir) / "song.json"
    info = json.loads(info_path.read_text(encoding="utf-8"))
    # 曲と同じ調（main と同じく配置後の全音符から選ぶ）
    pitches = [n["pitch"] for e in lay.entries for n in e["clip"]["notes"]]
    measure.root = compose_quotes3.choose_key(pitches)
    info["measure"] = measure(lay.cache, None)
    info["clips"] = [{"text": c["text"], "alignScore": round(c["score"], 2), "coverage": round(c["coverage"], 2), "method": c["method"], "agree": round(c["agree"], 2), "notes": len(c["notes"])}
                     for c in lay.cache.values()]
    info_path.write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(info["measure"], ensure_ascii=False))
