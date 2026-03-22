import { getRenderConfig } from "./renderer";
import type { AddNoteOptions, CoreEventHandlers, Note } from "./types";

export const PITCH_MAP = [
	"c",
	"c+",
	"d",
	"d+",
	"e",
	"f",
	"f+",
	"g",
	"g+",
	"a",
	"a+",
	"b",
];

/**
 * ノートデータ管理とMML生成の責務を持つDOM非依存のコアロジック
 */
export class MMLCore {
	private notes: Note[] = [];
	private nextNoteId: number = 0;
	private handlers: CoreEventHandlers;
	private volume: number = 80;
	private tempo: number = 120;

	constructor(handlers: CoreEventHandlers, volume: number = 80) {
		this.handlers = handlers;
		this.volume = volume;
		// 初期MMLを生成し通知
		this.generateAndNotify();
	}

	// ============== ノート編集 (外部API) ==============

	/**
	 * 指定されたグリッド位置にノートを追加または削除するトグル操作
	 * @param step ステップ位置
	 * @param pitch ピッチ番号
	 * @param options ノート長などの設定
	 */
	public toggleNote(
		step: number,
		pitch: number,
		options: AddNoteOptions,
	): void {
		const existingIndex = this.notes.findIndex(
			(n) => n.startStep === step && n.pitch === pitch,
		);

		if (existingIndex !== -1) {
			this.notes.splice(existingIndex, 1); // 削除
		} else {
			// 追加
			const newNote: Note = {
				id: this.nextNoteId++,
				startStep: step,
				durationSteps: options.noteLengthSteps,
				pitch: pitch,
				velocity: options.velocity ?? 127,
			};
			this.notes.push(newNote);
		}

		// ノートをステップ順にソートして、MML生成が正しくなるようにする
		this.notes.sort((a, b) => a.startStep - b.startStep);

		this.generateAndNotify();
	}

	public deleteNoteById(noteId: number): void {
		const index = this.notes.findIndex((n) => n.id === noteId);
		if (index !== -1) {
			this.notes.splice(index, 1);
			this.generateAndNotify();
		}
	}

	private getMaxStep(): number {
		if (this.notes.length === 0) return 0;
		// 16分音符グリッドにスナップ
		const stepsPer16th = 12;
		const maxRaw = Math.max(
			...this.notes.map((n) => n.startStep + n.durationSteps),
		);
		return Math.ceil(maxRaw / stepsPer16th) * stepsPer16th;
	}

	public moveNote(noteId: number, startStep: number, pitch: number): void {
		const note = this.notes.find((target) => target.id === noteId);
		if (!note) return;

		const totalSteps = this.getMaxStep() + getRenderConfig().stepsPerBar;
		const pitchRangeStart = getRenderConfig().pitchRangeStart;
		const pitchRangeEnd = pitchRangeStart + getRenderConfig().keyCount - 1;

		const clampedPitch = Math.min(
			Math.max(pitch, pitchRangeStart),
			pitchRangeEnd,
		);
		const clampedStart = Math.min(
			Math.max(startStep, 0),
			totalSteps - note.durationSteps,
		);

		note.startStep = clampedStart;
		note.pitch = clampedPitch;
		this.notes.sort((a, b) => a.startStep - b.startStep);
		this.generateAndNotify();
	}

	public resizeNote(noteId: number, durationSteps: number): void {
		const note = this.notes.find((target) => target.id === noteId);
		if (!note) return;

		const clampedDuration = Math.max(1, durationSteps);
		note.durationSteps = clampedDuration;
		this.notes.sort((a, b) => a.startStep - b.startStep);
		this.generateAndNotify();
	}

	// ============== 状態取得 (外部API) ==============

	public getNotes(): Note[] {
		return this.notes;
	}

	public getMML(volumeOverride?: number): string {
		return this.generateMML(volumeOverride);
	}

	// ============== 設定変更 (外部API) ==============

	public setVolume(volume: number): void {
		this.volume = volume;
		this.generateAndNotify();
	}

	public setTempo(tempo: number): void {
		this.tempo = tempo;
		this.generateAndNotify();
	}

	// ============== 内部処理 ==============

	private generateAndNotify(): void {
		this.handlers.onNotesChanged([...this.notes]); // 変更されたノートデータを通知
		const mml = this.generateMML();
		this.handlers.onMMLGenerated(mml); // MML文字列を通知
	}

	/**
	 * ステップ数から最も近いMML音長数値に変換（スナップ処理）
	 */
	private stepsToMMLDuration(steps: number): string {
		const config = getRenderConfig();
		const total = config.stepsPerBar;

		const commonDurations = [1, 2, 4, 8, 16, 32, 64, 96, 3, 6, 12, 24, 48];

		let bestDur = 4;
		let minDiff = Infinity;

		for (const d of commonDurations) {
			const targetSteps = total / d;
			const diff = Math.abs(steps - targetSteps);
			if (diff < minDiff) {
				minDiff = diff;
				bestDur = d;
			}
		}

		return bestDur.toString();
	}

