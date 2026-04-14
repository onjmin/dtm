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

export const DRUM_PATTERNS: Record<string, DrumPattern> = {
	// 4つ打ち：より重厚に。1拍目の頭にだけ軽くオープンハイハットを混ぜるのもアリ
	"4beat": [
		{ step: 0, pitch: DRUM_KEYS.kick, velocity: 1.0 },
		{ step: 48, pitch: DRUM_KEYS.kick, velocity: 0.9 },
		{ step: 96, pitch: DRUM_KEYS.kick, velocity: 1.0 },
		{ step: 144, pitch: DRUM_KEYS.kick, velocity: 0.9 },
	],

	// 8ビート：クローズドハイハットに強弱をつけ、スネアにクラップを薄く重ねる
	"8beat": [
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

	// 16ビート：キックのダブル（96, 108）を活かしつつ、ハイハットの強弱を細かく設定
	"16beat": [
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

	// シャッフル：跳ねるタイミングのベロシティを落として、グルーヴ感を強調
	shuffle: [
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

	// ダンス/EDM：スネアをClapに変更。キックとハイハットの対比を最大化
	dance: [
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

	// ボサノバ/チル系：リムショット(37)とハイハットの組み合わせ
	bossa: [
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

	// ファンク/ディスコ：タンバリン(54)でスピード感を出す
	disco: [
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
};
