"""2号兄貴の自作曲MADの台詞の扱いを測る（使い捨て）。

python -I nigo_mad_analyze.py <id> ...   （ana_demucs/htdemucs/<id>/vocals.wav, no_vocals.wav を読む）
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

import librosa  # noqa: E402
import numpy as np  # noqa: E402

SR = 22050
HOP = 256
HERE = paths.WORK


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-9))


def events(v_rms, thr, min_gap=6, min_len=4):
    on = v_rms > thr
    ev, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (j + min_gap < n and on[j:j + min_gap].any())):
                j += 1
            if j - i >= min_len:
                ev.append((i, j))
            i = j
        else:
            i += 1
    return ev


def chord_quality(acc, beats):
    """2拍ごとのクロマに三和音・セブンスの型を当て、セブンスが勝つ割合。"""
    ch = librosa.feature.chroma_cqt(y=acc, sr=SR, hop_length=HOP)
    tri = {"maj": [0, 4, 7], "min": [0, 3, 7]}
    sev = {"M7": [0, 4, 7, 11], "m7": [0, 3, 7, 10], "7": [0, 4, 7, 10], "m7b5": [0, 3, 6, 10]}
    wins, n7 = 0, 0
    for a, b in zip(beats[:-2:2], beats[2::2]):
        c = ch[:, a:b].mean(axis=1)
        c = c / (np.linalg.norm(c) + 1e-9)

        def best(tpls):
            s = -1
            for iv in tpls.values():
                for r in range(12):
                    t = np.zeros(12)
                    t[[(r + k) % 12 for k in iv]] = 1
                    s = max(s, float(c @ (t / np.linalg.norm(t))))
            return s
        st, s7 = best(tri), best(sev)
        wins += 1
        # 4音目がはっきり鳴るときだけセブンス（三和音の型との差で判定）
        n7 += s7 > st + 0.02
    return round(n7 / max(1, wins), 2)


def analyze(sid):
    d = HERE / "ana_demucs" / "htdemucs" / sid
    voc, _ = librosa.load(d / "vocals.wav", sr=SR)
    acc, _ = librosa.load(d / "no_vocals.wav", sr=SR)
    n = min(len(voc), len(acc))
    voc, acc = voc[:n], acc[:n]
    dur = n / SR

    oenv = librosa.onset.onset_strength(y=acc, sr=SR, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=SR, hop_length=HOP, start_bpm=145, tightness=400)
    tempo = float(np.atleast_1d(tempo)[0])
    bt = librosa.frames_to_time(beats, sr=SR, hop_length=HOP)
    # 16分の格子（拍の間を4等分）
    grid = np.concatenate([np.linspace(a, b, 4, endpoint=False) for a, b in zip(bt[:-1], bt[1:])])
    six = float(np.median(np.diff(bt))) / 4

    vr = librosa.feature.rms(y=voc, hop_length=HOP)[0]
    ar = librosa.feature.rms(y=acc, hop_length=HOP)[0]
    thr = np.percentile(vr, 99) * 10 ** (-28 / 20)
    ev = events(vr, thr)
    t = lambda f: f * HOP / SR  # noqa: E731
    starts = np.array([t(a) for a, _ in ev])
    lens = np.array([t(b - a) for a, b in ev])
    active = vr > thr

    # 台詞の立ち上がり（声の stem の onset）を 16分格子と拍に対して
    von = librosa.onset.onset_detect(y=voc, sr=SR, hop_length=HOP, units="time", backtrack=False)
    von = np.array([o for o in von if active[min(len(active) - 1, int(o * SR / HOP))]])
    inside = (von > bt[0]) & (von < bt[-1])
    von = von[inside]
    gi = np.searchsorted(grid, von)
    gi = np.clip(gi, 1, len(grid) - 1)
    near = np.where(np.abs(von - grid[gi - 1]) < np.abs(von - grid[gi]), gi - 1, gi)
    err = (von - grid[near]) / six
    phase = near % 4  # 0 = 拍頭
    ev_st = starts[(starts > bt[0]) & (starts < bt[-1])]
    ei = np.clip(np.searchsorted(grid, ev_st), 1, len(grid) - 1)
    enear = np.where(np.abs(ev_st - grid[ei - 1]) < np.abs(ev_st - grid[ei]), ei - 1, ei)

    # 同じ断片の連打（チョップ）: 隣り合う発話の MFCC が近く、間隔が16分か8分の倍数
    mf = librosa.feature.mfcc(y=voc, sr=SR, hop_length=HOP, n_mfcc=20)
    vec = [mf[:, a:min(b, a + 8)].mean(axis=1) for a, b in ev]
    rep = 0
    for k in range(1, len(ev)):
        a, b = vec[k - 1], vec[k]
        cs = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        ioi = (starts[k] - starts[k - 1]) / six
        if cs > 0.97 and abs(ioi - round(ioi)) < 0.25 and round(ioi) <= 4:
            rep += 1

    # 音高: 声の f0 が半音格子に乗るか・平らか
    f0, vf, _ = librosa.pyin(voc, fmin=70, fmax=900, sr=SR, hop_length=HOP, frame_length=2048)
    m = librosa.hz_to_midi(np.where(vf & active[:len(vf)], f0, np.nan))
    mm = m[np.isfinite(m)]
    best = min(((np.mean(np.abs(((mm * 100 - o + 50) % 100) - 50)), o) for o in range(-50, 50)), default=(np.nan, 0))
    dev = ((mm * 100 - best[1] + 50) % 100) - 50
    plat, tot = 0, 0
    for i in range(len(m) - 4):
        w = m[i:i + 4]
        if np.isfinite(w).all():
            tot += 1
            plat += np.ptp(w) < 0.15
    # 調: 伴奏のクロマの合計
    chs = librosa.feature.chroma_cqt(y=acc, sr=SR, hop_length=HOP).sum(axis=1)
    pcs_voice = np.bincount((np.round(mm - best[1] / 100).astype(int)) % 12, minlength=12) / max(1, len(mm))
    top5 = np.argsort(chs)[-5:]
    top7 = np.argsort(chs)[-7:]

    # 声が鳴っている間の 声−伴奏 の音量差
    lv = db(vr[active].mean()) - db(ar[:len(vr)][active].mean()) if active.any() else np.nan
    # 4小節ごとの声の占有
    bar4 = 16 * 4 * six
    occ4 = [float(active[int(s * SR / HOP):int((s + bar4) * SR / HOP)].mean()) for s in np.arange(bt[0], bt[-1] - bar4, bar4)]

    return {
        "id": sid, "seconds": round(dur, 1), "bpm": round(tempo, 1),
        "voiceOccupancy": round(float(active.mean()), 3),
        "events": len(ev), "eventsPerBar": round(len(ev) / (dur / (16 * six)), 2),
        "eventLenSixteenths": {"p25": round(float(np.percentile(lens / six, 25)), 1), "p50": round(float(np.median(lens / six)), 1), "p75": round(float(np.percentile(lens / six, 75)), 1)},
        "shortEventsUnder2_16th": round(float(np.mean(lens / six < 2)), 2),
        "onsetsWithinQuarter16th": round(float(np.mean(np.abs(err) < 0.25)), 2),
        "onsetPhaseShare": [round(float(np.mean(phase == k)), 2) for k in range(4)],
        "eventStartPhaseShare": [round(float(np.mean(enear % 4 == k)), 2) for k in range(4)],
        "repeatedChops": rep, "repeatedChopShare": round(rep / max(1, len(ev) - 1), 2),
        "pitchMeanAbsCents": round(float(best[0]), 1), "pitchWithin15c": round(float(np.mean(np.abs(dev) < 15)), 2),
        "pitchPlateau46ms": round(plat / max(1, tot), 2),
        "voiceInAccTop5": round(float(pcs_voice[top5].sum()), 2), "voiceInAccTop7": round(float(pcs_voice[top7].sum()), 2),
        "voiceMinusAccDb": round(float(lv), 1),
        "voiceOcc4bars": [round(x, 2) for x in occ4],
        "seventhShare2beat": chord_quality(acc, beats),
    }


if __name__ == "__main__":
    out = [analyze(s) for s in sys.argv[1:]]
    p = HERE / "nigo_mad.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in out:
        print(json.dumps({k: v for k, v in r.items() if k != "voiceOcc4bars"}, ensure_ascii=False))
        print("  occ4", r["voiceOcc4bars"])
