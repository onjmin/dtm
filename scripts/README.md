# Scripts Directory

このディレクトリには、本プロジェクトの測定・検証・分析・ビルド補助等のスクリプトを格納します。

## スクリプト一覧

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `check-compose.ts` | 自動作曲パイプラインの品質・回帰テスト（`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-compose.ts` |
| `check-tracks.ts` | 上級者モード15トラックの検算（声部の分割で音が消えていないか・トラックが遊んでいないか・同じ楽器で同じ音を重ねていないか。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-tracks.ts` |
| `check-speech-schedule.ts` | 単発の読み上げ（`speak`）のチャンク配置の検算（`awaitRender: "first-chunk"` で頭から鳴るか・`lateChunks: "shift"` で遅れたチャンクを飛ばさず時間軸ごとずらすか・`"skip"` でも最初の子音を欠かさないか・`minBufferSec` の待ち・`position()` が音と揃うか。チャンクの到着時刻を偽って、音を出さずに確かめる。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-speech-schedule.ts` |
| `calibrate-corpus.ts` | 参考MIDIコーパス群から目標帯（`src/compose-corpus.ts`）を算出し校正するスクリプト | `npx tsx scripts/calibrate-corpus.ts --dir "<path>" --out src/compose-corpus.ts` |
| `check-evaluator.ts` | **評価機そのものの検算。** 人間の曲が生成物と同等以上の点を取るかを見る（取らないなら基準の側が壊れている） | `npx tsx scripts/check-evaluator.ts --dir "<path>"` |
| `compare-reach.ts` | **生成系の到達範囲**を測る。採点を切って引き、コーパスのどの曲へ届かないか・どの軸が原因かを出す | `npx tsx scripts/compare-reach.ts --dir "<path>" --songs 1500` |
| `compare-corpus.ts` | 生成物と参考コーパスの音楽的特徴（周辺分布・中央値）を突き合わせて測定・比較するスクリプト | `npx tsx scripts/compare-corpus.ts --dir "<path>" --songs 80` |
| `compare-bar-density.ts` | 小節ごとの音数の分布を参考コーパスと突き合わせるスクリプト（`--profile` で小節ごとの表） | `npx tsx scripts/compare-bar-density.ts --dir "<path>" --profile` |
| `compare-vocabulary.ts` | リズム型の語彙の被覆率・集中度・モデル規模を参考コーパスと突き合わせるスクリプト | `npx tsx scripts/compare-vocabulary.ts --dir "<path>"` |
| `compare-pitch.ts` | 音程の分布・輪郭の集中度・使う材料を参考コーパスと比べるスクリプト | `npx tsx scripts/compare-pitch.ts --dir "<path>"` |
| `compare-repetition.ts` | 小節のリズム・音高の輪郭が完全一致で反復する割合を参考コーパスと比べるスクリプト | `npx tsx scripts/compare-repetition.ts --dir "<path>"` |
| `ab-listen.ts` | **目隠し A/B/C の作成器（耳で方式の採否を決める）。** `--release` で A＝main の出荷版そのまま／B＝同じ旋律を和声付け直し／C＝人間の旋律（PDMX、所有者が知らない曲）を同じ付け直し、の3本を同じ曲から出す。旋律はよそのコード進行に載らないので、比較は必ず両方を同じ手続きで付け直す | `npx tsx scripts/ab-listen.ts --pdmx tmp/pdmx.jsonl --release --out tmp/abc-release` |
| `export-samples.ts` | 生成した曲を .mid で書き出すスクリプト（指標ではなく耳で確かめるため） | `npx tsx scripts/export-samples.ts --out tmp/samples --count 6` |
| `scratch-analyze.ts` | 生成曲の特徴量（音数、跳躍率、反復率、休符率等）をサンプリング測定するスクリプト | `npx tsx scripts/scratch-analyze.ts` |
| `test-chord.ts` | MMLからの和音・コード解析およびカバレッジ測定を行うスクリプト | `npx tsx scripts/test-chord.ts` |
| `downscale-assets.py` | アセット画像の縮小処理ユーティリティ | `python scripts/downscale-assets.py` |
| `compose-audition.ts` | **作曲オーディション（これが入口）。** 大量に引く→一次選抜→覆面の譜面シート→審査エージェントへの指示文、までを1コマンドで出す。`--hand` で手書きの曲を同じ土俵に混ぜられる | `npx tsx scripts/compose-audition.ts --count 200 --top 6` |
| `screen-compose.ts` | **自動作曲の一次選抜。** 大量に引いて「聴かなくても分かる欠点」（歌の入りが遅い・主音に解決しない・サビ固有のフックが無い／他セクションへ漏れる・Aメロとサビの対比が無い・歌えない跳躍）を数えて落とす。欠点の出現数も出るので、どこを直すべきかが分かる | `npx tsx scripts/screen-compose.ts 200 5000 8` |
| `compose-lab.ts` | 種を指定して `composeSong` を回し、**エディタにそのまま取り込める MML** と、人／エージェントが読める**譜面シート**を出す | `npx tsx scripts/compose-lab.ts 24 2001 tmp/compose` |
| `hand-compile.ts` | **手書き譜面（JSON）→ MML。** 自動作曲を使わずに書いた曲を同じ土俵へ載せる。記法は [docs/handscore.md](../docs/handscore.md)（`compose-lab.ts` の譜面シートと同じ記法なので、生成物を読んでそのまま書き直せる） | `npx tsx scripts/hand-compile.ts tmp/handscore/a.json tmp/handscore/a.mml` |
| `screen-handscore.ts` | 手書き譜面を `screen-compose.ts` と**同じ減点表**に掛ける（自動作曲と手書きを同じ物差しで比べる） | `npx tsx scripts/screen-handscore.ts tmp/handscore/a.json` |
| `blind-sheet.ts` | **覆面審査用の譜面シート。** 自動作曲の曲も手書きの曲も、出自が分からない同じ書式で出す（種・機械採点・調名の表記ゆれを消す）。`ab-listen.ts` の耳版に対する、譜面版 | `npx tsx scripts/blind-sheet.ts auto 5138 A tmp/blind/A.md` |

