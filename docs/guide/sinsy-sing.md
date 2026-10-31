# Sinsy で歌わせる（試作）

歌詞トラックの音源に Sinsy の声（`ss_f001`）を選ぶと、手元の Sinsy（pysinsy）で歌わせる。NEUTRINO・OpenUtau と同じく、手元の中継サーバーに MusicXML を送って WAV を受け取る（仕組みは [neutrino-sing.md](neutrino-sing.md)）。dtm は Sinsy も声も同梱しない。

声の質は NEUTRINO・DiffSinger より古い（HMM の歌声合成）。代わりに軽く、1フレーズ 0.4 秒ほどで出来る。

## 使い方（Windows ＋ WSL）

pysinsy には Windows 用の組み立て済みの配布が無く、ソースから組み立てるには Microsoft の C++ ビルドツールが要る。WSL の Ubuntu なら gcc で組み立てられる。

1. WSL で Python の環境を作り、pysinsy を入れる。

   ```bash
   python3 -m venv ~/dtm-sinsy
   ~/dtm-sinsy/bin/pip install cmake cython numpy "setuptools<81"
   ~/dtm-sinsy/bin/pip install pysinsy
   ```

   `setuptools<81` は、pysinsy 0.0.5 が読む `pkg_resources` のため。
2. Windows 側で中継サーバーを起動する。`--python` は WSL の中のフルパス（`~` は使えない）。

   ```bash
   npx tsx scripts/misc/sinsy-server.ts --wsl --python /home/<ユーザー>/dtm-sinsy/bin/python
   ```

   Git Bash から起動するときは、`/home/...` を Windows のパスに書き換えられないよう `MSYS_NO_PATHCONV=1` を付ける。既定は `http://127.0.0.1:50024`。WSL を使わず Python に直接入れたときは `--wsl` を外す。
3. dtm のページを手元で開き、歌詞トラックの音源の「Sinsy（要サーバー起動）」から選ぶ。MML では `@@0 ss_f001 どんぐりころころ…`。

| モデル名 | 声 | ライセンス |
| :--- | :--- | :--- |
| `ss_f001` | NIT SONG070 F001（pysinsy 付属） | CC BY 3.0（名古屋工業大学）。公開するときは出典を書く |

合成は `scripts/misc/sinsy_synth.py`（`pysinsy.synthesize` → 16bit の WAV）。中継サーバーの口と安全のための決まりは `scripts/misc/local-engine-server.ts`（NEUTRINO・OpenUtau と共通）。

## 確かめたこと（2026-10-31、WSL の Ubuntu・Python 3.12・pysinsy 0.0.5）

- dtm が書いた MusicXML（どんぐりころころの頭8音）を 0.35 秒で歌わせた。音の高さは楽譜から ±1 半音ほどずれる音がある（声のモデルの癖と、測り方の誤差）。
- デモの DAW（ヘッドレスの Edge）で `ss_f001` のトラックを再生し、2つのフレーズが伴奏と同じアンカーから計算どおりの時刻に置かれた。
