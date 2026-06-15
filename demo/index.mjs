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

// src/chords.ts
var C3 = 48;
var buildChordPlacements = (options) => {
  const {
    chordStr,
    patternType,
    rootShift,
    bpm,
    stepsPerBar,
    parseChord,
    parseChords
  } = options;
  const placements = [];
  if (!chordStr.trim()) return placements;
  const offset = rootShift;
  const chordLength = stepsPerBar;
  let chordData = [];
  try {
    chordData = parseChords(chordStr, bpm);
  } catch {
    chordData = [];
  }
  if (chordData.length > 0) {
    const secondsPerBar = 60 / bpm * 4;
    const secondsPerStep = secondsPerBar / stepsPerBar;
    const chordGroups = {};
    for (const chord of chordData) {
      const whenStep = Math.floor(chord.when / secondsPerStep);
      const durationSteps = Math.floor(chord.duration / secondsPerStep);
      if (!chordGroups[whenStep]) chordGroups[whenStep] = [];
      chordGroups[whenStep].push({
        key: chord.key,
        chord: chord.chord,
        whenStep,
        durationSteps
      });
    }
    for (const group of Object.values(chordGroups)) {
      for (const chord of group) {
        let notes;
        try {
          notes = [...parseChord(`${chord.key}${chord.chord}`).value];
        } catch {
          continue;
        }
        const noteLength = chord.durationSteps;
        if (patternType === "block") {
          for (const noteOffset of notes) {
            placements.push({
              startStep: chord.whenStep,
              pitch: C3 + noteOffset + offset,
              durationSteps: noteLength,
              velocity: 100
            });
          }
        } else if (patternType === "arpeggio") {
          const arpInterval = Math.floor(noteLength / notes.length);
          notes.forEach((noteOffset, i) => {
            placements.push({
              startStep: chord.whenStep + i * arpInterval,
              pitch: C3 + noteOffset + offset,
              durationSteps: noteLength - i * arpInterval,
              velocity: 100
            });
          });
        } else if (patternType === "arpeggio-fast") {
          const arpInterval = 6;
          notes.forEach((noteOffset, i) => {
            placements.push({
              startStep: chord.whenStep + i * arpInterval,
              pitch: C3 + noteOffset + offset,
              durationSteps: Math.max(12, noteLength - i * arpInterval),
              velocity: 100
            });
          });
        } else if (patternType === "offbeat") {
          const stepsPerQuarter = Math.floor(stepsPerBar / 4);
          const halfBeat = Math.floor(stepsPerQuarter / 2);
          for (let beat = 0; beat < 4; beat++) {
            const syncopatedStep = chord.whenStep + beat * stepsPerQuarter + halfBeat;
            if (syncopatedStep < chord.whenStep + noteLength) {
              for (const noteOffset of notes) {
                placements.push({
                  startStep: syncopatedStep,
                  pitch: C3 + noteOffset + offset,
                  durationSteps: Math.min(halfBeat, 12),
                  velocity: 100
                });
              }
            }
          }
        } else if (patternType === "yatsume") {
          const ticksPerQuarter = 480;
          const stepsPerQuarter = Math.floor(stepsPerBar / 4);
          const tickToStep = (tick) => Math.max(1, Math.round(tick * stepsPerQuarter / ticksPerQuarter));
          const yatsumeTickOffsets = [0, 360, 960, 1320];
          const yatsumeLengthSteps = tickToStep(360);
          for (const tickOffset of yatsumeTickOffsets) {
            const noteStart = chord.whenStep + tickToStep(tickOffset);
            if (noteStart < chord.whenStep + noteLength) {
              for (const noteOffset of notes) {
                placements.push({
                  startStep: noteStart,
                  pitch: C3 + noteOffset + offset,
                  durationSteps: yatsumeLengthSteps,
                  velocity: 100
                });
              }
            }
          }
        } else if (patternType === "alternating") {
          notes.forEach((noteOffset, i) => {
            const stepOffset = i * Math.floor(stepsPerBar / 4);
            placements.push({
              startStep: chord.whenStep + stepOffset,
              pitch: C3 + noteOffset + offset,
              durationSteps: Math.max(12, Math.floor(stepsPerBar / 4)),
              velocity: 100
            });
          });
        }
      }
    }
  } else {
    const chordNames = chordStr.split(/[\s,]+/).filter((c) => c);
    chordNames.forEach((chordName, barIndex) => {
      let notes;
      try {
        notes = [...parseChord(chordName).value];
      } catch {
        return;
      }
      if (notes.length === 0) return;
      const startStep = barIndex * chordLength;
      notes.forEach((noteOffset, i) => {
        const stepOffset = i * 2;
        placements.push({
          startStep: startStep + stepOffset,
          pitch: C3 + noteOffset + offset,
          durationSteps: chordLength - stepOffset,
          velocity: 100
        });
      });
    });
  }
  return placements;
};

