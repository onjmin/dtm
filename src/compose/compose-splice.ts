/**
 * 継ぎ合わせの生成エンジン。骨格借用（{@link file://./compose-skeleton.ts}）が1曲を丸写ししたのに対し、
 * ここは**抽象骨格バンク**（{@link SECTION_BANK}、曲名・旋律の度数・ベースの実音を持たない）から
 * セクションごとに別々の曲の設計図を引いて継ぐ。和音は機能を保った置換を掛け、ベースは**別の曲の
 * 同種セクション**から型の種類だけ借りて実音はその時点の和音ルートから作る。歌メロは骨格借用と同じく
 * 他曲の実在フレーズを当てる（{@link file://./compose-melody-fit.ts}）。伴奏の形（4つ打ち・8分オクターブ・
 * 2拍で動く7th の進行・ラスサビの反復）を保てば旋律を差し替えても界隈曲に聴こえる、というのが
 * 骨格借用で得た知見。
 *
 * `composeSong` の先頭で `engine: "splice"` のとき分岐する（共通経路の乱数は消費しない）。乱数の順は
 * 構成 → 調（→ 長短が違えば構成を引き直し）→ 音階 → テンポ → 楽器 → ベースの帯 → セクション長
 * （種類ごとに1回）→ 和音の donor とベースの donor（種類ごとに2回）→ 和音ごとの置換の当否（当たれば
 * 候補の抽選）→ 連続一致の上限を超えた並びの強制置換 → ラスサビ転調の当否 → ドラム（donor が none の
 * ときだけ）→ 楽句ごとのフレーズ → アルペジオの形・強さ。
 */

import { parseChord } from "@onjmin/chord-parser";
import type { Units } from "../audio/tuning";
import type { ChordPatternType } from "../chord/chords";
import { semitonesToUnits } from "../chord/chords";
import {
	type ComposedNote,
	type ComposeOptions,
	type ComposeResult,
	evaluate,
	MELODY_HIGH,
	MELODY_LOW,
	transposeChordName,
} from "./compose";
import { resolveComposeKey } from "./compose-keys";
import {
	buildArpLayer,
	buildPadLayer,
	EMPTY_TONAL,
	EMPTY_VOCAL,
	type FitBar,
	fitPhrases,
	fittedDrawStats,
	MELODY_WINDOW,
	padSectionsOf,
	pick,
	renderFittedMelody,
	rootPcOf,
} from "./compose-melody-fit";
import { resolveComposeScale } from "./compose-scales";
import { FORM_BANK, SECTION_BANK } from "./compose-section-bank";
import {
	type PlacedSection,
	SECTION_SPECS,
	type StructureTemplate,
} from "./compose-sections";
import {
	type BankSection,
	type BassFigure,
	bankSectionBarChoices,
	isSungKind,
} from "./section-bank-types";

const BASE_STEPS_PER_BAR = 192;

/** 基準調の主音（短調 A3、長調 C4）。バンクの melodyCenterRel はここからの半音差。 */
const TONIC_MIDI = { minor: 57, major: 60 } as const;
/** 隣り合うセクションで歌の音域中心が動いてよい上限（半音）。donor の値そのままだと継ぎ目で 10 以上跳ぶ。 */
const CENTER_STEP_MAX = 7;

/**
 * ベースの音域（MIDI）。根音は曲ごとに引いた帯（下端 30/32 の 1 オクターブ）に畳み、オクターブ上と
 * 5度を足しても 28〜55 に収まる。
 */
export const SPLICE_BASS_LOW = 28;
export const SPLICE_BASS_HIGH = 55;
const BASS_ROOT_BANDS = [30, 32];

/** 置換の確率（セクションの最初と最後の和音は掛けない）。 */
const SUBSTITUTE_P = 0.35;
/**
 * donor と同じ和音が続いてよい上限（半小節）。「同じ」は構成音の集合か根音が同じこと——Dm→Dm6 の
 * 色替えだけだと根音の並びが元曲のまま残り、seed 87 の Aメロ 8 小節が丸写しに聞こえた（2026-10-01）。
 * 超える並びは真ん中に近い置換できる和音を1つ、根音の変わる候補へ必ず置き換える。
 */
const MAX_SAME_RUN = 8;
/** ラスサビを短3度上へ転調する確率（ヤツメ穴型）。 */
const KEY_SHIFT_P = 0.25;
const KEY_SHIFT = 3;
/**
 * イントロの和音を最初のサビの和音（置換後）にする確率。界隈曲を分ける要素ではない（所有者の推測。
 * バンクの元曲では 35 曲中 1 曲）ので、両方が出るよう半々にする。
 */
const INTRO_FROM_CHORUS_P = 0.5;
/** donor のドラムが none のときの候補。 */
const DRUM_FALLBACK = ["four_clap", "dance", "kaiwai_1"];

