# dtm
MML を中間言語に用いた、**モバイルファースト**な DAW / ピアノロール打ち込みコンポーネント。

`mountDAW()` を1回呼ぶだけで、スマホでもそのまま使えるDAW UI（マルチトラック編集・再生・MIDI/MML入出力・コード進行・マクロ）が立ち上がります。

## 特徴
- **簡易な1関数で導入** — `mountDAW(element, options)` を呼ぶだけ。UIスタイルは自己完結（Tailwind不要・CDNアイコン不要）。
- **モバイルファースト** — 狭幅基準のレイアウト、タップしやすいUI、折りたたみパネル、横スクロール式ツールバー。広幅では自動で拡張。
- **音声はフック経由** — ライブラリ自体は音を鳴らさない。シーケンサ（タイミング管理）はライブラリが持ち、`onPlayNote` / `onPlayDrum` コールバックを呼ぶ。実際の発音（SoundFont等）は利用側が担当。
- **2層構成**
  - Layer 1（ヘッドレスコア）: `MMLCore`・`createPianoRoll`・描画レンダラなどの再利用可能なプリミティブ。
  - Layer 2（フルDAW）: `mountDAW`。
- **機能** — 4トラック（メロディー / サブメロ / ベース / 伴奏）+ プリセットドラム、ペン/選択/消しゴム、ドラッグ移動・リサイズ、複数選択・コピペ、Undo/Redo、ズーム、MML/MIDI 入出力、コード進行自動入力、各種マクロ。

- **おんJ民が作っている**  
  質問や相談はフォーラムで: [質問フォーラム](https://unj.netlify.app)

## リンク集
- 👀 [DEMO](https://onjmin.github.io/dtm/demo)
- 🛫 [仕様書](https://onjmin.github.io/dtm)
- 🌟 [GitHubリポジトリ](https://github.com/onjmin/dtm)
- 🌴 [npmモジュール](https://www.npmjs.com/package/@onjmin/dtm)
- 📘 [parseChord / parseChords 使い方](docs/parseChord.md)

## インストール
```bash
npm i @onjmin/dtm
```

## 使用例（フルDAW）

```ts
import { mountDAW } from "@onjmin/dtm";

const daw = mountDAW(document.getElementById("app"), {
  // 発音フック（ライブラリは音を出さないので、ここで実際に鳴らす）
  onPlayNote: ({ trackId, pitch, volume, when, duration }) => {
    // 例: お好みの音源で発音（when は「今」からの相対秒）
    mySynth.play({ pitch, volume, when, duration });
  },
  onPlayDrum: ({ pitch, velocity, when, duration }) => {
    myDrum.play({ pitch, velocity, when, duration });
  },
  // 再生クロック（利用側のAudioContextに同期させる）
  getAudioTime: () => audioCtx.currentTime,
  onResumeAudio: () => audioCtx.resume(),

  // 任意: コード進行入力 / MIDI読込を使う場合だけ注入する
  // parseChord, parseChords,  // rpgen3 互換
  // parseMidi,                // midi-parser-js 互換

  defaultBpm: 120,
});

// 戻り値のAPI
daw.play();
const { full, minified } = daw.getMML();
daw.loadMML("@0 t120 v100 o5 cdefgab");
daw.exportMIDI();   // Blob
daw.destroy();
```

> **発音について**: `onPlayNote` / `onPlayDrum` を渡さなければ無音で編集だけできます。  
> `parseChord` / `parseChords` を渡すと伴奏トラックのコード進行入力UIが、`parseMidi` を渡すとMIDI読込UIが有効になります（未指定なら自動的に隠れます）。

### ブラウザ (ダイナミックインポート)
```js
const { mountDAW } = await import("https://cdn.jsdelivr.net/npm/@onjmin/dtm/dist/index.mjs");

const wrapper = document.createElement("div");
document.body.append(wrapper);
mountDAW(wrapper, { /* hooks... */ });
```

## ヘッドレスコア（Layer 1）

DAWのUIが不要で、単一トラックのピアノロール編集だけ使いたい場合:

```ts
import { createPianoRoll } from "@onjmin/dtm";

const pianoRoll = createPianoRoll(
  {
    mountTarget: document.getElementById("piano-roll"),
    width: 640,
    height: 360,
    config: {
      stepsPerBar: 192,
      keyCount: 128,
      pitchRangeStart: 0,
      keyHeight: 15,
      stepWidth: 1,
    },
  },
  {
    onMMLGenerated: (mml) => console.log(mml),
    onNotesChanged: (notes) => console.log(notes),
  },
);
```

## コントリビュート方法
- 開発環境
  - 推奨エディタ: VSCode
  - 開発言語: TypeScript
  - 実行環境: Volta / pnpm / Biome
- 開発コマンド
  - `pnpm run dev`: http://localhost:40298 から動作確認可能（デモは `mountDAW` を呼ぶだけの薄いラッパー）

## 謝辞

- デモの発音には [KazuProg 様の MMLPlayer](https://kazuprog.work/prog/js/mml-player/) や rpgen3 様の SoundFont / parseChord を利用しています。  
  ライブラリ本体はこれらに**直接依存していません**（フック / 注入経由）。利用側で必要に応じて読み込んでください。

## ライセンス
- [MIT](./LICENSE)

## 開発者
- [おんJ民](https://github.com/onjmin)
