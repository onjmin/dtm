import {
	init,
	onClick,
	drawGrid,
	drawNotes,
	getGridCanvas,
	getGridPosition,
	getRenderConfig,
	getDrawOffset,
	setDrawOffset,
} from "./renderer";
import { MMLCore } from "./mml-core";
import type { AddNoteOptions, CoreEventHandlers, Note, RenderConfig } from "./types";

export type PianoRollOptions = {
	mountTarget: HTMLElement;
	width?: number;
	height?: number;
	config: RenderConfig;
	noteLengthSteps?: number;
};

export type PianoRollInstance = {
	core: MMLCore;
	getNotes: () => Note[];
	getMML: () => string;
	setVolume: (volume: number) => void;
	setNoteLengthSteps: (steps: number) => void;
	redraw: () => void;
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
	const core = new MMLCore({
		onMMLGenerated: handlers.onMMLGenerated,
		onNotesChanged: (notes) => {
			handlers.onNotesChanged(notes);
			drawGrid();
			drawNotes(notes);
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
		core.toggleNote(step, pitch, getAddNoteOptions());
	});

	const gridCanvas = getGridCanvas();
	const resizeHandleWidth = 6;
	let dragState:
		| null
		| {
				noteId: number;
				mode: "move" | "resize";
				dragOffsetStep: number;
				dragOffsetPitch: number;
				startStep: number;
		  } = null;
	let hasDragged = false;

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

			if (x >= renderX && x <= renderX + w && y >= renderY && y <= renderY + h) {
				return note;
			}
		}

		return null;
	};

	const handlePointerMove = (e: MouseEvent) => {
		if (!dragState) return;
		hasDragged = true;
		const { step, pitch } = getGridPosition(e);

		if (dragState.mode === "move") {
			const nextStart = step - dragState.dragOffsetStep;
			const nextPitch = pitch - dragState.dragOffsetPitch;
			core.moveNote(dragState.noteId, nextStart, nextPitch);
			return;
		}

		const nextDuration = step - dragState.startStep + 1;
		core.resizeNote(dragState.noteId, nextDuration);
	};

	const endDrag = () => {
		if (dragState) {
			dragState = null;
			if (hasDragged) {
				suppressClick = true;
			}
		}
		hasDragged = false;
	};

	gridCanvas.addEventListener("mousedown", (e) => {
		const { x, y, step, pitch } = getGridPosition(e);
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

	gridCanvas.addEventListener("mouseleave", endDrag);
	document.addEventListener("mouseup", endDrag);
	document.addEventListener("mousemove", handlePointerMove);

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
	};
};