// src/icons.ts
var ICONS = {
  play: { d: "M8 5v14l11-7z" },
  pause: { d: "M6 5h4v14H6zm8 0h4v14h-4z" },
  stop: { d: "M6 6h12v12H6z" },
  record: { d: "M12 6a6 6 0 100 12 6 6 0 000-12z" },
  undo: { d: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6", stroke: true },
  redo: { d: "M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6", stroke: true },
  chevronUp: { d: "M5 15l7-7 7 7", stroke: true },
  chevronDown: { d: "M19 9l-7 7-7-7", stroke: true },
  chevronLeft: { d: "M15 19l-7-7 7-7", stroke: true },
  chevronRight: { d: "M9 5l7 7-7 7", stroke: true },
  first: { d: "M18 18l-6-6 6-6M11 18l-6-6 6-6", stroke: true },
  copy: {
    d: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
    stroke: true
  },
  pen: {
    d: "M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75 1.84-1.83zM3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z"
  },
  eraser: {
    d: "M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 01-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z"
  },
  select: {
    d: "M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2M4 11v2M20 11v2M11 4h2M11 20h2",
    stroke: true
  },
  settings: {
    d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
    stroke: true
  }
};
var icon = (name, size = 20) => {
  const def = ICONS[name];
  if (!def) return "";
  const paint = def.stroke ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : 'fill="currentColor"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${paint} aria-hidden="true"><path d="${def.d}"/></svg>`;
};

// src/daw-ui.ts
var q = (root, sel) => root.querySelector(sel);
var buildUI = (target, options) => {
  const { drumPatternNames, defaultDrumPattern, defaultBpm, showMidi } = options;
  const drumOptions = [`<option value="none">\u306A\u3057</option>`].concat(
    drumPatternNames.map(
      (name) => `<option value="${name}" ${name === defaultDrumPattern ? "selected" : ""}>${name}</option>`
    )
  ).join("");
  target.innerHTML = `
<div class="dtm-daw" data-dtm="root">
  <div class="dtm-topbar" data-dtm="transport">
    <button class="dtm-play" data-dtm="play" disabled>${icon("play")}<span>\u8A66\u8074</span></button>
    <button class="dtm-iconbtn dtm-rec" data-dtm="rec" title="\u9332\u97F3">${icon("record")}</button>
    <label class="dtm-toggle"><input type="checkbox" data-dtm="solo"><span>\u30BD\u30ED</span></label>
    <span class="dtm-grow"></span>
    <span class="dtm-label">BPM</span>
    <input type="number" class="dtm-input dtm-input--num" data-dtm="bpm" value="${defaultBpm}" min="20" max="300">
  </div>

  <div class="dtm-tooldock">
    <div class="dtm-seg">
      <button class="dtm-segbtn dtm-segbtn--active" data-dtm="tool-pen" title="\u30DA\u30F3">${icon("pen")}</button>
      <button class="dtm-segbtn" data-dtm="tool-select" title="\u9078\u629E">${icon("select")}</button>
      <button class="dtm-segbtn" data-dtm="tool-eraser" title="\u6D88\u3057\u30B4\u30E0">${icon("eraser")}</button>
    </div>
    <button class="dtm-iconbtn" data-dtm="undo" title="\u5143\u306B\u623B\u3059" disabled>${icon("undo")}</button>
    <button class="dtm-iconbtn" data-dtm="redo" title="\u3084\u308A\u76F4\u3057" disabled>${icon("redo")}</button>
    <select class="dtm-select dtm-grow" data-dtm="note-length" title="\u97F3\u7B26\u306E\u9577\u3055">
      <option value="48">4\u5206</option>
      <option value="32">3\u90234</option>
      <option value="24">8\u5206</option>
      <option value="16">3\u90238</option>
      <option value="12" selected>16\u5206</option>
      <option value="8">3\u902316</option>
      <option value="6">32\u5206</option>
      <option value="4">3\u902332</option>
    </select>
  </div>

  <div class="dtm-tracks" data-dtm="track-tabs"></div>

  <div class="dtm-roll-wrap">
    <div class="dtm-roll" data-dtm="roll"><div data-dtm="wrapper" style="position:absolute;inset:0;"></div></div>
    <div class="dtm-vscroll" data-dtm="vscroll"><div class="dtm-vscroll-thumb" data-dtm="vscroll-thumb"></div></div>
  </div>
  <div class="dtm-hscroll" data-dtm="hscroll"><div class="dtm-hscroll-thumb" data-dtm="hscroll-thumb"></div></div>

  <details class="dtm-panel" open>
    <summary>\u30C8\u30E9\u30C3\u30AF\u8A2D\u5B9A</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">\u5168\u4F53\u97F3\u91CF</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="master-volume" value="50" min="0" max="100">
        <span class="dtm-label" data-dtm="master-volume-label">50%</span>
      </div>
      <div class="dtm-track-body" data-dtm="track-body"></div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>\u8868\u793A</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">\u6A2A\u30BA\u30FC\u30E0</span>
        <button class="dtm-iconbtn" data-dtm="zoomx-out" title="\u7E2E\u5C0F">\u2212</button>
        <span class="dtm-label" data-dtm="zoomx-label">100%</span>
        <button class="dtm-iconbtn" data-dtm="zoomx-in" title="\u62E1\u5927">\uFF0B</button>
      </div>
      <div class="dtm-row">
        <span class="dtm-label">\u7E26\u30BA\u30FC\u30E0</span>
        <button class="dtm-iconbtn" data-dtm="zoomy-out" title="\u7E2E\u5C0F">\u2212</button>
        <span class="dtm-label" data-dtm="zoomy-label">100%</span>
        <button class="dtm-iconbtn" data-dtm="zoomy-in" title="\u62E1\u5927">\uFF0B</button>
      </div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>\u30C9\u30E9\u30E0\u8A2D\u5B9A</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">\u30EA\u30BA\u30E0</span>
        <select class="dtm-select" data-dtm="drum-select">${drumOptions}</select>
      </div>
      <div class="dtm-row">
        <span class="dtm-label">\u97F3\u91CF</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="drum-volume" value="80" min="0" max="100">
        <span class="dtm-label" data-dtm="drum-volume-label">80%</span>
      </div>
    </div>
  </details>

  <details class="dtm-panel ${showMidi ? "" : "dtm-hidden"}" data-dtm="midi-panel">
    <summary>MIDI / MML \u5165\u529B</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">MIDI</span>
        <input type="file" class="dtm-input dtm-grow" accept=".mid,.midi" data-dtm="midi-input">
        <button class="dtm-btn dtm-btn--success" data-dtm="midi-load">\u8AAD\u8FBC</button>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="midi-track-selection"></div>
      <div class="dtm-row">
        <span class="dtm-label">MML</span>
        <textarea class="dtm-textarea" data-dtm="mml-input" placeholder="MML\u3092\u5165\u529B"></textarea>
      </div>
      <div class="dtm-row">
        <button class="dtm-btn dtm-btn--primary" data-dtm="mml-load">MML\u8AAD\u8FBC</button>
        <span class="dtm-label">\u5168\u4F53\u30B7\u30D5\u30C8</span>
        <select class="dtm-select" data-dtm="shift-select">
          <option value="-96">-2\u5206</option>
          <option value="-48">-4\u5206</option>
          <option value="-24">-8\u5206</option>
          <option value="-12">-16\u5206</option>
          <option value="12">+16\u5206</option>
          <option value="24">+8\u5206</option>
          <option value="48">+4\u5206</option>
          <option value="96">+2\u5206</option>
        </select>
        <button class="dtm-btn dtm-btn--primary" data-dtm="shift-apply">\u9069\u7528</button>
      </div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>\u30DE\u30AF\u30ED</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <button class="dtm-btn dtm-btn--danger" data-dtm="macro-clear">\u5168\u6D88\u53BB</button>
        <button class="dtm-btn dtm-btn--accent" data-dtm="macro-random">\u30E9\u30F3\u30C0\u30E0\u914D\u7F6E</button>
        <button class="dtm-btn dtm-btn--primary" data-dtm="macro-harmonic">\u4F34\u594F\u30D5\u30A3\u30EB\u30BF</button>
        <button class="dtm-btn dtm-btn--primary" data-dtm="macro-mono">\u5358\u97F3\u5316</button>
      </div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>MIDI / MML \u51FA\u529B</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <button class="dtm-btn dtm-btn--accent" data-dtm="export-midi">MIDI\u51FA\u529B</button>
        <button class="dtm-btn dtm-btn--success" data-dtm="generate-mml">MML\u751F\u6210</button>
      </div>
      <div class="dtm-output dtm-hidden" data-dtm="output-container">
        <p class="dtm-label" data-dtm="output-status"></p>
        <div class="dtm-output-row">
          <pre><code data-dtm="output-full"></code></pre>
          <button class="dtm-btn dtm-btn--primary dtm-btn--icon" data-dtm="copy-full" title="\u30B3\u30D4\u30FC">${icon("copy")}</button>
        </div>
        <div class="dtm-output-row">
          <pre><code data-dtm="output-mini"></code></pre>
          <button class="dtm-btn dtm-btn--primary dtm-btn--icon" data-dtm="copy-mini" title="\u30B3\u30D4\u30FC">${icon("copy")}</button>
        </div>
      </div>
    </div>
  </details>

  <div class="dtm-overlay" data-dtm="overlay" hidden><div class="dtm-spinner"></div></div>
</div>`;
  const root = q(target, '[data-dtm="root"]');
  const sel = (name) => q(root, `[data-dtm="${name}"]`);
  return {
    root,
    playBtn: sel("play"),
    recBtn: sel("rec"),
    soloCheckbox: sel("solo"),
    toolPen: sel("tool-pen"),
    toolSelect: sel("tool-select"),
    toolEraser: sel("tool-eraser"),
    undoBtn: sel("undo"),
    redoBtn: sel("redo"),
    noteLengthSelect: sel("note-length"),
    bpmInput: sel("bpm"),
    zoomXLabel: sel("zoomx-label"),
    zoomYLabel: sel("zoomy-label"),
    zoomXIn: sel("zoomx-in"),
    zoomXOut: sel("zoomx-out"),
    zoomYIn: sel("zoomy-in"),
    zoomYOut: sel("zoomy-out"),
    rollContainer: sel("roll"),
    wrapper: sel("wrapper"),
    vScroll: sel("vscroll"),
    vScrollThumb: sel("vscroll-thumb"),
    hScroll: sel("hscroll"),
    hScrollThumb: sel("hscroll-thumb"),
    masterVolume: sel("master-volume"),
    masterVolumeLabel: sel("master-volume-label"),
    trackTabs: sel("track-tabs"),
    trackBody: sel("track-body"),
    drumSelect: sel("drum-select"),
    drumVolume: sel("drum-volume"),
    drumVolumeLabel: sel("drum-volume-label"),
    midiInput: sel("midi-input"),
    midiLoadBtn: sel("midi-load"),
    midiTrackSelection: sel("midi-track-selection"),
    midiPanel: sel("midi-panel"),
    mmlInput: sel("mml-input"),
    mmlLoadBtn: sel("mml-load"),
    shiftSelect: sel("shift-select"),
    shiftApplyBtn: sel("shift-apply"),
    macroClear: sel("macro-clear"),
    macroRandom: sel("macro-random"),
    macroHarmonic: sel("macro-harmonic"),
    macroMono: sel("macro-mono"),
    exportMidiBtn: sel("export-midi"),
    generateMmlBtn: sel("generate-mml"),
    outputContainer: sel("output-container"),
    outputStatus: sel("output-status"),
    outputFull: sel("output-full"),
    outputMini: sel("output-mini"),
    copyFullBtn: sel("copy-full"),
    copyMiniBtn: sel("copy-mini"),
    overlay: sel("overlay")
  };
};

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

// src/macros.ts
var SCALES = [
  [0, 2, 4, 5, 7, 9, 11],
  // Major
  [0, 2, 3, 5, 7, 8, 10],
  // Minor
  [0, 2, 4, 7, 9]
  // Pentatonic Major
];
var generateRandomPattern = (core, options) => {
  const { stepsPerBar, startStep, pitchRangeStart } = options;
  const numBars = 8;
  const noteLength = 24;
  const basePitch = pitchRangeStart + 60;
  const scale = SCALES[Math.floor(Math.random() * SCALES.length)];
  const rootOffset = Math.floor(Math.random() * 12);
  const availablePitches = [];
  for (let i = 0; i < 12; i++) {
    const noteInOctave = (i - rootOffset + 12) % 12;
    if (scale.includes(noteInOctave)) availablePitches.push(basePitch + i);
  }
  core.beginBatch();
  for (let bar = 0; bar < numBars; bar++) {
    const barStart = startStep + bar * stepsPerBar;
    const numNotes = Math.floor(Math.random() * 4) + 2;
    const occupied = /* @__PURE__ */ new Set();
    for (let i = 0; i < numNotes; i++) {
      const stepInRange = Math.floor(Math.random() * (stepsPerBar / noteLength)) * noteLength;
      const step = barStart + stepInRange;
      if (occupied.has(step)) continue;
      occupied.add(step);
      const pitch = availablePitches[Math.floor(Math.random() * availablePitches.length)];
      core.addNote(step, pitch, { noteLengthSteps: noteLength });
    }
  }
  core.endBatch();
  core.saveHistory();
};
var applyHarmonicFilter = (targetCore, chordCore, options) => {
  const halfStepsPerBar = options.stepsPerBar / 2;
  const allNotes = targetCore.getNotes().concat(chordCore.getNotes());
  if (allNotes.length === 0) return;
  const maxStep = Math.max(
    ...allNotes.map((n) => n.startStep + n.durationSteps)
  );
  const numHalfBars = Math.ceil(maxStep / halfStepsPerBar);
  let currentClasses = /* @__PURE__ */ new Set();
  targetCore.beginBatch();
  for (let halfBar = 0; halfBar < numHalfBars; halfBar++) {
    const start = halfBar * halfStepsPerBar;
    const end = start + halfStepsPerBar;
    const isNewBar = halfBar % 2 === 0;
    const chordHere = chordCore.getNotes().filter((n) => n.startStep >= start && n.startStep < end);
    if (chordHere.length > 0) {
      currentClasses = new Set(chordHere.map((n) => n.pitch % 12));
    } else if (isNewBar) {
      currentClasses = /* @__PURE__ */ new Set();
    }
    if (currentClasses.size === 0) continue;
    const activeHere = targetCore.getNotes().filter((n) => n.startStep >= start && n.startStep < end);
    for (const n of activeHere) {
      if (!currentClasses.has(n.pitch % 12)) targetCore.deleteNoteById(n.id);
    }
  }
  targetCore.endBatch();
  targetCore.saveHistory();
};
var applyMonophonic = (targetCore, chordCore, options) => {
  const halfStepsPerBar = options.stepsPerBar / 2;
  const allNotes = targetCore.getNotes().concat(chordCore.getNotes());
  if (allNotes.length === 0) return;
  const maxStep = Math.max(
    ...allNotes.map((n) => n.startStep + n.durationSteps)
  );
  const numHalfBars = Math.ceil(maxStep / halfStepsPerBar);
  let currentClasses = /* @__PURE__ */ new Set();
  targetCore.beginBatch();
  for (let halfBar = 0; halfBar < numHalfBars; halfBar++) {
    const start = halfBar * halfStepsPerBar;
    const end = start + halfStepsPerBar;
    const isNewBar = halfBar % 2 === 0;
    const chordHere = chordCore.getNotes().filter((n) => n.startStep >= start && n.startStep < end);
    if (chordHere.length > 0) {
      currentClasses = new Set(chordHere.map((n) => n.pitch % 12));
    } else if (isNewBar) {
      currentClasses = /* @__PURE__ */ new Set();
    }
    if (currentClasses.size === 0) continue;
    const activeHere = targetCore.getNotes().filter((n) => n.startStep >= start && n.startStep < end);
    const filtered = activeHere.filter((n) => currentClasses.has(n.pitch % 12));
    const filteredIds = new Set(filtered.map((n) => n.id));
    for (const n of activeHere) {
      if (!filteredIds.has(n.id)) targetCore.deleteNoteById(n.id);
    }
    const timeMap = /* @__PURE__ */ new Map();
    for (const n of filtered) {
      if (!timeMap.has(n.startStep)) timeMap.set(n.startStep, []);
      timeMap.get(n.startStep)?.push(n);
    }
    for (const notesAtTime of timeMap.values()) {
      if (notesAtTime.length > 1) {
        notesAtTime.sort((a, b) => b.pitch - a.pitch);
        const [, ...others] = notesAtTime;
        for (const on of others) targetCore.deleteNoteById(on.id);
      }
    }
  }
  targetCore.endBatch();
  targetCore.saveHistory();
};
var shiftNotes = (cores, shiftSteps) => {
  if (shiftSteps === 0) return;
  for (const core of cores) {
    const notes = [...core.getNotes()];
    for (const note of notes) {
      const newStart = note.startStep + shiftSteps;
      if (newStart < 0) core.deleteNoteById(note.id);
      else core.moveNote(note.id, newStart, note.pitch);
    }
  }
};

// src/midi-io.ts
var STEPS_PER_BEAT = 48;
var analyzeMidiTracks = (midi) => {
  const { track } = midi;
  const result = [];
  for (let i = 0; i < track.length; i++) {
    const notes = [];
    let currentTime = 0;
    for (const event of track[i].event) {
      currentTime += event.deltaTime;
      const data = event.data;
      if (event.type === 9 && data && data[1]) {
        notes.push({ pitch: data[0] });
      } else if (event.type === 8) {
        for (let k = notes.length - 1; k >= 0; k--) {
          if (notes[k].pitch === data[0] && notes[k].end === void 0) {
            notes[k].end = currentTime;
            break;
          }
        }
      }
    }
    const validNotes = notes.filter((n) => n.end !== void 0);
    result.push({
      index: i,
      name: `Ch${i}`,
      noteCount: validNotes.length,
      selected: validNotes.length > 0
    });
  }
  return result;
};
var getMidiBPM = (midi) => {
  const { track } = midi;
  for (const { event } of track) {
    for (const { type, metaType, data } of event) {
      if (type !== 255 || metaType !== 81) continue;
      if (typeof data === "number") {
        return 6e7 / data;
      }
      const [b1, b2, b3] = data;
      return 6e7 / (b1 << 16 | b2 << 8 | b3);
    }
  }
  return 120;
};
var extractMidiPlacements = (midi, selectedTrackIndices) => {
  const { track, timeDivision } = midi;
  const ticksPerBeat = timeDivision;
  const bpm = getMidiBPM(midi);
  const channelNotes = {};
  for (const trackIdx of selectedTrackIndices) {
    const trackData = track[trackIdx];
    if (!trackData) continue;
    let currentTime = 0;
    for (const event of trackData.event) {
      currentTime += event.deltaTime;
      if (event.channel === 9) continue;
      if (event.type !== 8 && event.type !== 9) continue;
      const [pitch, velocity] = event.data;
      const isNoteOff = event.type === 8 || !velocity;
      const channel = event.channel ?? 0;
      if (!channelNotes[channel]) channelNotes[channel] = [];
      if (isNoteOff) {
        for (let i = channelNotes[channel].length - 1; i >= 0; i--) {
          const note = channelNotes[channel][i];
          if (note.pitch === pitch && note.end === null) {
            note.end = currentTime;
            break;
          }
        }
      } else {
        channelNotes[channel].push({
          pitch,
          velocity,
          start: currentTime,
          end: null
        });
      }
    }
  }
  const ticksPerBar = ticksPerBeat * 4;
  const ticksPer8Bars = ticksPerBar * 8;
  const channelAnalysis = {};
  for (const [channelStr, notes] of Object.entries(channelNotes)) {
    const channel = Number.parseInt(channelStr, 10);
    const validNotes = notes.filter(
      (n) => n.end !== null
    );
    if (validNotes.length === 0) {
      channelAnalysis[channel] = {
        avgPitch: 60,
        maxSimultaneous: 0,
        hasSubmelodyPattern: false
      };
      continue;
    }
    const avgPitch = validNotes.reduce((sum, n) => sum + n.pitch, 0) / validNotes.length;
    let maxSimultaneous = 0;
    const sortedNotes = [...validNotes].sort((a, b) => a.start - b.start);
    for (let i = 0; i < sortedNotes.length; i++) {
      let simultaneous = 1;
      for (let j = i + 1; j < sortedNotes.length; j++) {
        if (sortedNotes[j].start < sortedNotes[i].end) {
          simultaneous++;
        }
      }
      maxSimultaneous = Math.max(maxSimultaneous, simultaneous);
    }
    const isSubmelodyPattern = () => {
      if (sortedNotes.length === 0) return false;
      const blocks = [];
      let blockStart = sortedNotes[0].start;
      let blockEnd = sortedNotes[0].end;
      for (let i = 1; i < sortedNotes.length; i++) {
        const gap = sortedNotes[i].start - sortedNotes[i - 1].end;
        if (gap >= ticksPerBar) {
          blocks.push({ start: blockStart, end: blockEnd });
          blockStart = sortedNotes[i].start;
          blockEnd = sortedNotes[i].end;
        } else {
          blockEnd = sortedNotes[i].end;
        }
      }
      blocks.push({ start: blockStart, end: blockEnd });
      return blocks.every((b) => b.end - b.start < ticksPer8Bars);
    };
    channelAnalysis[channel] = {
      avgPitch,
      maxSimultaneous,
      hasSubmelodyPattern: isSubmelodyPattern()
    };
  }
  const channels = Object.keys(channelNotes).map(Number).sort((a, b) => a - b);
  const sortedByPitch = [...channels].sort(
    (a, b) => channelAnalysis[a].avgPitch - channelAnalysis[b].avgPitch
  );
  const bassThreshold = channelAnalysis[sortedByPitch[Math.floor(sortedByPitch.length / 4)]]?.avgPitch ?? 60;
  const bassChannels = channels.filter(
    (ch) => channelAnalysis[ch].avgPitch <= bassThreshold && channelAnalysis[ch].maxSimultaneous <= 2
  );
  const melodyTypeChannels = channels.filter(
    (ch) => channelAnalysis[ch].maxSimultaneous <= 1 && !bassChannels.includes(ch)
  );
  const submelodyChannels = melodyTypeChannels.filter(
    (ch) => channelAnalysis[ch].hasSubmelodyPattern
  );
  const melodyChannels = melodyTypeChannels.filter(
    (ch) => !channelAnalysis[ch].hasSubmelodyPattern
  );
  const chordChannels = channels.filter(
    (ch) => !bassChannels.includes(ch) && !melodyChannels.includes(ch) && !submelodyChannels.includes(ch)
  );
  const channelToTrack = {
    melody: melodyChannels,
    submelody: submelodyChannels,
    bass: bassChannels,
    chord: chordChannels
  };
  const placements = [];
  const ticksPerStep = ticksPerBeat / STEPS_PER_BEAT;
  for (const [channelStr, notes] of Object.entries(channelNotes)) {
    const channel = Number.parseInt(channelStr, 10);
    let trackId = null;
    for (const [tid, chs] of Object.entries(channelToTrack)) {
      if (chs.includes(channel)) {
        trackId = tid;
        break;
      }
    }
    if (!trackId) continue;
    for (const note of notes) {
      if (note.end === null) continue;
      const startStep = Math.round(note.start / ticksPerStep);
      const durationSteps = Math.max(
        1,
        Math.round((note.end - note.start) / ticksPerStep)
      );
      placements.push({
        trackId,
        startStep,
        pitch: note.pitch,
        durationSteps,
        velocity: note.velocity
      });
    }
  }
  return { placements, bpm };
};
var extractMidiPlacementsByTrack = (midi, selectedIndices, trackIds) => {
  const { track, timeDivision } = midi;
  const ticksPerBeat = timeDivision;
  const bpm = getMidiBPM(midi);
  const ticksPerStep = ticksPerBeat / STEPS_PER_BEAT;
  const placements = [];
  const selectedSet = new Set(selectedIndices);
  for (let midiIdx = 0; midiIdx < track.length; midiIdx++) {
    if (!selectedSet.has(midiIdx)) continue;
    if (midiIdx >= trackIds.length) continue;
    const trackId = trackIds[midiIdx];
    const trackData = track[midiIdx];
    if (!trackData) continue;
    const active = [];
    let currentTime = 0;
    for (const event of trackData.event) {
      currentTime += event.deltaTime;
      if (event.channel === 9) continue;
      if (event.type !== 8 && event.type !== 9) continue;
      const [pitch, velocity] = event.data;
      const isOff = event.type === 8 || !velocity;
      if (isOff) {
        for (let i = active.length - 1; i >= 0; i--) {
          if (active[i].pitch === pitch && active[i].end === null) {
            active[i].end = currentTime;
            break;
          }
        }
      } else {
        active.push({ pitch, velocity, start: currentTime, end: null });
      }
    }
    for (const note of active) {
      if (note.end === null) continue;
      const startStep = Math.round(note.start / ticksPerStep);
      const durationSteps = Math.max(
        1,
        Math.round((note.end - note.start) / ticksPerStep)
      );
      placements.push({
        trackId,
        startStep,
        pitch: note.pitch,
        durationSteps,
        velocity: note.velocity
      });
    }
  }
  return { placements, bpm };
};
var to2byte = (n) => [(n & 65280) >> 8, n & 255];
var to3byte = (n) => [(n & 16711680) >> 16, ...to2byte(n)];
var to4byte = (n) => [
  (n & 4278190080) >> 24,
  ...to3byte(n)
];
var deltaTime = (n) => {
  const res = [n & 127];
  let v = n >> 7;
  while (v > 0) {
    res.push(v & 127 | 128);
    v >>= 7;
  }
  return res.reverse();
};
var headerChunks = (arr, trackCount, div) => {
  arr.push(77, 84, 104, 100);
  arr.push(...to4byte(6));
  arr.push(...to2byte(1));
  arr.push(...to2byte(trackCount));
  arr.push(...to2byte(div));
};
var trackChunks = (arr, func) => {
  arr.push(77, 84, 114, 107);
  const a = [];
  func(a);
  a.push(...deltaTime(0));
  a.push(255, 47, 0);
  arr.push(...to4byte(a.length));
  arr.push(...a);
};
var exportMIDI = (options) => {
  const { tracks, drumPattern, drumVolume = 80, bpm, stepsPerBar } = options;
  const div = 480;
  const tickPerStep = div / STEPS_PER_BEAT;
  const midiTracks = [];
  tracks.forEach((track, ch) => {
    if (track.notes.length === 0) return;
    const events = [];
    for (const n of track.notes) {
      const startTick = Math.round(n.startStep * tickPerStep);
      const endTick = Math.round(
        (n.startStep + (n.durationSteps || 1)) * tickPerStep
      );
      const vel = Math.round(
        (n.velocity ?? 100) * (track.volume || 100) / 100
      );
      events.push({ t: startTick, m: [144 | ch & 15, n.pitch, vel] });
      events.push({ t: endTick, m: [144 | ch & 15, n.pitch, 0] });
    }
    events.sort((a, b) => a.t - b.t);
    midiTracks.push(events);
  });
  if (drumPattern && drumPattern.length > 0) {
    const maxStep = Math.max(
      ...tracks.filter((t) => t.notes.length > 0).map(
        (t) => Math.max(...t.notes.map((n) => n.startStep + n.durationSteps))
      ),
      stepsPerBar
    );
    const drumEvents = [];
    const numBars = Math.ceil(maxStep / stepsPerBar);
    for (let bar = 0; bar < numBars; bar++) {
      const barStart = bar * stepsPerBar;
      for (const drum of drumPattern) {
        const step = barStart + drum.step;
        if (step >= maxStep) continue;
        const vel = Math.round(
          (drum.velocity ?? 1) * (drumVolume / 100) * 127
        );
        drumEvents.push({
          t: Math.round(step * tickPerStep),
          m: [153, drum.pitch, vel]
        });
        drumEvents.push({
          t: Math.round((step + 1) * tickPerStep),
          m: [153, drum.pitch, 0]
        });
      }
    }
    drumEvents.sort((a, b) => a.t - b.t);
    if (drumEvents.length > 0) midiTracks.push(drumEvents);
  }
  const arr = [];
  headerChunks(arr, midiTracks.length + 1, div);
  trackChunks(arr, (a) => {
    a.push(0, 255, 81, 3, ...to3byte(Math.round(6e7 / bpm)));
  });
  for (const events of midiTracks) {
    trackChunks(arr, (a) => {
      let lastTick = 0;
      for (const ev of events) {
        a.push(...deltaTime(ev.t - lastTick), ...ev.m);
        lastTick = ev.t;
      }
    });
  }
  return new Blob([new Uint8Array(arr).buffer], { type: "audio/midi" });
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
    cornerDiv.style.backgroundColor = "#0a0f1f";
    cornerDiv.style.borderRight = "2px solid #29adff";
    cornerDiv.style.borderBottom = "2px solid #29adff";
    mountTarget.insertBefore(cornerDiv, g_header_canvas);
  }
};
var drawKeyboard = () => {
  g_key_ctx.clearRect(0, 0, g_key_canvas.width, g_key_canvas.height);
  const { keyHeight, keyCount, pitchRangeStart } = g_config;
  const startY = Math.floor(g_draw_offset_y / keyHeight) * keyHeight;
  const endY = g_draw_offset_y + g_key_canvas.height;
  g_key_ctx.beginPath();
  g_key_ctx.strokeStyle = "#29adff";
  g_key_ctx.lineWidth = 2;
  g_key_ctx.moveTo(KEYBOARD_WIDTH, 0);
  g_key_ctx.lineTo(KEYBOARD_WIDTH, g_key_canvas.height);
  g_key_ctx.stroke();
  for (let y = startY; y < endY; y += keyHeight) {
    const pitchIndex = keyCount - 1 - y / keyHeight;
    const totalPitch = pitchIndex + pitchRangeStart;
    const pitchMod12 = totalPitch % 12;
    const isBlackKey = blackKeyPitches.has(pitchMod12);
    const screenY = y - g_draw_offset_y;
    g_key_ctx.fillStyle = "#1d2b53";
    g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
    g_key_ctx.beginPath();
    g_key_ctx.strokeStyle = "#2d3560";
    g_key_ctx.lineWidth = 1;
    g_key_ctx.moveTo(0, screenY + keyHeight);
    g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY + keyHeight);
    g_key_ctx.stroke();
    if (isBlackKey) {
      const blackKeyWidth = KEYBOARD_WIDTH * 0.7;
      const blackKeyHeight = keyHeight * 0.75;
      const offset = (keyHeight - blackKeyHeight) / 2;
      const gradient = g_key_ctx.createLinearGradient(
        0,
        screenY + offset,
        0,
        screenY + offset + blackKeyHeight
      );
      gradient.addColorStop(0, "#3d405b");
      gradient.addColorStop(1, "#000000");
      g_key_ctx.fillStyle = gradient;
      g_key_ctx.fillRect(0, screenY + offset, blackKeyWidth, blackKeyHeight);
      g_key_ctx.strokeStyle = "#000000";
      g_key_ctx.strokeRect(0, screenY + offset, blackKeyWidth, blackKeyHeight);
    }
    if (pitchMod12 === 0) {
      const octave = Math.floor(totalPitch / 12) - 1;
      g_key_ctx.fillStyle = "#83769c";
      g_key_ctx.font = "10px 'MisakiGothic',monospace";
      g_key_ctx.textAlign = "right";
      g_key_ctx.textBaseline = "bottom";
      g_key_ctx.fillText(
        `${KEY_NAMES[pitchMod12]}${octave}`,
        KEYBOARD_WIDTH - 4,
        screenY + keyHeight - 2
      );
    }
  }
};
var drawHeader = () => {
  g_header_ctx.clearRect(0, 0, g_header_canvas.width, g_header_canvas.height);
  const { stepWidth, stepsPerBar } = g_config;
  g_header_ctx.save();
  g_header_ctx.translate(-g_draw_offset_x, 0);
  g_header_ctx.fillStyle = "#0a0f1f";
  g_header_ctx.fillRect(
    g_draw_offset_x,
    0,
    g_header_canvas.width,
    HEADER_HEIGHT
  );
  g_header_ctx.strokeStyle = "#3d405b";
  g_header_ctx.lineWidth = 1;
  g_header_ctx.font = "11px 'MisakiGothic',monospace";
  g_header_ctx.fillStyle = "#83769c";
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
      g_grid_ctx.fillStyle = "#0d1020";
      g_grid_ctx.fillRect(0, screenY, g_grid_canvas.width, keyHeight);
    }
    g_grid_ctx.beginPath();
    g_grid_ctx.strokeStyle = isC ? "#3d405b" : "#1a1d30";
    g_grid_ctx.lineWidth = 1;
    const lineY = screenY + keyHeight;
    g_grid_ctx.moveTo(0, lineY);
    g_grid_ctx.lineTo(g_grid_canvas.width, lineY);
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
    g_grid_ctx.strokeStyle = isBarLine ? "#3d405b" : isNoteLine ? "#242840" : "#1a1d30";
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
  g_grid_ctx.strokeStyle = "#ffec27";
  g_grid_ctx.lineWidth = 2;
  g_grid_ctx.setLineDash([4, 4]);
  g_grid_ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  g_grid_ctx.fillStyle = "rgba(255,236,39,0.08)";
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
      return;
    }
    this.lastHistorySnapshot = snapshot;
    this.history.add(JSON.parse(snapshot));
  }
  restoreHistory(notes) {
    if (notes === null) return false;
    this.isUndoRedo = true;
    this.notes = JSON.parse(JSON.stringify(notes));
    this.nextNoteId = this.notes.length > 0 ? Math.max(...this.notes.map((n) => n.id)) + 1 : 0;
    this.lastHistorySnapshot = JSON.stringify(this.notes);
    this.generateAndNotify();
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

// src/mml-parser.ts
var PITCH_MAP2 = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11
};
var TRACK_INDEX_COUNT = 4;
var parseMML = (mml, options = {}) => {
  const stepsPerBar = options.stepsPerBar ?? 192;
  const placements = [];
  let bpm = null;
  if (!mml) return { placements, bpm };
  const fullMML = mml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/[\n\r]+/g, " ").trim();
  const parts = fullMML.split(/(@\d+)/).filter((p) => p.trim().length > 0);
  let trackIndex = 0;
  let octave = 4;
  let currentStep = 0;
  let baseLength = 16;
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (part.startsWith("@")) {
      let idx = Number.parseInt(part.substring(1), 10);
      if (idx >= TRACK_INDEX_COUNT) idx = 2;
      trackIndex = idx;
      octave = 4;
      currentStep = 0;
      baseLength = 16;
      continue;
    }
    const body = part.replace(/\s+/g, "").toLowerCase();
    let j = 0;
    const parseLength = () => {
      let numStr = "";
      while (j < body.length && /\d/.test(body[j])) {
        numStr += body[j];
        j++;
      }
      const len = numStr ? Number.parseInt(numStr, 10) : baseLength;
      let steps = Math.round(stepsPerBar / len);
      while (j < body.length && body[j] === ".") {
        steps = Math.round(steps * 1.5);
        j++;
      }
      return steps;
    };
    while (j < body.length) {
      const ch = body[j];
      if (ch === "o") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        octave = Number.parseInt(numStr, 10) || 4;
      } else if (ch === ">") {
        octave++;
        j++;
      } else if (ch === "<") {
        octave--;
        j++;
      } else if (ch === "l") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        baseLength = Number.parseInt(numStr, 10) || 16;
      } else if (ch === "r") {
        j++;
        currentStep += parseLength();
      } else if (ch === "t" || ch === "v" || ch === "q") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        if (ch === "t" && trackIndex === 0 && numStr) {
          bpm = Number.parseInt(numStr, 10);
        }
      } else if (ch === "[") {
        j++;
        const chordNotes = [];
        const savedOctave = octave;
        while (j < body.length && body[j] !== "]") {
          const c = body[j];
          if (Object.hasOwn(PITCH_MAP2, c)) {
            let pitch = PITCH_MAP2[c];
            j++;
            if (j < body.length && (body[j] === "#" || body[j] === "+")) {
              pitch++;
              j++;
            } else if (j < body.length && body[j] === "-") {
              pitch--;
              j++;
            }
            chordNotes.push((octave + 1) * 12 + pitch);
          } else if (c === ">") {
            octave++;
            j++;
          } else if (c === "<") {
            octave--;
            j++;
          } else if (c === "o") {
            j++;
            let numStr = "";
            while (j < body.length && /\d/.test(body[j])) {
              numStr += body[j];
              j++;
            }
            octave = Number.parseInt(numStr, 10) || 4;
          } else {
            j++;
          }
        }
        if (j < body.length && body[j] === "]") j++;
        const steps = parseLength();
        for (const p of chordNotes) {
          placements.push({
            trackIndex,
            startStep: currentStep,
            pitch: p,
            durationSteps: Math.max(1, steps)
          });
        }
        currentStep += steps;
        octave = savedOctave;
      } else if (Object.hasOwn(PITCH_MAP2, ch)) {
        let pitch = PITCH_MAP2[ch];
        j++;
        if (j < body.length && (body[j] === "#" || body[j] === "+")) {
          pitch++;
          j++;
        } else if (j < body.length && body[j] === "-") {
          pitch--;
          j++;
        }
        const midiPitch = (octave + 1) * 12 + pitch;
        const steps = parseLength();
        placements.push({
          trackIndex,
          startStep: currentStep,
          pitch: midiPitch,
          durationSteps: Math.max(1, steps)
        });
        currentStep += steps;
      } else {
        j++;
      }
    }
  }
  return { placements, bpm };
};

