/**
 * playSingingMML — 歌声付き（@@n 歌詞トラック）のヘッドレス MML 再生。
 *
 * 楽器・ドラムのみの {@link playMML} とは別関数として切り出す。歌声は重い WORLD 再合成・
 * worker のホスティング・非同期プリロードを伴うため、軽量な playMML に混ぜず分離する方針。
 * 中身は実質「mountMmlPlayer の音響経路（sequencer + 内蔵synth + 歌声ストリーム配線）から
 * DOM を抜いたもの」。
 */

import {
	type AnyDrumPattern,
	DRUM_PATTERNS,
	type DrumPatternDef,
	normalizeDrumPatterns,
	resolveDrumPattern,
} from "./drum-config";
import type { MmlPlayback, PlayMmlOptions } from "./headless-player";
import {
	createSingingVoices,
	PREWARM_NOTES,
	panToStereo,
	parseCustomVocals,
	type SingingVoices,
	type StreamVoiceNote,
	type StreamVoiceTrack,
	vocalVolumeToGain,
} from "./lyrics";
import { parseMML } from "./mml-parser";
import {
	createSequencer,
	resolveLoopPoint,
	type SequencerTrack,
} from "./sequencer";
import { SONG_DRUM_PATTERNS } from "./song-drum-config";
import { createSynth, type Synth } from "./synth";
import type { Note, PlayDrumEvent, PlayNoteEvent } from "./types";
import {
	DEFAULT_BPM,
	DEFAULT_GATE,
	DEFAULT_PAN,
	DEFAULT_VOCAL_VOLUME,
} from "./types";

const STEPS_PER_BEAT = 48;
const STEPS_PER_BAR = 192;

/** trackIndex → DAWと同じ trackId 文字列。studio.ts の楽器解決と合わせるために必要。 */
const TRACK_ID_BY_INDEX = ["melody", "submelody", "bass", "chord"] as const;

export type PlaySingingMmlOptions = PlayMmlOptions & {
	/**
	 * 歌声合成 Worker（`voice-worker.js`）のURL。利用側がホストして渡す。
	 * 省略時はメインスレッド合成へフォールバック（BGM用途では worker 推奨）。
	 */
	voiceWorkerUrl?: string;
	/**
	 * 既存の歌唱合成ヘルパを注入する（createDtmStudio と同様の配線を流用したい場合）。
	 * 指定時は voiceWorkerUrl より優先し、内部で createSingingVoices しない。
	 */
	singingVoices?: SingingVoices;
};

/**
 * 歌声付き MML を画面なしで再生する。
 *
 * @param mml MML文字列
 * @param options 再生オプション
 * @returns MmlPlayback コントロールオブジェクトを含む Promise
 */
