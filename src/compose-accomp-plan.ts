/**
 * 伴奏主体モードの計画器（`docs/accomp-compose.md` §6 段0〜段3）。純関数だけを置く。
 *
 * - 段0 調とテンポ … {@link resolveAccompKey}
 * - 段1 旅程（区間の役割と長さ）・段2 和声・段3 質感 … {@link planAccomp}
 * - 保険の計画（fb 相当）… {@link fbPlan}
 * - 計画の段で確かめられる関門の前提 … {@link planViolations}
 * - 実現の段（段4〜9）が使う読み出し … {@link analyzeRoman}・{@link planBars}・{@link echoBars} など
 *
 * **採点で選ばない。** 表から引き、壊れていれば（規則①②④を計画の段で満たさなければ）その段の
 * 乱数だけを引き直す。引き直しても満たせなければ、候補のまま返して関門に落とさせる。
 *
 * 乱数は段ごとに分ける（§6 共通の約束）。呼び出しの乱数から、まず調の種を1つ、次に候補ごとに
 * 固定の順で種を6つ引いて、それぞれ `seededRandom` で独立した乱数列にする（{@link candidateStreams}）。
 * ある段の表を変えても、他の段の抽選は変わらない。
 *
 * 実行時に import してよいのは `@onjmin/chord-parser`・`./compose-keys`・`./compose` の
 * `seededRandom`・スタイル（`./compose-accomp-style`）だけ（§4.2）。`mml-parser`・`lyrics`・`daw` は読まない。
 *
 * 表は定数を import せず、スタイル（`src/accomp-styles/`）を {@link accompStyleView} で引いて読む
 * （段階 S1。`docs/accomp-style-engine.md` §8）。計画を受け取る関数は計画の `style`・`archetype`
 * から引き（{@link planStyleView}）、計画を作る関数は `style`（省くと既定のスタイル）を受け取る。
 */

import { parseChord } from "@onjmin/chord-parser";
import type { ChordVoicingKind, Weighted } from "./accomp-styles/schema";
import { seededRandom } from "./compose";
import type {
	AccompGate,
	AccompPlan,
	AccompRegion,
	AccompRole,
	AccompTexture,
} from "./compose-accomp";
import {
	type AccompArpCell,
	type AccompStyleView,
	accompStyleView,
	type BorrowPair,
	type PhraseRow,
	planStyleView,
} from "./compose-accomp-style";
import { COMPOSE_KEYS, resolveComposeKey } from "./compose-keys";

/** 区間長を引き直す上限（§6 段1）。エンジンの定数（スタイルによらない）。 */
export const LENGTH_TRIES = 20;
/** 質感だけを引き直す上限（§6 段3）。 */
export const TEXTURE_TRIES = 10;
/** 区間ごとの ±2 のずれを引き直す上限（規則④を計画の段で満たすため）。 */
export const OFFSET_TRIES = 10;

// ============================================================
// 乱数（段ごとに分ける）
// ============================================================

/** 候補ごとに引く乱数列の名前と順（§6 共通の約束）。順を変えると過去の `#compose` が再現しなくなる。 */
export const ACCOMP_STREAMS = [
	"plan",
	"harmony",
	"texture",
	"voicing",
	"dynamics",
	"color",
] as const;
export type AccompStream = (typeof ACCOMP_STREAMS)[number];
export type AccompStreams = Record<AccompStream, () => number>;

/** 呼び出しの乱数から 32bit の種を1つ引く。 */
export const drawSeed = (random: () => number): number =>
	Math.floor(random() * 0x100000000) >>> 0;

/**
 * 候補1つぶんの乱数列を作る。呼び出しの乱数を**ちょうど6個**消費するので、候補 k は
 * 先に `candidateStreams` を k 回呼んで読み飛ばせば直接作れる（`pick`）。
 */
export const candidateStreams = (random: () => number): AccompStreams => {
	const out = {} as AccompStreams;
	for (const name of ACCOMP_STREAMS) out[name] = seededRandom(drawSeed(random));
	return out;
};

const pickWeighted = <T>(
	items: readonly Weighted<T>[],
	rnd: () => number,
): T => {
	if (items.length === 0) throw new Error("pickWeighted: no candidates");
	const total = items.reduce((a, [, w]) => a + w, 0);
	let r = rnd() * total;
	for (const [v, w] of items) {
		r -= w;
		if (r < 0) return v;
	}
	return items[items.length - 1][0];
};

/**
 * 候補から1つ選ぶ関数。乱数で引くもの（{@link randomChooser}）と、決めた値を順に返すもの
 * （fb の計画。値が候補に無ければ例外）を同じ組み立てに通すための口。
 */
type Choose = <T>(key: string, options: readonly Weighted<T>[]) => T;

const randomChooser =
	(rnd: () => number): Choose =>
	(_key, options) =>
		pickWeighted(options, rnd);

const scriptedChooser = (
	script: Readonly<Record<string, readonly (string | number)[]>>,
): Choose => {
	const pos = new Map<string, number>();
	return <T>(key: string, options: readonly Weighted<T>[]): T => {
		const i = pos.get(key) ?? 0;
		pos.set(key, i + 1);
		const v = script[key]?.[i];
		if (v === undefined) throw new Error(`fbPlan: ${key}[${i}] がない`);
		const hit = options.find(([o]) => o === v);
		if (!hit) throw new Error(`fbPlan: ${key}[${i}] = ${v} は候補に無い`);
		return hit[0];
	};
};

// ============================================================
// 段0: 調とテンポ
// ============================================================

export type AccompKey = {
	/** `resolveComposeKey` へ渡した指定（"any"・空は "major"）。 */
	choice: string;
	/** 家の長調の移調量。 */
	rootShift: number;
	keyName: string;
	keyLabel: string;
	/** 短調を選んだときの注記。 */
	homeFromMinor?: string;
	bpm: number;
};

/**
 * 段0。調とテンポを決める（1回の呼び出しで固定）。`keyRandom` は調の種から作った乱数列。
 *
 * 短調は Am 基準、長調は C 基準の rootShift で持つので、同じ値の長調が平行長調になる
 * （ホ短調 −5 → ト長調 −5）。テンポは調の後に同じ乱数列から、型のテンポの表で引く。`bpmOverride` が
 * あっても引く数は変えない。
 */
