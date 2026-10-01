# Scripts Directory

このディレクトリには、本プロジェクトの測定・検証・分析・ビルド補助等のスクリプトを格納します。

## スクリプト一覧

### test/ — 回帰テスト（`pnpm test` から呼ぶもの。`check-global-state.ts` だけは未登録）。黄金値・対照は `test/fixtures/`

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `check-compose.ts` | 自動作曲パイプラインの品質・回帰テスト（`pnpm test` から呼び出し）。**既存テンプレートの黄金値**（既定＋6構成 × アプリの種3つの生成物の sha256 を `test/fixtures/compose-golden.json` と照合。テンプレートを足したときに共通経路の乱数消費が変わっていない番。取り直しは `--bless` だけ）と、**界隈曲テンプレート `kaiwai`** の到達検算（ドラム・楽器・進行・ベース4型・構成の候補が生成物に届くか）、骨格借用（`kaiwai_skeleton`、骨格データがあれば）と継ぎ合わせ（`kaiwai_splice`、バンクの不変条件と seed 1..30）の節を含む | `pnpm test` または `npx tsx scripts/test/check-compose.ts` / 黄金値の取り直し `npx tsx scripts/test/check-compose.ts --bless` |
| `check-tracks.ts` | 上級者モード15トラックの検算（声部の分割で音が消えていないか・トラックが遊んでいないか・同じ楽器で同じ音を重ねていないか。既定構成と `kaiwai`・`kaiwai_splice`（骨格データがあれば `kaiwai_skeleton` も）を順に回す。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/test/check-tracks.ts` |
| `check-compose-accomp.ts` | 伴奏主体モード（`composeAccomp`、[docs/accomp-compose.md](../docs/accomp-compose.md)）の検算。依存（koe・mml-parser を読まない）・表の健全性・計画器・実現器・関門・入口（決定性・`pick`・`recent`・上書き・保険の計画）・ミックス・MML の往復（音符と絶対値の v まで）。**陽性対照**（fb を計画として書き直した `test/fixtures/accomp-fb-plan.ts` を鳴らして fb の実測に合うか）と**切除対照**（1点ずつ壊すと狙った関門だけが落ちるか）を含む。`#compose` の書式（`style:<id>.v<版>:<baseKey>:<k>`）と監査用の記録（`diagnostics`）も確かめる。計画の記録（`PlanPins`: スタイル・型・ミックスと小節ごとの和音の打ち方。実現の段が記録し、記録があれば従う）も確かめる。`pnpm test` から呼び出し | `pnpm test` または `npx tsx scripts/test/check-compose-accomp.ts` |
| `check-accomp-styles.ts` | **伴奏主体モードのスタイルの検査**（[docs/accomp-style-engine.md](../docs/accomp-style-engine.md) §7.1、段階 S1）。登録した全スタイル（`src/compose/accomp-styles/`）を同じコードで回す: スキーマ（`validateStylePack`）といまのエンジンの前提・その陰性対照、型ごとの参照計画（全調・全テンポの前提と秒数）、エンジンが表をスタイルから読むこと（互換の口 `compose-accomp-tables.ts` を読まない）、DAW のミックス解放（`accompMixToRelease` の判定と `daw.ts` が `song.mix` と層の定義を使うこと）、DAW と UI にスタイル名が無いこと。`pnpm test` から呼び出し | `pnpm test` または `npx tsx scripts/test/check-accomp-styles.ts` |
| `check-accomp-golden.ts` | **伴奏主体モードの黄金値**（[docs/accomp-style-engine.md](../docs/accomp-style-engine.md) §7.2・§8 段階 S0）。200種 × {major, minor, any} の計画 JSON（段階 S1 から計画の記録 `PlanPins` 込み）と MML、`fbPlan` × 長調12調 × 全テンポ、変種（31平均律・色の線なし・`pick`・`recent` の100曲）の sha256 を `test/fixtures/styles/<id>/golden.json` と照合する（出力を1バイトも変えない作り替えの番）。`--bless` で取り直す（出力を意図して変えたときだけ。スタイルの版も上げる）。`pnpm test` から呼び出し | `pnpm test` / 取り直し `pnpm accomp:bless` |
| `check-mml-velocity.ts` | 音符ごとの強弱（v）が MML の書き出し・DAW の読み込み・再生専用プレイヤー・MIDI 書き出しを通しても保たれるか（`src/mml/mml-velocity.ts`）。`--file <MML>` で実物を往復させる。`pnpm test` から呼び出し | `pnpm test` または `npx tsx scripts/test/check-mml-velocity.ts --file tmp/full/fb.space.mml` |
| `check-speech-schedule.ts` | 単発の読み上げ（`speak`）のチャンク配置の検算（`awaitRender: "first-chunk"` で頭から鳴るか・`lateChunks: "shift"` で遅れたチャンクを飛ばさず時間軸ごとずらすか・`"skip"` でも最初の子音を欠かさないか・`minBufferSec` の待ち・`position()` が音と揃うか。チャンクの到着時刻を偽って、音を出さずに確かめる。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/test/check-speech-schedule.ts` |
| `check-fx-font-drum.ts` | 再生専用プレイヤーの揃え直しの検算（`#reverb=` `#delay=` 等が再生でも読めて、書かれていない項目は既定値へ戻る＝前の曲を持ち越さない／`#t<n>font=` の正規化・往復・音源バンクに無い楽器の FluidR3 への落とし方／`#drum` 無し・`#drum=none` が DAW の全体読み込みで「なし」になる／`#mastercomp=` `#fadein=` `#fadeout=` が書かれていなければ DAW の全体読み込みで初期値へ戻る／宣言の行の途中の `#loop=on`（DAW の書き出し）も `meta.loop` として読める＝再生専用プレイヤーでもループする。`pnpm test` から呼び出し） | `pnpm test` または `npx tsx scripts/test/check-fx-font-drum.ts` |

