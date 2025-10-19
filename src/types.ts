// ノートデータ構造
export type Note = {
	id: number;
	startStep: number;
	durationSteps: number;
	pitch: number;
};

// ピアノロールの描画とステップ計算に必要な設定
export type PianoRollConfig = {
	bars: number; // 8固定
	stepsPerBar: number; // 1小節あたりのステップ数 (16固定)
	keyCount: number; // C1〜C5の49鍵
	pitchRangeStart: number; // C1のピッチ番号 (0)
};

// 描画スタイルとサイズ
export type RendererOptions = {
	keyHeight: number; // 1鍵盤あたりのピクセル高さ
	stepWidth: number; // 1ステップあたりのピクセル幅
	// 必要に応じてズームレベルやカラースキームなど
};

// 外部イベント
export type CoreEventHandlers = {
	onMMLGenerated: (mml: string) => void;
	onNotesChanged: (notes: Note[]) => void;
};

// ノート追加時のオプション
export type AddNoteOptions = {
	noteLengthSteps: number;
};
