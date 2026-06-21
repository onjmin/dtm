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

`onPlayNote` / `onPlayDrum` を省略すると無音で編集だけできます。`parseMidi` を渡すと MIDI 読込 UI が、
`parseChord` / `parseChords` を渡すとコード進行入力 UI が有効になります。
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
