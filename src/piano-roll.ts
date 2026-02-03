import { init, onClick, drawGrid, drawNotes } from "./renderer";
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

	onClick((step, pitch) => {
		core.toggleNote(step, pitch, getAddNoteOptions());
	});

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