export const playSingingMML = async (
	mml: string,
	options: PlaySingingMmlOptions = {},
): Promise<MmlPlayback> => {
	const {
		placements,
		bpm: parsedBpm,
		meta,
		lyrics,
	} = parseMML(mml, {
		collectLyrics: true,
	});
	const lyricTracks = lyrics ?? new Map();
	const customVocalByKey = new Map(
		parseCustomVocals(mml).map((d) => [d.key, d]),
	);
	const bpm = parsedBpm ?? options.defaultBpm ?? DEFAULT_BPM;
	const secondsPerStep = 60 / bpm / STEPS_PER_BEAT;

	const drumPatternDict = {
		...DRUM_PATTERNS,
		...SONG_DRUM_PATTERNS,
		...normalizeDrumPatterns(options.drumPatterns ?? {}),
	};
	const drumPatternName = meta.drum ?? "none";

	const drumVolume = meta.drumVolume ?? 80;
	const trackVolume = meta.volume ?? 100;
	let masterVolume = options.volume ?? 100;

	// placements を trackIndex ごとにまとめる
	const trackIndices = [...new Set(placements.map((p) => p.trackIndex))].sort(
		(a, b) => a - b,
	);
	const seqTracks: SequencerTrack[] = trackIndices.map((index) => {
		let id = 0;
		const notes: Note[] = placements
			.filter((p) => p.trackIndex === index)
			.map((p) => ({
				id: id++,
				startStep: p.startStep,
				durationSteps: p.durationSteps,
				pitch: p.pitch,
				velocity: p.velocity,
			}));
		return {
			id: TRACK_ID_BY_INDEX[index] ?? `t${index}`,
			volume: (trackVolume / 100) * masterVolume,
			notes,
		};
	});

	// AudioContext & Synth
	const ownsCtx = !options.audioContext;
	const ctx = options.audioContext ?? new AudioContext();
	const destination = options.destination ?? ctx.destination;
	const useSynth = options.synth ?? !options.onPlayNote;
	const synth: Synth | null = useSynth ? createSynth(ctx, destination) : null;

	const pauseWhenHidden = options.pauseWhenHidden ?? ownsCtx;

	let playing = false;
	let destroyed = false;
	let voices: SingingVoices | null = options.singingVoices ?? null;

	const buildStreamTracks = (fromStep: number): StreamVoiceTrack[] =>
		[...lyricTracks.entries()].map(([index, lt]) => {
			const seqTrack = seqTracks.find(
				(t) => t.id === (TRACK_ID_BY_INDEX[index] ?? `t${index}`),
			);
			const sorted = [...(seqTrack?.notes ?? [])].sort(
				(a, b) => a.startStep - b.startStep,
			);
			const gate = (lt.gate ?? DEFAULT_GATE) / 100;
			const semis = (lt.octave ?? 0) * 12;
			const count = Math.min(sorted.length, lt.syllables.length);
			const notes: StreamVoiceNote[] = [];
			for (let i = 0; i < count; i++) {
				const n = sorted[i];
				if (n.startStep < fromStep) continue;
				notes.push({
					syllable: lt.syllables[i],
					pitch: n.pitch + semis,
					startSec: (n.startStep - fromStep) * secondsPerStep,
					durationSec: n.durationSteps * secondsPerStep * gate,
				});
			}
			return {
				id: TRACK_ID_BY_INDEX[index] ?? `t${index}`,
				model: lt.model,
				volume: vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME),
				pan: panToStereo(lt.pan ?? DEFAULT_PAN),
				vibrato: lt.vibrato,
				reverbSend: (lt.reverb ?? 0) / 100,
				gender: (lt.gender ?? 50) / 100,
				breathiness: (lt.breathiness ?? 50) / 100,
				notes,
			};
		});

	const seq = createSequencer({
		getTracks: () => seqTracks,
		getBpm: () => bpm,
		getPlayStartStep: () => options.startStep ?? 0,
		getDrumPattern: (currentBar) =>
			resolveDrumPattern(drumPatternName, drumPatternDict, currentBar),
		getSoloTrackId: () => null,
		getLoop: () => options.loop ?? false,
		cues: options.cues,
		onCue: options.onCue,
		getAudioTime: () => ctx.currentTime,
		onPlayNote: (e) => {
			// trackId は名前付き文字列（"melody" 等）または "t4" のような形式なので、インデックスを抽出する
			const namedIdx = TRACK_ID_BY_INDEX.indexOf(
				e.trackId as (typeof TRACK_ID_BY_INDEX)[number],
			);
			let trackIdx = namedIdx >= 0 ? namedIdx : Number(e.trackId);
			if (Number.isNaN(trackIdx) && e.trackId.startsWith("t")) {
				trackIdx = Number(e.trackId.slice(1));
			}

			if (lyricTracks.has(trackIdx)) return;
			options.onPlayNote?.(e);
			synth?.playNote(e);
		},
		onPlayDrum: (e) => {
			const velocity =
				e.velocity *
				(drumVolume / 100) *
				(trackVolume / 100) *
				(masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
			synth?.playDrum({ ...e, velocity });
		},
		onTick: (step) => {
			options.onTick?.(step);
		},
		onEnd: (_interrupted) => finish(),
		stepsPerBar: STEPS_PER_BAR,
	});

	const finish = (): void => {
		if (!playing) return;
		playing = false;
		voices?.stopStream();
		options.onStop?.();
	};

	const onVisibilityChange = (): void => {
		if (!playing) return;
		if (document.hidden) {
			void ctx.suspend();
		} else if (ctx.state === "suspended") {
			void ctx.resume();
		}
	};
	if (pauseWhenHidden && typeof document !== "undefined") {
		document.addEventListener("visibilitychange", onVisibilityChange);
	}

	const stop = (): void => {
		if (!playing) return;
		seq.stop();
		finish();
	};

	const setVolume = (volume: number): void => {
		masterVolume = volume;
		const effectiveTrackVolume = (trackVolume / 100) * masterVolume;
		for (const t of seqTracks) t.volume = effectiveTrackVolume;
		voices?.setVolume((trackVolume / 100) * (masterVolume / 100));
	};

	const suspend = (): Promise<void> => ctx.suspend();
	const resume = (): Promise<void> => ctx.resume();

	const destroy = (): void => {
		seq.stop();
		playing = false;
		destroyed = true;
		voices?.reset();
		if (pauseWhenHidden && typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		}
		if (ownsCtx && ctx.state !== "closed") {
			void ctx.close();
		}
	};

	const playback: MmlPlayback = {
		stop,
		isPlaying: () => playing,
		setVolume,
		suspend,
		resume,
		destroy,
	};

	playing = true;
	try {
		const resumes: Promise<void>[] = [];
		const r = options.onResumeAudio?.();
		if (r) resumes.push(Promise.resolve(r));
		if (ctx.state === "suspended") resumes.push(ctx.resume());
		if (resumes.length > 0) await Promise.all(resumes);

		if (!playing || destroyed) {
			return playback;
		}

		if (lyricTracks.size > 0) {
			if (!voices) {
				voices = createSingingVoices(ctx, destination, {
					voiceWorkerUrl: options.voiceWorkerUrl,
				});
			}

			if (customVocalByKey.size > 0 && voices.registerVoicebanks) {
				voices.registerVoicebanks(
					Object.fromEntries([...customVocalByKey].map(([k, d]) => [k, d.url])),
				);
			}

			const streamTracks = buildStreamTracks(options.startStep ?? 0);
			await voices.loadModels(streamTracks.map((t) => t.model));
			if (!playing || destroyed) {
				return playback;
			}

			await voices.warm(streamTracks, PREWARM_NOTES);
			if (!playing || destroyed) {
				return playback;
			}

			let loopLengthSec: number | undefined;
			let loopStartSec: number | undefined;
			const loopOption = options.loop ?? false;
			if (loopOption) {
				let loopStartStep = 0;
				let loopEndStep = -1;
				if (typeof loopOption === "object") {
					loopStartStep = loopOption.start
						? resolveLoopPoint(
								loopOption.start,
								bpm,
								STEPS_PER_BAR,
								secondsPerStep,
							)
						: 0;
					const endVal = loopOption.end
						? resolveLoopPoint(
								loopOption.end,
								bpm,
								STEPS_PER_BAR,
								secondsPerStep,
							)
						: null;
					loopEndStep = endVal !== null ? endVal : -1;
				}
				if (loopEndStep === -1) {
					let maxEndStep = 0;
					for (const p of placements) {
						maxEndStep = Math.max(maxEndStep, p.startStep + p.durationSteps);
					}
					loopEndStep = maxEndStep;
				}
				loopStartSec = loopStartStep * secondsPerStep;
				loopLengthSec = (loopEndStep - loopStartStep) * secondsPerStep;
			}

			seq.start(options.startStep ?? 0);
			voices.setVolume((trackVolume / 100) * (masterVolume / 100));
			voices.startStream(streamTracks, seq.getStartTime(), {
				loopLengthSec,
				loopStartSec,
			});
		} else {
			seq.start(options.startStep ?? 0);
		}
	} catch (err) {
		stop();
		throw err;
	}

	return playback;
};