---

## スクリプト作成・配置ルール（エージェントおよび開発者向け）

1. **プロジェクトルート直下にスクリプトを作成しないこと**
   - 測定系、検証系、ベンチマーク、ユーティリティスクリプトは、**必ずこの `scripts/` ディレクトリ内に作成**してください。
   - ルート直下は設定ファイルやパッケージ定義などのみに保ちます。

2. **コミット対象として管理すること**
   - `scripts/` 配下のスクリプトはすべて Git のコミット対象として管理します。
   - 他の環境やCI、開発者間で再実行可能なように、相対パスや引数の設計を行ってください。

3. **`compose-metrics.ts` や参考コーパスを触ったら `check-evaluator.ts` を通すこと**
   - `check-compose.ts` は「生成物が基準を満たすか」しか見ておらず、**基準が正しいことを前提にしている**。
   - 実際、`check-evaluator.ts` を初めて走らせたとき、較正元のコーパス91本（中央値 0.673）より
     生成物（0.851）のほうが高い点を取っていた。「良い曲を作るには評価機を意図的に外さねばならない」
     状態で、これは生成側ではなく基準の側の誤り。
   - 目標帯・重み・指標の定義を変えたら、必ずここで人間の曲と生成物を同じ物差しに載せて確かめる。

4. **「出てこない曲」は、まず採点か生成かを切り分けること（`compare-reach.ts`）**
   - 採点式は**引けたものを選ぶことしかできない**。候補に一度も現れない形は、重みをどう変えても出ない。
   - 実測: 採点を完全に切って1500本引いても、コーパス91本のうち**28本は生成系の外側**にある。
   - 原因の軸も実測で出る（現状の1位は自己相似 sim4/sim8 が19本、次いで休符率が15本）。
     推測で定数をいじる前にここを見る。

5. **一時的スクリプト（コミット不要な使い捨てコード）について**
   - 1回きりの検証や実験でコミット不要なコードに限り、ルート直下の `scratch/`（`.gitignore` 済み）を利用できます。
   - 後から再利用・追試する可能性のある測定系・検証系スクリプトは `scripts/` 配下に配置してください。
