# dtm
MML を中間言語に用いたピアノロール打ち込みモジュール

## 特徴
- **ピアノロール形式での編集**
  - 3トラック（メロディー・ベース・伴奏）
  - 第4トラックはドラム専用（MML には含まれない）
  - プリセットドラムパターン選択方式
- **操作機能**
  - トラックごとの音量設定（0〜100）
  - 音階範囲：C1〜C5
  - ズーム倍率 x1 / x2 / x4（縦横対応）
  - ノート追加：クリックまたはタップ
  - ノート長モード：4分 / 8分 / 16分 / 32分音符 + 各3連符（計16モード）
  - ノート右端ドラッグで長さ変更
  - ノートドラッグで上下＝音階変更、左右＝タイミング変更

- **開発中 / TBD**
  - ノート複数選択 & コピー・貼り付け
  - Undo / Redo 機能
  - ドラムプリセットのカスタム保存
  - MML 生成・エクスポート

## インストール
```bash
npm i @onjmin/dtm
```

## 使用例

### Node.js / ESM
```ts
import * as DTM from "@onjmin/dtm";

const mountTarget = document.getElementById("piano-roll");
if (!mountTarget) throw new Error("mount target not found");

const renderConfig = {
  bars: 8,
  stepsPerBar: 16,
  keyCount: 49, // C1〜C5
  pitchRangeStart: 0,
  keyHeight: 15,
  stepWidth: 10,
};

const pianoRoll = DTM.createPianoRoll(
  { mountTarget, width: 640, height: 360, config: renderConfig },
  {
    onMMLGenerated: (mml) => console.log(mml),
    onNotesChanged: (notes) => console.log(notes),
  },
);

pianoRoll.setVolume(80);
```

### ブラウザ (ダイナミックインポート)
```js
const DTM = await import("https://cdn.jsdelivr.net/npm/@onjmin/dtm/dist/index.min.mjs");

const wrapper = document.createElement("div");
document.body.append(wrapper);

const renderConfig = {
  bars: 8,
  stepsPerBar: 16,
  keyCount: 49,
  pitchRangeStart: 0,
  keyHeight: 15,
  stepWidth: 10,
};

const pianoRoll = DTM.createPianoRoll(
  { mountTarget: wrapper, width: 640, height: 360, config: renderConfig },
  {
    onMMLGenerated: (mml) => console.log(mml),
    onNotesChanged: (notes) => console.log(notes),
  },
);
```

## コントリビュート方法
- 開発環境
  - 推奨エディタ: vscode
  - 開発言語: TypeScript
  - 実行環境: Volta / pnpm / Biome
- 開発コマンド
  - `pnpm run dev`: http://localhost:40298 から動作確認可能

## ライセンス
- **MIT**  
  詳細は [`LICENSE`](./LICENSE) を参照

## 開発者
- [おんJ民](https://github.com/onjmin)
