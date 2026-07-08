import { parseChords, parseChord } from "@onjmin/chord-parser";
import {
	playPlacements,
	type PlayPlacementsOptions,
	type MmlPlayback,
} from "./headless-player";
import { createSynth, type SynthTone } from "./synth";
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

/**
 * `#tone=<名前>` で指定できる音色プリセット。
 * 軽量シンセ（オシレータ）の波形とエンベロープの組み合わせで近似する。
 */
const TONE_PRESETS: Record<string, { label: string; tone: SynthTone }> = {
	square: { label: "SQUARE", tone: {} },
	piano: { label: "PIANO", tone: { wave: "triangle", decay: true, gain: 1.5 } },
	guitar: {
		label: "GUITAR",
		tone: { wave: "sawtooth", decay: true, gain: 0.7 },
	},
	organ: { label: "ORGAN", tone: { wave: "square", attack: 0.02, gain: 0.8 } },
	strings: {
		label: "STRINGS",
		tone: { wave: "sawtooth", attack: 0.15, gain: 0.55 },
	},
	bell: { label: "BELL", tone: { wave: "sine", decay: true, gain: 1.8 } },
	sine: { label: "SINE", tone: { wave: "sine", gain: 1.6 } },
	triangle: { label: "TRIANGLE", tone: { wave: "triangle", gain: 1.4 } },
	sawtooth: { label: "SAWTOOTH", tone: { wave: "sawtooth", gain: 0.6 } },
};

/**
 * 入力文字列から `#tone=<名前>` メタ行を読み取る。
 * `#` 行は parseChords 側でコメントとして無視されるため、進行の解析には影響しない。
 */
const parseToneMeta = (chords: string): string | null => {
	const m = chords.match(/^#\s*tone\s*=\s*([a-zA-Z]+)\s*$/im);
	return m ? m[1].toLowerCase() : null;
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
	let loopEnabled = false;
	/** 再生開始位置（秒）。途中再生時に onTick の step を絶対時刻へ換算する */
	let playOffsetSec = 0;
	/** audioContext 未指定時に内部生成する ctx（初回再生時に生成、destroy で閉じる） */
	let ownCtx: AudioContext | null = null;
	/** 現在の再生の出力を束ねる Gain。停止・シーク時にここを絞って即座に音を切る */
	let activeCut: { gain: GainNode; ctx: AudioContext } | null = null;

	// 音色プリセットの解決（#tone=piano 等。未指定は従来の square）
	const toneName = parseToneMeta(chords);
	const tonePreset =
		(toneName ? TONE_PRESETS[toneName] : undefined) ?? TONE_PRESETS.square;

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

	const play = (fromIndex = 0) => {
		if (isPlaying || chordEvents.length === 0) return;
		const startIdx = Math.max(0, Math.min(fromIndex, chordEvents.length - 1));
		isPlaying = true;
		setPlayBtnStyle(true);
		playOffsetSec = chordEvents[startIdx].when;
		updateActiveIndex(startIdx);
		updateTimeDisplay(playOffsetSec);
		setProgress(totalSec > 0 ? playOffsetSec / totalSec : 0);

		// chordEvents から block コードの配置データを直接構築する
		// （途中再生時は開始コードの when を step 0 に平行移動する）
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

		// 注入 ctx（studio 等）がなければ自前の ctx を初回再生時に生成する。
		// どちらの場合も出力を「カット用 Gain」経由にして、停止・シークで即消音できるようにする。
		ownCtx ??= options.audioContext ? null : new AudioContext();
		const ctx = options.audioContext ?? (ownCtx as AudioContext);
		const cutGain = ctx.createGain();
		cutGain.connect(ctx.destination);
		const synth = createSynth(ctx, cutGain, tonePreset.tone);
		activeCut = { gain: cutGain, ctx };

		const playOptions: PlayPlacementsOptions = {
			bpm,
			volume,
			loop: loopEnabled,
			audioContext: ctx,
			synth: false,
			onPlayNote: (e) => synth.playNote(e),
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
	};

	/** 指定コードから再生し直す（停止中なら再生開始）。前の音は即座に切る */
	const seekTo = (idx: number) => {
		if (isPlaying) {
			// onStop を発火させずに現在の再生だけ破棄する
			activePlayback?.destroy();
			activePlayback = null;
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
		if (!isPlaying) return;
		activePlayback?.destroy();
		activePlayback = null;
		handlePlaybackStop();
	};

	const handlePlaybackStop = () => {
		isPlaying = false;
		liveOptions = null;
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

	const destroy = () => {
		stop();
		container.remove();
	};

	return {
		element: container,
		play,
		stop,
		destroy,
	};
};
