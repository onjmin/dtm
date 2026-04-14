import { MMLCore } from "./mml-core";
import {
	drawGrid,
	drawNotes,
	drawSelectedNotes,
	drawSelectionRect,
	getDrawOffset,
	getGridCanvas,
	getGridPosition,
	getRenderConfig,
	init,
	onClick,
	setDrawOffset,
} from "./renderer";
import type {
	AddNoteOptions,
	CoreEventHandlers,
	Note,
	PianoRollOptions,
} from "./types";

export type ToolMode = "pen" | "select" | "eraser";

export type PianoRollInstance = {
	core: MMLCore;
	getNotes: () => Note[];
	getMML: () => string;
	setVolume: (volume: number) => void;
	setNoteLengthSteps: (steps: number) => void;
	redraw: () => void;
	setToolMode: (mode: ToolMode) => void;
	getToolMode: () => ToolMode;
	getSelectionRect: () => {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	getNotesInRect: (rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) => Note[];
	clearSelection: () => void;
	copySelection: () => Note[];
	pasteNotes: (notes: Note[], startStep: number) => void;
};

export const createPianoRoll = (
	options: PianoRollOptions,
	handlers: CoreEventHandlers,
): PianoRollInstance => {
	const {
		mountTarget,
		width = 800,
		height = 450,
		config,
		noteLengthSteps = 1,
	} = options;

	init(mountTarget, width, height, config);

	let currentNoteLengthSteps = noteLengthSteps;
	let selectionRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;
	let isSelecting = false;
	let selectionStart: {
		x: number;
		y: number;
		step: number;
		pitch: number;
	} | null = null;
	let selectedNotes: Note[] = [];
	let copiedNotes: Note[] = [];

	const core = new MMLCore({
		onMMLGenerated: handlers.onMMLGenerated,
		onNotesChanged: (notes) => {
			handlers.onNotesChanged(notes);
		},
	});

	const getAddNoteOptions = (): AddNoteOptions => ({
		noteLengthSteps: currentNoteLengthSteps,
	});

	let suppressClick = false;
	onClick((step, pitch) => {
		if (suppressClick) {
			suppressClick = false;
			return;
		}

		const mode = core.getToolMode();
		if (mode === "pen") {
			core.addNote(step, pitch, getAddNoteOptions());
			handlers.onNoteClick?.(step, pitch, false);
		} else if (mode === "eraser") {
			const notes = core.getNotes();
			const note = notes.find(
				(n) =>
					n.startStep <= step &&
					step < n.startStep + n.durationSteps &&
					n.pitch === pitch,
			);
			if (note) {
				core.deleteNoteById(note.id);
				handlers.onNoteClick?.(step, pitch, true);
			}
		}
	});

	const gridCanvas = getGridCanvas();
	const resizeHandleWidth = 6;
	let dragState: null | {
		noteId: number;
		mode: "move" | "resize";
		dragOffsetStep: number;
		dragOffsetPitch: number;
		startStep: number;
		selectedNotes?: Note[]; // 複数ドラッグ時の選択ノート
	} = null;
	let hasDragged = false;
	let lastPreviewPitch: number | null = null; // 前回再生した試聴音のピッチ

	const findNoteAtPosition = (x: number, y: number): Note | null => {
		const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
			getRenderConfig();
		const offset = getDrawOffset();

		for (const note of core.getNotes()) {
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const logicalY = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const h = keyHeight;
			const renderX = logicalX - offset.x;
			const renderY = logicalY - offset.y;

			if (
				x >= renderX &&
				x <= renderX + w &&
				y >= renderY &&
				y <= renderY + h
			) {
				return note;
			}
		}

		return null;
	};

	const handlePointerMove = (e: MouseEvent | PointerEvent) => {
		if (core.getToolMode() === "select" && isSelecting && selectionStart) {
			const { x, y } = getGridPosition(e);
			const minX = Math.min(x, selectionStart.x);
			const minY = Math.min(y, selectionStart.y);
			const width = Math.abs(x - selectionStart.x);
			const height = Math.abs(y - selectionStart.y);
			selectionRect = { x: minX, y: minY, width, height };
			selectedNotes = getNotesInRect(selectionRect);
			redraw();
			return;
		}

		if (!dragState) return;
		hasDragged = true;
		const { step, pitch } = getGridPosition(e);

		if (dragState.mode === "move") {
			// 複数ノートのドラッグ移動
			if (dragState.selectedNotes && dragState.selectedNotes.length > 0) {
				// ドラッグ開始時の基準ノート（dragState.noteId）を取得
				const noteId = dragState.noteId;
				const baseNote = dragState.selectedNotes.find((n) => n.id === noteId);
				if (!baseNote) return;

				// 基準ノートの新しい位置を計算
				const nextStart = step - dragState.dragOffsetStep;
				const nextPitch = pitch - dragState.dragOffsetPitch;

				// 基準ノートからの相対的な移動量
				const stepDelta = nextStart - baseNote.startStep;
				const pitchDelta = nextPitch - baseNote.pitch;

				// 全選択ノートを同じ量だけ移動
				for (const note of dragState.selectedNotes) {
					const newStart = note.startStep + stepDelta;
					const newPitch = note.pitch + pitchDelta;
					core.moveNote(note.id, newStart, newPitch);
				}

				// 試聴音再生（ドラッグ中のピッチを再生）
				if (options.onPreviewSound && pitch !== lastPreviewPitch) {
					lastPreviewPitch = pitch;
					options.onPreviewSound(pitch, step);
				}

				redraw();
				return;
			}

			const nextStart = step - dragState.dragOffsetStep;
			const nextPitch = pitch - dragState.dragOffsetPitch;
			core.moveNote(dragState.noteId, nextStart, nextPitch);
			return;
		}

		const nextDuration = step - dragState.startStep + 1;
		core.resizeNote(dragState.noteId, nextDuration);
	};

	const endDrag = () => {
		const wasSelectMode = core.getToolMode() === "select";

		if (wasSelectMode) {
			isSelecting = false;
			selectionStart = null;
		}

		if (dragState) {
			dragState = null;
			if (hasDragged) {
				suppressClick = true;
			}
		}

		hasDragged = false;

		// selectモード時は必ず枠をクリアして再描画
		if (wasSelectMode) {
			selectionRect = null;
			redraw();
		}
	};

	gridCanvas.addEventListener("pointerdown", (e) => {
		const { x, y, step, pitch } = getGridPosition(e);
		const currentMode = core.getToolMode();

		if (currentMode === "select") {
			const clickedNote = findNoteAtPosition(x, y);

			// 既に選択範囲がある場合、クリックしたノートが選択範囲内かチェック
			if (selectionRect && clickedNote) {
				const notesInRect = getNotesInRect(selectionRect);
				if (notesInRect.some((n) => n.id === clickedNote.id)) {
					// 選択中のノートをドラッグ開始
					dragState = {
						noteId: clickedNote.id,
						mode: "move",
						dragOffsetStep: step - clickedNote.startStep,
						dragOffsetPitch: pitch - clickedNote.pitch,
						startStep: clickedNote.startStep,
						selectedNotes: notesInRect, // 複数選択ノートを保存
					};
					isSelecting = false;
					selectionStart = null;
					return;
				}
			}

			// 新しい範囲選択開始
			selectedNotes = [];
			selectionRect = null;
			isSelecting = true;
			selectionStart = { x, y, step, pitch };
			return;
		}

		const note = findNoteAtPosition(x, y);
		if (!note) return;

		const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
			getRenderConfig();
		const offset = getDrawOffset();
		const logicalX = note.startStep * stepWidth;
		const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
		const logicalY = yIndex * keyHeight;
		const renderX = logicalX - offset.x;
		const renderY = logicalY - offset.y;
		const w = note.durationSteps * stepWidth;

		if (
			x >= renderX + w - resizeHandleWidth &&
			x <= renderX + w &&
			y >= renderY &&
			y <= renderY + keyHeight
		) {
			dragState = {
				noteId: note.id,
				mode: "resize",
				dragOffsetStep: 0,
				dragOffsetPitch: 0,
				startStep: note.startStep,
			};
			return;
		}

		dragState = {
			noteId: note.id,
			mode: "move",
			dragOffsetStep: step - note.startStep,
			dragOffsetPitch: pitch - note.pitch,
			startStep: note.startStep,
		};
	});

	gridCanvas.addEventListener("pointerleave", endDrag);
	document.addEventListener("pointerup", endDrag);
	document.addEventListener("pointermove", handlePointerMove);

	gridCanvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const configValues = getRenderConfig();
			const gridHeight = gridCanvas.height;
			const maxOffsetY = Math.max(
				0,
				configValues.keyCount * configValues.keyHeight - gridHeight,
			);
			const currentOffset = getDrawOffset();
			const nextOffsetY = Math.min(
				Math.max(currentOffset.y + e.deltaY, 0),
				maxOffsetY,
			);
			setDrawOffset(currentOffset.x, nextOffsetY);
			drawGrid();
			drawNotes(core.getNotes());
		},
		{ passive: false },
	);

	const redraw = () => {
		drawGrid();
		drawNotes(core.getNotes());
		if (core.getToolMode() === "select") {
			drawSelectionRect(selectionRect);
			if (selectedNotes.length > 0) {
				const selectedIds = new Set(selectedNotes.map((n) => n.id));
				drawSelectedNotes(core.getNotes(), selectedIds);
			}
		}
	};

	const getNotesInRect = (rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): Note[] => {
		const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
			getRenderConfig();
		const offset = getDrawOffset();
		const notes: Note[] = [];

		for (const note of core.getNotes()) {
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const logicalY = yIndex * keyHeight;
			const noteRect = {
				x: logicalX - offset.x,
				y: logicalY - offset.y,
				width: note.durationSteps * stepWidth,
				height: keyHeight,
			};

			if (
				rect.x < noteRect.x + noteRect.width &&
				rect.x + rect.width > noteRect.x &&
				rect.y < noteRect.y + noteRect.height &&
				rect.y + rect.height > noteRect.y
			) {
				notes.push(note);
			}
		}
		return notes;
	};

	redraw();

	return {
		core,
		getNotes: () => core.getNotes(),
		getMML: () => core.getMML(),
		setVolume: (volume: number) => core.setVolume(volume),
		setNoteLengthSteps: (steps: number) => {
			currentNoteLengthSteps = steps;
		},
		redraw,
		setToolMode: (mode: ToolMode) => {
			core.setToolMode(mode);
			if (mode !== "select") {
				selectionRect = null;
				selectedNotes = [];
			}
		},
		getToolMode: () => core.getToolMode(),
		getSelectionRect: () => selectionRect,
		getNotesInRect,
		clearSelection: () => {
			selectionRect = null;
			selectedNotes = [];
		},
		copySelection: () => {
			copiedNotes = [...selectedNotes];
			return copiedNotes;
		},
		pasteNotes: (_: Note[], startStep: number) => {
			if (copiedNotes.length === 0) return;
			const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
			copiedNotes.forEach((note) => {
				const newStep = startStep + (note.startStep - minStart);
				core.addNote(newStep, note.pitch, {
					noteLengthSteps: note.durationSteps,
					velocity: note.velocity,
				});
			});
		},
	};
};
