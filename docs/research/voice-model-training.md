# 歌声のモデル（歌い手）を自分で作る方法の調べ物

2026-11-01 の調査の記録。その時点で分かったことを残す。後から更新はしない。

> **注意: ここに書いた作り方は、どれもまだ実際には試していない。**
> 資料（README・配布ページ・コミュニティでの共有）を読んでまとめただけで、手順どおりに動くか、出来たモデルが dtm で鳴るかは確かめていない。
> dtm で鳴らすことを確かめたのは、配布されている既製の歌い手（VOICEVOX・NEUTRINO・波音リツ DiffSinger／ENUNU・Sinsy の NIT SONG070 F001）だけ。
> 歌い手を作るところまで実際に試したのは onjmin/koe（UTAU 音源をそのまま使う）だけ。

既製の歌い手を dtm で鳴らす手順は [../guide/local-engines-setup.md](../guide/local-engines-setup.md)。

## 1行でいうと

**利用者が自分で歌い手を作れる道筋が公開されているのは、DiffSinger と ENUNU（NNSVS）と Sinsy（HTS）。** NEUTRINO と VOICEVOX の歌声には、利用者が学習する公開の手順が見つからなかった。作った歌い手を dtm で選ぶには、今は dtm のコードに1行足す必要がある。

| エンジン | 利用者が作れるか | 主な道具 | 作ったものを dtm で鳴らすには |
| :--- | :--- | :--- | :--- |
| DiffSinger | 作れる（公開の手順あり） | openvpi/DiffSinger・MakeDiffSinger・SOFA、Google Colab のノートブック、Voicebank2DiffSinger | OpenUtau の歌い手にして `Singers/` に入れ、`OPENUTAU_SINGERS` に1行足す |
| ENUNU（NNSVS） | 作れる（公開の手順あり） | ENUNU Training Kit、NNSVS のレシピ、fine-tune 用のベースモデル | OpenUtau の ENUNU の歌い手にして `Singers/` に入れ、`OPENUTAU_SINGERS` に1行足す |
| Sinsy（HTS） | 作れる（研究用の道具） | HTS（HMM の歌声合成の学習） | 中継サーバー（`sinsy-server.ts`・`sinsy_synth.py`）が今は付属の声1つしか扱わないので、そこから直す |
| NEUTRINO | 公開の手順は見つからず | — | — |
| VOICEVOX（歌声） | 公開の手順は見つからず | — | — |
| koe（UTAU 音源） | UTAU 音源をそのまま使う | — | 実際に試した（onjmin/koe） |

## DiffSinger

DiffSinger は拡散モデルの歌声合成。いま広く使われているのは openvpi の版で、出来たモデルは ONNX にして OpenUtau で使う。作り方は大きく3つの道筋がある。

### A. DiffSinger モデル制作 wiki の方法（Google Colab）

