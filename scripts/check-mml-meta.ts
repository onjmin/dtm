/**
 * MML のトップレベル宣言（`#ver=` など）が、**音符として読まれずに**取り除かれるか。
 *
 * 2.1.11 で `#ver=` を書き出すようにしたが、読み込み側の宣言リストに `ver` が無く、
 * `#ver=2.1.13` が本文に残って `v` `e` `r` … が音符として解釈されていた。結果、
 * 書き出した曲を読み戻すと **track 0 の先頭に E の16分が1つ足される**。
 * 自動作曲のキープ／入れ替えで往復したときに見つかった。
 *
 * 宣言を1つ足すたびにここへ1行足す。宣言リストに載せ忘れると、この検査が
 * 「先頭に音が増える」で拾う。
 */

import Module from "node:module";

// `src/mml-parser.ts` は歌詞解析のために `src/lyrics.ts` を、その先で歌唱合成エンジン
// @onjmin/koe（ブラウザ専用）を読む。宣言文字列の読み書きしか触らないので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { formatMmlMeta, parseMML, parseMmlMeta, stripMmlMeta } =
	require("../src/mml-parser") as typeof import("../src/mml-parser");

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	const ok = a === b;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) {
		console.log(`        実際: ${a}`);
		console.log(`        期待: ${b}`);
	}
};

console.log("■ MML 宣言の除去");

// 書き出しが実際に出す形（自動作曲→キープ）そのままの先頭。本文は4小節休んでから始まる。
const HEADER =
	"#ver=2.1.13 #inst=retro_game #drum=4beat #drumfont=FluidR3_GM_sf2_file:0 #volume=50 #drumvolume=80 #reverb=23 #reverbdecay=17 #reverbpredelay=20 #mastercomp=25 #fadeout=15 #mode=simple #t0inst=Lead 1 (square) #t1inst=Lead 2 (sawtooth) #t0comp=35 #t0width=115 #t0rev=12 #t0eqlo=-2 #t0eqhi=2 #t1pan=82 #t0dly=15;";
const BODY = "\n@0 t134 v100 r1 r1 r1 r1 o5c+4. d+8;\n@1 t134 v92 o4d+4.;\n#end;";

{
	const stripped = stripMmlMeta(HEADER + BODY);
	check("#ver= が本文に残らない", /#ver/.test(stripped), false);
	check(
		"宣言を全部剥がすと本文だけになる",
		stripped.replace(/\s+/g, " ").trim().startsWith("; @0 t134"),
		true,
	);
	const meta = parseMmlMeta(HEADER + BODY);
	check("バージョンが読める（記録用）", meta.version, "2.1.13");
	check("バージョンを書き戻せる", formatMmlMeta(meta, " ").startsWith("#ver=2.1.13 "), true);
}

{
	const r = parseMML(HEADER + BODY, { stepsPerBar: 192, clampTrackCount: 4 });
	const t0 = r.placements
		.filter((p) => p.trackIndex === 0)
		.sort((a, b) => a.startStep - b.startStep);
	check("track 0 の音数（宣言から音が生えていない）", t0.length, 2);
	check("track 0 の最初の音は4小節目の後（step 768）", t0[0]?.startStep, 768);
	check("BPM が読める", r.bpm, 134);
}

{
	// 宣言リストの網羅: 書き出し側が出しうる宣言を全部並べて、剥がした後に `#` が残らないこと。
	const all =
		"#ver=9.9.9 #inst=piano #drum=8beat #drumfont=X_sf2:1 #volume=1 #drumvolume=2 #reverb=3 #reverbdecay=4 #reverbpredelay=5 #delay=6 #delaydiv=8d #mastercomp=7 #fadein=8 #fadeout=9 #mode=advanced #edo=31 #loop=on #audio=https://example.com/a.mp3 #audiostart=1.5 #audioend=2 #audiooffset=-0.25 #audioat=3 #audiovol=50 #t0inst=Lead 1 (square) #t0comp=1 #t0width=2 #t0rev=3 #t0eqlo=-4 #t0eqmid=5 #t0eqhi=-6 #t0pan=7 #t0dly=8;";
	check("全宣言を剥がして # が残らない", /#/.test(stripMmlMeta(all)), false);
}

if (failed > 0) {
	console.error(`\n✗ ${failed} 件失敗`);
	process.exit(1);
}
console.log("✓ MML 宣言の除去: すべて一致");