	/**
	 * ギャップに収まる最大の音符を探す（減算アルゴリズム用）
	 */
	private findBestFitDuration(gap: number): { dur: number; steps: number } {
		const config = getRenderConfig();
		const durations = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];

		for (const d of durations) {
			const stepLen = config.stepsPerBar / d;
			if (gap >= stepLen) {
				return { dur: d, steps: stepLen };
			}
		}

		return { dur: 64, steps: config.stepsPerBar / 64 };
	}

	/**
	 * ピッチからオクターブ最適化のある音名を取得
	 */
	private getNoteWithOctave(
		pitch: number,
		lastOctave: number,
	): { text: string; currentOctave: number } {
		const octave = Math.floor(pitch / 12) - 1;
		const name = PITCH_MAP[pitch % 12];

		if (lastOctave === -1 || Math.abs(octave - lastOctave) >= 2) {
			return { text: `o${octave}${name}`, currentOctave: octave };
		}

		if (octave === lastOctave) {
			return { text: name, currentOctave: octave };
		} else if (octave === lastOctave + 1) {
			return { text: `>${name}`, currentOctave: octave };
		} else if (octave === lastOctave - 1) {
			return { text: `<${name}`, currentOctave: octave };
		}

		return { text: `o${octave}${name}`, currentOctave: octave };
	}

	/**
	 * MML生成（1/2小節パターンスキャン方式）
	 */
	private generateMML = (volumeOverride?: number): string => {
		const config = getRenderConfig();
		const vol = Math.floor(((volumeOverride ?? this.volume) * 127) / 100);
		const HALF_BAR = config.stepsPerBar / 2;

		const header = `t${this.tempo} q50 v${vol}`;
		const segments: string[] = [];
		let lastOctave = -1;
		let currentCursor = 0;

		if (this.notes.length === 0) return header;

		const lastNote = this.notes[this.notes.length - 1];
		const endStep = lastNote.startStep + lastNote.durationSteps;
		const totalSteps = Math.ceil(endStep / HALF_BAR) * HALF_BAR;

		for (
			let windowStart = 0;
			windowStart < totalSteps;
			windowStart += HALF_BAR
		) {
			const windowEnd = windowStart + HALF_BAR;

			const windowNotes = this.notes.filter(
				(n) => n.startStep >= windowStart && n.startStep < windowEnd,
			);

			if (windowNotes.length === 0) {
				while (currentCursor < windowEnd) {
					const gap = windowEnd - currentCursor;
					if (gap <= 2) {
						currentCursor = windowEnd;
						break;
					}
					const { dur, steps } = this.findBestFitDuration(gap);
					segments.push(`r${dur}`);
					currentCursor += steps;
				}
				continue;
			}

			const notesByStep = new Map<number, Note[]>();
			windowNotes.forEach((n) => {
				const list = notesByStep.get(n.startStep) || [];
				list.push(n);
				notesByStep.set(n.startStep, list);
			});
			const sortedSteps = Array.from(notesByStep.keys()).sort((a, b) => a - b);

			for (let i = 0; i < sortedSteps.length; i++) {
				const startStep = sortedSteps[i];
				const notes = notesByStep.get(startStep)!;

				while (currentCursor < startStep) {
					const gap = startStep - currentCursor;
					if (gap <= 2) {
						currentCursor = startStep;
						break;
					}
					const { dur, steps } = this.findBestFitDuration(gap);
					segments.push(`r${dur}`);
					currentCursor += steps;
				}

				const nextStart = sortedSteps[i + 1] ?? windowEnd;
				const availableSteps = nextStart - startStep;
				const durStr = this.stepsToMMLDuration(availableSteps);

				if (notes.length > 1) {
					const noteStrs = notes.map((n) => {
						const oct = Math.floor(n.pitch / 12) - 1;
						const name = PITCH_MAP[n.pitch % 12];
						return `o${oct}${name}`;
					});
					segments.push(`[${noteStrs.join("")}]${durStr}`);
					lastOctave = -1;
				} else {
					const { text, currentOctave } = this.getNoteWithOctave(
						notes[0].pitch,
						lastOctave,
					);
					segments.push(`${text}${durStr}`);
					lastOctave = currentOctave;
				}

				const actualStep = config.stepsPerBar / parseInt(durStr);
				currentCursor = startStep + actualStep;
			}

			while (currentCursor < windowEnd) {
				const gap = windowEnd - currentCursor;
				if (gap <= 2) {
					currentCursor = windowEnd;
					break;
				}
				const { dur, steps } = this.findBestFitDuration(gap);
				segments.push(`r${dur}`);
				currentCursor += steps;
			}
		}

		return `${header} ${segments.join(" ")}`;
	};
}
