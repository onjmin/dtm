/**
 * 陽性対照: 所有者が評価した手書き編曲 fb（`tmp/full/gen-fb.mjs`）を、`AccompPlan` として
 * **手で**書き直したもの（`docs/accomp-compose.md` §12.3）。ホ長調（rootShift 4）・112BPM・76小節。
 *
 * `src/compose-accomp-plan.ts` の `fbPlan()`（表の行を決めた値で組み立てる、保険の計画）は、
 * これと一致しなければならない。表の行が fb からずれたら検査で分かるように、ここは表を
 * 参照せずに書いてある。
 *
 * - 和声は gen-fb.mjs の `CHORDS`（ホ長調の和音名、下の `FB_CHORD_NAMES`）をローマ数字に読み直したもの
 * - セルと低音型は付録 A・§6 段3 の表で、fb の各4小節に当てた id
 * - 分散の基準 v は gen-fb.mjs の `ARP_BASE`
 * - 記録（`PlanPins`、`docs/accomp-style-engine.md` §3.1。段階 S1 で足した）: スタイル・型・ミックスの id と、
 *   小節ごとの和音の打ち方（`compHits`）。打ち方は gen-fb.mjs の `COMP`（1〜16 は backing と同じ規則、
 *   B は `one`/`three`/`two`、C は長く、L は `one`/`three` の交互）を id に読み直したもの。
 *   `fbPlan()` は打ち方の記録を持たない（実現の段が決めて記録する）ので、`fbPlan()` と一致するのは
 *   打ち方の記録を除いた部分。`fbPlan()` を鳴らした曲の計画（実現の段が記録を埋めたもの）は、
 *   記録ごとこれと一致する（`check-compose-accomp.ts`）。
 *
 * `tmp/` は CI に無いので、fb の値はここに写してある（検査は tmp/ を読まない）。
 */

import type { AccompPlan } from "../../src/compose-accomp";

const HOME_WINDOW = { lowMin: 59, lowMax: 64, topMin: 76, topMax: 78 };

