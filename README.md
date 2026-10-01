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

31 平均律への対応で**ノートのピッチの単位が変わりました**。1.x からの更新には修正が必要です。

### ピッチの単位

`Note.pitch`（半音）が `Note.pitchUnits`（**1/372 オクターブの整数**）になりました。`NoteData` / `NoteRemove` / `PlayNoteEvent` / `MMLNotePlacement` / `ChordPlacement` も同様です。

```
12 平均律 1 半音 = 31 units      31 平均律 1 度 = 12 units
A4 (MIDI 69)   = 2139 units      1 unit ≒ 3.2258 セント
```

372 = 12 × 31 なので、両方の音律が誤差ゼロで同じ整数の数直線に乗ります。変換ヘルパを公開しています。

```ts
import { pitchV1ToUnits, unitsToPitchV1, unitsToHz, unitsToMidiDetune } from "@onjmin/dtm";

pitchV1ToUnits(60);          // 1860  … MIDI ノート番号 → units
unitsToPitchV1(1860);        // 60    … units → MIDI ノート番号（12 平均律でのみ無損失）
unitsToHz(2139);             // 440   … units → 周波数
unitsToMidiDetune(1968);     // { midi: 63, detuneCents: 48.39 }  … 31平均律の中立3度
```

`unitsToMidiDetune` は SoundFont のように整数 MIDI ノートのゾーンしか持たない音源向けで、最寄りのゾーンを鳴らして残差を `detune`（セント）で補正します。

> **`PlayDrumEvent.pitch` と `DRUM_KEYS` は変更していません。** GM 打楽器のキー番号なので、units へ変換すると全ドラムが壊れます。

### 単位はブランド型で区別されます

`pitchUnits` の型は **`Units`**、MIDI ノート番号は **`MidiNote`** で、素の `number` とも互いとも代入できません。素の数値からは `units()` / `midiNote()` を通してください。

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

次のような単位の取り違えはコンパイルエラーになります。

```
units を SoundFont の pitch へ    → Units is not assignable to MidiNote
units に半音の 12 を足す           → number is not assignable to Units
MidiNote を units の関数へ         → MidiNote is not assignable to Units
```

ただし**比較演算は検出できません**（`pitchUnits < 48` は通ります）。ピッチと数値を比べる箇所は単位を目で確認してください。

### その他の破壊的変更

| 1.x | 2.0.0 |
|---|---|
| `init(target, w, h, config)` | `createRenderer(target, w, h, config)` が描画器インスタンスを返す |
| `new MMLCore(handlers, volume)` | 第 3 引数に `getConfig: () => RenderConfig` が必要 |
| `transposeNotes(cores, semitones)` | `transposeNotes(cores, steps)` — 単位は格子 1 ステップ |

`createRenderer` により、1 ページに複数のエディタをマウントできるようになりました。`transposeNotes` は 12 平均律では 1 ステップ＝1 半音なので、呼び出し側の値はそのままで動きます。

### 協調編集

`onNotesPatch` / `applyPatch` の `pitchUnits` は 1.x と意味が異なり、新旧クライアントが混ざると**黙って別の音になります**。バージョンの突き合わせは利用側アプリのハンドシェイクで行ってください。

```ts
import { PITCH_ENCODING_VERSION } from "@onjmin/dtm"; // 2 (1.x は 1 相当)
```

v1 → v2 の変換は無損失ですが、v2 → v1 は 12 平均律の曲でのみ無損失です（31 平均律は半音へ丸めると最大 48.4 セント動きます）。

---

## クイックスタート（全部入り `createDtmStudio`）

楽器・ドラムの SoundFont、歌声合成、録音までを内包した一番簡単な入口です。SoundFont は実行時に CDN から読み込み、歌声合成ワーカーは同梱の `dist/voice-worker.js` を使います。

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

音量は 0-100 で指定します。

- DAW 系 API（`createDtmStudio` / `mountDAW` / `mountEditor` など）は `masterVolume`。
- ヘッドレス再生 API（`playMML` / `playChords` / `mountChordPlayer`）は `volume`。
- 再生中の変更は各インスタンスの `setVolume()`。

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

