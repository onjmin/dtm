# parseChord / parseChords 使い方

このドキュメントでは、ブラウザ側で以下の 2 つのライブラリを利用する方法を説明します。

- `parseChord` - 1つのコード記号を解析して構成音を得る
- `parseChords` - コード進行文字列を解析して時刻付きイベントを得る

```js
import { parseChord, parseChords } from "@onjmin/chord-parser";
```

## parseChord

`parseChord(str)` は、単一の和音記号を解析して構成音を返す関数です。

### 返り値

戻り値はオブジェクトで、最も重要なプロパティは `notes` です。

- `notes`: ルートを 0 とした絶対半音オフセット（昇順）を表す `number[]`
- `root`: ルートの pitch class（0=C, 1=C#, ... 11=B）
- `intervals`: ルートからの相対音程
- `symbol`: 解析されたコード名文字列

### 使い方例

```js
const parsed = parseChord('Cmaj7');
console.log(parsed.notes);
// => [0, 4, 7, 11]

const parsed2 = parseChord('Dm7');
console.log(parsed2.notes);
// => [0, 3, 7, 10]
```

### 対応するコード記号

このライブラリは次のような形式を扱います。

- `C`, `Cm`, `Cmaj7`, `C7`, `Cdim`, `Caug`
- `Cm7`, `Cø`, `C+`, `C△`, `CΔ`
- `Cadd9`, `Cmaj9`, `C7b9`, `C7#11`
- `Csus4`, `Cadd2`, `Cno3`, `Comit3`
- `C/E`, `C(onE)` のような分数コード / インヴァージョン
- `C(#5)` などの拡張構成音

### 例: ノートオフセット取得

```js
const chord = parseChord('F#m7');
const offsets = [...chord.notes];
for (const offset of offsets) {
  const midiPitch = 48 + offset; // C3 からの相対
  console.log(midiPitch);
}
```

## parseChords

`parseChords(str, bpm = 120)` は、コード進行記号列を解析し、時間情報付きのコードイベント配列を返します。

### 返り値

要素は以下のようなオブジェクトです。

- `key`: ルート音文字列 (例: `C`, `G`, `F#`)
- `chord`: コード構成記号 (例: `maj7`, `m7`, `dim`)
- `when`: 再生開始時刻 (秒)
- `duration`: 再生持続時間 (秒)

### パース仕様

- 行ごとに `|` / `l` / `ｌ` / `→` で区切る
- `=` は直前のコード継続
- `_` は休符扱い
- `N` / `NC` はノーコード扱い
- `#` で始まる行はコメントとして無視される

`parseChord` は単一コード解析のためコメント構文は持たず、`parseChords` 側で入力全体の行単位コメントを扱います。

### 使い方例

```js
const bpm = 120;
const progression = 'C|G|Am|F';
const chordData = parseChords(progression, bpm);
console.log(chordData);
```

### BPM と再生タイミングについて

`parseChords` は `bpm` を基準に `when` と `duration` を秒単位で計算します。
これにより、「いつ鳴らすか」「どれだけ長く鳴らすか」を正確に取得できます。

- `when`: そのコードが再生を開始する時刻（秒）
- `duration`: そのコードの持続時間（秒）

例えば、`bpm=120` なら 1 小節は 2 秒、4 分割の進行であれば各コードは 2 秒ごとに開始します。

再生エンジン側では、この秒数を基準にノートの開始タイミングと長さを設定できます。ステップ単位のグリッドに変換する場合は、1 ステップあたりの秒数を計算して `when` / `duration` を換算します。

```js
const secondsPerBeat = 60 / bpm;
const stepsPerBeat = 48;
const secondsPerStep = secondsPerBeat / stepsPerBeat;
const startStep = Math.round(chord.when / secondsPerStep);
const lengthSteps = Math.round(chord.duration / secondsPerStep);
```

### デモ実装例

`demo/index.html` の `applyChordProgression` では、次のように `parseChords` と `parseChord` を組み合わせています。

1. `parseChords(chordStr, bpm)` でコード進行を解析
2. 返却された各コードイベントの `key` と `chord` を連結して `parseChord` に渡す
3. 解析した構成音に対してノートを追加する

```js
const chordData = parseChords(chordStr, bpm);
for (const chord of chordData) {
  const parsed = parseChord(`${chord.key}${chord.chord}`);
  const notes = [...parsed.notes];
  notes.forEach((noteOffset) => {
    const pitch = 48 + noteOffset + rootShift;
    chordTrack.core.addNote(chord.whenStep, pitch, {
      noteLengthSteps: chord.durationSteps,
      velocity: 100,
    });
  });
}
```

## 例: コード進行文字列を伴奏に変換

```js
const chordStr = 'C|G|Am|Em|F|C|F|G';
try {
  const chordData = parseChords(chordStr, bpm);
  chordData.forEach(chord => {
    const parsed = parseChord(`${chord.key}${chord.chord}`);
    const noteOffsets = [...parsed.notes];
    // noteOffsets を使ってノート生成
  });
} catch (e) {
  console.warn('コード解析に失敗しました', e);
}
```

## エラー処理

- `parseChord` は解析できない文字列で例外を投げる
- `parseChords` は通常、入力を順次パースするため、部分的にうまくいかない場合はその部分をスキップする

```js
try {
  parseChord('InvalidChord');
} catch (e) {
  console.error('parseChord error:', e);
}
```

## 実装上のヒント

- `parseChords` の戻り値を直接 `parseChord` に渡すため、`key` と `chord` を結合した文字列を使う
- `bpm` によって `when` と `duration` が秒数で決まる
- 失敗時はフォールバックとして空白 / カンマ区切りで `parseChord` を個別に実行する
