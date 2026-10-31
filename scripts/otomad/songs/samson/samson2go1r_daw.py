"""samson2go1r の伴奏: samson2go1 の daw.json の高い音を控えめにする（使い捨て）。
リードはノコギリ波→フルート、G6 より上は強さを段々下げる。グロッケンは1オクターブ下のチェレスタ。
python -I samson2go1r_daw.py <書き出し先の daw.json>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

HERE = paths.WORK
d = json.loads((HERE / "samson2go1" / "daw.json").read_text(encoding="utf-8"))
d["instruments"]["t0"] = "Flute"
d["instruments"]["t13"] = "Celesta"
for n in d["tracks"]["t0"]:
    n["velocity"] = int(round(110 - max(0, n["midi"] - 89) * 4))  # 既定 127。D7(98) で 74
for n in d["tracks"]["t13"]:
    n["midi"] -= 12
    n["velocity"] = 90
Path(sys.argv[1]).write_text(json.dumps(d), encoding="utf-8")
