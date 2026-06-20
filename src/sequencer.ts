/**
 * 再生シーケンサ。タイムライン計算と先読みスケジューリングを担い、
 * 実際の発音は注入されたフック（onPlayNote / onPlayDrum）へ委譲する。
 * 描画（プレイヘッド・オートスクロール）は onTick 経由で呼び出し側へ。
 *
 * 旧 demo/index.html の startPlayback / updatePlayback / stopPlayback を移植・整理。
 */

import type { DrumPattern } from "./drum-config";
import { DEFAULT_PLAYBACK_VELOCITY } from "./types";
import type { Note, PlayDrumEvent, PlayNoteEvent } from "./types";

const STEPS_PER_BEAT = 48;
// 先読み秒。ノートは AudioContext クロックへ最大この秒数だけ先に予約される。
// 歌声合成（worldline.renderNote ≈ 200ms/音）がメインスレッドを単発で塞いでも、
// 楽器・ドラムは既にこの分だけ先までスケジュール済みなので音切れ・もたつきが起きない。
// renderNote の最大ブロック(~200ms)を十分上回る値にする。
const PLAN_TIME = 0.5;
const TICK_INTERVAL_MS = 20;

export type SequencerTrack = {
	id: string;
	volume: number; // 0-127
	notes: Note[];
};

export type SequencerOptions = {
	getTracks: () => SequencerTrack[];
	getBpm: () => number;
	getPlayStartStep: () => number;
	getDrumPattern: () => DrumPattern | null;
	/** ソロ対象トラックID（null=ソロ無効） */
	getSoloTrackId: () => string | null;
	getAudioTime: () => number;
	onPlayNote: (e: PlayNoteEvent) => void;
	onPlayDrum: (e: PlayDrumEvent) => void;
	/** 毎フレーム currentPlayStep を通知（プレイヘッド/オートスクロール用） */
	onTick: (currentPlayStep: number) => void;
	onEnd: () => void;
	stepsPerBar: number;
};

export type Sequencer = {
	start: (fromStep?: number) => void;
	stop: () => void;
	isActive: () => boolean;
	/**
	 * 直近の start() が確定した再生開始時刻（getAudioTimeクロック秒、START_DELAY込み）。
	 * 歌声ストリーミング等を同じアンカーで揃えるのに使う。start前は0。
	 */
	getStartTime: () => number;
};

type TimelineEvent = {
	trackId: string;
	pitch: number;
	volume: number; // 0-1
	velocity: number; // 0-127
	when: number; // 秒（fromStep基準）
	duration: number; // 秒
};

export const createSequencer = (options: SequencerOptions): Sequencer => {
	let timeline: TimelineEvent[] = [];
	let startTime = 0;
	let nowIndex = 0;
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let animationId: number | null = null;
	let active = false;
	let fromStepValue = 0;
	let trackVolumeMap: Map<string, number> = new Map();

	const secondsPerStep = (): number => 60 / options.getBpm() / STEPS_PER_BEAT;

	const buildTimeline = (fromStep: number): void => {
		timeline = [];
		trackVolumeMap = new Map();
		const sps = secondsPerStep();
		for (const track of options.getTracks()) {
			trackVolumeMap.set(track.id, track.volume);
			for (const note of track.notes) {
				const relativeStart = note.startStep - fromStep;
				if (relativeStart < 0) continue;
				const velocity = note.velocity ?? DEFAULT_PLAYBACK_VELOCITY;
				timeline.push({
					trackId: track.id,
					pitch: note.pitch,
					volume: track.volume / 100,
					velocity,
					when: relativeStart * sps,
					duration: note.durationSteps * sps,
				});
			}
		}
		timeline.sort((a, b) => a.when - b.when);
	};

	const scheduleTick = (): void => {
		const sps = secondsPerStep();
		const time = options.getAudioTime() - startTime;
		const soloId = options.getSoloTrackId();

		// トラック音量をリアルタイムで更新
		for (const track of options.getTracks()) {
			trackVolumeMap.set(track.id, track.volume);
		}

		// メロディックノート
		while (nowIndex < timeline.length) {
			const ev = timeline[nowIndex];
			if (soloId && ev.trackId !== soloId) {
				nowIndex++;
				continue;
			}
			const _when = ev.when - time;
			if (_when > PLAN_TIME) break;
			nowIndex++;
			const velocityVolume = ev.velocity / 127;
			const currentVolume =
				(trackVolumeMap.get(ev.trackId) ?? ev.volume * 100) / 100;
			options.onPlayNote({
				trackId: ev.trackId,
				pitch: ev.pitch,
				velocity: ev.velocity,
				volume: currentVolume * velocityVolume,
				when: Math.max(0, _when),
				duration: ev.duration,
			});
		}

		// ドラム（小節ループ）。実際の音量スケールは onPlayDrum 側で適用する。
		const pattern = options.getDrumPattern();
		if (pattern && pattern.length > 0) {
			const { stepsPerBar } = options;
			const currentStep =
				(fromStepValue * sps + (options.getAudioTime() - startTime)) / sps;
			const currentStepInBar = currentStep % stepsPerBar;
			const nextStep = currentStepInBar + 4;
			const crossedBar = currentStepInBar < 4;

			for (const drum of pattern) {
				const shouldPlay =
					(crossedBar && drum.step === 0) ||
					(drum.step >= currentStepInBar && drum.step < nextStep);
				if (!shouldPlay) continue;
				const whenSeconds = (drum.step - currentStepInBar) * sps;
				if (whenSeconds < -0.1 || whenSeconds > PLAN_TIME) continue;
				options.onPlayDrum({
					pitch: drum.pitch,
					velocity: drum.velocity ?? 1.0,
					when: Math.max(0, whenSeconds),
					duration: 0.1,
				});
			}
		}

		// 終了判定
		const last = timeline[timeline.length - 1];
		const lastWhen = last?.when ?? 0;
		const lastDuration = last?.duration ?? 0;
		if (nowIndex >= timeline.length && time > lastWhen + lastDuration + 0.1) {
			stop();
			options.onEnd();
		}
	};

	const animate = (): void => {
		if (!active) return;
		const sps = secondsPerStep();
		const time = options.getAudioTime() - startTime;
		options.onTick(fromStepValue + time / sps);
		animationId = requestAnimationFrame(animate);
	};

	const stop = (): void => {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		active = false;
	};

	const START_DELAY = 0.1; // 100msの安全先読みバッファ

	const start = (fromStep?: number): void => {
		stop();
		fromStepValue = fromStep ?? options.getPlayStartStep();
		buildTimeline(fromStepValue);
		if (timeline.length === 0 && !options.getDrumPattern()?.length) return;
		active = true;
		startTime = options.getAudioTime() + START_DELAY;
		nowIndex = 0;
		intervalId = setInterval(scheduleTick, TICK_INTERVAL_MS);
		animationId = requestAnimationFrame(animate);
	};

	return {
		start,
		stop,
		isActive: () => active,
		getStartTime: () => startTime,
	};
};