// src/sequencer.ts
var STEPS_PER_BEAT2 = 48;
var PLAN_TIME = 0.1;
var TICK_INTERVAL_MS = 20;
var createSequencer = (options) => {
  let timeline = [];
  let startTime = 0;
  let nowIndex = 0;
  let intervalId = null;
  let animationId = null;
  let active = false;
  let fromStepValue = 0;
  const secondsPerStep = () => 60 / options.getBpm() / STEPS_PER_BEAT2;
  const buildTimeline = (fromStep) => {
    timeline = [];
    const sps = secondsPerStep();
    for (const track of options.getTracks()) {
      for (const note of track.notes) {
        const relativeStart = note.startStep - fromStep;
        if (relativeStart < 0) continue;
        const velocity = note.velocity ?? 127;
        timeline.push({
          trackId: track.id,
          pitch: note.pitch,
          volume: track.volume / 100,
          velocity,
          when: relativeStart * sps,
          duration: note.durationSteps * sps
        });
      }
    }
    timeline.sort((a, b) => a.when - b.when);
  };
  const scheduleTick = () => {
    const sps = secondsPerStep();
    const time = options.getAudioTime() - startTime;
    const soloId = options.getSoloTrackId();
    while (nowIndex < timeline.length) {
      const ev = timeline[nowIndex];
      if (soloId && ev.trackId !== soloId) {
        nowIndex++;
        continue;
      }
      const _when = ev.when - time;
      if (_when > PLAN_TIME) break;
      nowIndex++;
      const velocityVolume = ev.velocity / 127;
      options.onPlayNote({
        trackId: ev.trackId,
        pitch: ev.pitch,
        velocity: ev.velocity,
        volume: ev.volume * velocityVolume,
        when: Math.max(0, _when),
        duration: ev.duration
      });
    }
    const pattern = options.getDrumPattern();
    if (pattern && pattern.length > 0) {
      const { stepsPerBar } = options;
      const currentStep = (fromStepValue * sps + (options.getAudioTime() - startTime)) / sps;
      const currentStepInBar = currentStep % stepsPerBar;
      const nextStep = currentStepInBar + 4;
      const crossedBar = currentStepInBar < 4;
      for (const drum of pattern) {
        const shouldPlay = crossedBar && drum.step === 0 || drum.step >= currentStepInBar && drum.step < nextStep;
        if (!shouldPlay) continue;
        const whenSeconds = (drum.step - currentStepInBar) * sps;
        if (whenSeconds < -0.1 || whenSeconds > PLAN_TIME) continue;
        options.onPlayDrum({
          pitch: drum.pitch,
          velocity: drum.velocity ?? 1,
          when: Math.max(0, whenSeconds),
          duration: 0.1
        });
      }
    }
    const last = timeline[timeline.length - 1];
    const lastWhen = last?.when ?? 0;
    const lastDuration = last?.duration ?? 0;
    if (nowIndex >= timeline.length && time > lastWhen + lastDuration + 0.1) {
      stop();
      options.onEnd();
    }
  };
  const animate = () => {
    if (!active) return;
    const sps = secondsPerStep();
    const time = options.getAudioTime() - startTime;
    options.onTick(fromStepValue + time / sps);
    animationId = requestAnimationFrame(animate);
  };
  const stop = () => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    active = false;
  };
  const start = (fromStep) => {
    stop();
    fromStepValue = fromStep ?? options.getPlayStartStep();
    buildTimeline(fromStepValue);
    if (timeline.length === 0 && !options.getDrumPattern()?.length) return;
    active = true;
    startTime = options.getAudioTime();
    nowIndex = 0;
    intervalId = setInterval(scheduleTick, TICK_INTERVAL_MS);
    animationId = requestAnimationFrame(animate);
  };
  return {
    start,
    stop,
    isActive: () => active
  };
};

