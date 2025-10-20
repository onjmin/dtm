import { PITCH_MAP } from "./mml-core";
import type { Note, PianoRollConfig, RendererOptions } from "./types";

// ------------------------------------
// 0. モジュール内部の状態管理
// ------------------------------------
let g_main_canvas: HTMLCanvasElement | null = null;
let g_ctx: CanvasRenderingContext2D | null = null;
let g_config: PianoRollConfig | null = null;
let g_options: RendererOptions | null = null;

// イベント処理用の座標取得に使用
let g_width: number = 0;
let g_height: number = 0;

// ------------------------------------
// 1. 初期化とCanvas管理
// ------------------------------------

/**
 * Canvasを初期化し、指定されたターゲット要素にマウントします。
 */
export const init = (
	mountTarget: HTMLElement,
	initialConfig: PianoRollConfig,
	initialOptions: RendererOptions,
	width: number = 800,
	height: number = 450,
): void => {
	// 状態を保存
	g_config = initialConfig;
	g_options = initialOptions;
	g_width = width;
	g_height = height;

	// Canvasの生成
	const canvas = document.createElement("canvas");
	g_main_canvas = canvas;

	// Renderer.resizeCanvas() のロジックをここに適用
	// 描画バッファサイズ（ここではCSSサイズと一致させる）
	canvas.width = width;
	canvas.height = height;

	// CSSサイズ (以前の課題解決のため)
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;

	// CSSクラスの設定
	canvas.className = "absolute top-0 left-0 transition-opacity duration-300";
	canvas.id = "main-piano-roll-canvas";

	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) {
		throw new Error("Failed to get 2D rendering context.");
	}
	g_ctx = ctx;

	// DOMに追加
	mountTarget.innerHTML = "";
	mountTarget.append(canvas);
};

// ------------------------------------
// 2. 描画ロジック (旧 Renderer.drawGrid / drawNotes)
// ------------------------------------

/**
 * グリッドと背景を描画します。
 */
export const drawGrid = (
	config: PianoRollConfig = g_config!,
	options: RendererOptions = g_options!,
): void => {
	if (!g_ctx || !g_main_canvas) return;

	// 旧 drawGrid のロジックを関数として実装
	const { keyCount, pitchRangeStart, bars, stepsPerBar } = config;
	const { keyHeight, stepWidth } = options;
	const totalSteps = bars * stepsPerBar;
	const width = g_width;
	const height = g_height;

	g_ctx.clearRect(0, 0, width, height);

	// 横線（ピッチ/鍵盤）
	for (let i = 0; i < keyCount; i++) {
		const pitch = keyCount - 1 - i + pitchRangeStart;
		const isSharp = PITCH_MAP[pitch % 12].includes("+");

		g_ctx.fillStyle = isSharp ? "#F3F4F6" : "#FFFFFF";
		g_ctx.fillRect(0, i * keyHeight, width, keyHeight);

		g_ctx.strokeStyle = "#D1D5DB";
		g_ctx.strokeRect(0, i * keyHeight, width, keyHeight);
	}

	// 縦線（ステップ/拍）
	for (let s = 0; s <= totalSteps; s++) {
		const isBarLine = s % stepsPerBar === 0;
		const isBeatLine = s % (stepsPerBar / 4) === 0;

		g_ctx.lineWidth = isBarLine ? 1.5 : isBeatLine ? 0.5 : 0.2;
		g_ctx.strokeStyle = isBarLine
			? "#6B7280"
			: isBeatLine
				? "#9CA3AF"
				: "#E5E7EB";

		g_ctx.beginPath();
		g_ctx.moveTo(s * stepWidth, 0);
		g_ctx.lineTo(s * stepWidth, height);
		g_ctx.stroke();
	}
	g_ctx.lineWidth = 1;
};

/**
 * 指定されたノートの配列を描画します。
 * @param notes 描画するノート配列
 * @param drawOptions ノートの色など、トラック固有の描画オプション
 */
export const drawNotes = (
	notes: Note[],
	drawOptions: { color: string },
	config: PianoRollConfig = g_config!,
	options: RendererOptions = g_options!,
): void => {
	if (!g_ctx) return;

	// 旧 drawNotes のロジックを関数として実装
	const { keyHeight, stepWidth } = options;
	const { keyCount, pitchRangeStart } = config;
	const color = drawOptions.color || "#3B82F6";

	for (const note of notes) {
		const x = note.startStep * stepWidth;
		const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
		const y = yIndex * keyHeight;
		const w = note.durationSteps * stepWidth;
		const h = keyHeight;

		g_ctx.fillStyle = color;
		g_ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
	}
};

// ------------------------------------
// 3. イベント抽象化 (旧 Renderer.handleClick + ユーザー提示のAPI)
// ------------------------------------

/**
 * カーソルの座標取得
 */
const getXY = (e: MouseEvent): [number, number] => {
	if (!g_main_canvas) return [0, 0];
	const rect = g_main_canvas.getBoundingClientRect();
	const x = Math.floor(e.clientX - rect.left);
	const y = Math.floor(e.clientY - rect.top);
	return [x, y];
};

/**
 * ユーザーのクリックイベントを抽象化し、グリッド座標をコールバックに渡します。
 * デモJSは、この座標を使って Core.toggleNote() を呼び出します。
 */
export const onClick = (
	callback: (step: number, pitch: number) => void,
): void => {
	if (!g_main_canvas) return;
	g_main_canvas.addEventListener(
		"click",
		(e) => {
			const [x, y] = getXY(e);

			// 旧 handleClick の座標計算ロジックをここで実行
			if (!g_config || !g_options) return;
			const { keyCount, pitchRangeStart } = g_config;
			const { keyHeight, stepWidth } = g_options;

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
	g_main_canvas.addEventListener("contextmenu", (e) => e.preventDefault());
};
