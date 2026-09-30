# 伴奏主体モード（`composeAccomp`）の設計

2026-09-28 作成。行番号はすべて 2.1.29 時点のもの。
**実装の状況（2026-09-28）: 段階0（v の保持）・段階1（生成器の本体・関門・入口・MML の書き出し・検算・試聴スクリプト）・
段階2（DAW への組み込み）まで。** 実装で設計からずらした点は付録 C（段階1-B）・付録 D（段階1-C）・付録 E（段階2）。
**`#compose` の書式は、後継の `docs/accomp-style-engine.md` の段階 S0 で `accomp:<baseKey>:<k>` から
`style:fb.v1:<baseKey>:<k>` に変えた**（同書 §2.5・付録 F）。本書の `accomp:…` は変更前の書式として読むこと（旧書式も読める）。
**表は、同書の段階 S1 で `src/compose/compose-accomp-tables.ts` から `src/compose/accomp-styles/fb.ts`（スタイル fb）へ移した**（同書 付録 F.7）。
本書の「表（`compose-accomp-tables.ts`）」は `fb.ts` と読み替えること。`compose-accomp-tables.ts` は同じ名前で読み直すだけの互換の口として残してある。

所有者が承認した目的に対して、設計案3つ（「表を組み合わせる案」「指標で選ぶ案」「最小の組み込み案」）と
調査4本（DAW・v・部品・生成）を1つにまとめた。作業を始める前に `docs/handover-compose.md` を読むこと。
本書の §11 は、その文書との整合を確かめた節。

---

## 0. 1ページで

- **作るもの**: 既存の `composeSong`（歌メロが主役の J-POP）とは**別系統**の自動作曲。
  - 旋律はほぼ無く、分散和音が主役になる。
  - 低音と短い和音は、区間ごとに密度を変える。
  - 区間は和声の居場所で区切り、長さはそろえない。家から出て、短調側に長く留まり、借用和音を2回通って家へ戻り、そのままループする。
  - 約2分半〜3分。ドラムは無く、残響とディレイを掛ける。
  - 手本は所有者が評価した手書き編曲 `tmp/full/fb.mml`。
- **先に直す不具合**: MML の読み書きで、音符ごとの `v` がトラックごとに1値へ潰れる（3か所）。
  - 新モードの区間の強弱は、これを直さないと書き出し・キープ・投稿で消える。
  - この修正だけを単独で publish できる。直せば既存の曲の投稿埋め込みでも強弱が鳴るようになる。
- **作り方**: 表を引いて組み合わせる。
  - 固定するもの: 旅程（7区間の役割の並び）と、fb の手書き規則①〜⑤。
  - 抽選するもの: 区間長・和声の句・借用和音の組・分散のセル・低音型・調・テンポ。
  - **採点で選ばない。** 硬い制約に違反した候補だけを捨てて次を引く。
- **DAW**: 「伴奏主体」ボタンを1つ足す。
  - ノートを直接書き、ミックス（楽器・パン・EQ・送り・マスタFX・ドラムなし・ループ）は自前で当てる。
  - **おまかせマスタリングは通さない。**
- **触らないもの**: `src/compose/compose.ts` は1行も変えない。unj-reze もコードを変えず、dtm を publish した後に依存を上げるだけで済む。

---

## 1. 目的と、やらないこと

### 目的

1. fb 系統の曲を、DAW のボタン1つで作れるようにする（`gen-fb.mjs` を手で書かずに）。
   ねらいは handover と同じく**「人が手を入れる出発点」**であり、完成品ではない。
2. 音符ごとの v を、DAW・書き出し・再生専用プレイヤーのどこでも保つ。

### やらないこと

- 次のものには手を入れない: `composeSong`・`SectionSpec`・`SECTION_ORDER`・`pickBuiltinDrum`・`ComposeStats`・`screen-*.ts` の採点。
- ドラムの生成器は書かない。固定パターンの一覧から「なし」を選ぶだけにする。
- fb や参考曲「くもり空」の実測値を、採点や選抜の目標にしない。使うのは範囲の検査と表示だけ。
- `drawCount` のように大量に引いて内蔵の採点で選ぶ仕組みは作らない。
- `chords.ts:177` の `Math.floor` は修正しない。112BPM で進行の約1/3が1ステップ前にずれる潜在バグだが、直すと既存の作曲の出力と過去の `#seed` の再現が変わるので、別タスクにする。新モードはこの関数を通らない。

---

## 2. 対象の曲の系統（fb の特徴）

参照したファイル（`tmp/` は gitignore なので CI には無い。**検査はこれらを読まない**）:

| ファイル | 中身 |
|---|---|
| `tmp/full/fb.mml`・`fb.space.mml` | 評価された手本。FX の宣言は `fb.space.mml` の4行目にしか無い |
| `tmp/full/gen-fb.mjs` | fb の生成スクリプト。音は手で選び、スクリプトは表記と強弱付けだけを行う |
| `tmp/sketch/backing.mml`・`gen-backing.mjs` | 冒頭16小節の出発点 |
| `tmp/full/fa.mml`・`gen-kifuku.mjs` | 別版（評価されなかった側）。分散を `arp(tpl, sets)` の形で一般化してある |
| `tmp/聴き比べ_展開と音源.md` | fa と fb の聴き比べ |

### 2.1 全体

| 項目 | fb |
|---|---|
| 調・テンポ・長さ | ホ長調・112BPM・76小節・約163秒でループ（`#loop=on`） |
| 編成 | @0 控えめな長い音（6音だけ）／@1 分散 Lead 1 (square)／@2 低音 Synth Bass 1／@3 和音 Electric Piano 2。ドラムなし |
| マスタ | `#inst=retro_game #volume=80 #drum=none #reverb=50 #reverbdecay=30 #reverbpredelay=25 #delay=25 #delaydiv=8d` |
| トラック | `#t0rev=45 #t0dly=30`、`#t1rev=55 #t1dly=15 #t1eqhi=-9 #t1pan=50`、`#t2rev=10 #t2eqhi=-6`、`#t3rev=65 #t3eqhi=-3 #t3pan=80` |
| 音域（MIDI） | 分散 54〜83、低音 30〜52、和音 51〜69 |
| 発音数 | 分散 毎秒4.47、低音 1.73、和音 0.71回。全体で約8.4音/秒 |
| 強弱 | 音符ごとの v の種類数は、分散30・低音19・和音26 |
| 和音の置き方 | 3声の密集配置で、根音は抜く（根音は低音に任せる）。例: AM7 = `[g#3 c#4 e4]` |

### 2.2 区間表（和声の居場所で区切った7区間）

| 区間（役割） | 小節 | 和声 | 分散（毎秒の音数・上半分の平均・形） | 低音（型・音数/小節） | 和音（打ち方） | 分散の基準 v |
|---|---|---|---|---|---|---|
| A 家（home） | 16 | 長調のダイアトニック。13〜15小節で借用和音を予告する | 4.67・D5・往復（a-b-a 37%） | walk・5.4 | 1・3拍目に8分。予告の小節は4分 | 58→72（4小節ずつ上げて引く） |
| B 短調側（minorDwell） | 20 | vi・iii・ii・IV を2小節1和音で回し、ii→iii→IV→V と上がって半終止 | 4.39・A4・低い音で転がる | sparse・2.8 | 1小節1回（1拍目と3拍目を交互） | 50→58 |
| C1 借用1（borrowA） | 8 | ♭VI・♭VII | 4.43・D#5・下る（上18／下57） | pedal→3+3+2・2.5 | 長く伸ばす | 60→64 |
| R 家の近く（glimpse） | 4 | A の冒頭の和声で、ii で止める | 4.67・A のセルの上を1段上げる | thinned・3.3 | 1・3拍目に8分 | 52→50（凹み） |
| C2 借用2（borrowB） | 8 | ♭III・iv・i・iv6 | 4.43・D#5・上る（上52／下23） | pulse8・5.5 | 長く伸ばし、1段高く置く | 64→76→64（**唯一の山**） |
| L 薄く明るい（lift） | 8 | I・IV・I/3・IV(9)・vi・IV・ii・Vsus4 | 3.97・F5（**最高音域**）・振り子 | dropout・0.6 | 1小節1回（交互） | 50→48（**最弱**） |
| A' 戻る（return） | 12 | A の1〜8小節と同じ和声＋vi・iii・IV・Vsus4 V。予告は省く | 4.67・C#5 | thinned→walk・4.8 | 1・3拍目に8分 | 52→58（A より静か） |

### 2.3 fb の手書き規則（以下「規則①〜⑤」と呼ぶ）

- **①** 分散の発音数は、区間をまたいでもほぼ一定に保つ（毎秒4〜5）。区間ごとの違いは、セル・向き・音域・低音の密度・v で出す。
- **②** 隣り合う区間では、次の3つのうち2つ以上を変える。同じ和声がまた出てくる箇所も同様。
  - 分散のセルと向き
  - 低音の型
  - 和音の長さと高さ
- **③** 借用和音どうしで、借りた先の調の V→I を作らない。
  - fa では ♭VII→♭III（D→G）が「曲いちばんの到達点」になってしまい、レビューで指摘された。
  - fb は2つの借用区間のあいだに家の近く（R）を挟んで、これを避けている。
- **④** 強弱の山は1区間（borrowB）だけにする。
  - glimpse は凹ませる。
  - lift を最弱にする。
  - return は冒頭の家より静かにする。
  - home の中は、4小節ずつ「上げて、4小節目で引く」。
- **⑤** 借用区間では、home の終わり（13〜15小節目）で予告した借用和音を広げる。return では予告を省く。

**ループの閉じ方（5点）**

1. 最終小節は Vsus4→V にする。
2. 和音は最後の一打だけ付点4分に伸ばす。
3. 分散の最終小節は、home の最終小節と同じ音にする。
4. 低音は導音で終え、頭の主音へ半音で上がる。
5. @0 は sus4 の4度から3度へ降りる。

### 2.4 fa と fb の差（評価に効いたと推測するもの）

所有者が聴き比べたのは fa と fb の2本で、評価されたのは fb。差は次のとおり（**推測で、N=1**）。

- (a) 短調側の滞留が長く、区間の長さがそろっていない。fb は20小節、fa は12小節。
- (b) 借用区間を2回に分け、あいだに家の近くを4小節だけ挟んでいる。fa は借用区間が12小節ひと続きで、そこで @0 が10小節鳴る。
- (c) 山は中盤の1か所だけで、終わりは静かに戻る。fa は最後の A'' が頂点になっている（分散の天辺 C#6、v76）。
- (d) @0 がほぼ無い。fb は6音、fa は15音。
- (e) 借用区間の分散に向きを持たせている（C1 は下る、C2 は上る）。

旋律の無い曲では、戻ってくる home ブロックがテーマの役を担っていると読める。所有者の以前の不満「曲にテーマがない」「滑り台の位置が変わらない」に対して、fb の旅程（家からの距離が区間ごとに変わる）が答えになっているのかもしれない。これも推測。

---

## 3. 3案から何を採ったか

| 論点 | 表案 | 指標案 | 最小案 | **採用** | 理由 |
|---|---|---|---|---|---|
| 候補の選び方 | 1回引き、硬い制約違反だけ引き直す | 24本引き、関門＋帯の採点＋多様性で選ぶ | 1回引き | **1回引き。硬い制約違反だけ次を引く（上限24）** | handover の「内蔵採点は品質と無相関（r=−0.06）」「統計を寄せない」に従う。fb と fa の比較は N=1 で、差はレビューで変えた点そのものなので、採点の根拠にならない |
| 指標 | 自己検査のみ | 14指標、関門と採点 | 自己検査のみ | **指標案の物差しを採るが、用途は関門・表示・陽性対照・将来の較正に限る**（§7） | 測る道具は要る。選抜には使わない |
| 陽性対照 | なし | fb を計画として書き直して再現し、指標が一致するか見る。1点ずつ壊す切除対照 | 和音配置の辞書一致率 | **指標案の fixture と切除対照に、最小案の辞書一致率を足す** | handover の反省「測定器を検証しないまま結論を出した」を繰り返さない |
| 表の書き方 | ハ長調のコード名 | ローマ数字 | 度数と質 | **ローマ数字で書き、ハ長調のコード名へ変換する** | 調に依存しない。所有者は ♭VI などで考えている |
| 乱数 | 1本 | 1本＋候補番号で再現 | 段ごとに分ける | **段ごとに分け、候補番号 k を `#compose` に残す** | 一変数の A/B と、`recent` があっても再現できることを両立するため |
| DAW への渡し方 | ノートを直接書く＋トラック設定を切り出す | 同じ（meta の適用をまるごと切り出す） | 同じ（トラック設定とマスタの動的処理を分けて切り出す） | **最小案の2分割** | meta の適用をまるごと使うと、伴奏音源（`#audio` が無ければ外す）と音律（`#edo` が無ければ12へ戻す）まで巻き込む |
| 短調の扱い | 平行長調を家にする | rootShift+3 | rootShift はそのまま（＝平行長調） | **rootShift はそのまま** | 短調は Am 基準、長調は C 基準で持つので、同じ rootShift の長調が平行長調になる。指標案の +3 は誤り（ホ短調は −5、+3 で −2＝変ロ長調になる） |
| 山の区間 | borrowB に固定 | 抽選（0.75／0.25） | borrowB に固定 | **borrowB に固定（v1）** | fb の規則④そのまま。抽選は拡張に回す |
| 名前 | `composeBacking` | 同 | 同 | **`composeAccomp`**（`#compose=accomp:…`） | dtm では backing がすでに「伴奏音源（mp3・YouTube）」の意味で使われている（`backing-audio.ts`、`BackingMode` などを export 済み） |
| 役割名 | minorSide / nearHome / light | minorDwell / glimpse / lift | 同左 | **home / minorDwell / borrowA / glimpse / borrowB / lift / return** | 2案が同じ名前を使っていた |

---

## 4. 全体構成

### 4.1 ファイル（すべて `C:\_own\git\_users\onjmin\dtm` の下）

