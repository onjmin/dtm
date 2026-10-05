/**
 * 範囲補完（続き・間奏の補完・部分的な作り直し）。
 *
 * 読み込み中の曲の「ある小節範囲」だけを、自動作曲のスタイルで埋める。`composeSong` は曲全体を
 * 1本の乱数列で描くので、範囲だけを引き直す口が無い。そこで**いまのスタイルで借用曲を1曲作り、
 * 要る種別のセクションを切り出して、曲の調へ移調して範囲に写す**。伴奏・ベース・上物・リードの
 * 整合は借用曲の中で取れているので、部品ごとの生成器を書き直さずに済む。
 *
 * - 調・テンポは曲から取る（テンポはステップ基準なので何もしなくてよい）。スタイルからは
 *   文法・ベース型・上物・リードの型だけを借りる。
 * - 既存テンプレートの乱数列は触らない（借用曲は普通に `composeSong` を呼ぶだけ）。
 * - ドラムは曲全体で1パターンが仕様なので、範囲補完は触らない。
 */

import { detectKey } from "@onjmin/chord-parser";
import { UNITS_PER_SEMITONE, type Units } from "../audio/tuning";
import {
	buildChordPlacements,
	type ChordPatternType,
	semitonesToUnits,
} from "../chord/chords";
import type { InstrumentPreset } from "../instruments/instrument-presets";
import { type AdvancedLayer, buildAdvancedLayers } from "./advanced-layers";
import {
	type ComposedNote,
	type ComposeResult,
	composeSong,
	seededRandom,
	transposeChordName,
} from "./compose";
import type { PlacedSection, SectionKind } from "./compose-sections";

/** 読み込み中の曲から推定した調。 */
export type DetectedSongKey = {
	/** 主音の pitch class（0 = C）。 */
	tonicPc: number;
	mode: "major" | "minor";
};

export type FillRequest = {
	stepsPerBar: number;
	edo?: number;
	/** スタイル（作曲テンプレート名）。 */
	template: string;
	/** 埋めたい種別。スタイルがその種別を作らないときは {@link FILL_FALLBACKS} で代える。 */
	kind: SectionKind;
	/** 範囲の開始小節（0始まり）と小節数。 */
	startBar: number;
	bars: number;
	/** 曲の調。null は不明（移調しない）。 */
	key: DetectedSongKey | null;
	random: () => number;
	/** 借用曲を引く上限。 */
	maxTries?: number;
};

export type FillRoles = {
	melody: ComposedNote[];
	submelody: ComposedNote[];
	bass: ComposedNote[];
	harmony: ComposedNote[];
	harmony2: ComposedNote[];
	octave: ComposedNote[];
	pad: ComposedNote[];
	solo: ComposedNote[];
};

export type FillResult = {
	/** 借用曲。 */
	donor: ComposeResult;
	/** 借用曲の乱数種（再現用）。 */
	donorSeed: number;
	/** 切り出したセクション。 */
	section: PlacedSection;
	/** 実際に使った種別（要求と違えば代用）。 */
	usedKind: SectionKind;
	/** 借用曲から曲の調への移調量（半音、-5〜6）。 */
	transpose: number;
	/** 役割ごとのノート（範囲内の絶対ステップ、移調済み）。シンプルモードの4トラック用。 */
	roles: FillRoles;
	/** 範囲の和音。小節ごと、絶対名（移調済み）。空白区切りは2拍ごとの2和音。 */
	chordBars: string[];
	chordPattern: ChordPatternType;
	/** 範囲の和音を伴奏トラックへ展開したノート（範囲内の絶対ステップ）。 */
	chordNotes: ComposedNote[];
	/** 上級者モードの15トラック用レイヤー（範囲内の絶対ステップ、移調済み）。 */
	advancedLayers: (preset: InstrumentPreset) => AdvancedLayer[];
};

/**
 * 種別の代用順。スタイルによって作らない種別がある（2号兄貴は間奏を持たず、ゲームBGMは間奏も
 * アウトロも持たない）ので、近い役割から順に探す。間奏の代用に歌のある種別を使うときは
 * 歌メロをソロへ回す（{@link instrumentalize}）。
 */