### accomp/ — 伴奏主体モードの試聴・監査（テストには入れない）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `audit-accomp-variety.ts` | **伴奏主体モードのばらつきの監査（報告だけ。テストには入れない）。** MML だけを読み、生成曲どうし・手書きの基準（`references/<id>/baseline.json`、ローカルの `tmp/audit/<id>.baseline.local.json` があれば足す）との類似度を次元ごとに出す。語彙は発音位置の Jaccard で重み付け、音色は音源バンク・EQ・パン・送りまで、曲の頭と継ぎ目は別に、基準は n とブートストラップ95%区間付き。型の中のほぼ重複（4指標）と型の間（7指標）、退避率・候補 k=0 の通過率・計画の中の引き直しの使い切り、聴いていない行の割合も出す。**値で曲を選ばない** | `pnpm audit:accomp` / `npx tsx scripts/accomp/audit-accomp-variety.ts --count 20 --seed 777` |
| `accomp-audition.ts` | **伴奏主体モードの試聴用の書き出し（テストには入れない）。** 種を変えて .mml（宣言・音符ごとの v・`#seed`・`#compose` 込み）と `_summary.md`（区間表・関門・実測）・`_questions.md`（聞き取りの3問）を出す。`--fb-plan` で陽性対照（fb の計画を生成器で鳴らしたもの）も足す。`--app-seed <n> --compose style:<id>.v<版>:<baseKey>:<k>` でアプリの曲を再現（旧書式 `accomp:<baseKey>:<k>` も読む）。**公開中の github.io の埋め込みは段階0より前のビルドなので、ローカルの `pnpm dev` の DAW に貼って聴く** | `npx tsx scripts/accomp/accomp-audition.ts --count 3 --seed 20260929 --key major --fb-plan --out tmp/accomp` |

