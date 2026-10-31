"""サムソン素材の台詞イントネーション作曲（作者ももも味の手順。method.md 冒頭）。使い捨て。

1. 台詞合わせ: 強い音節を拍頭へ置く不均一な伸縮（inmu_v3.place）。台詞は半小節頭から。
2. 音程: 台詞ごとに音域を整える移調（±3 半音まで）→ モーラごとに音の中心だけを、
   フックの台詞の最後の音を主音にしたマイナーペンタへ寄せる（モーラ内の揺れは残す）。上下の向きは保つ。
3. 採譜: 補正後の音を MIDI 音符にする（フックではリードで重ねる）。
4. 和音: 採譜した旋律から小節ごとに（自然短音階の三和音）。
出力: voice.wav（曲頭=0）、daw.json（DAW に書き込む各トラックの音符・テンポ・ドラム）、placement.json
python -I samson_build.py <outdir>
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyworld  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v3 as V  # noqa: E402
import samson_v1 as S  # noqa: E402

FS = 44100
BPM = 125
SIX = 15 / BPM
BAR = 16
K = V.K
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
HOOK_A, HOOK_B = S.KURUKURU, S.HICHEW


def hook(b0, b1, last=None):
    """4小節ごとに「くるくる → ハイチュウ」。最後の単位は「くるくる → 締め」。"""
    out = [(b, b + 3, [(K(HOOK_A), 1), (K(HOOK_B), 1)]) for b in range(b0, b1, 4)]
    if last:
        out[-1] = (out[-1][0], out[-1][1], [(K(HOOK_A), 1), (K(last), 1)])
    return out


PLAN = [
    (1, 2, [(K(S.DOIT), 1)]),
    (3, 4, [(K(S.HEREWEGO), 1)]),
    (5, 12, [(K(c), 1) for c in (S.KOWAI, S.MATTETE, S.MOUIKKAI, S.SENTI, S.AITATATA)]),
    *hook(13, 21, S.JACKIE),
    (21, 28, [(K(c), 1) for c in (S.DAMEDAME, S.PSYCHO, S.SUGOIYO, S.KANJI, S.STEINER, S.ZOU)]),
    *hook(29, 37, S.JACKIE),
    (37, 40, [(K(c), 1) for c in (S.AIIN, S.DOARA)]),
    *hook(41, 49, S.JACKIE),
    (49, 52, [(K(S.SAIKOU), 1), (K(S.GORILLA), 1)]),
]
HOOK_BARS = [(13, 20), (29, 36), (41, 48)]
TARGET_CENTER = 60.0  # 台詞の音域をそろえる中心（MIDI）


def pent_minor(root):
    return np.array([(root + s) % 12 for s in (0, 3, 5, 7, 10)])


def snap_to(m, pcs):
    cands = np.array([o * 12 + p for o in range(int(m // 12) - 1, int(m // 12) + 2) for p in pcs], float)
    return float(cands[np.argmin(np.abs(cands - m))])


def step_in(q, pcs, up):
    k = q + (1 if up else -1)
    while k % 12 not in pcs:
        k += 1 if up else -1
    return float(k)


def correct(midis, pcs):
    """モーラごとの音の中心を音階へ。元の上下（0.5 半音以上）と横ばいを保つ。"""
    out, prev = [], None
    for m in midis:
        if not np.isfinite(m):
            out.append(np.nan)
            continue
        q = snap_to(m, pcs)
        near = q
        if prev is not None:
            d = m - prev[0]
            if d >= 0.5 and q <= prev[1]:
                q = step_in(prev[1], pcs, True)
            elif d <= -0.5 and q >= prev[1]:
                q = step_in(prev[1], pcs, False)
            elif abs(d) < 0.5:
                q = prev[1]
        if abs(q - m) > 1.5:  # 補正は ±1.5 半音まで（向きを保てなくても近い音へ）
            q = near
        out.append(q)
        prev = (m, q)
    return np.array(out)


def render_voice(c, grid_t, ratios):
    """母音頭を格子へ写し、モーラごとに f0 を ratios[i] 倍（中心の補正）。揺れは原音のまま。"""
    y, _ = librosa.load(str(c["path"]), sr=FS, mono=True)
    y = y.astype(np.float64)
    f0, t = pyworld.harvest(y, FS, f0_floor=60, f0_ceil=800, frame_period=5.0)
    sp = pyworld.cheaptrick(y, f0, t, FS)
    ap = pyworld.d4c(y, f0, t, FS)
    fps = 200.0
    on = c["on"]
    # 原音側の各フレームがどのモーラに属するか（母音頭の手前は前のモーラの子音として次へ寄せる）
    ratio_src = np.ones(len(f0))
    bounds = list(on) + [on[-1] + 1.0]
    for i in range(len(on)):
        a = int(max(0, (bounds[i] - (0.06 if i == 0 else 0.04)) * fps))
        b = int((bounds[i + 1] - 0.04) * fps) if i + 1 < len(on) else len(f0)
        ratio_src[a:max(a, b)] = ratios[i]
    pre = min(0.15, on[0])
    src = [on[0] - pre] + list(on)
    dst = [grid_t[0] - pre] + list(grid_t)
    tail = max(0.05, min(0.6, c["snd"][-1]["end"] - on[-1]))
    hold = max(tail, (grid_t[-1] - grid_t[-2]) if len(grid_t) > 1 else tail)
    src.append(on[-1] + tail)
    dst.append(grid_t[-1] + hold)
    d0 = dst[0]
    nf = int((dst[-1] - d0) * fps) + 1
    ts = np.interp(d0 + np.arange(nf) / fps, dst, src)
    j = np.clip((ts * fps).astype(int), 0, len(f0) - 1)
    # 補正比のつなぎ目は 20ms でなめらかに
    r = ratio_src[j]
    r = np.convolve(np.log(r), np.ones(4) / 4, mode="same")
    out = pyworld.synthesize(f0[j] * np.exp(r), sp[j].copy(), ap[j].copy(), FS, 5.0)
    f = int(0.01 * FS)
    out[:f] *= np.linspace(0, 1, f)
    out[-3 * f:] *= np.linspace(1, 0, 3 * f)
    return out, d0


def harmonize(bar_notes, root, nbars):
    """自然短音階の三和音から、小節の旋律の音を一番多く含むもの（同じ和音の連続は少し減点）。"""
    steps = [0, 2, 3, 5, 7, 8, 10]
    sc = [(root + s) % 12 for s in steps]
    chords = [(sc[d], {sc[d], sc[(d + 2) % 7], sc[(d + 4) % 7]}, ["i", "ii°", "III", "iv", "v", "VI", "VII"][d]) for d in range(7)
              if d != 1]
    good = {("VI", "VII"), ("VII", "i"), ("i", "VI"), ("iv", "v"), ("v", "i"), ("III", "VII"), ("i", "iv"), ("VI", "III"),
            ("iv", "VII"), ("VII", "III"), ("i", "VII"), ("VII", "VI")}
    nc = len(chords)
    score = np.zeros(nc)
    back = np.zeros((nbars, nc), int)
    fits = np.zeros((nbars, nc))
    for b in range(nbars):
        for k, ch in enumerate(chords):
            fits[b, k] = sum(w * (2 if (int(m) % 12) in ch[1] else -0.5) for m, w in bar_notes.get(b, []))
    score = fits[0].copy()
    for b in range(1, nbars):
        new = np.empty(nc)
        for k in range(nc):
            cand = [score[i] + (0.8 if (chords[i][2], chords[k][2]) in good else 0) - (0.4 if i == k else 0)
                    for i in range(nc)]
            back[b, k] = int(np.argmax(cand))
            new[k] = max(cand) + fits[b, k]
        score = new
    path = [int(np.argmax(score))]
    for b in range(nbars - 1, 0, -1):
        path.append(back[b, path[-1]])
    return [chords[k] for k in reversed(path)]


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    import os
    os.environ.setdefault("ANCHOR", "1.0")  # この素材は子音・息が長いので母音頭を格子へ（測定で R16 0.05→0.46）
    V.SIX = SIX
    V.SECTIONS = [("all", [(K(c), 1) for c in S.ALL])]
    cache = V.load_clips()
    for key, c in cache.items():
        c["pos"] = V.place(c)
        mids = c["midi"]
        med = float(np.nanmedian(mids)) if np.isfinite(mids).any() else TARGET_CENTER
        c["tr"] = float(np.clip(round(TARGET_CENTER - med), -3, 3))  # 音域をそろえる移調（±3 まで）

    # 主音: フックの台詞（HICHEW）の最後の音
    hb = cache[K(HOOK_B)]
    last = [m for m in hb["midi"] if np.isfinite(m)][-1] + hb["tr"]
    root = int(round(last)) % 12
    pcs = pent_minor(root)
    for c in cache.values():
        c["q"] = correct(c["midi"] + c["tr"], pcs)

    # 置く: 台詞は半小節頭から、区間の頭は小節頭
    placed, cur = [], 0
    for b0, b1, items in PLAN:
        cur = max(cur, (b0 - 1) * BAR)
        for key, rep in items:
            c = cache[key]
            ln = int(c["pos"][-1]) + max(2, 4 - int(c["pos"][-1]) % 4)
            for _ in range(rep):
                at = math.ceil(cur / 8) * 8
                placed.append({"key": key, "at": at})
                cur = at + ln + 1
    nbars = max(PLAN[-1][1], math.ceil(cur / BAR)) + 2

    # 採譜と和音
    bar_notes, melody = {}, []
    for p in placed:
        c = cache[p["key"]]
        for i, q in enumerate(c["q"]):
            if not np.isfinite(q):
                continue
            pos = p["at"] + int(c["pos"][i])
            w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
            bar_notes.setdefault(pos // BAR, []).append((q, w))
            melody.append({"pos16": pos, "len16": int(min(w, 4)), "midi": q, "hook": any(a <= pos // BAR + 1 <= b for a, b in HOOK_BARS)})
    prog = harmonize(bar_notes, root, nbars)

    # 声
    N = int((nbars * BAR * SIX + 3) * FS)
    voice = np.zeros(N)
    rendered = {}
    for p in placed:
        c = cache[p["key"]]
        if p["key"] not in rendered:
            ratios = [2 ** ((q - m) / 12) if np.isfinite(q) and np.isfinite(m) else 2 ** (c["tr"] / 12)
                      for q, m in zip(c["q"], c["midi"])]
            rendered[p["key"]] = render_voice(c, c["pos"] * SIX, ratios)
        x, d0 = rendered[p["key"]]
        V.add(voice, x, p["at"] * SIX + d0)
    voice /= np.abs(voice).max() + 1e-9
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)

    # DAW のトラック（1小節=192 ステップ、16分=12）
    st = 12
    tracks = {"t0": [], "t4": [], "t7": [], "t6": []}
    for n in melody:
        if n["hook"]:
            tracks["t0"].append({"startStep": n["pos16"] * st, "durationSteps": n["len16"] * st - 2, "midi": int(n["midi"]) + 12})
    for b, (r, tones, _name) in enumerate(prog):
        if b >= nbars - 1:
            break
        for pc in sorted(tones):
            m = 55 + (pc - 55) % 12
            tracks["t7"].append({"startStep": b * 192, "durationSteps": 190, "midi": m})
            tracks["t6"].append({"startStep": b * 192, "durationSteps": 190, "midi": m + 12})
        for k in range(8):
            tracks["t4"].append({"startStep": b * 192 + k * 24, "durationSteps": 20, "midi": 36 + (r - 36) % 12 + (12 if k % 2 else 0)})
    daw = {"bpm": BPM, "drum": "four_clap_16hat", "bars": nbars, "tracks": tracks,
           "instruments": {"t0": "Lead 1 (square)", "t4": "Synth Bass 1", "t7": "Electric Piano 1", "t6": "Pad 2 (warm)"}}
    (outdir / "daw.json").write_text(json.dumps(daw), encoding="utf-8")
    info = {
        "bpm": BPM, "root": NAMES[root], "scale": "minor pentatonic", "bars": nbars,
        "progression": " ".join(name for _r, _t, name in prog),
        "placed": [{"bar": round(p["at"] / 16 + 1, 2), "text": cache[p["key"]]["text"], "who": Path(cache[p["key"]]["path"]).parent.name,
                    "transpose": cache[p["key"]]["tr"],
                    "correctionCents": [round(float((q - m) * 100)) for q, m in zip(cache[p["key"]]["q"], cache[p["key"]]["midi"] + cache[p["key"]]["tr"]) if np.isfinite(q) and np.isfinite(m)]}
                   for p in placed],
    }
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    np.save(outdir / "melody.npy", np.array([(n["pos16"], n["len16"], n["midi"]) for n in melody]))
    print("root", NAMES[root], "bars", nbars, "placed", len(placed))


if __name__ == "__main__":
    main()
