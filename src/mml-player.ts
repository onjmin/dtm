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
	PREWARM_NOTES,
	type SingingVoices,
	type StreamVoiceTrack,
	VOICE_IMAGE_KEY,
	vocalVolumeToGain,
} from "./lyrics";
import { VOICE_IMAGES } from "./voice-images";
import { MML_INFO_HTML } from "./mml-info";
import { parseMML } from "./mml-parser";
import {
	type ChordSegment,
	detectProgression,
	type TimedNote,
} from "@onjmin/chord-parser";
import { createSequencer, type SequencerTrack } from "./sequencer";
import { createSynth, type Synth } from "./synth";
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
	/** 再生終了または手動停止時に呼び出されるコールバック */
	onStop?: () => void;
	/** 埋め込みプレイヤーのベースURL（例: "https://onjmin.github.io/dtm/demo/embed.html"） */
	embedUrl?: string;
	/** 利用規約への同意画面の表示をスキップするかどうか */
	skipConsent?: boolean;
};

export type MmlPlayerInstance = {
	play: () => void;
	stop: () => void;
	isPlaying: () => boolean;
	destroy: () => void;
};

/** 同時に鳴るのは1プレイヤーのみ。再生開始時に他を止める（旧 AudioFocus 相当） */
let activePlayer: MmlPlayerInstance | null = null;

const agreedModelsInSession = new Set<string>();

const LYRIC_MODEL_LABELS: Record<string, string> = {
	klatt: "軽量ロボ声",
	...KOE_VOICEBANK_LABELS,
};

/** 現在表示中の吹き出し要素とその自動非表示タイマー */
let activeBalloonEl: HTMLElement | null = null;
let activeBalloonTimer: ReturnType<typeof setTimeout> | null = null;

const hideActiveBalloon = (): void => {
	if (activeBalloonEl) {
		activeBalloonEl.classList.remove("dtm-player-balloon--visible");
		activeBalloonEl = null;
	}
	if (activeBalloonTimer) {
		clearTimeout(activeBalloonTimer);
		activeBalloonTimer = null;
	}
};

const showBalloon = (balloonEl: HTMLElement): void => {
	if (activeBalloonEl === balloonEl) {
		if (activeBalloonTimer) {
			clearTimeout(activeBalloonTimer);
		}
	} else {
		hideActiveBalloon();
		activeBalloonEl = balloonEl;
		balloonEl.classList.add("dtm-player-balloon--visible");
	}
	activeBalloonTimer = setTimeout(() => {
		hideActiveBalloon();
	}, 3000);
};

type LaneToken = {
	el: HTMLSpanElement;
	startStep: number;
	durationSteps: number;
};

type LaneView = {
	lane: HTMLDivElement;
	tokens: LaneToken[];
};

const copyToClipboard = async (
	doc: Document,
	text: string,
): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const textarea = doc.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			doc.body.appendChild(textarea);
			textarea.select();
			const ok = doc.execCommand("copy");
			doc.body.removeChild(textarea);
			return ok;
		} catch {
			return false;
		}
	}
};

const toBase64Url = (bytes: Uint8Array): string => {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]);
	}
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const HIRAGANA_START = 0x3041; // 'ぁ'
const HIRAGANA_END = 0x309f; // 'ゟ'
const KATAKANA_START = 0x30a1; // 'ァ'
const KATAKANA_END = 0x30ff; // 'ヿ'
const PROLONGED_MARK = 0x30fc; // 'ー'
const SHIFT_KATAKANA = 255;
const VALUE_PROLONGED = 223;

const customEncode = (str: string): Uint8Array => {
	const bytes: number[] = [];
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code <= 127) {
			bytes.push(code);
		} else if (code === PROLONGED_MARK) {
			bytes.push(VALUE_PROLONGED);
		} else if (code >= HIRAGANA_START && code <= HIRAGANA_END) {
			bytes.push(128 + (code - HIRAGANA_START));
		} else if (code >= KATAKANA_START && code <= KATAKANA_END) {
			bytes.push(SHIFT_KATAKANA);
			bytes.push(128 + (code - 0x60 - HIRAGANA_START));
		}
	}
	return new Uint8Array(bytes);
};

