/**
 * 外から来た文字列（歌詞・語り・ファイル名など）を、外部のエンジンへ渡す前・画面に出す前に
 * そろえる。
 *
 * JavaScript の文字列に C のようなバッファオーバーフローは無いが、次のことは起こり得る:
 *
 * - 対になっていないサロゲート（壊れた UTF-16）で `encodeURIComponent` が例外を投げる・
 *   XML として不正な文書になる。
 * - 制御文字（NUL など）で XML・ログ・コマンド引数が壊れる。
 * - 向きを変える制御文字（U+202E など）や幅ゼロの文字で、ファイル名や URL の見た目を偽る。
 * - とても長い文字列で、エンジンや画面に過大な負荷をかける。
 */

/** 対になっていないサロゲートを U+FFFD に置き換える（`String.prototype.toWellFormed` 相当）。 */
export const toWellFormed = (s: string): string =>
	s.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		String.fromCharCode(0xfffd),
	);

/**
 * 落とす文字。ソースに見えない文字を直に書かないよう、コードポイントで組み立てる。
 */
const UNSAFE_CHARS = new RegExp(
	[
		"\\u0000-\\u001f",
		"\\u007f-\\u009f",
		"\\u061c",
		"\\u200b-\\u200f",
		"\\u202a-\\u202e",
		"\\u2028",
		"\\u2029",
		"\\u2060",
		"\\u2066-\\u2069",
		"\\ufeff",
		"\\ufffe",
		"\\uffff",
	]
		.join("")
		.replace(/^/, "[")
		.replace(/$/, "]"),
	"g",
);

/**
 * 制御文字（C0・DEL・C1）、向きを変える制御文字（U+061C, U+200E/F, U+202A-202E, U+2066-2069）、
 * 幅ゼロの文字（U+200B-200D, U+2060, U+FEFF）、行・段落区切り（U+2028/2029）、
 * XML で使えない非文字（U+FFFE/FFFF）を落とし、壊れたサロゲートを直し、
 * `maxLength` 文字（コードポイント数）で切る。
 */
export const sanitizeText = (s: string, maxLength: number): string => {
	if (typeof s !== "string") return "";
	const cleaned = toWellFormed(s).replace(UNSAFE_CHARS, "");
	const chars = Array.from(cleaned);
	return chars.length > maxLength
		? chars.slice(0, maxLength).join("")
		: cleaned;
};