export const FILL_FALLBACKS: Record<SectionKind, SectionKind[]> = {
	interlude: ["interlude", "bridge", "verse", "chorus"],
	intro: ["intro", "interlude", "verse"],
	verse: ["verse", "prechorus", "bridge"],
	prechorus: ["prechorus", "verse", "bridge"],
	chorus: ["chorus", "drop_chorus"],
	bridge: ["bridge", "prechorus", "verse"],
	drop_chorus: ["drop_chorus", "chorus"],
	outro: ["outro", "chorus", "interlude", "verse"],
};

/** 歌わない種別。代用セクションに歌メロが付いていれば外す（間奏はソロへ回す）。 */
const INSTRUMENTAL_KINDS = new Set<SectionKind>(["intro", "interlude"]);

const ROLE_KEYS = [
	"melody",
	"submelody",
	"bass",
	"harmony",
	"harmony2",
	"octave",
	"pad",
	"solo",
] as const;

/** 借用曲を何曲まで引くか。1曲は候補8本の抽選なので、作曲1回分より軽い。 */
const DEFAULT_MAX_TRIES = 12;
/** 借用曲の候補数。黄金値には関わらない（借用曲は `#seed` で再現する対象ではない）。 */
const DONOR_DRAW_COUNT = 8;

type DonorPick = {
	song: ComposeResult;
	seed: number;
	section: PlacedSection;
	rank: number;
};

/**
 * 借用曲のセクションを選ぶ。代用順（{@link FILL_FALLBACKS}）で最も近い種別、同じ種別なら
 * 転調していないもの・要る長さに届くもの・1回目のものを優先する。
 */
const bestSection = (
	song: ComposeResult,
	kind: SectionKind,
	bars: number,
): { section: PlacedSection; rank: number } | null => {
	const order = FILL_FALLBACKS[kind];
	let best: { section: PlacedSection; rank: number; score: number } | null =
		null;
	for (const s of song.sections) {
		const rank = order.indexOf(s.kind);
		if (rank < 0) continue;
		const score =
			(s.keyShift === 0 ? 0 : 4) +
			(s.bars >= bars ? 0 : 2) +
			(s.restatement ? 1 : 0);
		if (!best || rank < best.rank || (rank === best.rank && score < best.score))
			best = { section: s, rank, score };
	}
	return best && { section: best.section, rank: best.rank };
};

const findDonor = (req: FillRequest): DonorPick => {
	const tries = Math.max(1, req.maxTries ?? DEFAULT_MAX_TRIES);
	let best: DonorPick | null = null;
	for (let i = 0; i < tries; i++) {
		const seed = Math.floor(req.random() * 0x100000000) >>> 0;
		const song = composeSong({
			stepsPerBar: req.stepsPerBar,
			edo: req.edo,
			template: req.template,
			// 公開しているスタイルは全部短調。長調の曲へは平行短調で合わせる（{@link transposeFor}）。
			baseKey: "minor",
			scale: "auto",
			random: seededRandom(seed),
			drawCount: DONOR_DRAW_COUNT,
		});
		const hit = bestSection(song, req.kind, req.bars);
		if (!hit) continue;
		if (!best || hit.rank < best.rank)
			best = { song, seed, section: hit.section, rank: hit.rank };
		if (hit.rank === 0 && hit.section.bars >= req.bars) break;
		// その種別を作らないスタイル（2号兄貴・ゲームBGMの間奏）は何曲引いても rank 0 が出ない。
		// 隣の種別が取れていれば数曲で打ち切る（1曲 100〜150ms）。
		if (best.rank <= 1 && i >= 3) break;
	}
	if (!best)
		throw new Error(
			`スタイル ${req.template} に ${req.kind} の代用になるセクションが無い`,
		);
	return best;
};

/** 借用曲（イ短調＋rootShift）から曲の調への移調量。長調の曲は平行短調に合わせる。 */
export const transposeFor = (
	donorRootShift: number,
	key: DetectedSongKey | null,
): number => {
	if (!key) return 0;
	const donorTonic = (9 + donorRootShift) % 12;
	const target = key.mode === "minor" ? key.tonicPc : (key.tonicPc + 9) % 12;
	let diff = (((target - donorTonic) % 12) + 12) % 12;
	if (diff > 6) diff -= 12;
	return diff;
};

/**
 * 歌わない種別へ歌のあるセクションを代用するとき、歌メロを器楽へ回す。間奏は「歌が休む場所で
 * あって音楽が休む場所ではない」ので主旋律をソロへ、イントロはソロも置かない（曲の頭で
 * 聞かせどころを使い切らない）。ハモリ・オクターブ重ねは歌の層なので外す。
 */
