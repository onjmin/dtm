import type { Note, RenderConfig } from "./types";

// グローバル変数
let g_header_canvas: HTMLCanvasElement; // 💡 ヘッダー用 (上)
let g_key_canvas: HTMLCanvasElement; // 鍵盤用 (左下)
let g_grid_canvas: HTMLCanvasElement; // ノート用 (右下)

let g_header_ctx: CanvasRenderingContext2D; // 💡 ヘッダー用コンテキスト
let g_key_ctx: CanvasRenderingContext2D;
let g_grid_ctx: CanvasRenderingContext2D;

let g_config: RenderConfig;

const KEYBOARD_WIDTH = 60; // 鍵盤の固定幅
const HEADER_HEIGHT = 20; // 💡 ヘッダーの固定高さ (px)

export const getRenderConfig = (): RenderConfig => g_config;

let g_draw_offset_x = 0;
let g_draw_offset_y = 0;

export const getDrawOffset = (): { x: number; y: number } => ({
	x: g_draw_offset_x,
	y: g_draw_offset_y,
});

export const getGridCanvas = (): HTMLCanvasElement => g_grid_canvas;

export const getGridContext = (): CanvasRenderingContext2D => g_grid_ctx;

export const getHeaderCanvas = (): HTMLCanvasElement => g_header_canvas;

/**
 * Canvasを初期化し、指定されたターゲット要素にマウントします。
 * ヘッダー用、鍵盤用、ノート用の3つのCanvasを作成します。
 */
export const init = (
	mountTarget: HTMLElement,
	width = 800,
	height = 450,
	config: RenderConfig,
): void => {
	g_config = config;

	// ヘッダー Canvas (上)
	const headerCanvas = document.createElement("canvas");
	g_header_canvas = headerCanvas;
	headerCanvas.width = width - KEYBOARD_WIDTH;
	headerCanvas.height = HEADER_HEIGHT;
	headerCanvas.style.position = "absolute";
	headerCanvas.style.left = `${KEYBOARD_WIDTH}px`; // 鍵盤の右側に配置
	headerCanvas.style.top = "0px"; // 上端に配置

	const headerCtx = headerCanvas.getContext("2d");
	if (!headerCtx)
		throw new Error("Failed to get 2D rendering context for header.");
	g_header_ctx = headerCtx;

	// 鍵盤用 Canvas (左下)
	const keyCanvas = document.createElement("canvas");
	g_key_canvas = keyCanvas;
	keyCanvas.width = KEYBOARD_WIDTH;
	// 💡 高さをヘッダー分調整
	keyCanvas.height = height - HEADER_HEIGHT;
	keyCanvas.style.position = "absolute";
	keyCanvas.style.left = "0px";
	keyCanvas.style.top = `${HEADER_HEIGHT}px`; // 💡 ヘッダーの下に配置

	const keyCtx = keyCanvas.getContext("2d");
	if (!keyCtx)
		throw new Error("Failed to get 2D rendering context for keyboard.");
	g_key_ctx = keyCtx;

	// グリッド/ノート用 Canvas (右下)
	const gridCanvas = document.createElement("canvas");
	g_grid_canvas = gridCanvas;
	gridCanvas.width = width - KEYBOARD_WIDTH;
	// 💡 高さをヘッダー分調整
	gridCanvas.height = height - HEADER_HEIGHT;
	gridCanvas.style.position = "absolute";
	gridCanvas.style.left = `${KEYBOARD_WIDTH}px`;
	gridCanvas.style.top = `${HEADER_HEIGHT}px`; // 💡 ヘッダーの下に配置

	const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
	if (!gridCtx) throw new Error("Failed to get 2D rendering context for grid.");
	g_grid_ctx = gridCtx;

	// 4. DOMにマウント
	mountTarget.innerHTML = "";
	mountTarget.style.position = "relative";
	// 全体の幅と高さを再調整
	mountTarget.style.width = `${width + KEYBOARD_WIDTH}px`;
	mountTarget.style.height = `${height}px`;

	// 💡 ヘッダーを一番上に配置
	mountTarget.append(headerCanvas, keyCanvas, gridCanvas);

	// 💡 ヘッダー用の空の鍵盤部分 (角のマス) を描画
	drawHeaderCorner();
};

