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
	createSingingVoices,
	KOE_VOICEBANK_LABELS,
	KOE_VOICEBANK_TERMS,
	panToStereo,
	type SingingVoices,
	type StreamVoiceTrack,
	VOICE_IMAGE_KEY,
	vocalVolumeToGain,
} from "./lyrics";
import { VOICE_IMAGES } from "./voice-images";
import { parseMML } from "./mml-parser";
import { createSequencer, type SequencerTrack } from "./sequencer";
import { injectStyles, showLoadingOverlay } from "./styles";
import {
	DEFAULT_BPM,
	DEFAULT_GATE,
	DEFAULT_PAN,
	DEFAULT_VOCAL_VOLUME,
} from "./types";
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
	/** 歌唱合成の先読みや制御を行うヘルパ（.koe音源の再生前プリロードに使用） */
	singingVoices?: SingingVoices;
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
	const bpm = parsedBpm ?? options.defaultBpm ?? DEFAULT_BPM;
	// トップレベル宣言: ドラムパターンを解決（曲全体に効く。トラックとは1対1でない）
	const drumPatternDict = options.drumPatterns ?? DRUM_PATTERNS;
	const drumPattern: DrumPattern | null = meta.drum
		? (drumPatternDict[meta.drum] ?? null)
		: null;
	const trackVolume = meta.volume ?? options.volume ?? 100;
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
		if (options.singingVoices) return options.singingVoices;
		if (!voices) {
			const ctx = ensureCtx();
			voices = createSingingVoices(ctx, ctx.destination);
		}
		return voices;
	};
	// 歌声を鳴らせるか（内蔵synth or 外部から singingVoices を注入）。
	const voicesAvailable = useSynth || !!options.singingVoices;
	// 生成せずに現在の歌唱合成を覗く（停止処理用。未生成なら null）。
	const peekVoices = (): SingingVoices | null =>
		options.singingVoices ?? voices;

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

	// 絵文字ヘッダ（トラック数分の🥺）
	const mmlHeader = doc.createElement("div");
	mmlHeader.className = "dtm-player-mml-header";

	const emojiEls: HTMLSpanElement[] = [];
	const emojiByTrack = new Map<number, HTMLSpanElement>();
	for (const index of trackIndices) {
		const em = doc.createElement("span");
		em.className = "dtm-player-emoji";
		em.style.backgroundColor = colorOf(index);
		em.textContent = "🥺";
		mmlHeader.appendChild(em);
		emojiEls.push(em);
		emojiByTrack.set(index, em);
	}

	// 歌声トラックは初期表示からキャラクター画像に差し替える（ロード待ち不要）
	const promotedToImage = new Set<HTMLSpanElement>();
	for (const [index, lt] of lyricTracks) {
		const em = emojiByTrack.get(index);
		if (!em) continue;
		const imgKey = VOICE_IMAGE_KEY[lt.model.toLowerCase()];
		const src = imgKey ? VOICE_IMAGES[imgKey] : undefined;
		if (!src) continue;
		const img = doc.createElement("img");
		img.src = src;
		img.width = 20;
		img.height = 20;
		img.style.borderRadius = "50%";
		img.style.objectFit = "cover";
		img.draggable = false;
		promotedToImage.add(em);
		em.textContent = "";
		em.appendChild(img);
	}

	// 和音は同じトラックで複数ノートが同時（同じ when）に来るため、ジャンプ発火が
	// 重複する。直近に同じ絵文字をジャンプさせた直後は無視し、最初の1つだけ反映する。
	const JUMP_DEDUPE_MS = 50;
	const lastJumpAt = new WeakMap<HTMLSpanElement, number>();
	const jumpEmoji = (em: HTMLSpanElement): void => {
		const now = performance.now();
		const prev = lastJumpAt.get(em);
		if (prev !== undefined && now - prev < JUMP_DEDUPE_MS) return;
		lastJumpAt.set(em, now);
		em.classList.remove("dtm-player-emoji--jump");
		void em.offsetWidth; // reflow でアニメをリセット
		em.classList.add("dtm-player-emoji--jump");
	};

	// onPlayNote/onPlayDrum はノートを最大 PLAN_TIME 秒だけ先読みして呼ばれる。
	// 即ジャンプすると発音より早く（かつ近接ノートが上書きしあって裏拍に）ズレるため、
	// e.when 分だけ遅らせて「実際になり始める瞬間」にジャンプさせる。
	const jumpTimers: ReturnType<typeof setTimeout>[] = [];
	const jumpEmojiAt = (em: HTMLSpanElement, when: number): void => {
		if (when <= 0) {
			jumpEmoji(em);
			return;
		}
		jumpTimers.push(setTimeout(() => jumpEmoji(em), when * 1000));
	};
	const clearJumpTimers = (): void => {
		for (const t of jumpTimers) clearTimeout(t);
		jumpTimers.length = 0;
	};

	// 瞬きアニメ: 各絵文字がランダムなタイミングで😌に一瞬変わる
	// 画像に差し替えられた要素は promotedToImage に入れて瞬きをスキップする
	const blinkTimers: ReturnType<typeof setTimeout>[] = [];
	const scheduleBlink = (em: HTMLSpanElement): void => {
		const delay = 2000 + Math.random() * 5000;
		const t = setTimeout(() => {
			if (promotedToImage.has(em)) return;
			em.textContent = "😌";
			const t2 = setTimeout(
				() => {
					if (promotedToImage.has(em)) return;
					em.textContent = "🥺";
					scheduleBlink(em);
				},
				200 + Math.random() * 150,
			);
			blinkTimers.push(t2);
		}, delay);
		blinkTimers.push(t);
	};
	for (const em of emojiEls) scheduleBlink(em);

	// 旧来のドット（カラー丸）も残す（lane ラベル用に使いまわされているため）
	const dots = doc.createElement("div");
	dots.className = "dtm-player-dots";
	dots.style.display = "none";
	for (const index of trackIndices) {
		const dot = doc.createElement("span");
		dot.className = "dtm-player-dot";
		dot.style.backgroundColor = colorOf(index);
		dots.appendChild(dot);
	}

	// ビート表示（●○○○ → ○●○○ → …）と小節番号
	const beatRow = doc.createElement("div");
	beatRow.className = "dtm-player-beat-row";

	const beatDots: HTMLSpanElement[] = [];
	for (let i = 0; i < 4; i++) {
		const d = doc.createElement("span");
		d.className = "dtm-player-beat-dot";
		beatRow.appendChild(d);
		beatDots.push(d);
	}

	const barEl = doc.createElement("span");
	barEl.className = "dtm-player-bar";
	barEl.textContent = "-";
	beatRow.appendChild(barEl);

	// トップレベル宣言チップ（#inst / #drum / #volume）
	const chips: HTMLSpanElement[] = [];
	const makeChip = (label: string): HTMLSpanElement => {
		const chip = doc.createElement("span");
		chip.className = "dtm-player-chip";
		chip.textContent = label;
		chips.push(chip);
		return chip;
	};
	if (meta.instrument) makeChip(`♪ ${meta.instrument}`);
	if (meta.drum) makeChip(`🥁 ${meta.drum}${drumPattern ? "" : " (?)"}`);
	if (meta.volume !== undefined) makeChip(`🔊 ${meta.volume}%`);

	head.append(playBtn, beatRow, ...chips, dots, mmlHeader);
	root.appendChild(head);

	// ── トラック帯 ──
	// レーン群をまとめる本体。ローディングオーバーレイはこの領域だけに被せ、
	// 再生ボタン（head）まで覆わないようにする。
	const body = doc.createElement("div");
	body.className = "dtm-player-body";
	root.appendChild(body);

	const mutedTracks = new Set<number>();

	const laneViews: LaneView[] = [];
	for (const index of trackIndices) {
		const lyricTrack = lyricTracks.get(index);
		const isLyricLane = !!lyricTrack && lyricTrack.syllables.length > 0;

		const row = doc.createElement("div");
		row.className = "dtm-player-lane-row";

		const label = doc.createElement("div");
		label.className = "dtm-player-lane-label dtm-player-lane-label--btn";
		const swatch = doc.createElement("span");
		swatch.className = "dtm-player-dot";
		swatch.style.backgroundColor = colorOf(index);
		const no = doc.createElement("span");
		no.className = "dtm-player-lane-no";
		no.textContent = `@${index}`;
		label.append(swatch, no);
		label.addEventListener("click", () => {
			if (mutedTracks.has(index)) {
				mutedTracks.delete(index);
				label.classList.remove("dtm-player-lane-label--muted");
			} else {
				mutedTracks.add(index);
				label.classList.add("dtm-player-lane-label--muted");
			}
		});

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
			const gateScale = (lyricTrack.gate ?? DEFAULT_GATE) / 100;
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
		body.appendChild(row);
		laneViews.push({ lane, tokens: laneTokens });
	}

	// ── 利用規約の表示（下部） ──
	const termsModels = [
		...new Set([...lyricTracks.values()].map((lt) => lt.model)),
	].filter((model) => KOE_VOICEBANK_TERMS[model]);

	if (termsModels.length > 0) {
		const termsDiv = doc.createElement("div");
		termsDiv.className = "dtm-player-terms";
		termsDiv.style.fontSize = "10px";
		termsDiv.style.color = "var(--dtm-warn)";
		termsDiv.style.display = "flex";
		termsDiv.style.flexDirection = "column";
		termsDiv.style.gap = "4px";
		termsDiv.style.marginTop = "4px";
		termsDiv.style.padding = "0 4px";

		for (const model of termsModels) {
			const termsRow = doc.createElement("div");
			termsRow.style.display = "flex";
			termsRow.style.alignItems = "center";
			termsRow.style.gap = "4px";
			termsRow.style.flexWrap = "wrap";

			const label = KOE_VOICEBANK_LABELS[model] ?? model;
			const url = KOE_VOICEBANK_TERMS[model];

			const span1 = doc.createElement("span");
			span1.textContent = "使用時には";

			const a = doc.createElement("a");
			a.textContent = `${label}UTAU音源`;
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener";
			a.style.color = "var(--dtm-primary)";
			a.style.textDecoration = "underline";

			const span2 = doc.createElement("span");
			span2.textContent = "の利用規約に従ってください";

			termsRow.append(span1, a, span2);
			termsDiv.appendChild(termsRow);
		}
		root.appendChild(termsDiv);
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
		const beatIndex = Math.floor(step / STEPS_PER_BEAT) % 4;
		for (let i = 0; i < 4; i++)
			beatDots[i].classList.toggle("dtm-player-beat-dot--on", i === beatIndex);
		barEl.textContent = String(Math.floor(step / STEPS_PER_BAR) + 1);
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
		for (const d of beatDots) d.classList.remove("dtm-player-beat-dot--on");
		barEl.textContent = "-";
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
			const trackIdx = Number(e.trackId);
			if (mutedTracks.has(trackIdx)) return;
			const em = emojiByTrack.get(trackIdx);
			if (em) jumpEmojiAt(em, e.when);
			// 歌詞トラックの発音は歌声ストリーミング（startStream）が担当するため、
			// ここでは楽器音も歌声も鳴らさない。
			if (lyricTracks.has(trackIdx)) return;
			options.onPlayNote?.(e);
			if (useSynth) synthPlay(e);
		},
		onPlayDrum: (e) => {
			// ドラムは trackIndex を持たないため先頭以外の絵文字は対象外
			const em = emojiEls[0];
			if (em) jumpEmojiAt(em, e.when);
			const velocity = e.velocity * (trackVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
			if (useSynth) drumSynth({ ...e, velocity });
		},
		onTick: (step) => {
			renderPlayhead(step);
		},
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
		clearJumpTimers();
		resetPlayhead();
		if (activePlayer === instance) activePlayer = null;
	};

	// 歌詞トラックを「絶対時刻ベースのストリーミング用」ノート列へ変換する（再生は常に step0 から）。
	const buildStreamTracks = (): StreamVoiceTrack[] =>
		[...lyricTracks.entries()].map(([index, lt]) => {
			const seqTrack = seqTracks.find((t) => Number(t.id) === index);
			const sorted = [...(seqTrack?.notes ?? [])].sort(
				(a, b) => a.startStep - b.startStep,
			);
			const gate = (lt.gate ?? DEFAULT_GATE) / 100;
			const semis = (lt.octave ?? 0) * 12; // オクターブシフトを半音換算でピッチへ加算
			const count = Math.min(sorted.length, lt.syllables.length);
			const notes = [];
			for (let i = 0; i < count; i++) {
				const n = sorted[i];
				notes.push({
					syllable: lt.syllables[i],
					pitch: n.pitch + semis,
					startSec: n.startStep * secondsPerStep,
					durationSec: n.durationSteps * secondsPerStep * gate,
				});
			}
			return {
				model: lt.model,
				volume:
					vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME) *
					(trackVolume / 100),
				pan: panToStereo(lt.pan ?? DEFAULT_PAN),
				notes,
			};
		});

	// 歌声がある場合は .koe ロード＋頭出し合成を待ってから、楽器と同じアンカーで
	// ストリーミング再生を開始する。待機中に停止／別プレイヤー開始されたら起動しない。
	const startWhenReady = async (): Promise<void> => {
		const streaming = voicesAvailable && lyricTracks.size > 0;
		const tracks = streaming ? buildStreamTracks() : [];
		if (streaming) {
			const v = ensureVoices();
			const overlay = showLoadingOverlay(body);
			try {
				await v.loadModels(tracks.map((t) => t.model));
				await v.warm(tracks);
			} catch (err) {
				console.warn("[dtm] voice preload failed", err);
			} finally {
				overlay.remove();
			}
			if (!playing || activePlayer !== instance) return;
		}
		seq.start(0);
		if (streaming) ensureVoices().startStream(tracks, seq.getStartTime());
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
		if (voicesAvailable && lyricTracks.size > 0) ensureVoices().reset();
		void startWhenReady();
	};

	const stop = (): void => {
		if (!playing) return;
		seq.stop();
		peekVoices()?.stopStream();
		finish();
	};

	playBtn.addEventListener("click", () => {
		if (playing) stop();
		else play();
	});

	const destroy = (): void => {
		seq.stop();
		peekVoices()?.stopStream();
		if (activePlayer === instance) activePlayer = null;
		if (audioCtx) {
			void audioCtx.close();
			audioCtx = null;
		}
		for (const t of blinkTimers) clearTimeout(t);
		clearJumpTimers();
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
