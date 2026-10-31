"""淫夢2軍（本編以外の派生キャラ: KBTIT・関西クレーマー・ゆうさく・TNOK）の台詞の定義（使い捨て）。

性的な語を含む台詞・暴力や虐待の場面の台詞は使わない。素材は手元だけで使う。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

R = (paths.MATERIAL / "淫夢")
KBT = R / "淫夢SPパック_分割①" / "KBTIT　ごちゃまぜ"
KAN = R / "淫夢SPパック_分割⑤" / "関西クレーマー(カーリー)　欲張りセット"
YUS = R / "淫夢SPパック_分割④" / "ゆうさく　欲張りセット"
TNOK = R / "淫夢SPパック_分割⑤" / "第１章「極道脅迫！体育部員たちの逆襲」" / "TNOK"


def find(folder, name):
    hits = sorted(folder.rglob(name))
    if not hits:
        raise FileNotFoundError(name)
    return hits[0]


def q(folder, name, text, keep=None, rep=1):
    return (find(folder, name), None, text, keep, rep)


# KBTIT
NASU = q(KBT, "ありがとナス！01.wav", "ありがとなす")
OMACHI = q(KBT, "お待ちしてナス！01.wav", "お待ちしてなす")
USSO = q(KBT, "うっそだろお前！（大草原）01.wav", "うっそだろお前")
SHINJI = q(KBT, "信じらんねぇ！01.wav", "信じらんねぇ")
BANKAI = q(KBT, "卍解～01.wav", "ばんかいー")
KANASHII = q(KBT, "悲しいなあ！01.wav", "悲しいなあ")
WARACCHAU = q(KBT, "笑っちゃうぜ01.wav", "笑っちゃうぜ")
NYAN = q(KBT, "おい、にゃんにゃんにゃん！01.wav", "おい、にゃんにゃんにゃん")
IPHONE = q(KBT, "for iPhone？01.wav", "ふぉーあいふぉん")
GORAN = q(KBT, "それではご覧ください！01.wav", "それではご覧ください")
# 関西クレーマー
SHINU = q(KAN, "あかん、これじゃ患者が死ぬぅ.wav", "あかん、これじゃ患者が死ぬぅ")
IKIKAERE = q(KAN, "生き返れ生き返れ.wav", "生き返れ生き返れ")
INARI = q(KAN, "い・な・り.wav", "い、な、り")
DOUSHITE = q(KAN, "どうしてくれんねこれ？.wav", "どうしてくれんねこれ")
KEISATSU = q(KAN, "すいませんで済んだら警察いらんやろ！.wav", "すいませんで済んだら警察いらんやろ")
ROOM = q(KAN, "ルームサービスお願いします。.wav", "ルームサービスお願いします")
KARY = q(KAN, "K・A・R・Y.wav", "けー、えー、あーる、わい")
# ゆうさく
SIGN = q(YUS, "ゆうさく　こちらの方サインお願いしまーす.wav", "こちらの方サインお願いしまーす")
HAYAKU = q(YUS, "ゆうさく　早くサインしてくださいよ.wav", "早くサインしてくださいよ")
YOROKONDE = q(YUS, "ゆうさく　はい、喜んで.wav", "はい、喜んで")
OTODOKE = q(YUS, "ゆうさく　お荷物をお届けいただきしました.wav", "お荷物をお届けいただきしました")
# TNOK
AKUSHIRO = q(TNOK, "TNOK「おらあくしろよ」.wav", "おらあくしろよ")
MITOKE = q(TNOK, "TNOK「お前らもよーく見とけよ」.wav", "お前らもよーく見とけよ")

ALL = [NASU, OMACHI, USSO, SHINJI, BANKAI, KANASHII, WARACCHAU, NYAN, IPHONE, GORAN, SHINU, IKIKAERE, INARI, DOUSHITE,
       KEISATSU, ROOM, KARY, SIGN, HAYAKU, YOROKONDE, OTODOKE, AKUSHIRO, MITOKE]
