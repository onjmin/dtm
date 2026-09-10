/**
 * 歌詞の強弱記号（`↓` / `↑`）のチェック。
 *
 * 「`ぎー↓` は最後で0まで落ちるが、`ぎ↓ー↓` なら『ぎ』の終わりで50%、
 * 『ー』の終わりで0%にしたい」という要望から作った。減り方を書いた位置で
 * 刻めることと、**記号が1つのときの従来どおりの挙動**が壊れていないことを、
 * 同じ表で並べて見る。
 *
 * 音は出せないので、{@link buildStreamVoiceNotes} が組み立てたノート
 * （＝合成へ渡る直前の形）の `fadeOut` / `fadeIn` / `fadeCurve` を突き合わせる。
 * `fadeCurve` の `at` はサステイン区間を0〜1で見た位置、`level` はピーク比。
 */
import Module from "node:module";

// `src/lyrics.ts` は歌唱合成エンジン @onjmin/koe を読む。あちらは WebAssembly と
// AudioWorklet 前提のブラウザ専用パッケージで、Node からは読み込めない（ESM専用の
// exports なので require が通らない）。この検査が触るのは歌詞側の純粋なロジックだけ
// なので、名前解決だけ空のスタブへ差し替えて中身を使わせない。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

// スタブを差し込んだ後に読む必要があるので、import 文ではなく require で取る。
const { buildStreamVoiceNotes, normalizeLyrics } =
	require("../src/lyrics") as typeof import("../src/lyrics");
const { units } = require("../src/tuning") as typeof import("../src/tuning");
type TieSourceNote = import("../src/lyrics").TieSourceNote;

/** 1ステップ0.25秒（BPM120の16分音符相当）。実時間の細かさは結論に効かない。 */
const SECONDS_PER_STEP = 0.25;

/** 音価の並びからテスト用の演奏ノート列を作る（隙間なく連続＝継続記号が結合する形）。 */
const notesOf = (durations: number[]): TieSourceNote[] => {
	let step = 0;
	return durations.map((d) => {
		const n: TieSourceNote = {
			startStep: step,
			durationSteps: d,
			pitchUnits: units(2139),
		};
		step += d;
		return n;
	});
};

/** 期待値の書きやすさ優先で、curve を `at@level` の文字列へ畳む。 */
const fmtCurve = (
	curve: { at: number; level: number }[] | undefined,
): string =>
	curve
		? curve.map((s) => `${s.at.toFixed(2)}@${s.level.toFixed(2)}`).join(" ")
		: "-";

/** 1音ぶんの結果を「fadeOut/fadeIn/curve」の1行へ畳む。 */
const fmtNote = (n: {
	fadeOut?: boolean;
	fadeIn?: boolean;
	fadeCurve?: { at: number; level: number }[];
}): string =>
	`${n.fadeOut ? "↓" : "-"}${n.fadeIn ? "↑" : "-"} ${fmtCurve(n.fadeCurve)}`;

type Case = {
	/** 歌詞（`↓` `↑` はノートを消費しない）。 */
	lyrics: string;
	/** 音価の並び（ステップ）。省略時は全音符1ステップ。 */
	durations?: number[];
	/** 音ごとの期待値（{@link fmtNote} の形）。 */
	expect: string[];
	/** 何を守っているのか。 */
	why: string;
};

const CASES: Case[] = [
	{
		lyrics: "ぎー",
		expect: ["-- -"],
		why: "記号なしは何も付かない",
	},
	{
		lyrics: "ぎーーーー↓",
		expect: ["↓- -"],
		why: "1つだけなら従来どおり1音まるごと（中継点なし）",
	},
	{
		lyrics: "ぎー↓ーーー",
		expect: ["↓- -"],
		why: "1つだけなら書いた位置に関係なく一続き全体（従来どおり）",
	},
	{
		lyrics: "ぎ↓ー↓",
		expect: ["↓- 0.50@0.50 1.00@0.00"],
		why: "2つ書くと「ぎ」の終わりで50%・音の終わりで0%",
	},
	{
		lyrics: "ぎ↓ー↓ー↓",
		expect: ["↓- 0.33@0.67 0.67@0.33 1.00@0.00"],
		why: "3つ書くと 66%→33%→0% の3段階",
	},
	{
		lyrics: "ぎ↓ーーー↓ー",
		durations: [1, 1, 1, 1, 1],
		expect: ["↓- 0.20@0.50 1.00@0.00"],
		why: "最後の記号は書いた位置ではなく音の終端へ（末尾に無音の余りを作らない）",
	},
	{
		lyrics: "ぎ↓ー↓",
		durations: [3, 1],
		expect: ["↓- 0.75@0.50 1.00@0.00"],
		why: "中継点は音価どおりの位置（3:1なら75%地点で50%）",
	},
	{
		lyrics: "ぎ↑ー↑",
		expect: ["-↑ 0.50@0.50 1.00@1.00"],
		why: "`↑` も同じ刻み方（上がり幅を分ける）",
	},
	{
		lyrics: "ぎ↑ー↓ー↓",
		expect: ["↓↑ -"],
		why: "`↑` と `↓` の混在はスウェル優先（中継点は付けない）",
	},
	{
		lyrics: "ぎ↓ぎ↓",
		expect: ["↓- -", "↓- -"],
		why: "別々の音に1つずつなら、それぞれ従来どおり",
	},
	{
		lyrics: "ぎ↓ー↓、ぎ↓ー↓",
		expect: ["↓- 0.74@0.50 1.00@0.00", "↓- 0.50@0.50 1.00@0.00"],
		why: "ブレスで切れた先は別の音として刻み直す（息継ぎで詰めた分だけ中継点も寄る）",
	},
];

let failed = 0;
console.log("● 歌詞の強弱記号（↓ / ↑）");
for (const c of CASES) {
	const syllables = normalizeLyrics(c.lyrics);
	const durations = c.durations ?? syllables.map(() => 1);
	const notes = buildStreamVoiceNotes(syllables, notesOf(durations), {
		fromStep: 0,
		secondsPerStep: SECONDS_PER_STEP,
		gate: 1,
		octaveShiftUnits: 0,
	});
	const got = notes.map(fmtNote);
	const ok =
		got.length === c.expect.length && got.every((g, i) => g === c.expect[i]);
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${c.lyrics}  →  ${got.join(" / ")}`);
	console.log(`        ${c.why}`);
	if (!ok) console.log(`        期待: ${c.expect.join(" / ")}`);
}

if (failed > 0) {
	console.log(`
${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log(`
${CASES.length}件すべて期待どおりです`);
}
