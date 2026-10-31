# 音MAD制作（scripts/otomad）

台詞イントネーション作曲の曲と、その動画を作るスクリプトとメモ。作り方の決まり（素材・緩急・物語性・カバー・台詞の層だけ渡す形）は [speech-melody/README.md](../speech-melody/README.md) の §8・§9 にある。

`scripts/speech-melody/` は流れを整理し直した汎用版（整列 → 配置 → DAW で録音 → mix）。ここは実際に作品を作ってきた作業場で、曲ごとの build が他の曲の build を部品として読む。

## 階層

```
scripts/otomad/
  lib/        共通の部品（整列・音高・PSOLA・測定）と paths.py（場所の決まり）
  songs/      曲の系統ごと。build・video・メモ（notes-*.md）
    inmu/       淫夢の試作（inmu_v3 は配置 DP の本体で、多くの曲が読む）
    samson/     サムソン・2号式（samson_build / samson_2go_build は声の楽器と伴奏の部品）
    nigo/       野獣・KBTIT の2号式
    cookie/     クッキー☆（cookie_list で素材の 7z を展開、cookie_v1 は台詞の定義）
    plasti/     Plasticookie☆Adventure 型
    techno/     TECHNO MUSIC 先輩型（techno1_build はドラム・シンセの部品）
    dande/      Dandelion biscuit☆型と文字PV（dande3）
    kaisen/     既存曲のカバー（海鮮リスペクト）
    kary/ cpr/ eahon/
  analysis/   参考の曲・動画の測定（切り替え・明るさ・音量・拍・文字起こし）
  tools/      聴き返しの棚・録音の時刻合わせ・書き出し補助
  docs/       調べ物と考察（演出の引き出し・作者の手順・2号兄貴の分析）
```

どのスクリプトも冒頭で `lib/paths.py` を読み込む。これで lib・songs の各フォルダ・analysis・tools が `sys.path` に入るので、フォルダをまたいだ import がそのまま通る。

## 別の PC で再開する

1. **リポジトリと Python**: [speech-melody/README.md](../speech-melody/README.md) の §1 のとおり venv を作る。そのあと次を入れる。

   ```bash
   .venv-speech/Scripts/python -m pip install -r scripts/otomad/requirements.txt
   ```

   ffmpeg（動画の書き出し・測定）と 7-Zip（`C:\Program Files\7-Zip\7z.exe`。クッキー☆の素材の展開）も入れる。動画は CUDA の torch があれば GPU で描く（無ければ CPU で遅くなるだけ）。
2. **素材**: 音MAD素材のフォルダ（今は `D:\音MAD素材`。中は `淫夢/`・`クッキー☆/`・`エア本/`）を写す。場所が違えば `.env` に書く。
3. **`.env`**（リポジトリ直下、gitignore）:

   ```
   SPEECH_MATERIAL_DIR=D:\音MAD素材
   # 任意。既定は scratch/speech-melody
   OTOMAD_WORK=D:\otomad-work
   # 任意。pip --target で numpy の版を分けて入れた外部ライブラリ
   SPEECH_PYLIB=D:\otomad-work\pylib
   ```

4. **作業フォルダを作る**: クッキー☆の台詞は 7z を展開して使う。

   ```bash
   python -I scripts/otomad/songs/cookie/cookie_list.py x RU姉貴 UDK姉貴 HNS姉貴 BNKRG姉貴 MZ姉貴 JOKER姉貴
   ```

5. **フォント**（dande3 の文字PV）: コーポレート・ロゴ Bold・クラフト明朝・美咲ゴシックを「ユーザー用」に入れる（`%LOCALAPPDATA%\Microsoft\Windows\Fonts`）。Noto Sans JP と游ゴシックは Windows 標準。

## 動かし方

作業フォルダで実行する。書き出し先は相対パスで渡す。

```bash
cd scratch/speech-melody
```

```bash
python -I ../../scripts/otomad/songs/dande/dande3_build.py dande3
```

```bash
FPS=15 python -I ../../scripts/otomad/songs/dande/dande3_video.py dande3
```

build は song.wav・placement.json を書き、video はそれを読んで video.mp4（`FPS=15` なら video_15fps.mp4）を書く。`video.py <出力> 33.5 60` のように秒を並べると、その秒のコマだけを PNG で書く。

## git に入れないもの

素材の音声・絵、素材の写し（`cookie_src/`）、ダウンロードした参考動画（`refs/`）、分離した音（`ana_demucs*/`）、書き出した曲と動画、外部ライブラリ（`pylib/`）。どれも作業フォルダに置く。

## 既知のこと

- 同じ build を2回流すと、声の波形がわずかに違う（台詞の配置 placement.json は同じ）。差は最初の台詞から出る。ハッシュの乱数を固定しても残るので、原因は別にある（未特定）。
- `lib/align.py`・`lib/setting.py` は `scripts/speech-melody/` の同名ファイルの前の版で、ここの曲はこちらを読む。
