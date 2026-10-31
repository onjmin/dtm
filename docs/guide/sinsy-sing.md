# Sinsy で歌わせる（試作）

歌詞トラックの音源に Sinsy の声（`ss_f001`）を選ぶと、手元の Sinsy（pysinsy）で歌わせる。NEUTRINO・OpenUtau と同じく、手元の中継サーバーに MusicXML を送って WAV を受け取る（仕組みは [neutrino-sing.md](neutrino-sing.md)）。dtm は Sinsy も声も同梱しない。

声の質は NEUTRINO・DiffSinger より古い（HMM の歌声合成）。代わりに軽く、1フレーズ 0.4 秒ほどで出来る。

## 使い方（Windows ＋ WSL）

pysinsy には Windows 用の組み立て済みの配布が無く、ソースから組み立てるには Microsoft の C++ ビルドツールが要る。WSL の Ubuntu なら gcc で組み立てられる。

1. WSL で Python の環境を作り、pysinsy を入れる。

   ```bash
   python3 -m venv ~/dtm-sinsy
   ~/dtm-sinsy/bin/pip install cmake cython numpy "setuptools<81"
   ~/dtm-sinsy/bin/pip install pysinsy pyworld
   ```

   `setuptools<81` は、pysinsy 0.0.5 が読む `pkg_resources` のため。`pyworld` は音程を楽譜どおりに直すため（下記）。
2. Windows 側で中継サーバーを起動する。`--python` は WSL の中のフルパス（`~` は使えない）。

   ```bash
   npx tsx scripts/misc/sinsy-server.ts --wsl --python /home/<ユーザー>/dtm-sinsy/bin/python
   ```

   Git Bash から起動するときは、`/home/...` を Windows のパスに書き換えられないよう `MSYS_NO_PATHCONV=1` を付ける。既定は `http://127.0.0.1:50024`。WSL を使わず Python に直接入れたときは `--wsl` を外す。
3. dtm のページを手元で開き、歌詞トラックの音源の「Sinsy（要サーバー起動）」から選ぶ。MML では `@@0 ss_f001 どんぐりころころ…`。

| モデル名 | 声 | ライセンス |
| :--- | :--- | :--- |
| `ss_f001` | NIT SONG070 F001（pysinsy 付属） | CC BY 3.0（名古屋工業大学）。公開するときは出典を書く |

合成は `scripts/misc/sinsy_synth.py`（`pysinsy.synthesize` → 16bit の WAV）。

**音程の補正**: Sinsy の声のモデル（HMM）は高さの動きを自分で作るので、楽譜から外れやすい（2026-11-01、海鬼月の主旋律で「音痴」と言われた）。pyworld があれば、出てきた歌声を WORLD で分解し、声の出ている所の高さを楽譜の音に置き換えて組み立て直す（声色はそのまま、音の変わり目は 30ms でつなぐ）。`--no-tune` か pyworld が無いときは補正しない。高さはどうせ楽譜に置き換えるので、検出は速い dio＋stonemask で足りる（harvest の約4分の1の時間）。歌声は休符（150ms 以上の無音）で区切り、区切りごとに CPU のコアを並べて処理する。海鬼月の主旋律で、DAW で鳴り始めるまでの待ちは約12秒（最初の補正の版は約58秒、補正なしは約8秒）。中継サーバーの口と安全のための決まりは `scripts/misc/local-engine-server.ts`（NEUTRINO・OpenUtau と共通）。

## 確かめたこと（2026-10-31、WSL の Ubuntu・Python 3.12・pysinsy 0.0.5）

- dtm が書いた MusicXML（どんぐりころころの頭8音）を 0.35 秒で歌わせた。補正なしでは楽譜から ±1 半音ほどずれる音があった。
- 海鬼月の主旋律（頭の44秒、約90音）を DAW で鳴らして測ると、補正後は全部の音が楽譜と ±50 セント以内、ずれの中央値 4 セント（元の UTAU 音源と同じ）。
- デモの DAW（ヘッドレスの Edge）で `ss_f001` のトラックを再生し、2つのフレーズが伴奏と同じアンカーから計算どおりの時刻に置かれた。
