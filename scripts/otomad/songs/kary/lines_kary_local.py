"""scripts/speech-melody の動作確認用（scratch、gitignore）。lines_example.py の書式で関西クレーマーの台詞を数本。"""
from config import line

ANCHOR = 1.0
CENTER = 52.0

KAN = "淫夢/淫夢SPパック_分割⑤/関西クレーマー(カーリー)　欲張りセット"
ROOMS = f"{KAN}/ルームサービスクレーマー"
SUSHI = f"{KAN}/寿司職人見習い編"

LINES = [
    line(ROOMS, "ルームサービスお願いします。.wav", "ルームサービスお願いします"),
    line(ROOMS, "どうしてくれんねこれ？.wav", "どうしてくれんねこれ"),
    line(SUSHI, "寿司屋でーす.wav", "寿司屋でーす"),
    line(SUSHI, "い・な・り.wav", "い、な、り"),
    line(SUSHI, "親方に電話させてもらうね.wav", "親方に電話させてもらうね"),
]
