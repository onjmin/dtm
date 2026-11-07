# 海鬼月カバーの MV で使ったドット絵

ずんだもん・四国めたん・東北イタコのドット絵と背景です（2026-11-07 時点の最新）。曲（歌詞・旋律・声）と動画は入っていません。

## 中身

```
owner/                        所有者（onjmin）が描いて渡したドット絵（128×128 の全身）。MV の大きな人物と、耳打ちの場面の左右のずんだもん
  metan.png  itako.png  zundamon.png   最新
  old/                        差し替える前の版（ファイル名の後ろは配布 URL の名前）
chars/                        Claude がスクリプトで描いた全身（高さ約 43〜52px）
  zundamon/  metan/  itako/   <名前>_<目>_<口>[_bend|_tiptoe].png
    arms/                     腕の差分。<名前>_<左腕>_<右腕>.png（目は開き・口は閉じ）
  zundamon-mascot/            合唱隊のマスコットの姿（26×28）。mascot_<目>_<口>.png
  sheet.png                   確認用の一覧（4 倍）
bg/                           背景（360×180。動画では横へゆっくり流した）と月・岩の小物
src/                          描き出しのスクリプト（Python・Pillow・numpy）
```

- **目**: `open`・`half`（半目）・`blink`（瞬き）・`closed`・`happy`（にっこり）・`squeeze`（><）。
- **口**: `close`・`open`・`sing`・`wah`・`flat`。
- **`_bend`** は拍で膝を曲げた差分、**`_tiptoe`** は背伸びの差分です。
- **腕**: `down`（下ろす）・`low`（30°）・`mid`（60°）・`side`（水平）・`wave`（水平で手首を起こす）・`belly`（お腹の前）・`chest`（胸に手を当てる）。
- ずんだもんのしっぽは描き込み済みです（うなじから肩の後ろへ下りて先が巻く）。動画では体の動きに遅れて跳ねさせました。

## 作り直す

```bash
cd src
python -I sprites.py   # → src/sprites/（しっぽは含まない。parts.py の with_tail で重ねる）
python -I bgpaint.py   # → src/bg/
```

`parts.py` は、動画のスクリプトから抜き出したしっぽ（`with_tail`）とマスコット（`mascot`）の描き方です。

形と色は公式の立ち絵と 3D モデルで確かめ、所有者の直しを受けて描き直しました。直しの経緯と教訓は dtm リポジトリの `docs/otomad/techniques/pixel-character.md` にあります。

## 権利

`owner/` の絵は所有者（onjmin）が描いたものです。ずんだもん・四国めたん・東北イタコは、東北ずん子・ずんだもんプロジェクト（SSS合同会社）のキャラクターです。使うときは公式のガイドライン（https://zunko.jp/guideline.html）に従ってください。
