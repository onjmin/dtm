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
let g_bg_active = false;

/**
 * カスタム背景画像の有無を設定します。
 * 有効時はグリッド/ヘッダーの塗りつぶしを半透明にし、背景を透過させます。
 */
export const setBackgroundActive = (active: boolean): void => {
	g_bg_active = active;
};

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
	gridCanvas.style.top = `${HEADER_HEIGHT}px`;
	gridCanvas.style.touchAction = "none"; // スマホでのスクロール防止
	gridCanvas.style.userSelect = "none";

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
		cornerDiv.style.backgroundColor = "#0a0f1f";
		cornerDiv.style.borderRight = "2px solid #29adff";
		cornerDiv.style.borderBottom = "2px solid #29adff";
		mountTarget.insertBefore(cornerDiv, g_header_canvas); // ヘッダーCanvasの手前に挿入
	}
};

/**
 * 鍵盤を描画します。
 * - 白鍵: クリーム色、全幅
 * - 黒鍵: 左 62% を黒塗り、右 38% は白鍵色（奥に伸びて見える）
 * - E→F / C→B(下オクターブ) の白白境界に区切り線
 */
export const drawKeyboard = (): void => {
	g_key_ctx.clearRect(0, 0, g_key_canvas.width, g_key_canvas.height);

	const { keyHeight, keyCount, pitchRangeStart } = g_config;

	const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
	const endY = g_draw_offset_y + g_key_canvas.height;

	const WHITE_KEY = "#ccc8b4";
	const BLACK_KEY = "#111111";
	const BK_EDGE = "#383838"; // 黒鍵右端のエッジ（立体感）
	const WW_SEP = "#807a6a"; // 白白境界の区切り線
	const BK_RATIO = 0.62; // 黒鍵の幅比率

	for (let y = startY; y < endY; y += keyHeight) {
		const pitchIndex = keyCount - 1 - y / keyHeight;
		const totalPitch = pitchIndex + pitchRangeStart;
		const pitchMod12 = totalPitch % 12;
		const isBlackKey = blackKeyPitches.has(pitchMod12);
		const octave = Math.floor(totalPitch / 12) - 1;
		const isC4Range = octave === 4;
		const screenY = y - g_draw_offset_y;
		const bkW = Math.floor(KEYBOARD_WIDTH * BK_RATIO);

		if (isBlackKey) {
			// 右側（白鍵が奥に見える部分）
			g_key_ctx.fillStyle = isC4Range ? "#d8d4be" : WHITE_KEY;
			g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
			// 黒鍵本体
			g_key_ctx.fillStyle = isC4Range ? "#1a1408" : BLACK_KEY;
			g_key_ctx.fillRect(0, screenY, bkW, keyHeight);
			// 黒鍵の右端エッジライン
			g_key_ctx.strokeStyle = BK_EDGE;
			g_key_ctx.lineWidth = 1;
			g_key_ctx.beginPath();
			g_key_ctx.moveTo(bkW, screenY);
			g_key_ctx.lineTo(bkW, screenY + keyHeight);
			g_key_ctx.stroke();
		} else {
			// 白鍵
			g_key_ctx.fillStyle = isC4Range ? "#dedad0" : WHITE_KEY;
			g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
			// 白白境界（F の下端 = E との境、C の下端 = 下オクターブ B との境）
			if (pitchMod12 === 5 || pitchMod12 === 0) {
				g_key_ctx.strokeStyle = WW_SEP;
				g_key_ctx.lineWidth = 1;
				g_key_ctx.beginPath();
				g_key_ctx.moveTo(0, screenY + keyHeight - 0.5);
				g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY + keyHeight - 0.5);
				g_key_ctx.stroke();
			}
		}

		// オクターブ表記 (C のみ、白鍵の右寄り)
		if (pitchMod12 === 0) {
			const octave = Math.floor(totalPitch / 12) - 1;
			g_key_ctx.fillStyle = "#555040";
			g_key_ctx.font = "10px 'k8x12',monospace";
			g_key_ctx.textAlign = "right";
			g_key_ctx.textBaseline = "bottom";
			g_key_ctx.fillText(
				`${KEY_NAMES[pitchMod12]}${octave}`,
				KEYBOARD_WIDTH - 4,
				screenY + keyHeight - 2,
			);
		}
	}

	// 鍵盤右端の境界線（グリッドとの区切り）
	g_key_ctx.beginPath();
	g_key_ctx.strokeStyle = "#29adff";
	g_key_ctx.lineWidth = 2;
	g_key_ctx.moveTo(KEYBOARD_WIDTH, 0);
	g_key_ctx.lineTo(KEYBOARD_WIDTH, g_key_canvas.height);
	g_key_ctx.stroke();
};

