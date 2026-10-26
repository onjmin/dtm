# @onjmin/dtm

MML を中間言語に用いた、モバイルファーストな DAW / ピアノロール打ち込みコンポーネント。
楽器・ドラムに加え、UTAU 音源（[@onjmin/koe](https://www.npmjs.com/package/@onjmin/koe)）による歌声合成にも対応しています。

## デモ

- [DAW エディタ・プレイヤーデモ (demo/index.html)](https://onjmin.github.io/dtm/demo)
- [ヘッドレス再生・コード進行プレイヤーデモ (demo/bgm.html)](https://onjmin.github.io/dtm/demo/bgm.html)
- [API リファレンス（typedoc）](https://onjmin.github.io/dtm) ・ [npm](https://www.npmjs.com/package/@onjmin/dtm)

## インストール

```bash
npm i @onjmin/dtm
```

## クイックスタート

`createDtmStudio` は SoundFont（実行時に CDN から読む）・歌声合成（同梱の `dist/voice-worker.js`）・録音を内包した一番簡単な入口です。

```ts
import { createDtmStudio } from "@onjmin/dtm";

const studio = await createDtmStudio();

// 編集 UI（ピアノロール・音・歌声込み）
const daw = studio.mountEditor(document.getElementById("editor"), {
  initialMML: "@0 t120 o5 l8 ccggaag4 ffeeddc4",
});

// 再生専用 UI
studio.mountPlayer(document.getElementById("player"), daw.getMML().full);

// コード進行プレイヤー UI
studio.mountChordPlayer(document.getElementById("chord-player"), "| C | G | Am | F |");
```

オプションと戻り値の詳細は型定義（JSDoc）と API リファレンスにあります。

## 主な API

| API | 説明 |
| --- | --- |
| `createDtmStudio(options)` | 全部入りの入口。`mountEditor` / `mountPlayer` / `mountChordPlayer` / `playSingingMML` / `speak` / `setMasterVolume`（聴く人の音量）/ `getAudioStreamTrack`（録画用）を持つ |
| `mountDAW(target, options)` | 音を持たない編集 UI。`onPlayNote` / `onPlayDrum` に自前のシンセを繋ぐ低レベル版 |
| `mountMmlPlayer(target, mml, options)` | 再生専用 UI（トークンのハイライト・歌声・`#audio=` の同時再生） |
| `mountChordPlayer(target, chords, options)` | コード進行の再生 UI |
| `playMML(mml, options)` | 画面なし再生（ゲーム BGM 向け）。ループ範囲・キュー（`onCue`）に対応 |
| `playSingingMML(mml, options)` | 歌声トラック入り MML の画面なし再生 |
| `playChords(chords, options)` | コード進行の画面なし再生（`patternType` で弾き方を選ぶ） |
| `playNote(options)` | 単音の発音（SE・音高確認） |
| `TRACKS_SIMPLE` / `TRACKS_ADVANCED` | 4 トラックの初心者モード／15 トラックの上級者モードの構成（`mode` と組で渡す） |
| `startTour(options)` | ガイドツアー（スポットライト型の案内）。DAW と独立して使える |
| `createSingingVoices(...)` | 歌声合成エンジン（低レベル API で `singingVoices` に渡す） |
| `createBackingAudio(...)` | オーディオ同時再生（低レベル API で `backingAudio` に渡す） |
| `parseUst` / `buildUst` | UST（UTAU）の読み込み・書き出し |
| `exportMIDI` / `parseMusicXML` / `exportMusicXML` | MIDI・MusicXML の入出力 |
| `pitchV1ToUnits` / `unitsToHz` / `units` など | ピッチ単位の変換（下記） |

### ピッチの単位

ノートのピッチ `pitchUnits` は **1/372 オクターブの整数**（ブランド型 `Units`）です。12 平均律の 1 半音 = 31 units、31 平均律の 1 度 = 12 units、A4 = 2139 units。
MIDI ノート番号（`MidiNote`）とは型で区別され、変換は `pitchV1ToUnits` / `unitsToPitchV1` / `unitsToMidiDetune`、素の数値からは `units()` / `midiNote()` を使います。
ドラム（`PlayDrumEvent.pitch`・`DRUM_KEYS`）は GM 打楽器のキー番号のままです。

1.x からの移行: `Note.pitch` → `Note.pitchUnits`、`init(...)` → `createRenderer(...)`、`new MMLCore` は第 3 引数 `getConfig` が必須、`transposeNotes` は格子ステップ単位。

## MML 記法の要点

### 宣言（`#名前=値`）

| 宣言 | 意味 |
| --- | --- |
| `#inst=` / `#t<n>inst=` | 曲全体の楽器プリセット（`INSTRUMENT_PRESETS`）／トラック n の GM 楽器 |
| `#t<n>font=` | トラック n の音源バンク: `FluidR3`（既定）・`GeneralUserGS`・`Aspirin`・`SoundBlasterOld`・`JCLive`・`Chaos`・`SBLive` |
| `#reverb=` / `#reverbdecay=` / `#reverbpredelay=` | マスタリバーブの量（0-100）／長さ（3-40、×0.1 秒）／遅れ（0-150 ms） |
| `#delay=` / `#delaydiv=` | テンポ同期ディレイの量（0-100）／音価（`4` `8` `8d` `16`） |
| `#t<n>rev=` / `#t<n>dly=` | トラック n からリバーブ／ディレイへの送り（戻りが 0 だと鳴らない） |
| `#drum=` | ドラムパターン名。`none` と省略はドラム無し |
| `#edo=31` | 31 平均律（省略時 12 平均律） |
| `#audio=` / `#audiostart=` / `#audioend=` | 同時に鳴らす音源の URL（mp3 / wav / YouTube）と使う範囲（秒） |
| `#audiooffset=` / `#audiovol=` | 開始のずれ（秒。正＝音源が先）／音源の音量（0-100、既定 80） |

曲に書かれていない宣言は、読み込み・再生のたびに既定値へ戻ります。

```text
#inst=retro_game #reverb=30 #delay=15 #delaydiv=8d #t0font=GeneralUserGS #t0rev=40 #drum=none;
@0 t140 o5 l8 cdeg a4g4;
```

### 31 平均律の臨時記号

| 記号 | 31 平均律 | 12 平均律 |
|---|---|---|
| `#` / `-` | ±2 度（クロマチック半音） | ±1 半音 |
| `+` / `_` | ±1 度（微分音） | ±1 半音 |

幹音は `c`=0 `d`=5 `e`=10 `f`=13 `g`=18 `a`=23 `b`=28 度。記号は累積します（`c##` は +4 度）。

### 歌詞トラック（`@@n`）

```
@@<トラックID> <モデル> [v<声量>] [q<ゲート>] [p<定位>] [o<オクターブ>] <かな歌詞>
@0 t120 v100 o4g8 g8 e8 e8 f8 e8 d8 c8 g8 g8 e8 e8 d4.;
@@0 tsukuyomi どんぐりころころどんぐりこ;
```

モデルは `klatt`（内蔵合成）と UTAU 音源 `tsukuyomi` / `rino` / `roze` / `uc` / `ruko_male` / `ruko_female` / `teto` / `shiyo` / `rei` / `mgroid` / `motroid` / `nynroid`。
歌詞は 1 文字（拗音は 2 文字）＝ノート 1 つで対応します。

| 記号 | 意味 |
| --- | --- |
| `ー` / `〜` | 継続（言い直さずにピッチだけ変える／ポルタメント） |
| `っ` | 促音（ノートを消費して無音の閉鎖） |
| `_` | 休符（ノートを消費して歌わない） |
| `、` | ブレス（ノートを消費しない） |
| `「…」` | 語り。中身を話し声で読み上げ、ノートを 1 つ消費（UTAU 音源のみ） |

UST（UTAU）ファイルは「MIDI / UST / MML 入力」から音符と歌詞をまとめて読み込め、選択中のトラックを UST で書き出せます。

## ライセンス

[MIT](./LICENSE)