const instrumentalize = (
	song: ComposeResult,
	kind: SectionKind,
): ComposeResult => {
	if (!INSTRUMENTAL_KINDS.has(kind)) return song;
	return {
		...song,
		melody: [],
		harmony: [],
		harmony2: [],
		octave: [],
		solo: kind === "interlude" ? [...song.solo, ...song.melody] : song.solo,
	};
};

/**
 * 借用曲のセクションの小節を範囲へ写す。範囲がセクションより長ければセクションの小節を回す
 * （流派の素材は4小節周期なので回しても切れない）。セクションの終わりをまたぐ音は切る。
 */
const mapNotes = (
	notes: ComposedNote[],
	section: PlacedSection,
	req: FillRequest,
	shiftUnits: number,
): ComposedNote[] => {
	const spb = req.stepsPerBar;
	const secStart = section.startBar * spb;
	const secEnd = (section.startBar + section.bars) * spb;
	const rangeEnd = (req.startBar + req.bars) * spb;
	const out: ComposedNote[] = [];
	for (let i = 0; i < req.bars; i++) {
		const donorBar = section.startBar + (i % section.bars);
		const from = donorBar * spb;
		const to = from + spb;
		const target = (req.startBar + i) * spb;
		for (const n of notes) {
			if (n.startStep < from || n.startStep >= to) continue;
			const start = target + (n.startStep - from);
			const end = Math.min(
				start + n.durationSteps,
				// セクションの終わりで切る（回したときに次の周の頭と重ならない）
				start + (secEnd - n.startStep),
				rangeEnd,
			);
			if (end <= start || n.startStep < secStart) continue;
			out.push({
				startStep: start,
				pitchUnits: (n.pitchUnits + shiftUnits) as Units,
				durationSteps: Math.max(1, end - start),
				velocity: n.velocity,
			});
		}
	}
	return out;
};

/** 借用曲の和音（ハ長調基準の文字列）から、範囲の小節ごとの絶対名を作る。 */
const chordBarsOf = (
	song: ComposeResult,
	section: PlacedSection,
	bars: number,
	shift: number,
): string[] => {
	const all = song.chordProgression.split("|");
	const out: string[] = [];
	for (let i = 0; i < bars; i++) {
		const bar = all[section.startBar + (i % section.bars)] ?? all.at(-1) ?? "";
		out.push(
			bar
				.split(" ")
				.filter((c) => c.length > 0)
				.map((c) => transposeChordName(c, shift))
				.join(" "),
		);
	}
	return out;
};

/**
 * 範囲を埋める。借用曲を引き、要る種別のセクションを切り出し、曲の調へ移調して範囲の
 * 絶対ステップへ写す。書き込みは呼び出し側（トラックの持ち方がモードで違う）。
 */
export const fillRange = (req: FillRequest): FillResult => {
	if (req.bars <= 0) throw new Error("範囲の小節数は1以上");
	const edo = req.edo === 31 ? 31 : 12;
	const picked = findDonor(req);
	const donor = instrumentalize(picked.song, req.kind);
	const section = picked.section;
	const transpose = transposeFor(donor.rootShift, req.key);
	const shiftUnits = semitonesToUnits(transpose, edo);

	const roles = {} as FillRoles;
	for (const k of ROLE_KEYS)
		roles[k] = mapNotes(donor[k], section, req, shiftUnits);

	// 和音は借用曲の rootShift と移調を合わせた量で絶対名にする
	const absShift = donor.rootShift + transpose;
	const chordBars = chordBarsOf(donor, section, req.bars, absShift);
	// 伴奏の展開は作曲と同じく bpm 120 固定で刻む（parseChords は秒で刻むので、割り切れない
	// テンポでは小節頭がずれる）。範囲の頭へずらして置く。
	const chordNotes: ComposedNote[] = buildChordPlacements({
		edo,
		chordStr: chordBars.join("|"),
		patternType: donor.chordPattern,
		rootShift: 0,
		bpm: 120,
		stepsPerBar: req.stepsPerBar,
	})
		.filter((p) => p.startStep < req.bars * req.stepsPerBar)
		.map((p) => ({
			startStep: p.startStep + req.startBar * req.stepsPerBar,
			pitchUnits: p.pitchUnits,
			durationSteps: Math.max(
				1,
				Math.min(p.durationSteps, req.bars * req.stepsPerBar - p.startStep),
			),
			velocity: p.velocity,
		}));

	return {
		donor,
		donorSeed: picked.seed,
		section,
		usedKind: section.kind,
		transpose,
		roles,
		chordBars,
		chordPattern: donor.chordPattern,
		chordNotes,
		advancedLayers: (preset) =>
			buildAdvancedLayers(donor, {
				edo,
				stepsPerBar: req.stepsPerBar,
				preset,
			}).map((layer) => ({
				...layer,
				notes: mapNotes(layer.notes, section, req, shiftUnits),
			})),
	};
};