export const FB_PLAN: AccompPlan = {
	bpm: 112,
	rootShift: 4,
	borrowPair: "P1",
	regions: [
		{
			role: "home",
			label: "A 家",
			startBar: 0,
			bars: 16,
			chords: [
				"Iadd9",
				"IVM7",
				"iii7 vi7",
				"ii7 V",
				"IM7",
				"vi7",
				"IVM7 iii7",
				"ii7 Vsus4",
				"vi7",
				"iii7",
				"IVM7 V",
				"vi7",
				"bVIM7",
				"bVIIadd9",
				"bIIIM7 iv7",
				"Vsus4 V",
			],
			texture: {
				arpCells: ["ret_a", "leap_a", "ret_b", "fore_up"],
				arpWindow: HOME_WINDOW,
				bass: ["walk", "walk", "walk", "walk"],
				comp: "short2",
				compRegister: 0,
				accent: "normal",
			},
			arpLevel: [
				58, 60, 62, 60, 62, 64, 66, 64, 66, 68, 70, 68, 64, 68, 72, 62,
			],
			levelOffset: 0,
			// A 1〜12 は短く2打、13〜15 は予告の打ち方、16 は最終小節と同じ
			compHits: [
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"fore",
				"fore",
				"fore",
				"final",
			],
		},
		{
			role: "minorDwell",
			label: "B 短調側に長く留まる",
			startBar: 16,
			bars: 20,
			chords: [
				"vi7",
				"vi7",
				"iii7",
				"iii7",
				"ii7",
				"ii7",
				"vi7",
				"vi7",
				"IVM7",
				"iii7",
				"ii7",
				"iii7",
				"vi7",
				"vi(add9)",
				"IVM7",
				"IVM7(#11)",
				"ii7",
				"iii7",
				"IVM7",
				"Vsus4 V",
			],
			texture: {
				arpCells: ["dw_a", "roll", "dw_walk", "sparse", "rising"],
				arpWindow: { lowMin: 54, lowMax: 57, topMin: 73, topMax: 76 },
				bass: ["sparse", "sparse", "sparse", "sparse", "walkLite"],
				comp: "alt13",
				compRegister: 0,
				accent: "normal",
			},
			arpLevel: [
				50, 50, 52, 52, 52, 54, 52, 52, 54, 54, 56, 56, 54, 56, 56, 58, 56, 56,
				57, 58,
			],
			levelOffset: 0,
			// B: 同じ和音の2小節は1拍目→3拍目（17〜24・29〜32）、1小節1和音は短く2打（25〜28・33〜35）、36 の Bsus4 B は2和音
			compHits: [
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"short2",
				"short2",
				"short2",
				"short2",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"short2",
				"short2",
				"short2",
				"alt13",
			],
		},
		{
			role: "borrowA",
			label: "C1 借りた和音1（♭VI・♭VII）",
			startBar: 36,
			bars: 8,
			chords: [
				"bVIM7",
				"bVIM7(#11)",
				"bVIIadd9",
				"bVIIadd9",
				"bVIM7",
				"bVIM7(#11)",
				"bVIIadd9",
				"bVII",
			],
			texture: {
				arpCells: ["desc_a", "desc_b"],
				arpWindow: { lowMin: 57, lowMax: 60, topMin: 78, topMax: 79 },
				bass: ["pedal", "332"],
				comp: "long",
				compRegister: 0,
				accent: "normal",
			},
			arpLevel: [60, 60, 62, 62, 62, 62, 64, 60],
			levelOffset: 0,
			// C1: 借りた和音は長く
			compHits: [
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
			],
		},
		{
			role: "glimpse",
			label: "R 一度だけ家の近くへ",
			startBar: 44,
			bars: 4,
			chords: ["Iadd9", "IVM7", "iii7 vi7", "ii7"],
			texture: {
				arpCells: ["ret_a_lift"],
				arpWindow: HOME_WINDOW,
				bass: ["thinned"],
				comp: "short2",
				compRegister: 0,
				accent: "normal",
			},
			arpLevel: [52, 51, 51, 50],
			levelOffset: 0,
			// R: A と同じ短い打ち方
			compHits: ["short2", "short2", "short2", "short2"],
		},
		{
			role: "borrowB",
			label: "C2 借りた和音2（♭III・iv・i）",
			startBar: 48,
			bars: 8,
			chords: ["bIIIM7", "bIIIM7", "iv7", "iv7", "bIIIM7", "i7", "iv7", "iv6"],
			texture: {
				arpCells: ["flutter", "asc_walk"],
				arpWindow: { lowMin: 55, lowMax: 64, topMin: 78, topMax: 79 },
				bass: ["pulse8", "pulse8"],
				comp: "long",
				compRegister: 1,
				accent: "normal",
			},
			arpLevel: [64, 66, 68, 70, 74, 76, 70, 64],
			levelOffset: 0,
			// C2: 借りた和音は長く
			compHits: [
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
				"long",
			],
		},
		{
			role: "lift",
			label: "L 全パートが薄く明るい",
			startBar: 56,
			bars: 8,
			chords: [
				"IM7",
				"IVM7",
				"IM7/3",
				"IVM7(9)",
				"vi7",
				"IVM7",
				"ii7",
				"Vsus4",
			],
			texture: {
				arpCells: ["pendulum", "lift_desc"],
				arpWindow: { lowMin: 66, lowMax: 71, topMin: 80, topMax: 83 },
				bass: ["dropout", "dropout"],
				comp: "alt13",
				compRegister: 0,
				accent: "gentle",
			},
			arpLevel: [50, 50, 52, 52, 52, 50, 50, 48],
			levelOffset: 0,
			// L: 1小節に1つ、交互に1拍目・3拍目
			compHits: [
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
				"alt13",
			],
		},
		{
			role: "return",
			label: "A' 静かに戻る",
			startBar: 64,
			bars: 12,
			chords: [
				"Iadd9",
				"IVM7",
				"iii7 vi7",
				"ii7 V",
				"IM7",
				"vi7",
				"IVM7 iii7",
				"ii7 Vsus4",
				"vi7",
				"iii7",
				"IVM7",
				"Vsus4 V",
			],
			texture: {
				arpCells: ["ret_a", "leap_a", "ret_b"],
				arpWindow: HOME_WINDOW,
				bass: ["thinned", "walk", "walk"],
				comp: "short2",
				compRegister: 0,
				accent: "normal",
			},
			arpLevel: [52, 52, 54, 54, 54, 54, 56, 56, 56, 56, 58, 56],
			levelOffset: 0,
			// A' 65〜75 は A と同じ短い打ち方、76 は最終小節
			compHits: [
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"short2",
				"final",
			],
		},
	],
	// 記録（PlanPins、docs/accomp-style-engine.md §3.1）: スタイル fb の型 fb、ミックス fb
	style: "fb",
	archetype: "fb",
	mix: "fb",
};

