"""台詞イントネーション作曲の試作を聴き返すページ shelf/index.html を書き出す（使い捨て。素材の音声を含むので公開しない）。

見た目は scripts/misc/song-shelf.html と同じ（左に一覧、右に詳細）。小節ごとの素材は placement.json /
song.json の layout / shelf_layouts.py の再計算から。python -I shelf_build.py
"""
import importlib
import json
from datetime import datetime
from zoneinfo import ZoneInfo
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
HERE = paths.WORK
import soundfile as sf  # noqa: E402

SRC_ROOT = paths.MATERIAL
COOKIE_ROOT = HERE / "cookie_src"
FUTURE2 = SRC_ROOT / "エア本" / "エア本さんスターターセット" / "Future2"

MODEL = "Claude Opus 5.5"  # 作ったモデル（tmp/songs の棚と同じく一覧に出す）
# (フォルダ, 題名, 素材, 伴奏, 所有者の評価)
SONGS = [
    ("song1", "試作1 エア本（Future2）", "エア本 Future2（自動で選んだ台詞）", "Python の簡易伴奏・2コード固定", "評価なし"),
    ("song2", "試作2 エア本語録", "エア本（すばわが2・痴呆との遭遇）", "Python の簡易伴奏・2コード固定", "「もっと良い曲がいい」"),
    ("song3", "試作3 エア本語録（和音付け・展開）", "エア本", "Python 伴奏・小節ごとの和音・9区間", "「シャバダバのリズムが合っていない」"),
    ("song4", "試作4 エア本語録（シャバダバ修正）", "エア本", "Python 伴奏・小節ごとの和音", "「現状で直せたと思えない」"),
    ("song5", "エア本語録 v5（句頭を拍頭）", "エア本", "Python 伴奏", "捨てる"),
    ("inmu1", "淫夢 v1", "淫夢（野獣先輩ほか）", "Python 伴奏", "捨てる"),
    ("inmu2", "淫夢 v2（音程そのまま・語頭を16分）", "淫夢", "Python 伴奏・ベース下降", "捨てる"),
    ("inmu3", "淫夢 v3（強い音節を拍頭・台詞ごとに移調）", "淫夢", "Python 伴奏・4つ打ち", "評価なし"),
    ("kaisen1", "海鮮リスペクト × 淫夢", "淫夢", "dtm 自動作曲 海鮮リスペクト（seed 3920797195）", "捨てる"),
    ("nigo1", "2号兄貴リスペクト × 淫夢", "淫夢", "dtm 自動作曲 2号兄貴リスペクト（seed 1889876315）", "評価なし"),
    ("cookie1", "クッキー☆ UDK姉貴（最初の伴奏・渡していない）", "クッキー☆ UDK姉貴", "dtm 2号兄貴リスペクト（seed 374303784）", "未提出（和音が合わず作り直し）"),
    ("cookie2", "クッキー☆ UDK姉貴 × 2号兄貴", "クッキー☆ UDK姉貴", "dtm 2号兄貴リスペクト（seed 180617924、候補8曲から和音で選択）", "評価なし（次に「複数の姉貴の声を使え」）"),
    ("cookie3", "クッキー☆ 複数の姉貴", "クッキー☆ 7人の姉貴", "dtm 2号兄貴（seed 180617924）＋主旋律シンセ", "評価なし"),
    ("samson2", "サムソン（ガバ穴ダディー・課長壊れる・現場監督）", "淫夢 サムソン3本", "旋律から和音を決めて DAW に手書き（作者の手順）", "評価なし"),
    ("inmu2gun1", "淫夢2軍（KBTIT・関西クレーマー・ゆうさく・TNOK）", "淫夢 派生キャラ", "旋律から和音を決めて DAW に手書き（作者の手順）", "評価なし"),
    ("kary1", "関西クレーマー（カーリー）× 2号スタイル", "淫夢 関西クレーマー欲張りセット", "旋律・セブンスの和音を手書き（2号スタイル、145BPM、最後のサビで全音上へ転調）", "評価なし"),
    ("samsonnigo1", "サムソン × 2号スタイル", "淫夢 サムソン3本", "旋律・セブンスの和音・アルペジオを手書き（2号スタイル、150BPM、最後のサビで全音上へ転調）", "評価なし"),
    ("samson2go1", "サムソン × 2号式（声を楽器に）", "淫夢 サムソン3本",
     "2号兄貴の音MAD 5本の分析から: 声で母音シンセ・刻み・スネアを作り、生の台詞は後半まで隠す（144BPM、D マイナー）", "「オリジナルメロディになってて良い」"),
    ("yaju2go1", "野獣先輩 × 2号式（アイスティーを刻む）", "淫夢 野獣先輩（第4章・王道）",
     "手書き: アイスティーの1句をモーラごとに刻んでサビ旋律に、わかんねぇなの母音で声のベース、生の台詞は最後まで隠す（150BPM、E マイナー）", "評価なし"),
    ("kbt2go1", "KBTIT × 2号式（16分と伸ばし）", "淫夢 KBTIT（ごちゃまぜ）",
     "手書き: リードが主役で16分の走りと伸ばしの二極、信じらんねぇ の刻みを伸ばしの下に合いの手、おー の母音パッド（168BPM、G マイナー）", "評価なし"),
    ("samson2go2", "サムソン × 2号式 2（ペンタの跳躍と声のリフ）", "淫夢 サムソン3本",
     "手書き: C マイナーペンタだけで跳ねるリード（付点・3連・16分・伸ばし）、センチメンタル の母音シンセが2本目のリフ、刻みと台詞は PSOLA（152BPM、C マイナー）", "評価なし"),
    ("samson2go3", "サムソン × 2号式 3（samson2go1 の型で新しい旋律）", "淫夢 サムソン3本",
     "samson2go1 の作り方をそのまま使い、旋律・和音・台詞だけ新しく手書き: E マイナーペンタのリード、王道進行のサビ、センチメンタル の母音リフ、最後のサビで台詞を2小節ごとに8つ（150BPM、E マイナー）", "評価なし"),
    ("samson3", "サムソン3：くるくるチェン大狂詩曲", "淫夢 サムソン3本（性的語句なし）",
     "台詞イントネーション作曲: PSOLA再合成・Amペンタ・4-5-3-6王道セブンス進行・第63-64小節E7(b9)→Am9完全終止・豪華7トラック伴奏（126BPM、64小節、A マイナー）", "評価なし"),
    ("samson5", "サムソン5（わっわっを連打する主題・2和音だけ）", "淫夢 サムソン3本",
     "作者の手順: 台詞合わせ→モーラ単位に F マイナーペンタ（主音は主題の最後の音）→採譜→旋律から選んだ Fm7 と D♭M7 を1小節ずつ往復（125BPM、33小節）", "評価なし"),
    ("samson2go1r", "【リメイク】サムソン × 2号式（samson2go1 の台詞解禁版）", "淫夢 サムソン（ガバ穴ダディー中心、性的な空耳を解禁）",
     "samson2go1 の旋律・和音・声の楽器はそのまま。生の台詞を14→28か所に増やし、ブレイク（41〜48小節）は台詞を和音へ寄せた主旋律、49小節頭に「きもちんぽ」。高い音を控えめに: リードはノコギリ波→フルートで G6 より上を弱く、グロッケン→1オクターブ下のチェレスタ（144BPM、D マイナー）", "使う"),
]


