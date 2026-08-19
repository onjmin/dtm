/**
 * playMML — DOM非依存（ヘッドレス）の MML 再生関数。
 *
 * mountMmlPlayer が「絵文字・プレイヘッド付きの再生ビュー」なのに対し、こちらは
 * 画面を一切持たず音だけを鳴らす。ゲームの BGM のように「文字列を渡して鳴らし、
 * 止めたいときに止める」用途を想定している。
 *
 * 設計の要点:
 *   - 発音そのものは Web Audio のオーディオスレッド上で行われる（未来時刻に予約するため
 *     メインスレッドの負荷と独立して鳴る）。スケジューラは createSequencer の先読み方式。
 *   - `loop: true` で曲末停止せずシームレスにループ（BGM用）。
 *   - AudioContext を外から注入でき、出力先ノード（ゲームのマスターGain/ミキサー）へ繋げる。
 *   - タブが非アクティブになったら一時停止する挙動を、ctx の所有権に応じて自動で行う:
 *       内部生成 ctx … 既定で suspend/resume する（自分の ctx なので止めてよい）。
 *       注入 ctx     … 既定では触らない（SE 等と共有している可能性があるため）。
 *                      代わりに返り値の suspend()/resume() を呼び出し側から叩ける。
 *
 * 歌声合成（@@n 歌詞トラック）はこのヘッドレス関数では未対応（楽器・ドラムのみ）。
 * 歌声が必要なら mountMmlPlayer / createDtmStudio を使う。
 */

import { type ChannelStrip, createChannelStrip } from "./channel-strip";
import { buildChordPlacements, type ChordPatternType } from "./chords";
import {
	type AnyDrumPattern,
	DRUM_PATTERNS,
	type DrumPatternDef,
	normalizeDrumPatterns,
	resolveDrumPattern,
} from "./drum-config";
import { parseMML } from "./mml-parser";
import {
	createReverbImpulse,
	DEFAULT_REVERB_DECAY_SEC,
	DEFAULT_REVERB_PREDELAY_MS,
	MAX_REVERB_PREDELAY_MS,
	reverbAmountToGain,
} from "./reverb";
import { createSequencer, type SequencerTrack } from "./sequencer";
import { SONG_DRUM_PATTERNS } from "./song-drum-config";
import { createSynth, type Synth } from "./synth";
import type {
	LoopConfig,
	Note,
	PlaybackCue,
	PlayDrumEvent,
	PlayNoteEvent,
} from "./types";
import { DEFAULT_BPM } from "./types";

const STEPS_PER_BAR = 192;

/** trackIndex → DAWと同じ trackId 文字列。studio.ts の楽器解決と合わせるために必要。 */
const TRACK_ID_BY_INDEX = ["melody", "submelody", "bass", "chord"] as const;

export type PlayMmlOptions = {
	/** ループ設定（true=全体ループ、LoopConfig=特定範囲ループ、false/省略=ループなし） */
	loop?: boolean | LoopConfig;
	/** 再生中にイベントを発火させるタイミング */
	cues?: PlaybackCue[];
	/** キューポイント通過時のコールバック */
	onCue?: (cueId: string) => void;

	/**
	 * 使用する AudioContext。省略時は内部生成し、destroy()/stop() で閉じる。
	 * onPlayNote で自前シンセを鳴らす場合は、時計をそろえるため自分の ctx を渡すこと。
	 */
	audioContext?: AudioContext;
	/** 出力先ノード（省略時は ctx.destination）。ゲームのマスターGain 等へ繋ぐ。 */
	destination?: AudioNode;
	/** 0-100 のマスタ音量。既定は MML の #volume → このオプション → 100 の順で解決。 */
	volume?: number;
	/** BPM未検出時のフォールバック。既定120 */
	defaultBpm?: number;
	/** ドラムパターン辞書。既定は DRUM_PATTERNS */
	drumPatterns?: Record<string, AnyDrumPattern | DrumPatternDef>;
	/** 内蔵 square synth を使うか。既定は onPlayNote 未指定なら true */
	synth?: boolean;
	/** メロディックノートの発音要求（自前シンセに繋ぐ）。 */
	onPlayNote?: (e: PlayNoteEvent) => void;
	/** ドラムノートの発音要求。 */
	onPlayDrum?: (e: PlayDrumEvent) => void;
	/** 再生開始時に呼ばれる（追加の resume 処理等に使う）。 */
	onResumeAudio?: () => void | Promise<void>;
	/**
	 * タブ非アクティブ時に自動で suspend/resume するか。
	 * 既定は「内部生成 ctx のとき true / 注入 ctx のとき false」。
	 * 注入 ctx で true にすると、共有 ctx ごと suspend する点に注意。
	 */
	pauseWhenHidden?: boolean;
	/** ループ無効時に曲末（または stop()）で呼ばれる。 */
	onStop?: () => void;
	/** 再生中のステップ更新（1/192小節ごと）時のコールバック */
	onTick?: (step: number) => void;
	/** 再生開始位置（ステップ単位）。指定すると途中から再生する。 */
	startStep?: number;
};

