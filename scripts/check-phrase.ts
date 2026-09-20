/**
 * 「音源にあるのに引けていなかった素片」と「フレーズの切れ目」のチェック。
 *
 * ブレスの作り直し（check-breath.ts）と同じ調査で見つかった残りを直したもの:
 *  - 鼻濁音: カタカナのガ行 / `が゜` → 音源のカタカナ別名（テト・ルコ♀）を最優先で引く。
 *  - ヴ系: `ヴぁ`（ヴ+小書きひらがな）と `ヴァ`（全角カタカナ）の両方の綴りを試し、
 *    無ければバ行で近似する（以前は「ゔ」がかな表に無く、音節ごと無声になっていた）。
 *  - ぢ・づ: 音源に無ければ同じ音の じ・ず を引く（以前は母音だけに落ちていた）。
 *  - `* あ`（テト単独音の柔らかい語中の母音）: 語頭でなければ素の `あ` より優先。
 *  - 旋律側の休符: 歌詞に `_` が無くても、隙間が {@link PHRASE_GAP_SEC} 以上なら
 *    その前を語尾（`a R` の素片）で抜き、その後を語頭（`- か`）で入る。
 *
 * 音は出せないので、候補列（{@link koeAliasCandidates}）と、組み立てたノートの
 * `phraseStart` / `phraseEnd` を突き合わせる。
 */
import Module from "node:module";

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const {
	buildStreamVoiceNotes,
	normalizeLyrics,
	koeAliasCandidates,
	syllablesToText,
	PHRASE_GAP_SEC,
} = require("../src/lyrics") as typeof import("../src/lyrics");
const { units } = require("../src/tuning") as typeof import("../src/tuning");
type TieSourceNote = import("../src/lyrics").TieSourceNote;

let failed = 0;
const check = (ok: boolean, label: string, why: string, detail = ""): void => {
	if (!ok) failed++;
	console.log(
		`  ${ok ? "OK  " : "NG  "}${label}${detail ? `  →  ${detail}` : ""}`,
	);
	console.log(`        ${why}`);
};
/** 候補列の中で a が b より前にあるか（どちらかが無ければ false）。 */
const before = (list: string[], a: string, b: string): boolean => {
	const ia = list.indexOf(a);
	const ib = list.indexOf(b);
	return ia >= 0 && ib >= 0 && ia < ib;
};

// ── 1. 歌詞の解釈 ─────────────────────────────────────────────────
console.log("● 歌詞の解釈（鼻濁音・ヴ・ぢづ）");
{
	const [ga] = normalizeLyrics("ガ");
	check(
		ga.kana === "が" && ga.nasal === true && ga.consonant === "g",
		"ガ（カタカナ）",
		"鼻濁音の印つきの「が」になる",
		JSON.stringify(ga),
	);
	const [gya] = normalizeLyrics("ギャ");
	check(
		gya.kana === "ぎゃ" && gya.nasal === true && gya.vowel === "a",
		"ギャ",
		"拗音も1音節のまま鼻濁音になる",
		JSON.stringify(gya),
	);
	const [ka] = normalizeLyrics("か゚");
	check(
		ka.kana === "か" && ka.nasal === true,
		"か゚（結合半濁点）",
		"標準の書き方 か゚ も同じ印になる",
		JSON.stringify(ka),
	);
	const [ka2] = normalizeLyrics("が゜");
	check(
		ka2.kana === "が" && ka2.nasal === true,
		"が゜（半濁点）",
		"NFKC で分解される ゜ も拾う",
		JSON.stringify(ka2),
	);
	const plain = normalizeLyrics("カ");
	check(
		plain.length === 1 && plain[0].kana === "か" && !plain[0].nasal,
		"カ（カタカナのカ行）",
		"ガ行以外のカタカナは従来どおりひらがなへ畳むだけ",
		JSON.stringify(plain[0]),
	);
	check(
		syllablesToText(normalizeLyrics("ガぎゃギョ、あ")) === "ガぎゃギョ、あ",
		"往復 ガぎゃギョ、あ",
		"鼻濁音はカタカナで書き戻し、読み直しても同じになる",
		syllablesToText(normalizeLyrics("ガぎゃギョ、あ")),
	);
	const stray = normalizeLyrics("゜あ");
	check(
		stray.length === 1 && stray[0].kana === "あ",
		"゜あ（付く相手の無い印）",
		"捨てる（無声の音節にしない）",
		JSON.stringify(stray),
	);
	const [va] = normalizeLyrics("ヴァ");
	check(
		va.kana === "ゔぁ" && va.consonant === "v" && va.vowel === "a",
		"ヴァ",
		"以前は「ゔ」がかな表に無く母音が空（無声）になっていた",
		JSON.stringify(va),
	);
	const [vu] = normalizeLyrics("ヴ");
	check(
		vu.consonant === "v" && vu.vowel === "u",
		"ヴ",
		"単独のヴは vu",
		JSON.stringify(vu),
	);
}

