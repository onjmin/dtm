"""サムソン（ガバ穴ダディー・課長壊れる・現場監督）の台詞の定義（使い捨て）。素材は手元だけで使う。

性的な語を含む台詞は使わない。空耳で知られる台詞と、場面に依らない台詞だけ。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

R = (paths.MATERIAL / "淫夢/淫夢SPパック_分割③")
GABA = R / "サムソン　ガバ穴ダディー"
KACHO = R / "サムソン　課長壊れる"
GENBA = R / "サムソン　現場監督２"


def find(folder, name):
    hits = sorted(folder.rglob(name))
    if not hits:
        raise FileNotFoundError(name)
    return hits[0]


def q(folder, name, text, keep=None, rep=1):
    return (find(folder, name), None, text, keep, rep)


JACKIE = q(GABA, "０２５７☆ジャッ！キー！チェンッ！ジャッ！キー！チェンッ！.wav", "じゃっきーちぇん、じゃっきーちぇん")
DOARA = q(GABA, "００３５☆ドアラ～！.wav", "どあらー")
AIIN = q(GABA, "０１５４☆アイーン.wav", "あいーん")
ARCHER = q(GABA, "０１７４☆アーチャー！.wav", "あーちゃー")
HEREWEGO = q(GABA, "００８８☆Here we go!.wav", "ひあうぃーごー")
KOWAI = q(GABA, "０００２☆怖いねぇ・・・.wav", "怖いねぇ")
MATTETE = q(GABA, "０１６９ちょっとまっててや.wav", "ちょっと待っててや")
MOUIKKAI = q(GABA, "０１７０ハイもう一回言ってみ？.wav", "はい、もう一回言ってみ")
SENTI = q(GABA, "０２２８あーセンチメンタル・・・.wav", "あー、センチメンタル")
WAWAWA = q(KACHO, "わっわっわっわっわっわ.wav", "わっわっわっわっわっわ")
KURUKURU = q(KACHO, "くるくるくるっ！くるっ！.wav", "くるくるくるっ、くるっ")
NYA = q(KACHO, "にゃー.wav", "にゃー")
STEINER = q(KACHO, "シュタイナー.wav", "しゅたいなー")
ZOU = q(KACHO, "象課長.wav", "ぞうかちょう")
AITATATA = q(KACHO, "あいたたた.wav", "あいたたた")
DAMEDAME = q(GENBA, "あああ～んダメダメダメ（西田敏行）.wav", "あああーん、だめだめだめ")
PSYCHO = q(GENBA, "あーpsycho.wav", "あー、さいこ")
HICHEW = q(GENBA, "ハイチュウハイチュウ.wav", "はいちゅう、はいちゅう")
TEI = q(GENBA, "てゐー！.wav", "てぃー")
SUGOIYO = q(GENBA, "うわーすごいよー.wav", "うわー、すごいよー")
GORILLA = q(GENBA, "ゴリラ.wav", "ごりら")
KANJI = q(GENBA, "あー漢字っ！.wav", "あー、かんじっ")
ASHI = q(GENBA, "ちょまｗ足がつったｗ.wav", "ちょま、足がつった")
SAIKOU = q(GENBA, "最高ォ～ッ！.wav", "さいこーっ")
DOIT = q(GENBA, "Do it!.wav", "どぅーいっと")

ALL = [JACKIE, DOARA, AIIN, ARCHER, HEREWEGO, KOWAI, MATTETE, MOUIKKAI, SENTI, WAWAWA, KURUKURU, NYA, STEINER, ZOU,
       AITATATA, DAMEDAME, PSYCHO, HICHEW, TEI, SUGOIYO, GORILLA, KANJI, ASHI, SAIKOU, DOIT]
