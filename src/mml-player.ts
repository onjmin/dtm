/**
 * mountMmlPlayer — MML文字列を「読むだけ」で再生できる軽量ビュー（Layer 2）。
 *
 * 編集UIの mountDAW と対になる存在で、ノート列を横スクロールのトークン帯として表示し、
 * 再生位置をハイライト＆オートスクロールする。パースは DTM 正準の parseMML を、
 * 再生スケジューリングは createSequencer を用いるため、コアとモデルが一本化される。
 *
 * 発音は mountDAW と同じく onPlayNote へ注入する設計だが、手軽に鳴らせるよう
 * オプトインの簡易square-wave synth（`synth`）も同梱する。onPlayNote 未指定なら既定で有効。
 */

import { icon } from "./icons";
import {
	createKlattVoice,
	createLyricsConductor,
	type VoiceModel,
} from "./lyrics";
import { parseMML } from "./mml-parser";
import { createSequencer, type SequencerTrack } from "./sequencer";
import { injectStyles } from "./styles";
import type { Note, PlayNoteEvent } from "./types";

const STEPS_PER_BEAT = 48;
const STEPS_PER_BAR = 192;

/** trackIndex 0:melody 1:submelody 2:bass 3:chord の既定色（PICO-8パレット） */
const DEFAULT_TRACK_COLORS = ["#00e436", "#29adff", "#ff77a8", "#ffec27"];

export type MmlPlayerOptions = {
	/** メロディックノートの発音要求。未指定かつ synth 未指定なら内蔵synthが鳴る */
	onPlayNote?: (e: PlayNoteEvent) => void;
	/** 再生クロック秒。既定は内蔵synthの AudioContext.currentTime もしくは performance.now()/1000 */
	getAudioTime?: () => number;
	/** 初回再生時に呼ばれる（AudioContext.resume 等に使う） */
	onResumeAudio?: () => void | Promise<void>;
	/** 内蔵の簡易square-wave synthを使うか。既定は onPlayNote 未指定なら true */
	synth?: boolean;
	/** BPM未検出時のフォールバック。既定120 */
	defaultBpm?: number;
	/** 各トラックの 0-100 ボリューム。既定100 */
	volume?: number;
	/** trackIndex順の表示色。既定はPICO-8パレット4色 */
	trackColors?: string[];
};

export type MmlPlayerInstance = {
	play: () => void;
	stop: () => void;
	isPlaying: () => boolean;
	destroy: () => void;
};

/** 同時に鳴るのは1プレイヤーのみ。再生開始時に他を止める（旧 AudioFocus 相当） */
let activePlayer: MmlPlayerInstance | null = null;

type LaneToken = {
	el: HTMLSpanElement;
	startStep: number;
	durationSteps: number;
};

type LaneView = {
	lane: HTMLDivElement;
	tokens: LaneToken[];
};

