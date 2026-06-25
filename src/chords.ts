/**
 * コード進行文字列を伴奏トラックのノート配置へ展開する。
 *
 * parseChord / parseChords は外部実装を注入する想定。
 * 旧 demo/index.html の applyChordProgression を移植・整理し、
 * 実際のノート追加を行わず配置（placement）の配列を返す純関数にした。
 */

import { parseChord, parseChords } from "@onjmin/chord-parser";

export type ChordPatternType =
	| "block"
	| "arpeggio"
	| "arpeggio-fast"
	| "offbeat"
	| "yatsume"
	| "alternating";

export type ChordPlacement = {
	startStep: number;
	pitch: number;
	durationSteps: number;
	velocity: number;
};

export type ApplyChordOptions = {
	chordStr: string;
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
export const buildChordPlacements = (
	options: ApplyChordOptions,
): ChordPlacement[] => {
	const { chordStr, patternType, rootShift, bpm, stepsPerBar } = options;

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
				try {
					notes = [...parseChord(`${chord.key}${chord.chord}`).notes];
				} catch {
					continue;
				}
				const noteLength = chord.durationSteps;

				if (patternType === "block") {
					for (const noteOffset of notes) {
						placements.push({
							startStep: chord.whenStep,
							pitch: C3 + noteOffset + offset,
							durationSteps: noteLength,
							velocity: 100,
						});
					}
				} else if (patternType === "arpeggio") {
					const arpInterval = Math.floor(noteLength / notes.length);
					notes.forEach((noteOffset, i) => {
						placements.push({
							startStep: chord.whenStep + i * arpInterval,
							pitch: C3 + noteOffset + offset,
							durationSteps: noteLength - i * arpInterval,
							velocity: 100,
						});
					});
				} else if (patternType === "arpeggio-fast") {
					const arpInterval = 6;
					notes.forEach((noteOffset, i) => {
						placements.push({
							startStep: chord.whenStep + i * arpInterval,
							pitch: C3 + noteOffset + offset,
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
									pitch: C3 + noteOffset + offset,
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
									pitch: C3 + noteOffset + offset,
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
							pitch: C3 + noteOffset + offset,
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
			try {
				notes = [...parseChord(chordName).notes];
			} catch {
				return;
			}
			if (notes.length === 0) return;
			const startStep = barIndex * chordLength;
			notes.forEach((noteOffset, i) => {
				const stepOffset = i * 3;
				placements.push({
					startStep: startStep + stepOffset,
					pitch: C3 + noteOffset + offset,
					durationSteps: chordLength - stepOffset,
					velocity: 100,
				});
			});
		});
	}

	return placements;
};
