"""ニコニコのコメント（時刻つき）と説明文を取る（使い捨て）。視聴者が台詞を書き込むので、どこで何の台詞かの手がかりにする。

python nigo_mad_comments.py <id> ...  → refs/nigo/<id>.comments.json と nigo_mad_comments.txt
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

HERE = paths.WORK
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


lines = []
for sid in sys.argv[1:]:
    try:
        page = get(f"https://www.nicovideo.jp/watch/{sid}")
    except Exception as e:
        print(sid, e)
        continue
    m = re.search(r'name="server-response" content="([^"]+)"', page)
    js = json.loads(html.unescape(m.group(1)))
    resp = js["data"]["response"]["$watchV4"]["data"]
    desc = re.sub(r"<[^>]+>", " ", resp["video"]["description"])
    nv = resp["comment"]["nvComment"]
    body = json.dumps({"params": nv["params"], "threadKey": nv["threadKey"], "additionals": {}}).encode()
    cj = json.loads(get(nv["server"] + "/v1/threads", body, {"X-Frontend-Id": "6", "X-Frontend-Version": "0", "Content-Type": "application/json"}))
    cs = []
    for th in cj["data"]["threads"]:
        for c in th["comments"]:
            cs.append({"t": c["vposMs"] / 1000, "body": c["body"], "fork": th["fork"]})
    cs.sort(key=lambda c: c["t"])
    (HERE / "refs" / "nigo" / f"{sid}.comments.json").write_text(json.dumps({"description": desc, "comments": cs}, ensure_ascii=False, indent=0), encoding="utf-8")
    lines.append(f"## {sid} {resp['video']['title']}  comments={len(cs)}\n説明: {desc.strip()[:600]}\n")
    for c in cs:
        lines.append(f"{c['t']:7.2f} {c['body']}")
(HERE / "nigo_mad_comments.txt").write_text("\n".join(lines), encoding="utf-8")
print("ok")
