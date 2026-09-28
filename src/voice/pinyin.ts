/**
 * 中国語ピンイン → かな の転写。
 *
 * UTAUの中国語音源は原音名をピンインのまま並べる（`xing` `tou` `she`）。
 * このアプリの歌詞は**かな＝日本語のモーラ**しか持てないので、
 * 「日本語話者がカタカナで書き取る」やり方で寄せる。歌わせた音は
 * 日本語訛りの中国語になるが、読めない綴りとして落とすよりはるかに近い。
 *
 * 割り切っていること:
 * - **声調は落とす。** 歌では旋律が声調を上書きするので、実害が小さい。
 * - **日本語に無い音は慣用のカタカナ表記へ倒す。** そり舌音（`zh` `ch` `sh` `r`）は
 *   ジャ／チャ／シャ行、`e`[ɤ] はア段（`le` → ラ、`she` → シャ）、舌尖母音の
 *   `i`（`zi` `ci` `si` `zhi` …）はズ／ツ／ス／ジ…、`ü` はユ段。
 * - **1音節が複数モーラになる。** `xing` → シ＋ン、`tou` → ト＋オ、`guo` → グ＋オ。
 *   このアプリは1ノート1モーラなので、呼び出し側はノートを割って割り当てる
 *   （撥音を独立ノートに置くのは日本語の歌でも同じ）。
 */

/** 主母音（介音としても使う）。 */
type PinyinVowel = "a" | "i" | "u" | "e" | "o" | "ü";
/** 韻尾。`i` `o` は二重母音の後ろ、`n` は -n / -ng、`r` は er。 */
type PinyinCoda = "" | "i" | "o" | "n" | "r";

/** {@link ONSET_ROWS} の列の並び。 */
const VOWEL_ORDER: PinyinVowel[] = ["a", "i", "u", "e", "o", "ü"];

/**
 * 声母 → 主母音ごとの頭のかな。`*` はその組み合わせがピンインに無い位置。
 *
 * 日本語のかな表と違い、同じ行でも綴りが不規則（`d` の i は「でぃ」、`z` の i は
 * 舌尖母音で「ず」）なので、規則で組み立てず素直に並べる。
 */
const ONSET_ROWS: [string, string][] = [
	["", "あ/い/う/え/お/ゆ"],
	["b", "ば/び/ぶ/べ/ぼ/*"],
	["p", "ぱ/ぴ/ぷ/ぺ/ぽ/*"],
	["m", "ま/み/む/め/も/*"],
	["f", "ふぁ/*/ふ/ふぇ/ふぉ/*"],
	["d", "だ/でぃ/どぅ/で/ど/*"],
	["t", "た/てぃ/とぅ/て/と/*"],
	["n", "な/に/ぬ/ね/の/にゅ"],
	["l", "ら/り/る/れ/ろ/りゅ"],
	["g", "が/*/ぐ/げ/ご/*"],
	["k", "か/*/く/け/こ/*"],
	["h", "は/*/ふ/へ/ほ/*"],
	["j", "*/じ/*/*/*/じゅ"],
	["q", "*/ち/*/*/*/ちゅ"],
	["x", "*/し/*/*/*/しゅ"],
	["zh", "じゃ/じ/じゅ/じぇ/じょ/*"],
	["ch", "ちゃ/ち/ちゅ/ちぇ/ちょ/*"],
	["sh", "しゃ/し/しゅ/しぇ/しょ/*"],
	["r", "ら/り/る/れ/ろ/*"],
	["z", "ざ/ず/ず/ぜ/ぞ/*"],
	["c", "つぁ/つ/つ/つぇ/つぉ/*"],
	["s", "さ/す/す/せ/そ/*"],
];

const PINYIN_ONSET: Record<
	string,
	Partial<Record<PinyinVowel, string>>
> = (() => {
	const table: Record<string, Partial<Record<PinyinVowel, string>>> = {};
	for (const [initial, row] of ONSET_ROWS) {
		const columns = row.split("/");
		const map: Partial<Record<PinyinVowel, string>> = {};
		VOWEL_ORDER.forEach((vowel, i) => {
			if (columns[i] !== "*") map[vowel] = columns[i];
		});
		table[initial] = map;
	}
	return table;
})();

/**
 * 韻母 → [介音, 主母音, 韻尾]。綴りの省略形（`iu` `ui` `un`）は
 * {@link SPELLED_OUT} で元へ戻してから引く。
 *
 * `e`[ɤ] をア段へ倒すのは慣用（`de` → ダ、`re` → ラ）。ただし `-en` `-eng` `-ei` は
 * エ段が慣用なので（`hen` → ヘン、`mei` → メイ）、主母音を e のままにする。
 *
 * `-iu`（= iou）の主母音も o。綴りに引かれてウ段（`liu` → リュ）にすると
 * 実際の音[joʊ]から遠ざかるので、`liu` → リョオ、`you` → ヨオ と写す。
 */
const PINYIN_FINALS: Record<
	string,
	[PinyinVowel | "", PinyinVowel, PinyinCoda]
