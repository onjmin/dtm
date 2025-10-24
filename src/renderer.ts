import type { Note, RenderConfig } from "./types";

let g_canvas: HTMLCanvasElement;
let g_ctx: CanvasRenderingContext2D;
let g_config: RenderConfig;

export const getRenderConfig = (): RenderConfig => g_config;

let g_draw_offset_x = 0;
let g_draw_offset_y = 0;

/**
 * Canvasを初期化し、指定されたターゲット要素にマウントします。
 */
export const init = (
	mountTarget: HTMLElement,
	width = 800,
	height = 450,
	config: RenderConfig,
): void => {
	g_config = config;

	const canvas = document.createElement("canvas");
	g_canvas = canvas;
	canvas.width = width;
	canvas.height = height;

	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Failed to get 2D rendering context.");
	g_ctx = ctx;

	mountTarget.innerHTML = "";
	mountTarget.append(canvas);
};

const blackKeyPitches = new Set([1, 3, 6, 8, 10]);

/**
 * グリッドと背景を描画します。
 */
export const drawGrid = (): void => {
	g_ctx.clearRect(0, 0, g_canvas.width, g_canvas.height);

	const { keyHeight, keyCount, stepWidth, stepsPerBar } = g_config;

	// 横線（ピッチ/鍵盤）の描画
	const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
	const endY = g_draw_offset_y + g_canvas.height;

	for (let y = startY; y <= endY; y += keyHeight) {
		const pitchIndex = keyCount - 1 - y / keyHeight;
		const pitchMod12 = pitchIndex % 12;
		const isBlackKey = blackKeyPitches.has(pitchMod12);

		const screenY = y - g_draw_offset_y;

		// 黒鍵の背景の塗りつぶし
		if (isBlackKey) {
			g_ctx.fillStyle = "#F3F4F6";
			g_ctx.fillRect(0, screenY, g_canvas.width, keyHeight);
		}

		// 水平グリッド線の描画
		g_ctx.beginPath();
		g_ctx.strokeStyle = "#E5E7EB";
		g_ctx.lineWidth = 1;

		// 水平線の描画範囲をビューポートに合わせる
		g_ctx.moveTo(0, screenY);
		g_ctx.lineTo(g_canvas.width, screenY);
		g_ctx.stroke();
	}

	// 垂直線 (小節線/拍線) の描画
	const startX = Math.floor(g_draw_offset_x / stepWidth) * stepWidth;
	const endX = g_draw_offset_x + g_canvas.width;

	for (let x = startX; x <= endX; x += stepWidth) {
		const isBarLine = (x / stepWidth) % stepsPerBar === 0;

		const screenX = x - g_draw_offset_x;

		g_ctx.beginPath();
		g_ctx.strokeStyle = isBarLine ? "#A0A0A0" : "#E5E7EB";
		g_ctx.lineWidth = isBarLine ? 2 : 1;

		// 水平線の描画範囲をビューポートに合わせる
		g_ctx.moveTo(screenX, 0);
		g_ctx.lineTo(screenX, g_canvas.height);
		g_ctx.stroke();
	}
};

/**
 * 指定されたノートの配列を描画します。
 */
export const drawNotes = (notes: Note[], color = "#3B82F6"): void => {
	const { keyHeight, stepWidth, keyCount, pitchRangeStart } = g_config;

	for (const note of notes) {
		// ノートの論理座標とサイズを計算
		const logicalX = note.startStep * stepWidth;
		const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
		const logicalY = yIndex * keyHeight;
		const w = note.durationSteps * stepWidth;
		const h = keyHeight;

		// ノートがスクロール領域に合わせて移動するようにする
		const renderX = logicalX - g_draw_offset_x;
		const renderY = logicalY - g_draw_offset_y;

		g_ctx.fillStyle = color;

		// 描画には renderX と renderY を使用
		// 描画を見やすくするため、枠を確保する (x+1, y+1, w-2, h-2) はそのまま維持
		g_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
	}
};

/**
 * カーソルの座標取得
 */
export const getXY = (e: MouseEvent): [number, number, number] => {
	const { clientX, clientY } = e;
	const rect = g_canvas.getBoundingClientRect();
	const x = Math.floor(clientX - rect.left);
	const y = Math.floor(clientY - rect.top);
	return [x, y, e.buttons];
};

/**
 * ユーザーのクリックイベントを抽象化し、グリッド座標をコールバックに渡します。
 * デモJSは、この座標を使って Core.toggleNote() を呼び出します。
 */
export const onClick = (
	callback: (step: number, pitch: number) => void,
): void => {
	g_canvas.addEventListener(
		"click",
		(e) => {
			const [x, y] = getXY(e);

			// 旧 handleClick の座標計算ロジックをここで実行
			const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;

			// グリッド座標の特定
			const step = Math.floor(x / stepWidth);
			const yIndex = Math.floor(y / keyHeight);
			const pitch = keyCount - 1 - yIndex + pitchRangeStart;

			// 範囲チェック
			if (pitch >= pitchRangeStart && pitch < pitchRangeStart + keyCount) {
				// 抽象化されたグリッド座標をデモJS側のコールバックに渡す
				requestAnimationFrame(() => callback(step, pitch));
			}
		},
		{ passive: true },
	);
	g_canvas.addEventListener("contextmenu", (e) => e.preventDefault());
};

/**
 * 描画オフセット（描画開始ピクセル位置）を設定します。
 */
export const setDrawOffset = (x: number, y: number): void => {
	g_draw_offset_x = x;
	g_draw_offset_y = y;
};