export type MmlPlayback = {
	/** 再生を止める（ループ中でも停止）。 */
	stop: () => void;
	isPlaying: () => boolean;
	/** マスタ音量を 0-100 で変更する（再生中も即時反映）。 */
	setVolume: (volume: number) => void;
	/** AudioContext を suspend（注入 ctx の場合、共有先も止まる点に注意）。 */
	suspend: () => Promise<void>;
	/** suspend からの復帰。 */
	resume: () => Promise<void>;
	/** 停止し、内部生成 ctx なら閉じてリスナも解除する。 */
	destroy: () => void;
};

export type PlayPlacementsOptions = PlayMmlOptions & {
	bpm: number;
	metaVolume?: number;
	metaDrum?: string;
	metaDrumVolume?: number;
	/** マスタリバーブの掛かり具合 0-100（エディタの `#reverb=` 相当）。省略時0。 */
	metaReverb?: number;
	/** マスタリバーブのDecayを10倍した整数（3〜40 → 0.3〜4.0秒）。省略時22。 */
	metaReverbDecay?: number;
	/** マスタリバーブのPre Delay（ms）。省略時0。 */
	metaReverbPreDelay?: number;
	/** トラック（trackIndex）ごとのコンプレッサー量 0-100。 */
	trackCompression?: Record<number, number>;
	/** トラック（trackIndex）ごとのステレオ幅 0-200。 */
	trackWidth?: Record<number, number>;
	/** トラック（trackIndex）ごとのマスタリバーブへのセンド量 0-100。 */
	trackReverbSend?: Record<number, number>;
	/** トラック（trackIndex）ごとのEQ低域ゲイン -12〜+12dB。 */
	trackEqLow?: Record<number, number>;
	/** トラック（trackIndex）ごとのEQ中域ゲイン -12〜+12dB。 */
	trackEqMid?: Record<number, number>;
	/** トラック（trackIndex）ごとのEQ高域ゲイン -12〜+12dB。 */
	trackEqHigh?: Record<number, number>;
};

/**
 * パース済みの配置データ（placements）を画面なしで再生する。
 */
