/**
 * mountDAW — 1関数でマウントできるモバイルファーストDAWコンポーネント（Layer 2）。
 *
 * 発音は注入フック（onPlayNote / onPlayDrum）へ委譲し、ライブラリ自体は音を出さない。
 * MIDI/コード解析も注入（parseMidi / parseChord / parseChords）。未注入なら該当UIを隠す。
 */

import { buildChordPlacements, type ChordPatternType } from "./chords";
import { buildUI } from "./daw-ui";
import { DRUM_PATTERNS } from "./drum-config";
import { icon } from "./icons";
import {
	applyHarmonicFilter,
	applyMonophonic,
	generateRandomPattern,
	shiftNotes,
} from "./macros";
import {
	analyzeMidiTracks,
	exportMIDI as exportMIDIBlob,
	extractMidiPlacements,
} from "./midi-io";
import { MMLCore } from "./mml-core";
import { parseMML } from "./mml-parser";
import {
	drawGrid,
	drawNotes,
	drawSelectedNotes,
	getDrawOffset,
	getGridCanvas,
	getGridContext,
	getGridPosition,
	getHeaderCanvas,
	init,
	setDrawOffset,
} from "./renderer";
import { createSequencer, type Sequencer } from "./sequencer";
import { injectStyles } from "./styles";
import type {
	DawInstance,
	DawOptions,
	Note,
	PlaybackState,
	RenderConfig,
	ToolMode,
	TrackConfig,
} from "./types";

const BASE_STEP_WIDTH = 0.5;
const BASE_KEY_HEIGHT = 15;

const DEFAULT_TRACKS: TrackConfig[] = [
	{
		id: "melody",
		name: "メロディー",
		color: [59, 130, 246],
		instrument: 0,
		volume: 100,
	},
	{
		id: "submelody",
		name: "サブメロ",
		color: [139, 92, 246],
		instrument: 1,
		volume: 95,
	},
	{
		id: "bass",
		name: "ベース",
		color: [16, 185, 129],
		instrument: 2,
		volume: 88,
	},
	{
		id: "chord",
		name: "伴奏",
		color: [245, 158, 11],
		instrument: 3,
		volume: 76,
	},
];

const clamp = (v: number, min: number, max: number): number =>
	Math.min(Math.max(v, min), max);

type TrackState = {
	config: TrackConfig;
	core: MMLCore;
	volume: number;
	savedChordInput: string;
	savedChordPattern: ChordPatternType;
	savedChordRoot: number;
};

/**
 * DAWコンポーネントをマウントする。
 */
