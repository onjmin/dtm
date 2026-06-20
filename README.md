# @onjmin/dtm
MML を中間言語に用いた、モバイルファーストな DAW / ピアノロール打ち込みコンポーネント。

- [DEMO](https://onjmin.github.io/koe/demo)
- [npm](https://www.npmjs.com/package/@onjmin/dtm)

## インストール

```bash
npm i @onjmin/dtm
```

## 使い方

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

`onPlayNote` / `onPlayDrum` を省略すると無音で編集だけできます。`parseMidi` を渡すと MIDI 読込 UI が、`parseChord` / `parseChords` を渡すとコード進行入力 UI が有効になります。

## ライセンス
[MIT](./LICENSE)
