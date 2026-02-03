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

	constructor(handlers: CoreEventHandlers) {
		this.handlers = handlers;
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
			};
			this.notes.push(newNote);
		}

		// ノートをステップ順にソートして、MML生成が正しくなるようにする
		this.notes.sort((a, b) => a.startStep - b.startStep);

		this.generateAndNotify();
	}

	public moveNote(noteId: number, startStep: number, pitch: number): void {
		const note = this.notes.find((target) => target.id === noteId);
		if (!note) return;

		const totalSteps = getRenderConfig().bars * getRenderConfig().stepsPerBar;
		const pitchRangeStart = getRenderConfig().pitchRangeStart;
		const pitchRangeEnd = pitchRangeStart + getRenderConfig().keyCount - 1;

		const clampedPitch = Math.min(Math.max(pitch, pitchRangeStart), pitchRangeEnd);
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

		const totalSteps = getRenderConfig().bars * getRenderConfig().stepsPerBar;
		const maxDuration = Math.max(1, totalSteps - note.startStep);
		const clampedDuration = Math.min(Math.max(durationSteps, 1), maxDuration);

		note.durationSteps = clampedDuration;
		this.notes.sort((a, b) => a.startStep - b.startStep);
		this.generateAndNotify();
	}

	// ============== 状態取得 (外部API) ==============

	public getNotes(): Note[] {
		return this.notes;
	}

	public getMML(): string {
		return this.generateMML();
	}

	// ============== 設定変更 (外部API) ==============

	public setVolume(volume: number): void {
		this.volume = volume;
		this.generateAndNotify();
	}

	// 他の設定メソッド（テンポ、音色など）も同様に実装する...

	// ============== 内部処理 ==============

	private generateAndNotify(): void {
		this.handlers.onNotesChanged([...this.notes]); // 変更されたノートデータを通知
		const mml = this.generateMML();
		this.handlers.onMMLGenerated(mml); // MML文字列を通知
	}

	/**
	 * 現在のノートデータからMML文字列を生成（和音対応済み）
	 */
	private generateMML = (): string => {
		// NOTE: テンポ t120 とインストゥルメント @0 はトラック設定として外で付与されることが多いですが、
		// ここでは以前のトラック設定と統一性を保つため、vコマンド以降のみを返します。
		const baseLength = 16;
		const vol = Math.floor((this.volume * 127) / 100);
		let currentMML = `l${baseLength} v${vol} `; // NOTE: tと@はトラック生成時(MMLPlayer)に付与を想定

		let currentStep = 0;
		const totalSteps = getRenderConfig().bars * getRenderConfig().stepsPerBar;

		// 1. ノートを startStep でグループ化
		const notesByStep = this.notes.reduce(
			(acc, note) => {
				if (!acc[note.startStep]) {
					acc[note.startStep] = [];
				}
				acc[note.startStep].push(note);
				return acc;
			},
			{} as Record<number, Note[]>,
		); // Note: Note は外部からインポートされた型を想定

		// 2. グループ化されたステップを順番に処理
		const sortedSteps = Object.keys(notesByStep)
			.map(Number)
			.sort((a, b) => a - b);

		sortedSteps.forEach((startStep) => {
			const notesAtStep = notesByStep[startStep];

			// A. 休符の処理
			const restSteps = startStep - currentStep;
			if (restSteps > 0) {
				currentMML += this.stepToMMLRest(restSteps, baseLength);
			}

			// B. 同時発音ノートの長さ差分を分解してMMLに変換
			const durations = Array.from(
				new Set(notesAtStep.map((note) => note.durationSteps)),
			).sort((a, b) => a - b);
			let segmentStart = 0;

			durations.forEach((durationStep) => {
				const segmentLength = durationStep - segmentStart;
				if (segmentLength <= 0) {
					return;
				}
				const activeNotes = notesAtStep.filter(
					(note) => note.durationSteps > segmentStart,
				);
				const mmlLength =
					(segmentLength * baseLength) / getRenderConfig().stepsPerBar;
				const noteMMLs = activeNotes.map((note) =>
					this.pitchToMMLNote(note.pitch),
				);

				if (noteMMLs.length === 1) {
					currentMML += `${noteMMLs[0]}${mmlLength} `;
				} else if (noteMMLs.length > 1) {
					// 和音として出力: [o3e o3g o3b]1
					currentMML += `[${noteMMLs.join(" ")}]${mmlLength} `;
				}

				segmentStart = durationStep;
			});

			// D. currentStep の更新 (このグループ内で最も長いノートの終了ステップに進める)
			const longestNote = notesAtStep.reduce((a, b) =>
				a.durationSteps > b.durationSteps ? a : b,
			);
			currentStep = startStep + longestNote.durationSteps;
		});

		// 3. 残りの休符処理
		const remainingSteps = totalSteps - currentStep;
		if (remainingSteps > 0) {
			currentMML += this.stepToMMLRest(remainingSteps, baseLength);
		}

		// トリムしてMMLPlayerに渡せる形式で返す
		return currentMML.trim();
	};

	private stepToMMLRest = (steps: number, baseLength: number): string => {
		const mmlLength = (steps * baseLength) / getRenderConfig().stepsPerBar;
		return `r${mmlLength} `;
	};

	private pitchToMMLNote = (pitch: number): string => {
		// Note: PITCH_MAP は外部で定義されていることを想定
		const octave = Math.floor(pitch / 12) + 1;
		const noteName = PITCH_MAP[pitch % 12];
		return `o${octave}${noteName}`;
	};
}
