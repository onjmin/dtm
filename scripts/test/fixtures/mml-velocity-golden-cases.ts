/**
 * `scripts/check-mml-velocity.ts` の互換検査（§12.1 の2）に使う入力。
 *
 * **全音符の velocity が100（未設定を含む）**のノート列だけを作る。音符ごとの v を書き出すように
 * `MMLCore.generateMML` を直した後も、これらの書き出しは直す前と1バイトも変わってはいけない。
 * 期待値（`mml-velocity-golden.json`）は、**直す前**のコードで採った。
 *
 * ここを変えると golden と食い違うので、ケースを足すときは足したケースの golden を
 * 直す前のコード（2.1.29 の `mml-core.ts`）で採ること。既存のケースは変えないこと。
 *
 * dtm のコードは読まない（型だけ）。乱数は自前の線形合同法で、実行環境に依らず同じ列になる。
 */

type Note = import("../../src/types").Note;

export type GoldenCase = {
	name: string;
	edo: 12 | 31;
	tempo: number;
	/** getMMLFromNotes の第3引数（トラック音量）。 */
	volume: number;
	notes: Note[];
};

/** 12平均律の MIDI 番号 → units。 */
const m = (midi: number): Note["pitchUnits"] =>
	(midi * 31) as Note["pitchUnits"];
/** 31平均律のオクターブ番号（MML の o）と度数 → units。 */
const d31 = (octave: number, step: number): Note["pitchUnits"] =>
	((octave + 1) * 372 + step * 12) as Note["pitchUnits"];

const notesOf = (
	list: [start: number, dur: number, pitch: Note["pitchUnits"], vel?: 100][],
): Note[] =>
	list.map(([startStep, durationSteps, pitchUnits, velocity], id) =>
		velocity === undefined
			? { id, startStep, durationSteps, pitchUnits }
			: { id, startStep, durationSteps, pitchUnits, velocity },
	);

/** 線形合同法（Numerical Recipes の定数）。0 以上 1 未満。 */
const lcg = (seed: number): (() => number) => {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
};

/** 乱数でノート列を作る。和音・休符・端数の音価・近すぎて省かれる音符・大きな跳躍を含む。 */
const randomNotes = (seed: number, edo: 12 | 31, count: number): Note[] => {
	const r = lcg(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
	// 16分=12、8分=24、4分=48、2分=96、全=192、付点・3連・半端（5, 7, 130 など）も混ぜる
	const durs = [
		3, 5, 6, 7, 12, 16, 18, 24, 32, 36, 48, 72, 96, 130, 144, 192, 288, 400,
	];
	const gaps = [0, 0, 0, 1, 2, 3, 6, 12, 12, 24, 48, 100, 192];
	const notes: Note[] = [];
	let step = pick([0, 0, 12, 48]);
	let id = 0;
	for (let i = 0; i < count; i++) {
		const dur = pick(durs);
		const size = r() < 0.2 ? 2 + Math.floor(r() * 3) : 1;
		const base =
			edo === 12
				? m(24 + Math.floor(r() * 84))
				: d31(1 + Math.floor(r() * 6), Math.floor(r() * 31));
		for (let k = 0; k < size; k++) {
			const pitchUnits = (base +
				k * (edo === 12 ? 31 * 4 : 12 * 10)) as Note["pitchUnits"];
			const choice = r();
			notes.push(
				choice < 0.5
					? { id: id++, startStep: step, durationSteps: dur, pitchUnits }
					: {
							id: id++,
							startStep: step,
							durationSteps: dur,
							pitchUnits,
							velocity: 100,
						},
			);
		}
		// 次の発音は、今の音の長さに関係なく進める（重なり・隙間の両方を作る）
		step += pick([dur, dur, pick(gaps), dur + pick(gaps)]);
	}
	return notes;
};

export const goldenCases = (): GoldenCase[] => {
	const cases: GoldenCase[] = [
		{ name: "empty", edo: 12, tempo: 120, volume: 80, notes: [] },
		{
			name: "melody-octaves",
			edo: 12,
			tempo: 112,
			volume: 100,
			notes: notesOf([
				[0, 24, m(64)],
				[24, 12, m(71), 100],
				[36, 12, m(68)],
				[48, 48, m(76)],
				[96, 24, m(52), 100],
				[120, 24, m(88)],
				[192, 96, m(40)],
				[384, 12, m(60)],
			]),
		},
		{
			name: "chords-and-singles",
			edo: 12,
			tempo: 90,
			volume: 76,
			notes: notesOf([
				[0, 96, m(56)],
				[0, 96, m(61), 100],
				[0, 96, m(64)],
				[96, 48, m(40)],
				[144, 48, m(57), 100],
				[144, 48, m(60)],
				[192, 144, m(51)],
				[192, 144, m(55)],
				[192, 144, m(58), 100],
				[336, 24, m(70)],
			]),
		},
		{
			name: "loud-127",
			edo: 12,
			tempo: 160,
			volume: 127,
			notes: notesOf([
				[0, 12, m(60)],
				[12, 12, m(62), 100],
				[24, 12, m(64)],
				[48, 192, m(67), 100],
			]),
		},
		{
			name: "silent-0",
			edo: 12,
			tempo: 60,
			volume: 0,
			notes: notesOf([
				[48, 48, m(60)],
				[96, 48, m(64), 100],
			]),
		},
		{
			// 2つめの発音が1ステップ後（64分未満）で、1つめは音価を表せず省かれる
			name: "too-close-skipped",
			edo: 12,
			tempo: 120,
			volume: 95,
			notes: notesOf([
				[0, 48, m(60)],
				[1, 48, m(64), 100],
				[2, 48, m(67)],
				[48, 16, m(72)],
				[64, 16, m(71), 100],
				[80, 16, m(69)],
				[96, 300, m(48)],
			]),
		},
		{
			name: "edo31",
			edo: 31,
			tempo: 100,
			volume: 88,
			notes: notesOf([
				[0, 48, d31(4, 0)],
				[0, 48, d31(4, 10), 100],
				[0, 48, d31(4, 18)],
				[48, 24, d31(4, 21)],
				[72, 24, d31(5, 3), 100],
				[96, 96, d31(3, 29)],
				[192, 48, d31(2, 12)],
			]),
		},
	];
	for (let i = 0; i < 8; i++) {
		const edo: 12 | 31 = i % 3 === 2 ? 31 : 12;
		const r = lcg(9001 + i);
		cases.push({
			name: `random-${i}`,
			edo,
			tempo: 60 + Math.floor(r() * 140),
			volume: Math.floor(r() * 128),
			notes: randomNotes(20260928 + i * 77, edo, 60),
		});
	}
	return cases;
};