export const resolveAccompKey = (
	baseKey: string | undefined,
	keyRandom: () => number,
	bpmOverride?: number,
	/** スタイルと型（省くと既定のスタイルの最初の型）。 */
	view: AccompStyleView = accompStyleView(),
): AccompKey => {
	const trimmed = (baseKey ?? "").trim();
	const choice = trimmed === "" || trimmed === "any" ? "major" : trimmed;
	const key = resolveComposeKey(choice, keyRandom);
	const drawnBpm = pickWeighted(view.tempo, keyRandom);
	const bpm = bpmOverride ?? drawnBpm;
	if (!(bpm > 0)) throw new Error(`composeAccomp: bpm が不正 (${bpm})`);
	if (key.mode !== "minor")
		return {
			choice,
			rootShift: key.rootShift,
			keyName: key.keyName,
			keyLabel: key.keyLabel,
			bpm,
		};
	const home = Object.values(COMPOSE_KEYS).find(
		(k) => k.mode === "major" && k.rootShift === key.rootShift,
	);
	if (!home) throw new Error(`平行長調が無い (rootShift ${key.rootShift})`);
	return {
		choice,
		rootShift: home.rootShift,
		keyName: home.name,
		keyLabel: home.label,
		homeFromMinor: `${key.keyLabel} → ${home.label} を家にして、${key.keyLabel} の側に長く留まる`,
		bpm,
	};
};

// ============================================================
// ローマ数字 → ハ長調の和音
// ============================================================

/** 構成音の度数。`3` は sus4 では4度を指す。`9`・`#11` はテンション。 */
export type AccompToneDegree = "R" | "3" | "5" | "6" | "7" | "9" | "#11";

export type AccompTone = {
	degree: AccompToneDegree;
	/** ハ長調での音高クラス（0〜11）。 */
	pc: number;
	/** 五度圏の位置（C=0, G=1, F=-1, A♭=-4）。31平均律の綴りに使う。 */
	fifth: number;
	tension: boolean;
};

export type AccompChord = {
	/** 表に書かれたローマ数字（例 "bVIM7(#11)"）。 */
	roman: string;
	/** ハ長調の和音名（例 "AbM7(#11)"、"CM7/E"）。 */
	name: string;
	/** 色の線の表（`COLOR_LINE.tones`）を引く鍵。臨時記号と数字だけ（例 "bIII"・"iv"）。 */
	colorKey: string;
	root: { pc: number; fifth: number };
	/** 低音。分数和音なら `/数字` の音、そうでなければ根音。 */
	bass: { pc: number; fifth: number };
	/** 構成音（テンションを含む）。 */
	tones: readonly AccompTone[];
	third: "major" | "minor" | "sus4";
	/** 和音の置き方で使う度数の組（スタイルの和音の層の `tones` のキー。いままでの `COMP_TONES`）。 */
	voicing: ChordVoicingKind;
	/**
	 * 借用和音か。「三和音と7度の音（テンションは除く）に、ハ長調の音階外の音がある」
	 * （§6 段2-9）。`IVM7(#11)` の #11（B）は音階内なので数えない。
	 */
	borrowed: boolean;
};

