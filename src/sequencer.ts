/**
 * 再生シーケンサ。タイムライン計算と先読みスケジューリングを担い、
 * 実際の発音は注入されたフック（onPlayNote / onPlayDrum）へ委譲する。
 * 描画（プレイヘッド・オートスクロール）は onTick 経由で呼び出し側へ。
 */

import type { DrumPattern } from "./drum-config";
import type { Units } from "./tuning";
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
/**
 * `start()` してから実際に曲が始まるまでの安全先読みバッファ（秒）。
 * 開始時刻を外から逆算したい呼び出し側（伴奏音源との待ち合わせ等）が使う。
 */
export const SEQUENCER_START_DELAY = 0.1;
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
	/**
	 * ノートが尽きても、ここで返す秒数（再生開始からの相対秒）までは曲を終わらせない。
	 *
	 * 伴奏音源（mp3等）を一緒に鳴らしているとき、打ち込みが先に終わっても曲は
	 * まだ続いている。これが無いと音源の途中で「終了」してしまい、プレイヘッドも
	 * 止まる。ノートが1つも無くても、これが正なら再生自体は走る。
	 */
	getMinEndSec?: () => number;
	onEnd: (interrupted?: boolean) => void;
	stepsPerBar: number;
};

export type Sequencer = {
	/**
	 * 再生を始める。`preRollSec` を渡すと、その秒数だけ**待ってから**曲を走らせる
	 * （伴奏音源の前奏を先に鳴らす用途。曲データには手を触れない）。
	 */
	start: (fromStep?: number, preRollSec?: number) => void;
	stop: () => void;
	isActive: () => boolean;
	/**
	 * 直近の start() が確定した再生開始時刻（getAudioTimeクロック秒、START_DELAY込み）。
	 * 歌声ストリーミング等を同じアンカーで揃えるのに使う。start前は0。
	 */
	getStartTime: () => number;
	/**
	 * 曲が終わる時刻（再生開始からの相対秒）。音符の終端と {@link SequencerOptions.getMinEndSec}
	 * の大きいほうで、ドラムの予約打ち切りと終了判定に使っているものと同じ値。
	 * フェードアウトの着地点もこれに合わせること（音符の終端で代用すると、
	 * ドラムや伴奏音源がフェードの外に出てフル音量で鳴り残る）。start前・ループ中は0。
	 */
	getEndSec: () => number;
};

type TimelineEvent = {
	trackId: string;
	/** ピッチ。単位は units（1/372オクターブ）。 */
	pitch: Units;
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

	/** 全ノートの終了時刻（when + duration）の最大値（秒）。曲の終了判定に使用。 */
	let maxTimelineEndSec = 0;

	const secondsPerStep = (): number => 60 / options.getBpm() / STEPS_PER_BEAT;

	/**
	 * 曲が終わる時刻（再生開始からの相対秒）。音符の終端と、伴奏音源のように外から
	 * 伸ばされるぶん（getMinEndSec）の大きいほう。終了判定・ドラムの予約打ち切り・
	 * フェードアウトの着地点は、すべてこの1つの値を見る。
	 */
	const currentEndSec = (): number =>
		Math.max(maxTimelineEndSec, options.getMinEndSec?.() ?? 0);

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
		maxTimelineEndSec = 0;
		for (const track of options.getTracks()) {
			trackVolumeMap.set(track.id, track.volume);
			for (const note of track.notes) {
				if (note.startStep < startLimit) continue;
				const relativeStart = note.startStep - fromStep;
				const when = relativeStart * sps;
				const duration = note.durationSteps * sps;
				maxEndStep = Math.max(maxEndStep, note.startStep + note.durationSteps);
				maxTimelineEndSec = Math.max(maxTimelineEndSec, when + duration);
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
		// (drumCursor, drumScanTo] の半開区間だけを1回ずつ予約する。固定幅の窓を毎ティック走査すると、
		// 窓幅がティック間隔より広い通常のテンポでは同じ一打を重複予約して音が重なり、逆に極端な
		// 高速テンポでは窓が狭くなって打ち漏らす。
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
		} else {
			// 曲の終わりより後ろは予約しない。先読みぶん（PLAN_TIME秒）をそのまま延ばすと、
			// 曲が終わった後もドラムだけ最大0.5秒鳴り残り、フェードアウトの着地点より後ろ＝
			// フェードの外で叩く。終端ちょうどの一打（締めのクラッシュ）は残したいので、
			// ループ側と違って終端を含める。
			drumScanTo = Math.min(drumScanTo, fromStepValue + currentEndSec() / sps);
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
			const endSec = currentEndSec();
			if (nowIndex >= timeline.length && time > endSec + 0.1) {
				stop();
				options.onEnd(false);
			}
		}
	};

	const animate = (): void => {
		if (!active) return;
		const sps = secondsPerStep();
		const time = options.getAudioTime() - startTime;
		try {
			// 前奏の待ち時間（time < 0）はまだ曲が始まっていない。
			// 再生位置を戻さず開始位置に留めておく（プレイヘッドが曲頭より前へ出ない）。
			options.onTick(Math.max(fromStepValue, getWrappedPlayStep(time, sps)));
		} catch (err) {
			console.error("[sequencer] error in onTick callback:", err);
		}
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

	const START_DELAY = SEQUENCER_START_DELAY;

	const start = (fromStep?: number, preRollSec = 0): void => {
		stop();
		fromStepValue = fromStep ?? options.getPlayStartStep();
		buildTimeline(fromStepValue);
		// 鳴らすものが何も無ければ走らせない。伴奏音源だけが鳴る場合
		// （getMinEndSec が正）は、プレイヘッドを進めたいので走らせる。
		if (
			timeline.length === 0 &&
			!options.getDrumPattern(1)?.length &&
			(options.getMinEndSec?.() ?? 0) <= 0
		)
			return;
		active = true;
		// 前奏ぶんの待ちは、曲の開始時刻を後ろへ置くだけで作る。
		// こうすると歌声・フェードなど「開始時刻に揃える側」は何も知らなくてよい。
		startTime = options.getAudioTime() + START_DELAY + Math.max(0, preRollSec);

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
		getEndSec: () => (active && !isLooping ? currentEndSec() : 0),
		start,
		stop,
		isActive: () => active,
		getStartTime: () => startTime,
	};
};
