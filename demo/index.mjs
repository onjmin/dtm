// src/audio-config.ts
function createAudioContext() {
  const audioCtx = new AudioContext();
  const gainNode = audioCtx.createGain();
  gainNode.connect(audioCtx.destination);
  const drumGainNode = audioCtx.createGain();
  drumGainNode.connect(audioCtx.destination);
  return { audioCtx, gainNode, drumGainNode };
}
function setupRecorder(audioCtx, gainNode, drumGainNode) {
  let isRecording = false;
  let recordedData = [[], []];
  const recorderProcessor = audioCtx.createScriptProcessor(4096, 2, 2);
  recorderProcessor.onaudioprocess = (e) => {
    if (!isRecording) return;
    const left = e.inputBuffer.getChannelData(0);
    const right = e.inputBuffer.getChannelData(1);
    recordedData[0].push(left.slice());
    recordedData[1].push(right.slice());
  };
  gainNode.connect(recorderProcessor);
  drumGainNode.connect(recorderProcessor);
  recorderProcessor.connect(audioCtx.destination);
  return {
    startRecording: () => {
      isRecording = true;
    },
    stopRecording: () => {
      isRecording = false;
    },
    getRecordedData: () => recordedData,
    isRecording: () => isRecording,
    clearRecordedData: () => {
      recordedData = [[], []];
    }
  };
}
async function fetchSoundFontList(ttl) {
  const res = await fetch(`https://rpgen3.github.io/soundfont/list/${ttl}.txt`);
  const str = await res.text();
  return str.trim().split("\n");
}
async function buildNameToKeyMapping() {
  const nameToKey = {};
  try {
    const fontNames = await fetchSoundFontList("fontName_surikov");
    fontNames.forEach((line) => {
      const [key, ...nameParts] = line.split(" ");
      const name = nameParts.join(" ");
      nameToKey[name] = key;
    });
  } catch (e) {
    console.error("Failed to build name-to-key mapping:", e);
  }
  return nameToKey;
}