export const playPlacements = (
	placements: Array<{
		trackIndex: number;
		startStep: number;
		durationSteps: number;
		pitch: number;
		velocity: number;
	}>,
	options: PlayPlacementsOptions,
): MmlPlayback => {
	const bpm = options.bpm;
	const drumPatternDict = {
		...DRUM_PATTERNS,
		...SONG_DRUM_PATTERNS,
		...normalizeDrumPatterns(options.drumPatterns ?? {}),
	};
	const drumPatternName = options.metaDrum ?? "none";

	let masterVolume = options.metaVolume ?? options.volume ?? 100;
	const drumVolume = options.metaDrumVolume ?? 80;

	// placements を trackIndex ごとに単音列へまとめる
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
			volume: masterVolume,
			notes,
		};
	});

	// ── AudioContext / 発音器 ──
	const ownsCtx = !options.audioContext;
	const ctx = options.audioContext ?? new AudioContext();
	const rawDestination = options.destination ?? ctx.destination;
	const useSynth = options.synth ?? !options.onPlayNote;

	// ── エフェクトチェーン（DAWエディタと同一構成をヘッドレスでも常時適用する）──
	// [各トラックのチャンネルストリップ] → masterGain(ドライ) ─┐
	//                     └→ reverbSend → preDelay → convolver → wetGain ─┴→ finalMix → destination
	// 画面を持たないプレイヤーだが、エディタで聴いた音圧・EQ・リバーブ感をそのまま
	// 再現するため、常にこのストリップを経由させる（bypassオプションは設けない）。
	const finalMix = ctx.createGain();
	const masterGain = ctx.createGain();
	masterGain.connect(finalMix);

	const reverbPreDelay = ctx.createDelay(MAX_REVERB_PREDELAY_MS / 1000);
	reverbPreDelay.delayTime.value =
		(options.metaReverbPreDelay ?? DEFAULT_REVERB_PREDELAY_MS) / 1000;
	const reverbConvolver = ctx.createConvolver();
	const reverbDecaySec =
		(options.metaReverbDecay ?? 22) / 10 || DEFAULT_REVERB_DECAY_SEC;
	reverbConvolver.buffer = createReverbImpulse(ctx, reverbDecaySec);
	reverbConvolver.normalize = true;
	const reverbWetGain = ctx.createGain();
	reverbWetGain.gain.value = reverbAmountToGain(options.metaReverb ?? 0);
	reverbPreDelay.connect(reverbConvolver);
	reverbConvolver.connect(reverbWetGain);
	reverbWetGain.connect(finalMix);

	finalMix.connect(rawDestination);

	// トラック単位チャンネルストリップ（コンプレッサー＋EQ＋ステレオワイド＋リバーブ送り）。
	// trackIndex ごとに1本ずつ遅延生成してキャッシュする。
	const channelStrips = new Map<number, ChannelStrip>();
	const getChannelStrip = (index: number): ChannelStrip => {
		let strip = channelStrips.get(index);
		if (!strip) {
			strip = createChannelStrip(ctx, masterGain, {
				compression: options.trackCompression?.[index] ?? 0,
				width: options.trackWidth?.[index] ?? 100,
				eqLow: options.trackEqLow?.[index] ?? 0,
				eqMid: options.trackEqMid?.[index] ?? 0,
				eqHigh: options.trackEqHigh?.[index] ?? 0,
				reverbSend: options.trackReverbSend?.[index] ?? 0,
				reverbBus: reverbPreDelay,
			});
			channelStrips.set(index, strip);
		}
		return strip;
	};

	// 発音器はトラック（チャンネルストリップの入口）ごとに1つ持つ。ドラムはエディタと
	// 同様にチャンネルストリップを経由せず masterGain へ直結する（EQ/リバーブ対象外）。
	const synths = new Map<number, Synth>();
	const getSynth = (index: number): Synth => {
		let s = synths.get(index);
		if (!s) {
			s = createSynth(ctx, getChannelStrip(index).input);
			synths.set(index, s);
		}
		return s;
	};
	const drumSynth: Synth | null = useSynth
		? createSynth(ctx, masterGain)
		: null;

	// PlayNoteEvent.trackId ("melody"等) → trackIndex の逆引き（チャンネルストリップ選択用）。
	const trackIndexById = new Map<string, number>();
	trackIndices.forEach((idx) => {
		trackIndexById.set(TRACK_ID_BY_INDEX[idx] ?? `t${idx}`, idx);
	});

	// 非アクティブ時の自動 suspend/resume は、自分の ctx を持つときだけ既定ON。
	const pauseWhenHidden = options.pauseWhenHidden ?? ownsCtx;

	let playing = false;

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
			options.onPlayNote?.(e);
			if (!useSynth) return;
			const index = trackIndexById.get(e.trackId);
			(index === undefined ? drumSynth : getSynth(index))?.playNote(e);
		},
		onPlayDrum: (e) => {
			const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
			drumSynth?.playDrum({ ...e, velocity });
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
		options.onStop?.();
	};

	// ── 非アクティブ時の自動一時停止 ──
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

	// ── 再生開始 ──
	playing = true;
	void (async () => {
		const resumes: Promise<void>[] = [];
		const r = options.onResumeAudio?.();
		if (r) resumes.push(r);
		if (ctx.state === "suspended") resumes.push(ctx.resume());
		if (resumes.length > 0) await Promise.all(resumes);
		if (!playing) return; // 待機中に stop されていたら起動しない
		seq.start(options.startStep ?? 0);
	})();

	const stop = (): void => {
		if (!playing) return;
		seq.stop();
		finish();
	};

	const setVolume = (volume: number): void => {
		masterVolume = volume;
		for (const t of seqTracks) t.volume = volume;
	};

	const suspend = (): Promise<void> => ctx.suspend();
	const resume = (): Promise<void> => ctx.resume();

	const destroy = (): void => {
		seq.stop();
		playing = false;
		if (pauseWhenHidden && typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", onVisibilityChange);
		}
		for (const strip of channelStrips.values()) strip.dispose();
		if (ownsCtx) void ctx.close();
	};

	return {
		stop,
		isPlaying: () => playing,
		setVolume,
		suspend,
		resume,
		destroy,
	};
};

