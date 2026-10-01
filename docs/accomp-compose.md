# 伴奏主体モード（`composeAccomp`）の設計

2026-09-28 作成、2026-10-01 に要約。経緯・検討して捨てた案・実測の詳細表・工数は git 履歴（この版より前）にある。
作業の前に `docs/handover-compose.md` を読むこと（handover から本書へリンク済み）。後継の設計は `docs/accomp-style-engine.md`（以下「後継書」）。

**読み替え（後継書の S0・S1 で変わった点）**
- `#compose` の書式は `accomp:<baseKey>:<k>` から `style:fb.v1:<baseKey>:<k>` に変わった（旧書式も読める）。本書の `accomp:…` は旧書式。
- 表は `src/compose/compose-accomp-tables.ts` から `src/compose/accomp-styles/fb.ts` へ移った。`compose-accomp-tables.ts` は読み直すだけの互換の口。

## 0. 実装の状況

| 段階 | 内容 | 状態 |
|---|---|---|
| 0 | 音符ごとの v を MML の読み書きで保つ（§8） | 実装済（`src/mml/mml-velocity.ts`、`check-mml-velocity.ts`） |
| 1 | 生成器・関門・入口・MML 書き出し・検算・試聴スクリプト | 実装済（付録 C・D） |
| 2 | DAW の「伴奏主体」ボタン（§9） | 実装済（付録 E） |
| 3 | `export-samples.ts` の振り分け・`compose-lab.ts` のコメント・handover と `scripts/README.md` へのリンク | 実装済。publish と unj-reze の依存上げは所有者の作業 |
| 4 | 耳による表の調整 | 継続中。後継書（スタイルエンジン）へ引き継いだ |
| 5 | 拡張（§13） | 未着手。`scripts/accomp/calibrate-accomp.ts` と `docs/accomp-reviews.md` はまだ無い |

## 0.1 1ページで

- `composeSong`（歌メロが主役）とは**別系統**の自動作曲。旋律はほぼ無く分散和音が主役。ドラムなし・残響とディレイ・約2分半〜3分のループ。手本は所有者が評価した手書き編曲 `tmp/full/fb.mml`（gitignore。検査は読まない）。
- 表を引いて組み合わせる。旅程と規則①〜⑤は固定し、他を抽選。**採点で選ばない**。硬い制約に違反した候補だけ捨てて次を引く。
- DAW ではノートを直接書き、ミックスは自前で当てる（おまかせマスタリングは通さない）。`src/compose/compose.ts` は変えない。

## 1. 目的と、やらないこと

- 目的: fb 系統の曲を DAW のボタン1つで作る。ねらいは handover と同じく「人が手を入れる出発点」。あわせて音符ごとの v をどこでも保つ。
- やらないこと:
  - `composeSong`・`SectionSpec`・`SECTION_ORDER`・`pickBuiltinDrum`・`ComposeStats`・`screen-*.ts` の採点には触らない。ドラムの生成器も書かない。
  - fb の実測値を採点・選抜の目標にしない（範囲の検査と表示だけ）。`drawCount` 式の大量抽選もしない。
  - `chords.ts` の `Math.floor`（112BPM で進行の約1/3が1ステップ前にずれる潜在バグ）は直さない。既存曲と過去の `#seed` の再現が変わるので別タスク。新モードはこの関数を通らない。

## 2. fb の特徴と、手書き規則①〜⑤

- ホ長調・112BPM・76小節・約163秒でループ。@0 控えめな長い音（6音）／@1 分散 Lead 1 (square)／@2 低音 Synth Bass 1／@3 和音 Electric Piano 2（3声の密集配置で根音は抜く）。
- 区間は和声の居場所で区切り、長さはそろえない: home 16 → minorDwell 20 → borrowA 8 → glimpse 4 → borrowB 8 → lift 8 → return 12。

**規則（モードの不変量）**
- **①** 分散の発音数は区間をまたいでほぼ一定（毎秒4〜5）。区間の違いはセル・向き・音域・低音の密度・v で出す。
- **②** 隣り合う区間（と同じ和声が再び出る区間）では、分散のセルと向き／低音の型／和音の長さと高さ、のうち2つ以上を変える。
- **③** 借用和音どうしで、借りた先の調の V→I を作らない（fa の ♭VII→♭III が「曲いちばんの到達点」になった反省）。2つの借用区間のあいだに glimpse を挟む。
- **④** 強弱の山は borrowB だけ。glimpse は凹ませ、lift を最弱、return は home より静か。home の中は4小節ずつ上げて引く。
- **⑤** home の終わりで予告した借用和音を借用区間で広げる。return では予告を省く。

