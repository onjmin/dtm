# 手元の歌声エンジンを別の PC で動かして確かめる

VOICEVOX・NEUTRINO・OpenUtau（DiffSinger・ENUNU）・Sinsy の声を、まっさらな PC に入れて dtm で鳴らすまでの手順。
エンジンごとの細かい話（仕組み・規約・確かめた結果）は各ページにあり、ここでは「何を、どの順で入れて、どう確かめるか」だけを並べる。

- [voicevox-sing.md](voicevox-sing.md) — VOICEVOX
- [neutrino-sing.md](neutrino-sing.md) — NEUTRINO（規約の解釈は [../research/neutrino-terms.md](../research/neutrino-terms.md)）
- [openutau-sing.md](openutau-sing.md) — OpenUtau（DiffSinger・ENUNU）
- [sinsy-sing.md](sinsy-sing.md) — Sinsy

dtm はどのエンジンも歌声ライブラリも同梱しない。各自が公式の配布元から入れる。全部入れる必要はなく、確かめたいものだけでよい。

## 全体の形

```
ブラウザ（dtm のページ。手元で開く）
  ├─ VOICEVOX エンジン            127.0.0.1:50021（エンジンが直接受ける）
  ├─ NEUTRINO の中継サーバー       127.0.0.1:50022 → NEUTRINO（musicXMLtoLabel・neutrino）
  ├─ OpenUtau の中継サーバー       127.0.0.1:50023 → OpenUtau render
  │                                                   └─ ENUNU のときは SimpleEnunuServer（:15556）
  └─ Sinsy の中継サーバー          127.0.0.1:50024 → WSL の Python（pysinsy・pyworld）
```

中継サーバーは `scripts/misc/` にある Node のスクリプトで、どれも 127.0.0.1 でだけ待ち受け、手元以外のページからの呼び出しを断る。

**声の選択肢は、dtm のページを手元（localhost・127.0.0.1・file:）で開いたときだけ出る。** 公開サイトのページからは選べない。

## 0. 共通の準備

確かめた環境は Windows 11・RTX 5060 Ti（2026-11-01）。NEUTRINO を GPU で動かすなら NVIDIA の GPU が要る。無ければ CPU でも動く（遅い）。

