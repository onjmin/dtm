/**
 * Playload (ZX Spectrum 128 PLAY文) 出力ユーティリティ。
 *
 * Playload は URL 共有型の超軽量ゲームエンジンで、3チャンネルの ZX Spectrum 128 PLAY 互換
 * サウンドエンジン (play(ch, str)) を内蔵している。
 *
 * 最大3チャンネル（Channel 0, 1, 2）に対応し、4トラック目以降は無視する。
 */

import { type Units, unitsToMidi } from "../audio/tuning";
import type { Note } from "../types";

export type PlayloadExportOptions = {
	tempo?: number;
	volumes?: number[];
	stepsPerBar?: number;
	barLimit?: number;
};

export type PlayloadExportResult = {
	code: string;
	channelStrings: string[];
	usedChannelCount: number;
	ignoredTrackCount: number;
	totalTrackCount: number;
};

type DurationCandidate = {
	code: string;
	steps: number;
};

/**
 * ZX Spectrum 128 PLAY でサポートされる音長コードとステップ数の一覧（降順）。
 * stepsPerBar = 192 (4/4拍子) を基準とする。
 */
const getDurationCandidates = (stepsPerBar: number): DurationCandidate[] => {
	const total = stepsPerBar;
	return [
		{ code: "9", steps: total }, // 全音符
		{ code: "8", steps: total * 0.75 }, // 付点2分音符
		{ code: "7", steps: total / 2 }, // 2分音符
		{ code: "6", steps: (total / 4) * 1.5 }, // 付点4分音符
		{ code: "5", steps: total / 4 }, // 4分音符
		{ code: "4", steps: (total / 8) * 1.5 }, // 付点8分音符
		{ code: "12", steps: total / 2 / 3 }, // 4分3連音符 (32 steps)
		{ code: "3", steps: total / 8 }, // 8分音符
		{ code: "2", steps: (total / 16) * 1.5 }, // 付点16分音符
		{ code: "11", steps: total / 4 / 3 }, // 8分3連音符 (16 steps)
		{ code: "1", steps: total / 16 }, // 16分音符
		{ code: "10", steps: total / 4 / 6 }, // 16分3連音符 (8 steps)
	];
};

const NOTE_LETTERS = [
	"c",
	"#c",
	"d",
	"#d",
	"e",
	"f",
	"#f",
	"g",
	"#g",
	"a",
	"#a",
	"b",
] as const;

/**
 * ピッチ (units) から ZX Spectrum 128 PLAY のオクターブ番号 (0..8) と音名を返す。
 * ZX Spectrum 128 では O5 の小文字 c が Middle C (MIDI 60 = C4)。
 */
export const pitchToPlayload = (
	pitchUnits: Units | number,
): { octave: number; note: string } => {
	const midi = Math.max(
		0,
		Math.min(127, Math.round(unitsToMidi(pitchUnits as Units))),
	);
	const noteIndex = midi % 12;
	const note = NOTE_LETTERS[noteIndex];
	// MIDI 60 (C4) -> Math.floor(60 / 12) = 5 -> O5
	const rawOctave = Math.floor(midi / 12);
	const octave = Math.max(0, Math.min(8, rawOctave));
	return { octave, note };
};

/**
 * トラック内の重なりを解消し、単音（モノフォニック）シーケンスへ正規化する。
 * 同一開始ステップに複数音がある場合は最高音を優先する。
 */
const prepareMonophonicNotes = (notes: Note[], limitSteps: number): Note[] => {
	if (notes.length === 0) return [];

	const valid = notes
		.filter((n) => n.startStep < limitSteps && n.durationSteps > 0)
		.sort((a, b) => a.startStep - b.startStep || b.pitchUnits - a.pitchUnits);

	// 同一 startStep は最高音のみ抽出
	const deduplicated: Note[] = [];
	for (const n of valid) {
		const last = deduplicated[deduplicated.length - 1];
		if (!last || last.startStep !== n.startStep) {
			deduplicated.push({ ...n });
		}
	}

	// 次の発音位置と重なるノートを短縮
	for (let i = 0; i < deduplicated.length; i++) {
		const current = deduplicated[i];
		const nextStart =
			i + 1 < deduplicated.length ? deduplicated[i + 1].startStep : limitSteps;
		const maxAvailable = nextStart - current.startStep;
		if (current.durationSteps > maxAvailable) {
			current.durationSteps = maxAvailable;
		}
	}

	return deduplicated.filter((n) => n.durationSteps > 0);
};