- 場所: [DiffSinger モデル制作 wiki](https://w.atwiki.jp/dsmodelmaker/)（@wiki。「AI歌声合成エンジン DiffSinger のモデル制作の情報をまとめた」wiki で、書きかけと書かれている）。
- 2026-11-01 にコミュニティで共有された話では、Voicebank2DiffSinger の方法には後で書く規約の心配があるので、なるべくこの wiki の方法（Google Colab）で進めたい、とのこと。
- **wiki の中身は確かめられていない。** 自動取得は 403 で断られた。手順は、ブラウザで開いて読んでから、この記録に足すのではなく新しい記録として書く。
- 関連しそうなもの: 有志の [DiffSinger の Colab ノートブック（MLo7Ghinsan）](https://github.com/MLo7Ghinsan/DiffSinger_colab_notebook_MLo7)。学習データは lab＋wav（NNSVS 形式）、csv＋wav（DiffSinger 形式）、ds を受け付け、ボコーダーの fine-tune 用のノートブックもある。OpenUtau 向けの書き出し（複数辞書対応）は TODO に入っていて、まだできていない。同じリポジトリの SOFA のノートブックは「下書き。使わないか、気をつけて使って」と書かれている。wiki がこのノートブックを使っているかは分からない。
- Google Colab を使う案は、別の調べ物（[singing-engines.md](singing-engines.md) の AI-MGRoid）で、規約と安定性の理由から dtm の仕組みとしては見送った。ただし、ここで言うのは「モデルを作るときだけ Colab を使う」ことで、出来たモデルは手元の OpenUtau で動かすので、話が別。

### B. Voicebank2DiffSinger（UTAU 音源から作る）

- 場所: [Lqm1/Voicebank2DiffSinger](https://github.com/Lqm1/Voicebank2DiffSinger)。ライセンスは GPL-3.0。
- できること: UTAU 音源を解析して音素と単語の並びを取り出し、日本語の SOFA モデルで音素の位置を合わせ、MakeDiffSinger で DiffSinger の学習用データセットにする。**出来るのは学習用のデータセットまでで、学習そのものは別に行う**（A か C）。
- 入力: 音の高さごとのフォルダ（`A3`・`A2`・`A4` など）に分けた UTAU 音源。音声ファイルと同じ名前の `.txt` のラベルが要る。
- 環境: Windows・Visual Studio の C++ デスクトップ開発・CMake・Python 3.11（3.11.11 で確かめたとある）。
- 手順（README の要約）:

  ```bash
  git clone --recursive https://github.com/Lqm1/Voicebank2DiffSinger.git
  cd Voicebank2DiffSinger
  uv sync          # または pip install -r requirements.txt
  # 日本語の SOFA モデル（step.100000.ckpt）を src/ckpt/ に、
  # japanese-extension-sofa.txt を src/dictionaries/ に置く
  python src/main.py example/A3 example/A2
  ```
- **規約の心配**: 使う日本語の SOFA モデルは [colstone/SOFA_Models](https://github.com/colstone/SOFA_Models/releases) の「SOFA Model For Japanese: Ver 0.0.2 Beta」（2023-12-13。歌声向け・ローマ字の辞書）。リリースのページには、ライセンス・利用条件・商用利用の可否が書かれていない（学習データの提供元は `data_providers.md` を見よとある）。SOFA 本体（[qiuqiao/SOFA](https://github.com/qiuqiao/SOFA)）は MIT と表示されているが、配布されている学習済みモデルにも同じ条件がかかるかは、README からは分からない。コミュニティでは「SOFA モデルが商用利用を認めていない」と共有されている。**一次情報（配布元の投稿・`data_providers.md`）で確かめるまでは、商用で使う歌い手づくりには使わない。**

### C. 本家の手順（openvpi/DiffSinger ＋ MakeDiffSinger）

- データセットづくり: [openvpi/MakeDiffSinger](https://github.com/openvpi/MakeDiffSinger)（BSD-3-Clause）。データセットは `raw/wavs/`（録音）と `raw/transcriptions.csv`（書き起こし）。おすすめの流れは、MFA で音素の位置を合わせて acoustic 用のデータセットを作る `acoustic-forced-alignment` と、それを variance 用に広げる `variance-temp-solution`。道具は [openvpi/dataset-tools](https://github.com/openvpi/dataset-tools) に移っていて、録音を切る AudioSlicer、書き起こしの `.lab` を作る MinLabel、variance 用の MIDI 列を直す SlurCutter がある。SOFA は MFA の代わりに使える音素の位置合わせの道具で、学習データの形式は DiffSinger と同じ（SOFA の作者の回答）。
- 学習: [openvpi/DiffSinger](https://github.com/openvpi/DiffSinger)（Apache-2.0）の [Getting Started](https://github.com/openvpi/DiffSinger/blob/main/docs/GettingStarted.md) より。Python 3.10 以上、PyTorch 2.4.0 以上（OS と GPU に合う版を公式の手順で入れる）。

  ```bash
  pip install -r requirements.txt
  # configs/templates の設定をデータの場所へ写して、raw_data_dir・binary_data_dir などを直す
  python scripts/binarize.py --config my_config.yaml
  python scripts/train.py --config my_config.yaml --exp_name my_experiment --reset
  tensorboard --logdir checkpoints/
  # ONNX へ書き出す（OpenUtau で使う形）
  python scripts/export.py acoustic --exp my_experiment
  python scripts/export.py variance --exp my_experiment
  python scripts/export.py nsf-hifigan --config CONFIG --ckpt CKPT   # ボコーダー
  ```

  acoustic（声色）と variance（音の長さ・高さなど）を、それぞれの設定で学習する。必要な GPU の目安は Getting Started には書かれていない。中断しても同じコマンドで続きから学習する。
- 本家の注意書き: 本人の同意なく、特定の人物（政治家・著名人など）の声を作るのに使ってはいけない。
- OpenUtau 向けにまとめる（`character.yaml`・`dsconfig.yaml`・辞書など）手順は Getting Started には無い。波音リツ DiffSinger の配布物の形（[../guide/openutau-sing.md](../guide/openutau-sing.md) の下ごしらえ）が参考になる。

### 作った DiffSinger の歌い手を dtm で鳴らすには（未確認）

1. OpenUtau で読める歌い手のフォルダにして、OpenUtau の `Singers/` に入れる。OpenUtau の画面で歌えることを先に確かめる。
2. 波音リツ DiffSinger と同じ下ごしらえが要るか確かめる（`dsdict.yaml` の場所・`default_phonemizer`・subbank）。
3. `src/voice/openutau-sing.ts` の `OPENUTAU_SINGERS` に1行足す（モデル名 `ou_…`・フォルダ名・表示名・規約のリンク）。
4. 中継サーバーが一覧に出すかを `curl http://127.0.0.1:50023/singers` で見て、DAW で鳴らす。

## ENUNU（NNSVS）

ENUNU は NNSVS（ニューラルネットの歌声合成。研究用ライブラリ、MIT）のモデルを、UTAU の音源のように使うためのプラグイン。OpenUtau からは SimpleEnunuServer 経由で使う（dtm の波音リツ ENUNU と同じ形）。

- **ENUNU Training Kit**（[Coda-SVS/Enunu-Training-Kit](https://github.com/Coda-SVS/Enunu-Training-Kit)）: UST 付きの歌唱データベースから ENUNU 用のモデルを作る道具。Windows 向けの手順で、Python 3.8・CUDA 11.3 対応の PyTorch などを用意する。もとは韓国語向けで、設定の言語の指定（`lang_mode`）と hed・table のファイルを替えると日本語でも学習できるとある。
- **ENUNU 側の注意**（[oatsu-gh/ENUNU](https://github.com/oatsu-gh/ENUNU)）: ふつうの NNSVS のモデルも使えるが、ENUNU Training Kit で作ったほうが少し安定する。モデルの頭に `enuconfig.yaml` を置き、`question_path` には学習で使った質問ファイルを指定して同梱する。フルコンテキストラベルの仕様は Sinsy と違う（フレーズや音楽記号を扱わない）。2022年以降の日本語モデルでは、促音（っ）は独立したノートにするのがおすすめ。
- **少ないデータから作る**: [Canon/nnsvs-wavehax-base](https://huggingface.co/Canon/nnsvs-wavehax-base)（Hugging Face）は、数十分くらいの少ないデータでも fine-tune で実用の質の歌い手を作れるようにするベースモデル（ENUNU Training Kit 2.0.0 のレシピで学習）。
- **NNSVS の本家の手順**: [nnsvs.github.io](https://nnsvs.github.io/) の「Getting started with recipes」（レシピで学習する）、「How to train uSFGAN/SiFiGAN vocoders」、「How to convert ENUNU models to NNSVS' ones」。歌唱データベースの作り方のチュートリアルへのリンクもある。ENUNU 向けのモデルを NNSVS 形式に変えると、一部のモデルが無音になる報告がある（ラベルが Sinsy 形式と一致している前提のため）。
- 作った歌い手を dtm で鳴らすには（未確認）: OpenUtau の `Singers/` に入れ、`character.yaml` に `singer_type: enunu` と `default_phonemizer: OpenUtau.Core.Enunu.EnunuPhonemizer` を書き（波音リツ ENUNU と同じ）、`OPENUTAU_SINGERS` に1行足す。

## Sinsy（HTS）

- Sinsy は HMM（HTS）で学習した声（`.htsvoice`）で歌う。dtm で使っている NIT SONG070 F001 は、名古屋工業大学の歌声データベースで学習した HTS の声（CC BY 3.0）。
- 自分の声を作るには HTS で学習する（名工大の [Software & Resources](https://www.sp.nitech.ac.jp/~tokuda/software.html) に HTS などの一覧）。学習の手順そのもの（HTS のデモの台本）は今回確かめていない。HMM の声は DiffSinger・NNSVS より古い方式なので、作る手間に対して質の伸びしろは小さい。
- NNSVS のデモのページには、権利の都合で NIT SONG070 以外で学習した学習済みモデルは配っていない、学習済みモデルは研究目的に限る、とある。
- 作った声を dtm で鳴らすには: 中継サーバー（`scripts/misc/sinsy-server.ts` の歌い手の一覧と `sinsy_synth.py`）が今は付属の声1つしか扱わないので、`.htsvoice` を選べるように直してから、`SINSY_SINGERS` に1行足す。

## NEUTRINO・VOICEVOX（歌声）

- **NEUTRINO**: 歌声ライブラリは開発元や提携先（例: 琴葉茜・葵のライブラリ）が作って配っている。利用者が自分の歌声でライブラリを学習する公開の手順は見つからなかった。NEUTRINO は研究者向けの東北きりたん歌唱データベースなどを使っていると紹介されている。
- **VOICEVOX**: 歌声の歌い手を利用者が学習する公開の手順は見つからなかった（VOICEVOX の画面で動く読み上げのモデルを研究者が自作した例はあるが、歌声ではない）。
- どちらも、新しい歌い手が配られたら、dtm の表（`NEUTRINO_SINGERS`・`VOICEVOX_SINGERS`）に1行足せば鳴らせる作り。

## 作るときに共通して気をつけること

- **元の声の規約**: UTAU 音源から作るなら、その音源の規約が AI の学習や別の形式への変換・配布を認めているか、音源ごとに確かめる（例: 波音リツの規約 <https://www.canon-voice.com/terms/> は、他ソフトウェアでの利用はそのソフトの規約に従うこと、配布物に同梱の規約が優先されることなどを書いている）。
- **道具やモデルの規約**: 学習に使う学習済みモデル（SOFA の日本語モデル、ベースモデル、ボコーダーなど）の利用条件が、出来た歌い手の使い道を縛ることがある。商用で使うなら、配布元の一次情報で確かめる。
- **人の声**: 本人の同意なく特定の人の声を作らない（openvpi/DiffSinger の注意書き）。
- **dtm 側の作り**: 作った歌い手を、コードを変えずに選べる仕組みは今は無い。中継サーバーは `Singers/` の歌い手を一覧にできるので、それを dtm の選択肢に自動で出すことはできる。ただし、規約のリンクを歌い手ごとに手で付けているので、自動で出すならその扱いを先に決める。

## 出典

- [DiffSinger モデル制作 wiki](https://w.atwiki.jp/dsmodelmaker/)（中身は未確認）
- [Lqm1/Voicebank2DiffSinger](https://github.com/Lqm1/Voicebank2DiffSinger)
- [colstone/SOFA_Models のリリース](https://github.com/colstone/SOFA_Models/releases)・[qiuqiao/SOFA](https://github.com/qiuqiao/SOFA)・[SOFA の学習データの形式についての回答](https://github.com/qiuqiao/SOFA/discussions/5)
- [openvpi/MakeDiffSinger](https://github.com/openvpi/MakeDiffSinger)・[openvpi/DiffSinger](https://github.com/openvpi/DiffSinger)・[Getting Started](https://github.com/openvpi/DiffSinger/blob/main/docs/GettingStarted.md)
- [MLo7Ghinsan/DiffSinger_colab_notebook_MLo7](https://github.com/MLo7Ghinsan/DiffSinger_colab_notebook_MLo7)
- [Coda-SVS/Enunu-Training-Kit](https://github.com/Coda-SVS/Enunu-Training-Kit)・[oatsu-gh/ENUNU](https://github.com/oatsu-gh/ENUNU)・[Canon/nnsvs-wavehax-base](https://huggingface.co/Canon/nnsvs-wavehax-base)・[nnsvs/nnsvs](https://github.com/nnsvs/nnsvs)・[nnsvs.github.io](https://nnsvs.github.io/)・[NNSVS demos](https://nnsvs.github.io/notebooks/Demos.html)
- [HTS Voice NIT SONG070 F001](https://sinsy.sourceforge.net/readme_hts_voice_nitech_jp_song070_f001.php)・[名工大 Software & Resources](https://www.sp.nitech.ac.jp/~tokuda/software.html)
- NEUTRINO の紹介記事（[電ファミニコゲーマー](https://news.denfaminicogamer.jp/news/220801f)）
