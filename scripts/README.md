# Scripts Directory

測定・検証・分析・ビルド補助のスクリプト置き場。

耳コピ由来のデータ（`src/compose/compose-phrases.ts`・`compose-section-bank.ts`・`compose-skeletons.ts`）は git にもバンドルにも入れない。スクリプトへは `scripts/corpus/skeleton-data.ts` の `localExperimentData()` / `loadSkeletons()` で渡し、手元に無ければ該当の検査は skip する。

## スクリプト一覧

### test/ — 回帰テスト（`pnpm test` から呼ぶ。黄金値・対照は `test/fixtures/`）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `check-compose.ts` | 自動作曲の回帰テスト。既存テンプレートの黄金値（sha256）照合と `kaiwai` 系テンプレートの検算 | `npx tsx scripts/test/check-compose.ts`（取り直しは `--bless`） |
| `check-tracks.ts` | 上級者モード15トラックの検算（音の消失・遊んでいるトラック・同音の重複） | `npx tsx scripts/test/check-tracks.ts` |
| `check-compose-accomp.ts` | 伴奏主体モード（[docs/accomp-compose.md](../docs/accomp-compose.md)）の計画・実現・関門・MML 往復の検算。陽性・切除対照つき | `npx tsx scripts/test/check-compose-accomp.ts` |
| `check-accomp-styles.ts` | 伴奏主体モードの全スタイルのスキーマと前提の検査（[docs/accomp-style-engine.md](../docs/accomp-style-engine.md) §7.1） | `npx tsx scripts/test/check-accomp-styles.ts` |
| `check-accomp-golden.ts` | 伴奏主体モードの黄金値。計画 JSON と MML の sha256 を `test/fixtures/styles/<id>/golden.json` と照合 | `pnpm accomp:bless`（意図して出力を変えたときの取り直し） |
| `check-compose-lyrics.ts` | 仮歌詞の検算。音符と歌詞が1対1か、伸ばし棒を置いていないか、文で終わるか（[docs/lyric-design.md](../docs/lyric-design.md)） | `npx tsx scripts/test/check-compose-lyrics.ts` |
| `check-mml-velocity.ts` | 音符ごとの強弱（v）が MML・DAW・プレイヤー・MIDI 書き出しを通って保たれるか | `npx tsx scripts/test/check-mml-velocity.ts --file tmp/full/fb.space.mml` |
| `check-speech-schedule.ts` | 単発の読み上げ（`speak`）のチャンク配置の検算。到着時刻を偽って音を出さずに確かめる | `npx tsx scripts/test/check-speech-schedule.ts` |
| `check-fx-font-drum.ts` | 再生専用プレイヤーと DAW 全体読み込みで、宣言（`#reverb=` `#t<n>font=` `#drum` 等）が読まれ未記載は既定へ戻るか | `npx tsx scripts/test/check-fx-font-drum.ts` |

### accomp/ — 伴奏主体モードの試聴・監査（テスト外）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `audit-accomp-variety.ts` | 生成曲どうし・手書き基準との類似度を次元ごとに出す監査。報告だけで、値で曲を選ばない | `npx tsx scripts/accomp/audit-accomp-variety.ts --count 20 --seed 777` |
| `accomp-audition.ts` | 種を変えて試聴用の .mml と要約・聞き取りの質問を書き出す。ローカルの `pnpm dev` で聴く | `npx tsx scripts/accomp/accomp-audition.ts --count 3 --seed 20260929 --key major --fb-plan --out tmp/accomp` |

