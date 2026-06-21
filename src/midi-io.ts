/**
 * MIDI入出力ユーティリティ。
 *
 * - 入力: 注入された parseMidi（midi-parser-js 互換）の戻り値を解析し、
 *   チャンネルを melody/submelody/bass/chord へ自動分類してノート配置を返す。
 * - 出力: トラック群とドラムパターンから .mid バイナリ(Blob)を生成する。
 *
 * 旧 demo/index.html の analyzeMidiTracks / getBPM / parseMidiWithSelection /
 * exportMIDI を移植・整理したもの。
 */

import type { DrumPattern } from "./drum-config";
import { DEFAULT_VELOCITY } from "./types";
import type { Note } from "./types";

const STEPS_PER_BEAT = 48;

type MidiEvent = {
	deltaTime: number;
	type: number;
	metaType?: number;
	channel?: number;
	data: number | number[];
};
type MidiTrack = { event: MidiEvent[] };
type MidiData = { track: MidiTrack[]; timeDivision: number };

export type MidiTrackAnalysis = {
	index: number;
	name: string;
	noteCount: number;
	selected: boolean;
};

export type MidiNotePlacement = {
	/** melody/submelody/bass/chord */
	trackId: string;
	startStep: number;
	pitch: number;
	durationSteps: number;
	velocity: number;
};

export type MidiExtraction = {
	placements: MidiNotePlacement[];
	bpm: number;
};

/**
 * MIDIの各トラックを走査し、ノート数などの概要を返す（トラック選択UI用）。
 * ノート数はピアノロールで編集可能なノートのみを数える（ドラム ch10 は除外）。
 * ドラム(ch10)だけで構成されたトラックは編集できないため、結果に含めない。
 */
export const analyzeMidiTracks = (midi: unknown): MidiTrackAnalysis[] => {
	const { track } = midi as MidiData;
	const result: MidiTrackAnalysis[] = [];

	for (let i = 0; i < track.length; i++) {
		const notes: { pitch: number; channel: number; end?: number }[] = [];
		let currentTime = 0;
		for (const event of track[i].event) {
			currentTime += event.deltaTime;
			const data = event.data as number[];
			if (event.type === 9 && data && data[1]) {
				notes.push({ pitch: data[0], channel: event.channel ?? 0 });
			} else if (event.type === 8) {
				for (let k = notes.length - 1; k >= 0; k--) {
					if (notes[k].pitch === data[0] && notes[k].end === undefined) {
						notes[k].end = currentTime;
						break;
					}
				}
			}
		}
		const validNotes = notes.filter((n) => n.end !== undefined);
		// ピアノロールで編集できるのはノートのみ。MIDIのドラム(ch10 = channel 9)は
		// 取り込み時にスキップされ編集できないので、ドラムだけのトラックは選択UIに出さない。
		const editableNotes = validNotes.filter((n) => n.channel !== 9);
		if (validNotes.length > 0 && editableNotes.length === 0) continue;
		result.push({
			index: i,
			name: `Ch${i + 1}`,
			noteCount: editableNotes.length,
			selected: editableNotes.length > 0,
		});
	}

	return result;
};

/** MIDIメタイベントからBPMを取得（無ければ120）。 */
export const getMidiBPM = (midi: unknown): number => {
	const { track } = midi as MidiData;
	for (const { event } of track) {
		for (const { type, metaType, data } of event) {
			if (type !== 0xff || metaType !== 0x51) continue;
			if (typeof data === "number") {
				return 60000000 / data;
			}
			const [b1, b2, b3] = data as number[];
			return 60000000 / ((b1 << 16) | (b2 << 8) | b3);
		}
	}
	return 120;
};

/**
 * 選択トラックからノートを抽出し、チャンネル特性に基づいて
 * melody/submelody/bass/chord へ自動分類した配置を返す。
 */