/**
 * MML 文字列を画面なしで再生する。呼び出した時点で再生を開始する。
 * ブラウザの自動再生ポリシー上、初回はユーザー操作のコールスタック内で呼ぶこと。
 */
export const playMML = (
	mml: string,
	options: PlayMmlOptions = {},
): MmlPlayback => {
	const { placements, bpm: parsedBpm, meta } = parseMML(mml);
	const bpm = parsedBpm ?? options.defaultBpm ?? DEFAULT_BPM;
	return playPlacements(placements, {
		...options,
		bpm,
		metaVolume: meta.volume,
		metaDrum: meta.drum,
		metaDrumVolume: meta.drumVolume,
		metaReverb: meta.reverb,
		metaReverbDecay: meta.reverbDecay,
		metaReverbPreDelay: meta.reverbPreDelay,
		trackCompression: meta.trackCompression,
		trackWidth: meta.trackWidth,
		trackReverbSend: meta.trackReverbSend,
		trackEqLow: meta.trackEqLow,
		trackEqMid: meta.trackEqMid,
		trackEqHigh: meta.trackEqHigh,
	});
};

export type PlayNoteOptions = {
	audioContext?: AudioContext;
	destination?: AudioNode;
	pitch: number;
	volume?: number;
	duration?: number;
};

/**
 * 簡易な単音（軽量シンセ）を再生する。
 */
export const playNote = (options: PlayNoteOptions): void => {
	const ctx = options.audioContext ?? new AudioContext();
	const destination = options.destination ?? ctx.destination;
	const synth = createSynth(ctx, destination);
	const vol = options.volume ?? 80;
	const dur = options.duration ?? 1.0;

	synth.playNote({
		trackId: "melody",
		pitch: options.pitch,
		velocity: 100,
		volume: vol / 100,
		when: 0,
		duration: dur,
	});
};

export type PlayChordsOptions = PlayMmlOptions & {
	patternType?: ChordPatternType;
	rootShift?: number;
	bpm?: number;
};

/**
 * コード進行（軽量シンセ）を再生する。
 */
export const playChords = (
	chordStr: string,
	options: PlayChordsOptions = {},
): MmlPlayback => {
	const bpm = options.bpm ?? options.defaultBpm ?? DEFAULT_BPM;
	const chordPlacements = buildChordPlacements({
		chordStr,
		patternType: options.patternType ?? "block",
		rootShift: options.rootShift ?? 0,
		bpm,
		stepsPerBar: STEPS_PER_BAR,
	});

	const placements = chordPlacements.map((p) => ({
		trackIndex: 3, // 伴奏トラック
		startStep: p.startStep,
		durationSteps: p.durationSteps,
		pitch: p.pitch,
		velocity: p.velocity,
	}));

	return playPlacements(placements, {
		...options,
		bpm,
		metaVolume: options.volume ?? 100,
	});
};
