/**
 * 再生シーケンサ。タイムライン計算と先読みスケジューリングを担い、
 * 実際の発音は注入されたフック（onPlayNote / onPlayDrum）へ委譲する。
 * 描画（プレイヘッド・オートスクロール）は onTick 経由で呼び出し側へ。
 *
 * 旧 demo/index.html の startPlayback / updatePlayback / stopPlayback を移植・整理。
 */

import type { DrumPattern } from "./drum-config";
import type {
	LoopConfig,
	LoopPoint,
	Note,
	PlaybackCue,
	PlayDrumEvent,
	PlayNoteEvent,
} from "./types";
import { DEFAULT_PLAYBACK_VELOCITY } from "./types";

const STEPS_PER_BEAT = 48;
// 先読み秒。ノートは AudioContext クロックへ最大この秒数だけ先に予約される。
// 歌声合成（worldline.renderNote ≈ 200ms/音）がメインスレッドを単発で塞いでも、
// 楽器・ドラムは既にこの分だけ先までスケジュール済みなので音切れ・もたつきが起きない。
// renderNote の最大ブロック(~200ms)を十分上回る値にする。
const PLAN_TIME = 0.5;
const TICK_INTERVAL_MS = 20;
/** ステップ位置の比較に使う許容誤差（浮動小数の丸め対策）。 */
const STEP_EPSILON = 1e-4;

export type SequencerTrack = {
	id: string;
	volume: number; // 0-127
	notes: Note[];
};

