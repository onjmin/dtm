/**
 * 界隈曲の流派テンプレート（docs/research/kaiwai-lineages.md）の構成・進行・リードの組み立て。
 * 構成と進行は規則（つなぎ方）から曲ごとに組み、リードはリズムの部品と輪郭の歩みから作る。
 * どの曲の写しでもない（耳コピの音符・和音列は使わない）。綴りはハ長調／イ短調。
 */

import { parseChord } from "@onjmin/chord-parser";
import { UNITS_PER_SEMITONE } from "../audio/tuning";
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
 * リズムの型は曲ごとの家族（数種）から引き、句は kw2 の組み方（主題・答え・ゼクエンツ・閉じ）で並べる（2026-10-27）。
 */
export type LineStyle = {
	/** Aメロの4小節の輪郭（着地点の高さの並び）。 */
	contour: Contour;
	/** サビの4小節の輪郭。 */
	hookContour: Contour;
	/** 着地点の前の道の型（1〜2種）。曲の手癖になる。 */
	figures: Figure[];
	/** Aメロの半小節の型の家族（16分単位、和は8）。主題・答え・閉じの小節のリズムをここから引く。 */
	cells: number[][];
	/**
	 * サビの半小節の型の家族。7割の曲は kw2 のように付点・8分で歌う型（＋走る型1つ）、残りは走る型。
	 * 手本の MIDI は一番高い8小節でも16分を減らさない（9本中 9本）が、所有者の耳は kw2 を上とした（2026-10-27）。
	 */
	hookCells: number[][];
	/** 着地点に和音の外の音階の音（9度・11度など）も許す。 */
	tension: boolean;
	/** 歩く範囲（主音からの歩数）。 */
	lo: number;
	hi: number;
	/** 裏拍の8分を16分の長さで切る曲（原曲は16分の長さの音 47% に対し、16分の間隔は 21%）。 */
	staccato: boolean;
	/** 句末で息を継ぐ割合（原曲のリードの占有は 77〜93%）。 */
	breath: number;
	/**
	 * 音階で着地点へ駆け込むとき、直前の音を半音の経過音にする割合（全音の隙間だけ）。0 の曲は全音階のまま。
	 * 手本の Granite は駆け下り・駆け上がりに半音を通す（2026-10-27）。
	 */
	chromatic: number;
	/**
	 * サビの句の切れ目（主題へ戻る直前の小節）を山場の駆け上がりにする形。`half` は伸ばした音から後ろ半分を
	 * 16分で駆け上がる、`full` は1小節16分で1オクターブ駆け下りてから駆け上がる（Granite の15小節目の形）。
	 * null の曲は今までどおり閉じる。
	 */
	climb: "half" | "full" | null;
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
// 重みは kw2 寄り（16分で駆け込んで8分で止まる型が中心。全部16分の型は少なく。2026-10-27）。
const RUN_CELLS: [number[], number][] = [
	[[1, 1, 1, 1, 2, 2], 4],
	[[2, 1, 1, 2, 2], 4],
	[[1, 1, 2, 1, 1, 2], 3],
	[[1, 1, 2, 2, 2], 3],
	[[2, 1, 1, 1, 1, 2], 2],
	[[2, 2, 1, 1, 2], 2],
	[[4, 2, 2], 1],
	[[2, 2, 2, 2], 1],
	[[1, 1, 1, 1, 1, 1, 1, 1], 1],
	[[2, 1, 1, 1, 1, 1, 1], 1],
	[[1, 1, 1, 1, 4], 1],
];
/** 3連を含む半小節（手本の配布 MIDI 6本中 5本で、3連の裏に来る音が 9〜43%）。 */
const TRIPLET_CELLS: [number[], number][] = [
	[[4 / 3, 4 / 3, 4 / 3, 2, 2], 2],
	[[4 / 3, 4 / 3, 4 / 3, 4], 1],
	[[2, 2, 4 / 3, 4 / 3, 4 / 3], 1],
];
/** サビの歌う半小節。 */
// kw2 のサビは付点＋16分＋8分（3,1,2,2）と、4分＋8分2つ（4,2,2）が中心。長く伸ばす型は少なく（2026-10-27）。
const HOOK_RHYTHMS: [number[], number][] = [
	[[3, 1, 2, 2], 4],
	[[4, 2, 2], 3],
	[[2, 2, 2, 2], 1],
	[[2, 1, 1, 4], 1],
	[[2, 2, 4], 1],
];

/** `per` は1オクターブの段数（全音階 7、五音 5）。 */
export const lineStyle = (rnd: () => number, per = 5): LineStyle => {
	const figure = (): Figure =>
		weighted<Figure>(
			[
				["run", 4],
				["turn", 2],
				// 歩き（walk）は引かない。2音を行き来するジグザグになり、kw2 の音階の駆け込みと別物だった（2026-10-27）
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
		rnd() < 0.3
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
		tension: rnd() < 0.3,
		// 全音階（1オクターブ7段）の曲は、五音の段の -2〜-3・4〜6 と同じ高さの幅を段で取り直す
		lo: per === 7 ? -3 - Math.floor(rnd() * 2) : -2 - Math.floor(rnd() * 2),
		hi: per === 7 ? 6 + Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 3),
		staccato: rnd() < 0.4,
		breath: 0.05 + rnd() * 0.9,
		chromatic: rnd() < 0.6 ? 0.2 + rnd() * 0.4 : 0,
		climb: weighted<"half" | "full" | null>(
			[
				["half", 2],
				["full", 2],
				[null, 1],
			],
			rnd,
		),
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
	/** 段の高さ（半音。臨時記号は含まない）。全音の隙間に半音の経過音を入れるかを見る。 */
	semi: (step: number) => number;
};

/**
 * `from` から `to` へ向かう `n` 個の音（`to` は含まない）。遠ければ1回跳んでから音階で駆け込む。
 * 近ければ、反対へ離れてから寄るか、着地点を越えてから戻る（回り込み）。範囲 [`lo`, `hi`] を出ない方を選ぶ。
 * 以前は道が短いと直前の音と隣の音の往復を足し、範囲を出た音は端で折り返していて、2音を行き来するジグザグと
 * 連打になった（2026-10-27。kw2 の駆け込みは音階と回り込みだけ）。
 */
const pathTo = (
	from: number,
	to: number,
	n: number,
	rnd: () => number,
	lo = Number.NEGATIVE_INFINITY,
	hi = Number.POSITIVE_INFINITY,
): number[] => {
	if (n <= 0) return [];
	const dist = Math.abs(to - from);
	const d = to === from ? (rnd() < 0.5 ? 1 : -1) : Math.sign(to - from);
	// 遠いときは1回だけ跳んで、そこから音階で着地点へ駆け込む（跳躍を道の途中に散らさない）
	if (dist >= n + 1)
		return Array.from({ length: n }, (_, i) => to - d * (n - i));
	// ちょうど音の数だけ離れているときは、着地点の隣まで音階で行って1段越え、上（下）から着く
	if (dist === n && n >= 2)
		return [
			...Array.from({ length: n - 1 }, (_, i) => from + d * (i + 1)),
			to + d,
		];
	/** `a` の次から `b` まで `count` 個（等分。2度で足りなければ3度を混ぜる）。 */
	const leg = (a: number, b: number, count: number): number[] =>
		Array.from(
			{ length: count },
			(_, i) => a + Math.round(((i + 1) * (b - a)) / count),
		);
	// 反対へ離れてから着地点の隣まで寄る
	const away = Math.max(1, Math.ceil((n - dist + 1) / 2));
	const back = from - d * Math.min(away, n);
	const viaBack = [
		...leg(from, back, Math.min(away, n)),
		...leg(back, to - d, n - Math.min(away, n)),
	];
	// 着地点を越えてから戻る（越える幅で音の数を合わせる）
	const over = Math.max(1, Math.ceil((n - dist + 1) / 2));
	const peak = to + d * over;
	const up = Math.min(n, dist + over);
	const viaOver = [...leg(from, peak, up), ...leg(peak, to + d, n - up)];
	// どちらも範囲を出るとき（端の近く）は、範囲の内側から1回跳んで音階で駆け込む
	const fromBelow = Array.from({ length: n }, (_, i) => to - (n - i));
	const fromAbove = Array.from({ length: n }, (_, i) => to + (n - i));
	const out = (xs: number[]) => xs.filter((x) => x < lo || x > hi).length;
	const prefer = rnd() < 0.6 ? [viaBack, viaOver] : [viaOver, viaBack];
	let best = prefer[0];
	for (const xs of [...prefer, fromBelow, fromAbove])
		if (out(xs) < out(best)) best = xs;
	return best;
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
	if (figure === "turn" && pre >= 3) {
		// 着地点の隣で小さく回ってから着く（kw2 の C D C B♭→G）。3段越える回り方は、ペンタトニックでは6度も跳んだ。
		// 回る側は範囲の内側に取る（端を越えて折り返すと2音を行き来するジグザグになった）
		const s =
			t + 2 > style.hi + 1 ? -1 : t - 2 < style.lo - 1 ? 1 : prev >= t ? 1 : -1;
		before = [
			...pathTo(prev, t + s, pre - 3, rnd, style.lo - 1, style.hi + 1),
			t + s,
			t + 2 * s,
			t + s,
		];
	} else if (figure === "walk" && pre >= 2) {
		const step = walker(rnd, prev, style.lo, style.hi, 3, 0.3, 0.65);
		step();
		before = Array.from({ length: pre }, () => step());
		before[pre - 1] = t + (before[pre - 2] >= t ? 1 : -1);
	} else before = pathTo(prev, t, pre, rnd, style.lo - 1, style.hi + 1);
	const after = pathTo(
		t,
		next,
		rhythm.length - ti - 1,
		rnd,
		style.lo - 1,
		style.hi + 1,
	);
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
	// 道の音が和音と半音でぶつかるなら、隣の段へずらす（前後と同じ音にならない方を選ぶ。最後の音は次の着地点とも比べる）。
	// 前の音に近づく向きを先に試す（離れる向きへずらすと4度の跳躍が増えた）
	let at = (k % 2) * 8;
	const notes = rhythm.map((len, i) => {
		let s = steps[i];
		// 半小節の頭（1・3拍目）の音も和音の音へ寄せる（kw2 は1・3拍目の和音の音 76%。着地点だけ寄せた版は
		// 16分で駆け込む型で頭が経過音になり、曲によって 3〜6割だった。2026-10-27）
		if (i === 0 && i !== ti && !env.fits(Math.floor(k / 2), at, s))
			for (const dx of (steps[i + 1] ?? next) > s ? [1, -1] : [-1, 1]) {
				const c = s + dx;
				if (
					env.fits(Math.floor(k / 2), at, c) &&
					c !== prev &&
					c !== steps[i + 1]
				) {
					s = c;
					break;
				}
			}
		if (i !== ti && env.clash(Math.floor(k / 2), at, s))
			for (const dx of (steps[i - 1] ?? prev) > s ? [1, -1] : [-1, 1]) {
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
	return chromaticApproach(rnd, style, env, notes, ti);
};

/**
 * 音階で着地点 `notes[ti]` へ駆け込む直前の音を、全音の隙間なら半音の経過音にする（`style.chromatic` の割合）。
 * 上りは着地点の半音下、下りは上の段の半音下（＝着地点の半音上）。綴りは `chrom`（その段の半音下）で持つ。
 */
const chromaticApproach = (
	rnd: () => number,
	style: LineStyle,
	env: LineEnv,
	notes: LeadNote[],
	ti: number,
): LeadNote[] => {
	if (style.chromatic <= 0 || ti < 2) return notes;
	const [a, b, t] = [notes[ti - 2], notes[ti - 1], notes[ti]];
	if (b.len > 2 || a.len <= 0 || b.len <= 0 || rnd() >= style.chromatic)
		return notes;
	const up = a.step === t.step - 2 && b.step === t.step - 1;
	const down = a.step === t.step + 2 && b.step === t.step + 1;
	if (up && env.semi(t.step) - env.semi(t.step - 1) === 2)
		notes[ti - 1] = { ...b, step: t.step, chrom: true };
	else if (down && env.semi(t.step + 1) - env.semi(t.step) === 2)
		notes[ti - 1] = { ...b, step: t.step + 1, chrom: true };
	return notes;
};

/**
 * 走句リードのセクション（`bars` 小節）。所有者が上とした手書き（kw2）の組み方を規則にした（2026-10-27）。
 * kw2 は1小節の主題を作り、2小節目で答え、3小節目で主題を音階の上へずらし（ゼクエンツ）、4小節目を長い音で閉じる。
 * 8小節の後半は頭の2小節をそのまま返し、3小節目を少し変え、最後を主音で閉じる。サビは主題のリズムを3小節続ける。
 * 半小節ごとに型をばらばらに引いた版（3版目）は、戻ってくる主題が無く kw2 に届かなかった（所有者）。
 * 1小節の中は、半小節ごとの着地点（骨格）を先に決め、直前の音からの道で埋める（2026-10-26 の作りのまま）。
 */
export const lineSection = (
	rnd: () => number,
	style: LineStyle,
	bars: number,
	env: LineEnv,
	chorus = false,
): LeadNote[][] => {
	// サビは着地点を範囲の上寄りに置く（サビで必ず上へ移るのは所有者の指示、2026-10-26）。
	const heights = chorus
		? CONTOURS[style.hookContour].map((h) => 0.25 + 0.55 * h)
		: CONTOURS[style.contour];
	const span = style.hi - style.lo;
	const level = (i: number): number => Math.round(style.lo + heights[i] * span);
	const family = chorus ? style.hookCells : style.cells;
	const singing = family.filter((c) => HOOK_RHYTHMS.some(([h]) => h === c));
	const figure = pick(style.figures, rnd);
	const top = style.hi + 1;
	const bottom = style.lo - 1;
	const fold = (x: number): number =>
		x > top
			? Math.max(bottom, 2 * top - x)
			: x < bottom
				? Math.min(top, 2 * bottom - x)
				: x;
	/** 半小節の着地点の位置（小節の中の16分）。 */
	const landAt = (half: number, rhythm: number[]): number =>
		half * 8 + rhythm.slice(0, landingOf(rhythm)).reduce((a, b) => a + b, 0);
	/** 着地点を和音の音へ寄せる（`tension` の曲は寄せないこともある）。 */
	const snap = (bar: number, at: number, raw: number): number => {
		if (style.tension && rnd() < 0.12) return fold(raw);
		for (const dx of [0, -1, 1, -2, 2]) {
			const s = raw + dx;
			if (s >= bottom && s <= top && env.fits(bar, at, s)) return s;
		}
		return fold(raw);
	};
	/** `snap` と同じ候補（±2段の和音の音）のうち、`ok` を満たす一番近いもの。無ければ `snap`。 */
	const snapBy = (
		bar: number,
		at: number,
		raw: number,
		ok: (s: number) => boolean,
	): number => {
		if (style.tension && rnd() < 0.12) return fold(raw);
		for (const dx of [0, -1, 1, -2, 2]) {
			const s = raw + dx;
			if (s >= bottom && s <= top && env.fits(bar, at, s) && ok(s)) return s;
		}
		return snap(bar, at, raw);
	};
	const lastOf = (notes: LeadNote[], fallback: number): number =>
		[...notes].reverse().find((n) => n.len > 0)?.step ?? fallback;
	/** 1小節を、2つの着地点（高さの生の値）とリズムから作る。 */
	const makeBar = (
		bar: number,
		rs: number[][],
		raw0: number,
		raw1: number,
		next: number,
		prev: number,
	): LeadNote[] => {
		// 着地点は、道を全部2度で歩ける高さ（音の数と距離の偶奇が合うもの）を近い和音の音から選ぶ。
		// 合わないと道の途中で1段飛ばし（ペンタトニックでは4度）が入り、kw2 より跳ぶ旋律になった（2026-10-27）。
		const pre0 = landingOf(rs[0]);
		const post0 = rs[0].length - pre0 - 1;
		const t0 = snapBy(bar, landAt(0, rs[0]), raw0, (s) => {
			const dist = Math.abs(s - prev);
			return dist > pre0 + 1 || (pre0 + 1 + dist) % 2 === 0;
		});
		const t1 = snapBy(bar, landAt(1, rs[1]), raw1, (s) => {
			const dist = Math.abs(s - t0);
			return dist > post0 + 1 || (post0 + 1 + dist) % 2 === 0;
		});
		const x = realizeSlot(
			rnd,
			style,
			env,
			2 * bar,
			rs[0],
			figure,
			prev,
			t0,
			t1,
		);
		return [
			...x,
			...realizeSlot(
				rnd,
				style,
				env,
				2 * bar + 1,
				rs[1],
				figure,
				lastOf(x, t0),
				t1,
				next,
			),
		];
	};
	/**
	 * 別の小節へ移した音（主題のゼクエンツ・答え）を、その小節の和音へ合わせ直す。
	 * 半小節ごとの着地点（一番長い音）は和音の音へ、ほかの音は和音と半音でぶつかるときだけ隣へずらす。
	 */
	const refit = (bar: number, notes: LeadNote[]): LeadNote[] => {
		const out = notes.map((n) => ({
			...n,
			step: n.len > 0 ? fold(n.step) : n.step,
		}));
		const pos: number[] = [];
		let t = 0;
		for (const n of out) {
			pos.push(t);
			t += Math.abs(n.len);
		}
		const lands = new Set<number>();
		for (const half of [0, 1]) {
			let best = -1;
			for (let i = 0; i < out.length; i++)
				if (out[i].len > 0 && pos[i] >= half * 8 && pos[i] < half * 8 + 8)
					if (best < 0 || out[i].len > out[best].len) best = i;
			if (best >= 0) lands.add(best);
		}
		// 着地点は和音の音へ。前後の音と同じになるずらしは避ける（16分の連打は角張って聞こえた。2026-10-26）
		for (const i of lands) {
			const raw = out[i].step;
			const near = [out[i - 1]?.step, out[i + 1]?.step];
			for (const dx of [0, -1, 1, -2, 2]) {
				const s = raw + dx;
				if (
					s >= bottom &&
					s <= top &&
					env.fits(bar, pos[i], s) &&
					!near.includes(s)
				) {
					out[i].step = s;
					break;
				}
			}
		}
		for (let i = 0; i < out.length; i++) {
			if (
				lands.has(i) ||
				out[i].len <= 0 ||
				!env.clash(bar, pos[i], out[i].step)
			)
				continue;
			for (const dx of [1, -1]) {
				const c = out[i].step + dx;
				if (
					!env.clash(bar, pos[i], c) &&
					c !== out[i - 1]?.step &&
					c !== out[i + 1]?.step
				) {
					out[i].step = c;
					break;
				}
			}
		}
		return out;
	};
	/** 小節ごと `d` 段ずらす。範囲を出る分は小節ごと内側へ戻す（1音ずつ折り返すと連打やジグザグになった）。 */
	const shift = (notes: LeadNote[], d: number): LeadNote[] => {
		const steps = notes.filter((n) => n.len > 0).map((n) => n.step + d);
		const hiOver = Math.max(0, Math.max(...steps) - top);
		const loOver = Math.max(0, bottom - Math.min(...steps));
		const back = hiOver > 0 ? -hiOver : loOver;
		return notes.map((n) =>
			n.len > 0 ? { ...n, step: n.step + d + back } : { ...n },
		);
	};
	const cell = (): number[] => pick(family, rnd);
	// 主題のリズム。サビの歌う曲は歌う型を2つ（kw2 は付点＋8分と、4分で伸ばす型）。
	const two = (pool: number[][]): number[][] => {
		const a = pick(pool, rnd);
		let b = pick(pool, rnd);
		for (let i = 0; i < 4 && b === a && pool.length > 1; i++)
			b = pick(pool, rnd);
		return [a, b];
	};
	const motifRhythm = two(chorus && singing.length > 0 ? singing : family);
	// 句の閉じは16分4つで駆け込んで4分で伸ばす（kw2 はサビも b4 の F G B♭ C→D で閉じる）。
	// 歌うサビを8分の閉じにしていた版は、サビの長い曲で16分の音価が 2割5分を割った。
	const closing = [1, 1, 1, 1, 4];
	const out: LeadNote[][] = [];
	let prev = level(0) + (rnd() < 0.5 ? 2 : -2);
	const push = (notes: LeadNote[]): void => {
		out.push(notes);
		prev = lastOf(notes, prev);
	};
	// 1小節目: 主題。前の着地点を高く、後ろを低く（駆け上がって降りる）か、その逆。
	const arch = rnd() < 0.7;
	// サビは2つの着地点を近く置く（kw2 のサビは D7→B♭6 のように1〜2段。歌う型は間の音が少なく、離すと跳ぶ）
	const motif = makeBar(
		0,
		motifRhythm,
		chorus ? level(1) + 1 : level(1) + (arch ? 1 : -1),
		chorus ? level(1) - (arch ? 1 : -1) : level(0) + (arch ? -1 : 1),
		level(2),
		prev,
	);
	// 2小節目: 答え。主題と同じリズムで、音の動きを上下に返すか、別のリズムで次の高さへ。
	const answerOf = (bar: number): LeadNote[] => {
		if (chorus && rnd() < 0.7) {
			const first = motif.find((n) => n.len > 0)?.step ?? 0;
			// 半音の経過音（段の半音下）は、返すと着地点の反対側へ回るので1段上の半音下に置き直す
			const inv = motif.map((n) =>
				n.len > 0
					? { ...n, step: 2 * first - n.step + (n.chrom ? 1 : 0) }
					: { ...n },
			);
			const head = inv.find((n) => n.len > 0)?.step ?? 0;
			const near = prev + (prev >= level(3) ? -2 : 2);
			return refit(bar, shift(inv, near - head));
		}
		return makeBar(bar, two(family), level(3), level(2), level(4), prev);
	};
	// 3小節目: 主題を音階の上へ1〜3段ずらす（下へ1段も少し）。着地点が和音の音に多く合うずらしを選ぶ。
	/** 主題の2つの着地点（半小節ごとの一番長い音の高さ）。 */
	const motifLands = (): [number, number] => {
		const out: number[] = [];
		let t = 0;
		for (const half of [0, 1]) {
			let best: LeadNote | undefined;
			t = 0;
			for (const n of motif) {
				if (
					n.len > 0 &&
					t >= half * 8 &&
					t < half * 8 + 8 &&
					(!best || n.len > best.len)
				)
					best = n;
				t += Math.abs(n.len);
			}
			out.push(best?.step ?? level(half));
		}
		return [out[0], out[1]];
	};
	const sequenceOf = (bar: number): LeadNote[] => {
		const ds = rnd() < 0.8 ? [2, 1, 3] : [-1, 1, 2];
		// Aメロは kw2 のように小節ごとにリズムを替え、主題の着地点の高さだけを上へずらして沿わせる
		if (!chorus) {
			const [l0, l1] = motifLands();
			return makeBar(bar, two(family), l0 + ds[0], l1 + ds[0], level(6), prev);
		}
		let best = shift(motif, ds[0]);
		let score = -1;
		for (const d of ds) {
			const moved = shift(motif, d);
			const fitted = refit(bar, moved);
			const same = fitted.filter((n, i) => n.step === moved[i].step).length;
			if (same > score) {
				score = same;
				best = fitted;
			}
		}
		return best;
	};
	// 4小節目: 句を閉じる。後ろの半小節を長い音で伸ばす。最後の句は主音へ。
	const cadence = (bar: number, home: boolean): LeadNote[] =>
		makeBar(
			bar,
			[cell(), home && rnd() < 0.5 ? [8] : closing],
			level(6),
			home ? 0 : level(7),
			level(0),
			prev,
		);
	/**
	 * 山場の駆け上がり: 主題へ戻る直前の小節を16分で駆け上がり、主題の頭の音の1段下から次の小節へ渡す。
	 * 手本の Granite はサビの8小節目で駆け下りてから駆け上がり、主題をオクターブ上で返す（2026-10-27）。
	 */
	const climbTo = (bar: number): LeadNote[] => {
		const target = motif.find((n) => n.len > 0)?.step ?? level(0);
		let line: LeadNote[];
		if (style.climb === "full") {
			// 主題の頭の音から1オクターブ下りて、折り返して駆け上がる
			const down = Array.from({ length: 8 }, (_, i) => target - i);
			const up = Array.from({ length: 8 }, (_, i) => target - 8 + i);
			line = [...down, ...up].map((step) => ({ step, chrom: false, len: 1 }));
		} else {
			// 和音の音で伸ばしてから、後ろ半分ほどを音階で駆け上がる
			let h = target - 9;
			for (const dx of [0, -1, 1, -2, 2])
				if (env.fits(bar, 0, target - 9 + dx)) {
					h = target - 9 + dx;
					break;
				}
			const count = target - 1 - h;
			line = [
				{ step: h, chrom: false, len: 16 - count },
				...Array.from({ length: count }, (_, i) => ({
					step: h + 1 + i,
					chrom: false,
					len: 1,
				})),
			];
		}
		// 最後の音は、全音の隙間なら半音で主題へ入る
		if (rnd() < 0.7 && env.semi(target) - env.semi(target - 1) === 2)
			line[line.length - 1] = { step: target, chrom: true, len: 1 };
		return line;
	};
	const climbing = chorus && style.climb !== null;
	const block: LeadNote[][] = [];
	block[0] = motif;
	push(motif);
	block[1] = answerOf(1);
	push(block[1]);
	block[2] = sequenceOf(2);
	push(block[2]);
	// 8小節のサビは4小節目、16小節以上は8小節目を駆け上がりにする（どちらも次の小節は主題）
	block[3] = climbing && bars === 8 ? climbTo(3) : cadence(3, false);
	push(block[3]);
	// 5〜6小節目は頭の2小節を返す（kw2 は2回とも返す）。7小節目は3小節目のまま（サビ）か後ろを変える。
	block[4] = block[0].map((n) => ({ ...n }));
	push(block[4]);
	block[5] = block[1].map((n) => ({ ...n }));
	push(block[5]);
	const range = {
		lo: style.lo,
		hi: style.hi,
		maxLeap: 3,
		turn: 0.3,
		stepShare: 0.65,
	};
	/**
	 * 3小節目の飾り（kw2 の7小節目）: 1拍を3連の3音に替える。後ろの音が下なら音階で降り（F D C）、
	 * そうでなければ回る（Bb C Bb）。替えられる拍が無ければそのまま。
	 */
	const ornament = (bar: number, notes: LeadNote[]): LeadNote[] => {
		let t = 0;
		const starts = notes.map((n) => {
			const x = t;
			t += Math.abs(n.len);
			return x;
		});
		const beats = [0, 4, 8, 12].filter((b) => {
			const inside = notes.filter(
				(_, i) => starts[i] >= b && starts[i] < b + 4,
			);
			return (
				inside.length > 0 &&
				inside.every((n) => n.len > 0 && Number.isInteger(n.len)) &&
				starts.includes(b) &&
				inside.reduce((a, n) => a + n.len, 0) === 4
			);
		});
		if (beats.length === 0) return notes.map((n) => ({ ...n }));
		const b = pick(beats.slice(0, Math.max(1, beats.length - 1)), rnd);
		const i0 = starts.indexOf(b);
		const s0 = notes[i0].step;
		const after =
			notes.find((_, i) => starts[i] >= b + 4 && notes[i].len > 0)?.step ?? s0;
		const tri = after < s0 ? [s0, s0 - 1, s0 - 2] : [s0, s0 + 1, s0];
		return refit(bar, [
			...notes.filter((_, i) => starts[i] < b),
			...tri.map((step) => ({ step, chrom: false, len: 4 / 3 })),
			...notes.filter((_, i) => starts[i] >= b + 4),
		]);
	};
	// 7小節目: サビは3小節目のまま（kw2 のサビ）か飾りを入れる。Aメロは飾り（kw2 の a7）か後ろを替える。
	block[6] =
		chorus && rnd() < 0.6
			? block[2].map((n) => ({ ...n }))
			: rnd() < 0.7
				? ornament(6, block[2])
				: refit(
						6,
						developBar(rnd, block[2], range, () =>
							makeBar(6, two(family), level(4), level(5), level(6), prev),
						),
					);
	push(block[6]);
	const climbAt8 = climbing && bars > 8;
	block[7] = climbAt8 ? climbTo(7) : cadence(7, true);
	push(block[7]);
	// 8小節を超える分は、同じ8小節を返し、最後の2小節だけ作り直す（kw2 のサビは 4小節×4 で終わりだけ違う）。
	// 駆け上がりは主題へ戻るところだけに置き、セクションの最後は閉じる。
	for (let b = 8; b < bars; b++) {
		const i = b % 8;
		if (climbAt8 && i === 7)
			push(b === bars - 1 ? cadence(7, true) : block[7].map((n) => ({ ...n })));
		else if (i < 6 || rnd() < 0.3) push(block[i].map((n) => ({ ...n })));
		else push(i === 6 ? ornament(6, block[2]) : cadence(7, true));
	}
	// 句末で息を継ぐ（伸ばした着地点の後ろを8分だけ休む）
	for (let b = 3; b < out.length; b += 4) {
		if (rnd() >= style.breath * 0.6) continue;
		const notes = out[b];
		const last = notes[notes.length - 1];
		if (last.len > 2)
			out[b] = [
				...notes.slice(0, -1),
				{ ...last, len: last.len - 2 },
				{ step: 0, chrom: false, len: -2 },
			];
	}
	return out.slice(0, bars);
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
// 海鮮の歌メロ（docs/research/kaiwai-lineages.md「海鮮の歌メロ」）
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
// 構成（docs/research/kaiwai-lineages.md の「構成の幅」）
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

// ============================================================
// 2号兄貴（楽器リード）: リードの写しに代わる層
// ============================================================

/** 層の音。音高は units（{@link UNITS_PER_SEMITONE} 刻みの絶対音高）。 */
export type PartNote = {
	startStep: number;
	durationSteps: number;
	pitchUnits: number;
	velocity: number;
};

export type PartContext = {
	/** 走句リード（主旋律）の音。 */
	lead: PartNote[];
	/** 和音ごとの区間と構成音（units。オクターブはどこでもよい）。先頭が根音。 */
	chords: { start: number; end: number; tones: number[] }[];
	sections: { kind: SectionKind; start: number; end: number }[];
	/** 16分音符1つのステップ数。 */
	sixteenth: number;
	/** 伴奏・飾りがもうアルペジオを持っているセクション（重ねない）。 */
	arpTaken: SectionKind[];
};

export type NigoParts = {
	/** 対旋律。和音の音を声部進行でつなぐ長い音（サブメロの枠）。 */
	counter: PartNote[];
	/** 合いの手。リードが伸ばす・休む隙間に、リードの下で返す短い句（サビ重ねの枠）。 */
	answer: PartNote[];
	/** アルペジオ。和音の音を刻む（主旋律の写しだった枠）。 */
	arp: PartNote[];
};

/**
 * 走句リードの曲の、リードの写しに代わる3つの層を作る。
 *
 * 2026-10-28 まで、上級者モードの t13 は4割の曲でリードの1オクターブ下の写し（全音一致）、t1 はサビのリードの写しで、
 * サブメロ・ハモリの枠は空だった（所有者「枠がありながら同じ音のオクターブずらし」「全部のトラックを使っていない」）。
 * 手本は同時に4〜5層で、リードの他は和音刻み・パッド・ベース。写しをやめ、リードに無い動き（長い音・返し・刻み）を
 * 持つ層へ替える。どれも和音の音だけで組むので、リードとこすらない。
 */
export const nigoParts = (rnd: () => number, ctx: PartContext): NigoParts => {
	const S = UNITS_PER_SEMITONE;
	const six = ctx.sixteenth;
	const pcOf = (u: number): number => pc(Math.round(u / S));
	const chordAt = (t: number) =>
		ctx.chords.find((c) => c.start <= t && t < c.end);
	const leadAt = (t: number) =>
		ctx.lead.find((n) => n.startStep <= t && t < n.startStep + n.durationSteps);
	/** 和音の音を [lo, hi] に並べた梯子。 */
	const ladder = (tones: number[], lo: number, hi: number): number[] => {
		const out: number[] = [];
		for (const t of tones) {
			let u = t - Math.floor((t - lo) / (12 * S)) * 12 * S;
			for (; u <= hi; u += 12 * S) if (u >= lo) out.push(u);
		}
		return [...new Set(out)].sort((a, b) => a - b);
	};
	const meanOf = (ns: PartNote[]): number =>
		ns.reduce((a, n) => a + n.pitchUnits, 0) / Math.max(1, ns.length);
	const leadIn = (s: { start: number; end: number }) =>
		ctx.lead.filter((n) => n.startStep >= s.start && n.startStep < s.end);
	const verseLead = ctx.sections
		.filter((s) => s.kind === "verse")
		.flatMap(leadIn);
	const home = meanOf(verseLead.length > 0 ? verseLead : ctx.lead);
	const of = (kinds: SectionKind[]) =>
		ctx.sections.filter((s) => kinds.includes(s.kind));

	// --- 対旋律: 和音が変わるたびに近い和音の音へ動く。根音より3度・7度を好み、同じ音の居座りを嫌う ---
	const counter: PartNote[] = [];
	const counterKinds = weighted<SectionKind[]>(
		[
			[["chorus", "drop_chorus"], 2],
			[["verse", "chorus", "drop_chorus"], 3],
			[["verse", "chorus", "drop_chorus", "bridge"], 2],
		],
		rnd,
	);
	const counterFeel = rnd() < 0.6 ? "hold" : "push";
	/** 和音1つを8つに割ったリズム。曲ごとに2つ引き、和音ごとに交互に使う。 */
	const cells = [
		[8],
		[6, 2],
		[4, 4],
		[3, 3, 2],
		[2, 6],
		[4, 2, 2],
		[6, 1, 1],
		[5, 3],
		[2, 2, 4],
		[3, 5],
	];
	const cellA = pick(cells, rnd);
	const cellB = rnd() < 0.4 ? cellA : pick(cells, rnd);
	/** 2音目からの向き（0 は上下交互）。 */
	const counterDir = pick([1, -1, 0], rnd);
	const below = (15 + Math.floor(rnd() * 5)) * S;
	for (const sec of of(counterKinds)) {
		const lead = leadIn(sec);
		if (lead.length === 0) continue;
		const center = meanOf(lead) - below;
		let prev: number | null = null;
		let stay = 0;
		const segs: { start: number; end: number; tones: number[] }[] = [];
		for (const c of ctx.chords) {
			const start = Math.max(c.start, sec.start);
			const end = Math.min(c.end, sec.end);
			if (end <= start) continue;
			segs.push({ start, end, tones: c.tones });
		}
		for (const [i, seg] of segs.entries()) {
			const cands = ladder(seg.tones, center - 8 * S, center + 8 * S);
			const root = pcOf(seg.tones[0]);
			// 前へ食う曲は、セクション頭以外の音を8分だけ早く入る（2号の裏から入る和音と揃える）。
			const start =
				counterFeel === "push" && i > 0 ? seg.start - 2 * six : seg.start;
			// 入りの瞬間と和音の頭で鳴っているリードの音。
			const sounding = [leadAt(start), leadAt(seg.start)].flatMap((n) =>
				n ? [pcOf(n.pitchUnits)] : [],
			);
			const cost = (u: number): number =>
				(prev === null
					? Math.abs(u - center) / S / 2
					: Math.abs(u - prev) / S) +
				Math.abs(u - center) / S / 6 +
				(pcOf(u) === root ? 1.5 : 0) +
				(u === prev ? (stay >= 1 ? 4 : 0.5) : 0) +
				(sounding.includes(pcOf(u)) ? 1 : 0) +
				// リードと半音でこすれる音を避ける（避けないと入りの2割がこすれる曲があった）。
				(sounding.some((p) => [1, 11].includes(pc(p - pcOf(u)))) ? 4 : 0) +
				rnd() * 0.3;
			const scored = cands.map((u) => ({ u, c: cost(u) }));
			const u = scored.reduce((a, b) => (b.c < a.c ? b : a)).u;
			stay = u === prev ? stay + 1 : 0;
			// 和音の中は曲ごとのリズムで刻み、2音目からは隣の和音の音へ動く。
			// 1和音1音の伸ばしだけだと、どの曲の対旋律も同じ形になった（上物の形の最多が100曲中67曲）。
			const cell = i % 2 === 0 ? cellA : cellB;
			const unit = (seg.end - seg.start) / 8;
			let pos = seg.start;
			let cur = u;
			for (const [j, len] of cell.entries()) {
				const at = j === 0 ? start : Math.round(pos);
				pos += len * unit;
				if (j > 0) {
					const idx = cands.indexOf(cur);
					const dir = counterDir === 0 ? (j % 2 === 1 ? 1 : -1) : counterDir;
					const lead = leadAt(at);
					const rubs = (v: number) =>
						lead !== undefined &&
						[1, 11].includes(pc(pcOf(lead.pitchUnits) - pcOf(v)));
					const next = [cands[idx + dir], cands[idx - dir]].find(
						(v) => v !== undefined && !rubs(v),
					);
					if (next === undefined) continue;
					cur = next;
				}
				counter.push({
					startStep: at,
					durationSteps: Math.round(pos) - at,
					pitchUnits: cur,
					velocity: j === 0 ? 74 : 66,
				});
			}
			prev = cur;
		}
	}
	// 前へ食った音に合わせ、手前の音を切る。
	for (let i = 0; i + 1 < counter.length; i++) {
		const gap = counter[i + 1].startStep - counter[i].startStep;
		if (gap > 0 && counter[i].durationSteps > gap)
			counter[i].durationSteps = gap;
	}

	// --- 合いの手: サビでリードが伸ばす・休む隙間に、リードの下の和音の音で短い句を返す ---
	const answer: PartNote[] = [];
	const answerKinds: SectionKind[] =
		rnd() < 0.5
			? ["chorus", "drop_chorus", "bridge"]
			: ["chorus", "drop_chorus"];
	const figure = pick(
		[
			[0, 1, 2, 3],
			[3, 2, 1, 0],
			[0, 1, 2, 1],
			[3, 2, 3, 1],
			[0, 2, 1, 3],
		],
		rnd,
	);
	const rate = rnd() < 0.7 ? 1 : 2;
	/** 伸ばす音に入る割合。 */
	const take = 0.5 + rnd() * 0.4;
	for (const sec of of(answerKinds)) {
		const lead = leadIn(sec).sort((a, b) => a.startStep - b.startStep);
		// 句の形はセクションを通して続ける（短い返しが続くと、つないで1本の線に聞こえる）。
		let k = 0;
		for (const [i, n] of lead.entries()) {
			const next = lead[i + 1]?.startStep ?? sec.end;
			const end = n.startStep + n.durationSteps;
			// 休符の隙間（16分3つ以上）か、16分3つ以上伸ばす音の頭の16分2つより後ろ。
			// 走句リードはほとんど休まない（サビの隙間は16分1つのスタッカートだけ）。休符だけを待つと
			// 1曲で10音ほどしか鳴らなかったので、伸ばす音（サビに40〜55）の間にも入り、リードと交互に鳴らす。
			const from =
				next - end >= 3 * six
					? end
					: n.durationSteps >= 3 * six
						? n.startStep + 2 * six
						: null;
			if (from === null || rnd() >= take) continue;
			const step = (next - from >= 4 * rate * six ? rate : 1) * six;
			const count = Math.min(figure.length, Math.floor((next - from) / step));
			if (count < 1) continue;
			// 隙間の後ろへ寄せる（次のリードへ渡す形）。
			const at = next - count * step;
			for (let j = 0; j < count; j++) {
				const t = at + j * step;
				const c = chordAt(t);
				if (!c) continue;
				const lad = ladder(
					c.tones,
					n.pitchUnits - 14 * S,
					n.pitchUnits - 2 * S,
				).slice(-4);
				if (lad.length === 0) continue;
				// 鳴っているリードの音（伸ばしている音が和音の外のこともある）と半音でこすれる音は、隣の段へ逃がす。
				const lead = leadAt(t)?.pitchUnits ?? n.pitchUnits;
				const rubs = (v: number) => [1, 11].includes(pc(pcOf(lead) - pcOf(v)));
				const want = Math.min(figure[k % figure.length], lad.length - 1);
				k++;
				const u = [lad[want], lad[want - 1], lad[want + 1]].find(
					(v) => v !== undefined && !rubs(v),
				);
				if (u === undefined) continue;
				answer.push({
					startStep: t,
					durationSteps: Math.max(1, Math.round(step * 0.85)),
					pitchUnits: u,
					velocity: j === 0 ? 80 : 70,
				});
			}
		}
	}

	// --- アルペジオ: リードが低い（Aメロ）側やイントロで、和音の音を刻む ---
	const arp: PartNote[] = [];
	const arpKinds = weighted<SectionKind[]>(
		[
			[["verse"], 3],
			[["intro", "verse"], 2],
			[["verse", "bridge"], 2],
			[["intro", "verse", "bridge"], 1],
		],
		rnd,
	).filter((k) => !ctx.arpTaken.includes(k));
	const arpRate = rnd() < 0.55 ? 2 : 1;
	const arpShape = pick(
		[
			[0, 1, 2, 3],
			[0, 1, 2, 3, 2, 1],
			[0, 2, 1, 3],
			[0, 1, 2, 3, 4, 3, 2, 1],
		],
		rnd,
	);
	const arpCenter = home - (8 + Math.floor(rnd() * 5)) * S;
	for (const sec of of(arpKinds)) {
		const step = arpRate * six;
		let chord: (typeof ctx.chords)[number] | undefined;
		let j = 0;
		for (let t = sec.start; t + step <= sec.end; t += step) {
			const c = chordAt(t);
			if (!c) continue;
			if (c !== chord) {
				chord = c;
				j = 0;
			}
			const lad = ladder(c.tones, arpCenter - 5 * S, arpCenter + 12 * S);
			if (lad.length === 0) continue;
			const k = arpShape[j % arpShape.length];
			j++;
			arp.push({
				startStep: Math.round(t),
				durationSteps: Math.max(1, Math.round(step * 0.9)),
				pitchUnits: lad[Math.min(k, lad.length - 1)],
				velocity:
					Math.round(t - sec.start) % Math.round(4 * six) === 0 ? 70 : 60,
			});
		}
	}
	return { counter, answer, arp };
};
