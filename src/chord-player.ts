import { parseChords, parseChord } from "@onjmin/chord-parser";
import {
	playPlacements,
	type PlayPlacementsOptions,
	type MmlPlayback,
} from "./headless-player";
import { copyToClipboard, encodeMml } from "./mml-player";
import { CHORD_INFO_HTML } from "./chord-info";
import { buildNameToKeyMapping } from "./audio-config";
import { SoundFont } from "./sf/SoundFont";
import { createSynth } from "./synth";
import { DRUM_KEYS } from "./drum-config";
import { icon } from "./icons";
import { injectStyles } from "./styles";
import { DEFAULT_STEPS_PER_BAR } from "./types";

/**
 * PICO-8 16色パレットから選んだセクション配色
 * (cyan → pink → yellow → green → lavender → orange)
 */
const SECTION_COLOR_LIST = [
	{ fg: "#29adff", bg: "#0a1833", border: "#29adff" }, // cyan
	{ fg: "#ff77a8", bg: "#1a0512", border: "#ff77a8" }, // pink
	{ fg: "#ffec27", bg: "#1a1500", border: "#ffec27" }, // yellow
	{ fg: "#00e436", bg: "#001a08", border: "#00e436" }, // green
	{ fg: "#83769c", bg: "#0e0c14", border: "#83769c" }, // lavender
	{ fg: "#ffa300", bg: "#1a0d00", border: "#ffa300" }, // orange
];

const SOUNDFONT_NAME = "FluidR3_GM_sf2_file";

/**
 * `#tone=<名前>` で指定できる音色プリセット。
 * webaudiofont (WAF) の GM 楽器名へマッピングする。
 * gmName が null のものは軽量オシレータシンセへのフォールバック。
 */
const WAF_TONE_PRESETS: Record<
	string,
	{ label: string; gmName: string | null }
> = {
	square: { label: "SQUARE", gmName: null },
	piano: { label: "PIANO", gmName: "Acoustic Grand Piano" },
	epiano: { label: "E.PIANO", gmName: "Electric Piano 1" },
	guitar: { label: "GUITAR", gmName: "Acoustic Guitar (nylon)" },
	strings: { label: "STRINGS", gmName: "String Ensemble 1" },
	organ: { label: "ORGAN", gmName: "Church Organ" },
	bell: { label: "BELL", gmName: "Tubular Bells" },
	pad: { label: "PAD", gmName: "Pad 2 (warm)" },
	vibraphone: { label: "VIBRA", gmName: "Vibraphone" },
	choir: { label: "CHOIR", gmName: "Choir Aahs" },
	harp: { label: "HARP", gmName: "Orchestral Harp" },
	flute: { label: "FLUTE", gmName: "Flute" },
};

/**
 * 入力文字列から `#tone=<名前>` または `#instrument=<名前>` メタ行を読み取る。
 * `#` 行は parseChords 側でコメントとして無視されるため、進行の解析には影響しない。
 */