### compose/ — 自動作曲の試作・選抜・試聴・書き出し

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `ab-listen.ts` | **目隠し A/B/C の作成器（耳で方式の採否を決める）。** `--release` で A＝main の出荷版そのまま／B＝同じ旋律を和声付け直し／C＝人間の旋律（PDMX、所有者が知らない曲）を同じ付け直し、の3本を同じ曲から出す。旋律はよそのコード進行に載らないので、比較は必ず両方を同じ手続きで付け直す | `npx tsx scripts/compose/ab-listen.ts --pdmx tmp/pdmx.jsonl --release --out tmp/abc-release` |
| `export-samples.ts` | 生成した曲を .mid で書き出すスクリプト（指標ではなく耳で確かめるため）。`--app-seed <n> --compose <#compose の値>` でアプリの曲を再現する。`#compose=style:…`（伴奏主体モード。旧書式 `accomp:…` も読む）は `composeAccomp` と `accompToMml` へ振り分けて .mml を書く（31平均律の曲は `--edo 31`）。知らないテンプレート名はエラー | `npx tsx scripts/compose/export-samples.ts --out tmp/samples --count 6` / `npx tsx scripts/compose/export-samples.ts --app-seed 3842857959 --compose style:fb.v1:any:0` |
| `compose-audition.ts` | **作曲オーディション（これが入口）。** 大量に引く→一次選抜→覆面の譜面シート→審査エージェントへの指示文、までを1コマンドで出す。`--hand` で手書きの曲を同じ土俵に混ぜられる | `npx tsx scripts/compose/compose-audition.ts --count 200 --top 6` |
| `screen-compose.ts` | **自動作曲の一次選抜。** 大量に引いて「聴かなくても分かる欠点」（歌の入りが遅い・主音に解決しない・サビ固有のフックが無い／他セクションへ漏れる・Aメロとサビの対比が無い・歌えない跳躍）を数えて落とす。欠点の出現数も出るので、どこを直すべきかが分かる | `npx tsx scripts/compose/screen-compose.ts 200 5000 8` |
| `compose-lab.ts` | 種を指定して `composeSong` を回し、**エディタにそのまま取り込める MML** と、人／エージェントが読める**譜面シート**を出す | `npx tsx scripts/compose/compose-lab.ts 24 2001 tmp/compose` |
| `hand-compile.ts` | **手書き譜面（JSON）→ MML。** 自動作曲を使わずに書いた曲を同じ土俵へ載せる。記法は [docs/handscore.md](../docs/handscore.md)（`compose-lab.ts` の譜面シートと同じ記法なので、生成物を読んでそのまま書き直せる） | `npx tsx scripts/compose/hand-compile.ts tmp/handscore/a.json tmp/handscore/a.mml` |
| `screen-handscore.ts` | 手書き譜面を `screen-compose.ts` と**同じ減点表**に掛ける（自動作曲と手書きを同じ物差しで比べる） | `npx tsx scripts/compose/screen-handscore.ts tmp/handscore/a.json` |
| `blind-sheet.ts` | **覆面審査用の譜面シート。** 自動作曲の曲も手書きの曲も、出自が分からない同じ書式で出す（種・機械採点・調名の表記ゆれを消す）。`ab-listen.ts` の耳版に対する、譜面版 | `npx tsx scripts/compose/blind-sheet.ts auto 5138 A tmp/blind/A.md` |