const encodeMml = async (mml: string): Promise<string> => {
	try {
		if (typeof CompressionStream !== "undefined") {
			const cs = new CompressionStream("gzip");
			const w = cs.writable.getWriter();
			w.write(customEncode(mml) as Uint8Array<ArrayBuffer>);
			w.close();
			const buf = await new Response(cs.readable).arrayBuffer();
			return `z.${toBase64Url(new Uint8Array(buf))}`;
		}
	} catch (e) {
		console.warn(
			"[dtm] CompressionStream failed, fallback to encodeURIComponent",
			e,
		);
	}
	return `u.${encodeURIComponent(mml)}`;
};

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
	const drumVolume = meta.drumVolume ?? 80;
	const colors = options.trackColors ?? DEFAULT_TRACK_COLORS;
	const useSynth = options.synth ?? !options.onPlayNote;
	const secondsPerStep = 60 / bpm / STEPS_PER_BEAT;

	// placements を trackIndex ごとにまとめ、ノートを持つトラックだけ採用
	const trackIndices = [...new Set(placements.map((p) => p.trackIndex))].sort(
		(a, b) => a - b,
	);

	// ── ステップごとのコードネーム事前計算 ──
	//
	// detectProgression（@onjmin/chord-parser）に全トラックの発音を時刻付きノートで
	// 渡し、曲全体のコード進行を推定する。旧実装の「和音/ベーストラックだけを見て
	// 1拍ごとに detectChord する」方式に対し、次の3点を改善している:
	//
	//   1. 検出母集団を限定しない …… 和音・ベースに加えメロディ/パッドなど全トラックを
	//      構成音候補にする。第3音・第7音が内声やパッドにしか無くても拾えるため、
	//      Am7→A7 / Em7(♭5)→Em / FM7→F のような「質」の取りこぼしが減る。
	//      経過音などの非和声音は detectProgression の nonChordTonePenalty が吸収する。
	//   2. ベース＝ルート / キー考慮 …… ノートはオクターブ情報を保持した MIDI 値で渡すため
	//      最低音がベースとして扱われ、転回形（分数コード）とルートが正しく定まる。
	//      内部の detectKeyChanges によるキー事前確率で長短・dom7 などの質も補正される。
	//   3. 和声リズムへの追従 …… bpm の拍グリッド＋DP（changePenalty）で、拍内の経過音に
	//      よる揺れを抑えつつ和声の変わり目で区間を切る。固定1拍グリッドより自然。
	const maxStep = placements.reduce(
		(max, p) => Math.max(max, p.startStep + p.durationSteps),
		0,
	);

	// オクターブ情報を保持した MIDI ピッチで時刻付きノート化（最低音がベースになる）
	const timedNotes: TimedNote[] = placements.map((p) => ({
		pitch: p.pitch,
		when: p.startStep * secondsPerStep,
		duration: p.durationSteps * secondsPerStep,
	}));

	const stepChords: string[] = [];
	if (timedNotes.length > 0) {
		let chordSegments: ChordSegment[] = [];
		try {
			chordSegments = detectProgression(timedNotes, { bpm }).chords;
		} catch {
			chordSegments = [];
		}

		// 推定された秒区間（ChordSegment）をステップ配列へ展開する
		for (const seg of chordSegments) {
			const startStep = Math.max(0, Math.round(seg.when / secondsPerStep));
			const endStep = Math.round((seg.when + seg.duration) / secondsPerStep);
			for (let s = startStep; s < endStep && s <= maxStep; s++) {
				stepChords[s] = seg.symbol;
			}
		}

		// 区間の隙間（無音や未割当のステップ）は直前コードでラッチして連続表示する
		let lastChord = "";
		for (let s = 0; s <= maxStep; s++) {
			if (stepChords[s]) lastChord = stepChords[s];
			else stepChords[s] = lastChord;
		}
	}
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
	// 発音器は ctx と同様に遅延生成（synth.ts に切り出した共有ロジック）
	let synthInstance: Synth | null = null;
	const ensureSynth = (): Synth => {
		if (!synthInstance) synthInstance = createSynth(ensureCtx());
		return synthInstance;
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

	const mutedTracks = new Set<number>();
	const labelByTrack = new Map<number, HTMLDivElement>();
	const emojiByTrack = new Map<number, HTMLSpanElement>();
	const rowByTrack = new Map<number, HTMLDivElement>();

	const toggleMute = (index: number): void => {
		if (mutedTracks.has(index)) {
			mutedTracks.delete(index);
		} else {
			mutedTracks.add(index);
		}
		updateMuteUI(index);
	};

	const updateMuteUI = (index: number): void => {
		const isMuted = mutedTracks.has(index);
		const row = rowByTrack.get(index);
		if (row) {
			row.classList.toggle("is-muted", isMuted);
		}
		const label = labelByTrack.get(index);
		if (label) {
			label.classList.toggle("is-muted", isMuted);
		}
		const em = emojiByTrack.get(index);
		if (em) {
			em.classList.toggle("is-muted", isMuted);
		}
	};

	// 絵文字ヘッダ（トラック数分の🥺）
	const mmlHeader = doc.createElement("div");
	mmlHeader.className = "dtm-player-mml-header";

	const emojiEls: HTMLSpanElement[] = [];
	for (const index of trackIndices) {
		const em = doc.createElement("span");
		em.className = "dtm-player-emoji";
		em.style.backgroundColor = colorOf(index);

		const textSpan = doc.createElement("span");
		textSpan.textContent = "🥺";
		em.appendChild(textSpan);

		em.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleMute(index);
		});

		mmlHeader.appendChild(em);
		emojiEls.push(em);
		emojiByTrack.set(index, em);
	}

	// ── Context Menu (MMLを表示 / MML書式とは / 埋め込む / MMLコピー) ──
	const menuContainer = doc.createElement("div");
	menuContainer.className = "dtm-player-more-container";

	const moreBtn = doc.createElement("button");
	moreBtn.type = "button";
	moreBtn.className = "dtm-player-more-btn";
	moreBtn.innerHTML = icon("more", 14);
	moreBtn.title = "メニュー";
	menuContainer.appendChild(moreBtn);

	const menuDropdown = doc.createElement("div");
	menuDropdown.className = "dtm-player-menu";
	menuDropdown.style.display = "none";

	const makeMenuItem = (label: string): HTMLButtonElement => {
		const item = doc.createElement("button");
		item.type = "button";
		item.className = "dtm-player-menu-item";
		item.textContent = label;
		return item;
	};

	const showMmlItem = makeMenuItem("MMLを表示");
	const mmlInfoItem = makeMenuItem("MML書式とは");
	const embedItem = makeMenuItem("埋め込む");
	const copyMmlItem = makeMenuItem("MMLコピー");

	menuDropdown.appendChild(showMmlItem);
	menuDropdown.appendChild(mmlInfoItem);
	menuDropdown.appendChild(embedItem);
	menuDropdown.appendChild(copyMmlItem);
	menuContainer.appendChild(menuDropdown);

	mmlHeader.appendChild(menuContainer);

	// Context menu handlers
	const toggleMenu = (show?: boolean): void => {
		const visible =
			show !== undefined ? show : menuDropdown.style.display === "none";
		menuDropdown.style.display = visible ? "flex" : "none";
		if (visible) {
			moreBtn.classList.add("is-active");
			doc.addEventListener("click", handleOutsideClick);
		} else {
			moreBtn.classList.remove("is-active");
			doc.removeEventListener("click", handleOutsideClick);
		}
	};

	const handleOutsideClick = (e: MouseEvent): void => {
		if (!menuContainer.contains(e.target as Node)) {
			toggleMenu(false);
		}
	};

	moreBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		toggleMenu();
	});

	// ── 共通モーダル（MMLを表示 / MML書式とは / 埋め込む で使う） ──
	// dtm-modal-* スタイルは injectStyles で注入済み。doc.body 直下に重ねる。
	let infoModalEl: HTMLElement | null = null;
	let modalSamplePlayer: MmlPlayerInstance | null = null;

	const closeInfoModal = (): void => {
		if (modalSamplePlayer) {
			modalSamplePlayer.stop();
			modalSamplePlayer.destroy();
			modalSamplePlayer = null;
		}
		infoModalEl?.remove();
		infoModalEl = null;
	};

	/** タイトル付きのモーダルを開き、中身を書き込む body 要素を返す。 */
	const openInfoModal = (title: string): HTMLElement => {
		closeInfoModal();

		const overlay = doc.createElement("div");
		overlay.className = "dtm-modal-overlay";

		const modal = doc.createElement("div");
		modal.className = "dtm-win dtm-modal";

		const header = doc.createElement("div");
		header.className = "dtm-modal-header";
		const titleEl = doc.createElement("span");
		titleEl.className = "dtm-modal-title";
		titleEl.textContent = title;
		const closeBtn = doc.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "dtm-modal-close";
		closeBtn.innerHTML = "&times;";
		closeBtn.title = "閉じる";
		header.append(titleEl, closeBtn);

		const modalBody = doc.createElement("div");
		modalBody.className = "dtm-modal-body";

		modal.append(header, modalBody);
		overlay.appendChild(modal);

		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			closeInfoModal();
		});
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) closeInfoModal();
		});

		doc.body.appendChild(overlay);
		infoModalEl = overlay;
		return modalBody;
	};

	/** モーダル内に「コピー」ボタンを差し込むヘルパ。 */
	const appendCopyButton = (parent: HTMLElement, text: string): void => {
		const actions = doc.createElement("div");
		actions.style.marginTop = "8px";
		const copyBtn = doc.createElement("button");
		copyBtn.type = "button";
		copyBtn.className = "dtm-btn dtm-btn--primary dtm-btn--xs";
		copyBtn.textContent = "📋 コピー";
		copyBtn.addEventListener("click", async (e) => {
			e.stopPropagation();
			const ok = await copyToClipboard(doc, text);
			copyBtn.textContent = ok ? "✓ コピー完了" : "コピー失敗";
			if (ok) copyBtn.classList.add("dtm-btn--success");
			setTimeout(() => {
				copyBtn.textContent = "📋 コピー";
				copyBtn.classList.remove("dtm-btn--success");
			}, 1200);
		});
		actions.appendChild(copyBtn);
		parent.appendChild(actions);
	};

	// MML書式とは: サンプル曲ボックスの試聴・コピーボタンを接続する。
	const wireSampleButtons = (modalBody: HTMLElement): void => {
		const copyBtns = modalBody.querySelectorAll(".dtm-modal-sample-copy-btn");
		for (const btn of copyBtns) {
			const el = btn as HTMLButtonElement;
			el.addEventListener("click", async (e) => {
				e.stopPropagation();
				const sampleMml = el.getAttribute("data-mml") ?? "";
				const original = el.textContent;
				const ok = await copyToClipboard(doc, sampleMml);
				el.textContent = ok ? "✓ コピー完了" : "コピー失敗";
				if (ok) el.classList.add("dtm-btn--success");
				setTimeout(() => {
					el.textContent = original;
					el.classList.remove("dtm-btn--success");
				}, 1200);
			});
		}

		let activeSampleBtn: HTMLButtonElement | null = null;
		const resetSampleBtn = (b: HTMLButtonElement | null): void => {
			if (!b) return;
			b.textContent = "▶ 試聴";
			b.classList.remove("dtm-btn--danger");
			b.classList.add("dtm-btn--primary");
		};
		const markPlaying = (b: HTMLButtonElement): void => {
			b.textContent = "■ 停止";
			b.classList.remove("dtm-btn--primary");
			b.classList.add("dtm-btn--danger");
		};

		const playBtns = modalBody.querySelectorAll(".dtm-modal-sample-play-btn");
		for (const btn of playBtns) {
			const el = btn as HTMLButtonElement;
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				const sampleMml = el.getAttribute("data-mml") ?? "";

				// 同じサンプルの再押下: 再生／停止のトグル。
				if (activeSampleBtn === el && modalSamplePlayer) {
					if (modalSamplePlayer.isPlaying()) {
						modalSamplePlayer.stop();
					} else {
						modalSamplePlayer.play();
						markPlaying(el);
					}
					return;
				}

				// 別のサンプル: 既存プレイヤーを破棄して作り直す。
				if (modalSamplePlayer) {
					modalSamplePlayer.stop();
					modalSamplePlayer.destroy();
					modalSamplePlayer = null;
				}
				resetSampleBtn(activeSampleBtn);
				activeSampleBtn = el;

				const sampleBox = el.closest(".dtm-modal-sample-box");
				const container = sampleBox?.querySelector(
					".dtm-modal-sample-player-container",
				) as HTMLElement | null;
				if (!container) return;
				container.innerHTML = "";
				modalSamplePlayer = mountMmlPlayer(container, sampleMml, {
					onPlayNote: options.onPlayNote,
					onPlayDrum: options.onPlayDrum,
					onResumeAudio: options.onResumeAudio,
					getAudioTime: options.getAudioTime,
					singingVoices: options.singingVoices,
					drumPatterns: options.drumPatterns,
					volume: trackVolume,
					// 解説モーダル内の試聴サンプルは規約同意を要求しない。
					skipConsent: true,
					onStop: () => {
						if (activeSampleBtn === el) resetSampleBtn(el);
					},
				});
				markPlaying(el);
				modalSamplePlayer.play();
			});
		}
	};

	showMmlItem.addEventListener("click", (e) => {
		e.stopPropagation();
		toggleMenu(false);
		const modalBody = openInfoModal("MML");
		const pre = doc.createElement("pre");
		pre.textContent = mml;
		pre.style.whiteSpace = "pre-wrap";
		pre.style.wordBreak = "break-all";
		modalBody.appendChild(pre);
		appendCopyButton(modalBody, mml);
	});

	mmlInfoItem.addEventListener("click", (e) => {
		e.stopPropagation();
		toggleMenu(false);
		const modalBody = openInfoModal("MMLの書き方解説");
		modalBody.innerHTML = MML_INFO_HTML;
		wireSampleButtons(modalBody);
	});

	embedItem.addEventListener("click", async (e) => {
		e.stopPropagation();
		toggleMenu(false);
		const modalBody = openInfoModal("埋め込み");
		const loading = doc.createElement("p");
		loading.textContent = "生成中...";
		modalBody.appendChild(loading);
		try {
			const embedBase =
				options.embedUrl ?? "https://onjmin.github.io/dtm/demo/embed.html";
			const payload = await encodeMml(mml);
			const url = `${embedBase}#${payload}`;
			const snippet = `<iframe src="${url}" width="100%" height="260" frameborder="0" loading="lazy" title="@onjmin/dtm player"></iframe>`;
			// 生成待ちの間にモーダルが閉じられていたら何もしない。
			if (!modalBody.isConnected) return;
			loading.remove();
			const desc = doc.createElement("p");
			desc.textContent =
				"このHTMLをブログやサイトに貼り付けると、プレイヤーをそのまま埋め込めます。";
			const pre = doc.createElement("pre");
			pre.textContent = snippet;
			pre.style.whiteSpace = "pre-wrap";
			pre.style.wordBreak = "break-all";
			modalBody.append(desc, pre);
			appendCopyButton(modalBody, snippet);
		} catch (err) {
			console.error("[dtm] failed to generate embed snippet", err);
			if (modalBody.isConnected) loading.textContent = "生成に失敗しました";
		}
	});

	copyMmlItem.addEventListener("click", async (e) => {
		e.stopPropagation();
		const success = await copyToClipboard(doc, mml);
		if (success) {
			copyMmlItem.textContent = "コピーしました！";
		} else {
			copyMmlItem.textContent = "コピー失敗";
		}
		setTimeout(() => {
			copyMmlItem.textContent = "MMLコピー";
		}, 2000);
	});

	// 歌声トラックは初期表示からキャラクター画像に差し替える（ロード待ち必要）
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

		const balloon = doc.createElement("div");
		balloon.className = "dtm-player-balloon";
		const modelKey = lt.model.toLowerCase();
		balloon.textContent = LYRIC_MODEL_LABELS[modelKey] ?? lt.model;
		em.appendChild(balloon);

		em.addEventListener("mouseenter", () => {
			showBalloon(balloon);
		});
		em.addEventListener("mouseleave", () => {
			if (activeBalloonEl === balloon) {
				hideActiveBalloon();
			}
		});
		em.addEventListener("click", (e) => {
			e.stopPropagation();
			showBalloon(balloon);
		});
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
			const textSpan = em.querySelector("span");
			if (textSpan) {
				textSpan.textContent = "😌";
			} else {
				em.textContent = "😌";
			}
			const t2 = setTimeout(
				() => {
					if (promotedToImage.has(em)) return;
					const textSpan = em.querySelector("span");
					if (textSpan) {
						textSpan.textContent = "🥺";
					} else {
						em.textContent = "🥺";
					}
					scheduleBlink(em);
				},
				100 + Math.random() * 50,
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

	const chordEl = doc.createElement("span");
	chordEl.className = "dtm-player-chord";
	chordEl.textContent = "";
	beatRow.appendChild(chordEl);

	head.append(playBtn, beatRow, dots, mmlHeader);
	root.appendChild(head);

	// 遅延通知メッセージ領域
	const msgArea = doc.createElement("div");
	msgArea.className = "dtm-player-message";
	msgArea.style.display = "none";
	root.appendChild(msgArea);

	// ── メッセージ表示制御 ──
	let msgTimer: ReturnType<typeof setTimeout> | null = null;
	let lastMsgAt = 0;
	const showPlayerMessage = (text: string): void => {
		const now = performance.now();
		// 同時・連続した大量の警告によるチカチカ（チャタリング）を防ぐため、1.5秒のスロットリングを適用
		if (now - lastMsgAt < 1500) return;
		lastMsgAt = now;

		msgArea.textContent = text;
		msgArea.style.display = "";
		if (msgTimer) clearTimeout(msgTimer);
		msgTimer = setTimeout(() => {
			msgArea.style.display = "none";
			msgArea.textContent = "";
			msgTimer = null;
		}, 3000);
	};

	// ── トラック帯 ──
	// レーン群をまとめる本体。ローディングオーバーレイはこの領域だけに被せ、
	// 再生ボタン（head）まで覆わないようにする。
	const body = doc.createElement("div");
	body.className = "dtm-player-body";
	root.appendChild(body);

	// mutedTracks is defined above

	const laneViews: LaneView[] = [];
	for (const index of trackIndices) {
		const lyricTrack = lyricTracks.get(index);
		const isLyricLane = !!lyricTrack && lyricTrack.syllables.length > 0;

		const row = doc.createElement("div");
		row.className = "dtm-player-lane-row";
		rowByTrack.set(index, row);

		const label = doc.createElement("div");
		label.className = "dtm-player-lane-label dtm-player-lane-label--btn";
		const swatch = doc.createElement("span");
		swatch.className = "dtm-player-dot";
		swatch.style.backgroundColor = colorOf(index);
		const no = doc.createElement("span");
		no.className = "dtm-player-lane-no";
		no.textContent = `@${index}`;
		label.append(swatch, no);
		labelByTrack.set(index, label);
		label.addEventListener("click", () => {
			toggleMute(index);
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

	let consentOverlayEl: HTMLElement | null = null;
	const checkConsentAndShow = (onAgree?: () => void): boolean => {
		try {
			if (options.skipConsent) return false;
			const unagreed = termsModels.filter((model) => {
				if (agreedModelsInSession.has(model)) return false;
				try {
					if (typeof localStorage === "undefined" || !localStorage) return true;
					return localStorage.getItem(`dtm_agreed_terms_${model}`) !== "true";
				} catch (e) {
					console.warn(
						"[dtm-player] localStorage access denied in consent check",
						e,
					);
					return true;
				}
			});

			if (unagreed.length === 0) return false;

			const consentOverlay = doc.createElement("div");
			consentOverlay.className = "dtm-consent-overlay";

			const modal = doc.createElement("div");
			modal.className = "dtm-win dtm-consent-modal";

			const header = doc.createElement("div");
			header.className = "dtm-consent-header";
			header.textContent = "利用規約の確認";

			const body = doc.createElement("div");
			body.className = "dtm-consent-body";

			let contentHTML = `<p style="margin: 0 0 8px 0; line-height: 1.4; font-weight: bold; color: var(--dtm-danger);">本データには UTAU 歌声音源が含まれています。<br>ご利用にあたっては、以下の音源利用規約への同意が必要です。</p>`;

			for (const model of unagreed) {
				const label = KOE_VOICEBANK_LABELS[model] || model;
				const url = KOE_VOICEBANK_TERMS[model];
				contentHTML += `
					<div style="margin-bottom: 8px; padding: 6px 10px; background: var(--dtm-deep); border: 2px solid var(--c-black); box-shadow: 2px 2px 0 var(--c-black);">
						<div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 11px; font-weight: bold; color: var(--dtm-gold);">
							<span>使用時には</span>
							<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--dtm-primary); text-decoration: underline;">${label}UTAU音源</a>
							<span>の利用規約に従ってください</span>
						</div>
					</div>
				`;
			}
			body.innerHTML = contentHTML;

			const footer = doc.createElement("div");
			footer.className = "dtm-consent-footer";

			const btn = doc.createElement("button");
			btn.type = "button";
			btn.className = "dtm-btn dtm-btn--success";
			btn.textContent = "同意して利用する";
			btn.onclick = () => {
				for (const model of unagreed) {
					try {
						if (typeof localStorage !== "undefined" && localStorage) {
							localStorage.setItem(`dtm_agreed_terms_${model}`, "true");
						}
					} catch (e) {
						// sandbox対応
					}
					agreedModelsInSession.add(model);
				}
				consentOverlay.remove();
				consentOverlayEl = null;
				if (onAgree) onAgree();
			};

			footer.appendChild(btn);
			modal.append(header, body, footer);
			consentOverlay.appendChild(modal);
			doc.body.appendChild(consentOverlay);
			consentOverlayEl = consentOverlay;
			return true;
		} catch (err) {
			console.error("[dtm-player] Error in checkConsentAndShow:", err);
			return false;
		}
	};

	// ── 再生位置の描画 ──
	const autoScroll = (lane: HTMLDivElement, el: HTMLElement): void => {
		if (el.offsetWidth === 0 || lane.clientWidth === 0) return;
		const elementCenter = el.offsetLeft + el.offsetWidth / 2;
		const maxScroll = Math.max(0, lane.scrollWidth - lane.clientWidth);
		const next = elementCenter - lane.clientWidth / 2;
		lane.scrollLeft = Math.max(0, Math.min(next, maxScroll));
	};

	const renderPlayhead = (step: number): void => {
		const intStep = Math.floor(step);
		const beatIndex = Math.floor(step / STEPS_PER_BEAT) % 4;
		for (let i = 0; i < 4; i++)
			beatDots[i].classList.toggle("dtm-player-beat-dot--on", i === beatIndex);
		barEl.textContent = String(Math.floor(step / STEPS_PER_BAR) + 1);
		const chordName = stepChords[intStep] ?? "";
		if (chordEl.textContent !== chordName) {
			chordEl.textContent = chordName;
			if (chordName) {
				console.log(
					`[dtm-player-chord] Active Chord: ${chordName} (step: ${intStep})`,
				);
			}
		}
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
		chordEl.textContent = "";
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
			// ここでは楽器音も歌声も鳴らさない。（ただし音声合成をスキップした場合は鳴らす）
			if (lyricTracks.has(trackIdx) && !skipSinging) return;
			options.onPlayNote?.(e);
			if (useSynth) ensureSynth().playNote(e);
		},
		onPlayDrum: (e) => {
			// ドラムは曲全体に効くトップレベル宣言でトラックと1対1ではないため、
			// 特定トラックの絵文字（旧実装は先頭を流用）を跳ねさせない。
			// 先頭トラックがドラムの度に跳ね続けるバグの原因だった。
			const velocity = e.velocity * (drumVolume / 100) * (trackVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
			if (useSynth) ensureSynth().playDrum({ ...e, velocity });
		},
		onTick: (step) => {
			renderPlayhead(step);
		},
		onEnd: (interrupted) => finish(),
		stepsPerBar: STEPS_PER_BAR,
	});

	let playing = false;
	let skipSinging = false;

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
		options.onStop?.();
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
				id: String(index),
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
			const overlay = showLoadingOverlay(body, {
				skipLabel: "音声合成をスキップ（元のメロディで再生）",
				onSkip: () => {
					if (!playing || activePlayer !== instance) return;
					skipSinging = true;
					overlay.remove();
					seq.start(0);
				},
			});
			try {
				await v.loadModels(tracks.map((t) => t.model));
				if (skipSinging) return;
				const startTime = performance.now();
				await v.warm(tracks, PREWARM_NOTES, (done, total) => {
					if (skipSinging) return;
					if (done === 0) {
						overlay.setProgress(done, total);
					} else {
						const elapsed = (performance.now() - startTime) / 1000;
						const avg = elapsed / done;
						const remaining = total - done;
						const remainingSec = Math.ceil(remaining * avg);
						overlay.setProgress(done, total, remainingSec);
					}
				});
			} catch (err) {
				console.warn("[dtm] voice preload failed", err);
			} finally {
				overlay.remove();
			}
			if (!playing || activePlayer !== instance || skipSinging) return;
		}
		seq.start(0);
		if (streaming && !skipSinging) {
			ensureVoices().startStream(tracks, seq.getStartTime(), {
				isAudible: (t) => !mutedTracks.has(Number(t.id)),
				onLateSkip: () => {
					showPlayerMessage(
						"音声合成が間に合わないため、一部の発音をスキップしました",
					);
				},
			});
		}
	};

	const play = (): void => {
		if (playing || trackIndices.length === 0) return;
		if (checkConsentAndShow(() => play())) return;
		if (activePlayer && activePlayer !== instance) activePlayer.stop();
		activePlayer = instance;
		skipSinging = false;
		setPlayingUI(true);
		// AudioContext の resume は非同期。suspended のまま（currentTime が凍結した状態で）
		// スケジュールを始めると、resume 完了の瞬間に先読み予約が過去時刻となり一斉発音され、
		// 冒頭で「ピチュ」という潰れた音が鳴る。resume の完了を待ってから再生を始める。
		void (async () => {
			const resumes: Promise<void>[] = [];
			const r = options.onResumeAudio?.();
			if (r) resumes.push(r);
			if (useSynth) {
				const ctx = ensureCtx();
				if (ctx.state === "suspended") resumes.push(ctx.resume());
			}
			if (resumes.length > 0) await Promise.all(resumes);
			// 待機中に停止／別プレイヤー開始されていたら起動しない。
			if (!playing || activePlayer !== instance) return;
			if (voicesAvailable && lyricTracks.size > 0) ensureVoices().reset();
			await startWhenReady();
		})();
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
		doc.removeEventListener("click", handleOutsideClick);
		seq.stop();
		peekVoices()?.stopStream();
		if (activePlayer === instance) activePlayer = null;
		if (audioCtx) {
			void audioCtx.close();
			audioCtx = null;
		}
		for (const t of blinkTimers) clearTimeout(t);
		clearJumpTimers();
		if (activeBalloonEl && root.contains(activeBalloonEl)) {
			hideActiveBalloon();
		}
		root.remove();
		consentOverlayEl?.remove();
		closeInfoModal();
	};

	const instance: MmlPlayerInstance = {
		play,
		stop,
		isPlaying: () => playing,
		destroy,
	};
	return instance;
};