const blackKeyPitches = new Set([1, 3, 6, 8, 10]);
const KEY_NAMES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B",
];

/**
 * 💡 ヘッダーCanvasの左端（鍵盤の上にある部分）を描画します。
 */
const drawHeaderCorner = (): void => {
	const mountTarget = g_key_canvas.parentElement; // マウントターゲットを取得
	if (!mountTarget) return;

	// ヘッダーの上に配置するDOM要素を動的に作成
	let cornerDiv = mountTarget.querySelector("#header-corner") as HTMLDivElement;
	if (!cornerDiv) {
		cornerDiv = document.createElement("div");
		cornerDiv.id = "header-corner";
		cornerDiv.style.position = "absolute";
		cornerDiv.style.left = "0px";
		cornerDiv.style.top = "0px";
		cornerDiv.style.width = `${KEYBOARD_WIDTH}px`;
		cornerDiv.style.height = `${HEADER_HEIGHT}px`;
		cornerDiv.style.backgroundColor = "#F3F4F6"; // gray-100 程度の背景色
		cornerDiv.style.borderRight = "1px solid #D1D5DB";
		cornerDiv.style.borderBottom = "1px solid #D1D5DB";
		mountTarget.insertBefore(cornerDiv, g_header_canvas); // ヘッダーCanvasの手前に挿入
	}
};

/**
 * 鍵盤を描画します。垂直スクロールに追従します。（鍵盤Canvasのみ）
 */
export const drawKeyboard = (): void => {
	g_key_ctx.clearRect(0, 0, g_key_canvas.width, g_key_canvas.height);

	const { keyHeight, keyCount } = g_config;

	// スクロールオフセットを考慮した、画面上端からの開始Y座標 (グリッド全体での絶対Y座標)
	const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
	const endY = g_draw_offset_y + g_key_canvas.height;

	for (let y = startY; y < endY; y += keyHeight) {
		// グリッド全体の絶対ピッチインデックス
		const pitchIndex = keyCount - 1 - y / keyHeight;
		const totalPitch = pitchIndex + g_config.pitchRangeStart;
		const pitchMod12 = totalPitch % 12;
		const octave = Math.floor(totalPitch / 12) - 1; // MIDI標準: C-1=0, C4=60
		const isBlackKey = blackKeyPitches.has(pitchMod12);
		const isC = pitchMod12 === 0;

		// 画面上のY座標 (スクロールオフセットを引く)
		const screenY = y - g_draw_offset_y;

		// 鍵盤の背景の塗りつぶし
		g_key_ctx.fillStyle = isBlackKey
			? "rgba(30, 41, 59, 0.7)"
			: isC
				? "#FEE2E2"
				: "#FFFFFF";
		g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);

		// 鍵盤のボーダー（オクターブ線）を描画
		g_key_ctx.beginPath();
		g_key_ctx.strokeStyle = isC ? "#EF4444" : "#D1D5DB";
		g_key_ctx.lineWidth = isC ? 2 : 1;
		g_key_ctx.moveTo(0, screenY);
		g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY);
		g_key_ctx.stroke();

		// オクターブ表記
		if (isC) {
			g_key_ctx.fillStyle = isBlackKey ? "#FFFFFF" : "#EF4444";
			g_key_ctx.font = "bold 10px sans-serif";
			g_key_ctx.textAlign = "right";
			g_key_ctx.textBaseline = "top";
			g_key_ctx.fillText(
				`${KEY_NAMES[pitchMod12]}${octave}`,
				KEYBOARD_WIDTH - 2,
				screenY + 2,
			);
		}
	}
};

