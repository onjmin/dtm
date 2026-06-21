# @onjmin/dtm
MML を中間言語に用いた、モバイルファーストな DAW / ピアノロール打ち込みコンポーネント。
楽器・ドラムに加え、UTAU 音源（[@onjmin/koe](https://www.npmjs.com/package/@onjmin/koe)）による歌声合成にも対応。

- [DEMO](https://onjmin.github.io/dtm/)
- [npm](https://www.npmjs.com/package/@onjmin/dtm)

## インストール

```bash
npm i @onjmin/dtm
```

## クイックスタート（全部入り `createDtmStudio`）

楽器・ドラムの SoundFont、歌声合成、録音までを内包した一番簡単な入口。SoundFont は実行時に
CDN から動的 import し、歌声合成ワーカーは同梱の `dist/voice-worker.js` を使う（差し替え可能）。

```ts
import { createDtmStudio } from "@onjmin/dtm";

const studio = await createDtmStudio();

// 編集UI（ピアノロール・音・歌声込み）
const daw = studio.mountEditor(document.getElementById("editor"), {
  initialMML: "@0 t120 o5 l8 ccggaag4 ffeeddc4",
});

// 再生専用UI（MML を渡すだけ）
studio.mountPlayer(document.getElementById("player"), daw.getMML().full);
```

## モード（`simple` / `advanced`）

トラック構成と MIDI の取り込み方が異なる 2 つのモードがあります。`mode` オプションで切り替え、
合わせて `tracks` に対応するトラック構成（`TRACKS_SIMPLE` / `TRACKS_ADVANCED`）を渡します。

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

## 低レベル API（`mountDAW` / 注入式）

本体は音を持たない設計で、`onPlayNote` / `onPlayDrum` に自前のシンセを繋ぐ
（`createDtmStudio` はこの配線を内包したもの）。

```ts
import { mountDAW } from "@onjmin/dtm";

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

daw.play();
daw.getMML();   // { full, minified }
daw.destroy();
```

`onPlayNote` / `onPlayDrum` を省略すると無音で編集だけできます。`parseMidi` を渡すと MIDI 読込 UI が有効になります。また、コード進行入力 UI は標準で有効です（内部的に `@onjmin/chord-parser` を使用しています）。
再生専用ビューが必要なら `mountMmlPlayer` を使います。

## ヘッドレス再生（ゲーム BGM 向け `playMML`）

画面を一切持たず、MML 文字列を渡して音だけを鳴らす関数。`mountMmlPlayer` のような
DOM ビューは作らないので、ゲームの BGM のように「鳴らして・止める」用途に向きます。

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

> 歌声合成（`@@n` 歌詞トラック）はヘッドレス再生では未対応です（楽器・ドラムのみ）。
> 歌声が必要なら `mountMmlPlayer` / `createDtmStudio` を使ってください。

## 歌声合成（歌詞トラック `@@n`）

演奏トラック `@n` とは別に歌詞専用行 `@@n` を書くと、そのトラックの Note On に合わせて
1 音節ずつ歌わせられます。

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

重い WORLD 再合成は専用 Web Worker で実行してメインスレッド（楽器・UI）を塞がず、
複数ボーカルは音源ごとに並列合成されます。

## ライセンス
[MIT](./LICENSE)
