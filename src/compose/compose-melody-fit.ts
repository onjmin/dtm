/**
 * 「リズムと反復の地図に、2小節素材（呼び出し側が渡す）の音を当てる」歌メロの共有部。
 * 骨格借用（{@link file://./compose-skeleton.ts}）と継ぎ合わせ（{@link file://./compose-splice.ts}）の
 * 両エンジンがここを呼ぶ。アルペジオ・パッドの層もここに置く。
 *
 * 乱数は `fitPhrases` が楽句ごとに（同率のフレーズの抽選・±1度ずらしの向き）、`buildArpLayer` が
 * 形と強さで引く。骨格借用の黄金値を変えないため、消費の順と回数は compose-skeleton.ts から
 * 切り出した時点のまま。
 */

import { parseChord } from "@onjmin/chord-parser";
import {
	UNITS_PER_OCTAVE,
	UNITS_PER_SEMITONE,
	type Units,
} from "../audio/tuning";
import { buildChordPlacements, spelledToUnits } from "../chord/chords";
import {
	type ChordTone,
	type ComposedNote,
	type ComposeResult,
	chordTones,
	clampSemi,
	MELODY_HIGH,
	MELODY_LOW,
	nearestChordTone,
	omitDegrees,
} from "./compose";
import type { CorpusPhrase } from "./phrase-types";
import {
	type ComposeScale,
	degreeToPitch,
	scalePcs,
	scaleSize,
	semitoneToDegree,
} from "./compose-scales";
import type { PlacedSection, SectionKind } from "./compose-sections";

/** 1小節のステップ数（skeleton-types.ts の基準）。compose.ts の値をここで読むと循環 import の初期化順で落ちる。 */
const BASE_STEPS_PER_BAR = 192;

/** 歌う小節の設計図。歌わない小節は null。sameAs / rhythmSameAs は曲頭からの絶対小節番号。 */
export type FitBar = {
	rhythm: number[];
	sameAs: number | null;
	rhythmSameAs: number | null;
} | null;

// ============================================================
// フレーズの引き当て
// ============================================================

/** 2小節（384ステップ）を16分の格子32枠で見た指紋。 */
type RhythmGrid = { onsets: Set<number>; mask: Uint8Array };

const GRID = 32;
const GRID_STEP = (BASE_STEPS_PER_BAR * 2) / GRID;

const gridOf = (rhythm: number[]): RhythmGrid => {
	const onsets = new Set<number>();
	const mask = new Uint8Array(GRID);
	let at = 0;
	for (const v of rhythm) {
		const len = Math.abs(v);
		if (v > 0) {
			const from = Math.round(at / GRID_STEP);
			const to = Math.round((at + len) / GRID_STEP);
			onsets.add(Math.min(GRID - 1, from));
			for (let g = from; g < Math.min(GRID, Math.max(from + 1, to)); g++)
				mask[g] = 1;
		}
		at += len;
	}
	return { onsets, mask };
};

/** 一致率。完全一致は 2（何より優先）、それ以外はオンセットの Jaccard 0.7 ＋ 鳴っている枠の一致 0.3。 */
const similarity = (a: number[], ga: RhythmGrid, p: CorpusPhrase): number => {
	if (a.length === p.rhythm.length && a.every((v, i) => v === p.rhythm[i]))
		return 2;
	const gb = phraseGrid(p);
	let inter = 0;
	for (const o of ga.onsets) if (gb.onsets.has(o)) inter++;
	const union = ga.onsets.size + gb.onsets.size - inter;
	const jac = union === 0 ? 1 : inter / union;
	let agree = 0;
	for (let g = 0; g < GRID; g++) if (ga.mask[g] === gb.mask[g]) agree++;
	return jac * 0.7 + (agree / GRID) * 0.3;
};

const PHRASE_GRIDS = new Map<CorpusPhrase, RhythmGrid>();
const phraseGrid = (p: CorpusPhrase): RhythmGrid => {
	const hit = PHRASE_GRIDS.get(p);
	if (hit) return hit;
	const g = gridOf(p.rhythm);
	PHRASE_GRIDS.set(p, g);
	return g;
};

