# NEUTRINO で歌わせる（試作）

歌詞トラックの音源に NEUTRINO の歌い手を選ぶと、利用者が公式から入れた NEUTRINO で歌わせる。
NEUTRINO はコマンドラインで動くソフトなので、ブラウザからは手元の中継サーバー（`scripts/misc/neutrino-server.ts`）を通して呼ぶ。
dtm は NEUTRINO 本体も歌声ライブラリも同梱しない。規約の解釈と、やること・やらないことは [../research/neutrino-terms.md](../research/neutrino-terms.md)。

## 使い方

1. [NEUTRINO の公式サイト](https://studio-neutrino.com/downloads/)から本体（Windows 版 Tau v3.2 以降）を落として展開する。使う歌声ライブラリも落として `model/` に入れる。
2. 中継サーバーを起動する（NEUTRINO を入れた PC で）。

   ```bash
   npx tsx scripts/misc/neutrino-server.ts --neutrino <NEUTRINO のフォルダ>
   ```

   既定は `http://127.0.0.1:50022`。`--port` で変える。NVIDIA の GPU が無いときは `--cpu`。
3. dtm のページを**手元で**開く（`pnpm dev` のデモなど。localhost・127.0.0.1・file:）。歌詞トラックの音源の「NEUTRINO（要サーバー起動）」から声を選ぶ。MML では `@@0 nt_reina どんぐりころころ…` と書く。

公開サイトなど手元以外で開いたページでは、VOICEVOX と NEUTRINO の声は選択肢に出ない（`src/voice/local-engines.ts` の `isLocalPage`）。MML に書かれた値は消さずに保つ。

| モデル名 | 歌声ライブラリ（`model/` のフォルダ） | 入手 |
| :--- | :--- | :--- |
| `nt_merrow` | めろう（MERROW） | 本体に同梱 |
| `nt_reina` | レイナ（REINA） | 本体に同梱 |
| `nt_nakumo` | ナクモ（NAKUMO、男声） | 本体に同梱 |
| `nt_soma` | ソウマ（SOMA、男声） | 本体に同梱 |
| `nt_runo` | ルノ（RUNO、男声） | 本体に同梱 |
| `nt_akane` | 琴葉茜（AKANE） | 別に落とす |
| `nt_aoi` | 琴葉葵（AOI） | 別に落とす |

歌い手を増やすときは `src/voice/neutrino-sing.ts` の `NEUTRINO_SINGERS` に1行足す。

## 規約の表示

歌い手を選ぶと、NEUTRINO の利用許諾契約書へのリンクを出す。琴葉茜・葵は、ライブラリに付く株式会社エーアイの使用許諾契約書が NEUTRINO より厳しいので、A.I.VOICE のキャラクターページへのリンクも並べる（`characterTerms`）。

琴葉茜・葵で特に気をつけること（ライブラリ付属の使用許諾契約書、2026-05-01 改定）:

- 商用利用・有償配布・同人活動は、事前にエーアイへの問い合わせが要る。
- 出力した音声の解析（学習データにすることを含む）は禁止。dtm のテストや確認でも、この2人の出力は測らない。
- 作った音声を素材として配らない。

## 仕組み

- **フレーズとトラック**: フレーズの切り方は VOICEVOX と同じ（休符・ブレス・語りで切る）。NEUTRINO は1回呼ぶたびに約3秒の立ち上げがかかるので、トラック全体を1回で合成し（`buildNeutrinoTrack`）、出来た音声をフレーズの範囲に切って並べる。シーク・ループ・途中から鳴らす処理は VOICEVOX と共通（`src/voice/lyrics.ts` の `runExternalTrack`）。
- **切り出し**: フレーズの切り出しは、最初の音の 0.3 秒前から次のフレーズの切り出しの頭まで。隣どうしは重ならないので、同じ音が二重に鳴らない。
- **楽譜**: VOICEVOX 形式の楽譜（フレーム単位）を秒へ戻し、テンポ 60（4分音符＝1秒、divisions 960）の MusicXML に書く（`scoreToNeutrinoMusicXml`）。小節をまたぐ音はタイで分け、歌詞はタイの頭にだけ付ける。
- **中継サーバー**: 受け取った MusicXML を一時フォルダに書き、`bin/musicXMLtoLabel` → `bin/neutrino`（`-m` で GPU）の順に呼んで WAV を返す。合成は1件ずつ。127.0.0.1 でだけ待ち受け、手元で開いたページ以外の Origin からは断る。歌声ライブラリの名前は `model/` にあるフォルダと完全一致だけ通す。
- テストは `scripts/test/check-neutrino-score.ts`（楽譜とフレーズの切り出し、手元判定。NEUTRINO は呼ばない）。

## 確かめたこと（2026-10-31、RTX 5060 Ti・NEUTRINO v3.2.2）

- 初めて動かすときだけ、GPU の準備で2分20秒ほどかかる。2回目からは、43秒の曲を約9秒、4秒のフレーズを約4秒で作る。
- dtm が書いた MusicXML で、レイナ・めろう・ずんだもんが楽譜どおりの高さ（±0.1 半音）で歌った。子音は拍の少し前から歌う。
- デモの DAW（ヘッドレスの Edge）で `nt_reina` のトラックを再生し、2つのフレーズが伴奏と同じアンカーから計算どおりの時刻に置かれた。音源の選択肢に NEUTRINO の7人が出て、琴葉茜では規約のリンクが2つ出た。

## 制約

- 中継サーバーと NEUTRINO が無いと鳴らない。他の声で代わりに鳴らさず、コンソールに警告を1回出すだけ。
- トラックを編集すると、そのトラック全体を作り直す（1分の曲で10秒ほど）。
- 歌えるのは単旋律だけ。声のフェード（`↓` `↑`）、オクターブ重ね、声質のつまみは効かない。
- 出力を声質変換の入力にしない（NEUTRINO の規約 §5 で禁止）。
