"""関西クレーマーの「心臓マッサージ」の台詞（scratch、gitignore）。build_cpr.py が使う。"""
from config import line

ANCHOR = 1.0
CENTER = 52.0

CPR = "淫夢/淫夢SPパック_分割⑤/関西クレーマー(カーリー)　欲張りセット/アカンこれじゃ患者が死ぬゥ！ ビデオで学ぶ正しい心臓マッサージの方法"

IKIKAERE = line(CPR, "生き返れ生き返れ.wav", "いきかえれいきかえれ")
AKAN = line(CPR, "あかん、これじゃ患者が死ぬぅ.wav", "あかん、これじゃかんじゃがしぬう")
MU = line(CPR, "心を無にしろ.wav", "こころをむにしろ")
MUZU = line(CPR, "なかなか難しいねんな.wav", "なかなかむずかしいねんな")
TSUGI = line(CPR, "次は何したらいいねん.wav", "つぎはなにしたらいいねん")
DAIJI = line(CPR, "大事に使えよ.wav", "だいじにつかえよ")
WAKARU = line(CPR, "わかるか？心臓が蘇っていく音が.wav", "わかるか、しんぞうがよみがえっていくおとが")
ISHA = line(CPR, "良い医者になれ.wav", "いいいしゃになれ")
CHANCE = line(CPR, "俺に最後のチャンスを頂戴.wav", "おれにさいごのちゃんすをちょうだい")
YAMENNA = line(CPR, "やめんな、何のためにここまできたんや.wav", "やめんな、なんのためにここまできたんや")

LINES = [IKIKAERE, AKAN, MU, MUZU, TSUGI, DAIJI, WAKARU, ISHA, CHANCE, YAMENNA]
