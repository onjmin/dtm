/**
 * 界隈曲の流派テンプレート（docs/kaiwai-lineages.md）の構成・進行・リードの組み立て。
 * 構成と進行は規則（つなぎ方）から曲ごとに組み、リードはリズムの部品と輪郭の歩みから作る。
 * どの曲の写しでもない（耳コピの音符・和音列は使わない）。綴りはハ長調／イ短調。
 */

import { parseChord } from "@onjmin/chord-parser";
import type { ChordPatternType } from "../chord/chords";
import type { SectionKind, StructureTemplate } from "./compose-sections";

export type KaiwaiGrammar = "kaisen" | "nigo" | "speder";

/** 4小節の進行（要素は1小節。空白区切りで2拍ごとの2和音）。 */
type Block = string[];

export type GrammarProgressions = {
	a: Block[];
	b: Block[];
	c: Block[];
	/** 締めの後ろ2小節の候補。`undefined` は締めずに回す流派。 */
	cadences?: { half: Block[]; full: Block[]; deceptive: Block[] };
};

/** 1小節の音。`step` は主音からの音階の歩数、`len` は16分単位（負は休符）。 */
export type LeadNote = { step: number; chrom: boolean; len: number };

const pick = <T>(xs: T[], rnd: () => number): T =>
	xs[Math.floor(rnd() * xs.length)];

const weighted = <T>(xs: [T, number][], rnd: () => number): T => {
	const total = xs.reduce((a, [, w]) => a + w, 0);
	let r = rnd() * total;
	for (const [x, w] of xs) {
		r -= w;
		if (r < 0) return x;
	}
	return xs[xs.length - 1][0];
};

const pc = (n: number): number => ((n % 12) + 12) % 12;
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const rootOf = (c: string): number => pc(parseChord(c).notes[0] ?? 0);
const named = (root: number, quality: string): string =>
	`${NAMES[pc(root)]}${quality}`;

/** 8つの2拍枠を4小節（1小節2和音）へ。 */
const toBlock = (slots: string[]): Block => [
	`${slots[0]} ${slots[1]}`,
	`${slots[2]} ${slots[3]}`,
	`${slots[4]} ${slots[5]}`,
	`${slots[6]} ${slots[7]}`,
];

/** 2拍枠の列を、手（chunk）を継ぎ足して埋める。手が尽きたら `fallback` を置く。 */
const grow = (
	head: string,
	length: number,
	moves: (cur: string, room: number) => [string[], number][],
	fallback: (cur: string) => string,
	rnd: () => number,
): string[] => {
	const out = [head];
	while (out.length < length) {
		const cur = out[out.length - 1];
		const room = length - out.length;
		const fits = moves(cur, room).filter(
			([chunk]) => chunk.length <= room && chunk[0] !== cur,
		);
		out.push(...(fits.length > 0 ? weighted(fits, rnd) : [fallback(cur)]));
	}
	return out;
};

/** 同じ手で組み直して条件を満たす候補を探す（満たさなければ最後の候補）。 */
const until = <T>(make: () => T, ok: (x: T) => boolean, tries = 24): T => {
	let x = make();
	for (let i = 1; i < tries && !ok(x); i++) x = make();
	return x;
};

// ============================================================
// 2号兄貴: ほぼ全部セブンス・2拍ごと・2-5 とその連鎖
// ============================================================

/** 4度上（五度圏を下る向き）の次のダイアトニックなセブンス。 */
const NIGO_FOURTH: Record<string, string> = {
	Am7: "Dm7",
	Dm7: "G7",
	G7: "CM7",
	CM7: "FM7",
	FM7: "Bm7-5",
	"Bm7-5": "E7",
	E7: "Am7",
	Em7: "Am7",
	A7: "Dm7",
	C7: "FM7",
	D7: "G7",
	B7: "Em7",
};
/** 2-5 の行き先と重み。Ⅱ は短調の行き先なら m7♭5（Ⅶm7♭5→Ⅲ7→Ⅵm7 など）。 */
const NIGO_TARGETS: [string, number][] = [
	["FM7", 4],
	["CM7", 2],
	["Am7", 3],
	["Dm7", 2],
	["Em7", 1],
	["G7", 1],
];
const iiOf = (target: string, rnd: () => number): string => {
	const r = rootOf(target) + 2;
	if (target === "Am7") return named(r, "m7-5");
	if (target === "Em7") return named(r, "m7-5");
	if (target === "Dm7") return named(r, rnd() < 0.5 ? "m7" : "m7-5");
	return named(r, "m7");
};
const vOf = (target: string): string => named(rootOf(target) + 7, "7");
/** Ⅱm7 の根から、その 2-5 が向かうダイアトニックな行き先。 */
const NIGO_II_TO_TARGET: Record<number, string> = {
	2: "CM7",
	7: "FM7",
	9: "G7",
	4: "Dm7",
};

/** 根が半音ずつ下がる m7 の列。途中に各 m7 の Ⅴ7 を挟み、ダイアトニックな 2-5 で降りる。 */
const descend = (cur: string, rnd: () => number): string[] | null => {
	if (!/m7(?!-5)|M7|m7-5/.test(cur)) return null;
	const r = rootOf(cur);
	const out: string[] = [];
	for (let i = 1; i <= 3; i++) {
		const root = pc(r - i);
		out.push(named(root, "m7"));
		const target = NIGO_II_TO_TARGET[root];
		if (target) {
			out.push(named(root + 5, "7"), target);
			return out;
		}
		if (rnd() < 0.5) out.push(named(root + 5, "7"));
	}
	return null;
};

const nigoMoves =
	(rnd: () => number, loopTo: string | null, feel?: NigoFeel) =>
	(cur: string, room: number): [string[], number][] => {
		// ブロックの末尾は頭へ戻る 2-5（ブロックを回すとそのまま解決する）。
		if (loopTo && room === 2 && cur !== loopTo)
			return [[[iiOf(loopTo, rnd), vOf(loopTo)], 1]];
		const m: [string[], number][] = [];
		const next = NIGO_FOURTH[cur];
		if (next) m.push([[next], 3]);
		if (cur === "FM7") {
			m.push([["Em7"], 3], [["Em7", "FM7", "Em7"], 1], [["Fm7", "Em7"], 1]);
			m.push([["E7"], 1]);
		}
		if (cur === "Em7") m.push([["FM7"], 2], [["A7"], 1]);
		if (cur === "Am7") m.push([["FM7"], 1.5], [["Em7"], 1]);
		if (cur === "CM7") m.push([["Am7"], 1], [["E7"], 1]);
		for (const [target, w] of NIGO_TARGETS)
			if (target !== cur)
				m.push([
					[iiOf(target, rnd), vOf(target), target],
					w * 0.8 * (target === "Am7" ? 1 + (feel?.minor ?? 0) * 3 : 1),
				]);
		if (feel?.minor && cur !== "E7") m.push([["E7", "Am7"], feel.minor * 2]);
		const chain = descend(cur, rnd);
		if (chain) m.push([chain, 1.5]);
		const leave = loopTo ? 2 : 0;
		return m.filter(([chunk]) => chunk.length <= room - leave || room <= 2);
	};

const nigoBlock = (head: string, rnd: () => number, feel?: NigoFeel): Block => {
	const loop = rnd() < 0.6 ? head : null;
	// 1小節1和音の曲（混在の曲はブロックごとに引く）は4つの枠をそのまま小節にする。
	const perBar =
		feel?.perBar === "mix" ? (rnd() < 0.5 ? 1 : 2) : (feel?.perBar ?? 2);
	const slots = grow(
		head,
		perBar === 1 ? 4 : 8,
		nigoMoves(rnd, loop, feel),
		(cur) => NIGO_FOURTH[cur] ?? "FM7",
		rnd,
	);
	return perBar === 1 ? slots : toBlock(slots);
};

/**
 * 2号兄貴の曲ごとの作り。`perBar` は和声リズム、`triads` は M7・m7 を三和音へ落とす割合、
 * `minor` は Ⅵm（イ短調の主和音）へ引き戻す強さ。
 */
export type NigoFeel = {
	perBar: 1 | 2 | "mix";
	triads: number;
	minor: number;
	/** 楽器リードのサビに3度下の重ね（ハモリ）を付ける。 */
	third: boolean;
	/** 旋律の無いイントロで、ベース・地の伴奏が入る位置（イントロの4分の1単位）。 */
	introEntry: { bass: number; backing: number };
	/**
	 * パッドの持続音を寄せる高さ（MIDI）。固定（MELODY_HIGH+2）だと短調の枠で毎小節ド・レに落ち、
	 * 調の推定が平行長調へ引っ張られた（2026-10-17）。曲ごとに1オクターブの幅から引く。
	 */
	padTarget: number;
};

