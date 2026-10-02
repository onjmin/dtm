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
	stepShare: number;
	/** 同じ音を続ける割合（原曲は曲で 0〜19%）。 */
	same: number;
	/** 裏拍の8分を16分の長さで切る曲（原曲は16分の長さの音 47% に対し、16分の間隔は 21%）。 */
	staccato: boolean;
};

export const runStyle = (rnd: () => number): RunStyle => {
	// 16分の音価は原曲で曲ごとに 30〜64%。`busy` が曲ごとの密度で、8分の部品の重みを動かす。
	const busy = rnd();
	// 3連は原曲8曲のうち2曲だけ（他は 0）。
	const triplet = rnd() < 0.35 ? 0.6 + rnd() * 1.4 : 0.05;
	return {
		stepShare: 0.6 + rnd() * 0.25,
		same: rnd() < 0.4 ? rnd() * 0.15 : 0,
		staccato: rnd() < 0.6,
		cells: [
			[[1, 1, 1, 1], 0.15 + busy * 1.2],
			[[4 / 3, 4 / 3, 4 / 3], triplet],
			[[3, 1], 0.3 + rnd() * 0.6],
			[[2, 1, 1], 0.3 + rnd() * 0.5],
			[[1, 1, 2], 0.15 + rnd() * 0.5],
			[[1, 2, 1], 0.1 + rnd() * 0.3],
			[[2, 2], 1.5 + (1 - busy) * 3],
			[[4], 0.1 + (1 - busy) * 0.8],
			[[2, -1, 1], 0.1 + rnd() * 0.5],
		],
		maxLeap: 2 + Math.floor(rnd() * 3),
		turn: 0.15 + rnd() * 0.25,
	};
};

/**
 * 走句リードのセクションの小節割り（4小節ブロックの添字の列）。原曲では2小節前と同じ小節は
 * ほぼ出ず（8曲平均 5%）、4小節前の繰り返しは曲で 0〜80% と割れる。`rep` は曲ごとの繰り返し率。
 */
export type RunPlan = {
	xyxz: boolean;
	rep: number;
	breath: number;
	/** サビでリードを1オクターブ上へ移すか（移さない曲はサビの重ねの層が上を受け持つ）。 */
	lift: boolean;
};

export const runPlan = (rnd: () => number): RunPlan => ({
	xyxz: rnd() < 0.15,
	rep: rnd() * 0.8,
	breath: 0.3 + rnd() * 0.5,
	lift: rnd() < 0.55,
});

/** セクション1つぶんの小節（`bars` 本）。4小節ごとに、前のブロックを繰り返すか・後ろを答えるか・新しく作るか。 */
export const runSection = (
	rnd: () => number,
	style: RunStyle,
	plan: RunPlan,
	bars: number,
): LeadNote[][] => {
	const block = (): LeadNote[][] => {
		const x = runBar(rnd, style);
		return plan.xyxz
			? [x, runBar(rnd, style), x, runBar(rnd, style)]
			: [x, runBar(rnd, style), runBar(rnd, style), runBar(rnd, style)];
	};
	const first = block();
	const out: LeadNote[][] = [...first];
	while (out.length < bars) {
		const r = rnd();
		out.push(
			...(r < plan.rep
				? first
				: r < plan.rep + (1 - plan.rep) * 0.4
					? [first[0], first[1], runBar(rnd, style), runBar(rnd, style)]
					: block()),
		);
	}
	// 2・4小節の句末で息を継ぐ（原曲のリードの占有は 77〜93%）。後ろの1〜2拍を伸ばすか休む。
	return out.slice(0, bars).map((cell, i) => {
		if (i % 2 !== 1 || rnd() >= plan.breath * (i % 4 === 3 ? 1 : 0.5))
			return cell;
		const keep = rnd() < 0.4 ? 8 : 12;
		const kept: LeadNote[] = [];
		let at = 0;
		for (const n of cell) {
			if (at + Math.abs(n.len) > keep + 1e-6) break;
			kept.push({ ...n });
			at += Math.abs(n.len);
		}
		const last = kept.at(-1);
		const tail = 16 - at;
		if (last && last.len > 0 && rnd() < 0.25) last.len += tail;
		else kept.push({ step: 0, chrom: false, len: -tail });
		return kept;
	});
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

/** 走句リードの1小節: 拍ごとに 16分・3連・拍内の付点などを選び、音階を歩く。 */
export const runBar = (rnd: () => number, style: RunStyle): LeadNote[] => {
	const next = walker(
		rnd,
		Math.floor(rnd() * 4),
		-3,
		5,
		style.maxLeap,
		style.turn,
		style.stepShare,
		style.same,
	);
	const beats = [0, 1, 2, 3].map(() => weighted(style.cells, rnd));
	return fillBeats(beats, next);
};

/**
 * 1小節ループ（riff-bar）の曲ごとの癖。2度で歩く曲と3度以上で跳ぶ曲の両方がある。
 * 型は4小節ブロック [x y x z] で回す。原曲4曲とも同じ小節を続けては鳴らさない（前の小節と同一 0〜15%）。
 */
export type LoopStyle = {
	cells: [BeatCell, number][];
	stepShare: number;
	maxLeap: number;
	/** 旧版で1小節ループを引いた曲。足す小節は別の乱数列から作り、曲の乱数列を変えない。 */
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