export const drawHeader = (): void => {
	g_header_ctx.clearRect(0, 0, g_header_canvas.width, g_header_canvas.height);

	const { stepWidth, stepsPerBar } = g_config;

	g_header_ctx.save();
	g_header_ctx.translate(-g_draw_offset_x, 0);

	g_header_ctx.fillStyle = "#F9FAFB";
	g_header_ctx.fillRect(
		g_draw_offset_x,
		0,
		g_header_canvas.width,
		HEADER_HEIGHT,
	);

	g_header_ctx.strokeStyle = "#D1D5DB";
	g_header_ctx.lineWidth = 1;
	g_header_ctx.font = "bold 12px sans-serif";
	g_header_ctx.fillStyle = "#4B5563";

	const startBar = Math.floor(g_draw_offset_x / (stepsPerBar * stepWidth));
	const endBar = Math.ceil(
		(g_draw_offset_x + g_header_canvas.width) / (stepsPerBar * stepWidth),
	);

	for (let bar = startBar; bar <= endBar + 1; bar++) {
		const x = bar * stepsPerBar * stepWidth;
		const screenX = x;

		g_header_ctx.beginPath();
		g_header_ctx.moveTo(screenX, 0);
		g_header_ctx.lineTo(screenX, HEADER_HEIGHT);
		g_header_ctx.stroke();

		if (bar >= 0) {
			g_header_ctx.textAlign = "left";
			g_header_ctx.textBaseline = "middle";
			g_header_ctx.fillText(`${bar + 1}`, screenX + 5, HEADER_HEIGHT / 2);
		}
	}

	g_header_ctx.restore();
};

/**
 * グリッドと背景を描画します。（グリッドCanvasと鍵盤/ヘッダー描画の呼び出し）
 * @param noteLengthSteps ノート長ステップ数（この値ごとに縦線を表示）
 */
export const drawGrid = (noteLengthSteps: number = 1): void => {
	// 鍵盤とヘッダーの描画を呼び出し
	drawKeyboard();
	drawHeader();

	g_grid_ctx.clearRect(0, 0, g_grid_canvas.width, g_grid_canvas.height);

	const { keyHeight, keyCount, stepWidth, stepsPerBar } = g_config;

	// --- 水平線 (ピッチ) の描画 ---
	// Y座標の計算ロジックは前回と同じ (垂直スクロール)
	const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
	const endY = g_draw_offset_y + g_grid_canvas.height;

	for (let y = startY; y < endY; y += keyHeight) {
		const pitchIndex = keyCount - 1 - y / keyHeight;
		const pitchMod12 = pitchIndex % 12;
		const isBlackKey = blackKeyPitches.has(pitchMod12);
		const isC = pitchMod12 === 0;

		const screenY = y - g_draw_offset_y;

		// 黒鍵の背景の塗りつぶし
		if (isBlackKey) {
			g_grid_ctx.fillStyle = "#F3F4F6";
			g_grid_ctx.fillRect(0, screenY, g_grid_canvas.width, keyHeight);
		}

		// 水平グリッド線の描画
		g_grid_ctx.beginPath();
		g_grid_ctx.strokeStyle = isC ? "#D1D5DB" : "#E5E7EB";
		g_grid_ctx.lineWidth = 1;

		g_grid_ctx.moveTo(0, screenY);
		g_grid_ctx.lineTo(g_grid_canvas.width, screenY);
		g_grid_ctx.stroke();
	}

	// --- 垂直線 (小節線/拍線) の描画 ---
	// 指定されたステップごとにグリッド線を描画
	const gridStep = noteLengthSteps || 48;
	const startX =
		Math.floor(g_draw_offset_x / (stepWidth * gridStep)) * stepWidth * gridStep;
	const endX = g_draw_offset_x + g_grid_canvas.width;
	const lineStep = stepWidth * gridStep;

	for (let x = startX; x <= endX; x += lineStep) {
		const step = x / stepWidth;
		const isBarLine = step % stepsPerBar === 0;
		const isNoteLine = step % gridStep === 0;

		const screenX = x - g_draw_offset_x;

		g_grid_ctx.beginPath();
		g_grid_ctx.strokeStyle = isBarLine
			? "#A0A0A0"
			: isNoteLine
				? "#D1D5DB"
				: "#E5E7EB";
		g_grid_ctx.lineWidth = isBarLine ? 2 : 1;

		g_grid_ctx.moveTo(screenX, 0);
		g_grid_ctx.lineTo(screenX, g_grid_canvas.height);
		g_grid_ctx.stroke();
	}
};

/**
 * 指定されたノートの配列を描画します。（グリッドCanvasのみ）
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

		// ベロシティに応じた不透明度 (0.3〜1.0)
		const velocityOpacity =
			note.velocity !== undefined ? 0.3 + (note.velocity / 127) * 0.7 : 1.0;

		// 色をRGBAに変換
		if (color.startsWith("#")) {
			const r = parseInt(color.slice(1, 3), 16);
			const g = parseInt(color.slice(3, 5), 16);
			const b = parseInt(color.slice(5, 7), 16);
			g_grid_ctx.fillStyle = `rgba(${r},${g},${b},${velocityOpacity})`;
		} else {
			g_grid_ctx.fillStyle = color;
		}

		// 描画には renderX と renderY を使用
		g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
	}
};

/**
 * 選択範囲の四角形を描画します。
 */
