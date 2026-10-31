"""クッキー☆（UDK姉貴）の語録の定義（使い捨て）。素材は手元だけで使う。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ

D = paths.WORK / "cookie_src" / "UDK姉貴"
S = D / "初心者マリナー向け☆UDK音声素材集から抜粋"


def q(path, text, keep=None, rep=1):
    return (path, None, text, keep, rep)


OSS = q(D / "おーっすお願いします.wav", "おーっすお願いします")
YUKKURI = q(D / "ゆっくりしていってね.wav", "ゆっくりしていってね")
KYOMI = q(S / "なんだ、なんだよ、お前ら私に興味あんのか？.wav", "なんだ、なんだよ、お前ら私に興味あんのか")
NOBITA = q(D / "伸びた？伸びない？.wav", "伸びた、伸びない")
DANMAKU = q(D / "弾幕はパワーだぜ.wav", "弾幕はパワーだぜ")
REU4 = q(S / "れうさんれうさんれうさんれうさん.wav", "れうさんれうさんれうさんれうさん")
UU = q(D / "うー☆.wav", "うー")
REUCHOTTO = q(S / "れうさんちょっとー.wav", "れうさんちょっとー")
SOONANOKA = q(S / "そーなのかー.wav", "そーなのかー")
JUDGE = q(S / "ジャッジメントですの.wav", "ジャッジメントですの")
IYAIYA = q(S / "いやいやいやいやいや.wav", "いやいやいやいやいや")
URUSEE = q(S / "なんだようるせぇなぁ.wav", "なんだようるせぇなぁ")
YAMETE = q(S / "やめてよーー.wav", "やめてよー")
NAICHAU = q(D / "泣いちゃう、もう泣いちゃう.wav", "泣いちゃう、もう泣いちゃう")
NAKUTO = q(D / "泣くとMADになります.wav", "泣くとマッドになります")
OMOTE = q(S / "表に出ろ.wav", "表に出ろ")
YURUSANAI = q(S / "絶対許さない、おい.wav", "絶対許さない、おい")

ALL = [OSS, YUKKURI, KYOMI, NOBITA, DANMAKU, REU4, UU, REUCHOTTO, SOONANOKA, JUDGE, IYAIYA, URUSEE, YAMETE,
       NAICHAU, NAKUTO, OMOTE, YURUSANAI]
