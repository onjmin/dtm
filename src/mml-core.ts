import type {
	AddNoteOptions,
	CoreEventHandlers,
	Note,
	PianoRollConfig,
} from "./types";

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
	private config: PianoRollConfig;
	private handlers: CoreEventHandlers;
	private volume: number = 80;

	constructor(handlers: CoreEventHandlers, initialConfig: PianoRollConfig) {
		this.handlers = handlers;
		this.config = initialConfig;
		// 初期MMLを生成し通知
		this.generateAndNotify();
	}

	public getConfig(): PianoRollConfig {
		return this.config;
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

	// 他の編集メソッド（ドラッグ移動、長さ変更など）も同様に実装する...

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
		const totalSteps = this.config.bars * this.config.stepsPerBar;

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

			// B. ノートのMML文字列を生成
			const noteMMLs = notesAtStep.map((note) =>
				// stepToMMLNoteContent は、'o3c4' のような音符の内容のみを返します。
				this.stepToMMLNoteContent(note.pitch, note.durationSteps, baseLength),
			);

			// C. 和音として出力: [o3e1o3g1o3b1]
			currentMML += `[${noteMMLs.join("")}] `;

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
		const mmlLength = (steps * baseLength) / this.config.stepsPerBar;
		return `r${mmlLength} `;
	};

	private stepToMMLNoteContent = (
		pitch: number,
		steps: number,
		baseLength: number,
	): string => {
		// Note: PITCH_MAP は外部で定義されていることを想定
		const octave = Math.floor(pitch / 12) + 1;
		const noteName = PITCH_MAP[pitch % 12];

		// MMLの音長計算
		// 例: steps=1 (16分音符), baseLength=16, stepsPerBar=16 なら、mmlLength=1
		const mmlLength = (steps * baseLength) / this.config.stepsPerBar;

		return `o${octave}${noteName}${mmlLength}`;
	};
}
