import {
	UNITS_PER_OCTAVE,
	UNITS_PER_SEMITONE,
	type Units,
	units,
} from "./tuning";
import type { Note, RenderConfig } from "./types";

const KEYBOARD_WIDTH = 60; // 鍵盤の固定幅
const HEADER_HEIGHT = 20; // 💡 ヘッダーの固定高さ (px)
/**
 * 幹音のオクターブ内位置（格子ステップ）。音律ごとに持つ。
 * 幹音間の変化音の数が 12平均律 `1 1 0 1 1 1 0` に対し 31平均律 `4 4 2 4 4 4 2` と、
 * 全音／半音の構造がそのまま拡大されるため、鍵盤のシルエットは両者で保存される。
 */
const NATURAL_STEPS: Record<number, number[]> = {
	12: [0, 2, 4, 5, 7, 9, 11],
	31: [0, 5, 10, 13, 18, 23, 28],
};

/** 鍵の階層。0=幹音（白鍵相当） 1=微分音（短い中間鍵） 2=クロマチック（黒鍵）。 */
type KeyTier = 0 | 1 | 2;

/**
 * オクターブ内の格子ステップ → 鍵の階層。
 *
 * 最寄りの幹音からの距離で決める。クロマチック半音ぶん離れていれば黒鍵、
 * それ未満なら微分音の中間鍵。12平均律ではクロマチック半音＝1ステップなので
 * 階層1が出現せず、従来と同じ白鍵／黒鍵の2階層になる（見た目は不変）。
 * 31平均律では 4つ空く区間が「短・長・長・短」、2つ空く区間が「短・短」となり、
 * 両者が形で見分けられる。中央で隣り合う黒鍵2本は、12平均律の黒鍵1本が
 * 分割鍵として割れたものにあたる。
 */
const keyTier = (step: number, edo: number): KeyTier => {
	const naturals = NATURAL_STEPS[edo] ?? NATURAL_STEPS[12];
	let best = edo;
	for (const n of naturals) {
		const d = Math.abs(step - n);
		best = Math.min(best, d, edo - d);
	}
	if (best === 0) return 0;
	return best >= (edo === 31 ? 2 : 1) ? 2 : 1;
};
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
 * 1つのピアノロール描画面（ヘッダー/鍵盤/グリッドの3枚のCanvas）を表す描画器。
 *
 * 以前はモジュールグローバル（`g_config` / 各Canvas / 描画オフセット）を直に触る
 * 関数群だったが、それだと1ページに2つ以上のエディタをマウントしたとき後からマウント
 * した側がグローバルを奪い、先にマウントした側の描画が相手のCanvasへ流れ込んでいた。
 * 曲ごとに音律（12平均律 / 31平均律）が違うと格子まで食い違うため、描画状態は
 * インスタンスに閉じ込める。
 */
export type Renderer = {
	getRenderConfig: () => RenderConfig;
	setBackgroundActive: (active: boolean) => void;
	getDrawOffset: () => { x: number; y: number };
	getGridCanvas: () => HTMLCanvasElement;
	getGridContext: () => CanvasRenderingContext2D;
	getHeaderCanvas: () => HTMLCanvasElement;
	drawKeyboard: () => void;
	drawHeader: () => void;
	drawGrid: (noteLengthSteps?: number) => void;
	drawNotes: (notes: Note[], color?: number[], isActive?: boolean) => void;
	drawNoteLyrics: (notes: Note[], syllables: string[]) => void;
	drawSelectionRect: (
		rect: { x: number; y: number; width: number; height: number } | null,
	) => void;
	drawSelectedNotes: (
		notes: Note[],
		selectedIds: Set<number>,
		baseColor?: number[],
	) => void;
	getXY: (e: MouseEvent | PointerEvent) => [number, number, number];
	getGridPosition: (e: MouseEvent | PointerEvent) => {
		step: number;
		/** ピッチ。単位は units（1/372オクターブ）。 */
		pitch: Units;
		x: number;
		y: number;
	};
	onClick: (callback: (step: number, pitch: Units) => void) => void;
	setDrawOffset: (x: number, y: number) => void;
	/** Canvasをマウント先から取り外す。 */
	destroy: () => void;
};

/**
 * Canvasを生成してマウントし、そのマウント面専用の描画器を返す。
 * 同じページに複数生成しても互いの状態を踏まない。
 */