> = {
	a: ["", "a", ""],
	o: ["", "o", ""],
	e: ["", "a", ""],
	er: ["", "a", "r"],
	ai: ["", "a", "i"],
	ei: ["", "e", "i"],
	ao: ["", "a", "o"],
	ou: ["", "o", "o"],
	an: ["", "a", "n"],
	en: ["", "e", "n"],
	ang: ["", "a", "n"],
	eng: ["", "e", "n"],
	ong: ["", "o", "n"],
	i: ["", "i", ""],
	ia: ["i", "a", ""],
	ie: ["i", "e", ""],
	iao: ["i", "a", "o"],
	iou: ["i", "o", "o"],
	ian: ["i", "e", "n"],
	in: ["", "i", "n"],
	iang: ["i", "a", "n"],
	ing: ["", "i", "n"],
	iong: ["i", "o", "n"],
	u: ["", "u", ""],
	ua: ["u", "a", ""],
	uo: ["u", "o", ""],
	uai: ["u", "a", "i"],
	uei: ["u", "e", "i"],
	uan: ["u", "a", "n"],
	uen: ["u", "e", "n"],
	uang: ["u", "a", "n"],
	ueng: ["u", "e", "n"],
	ü: ["", "ü", ""],
	üe: ["ü", "e", ""],
	üan: ["ü", "e", "n"],
	ün: ["", "ü", "n"],
};

/** 綴りの省略形を元の韻母へ戻す（`liu` = liou、`dui` = duei、`dun` = duen）。 */
const SPELLED_OUT: Record<string, string> = {
	iu: "iou",
	ui: "uei",
	un: "uen",
};

/**
 * 韻尾のかな。`-n` も `-ng` も撥音へ倒す（日本語は区別を持たない）。
 * 二重母音の後半（`-ao` `-ou`）はどちらもオ段。カタカナの慣用は「トウ」だが、
 * 歌わせると「う」が独立した母音として鳴って不自然になる。`-ou` の韻尾は
 * 円唇の[ʊ]なので、オ段に倒したほうが原音に近い（`hao` → ハオ、`tou` → トオ）。
 */
const CODA_KANA: Record<PinyinCoda, string> = {
	"": "",
	i: "い",
	o: "お",
	n: "ん",
	r: "る",
};

/** 主母音そのもののかな（介音の後ろへ別モーラとして置くとき用）。 */
const VOWEL_KANA: Record<PinyinVowel, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
	ü: "ゆ",
};

/** 拗音の小書きかな。介音 i / ü は頭のかなへ畳む（`xia` = し＋ゃ）。 */
const SMALL_KANA: Partial<Record<PinyinVowel, string>> = {
	a: "ゃ",
	u: "ゅ",
	e: "ぇ",
	o: "ょ",
};

/** 零声母＋介音 i（`ya` `ye` `you` `yong`）。「いゃ」ではなく「や」になる。 */
const ZERO_PALATAL: Partial<Record<PinyinVowel, string>> = {
	a: "や",
	e: "いぇ",
	u: "ゆ",
	o: "よ",
};

/** 声母。長いものから試す（`zh` を `z` と切らないため）。 */
const INITIALS = [
	"zh",
	"ch",
	"sh",
	"b",
	"p",
	"m",
	"f",
	"d",
	"t",
	"n",
	"l",
	"g",
	"k",
	"h",
	"j",
	"q",
	"x",
	"r",
	"z",
	"c",
	"s",
];

/** 綴りを [声母, 韻母] へ割る。`y` `w` で始まる零声母は介音の綴りへ戻す。 */
const splitInitial = (token: string): [string, string] => {
	if (token.startsWith("y")) {
		const rest = token.slice(1);
		// yu 系は ü（`yu` → ü、`yue` → üe）。yi 系は介音がそのまま綴られている。
		if (rest.startsWith("u")) return ["", `ü${rest.slice(1)}`];
		return ["", rest.startsWith("i") ? rest : `i${rest}`];
	}
	if (token.startsWith("w")) {
		const rest = token.slice(1);
		return ["", rest.startsWith("u") ? rest : `u${rest}`];
	}
	const initial = INITIALS.find((i) => token.startsWith(i)) ?? "";
	const rest = token.slice(initial.length);
	// j / q / x の後ろの u は ü（`ju` = jü、`jun` = jün）。
	const final =
		"jqx".includes(initial) && initial !== "" && rest.startsWith("u")
			? `ü${rest.slice(1)}`
			: rest;
	return [initial, final];
};

/**
 * ピンイン1音節をかなのモーラ列へ写す。ピンインとして読めなければ null。
 *
 * 声調番号（`xing1`）と `v` / `u:`（ü の代替綴り）は受ける。
 */
export const pinyinToMoras = (raw: string): string[] | null => {
	const token = raw
		.trim()
		.toLowerCase()
		.replace(/[0-5]$/, "")
		.replace(/u:/g, "ü")
		.replace(/v/g, "ü");
	if (!/^[a-zü]+$/.test(token)) return null;
	const [initial, rawFinal] = splitInitial(token);
	const final = SPELLED_OUT[rawFinal] ?? rawFinal;
	const parsed = PINYIN_FINALS[final];
	const onset = PINYIN_ONSET[initial];
	if (!parsed || !onset) return null;
	const [medial, nucleus, coda] = parsed;
	const moras: string[] = [];
	if (medial === "") {
		const head = onset[nucleus];
		if (!head) return null;
		moras.push(head);
	} else if (medial === "u") {
		// 介音 u は畳まず別モーラにする（`guo` → グ＋オ が慣用の表記）。
		const head = onset.u;
		if (!head) return null;
		moras.push(head, VOWEL_KANA[nucleus]);
	} else {
		const zero = initial === "" && medial === "i";
		const head = zero ? ZERO_PALATAL[nucleus] : onset[medial];
		if (!head) return null;
		const small = SMALL_KANA[nucleus];
		// 頭が1文字のかななら拗音へ畳めて1モーラに収まる（し＋ゃ → しゃ）。
		// 「でぃ」「とぅ」のような2文字の頭は畳めないので、母音を別モーラにする。
		if (zero) moras.push(head);
		else if (head.length === 1 && small) moras.push(head + small);
		else moras.push(head, VOWEL_KANA[nucleus]);
	}
	if (coda !== "") moras.push(CODA_KANA[coda]);
	return moras;
};
