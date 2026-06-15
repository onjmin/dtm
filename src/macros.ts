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
export const generateRandomPattern = (
	core: MMLCore,
	options: { stepsPerBar: number; startStep: number; pitchRangeStart: number },
): void => {
	const { stepsPerBar, startStep, pitchRangeStart } = options;
	const numBars = 8;
	const noteLength = 24; // 8分音符
	const basePitch = pitchRangeStart + 60;

	const scale = SCALES[Math.floor(Math.random() * SCALES.length)];
	const rootOffset = Math.floor(Math.random() * 12);

	const availablePitches: number[] = [];
	for (let i = 0; i < 12; i++) {
		const noteInOctave = (i - rootOffset + 12) % 12;
		if (scale.includes(noteInOctave)) availablePitches.push(basePitch + i);
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
			currentClasses = new Set(chordHere.map((n) => n.pitch % 12));
		} else if (isNewBar) {
			currentClasses = new Set();
		}
		if (currentClasses.size === 0) continue;

		const activeHere = targetCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);
		for (const n of activeHere) {
			if (!currentClasses.has(n.pitch % 12)) targetCore.deleteNoteById(n.id);
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
			currentClasses = new Set(chordHere.map((n) => n.pitch % 12));
		} else if (isNewBar) {
			currentClasses = new Set();
		}
		if (currentClasses.size === 0) continue;

		const activeHere = targetCore
			.getNotes()
			.filter((n) => n.startStep >= start && n.startStep < end);

		const filtered = activeHere.filter((n) => currentClasses.has(n.pitch % 12));
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
				notesAtTime.sort((a, b) => b.pitch - a.pitch);
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
			else core.moveNote(note.id, newStart, note.pitch);
		}
	}
};
