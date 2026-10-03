/**
 * 骨格借用の生成エンジン。所有者の耳コピ MIDI から抜いた設計図（{@link Skeleton}）を1つ引き、
 * 調だけ変えて、和音・ベース・ドラム・層の配置は骨格どおりに置く。歌メロは骨格のリズムと
 * 反復の地図（sameAs / rhythmSameAs）に沿って、**2小節素材**（options.phrases。実験では耳コピのフレーズ集）
 * の音を当てる。元曲の旋律の音そのものは既定では使わない（`melodySource: "original"` は対照用）。
 *
 * `composeSong` の共通経路とは乱数を共有しない——テンプレートの `engine: "skeleton"` で
 * 先頭から分岐する（{@link file://./compose.ts}）。ここで引く乱数の順は
 * 骨格 → 調 → 楽器 → 楽句ごとのフレーズ → アルペジオの形・強さ。
 */

import type { Units } from "../audio/tuning";
import { semitonesToUnits } from "../chord/chords";
import { DRUM_PATTERNS, NO_DRUM_PATTERN } from "../instruments/drum-config";
import {
	type ComposedNote,
	type ComposeOptions,
	type ComposeResult,
	clampSemi,
	evaluate,
	MELODY_HIGH,
	MELODY_LOW,
} from "./compose";
import { resolveComposeKey } from "./compose-keys";
import {
	anchorDegrees,
	buildArpLayer,
	buildPadLayer,
	EMPTY_TONAL,
	EMPTY_VOCAL,
	type FitBar,
	fitPhrases,
	fittedDrawStats,
	MELODY_WINDOW,
	mapByOnset,
	onsetsOf,
	padSectionsOf,
	pick,
	renderFittedMelody,
	rootPcOf,
} from "./compose-melody-fit";
import { resolveComposeScale, scaleSize } from "./compose-scales";
import {
	type PlacedSection,
	SECTION_SPECS,
	type SectionKind,
	type StructureTemplate,
} from "./compose-sections";
import type { CorpusPhrase } from "./phrase-types";
import { type Skeleton, usableSkeletons } from "./skeleton-types";

/** 骨格の1小節のステップ数（skeleton-types.ts の基準）。compose.ts の値をここで読むと循環 import の初期化順で落ちる。 */
const BASE_STEPS_PER_BAR = 192;

/** 骨格の和音の既定（先頭が継続 null のとき）。 */
const TONIC_CHORD = { minor: "Am", major: "C" } as const;

/** ベースの音域（MIDI）。外れたらオクターブで畳む。 */
const BASS_LOW = 24;
const BASS_HIGH = 60;
/** 根音を置くオクターブの底。根音の pc を足して 36〜47 に置き、rel を掛ける。 */
const BASS_ROOT_FLOOR = 36;

// ============================================================
// 生成
// ============================================================

export const composeSkeleton = (
	options: ComposeOptions,
	template: StructureTemplate,
	skeletons: Skeleton[],
	phrases: CorpusPhrase[],
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
			const root = BASS_ROOT_FLOOR + rootPcOf(chordAt[b][half]);
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
	/** 共有の引き当て（compose-melody-fit.ts）へ渡す設計図。sameAs は曲頭からの絶対小節番号のまま。 */
	const fitBars: FitBar[] = [];
	for (let b = 0; b < bars; b++) {
		const m = sung(b);
		fitBars.push(
			m
				? {
						rhythm: m.rhythm,
						sameAs: data[b]?.sameAs ?? null,
						rhythmSameAs: data[b]?.rhythmSameAs ?? null,
					}
				: null,
		);
	}
	let absDeg: (number[] | null)[] = new Array(bars).fill(null);

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
		absDeg = fitPhrases(
			fitBars,
			scale,
			() => centerBasis,
			chordAt,
			rnd,
			phrases,
		);
	}

	const { melody, melodyDurations, restSteps, sungBars } = renderFittedMelody(
		fitBars,
		absDeg,
		scale,
		() => rootShift,
		stepsPerBar,
		edo,
	);

	// --- 6. 層：アルペジオ（arp）とパッド（pad） ---
	const arpBars = new Set<number>();
	const padBars = new Set<number>();
	for (let b = 0; b < bars; b++) {
		if (data[b]?.layers.arp) arpBars.add(b);
		if (data[b]?.layers.pad) padBars.add(b);
	}
	// 基準調（rootShift 0）で組んで最後に曲ごと移調する（compose.ts の kaiwai の作りと同じ）。
	const submelody = buildArpLayer(
		arpBars,
		chordProgression,
		melody,
		stepsPerBar,
		edo,
		rnd,
	);
	const pad = buildPadLayer(padBars, chordAt, stepsPerBar, edo);

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
	const padSections = padSectionsOf(padBars, sections);

	// --- 8. 検算値（compose.ts の evaluate と同じ材料。compose-melody-fit.ts で継ぎ合わせと共有） ---
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
			...fittedDrawStats({
				melody,
				submelody,
				melodyDurations,
				restSteps,
				sungBars,
				scale,
				shiftAt: () => rootShift,
				totalBars: bars,
				stepsPerBar,
			}),
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
		vocal: EMPTY_VOCAL,
		tonal: EMPTY_TONAL,
		drum,
		instrument,
		lyricVocab: template.lyricVocab,
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