def show_path(p):
    p = Path(p)
    for root, label in ((SRC_ROOT, ""), (COOKIE_ROOT, "クッキー☆（7z 展開）\\")):
        try:
            return label + str(p.relative_to(root))
        except ValueError:
            pass
    return str(p)


def disp_text(text, keep):
    if keep:
        return keep
    if isinstance(text, tuple):
        return "、".join(t for _, _, t in text)
    return text


def path_index():
    """台詞の表示テキスト → [素材パス]（台詞の定義モジュールから）。"""
    idx = {}

    def put(text, path):
        idx.setdefault(text, [])
        if str(path) not in idx[text]:
            idx[text].append(str(path))

    for mod in ("inmu_v1", "cookie_v1", "cookie_v2", "samson_v1", "inmu2gun_v1", "kary_v1"):
        m = importlib.import_module(mod)
        for v in vars(m).values():
            if isinstance(v, tuple) and len(v) == 5 and isinstance(v[0], Path):
                put(disp_text(v[2], v[3]), v[0])
                if isinstance(v[2], str):
                    put(v[2], v[0])
    import compose_quotes as Q
    import compose_quotes3 as Q3
    for e in Q.PLAN:
        if e != "|":
            folder, num, text, keep = e[:4]
            put(keep or text, Q.find(folder, num))
    for _, items in Q3.SECTIONS:
        for folder, num, text, keep, _r in items:
            put(keep or text, Q3.find(folder, num))
    put("シャバダバッタバ、シャバダバッタバ、シャバダバッタバ、ダ", Q3.find(*Q3.SHABA[:2]))
    return idx


