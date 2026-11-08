"""所有者の投稿（ニコニコ user/137530878）の再生・コメント・マイリスト・いいねと、時刻つきのコメントを取る。

評価は視聴者が決めるので、作品の評価を書く前にこれで取り直す。
python -I scripts/otomad/tools/my_videos.py [ユーザーID]  → scratch/videos/posted.txt
読み取ったコメントは手元の works/posted.md と各台帳の「視聴者の評価」へ要約して写す。
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "scratch" / "videos" / "posted.txt"
UA = {"User-Agent": "Mozilla/5.0"}
NV = {"X-Frontend-Id": "6", "X-Frontend-Version": "0"}


def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def main():
    uid = sys.argv[1] if len(sys.argv) > 1 else "137530878"
    lst = json.loads(get(f"https://nvapi.nicovideo.jp/v3/users/{uid}/videos?sortKey=registeredAt&sortOrder=desc&pageSize=100&page=1", headers=NV))
    out = []
    for it in lst["data"]["items"]:
        v = it["essential"]
        sid = v["id"]
        page = get(f"https://www.nicovideo.jp/watch/{sid}")
        m = re.search(r'name="server-response" content="([^"]+)"', page)
        resp = json.loads(html.unescape(m.group(1)))["data"]["response"]["$watchV4"]["data"]
        tags = [t["name"] for t in (resp.get("tags") or {}).get("items", [])]
        nv = resp["comment"]["nvComment"]
        body = json.dumps({"params": nv["params"], "threadKey": nv["threadKey"], "additionals": {}}).encode()
        cj = json.loads(get(nv["server"] + "/v1/threads", body, {**NV, "Content-Type": "application/json"}))
        cs = sorted((c["vposMs"] / 1000, c.get("postedAt", "")[:16], c["body"]) for th in cj["data"]["threads"] for c in th["comments"])
        c = v["count"]
        view = max(c["view"], 1)
        out.append(f"## {sid} {v['title']}")
        out.append(f"投稿 {v['registeredAt'][:16]}  長さ {v['duration']} 秒  再生 {c['view']}  コメ {c['comment']}  マイ {c['mylist']}  いいね {c['like']}"
                   f"  いいね率 {c['like'] / view:.1%}  マイ率 {c['mylist'] / view:.1%}")
        out.append("タグ: " + " / ".join(tags))
        out += [f"{t:7.2f}  {p}  {b}" for t, p, b in cs]
        out.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out), encoding="utf-8")
    print(OUT, len(lst["data"]["items"]), "本")


if __name__ == "__main__":
    main()
