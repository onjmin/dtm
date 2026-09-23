# @onjmin/dtm

MML を中間言語に用いた、モバイルファーストな DAW / ピアノロール打ち込みコンポーネント。
楽器・ドラムに加え、UTAU 音源（[@onjmin/koe](https://www.npmjs.com/package/@onjmin/koe)）による歌声合成にも対応しています。

## デモ

- [DAW エディタ・プレイヤーデモ (demo/index.html)](https://onjmin.github.io/dtm/demo)
- [ヘッドレス再生・コード進行プレイヤーデモ (demo/bgm.html)](https://onjmin.github.io/dtm/demo/bgm.html)
- [npm](https://www.npmjs.com/package/@onjmin/dtm)

## インストール

```bash
npm i @onjmin/dtm
```

---

## 2.0.0 への移行

31 平均律への対応にあたり、**ノートのピッチの単位を変更**しました。1.x からの更新には修正が必要です。

### ピッチの単位

`Note.pitch`（半音）が `Note.pitchUnits`（**1/372 オクターブの整数**）になりました。`NoteData` / `NoteRemove` / `PlayNoteEvent` / `MMLNotePlacement` / `ChordPlacement` も同様です。

```
12 平均律 1 半音 = 31 units      31 平均律 1 度 = 12 units
A4 (MIDI 69)   = 2139 units      1 unit ≒ 3.2258 セント
```

372 = 12 × 31 で、12 と 31 は互いに素なので最小公倍数がこれになり、**両方の音律が誤差ゼロで同じ数直線に乗ります**。整数のままなので `pitchUnits` の同値判定（重複判定・当たり判定・協調編集の `(startStep, pitchUnits)` キー）がそのまま使えます。

変換ヘルパを公開しています。

```ts
import { pitchV1ToUnits, unitsToPitchV1, unitsToHz, unitsToMidiDetune } from "@onjmin/dtm";

pitchV1ToUnits(60);          // 1860  … MIDI ノート番号 → units
unitsToPitchV1(1860);        // 60    … units → MIDI ノート番号（12 平均律でのみ無損失）
unitsToHz(2139);             // 440   … units → 周波数
unitsToMidiDetune(1968);     // { midi: 63, detuneCents: 48.39 }  … 31平均律の中立3度
```

`unitsToMidiDetune` は SoundFont のように整数 MIDI ノートのゾーンしか持たない音源向けです。最寄りのゾーンを鳴らして残差を `detune`（セント）で補正します。

> **`PlayDrumEvent.pitch` と `DRUM_KEYS` は変更していません。** これらは GM 打楽器のキー番号であって
> 音高ではないため、units へ変換すると全ドラムが壊れます。

### 単位はブランド型で区別されます

`pitchUnits` の型は素の `number` ではなく **`Units`** です。MIDI ノート番号は **`MidiNote`** で、両者は互いに代入できません。

```ts
import { units, midiNote, pitchV1ToUnits, type Units } from "@onjmin/dtm";

// ノートを手で組むとき
const note = {
  id: 0,
  startStep: 0,
  durationSteps: 48,
  pitchUnits: pitchV1ToUnits(60),   // MIDI 60 (中央ド) から作る
  velocity: 100,
};

// units を直接指定するとき
const c4: Units = units(1860);      // 60 × 31

// これはコンパイルエラーになる
const bad: Units = 1860;            // Type 'number' is not assignable to type 'Units'
```

素の数値からは `units()` / `midiNote()` を通してください。これは手間ではなく、**「この数値の単位を確認した」という宣言**として機能します。

なぜこうしたかというと、`Note.pitch` → `pitchUnits` の改名時に**単位の取り違えを 12 件作り込んだ**からです。すべて型チェックを通過していました。半音のつもりの閾値が units と比較される、units が SoundFont へ MIDI ノート番号として渡されて**楽器音が無音になる**、オクターブユニゾンに半音の 12 が足されて 0.4 半音ずれる、といった不具合が、目視の監査を 3 回重ねても毎回新しく見つかりました。型が同じ `number` である限りコンパイラは単位を一切検証しないためです。

ブランド型はこれらを検出します。

```
units を SoundFont の pitch へ    → Units is not assignable to MidiNote
units に半音の 12 を足す           → number is not assignable to Units
MidiNote を units の関数へ         → MidiNote is not assignable to Units
```

ただし**比較演算だけは防げません**。`pitchUnits < 48` のような式は `number` 同士の比較として通ります。ピッチと数値を比べる箇所は、引き続き単位を目で確認してください。

### その他の破壊的変更

| 1.x | 2.0.0 |
|---|---|
| `init(target, w, h, config)` | `createRenderer(target, w, h, config)` が描画器インスタンスを返す |
| `new MMLCore(handlers, volume)` | 第 3 引数に `getConfig: () => RenderConfig` が必要 |
| `transposeNotes(cores, semitones)` | `transposeNotes(cores, steps)` — 単位は格子 1 ステップ |

`renderer` をインスタンス化したのは、モジュール全体がシングルトンで **1 ページに 2 つエディタをマウントすると後からマウントした側が Canvas を奪っていた**ためです（音律以前からのバグ）。曲ごとに音律が違うと格子まで食い違うため、31 平均律対応の前提でもあります。

`transposeNotes` の単位を変えたのは、31 平均律では「半音」がクロマチック半音（2 度）とダイアトニック半音（3 度）に分岐して一意に定まらないためです。12 平均律では 1 ステップ＝1 半音なので、呼び出し側の値はそのままで動きます。

### 協調編集

`onNotesPatch` / `applyPatch` で送受信する `pitchUnits` の意味が 1.x と異なるため、新旧クライアントが混ざると**黙って別の音になります**。dtm 自身は通信路を持たないので、バージョンの突き合わせは利用側アプリのハンドシェイクの責務です。

```ts
import { PITCH_ENCODING_VERSION } from "@onjmin/dtm"; // 2 (1.x は 1 相当)
```

v1 → v2 の変換は無損失ですが、**v2 → v1 は 12 平均律の曲でのみ**無損失です（31 平均律を半音へ丸めると最大 48.4 セント動きます）。

---

## クイックスタート（全部入り `createDtmStudio`）

楽器・ドラムの SoundFont、歌声合成、録音までを内包した一番簡単な入口です。SoundFont は実行時に CDN から動的 import し、歌声合成ワーカーは同梱の `dist/voice-worker.js` を使います。

```ts
import { createDtmStudio } from "@onjmin/dtm";

const studio = await createDtmStudio();

// 1. 編集UI（ピアノロール・音・歌声込み）
const daw = studio.mountEditor(document.getElementById("editor"), {
  initialMML: "@0 t120 o5 l8 ccggaag4 ffeeddc4",
});

// 2. 再生専用UI（MML を渡すだけ）
studio.mountPlayer(document.getElementById("player"), daw.getMML().full);

// 3. コード進行プレビューUI（コードネームテキストを渡すだけ）
studio.mountChordPlayer(
  document.getElementById("chord-player"),
  "| C | G | Am | F |",
  {
    volume: 80,
    bpm: 120,
  }
);
```

## マスター音量の調整

ライブラリの再生音量は 0-100 のパーセンテージで調整できます。

- `createDtmStudio` / `mountDAW` / `mountEditor` などの DAW 系 API では `masterVolume` を使います。
- ヘッドレス再生 API（`playMML` / `playChords` / `mountChordPlayer`）では `volume` を使います。
- 再生中に音量を切り替えたい場合は各インスタンスの `setVolume()` を呼び出します。

```ts
const studio = await createDtmStudio();
const daw = studio.mountEditor(editorEl, {
  initialMML: "@0 t120 o5 l8 ccggaag4 ffeeddc4",
  masterVolume: 60,
});
daw.setVolume(40);

const bgm = playMML("@0 t120 o5 l8 ccggaag4 ffeeddc4", {
  loop: true,
  volume: 70,
});
bgm.setVolume(50);
```

```ts
const chordPlayer = studio.mountChordPlayer(chordEl, "| C | G | Am | F |", {
  volume: 80,
});
chordPlayer.setVolume(65);
```

### 「曲自体の音量」と「聴く人の音量」を分けて扱いたい場合

上記の `masterVolume` / `volume` は**曲データが持つ音量**です（MML の `#volume=` と往復し、
`daw.loadMML()` を呼ぶたびにそのMMLの値で上書きされます）。SNS のフィードのように、
1つの `studio` を複数の投稿・複数の埋め込みプレイヤーで共有し、かつ「読者が自分の好みで
サイト全体の音量を1つ調整したい」というケースでは、曲側の値をいじらずに
`studio.setMasterVolume()` を使ってください。これは `studio.masterGain`（全ての
`mountEditor` / `mountPlayer` / `mountChordPlayer` / `playSingingMML` インスタンスが
最終的に合流する出力段の GainNode）を直接動かすため、曲データやモード切替・
`loadMML()` の影響を一切受けません。

```ts
const studio = await createDtmStudio();

// 読者側の「サイト全体の音量」— 曲を跨いで一度だけ管理すればよい
studio.setMasterVolume(userPreferredVolume); // 0-100

// 曲側の masterVolume/volume には触れない（#volume= が持つ作曲者の意図をそのまま尊重する）
const daw = studio.mountEditor(editorEl, { initialMML: mml });
const player = studio.mountPlayer(playerEl, mml);
```

`DawInstance.setMasterVolume` / `MmlPlayerOptions.masterVolume` と
`DtmStudio.setMasterVolume` は同名ですが別物です。前者は「曲自体の音量」（`#volume=`
と同期し、曲を読み込むたびに上書きされる）、後者は「聴く人の音量」（曲データと
無関係に出力段へ一度だけ掛かる）という別レイヤーを担っています。

---

## 録音・動画エンコード用音声ストリームの取得 (`MediaStream`)

動画ファイル（MP4 / WebM）としてのエクスポートや録音（`MediaRecorder`）を行う場合、`studio` から音声トラックや `MediaStream` を直感的に取得できます。

```ts
const studio = await createDtmStudio();

// 1. 録音・録画用 Audio MediaStreamTrack の取得
const audioTrack = studio.getAudioStreamTrack();

// 2. Canvas 映像トラックと合成して MediaRecorder へ渡す
const canvasStream = canvas.captureStream(30);
const combinedStream = new MediaStream([
  ...canvasStream.getVideoTracks(),
  audioTrack,
]);

const recorder = new MediaRecorder(combinedStream, { mimeType: "video/mp4" });
recorder.start();
```

また、`createDtmStudio({ destination })` に `MediaStreamAudioDestinationNode` や自前の `GainNode` を直接渡すことも可能です。`studio.masterGain` を参照して自作の Web Audio エフェクトやミキサーにルーティングすることもできます。

---

## 再生機能・API 一覧

用途や UI の有無、歌声対応の有無に応じた各種再生関数が用意されています。

| 関数名 | UI描画 (DOM) | 歌声対応 (`@@n`) | 戻り値 | 主な用途と効果 |
| --- | --- | --- | --- | --- |
| `playMML(mml, options)` | 不要 | 非対応 | `MmlPlayback` | 楽器・ドラムの MML ヘッドレス再生。軽量内蔵シンセで BGM シームレスループや Cues 同期イベントを発火。 |
| `playSingingMML(mml, options)` | 不要 | **対応** | `Promise<MmlPlayback>` | 歌声付き MML のヘッドレス再生。画面なしで `.koe` / `klatt` 歌声モデルをプリロードし、伴奏と同期再生。 |
| `playChords(chordStr, options)` | 不要 | 非対応 | `MmlPlayback` | コード進行のヘッドレス再生。`"\| C \| G \| Am \| F \|"` などの文字列からアルペジオ等の伴奏音を鳴らす。 |
| `playNote(options)` | 不要 | 非対応 | `void` | 簡易単音発音。SE や音高確認のためのテスト発音。 |
| `mountMmlPlayer(target, mml, options)` | **必要** | **対応** | `MmlPlayerInstance` | 再生専用 UI ビュー。トークン帯のハイライト、オートスクロール、歌声キャラクター表示を含む埋め込みプレイヤー。 |
| `mountChordPlayer(target, chordStr, options)` | **必要** | 非対応 | `ChordPlayerInstance` | コード進行再生専用 UI コンポーネント。コードネーム表示と試聴操作。 |
| `createDtmStudio()` / `mountEditor` | **必要** | **対応** | `DtmStudio` / `DawInstance` | フル機能ピアノロールエディタ UI。SoundFont 演奏、マウス打ち込み編集、歌声合成、録音機能を提供。 |

---

## ヘルプとガイドツアー

編集 UI には**ヘルプ（`?`）ボタン**と**目的別のガイドツアー**が同梱されています。どちらも埋め込み先でそのまま動きます。

### 何が出るか

- **`?` ボタン**（ツールバー右） … 使い方モーダル。画面のあちこちに散っている `ⓘ` 解説を 1 か所から辿れるハブになっています。**既定で表示**（`showHelp: false` で消せます）。
- **ガイドツアー** … 対象要素をくり抜いて吹き出しで説明するスポットライト型ウォークスルー。冒頭で目的を尋ね、選ばれた枝だけを歩かせます。

| 枝 | 案内する内容 |
| --- | --- |
| カバー曲を作りたい | オーディオ同時再生へ音源を読み込む → 開始のずれで頭を合わせる → 範囲を切り出す → ミュートで聴き比べる → 重ねて打ち込む |
| 曲を自動で作りたい | 作曲ボタン → 構成テンプレ → 雰囲気（調） → 再生 → おまかせマスタリング |
| 自分で打ち込みたい | ピアノロール → ツール／音符の長さ → トラックタブ → 再生 → 楽器・音量 |

**自動再生は既定でオフです。** 埋め込み先の第一印象を勝手に上書きしないための既定値で、初回に流したいアプリだけが明示的に有効化します。

```ts
const studio = await createDtmStudio();

// 既定（自動再生なし）。? ボタンからはいつでも開始できる
studio.mountEditor(el, { initialMML });

// 初回訪問時だけ自動で流す
studio.mountEditor(el, { tour: { autoStart: true } });

// 独自の「使い方」ボタンから開始する
myButton.onclick = () => studio.startTour();
```

### 消す・差し替える

```ts
await createDtmStudio({
  features: { help: false },     // ? ボタンごと出さない
});

studio.mountEditor(el, {
  tour: {
    steps: MY_STEPS,             // 既定ステップを丸ごと差し替える
    extraSteps: [myStep],        // 既定ステップの後ろに足す
    storageKey: "myapp-tour",    // 「もう見た」フラグの保存キー（null で記録しない）
    labels: { next: "Next ▶", prev: "◀ Back", skip: "Skip", done: "Start ▶",
              progress: (i, n) => `${i} / ${n}` },
  },
});
```

**存在しない UI を指すステップは自動的に飛ばされます。** `features.midi: false` や伴奏音源を注入していない構成でも、そのステップだけが黙って抜けます。枝そのものも `when` で出し分けられるので、「選んだ先が全部飛んで空になる」行き止まりは起きません。

### 単体で使う

ツアーエンジンは `mountDAW` に依存しない素の DOM ユーティリティです。自分のアプリの UI を指すステップを書いて直接呼べます。

```ts
import { startTour, hasSeenTour, isTourTargetVisible } from "@onjmin/dtm";

startTour({
  root: myAppRoot,               // セレクタの検索基点（既定 document）
  steps: [
    { title: "ようこそ", body: "<p>まずは目的を選んでください。</p>", branches: [
      { label: "A をしたい", steps: stepsA,
        when: (root) => isTourTargetVisible(root, "#feature-a") },
      { label: "B をしたい", steps: stepsB },
    ] },
    { target: "#save", title: "保存", body: "<p>ここで保存します。</p>" },
  ],
  onEnd: (completed) => console.log(completed ? "完走" : "中断"),
});
```

| 項目 | 挙動 |
| --- | --- |
| 閉じた `<details>` の中の対象 | 自動で開いて採寸し、**ツアー終了時に閉じ直す**（パネルの開閉は localStorage に永続化されるため、勝手に開いた状態を残さない） |
| キーボード | `←` `→` で移動、`Esc` で中断 |
| 暗幕のクリック | **進まない**（誤タップで読む前に消えるのを防ぐ） |
| 画面幅 | 吹き出しは画面幅に合わせて縮み、対象の上下で入る方へ回り込む |

---

## モード（`simple` / `advanced`）

トラック構成と MIDI の取り込み方が異なる 2 つのモードがあります。`mode` オプションで切り替え、合わせて `tracks` に対応するトラック構成（`TRACKS_SIMPLE` / `TRACKS_ADVANCED`）を渡します。

| モード | トラック | MIDI 取り込み | 伴奏（コード進行）UI |
| --- | --- | --- | --- |
| `simple` | メロディー / サブメロ / ベース / 伴奏 の 4 本 | 各トラックの特徴から役割へ**自動分類** | `chord` トラックに表示（歌詞欄の代わり） |
| `advanced` | TRACK 01〜15 の 15 本（フラットな連番） | MIDI トラックを**1:1 マッピング** | なし（全トラックが通常のノート＋歌詞トラック） |

```ts
import {
  createDtmStudio,
  TRACKS_SIMPLE,
  TRACKS_ADVANCED,
} from "@onjmin/dtm";

const studio = await createDtmStudio();

// シンプルモード（既定）
studio.mountEditor(editorEl, { mode: "simple", tracks: TRACKS_SIMPLE });

// アドバンスモード
studio.mountEditor(editorEl, { mode: "advanced", tracks: TRACKS_ADVANCED });
```

- `mode` を省略すると `tracks` の本数から推論します（4 本以下→`simple` / 5 本以上→`advanced`）。
  4 トラックでも 1:1 で取り込みたい等、意図がトラック数とずれる場合は `mode` を明示してください。
- `tracks` には任意の独自構成も渡せます（`mode` と組み合わせて挙動を決めます）。
- MIDI のドラム（ch10）はピアノロールで編集できないため、取り込み時の**トラック選択 UI には出ません**。
- `mode` / `tracks` は低レベル API の `mountDAW` でも同じく指定できます。

### 備考: トラック採番と MIDI チャンネルの対応（暫定仕様）

`advanced` の `@n` / タブ名は **MML 仕様に合わせたフラットな連番**（`@0`〜`@14` / TRACK 01〜15、欠番なし）です。
「ch10 = ドラム」という MIDI の慣習は内部モデルには持ち込まず、**MIDI 入出力の変換時にだけ**扱います。

- **出力**: レーン index → MIDI チャンネルに変換する際、打楽器ch（内部 `channel 9` = 1始まり ch10）を避けます。
  結果、TRACK 01〜09 → ch1〜9 / **TRACK 10〜15 → ch11〜16** に書き出されます（タブ番号と MIDI ch は
  10 番以降ズレますが、これは出力時の変換詳細です）。15 レーン ⇄ 15 個の非打楽器ch がちょうど 1:1 で、
  チャンネル衝突は起きません。
- **入力**: `channel 9`（ドラム）のノートは取り込まず、ドラムだけのトラックは選択 UI にも出しません。
  選択したトラックは**選択順に上から**レーンへ詰めます（MIDI の実トラック番号やテンポトラックの有無に
  左右されません）。
- ドラム自体はノートレーンではなく、別系統の**ドラム設定**で編集します。

> 経緯: 当初は「タブ番号 = MIDI チャンネル番号」に揃え、ドラムの ch10 をタブの欠番にする案も検討しましたが、
> このアプリの正規フォーマットは MML（0 始まり・フラット・ドラムch非依存）であり、MIDI は境界の交換
> フォーマットに過ぎません。MIDI の慣習を内部採番に漏らすと MML の一貫性が崩れる（モード間で採番が割れる、
> 永続化される MML に欠番が残る等）ため、**内部は MML 仕様に寄せ、ch10=ドラムの面倒は変換層に閉じ込める**
> 方針に決めました。

### 上級者モード切替の確認ダイアログ（`onRequestAdvancedMode`）

初心者モードで「音が崩れるコンテンツ」を読み込もうとしたとき、自動的に確認ダイアログを表示します。

**対象となるケース**
- 5 トラック以上（ドラムトラック除く）の MML を初心者モードで読み込む
- 5 トラック以上（ドラムトラック除く）の MIDI を初心者モードで読み込む
- 選択中のトラックから順に入れると**トラックが足りない**本数の UST を初心者モードで読み込む

ダイアログで「はい」を選ぶと上級者モードに切り替わり、コンテンツをそのまま引き継ぎます。
「いいえ」を選ぶと初心者モードのまま読み込みます（トラックは合算されます）。

**`mountModeSwitch` 経由の場合（自動）**

`mountModeSwitch` を使っている場合は何も追加設定せずに動作します。

**`mountDAW` 直接利用の場合（手動接続）**

`mountDAW` を直接使う場合は `onRequestAdvancedMode` コールバックを自前で接続してください。

```ts
let currentMode: DawMode = "simple";
let daw: DawInstance | null = null;

function mountWithMode(mode: DawMode, mml?: string) {
  daw?.destroy();
  daw = mountDAW(target, {
    mode,
    tracks: mode === "advanced" ? TRACKS_ADVANCED : TRACKS_SIMPLE,
    initialMML: mml,
    onRequestAdvancedMode: (pendingMml, applyMidi) => {
      // 確認はライブラリ内で完了済み。ここではモードを切り替えるだけ
      currentMode = "advanced";
      mountWithMode("advanced", pendingMml);
      if (applyMidi && daw) applyMidi(daw); // MIDI 読み込みの場合のみ渡される
    },
  });
}
```

- `onRequestAdvancedMode` を渡さない場合、確認ダイアログは表示されず既存の動作（合算して読み込み）になります。
- MML 読み込みの場合は `pendingMml` にその MML 文字列が渡されます。`initialMML` に渡すか `daw.loadMML(pendingMml)` を呼ぶことで上級者モードのDAWに適用できます。
- MIDI 読み込みの場合は `applyMidi` 関数が渡されます。新しいDAWインスタンスを生成した直後に `applyMidi(newDaw)` を呼ぶと MIDI が適用されます。

---

## ヘッドレス再生（画面なし再生 API）

画面を一切持たず、MML 文字列やコード進行を渡して音だけを鳴らす関数群です。ゲームの BGM のように「鳴らして・止める」用途に向きます。

### 1. MML ヘッドレス再生 (`playMML`)

```ts
import { playMML } from "@onjmin/dtm";

// ユーザー操作（クリック等）のコールスタック内で呼ぶ（自動再生ポリシー対策）
const bgm = playMML("@0 t120 o5 l8 ccggaag4 ffeeddc4 #drum=basic", {
  loop: true,        // 曲末で止めずシームレスにループ
  volume: 70,
});

bgm.setVolume(40);   // 再生中も即時反映
bgm.stop();          // 停止
bgm.destroy();       // 停止＋内部 AudioContext を解放
```

- **発音はオーディオスレッド上**で行われます（未来時刻に予約するため、メインスレッドが
  重くても音切れしにくい）。スケジューラ自体はメインスレッドの先読み方式です。
- **タブが非アクティブになると自動で一時停止**し、復帰で再開します（内部生成 ctx のとき既定 ON）。
- 既存の AudioContext / ミキサーへ繋ぎたい場合は `audioContext` と `destination` を注入します。
  注入した ctx は SE 等と共有している可能性があるため、非アクティブ時の自動 suspend は
  既定 OFF になります（代わりに `bgm.suspend()` / `bgm.resume()` を呼び出し側から叩けます）。

```ts
const bgm = playMML(mml, {
  audioContext: myCtx,        // ゲーム側の AudioContext を共有
  destination: myMasterGain,  // 自前のマスターGain/ミキサーへ
  // 自前シンセを使うなら onPlayNote を渡す（内蔵 square synth は自動で無効）
  onPlayNote: ({ pitch, volume, when, duration }) => mySynth.play(...),
});
```

#### 高度なループ設定 & 再生キュー（ゲーム同期）

イントロを1回再生したあとに特定区間をループさせたり、曲の特定位置（サビなど）でゲーム内の演出を切り替えるためのイベントを発火させたりできます。

```ts
const bgm = playMML(mml, {
  // 1. イントロ付きループ（例: 4小節目から曲末までをシームレスループ）
  loop: {
    start: { bar: 4 }, // または { step: 576 }, { seconds: 12.5 }
    // end: { bar: 8 } // ループの終わりを曲末以外に制限したい場合に指定
  },

  // 2. キュー（イベントトリガー）の登録
  cues: [
    { id: "intro_end", time: { bar: 4 } },       // 4小節目に入った瞬間
    { id: "chorus_start", time: { seconds: 45.2 } },  // 45.2秒経過した瞬間
  ],

  // 3. キュー通過時のコールバック
  onCue: (cueId) => {
    console.log(`BGM cue reached: ${cueId}`);
    if (cueId === "chorus_start") {
      triggerVisualEffects(); // サビの演出をトリガー
    }
  }
});
```

### 2. 歌声付き MML ヘッドレス再生 (`playSingingMML`)

歌声トラック（`@@n`）を含む MML を画面なしで再生するための関数です。歌声モデル（`klatt` または UTAU `.koe` 音源）の非同期プリロード・頭出し合成を行ってから再生を開始するため、`Promise<MmlPlayback>` を返します。

```ts
import { playSingingMML } from "@onjmin/dtm";

const bgm = await playSingingMML("@@klatt カエルのウタガ;\nt120 o4 c d e f;", {
  loop: true,               // シームレスループ対応（伴奏と歌声が同期して永久ループ）
  volume: 80,
  voiceWorkerUrl: "./voice-worker.js", // オプション（Worker を指定するとメインスレッドの負荷を軽減）
});

bgm.setVolume(50);   // 再生中も音量を即時反映
bgm.stop();          // 停止
bgm.destroy();       // 停止＋モデルと AudioContext の解放
```

- 楽器・ドラムの再生機能に加えて、`@@n` トラックの歌声を自動でロード・ストリーミング再生します。
- `loop: true` や特定範囲の `loop` 指定時も、伴奏と歌声がピッタリ同期してシームレスにループします。

### 3. コード進行ヘッドレス再生 (`playChords`)

コード進行テキストを渡して、伴奏パターン（軽量シンセ）のみをヘッドレスで鳴らすための関数です。

```ts
import { playChords } from "@onjmin/dtm";

const chords = playChords("| C | G | Am | F |", {
  bpm: 120,
  volume: 80,
  loop: true,
  patternType: "arpeggio", // 演奏パターンを指定可能
});

chords.stop(); // 停止
chords.destroy(); // 停止＋AudioContextの解放
```

- **演奏パターン (`patternType`)** は以下の種類をサポートしています：
  - `"block"`: すべての構成音を同時に伸ばす
  - `"arpeggio"`: 構成音を低い順に分散する
  - `"arpeggio-fast"`: 素早く構成音を分散する
  - `"offbeat"`: 裏打ち（2/4拍目）
  - `"yatsume"`: 八つ目（特定のリズムパターン）
  - `"alternating"`: 交互に伴奏音を鳴らす

> 歌声合成（`@@n` 歌詞トラック）を含むヘッドレス再生には `playSingingMML` を使用してください。楽器・ドラムのみの軽量再生には `playMML` を使用できます。

---

## 低レベル API（`mountDAW` / `mountChordPlayer` / 注入式）

本体は音を持たない設計で、`onPlayNote` / `onPlayDrum` に自前のシンセを繋ぐことができます（`createDtmStudio` はこの配線を内包したもの）。

```ts
import { mountDAW, mountChordPlayer } from "@onjmin/dtm";

const daw = mountDAW(document.getElementById("app"), {
  getAudioTime: () => audioCtx.currentTime,
  onResumeAudio: () => audioCtx.resume(),
  onPlayNote: ({ trackId, pitch, volume, when, duration }) => {
    mySynth.play({ pitch, volume, when, duration });
  },
  onPlayDrum: ({ pitch, velocity, when, duration }) => {
    myDrum.play({ pitch, velocity, when, duration });
  },
});

// UIなしの単独コード進行プレイヤー UI のマウントも低レベルで直接行えます
const cp = mountChordPlayer(document.getElementById("chord-app"), "| C | G | Am | F |", {
  audioContext: audioCtx,
  bpm: 120,
  volume: 50,
});
```

---

## 音律（31 平均律）

`#edo=31` を宣言すると、その曲を 1 オクターブ 31 分割で扱います。省略時は 12 平均律なので、**既存の MML は 1 文字も解釈が変わりません**。

```
#edo=31 @0 t120 o4 c c+ c# d- d_ d e_ e;
```

音律は**曲単位**です。トラックごと・小節ごとには変えられません。12 平均律と 31 平均律が一致するのはオクターブだけで、途中の音はすべてずれる（長 3 度で 12.9 セント、三全音で 19.4 セント）ため、同時に混ぜても音楽的に成立しないからです。

### 臨時記号

31 平均律では 4 記号を使い分けます。

| 記号 | 31 平均律 | 12 平均律 | 意味 |
|---|---|---|---|
| `#` | +2 度 | +1 半音 | クロマチック半音上げ（従来のシャープ） |
| `-` | −2 度 | −1 半音 | クロマチック半音下げ（従来のフラット） |
| `+` | +1 度 | +1 半音 | 格子 1 ステップ上げ（微分音） |
| `_` | −1 度 | −1 半音 | 格子 1 ステップ下げ（微分音） |

12 平均律ではクロマチック半音＝格子 1 ステップなので 4 記号すべてが従来の意味に潰れ、シャープ 2 つ・フラット 2 つの同義語になります。31 平均律でのみ `#`/`-` と `+`/`_` が分岐します。

記号は累積するので `c##` は +4 度です（12 平均律では D）。幹音は五度連鎖で `c`=0 `d`=5 `e`=10 `f`=13 `g`=18 `a`=23 `b`=28 度。全 31 度の綴りは次の通りで、いずれも 2 文字以内・オクターブを跨ぎません。

```
   0:c     1:c+    2:c#    3:d-    4:d_    5:d     6:d+    7:d#
   8:e-    9:e_   10:e    11:f-   12:e#   13:f    14:f+   15:f#
  16:g-   17:g_   18:g    19:g+   20:g#   21:a-   22:a_   23:a
  24:a+   25:a#   26:b-   27:b_   28:b    29:b+   30:b#
```

> 記号の選定: `^` は日本の MML 環境（サクラ・PMD・FMP・MUCOM88 等）でタイとして広く定着しており、
> ピッチ変更へ再定義すると過去の MML 資産が黙って別の音になるため使いません。`v` はベロシティ、
> `b` は音名 B で塞がっています。`+` を微分音へ転用できるのは `#` と冗長だからで、`-` は唯一の
> フラット記号なので転用せず、新記号 `_` に新しい概念（微分音）を割り当てています。
>
> 31 平均律はミーントーンなので五度連鎖だけで 31 音すべてに届き、ヴィチェンティーノ（1555）以来
> シャープ・フラット・重複臨時記号で記譜されてきました。`^`/`v` を使う ups-and-downs 記譜は
> 「五度連鎖が全音に届かない音律」向けの汎用記法で、31 平均律には必要ありません。

### 何が変わるか

- **ピアノロール**: 1 オクターブが 31 段になります。音域（MIDI 0–127 相当）は音律に依らず固定なので、
  段数は自動的に 128 → 328 行へ変わります。鍵盤は幹音（白鍵相当）／微分音（短い中間鍵）／
  クロマチック（黒鍵）の 3 階層で描かれます。縦の伸びは縦ズーム（50〜200%）で吸収できます。
- **和音**: コード進行入力は五度圏経由で 31 平均律の格子へ写されます。長 3 度が 10 度（純正 5:4 から
  +0.79 セント）になるため、**同じコードが 12 平均律より綺麗に響きます**。増 4 度（15 度）と
  減 5 度（16 度）も区別されます。
- **歌声**: koe は Hz を直接受けるので、31 平均律の音もそのまま連続ピッチとして歌います。
- **MIDI 書き出し**: ピッチベンドの多チャンネル方式で書き出します（ドラム ch を除く 15 チャンネルへ
  ベンド値の種類ぶんを割り当て、曲頭で RPN 0,0 により感度を ±2 半音へ固定）。dtm 同士なら無損失で
  往復しますが、1 トラック内のマルチチャンネルを潰す DAW では再現されません。
  15 種類を超えると頻度の低いものから最寄りの半音へ丸めます。
- **コード名の自動検出**: 12 平均律へ丸めてから判定するため、31 平均律では近似になります。
  通常のミーントーン和声（三和音・七の和音）は正しく復元されますが、中立 3 度やスーパーメジャーの
  ような 31 平均律固有の音程は別のコードとして誤認されます。

---

## 歌声合成（歌詞トラック `@@n`）

演奏トラック `@n` とは別に歌詞専用行 `@@n` を書くと、そのトラックの Note On に合わせて 1 音節ずつ歌わせられます。

```
@@<トラックID> <モデル> [v<声量>] [q<ゲート>] [p<定位>] [o<オクターブ>] <かな歌詞>

例:
@0 t120 v100 o4g8 g8 e8 e8 f8 e8 d8 c8 g8 g8 e8 e8 d4.;
@@0 tsukuyomi どんぐりころころどんぐりこ;
```

### 歌詞の制御記号

歌詞は **1 文字（拗音は 2 文字）= ノート 1 つ**で対応します。ブレス `、` だけはノートを消費しません。

| 記号 | 意味 | 例 |
| --- | --- | --- |
| `ー` | **継続**。言い直さずに音を保ち、ピッチだけを階段状に切り替える | `あーーーー` |
| `〜` | **継続（ポルタメント）**。`ー` と同じだがピッチを滑らかに繋ぐ（しゃくり・スラー） | `あ〜〜` |
| `っ` | **促音**。ノートを消費し、無音の閉鎖として間を作る | `がっこう` |
| `_` | **休符**。ノートを消費するが歌わない（そのノートは無音） | `あ_い` |
| `、` | **ブレス**。ノートは消費せず、直前ノートの尻を削って息継ぎを差し込む。音源に息継ぎの素片（`息` `息短` `b1` 等）があればその声で、無ければ吸う息の形のノイズ | `あー、いー` |
| `ガ` / `が゜` | **鼻濁音**。カタカナのガ行（または半濁点）は、音源が鼻濁音の別名（`ガ`）を持っていればそれで歌う（重音テト・欲音ルコ♀）。無ければふつうのガ行 | `カガミ` |
| `ヴァ` | **ヴ**。音源に `ヴぁ` / `ヴァ` の素片があればそれで、無ければバ行で近似 | `ヴァイオリン` |
| `「…」` | **語り**。囲んだ部分を歌わずに読み上げる。ひとかたまりでノートを 1 つ消費する（下記） | `あ「こんにちは」い` |

`〜` は `～`（全角チルダ）でも、`、` は `,` でも書けます。

### 歌の中で語る（`「…」` 語り）

歌詞の途中を `「…」` で囲むと、その部分だけを**話し声で読み上げ**ます（UtauTTS）。歌詞と同じ行に混ぜて書けます。

```
@0 t120 o4 g8 g8 e8 e8 f8 e8 d8 c8 r2 c2 g8 g8 e8 e8 d4.;
@@0 tsukuyomi どんぐりころころ「みなさん、こんにちは！」どんぐりこ;
```

| 要素 | 扱い |
| --- | --- |
| `「…」` ひとかたまり | ノートを **1 つ**消費し、そのノートの位置から話し始める |
| 中身 | 漢字・数字・句読点を含んでよい。読みとアクセントは jpreprocess（OpenJTalk 互換）が決める。`？` で終わると語尾が上がる |
| ノートの長さ | 使わない。**長さは読み上げが決める**（ピアノロールに実際の長さが破線の帯で出る） |
| ノートの音高 | 話す声の高さ。「語りの基準」の行（音源の収録ピッチ）に置くと素の声、上に置くほど高い声 |
| 空の `「」` | `_` と同じ（1 ノート消費して無音） |
| 閉じ括弧なし | 行末までを語りにする |
| 直後の `ー` | 引き継ぐ母音が無いので落ちる。次の音節は語頭として歌う |

- 半角の `｢｣` も同じ括弧として読みます。
- 中身に `;` と改行は書けません（MML の区切り文字のため。エディタからの書き出しでは `;` を全角へ逃がします）。
- klatt では鳴りません（UTAU 音源のみ）。多音階音源はノートの音高に最も近い収録セットを使います。
- 初めて語りを鳴らすときに、UtauTTS の Wasm・jpreprocess の辞書・HTS 音声モデル（合計約 45MB）を取得して Cache API に保存します。配信元は `createDtmStudio({ ttsBaseUrl })` / `createSingingVoices({ ttsBaseUrl })` で差し替えられます（既定は koe のデモと同じ `https://onjmin.github.io/koe/demo/utautts/`）。
- 仕組み: 計画（読み → HTS の音素長と F0 → UtauTTS のユニット選択と配置）はメインスレッドで、合成は歌唱と同じ voice worker の worldline でチャンクごとに行い、届いた順にシーケンサと同じアンカーへ並べます。WAV 書き出しにもそのまま入ります。

継続の要点は「**同じモーラをピッチ違いで続けるとき、区切って発音するか否かを書き分けられる**」ことです。

```
@0 t120 o4 c8 d8 e8 f8 g8;
@@0 tsukuyomi あああああ;   ← 5 回それぞれ言い直す（従来どおり）
@@0 tsukuyomi あーーーー;   ← 1 つの「あ」を保ったままピッチだけ動く
```

継続は**隙間なく続くノートを 1 音へ結合**し、区間ごとのピッチ推移として 1 回で合成します
（`buildStreamVoiceNotes` / `StreamVoiceNote.pitchSegments`）。ノートの間に休符があるとき、
結合後が `TIE_MERGE_MAX_SEC`（4 秒）を超えるとき、シークで先頭が切り落とされたときは結合をやめ、
先行母音を切って直前ノートへクロスフェードする「継続ノート」として繋ぎます。

継続が引き継ぐ母音は直前の音節のものです。`きょー` は `きょ` + `お`、`んー` は `ん` を伸ばした
ハミングになります。休符 `_` とブレス `、` は母音の文脈を切るので、その次の音節は語頭
（連続音の `- か`）として歌われます。旋律側の休符（ノートの間に 0.15 秒以上の隙間）も同じで、
歌詞に `_` が無くてもその後は語頭で入り直します。フレーズの終わり（休符・ブレス・行末の前、
促音の前と `↓` で消える音を除く）は、音源に語尾の素片（連続音の `a R` 等）があればそれで抜きます。

> **`ー` `っ` の扱いが 2.0 系から変わりました。**
> 以前は「音源に該当する音声サンプルが無い」として**歌詞から丸ごと除去**していたため、
> `きょーと` は `きょ` `と` の 2 音節（＝ノート 2 つ）でした。現在は `きょ` `ー` `と` の
> 3 音節になり、**同じ歌詞でもノートとの対応が 1 つずつずれます**。
> `ー` `っ` を含む既存の曲は歌詞かノートの調整が必要です。

### モデルと音源

- モデルに `klatt` を指定すると内蔵フォルマント合成（音源ロード不要）。
- 内蔵 UTAU 音源（@onjmin/koe）キーワード:
  `tsukuyomi` / `rino` / `roze` / `uc` / `ruko_male` / `ruko_female` / `teto` / `shiyo` / `rei` / `mgroid` / `motroid` / `nynroid`。
- `createDtmStudio` を使えば歌声は自動で配線されます。低レベル API で使う場合は
  `createSingingVoices` の戻り値を `mountDAW` / `mountMmlPlayer` の `singingVoices` に渡してください。

重い WORLD 再合成は専用 Web Worker で実行してメインスレッド（楽器・UI）を塞がず、複数ボーカルは音源ごとに並列合成されます。

### MML を介さない読み上げ（`studio.speak`）

セリフやナレーションのように、曲の外で本文をそのまま読み上げたいときは `studio.speak` を使います。
歌詞の `「…」` 語りと同じ計画・合成経路（UtauTTS + worldline、voice worker）で、ノートの代わりに
「今」を起点に鳴らします。

```ts
const studio = await createDtmStudio();

// ロード画面などで先に取っておく（TTS アセット約 45MB ＋ 音源マニフェスト。2 回目以降は一瞬）
await studio.prepareSpeech(["tsukuyomi"], {
  emotions: ["happy", "sad"],   // 使う感情モデル（各約 2MB）も一緒に
  onProgress: (loaded, total) => console.log(`${loaded}/${total}`),
});

// ユーザー操作のコールスタック内から
const handle = await studio.speak("こんにちは。ここは はじまりの村です。", {
  model: "tsukuyomi",   // 省略時 DEFAULT_SPEECH_MODEL
  pitchOffset: 3,       // 素の声からの半音オフセット（±24）
  emotion: "happy",     // 感情（省略時 neutral）
  style: "lively",      // 話し方プリセット（省略時 neutral）
  volume: 0.9,
  awaitRender: "first-chunk", // 最初のチャンクが出来てから頭から鳴らす（セリフ向け。下記）
});
if (handle) {
  console.log(handle.durationSec); // 音を占める長さ（秒）
  await handle.ended;              // 鳴り終わり（stop() で途中終了もできる）
}
```

| オプション | 意味 |
| --- | --- |
| `model` | 内蔵音源キーワード（上の一覧）。klatt では鳴らない |
| `pitchOffset` | 素の声（音源の収録ピッチ）からの半音オフセット。既定 0 |
| `emotion` | 感情 `"neutral"` / `"happy"` / `"sad"` / `"angry"`（HTS 音声モデル tohoku-f01 の差し替え。音素長と F0 の起伏そのものが変わる）。既定 neutral。初めて使う感情は約 2MB を取得してから鳴る |
| `style` | 話し方プリセット `"neutral"` / `"calm"`（朗読調）/ `"lively"`、またはプリセット＋上書き `{ preset: "calm", speed: 0.95 }`（koe の `SpeakingStyleInput`）。話速・抑揚幅・基準ピッチ・ポーズ倍率・音量曲線の係数 |
| `expr` | 声色 `{ gender, breathiness, tension }` |
| `volume` / `pan` | ピーク音量（0〜1）と定位（-1〜1） |
| `at` | 最初のモーラを鳴らす AudioContext クロック秒（省略時は `awaitRender` で待つものが揃いしだい）。近すぎる・過去の値は今に丸める（`"skip"` では最初の子音の先行発声がはみ出さない時刻まで）。`lateChunks: "shift"` では頭を切らないために遅れることがある |
| `awaitRender` | 鳴らし始める前にどこまで合成を待つか。`false`（既定。計画が出来しだい。**頭が欠けることがある**＝下記）/ `"first-chunk"`（最初のチャンクまで。セリフ向け）/ `true`（全チャンク） |
| `minBufferSec` | `awaitRender: "first-chunk"` のとき、鳴らし始める前に合成しておく秒数（最初のモーラから。既定 0＝最初のチャンクだけ）。合成の遅い音源で行の途中に間が空くなら 0.3〜0.5 |
| `lateChunks` | 置き場所を過ぎてから届いたチャンクの扱い。`"shift"`（飛ばさず時間軸ごと後ろへずらす）/ `"skip"`（過ぎたぶんを飛ばして途中から）。既定は `awaitRender: "first-chunk"` なら `"shift"`、それ以外は `"skip"` |
| `signal` | `AbortSignal`。計画中なら null を返し、再生中なら止める |

戻り値の `SpeechHandle` は `durationSec` / `startTime`（最初のモーラが鳴る時刻）/ `morae` /
`shiftSec` / `position()` / `stop()` / `ended` を持ち、`stop()` はその発話だけを止めます
（同時に鳴っている歌や他の語りには触れません）。読みが取れない本文（記号だけ等）や未知のモデルでは `null` です。

鳴らさずに長さだけ知りたいとき（台本の各行の長さから時間軸を組む等）は `studio.planSpeech` を使います。
長さに加えて**モーラ列**（口パク・字幕送り用。最初のモーラが鳴る時点を 0 とする秒と母音）も返り、
`studio.speak` の戻り値 `SpeechHandle.morae` にも同じものが入ります。

```ts
const info = await studio.planSpeech("こんにちは。", { model: "tsukuyomi", emotion: "happy" });
// info: { durationSec: 1.2, morae: [{ startSec: 0, endSec: 0.11, mora: "こ", vowel: "o" }, …] } | null
```

低レベル API では `createSingingVoices(...).speak(model, text, options)` /
`.prepareSpeech(models, { onProgress })` が同じものです。音源選択 UI のラベルには
`KOE_VOICEBANK_NAMES`（キーワード → 音源名）が使えます。

音源のプルダウンを作るときは、`groupVoiceModels(names)` で大分類（`<optgroup>`）に分けられます。
mountDAW の歌唱モデル選択と同じ分類（`VOICE_MODEL_CATEGORIES`）で、**渡した一覧に載っているキーだけ**を
返すので、読み上げ用なら `KOE_VOICEBANK_NAMES`（語れない `klatt` は最初から入らない）、歌唱用なら
`klatt` を足した一覧を渡します。分類に無いキーは末尾の「その他」に入るので、音源を足した日に
選択肢から消えることはありません。

```ts
const groups = groupVoiceModels(KOE_VOICEBANK_NAMES);
// [{ label: "kusaプリセット", models: [{ value: "tsukuyomi", label: "つくよみちゃん" }] }, …]
```

#### 頭から鳴らす・文字送りを声と揃える（`awaitRender: "first-chunk"`）

語りは計画（読み・モーラの時刻）が先に出来て、音はチャンク（数モーラずつ）ごとに後から届きます。

- **既定（`awaitRender: false`）** は計画が出来た時点で時刻を決めるので、最初のチャンクの合成が
  間に合わないと**頭が欠けます**（過ぎたぶんを飛ばして途中から鳴らす＝`lateChunks: "skip"`）。
  珍しいことではなく、実測では速い音源（uc）でも行の頭が 0〜450ms、合成の遅い音源（roze）では
  3.3 秒の行のうち 2.3 秒、7.3 秒の行のうち 1.4 秒が欠けました（`"first-chunk"` ではどれも 0ms）。
  既定は互換のため変えていませんが、**セリフには使わないでください**。
- **`true`** は全チャンクを待つので欠けませんが、長文ほど鳴り出しが遅れます（文字送りを先に始めると、
  文字が出終わってから声が出ることになります）。
- **`"first-chunk"`** は最初のチャンクが出来た時点で解決し、そこから頭を欠かさずに鳴らします。
  合成が再生に追いつかず後続のチャンクが遅れたときは、飛ばさずに**時間軸ごと後ろへずらします**
  （`lateChunks: "shift"`。koe のデモと同じ考え方）。間が少し空くことはあっても言葉は欠けません。
  `ended` と自動停止もずれたぶん延びます。
  最初のチャンクは数モーラしかないので、合成の遅い音源（URL 配信でユニットの音を 1 つずつ取りに行く
  初回など）では 2 つ目が間に合わず、行の途中に 0.2〜1 秒ほどの間が空くことがあります。気になるなら
  `minBufferSec: 0.4` のように、鳴らし始める前に少し貯めておくと減ります（鳴り出しはそのぶん遅れます）。

`startTime` は最初のモーラが実際に鳴る時刻です（先頭の子音の先行発声がはみ出す分も含めて後ろへ
ずらしたあとの値）。`morae` の時刻は `startTime` 基準の計画どおりの秒で、`"shift"` でずれた後の
モーラは `shiftSec`（今までにずらした合計）だけ遅れて鳴ります。文字送りや口パクは `position()`
（今の再生位置。`morae` と同じ軸で、合成待ちの間は進まない）と比べると、ずれがあっても音と揃います。

```ts
const handle = await studio.speak(line, { awaitRender: "first-chunk" });
if (handle) {
  const ctx = studio.audioContext;
  // 声の鳴り始めに文字送りを合わせる
  setTimeout(startTyping, Math.max(0, handle.startTime - ctx.currentTime) * 1000);
  // あるいはモーラ単位で送る
  const tick = () => {
    const pos = handle.position();
    const spoken = handle.morae.filter((m) => m.startSec <= pos).length;
    showMorae(spoken);
    if (spoken < handle.morae.length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
```

> **`awaitRender: "first-chunk"` と `minBufferSec`・`lateChunks`、`SpeechHandle.shiftSec` / `position()` を追加しました。**
> `awaitRender` を省略したとき・`true` のときの挙動は従来どおりです（`lateChunks` の既定は `"skip"`）。
> ただし `"skip"` の開始時刻は、最初の子音の先行発声が今より前にはみ出さないところまで丸めるようにしました
> （`awaitRender: true` でも最初の子音の頭が 10〜25ms ほど欠けていたため。そのぶん鳴り出しが最大で数十 ms 遅れます）。
> `startTime` は `awaitRender: false` かつ `lateChunks: "shift"` のときだけ、最初のチャンクが届くまで
> 見込みの値になります（読むたびに今の値を返す getter）。

---

## UST（UTAU）の読み込み・書き出し

UTAU の曲データ（`.ust`）を、**音符と歌詞をまとめて**取り込めます（MIDI へ書き出す必要はありません）。
UI は「MIDI / UST / MML 入力」パネルの UST 欄、書き出しは「MIDI / UST / MML 出力」の「UST 出力」です。

### 読み込み

- **複数ファイルを一度に選べます**。UST は 1 ファイル＝1 パートなので、ハモリ等で分かれたファイルを
  **選択中のトラックから順に、隣・その隣…へ 1 ファイルずつ**割り当てます。あぶれたぶんは読み込まず、
  何件落としたかを UI に表示します（初心者モードでトラックが足りないときは上級者モードへの切り替えを提案します）。
- 並び順は**ファイル名順**です（`01_main.ust` / `02_harmony.ust` のように番号を付けると狙った順に入ります）。
- 文字コードは Shift_JIS / UTF-8 を自動判別します。BPM は UST の `Tempo` に合わせます。
- 歌う音源（`lyricModel`）が未選択のトラックには自動で 1 つ割り当てます（選択済みならそのまま）。
- MIDI 読み込みと違い**全消去はしません**。伴奏を残したままメロディのパートだけ差し替えられます。
- 「現在のトラックのみ対象とする」が有効なときは、隣へこぼさず先頭の 1 ファイルだけを読み込みます。

歌詞は 1 ノート 1 音節へ落とします。

| UST の `Lyric` | 取り込み結果 |
| --- | --- |
| `か` / `カ` | `か`（カタカナはひらがなへ寄せる） |
| `a か` / `- か`（連続音） | `か`（空白区切りの最後の語が実体） |
| `かC4` / `か強`（サフィックス付き） | `か`（先頭のかな列だけ） |
| `ka` / `kya` / `shi`（ローマ字命名） | `か` / `きゃ` / `し` |
| `R` | 休符（ノートを作らず位置だけ進む＝ピアノロールの隙間） |
| `+`（前の歌詞を続ける） | 継続記号 `ー` |
| 読み取れない綴り（CVVC の `a k` など） | 継続記号 `ー`（言い直さず繋ぐ。件数は UI に表示） |

### 書き出し

「UST 出力」は**選択中のトラック 1 本だけ**を書き出します。UST は単旋律 1 パートのフォーマットなので、
和音・重なりは先勝ちで 1 本へ潰し、ノートの隙間は `R`（休符）ノートとして書きます。文字コードは
UTF-8（`Charset=UTF-8` 付き）、改行は CRLF です。31 平均律の微分音は UST に書けないため最寄りの半音へ丸めます。

### API

```ts
import { parseUst, buildUst } from "@onjmin/dtm";

const part = parseUst(await file.arrayBuffer().then((b) => new Uint8Array(b)), file.name);
part.bpm;      // UST の Tempo（無ければ null）
part.notes;    // { startStep, pitch(MIDIノート番号), durationSteps, velocity }[]
part.lyrics;   // ノート数と同じ音節数のかな歌詞

const text = buildUst({ notes, syllables, bpm: 120 }); // .ust テキスト
```

`DawInstance` には `exportUST()`（選択中トラックの Blob）と `applyUstParsed(ustTracks, startIndex?)` があります。

---

## オーディオ同時再生（mp3 / wav / YouTube）

音声ファイルやそのURL、YouTubeのURLを、打ち込みと**一緒に鳴らせます**。カラオケ音源に合わせて
メロディを打ち込む、既存曲に重ねてハモリを作る、といった用途向けです。UIは「オーディオ同時再生」パネル。

音を出すのは利用側の責務なので、`createDtmStudio().mountEditor` を使うと自動で配線されます
（`mountDAW` を直接使う場合は `backingAudio` に `createBackingAudio(...)` の戻り値を渡してください。
渡さないとパネルごと出ません）。

### 同期のしかた

打ち込みと**同じアンカー**（`sequencer.getStartTime()`）へ揃えます。音源の種類で精度が変わります。

| 読み込み方 | 鳴らし方 | 精度 | WAV書き出し・録音 |
| --- | --- | --- | --- |
| ファイル | デコードして `AudioBufferSourceNode` | サンプル単位 | **入る** |
| URL（CORS可） | 同上 | サンプル単位 | **入る** |
| URL（CORS不可） | `<audio>` 直接再生＋ドリフト補正 | 実測で数ms | 入らない |
| YouTube | IFrame Player API＋ドリフト補正 | 数十ms | 入らない |

### 鳴り始めの遅れ（初回再生でズレる問題）

再生要求から実際に音が出るまでの遅れは環境依存で事前に読めません（YouTubeのバッファ、
`<audio>` のデコード、初回再生のウォームアップなど。**mp3/wav でも起きます**）。
音源の性質で直し方を変えています。

| 音源 | 直し方 |
| --- | --- |
| デコード済み（ファイル / CORS可URL） | 予約がサンプル単位で正確。何もしない |
| `<audio>` 直接再生 | **予約してから実測で1回詰める**。測った遅れを足した先へ seek する（seek 自体の立ち上がりを見越す） |
| YouTube | **先に鳴らして実測し、打ち込みの開始をそこへ合わせる**（`sequencer.start` の pre-roll） |

YouTube だけ「待ち合わせ」るのは、再生速度を微調整できず**戻す手段が seek しか無い**ためです。
`<audio>` は待ち合わせるとかえって精度が落ちます（待った時点で音源が先行してしまう）。

実測の肝は、**読み取り値が動いた瞬間**を捕まえること。値が変わった瞬間ならその値はたった今のものだと
分かるので、更新が粗い（数百ms刻み）YouTubeでも誤差をポーリング間隔（40ms）まで押し込めます。

鳴り出してからの追従は:

- 進みすぎ（音源が先行）… `<audio>` では **seek しない**。再生速度を最大±5%変えて寄せる
  （`preservesPitch` が効くので音程は動きません）。seek は1回あたり100ms前後の立ち上がりを伴うため、
  それより小さいズレを seek で詰めると、詰めた量より大きく遅れ直して振動します。
- 大きくズレた（0.3秒超）… seek で直す。
- YouTube … 速度を変えられないので seek だけが頼り。0.06秒を超えたら直します。

**seek には「飛んだ先を読み直すぶん、必ず遅れて鳴り出す」性質があります**（YouTubeで実測 約70ms）。
見越さずに撃つと毎回そのぶん後ろへ着地し、YouTubeでは速度で寄せ直せないためそこで固定されます。
そこで**撃つたびに残差から見越し量を学習**し、次からはそのぶん先を狙います。

実測値:

| 経路 | 対策前 | 対策後 |
| --- | --- | --- |
| `<audio>` 直接再生・同時開始 | +104ms から約5秒かけて収束（途中 -48ms まで振動） | 再生直後から **±15ms以内** |
| YouTube・同時開始 | **-70ms のまま固定** | 約1秒で収束し、以後 **±5ms** |

YouTubeは「音源が先・n秒」指定なら、最初の音符から正確に合います。

### 音源の範囲（いらないパートを飛ばす）

**開始**〜**終了** で音源の使う範囲を決めます。`0:12.500` のように分:秒.ミリ秒、`12.5` のように
秒だけでも書けます（終了は空欄で最後まで）。

### 開始のずれ（どちらが何秒先に始まるか）

「**［音源／打ち込み］が先、［n秒］後にもう一方が始まる**」の2項目で、次の4通りをすべて表します。

| 指定 | 鳴り方 |
| --- | --- |
| 音源が先・0秒 | 同時に始まる（既定） |
| 音源が先・n秒 | 音源を先に鳴らし、n秒後に打ち込みが入る（前奏の長い音源に合わせる） |
| 打ち込みが先・0秒 | 同時に始まる |
| 打ち込みが先・n秒 | 打ち込みが先に鳴り、n秒後に音源が入る（曲の途中から音源を重ねる） |

内部では**符号付きの1つの秒数**（正＝音源が先）で持ちます。**音符は動きません**——ずれるのは
再生の開始時刻だけ（音源が先のぶんは `sequencer.start` の pre-roll として待つ）なので、曲データは
そのままで、いつでも変えられます。再生中に変えるとその場で合わせ直します。曲の途中から再生した
ときは待ち時間を挟まず、その位置の音源がすぐ鳴ります。

### MML への埋め込み

| 宣言 | 意味 |
| --- | --- |
| `#audio=<URL>` | 音源のURL（mp3 / wav / YouTube） |
| `#audiostart=<秒>` | 音源のどこから鳴らすか（省略時0） |
| `#audioend=<秒>` | 音源のどこで止めるか（省略時は最後まで） |
| `#audiooffset=<秒>` | 開始のずれ。正＝音源が先、負＝打ち込みが先（省略時0＝同時） |
| `#audiovol=<0-100>` | 音源の音量（省略時80） |

**アップロードしたファイルはMMLに含まれません**（受け取った相手の環境にそのファイルは無く、
`blob:` URLも他人からは開けないため）。URLが無いときは開始位置・音量ごと出力しません。

```
#audio=https://example.com/karaoke.mp3 #audiooffset=6.207 #audiovol=60;
@0 t120 o4 c d e f;
```

### 再生専用ビュー・埋め込み

`mountMmlPlayer`（`studio.mountPlayer` / 埋め込みプレイヤー）も `#audio=` を解釈して一緒に鳴らします。
URLで読み込んだ音源はMMLに載るので、共有したMMLを受け取った側でも伴奏付きで再生されます。
YouTubeのときはプレイヤー内に動画の枠が出ます。

### 制限

- ループ再生をONにしても、伴奏音源はループせずそのまま流れます。
- 曲の終わりは「打ち込みの終端」と「伴奏音源の終端」の遅いほうです（打ち込みが空でも音源だけ鳴らせます）。

---

## ライセンス

[MIT](./LICENSE)
