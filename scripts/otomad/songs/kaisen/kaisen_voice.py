"""海鮮リスペクトの伴奏に淫夢の台詞を載せる（使い捨て）。

台詞の配置（強い音節を拍頭へ・不均一な伸縮）は inmu_v3 と同じ。置き場所（半小節の頭）と台詞ごとの移調は、
伴奏の和音（ベース・和音トラックの音名）に合うものを選ぶ。
python -I kaisen_voice.py <kaisen.json> <kaisen_inst.wav> <outdir>
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

import inmu_v1 as M  # noqa: E402
import inmu_v3 as V  # noqa: E402

FS = 44100
STEPS_BAR = 192
HARMONY_TRACKS = ("4", "5", "7", "8", "9")  # ベース2本・和音/エレピ

# 半小節ごとに置き続けるループの台詞（長さを16分7個以内に収める）
LOOP_KEYS = None
LOOP_LMAX = 7
NO_DELAY = False  # True なら台詞を次の半小節頭に必ず置く（和音のために後ろへずらさない）


def is_loop(key):
    return key in (LOOP_KEYS if LOOP_KEYS is not None else {K(M.YARI)})


# (区間の開始小節[1始まり], 終わり小節, 台詞と回数)
K = V.K
PLAN = [
    (9, 12, [(K(M.NUA), 1)]),
    (13, 16, [(K(M.OSS), 1)]),
    (17, 24, [(K(M.OKUJO), 1), (K(M.AGE), 1), (K(M.GAKU), 1)]),
    (25, 32, [(K(M.YARI), 12), (K(M.JAKEN), 1)]),
    (33, 40, [(K(M.OKANO), 1), (K(M.FA), 2), (K(M.SOUDAYO), 1), (K(M.MITOKE), 1), (K(M.AKUSHIRO), 1)]),
    (41, 48, [(K(M.YARI), 12), (K(M.JAKEN), 1)]),
    (57, 64, [(K(M.YARI), 12), (K(M.JAKEN), 1)]),
    (65, 72, [(K(M.YARI), 12), (K(M.JAKEN), 1)]),
    (73, 76, [(K(M.SUKI), 1)]),
]


def harmony_grid(song, n16):
    """16分ごとの伴奏の音名の重み（鳴っている音を音価で数え、16分ごとに正規化）。"""
    H = np.zeros((n16, 12))
    step16 = STEPS_BAR // 16
    for t in HARMONY_TRACKS:
        for x in song["tracks"].get(t, []):
            a = x["start"] // step16
            b = max(a + 1, (x["start"] + x["dur"]) // step16)
            pc = int(round(x["midi"])) % 12
            w = 1.5 if t in ("4", "5") else 1.0  # ベースは和音の根として重め
            H[a:min(b, n16), pc] += w
    s = H.sum(1, keepdims=True)
    return H / np.where(s > 0, s, 1)


def fit_score(c, at16, t, H):
    """台詞を 16分位置 at16 に移調 t で置いたときの、声の音名と伴奏の重なり（音価重み）。"""
    pos = c["pos"]
    sc = 0.0
    for i, mi in enumerate(c["midi"]):
        if not np.isfinite(mi):
            continue
        a = at16 + int(pos[i])
        w = (pos[i + 1] - pos[i]) if i + 1 < len(pos) else 2
        if a >= len(H):
            return -1e9
        pc = int(round(mi + t)) % 12
        h = H[a:a + max(1, int(w))].mean(0)
        # 構成音なら加点、強く鳴っている音の半音隣なら減点
        clash = max(h[(pc + 1) % 12], h[(pc - 1) % 12])
        sc += w * (h[pc] - 0.6 * clash)
    return sc - 0.05 * abs(t) * len(pos)


def main():
    song = json.load(open(sys.argv[1], encoding="utf-8"))
    inst_path, outdir = sys.argv[2], Path(sys.argv[3])
    outdir.mkdir(parents=True, exist_ok=True)
    bpm = song["bpm"]
    V.SIX = 15 / bpm  # inmu_v3 の配置 DP をこのテンポで回す
    six = V.SIX
    cache = V.load_clips()
    for key, c in cache.items():
        c["pos"] = V.place(c, lmax=LOOP_LMAX) if is_loop(key) else V.place(c)
    n16 = int(np.ceil(max(x["start"] + x["dur"] for ns in song["tracks"].values() for x in ns) / (STEPS_BAR // 16))) + 16
    H = harmony_grid(song, n16)
    # 台詞ごとの基準の移調（調の音階に最も合う値）。置くたびの移調はここから半音単位でだけ動かす
    root, mode = V.choose_key(H.sum(0))
    sc = V.scale_set(root, mode)
    base_tr = {}
    for key, c in cache.items():
        w = np.diff(np.append(c["pos"], c["pos"][-1] + 2)).astype(float)
        base_tr[key] = V.best_transpose(c["midi"], w, sc)

    placed = []
    cur = 0
    for bar0, bar1, items in PLAN:
        cur = max(cur, (bar0 - 1) * 16)
        end = bar1 * 16
        for key, rep in items:
            c = cache[key]
            ln = int(c["pos"][-1]) + max(2, 4 - int(c["pos"][-1]) % 4)
            if is_loop(key):
                ln = LOOP_LMAX
            for _ in range(rep):
                best = None
                start = math.ceil(cur / 8) * 8
                slots = (start,) if is_loop(key) or NO_DELAY else (start, start + 8)  # ループは半小節ごとに必ず
                for at in slots:
                    if at + ln > end + 8:
                        continue
                    for t in base_tr[key] + np.arange(-2, 3):
                        s = fit_score(c, at, t, H) - (0.3 if at > start else 0)
                        if best is None or s > best[0]:
                            best = (s, at, t)
                if best is None:
                    break
                _, at, t = best
                placed.append({"key": key, "at": at, "tr": float(t)})
                cur = at + ln + 1

    inst, sr = librosa.load(inst_path, sr=FS, mono=False)
    N = inst.shape[1]
    voice = np.zeros(N)
    notes = []
    rendered = {}
    for p in placed:
        c = cache[p["key"]]
        k = (p["key"], p["tr"])
        if k not in rendered:
            rendered[k] = V.render_voice(c["path"], c["on"], c["pos"] * six, 2 ** (p["tr"] / 12), c["snd"][-1]["end"])
        x, d0 = rendered[k]
        V.add(voice, x, p["at"] * six + d0)
        for i, mi in enumerate(c["midi"]):
            if np.isfinite(mi):
                w = (c["pos"][i + 1] - c["pos"][i]) if i + 1 < len(c["pos"]) else 2
                notes.append((p["at"] + int(c["pos"][i]), int(w), float(mi + p["tr"]), float(c["strength"][i])))
                p.setdefault("notes", []).append([p["at"] + int(c["pos"][i]), int(w), float(mi + p["tr"])])
    voice = voice / (np.abs(voice).max() + 1e-9)
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)
    np.save(outdir / "notes.npy", np.array(notes))
    np.save(outdir / "harmony16.npy", H)
    info = {
        "bpm": bpm,
        "key": f"{V.NAMES[root]} {mode}",
        "baseTranspose": {cache[k]["text"]: v for k, v in base_tr.items()},
        "placed": [{"text": cache[p["key"]]["text"], "bar": round(p["at"] / 16 + 1, 2), "transpose": p["tr"], "who": Path(cache[p["key"]]["path"]).parent.name, "notes": p.get("notes", [])} for p in placed],
    }
    (outdir / "placement.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print("placed", len(placed))


if __name__ == "__main__":
    main()