export const extractMidiPlacements = (
	midi: unknown,
	selectedTrackIndices: number[],
): MidiExtraction => {
	const { track, timeDivision } = midi as MidiData;
	const ticksPerBeat = timeDivision;
	const bpm = getMidiBPM(midi);

	type RawNote = {
		pitch: number;
		velocity: number;
		start: number;
		end: number | null;
	};
	const channelNotes: Record<number, RawNote[]> = {};

	for (const trackIdx of selectedTrackIndices) {
		const trackData = track[trackIdx];
		if (!trackData) continue;
		let currentTime = 0;
		for (const event of trackData.event) {
			currentTime += event.deltaTime;
			if (event.channel === 9) continue;
			if (event.type !== 8 && event.type !== 9) continue;
			const [pitch, velocity] = event.data as number[];
			const isNoteOff = event.type === 8 || !velocity;
			const channel = event.channel ?? 0;

			if (!channelNotes[channel]) channelNotes[channel] = [];

			if (isNoteOff) {
				for (let i = channelNotes[channel].length - 1; i >= 0; i--) {
					const note = channelNotes[channel][i];
					if (note.pitch === pitch && note.end === null) {
						note.end = currentTime;
						break;
					}
				}
			} else {
				channelNotes[channel].push({
					pitch,
					velocity,
					start: currentTime,
					end: null,
				});
			}
		}
	}

	// チャンネル特性分析
	const ticksPerBar = ticksPerBeat * 4;
	const ticksPer8Bars = ticksPerBar * 8;
	const channelAnalysis: Record<
		number,
		{ avgPitch: number; maxSimultaneous: number; hasSubmelodyPattern: boolean }
	> = {};

	for (const [channelStr, notes] of Object.entries(channelNotes)) {
		const channel = Number.parseInt(channelStr, 10);
		const validNotes = notes.filter(
			(n) => n.end !== null,
		) as Required<RawNote>[];
		if (validNotes.length === 0) {
			channelAnalysis[channel] = {
				avgPitch: 60,
				maxSimultaneous: 0,
				hasSubmelodyPattern: false,
			};
			continue;
		}

		const avgPitch =
			validNotes.reduce((sum, n) => sum + n.pitch, 0) / validNotes.length;

		let maxSimultaneous = 0;
		const sortedNotes = [...validNotes].sort((a, b) => a.start - b.start);
		for (let i = 0; i < sortedNotes.length; i++) {
			let simultaneous = 1;
			for (let j = i + 1; j < sortedNotes.length; j++) {
				if (sortedNotes[j].start < (sortedNotes[i].end as number)) {
					simultaneous++;
				}
			}
			maxSimultaneous = Math.max(maxSimultaneous, simultaneous);
		}

		const isSubmelodyPattern = (): boolean => {
			if (sortedNotes.length === 0) return false;
			const blocks: { start: number; end: number }[] = [];
			let blockStart = sortedNotes[0].start;
			let blockEnd = sortedNotes[0].end as number;
			for (let i = 1; i < sortedNotes.length; i++) {
				const gap = sortedNotes[i].start - (sortedNotes[i - 1].end as number);
				if (gap >= ticksPerBar) {
					blocks.push({ start: blockStart, end: blockEnd });
					blockStart = sortedNotes[i].start;
					blockEnd = sortedNotes[i].end as number;
				} else {
					blockEnd = sortedNotes[i].end as number;
				}
			}
			blocks.push({ start: blockStart, end: blockEnd });
			return blocks.every((b) => b.end - b.start < ticksPer8Bars);
		};

		channelAnalysis[channel] = {
			avgPitch,
			maxSimultaneous,
			hasSubmelodyPattern: isSubmelodyPattern(),
		};
	}

	const channels = Object.keys(channelNotes)
		.map(Number)
		.sort((a, b) => a - b);
	const sortedByPitch = [...channels].sort(
		(a, b) => channelAnalysis[a].avgPitch - channelAnalysis[b].avgPitch,
	);

	const bassThreshold =
		channelAnalysis[sortedByPitch[Math.floor(sortedByPitch.length / 4)]]
			?.avgPitch ?? 60;
	const bassChannels = channels.filter(
		(ch) =>
			channelAnalysis[ch].avgPitch <= bassThreshold &&
			channelAnalysis[ch].maxSimultaneous <= 2,
	);
	const melodyTypeChannels = channels.filter(
		(ch) =>
			channelAnalysis[ch].maxSimultaneous <= 1 && !bassChannels.includes(ch),
	);
	const submelodyChannels = melodyTypeChannels.filter(
		(ch) => channelAnalysis[ch].hasSubmelodyPattern,
	);
	const melodyChannels = melodyTypeChannels.filter(
		(ch) => !channelAnalysis[ch].hasSubmelodyPattern,
	);
	const chordChannels = channels.filter(
		(ch) =>
			!bassChannels.includes(ch) &&
			!melodyChannels.includes(ch) &&
			!submelodyChannels.includes(ch),
	);

	const channelToTrack: Record<string, number[]> = {
		melody: melodyChannels,
		submelody: submelodyChannels,
		bass: bassChannels,
		chord: chordChannels,
	};

	const placements: MidiNotePlacement[] = [];
	const ticksPerStep = ticksPerBeat / STEPS_PER_BEAT;

	for (const [channelStr, notes] of Object.entries(channelNotes)) {
		const channel = Number.parseInt(channelStr, 10);
		let trackId: string | null = null;
		for (const [tid, chs] of Object.entries(channelToTrack)) {
			if (chs.includes(channel)) {
				trackId = tid;
				break;
			}
		}
		if (!trackId) continue;

		for (const note of notes) {
			if (note.end === null) continue;
			const startStep = Math.round(note.start / ticksPerStep);
			const durationSteps = Math.max(
				1,
				Math.round((note.end - note.start) / ticksPerStep),
			);
			placements.push({
				trackId,
				startStep,
				pitch: note.pitch,
				durationSteps,
				velocity: note.velocity,
			});
		}
	}

	return { placements, bpm };
};