const parseToneMeta = (chords: string): string | null => {
	const m = chords.match(/^#\s*(?:tone|instrument)\s*=\s*([a-zA-Z]+)\s*$/im);
	return m ? m[1].toLowerCase() : null;
};

/**
 * 入力文字列から `#metronome` または `#metronome=on` メタ行を読み取る。
 */
const parseMetronomeMeta = (chords: string): boolean => {
	return /^#\s*metronome(?:\s*=\s*on)?\s*$/im.test(chords);
};

/**
 * GM楽器名 → 4桁インスツルメントキー（例: "Acoustic Grand Piano" → "0000"）
 * buildNameToKeyMapping() は静的データを同期パースするため、実際には常に即解決する。
 */
let _nameToKeyCache: Record<string, string> | null = null;
const getNameToKey = async (): Promise<Record<string, string>> => {
	if (!_nameToKeyCache) _nameToKeyCache = await buildNameToKeyMapping();
	return _nameToKeyCache;
};

/**
 * WAF SoundFont インスタンスキャッシュ（グローバル共有。同一楽器の多重ロードを防ぐ）
 */
const _wafCache = new Map<string, SoundFont>();
const _wafLoading = new Map<string, Promise<SoundFont | null>>();

/**
 * GM楽器名から WAF SoundFont をロード（キャッシュ済みなら即返す）。
 * ロード失敗時は null を返してオシレータシンセへフォールバックさせる。
 */
const loadWafFont = (
	ctx: AudioContext,
	gmName: string,
): Promise<SoundFont | null> => {
	if (_wafCache.has(gmName)) return Promise.resolve(_wafCache.get(gmName)!);
	if (_wafLoading.has(gmName)) return _wafLoading.get(gmName)!;

	const p = (async () => {
		try {
			const nameToKey = await getNameToKey();
			const key = nameToKey[gmName];
			if (!key) throw new Error(`GM name not found: ${gmName}`);
			const fullName = `${key}_${SOUNDFONT_NAME}`;
			const sf = await SoundFont.load({
				ctx,
				fontName: `_tone_${fullName}`,
				url: SoundFont.toURL(fullName),
			});
			_wafCache.set(gmName, sf);
			return sf;
		} catch (e) {
			console.warn(
				`[chord-player] WAF load failed for "${gmName}", fallback to synth`,
				e,
			);
			return null;
		} finally {
			_wafLoading.delete(gmName);
		}
	})();

	_wafLoading.set(gmName, p);
	return p;
};

/**
 * ドラム音源キャッシュ（メトロノーム用）
 */
const _drumCache = new Map<number, SoundFont>();
const _drumLoading = new Map<number, Promise<SoundFont | null>>();

const loadDrumFont = (
	ctx: AudioContext,
	pitch: number,
): Promise<SoundFont | null> => {
	if (_drumCache.has(pitch)) return Promise.resolve(_drumCache.get(pitch)!);
	if (_drumLoading.has(pitch)) return _drumLoading.get(pitch)!;

	const p = (async () => {
		try {
			const fontName = `_drum_${pitch}_0_${SOUNDFONT_NAME}`;
			const url = `https://surikov.github.io/webaudiofontdata/sound/128${pitch}_0_${SOUNDFONT_NAME}.js`;
			const sf = await SoundFont.load({
				ctx,
				fontName,
				url,
				isDrum: true,
				pitchs: [pitch],
			});
			_drumCache.set(pitch, sf);
			return sf;
		} catch (e) {
			console.warn(`[chord-player] Drum WAF load failed for pitch ${pitch}`, e);
			return null;
		} finally {
			_drumLoading.delete(pitch);
		}
	})();

	_drumLoading.set(pitch, p);
	return p;
};

export type MountChordPlayerOptions = {
	/** 使用する AudioContext（省略時は内部生成） */
	audioContext?: AudioContext;
	/** 音量 0-100 */
	volume?: number;
	/** BPM 既定120 */
	bpm?: number;
	/** スタジオインスタンス（DtmStudio）。指定時は高品質SoundFontが使われます */
	studio?: any;
	/** 再生終了時コールバック */
	onStop?: () => void;
	/** 埋め込みプレイヤーのベースURL */
	embedUrl?: string;
	/** 進行中のコード文字列を取得する */
	getChords?: () => string;
	/** モーダル等の表示をスキップするか（再帰防止用） */
	_skipInfoModals?: boolean;
};

export type ChordPlayerInstance = {
	element: HTMLElement;
	/** 再生開始。fromIndex でコードイベントの途中から開始できる */
	play: (fromIndex?: number) => void;
	stop: () => void;
	destroy: () => void;
	/** メトロノームのオン/オフを切り替える */
	toggleMetronome: () => void;
	/** 再生中か否かを取得する */
	isPlaying: () => boolean;
};

type DisplayPart = {
	text: string;
	isChord: boolean;
	eventIdx: number;
};

type DisplayLine = {
	type: "section" | "bar";
	section?: string;
	colorIdx: number;
	parts?: DisplayPart[];
};

/**
 * コード進行テキストから表示用の構造化データを組み立てる
 */
const buildDisplayLines = (
	chords: string,
	eventsCount: number,
): DisplayLine[] => {
	const rawLines = chords
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l);
	const displayLines: DisplayLine[] = [];
	let eventCounter = 0;
	let colorIdx = -1;

	for (const line of rawLines) {
		if (/^#/.test(line)) {
			const label = line.replace(/^#\s*/, "").trim();
			if (/^t\d+$/i.test(label)) continue;
			if (/^tone\s*=/i.test(label)) continue;
			if (/^instrument\s*=/i.test(label)) continue;
			if (/^metronome/i.test(label)) continue;
			colorIdx++;
			displayLines.push({
				type: "section",
				section: label,
				colorIdx: Math.max(0, colorIdx),
			});
			continue;
		}

		const segments = line.split("|");
		if (segments.length <= 1) continue;

		const parts: DisplayPart[] = [];
		for (let i = 0; i < segments.length; i++) {
			if (i > 0) parts.push({ text: "|", isChord: false, eventIdx: -1 });
			const bar = segments[i].trim();
			if (!bar) continue;

			const splitAt: number[] = [];
			for (let j = 0; j < bar.length; j++) {
				const char = bar[j];
				// 1. 制御文字 (=, %, _)
				if (char === "=" || char === "%" || char === "_") {
					splitAt.push(j);
					splitAt.push(j + 1);
					continue;
				}

				// 2. N.C. または N
				const sub = bar.slice(j);
				if (/^N\.C\.(?:\b|\s|$)/i.test(sub)) {
					splitAt.push(j);
					splitAt.push(j + 4);
					j += 3;
					continue;
				}
				if (/^N(?:\b|\s|$)/i.test(sub)) {
					splitAt.push(j);
					splitAt.push(j + 1);
					continue;
				}

				// 3. 通常のコード [A-G]
				if (/^[A-G]$/i.test(char)) {
					const prev = bar[j - 1];
					const prev2 = bar.slice(Math.max(0, j - 2), j);
					if (prev === "/" || prev2.toLowerCase() === "on") continue;
					splitAt.push(j);
				}
			}

			const uniqueSplitAt = Array.from(new Set(splitAt))
				.filter((idx) => idx >= 0 && idx < bar.length)
				.sort((a, b) => a - b);

			if (uniqueSplitAt.length === 0) {
				parts.push({
					text: bar,
					isChord: true,
					eventIdx: eventCounter < eventsCount ? eventCounter : -1,
				});
				eventCounter++;
				continue;
			}

			for (let ci = 0; ci < uniqueSplitAt.length; ci++) {
				if (ci > 0) parts.push({ text: "", isChord: false, eventIdx: -1 });
				const start = uniqueSplitAt[ci];
				const end =
					ci < uniqueSplitAt.length - 1 ? uniqueSplitAt[ci + 1] : bar.length;
				const symbol = bar.slice(start, end).trim();
				if (symbol) {
					parts.push({
						text: symbol,
						isChord: true,
						eventIdx: eventCounter < eventsCount ? eventCounter : -1,
					});
					eventCounter++;
				}
			}
		}

		if (parts.length > 0) {
			displayLines.push({
				type: "bar",
				colorIdx: Math.max(0, colorIdx),
				parts,
			});
		}
	}
	return displayLines;
};

/**
 * コード進行再生専用プレイヤーを target 要素にマウントする。
 * デザインは dtm- クラス体系（PICO-8カラー・ゲームウィンドウ枠）に準拠。
 */
export const mountChordPlayer = (
	target: HTMLElement,
	chords: string,
	options: MountChordPlayerOptions = {},
): ChordPlayerInstance => {
	const doc = target.ownerDocument;
	injectStyles(doc);

	let bpm = options.bpm ?? 120;
	let activeIndex = -1;
	let activePlayback: MmlPlayback | null = null;
	let isPlaying = false;
	let isLoading = false;
	/** インクリメントして進行中ロードを「キャンセル」する */
	let loadAbortId = 0;
	let loopEnabled = false;
	let metronomeEnabled = parseMetronomeMeta(chords);
	/** 再生開始位置（秒）。途中再生時に onTick の step を絶対時刻へ換算する */
	let playOffsetSec = 0;
	/** 現在の再生時刻（秒）。メトロノームの中途有効化時に同期に用いる */
	let currentPlaySec = 0;
	/** audioContext 未指定時に内部生成する ctx（初回再生時に生成、destroy で閉じる） */
	let ownCtx: AudioContext | null = null;
	/** 現在の再生の出力を束ねる Gain。停止・シーク時にここを絞って即座に音を切る */
	let activeCut: { gain: GainNode; ctx: AudioContext } | null = null;
	/** メトロノームの setTimeout ハンドル */
	let metronomeTimer: ReturnType<typeof setTimeout> | null = null;
	/** メトロノーム再生開始時の AudioContext.currentTime */
	let metronomeStartCtxTime = 0;
	/** メトロノーム再生開始時の再生位置（秒） */
	let metronomeStartPlaySec = 0;
	/** メトロノーム次回スケジュール済みビート番号 */
	let metronomeNextBeat = 0;

	// 音色プリセットの解決（#tone=piano 等。未指定は piano をデフォルト）
	const toneName = parseToneMeta(chords);
	const initialPreset =
		(toneName &&
		(toneName === "piano" || toneName === "guitar" || toneName === "strings")
			? WAF_TONE_PRESETS[toneName]
			: undefined) ?? WAF_TONE_PRESETS.piano;
	/** UI で選択中の楽器キー。再生中もリアルタイムで切り替え可。 */
	let activeInstrumentKey: "piano" | "guitar" | "strings" =
		toneName === "guitar"
			? "guitar"
			: toneName === "strings"
				? "strings"
				: "piano";
	/** UI で選択中の楽器の GM 名（onPlayNote から動的に参照） */
	let activeGmName: string | null = initialPreset.gmName;

	/**
	 * 発音済み・予約済みの音を即座に止める。
	 * Web Audio は先読みスケジュールするため、シーケンサ停止だけでは鳴り続ける。
	 * クリックノイズを避けるため 30ms だけフェードして切り離す。
	 */
	const killSound = () => {
		if (!activeCut) return;
		const { gain, ctx } = activeCut;
		activeCut = null;
		const t = ctx.currentTime;
		gain.gain.cancelScheduledValues(t);
		gain.gain.setValueAtTime(gain.gain.value, t);
		gain.gain.linearRampToValueAtTime(0, t + 0.03);
		setTimeout(() => gain.disconnect(), 80);
	};

	/** メトロノームを停止する（タイマーのキャンセルのみ。音は killSound 側で処理） */
	const stopMetronome = () => {
		if (metronomeTimer !== null) {
			clearTimeout(metronomeTimer);
			metronomeTimer = null;
		}
	};

	// コード進行イベントのパース
	let chordEvents: ReturnType<typeof parseChords> = [];
	try {
		chordEvents = parseChords(chords, bpm);
	} catch {
		chordEvents = [];
	}

	const displayLines = buildDisplayLines(chords, chordEvents.length);
	let secondsPerBar = (60 / bpm) * 4;
	let secondsPerStep = secondsPerBar / DEFAULT_STEPS_PER_BAR;
	let secondsPerBeat = 60 / bpm;
	let totalSec =
		chordEvents.length > 0
			? chordEvents[chordEvents.length - 1].when +
				chordEvents[chordEvents.length - 1].duration
			: 0;

	// ── コンテナ（.dtm-chord-player） ──
	// PICO-8のゲームウィンドウ枠と同じ3重構造はCSSが担当
	const container = doc.createElement("div");
	container.className = "dtm-chord-player";

	// ── コントロールバー ──
	const ctrlBar = doc.createElement("div");
	ctrlBar.className = "dtm-cp-ctrl";

	// 再生/停止ボタン — 既存DAWと同じ .dtm-play クラス + icon() SVG
	const playBtn = doc.createElement("button");
	playBtn.type = "button";
	playBtn.className = "dtm-play";

	const setPlayBtnStyle = (playing: boolean) => {
		if (playing) {
			playBtn.classList.add("dtm-play--stop");
			playBtn.innerHTML = icon("stop", 14);
			playBtn.title = "STOP";
		} else {
			playBtn.classList.remove("dtm-play--stop");
			playBtn.innerHTML = icon("play", 14);
			playBtn.title = "PLAY";
		}
	};
	setPlayBtnStyle(false);

	/**
	 * ロード中スピナー表示。loading=true のとき再生ボタンをスピナーに変え、
	 * 操作を受け付けないようにする。false で通常状態へ戻す。
	 */
	const setLoadingUI = (loading: boolean) => {
		isLoading = loading;
		playBtn.disabled = loading;
		if (loading) {
			playBtn.classList.remove("dtm-play--stop");
			playBtn.innerHTML = '<span class="dtm-cp-spinner"></span>';
			playBtn.title = "Loading...";
		} else {
			setPlayBtnStyle(isPlaying);
		}
	};

	// ループ切替 — 再生中なら現在のコードから再生し直して反映する
	const loopBtn = doc.createElement("button");
	loopBtn.type = "button";
	loopBtn.className = "dtm-cp-loop";
	loopBtn.innerHTML = icon("loop", 12);
	loopBtn.title = "LOOP OFF";
	loopBtn.addEventListener("click", () => {
		loopEnabled = !loopEnabled;
		loopBtn.classList.toggle("dtm-cp-loop--on", loopEnabled);
		loopBtn.title = loopEnabled ? "LOOP ON" : "LOOP OFF";
		if (isPlaying) seekTo(Math.max(0, activeIndex));
	});

	// メトロノームボタン
	const metroBtn = doc.createElement("button");
	metroBtn.type = "button";
	metroBtn.className = "dtm-cp-metro";
	metroBtn.innerHTML = "♩";
	metroBtn.title = metronomeEnabled ? "METRONOME ON" : "METRONOME OFF";
	metroBtn.classList.toggle("dtm-cp-metro--on", metronomeEnabled);
	metroBtn.addEventListener("click", () => {
		toggleMetronome();
	});

	// BPM widget: [−] BPM 120 [+]
	const bpmGroup = doc.createElement("div");
	bpmGroup.className = "dtm-cp-bpm-group";
	const bpmDecBtn = doc.createElement("button");
	bpmDecBtn.type = "button";
	bpmDecBtn.className = "dtm-cp-bpm-btn";
	bpmDecBtn.textContent = "\u2212";
	bpmDecBtn.title = "BPM -5";
	const bpmInput = doc.createElement("input");
	bpmInput.type = "number";
	bpmInput.className = "dtm-cp-bpm-input";
	bpmInput.min = "40";
	bpmInput.max = "240";
	bpmInput.value = String(bpm);
	bpmInput.title = "BPM (クリックで直接入力)";
	bpmInput.addEventListener("change", () => {
		const val = Number.parseInt(bpmInput.value, 10);
		if (!Number.isNaN(val)) {
			recomputeTimings(val);
		} else {
			bpmInput.value = String(bpm);
		}
	});
	bpmInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			bpmInput.blur();
		}
	});
	const bpmIncBtn = doc.createElement("button");
	bpmIncBtn.type = "button";
	bpmIncBtn.className = "dtm-cp-bpm-btn";
	bpmIncBtn.textContent = "+";
	bpmIncBtn.title = "BPM +5";
	bpmGroup.append(bpmDecBtn, bpmInput, bpmIncBtn);

	// ── 楽器トグルボタン（Piano / Guitar / Strings） ──
	const INSTRUMENT_DEFS: {
		key: "piano" | "guitar" | "strings";
		label: string;
		emoji: string;
	}[] = [
		{ key: "piano", label: "Piano", emoji: "🎹" },
		{ key: "guitar", label: "Guitar", emoji: "🎸" },
		{ key: "strings", label: "Strings", emoji: "🎻" },
	];

	const instrGroup = doc.createElement("div");
	instrGroup.className = "dtm-cp-instr-group";

	const instrBtns = new Map<string, HTMLButtonElement>();

	const updateInstrButtons = () => {
		for (const { key } of INSTRUMENT_DEFS) {
			instrBtns
				.get(key)
				?.classList.toggle(
					"dtm-cp-instr-btn--active",
					key === activeInstrumentKey,
				);
		}
	};

	const switchInstrument = (key: "piano" | "guitar" | "strings") => {
		if (activeInstrumentKey === key) return;
		activeInstrumentKey = key;
		activeGmName = WAF_TONE_PRESETS[key].gmName;
		updateInstrButtons();
		// バックグラウンドでプリロード（未キャッシュの場合のみネット取得）
		if (activeGmName && !_wafCache.has(activeGmName)) {
			const ctx = ownCtx ?? options.audioContext;
			if (ctx) loadWafFont(ctx, activeGmName);
		}
	};

	for (const { key, label, emoji } of INSTRUMENT_DEFS) {
		const btn = doc.createElement("button");
		btn.type = "button";
		btn.className = "dtm-cp-instr-btn";
		btn.textContent = `${emoji} ${label}`;
		btn.title = label;
		btn.addEventListener("click", () => switchInstrument(key));
		instrGroup.appendChild(btn);
		instrBtns.set(key, btn);
	}
	updateInstrButtons();

	// 時間表示（右寄せ）
	const timeSpan = doc.createElement("span");
	timeSpan.className = "dtm-cp-time";

	const formatTime = (sec: number) => {
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	};
	const updateTimeDisplay = (currentSec: number) => {
		timeSpan.textContent = `${formatTime(currentSec)} / ${formatTime(totalSec)}`;
	};
	updateTimeDisplay(0);

	ctrlBar.appendChild(playBtn);
	ctrlBar.appendChild(loopBtn);
	ctrlBar.appendChild(metroBtn);
	ctrlBar.appendChild(bpmGroup);
	ctrlBar.appendChild(instrGroup);
	ctrlBar.appendChild(timeSpan);

	// ── Context Menu (コード進行を表示 / コード進行とは / 埋め込む / コード進行コピー) ──
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

	const showChordsItem = makeMenuItem("コード進行を表示");
	const chordInfoItem = makeMenuItem("コード進行とは");
	const embedItem = makeMenuItem("埋め込む");
	const copyChordsItem = makeMenuItem("コード進行コピー");

	if (!options._skipInfoModals) {
		menuDropdown.appendChild(showChordsItem);
		menuDropdown.appendChild(chordInfoItem);
		menuDropdown.appendChild(embedItem);
	}
	menuDropdown.appendChild(copyChordsItem);
	menuContainer.appendChild(menuDropdown);

	ctrlBar.appendChild(menuContainer);
	container.appendChild(ctrlBar);

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

	// ── 共通モーダル（コード進行を表示 / コード進行とは / 埋め込む で使う） ──
	let infoModalEl: HTMLElement | null = null;
	let modalSamplePlayer: ChordPlayerInstance | null = null;

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

	// コード進行とは: サンプル進行ボックスの試聴・コピーボタンを接続する。
	const wireSampleButtons = (modalBody: HTMLElement): void => {
		const copyBtns = modalBody.querySelectorAll(".dtm-modal-sample-copy-btn");
		for (const btn of copyBtns) {
			const el = btn as HTMLButtonElement;
			el.addEventListener("click", async (e) => {
				e.stopPropagation();
				const sampleChords = el.getAttribute("data-chords") ?? "";
				const original = el.textContent;
				const ok = await copyToClipboard(
					doc,
					sampleChords.replace(/\\n/g, "\n"),
				);
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
				const sampleChords = (el.getAttribute("data-chords") ?? "").replace(
					/\\n/g,
					"\n",
				);

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
				modalSamplePlayer = mountChordPlayer(container, sampleChords, {
					audioContext: options.audioContext ?? ownCtx ?? undefined,
					volume: options.volume ?? 100,
					bpm: options.bpm ?? 120,
					studio: options.studio,
					// 再帰的なモーダル生成を防ぐ。
					_skipInfoModals: true,
					onStop: () => {
						if (activeSampleBtn === el) resetSampleBtn(el);
					},
				});
				markPlaying(el);
				modalSamplePlayer.play();
			});
		}
	};

	if (!options._skipInfoModals) {
		showChordsItem.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleMenu(false);
			const modalBody = openInfoModal("コード進行を表示");
			const desc = doc.createElement("p");
			desc.textContent =
				"このコード進行をコピーして、他のプレイヤーや共有URLに貼り付けて使用できます。";
			desc.style.marginBottom = "8px";
			modalBody.appendChild(desc);
			const sourceChords = options.getChords?.() ?? chords;
			const pre = doc.createElement("pre");
			pre.textContent = sourceChords;
			pre.style.whiteSpace = "pre-wrap";
			pre.style.wordBreak = "break-all";
			pre.style.cursor = "text";
			pre.addEventListener("click", () => {
				const range = doc.createRange();
				range.selectNodeContents(pre);
				const sel = doc.defaultView?.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			});
			modalBody.appendChild(pre);
			appendCopyButton(modalBody, sourceChords);
		});

		chordInfoItem.addEventListener("click", (e) => {
			e.stopPropagation();
			toggleMenu(false);
			const modalBody = openInfoModal("コード進行の書き方解説");
			modalBody.innerHTML = CHORD_INFO_HTML;
			wireSampleButtons(modalBody);
		});

		embedItem.addEventListener("click", async (e) => {
			e.stopPropagation();
			toggleMenu(false);
			const modalBody = openInfoModal("埋め込む");
			const loading = doc.createElement("p");
			loading.textContent = "生成中...";
			modalBody.appendChild(loading);
			try {
				const embedBase =
					options.embedUrl ??
					"https://onjmin.github.io/dtm/demo/embed-chord.html";
				const sourceChords = options.getChords?.() ?? chords;
				const payload = await encodeMml(sourceChords);
				const url = `${embedBase}#${payload}`;
				const snippet = `<iframe src="${url}" width="100%" height="260" frameborder="0" loading="lazy" title="@onjmin/dtm chord progression player"></iframe>`;
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
	}

	copyChordsItem.addEventListener("click", async (e) => {
		e.stopPropagation();
		const success = await copyToClipboard(doc, options.getChords?.() ?? chords);
		if (success) {
			copyChordsItem.textContent = "コピーしました！";
		} else {
			copyChordsItem.textContent = "コピー失敗";
		}
		setTimeout(() => {
			copyChordsItem.textContent = "コード進行コピー";
		}, 2000);
	});

	// BPM recompute (called on every BPM change)
	const recomputeTimings = (newBpm: number) => {
		bpm = Math.max(40, Math.min(240, newBpm));
		try {
			chordEvents = parseChords(chords, bpm);
		} catch {
			chordEvents = [];
		}
		secondsPerBar = (60 / bpm) * 4;
		secondsPerStep = secondsPerBar / DEFAULT_STEPS_PER_BAR;
		secondsPerBeat = 60 / bpm;
		totalSec =
			chordEvents.length > 0
				? chordEvents[chordEvents.length - 1].when +
					chordEvents[chordEvents.length - 1].duration
				: 0;
		bpmInput.value = String(bpm);
		updateTimeDisplay(isPlaying ? playOffsetSec : 0);
		if (isPlaying) seekTo(Math.max(0, activeIndex));
	};

	const changeBpm = (delta: number) => {
		const next = Math.max(40, Math.min(240, bpm + delta));
		if (next !== bpm) recomputeTimings(next);
	};

	// Hold-to-repeat on BPM buttons
	const setupBpmBtn = (btn: HTMLButtonElement, delta: number) => {
		let repeatId: ReturnType<typeof setTimeout> | null = null;
		const stop = () => {
			if (repeatId !== null) {
				clearInterval(repeatId);
				repeatId = null;
			}
		};
		const start = () => {
			changeBpm(delta);
			repeatId = setTimeout(() => {
				repeatId = setInterval(
					() => changeBpm(delta),
					80,
				) as unknown as ReturnType<typeof setTimeout>;
			}, 400);
		};
		btn.addEventListener("mousedown", start);
		btn.addEventListener(
			"touchstart",
			(e) => {
				e.preventDefault();
				start();
			},
			{ passive: false },
		);
		btn.addEventListener("mouseup", stop);
		btn.addEventListener("mouseleave", stop);
		btn.addEventListener("touchend", stop);
	};
	setupBpmBtn(bpmDecBtn, -5);
	setupBpmBtn(bpmIncBtn, +5);

	// 3楽器のWAFフォントをバックグラウンドでプリロード（マウント直後に開始）
	// → 初回クリック時のローディング待ち時間を短縮する
	const preloadInstruments = () => {
		const ctx = ownCtx ?? options.audioContext;
		if (!ctx) return;
		for (const key of ["piano", "guitar", "strings"] as const) {
			const gmName = WAF_TONE_PRESETS[key].gmName;
			if (gmName) loadWafFont(ctx, gmName);
		}
	};
	// AudioContext はユーザー操作後に生成されるため、preload は play() 初回呼び出し後に委ねる

	// ── プログレスバー（クリックでシーク） ──
	const progress = doc.createElement("div");
	progress.className = "dtm-cp-progress";
	progress.title = "クリックでシーク";
	const progressFill = doc.createElement("div");
	progressFill.className = "dtm-cp-progress-fill";
	progress.appendChild(progressFill);
	container.appendChild(progress);

	const setProgress = (ratio: number) => {
		const clamped = Math.max(0, Math.min(1, ratio));
		progressFill.style.width = `${clamped * 100}%`;
		progressFill.classList.toggle("dtm-cp-progress-fill--on", clamped > 0);
	};

	// ── スクロールエリア ──
	const scrollArea = doc.createElement("div");
	scrollArea.className = "dtm-cp-scroll";

	const chordSpans: HTMLElement[] = [];

	// UIレンダリング
	displayLines.forEach((dl) => {
		const palette = SECTION_COLOR_LIST[dl.colorIdx % SECTION_COLOR_LIST.length];

		if (dl.type === "section") {
			const secDiv = doc.createElement("div");
			secDiv.className = "dtm-cp-section";
			secDiv.style.setProperty("--cp-fg", palette.fg);
			secDiv.style.setProperty("--cp-bg", palette.bg);
			secDiv.textContent = dl.section ?? "";
			scrollArea.appendChild(secDiv);
			return;
		}

		const barDiv = doc.createElement("div");
		barDiv.className = "dtm-cp-bar";

		dl.parts?.forEach((p) => {
			if (!p.isChord) {
				const pipeSpan = doc.createElement("span");
				pipeSpan.className = "dtm-cp-pipe";
				pipeSpan.textContent = p.text;
				barDiv.appendChild(pipeSpan);
				return;
			}

			const chordSpan = doc.createElement("span");
			chordSpan.className = "dtm-cp-chord";
			chordSpan.style.setProperty("--cp-fg", palette.fg);
			chordSpan.style.setProperty("--cp-bg", palette.bg);
			chordSpan.textContent = p.text;
			chordSpan.setAttribute("data-eidx", String(p.eventIdx));

			if (p.eventIdx >= 0) {
				// タップでそのコードから再生
				chordSpan.setAttribute("role", "button");
				chordSpan.setAttribute("tabindex", "0");
				chordSpan.title = "ここから再生";
				chordSpan.addEventListener("click", () => seekTo(p.eventIdx));
				chordSpan.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter" || ev.key === " ") {
						ev.preventDefault();
						seekTo(p.eventIdx);
					}
				});
			} else {
				chordSpan.classList.add("dtm-cp-chord--dead");
			}

			barDiv.appendChild(chordSpan);
			chordSpans.push(chordSpan);
		});

		scrollArea.appendChild(barDiv);
	});

	container.appendChild(scrollArea);
	target.appendChild(container);

	// ── アクティブインデックス計算 ──
	const getActiveIndexBySec = (currentSec: number): number => {
		return chordEvents.findIndex((event) => {
			return (
				currentSec >= event.when && currentSec < event.when + event.duration
			);
		});
	};

	// ── アクティブコード表示の更新 ──
	const updateActiveIndex = (idx: number) => {
		if (idx === activeIndex) return;
		activeIndex = idx;

		for (const s of chordSpans) {
			const eidx = Number(s.getAttribute("data-eidx"));
			if (eidx < 0) continue;
			s.classList.toggle("dtm-cp-chord--active", eidx === idx);
			// 再生済みコードは薄く表示して現在位置を分かりやすくする
			s.classList.toggle("dtm-cp-chord--played", idx >= 0 && eidx < idx);
		}

		if (idx >= 0) {
			const activeSpan = chordSpans.find(
				(s) => s.getAttribute("data-eidx") === String(idx),
			);
			if (activeSpan) {
				// 自動横スクロール（アクティブコードを中央に）
				const elCenter = activeSpan.offsetLeft + activeSpan.offsetWidth / 2;
				const containerCenter = scrollArea.clientWidth / 2;
				const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;
				scrollArea.scrollLeft = Math.max(
					0,
					Math.min(elCenter - containerCenter, Math.max(0, maxScroll)),
				);
			}
		}
	};

	// ── メトロノームスケジューラ ──
	/**
	 * WAF ドラム音でメトロノームを鳴らす。
	 * AudioContext の先読みスケジューリングを使い、次ビートを PLAN_AHEAD 秒先まで
	 * 予約してから setTimeout で起床し直す（sequencer と同じ先読み方式）。
	 */
	const METRONOME_PLAN_AHEAD = 0.12; // 先読み秒数

	const scheduleMetronomeBeats = (ctx: AudioContext, cutGain: GainNode) => {
		if (!metronomeEnabled || !isPlaying) return;

		const now = ctx.currentTime;
		// 現在の再生位置（秒）を AudioContext 時刻から逆算
		const playedSec = now - metronomeStartCtxTime + metronomeStartPlaySec;
		// 現在ビートインデックス
		const currentBeat = Math.floor(playedSec / secondsPerBeat);

		// 先読み範囲内のビートをスケジュール
		let beat = Math.max(metronomeNextBeat, currentBeat);
		while (true) {
			const beatAbsSec =
				metronomeStartCtxTime + (beat * secondsPerBeat - metronomeStartPlaySec);
			if (beatAbsSec > now + METRONOME_PLAN_AHEAD) break;
			if (beatAbsSec >= now - 0.01) {
				// ビート1拍目（小節頭）はキック、それ以外はハイハット
				const isDownbeat = beat % 4 === 0;
				const pitch = isDownbeat ? DRUM_KEYS.kick : DRUM_KEYS.hihatClosed;
				const velocity = isDownbeat ? 0.7 : 0.45;

				// WAFドラム音があれば使う、なければオシレータシンセで代替
				const wafDrum = _drumCache.get(pitch);
				if (wafDrum) {
					wafDrum.play({
						ctx,
						destination: cutGain,
						pitch,
						volume: velocity,
						when: Math.max(0, beatAbsSec - ctx.currentTime),
					});
				} else {
					// シンセフォールバック
					const synth = createSynth(ctx, cutGain);
					synth.playDrum({
						pitch,
						velocity,
						when: Math.max(0, beatAbsSec - ctx.currentTime),
						duration: 0.3,
					});
				}
			}
			beat++;
		}
		metronomeNextBeat = beat;

		// 次の起床タイミング（先読み幅の半分後）
		metronomeTimer = setTimeout(
			() => scheduleMetronomeBeats(ctx, cutGain),
			(METRONOME_PLAN_AHEAD / 2) * 1000,
		);
	};

	/**
	 * メトロノームを開始する。
	 * playOffsetSec（現在の再生開始位置）に合わせてビート位置を揃える。
	 */
	const startMetronome = (
		ctx: AudioContext,
		cutGain: GainNode,
		isResume = false,
	) => {
		stopMetronome();
		if (!metronomeEnabled) return;

		if (isResume) {
			metronomeStartCtxTime = ctx.currentTime;
			metronomeStartPlaySec = currentPlaySec;
			metronomeNextBeat = Math.ceil(currentPlaySec / secondsPerBeat);
		} else {
			// Must match sequencer.ts START_DELAY = 0.1 so beat 0 fires exactly with the first note.
			// The sequencer does: startTime = ctx.currentTime + 0.1 inside seq.start().
			// Without this offset the metronome fires 100 ms early.
			const SEQ_START_DELAY = 0.1;
			metronomeStartCtxTime = ctx.currentTime + SEQ_START_DELAY;
			metronomeStartPlaySec = playOffsetSec;
			metronomeNextBeat = Math.ceil(playOffsetSec / secondsPerBeat);
		}

		// Preload drum WAF in background; synth fallback handles beats until they are cached
		for (const p of [DRUM_KEYS.kick, DRUM_KEYS.hihatClosed]) {
			if (!_drumCache.has(p)) loadDrumFont(ctx, p);
		}

		// Schedule immediately - no async wait that would offset the first beat
		scheduleMetronomeBeats(ctx, cutGain);
	};

	/** WAF音源で発音する関数。ロード済みなら即使用、未ロードならオシレータシンセで代替。 */
	type WafPlayFn = (e: {
		pitch: number;
		velocity: number;
		volume: number;
		when: number;
		duration: number;
		ctx: AudioContext;
		destination: GainNode;
	}) => void;

	/**
	 * activeGmName を動的に参照して発音する（楽器切り替えをリアルタイムに反映）。
	 * WAFキャッシュにあれば使い、なければオシレータシンセで代替。
	 */
	const wafPlayDynamic: WafPlayFn = ({
		pitch,
		volume,
		when,
		duration,
		ctx,
		destination,
	}) => {
		const waf = activeGmName ? _wafCache.get(activeGmName) : null;
		if (waf) {
			waf.play({
				ctx,
				destination,
				pitch,
				volume: volume * 0.85,
				when,
				duration,
			});
		} else {
			const synth = createSynth(ctx, destination);
			synth.playNote({
				trackId: "chord",
				pitch,
				velocity: 100,
				volume,
				when,
				duration,
			});
		}
	};

	/**
	 * 再生処理の本体。WAF ロード完了後に呼ばれる。
	 * startIdx: 再生開始コードインデックス
	 * ctx/cutGain: ロード前に確保済みのオーディオグラフ
	 */
	const playInternal = (
		startIdx: number,
		ctx: AudioContext,
		cutGain: GainNode,
	) => {
		const C3 = 48;
		const volume = options.volume ?? 80;
		const placements: Array<{
			trackIndex: number;
			startStep: number;
			durationSteps: number;
			pitch: number;
			velocity: number;
		}> = [];

		for (const event of chordEvents) {
			if (event.when < playOffsetSec) continue;
			const whenStep = Math.floor(
				(event.when - playOffsetSec) / secondsPerStep,
			);
			const durationSteps = Math.floor(event.duration / secondsPerStep);
			let notes: number[];
			try {
				notes = [...parseChord(`${event.key}${event.chord}`).notes];
			} catch {
				continue;
			}
			for (const noteOffset of notes) {
				placements.push({
					trackIndex: 3,
					startStep: whenStep,
					durationSteps,
					pitch: C3 + noteOffset,
					velocity: 100,
				});
			}
		}

		const playOptions: PlayPlacementsOptions = {
			bpm,
			volume,
			loop: loopEnabled,
			audioContext: ctx,
			synth: false,
			onPlayNote: (e) => {
				wafPlayDynamic({
					pitch: e.pitch,
					velocity: e.velocity,
					volume: e.volume,
					when: e.when,
					duration: e.duration,
					ctx,
					destination: cutGain,
				});
			},
			// 自前 ctx のときだけタブ非アクティブで自動一時停止（従来挙動の踏襲）
			pauseWhenHidden: !options.audioContext,
			onTick: (step) => {
				const span = totalSec - playOffsetSec;
				let rel = step * secondsPerStep;
				// ループ中に step がリセットされない実装でも時刻が範囲内に収まるようにする
				if (span > 0 && rel > span && loopEnabled) rel %= span;
				const currentSec = playOffsetSec + rel;
				currentPlaySec = currentSec;
				updateActiveIndex(getActiveIndexBySec(currentSec));
				updateTimeDisplay(Math.min(currentSec, totalSec));
				setProgress(totalSec > 0 ? currentSec / totalSec : 0);
			},
			onStop: () => {
				handlePlaybackStop();
			},
		};

		activePlayback = playPlacements(placements, playOptions);

		// メトロノームをコードと同時に開始
		startMetronome(ctx, cutGain);
	};

	const play = (fromIndex = 0) => {
		if (isPlaying || isLoading || chordEvents.length === 0) return;
		const startIdx = Math.max(0, Math.min(fromIndex, chordEvents.length - 1));
		playOffsetSec = chordEvents[startIdx].when;
		currentPlaySec = playOffsetSec;

		// AudioContext と cutGain はロード待ち前に確保する（AudioContext.resume の
		// タイミングをユーザー操作コールスタック内に収めるため）
		ownCtx ??= options.audioContext ? null : new AudioContext();
		const ctx = options.audioContext ?? (ownCtx as AudioContext);
		const cutGain = ctx.createGain();
		cutGain.connect(ctx.destination);
		activeCut = { gain: cutGain, ctx };

		const startPlayback = () => {
			isPlaying = true;
			setPlayBtnStyle(true);
			updateActiveIndex(startIdx);
			updateTimeDisplay(playOffsetSec);
			setProgress(totalSec > 0 ? playOffsetSec / totalSec : 0);
			playInternal(startIdx, ctx, cutGain);
		};

		// WAF 音源が未ロードならスピナーを出してロード完了を待つ
		if (activeGmName && !_wafCache.has(activeGmName)) {
			const myAbortId = ++loadAbortId;
			setLoadingUI(true);
			loadWafFont(ctx, activeGmName).then(() => {
				if (loadAbortId !== myAbortId) return; // stop/seek でキャンセルされた
				setLoadingUI(false);
				startPlayback();
			});
		} else {
			// すでにキャッシュ済み（または square = WAF なし）は即時再生
			startPlayback();
		}
		// 初回 AudioContext 確保後に残り2楽器もバックグラウンドプリロード
		preloadInstruments();
	};

	/** 指定コードから再生し直す（停止中なら再生開始）。前の音は即座に切る */
	const seekTo = (idx: number) => {
		// ロード中なら先にキャンセル
		if (isLoading) {
			++loadAbortId;
			setLoadingUI(false);
		}
		if (isPlaying) {
			// onStop を発火させずに現在の再生だけ破棄する
			activePlayback?.destroy();
			activePlayback = null;
			stopMetronome();
			killSound();
			isPlaying = false;
		}
		play(idx);
	};

	progress.addEventListener("click", (ev) => {
		if (totalSec <= 0) return;
		const rect = progress.getBoundingClientRect();
		if (rect.width <= 0) return;
		const sec = ((ev.clientX - rect.left) / rect.width) * totalSec;
		const idx = getActiveIndexBySec(sec);
		seekTo(idx >= 0 ? idx : 0);
	});

	const stop = () => {
		// ロード中のキャンセル（ロードが完了しても再生しない）
		if (isLoading) {
			++loadAbortId;
			setLoadingUI(false);
			// cutGain は確保済みなので切り離す
			killSound();
			return;
		}
		if (!isPlaying) return;
		activePlayback?.destroy();
		activePlayback = null;
		stopMetronome();
		killSound();
		handlePlaybackStop();
	};

	const handlePlaybackStop = () => {
		isPlaying = false;
		setPlayBtnStyle(false);
		updateActiveIndex(-1);
		updateTimeDisplay(0);
		setProgress(0);
		options.onStop?.();
	};

	playBtn.addEventListener("click", () => {
		if (isPlaying) {
			stop();
		} else {
			play();
		}
	});

	/** メトロノームのオン/オフを切り替える */
	const toggleMetronome = () => {
		metronomeEnabled = !metronomeEnabled;
		metroBtn.classList.toggle("dtm-cp-metro--on", metronomeEnabled);
		metroBtn.title = metronomeEnabled ? "METRONOME ON" : "METRONOME OFF";
		if (isPlaying) {
			if (metronomeEnabled) {
				// 現在の cutGain に繋いでメトロノームを再開
				if (activeCut) {
					startMetronome(activeCut.ctx, activeCut.gain, true);
				}
			} else {
				stopMetronome();
				// 既スケジュール済みの音は cutGain でミュートできないため、
				// seek で再起動してメトロノームなしで再開する
				seekTo(Math.max(0, activeIndex));
			}
		}
	};

	const destroy = () => {
		stop();
		closeInfoModal();
		toggleMenu(false);
		container.remove();
	};

	// ── スタイル注入（メトロノームボタン + ローディングスピナー） ──
	const metroStyle = doc.createElement("style");
	metroStyle.textContent = `
		.dtm-cp-metro {
			background: none;
			border: 1px solid var(--c-black, #000);
			color: var(--dtm-fg, #fff);
			font-size: 13px;
			padding: 2px 6px;
			cursor: pointer;
			border-radius: 2px;
			opacity: 0.45;
			transition: opacity 0.15s, background 0.15s;
		}
		.dtm-cp-metro:hover { opacity: 0.75; }
		.dtm-cp-metro--on {
			opacity: 1;
			background: var(--dtm-primary, #29adff);
			color: #000;
			border-color: var(--dtm-primary, #29adff);
		}
		@keyframes dtm-cp-spin {
			from { transform: rotate(0deg); }
			to   { transform: rotate(360deg); }
		}
		.dtm-cp-spinner {
			display: inline-block;
			width: 10px;
			height: 10px;
			border: 2px solid rgba(255,255,255,0.3);
			border-top-color: #fff;
			border-radius: 50%;
			animation: dtm-cp-spin 0.7s linear infinite;
			vertical-align: middle;
		}
		/* 楽器トグルボタン群 */
		.dtm-cp-instr-group {
			display: flex;
			gap: 2px;
			border: 1px solid rgba(255,255,255,0.15);
			border-radius: 4px;
			overflow: hidden;
		}
		.dtm-cp-instr-btn {
			background: rgba(255,255,255,0.06);
			border: none;
			color: rgba(255,255,255,0.5);
			font-size: 11px;
			padding: 2px 7px;
			cursor: pointer;
			transition: background 0.15s, color 0.15s;
			white-space: nowrap;
		}
		.dtm-cp-instr-btn:hover {
			background: rgba(255,255,255,0.14);
			color: rgba(255,255,255,0.85);
		}
		.dtm-cp-instr-btn--active {
			background: var(--dtm-primary, #29adff) !important;
			color: #000 !important;
			font-weight: bold;
		}
		/* BPM widget styles */
		.dtm-cp-bpm-group {
			display: flex;
			align-items: center;
			gap: 0;
			border: 1px solid rgba(255,255,255,0.15);
			border-radius: 4px;
			overflow: hidden;
		}
		.dtm-cp-bpm-btn {
			background: rgba(255,255,255,0.06);
			border: none;
			color: rgba(255,255,255,0.7);
			font-size: 14px;
			padding: 1px 7px 2px;
			cursor: pointer;
			line-height: 1;
			user-select: none;
			-webkit-user-select: none;
			transition: background 0.1s;
		}
		.dtm-cp-bpm-btn:hover {
			background: rgba(255,255,255,0.18);
			color: #fff;
		}
		.dtm-cp-bpm-btn:active {
			background: var(--dtm-primary, #29adff);
			color: #000;
		}
		.dtm-cp-bpm-input {
			font-size: 11px;
			color: rgba(255,255,255,0.7);
			background: none;
			border: none;
			padding: 0;
			white-space: nowrap;
			width: 48px;
			text-align: center;
			font-family: inherit;
		}
		.dtm-cp-bpm-input::-webkit-outer-spin-button,
		.dtm-cp-bpm-input::-webkit-inner-spin-button {
			-webkit-appearance: none;
			margin: 0;
		}
		.dtm-cp-bpm-input[type=number] {
			-moz-appearance: textfield;
		}
		.dtm-cp-bpm-input:focus {
			outline: none;
			background: rgba(255,255,255,0.15);
			color: #fff;
		}
	`;
	if (!doc.getElementById("dtm-cp-metro-style")) {
		metroStyle.id = "dtm-cp-metro-style";
		doc.head.appendChild(metroStyle);
	}

	return {
		element: container,
		play,
		stop,
		destroy,
		toggleMetronome,
		isPlaying: () => isPlaying,
	};
};