// src/styles.ts
var STYLE_ID = "dtm-daw-styles";
var DAW_CSS = `
@font-face {
  font-family: 'MisakiGothic';
  src: url('https://cdn.jsdelivr.net/npm/misaki-font/misaki_gothic.woff2') format('woff2'),
       url('https://cdn.jsdelivr.net/npm/misaki-font/misaki_gothic.woff') format('woff');
  font-weight: normal;
  font-style: normal;
}

/* ====================================================
   PIXEL MUSIC STUDIO \u2014 \u30C9\u30C3\u30C8\u7D75UI\u30B7\u30B9\u30C6\u30E0
   PICO-8\u30AB\u30E9\u30FC\u30D1\u30EC\u30C3\u30C8\u30FB\u7F8E\u54B2\u30D5\u30A9\u30F3\u30C8\u30FB\u30B2\u30FC\u30E0\u30A6\u30A3\u30F3\u30C9\u30A6\u67A0
   ==================================================== */

.dtm-daw {
  /* PICO-8 16\u8272\u30D1\u30EC\u30C3\u30C8\u3088\u308A */
  --c-black:   #000000;
  --c-navy:    #1d2b53;
  --c-purple:  #7e2553;
  --c-dkgreen: #008751;
  --c-brown:   #ab5236;
  --c-dkgray:  #5f574f;
  --c-gray:    #c2c3c7;
  --c-white:   #fff1e8;
  --c-red:     #ff004d;
  --c-orange:  #ffa300;
  --c-yellow:  #ffec27;
  --c-green:   #00e436;
  --c-cyan:    #29adff;
  --c-lavend:  #83769c;
  --c-pink:    #ff77a8;
  --c-peach:   #ffccaa;

  /* \u30BB\u30DE\u30F3\u30C6\u30A3\u30C3\u30AF\u30C8\u30FC\u30AF\u30F3 */
  --dtm-bg:       var(--c-black);
  --dtm-surface:  var(--c-navy);
  --dtm-deep:     #0a0f1f;
  --dtm-border:   var(--c-cyan);
  --dtm-border2:  var(--c-dkgray);
  --dtm-text:     var(--c-white);
  --dtm-muted:    var(--c-lavend);
  --dtm-primary:  var(--c-cyan);
  --dtm-pfg:      var(--c-black);
  --dtm-danger:   var(--c-red);
  --dtm-success:  var(--c-green);
  --dtm-accent:   var(--c-pink);
  --dtm-gold:     var(--c-yellow);
  --dtm-warn:     var(--c-orange);
  --dtm-tap:      40px;
  --dtm-gap:      6px;
  --dtm-font:     'MisakiGothic','MS Gothic','\uFF2D\uFF33 \u30B4\u30B7\u30C3\u30AF',ui-monospace,monospace;

  box-sizing: border-box;
  font-family: var(--dtm-font);
  font-size: 14px;
  line-height: 1.6;
  letter-spacing: .06em;
  color: var(--dtm-text);
  background: var(--dtm-bg);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--dtm-gap);
  padding: 6px;
  image-rendering: pixelated;
  -webkit-font-smoothing: none;
  -moz-osx-font-smoothing: unset;
  font-smooth: never;
  -webkit-tap-highlight-color: transparent;
}
.dtm-daw *,
.dtm-daw *::before,
.dtm-daw *::after { box-sizing: border-box; }

/* \u2500\u2500\u2500 \u30B2\u30FC\u30E0\u30A6\u30A3\u30F3\u30C9\u30A6\u5171\u901A\u67A0 \u2500\u2500\u2500 */
/* \u5916\u67A0(\u9ED22px) \u2192 \u8272\u4ED8\u304D2px border \u2192 \u5185\u67A0(\u9ED2inset2px) \u306E3\u91CD\u69CB\u9020 */
.dtm-win {
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-primary),
    4px 4px 0 var(--c-black);
  background: var(--dtm-surface);
}

/* \u2500\u2500\u2500 \u5171\u901A\u30DC\u30BF\u30F3 \u2500\u2500\u2500 */
.dtm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: var(--dtm-tap);
  min-width: var(--dtm-tap);
  padding: 0 10px;
  border: 2px solid var(--dtm-border2);
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-family: var(--dtm-font);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: .12em;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  box-shadow: 3px 3px 0 var(--c-black);
  transition: none;
}
.dtm-btn:active  { transform: translate(3px,3px); box-shadow: none; }
.dtm-btn:disabled { opacity: .3; cursor: default; box-shadow: none; }
.dtm-btn--primary { border-color: var(--dtm-primary); background: var(--dtm-primary); color: var(--dtm-pfg); }
.dtm-btn--success { border-color: var(--dtm-success); background: var(--dtm-success); color: var(--c-black); }
.dtm-btn--danger  { border-color: var(--dtm-danger);  background: var(--dtm-danger);  color: var(--c-white); }
.dtm-btn--accent  { border-color: var(--dtm-accent);  background: var(--dtm-accent);  color: var(--c-black); }
.dtm-btn--ghost   { background: transparent; border-color: var(--dtm-border2); }
.dtm-btn--icon    { padding: 0; }

/* \u2500\u2500\u2500 \u30A2\u30A4\u30B3\u30F3\u30DC\u30BF\u30F3 \u2500\u2500\u2500 */
.dtm-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  flex: 0 0 auto;
  border: 2px solid var(--dtm-border2);
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-size: 16px;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--c-black);
}
.dtm-iconbtn:active  { transform: translate(3px,3px); box-shadow: none; }
.dtm-iconbtn:disabled { opacity: .3; cursor: default; box-shadow: none; }

/* \u2500\u2500\u2500 \u30C8\u30E9\u30F3\u30B9\u30DD\u30FC\u30C8\u30D0\u30FC\uFF08HUD\u30B9\u30BF\u30A4\u30EB\uFF09 \u2500\u2500\u2500 */
.dtm-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--dtm-gap);
  padding: 6px;
  background: var(--dtm-deep);
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-success),
    4px 4px 0 var(--c-black);
}

/* PLAY\u30DC\u30BF\u30F3 \u2014 \u30B2\u30FC\u30E0\u306E\u300C\u6C7A\u5B9A\u30DC\u30BF\u30F3\u300D\u7684\u5B58\u5728\u611F */
.dtm-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 20px;
  border: 2px solid var(--c-black);
  background: var(--dtm-success);
  color: var(--c-black);
  font-family: var(--dtm-font);
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: .2em;
  cursor: pointer;
  box-shadow: 0 0 0 2px var(--dtm-success), 4px 4px 0 var(--c-black);
}
.dtm-play:active  { transform: translate(4px,4px); box-shadow: none; }
.dtm-play:disabled { opacity: .35; cursor: default; box-shadow: none; }
.dtm-play--stop {
  background: var(--dtm-danger);
  box-shadow: 0 0 0 2px var(--dtm-danger), 4px 4px 0 var(--c-black);
  color: var(--c-white);
}
.dtm-rec { color: var(--dtm-danger); }

/* BPM \u2014 \u30C7\u30B8\u30BF\u30EB\u30AB\u30A6\u30F3\u30BF\u30FC\u98A8 */
.dtm-label {
  font-family: var(--dtm-font);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .14em;
  color: var(--dtm-muted);
  white-space: nowrap;
}
.dtm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--dtm-font);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: var(--dtm-muted);
  cursor: pointer;
}
.dtm-toggle input { width: 16px; height: 16px; accent-color: var(--dtm-accent); }

/* \u2500\u2500\u2500 \u30C4\u30FC\u30EB\u30C9\u30C3\u30AF\uFF08\u88C5\u5099\u30B9\u30ED\u30C3\u30C8\u98A8\uFF09 \u2500\u2500\u2500 */
.dtm-tooldock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--dtm-gap);
  padding: 6px;
  background: var(--dtm-deep);
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-border2),
    4px 4px 0 var(--c-black);
}
.dtm-sep {
  width: 2px; align-self: stretch;
  background: var(--dtm-border2); margin: 2px;
}
.dtm-row .dtm-label[data-dtm] { min-width: 48px; text-align: center; }

/* \u2500\u2500\u2500 \u30BB\u30B0\u30E1\u30F3\u30C8\uFF08\u30A2\u30A4\u30C6\u30E0\u30B9\u30ED\u30C3\u30C8\uFF09 \u2500\u2500\u2500 */
.dtm-seg {
  display: inline-flex;
  border: 2px solid var(--dtm-border2);
  background: var(--dtm-deep);
  box-shadow: 3px 3px 0 var(--c-black);
}
.dtm-segbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  border: none;
  border-right: 2px solid var(--dtm-border2);
  background: transparent;
  color: var(--dtm-muted);
  cursor: pointer;
}
.dtm-segbtn:last-child { border-right: none; }
.dtm-segbtn--active {
  background: var(--dtm-gold);
  color: var(--c-black);
}
.dtm-segbtn:not(.dtm-segbtn--active):active { background: var(--dtm-border2); }

/* \u2500\u2500\u2500 \u30D5\u30A9\u30FC\u30E0\u8981\u7D20 \u2500\u2500\u2500 */
.dtm-select, .dtm-input, .dtm-textarea {
  min-height: var(--dtm-tap);
  padding: 4px 8px;
  border: 2px solid var(--dtm-border2);
  background: var(--dtm-deep);
  color: var(--dtm-text);
  font-family: var(--dtm-font);
  font-size: 13px;
  letter-spacing: .06em;
  box-shadow: inset 2px 2px 0 var(--c-black);
}
.dtm-select:focus, .dtm-input:focus, .dtm-textarea:focus {
  outline: none;
  border-color: var(--dtm-primary);
}
.dtm-input--num { width: 64px; text-align: center; font-size: 16px; }
.dtm-textarea { width: 100%; min-height: 56px; resize: vertical; line-height: 1.7; }
.dtm-range { height: var(--dtm-tap); accent-color: var(--dtm-primary); }

/* \u2500\u2500\u2500 \u30C8\u30E9\u30C3\u30AF\u30D4\u30EB\uFF08\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u9078\u629E\u30DC\u30BF\u30F3\uFF09 \u2500\u2500\u2500 */
.dtm-tracks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--dtm-gap);
}
.dtm-pill {
  --dtm-pill-color: var(--dtm-primary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 42px;
  padding: 0 12px;
  border: 2px solid var(--dtm-border2);
  background: var(--dtm-deep);
  color: var(--dtm-muted);
  font-family: var(--dtm-font);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: .1em;
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--c-black);
}
.dtm-pill .dtm-dot {
  width: 8px; height: 8px;
  background: var(--dtm-pill-color);
  flex: 0 0 auto;
  box-shadow: 1px 1px 0 var(--c-black);
}
/* \u30A2\u30AF\u30C6\u30A3\u30D6\u9078\u629E = \u91D1\u8272\u30CF\u30A4\u30E9\u30A4\u30C8 + \u30AB\u30FC\u30BD\u30EB */
.dtm-pill--active {
  border-color: var(--dtm-gold);
  color: var(--dtm-gold);
  background: var(--dtm-surface);
  box-shadow: 0 0 0 2px var(--dtm-gold), 3px 3px 0 var(--c-black);
}
.dtm-pill--active::before { content: "\u25BA "; font-size: 10px; }
.dtm-pill:not(.dtm-pill--active):active { transform: translate(3px,3px); box-shadow: none; }

/* \u2500\u2500\u2500 \u30D4\u30A2\u30CE\u30ED\u30FC\u30EB\uFF08\u30C8\u30E9\u30C3\u30AB\u30FC\u98A8\uFF09 \u2500\u2500\u2500 */
.dtm-roll-wrap { display: flex; gap: var(--dtm-gap); }
.dtm-roll {
  position: relative;
  flex: 1 1 auto;
  height: 56vh;
  min-height: 280px;
  background: var(--dtm-deep);
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-border2),
    4px 4px 0 var(--c-black);
  overflow: hidden;
}
.dtm-vscroll {
  position: relative;
  width: 12px;
  background: var(--dtm-deep);
  border: 2px solid var(--dtm-border2);
  cursor: pointer;
  flex: 0 0 auto;
}
.dtm-vscroll-thumb, .dtm-hscroll-thumb {
  position: absolute;
  background: var(--dtm-primary);
}
.dtm-vscroll-thumb { left: 0; width: 100%; }
.dtm-hscroll {
  position: relative;
  width: 100%; height: 12px;
  background: var(--dtm-deep);
  border: 2px solid var(--dtm-border2);
  cursor: pointer;
}
.dtm-hscroll-thumb { top: 0; height: 100%; }

/* \u2500\u2500\u2500 \u30D1\u30CD\u30EB\uFF08RPG\u30C0\u30A4\u30A2\u30ED\u30B0\u30A6\u30A3\u30F3\u30C9\u30A6\uFF09 \u2500\u2500\u2500 */
.dtm-panel {
  background: var(--dtm-surface);
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-primary),
    4px 4px 0 var(--c-black);
  overflow: hidden;
}
.dtm-panel > summary {
  list-style: none;
  cursor: pointer;
  padding: 0 12px;
  font-family: var(--dtm-font);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .14em;
  display: flex;
  align-items: center;
  min-height: var(--dtm-tap);
  background: var(--dtm-deep);
  border-bottom: 2px solid var(--dtm-border2);
  color: var(--dtm-primary);
  gap: 8px;
}
.dtm-panel:not([open]) > summary { border-bottom: none; }
.dtm-panel > summary::-webkit-details-marker { display: none; }
/* \u5DE6\u7AEF\u30E9\u30A4\u30F3\uFF08\u30B2\u30FC\u30E0UI\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u8272\u5206\u3051\uFF09 */
.dtm-panel > summary::before {
  content: '';
  display: block;
  width: 4px;
  height: 20px;
  background: var(--dtm-accent);
  flex: 0 0 auto;
}
.dtm-panel[open] > summary::before { background: var(--dtm-primary); }
/* \u6298\u308A\u305F\u305F\u307F\u77E2\u5370 */
.dtm-panel > summary::after {
  content: "\u25B6";
  margin-left: auto;
  color: var(--dtm-muted);
  font-size: 10px;
}
.dtm-panel[open] > summary::after { content: "\u25BC"; }
.dtm-panel-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.dtm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dtm-track-body { display: flex; flex-direction: column; gap: 10px; }

/* \u2500\u2500\u2500 MML\u51FA\u529B\uFF08CRT\u30BF\u30FC\u30DF\u30CA\u30EB\uFF09 \u2500\u2500\u2500 */
.dtm-output {
  background: var(--c-black);
  color: var(--dtm-success);
  border: 2px solid var(--dtm-success);
  padding: 10px;
  box-shadow: 0 0 0 2px var(--c-black), 4px 4px 0 var(--c-black);
}
.dtm-output::before {
  content: "C:\\> MML OUTPUT";
  display: block;
  font-size: 11px;
  color: var(--dtm-muted);
  letter-spacing: .14em;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--dtm-border2);
}
.dtm-output pre {
  margin: 0;
  background: transparent;
  padding: 0;
  overflow-x: auto;
  font-family: var(--dtm-font);
  font-size: 12px;
  line-height: 1.8;
  color: var(--dtm-success);
}
.dtm-output-row { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; }
.dtm-output-row pre { flex: 1; }

/* \u2500\u2500\u2500 \u30ED\u30FC\u30C7\u30A3\u30F3\u30B0\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4 \u2500\u2500\u2500 */
.dtm-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.85);
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 16px;
}
.dtm-overlay[hidden] { display: none; }
/* \u30B2\u30FC\u30E0\u306E\u30ED\u30FC\u30C9\u753B\u9762\u98A8\uFF1A\u25A0\u25A0\u25A0\u25A1\u25A1\u25A1 */
.dtm-spinner {
  width: 48px; height: 8px;
  position: relative;
  background: var(--dtm-border2);
  box-shadow: 0 0 0 2px var(--c-black), 0 0 0 4px var(--dtm-primary), 6px 6px 0 var(--c-black);
}
.dtm-spinner::after {
  content: '';
  position: absolute;
  left: 0; top: 0;
  height: 100%;
  background: var(--dtm-primary);
  animation: dtm-load 1.2s steps(4) infinite;
}
@keyframes dtm-load { 0%{width:0} 100%{width:100%} }

@keyframes dtm-blink { 0%,100%{opacity:1} 50%{opacity:0} }
.dtm-blink { animation: dtm-blink 1s steps(1) infinite; }

.dtm-hidden { display: none !important; }
.dtm-grow { flex: 1 1 auto; }

/* \u2500\u2500\u2500 \u5E83\u5E45\u62E1\u5F35 \u2500\u2500\u2500 */
@media (min-width: 768px) {
  .dtm-daw { gap: 8px; padding: 10px; }
  .dtm-roll { height: 420px; }
}
`;
var injectStyles = (doc = document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DAW_CSS;
  doc.head.appendChild(style);
};

