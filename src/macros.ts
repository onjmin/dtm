import { UNITS_PER_OCTAVE, UNITS_PER_SEMITONE } from "./tuning";
import { PITCH_RANGE_END, PITCH_RANGE_START } from "./types";
/**
 * 打ち込み補助マクロ群。MMLCore を直接操作する。
 *
 * 旧 demo/index.html の generateRandomPattern / applyHarmonicFilterMacro /
 * applyMonophonicMacro / shiftAllNotes を移植・整理したもの。
 */

import type { MMLCore } from "./mml-core";

const SCALES = [
	[0, 2, 4, 5, 7, 9, 11], // Major
	[0, 2, 3, 5, 7, 8, 10], // Minor
	[0, 2, 4, 7, 9], // Pentatonic Major
];

/**
 * アクティブトラックにスケールに沿ったランダムなノートを8小節分配置する。
 */
/**
 * 12平均律の半音 → 31平均律（ミーントーン）の度数。
 * 三全音(6半音)だけは増4度(15)と減5度(16)に分かれるが、ここでは音階生成用なので
 * 減5度側を採る（音階の第4音の変化としては増4度が普通だが、和音の質が分からない
 * 文脈では慣習的に狭い側を選ぶ）。
 */
const MEANTONE_STEP_BY_SEMITONE = [0, 3, 5, 8, 10, 13, 16, 18, 21, 23, 26, 28];

export const generateRandomPattern = (
	core: MMLCore,
	options: {
		stepsPerBar: number;
		startStep: number;
		pitchRangeStart: number;
		/** 曲の音律。省略時は12平均律。 */
		edo?: number;
	},
): void => {
	const { stepsPerBar, startStep, pitchRangeStart, edo = 12 } = options;
	const numBars = 8;
	const noteLength = 24; // 8分音符
	// SCALES は12平均律の半音で書かれた音階なので、音律に応じた格子へ写す。
	// 31平均律ではミーントーンの幹音間隔（全音5・半音3ステップ）でたどる。
	const semitoneToStep = (semi: number): number =>
		edo === 31 ? MEANTONE_STEP_BY_SEMITONE[semi] : semi;
	const upr = UNITS_PER_OCTAVE / edo;
	const basePitch = pitchRangeStart + 60 * UNITS_PER_SEMITONE;

	const scale = SCALES[Math.floor(Math.random() * SCALES.length)];
	const rootOffset = Math.floor(Math.random() * 12);

	const availablePitches: number[] = [];
	for (let i = 0; i < 12; i++) {
		const noteInOctave = (i - rootOffset + 12) % 12;
		if (scale.includes(noteInOctave))
			availablePitches.push(basePitch + semitoneToStep(i) * upr);
	}

	core.beginBatch();
	for (let bar = 0; bar < numBars; bar++) {
		const barStart = startStep + bar * stepsPerBar;
		const numNotes = Math.floor(Math.random() * 4) + 2;
		const occupied = new Set<number>();
		for (let i = 0; i < numNotes; i++) {
			const stepInRange =
				Math.floor(Math.random() * (stepsPerBar / noteLength)) * noteLength;
			const step = barStart + stepInRange;
			if (occupied.has(step)) continue;
			occupied.add(step);
			const pitch =
				availablePitches[Math.floor(Math.random() * availablePitches.length)];
			core.addNote(step, pitch, { noteLengthSteps: noteLength });
		}
	}
	core.endBatch();
	core.saveHistory();
};

/**
 * 半小節ごとに伴奏トラックの構成音(pitch class)に合致しない音を削除する。
 */
export const applyHarmonicFilter = (
	targetCore: MMLCore,
	chordCore: MMLCore,
	options: { stepsPerBar: number },
): void => {
	const halfStepsPerBar = options.stepsPerBar / 2;
	const allNotes = targetCore.getNotes().concat(chordCore.getNotes());
	if (allNotes.length === 0) return;

	const maxStep = Math.max(
		...allNotes.map((n) => n.startStep + n.durationSteps),
	);
	const numHalfBars = Math.ceil(maxStep / halfStepsPerBar);
	let currentClasses = new Set<number>();

	targetCore.beginBatch();
	for (let halfBar = 0; halfBar < numHalfBars; halfBar++) {
		const start = halfBar * halfStepsPerBar;
		const end = start + halfStepsPerBar;
		const isNewBar = halfBar % 2 === 0;

		const chordHere = chordCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);
		if (chordHere.length > 0) {
			currentClasses = new Set(
				chordHere.map((n) => n.pitchUnits % UNITS_PER_OCTAVE),
			);
		} else if (isNewBar) {
			currentClasses = new Set();
		}
		if (currentClasses.size === 0) continue;

		const activeHere = targetCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);
		for (const n of activeHere) {
			if (!currentClasses.has(n.pitchUnits % UNITS_PER_OCTAVE))
				targetCore.deleteNoteById(n.id);
		}
	}
	targetCore.endBatch();
	targetCore.saveHistory();
};