**ループの閉じ方（5点）**: 最終小節は Vsus4→V／和音の最後の一打だけ付点4分／分散の最終小節は home の最終小節と同じ音／低音は導音で終え頭の主音へ半音で上がる／@0 は sus4 の4度→3度。
fa（評価されなかった版）との差から「短調側の長い滞留・借用区間の分割・中盤だけの山・@0 がほぼ無い」が効いたと推測した（N=1、品質の証拠ではない）。

## 3. 決まったこと（理由は1行）

- **1回引き、関門違反だけ次を引く（上限24）**: handover の「内蔵採点は品質と無相関」に従う。
- **指標は関門・表示・陽性対照・将来の較正にだけ使う**: 測る道具は要るが選抜には使わない。
- **陽性対照（fb を計画として書き直して再現）と切除対照を持つ**: 測定器を検証せずに結論を出した反省。
- **和声はローマ数字で書き、ハ長調のコード名へ変換**: 調に依存せず、所有者も ♭VI などで考える。
- **乱数は段ごとに分け、候補番号 k を `#compose` に残す**: 一変数の A/B と `recent` 下の再現を両立。
- **DAW へはトラック設定とマスタの動的処理を分けて切り出して渡す**: `loadMML` のメタ適用を丸ごと使うと伴奏音源や音律まで巻き込む。
- **短調は rootShift をそのまま使う（＝平行長調を家にする）**: 短調は Am 基準・長調は C 基準なので同じ値で平行長調になる。
- **山は borrowB に固定（v1）**: 規則④そのまま。
- **名前は `composeAccomp`**: dtm では backing が「伴奏音源（mp3・YouTube）」の意味で使われている。
- **役割名は home / minorDwell / borrowA / glimpse / borrowB / lift / return**。

## 4. 構成

### 4.1 ファイル
| ファイル | 役割 |
|---|---|
| `src/mml/mml-velocity.ts` | v の読み書き規則（`splitTrackVelocity`・`effectiveVelocity`・`chordVelocity`）。依存なしの純関数 |
| `src/compose/accomp-styles/fb.ts`・`schema.ts`・`index.ts` | 表（データだけ）。スタイル `fb` |
| `src/compose/compose-accomp-tables.ts` | 旧い表の互換の口（値を持たない） |
| `src/compose/compose-accomp-style.ts` | スタイルを引く（`accompStyleView`） |
| `src/compose/compose-accomp-plan.ts` | 段0〜3 → `AccompPlan`。純関数 |
| `src/compose/compose-accomp-realize.ts` | 段4〜10 → 4トラックのノート。純関数 |
| `src/compose/compose-accomp-check.ts` | 関門と表示用の指標 |
| `src/compose/compose-accomp.ts` | 入口 `composeAccomp`・`accompMeta`。候補ループ・保険の計画・正規化・ミックス |
| `src/compose/compose-accomp-mml.ts` | `accompToMml`。mml-parser を読む（koe まで引く）ので入口からは import しない |
| `scripts/test/check-mml-velocity.ts`・`check-compose-accomp.ts` | 検算（`pnpm test`） |
| `scripts/test/fixtures/accomp-fb-plan.ts` | fb を手で `AccompPlan` に書き直した陽性対照。保険の計画を兼ねる |
| `scripts/accomp/accomp-audition.ts` | 試聴用（テスト外） |

既存側の変更: `mml-core.ts`・`mml-player.ts`・`midi-io.ts`・`mml-parser.ts`（コメント）・`daw.ts`・`daw-ui.ts`・`master-fx.ts`・`index.ts`・`scripts/compose/export-samples.ts`・`compose-lab.ts`。

### 4.2 依存の制約（不変条件）
- `compose-accomp*.ts`（`-mml` を除く）とスタイルの表は、**実行時に `mml-parser`・`lyrics`・`daw` を import しない**。Node から koe 無しで検算するため（前例 `advanced-layers.ts`）。`check-compose-accomp.ts` は koe のスタブより前に require して確かめる。
- 実行時の依存は `@onjmin/chord-parser`・`chords` の綴り→units 変換・`compose-keys`・`compose` の `seededRandom`・`mml-velocity`・`drum-config` の `NO_DRUM_PATTERN` に限る。型は `import type`。
- `chords.ts` の `buildChordPlacements` は通さない（`Math.floor` のずれと、基本形固定・R-3-5-8 しか作れないため）。