`masterVolume` / `volume` は**曲データの音量**で、MML の `#volume=` と往復し、`daw.loadMML()` のたびに上書きされます。読者がサイト全体の音量を調整する用途には `studio.setMasterVolume()` を使ってください。全インスタンス（`mountEditor` / `mountPlayer` / `mountChordPlayer` / `playSingingMML`）が合流する `studio.masterGain` を動かすので、曲データや `loadMML()` の影響を受けません。

```ts
const studio = await createDtmStudio();

// 読者側の「サイト全体の音量」— 曲を跨いで一度だけ管理すればよい
studio.setMasterVolume(userPreferredVolume); // 0-100

// 曲側の masterVolume/volume には触れない（#volume= が持つ作曲者の意図をそのまま尊重する）
const daw = studio.mountEditor(editorEl, { initialMML: mml });
const player = studio.mountPlayer(playerEl, mml);
```

`DawInstance.setMasterVolume` / `MmlPlayerOptions.masterVolume` は曲の音量、`DtmStudio.setMasterVolume` は聴く人の音量で、同名でも別物です。

---

## 録音・動画エンコード用音声ストリームの取得 (`MediaStream`)

動画（MP4 / WebM）の書き出しや `MediaRecorder` での録音には、`studio` から音声トラックを取得します。

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

`createDtmStudio({ destination })` に `MediaStreamAudioDestinationNode` や自前の `GainNode` を渡すことも、`studio.masterGain` を自作のエフェクトやミキサーへ繋ぐこともできます。

---

## 再生機能・API 一覧

| 関数名 | UI描画 (DOM) | 歌声対応 (`@@n`) | 戻り値 | 主な用途と効果 |
| --- | --- | --- | --- | --- |
| `playMML(mml, options)` | 不要 | 非対応 | `MmlPlayback` | 楽器・ドラムの MML ヘッドレス再生。軽量内蔵シンセで BGM シームレスループや Cues 同期イベントを発火。 |
| `playSingingMML(mml, options)` | 不要 | **対応** | `Promise<MmlPlayback>` | 歌声付き MML のヘッドレス再生。`.koe` / `klatt` 歌声モデルをプリロードし、伴奏と同期再生。 |
| `playChords(chordStr, options)` | 不要 | 非対応 | `MmlPlayback` | コード進行のヘッドレス再生。`"\| C \| G \| Am \| F \|"` などの文字列から伴奏音を鳴らす。 |
| `playNote(options)` | 不要 | 非対応 | `void` | 簡易単音発音。SE や音高確認用。 |
| `mountMmlPlayer(target, mml, options)` | **必要** | **対応** | `MmlPlayerInstance` | 再生専用 UI。トークン帯のハイライト、オートスクロール、歌声キャラクター表示。 |
| `mountChordPlayer(target, chordStr, options)` | **必要** | 非対応 | `ChordPlayerInstance` | コード進行再生 UI。コードネーム表示と試聴操作。 |
| `createDtmStudio()` / `mountEditor` | **必要** | **対応** | `DtmStudio` / `DawInstance` | フル機能ピアノロールエディタ。SoundFont 演奏、打ち込み編集、歌声合成、録音。 |

---

## MML の宣言（音色・残響・ドラム）

MML の先頭などに `#名前=値` で書く宣言のうち、音の質感に効くもの（抜粋）。宣言は音符としては読まれず、エディタの書き出し・読み込みで往復します。

| 宣言 | 値 | 意味 |
| --- | --- | --- |
| `#inst=` | 楽器プリセット名 | 曲全体の楽器プリセット（`INSTRUMENT_PRESETS` のキー）。 |
| `#t<n>inst=` | GM 楽器名 | トラック n（`@n`）だけ楽器を差し替える。 |
| `#t<n>font=` | 音源バンク | トラック n の楽器を鳴らす**音源データ**。GM 番号はそのままで質感だけが変わる。省略時は FluidR3 GM。 |
| `#reverb=` | 0-100 | マスタリバーブの掛かり具合（戻り）。 |
| `#reverbdecay=` | 3-40（×0.1 秒） | マスタリバーブの残響の長さ。省略時 22（2.2 秒）。 |
| `#reverbpredelay=` | 0-150（ms） | マスタリバーブの立ち上がりの遅れ。 |
| `#delay=` | 0-100 | マスタディレイ（テンポ同期のエコー）の掛かり具合。 |
| `#delaydiv=` | `4` / `8` / `8d` / `16` | マスタディレイの音価。省略時 `8`。 |
| `#t<n>rev=` / `#t<n>dly=` | 0-100 | トラック n からマスタリバーブ／ディレイへの送り量。**戻り（`#reverb=` / `#delay=`）が 0 だと鳴らない。** |
| `#drum=` | パターン名 / `none` | ドラムパターン。`none` と省略はどちらもドラム無し。 |