/**
 * 伴奏フィルタに加え、同タイミングの重なりを最高音優先で単音化する。
 */
export const applyMonophonic = (
	targetCore: MMLCore,
	chordCore: MMLCore,
	options: { stepsPerBar: number },
): void => {
	const halfStepsPerBar = options.stepsPerBar / 2;
	const allNotes = targetCore.getNotes().concat(chordCore.getNotes());
	if (allNotes.length === 0) return;

	const maxStep = Math.max(
		...allNotes.map((n) => n.startStep + n.durationSteps),
	);
	const numHalfBars = Math.ceil(maxStep / halfStepsPerBar);
	let currentClasses = new Set<number>();

	targetCore.beginBatch();
	for (let halfBar = 0; halfBar < numHalfBars; halfBar++) {
		const start = halfBar * halfStepsPerBar;
		const end = start + halfStepsPerBar;
		const isNewBar = halfBar % 2 === 0;

		const chordHere = chordCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);
		if (chordHere.length > 0) {
			currentClasses = new Set(
				chordHere.map((n) => n.pitchUnits % UNITS_PER_OCTAVE),
			);
		} else if (isNewBar) {
			currentClasses = new Set();
		}
		if (currentClasses.size === 0) continue;

		const activeHere = targetCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);

		const filtered = activeHere.filter((n) =>
			currentClasses.has(n.pitchUnits % UNITS_PER_OCTAVE),
		);
		const filteredIds = new Set(filtered.map((n) => n.id));
		for (const n of activeHere) {
			if (!filteredIds.has(n.id)) targetCore.deleteNoteById(n.id);
		}

		// 同タイミングの重なりを最高音だけ残す
		const timeMap = new Map<number, typeof filtered>();
		for (const n of filtered) {
			if (!timeMap.has(n.startStep)) timeMap.set(n.startStep, []);
			timeMap.get(n.startStep)?.push(n);
		}
		for (const notesAtTime of timeMap.values()) {
			if (notesAtTime.length > 1) {
				notesAtTime.sort((a, b) => b.pitchUnits - a.pitchUnits);
				const [, ...others] = notesAtTime;
				for (const on of others) targetCore.deleteNoteById(on.id);
			}
		}
	}
	targetCore.endBatch();
	targetCore.saveHistory();
};

/**
 * 全トラックのノートを一括でステップシフトする（負方向で範囲外は削除）。
 */
export const shiftNotes = (cores: MMLCore[], shiftSteps: number): void => {
	if (shiftSteps === 0) return;
	for (const core of cores) {
		const notes = [...core.getNotes()];
		for (const note of notes) {
			const newStart = note.startStep + shiftSteps;
			if (newStart < 0) core.deleteNoteById(note.id);
			else core.moveNote(note.id, newStart, note.pitchUnits);
		}
		// moveNote は履歴を残さないため、シフト全体を1操作としてここで確定する。
		// これが無いとシフト後のUndoが直前の編集まで巻き戻してしまう。
		core.saveHistory();
	}
};

/**
 * 全トラックのノートを一括で移調する。歌唱ピッチもノート由来なので、歌詞トラックの
 * 歌声も一緒に移調される。音域（{@link PITCH_RANGE_START}〜{@link PITCH_RANGE_END}）を
 * 超える場合はクランプする（音域外に飛んで無音・破綻するのを防ぐ）。
 *
 * 単位は「半音」ではなく**格子1ステップ**。12平均律では1ステップ＝1半音だが、
 * 31平均律では1ステップ＝1度（≒38.7セント）になる。31平均律で「半音」は
 * クロマチック半音（2度）とダイアトニック半音（3度）に分岐して一意に定まらないため、
 * 画面の「移調」操作と同じ格子基準に揃えてある。
 */
export const transposeNotes = (cores: MMLCore[], steps: number): void => {
	if (steps === 0) return;
	for (const core of cores) {
		const notes = [...core.getNotes()];
		for (const note of notes) {
			const newPitch = Math.max(
				PITCH_RANGE_START,
				Math.min(PITCH_RANGE_END, note.pitchUnits + steps),
			);
			if (newPitch !== note.pitchUnits) {
				core.moveNote(note.id, note.startStep, newPitch);
			}
		}
		// shiftNotes と同様、移調全体を1操作として履歴へ確定する。
		core.saveHistory();
	}
};
