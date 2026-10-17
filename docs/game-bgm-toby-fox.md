# ゲームBGM: Toby Fox の戦闘曲の実測（2026-10-17）

`game_loop`（カード「ゲームBGM・Toby Fox風（戦闘曲）」、旧「Ghost Fight / Pepper Steak風」）の手本を増やして作り直した記録。

## 分け方（所有者の判断）

- 手本の2曲は作曲者が別（Ghost Fight は Toby Fox、Pepper Steak は Alias Conrad Coldwood）。旧カード名は曲名で、§0③（handover-compose.md）に反していた。
- 評論に「MOTHER の影響を受けたゲーム」「ゆめにっきの後に続くインディーRPG」という括りはあるが、**ゲームの分類で音楽の分類ではない**（ゆめにっきは戦闘曲がほぼ無い）。造語の括りは作らない。
- Pepper Steak は Toby Fox の戦闘曲と柱の規則（16分の旋律・調外の音・♭5）を共有する。違いはパワーコードの1小節リフだけ（下の表）。どちらが代表かは曲数（耳コピの数）からは言えず、OFF（2008）は Undertale（2015）より前で、Toby Fox は OFF のリメイクで Pepper Steak に着想を得たと話している。いったん作者2人を並べた1枚にし Pepper Steak 型を半分の曲に出したが、**参考 MIDI が足りないので Pepper Steak 型は削除した**（同日、所有者の判断）。Coldwood の手本が2曲以上集まったら作り直す。
- Coldwood の2曲目の手本は見つからなかった（Picotune・Rechord とも OFF の全35曲名で0件）。Pepper Steak の耳コピは [Hooktheory の分析](https://www.hooktheory.com/theorytab/view/alias-conrad-coldwood/pepper-steak)（旋律の 78% が調内・ほぼ順次・イントロはほぼ1和音・フリギア）と合う。別の写像で、2曲目ではない。

## 手本と比較群

- Toby Fox: Picotune の耳コピ 13 曲（Undertale 12・Deltarune 1）。Ghost Fight・Megalovania・Spider Dance・Bonetrousle・Spear of Justice・Death by Glamour・Heartache・Dummy!・ASGORE・Hopes and Dreams・Metal Crusher・Power of NEO・BIG SHOT。11 曲が同じ耳コピ者（たまご）で、ピアノの右手／左手の2トラック。
- Coldwood: Pepper Steak の耳コピ 1本（`split-pepper.mid`）。MIDI はどれも `scratch/ref/`（git 外）。
- 比較群: 界隈曲の 59 曲（kaiwai-lineages.md と同じ）。
- 道具: `scratch/gamebgm/measure.ts --game`（`scratch/lineage/measure.ts` の写し）。旋律は右手の最上声、ベースは左手の最下声。BPM 200 超は倍テンポの記譜として時間を半分にした（Dummy!・Death by Glamour・BIG SHOT）。

## 手本の結果（曲数。Toby /13・Pepper Steak・比較群 /59）

| 特徴 | Toby | Pepper Steak | 比較群 | 読み |
|---|---|---|---|---|
| 旋律の16分以下の音価 ≥30% | 10 | 84% | 12 | 共通の規則 |
| 調外の音 ≥8%（12通りの移調で一番収まる枠） | 10 | 17% | 20 | 共通の規則 |
| 旋律の♭5 ≥2% | 8 | 4.8% | 17 | 共通（弱い） |
| 旋律の音域 ≥24 半音（Toby 中央 28） | 10 | 23 | 18 | Toby の規則 |
| 4小節ブロックの使い回し ≥60% | 6 | 69% | 10 | 弱い規則 |
| 1小節が再び出る ≥70% | 2 | 74% | 6 | Pepper Steak 型 |
| パワーコード ≥20% | 4 | 65% | 19 | Pepper Steak 型 |
| 同音の連打 ≥15% | 1 | 21% | 8 | Pepper Steak 型 |
| ベースの半音の動き ≥15% | 5 | 4% | 9 | Toby の一部の曲 |
| BPM | 112〜170（中央 120、≥140 は 4） | 109 | | |
| 減七が拍の 40% 以上 | 2（Ghost Fight・Death by Glamour） | 0 | | 1〜2曲の手口 |

- 和音の質（7th・減和音）は、ピアノの2トラックだと和音トラックの推定が効かないので、拍ごとの音の集合で取り直した。減三和音は比較群（歌の経過音）のほうが多く、分けない。

## 作り直し（2026-10-17）

- 音階は `harmonic_minor` だけ。Pepper Steak 型（`minor_blues`＋`power-riff`＋2小節の型を交互に回すリフ）は削除した。`minor_blues` は UI で選べる音階として残る。
- リフ: セクションの種類ごとに4小節ブロック x y x z（8小節目まで）、サビは 8割の曲で1オクターブ上。BPM は 112〜170。ベースは半音下降を 4割、残りは8分・オクターブ・16分刻み（`bassByScale` に配列）。
- 生成 30 曲（seed 1〜30）: 音域 中央 14→30（≥24 は 26/30）、1小節の再出現 中央 82→68%（≥70% は 12/30）、ベースの半音 ≥15% 20/20→13/30、BPM ≥140 0→12/30、16分・調外の音は全曲。
- 未確認: 音（誰も聴いていない）。