/** 属7・m7♭5 は落とさない（2-5 とセブンス中心の核を残す）。 */
const triadOf = (c: string): string =>
	c.replace(/^([A-G][b#]?)(M7|m7)$/, (_, r, q) => (q === "M7" ? r : `${r}m`));
// ブロックは曲の中で使い回されるので、1つのブロックが三和音に寄るとその曲のセブンスが半分を割る
// （原曲は 8/8 が拍の半分以上セブンス）。拍（1小節1和音は2拍）で数えて半分を割るなら落とさない。
const thin = (
	block: Block,
	feel: NigoFeel | undefined,
	rnd: () => number,
): Block => {
	if (!feel?.triads) return block;
	const out = block.map((bar) =>
		bar
			.split(" ")
			.map((c) => (rnd() < feel.triads ? triadOf(c) : c))
			.join(" "),
	);
	const beats = out.flatMap((bar) => {
		const cs = bar.split(" ");
		return cs.length === 1 ? [cs[0], cs[0]] : cs;
	});
	return beats.filter((c) => /7|9/.test(c)).length * 2 >= beats.length
		? out
		: block;
};

const slotsOf = (block: Block): string[] => block.flatMap((b) => b.split(" "));
/** 規則上の 2-5（m7 から4度上の属7）を含むか。 */
const hasTwoFive = (block: Block): boolean => {
	const s = slotsOf(block);
	return s.some(
		(c, i) =>
			i > 0 &&
			/m7$/.test(s[i - 1]) &&
			/7$/.test(c) &&
			!/M7$|m7/.test(c) &&
			pc(rootOf(c) - rootOf(s[i - 1])) === 5,
	);
};

const nigo = (rnd: () => number, feel?: NigoFeel): GrammarProgressions => {
	const core = (heads: [string, number][]) => () =>
		thin(
			until(
				() => nigoBlock(weighted(heads, rnd), rnd, feel),
				(b) => slotsOf(b).includes("FM7") && hasTwoFive(b),
			),
			feel,
			rnd,
		);
	const four = (make: () => Block): Block[] => [make(), make(), make(), make()];
	const approach = (): string => pick(["Bm7-5 E7", "Dm7 E7", "FM7 E7"], rnd);
	return {
		a: four(core([["Am7", 1]])),
		b: four(
			core([
				["FM7", 3],
				["Dm7", 1],
				["Em7", 1],
				["CM7", 1],
				["Am7", (feel?.minor ?? 0) * 3],
			]),
		),
		c: four(() =>
			thin(
				nigoBlock(
					weighted(
						[
							["Dm7", 1],
							["Gm7", 1],
							["FM7", 1],
							["Em7", 1],
						],
						rnd,
					),
					rnd,
					feel,
				),
				feel,
				rnd,
			),
		),
		cadences: {
			half: [0, 1, 2].map(() => [
				pick(["FM7 Em7", "Dm7 G7", "CM7 FM7", "Gm7 C7", "Am7 Dm7"], rnd),
				approach(),
			]),
			full: [0, 1, 2].map(() => [
				approach(),
				pick(["Am7 Am9", "Am9 Am7"], rnd),
			]),
			deceptive: [0, 1, 2].map(() => [
				pick(["Bm7-5 E7", "Dm7 G7", "Dm7 E7"], rnd),
				pick(["FM7 E7", "CM7 E7", "FM7 Em7"], rnd),
			]),
		},
	};
};

// ============================================================
// 海鮮: Ⅵm 中心・2拍ごと・4度上への根音進行・属7で短調Ⅰへ引き戻す
// ============================================================

/** 機能ごとの綴り（三和音かセブンス）。 */
const KAISEN_FORMS: Record<string, string[]> = {
	Am: ["Am", "Am7"],
	Dm: ["Dm", "Dm7"],
	G: ["G", "G7"],
	C: ["C", "CM7"],
	F: ["F", "FM7"],
	Em: ["Em", "Em7"],
	Bm7b5: ["Bm7-5"],
	E7: ["E7"],
	A7: ["A7"],
};
const KAISEN_FOURTH: Record<string, string> = {
	Am: "Dm",
	Dm: "G",
	G: "C",
	C: "F",
	F: "Bm7b5",
	Bm7b5: "E7",
	E7: "Am",
	Em: "Am",
	A7: "Dm",
};
const funcOf = (c: string): string =>
	Object.keys(KAISEN_FORMS).find((f) => KAISEN_FORMS[f].includes(c)) ?? "Am";

const kaisenMoves =
	(rnd: () => number) =>
	(cur: string): [string[], number][] => {
		const f = funcOf(cur);
		const form = (g: string): string => pick(KAISEN_FORMS[g], rnd);
		const m: [string[], number][] = [[[form(KAISEN_FOURTH[f])], 3]];
		if (f !== "E7" && f !== "Am") m.push([["E7", form("Am")], 2]);
		if (f === "Am") m.push([["A7", form("Dm")], 1], [[form("Em")], 0.7]);
		if (f === "F") m.push([["E7"], 2], [[form("G"), form("Am")], 1]);
		if (f === "Dm") m.push([["E7"], 1.5]);
		if (f === "C") m.push([[form("Am")], 1], [["E7"], 0.7]);
		if (f === "G") m.push([[form("Am")], 0.8]);
		return m;
	};

const kaisenBlock = (head: string, rnd: () => number): Block =>
	toBlock(
		grow(
			head,
			8,
			kaisenMoves(rnd),
			(cur) => pick(KAISEN_FORMS[KAISEN_FOURTH[funcOf(cur)]], rnd),
			rnd,
		),
	);

const pullsBack = (b: Block): boolean => {
	const s = slotsOf(b);
	return s.some((c, i) => c === "E7" && /^Am/.test(s[i + 1] ?? ""));
};

const kaisen = (rnd: () => number): GrammarProgressions => {
	const four = (make: () => Block): Block[] => [make(), make(), make(), make()];
	const heads = (xs: string[]) => () => pick(xs, rnd);
	const a = heads(["Am", "Am7"]);
	const b = heads(["FM7", "F", "Dm7", "Dm", "Am7", "CM7"]);
	const c = heads(["FM7", "Dm7", "Dm", "C"]);
	const approach = (): string =>
		pick(["Dm7 E7", "FM7 E7", "Bm7-5 E7", "Dm E7", "F E7"], rnd);
	return {
		a: four(() =>
			until(
				() => kaisenBlock(a(), rnd),
				(x) =>
					pullsBack(x) && slotsOf(x).filter((s) => /^Am/.test(s)).length >= 3,
			),
		),
		b: four(() =>
			until(
				() => kaisenBlock(b(), rnd),
				(x) => pullsBack(x),
			),
		),
		c: four(() => kaisenBlock(c(), rnd)),
		cadences: {
			half: [0, 1, 2].map(() => [
				pick(["Dm7 G7", "FM7 Dm7", "Am Dm", "C F", "Am7 A7"], rnd),
				approach(),
			]),
			full: [0, 1, 2].map(() => [
				approach(),
				pick(["Am Am7", "Am7 Am", "Am Am"], rnd),
			]),
			deceptive: [0, 1, 2].map(() => [
				approach(),
				pick(["FM7 E7", "FM7 G7", "F G"], rnd),
			]),
		},
	};
};

// ============================================================
// Speder2: 7th 以上を少数でループ・1〜2和音で回す区間・2-5 を置かない
// ============================================================

/**
 * 語彙は 7th 以上。属7は Ⅱm7 が語彙に無いもの（E7・C7・F7）だけにして、
 * どう並べても m7→4度上の属7（2-5）が生まれないようにする。
 */
const SPEDER_VOCAB = [
	"Am7",
	"Am9",
	"FM7",
	"FM9",
	"FM7(13)",
	"Dm7",
	"Dm9",
	"Em7",
	"Em7(b13)",
	"CM7",
	"CM9",
	"BbM7",
	"E7",
	"C7",
	"F7",
];
const pcsOf = (c: string): Set<number> =>
	new Set(parseChord(c).notes.map((n) => pc(n)));
/** 共通音を2つ以上持つ別の根の和音（ⅣM7(13)⇄Ⅲm7(♭13) のように上が残って根だけ動く組）。 */
const SPEDER_PARTNERS: Record<string, string[]> = Object.fromEntries(
	SPEDER_VOCAB.map((x) => {
		const xs = pcsOf(x);
		return [
			x,
			SPEDER_VOCAB.filter(
				(y) =>
					rootOf(y) !== rootOf(x) &&
					[...pcsOf(y)].filter((p) => xs.has(p)).length >= 2,
			),
		];
	}),
);

const speder = (rnd: () => number): GrammarProgressions => {
	const loop = (x: string): Block => {
		const y = pick(SPEDER_PARTNERS[x], rnd);
		return weighted<Block>(
			[
				[[x, x, x, x], 1],
				[[x, y, x, y], 2],
				[[x, x, y, y], 2],
				// 4小節目だけ動く型は試聴の当たり（2201471562 の Aメロ）。
				[[x, x, x, y], 2],
			],
			rnd,
		);
	};
	const nonTonic = SPEDER_VOCAB.filter((c) => !c.startsWith("Am"));
	const threeWay = (x: string): Block => {
		const ys = SPEDER_PARTNERS[x];
		const y = pick(ys, rnd);
		const z = pick(ys, rnd);
		return [x, y, x, z];
	};
	const four = (make: () => Block): Block[] => [make(), make(), make(), make()];
	return {
		a: four(() => loop(pick(["Am7", "Am9"], rnd))),
		b: four(() => {
			const x = pick(nonTonic, rnd);
			return rnd() < 0.3 ? threeWay(x) : loop(x);
		}),
		c: four(() => {
			const x = pick(nonTonic, rnd);
			const y = pick(SPEDER_PARTNERS[x], rnd);
			return [x, x, y, y];
		}),
	};
};

/** 流派の文法から、曲の進行プール（と締めの候補）を組む。 */
export const grammarProgressions = (
	grammar: KaiwaiGrammar,
	rnd: () => number,
	feel?: NigoFeel,
): GrammarProgressions =>
	grammar === "nigo"
		? nigo(rnd, feel)
		: grammar === "kaisen"
			? kaisen(rnd)
			: speder(rnd);

// ============================================================
// リード
// ============================================================

/** 1拍（16分4つ）のリズムの部品。負は休符。 */
type BeatCell = number[];

/**
 * 走句リード（riff16）の曲ごとの癖。旋律は1音ずつ歩かせず、半小節ごとの着地点（骨格）を先に決め、
 * 直前の音から着地点への道で間を埋める（2026-10-26）。
 * リズムは曲ごとの数種の半小節の型（家族）から2小節ずつ組む（2026-10-27）。2号系の手本9本（配布 MIDI 6・
 * 採譜動画 3）は、8小節に半小節の型が 5〜13 種（中央 9）あり、2小節の単位のリズムは abcd・abac が多い。
 * 1つの型で全部の半小節を走らせた版は 3〜5 種で、8小節の 82% が2小節の同じリズムの繰り返しだった。
 */
export type LineStyle = {
	/** Aメロの4小節の輪郭（着地点の高さの並び）。 */
	contour: Contour;
	/** サビの4小節の輪郭。 */
	hookContour: Contour;
	/** 着地点の前の道の型（1〜2種）。曲の手癖になる。 */
	figures: Figure[];
	/** Aメロの半小節の型の家族（16分単位、和は8）。2小節ごとに4つ選んで並べる。 */
	cells: number[][];
	/**
	 * サビの半小節の型の家族。手本は一番高い8小節でも16分を減らさない（9本中 9本で減らない）ので、
	 * 4分の3の曲は走る型、残りは付点・8分で歌う型（手で書いた kw2 の作り）にする。
	 */
	hookCells: number[][];
	/** 8小節の3つ目の2小節を、1つ目と同じリズムの変奏（a a′）にする割合（手本 0〜0.78。写しは 9本とも 0）。 */
	echo: number;
	/** 4小節目・8小節目の句末を長い音で閉じる割合（手本の句末が伸ばす音 0〜0.71、中央 0.13）。 */
	close: number;
	/** 着地点に和音の外の音階の音（9度・11度など）も許す。 */
	tension: boolean;
	/** 歩く範囲（主音からの歩数）。 */
	lo: number;
	hi: number;
	/** 裏拍の8分を16分の長さで切る曲（原曲は16分の長さの音 47% に対し、16分の間隔は 21%）。 */
	staccato: boolean;
	/** 句末で息を継ぐ割合（原曲のリードの占有は 77〜93%）。 */
	breath: number;
};

export type Contour =
	| "arch"
	| "descend"
	| "climb"
	| "wave"
	| "hover"
	| "zigzag";
/**
 * 着地点の前の道。`run` は直前の音から音階で着地点へ（近ければ一度反対へ離れて回り込む）、`turn` は
 * 着地点の上か下で回ってから着く、`walk` は今までの歩き（偶然の新しさを残す。最後の音だけ着地点の隣へ）。
 * どれも直前の音から始まり、着地点の隣で終わる（半小節の頭で跳ばない）。
 */
export type Figure = "run" | "turn" | "walk";

/** 輪郭ごとの、4小節8つの着地点の高さ（範囲の下端 0〜上端 1）。 */
const CONTOURS: Record<Contour, number[]> = {
	arch: [0.3, 0.45, 0.6, 0.75, 0.95, 0.8, 0.55, 0.35],
	descend: [0.9, 0.8, 0.75, 0.6, 0.55, 0.4, 0.3, 0.15],
	climb: [0.2, 0.3, 0.35, 0.5, 0.55, 0.7, 0.8, 0.95],
	wave: [0.3, 0.6, 0.75, 0.45, 0.35, 0.65, 0.8, 0.4],
	hover: [0.5, 0.55, 0.5, 0.45, 0.5, 0.6, 0.5, 0.45],
	zigzag: [0.2, 0.8, 0.3, 0.85, 0.25, 0.9, 0.4, 0.6],
};

/**
 * 走る半小節（16分単位）。着地点は一番長い音（同じ長さなら前。全部16分なら半小節の頭）。
 * 手本の上位の型（x.xxx.x.・x...x.x.・xxxxxxxx・x.x.x.x. など）を形として並べたもの。重みは手本の数ではない。
 */
const RUN_CELLS: [number[], number][] = [
	[[2, 1, 1, 2, 2], 4],
	[[1, 1, 1, 1, 1, 1, 1, 1], 3],
	[[1, 1, 1, 1, 2, 2], 3],
	[[2, 1, 1, 1, 1, 2], 2],
	[[2, 1, 1, 1, 1, 1, 1], 2],
	[[4, 2, 2], 2],
	[[2, 2, 2, 2], 2],
	[[1, 1, 2, 2, 2], 1],
	[[2, 2, 1, 1, 2], 1],
	[[1, 1, 1, 1, 4], 1],
];
/** 3連を含む半小節（手本の配布 MIDI 6本中 5本で、3連の裏に来る音が 9〜43%）。 */
const TRIPLET_CELLS: [number[], number][] = [
	[[4 / 3, 4 / 3, 4 / 3, 2, 2], 2],
	[[4 / 3, 4 / 3, 4 / 3, 4], 1],
	[[2, 2, 4 / 3, 4 / 3, 4 / 3], 1],
];
/** サビの歌う半小節。 */
const HOOK_RHYTHMS: [number[], number][] = [
	[[3, 1, 2, 2], 3],
	[[4, 2, 2], 3],
	[[2, 2, 4], 2],
	[[3, 1, 4], 2],
	[[2, 1, 1, 4], 2],
	[[6, 2], 1],
];

export const lineStyle = (rnd: () => number): LineStyle => {
	const figure = (): Figure =>
		weighted<Figure>(
			[
				["run", 4],
				["turn", 2],
				["walk", 1],
			],
			rnd,
		);
	const figures: Figure[] = [figure()];
	if (rnd() < 0.5) {
		const f = figure();
		if (!figures.includes(f)) figures.push(f);
	}
	/** 家族を `n` 種引く（同じ型は1つだけ）。 */
	const family = (pool: [number[], number][], n: number): number[][] => {
		const out: number[][] = [];
		for (let i = 0; i < 4 * n && out.length < n; i++) {
			const c = weighted(pool, rnd);
			if (!out.includes(c)) out.push(c);
		}
		return out;
	};
	const triplets =
		rnd() < 0.6 ? family(TRIPLET_CELLS, 1 + Math.floor(rnd() * 2)) : [];
	// 家族の半分以上を走る型（16分が4つ以上）にする（手本は 8/8 曲で16分の音価が 3割以上）
	const dense = (c: number[]) => c.filter((x) => x === 1).length >= 4;
	const runFamily = (): number[][] => {
		const out = [...family(RUN_CELLS, 3 + Math.floor(rnd() * 3)), ...triplets];
		for (let i = 0; i < 12 && out.filter(dense).length * 2 < out.length; i++) {
			const c = weighted(
				RUN_CELLS.filter(([x]) => dense(x)),
				rnd,
			);
			if (!out.includes(c)) out.push(c);
		}
		return out;
	};
	const cells = runFamily();
	// 歌うサビも走る型を1つ混ぜる（歌う型だけだと、サビの長い曲で16分の音価が 3割を割った）
	const hookCells =
		rnd() < 0.75
			? runFamily()
			: [...family(HOOK_RHYTHMS, 2), cells.filter(dense)[0]];
	return {
		contour: weighted<Contour>(
			[
				["arch", 3],
				["descend", 2],
				["climb", 2],
				["wave", 2],
				["hover", 1],
				["zigzag", 1],
			],
			rnd,
		),
		hookContour: weighted<Contour>(
			[
				["arch", 3],
				["climb", 2],
				["wave", 1],
				["hover", 1],
			],
			rnd,
		),
		figures,
		cells,
		hookCells,
		echo: 0.1 + rnd() * 0.6,
		close: 0.15 + rnd() * 0.75,
		tension: rnd() < 0.3,
		lo: -2 - Math.floor(rnd() * 2),
		hi: 4 + Math.floor(rnd() * 3),
		staccato: rnd() < 0.4,
		breath: 0.05 + rnd() * 0.9,
	};
};

/** 変奏で音を選び直すときの歩き方。 */
export type DevelopRange = {
	lo: number;
	hi: number;
	maxLeap: number;
	turn: number;
	stepShare: number;
};

/**
 * 小節 `x` の変奏。写しでも無関係な小節でもなく、聴いて「同じ型が戻ってきた」と分かる形にする。
 * - 移高（ゼクエンツ）: 同じリズム・同じ音程の並びを音階の1〜2段上下へ。
 * - 音の入れ替え: リズムはそのまま、頭の音から音を選び直す。
 * - 後ろだけ替える: 前の2拍は同じで、後ろの2拍を `fresh` から継ぐ（つなぎ目は2段以内へ寄せる）。
 */
export const developBar = (
	rnd: () => number,
	x: LeadNote[],
	range: DevelopRange,
	fresh: () => LeadNote[],
): LeadNote[] => {
	const sounding = x.filter((n) => n.len > 0);
	if (sounding.length === 0) return x.map((n) => ({ ...n }));
	const r = rnd();
	if (r < 0.45) {
		const steps = sounding.map((n) => n.step);
		const top = Math.max(...steps);
		const bottom = Math.min(...steps);
		const size = rnd() < 0.7 ? 1 : 2;
		const up = rnd() < 0.5;
		// 範囲を1段まで越えるのは許す（走句は端で折り返すので、端に張り付いた型もある）。
		const shift =
			(up && top + size <= range.hi + 1) || bottom - size < range.lo - 1
				? size
				: -size;
		return x.map((n) =>
			n.len > 0 ? { ...n, step: n.step + shift } : { ...n },
		);
	}
	if (r < 0.75) {
		const next = walker(
			rnd,
			sounding[0].step,
			range.lo,
			range.hi,
			range.maxLeap,
			range.turn,
			range.stepShare,
		);
		const out = x.map((n) => (n.len > 0 ? { ...n, step: next() } : { ...n }));
		// 音の少ない小節は選び直しても元と同じになりやすい。写しにせず移高へ回す。
		if (out.every((n, i) => n.step === x[i].step))
			return developBar(() => 0, x, range, fresh);
		return out;
	}
	const head: LeadNote[] = [];
	let at = 0;
	for (const n of x) {
		if (at >= 8 - 1e-6) break;
		head.push({ ...n });
		at += Math.abs(n.len);
	}
	const f = fresh();
	const tail: LeadNote[] = [];
	let t = 0;
	for (const n of f) {
		if (t >= at - 1e-6) tail.push({ ...n });
		t += Math.abs(n.len);
	}
	const last = [...head].reverse().find((n) => n.len > 0)?.step ?? 0;
	const join = tail.find((n) => n.len > 0)?.step;
	const delta =
		join === undefined || Math.abs(join - last) <= 2
			? 0
			: last - join + (join > last ? 2 : -2);
	return [
		...head,
		...tail.map((n) => (n.len > 0 ? { ...n, step: n.step + delta } : n)),
	];
};

/** 着地点の判定。`bar` はセクションの中の小節、`at` は小節の中の16分の位置。 */
export type LineEnv = {
	fits: (bar: number, at: number, step: number) => boolean;
	/** 鳴っている和音の音と半音でぶつかるか。道の音はこれを避ける（後段で遠くへ動かされないように）。 */
	clash: (bar: number, at: number, step: number) => boolean;
};

/**
 * `from` から `to` へ向かう `n` 個の音（`to` は含まない）。遠ければ1回跳んでから音階で駆け込み、
 * 近ければ一度 `to` と反対へ離れてから2度ずつ寄る。最初の音は `from` の近く、最後の音は `to` の近く。
 */
const pathTo = (
	from: number,
	to: number,
	n: number,
	rnd: () => number,
): number[] => {
	if (n <= 0) return [];
	const dist = Math.abs(to - from);
	const d = to === from ? (rnd() < 0.5 ? 1 : -1) : Math.sign(to - from);
	// 遠いときは1回だけ跳んで、そこから音階で着地点へ駆け込む（跳躍を道の途中に散らさない）
	if (dist >= n + 1)
		return Array.from({ length: n }, (_, i) => to - d * (n - i));
	// ちょうど音の数だけ離れているときは、着地点を1段越えてから戻る（離れてから寄ると頭が直前の音と同じになった）
	if (dist === n && n >= 2)
		return [
			...Array.from({ length: n - 1 }, (_, i) => from + d * (i + 1)),
			to + d,
		];
	const away = Math.min(2, Math.ceil((n + 1 - dist) / 2));
	const route: number[] = [];
	for (let i = 1; i <= away; i++) route.push(from - d * i);
	for (let x = from - d * away + d; x !== to; x += d) route.push(x);
	// 道が音の数より短いときは、頭に直前の音の隣との往復を足す（同じ音を続けない）
	while (route.length < n)
		route.unshift(route.length % 2 === 0 ? from : from - d);
	// 長いときは着地点に近い側を残す（間引くと音を飛ばして跳躍になる）
	return route.slice(route.length - n);
};

/** 半小節のリズムの着地点（一番長い音、同じ長さなら前）の位置。 */
const landingOf = (rhythm: number[]): number =>
	rhythm.indexOf(Math.max(...rhythm));

/**
 * 半小節を作る。`prev` は直前の音、`t` は着地点、`next` は次の着地点（着地点の後ろの音の行き先）。
 * `k` は半小節の番号（和音を引く位置）。
 */
const realizeSlot = (
	rnd: () => number,
	style: LineStyle,
	env: LineEnv,
	k: number,
	rhythm: number[],
	figure: Figure,
	prev: number,
	t: number,
	next: number,
): LeadNote[] => {
	const ti = landingOf(rhythm);
	const pre = ti;
	let before: number[];
	if (figure === "turn" && pre >= 4) {
		const s = rnd() < 0.5 ? 1 : -1;
		before = [
			...pathTo(prev, t + 2 * s, pre - 4, rnd),
			t + 2 * s,
			t + 3 * s,
			t + 2 * s,
			t + s,
		];
	} else if (figure === "walk" && pre >= 2) {
		const step = walker(rnd, prev, style.lo, style.hi, 3, 0.3, 0.65);
		step();
		before = Array.from({ length: pre }, () => step());
		before[pre - 1] = t + (before[pre - 2] >= t ? 1 : -1);
	} else before = pathTo(prev, t, pre, rnd);
	const after = pathTo(t, next, rhythm.length - ti - 1, rnd);
	// 範囲の外へ出た音は端で折り返す（端に張り付けると同じ音が並んだ）
	const top = style.hi + 1;
	const bottom = style.lo - 1;
	const steps = [...before, t, ...after].map((x) =>
		x > top
			? Math.max(bottom, 2 * top - x)
			: x < bottom
				? Math.min(top, 2 * bottom - x)
				: x,
	);
	// 道の音が和音と半音でぶつかるなら、隣の段へずらす（前後と同じ音にならない方を選ぶ。最後の音は次の着地点とも比べる）
	let at = (k % 2) * 8;
	return rhythm.map((len, i) => {
		let s = steps[i];
		if (i !== ti && env.clash(Math.floor(k / 2), at, s))
			for (const dx of [1, -1]) {
				const c = s + dx;
				if (
					!env.clash(Math.floor(k / 2), at, c) &&
					c !== steps[i - 1] &&
					c !== (i + 1 < steps.length ? steps[i + 1] : next)
				) {
					s = c;
					break;
				}
			}
		steps[i] = s;
		at += len;
		return { step: s, chrom: false, len };
	});
};

/**
 * 走句リードのセクション（`bars` 小節）。
 * 1. 2小節ごとに、家族から半小節の型を4つ並べる。8小節の3つ目の2小節は `echo` の割合で1つ目と同じリズムにし（a a′）、
 *    4小節目・8小節目の句末は `close` の割合で長い音で閉じる。
 * 2. 輪郭から、4小節に8つの着地点（半小節ごと）を決め、和音の音へ寄せる（`tension` の曲は寄せないこともある）。
 *    a′ の着地点は1つ目を音階の1〜2段ずらすか、後ろの2つだけ替える。音は写さない（手本は9本とも写しが 0）。
 * 3. 着地点の前は直前の音からの道、後ろは次の着地点への道で埋める。
 */
export const lineSection = (
	rnd: () => number,
	style: LineStyle,
	bars: number,
	env: LineEnv,
	chorus = false,
): LeadNote[][] => {
	// サビは着地点を範囲の上寄りに置く。サビも走るようにしたら、オクターブ上げても Aメロとの平均の差が
	// 9半音を割る曲が出た（サビで必ず上へ移るのは所有者の指示、2026-10-26）。
	const heights = chorus
		? CONTOURS[style.hookContour].map((h) => 0.3 + 0.7 * h)
		: CONTOURS[style.contour];
	const figures = [0, 1, 2, 3].map(() => pick(style.figures, rnd));
	const slots = Math.ceil(bars / 4) * 8;
	const family = chorus ? style.hookCells : style.cells;
	const singing = family.some((c) => HOOK_RHYTHMS.some(([h]) => h === c));
	// 2小節の4つの型。すぐ前と同じ型は減らす（手本で前の半小節と同じ型は中央 0.1〜0.2）。
	const unit = (): number[][] => {
		const out: number[][] = [];
		for (let i = 0; i < 4; i++) {
			let c = pick(family, rnd);
			if (c === out[i - 1] && rnd() < 0.75) c = pick(family, rnd);
			out.push(c);
		}
		return out;
	};
	// 16小節の後半（9〜16小節目）を前半の写しにするか（手本も4小節のブロックを使い回す）
	const again = rnd() < 0.6;
	const rhythms: number[][] = [];
	const echoed = new Set<number>();
	for (let base = 0; base < slots; base += 16) {
		if (base >= 16 && again) {
			rhythms.push(...rhythms.slice(base - 16, base));
			continue;
		}
		const a = unit();
		const echo = rnd() < style.echo;
		if (echo) echoed.add(base + 8);
		const chunk = [...a, ...unit(), ...(echo ? a : unit()), ...unit()];
		for (const k of [7, 15])
			if (rnd() < style.close)
				chunk[k] = k === 15 ? [8] : singing ? [2, 2, 4] : [1, 1, 1, 1, 4];
		rhythms.push(...chunk);
	}
	const rhythmOf = (k: number): number[] => rhythms[k];
	/** 着地点を和音の音へ寄せる。`avoid` は選ばない（a′ を1つ目と同じ音にしない）。 */
	const snap = (k: number, raw: number, avoid?: number): number => {
		const rhythm = rhythmOf(k);
		const at =
			(k % 2) * 8 +
			rhythm.slice(0, landingOf(rhythm)).reduce((a, b) => a + b, 0);
		if (style.tension && rnd() < 0.4 && raw !== avoid) return raw;
		for (const dx of [0, -1, 1, -2, 2]) {
			const s = raw + dx;
			if (
				s !== avoid &&
				s >= style.lo - 1 &&
				s <= style.hi + 1 &&
				env.fits(Math.floor(k / 2), at, s)
			)
				return s;
		}
		return raw === avoid ? raw + 1 : raw;
	};
	const span = style.hi - style.lo;
	const fresh = (base: number): number[] =>
		heights.map((h, i) => {
			const jitter = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
			return snap(base + i, Math.round(style.lo + h * span) + jitter);
		});
	// 着地点の並び（半小節ごと）
	const targets: number[] = [];
	for (let base = 0; base < slots; base += 8) {
		if (base >= 16 && again) {
			targets.push(...targets.slice(base - 16, base - 8));
			continue;
		}
		const phrase = fresh(base);
		if (echoed.has(base)) {
			// a′: 1つ目の句の頭の4つの着地点を1〜2段ずらすか、前の2つを残して後ろの2つを替える
			const head = targets.slice(base - 8, base - 4);
			if (rnd() < 0.5) {
				const d = (rnd() < 0.5 ? 1 : -1) * (rnd() < 0.7 ? 1 : 2);
				phrase.splice(0, 4, ...head.map((t, i) => snap(base + i, t + d, t)));
			} else
				phrase.splice(
					0,
					4,
					head[0],
					head[1],
					snap(base + 2, phrase[2], head[2]),
					snap(base + 3, phrase[3], head[3]),
				);
		}
		// 8小節目は主音へ寄せて閉じる
		if (base % 16 === 8) phrase[7] = snap(base + 7, 0);
		targets.push(...phrase);
	}
	// 半小節を順に作る。写しにした後半は、前の音をそのまま写す（ブロックの使い回し）。
	const made: LeadNote[][] = [];
	let prev = targets[0] + (rnd() < 0.5 ? 2 : -2);
	for (let k = 0; k < slots; k++) {
		const copyFrom = k >= 16 && again ? k - 16 : -1;
		let notes =
			copyFrom >= 0 && made[copyFrom]
				? made[copyFrom].map((n) => ({ ...n }))
				: realizeSlot(
						rnd,
						style,
						env,
						k,
						rhythmOf(k),
						figures[k % 4],
						prev,
						targets[k],
						targets[k + 1] ?? targets[0],
					);
		// 句末で息を継ぐ（伸ばした着地点の後ろを8分だけ休む）
		if (k % 8 === 7 && rnd() < style.breath * 0.6) {
			const last = notes[notes.length - 1];
			if (last.len > 2)
				notes = [
					...notes.slice(0, -1),
					{ ...last, len: last.len - 2 },
					{ step: 0, chrom: false, len: -2 },
				];
		}
		made.push(notes);
		prev = [...notes].reverse().find((n) => n.len > 0)?.step ?? prev;
	}
	const out: LeadNote[][] = [];
	for (let b = 0; b < bars; b++) out.push([...made[2 * b], ...made[2 * b + 1]]);
	return out;
};

/** 輪郭: 音階を歩き、跳躍は `maxLeap` 歩まで。範囲の端で折り返す。同音は打たない。 */
const walker = (
	rnd: () => number,
	start: number,
	lo: number,
	hi: number,
	maxLeap: number,
	turn: number,
	stepShare: number,
	same = 0,
) => {
	let pos = start;
	let dir = rnd() < 0.5 ? -1 : 1;
	let first = true;
	return (): number => {
		if (first) {
			first = false;
			return pos;
		}
		if (same > 0 && rnd() < same) return pos;
		if (rnd() < turn) dir = -dir;
		const r = rnd();
		const size =
			r < stepShare
				? 1
				: r < stepShare + (1 - stepShare) * 0.6
					? Math.min(2, maxLeap)
					: 2 + Math.floor(rnd() * Math.max(1, maxLeap - 1));
		let next = pos + dir * size;
		if (next > hi || next < lo) {
			dir = -dir;
			next = pos + dir * size;
		}
		pos = Math.max(lo, Math.min(hi, next));
		return pos;
	};
};

const fillBeats = (cells: BeatCell[], next: () => number): LeadNote[] =>
	cells.flatMap((cell) =>
		cell.map((len) =>
			len < 0
				? { step: 0, chrom: false, len }
				: { step: next(), chrom: false, len },
		),
	);

/**
 * 1小節ループ（riff-bar）の曲ごとの癖。2度で歩く曲と3度以上で跳ぶ曲の両方がある。
 * 型は4小節ブロック [x y x z] で回す。原曲4曲とも同じ小節を続けては鳴らさない（前の小節と同一 0〜15%）。
 */
export type LoopStyle = {
	cells: [BeatCell, number][];
	stepShare: number;
	maxLeap: number;
	/** 旧版で1小節ループを引いた曲。足す小節は別の乱数列から作る（乱数列を保っていた頃の名残）。 */
	spare: boolean;
};

export const loopStyle = (rnd: () => number): LoopStyle => {
	const busy = rnd();
	const style: LoopStyle = {
		cells: [
			[[1, 1, 1, 1], 0.4 + busy * 2],
			[[2, 2], 1.6 - busy],
			[[3, 1], 1],
			[[2, 1, 1], 0.5 + busy],
			[[1, 1, 2], 0.5 + busy * 0.5],
			[[-1, 1, 1, 1], 0.3 + busy * 0.5],
			[[-2, 2], 0.6],
			[[1, 2, 1], 0.5],
			[[4], 0.5 - busy * 0.3],
			[[4 / 3, 4 / 3, 4 / 3], rnd() * 0.8],
		],
		stepShare: rnd() < 0.5 ? 0.75 : 0.25,
		maxLeap: 2 + Math.floor(rnd() * 2),
		spare: false,
	};
	style.spare = rnd() < 0.5;
	return style;
};

/** 1小節ループの型を1つ作る（セクションの全小節がこれを繰り返す）。 */
export const loopBar = (rnd: () => number, style: LoopStyle): LeadNote[] => {
	const next = walker(
		rnd,
		Math.floor(rnd() * 4),
		-2,
		5,
		style.maxLeap,
		0.3,
		style.stepShare,
	);
	return fillBeats(
		[0, 1, 2, 3].map(() => weighted(style.cells, rnd)),
		next,
	);
};

/**
 * 1小節ループのリードのセクションをまたいだ動き。原曲4曲はサビで音域を上げ（3曲は +6〜13 半音）、
 * 8小節のうち2〜4小節しか鳴らさないブロックや遅れた入りがある（休符率 0.3〜0.5）。
 * `lift` はサビの持ち上げ（音階の段数）、`sparse` は種別ごとの8小節目ごとに奇数番目で鳴らす小節数。
 */
export type LoopShape = {
	lift: number;
	sparse: { sides: string[]; keep: number } | null;
	lateEntry: boolean;
	/** 音の長さの割合（1=次の音まで伸ばす。原曲の2曲は16分を短く切る）。 */
	gate: number;
};

export const loopShape = (
	rnd: () => number,
	octaveSteps: number,
): LoopShape => {
	const lift = weighted(
		[
			[0, 1],
			[3, 1],
			[octaveSteps, 2],
		],
		rnd,
	);
	const sparse =
		rnd() < 0.85
			? {
					sides: pick([["a"], ["b"], ["a", "b"]], rnd),
					keep: pick([0, 2, 4], rnd),
				}
			: null;
	const lateEntry = rnd() < 0.4;
	return {
		lift,
		sparse,
		lateEntry,
		gate: rnd() < 0.5 ? 1 : 0.7 + rnd() * 0.15,
	};
};

/** 8分の格子に乗らない音を前の音（休符）へ吸収して、8分刻みに間引く。 */
export const thinToEighths = (cell: LeadNote[]): LeadNote[] => {
	const out: LeadNote[] = [];
	let at = 0;
	for (const n of cell) {
		const len = Math.abs(n.len);
		const onGrid = Math.abs(at / 2 - Math.round(at / 2)) < 1e-6;
		if (onGrid || out.length === 0) out.push({ ...n });
		else {
			const last = out[out.length - 1];
			last.len = Math.sign(last.len) * (Math.abs(last.len) + len);
		}
		at += len;
	}
	return out;
};

// ============================================================
// 上物（伴奏の刻み・アルペジオ）の曲ごとの型
// ============================================================

/** 上物の1発（16分単位）。`tone` は和音の構成音の添字（下から）。省略で和音まるごと。 */
export type UpperHit = { at: number; len: number; tone?: number };
/**
 * 上物の刻み（`bars` を小節ごとに回す）と和音の積み方（0=そのまま・1=最低音を抜く・
 * 2=最低音を1オクターブ上へ・3=最高音を1オクターブ下へ）。
 */
export type UpperFigure = { bars: UpperHit[][]; voicing: number };
export type UpperGrain =
	| "block"
	| "quarter"
	| "eighth"
	| "sixteenth"
	| "offbeat"
	| "arpeggio";

/** 発音位置の列を1手だけ崩す（ずらす・抜く・足す・前へ食う）。 */
const nudge = (on: number[], grid: number, rnd: () => number): number[] => {
	const xs = [...on];
	const r = rnd();
	const i = 1 + Math.floor(rnd() * Math.max(1, xs.length - 1));
	if (r < 0.3 && xs.length > 2) xs.splice(i, 1);
	else if (r < 0.55)
		xs[i % xs.length] = Math.min(15, xs[i % xs.length] + grid / 2);
	else if (r < 0.75) xs[i % xs.length] = Math.max(1, xs[i % xs.length] - 1);
	else xs.push(Math.floor(rnd() * (16 / grid)) * grid + grid / 2);
	return [...new Set(xs.filter((x) => x >= 0 && x < 16))].sort((a, b) => a - b);
};

/**
 * 上物の型を曲ごとに作る。原曲どうしで共通する上物の1小節の形は 8〜11%（リズムだけで 25〜40%）
 * なので、刻みの長さ（規則）だけ守り、位置・長さ・積み方は曲ごとに引く。
 */
export const upperFigure = (
	grain: UpperGrain,
	rnd: () => number,
): UpperFigure => {
	if (grain === "arpeggio") {
		const step = rnd() < 0.7 ? 1 : 2;
		const cycle = [0];
		const n = pick([4, 6, 8], rnd);
		while (cycle.length < n) {
			const prev = cycle[cycle.length - 1];
			const opts = [0, 1, 2, 3].filter((t) => t !== prev);
			cycle.push(pick(opts, rnd));
		}
		// 抜く16分（0〜3か所）も曲ごと。全部の16分を鳴らす型だけだと曲をまたいで同じリズムになる。
		const skip = new Set<number>();
		const holes = pick([0, 1, 2, 3], rnd);
		while (skip.size < holes) skip.add(pick([3, 7, 11, 15, 5, 13], rnd));
		const hits: UpperHit[] = [];
		for (let at = 0, i = 0; at < 16; at += step, i++)
			if (!skip.has(at))
				hits.push({ at, len: step, tone: cycle[i % cycle.length] });
		return { bars: [hits], voicing: Math.floor(rnd() * 3) };
	}
	let on: number[];
	let grid: number;
	if (grain === "block") {
		// 地の和音: 2拍ごとに置き直すのが元。曲によって8分の食い・付点のずらしを1つ入れ、積み方も替える。
		const legato = pick(
			[
				[0, 8],
				[0, 6, 8, 14],
				[0, 3, 8, 11],
				[0, 8, 14],
				[0, 4, 8, 12],
			],
			rnd,
		);
		const hits = legato.map((at, i) => ({
			at,
			len: (legato[i + 1] ?? 16) - at,
		}));
		return { bars: [hits], voicing: Math.floor(rnd() * 4) };
	}
	if (grain === "quarter") {
		on = [0, 4, 8, 12];
		grid = 4;
	} else if (grain === "eighth") {
		on = rnd() < 0.3 ? [0, 3, 6, 8, 11, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
		grid = 2;
	} else if (grain === "offbeat") {
		on = [2, 6, 10, 14];
		grid = 4;
	} else {
		// 16分: 拍の中の抜き方（x.xx・xx.x など）を曲ごとに引き、拍ごとに少し変える。
		const masks = [
			[0, 1, 2, 3],
			[0, 2, 3],
			[0, 1, 3],
			[0, 1, 2],
			[0, 2],
			[0, 3],
		];
		const base = pick(masks, rnd);
		on = [0, 1, 2, 3].flatMap((b) =>
			(rnd() < 0.3 ? pick(masks, rnd) : base).map((x) => b * 4 + x),
		);
		grid = 1;
	}
	const ops = 1 + Math.floor(rnd() * 3);
	for (let k = 0; k < ops; k++) on = nudge(on, Math.max(2, grid), rnd);
	const second = rnd() < 0.5 ? nudge(on, Math.max(2, grid), rnd) : on;
	const gate = pick(["legato", "half", "short"] as const, rnd);
	const lens = (xs: number[]): UpperHit[] =>
		xs.map((at, i) => {
			const gap = (xs[i + 1] ?? 16) - at;
			const len =
				gate === "legato"
					? gap
					: gate === "half"
						? Math.max(1, Math.floor(gap / 2))
						: Math.min(gap, 1);
			return { at, len };
		});
	return {
		bars: second === on ? [lens(on)] : [lens(on), lens(second)],
		voicing: Math.floor(rnd() * 4),
	};
};

// ============================================================
// ベースの曲ごとの型
// ============================================================

/** ベースの1発（16分単位）。r=根音・o=1オクターブ上・f=5度上・a=次の根音へ半音で入る音。 */
export type BassHit = { at: number; len: number; tone: "r" | "o" | "f" | "a" };

/**
 * 流派の奏法（8分オクターブ・3:3:2・付点8分・拍頭を抜いた16分）を元に、2小節の型を曲ごとに作る。
 * 原曲どうしでベースの1小節の形が重なるのは 5〜25%（リズムだけで 33〜68%）。
 */
export const bassFigure = (style: string, rnd: () => number): BassHit[][] => {
	type T = BassHit["tone"];
	const legato = rnd() < 0.6;
	const hits = (on: number[], tones: T[]): BassHit[] =>
		on.map((at, i) => {
			const gap = (on[i + 1] ?? 16) - at;
			return {
				at,
				len: legato ? gap : Math.max(1, Math.ceil(gap * 0.6)),
				tone: tones[i],
			};
		});
	const rawOct = (bar: BassHit[]): number =>
		bar
			.slice(1)
			.filter(
				(h, i) =>
					(h.tone === "o") !== (bar[i].tone === "o") &&
					h.tone !== "f" &&
					bar[i].tone !== "f",
			).length / Math.max(1, bar.length - 1);
	/** 4小節の型 [x y x z]。y・z は半分強が新しい小節。 */
	const four = (bar: () => BassHit[]): BassHit[][] => {
		const x = bar();
		const alt = (): BassHit[] => (rnd() < 0.4 ? x : bar());
		return [x, alt(), x, alt()];
	};
	/** 小節の中のオクターブ往復の割合（和音が変わる拍3をまたぐ対は往復にならないとして数える）。 */
	const octShare = (bar: BassHit[]): number => {
		let n = 0;
		let o = 0;
		for (let i = 1; i < bar.length; i++) {
			n++;
			const a = bar[i - 1].tone;
			const b = bar[i].tone;
			if (bar[i - 1].at < 8 !== bar[i].at < 8) continue;
			if ((a === "r" && b === "o") || (a === "o" && b === "r")) o++;
		}
		return n ? o / n : 1;
	};
	if (style === "octave-dotted" || style === "octave-offbeat16") {
		// 拍頭（2〜4拍）を避けた位置から、オクターブ往復を曲ごとの割合（3〜5割強）で混ぜる。
		const base =
			style === "octave-dotted"
				? [0, 3, 6, 9, 11, 14]
				: [0, 2, 3, 6, 7, 10, 11, 14, 15];
		const pOct = 0.35 + rnd() * 0.3;
		const bar = (): BassHit[] => {
			const on = base.filter((_, i) => i === 0 || rnd() > 0.15);
			if (rnd() < 0.4) on.push(pick([1, 5, 13], rnd));
			const sorted = [...new Set(on)].sort((a, b) => a - b);
			const tones: T[] = ["r"];
			for (let i = 1; i < sorted.length; i++) {
				const prev = tones[i - 1];
				tones.push(
					rnd() < pOct
						? prev === "o"
							? "r"
							: "o"
						: pick<T>(prev === "f" ? ["r", "o"] : ["f", prev, "r"], rnd),
				);
			}
			return hits(sorted, tones);
		};
		// 原曲のオクターブ跳躍は曲で 1〜5割（doc の規則は 3割以上）。
		return until(
			() => four(bar),
			(f) => {
				const r = f.reduce((a, x) => a + rawOct(x), 0) / f.length;
				return r >= 0.38 && r <= 0.6;
			},
		);
	}
	// 根音中心の刻み（2号兄貴だけが引く）。オクターブ往復は曲ごとに 0〜4割。
	const roots: Record<string, [number[], number]> = {
		"root-eighth": [[0, 2, 4, 6, 8, 10, 12, 14], 0.1],
		driving: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 0.3],
		quarter: [[0, 4, 8, 12], 0],
		syncopated: [[0, 3, 6, 8, 10, 14], 0.1],
	};
	if (roots[style]) {
		const [on, drop] = roots[style];
		const pOct = rnd() < 0.4 ? 0 : rnd() * 0.4;
		const bar = (): BassHit[] => {
			const xs = on.filter((_, i) => i === 0 || rnd() >= drop);
			return hits(
				xs,
				xs.map((_, i) => (i > 0 && rnd() < pOct ? "o" : "r")),
			);
		};
		return [bar(), bar(), bar(), bar()];
	}
	if (style === "tresillo") {
		const on = [0, 3, 6, 8, 11, 14];
		const bar = (): BassHit[] =>
			hits(
				on,
				on.map((_, i) =>
					i % 3 === 2
						? "o"
						: i % 3 === 1 && rnd() < 0.35
							? pick<T>(["o", "f"], rnd)
							: "r",
				),
			);
		return four(bar);
	}
	// 8分オクターブ: 往復を崩しすぎない範囲で、5度・16分の刻み・小節末の経過音を曲ごとに入れる。
	const busy = rnd() * 0.9;
	const bar = (): BassHit[] => {
		const on = [0, 2, 4, 6, 8, 10, 12, 14];
		const tones: T[] = on.map((_, i) => (i % 2 === 0 ? "r" : "o"));
		if (rnd() < 0.5) tones[pick([3, 5, 7], rnd)] = "f";
		for (const i of [6, 3, 1]) {
			if (rnd() >= busy) continue;
			on.splice(i + 1, 0, on[i] + 1);
			tones.splice(i + 1, 0, tones[i] === "o" ? "r" : "o");
		}
		if (rnd() < 0.35) tones[tones.length - 1] = "a";
		return hits(on, tones);
	};
	return until(
		() => four(bar),
		(f) => f.reduce((a, x) => a + octShare(x), 0) / f.length >= 0.74,
	);
};

// ============================================================
// 海鮮の歌メロ（docs/kaiwai-lineages.md「海鮮の歌メロ」）
// ============================================================

/**
 * 8小節の文を2小節の句4つ（a b c d）で組む。句はどれも小節頭から入り、句末で8分〜4分息を継ぐ。
 * 4つの句は同じリズムの家族（共通の発音位置が3分の2前後）で、音の並びは毎回違う。
 */
export type SentenceStyle = {
	/** 句のリズムの元（拍ごとの部品。最後の2拍は句末）。 */
	motif: BeatCell[];
	stepShare: number;
	/** 音域の幅（中核音の歩数）。 */
	span: number;
	/** サビの音域を Aメロからずらす量（歩数）。 */
	lift: number;
};

const SENTENCE_CELLS: [BeatCell, number][] = [
	[[2, 2], 6],
	[[4], 2],
	[[3, 1], 2],
	[[2, 1, 1], 0.25],
	[[1, 1, 2], 0.2],
];
const SENTENCE_WIDE: [BeatCell, number][] = [
	[[6, 2], 1],
	[[8], 0.6],
	[[2, 4, 2], 0.8],
];
// 句末の2拍。半分強は4拍目が次の句の弱起（原曲の句頭は小節頭が 0〜47%、裏拍は 0〜32%）。
const SENTENCE_ENDS: [BeatCell, number][] = [
	[[6, -2], 1],
	[[4, -4], 0.5],
	[[2, 4, -2], 0.5],
	[[4, -2, 2], 1.5],
	[[2, -2, 4], 3],
	[[2, -2, 2, 2], 2.5],
	// 息を継がずに次の句へつなぐ（原曲は句の4分の1が2小節を超える）。
	[[4, 2, 2], 1],
	[[2, 2, 4], 0.6],
];

/** 6拍ぶんの部品（1拍か2拍）。 */
const sentenceBody = (rnd: () => number): BeatCell[] => {
	const out: BeatCell[] = [];
	let beats = 0;
	while (beats < 6) {
		const wide = beats <= 4 && rnd() < 0.18;
		const cell = weighted(wide ? SENTENCE_WIDE : SENTENCE_CELLS, rnd);
		out.push(cell);
		beats += wide ? 2 : 1;
	}
	return out;
};

export const sentenceStyle = (rnd: () => number): SentenceStyle => ({
	motif: [...sentenceBody(rnd), weighted(SENTENCE_ENDS, rnd)],
	stepShare: 0.8 + rnd() * 0.12,
	span: 6 + Math.floor(rnd() * 2),
	lift: pick([-1, 0, 1, 1, 2], rnd),
});

/** 別のセクションの句の元（同じ家族の親戚。部品を2〜4つ替える）。 */
export const relatedMotif = (
	motif: BeatCell[],
	rnd: () => number,
): BeatCell[] => variant(variant(motif, rnd), rnd);

/** 元の句から1〜2部品を差し替えた変奏（同じ家族）。句末も時々替える。 */
const variant = (motif: BeatCell[], rnd: () => number): BeatCell[] => {
	const out = motif.map((c) => [...c]);
	const body = out.length - 1;
	const n = 2 + (rnd() < 0.4 ? 1 : 0);
	const other = (pool: [BeatCell, number][], cur: BeatCell): BeatCell =>
		until(
			() => weighted(pool, rnd),
			(c) => c.join() !== cur.join(),
		);
	for (let k = 0; k < n; k++) {
		const i = Math.floor(rnd() * body);
		const width = out[i].reduce((a, x) => a + Math.abs(x), 0);
		out[i] = other(width === 4 ? SENTENCE_CELLS : SENTENCE_WIDE, out[i]);
	}
	if (rnd() < 0.35) out[body] = other(SENTENCE_ENDS, out[body]);
	return out;
};

/** 歌メロを組むときの外の条件。`fits` は強拍・長い音に和音の構成音を選ぶ判定、`semi` は歩数の半音。 */
export type SentenceEnv = {
	fits: (bar: number, at: number, step: number) => boolean;
	semi: (step: number) => number;
};

/**
 * 1文（8小節）の句 `from`〜3 を作る（`bar` は文の頭からの小節）。句の音は前の句の終わりから続け、
 * `cadence` なら最後の句を主音か第3音で終える。ラとドの間は弱拍の短い音でシを経過させる。
 */
const sentence = (
	rnd: () => number,
	style: SentenceStyle,
	motif: BeatCell[],
	lo: number,
	hi: number,
	start: number,
	env: SentenceEnv,
	cadence: boolean,
	from = 0,
): { bars: LeadNote[][]; end: number } => {
	const units = [
		motif,
		variant(motif, rnd),
		variant(motif, rnd),
		variant(motif, rnd),
	];
	if (rnd() < 0.15) units[0] = [[-2, 2], ...units[0].slice(1)];
	// 息継ぎ無しでつなげるのは句 a→b・c→d だけ（4小節ごとに必ず息を継ぐ）。
	for (const u of [1, 3]) {
		const end = units[u].length - 1;
		if (!units[u][end].some((x) => x < 0))
			units[u][end] = weighted(
				SENTENCE_ENDS.filter(([c]) => c.some((x) => x < 0)),
				rnd,
			);
	}
	const bars: LeadNote[][] = [];
	const mod5 = (x: number): number => ((x % 5) + 5) % 5;
	const gap = (x: number, y: number): number =>
		Math.abs(env.semi(x) - env.semi(y));
	let pos = start;
	let dir = rnd() < 0.5 ? 1 : -1;
	let afterSi: number[] | null = null;
	for (let u = from; u < 4; u++) {
		const notes: { at: number; n: LeadNote }[] = [];
		let at = 0;
		const flat = units[u].flat();
		const sounding = flat.filter((x) => x > 0).length;
		let k = 0;
		for (const len of flat) {
			if (len < 0) {
				notes.push({ at, n: { step: 0, chrom: false, len } });
				at -= len;
				continue;
			}
			k++;
			const strong = at % 8 === 0 || len >= 4;
			const end = cadence && u === 3 && k === sounding;
			const want = (x: number): boolean =>
				!end || mod5(x) === 0 || mod5(x) === 3;
			let chrom = false;
			if (!(u === 0 && k === 1 && from === 0)) {
				if (rnd() < 0.3 || pos >= hi - 1 || pos <= lo + 1)
					dir = pos >= hi - 1 ? -1 : pos <= lo + 1 ? 1 : -dir;
				const size =
					rnd() < 0.05 ? 0 : rnd() < style.stepShare ? 1 : rnd() < 0.8 ? 2 : 3;
				// 1歩が短3度になる向き（ラ↔ド・ミ↔ソ）は、半分は2度になる逆向きへ替える。
				if (
					size === 1 &&
					gap(pos, pos + dir) > 2 &&
					gap(pos, pos - dir) <= 2 &&
					rnd() < 0.5
				)
					dir = -dir;
				const cands = (
					afterSi ?? [
						pos + dir * size,
						pos + dir,
						pos - dir,
						pos + dir * 2,
						pos - dir * 2,
						pos,
					]
				).filter((x) => x >= lo && x <= hi);
				afterSi = null;
				const bar = u * 2 + Math.floor(at / 16);
				const next =
					cands.find(
						(x) => want(x) && (!strong || env.fits(bar, at % 16, x)),
					) ??
					cands.find(want) ??
					Math.max(lo, Math.min(hi, Math.round(pos / 5) * 5));
				const si = !strong && len <= 2 && !end && rnd() < 0.7;
				if (si && mod5(pos) === 0 && next === pos + 1) {
					chrom = true;
					afterSi = [pos + 1, pos];
				} else if (si && mod5(pos) === 1 && next === pos - 1) {
					chrom = true;
					afterSi = [pos - 1, pos];
				}
				pos = chrom && next === pos - 1 ? pos : next;
			}
			notes.push({ at, n: { step: pos, chrom, len } });
			at += len;
		}
		// 2小節へ切り分ける。小節をまたぐ音は頭の小節で伸ばしきり、次の小節はその分を休符で埋める。
		for (let b = 0; b < 2; b++) {
			const out: LeadNote[] = [];
			for (const { at: a, n } of notes) {
				const e = a + Math.abs(n.len);
				if (a >= b * 16 && a < (b + 1) * 16)
					out.push({
						...n,
						len: n.len > 0 ? n.len : -(Math.min(e, (b + 1) * 16) - a),
					});
				else if (a < b * 16 && e > b * 16)
					out.push({
						step: 0,
						chrom: false,
						len: -(Math.min(e, (b + 1) * 16) - b * 16),
					});
			}
			bars.push(out);
		}
	}
	return { bars, end: pos };
};

const lastStep = (bar: LeadNote[] | undefined, fallback: number): number =>
	bar?.findLast((n) => n.len > 0)?.step ?? fallback;

/**
 * セクション1つぶんの歌メロ（`bars` 小節）。16小節は後半を前半の答え（最後の句だけ替える）か
 * 新しい文にする。`center` は音域の中心（歩数）。
 */
export const sentenceSection = (
	rnd: () => number,
	style: SentenceStyle,
	motif: BeatCell[],
	bars: number,
	center: number,
	env: SentenceEnv,
): LeadNote[][] => {
	const lo = center - Math.floor(style.span / 2);
	const hi = lo + style.span;
	const out: LeadNote[][] = [];
	let start = center - 1 + Math.floor(rnd() * 3);
	let first: LeadNote[][] | null = null;
	while (out.length < bars) {
		const base = out.length;
		const local: SentenceEnv = {
			...env,
			fits: (bar, a, x) => env.fits(base + bar, a, x),
		};
		const cadence = base + 8 >= bars;
		if (first && rnd() < 0.5) {
			const tail = sentence(
				rnd,
				style,
				motif,
				lo,
				hi,
				lastStep(first[5], start),
				local,
				cadence,
				3,
			);
			out.push(...first.slice(0, 6), ...tail.bars);
			start = tail.end;
		} else {
			const s = sentence(rnd, style, motif, lo, hi, start, local, cadence);
			first ??= s.bars;
			out.push(...s.bars);
			start = s.end;
		}
	}
	return out.slice(0, bars);
};

/** 歌い直し（2番など）の版。8小節ごとに最後の句だけ答えに替える。 */
export const sentenceAnswer = (
	rnd: () => number,
	style: SentenceStyle,
	motif: BeatCell[],
	line: LeadNote[][],
	center: number,
	env: SentenceEnv,
): LeadNote[][] => {
	const lo = center - Math.floor(style.span / 2);
	const hi = lo + style.span;
	const out: LeadNote[][] = [];
	for (let base = 0; base < line.length; base += 8) {
		const head = line.slice(base, base + 6);
		const local: SentenceEnv = {
			...env,
			fits: (bar, a, x) => env.fits(base + bar, a, x),
		};
		const tail = sentence(
			rnd,
			style,
			motif,
			lo,
			hi,
			lastStep(head[5], center),
			local,
			base + 8 >= line.length,
			3,
		);
		out.push(
			...head,
			...tail.bars.slice(0, Math.max(0, line.length - base - 6)),
		);
	}
	return out.slice(0, line.length);
};

// ============================================================
// 構成（docs/kaiwai-lineages.md の「構成の幅」）
// ============================================================

/** 種別の並びと種別ごとの小節数（同じ種別は曲中で同じ長さ）。 */
export type GrammarPlan = {
	kinds: SectionKind[];
	bars: Partial<Record<SectionKind, number>>;
	/** `kinds` の添字 from〜to（含む）のセクションを `semitones` だけ移す（曲中の転調）。 */
	shift?: { from: number; to: number; semitones: number };
};

/**
 * 2号兄貴: 層を足していくイントロ（4〜16小節、無い曲もある。原曲の幅。32 だと層の遅れた入りで
 * ドラムだけが8小節続いた）→ Aメロ・サビの組を1〜3周
 * （サビ始まり・Cメロも出る）→ 1ブロックを回し続ける区間・短い締めは曲による。
 */
const nigoPlan = (rnd: () => number): GrammarPlan => {
	const kinds: SectionKind[] = [];
	const bars: GrammarPlan["bars"] = {
		verse: weighted(
			[
				[8, 2],
				[16, 1],
			],
			rnd,
		),
		chorus: weighted(
			[
				[8, 1],
				[16, 2],
			],
			rnd,
		),
	};
	if (rnd() < 0.8) {
		kinds.push("intro");
		bars.intro = weighted(
			[
				[4, 3],
				[8, 3],
				[16, 2],
			],
			rnd,
		);
	}
	const rounds = weighted(
		[
			[1, 1],
			[2, 3],
			[3, 1],
		],
		rnd,
	);
	const chorusFirst = rnd() < 0.15;
	for (let r = 0; r < rounds; r++) {
		if (r > 0 && r === rounds - 1 && rnd() < 0.4) {
			kinds.push("bridge");
			bars.bridge = pick([8, 16], rnd);
		}
		kinds.push(
			...(chorusFirst && r === 0
				? (["chorus", "verse", "chorus"] as SectionKind[])
				: (["verse", "chorus"] as SectionKind[])),
		);
	}
	if (rnd() < 0.5) kinds.push("chorus");
	if (rnd() < 0.5) {
		kinds.push("outro");
		bars.outro = pick([4, 8], rnd);
	}
	// 途中の1〜2セクションを全音上下へ（戻る曲も、そのまま終わる曲もある）。
	let shift: GrammarPlan["shift"];
	const first = kinds[0] === "intro" ? 1 : 0;
	if (rnd() < 0.3 && kinds.length - first >= 3) {
		const from = first + 1 + Math.floor(rnd() * (kinds.length - first - 1));
		const to = Math.min(kinds.length - 1, from + Math.floor(rnd() * 2));
		shift = { from, to, semitones: rnd() < 0.5 ? 2 : -2 };
	}
	return { kinds, bars, shift };
};

/**
 * 海鮮: 旋律なしイントロ（8小節が多い）→ 歌を1〜2周 → 歌が引っ込む8小節 → サビ → 楽器だけの
 * アウトロ。後ろ2つは耳コピ者で割れるので半分強の曲にだけ置く。
 */
const kaisenPlan = (rnd: () => number): GrammarPlan => {
	const kinds: SectionKind[] = [];
	const bars: GrammarPlan["bars"] = {
		verse: weighted(
			[
				[8, 3],
				[16, 1],
			],
			rnd,
		),
		chorus: weighted(
			[
				[8, 4],
				[16, 1],
			],
			rnd,
		),
		interlude: 8,
	};
	if (rnd() < 0.9) {
		kinds.push("intro");
		bars.intro = weighted(
			[
				[8, 8],
				[4, 1],
				[16, 1],
			],
			rnd,
		);
	}
	const rounds = weighted(
		[
			[1, 1],
			[2, 3],
		],
		rnd,
	);
	for (let r = 0; r < rounds; r++)
		kinds.push(
			...(r > 0 && rnd() < 0.2
				? (["chorus"] as SectionKind[])
				: (["verse", "chorus"] as SectionKind[])),
		);
	if (rnd() < 0.6) kinds.push("interlude");
	kinds.push("chorus");
	if (rnd() < 0.4) kinds.push("chorus");
	if (rnd() < 0.7) {
		kinds.push("outro");
		bars.outro = pick([4, 8], rnd);
	}
	return { kinds, bars };
};

/**
 * Speder2: 旋律なしで層を足すイントロ（16小節が多い）→ Aメロ・サビ（1つのループで通す曲もある）
 * → 層が抜ける区間・薄いアウトロは曲による。
 */
const spederPlan = (rnd: () => number): GrammarPlan => {
	const kinds: SectionKind[] = [];
	const bars: GrammarPlan["bars"] = {
		verse: pick([8, 16], rnd),
		chorus: pick([8, 16], rnd),
		interlude: pick([8, 12], rnd),
	};
	if (rnd() < 0.7) {
		kinds.push("intro");
		bars.intro = weighted(
			[
				[16, 8],
				[8, 1],
				[12, 1],
			],
			rnd,
		);
	}
	if (rnd() < 0.15) {
		// 1つのループで通す（途中で層が抜ける）。
		bars.verse = 16;
		const n = 2 + Math.floor(rnd() * 3);
		for (let i = 0; i < n; i++) {
			if (i === n - 1 && rnd() < 0.6) kinds.push("interlude");
			kinds.push("verse");
		}
	} else {
		const rounds = weighted(
			[
				[1, 1],
				[2, 3],
				[3, 1],
			],
			rnd,
		);
		const chorusFirst = rnd() < 0.2;
		for (let r = 0; r < rounds; r++) {
			const turn = r > 0 ? rnd() : 1;
			if (turn < 0.3) kinds.push("interlude");
			else if (r === rounds - 1 && turn < 0.5) {
				kinds.push("bridge");
				bars.bridge = 8;
			}
			kinds.push(
				...(chorusFirst && r === 0
					? (["chorus", "verse", "chorus"] as SectionKind[])
					: (["verse", "chorus"] as SectionKind[])),
			);
		}
		if (rnd() < 0.4) kinds.push("chorus");
	}
	if (rnd() < 0.6) {
		kinds.push("outro");
		bars.outro = pick([4, 8], rnd);
	}
	return { kinds, bars };
};

/** 流派の規則から、曲の構成（種別・数・順序・長さ・有無）を組む。 */
export const grammarPlan = (
	grammar: KaiwaiGrammar,
	rnd: () => number,
): GrammarPlan =>
	grammar === "nigo"
		? nigoPlan(rnd)
		: grammar === "kaisen"
			? kaisenPlan(rnd)
			: spederPlan(rnd);

// ============================================================
// 2号兄貴: 曲ごとの全体の作り
// ============================================================

/**
 * 2号兄貴の規則のうち、全曲で同じだったもの（音階・和声リズム・セブンス率・ベース・層の積み方・
 * サビの重ね・イントロの入り）を曲ごとに引いたテンプレートを返す。核（4つ打ち中心のドラム・
 * セブンス中心の和声・16分と3連の走句・テンポ 140〜180）は動かさない。
 */
export const varyNigo = (
	t: StructureTemplate,
	rnd: () => number,
): StructureTemplate => {
	const all: SectionKind[] = ["intro", "verse", "chorus", "bridge"];
	const perBar = weighted<NigoFeel["perBar"]>(
		[
			[2, 4],
			[1, 3],
			["mix", 3],
		],
		rnd,
	);
	const nigo: Omit<NigoFeel, "padTarget"> = {
		perBar,
		triads: rnd() < 0.35 ? 0 : 0.05 + rnd() * 0.3,
		minor: rnd() < 0.2 ? 0 : 0.4 + rnd() * 1.2,
		third: rnd() < 0.4,
		introEntry: weighted(
			[
				[{ bass: 0, backing: 0 }, 3],
				[{ bass: 2, backing: 0 }, 2],
				[{ bass: 0, backing: 2 }, 1],
				[{ bass: 2, backing: 1 }, 2],
				[{ bass: 1, backing: 3 }, 1],
			],
			rnd,
		),
	};
	const pad = weighted<SectionKind[]>(
		[
			[all, 3],
			[["chorus", "bridge"], 2],
			[["verse", "chorus", "bridge"], 2],
			[[], 3],
		],
		rnd,
	);
	type Layer = { pattern: ChordPatternType; sections: SectionKind[] | null };
	const pool: Layer[] = [
		{ pattern: "stab-quarter", sections: ["chorus", "bridge"] },
		{ pattern: "offbeat", sections: ["verse"] },
		{ pattern: "stab-eighth", sections: ["chorus"] },
		{ pattern: "arpeggio", sections: ["chorus", "bridge"] },
		{ pattern: "offbeat", sections: null },
		{ pattern: "stab-sixteenth", sections: ["chorus"] },
	];
	const backing: Layer[] = [];
	const extra = weighted(
		[
			[0, 2],
			[1, 2],
			[2, 2],
		],
		rnd,
	);
	while (backing.length < extra) {
		const l = pick(pool, rnd);
		if (!backing.some((b) => b.pattern === l.pattern)) backing.push(l);
	}
	const sparkle =
		rnd() < 0.45
			? {
					pattern: pick<ChordPatternType>(
						["arpeggio", "alternating", "stab-sixteenth"],
						rnd,
					),
					sections: pick<SectionKind[]>(
						[["chorus"], ["chorus", "bridge"], ["verse", "chorus"]],
						rnd,
					),
				}
			: null;
	const lead = weighted<{ sections: SectionKind[]; octave: number } | null>(
		[
			[{ sections: ["chorus"], octave: 1 }, 3],
			[{ sections: ["chorus"], octave: 0 }, 2],
			[{ sections: ["chorus", "bridge"], octave: 1 }, 1.5],
			[{ sections: ["verse", "chorus"], octave: 0 }, 1],
			[null, 2.5],
		],
		rnd,
	);
	const bassStyles = weighted<string[]>(
		[
			[["octave-eighth", "octave-eighth", "tresillo"], 2],
			[["root-eighth"], 1],
			[["octave-fifth"], 1],
			[["driving"], 1],
			[["octave-offbeat16"], 1],
			[["tresillo"], 1.5],
			[["syncopated"], 1],
			[["quarter", "octave-eighth"], 1],
		],
		rnd,
	);
	return {
		...t,
		// 主音ラで進行プールを差し替えない（center を持たない）音階だけ。差し替えると文法の進行が消える。
		scales: [
			weighted(
				[
					["penta_minor", 3],
					["yonuki_minor", 2],
					["minyo", 2],
				],
				rnd,
			),
		],
		form: weighted(
			[
				["motif", 3],
				["through", 2],
				["ostinato", 1.5],
				["chant", 1.5],
			],
			rnd,
		),
		harmonicRhythms: [perBar === 2 ? "half" : "bar"],
		bass: {
			styles: bassStyles,
			skeletons: weighted(
				[
					[["per-bar"], 1],
					[["fourth-bar"], 2],
					[["two-bar"], 1.5],
					[["approach"], 1.5],
				],
				rnd,
			),
			alt: ["tresillo", "root-eighth", "octave-fifth"],
			sustainCadence: false,
		},
		vocal: rnd() < 0.4 ? { duetStyles: ["none"], octave: true } : t.vocal,
		// 4つ打ちのまま、ハットとクラップの組み方だけ替える曲。
		drums: weighted(
			[
				[t.drums ?? { pool: ["four_openhat"] }, 4],
				[{ pool: ["four_clap", "four_clap_pedal", "break_openhat"] }, 2],
				[
					{
						pool: ["four_clap_16hat", "four_clap_16hat_snare", "break_openhat"],
					},
					2.5,
				],
			],
			rnd,
		),
		padKinds: rnd() < 0.7 ? pad : all,
		arrange: { backing, sparkle, pad, lead },
		// 既定のパッドの窓（MELODY_HIGH=83 の −4〜+7）から。乱数列の末尾で引く（上の抽選はそのまま）。
		nigo: { ...nigo, padTarget: 79 + Math.floor(rnd() * 12) },
	};
};
