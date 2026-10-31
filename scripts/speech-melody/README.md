# 台詞イントネーション作曲（scripts/speech-melody）

音MAD素材の台詞を BPM の16分格子へ伸縮し、モーラごとに音の中心をペンタへ寄せて、手書きの旋律・和音の伴奏（dtm の DAW）に載せる。

```
台詞の定義 ──build──▶ voice.wav（声だけ・曲頭=0）
                      daw.json（伴奏の音符）──録音ページ──▶ acc.wav / lead.wav
                      placement.json                             │
                                          mix.py ◀───────────────┘ ──▶ song.wav ──shelf_build.py──▶ 聴き返しページ
```

素材の音声・書き出した曲・台詞の書き起こし・耳コピ由来の旋律は git に入れない。書き出し先の既定は `scratch/speech-songs/`（gitignore）。

## 1. セットアップ

Python 3.10 と Node 22（リポジトリの volta 設定）で確かめた。

```bash
python -m venv .venv-speech
```

```bash
.venv-speech/Scripts/python -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu118
```

```bash
.venv-speech/Scripts/python -m pip install -r scripts/speech-melody/requirements.txt
```

`requirements-extra.txt`（demucs・whisper 用 transformers・yt-dlp）は素材探しと作例の測定にだけ使う。build・録音・mix には要らない。

はまりどころ:

- **numpy は 1.x に留める。** pyopenjtalk-plus などを入れると numpy 2.x へ上がり、torch 2.7 / librosa の組と食い違うことがある。requirements で `numpy==1.26.4` に固定している。既存の環境を崩したくなければ `pip install --target <フォルダ> pyopenjtalk-plus pyworld` で別フォルダへ入れ、`SPEECH_PYLIB=<フォルダ>` を設定する（sys.path の末尾へ足すので既存の numpy が勝つ）。
- **torchaudio の版。** 強制整列に `torchaudio.pipelines.MMS_FA` と `torchaudio.functional.forced_align` を使う。2.7.1 で確かめた。新しい torchaudio はこの API を外していることがあるので、上げるなら `python scripts/speech-melody/align.py <wav> <読み>` で先に確かめる。初回はモデル（約1.2GB）を取りに行く。
- **GPU 版 onnxruntime。** この流れ自体は onnxruntime を使わないが、同じ環境で basic-pitch などを入れると CPU 版 `onnxruntime` が GPU 版を黙って上書きする（同じ import 名）。入れたら `pip uninstall -y onnxruntime onnxruntime-gpu && pip install onnxruntime-gpu==1.23.2` で戻し、`onnxruntime.get_available_providers()` に CUDA があるか見る。
- **pyopenjtalk-plus の辞書。** 初回の import で辞書を取りに行く。オフラインの PC では一度ネットにつないで `python -c "import pyopenjtalk; pyopenjtalk.g2p('あ')"` を通しておく。
- GPU が無くても動く（整列と pyin が遅くなるだけ）。

録音には dtm の dist が要る。

```bash
pnpm install
```

```bash
pnpm build
```

```bash
node scripts/speech-melody/rec/make-dist-rec.mjs
```

## 2. 素材の配置

素材はリポジトリの外に置き、場所を環境変数かリポジトリ直下の `.env`（gitignore）で渡す。

```
SPEECH_MATERIAL_DIR=D:\音MAD素材
# 任意
SPEECH_OUT_DIR=D:\speech-songs
SPEECH_PYLIB=C:\path\to\pylib
```

1台詞＝1ファイルの wav を想定する（素材パックの「台詞名.wav」）。前後の無音は自動で詰める。長い1ファイルから切り出す仕組みは無いので、先に切っておく。

## 3. 台詞の定義

`lines_example.py` を写して、リポジトリの外か `scratch/` に置く（素材依存なので git に入れない）。

```python
from config import line

ANCHOR = 0.0   # 格子に合わせる点。0.0=子音の頭、1.0=母音の頭
CENTER = 52.0  # 台詞の音域をそろえる中心（MIDI）。台詞ごとに ±3 半音まで移調して寄せる

SHOP = "架空の店長/朝礼セット"              # SPEECH_MATERIAL_DIR からの相対パス（その下を探す）
OHAYO = line(SHOP, "おはようございます.wav", "おはようございます")
LINES = [OHAYO, ...]
```