export type SequencerOptions = {
	getTracks: () => SequencerTrack[];
	getBpm: () => number;
	getPlayStartStep: () => number;
	getDrumPattern: (currentBar: number) => DrumPattern | null;
	/** ソロ対象トラックID（null=ソロ無効） */
	getSoloTrackId: () => string | null;
	/**
	 * ループ再生設定（BGM用途）。
	 * boolean または詳細な LoopConfig を指定可能。
	 */
	getLoop?: () => boolean | LoopConfig;
	/** 再生中にイベントを発火させるタイミング */
	cues?: PlaybackCue[];
	/** キューポイント通過時のコールバック */
	onCue?: (cueId: string) => void;
	getAudioTime: () => number;
	onPlayNote: (e: PlayNoteEvent) => void;
	onPlayDrum: (e: PlayDrumEvent) => void;
	/** 毎フレーム currentPlayStep を通知（プレイヘッド/オートスクロール用） */
	onTick: (currentPlayStep: number) => void;
	onEnd: (interrupted?: boolean) => void;
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

export const resolveLoopPoint = (
	point: LoopPoint,
	_bpm: number,
	stepsPerBar: number,
	sps: number,
): number => {
	if ("step" in point) {
		return point.step;
	}
	if ("bar" in point) {
		return Math.max(0, point.bar - 1) * stepsPerBar;
	}
	if ("seconds" in point) {
		return point.seconds / sps;
	}
	return 0;
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

	let lastRealTime = -1;
	let lastAudioTime = -1;

	// ループ関連の状態
	let isLooping = false;
	let loopStartStep = 0;
	let loopEndStep = 0;
	let loopStartSec = 0;
	let loopEndSec = 0;
	let loopDurationSec = 0;
	let loopStartIndex = 0;
	let loopBase = 0;

	// ドラム関連の状態。drumCursor は「ここまで予約済み」の絶対ステップ位置（排他）、
	// lastDrumStep は前ティックの再生位置（ループで巻き戻ったかの判定用）。
	let drumCursor = 0;
	let lastDrumStep = Number.NEGATIVE_INFINITY;

	// キュー関連の状態
	let lastPlayStep = 0;

	const secondsPerStep = (): number => 60 / options.getBpm() / STEPS_PER_BEAT;

	const getWrappedPlayStep = (time: number, sps: number): number => {
		if (!isLooping || loopDurationSec <= 0 || time < loopEndSec) {
			return fromStepValue + time / sps;
		}
		const elapsedInLoop = (time - loopEndSec) % loopDurationSec;
		return loopStartStep + elapsedInLoop / sps;
	};

	const buildTimeline = (fromStep: number): void => {
		timeline = [];
		trackVolumeMap = new Map();
		const sps = secondsPerStep();
		const bpm = options.getBpm();
		const stepsPerBar = options.stepsPerBar;

		const loopOption = options.getLoop?.() ?? false;
		isLooping = !!loopOption;

		if (typeof loopOption === "object") {
			loopStartStep = loopOption.start
				? resolveLoopPoint(loopOption.start, bpm, stepsPerBar, sps)
				: 0;
			const endVal = loopOption.end
				? resolveLoopPoint(loopOption.end, bpm, stepsPerBar, sps)
				: null;
			loopEndStep = endVal !== null ? endVal : -1;
		} else {
			loopStartStep = 0;
			loopEndStep = -1;
		}

		const startLimit = isLooping ? Math.min(fromStep, loopStartStep) : fromStep;

		let maxEndStep = 0;
		for (const track of options.getTracks()) {
			trackVolumeMap.set(track.id, track.volume);
			for (const note of track.notes) {
				if (note.startStep < startLimit) continue;
				const relativeStart = note.startStep - fromStep;
				const when = relativeStart * sps;
				const duration = note.durationSteps * sps;
				maxEndStep = Math.max(maxEndStep, note.startStep + note.durationSteps);
				timeline.push({
					trackId: track.id,
					pitch: note.pitchUnits,
					volume: track.volume / 100,
					velocity: note.velocity ?? DEFAULT_PLAYBACK_VELOCITY,
					when,
					duration,
				});
			}
		}
		timeline.sort((a, b) => a.when - b.when);

		if (loopEndStep === -1) {
			loopEndStep = maxEndStep;
		}

		loopStartSec = (loopStartStep - fromStep) * sps;
		loopEndSec = (loopEndStep - fromStep) * sps;
		loopDurationSec = loopEndSec - loopStartSec;

		// ループ開始位置に対応するタイムラインの開始インデックスを見つける
		loopStartIndex = 0;
		while (loopStartIndex < timeline.length) {
			const noteStartStep = fromStep + timeline[loopStartIndex].when / sps;
			if (noteStartStep >= loopStartStep - 0.0001) {
				break;
			}
			loopStartIndex++;
		}
	};

	const scheduleTick = (): void => {
		const sps = secondsPerStep();
		const time = options.getAudioTime() - startTime;
		const soloId = options.getSoloTrackId();

		// 割り込み・大幅な遅延の検知
		const nowReal = performance.now() / 1000;
		if (lastRealTime > 0 && lastAudioTime >= 0) {
			const realDelta = nowReal - lastRealTime;
			const audioDelta = time - lastAudioTime;
			if (realDelta > 0.5 || audioDelta > 0.5) {
				console.warn(
					`[sequencer] Interruption detected (realDelta: ${realDelta.toFixed(3)}s, audioDelta: ${audioDelta.toFixed(3)}s). Stopping playback.`,
				);
				stop();
				options.onEnd(true);
				return;
			}
		}
		lastRealTime = nowReal;
		lastAudioTime = time;

		// トラック音量をリアルタイムで更新
		for (const track of options.getTracks()) {
			trackVolumeMap.set(track.id, track.volume);
		}

		// メロディックノート
		while (true) {
			let ev = timeline[nowIndex];
			if (
				nowIndex >= timeline.length ||
				(isLooping && ev && ev.when >= loopEndSec)
			) {
				if (!isLooping || loopDurationSec <= 0) break;
				nowIndex = loopStartIndex;
				loopBase += loopDurationSec;
				ev = timeline[nowIndex];
			}

			if (!ev) break;

			const _when = ev.when + loopBase - time;
			if (_when > PLAN_TIME) break;
			nowIndex++;

			if (soloId && ev.trackId !== soloId) continue;
			const velocityVolume = ev.velocity / 127;
			const currentVolume =
				(trackVolumeMap.get(ev.trackId) ?? ev.volume * 100) / 100;
			options.onPlayNote({
				trackId: ev.trackId,
				pitchUnits: ev.pitch,
				velocity: ev.velocity,
				volume: currentVolume * velocityVolume,
				when: Math.max(0, _when),
				duration: ev.duration,
			});
		}

		// ドラム（小節ループ）。実際の音量スケールは onPlayDrum 側で適用する。
		//
		// メロディックノートと同様に「どこまで予約したか」をカーソルで持ち、
		// (drumCursor, drumScanTo] の半開区間だけを1回ずつ予約する。
		// 以前は毎ティック「現在位置から4step先まで」の窓を丸ごと走査していたため、
		// 窓幅(4step)がティック間隔(20ms)より広い通常のテンポでは同じ一打が2〜6回
		// 重複して予約され、同じ時刻に音が重なって不自然に大きく鳴っていた
		// （逆に極端な高速テンポでは窓がティック間隔より狭くなり打ち漏らしていた）。
		const { stepsPerBar } = options;
		const currentStep = getWrappedPlayStep(time, sps);
		// ループで先頭へ巻き戻ったらカーソルもループ先頭へ戻す
		if (
			isLooping &&
			loopDurationSec > 0 &&
			currentStep + STEP_EPSILON < lastDrumStep
		) {
			drumCursor = loopStartStep - STEP_EPSILON;
		}
		lastDrumStep = currentStep;
		// 先読み量は音符と揃える（PLAN_TIME秒ぶん）。ループ時は末尾を越えない。
		// ループ終端ちょうどにある一打は「次の周回の先頭」と同じ位置なので、
		// 巻き戻り後に1回だけ予約されるようここでは含めない（含めると二度鳴る）。
		let drumScanTo = currentStep + PLAN_TIME / sps;
		if (isLooping && loopDurationSec > 0) {
			drumScanTo = Math.min(drumScanTo, loopEndStep - STEP_EPSILON);
		}
		if (drumScanTo > drumCursor) {
			const firstBar = Math.floor(Math.max(0, drumCursor) / stepsPerBar);
			const lastBar = Math.floor(Math.max(0, drumScanTo) / stepsPerBar);
			for (let bar = firstBar; bar <= lastBar; bar++) {
				const pattern = options.getDrumPattern(bar + 1);
				if (!pattern || pattern.length === 0) continue;
				for (const drum of pattern) {
					const absStep = bar * stepsPerBar + drum.step;
					if (absStep <= drumCursor || absStep > drumScanTo) continue;
					options.onPlayDrum({
						pitch: drum.pitch,
						velocity: drum.velocity ?? 1.0,
						when: Math.max(0, (absStep - currentStep) * sps),
						duration: 0.1,
					});
				}
			}
			drumCursor = drumScanTo;
		}

		// 再生中のキュー（イベント）監視・発火
		if (time >= 0) {
			const currentStep = getWrappedPlayStep(time, sps);
			if (options.cues && options.cues.length > 0 && options.onCue) {
				const bpm = options.getBpm();
				const stepsPerBar = options.stepsPerBar;

				const isCueCrossed = (
					cueStep: number,
					prevStep: number,
					currStep: number,
				): boolean => {
					if (currStep >= prevStep) {
						return cueStep > prevStep && cueStep <= currStep;
					} else {
						const reachedEnd = cueStep > prevStep && cueStep <= loopEndStep;
						const startedNew = cueStep >= loopStartStep && cueStep <= currStep;
						return reachedEnd || startedNew;
					}
				};

				for (const cue of options.cues) {
					const cueStep = resolveLoopPoint(cue.time, bpm, stepsPerBar, sps);
					if (isCueCrossed(cueStep, lastPlayStep, currentStep)) {
						options.onCue(cue.id);
					}
				}
			}
			lastPlayStep = currentStep;
		}

		// 終了判定（ループ時は曲末で止めない）
		if (!isLooping) {
			const last = timeline[timeline.length - 1];
			const lastWhen = last?.when ?? 0;
			const lastDuration = last?.duration ?? 0;
			if (nowIndex >= timeline.length && time > lastWhen + lastDuration + 0.1) {
				stop();
				options.onEnd(false);
			}
		}
	};

	const animate = (): void => {
		if (!active) return;
		const sps = secondsPerStep();
		const time = options.getAudioTime() - startTime;
		options.onTick(getWrappedPlayStep(time, sps));
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
		if (timeline.length === 0 && !options.getDrumPattern(1)?.length) return;
		active = true;
		startTime = options.getAudioTime() + START_DELAY;

		const sps = secondsPerStep();
		nowIndex = 0;
		while (nowIndex < timeline.length) {
			const noteStartStep = fromStepValue + timeline[nowIndex].when / sps;
			if (noteStartStep >= fromStepValue - 0.0001) {
				break;
			}
			nowIndex++;
		}

		loopBase = 0;
		// 再生開始位置ちょうどにあるドラムも1回予約されるよう、カーソルは僅かに手前へ置く
		drumCursor = fromStepValue - STEP_EPSILON;
		lastDrumStep = Number.NEGATIVE_INFINITY;
		lastPlayStep = fromStepValue - 0.0001;
		lastRealTime = -1;
		lastAudioTime = -1;
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