/**
 * gen-fb.mjs の `CHORDS`（ホ長調の和音名、76小節）。上のローマ数字をホ長調で鳴らした音と
 * 一致するかを検査で確かめる（`romanToC` の検算）。
 */
export const FB_CHORD_NAMES: readonly string[] = [
	// A 1–16
	"Eadd9",
	"AM7",
	"G#m7 C#m7",
	"F#m7 B",
	"EM7",
	"C#m7",
	"AM7 G#m7",
	"F#m7 Bsus4",
	"C#m7",
	"G#m7",
	"AM7 B",
	"C#m7",
	"CM7",
	"Dadd9",
	"GM7 Am7",
	"Bsus4 B",
	// B 17–36
	"C#m7",
	"C#m7",
	"G#m7",
	"G#m7",
	"F#m7",
	"F#m7",
	"C#m7",
	"C#m7",
	"AM7",
	"G#m7",
	"F#m7",
	"G#m7",
	"C#m7",
	"C#m(add9)",
	"AM7",
	"AM7(#11)",
	"F#m7",
	"G#m7",
	"AM7",
	"Bsus4 B",
	// C1 37–44
	"CM7",
	"CM7(#11)",
	"Dadd9",
	"Dadd9",
	"CM7",
	"CM7(#11)",
	"Dadd9",
	"D",
	// R 45–48
	"Eadd9",
	"AM7",
	"G#m7 C#m7",
	"F#m7",
	// C2 49–56
	"GM7",
	"GM7",
	"Am7",
	"Am7",
	"GM7",
	"Em7",
	"Am7",
	"Am6",
	// L 57–64
	"EM7",
	"AM7",
	"EM7/G#",
	"AM7(9)",
	"C#m7",
	"AM7",
	"F#m7",
	"Bsus4",
	// A' 65–76
	"Eadd9",
	"AM7",
	"G#m7 C#m7",
	"F#m7 B",
	"EM7",
	"C#m7",
	"AM7 G#m7",
	"F#m7 Bsus4",
	"C#m7",
	"G#m7",
	"AM7",
	"Bsus4 B",
];

/**
 * fb.mml の実測（区間ごと。`parseMML` で測った値、§2.2・§7.3）。陽性対照（fb の計画を realize したもの）が
 * これに許容幅で一致するかを確かめる（§12.3）。**品質の目標ではない**（採点・選抜には使わない）。
 * - `arpPerSec` 分散の毎秒の音数（M1）
 * - `upperMean` 分散の音を高さ順に並べた上半分の平均（MIDI、M9）
 * - `bassPerBar` 低音の1小節あたりの音数（M5）
 * - `roundTrip` 往復率 p[i]=p[i−2]≠p[i−1] の割合（M2）
 * - `vMean` 分散の v の平均（M10）
 * - `compHitsPerBar` 和音の1小節あたりの打つ回数
 */
