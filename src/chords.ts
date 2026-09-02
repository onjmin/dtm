/**
 * コード進行文字列を伴奏トラックのノート配置へ展開する。
 *
 * parseChord / parseChords は外部実装を注入する想定。
 * 旧 demo/index.html の applyChordProgression を移植・整理し、
 * 実際のノート追加を行わず配置（placement）の配列を返す純関数にした。
 */

import { parseChord, parseChords } from "@onjmin/chord-parser";
import { fifthToStep, UNITS_PER_OCTAVE, type Units, units } from "./tuning";

export type ChordPatternType =
	| "block"
	| "arpeggio"
	| "arpeggio-fast"
	| "offbeat"
	| "yatsume"
	| "alternating";

export type ChordPlacement = {
	startStep: number;
	/**
	 * 1/372オクターブ単位。chord-parser が返すのは12平均律の半音なので、
	 * ここへ入れる時点で音律に応じた格子へ写している。
	 */
	pitchUnits: Units;
	durationSteps: number;
	velocity: number;
};

export type ApplyChordOptions = {
	chordStr: string;
	/** 曲の音律（1オクターブの分割数）。省略時は12平均律。 */
	edo?: number;
	patternType: ChordPatternType;
	/** ルートのセミトーンシフト（0-11） */
	rootShift: number;
	bpm: number;
	stepsPerBar: number;
};

const C3 = 48;

/**
 * コード進行 → 伴奏ノート配置。
 */
/**
 * 12平均律の半音 → 31平均律（ミーントーン）の度数。移調量の変換に使う。
 * 三全音(6半音)だけは増4度(15)と減5度(16)に分かれるが、移調では和音の質が
 * 分からないので狭い側（減5度）を採る。
 */
const MEANTONE_STEP_BY_SEMITONE = [0, 3, 5, 8, 10, 13, 16, 18, 21, 23, 26, 28];

/**
 * 和音の構成音を units へ写す。
 *
 * chord-parser の `notes` は12平均律の半音、`noteFifths` は五度圏インデックス。
 * 五度圏は綴りを保持しているので、31平均律でも増4度と減5度・C# と Db を
 * 正しく区別して度数へ落とせる（`fifthToStep` 参照）。
 *
 * オクターブは半音側から、オクターブ内の位置は五度圏側から決める。両者を混ぜるのは
 * 五度圏がオクターブ不変（音類しか表さない）ため。
 */
const chordToneToUnits = (
	relSemitone: number,
	relFifth: number,
	rootSemitone: number,
	rootFifth: number,
	edo: 12 | 31,
): Units => {
	const perStep = UNITS_PER_OCTAVE / edo;
	// ルートの位置。移調はミーントーンの度数へ写してから足す。
	const rootOct = Math.floor(rootSemitone / 12);
	const rootWithin = ((rootSemitone % 12) + 12) % 12;
	const rootStep =
		edo === 31
			? (fifthToStep(rootFifth, 31) +
					MEANTONE_STEP_BY_SEMITONE[rootWithin] -
					fifthToStep(rootFifth, 31) +
					31) %
				31
			: rootWithin;
	// ルートからの相対。オクターブ数は半音側、オクターブ内は五度圏側で決める。
	const relWithin12 = ((relSemitone % 12) + 12) % 12;
	const relOct = Math.round((relSemitone - relWithin12) / 12);
	const relStep =
		(fifthToStep(relFifth, edo) - fifthToStep(rootFifth, edo) + edo) % edo;
	return units(
		(rootOct + relOct) * UNITS_PER_OCTAVE + (rootStep + relStep) * perStep,
	);
};

