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

- モデルに `klatt` を指定すると内蔵フォルマント合成（音源ロード不要）。
- 内蔵 UTAU 音源（@onjmin/koe）キーワード:
  `tsukuyomi` / `rino` / `roze` / `uc` / `ruko_male` / `ruko_female` / `teto` / `shiyo` / `rei` / `mgroid` / `motroid` / `nynroid`。
- `createDtmStudio` を使えば歌声は自動で配線されます。低レベル API で使う場合は
  `createSingingVoices` の戻り値を `mountDAW` / `mountMmlPlayer` の `singingVoices` に渡してください。

重い WORLD 再合成は専用 Web Worker で実行してメインスレッド（楽器・UI）を塞がず、複数ボーカルは音源ごとに並列合成されます。

---

## ライセンス

[MIT](./LICENSE)
