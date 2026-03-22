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
var getDrawOffset = () => ({
  x: g_draw_offset_x,
  y: g_draw_offset_y
});
var getGridCanvas = () => g_grid_canvas;
var getGridContext = () => g_grid_ctx;
var getHeaderCanvas = () => g_header_canvas;
var init = (mountTarget, width = 800, height = 450, config) => {
  g_config = config;
  const headerCanvas = document.createElement("canvas");
  g_header_canvas = headerCanvas;
  headerCanvas.width = width - KEYBOARD_WIDTH;
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
  for (let y = startY; y < endY; y += keyHeight) {
    const pitchIndex = keyCount - 1 - y / keyHeight;
    const totalPitch = pitchIndex + g_config.pitchRangeStart;
    const pitchMod12 = totalPitch % 12;
    const octave = Math.floor(totalPitch / 12) - 1;
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
  const { stepWidth, stepsPerBar } = g_config;
  g_header_ctx.save();
  g_header_ctx.translate(-g_draw_offset_x, 0);
  g_header_ctx.fillStyle = "#F9FAFB";
  g_header_ctx.fillRect(
    g_draw_offset_x,
    0,
    g_header_canvas.width,
    HEADER_HEIGHT
  );
  g_header_ctx.strokeStyle = "#D1D5DB";
  g_header_ctx.lineWidth = 1;
  g_header_ctx.font = "bold 12px sans-serif";
  g_header_ctx.fillStyle = "#4B5563";
  const startBar = Math.floor(g_draw_offset_x / (stepsPerBar * stepWidth));
  const endBar = Math.ceil(
    (g_draw_offset_x + g_header_canvas.width) / (stepsPerBar * stepWidth)
  );
  for (let bar = startBar; bar <= endBar + 1; bar++) {
    const x = bar * stepsPerBar * stepWidth;
    const screenX = x;
    g_header_ctx.beginPath();
    g_header_ctx.moveTo(screenX, 0);
    g_header_ctx.lineTo(screenX, HEADER_HEIGHT);
    g_header_ctx.stroke();
    if (bar > 0) {
      g_header_ctx.textAlign = "left";
      g_header_ctx.textBaseline = "middle";
      g_header_ctx.fillText(`${bar}`, screenX + 5, HEADER_HEIGHT / 2);
    }
  }
  g_header_ctx.restore();
};
var drawGrid = (noteLengthSteps = 1) => {
  drawKeyboard();
  drawHeader();
  g_grid_ctx.clearRect(0, 0, g_grid_canvas.width, g_grid_canvas.height);
  const { keyHeight, keyCount, stepWidth, stepsPerBar } = g_config;
  const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
  const endY = g_draw_offset_y + g_grid_canvas.height;
  for (let y = startY; y < endY; y += keyHeight) {
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
  const startX = Math.floor(g_draw_offset_x / (stepWidth * noteLengthSteps)) * stepWidth * noteLengthSteps;
  const endX = g_draw_offset_x + g_grid_canvas.width;
  const lineStep = stepWidth * noteLengthSteps;
  for (let x = startX; x <= endX; x += lineStep) {
    const step = x / stepWidth;
    const isBarLine = step % stepsPerBar === 0;
    const isNoteLine = step % noteLengthSteps === 0;
    const screenX = x - g_draw_offset_x;
    g_grid_ctx.beginPath();
    g_grid_ctx.strokeStyle = isBarLine ? "#A0A0A0" : isNoteLine ? "#D1D5DB" : "#E5E7EB";
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
    const velocityOpacity = note.velocity !== void 0 ? 0.3 + note.velocity / 127 * 0.7 : 1;
    if (color.startsWith("#")) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      g_grid_ctx.fillStyle = `rgba(${r},${g},${b},${velocityOpacity})`;
    } else {
      g_grid_ctx.fillStyle = color;
    }
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
var getGridPosition = (e) => {
  const [x, y] = getXY(e);
  const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;
  const step = Math.floor((x + g_draw_offset_x) / stepWidth);
  const absoluteY = y + g_draw_offset_y;
  const yIndex = Math.floor(absoluteY / keyHeight);
  const pitch = keyCount - 1 - yIndex + pitchRangeStart;
  return { step, pitch, x, y };
};
var onClick = (callback) => {
  g_grid_canvas.addEventListener(
    "click",
    (e) => {
      const [x, y] = getXY(e);
      const { keyCount, pitchRangeStart, keyHeight, stepWidth } = g_config;
      const step = Math.floor((x + g_draw_offset_x) / stepWidth);
      const absoluteY = y + g_draw_offset_y;
      const yIndex = Math.floor(absoluteY / keyHeight);
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
  tempo = 120;
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
        pitch,
        velocity: options.velocity ?? 127
      };
      this.notes.push(newNote);
    }
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.generateAndNotify();
  }
  deleteNoteById(noteId) {
    const index = this.notes.findIndex((n) => n.id === noteId);
    if (index !== -1) {
      this.notes.splice(index, 1);
      this.generateAndNotify();
    }
  }
  getMaxStep() {
    if (this.notes.length === 0) return 0;
    const stepsPer16th = 12;
    const maxRaw = Math.max(
      ...this.notes.map((n) => n.startStep + n.durationSteps)
    );
    return Math.ceil(maxRaw / stepsPer16th) * stepsPer16th;
  }
  moveNote(noteId, startStep, pitch) {
    const note = this.notes.find((target) => target.id === noteId);
    if (!note) return;
    const totalSteps = this.getMaxStep() + getRenderConfig().stepsPerBar;
    const pitchRangeStart = getRenderConfig().pitchRangeStart;
    const pitchRangeEnd = pitchRangeStart + getRenderConfig().keyCount - 1;
    const clampedPitch = Math.min(
      Math.max(pitch, pitchRangeStart),
      pitchRangeEnd
    );
    const clampedStart = Math.min(
      Math.max(startStep, 0),
      totalSteps - note.durationSteps
    );
    note.startStep = clampedStart;
    note.pitch = clampedPitch;
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.generateAndNotify();
  }
  resizeNote(noteId, durationSteps) {
    const note = this.notes.find((target) => target.id === noteId);
    if (!note) return;
    const clampedDuration = Math.max(1, durationSteps);
    note.durationSteps = clampedDuration;
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.generateAndNotify();
  }
  // ============== 状態取得 (外部API) ==============
  getNotes() {
    return this.notes;
  }
  getMML(volumeOverride) {
    return this.generateMML(volumeOverride);
  }
  // ============== 設定変更 (外部API) ==============
  setVolume(volume) {
    this.volume = volume;
    this.generateAndNotify();
  }
  setTempo(tempo) {
    this.tempo = tempo;
    this.generateAndNotify();
  }
  // ============== 内部処理 ==============
  generateAndNotify() {
    this.handlers.onNotesChanged([...this.notes]);
    const mml = this.generateMML();
    this.handlers.onMMLGenerated(mml);
  }
  /**
   * ステップ数から最も近いMML音長数値に変換（スナップ処理）
   */
  stepsToMMLDuration(steps) {
    const config = getRenderConfig();
    const total = config.stepsPerBar;
    const commonDurations = [1, 2, 4, 8, 16, 32, 64, 96, 3, 6, 12, 24, 48];
    let bestDur = 4;
    let minDiff = Infinity;
    for (const d of commonDurations) {
      const targetSteps = total / d;
      const diff = Math.abs(steps - targetSteps);
      if (diff < minDiff) {
        minDiff = diff;
        bestDur = d;
      }
    }
    return bestDur.toString();
  }
  /**
   * ギャップに収まる最大の音符を探す（減算アルゴリズム用）
   */
  findBestFitDuration(gap) {
    const config = getRenderConfig();
    const durations = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64];
    for (const d of durations) {
      const stepLen = config.stepsPerBar / d;
      if (gap >= stepLen) {
        return { dur: d, steps: stepLen };
      }
    }
    return { dur: 64, steps: config.stepsPerBar / 64 };
  }
  /**
   * ピッチからオクターブ最適化のある音名を取得
   */
  getNoteWithOctave(pitch, lastOctave) {
    const octave = Math.floor(pitch / 12) - 1;
    const name = PITCH_MAP[pitch % 12];
    if (lastOctave === -1 || Math.abs(octave - lastOctave) >= 2) {
      return { text: `o${octave}${name}`, currentOctave: octave };
    }
    if (octave === lastOctave) {
      return { text: name, currentOctave: octave };
    } else if (octave === lastOctave + 1) {
      return { text: `>${name}`, currentOctave: octave };
    } else if (octave === lastOctave - 1) {
      return { text: `<${name}`, currentOctave: octave };
    }
    return { text: `o${octave}${name}`, currentOctave: octave };
  }
  /**
   * MML生成（1/2小節パターンスキャン方式）
   */
  generateMML = (volumeOverride) => {
    const config = getRenderConfig();
    const vol = Math.floor((volumeOverride ?? this.volume) * 127 / 100);
    const HALF_BAR = config.stepsPerBar / 2;
    const header = `t${this.tempo} q50 v${vol}`;
    const segments = [];
    let lastOctave = -1;
    let currentCursor = 0;
    if (this.notes.length === 0) return header;
    const lastNote = this.notes[this.notes.length - 1];
    const endStep = lastNote.startStep + lastNote.durationSteps;
    const totalSteps = Math.ceil(endStep / HALF_BAR) * HALF_BAR;
    for (let windowStart = 0; windowStart < totalSteps; windowStart += HALF_BAR) {
      const windowEnd = windowStart + HALF_BAR;
      const windowNotes = this.notes.filter(
        (n) => n.startStep >= windowStart && n.startStep < windowEnd
      );
      if (windowNotes.length === 0) {
        while (currentCursor < windowEnd) {
          const gap = windowEnd - currentCursor;
          if (gap <= 2) {
            currentCursor = windowEnd;
            break;
          }
          const { dur, steps } = this.findBestFitDuration(gap);
          segments.push(`r${dur}`);
          currentCursor += steps;
        }
        continue;
      }
      const notesByStep = /* @__PURE__ */ new Map();
      windowNotes.forEach((n) => {
        const list = notesByStep.get(n.startStep) || [];
        list.push(n);
        notesByStep.set(n.startStep, list);
      });
      const sortedSteps = Array.from(notesByStep.keys()).sort((a, b) => a - b);
      for (let i = 0; i < sortedSteps.length; i++) {
        const startStep = sortedSteps[i];
        const notes = notesByStep.get(startStep);
        while (currentCursor < startStep) {
          const gap = startStep - currentCursor;
          if (gap <= 2) {
            currentCursor = startStep;
            break;
          }
          const { dur, steps } = this.findBestFitDuration(gap);
          segments.push(`r${dur}`);
          currentCursor += steps;
        }
        const nextStart = sortedSteps[i + 1] ?? windowEnd;
        const availableSteps = nextStart - startStep;
        const durStr = this.stepsToMMLDuration(availableSteps);
        if (notes.length > 1) {
          const noteStrs = notes.map((n) => {
            const oct = Math.floor(n.pitch / 12) - 1;
            const name = PITCH_MAP[n.pitch % 12];
            return `o${oct}${name}`;
          });
          segments.push(`[${noteStrs.join("")}]${durStr}`);
          lastOctave = -1;
        } else {
          const { text, currentOctave } = this.getNoteWithOctave(
            notes[0].pitch,
            lastOctave
          );
          segments.push(`${text}${durStr}`);
          lastOctave = currentOctave;
        }
        const actualStep = config.stepsPerBar / parseInt(durStr);
        currentCursor = startStep + actualStep;
      }
      while (currentCursor < windowEnd) {
        const gap = windowEnd - currentCursor;
        if (gap <= 2) {
          currentCursor = windowEnd;
          break;
        }
        const { dur, steps } = this.findBestFitDuration(gap);
        segments.push(`r${dur}`);
        currentCursor += steps;
      }
    }
    return `${header} ${segments.join(" ")}`;
  };
};

// src/piano-roll.ts
var createPianoRoll = (options, handlers) => {
  const {
    mountTarget,
    width = 800,
    height = 450,
    config,
    noteLengthSteps = 1
  } = options;
  init(mountTarget, width, height, config);
  let currentNoteLengthSteps = noteLengthSteps;
  const core = new MMLCore({
    onMMLGenerated: handlers.onMMLGenerated,
    onNotesChanged: (notes) => {
      handlers.onNotesChanged(notes);
      drawGrid();
      drawNotes(notes);
    }
  });
  const getAddNoteOptions = () => ({
    noteLengthSteps: currentNoteLengthSteps
  });
  let suppressClick = false;
  onClick((step, pitch) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    core.toggleNote(step, pitch, getAddNoteOptions());
  });
  const gridCanvas = getGridCanvas();
  const resizeHandleWidth = 6;
  let dragState = null;
  let hasDragged = false;
  const findNoteAtPosition = (x, y) => {
    const { stepWidth, keyHeight, keyCount, pitchRangeStart } = getRenderConfig();
    const offset = getDrawOffset();
    for (const note of core.getNotes()) {
      const logicalX = note.startStep * stepWidth;
      const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
      const logicalY = yIndex * keyHeight;
      const w = note.durationSteps * stepWidth;
      const h = keyHeight;
      const renderX = logicalX - offset.x;
      const renderY = logicalY - offset.y;
      if (x >= renderX && x <= renderX + w && y >= renderY && y <= renderY + h) {
        return note;
      }
    }
    return null;
  };
  const handlePointerMove = (e) => {
    if (!dragState) return;
    hasDragged = true;
    const { step, pitch } = getGridPosition(e);
    if (dragState.mode === "move") {
      const nextStart = step - dragState.dragOffsetStep;
      const nextPitch = pitch - dragState.dragOffsetPitch;
      core.moveNote(dragState.noteId, nextStart, nextPitch);
      return;
    }
    const nextDuration = step - dragState.startStep + 1;
    core.resizeNote(dragState.noteId, nextDuration);
  };
  const endDrag = () => {
    if (dragState) {
      dragState = null;
      if (hasDragged) {
        suppressClick = true;
      }
    }
    hasDragged = false;
  };
  gridCanvas.addEventListener("mousedown", (e) => {
    const { x, y, step, pitch } = getGridPosition(e);
    const note = findNoteAtPosition(x, y);
    if (!note) return;
    const { stepWidth, keyHeight, keyCount, pitchRangeStart } = getRenderConfig();
    const offset = getDrawOffset();
    const logicalX = note.startStep * stepWidth;
    const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
    const logicalY = yIndex * keyHeight;
    const renderX = logicalX - offset.x;
    const renderY = logicalY - offset.y;
    const w = note.durationSteps * stepWidth;
    if (x >= renderX + w - resizeHandleWidth && x <= renderX + w && y >= renderY && y <= renderY + keyHeight) {
      dragState = {
        noteId: note.id,
        mode: "resize",
        dragOffsetStep: 0,
        dragOffsetPitch: 0,
        startStep: note.startStep
      };
      return;
    }
    dragState = {
      noteId: note.id,
      mode: "move",
      dragOffsetStep: step - note.startStep,
      dragOffsetPitch: pitch - note.pitch,
      startStep: note.startStep
    };
  });
  gridCanvas.addEventListener("mouseleave", endDrag);
  document.addEventListener("mouseup", endDrag);
  document.addEventListener("mousemove", handlePointerMove);
  gridCanvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const configValues = getRenderConfig();
      const gridHeight = gridCanvas.height;
      const maxOffsetY = Math.max(
        0,
        configValues.keyCount * configValues.keyHeight - gridHeight
      );
      const currentOffset = getDrawOffset();
      const nextOffsetY = Math.min(
        Math.max(currentOffset.y + e.deltaY, 0),
        maxOffsetY
      );
      setDrawOffset(currentOffset.x, nextOffsetY);
      drawGrid();
      drawNotes(core.getNotes());
    },
    { passive: false }
  );
  const redraw = () => {
    drawGrid();
    drawNotes(core.getNotes());
  };
  redraw();
  return {
    core,
    getNotes: () => core.getNotes(),
    getMML: () => core.getMML(),
    setVolume: (volume) => core.setVolume(volume),
    setNoteLengthSteps: (steps) => {
      currentNoteLengthSteps = steps;
    },
    redraw
  };
};
export {
  LinkedList,
  MMLCore,
  PITCH_MAP,
  createPianoRoll,
  drawGrid,
  drawHeader,
  drawKeyboard,
  drawNotes,
  getDrawOffset,
  getGridCanvas,
  getGridContext,
  getGridPosition,
  getHeaderCanvas,
  getRenderConfig,
  getXY,
  init,
  onClick,
  setDrawOffset
};
