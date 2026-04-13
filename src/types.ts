// ノートデータ構造
export type Note = {
	id: number;
	startStep: number;
	durationSteps: number;
	pitch: number;
	velocity?: number; // 0-127, 未設定の場合は100
};

// ピアノロールの描画とステップ計算に必要な設定
export type RenderConfig = {
	stepsPerBar: number;
	keyCount: number;
	pitchRangeStart: number;
	keyHeight: number;
	stepWidth: number;
};

// 外部イベント
export type CoreEventHandlers = {
	onMMLGenerated: (mml: string) => void;
	onNotesChanged: (notes: Note[]) => void;
	onNoteClick?: (step: number, pitch: number, isErasing: boolean) => void;
};

// ノート追加時のオプション
export type AddNoteOptions = {
	noteLengthSteps: number;
	velocity?: number;
};
