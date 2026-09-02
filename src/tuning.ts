/**
 * 音律（12平均律 / 31平均律）と、ピッチの内部表現。
 *
 * ## 単位
 *
 * ノートのピッチは **1/372オクターブの整数** で持つ。372 = 12 × 31 で、12と31は
 * 互いに素なので最小公倍数がこれになり、**12平均律と31平均律の両方が誤差ゼロで
 * 同じ数直線に乗る**。
 *
 *   12平均律 1半音 = 31 units
 *   31平均律 1度   = 12 units
 *   1 unit = 1200/372 ≒ 3.2258 セント
 *
 * 整数のままなので `a.pitchUnits === b.pitchUnits` の同値判定が全部生き残る
 * （重複判定・当たり判定・協調編集の (startStep, pitchUnits) キー）。小数にすると
 * ここが軒並み壊れるため、細かい整数単位を選んでいる。
 *
 * ## 音律は音声経路に入らない
 *
 * ピッチが絶対値なので、シーケンサも発音器も音律を知らなくてよい。音律は
 * 「格子・記譜・表示」だけに効く編集上の概念で、`RenderConfig.edo` に置く。
 */

/**
 * ピッチの単位を型で区別するためのブランド。
 *
 * `Units` と `MidiNote` はどちらも実体は number だが、互いに代入できない。
 * これは「半音の数値を units のつもりで使う」「units を SoundFont の
 * MIDIノート番号として渡す」といった取り違えを**コンパイラに検出させる**ため。
 * 単位の取り違えは型が同じ number である限り一切検出できず、実際に
 * 「楽器音が無音」「オクターブユニゾンが0.4半音ずれる」「多音階音源のサンプル
 * 選択が常に最高音になる」といった不具合を作り込んだ。
 *
 * 生の number から作るときは {@link units} / {@link midiNote} を通す。
 * 変換は {@link midiToUnits} / {@link unitsToMidi} など、この module の関数に集約する。
 */
declare const UNITS_BRAND: unique symbol;
declare const MIDI_BRAND: unique symbol;

/** ピッチ。1/372オクターブの整数。 */
export type Units = number & { readonly [UNITS_BRAND]: true };
/** MIDIノート番号（半音）。0-127。SoundFont のゾーン選択やMIDI入出力で使う。 */
export type MidiNote = number & { readonly [MIDI_BRAND]: true };

/** 生の数値を units として扱う。単位が units であると確信できる箇所だけで使う。 */
export const units = (n: number): Units => n as Units;
/** 生の数値をMIDIノート番号として扱う。MIDI入出力の境界だけで使う。 */
export const midiNote = (n: number): MidiNote => n as MidiNote;

/** units 同士・units と生の差分の加算。結果も units。 */
export const addUnits = (a: Units, delta: number): Units =>
	(a + delta) as Units;

/** 1オクターブあたりの units。12 × 31。 */
export const UNITS_PER_OCTAVE = 372;
/** 12平均律の1半音あたりの units。 */
export const UNITS_PER_SEMITONE = 372 / 12; // 31
/** 31平均律の1度あたりの units。 */
export const UNITS_PER_EDO31_DEGREE = 372 / 31; // 12
/** 1 unit のセント値。 */
export const CENTS_PER_UNIT = 1200 / UNITS_PER_OCTAVE;

/** A4 (MIDI 69) の units。周波数計算の基準。 */
export const A4_UNITS = (69 * UNITS_PER_SEMITONE) as Units; // 2139
/** A4 の周波数(Hz)。 */
export const A4_HZ = 440;

/** 対応する音律（1オクターブの分割数）。 */
export type Edo = 12 | 31;
/** 既定の音律。宣言のない曲はすべてこれ（＝既存データは素通り）。 */
export const DEFAULT_EDO: Edo = 12;

/** その音律の1格子ステップが何 units か。 */
export const unitsPerStep = (edo: Edo): number => UNITS_PER_OCTAVE / edo;

/** MIDIノート番号 → units。 */
export const midiToUnits = (midi: MidiNote | number): Units =>
	(midi * UNITS_PER_SEMITONE) as Units;

/**
 * units → MIDIノート番号（小数）。
 * 歌声合成（koe）は Hz を受けるためこの小数値をそのまま渡してよい。
 * SoundFont のように整数ゾーンしか持たない発音器は {@link unitsToMidiDetune} を使う。
 */
export const unitsToMidi = (u: Units): number => u / UNITS_PER_SEMITONE;

/** units → 周波数(Hz)。 */
export const unitsToHz = (u: Units): number =>
	A4_HZ * 2 ** ((u - A4_UNITS) / UNITS_PER_OCTAVE);

/**
 * units → 「最寄りの整数MIDIノート番号 + セント補正」。
 *
 * SoundFont は音高ごとに整数キーでゾーンを持つため小数ピッチを直接鳴らせない。
 * 最寄りのゾーンを鳴らして残差を `AudioBufferSourceNode.detune` で補正する。
 * 31平均律での残差は最大 ±48.4 セントで、detune の可動域に十分収まる。
 */
export const unitsToMidiDetune = (
	u: Units,
): { midi: MidiNote; detuneCents: number } => {
	const midi = Math.round(u / UNITS_PER_SEMITONE) as MidiNote;
	return {
		midi,
		detuneCents: (u - midi * UNITS_PER_SEMITONE) * CENTS_PER_UNIT,
	};
};

