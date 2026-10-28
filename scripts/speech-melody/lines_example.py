"""台詞の定義の見本（架空の台詞。この通りのファイルは無い）。

自分の素材で書くときはこのファイルを写し、リポジトリの外か scratch/（gitignore）に置いて build へ --lines で渡す。
素材の音声・台詞の書き起こしはリポジトリへ入れない。

line(フォルダ, ファイル名, 読み):
  フォルダ   SPEECH_MATERIAL_DIR からの相対パス（その下を rglob で探す）か絶対パス
  ファイル名 1台詞＝1ファイルの wav。前後の無音は自動で詰める
  読み       pyopenjtalk が読める文（漢字かなまじり可）。強制整列はこの読みのモーラで行うので、
             実際の発音どおりに書く（「でーす」「ちぇんっ」など伸ばし・促音も）。言いよどみは「、」で区切る
"""
from config import line

ANCHOR = 0.0  # 格子に合わせる点（0.0=子音の頭、1.0=母音の頭）。子音・息の長い素材は 1.0
CENTER = 52.0  # 台詞の音域をそろえる中心（MIDI）。台詞ごとに ±3 半音まで移調して寄せる

SHOP = "架空の店長/朝礼セット"
OHAYO = line(SHOP, "おはようございます.wav", "おはようございます")
KYOUMO = line(SHOP, "今日も一日がんばろう.wav", "今日も一日がんばろう")
IRASSHAI = line(SHOP, "いらっしゃいませー.wav", "いらっしゃいませー")
OKAIKEI = line(SHOP, "お会計はこちらです.wav", "お会計はこちらです")
ARIGATO = line(SHOP, "ありがとうございましたー.wav", "ありがとうございましたー")

# build_example.py はこの順に合いの手の枠へ回して入れる
LINES = [OHAYO, KYOUMO, IRASSHAI, OKAIKEI, ARIGATO]