/**
 * 上級者モード用：MIDIトラックインデックス N → DAW トラック trackIds[N] へ直接マッピング。
 * 自動分類なし。選択された MIDI トラック K のノートは DAW トラック K に入る。
 */
export const extractMidiPlacementsByTrack = (
	midi: unknown,
	selectedIndices: number[],
	trackIds: string[],
): MidiExtraction => {
	const { track, timeDivision } = midi as MidiData;
	const ticksPerBeat = timeDivision;
	const bpm = getMidiBPM(midi);
	const ticksPerStep = ticksPerBeat / STEPS_PER_BEAT;

	const placements: MidiNotePlacement[] = [];
	const selectedSet = new Set(selectedIndices);

	for (let midiIdx = 0; midiIdx < track.length; midiIdx++) {
		if (!selectedSet.has(midiIdx)) continue;
		if (midiIdx >= trackIds.length) continue;
		const trackId = trackIds[midiIdx];
		const trackData = track[midiIdx];
		if (!trackData) continue;

		type RawNote = {
			pitch: number;
			velocity: number;
			start: number;
			end: number | null;
		};
		const active: RawNote[] = [];
		let currentTime = 0;

		for (const event of trackData.event) {
			currentTime += event.deltaTime;
			if (event.channel === 9) continue; // ドラムチャンネルはスキップ
			if (event.type !== 8 && event.type !== 9) continue;
			const [pitch, velocity] = event.data as number[];
			const isOff = event.type === 8 || !velocity;

			if (isOff) {
				for (let i = active.length - 1; i >= 0; i--) {
					if (active[i].pitch === pitch && active[i].end === null) {
						active[i].end = currentTime;
						break;
					}
				}
			} else {
				active.push({ pitch, velocity, start: currentTime, end: null });
			}
		}

		for (const note of active) {
			if (note.end === null) continue;
			const startStep = Math.round(note.start / ticksPerStep);
			const durationSteps = Math.max(
				1,
				Math.round((note.end - note.start) / ticksPerStep),
			);
			placements.push({
				trackId,
				startStep,
				pitch: note.pitch,
				durationSteps,
				velocity: note.velocity,
			});
		}
	}

	return { placements, bpm };
};

// ============================================================
// MIDI出力
// ============================================================

