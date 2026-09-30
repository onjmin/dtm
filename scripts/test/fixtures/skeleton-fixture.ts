/**
 * 骨格借用エンジン（src/compose/compose-skeleton.ts）の検算用 fixture。実データ
 * （src/compose/compose-skeletons.ts）とは独立に、型（skeleton-types.ts）どおりの小さな骨格を
 * 手で書いてある。2曲・短調24小節と長調16小節。check-compose.ts の「● 骨格借用」が読む。
 */
import type {
	Skeleton,
	SkeletonBar,
} from "../../../src/compose/skeleton-types";

const octaveEighth = (): SkeletonBar["bass"] => ({
	steps: [0, 24, 48, 72, 96, 120, 144, 168],
	rel: [0, 12, 0, 12, 0, 12, 0, 12],
	durs: [24, 24, 24, 24, 24, 24, 24, 24],
});
const rootQuarter = (): SkeletonBar["bass"] => ({
	steps: [0, 48, 96, 144],
	rel: [0, 0, 7, 0],
	durs: [48, 48, 48, 48],
});

const bar = (
	chords: [string | null, string | null],
	melody: { rhythm: number[]; degrees: number[] } | null,
	extra: Partial<Pick<SkeletonBar, "sameAs" | "rhythmSameAs" | "layers">> & {
		bass?: SkeletonBar["bass"];
	} = {},
): SkeletonBar => ({
	chords,
	bass: extra.bass ?? octaveEighth(),
	melody,
	sameAs: extra.sameAs ?? null,
	rhythmSameAs: extra.rhythmSameAs ?? null,
	layers: extra.layers ?? {
		arp: false,
		pad: false,
		counter: false,
		stab: false,
	},
});

const R8 = [24, 24, 24, 24, 24, 24, 24, 24];
const R_A = [24, 24, 48, 24, 24, 48];
const R_B = [-24, 24, 24, 24, 48, 48];
const R_C = [48, 24, 24, 24, 24, 48];
const R_END = [48, 48, 96];

const arp = { arp: true, pad: false, counter: false, stab: false };
const pad = { arp: false, pad: true, counter: false, stab: false };
const arpPad = { arp: true, pad: true, counter: false, stab: false };

