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

// 試聴音再生コールバック
export type PreviewSoundCallback = (pitch: number, position: number) => void;

// ノート追加時のオプション
export type AddNoteOptions = {
	noteLengthSteps: number;
	velocity?: number;
};

// ピアノロール作成時のオプション
export type PianoRollOptions = {
	mountTarget: HTMLElement;
	width?: number;
	height?: number;
	config: RenderConfig;
	noteLengthSteps?: number;
	onPreviewSound?: PreviewSoundCallback;
};
