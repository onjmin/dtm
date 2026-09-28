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
	hamari_au_karada_wa: {
		label: "嵌り合う体は",
		font: "FluidR3_GM_sf2_file:0",
		pattern: [
			{
				ranges: [
					[7, 51],
					[53, 99],
				],
				pattern: [{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 }],
			},
			{
				ranges: [[35, 67]],
				pattern: [
					{ step: 0, pitch: 35, velocity: 0.8 },
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 96, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [[69, 100]],
				pattern: [
					{ step: 0, pitch: 35, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 96, pitch: 35, velocity: 0.8 },
					{ step: 96, pitch: 67, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[35, 51],
					[53, 67],
				],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
				],
			},
			{
				ranges: [[69, 99]],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 144, pitch: 67, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
				],
			},
			{
				ranges: [[6, 33]],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
				],
			},
			{
				ranges: [[7, 33]],
				pattern: [
					{ step: 0, pitch: 35, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 96, pitch: 35, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[11, 18],
					[35, 50],
				],
				pattern: [
					{ step: 96, pitch: 67, velocity: 0.8 },
					{ step: 144, pitch: 67, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[23, 26],
					[57, 60],
				],
				pattern: [
					{ step: 0, pitch: 68, velocity: 0.8 },
					{ step: 48, pitch: 67, velocity: 0.8 },
					{ step: 120, pitch: 68, velocity: 0.8 },
					{ step: 144, pitch: 67, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[3, 7],
					[19, 19],
					[23, 23],
					[27, 27],
					[31, 31],
					[53, 53],
					[57, 57],
					[61, 61],
					[65, 65],
				],
				pattern: [{ step: 0, pitch: 57, velocity: 0.8 }],
			},
			{
				ranges: [
					[31, 33],
					[65, 67],
				],
				pattern: [
					{ step: 24, pitch: 77, velocity: 0.8 },
					{ step: 60, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 132, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [[3, 5]],
				pattern: [{ step: 96, pitch: 57, velocity: 0.8 }],
			},
			{
				ranges: [
					[31, 32],
					[65, 66],
				],
				pattern: [{ step: 168, pitch: 77, velocity: 0.8 }],
			},
			{
				ranges: [[1, 2]],
				pattern: [
					{ step: 0, pitch: 62, velocity: 0.8 },
					{ step: 48, pitch: 62, velocity: 0.8 },
					{ step: 96, pitch: 62, velocity: 0.8 },
				],
			},
			{
				ranges: [[1, 1]],
				pattern: [{ step: 144, pitch: 62, velocity: 0.8 }],
			},
			{
				ranges: [[2, 2]],
				pattern: [
					{ step: 36, pitch: 62, velocity: 0.8 },
					{ step: 72, pitch: 62, velocity: 0.8 },
				],
			},
			{
				ranges: [[6, 6]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 108, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
					{ step: 180, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[11, 11],
					[35, 35],
					[43, 43],
					[69, 69],
					[77, 77],
					[85, 85],
					[93, 93],
				],
				pattern: [
					{ step: 0, pitch: 57, velocity: 0.8 },
					{ step: 24, pitch: 77, velocity: 0.8 },
					{ step: 48, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 53, velocity: 0.8 },
					{ step: 132, pitch: 77, velocity: 0.8 },
					{ step: 168, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[12, 12],
					[14, 14],
					[16, 16],
					[18, 18],
					[36, 36],
					[38, 38],
					[40, 40],
					[42, 42],
					[44, 44],
					[46, 46],
					[48, 48],
					[50, 50],
					[70, 70],
					[72, 72],
					[74, 74],
					[76, 76],
					[78, 78],
					[80, 80],
					[82, 82],
					[84, 84],
					[86, 86],
					[88, 88],
					[90, 90],
					[92, 92],
					[94, 94],
					[96, 96],
					[98, 98],
				],
				pattern: [
					{ step: 12, pitch: 77, velocity: 0.8 },
					{ step: 36, pitch: 77, velocity: 0.8 },
					{ step: 72, pitch: 77, velocity: 0.8 },
					{ step: 120, pitch: 77, velocity: 0.8 },
					{ step: 156, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[13, 13],
					[17, 17],
					[37, 37],
					[41, 41],
					[45, 45],
					[49, 49],
					[71, 71],
					[75, 75],
					[79, 79],
					[83, 83],
					[87, 87],
					[91, 91],
					[95, 95],
					[99, 99],
				],
				pattern: [
					{ step: 24, pitch: 77, velocity: 0.8 },
					{ step: 48, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 132, pitch: 77, velocity: 0.8 },
					{ step: 168, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[15, 15],
					[39, 39],
					[47, 47],
					[73, 73],
					[81, 81],
					[89, 89],
					[97, 97],
				],
				pattern: [
					{ step: 0, pitch: 57, velocity: 0.8 },
					{ step: 24, pitch: 77, velocity: 0.8 },
					{ step: 48, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 132, pitch: 77, velocity: 0.8 },
					{ step: 168, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[22, 22],
					[56, 56],
				],
				pattern: [
					{ step: 72, pitch: 77, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 144, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[26, 26],
					[60, 60],
				],
				pattern: [
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 132, pitch: 77, velocity: 0.8 },
					{ step: 168, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[33, 33],
					[67, 67],
				],
				pattern: [{ step: 144, pitch: 110, velocity: 1 }],
			},
			{
				ranges: [
					[34, 34],
					[68, 68],
				],
				pattern: [
					{ step: 0, pitch: 83, velocity: 0.8 },
					{ step: 48, pitch: 83, velocity: 0.8 },
					{ step: 96, pitch: 83, velocity: 0.8 },
				],
			},
			{
				ranges: [[100, 100]],
				pattern: [
					{ step: 12, pitch: 77, velocity: 0.8 },
					{ step: 36, pitch: 77, velocity: 0.8 },
					{ step: 72, pitch: 77, velocity: 0.8 },
				],
			},
		],
	},
	vecolite: {
		label: "vecolite",
		font: "Chaos_sf2_file:0",
		pattern: [
			{
				ranges: [
					[1, 49],
					[51, 53],
					[55, 56],
					[58, 75],
				],
				pattern: [{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [
					[8, 31],
					[60, 75],
				],
				pattern: [{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [
					[9, 24],
					[33, 43],
				],
				pattern: [{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 }],
			},
			{
				ranges: [
					[9, 12],
					[18, 32],
					[42, 48],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [[9, 31]],
				pattern: [{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [
					[10, 16],
					[18, 25],
					[34, 40],
				],
				pattern: [{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.9 }],
			},
			{
				ranges: [[33, 47]],
				pattern: [
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[9, 15],
					[33, 39],
				],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: 48, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[61, 67],
					[69, 75],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[24, 31],
					[72, 75],
				],
				pattern: [{ step: 136, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [
					[61, 66],
					[69, 74],
				],
				pattern: [{ step: 24, pitch: DRUM_KEYS.handClap, velocity: 0.9 }],
			},
			{
				ranges: [
					[61, 63],
					[65, 67],
					[69, 71],
					[73, 75],
				],
				pattern: [
					{ step: 16, pitch: 40, velocity: 0.5 },
					{ step: 40, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
				],
			},
			{
				ranges: [[1, 8]],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[2, 9]],
				pattern: [{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 }],
			},
			{
				ranges: [
					[10, 12],
					[18, 20],
					[22, 25],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[17, 24]],
				pattern: [
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[25, 32]],
				pattern: [{ step: 40, pitch: DRUM_KEYS.sideStick, velocity: 0.9 }],
			},
			{
				ranges: [[26, 33]],
				pattern: [{ step: 0, pitch: 41, velocity: 0.9 }],
			},
			{
				ranges: [[68, 75]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[14, 16],
					[34, 36],
					[38, 40],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[25, 31]],
				pattern: [
					{ step: 48, pitch: 41, velocity: 0.9 },
					{ step: 64, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 72, pitch: 40, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 96, pitch: 41, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 120, pitch: 40, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 144, pitch: 41, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 160, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 168, pitch: 40, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[26, 32]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[60, 66]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 64, pitch: 40, velocity: 0.5 },
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[68, 74]],
				pattern: [{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 }],
			},
			{
				ranges: [
					[17, 19],
					[21, 24],
				],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: 48, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[9, 11],
					[33, 35],
				],
				pattern: [
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[13, 15],
					[37, 39],
				],
				pattern: [
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[26, 28],
					[30, 32],
				],
				pattern: [{ step: 24, pitch: 40, velocity: 0.9 }],
			},
			{
				ranges: [
					[42, 44],
					[46, 48],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[60, 62],
					[64, 66],
				],
				pattern: [
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[17, 17],
					[21, 21],
					[41, 41],
					[45, 45],
					[49, 49],
					[58, 60],
					[67, 68],
				],
				pattern: [{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 }],
			},
			{
				ranges: [[41, 43]],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: 48, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[45, 47]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: 48, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[56, 58]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 160, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[57, 59]],
				pattern: [{ step: 16, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 }],
			},
			{
				ranges: [[68, 70]],
				pattern: [
					{ step: 64, pitch: 40, velocity: 0.5 },
					{ step: 88, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[72, 74]],
				pattern: [
					{ step: 64, pitch: 40, velocity: 0.5 },
					{ step: 88, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[56, 57]],
				pattern: [
					{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[58, 59]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[1, 1]],
				pattern: [{ step: 48, pitch: DRUM_KEYS.splashCymbal, velocity: 0.9 }],
			},
			{
				ranges: [[4, 4]],
				pattern: [
					{ step: 84, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.highTom, velocity: 0.9 },
					{ step: 160, pitch: 48, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
				],
			},
			{
				ranges: [[5, 5]],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.lowTom, velocity: 0.9 },
					{ step: 24, pitch: 43, velocity: 0.9 },
					{ step: 40, pitch: 43, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[8, 8]],
				pattern: [
					{ step: 84, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 180, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
				],
			},
			{
				ranges: [[9, 9]],
				pattern: [
					{ step: 0, pitch: 40, velocity: 0.9 },
					{ step: 8, pitch: 40, velocity: 0.9 },
					{ step: 16, pitch: 40, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.splashCymbal, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[10, 10],
					[14, 14],
					[18, 18],
					[22, 22],
					[34, 34],
					[38, 38],
					[42, 42],
					[44, 44],
					[46, 46],
				],
				pattern: [{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 }],
			},
			{
				ranges: [
					[11, 11],
					[15, 15],
					[35, 35],
					[39, 39],
				],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[12, 12],
					[36, 36],
				],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[13, 13],
					[37, 37],
				],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[16, 16],
					[40, 40],
				],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 96, pitch: 40, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 144, pitch: 52, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[19, 19],
					[43, 43],
				],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[20, 20]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 32, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[23, 23],
					[47, 47],
				],
				pattern: [{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 }],
			},
			{
				ranges: [[24, 24]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 88, pitch: 40, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 152, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 160, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 176, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 176, pitch: 40, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
				],
			},
			{
				ranges: [[25, 25]],
				pattern: [
					{ step: 8, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 48, pitch: 52, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[26, 26],
					[30, 30],
				],
				pattern: [{ step: 48, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 }],
			},
			{
				ranges: [
					[27, 27],
					[31, 31],
				],
				pattern: [{ step: 48, pitch: 52, velocity: 0.9 }],
			},
			{
				ranges: [[28, 28]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.rideCymbal1, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 160, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[29, 29]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 48, pitch: 52, velocity: 0.9 },
				],
			},
			{
				ranges: [[32, 32]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.highTom, velocity: 0.9 },
					{ step: 160, pitch: 48, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 176, pitch: DRUM_KEYS.lowTom, velocity: 0.9 },
					{ step: 184, pitch: 43, velocity: 0.9 },
				],
			},
			{
				ranges: [[33, 33]],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.lowTom, velocity: 0.9 },
					{ step: 32, pitch: 43, velocity: 0.9 },
					{ step: 40, pitch: 41, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.splashCymbal, velocity: 0.9 },
				],
			},
			{
				ranges: [[48, 48]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.splashCymbal, velocity: 0.9 },
					{ step: 48, pitch: 48, velocity: 0.9 },
				],
			},
			{
				ranges: [[51, 51]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[52, 52]],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[53, 53]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[55, 55]],
				pattern: [{ step: 48, pitch: DRUM_KEYS.openHihat, velocity: 0.9 }],
			},
			{
				ranges: [[56, 56]],
				pattern: [
					{ step: 48, pitch: 41, velocity: 0.9 },
					{ step: 64, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 144, pitch: 41, velocity: 0.9 },
				],
			},
			{
				ranges: [[57, 57]],
				pattern: [
					{ step: 24, pitch: 40, velocity: 0.9 },
					{ step: 32, pitch: 40, velocity: 0.9 },
					{ step: 40, pitch: 40, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[58, 58]],
				pattern: [
					{ step: 8, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 152, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 176, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[59, 59]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
				],
			},
			{
				ranges: [[60, 60]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 0, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 24, pitch: 52, velocity: 0.9 },
				],
			},
			{
				ranges: [
					[61, 61],
					[65, 65],
					[69, 69],
					[73, 73],
				],
				pattern: [{ step: 160, pitch: DRUM_KEYS.handClap, velocity: 0.9 }],
			},
			{
				ranges: [[63, 63]],
				pattern: [
					{ step: 160, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 184, pitch: 40, velocity: 0.9 },
				],
			},
			{
				ranges: [[64, 64]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 8, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.acousticSnare, velocity: 1 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[67, 67]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 32, pitch: 40, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.openHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 184, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
				],
			},
			{
				ranges: [[68, 68]],
				pattern: [
					{ step: 16, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 16, pitch: DRUM_KEYS.closedHihat, velocity: 0.9 },
					{ step: 24, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
					{ step: 24, pitch: 52, velocity: 0.9 },
				],
			},
			{
				ranges: [[71, 71]],
				pattern: [
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 168, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
				],
			},
			{
				ranges: [[72, 72]],
				pattern: [
					{ step: 16, pitch: 40, velocity: 0.9 },
					{ step: 24, pitch: 52, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
			{
				ranges: [[75, 75]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
					{ step: 32, pitch: 40, velocity: 0.9 },
					{ step: 40, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 48, pitch: DRUM_KEYS.highTom, velocity: 0.9 },
					{ step: 64, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 64, pitch: 48, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 72, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 88, pitch: DRUM_KEYS.lowTom, velocity: 0.9 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 96, pitch: 48, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.sideStick, velocity: 0.9 },
					{ step: 112, pitch: DRUM_KEYS.lowMidTom, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.lowTom, velocity: 0.9 },
					{ step: 120, pitch: DRUM_KEYS.splashCymbal, velocity: 0.9 },
					{ step: 128, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 136, pitch: 43, velocity: 0.9 },
					{ step: 136, pitch: DRUM_KEYS.pedalHihat, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
					{ step: 144, pitch: 52, velocity: 0.9 },
					{ step: 144, pitch: 41, velocity: 0.9 },
					{ step: 144, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.9 },
				],
			},
		],
	},
	tsuchi_he_to_shizumu_kagerou: {
		label: "つちへとしずむカゲロウ",
		font: "FluidR3_GM_sf2_file:11",
		pattern: [
			{
				ranges: [[8, 85]],
				pattern: [{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 }],
			},
			{
				ranges: [
					[2, 9],
					[15, 52],
					[54, 85],
				],
				pattern: [{ step: 0, pitch: 35, velocity: 0.8 }],
			},
			{
				ranges: [
					[8, 46],
					[50, 85],
				],
				pattern: [{ step: 96, pitch: 35, velocity: 0.8 }],
			},
			{
				ranges: [
					[24, 37],
					[63, 76],
					[102, 115],
					[117, 130],
				],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 168, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[94, 131]],
				pattern: [
					{ step: 0, pitch: 35, velocity: 0.8 },
					{ step: 96, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [[102, 131]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 48, pitch: 60, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[24, 49]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
				],
			},
			{
				ranges: [[24, 46]],
				pattern: [
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 48, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[63, 85]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 48, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[8, 22],
					[78, 85],
				],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[39, 60]],
				pattern: [{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.8 }],
			},
			{
				ranges: [[63, 84]],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 48, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[2, 22]],
				pattern: [{ step: 48, pitch: 35, velocity: 0.8 }],
			},
			{
				ranges: [
					[8, 9],
					[15, 22],
					[51, 52],
					[54, 61],
				],
				pattern: [{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 }],
			},
			{
				ranges: [
					[8, 21],
					[98, 100],
				],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[16, 22],
					[55, 61],
				],
				pattern: [
					{ step: 0, pitch: 77, velocity: 0.8 },
					{ step: 24, pitch: 76, velocity: 0.8 },
					{ step: 48, pitch: 77, velocity: 0.8 },
					{ step: 72, pitch: 76, velocity: 0.8 },
					{ step: 168, pitch: 76, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[50, 61],
					[95, 95],
				],
				pattern: [{ step: 144, pitch: 35, velocity: 0.8 }],
			},
			{
				ranges: [
					[8, 15],
					[51, 54],
				],
				pattern: [
					{ step: 48, pitch: 60, velocity: 0.8 },
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 168, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[39, 49]],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[51, 61]],
				pattern: [
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[51, 60]],
				pattern: [{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.8 }],
			},
			{
				ranges: [[39, 46]],
				pattern: [
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 168, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[78, 84]],
				pattern: [
					{ step: 120, pitch: 60, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 168, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[86, 92]],
				pattern: [{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.8 }],
			},
			{
				ranges: [[2, 7]],
				pattern: [
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
				],
			},
			{
				ranges: [[2, 6]],
				pattern: [
					{ step: 96, pitch: 35, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
					{ step: 144, pitch: 35, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
				],
			},
			{
				ranges: [[97, 100]],
				pattern: [
					{ step: 48, pitch: 35, velocity: 0.8 },
					{ step: 144, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [[11, 13]],
				pattern: [
					{ step: 0, pitch: 35, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [[47, 49]],
				pattern: [{ step: 120, pitch: 35, velocity: 0.8 }],
			},
			{
				ranges: [[100, 101]],
				pattern: [{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.8 }],
			},
			{
				ranges: [[1, 1]],
				pattern: [
					{ step: 0, pitch: 62, velocity: 0.8 },
					{ step: 48, pitch: 62, velocity: 0.8 },
					{ step: 96, pitch: 62, velocity: 0.8 },
					{ step: 144, pitch: 62, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[8, 8],
					[47, 47],
					[86, 86],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 }],
			},
			{
				ranges: [
					[15, 15],
					[54, 54],
				],
				pattern: [
					{ step: 96, pitch: 60, velocity: 0.8 },
					{ step: 144, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[16, 16],
					[55, 55],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 },
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 120, pitch: 77, velocity: 0.8 },
					{ step: 144, pitch: 76, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[17, 17],
					[19, 19],
					[21, 21],
					[56, 56],
					[58, 58],
					[60, 60],
				],
				pattern: [
					{ step: 84, pitch: 77, velocity: 0.8 },
					{ step: 108, pitch: 77, velocity: 0.8 },
					{ step: 120, pitch: 76, velocity: 0.8 },
					{ step: 144, pitch: 77, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[18, 18],
					[20, 20],
					[22, 22],
					[57, 57],
					[59, 59],
					[61, 61],
				],
				pattern: [
					{ step: 96, pitch: 77, velocity: 0.8 },
					{ step: 120, pitch: 77, velocity: 0.8 },
					{ step: 144, pitch: 76, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[23, 23],
					[62, 62],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 36, pitch: 35, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 72, pitch: 35, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[24, 24],
					[39, 39],
					[63, 63],
					[78, 78],
					[117, 117],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.openHihat, velocity: 0.8 }],
			},
			{
				ranges: [[50, 50]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 0, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 36, pitch: 35, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 72, pitch: 35, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 168, pitch: 35, velocity: 0.8 },
				],
			},
			{
				ranges: [[100, 100]],
				pattern: [
					{ step: 96, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 120, pitch: 35, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 168, pitch: 35, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
				],
			},
			{
				ranges: [[101, 101]],
				pattern: [
					{ step: 36, pitch: 35, velocity: 0.8 },
					{ step: 36, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 72, pitch: 35, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.handClap, velocity: 0.8 },
					{ step: 96, pitch: 60, velocity: 0 },
					{ step: 108, pitch: 60, velocity: 0.1 },
					{ step: 120, pitch: 60, velocity: 0.3 },
					{ step: 132, pitch: 60, velocity: 0.3 },
					{ step: 144, pitch: 60, velocity: 0.5 },
					{ step: 156, pitch: 60, velocity: 0.6 },
					{ step: 168, pitch: 60, velocity: 0.7 },
					{ step: 180, pitch: 60, velocity: 0.8 },
				],
			},
			{
				ranges: [[102, 102]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 },
					{ step: 0, pitch: DRUM_KEYS.openHihat, velocity: 0.8 },
				],
			},
		],
	},
	asayake: {
		label: "あさやけもゆうやけもないんだ",
		font: "FluidR3_GM_sf2_file:11",
		pattern: [
			{
				ranges: [[1, 101]],
				pattern: [{ step: 48, pitch: 56, velocity: 0.8 }],
			},
			{
				ranges: [[2, 101]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 36, pitch: 56, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 48, pitch: 40, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 72, pitch: 56, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.8 },
					{ step: 144, pitch: 40, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[1, 6],
					[17, 18],
					[21, 46],
					[57, 58],
					[61, 101],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.tambourine, velocity: 0.8 }],
			},
			{
				ranges: [
					[1, 5],
					[19, 45],
					[59, 101],
				],
				pattern: [{ step: 96, pitch: DRUM_KEYS.tambourine, velocity: 0.8 }],
			},
			{
				ranges: [
					[1, 4],
					[14, 20],
					[22, 28],
					[30, 36],
					[38, 44],
					[54, 60],
					[62, 68],
					[70, 76],
					[78, 84],
					[86, 92],
					[94, 100],
				],
				pattern: [
					{ step: 132, pitch: 56, velocity: 0.8 },
					{ step: 144, pitch: 56, velocity: 0.8 },
					{ step: 168, pitch: 56, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[5, 14],
					[45, 54],
				],
				pattern: [{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 }],
			},
			{
				ranges: [
					[7, 13],
					[15, 16],
					[47, 53],
					[55, 56],
				],
				pattern: [{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 }],
			},
			{
				ranges: [
					[6, 12],
					[46, 52],
				],
				pattern: [
					{ step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 132, pitch: 56, velocity: 0.8 },
					{ step: 144, pitch: 56, velocity: 0.8 },
					{ step: 168, pitch: 56, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[3, 3],
					[19, 21],
					[23, 23],
					[27, 27],
					[31, 31],
					[35, 35],
					[39, 39],
					[43, 43],
					[59, 61],
					[63, 63],
					[67, 67],
					[71, 71],
					[75, 75],
					[79, 79],
					[83, 83],
					[87, 87],
					[91, 91],
					[95, 95],
					[99, 99],
				],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[15, 17],
					[55, 57],
				],
				pattern: [
					{ step: 96, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [[1, 1]],
				pattern: [
					{ step: 0, pitch: 56, velocity: 0.8 },
					{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 96, pitch: 56, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[2, 2],
					[6, 6],
					[22, 22],
					[26, 26],
					[30, 30],
					[34, 34],
					[38, 38],
					[42, 42],
					[46, 46],
					[62, 62],
					[66, 66],
					[70, 70],
					[74, 74],
					[78, 78],
					[82, 82],
					[86, 86],
					[90, 90],
					[94, 94],
					[98, 98],
				],
				pattern: [{ step: 0, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 }],
			},
			{
				ranges: [
					[5, 5],
					[45, 45],
				],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 84, pitch: 56, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[10, 10],
					[50, 50],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 0, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[13, 13],
					[53, 53],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 84, pitch: 56, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[14, 14],
					[54, 54],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[18, 18],
					[58, 58],
				],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.splashCymbal, velocity: 0.8 },
					{ step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[21, 21],
					[61, 61],
				],
				pattern: [
					{ step: 84, pitch: 56, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[25, 25],
					[33, 33],
					[41, 41],
					[65, 65],
					[73, 73],
					[81, 81],
					[89, 89],
					[97, 97],
				],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
			{
				ranges: [
					[29, 29],
					[37, 37],
					[69, 69],
					[77, 77],
					[85, 85],
					[93, 93],
					[101, 101],
				],
				pattern: [
					{ step: 48, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 84, pitch: 56, velocity: 0.8 },
					{ step: 132, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
					{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
				],
			},
		],
	},
};