export const FIXTURE_SKELETONS: Skeleton[] = [
	{
		id: "fixture/minor-24",
		mode: "minor",
		bpm: 135,
		bars: 24,
		sections: [
			{ kind: "intro", start: 0, bars: 4 },
			{ kind: "verse", start: 4, bars: 8 },
			{ kind: "chorus", start: 12, bars: 8 },
			{ kind: "outro", start: 20, bars: 4 },
		],
		barsData: [
			// intro
			bar(["Am7", null], null, { layers: arp }),
			bar(["FM7", "G7"], null, { layers: arp }),
			bar(["Am7", null], null, { layers: arp }),
			bar(["E7", "E+"], null, { layers: arp }),
			// verse
			bar(["Am7", null], { rhythm: R_A, degrees: [5, 6, 7, 6, 5, 4] }),
			bar(["G7", null], { rhythm: R_B, degrees: [4, 5, 6, 5, 4] }),
			bar(
				["FM7", null],
				{ rhythm: R_A, degrees: [3, 4, 5, 4, 3, 2] },
				{
					rhythmSameAs: 4,
				},
			),
			bar(["E7", null], { rhythm: R_END, degrees: [1, 2, 5] }),
			bar(
				["Am7", null],
				{ rhythm: R_A, degrees: [5, 6, 7, 6, 5, 4] },
				{
					sameAs: 4,
				},
			),
			bar(
				["G7", null],
				{ rhythm: R_B, degrees: [4, 5, 6, 5, 4] },
				{
					sameAs: 5,
				},
			),
			bar(["Dm7", "G7"], { rhythm: R_C, degrees: [3, 4, 5, 6, 7, 6] }),
			bar(["Bm7-5", "E7"], { rhythm: R_END, degrees: [6, 5, 5] }),
			// chorus
			bar(
				["FM7", "G7"],
				{ rhythm: R8, degrees: [7, 7, 8, 7, 5, 6, 7, 6] },
				{
					layers: arpPad,
				},
			),
			bar(
				["Em7", "Am7"],
				{ rhythm: R_C, degrees: [5, 6, 7, 5, 4, 5] },
				{
					layers: arpPad,
				},
			),
			bar(
				["FM7", "G7"],
				{ rhythm: R8, degrees: [7, 7, 8, 7, 5, 6, 7, 6] },
				{
					sameAs: 12,
					layers: arpPad,
				},
			),
			bar(
				["C7", "E7"],
				{ rhythm: R_END, degrees: [6, 7, 9] },
				{
					layers: arpPad,
				},
			),
			bar(
				["FM7", "G7"],
				{ rhythm: R8, degrees: [9, 9, 8, 7, 8, 9, 7, 6] },
				{
					rhythmSameAs: 12,
					layers: arpPad,
				},
			),
			bar(
				["Em7", "Am7"],
				{ rhythm: R_C, degrees: [5, 6, 7, 5, 4, 5] },
				{
					sameAs: 13,
					layers: arpPad,
				},
			),
			bar(
				["Dm7", "E7"],
				{ rhythm: R_B, degrees: [6, 7, 6, 5, 4] },
				{
					layers: arpPad,
				},
			),
			bar(
				["Am7", null],
				{ rhythm: [96, 96], degrees: [5, 5] },
				{
					layers: arpPad,
				},
			),
			// outro
			bar(["Am7", null], null, { layers: pad }),
			bar(["FM7", "G7"], null, { layers: pad }),
			bar(["Am7", null], null, { layers: pad }),
			bar(["E7", "Am7"], null, { layers: pad }),
		],
		drum: "four_clap",
		chordPattern: "block",
		melodyCenter: 69,
		programs: { melody: 80, bass: 38, chord: 81 },
		instrument: "retro_game",
		confidence: {
			chordTrack: true,
			melodyBy: "fixture",
			warnings: [],
		},
	},
	{
		id: "fixture/major-16",
		mode: "major",
		bpm: 128,
		bars: 16,
		sections: [
			{ kind: "intro", start: 0, bars: 4 },
			{ kind: "verse", start: 4, bars: 4 },
			{ kind: "chorus", start: 8, bars: 8 },
		],
		barsData: [
			// intro
			bar(["C", null], null, { bass: rootQuarter() }),
			bar(["G", null], null, { bass: rootQuarter() }),
			bar(["Am", null], null, { bass: rootQuarter() }),
			bar(["F", "G"], null, { bass: rootQuarter() }),
			// verse
			bar(
				["C", null],
				{ rhythm: R_A, degrees: [0, 1, 2, 1, 0, -1] },
				{
					bass: rootQuarter(),
				},
			),
			bar(
				["G", null],
				{ rhythm: R_B, degrees: [-1, 0, 1, 0, -1] },
				{
					bass: rootQuarter(),
				},
			),
			bar(
				["Am", null],
				{ rhythm: R_A, degrees: [2, 3, 4, 3, 2, 1] },
				{
					rhythmSameAs: 4,
					bass: rootQuarter(),
				},
			),
			bar(
				["F", "G"],
				{ rhythm: R_END, degrees: [1, 3, 4] },
				{
					bass: rootQuarter(),
				},
			),
			// chorus
			bar(
				["F", "G"],
				{ rhythm: R8, degrees: [4, 4, 5, 4, 2, 3, 4, 3] },
				{
					layers: pad,
				},
			),
			bar(
				["Em", "Am"],
				{ rhythm: R_C, degrees: [2, 3, 4, 2, 1, 2] },
				{
					layers: pad,
				},
			),
			bar(
				["F", "G"],
				{ rhythm: R8, degrees: [4, 4, 5, 4, 2, 3, 4, 3] },
				{
					sameAs: 8,
					layers: pad,
				},
			),
			bar(["C", "G"], { rhythm: R_END, degrees: [3, 4, 7] }, { layers: pad }),
			bar(
				["F", "G"],
				{ rhythm: R8, degrees: [7, 7, 6, 5, 6, 7, 5, 4] },
				{
					rhythmSameAs: 8,
					layers: arpPad,
				},
			),
			bar(
				["Em", "Am"],
				{ rhythm: R_C, degrees: [2, 3, 4, 2, 1, 2] },
				{
					sameAs: 9,
					layers: arpPad,
				},
			),
			bar(
				["Dm", "G"],
				{ rhythm: R_B, degrees: [3, 4, 3, 2, 1] },
				{
					layers: arpPad,
				},
			),
			bar(
				["C", null],
				{ rhythm: [96, 96], degrees: [0, 0] },
				{
					layers: arpPad,
				},
			),
		],
		drum: "dance",
		chordPattern: "offbeat",
		melodyCenter: 71,
		programs: { melody: 81, bass: 39, chord: 5 },
		instrument: "synth_pop",
		confidence: {
			chordTrack: true,
			melodyBy: "fixture",
			warnings: [],
		},
	},
];