| ファイル | 役割 | 規模 |
|---|---|---|
| `src/mml/mml-velocity.ts`（新規） | v の読み書き規則を1か所に置く。`splitTrackVelocity` / `effectiveVelocity` / `chordVelocity`。依存なしの純関数 | 約60行 |
| `src/compose/compose-accomp-tables.ts`（新規） | **データだけ**。旅程、区間長、和声の句、借用和音の組、ボイシング用の度数、分散のセル、低音型、和音の打ち方、役割ごとの質感、強弱、ミックス | 約400行 |
| `src/compose/compose-accomp-plan.ts`（新規） | 段0〜3（調・テンポ・旅程・和声・質感）から `AccompPlan` を作る。純関数 | 約300行 |
| `src/compose/compose-accomp-realize.ts`（新規） | 段4〜9（和音・低音・分散・色の線・強弱・継ぎ目）で、計画を4トラックのノートにする。純関数 | 約450行 |
| `src/compose/compose-accomp-check.ts`（新規） | 硬い制約（関門）と表示用の指標。生成器と scripts の両方から使う | 約300行 |
| `src/compose/compose-accomp.ts`（新規） | 公開の入口 `composeAccomp` と `accompMeta`。候補のループ、保険の計画、正規化、ミックス | 約200行 |
| `src/compose/compose-accomp-mml.ts`（新規） | `accompToMml`。`MMLCore.getMMLFromNotes`（v を出すよう直したもの）と `formatMmlMeta` で組む。**mml-parser を読むので koe まで引く**。compose-accomp からは import しない | 約80行 |
| `scripts/test/check-mml-velocity.ts`（新規） | v の往復の検算 | 約200行 |
| `scripts/test/check-compose-accomp.ts`（新規） | 生成器の検算。陽性対照と切除対照を含む | 約400行 |
| `scripts/test/fixtures/accomp-fb-plan.ts`（新規） | fb を `AccompPlan` として手で書き直した陽性対照 | 約200行 |
| `scripts/accomp/accomp-audition.ts`（新規） | 試聴用。テストには入れない | 約150行 |

既存ファイルの変更は次の8本。

- `mml-core.ts`
- `daw.ts`
- `daw-ui.ts`
- `mml-player.ts`
- `midi-io.ts`
- `mml-parser.ts`（コメントのみ）
- `index.ts`
- `scripts/compose/export-samples.ts`・`scripts/compose/compose-lab.ts`

### 4.2 依存の制約

- `compose-accomp*.ts`（`-mml` を除く）が実行時に import してよいのは、次のものだけ。
  - `@onjmin/chord-parser`（`parseChord`）
  - `./chords`（`spelledToUnits`・`semitonesToUnits`）
  - `./compose-keys`（`resolveComposeKey`・`COMPOSE_KEYS`）
  - `./compose` の `seededRandom`
  - `./mml-velocity`
  - `./drum-config` の `NO_DRUM_PATTERN`
- 型は `import type` にする（`ComposedNote`・`MmlMeta`・`MasterFxSettings`・`PresetSlot`）。
- **次のものは実行時に import しない**: `mml-parser`・`lyrics`・`daw`。前例は `advanced-layers.ts:4-8` で、Node から検算するため。
- `chords.ts` の `buildChordPlacements` は通さない。理由は2つ。
  - `:177` の `Math.floor` で発音位置がずれる。
  - ボイシングが基本形に固定され、分散も R-3-5-8 の等間隔しか作れない。

### 4.3 データの流れ

```
baseKey, random(seed) ─▶ composeAccomp
    段0  調（1回の呼び出しで固定）
    候補 k = 0,1,2…（上限24）: 乱数から種を6つ引く（計画・和声・質感・配置・強弱・色）
        plan    = 段1〜3（旅程・和声・質感）          … compose-accomp-plan.ts
        tracks  = 段4〜9（和音・低音・分散・色・強弱）  … compose-accomp-realize.ts
        gates   = 硬い制約の検査                        … compose-accomp-check.ts
        違反していれば次の k へ。recent と同じ計画も次の k へ
    どれも通らなければ保険の計画（fb 相当。関門を必ず通ることを検算済み）
    絶対値の v を splitTrackVelocity で {トラック音量 T, 相対 velocity} に分ける
  ─▶ AccompSong
        ├─ DAW: runComposeAccomp がトラック 0〜3 へ直接書き、ミックスを当てて鳴らす
        ├─ scripts: accompToMml で .mml にする（試聴・再現・往復の検算）
        └─ 将来の外部利用（index.ts から export）
```

---

## 5. 公開 API（型）

```ts
// src/compose/compose-accomp.ts
export type AccompRole =
  | "home" | "minorDwell" | "borrowA" | "glimpse" | "borrowB" | "lift" | "return";

export type AccompOptions = {
  stepsPerBar?: number;   // 既定 192。16 の倍数でなければ例外
  edo?: 12 | 31;          // 既定 12
  baseKey?: string;       // DAW の「ベース調」の値。"any" は "major" として扱う。
                          // 短調（key_*m / "minor" / 短調の mood_*）は同じ rootShift の長調（＝平行長調）を家にする
  random?: () => number;  // seededRandom(seed) を渡すと決定的になる
  pick?: number;          // 候補番号を固定する（再現用。#compose の3項目め）。指定時は recent を無視する
  recent?: string[];      // 直近の planSignature（最大5）。一致した候補は飛ばす
  colorLine?: boolean;    // @0 の色の線。既定 true（1曲あたり4〜6音）
  overrides?: {           // 一変数の A/B と検算用。v1 で持つのはこの3つだけ
    lengths?: Partial<Record<AccompRole, number>>;
    bpm?: number;
    plan?: AccompPlan;    // 計画を丸ごと与える（陽性対照の fb 計画、保険の計画）
  };
};

export type AccompTexture = {
  arpCells: string[];     // 4小節ブロックごとのセル id（ARP_CELLS）
  arpWindow: { lowMin: number; lowMax: number; topMin: number; topMax: number }; // 絶対 MIDI（実際に鳴る高さ）
  bass: string[];         // 4小節ブロックごとの低音型 id（BASS_PATTERNS）
  comp: "short2" | "alt13" | "long";  // 区間の基本の打ち方。借用・予告・最終小節は規則で上書きする（§6 段5）
  compRegister: -1 | 0 | 1;
  accent: "normal" | "gentle";
};

export type AccompRegion = {
  role: AccompRole;
  label: string;          // 表示用（例 "B 短調側に長く留まる"）
  startBar: number;
  bars: number;           // 4 の倍数
  chords: string[];       // 小節ごとのローマ数字。半小節2和音は空白区切り（例 "iii7 vi7"）
  texture: AccompTexture;
  arpLevel: number[];     // 小節ごとの分散の基準 v（区間ごとの ±2 のずれを含む）
};

export type AccompPlan = {
  bpm: number;
  rootShift: number;
  borrowPair: string;     // BORROW_PAIRS の id
  regions: AccompRegion[];
};

export type AccompSlot = "color" | "arp" | "bass" | "comp";
export type AccompTrack = {
  index: 0 | 1 | 2 | 3;   // @0 color / @1 arp / @2 bass / @3 comp
  slot: AccompSlot;
  volume: number;         // トラック音量 T（DAW のベロシティスライダーの値）
  notes: ComposedNote[];  // velocity は相対値（100 = T）。読み込み直後と同じ形にしておく
};

export type AccompMix = {
  instrument: "retro_game";
  volume: 80;
  drum: "none";                 // NO_DRUM_PATTERN
  loop: true;
  masterFx: MasterFxSettings;   // reverb 50 / decay 3.0s / predelay 25ms / delay 25 / "8d"
  masterCompression: 0; fadeIn: 0; fadeOut: 0;   // 前の曲の値を残さないよう、0 を明示する
  trackInstruments: Record<0|1|2|3, string>;     // 0,1: Lead 1 (square) / 2: Synth Bass 1 / 3: Electric Piano 2
  trackEqHigh: Partial<Record<0|1|2|3, number>>; // {1:-9, 2:-6, 3:-3}
  trackPan: Partial<Record<0|1|2|3, number>>;    // {1:50, 3:80}
  trackReverbSend: Record<0|1|2|3, number>;      // {0:45, 1:55, 2:10, 3:65}
  trackDelaySend: Partial<Record<0|1|2|3, number>>; // {0:30, 1:15}
};

export type AccompStats = {     // 表示と自己検査のため。採点・選抜には使わない（§7）
  seconds: number;
  arpNotesPerSec: number[];     // 区間ごと
  arpUpperMean: number[];       // 区間ごとの分散上半分の平均音高
  arpVMean: number[];           // 区間ごとの分散の v 平均
  bassNotesPerBar: number[];
  compMeanLen: { borrowed: number; diatonic: number };
  arpIntervalHist: Record<"step" | "3rd" | "4th" | "5th" | "8ve+", number>;
  clashesPerBar: number;
  vKinds: [number, number, number, number];
  compVoicingMatchesFb?: number; // 陽性対照の時だけ
};

export type AccompSong = {
  kind: "accomp";
  bpm: number; rootShift: number; keyName: string; keyLabel: string;
  homeFromMinor?: string;       // 短調を選んだとき「ホ短調→ト長調を家に」の注記
  bars: number; seconds: number; stepsPerBar: number; edo: 12 | 31;
  plan: AccompPlan;
  chordProgression: string;     // ComposeResult と同じ書式（"|" 区切り）。表示用
  tracks: [AccompTrack, AccompTrack, AccompTrack, AccompTrack];
  mix: AccompMix;
  compose: string;              // "accomp:<baseKey>:<k>"（#compose の値。[\w:.-]+ に収まる）
  pick: number;                 // 採った候補番号。-1 は保険の計画
  planSignature: string;        // 区間長・借用組・セル id・低音型・bpm を連結したもの
  draws: { tried: number; rejected: Record<string, number> };
  stats: AccompStats;
};

export const composeAccomp: (o?: AccompOptions) => AccompSong;
export const accompMeta: (s: AccompSong) => MmlMeta;  // DAW の適用と MML 書き出しが共通で通る唯一の変換

// src/compose/compose-accomp-mml.ts（mml-parser を読む）
export const accompToMml: (s: AccompSong, prov?: { seed?: number; version?: string; minified?: boolean }) => string;

// src/mml/mml-velocity.ts
export const splitTrackVelocity: (vs: readonly number[], fallback: number) => { volume: number; velocities: number[] };
export const effectiveVelocity: (trackVolume: number, velocity?: number) => number;
export const chordVelocity: (notes: readonly { velocity?: number }[]) => number;
```

`src/index.ts` には、既存の compose の export（23〜31行）と同じ形で個別に足す。対象は次のとおり。`advanced-layers` は今までどおり export しない。

- `composeAccomp`・`accompMeta`・`accompToMml`
- 上の型
- `splitTrackVelocity`・`effectiveVelocity`

---

## 6. 生成の各段

### 共通の約束

- **ハ長調で作る。** 音は（MIDI 相当の半音, 五度圏の位置）の組で持つ。最後に `spelledToUnits(...) + semitonesToUnits(rootShift, edo)` で units に写す。`compose.ts:5267-5270` と同じ規約なので、31平均律でも ♭VI（A♭）が G# に化けない。
- **借用和音はフラットで綴る**（ハ長調で A♭・B♭・E♭・Fm・Cm）。
- **音域の窓は、実際に鳴る高さ（絶対 MIDI）で持つ。** 値は fb の実測（ホ長調）。ハ長調の座標へは −rootShift して当てるので、調が変わっても実際に鳴る音域は同じになる。
- **時間は16分単位で扱う。** 1ステップ幅は s16 = stepsPerBar/16。
  - 使う音価は 12・24・36・48・72・96・144・192 ステップ（16分〜全音符）だけ。MMLCore が表せる長さで、タイは使えない。
- **乱数は段ごとに分ける。**
  - 最初に、呼び出しの乱数から調の種を1つ引く。
  - 次に、候補ごとに固定の順で種を6つ引き、それぞれ `seededRandom` で独立した乱数列にする。順は 計画 → 和声 → 質感 → 配置 → 強弱 → 色。
  - 候補 k の中身は（seed, k）だけで決まる。
  - ある段の表を変えても、他の段の抽選は変わらない。変わるのは、同じ乱数列の中で後に引く分だけ。

### 段0: 調とテンポ

```
choice = baseKey === "any" || !baseKey ? "major" : baseKey
key = resolveComposeKey(choice, rKey)
if key.mode === "minor":
  // 短調は Am 基準、長調は C 基準の rootShift なので、同じ値のまま長調として扱えば平行長調になる
  home = COMPOSE_KEYS の長調のうち rootShift が等しいもの
  homeFromMinor = `${key.keyLabel} → ${home.label} を家にして、${key.keyLabel} の側に長く留まる`
bpm = overrides.bpm ?? weighted(BPM_TABLE)   // {110:1, 112:3, 114:2, 116:1}
```

### 段1: 旅程（区間の役割と長さ）

役割の並びは固定する: **home → minorDwell → borrowA → glimpse → borrowB → lift → return**。
`SectionSpec` と `SECTION_ORDER` は使わない。

区間長の候補（すべて4の倍数）:

| 役割 | 候補 {小節数: 重み} | fb |
|---|---|---|
| home | {16: 1}（v1 は固定。4つの句のうち最後が予告の句） | 16 |
| minorDwell | {16: 1, 20: 3, 24: 1} | 20 |
| borrowA | {8: 3, 12: 1} | 8 |
| glimpse | {4: 1} | 4 |
| borrowB | {8: 3, 12: 1} | 8 |
| lift | {8: 3, 4: 1} | 8 |
| return | {12: 3, 8: 1} | 12 |

```
for try < 20:
  lens = 役割ごとに引く（overrides.lengths があればそれを使う）
  守ること: minorDwell ≥ home、かつ minorDwell > home 以外のどの区間
  seconds = Σlens × 240 / bpm
  150 ≤ seconds ≤ 180 なら確定
外れ続けたら fb と同じ [16,20,8,4,8,8,12] にする（112BPM なら 163 秒）
```

