/**
 * 和音・連符の囲み記号が、環境をまたいで同じ音に読めるか。
 *
 * 本アプリの書き出しは `'ceg'4`（サクラ系のシングルクォート）で、読み込みは
 * `[ceg]4`（FlMML）と `"ceg"4` も受ける。囲みの中のオクターブ指定
 * （`o5` `<` `>`）は3記法で同じ意味を持たなければならない。
 *
 * クォートは開きと閉じが同じ文字なので、**閉じを欠いたクォートを和音と
 * みなさない**ことが要点。みなすと、対を欠いた ' ひとつで以降のトラック
 * 全部が1つの和音に潰れる（単音の羅列が全部同時に鳴る曲になる）。
 *
 * 波括弧 `{ceg}4` は FlMML・PMD 系では**連符**（囲みの後ろの音長が合計になるよう
 * 中の音符へ配分する）であって和音ではない。和音として読んでいないことと、連符として
 * 正しく配分できていることを併せて検算する。
 */

import Module from "node:module";

// `src/mml-parser.ts` は歌詞解析のために `src/lyrics.ts` を、その先で歌唱合成エンジン
// @onjmin/koe（ブラウザ専用）を読む。ノート配置しか触らないので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { parseMML } =
	require("../src/mml-parser") as typeof import("../src/mml-parser");
const { MMLCore } =
	require("../src/mml-core") as typeof import("../src/mml-core");
type Note = import("../src/types").Note;
type CoreEventHandlers = import("../src/types").CoreEventHandlers;
type RenderConfig = import("../src/types").RenderConfig;

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	if (a === b) {
		console.log(`  ok   ${label}`);
		return;
	}
	console.error(`  NG   ${label}\n       got    ${a}\n       expect ${b}`);
	failed++;
};

/** 発音を「開始ステップ:音高/長さ」の一覧へ畳む（比較しやすい形）。 */
const shape = (mml: string): string[] =>
	parseMML(mml).placements.map(
		(p) => `${p.startStep}:${p.pitchUnits}/${p.durationSteps}`,
	);

console.log("和音の囲み記号");
const bracket = shape("@0 o4 [ceg]4");
check("[ceg]4 が3音同時", bracket, ["0:1860/48", "0:1984/48", "0:2077/48"]);
check("'ceg'4 は [ceg]4 と同じ", shape("@0 o4 'ceg'4"), bracket);
check('"ceg"4 は [ceg]4 と同じ', shape('@0 o4 "ceg"4'), bracket);

console.log("囲みの中のオクターブ");
const spread = shape("@0 o4 [o4bo5eao6c]4");
check("[o4b o5e a o6c]4 が B4/E5/A5/C6", spread, [
	"0:2201/48",
	"0:2356/48",
	"0:2511/48",
	"0:2604/48",
]);
check("'o4bo5eao6c'4 も同じ", shape("@0 o4 'o4bo5eao6c'4"), spread);
check("囲みの後はオクターブが戻る", shape("@0 o4 'o6c'4 c4"), [
	"0:2604/48",
	"48:1860/48",
]);

console.log("閉じを欠いたクォート");
// 和音とみなしたら、以降の c e g c が全部 step 0 に積まれてしまう。
check("'ceg c4 は和音にならない", shape("@0 o4 'ceg c4"), [
	"0:1860/12",
	"12:1984/12",
	"24:2077/12",
	"36:1860/48",
]);

console.log("他の記法と混ざらない");
// サクラの `'ceg'音長,ゲート`。ゲート指定は読み飛ばし、次の音符を巻き込まない。
check("'ceg'4,%70 の後の c4 が独立", shape("@0 o4 'ceg'4,%70 c4"), [
	"0:1860/48",
	"0:1984/48",
	"0:2077/48",
	"48:1860/48",
]);
// `{ }` は FlMML・PMD 系では**連符**。和音として読むと3音が step 0 に積まれる。
check("{ceg}4 は和音ではなく連符", shape("@0 o4 {ceg}4"), [
	"0:1860/16",
	"16:1984/16",
	"32:2077/16",
]);

console.log("連符");
// 割り切れる連符。4分音符(48)を3等分＝12分音符(16)ずつ。
check("{ceg}4 は12分音符×3", shape("@0 o4 {ceg}4"), [
	"0:1860/16",
	"16:1984/16",
	"32:2077/16",
]);
// 割り切れない連符。端数を全体へ散らし、合計は指定音長ちょうどに収める
// （末尾に寄せると、連符のたびに後続が少しずつ前後する）。
check("{cdefg}4 の5連符が合計48ステップ", shape("@0 o4 {cdefg}4"), [
	"0:1860/10",
	"10:1922/9",
	"19:1984/10",
	"29:2015/9",
	"38:2077/10",
]);
check("連符の次の音符が指定音長の直後から", shape("@0 o4 {cde}4 c4"), [
	"0:1860/16",
	"16:1922/16",
	"32:1984/16",
	"48:1860/48",
]);
// 中に音長が書かれていれば、等分ではなくその比で割る（mck 系の記法）。
check("{g2e4e4}2 は 2:1:1", shape("@0 o4 {g2e4e4}2"), [
	"0:2077/48",
	"48:1984/24",
	"72:1984/24",
]);
check("連符の中の休符が場所を取る", shape("@0 o4 {crc}4"), [
	"0:1860/16",
	"32:1860/16",
]);
// 連符は音長の配分だけを決める囲みなので、中のオクターブ変更は外へ引き継ぐ
// （和音の囲みは1つの塊なので戻す。上の「囲みの後はオクターブが戻る」と対）。
check("連符の中のオクターブは外へ続く", shape("@0 o4 {c>c}4 c4"), [
	"0:1860/24",
	"24:2232/24",
	"48:2232/48",
]);
// 閉じ `}` が無ければ連符とみなさない（FlMML のマクロ等を貼っても壊れないため）。
check("{ceg c4 は連符にならない", shape("@0 o4 {ceg c4"), [
	"0:1860/12",
	"12:1984/12",
	"24:2077/12",
	"36:1860/48",
]);

console.log("書き出し");
// 書き出しの囲みはシングルクォート。大カッコで書き出すと、サクラ系へ貼ったときに
// 和音ではなく繰り返しとして読まれる。
const renderConfig: RenderConfig = {
	stepsPerBar: 192,
	keyCount: 88,
	pitchRangeStart: 0,
	unitsPerRow: 31,
	keyHeight: 12,
	stepWidth: 2,
	edo: 12,
};
const handlers: CoreEventHandlers = {
	onMMLGenerated: () => {},
	onNotesChanged: () => {},
};
const core = new MMLCore(handlers, 100, () => renderConfig);
/** C4・E4・G4 を4分音符で同時に鳴らす1和音。 */
const chord: Note[] = [1860, 1984, 2077].map((pitchUnits, id) => ({
	id,
	startStep: 0,
	durationSteps: 48,
	pitchUnits: pitchUnits as Note["pitchUnits"],
}));
const written = core.getMMLFromNotes(chord, 120, 100);
check("和音を ' で囲んで書き出す", /'[^']+'/.test(written), true);
check("大カッコでは書き出さない", written.includes("["), false);
// 書き出したものを読み直して、同じ和音に戻ること（往復）。
check("書き出し→読み込みで和音が戻る", shape(written), [
	"0:1860/48",
	"0:1984/48",
	"0:2077/48",
]);

if (failed > 0) {
	console.error(`\n${failed} 件が期待と違う`);
	process.exit(1);
}
console.log("\n和音・連符の記法: すべて期待どおり");