// src/drum-config.ts
var DRUM_FONT = "FluidR3_GM_sf2_file";
var DRUM_KEYS = {
  kick: 36,
  snare: 38,
  clap: 39,
  rimshot: 37,
  hihatClosed: 42,
  hihatPedal: 44,
  hihatOpen: 46,
  tomLow: 45,
  tomMid: 47,
  tomHigh: 50,
  crash: 49,
  ride: 51,
  splash: 55,
  tambourine: 54
};
var DRUM_PATTERNS = {
  // 4つ打ち：より重厚に。1拍目の頭にだけ軽くオープンハイハットを混ぜるのもアリ
  "4beat": [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.kick, velocity: 0.9 }
  ],
  // 8ビート：クローズドハイハットに強弱をつけ、スネアにクラップを薄く重ねる
  "8beat": [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 48, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.clap, velocity: 0.6 },
    { step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 144, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 }
  ],
  // 16ビート：キックのダブル（96, 108）を活かしつつ、ハイハットの強弱を細かく設定
  "16beat": [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 12, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 36, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 48, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 60, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 84, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 108, pitch: DRUM_KEYS.kick, velocity: 0.7 },
    { step: 108, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 132, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 144, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 156, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 180, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 }
  ],
  // シャッフル：跳ねるタイミングのベロシティを落として、グルーヴ感を強調
  shuffle: [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 32, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 48, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 80, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 128, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 },
    { step: 144, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.8 },
    { step: 176, pitch: DRUM_KEYS.hihatClosed, velocity: 0.5 }
  ],
  // ダンス/EDM：スネアをClapに変更。キックとハイハットの対比を最大化
  dance: [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 24, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
    { step: 48, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.clap, velocity: 1 },
    { step: 72, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 120, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 },
    { step: 144, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.clap, velocity: 1 },
    { step: 168, pitch: DRUM_KEYS.hihatOpen, velocity: 0.7 }
  ],
  // ボサノバ/チル系：リムショット(37)とハイハットの組み合わせ
  bossa: [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 24, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 48, pitch: DRUM_KEYS.rimshot, velocity: 0.8 },
    { step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 72, pitch: DRUM_KEYS.kick, velocity: 0.7 },
    { step: 72, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 0.9 },
    { step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 120, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 },
    { step: 144, pitch: DRUM_KEYS.rimshot, velocity: 0.8 },
    { step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.6 },
    { step: 168, pitch: DRUM_KEYS.hihatClosed, velocity: 0.4 }
  ],
  // ファンク/ディスコ：タンバリン(54)でスピード感を出す
  disco: [
    { step: 0, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 0, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
    { step: 24, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
    { step: 48, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 48, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
    { step: 72, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
    { step: 96, pitch: DRUM_KEYS.kick, velocity: 1 },
    { step: 96, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
    { step: 120, pitch: DRUM_KEYS.tambourine, velocity: 0.8 },
    { step: 144, pitch: DRUM_KEYS.snare, velocity: 1 },
    { step: 144, pitch: DRUM_KEYS.hihatClosed, velocity: 0.7 },
    { step: 168, pitch: DRUM_KEYS.tambourine, velocity: 0.8 }
  ]
};

// src/instrument-presets.ts
var INSTRUMENT_PRESETS = {
  // --- STANDARD: 汎用性と完成度重視 ---
  piano: {
    displayName: "\u30B0\u30E9\u30F3\u30C9\u30D4\u30A2\u30CE",
    description: "\u6700\u3082\u7834\u7DBB\u3057\u306B\u304F\u3044\u69CB\u6210\u3002\u697D\u66F2\u5236\u4F5C\u306E\u30B9\u30B1\u30C3\u30C1\u306B\u3082\u6700\u9069\u3002",
    melody: "Acoustic Grand Piano",
    submelody: "Vibraphone",
    bass: "Electric Bass (finger)",
    chord: "Pad 2 (warm)"
  },
  acoustic: {
    displayName: "\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF",
    description: "\u751F\u697D\u5668\u306E\u6E29\u304B\u307F\u3092\u91CD\u8996\u3002\u30D5\u30A9\u30FC\u30AF\u3084\u30DD\u30C3\u30D7\u30B9\u306B\u3002",
    melody: "Acoustic Guitar (steel)",
    submelody: "Harmonica",
    bass: "Acoustic Bass",
    chord: "Acoustic Guitar (nylon)"
  },
  jazz_night: {
    displayName: "\u30B8\u30E3\u30BA\u30FB\u30CA\u30A4\u30C8",
    description: "Rhodes\u98A8\u306EEP\u3068\u30A6\u30C3\u30C9\u30D9\u30FC\u30B9\u306B\u3088\u308B\u3001\u5927\u4EBA\u3073\u305F\u30A2\u30F3\u30B5\u30F3\u30D6\u30EB\u3002",
    melody: "Electric Piano 1",
    submelody: "Flute",
    bass: "Acoustic Bass",
    chord: "Electric Guitar (jazz)"
  },
  // --- MODERN & VIBE: エッジの効いた現代的な響き ---
  synth_pop: {
    displayName: "\u30B7\u30F3\u30BB\u30DD\u30C3\u30D7",
    description: "80s\u301C\u73FE\u4EE3\u307E\u3067\u3002\u629C\u3051\u308B\u30EA\u30FC\u30C9\u3068\u592A\u3044\u30D9\u30FC\u30B9\u306E\u738B\u9053\u3002",
    melody: "Lead 2 (sawtooth)",
    submelody: "Lead 4 (chiff)",
    bass: "Synth Bass 2",
    chord: "Pad 3 (polysynth)"
  },
  cyber_punk: {
    displayName: "\u30B5\u30A4\u30D0\u30FC\u30D1\u30F3\u30AF",
    description: "\u30C7\u30B8\u30BF\u30EB\u306A\u51B7\u305F\u3055\u3068\u6B6A\u307F\u304C\u6DF7\u3056\u308A\u5408\u3046\u3001\u672A\u6765\u7684\u306A\u97FF\u304D\u3002",
    melody: "Lead 8 (bass + lead)",
    submelody: "Lead 5 (charang)",
    bass: "Synth Bass 2",
    chord: "Pad 8 (sweep)"
  },
  rock: {
    displayName: "\u30CF\u30FC\u30C9\u30ED\u30C3\u30AF",
    description: "\u6B6A\u307F\u30AE\u30BF\u30FC\u3068\u91CD\u539A\u306A\u30D9\u30FC\u30B9\u3067\u3001\u30D1\u30EF\u30FC\u3092\u524D\u9762\u306B\u3002",
    melody: "Distortion Guitar",
    submelody: "Rock Organ",
    bass: "Electric Bass (pick)",
    chord: "Overdriven Guitar"
  },
  // --- WORLD & CLASSIC: 特定のジャンル・地域 ---
  orchestra: {
    displayName: "\u30AA\u30FC\u30B1\u30B9\u30C8\u30E9",
    description: "\u58EE\u5927\u306A\u7269\u8A9E\u3092\u4E88\u611F\u3055\u305B\u308B\u3001\u7BA1\u5F26\u697D\u5668\u306E\u91CD\u539A\u306A\u97FF\u304D\u3002",
    melody: "French Horn",
    submelody: "Pizzicato Strings",
    bass: "Cello",
    chord: "Tremolo Strings"
  },
  japanese_wa: {
    displayName: "\u548C\u98A8\u30FB\u96C5",
    description: "\u7434\u3068\u4E09\u5473\u7DDA\u306E\u7E4A\u7D30\u306A\u8ABF\u3079\u306B\u3001\u5C3A\u516B\u306E\u60C5\u7DD2\u3092\u6DFB\u3048\u3066\u3002",
    melody: "Koto",
    submelody: "Shamisen",
    bass: "Taiko Drum",
    chord: "Shakuhachi"
  },
  arabic_exotic: {
    displayName: "\u30A8\u30AD\u30BE\u30C1\u30C3\u30AF",
    description: "\u30B7\u30BF\u30FC\u30EB\u3084\u30D0\u30B0\u30D1\u30A4\u30D7\u306B\u3088\u308B\u3001\u7570\u56FD\u60C5\u7DD2\u6EA2\u308C\u308B\u30B5\u30A6\u30F3\u30C9\u3002",
    melody: "Sitar",
    submelody: "Bagpipe",
    bass: "Fretless Bass",
    chord: "Kalimba"
  },
  // --- FANTASY & ATMOSPHERE: 雰囲気と余韻 ---
  fantasy_rpg: {
    displayName: "\u30D5\u30A1\u30F3\u30BF\u30B8\u30FCRPG",
    description: "\u30AA\u30AB\u30EA\u30CA\u3068\u30CF\u30FC\u30D7\u304C\u7D21\u3050\u3001\u5192\u967A\u3068\u9B54\u6CD5\u306E\u4E16\u754C\u89B3\u3002",
    melody: "Ocarina",
    submelody: "Celesta",
    bass: "Timpani",
    chord: "Orchestral Harp"
  },
  ambient_cloud: {
    displayName: "\u30A2\u30F3\u30D3\u30A8\u30F3\u30C8",
    description: "\u8F2A\u90ED\u3092\u307C\u304B\u3057\u305F\u97F3\u8272\u3067\u3001\u6DF1\u3044\u6CA1\u5165\u611F\u3068\u4F59\u97FB\u3092\u6F14\u51FA\u3002",
    melody: "Lead 6 (voice)",
    submelody: "Music Box",
    bass: "Synth Bass 1",
    chord: "Pad 7 (halo)"
  },
  retro_game: {
    displayName: "8-bit \u30EC\u30C8\u30ED",
    description: "\u77E9\u5F62\u6CE2\u3092\u60F3\u8D77\u3055\u305B\u308B\u3001\u521D\u671F\u30B2\u30FC\u30E0\u6A5F\u306E\u3088\u3046\u306A\u61D0\u304B\u3057\u3044\u97FF\u304D\u3002",
    melody: "Lead 1 (square)",
    submelody: "Lead 2 (sawtooth)",
    bass: "Synth Bass 1",
    chord: "Clavinet"
  }
};

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
  /**
   * Undo可能かチェック（カーソル移動なし）
   */
  canUndo() {
    return this.#cursor.prev?.value !== null;
  }
  /**
   * Redo可能かチェック（カーソル移動なし）
   */
  canRedo() {
    const { next } = this.#cursor;
    return next !== null && next.value !== null;
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
  gridCanvas.style.touchAction = "none";
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
    if (bar >= 0) {
      g_header_ctx.textAlign = "left";
      g_header_ctx.textBaseline = "middle";
      g_header_ctx.fillText(`${bar + 1}`, screenX + 5, HEADER_HEIGHT / 2);
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
  const gridStep = noteLengthSteps || 48;
  const startX = Math.floor(g_draw_offset_x / (stepWidth * gridStep)) * stepWidth * gridStep;
  const endX = g_draw_offset_x + g_grid_canvas.width;
  const lineStep = stepWidth * gridStep;
  for (let x = startX; x <= endX; x += lineStep) {
    const step = x / stepWidth;
    const isBarLine = step % stepsPerBar === 0;
    const isNoteLine = step % gridStep === 0;
    const screenX = x - g_draw_offset_x;
    g_grid_ctx.beginPath();
    g_grid_ctx.strokeStyle = isBarLine ? "#A0A0A0" : isNoteLine ? "#D1D5DB" : "#E5E7EB";
    g_grid_ctx.lineWidth = isBarLine ? 2 : 1;
    g_grid_ctx.moveTo(screenX, 0);
    g_grid_ctx.lineTo(screenX, g_grid_canvas.height);
    g_grid_ctx.stroke();
  }
};
var drawNotes = (notes, color = [59, 130, 246, 1]) => {
  const { keyHeight, stepWidth, keyCount, pitchRangeStart } = g_config;
  for (const note of notes) {
    const logicalX = note.startStep * stepWidth;
    const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
    const logicalY = yIndex * keyHeight;
    const w = note.durationSteps * stepWidth;
    const h = keyHeight;
    const renderX = logicalX - g_draw_offset_x;
    const renderY = logicalY - g_draw_offset_y;
    const velocityOpacity = note.velocity !== void 0 ? 0.5 + note.velocity / 127 * 0.5 : 1;
    const [r, g, b, a] = color;
    const finalOpacity = a * velocityOpacity;
    g_grid_ctx.fillStyle = `rgba(${r},${g},${b},${finalOpacity})`;
    g_grid_ctx.fillRect(renderX + 1, renderY + 1, w - 2, h - 2);
  }
};
var drawSelectionRect = (rect) => {
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
var drawSelectedNotes = (notes, selectedIds, baseColor = [59, 130, 246, 1]) => {
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
    const velocityOpacity = note.velocity !== void 0 ? 0.5 + note.velocity / 127 * 0.5 : 1;
    const [r, g, b, a] = baseColor;
    const darkenFactor = 1.3;
    const darkerR = Math.min(255, r * darkenFactor);
    const darkerG = Math.min(255, g * darkenFactor);
    const darkerB = Math.min(255, b * darkenFactor);
    const finalOpacity = a * velocityOpacity;
    g_grid_ctx.fillStyle = `rgba(${darkerR},${darkerG},${darkerB},${finalOpacity})`;
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
var MMLCore = class _MMLCore {
  notes = [];
  nextNoteId = 0;
  handlers;
  volume = 80;
  tempo = 120;
  history = new LinkedList();
  isUndoRedo = false;
  isBatchOperation = false;
  lastHistorySnapshot = "[]";
  lastUndoTime = 0;
  static UNDO_DEBOUNCE_MS = 100;
  toolMode = "pen";
  constructor(handlers, volume = 80) {
    this.handlers = handlers;
    this.volume = volume;
    this.lastHistorySnapshot = JSON.stringify(this.notes);
    this.history.add([]);
    this.generateAndNotify();
  }
  beginBatch() {
    this.isBatchOperation = true;
  }
  endBatch() {
    this.isBatchOperation = false;
    this.saveHistory();
  }
  saveHistory() {
    if (this.isUndoRedo || this.isBatchOperation) {
      return;
    }
    const snapshot = JSON.stringify(this.notes);
    if (snapshot === this.lastHistorySnapshot) {
      console.log("saveHistory: skipped (no change)");
      return;
    }
    this.lastHistorySnapshot = snapshot;
    this.history.add(JSON.parse(snapshot));
    console.log("saveHistory: saved");
  }
  restoreHistory(notes) {
    if (notes === null) return false;
    console.log("restoreHistory: BEFORE - notes =", this.notes.length);
    this.isUndoRedo = true;
    this.notes = JSON.parse(JSON.stringify(notes));
    this.nextNoteId = this.notes.length > 0 ? Math.max(...this.notes.map((n) => n.id)) + 1 : 0;
    this.lastHistorySnapshot = JSON.stringify(this.notes);
    console.log(
      "restoreHistory: AFTER set - notes =",
      this.notes.length,
      "lastSnapshot =",
      this.lastHistorySnapshot
    );
    this.generateAndNotify();
    console.log(
      "restoreHistory: AFTER generateAndNotify - notes =",
      this.notes.length
    );
    this.isUndoRedo = false;
    return true;
  }
  undo() {
    const now = Date.now();
    if (now - this.lastUndoTime < _MMLCore.UNDO_DEBOUNCE_MS) {
      return false;
    }
    this.lastUndoTime = now;
    return this.restoreHistory(this.history.undo());
  }
  redo() {
    const now = Date.now();
    if (now - this.lastUndoTime < _MMLCore.UNDO_DEBOUNCE_MS) {
      return false;
    }
    this.lastUndoTime = now;
    return this.restoreHistory(this.history.redo());
  }
  canUndo() {
    return this.history.canUndo();
  }
  canRedo() {
    return this.history.canRedo();
  }
  setToolMode(mode) {
    this.toolMode = mode;
  }
  getToolMode() {
    return this.toolMode;
  }
  resetHistory() {
    this.history = new LinkedList();
    this.history.add([]);
    this.lastHistorySnapshot = JSON.stringify(this.notes);
  }
  addHistoryOnce() {
    this.lastHistorySnapshot = "[]";
    this.saveHistory();
  }
  clearNotesWithoutHistory() {
    this.notes = [];
    this.nextNoteId = 0;
    this.lastHistorySnapshot = "[]";
  }
  setLoadMode(mode) {
    this.isUndoRedo = mode;
  }
  // ============== ノート編集 (外部API) ==============
  /**
   * 指定されたグリッド位置にノートを追加する操作
   * @param step ステップ位置
   * @param pitch ピッチ番号
   * @param options ノート長などの設定
   */
  addNote(step, pitch, options) {
    const existingIndex = this.notes.findIndex(
      (n) => n.startStep === step && n.pitch === pitch
    );
    if (existingIndex === -1) {
      const newNote = {
        id: this.nextNoteId++,
        startStep: step,
        durationSteps: options.noteLengthSteps,
        pitch,
        velocity: options.velocity ?? 100
      };
      this.notes.push(newNote);
    }
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.saveHistory();
    this.generateAndNotify();
  }
  deleteNoteById(noteId) {
    const index = this.notes.findIndex((n) => n.id === noteId);
    if (index !== -1) {
      this.notes.splice(index, 1);
      this.saveHistory();
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
  moveNoteEnd(_) {
    this.saveHistory();
  }
  resizeNote(noteId, durationSteps) {
    const note = this.notes.find((target) => target.id === noteId);
    if (!note) return;
    const clampedDuration = Math.max(1, durationSteps);
    note.durationSteps = clampedDuration;
    this.notes.sort((a, b) => a.startStep - b.startStep);
    this.generateAndNotify();
  }
  resizeNoteEnd(_) {
    this.saveHistory();
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
   * 近似値を許容して単一音符を決定する。
   * ただし、残りステップ(limit)は絶対に超えない。
   */
  stepsToMMLDuration(steps, limit) {
    const config = getRenderConfig();
    const total = config.stepsPerBar;
    const candidates = [
      { dur: "1", s: total / 1 },
      { dur: "2.", s: total / 2 * 1.5 },
      { dur: "2", s: total / 2 },
      { dur: "4.", s: total / 4 * 1.5 },
      { dur: "4", s: total / 4 },
      { dur: "8.", s: total / 8 * 1.5 },
      { dur: "8", s: total / 8 },
      { dur: "12", s: total / 12 },
      { dur: "16.", s: total / 16 * 1.5 },
      { dur: "16", s: total / 16 },
      { dur: "24", s: total / 24 },
      // 3連8分 (24step)
      { dur: "32", s: total / 32 },
      { dur: "64", s: total / 64 }
    ];
    let bestDur = "64";
    let minDiff = Infinity;
    for (const cand of candidates) {
      if (cand.s > limit) continue;
      const diff = Math.abs(steps - cand.s);
      if (diff < minDiff) {
        minDiff = diff;
        bestDur = cand.dur;
      }
    }
    return bestDur;
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
    const vol = volumeOverride ?? this.volume;
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
        if (!notes) continue;
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
        const physicsLimit = nextStart - currentCursor;
        const MIN_STEP = config.stepsPerBar / 64;
        if (physicsLimit < MIN_STEP) {
          console.warn(`Note skipped: No space available at step ${startStep}`);
          currentCursor = startStep;
          continue;
        }
        const idealDuration = notes[0].durationSteps;
        const durStr = this.stepsToMMLDuration(idealDuration, physicsLimit);
        const actualStepGenerated = this.getStepFromDottedMML(durStr);
        if (notes.length > 1) {
          const noteStrs = notes.map((n) => {
            const oct = Math.floor(n.pitch / 12) - 1;
            const name = PITCH_MAP[n.pitch % 12];
            return `o${oct}${name}`;
          });
          segments.push(`[${noteStrs.join("")}]${durStr}`);
        } else {
          const { text, currentOctave } = this.getNoteWithOctave(
            notes[0].pitch,
            lastOctave
          );
          segments.push(`${text}${durStr}`);
          lastOctave = currentOctave;
        }
        currentCursor += actualStepGenerated;
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
  /**
   * MMLの音長文字列（"4", "4.", "12"など）をステップ数に変換する
   */
  getStepFromDottedMML(durStr) {
    const config = getRenderConfig();
    const total = config.stepsPerBar;
    const isDotted = durStr.endsWith(".");
    const baseDur = parseInt(isDotted ? durStr.slice(0, -1) : durStr, 10);
    const baseStep = total / baseDur;
    return isDotted ? baseStep * 1.5 : baseStep;
  }
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
  let selectionRect = null;
  let isSelecting = false;
  let selectionStart = null;
  let selectedNotes = [];
  let copiedNotes = [];
  const core = new MMLCore({
    onMMLGenerated: handlers.onMMLGenerated,
    onNotesChanged: (notes) => {
      handlers.onNotesChanged(notes);
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
    const mode = core.getToolMode();
    if (mode === "pen") {
      core.addNote(step, pitch, getAddNoteOptions());
      handlers.onNoteClick?.(step, pitch, false);
    } else if (mode === "eraser") {
      const notes = core.getNotes();
      const note = notes.find(
        (n) => n.startStep <= step && step < n.startStep + n.durationSteps && n.pitch === pitch
      );
      if (note) {
        core.deleteNoteById(note.id);
        handlers.onNoteClick?.(step, pitch, true);
      }
    }
  });
  const gridCanvas = getGridCanvas();
  const resizeHandleWidth = 6;
  let dragState = null;
  let hasDragged = false;
  let lastPreviewPitch = null;
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
    if (core.getToolMode() === "select" && isSelecting && selectionStart) {
      const { x, y } = getGridPosition(e);
      const minX = Math.min(x, selectionStart.x);
      const minY = Math.min(y, selectionStart.y);
      const width2 = Math.abs(x - selectionStart.x);
      const height2 = Math.abs(y - selectionStart.y);
      selectionRect = { x: minX, y: minY, width: width2, height: height2 };
      selectedNotes = getNotesInRect(selectionRect);
      redraw();
      return;
    }
    if (!dragState) return;
    hasDragged = true;
    const { step, pitch } = getGridPosition(e);
    if (dragState.mode === "move") {
      if (dragState.selectedNotes && dragState.selectedNotes.length > 0) {
        const noteId = dragState.noteId;
        const baseNote = dragState.selectedNotes.find((n) => n.id === noteId);
        if (!baseNote) return;
        const nextStart2 = step - dragState.dragOffsetStep;
        const nextPitch2 = pitch - dragState.dragOffsetPitch;
        const stepDelta = nextStart2 - baseNote.startStep;
        const pitchDelta = nextPitch2 - baseNote.pitch;
        for (const note of dragState.selectedNotes) {
          const newStart = note.startStep + stepDelta;
          const newPitch = note.pitch + pitchDelta;
          core.moveNote(note.id, newStart, newPitch);
        }
        if (options.onPreviewSound && pitch !== lastPreviewPitch) {
          lastPreviewPitch = pitch;
          options.onPreviewSound(pitch, step);
        }
        redraw();
        return;
      }
      const nextStart = step - dragState.dragOffsetStep;
      const nextPitch = pitch - dragState.dragOffsetPitch;
      core.moveNote(dragState.noteId, nextStart, nextPitch);
      return;
    }
    const nextDuration = step - dragState.startStep + 1;
    core.resizeNote(dragState.noteId, nextDuration);
  };
  const endDrag = () => {
    const wasSelectMode = core.getToolMode() === "select";
    if (wasSelectMode) {
      isSelecting = false;
      selectionStart = null;
    }
    if (dragState) {
      dragState = null;
      if (hasDragged) {
        suppressClick = true;
      }
    }
    hasDragged = false;
    if (wasSelectMode) {
      selectionRect = null;
      redraw();
    }
  };
  gridCanvas.addEventListener("pointerdown", (e) => {
    const { x, y, step, pitch } = getGridPosition(e);
    const currentMode = core.getToolMode();
    if (currentMode === "select") {
      const clickedNote = findNoteAtPosition(x, y);
      if (selectionRect && clickedNote) {
        const notesInRect = getNotesInRect(selectionRect);
        if (notesInRect.some((n) => n.id === clickedNote.id)) {
          dragState = {
            noteId: clickedNote.id,
            mode: "move",
            dragOffsetStep: step - clickedNote.startStep,
            dragOffsetPitch: pitch - clickedNote.pitch,
            startStep: clickedNote.startStep,
            selectedNotes: notesInRect
            // 複数選択ノートを保存
          };
          isSelecting = false;
          selectionStart = null;
          return;
        }
      }
      selectedNotes = [];
      selectionRect = null;
      isSelecting = true;
      selectionStart = { x, y, step, pitch };
      return;
    }
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
  gridCanvas.addEventListener("pointerleave", endDrag);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointermove", handlePointerMove);
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
    if (core.getToolMode() === "select") {
      drawSelectionRect(selectionRect);
      if (selectedNotes.length > 0) {
        const selectedIds = new Set(selectedNotes.map((n) => n.id));
        drawSelectedNotes(core.getNotes(), selectedIds);
      }
    }
  };
  const getNotesInRect = (rect) => {
    const { stepWidth, keyHeight, keyCount, pitchRangeStart } = getRenderConfig();
    const offset = getDrawOffset();
    const notes = [];
    for (const note of core.getNotes()) {
      const logicalX = note.startStep * stepWidth;
      const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
      const logicalY = yIndex * keyHeight;
      const noteRect = {
        x: logicalX - offset.x,
        y: logicalY - offset.y,
        width: note.durationSteps * stepWidth,
        height: keyHeight
      };
      if (rect.x < noteRect.x + noteRect.width && rect.x + rect.width > noteRect.x && rect.y < noteRect.y + noteRect.height && rect.y + rect.height > noteRect.y) {
        notes.push(note);
      }
    }
    return notes;
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
    redraw,
    setToolMode: (mode) => {
      core.setToolMode(mode);
      if (mode !== "select") {
        selectionRect = null;
        selectedNotes = [];
      }
    },
    getToolMode: () => core.getToolMode(),
    getSelectionRect: () => selectionRect,
    getNotesInRect,
    clearSelection: () => {
      selectionRect = null;
      selectedNotes = [];
    },
    copySelection: () => {
      copiedNotes = [...selectedNotes];
      return copiedNotes;
    },
    pasteNotes: (_, startStep) => {
      if (copiedNotes.length === 0) return;
      const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
      copiedNotes.forEach((note) => {
        const newStep = startStep + (note.startStep - minStart);
        core.addNote(newStep, note.pitch, {
          noteLengthSteps: note.durationSteps,
          velocity: note.velocity
        });
      });
    }
  };
};
export {
  DRUM_FONT,
  DRUM_KEYS,
  DRUM_PATTERNS,
  INSTRUMENT_PRESETS,
  LinkedList,
  MMLCore,
  PITCH_MAP,
  buildNameToKeyMapping,
  createAudioContext,
  createPianoRoll,
  drawGrid,
  drawHeader,
  drawKeyboard,
  drawNotes,
  drawSelectedNotes,
  drawSelectionRect,
  fetchSoundFontList,
  getDrawOffset,
  getGridCanvas,
  getGridContext,
  getGridPosition,
  getHeaderCanvas,
  getRenderConfig,
  getXY,
  init,
  onClick,
  setDrawOffset,
  setupRecorder
};
