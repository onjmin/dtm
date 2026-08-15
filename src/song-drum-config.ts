import {
	DRUM_KEYS,
	type DrumPattern,
	type DrumPatternDef,
} from "./drum-config";

export type SongDrumInstruction = {
	ranges: [number, number][]; // [startBar, endBar]
	patternBars?: number;
	pattern: DrumPattern;
};

export type SongDrumPattern = SongDrumInstruction[];

export const SONG_DRUM_PATTERNS: Record<
	string,
	DrumPatternDef<SongDrumPattern>
> = {
	mimizuki: {
		label: "海鬼月",
		font: "Chaos_sf2_file:0",
		pattern: [
			{
				ranges: [
					[1, 31],
					[33, 52],
					[57, 71],
					[73, 104],
				],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 88, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[1, 52]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 40, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[1, 7],
					[9, 52],
				],
				pattern: [
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 184, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[56, 104]],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 184, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[57, 104]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
					{ step: 40, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[1, 1],
					[5, 5],
					[9, 9],
					[13, 13],
					[17, 17],
					[21, 21],
					[25, 25],
					[29, 29],
					[32, 33],
					[37, 37],
					[41, 41],
					[45, 45],
					[49, 49],
					[53, 53],
					[57, 57],
					[61, 61],
					[65, 65],
					[69, 69],
					[72, 73],
					[77, 77],
					[81, 81],
					[85, 85],
					[89, 89],
					[93, 93],
					[97, 97],
					[101, 101],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 }],
			},
			{
				ranges: [
					[32, 32],
					[72, 72],
				],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.lowTom, velocity: 0.8 },
					{ step: 84, pitch: 43, velocity: 0.8 },
					{ step: 96, pitch: 41, velocity: 0.8 },
					{ step: 112, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 112, pitch: DRUM_KEYS.highTom, velocity: 0.3 },
					{ step: 116, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 116, pitch: DRUM_KEYS.highTom, velocity: 0.3 },
					{ step: 120, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.highTom, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.5 },
					{ step: 136, pitch: DRUM_KEYS.highTom, velocity: 0.5 },
					{ step: 144, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
					{ step: 144, pitch: 48, velocity: 0.8 },
					{ step: 152, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.1 },
					{ step: 160, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 160, pitch: 48, velocity: 0.3 },
					{ step: 160, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.3 },
					{ step: 168, pitch: DRUM_KEYS.sideStick, velocity: 0.6 },
					{ step: 168, pitch: DRUM_KEYS.lowMidTom, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.4 },
					{ step: 176, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 176, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.5 },
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.5 },
					{ step: 184, pitch: DRUM_KEYS.lowMidTom, velocity: 0.3 },
					{ step: 184, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.7 },
				],
			},
			{
				ranges: [
					[56, 56],
					[64, 64],
					[80, 80],
					[88, 88],
				],
				pattern: [
					{ step: 112, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 112, pitch: DRUM_KEYS.highTom, velocity: 0.3 },
					{ step: 116, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 116, pitch: DRUM_KEYS.highTom, velocity: 0.3 },
					{ step: 120, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.highTom, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.5 },
					{ step: 136, pitch: DRUM_KEYS.highTom, velocity: 0.5 },
					{ step: 144, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
					{ step: 144, pitch: 48, velocity: 0.8 },
					{ step: 152, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.1 },
					{ step: 160, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 160, pitch: 48, velocity: 0.3 },
					{ step: 160, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.3 },
					{ step: 168, pitch: DRUM_KEYS.sideStick, velocity: 0.6 },
					{ step: 168, pitch: DRUM_KEYS.lowMidTom, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.4 },
					{ step: 176, pitch: DRUM_KEYS.sideStick, velocity: 0.3 },
					{ step: 176, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.5 },
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.5 },
					{ step: 184, pitch: DRUM_KEYS.lowMidTom, velocity: 0.3 },
					{ step: 184, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.7 },
				],
			},
		],
	},
	budou_ga_kage_kara_nozoiterunda: {
		label: "ブドウがかげからのぞいてるんだ",
		font: "FluidR3_GM_sf2_file:0",
		pattern: [
			{
				ranges: [[1, 91]],
				pattern: [{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 }],
			},
			{
				ranges: [
					[5, 47],
					[49, 88],
				],
				pattern: [{ step: 24, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 }],
			},
			{
				ranges: [
					[13, 47],
					[57, 88],
				],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[37, 92]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
				],
			},
			{
				ranges: [[37, 91]],
				pattern: [{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 }],
			},
			{
				ranges: [[45, 92]],
				pattern: [
					{ step: 0, pitch: 53, velocity: 0.8 },
					{ step: 36, pitch: 67, velocity: 0.5 },
					{ step: 72, pitch: 67, velocity: 0.5 },
				],
			},
			{
				ranges: [[45, 91]],
				pattern: [
					{ step: 144, pitch: 68, velocity: 0.5 },
					{ step: 168, pitch: 60, velocity: 0.8 },
					{ step: 168, pitch: 68, velocity: 0.5 },
					{ step: 180, pitch: 68, velocity: 0.5 },
				],
			},
			{
				ranges: [[57, 92]],
				pattern: [
					{ step: 24, pitch: 67, velocity: 0.5 },
					{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 48, pitch: 53, velocity: 0.8 },
					{ step: 60, pitch: 68, velocity: 0.5 },
					{ step: 96, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[57, 91]],
				pattern: [
					{ step: 120, pitch: 67, velocity: 0.5 },
					{ step: 132, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[1, 29]],
				pattern: [{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 }],
			},
			{
				ranges: [[1, 28]],
				pattern: [{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 }],
			},
			{
				ranges: [[4, 28]],
				pattern: [
					{ step: 0, pitch: 53, velocity: 0.8 },
					{ step: 36, pitch: 67, velocity: 0.5 },
					{ step: 72, pitch: 67, velocity: 0.5 },
					{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 144, pitch: 68, velocity: 0.5 },
					{ step: 168, pitch: 60, velocity: 0.8 },
					{ step: 168, pitch: 68, velocity: 0.5 },
					{ step: 180, pitch: 68, velocity: 0.5 },
				],
			},
			{
				ranges: [[13, 28]],
				pattern: [
					{ step: 24, pitch: 67, velocity: 0.5 },
					{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 48, pitch: 53, velocity: 0.8 },
					{ step: 60, pitch: 68, velocity: 0.5 },
					{ step: 96, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: 67, velocity: 0.5 },
					{ step: 132, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[5, 11],
					[49, 55],
				],
				pattern: [
					{ step: 24, pitch: 67, velocity: 0.5 },
					{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 48, pitch: 53, velocity: 0.8 },
					{ step: 60, pitch: 68, velocity: 0.5 },
					{ step: 72, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 96, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 120, pitch: 67, velocity: 0.5 },
					{ step: 132, pitch: 60, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[37, 47]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
				],
			},
			{
				ranges: [[29, 36]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
				],
			},
			{
				ranges: [[1, 3]],
				pattern: [{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 }],
			},
			{
				ranges: [[45, 47]],
				pattern: [
					{ step: 24, pitch: 67, velocity: 0.5 },
					{ step: 48, pitch: 53, velocity: 0.8 },
					{ step: 60, pitch: 68, velocity: 0.5 },
					{ step: 96, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: 67, velocity: 0.5 },
					{ step: 132, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[4, 4],
					[48, 48],
				],
				pattern: [
					{ step: 0, pitch: 67, velocity: 0.5 },
					{ step: 36, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 36, pitch: 53, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 72, pitch: 53, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: 68, velocity: 0.5 },
					{ step: 144, pitch: 60, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 180, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[12, 12],
					[56, 56],
				],
				pattern: [
					{ step: 0, pitch: 67, velocity: 0.5 },
					{ step: 0, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 0, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 36, pitch: 53, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 60, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 60, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 72, pitch: 53, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: 68, velocity: 0.5 },
					{ step: 144, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[13, 13],
					[21, 21],
					[57, 57],
					[65, 65],
					[73, 73],
					[81, 81],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 }],
			},
			{
				ranges: [[29, 29]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 },
					{ step: 32, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 40, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 128, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[30, 30],
					[32, 32],
					[34, 34],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 8, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 16, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 84, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 156, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 180, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[31, 31],
					[33, 33],
					[35, 35],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 32, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 40, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 128, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 136, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[36, 36]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 8, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 16, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 84, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 102, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 108, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 114, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 126, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 156, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 172, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 176, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 180, pitch: DRUM_KEYS.pedalHihat, velocity: 0.8 },
					{ step: 180, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 184, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 188, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
				],
			},
		],
	},
};