// ============================================================
// 記譜（MMLの綴り ⇄ units）
// ============================================================

/**
 * 幹音（c d e f g a b）の、オクターブ内での位置。単位は格子ステップ。
 *
 * 12平均律は全音・半音の並び、31平均律はミーントーンの五度連鎖から決まる。
 * 31平均律の幹音間隔が `5 5 3 5 5 5 3` になるのは、12平均律の `2 2 1 2 2 2 1` と
 * 同じ全音／半音の構造がそのまま拡大されたもの。
 */
const NATURAL_STEPS: Record<Edo, Record<string, number>> = {
	12: { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 },
	31: { c: 0, d: 5, e: 10, f: 13, g: 18, a: 23, b: 28 },
};

/**
 * 臨時記号1つあたりの格子ステップ数。
 *
 * - `#` / `+`(12平均律) … クロマチック半音上げ
 * - `-` … クロマチック半音下げ
 * - `+`(31平均律) … 格子1ステップ上げ（微分音）
 * - `_` … 格子1ステップ下げ（微分音）
 *
 * 12平均律ではクロマチック半音＝1格子ステップなので4記号すべてが従来の意味に潰れ、
 * 既存MMLの解釈は1文字も変わらない。31平均律でのみ `#`/`-`（±2度）と
 * `+`/`_`（±1度）が分岐する。
 */
export const chromaticStep = (edo: Edo): number => (edo === 31 ? 2 : 1);
/** 微分音記号 `+` / `_` 1つあたりの格子ステップ数。常に1。 */
export const MICRO_STEP = 1;

/** 幹音の文字か。 */
export const isNaturalLetter = (ch: string): boolean =>
	Object.hasOwn(NATURAL_STEPS[12], ch);

/** 幹音の文字 → オクターブ内の格子ステップ。未知の文字は null。 */
export const naturalStep = (ch: string, edo: Edo): number | null =>
	NATURAL_STEPS[edo][ch] ?? null;

/**
 * 音名・オクターブ・臨時記号から units を組み立てる。
 *
 * `octave` はMMLの `o` 指定（MIDI慣習で o4 の c が中央ド = MIDI 60）。
 * 臨時記号でオクターブを跨ぐ綴り（`b##` が次オクターブへ、`c--` が前オクターブへ）も
 * そのまま加算されるので、度数を 0〜edo-1 にクランプしてはいけない。
 */
export const spellingToUnits = (
	letter: string,
	octave: number,
	chromatic: number,
	micro: number,
	edo: Edo,
): number | null => {
	const step = naturalStep(letter, edo);
	if (step === null) return null;
	const perStep = unitsPerStep(edo);
	const stepsFromC = step + chromatic * chromaticStep(edo) + micro * MICRO_STEP;
	return (octave + 1) * UNITS_PER_OCTAVE + stepsFromC * perStep;
};

/** 五度圏インデックス → その音律での格子ステップ数（オクターブ内）。 */
const FIFTH_STEPS: Record<Edo, number> = { 12: 7, 31: 18 };

/**
 * 五度圏インデックス（C=0, G=1, F=-1, C#=7, Db=-5）→ オクターブ内の格子ステップ。
 *
 * ミーントーン系の音律はすべて「五度を何ステップとするか」だけで決まるため、
 * 綴りを持つ音（chord-parser の `rootFifth` / `noteFifths` など）はこの一本で
 * どちらの音律へも正確に写せる。12平均律では C# と Db が同じ値に潰れ、
 * 31平均律では 2 と 3 に分かれる。
 */
export const fifthToStep = (fifthIndex: number, edo: Edo): number => {
	const n = fifthIndex * FIFTH_STEPS[edo];
	return ((n % edo) + edo) % edo;
};

/** 五度圏インデックス → オクターブ内の units。 */
export const fifthToUnits = (fifthIndex: number, edo: Edo): number =>
	fifthToStep(fifthIndex, edo) * unitsPerStep(edo);

// ============================================================
// 協調編集のピッチ表現バージョン
// ============================================================

/**
 * ピッチ表現のバージョン。
 *
 * - v1 … `pitch` が半音（MIDIノート番号）。dtm 1.x
 * - v2 … `pitchUnits` が 1/372オクターブ単位。dtm 2.x
 *
 * dtm 自身は通信路を持たず `onNotesPatch` / `applyPatch` のフックを出すだけなので、
 * バージョンの突き合わせは利用側アプリのハンドシェイクの責務になる。変換の知識だけを
 * ここに置く。v1→v2 は無損失だが、**v2→v1 は12平均律の曲でしか成立しない**
 * （31平均律を半音へ丸めると最大48.4セント動く）。
 */
export const PITCH_ENCODING_VERSION = 2;

/** v1（半音）→ v2（units）。無損失。 */
export const pitchV1ToUnits = (pitch: number): Units =>
	(pitch * UNITS_PER_SEMITONE) as Units;

/** v2（units）→ v1（半音）。12平均律の曲でのみ無損失。 */
export const unitsToPitchV1 = (u: Units): number =>
	Math.round(u / UNITS_PER_SEMITONE);