### 段2: 和声（ローマ数字の4小節の句を表から並べる）

句の初期値は付録 A に置いた。fb・fa・backing から起こしたもの。

1. **借用の組を先に引く**（`BORROW_PAIRS`）。1つの組が次をまとめて持つ。
   - 予告の句
   - borrowA の和声（8小節版と12小節版）
   - borrowB の和声（同じく2版）
   - glimpse の終わりの和音（`glimpseEnd`）

   表に載せるのは、規則③の検査を通る組だけにする。

2. **home（16小節）**
   - 1〜4小節: `HOME_OPEN` から1つ。主和音で始まる句。
   - 5〜12小節: `HOME_MID` から重複なしで2つ。
   - 13〜16小節: 組の予告の句。最終小節は必ず `Vsus4 V`（規則⑤）。

3. **minorDwell（L小節）**
   - 最初: `MINOR_OPEN`。vi から、2小節1和音で始まる。
   - 途中: `MINOR_MID` を (L−8)/4 個。同じ句を続けない。
   - 最後: `MINOR_CLIMB`。ii→iii→IV→Vsus4 V と上がって、半終止で終える。

4. **borrowA・borrowB**: 組の和声をそのまま使う。

5. **glimpse（4小節）**: home の1〜3小節目の和声に、組の `glimpseEnd` を続ける。
   - `glimpseEnd` は、borrowB の頭の根音へ低音が半音で上がれる和音にする。
   - 例: borrowB が ♭III で始まるなら ii7（D→E♭）、iv なら iii7（E→F）、♭VI なら V（G→A♭）。
   - V や I へは解決させない。

6. **lift**: `LIFT` から、区間の長さぶんの句を並べる。最後の句は V 系の和音で終わる。

7. **return**
   - 8小節なら: home の1〜4小節 ＋ `RETURN_END`。
   - 12小節なら: home の1〜8小節 ＋ `RETURN_END`。
   - `RETURN_END` は `vi7|iii7|IVM7|Vsus4 V`。借用和音の予告は入れない（規則⑤）。

8. **同じ和音が2小節続くときの色（テンション）は、句の表に直接書く**（例 `vi7|vi(add9)`、`bVIM7|bVIM7(#11)`）。
   後処理の規則にはしない。聴いて直すときに触るのが表の1行で済むようにするため。

9. **変換と判定**
   - 各和音を `romanToC()` でハ長調の名前にし、`parseChord` を通して `{notes, noteFifths, root}` を得る。
   - **borrowed** は「三和音と7度の音（テンションは除く）に、ハ長調の音階外の音がある」で判定する。
   - `IVM7(#11)` の #11（B）は音階内の音なので、借用に数えない。

10. **規則③と⑤は、組み立てた後に関門で確かめる**（§7）。
    - ③: 区間の境もまたいで、隣り合うすべての和音の組を調べる。前が借用の長和音系で、後ろが借用和音、かつ根音が完全4度上（+5半音）なら違反とする。
    - ⑤: 予告の借用和音が borrowA ∪ borrowB に含まれていること、return に借用和音が無いこと。

### 段3: 質感の割り当て（規則②）

役割ごとの候補表（`ROLE_TEXTURE`）。分散の窓は fb の実測（絶対 MIDI、ホ長調で決めた値）。

| 役割 | 分散のセルと向き | 分散の窓 支え／天辺 | 低音の型 | 和音の打ち方・段 | アクセント |
|---|---|---|---|---|---|
| home | 往復・跳躍系から、4小節ブロックごとに1つ。4つめは予告用の上がる型 | 59–64 / 76–78 | walk（2和音の小節は walk2） | short2・0。予告の小節は fore | normal |
| minorDwell | 転がる・まばら・上がる系（低い窓）。4小節ごとに替える | 54–57 / 73–76 | sparse。最終ブロックは walkLite | 2小節1和音は alt13、1小節1和音は short2・0 | normal |
| borrowA | 下る（G5/F#5 から） | 57–60 / 78–79 | 前半 pedal → 後半 332 | long・0 | normal |
| glimpse | home 第1ブロックのセルの `liftVariant`（上の音を1段上げた変形） | home と同じ | thinned | short2・0 | normal |
| borrowB | 上る（はためき 16 16 8 8 8 など） | 55–64 / 78–79 | pulse8。最終小節は2分に緩める | long・+1 | normal |
| lift | 振り子（B4/A4 を軸に8分） | 66–71 / 80–83 | dropout | alt13・0 | gentle |
| return | 前半は home の同じ小節を**音ごと複写**、後半は home のセル | home と同じ | 前半 thinned → 後半 walk | short2・0 | normal |

- 候補が複数ある項目は、その候補の「質感」乱数で引く。区間の中では、同じセルを2ブロック続けない。
- 組み上げたあと、**隣り合う区間**と**同じ和声が再び出る区間の組**（glimpse と home、return と home）を比べる。比べる軸は次の5つで、2つ以上違わなければ質感だけを引き直す（上限10回）。
  - 分散のセルの族と向き
  - 分散の窓
  - 低音の型
  - 和音の打ち方
  - 和音の段
- return と home は「同じ和声で質感を変える」組として扱う。前半の複写は音高が同じでも、低音の型（thinned）と強弱（静か）が違うので、軸2つが違う。fb の A' と同じ扱い。

### 段4: 和音の配置（@3。分散のぶつかり回避に使うので最初に決める）

