# OpenUtau（DiffSinger・ENUNU）で歌わせる（試作）

歌詞トラックの音源に OpenUtau の歌い手（`ou_` で始まるモデル名）を選ぶと、利用者の手元の OpenUtau で歌わせる。
DiffSinger や ENUNU（NNSVS）のような AI の歌い手を、NEUTRINO と同じ形（MusicXML を送ると WAV が返る）で使う。楽譜の組み立てと、トラック全体を1回で合成してフレーズに切って並べる仕組みは NEUTRINO と共通（[neutrino-sing.md](neutrino-sing.md)）。
dtm は OpenUtau も歌い手も同梱しない。

**OpenUtau の書き出しコマンド（`OpenUtau render`）は、本家への提案 [PR #2162](https://github.com/openutau/OpenUtau/pull/2162) の段階で、2026-10-31 時点では公式の版に入っていない。** 試すには提案のブランチ（`christianazinn/OpenUtau` の `christian/cli`）を自分で組み立てる。公式に入ったら、その版に置き換える。

## 使い方

1. **OpenUtau（CLI つき）を用意する**。.NET 8 SDK で組み立てる。

   ```bash
   git clone -b christian/cli https://github.com/christianazinn/OpenUtau.git
   dotnet publish OpenUtau/OpenUtau/OpenUtau.csproj -c Release -r win-x64 --self-contained false -o <OpenUtau のフォルダ>
   ```

   SDK を管理者権限なしで入れたときは、OpenUtau を動かす前に `DOTNET_ROOT` をその SDK のフォルダにする。
2. **歌い手を入れる**（波音リツ DiffSinger の例。配布は [canon-voice.com](https://www.canon-voice.com/voicebanks/)）。
   - 配布の zip を `<OpenUtau のフォルダ>/Singers/` に展開する（`Singers/NamineRitsu_DiffSinger/`）。
   - ボコーダー `nsf_hifigan.oudep`（配布の readme が指す [xunmengshe/OpenUtau の版](https://github.com/xunmengshe/OpenUtau/releases/download/0.0.0.0/nsf_hifigan.oudep)）を `Dependencies/nsf_hifigan/` に展開する。
   - **下ごしらえ（2023年の配布物を今の OpenUtau で読むため）**
     - `dsdur/dsdict.yaml` を歌い手フォルダの直下へ写す（日本語の音素変換が、かな・ローマ字 → 音素の辞書を直下に探す）。
     - `character.yaml` の `default_phonemizer` を `OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer` にする（配布物は汎用の音素変換を指していて、かなの歌詞を読めない）。中継サーバーは歌い手ごとにこの値を使う。
     - `character.yaml` の末尾に、声の種類（subbank）を1つ足す。無いと音素変換が「No subbanks defined」で止まる。

       ```yaml
       subbanks:
         - color: ""
           prefix: ""
           suffix: ""
           tone_ranges:
             - C1-B7
       ```
3. **ENUNU の歌い手を使うとき**（波音リツ ENUNU #4130 の例）
   - ENUNU は OpenUtau の外に「ENUNU のサーバー」を起動しておき、OpenUtau がそこへ問い合わせる。波音リツの ENUNU 版には SimpleEnunu が要るので、[rokujyushi/SimpleEnunu](https://github.com/rokujyushi/SimpleEnunu/releases) の **SimpleEnunuServer 0.5.0** を展開する。
   - 同梱の Python に PyTorch が入っていないので入れる（CPU 版の例。GPU 版は付属の `reinstall_torch.bat`）。

     ```bash
     python-3.9.13-embed-amd64/python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
     ```
   - `simple_enunu_server.bat`（または `python-3.9.13-embed-amd64/python.exe simple_enunu_server.py`）で起動する。初回は pyzmq を自分で入れる。
   - **注意: SimpleEnunuServer は `tcp://*:15556` で待ち受ける（手元だけでなく LAN 全体、認証なし）。** Windows のファイアウォールで外からの接続を許可しない。外部ソフトの作りなので dtm 側では直せない。
   - 配布の zip（[canon-voice.com](https://www.canon-voice.com/voicebanks/)）を `Singers/NamineRitsu_ENUNU/` に展開し（フォルダ名の `#` は外す）、`character.yaml` を作る。

     ```yaml
     singer_type: enunu
     default_phonemizer: OpenUtau.Core.Enunu.EnunuPhonemizer
     text_file_encoding: shift_jis
     ```
4. **中継サーバーを起動する**（OpenUtau を入れた PC で）。

   ```bash
   npx tsx scripts/misc/openutau-server.ts --openutau <OpenUtau のフォルダ>
   ```

   既定は `http://127.0.0.1:50023`、音素変換は `OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer`、推論は `DirectML`（GPU）。`--phonemizer` `--onnx-runner CPU` `--port` で変える。file: で開いたページから使うときだけ `--allow-file-origin`。
5. dtm のページを手元で開き、歌詞トラックの音源の「OpenUtau・DiffSinger（要サーバー起動）」から声を選ぶ。MML では `@@0 ou_ritsu_ds どんぐりころころ…`。

| モデル名 | 歌い手（`Singers/` のフォルダ） | 規約 |
| :--- | :--- | :--- |
| `ou_ritsu_ds` | 波音リツ DiffSinger（NamineRitsu_DiffSinger） | [canon-voice.com/kiyaku.html](https://www.canon-voice.com/kiyaku.html) |
| `ou_ritsu_enunu` | 波音リツ ENUNU #4130（NamineRitsu_ENUNU。SimpleEnunuServer が要る） | 同上 |

歌い手を増やすときは `src/voice/openutau-sing.ts` の `OPENUTAU_SINGERS` に1行足す。

## 中継サーバー

`scripts/misc/local-engine-server.ts` が NEUTRINO と共通の口と安全のための決まりを持つ（127.0.0.1 だけで待ち受け、Host・Origin を確かめ、歌い手の名前はインストール済みの一覧と完全一致だけ通す）。OpenUtau は `OpenUtau render --input score.musicxml --output score.wav --singer <フォルダ名> --phonemizer … --onnx-runner …` で呼ぶ。音素変換は歌い手の `character.yaml` の `default_phonemizer`（無ければ起動時の `--phonemizer`）、推論の種類は起動時の引数で決まり、ブラウザからは変えられない。歌い手の表示名は `character.txt` を UTF-8 で読み、読めなければ Shift_JIS で読む。

## 確かめたこと（2026-10-31、RTX 5060 Ti）

- dtm が書いた MusicXML（どんぐりころころの頭8音）を波音リツ DiffSinger で歌わせた。CPU で約4.3秒、DirectML で約2秒（初回は GPU の準備で7秒ほど）。音の高さは8音のうち6音が楽譜と ±0.1 半音、2音が1オクターブ下と出た（測り方の取り違えとみているが、耳では確かめていない）。
- 波音リツ ENUNU #4130 でも歌わせた（SimpleEnunuServer 0.5.0・PyTorch 2.8 CPU 版）。CPU で約14〜17秒。音の高さは8音のうち7音が ±0.1 半音、1音が1オクターブ下と出た（測り方の取り違えとみている）。
- デモの DAW（ヘッドレスの Edge）で `ou_ritsu_ds`・`ou_ritsu_enunu` のトラックを再生し、2つのフレーズが伴奏と同じアンカーから計算どおりの時刻に置かれた。規約のリンクは canon-voice.com の規約を指した。

## ENUNU が「float division by zero」で落ちる件（2026-11-01 に切り分け）

海鬼月（約3分）を ENUNU で歌わせると、合成の最初の段階（タイミング）で ENUNU のサーバーが `float division by zero` を返して落ちた。曲の長さは関係ない（96音・48秒の曲は通った）。

- **短い音・短い休符**: テストの楽譜で、音 29ms・音の間の休符 20ms 以下で落ち、音 40ms・休符 30ms 以上は通った。dtm が書く楽譜には、音の長さの丸めや継続の高さの区切りから、30ms 前後の音や 10〜20ms の休符のかけらが混じっていた。→ dtm 側で、MusicXML を書く前に 50ms 未満の休符・音を隣の音へまとめるようにした（`absorbTinyFragments`。NEUTRINO・DiffSinger・Sinsy も同じ楽譜を使う）。
- **子音だけのフレーズ**: それでも、休符の直後の音の子音（例:「きゅ」の ky）が、OpenUtau から ENUNU へ2回目に送る楽譜で、子音だけの1音のフレーズに切り離されることがある。1音だけのフレーズは、ENUNU が楽譜を変換する utaupy の `hts.py` の `_fill_e24_e25` で「フレーズの長さ」が 0 になり、0 で割って落ちる。dtm の楽譜からは避けきれない。
- **回避方法（手元の SimpleEnunuServer を書き換える）**: `python-3.9.13-embed-amd64/lib/site-packages/utaupy/hts.py` の `_fill_e24_e25` にある2か所の `counter_100ns / phrase_length_100ns` を `counter_100ns / (phrase_length_100ns or 1)` にして、サーバーを起動し直す。手元ではこれで海鬼月の歌の3トラックとも最後まで歌えた（CPU で 1〜5 分）。外部ソフトの書き換えなので、SimpleEnunu の版を上げたらやり直す。

## 制約

- OpenUtau の CLI が公式の版に入るまでは、提案のブランチを自分で組み立てる必要がある。
- 歌い手ごとに下ごしらえ（辞書・subbank）が要ることがある。
- 歌えるのは単旋律だけ。ほかの制約は NEUTRINO と同じ。
