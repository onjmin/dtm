"""関西クレーマー（カーリー）欲張りセットの台詞の定義（使い捨て）。素材は手元だけで使う。性的な語は使わない。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

R = (paths.MATERIAL / "淫夢")
KAN = next(R.rglob("関西クレーマー(カーリー)　欲張りセット"))


def find(sub, name):
    hits = sorted((KAN / sub).rglob(name)) if sub else sorted(KAN.rglob(name))
    if not hits:
        raise FileNotFoundError(name)
    return hits[0]


def q(sub, name, text, keep=None, rep=1):
    return (find(sub, name), None, text, keep, rep)


CPR = "アカンこれじゃ患者が死ぬゥ！ ビデオで学ぶ正しい心臓マッサージの方法"
SUSHI = "寿司職人見習い編"
ROOMS = "ルームサービスクレーマー"
YASA = "優しいクレーマー - [sm18838729]"
KAITAI = "料理人解体ショー"

# ルームサービス
ROOM = q(ROOMS, "ルームサービスお願いします。.wav", "ルームサービスお願いします")
DOUSHITE = q(ROOMS, "どうしてくれんねこれ？.wav", "どうしてくれんねこれ")
OKANE = q(ROOMS, "お金なんかいらん！.wav", "お金なんかいらん")
JOUSHI = q(ROOMS, "ちょちょっと上司呼んで.wav", "ちょちょっと上司呼んで")
# 寿司職人見習い
SUSHIYA = q(SUSHI, "寿司屋でーす.wav", "寿司屋でーす")
INARI_NAI = q(SUSHI, "いなりが入ってないやん。どうしてくれんのこれ（憤怒）.wav", "いなりが入ってないやん、どうしてくれんのこれ")
JIHAKU = q(SUSHI, "僕がさっき食べちゃいました（自白）.wav", "僕がさっき食べちゃいました")
OYAKATA = q(SUSHI, "親方に電話させてもらうね.wav", "親方に電話させてもらうね")
INARI = q(SUSHI, "い・な・り.wav", "い、な、り")
YURUSHITARU = q(SUSHI, "いいわ、今回は許したる.wav", "いいわ、今回は許したる")
OISHII = q(SUSHI, "おいしい、いなりやった.wav", "おいしい、いなりやった")
# 心臓マッサージ
SHINU = q(CPR, "あかん、これじゃ患者が死ぬぅ.wav", "あかん、これじゃ患者が死ぬぅ")
MUNI = q(CPR, "心を無にしろ.wav", "心を無にしろ")
IKIKAERE = q(CPR, "生き返れ生き返れ.wav", "生き返れ生き返れ")
ISHA = q(CPR, "良い医者になれ.wav", "良い医者になれ")
# 優しいクレーマー
SEII = q(YASA, "誠意見せろ.wav", "誠意見せろ")
KEISATSU = q(YASA, "すいませんで済んだら警察いらんやろ！.wav", "すいませんで済んだら警察いらんやろ")
UNMEI = q(YASA, "運命やな.wav", "運命やな")
# 料理人解体ショー
KAITAI_START = q(KAITAI, "さぁ・・・料理人解体ショーの始まりや.wav", "さぁ、料理人解体ショーの始まりや")
SAIKOU = q(KAITAI, "やっぱ中野君の・・・料理を・・・最高やな！.wav", "やっぱ中野君の、料理を、最高やな")

ALL = [ROOM, DOUSHITE, OKANE, JOUSHI, SUSHIYA, INARI_NAI, JIHAKU, OYAKATA, INARI, YURUSHITARU, OISHII, SHINU, MUNI,
       IKIKAERE, ISHA, SEII, KEISATSU, UNMEI, KAITAI_START, SAIKOU]
