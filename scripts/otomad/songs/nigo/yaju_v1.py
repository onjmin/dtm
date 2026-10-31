"""野獣先輩（第4章・王道）の台詞の定義（使い捨て）。素材は手元だけで使う。

性的な語・場面に依る台詞は使わない。空耳・日常の台詞だけ。演者は野獣先輩ひとりでそろえる。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

R = (paths.MATERIAL / "淫夢")
CH4 = R / "淫夢SPパック_分割⑤" / "第４章「昏睡レイプ！野獣と化した先輩」" / "野獣"
ODO = R / "淫夢SPパック_分割⑥" / "野獣先輩　王道" / "野獣先輩"


def q(folder, name, text, keep=None, rep=1):
    hits = sorted(folder.rglob(name))
    if not hits:
        raise FileNotFoundError(name)
    return (hits[0], None, text, keep, rep)


TEA = q(CH4, "野獣「アイスティーしかなかったけど良いかな？」.wav", "アイスティーしかなかったけどいいかな")
KOKO = q(CH4, "野獣「こ↑こ↓」.wav", "ここ")
FA = q(CH4, "野獣「ファッ！？」.wav", "ふぁっ")
WAKAN = q(CH4, "野獣「これもうわかんねぇな」.wav", "これもうわかんねえな")
TASHO = q(CH4, "野獣「ま、多少はね？」.wav", "ま、たしょうはね")
OMATASE = q(CH4, "野獣「おまたせ」.wav", "おまたせ")
KUMOTTE = q(CH4, "野獣「曇ってきたな」.wav", "くもってきたな")
TAIKAI = q(CH4, "野獣「まぁ大会近いからね、しょうがないね」.wav", "まあたいかいちかいからね、しょうがないね")
RENSHU = q(CH4, "野獣「ねー今日練習きつかったね」.wav", "ねーきょうれんしゅうきつかったね")
TIME = q(CH4, "野獣「今日タイムはどう？伸びた？伸びない？」.wav", "きょうたいむはどう、のびた、のびない")
NODO = q(CH4, "野獣「喉乾いた…　喉乾かない？」.wav", "のどかわいた、のどかわかない")
DAIJOBU = q(CH4, "野獣「大丈夫でしょ」.wav", "だいじょうぶでしょ")
KUIARA = q(CH4, "野獣「悔い改めて」.wav", "くいあらためて")
NOMIMONO = q(CH4, "野獣「何か飲み物取ってくる」.wav", "なにかのみものとってくる")
DOUZO = q(CH4, "野獣「入って、どうぞ」.wav", "はいって、どうぞ")
YARI = q(ODO, "野獣先輩「やりますねぇ！」.wav", "やりますねぇ")

ALL = [TEA, KOKO, FA, WAKAN, TASHO, OMATASE, KUMOTTE, TAIKAI, RENSHU, TIME, NODO, DAIJOBU, KUIARA, NOMIMONO, DOUZO, YARI]
