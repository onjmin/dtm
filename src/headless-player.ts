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

import { DRUM_PATTERNS, type DrumPattern } from "./drum-config";
import { parseMML } from "./mml-parser";
import { createSequencer, type SequencerTrack } from "./sequencer";
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
	/** ドラムパターン辞書。`#drum=<キー>` の解決に使う。既定 DRUM_PATTERNS */
	drumPatterns?: Record<string, DrumPattern>;
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

	const drumPatternDict = options.drumPatterns ?? DRUM_PATTERNS;
	const drumPattern: DrumPattern | null = meta.drum
		? (drumPatternDict[meta.drum] ?? null)
		: null;

	let masterVolume = meta.volume ?? options.volume ?? 100;
	const drumVolume = meta.drumVolume ?? 80;

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
		return { id: String(index), volume: masterVolume, notes };
	});

	// ── AudioContext / 発音器 ──
	const ownsCtx = !options.audioContext;
	const ctx = options.audioContext ?? new AudioContext();
	const destination = options.destination ?? ctx.destination;
	const useSynth = options.synth ?? !options.onPlayNote;
	const synth: Synth | null = useSynth ? createSynth(ctx, destination) : null;

	// 非アクティブ時の自動 suspend/resume は、自分の ctx を持つときだけ既定ON。
	const pauseWhenHidden = options.pauseWhenHidden ?? ownsCtx;

	let playing = false;

	const seq = createSequencer({
		getTracks: () => seqTracks,
		getBpm: () => bpm,
		getPlayStartStep: () => 0,
		getDrumPattern: () => drumPattern,
		getSoloTrackId: () => null,
		getLoop: () => options.loop ?? false,
		cues: options.cues,
		onCue: options.onCue,
		getAudioTime: () => ctx.currentTime,
		onPlayNote: (e) => {
			options.onPlayNote?.(e);
			synth?.playNote(e);
		},
		onPlayDrum: (e) => {
			const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
			synth?.playDrum({ ...e, velocity });
		},
		onTick: () => {},
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
	// AudioContext が suspended のままスケジュールを始めると、resume 完了の瞬間に
	// 先読み予約が過去時刻となって冒頭が潰れる（"ピチュ"）。resume を待ってから start する。
	playing = true;
	void (async () => {
		const resumes: Promise<void>[] = [];
		const r = options.onResumeAudio?.();
		if (r) resumes.push(r);
		if (ctx.state === "suspended") resumes.push(ctx.resume());
		if (resumes.length > 0) await Promise.all(resumes);
		if (!playing) return; // 待機中に stop されていたら起動しない
		seq.start(0);
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
