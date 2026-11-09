# 技の一覧（techniques/）

使い回せる技を1つ1ファイルで置く。各ファイルは同じ型で書く。

```
# 技の名前
- 何をする技か（1〜2文）
## やり方      … 手順・数値・効く条件。コードの場所（scripts/otomad/lib/…）
## 試した作品  … 作品と、効いたか（所有者の評価・測った値）。新しいものを下に足す
## はまりどころ
```

新しい技を試したら、ここの表に1行足す。直したら本文を直し、「試した作品」に何を直したかを書く。

| 技 | 中身 | 試した作品 | 効いたか |
|---|---|---|---|
| [speech-melody.md](speech-melody.md) | 台詞イントネーション作曲（台詞の抑揚を主旋律にする） | samson5・dande1〜3・quotes ほか | 主軸。手順は作者本人の手順に合わせ直した |
| [voice-instrument.md](voice-instrument.md) | 声を楽器（シンセ・太鼓・ベース）に作り替える、音節を16分に刻む、語尾をサンプラー用のシンセ音に書き出す | techno1・samson2go1r・桔梗☆ | 2号式の核。桔梗☆の語尾のシンセは「素晴らしい」 |
| [audio-mix.md](audio-mix.md) | 声と伴奏の音量の上下・ダッキング・ラウドネス | samsonnigo1・bb7・kaisen・海鬼月 | 2号式では曲が上。BB劇場は -16 LUFS |
| [camera-3d.md](camera-3d.md) | 全天球の地面投影・板の向き・被写界深度・回り込み・リプレイ | bb7・bb8 | 「平たい横滑り」を無くした |
| [voxel-world.md](voxel-world.md) | ブロックの世界を光線で描き、時刻つきで建てて壊す。BB を巨人にする | bb19 | — |
| [impact.md](impact.md) | 衝撃のコマ・揺れの減衰・流し撮り・レンズ割れ | bb6〜bb8 | — |
| [aspect-ratio.md](aspect-ratio.md) | 場面に合わせた黒帯（16:9 → 2.39:1 → 全画面） | bb7 | — |
| [keying.md](keying.md) | 青背景・緑背景の抜き方、字幕の消し方 | — | 手順は [../bb-flow.md](../bb-flow.md) |
| [lyrics-text.md](lyrics-text.md) | 文字PV・モーラごとの字幕・括弧のト書き・漢字1字の札 | dande3 | 字はモーラ単位で出す |
| [thumbnail.md](thumbnail.md) | 専用コマのサムネ、題の付け方 | dande2 | — |
| [pixel-character.md](pixel-character.md) | ドット絵のキャラを 3D モデルで確かめて似せる。めたん・ずんだもん・イタコ・キリコ・シヨ・アルの確定した形、目・髪・手の描き方 | 海鬼月 | 所有者の直しで確定 |
| [pixel-video.md](pixel-video.md) | 界隈風のドット絵歌動画。合唱の度数・間奏のピアノロール・描画のバグの型 | 海鬼月 | — |
| [manga-tone.md](manga-tone.md) | 白黒の漫画調。層ごとの網点、縦書きのフキダシ、斜めの擬音、粉に崩れる表現 | bb26 | — |
| [one-take-thread.md](one-take-thread.md) | 声の音程から引いた糸をワンカットで飛ぶ MV。網点から色の解放、窓を破る、対数極座標の筒 | cm24 | 伸びず（いいね率 3.1%）。色の解放が黄色一色に見えた |
| [voice-icon-bounce.md](voice-icon-bounce.md) | 鳴っている声のアイコンを音ごとに弾ませて震わせる。音の高さの位置には置かない | ENU☆ | — |
| [ichiten-kousei.md](ichiten-kousei.md) | 一転攻勢。最後のサビで同じ作りのまま中身を淫夢へ替える。数秒前に前触れを入れる | ENU☆ | — |
| [material-drums.md](material-drums.md) | 声と物音で場面ごとのドラムキットを組み、打点に BB を出す | ENU☆ | — |
| [voice-cleanup.md](voice-cleanup.md) | 質の悪い語録をモーラごとに直す。環境音を引き、言葉の間を切り、音量と音高を合わせる | ENU☆ | — |
| [roid-unison.md](roid-unison.md) | 台詞にロイドとオクターブを重ねて声を太くする。koe と淫夢の50音を波形のまま音符へ並べる | ENU☆ | — |
| [speech-hook.md](speech-hook.md) | 語録の中から音階に乗るものを探し、抑揚をそのまま開幕の主題にする | cm25 | — |
| [ust-cover.md](ust-cover.md) | 所有者の UST と MIDI から UTAU 音源（束音ロゼ・華）でカバーを録る。延ばしの母音・ハモリの歌詞・落ちた音の補修・界隈曲の音での編曲とミックスの最終形 | anemone | — |
| [pv-pixel-cover-mv.md](pv-pixel-cover-mv.md) | 原曲 PV の語彙で組むドット絵カバー MV。振りを PV に合わせる、人物へのグリッチ、コードと旋律のピアノロール、頁の縦書き、4K の書き出し | anemone | — |
| [minimal-process.md](minimal-process.md) | ミニマル音楽の手順（ずれ・埋める・抜ける）と、音と1対1の楽譜の映像 | cm18 | — |

「—」は所有者の評価をまだ台帳に写していないもの。手元の `songs/*/notes-*.md` から写す（[../README.md](../README.md) の「移し替えの残り」）。

## まだ試していない引き出し

[research/inmu-cookie-staging.md](../research/inmu-cookie-staging.md) の「引き出し」と [research/otomad-video-research.md](../research/otomad-video-research.md) から。試したらファイルを作って上の表へ移す。

- シルエット化（絵のアルファから単色の影絵、原色の地をギザギザの縁で切る）。止めの場面1区間に。
- 担当ごとに絵柄を丸ごと替える（合作の型）。
- ネオン文字・発光（太線＋gauss_blur。techno1 の光の処理を流用）。
- テレビ番組風のテロップ（局ロゴ・赤太字の見出し・ワイプ）。
- 全員集合の締め（最後に全員が横一列で同じ振り）。
- 実写と絵の重ね（キャラの絵の上に実写の顔を薄く重ねる。終盤に1回だけ）。淫夢とクッキー☆は混ぜてよいので使える。
- 1つ目の技にコマ落ち・イージングをかけ、次の技と差をつける。シーンチェンジは回転型と拡大縮小型を使い分ける。
- 周辺ボケ・色収差・トーンカーブで背景の情報量と明るさを落とす（ハーフトーン、乗算）。
- unj-reze の OtomadMaker に manifest を渡して組む（[research/nigo-video-research.md](../research/nigo-video-research.md)）。
