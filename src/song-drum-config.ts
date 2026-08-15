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
	sample_song: {
		label: "サンプル曲",
		pattern: [
			{
				ranges: [[1, 4]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
					{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.snare, velocity: 1.0 },
					{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
				],
			},
			{
				ranges: [[5, 8]],
				pattern: [
					{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
					{ step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
					{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
					{ step: 72, pitch: DRUM_KEYS.kick, velocity: 0.8 },
					{ step: 96, pitch: DRUM_KEYS.snare, velocity: 1.0 },
					{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
				],
			},
		],
	},
};