### corpus/ — 参考コーパスの測定・校正・比較（`calibrate-corpus.ts` が共通の読み込み口）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `calibrate-corpus.ts` | 参考MIDIコーパス群から目標帯（`src/compose/compose-corpus.ts`）を算出し校正するスクリプト | `npx tsx scripts/corpus/calibrate-corpus.ts --dir "<path>" --out src/compose/compose-corpus.ts` |
| `check-evaluator.ts` | **評価機そのものの検算。** 人間の曲が生成物と同等以上の点を取るかを見る（取らないなら基準の側が壊れている） | `npx tsx scripts/corpus/check-evaluator.ts --dir "<path>"` |
| `measure-arrangement.ts` | **旋律の外側**（テンポ・調・和声・ベース・ドラム・音色・構成）を参考コーパスと生成物で同じ物差しで測って並べる。生成物は `export-samples.ts` と同じ手順で .mid にしてから読む。`--generate <テンプレート名\|all>`（all は vocaloid / 1chorus / game_loop / kaiwai / kaiwai_skeleton / kaiwai_splice）、`--min-bars <n> --min-channels <n>` で未完成の耳コピを対照から外す（`corpus-profile.md` に絞る前後を併記）。出力 `<out>/corpus-profile.{md,json}`・`gen-<template>.{md,json}`・`gap.md` | `npx tsx scripts/corpus/measure-arrangement.ts --dir "C:/Users/frgk2/Music/_own/自作/界隈曲" --generate kaiwai --count 40 --seed 1 --min-bars 40 --min-channels 6 --out tmp/kaiwai` |
| `extract-skeletons.ts` | **骨格借用の抽出。** 界隈曲の耳コピ MIDI から曲ごとの設計図（和音列・ベース・主旋律のリズムと反復の地図・層・ドラム型・刻み）を抜き、`src/compose/compose-skeletons.ts` を生成する（自動生成、手で編集しない）。辞書に無いドラム型は `drum-config.ts` のマーカー間に `kaiwai_*` として書き足す。`--show <曲名>` で1曲の和音列・セクション、`--bars a-b` で半小節ごとの重み、`--check` で生成済みファイルの検算だけ。型と検算は `src/compose/skeleton-types.ts` | `npx tsx scripts/corpus/extract-skeletons.ts --dir "C:/Users/frgk2/Music/_own/自作/界隈曲" --out src/compose/compose-skeletons.ts` |
| `build-section-bank.ts` | **継ぎ合わせの抽象骨格バンクの生成。** 手元の骨格データ（`loadSkeletons()`、git に入れない）からセクション単位の設計図（和音名・ベースの型の種類・ドラム型・刻み・歌メロのリズムと反復の地図・層・音域の中心）を抜き、`src/compose/compose-section-bank.ts`（自動生成、**git にもバンドルにも入れない**。曲名・度数・ベースの実音は持たないが、進行と歌のリズムから元曲にたどれる）を書いて `biome format` を掛ける。歌わない種類（intro/interlude/outro）は 16 小節で頭打ち。donor の選別（和音 2 個以下・最初/最後の和音が 12 半小節超・調外ルート過半のセクションを落とす）。`src`（元曲の通し番号）と曲名の対応は `tmp/section-bank-map.json`。`--check` で生成済みファイルの検算だけ。型と検算は `src/compose/section-bank-types.ts` | `npx tsx scripts/corpus/build-section-bank.ts` |
| `check-splice-closeness.ts` | **継ぎ合わせ（`kaiwai_splice`）の生成物が元曲にどれだけ近いか。** 骨格データが無ければ skip。(a) 半小節の和音列の最長一致 ≤16、(b) ベースの実音が和音の donor・型の donor の元曲の同じ小節と一致する小節 ≤5% かつ連続一致 ≤8 小節、(c) 旋律の度数列の一致小節 ≤5%、(d) 同じ src の連続なし。超えたら exit 1。既定は 200 曲（40 曲では上限ちょうどの曲を拾えない） | `npx tsx scripts/corpus/check-splice-closeness.ts --count 200 --seed 1` |
| `check-skeleton-closeness.ts` | **骨格借用の生成物が元曲にどれだけ近いか。** 生成 N 曲を借りた骨格の元曲と突き合わせ、(a) 和音列の一致率、(b) 主旋律の度数列が小節単位で一致する割合（既定 `phrases` は ≤10%、`--source original` は 100%）、(c) 旋律のリズムの一致率を出す。上限を超えたら exit 1 | `npx tsx scripts/corpus/check-skeleton-closeness.ts --count 40 --seed 1` |
| `compare-reach.ts` | **生成系の到達範囲**を測る。採点を切って引き、コーパスのどの曲へ届かないか・どの軸が原因かを出す | `npx tsx scripts/corpus/compare-reach.ts --dir "<path>" --songs 1500` |
| `compare-corpus.ts` | 生成物と参考コーパスの音楽的特徴（周辺分布・中央値）を突き合わせて測定・比較するスクリプト | `npx tsx scripts/corpus/compare-corpus.ts --dir "<path>" --songs 80` |
| `compare-bar-density.ts` | 小節ごとの音数の分布を参考コーパスと突き合わせるスクリプト（`--profile` で小節ごとの表） | `npx tsx scripts/corpus/compare-bar-density.ts --dir "<path>" --profile` |
| `compare-vocabulary.ts` | リズム型の語彙の被覆率・集中度・モデル規模を参考コーパスと突き合わせるスクリプト | `npx tsx scripts/corpus/compare-vocabulary.ts --dir "<path>"` |
| `compare-pitch.ts` | 音程の分布・輪郭の集中度・使う材料を参考コーパスと比べるスクリプト | `npx tsx scripts/corpus/compare-pitch.ts --dir "<path>"` |
| `compare-repetition.ts` | 小節のリズム・音高の輪郭が完全一致で反復する割合を参考コーパスと比べるスクリプト | `npx tsx scripts/corpus/compare-repetition.ts --dir "<path>"` |
| `scratch-analyze.ts` | 生成曲の特徴量（音数、跳躍率、反復率、休符率等）をサンプリング測定するスクリプト | `npx tsx scripts/corpus/scratch-analyze.ts` |

