/**
 * 読み込みファイルの形式判定。入力欄を1本にまとめたので、選ばれたファイルが
 * MIDI / MusicXML / UST / MML のどれかをここで決めて、各形式の読み込みへ振り分ける。
 *
 * 中身で確かに分かるもの（MIDI の `MThd`）を先に見て、次に拡張子、
 * 拡張子で分からなければ先頭の文字列（XML 宣言、UST の `[#SETTING]` など）で推す。
 */

export type ImportFormat = "midi" | "musicxml" | "ust" | "mml";

/** ファイル選択欄の accept。形式判定は中身も見るが、選びやすさのため拡張子で絞る。 */
export const IMPORT_ACCEPT = ".mid,.midi,.musicxml,.xml,.ust,.mml,.txt";

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
	midi: "MIDI",
	musicxml: "MusicXML",
	ust: "UST",
	mml: "MML",
};

const EXT_FORMATS: Record<string, ImportFormat> = {
	mid: "midi",
	midi: "midi",
	musicxml: "musicxml",
	xml: "musicxml",
	ust: "ust",
	mml: "mml",
	txt: "mml",
};

/** 判定に読むファイル先頭のバイト数。 */
export const IMPORT_SNIFF_BYTES = 512;

/**
 * ファイル名と先頭バイトから形式を決める。分からなければ null。
 * `.mxl`（圧縮 MusicXML）は読めないので null にする。
 */
export const detectImportFormat = (
	name: string,
	head: Uint8Array,
): ImportFormat | null => {
	// MIDI はヘッダが固定なので中身で確定する（拡張子違いでも読める）。
	if (
		head[0] === 0x4d &&
		head[1] === 0x54 &&
		head[2] === 0x68 &&
		head[3] === 0x64
	)
		return "midi";
	const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
	const byExt = EXT_FORMATS[ext];
	if (byExt) return byExt;
	// 拡張子で分からないときは先頭の文字列で推す。UST は Shift_JIS のこともあるが、
	// 見る印は ASCII なのでバイトをそのまま文字にして調べる。
	let text = String.fromCharCode(...head.subarray(0, IMPORT_SNIFF_BYTES));
	text = text.replace(/^\xEF\xBB\xBF/, "").trimStart(); // UTF-8 の BOM
	if (/^<\?xml|^<!DOCTYPE score-|^<score-(partwise|timewise)/.test(text))
		return "musicxml";
	if (/^\[#(VERSION|SETTING|0000)\]/.test(text)) return "ust";
	return null;
};
