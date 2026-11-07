# 音MAD制作（scripts/otomad）

台詞イントネーション作曲の曲と、その動画を作るスクリプト。**知識（所有者の基準・技・型・測定・作品台帳）は [docs/otomad/](../../docs/otomad/README.md) にまとめてある。作る前にそちらを読む。** ここはコードと使い方だけ。

`scripts/speech-melody/` は流れを整理し直した汎用版（整列 → 配置 → DAW で録音 → mix）。ここは実際に作品を作ってきた作業場で、曲ごとの build が他の曲の build を部品として読む。

## 階層

```
scripts/otomad/
  lib/        共通の部品（整列・音高・PSOLA・測定）と paths.py（場所の決まり）
    clip_grid.py   台詞を16分へ置く配置 DP・調と移調・声の合成（inmu_v3 から切り出し）
    pitch_snap.py  モーラごとの音を音階へ寄せる補正（samson_build から）
    voice_inst.py  声のシンセ・音節の粒・子音の打楽器（samson_2go_build から）
  songs/      曲の系統ごと。作品ごとの台本と組み立て（build・video）。git 管理外で手元だけにある
              （メモ notes-*.md は docs/otomad/works/ へ移す。使い回す部品は lib/ へ出す）
    inmu/       淫夢の試作（inmu_v3 は lib の部品を曲の SECTIONS・SIX で呼ぶ窓口で、多くの曲が読む）
    samson/     サムソン・2号式（samson_build / samson_2go_build は lib の部品を名前そのままで読み直す）
    nigo/       野獣・KBTIT の2号式
    cookie/     クッキー☆（cookie_list で素材の 7z を展開、cookie_v1 は台詞の定義）
    plasti/     Plasticookie☆Adventure 型
    techno/     TECHNO MUSIC 先輩型（techno1_build はドラム・シンセの部品）
    dande/      Dandelion biscuit☆型と文字PV（dande3）
    kaisen/     既存曲のカバー（海鮮リスペクト）
    hijikata/   既存曲のカバー（picotune の MIDI をサウンドフォントで鳴らす。ネイティブフェイス × 変態糞土方）
    kary/ cpr/ eahon/
  analysis/   参考の曲・動画の測定（切り替え・明るさ・音量・拍・文字起こし）
  tools/      聴き返しの棚・動画を見返す棚（video_shelf）・録音の時刻合わせ・書き出し補助・3D モデルの描き出し（model_view）
```

どのスクリプトも冒頭で `lib/paths.py` を読み込む。これで lib・songs の各フォルダ・analysis・tools が `sys.path` に入るので、フォルダをまたいだ import がそのまま通る。

## 別の PC で再開する

1. **リポジトリと Python**: [speech-melody/README.md](../speech-melody/README.md) の §1 のとおり venv を作る。そのあと次を入れる。

   ```bash
   .venv-speech/Scripts/python -m pip install -r scripts/otomad/requirements.txt
   ```

   ffmpeg（動画の書き出し・測定）と 7-Zip（`C:\Program Files\7-Zip\7z.exe`。クッキー☆の素材の展開）も入れる。動画は CUDA の torch があれば GPU で描く（無ければ CPU で遅くなるだけ）。
   動画の符号化もグラボ（NVENC）が標準。ffmpeg の引数は `lib/venc.py` の `venc(q)` から取り、新しい書き出しも libx264 を直に書かない。CPU に戻すときは `VIDEO_ENC=x264`（NVENC の無い PC では自動で戻る）。
2. **曲のスクリプトと作品台帳**: `scripts/otomad/songs/` と `docs/otomad/works/` は git に入っていないので、元の PC から丸ごと写す（曲同士が `inmu_v3`・`samson_build`・`cookie_v1` などを読み合うので、一部だけでは動かない）。写さなくても、新しい曲は `lib/` の部品（`clip_grid`・`pitch_snap`・`voice_inst`）から作れる。
3. **素材**: 音MAD素材のフォルダ（今は `D:\音MAD素材`。中は `淫夢/`・`クッキー☆/`・`エア本/`）を写す。場所が違えば `.env` に書く。
4. **`.env`**（リポジトリ直下、gitignore）:

   ```
   SPEECH_MATERIAL_DIR=D:\音MAD素材
   # 任意。既定は scratch/speech-melody
   OTOMAD_WORK=D:\otomad-work
   # 任意。エージェントが集めた素材の置き場。既定は <SPEECH_MATERIAL_DIR>/AI
   OTOMAD_AI_DIR=D:\音MAD素材\AI
   # 任意。pip --target で numpy の版を分けて入れた外部ライブラリ
   SPEECH_PYLIB=D:\otomad-work\pylib
   ```

5. **作業フォルダを作る**: クッキー☆の台詞は 7z を展開して使う。

   ```bash
   python -I scripts/otomad/songs/cookie/cookie_list.py x RU姉貴 UDK姉貴 HNS姉貴 BNKRG姉貴 MZ姉貴 JOKER姉貴
   ```