- 読みは実際の発音どおりに書く（伸ばし「でーす」、促音、言いよどみは「、」）。整列はこの読みのモーラ数で行う。整列がおかしい台詞は `python scripts/speech-melody/align.py <wav> <読み>` で各モーラの時刻を見る。
- `ANCHOR`: 子音・息の長い素材は 1.0（母音の頭を格子へ。測定で16分への揃い R16 が 0.05→0.46）、子音の短い素材は 0.0 が合った。
- 系統（メーカー・シリーズ・演者）をまたいで混ぜると散らかりやすい（目安）。

## 4. build

`build_example.py` は見本（145BPM・20小節、A マイナーペンタのリード、セブンスの2拍和声、台詞は合いの手）。1曲ごとに写して、旋律・和音・構成・台詞の置き場所（`SLOTS`）を書き換える。作る前に、その曲で振り切る軸を1文で `notes.md` に書く（AGENTS.md「Making a song for the owner」）。

```bash
python scripts/speech-melody/build_example.py song1 --lines scratch/my_lines.py --title "題名"
```

`SPEECH_OUT_DIR/song1/` に voice.wav・daw.json・placement.json・meta.json を書く。`python scripts/speech-melody/check.py song1` で立ち上がりの格子への乗り方と補正量を測れる（合否ではなく目安）。

中で起きること（`setting.py` → `voice.py`）:

1. **強制整列**（`align.py`）: 読みを pyopenjtalk でモーラにし、MMS_FA で各モーラの子音と母音の時刻を取る。
2. **母音頭の確認**（`setting.refine_onsets`）: 音響の立ち上がりと半分以上合えば吸着、合わなければ立ち上がりだけで割り当てる。モーラごとの音高は pyin の中央値（台詞の中央値からの半音）。
3. **配置**（`voice.place`）: 全モーラを16分へ置く DP。強い音節（音量・句頭・長さ）を拍頭へ、伸縮を元の 1.25 倍付近に保つ。弱起可。
4. **音程補正**（`voice.correct`）: 台詞ごとに音域をそろえる移調（±3 半音）→ モーラごとに音の中心だけを調のペンタへ。元の上下（0.5 半音以上）と横ばいを保ち、補正は ±1.5 半音まで。モーラ内の揺れは残す。
5. **再合成**（`voice.render_voice`）: WORLD で格子へ伸縮し、f0 にモーラごとの補正比を掛ける（つなぎ目 20ms）。

旋律から和音を付ける場合（作者の手順の4）は `voice.harmonize` を使う。

## 5. 録音

伴奏は dtm の DAW で鳴らして実時間で録る。`.claude/launch.json`（gitignore）に次を足して、`speech-rec` を起動する。

```json
{ "name": "speech-rec", "runtimeExecutable": "node", "runtimeArgs": ["scripts/speech-melody/rec/server.mjs"], "port": 40321 }
```

`http://localhost:40321/?song=song1` を開くと daw.json を DAW（上級者モード）へ書き込む。「伴奏とリードを録る」で、伴奏（ドラム込み、リードの t0/t1/t2/t14 を消す）→ リードだけ、の順に曲頭から最後まで録り、`acc.wav` / `lead.wav` を曲のフォルダへ保存する。曲の長さの2倍ほどかかる。音はスピーカーに出ない（`setSinkId({type:"none"})`）。書き込み直すときはページを開き直す。

録音には `rec/dist-rec/`（`make-dist-rec.mjs` が作る dist の写し）を使う。先読みを 0.5→3 秒、割り込み判定を 0.5→5 秒に書き換えてあり、ページが裏に回ってタイマーが1秒に間引かれても途切れない。src の既定は変えていない。`src/audio/sequencer.ts` の該当行が変わると make-dist-rec.mjs が止まるので、PATCHES を直す。

## 6. mix

```bash
python scripts/speech-melody/mix.py song1 --lead-db 0
```

伴奏＋リードに台詞を足して `song.wav`（と `song_inst.wav`）を書く。録音の頭の遅れは、伴奏の立ち上がりを16分格子へ畳んだ位相（円周平均）から求める。集中度が 0.5 未満と出たら、波形を見て `--offset 秒` で渡す。台詞は伴奏より 3dB 上にそろえる。

