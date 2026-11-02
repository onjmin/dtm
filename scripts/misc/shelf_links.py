"""棚（見返しページ）どうしを行き来するリンクの帯。Python の棚の build が読む（song-shelf.ts は同じものを TS で持つ）。

棚の場所は各 build と同じ決まり（環境変数か、リポジトリ直下の .env）。リンクは書き出すページから見た相対パスなので、
file:// で開いたときに通る。まだ書き出されていない棚はリンクにせず「まだ無い」と出す。

  import shelf_links
  html = shelf_links.inject(html, <書き出すページのパス>)   # <aside> の頭に帯を入れる
"""
import html as h
import os
from pathlib import Path
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[2]


def _env(key):
    if os.environ.get(key):
        return os.environ[key]
    env = REPO / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            k, sep, v = line.strip().partition("=")
            if sep and k.strip() == key:
                return v.strip().strip('"').strip("'")
    return None


def shelves():
    """(名前, index.html のパス)。並びは作曲 → 台詞作曲 → 音MAD の試作 → 動画。"""
    speech = Path(_env("SPEECH_OUT_DIR") or REPO / "scratch" / "speech-songs")
    work = Path(_env("OTOMAD_WORK") or REPO / "scratch" / "speech-melody")
    return [
        ("曲", REPO / "tmp" / "songs" / "index.html"),
        ("台詞作曲", speech / "shelf" / "index.html"),
        ("台詞作曲の試作", work / "shelf" / "index.html"),
        ("BB劇場・音MADの動画", REPO / "scratch" / "videos" / "index.html"),
    ]


def nav_html(current):
    current = Path(current).resolve()
    parts = []
    for name, p in shelves():
        p = p.resolve()
        if p == current:
            parts.append(f'<b aria-current="page">{h.escape(name)}</b>')
        elif p.exists():
            try:
                href = quote(Path(os.path.relpath(p, current.parent)).as_posix(), safe="/.")
            except ValueError:  # 別のドライブ
                href = p.as_uri()
            parts.append(f'<a href="{href}" style="color:var(--accent,inherit)">{h.escape(name)}</a>')
        else:
            parts.append(f'<span style="color:var(--muted)" title="まだ書き出されていない: {h.escape(str(p))}">{h.escape(name)}</span>')
    return ('<nav aria-label="棚" style="display:flex;flex-wrap:wrap;gap:2px 12px;margin:0 16px 14px;padding-bottom:10px;'
            'border-bottom:1px solid var(--line);font-size:12px">' + "".join(parts) + "</nav>")


def inject(page, current):
    return page.replace("<aside>", "<aside>" + nav_html(current), 1)
