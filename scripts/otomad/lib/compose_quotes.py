"""エア本の語録だけで組む試作2（使い捨て）。

python -I compose_quotes.py <outdir>
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

from align import align  # noqa: E402
from align import morae_from_text  # noqa: E402
from align_batch import pitch_morae  # noqa: E402
from compose_song import (  # noqa: E402
    BAR, FS, LOOPS, SIX, add, choose_key, choose_loop, env, hat, kick, lowpass,
    midi2hz, render_clip, saw, snap, snare, square, to_notes,
)

ROOT = (paths.MATERIAL / "エア本/エア本さんスターターセット")
S2 = ROOT / "すばわが2(エア本さん)"
CH = ROOT / "痴呆との遭遇"

# (フォルダ, 番号, 整列に使う台詞, 残す部分 or None, 繰り返し, ドラム)。"|" は2小節頭へ送る。
PLAN = [
    (S2, 1, "んーーーー", None, 1, False),
    (S2, 2, "ワンツーワンツースリー", None, 1, False),
    "|",
    (S2, 44, "もしもしっ！って言って", "もしもしっ", 2, True),
    (S2, 46, "あたしねぇって信心したのよ！って言われたんです", "あたしねぇって信心したのよ", 1, True),
    (S2, 48, "もう受話器持ってイエエエエ！みたいな", "もう受話器持ってイエエエエ", 1, True),
    (S2, 56, "もうダブルオドロキですよね", "もうダブルオドロキ", 2, True),
    (S2, 58, "あのっ！？っていうくらい", "あのっ", 2, True),
    "|",
    (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ", None, 1, True),
    (S2, 4, "ふー", None, 1, True),
    "|",
    (S2, 62, "この信心はねって", "この信心はね", 1, True),
    (S2, 63, "自分が自分らしく輝いていく仏法なんだよ！って言われたんです", "自分が自分らしく輝いていく仏法なんだよ", 1, True),
    (S2, 65, "グサッってきましてね", "グサッ", 2, True),
    (S2, 84, "絶対なれる！っていうに仰っていただいて", "絶対なれる", 2, True),
    (S2, 26, "やったるムンムンカマしたらぁー！みたいな気持ちで来たんですけどもね", "やったるムンムンカマしたらぁー", 1, True),
    "|",
    (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ", None, 1, True),
    (S2, 4, "ふー", None, 1, True),
    "|",
    (S2, 128, "ルネッサンスおめでとー！っていうことであの", "ルネッサンスおめでとー", 1, True),
    (S2, 132, "面白かったねー！って", "面白かったねー", 2, True),
    (S2, 5, "はぁい、私エアリスジェラルドハニー", None, 1, True),
    (CH, 229, "マハーロー、マハーロー", None, 1, True),
    (CH, 218, "みんな、高等精神病です今", None, 1, True),
    "|",
    (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ", None, 1, True),
    (S2, 4, "ふー", None, 1, True),
    (S2, 3, "シャバダバッタバ、シャバダバッタバ、シャバダバッタバ", None, 1, True),
    (S2, 4, "ふー", None, 1, True),
    "|",
    (S2, 135, "パーン！ってなりましたね頭が", None, 1, True),
]


def find(folder, num):
    return next(p for p in folder.glob("*.wav") if p.name.lstrip().split(" ")[0] == str(num))


def main():
    outdir = Path(sys.argv[1])
    outdir.mkdir(parents=True, exist_ok=True)
    cache = {}
    entries, cursor = [], 0
    for e in PLAN:
        if e == "|":
            cursor = math.ceil(cursor / BAR) * BAR
            continue
        folder, num, text, keep, rep, drums = e
        path = find(folder, num)
        key = (str(path), text, keep)
        if key not in cache:
            r = pitch_morae(str(path), align(str(path), text))
            if keep:
                r["morae"] = r["morae"][: len(morae_from_text(keep))]
            ms = r["morae"]
            if np.mean([m["score"] for m in ms]) < 0.15:
                # 整列が信用できない（叫び・伸ばしだけ）: 1つの長い音として扱う
                sts = [m["st"] for m in ms if m.get("st") is not None]
                r["morae"] = [{**ms[0], "end": ms[-1]["end"], "mora": keep or text,
                               "st": float(np.median(sts)) if sts else None, "score": ms[0]["score"]}]
            notes = to_notes(r)
            cache[key] = {"path": str(path), "notes": notes, "text": keep or text,
                          "score": float(np.mean([m["score"] for m in r["morae"]]))}
        c = cache[key]
        ln = c["notes"][-1]["pos"] + c["notes"][-1]["len"]
        unit = math.ceil(ln / 8) * 8
        cursor = math.ceil(cursor / 8) * 8
        for i in range(rep):
            entries.append({"clip": c, "at": cursor + i * unit, "drums": drums})
        cursor += unit * rep
    bars = math.ceil(cursor / BAR) + 1

    timeline = [{**n, "pos": n["pos"] + e["at"]} for e in entries for n in e["clip"]["notes"]]
    root = choose_key([n["pitch"] for n in timeline if n["pitch"] is not None])
    loop, fit = choose_loop(timeline, root)
    chords = LOOPS[loop]

    total = bars * BAR * SIX + 2
    voice = np.zeros(int(total * FS))
    rendered = {}
    for e in entries:
        k = id(e["clip"])
        if k not in rendered:
            rendered[k] = render_clip(e["clip"]["path"], e["clip"]["notes"], root)
        add(voice, rendered[k], e["at"] * SIX)
    voice /= np.abs(voice).max() + 1e-9

    drum_from = min(e["at"] for e in entries if e["drums"])
    end_at = entries[-1]["at"]  # 「パーン」で止める
    drums = np.zeros_like(voice)
    bass = np.zeros_like(voice)
    pad = np.zeros_like(voice)
    lead = np.zeros_like(voice)
    duck = np.ones_like(voice)
    K, S, H = kick(), snare(), hat()
    for b in range(bars):
        ch = chords[b % 2]
        for s in range(BAR):
            st = b * BAR + s
            at = st * SIX
            if st == end_at:
                add(drums, 1.2 * K, at)
                add(drums, S, at)
            if not (drum_from <= st < end_at):
                continue
            if s % 4 == 0:
                add(drums, K, at)
                d = int(at * FS)
                w = duck[d : d + int(0.12 * FS)]
                w[:] = np.minimum(w, np.linspace(0.3, 1, int(0.12 * FS))[: len(w)])
            if s in (4, 12):
                add(drums, 0.7 * S, at)
            add(drums, (0.35 if s % 2 else 0.2) * H, at)
            if s % 2 == 0:
                n = int(SIX * 2 * FS * 0.9)
                add(bass, lowpass(saw(midi2hz(root - 12 + ch[0] % 12), n), 0.08) * env(n, 0.003, 0.2), at)
        n = int(BAR * SIX * FS)
        if b * BAR <= end_at:
            for c in ch:
                add(pad, saw(midi2hz(root + c), n, 0.004) * np.minimum(1, np.arange(n) / (0.05 * FS)), b * BAR * SIX)
    pad = lowpass(pad, 0.05) * duck
    for n in timeline:
        if n["pitch"] is None:
            continue
        ln = int(n["len"] * SIX * FS * 0.95)
        add(lead, square(midi2hz(snap(n["pitch"], root) + 12), ln) * env(ln, 0.003, 0.3), n["pos"] * SIX)
    lead = lowpass(lead, 0.15)

    def nrm(x):
        return x / (np.abs(x).max() + 1e-9)

    mix = 0.85 * voice + 0.55 * nrm(drums) + 0.4 * nrm(bass) + 0.18 * nrm(pad) + 0.12 * nrm(lead)
    mix = np.tanh(1.2 * mix) / np.tanh(1.2)
    sf.write(outdir / "song.wav", (0.9 * nrm(mix)).astype(np.float32), FS)
    sf.write(outdir / "voice.wav", (0.9 * voice).astype(np.float32), FS)

    import librosa
    info = {
        "key": librosa.midi_to_note(root, unicode=False) + " major",
        "loop": loop,
        "chordToneFit": round(fit, 3),
        "bars": bars,
        "seconds": round(bars * BAR * SIX, 1),
        "layout": [
            {"bar": round(e["at"] / BAR + 1, 2), "text": e["clip"]["text"], "alignScore": round(e["clip"]["score"], 2)}
            for e in entries
        ],
    }
    (outdir / "song.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