/** ハ長調の音階度数 1〜7 の音（音高クラス, 五度圏の位置, 音名）。 */
const SCALE: readonly { pc: number; fifth: number; letter: string }[] = [
	{ pc: 0, fifth: 0, letter: "C" },
	{ pc: 2, fifth: 2, letter: "D" },
	{ pc: 4, fifth: 4, letter: "E" },
	{ pc: 5, fifth: -1, letter: "F" },
	{ pc: 7, fifth: 1, letter: "G" },
	{ pc: 9, fifth: 3, letter: "A" },
	{ pc: 11, fifth: 5, letter: "B" },
];
const SCALE_PCS = new Set(SCALE.map((s) => s.pc));
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const ROMAN_RE =
	/^([b#]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)([^/\s]*)(?:\/([1-7]))?$/;

const parseRoman = (
	roman: string,
): {
	accidental: string;
	numeral: string;
	degree: number;
	minor: boolean;
	suffix: string;
	slash?: number;
} => {
	const m = roman.match(ROMAN_RE);
	if (!m) throw new Error(`ローマ数字が読めない: "${roman}"`);
	const degree = NUMERALS.indexOf(m[2].toUpperCase()) + 1;
	return {
		accidental: m[1],
		numeral: m[2],
		degree,
		minor: m[2] !== m[2].toUpperCase(),
		suffix: m[3],
		...(m[4] ? { slash: Number(m[4]) } : {}),
	};
};

/**
 * ローマ数字をハ長調の和音名にする（§6 段2-9 の `romanToC`）。借用和音はフラットで綴る
 * （bVI → A♭。31平均律で G# に化けないように）。
 *
 * 例: `Iadd9` → `Cadd9`、`vi(add9)` → `Am(add9)`、`bVIM7(#11)` → `AbM7(#11)`、
 * `iv6` → `Fm6`、`IM7/3` → `CM7/E`、`vi7/5` → `Am7/G`。
 */
export const romanToC = (roman: string): string => {
	const r = parseRoman(roman);
	const s = SCALE[r.degree - 1];
	const root = `${s.letter}${r.accidental}`;
	const body = `${root}${r.minor ? "m" : ""}${r.suffix}`;
	return r.slash ? `${body}/${SCALE[r.slash - 1].letter}` : body;
};

const degreeOf = (interval: number, hasThird: boolean): AccompToneDegree => {
	switch (interval) {
		case 0:
			return "R";
		case 3:
		case 4:
			return "3";
		case 5:
			if (hasThird) break;
			return "3";
		case 6:
		case 7:
		case 8:
			return "5";
		case 9:
			return "6";
		case 10:
		case 11:
			return "7";
		case 14:
			return "9";
		case 18:
			return "#11";
	}
	throw new Error(`扱えない音程 ${interval}`);
};

const chordCache = new Map<string, AccompChord>();

/**
 * ローマ数字を解析する（§6 段2-9）。`romanToC` の名前を `parseChord` に通して構成音を得る。
 * 分数和音は、上の和音を分数なしで解析し、低音だけ `/数字` の音にする。結果はキャッシュする
 * （返り値を書き換えないこと）。
 */
export const analyzeRoman = (roman: string): AccompChord => {
	const cached = chordCache.get(roman);
	if (cached) return cached;
	const r = parseRoman(roman);
	const name = romanToC(roman);
	const upper = name.split("/")[0];
	const parsed = parseChord(upper);
	const fifths = parsed.noteFifths;
	if (fifths.length !== parsed.notes.length)
		throw new Error(`noteFifths の長さが合わない: ${upper}`);
	const hasThird = parsed.intervals.some((iv) => iv === 3 || iv === 4);
	const tones: AccompTone[] = parsed.intervals.map((iv, i) => ({
		degree: degreeOf(iv, hasThird),
		pc: ((parsed.notes[i] % 12) + 12) % 12,
		fifth: fifths[i],
		tension: iv >= 12,
	}));
	const third: AccompChord["third"] = parsed.intervals.includes(4)
		? "major"
		: parsed.intervals.includes(3)
			? "minor"
			: "sus4";
	const has = (d: AccompToneDegree): boolean =>
		tones.some((t) => t.degree === d);
	const voicing: AccompChord["voicing"] = has("6")
		? "m6"
		: has("#11") && has("7")
			? "maj7s11"
			: has("9") && has("7")
				? "maj7add9"
				: has("7")
					? "seventh"
					: has("9")
						? "add9"
						: "triad";
	const root = { pc: parsed.root, fifth: parsed.rootFifth };
	const slash = r.slash ? SCALE[r.slash - 1] : undefined;
	const chord: AccompChord = {
		roman,
		name,
		colorKey: `${r.accidental}${r.numeral}`,
		root,
		bass: slash ? { pc: slash.pc, fifth: slash.fifth } : root,
		tones,
		third,
		voicing,
		borrowed: tones.some((t) => !t.tension && !SCALE_PCS.has(t.pc)),
	};
	chordCache.set(roman, chord);
	return chord;
};

/** "a|b c|d" → ["a", "b c", "d"] */
export const splitBars = (text: string): string[] =>
	text.split("|").map((b) => b.trim());

/** 1小節の和音（1つか2つ）。 */
export const barChords = (bar: string): AccompChord[] =>
	bar.trim().split(/\s+/).map(analyzeRoman);

const lastChord = (bars: readonly string[]): AccompChord => {
	const cs = barChords(bars[bars.length - 1]);
	return cs[cs.length - 1];
};
const firstChord = (bars: readonly string[]): AccompChord =>
	barChords(bars[0])[0];

/** 句のつなぎ目で同じ根音が続かない（同じ和音が3小節以上続くのを避ける）。 */
const joinOk = (prev: readonly string[], next: readonly string[]): boolean =>
	lastChord(prev).root.pc !== firstChord(next).root.pc;

/** V 系（根音が G で本調）の和音で終わる句か（lift の最後の句）。 */
const endsOnDominant = (bars: readonly string[]): boolean => {
	const c = lastChord(bars);
	return c.root.pc === 7 && !c.borrowed;
};

// ============================================================
// 段1: 旅程（区間の長さ）
// ============================================================

export type AccompLengths = Record<AccompRole, number>;

const totalBars = (lens: AccompLengths, view: AccompStyleView): number =>
	view.itinerary.reduce((a, r) => a + lens[r], 0);

/** 曲の秒数（4/4）。 */
export const barsToSeconds = (bars: number, bpm: number): number =>
	(bars * 240) / bpm;

/** minorDwell ≥ home、かつ minorDwell > home 以外のどの区間。 */
const itineraryLengthsOk = (
	lens: AccompLengths,
	view: AccompStyleView,
): boolean =>
	lens.minorDwell >= lens.home &&
	view.itinerary.every(
		(r) => r === "minorDwell" || r === "home" || lens.minorDwell > lens[r],
	);

const secondsOk = (seconds: number, view: AccompStyleView): boolean =>
	seconds >= view.seconds.min && seconds <= view.seconds.max;

const validateLengthOverrides = (
	lengths: Partial<Record<AccompRole, number>> | undefined,
	view: AccompStyleView,
): void => {
	if (!lengths) return;
	for (const [role, n] of Object.entries(lengths) as [AccompRole, number][]) {
		if (!view.itinerary.includes(role))
			throw new Error(`overrides.lengths: 知らない役割 ${role}`);
		if (!view.supportedLengths[role].includes(n))
			throw new Error(
				`overrides.lengths.${role} = ${n} は組めない（${view.supportedLengths[role].join("/")}）`,
			);
	}
};

/**
 * 段1。区間長を引く（計画の乱数）。役割ごとに必ず1回ずつ引き、`overrides` があればその値で
 * 置き換える（引く数を変えないので、上書きしても他の抽選はずれない）。秒数と旅程の条件を
 * 満たすまで {@link LENGTH_TRIES} 回まで引き直し、外れ続けたら参照計画の長さ（に上書きを重ねたもの）。
 */
export const drawLengths = (
	rnd: () => number,
	bpm: number,
	overrides?: Partial<Record<AccompRole, number>>,
	/** 監査用（{@link AccompPlanDiag}）。引き直しを使い切って参照計画の長さへ戻したときに呼ぶ。 */
	onExhausted?: () => void,
	/** スタイルと型（省くと既定のスタイルの最初の型）。 */
	view: AccompStyleView = accompStyleView(),
): AccompLengths => {
	validateLengthOverrides(overrides, view);
	for (let t = 0; t < LENGTH_TRIES; t++) {
		const lens = {} as AccompLengths;
		for (const role of view.itinerary) {
			const drawn = pickWeighted(view.regionLengths[role], rnd);
			lens[role] = overrides?.[role] ?? drawn;
		}
		if (
			itineraryLengthsOk(lens, view) &&
			secondsOk(barsToSeconds(totalBars(lens, view), bpm), view)
		)
			return lens;
	}
	onExhausted?.();
	return { ...view.referenceLengths, ...overrides };
};

// ============================================================
// 段2: 和声
// ============================================================

/** 和声の句の選び方（表の行 id）。 */
export type AccompHarmonyChoice = {
	pair: string;
	homeOpen: string;
	homeMid: string[];
	minorOpen: string;
	minorClimb: string;
	minorMid: string[];
	lift: string[];
	returnEnd: string;
};

const rowById = (rows: readonly PhraseRow[], id: string): PhraseRow => {
	const row = rows.find((r) => r.id === id);
	if (!row) throw new Error(`句が無い: ${id}`);
	return row;
};
const pairById = (id: string, view: AccompStyleView): BorrowPair => {
	const p = view.borrowPairs.find((x) => x.id === id);
	if (!p) throw new Error(`借用の組が無い: ${id}`);
	return p;
};
/**
 * 句の候補。`must` は外せない条件（同じ句を続けない・lift の最後は V 系）、`prefer` は
 * 外してよい条件（つなぎ目の根音）。`prefer` で全部落ちたら `must` だけで選ぶ
 * （表に行を足したときに行き止まりで止まらないように）。
 */
const rowOptions = (
	rows: readonly PhraseRow[],
	must: (row: PhraseRow) => boolean,
	prefer: (row: PhraseRow) => boolean = () => true,
): Weighted<string>[] => {
	const allowed = rows.filter(must);
	if (allowed.length === 0) throw new Error("和声の句の候補が無い");
	const hit = allowed.filter(prefer);
	return (hit.length > 0 ? hit : allowed).map((r) => [r.id, r.weight] as const);
};

/**
 * 段2。和声の句を選ぶ（和声の乱数）。**借用の組を先に引く**ので、区間長を上書きしても
 * 組は変わらない。句のつなぎ目で同じ根音を続けない（{@link joinOk}）。
 */
const harmonyPicks = (
	lens: AccompLengths,
	choose: Choose,
	view: AccompStyleView,
): AccompHarmonyChoice => {
	const P = view.pools;
	const pair = pairById(
		choose(
			"pair",
			view.borrowPairs.map((p) => [p.id, p.weight] as const),
		),
		view,
	);
	const fore = splitBars(pair.fore);
	const bars = (rows: readonly PhraseRow[], id: string): string[] =>
		splitBars(rowById(rows, id).bars);

	const any = (): boolean => true;
	const homeOpen = choose("homeOpen", rowOptions(P.homeOpen, any));
	const openBars = bars(P.homeOpen, homeOpen);
	const mid0 = choose(
		"homeMid",
		rowOptions(P.homeMid, any, (r) => joinOk(openBars, splitBars(r.bars))),
	);
	const mid0Bars = bars(P.homeMid, mid0);
	const mid1 = choose(
		"homeMid",
		rowOptions(
			P.homeMid,
			(r) => r.id !== mid0,
			(r) =>
				joinOk(mid0Bars, splitBars(r.bars)) && joinOk(splitBars(r.bars), fore),
		),
	);

	const minorOpen = choose("minorOpen", rowOptions(P.minorOpen, any));
	const minorClimb = choose("minorClimb", rowOptions(P.minorClimb, any));
	const climbBars = bars(P.minorClimb, minorClimb);
	const midCount = (lens.minorDwell - 8) / 4;
	const minorMid: string[] = [];
	let prev = bars(P.minorOpen, minorOpen);
	let prevId = "";
	for (let i = 0; i < midCount; i++) {
		const last = i === midCount - 1;
		const id = choose(
			"minorMid",
			rowOptions(
				P.minorMid,
				(r) => r.id !== prevId,
				(r) =>
					joinOk(prev, splitBars(r.bars)) &&
					(!last || joinOk(splitBars(r.bars), climbBars)),
			),
		);
		minorMid.push(id);
		prev = bars(P.minorMid, id);
		prevId = id;
	}

	// 最後の句は V 系の和音で終わる（外せない）。それ以外の句は V 系で終わらないものを選ぶ
	const liftCount = lens.lift / 4;
	const lift: string[] = [];
	let liftPrev: string[] | undefined;
	let liftPrevId = "";
	for (let i = 0; i < liftCount; i++) {
		const last = i === liftCount - 1;
		const id = choose(
			"lift",
			rowOptions(
				P.lift,
				(r) =>
					r.id !== liftPrevId && (!last || endsOnDominant(splitBars(r.bars))),
				(r) =>
					(last || !endsOnDominant(splitBars(r.bars))) &&
					(!liftPrev || joinOk(liftPrev, splitBars(r.bars))),
			),
		);
		lift.push(id);
		liftPrev = bars(P.lift, id);
		liftPrevId = id;
	}

	const returnEnd = choose("returnEnd", rowOptions(P.returnEnd, any));
	return {
		pair: pair.id,
		homeOpen,
		homeMid: [mid0, mid1],
		minorOpen,
		minorClimb,
		minorMid,
		lift,
		returnEnd,
	};
};

/** 選んだ句から、区間ごとの小節の和音を組み立てる。 */
const regionChords = (
	lens: AccompLengths,
	h: AccompHarmonyChoice,
	view: AccompStyleView,
): Record<AccompRole, string[]> => {
	const P = view.pools;
	const pair = pairById(h.pair, view);
	const bars = (rows: readonly PhraseRow[], id: string): string[] =>
		splitBars(rowById(rows, id).bars);
	const home = [
		...bars(P.homeOpen, h.homeOpen),
		...h.homeMid.flatMap((id) => bars(P.homeMid, id)),
		...splitBars(pair.fore),
	];
	if (home.length !== lens.home)
		throw new Error(`home の和声が ${home.length} 小節（${lens.home} のはず）`);
	const pick = (n: number, v8: string, v12: string): string[] =>
		splitBars(n === 12 ? v12 : v8);
	return {
		home,
		minorDwell: [
			...bars(P.minorOpen, h.minorOpen),
			...h.minorMid.flatMap((id) => bars(P.minorMid, id)),
			...bars(P.minorClimb, h.minorClimb),
		],
		borrowA: pick(lens.borrowA, pair.a8, pair.a12),
		// home の冒頭の和声で、組の glimpseEnd で止める（borrowB の頭へ低音が半音で上がる）
		glimpse: [...home.slice(0, lens.glimpse - 1), pair.glimpseEnd],
		borrowB: pick(lens.borrowB, pair.b8, pair.b12),
		lift: h.lift.flatMap((id) => bars(P.lift, id)),
		// home の頭（4 か 8 小節）＋ returnEnd の句。予告の句は入れない（規則⑤）
		return: [
			...home.slice(0, lens.return - 4),
			...bars(P.returnEnd, h.returnEnd),
		],
	};
};

// ============================================================
// 段3: 質感
// ============================================================

/** 区間ごとの質感の抽選結果（4小節ブロックごと）。 */
export type AccompTexturePick = {
	arpCells: string[];
	bass: string[];
	compRegister: AccompTexture["compRegister"];
};

/**
 * 段3。質感を引く（質感の乱数）。役割の並び順に、セル → 低音 → 和音の段の順で引く。
 * glimpse と return は home から導く（引かない）。
 */
const texturePicks = (
	lens: AccompLengths,
	choose: Choose,
	view: AccompStyleView,
): Record<AccompRole, AccompTexturePick> => {
	const out = {} as Record<AccompRole, AccompTexturePick>;
	for (const role of view.itinerary) {
		const spec = view.roleTexture[role];
		const n = lens[role] / 4;
		const cells: string[] = [];
		const rule = spec.cells;
		for (let b = 0; b < n; b++) {
			const prev = cells[b - 1];
			if (rule.kind === "pool") {
				if (rule.last && b === n - 1) cells.push(rule.last);
				else
					cells.push(
						choose(
							`${role}.cells`,
							rule.pool.filter(([id]) => id !== prev),
						),
					);
			} else if (rule.kind === "alternate") {
				const first =
					b === 0
						? choose(`${role}.first`, [
								[rule.cells[0], rule.first[0]],
								[rule.cells[1], rule.first[1]],
							])
						: cells[0];
				const other = first === rule.cells[0] ? rule.cells[1] : rule.cells[0];
				cells.push(b % 2 === 0 ? first : other);
			} else if (rule.kind === "homeLift") {
				const home = out.home.arpCells;
				const src = home[b % home.length];
				cells.push(view.arpCells[src]?.liftVariant ?? src);
			} else {
				// homeEcho: 和声が home と同じ前半は home の同じブロック、RETURN_END のブロックは
				// home 第3ブロック（fb の A' 73〜75）。予告用の最後のブロックは使わない
				const home = out.home.arpCells;
				const echo = (lens.return - 4) / 4;
				if (b < echo) cells.push(home[b]);
				else {
					const body = home.slice(0, -1);
					const late =
						[body[2], body[1], body[0]].find(
							(id) => id !== undefined && id !== prev,
						) ?? home[0];
					cells.push(late);
				}
			}
		}
		const bassRule = spec.bass;
		const bass: string[] = [];
		for (let b = 0; b < n; b++) {
			if (bassRule.kind === "each")
				bass.push(bassRule.last && b === n - 1 ? bassRule.last : bassRule.id);
			else if (bassRule.kind === "lead")
				bass.push(b === 0 ? bassRule.first : bassRule.rest);
			else {
				// split: 前半 first → 後半 second。奇数ブロックの真ん中だけ引く
				const half = (n - 1) / 2;
				if (n === 1 || b < half) bass.push(bassRule.first);
				else if (b > half) bass.push(bassRule.second);
				else bass.push(choose(`${role}.bassMiddle`, bassRule.middle));
			}
		}
		const compRegister = choose(`${role}.register`, spec.register);
		out[role] = { arpCells: cells, bass, compRegister };
	}
	return out;
};

// ============================================================
// 段9 の一部: 区間の起伏（分散の基準 v）
// ============================================================

/** キーフレームを n 小節へ線形に伸ばす（長さが同じならそのまま）。 */
export const stretchLevels = (keys: readonly number[], n: number): number[] => {
	if (n <= 0) return [];
	if (keys.length === 1 || n === 1) return Array(n).fill(keys[0]);
	if (keys.length === n) return [...keys];
	return Array.from({ length: n }, (_, i) => {
		const t = (i * (keys.length - 1)) / (n - 1);
		const lo = Math.floor(t);
		const hi = Math.min(lo + 1, keys.length - 1);
		return Math.round(keys[lo] + (keys[hi] - keys[lo]) * (t - lo));
	});
};

const clampVelocity = (v: number): number => Math.max(1, Math.min(127, v));

// ============================================================
// 組み立て
// ============================================================

/** 計画の材料。{@link assemblePlan} がこれから `AccompPlan` を作る（fb の計画も同じ道を通る）。 */
export type AccompPlanSpec = {
	bpm: number;
	rootShift: number;
	lengths: AccompLengths;
	harmony: AccompHarmonyChoice;
	texture: Record<AccompRole, AccompTexturePick>;
	/** 区間ごとの ±2 のずれ。 */
	offsets: Record<AccompRole, number>;
};

const zeroOffsets = (view: AccompStyleView): Record<AccompRole, number> => {
	const out = {} as Record<AccompRole, number>;
	for (const role of view.itinerary) out[role] = 0;
	return out;
};

/**
 * 材料から計画を組み立てる。計画には、スタイル・型・ミックスの id（`PlanPins`、§3.1）を記録する
 * （段階 S1 は型とミックスが1つずつなので、引かずにそれを書く）。小節ごとの和音の打ち方は実現の段が
 * 決めて記録する（`realizeAccomp` の `compHits`）。
 */
export const assemblePlan = (
	spec: AccompPlanSpec,
	/** スタイルと型（省くと既定のスタイルの最初の型）。 */
	view: AccompStyleView = accompStyleView(),
): AccompPlan => {
	const pair = pairById(spec.harmony.pair, view);
	const chords = regionChords(spec.lengths, spec.harmony, view);
	let startBar = 0;
	const regions: AccompRegion[] = view.itinerary.map((role) => {
		const bars = spec.lengths[role];
		const t = view.roleTexture[role];
		const pick = spec.texture[role];
		const offset = spec.offsets[role];
		const suffix =
			role === "borrowA"
				? `（${pair.labelA}）`
				: role === "borrowB"
					? `（${pair.labelB}）`
					: "";
		const region: AccompRegion = {
			role,
			label: `${view.roleLabels[role]}${suffix}`,
			startBar,
			bars,
			chords: chords[role],
			texture: {
				arpCells: [...pick.arpCells],
				arpWindow: { ...t.window },
				bass: [...pick.bass],
				comp: t.comp,
				compRegister: pick.compRegister,
				accent: t.accent,
			},
			arpLevel: stretchLevels(view.levels[role].arp, bars).map((v) =>
				clampVelocity(v + offset),
			),
			levelOffset: offset,
		};
		startBar += bars;
		return region;
	});
	return {
		bpm: spec.bpm,
		rootShift: spec.rootShift,
		borrowPair: pair.id,
		regions,
		style: view.pack.id,
		archetype: view.archetype.id,
		mix: view.mixId,
	};
};

// ============================================================
// 段1〜3 をまとめる
// ============================================================

export type PlanAccompInput = {
	bpm: number;
	rootShift: number;
	/** 候補の乱数列（{@link candidateStreams}）。使うのは plan・harmony・texture・dynamics。 */
	streams: Pick<AccompStreams, "plan" | "harmony" | "texture" | "dynamics">;
	/** 区間長の上書き（`AccompOptions.overrides.lengths`）。 */
	lengths?: Partial<Record<AccompRole, number>>;
	/**
	 * 監査用。与えると、計画の中の引き直しを使い切ったかを書き込む（`docs/accomp-style-engine.md`
	 * §5「退避の率を数える」）。**計画は変えない**（乱数の引き方も同じ）。
	 */
	diag?: AccompPlanDiag;
	/** スタイル id（省くと既定のスタイル）。 */
	style?: string;
	/** 型 id（省くとスタイルの最初の型。段階 S1 は型が1つ）。 */
	archetype?: string;
};

/**
 * 計画の中の引き直しを使い切ったかどうか（監査用。{@link planAccomp} の `diag` に渡した物へ書く）。
 * 使い切ると、検証していない下書き（または参照計画の長さ・ずれ無し）を返す。
 */
export type AccompPlanDiag = {
	/** 区間長（`LENGTH_TRIES`）を使い切り、参照計画の長さ（に上書きを重ねたもの）へ戻した。 */
	lengthsExhausted: boolean;
	/**
	 * 質感（`TEXTURE_TRIES`）を使い切った。最後に引いた質感は規則①②を確かめていない
	 * （満たしていなければ関門の rule1・rule2 で落ちる）。
	 */
	textureExhausted: boolean;
	/** ±2 のずれ（`OFFSET_TRIES`）を使い切り、ずれ無しの下書きを返した。 */
	offsetsExhausted: boolean;
};

/**
 * 段1〜3 と、区間の起伏（段9 の ±2 のずれ）から計画を作る。
 *
 * - 質感は、規則①（セルの音数から見た毎秒の分散音数）と規則②（質感の軸が2つ以上違う）を
 *   満たすまで {@link TEXTURE_TRIES} 回まで引き直す。
 * - ±2 のずれは、規則④（山は borrowB だけ・lift が最弱・return < home・glimpse < 両隣）と
 *   規則②の return と home の強弱の軸を、計画の基準 v で満たすまで {@link OFFSET_TRIES} 回まで
 *   引き直し、だめならずれ無し（表の値そのものは④を満たす）。
 *
 * 満たせなかった規則は {@link planViolations} に残るので、呼び出し側は関門で落とせる。
 */
export const planAccomp = (input: PlanAccompInput): AccompPlan => {
	const { bpm, rootShift, streams, diag } = input;
	const view = accompStyleView(input.style, input.archetype);
	if (diag) {
		diag.lengthsExhausted = false;
		diag.textureExhausted = false;
		diag.offsetsExhausted = false;
	}
	const lengths = drawLengths(
		streams.plan,
		bpm,
		input.lengths,
		() => {
			if (diag) diag.lengthsExhausted = true;
		},
		view,
	);
	const harmony = harmonyPicks(lengths, randomChooser(streams.harmony), view);
	const textureChoose = randomChooser(streams.texture);
	const noOffsets = zeroOffsets(view);
	let texture = texturePicks(lengths, textureChoose, view);
	let draft = assemblePlan(
		{
			bpm,
			rootShift,
			lengths,
			harmony,
			texture,
			offsets: noOffsets,
		},
		view,
	);
	let textureChecked = false;
	for (let t = 1; t < TEXTURE_TRIES; t++) {
		const v = planViolations(draft);
		if (!v.some((x) => x.gate === "rule1" || x.gate === "rule2")) {
			textureChecked = true;
			break;
		}
		texture = texturePicks(lengths, textureChoose, view);
		draft = assemblePlan(
			{
				bpm,
				rootShift,
				lengths,
				harmony,
				texture,
				offsets: noOffsets,
			},
			view,
		);
	}
	if (diag && !textureChecked) diag.textureExhausted = true;
	for (let t = 0; t < OFFSET_TRIES; t++) {
		const offsets = {} as Record<AccompRole, number>;
		for (const role of view.itinerary)
			offsets[role] =
				Math.floor(streams.dynamics() * (2 * view.offsetMax + 1)) -
				view.offsetMax;
		const plan = assemblePlan(
			{
				bpm,
				rootShift,
				lengths,
				harmony,
				texture,
				offsets,
			},
			view,
		);
		// return と home の「強弱」の軸（規則②）もずれで動くので、一緒に確かめる
		if (
			rule4Violations(plan).length === 0 &&
			rule2Violations(plan).length === 0
		)
			return plan;
	}
	if (diag) diag.offsetsExhausted = true;
	return draft;
};

/**
 * 型の参照計画（§5。§7.1 の保険の計画 `FALLBACK_PLAN`・§12.3 の陽性対照）。型の参照計画の区間長・句・
 * セル・低音型（`Archetype.reference`。fb ならいままでの `FB_LENGTHS`・`FB_HARMONY_SCRIPT`・
 * `FB_TEXTURE_SCRIPT`）を、**乱数の代わりに決めた値で**同じ組み立てに通す。表の行が参照からずれたら
 * 例外になる。既定のスタイル fb はホ長調（rootShift 4）・112BPM。
 *
 * 名前は fb のままにしてある（外から使われているため。段階 S1 は書き出す名前を変えない）。
 */
export const fbPlan = (
	rootShift = 4,
	bpm = 112,
	/** スタイル id（省くと既定のスタイル）。 */
	style?: string,
): AccompPlan => {
	const view = accompStyleView(style);
	const lengths = { ...view.referenceLengths };
	return assemblePlan(
		{
			bpm,
			rootShift,
			lengths,
			harmony: harmonyPicks(
				lengths,
				scriptedChooser(view.referencePicks.harmony),
				view,
			),
			texture: texturePicks(
				lengths,
				scriptedChooser(view.referencePicks.texture),
				view,
			),
			offsets: zeroOffsets(view),
		},
		view,
	);
};

// ============================================================
// 計画の読み出し（実現の段と表示が使う）
// ============================================================

export type AccompPlanBar = {
	/** 曲の中の小節（0 始まり）。 */
	bar: number;
	regionIndex: number;
	role: AccompRole;
	/** 区間の中の小節（0 始まり）。 */
	barInRegion: number;
	/** その小節の和音（1つか2つ。2つなら半小節ずつ）。 */
	chords: AccompChord[];
};

/** 計画を小節の並びに展開する。 */
export const planBars = (plan: AccompPlan): AccompPlanBar[] =>
	plan.regions.flatMap((r, regionIndex) =>
		r.chords.map((c, i) => ({
			bar: r.startBar + i,
			regionIndex,
			role: r.role,
			barInRegion: i,
			chords: barChords(c),
		})),
	);

export const planTotalBars = (plan: AccompPlan): number =>
	plan.regions.reduce((a, r) => a + r.bars, 0);

export const planSeconds = (plan: AccompPlan): number =>
	barsToSeconds(planTotalBars(plan), plan.bpm);

const regionOf = (
	plan: AccompPlan,
	role: AccompRole,
): AccompRegion | undefined => plan.regions.find((r) => r.role === role);

/**
 * home の予告の小節（借用和音を含む小節。和音の打ち方 fore、§6 段5）。曲の中の小節番号。
 */
export const foreshadowBars = (plan: AccompPlan): number[] => {
	const home = regionOf(plan, "home");
	if (!home) return [];
	return home.chords.flatMap((c, i) =>
		barChords(c).some((ch) => ch.borrowed) ? [home.startBar + i] : [],
	);
};

/**
 * return の頭で、home の同じ小節を**音ごと複写**できる小節数（§6 段7 の継ぎ目）。和音と
 * そのブロックのセルがどちらも home と同じ小節が、頭から続く数。fb は 10（A' 65〜74 が
 * A 1〜10 と同じ音。`RETURN_END` の頭 `vi7|iii7` が home 9〜10 と同じ和声なので）。
 * return の最終小節は数えない（曲の最終小節は別に home の最終小節と同じ音にする）。
 */
export const echoBars = (plan: AccompPlan): number => {
	const home = regionOf(plan, "home");
	const ret = regionOf(plan, "return");
	if (!home || !ret) return 0;
	let n = 0;
	while (
		n < ret.chords.length - 1 &&
		n < home.chords.length &&
		ret.chords[n] === home.chords[n] &&
		ret.texture.arpCells[Math.floor(n / 4)] ===
			home.texture.arpCells[Math.floor(n / 4)]
	)
		n++;
	return n;
};

/** 和音欄に入れる進行（ComposeResult と同じ書式。ハ長調で書き、調は rootShift で表す）。 */
export const planChordProgression = (plan: AccompPlan): string =>
	plan.regions
		.flatMap((r) =>
			r.chords.map((bar) =>
				barChords(bar)
					.map((c) => c.name)
					.join(" "),
			),
		)
		.join("|");

/** 区間長・借用組・セル id・低音型・bpm を連結したもの（直近の曲と同じ計画を避ける）。 */
export const planSignature = (plan: AccompPlan): string =>
	[
		plan.bpm,
		plan.regions.map((r) => r.bars).join(","),
		plan.borrowPair,
		plan.regions.map((r) => r.texture.arpCells.join("+")).join("/"),
		plan.regions.map((r) => r.texture.bass.join("+")).join("/"),
	].join("|");

// ============================================================
// 計画の段で確かめられる関門の前提（§7.2）
// ============================================================

export type AccompPlanViolation = { gate: AccompGate; detail: string };

const mean = (xs: readonly number[]): number =>
	xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** 区間の分散の毎秒音数（セルの音数から。最終小節の差し替えなどは入らない）。 */
export const regionArpRate = (
	region: AccompRegion,
	bpm: number,
	cells: Readonly<Record<string, AccompArpCell>> = accompStyleView().arpCells,
): number =>
	(mean(region.texture.arpCells.map((id) => cells[id]?.notes ?? 0)) * bpm) /
	240;

type Axis = "arp" | "window" | "bass" | "comp" | "register" | "level";

/**
 * 質感の軸のうち違うもの（規則②）。`aBlocks` と `bBlocks` を並べて比べ、どこか1つでも違えば
 * その軸は違うとする。セルと低音は id で比べる（glimpse の liftVariant は別のセルとして数える）。
 */
const differingAxes = (
	a: AccompRegion,
	aBlocks: readonly number[],
	b: AccompRegion,
	bBlocks: readonly number[],
): Axis[] => {
	const axes: Axis[] = [];
	const seqDiff = (key: "arpCells" | "bass"): boolean =>
		aBlocks.some((ab, i) => a.texture[key][ab] !== b.texture[key][bBlocks[i]]);
	if (seqDiff("arpCells")) axes.push("arp");
	if (
		JSON.stringify(a.texture.arpWindow) !== JSON.stringify(b.texture.arpWindow)
	)
		axes.push("window");
	if (seqDiff("bass")) axes.push("bass");
	if (a.texture.comp !== b.texture.comp) axes.push("comp");
	if (a.texture.compRegister !== b.texture.compRegister) axes.push("register");
	return axes;
};

/**
 * 規則②。比べる組は2種類。
 * - 隣り合う区間: 前の区間の最後のブロックと、後の区間の最初のブロック（境で聞こえる変化）
 * - 同じ和声が再び出る組: glimpse と home（第1ブロック）、return と home（和声が同じ頭の範囲）。
 *   return と home は「同じ和声で質感を変える」組なので、**強弱**も軸に数える（§6 段3。
 *   return の基準 v の平均が home より、スタイルの規則②（`contrast`）の `levelMargin` 以上低ければ違う）
 */
export const rule2Violations = (plan: AccompPlan): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const rs = plan.regions;
	const need = (label: string, axes: Axis[]): void => {
		if (axes.length < 2)
			out.push({
				gate: "rule2",
				detail: `${label}: 違う軸が ${axes.length} つ（${axes.join("・") || "なし"}）`,
			});
	};
	for (let i = 0; i + 1 < rs.length; i++) {
		const a = rs[i];
		const b = rs[i + 1];
		need(
			`${a.role}→${b.role}`,
			differingAxes(a, [a.texture.arpCells.length - 1], b, [0]),
		);
	}
	const home = regionOf(plan, "home");
	const glimpse = regionOf(plan, "glimpse");
	const ret = regionOf(plan, "return");
	if (home && glimpse)
		need("glimpse と home", differingAxes(glimpse, [0], home, [0]));
	if (home && ret) {
		const bars = echoBars(plan);
		const blocks = Array.from({ length: Math.ceil(bars / 4) }, (_, i) => i);
		if (blocks.length > 0) {
			const axes = differingAxes(ret, blocks, home, blocks);
			if (
				mean(ret.arpLevel.slice(0, bars)) <=
				mean(home.arpLevel.slice(0, bars)) - planStyleView(plan).echoLevelMargin
			)
				axes.push("level");
			need("return と home", axes);
		}
	}
	return out;
};

/**
 * 規則③。借用の長和音の直後に、根音が完全4度上（+5半音）の借用和音が来ない。区間の境も
 * またぐ。**home の中の組は数えない**（fb の予告の句 `bVIIadd9|bIIIM7` が当たるため。
 * スタイル fb の借用の組（`src/accomp-styles/fb.ts`）の説明を参照）。
 */
export const rule3Violations = (plan: AccompPlan): AccompPlanViolation[] => {
	const seq = planBars(plan).flatMap((b) =>
		b.chords.map((c) => ({ c, bar: b.bar, role: b.role })),
	);
	const out: AccompPlanViolation[] = [];
	for (let i = 0; i + 1 < seq.length; i++) {
		const a = seq[i];
		const b = seq[i + 1];
		if (a.role === "home" && b.role === "home") continue;
		if (
			a.c.borrowed &&
			a.c.third === "major" &&
			b.c.borrowed &&
			(b.c.root.pc - a.c.root.pc + 12) % 12 === 5
		)
			out.push({
				gate: "rule3",
				detail: `${a.bar + 1}→${b.bar + 1}小節 ${a.c.roman}→${b.c.roman}（借りた先の V→I）`,
			});
	}
	return out;
};

/** 規則④（計画の基準 v で。実現の後は分散の音の v 平均で同じことを確かめる）。 */
export const rule4Violations = (plan: AccompPlan): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const lv = new Map(plan.regions.map((r) => [r.role, mean(r.arpLevel)]));
	const get = (role: AccompRole): number => lv.get(role) ?? Number.NaN;
	const others = (role: AccompRole): number[] =>
		plan.regions.filter((r) => r.role !== role).map((r) => get(r.role));
	const peak = get("borrowB");
	const second = Math.max(...others("borrowB"));
	if (!(peak - second >= planStyleView(plan).peakMargin))
		out.push({
			gate: "rule4",
			detail: `山が borrowB だけでない（borrowB ${peak.toFixed(1)}、2番手 ${second.toFixed(1)}）`,
		});
	const lift = get("lift");
	if (!(lift < Math.min(...others("lift"))))
		out.push({
			gate: "rule4",
			detail: `lift が最弱でない（${lift.toFixed(1)}）`,
		});
	if (!(get("return") < get("home")))
		out.push({
			gate: "rule4",
			detail: `return が home より静かでない（${get("return").toFixed(1)} / ${get("home").toFixed(1)}）`,
		});
	const g = get("glimpse");
	if (!(g < get("borrowA") && g < get("borrowB")))
		out.push({
			gate: "rule4",
			detail: `glimpse が両隣より凹んでいない（${g.toFixed(1)}）`,
		});
	return out;
};