6. **フォント**（dande3 の文字PV）: コーポレート・ロゴ Bold・クラフト明朝・美咲ゴシックを「ユーザー用」に入れる（`%LOCALAPPDATA%\Microsoft\Windows\Fonts`）。Noto Sans JP と游ゴシックは Windows 標準。

## BB素材を集める（tools/bb_fetch.py）

ブルーバック・グリーンバックの BB素材（ニコニコの「BB素材」タグなど）を、探す → 落とす → 使う範囲を透過の連番 PNG にする、まで1本で流す。エージェントがクラウドで流してもよい。yt-dlp・ffmpeg・numpy・pillow を使う。

```bash
python -I scripts/otomad/tools/bb_fetch.py search 現場監督 BB素材 --check
```

```bash
python -I scripts/otomad/tools/bb_fetch.py get sm28427080
```

```bash
python -I scripts/otomad/tools/bb_fetch.py key sm28427080 現場監督_ドッスン --ss 0 --to 5
```

- 置き場所は `<SPEECH_MATERIAL_DIR>/AI/<ジャンル>/BB/<動画ID>/`（`AI/` は `OTOMAD_AI_DIR` で変えられる。ジャンルはタグから推定し、`get --genre` で渡してもよい）。`source.mp4`・`info.json`（題・URL・投稿者・タグ）・`sheet.png`（全体の一覧）と、切り抜きごとのフォルダ（`0001.png`…・`meta.json`（fps・外接矩形 bbox・地の色）・`sheet.png`（市松の地に並べた確認用））。集めたものの一覧は `AI/index.json`。所有者が手で置いた素材（素材フォルダ直下）には書かない。
- 流れの全体（範囲の決め方・透過の直し方・`*_video.py` での貼り方・持ち越し）は [docs/otomad/bb-flow.md](../../docs/otomad/bb-flow.md)。配られているスターターパックの一覧は [docs/otomad/research/material-packs.md](../../docs/otomad/research/material-packs.md)。
- 地の色は画面の縁から推定する。外れたら `--color 0000FF`。縁ににじみが残れば `--erode 2`、絵の中まで抜けたら `--tol` を下げる。黒い頭出しのコマなどがあると bbox が画面全体になるので、`--ss` で外す。
- `*_video.py` からは PIL で連番を読み、`alpha_composite` で貼る。
- **クラウドから取れるのは「日本国内のみ」でない動画だけ**（`--check` で見る。2026-11-01 の時点で、現場監督・ガバ穴ダディーの BB素材の半分ほどが国内のみだった）。YouTube はクラウドからは取れなかった。取れないものは手元の PC で同じコマンドを流し、素材のフォルダごと渡す。
- 素材は他の方の作品なので、git に入れず公開しない。

## 作った動画を見返す（tools/video_shelf.py）

作曲の棚（`tmp/songs/index.html`）・台詞作曲の棚（`shelf/index.html`）と同じ形（左に一覧、右に詳細）で、BB劇場・音MAD の動画を見返すページを作る。

```bash
.venv-speech/Scripts/python -I scripts/otomad/tools/video_shelf.py
```

- 書き出し先は `scratch/videos/index.html`（ひな形 `tools/video_shelf.html`）。載せるのは手元の台帳（`docs/otomad/works/<作品>.md`）と書き出した動画（`scratch/<作品>/out/video.mp4` など）から見つけた作品のうち、動画が手元にあるもの。系統・型と狙いは台帳の見出しと「狙い」から読む。動画は台帳の「書き出し: `…`」、無ければ `scratch/<作品>/out/video.mp4`、`<作業フォルダ>/<作品>/video.mp4` の順に探す。
- 詳細には台帳（`<作品>.md`）の本文を出す。緩急計画の「区間（秒）」の行と、下のコマの一覧（8枚、`scratch/videos/thumbs/`）を押すとその秒へ移る。評価は「所有者の評価」の最後の箇条。
- 作品を書き出したり台帳を直したりしたら流し直す（コマは動画が新しくなったものだけ作り直す）。file:// のまま開いてよい。素材の絵と音を含むので公開しない。

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

曲ごとのスクリプト（`songs/`、gitignore）。作品のメモ（台帳）は `docs/otomad/works/` に置く（こちらも gitignore）。素材の音声・絵、素材の写し（`cookie_src/`）、ダウンロードした参考動画（`refs/`）、分離した音（`ana_demucs*/`）、書き出した曲と動画、外部ライブラリ（`pylib/`）。これらは作業フォルダに置く。

## 既知のこと

- 同じ build を2回流すと、声の波形がわずかに違う（台詞の配置 placement.json は同じ）。差は最初の台詞から出る。ハッシュの乱数を固定しても残るので、原因は別にある（未特定）。
- `lib/align.py`・`lib/setting.py` は `scripts/speech-melody/` の同名ファイルの前の版で、ここの曲はこちらを読む。