/** オンセット位置の列（192基準のステップ）。 */
export const onsetsOf = (rhythm: number[]): number[] => {
	const out: number[] = [];
	let at = 0;
	for (const v of rhythm) {
		if (v > 0) out.push(at);
		at += Math.abs(v);
	}
	return out;
};

/**
 * 素材の度数を目標のリズムへ写す。音数が違うときは、各オンセットに最も近い素材の音の度数を取る
 * （同じリズムなら恒等）。
 */
export const mapByOnset = (
	targetOnsets: number[],
	srcOnsets: number[],
	srcDegrees: number[],
): number[] => {
	if (srcOnsets.length === 0) return targetOnsets.map(() => 0);
	return targetOnsets.map((t) => {
		let best = 0;
		let bestDist = Number.POSITIVE_INFINITY;
		for (let i = 0; i < srcOnsets.length; i++) {
			const d = Math.abs(srcOnsets[i] - t);
			if (d < bestDist) {
				bestDist = d;
				best = i;
			}
		}
		return srcDegrees[Math.min(best, srcDegrees.length - 1)] ?? 0;
	});
};

const sameDegrees = (a: number[], b: number[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 度数列を、窓の中心へ最も寄る位置へ持ち上げる。中央値で合わせる——平均だと1音の跳躍で
 * 塊ごと動く。`stride` は持ち上げ幅の単位：相対度数（1音目=0）なら 1、絶対度数（元曲の
 * 度数をそのまま使う対照）ならオクターブ＝音階の音数。
 */
export const anchorDegrees = (
	scale: ComposeScale,
	rel: number[],
	centerSemi: number,
	stride = 1,
): number[] => {
	if (rel.length === 0) return [];
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	// 絶対度数は元曲の音域そのまま（C2 付近なら -17 前後）なので、走査は9オクターブぶん取る。
	for (let a = -35; a <= 98; a += stride) {
		const semis = rel
			.map((d) => degreeToPitch(scale, a + d).semi)
			.sort((x, y) => x - y);
		const median = semis[semis.length >> 1];
		const dist = Math.abs(median - centerSemi);
		if (dist < bestDist) {
			bestDist = dist;
			best = a;
		}
	}
	return rel.map((d) => best + d);
};

/**
 * 強拍（小節頭と半小節頭＝和音の変わり目）の音を、その和音の構成音へ最寄りで寄せる。
 * 借りたフレーズは和音を知らないので、そのままだと強拍の半音衝突が元曲より多い
 * （生成 40 曲の実測: 構成音 41.8% / 元曲 55.1%）。動かすのは強拍だけ——弱拍まで寄せると
 * フレーズの形（他曲の実在の旋律）が消える。音階の外・省く度数（四抜きのファ）へは寄せない。
 */
const alignStrongBeats = (
	scale: ComposeScale,
	degrees: number[],
	onsets: number[],
	bar: number,
	chordAt: [string, string][],
): void => {
	const pcs = scalePcs(scale);
	const size = scaleSize(scale);
	const half = BASE_STEPS_PER_BAR / 2;
	for (let i = 0; i < degrees.length; i++) {
		const at = onsets[i];
		if (at === undefined || at % half !== 0) continue;
		const b = bar + Math.floor(at / BASE_STEPS_PER_BAR);
		const names = chordAt[b];
		if (!names) continue;
		const tones: ChordTone[] = chordTones(
			names[(at % BASE_STEPS_PER_BAR) / half],
		);
		if (tones.length === 0) continue;
		const semi = degreeToPitch(scale, degrees[i]).semi;
		const pcOf = (v: number): number => ((v % 12) + 12) % 12;
		if (tones.some((t) => pcOf(t.semi) === pcOf(semi))) continue;
		let best: number | null = null;
		let bestDist = Number.POSITIVE_INFINITY;
		for (const t of tones) {
			const tpc = pcOf(t.semi);
			if (!pcs.has(tpc)) continue;
			for (const delta of [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6]) {
				if (pcOf(semi + delta) !== tpc) continue;
				const deg = semitoneToDegree(scale, semi + delta);
				if (scale.omit?.includes(((deg % size) + size) % size)) continue;
				const dist = Math.abs(delta);
				if (dist < bestDist) {
					bestDist = dist;
					best = deg;
				}
			}
		}
		if (best !== null) degrees[i] = best;
	}
};

/** sameAs 連鎖の先頭。歌わない小節や後ろ向きでない参照は自分自身。 */
export const headOfBar = (bars: FitBar[], b: number): number => {
	let h = b;
	const seen = new Set<number>();
	for (;;) {
		const s = bars[h]?.sameAs ?? null;
		if (s === null || s >= h || !bars[s] || seen.has(s)) return h;
		seen.add(h);
		h = s;
	}
};

/**
 * 全小節のリズムと反復の地図に、`phrases` の素材の度数を当てる。
 * 楽句グループの先頭で2小節ぶんのフレーズを引き（次の小節が独立の楽句でなければ結合）、
 * sameAs の小節は連鎖の先頭を写し、rhythmSameAs の小節は参照先と同じ度数列を避ける。
 * 強拍は構成音へ寄せる（{@link alignStrongBeats}）。`centerBasisAt` は小節ごとの窓の中心（基準調の半音）。
 */
export const fitPhrases = (
	bars: FitBar[],
	scale: ComposeScale,
	centerBasisAt: (bar: number) => number,
	chordAt: [string, string][],
	rnd: () => number,
	phrases: CorpusPhrase[],
): (number[] | null)[] => {
	const n = bars.length;
	const absDeg: (number[] | null)[] = new Array(n).fill(null);
	const usedPhrase: (CorpusPhrase | null)[] = new Array(n).fill(null);
	const sung = (b: number): FitBar => (b >= 0 && b < n ? bars[b] : null);
	const headOf = (b: number): number => headOfBar(bars, b);
	for (let b = 0; b < n; b++) {
		const m = sung(b);
		if (!m || absDeg[b]) continue;
		const head = headOf(b);
		if (head !== b && absDeg[head]) {
			const src = sung(head);
			absDeg[b] = mapByOnset(
				onsetsOf(m.rhythm),
				onsetsOf(src?.rhythm ?? m.rhythm),
				absDeg[head] as number[],
			);
			usedPhrase[b] = usedPhrase[head];
			continue;
		}
		// 楽句グループの先頭。次の小節が独立の楽句でなければ2小節ぶんでフレーズを引く。
		const next = sung(b + 1);
		const joinNext =
			next !== null &&
			!absDeg[b + 1] &&
			headOf(b + 1) === b + 1 &&
			(bars[b + 1]?.rhythmSameAs ?? null) === null;
		const rhythm2 = joinNext
			? [...m.rhythm, ...(next as NonNullable<typeof next>).rhythm]
			: [...m.rhythm, -BASE_STEPS_PER_BAR];
		const grid = gridOf(rhythm2);
		// リズムだけ同じ先行小節があれば、そのフレーズ（と同じ度数列）は避ける。
		const avoidBar = bars[b]?.rhythmSameAs ?? null;
		const avoid =
			avoidBar !== null ? (usedPhrase[headOf(avoidBar)] ?? null) : null;
		let bestSim = -1;
		let ties: CorpusPhrase[] = [];
		for (const p of phrases) {
			const s = similarity(rhythm2, grid, p);
			if (s > bestSim + 1e-9) {
				bestSim = s;
				ties = [p];
			} else if (Math.abs(s - bestSim) <= 1e-9) ties.push(p);
		}
		let phrase: CorpusPhrase;
		let shift = 0;
		const distinct = avoid
			? ties.filter(
					(p) => p !== avoid && !sameDegrees(p.degrees, avoid.degrees),
				)
			: ties;
		if (distinct.length > 0) {
			// 同率は出現回数で重み付けして引く。
			const total = distinct.reduce((a, p) => a + p.weight, 0);
			let ticket = rnd() * total;
			phrase = distinct[distinct.length - 1];
			for (const p of distinct) {
				ticket -= p.weight;
				if (ticket <= 0) {
					phrase = p;
					break;
				}
			}
		} else {
			// 同じリズムで度数違いが無い：同じフレーズを音階内で ±1 度ずらす。
			phrase = avoid ?? ties[0];
			shift = rnd() < 0.5 ? -1 : 1;
		}
		const targetOnsets = onsetsOf(rhythm2);
		const rel = mapByOnset(
			targetOnsets,
			onsetsOf(phrase.rhythm),
			phrase.degrees,
		).map((d) => d + shift);
		const prevLast = b > 0 ? (absDeg[b - 1]?.at(-1) ?? null) : null;
		const abs = anchorDegrees(scale, rel, centerBasisAt(b));
		omitDegrees(scale, abs, prevLast);
		alignStrongBeats(scale, abs, targetOnsets, b, chordAt);
		const n1 = onsetsOf(m.rhythm).length;
		absDeg[b] = abs.slice(0, n1);
		usedPhrase[b] = phrase;
		if (joinNext) {
			absDeg[b + 1] = abs.slice(n1);
			usedPhrase[b + 1] = phrase;
		}
	}
	return absDeg;
};

// ============================================================
// 音符化
// ============================================================

/**
 * 度数列を音符にする（基準調のまま。移調は呼び出し側が最後に掛ける）。歌える帯（MELODY_LOW〜HIGH、
 * 移調後の実音）へ収める——窓は中心を寄せるだけなので、幅の広いフレーズや中心の端寄せで外れる音が
 * ある。まず小節ごとオクターブで折り返し（形を保つ）、それでも収まらない小節だけ音単位で折り返す。
 * `shiftAt` は「その小節に後から掛かる移調量」（調＋セクションの転調）。`foldRangeAt` はその小節と
 * その再現（同じ度数列を写す小節）に掛かる移調量の [最小, 最大]——1番サビとラスサビ(+3) が同じ
 * オクターブへ折り返るように、両方の移調量で帯に収まる位置を選ぶ。省けば shiftAt そのもの。
 */
export const renderFittedMelody = (
	bars: FitBar[],
	absDeg: (number[] | null)[],
	scale: ComposeScale,
	shiftAt: (bar: number) => number,
	stepsPerBar: number,
	edo: 12 | 31,
	foldRangeAt: (bar: number) => [number, number] = (b) => [
		shiftAt(b),
		shiftAt(b),
	],
): {
	melody: ComposedNote[];
	melodyDurations: number[];
	restSteps: number;
	sungBars: number;
} => {
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);
	const melody: ComposedNote[] = [];
	const melodyDurations: number[] = [];
	let restSteps = 0;
	let sungBars = 0;
	const quarter = Math.round(stepsPerBar / 4);
	for (let b = 0; b < bars.length; b++) {
		const m = bars[b];
		const degs = absDeg[b];
		if (!m || !degs) continue;
		sungBars++;
		const [shiftLo, shiftHi] = foldRangeAt(b);
		const pitches = degs.map((d) => degreeToPitch(scale, d));
		const fits = (by: number): boolean =>
			pitches.every(
				(p) =>
					p.semi + by + shiftLo >= MELODY_LOW &&
					p.semi + by + shiftHi <= MELODY_HIGH,
			);
		const barShift = fits(0) ? 0 : fits(12) ? 12 : fits(-12) ? -12 : 0;
		let at = b * stepsPerBar;
		let k = 0;
		for (const v of m.rhythm) {
			const len = Math.abs(scaleStep(v));
			if (v > 0) {
				const p = pitches[Math.min(k, pitches.length - 1)];
				let semi = p.semi + barShift;
				while (semi + shiftLo < MELODY_LOW) semi += 12;
				while (semi + shiftHi > MELODY_HIGH) semi -= 12;
				melody.push({
					startStep: at,
					pitchUnits: spelledToUnits(semi, p.fifth, edo),
					durationSteps: len,
					velocity: (at - b * stepsPerBar) % quarter === 0 ? 96 : 84,
				});
				melodyDurations.push(len);
				k++;
			} else restSteps += len;
			at += len;
		}
	}
	return { melody, melodyDurations, restSteps, sungBars };
};

// ============================================================
// 層：アルペジオ（arp）とパッド（pad）。基準調で組む（移調は呼び出し側）。
// ============================================================

/**
 * arp 小節に、進行の構成音を16分で回すアルペジオを置く（主旋律の最高音より上）。
 * 乱数は 形 → 強さ の順に2回（arp 小節が無ければ引かない）。
 */
export const buildArpLayer = (
	arpBars: Set<number>,
	chordProgression: string,
	melody: ComposedNote[],
	stepsPerBar: number,
	edo: 12 | 31,
	rnd: () => number,
): ComposedNote[] => {
	const submelody: ComposedNote[] = [];
	if (arpBars.size === 0) return submelody;
	const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
	const arpShape = pick<"up" | "updown" | "down">([
		"up",
		"up",
		"updown",
		"down",
	]);
	const arpVelocity = 60 + Math.round(rnd() * 18);
	const arpFloor =
		melody.length > 0
			? melody.reduce((mx, n) => Math.max(mx, n.pitchUnits), 0)
			: 6 * UNITS_PER_OCTAVE;
	const groups = new Map<number, { end: number; tones: number[] }>();
	for (const p of buildChordPlacements({
		edo,
		chordStr: chordProgression,
		patternType: "block",
		rootShift: 0,
		bpm: 120,
		stepsPerBar,
	})) {
		const g = groups.get(p.startStep) ?? {
			end: p.startStep + p.durationSteps,
			tones: [],
		};
		g.tones.push(p.pitchUnits);
		groups.set(p.startStep, g);
	}
	const sixteenth = Math.max(
		1,
		Math.round(((BASE_STEPS_PER_BAR / 16) * stepsPerBar) / BASE_STEPS_PER_BAR),
	);
	for (const [start, g] of [...groups].sort((x, y) => x[0] - y[0])) {
		if (!arpBars.has(Math.floor(start / stepsPerBar))) continue;
		const tones = [
			...new Set(
				g.tones.map(
					(t) =>
						arpFloor +
						((((t - arpFloor) % UNITS_PER_OCTAVE) + UNITS_PER_OCTAVE) %
							UNITS_PER_OCTAVE),
				),
			),
		]
			.sort((x, y) => x - y)
			.slice(0, 4);
		let len = 1;
		while (len < tones.length) len *= 2;
		const cycle: number[] = [];
		for (let i = 0; i < len; i++) cycle.push(i);
		if (arpShape === "updown") for (let i = len - 2; i >= 1; i--) cycle.push(i);
		if (arpShape === "down") cycle.reverse();
		for (let at = start, i = 0; at + sixteenth <= g.end; at += sixteenth, i++) {
			const idx = cycle[i % cycle.length];
			submelody.push({
				startStep: at,
				pitchUnits: (tones[idx % tones.length] +
					Math.floor(idx / tones.length) * UNITS_PER_OCTAVE) as Units,
				durationSteps: sixteenth,
				velocity: arpVelocity,
			});
		}
	}
	return submelody;
};

/** pad 小節に、その小節の頭の和音の構成音を全音符で1つ置く（歌の帯の上端あたり）。 */
export const buildPadLayer = (
	padBars: Set<number>,
	chordAt: [string, string][],
	stepsPerBar: number,
	edo: 12 | 31,
): ComposedNote[] => {
	const pad: ComposedNote[] = [];
	for (const b of [...padBars].sort((x, y) => x - y)) {
		const tones = chordTones(chordAt[b][0]);
		if (tones.length === 0) continue;
		const tone = nearestChordTone(MELODY_HIGH + 2, tones, 2);
		const semi = clampSemi(tone.semi, MELODY_HIGH - 4, MELODY_HIGH + 8);
		pad.push({
			startStep: b * stepsPerBar,
			pitchUnits: spelledToUnits(semi, tone.fifth, edo),
			durationSteps: stepsPerBar,
			velocity: 62,
		});
	}
	return pad;
};

// ============================================================
// 両エンジンで同じ小物（乱数は消費しない）
// ============================================================

export const pick = <T>(items: T[], rnd: () => number): T =>
	items[Math.floor(rnd() * items.length)];

/** 主旋律の窓幅（半音）。中心 ±7。 */
export const MELODY_WINDOW = 14;

/** 和音名のルートのピッチクラス。読めなければ 0。 */
export const rootPcOf = (name: string): number => {
	try {
		const r = parseChord(name).notes[0] ?? 0;
		return ((r % 12) + 12) % 12;
	} catch {
		return 0;
	}
};

export const EMPTY_VOCAL: ComposeResult["vocal"] = {
	duetSpans: [],
	duetStyle: "none",
	harmonyKinds: [],
	harmony2: false,
	octaveLayer: false,
};
export const EMPTY_TONAL: ComposeResult["tonal"] = {
	relativeKinds: [],
	relativeShift: 0,
	floating: false,
};

/** pad を置いた小節が属するセクションの種類（arrange.padSections）。 */
export const padSectionsOf = (
	padBars: Set<number>,
	sections: PlacedSection[],
): SectionKind[] => {
	const kindOfBar = (b: number): SectionKind | null =>
		sections.find((s) => b >= s.startBar && b < s.startBar + s.bars)?.kind ??
		null;
	return [
		...new Set(
			[...padBars].map(kindOfBar).filter((k): k is SectionKind => k !== null),
		),
	];
};

/**
 * 当てた歌メロから `evaluate`（compose.ts）に渡す検算値を作る。共通経路の Draw と同じ材料
 * （跳躍・順次進行・音階外・音域・小節ごとの緊張）。`shiftAt` は小節ごとの移調量（音階外の判定で戻す）。
 */
export const fittedDrawStats = (args: {
	melody: ComposedNote[];
	submelody: ComposedNote[];
	melodyDurations: number[];
	restSteps: number;
	sungBars: number;
	scale: ComposeScale;
	shiftAt: (bar: number) => number;
	totalBars: number;
	stepsPerBar: number;
}): {
	melodyDurations: number[];
	restSteps: number;
	bassStyle: "octave";
	totalSteps: number;
	maxLeap: number;
	leapRatio: number;
	stepRatio: number;
	chromaticRatio: number;
	melodyRange: number;
	submelodyRange: number;
	barTension: number[];
	stepsPerBar: number;
} => {
	const { melody, submelody, scale, shiftAt, totalBars, stepsPerBar } = args;
	const semis = melody.map((n) => n.pitchUnits / UNITS_PER_SEMITONE);
	let maxLeap = 0;
	let leaps = 0;
	let steps = 0;
	let intervals = 0;
	for (let i = 1; i < semis.length; i++) {
		const d = Math.abs(semis[i] - semis[i - 1]);
		if (d === 0) continue;
		intervals++;
		if (d >= 3) leaps++;
		else steps++;
		maxLeap = Math.max(maxLeap, d);
	}
	const pcs = scalePcs(scale);
	const chromaticNotes = melody.filter((n) => {
		const b = Math.floor(n.startStep / stepsPerBar);
		const s = Math.round(n.pitchUnits / UNITS_PER_SEMITONE) - shiftAt(b);
		return !pcs.has(((s % 12) + 12) % 12);
	}).length;
	const range = (ns: ComposedNote[]): number =>
		ns.length === 0
			? 0
			: (Math.max(...ns.map((n) => n.pitchUnits)) -
					Math.min(...ns.map((n) => n.pitchUnits))) /
				UNITS_PER_SEMITONE;
	const lo = semis.length > 0 ? Math.min(...semis) : 0;
	const span = Math.max(1, range(melody));
	const barTension: number[] = [];
	for (let b = 0; b < totalBars; b++) {
		const inBar = melody.filter(
			(n) =>
				n.startStep >= b * stepsPerBar && n.startStep < (b + 1) * stepsPerBar,
		);
		barTension.push(
			inBar.length === 0
				? 0
				: (inBar.reduce((a, n) => a + n.pitchUnits / UNITS_PER_SEMITONE, 0) /
						inBar.length -
						lo) /
						span,
		);
	}
	return {
		melodyDurations: args.melodyDurations,
		restSteps: args.restSteps,
		bassStyle: "octave",
		totalSteps: Math.max(1, args.sungBars) * stepsPerBar,
		maxLeap,
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		stepRatio: intervals === 0 ? 0 : steps / intervals,
		chromaticRatio: melody.length === 0 ? 0 : chromaticNotes / melody.length,
		melodyRange: range(melody),
		submelodyRange: range(submelody),
		barTension,
		stepsPerBar,
	};
};