const to2byte = (n: number): number[] => [(n & 0xff00) >> 8, n & 0xff];
const to3byte = (n: number): number[] => [(n & 0xff0000) >> 16, ...to2byte(n)];
const to4byte = (n: number): number[] => [
	(n & 0xff000000) >> 24,
	...to3byte(n),
];
const deltaTime = (n: number): number[] => {
	const res: number[] = [n & 0x7f];
	let v = n >> 7;
	while (v > 0) {
		res.push((v & 0x7f) | 0x80);
		v >>= 7;
	}
	return res.reverse();
};
const headerChunks = (arr: number[], trackCount: number, div: number): void => {
	arr.push(0x4d, 0x54, 0x68, 0x64);
	arr.push(...to4byte(6));
	arr.push(...to2byte(1));
	arr.push(...to2byte(trackCount));
	arr.push(...to2byte(div));
};
const trackChunks = (arr: number[], func: (a: number[]) => void): void => {
	arr.push(0x4d, 0x54, 0x72, 0x6b);
	const a: number[] = [];
	func(a);
	a.push(...deltaTime(0));
	a.push(0xff, 0x2f, 0x00);
	arr.push(...to4byte(a.length));
	arr.push(...a);
};

export type ExportMidiOptions = {
	tracks: { notes: Note[]; volume: number }[];
	drumPattern?: DrumPattern;
	drumVolume?: number; // 0-100
	bpm: number;
	stepsPerBar: number;
};

/**
 * トラック群とドラムパターンから .mid バイナリ(Blob)を生成する。
 */
export const exportMIDI = (options: ExportMidiOptions): Blob => {
	const { tracks, drumPattern, drumVolume = 80, bpm, stepsPerBar } = options;
	const div = 480;
	const tickPerStep = div / STEPS_PER_BEAT;
	const midiTracks: { t: number; m: number[] }[][] = [];

	tracks.forEach((track, ch) => {
		if (track.notes.length === 0) return;
		const events: { t: number; m: number[] }[] = [];
		for (const n of track.notes) {
			const startTick = Math.round(n.startStep * tickPerStep);
			const endTick = Math.round(
				(n.startStep + (n.durationSteps || 1)) * tickPerStep,
			);
			// volume 0（ミュート）を 100 に化けさせないため ?? を使う（0 は有効値）
			const vel = Math.round(
				((n.velocity ?? DEFAULT_VELOCITY) * (track.volume ?? 100)) / 100,
			);
			events.push({ t: startTick, m: [0x90 | (ch & 0x0f), n.pitch, vel] });
			events.push({ t: endTick, m: [0x90 | (ch & 0x0f), n.pitch, 0] });
		}
		events.sort((a, b) => a.t - b.t);
		midiTracks.push(events);
	});

	// ドラムトラック
	if (drumPattern && drumPattern.length > 0) {
		const maxStep = Math.max(
			...tracks
				.filter((t) => t.notes.length > 0)
				.map((t) =>
					Math.max(...t.notes.map((n) => n.startStep + n.durationSteps)),
				),
			stepsPerBar,
		);
		const drumEvents: { t: number; m: number[] }[] = [];
		const numBars = Math.ceil(maxStep / stepsPerBar);
		for (let bar = 0; bar < numBars; bar++) {
			const barStart = bar * stepsPerBar;
			for (const drum of drumPattern) {
				const step = barStart + drum.step;
				if (step >= maxStep) continue;
				const vel = Math.round(
					(drum.velocity ?? 1.0) * (drumVolume / 100) * 127,
				);
				drumEvents.push({
					t: Math.round(step * tickPerStep),
					m: [0x99, drum.pitch, vel],
				});
				drumEvents.push({
					t: Math.round((step + 1) * tickPerStep),
					m: [0x99, drum.pitch, 0],
				});
			}
		}
		drumEvents.sort((a, b) => a.t - b.t);
		if (drumEvents.length > 0) midiTracks.push(drumEvents);
	}

	const arr: number[] = [];
	headerChunks(arr, midiTracks.length + 1, div);
	trackChunks(arr, (a) => {
		a.push(0, 0xff, 0x51, 0x03, ...to3byte(Math.round(6e7 / bpm)));
	});
	for (const events of midiTracks) {
		trackChunks(arr, (a) => {
			let lastTick = 0;
			for (const ev of events) {
				a.push(...deltaTime(ev.t - lastTick), ...ev.m);
				lastTick = ev.t;
			}
		});
	}

	return new Blob([new Uint8Array(arr).buffer], { type: "audio/midi" });
};
