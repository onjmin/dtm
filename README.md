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

const chordPlayer = studio.mountChordPlayer(chordEl, "| C | G | Am | F |", {
  volume: 80,
});
chordPlayer.setVolume(65);
```

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

### 2. コード進行ヘッドレス再生 (`playChords`)

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

> 歌声合成（`@@n` 歌詞トラック）はヘッドレス再生では未対応です（楽器・ドラムのみ）。
> 歌声が必要なら `mountMmlPlayer` / `createDtmStudio` を使ってください。

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
  `tsukuyomi` / `rino` / `roze` / `ruko_male` / `ruko_female` / `teto` / `shiyo`。
- `createDtmStudio` を使えば歌声は自動で配線されます。低レベル API で使う場合は
  `createSingingVoices` の戻り値を `mountDAW` / `mountMmlPlayer` の `singingVoices` に渡してください。

重い WORLD 再合成は専用 Web Worker で実行してメインスレッド（楽器・UI）を塞がず、複数ボーカルは音源ごとに並列合成されます。

---

## ライセンス

[MIT](./LICENSE)
