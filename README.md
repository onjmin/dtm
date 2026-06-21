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
| `advanced` | TRACK 01〜16 の 16 本 | MIDI トラックを**1:1 マッピング** | なし（全トラックが通常のノート＋歌詞トラック） |

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

## 歌声合成（歌詞トラック `@@n`）

演奏トラック `@n` とは別に歌詞専用行 `@@n` を書くと、そのトラックの Note On に合わせて
1 音節ずつ歌わせられます。

```
@@<トラックID> <モデル> [v<声量>] [q<ゲート>] [p<定位>] [o<オクターブ>] <かな歌詞>

例:  @0 t120 o5 l4 cdefg
     @@0 roze ちょうちょうちょう
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
