"""KBTIT（ごちゃまぜ）の台詞の定義（使い捨て）。素材は手元だけで使う。

場面が暴力・性的な台詞は使わない。場面に依らない口ぐせ・あいさつ・空耳だけ。演者は KBTIT ひとりでそろえる。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

R = (paths.MATERIAL / "淫夢/淫夢SPパック_分割①/KBTIT　ごちゃまぜ")


def q(name, text, keep=None, rep=1):
    hits = sorted(R.rglob(name))
    if not hits:
        raise FileNotFoundError(name)
    return (hits[0], None, text, keep, rep)


NASU = q("ありがとナス！01.wav", "ありがとなす")
OMACHI = q("お待ちしてナス！01.wav", "おまちしてなす")
KASHIKO = q("かしこまり！01.wav", "かしこまり")
SHINJI = q("信じらんねぇ！01.wav", "しんじらんねえ")
BANKAI = q("卍解～01.wav", "ばんかいー")
KANASHII = q("悲しいなあ！01.wav", "かなしいなあ")
WARA = q("笑っちゃうぜ01.wav", "わらっちゃうぜ")
IPHONE = q("for iPhone？01.wav", "ふぉーあいふぉん")
USSO = q("うっそだろお前！（大草原）01.wav", "うっそだろおまえ")
IKUDE = q("065　行くでー.wav", "いくでー")
OSSU = q("001　オッス.wav", "おっす")
N = q("017　ん？.wav", "ん")
OO = q("034　おー.wav", "おー")
GORAN = q("それではご覧ください！01.wav", "それではごらんください")
GOBUSA = q("皆さん！ご無沙汰しております01.wav", "みなさん、ごぶさたしております")

ALL = [NASU, OMACHI, KASHIKO, SHINJI, BANKAI, KANASHII, WARA, IPHONE, USSO, IKUDE, OSSU, N, OO, GORAN, GOBUSA]