export const buildChordPlacements = (
	options: ApplyChordOptions,
): ChordPlacement[] => {
	const {
		chordStr,
		patternType,
		rootShift,
		bpm,
		stepsPerBar,
		edo = 12,
	} = options;

	const placements: ChordPlacement[] = [];
	if (!chordStr.trim()) return placements;

	const offset = rootShift;
	const chordLength = stepsPerBar;

	let chordData: ReturnType<typeof parseChords> = [];
	try {
		chordData = parseChords(chordStr, bpm);
	} catch {
		chordData = [];
	}

	if (chordData.length > 0) {
		const secondsPerBar = (60 / bpm) * 4;
		const secondsPerStep = secondsPerBar / stepsPerBar;

		// 同タイミングのコードをグループ化
		const chordGroups: Record<
			number,
			{ key: string; chord: string; whenStep: number; durationSteps: number }[]
		> = {};
		for (const chord of chordData) {
			const whenStep = Math.floor(chord.when / secondsPerStep);
			const durationSteps = Math.floor(chord.duration / secondsPerStep);
			if (!chordGroups[whenStep]) chordGroups[whenStep] = [];
			chordGroups[whenStep].push({
				key: chord.key,
				chord: chord.chord,
				whenStep,
				durationSteps,
			});
		}

		for (const group of Object.values(chordGroups)) {
			for (const chord of group) {
				let notes: number[];
				let toUnits: (relSemitone: number) => Units;
				try {
					const parsed = parseChord(`${chord.key}${chord.chord}`);
					notes = [...parsed.notes];
					// notes と noteFifths は同じ並び。半音からオクターブ、五度圏から
					// オクターブ内の位置を決めて units へ写す。
					const fifthOf = new Map(
						parsed.notes.map((n, i) => [n, parsed.noteFifths[i]]),
					);
					toUnits = (rel) =>
						chordToneToUnits(
							rel,
							fifthOf.get(rel) ?? parsed.rootFifth,
							C3 + offset,
							parsed.rootFifth,
							edo === 31 ? 31 : 12,
						);
				} catch {
					continue;
				}
				const noteLength = chord.durationSteps;

				if (patternType === "block") {
					for (const noteOffset of notes) {
						placements.push({
							startStep: chord.whenStep,
							pitchUnits: toUnits(noteOffset),
							durationSteps: noteLength,
							velocity: 100,
						});
					}
				} else if (patternType === "arpeggio") {
					const arpInterval = Math.floor(noteLength / notes.length);
					notes.forEach((noteOffset, i) => {
						placements.push({
							startStep: chord.whenStep + i * arpInterval,
							pitchUnits: toUnits(noteOffset),
							durationSteps: noteLength - i * arpInterval,
							velocity: 100,
						});
					});
				} else if (patternType === "arpeggio-fast") {
					const arpInterval = 6;
					notes.forEach((noteOffset, i) => {
						placements.push({
							startStep: chord.whenStep + i * arpInterval,
							pitchUnits: toUnits(noteOffset),
							durationSteps: Math.max(12, noteLength - i * arpInterval),
							velocity: 100,
						});
					});
				} else if (patternType === "offbeat") {
					const stepsPerQuarter = Math.floor(stepsPerBar / 4);
					const halfBeat = Math.floor(stepsPerQuarter / 2);
					for (let beat = 0; beat < 4; beat++) {
						const syncopatedStep =
							chord.whenStep + beat * stepsPerQuarter + halfBeat;
						if (syncopatedStep < chord.whenStep + noteLength) {
							for (const noteOffset of notes) {
								placements.push({
									startStep: syncopatedStep,
									pitchUnits: toUnits(noteOffset),
									durationSteps: Math.min(halfBeat, 12),
									velocity: 100,
								});
							}
						}
					}
				} else if (patternType === "yatsume") {
					const ticksPerQuarter = 480;
					const stepsPerQuarter = Math.floor(stepsPerBar / 4);
					const tickToStep = (tick: number) =>
						Math.max(1, Math.round((tick * stepsPerQuarter) / ticksPerQuarter));
					const yatsumeTickOffsets = [0, 360, 960, 1320];
					const yatsumeLengthSteps = tickToStep(360);
					for (const tickOffset of yatsumeTickOffsets) {
						const noteStart = chord.whenStep + tickToStep(tickOffset);
						if (noteStart < chord.whenStep + noteLength) {
							for (const noteOffset of notes) {
								placements.push({
									startStep: noteStart,
									pitchUnits: toUnits(noteOffset),
									durationSteps: yatsumeLengthSteps,
									velocity: 100,
								});
							}
						}
					}
				} else if (patternType === "alternating") {
					notes.forEach((noteOffset, i) => {
						const stepOffset = i * Math.floor(stepsPerBar / 4);
						placements.push({
							startStep: chord.whenStep + stepOffset,
							pitchUnits: toUnits(noteOffset),
							durationSteps: Math.max(12, Math.floor(stepsPerBar / 4)),
							velocity: 100,
						});
					});
				}
			}
		}
	} else {
		// フォールバック: 空白 or カンマ区切りで1小節ずつ
		const chordNames = chordStr.split(/[\s,]+/).filter((c) => c);
		chordNames.forEach((chordName, barIndex) => {
			let notes: number[];
			let toUnits: (relSemitone: number) => Units;
			try {
				const parsed = parseChord(chordName);
				notes = [...parsed.notes];
				const fifthOf = new Map(
					parsed.notes.map((n, i) => [n, parsed.noteFifths[i]]),
				);
				toUnits = (rel) =>
					chordToneToUnits(
						rel,
						fifthOf.get(rel) ?? parsed.rootFifth,
						C3 + offset,
						parsed.rootFifth,
						edo === 31 ? 31 : 12,
					);
			} catch {
				return;
			}
			if (notes.length === 0) return;
			const startStep = barIndex * chordLength;
			notes.forEach((noteOffset, i) => {
				const stepOffset = i * 3;
				placements.push({
					startStep: startStep + stepOffset,
					pitchUnits: toUnits(noteOffset),
					durationSteps: chordLength - stepOffset,
					velocity: 100,
				});
			});
		});
	}

	return placements;
};