### compose/ — 自動作曲の試作・選抜・試聴・書き出し

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `ab-listen.ts` | 目隠し A/B/C の作成器。出荷版・和声付け直し・人間の旋律を同じ手続きで出す | `npx tsx scripts/compose/ab-listen.ts --pdmx tmp/pdmx.jsonl --release --out tmp/abc-release` |
| `export-samples.ts` | 生成曲を .mid（伴奏主体モードは .mml）で書き出す。`--app-seed` と `--compose` でアプリの曲を再現 | `npx tsx scripts/compose/export-samples.ts --app-seed 3842857959 --compose style:fb.v1:any:0` |
| `audit-lineage.ts` | 所有者が聴く前の点検。曲をまたいだ使い回し・全曲で一定の特徴・歌の音域と重ね・原曲との近さを、流派の原曲（耳コピ）と同じ物差しで並べ、直すべき候補を重大度順に出す | `npx tsx scripts/compose/audit-lineage.ts --template kaiwai_2go_lead --count 100 --out tmp/audit/2go_lead.md` |
| `compose-audition.ts` | 作曲オーディションの入口。大量生成→一次選抜→覆面譜面→審査指示文までを1コマンドで | `npx tsx scripts/compose/compose-audition.ts --count 200 --top 6` |
| `screen-compose.ts` | 一次選抜。聴かなくても分かる欠点を数えて落とし、欠点の出現数も出す | `npx tsx scripts/compose/screen-compose.ts 200 5000 8` |
| `compose-lab.ts` | 種を指定して `composeSong` を回し、取り込める MML と譜面シートを出す | `npx tsx scripts/compose/compose-lab.ts 24 2001 tmp/compose` |
| `hand-compile.ts` | 手書き譜面（JSON、[docs/handscore.md](../docs/handscore.md)）を MML にする | `npx tsx scripts/compose/hand-compile.ts tmp/handscore/a.json tmp/handscore/a.mml` |
| `screen-handscore.ts` | 手書き譜面を `screen-compose.ts` と同じ減点表に掛ける | `npx tsx scripts/compose/screen-handscore.ts tmp/handscore/a.json` |
| `blind-sheet.ts` | 出自が分からない書式の覆面審査用譜面シートを出す | `npx tsx scripts/compose/blind-sheet.ts auto 5138 A tmp/blind/A.md` |

### corpus/ — 参考コーパスの測定・校正・比較（`calibrate-corpus.ts` が共通の読み込み口）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `calibrate-corpus.ts` | 参考 MIDI コーパスから目標帯（`src/compose/compose-corpus.ts`）を算出する | `npx tsx scripts/corpus/calibrate-corpus.ts --dir "<path>" --out src/compose/compose-corpus.ts` |
| `check-evaluator.ts` | 評価機の検算。人間の曲が生成物と同等以上の点を取るかを見る | `npx tsx scripts/corpus/check-evaluator.ts --dir "<path>"` |
| `measure-arrangement.ts` | 旋律の外側（テンポ・和声・ベース・ドラム・構成等）をコーパスと生成物で同じ物差しで測る | `npx tsx scripts/corpus/measure-arrangement.ts --dir "<path>" --generate kaiwai --count 40 --seed 1 --out tmp/kaiwai` |
| `measure-lyrics.ts` | 耳コピ UST の歌詞と生成の仮歌詞を同じ物差しで測る（表記・音符との対応・母音・句末の形・反復・層）。歌詞の本文は出さない。まとめは [docs/lyric-design.md](../docs/lyric-design.md) | `npx tsx scripts/corpus/measure-lyrics.ts --dir "<path>" --generate kaiwai` |
| `extract-skeletons.ts` | 耳コピ MIDI から曲ごとの骨格を抜き `src/compose/compose-skeletons.ts` を生成する（git に入れない） | `npx tsx scripts/corpus/extract-skeletons.ts --dir "<path>" --out src/compose/compose-skeletons.ts` |
| `build-section-bank.ts` | 骨格データからセクション単位のバンク `src/compose/compose-section-bank.ts` を生成する（git に入れない） | `npx tsx scripts/corpus/build-section-bank.ts` |
| `check-splice-closeness.ts` | `kaiwai_splice` の生成物が元曲に近すぎないか検査し、上限超えで exit 1 | `npx tsx scripts/corpus/check-splice-closeness.ts --count 200 --seed 1` |
| `check-skeleton-closeness.ts` | 骨格借用の生成物が元曲に近すぎないか検査し、上限超えで exit 1 | `npx tsx scripts/corpus/check-skeleton-closeness.ts --count 40 --seed 1` |
| `compare-reach.ts` | 採点を切って引き、生成系が届かないコーパス曲とその原因の軸を出す | `npx tsx scripts/corpus/compare-reach.ts --dir "<path>" --songs 1500` |
| `compare-corpus.ts` | 生成物とコーパスの特徴の分布・中央値を比べる | `npx tsx scripts/corpus/compare-corpus.ts --dir "<path>" --songs 80` |
| `compare-bar-density.ts` | 小節ごとの音数の分布をコーパスと比べる | `npx tsx scripts/corpus/compare-bar-density.ts --dir "<path>" --profile` |
| `compare-vocabulary.ts` | リズム型の語彙の被覆率・集中度をコーパスと比べる | `npx tsx scripts/corpus/compare-vocabulary.ts --dir "<path>"` |
| `compare-pitch.ts` | 音程の分布・輪郭の集中度をコーパスと比べる | `npx tsx scripts/corpus/compare-pitch.ts --dir "<path>"` |
| `compare-repetition.ts` | 小節のリズム・輪郭が完全一致で反復する割合をコーパスと比べる | `npx tsx scripts/corpus/compare-repetition.ts --dir "<path>"` |
| `scratch-analyze.ts` | 生成曲の特徴量（音数・跳躍率・反復率・休符率等）をサンプリングで測る | `npx tsx scripts/corpus/scratch-analyze.ts` |