export const drawHeader = (): void => {
	g_header_ctx.clearRect(0, 0, g_header_canvas.width, g_header_canvas.height);

	const { stepWidth, stepsPerBar } = g_config;

	g_header_ctx.save();
	g_header_ctx.translate(-g_draw_offset_x, 0);

	g_header_ctx.fillStyle = g_bg_active ? "rgba(10,15,31,0.55)" : "#0a0f1f";
	g_header_ctx.fillRect(
		g_draw_offset_x,
		0,
		g_header_canvas.width,
		HEADER_HEIGHT,
	);

	g_header_ctx.strokeStyle = "#3d405b";
	g_header_ctx.lineWidth = 1;
	g_header_ctx.font = "11px 'k8x12',monospace";
	g_header_ctx.fillStyle = "#83769c";

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

	const { keyHeight, keyCount, stepWidth, stepsPerBar, pitchRangeStart } =
		g_config;

	// --- 水平線 (ピッチ) の描画 ---
	// Y座標の計算ロジックは前回と同じ (垂直スクロール)
	const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
	const endY = g_draw_offset_y + g_grid_canvas.height;

	for (let y = startY; y < endY; y += keyHeight) {
		const pitchIndex = keyCount - 1 - y / keyHeight;
		const totalPitch = pitchIndex + pitchRangeStart;
		const pitchMod12 = pitchIndex % 12;
		const isBlackKey = blackKeyPitches.has(pitchMod12);
		const isC = pitchMod12 === 0;
		const octave = Math.floor(totalPitch / 12) - 1;
		const isC4Range = octave === 4;

		const screenY = y - g_draw_offset_y;

		// 行ごとの背景（黒鍵: 暗め、白鍵: やや明るめでシマ模様）
		// カスタム背景が有効な場合は半透明にして背景画像を透過させる
		g_grid_ctx.fillStyle = g_bg_active
			? isBlackKey
				? "rgba(8,11,22,0.55)"
				: "rgba(17,22,40,0.45)"
			: isBlackKey
				? "#080b16"
				: "#111628";
		g_grid_ctx.fillRect(0, screenY, g_grid_canvas.width, keyHeight);

		// C4〜B4帯のハイライトオーバーレイ
		if (isC4Range) {
			g_grid_ctx.fillStyle = "rgba(41,173,255,0.05)";
			g_grid_ctx.fillRect(0, screenY, g_grid_canvas.width, keyHeight);
		}

		// 水平グリッド線の描画
		g_grid_ctx.beginPath();
		g_grid_ctx.strokeStyle = isC ? "#3d405b" : "#1a1d30";
		g_grid_ctx.lineWidth = 1;

		const lineY = screenY + keyHeight;
		g_grid_ctx.moveTo(0, lineY);
		g_grid_ctx.lineTo(g_grid_canvas.width, lineY);
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
			? "#3d405b"
			: isNoteLine
				? "#242840"
				: "#1a1d30";
		g_grid_ctx.lineWidth = isBarLine ? 2 : 1;

		g_grid_ctx.moveTo(screenX, 0);
		g_grid_ctx.lineTo(screenX, g_grid_canvas.height);
		g_grid_ctx.stroke();
	}
};

/**
 * 指定されたノートの配列を描画します。
 */
export const drawNotes = (
	notes: Note[],
	color: number[] = [59, 130, 246, 1.0],
): void => {
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

		// ベロシティに応じた不透明度 (0.5〜1.0)
		const velocityOpacity =
			note.velocity !== undefined ? 0.5 + (note.velocity / 127) * 0.5 : 1.0;

		// colorは[r, g, b, a]の配列
		const [r, g, b, a] = color;
		const finalOpacity = a * velocityOpacity;

		g_grid_ctx.fillStyle = `rgba(${r},${g},${b},${finalOpacity})`;

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
	g_grid_ctx.strokeStyle = "#ffec27";
	g_grid_ctx.lineWidth = 2;
	g_grid_ctx.setLineDash([4, 4]);
	g_grid_ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
	g_grid_ctx.fillStyle = "rgba(255,236,39,0.08)";
	g_grid_ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
	g_grid_ctx.restore();
};

/**
 * 選択されたノートをハイライト描画します。（濃い色で描画、枠なし）
 */
export const drawSelectedNotes = (
	notes: Note[],
	selectedIds: Set<number>,
	baseColor: number[] = [59, 130, 246, 1.0],
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

		// ベロシティに応じた不透明度
		const velocityOpacity =
			note.velocity !== undefined ? 0.5 + (note.velocity / 127) * 0.5 : 1.0;

		// 選択中のノートはより濃い色で描画（色を少し濃くする）
		const [r, g, b, a] = baseColor;
		const darkenFactor = 1.3; // 色を濃くする係数
		const darkerR = Math.min(255, r * darkenFactor);
		const darkerG = Math.min(255, g * darkenFactor);
		const darkerB = Math.min(255, b * darkenFactor);
		const finalOpacity = a * velocityOpacity;

		g_grid_ctx.fillStyle = `rgba(${darkerR},${darkerG},${darkerB},${finalOpacity})`;
		g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
	}
};

/**
 * カーソルの座標取得
 * (グリッドCanvasの相対座標を取得)
 */
export const getXY = (
	e: MouseEvent | PointerEvent,
): [number, number, number] => {
	const { clientX, clientY } = e;
	const rect = g_grid_canvas.getBoundingClientRect();
	const x = Math.floor(clientX - rect.left);
	const y = Math.floor(clientY - rect.top);
	return [x, y, e.buttons];
};

export const getGridPosition = (
	e: MouseEvent | PointerEvent,
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
