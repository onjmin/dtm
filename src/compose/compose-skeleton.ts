/**
 * 骨格借用の生成エンジン。所有者の耳コピ MIDI から抜いた設計図（{@link Skeleton}）を1つ引き、
 * 調だけ変えて、和音・ベース・ドラム・層の配置は骨格どおりに置く。歌メロは骨格のリズムと
 * 反復の地図（sameAs / rhythmSameAs）に沿って、**他の曲の実在フレーズ**（{@link CORPUS_PHRASES}）
 * の音を当てる。元曲の旋律の音そのものは既定では使わない（`melodySource: "original"` は対照用）。
 *
 * `composeSong` の共通経路とは乱数を共有しない——テンプレートの `engine: "skeleton"` で
 * 先頭から分岐する（{@link file://./compose.ts}）。ここで引く乱数の順は
 * 骨格 → 調 → 楽器 → 楽句ごとのフレーズ → アルペジオの形・強さ。
 */

import { parseChord } from "@onjmin/chord-parser";
import {
	UNITS_PER_OCTAVE,
	UNITS_PER_SEMITONE,
	type Units,
} from "../audio/tuning";
import {
	buildChordPlacements,
	semitonesToUnits,
	spelledToUnits,
} from "../chord/chords";
import { DRUM_PATTERNS, NO_DRUM_PATTERN } from "../instruments/drum-config";
import {
	type ChordTone,
	type ComposedNote,
	type ComposeOptions,
	type ComposeResult,
	chordTones,
	clampSemi,
	evaluate,
	MELODY_HIGH,
	MELODY_LOW,
	nearestChordTone,
	omitDegrees,
} from "./compose";
import { resolveComposeKey } from "./compose-keys";
import { CORPUS_PHRASES, type CorpusPhrase } from "./compose-phrases";
import {
	type ComposeScale,
	degreeToPitch,
	resolveComposeScale,
	scalePcs,
	scaleSize,
	semitoneToDegree,
} from "./compose-scales";
import {
	type PlacedSection,
	SECTION_SPECS,
	type SectionKind,
	type StructureTemplate,
} from "./compose-sections";
import { type Skeleton, usableSkeletons } from "./skeleton-types";

/** 骨格の1小節のステップ数（skeleton-types.ts の基準）。compose.ts の値をここで読むと循環 import の初期化順で落ちる。 */
const BASE_STEPS_PER_BAR = 192;

const pick = <T>(items: T[], rnd: () => number): T =>
	items[Math.floor(rnd() * items.length)];

/** 骨格の和音の既定（先頭が継続 null のとき）。 */
const TONIC_CHORD = { minor: "Am", major: "C" } as const;

/** ベースの音域（MIDI）。外れたらオクターブで畳む。 */
const BASS_LOW = 24;
const BASS_HIGH = 60;
/** 根音を置くオクターブの底。根音の pc を足して 36〜47 に置き、rel を掛ける。 */
const BASS_ROOT_FLOOR = 36;

