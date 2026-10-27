/**
 * 読み込み欄を1本にまとめたので、選ばれたファイルの形式判定（io/import-format.ts）が
 * MIDI / MusicXML / UST / MML を取り違えないか、分からないものを null にするかを見る。
 */

import { detectImportFormat } from "../../src/io/import-format";

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const ok = got === expect;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) {
		console.log(`        実際: ${String(got)}`);
		console.log(`        期待: ${String(expect)}`);
	}
};
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const MTHD = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]);
const XML = bytes('<?xml version="1.0"?>\n<score-partwise version="4.0">');
const UST = bytes("[#VERSION]\nUST Version1.2\n[#SETTING]\nTempo=120");

console.log("拡張子");
check(".mid", detectImportFormat("a.mid", MTHD), "midi");
check(".MIDI（大文字）", detectImportFormat("a.MIDI", MTHD), "midi");
check(".musicxml", detectImportFormat("a.musicxml", XML), "musicxml");
check(".xml", detectImportFormat("a.xml", XML), "musicxml");
check(".ust", detectImportFormat("a.ust", UST), "ust");
check(".mml", detectImportFormat("a.mml", bytes("t120 cde")), "mml");
check(".txt は MML", detectImportFormat("a.txt", bytes("t120 cde")), "mml");

console.log("中身");
check(
	"MThd なら拡張子違いでも MIDI",
	detectImportFormat("a.bin", MTHD),
	"midi",
);
check("XML 宣言", detectImportFormat("score", XML), "musicxml");
check(
	"BOM 付き XML",
	detectImportFormat("score", new Uint8Array([0xef, 0xbb, 0xbf, ...XML])),
	"musicxml",
);
check("UST の [#VERSION]", detectImportFormat("song", UST), "ust");
check(
	"UST の [#SETTING] 始まり",
	detectImportFormat("song", bytes("[#SETTING]\nTempo=120")),
	"ust",
);

console.log("分からないもの");
check(".mxl（圧縮）", detectImportFormat("a.mxl", bytes("PK\x03\x04")), null);
check(".wav", detectImportFormat("a.wav", bytes("RIFF....WAVE")), null);
check("拡張子なしの文章", detectImportFormat("memo", bytes("hello")), null);

if (failed > 0) {
	console.log(`\n${failed}件 NG`);
	process.exit(1);
}
console.log("\nすべて OK");
