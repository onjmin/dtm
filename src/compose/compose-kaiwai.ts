/**
 * 界隈曲の流派テンプレート（docs/kaiwai-lineages.md）の構成・進行・リードの組み立て。
 * 構成と進行は規則（つなぎ方）から曲ごとに組み、リードはリズムの部品と輪郭の歩みから作る。
 * どの曲の写しでもない（耳コピの音符・和音列は使わない）。綴りはハ長調／イ短調。
 */

import { parseChord } from "@onjmin/chord-parser";
import type { SectionKind } from "./compose-sections";

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
	(rnd: () => number, loopTo: string | null) =>
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
				m.push([[iiOf(target, rnd), vOf(target), target], w * 0.8]);
		const chain = descend(cur, rnd);
		if (chain) m.push([chain, 1.5]);
		const leave = loopTo ? 2 : 0;
		return m.filter(([chunk]) => chunk.length <= room - leave || room <= 2);
	};

const nigoBlock = (head: string, rnd: () => number): Block => {
	const loop = rnd() < 0.6 ? head : null;
	return toBlock(
		grow(
			head,
			8,
			nigoMoves(rnd, loop),
			(cur) => NIGO_FOURTH[cur] ?? "FM7",
			rnd,
		),
	);
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

const nigo = (rnd: () => number): GrammarProgressions => {
	const core = (heads: [string, number][]) => () =>
		until(
			() => nigoBlock(weighted(heads, rnd), rnd),
			(b) => slotsOf(b).includes("FM7") && hasTwoFive(b),
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
			]),
		),
		c: four(() =>
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
				[[x, x, x, y], 1],
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
): GrammarProgressions =>
	grammar === "nigo"
		? nigo(rnd)
		: grammar === "kaisen"
			? kaisen(rnd)
			: speder(rnd);

// ============================================================
// リード
// ============================================================

/** 1拍（16分4つ）のリズムの部品。負は休符。 */
type BeatCell = number[];

/** 走句リード（riff16）の曲ごとの癖。 */
export type RunStyle = {
	cells: [BeatCell, number][];
	maxLeap: number;
	turn: number;
};

export const runStyle = (rnd: () => number): RunStyle => ({
	cells: [
		[[1, 1, 1, 1], 4],
		[[4 / 3, 4 / 3, 4 / 3], 0.6 + rnd() * 1.4],
		[[3, 1], 0.6 + rnd() * 1.2],
		[[2, 1, 1], 0.6 + rnd()],
		[[1, 1, 2], 0.3 + rnd()],
		[[1, 2, 1], 0.2 + rnd() * 0.6],
		[[2, 2], 0.2 + rnd() * 0.4],
	],
	maxLeap: 2 + Math.floor(rnd() * 3),
	turn: 0.15 + rnd() * 0.25,
});

/** 輪郭: 音階を歩き、跳躍は `maxLeap` 歩まで。範囲の端で折り返す。同音は打たない。 */
const walker = (
	rnd: () => number,
	start: number,
	lo: number,
	hi: number,
	maxLeap: number,
	turn: number,
	stepShare: number,
) => {
	let pos = start;
	let dir = rnd() < 0.5 ? -1 : 1;
	let first = true;
	return (): number => {
		if (first) {
			first = false;
			return pos;
		}
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

/** 走句リードの1小節: 拍ごとに 16分・3連・拍内の付点などを選び、音階を歩く。 */
export const runBar = (rnd: () => number, style: RunStyle): LeadNote[] => {
	const next = walker(
		rnd,
		Math.floor(rnd() * 4),
		-3,
		5,
		style.maxLeap,
		style.turn,
		0.6,
	);
	const beats = [0, 1, 2, 3].map(() => weighted(style.cells, rnd));
	return fillBeats(beats, next);
};

/**
 * 1小節ループ（riff-bar）の曲ごとの癖。2度で歩く曲と3度以上で跳ぶ曲の両方がある。
 * `oneBar` が偽の曲は1小節の型でなく4小節ブロック [x y x z] で回す。
 */
export type LoopStyle = {
	cells: [BeatCell, number][];
	stepShare: number;
	maxLeap: number;
	oneBar: boolean;
};

export const loopStyle = (rnd: () => number): LoopStyle => {
	const busy = rnd();
	return {
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
		oneBar: rnd() < 0.5,
	};
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
 * 2号兄貴: 層を足していくイントロ（4〜32小節、無い曲もある）→ Aメロ・サビの組を1〜3周
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
				[32, 1],
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