// ============================================================
// 和音の置換表（機能を保つ）。全和音が parseChord を通ることはテストが見る。
// ============================================================

type Substitution =
	| string
	| { split: [string, string] }
	| { ifNext: RegExp; name: string };

/** 短調（Am 基準）。 */
const MINOR_SUBS: Record<string, Substitution[]> = {
	Am7: ["Am", "AmM7", "Am6", { ifNext: /^Dm/, name: "A7" }],
	Am: ["Am7", "AmM7", "Am6", { ifNext: /^Dm/, name: "A7" }],
	AmM7: ["Am7", "Am", "Am6"],
	Am6: ["Am7", "Am", "AmM7"],
	E7: ["E+", { split: ["Bm7-5", "E7"] }],
	"E+": ["E7", { split: ["Bm7-5", "E7"] }],
	// E → E+ は置かない（E7 からだけ）。増三和音の小節割合がコーパスの p75 を超えた（0.068 / 0.046）。
	E: ["E7"],
	Dm7: ["Dm6", "FM7", "Bm7-5"],
	Dm6: ["Dm7", "FM7", "Bm7-5"],
	Dm: ["Dm7", "Dm6", "F"],
	"Bm7-5": ["Dm7", "Dm6"],
	FM7: ["Dm7", "Fm7"],
	F: ["FM7", "Dm7"],
	Fm7: ["FM7", "Dm7"],
	CM7: ["C7", "Em7"],
	C7: ["CM7", "Em7"],
	C: ["CM7", "Em7"],
	G7: ["Db7", "Bb"],
	G: ["G7", "Bb"],
	Db7: ["G7", "Bb"],
	Em7: ["E7", "CM7"],
	Em: ["Em7", "E7"],
	Bb: ["BbM7", "Fm7"],
	BbM7: ["Bb", "Fm7"],
	Bdim: ["Bm7-5", "G7"],
	"G#dim": ["E7", "E+"],
	Ab: ["AbM7", "Fm7"],
	AbM7: ["Ab", "Fm7"],
	Gm: ["Gm7"],
	Gm7: ["Gm"],
};

/** 長調（C 基準）。同じ機能の群を C 基準で持つ。 */
const MAJOR_SUBS: Record<string, Substitution[]> = {
	C: ["CM7", "C6", "Am7"],
	CM7: ["C", "C6", "Am7"],
	C6: ["C", "CM7", "Am7"],
	G7: ["G", "Bm7-5", "Db7"],
	G: ["G7", "Bm7-5"],
	Db7: ["G7"],
	F: ["FM7", "Dm7", "Fm"],
	FM7: ["F", "Dm7", "Fm"],
	Fm: ["F", "FM7"],
	Dm7: ["F", "FM7", "Dm", "Dm6"],
	Dm: ["Dm7", "Dm6", "F"],
	Dm6: ["Dm7", "Dm"],
	Am: ["Am7", "Am6", "C", "F"],
	Am7: ["Am", "Am6", "C6", "FM7"],
	Am6: ["Am7", "Am"],
	Em7: ["Em", "G", "CM7"],
	Em: ["Em7", "G"],
	E7: ["E+", { split: ["Bm7-5", "E7"] }],
	"E+": ["E7"],
	Bdim: ["Bm7-5", "G7"],
	Bb: ["BbM7", "Gm7"],
	BbM7: ["Bb", "Gm7"],
	Gm: ["Gm7", "Bb"],
	Gm7: ["Gm", "BbM7"],
};

/**
 * 置換表に無い和音の既定: 同じルートで 7th / 6th / M7 を付け外す（構成音の集合が変わる）。
 * 抽出の和音名は長調で表の網羅率が 6 割しかなく、表だけだと置換率が下限に貼り付く。
 * 分数コードは分母を落とす。
 */
const GENERIC_SUFFIX: Record<string, string[]> = {
	"": ["M7", "6"],
	M7: ["", "6"],
	maj7: ["", "6"],
	"6": ["", "M7"],
	"7": ["", "9"],
	"9": ["7"],
	m: ["m7", "m6"],
	m7: ["m", "m6"],
	m6: ["m", "m7"],
	mM7: ["m7", "m"],
	m9: ["m7"],
	dim: ["dim7", "m7-5"],
	dim7: ["dim", "m7-5"],
	"m7-5": ["dim7", "dim"],
	sus4: ["7sus4", ""],
	"7sus4": ["sus4", "7"],
	sus2: ["sus4", ""],
	"+": ["", "7"],
	aug: ["", "7"],
	add9: ["", "M7"],
	"69": ["6", "M7"],
	M9: ["M7"],
	"7-9": ["7"],
};

const parses = (name: string): boolean => {
	try {
		parseChord(name);
		return true;
	} catch {
		return false;
	}
};