// src/daw.ts
var BASE_STEP_WIDTH = 0.5;
var BASE_KEY_HEIGHT = 15;
var TRACKS_SIMPLE = [
  {
    id: "melody",
    name: "\u30E1\u30ED\u30C7\u30A3\u30FC",
    color: [41, 173, 255],
    instrument: 0,
    volume: 100
  },
  {
    id: "submelody",
    name: "\u30B5\u30D6\u30E1\u30ED",
    color: [255, 119, 168],
    instrument: 1,
    volume: 95
  },
  {
    id: "bass",
    name: "\u30D9\u30FC\u30B9",
    color: [0, 228, 54],
    instrument: 2,
    volume: 88
  },
  {
    id: "chord",
    name: "\u4F34\u594F",
    color: [255, 163, 0],
    instrument: 3,
    volume: 76
  }
];
var TRACKS_ADVANCED = [
  {
    id: "t0",
    name: "TRACK 01",
    color: [41, 173, 255],
    instrument: 0,
    volume: 100
  },
  {
    id: "t1",
    name: "TRACK 02",
    color: [0, 228, 54],
    instrument: 1,
    volume: 100
  },
  {
    id: "t2",
    name: "TRACK 03",
    color: [255, 119, 168],
    instrument: 2,
    volume: 100
  },
  {
    id: "t3",
    name: "TRACK 04",
    color: [255, 163, 0],
    instrument: 3,
    volume: 100
  },
  {
    id: "t4",
    name: "TRACK 05",
    color: [255, 236, 39],
    instrument: 4,
    volume: 100
  },
  {
    id: "t5",
    name: "TRACK 06",
    color: [131, 118, 156],
    instrument: 5,
    volume: 100
  },
  {
    id: "t6",
    name: "TRACK 07",
    color: [255, 0, 77],
    instrument: 6,
    volume: 100
  },
  {
    id: "t7",
    name: "TRACK 08",
    color: [255, 204, 170],
    instrument: 7,
    volume: 100
  },
  {
    id: "t8",
    name: "TRACK 09",
    color: [194, 195, 199],
    instrument: 8,
    volume: 100
  },
  {
    id: "t9",
    name: "TRACK 10",
    color: [0, 135, 81],
    instrument: 9,
    volume: 100
  },
  {
    id: "t10",
    name: "TRACK 11",
    color: [171, 82, 54],
    instrument: 10,
    volume: 100
  },
  {
    id: "t11",
    name: "TRACK 12",
    color: [126, 37, 83],
    instrument: 11,
    volume: 100
  },
  {
    id: "t12",
    name: "TRACK 13",
    color: [255, 241, 232],
    instrument: 12,
    volume: 100
  },
  {
    id: "t13",
    name: "TRACK 14",
    color: [120, 200, 255],
    instrument: 13,
    volume: 100
  },
  {
    id: "t14",
    name: "TRACK 15",
    color: [100, 255, 160],
    instrument: 14,
    volume: 100
  },
  {
    id: "t15",
    name: "TRACK 16",
    color: [255, 150, 200],
    instrument: 15,
    volume: 100
  }
];
var DEFAULT_TRACKS = TRACKS_SIMPLE;
var clamp = (v, min, max) => Math.min(Math.max(v, min), max);
var mountDAW = (target, options = {}) => {
  injectStyles();
  const getAudioTime = options.getAudioTime ?? (() => performance.now() / 1e3);
  const trackConfigs = options.tracks ?? DEFAULT_TRACKS;
  const drumPatterns = options.drumPatterns ?? DRUM_PATTERNS;
  const showMidi = !!options.parseMidi;
  const showChord = !!(options.parseChord && options.parseChords);
  const refs = buildUI(target, {
    tracks: trackConfigs,
    drumPatternNames: Object.keys(drumPatterns),
    defaultDrumPattern: drumPatterns.dance ? "dance" : Object.keys(drumPatterns)[0] ?? "none",
    defaultBpm: options.defaultBpm ?? 120,
    showMidi,
    showChord
  });
  const renderConfig = {
    stepsPerBar: 192,
    keyCount: 128,
    pitchRangeStart: 0,
    keyHeight: BASE_KEY_HEIGHT,
    stepWidth: BASE_STEP_WIDTH * 2
    // zoom100% 相当
  };
  const leftPaddingSteps = renderConfig.stepsPerBar * 16;
  let zoomX = 100;
  let zoomY = 100;
  let bpm = options.defaultBpm ?? 120;
  let masterVolume = 50;
  let drumVolume = 80;
  let currentDrumPattern = refs.drumSelect.value;
  let activeTrackId = trackConfigs[0].id;
  let activeToolMode = "pen";
  let currentInsertLength = 48;
  let snapGridSteps = 12;
  const gridLineSteps = 48;
  let currentOffsetX = 0;
  let currentOffsetY = (104 - 1 - 60) * renderConfig.keyHeight - 215;
  let playStartStep = 0;
  let isSolo = false;
  let playbackState = "stopped";
  let pausedPlayStep = 0;
  let currentPlayStep = 0;
  let ready = false;
  let selectedNotes = [];
  let selectionRect = null;
  let copiedNotes = [];
  let trackStates = [];
  const createTrackStates = () => {
    trackStates = trackConfigs.map((config) => ({
      config,
      core: new MMLCore(
        {
          onMMLGenerated: () => {
          },
          onNotesChanged: () => {
            if (!ready) return;
            redrawAll();
            updateUndoRedo();
          }
        },
        config.volume
      ),
      volume: config.volume,
      savedChordInput: "",
      savedChordPattern: "block",
      savedChordRoot: 0
    }));
  };
  const getActive = () => trackStates.find((t) => t.config.id === activeTrackId) ?? trackStates[0];
  const getMaxNoteStep = () => {
    let maxStep = renderConfig.stepsPerBar * 4;
    for (const t of trackStates) {
      for (const n of t.core.getNotes()) {
        const end = n.startStep + n.durationSteps;
        if (end > maxStep) maxStep = end;
      }
    }
    return maxStep;
  };
  const getMaxOffsetY = () => {
    const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
    return Math.max(0, totalHeight - getGridCanvas().height);
  };
  const drawStartLine = () => {
    const ctx = getGridContext();
    const canvas = getGridCanvas();
    if (!ctx) return;
    const x = playStartStep * renderConfig.stepWidth - currentOffsetX;
    if (x < -10 || x > canvas.width + 10) return;
    ctx.save();
    ctx.strokeStyle = "#ffec27";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
    ctx.restore();
  };
  const drawPlayhead = () => {
    const ctx = getGridContext();
    const canvas = getGridCanvas();
    if (!ctx) return;
    const x = currentPlayStep * renderConfig.stepWidth - currentOffsetX;
    if (x < 0 || x > canvas.width) return;
    ctx.save();
    ctx.strokeStyle = "#ff004d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
    ctx.restore();
  };
  const redrawAll = () => {
    drawGrid(gridLineSteps);
    for (const t of trackStates) {
      const [r, g, b] = t.config.color;
      const a = t.config.id === activeTrackId ? 1 : 0.3;
      drawNotes(t.core.getNotes(), [r, g, b, a]);
    }
    if (activeToolMode === "select" && selectionRect) {
      const ctx = getGridContext();
      ctx.save();
      ctx.strokeStyle = "#ffec27";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        selectionRect.x,
        selectionRect.y,
        selectionRect.width,
        selectionRect.height
      );
      ctx.fillStyle = "rgba(255,236,39,0.08)";
      ctx.fillRect(
        selectionRect.x,
        selectionRect.y,
        selectionRect.width,
        selectionRect.height
      );
      ctx.restore();
    }
    if (activeToolMode === "select" && selectedNotes.length > 0) {
      const ids = new Set(selectedNotes.map((n) => n.id));
      const active = getActive();
      drawSelectedNotes(active.core.getNotes(), ids, [
        ...active.config.color,
        1
      ]);
    }
    drawStartLine();
    if (playbackState === "playing") drawPlayhead();
    updateScrollbars();
  };
  const updateScrollbars = () => {
    const canvas = getGridCanvas();
    const maxNoteStep = getMaxNoteStep();
    const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
    const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
    const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
    const sbW = refs.hScroll.clientWidth;
    if (maxOffsetX <= 0) {
      refs.hScrollThumb.style.width = "100%";
      refs.hScrollThumb.style.left = "0";
    } else {
      const thumbW = Math.max(
        40,
        canvas.width / (totalContentWidth + leftPaddingWidth) * sbW
      );
      const ratio = currentOffsetX / maxOffsetX;
      refs.hScrollThumb.style.width = `${thumbW}px`;
      refs.hScrollThumb.style.left = `${clamp(ratio * (sbW - thumbW), 0, sbW - thumbW)}px`;
    }
    const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
    const sbH = refs.vScroll.clientHeight;
    if (totalHeight <= canvas.height) {
      refs.vScrollThumb.style.height = "100%";
      refs.vScrollThumb.style.top = "0";
    } else {
      const thumbH = Math.max(40, canvas.height / totalHeight * sbH);
      const maxOffset = getMaxOffsetY();
      const ratio = currentOffsetY / maxOffset;
      refs.vScrollThumb.style.height = `${thumbH}px`;
      refs.vScrollThumb.style.top = `${ratio * (sbH - thumbH)}px`;
    }
  };
  const initScrollbarDrag = () => {
    let draggingH = false;
    let draggingV = false;
    refs.hScroll.addEventListener("pointerdown", (e) => {
      draggingH = true;
      e.preventDefault();
      moveH(e.clientX);
    });
    refs.vScroll.addEventListener("pointerdown", (e) => {
      draggingV = true;
      e.preventDefault();
      moveV(e.clientY);
    });
    document.addEventListener("pointermove", (e) => {
      if (draggingH) moveH(e.clientX);
      if (draggingV) moveV(e.clientY);
    });
    document.addEventListener("pointerup", () => {
      draggingH = false;
      draggingV = false;
    });
    const moveH = (clientX) => {
      const canvas = getGridCanvas();
      const maxNoteStep = getMaxNoteStep();
      const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
      const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
      const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
      if (maxOffsetX <= 0) return;
      const rect = refs.hScroll.getBoundingClientRect();
      const thumbW = Number.parseFloat(refs.hScrollThumb.style.width) || 40;
      const x = clamp(clientX - rect.left - thumbW / 2, 0, rect.width - thumbW);
      const ratio = x / (rect.width - thumbW);
      currentOffsetX = clamp(ratio * maxOffsetX, 0, maxOffsetX);
      setDrawOffset(currentOffsetX, currentOffsetY);
      redrawAll();
    };
    const moveV = (clientY) => {
      const maxOffset = getMaxOffsetY();
      if (maxOffset <= 0) return;
      const rect = refs.vScroll.getBoundingClientRect();
      const thumbH = Number.parseFloat(refs.vScrollThumb.style.height) || 40;
      const y = clamp(clientY - rect.top - thumbH / 2, 0, rect.height - thumbH);
      const ratio = y / (rect.height - thumbH);
      currentOffsetY = clamp(ratio * maxOffset, 0, maxOffset);
      setDrawOffset(currentOffsetX, currentOffsetY);
      redrawAll();
    };
  };
  const resizeHandleWidth = 6;
  let suppressClick = false;
  let hasDragged = false;
  let dragState = null;
  let isSelecting = false;
  let dragMode = "rect";
  let selectionStart = null;
  let selectedOriginal = [];
  let lastMultiPreviewPitch = null;
  const playPreview = (pitch) => {
    options.onResumeAudio?.();
    const active = getActive();
    dispatchNote(active.config.id, pitch, active.volume, 100, 0, 0.1);
  };
  const findActiveNoteAt = (x, y) => {
    const active = getActive();
    const { stepWidth, keyHeight, keyCount, pitchRangeStart } = renderConfig;
    const offset = getDrawOffset();
    for (const note of active.core.getNotes()) {
      const logicalX = note.startStep * stepWidth;
      const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
      const logicalY = yIndex * keyHeight;
      const w = note.durationSteps * stepWidth;
      const renderX = logicalX - offset.x;
      const renderY = logicalY - offset.y;
      if (x >= renderX && x <= renderX + w && y >= renderY && y <= renderY + keyHeight)
        return note;
    }
    return null;
  };
  const hasNoteAt = (step, pitch, excludeId) => {
    const active = getActive();
    return active.core.getNotes().some(
      (n) => n.id !== excludeId && n.pitch === pitch && step >= n.startStep && step < n.startStep + n.durationSteps
    );
  };
  const snapToGrid = (duration) => Math.max(
    Math.round(duration / snapGridSteps) * snapGridSteps,
    snapGridSteps
  );
  const onGridPointerDown = (event) => {
    event.preventDefault();
    options.onResumeAudio?.();
    const { x, y, step, pitch } = getGridPosition(event);
    const active = getActive();
    if (activeToolMode === "eraser") {
      const note = findActiveNoteAt(x, y);
      if (note) active.core.deleteNoteById(note.id);
      return;
    }
    if (activeToolMode === "select") {
      if (selectedNotes.length > 0) {
        const clicked2 = findActiveNoteAt(x, y);
        if (clicked2 && selectedNotes.some((n) => n.id === clicked2.id)) {
          selectedOriginal = selectedNotes.map((n) => ({
            id: n.id,
            startStep: n.startStep,
            pitch: n.pitch
          }));
          isSelecting = true;
          dragMode = "move";
          selectionStart = { x, y, step, pitch };
          hasDragged = false;
          lastMultiPreviewPitch = null;
          return;
        }
        selectedNotes = [];
        selectionRect = null;
      }
      const clicked = findActiveNoteAt(x, y);
      if (clicked) {
        selectedNotes = [clicked];
        selectedOriginal = [
          {
            id: clicked.id,
            startStep: clicked.startStep,
            pitch: clicked.pitch
          }
        ];
        isSelecting = true;
        dragMode = "move";
      } else {
        selectedNotes = [];
        selectionRect = null;
        isSelecting = true;
        dragMode = "rect";
      }
      selectionStart = { x, y, step, pitch };
      hasDragged = false;
      return;
    }
    hasDragged = false;
    const epsilon = 0.1;
    const existing = active.core.getNotes().find(
      (n) => n.pitch === pitch && step >= n.startStep - epsilon && step < n.startStep + n.durationSteps - epsilon
    );
    if (existing) {
      playPreview(existing.pitch);
      const { stepWidth } = renderConfig;
      const offset = getDrawOffset();
      const renderX = existing.startStep * stepWidth - offset.x;
      const w = existing.durationSteps * stepWidth;
      if (x >= renderX + w - resizeHandleWidth && x <= renderX + w) {
        dragState = {
          noteId: existing.id,
          mode: "resize",
          dragOffsetStep: 0,
          dragOffsetPitch: 0,
          startStep: existing.startStep,
          durationSteps: existing.durationSteps,
          lastPreviewPitch: existing.pitch
        };
      } else {
        dragState = {
          noteId: existing.id,
          mode: "move",
          dragOffsetStep: step - existing.startStep,
          dragOffsetPitch: pitch - existing.pitch,
          startStep: existing.startStep,
          durationSteps: existing.durationSteps,
          lastPreviewPitch: existing.pitch
        };
      }
      suppressClick = true;
      return;
    }
    const snappedStep = Math.floor(step / currentInsertLength) * currentInsertLength;
    const newStart = snappedStep;
    const newEnd = newStart + currentInsertLength;
    const overlapping = active.core.getNotes().some(
      (n) => n.pitch === pitch && newStart < n.startStep + n.durationSteps - epsilon && newEnd > n.startStep + epsilon
    );
    if (!overlapping) {
      active.core.addNote(snappedStep, pitch, {
        noteLengthSteps: currentInsertLength
      });
      playPreview(pitch);
      const newNote = active.core.getNotes().find(
        (n) => Math.abs(n.startStep - snappedStep) < epsilon && n.pitch === pitch
      );
      if (newNote) {
        dragState = {
          noteId: newNote.id,
          mode: "move",
          dragOffsetStep: 0,
          dragOffsetPitch: 0,
          startStep: newNote.startStep,
          durationSteps: newNote.durationSteps,
          lastPreviewPitch: newNote.pitch
        };
        hasDragged = true;
      }
      suppressClick = true;
    }
  };
  const onPointerMove = (event) => {
    const active = getActive();
    if (activeToolMode === "pen") {
      if (!dragState) return;
      const { step, pitch } = getGridPosition(event);
      hasDragged = true;
      if (dragState.mode === "move") {
        const nextStart = step - dragState.dragOffsetStep;
        const snappedStart = Math.round(nextStart / snapGridSteps) * snapGridSteps;
        const nextPitch = pitch - dragState.dragOffsetPitch;
        if (hasNoteAt(snappedStart, nextPitch, dragState.noteId)) return;
        active.core.moveNote(dragState.noteId, snappedStart, nextPitch);
        if (nextPitch !== dragState.lastPreviewPitch) {
          dragState.lastPreviewPitch = nextPitch;
          playPreview(nextPitch);
        }
        return;
      }
      const rawDuration = step - dragState.startStep + 1;
      const snapped = snapToGrid(rawDuration);
      active.core.resizeNote(dragState.noteId, snapped);
      dragState.durationSteps = snapped;
      currentInsertLength = snapped;
      redrawAll();
      return;
    }
    if (activeToolMode === "select" && isSelecting && selectionStart) {
      const { x, y, step, pitch } = getGridPosition(event);
      if (dragMode === "rect") {
        const rect = {
          x: Math.min(x, selectionStart.x),
          y: Math.min(y, selectionStart.y),
          width: Math.abs(x - selectionStart.x),
          height: Math.abs(y - selectionStart.y)
        };
        selectionRect = rect;
        const { stepWidth, keyHeight, keyCount, pitchRangeStart } = renderConfig;
        const offset = getDrawOffset();
        selectedNotes = active.core.getNotes().filter((note) => {
          const logicalX = note.startStep * stepWidth;
          const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
          const logicalY = yIndex * keyHeight;
          const nx = logicalX - offset.x;
          const ny = logicalY - offset.y;
          const nw = note.durationSteps * stepWidth;
          return rect.x < nx + nw && rect.x + rect.width > nx && rect.y < ny + keyHeight && rect.y + rect.height > ny;
        });
        redrawAll();
      } else {
        const rawDeltaStep = step - selectionStart.step;
        const snappedDelta = Math.round(rawDeltaStep / snapGridSteps) * snapGridSteps;
        const deltaPitch = pitch - selectionStart.pitch;
        if (snappedDelta !== 0 || deltaPitch !== 0) {
          hasDragged = true;
          if (!active.core.isBatchOperation) active.core.beginBatch();
          for (const note of selectedNotes) {
            const orig = selectedOriginal.find((o) => o.id === note.id);
            if (!orig) continue;
            const newPitch = orig.pitch + deltaPitch;
            if (newPitch >= 0 && newPitch < 128)
              active.core.moveNote(
                note.id,
                orig.startStep + snappedDelta,
                newPitch
              );
          }
          if (selectedNotes.length > 0) {
            const grab = selectedNotes[0];
            const orig = selectedOriginal.find((o) => o.id === grab.id);
            if (orig) {
              const newGrab = orig.pitch + deltaPitch;
              if (newGrab !== lastMultiPreviewPitch && newGrab >= 0 && newGrab < 128) {
                lastMultiPreviewPitch = newGrab;
                playPreview(newGrab);
              }
            }
          }
        }
        redrawAll();
      }
    }
  };
  const onPointerUp = () => {
    if (activeToolMode === "pen" && dragState) {
      if (hasDragged) {
        const active = getActive();
        if (dragState.mode === "move")
          active.core.moveNoteEnd(dragState.noteId);
        else active.core.resizeNoteEnd(dragState.noteId);
        suppressClick = true;
      }
      dragState = null;
      hasDragged = false;
    }
    if (activeToolMode === "select" && isSelecting) {
      if (hasDragged && dragMode === "move" && selectedNotes.length > 0) {
        getActive().core.endBatch();
      }
      isSelecting = false;
      selectionStart = null;
      hasDragged = false;
      lastMultiPreviewPitch = null;
      selectionRect = null;
      selectedOriginal = [];
      redrawAll();
    }
  };
  const setupCanvas = () => {
    const w = refs.rollContainer.clientWidth || 800;
    const h = refs.rollContainer.clientHeight || 450;
    init(refs.wrapper, w, h, renderConfig);
    const gridCanvas = getGridCanvas();
    gridCanvas.addEventListener("pointerdown", onGridPointerDown);
    gridCanvas.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const { step, pitch } = getGridPosition(event);
      const active = getActive();
      const note = active.core.getNotes().find(
        (n) => n.pitch === pitch && step >= n.startStep && step < n.startStep + n.durationSteps
      );
      if (note) active.core.deleteNoteById(note.id);
    });
    gridCanvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        currentOffsetY = clamp(
          currentOffsetY + event.deltaY,
          0,
          getMaxOffsetY()
        );
        currentOffsetX = Math.max(0, currentOffsetX + event.deltaX);
        setDrawOffset(currentOffsetX, currentOffsetY);
        redrawAll();
      },
      { passive: false }
    );
    gridCanvas.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
      }
    });
    const headerCanvas = getHeaderCanvas();
    headerCanvas.addEventListener("click", (event) => {
      if (playbackState === "playing") return;
      const rect = headerCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const step = Math.floor((x + currentOffsetX) / renderConfig.stepWidth);
      playStartStep = Math.max(
        0,
        Math.floor(step / snapGridSteps) * snapGridSteps
      );
      redrawAll();
    });
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
  };
  const applyZoomX = () => {
    const canvas = getGridCanvas();
    const centerStep = (currentOffsetX + canvas.width / 2) / renderConfig.stepWidth;
    renderConfig.stepWidth = BASE_STEP_WIDTH * (zoomX * 2) / 100;
    refs.zoomXLabel.textContent = `${zoomX}%`;
    currentOffsetX = Math.max(
      0,
      centerStep * renderConfig.stepWidth - canvas.width / 2
    );
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
  };
  const applyZoomY = () => {
    const canvas = getGridCanvas();
    const centerKey = (currentOffsetY + canvas.height / 2) / renderConfig.keyHeight;
    renderConfig.keyHeight = BASE_KEY_HEIGHT * zoomY / 100;
    refs.zoomYLabel.textContent = `${zoomY}%`;
    currentOffsetY = clamp(
      centerKey * renderConfig.keyHeight - canvas.height / 2,
      0,
      getMaxOffsetY()
    );
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
  };
  const dispatchNote = (trackId, pitch, trackVol, velocity, when, duration) => {
    const volume = trackVol / 100 * (velocity / 127) * (masterVolume / 100);
    options.onPlayNote?.({ trackId, pitch, velocity, volume, when, duration });
  };
  const sequencer = createSequencer({
    getTracks: () => trackStates.map((t) => ({
      id: t.config.id,
      volume: t.volume,
      notes: t.core.getNotes()
    })),
    getBpm: () => bpm,
    getPlayStartStep: () => playStartStep,
    getDrumPattern: () => drumPatterns[currentDrumPattern] ?? null,
    getSoloTrackId: () => isSolo ? activeTrackId : null,
    getAudioTime,
    onPlayNote: (e) => {
      const volume = e.volume * (masterVolume / 100);
      options.onPlayNote?.({ ...e, volume });
    },
    onPlayDrum: (e) => {
      const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
      options.onPlayDrum?.({ ...e, velocity });
    },
    onTick: (step) => {
      currentPlayStep = step;
      const canvas = getGridCanvas();
      const visibleSteps = canvas.width / renderConfig.stepWidth;
      const threshold = currentOffsetX / renderConfig.stepWidth + visibleSteps - 4;
      if (currentPlayStep > threshold) {
        const visibleBars = Math.round(visibleSteps / renderConfig.stepsPerBar);
        currentOffsetX += visibleBars * renderConfig.stepsPerBar * renderConfig.stepWidth;
        setDrawOffset(currentOffsetX, currentOffsetY);
      }
      redrawAll();
    },
    onEnd: () => {
      playbackState = "stopped";
      currentPlayStep = 0;
      updateTransport();
      redrawAll();
    },
    stepsPerBar: renderConfig.stepsPerBar
  });
  const play = () => {
    options.onResumeAudio?.();
    if (playbackState === "playing") return;
    const fromStep = playbackState === "paused" ? pausedPlayStep : playStartStep;
    if (playbackState !== "paused") {
      const canvas = getGridCanvas();
      currentOffsetX = Math.max(
        0,
        playStartStep * renderConfig.stepWidth - canvas.width * 0.5
      );
      setDrawOffset(currentOffsetX, currentOffsetY);
    }
    playbackState = "playing";
    sequencer.start(fromStep);
    updateTransport();
  };
  const pause = () => {
    if (playbackState !== "playing") return;
    pausedPlayStep = currentPlayStep;
    sequencer.stop();
    playbackState = "paused";
    updateTransport();
  };
  const stop = () => {
    sequencer.stop();
    playbackState = "stopped";
    currentPlayStep = 0;
    updateTransport();
    redrawAll();
  };
  const togglePlay = () => {
    if (playbackState === "playing") stop();
    else play();
  };
  const updateTransport = () => {
    const playing = playbackState === "playing";
    const label = playing ? "\u505C\u6B62" : playbackState === "paused" ? "\u518D\u958B" : "\u8A66\u8074";
    refs.playBtn.innerHTML = `${icon(playing ? "stop" : "play")}<span>${label}</span>`;
    refs.playBtn.classList.toggle("dtm-play--stop", playing);
  };
  const updateUndoRedo = () => {
    const core = getActive().core;
    refs.undoBtn.disabled = !core.canUndo();
    refs.redoBtn.disabled = !core.canRedo();
  };
  const updateTrackPanel = () => {
    refs.trackTabs.innerHTML = "";
    for (const t of trackStates) {
      const [r, g, b] = t.config.color;
      const btn = document.createElement("button");
      btn.className = `dtm-pill ${t.config.id === activeTrackId ? "dtm-pill--active" : ""}`;
      btn.style.setProperty("--dtm-pill-color", `rgb(${r},${g},${b})`);
      btn.innerHTML = `<span class="dtm-dot"></span><span>${t.config.name}</span>`;
      btn.addEventListener("click", () => switchTrack(t.config.id));
      refs.trackTabs.appendChild(btn);
    }
    const active = getActive();
    refs.trackBody.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">velocity</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="track-vol" min="0" max="127" value="${active.volume}">
        <span class="dtm-label" data-dtm="track-vol-label">${active.volume}</span>
      </div>`;
    const volInput = refs.trackBody.querySelector(
      '[data-dtm="track-vol"]'
    );
    const volLabel = refs.trackBody.querySelector(
      '[data-dtm="track-vol-label"]'
    );
    volInput.addEventListener("input", () => {
      active.volume = Number.parseInt(volInput.value, 10);
      active.core.setVolume(active.volume);
      volLabel.textContent = String(active.volume);
    });
    if (active.config.id === "chord" && showChord) {
      const div = document.createElement("div");
      div.className = "dtm-row";
      div.style.flexDirection = "column";
      div.style.alignItems = "stretch";
      const roots = [
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
      div.innerHTML = `
        <div class="dtm-row">
          <span class="dtm-label">\u548C\u97F3</span>
          <select class="dtm-select" data-dtm="chord-pattern">
            <option value="block">\u30D6\u30ED\u30C3\u30AF</option>
            <option value="arpeggio">\u30A2\u30EB\u30DA\u30B8\u30AA</option>
            <option value="arpeggio-fast">\u30A2\u30EB\u30DA\u30B8\u30AA\uFF08\u30B8\u30E3\u30E9\u30FC\u30F3\uFF09</option>
            <option value="offbeat">\u88CF\u6253\u3061</option>
            <option value="yatsume">\u30E4\u30C4\u30E1\u7A74</option>
            <option value="alternating">\u4EA4\u4E92\u594F</option>
          </select>
          <select class="dtm-select" data-dtm="chord-root">
            ${roots.map((r, i) => `<option value="${i}">${r}</option>`).join("")}
          </select>
          <button class="dtm-btn dtm-btn--primary" data-dtm="chord-apply">\u9069\u7528</button>
        </div>
        <textarea class="dtm-textarea" data-dtm="chord-input" placeholder="\u4F8B: C|G|Am|Em|F|C|F|G">${active.savedChordInput}</textarea>`;
      refs.trackBody.appendChild(div);
      const patternSel = div.querySelector(
        '[data-dtm="chord-pattern"]'
      );
      const rootSel = div.querySelector(
        '[data-dtm="chord-root"]'
      );
      const input = div.querySelector(
        '[data-dtm="chord-input"]'
      );
      patternSel.value = active.savedChordPattern;
      rootSel.value = String(active.savedChordRoot);
      const save = () => {
        active.savedChordInput = input.value;
        active.savedChordPattern = patternSel.value;
        active.savedChordRoot = Number.parseInt(rootSel.value, 10);
      };
      patternSel.addEventListener("change", save);
      rootSel.addEventListener("change", save);
      input.addEventListener("input", save);
      div.querySelector('[data-dtm="chord-apply"]').addEventListener("click", () => {
        save();
        applyChord();
      });
    }
  };
  const switchTrack = (id) => {
    activeTrackId = id;
    updateTrackPanel();
    updateUndoRedo();
    redrawAll();
  };
  const setToolMode = (mode) => {
    activeToolMode = mode;
    for (const [btn, m] of [
      [refs.toolPen, "pen"],
      [refs.toolSelect, "select"],
      [refs.toolEraser, "eraser"]
    ]) {
      btn.classList.toggle("dtm-segbtn--active", m === mode);
    }
    if (mode !== "select") {
      selectionRect = null;
      selectedNotes = [];
    }
    redrawAll();
  };
  const generateMML = () => {
    const full = trackStates.map((t, i) => `@${i} ${t.core.getMML(t.volume).trim()}`).join(";\n");
    const minified = trackStates.map(
      (t, i) => `@${i}${t.core.getMML(t.volume).trim().replace(/\s+/g, "")}`
    ).join(";");
    return { full, minified };
  };
  const showMML = () => {
    const { full, minified } = generateMML();
    refs.outputFull.textContent = full;
    refs.outputMini.textContent = minified;
    refs.outputStatus.textContent = `(${trackStates.length}\u30C8\u30E9\u30C3\u30AF) \u901A\u5E38: ${full.length}\u6587\u5B57 / minify: ${minified.length}\u6587\u5B57`;
    refs.outputContainer.classList.remove("dtm-hidden");
    updateUndoRedo();
  };
  const clearAll = () => {
    for (const t of trackStates) {
      t.core.resetHistory();
      t.core.clearNotesWithoutHistory();
    }
    redrawAll();
  };
  const loadMML = (mml) => {
    if (!mml) return;
    clearAll();
    for (const t of trackStates) t.core.setLoadMode(true);
    const { placements, bpm: parsedBpm } = parseMML(mml, {
      stepsPerBar: renderConfig.stepsPerBar
    });
    for (const p of placements) {
      const t = trackStates[p.trackIndex];
      if (!t) continue;
      t.core.addNote(p.startStep, p.pitch, {
        noteLengthSteps: p.durationSteps
      });
    }
    if (parsedBpm) setBpm(parsedBpm);
    for (const t of trackStates) {
      t.core.setLoadMode(false);
      t.core.addHistoryOnce();
    }
    playStartStep = 0;
    currentOffsetX = 0;
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
    updateUndoRedo();
  };
  const applyChord = () => {
    if (!options.parseChord || !options.parseChords) return;
    const active = getActive();
    const chordTrack = trackStates.find((t) => t.config.id === "chord");
    if (!chordTrack) return;
    const placements = buildChordPlacements({
      chordStr: active.savedChordInput,
      patternType: active.savedChordPattern,
      rootShift: active.savedChordRoot,
      bpm,
      stepsPerBar: renderConfig.stepsPerBar,
      parseChord: options.parseChord,
      parseChords: options.parseChords
    });
    chordTrack.core.clearNotesWithoutHistory();
    chordTrack.core.beginBatch();
    for (const p of placements) {
      chordTrack.core.addNote(p.startStep, p.pitch, {
        noteLengthSteps: Math.max(1, p.durationSteps),
        velocity: p.velocity
      });
    }
    chordTrack.core.endBatch();
    chordTrack.core.addHistoryOnce();
    redrawAll();
  };
  const loadMIDI = (bytes) => {
    if (!options.parseMidi) return;
    const midi = options.parseMidi(bytes);
    const analysis = analyzeMidiTracks(midi);
    const selected = analysis.filter((a) => a.selected).map((a) => a.index);
    applyMidiSelection(midi, selected);
  };
  const applyMidiSelection = (midi, selectedIndices) => {
    clearAll();
    for (const t of trackStates) t.core.setLoadMode(true);
    const isAdvanced = trackStates.length > TRACKS_SIMPLE.length;
    const { placements, bpm: parsedBpm } = isAdvanced ? extractMidiPlacementsByTrack(
      midi,
      selectedIndices,
      trackStates.map((t) => t.config.id)
    ) : extractMidiPlacements(midi, selectedIndices);
    for (const p of placements) {
      const t = trackStates.find((ts) => ts.config.id === p.trackId);
      if (!t) continue;
      t.core.addNote(p.startStep, p.pitch, {
        noteLengthSteps: p.durationSteps,
        velocity: p.velocity
      });
    }
    setBpm(Math.round(parsedBpm));
    for (const t of trackStates) {
      t.core.setLoadMode(false);
      t.core.addHistoryOnce();
    }
    playStartStep = 0;
    currentOffsetX = 0;
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
    updateUndoRedo();
  };
  const exportMIDI2 = () => exportMIDI({
    tracks: trackStates.map((t) => ({
      notes: t.core.getNotes(),
      volume: t.volume
    })),
    drumPattern: drumPatterns[currentDrumPattern],
    drumVolume,
    bpm,
    stepsPerBar: renderConfig.stepsPerBar
  });
  const setBpm = (value) => {
    bpm = value;
    refs.bpmInput.value = String(value);
    for (const t of trackStates) t.core.setTempo(value);
  };
  let lastUndoTime = 0;
  const undo = () => {
    const now = Date.now();
    if (now - lastUndoTime < 100) return;
    lastUndoTime = now;
    getActive().core.undo();
    redrawAll();
    updateUndoRedo();
  };
  const redo = () => {
    getActive().core.redo();
    redrawAll();
    updateUndoRedo();
  };
  const overlayDuring = (fn) => {
    refs.overlay.hidden = false;
    setTimeout(() => {
      fn();
      refs.overlay.hidden = true;
    }, 30);
  };
  const wireEvents = () => {
    refs.playBtn.addEventListener("click", togglePlay);
    refs.playBtn.disabled = false;
    refs.recBtn.addEventListener("click", () => options.onToggleRecord?.());
    refs.recBtn.style.display = options.onToggleRecord ? "" : "none";
    refs.soloCheckbox.addEventListener("change", () => {
      isSolo = refs.soloCheckbox.checked;
    });
    refs.toolPen.addEventListener("click", () => setToolMode("pen"));
    refs.toolSelect.addEventListener("click", () => setToolMode("select"));
    refs.toolEraser.addEventListener("click", () => setToolMode("eraser"));
    refs.undoBtn.addEventListener("click", undo);
    refs.redoBtn.addEventListener("click", redo);
    refs.noteLengthSelect.addEventListener("change", () => {
      snapGridSteps = Number.parseInt(refs.noteLengthSelect.value, 10);
      currentInsertLength = snapGridSteps;
      redrawAll();
    });
    refs.bpmInput.addEventListener("input", () => {
      setBpm(Number.parseInt(refs.bpmInput.value, 10) || 120);
    });
    refs.zoomXIn.addEventListener("click", () => {
      zoomX = Math.min(200, zoomX + 25);
      applyZoomX();
    });
    refs.zoomXOut.addEventListener("click", () => {
      zoomX = Math.max(25, zoomX - 25);
      applyZoomX();
    });
    refs.zoomYIn.addEventListener("click", () => {
      zoomY = Math.min(200, zoomY + 25);
      applyZoomY();
    });
    refs.zoomYOut.addEventListener("click", () => {
      zoomY = Math.max(50, zoomY - 25);
      applyZoomY();
    });
    refs.masterVolume.addEventListener("input", () => {
      masterVolume = Number.parseInt(refs.masterVolume.value, 10) || 0;
      refs.masterVolumeLabel.textContent = `${masterVolume}%`;
    });
    refs.drumSelect.addEventListener("change", () => {
      currentDrumPattern = refs.drumSelect.value;
    });
    refs.drumVolume.addEventListener("input", () => {
      drumVolume = Number.parseInt(refs.drumVolume.value, 10) || 0;
      refs.drumVolumeLabel.textContent = `${drumVolume}%`;
    });
    refs.macroClear.addEventListener("click", () => {
      const active = getActive();
      active.core.beginBatch();
      active.core.clearNotesWithoutHistory();
      active.core.endBatch();
      active.core.saveHistory();
      redrawAll();
    });
    refs.macroRandom.addEventListener("click", () => {
      generateRandomPattern(getActive().core, {
        stepsPerBar: renderConfig.stepsPerBar,
        startStep: playStartStep,
        pitchRangeStart: renderConfig.pitchRangeStart
      });
      redrawAll();
    });
    refs.macroHarmonic.addEventListener("click", () => {
      const chord = trackStates.find((t) => t.config.id === "chord");
      if (!chord || activeTrackId === "chord") return;
      applyHarmonicFilter(getActive().core, chord.core, {
        stepsPerBar: renderConfig.stepsPerBar
      });
      redrawAll();
    });
    refs.macroMono.addEventListener("click", () => {
      const chord = trackStates.find((t) => t.config.id === "chord");
      if (!chord || activeTrackId === "chord") return;
      applyMonophonic(getActive().core, chord.core, {
        stepsPerBar: renderConfig.stepsPerBar
      });
      redrawAll();
    });
    refs.generateMmlBtn.addEventListener("click", showMML);
    refs.exportMidiBtn.addEventListener("click", () => {
      const blob = exportMIDI2();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dtm.mid";
      a.click();
      URL.revokeObjectURL(url);
    });
    const copy = (text, btn) => {
      navigator.clipboard?.writeText(text);
      btn.classList.add("dtm-btn--success");
      setTimeout(() => btn.classList.remove("dtm-btn--success"), 1200);
    };
    refs.copyFullBtn.addEventListener(
      "click",
      () => copy(refs.outputFull.textContent ?? "", refs.copyFullBtn)
    );
    refs.copyMiniBtn.addEventListener(
      "click",
      () => copy(refs.outputMini.textContent ?? "", refs.copyMiniBtn)
    );
    refs.mmlLoadBtn.addEventListener(
      "click",
      () => overlayDuring(() => loadMML(refs.mmlInput.value))
    );
    refs.shiftApplyBtn.addEventListener(
      "click",
      () => overlayDuring(() => {
        shiftNotes(
          trackStates.map((t) => t.core),
          Number.parseInt(refs.shiftSelect.value, 10) || 0
        );
        redrawAll();
      })
    );
    if (showMidi) wireMidi();
    document.addEventListener("keydown", onKeyDown);
    for (const ta of refs.root.querySelectorAll("textarea, input")) {
      ta.addEventListener("keydown", (e) => {
        const ke = e;
        if ((ke.ctrlKey || ke.metaKey) && ["KeyZ", "KeyY", "KeyV", "KeyC", "KeyX"].includes(ke.code))
          e.stopPropagation();
      });
    }
  };
  let pendingMidi = null;
  let detectedTracks = [];
  const wireMidi = () => {
    refs.midiInput.addEventListener("change", async () => {
      const file = refs.midiInput.files?.[0];
      if (!file || !options.parseMidi) return;
      refs.overlay.hidden = false;
      const buffer = new Uint8Array(await file.arrayBuffer());
      pendingMidi = options.parseMidi(buffer);
      detectedTracks = analyzeMidiTracks(pendingMidi);
      refs.midiTrackSelection.innerHTML = `<span class="dtm-label">\u30C8\u30E9\u30C3\u30AF</span>`;
      detectedTracks.forEach((t, i) => {
        const btn = document.createElement("button");
        btn.className = `dtm-btn ${t.selected ? "dtm-btn--primary" : "dtm-btn--ghost"}`;
        btn.dataset.selected = String(t.selected);
        btn.textContent = `${t.name} (${t.noteCount})`;
        btn.addEventListener("click", () => {
          const on = btn.dataset.selected !== "true";
          btn.dataset.selected = String(on);
          btn.classList.toggle("dtm-btn--primary", on);
          btn.classList.toggle("dtm-btn--ghost", !on);
        });
        refs.midiTrackSelection.appendChild(btn);
        if (i === 0) refs.midiTrackSelection.dataset.ready = "1";
      });
      refs.midiTrackSelection.classList.remove("dtm-hidden");
      refs.overlay.hidden = true;
    });
    refs.midiLoadBtn.addEventListener("click", () => {
      if (!pendingMidi) return;
      const selected = [];
      const btns = refs.midiTrackSelection.querySelectorAll("button");
      btns.forEach((b, i) => {
        if (b.dataset.selected === "true")
          selected.push(detectedTracks[i].index);
      });
      if (selected.length === 0) return;
      overlayDuring(() => applyMidiSelection(pendingMidi, selected));
    });
  };
  const onKeyDown = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.code === "KeyZ" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (e.code === "KeyZ" && e.shiftKey || e.code === "KeyY") {
      e.preventDefault();
      redo();
    } else if (e.code === "KeyC" && selectedNotes.length > 0) {
      e.preventDefault();
      copiedNotes = [...selectedNotes];
    } else if (e.code === "KeyX" && selectedNotes.length > 0) {
      e.preventDefault();
      copiedNotes = [...selectedNotes];
      const core = getActive().core;
      core.beginBatch();
      for (const n of selectedNotes) core.deleteNoteById(n.id);
      core.endBatch();
      selectedNotes = [];
    } else if (e.code === "KeyV" && copiedNotes.length > 0) {
      e.preventDefault();
      const core = getActive().core;
      const notes = core.getNotes();
      const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
      core.beginBatch();
      for (const note of copiedNotes) {
        const newStart = playStartStep + (note.startStep - minStart);
        const newEnd = newStart + note.durationSteps;
        const overlap = notes.some(
          (ex) => ex.pitch === note.pitch && newStart < ex.startStep + ex.durationSteps && newEnd > ex.startStep
        );
        if (!overlap)
          core.addNote(newStart, note.pitch, {
            noteLengthSteps: note.durationSteps,
            velocity: note.velocity
          });
      }
      core.endBatch();
      redrawAll();
    }
  };
  setupCanvas();
  createTrackStates();
  ready = true;
  initScrollbarDrag();
  wireEvents();
  setBpm(bpm);
  updateTrackPanel();
  updateTransport();
  updateUndoRedo();
  redrawAll();
  if (options.initialMML) loadMML(options.initialMML);
  let resizeTimer = null;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => setupCanvas(), 150);
  });
  resizeObserver.observe(refs.rollContainer);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  return {
    play,
    pause,
    stop,
    getMML: generateMML,
    loadMML,
    loadMIDI,
    exportMIDI: exportMIDI2,
    setBpm,
    getPlaybackState: () => playbackState,
    destroy: () => {
      sequencer.stop();
      resizeObserver.disconnect();
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      target.innerHTML = "";
    }
  };
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
  DAW_CSS,
  DRUM_FONT,
  DRUM_KEYS,
  DRUM_PATTERNS,
  INSTRUMENT_PRESETS,
  LinkedList,
  MMLCore,
  PITCH_MAP,
  TRACKS_ADVANCED,
  TRACKS_SIMPLE,
  analyzeMidiTracks,
  applyHarmonicFilter,
  applyMonophonic,
  buildChordPlacements,
  buildNameToKeyMapping,
  createAudioContext,
  createPianoRoll,
  createSequencer,
  drawGrid,
  drawHeader,
  drawKeyboard,
  drawNotes,
  drawSelectedNotes,
  drawSelectionRect,
  exportMIDI,
  extractMidiPlacements,
  extractMidiPlacementsByTrack,
  fetchSoundFontList,
  generateRandomPattern,
  getDrawOffset,
  getGridCanvas,
  getGridContext,
  getGridPosition,
  getHeaderCanvas,
  getMidiBPM,
  getRenderConfig,
  getXY,
  icon,
  init,
  injectStyles,
  mountDAW,
  onClick,
  parseMML,
  setDrawOffset,
  setupRecorder,
  shiftNotes
};
