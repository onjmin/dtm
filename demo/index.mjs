// src/linked-list.ts
var LinkedList = class {
  #cursor;
  constructor() {
    const node = { value: null, prev: null, next: null };
    this.#cursor = node;
  }
  /**
   * 履歴を1つ追加
   */
  add(value) {
    const node = {
      value,
      prev: this.#cursor,
      next: null
    };
    this.#cursor.next = node;
    this.#cursor = node;
  }
  /**
   * 履歴を1つ戻す
   */
  undo() {
    const { prev } = this.#cursor;
    if (prev === null || prev.value === null) return null;
    this.#cursor = prev;
    return this.#cursor.value;
  }
  /**
   * 履歴を1つ進める
   */
  redo() {
    const { next } = this.#cursor;
    if (next === null || next.value === null) return null;
    this.#cursor = next;
    return this.#cursor.value;
  }
};

// src/renderer.ts
var g_header_canvas;
var g_key_canvas;
var g_grid_canvas;
var g_header_ctx;
var g_key_ctx;
var g_grid_ctx;
var g_config;
var KEYBOARD_WIDTH = 60;
var HEADER_HEIGHT = 20;
var getRenderConfig = () => g_config;
var g_draw_offset_x = 0;
var g_draw_offset_y = 0;
var init = (mountTarget, width = 800, height = 450, config) => {
  g_config = config;
  const headerCanvas = document.createElement("canvas");
  g_header_canvas = headerCanvas;
  headerCanvas.width = width;
  headerCanvas.height = HEADER_HEIGHT;
  headerCanvas.style.position = "absolute";
  headerCanvas.style.left = `${KEYBOARD_WIDTH}px`;
  headerCanvas.style.top = "0px";
  const headerCtx = headerCanvas.getContext("2d");
  if (!headerCtx)
    throw new Error("Failed to get 2D rendering context for header.");
  g_header_ctx = headerCtx;
  const keyCanvas = document.createElement("canvas");
  g_key_canvas = keyCanvas;
  keyCanvas.width = KEYBOARD_WIDTH;
  keyCanvas.height = height - HEADER_HEIGHT;
  keyCanvas.style.position = "absolute";
  keyCanvas.style.left = "0px";
  keyCanvas.style.top = `${HEADER_HEIGHT}px`;
  const keyCtx = keyCanvas.getContext("2d");
  if (!keyCtx)
    throw new Error("Failed to get 2D rendering context for keyboard.");
  g_key_ctx = keyCtx;
  const gridCanvas = document.createElement("canvas");
  g_grid_canvas = gridCanvas;
  gridCanvas.width = width - KEYBOARD_WIDTH;
  gridCanvas.height = height - HEADER_HEIGHT;
  gridCanvas.style.position = "absolute";
  gridCanvas.style.left = `${KEYBOARD_WIDTH}px`;
  gridCanvas.style.top = `${HEADER_HEIGHT}px`;
  const gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
  if (!gridCtx) throw new Error("Failed to get 2D rendering context for grid.");
  g_grid_ctx = gridCtx;
  mountTarget.innerHTML = "";
  mountTarget.style.position = "relative";
  mountTarget.style.width = `${width + KEYBOARD_WIDTH}px`;
  mountTarget.style.height = `${height}px`;
  mountTarget.append(headerCanvas, keyCanvas, gridCanvas);
  drawHeaderCorner();
};
var blackKeyPitches = /* @__PURE__ */ new Set([1, 3, 6, 8, 10]);
var KEY_NAMES = [
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
  "B"
];
var drawHeaderCorner = () => {
  const mountTarget = g_key_canvas.parentElement;
  if (!mountTarget) return;
  let cornerDiv = mountTarget.querySelector("#header-corner");
  if (!cornerDiv) {
    cornerDiv = document.createElement("div");
    cornerDiv.id = "header-corner";
    cornerDiv.style.position = "absolute";
    cornerDiv.style.left = "0px";
    cornerDiv.style.top = "0px";
    cornerDiv.style.width = `${KEYBOARD_WIDTH}px`;
    cornerDiv.style.height = `${HEADER_HEIGHT}px`;
    cornerDiv.style.backgroundColor = "#F3F4F6";
    cornerDiv.style.borderRight = "1px solid #D1D5DB";
    cornerDiv.style.borderBottom = "1px solid #D1D5DB";
    mountTarget.insertBefore(cornerDiv, g_header_canvas);
  }
};
var drawKeyboard = () => {
  g_key_ctx.clearRect(0, 0, g_key_canvas.width, g_key_canvas.height);
  const { keyHeight, keyCount } = g_config;
  const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
  const endY = g_draw_offset_y + g_key_canvas.height;
  for (let y = startY; y <= endY; y += keyHeight) {
    const pitchIndex = keyCount - 1 - y / keyHeight;
    const totalPitch = pitchIndex + g_config.pitchRangeStart;
    const pitchMod12 = totalPitch % 12;
    const octave = Math.floor(totalPitch / 12);
    const isBlackKey = blackKeyPitches.has(pitchMod12);
    const isC = pitchMod12 === 0;
    const screenY = y - g_draw_offset_y;
    g_key_ctx.fillStyle = isBlackKey ? "rgba(30, 41, 59, 0.7)" : isC ? "#FEE2E2" : "#FFFFFF";
    g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
    g_key_ctx.beginPath();
    g_key_ctx.strokeStyle = isC ? "#EF4444" : "#D1D5DB";
    g_key_ctx.lineWidth = isC ? 2 : 1;
    g_key_ctx.moveTo(0, screenY);
    g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY);
    g_key_ctx.stroke();
    if (isC) {
      g_key_ctx.fillStyle = isBlackKey ? "#FFFFFF" : "#EF4444";
      g_key_ctx.font = "bold 10px sans-serif";
      g_key_ctx.textAlign = "right";
      g_key_ctx.textBaseline = "top";
      g_key_ctx.fillText(
        `${KEY_NAMES[pitchMod12]}${octave}`,
        KEYBOARD_WIDTH - 2,
        screenY + 2
      );
    }
  }
};
var drawHeader = () => {
  g_header_ctx.clearRect(0, 0, g_header_canvas.width, g_header_canvas.height);
  const { stepWidth, stepsPerBar, bars } = g_config;
  g_header_ctx.save();
  g_header_ctx.translate(-g_draw_offset_x, 0);
  const totalWidth = bars * stepsPerBar * stepWidth;
  g_header_ctx.fillStyle = "#F9FAFB";
  g_header_ctx.fillRect(0, 0, totalWidth, HEADER_HEIGHT);
  g_header_ctx.strokeStyle = "#D1D5DB";
  g_header_ctx.lineWidth = 1;
  g_header_ctx.font = "bold 12px sans-serif";
  g_header_ctx.fillStyle = "#4B5563";
  for (let bar = 0; bar <= bars; bar++) {
    const x = bar * stepsPerBar * stepWidth;
    const screenX = x;
    g_header_ctx.beginPath();
    g_header_ctx.moveTo(screenX, 0);
    g_header_ctx.lineTo(screenX, HEADER_HEIGHT);
    g_header_ctx.stroke();
    if (bar < bars) {
      g_header_ctx.textAlign = "left";
      g_header_ctx.textBaseline = "middle";
      g_header_ctx.fillText(`${bar + 1}`, screenX + 5, HEADER_HEIGHT / 2);
    }
  }
  g_header_ctx.restore();
};
var drawGrid = () => {
  drawKeyboard();
  drawHeader();
  g_grid_ctx.clearRect(0, 0, g_grid_canvas.width, g_grid_canvas.height);
  const { keyHeight, keyCount, stepWidth, stepsPerBar } = g_config;
  const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
  const endY = g_draw_offset_y + g_grid_canvas.height;
  for (let y = startY; y <= endY; y += keyHeight) {
    const pitchIndex = keyCount - 1 - y / keyHeight;
    const pitchMod12 = pitchIndex % 12;
    const isBlackKey = blackKeyPitches.has(pitchMod12);
    const isC = pitchMod12 === 0;
    const screenY = y - g_draw_offset_y;
    if (isBlackKey) {
      g_grid_ctx.fillStyle = "#F3F4F6";
      g_grid_ctx.fillRect(0, screenY, g_grid_canvas.width, keyHeight);
    }
    g_grid_ctx.beginPath();
    g_grid_ctx.strokeStyle = isC ? "#D1D5DB" : "#E5E7EB";
    g_grid_ctx.lineWidth = 1;
    g_grid_ctx.moveTo(0, screenY);
    g_grid_ctx.lineTo(g_grid_canvas.width, screenY);
    g_grid_ctx.stroke();
  }
  const startX = Math.floor(g_draw_offset_x / stepWidth) * stepWidth;
  const endX = g_draw_offset_x + g_grid_canvas.width;
  for (let x = startX; x <= endX; x += stepWidth) {
    const isBarLine = x / stepWidth % stepsPerBar === 0;
    const screenX = x - g_draw_offset_x;
    g_grid_ctx.beginPath();
    g_grid_ctx.strokeStyle = isBarLine ? "#A0A0A0" : "#E5E7EB";
    g_grid_ctx.lineWidth = isBarLine ? 2 : 1;
    g_grid_ctx.moveTo(screenX, 0);
    g_grid_ctx.lineTo(screenX, g_grid_canvas.height);
    g_grid_ctx.stroke();
  }
};
var drawNotes = (notes, color = "#3B82F6") => {
  const { keyHeight, stepWidth, keyCount, pitchRangeStart } = g_config;
  for (const note of notes) {
    const logicalX = note.startStep * stepWidth;
    const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
    const logicalY = yIndex * keyHeight;
    const w = note.durationSteps * stepWidth;
    const h = keyHeight;
    const renderX = logicalX - g_draw_offset_x;
    const renderY = logicalY - g_draw_offset_y;
    g_grid_ctx.fillStyle = color;
    g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
  }
};
var getXY = (e) => {
  const { clientX, clientY } = e;
  const rect = g_grid_canvas.getBoundingClientRect();
  const x = Math.floor(clientX - rect.left);
  const y = Math.floor(clientY - rect.top);
  return [x, y, e.buttons];
};
var onClick = (callback) => {
  g_grid_canvas.addEventListener(
    "click",
    (e) => {
      const [x, y] = getXY(e);
      const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;
      const step = Math.floor((x + g_draw_offset_x) / stepWidth);
      const yIndex = Math.floor(y / keyHeight);
      const pitch = keyCount - 1 - yIndex + pitchRangeStart;
      if (pitch >= pitchRangeStart && pitch < pitchRangeStart + keyCount) {
        requestAnimationFrame(() => callback(step, pitch));
      }
    },
    { passive: true }
  );
  g_grid_canvas.addEventListener("contextmenu", (e) => e.preventDefault());
};
var setDrawOffset = (x, y) => {
  g_draw_offset_x = x;
  g_draw_offset_y = y;
  drawKeyboard();
  drawHeader();
};