export const createRenderer = (
	mountTarget: HTMLElement,
	width = 800,
	height = 450,
	config: RenderConfig,
): Renderer => {
	// グローバル変数
	let g_header_canvas: HTMLCanvasElement; // 💡 ヘッダー用 (上)
	let g_key_canvas: HTMLCanvasElement; // 鍵盤用 (左下)
	let g_grid_canvas: HTMLCanvasElement; // ノート用 (右下)

	let g_header_ctx: CanvasRenderingContext2D; // 💡 ヘッダー用コンテキスト
	let g_key_ctx: CanvasRenderingContext2D;
	let g_grid_ctx: CanvasRenderingContext2D;

	let g_config: RenderConfig = config;

	const getRenderConfig = (): RenderConfig => g_config;

	let g_draw_offset_x = 0;
	let g_draw_offset_y = 0;
	let g_bg_active = false;

	/**
	 * カスタム背景画像の有無を設定します。
	 * 有効時はグリッド/ヘッダーの塗りつぶしを半透明にし、背景を透過させます。
	 */
	const setBackgroundActive = (active: boolean): void => {
		g_bg_active = active;
	};

	const getDrawOffset = (): { x: number; y: number } => ({
		x: g_draw_offset_x,
		y: g_draw_offset_y,
	});

	const getGridCanvas = (): HTMLCanvasElement => g_grid_canvas;

	const getGridContext = (): CanvasRenderingContext2D => g_grid_ctx;

	const getHeaderCanvas = (): HTMLCanvasElement => g_header_canvas;

	/**
	 * Canvasを初期化し、指定されたターゲット要素にマウントします。
	 * ヘッダー用、鍵盤用、ノート用の3つのCanvasを作成します。
	 */
	const setup = (): void => {
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
		if (!gridCtx)
			throw new Error("Failed to get 2D rendering context for grid.");
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

	/**
	 * 💡 ヘッダーCanvasの左端（鍵盤の上にある部分）を描画します。
	 */
	const drawHeaderCorner = (): void => {
		const mountTarget = g_key_canvas.parentElement; // マウントターゲットを取得
		if (!mountTarget) return;

		// ヘッダーの上に配置するDOM要素を動的に作成
		let cornerDiv = mountTarget.querySelector(
			"#header-corner",
		) as HTMLDivElement;
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
	const drawKeyboard = (): void => {
		g_key_ctx.clearRect(0, 0, g_key_canvas.width, g_key_canvas.height);

		const {
			keyHeight,
			keyCount,
			pitchRangeStart,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
			edo = 12,
		} = g_config;

		const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
		const endY = g_draw_offset_y + g_key_canvas.height;

		const WHITE_KEY = "#ccc8b4";
		const BLACK_KEY = "#111111";
		const MICRO_KEY = "#4a4a4a"; // 微分音の中間鍵（黒鍵より浅い）
		const BK_EDGE = "#383838"; // 黒鍵右端のエッジ（立体感）
		const WW_SEP = "#807a6a"; // 白白境界の区切り線
		const BK_RATIO = 0.62; // 黒鍵の幅比率
		const MICRO_RATIO = 0.45; // 中間鍵の幅比率（黒鍵より短い＝分割鍵の手前側）

		for (let y = startY; y < endY; y += keyHeight) {
			const rowIndex = keyCount - 1 - y / keyHeight;
			const units = pitchRangeStart + rowIndex * upr;
			const step = Math.round(
				((((units % UNITS_PER_OCTAVE) + UNITS_PER_OCTAVE) % UNITS_PER_OCTAVE) /
					upr) %
					edo,
			);
			const tier = keyTier(step, edo);
			const octave = Math.floor(units / UNITS_PER_OCTAVE) - 1;
			const isC4Range = octave === 4;
			const screenY = y - g_draw_offset_y;
			const bkW = Math.floor(
				KEYBOARD_WIDTH * (tier === 1 ? MICRO_RATIO : BK_RATIO),
			);

			if (tier !== 0) {
				// 右側（白鍵が奥に見える部分）
				g_key_ctx.fillStyle = isC4Range ? "#d8d4be" : WHITE_KEY;
				g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
				// 鍵本体（階層2=黒鍵 / 階層1=微分音の中間鍵）
				g_key_ctx.fillStyle =
					tier === 1 ? MICRO_KEY : isC4Range ? "#1a1408" : BLACK_KEY;
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
				// 白白境界は幹音同士が隣接する12平均律だけの表現。31平均律では
				// 幹音の間に必ず変化音が入るので描かない（方向の手がかりは鍵の長さが担う）。
				if (edo === 12 && (step === 5 || step === 0)) {
					g_key_ctx.strokeStyle = WW_SEP;
					g_key_ctx.lineWidth = 1;
					g_key_ctx.beginPath();
					g_key_ctx.moveTo(0, screenY + keyHeight - 0.5);
					g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY + keyHeight - 0.5);
					g_key_ctx.stroke();
				}
			}

			// オクターブ表記 (C のみ、白鍵の右寄り)
			if (step === 0) {
				g_key_ctx.fillStyle = "#555040";
				g_key_ctx.font = "10px 'k8x12',monospace";
				g_key_ctx.textAlign = "right";
				g_key_ctx.textBaseline = "bottom";
				g_key_ctx.fillText(
					`${KEY_NAMES[0]}${octave}`,
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

	const drawHeader = (): void => {
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
	const drawGrid = (noteLengthSteps: number = 1): void => {
		// 鍵盤とヘッダーの描画を呼び出し
		drawKeyboard();
		drawHeader();

		g_grid_ctx.clearRect(0, 0, g_grid_canvas.width, g_grid_canvas.height);

		const {
			keyHeight,
			keyCount,
			stepWidth,
			stepsPerBar,
			pitchRangeStart,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
			edo = 12,
		} = g_config;

		// --- 水平線 (ピッチ) の描画 ---
		// Y座標の計算ロジックは前回と同じ (垂直スクロール)
		const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
		const endY = g_draw_offset_y + g_grid_canvas.height;

		for (let y = startY; y < endY; y += keyHeight) {
			const rowIndex = keyCount - 1 - y / keyHeight;
			// 鍵の階層・C線は実音高(units)基準。drawKeyboard と同じ式で出さないと
			// pitchRangeStart がオクターブ境界でないときグリッドの縞と鍵盤がずれる。
			const units = pitchRangeStart + rowIndex * upr;
			const step = Math.round(
				((((units % UNITS_PER_OCTAVE) + UNITS_PER_OCTAVE) % UNITS_PER_OCTAVE) /
					upr) %
					edo,
			);
			const tier = keyTier(step, edo);
			const isC = step === 0;
			const octave = Math.floor(units / UNITS_PER_OCTAVE) - 1;
			const isC4Range = octave === 4;

			const screenY = y - g_draw_offset_y;

			// 行ごとの背景。鍵盤と同じ3階層（幹音 / 微分音 / クロマチック）で塗り分ける。
			// カスタム背景が有効な場合は半透明にして背景画像を透過させる
			g_grid_ctx.fillStyle = g_bg_active
				? tier === 2
					? "rgba(8,11,22,0.55)"
					: tier === 1
						? "rgba(12,16,30,0.5)"
						: "rgba(17,22,40,0.45)"
				: tier === 2
					? "#080b16"
					: tier === 1
						? "#0c101d"
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
			Math.floor(g_draw_offset_x / (stepWidth * gridStep)) *
			stepWidth *
			gridStep;
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
	 * @param notes 描画対象のノートリスト
	 * @param color [r, g, b, a] のカラー値
	 * @param isActive アクティブトラックかどうか（アクティブ時は立体ハイライト・鮮明表示、非アクティブ時はゴースト表示）
	 */
	const drawNotes = (
		notes: Note[],
		color: number[] = [59, 130, 246, 1.0],
		isActive: boolean = true,
	): void => {
		const {
			keyHeight,
			stepWidth,
			keyCount,
			pitchRangeStart,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
		} = g_config;
		const canvasWidth = g_grid_canvas.width;
		const canvasHeight = g_grid_canvas.height;
		const [r, g, b, a] = color;

		for (const note of notes) {
			// ノートの論理座標とサイズを計算
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitchUnits - pitchRangeStart) / upr;
			const logicalY = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const h = keyHeight;

			// ノートがスクロール領域に合わせて移動するようにする
			const renderX = logicalX - g_draw_offset_x;
			const renderY = logicalY - g_draw_offset_y;

			// 画面外のノートはスキップ（描画負荷軽減）
			if (renderX + w < 0 || renderX > canvasWidth) continue;
			if (renderY + h < 0 || renderY > canvasHeight) continue;

			if (isActive) {
				// アクティブトラック：鮮やかな色＋立体ハイライト＆シャドウ
				const velocityOpacity =
					note.velocity !== undefined ? 0.6 + (note.velocity / 127) * 0.4 : 1.0;
				const finalOpacity = a * velocityOpacity;

				// ノート本体塗り
				g_grid_ctx.fillStyle = `rgba(${r},${g},${b},${finalOpacity})`;
				g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);

				// ノートエッジの立体感（上・左にハイライト、下・右にシャドウ）
				if (w >= 4 && h >= 4) {
					// 上辺ハイライト
					g_grid_ctx.fillStyle = "rgba(255,255,255,0.4)";
					g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, 1);
					// 左端ハイライト（ノートオンの視認性向上）
					g_grid_ctx.fillRect(renderX + 1, renderY + 1, 1, h - 2);

					// 下辺シャドウ
					g_grid_ctx.fillStyle = "rgba(0,0,0,0.45)";
					g_grid_ctx.fillRect(renderX + 1, renderY + h - 2, w - 2, 1);
					// 右端シャドウ
					g_grid_ctx.fillRect(renderX + w - 2, renderY + 1, 1, h - 2);
				}
			} else {
				// 非アクティブトラック：彩度を落とした半透明のゴースト表示（背景ガイド）
				const velocityOpacity =
					note.velocity !== undefined ? 0.7 + (note.velocity / 127) * 0.3 : 1.0;
				const finalOpacity = Math.min(0.25, a * 0.22) * velocityOpacity;

				// 彩度を少し落として落ち着いたトーンにする
				const gray = 0.299 * r + 0.587 * g + 0.114 * b;
				const ghostR = Math.round(r * 0.6 + gray * 0.4);
				const ghostG = Math.round(g * 0.6 + gray * 0.4);
				const ghostB = Math.round(b * 0.6 + gray * 0.4);

				g_grid_ctx.fillStyle = `rgba(${ghostR},${ghostG},${ghostB},${finalOpacity})`;
				g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
			}
		}
	};

	/**
	 * ノートの上に歌詞（かな）を重ねて描画します。
	 *
	 * 音節の割り当ては発音側（StreamVoiceTrack の組み立て）と同じ規則で、
	 * startStep 昇順に並べたノートの i 番目へ syllables[i] を対応させます。
	 * 音節が足りないぶんのノートには何も描きません。
	 *
	 * 文字はノート矩形でクリップするため、隣のノートへはみ出しません。
	 */
	const drawNoteLyrics = (notes: Note[], syllables: string[]): void => {
		if (syllables.length === 0) return;

		const {
			keyHeight,
			stepWidth,
			keyCount,
			pitchRangeStart,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
		} = g_config;
		// 行が低すぎると文字が潰れて読めないので描かない（縦ズームを絞った状態）。
		// 閾値は zoomY 最小(50%) の行高 7.5px を下回らない値にしてある。10px だと
		// zoomY 50%/75% で歌詞が消えていた。31平均律は1オクターブ31段で低いズームに
		// 留まりやすく、消える頻度が上がるため描く側へ倒す。
		if (keyHeight < 7) return;
		const fontSize = Math.min(12, Math.floor(keyHeight * 0.85));

		const sorted = [...notes].sort((a, b) => a.startStep - b.startStep);
		const count = Math.min(sorted.length, syllables.length);

		g_grid_ctx.save();
		g_grid_ctx.font = `${fontSize}px 'k8x12',sans-serif`;
		g_grid_ctx.textAlign = "left";
		g_grid_ctx.textBaseline = "middle";
		g_grid_ctx.lineWidth = 3;
		g_grid_ctx.lineJoin = "round";

		for (let i = 0; i < count; i++) {
			const kana = syllables[i];
			if (!kana) continue;

			const note = sorted[i];
			const renderX = note.startStep * stepWidth - g_draw_offset_x;
			const renderY =
				(keyCount - 1 - (note.pitchUnits - pitchRangeStart) / upr) * keyHeight -
				g_draw_offset_y;
			const w = note.durationSteps * stepWidth;

			// 画面外・細すぎるノートはスキップ
			if (w < 6) continue;
			if (renderX + w < 0 || renderX > g_grid_canvas.width) continue;
			if (renderY + keyHeight < 0 || renderY > g_grid_canvas.height) continue;

			const textX = renderX + 2;
			const textY = renderY + keyHeight / 2;

			g_grid_ctx.save();
			// ノート矩形の内側だけに描く（はみ出し防止）
			g_grid_ctx.beginPath();
			g_grid_ctx.rect(renderX + 1, renderY + 1, w - 2, keyHeight - 2);
			g_grid_ctx.clip();
			// 縁取り→本体の順に描いてノート色の上でも読めるようにする
			g_grid_ctx.strokeStyle = "rgba(0,0,0,0.85)";
			g_grid_ctx.strokeText(kana, textX, textY);
			g_grid_ctx.fillStyle = "#fff1e8";
			g_grid_ctx.fillText(kana, textX, textY);
			g_grid_ctx.restore();
		}

		g_grid_ctx.restore();
	};

	/**
	 * 選択範囲の四角形を描画します。
	 */
	const drawSelectionRect = (
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
	const drawSelectedNotes = (
		notes: Note[],
		selectedIds: Set<number>,
		baseColor: number[] = [59, 130, 246, 1.0],
	): void => {
		const {
			keyHeight,
			stepWidth,
			keyCount,
			pitchRangeStart,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
		} = g_config;

		for (const note of notes) {
			if (!selectedIds.has(note.id)) continue;

			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitchUnits - pitchRangeStart) / upr;
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
	const getXY = (e: MouseEvent | PointerEvent): [number, number, number] => {
		const { clientX, clientY } = e;
		const rect = g_grid_canvas.getBoundingClientRect();
		const x = Math.floor(clientX - rect.left);
		const y = Math.floor(clientY - rect.top);
		return [x, y, e.buttons];
	};

	const getGridPosition = (
		e: MouseEvent | PointerEvent,
	): { step: number; pitch: Units; x: number; y: number } => {
		const [x, y] = getXY(e);
		const {
			keyCount,
			pitchRangeStart,
			keyHeight,
			stepWidth,
			unitsPerRow: upr = UNITS_PER_SEMITONE,
		} = g_config;
		const step = Math.floor((x + g_draw_offset_x) / stepWidth);
		const absoluteY = y + g_draw_offset_y;
		const yIndex = Math.floor(absoluteY / keyHeight);
		const pitch = units(pitchRangeStart + (keyCount - 1 - yIndex) * upr);
		return { step, pitch, x, y };
	};

	/**
	 * ユーザーのクリックイベントを抽象化し、グリッド座標をコールバックに渡します。
	 * イベントリスナーをグリッドCanvasにのみ追加します。
	 */
	const onClick = (callback: (step: number, pitch: Units) => void): void => {
		g_grid_canvas.addEventListener(
			"click",
			(e) => {
				const [x, y] = getXY(e); // グリッドCanvas相対座標

				const {
					keyCount,
					pitchRangeStart,
					keyHeight,
					stepWidth,
					unitsPerRow: upr = UNITS_PER_SEMITONE,
				} = g_config;

				// グリッド座標の特定
				// 水平方向: クリック位置(x) + スクロールオフセット(g_draw_offset_x)
				const step = Math.floor((x + g_draw_offset_x) / stepWidth);

				// 垂直方向: クリック位置(y) + スクロールオフセット(g_draw_offset_y) で絶対Y座標を取得
				const absoluteY = y + g_draw_offset_y;
				const yIndex = Math.floor(absoluteY / keyHeight);
				const pitch = units(pitchRangeStart + (keyCount - 1 - yIndex) * upr);

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
	const setDrawOffset = (x: number, y: number): void => {
		g_draw_offset_x = x;
		g_draw_offset_y = y;
		// 💡 垂直・水平オフセットが変わったら、追従のため鍵盤とヘッダーを再描画
		drawKeyboard();
		drawHeader();
	};

	setup();

	return {
		getRenderConfig,
		setBackgroundActive,
		getDrawOffset,
		getGridCanvas,
		getGridContext,
		getHeaderCanvas,
		drawKeyboard,
		drawHeader,
		drawGrid,
		drawNotes,
		drawNoteLyrics,
		drawSelectionRect,
		drawSelectedNotes,
		getXY,
		getGridPosition,
		onClick,
		setDrawOffset,
		destroy: () => {
			mountTarget.innerHTML = "";
		},
	};
};