### transcribe/ — 自動採譜の評価実験（テスト外）

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `transcribe_audio.py` | 音声 1 本を耳コピ MIDI にする（Demucs＋Basic Pitch）。分離・採譜の本体と方式（`PRESETS`）はここ | `python scripts/transcribe/transcribe_audio.py song.mp3 --out tmp/transcribe/song` |
| `eval_transcription.py` | 耳コピ MIDI を正解に、`transcribe_audio.py` の精度を測る。結果は [docs/transcription-eval.md](../docs/transcription-eval.md) | `python scripts/transcribe/eval_transcription.py run --pairs tmp/transcribe-eval/pairs.json --out tmp/transcribe-eval --preset v2` |
| `yourmt3_runner.py` | YourMT3+（多楽器採譜）で音声を採譜し JSON にする比較用。専用 venv で動かす。界隈曲では v2 に負けたので本体には繋いでいない | `<venv>/python scripts/transcribe/yourmt3_runner.py --ymt3 <space> --out tmp/ymt3/all.json a.wav` |
| `midi-to-embed.ts` | MIDI を MML にして公開デモの埋め込み URL にする | `npx tsx scripts/transcribe/midi-to-embed.ts tmp/transcribe/song/transcribed.mid --out tmp/embed --mode simple --inst synth_pop` |

### misc/ — リリース補助・その他

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `test-chord.ts` | MML からの和音解析とカバレッジ測定 | `npx tsx scripts/misc/test-chord.ts` |
| `mml-embed-url.ts` | .mml を公開デモの埋め込み URL（と編集画面の URL）にする | `npx tsx scripts/misc/mml-embed-url.ts tmp/kaiwai/audition/*.mml --json tmp/kaiwai/audition/urls.json` |
| `downscale-assets.py` | アセット画像を縮小する | `python scripts/misc/downscale-assets.py` |
| `sync-version.ts` | `package.json` のバージョンを `src/version.ts` 等へ写す（`pnpm version` から呼ぶ） | `pnpm patch` |

### melody-model/ — 旋律モデルの学習（打ち止め）

[melody-model/README.md](melody-model/README.md) を参照。

---

## 置き場所のルール

1. ルート直下にスクリプトを作らない。測定・検証・ユーティリティは `scripts/` に置き、コミットする。
2. 使い捨ては `scratch/`（`.gitignore` 済み）に置く。
3. 目標帯・重み・指標の定義を変えたら `check-evaluator.ts` で人間の曲と生成物を同じ物差しに載せて確かめる。
4. 出てこない曲は、定数をいじる前に `compare-reach.ts` で採点と生成のどちらが原因か切り分ける。