## 7. 聴き返し

```bash
python scripts/speech-melody/shelf_build.py
```

`SPEECH_OUT_DIR/shelf/index.html` を書く。speech-rec のサーバーで `http://localhost:40321/shelf/index.html` を開く（Range に応えるので再生位置を動かせる）。小節の行を押すとその位置へ移る。題名・素材・伴奏・評価は各曲の `meta.json`（`title` `material` `accomp` `verdict`）を手で直す。素材の音声を含むので公開しない。

## 8. 動画まで作る（音MAD）

所有者に曲と動画を渡すときの流れ。作例のスクリプトとメモは [`scripts/otomad/`](../otomad/README.md) にある（曲は `songs/<系統>/*_build.py`、動画は `*_video.py`、メモは `notes-*.md`）。素材の写し・キャッシュ・書き出しは作業フォルダ（既定 `scratch/speech-melody/`、gitignore）に置く。

1. **素材**: 所有者が指定したフォルダ（今は `D:\音MAD素材` ＝ `SPEECH_MATERIAL_DIR`）の中を見て台詞を選ぶ。前に使った抜き出しだけで済ませない。性的・下ネタの素材も使ってよい。1本の中では系統（同じシリーズ・演者）をそろえる。
2. **先に notes.md へ書く**: 振り切る軸（1〜2つ）、筋書き（誰が出て、何が起きて、どこがオチか）、緩急の設計（区間ごとの密度、いちばん強い所とその手前の引き算）。
3. **曲**: 台詞イントネーション作曲で台詞を主旋律にする。作例は伴奏まで Python で鳴らすので、5・6 の録音と mix を通らない。書き出すのは song.wav と placement.json（台詞ごとの小節・人・モーラの16分位置・単語）。
4. **動画**: placement.json を読み、台詞の頭・モーラ・拍に演出を合わせる。全画面の計算は torch で GPU に載せ、絵の貼り付けは PIL、フレームは multiprocessing で並べて作る。確認は `FPS=15`、渡すのは 30fps。
5. **確かめる**: 指定した秒のコマ、全体の一覧画像（ffmpeg の tile）、1秒を細かく並べた帯で、字や顔がモーラと拍に合っているかを見る。6秒ごとの明るさ・動き・音量を測り、区間ごとに段が付いているかを見る（合否ではなく目安）。

はまりどころ: 雑音の多い素材（淫夢の SP パックなど）は pyin がほぼ全部を無声と読む。作例はモーラの音程を WORLD の harvest で取っている。長い台詞は整列が数モーラに潰れることがあるので、配置の結果が全部同じ位置になっていないか見る。

### 緩急と物語性

所有者の評価と、ネットの講評（`scripts/otomad/docs/notes-inmu-cookie-staging.md` に出典）から。

- 区間ごとの密度に差を付ける。拍に合っていても、全編同じ密度だと疲れる。音（層の数・音量）と映像（動き・切り替え）の両方で、少なくとも3段に分ける。文字PVの作例（dande3）は、映像には段があったが、音は −11 dB で平らだった。
- いちばん強い所の直前で引く。止める、字を消す、地だけにする、無音の1拍を入れる、など。強い地や派手な見せ方は最初から全部出さず、後半まで取っておく。
- 筋書きは、人の出入りと関係の変化で作る。客が1人ずつ来る → 「ん？」で暗転 → 戻って全員で回す、という作例（dande2）は「オリジナルにしてはかなり良い演出」と言われた。オチの台詞の前には1拍の間を置く。
- 同時に目立つ要素は2つまでにする。単色の地は、寄り・引きや位置を変えないとスライドショーに見える。
- 字はモーラが鳴る瞬間に1字ずつ出す。語ごとに出すと、伸ばしたモーラの字が音より先に見える。

## 9. 既存曲のカバー（台詞イントネーションで歌わせる）

既存曲の伴奏の上で、素材の台詞に歌わせる。原曲の譜面（MIDI）を使うかどうかで2通りある。作例は `scripts/otomad/songs/kaisen/`（海鮮リスペクト。譜面は MML から `kaisen_parse.ts` で JSON にした）。