### 4.3 データの流れ
`baseKey`・`random(seed)` → 段0（調）→ 候補 k=0..23 ごとに 計画（段1〜3）→ 実現（段4〜10）→ 関門 → 違反か `recent` 一致なら次の k → どれも通らなければ保険の計画（fb 相当）→ 絶対値の v を `splitTrackVelocity` でトラック音量と相対 velocity に分ける → `AccompSong`（DAW へ直接書く／`accompToMml` で .mml にする）。

## 5. 公開 API

型の定義は `src/compose/compose-accomp.ts` を正とする。要点:

- `composeAccomp(o?: AccompOptions): AccompSong`。オプションは `stepsPerBar`（16の倍数）・`edo`（12/31）・`baseKey`（"any" は長調扱い、短調は平行長調を家に）・`random`・`pick`（候補番号の固定。指定時は `recent` 無視）・`recent`（直近5つの planSignature）・`colorLine`・`overrides`（`lengths`・`bpm`・`plan`）。
- `AccompSong` は `plan`・4トラック（velocity は相対値で、読み込み直後と同じ形）・`mix`・`compose`（`#compose` の値）・`pick`（−1 は保険の計画）・`planSignature`・`draws`・`stats` を持つ。
- `accompMeta(song)`: DAW の適用と MML 書き出しが共通で通る唯一の変換。
- `accompToMml(song, prov?)`（`compose-accomp-mml.ts`）。
- `src/index.ts` から `composeAccomp`・`accompMeta`・`accompToMml`・型・`splitTrackVelocity`・`effectiveVelocity` を export。

## 6. 生成の各段

**共通の約束（不変条件）**
- ハ長調で作り、音は（半音, 五度圏の位置）で持つ。最後に `spelledToUnits + semitonesToUnits(rootShift, edo)` で写す。31平均律で ♭VI が G# に化けないため。借用和音はフラットで綴る。
- 音域の窓は**実際に鳴る高さ（絶対 MIDI）**で持ち、ハ長調の座標へは −rootShift して当てる。調が変わっても鳴る音域は同じ。
- 時間は16分単位。音価は16分〜全音符の8種だけ（MMLCore はタイを使えない）。
- 乱数は段ごとに分ける。調の種を1つ引いた後、候補ごとに 計画→和声→質感→配置→強弱→色 の順で種を6つ。候補 k の中身は (seed, k) だけで決まる。

| 段 | 中身 |
|---|---|
| 0 調とテンポ | `resolveComposeKey`。短調なら同じ rootShift の長調を家にして注記を出す。BPM は 110〜116 から重み付き |
| 1 旅程 | 並びは固定。区間長は4の倍数の候補から引き、minorDwell ≥ home かつ他より長い、150〜180秒を満たすまで引き直す（外れ続けたら fb と同じ長さ） |
| 2 和声 | 借用の組を先に引き（予告・borrowA/B・glimpse の終わり）、各区間の句を表から並べる。同じ和音が続くときのテンションは後処理でなく句の表に直接書く（聴いて直すとき触るのが1行で済む） |
| 3 質感 | 役割ごとの候補表からセル・窓・低音型・和音の打ち方・段を引く。規則②を満たさなければ質感だけ引き直す |
| 4 和音 | 3声の密集配置・根音抜き。直前からの移動量最小で選ぶ。分散のぶつかり回避に使うので最初に決める |
| 5 打ち方 | 本調の和音は短く（short2/alt13）、**借用和音だけ長く**（long）。和音の構成音は開始・長さ・v をそろえる（MMLCore は和音を1トークンにまとめる） |
| 6 低音 | 根音・5度・オクターブと経過音。区間の境は次の根音へ半音で渡す。曲の最後は導音 |
| 7 分散 | 和音ごとに5音の組を選び、セル（1小節のテンプレート、1小節8〜10音）に流し込む。return の前半は home の音を複写。最後の音は曲末ちょうどで終える（sequencer は最後の音の終わりをループ長にする） |
| 8 色の線 | @0。borrowB の数小節と最終小節だけ、1曲4〜6音、2〜3拍 |
| 9 強弱 | 役割ごとの起伏 × 拍位置の加減 → 規則④を関門で確認 → 正規化 |
| 10 表現 | 同じトラックで和音以外の音が重ならない、音価は8種だけ、などを関門で確認 |