// ── 2. エイリアス候補の順序 ───────────────────────────────────────
console.log("\n● エイリアス候補の順序");
{
	const [ga] = normalizeLyrics("ガ");
	const c = koeAliasCandidates(ga, "a");
	check(
		c[0] === "a ガ" && c[1] === "ガ" && before(c, "ガ", "a が"),
		"鼻濁音 ガ（直前 a）",
		"カタカナ別名（連続音→単独音）を、ふつうの が より先に",
		c.slice(0, 4).join(" > "),
	);
	const [di] = normalizeLyrics("ぢ");
	const cd = koeAliasCandidates(di, "a");
	check(
		before(cd, "a ぢ", "a じ") &&
			before(cd, "a じ", "a い") &&
			before(cd, "じ", "い"),
		"ぢ（直前 a）",
		"綴りどおり → 同じ音の じ → 母音 の順（母音へ落ちる前に じ を試す）",
		cd.join(" > "),
	);
	const [dya] = normalizeLyrics("ぢゃ");
	check(
		koeAliasCandidates(dya, "").includes("じゃ"),
		"ぢゃ",
		"拗音も じゃ へ",
		koeAliasCandidates(dya, "").join(" > "),
	);
	const [va] = normalizeLyrics("ヴァ");
	const cv = koeAliasCandidates(va, "");
	check(
		before(cv, "- ヴぁ", "ヴぁ") &&
			cv.includes("ヴァ") &&
			before(cv, "ヴァ", "ば") &&
			before(cv, "ば", "あ"),
		"ヴァ（語頭）",
		"ヴぁ / ヴァ の両綴り → バ行 → 母音 の順",
		cv.join(" > "),
	);
	const [a] = normalizeLyrics("あ");
	const mid = koeAliasCandidates(a, "i");
	const head = koeAliasCandidates(a, "");
	check(
		before(mid, "i あ", "* あ") && before(mid, "* あ", "あ"),
		"あ（語中、直前 i）",
		"連続音 → 柔らかい * あ → 素の あ",
		mid.slice(0, 4).join(" > "),
	);
	check(
		!head.includes("* あ") && head[0] === "- あ",
		"あ（語頭）",
		"語頭には * あ を出さない（語頭の素片 - あ が先）",
		head.slice(0, 3).join(" > "),
	);
	const [tie] = normalizeLyrics("あー").slice(1);
	const ct = koeAliasCandidates(tie, "a");
	check(
		before(ct, "a あ", "* あ") &&
			before(ct, "* あ", "あ") &&
			!ct.some((x) => /^[a-z]+ [ぁ-ん]/.test(x) && x !== "a あ"),
		"ー（継続、母音 a）",
		"継続は子音つきを引かず、a あ → * あ → あ",
		ct.join(" > "),
	);
}

