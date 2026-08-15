/**
 * ドラム音源関連の設定
 * ドラムキー値とドラムパターンを定義
 */

export const DRUM_FONT = "FluidR3_GM_sf2_file";

export const DRUM_KEYS = {
	kick: 36,
	snare: 38,
	clap: 39,
	rimshot: 37,
	hihatClosed: 42,
	hihatPedal: 44,
	hihatOpen: 46,
	tomLow: 45,
	tomMid: 47,
	tomHigh: 50,
	crash: 49,
	ride: 51,
	splash: 55,
	tambourine: 54,
} as const;

export type DrumPattern = {
	step: number;
	pitch: number;
	velocity: number;
}[];

export type DrumPatternDef<T = AnyDrumPattern> = {
	label: string;
	pattern: T;
};

import type { SongDrumPattern } from "./song-drum-config";

export type AnyDrumPattern = DrumPattern | SongDrumPattern;

export const normalizeDrumPatterns = (
	patterns: Record<string, AnyDrumPattern | DrumPatternDef>,
): Record<string, DrumPatternDef> => {
	const normalized: Record<string, DrumPatternDef> = {};
	for (const [k, v] of Object.entries(patterns)) {
		if (
			Array.isArray(v) ||
			(v && Array.isArray((v as any).pattern) === false && Array.isArray(v))
		) {
			normalized[k] = { label: k, pattern: v as any };
		} else {
			normalized[k] = v as DrumPatternDef;
		}
	}
	return normalized;
};

export const resolveDrumPattern = (
	name: string,
	dict: Record<string, DrumPatternDef>,
	currentBar: number,
): DrumPattern | null => {
	const def = dict[name];
	if (!def) return null;
	const patternObj = def.pattern;
	if (
		Array.isArray(patternObj) &&
		patternObj.length > 0 &&
		"ranges" in patternObj[0]
	) {
		const songDef = patternObj as SongDrumPattern;
		const instructions = songDef.filter((i) =>
			i.ranges.some(([s, e]) => currentBar >= s && currentBar <= e),
		);
		if (instructions.length > 0) {
			return instructions.flatMap((i) => {
				const maxStep = Math.max(...i.pattern.map((p) => p.step), 0);
				const loopLengthBars =
					i.patternBars ?? Math.max(1, Math.ceil((maxStep + 1) / 192));

				const range = i.ranges.find(
					([s, e]) => currentBar >= s && currentBar <= e,
				);
				const startBar = range ? range[0] : 1;
				const barInLoop = (currentBar - startBar) % loopLengthBars;
				const stepOffset = barInLoop * 192;

				return i.pattern
					.filter((p) => p.step >= stepOffset && p.step < stepOffset + 192)
					.map((p) => ({ ...p, step: p.step - stepOffset }));
			});
		}
	}
	return (patternObj as DrumPattern) ?? null;
};

export const DRUM_PATTERNS: Record<string, DrumPatternDef<DrumPattern>> = {
	// 4つ打ち：より重厚に。1拍目の頭にだけ軽くオープンハイハットを混ぜるのもアリ
	"4beat": {
		label: "4つ打ち",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.kick, velocity: 0.9 },
		],
	},

	// 8ビート：クローズドハイハットに強弱をつけ、スネアにクラップを薄く重ねる
	"8beat": {
		label: "8ビート",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.clap, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
		],
	},

	// 16ビート：キックのダブル（96, 108）を活かしつつ、ハイハットの強弱を細かく設定
	"16beat": {
		label: "16ビート",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 12, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 36, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 60, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 84, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 108, pitch: DRUM_KEYS.kick, velocity: 0.7 },
			{ step: 108, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 132, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 156, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 180, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
		],
	},

	// シャッフル：跳ねるタイミングのベロシティを落として、グルーヴ感を強調
	shuffle: {
		label: "シャッフル",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 32, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 80, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 128, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
			{ step: 176, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
		],
	},

	// ダンス/EDM：スネアをClapに変更。キックとハイハットの対比を最大化
	dance: {
		label: "ダンス/EDM",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
			{ step: 48, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.clap, velocity: 1.0 },
			{ step: 72, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
			{ step: 144, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.clap, velocity: 1.0 },
			{ step: 168, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
		],
	},

	// ボサノバ/チル系：リムショット(37)とハイハットの組み合わせ
	bossa: {
		label: "ボサノバ/チル",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.rimshot, velocity: 0.8 },
			{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 72, pitch: DRUM_KEYS.kick, velocity: 0.7 },
			{ step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.rimshot, velocity: 0.8 },
			{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
			{ step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
		],
	},

	// ファンク/ディスコ：タンバリン(54)でスピード感を出す
	disco: {
		label: "ファンク/ディスコ",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
			{ step: 24, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 48, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
			{ step: 72, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 96, pitch: DRUM_KEYS.kick, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
			{ step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 144, pitch: DRUM_KEYS.snare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
			{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
		],
	},
};