/**
 * 読み込み中の曲の調を全トラックの音から推定する（鳴っていた長さを重みにする）。
 * 31平均律の音は最寄りの半音へ丸める。音が無ければ null。
 */
export const detectSongKey = (
	notes: readonly { pitchUnits: number; durationSteps: number }[],
): DetectedSongKey | null => {
	if (notes.length === 0) return null;
	try {
		const top = detectKey(
			notes.map((n) => ({
				pitch: Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
				duration: Math.max(1, n.durationSteps),
			})),
		)[0];
		if (!top) return null;
		return {
			tonicPc: ((top.tonic % 12) + 12) % 12,
			mode: top.mode === "minor" ? "minor" : "major",
		};
	} catch {
		return null;
	}
};

// ============================================================
// 範囲の見つけ方（UI の補助。トラックの持ち方に依らない純粋関数）
// ============================================================

export type BarRange = { startBar: number; bars: number };

/**
 * 全トラックが空の小節の並び（曲の中で最初に見つかるもの）。曲の頭の空白と末尾より後は
 * 「抜けている」とは言わないので数えない。無ければ null。
 */
export const findEmptyBars = (
	notes: readonly { startStep: number; durationSteps: number }[],
	stepsPerBar: number,
): BarRange | null => {
	if (notes.length === 0) return null;
	let first = Number.POSITIVE_INFINITY;
	let last = 0;
	for (const n of notes) {
		first = Math.min(first, Math.floor(n.startStep / stepsPerBar));
		last = Math.max(
			last,
			Math.floor((n.startStep + n.durationSteps - 1) / stepsPerBar),
		);
	}
	const filled = new Uint8Array(last + 1);
	for (const n of notes) {
		const a = Math.floor(n.startStep / stepsPerBar);
		const b = Math.floor((n.startStep + n.durationSteps - 1) / stepsPerBar);
		for (let i = a; i <= b && i <= last; i++) filled[i] = 1;
	}
	for (let i = first; i <= last; i++) {
		if (filled[i]) continue;
		let j = i;
		while (j <= last && !filled[j]) j++;
		return { startBar: i, bars: j - i };
	}
	return null;
};

/** 曲の末尾の次の小節（続きを足す位置）。空の曲は 0。 */
export const songEndBar = (
	notes: readonly { startStep: number; durationSteps: number }[],
	stepsPerBar: number,
): number => {
	let end = 0;
	for (const n of notes) end = Math.max(end, n.startStep + n.durationSteps);
	return Math.ceil(end / stepsPerBar);
};

// ============================================================
// 歌詞の継ぎ（トラックの歌詞は音符順の一列なので、範囲の分だけ差し替える）
// ============================================================

/**
 * 歌詞の文字列を、範囲の前・範囲・範囲の後ろに分けて継ぐ。`tokenize` は音符1つを消費する
 * 音節ごとの表示文字列（`、` のように音符を消費しない印は直前の音節に付ける）。歌詞が音符より
 * 短ければ足りないぶんは空として扱う（余った音は歌わない、という今の約束のまま）。
 */
export const spliceLyrics = (
	lyrics: string,
	tokenize: (text: string) => string[],
	/** 範囲より前にある音符の数。 */
	before: number,
	/** 範囲の中にあった（消す）音符の数。 */
	removed: number,
	/** 範囲へ入れる歌詞。 */
	insert: string,
): string => {
	const syl = tokenize(lyrics);
	const head = syl.slice(0, before).join("");
	const tail = syl.slice(before + removed).join("");
	return `${head}${insert}${tail}`;
};