**正規化**: トラックごとに `splitTrackVelocity` で T を `volume` に、round(100·v/T) を velocity にする。読み込み直後と同じ形なので、作った直後・キープ後・投稿後で音量も SoundFont の明るさも一致する。

## 7. 候補の扱いと指標

### 7.1 選抜はしない
- k=0..23 を順に作り、関門に落ちた候補と `recent` に一致した候補だけ飛ばし、**通った最初の候補を採る**。採点は無い。
- 再現は `composeAccomp({ random: seededRandom(seed), baseKey, pick: k })`。候補番号を残すので `recent` があっても再現できる。
- 実測では57曲すべて k=0 で通り、1曲約10ms。

### 7.2 関門（「壊れていないか」の確認で「良いか」の判定ではない）
長さ（150〜180秒・4の倍数）／旅程／①〜⑤／和声との整合（全音が鳴っている和音の構成音か書かれたテンション）／ぶつかり（分散と和音の短2度・短9度が0、全体で 0.35/小節以下）／継ぎ目（閉じ方5点）／表現（段10）。順は `ACCOMP_GATE_ORDER`。

### 7.3 指標
分散の毎秒音数・往復率・低音の密度・音域・強弱の山・ぶつかり・v の種類数などを `AccompStats` で表示する。**どれも品質の証拠ではない**。所有者の評価ラベルが10本以上たまったら、各指標が「使う」と「捨てる」を分けるかを問う（段階5）。

## 8. 音符ごとの v の保持（段階0）

### 8.1 直した不具合
修正前は、MML の書き出し（`mml-core.ts`）は先頭に v を1回出すだけ、DAW の読み込みは最後の v、再生専用プレイヤー（unj-reze の埋め込みが通る）は先頭の v でトラックを平らにしていた。読み手によって解釈が3通りあった。`composeSong` のアクセントや MIDI 取り込みの強弱も書き出しで消えていた。

### 8.2 意味の約束（不変条件）
- 内部の `Note.velocity` は**トラック基準に対する相対値**（100 = トラック音量 T）。
- MML の `v` は**実効値** = round(T·velocity/100)。
- 最終的な音量は DAW でもプレイヤーでも v/127。
- 分割は `T = min(100, max(vs))`、velocity = round(100·v/T)。T<100 なら丸め誤差が0.5未満に収まるので、往復で必ず元の v に戻る。分割のロジックは必ず `mml-velocity.ts` に置き、呼び出し側は1行にとどめる（DAW とプレイヤーは Node で読めないため）。

### 8.3 変更点と互換
- 書き出しは v が変わる音符の前にだけ `v{eff}` を挟む。**全音符の velocity が100の曲は出力が1バイトも変わらない。** 同じ規則を DAW の読み込み・プレイヤー・和音分解モード・MIDI 書き出し（127 超えも解消）に当てた。
- MML の記法上直らないもの: 和音は v を1つしか持てない（構成音の最大値で代表）、オクターブ重ねの ×0.7 は和音にまとまって消える。
- 挙動の変化: `composeSong` の強弱が初めて書き出しと投稿に乗る／トラックのベロシティスライダーは相対強弱に掛かるゲインになる／弱い音が暗く鳴る（SoundFont の明るさが velocity 連動）。

## 9. DAW への組み込み（段階2）

- `daw-ui.ts` の作曲の行に「伴奏主体」ボタン。ベース調の select をそのまま使い、構成・作る部分・音階は使わない。解説は `daw.ts` の `COMPOSE_INFO_HTML`。
- `daw.ts` から `applyTrackStripMeta`・`applyMasterDynamics`・`writeTrackAt`・`releaseAutoVocals` を切り出し、`composeWithConfirm(title, message, run)` に一般化した。`loadMML` の挙動は変えない。

### 9.3 `runComposeAccomp`
- トラック 0〜3 に直接書く（advanced でも同じ index、4〜14 は空）。モードによらず同じ種から同じ MML が出る。
- トラックのオクターブを0に戻し、`composeSlot` を割り当て、ミックス（楽器・EQ・パン・送り・マスタFX・音量80・ドラムなし・ループ ON・コンプとフェード0）を当て、自動の歌声を外し、頭から再生する。planSignature は歌もの用とは別に直近5曲を覚える。
- simple の和音欄には進行を表示だけする（調は rootShift）。「適用」で奏法1つに上書きされるのは仕様として許す。

