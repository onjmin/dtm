import { parseChords } from "@onjmin/chord-parser";
import { buildChordPlacements, type ChordPatternType } from "./chords";
import {
	playChords,
	type PlayChordsOptions,
	type MmlPlayback,
} from "./headless-player";
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

export type MountChordPlayerOptions = {
	/** 使用する AudioContext（省略時は内部生成） */
	audioContext?: AudioContext;
	/** 音量 0-100 */
	volume?: number;
	/** BPM 既定120 */
	bpm?: number;
	/** 伴奏パターン 既定 \"block\" */
	patternType?: ChordPatternType;
	/** ルートシフト */
	rootShift?: number;
	/** スタジオインスタンス（DtmStudio）。指定時は高品質SoundFontが使われます */
	studio?: any;
	/** 再生終了時コールバック */
	onStop?: () => void;
};

export type ChordPlayerInstance = {
	element: HTMLElement;
	play: () => void;
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

	// BPM表示
	const bpmSpan = doc.createElement("span");
	bpmSpan.className = "dtm-cp-meta";
	bpmSpan.textContent = `BPM ${bpm}`;

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
	ctrlBar.appendChild(bpmSpan);
	ctrlBar.appendChild(timeSpan);
	container.appendChild(ctrlBar);

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
			secDiv.style.color = palette.fg;
			secDiv.style.borderLeftColor = palette.fg;
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
			chordSpan.style.color = palette.fg;
			chordSpan.textContent = p.text;
			chordSpan.setAttribute("data-eidx", String(p.eventIdx));
			chordSpan.setAttribute("data-cidx", String(dl.colorIdx));

			barDiv.appendChild(chordSpan);
			chordSpans.push(chordSpan);
		});

		scrollArea.appendChild(barDiv);
	});

	container.appendChild(scrollArea);
	target.appendChild(container);

	// ── アクティブインデックス計算 ──
	const getActiveIndex = (currentStep: number): number => {
		const currentSec = currentStep * secondsPerStep;
		return chordEvents.findIndex((event) => {
			return (
				currentSec >= event.when && currentSec < event.when + event.duration
			);
		});
	};

	// ── アクティブコード表示の更新 ──
	const updateActiveIndex = (idx: number) => {
		if (idx === activeIndex) return;

		// 以前のハイライトをリセット
		if (activeIndex >= 0) {
			const prevSpan = chordSpans.find(
				(s) => s.getAttribute("data-eidx") === String(activeIndex),
			);
			if (prevSpan) {
				const cidx = Number(prevSpan.getAttribute("data-cidx") ?? 0);
				const pal = SECTION_COLOR_LIST[cidx % SECTION_COLOR_LIST.length];
				prevSpan.classList.remove("dtm-cp-chord--active");
				prevSpan.style.color = pal.fg;
				prevSpan.style.backgroundColor = "";
			}
		}

		activeIndex = idx;

		// 新しいハイライトを適用
		if (activeIndex >= 0) {
			const activeSpan = chordSpans.find(
				(s) => s.getAttribute("data-eidx") === String(activeIndex),
			);
			if (activeSpan) {
				const cidx = Number(activeSpan.getAttribute("data-cidx") ?? 0);
				const pal = SECTION_COLOR_LIST[cidx % SECTION_COLOR_LIST.length];
				activeSpan.classList.add("dtm-cp-chord--active");
				activeSpan.style.color = "#000000";
				activeSpan.style.backgroundColor = pal.fg;

				// 自動横スクロール（アクティブコードを中央に）
				const elCenter = activeSpan.offsetLeft + activeSpan.offsetWidth / 2;
				const containerCenter = scrollArea.clientWidth / 2;
				const maxScroll = scrollArea.scrollWidth - scrollArea.clientWidth;
				scrollArea.scrollLeft = Math.max(
					0,
					Math.min(elCenter - containerCenter, Math.max(0, maxScroll)),
				);
			}

			// 時間表示の同期
			const currentSec = chordEvents[activeIndex].when;
			updateTimeDisplay(currentSec);
		} else {
			updateTimeDisplay(0);
		}
	};

	const play = () => {
		if (isPlaying || chordEvents.length === 0) return;
		isPlaying = true;
		setPlayBtnStyle(true);
		updateActiveIndex(0);

		const playOpts: PlayChordsOptions = {
			volume: options.volume ?? 80,
			bpm,
			patternType: options.patternType ?? "block",
			rootShift: options.rootShift ?? 0,
			audioContext: options.audioContext,
			onTick: (step) => {
				const idx = getActiveIndex(step);
				updateActiveIndex(idx);
			},
			onStop: () => {
				handlePlaybackStop();
			},
		};

		if (options.studio) {
			activePlayback = options.studio.playChords(chords, playOpts);
		} else {
			activePlayback = playChords(chords, playOpts);
		}
	};

	const stop = () => {
		if (!isPlaying) return;
		activePlayback?.destroy();
		activePlayback = null;
		handlePlaybackStop();
	};

	const handlePlaybackStop = () => {
		isPlaying = false;
		setPlayBtnStyle(false);
		updateActiveIndex(-1);
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
