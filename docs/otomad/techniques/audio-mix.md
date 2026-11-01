# 音量の上下・ダッキング・ラウドネス

- 声と伴奏のどちらを上にするかは型で決まる。書き出しのラウドネスはそろえる。

## やり方

- **2号式**: 曲が上。生の台詞が鳴る区間で 声 − 伴奏 = −5〜−12 dB（[research/nigo-mad-analysis.md](../research/nigo-mad-analysis.md) §4）。
- **台詞イントネーション作曲・カバー**: 台詞が主旋律なので、声が鳴っている所で声を伴奏より 3 dB 上にする（`kaisen_mix.py`、[speech-melody/README.md](../../../scripts/speech-melody/README.md) §9-2）。
- **ラウドネス**: -16.0 LUFS / True Peak -1.5 dBTP（EBU R128 準拠）。耳に刺さる高域・過大低音を切り、突発的な音割れを無くす（bb7）。
- **緩急**: 音も区間で3段以上に分ける。映像だけ段を付けて音が平らなのは失敗（dande3 は 12〜84 秒がずっと −11 dB）。
- 台詞の層（voice.wav）にはリバーブ・圧縮・音量の自動調整をかけない（§9-4）。

## 試した作品

- samsonnigo1: 台詞 +3 dB → 2号式としては逆。
- dande3: 音が平ら → [rules.md](../rules.md) の緩急に足した。
- bb7: -16 LUFS / -1.5 dBTP。