const formatTime = (seconds: number): string => {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const freqFromPitch = (pitch: number): number => 440 * 2 ** ((pitch - 69) / 12);

/**
 * MML文字列を再生専用ビューとして target にマウントする。
 */
export const mountMmlPlayer = (
	target: HTMLElement,
	mml: string,
	options: MmlPlayerOptions = {},
): MmlPlayerInstance => {
	injectStyles(target.ownerDocument ?? document);

	const {
		placements,
		bpm: parsedBpm,
		tokenTracks,
		lyrics,
	} = parseMML(mml, {
		collectTokens: true,
		collectLyrics: true,
	});
	const lyricTracks = lyrics ?? new Map();
	const conductor = createLyricsConductor(lyricTracks);
	const bpm = parsedBpm ?? options.defaultBpm ?? 120;
	const trackVolume = options.volume ?? 100;
	const colors = options.trackColors ?? DEFAULT_TRACK_COLORS;
	const useSynth = options.synth ?? !options.onPlayNote;
	const secondsPerStep = 60 / bpm / STEPS_PER_BEAT;

	// placements を trackIndex ごとにまとめ、ノートを持つトラックだけ採用
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
				velocity: 100,
			}));
		return { id: String(index), volume: trackVolume, notes };
	});

	const colorOf = (index: number): string =>
		colors[index % colors.length] ?? DEFAULT_TRACK_COLORS[0];

	// ── 内蔵synth ──
	let audioCtx: AudioContext | null = null;
	const ensureCtx = (): AudioContext => {
		if (!audioCtx) audioCtx = new AudioContext();
		return audioCtx;
	};
	const synthPlay = (e: PlayNoteEvent): void => {
		const ctx = ensureCtx();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "square";
		osc.frequency.value = freqFromPitch(e.pitch);
		const t0 = ctx.currentTime + e.when;
		const peak = Math.max(0.0001, 0.06 * e.volume * 1.5);
		gain.gain.setValueAtTime(peak, t0);
		gain.gain.exponentialRampToValueAtTime(0.001, t0 + e.duration);
		osc.connect(gain);
		// ステレオ定位（非対応環境では destination 直結）
		if (typeof ctx.createStereoPanner === "function" && e.pan) {
			const panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, e.pan));
			gain.connect(panner);
			panner.connect(ctx.destination);
		} else {
			gain.connect(ctx.destination);
		}
		osc.start(t0);
		osc.stop(t0 + e.duration + 0.02);
	};

	// 歌詞付きノートを内蔵synthで歌うためのフォルマント合成（遅延生成）
	let klattVoice: VoiceModel | null = null;
	const ensureKlatt = (): VoiceModel => {
		if (!klattVoice) {
			const ctx = ensureCtx();
			klattVoice = createKlattVoice(ctx, ctx.destination);
		}
		return klattVoice;
	};

	const getAudioTime = (): number => {
		if (useSynth) return ensureCtx().currentTime;
		return options.getAudioTime?.() ?? performance.now() / 1000;
	};

	// ── DOM構築 ──
	const doc = target.ownerDocument ?? document;
	const root = doc.createElement("div");
	root.className = "dtm-daw dtm-player";

	const head = doc.createElement("div");
	head.className = "dtm-player-head";

	const playBtn = doc.createElement("button");
	playBtn.type = "button";
	playBtn.className = "dtm-player-play";
	playBtn.innerHTML = icon("play", 12);
	playBtn.disabled = trackIndices.length === 0;

	const tempoEl = doc.createElement("span");
	tempoEl.className = "dtm-player-tempo";
	tempoEl.textContent = `♩=${bpm}`;

	const timeEl = doc.createElement("span");
	timeEl.className = "dtm-player-time";
	timeEl.textContent = "00:00";

	const dots = doc.createElement("div");
	dots.className = "dtm-player-dots";
	for (const index of trackIndices) {
		const dot = doc.createElement("span");
		dot.className = "dtm-player-dot";
		dot.style.backgroundColor = colorOf(index);
		dots.appendChild(dot);
	}

	head.append(playBtn, tempoEl, timeEl, dots);
	root.appendChild(head);

	// ── トラック帯 ──
	const laneViews: LaneView[] = [];
	for (const index of trackIndices) {
		const lyricTrack = lyricTracks.get(index);
		const isLyricLane = !!lyricTrack && lyricTrack.syllables.length > 0;

		const row = doc.createElement("div");
		row.className = "dtm-player-lane-row";

		const label = doc.createElement("div");
		label.className = "dtm-player-lane-label";
		const swatch = doc.createElement("span");
		swatch.className = "dtm-player-dot";
		swatch.style.backgroundColor = colorOf(index);
		const no = doc.createElement("span");
		no.className = "dtm-player-lane-no";
		no.textContent = `@${index}`;
		label.append(swatch, no);

		const lane = doc.createElement("div");
		lane.className = "dtm-player-lane";
		lane.style.setProperty("--tk", colorOf(index));

		const laneTokens: LaneToken[] = [];
		if (isLyricLane) {
			// 歌詞トラックは元の楽器ノート列を表示せず、歌う音節を帯として表示する。
			// 演奏ノート（@n）と音節を発音順（startStep昇順）で対応づけ、歌っている音節をハイライトする。
			const notes = placements
				.filter((p) => p.trackIndex === index)
				.sort((a, b) => a.startStep - b.startStep);
			const gateScale = (lyricTrack.gate ?? 100) / 100;
			const count = Math.min(notes.length, lyricTrack.syllables.length);
			for (let i = 0; i < count; i++) {
				const note = notes[i];
				const span = doc.createElement("span");
				span.className = "dtm-tk dtm-tk--lyric";
				span.textContent = lyricTrack.syllables[i].kana;
				lane.appendChild(span);
				laneTokens.push({
					el: span,
					startStep: note.startStep,
					durationSteps: Math.max(
						1,
						Math.round(note.durationSteps * gateScale),
					),
				});
			}
		} else {
			const tokens = tokenTracks?.get(index) ?? [];
			for (const tok of tokens) {
				const span = doc.createElement("span");
				span.className = `dtm-tk dtm-tk--${tok.type}`;
				span.textContent = tok.text;
				lane.appendChild(span);
				if (tok.durationSteps > 0) {
					laneTokens.push({
						el: span,
						startStep: tok.startStep,
						durationSteps: tok.durationSteps,
					});
				}
			}
		}

		row.append(label, lane);
		root.appendChild(row);
		laneViews.push({ lane, tokens: laneTokens });
	}

	target.appendChild(root);

	// ── 再生位置の描画 ──
	const autoScroll = (lane: HTMLDivElement, el: HTMLElement): void => {
		if (el.offsetWidth === 0 || lane.clientWidth === 0) return;
		const elementCenter = el.offsetLeft + el.offsetWidth / 2;
		const maxScroll = Math.max(0, lane.scrollWidth - lane.clientWidth);
		const next = elementCenter - lane.clientWidth / 2;
		lane.scrollLeft = Math.max(0, Math.min(next, maxScroll));
	};

	const renderPlayhead = (step: number): void => {
		timeEl.textContent = formatTime(Math.max(0, step) * secondsPerStep);
		for (const view of laneViews) {
			let active: LaneToken | null = null;
			for (const t of view.tokens) {
				const on = step >= t.startStep && step < t.startStep + t.durationSteps;
				t.el.classList.toggle("is-active", on);
				if (on && !active) active = t;
			}
			if (active) autoScroll(view.lane, active.el);
		}
	};

	const resetPlayhead = (): void => {
		timeEl.textContent = "00:00";
		for (const view of laneViews) {
			for (const t of view.tokens) t.el.classList.remove("is-active");
			view.lane.scrollLeft = 0;
		}
	};

	// ── シーケンサ ──
	const seq = createSequencer({
		getTracks: () => seqTracks,
		getBpm: () => bpm,
		getPlayStartStep: () => 0,
		getDrumPattern: () => null,
		getSoloTrackId: () => null,
		getAudioTime,
		onPlayNote: (e) => {
			const trackId = Number(e.trackId);
			const isLyricTrack = lyricTracks.has(trackId);
			// 歌詞トラックなら、対応する演奏トラックのNote Onで音節を1つ消費する
			const consumed = isLyricTrack ? conductor.consume(trackId) : null;
			// 歌詞トラックの元の楽器音は鳴らさない（音節を使い切ったら無音）
			if (isLyricTrack && !consumed) return;
			// 歌唱は velocity を参照せず、歌詞トラック独自の声量×トラック音量を使う。
			// 発音長は歌詞トラックの gate（0-1）でスケールする。
			const ev: PlayNoteEvent = consumed
				? {
						...e,
						volume: consumed.volume * (trackVolume / 100),
						duration: e.duration * consumed.gate,
						pan: consumed.pan,
						syllable: consumed.syllable,
						voiceModel: consumed.model,
					}
				: e;
			options.onPlayNote?.(ev);
			if (useSynth) {
				// 音節があれば歌唱（klatt）、無ければ通常の楽器音
				if (consumed) ensureKlatt()(consumed.syllable, ev);
				else synthPlay(ev);
			}
		},
		onPlayDrum: () => {},
		onTick: (step) => renderPlayhead(step),
		onEnd: () => finish(),
		stepsPerBar: STEPS_PER_BAR,
	});

	let playing = false;

	const setPlayingUI = (on: boolean): void => {
		playing = on;
		playBtn.innerHTML = icon(on ? "stop" : "play", 12);
		playBtn.classList.toggle("dtm-player-play--stop", on);
	};

	const finish = (): void => {
		setPlayingUI(false);
		resetPlayhead();
		if (activePlayer === instance) activePlayer = null;
	};

	const play = (): void => {
		if (playing || trackIndices.length === 0) return;
		if (activePlayer && activePlayer !== instance) activePlayer.stop();
		activePlayer = instance;
		setPlayingUI(true);
		void options.onResumeAudio?.();
		if (useSynth) {
			const ctx = ensureCtx();
			if (ctx.state === "suspended") void ctx.resume();
		}
		conductor.reset(); // 歌詞ポインタを先頭へ戻す
		seq.start(0);
	};

	const stop = (): void => {
		if (!playing) return;
		seq.stop();
		finish();
	};

	playBtn.addEventListener("click", () => {
		if (playing) stop();
		else play();
	});

	const destroy = (): void => {
		seq.stop();
		if (activePlayer === instance) activePlayer = null;
		if (audioCtx) {
			void audioCtx.close();
			audioCtx = null;
		}
		root.remove();
	};

	const instance: MmlPlayerInstance = {
		play,
		stop,
		isPlaying: () => playing,
		destroy,
	};
	return instance;
};