const chordIdentity = (c: AccompChord): string => `${c.root.fifth}:${c.third}`;

/** 規則⑤。予告の借用和音 ⊆ borrowA ∪ borrowB、予告は home の最後のブロック、return に借用和音が無い。 */
export const rule5Violations = (plan: AccompPlan): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const home = regionOf(plan, "home");
	const ret = regionOf(plan, "return");
	if (!home || !ret) return out;
	const borrowedIn = (r: AccompRegion | undefined): AccompChord[] =>
		(r?.chords ?? []).flatMap((c) => barChords(c).filter((x) => x.borrowed));
	const expanded = new Set(
		[
			...borrowedIn(regionOf(plan, "borrowA")),
			...borrowedIn(regionOf(plan, "borrowB")),
		].map(chordIdentity),
	);
	home.chords.forEach((bar, i) => {
		for (const c of barChords(bar).filter((x) => x.borrowed)) {
			if (!expanded.has(chordIdentity(c)))
				out.push({
					gate: "rule5",
					detail: `予告の ${c.roman}（${i + 1}小節目）が借用区間に無い`,
				});
			if (i < home.bars - 4)
				out.push({
					gate: "rule5",
					detail: `予告の ${c.roman} が home の終わりの4小節の外（${i + 1}小節目）`,
				});
		}
	});
	for (const c of borrowedIn(ret))
		out.push({ gate: "rule5", detail: `return に借用和音 ${c.roman}` });
	return out;
};