def resolve(idx, text, who=None):
    cands = idx.get(text, [])
    if who:
        hit = [c for c in cands if Path(c).parent.name == who or who in Path(c).parts]
        if hit:
            return hit[0]
    return cands[0] if cands else None


# 伴奏の出どころ。dtm の自動作曲を使った曲はその JSON、手書きの曲は各フォルダの daw.json
AUTO_SRC = {"kaisen1": "kaisen.json", "nigo1": "nigo.json", "cookie1": "cookie_nigo.json", "cookie2": "cand_7.json",
            "cookie3": "cand_7.json"}
VOICE_SRC = {"cookie3": ("cookie3_double.json", "主旋律シンセ（台詞の音程をなぞる）")}
VOICE_INST = {"vowel": "声の楽器: 母音シンセ・パッド", "chop": "声の楽器: 音節の刻み", "bass": "声の楽器: 声のベース", "perc": "声の楽器: 子音の打楽器"}


def ratio(d):
    """自動作曲と手書きの比率（発音イベント数。song-shelf と同じ数え方）。"""
    rec = HERE / "rec" / "out"
    tracks = []
    if d in AUTO_SRC:
        j = json.loads((rec / AUTO_SRC[d]).read_text(encoding="utf-8"))
        names = j["meta"].get("trackInstruments", {})
        tracks += [{"name": f"t{k}", "instrument": names.get(k), "origin": "auto", "notes": len(v)} for k, v in j["tracks"].items() if v]
    if d in VOICE_SRC:
        f, label = VOICE_SRC[d]
        tracks.append({"name": "追加", "instrument": label, "origin": "voice",
                       "notes": len(json.loads((rec / f).read_text(encoding="utf-8")))})
    if (HERE / d / "daw.json").exists():
        j = json.loads((HERE / d / "daw.json").read_text(encoding="utf-8"))
        names = j.get("instruments", {})
        tracks += [{"name": k, "instrument": names.get(k), "origin": "hand", "notes": len(v)} for k, v in j["tracks"].items() if v]
    pj = HERE / d / "placement.json"
    pl = json.loads(pj.read_text(encoding="utf-8")) if pj.exists() else {}
    tracks += [{"name": "声", "instrument": VOICE_INST[k], "origin": "hand", "notes": v} for k, v in pl.get("voiceNotes", {}).items() if v]
    speech = sum(1 for p in pl.get("placed", []) if p.get("kind", "raw") == "raw") if pl else None
    if not tracks:
        return {"tracks": [], "only": "rule", "speech": speech}
    origins = {}
    for t in tracks:
        origins[t["origin"]] = origins.get(t["origin"], 0) + t["notes"]
    note = "手書きの伴奏は和音と旋律を手で決め、刻みの型をビルドスクリプトで展開したもの。" if "hand" in origins and d not in AUTO_SRC else ""
    return {"tracks": tracks, "origins": origins, "speech": speech, "note": note}


def facts(d):
    f = {}
    for name in ("song.json", "placement.json"):
        p = HERE / d / name
        if p.exists():
            j = json.loads(p.read_text(encoding="utf-8"))
            f["bpm"] = f.get("bpm") or j.get("bpm")
            f["key"] = f.get("key") or j.get("key") or (f"{j['root']} {j.get('scale', '')}" if j.get("root") else None)
            f["bars"] = f.get("bars") or j.get("bars")
            if j.get("progression"):
                f["progression"] = j["progression"]
    wav = HERE / d / "song.wav"
    if wav.exists():
        info = sf.info(str(wav))
        f["seconds"] = round(info.frames / info.samplerate, 1)
    return f