原曲の音声・MIDI・耳コピ・inst は他の方の曲なので、git にも公開物にも入れない（`scratch/` か `SPEECH_OUT_DIR` に置く）。

### 9-1. 譜面（MIDI）を使う

1. **譜面を用意する**: 所有者の耳コピ .mid、picotune（AGENTS.md の API。`/picotune/songs/:file` で .mid を取れる）、MML、自動採譜（Demucs → Basic Pitch。道具は削除済みで git の履歴にある）のいずれか。自動採譜で合うのは歌とベースの半分ほどなので、下書き扱いにする（`docs/research/transcription-eval.md`）。生の tick のまま測ると結論が逆になることがあるので、先に16分格子へ量子化する。
2. **トラックの役割を決める**: 歌の旋律・ベース・和音を、トラックごとに決める。
3. **台詞の当て方を区間ごとに選ぶ**:
   - **旋律に当てる（歌わせる）**: 歌の旋律の句ごとに、モーラ数と強い音節の位置が近い台詞を選ぶ。モーラを旋律の音符の頭へ置き、音程を旋律の音へ寄せる。移調は台詞全体で ±3 半音まで。それを超える句は台詞を替えるか、オクターブで逃がす。
   - **和音に当てる（台詞の抑揚を残す）**: ベースと和音のトラックから2拍ごとの和音の格子を作る（`kaisen_voice.harmony_grid`）。台詞を半小節の頭に置き、和音に最も合う移調を選ぶ（`fit_score`）。抑揚はペンタへ寄せるだけ。
4. **伴奏**: MIDI を DAW で鳴らして録るか（5・6 の流れ）、原曲の inst を使う（9-2 の 3〜4）。

### 9-2. 譜面を使わない（裏で inst を流すだけ）

1. **inst を用意する**: 公式のオフボーカルがあればそれを使う。無ければ Demucs（htdemucs）で歌を抜く。inst 版は完成版と頭がずれていることがある（作例では +312ms）。
2. **格子を測る**: テンポと小節頭を求める。立ち上がりを16分格子へ畳んだ位相の円周平均で、頭のずれを決める（`mix.py` と同じ考え方）。集中度が低ければ波形を見て手で決める。
3. **和音を測る**: inst のクロマを2拍ごとに取り、調と和音の格子を作る。あとは 9-1 の「和音に当てる」と同じように台詞を置く。旋律が無いので、台詞の抑揚が旋律になる（台詞イントネーション作曲の本来の形）。
4. **混ぜる**: `kaisen_mix.py` のように、ずれた分だけ声をずらして足す。声が鳴っている所で、声を伴奏より 3dB 上にする。

### 9-3. どちらでも

- **原曲の構成を緩急の骨組みにする**: Aメロは台詞を少なく、サビは密に。原曲の落ちサビや間奏は、台詞を止める場所に使う。
- **物語性**: 原曲の歌詞の意味や空耳に合う台詞を、句ごとに当てる。
- **作る前に notes.md へ書く**: 当て方（旋律／和音）を区間ごとに、振り切る軸と一緒に書く。
- **確かめる**: 台詞の立ち上がりを inst の16分格子に畳んで、ずれていないか見る。旋律に当てた区間は、モーラと旋律の音の頭がそろっているかを見る。和音に入る率は目安で、合否にはしない。

### 9-4. 台詞の層だけ渡す（BGM は人が用意する）

後で人が台詞イントネーションの層だけを使い、BGM は自分で用意する場合がある。どの作り方でも、混ぜた曲とは別に、次を曲のフォルダへ必ず書き出す。

| ファイル | 中身 |
|---|---|
| voice.wav | 台詞だけ。曲頭（1小節目の頭）＝0秒。リバーブ・圧縮・音量の自動調整をかけない。44.1kHz |
| voice_<人>.wav | 話者が2人以上いるときは、人ごとに分けた同じ長さの wav |
| click.wav | 拍のクリック（小節頭だけ高い音）。voice.wav と同じ長さ・同じ曲頭 |
| grid.json | テンポ、拍子、曲頭のずれ、調、2拍ごとの和音、区間（小節の範囲と名前） |
| placement.json | 台詞ごとの小節・人・モーラの16分位置と音程 |