export const FB_METRICS: Readonly<
	Record<
		string,
		{
			arpPerSec: number;
			upperMean: number;
			bassPerBar: number;
			roundTrip: number;
			vMean: number;
			compHitsPerBar: number;
		}
	>
> = {
	home: {
		arpPerSec: 4.67,
		upperMean: 73.7,
		bassPerBar: 5.44,
		roundTrip: 0.373,
		vMean: 66.3,
		compHitsPerBar: 2,
	},
	minorDwell: {
		arpPerSec: 4.39,
		upperMean: 68.9,
		bassPerBar: 2.8,
		roundTrip: 0.134,
		vMean: 56.2,
		compHitsPerBar: 1.4,
	},
	borrowA: {
		arpPerSec: 4.43,
		upperMean: 74.7,
		bassPerBar: 2.5,
		roundTrip: 0.014,
		vMean: 63.9,
		compHitsPerBar: 1,
	},
	glimpse: {
		arpPerSec: 4.67,
		upperMean: 73.7,
		bassPerBar: 3.25,
		roundTrip: 0.132,
		vMean: 53,
		compHitsPerBar: 2,
	},
	borrowB: {
		arpPerSec: 4.43,
		upperMean: 74.5,
		bassPerBar: 5.5,
		roundTrip: 0.014,
		vMean: 71.3,
		compHitsPerBar: 1,
	},
	lift: {
		arpPerSec: 3.97,
		upperMean: 76.9,
		bassPerBar: 0.625,
		roundTrip: 0.197,
		vMean: 51.7,
		compHitsPerBar: 1,
	},
	return: {
		arpPerSec: 4.67,
		upperMean: 73.3,
		bassPerBar: 4.75,
		roundTrip: 0.373,
		vMean: 56.4,
		compHitsPerBar: 2,
	},
};

/**
 * fb の @0（gen-fb.mjs の `MEL`）。小節は1始まり、位置と長さは16分の数、高さは実際に鳴る MIDI（ホ長調）。
 * C2 の50小節は ♭III の長7度 F#5、51小節は iv の5度 E5、54小節は i の短7度 D5、55小節は iv の短3度 C5。
 * 76小節は Bsus4 の E5 → B の D#5。長さは組の1つめが2拍、2つめが3拍、最終小節が2拍ずつ（§6 段8）。
 */
export const FB_COLOR_LINE: readonly {
	bar: number;
	pos16: number;
	len16: number;
	midi: number;
	v: number;
}[] = [
	{ bar: 50, pos16: 4, len16: 8, midi: 78, v: 36 },
	{ bar: 51, pos16: 0, len16: 12, midi: 76, v: 36 },
	{ bar: 54, pos16: 4, len16: 8, midi: 74, v: 36 },
	{ bar: 55, pos16: 0, len16: 12, midi: 72, v: 34 },
	{ bar: 76, pos16: 0, len16: 8, midi: 76, v: 34 },
	{ bar: 76, pos16: 8, len16: 8, midi: 75, v: 34 },
];

/** fb.mml のトラックごとの v の種類数（@0〜@3）と、全トラックのぶつかり（短2度・短9度、1小節あたり）。 */
export const FB_V_KINDS = [2, 30, 19, 26] as const;
export const FB_CLASHES_PER_BAR = 0.237;

/** gen-fb.mjs の `V`（fb の和音の手選びの置き方、MIDI）。陽性対照の辞書一致率に使う（§6 段4）。 */
export const FB_VOICINGS: Readonly<Record<string, readonly number[]>> = {
	Eadd9: [56, 59, 66],
	EM7: [56, 59, 63],
	AM7: [56, 61, 64],
	"G#m7": [54, 59, 63],
	"C#m7": [56, 59, 64],
	"F#m7": [57, 61, 64],
	B: [54, 59, 63],
	Bsus4: [54, 59, 64],
	CM7: [55, 59, 64],
	Dadd9: [54, 57, 64],
	GM7: [54, 59, 62],
	Am7: [55, 60, 64],
};