export const genericSubstitutes = (name: string): string[] => {
	const m = /^([A-G][#b]?)([^/]*)/.exec(name);
	if (!m) return [];
	const [, root, suffix] = m;
	const list = GENERIC_SUFFIX[suffix] ?? [""];
	return list.map((s) => root + s).filter((c) => c !== name && parses(c));
};

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR_LIKE = new Set(["", "M7", "maj7", "6", "69", "M9", "add9", "sus2", "sus4"]);
const DOMINANT_LIKE = new Set(["7", "9", "7-9", "7sus4", "+", "aug"]);
const MINOR_LIKE = new Set(["m", "m7", "m6", "mM7", "m9"]);
const DIM_LIKE = new Set(["dim", "dim7", "m7-5"]);

/**
 * 根音の変わる機能代理（表と既定の置換に根音の変わる候補が無いときだけ、連続一致を切るのに使う）:
 * 長三和音系→平行短調の m7 か長3度上の減和音、属和音系→裏コード、短三和音系→平行長調、
 * 減和音系→長3度下の属7。平行調と減和音は調（Am は和声的短音階、C は長音階）の音だけのもの。
 */
const IN_KEY = {
	minor: new Set([9, 11, 0, 2, 4, 5, 7, 8]),
	major: new Set([0, 2, 4, 5, 7, 9, 11]),
};
const inKey = (name: string, minor: boolean): boolean => {
	try {
		const key = minor ? IN_KEY.minor : IN_KEY.major;
		return parseChord(name).notes.every((n) => key.has(((n % 12) + 12) % 12));
	} catch {
		return false;
	}
};
const rootChangingFallback = (name: string, minor: boolean): string[] => {
	const m = /^([A-G][#b]?)([^/]*)/.exec(name);
	if (!m) return [];
	const [, root, suffix] = m;
	const pc = NOTE_NAMES.indexOf(root) >= 0 ? NOTE_NAMES.indexOf(root) : rootPcOf(root);
	const at = (d: number, sfx: string): string =>
		(sfx === "dim" && (pc + d) % 12 === 8 ? "G#" : NOTE_NAMES[(pc + d) % 12]) + sfx;
	if (DOMINANT_LIKE.has(suffix)) return [at(6, "7")].filter(parses);
	if (DIM_LIKE.has(suffix)) return [at(8, "7")].filter(parses);
	const diatonic = MAJOR_LIKE.has(suffix)
		? [at(9, "m7"), at(4, "dim")]
		: MINOR_LIKE.has(suffix)
			? [at(3, suffix === "m7" ? "M7" : "")]
			: [];
	return diatonic.filter((c) => parses(c) && inKey(c, minor));
};

const substitutes = (
	name: string,
	next: string | null,
	fullBar: boolean,
	minor: boolean,
): (string | [string, string])[] => {
	const list = (minor ? MINOR_SUBS : MAJOR_SUBS)[name];
	if (!list) return genericSubstitutes(name);
	const out: (string | [string, string])[] = [];
	for (const s of list) {
		if (typeof s === "string") out.push(s);
		else if ("split" in s) {
			if (fullBar) out.push(s.split);
		} else if (next !== null && s.ifNext.test(next)) out.push(s.name);
	}
	return out;
};

// ============================================================
// ベースの型テンプレート（実音はその時点の和音ルートから作る）
// ============================================================

/** 構成音のピッチクラス集合（近さの検査 (a) と同じ物差し。Am7 と C6 は同じ集合）。 */
const pcSetKey = (name: string): string => {
	try {
		return [...new Set(parseChord(name).notes.map((n) => ((n % 12) + 12) % 12))]
			.sort((a, b) => a - b)
			.join(",");
	} catch {
		return "";
	}
};

/**
 * 連続一致を切る置換の抽選は曲の乱数を使わず、donor と位置から決める。上限の規則を変えても
 * 強制置換の起きない曲の乱数列（以降の donor・旋律）が動かない。
 */
const positionRandom = (src: number, at: number): (() => number) => {
	let h = (Math.imul(src + 1, 0x9e3779b1) ^ Math.imul(at + 1, 0x85ebca6b)) >>> 0;
	return () => {
		h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
		h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
		return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
	};
};

/** 近さの上限で「同じ和音」とみなすもの（構成音の集合か根音が同じ。Am7 と C6、Dm と Dm6）。 */
const sameChord = (a: string, b: string): boolean =>
	pcSetKey(a) === pcSetKey(b) || rootPcOf(a) === rootPcOf(b);

type BassEvent = { step: number; semi: number; dur: number };

/**
 * 型と2つの半小節のルート（移調済みの MIDI、帯に畳んだもの）から1小節のベース。
 * ステップは 192 基準。既存 kaiwai の RL / オクターブ保持と同じ考え方（根音を低い帯に置き、
 * オクターブ上は +12、5度は +7 で、帯からはみ出さない）。tresillo（3:3:2）は同じ音の連打——
 * ヤツメ穴の実測は [0,0,0,0,0,0] で、コーパスの上位にも [0,12,7] 型は無い。
 */
const realizeBass = (
	figure: BassFigure,
	roots: [number, number],
): BassEvent[] => {
	const out: BassEvent[] = [];
	const put = (step: number, semi: number, dur: number): void => {
		out.push({ step, semi, dur });
	};
	const RL = (step: number): number => roots[step < 96 ? 0 : 1];
	switch (figure) {
		case "octave8":
			for (let i = 0; i < 8; i++)
				put(i * 24, RL(i * 24) + (i % 2 === 1 ? 12 : 0), 24);
			break;
		case "root8":
			for (let i = 0; i < 8; i++) put(i * 24, RL(i * 24), 24);
			break;
		case "dotted":
			for (const s of [0, 48, 96, 144]) {
				put(s, RL(s), 36);
				put(s + 36, RL(s) + 12, 12);
			}
			break;
		case "fifthmix":
			for (let i = 0; i < 8; i++) {
				const k = i % 4;
				put(
					i * 24,
					RL(i * 24) + (k === 1 || k === 3 ? 12 : k === 2 ? 7 : 0),
					24,
				);
			}
			break;
		case "tresillo":
			for (const s of [0, 96]) {
				put(s, RL(s), 36);
				put(s + 36, RL(s), 36);
				put(s + 72, RL(s), 24);
			}
			break;
		case "quarter":
			for (const s of [0, 48, 96, 144]) put(s, RL(s), 48);
			break;
		case "offbeat":
			for (const s of [24, 72, 120, 168]) put(s, RL(s), 24);
			break;
		case "sustain":
			if (roots[0] === roots[1]) put(0, roots[0], 192);
			else {
				put(0, roots[0], 96);
				put(96, roots[1], 96);
			}
			break;
		case "rest":
		case "other":
			break;
	}
	return out;
};

/** 最も多い具体の型（rest / other を除く）。無ければ `dflt`。 */
const mostFrequentFigure = (
	figures: BassFigure[],
	dflt: BassFigure,
): BassFigure => {
	const count = new Map<BassFigure, number>();
	for (const f of figures)
		if (f !== "other" && f !== "rest") count.set(f, (count.get(f) ?? 0) + 1);
	let best = dflt;
	let bestN = 0;
	for (const [f, n] of count)
		if (n > bestN) {
			best = f;
			bestN = n;
		}
	return best;
};

// ============================================================
// 生成
// ============================================================

/** 継ぎ合わせたセクション1本（1回目の内容。2回目以降はこれを再現する）。 */
type SplicedSection = {
	kind: BankSection["kind"];
	bars: number;
	donor: BankSection;
	/** ベースの型の種類を借りる donor（和音の donor とは別の曲）。 */
	bassDonor: BankSection;
	/** 置換後の和音（null は継続）。 */
	chords: (string | null)[][];
	figures: BassFigure[];
	rhythm: (number[] | null)[];
	sameAs: (number | null)[];
	rhythmSameAs: (number | null)[];
	layers: { arp: boolean; pad: boolean }[];
	substituted: number;
	eligible: number;
	/** 上限を超えた並びに置換できる和音が無かった回数（近さの検査が拾う）。 */
	unresolvedRuns: number;
};

export const composeSplice = (
	options: ComposeOptions,
	template: StructureTemplate,
): ComposeResult => {
	if (FORM_BANK.length === 0 || SECTION_BANK.length === 0)
		throw new Error("composeSplice: 抽象骨格バンクが空");
	const rnd = options.random ?? Math.random;
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);

	// --- 1. 構成と調 ---
	let form = pick(FORM_BANK, rnd);
	const baseKeyRaw = options.baseKey?.trim() || "any";
	// "any" はテンプレートの既定（kaiwai は短調）。長調の構成は調を指名したときだけ——長調の donor は
	// 薄く（抽出の和音名もクロマチック）、"auto" の音階が陽音階になる。
	const keyChoice =
		baseKeyRaw === "any" ? (template.baseKey ?? form.mode) : baseKeyRaw;
	const resolvedKey = resolveComposeKey(
		keyChoice === "any" ? form.mode : keyChoice,
		rnd,
	);
	// 構成と逆の長短になったら、その長短の構成へ引き直す。
	if (resolvedKey.mode && resolvedKey.mode !== form.mode) {
		const same = FORM_BANK.filter((f) => f.mode === resolvedKey.mode);
		if (same.length > 0) form = pick(same, rnd);
	}
	const mode = form.mode;
	const minor = mode === "minor";
	const rootShift = resolvedKey.rootShift;
	const scaleChoice = options.scale?.trim() || "auto";
	const scale = resolveComposeScale(
		scaleChoice === "auto" && template.scales && minor
			? pick(template.scales, rnd)
			: options.scale,
		minor,
		rnd,
	);
	const bpm = pick(template.bpmChoices ?? [135], rnd);
	const instrument = pick(template.instruments ?? ["retro_game"], rnd);
	const bassRootLow = pick(BASS_ROOT_BANDS, rnd);

	// --- 2. セクション長（種類ごとに1回。2回目以降は同じ長さ・同じ内容） ---
	const barsOfKind = new Map<BankSection["kind"], number>();
	for (let i = 0; i < form.kinds.length; i++) {
		const kind = form.kinds[i];
		if (barsOfKind.has(kind)) continue;
		barsOfKind.set(kind, pick(bankSectionBarChoices(kind, form.bars[i]), rnd));
	}

	// --- 3. donor と置換 ---
	const spliced = new Map<BankSection["kind"], SplicedSection>();
	const usedSrc = new Set<number>();
	let prevSrc: number | null = null;
	const placed: {
		kind: BankSection["kind"];
		startBar: number;
		bars: number;
		restatement: boolean;
	}[] = [];
	let cursor = 0;
	for (const kind of form.kinds) {
		const bars = barsOfKind.get(kind) ?? 4;
		const first = spliced.get(kind);
		if (first) {
			placed.push({ kind, startBar: cursor, bars, restatement: true });
			cursor += bars;
			prevSrc = first.donor.src;
			continue;
		}
		const sameKind = SECTION_BANK.filter(
			(s) => s.kind === kind && s.mode === mode,
		);
		const fresh = sameKind.filter(
			(s) => s.src !== prevSrc && !usedSrc.has(s.src),
		);
		const notPrev = sameKind.filter((s) => s.src !== prevSrc);
		const donor = pick(
			fresh.length > 0 ? fresh : notPrev.length > 0 ? notPrev : sameKind,
			rnd,
		);
		usedSrc.add(donor.src);
		prevSrc = donor.src;
		// ベースの型は別の曲の同種セクションから借りる（長短は問わない。型の種類は和音名に依らない）。
		// 和音の donor と同じ曲から借りると、8分オクターブはルートと帯が同じ小節で元曲と同じ実音になる。
		const bassPool = SECTION_BANK.filter(
			(s) => s.kind === kind && s.src !== donor.src,
		);
		const bassFresh = bassPool.filter((s) => !usedSrc.has(s.src));
		const bassDonor =
			bassPool.length === 0
				? donor
				: pick(bassFresh.length > 0 ? bassFresh : bassPool, rnd);
		// 長さが違えば4小節単位で切る／繰り返す（繰り返した小節は sameAs で前を指す）。
		const chords: (string | null)[][] = [];
		const figures: BassFigure[] = [];
		const rhythm: (number[] | null)[] = [];
		const sameAs: (number | null)[] = [];
		const rhythmSameAs: (number | null)[] = [];
		const layers: { arp: boolean; pad: boolean }[] = [];
		for (let i = 0; i < bars; i++) {
			const j = i % donor.bars;
			chords.push([...donor.chords[j]]);
			figures.push(bassDonor.bass[i % bassDonor.bars]);
			rhythm.push(donor.rhythm[j]);
			layers.push({ ...donor.layers[j] });
			if (i < donor.bars) {
				sameAs.push(donor.sameAs[j]);
				rhythmSameAs.push(donor.rhythmSameAs[j]);
			} else {
				sameAs.push(rhythm[i] ? i - donor.bars : null);
				rhythmSameAs.push(null);
			}
		}
		// 機能を保った置換。セクションの最初と最後の和音は置換しない。
		const tokens: { bar: number; half: 0 | 1 }[] = [];
		chords.forEach((pair, bar) => {
			if (pair[0] !== null) tokens.push({ bar, half: 0 });
			if (pair[1] !== null) tokens.push({ bar, half: 1 });
		});
		let substituted = 0;
		let eligible = 0;
		for (let t = 1; t < tokens.length - 1; t++) {
			const { bar, half } = tokens[t];
			const name = chords[bar][half];
			if (name === null) continue;
			eligible++;
			if (rnd() >= SUBSTITUTE_P) continue;
			const nt = tokens[t + 1];
			const next = chords[nt.bar][nt.half];
			const fullBar = half === 0 && chords[bar][1] === null;
			const cands = substitutes(name, next, fullBar, minor);
			if (cands.length === 0) continue;
			const chosen = pick(cands, rnd);
			if (typeof chosen === "string") chords[bar][half] = chosen;
			else {
				chords[bar][0] = chosen[0];
				chords[bar][1] = chosen[1];
			}
			substituted++;
		}
		const resolve = (list: (string | null)[][]): string[] => {
			const out: string[] = [];
			let p: string = minor ? "Am" : "C";
			for (const [c0, c1] of list) {
				const a = c0 ?? p;
				const z = c1 ?? a;
				out.push(a, z);
				p = z;
			}
			return out;
		};
		const donorHalf = resolve(donor.chords);
		let unresolvedRuns = 0;
		for (let guard = 0; guard < 8; guard++) {
			const genHalf = resolve(chords);
			let runStart = -1;
			let run = 0;
			let found: { from: number; to: number } | null = null;
			for (let h = 0; h <= genHalf.length; h++) {
				const same =
					h < genHalf.length &&
					sameChord(genHalf[h], donorHalf[h % donorHalf.length]);
				if (same) {
					if (run === 0) runStart = h;
					run++;
				} else {
					if (run > MAX_SAME_RUN) found = { from: runStart, to: h };
					run = 0;
				}
				if (found) break;
			}
			if (!found) break;
			const mid = (found.from + found.to) / 2;
			const inRun = tokens
				.map((tk, t) => ({ tk, t, at: tk.bar * 2 + tk.half }))
				.filter(
					({ t, at }) =>
						t > 0 && t < tokens.length - 1 && at >= found.from && at < found.to,
				)
				.sort((x, y) => Math.abs(x.at - mid) - Math.abs(y.at - mid));
			let done = false;
			for (const { tk, t } of inRun) {
				const name = chords[tk.bar][tk.half];
				if (name === null) continue;
				const nt = tokens[t + 1];
				const changes = (c: string | [string, string]): boolean =>
					!sameChord(typeof c === "string" ? c : c[0], name);
				let cands = [
					...substitutes(
						name,
						chords[nt.bar][nt.half],
						tk.half === 0 && chords[tk.bar][1] === null,
						minor,
					),
					...genericSubstitutes(name),
				].filter(changes);
				if (cands.length === 0) cands = rootChangingFallback(name, minor).filter(changes);
				if (cands.length === 0) continue;
				const chosen = pick(cands, positionRandom(donor.src, tk.bar * 2 + tk.half));
				if (typeof chosen === "string") chords[tk.bar][tk.half] = chosen;
				else {
					chords[tk.bar][0] = chosen[0];
					chords[tk.bar][1] = chosen[1];
				}
				substituted++;
				done = true;
				break;
			}
			if (!done) {
				unresolvedRuns++;
				break;
			}
		}
		spliced.set(kind, {
			kind,
			bars,
			donor,
			bassDonor,
			chords,
			figures,
			rhythm,
			sameAs,
			rhythmSameAs,
			layers,
			substituted,
			eligible,
			unresolvedRuns,
		});
		placed.push({ kind, startBar: cursor, bars, restatement: false });
		cursor += bars;
	}
	const totalBars = cursor;
	// イントロとサビの両方がある曲だけ抽選する（無い曲の乱数列を変えない）。和音だけ写し、
	// リズム・ベースの型・層はイントロの donor のまま。
	const introSec = spliced.get("intro");
	const chorusSec = spliced.get("chorus");
	const introFromChorus =
		introSec !== undefined &&
		chorusSec !== undefined &&
		rnd() < INTRO_FROM_CHORUS_P;
	if (introSec && chorusSec && introFromChorus)
		for (let i = 0; i < introSec.bars; i++)
			introSec.chords[i] = [...chorusSec.chords[i % chorusSec.bars]];

	// --- 4. ラスサビの転調（短3度上。以降の全セクションに掛ける） ---
	let lastChorus = -1;
	for (let i = 0; i < placed.length; i++)
		if (placed[i].kind === "chorus") lastChorus = i;
	const keyShiftOfSection: number[] = placed.map(() => 0);
	if (lastChorus >= 0 && rnd() < KEY_SHIFT_P)
		for (let i = lastChorus; i < placed.length; i++)
			keyShiftOfSection[i] = KEY_SHIFT;
	// 同種のセクション（再現）に掛かる転調量の幅。歌の窓と折り返しを両方で収める。
	const shiftRangeOfKind = new Map<BankSection["kind"], [number, number]>();
	placed.forEach((sec, i) => {
		const k = keyShiftOfSection[i];
		const r = shiftRangeOfKind.get(sec.kind) ?? [k, k];
		shiftRangeOfKind.set(sec.kind, [Math.min(r[0], k), Math.max(r[1], k)]);
	});

	// --- 5. 小節ごとの設計図へ展開（基準調の和音名のまま） ---
	// ベースの "other" はその donor で最も多い具体の型、無ければ曲で最も多い型（無ければ 8分オクターブ）。
	// 歌うセクションで donor が全小節 rest なら同じ型で埋める——歌う区間のベース無音は界隈曲の形から外れる。
	const songFigure = mostFrequentFigure(
		[...spliced.values()].flatMap((sp) => sp.figures),
		"octave8",
	);
	const chordAt: [string, string][] = [];
	const figureAt: BassFigure[] = [];
	const fitBars: FitBar[] = [];
	const padBars = new Set<number>();
	const keyShiftAt: number[] = new Array(totalBars).fill(0);
	const sectionAt: number[] = new Array(totalBars).fill(0);
	const centerRelAt: number[] = new Array(totalBars).fill(12);
	const firstStartOf = new Map<BankSection["kind"], number>();
	const centerOfKind = new Map<BankSection["kind"], number>();
	let prevCenter: number | null = null;
	let prevChord = minor ? "Am" : "C";
	placed.forEach((sec, idx) => {
		const sp = spliced.get(sec.kind) as SplicedSection;
		const concrete = mostFrequentFigure(sp.figures, songFigure);
		const silent = sp.figures.every((f) => f === "rest" || f === "other");
		const fillRest = silent && isSungKind(sec.kind);
		const firstStart = firstStartOf.get(sec.kind);
		if (firstStart === undefined) firstStartOf.set(sec.kind, sec.startBar);
		// 音域の中心は donor の値を、直前のセクションから ±CENTER_STEP_MAX に挟む（再現は1回目と同じ）。
		let center = centerOfKind.get(sec.kind);
		if (center === undefined) {
			center = sp.donor.melodyCenterRel;
			if (prevCenter !== null)
				center = Math.min(
					prevCenter + CENTER_STEP_MAX,
					Math.max(prevCenter - CENTER_STEP_MAX, center),
				);
			centerOfKind.set(sec.kind, center);
		}
		prevCenter = center;
		for (let i = 0; i < sec.bars; i++) {
			const b = sec.startBar + i;
			const [c0, c1] = sp.chords[i];
			const a = c0 ?? prevChord;
			const z = c1 ?? a;
			chordAt.push([a, z]);
			prevChord = z;
			const fig = sp.figures[i];
			figureAt.push(
				fig === "other" || (fig === "rest" && fillRest) ? concrete : fig,
			);
			keyShiftAt[b] = keyShiftOfSection[idx];
			sectionAt[b] = idx;
			centerRelAt[b] = center;
			if (sp.layers[i].pad) padBars.add(b);
			const r = sp.rhythm[i];
			if (!r) {
				fitBars.push(null);
				continue;
			}
			// 2回目以降は1回目の同じ小節を写す（restatement）。
			if (sec.restatement && firstStart !== undefined)
				fitBars.push({ rhythm: r, sameAs: firstStart + i, rhythmSameAs: null });
			else
				fitBars.push({
					rhythm: r,
					sameAs:
						sp.sameAs[i] === null
							? null
							: sec.startBar + (sp.sameAs[i] as number),
					rhythmSameAs:
						sp.rhythmSameAs[i] === null
							? null
							: sec.startBar + (sp.rhythmSameAs[i] as number),
				});
		}
	});
	// 曲全体が rest しか無いときも埋める。
	const allRest = !figureAt.some((f) => f !== "rest");
	if (allRest) for (let b = 0; b < totalBars; b++) figureAt[b] = songFigure;
	const shiftAt = (b: number): number => rootShift + (keyShiftAt[b] ?? 0);
	const foldRangeAt = (b: number): [number, number] => {
		const r = shiftRangeOfKind.get(placed[sectionAt[b]].kind) ?? [0, 0];
		return [rootShift + r[0], rootShift + r[1]];
	};

	// --- 6. ドラムと刻み（最初に歌うセクションの donor。1曲1パターン） ---
	const firstSung =
		placed.find((p) =>
			(spliced.get(p.kind) as SplicedSection).rhythm.some((r) => r !== null),
		) ?? placed[0];
	const lead = spliced.get(firstSung.kind) as SplicedSection;
	const drum =
		lead.donor.drum !== "none" ? lead.donor.drum : pick(DRUM_FALLBACK, rnd);
	const chordPattern: ChordPatternType =
		lead.donor.chordPattern === "arpeggio" ||
		lead.donor.chordPattern === "arpeggio-fast"
			? "block"
			: lead.donor.chordPattern;

	// --- 7. 主旋律（他曲の実在フレーズを当てる） ---
	const tonic = TONIC_MIDI[mode];
	// 窓の中心（基準調の半音）。再現が後で転調する（ラスサビ +3）ぶんだけ上端を下げておき、
	// 1番サビとラスサビが同じオクターブに乗るようにする。
	const centerBasisAt = (b: number): number => {
		const [lo, hi] = foldRangeAt(b);
		const centerFinal = Math.min(
			MELODY_HIGH - MELODY_WINDOW / 2 - (hi - shiftAt(b)),
			Math.max(
				MELODY_LOW + MELODY_WINDOW / 2 + (shiftAt(b) - lo),
				tonic + shiftAt(b) + centerRelAt[b],
			),
		);
		return centerFinal - shiftAt(b);
	};
	const absDeg = fitPhrases(fitBars, scale, centerBasisAt, chordAt, rnd);
	const { melody, melodyDurations, restSteps, sungBars } = renderFittedMelody(
		fitBars,
		absDeg,
		scale,
		shiftAt,
		stepsPerBar,
		edo,
		foldRangeAt,
	);

	// --- 8. ベース（型テンプレート × その時点の和音ルート。移調後の実音で組む） ---
	const bass: ComposedNote[] = [];
	for (let b = 0; b < totalBars; b++) {
		const roots = chordAt[b].map((name) => {
			let r = 36 + rootPcOf(name) + shiftAt(b);
			while (r > bassRootLow + 11) r -= 12;
			while (r < bassRootLow) r += 12;
			return r;
		}) as [number, number];
		for (const ev of realizeBass(figureAt[b], roots))
			bass.push({
				startStep: b * stepsPerBar + Math.abs(scaleStep(ev.step)),
				pitchUnits: semitonesToUnits(ev.semi, edo) as Units,
				durationSteps: Math.abs(scaleStep(ev.dur)),
				velocity: ev.step === 0 ? 112 : ev.step % 48 === 0 ? 98 : 86,
			});
	}

	// --- 9. 層：アルペジオはラスサビだけ、パッドは donor どおり ---
	const baseProgression = chordAt
		.map(([a, z]) => (a === z ? a : `${a} ${z}`))
		.join("|");
	const arpBars = new Set<number>();
	if (lastChorus >= 0) {
		const sec = placed[lastChorus];
		for (let i = 0; i < sec.bars; i++) arpBars.add(sec.startBar + i);
	}
	const submelody = buildArpLayer(
		arpBars,
		baseProgression,
		melody,
		stepsPerBar,
		edo,
		rnd,
	);
	const pad = buildPadLayer(padBars, chordAt, stepsPerBar, edo);

	// --- 移調（調は曲全体、転調は小節ごと） ---
	for (const list of [melody, submelody, pad])
		for (const n of list) {
			const b = Math.floor(n.startStep / stepsPerBar);
			const units = semitonesToUnits(shiftAt(b), edo);
			if (units !== 0) n.pitchUnits = (n.pitchUnits + units) as Units;
		}
	// 進行は基準調のまま返し（消費側が rootShift で移調する）、転調した小節だけ和音名を動かす。
	const chordProgression = chordAt
		.map(([a, z], b) => {
			const k = keyShiftAt[b];
			const a2 = transposeChordName(a, k);
			const z2 = transposeChordName(z, k);
			return a2 === z2 ? a2 : `${a2} ${z2}`;
		})
		.join("|");

	// --- 10. セクションと検算値 ---
	const sections: PlacedSection[] = placed.map((p, i) => ({
		kind: p.kind,
		startBar: p.startBar,
		bars: p.bars,
		spec: SECTION_SPECS[p.kind],
		keyShift: keyShiftOfSection[i],
		restatement: p.restatement,
	}));
	const base = {
		chordProgression,
		chordPattern,
		rootShift,
		keyName: resolvedKey.keyName,
		keyLabel: resolvedKey.keyLabel,
		scaleId: scale.id,
		scaleLabel: scale.label,
		form: "splice" as const,
		moodLabel: resolvedKey.moodLabel,
		bpm,
		sections,
		bars: totalBars,
		vocal: EMPTY_VOCAL,
		tonal: EMPTY_TONAL,
		melody,
		submelody,
		bass,
		harmony: [],
		harmony2: [],
		octave: [],
		pad,
		solo: [],
	};
	const { stats } = evaluate(
		{
			...base,
			...fittedDrawStats({
				melody,
				submelody,
				melodyDurations,
				restSteps,
				sungBars,
				scale,
				shiftAt,
				totalBars,
				stepsPerBar,
			}),
		},
		options.recent ?? [],
	);
	let substituted = 0;
	let eligible = 0;
	let unresolvedRuns = 0;
	for (const sp of spliced.values()) {
		substituted += sp.substituted;
		eligible += sp.eligible;
		unresolvedRuns += sp.unresolvedRuns;
	}
	const sectionOf = (p: (typeof placed)[number]): SplicedSection =>
		spliced.get(p.kind) as SplicedSection;
	return {
		...base,
		drum,
		instrument,
		lyricWords: template.lyricWords,
		arrange: {
			backing: [{ pattern: chordPattern, sections: null, octave: 0 }],
			sparkle: null,
			padSections: padSectionsOf(padBars, sections),
			lead: null,
			bassLayer: null,
		},
		stats: { ...stats, attempts: 1, rejected: 0 },
		spliceSources: placed.map((p) => sectionOf(p).donor.src),
		spliceStats: {
			substituted,
			eligible,
			unresolvedRuns,
			keyShift: keyShiftOfSection[keyShiftOfSection.length - 1] ?? 0,
			figures: figureAt,
			bassSources: placed.map((p) => sectionOf(p).bassDonor.src),
			introFromChorus,
		},
	};
};