// src/mml-core.ts
var PITCH_MAP = [
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
  "b"
];
var MMLCore = class {
  notes = [];
  nextNoteId = 0;
  handlers;
  volume = 80;
  constructor(handlers) {
    this.handlers = handlers;
    this.generateAndNotify();
  }
  // ============== ノート編集 (外部API) ==============
  /**
   * 指定されたグリッド位置にノートを追加または削除するトグル操作
   * @param step ステップ位置
   * @param pitch ピッチ番号
   * @param options ノート長などの設定
   */
  toggleNote(step, pitch, options) {
    const existingIndex = this.notes.findIndex(
      (n) => n.startStep === step && n.pitch === pitch
    );
    if (existingIndex !== -1) {
      this.notes.splice(existingIndex, 1);
    } else {
      const newNote = {
        id: this.nextNoteId++,
        startStep: step,
        durationSteps: options.noteLengthSteps,
        pitch
      };
      this.notes.push(newNote);
    }
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.generateAndNotify();
  }
  // 他の編集メソッド（ドラッグ移動、長さ変更など）も同様に実装する...
  // ============== 状態取得 (外部API) ==============
  getNotes() {
    return this.notes;
  }
  getMML() {
    return this.generateMML();
  }
  // ============== 設定変更 (外部API) ==============
  setVolume(volume) {
    this.volume = volume;
    this.generateAndNotify();
  }
  // 他の設定メソッド（テンポ、音色など）も同様に実装する...
  // ============== 内部処理 ==============
  generateAndNotify() {
    this.handlers.onNotesChanged([...this.notes]);
    const mml = this.generateMML();
    this.handlers.onMMLGenerated(mml);
  }
  /**
   * 現在のノートデータからMML文字列を生成（和音対応済み）
   */
  generateMML = () => {
    const baseLength = 16;
    const vol = Math.floor(this.volume * 127 / 100);
    let currentMML = `l${baseLength} v${vol} `;
    let currentStep = 0;
    const totalSteps = getRenderConfig().bars * getRenderConfig().stepsPerBar;
    const notesByStep = this.notes.reduce(
      (acc, note) => {
        if (!acc[note.startStep]) {
          acc[note.startStep] = [];
        }
        acc[note.startStep].push(note);
        return acc;
      },
      {}
    );
    const sortedSteps = Object.keys(notesByStep).map(Number).sort((a, b) => a - b);
    sortedSteps.forEach((startStep) => {
      const notesAtStep = notesByStep[startStep];
      const restSteps = startStep - currentStep;
      if (restSteps > 0) {
        currentMML += this.stepToMMLRest(restSteps, baseLength);
      }
      const noteMMLs = notesAtStep.map(
        (note) => (
          // stepToMMLNoteContent は、'o3c4' のような音符の内容のみを返します。
          this.stepToMMLNoteContent(note.pitch, note.durationSteps, baseLength)
        )
      );
      currentMML += `[${noteMMLs.join("")}] `;
      const longestNote = notesAtStep.reduce(
        (a, b) => a.durationSteps > b.durationSteps ? a : b
      );
      currentStep = startStep + longestNote.durationSteps;
    });
    const remainingSteps = totalSteps - currentStep;
    if (remainingSteps > 0) {
      currentMML += this.stepToMMLRest(remainingSteps, baseLength);
    }
    return currentMML.trim();
  };
  stepToMMLRest = (steps, baseLength) => {
    const mmlLength = steps * baseLength / getRenderConfig().stepsPerBar;
    return `r${mmlLength} `;
  };
  stepToMMLNoteContent = (pitch, steps, baseLength) => {
    const octave = Math.floor(pitch / 12) + 1;
    const noteName = PITCH_MAP[pitch % 12];
    const mmlLength = steps * baseLength / getRenderConfig().stepsPerBar;
    return `o${octave}${noteName}${mmlLength}`;
  };
};
export {
  LinkedList,
  MMLCore,
  PITCH_MAP,
  drawGrid,
  drawHeader,
  drawKeyboard,
  drawNotes,
  getRenderConfig,
  getXY,
  init,
  onClick,
  setDrawOffset
};
