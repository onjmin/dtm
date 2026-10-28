"""書き出した曲を聴き返すページ SPEECH_OUT_DIR/shelf/index.html を作る（素材の音声を含むので手元だけで開く）。

SPEECH_OUT_DIR の下の、song.wav がある曲フォルダを全部載せる。表示は各曲の meta.json（title, material, accomp, verdict）、
小節ごとの台詞は placement.json、測定は check.json から。見た目は scripts/misc/song-shelf.html と同じ。
python shelf_build.py → rec/server.mjs で http://localhost:40321/shelf/index.html
"""
import json
from datetime import datetime
from pathlib import PureWindowsPath  # 区切りが / でも \ でも読める
from zoneinfo import ZoneInfo

import soundfile as sf

import config

MODEL = "Claude"  # 一覧に出す作り手。meta.json の model で上書きできる


def read(p):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def main():
    songs = []
    for d in sorted(p for p in config.OUT_DIR.iterdir() if p.is_dir()):
        wav = d / "song.wav"
        if not wav.exists():
            continue
        meta, pl = read(d / "meta.json"), read(d / "placement.json")
        info = sf.info(str(wav))
        facts = {"bpm": pl.get("bpm"), "key": pl.get("key"), "bars": pl.get("bars"),
                 "seconds": round(info.frames / info.samplerate, 1)}
        if pl.get("progression"):
            facts["progression"] = pl["progression"]
        rows = [{"bar": p["bar"], "text": p["text"], "who": p.get("who") or PureWindowsPath(p.get("file", "")).parent.name,
                 "path": p.get("file", "（不明）"), "transpose": p.get("transpose")} for p in pl.get("placed", [])]
        songs.append({
            "id": d.name, "title": meta.get("title", d.name), "model": meta.get("model", MODEL),
            "at": datetime.fromtimestamp(wav.stat().st_mtime, ZoneInfo("Asia/Tokyo")).strftime("%Y-%m-%d %H:%M"),
            "material": meta.get("material", ""), "accomp": meta.get("accomp", ""), "verdict": meta.get("verdict", "評価なし"),
            "audio": f"../{d.name}/song.wav", "voice": f"../{d.name}/voice.wav" if (d / "voice.wav").exists() else None,
            "facts": facts, "rows": rows, "rowsSource": "書き出し時の記録（placement.json）" if rows else "記録なし",
            "check": read(d / "check.json") or None,
        })
    songs.sort(key=lambda x: x["at"], reverse=True)  # 一覧は新しい曲が上
    tpl = (config.HERE / "shelf_template.html").read_text(encoding="utf-8")
    out = config.OUT_DIR / "shelf" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    # </script> を閉じさせない
    out.write_text(tpl.replace("/*SONGS*/[]", json.dumps(songs, ensure_ascii=False).replace("</", "<\\/")), encoding="utf-8")
    print(out, len(songs), "songs")


if __name__ == "__main__":
    main()
