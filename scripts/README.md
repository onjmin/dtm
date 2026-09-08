# Scripts Directory

このディレクトリには、本プロジェクトの測定・検証・分析・ビルド補助等のスクリプトを格納します。

## スクリプト一覧

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `check-compose.ts` | 自動作曲パイプラインの品質・回帰テスト（`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/check-compose.ts` |
| `calibrate-corpus.ts` | 参考MIDIコーパス群から目標帯（`src/compose-corpus.ts`）を算出し校正するスクリプト | `npx tsx scripts/calibrate-corpus.ts --dir "<path>" --out src/compose-corpus.ts` |
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

3. **一時的スクリプト（コミット不要な使い捨てコード）について**
   - 1回きりの検証や実験でコミット不要なコードに限り、ルート直下の `scratch/`（`.gitignore` 済み）を利用できます。
   - 後から再利用・追試する可能性のある測定系・検証系スクリプトは `scripts/` 配下に配置してください。