export const drawSelectionRect = (
	rect: { x: number; y: number; width: number; height: number } | null,
): void => {
	if (!rect) return;

	g_grid_ctx.save();
	g_grid_ctx.strokeStyle = "#10B981";
	g_grid_ctx.lineWidth = 2;
	g_grid_ctx.setLineDash([5, 3]);
	g_grid_ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
	g_grid_ctx.fillStyle = "rgba(16, 185, 129, 0.1)";
	g_grid_ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
	g_grid_ctx.restore();
};

/**
 * 選択されたノートをハイライト描画します。
 */
export const drawSelectedNotes = (
	notes: Note[],
	selectedIds: Set<number>,
): void => {
	const { keyHeight, stepWidth, keyCount, pitchRangeStart } = g_config;

	for (const note of notes) {
		if (!selectedIds.has(note.id)) continue;

		const logicalX = note.startStep * stepWidth;
		const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
		const logicalY = yIndex * keyHeight;
		const w = note.durationSteps * stepWidth;
		const h = keyHeight;

		const renderX = logicalX - g_draw_offset_x;
		const renderY = logicalY - g_draw_offset_y;

		g_grid_ctx.save();
		g_grid_ctx.strokeStyle = "#10B981";
		g_grid_ctx.lineWidth = 3;
		g_grid_ctx.strokeRect(renderX, renderY, w, h);
		g_grid_ctx.restore();
	}
};

/**
 * カーソルの座標取得
 * (グリッドCanvasの相対座標を取得)
 */
export const getXY = (e: MouseEvent): [number, number, number] => {
	const { clientX, clientY } = e;
	const rect = g_grid_canvas.getBoundingClientRect();
	const x = Math.floor(clientX - rect.left);
	const y = Math.floor(clientY - rect.top);
	return [x, y, e.buttons];
};

export const getGridPosition = (
	e: MouseEvent,
): { step: number; pitch: number; x: number; y: number } => {
	const [x, y] = getXY(e);
	const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;
	const step = Math.floor((x + g_draw_offset_x) / stepWidth);
	const absoluteY = y + g_draw_offset_y;
	const yIndex = Math.floor(absoluteY / keyHeight);
	const pitch = keyCount - 1 - yIndex + pitchRangeStart;
	return { step, pitch, x, y };
};

/**
 * ユーザーのクリックイベントを抽象化し、グリッド座標をコールバックに渡します。
 * イベントリスナーをグリッドCanvasにのみ追加します。
 */
export const onClick = (
	callback: (step: number, pitch: number) => void,
): void => {
	g_grid_canvas.addEventListener(
		"click",
		(e) => {
			const [x, y] = getXY(e); // グリッドCanvas相対座標

			const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;

			// グリッド座標の特定
			// 水平方向: クリック位置(x) + スクロールオフセット(g_draw_offset_x)
			const step = Math.floor((x + g_draw_offset_x) / stepWidth);

			// 垂直方向: クリック位置(y) + スクロールオフセット(g_draw_offset_y) で絶対Y座標を取得
			const absoluteY = y + g_draw_offset_y;
			const yIndex = Math.floor(absoluteY / keyHeight);
			const pitch = keyCount - 1 - yIndex + pitchRangeStart;

			// 範囲チェック
			if (pitch >= pitchRangeStart && pitch < pitchRangeStart + keyCount) {
				requestAnimationFrame(() => callback(step, pitch));
			}
		},
		{ passive: true },
	);
	g_grid_canvas.addEventListener("contextmenu", (e) => e.preventDefault());
};

/**
 * 描画オフセット（描画開始ピクセル位置）を設定します。
 */
export const setDrawOffset = (x: number, y: number): void => {
	g_draw_offset_x = x;
	g_draw_offset_y = y;
	// 💡 垂直・水平オフセットが変わったら、追従のため鍵盤とヘッダーを再描画
	drawKeyboard();
	drawHeader();
};