// ── 3. フレーズの切れ目 ───────────────────────────────────────────
console.log("\n● フレーズの切れ目（旋律側の休符）");
const SECONDS_PER_STEP = 0.25;
/** [開始ステップ, 長さ] の並びからノート列を作る（隙間を書ける）。 */
const notesAt = (spans: [number, number][]): TieSourceNote[] =>
	spans.map(([startStep, durationSteps]) => ({
		startStep,
		durationSteps,
		pitchUnits: units(2139),
	}));
const build = (lyrics: string, spans: [number, number][]) =>
	buildStreamVoiceNotes(normalizeLyrics(lyrics), notesAt(spans), {
		fromStep: 0,
		secondsPerStep: SECONDS_PER_STEP,
		gate: 1,
		octaveShiftUnits: 0,
	});
const flags = (n: { phraseStart?: boolean; phraseEnd?: boolean }): string =>
	`${n.phraseStart ? "S" : "-"}${n.phraseEnd ? "E" : "-"}`;
{
	const ns = build("あいう", [
		[0, 1],
		[1, 1],
		[2, 1],
	]);
	check(
		ns.map(flags).join(" ") === "-- -- -E",
		"あいう（隙間なし）",
		"最後だけフレーズの終わり。途中は語頭にも語尾にもならない",
		ns.map(flags).join(" "),
	);
}
{
	// 1ステップ＝0.25s の休符（PHRASE_GAP_SEC 以上）
	const ns = build("あいう", [
		[0, 1],
		[2, 1],
		[3, 1],
	]);
	check(
		ns.map(flags).join(" ") === "-E S- -E",
		"あ _ いう（旋律に休符）",
		`${PHRASE_GAP_SEC}s 以上の隙間: 前を語尾で抜き、後を語頭で入る（歌詞に _ が無くても）`,
		ns.map(flags).join(" "),
	);
}
{
	// 0.1s の隙間（PHRASE_GAP_SEC 未満）
	const ns = build("あい", [
		[0, 1],
		[1.4, 1],
	]);
	check(
		ns.map(flags).join(" ") === "-- -E",
		"あ い（0.1s の隙間）",
		"短い隙間はスタッカート扱い。声の文脈は繋いだまま",
		ns.map(flags).join(" "),
	);
}
{
	const ns = build("あ、い", [
		[0, 2],
		[2, 1],
	]);
	check(
		ns.map(flags).join(" ") === "-E -E",
		"あ、い（ブレス）",
		"ブレスの前はフレーズの終わり",
		ns.map(flags).join(" "),
	);
}
{
	const ns = build("あっい", [
		[0, 1],
		[1, 1],
		[2, 1],
	]);
	check(
		ns.length === 3 && flags(ns[0]) === "--" && flags(ns[2]) === "-E",
		"あっい（促音）",
		"促音の前は閉鎖であって抜けではないので語尾にしない",
		ns.map(flags).join(" "),
	);
}
{
	const ns = build("あ_い", [
		[0, 1],
		[1, 1],
		[2, 1],
	]);
	check(
		flags(ns[0]) === "-E" && flags(ns[2]) === "-E",
		"あ_い（歌詞の休符）",
		"歌詞の休符の前も語尾で抜く",
		ns.map(flags).join(" "),
	);
}
{
	const ns = build("あ↓い", [
		[0, 1],
		[2, 1],
	]);
	check(
		flags(ns[0]) === "--",
		"あ↓ い（消えていく音の後に休符）",
		"↓ で 0 まで落ちる音には抜く声が無いので語尾を付けない",
		ns.map(flags).join(" "),
	);
}
{
	const ns = build("あーい", [
		[0, 1],
		[1, 1],
		[3, 1],
	]);
	check(
		ns.length === 2 && flags(ns[0]) === "-E" && flags(ns[1]) === "SE",
		"あー い（結合した音のあとに休符）",
		"結合後の最後の区間の終わりから隙間を測る（い は行末なので語尾も立つ）",
		ns.map(flags).join(" "),
	);
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
