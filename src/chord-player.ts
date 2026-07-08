import { parseChords, parseChord } from "@onjmin/chord-parser";
import {
	playPlacements,
	type PlayPlacementsOptions,
	type MmlPlayback,
} from "./headless-player";
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
};

export type ChordPlayerInstance = {
	element: HTMLElement;
	/** 再生開始。fromIndex でコードイベントの途中から開始できる */
	play: (fromIndex?: number) => void;
	stop: () => void;
	destroy: () => void;
	/** メトロノームのオン/オフを切り替える */
	toggleMetronome: () => void;
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
				const c = bar[j];
				if (/^[A-G]$/.test(c)) {
					const prev = bar[j - 1];
					const prev2 = bar.slice(j - 2, j);
					if (prev === "/" || prev2 === "on") continue;
					splitAt.push(j);
				}
			}

			if (splitAt.length === 0) {
				parts.push({
					text: bar,
					isChord: true,
					eventIdx: eventCounter < eventsCount ? eventCounter : -1,
				});
				eventCounter++;
				continue;
			}

			for (let ci = 0; ci < splitAt.length; ci++) {
				if (ci > 0) parts.push({ text: "", isChord: false, eventIdx: -1 });
				const start = splitAt[ci];
				const end = ci < splitAt.length - 1 ? splitAt[ci + 1] : bar.length;
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

	const bpm = options.bpm ?? 120;
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
	const tonePreset =
		(toneName ? WAF_TONE_PRESETS[toneName] : undefined) ??
		WAF_TONE_PRESETS.piano;

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
	const secondsPerBar = (60 / bpm) * 4;
	const secondsPerStep = secondsPerBar / DEFAULT_STEPS_PER_BAR;
	const secondsPerBeat = 60 / bpm;

	const totalSec =
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

	// BPM表示
	const bpmSpan = doc.createElement("span");
	bpmSpan.className = "dtm-cp-meta";
	bpmSpan.textContent = `BPM ${bpm}`;

	// 音色表示（#tone= 指定時のみ意味を持つが、既定でも現在の音色を示す）
	const toneSpan = doc.createElement("span");
	toneSpan.className = "dtm-cp-meta";
	toneSpan.textContent = `♪${tonePreset.label}`;

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
	ctrlBar.appendChild(bpmSpan);
	ctrlBar.appendChild(toneSpan);
	ctrlBar.appendChild(timeSpan);
	container.appendChild(ctrlBar);

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
	const startMetronome = (ctx: AudioContext, cutGain: GainNode) => {
		stopMetronome();
		if (!metronomeEnabled) return;

		metronomeStartCtxTime = ctx.currentTime;
		metronomeStartPlaySec = playOffsetSec;
		// 現在の再生位置に最も近い次のビートから始める
		metronomeNextBeat = Math.ceil(playOffsetSec / secondsPerBeat);

		// ドラム音源を非同期でプリロード（初回のみネットワーク）
		const pitches = [DRUM_KEYS.kick, DRUM_KEYS.hihatClosed];
		Promise.all(pitches.map((p) => loadDrumFont(ctx, p))).then(() => {
			if (isPlaying && metronomeEnabled) {
				scheduleMetronomeBeats(ctx, cutGain);
			}
		});
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

	const makeWafPlayFn = (gmName: string | null): WafPlayFn => {
		return ({ pitch, volume, when, duration, ctx, destination }) => {
			const waf = gmName ? _wafCache.get(gmName) : null;
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
				// フォールバック: オシレータシンセ
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

		const wafPlay = makeWafPlayFn(tonePreset.gmName);

		const playOptions: PlayPlacementsOptions = {
			bpm,
			volume,
			loop: loopEnabled,
			audioContext: ctx,
			synth: false,
			onPlayNote: (e) => {
				wafPlay({
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
		if (tonePreset.gmName && !_wafCache.has(tonePreset.gmName)) {
			const myAbortId = ++loadAbortId;
			setLoadingUI(true);
			loadWafFont(ctx, tonePreset.gmName).then(() => {
				if (loadAbortId !== myAbortId) return; // stop/seek でキャンセルされた
				setLoadingUI(false);
				startPlayback();
			});
		} else {
			// すでにキャッシュ済み（または square = WAF なし）は即時再生
			startPlayback();
		}
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
					startMetronome(activeCut.ctx, activeCut.gain);
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
	};
};
