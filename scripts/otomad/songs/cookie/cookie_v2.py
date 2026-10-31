"""クッキー☆ 複数の姉貴の語録の定義（使い捨て）。素材は手元だけで使う。

同じ台詞を複数の姉貴が読んでいるものは、掛け合い（同じ言葉を声と抑揚を替えて重ねる）に使う。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

D = paths.WORK / "cookie_src"


def q(who, file, text, keep=None, rep=1):
    return (D / f"{who}姉貴" / file, None, text, keep, rep)


TITLE = q("AKN", "クッキー☆.wav", "クッキー")
PUHA = q("RU", "ぷはー.wav", "ぷはー")
TENKI = q("JOKER", "今日もいい天気～☆.wav", "今日もいい天気")
KYUKEI = q("MZ", "今日は休憩の日なんだよ明日は神社閉店の日.wav", "今日は休憩の日なんだよ、明日は神社閉店の日")
# 神社閉店の日（4人）
JINJA_HNS = q("HNS", "神社閉店の日！.wav", "神社閉店の日")
JINJA_RU = q("RU", "神社閉店の日、クォラ.wav", "神社閉店の日、くぉら")
JINJA_BNK = q("BNKRG", "神社閉店の日！神社は店じゃありません.wav", "神社閉店の日、神社は店じゃありません", "神社閉店の日")
KUORA_RU = q("RU", "クォラ！.wav", "くぉら")
KUORA_HNS = q("HNS", "くぉら！.wav", "くぉら")
KUORA_BNK = q("BNKRG", "クォラ！.wav", "くぉら")
# 食べさせる（3人）
TABE_HNS = q("HNS", "私も食べさせるー！.wav", "私も食べさせるー")
TABE_RU = q("RU", "私も食べさせるー.wav", "私も食べさせるー")
TABE_YMN = q("YMN", "私も食べさせるぅー！.wav", "私も食べさせるぅー")
# 忘れてた（3人）
WASURE_MZ = q("MZ", "ああああ忘れてたー！.wav", "ああああ忘れてたー")
WASURE_RU = q("RU", "ああ・・・忘れてたー！.wav", "ああ、忘れてたー")
WASURE_YMN = q("YMN", "ああああああ！忘れてたあああああ！.wav", "ああああああ、忘れてたあああああ")
BROWNIE = q("MZ", "やっぱアリスの作るブラウニーは美味いな.wav", "やっぱアリスの作るブラウニーは美味いな")
IKASUMI = q("HNS", "イカスミヤキ？あっまい！.wav", "イカスミヤキ、あっまい")
# かしこまり（3人）
KASHIKO_RU = q("RU", "かしこまり.wav", "かしこまり")
KASHIKO_YMN = q("YMN", "かしこまり.wav", "かしこまり")
KASHIKO_JOKER = q("JOKER", "かしこまり！.wav", "かしこまり")
SARABA = q("HNS", "では諸君、サラダバー！.wav", "では諸君、サラダバー")

ALL = [TITLE, PUHA, TENKI, KYUKEI, JINJA_HNS, JINJA_RU, JINJA_BNK, KUORA_RU, KUORA_HNS, KUORA_BNK, TABE_HNS, TABE_RU,
       TABE_YMN, WASURE_MZ, WASURE_RU, WASURE_YMN, BROWNIE, IKASUMI, KASHIKO_RU, KASHIKO_YMN, KASHIKO_JOKER, SARABA]