/** 主旋律の窓幅（半音）。中心 ±7。 */
const MELODY_WINDOW = 14;

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
const onsetsOf = (rhythm: number[]): number[] => {
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
const mapByOnset = (
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
const anchorDegrees = (
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

// ============================================================
// 生成
// ============================================================

export const composeSkeleton = (
	options: ComposeOptions,
	template: StructureTemplate,
	skeletons: Skeleton[],
): ComposeResult => {
	const pool = usableSkeletons(skeletons);
	if (pool.length === 0)
		throw new Error("composeSkeleton: 使える骨格が1つも無い");
	const rnd = options.random ?? Math.random;
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);
	const melodySource = options.melodySource ?? "phrases";

	// --- 1. 骨格と調 ---
	let skel = pick(pool, rnd);
	const baseKeyRaw = options.baseKey?.trim() || "any";
	// "any" は骨格の長短に合う調から引く（短調の骨格は短調のみ）。
	const resolvedKey = resolveComposeKey(
		baseKeyRaw === "any" ? skel.mode : baseKeyRaw,
		rnd,
	);
	// 利用者が骨格と逆の長短を指名したら、その長短の骨格へ引き直す（無ければそのまま）。
	if (resolvedKey.mode && resolvedKey.mode !== skel.mode) {
		const same = pool.filter((s) => s.mode === resolvedKey.mode);
		if (same.length > 0) skel = pick(same, rnd);
	}
	const rootShift = resolvedKey.rootShift;
	const minor = skel.mode === "minor";
	// 音階は共通経路と同じ規則（"auto" は短調の骨格ならテンプレートの scales から、長調は陽音階。
	// "any" は全音階から抽選、音階 ID はそのまま）。UI の説明と挙動を揃える。
	const scaleChoice = options.scale?.trim() || "auto";
	const scale = resolveComposeScale(
		scaleChoice === "auto" && template.scales && minor
			? pick(template.scales, rnd)
			: options.scale,
		minor,
		rnd,
	);
	const bpm = skel.bpm;
	const bars = skel.bars;
	const data = skel.barsData;

	// --- 2. 和音（null は前の和音の継続） ---
	const chordAt: [string, string][] = [];
	let prev: string = TONIC_CHORD[skel.mode];
	for (let b = 0; b < bars; b++) {
		const [c0, c1] = data[b]?.chords ?? [null, null];
		const first = c0 ?? prev;
		const second = c1 ?? first;
		chordAt.push([first, second]);
		prev = second;
	}
	// 進行は基準調（ハ長調 / A マイナー）のまま返す。DAW・export-samples・measure-arrangement は
	// buildChordPlacements(chordProgression, rootShift) で移調するので、ここで移調すると二重になる。
	const chordProgression = chordAt
		.map(([a, b]) => (a === b ? a : `${a} ${b}`))
		.join("|");
	const rootOf = (name: string): number => {
		try {
			const r = parseChord(name).notes[0] ?? 0;
			return ((r % 12) + 12) % 12;
		} catch {
			return 0;
		}
	};

	// --- 3. ベース（rel は和音ルートからの半音差） ---
	// 移調後の実音で組む（他の層は基準調で組んで最後に移調する）。音域の畳み込みは移調後に効かせないと
	// rootShift の分だけ帯からはみ出す。
	const bassRaw: {
		startStep: number;
		semi: number;
		dur: number;
		velocity: number;
	}[] = [];
	for (let b = 0; b < bars; b++) {
		const bb = data[b]?.bass;
		if (!bb) continue;
		for (let i = 0; i < bb.steps.length; i++) {
			const step = bb.steps[i];
			const half = step < BASE_STEPS_PER_BAR / 2 ? 0 : 1;
			const root = BASS_ROOT_FLOOR + rootOf(chordAt[b][half]);
			bassRaw.push({
				startStep: b * stepsPerBar + Math.abs(scaleStep(step)),
				semi: root + (bb.rel[i] ?? 0) + rootShift,
				dur: Math.abs(scaleStep(bb.durs[i] ?? 24)),
				velocity:
					step === 0 ? 112 : step % (BASE_STEPS_PER_BAR / 4) === 0 ? 98 : 86,
			});
		}
	}
	// 帯（24〜60）へは曲ごとにオクターブ単位で平行移動して収める——音ごとに畳むと、界隈曲の印である
	// オクターブ往復が畳まれた側でユニゾンに潰れる。帯に入る音が最も多いオクターブを選び
	// （平均は C3(48) 未満に保つ: daw.ts の classifyTrackRole がこのしきい値で判定する）、
	// それでも外れる音だけ音単位で折り返す。
	let bassOffset = 0;
	if (bassRaw.length > 0) {
		const mean = bassRaw.reduce((a, n) => a + n.semi, 0) / bassRaw.length;
		let best = -1;
		for (const off of [0, -12, 12, -24, 24]) {
			if (mean + off >= 48) continue;
			const inBand = bassRaw.filter(
				(n) => n.semi + off >= BASS_LOW && n.semi + off <= BASS_HIGH,
			).length;
			if (inBand > best) {
				best = inBand;
				bassOffset = off;
			}
		}
		if (best < 0) bassOffset = -12 * Math.ceil((mean - 47) / 12);
	}
	const bass: ComposedNote[] = bassRaw.map((n) => ({
		startStep: n.startStep,
		pitchUnits: semitonesToUnits(
			clampSemi(n.semi + bassOffset, BASS_LOW, BASS_HIGH),
			edo,
		) as Units,
		durationSteps: n.dur,
		velocity: n.velocity,
	}));

	// --- 4. ドラムと楽器 ---
	const drum =
		skel.drum === NO_DRUM_PATTERN || skel.drum in DRUM_PATTERNS
			? skel.drum
			: (template.drums?.pool[0] ?? "four_clap");
	const instrument =
		!template.instruments || template.instruments.includes(skel.instrument)
			? skel.instrument
			: pick(template.instruments, rnd);

	// --- 5. 主旋律 ---
	// 音域の中心。骨格の実測（移調前）を歌える帯へ寄せ、移調後にそこへ来るよう基準調側で引いておく。
	const centerFinal = Math.min(
		MELODY_HIGH - MELODY_WINDOW / 2,
		Math.max(MELODY_LOW + MELODY_WINDOW / 2, skel.melodyCenter),
	);
	const centerBasis = centerFinal - rootShift;
	const sung = (b: number) =>
		b >= 0 && b < bars ? (data[b]?.melody ?? null) : null;
	/** sameAs 連鎖の先頭。歌わない小節や後ろ向きでない参照は自分自身。 */
	const headOf = (b: number): number => {
		let h = b;
		const seen = new Set<number>();
		for (;;) {
			const s = data[h]?.sameAs ?? null;
			if (s === null || s >= h || !sung(s) || seen.has(s)) return h;
			seen.add(h);
			h = s;
		}
	};
	const absDeg: (number[] | null)[] = new Array(bars).fill(null);
	const usedPhrase: (CorpusPhrase | null)[] = new Array(bars).fill(null);

	if (melodySource === "original") {
		// 対照用：骨格の度数をそのまま。オクターブだけ曲全体で窓へ寄せる（度数は絶対値なので
		// 持ち上げ幅は音階の音数の倍数に限る）。
		const all: number[] = [];
		for (let b = 0; b < bars; b++) all.push(...(sung(b)?.degrees ?? []));
		const shifted = anchorDegrees(scale, all, centerBasis, scaleSize(scale));
		const offset = all.length > 0 ? shifted[0] - all[0] : 0;
		for (let b = 0; b < bars; b++) {
			const m = sung(b);
			if (!m) continue;
			const degs = mapByOnset(
				onsetsOf(m.rhythm),
				onsetsOf(m.rhythm).slice(0, m.degrees.length),
				m.degrees,
			).map((d) => d + offset);
			absDeg[b] = degs;
		}
	} else {
		for (let b = 0; b < bars; b++) {
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
				(data[b + 1]?.rhythmSameAs ?? null) === null;
			const rhythm2 = joinNext
				? [...m.rhythm, ...(next as NonNullable<typeof next>).rhythm]
				: [...m.rhythm, -BASE_STEPS_PER_BAR];
			const grid = gridOf(rhythm2);
			// リズムだけ同じ先行小節があれば、そのフレーズ（と同じ度数列）は避ける。
			const avoidBar = data[b]?.rhythmSameAs ?? null;
			const avoid =
				avoidBar !== null ? (usedPhrase[headOf(avoidBar)] ?? null) : null;
			let bestSim = -1;
			let ties: CorpusPhrase[] = [];
			for (const p of CORPUS_PHRASES) {
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
			const abs = anchorDegrees(scale, rel, centerBasis);
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
	}

	const melody: ComposedNote[] = [];
	const melodyDurations: number[] = [];
	let restSteps = 0;
	let sungBars = 0;
	const quarter = Math.round(stepsPerBar / 4);
	for (let b = 0; b < bars; b++) {
		const m = sung(b);
		const degs = absDeg[b];
		if (!m || !degs) continue;
		sungBars++;
		// 歌える帯（MELODY_LOW〜HIGH、移調後の実音）へ収める。窓は中心を寄せるだけなので、幅の広い
		// フレーズや中心の端寄せで外れる音がある。まず小節ごとオクターブで折り返し（形を保つ）、
		// それでも収まらない小節だけ音単位で折り返す。
		const pitches = degs.map((d) => degreeToPitch(scale, d));
		const finalSemi = (i: number, by: number): number =>
			pitches[i].semi + by + rootShift;
		const fits = (by: number): boolean =>
			pitches.every(
				(_, i) =>
					finalSemi(i, by) >= MELODY_LOW && finalSemi(i, by) <= MELODY_HIGH,
			);
		const barShift = fits(0) ? 0 : fits(12) ? 12 : fits(-12) ? -12 : 0;
		let at = b * stepsPerBar;
		let k = 0;
		for (const v of m.rhythm) {
			const len = Math.abs(scaleStep(v));
			if (v > 0) {
				const p = pitches[Math.min(k, pitches.length - 1)];
				let semi = p.semi + barShift;
				while (semi + rootShift < MELODY_LOW) semi += 12;
				while (semi + rootShift > MELODY_HIGH) semi -= 12;
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

	// --- 6. 層：アルペジオ（arp）とパッド（pad） ---
	const submelody: ComposedNote[] = [];
	const pad: ComposedNote[] = [];
	const arpBars = new Set<number>();
	const padBars = new Set<number>();
	for (let b = 0; b < bars; b++) {
		if (data[b]?.layers.arp) arpBars.add(b);
		if (data[b]?.layers.pad) padBars.add(b);
	}
	// 基準調（rootShift 0）で組んで最後に曲ごと移調する（compose.ts の kaiwai の作りと同じ）。
	if (arpBars.size > 0) {
		const arpShape = pick<"up" | "updown" | "down">(
			["up", "up", "updown", "down"],
			rnd,
		);
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
		const sixteenth = Math.abs(scaleStep(BASE_STEPS_PER_BAR / 16));
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
			if (arpShape === "updown")
				for (let i = len - 2; i >= 1; i--) cycle.push(i);
			if (arpShape === "down") cycle.reverse();
			for (
				let at = start, i = 0;
				at + sixteenth <= g.end;
				at += sixteenth, i++
			) {
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
	}
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

	// --- 移調（曲全体を同じ量だけ） ---
	const shiftUnits = semitonesToUnits(rootShift, edo);
	if (shiftUnits !== 0)
		for (const list of [melody, submelody, pad])
			for (const n of list) n.pitchUnits = (n.pitchUnits + shiftUnits) as Units;

	// --- 7. セクション ---
	const seen = new Map<SectionKind, number>();
	const sections: PlacedSection[] = skel.sections.map((s) => {
		const count = seen.get(s.kind) ?? 0;
		seen.set(s.kind, count + 1);
		return {
			kind: s.kind,
			startBar: s.start,
			bars: s.bars,
			spec: SECTION_SPECS[s.kind],
			keyShift: 0,
			restatement: count > 0,
		};
	});
	const kindOfBar = (b: number): SectionKind | null =>
		sections.find((s) => b >= s.startBar && b < s.startBar + s.bars)?.kind ??
		null;
	const padSections = [
		...new Set(
			[...padBars].map(kindOfBar).filter((k): k is SectionKind => k !== null),
		),
	];

	// --- 8. 検算値（compose.ts の evaluate と同じ材料） ---
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
	const chromaticNotes = semis.filter(
		(s) => !pcs.has((((Math.round(s) - rootShift) % 12) + 12) % 12),
	).length;
	const range = (ns: ComposedNote[]): number =>
		ns.length === 0
			? 0
			: (Math.max(...ns.map((n) => n.pitchUnits)) -
					Math.min(...ns.map((n) => n.pitchUnits))) /
				UNITS_PER_SEMITONE;
	const lo = semis.length > 0 ? Math.min(...semis) : 0;
	const span = Math.max(1, range(melody));
	const barTension: number[] = [];
	for (let b = 0; b < bars; b++) {
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
	const { stats } = evaluate(
		{
			form: "skeleton",
			chordProgression,
			chordPattern: skel.chordPattern,
			rootShift,
			keyName: resolvedKey.keyName,
			keyLabel: resolvedKey.keyLabel,
			scaleId: scale.id,
			scaleLabel: scale.label,
			moodLabel: resolvedKey.moodLabel,
			bpm,
			sections,
			bars,
			vocal: {
				duetSpans: [],
				duetStyle: "none",
				harmonyKinds: [],
				harmony2: false,
				octaveLayer: false,
			},
			tonal: { relativeKinds: [], relativeShift: 0, floating: false },
			melody,
			submelody,
			bass,
			harmony: [],
			harmony2: [],
			octave: [],
			pad,
			solo: [],
			melodyDurations,
			restSteps,
			bassStyle: "octave",
			totalSteps: Math.max(1, sungBars) * stepsPerBar,
			maxLeap,
			leapRatio: intervals === 0 ? 0 : leaps / intervals,
			stepRatio: intervals === 0 ? 0 : steps / intervals,
			chromaticRatio: melody.length === 0 ? 0 : chromaticNotes / melody.length,
			melodyRange: range(melody),
			submelodyRange: range(submelody),
			barTension,
			stepsPerBar,
		},
		options.recent ?? [],
	);

	return {
		chordProgression,
		chordPattern: skel.chordPattern,
		rootShift,
		keyName: resolvedKey.keyName,
		keyLabel: resolvedKey.keyLabel,
		scaleId: scale.id,
		scaleLabel: scale.label,
		form: "skeleton",
		moodLabel: resolvedKey.moodLabel,
		bpm,
		sections,
		bars,
		vocal: {
			duetSpans: [],
			duetStyle: "none",
			harmonyKinds: [],
			harmony2: false,
			octaveLayer: false,
		},
		tonal: { relativeKinds: [], relativeShift: 0, floating: false },
		drum,
		instrument,
		lyricWords: template.lyricWords,
		melody,
		submelody,
		bass,
		harmony: [],
		harmony2: [],
		octave: [],
		pad,
		solo: [],
		arrange: {
			backing: [{ pattern: skel.chordPattern, sections: null, octave: 0 }],
			sparkle: null,
			padSections,
			lead: null,
			bassLayer: null,
		},
		stats: { ...stats, attempts: 1, rejected: 0 },
		skeletonId: skel.id,
	};
};