### 9.4 おまかせマスタリングは呼ばない
呼ぶとリバーブ・ディレイ・コンプ・フェード・楽器・トラック設定が丸ごと上書きされ、目標のミックスにならない。利用者が後で手動で押すのは自由。

### 9.5 キープ・入れ替え・書き出し・投稿
- どれも既存の `generateMML → loadMML` を通り、段階0の修正で強弱も往復で残る。
- `loadMML` の全体読み込みでは、`#mastercomp`・`#fadein`・`#fadeout` が無ければ DAW の初期値へ戻す（書き出しは0を省くので、前の曲の値が残っていた）。
- 書き出しの先頭は `#seed` と `#compose`、`#inst=retro_game #volume=80 #loop=on #drum=none #reverb=50 …`、トラック別の `#t<n>…`。

## 10. ドラム・残響とディレイ・ループ

- ドラムは `NO_DRUM_PATTERN` を直接入れる（`pickBuiltinDrum` は旋律の統計で選ぶ関数なので意味を持たない）。
- 音色と効果はモード単位で固定し、区間ごとには変えない。
- ループ長は sequencer が最後の音の終わりで決めるので、分散と低音の最後の音を曲末ちょうどで終える。fadeIn/fadeOut は0。

## 11. `docs/handover-compose.md` との整合

- 統計を参考コーパスへ寄せない（実測値は関門と表示だけ）。大量に引いて内蔵採点で選ばない。ドラムは「なし」を選ぶだけ。
- 指標は暫定。評価ラベルが10本たまってから「分けるか」を検証する。
- 8小節の目隠し A/B は細かい採否に使えないので使わない。曲まるごとを3問（使うか捨てるか／最初に直す場所／理由を一言）で聞く。1日3本まで（1本2分半〜3分）。審査エージェントに順位を付けさせない。
- 指紋がそろう問題: 旅程と規則①〜⑤は不変量として固定し、他を抽選、直近5曲の planSignature を避ける。
- ドラムなしで不可だった theme-a/b/c は毎秒2.4〜2.5音、本モードは分散だけで毎秒4〜5音。失敗要因を「運動量」と読むのは推測（§14-8）。

## 12. 検査

既存テスト（`check-strip-defaults` など）と `biome check src`・tsc も通すこと。

### 12.1 `scripts/test/check-mml-velocity.ts`
純関数の全組の往復、velocity 100 だけの曲で出力が golden と一致（互換）、fb 風の強弱を埋め込んだ MML の往復（v の種類数まで）、和音・プレイヤーの式・和音分解・MIDI の上限。

### 12.2 `scripts/test/check-compose-accomp.ts`
依存（koe・mml-parser を読まない）・表の健全性・決定性（`pick` での作り直し一致）・全関門・正規化・ミックス・MML の往復（絶対値の v まで）・31平均律の綴り・曲ごとの違いの分布。対象は 12平均律40種・31平均律5種と key_E・短調・mood_* など。

### 12.3 陽性対照と切除対照
- 陽性対照: fb の計画を realize して fb の実測に許容幅で一致するか（分散の毎秒音数・上半分の平均・低音の密度・往復率・山の区間）。fb の計画が全関門を通ることも確かめ、これを保険の計画とする。
- 切除対照: 計画や音を1点ずつ壊し、狙った関門だけが落ちるか（関門そのものの検算）。

### 12.5 スクリプト
- `scripts/accomp/accomp-audition.ts`: `--count`・`--seed`・`--key`・`--edo 31`・`--no-color`・`--fb-plan`（陽性対照）・`--app-seed --compose`（アプリの出力の再現）。.mml と `_summary.md`・`_questions.md` を書く。試聴はローカルの `pnpm dev`（demo）に貼る。
- `scripts/compose/export-samples.ts`: 伴奏主体の `#compose` を `composeAccomp`・`accompToMml` へ振り分けて .mml を書く。未知のテンプレート名はエラー。

### 12.7 耳による確認（採点ではなく仕様の聞き取り）
- 1日目は陽性対照2本（fb 原曲と fb の計画を realize したもの）、2日目以降は生成曲を1日3本まで。
- 問いは handover の3問。目隠しの A/B や順位付けはしない。

## 13. 残っている段階と次の一手

