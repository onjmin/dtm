# Scripts Directory

このディレクトリには、本プロジェクトの測定・検証・分析・ビルド補助等のスクリプトを格納します。

## スクリプト一覧

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `check-compose.ts` | 自動作曲パイプラインの品質・回帰テスト（`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-compose.ts` |
| `check-tracks.ts` | 上級者モード15トラックの検算（声部の分割で音が消えていないか・トラックが遊んでいないか・同じ楽器で同じ音を重ねていないか。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-tracks.ts` |
| `calibrate-corpus.ts` | 参考MIDIコーパス群から目標帯（`src/compose-corpus.ts`）を算出し校正するスクリプト | `npx tsx scripts/calibrate-corpus.ts --dir "<path>" --out src/compose-corpus.ts` |
| `check-evaluator.ts` | **評価機そのものの検算。** 人間の曲が生成物と同等以上の点を取るかを見る（取らないなら基準の側が壊れている） | `npx tsx scripts/check-evaluator.ts --dir "<path>"` |
| `compare-reach.ts` | **生成系の到達範囲**を測る。採点を切って引き、コーパスのどの曲へ届かないか・どの軸が原因かを出す | `npx tsx scripts/compare-reach.ts --dir "<path>" --songs 1500` |
| `compare-corpus.ts` | 生成物と参考コーパスの音楽的特徴（周辺分布・中央値）を突き合わせて測定・比較するスクリプト | `npx tsx scripts/compare-corpus.ts --dir "<path>" --songs 80` |
| `compare-bar-density.ts` | 小節ごとの音数の分布を参考コーパスと突き合わせるスクリプト（`--profile` で小節ごとの表） | `npx tsx scripts/compare-bar-density.ts --dir "<path>" --profile` |
| `compare-vocabulary.ts` | リズム型の語彙の被覆率・集中度・モデル規模を参考コーパスと突き合わせるスクリプト | `npx tsx scripts/compare-vocabulary.ts --dir "<path>"` |
| `compare-pitch.ts` | 音程の分布・輪郭の集中度・使う材料を参考コーパスと比べるスクリプト | `npx tsx scripts/compare-pitch.ts --dir "<path>"` |
| `compare-repetition.ts` | 小節のリズム・音高の輪郭が完全一致で反復する割合を参考コーパスと比べるスクリプト | `npx tsx scripts/compare-repetition.ts --dir "<path>"` |
| `export-samples.ts` | 生成した曲を .mid で書き出すスクリプト（指標ではなく耳で確かめるため） | `npx tsx scripts/export-samples.ts --out tmp/samples --count 6` |
| `scratch-analyze.ts` | 生成曲の特徴量（音数、跳躍率、反復率、休符率等）をサンプリング測定するスクリプト | `npx tsx scripts/scratch-analyze.ts` |
| `test-chord.ts` | MMLからの和音・コード解析およびカバレッジ測定を行うスクリプト | `npx tsx scripts/test-chord.ts` |
| `downscale-assets.py` | アセット画像の縮小処理ユーティリティ | `python scripts/downscale-assets.py` |

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
