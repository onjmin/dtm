# ゲームBGM: Toby Fox の戦闘曲の実測（2026-10-17）

`game_loop`（カード「ゲームBGM・Ghost Fight / Pepper Steak風」）の手本を増やした記録。

## 分け方（所有者の判断）

- 手本の2曲は作曲者が別（Ghost Fight は Toby Fox、Pepper Steak は Alias Conrad Coldwood）。カード名が曲名なのは §0③（handover-compose.md）に反する。
- 評論に「MOTHER の影響を受けたゲーム」「ゆめにっきの後に続くインディーRPG」という括りはあるが、**ゲームの分類で音楽の分類ではない**（ゆめにっきは戦闘曲がほぼ無い）。造語の括りは作らない。
- → **作者ごとの2枚**にする。Toby Fox は戦闘曲（ボス戦を含む）だけ。Coldwood は手本が Pepper Steak 1曲（Picotune に0件）なので、2曲以上集まるまで載せない。

## 手本と比較群

- 手本: Picotune の耳コピ 13 曲（Undertale 12・Deltarune 1）。Ghost Fight・Megalovania・Spider Dance・Bonetrousle・Spear of Justice・Death by Glamour・Heartache・Dummy!・ASGORE・Hopes and Dreams・Metal Crusher・Power of NEO・BIG SHOT。11 曲が同じ耳コピ者（たまご）で、ピアノの右手／左手の2トラック。MIDI は `scratch/ref/toby/`（git 外）。
- 比較群: 界隈曲の 59 曲（kaiwai-lineages.md と同じ）。生成: `game_loop` の seed 1〜20。
- 道具: `scratch/gamebgm/measure.ts --game`（`scratch/lineage/measure.ts` の写し）。旋律は右手の最上声、ベースは左手の最下声。BPM 200 超は倍テンポの記譜として時間を半分にした（Dummy!・Death by Glamour・BIG SHOT）。

## 結果（曲数。手本 /13・比較群 /59・生成 /20）

| 特徴 | 手本 | 比較群 | 生成 | 読み |
|---|---|---|---|---|
| 旋律の16分以下の音価 ≥30% | 10 | 12 | 20 | 規則（済み） |
| 調外の音 ≥8%（12通りの移調で一番収まる枠） | 10 | 20 | 10 | 規則（生成は半分） |
| 旋律の音域 ≥24 半音（中央 28） | 10 | 18 | **0**（中央 14） | 規則。生成が狭い |
| 旋律の♭5 ≥2% | 8 | 17 | 5 | 弱い規則 |
| 4小節ブロックの使い回し ≥60% | 6 | 10 | 2 | 弱い規則 |
| 1小節が再び出る ≥70% | 2 | 6 | **20** | 生成が回しすぎ（手本は1小節のリフを回さない） |
| ベースの半音の動き ≥15% | 5 | 9 | **20** | 生成が全曲に入れすぎ |
| BPM（手本 112〜170、中央 120。≥140 は 4） | | | 105〜120 | 生成が狭い |
| 減七が拍の 40% 以上 | 2（Ghost Fight・Death by Glamour） | | | 作者の規則ではない（1〜2曲の手口） |
| 短調 | 10 | 37 | 20 | 分けない |
| パワーコード ≥20% | 4 | 19 | 2 | 分けない（Pepper Steak 側の手口） |

- 和音の質（7th・減和音）はピアノの2トラックだと和音トラックの推定が効かないので、トラックを問わず拍ごとの音の集合で取り直した。それでも減三和音は比較群（歌の経過音）のほうが多く、分けない。
- 今の `game_loop` の柱（`harmonic_minor`＋半音で下がるベース＝Ghost Fight、`minor_blues`＋パワーリフ＝Pepper Steak）は、どちらも**1曲の手口**で、作者の規則として測ると出ない。

## 直す方向（未実装）

1. カードを「ゲームBGM・Toby Fox風（戦闘曲）」に改名。`minor_blues`／`power-riff` の系統は外す（Coldwood の手本が増えたら別カードで戻す）。
2. リードの音域を2オクターブ前後へ広げる。1小節の型の回しを減らし、4小節ブロックで繰り返す。
3. 半音で下がるベースは一部の曲だけ（手本 5/13）。BPM は 110〜170 から引く。
4. 減七の平行移動は曲の中の一手口として残す（全曲の柱にしない）。