- 段階4（耳による表の調整）は後継書のスタイルエンジン（S0・S1 まで実装）へ引き継いだ。「生成曲同士が似る」への対応はそちらで進める。
- 段階5の候補（聞き取りの結果で選ぶ）: `calibrate-accomp.ts`（ラベル10本以上）／借用の組と句の行を増やす／区間だけの引き直し／fa 型など別の旅程／山の区間の抽選／音源バンクの比較／家を短調にする版／ペンが直前の velocity を引き継ぐ／headless の velocity 解釈をそろえる／`chords.ts` の丸め（別コミット）。
- 所有者の作業: publish → unj-reze の `@onjmin/dtm` を上げる → fb を投稿し直す。unj-reze の埋め込みでは未確認（同じ `mountMmlPlayer` を demo で確認済み）。

## 14. 未決事項

1〜7 は所有者の方針どおりの既定で実装した。
1. 旅程と規則①〜⑤は固定し、他を抽選（どれも「fb の変奏」に聞こえる恐れあり）。
2. 表は fb・fa・backing からしか起こしていないので、home の冒頭は backing とほぼ同じ進行になる。これを許した（続きは後継書）。
3. 短調は平行長調を家にする。4. @0 は既定で on。5. v の修正は単独で publish できる形。6. ペンの既定 velocity は変えない。7. 山は borrowB 固定。
8. ドラムなしの不可の要因が「運動量」という読みは推測のまま。
9. 未確認: unj-reze の uploader に MML サイズの上限があるか（fb は約15KB、強弱でさらに長くなる）。

## 付録 A: 表の出どころ

表（今は `accomp-styles/fb.ts`）の行は fb・fa・backing から起こした。和声の句（`HOME_OPEN`・`HOME_MID`・`MINOR_*`・`BORROW_PAIRS`・`LIFT`・`RETURN_END`）と分散のセル（`ARP_CELLS`）は各行に出どころ（fb の小節番号など）を持たせてある。`BORROW_PAIRS` は規則③を通る組だけ載せる。和声はローマ数字で、大文字は長・小文字は短・`b` はフラット。

## 付録 C〜E: 実装で設計からずらした主な点

- **分散と和音の窓（段4・7）**: 窓の中に構成音が無い調・和音があるので、窓の外を費用付きで許す。3度始まりの組、sus4 の4度→5度も許す。前の組との距離は区間の頭で忘れる。
- **打ち方（段5）**: home の最終小節（`Vsus4 V`）も final。
- **低音（段6）**: 区間の最終小節用の型（`pulse8End`・`dropoutEnd`）を足した。半音渡しは、和音の音が渡しの音の半音上にあるときだけ5度へ戻す（fb の D→D#→E を残すため）。
- **色の線（段8）**: 分散と半音でぶつかるときだけ手前で切り、2拍に満たないなら別のオクターブを試す。分散との同音は許す（fb 自身がそうしている）。最終小節は4度→3度を必ず2拍ずつ置き、関門「継ぎ目」は実現の結果（`colorLine`）を見て確かめる。
- **`#loop=on`**: プレイヤーは `parseLoopMeta(mml) ?? meta.loop` で読む（DAW の書き出しは宣言の行の途中に書くため）。影響として、DAW でループ ON で書き出した既存の投稿も埋め込みでループするようになった。
- **`overrides.plan`**: 関門で落ちても返す（`pick` −1、`compose` の候補番号は `plan`）。種からは再現できない印で、`export-samples.ts` はエラーにする。`pick` は −1〜23、−1 は保険の計画。保険の計画は (seed, k) に依らず同じ音。
- **`accompMeta`**: §4.2 の制約で `master-fx.ts` の `masterFxToMeta` を import せず、同じ変換を複製している（一致は検査で確認。後継書で解消予定）。
- **`baseKey`**: `#compose` には与えた値のまま書く（"any" を書き換えない）。
- **DAW（段階2）**:
  - `applyMasterDynamics` は秒単位の `MasterDynamics`。`loadMML` は純関数 `masterDynamicsFromMeta`（`master-fx.ts`）を通す。`t.composeSlot = null` は `loadMML` に残した。
  - `loadMML` で `trackOctave`・`trackOctaveUnison` を戻す（書き出しが焼き込むので二重に掛かっていた。歌ものでも起きていた既存の不具合）。
  - `releaseAccompMix`: 画面の曲が伴奏主体で、マスタディレイとループがその値のままなら、歌ものの作曲の前に初期値へ戻す（音量 80 は戻さない）。
- **残っている小さなこと**: 陽性対照の @0 は fb の50小節の F#5 が F#4 になる／伴奏主体の後の歌ものはマスタ音量 80 から始まる／デスクトップ幅の側パネルで「入れ替え」が2行目へ折り返す。