- **inst が手元に無いとき**: テンポと調を人から聞く。聞けないときは自分で決めて grid.json に書く。台詞の音程は調のペンタへ寄せるだけにし、和音へは寄せない。ペンタの音だけなら、同じ調の BGM であれば大きくぶつからない。和音の進行を決めたときは grid.json に書き、BGM 側に合わせてもらう。
- **inst が後から来たとき**: テンポと調が grid.json と合っていれば、ずれの秒数だけ渡して `kaisen_mix.py` で混ぜる。合わなければ grid.json を直して build し直す。台詞を置き直すので、placement.json も変わる。
- 確認用の伴奏（Python や DAW の仮の伴奏）は混ぜた曲にだけ入れ、voice.wav には入れない。

## 作り方の要点

作者（ももも味）の手順（「台詞イントネーション作曲、台詞からメロディーを作るのってどうやってる？」2021-12-24）:

1. BPM を決める（♩=100〜130。1拍に最大4モーラ＝16分）。
2. 普通の音MADと同じ台詞合わせ（タイムストレッチ）でリズムを先に済ませる。
3. モーラ単位に音程を補正して十二平均律へ合わせ、採譜してシンセで確かめる。音階はペンタ（ヨナ抜き）を多用し、台詞の最後の音を主音にしたスケールを選ぶ。抑揚に厳密に従わなくてよい。
4. コードはメロディーから付ける。
5. 構成（素材が少なければループで尺を伸ばす）。

セリフ合わせのコツ: 長い子音は格子の前後へ散らし母音を格子へ／強拍に強い音／息継ぎ後の母音は1単位後ろへ／音程変更は ±3 半音が限度で上下の向きをそろえる／伸縮は言葉の区切りで切るとハキハキする／三連は多用しない。

作例の実測（2曲）: 台詞は元の 1.15〜2.05 倍に**不均一に**伸ばし、台詞ごとに 0〜+1.5 半音移調。音節の立ち上がりは16分に強くそろい、拍頭は偶然（25%）より多い 32〜34%（強い音節の上位25%では 50%）。伴奏の和音は声の音高に合わせ、句の下で保つ（1音ずつ追わない）。声はほぼ途切れない。

### 2号スタイル（build_example.py の型）

台詞から旋律を作る台詞イントネーション作曲と違い、**曲（手書きの旋律と和音）が先で主役**、台詞は合いの手。面白さの核は、汚い素材の裏でおしゃれなテクノが鳴る落差。実測（8曲）での規則:

- テンポ 140〜180（中央145）、4つ打ち＋裏8分ハット、ベースは8分オクターブか 3:3:2。
- 和音はほぼ全部セブンス、2拍ごと。ⅣM7 が最多、2-5 とその連鎖、ⅣM7–Ⅲm7 の往復。
- 旋律はペンタ中心、16分と3連、広い音域。リードは休まず鳴り続け、4小節の動機を ABAB で回す。最後に全音上へ転調することがある。
- 層は同時4〜5（リード・セブンスの刻み・パッド・ベース）。
- 実測の8曲では、台詞は拍頭から短く打ち込む合いの手が多く、音程は調のペンタへ寄せていた。

これは型の一つで、台詞を旋律に抜擢してよい。台詞そのものを主旋律にするなら、上の「作り方の要点」（台詞イントネーション作曲）の手順で組む。

## ファイル

| ファイル | 中身 |
|---|---|
| config.py | `.env` / 環境変数の読み込み、素材の検索（`line` `find`）、書き出し先 |
| align.py | pyopenjtalk-plus＋MMS_FA の強制整列 |
| setting.py | 立ち上がりでの母音頭の確認（refine_onsets）、句頭、モーラごとの音高 |
| voice.py | load_clips・place（DP）・correct（±1.5 半音）・harmonize・render_voice（WORLD） |
| lines_example.py | 台詞の定義の見本（架空の台詞） |
| build_example.py | 曲の build の見本（2号スタイル） |
| check.py | voice.wav の測定 |
| mix.py | 伴奏・リード・台詞を混ぜる |
| shelf_build.py, shelf_template.html | 聴き返しページ |
| rec/server.mjs, rec/rec.html | 録音ページと手元用サーバー |
| rec/make-dist-rec.mjs | 録音用の dist の写しを作るパッチ |
