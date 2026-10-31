"""淫夢語録を v5 の配置で曲にする（使い捨て）。素材は手元だけで使う。"""
import sys
from pathlib import Path

sys.path.insert(0, str(next(p for p in Path(__file__).resolve().parents if p.name == "otomad") / "lib"))
import paths  # noqa: E402  素材・作業フォルダ・曲フォルダを sys.path へ
from setting import run  # noqa: E402

R = (paths.MATERIAL / "淫夢")


def pack(name):
    """素材パックのフォルダ。展開のし方で同名フォルダが2段になっていることがある。"""
    nested = R / name / name
    return nested if nested.exists() else R / name


P5 = pack("淫夢SPパック_分割⑤")
P6 = pack("淫夢SPパック_分割⑥")
P1 = pack("淫夢SPパック_分割①")
CH4 = P5 / "第４章「昏睡レイプ！野獣と化した先輩」/野獣"
KARATE = P6 / "迫真空手部・性の裏技/野獣(鈴木)先輩"
TNOK = P5 / "第１章「極道脅迫！体育部員たちの逆襲」/TNOK"


def q(path, text, keep=None, rep=1):
    return (path, None, text, keep, rep)


OSS = q(KARATE / "おっすお願いしまーす.wav", "おっすお願いしまーす")
NUA = q(KARATE / "ぬぁぁん疲れたもぉぉん.wav", "ぬああん疲れたもおおん")
# 区間は音量の山ごとの音声認識（whisper-small）で確かめた（相づちは外す）
OKUJO = q(CH4 / "野獣「まずうちさぁ、(うん)、屋上、あんだけどぉ、(はえ～)、焼いてかない？」.wav",
          ((0.0, 0.95, "まずうちさぁ"), (1.4, 2.1, "屋上"), (2.0, 3.4, "あんだけどぉ"), (5.0, 5.8, "焼いてかない")))
AGE = q(P6 / "野獣先輩　ブリーフ否定派/野獣/野獣「24歳です(24歳)」.wav", ((0.0, 0.8, "二十四歳"), (1.1, 1.45, "です")))
GAKU = q(P6 / "野獣先輩　ブリーフ否定派/野獣/野獣「学生です」.wav", "学生です")
YARI = q(P6 / "野獣先輩　王道/野獣先輩/野獣先輩「やりますねぇ！」.wav", "やりますねぇ", rep=2)
JAKEN = q(KARATE / "じゃけん夜行きましょうね.wav", "じゃけん夜行きましょうね")
OKANO = q(KARATE / "うん、おかのした(わかりました).wav", ((0.0, 0.4, "うん"), (0.65, 1.45, "おかのした")))
FA = q(CH4 / "野獣「ファッ！？」.wav", "ファッ", rep=2)
SOUDAYO = q(P1 / "２　その他/MUR(偽)「そうだよ（便乗）」.wav", ((0.2, 0.95, "そうだよ"),), rep=2)
MITOKE = q(TNOK / "TNOK「お前らもよーく見とけよ」.wav", "お前らもよーく見とけよ")
AKUSHIRO = q(TNOK / "TNOK「おらあくしろよ」.wav", "おらあくしろよ")
SUKI = q(CH4 / "野獣「お前のことが好きだったんだよ！(迫真)」.wav", "お前のことが好きだったんだよ")

SECTIONS = [
    ("intro", [OSS]),
    ("A", [NUA, OKUJO, AGE, GAKU]),
    ("hook", [YARI, JAKEN]),
    ("B", [OKANO, FA, SOUDAYO, MITOKE, AKUSHIRO]),
    ("hook", [YARI, JAKEN]),
    ("break", [NUA, AGE, GAKU, OKANO]),
    ("build", []),
    ("hook2", [YARI, JAKEN, YARI, FA]),
    ("end", [SUKI]),
]

if __name__ == "__main__":
    run(SECTIONS, sys.argv[1])