const isSusThenDominant = (bar: string): boolean => {
	const cs = barChords(bar);
	return (
		cs.length === 2 &&
		cs[0].root.pc === 7 &&
		cs[0].third === "sus4" &&
		cs[1].root.pc === 7 &&
		cs[1].third === "major" &&
		!cs[1].borrowed
	);
};

/**
 * 計画の段で確かめられる関門の前提を全部調べる（§7.2 のうち、音を置く前に分かるもの）。
 * 空なら計画は壊れていない。`cells` は切除対照でセルの表を差し替えるため。
 */
export const planViolations = (
	plan: AccompPlan,
	opts: { cells?: Readonly<Record<string, AccompArpCell>> } = {},
): AccompPlanViolation[] => {
	const view = planStyleView(plan);
	const cells = opts.cells ?? view.arpCells;
	const out: AccompPlanViolation[] = [];
	const rs = plan.regions;

	// 旅程: 役割の並びと長さの関係
	const roles = rs.map((r) => r.role).join(",");
	if (roles !== view.itinerary.join(","))
		out.push({ gate: "itinerary", detail: `役割の並び ${roles}` });
	const len = (role: AccompRole): number => regionOf(plan, role)?.bars ?? 0;
	const md = len("minorDwell");
	if (
		!(md >= len("home")) ||
		rs.some((r) => r.role !== "minorDwell" && r.role !== "home" && md <= r.bars)
	)
		out.push({
			gate: "itinerary",
			detail: `minorDwell（${md}小節）が最長でない`,
		});

	// 長さ: 4の倍数・区間の並び・秒数
	let expectStart = 0;
	for (const r of rs) {
		if (r.bars <= 0 || r.bars % 4 !== 0)
			out.push({ gate: "length", detail: `${r.role} が ${r.bars} 小節` });
		if (r.startBar !== expectStart)
			out.push({
				gate: "length",
				detail: `${r.role} の startBar ${r.startBar}（${expectStart} のはず）`,
			});
		expectStart += r.bars;
	}
	const seconds = planSeconds(plan);
	if (!secondsOk(seconds, view))
		out.push({ gate: "length", detail: `${seconds.toFixed(1)} 秒` });

	// 表現: 配列の長さと id
	let shapeOk = true;
	for (const r of rs) {
		const blocks = r.bars / 4;
		const bad = (detail: string): void => {
			shapeOk = false;
			out.push({ gate: "expression", detail: `${r.role}: ${detail}` });
		};
		if (r.chords.length !== r.bars) bad(`和音が ${r.chords.length} 小節`);
		if (r.arpLevel.length !== r.bars)
			bad(`基準 v が ${r.arpLevel.length} 小節`);
		if (r.arpLevel.some((v) => !Number.isInteger(v) || v < 1 || v > 127))
			bad("基準 v が 1〜127 の整数でない");
		if (r.texture.arpCells.length !== blocks)
			bad(`セルが ${r.texture.arpCells.length} ブロック`);
		if (r.texture.bass.length !== blocks)
			bad(`低音型が ${r.texture.bass.length} ブロック`);
		for (const id of r.texture.arpCells)
			if (!cells[id]) bad(`セル ${id} が無い`);
		for (const id of r.texture.bass)
			if (!view.bassPatterns[id]) bad(`低音型 ${id} が無い`);
		for (let b = 1; b < r.texture.arpCells.length; b++)
			if (r.texture.arpCells[b] === r.texture.arpCells[b - 1])
				bad(`同じセルが続く（${r.texture.arpCells[b]}）`);
		// 記録した和音の打ち方（PlanPins）。実現の段はこれに従う
		if (r.compHits) {
			if (r.compHits.length !== r.bars)
				bad(`和音の打ち方が ${r.compHits.length} 小節`);
			for (const id of r.compHits)
				if (!view.compHits[id]) bad(`和音の打ち方 ${id} が無い`);
		}
	}
	if (plan.mix !== undefined && !view.mixes.has(plan.mix))
		out.push({
			gate: "expression",
			detail: `ミックス ${plan.mix} が型 ${view.archetype.id} に無い`,
		});

	// 和声: 全部の和音が読めること
	let harmonyOk = true;
	for (const r of rs)
		for (const bar of r.chords) {
			const n = bar.trim().split(/\s+/).length;
			if (n < 1 || n > 2) {
				harmonyOk = false;
				out.push({
					gate: "harmony",
					detail: `${r.role} の "${bar}" は1小節に ${n} 和音`,
				});
			}
			try {
				barChords(bar);
			} catch (e) {
				harmonyOk = false;
				out.push({
					gate: "harmony",
					detail: `${r.role} の "${bar}": ${(e as Error).message}`,
				});
			}
		}
	if (!shapeOk || !harmonyOk) return out;

	// 規則①: 区間ごとの分散の毎秒音数（セルの音数から）
	for (const r of rs) {
		const rate = regionArpRate(r, plan.bpm, cells);
		// 帯は役割ごと（fb は lift だけ下限が低い）。知らない役割は旅程の関門が落とす
		const range = view.arpRate[r.role];
		if (range && (rate < range.min || rate > range.max))
			out.push({
				gate: "rule1",
				detail: `${r.role} の分散が毎秒 ${rate.toFixed(2)} 音`,
			});
	}

	out.push(...rule2Violations(plan));
	out.push(...rule3Violations(plan));
	out.push(...rule4Violations(plan));
	out.push(...rule5Violations(plan));

	// 継ぎ目（ループの閉じ方の前提）
	const home = regionOf(plan, "home");
	const last = rs[rs.length - 1];
	const finalBar = last?.chords[last.chords.length - 1];
	if (!finalBar || !isSusThenDominant(finalBar))
		out.push({
			gate: "seam",
			detail: `最終小節が Vsus4→V でない（${finalBar}）`,
		});
	if (home) {
		const homeLast = home.chords[home.chords.length - 1];
		if (homeLast !== finalBar)
			out.push({
				gate: "seam",
				detail: `home の最終小節（${homeLast}）と曲の最終小節（${finalBar}）が違う`,
			});
		const head = barChords(home.chords[0])[0];
		if (head.root.pc !== 0 || head.borrowed || head.third !== "major")
			out.push({
				gate: "seam",
				detail: `home が主和音で始まらない（${head.roman}）`,
			});
	}
	return out;
};