const findBestSingleDuration = (
	steps: number,
	candidates: DurationCandidate[],
): DurationCandidate => {
	let best = candidates[candidates.length - 1];
	let minDiff = Infinity;
	for (const cand of candidates) {
		const diff = Math.abs(steps - cand.steps);
		if (diff < minDiff) {
			minDiff = diff;
			best = cand;
		}
	}
	return best;
};

const pushDuration = (
	code: string,
	state: { lastDuration: string; out: string[] },
): void => {
	const lastToken = state.out[state.out.length - 1] ?? "";
	if (/\d$/.test(lastToken)) {
		state.out.push(`N${code}`);
	} else {
		state.out.push(code);
	}
	state.lastDuration = code;
};

const fillRests = (
	gapSteps: number,
	candidates: DurationCandidate[],
	state: { lastDuration: string; out: string[] },
): void => {
	let remaining = gapSteps;
	const minStep = candidates[candidates.length - 1].steps;
	while (remaining >= minStep) {
		let chosen: DurationCandidate | null = null;
		for (const cand of candidates) {
			if (cand.steps <= remaining) {
				chosen = cand;
				break;
			}
		}
		if (!chosen) break;
		if (state.lastDuration !== chosen.code) {
			pushDuration(chosen.code, state);
		}
		state.out.push("&");
		remaining -= chosen.steps;
	}
};

/**
 * 1トラック分のノート配列を Playload (ZX 128 PLAY) 文字列に変換する。
 */
export const exportPlayloadChannel = (
	notes: Note[],
	channelIndex: number,
	options: {
		tempo: number;
		volume: number;
		stepsPerBar: number;
		limitSteps: number;
	},
): string => {
	const monoNotes = prepareMonophonicNotes(notes, options.limitSteps);
	if (monoNotes.length === 0) return "";

	const candidates = getDurationCandidates(options.stepsPerBar);
	const out: string[] = [];

	const tempo = Math.max(60, Math.min(240, Math.round(options.tempo)));
	const vol15 = Math.max(
		0,
		Math.min(15, Math.round((options.volume / 100) * 15)),
	);

	if (channelIndex === 0) {
		out.push(`T${tempo}`);
	}
	out.push(`V${vol15}`);

	let currentCursor = 0;
	let lastOctave = -1;
	const state = { lastDuration: "", out };

	for (const note of monoNotes) {
		if (note.startStep > currentCursor) {
			fillRests(note.startStep - currentCursor, candidates, state);
			currentCursor = note.startStep;
		}

		const { octave, note: noteName } = pitchToPlayload(note.pitchUnits);
		let octaveChanged = false;
		if (octave !== lastOctave) {
			out.push(`O${octave}`);
			lastOctave = octave;
			octaveChanged = true;
		}

		const bestDur = findBestSingleDuration(note.durationSteps, candidates);
		if (state.lastDuration !== bestDur.code || octaveChanged) {
			pushDuration(bestDur.code, state);
		}

		out.push(noteName);
		currentCursor = note.startStep + note.durationSteps;
	}

	return out.join("");
};

/**
 * 複数トラックから Playload 用 JavaScript コードを生成する。
 * 先頭3トラックのみを Channel 0, 1, 2 として出力し、4トラック目以降は無視する。
 */
export const exportPlayload = (
	tracks: Note[][],
	options?: PlayloadExportOptions,
): PlayloadExportResult => {
	const totalTrackCount = tracks.length;
	const targetTracks = tracks.slice(0, 3);
	const ignoredTrackCount = Math.max(0, totalTrackCount - 3);

	const tempo = options?.tempo ?? 120;
	const stepsPerBar = options?.stepsPerBar ?? 192;
	const barLimit = options?.barLimit ?? 0;
	const limitSteps =
		barLimit > 0 ? barLimit * stepsPerBar : Number.POSITIVE_INFINITY;
	const volumes = options?.volumes ?? [];

	const channelStrings: string[] = [];
	const codeLines: string[] = [];

	targetTracks.forEach((notes, i) => {
		const vol = volumes[i] ?? 100;
		const str = exportPlayloadChannel(notes, i, {
			tempo,
			volume: vol,
			stepsPerBar,
			limitSteps,
		});
		channelStrings.push(str);
		if (str.length > 0) {
			codeLines.push(`play(${i}, "${str}");`);
		}
	});

	let code = codeLines.join("\n");
	if (codeLines.length === 0) {
		code = "// (有効なノートデータがありません)";
	}

	return {
		code,
		channelStrings,
		usedChannelCount: codeLines.length,
		ignoredTrackCount,
		totalTrackCount,
	};
};