export const mountDAW = (
	target: HTMLElement,
	options: DawOptions = {},
): DawInstance => {
	injectStyles();

	const getAudioTime = options.getAudioTime ?? (() => performance.now() / 1000);
	const trackConfigs = options.tracks ?? DEFAULT_TRACKS;
	const drumPatterns = options.drumPatterns ?? DRUM_PATTERNS;
	const showMidi = !!options.parseMidi;
	const showChord = !!(options.parseChord && options.parseChords);

	const refs = buildUI(target, {
		tracks: trackConfigs,
		drumPatternNames: Object.keys(drumPatterns),
		defaultDrumPattern: drumPatterns.dance
			? "dance"
			: (Object.keys(drumPatterns)[0] ?? "none"),
		defaultBpm: options.defaultBpm ?? 120,
		showMidi,
		showChord,
	});

	// --- 描画設定 ---
	const renderConfig: RenderConfig = {
		stepsPerBar: 192,
		keyCount: 128,
		pitchRangeStart: 0,
		keyHeight: BASE_KEY_HEIGHT,
		stepWidth: BASE_STEP_WIDTH * 2, // zoom100% 相当
	};
	const leftPaddingSteps = renderConfig.stepsPerBar * 16;

	// --- 状態 ---
	let zoomX = 100;
	let zoomY = 100;
	let bpm = options.defaultBpm ?? 120;
	let masterVolume = 50;
	let drumVolume = 80;
	let currentDrumPattern = refs.drumSelect.value;
	let activeTrackId = trackConfigs[0].id;
	let activeToolMode: ToolMode = "pen";
	let currentInsertLength = 48;
	let snapGridSteps = 12;
	const gridLineSteps = 48;
	let currentOffsetX = 0;
	let currentOffsetY = (104 - 1 - 60) * renderConfig.keyHeight - 215;
	let playStartStep = 0;
	let isSolo = false;
	let playbackState: PlaybackState = "stopped";
	let pausedPlayStep = 0;
	let currentPlayStep = 0;
	// 初期化完了フラグ（MMLCore構築時の早期コールバックを抑止）
	let ready = false;

	// 選択・コピー
	let selectedNotes: Note[] = [];
	let selectionRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;
	let copiedNotes: Note[] = [];

	// MMLCore は renderer.init() による g_config 設定後に生成する（generateMML が依存）。
	let trackStates: TrackState[] = [];
	const createTrackStates = (): void => {
		trackStates = trackConfigs.map((config) => ({
			config,
			core: new MMLCore(
				{
					onMMLGenerated: () => {},
					onNotesChanged: () => {
						if (!ready) return;
						redrawAll();
						updateUndoRedo();
					},
				},
				config.volume,
			),
			volume: config.volume,
			savedChordInput: "",
			savedChordPattern: "block",
			savedChordRoot: 0,
		}));
	};

	const getActive = (): TrackState =>
		trackStates.find((t) => t.config.id === activeTrackId) ?? trackStates[0];

	// ============================================================
	// 描画
	// ============================================================
	const getMaxNoteStep = (): number => {
		let maxStep = renderConfig.stepsPerBar * 4;
		for (const t of trackStates) {
			for (const n of t.core.getNotes()) {
				const end = n.startStep + n.durationSteps;
				if (end > maxStep) maxStep = end;
			}
		}
		return maxStep;
	};

	const getMaxOffsetY = (): number => {
		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		return Math.max(0, totalHeight - getGridCanvas().height);
	};

	const drawStartLine = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = playStartStep * renderConfig.stepWidth - currentOffsetX;
		if (x < -10 || x > canvas.width + 10) return;
		ctx.save();
		ctx.strokeStyle = "#10B981";
		ctx.lineWidth = 2;
		ctx.setLineDash([5, 3]);
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const drawPlayhead = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = currentPlayStep * renderConfig.stepWidth - currentOffsetX;
		if (x < 0 || x > canvas.width) return;
		ctx.save();
		ctx.strokeStyle = "#EF4444";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const redrawAll = (): void => {
		drawGrid(gridLineSteps);
		for (const t of trackStates) {
			const [r, g, b] = t.config.color;
			const a = t.config.id === activeTrackId ? 1 : 0.3;
			drawNotes(t.core.getNotes(), [r, g, b, a]);
		}
		if (activeToolMode === "select" && selectionRect) {
			const ctx = getGridContext();
			ctx.save();
			ctx.strokeStyle = "#10B981";
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 3]);
			ctx.strokeRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.fillStyle = "rgba(16,185,129,0.1)";
			ctx.fillRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.restore();
		}
		if (activeToolMode === "select" && selectedNotes.length > 0) {
			const ids = new Set(selectedNotes.map((n) => n.id));
			const active = getActive();
			drawSelectedNotes(active.core.getNotes(), ids, [
				...active.config.color,
				1,
			]);
		}
		drawStartLine();
		if (playbackState === "playing") drawPlayhead();
		updateScrollbars();
	};

	// ============================================================
	// スクロールバー
	// ============================================================
	const updateScrollbars = (): void => {
		const canvas = getGridCanvas();
		const maxNoteStep = getMaxNoteStep();
		const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
		const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
		const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
		const sbW = refs.hScroll.clientWidth;
		if (maxOffsetX <= 0) {
			refs.hScrollThumb.style.width = "100%";
			refs.hScrollThumb.style.left = "0";
		} else {
			const thumbW = Math.max(
				40,
				(canvas.width / (totalContentWidth + leftPaddingWidth)) * sbW,
			);
			const ratio = currentOffsetX / maxOffsetX;
			refs.hScrollThumb.style.width = `${thumbW}px`;
			refs.hScrollThumb.style.left = `${clamp(ratio * (sbW - thumbW), 0, sbW - thumbW)}px`;
		}

		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		const sbH = refs.vScroll.clientHeight;
		if (totalHeight <= canvas.height) {
			refs.vScrollThumb.style.height = "100%";
			refs.vScrollThumb.style.top = "0";
		} else {
			const thumbH = Math.max(40, (canvas.height / totalHeight) * sbH);
			const maxOffset = getMaxOffsetY();
			const ratio = currentOffsetY / maxOffset;
			refs.vScrollThumb.style.height = `${thumbH}px`;
			refs.vScrollThumb.style.top = `${ratio * (sbH - thumbH)}px`;
		}
	};

	const initScrollbarDrag = (): void => {
		let draggingH = false;
		let draggingV = false;
		refs.hScroll.addEventListener("pointerdown", (e) => {
			draggingH = true;
			e.preventDefault();
			moveH(e.clientX);
		});
		refs.vScroll.addEventListener("pointerdown", (e) => {
			draggingV = true;
			e.preventDefault();
			moveV(e.clientY);
		});
		document.addEventListener("pointermove", (e) => {
			if (draggingH) moveH(e.clientX);
			if (draggingV) moveV(e.clientY);
		});
		document.addEventListener("pointerup", () => {
			draggingH = false;
			draggingV = false;
		});

		const moveH = (clientX: number): void => {
			const canvas = getGridCanvas();
			const maxNoteStep = getMaxNoteStep();
			const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
			const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
			const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
			if (maxOffsetX <= 0) return;
			const rect = refs.hScroll.getBoundingClientRect();
			const thumbW = Number.parseFloat(refs.hScrollThumb.style.width) || 40;
			const x = clamp(clientX - rect.left - thumbW / 2, 0, rect.width - thumbW);
			const ratio = x / (rect.width - thumbW);
			currentOffsetX = clamp(ratio * maxOffsetX, 0, maxOffsetX);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
		const moveV = (clientY: number): void => {
			const maxOffset = getMaxOffsetY();
			if (maxOffset <= 0) return;
			const rect = refs.vScroll.getBoundingClientRect();
			const thumbH = Number.parseFloat(refs.vScrollThumb.style.height) || 40;
			const y = clamp(clientY - rect.top - thumbH / 2, 0, rect.height - thumbH);
			const ratio = y / (rect.height - thumbH);
			currentOffsetY = clamp(ratio * maxOffset, 0, maxOffset);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
	};

	// ============================================================
	// グリッド操作（ペン/選択/消しゴム）
	// ============================================================
	const resizeHandleWidth = 6;
	let suppressClick = false;
	let hasDragged = false;
	let dragState: null | {
		noteId: number;
		mode: "move" | "resize";
		dragOffsetStep: number;
		dragOffsetPitch: number;
		startStep: number;
		durationSteps: number;
		lastPreviewPitch: number;
	} = null;
	// 選択モードのドラッグ
	let isSelecting = false;
	let dragMode: "rect" | "move" = "rect";
	let selectionStart: {
		x: number;
		y: number;
		step: number;
		pitch: number;
	} | null = null;
	let selectedOriginal: { id: number; startStep: number; pitch: number }[] = [];
	let lastMultiPreviewPitch: number | null = null;

	const playPreview = (pitch: number): void => {
		options.onResumeAudio?.();
		const active = getActive();
		dispatchNote(active.config.id, pitch, active.volume, 100, 0, 0.1);
	};

	const findActiveNoteAt = (x: number, y: number): Note | null => {
		const active = getActive();
		const { stepWidth, keyHeight, keyCount, pitchRangeStart } = renderConfig;
		const offset = getDrawOffset();
		for (const note of active.core.getNotes()) {
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const logicalY = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const renderX = logicalX - offset.x;
			const renderY = logicalY - offset.y;
			if (
				x >= renderX &&
				x <= renderX + w &&
				y >= renderY &&
				y <= renderY + keyHeight
			)
				return note;
		}
		return null;
	};

	const hasNoteAt = (
		step: number,
		pitch: number,
		excludeId: number,
	): boolean => {
		const active = getActive();
		return active.core
			.getNotes()
			.some(
				(n) =>
					n.id !== excludeId &&
					n.pitch === pitch &&
					step >= n.startStep &&
					step < n.startStep + n.durationSteps,
			);
	};

	const snapToGrid = (duration: number): number =>
		Math.max(
			Math.round(duration / snapGridSteps) * snapGridSteps,
			snapGridSteps,
		);

	const onGridPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		options.onResumeAudio?.();
		const { x, y, step, pitch } = getGridPosition(event);
		const active = getActive();

		if (activeToolMode === "eraser") {
			const note = findActiveNoteAt(x, y);
			if (note) active.core.deleteNoteById(note.id);
			return;
		}

		if (activeToolMode === "select") {
			if (selectedNotes.length > 0) {
				const clicked = findActiveNoteAt(x, y);
				if (clicked && selectedNotes.some((n) => n.id === clicked.id)) {
					selectedOriginal = selectedNotes.map((n) => ({
						id: n.id,
						startStep: n.startStep,
						pitch: n.pitch,
					}));
					isSelecting = true;
					dragMode = "move";
					selectionStart = { x, y, step, pitch };
					hasDragged = false;
					lastMultiPreviewPitch = null;
					return;
				}
				selectedNotes = [];
				selectionRect = null;
			}
			const clicked = findActiveNoteAt(x, y);
			if (clicked) {
				selectedNotes = [clicked];
				selectedOriginal = [
					{
						id: clicked.id,
						startStep: clicked.startStep,
						pitch: clicked.pitch,
					},
				];
				isSelecting = true;
				dragMode = "move";
			} else {
				selectedNotes = [];
				selectionRect = null;
				isSelecting = true;
				dragMode = "rect";
			}
			selectionStart = { x, y, step, pitch };
			hasDragged = false;
			return;
		}

		// pen
		hasDragged = false;
		const epsilon = 0.1;
		const existing = active.core
			.getNotes()
			.find(
				(n) =>
					n.pitch === pitch &&
					step >= n.startStep - epsilon &&
					step < n.startStep + n.durationSteps - epsilon,
			);
		if (existing) {
			playPreview(existing.pitch);
			const { stepWidth } = renderConfig;
			const offset = getDrawOffset();
			const renderX = existing.startStep * stepWidth - offset.x;
			const w = existing.durationSteps * stepWidth;
			if (x >= renderX + w - resizeHandleWidth && x <= renderX + w) {
				dragState = {
					noteId: existing.id,
					mode: "resize",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			} else {
				dragState = {
					noteId: existing.id,
					mode: "move",
					dragOffsetStep: step - existing.startStep,
					dragOffsetPitch: pitch - existing.pitch,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			}
			suppressClick = true;
			return;
		}

		const snappedStep =
			Math.floor(step / currentInsertLength) * currentInsertLength;
		const newStart = snappedStep;
		const newEnd = newStart + currentInsertLength;
		const overlapping = active.core
			.getNotes()
			.some(
				(n) =>
					n.pitch === pitch &&
					newStart < n.startStep + n.durationSteps - epsilon &&
					newEnd > n.startStep + epsilon,
			);
		if (!overlapping) {
			active.core.addNote(snappedStep, pitch, {
				noteLengthSteps: currentInsertLength,
			});
			playPreview(pitch);
			const newNote = active.core
				.getNotes()
				.find(
					(n) =>
						Math.abs(n.startStep - snappedStep) < epsilon && n.pitch === pitch,
				);
			if (newNote) {
				dragState = {
					noteId: newNote.id,
					mode: "move",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: newNote.startStep,
					durationSteps: newNote.durationSteps,
					lastPreviewPitch: newNote.pitch,
				};
				hasDragged = true;
			}
			suppressClick = true;
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		const active = getActive();
		if (activeToolMode === "pen") {
			if (!dragState) return;
			const { step, pitch } = getGridPosition(event);
			hasDragged = true;
			if (dragState.mode === "move") {
				const nextStart = step - dragState.dragOffsetStep;
				const snappedStart =
					Math.round(nextStart / snapGridSteps) * snapGridSteps;
				const nextPitch = pitch - dragState.dragOffsetPitch;
				if (hasNoteAt(snappedStart, nextPitch, dragState.noteId)) return;
				active.core.moveNote(dragState.noteId, snappedStart, nextPitch);
				if (nextPitch !== dragState.lastPreviewPitch) {
					dragState.lastPreviewPitch = nextPitch;
					playPreview(nextPitch);
				}
				return;
			}
			const rawDuration = step - dragState.startStep + 1;
			const snapped = snapToGrid(rawDuration);
			active.core.resizeNote(dragState.noteId, snapped);
			dragState.durationSteps = snapped;
			currentInsertLength = snapped;
			redrawAll();
			return;
		}

		if (activeToolMode === "select" && isSelecting && selectionStart) {
			const { x, y, step, pitch } = getGridPosition(event);
			if (dragMode === "rect") {
				const rect = {
					x: Math.min(x, selectionStart.x),
					y: Math.min(y, selectionStart.y),
					width: Math.abs(x - selectionStart.x),
					height: Math.abs(y - selectionStart.y),
				};
				selectionRect = rect;
				const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
					renderConfig;
				const offset = getDrawOffset();
				selectedNotes = active.core.getNotes().filter((note) => {
					const logicalX = note.startStep * stepWidth;
					const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
					const logicalY = yIndex * keyHeight;
					const nx = logicalX - offset.x;
					const ny = logicalY - offset.y;
					const nw = note.durationSteps * stepWidth;
					return (
						rect.x < nx + nw &&
						rect.x + rect.width > nx &&
						rect.y < ny + keyHeight &&
						rect.y + rect.height > ny
					);
				});
				redrawAll();
			} else {
				const rawDeltaStep = step - selectionStart.step;
				const snappedDelta =
					Math.round(rawDeltaStep / snapGridSteps) * snapGridSteps;
				const deltaPitch = pitch - selectionStart.pitch;
				if (snappedDelta !== 0 || deltaPitch !== 0) {
					hasDragged = true;
					if (!active.core.isBatchOperation) active.core.beginBatch();
					for (const note of selectedNotes) {
						const orig = selectedOriginal.find((o) => o.id === note.id);
						if (!orig) continue;
						const newPitch = orig.pitch + deltaPitch;
						if (newPitch >= 0 && newPitch < 128)
							active.core.moveNote(
								note.id,
								orig.startStep + snappedDelta,
								newPitch,
							);
					}
					if (selectedNotes.length > 0) {
						const grab = selectedNotes[0];
						const orig = selectedOriginal.find((o) => o.id === grab.id);
						if (orig) {
							const newGrab = orig.pitch + deltaPitch;
							if (
								newGrab !== lastMultiPreviewPitch &&
								newGrab >= 0 &&
								newGrab < 128
							) {
								lastMultiPreviewPitch = newGrab;
								playPreview(newGrab);
							}
						}
					}
				}
				redrawAll();
			}
		}
	};

	const onPointerUp = (): void => {
		if (activeToolMode === "pen" && dragState) {
			if (hasDragged) {
				const active = getActive();
				if (dragState.mode === "move")
					active.core.moveNoteEnd(dragState.noteId);
				else active.core.resizeNoteEnd(dragState.noteId);
				suppressClick = true;
			}
			dragState = null;
			hasDragged = false;
		}
		if (activeToolMode === "select" && isSelecting) {
			if (hasDragged && dragMode === "move" && selectedNotes.length > 0) {
				getActive().core.endBatch();
			}
			isSelecting = false;
			selectionStart = null;
			hasDragged = false;
			lastMultiPreviewPitch = null;
			selectionRect = null;
			selectedOriginal = [];
			redrawAll();
		}
	};

	// ============================================================
	// Canvas セットアップ（リサイズ時に再構築）
	// ============================================================
	const setupCanvas = (): void => {
		const w = refs.rollContainer.clientWidth || 800;
		const h = refs.rollContainer.clientHeight || 450;
		init(refs.wrapper, w, h, renderConfig);

		const gridCanvas = getGridCanvas();
		gridCanvas.addEventListener("pointerdown", onGridPointerDown);
		gridCanvas.addEventListener("dblclick", (event) => {
			event.preventDefault();
			const { step, pitch } = getGridPosition(event);
			const active = getActive();
			const note = active.core
				.getNotes()
				.find(
					(n) =>
						n.pitch === pitch &&
						step >= n.startStep &&
						step < n.startStep + n.durationSteps,
				);
			if (note) active.core.deleteNoteById(note.id);
		});
		gridCanvas.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				currentOffsetY = clamp(
					currentOffsetY + event.deltaY,
					0,
					getMaxOffsetY(),
				);
				currentOffsetX = Math.max(0, currentOffsetX + event.deltaX);
				setDrawOffset(currentOffsetX, currentOffsetY);
				redrawAll();
			},
			{ passive: false },
		);
		// クリック＝再生開始位置 / ノート追加はpointerdownで処理済
		gridCanvas.addEventListener("click", () => {
			if (suppressClick) {
				suppressClick = false;
			}
		});

		const headerCanvas = getHeaderCanvas();
		headerCanvas.addEventListener("click", (event) => {
			if (playbackState === "playing") return;
			const rect = headerCanvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const step = Math.floor((x + currentOffsetX) / renderConfig.stepWidth);
			playStartStep = Math.max(
				0,
				Math.floor(step / snapGridSteps) * snapGridSteps,
			);
			redrawAll();
		});

		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// ============================================================
	// ズーム
	// ============================================================
	const applyZoomX = (): void => {
		const canvas = getGridCanvas();
		const centerStep =
			(currentOffsetX + canvas.width / 2) / renderConfig.stepWidth;
		renderConfig.stepWidth = (BASE_STEP_WIDTH * (zoomX * 2)) / 100;
		refs.zoomXLabel.textContent = `${zoomX}%`;
		currentOffsetX = Math.max(
			0,
			centerStep * renderConfig.stepWidth - canvas.width / 2,
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};
	const applyZoomY = (): void => {
		const canvas = getGridCanvas();
		const centerKey =
			(currentOffsetY + canvas.height / 2) / renderConfig.keyHeight;
		renderConfig.keyHeight = (BASE_KEY_HEIGHT * zoomY) / 100;
		refs.zoomYLabel.textContent = `${zoomY}%`;
		currentOffsetY = clamp(
			centerKey * renderConfig.keyHeight - canvas.height / 2,
			0,
			getMaxOffsetY(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// ============================================================
	// 発音ディスパッチ（マスタ/ドラム音量を適用してフックへ）
	// ============================================================
	const dispatchNote = (
		trackId: string,
		pitch: number,
		trackVol: number,
		velocity: number,
		when: number,
		duration: number,
	): void => {
		const volume = (trackVol / 100) * (velocity / 127) * (masterVolume / 100);
		options.onPlayNote?.({ trackId, pitch, velocity, volume, when, duration });
	};

	// ============================================================
	// 再生
	// ============================================================
	const sequencer: Sequencer = createSequencer({
		getTracks: () =>
			trackStates.map((t) => ({
				id: t.config.id,
				volume: t.volume,
				notes: t.core.getNotes(),
			})),
		getBpm: () => bpm,
		getPlayStartStep: () => playStartStep,
		getDrumPattern: () => drumPatterns[currentDrumPattern] ?? null,
		getSoloTrackId: () => (isSolo ? activeTrackId : null),
		getAudioTime,
		onPlayNote: (e) => {
			const volume = e.volume * (masterVolume / 100);
			options.onPlayNote?.({ ...e, volume });
		},
		onPlayDrum: (e) => {
			const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
		},
		onTick: (step) => {
			currentPlayStep = step;
			const canvas = getGridCanvas();
			const visibleSteps = canvas.width / renderConfig.stepWidth;
			const threshold =
				currentOffsetX / renderConfig.stepWidth + visibleSteps - 4;
			if (currentPlayStep > threshold) {
				const visibleBars = Math.round(visibleSteps / renderConfig.stepsPerBar);
				currentOffsetX +=
					visibleBars * renderConfig.stepsPerBar * renderConfig.stepWidth;
				setDrawOffset(currentOffsetX, currentOffsetY);
			}
			redrawAll();
		},
		onEnd: () => {
			playbackState = "stopped";
			currentPlayStep = 0;
			updateTransport();
			redrawAll();
		},
		stepsPerBar: renderConfig.stepsPerBar,
	});

	const play = (): void => {
		options.onResumeAudio?.();
		if (playbackState === "playing") return;
		const fromStep =
			playbackState === "paused" ? pausedPlayStep : playStartStep;
		if (playbackState !== "paused") {
			// 再生開始位置までスクロール
			const canvas = getGridCanvas();
			currentOffsetX = Math.max(
				0,
				playStartStep * renderConfig.stepWidth - canvas.width * 0.5,
			);
			setDrawOffset(currentOffsetX, currentOffsetY);
		}
		playbackState = "playing";
		sequencer.start(fromStep);
		updateTransport();
	};
	const pause = (): void => {
		if (playbackState !== "playing") return;
		pausedPlayStep = currentPlayStep;
		sequencer.stop();
		playbackState = "paused";
		updateTransport();
	};
	const stop = (): void => {
		sequencer.stop();
		playbackState = "stopped";
		currentPlayStep = 0;
		updateTransport();
		redrawAll();
	};
	const togglePlay = (): void => {
		if (playbackState === "playing") stop();
		else play();
	};

	// ============================================================
	// UIコントロール
	// ============================================================
	const updateTransport = (): void => {
		const playing = playbackState === "playing";
		const label = playing
			? "停止"
			: playbackState === "paused"
				? "再開"
				: "試聴";
		refs.playBtn.innerHTML = `${icon(playing ? "stop" : "play")}<span>${label}</span>`;
		refs.playBtn.classList.toggle("dtm-play--stop", playing);
	};

	const updateUndoRedo = (): void => {
		const core = getActive().core;
		refs.undoBtn.disabled = !core.canUndo();
		refs.redoBtn.disabled = !core.canRedo();
	};

	const updateTrackPanel = (): void => {
		// トラックピル（色分け・常時表示）
		refs.trackTabs.innerHTML = "";
		for (const t of trackStates) {
			const [r, g, b] = t.config.color;
			const btn = document.createElement("button");
			btn.className = `dtm-pill ${t.config.id === activeTrackId ? "dtm-pill--active" : ""}`;
			btn.style.setProperty("--dtm-pill-color", `rgb(${r},${g},${b})`);
			btn.innerHTML = `<span class="dtm-dot"></span><span>${t.config.name}</span>`;
			btn.addEventListener("click", () => switchTrack(t.config.id));
			refs.trackTabs.appendChild(btn);
		}
		// ボディ
		const active = getActive();
		refs.trackBody.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">velocity</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="track-vol" min="0" max="127" value="${active.volume}">
        <span class="dtm-label" data-dtm="track-vol-label">${active.volume}</span>
      </div>`;
		const volInput = refs.trackBody.querySelector(
			'[data-dtm="track-vol"]',
		) as HTMLInputElement;
		const volLabel = refs.trackBody.querySelector(
			'[data-dtm="track-vol-label"]',
		) as HTMLElement;
		volInput.addEventListener("input", () => {
			active.volume = Number.parseInt(volInput.value, 10);
			active.core.setVolume(active.volume);
			volLabel.textContent = String(active.volume);
		});

		if (active.config.id === "chord" && showChord) {
			const div = document.createElement("div");
			div.className = "dtm-row";
			div.style.flexDirection = "column";
			div.style.alignItems = "stretch";
			const roots = [
				"C",
				"C#",
				"D",
				"D#",
				"E",
				"F",
				"F#",
				"G",
				"G#",
				"A",
				"A#",
				"B",
			];
			div.innerHTML = `
        <div class="dtm-row">
          <span class="dtm-label">和音</span>
          <select class="dtm-select" data-dtm="chord-pattern">
            <option value="block">ブロック</option>
            <option value="arpeggio">アルペジオ</option>
            <option value="arpeggio-fast">アルペジオ（ジャラーン）</option>
            <option value="offbeat">裏打ち</option>
            <option value="yatsume">ヤツメ穴</option>
            <option value="alternating">交互奏</option>
          </select>
          <select class="dtm-select" data-dtm="chord-root">
            ${roots.map((r, i) => `<option value="${i}">${r}</option>`).join("")}
          </select>
          <button class="dtm-btn dtm-btn--primary" data-dtm="chord-apply">適用</button>
        </div>
        <textarea class="dtm-textarea" data-dtm="chord-input" placeholder="例: C|G|Am|Em|F|C|F|G">${active.savedChordInput}</textarea>`;
			refs.trackBody.appendChild(div);
			const patternSel = div.querySelector(
				'[data-dtm="chord-pattern"]',
			) as HTMLSelectElement;
			const rootSel = div.querySelector(
				'[data-dtm="chord-root"]',
			) as HTMLSelectElement;
			const input = div.querySelector(
				'[data-dtm="chord-input"]',
			) as HTMLTextAreaElement;
			patternSel.value = active.savedChordPattern;
			rootSel.value = String(active.savedChordRoot);
			const save = (): void => {
				active.savedChordInput = input.value;
				active.savedChordPattern = patternSel.value as ChordPatternType;
				active.savedChordRoot = Number.parseInt(rootSel.value, 10);
			};
			patternSel.addEventListener("change", save);
			rootSel.addEventListener("change", save);
			input.addEventListener("input", save);
			(
				div.querySelector('[data-dtm="chord-apply"]') as HTMLButtonElement
			).addEventListener("click", () => {
				save();
				applyChord();
			});
		}
	};

	const switchTrack = (id: string): void => {
		activeTrackId = id;
		updateTrackPanel();
		updateUndoRedo();
		redrawAll();
	};

	const setToolMode = (mode: ToolMode): void => {
		activeToolMode = mode;
		for (const [btn, m] of [
			[refs.toolPen, "pen"],
			[refs.toolSelect, "select"],
			[refs.toolEraser, "eraser"],
		] as [HTMLButtonElement, ToolMode][]) {
			btn.classList.toggle("dtm-segbtn--active", m === mode);
		}
		if (mode !== "select") {
			selectionRect = null;
			selectedNotes = [];
		}
		redrawAll();
	};

	// ============================================================
	// MML / MIDI / コード / マクロ
	// ============================================================
	const generateMML = (): { full: string; minified: string } => {
		const full = trackStates
			.map((t, i) => `@${i} ${t.core.getMML(t.volume).trim()}`)
			.join(";\n");
		const minified = trackStates
			.map(
				(t, i) => `@${i}${t.core.getMML(t.volume).trim().replace(/\s+/g, "")}`,
			)
			.join(";");
		return { full, minified };
	};

	const showMML = (): void => {
		const { full, minified } = generateMML();
		refs.outputFull.textContent = full;
		refs.outputMini.textContent = minified;
		refs.outputStatus.textContent = `(${trackStates.length}トラック) 通常: ${full.length}文字 / minify: ${minified.length}文字`;
		refs.outputContainer.classList.remove("dtm-hidden");
		updateUndoRedo();
	};

	const clearAll = (): void => {
		for (const t of trackStates) {
			t.core.resetHistory();
			t.core.clearNotesWithoutHistory();
		}
		redrawAll();
	};

	const loadMML = (mml: string): void => {
		if (!mml) return;
		clearAll();
		for (const t of trackStates) t.core.setLoadMode(true);
		const { placements, bpm: parsedBpm } = parseMML(mml, {
			stepsPerBar: renderConfig.stepsPerBar,
		});
		for (const p of placements) {
			const t = trackStates[p.trackIndex];
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
			});
		}
		if (parsedBpm) setBpm(parsedBpm);
		for (const t of trackStates) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
		updateUndoRedo();
	};

	const applyChord = (): void => {
		if (!options.parseChord || !options.parseChords) return;
		const active = getActive();
		const chordTrack = trackStates.find((t) => t.config.id === "chord");
		if (!chordTrack) return;
		const placements = buildChordPlacements({
			chordStr: active.savedChordInput,
			patternType: active.savedChordPattern,
			rootShift: active.savedChordRoot,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
			parseChord: options.parseChord,
			parseChords: options.parseChords,
		});
		chordTrack.core.clearNotesWithoutHistory();
		chordTrack.core.beginBatch();
		for (const p of placements) {
			chordTrack.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: Math.max(1, p.durationSteps),
				velocity: p.velocity,
			});
		}
		chordTrack.core.endBatch();
		chordTrack.core.addHistoryOnce();
		redrawAll();
	};

	const loadMIDI = (bytes: Uint8Array): void => {
		if (!options.parseMidi) return;
		const midi = options.parseMidi(bytes);
		const analysis = analyzeMidiTracks(midi);
		const selected = analysis.filter((a) => a.selected).map((a) => a.index);
		applyMidiSelection(midi, selected);
	};

	const applyMidiSelection = (
		midi: unknown,
		selectedIndices: number[],
	): void => {
		clearAll();
		for (const t of trackStates) t.core.setLoadMode(true);
		const { placements, bpm: parsedBpm } = extractMidiPlacements(
			midi,
			selectedIndices,
		);
		for (const p of placements) {
			const t = trackStates.find((ts) => ts.config.id === p.trackId);
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
				velocity: p.velocity,
			});
		}
		setBpm(Math.round(parsedBpm));
		for (const t of trackStates) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
		updateUndoRedo();
	};

	const exportMIDI = (): Blob =>
		exportMIDIBlob({
			tracks: trackStates.map((t) => ({
				notes: t.core.getNotes(),
				volume: t.volume,
			})),
			drumPattern: drumPatterns[currentDrumPattern],
			drumVolume,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
		});

	const setBpm = (value: number): void => {
		bpm = value;
		refs.bpmInput.value = String(value);
		for (const t of trackStates) t.core.setTempo(value);
	};

	// ============================================================
	// undo / redo / copy / paste
	// ============================================================
	let lastUndoTime = 0;
	const undo = (): void => {
		const now = Date.now();
		if (now - lastUndoTime < 100) return;
		lastUndoTime = now;
		getActive().core.undo();
		redrawAll();
		updateUndoRedo();
	};
	const redo = (): void => {
		getActive().core.redo();
		redrawAll();
		updateUndoRedo();
	};

	// ============================================================
	// イベント配線
	// ============================================================
	const overlayDuring = (fn: () => void): void => {
		refs.overlay.hidden = false;
		setTimeout(() => {
			fn();
			refs.overlay.hidden = true;
		}, 30);
	};

	const wireEvents = (): void => {
		refs.playBtn.addEventListener("click", togglePlay);
		refs.playBtn.disabled = false;
		refs.recBtn.addEventListener("click", () => options.onToggleRecord?.());
		refs.recBtn.style.display = options.onToggleRecord ? "" : "none";
		refs.soloCheckbox.addEventListener("change", () => {
			isSolo = refs.soloCheckbox.checked;
		});

		refs.toolPen.addEventListener("click", () => setToolMode("pen"));
		refs.toolSelect.addEventListener("click", () => setToolMode("select"));
		refs.toolEraser.addEventListener("click", () => setToolMode("eraser"));
		refs.undoBtn.addEventListener("click", undo);
		refs.redoBtn.addEventListener("click", redo);

		refs.noteLengthSelect.addEventListener("change", () => {
			snapGridSteps = Number.parseInt(refs.noteLengthSelect.value, 10);
			currentInsertLength = snapGridSteps;
			redrawAll();
		});
		refs.bpmInput.addEventListener("input", () => {
			setBpm(Number.parseInt(refs.bpmInput.value, 10) || 120);
		});

		refs.zoomXIn.addEventListener("click", () => {
			zoomX = Math.min(200, zoomX + 25);
			applyZoomX();
		});
		refs.zoomXOut.addEventListener("click", () => {
			zoomX = Math.max(25, zoomX - 25);
			applyZoomX();
		});
		refs.zoomYIn.addEventListener("click", () => {
			zoomY = Math.min(200, zoomY + 25);
			applyZoomY();
		});
		refs.zoomYOut.addEventListener("click", () => {
			zoomY = Math.max(50, zoomY - 25);
			applyZoomY();
		});

		const move = (dir: "home" | "up" | "down" | "left" | "right"): void => {
			const canvas = getGridCanvas();
			const visibleSteps = canvas.width / renderConfig.stepWidth;
			const visibleBars = Math.max(
				1,
				Math.round(visibleSteps / renderConfig.stepsPerBar),
			);
			const hScroll =
				visibleBars * renderConfig.stepsPerBar * renderConfig.stepWidth;
			const vScroll = visibleBars * renderConfig.keyHeight;
			const maxOffsetX =
				getMaxNoteStep() * renderConfig.stepWidth -
				canvas.width +
				leftPaddingSteps * renderConfig.stepWidth;
			if (dir === "home") currentOffsetX = 0;
			if (dir === "right")
				currentOffsetX = clamp(currentOffsetX + hScroll, 0, maxOffsetX);
			if (dir === "left")
				currentOffsetX = clamp(currentOffsetX - hScroll, 0, maxOffsetX);
			if (dir === "up")
				currentOffsetY = clamp(currentOffsetY - vScroll, 0, getMaxOffsetY());
			if (dir === "down")
				currentOffsetY = clamp(currentOffsetY + vScroll, 0, getMaxOffsetY());
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
		refs.navHome.addEventListener("click", () => move("home"));
		refs.navUp.addEventListener("click", () => move("up"));
		refs.navDown.addEventListener("click", () => move("down"));
		refs.navLeft.addEventListener("click", () => move("left"));
		refs.navRight.addEventListener("click", () => move("right"));

		refs.masterVolume.addEventListener("input", () => {
			masterVolume = Number.parseInt(refs.masterVolume.value, 10) || 0;
			refs.masterVolumeLabel.textContent = `${masterVolume}%`;
		});
		refs.drumSelect.addEventListener("change", () => {
			currentDrumPattern = refs.drumSelect.value;
		});
		refs.drumVolume.addEventListener("input", () => {
			drumVolume = Number.parseInt(refs.drumVolume.value, 10) || 0;
			refs.drumVolumeLabel.textContent = `${drumVolume}%`;
		});

		// マクロ
		refs.macroClear.addEventListener("click", () => {
			const active = getActive();
			active.core.beginBatch();
			active.core.clearNotesWithoutHistory();
			active.core.endBatch();
			active.core.saveHistory();
			redrawAll();
		});
		refs.macroRandom.addEventListener("click", () => {
			generateRandomPattern(getActive().core, {
				stepsPerBar: renderConfig.stepsPerBar,
				startStep: playStartStep,
				pitchRangeStart: renderConfig.pitchRangeStart,
			});
			redrawAll();
		});
		refs.macroHarmonic.addEventListener("click", () => {
			const chord = trackStates.find((t) => t.config.id === "chord");
			if (!chord || activeTrackId === "chord") return;
			applyHarmonicFilter(getActive().core, chord.core, {
				stepsPerBar: renderConfig.stepsPerBar,
			});
			redrawAll();
		});
		refs.macroMono.addEventListener("click", () => {
			const chord = trackStates.find((t) => t.config.id === "chord");
			if (!chord || activeTrackId === "chord") return;
			applyMonophonic(getActive().core, chord.core, {
				stepsPerBar: renderConfig.stepsPerBar,
			});
			redrawAll();
		});

		// 出力
		refs.generateMmlBtn.addEventListener("click", showMML);
		refs.exportMidiBtn.addEventListener("click", () => {
			const blob = exportMIDI();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "dtm.mid";
			a.click();
			URL.revokeObjectURL(url);
		});
		const copy = (text: string, btn: HTMLButtonElement): void => {
			navigator.clipboard?.writeText(text);
			btn.classList.add("dtm-btn--success");
			setTimeout(() => btn.classList.remove("dtm-btn--success"), 1200);
		};
		refs.copyFullBtn.addEventListener("click", () =>
			copy(refs.outputFull.textContent ?? "", refs.copyFullBtn),
		);
		refs.copyMiniBtn.addEventListener("click", () =>
			copy(refs.outputMini.textContent ?? "", refs.copyMiniBtn),
		);

		// MML/MIDI入力
		refs.mmlLoadBtn.addEventListener("click", () =>
			overlayDuring(() => loadMML(refs.mmlInput.value)),
		);
		refs.shiftApplyBtn.addEventListener("click", () =>
			overlayDuring(() => {
				shiftNotes(
					trackStates.map((t) => t.core),
					Number.parseInt(refs.shiftSelect.value, 10) || 0,
				);
				redrawAll();
			}),
		);

		if (showMidi) wireMidi();

		// キーボードショートカット
		document.addEventListener("keydown", onKeyDown);

		// 入力欄のキー伝搬抑制
		for (const ta of refs.root.querySelectorAll("textarea, input")) {
			ta.addEventListener("keydown", (e) => {
				const ke = e as KeyboardEvent;
				if (
					(ke.ctrlKey || ke.metaKey) &&
					["KeyZ", "KeyY", "KeyV", "KeyC", "KeyX"].includes(ke.code)
				)
					e.stopPropagation();
			});
		}
	};

	let pendingMidi: unknown = null;
	let detectedTracks: ReturnType<typeof analyzeMidiTracks> = [];
	const wireMidi = (): void => {
		refs.midiInput.addEventListener("change", async () => {
			const file = refs.midiInput.files?.[0];
			if (!file || !options.parseMidi) return;
			refs.overlay.hidden = false;
			const buffer = new Uint8Array(await file.arrayBuffer());
			pendingMidi = options.parseMidi(buffer);
			detectedTracks = analyzeMidiTracks(pendingMidi);
			refs.midiTrackSelection.innerHTML = `<span class="dtm-label">トラック</span>`;
			detectedTracks.forEach((t, i) => {
				const btn = document.createElement("button");
				btn.className = `dtm-btn ${t.selected ? "dtm-btn--primary" : "dtm-btn--ghost"}`;
				btn.dataset.selected = String(t.selected);
				btn.textContent = `${t.name} (${t.noteCount})`;
				btn.addEventListener("click", () => {
					const on = btn.dataset.selected !== "true";
					btn.dataset.selected = String(on);
					btn.classList.toggle("dtm-btn--primary", on);
					btn.classList.toggle("dtm-btn--ghost", !on);
				});
				refs.midiTrackSelection.appendChild(btn);
				if (i === 0) refs.midiTrackSelection.dataset.ready = "1";
			});
			refs.midiTrackSelection.classList.remove("dtm-hidden");
			refs.overlay.hidden = true;
		});
		refs.midiLoadBtn.addEventListener("click", () => {
			if (!pendingMidi) return;
			const selected: number[] = [];
			const btns = refs.midiTrackSelection.querySelectorAll("button");
			btns.forEach((b, i) => {
				if ((b as HTMLElement).dataset.selected === "true")
					selected.push(detectedTracks[i].index);
			});
			if (selected.length === 0) return;
			overlayDuring(() => applyMidiSelection(pendingMidi, selected));
		});
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.code === "KeyZ" && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") {
			e.preventDefault();
			redo();
		} else if (e.code === "KeyC" && selectedNotes.length > 0) {
			e.preventDefault();
			copiedNotes = [...selectedNotes];
		} else if (e.code === "KeyX" && selectedNotes.length > 0) {
			e.preventDefault();
			copiedNotes = [...selectedNotes];
			const core = getActive().core;
			core.beginBatch();
			for (const n of selectedNotes) core.deleteNoteById(n.id);
			core.endBatch();
			selectedNotes = [];
		} else if (e.code === "KeyV" && copiedNotes.length > 0) {
			e.preventDefault();
			const core = getActive().core;
			const notes = core.getNotes();
			const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
			core.beginBatch();
			for (const note of copiedNotes) {
				const newStart = playStartStep + (note.startStep - minStart);
				const newEnd = newStart + note.durationSteps;
				const overlap = notes.some(
					(ex) =>
						ex.pitch === note.pitch &&
						newStart < ex.startStep + ex.durationSteps &&
						newEnd > ex.startStep,
				);
				if (!overlap)
					core.addNote(newStart, note.pitch, {
						noteLengthSteps: note.durationSteps,
						velocity: note.velocity,
					});
			}
			core.endBatch();
			redrawAll();
		}
	};

	// ============================================================
	// 初期化
	// ============================================================
	setupCanvas(); // renderer.init() で g_config を設定
	createTrackStates(); // g_config 設定後に MMLCore を生成
	ready = true;
	initScrollbarDrag();
	wireEvents();
	setBpm(bpm);
	updateTrackPanel();
	updateTransport();
	updateUndoRedo();
	redrawAll();
	if (options.initialMML) loadMML(options.initialMML);

	// リサイズ対応（Canvas再構築）
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	const resizeObserver = new ResizeObserver(() => {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => setupCanvas(), 150);
	});
	resizeObserver.observe(refs.rollContainer);

	// document レベルのリスナ（pointermove/up）
	document.addEventListener("pointermove", onPointerMove);
	document.addEventListener("pointerup", onPointerUp);

	// ============================================================
	// 公開API
	// ============================================================
	return {
		play,
		pause,
		stop,
		getMML: generateMML,
		loadMML,
		loadMIDI,
		exportMIDI,
		setBpm,
		getPlaybackState: () => playbackState,
		destroy: () => {
			sequencer.stop();
			resizeObserver.disconnect();
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
			document.removeEventListener("keydown", onKeyDown);
			target.innerHTML = "";
		},
	};
};
