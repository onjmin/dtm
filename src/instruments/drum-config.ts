/**
 * ドラム音源関連の設定
 * ドラムキー値とドラムパターンを定義
 */

export const DRUM_FONT = "FluidR3_GM_sf2_file";

export const DRUM_KEYS = {
	bassDrum1: 36,
	acousticSnare: 38,
	handClap: 39,
	sideStick: 37,
	closedHihat: 42,
	pedalHihat: 44,
	openHihat: 46,
	lowTom: 45,
	lowMidTom: 47,
	highTom: 50,
	crashCymbal1: 49,
	rideCymbal1: 51,
	splashCymbal: 55,
	tambourine: 54,
} as const;

export type DrumPattern = {
	step: number;
	pitch: number;
	velocity: number;
}[];

export type DrumPatternDef<T = AnyDrumPattern> = {
	label: string;
	font?: string;
	pattern: T;
};

import type { SongDrumPattern } from "./song-drum-config";

export type AnyDrumPattern = DrumPattern | SongDrumPattern;

/**
 * ドラム無しを表すパターン名。辞書には載らない（引いても何も鳴らない）。
 * DAW のドラム選択の「なし」と同じ値で、MML には `#drum=none` と書く。
 */
export const NO_DRUM_PATTERN = "none";

/**
 * MML を**全体読み込み**したときに DAW が選ぶドラムパターン。
 *
 * 再生専用プレイヤーは `#drum=` が無ければドラム無しで鳴らすが、DAW は既定が "dance" で、
 * 読み込みも辞書に在る名前しか反映しなかったので、ドラム無しの曲を読み込むとダンスビートが
 * 付いたまま残り、書き出すと `#drum=dance` まで付いていた。そこで揃える。
 *
 * - `#drum` が無い／`none` → {@link NO_DRUM_PATTERN}（ドラム無し）
 * - 辞書に在るパターン → そのパターン
 * - 辞書に無い名前 → null（呼び出し側は今の選択を変えない。従来どおり）
 *
 * 部分読み込み（現在のトラックだけに適用）ではドラムを触らないので、これを呼ばないこと。
 */
export const drumPatternForFullLoad = (
	metaDrum: string | undefined,
	dict: Record<string, unknown>,
): string | null => {
	if (!metaDrum || metaDrum === NO_DRUM_PATTERN) return NO_DRUM_PATTERN;
	return Object.hasOwn(dict, metaDrum) ? metaDrum : null;
};

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

/** ドラムを止める小節の範囲（1始まり・両端を含む）。MML の `#drumrest=49-56,91-109`。 */
export type DrumRest = [number, number][];

export const parseDrumRest = (text: string): DrumRest =>
	text
		.split(",")
		.map((r) => r.split("-").map((x) => Number.parseInt(x, 10)))
		.filter(
			(r): r is [number, number] =>
				r.length === 2 && r.every((x) => Number.isFinite(x) && x >= 1),
		)
		.filter(([s, e]) => s <= e);

export const formatDrumRest = (rest: DrumRest): string =>
	rest.map(([s, e]) => `${s}-${e}`).join(",");

/**
 * 小節の範囲ごとに組み込みの型を替える（1始まり・両端を含む）。MML の
 * `#drumscene=four_ride_busy:25-31,fill_snare:8`。範囲の外は `#drum=` の型、`#drumrest=` が優先。
 * 場面の切り替え（vecolite の 25〜31 小節）と句末のフィルのため（2026-11-18）。
 */
export type DrumScene = [string, number, number][];

export const parseDrumScene = (text: string): DrumScene =>
	text
		.split(",")
		.map((item) => /^(\w+):(\d+)(?:-(\d+))?$/.exec(item.trim()))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m): [string, number, number] => {
			const s = Number.parseInt(m[2], 10);
			return [m[1], s, m[3] ? Number.parseInt(m[3], 10) : s];
		})
		.filter(([, s, e]) => s >= 1 && s <= e);