def rows_for(d, idx, relayouts):
    """小節ごとの素材の表と、出どころの注記。"""
    pj = HERE / d / "placement.json"
    if pj.exists():
        rows = []
        for p in json.loads(pj.read_text(encoding="utf-8"))["placed"]:
            path = p.get("file") or resolve(idx, p["text"], p.get("who"))
            rows.append({"bar": p["bar"], "text": p["text"], "who": p.get("who") or (Path(path).parent.name if path else ""),
                         "path": show_path(path) if path else "（素材ファイル不明）", "transpose": p.get("transpose")})
        return rows, "書き出し時の記録（placement.json）"
    sj = json.loads((HERE / d / "song.json").read_text(encoding="utf-8")) if (HERE / d / "song.json").exists() else {}
    if "layout" in sj:
        rows = []
        for p in sj["layout"]:
            path = resolve(idx, p["text"])
            rows.append({"bar": p["bar"], "text": p["text"], "who": Path(path).parent.name if path else "",
                         "path": show_path(path) if path else "（素材ファイル不明）", "transpose": None})
        return rows, "書き出し時の記録（song.json の layout）"
    if "plan" in sj:  # song1: 2小節ずつの枠に台詞（ファイル名の番号つき）
        rows = []
        for slot, name in enumerate(sj["plan"]):
            if name:
                path = FUTURE2 / f"{name}.wav"
                rows.append({"bar": slot * 2 + 1, "text": name.split(" ", 1)[1], "who": "Future2", "path": show_path(path),
                             "transpose": None})
        return rows, "書き出し時の記録（song.json の plan。台詞は2小節の枠の頭から）"
    r = relayouts.get(d)
    if r and r.get("rows"):
        note = "今のコードで計算し直したもの"
        note += "（小節数が書き出し時と一致）" if r.get("match") else f"（小節数 {r.get('bars')} が書き出し時の {r.get('expectedBars')} と違う。コードが後から変わったため、書き出し時とずれている可能性あり）"
        rows = [{"bar": x["bar"], "text": x["text"], "who": Path(x["path"]).parent.name, "path": show_path(x["path"]),
                 "transpose": x.get("transpose")} for x in r["rows"]]
        return rows, note
    return [], "記録なし" + (f"（再計算できなかった: {r['error']}）" if r and r.get("error") else "")


def main():
    idx = path_index()
    lay_p = HERE / "shelf" / "layouts.json"
    relayouts = json.loads(lay_p.read_text(encoding="utf-8")) if lay_p.exists() else {}
    songs = []
    for d, title, material, accomp, verdict in SONGS:
        if not (HERE / d / "song.wav").exists():
            continue
        rows, source = rows_for(d, idx, relayouts)
        check = HERE / d / "check.json"
        at = datetime.fromtimestamp((HERE / d / "song.wav").stat().st_mtime, ZoneInfo("Asia/Tokyo")).strftime("%Y-%m-%d %H:%M")
        songs.append({
            "id": d, "title": title, "at": at, "model": MODEL, "material": material, "accomp": accomp, "verdict": verdict,
            "audio": f"../{d}/song.wav", "wavPath": str(HERE / d / "song.wav"), "voice": f"../{d}/voice.wav" if (HERE / d / "voice.wav").exists() else None,
            "facts": facts(d), "ratio": ratio(d), "rows": rows, "rowsSource": source,
            "check": json.loads(check.read_text(encoding="utf-8")) if check.exists() else None,
        })
    # MML 版（声なしの伴奏とリード）: shelf/mml/<曲>.mml から scripts/misc/mml-embed-url.ts で作った公開デモの埋め込み URL
    emb_p = HERE / "shelf" / "embeds.json"
    embeds = {e["name"]: e for e in json.loads(emb_p.read_text(encoding="utf-8"))} if emb_p.exists() else {}
    for x in songs:
        e = embeds.get(x["id"])
        x["mml"] = {"embed": e["embed"], "edit": e["edit"]} if e else None
    tpl = (HERE / "shelf_template.html").read_text(encoding="utf-8")
    songs.sort(key=lambda x: x["at"], reverse=True)  # 一覧は新しい曲が上
    html = tpl.replace("/*SONGS*/[]", json.dumps(songs, ensure_ascii=False))
    (HERE / "shelf" / "index.html").write_text(html, encoding="utf-8")
    print(len(songs), "songs;", sum(len(s["rows"]) for s in songs), "rows;",
          [s["id"] for s in songs if not s["rows"]], "without rows")


if __name__ == "__main__":
    main()