`#t<n>font=` の値は次の正式名・短縮名（大小文字は問わない）。どれも [webaudiofontdata](https://surikov.github.io/webaudiofontdata/) の GM 128 音色を持ちます。指定したバンクにその楽器が無い・読めないときは、警告を出して FluidR3 で鳴らします。

| 短縮名 | 正式名 |
| --- | --- |
| `FluidR3` | `FluidR3_GM_sf2_file`（既定） |
| `GeneralUserGS` | `GeneralUserGS_sf2_file` |
| `Aspirin` | `Aspirin_sf2_file` |
| `SoundBlasterOld` | `SoundBlasterOld_sf2` |
| `JCLive` | `JCLive_sf2_file` |
| `Chaos` | `Chaos_sf2_file` |
| `SBLive` | `SBLive_sf2` |

```text
#inst=retro_game #reverb=30 #reverbdecay=28 #delay=15 #delaydiv=8d #t0font=GeneralUserGS #t0rev=40 #t0dly=20 #t2font=SBLive #drum=none;
@0 t140 o5 l8 cdeg a4g4;
@2 o3 c2 g2;
```

- **再生でも効きます。** `studio.play` / `studio.mountPlayer` / `studio.playSingingMML` は再生のたびに曲のリバーブ／ディレイ宣言を反映し、ディレイを曲の BPM に合わせます。書かれていない項目は `createDtmStudio` のオプション（`reverbAmount` 等、既定 0）へ戻るので、前の曲の設定は持ち越されません（`studio.setReverbAmount` 等で変えた値も、次の再生で曲の値に置き換わります）。
- エディタへ曲を読み込んだときも同じで、曲に無い項目はエディタの初期値へ戻ります（現在のトラックだけの部分読み込みを除く）。
- ドラム無しの曲を読み込むとドラム選択は「なし」になり、書き出しでは `#drum=none` と明示します。
- studio を使わない `playMML`（内蔵の簡易シンセ）では `#t<n>font=` は効きません。

---

## ヘルプとガイドツアー

編集 UI には**ヘルプ（`?`）ボタン**と**目的別のガイドツアー**が同梱されています。

### 何が出るか

- **`?` ボタン**（ツールバー右） … 使い方モーダル。画面各所の `ⓘ` 解説を 1 か所から辿れます。既定で表示（`showHelp: false` で消せます）。
- **ガイドツアー** … 対象要素をスポットライトして吹き出しで説明するウォークスルー。冒頭で目的を尋ね、選んだ枝だけを案内します。

| 枝 | 案内する内容 |
| --- | --- |
| カバー曲を作りたい | オーディオ同時再生へ音源を読み込む → 開始のずれで頭を合わせる → 範囲を切り出す → ミュートで聴き比べる → 重ねて打ち込む |
| 曲を自動で作りたい | 作曲ボタン → 構成テンプレ → 雰囲気（調） → 再生 → おまかせマスタリング |
| 自分で打ち込みたい | ピアノロール → ツール／音符の長さ → トラックタブ → 再生 → 楽器・音量 |

**自動再生は既定でオフです。** 初回に流したいときだけ明示的に有効化します。

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

存在しない UI を指すステップは自動で飛ばされます（`features.midi: false` など）。枝も `when` で出し分けられます。

### 単体で使う

ツアーエンジンは `mountDAW` に依存しない DOM ユーティリティで、自分のアプリの UI にも使えます。

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
| 閉じた `<details>` の中の対象 | 自動で開き、ツアー終了時に閉じ直す |
| キーボード | `←` `→` で移動、`Esc` で中断 |
| 暗幕のクリック | 進まない（誤タップ防止） |
| 画面幅 | 吹き出しは画面幅に合わせて縮み、対象の上下で入る方へ回り込む |

---

## モード（`simple` / `advanced`）

`mode` オプションで切り替え、対応するトラック構成（`TRACKS_SIMPLE` / `TRACKS_ADVANCED`）を `tracks` に渡します。

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

- `mode` を省略すると `tracks` の本数から推論します（4 本以下→`simple` / 5 本以上→`advanced`）。意図とずれる場合は明示してください。
- `tracks` には独自構成も渡せます。`mode` / `tracks` は `mountDAW` でも同じく指定できます。
- MIDI のドラム（ch10）はピアノロールで編集できないため、取り込み時のトラック選択 UI には出ません。

### 備考: トラック採番と MIDI チャンネルの対応（暫定仕様）

`advanced` の `@n` / タブ名は MML に合わせたフラットな連番（`@0`〜`@14` / TRACK 01〜15）です。ch10＝ドラムの扱いは MIDI 入出力の変換時にだけ行います。

- **出力**: ドラム ch を避けて TRACK 01〜09 → ch1〜9、**TRACK 10〜15 → ch11〜16** に書き出します。
- **入力**: ch10（ドラム）のノートは取り込みません。選択したトラックは**選択順に上から**レーンへ詰めます。
- ドラムはノートレーンではなく、別系統の**ドラム設定**で編集します。

### 上級者モード切替の確認ダイアログ（`onRequestAdvancedMode`）

初心者モードで次のものを読み込むと、上級者モードへの切り替えを確認するダイアログが出ます。

- 5 トラック以上（ドラム除く）の MML / MIDI
- 選択中のトラックから順に入れるとトラックが足りない本数の UST

「はい」で上級者モードに切り替えてそのまま引き継ぎ、「いいえ」で初心者モードのまま（トラックを合算して）読み込みます。`mountModeSwitch` を使っていれば設定不要です。`mountDAW` を直接使う場合は `onRequestAdvancedMode` を接続してください。

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

- 渡さない場合はダイアログを出さず、合算して読み込みます。
- MML 読み込みでは `pendingMml` が渡ります。`initialMML` か `daw.loadMML(pendingMml)` で適用します。
- MIDI 読み込みでは `applyMidi` が渡ります。新しい DAW を生成した直後に `applyMidi(newDaw)` を呼びます。

---

## ヘッドレス再生（画面なし再生 API）

MML 文字列やコード進行を渡して音だけを鳴らす関数群です。ゲームの BGM 向けです。

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

- 発音は先読みで予約するので、メインスレッドが重くても音切れしにくいです。
- 内部で AudioContext を作ったときは、タブが非アクティブになると自動で一時停止し、復帰で再開します。
- `audioContext` / `destination` を注入すると既存のミキサーへ繋げます。その場合の自動停止は既定 OFF で、`bgm.suspend()` / `bgm.resume()` を呼び出し側から使えます。

```ts
const bgm = playMML(mml, {
  audioContext: myCtx,        // ゲーム側の AudioContext を共有
  destination: myMasterGain,  // 自前のマスターGain/ミキサーへ
  // 自前シンセを使うなら onPlayNote を渡す（内蔵 square synth は自動で無効）
  onPlayNote: ({ pitch, volume, when, duration }) => mySynth.play(...),
});
```

#### 高度なループ設定 & 再生キュー（ゲーム同期）

イントロ付きループや、曲の特定位置でのイベント発火ができます。

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

歌声トラック（`@@n`）を含む MML を画面なしで再生します。歌声モデル（`klatt` / `.koe`）のプリロードを待つため `Promise<MmlPlayback>` を返します。ループ時も伴奏と歌声は同期します。

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

### 3. コード進行ヘッドレス再生 (`playChords`)

コード進行テキストから伴奏パターン（軽量シンセ）を鳴らします。

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

| `patternType` | 演奏 |
| --- | --- |
| `"block"` | 構成音を同時に伸ばす |
| `"arpeggio"` | 構成音を低い順に分散 |
| `"arpeggio-fast"` | 素早く分散 |
| `"offbeat"` | 裏打ち（2/4拍目） |
| `"yatsume"` | 八つ目 |
| `"alternating"` | 交互に伴奏音を鳴らす |

---

## 低レベル API（`mountDAW` / `mountChordPlayer` / 注入式）

本体は音を持たず、`onPlayNote` / `onPlayDrum` に自前のシンセを繋ぎます（`createDtmStudio` はこの配線を内包したもの）。

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

`#edo=31` を宣言すると、その曲を 1 オクターブ 31 分割で扱います。省略時は 12 平均律で、既存の MML の解釈は変わりません。

```
#edo=31 @0 t120 o4 c c+ c# d- d_ d e_ e;
```

音律は**曲単位**で、トラックごと・小節ごとには変えられません。

### 臨時記号

| 記号 | 31 平均律 | 12 平均律 | 意味 |
|---|---|---|---|
| `#` | +2 度 | +1 半音 | クロマチック半音上げ（従来のシャープ） |
| `-` | −2 度 | −1 半音 | クロマチック半音下げ（従来のフラット） |
| `+` | +1 度 | +1 半音 | 格子 1 ステップ上げ（微分音） |
| `_` | −1 度 | −1 半音 | 格子 1 ステップ下げ（微分音） |

12 平均律では 4 記号とも従来のシャープ／フラットとして働きます。記号は累積し（`c##` は +4 度）、幹音は `c`=0 `d`=5 `e`=10 `f`=13 `g`=18 `a`=23 `b`=28 度です。全 31 度の綴り:

```
   0:c     1:c+    2:c#    3:d-    4:d_    5:d     6:d+    7:d#
   8:e-    9:e_   10:e    11:f-   12:e#   13:f    14:f+   15:f#
  16:g-   17:g_   18:g    19:g+   20:g#   21:a-   22:a_   23:a
  24:a+   25:a#   26:b-   27:b_   28:b    29:b+   30:b#
```

`^` はタイとして定着しているため微分音には使いません。

### 何が変わるか

- **ピアノロール**: 1 オクターブが 31 段（全体 328 行）になります。鍵盤は幹音／微分音／クロマチックの 3 階層で、縦ズーム（50〜200%）で調整できます。
- **和音**: コード進行入力は 31 平均律の格子へ写され、長 3 度が純正に近くなります。増 4 度と減 5 度も区別されます。
- **歌声**: 31 平均律の音もそのまま歌います。
- **MIDI 書き出し**: ピッチベンドの多チャンネル方式（感度 ±2 半音）で書き出します。dtm 同士なら無損失ですが、マルチチャンネルを潰す DAW では再現されません。ベンド値が 15 種類を超えると、頻度の低いものから半音へ丸めます。
- **コード名の自動検出**: 12 平均律へ丸めて判定するため近似です。三和音・七の和音は正しく出ますが、中立 3 度などの固有音程は別のコードに誤認されます。

---

## 歌声合成（歌詞トラック `@@n`）

演奏トラック `@n` とは別に歌詞行 `@@n` を書くと、そのトラックのノートに合わせて 1 音節ずつ歌います。

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
| `ー` | **継続**。言い直さずに音を保ち、ピッチだけを切り替える | `あーーーー` |
| `〜` | **継続（ポルタメント）**。`ー` と同じだがピッチを滑らかに繋ぐ | `あ〜〜` |
| `っ` | **促音**。ノートを消費し、無音の閉鎖を作る | `がっこう` |
| `_` | **休符**。ノートを消費するが歌わない | `あ_い` |
| `、` | **ブレス**。ノートは消費せず、直前ノートの尻を削って息継ぎを入れる | `あー、いー` |
| `ガ` / `が゜` | **鼻濁音**。音源に鼻濁音があればそれで、無ければふつうのガ行 | `カガミ` |
| `ヴァ` | **ヴ**。音源に `ヴぁ` / `ヴァ` の素片があればそれで、無ければバ行で近似 | `ヴァイオリン` |
| `「…」` | **語り**。囲んだ部分を読み上げる。ひとかたまりでノートを 1 つ消費（下記） | `あ「こんにちは」い` |

`〜` は `～`（全角チルダ）でも、`、` は `,` でも書けます。

```
@0 t120 o4 c8 d8 e8 f8 g8;
@@0 tsukuyomi あああああ;   ← 5 回それぞれ言い直す（従来どおり）
@@0 tsukuyomi あーーーー;   ← 1 つの「あ」を保ったままピッチだけ動く
```

継続は直前の音節の母音を引き継ぎます（`きょー` は `きょ` + `お`、`んー` はハミング）。休符 `_`・ブレス `、`・旋律側の休符（0.15 秒以上の隙間）の次は語頭として歌います。

> **`ー` `っ` の扱いが 2.0 系から変わりました。** 以前は歌詞から除去していたため `きょーと` はノート 2 つでしたが、現在は 3 つです。`ー` `っ` を含む既存の曲は歌詞かノートの調整が必要です。

### 歌の中で語る（`「…」` 語り）

歌詞の途中を `「…」` で囲むと、その部分を**話し声で読み上げ**ます（UtauTTS）。

```
@0 t120 o4 g8 g8 e8 e8 f8 e8 d8 c8 r2 c2 g8 g8 e8 e8 d4.;
@@0 tsukuyomi どんぐりころころ「みなさん、こんにちは！」どんぐりこ;
```

| 要素 | 扱い |
| --- | --- |
| `「…」` ひとかたまり | ノートを **1 つ**消費し、その位置から話し始める |
| 中身 | 漢字・数字・句読点可。`？` で終わると語尾が上がる |
| ノートの長さ | 使わない。長さは読み上げが決める（ピアノロールに破線の帯で表示） |
| ノートの音高 | 話す声の高さ。「語りの基準」の行に置くと素の声 |
| 空の `「」` | `_` と同じ（1 ノート消費して無音） |
| 閉じ括弧なし | 行末までを語りにする |
| 直後の `ー` | 落ちる。次の音節は語頭として歌う |

- 半角の `｢｣` も使えます。中身に `;` と改行は書けません。
- klatt では鳴りません（UTAU 音源のみ）。
- 初回に UtauTTS のアセット（約 45MB）を取得して Cache API に保存します。配信元は `createDtmStudio({ ttsBaseUrl })` / `createSingingVoices({ ttsBaseUrl })` で変えられます（既定 `https://onjmin.github.io/koe/demo/utautts/`）。
- WAV 書き出しにも入ります。

### モデルと音源

- `klatt` … 内蔵フォルマント合成（音源ロード不要）。
- 内蔵 UTAU 音源（@onjmin/koe）: `tsukuyomi` / `rino` / `roze` / `uc` / `ruko_male` / `ruko_female` / `teto` / `shiyo` / `rei` / `mgroid` / `motroid` / `nynroid`。
- `createDtmStudio` なら自動で配線されます。低レベル API では `createSingingVoices` の戻り値を `mountDAW` / `mountMmlPlayer` の `singingVoices` に渡します。

合成は Web Worker で行うため、メインスレッドを塞ぎません。

### MML を介さない読み上げ（`studio.speak`）

セリフやナレーションを曲の外で読み上げるには `studio.speak` を使います。`「…」` 語りと同じ合成で、「今」から鳴らします。

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
| `pitchOffset` | 素の声からの半音オフセット。既定 0 |
| `emotion` | `"neutral"` / `"happy"` / `"sad"` / `"angry"`。既定 neutral。初めて使う感情は約 2MB を取得してから鳴る |
| `style` | 話し方プリセット `"neutral"` / `"calm"`（朗読調）/ `"lively"`、またはプリセット＋上書き `{ preset: "calm", speed: 0.95 }`（koe の `SpeakingStyleInput`） |
| `expr` | 声色 `{ gender, breathiness, tension }` |
| `volume` / `pan` | ピーク音量（0〜1）と定位（-1〜1） |
| `at` | 最初のモーラを鳴らす AudioContext クロック秒。省略時は `awaitRender` の待ちが済みしだい。過去の値は今に丸める |
| `awaitRender` | 鳴らし始める前に待つ範囲。`false`（既定。**頭が欠けることがある**）/ `"first-chunk"`（セリフ向け）/ `true`（全チャンク） |
| `minBufferSec` | `"first-chunk"` のとき、鳴らし始める前に合成しておく秒数。既定 0。行の途中に間が空くなら 0.3〜0.5 |
| `lateChunks` | 遅れて届いたチャンクの扱い。`"shift"`（時間軸ごと後ろへずらす）/ `"skip"`（過ぎたぶんを飛ばす）。既定は `"first-chunk"` なら `"shift"`、それ以外は `"skip"` |
| `signal` | `AbortSignal`。計画中なら null を返し、再生中なら止める |

戻り値の `SpeechHandle` は `durationSec` / `startTime`（最初のモーラが鳴る時刻）/ `morae` / `shiftSec` / `position()` / `stop()` / `ended` を持ちます。`stop()` はその発話だけを止めます。読めない本文や未知のモデルでは `null` です。

鳴らさずに長さとモーラ列（口パク・字幕送り用）だけ知りたいときは `studio.planSpeech` を使います。同じものが `SpeechHandle.morae` にも入ります。

```ts
const info = await studio.planSpeech("こんにちは。", { model: "tsukuyomi", emotion: "happy" });
// info: { durationSec: 1.2, morae: [{ startSec: 0, endSec: 0.11, mora: "こ", vowel: "o" }, …] } | null
```

低レベル API では `createSingingVoices(...).speak(model, text, options)` / `.prepareSpeech(models, { onProgress })` が同じものです。音源名のラベルには `KOE_VOICEBANK_NAMES`（キーワード → 音源名）が使えます。

`groupVoiceModels(names)` は音源一覧を大分類（`<optgroup>`）に分けます。分類は mountDAW の歌唱モデル選択と同じ（`VOICE_MODEL_CATEGORIES`）です。渡した一覧に載っているキーだけを返すので、読み上げ用なら `KOE_VOICEBANK_NAMES`、歌唱用なら `klatt` を足した一覧を渡します。分類に無いキーは末尾の「その他」に入ります。

```ts
const groups = groupVoiceModels(KOE_VOICEBANK_NAMES);
// [{ label: "kusaプリセット", models: [{ value: "tsukuyomi", label: "つくよみちゃん" }] }, …]
```

#### 頭から鳴らす・文字送りを声と揃える（`awaitRender: "first-chunk"`）

音はチャンク（数モーラずつ）ごとに後から届きます。

| `awaitRender` | 挙動 |
| --- | --- |
| `false`（既定） | 最初のチャンクが間に合わないと**頭が欠けます**（遅い音源では数秒）。**セリフには使わないでください** |
| `true` | 欠けないが、長文ほど鳴り出しが遅れる |
| `"first-chunk"` | 最初のチャンクができたら頭から鳴らす。後続が遅れたら時間軸ごと後ろへずらし（`ended` もそのぶん延びる）、言葉は欠けない |

`"first-chunk"` で行の途中に間が空くときは `minBufferSec: 0.4` のように少し貯めてから鳴らすと減ります。文字送りや口パクは `position()`（`morae` と同じ軸の再生位置。合成待ちの間は進まない）と比べれば、ずれがあっても音と揃います。

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

`awaitRender: false` かつ `lateChunks: "shift"` のときだけ、`startTime` は最初のチャンクが届くまで見込みの値です（読むたびに今の値を返す getter）。

---

## UST（UTAU）の読み込み・書き出し

UTAU の `.ust` を**音符と歌詞をまとめて**取り込めます。UI は「MIDI / UST / MML 入力」パネルの UST 欄、書き出しは「MIDI / UST / MML 出力」の「UST 出力」です。

### 読み込み

- **複数ファイルを一度に選べます**。選択中のトラックから順に 1 ファイルずつ割り当て、あぶれたぶんは読み込まずに件数を表示します。
- 並び順はファイル名順です（`01_main.ust` / `02_harmony.ust` のように番号を付けると狙った順に入ります）。
- 文字コードは Shift_JIS / UTF-8 を自動判別し、BPM は UST の `Tempo` に合わせます。
- 歌う音源（`lyricModel`）が未選択のトラックには自動で 1 つ割り当てます。
- MIDI 読み込みと違い**全消去はしません**。伴奏を残したままパートだけ差し替えられます。
- 「現在のトラックのみ対象とする」が有効なときは、先頭の 1 ファイルだけを読み込みます。

歌詞は 1 ノート 1 音節へ落とします。

| UST の `Lyric` | 取り込み結果 |
| --- | --- |
| `か` / `カ` | `か`（カタカナはひらがなへ寄せる） |
| `a か` / `- か`（連続音） | `か`（空白区切りの最後の語が実体） |
| `かC4` / `か強`（サフィックス付き） | `か`（先頭のかな列だけ） |
| `ka` / `kya` / `shi`（ローマ字命名） | `か` / `きゃ` / `し` |
| `R` | 休符（ノートを作らず位置だけ進む＝ピアノロールの隙間） |
| `+`（前の歌詞を続ける） | 継続記号 `ー` |
| 読み取れない綴り（CVVC の `a k` など） | 継続記号 `ー`（件数は UI に表示） |

### 書き出し

「UST 出力」は**選択中のトラック 1 本だけ**を書き出します。和音・重なりは先勝ちで 1 本へ潰し、隙間は `R` ノートにします。UTF-8（`Charset=UTF-8` 付き）・CRLF で、31 平均律の微分音は最寄りの半音へ丸めます。

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

音声ファイル・URL・YouTube の URL を打ち込みと**一緒に鳴らせます**（カラオケ音源に合わせた打ち込み、ハモリ作りなど）。UI は「オーディオ同時再生」パネルです。

`createDtmStudio().mountEditor` なら自動で配線されます。`mountDAW` を直接使う場合は `backingAudio` に `createBackingAudio(...)` の戻り値を渡してください（渡さないとパネルごと出ません）。

### 同期のしかた

| 読み込み方 | 鳴らし方 | 精度 | WAV書き出し・録音 |
| --- | --- | --- | --- |
| ファイル | デコードして `AudioBufferSourceNode` | サンプル単位 | **入る** |
| URL（CORS可） | 同上 | サンプル単位 | **入る** |
| URL（CORS不可） | `<audio>` 直接再生＋ドリフト補正 | 実測で数ms | 入らない |
| YouTube | IFrame Player API＋ドリフト補正 | 数十ms | 入らない |

### 鳴り始めの遅れ（初回再生でズレる問題）

鳴り出しの遅れは実測して自動で補正します。`<audio>` 直接再生は再生直後から ±15ms 以内、YouTube は約 1 秒で ±5ms に収束します。YouTube は「音源が先・n秒」指定なら最初の音符から正確に合います。

### 音源の範囲（いらないパートを飛ばす）

**開始**〜**終了** で音源の使う範囲を決めます。`0:12.500`（分:秒.ミリ秒）や `12.5`（秒）で書けます（終了は空欄で最後まで）。

### 開始のずれ（どちらが何秒先に始まるか）

「**［音源／打ち込み］が先、［n秒］後にもう一方が始まる**」の 2 項目で指定します。

| 指定 | 鳴り方 |
| --- | --- |
| 音源が先・0秒 | 同時に始まる（既定） |
| 音源が先・n秒 | 音源を先に鳴らし、n秒後に打ち込みが入る（前奏の長い音源に合わせる） |
| 打ち込みが先・0秒 | 同時に始まる |
| 打ち込みが先・n秒 | 打ち込みが先に鳴り、n秒後に音源が入る（曲の途中から音源を重ねる） |

ずれるのは再生の開始時刻だけで、音符は動きません。再生中に変えるとその場で合わせ直します。

### MML への埋め込み

| 宣言 | 意味 |
| --- | --- |
| `#audio=<URL>` | 音源のURL（mp3 / wav / YouTube） |
| `#audiostart=<秒>` | 音源のどこから鳴らすか（省略時0） |
| `#audioend=<秒>` | 音源のどこで止めるか（省略時は最後まで） |
| `#audiooffset=<秒>` | 開始のずれ。正＝音源が先、負＝打ち込みが先（省略時0＝同時） |
| `#audiovol=<0-100>` | 音源の音量（省略時80） |

**アップロードしたファイルは MML に含まれません**（相手の環境から開けないため）。URL が無いときは開始位置・音量ごと出力しません。

```
#audio=https://example.com/karaoke.mp3 #audiooffset=6.207 #audiovol=60;
@0 t120 o4 c d e f;
```

### 再生専用ビュー・埋め込み

`mountMmlPlayer`（`studio.mountPlayer` / 埋め込みプレイヤー）も `#audio=` を解釈して一緒に鳴らすので、共有した MML は受け取った側でも伴奏付きで再生されます。YouTube のときはプレイヤー内に動画の枠が出ます。

### 制限

- ループ再生をONにしても、伴奏音源はループせずそのまま流れます。
- 曲の終わりは「打ち込みの終端」と「伴奏音源の終端」の遅いほうです（打ち込みが空でも音源だけ鳴らせます）。

---

## ライセンス

[MIT](./LICENSE)