export const formatDrumScene = (scene: DrumScene): string =>
	scene
		.map(([n, s, e]) => (s === e ? `${n}:${s}` : `${n}:${s}-${e}`))
		.join(",");

export const resolveDrumPattern = (
	name: string,
	dict: Record<string, DrumPatternDef>,
	currentBar: number,
	rest?: DrumRest,
	scene?: DrumScene,
): DrumPattern | null => {
	if (rest?.some(([s, e]) => currentBar >= s && currentBar <= e)) return [];
	// 後に書いた範囲が勝つ（場面の中の1小節だけフィルにする書き方のため）
	const hit = scene
		?.filter(([n, s, e]) => currentBar >= s && currentBar <= e && dict[n])
		.at(-1);
	const def = dict[hit ? hit[0] : name];
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
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
		],
	},

	// 8ビート：クローズドハイハットに強弱をつけ、スネアにクラップを薄く重ねる
	"8beat": {
		label: "8ビート",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
		],
	},

	// 16ビート：キックのダブル（96, 108）を活かしつつ、ハイハットの強弱を細かく設定
	"16beat": {
		label: "16ビート",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 12, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 60, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 84, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 108, pitch: DRUM_KEYS.bassDrum1, velocity: 0.7 },
			{ step: 108, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 132, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 156, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 180, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
		],
	},

	// シャッフル：跳ねるタイミングのベロシティを落として、グルーヴ感を強調
	shuffle: {
		label: "シャッフル",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 32, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 80, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 128, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.8 },
			{ step: 176, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
		],
	},

	// ダンス/EDM：スネアをClapに変更。キックとハイハットの対比を最大化
	dance: {
		label: "ダンス/EDM",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 1.0 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 1.0 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
		],
	},

	// ボサノバ/チル系：リムショット(37)とハイハットの組み合わせ
	bossa: {
		label: "ボサノバ/チル",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.7 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.sideStick, velocity: 0.8 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
		],
	},

	// ファンク/ディスコ：タンバリン(54)でスピード感を出す
	disco: {
		label: "ファンク/ディスコ",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.7 },
			{ step: 24, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.7 },
			{ step: 72, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.7 },
			{ step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.7 },
			{ step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
		],
	},

	// 界隈4つ打ち。dance の骨格で裏拍をクローズド（弱め）にし、2・4拍にクラップ＋薄いスネア、
	// 3・4拍にタンバリン。裏拍オープンハットは16分旋律・矩形波と帯域を取り合う。
	four_clap: {
		label: "界隈4つ打ち（クラップ・裏拍クローズド）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.5 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.tambourine, velocity: 0.6 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.tambourine, velocity: 0.6 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
		],
	},

	// 軽いバックビート。キック1・3拍、スネア2・4拍、ハット4分。8beat より薄く、フィル・タム・クラッシュ無し。
	light_backbeat: {
		label: "軽いバックビート",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 96, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.closedHihat, velocity: 0.5 },
		],
	},
	// 4つ打ち＋2・4拍クラップ＋裏8分のペダルハット。
	four_clap_pedal: {
		label: "4つ打ち（クラップ・裏拍ペダルハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
		],
	},
	// 4つ打ち＋裏8分のオープンハット（クラップ無し）。
	four_openhat: {
		label: "4つ打ち（裏拍オープンハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
		],
	},
	// 4つ打ち＋2・4拍クラップ＋裏8分オープンハット＋各拍の4つ目の16分に閉じハット。
	four_clap_16hat: {
		label: "4つ打ち（クラップ・裏拍ハット＋16分裏ハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.6 },
			{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.6 },
			{ step: 84, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.6 },
			{ step: 132, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.6 },
			{ step: 180, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
		],
	},
	// 以下は流派テンプレート用の変種。4つ打ちと裏8分のハットは共通で、ハットの種類・16分裏・クラップ／スネアを変える。
	four_clap_pedal_open: {
		label: "4つ打ち（クラップ・裏拍ペダル／オープン交互）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
		],
	},
	four_clap_snare_closed: {
		label: "4つ打ち（クラップ＋スネア・裏拍クローズハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.5 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.5 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
		],
	},
	// 裏8分のオープンハットと、その直後の16分の閉じハット（2連打）。
	four_openhat_double: {
		label: "4つ打ち（裏拍オープンハット＋直後の16分）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.45 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 84, pitch: DRUM_KEYS.closedHihat, velocity: 0.45 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 132, pitch: DRUM_KEYS.closedHihat, velocity: 0.45 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 180, pitch: DRUM_KEYS.closedHihat, velocity: 0.45 },
		],
	},
	four_openhat_snare: {
		label: "4つ打ち（2・4拍スネア・裏拍オープンハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.7 },
		],
	},
	// 4つ打ちでない型: 1拍目と2拍目裏のキック、2・4拍のスネア、裏8分のオープンハット。
	break_openhat: {
		label: "ブレイクビーツ（2・4拍スネア・裏拍オープンハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.bassDrum1, velocity: 0.85 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
			{ step: 120, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.65 },
		],
	},
	// 16分裏の閉じハットを2拍目・4拍目の後ろだけに置く。
	four_clap_16hat_sparse: {
		label: "4つ打ち（クラップ・裏拍ハット＋2・4拍の16分裏）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 84, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 180, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
		],
	},
	// 16分裏すべてに弱い閉じハット、裏8分はペダル。
	four_clap_16hat_run: {
		label: "4つ打ち（クラップ・裏拍ペダル＋16分裏の刻み）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 12, pitch: DRUM_KEYS.closedHihat, velocity: 0.35 },
			{ step: 24, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 60, pitch: DRUM_KEYS.closedHihat, velocity: 0.35 },
			{ step: 72, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 84, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 108, pitch: DRUM_KEYS.closedHihat, velocity: 0.35 },
			{ step: 120, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 132, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.9 },
			{ step: 156, pitch: DRUM_KEYS.closedHihat, velocity: 0.35 },
			{ step: 168, pitch: DRUM_KEYS.pedalHihat, velocity: 0.6 },
			{ step: 180, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
		],
	},
	// 裏8分のオープンハットと16分裏の閉じハット（拍の後ろ）に、2・4拍のスネアを重ねる。
	four_clap_16hat_snare: {
		label: "4つ打ち（クラップ＋スネア・裏拍ハット＋16分裏ハット）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 36, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 0.45 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 132, pitch: DRUM_KEYS.closedHihat, velocity: 0.4 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 0.45 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
		],
	},
	// --- 場面とフィル（`#drumscene=` で小節の範囲に当てる型。2026-11-18、vecolite の場面転換と句末から） ---
	// 4つ打ちの頭にクラッシュ。場面の1小節目に当てる。
	crash_four: {
		label: "4つ打ち（頭にクラッシュ）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.8 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 168, pitch: DRUM_KEYS.openHihat, velocity: 0.55 },
		],
	},
	// 句末のフィル: 前半は4つ打ち、後半はスネアの16分を強めながら。
	fill_snare: {
		label: "フィル（スネア16分）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
				step: 96 + i * 12,
				pitch: DRUM_KEYS.acousticSnare,
				velocity: 0.45 + i * 0.07,
			})),
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
		],
	},
	// 句末のフィル: 4拍目でタムを高い方から降りる。
	fill_tom: {
		label: "フィル（タム）",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 24, pitch: DRUM_KEYS.openHihat, velocity: 0.5 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 0.9 },
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 0.85 },
			{ step: 72, pitch: DRUM_KEYS.openHihat, velocity: 0.5 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 120, pitch: DRUM_KEYS.acousticSnare, velocity: 0.7 },
			{ step: 132, pitch: DRUM_KEYS.acousticSnare, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.highTom, velocity: 0.85 },
			{ step: 156, pitch: DRUM_KEYS.highTom, velocity: 0.75 },
			{ step: 168, pitch: DRUM_KEYS.lowMidTom, velocity: 0.85 },
			{ step: 180, pitch: DRUM_KEYS.lowTom, velocity: 0.95 },
		],
	},
	// 引きの小節: 頭にキックとクラッシュだけ、あとは鳴らさない。
	break_hit: {
		label: "頭の一打だけ",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 0, pitch: DRUM_KEYS.crashCymbal1, velocity: 0.75 },
		],
	},
	// 場面転換の型: 4つ打ちにキックの食い込み、16分裏のサイドスティック、8分裏のスネア、ライドの刻み。
	four_ride_busy: {
		label: "4つ打ち（ライド・サイドスティック・食い込み）",
		pattern: [
			...[0, 48, 84, 96, 144, 180].map((step) => ({
				step,
				pitch: DRUM_KEYS.bassDrum1,
				velocity: step % 48 === 0 ? 1.0 : 0.7,
			})),
			...[12, 36, 60, 84, 108, 132, 156, 180].map((step) => ({
				step,
				pitch: DRUM_KEYS.sideStick,
				velocity: 0.45,
			})),
			...[24, 72, 120, 168].map((step) => ({
				step,
				pitch: DRUM_KEYS.acousticSnare,
				velocity: 0.55,
			})),
			...[0, 24, 36, 48, 72, 84, 96, 120, 132, 144, 168, 180].map((step) => ({
				step,
				pitch: DRUM_KEYS.rideCymbal1,
				velocity: step % 48 === 0 ? 0.7 : 0.5,
			})),
		],
	},
	// --- 界隈曲の骨格のドラム型（骨格の抽出スクリプト（削除済み、git 履歴にある） が生成。ここから） ---
	// 出自: Green wisteria/嵌り合う体は (240104.mid)
	kaiwai_1: {
		label: "界隈曲 骨格1",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
		],
	},
	// 出自: さむい/しずむゆうひをみていた (260109.mid)
	kaiwai_2: {
		label: "界隈曲 骨格2",
		pattern: [
			{ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 96, pitch: DRUM_KEYS.bassDrum1, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
		],
	},
	// 出自: 天井の研ナ〇コが気になって眠れない (220904.mid)
	kaiwai_3: {
		label: "界隈曲 骨格3",
		pattern: [
			{ step: 24, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 48, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 72, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 72, pitch: DRUM_KEYS.acousticSnare, velocity: 0.8 },
			{ step: 120, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
			{ step: 144, pitch: DRUM_KEYS.acousticSnare, velocity: 1.0 },
			{ step: 168, pitch: DRUM_KEYS.closedHihat, velocity: 0.6 },
		],
	},
	// 出自: すずぬい/_ (220515.mid)
	kaiwai_4: {
		label: "界隈曲 骨格4",
		pattern: [
			{ step: 48, pitch: DRUM_KEYS.handClap, velocity: 1.0 },
			{ step: 144, pitch: DRUM_KEYS.handClap, velocity: 1.0 },
		],
	},
	// --- （ここまで） ---
};

export const getDrumPatternKeys = (
	name: string,
	dict: Record<string, AnyDrumPattern | DrumPatternDef>,
): number[] => {
	const normalizedDict = normalizeDrumPatterns(dict);
	const def = normalizedDict[name];
	if (!def) return [];
	const patternObj = def.pattern;
	const keys = new Set<number>();

	if (
		Array.isArray(patternObj) &&
		patternObj.length > 0 &&
		"ranges" in patternObj[0]
	) {
		const songDef = patternObj as any;
		for (const i of songDef) {
			for (const p of i.pattern) keys.add(p.pitch);
		}
	} else if (Array.isArray(patternObj)) {
		for (const p of patternObj as any) keys.add(p.pitch);
	}
	return Array.from(keys);
};
