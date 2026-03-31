import { LinkedList } from "./linked-list";
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
	private history: LinkedList<Note[]> = new LinkedList();
	private isUndoRedo: boolean = false;
	private isBatchOperation: boolean = false;
	private lastHistorySnapshot: string = "[]";
	private lastUndoTime: number = 0;
	private static readonly UNDO_DEBOUNCE_MS = 100;
	private toolMode: "pen" | "select" | "eraser" = "pen";

	constructor(handlers: CoreEventHandlers, volume: number = 80) {
		this.handlers = handlers;
		this.volume = volume;
		this.lastHistorySnapshot = JSON.stringify(this.notes);
		this.history.add([]);
		this.generateAndNotify();
	}

	public beginBatch(): void {
		this.isBatchOperation = true;
	}

	public endBatch(): void {
		this.isBatchOperation = false;
		this.saveHistory();
	}

	private saveHistory(): void {
		if (this.isUndoRedo || this.isBatchOperation) {
			return;
		}
		const snapshot = JSON.stringify(this.notes);
		if (snapshot === this.lastHistorySnapshot) {
			console.log("saveHistory: skipped (no change)");
			return;
		}
		this.lastHistorySnapshot = snapshot;
		this.history.add(JSON.parse(snapshot));
		console.log("saveHistory: saved");
	}

	private restoreHistory(notes: Note[] | null): boolean {
		if (notes === null) return false;
		console.log("restoreHistory: BEFORE - notes =", this.notes.length);
		this.isUndoRedo = true;
		this.notes = JSON.parse(JSON.stringify(notes));
		this.nextNoteId =
			this.notes.length > 0 ? Math.max(...this.notes.map((n) => n.id)) + 1 : 0;
		this.lastHistorySnapshot = JSON.stringify(this.notes);
		console.log(
			"restoreHistory: AFTER set - notes =",
			this.notes.length,
			"lastSnapshot =",
			this.lastHistorySnapshot,
		);
		this.generateAndNotify();
		console.log(
			"restoreHistory: AFTER generateAndNotify - notes =",
			this.notes.length,
		);
		this.isUndoRedo = false;
		return true;
	}

	public undo(): boolean {
		const now = Date.now();
		if (now - this.lastUndoTime < MMLCore.UNDO_DEBOUNCE_MS) {
			return false;
		}
		this.lastUndoTime = now;
		return this.restoreHistory(this.history.undo());
	}

	public redo(): boolean {
		const now = Date.now();
		if (now - this.lastUndoTime < MMLCore.UNDO_DEBOUNCE_MS) {
			return false;
		}
		this.lastUndoTime = now;
		return this.restoreHistory(this.history.redo());
	}

	public canUndo(): boolean {
		return this.history.canUndo();
	}

	public canRedo(): boolean {
		return this.history.canRedo();
	}

	public setToolMode(mode: "pen" | "select" | "eraser"): void {
		this.toolMode = mode;
	}

	public getToolMode(): "pen" | "select" | "eraser" {
		return this.toolMode;
	}

	public resetHistory(): void {
		this.history = new LinkedList();
		this.history.add([]);
		this.lastHistorySnapshot = JSON.stringify(this.notes);
	}

	public addHistoryOnce(): void {
		this.lastHistorySnapshot = "[]";
		this.saveHistory();
	}

	public clearNotesWithoutHistory(): void {
		this.notes = [];
		this.nextNoteId = 0;
		this.lastHistorySnapshot = "[]";
	}

	public setLoadMode(mode: boolean): void {
		this.isUndoRedo = mode;
	}

	// ============== ノート編集 (外部API) ==============

	/**
	 * 指定されたグリッド位置にノートを追加する操作
	 * @param step ステップ位置
	 * @param pitch ピッチ番号
	 * @param options ノート長などの設定
	 */
	public addNote(step: number, pitch: number, options: AddNoteOptions): void {
		const existingIndex = this.notes.findIndex(
			(n) => n.startStep === step && n.pitch === pitch,
		);

		if (existingIndex === -1) {
			const newNote: Note = {
				id: this.nextNoteId++,
				startStep: step,
				durationSteps: options.noteLengthSteps,
				pitch: pitch,
				velocity: options.velocity ?? 127,
			};
			this.notes.push(newNote);
		}

		this.notes.sort((a, b) => a.startStep - b.startStep);

		this.saveHistory();
		this.generateAndNotify();
	}

	public deleteNoteById(noteId: number): void {
		const index = this.notes.findIndex((n) => n.id === noteId);
		if (index !== -1) {
			this.notes.splice(index, 1);
			this.saveHistory();
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

		this.saveHistory();
		this.generateAndNotify();
	}

	public resizeNote(noteId: number, durationSteps: number): void {
		const note = this.notes.find((target) => target.id === noteId);
		if (!note) return;

		const clampedDuration = Math.max(1, durationSteps);
		note.durationSteps = clampedDuration;
		this.notes.sort((a, b) => a.startStep - b.startStep);

		this.saveHistory();
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
	 * 近似値を許容して単一音符を決定する。
	 * ただし、残りステップ(limit)は絶対に超えない。
	 */
	private stepsToMMLDuration(steps: number, limit: number): string {
		const config = getRenderConfig();
		const total = config.stepsPerBar;

		const candidates = [
			{ dur: "1", s: total / 1 },
			{ dur: "2.", s: (total / 2) * 1.5 },
			{ dur: "2", s: total / 2 },
			{ dur: "4.", s: (total / 4) * 1.5 },
			{ dur: "4", s: total / 4 },
			{ dur: "8.", s: (total / 8) * 1.5 },
			{ dur: "8", s: total / 8 },
			{ dur: "12", s: total / 12 },
			{ dur: "16.", s: (total / 16) * 1.5 },
			{ dur: "16", s: total / 16 },
			{ dur: "24", s: total / 24 }, // 3連8分 (24step)
			{ dur: "32", s: total / 32 },
			{ dur: "64", s: total / 64 },
		];

		let bestDur = "64";
		let minDiff = Infinity;

		for (const cand of candidates) {
			// 絶対条件: 小節の残り/次の音符までの距離(limit)を超えない
			if (cand.s > limit) continue;

			// 本来のステップ数(steps)との差分を計算
			const diff = Math.abs(steps - cand.s);
			if (diff < minDiff) {
				minDiff = diff;
				bestDur = cand.dur;
			}
		}

		return bestDur;
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
		const vol = volumeOverride ?? this.volume;
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

				// --- generateMML メソッド内のループ部分 ---

				const nextStart = sortedSteps[i + 1] ?? windowEnd;
				const physicsLimit = nextStart - currentCursor; // 物理的に空いている隙間

				// 【追加】最小音符（64分音符）のステップ数
				const MIN_STEP = config.stepsPerBar / 64;

				// ガード句: もし空き容量が最小単位未満なら、このノートを無視（スキップ）する
				if (physicsLimit < MIN_STEP) {
					console.warn(`Note skipped: No space available at step ${startStep}`);
					// カーソルは進めず、次のノートの処理へ（物理的な位置に合わせるため）
					currentCursor = startStep;
					continue;
				}

				// 理想の長さ(notes[0].durationSteps)と、物理的な限界(physicsLimit)を比較
				const idealDuration = notes[0].durationSteps;
				const durStr = this.stepsToMMLDuration(idealDuration, physicsLimit);

				// 実際にMMLとして出力した音符のステップ数
				const actualStepGenerated = this.getStepFromDottedMML(durStr);

				// MML文字列の組み立て
				if (notes.length > 1) {
					const noteStrs = notes.map((n) => {
						const oct = Math.floor(n.pitch / 12) - 1;
						const name = PITCH_MAP[n.pitch % 12];
						return `o${oct}${name}`;
					});
					segments.push(`[${noteStrs.join("")}]${durStr}`);
				} else {
					const { text, currentOctave } = this.getNoteWithOctave(
						notes[0].pitch,
						lastOctave,
					);
					segments.push(`${text}${durStr}`);
					lastOctave = currentOctave;
				}

				// 次の処理のために、実際に出力した分だけカーソルを進める
				currentCursor += actualStepGenerated;
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

	/**
	 * MMLの音長文字列（"4", "4.", "12"など）をステップ数に変換する
	 */
	private getStepFromDottedMML(durStr: string): number {
		const config = getRenderConfig();
		const total = config.stepsPerBar; // 1小節の全ステップ数（例: 192）

		// 付点があるかチェック
		const isDotted = durStr.endsWith(".");
		// 数値部分だけ取り出す（"4." -> 4, "8" -> 8）
		const baseDur = parseInt(isDotted ? durStr.slice(0, -1) : durStr);

		// 基本のステップ数（例: 4分音符なら 192 / 4 = 48）
		const baseStep = total / baseDur;

		// 付点なら1.5倍、そうでなければそのまま返す
		return isDotted ? baseStep * 1.5 : baseStep;
	}
}
