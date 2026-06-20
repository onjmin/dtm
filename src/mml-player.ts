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

import { DRUM_PATTERNS, type DrumPattern } from "./drum-config";
import { icon } from "./icons";
import {
	createLyricsConductor,
	createSingingVoices,
	type SingingVoices,
} from "./lyrics";
import { parseMML } from "./mml-parser";
import { createSequencer, type SequencerTrack } from "./sequencer";
import { injectStyles } from "./styles";
import type { Note, PlayDrumEvent, PlayNoteEvent } from "./types";

const STEPS_PER_BEAT = 48;
const STEPS_PER_BAR = 192;

/** trackIndex 0:melody 1:submelody 2:bass 3:chord の既定色（PICO-8パレット） */
const DEFAULT_TRACK_COLORS = ["#00e436", "#29adff", "#ff77a8", "#ffec27"];

export type MmlPlayerOptions = {
	/** メロディックノートの発音要求。未指定かつ synth 未指定なら内蔵synthが鳴る */
	onPlayNote?: (e: PlayNoteEvent) => void;
	/**
	 * ドラムノートの発音要求（MMLのトップレベル宣言 `#drum=…` から解決）。
	 * 未指定かつ内蔵synth有効なら、簡易ドラム音で鳴る。
	 */
	onPlayDrum?: (e: PlayDrumEvent) => void;
	/** ドラムパターン辞書。`#drum=<キー>` の解決に使う。既定 DRUM_PATTERNS */
	drumPatterns?: Record<string, DrumPattern>;
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
		meta,
	} = parseMML(mml, {
		collectTokens: true,
		collectLyrics: true,
	});
	const lyricTracks = lyrics ?? new Map();
	const conductor = createLyricsConductor(lyricTracks);
	const bpm = parsedBpm ?? options.defaultBpm ?? 120;
	// トップレベル宣言: ドラムパターンを解決（曲全体に効く。トラックとは1対1でない）
	const drumPatternDict = options.drumPatterns ?? DRUM_PATTERNS;
	const drumPattern: DrumPattern | null = meta.drum
		? (drumPatternDict[meta.drum] ?? null)
		: null;
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

	// 簡易ドラム音（内蔵synth用）。SoundFontを持たないため、キック/スネア/ハイハットを
	// オシレータ＋ノイズで近似する。pitch は General MIDI 準拠のドラムキー番号。
	const drumSynth = (e: PlayDrumEvent): void => {
		const ctx = ensureCtx();
		const t0 = ctx.currentTime + e.when;
		const vol = Math.max(0.0001, Math.min(1, e.velocity));
		const isKick = e.pitch === 35 || e.pitch === 36;
		const isSnareLike = e.pitch === 38 || e.pitch === 39 || e.pitch === 40;
		if (isKick) {
			// キック: 低音サインのピッチダウン
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.frequency.setValueAtTime(150, t0);
			osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
			g.gain.setValueAtTime(vol * 0.9, t0);
			g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
			osc.connect(g).connect(ctx.destination);
			osc.start(t0);
			osc.stop(t0 + 0.2);
			osc.onended = () => osc.disconnect();
			return;
		}
		// スネア/ハイハット/その他: ノイズバースト（スネアは帯域広め＋胴鳴り）
		const dur = isSnareLike ? 0.18 : 0.05;
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const filter = ctx.createBiquadFilter();
		filter.type = isSnareLike ? "bandpass" : "highpass";
		filter.frequency.value = isSnareLike ? 2000 : 8000;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol * (isSnareLike ? 0.7 : 0.4), t0);
		g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		src.connect(filter).connect(g).connect(ctx.destination);
		src.start(t0);
		src.stop(t0 + dur);
		src.onended = () => {
			src.disconnect();
			filter.disconnect();
			g.disconnect();
		};
	};

	// 歌詞付きノートを歌うための歌唱合成（klatt + koe音源。遅延生成）
	let voices: SingingVoices | null = null;
	const ensureVoices = (): SingingVoices => {
		if (!voices) {
			const ctx = ensureCtx();
			voices = createSingingVoices(ctx, ctx.destination);
		}
		return voices;
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

	head.append(playBtn, tempoEl, timeEl);

	// トップレベル宣言（楽器プリセット・ドラムパターン）をチップ表示する
	const addChip = (label: string): void => {
		const chip = doc.createElement("span");
		chip.className = "dtm-player-chip";
		chip.textContent = label;
		head.appendChild(chip);
	};
	if (meta.instrument) addChip(`♪ ${meta.instrument}`);
	if (meta.drum) addChip(`🥁 ${meta.drum}${drumPattern ? "" : " (?)"}`);

	head.appendChild(dots);
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
			const breaks = new Set(lyricTrack.lineBreaks ?? []);
			// メタ部分（モデル名＋オプション）を先頭にグレーアウト表示する（ハイライトしない）
			if (lyricTrack.metaText) {
				const metaEl = doc.createElement("span");
				metaEl.className = "dtm-tk dtm-tk--meta";
				metaEl.textContent = lyricTrack.metaText;
				lane.appendChild(metaEl);
			}
			const count = Math.min(notes.length, lyricTrack.syllables.length);
			for (let i = 0; i < count; i++) {
				const note = notes[i];
				// 元の歌詞が改行されていた位置に \n 表記の区切りを差し込む（発音はしない）
				if (breaks.has(i)) {
					const br = doc.createElement("span");
					br.className = "dtm-tk dtm-tk--break";
					br.textContent = "\\n";
					lane.appendChild(br);
				}
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
		getDrumPattern: () => drumPattern,
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
				// 音節があれば歌唱（klatt or koe音源）、無ければ通常の楽器音
				if (consumed)
					ensureVoices().sing(consumed.model, consumed.syllable, ev);
				else synthPlay(ev);
			}
		},
		onPlayDrum: (e) => {
			options.onPlayDrum?.(e);
			if (useSynth) drumSynth(e);
		},
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

	// 内蔵synthで歌う場合、koe音源を先読みしてから開始する（初回から歌えるように）。
	// 先読み中に停止／別プレイヤー開始されたら起動しない。
	const startWhenReady = async (): Promise<void> => {
		if (useSynth && lyricTracks.size > 0) {
			const models = [...lyricTracks.values()].map((t) => t.model);
			try {
				await ensureVoices().preload(models);
			} catch {}
			if (!playing || activePlayer !== instance) return;
		}
		seq.start(0);
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
		void startWhenReady();
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