1. Git と Node.js 22・pnpm 10 を入れる（版は `package.json` の `volta` の欄。[Volta](https://volta.sh/) を入れておくと自動でそろう）。
2. dtm を取ってきて、依存を入れる。

   ```bash
   git clone https://github.com/onjmin/dtm.git
   cd dtm
   pnpm install
   ```
3. デモの DAW を組み立てて起動する。

   ```bash
   npx tsup
   npx tsx demo/server.ts
   ```

   `http://localhost:40298/` で開く（`PORT` で変える）。`pnpm dev` でも同じことができるが、`biome format src --write` も走り、改行コードだけの差分が出ることがある。
   **デモのサーバーは組み立て済みの `dist/` を配る。** dtm のコードを変えたら `npx tsup` をやり直す（やり直さないと古いコードのまま鳴る。2026-11-01 に一度これで取り違えた）。

## 1. VOICEVOX（いちばん手軽）

1. [VOICEVOX ENGINE のリリース](https://github.com/VOICEVOX/voicevox_engine/releases)から、使う PC に合う版（CPU 版か GPU 版）を落として展開する。手元で確かめたのは 0.26.0 の CPU 版。エディタ付きの VOICEVOX を入れて起動しておくのでもよい（中でエンジンが同じポートで動く）。
2. `run.exe` を起動する（既定 `http://127.0.0.1:50021`）。
3. 確かめる: `curl http://127.0.0.1:50021/version` で版が返る。

声は `vv_zundamon`・`vv_metan`・`vv_tsumugi`・`vv_ritsu`。VOICEVOX は中継サーバーが要らない。

## 2. NEUTRINO

1. [NEUTRINO の公式サイト](https://studio-neutrino.com/downloads/)から本体（Windows 版 Tau v3.2 以降。手元は v3.2.2）を落として展開する。めろう・レイナ・ナクモ・ソウマ・ルノは本体に入っている。
2. 琴葉茜・葵（`nt_akane`・`nt_aoi`）も使うときは、ライブラリを別に落として `model/` に入れる。**この2人は出力の解析（学習データにすることを含む）が禁止されているので、検証でも音を測ったり解析したりしない。** 聞いて確かめるだけにする。
3. 中継サーバーを起動する。

   ```bash
   npx tsx scripts/misc/neutrino-server.ts --neutrino <NEUTRINO のフォルダ>
   ```

   NVIDIA の GPU が無いときは `--cpu`。
4. 確かめる: `curl http://127.0.0.1:50022/singers` で、入れた歌声ライブラリが並ぶ。
5. **GPU で初めて合成するときだけ、準備に2分20秒ほどかかる。** 最初の1曲は待つ。2回目からは 43秒の曲を約9秒で作る。

## 3. OpenUtau（DiffSinger・ENUNU）

OpenUtau の書き出しコマンドは、2026-11-01 時点では本家に入っていない提案（[PR #2162](https://github.com/openutau/OpenUtau/pull/2162)）にしか無い。提案のブランチを組み立てる。

1. **.NET 8 SDK を入れる。** 管理者権限が無ければ、Microsoft の `dotnet-install.ps1` で好きなフォルダに入れ（`-Channel 8.0 -InstallDir <フォルダ>`）、OpenUtau を組み立てる・動かすシェルで `DOTNET_ROOT` をそのフォルダにする。
2. **OpenUtau を組み立てる。**

   ```bash
   git clone -b christian/cli https://github.com/christianazinn/OpenUtau.git
   dotnet publish OpenUtau/OpenUtau/OpenUtau.csproj -c Release -r win-x64 --self-contained false -o <OpenUtau のフォルダ>
   ```
3. **歌い手を入れる。** 波音リツ DiffSinger・ENUNU の配布は [canon-voice.com](https://www.canon-voice.com/voicebanks/)。DiffSinger はボコーダー（`nsf_hifigan`）と、`dsdict.yaml`・`default_phonemizer`・subbank の下ごしらえが要る。手順は [openutau-sing.md](openutau-sing.md) の「使い方」の 2〜3 をそのまま行う。
4. **ENUNU を使うときは SimpleEnunuServer も起動する。**
   - [SimpleEnunu のリリース](https://github.com/rokujyushi/SimpleEnunu/releases)から SimpleEnunuServer 0.5.0 を展開し、同梱の Python に PyTorch と pyzmq を入れる。NVIDIA の GPU があれば GPU 版を入れる（ENUNU が2〜3倍速い。RTX 50 番台は CUDA 12.8 以上の版、約3GB）。

     ```bash
     # GPU 版
     python-3.9.13-embed-amd64/python.exe -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
     # GPU が無いときは CPU 版
     python-3.9.13-embed-amd64/python.exe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
     python-3.9.13-embed-amd64/python.exe -m pip install pyzmq
     ```

     GPU を使えているかは `python-3.9.13-embed-amd64/python.exe -c "import torch; print(torch.cuda.is_available())"` が True になるかで確かめる。
   - `simple_enunu_server.bat` で起動する。
   - **SimpleEnunuServer は `tcp://*:15556`（LAN 全体、認証なし）で待ち受ける。** Windows のファイアウォールが許可を聞いてきたら許可しない。
   - utaupy の書き換えは要らない（以前の「float division by zero」の回避は、2026-11-01 に dtm 側の楽譜の書き方を直して不要になった。[openutau-sing.md](openutau-sing.md)）。
5. 中継サーバーを起動する。

   ```bash
   npx tsx scripts/misc/openutau-server.ts --openutau <OpenUtau のフォルダ>
   ```

   GPU が使えないときは `--onnx-runner CPU`。
6. 確かめる: `curl http://127.0.0.1:50023/singers` で、`Singers/` の歌い手が並ぶ。

時間の目安（海鬼月の歌の1トラック、152音・約108秒）: DiffSinger は GPU（DirectML）で約10秒、ENUNU は CPU 版の PyTorch で約83秒、GPU 版で約36秒。dtm は手元のエンジンの歌を区切って頭から順に合成し、間に合う見込みが立ったら鳴らし始める。海鬼月の3トラックで、作り置きの無い状態から鳴り始めるまで VOICEVOX 1.7 秒・Sinsy 2.6 秒・DiffSinger 11 秒・NEUTRINO 12 秒・ENUNU（GPU 版）95 秒。一度合成した所は OpenUtau がキャッシュするので、2回目からはすぐ鳴る。仕組みは [neutrino-sing.md](neutrino-sing.md) の「待たずに鳴らし始める仕組み」。

## 4. Sinsy（WSL）

1. WSL の Ubuntu を入れる（PowerShell で `wsl --install -d Ubuntu`。再起動が要ることがある）。Ubuntu で `sudo apt install python3-venv` しておく。
2. WSL の中で Python の環境を作る。

   ```bash
   python3 -m venv ~/dtm-sinsy
   ~/dtm-sinsy/bin/pip install cmake cython numpy "setuptools<81"
   ~/dtm-sinsy/bin/pip install pysinsy pyworld
   ```
3. Windows 側で中継サーバーを起動する（`--python` は WSL の中のフルパス。Git Bash からなら先頭に `MSYS_NO_PATHCONV=1`）。

   ```bash
   npx tsx scripts/misc/sinsy-server.ts --wsl --python /home/<ユーザー>/dtm-sinsy/bin/python
   ```
4. 確かめる: `curl http://127.0.0.1:50024/singers` に `nitech_jp_song070_f001` が出る。

## 5. dtm で鳴らして確かめる

1. `http://localhost:40298/` を開く（127.0.0.1 でもよい。LAN の IP で開くと手元扱いにならず、声が選べない）。
2. 歌詞トラックの音源の一覧に、入れたエンジンのグループ（「VOICEVOX（要エンジン起動）」「NEUTRINO（要サーバー起動）」など）が出ることを見る。
3. 声を選んで再生する。MML なら、歌詞トラックの音源の名前を書き換える（例 `@@0 nt_reina どんぐりころころ…`）。モデル名は次の表。

   | エンジン | モデル名 |
   | :--- | :--- |
   | VOICEVOX | `vv_zundamon` `vv_metan` `vv_tsumugi` `vv_ritsu` |
   | NEUTRINO | `nt_reina` `nt_merrow` `nt_nakumo` `nt_soma` `nt_runo` `nt_akane` `nt_aoi` |
   | OpenUtau | `ou_ritsu_ds`（DiffSinger）`ou_ritsu_enunu`（ENUNU） |
   | Sinsy | `ss_f001` |
4. 見るところ
   - 歌が伴奏に合っているか（頭も、曲の後半も）。
   - 声の大きさが、元の UTAU 音源（koe）の声とおおむねそろっているか（dtm が -16 dBFS 前後にそろえる）。
   - 規約のリンクが、エンジンや歌い手に合ったページを指しているか。
5. 鳴らないときは、ブラウザの開発者ツールのコンソールを見る。エンジンにつながらないと `[dtm] NEUTRINO（http://127.0.0.1:50022）で歌えませんでした。…` のような警告が1回出る（中継サーバーのスクリプト名と歌い手の名前も出る）。ほかの声で代わりに鳴らすことはしない。

## つまずきやすいところ

| 症状 | 見るところ |
| :--- | :--- |
| 声の選択肢が出ない | ページを手元（localhost・127.0.0.1・file:）で開いているか |
| file: で開いたページから鳴らない | 中継サーバーに `--allow-file-origin` を付ける（既定では断る） |
| コードを直したのに変わらない | `npx tsup` で `dist/` を組み立て直したか |
| NEUTRINO の最初の1回が戻ってこない | GPU の準備中（2分20秒ほど）。待つ |
| ENUNU の再生で歌が入らない・遅れる | SimpleEnunuServer が起動しているか。PyTorch が GPU 版か。コンソールに「合成が間に合わず、途中から鳴らしたフレーズがあります」が出たら、もう一度再生する（合成済みの所はすぐ鳴る） |
| OpenUtau が `DOTNET_ROOT` 関係で起動しない | 中継サーバーを起動するシェルで `DOTNET_ROOT` を .NET 8 のフォルダにする |
| Sinsy の中継サーバーが Python を見つけない | Git Bash なら `MSYS_NO_PATHCONV=1`。`--python` は `~` を使わずフルパス |
| ポートがぶつかる | 中継サーバーは `--port`、デモの DAW は `PORT` で変える。dtm の側のエンジンの URL も合わせて変える |

## 片付け

- 中継サーバーと SimpleEnunuServer は、使い終わったら止める（ENUNU のサーバーは LAN に開いている）。
- エンジン・歌声ライブラリ・OpenUtau のキャッシュは大きい（手元ですべて入れて 6GB 余り）。dtm の作業フォルダの中に置くなら、git 管理外の `tmp/` に置く。