### transcribe/ — 自動採譜（耳コピ）の評価実験（Python。テストには入れない）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `eval_transcription.py` | **音声→採譜の精度を、人力の耳コピ MIDI を正解にして測る。** `inventory` で音声フォルダと耳コピ MIDI フォルダの対応表を作り、完成度（MIDI の長さ÷音声の長さが 0.95〜1.05・音数・ドラムの有無）で並べる。`run` で Demucs（音源分離）→ Basic Pitch（採譜）→ クロマと打点包絡による位置合わせ（倍率・ずれ・移調を推定）→ パートごとの音符 F1（mir_eval）を出し、`summary.md` と各曲の `transcribed.mid`（DAW に取り込める）を書く。正解のパート分けはトラック名（ウタ／Vocal 等）を優先し、無ければ規則で決める。pip: `demucs basic-pitch mir_eval pretty_midi librosa soundfile`、ffmpeg が要る（Windows では basic-pitch が onnxruntime-gpu を CPU 版で上書きするので入れ直す）。2026-09-30 の5曲の結果と但し書きは [docs/transcription-eval.md](../docs/transcription-eval.md) | `PYTHONIOENCODING=utf-8 python scripts/transcribe/eval_transcription.py inventory --audio "<音声フォルダ>" --midi "<耳コピMIDIフォルダ>" --out tmp/transcribe-eval` / `python scripts/transcribe/eval_transcription.py run --pairs tmp/transcribe-eval/pairs.json --out tmp/transcribe-eval` |
| `midi-to-embed.ts` | **MIDI → MML → 公開デモの埋め込み URL。** 採譜結果（`transcribed.mid`）や耳コピ MIDI を `https://onjmin.github.io/dtm/demo/embed.html#g.…` で聴ける形にする。simple（4トラック。ベース＝音高中央値が最低、主旋律＝単旋律で最長）と advanced（チャンネル順に15トラック、プログラムチェンジを `#t<n>inst=` に）。ドラムは固定パターンから選ぶ（`--drum auto`） | `npx tsx scripts/transcribe/midi-to-embed.ts tmp/transcribe-eval/yatsume-ana/transcribed.mid --out tmp/embed --mode simple --inst synth_pop` |

### misc/ — リリース補助・その他

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `test-chord.ts` | MMLからの和音・コード解析およびカバレッジ測定を行うスクリプト | `npx tsx scripts/misc/test-chord.ts` |
| `mml-embed-url.ts` | **.mml → 公開デモの埋め込み URL**（`demo/embed.html` の "g." 形式＝gzip+base64url を location.hash に載せる。編集画面 `demo/#g…` の URL も出す）。作曲結果の試聴を URL で渡すときに使う | `npx tsx scripts/misc/mml-embed-url.ts tmp/kaiwai/audition/*.mml --json tmp/kaiwai/audition/urls.json` |
| `downscale-assets.py` | アセット画像の縮小処理ユーティリティ | `python scripts/misc/downscale-assets.py` |
| `sync-version.ts` | `package.json` のバージョンを `src/version.ts` と `docs/dataset-provenance.md` へ写す（`pnpm version` から自動で呼ぶ） | `pnpm patch` |

### melody-model/ — 旋律モデルの学習パイプライン（Python・オフライン。結論は否定的で打ち止め）

手順と経緯は [melody-model/README.md](melody-model/README.md)。

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