- **3声の密集配置**にする。
- 窓は F#3〜F#4（MIDI 54〜66）。段 +1 なら 58〜70、−1 なら 50〜62。これもハ長調の座標へ −rootShift して当てる。
- 候補の作り方:
  - `COMP_TONES` の度数から3音を選び、窓の中のすべての転回・オクターブに展開する。
  - 度数は、7th 系が {3,5,7}（根音を抜く）、add9 が {3,5,9}、三和音と sus が {R,3/4,5}、m6 が {m3,5,6}、M7(#11) が {5,7,#11}。
- 除外: 隣の声部と半音になるもの、幅がオクターブを超えるもの。
- 選び方:
  1. 直前の配置からの移動量 Σ|Δ| が最小のものを選ぶ。
  2. 最上音が D4〜F#4 にあるものを加点する。
  3. 同点は乱数で決める。
- fb の手選びの辞書（`gen-fb.mjs` の `V`。例 AM7=[g#3 c#4 e4]、CM7=[g3 b3 e4]）と一致するかを、陽性対照で数える。

### 段5: 和音の打ち方（`COMP_HITS`）

| 名前 | 1小節の形（16分単位） | 使う場所 |
|---|---|---|
| short2 | 和音:2 休:6 和音:2 休:6（2和音の小節は1つずつ） | 本調の和音の既定 |
| alt13 | 1小節目は1拍目に8分、2小節目は3拍目に8分（交互） | minorDwell の2小節1和音、lift |
| fore | 和音:4 休:4 和音:2 休:6（2和音の小節は 4 休4 4 休4） | home の予告の小節（fb の A13〜15） |
| long | 1回目は全音符、同じ和音の2小節目は2分＋2分休符。区間の後半は付点2分＋4分休符と2分＋2分休符 | **借用和音だけ** |
| final | a:2 休:6 b:6 休:2 | 最終小節（Vsus4 を8分、V を付点4分） |

規則「借用だけ長く」は、`borrowed` フラグで判定する。本調の和音は、どの区間でも short2 か alt13 のどちらかになる。
和音の構成音は、開始・長さ・v をそろえる（MMLCore は和音を1トークンにまとめ、長さを先頭の音からしか取らないため）。

### 段6: 低音（@2）

- 使う度数は、根音・5度・オクターブと、経過音 P だけ。
- 根音は絶対 MIDI 30〜42 の中で、前の根音に最も近いオクターブに置く。
- 5度は根音+7（52 を超えるなら −5）、8 は根音+12（52 を超えるなら根音）。

型の表（`BASS_PATTERNS`。1小節=16）:

| 型 | 形 | fb の出どころ |
|---|---|---|
| walk | R:6 5:2 8:4 5:2 P:2 | A |
| walk2 | R:4 5:2 8:2 R':4 5':2 P:2（半小節2和音） | A の3・4小節 |
| walkLite | R:6 5:2 8:4 5:4 | B 33〜36 |
| sparse | R:12 5↓:4 と R:6 5:2 R:8 を交互 | B 17〜32 |
| pedal | R:16 と R:8 R:6 5↓:2 を交互 | C1 37〜40 |
| 332 | R:6 R:6 8:4 | C1 41〜44 |
| pulse8 | R:2 R:2 R:2 8:4 R:2 5:4 | C2 49〜55 |
| dropout | R:12 休:4 と 休:16 を交互 | L |
| thinned | R:6 5:2 8:8 | R、A' の頭 |

- **P（経過音）**: 次の根音へ寄せる音。
  - 区間の境と、借用和音に入る所では、次の根音の半音下（綴りは導音）にする。
  - それ以外では、音階上の隣の音にする。次の根音が同じなら5度にする。
- **区間の境の半音渡し**（fb の D→D#→E、F#1→G1、A→F#→E の一般化）:
  - 最終小節の最後の8分（型によっては4分）を、次の区間の頭の根音の半音下へ差し替える。
  - その小節の和音と短2度でぶつかるなら、5度に戻す。
- **曲の最後の音は導音**（V の3度）にし、頭の主音へ半音で上がる。

### 段7: 分散（@1、主役）

**音の組（5音）**: 和音ごとに s0 < s1 < s2 < s3 < s4 を選ぶ。

- s0 の候補: 窓の支えの範囲にある根音か5度。無ければ3度。
- s1〜s4: 構成音と、記号に書かれたテンション（9・#11）から、深さ優先で探す。
- 条件:
  - 隣り合う音程は 3〜9 半音にする。2度は、s4 がテンションのときの s3→s4 だけ許す。
  - s4 は天辺の範囲に入れる。
  - これで順次進行が構造的に少なくなる（fb の step は 0〜12%）。
- コスト（最小のものを選ぶ。同点は乱数）:

```
cost = Σ 0.2·|音程−4|           // 3度〜4度前後を好む
     + 3·(2度の数)
     + 0.3·|s4 − 前の組の s4|     // 天辺をなめらかに
     + 0.2·|s0 − 前の組の s0|
     + 10·(同時に鳴る和音トラック・低音と短2度／短9度になる数)
       // fb の「A4 を G#3 と重ならない位置へ」の一般化。判定は tmp/full/clash-all.ts と同じ
```

**セル**（`ARP_CELLS`）: 1小節分のテンプレートで、`[音の番号 0..4, 16分の数][]`（合計16）。

- タグとして family・向き・1小節の音数・`liftVariant`（glimpse 用の変形）を持つ。
- 初期値は fb・backing・fa から起こす（付録 A）。gen-kifuku.mjs の `T_A1a` などは、すでにこの形で書かれている。

```
for 区間, 4小節ブロック b:
  cell = texture.arpCells[b]
  for 小節:
    sets = この小節の和音ごとの音の組（1つか2つ）
    pos = 0
    for [idx, len] of cell:
      set = sets.length > 1 && pos >= 8 ? sets[1] : sets[0]
      同じ和音の2小節目なら、番号 3 と 4 を入れ替える（fb の「上の音だけずらす」）
      音符(start = (bar·16 + pos)·s16, len·s16, set[idx])
      pos += len
```

- **規則①**: 区間ごとの毎秒の分散音数が、lift 以外は [4.0, 5.0]、lift は [3.6, 5.0] に入ることを関門で確かめる。
  - セルの1小節の音数は8〜10に限る。112BPM なら 3.7〜4.7 音/秒。
  - 区間の差は、セル・向き・窓・低音の密度・v で出す。
- **継ぎ目**:
  - return の前半は、home の同じ小節と同じ音高にする（複写）。
  - 最終小節は、home の最終小節と同じ音高にする（どちらも `Vsus4 V`）。
  - 最後の音は、曲末（bars·stepsPerBar）でちょうど終わる。sequencer は、最後の音の終わりをループ長にするため。

### 段8: 色の線（@0、任意・ごく少ない）

- **置く場所**: borrowB の中の小節 {1, 2, 5, 6}（0始まり）と、最終小節だけ。1曲に4〜6音。
- **音**: その小節の借用和音の色の音。
  - ♭III の長7度
  - i の短7度
  - iv の短3度か5度
  - ♭VI の長7度
- **高さの条件**:
  - その小節の分散の天辺より2半音以上下に置く。
  - 同じ拍で分散と同じ音を弾かない。
  - 鳴っている分散の音と短2度にならない。
  - 候補が無ければ、その小節には置かない。
- **長さ**: 2〜3拍。
  - 組の1つめの小節は、2拍目から2拍。2つめの小節は、1拍目から3拍。
  - 分散がその途中で天辺を弾くなら、その手前で切る（fb の50小節目の F#5 と G5 の解消）。
- **最終小節**: sus4 の4度→3度を2拍ずつ（ハ長調なら C5→B4）。
- **v**: 34〜36（fb の値）。

### 段9: 強弱（絶対値の v、3層）→ 正規化

**1. 区間の起伏**（`LEVELS`）: 役割ごとのキーフレームを区間の長さへ線形に伸ばし、小節ごとの分散の基準 v を作る。低音と和音は、分散からのオフセットで決める。

| 役割 | 分散の基準（fb の値） | 低音 | 和音 |
|---|---|---|---|
| home | 58 から。ブロックごとに +4、ブロック内は [0,+2,+4,+2]。予告ブロックは [−2,+2,+6,−4] | +26 | −14 |
| minorDwell | 50→58（終わりの上げ幅は小さく） | +26 | −14 |
| borrowA | 60→64 | +14（伸ばす音なので控えめ） | −14 |
| glimpse | 52→50（凹ませる） | +18 | −15 |
| borrowB | 64,66,68,70,74,76,70,64（区間の 3/4 で頂点、そこから引く） | +22（最終小節は +8） | −14→−20 |
| lift | 50→48（最弱） | 72 に固定 | 32 に固定 |
| return | 52→58 | +25 | −16 |

区間ごとに ±2 のずれ（regionOffset）を1つ引き、区間内の全トラックへ同じ値を足す。形は変えない。

**2. 拍位置の加減**（`gen-fb.mjs:340-346` そのまま。pos は小節内の16分位置）:

- 分散（normal）: pos%8==0 → +10、pos%4==0 → +6、偶数 → 0、奇数 → −6。
- 分散（gentle、lift）: +4 / +2 / 0 / −3。
- 低音: pos%8==0 → +6、pos%4==0 → +2、それ以外 → −2。
- 和音: pos≥8 → −5。
- 最後に 1〜127 に丸める。

**3. 規則④は関門で確かめる**（§7）。区間ごとの分散の v 平均で、次がすべて成り立つこと。

- 最大は borrowB で、2番手との差が3以上。
- 最小は lift。
- return < home。
- glimpse < 両隣。

**正規化**: トラックごとに `splitTrackVelocity(絶対v の列)` を掛け、T を `volume` に、round(100·v/T) を velocity にする。
これは読み込み直後とまったく同じ形なので、次の3つで音量も SoundFont の明るさも一致する。

- DAW で作った直後
- キープして戻した後
- 投稿した後

### 段10: 表現上の制約（関門）

- 同じトラック内で、和音以外の音が重ならない（MMLCore は次の発音で切るため）。
- 和音の構成音は、開始・長さ・v がそろっている。
- 音価は上の8種だけ（最長は全音符）。
- 分散と低音の最後の音が、曲末ちょうどで終わる。

---

## 7. 候補の扱いと、伴奏の指標

### 7.1 選抜はしない。関門で落ちた候補だけ次を引く

```
for k in 0..23:
  種を6つ引く（k ごとに固定の消費量なので、pick=k なら 6·k 個読み飛ばして直接作れる）
  if pick !== undefined && k !== pick: continue
  cand = plan → realize
  fails = gates(cand)
  if fails.length: rejected[fails[0]]++; continue
  if pick === undefined && recent.includes(cand.planSignature): rejected.recent++; continue
  return cand (pick = k, compose = `accomp:${baseKey}:${k}`)
return realize(FALLBACK_PLAN)   // fb 相当。pick = -1
```

- **採点は無い。** 通った最初の候補を採る。
- 再現は `composeAccomp({ random: seededRandom(seed), baseKey, pick: k })`。
  `composeSong` では `recent` が再現性を崩していたが、候補番号を残すことでその穴を塞ぐ。
- 生成のコストは、1候補あたり約1100音。ふつうは1〜2候補で通るので、数十ms の見込み（未計測）。

### 7.2 関門（硬い制約。落ちたら次の候補へ）

| 関門 | 内容 |
|---|---|
| 長さ | 150〜180秒。小節数は4の倍数で、区間の合計と一致する |
| 旅程 | 役割の並びが固定の順。minorDwell ≥ home で、他のどの区間よりも長い |
| ① | 区間ごとの分散の毎秒音数（§6 段7） |
| ② | 隣り合う区間、同じ和声が再び出る区間の組で、質感の軸が2つ以上違う |
| ③ | 借用の長和音の直後に、完全4度上の借用和音が来ない（区間の境もまたぐ） |
| ④ | 強弱の山は borrowB だけ。lift が最弱、return < home、glimpse < 両隣 |
| ⑤ | 予告の借用和音 ⊆ borrowA ∪ borrowB。return に借用和音が無い |
| 和声との整合 | 分散・和音・色の線のすべての音が、鳴っている和音の構成音か、書かれたテンション。低音の和音外音は、P の位置と区間の境だけ |
| ぶつかり | 分散と和音トラックが同時に鳴って短2度・短9度になる箇所が0。色の線と分散も0。全トラックの組では 0.35/小節以下（fb 0.24、fa 0.20） |
| 継ぎ目 | 最終和音が Vsus4→V。分散の最終小節が home の最終小節と一致。低音の最後が導音。和音の最後の一打が付点4分 |
| 表現 | §6 段10 |

**関門は「壊れていないか」の確認で、「良いか」の判定ではない。**

### 7.3 伴奏の指標（用途は表示・検算・将来の較正に限る）

fb と fa の実測（指標案の調査。dtm の `parseMML` で測定）:

| 指標 | 定義 | fb | fa | 用途 |
|---|---|---|---|---|
| M1 分散の毎秒音数 | 区間ごと | 3.97〜4.67 | 4.20〜4.90 | 関門① |
| M2 往復率 | p[i]=p[i−2]≠p[i−1] の割合 | 家 .37／短調側 .13／借用 .01／L .19／戻り .37 | A .37／A' .01／A'' .41 | 表示 |
| M3 セルの交代率 | 4小節ブロックの境で支配的なセルが変わる割合 | .92 | .50 | 計画器が構造で保証する（検算） |
| M4 隣接区間の対比 | 質感の軸が変わった数 | 全隣接で ≥2（レビューの意図） | — | 関門② |
| M5 低音の密度 | 音数/小節 | 0.63〜5.5 | 0.5〜5.44 | 表示 |
| M7 借用和音の配置 | ③⑤と、2つの借用区間のあいだに glimpse があるか | 満たす | ③に違反（48→49 の D→G） | 関門③⑤ |
| M8 ループの閉じ | §7.2 継ぎ目 | ○ | ○ | 関門 |
| M9 音域の段差 | 区間ごとの分散上半分の平均 | L が最高（76.9） | 最後の A'' が最高（81.5） | 表示 |
| M10 強弱の山 | 区間ごとの分散の v 平均 | 山 = C2、戻り − 家 = −9.9 | 山 = 最後、+4.6 | 関門④ |
| M13 ぶつかり | 半音で16分以上重なる組の数/小節 | 0.24 | 0.20 | 関門（上限のみ） |
| M14 v の種類数 | トラック別 | 30／19／26 | 22／13／21 | 表示。往復の退行検査 |

- **fb と fa で差が出たのは M3・M7・M9・M10 と、M2 の一部だけ。** ただし比べたのは1組で、差はレビューで変えた点そのもの（fb は fa のレビューを反映した版）。**どの指標も品質の証拠ではない。**
- 所有者の評価ラベル（使う／捨てる／直す場所）が10本以上たまったら、`scripts/accomp/calibrate-accomp.ts`（段階5で作る）で、各指標が「使う」と「捨てる」を**分けるか**を問う（handover の「まず分けるかを問え」）。採点へ上げるかどうかは、その結果と所有者の判断で決める。

---

## 8. 音符ごとの v の保持（前提の修正、段階0）

### 8.1 いま起きていること（3か所）

| 場所 | コード | 何が起きるか |
|---|---|---|
| 書き出し | `mml-core.ts:453` `const header = \`t${this.tempo} v${vol}\`` | 先頭に v を1回出すだけで、音符の velocity をまったく見ない |
| DAW の読み込み | `daw.ts:5428` `velocity: DEFAULT_VELOCITY`、`:5354-5362` | 全音符を既定値に戻し、トラック音量を**最後の v** にする |
| 再生専用プレイヤー | `mml-player.ts:579` `trackPlacements[0]?.velocity` | トラック全体を**先頭の v** で平らにする。unj-reze の投稿埋め込み（`MmlPlayer.tsx` → `studio.mountPlayer`）はここを通る |

- fb.mml で往復を再現すると、4トラックとも1値に潰れる。
  - @1 は v44〜86 の30種が、すべて v50 になる。
  - @2 は19種が v80 に、@3 は26種が v35 になる。
  - 同じ MML を、DAW は最後の v、プレイヤーは先頭の v、`studio.play`（headless）は音符ごとの v で鳴らす。**読み手によって解釈が3通りに分かれている。**
- 新モードに限らない。`composeSong` のアクセント（`compose.ts:5247` の 100/82 など）や、MIDI・UST・MusicXML の取り込みの強弱も、書き出しで消えている。

### 8.2 意味の約束

- 内部の `Note.velocity` は、**トラック基準に対する相対値**（100 = トラック音量 T）とする。
- MML の `v` は、**実効値** = round(T·velocity/100) とする。
- 最終的な音量は、DAW でもプレイヤーでも (T/100)·(velocity/127) = v/127 になる。式は `midi-io.ts:572-574` と同じ。

### 8.3 関数（`src/mml/mml-velocity.ts`）

```ts
effectiveVelocity(T, vel = 100) = clamp(round(T·vel/100), 0, 127)
chordVelocity(notes) = max(notes.velocity ?? 100)       // MML の和音は v を1つしか持てない
splitTrackVelocity(vs, fallback):
  vs が空       → { volume: fallback, velocities: [] }
  T = min(100, max(vs))
  T === 0       → { volume: 0, velocities: 全部 100 }   // 割り算を避ける
  それ以外      → velocity = round(100·v/T)              // max(vs) > 100 のトラックは T=100 なので velocity = v（≤127）
```

**往復が正確な理由**: r = round(100v/T) = 100v/T + e（|e| ≤ 0.5）とおく。T·r/100 = v + T·e/100 で、T < 100 なら |T·e/100| < 0.5 になる。T = 100 なら e = 0。したがって round で必ず v に戻る。

### 8.4 変更点

1. **書き出し**（`mml-core.ts` の `generateMML`、449〜537行）
   - 先頭の `t{tempo} v{vol}` はそのまま残す。`lastV = vol` から始める。
   - 音符・和音トークンの直前で `eff = effectiveVelocity(vol, chordVelocity(notes))` を計算し、`eff !== lastV` のときだけ `v{eff}` を挟む。
   - `physicsLimit` で省いた音符では v を出さない。
   - **全音符の velocity が100（未設定を含む）の曲は、出力が1バイトも変わらない。**
2. **DAW の読み込み**（`daw.ts:5354-5362` と `:5418-5429`）
   - placements をトラックごとに束ね、`splitTrackVelocity(v の列, trackVelocity.get(i) ?? 100)` にかける。
   - `t.volume` に T を入れ、`addNote` の velocity には分けた値を渡す。
   - `applyActiveOnly` の分岐はそのまま残す。
   - コメント（5418〜5421行）を書き直す。
3. **再生専用プレイヤー**（`mml-player.ts:569-590`）
   - 同じ関数を使い、`volume: trackVolume·T/100`、音符の velocity は分けた値にする。
   - コメント（569〜578行）を書き直す。
4. **和音分解モード**（`daw.ts:4977-4995`）
   - 各音符の velocity を `effectiveVelocity(t.volume, n.velocity)` に焼き込んでから分解し、音量100で書き出す。
   - 今ある「トラック音量を無視して全部 v100 で出す」も同時に直る。
5. **MIDI 書き出し**（`midi-io.ts:572-574`）: `effectiveVelocity` に置き換える。velocity127×音量127 で 161 になっていた問題も直る。
6. **コメントの修正**（`mml-parser.ts:568-571`）: `trackVelocity` を「トラックで最後に出た v。音符の無いトラックの音量の既定値」と書き直す。
7. **任意・別コミット**: ペンで描く音符の既定 velocity を、左隣の音符の velocity にする（`daw.ts:2673-2675`）。

### 8.5 直らないもの（MML の記法上の限界。文書に残す）

- 和音は v を1つしか持てないので、構成音の最大値で代表させる。
- オクターブ重ね（`daw.ts:2154-2162` の ×0.7）は、元の音と同じ位置なので和音1つにまとまり、0.7 が消える。
- `headless-player`（`studio.play` → `playPlacements`）は、生の v を velocity として使う。音量は同じで、明るさだけが DAW と違う。これは今からある差で、そろえるかは任意とする。

### 8.6 挙動の変化（所有者に伝えること）

- **v が1つだけの旧 MML** は、v ≤ 100 なら今と同じ（音量 = v、velocity = 100）に鳴る。v > 100 のトラックだけ、音量は同じで明るさがわずかに上がる。
- **`composeSong` の強弱が初めて書き出しと投稿に乗る。** MML は長くなり、投稿の鳴り方が「DAW で聴いていた音」に変わる。
- **トラックのベロシティスライダーの意味が変わる。**
  - 相対的な強弱の上に掛かるゲインになる。
  - 読み込み直後の表示は「最後の v」から T に変わる（fb の @1 は 50 → 86）。
- **弱い音が暗く鳴る。** SoundFont の明るさは velocity に連動している（`SoundFont.ts:107-113`）。未試聴。
- **ペンの既定100** は、トラックでいちばん強い音と同じ強さになる。静かな区間に描くと浮くと推測する（未試聴）。
- **unj-reze** は、dtm を上げると次のように変わる。
  - 1トラックに複数の v を持つ既存の投稿（手書きの MML）は、埋め込みでも強弱付きで鳴る。
  - 2026-09-28 の投稿はすでに平らな MML が保存されているので戻らない。修正後の DAW に fb.space.mml を貼り直して投稿し直す必要がある。

---

## 9. DAW への組み込み

### 9.1 UI（`src/ui/daw-ui.ts`）

- compose-row（533〜535行）の「歌入り作曲」の後ろにボタンを足す。

  `<button class="dtm-btn dtm-btn--success" data-dtm="macro-compose-accomp">伴奏主体</button>`

  - title: 「旋律をほとんど置かず、分散和音・低音・和音で約2分半〜3分のループ曲を作ります（ドラムなし・残響とディレイ付き）。ベース調は使い、構成・作る部分・音階は使いません」
- refs の型（128〜141行）に `macroComposeAccomp` を、`sel()`（894〜905行）にも1行足す。
- 解説モーダル（`macro-compose-info`）に1段落を足す。次の3点を書く。
  - 短調を選ぶと平行長調を家にする。
  - 伴奏トラックで「適用」を押すと、奏法1つで上書きされる。
  - 書き出し上限が曲より短いと、末尾が切れる。
- 別ボタンにするので、構成・作る部分の UI を出し分ける必要は無い。
- `macro-state.ts` の保存キーは増やさない。ベース調の select をそのまま使う。

### 9.2 `src/ui/daw.ts` のリファクタ（`loadMML` の挙動は変えない）

1. `runCompose` の中にある `writeTrackAt`（6712行）を外に出して共有する。
2. `loadMML` のトラック設定の反映（5291〜5353行。inst・font・comp・width・rev・eq・pan・dly、書かれていない項目は既定値へ戻す）を `applyTrackStripMeta(meta, { activeOnly })` に切り出す。
3. マスタのコンプとフェードの反映（5250〜5265行）を `applyMasterDynamics({ masterCompression, fadeIn, fadeOut })` に切り出す。
4. 自動で当てた歌声を外す処理（6946〜6953行）を `releaseAutoVocals()` に切り出す。
5. `composeWithConfirm(withVocal)`（6993行）を `composeWithConfirm(title, message, run)` にする。「手を入れていなければ確認しない」（`trackSignature` の比較）は共通のまま使う。
   - `trackSignature` は、ノート数・開始位置の和・音高の和だけを見る（velocity と長さは見ない）。新モードでもそのまま使える。

### 9.3 `runComposeAccomp()`（`runCompose` の隣に置く）

```ts
const runComposeAccomp = (): void => {
  stop();
  overlayDuring(() => {
    const baseKey = refs.composeKey?.value ?? "any";
    const seed = (Math.random() * 0x100000000) >>> 0;
    const song = composeAccomp({
      stepsPerBar: renderConfig.stepsPerBar, edo: renderConfig.edo, baseKey,
      random: seededRandom(seed), recent: recentAccompSignatures,
    });
    recentAccompSignatures.push(song.planSignature);          // 歌もの用の recentComposeFingerprints とは別
    if (recentAccompSignatures.length > 5) recentAccompSignatures.shift();
    composeSeed = seed; composeSetting = song.compose;          // 書き出しで #seed / #compose=accomp:<baseKey>:<k>

    if (shouldAutoInstrument) { currentInstrument = "retro_game"; autoComposeInstrument = "retro_game";
                                options.onInstrumentChange?.("retro_game"); }

    trackStates.forEach((t, i) => {
      const at = song.tracks[i];
      writeTrackAt(i, at?.notes ?? []);                        // runCompose と同じ履歴の積み方（Undo はトラックごと）
      t.trackOctave = 0; t.trackOctaveUnison = "none";         // 前の作曲の残りを消す（残ると1オクターブずれて鳴る）
      if (at) { t.volume = at.volume; t.core.setVolume(at.volume); }
      t.composeSlot = isAdvanced && at?.notes.length ? SLOT_OF[at.slot] : null;
        // color→submelody / arp→melody / bass→bass / comp→chord。後で手動でおまかせを押しても、
        // 分散が retro_game の melody = Lead 1 (square) を引くようにする
    });
    if (!isAdvanced) {                                         // 和音欄は表示だけ。applyChord は呼ばない
      const ct = trackStates.find((t) => t.config.id === "chord");
      if (ct) ct.savedChordInput = song.chordProgression;       // 調の扱いは runCompose の simple 分岐に合わせる
    }
    applyTrackStripMeta(accompMeta(song));                     // 4本以外のトラックは既定値へ戻る
    setBpm(song.bpm);
    currentDrumPattern = NO_DRUM_PATTERN; refs.drumSelect.value = NO_DRUM_PATTERN;
    options.onDrumChange?.(NO_DRUM_PATTERN); applyDrumPatternFont(NO_DRUM_PATTERN);
    setMasterFx(song.mix.masterFx);
    applyMasterVolume(song.mix.volume);
    applyMasterDynamics({ masterCompression: 0, fadeIn: 0, fadeOut: 0 }); // 前のおまかせの fadeOut 1.5s・comp 25 を消す
    applyLoop(true);
    releaseAutoVocals();
    // applyAutoMastering() は呼ばない（§9.4）
    if (refs.composeKeyHint) refs.composeKeyHint.textContent =
      `${song.keyLabel} で作成（伴奏主体・${song.bars}小節）${song.homeFromMinor ? "・" + song.homeFromMinor : ""}`;
    if (barLimit > 0 && barLimit < song.bars) 「書き出し上限◯小節で末尾が切れます」を表示;
    playStartStep = 0;                                         // 旅程は頭から聴くもの。テーマは冒頭の home
    redrawAll(); updateTrackPanel(); updateUndoRedo();
    composedSignature = trackSignature();
    void play();                                               // 作曲したらそのまま鳴る（handover の UX）
  });
};
```

- 確認ダイアログの文言:「今あるノートをすべて消して、伴奏主体のループ曲（約2分半〜3分・ドラムなし）を新しく作ります。よろしいですか？（「元に戻す」はトラックごとに効きます）」。
- **advanced モードでも同じ index 0〜3 に書き、4〜14 は空にする。** モードによらず、同じ種から同じ MML が出る。
- simple モードの和音トラックで「適用」を押すと、奏法1つで上書きされて、区間ごとの長さが消える。**仕様として許し、解説に書く。**

### 9.4 おまかせマスタリングとの関係

**`applyAutoMastering()`（6177行）は呼ばない。** 呼ぶと、目標のミックスが丸ごと上書きされる。

| 項目 | おまかせの値 | 目標 |
|---|---|---|
| リバーブ Mix | `28 − 密度·16`、4トラックなら約23% | 50% |
| Decay | BPM から決まり、112BPM なら約2.1秒 | 3.0秒 |
| Pre Delay | 20 に固定 | 25 |
| マスタディレイ | 設定する箇所が関数内に無い | 25%・付点8分 |
| マスタコンプ | 25 に固定 | 0 |
| fadeOut | 0 なら 1.5秒にする | 0（ループ曲に不適） |
| 楽器 | `autoPreset[composeSlot ?? role]`。t1 は Lead 2 (sawtooth)、t3 は Clavinet | t1 は square、t3 は Electric Piano 2 |
| トラックの音量・パン・EQ・送り | 役割の既定値 | fb の値 |

利用者があとで手動でおまかせを押すのは自由（そのときは上書きされる）。

### 9.5 キープ・入れ替え・書き出し・投稿

- どれも既存の `generateMML → loadMML` の経路を通る。段階0の修正があるので、強弱も区間の起伏も往復で残る。
- **追加で直す箇所（段階2）**: `loadMML` の全体読み込みでは、`#mastercomp`・`#fadein`・`#fadeout` が書かれていないと前の値が残る（書き出しは0を省く）。
  - 起きること: 伴奏主体をキープ → 歌もので作曲（おまかせで fadeOut 1.5秒・comp 25）→ 入れ替え、とすると、ループ曲にフェードとコンプが残る。
  - 直し方: `setMasterFx(masterFxFromMeta(...))` と同じ規則で、書かれていなければ DAW の初期値（`options.* ?? 0`）へ戻す。
- 書き出しの先頭には次が出る。
  - `#seed=<n> #compose=accomp:<baseKey>:<k>`
  - `#inst=retro_game #volume=80 #loop=on #drum=none #reverb=50 #reverbdecay=30 #reverbpredelay=25 #delay=25 #delaydiv=8d`
  - トラック別の `#t<n>inst/eqhi/pan/rev/dly`

---

## 10. ドラム無し・残響とディレイ・ループの扱い

- **ドラム**: `pickBuiltinDrum` は呼ばず、`NO_DRUM_PATTERN`（`drum-config.ts:45`、"none"）を直接入れる。
  - `pickBuiltinDrum` は `song.melody` の統計でプールを選ぶ関数で、旋律の無いモードでは意味を持たない。
  - 固定パターンの一覧から「なし」を選ぶだけなので、handover の禁止事項（ドラムの生成器を書くこと）には触れない。
- **残響とディレイ**
  - マスタ: `setMasterFx({ reverbAmount: 50, reverbDecaySec: 3.0, reverbPreDelayMs: 25, delayAmount: 25, delayDivision: "8d" })`。
  - トラック: `applyTrackStripMeta` で送り量を当てる（rev は t0=45・t1=55・t2=10・t3=65、dly は t0=30・t1=15）。
  - 音色と効果はモード単位で固定し、区間ごとには変えない（fb も変えていない）。
  - 音源バンクの比較（`聴き比べ_展開と音源.md`、結論は出ていない）は拡張に回す。
- **ループ**
  - `applyLoop(true)` と `#loop=on`。
  - ループ長は、sequencer が「最後の音の終わり」で決める（`sequencer.ts:199-224`）。そこで、分散と低音の最後の音を曲末ちょうどで終わらせる（関門）。
  - 閉じ方の5点（§2.3）は、段2・5・6・7・8 で作り、関門で確かめる。
  - fadeIn と fadeOut は0に固定する。

---

## 11. `docs/handover-compose.md` との整合

| handover の記述 | 本設計での扱い |
|---|---|
| 統計を参考コーパスへ寄せる方針は打ち止め（:8） | 実測値は範囲の関門と表示だけに使う。採点・選抜の目標にしない（§7） |
| 指標を思いついたら、まず分けるかを問え（:40-44） | 指標は「暫定」と明記する。評価ラベルが10本たまってから、分けるかを検証する（段階5） |
| 内蔵採点は構造品質と無相関、drawCount を増やしても効かない（:584-586） | 大量に引いて選ぶ仕組みは作らない。構造は計画器が作る |
| ドラムは固定パターンから選ぶのが仕様（:552-554） | 「なし」を選ぶだけ。生成器は書かない |
| `SectionSpec` に `drumLevel` は無い（:555） | `SectionSpec` を使わず、触りもしない |
| 8小節の目隠し A/B は細かい採否に使えない（:385-389） | 使わない。曲まるごとの聞き取りにする |
| 曲まるごとの3問（:408-410） | 同じ3問で聞く。使うか捨てるか／最初に直す場所（区間・トラック・何を）／理由を一言 |
| 1日に聴ける曲数に限りがある（:651-653） | 1日3本まで（1本2分半〜3分）。陽性対照の日と生成曲の日を分ける |
| 審査エージェントに順位を付けさせない（:639-647） | 付けさせない。使うなら所有者の評価付きで「何が評価を分けているか」を問う |
| theme-a/b/c（ドラムなし・92〜100BPM・毎秒2.4〜2.5音）は不可（:609） | 新モードは110〜116BPM で、分散だけで毎秒4〜5音、全体で約8音/秒。失敗の要因は「ドラムなし」より「運動量の少なさ」と読む（推測）。**リスクとして §14 に残す** |
| retro_game は音数が多いと潰れる（:612-613） | 全体で約8音/秒（不可だった曲は毎秒15〜17.6）。fb は square で評価されているので固定のまま始める |
| 指紋がそろう（`generator-fingerprint-invariants`） | 旅程と規則①〜⑤はこのモードの不変量として固定する。区間長・句・借用の組・セル・低音型・和音の段・調・テンポ・±2 の強弱ずらしを抽選する。直近5曲の planSignature を避ける |
| 同名セクションは長さをそろえる・候補は4の倍数（`compose-section-lengths`） | 前者はこのモードでは使わない（区間は和声の場所で区切り、名前も重複しない）。4の倍数は守る |
| 作業の前に docs を見る（:571-573） | 本書を `handover-compose.md` から1行でリンクし、`scripts/README.md` にも追記する |
| 種の埋め込みと再現（:497-508） | `#seed` と `#compose=accomp:<baseKey>:<k>` で再現できる。`export-samples.ts` を振り分ける（§12.5） |

---

## 12. 検査計画

### 12.1 `scripts/test/check-mml-velocity.ts`（段階0。`pnpm test` の `check-mml-chord.ts` の後に置く。koe はスタブで外す）

1. **純関数**: T∈1..127、v∈0..127 の全組で、`effectiveVelocity(split.volume, split.velocities[i]) === vs[i]` が成り立つ。空の列、全部0、最大が100を超える場合も含む。`effectiveVelocity(127,127) === 127`。
2. **互換**: velocity が100（未設定を含む）だけの fixture で、`getMMLFromNotes` の出力が、変更前に採取した golden 文字列と完全一致する。golden は段階0の最初に採る。`check-mml-chord.ts` の既存の期待値もそのまま通る。
3. **往復**: fb の v の付け方を模した数小節をテスト内に埋め込む（tmp/ は読まない）。
   - 中身: v44〜86 の分散、v66〜102 の低音（v>100 を含む）、v25〜56 の和音、`v0` ヘッダで v34/36 の音を持つ @0、空のトラック。
   - 手順: `parseMML → splitTrackVelocity → getMMLFromNotes(notes, bpm, T) → parseMML`。
   - 見ること: 音符ごとの {開始, 音高, 長さ, v} が一致すること、トラックごとの v の種類数が保たれること、minified でも同じになること。
4. **和音**: 構成音の v が混ざっていても最大値が1つだけ出ること。`v` の後に和音トークンが続く並びを parser が読めること。
5. **プレイヤーの式**: mml-player の変換（純関数へ切り出した部分）が trackVolume/100 × v/127 と一致すること。
6. **和音分解モード**: 焼き込みの式が velocity×音量/100 を 127 で止めた値になること。
7. **midi-io**: 値が127を超えないこと。
8. **任意**: `--file tmp/full/fb.space.mml` を付けると実物で往復し、v の種類数 30／19／26 が保たれることを表示する（ファイルが無ければ飛ばしたと表示する）。

DAW と mml-player は Node で読めない。そこで分割のロジックは必ず `mml-velocity.ts` に置き、呼び出し側は1行にとどめる。

### 12.2 `scripts/test/check-compose-accomp.ts`（段階1。`check-compose.ts` の後に置く）

koe のスタブを入れる**前**に `compose-accomp` を require する。これで koe に依存していないことを確かめる。そのあとでスタブを入れて、`mml-parser` と `compose-accomp-mml` を読む。

| 項目 | 内容 |
|---|---|
| 種 | 12平均律で40種（20260929〜）、31平均律で5種。key_E・短調・mood_* の指定でも数本ずつ |
| 決定性 | 同じ種で JSON が完全一致する。`pick: k` で作り直した曲も一致する。`overrides.lengths` を変えても、調・テンポ・借用の組は変わらない |
| 関門 | 採った曲が §7.2 の全関門を満たす。`pick === -1`（保険の計画）の割合を表示する |
| 表の健全性 | 表にあるすべての和音が `romanToC` と `parseChord` を通る。`BORROW_PAIRS` の全組が③を満たす。全セルの合計が16で、番号が0〜4に収まる |
| 和声との整合・ぶつかり | §7.2 |
| 正規化 | 各トラックの velocity の最大がちょうど100（T ≤ 100 の場合）。volume ≤ 100 |
| ミックス | `accompMeta` が drum=none・loop・reverb 50・decay 30・predelay 25・delay 25・8d・各トラックの inst/pan/eqhi/rev/dly・mastercomp/fade=0 を返す |
| MML 往復 | `parseMML(accompToMml(song))` の placements が、絶対値の v まで `song.tracks` と一致する。メタも一致する。v の修正と MMLCore の制約を同時に確かめる |
| 31平均律 | すべての音高が31の格子の上にある。借用和音（A♭≠G#）と導音の綴りが正しい |
| 曲ごとの違い | 40曲の planSignature の種類数と、区間長・借用の組・セル割り当ての分布を表示する（下限だけ assert） |

### 12.3 陽性対照と切除対照（同じスクリプト内）

- **陽性対照**: `scripts/test/fixtures/accomp-fb-plan.ts` は、fb を `AccompPlan` として手で書き直したもの（ホ長調 rootShift 4、112BPM）。
  - `overrides.plan` で realize し、指標が fb の実測値に許容幅で一致することを確かめる。
    - 分散の毎秒音数 ±0.2
    - 上半分の平均 ±1.5
    - 低音の音数/小節 ±0.5
    - 往復率 ±0.08
    - 山の区間は同じ
  - 和音配置が fb の辞書 `V` と一致する割合を表示する（合わなくても失敗にはしない）。
  - fb の計画がすべての関門を通ること。**これが保険の計画（`FALLBACK_PLAN`）を兼ねる。**
- **切除対照**: fb の計画を1点ずつ壊して、狙った関門だけが落ちることを確かめる（関門そのものの検算）。

| 壊し方 | 落ちるべき関門 |
|---|---|
| 強弱を平らにする | ④ |
| 山を return に移す | ④ |
| glimpse を抜いて借用区間を隣接させる | ③ |
| borrowB の頭を ♭VII の直後の ♭III にする | ③ |
| return に予告の句を入れる | ⑤ |
| 隣り合う区間の質感をそろえる | ② |
| 最後を I で終える | 継ぎ目 |
| 分散を1小節4音のセルにする | ① |

### 12.4 既存テスト

- `check-compose`・`check-mml-meta`・`check-mml-chord`・`check-strip-defaults` などが全部通ること。特に `check-strip-defaults` で、`applyTrackStripMeta` を切り出しても振る舞いが変わらないことを見る。
- `biome check src` と tsc も通すこと。

### 12.5 スクリプトの修正と試聴用スクリプト

- **`scripts/accomp/accomp-audition.ts`**（試聴用。テストには入れない）
  - 使い方: `npx tsx scripts/accomp/accomp-audition.ts --count 3 --seed 20260929 --key major --out tmp/accomp`
  - 再現: `--app-seed <n> --compose accomp:<baseKey>:<k>` でアプリの出力を再現する。
  - 陽性対照: `--fb-plan` で fb の計画を realize する。
  - 出力:
    - .mml（FX 宣言・音符ごとの v・`#seed`・`#compose` 込み。DAW の full 書き出しと同じ `;\n` 区切り）
    - `_summary.md`（区間表・和声・質感・基準 v・秒数・関門の値）
    - `_questions.md`（3問）
  - **公開中の github.io の embed は段階0より前のビルド**なので、強弱が平らになって試聴にならない。ローカルの `pnpm dev`（`demo/`）に貼って聴いてもらうこと。
- **`scripts/compose/export-samples.ts:75-91`**
  - `#compose` が `accomp:` で始まるときは、`composeAccomp` と `accompToMml` へ振り分ける。
  - 未知のテンプレート名はエラーにする。今は既定構成の歌もの曲が黙って出る（`compose-sections.ts:384-386`）。
- **`scripts/compose/compose-lab.ts:38`** のコメントを直す。直した文:「線形合同法。アプリの `seededRandom`（mulberry32）とは別物なので `#seed` は再現できない。再現は `export-samples.ts --app-seed` で行う」。

### 12.6 手動の確認（段階2。`pnpm dev` の demo）

- 「伴奏主体」を押すと、1小節目から鳴ること。あわせて次を確かめる。
  - リバーブ 50%・3.0s・25ms、ディレイ 25%・8d
  - マスタコンプ 0、フェード 0
  - ドラム「なし」、ループ ON
  - トラックの楽器が square／square／Synth Bass 1／EP2 で、pan・EQ・送り量が fb と同じ
  - トラックのオクターブが 0
- advanced で作曲した直後に押しても、t1 が1オクターブずれないこと。
- 次の往復で、`getMML().full` が文字列として一致し、コンソールで `parseMML` した v の種類数が減っていないこと。
  - 伴奏主体 → キープ → 歌もので「作曲」→ 入れ替え → 入れ替え
- 入れ替えで戻したとき、fade とコンプが残っていないこと。
- 31平均律で押しても鳴ること。
- 歌もの側の「作曲」「歌入り作曲」の確認文言と、再生位置（サビ頭）が今のままであること。
- unj-reze のローカル環境（dev、mock DB）で投稿し、MmlPlayer の埋め込みで音符ごとの v が効くこと。確かめ方は、GainNode・AudioBufferSourceNode にフックして集計する。検証用ブラウザでは rAF が発火しない癖があるので注意。

### 12.7 耳による確認（採点ではなく、仕様の聞き取り）

- **1日目: 陽性対照2本だけを聴いてもらう。** fb の原曲と、fb の計画を realize したもの。問いは「同じ種類の曲か／別物になった所はどこか」。
- **2日目以降: 生成曲3本（1日3本まで）を聴いてもらう。** 問いは handover と同じ3問（使うか捨てるか・最初に直す場所・理由を一言）。
- 回答は `docs/accomp-reviews.md` に記録し、挙がった「直す場所」を表のどの行かに対応づける。
- 目隠しの A/B や順位付けはしない。

---

## 13. 実装の段階

| 段階 | 内容 | できること・聴けるもの | 規模の目安 |
|---|---|---|---|
| **0** v の保持の修正（単独で publish できる） | golden の採取 → `mml-velocity.ts`・`mml-core.ts`・`daw.ts`（読み込み2か所と和音分解）・`mml-player.ts`・`midi-io.ts`・コメント → `check-mml-velocity.ts` を `pnpm test` へ | fb.space.mml を DAW に貼り、キープ・入れ替え・書き出しをしても強弱（30／19／26種）が残る。reze の依存を上げれば、投稿の埋め込みでも強弱が鳴る。**所有者の作業**: commit → publish → reze の依存を上げる → fb を投稿し直す | src 約120行、テスト 約200行、半日〜1日 |
| **1** 生成器の本体と陽性対照（DAW は触らない） | `compose-accomp-tables.ts` → `-plan.ts` → `-realize.ts`（和音 → 低音 → 分散 → 色 → 強弱 → 継ぎ目の順）→ `-check.ts` → `compose-accomp.ts` → `-mml.ts`、fixture、`check-compose-accomp.ts`、`accomp-audition.ts`、確定した表の由来を本書の付録 A へ追記 | `accomp-audition.ts` で .mml を書き出し、ローカルの demo に貼って聴ける。**1日目は陽性対照2本、2日目以降は生成曲3本。** 結論が「捨てる」ばかりで直す場所も挙がらないなら、段階2へ進む前に表と計画器を見直す（DAW の配線を無駄にしない） | src 約1,700行、scripts 約750行、2〜3日 |
| **2** DAW への組み込み | `daw-ui.ts` のボタン・refs・解説、`daw.ts` の切り出し4つ・`composeWithConfirm` の一般化・`runComposeAccomp`・`loadMML` の fade とコンプの既定値戻し、`index.ts` の export | DAW の「伴奏主体」を押すとそのまま鳴る。キープと入れ替えで2曲を行き来でき、書き出しと共有も強弱込みで往復する | 約300行、半日〜1日と手動確認 |
| **3** 仕上げと公開 | `export-samples.ts` の振り分け、`compose-lab.ts` のコメント、`handover-compose.md` と `scripts/README.md` への追記・リンク。**所有者の作業**: version → publish → reze の `@onjmin/dtm` を上げる。reze の `.claude/notes.md` に追記する | unj-reze の MML エディタからも伴奏主体モードが使える（reze のコード変更は無い） | 約50行と文書、0.25日 |
| **4** 耳による表の調整（継続） | 聞き取りの「直す場所」を表の行に対応づけて直す。`overrides` で一変数ずつ変えた版と比べる。関門と表の健全性の検査は常に通す | 1日1〜3本 | — |
| **5** 以降の拡張（聞き取りの結果で選ぶ） | `calibrate-accomp.ts`（ラベル10本以上）／借用の組と句の行を増やす／区間だけの引き直し（段ごとの乱数を使う）／fa 型など別の旅程／山の区間の抽選／音源バンクの比較（`#t<n>font`）／家を短調にする版／ペンが直前の velocity を引き継ぐ／headless の velocity の解釈をそろえる／`chords.ts:177` の丸め（別コミット） | — | — |

順番の理由は2つ。

- 段階0が無いと、キープ・書き出し・投稿で区間の強弱が消え、新モードの評価が成り立たない。
- 段階1を段階2より先に置くのは、UI を作る前に、方式そのものを耳で続けるかどうか確かめるため。

---

## 14. 未決事項（所有者の判断が要るもの）

1. **固定と抽選の線引き。** 旅程の型と規則①〜⑤を固定し、長さ・句・借用の組・セル・低音型・和音の段・調・テンポを抽選する。これでよいか。どの曲も「fb の変奏」に聞こえる可能性があり、逆に幅を広げすぎると fb の良さ（②③④）が崩れる。
2. **home が backing に寄りすぎる。** v1 の表は fb・fa・backing からしか起こさないので、冒頭の12小節は backing とほぼ同じ進行になる（セルと強弱は変わる）。これを許すか。行を増やすのは段階4とする。
3. **短調を選んだとき。** 平行長調を家にして、選んだ短調の側に長く留まる案でよいか。短調は選べないようにする案もある。
4. **@0 の色の線。** v1 に入れるか（既定は on で4〜6音）。
5. **v の修正を先に単独で publish してよいか。** §8.6 の挙動の変化を伴う。アクセントが鳴る、スライダーの表示が変わる、弱い音が暗くなる、MML が長くなる。
6. **ペンの既定 velocity**（直前の音を引き継ぐ）を入れるか。入れるなら別コミットにする。
7. **山の区間。** v1 は borrowB に固定する。抽選にするか。
8. **失敗の再来の可能性。** ドラムなし（theme-a/b/c）の不可の要因が「運動量」だったという読みは推測にすぎない。陽性対照（段階1の1日目）で確かめる。
9. **未確認の技術事項**
   - unj-reze の uploader に、MML テキストのサイズ上限があるか。fb は約15KB で、強弱を書き出すとさらに長くなる。
   - `runCompose` の simple 分岐で、和音欄に入れる進行の調をどう扱っているか（実装時に合わせる）。

---

## 付録 A: 表の初期値（fb・fa・backing から起こしたもの。段階1で確定する）

和音はローマ数字で書く。大文字は長、小文字は短。`b` はフラット、`/数字` は低音の音階度数。

| 表 | 行 | 出どころ |
|---|---|---|
| `HOME_OPEN` | `Iadd9\|IVM7\|iii7 vi7\|ii7 V` | backing・fb A 1〜4 |
| | `Iadd9\|IVM7\|Iadd9\|IVM7` | fa A' 17〜20 |
| `HOME_MID` | `IM7\|vi7\|IVM7 iii7\|ii7 Vsus4` | fb A 5〜8 |
| | `vi7\|iii7\|IVM7 V\|vi7` | fb A 9〜12 |
| | `iii7\|vi7\|ii7\|Vsus4 V` | fa A' 21〜24 |
| | `IM7\|IVM7\|iii7\|vi7` | fa A' 25〜28 |
| `MINOR_OPEN` | `vi7\|vi7\|iii7\|iii7` | fb B 17〜20 |
| `MINOR_MID` | `ii7\|ii7\|vi7\|vi7` | fb B 21〜24 |
| | `IVM7\|iii7\|ii7\|iii7` | fb B 25〜28 |
| | `vi7\|vi(add9)\|IVM7\|IVM7(#11)` | fb B 29〜32 |
| | `vi7\|vi7/7\|ii7/4\|iii7` | fa B 33〜36 |
| `MINOR_CLIMB` | `ii7\|iii7\|IVM7\|Vsus4 V` | fb B 33〜36 |
| `BORROW_PAIRS` P1 | 予告 `bVIM7\|bVIIadd9\|bIIIM7 iv7\|Vsus4 V`。A8 `bVIM7 bVIM7(#11) bVIIadd9 bVIIadd9 bVIM7 bVIM7(#11) bVIIadd9 bVII`。B8 `bIIIM7 bIIIM7 iv7 iv7 bIIIM7 i7 iv7 iv6`。glimpseEnd `ii7` | fb A 13〜16・C1・C2・R |
| `BORROW_PAIRS` P2 | P1 の A と B を入れ替える。予告 `bIIIM7\|iv7\|bVIM7 bVIIadd9\|Vsus4 V`。glimpseEnd `V` | 新規（③の検査を通すこと） |
| `LIFT` | `IM7\|IVM7\|IM7/3\|IVM7(9)` と `vi7\|IVM7\|ii7\|Vsus4` | fb L |
| `RETURN_END` | `vi7\|iii7\|IVM7\|Vsus4 V` | fb A' 73〜76 |

12小節版の借用区間（A12・B12）は、8小節版の後ろに4小節を足した形で段階1に起こす。

分散のセル（リズムは16分の数。音の番号は段階1で、陽性対照が合うように割り当てる）:

| id | リズム（前半 \| 後半） | 1小節の音数 | 族・向き | 出どころ |
|---|---|---|---|---|
| ret_a | 2 1 1 2 2 \| 2 1 1 2 2 | 10 | 往復 | fb A 1〜4 |
| leap_a | 3 1 2 1 1 \| 3 1 2 1 1 | 10 | 跳躍 | fb A 5〜8 |
| ret_b | 2 1 1 2 1 1 \| 2 2 2 2 | 10 | 往復 | fb A 9〜12 |
| fore_up | 2 2 2 1 1 \| 2 2 2 1 1 | 10 | 上がる | fb A 13〜16 |
| dw_a | 2 2 1 1 2 \| 2 2 1 1 2 | 10 | 低く揺れる | fb B 17〜20 |
| roll | 3 1 1 1 2 \| 3 1 1 1 2 | 10 | 転がる | fb B 21〜24 |
| dw_walk | 2 1 1 2 2 \| 2 2 2 2 | 9 | 歩く | fb B 25〜28 |
| sparse | 3 1 2 2 \| 3 1 2 2 | 8 | まばら | fb B 29〜32 |
| rising | 2 2 2 1 1 \| 2 2 2 1 1 | 10 | 上がる | fb B 33〜36 |
| desc_a | 2 2 2 2 \| 2 1 1 2 2 | 9 | 下る | fb C1 37〜40 |
| desc_b | 2 2 2 1 1 \| 2 2 2 1 1 | 10 | 下る | fb C1 41〜44 |
| flutter | 1 1 2 2 2 \| 1 1 2 2 2 | 10 | 上る（はためき） | fb C2 49〜52 |
| asc_walk | 2 2 1 1 2 \| 2 2 2 2 | 9 | 上る | fb C2 53〜56 |
| pendulum | 2×8 | 8 | 振り子 | fb L 57〜60 |
| lift_desc | 2 2 2 2 \| 2 1 1 2 2 | 9 | 頭から降りる | fb L 61〜64 |
| k_a1a・k_a1b・k_b1・k_b2・k_c1・k_c2・k_d | gen-kifuku.mjs の `T_A1a` ほか（番号付きで書かれている） | 8〜11 | — | fa（候補。①を満たすものだけ採る） |

---

## 付録 B: 参照したコード位置（2.1.29）

| 場所 | 中身 |
|---|---|
| `src/compose/compose.ts:1247` | `ComposedNote` |
| `src/compose/compose.ts:1410-1419` | `seededRandom`（mulberry32） |
| `src/compose/compose.ts:5267-5270` | ハ長調で作って rootShift でずらす規約 |
| `src/compose/compose.ts:5493-5498` | 旋律の必須化 |
| `src/compose/compose.ts:5613-5628` | `pickBuiltinDrum` |
| `src/chord/chords.ts:57` | `semitonesToUnits` |
| `src/chord/chords.ts:100` | `spelledToUnits` |
| `src/chord/chords.ts:113-140` | 分散の R-3-5-8 |
| `src/chord/chords.ts:177` | `Math.floor` の潜在バグ |
| `src/compose/compose-keys.ts:346` | `resolveComposeKey`（短調は Am 基準、長調は C 基準） |
| `src/mml/mml-core.ts:449-537` | `generateMML` |
| `src/mml/mml-player.ts:569-590` | プレイヤーでの v の平坦化 |
| `src/mml/mml-parser.ts:205` | `#compose` の値 `[\w:.-]+` |
| `src/mml/mml-parser.ts:447-452` | 0 の mastercomp・fade を省く書き出し |
| `src/mml/mml-parser.ts:568-571` | `trackVelocity` のコメント |
| `src/ui/daw.ts:1530` | `applyLoop` |
| `src/ui/daw.ts:1608` | `setMasterFx` |
| `src/ui/daw.ts:1629-1631` | コンプとフェードの初期値 |
| `src/ui/daw.ts:2154-2162` | オクターブ重ね |
| `src/ui/daw.ts:4977-4995` | 和音分解 |
| `src/ui/daw.ts:5206-5290` | `loadMML` のメタ反映 |
| `src/ui/daw.ts:5291-5353` | トラック設定の反映 |
| `src/ui/daw.ts:5354-5362` | 最後の v をトラック音量にする処理 |
| `src/ui/daw.ts:5418-5429` | velocity を既定値に戻す処理 |
| `src/ui/daw.ts:6177` | `applyAutoMastering` |
| `src/ui/daw.ts:6658` | `trackSignature` |
| `src/ui/daw.ts:6674` | `runCompose` |
| `src/ui/daw.ts:6712` | `writeTrackAt` |
| `src/ui/daw.ts:6946-6953` | 歌声を外す処理 |
| `src/ui/daw.ts:6993` | `composeWithConfirm` |
| `src/ui/daw-ui.ts:128-141` | refs の型 |
| `src/ui/daw-ui.ts:533-535` | compose-row |
| `src/ui/daw-ui.ts:894-905` | `sel()` |
| `src/instruments/drum-config.ts:45` | `NO_DRUM_PATTERN` |
| `src/instruments/instrument-presets.ts:227-240` | `retro_game` |
| `src/compose/advanced-layers.ts:4-8` | Node から読める形にしている理由 |
| `scripts/compose/export-samples.ts:75-91` | `#compose` の解析 |
| `scripts/compose/compose-lab.ts:38` | 誤ったコメント |

---

## 付録 C: 段階1-B（実現器 `src/compose/compose-accomp-realize.ts`）で設計からずらした点

2026-09-28。どれも陽性対照（fb の計画を realize した結果）を fb.mml の実測に合わせるためのもの。値は表
（`compose-accomp-tables.ts`）にあり、聴いて直すときは表の1行を触る。

| 箇所 | 設計書 | 実装 | 理由 |
|---|---|---|---|
| 分散の窓（段7） | s0・s4 は窓の中 | 窓の外を `ARP_SET.widenMax`（6半音）まで許し、外へ出た距離を費用に足す。天辺は上へ出るのを重く（1.5）、下へ出るのを軽く（0.5）、支えは下へ出るのを重く（1）、上へ出るのを軽く（0.5） | 窓は天辺の幅が2〜4半音しかなく、調と和音によっては構成音が無い（ハ長調の V は E5〜F#5 に音が無い）。fb 自身も家の天辺が B4〜D#5 に来る小節が多い |
| s0（段7） | 根音か5度。無ければ3度 | 3度も常に候補に入れ、費用を1足す | M7 の和音は和音トラックの7度が根音を塞ぐ（関門「分散と和音のぶつかり0」）。fb C1 の「3度から上の組」を作れるようにする |
| 組の音程（段7） | 全音は s4 がテンションの s3→s4 だけ | sus4 の4度→5度も許す | 三和音の sus4 は5音の組が2オクターブ近くに広がる。fb L 64 の Bsus4 は E5・F#5 を並べている |
| 前の組との距離（段7） | 前の組 | 区間の頭で忘れる | 区間ごとに窓が違う。minorDwell の低い支えへ引っぱられて、C1 の組が下へ寄っていた |
| 和音の置き方（段4） | 窓の中 | 窓の中で組めない和音だけ、窓の外を7半音まで許す（外へ出た距離×5） | `vi(add9)`・`M7(#11)` は隣の声部と半音にならない並びが幅11半音の1つだけで、13半音の窓に入らない調がある |
| 和音の打ち方（段5） | final は最終小節 | home の最終小節（`Vsus4 V`）も final | fb の A16 がそう。home の終わりと曲末が同じ形になる |
| 低音（段6） | pulse8 の最終小節は2分に緩める、dropout は交互 | 表の低音型に `last`（区間の最終小節で使う型）を足し、`pulse8End`（`R:8 N:8`、N は次の根音へ全音か半音で寄せる構成音）と `dropoutEnd`（`R:8 r:8`）を置いた | fb の C2 56（Am6 の A→F#→E）と L 64（`b1:2 r:2`）。L の音数が 0.63/小節で fb と一致する |
| 低音の半音渡しの「ぶつかる」 | 和音と短2度でぶつかるなら5度に戻す | 和音のどれかの音が、渡しの音の**半音上**にあるとき（上の声部との短2度・短9度になる向き） | fb の D→D#→E（D の和音の上で D#）を一般化するため。逆向き（和音の音が半音下）まで数えると fb の渡しが消える |
| 色の線の最終小節（段8） | 天辺より2半音以上下 | 最終小節には求めない。4度を C5（ハ長調の座標）に近い高さから試す。4度→3度は**必ず2拍ずつ置く**（閉じ方⑤。関門「継ぎ目」が求める。付録 D）。`COLOR_LINE.range` の中に置ける高さが無いときだけ、上下へ `finalWiden`（12半音）広げて探す | fb は E5→D#5 を天辺の高さで鳴らしている。設計書の例「C5→B4」もその高さ。広げるのは保険で、下の240曲では一度も使っていない（調によっては range の中の4度が1つしか無い） |
| 色の線を切る（段8） | 分散が途中で天辺を弾くなら手前で切る | 分散と半音（短2度・短9度）でぶつかるときだけ、その手前で切る。切って2拍（`COLOR_LINE.minLen16`）に満たない高さには置かず、別のオクターブを試す | fb の50小節の「解消」は F#5 と分散の G5 の短2度（gen-fb.mjs のコメント）で、天辺だから切ったのではない。fb の51小節は、2拍目に天辺の G5 が来ても E5 を3拍伸ばしている。字面どおり天辺で切ると2拍の下限と両立せず、borrowB の @0 がほぼ消える（240曲で 770音→53音） |
| 分散との同音（段8） | 同じ拍で分散と同じ音を弾かない | 置けない理由にも、切る理由にもしない | fb は @0 の6音すべてで、鳴っている間に分散が同じ音を弾いている（50・54小節は鳴り出しも同時）。この条件を残すと、陽性対照の54小節の D5 が消え、借用の組 P2 の ♭VI の小節には184小節中30小節にしか置けない |

**陽性対照の結果**（区間ごと。括弧が fb）: 分散の毎秒音数と低音の音数/小節・和音の打つ回数/小節・分散の v の平均は
一致。上半分の平均は home 74.0（73.7）・minorDwell 69.4（68.9）・borrowA 73.7（74.7）・glimpse 72.7（73.7）・
borrowB 75.8（74.5）・lift 78.1（76.9）・return 73.6（73.3）。往復率は ±0.05 以内。ぶつかりは 0/小節（fb 0.24、
全部が分散と和音）。和音の置き方は fb の辞書と 71/75 が一致。

**色の線の修正（2026-09-28、レビュー指摘）**: 初版は「分散とぶつかるか同じ音が来たら切る」「4分（1拍）まで
短くなっても置く」だったので、§6 段8 の「2〜3拍」から外れていた（長調・短調・key_E・any × 種60、240曲の実測で、
borrowB の @0 501音のうち 1拍 197・1.5拍 178・2〜3拍 126。最終小節が2拍＋2拍の曲は 117/240、欠けが6）。
上の2行（「切る」「同音」）に直した後は、同じ240曲で borrowB の @0 は770音すべてが2〜3拍（2拍 474・3拍 296）、
最終小節は240曲すべてが2拍＋2拍、保険の計画は0。陽性対照の @0 は fb と小節・位置・長さ・v がすべて一致し、
高さは 5/6 が一致する（50小節のオクターブだけ違う。付録 D）。

**残っていること**: 借用の組 P2 は borrowB が ♭VI・♭VII なので、色の音（`COLOR_LINE.tones`）を持つのは ♭VI の
2小節だけで、@0 は ♭VI の2音＋最終小節の2音の4音になる（240曲の実測で P2 は 92/92 が4音、P1 は 142 曲が6音・6曲が5音）。
fb が C1 の ♭VI・♭VII に @0 を置かなかった理由と同じなので、表には ♭VII の色の音を足していない。

---

## 付録 D: 段階1-C（関門・入口・書き出し・検査・試聴）で設計からずらした点

2026-09-28。ファイルは `src/compose/compose-accomp-check.ts`（関門と指標）・`src/compose/compose-accomp.ts`（`composeAccomp`・
`accompMeta`）・`src/compose/compose-accomp-mml.ts`（`accompToMml`）・`scripts/accomp/accomp-audition.ts`、と
`scripts/test/check-compose-accomp.ts`・`scripts/compose/export-samples.ts`・`scripts/compose/compose-lab.ts`（コメント）・`src/index.ts` の変更。
§14 の未決事項は、1〜7 を所有者の方針どおりの既定（旅程と規則①〜⑤は固定・home が backing に寄るのは許す・
短調は平行長調を家に・@0 は on・v の修正は単独で publish できる形・ペンの既定 velocity は入れない・山は borrowB 固定）で進めた。

| 箇所 | 設計書 | 実装 | 理由 |
|---|---|---|---|
| `#loop=on`（§9.5・§12.5） | DAW の full 書き出しと同じ形 | `accompToMml` は `#loop=on` を**先頭の単独の行**に書き、宣言の行からは外す。ほかは DAW と同じ（`;\n` 区切り・`#end;`） | 再生専用プレイヤー（`mml-player.ts` の `parseLoopMeta`。unj-reze の投稿の埋め込みが通る）は、行の頭から行末までが `#loop=on` の行しかループと読まない。宣言の行の途中に置くと、DAW は読むが埋め込みではループしない |
| `overrides.plan`（§5） | 計画を丸ごと与える | 調とテンポは計画のもの、`lengths`・`bpm`・`pick`・`recent` は使わない。**関門で落ちても返し**、落ちた関門を `draws.rejected` に数える。`pick` は −1、`compose` は `accomp:<baseKey>:plan` | 陽性対照・一変数の A/B のための口で、壊した計画も鳴らせる方が役に立つ。`plan` は「種からは再現できない」の印（`export-samples.ts` はこれをエラーにする） |
| `pick`（§7.1） | 候補番号を固定 | −1〜23 の整数。−1 は保険の計画を直接作る。範囲外は例外。指定した候補が関門で落ちたら（ループを抜けて）保険の計画 | `#compose=accomp:<baseKey>:-1`（保険の計画）も再現できるように |
| 保険の計画（§7.1） | `realize(FALLBACK_PLAN)` | `fbPlan(調, テンポ)` を決まった乱数列（`realizeAccomp` の既定）で鳴らす。`overrides.lengths` は使わない。万一関門で落ちたら `draws.rejected["fallback:<関門>"]` に数える（検算では全調・全テンポで通る） | 保険の計画は (seed, k) に依らず同じ音にする |
| `baseKey`（§5） | "any" は "major" として扱う | 空・未指定は "any"。`#compose` の2項目めには**与えた値のまま**書く（"any" を "major" に書き換えない）。`[\w.-]+` に収まらない値は例外 | DAW の select の値をそのまま残す。`#compose` は `[\w:.-]+` で読まれ、`:` は区切り |
| `draws.rejected`（§7.1） | `rejected[fails[0]]++` | 関門は §7.2 の表の順（`ACCOMP_GATE_ORDER`）に並べてから先頭を数える | 同じ候補でどの関門を代表にするかを、検査の実行順ではなく表の順で決める |
| 関門「ぶつかり」の上限 | 0.35/小節 | 表に `CLASH_PER_BAR_MAX` として置いた | 数値は表に置く約束（付録 C と同じ） |
| `AccompStats`（§5） | 型だけ | `compMeanLen` は 16分の数。`arpIntervalHist` は隣り合う分散の音程（半音の絶対値）の割合で、0〜2 step・3〜4 3rd・5〜6 4th・7〜11 5th・12〜 8ve+。`compVoicingMatchesFb` は `composeAccomp` では入れない（fb の辞書は `scripts/fixtures` にあるので、検査の側が数えて表示する） | 型のキーだけでは区切りが決まらないので、ここで決めた |
| `accompMeta`（§5） | マスタ FX をメタへ | `master-fx.ts` の `masterFxToMeta` を import せず、同じ変換（Decay を 0.1 秒単位へ）を書いた。一致は検査が確かめる | §4.2 の import の制約（許された依存に master-fx が無い） |
| 実現器（段9） | — | `accompTracksFromNotes`（音から正規化した4トラックを作る）を切り出して export した。`realizeAccomp` の結果は変わらない | 切除対照（音を1つ書き換えてからトラックを作り直す）で使う |
| 切除対照（§12.3） | 計画の段の8項目 | 音を置いた後の7項目を足した（分散の v を平らに → ④、minorDwell を4分の音だけに → ①、綴りを変える → 和声、半音上げる → 和声（ぶつかりを伴ってよい）、和音の7度と半音でぶつける → ぶつかり、低音の最後を5度に → 継ぎ目、音を重ねる → 表現） | `accompGates` の音の側の関門そのものを検算するため |
| `export-samples.ts`（§12.5） | `accomp:` を振り分ける | .mid ではなく .mml を書く（強弱・ミックス込みで DAW に貼れる）。`--edo 31` を足した（`#compose` は音律を持たない）。未知のテンプレート名は `--template` と `--compose` の1項目めの両方でエラー | 伴奏主体モードは MML の宣言（FX・パン・送り）込みで聴くもの |
| `accomp-audition.ts`（§12.5） | `--count`・`--fb-plan`・`--app-seed --compose` | `--fb-plan` は `--count` と一緒に使える（1回で陽性対照と生成曲を同じ `_summary.md` に書く。`--count 0 --fb-plan` で陽性対照だけ）。`--key`（既定 any）・`--edo 31`・`--no-color` を足した。陽性対照の区間表には fb の実測を括弧で並べる | 1日目（陽性対照）と2日目以降（生成曲）の資料を1回で作る |
| §14-9 和音欄の調 | 実装時に合わせる | `chordProgression` はハ長調で書き、調は `rootShift` で表す（`planChordProgression`）。`runCompose` の simple 分岐（`savedChordInput = song.chordProgression`・`savedChordRoot = song.rootShift`）と同じ形なので、段階2でもそのまま渡せる | — |
| 関門「継ぎ目」の @0（§2.3 閉じ方⑤・§10） | 5点は段2・5・6・7・8 で作り、関門で確かめる | `AccompRealized.colorLine`（実現で色の線を置いたか）が true なら、最終小節に4度→3度が 0+8・8+8（2拍ずつ）で必ずあること。false なら最終小節に @0 が無いこと（2026-09-28、レビュー指摘で修正） | 初版は「最終小節に @0 を置いたなら形を見る」だけだったので、置けなかった曲が関門を通っていた（240曲中6曲。変ニ長調で、range の中の4度の候補が1つしか無く、3度が分散と同音で落ちた。例 `seededRandom(20260946)`・`(20260954)`）。色の線の有無を関門の引数でなく実現の結果に持たせたのは、呼び出し側が渡し忘れて食い違うのを防ぐため |

**検算の結果**: `scripts/test/check-compose-accomp.ts` は 159 項目（色の線の修正で6項目を足した: 陽性対照の @0 が fb と
小節・位置・長さ・v・音名で一致／高さ 5/6 一致／`colorLine: false` の実現も関門を通る／切除対照「最終小節の @0 を消す」
「3度を1拍に縮める」→ 継ぎ目だけ／生成曲57曲の最終小節 2拍＋2拍・borrowB の音価・1曲の音数）。種ごと（12平均律 40・31平均律 5・key_E・minor・key_Em・
mood_*・any の計57曲）で採った候補はすべて k=0（保険の計画 0/57）、1曲あたり約10ms。採った曲を (seed, k) から作り直すと
同じトラックで、関門を全部通る。MML の往復は、11曲（31平均律・fb の計画・色の線なしを含む）の full と minify の両方で、
音符・長さ・音高・絶対値の v・v の種類数・宣言が一致する。保険の計画は長調12調×テンポ4種（12平均律）と31平均律4調で
関門を通る。

**残っていること**
- DAW の full 書き出しは `#loop=on` を宣言の行の途中に書くので、DAW から書き出した（キープ・共有・投稿した）ループ曲は、
  再生専用プレイヤー（投稿の埋め込み）ではループしない（`parseLoopMeta` の正規表現）。伴奏主体モードに限らない既存の差。
  段階2で DAW から投稿する経路を作る前に、プレイヤーを `parseMmlMeta` の `loop` で読むよう直すか、書き出しを単独の行に
  そろえるかを決める。→ **段階2でプレイヤー側を直した**（付録 E）。
- 陽性対照の @0 は、fb の 50小節の F#5 が F#4 になる（付録 C の「天辺より2半音以上下」の規則。fb 自身はこの規則を
  破っている）。1日目の聞き取りで「別物になった所」に挙がるかを見る。
- `handover-compose.md` から本書への1行のリンクは段階3。

---

## 付録 E: 段階2（DAW への組み込み）で設計からずらした点

2026-09-28。変更したファイルは `src/ui/daw.ts`（`applyTrackStripMeta`・`applyMasterDynamics`・`writeTrackAt` の共有・
`releaseAutoVocals`・`composeWithConfirm(title, message, run)`・`runComposeAccomp`・解説）、`src/ui/daw-ui.ts`（ボタン・refs）、
`src/audio/master-fx.ts`（`masterDynamicsFromMeta`）、`src/mml/mml-player.ts`（ループ）、`scripts/test/check-fx-font-drum.ts`（検算）。

| 箇所 | 設計書 | 実装 | 理由 |
|---|---|---|---|
| `applyMasterDynamics`（§9.2） | `{ masterCompression, fadeIn, fadeOut }` | `MasterDynamics`（`masterCompression`・`fadeInSec`・`fadeOutSec`。フェードは秒）。`loadMML` は純関数 `masterDynamicsFromMeta(meta, DAW の初期値)`（`master-fx.ts`）を通す | `masterFxFromMeta` と同じ形にして Node で検算するため（`check-fx-font-drum.ts`）。単位は DAW のスライダーの値 |
| `applyTrackStripMeta`（§9.2） | 5291〜5353行を切り出す | 楽器・音源バンク・コンプ・幅・送り・EQ・パン・ディレイ送りを切り出した。`t.composeSlot = null` は `loadMML` に残した | `runComposeAccomp` はトラック設定を当てた後で `composeSlot` を決めるので、関数の中で消すと消える（設計の擬似コードは先に決めて後で当てる順） |
| `loadMML` のオクターブ（新規） | — | 読み込んだトラックの `trackOctave` を 0、`trackOctaveUnison` を none に戻す | 書き出し（`playableNotes`）はこの2つを音符へ焼き込むので、残すと二重に掛かる。上級者モードで §12.6 の「伴奏主体 → キープ → 作曲 → 入れ替え → 入れ替え」を通すと、2回目の入れ替えの MML が一致しなかった（歌ものの @10 が +1、@13 が −1 オクターブずれた）。伴奏主体に限らない既存の不具合で、歌ものだけのキープ → 作曲 → 入れ替えでも起きる |
| 歌ものの作曲の前（新規） | — | `releaseAccompMix`: 画面の曲の `#compose` が `accomp:` で始まり、マスタディレイ（25%・8d）とループ（ON）が伴奏主体の値のままなら、DAW の初期値へ戻してから作る。利用者が変えた値は残す | おまかせマスタリングはディレイとループを触らないので、伴奏主体を一度押すと以後の歌ものがループ・付点8分ディレイ付きで作られていた（実測: 伴奏主体 → 作曲 の MML に `#loop=on #delay=25 #delaydiv=8d` が残った。おまかせはメロディ系にディレイを送るので実際に鳴る）。状態を持たずに `#compose` で判定するのは、入れ替えで戻した伴奏主体の曲（`loadMML` を通る）からも外すため。マスタ音量（80）は戻さない（おまかせのゲインステージングが今の音量と実測ピークから決め直すので、戻すと計算がずれる） |
| 再生専用プレイヤーのループ（付録 D の残件） | 決める | プレイヤーを `options.loop ?? parseLoopMeta(mml) ?? meta.loop ?? false` にした。DAW の書き出しは変えない | DAW から投稿した伴奏主体の曲が埋め込みでループしないため。書き出しを単独の行にそろえる案は、DAW の MML（キープ・共有リンク）の形が変わるので採らなかった。**影響**: 既存の投稿のうち、DAW でループを ON にして書き出したものは、埋め込みでもループするようになる |
| 解説（§9.1） | `daw-ui.ts` の解説モーダル | `daw.ts` の `COMPOSE_INFO_HTML`（`macro-compose-info` が開くもの）に「伴奏主体」の節 | 解説の本文は daw.ts にある |
| 書き出し上限の表示（§9.3） | 「書き出し上限◯小節で末尾が切れます」 | 「生成上限◯小節のため書き出しでは末尾が切れます」を、ベース調の横のヒント（`composeKeyHint`）に続けて出す | UI の項目名が「生成上限」 |
| 確認の「次回から表示しない」 | — | 3つのボタンで共通のキー `compose` | どれも「今のノートを消して作る」確認なので |
| 和音欄（§14-9） | 実装時に合わせる | simple のとき `savedChordInput = song.chordProgression`・`savedChordRoot = song.rootShift`。`savedChordPattern` は変えない | `runCompose` の simple 分岐と同じ形（進行はハ長調、調は rootShift） |

**確認したこと**（dtm の demo をブラウザで操作。`daw.getMML()` とページ内の `parseMML`・`composeAccomp`・`accompToMml` で比べた）

- 「伴奏主体」で 1小節目から鳴る。書き出しの宣言が `#inst=retro_game #drum=none #volume=80 #reverb=50 #reverbdecay=30
  #reverbpredelay=25 #delay=25 #delaydiv=8d #loop=on` と、トラック別の `#t0inst`〜`#t3inst`（square／square／Synth Bass 1／EP2）・
  `eqhi`・`pan`・`rev`・`dly` が fb と同じ。`#mastercomp`・`#fadeout` は無い（直前の歌もののおまかせが付けたコンプ 25・
  フェードアウト 1.5 秒が消えている）。
- DAW の音符（開始・音高・長さ・絶対値の v）が、`#seed` と `#compose` から作り直した `accompToMml` の音符と一致する
  （simple・advanced・31平均律）。advanced で歌ものを作った直後に押しても一致する（オクターブのずれ無し、4〜14 は空）。
- 「伴奏主体 → キープ → 歌もので作曲 → 入れ替え → 入れ替え」で、`getMML().full` が文字列として2曲とも一致し、
  v の種類数（例 @1 45・@2 38・@3 31）が減らない（simple・advanced）。入れ替えで戻したとき、フェードとコンプが残らない。
- 伴奏主体の直後・入れ替えで戻した伴奏主体の後のどちらから歌ものを作っても、`#loop` と `#delay` が付かない。
  歌ものの確認文言は今のまま（「今あるノートをすべて消して、22〜48小節の曲を…」）。
- ホ短調を選ぶと「ト長調 (G) で作成（伴奏主体・80小節）・ホ短調 (Em) → ト長調 (G) を家にして…」。simple の伴奏トラックの
  和音欄に進行が出る。解説モーダルに節が出る。
- 再生専用プレイヤー（`mountMmlPlayer`。unj-reze の埋め込みが通る関数）に DAW の書き出しをそのまま渡すと、ループが ON になり、
  発音ごとの音量から逆算した v が MML の v と一致する。

**残っていること**

- **unj-reze の投稿の埋め込みでは確かめていない**（reze の dev で投稿する作業は所有者の判断）。同じ関数（`mountMmlPlayer`）を
  dtm の demo で確かめた。
- 伴奏主体の後に歌ものを作ると、マスタ音量は 80 から始まる（おまかせのゲインステージングが実測ピークで決め直すまで）。
- ボタンが1つ増えたので、デスクトップ幅の側パネルでは作曲の行の「入れ替え」が2行目へ折り返す。
- 検証用ブラウザでは、歌もの・伴奏主体のどちらを鳴らしても音割れバッジ（CLIP）が点いた（伴奏主体に固有ではない）。
- `handover-compose.md` から本書への1行のリンクは段階3。
