import { type MMLCore, PITCH_MAP } from "./mml-core";
import type { Note, PianoRollConfig, RendererOptions } from "./types";

/**
 * Canvas描画とユーザーインタラクションの責務を持つクラス
 * MMLCoreと連携して動作する
 */
export class PianoRollRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private core: MMLCore;
	private config: PianoRollConfig;
	private options: RendererOptions;

	public activeNoteLengthSteps: number = 1; // 16分音符

	constructor(
		canvasElement: HTMLCanvasElement,
		coreInstance: MMLCore,
		initialOptions: RendererOptions,
	) {
		this.canvas = canvasElement;
		const ctx = canvasElement.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			throw new Error("Failed to get 2D rendering context from the canvas.");
		}
		this.ctx = ctx;
		this.core = coreInstance;
		this.config = coreInstance.getConfig();
		this.options = initialOptions;

		this.resizeCanvas();
		this.draw();

		// イベントリスナー
		this.canvas.addEventListener("click", this.handleClick as EventListener);
		// TODO: mousedown, mousemove, mouseup を使ってドラッグ編集を追加
	}

	// ============== 描画関連 (外部API) ==============

	public resizeCanvas = (): void => {
		const { bars, stepsPerBar } = this.config;
		const { stepWidth, keyHeight } = this.options;
		const { keyCount } = this.config;
		this.canvas.width = bars * stepsPerBar * stepWidth;
		this.canvas.height = keyCount * keyHeight;
	};

	public draw = (): void => {
		this.drawGrid();
		this.drawNotes(this.core.getNotes()); // Coreから最新ノートを取得して描画
	};

	// ============== 内部描画ロジック (前回の実装から流用) ==============

	private drawGrid = (): void => {
		// ... (グリッド描画ロジック。configとoptionsを使用) ...
		const { keyCount, pitchRangeStart, bars, stepsPerBar } = this.config;
		const { keyHeight, stepWidth } = this.options;
		const totalSteps = bars * stepsPerBar;
		const width = this.canvas.width;
		const height = this.canvas.height;

		this.ctx.clearRect(0, 0, width, height);

		// 横線（ピッチ/鍵盤）
		for (let i = 0; i < keyCount; i++) {
			const pitch = keyCount - 1 - i + pitchRangeStart;
			const isSharp = PITCH_MAP[pitch % 12].includes("+");
			this.ctx.fillStyle = isSharp ? "#F3F4F6" : "#FFFFFF";
			this.ctx.fillRect(0, i * keyHeight, width, keyHeight);
			this.ctx.strokeStyle = "#D1D5DB";
			this.ctx.strokeRect(0, i * keyHeight, width, keyHeight);
		}

		// 縦線（ステップ/拍）
		for (let s = 0; s <= totalSteps; s++) {
			const isBarLine = s % stepsPerBar === 0;
			const isBeatLine = s % (stepsPerBar / 4) === 0;

			this.ctx.lineWidth = isBarLine ? 1.5 : isBeatLine ? 0.5 : 0.2;
			this.ctx.strokeStyle = isBarLine
				? "#6B7280"
				: isBeatLine
					? "#9CA3AF"
					: "#E5E7EB";

			this.ctx.beginPath();
			this.ctx.moveTo(s * stepWidth, 0);
			this.ctx.lineTo(s * stepWidth, height);
			this.ctx.stroke();
		}
		this.ctx.lineWidth = 1;
	};

	private drawNotes = (notes: Note[]): void => {
		const { keyHeight, stepWidth } = this.options;
		const { keyCount, pitchRangeStart } = this.config;

		notes.forEach((note) => {
			const x = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const y = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const h = keyHeight;

			this.ctx.fillStyle = "#3B82F6"; // ノートカラー
			this.ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
		});
	};

	// ============== イベント処理 ==============

	/**
	 * クリック座標からグリッド位置を特定し、Coreにノート操作を指示
	 */
	private handleClick = (event: MouseEvent): void => {
		const rect = this.canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const { keyCount, pitchRangeStart } = this.config;
		const { keyHeight, stepWidth } = this.options;

		// グリッド座標の特定
		const step = Math.floor(x / stepWidth);
		const yIndex = Math.floor(y / keyHeight);
		const pitch = keyCount - 1 - yIndex + pitchRangeStart;

		if (pitch < pitchRangeStart || pitch >= pitchRangeStart + keyCount) return;

		// Coreに操作を依頼
		this.core.toggleNote(step, pitch, {
			noteLengthSteps: this.activeNoteLengthSteps,
		});

		this.draw(); // Coreの変更を受けて再描画
	};

	// (TODO: 他のイベントハンドラの実装)
}
