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

// node_modules/.pnpm/@onjmin+chord-parser@1.0.2/node_modules/@onjmin/chord-parser/dist/index.mjs
var SHARP_NAMES = [
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
var FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B"
];
var toPitchClass = (n) => (n % 12 + 12) % 12;
var noteName = (pc, flat = false) => (flat ? FLAT_NAMES : SHARP_NAMES)[toPitchClass(pc)];
var SyntaxErrorWithPos = class extends Error {
  constructor(input, msg) {
    super(
      `SyntaxError: ${msg}
input.idx: ${input.idx}
input.str: ${input.str}`
    );
    this.name = "ChordSyntaxError";
  }
};
var err = (input, msg) => {
  throw new SyntaxErrorWithPos(input, msg);
};
var Input = class _Input {
  static nums = new Set("0123456789");
  str;
  nest;
  idx;
  constructor(str, nest = 0) {
    this.str = str;
    this.nest = nest;
    this.idx = 0;
  }
  get isEOF() {
    return this.str.length <= this.idx;
  }
  get char() {
    return this.str[this.idx];
  }
  /** 先頭の連続する数字を消費して数値で返す（破壊的）。数字が無ければ null。 */
  get num() {
    let str = "";
    while (!this.isEOF) {
      const char = this.char;
      if (!_Input.nums.has(char)) break;
      str += char;
      this.idx++;
    }
    return str.length ? Number(str) : null;
  }
  slice(i) {
    return this.str.slice(this.idx, this.idx + i);
  }
};
var Output = class {
  pitch = null;
  chord = null;
  isChord = false;
  pending = null;
  nest = -1;
  get value() {
    const { pitch, chord } = this;
    return new Set(
      [...chord].map((v) => v + pitch)
    );
  }
  set value(chord) {
    const pitch = this.pitch;
    this.chord = new Set([...chord].map((v) => v - pitch));
  }
};
var Matcher = class {
  map = /* @__PURE__ */ new Map();
  /** キー長を降順で保持（最長一致のため）。 */
  lengths = [];
  _set(key, value) {
    this.map.set(key, value);
    if (!this.lengths.includes(key.length)) {
      this.lengths.push(key.length);
      this.lengths.sort((a, b) => b - a);
    }
  }
  set(key, value) {
    if (Array.isArray(key)) for (const k of key) this._set(k, value);
    else this._set(key, value);
  }
  parse(input) {
    for (const i of this.lengths) {
      const s = input.slice(i);
      if (this.map.has(s)) {
        input.idx += s.length;
        return this.map.get(s);
      }
    }
    return null;
  }
};
var BRACKET_START = 0;
var BRACKET_END = 1;
var COMMA = 2;
var DIVIDE = 3;
var formulaMatcher = new Matcher();
formulaMatcher.set("(", BRACKET_START);
formulaMatcher.set(")", BRACKET_END);
formulaMatcher.set(",", COMMA);
formulaMatcher.set(["/", "on"], DIVIDE);
var parseFormula = (input, output = new Output(), nest = 0) => {
  let start = input.idx;
  const _eval = (idx) => {
    const str = input.str.slice(start, idx);
    if (str.length) parseTerm(new Input(str, nest), output);
  };
  while (true) {
    const { idx } = input;
    if (input.isEOF) {
      if (nest) err(input, `Unclosed ${nest} brackets`);
      _eval(idx);
      return output;
    }
    const res = formulaMatcher.parse(input);
    if (res === null) {
      input.idx++;
      continue;
    }
    const { pending } = output;
    _eval(idx);
    switch (res) {
      case BRACKET_START:
        parseFormula(input, output, nest + 1);
        break;
      case BRACKET_END:
        if (nest - 1 < 0) err(input, "Unable to close brackets");
        return output;
      case COMMA:
        output.pending = pending;
        break;
      case DIVIDE: {
        const o = parseFormula(input, new Output(), nest);
        const v = [...output.value];
        if (o.isChord) {
          output.value = [...o.value].concat(v);
        } else {
          const a = v.sort((x, y) => x - y);
          const pitch = (o.pitch + 3) % 12 - 3;
          if (a[0] < pitch) {
            while (a[0] < pitch) a.push(a.shift() + 12);
          } else {
            while (true) {
              const w = a[a.length - 1] - 12;
              if (w < pitch) break;
              a.pop();
              a.unshift(w);
            }
          }
          a.push(pitch);
          output.value = a;
        }
        break;
      }
    }
    start = input.idx;
  }
};
var parseTerm = (input, output) => {
  if (input.isEOF) return output;
  if (output.pitch === null) return parsePitch(input, output);
  if (output.pending === null) return parseFunc(input, output);
  return parsePending(input, output);
};
var halfMatcher = new Matcher();
var halfMatcherStrict = new Matcher();
for (const m of [halfMatcher, halfMatcherStrict]) {
  m.set(["#", "\u266F"], 1);
  m.set(["b", "\u266D"], -1);
}
halfMatcher.set("+", 1);
halfMatcher.set("-", -1);
var parseHalf = (input, isPitch = false) => (isPitch ? halfMatcherStrict : halfMatcher).parse(input);
var idx2pitch = [0, 2, 4, 5, 7, 9, 11];
for (const i of [...idx2pitch.keys()]) idx2pitch.push(idx2pitch[i] + 12);
var deg2pitch = (deg) => idx2pitch[deg - 1];
var pitchMatcher = new Matcher();
for (const [i, v] of [..."CDEFGAB"].entries())
  pitchMatcher.set(v, idx2pitch[i]);
var parsePitch = (input, output) => {
  const pitch = pitchMatcher.parse(input);
  if (pitch === null) err(input, "Not found pitch");
  output.pitch = pitch;
  const half = parseHalf(input, true);
  if (half !== null) output.pitch += half;
  return parseBase(input, output);
};
var MAJOR = [0, 4, 7];
var DIM = [0, 3, 6];
var baseMatcher = new Matcher();
baseMatcher.set(["m", "min", "Min", "minor", "Minor", "-"], [0, 3, 7]);
baseMatcher.set(["dim", "\u3007"], DIM);
baseMatcher.set("+", [0, 4, 8]);
baseMatcher.set(["\u03A6", "\u03C6", "\xF8"], [0, 3, 6, 10]);
var parseBase = (input, output) => {
  const isMajMarker = /^maj/i.test(input.str.slice(input.idx));
  const res = isMajMarker ? null : baseMatcher.parse(input);
  if (res !== null) output.isChord = true;
  output.chord = new Set(res || MAJOR);
  if (res === DIM) {
    const { num } = input;
    const chord = output.chord;
    if (num !== null) chord.add(deg2pitch(num) - 2);
  }
  output.nest = input.nest;
  return parseTerm(input, output);
};
var add = (chord, n, half) => {
  chord.add(deg2pitch(n) + half);
};
var aug = (chord) => {
  chord.delete(deg2pitch(5));
  chord.add(deg2pitch(5) + 1);
};
var _7th = (chord, n, _half2, isFlat = false) => {
  if (n === 5) chord.delete(deg2pitch(3));
  else if (n === 6) chord.add(deg2pitch(6));
  else if (n === 69) chord.add(deg2pitch(6)).add(deg2pitch(9));
  else {
    if (n >= 7) chord.add(deg2pitch(7) + (isFlat ? -1 : 0));
    if (n >= 9) chord.add(deg2pitch(9));
    if (n >= 11) chord.add(deg2pitch(11));
    if (n >= 13) chord.add(deg2pitch(13));
  }
};
var _half = (chord, n, half) => {
  chord.delete(deg2pitch(n));
  chord.add(deg2pitch(n) + half);
};
var funcMatcher = new Matcher();
funcMatcher.set("add", add);
funcMatcher.set(["omit", "no"], (chord, n, half) => {
  chord.delete(deg2pitch(n) + half);
});
funcMatcher.set("sus", (chord, n, half) => {
  chord.delete(deg2pitch(3));
  chord.add(deg2pitch(n) + half);
});
funcMatcher.set(
  ["M", "maj", "Maj", "major", "Major", "\u25B3", "\u0394"],
  _7th
);
funcMatcher.set("aug", aug);
var parseFunc = (input, output) => {
  if (!output.isChord) output.isChord = true;
  const func = funcMatcher.parse(input);
  const chord = output.chord;
  if (func === null) {
    const isAug = input.char === "+";
    const half = parseHalf(input);
    const { num } = input;
    if (num === null) {
      if (isAug) aug(chord);
      else err(input, "Not found number");
    }
    if (half === null) {
      if (input.nest === output.nest) _7th(chord, num, 0, true);
      else add(chord, num, 0);
    } else {
      _half(chord, num, half);
    }
  } else if (func === aug) {
    aug(chord);
  } else {
    output.pending = func;
  }
  return parseTerm(input, output);
};
var parsePending = (input, output) => {
  const half = parseHalf(input);
  const { num } = input;
  const { pending, chord } = output;
  if (num === null) err(input, "Not found number");
  pending(
    chord,
    num,
    half === null ? 0 : half
  );
  output.pending = null;
  return parseTerm(input, output);
};
var parseChord = (symbol) => {
  const output = parseFormula(new Input(symbol));
  const notes = [...output.value].sort((a, b) => a - b);
  const intervals = [...output.chord].sort((a, b) => a - b);
  const pitchClasses = [...new Set(notes.map(toPitchClass))].sort(
    (a, b) => a - b
  );
  return {
    symbol,
    root: toPitchClass(output.pitch),
    notes,
    pitchClasses,
    intervals
  };
};
var QUALITY_SOURCE = [
  "",
  // major
  "m",
  // minor
  "7",
  // dominant 7th
  "M7",
  // major 7th
  "m7",
  // minor 7th
  "dim",
  // diminished triad
  "m7b5",
  // half-diminished
  "aug",
  // augmented triad
  "6",
  // major 6th
  "m6",
  // minor 6th
  "sus4",
  "sus2",
  "mM7",
  // minor major 7th
  "dim7",
  // diminished 7th
  "7sus4",
  "7#5",
  // augmented 7th
  "add9",
  "madd9",
  "9",
  "M9",
  "m9",
  "69",
  "m69",
  "5"
  // power chord
];
var QUALITIES = QUALITY_SOURCE.map(
  (quality, priority) => ({
    quality,
    pitchClasses: parseChord(`C${quality}`).pitchClasses,
    priority
  })
);
var QUALITY_BY_PCSET = (() => {
  const map = /* @__PURE__ */ new Map();
  for (const def of QUALITIES) {
    const key = def.pitchClasses.join(",");
    if (!map.has(key)) map.set(key, def);
  }
  return map;
})();
var detectChord = (notes, options = {}) => {
  if (!notes.length) return [];
  const { flat = false } = options;
  const pcs = [...new Set(notes.map(toPitchClass))].sort((a, b) => a - b);
  const bass = toPitchClass(
    options.bass ?? notes.reduce((m, v) => Math.min(m, v), notes[0])
  );
  const scored = [];
  for (const root of pcs) {
    const relSet = new Set(pcs.map((pc) => toPitchClass(pc - root)));
    for (const def of QUALITY_BY_PCSET.values()) {
      let matchCount = 0;
      let hasRoot = false;
      for (const pc of def.pitchClasses) {
        if (relSet.has(pc)) {
          matchCount++;
          if (pc === 0) hasRoot = true;
        }
      }
      if (!hasRoot) continue;
      if (matchCount < Math.min(2, def.pitchClasses.length)) continue;
      const missingCount = def.pitchClasses.length - matchCount;
      let extraCount = 0;
      const defSet = new Set(def.pitchClasses);
      for (const pc of relSet) {
        if (!defSet.has(pc)) {
          extraCount++;
        }
      }
      const score = matchCount * 2 - missingCount * 1 - extraCount * 0.5;
      const rootSymbol = noteName(root, flat) + def.quality;
      const inversion = root !== bass;
      scored.push({
        score,
        priority: def.priority,
        candidate: {
          symbol: inversion ? `${rootSymbol}/${noteName(bass, flat)}` : rootSymbol,
          rootSymbol,
          root,
          quality: def.quality,
          bass,
          inversion
        }
      });
    }
  }
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-3) return b.score - a.score;
    if (a.candidate.inversion !== b.candidate.inversion)
      return a.candidate.inversion ? 1 : -1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.candidate.root - b.candidate.root;
  });
  return scored.map((s) => s.candidate);
};
var toneRoleWeight = (rel) => {
  if (rel === 0) return 1.3;
  if (rel === 3 || rel === 4) return 1.2;
  if (rel === 10 || rel === 11) return 0.95;
  if (rel === 6 || rel === 7 || rel === 8) return 0.7;
  return 0.85;
};
var CHORD_TEMPLATES = (() => {
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const def of QUALITIES) {
      const pcs = /* @__PURE__ */ new Set();
      const weights = new Array(12).fill(0);
      const rel = /* @__PURE__ */ new Set();
      for (const relPc of def.pitchClasses) {
        rel.add(relPc);
        const pc = toPitchClass(relPc + root);
        pcs.add(pc);
        weights[pc] = toneRoleWeight(relPc);
      }
      templates.push({
        root,
        quality: def.quality,
        priority: def.priority,
        pcs,
        weights,
        rel
      });
    }
  }
  return templates;
})();
var toHan = (str) => str.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 65248)).replace(/　/g, " ");
var parseChords = (str, bpm = 120) => {
  const output = [];
  const secBar = 60 / bpm * 4;
  const frontChars = new Set("ABCDEFG_=%N");
  let idx = 0;
  let last = null;
  for (const line of toHan(str).split("\n").map((v) => v.trim())) {
    if (!line.length || /^#/.test(line)) continue;
    for (const str2 of line.split(/[|lｌ→]/)) {
      if (!str2.length) continue;
      const when = idx++ * secBar;
      const a = [];
      for (let i = 0; i < str2.length; i++) {
        const char = str2[i];
        const prev = str2[i - 1];
        const prev2 = str2.slice(i - 2, i);
        if (!frontChars.has(char)) continue;
        if (prev === "/" || prev2 === "on") continue;
        if (prev2 === "N." && char === "C") continue;
        a.push(i);
      }
      if (!a.length) continue;
      const divide = 2 ** Math.ceil(Math.log2(a.length));
      const unitTime = secBar / divide;
      for (const [i, v] of a.entries()) {
        const s = str2.slice(v, i === a.length - 1 ? str2.length : a[i + 1]).replace(/\s+/g, "");
        const c = s[0];
        if (c === "_" || c === "N") {
          last = null;
          continue;
        }
        if (c === "=") {
          if (last) last.duration += unitTime;
          continue;
        }
        const _when = when + i * unitTime;
        if (c === "%") {
          if (last === null) continue;
          const base = last;
          last = { ...base, when: _when, duration: unitTime };
        } else {
          const key = s.slice(0, s[1] === "#" ? 2 : 1);
          const chord = s.slice(key.length).replace(/[\s・]/g, "");
          last = {
            key,
            chord,
            when: _when,
            duration: unitTime
          };
        }
        output.push(last);
      }
      if (last !== null && divide > a.length)
        last.duration += unitTime * (divide - a.length);
    }
  }
  return output;
};

// src/chords.ts
var C3 = 48;
var buildChordPlacements = (options) => {
  const { chordStr, patternType, rootShift, bpm, stepsPerBar } = options;
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
          notes = [...parseChord(`${chord.key}${chord.chord}`).notes];
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
        notes = [...parseChord(chordName).notes];
      } catch {
        return;
      }
      if (notes.length === 0) return;
      const startStep = barIndex * chordLength;
      notes.forEach((noteOffset, i) => {
        const stepOffset = i * 3;
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
    <div class="dtm-roll" data-dtm="roll">
      <div data-dtm="wrapper" style="position:absolute;inset:0;"></div>
      <div class="dtm-overlay" data-dtm="overlay" hidden><div class="dtm-spinner"></div></div>
    </div>
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
        <textarea class="dtm-textarea dtm-grow" data-dtm="mml-input" placeholder="MML\u3092\u5165\u529B"></textarea>
        <button class="dtm-btn dtm-btn--primary" data-dtm="mml-load">\u8AAD\u8FBC</button>
      </div>
      <div class="dtm-row">
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
      <label class="dtm-checkbox-label">
        <input type="checkbox" class="dtm-checkbox" data-dtm="decompose-chord">
        <span>\u548C\u97F3\u5206\u89E3\u30E2\u30FC\u30C9\uFF08\u5358\u97F3\u30C8\u30E9\u30C3\u30AF\u306B\u6700\u9069\u5206\u5272\uFF09</span>
      </label>
      <label class="dtm-checkbox-label dtm-checkbox-label--sub">
        <input type="checkbox" class="dtm-checkbox" data-dtm="ignore-chord-heavy">
        <span>\u548C\u97F3\u4F34\u594F\u30C8\u30E9\u30C3\u30AF\u3092\u7121\u8996\uFF08\u5206\u89E3\u5BFE\u8C61\u304B\u3089\u9664\u5916\uFF09</span>
      </label>
      <div class="dtm-row" style="margin-top:6px;align-items:center;gap:8px;">
        <span class="dtm-label">\u751F\u6210\u4E0A\u9650</span>
        <select class="dtm-select" data-dtm="bar-limit">
          <option value="0">\u5236\u9650\u306A\u3057</option>
          <option value="8">8\u5C0F\u7BC0</option>
          <option value="16">16\u5C0F\u7BC0</option>
          <option value="24">24\u5C0F\u7BC0</option>
          <option value="32">32\u5C0F\u7BC0</option>
          <option value="64">64\u5C0F\u7BC0</option>
          <option value="128">128\u5C0F\u7BC0</option>
        </select>
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
    decomposeChordToggle: sel("decompose-chord"),
    ignoreChordHeavyToggle: sel("ignore-chord-heavy"),
    barLimitSelect: sel("bar-limit"),
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

// node_modules/.pnpm/@onjmin+koe@1.0.3/node_modules/@onjmin/koe/dist/index.js
var MAGIC = 1263486208;
function parseKoeHeader(headerBytes) {
  const view = new DataView(headerBytes);
  if (view.byteLength < 8 || view.getUint32(0, false) !== MAGIC) {
    throw new Error("Not a .koe file (bad magic)");
  }
  return { jsonLength: view.getUint32(4, true) };
}
var pcmBase = (jsonLength) => 8 + jsonLength;
var BlobVoiceSource = class {
  constructor(blob, base) {
    this.blob = blob;
    this.base = base;
  }
  blob;
  base;
  readBytes(offset, length) {
    const start = this.base + offset;
    return this.blob.slice(start, start + length).arrayBuffer();
  }
};
var RangeVoiceSource = class {
  constructor(url, base) {
    this.url = url;
    this.base = base;
  }
  url;
  base;
  async readBytes(offset, length) {
    const start = this.base + offset;
    const res = await fetch(this.url, {
      headers: { Range: `bytes=${start}-${start + length - 1}` }
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`.koe range request failed: ${res.status}`);
    }
    return res.arrayBuffer();
  }
};
async function rangeFetch(url, start, length) {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${start + length - 1}` }
  });
  if (!res.ok && res.status !== 206)
    throw new Error(`.koe fetch failed: ${res.status}`);
  return res.arrayBuffer();
}
var VoiceBank = class _VoiceBank {
  constructor(manifest, source) {
    this.manifest = manifest;
    this.source = source;
  }
  manifest;
  source;
  /**
   * Parse a .koe archive header + manifest and bind a lazy PCM source.
   * @param koe a Blob/File of the .koe archive, or a URL (served with Range support)
   */
  static async load(koe) {
    if (typeof koe === "string") {
      const header2 = await rangeFetch(koe, 0, 8);
      const { jsonLength: jsonLength2 } = parseKoeHeader(header2);
      const json2 = await rangeFetch(koe, 8, jsonLength2);
      const manifest2 = JSON.parse(new TextDecoder().decode(json2));
      return new _VoiceBank(
        manifest2,
        new RangeVoiceSource(koe, pcmBase(jsonLength2))
      );
    }
    const header = await koe.slice(0, 8).arrayBuffer();
    const { jsonLength } = parseKoeHeader(header);
    const json = await koe.slice(8, 8 + jsonLength).arrayBuffer();
    const manifest = JSON.parse(new TextDecoder().decode(json));
    return new _VoiceBank(
      manifest,
      new BlobVoiceSource(koe, pcmBase(jsonLength))
    );
  }
  /** True if the bank contains a phoneme under this alias. */
  has(phoneme) {
    return this.manifest.phonemes[phoneme] !== void 0;
  }
  /**
   * Raw Int16 PCM bytes (48 kHz / mono) for a phoneme, or null if unknown.
   * The returned ArrayBuffer is freshly allocated and safe to transfer to a
   * worker / AudioWorklet.
   */
  async readPcmBytes(phoneme) {
    const entry = this.manifest.phonemes[phoneme];
    if (!entry) return null;
    return this.source.readBytes(entry.offset, entry.length * 2);
  }
  /**
   * A phoneme's PCM as a Float64Array normalised to [-1, 1], or null if unknown.
   * Intended for external analysis / resynthesis such as the WORLD vocoder.
   */
  async getPcm(phoneme) {
    const buf = await this.readPcmBytes(phoneme);
    if (!buf) return null;
    const int16 = new Int16Array(buf);
    const f64 = new Float64Array(int16.length);
    for (let i = 0; i < int16.length; i++) f64[i] = int16[i] / 32768;
    return f64;
  }
};
var WORLDLINE_SAMPLE_RATE = 48e3;
var MIN_WORLDLINE_SAMPLES = 4096;
var SYNTH_REQ_SIZE = 120;
var WL_FRAME_MS = 10;
var samplesToMs = (samples) => samples / WORLDLINE_SAMPLE_RATE * 1e3;
function leadInFromEntry(entry) {
  return {
    preMs: samplesToMs(entry.pre || 0),
    consonantMs: samplesToMs(entry.consonant || 0)
  };
}
var moduleCache = /* @__PURE__ */ new Map();
function injectScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-koe-worldline="${src}"]`
    );
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.dataset.koeWorldline = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`worldline: failed to load ${src}`));
    document.head.appendChild(s);
  });
}
function loadWasm(scriptUrl) {
  const cached = moduleCache.get(scriptUrl);
  if (cached) return cached;
  const baseUrl = scriptUrl.slice(0, scriptUrl.lastIndexOf("/") + 1);
  const instantiate = () => {
    const factory = globalThis.WorldlineModule;
    if (!factory)
      throw new Error(
        "worldline: WorldlineModule global was not defined by the script"
      );
    return factory({ locateFile: (f) => baseUrl + f });
  };
  let promise;
  if (typeof document !== "undefined") {
    promise = injectScript(scriptUrl).then(instantiate);
  } else if (typeof globalThis.importScripts === "function") {
    promise = Promise.resolve().then(() => {
      globalThis.importScripts(scriptUrl);
      return instantiate();
    });
  } else {
    return Promise.reject(
      new Error(
        "Worldline.load requires a DOM or a classic Web Worker (importScripts) to load worldline.js"
      )
    );
  }
  moduleCache.set(scriptUrl, promise);
  return promise;
}
var Worldline = class _Worldline {
  constructor(wasm) {
    this.wasm = wasm;
  }
  wasm;
  sampleRate = WORLDLINE_SAMPLE_RATE;
  /**
   * Load + instantiate the worldline WASM module (deduped per scriptUrl).
   *
   * Works on the main thread (loads via `<script>`) and inside a classic Web
   * Worker (loads via `importScripts`), so the heavy synthesis can run
   * off-thread. The matching `worldline.wasm` is fetched next to scriptUrl.
   */
  static async load(options) {
    return new _Worldline(await loadWasm(options.scriptUrl));
  }
  /**
   * Render one note to Float32 PCM at 48 kHz.
   *
   * The output buffer is laid out as [lead-in/consonant ≈ preMs][vowel ≈
   * durationMs], rendered from sample offset 0 (no leading silence). The vowel
   * onset (the "beat") sits at ≈ preMs into the buffer, so a sequencer should
   * place the buffer at `beatTime − preMs` and may trim/crossfade the lead-in.
   *
   * No internal crossfade is applied — apply fades externally.
   *
   * @returns Float32 PCM, or null when `pcm` is shorter than
   *          {@link MIN_WORLDLINE_SAMPLES} (too short for stable F0 analysis).
   */
  renderNote(params) {
    const { pcm, pitch, durationMs, preMs, consonantMs, tempo = 120 } = params;
    if (!pcm || pcm.length < MIN_WORLDLINE_SAMPLES) return null;
    const WL = this.wasm;
    const FS = WORLDLINE_SAMPLE_RATE;
    const midiNote = Math.round(69 + 12 * Math.log2(pitch / 440));
    const posMs = 0;
    const reqLen = preMs + durationMs;
    const cutMs = WL_FRAME_MS * 2;
    const ps = WL._PhraseSynthNew();
    if (!ps) return null;
    const reqPtr = WL._malloc(SYNTH_REQ_SIZE);
    if (!reqPtr) {
      WL._PhraseSynthDelete(ps);
      return null;
    }
    const samplePtr = WL._malloc(pcm.length * 8);
    if (!samplePtr) {
      WL._free(reqPtr);
      WL._PhraseSynthDelete(ps);
      return null;
    }
    WL.HEAPF64.set(pcm, samplePtr >> 3);
    const sv = (off, val, type) => WL.setValue(reqPtr + off, val, type);
    sv(0, FS, "i32");
    sv(4, pcm.length, "i32");
    sv(8, samplePtr, "*");
    sv(12, 0, "i32");
    sv(16, 0, "*");
    sv(20, midiNote, "i32");
    sv(24, 100, "double");
    sv(32, 0, "double");
    sv(40, reqLen, "double");
    sv(48, consonantMs, "double");
    sv(56, cutMs, "double");
    sv(64, 100, "double");
    sv(72, 0, "double");
    sv(80, tempo, "double");
    sv(88, 0, "i32");
    sv(92, 0, "*");
    sv(96, 0, "i32");
    sv(100, 0, "i32");
    sv(104, 100, "i32");
    sv(108, 0, "i32");
    sv(112, 0, "i32");
    sv(116, 100, "i32");
    WL._PhraseSynthAddRequest(ps, reqPtr, posMs, 0, reqLen, 0, 0, 0);
    WL._free(samplePtr);
    WL._free(reqPtr);
    const totalMs = posMs + reqLen + WL_FRAME_MS * 2;
    const nFrames = Math.ceil(totalMs / WL_FRAME_MS) + 4;
    const f0Arr = new Float64Array(nFrames).fill(pitch);
    const gArr = new Float64Array(nFrames).fill(0.5);
    const tArr = new Float64Array(nFrames).fill(0.5);
    const bArr = new Float64Array(nFrames).fill(0.5);
    const vArr = new Float64Array(nFrames).fill(1);
    const f0Ptr = WL._malloc(nFrames * 8);
    const gPtr = WL._malloc(nFrames * 8);
    const tPtr = WL._malloc(nFrames * 8);
    const bPtr = WL._malloc(nFrames * 8);
    const vPtr = WL._malloc(nFrames * 8);
    if (!f0Ptr || !gPtr || !tPtr || !bPtr || !vPtr) {
      if (f0Ptr) WL._free(f0Ptr);
      if (gPtr) WL._free(gPtr);
      if (tPtr) WL._free(tPtr);
      if (bPtr) WL._free(bPtr);
      if (vPtr) WL._free(vPtr);
      WL._PhraseSynthDelete(ps);
      return null;
    }
    WL.HEAPF64.set(f0Arr, f0Ptr >> 3);
    WL.HEAPF64.set(gArr, gPtr >> 3);
    WL.HEAPF64.set(tArr, tPtr >> 3);
    WL.HEAPF64.set(bArr, bPtr >> 3);
    WL.HEAPF64.set(vArr, vPtr >> 3);
    WL._PhraseSynthSetCurves(
      ps,
      f0Ptr,
      gPtr,
      tPtr,
      bPtr,
      vPtr,
      nFrames,
      WL_FRAME_MS
    );
    WL._free(f0Ptr);
    WL._free(gPtr);
    WL._free(tPtr);
    WL._free(bPtr);
    WL._free(vPtr);
    const yPtrPtr = WL._malloc(4);
    if (!yPtrPtr) {
      WL._PhraseSynthDelete(ps);
      return null;
    }
    const outLen = WL._PhraseSynthSynth(ps, yPtrPtr, 0);
    const yPtr = WL.getValue(yPtrPtr, "*");
    const audio = outLen > 0 ? new Float32Array(WL.HEAPF32.buffer, yPtr, outLen).slice() : null;
    WL._free(yPtrPtr);
    WL._PhraseSynthDelete(ps);
    return audio;
  }
};

// src/types.ts
var DEFAULT_VOCAL_VOLUME = 200;
var DEFAULT_BPM = 120;
var DEFAULT_GATE = 100;
var DEFAULT_PAN = 64;
var DEFAULT_VELOCITY = 100;
var DEFAULT_PLAYBACK_VELOCITY = 127;
var DEFAULT_STEPS_PER_BAR = 192;

// src/lyrics.ts
var kanaTable = {
  \u3042: ["", "a"],
  \u3044: ["", "i"],
  \u3046: ["", "u"],
  \u3048: ["", "e"],
  \u304A: ["", "o"],
  \u304B: ["k", "a"],
  \u304D: ["k", "i"],
  \u304F: ["k", "u"],
  \u3051: ["k", "e"],
  \u3053: ["k", "o"],
  \u3055: ["s", "a"],
  \u3057: ["sh", "i"],
  \u3059: ["s", "u"],
  \u305B: ["s", "e"],
  \u305D: ["s", "o"],
  \u305F: ["t", "a"],
  \u3061: ["ch", "i"],
  \u3064: ["ts", "u"],
  \u3066: ["t", "e"],
  \u3068: ["t", "o"],
  \u306A: ["n", "a"],
  \u306B: ["n", "i"],
  \u306C: ["n", "u"],
  \u306D: ["n", "e"],
  \u306E: ["n", "o"],
  \u306F: ["h", "a"],
  \u3072: ["h", "i"],
  \u3075: ["f", "u"],
  \u3078: ["h", "e"],
  \u307B: ["h", "o"],
  \u307E: ["m", "a"],
  \u307F: ["m", "i"],
  \u3080: ["m", "u"],
  \u3081: ["m", "e"],
  \u3082: ["m", "o"],
  \u3084: ["y", "a"],
  \u3086: ["y", "u"],
  \u3088: ["y", "o"],
  \u3089: ["r", "a"],
  \u308A: ["r", "i"],
  \u308B: ["r", "u"],
  \u308C: ["r", "e"],
  \u308D: ["r", "o"],
  \u308F: ["w", "a"],
  \u3092: ["w", "o"],
  \u304C: ["g", "a"],
  \u304E: ["g", "i"],
  \u3050: ["g", "u"],
  \u3052: ["g", "e"],
  \u3054: ["g", "o"],
  \u3056: ["z", "a"],
  \u3058: ["j", "i"],
  \u305A: ["z", "u"],
  \u305C: ["z", "e"],
  \u305E: ["z", "o"],
  \u3060: ["d", "a"],
  \u3062: ["j", "i"],
  \u3065: ["z", "u"],
  \u3067: ["d", "e"],
  \u3069: ["d", "o"],
  \u3070: ["b", "a"],
  \u3073: ["b", "i"],
  \u3076: ["b", "u"],
  \u3079: ["b", "e"],
  \u307C: ["b", "o"],
  \u3071: ["p", "a"],
  \u3074: ["p", "i"],
  \u3077: ["p", "u"],
  \u307A: ["p", "e"],
  \u307D: ["p", "o"],
  \u3093: ["N", "N"]
};
var SMALL_KANA = "\u3041\u3043\u3045\u3047\u3049\u3083\u3085\u3087\u3063";
var VOWEL_KANA = {
  a: "\u3042",
  i: "\u3044",
  u: "\u3046",
  e: "\u3048",
  o: "\u304A"
};
var sanitizeText = (text) => text.normalize("NFKC").replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 96)).replace(/[^ぁ-ゖー]/g, "");
var splitSyllables = (text) => {
  const result = [];
  for (const ch of text) {
    if (result.length > 0 && SMALL_KANA.includes(ch)) {
      result[result.length - 1] += ch;
    } else {
      result.push(ch);
    }
  }
  return result;
};
var kanaToVowel = (kana) => {
  if (/[ぁゃ]/.test(kana)) return "a";
  if (/[ぃ]/.test(kana)) return "i";
  if (/[ぅゅ]/.test(kana)) return "u";
  if (/[ぇ]/.test(kana)) return "e";
  if (/[ぉょ]/.test(kana)) return "o";
  if (/[あかさたなはまやらわがざだばぱ]/.test(kana)) return "a";
  if (/[いきしちにひみりぎじぢびぴ]/.test(kana)) return "i";
  if (/[うくすつぬふむゆるぐずづぶぷ]/.test(kana)) return "u";
  if (/[えけせてねへめれげぜでべぺ]/.test(kana)) return "e";
  if (/[おこそとのほもよろごぞどぼぽ]/.test(kana)) return "o";
  return "";
};
var analyzeSyllable = (syllable) => {
  if (syllable === "\u30FC") return { kana: syllable, consonant: "-", vowel: "-" };
  if (syllable === "\u3063") return { kana: syllable, consonant: "Q", vowel: "" };
  const head = syllable[0];
  const row = kanaTable[head];
  const consonant = row ? row[0] : "";
  let vowel = row ? row[1] : kanaToVowel(head);
  if (syllable.length === 2 && syllable[1] !== "\u3063") {
    const v = kanaToVowel(syllable[1]);
    if (v) vowel = v;
  }
  return { kana: syllable, consonant, vowel };
};
var resolveLongVowels = (syllables) => {
  const result = [];
  let prevVowel = "";
  for (const syl of syllables) {
    if (syl.consonant === "-") {
      if (!prevVowel) continue;
      result.push({
        kana: VOWEL_KANA[prevVowel] ?? syl.kana,
        consonant: "",
        vowel: prevVowel
      });
      continue;
    }
    if (syl.vowel && syl.vowel !== "N") prevVowel = syl.vowel;
    result.push(syl);
  }
  return result;
};
var normalizeLyrics = (text) => resolveLongVowels(splitSyllables(sanitizeText(text)).map(analyzeSyllable));
var normalizeLyricLines = (lines) => {
  const syllables = [];
  const lineBreaks = [];
  for (const line of lines) {
    const part = normalizeLyrics(line);
    if (part.length === 0) continue;
    if (syllables.length > 0) lineBreaks.push(syllables.length);
    syllables.push(...part);
  }
  return { syllables, lineBreaks };
};
var LYRIC_LINE = /^@@(\d+)\s+(.*)$/;
var isLyricContinuation = (seg) => !/^[@#]/.test(seg);
var splitSegments = (mml) => mml.split(/[;\n\r]+/).map((s) => s.trim()).filter((s) => s.length > 0);
var clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
var MAX_VOCAL_VOLUME = 400;
var VOCAL_BOOST_DB_PER_PERCENT = 0.08;
var vocalVolumeToGain = (v) => {
  if (v <= 0) return 0;
  if (v <= 100) return v / 100;
  return 10 ** ((v - 100) * VOCAL_BOOST_DB_PER_PERCENT / 20);
};
var parseLyrics = (mml) => {
  const tracks = /* @__PURE__ */ new Map();
  const segments = splitSegments(mml);
  for (let i = 0; i < segments.length; i++) {
    const m = segments[i].match(LYRIC_LINE);
    if (!m) continue;
    const trackId = Number.parseInt(m[1], 10);
    const tokens = m[2].trim().split(/\s+/);
    const modelToken = tokens.shift() ?? "";
    let volume = DEFAULT_VOCAL_VOLUME;
    let gate = 100;
    let pan = 64;
    let octave = 0;
    const colon = modelToken.indexOf(":");
    const model = (colon === -1 ? modelToken : modelToken.slice(0, colon)).toLowerCase();
    if (colon !== -1) {
      const v = Number.parseInt(modelToken.slice(colon + 1), 10);
      if (Number.isFinite(v)) volume = clamp(v, 0, MAX_VOCAL_VOLUME);
    }
    const metaTokens = [modelToken];
    while (tokens.length > 0) {
      const v = /^v(\d+)$/.exec(tokens[0]);
      const q2 = /^q(\d+)$/.exec(tokens[0]);
      const p = /^p(\d+)$/.exec(tokens[0]);
      const o = /^o(-?\d+)$/.exec(tokens[0]);
      if (v) {
        volume = clamp(Number.parseInt(v[1], 10), 0, MAX_VOCAL_VOLUME);
      } else if (q2) {
        gate = clamp(Number.parseInt(q2[1], 10), 0, 100);
      } else if (p) {
        pan = clamp(Number.parseInt(p[1], 10), 0, 127);
      } else if (o) {
        octave = clamp(Number.parseInt(o[1], 10), -2, 2);
      } else {
        break;
      }
      metaTokens.push(tokens.shift());
    }
    const lyricLines = [tokens.join(" ")];
    while (i + 1 < segments.length && isLyricContinuation(segments[i + 1])) {
      lyricLines.push(segments[++i]);
    }
    const { syllables, lineBreaks } = normalizeLyricLines(lyricLines);
    tracks.set(trackId, {
      trackId,
      model,
      volume,
      gate,
      pan,
      octave,
      syllables,
      metaText: metaTokens.join(" "),
      ...lineBreaks.length > 0 ? { lineBreaks } : {}
    });
  }
  return tracks;
};
var stripLyrics = (mml) => {
  const segments = splitSegments(mml);
  const kept = [];
  for (let i = 0; i < segments.length; i++) {
    if (LYRIC_LINE.test(segments[i])) {
      while (i + 1 < segments.length && isLyricContinuation(segments[i + 1]))
        i++;
      continue;
    }
    kept.push(segments[i]);
  }
  return kept.join("\n");
};
var panToStereo = (pan) => Math.max(-1, Math.min(1, (pan - 64) / 64));
var createLyricsConductor = (lyrics) => {
  const pointers = /* @__PURE__ */ new Map();
  const consume = (trackId) => {
    const track = lyrics.get(trackId);
    if (!track || track.syllables.length === 0) return null;
    const ptr = pointers.get(trackId) ?? 0;
    const syllable = track.syllables[ptr];
    if (!syllable) return null;
    pointers.set(trackId, ptr + 1);
    return {
      model: track.model,
      syllable,
      volume: vocalVolumeToGain(track.volume ?? DEFAULT_VOCAL_VOLUME),
      gate: (track.gate ?? DEFAULT_GATE) / 100,
      pan: panToStereo(track.pan ?? DEFAULT_PAN)
    };
  };
  const reset = () => pointers.clear();
  return { consume, reset };
};
var FORMANTS = {
  a: [800, 1200],
  i: [300, 2300],
  u: [350, 800],
  e: [500, 1900],
  o: [500, 900],
  // 撥音(ん)は鼻音寄りの低フォルマント
  N: [250, 1e3]
};
var midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
var createKlattVoice = (ctx, destination) => {
  const active = /* @__PURE__ */ new Set();
  const voice = (syllable, e) => {
    const t0 = ctx.currentTime + e.when;
    const peak = Math.max(1e-4, e.volume);
    if (syllable.vowel === "" || syllable.consonant === "Q") return;
    const [f1, f2] = FORMANTS[syllable.vowel] ?? FORMANTS.a;
    const attack = 0.02;
    const release = 0.06;
    const sustainEnd = t0 + Math.max(attack + 0.02, e.duration);
    let panner = null;
    let out = destination;
    if (typeof ctx.createStereoPanner === "function") {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, e.pan ?? 0));
      panner.connect(destination);
      out = panner;
    }
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = midiToFreq(e.pitch);
    const makeFormant = (freq, q2, gainScale) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = q2;
      const g = ctx.createGain();
      g.gain.value = gainScale;
      osc.connect(filter).connect(g);
      return g;
    };
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.setValueAtTime(peak, sustainEnd);
    env.gain.exponentialRampToValueAtTime(1e-4, sustainEnd + release);
    const MAKEUP = 4;
    makeFormant(f1, 6, MAKEUP).connect(env);
    makeFormant(f2, 9, MAKEUP * 0.7).connect(env);
    env.connect(out);
    const fricatives = /* @__PURE__ */ new Set(["s", "sh", "ch", "ts", "h", "f"]);
    if (fricatives.has(syllable.consonant)) {
      const dur = 0.05;
      const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = syllable.consonant === "sh" ? 3e3 : 4500;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(peak * 0.5, t0);
      ng.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
      src.connect(hp).connect(ng).connect(out);
      src.start(t0);
      src.stop(t0 + dur);
      active.add(src);
      src.onended = () => {
        active.delete(src);
        src.disconnect();
        hp.disconnect();
        ng.disconnect();
      };
    }
    osc.start(t0);
    osc.stop(sustainEnd + release + 0.02);
    active.add(osc);
    osc.onended = () => {
      active.delete(osc);
      osc.disconnect();
      panner?.disconnect();
    };
  };
  voice.stopAll = () => {
    for (const n of active) {
      try {
        n.stop();
      } catch {
      }
      n.disconnect();
    }
    active.clear();
  };
  return voice;
};
var KOE_BASE_URL = "https://pub-12482a6b5cbc4c9e906b2e1904cabae5.r2.dev";
var KOE_VOICEBANKS = {
  tsukuyomi: "\u3064\u304F\u3088\u307F\u3061\u3083\u3093.koe",
  rino: "\u6625\u97F3\u30EA\u30CEver0.3.koe",
  roze: "\u675F\u97F3\u30ED\u30BCver0.\uFF151(\u591A\u97F3\u968E).koe",
  ruko_male: "\u6B32\u97F3\u30EB\u30B3\u2642\u9023\u7D9A\u97F3Ver.1.03.koe",
  ruko_female: "\u6B32\u97F3\u30EB\u30B3\u2640\u6B4C\u9023\u7D9A\u97F3\u666E1.00.koe",
  teto: "\u91CD\u97F3\u30C6\u30C8\u5358\u72EC\u97F3.koe",
  shiyo: "\u9769\u547D\u30B7\u30E8.koe"
};
var KOE_VOICEBANK_LABELS = {
  tsukuyomi: "\u3064\u304F\u3088\u307F\u3061\u3083\u3093",
  rino: "\u6625\u97F3\u30EA\u30CE",
  roze: "\u675F\u97F3\u30ED\u30BC",
  ruko_male: "\u6B32\u97F3\u30EB\u30B3\u2642",
  ruko_female: "\u6B32\u97F3\u30EB\u30B3\u2640",
  teto: "\u91CD\u97F3\u30C6\u30C8",
  shiyo: "\u9769\u547D\u30B7\u30E8"
};
var VOICE_IMAGE_KEY = {
  klatt: "puyuyu",
  tsukuyomi: "tsukuyomi",
  rino: "rino",
  roze: "roze",
  ruko_male: "ruko",
  ruko_female: "ruko",
  teto: "teto",
  shiyo: "shiyo"
};
var KOE_VOICEBANK_TERMS = {
  tsukuyomi: "https://tyc.rei-yumesaki.net/material/utau/terms/",
  rino: "https://hatenakun1.github.io/halunelino/",
  roze: "https://tabaneroze.ninja-web.net/terms-of-use.html",
  ruko_male: "https://long-sleeper.net/index.php?id=22",
  ruko_female: "https://long-sleeper.net/index.php?id=22",
  teto: "https://kasaneteto.jp/guidelines/voice.html",
  shiyo: "https://kakumeisiyo.my.canva.site/dagkuyjwycs"
};
var koeUrl = (name, base = KOE_BASE_URL) => `${base}/${encodeURIComponent(name)}`;
var DEFAULT_WORLDLINE_SCRIPT = "https://onjmin.github.io/koe/demo/world/worldline.js";
var KOE_SAMPLE_RATE = 48e3;
var expandSeparators = (candidate) => candidate.includes(" ") ? [candidate, candidate.replace(/ /g, "\u3000"), candidate.replace(/ /g, "")] : [candidate];
var PITCH_SUFFIX = /_([A-G][#b]?-?\d+)$/;
var NAME_SEMITONE = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11
};
var pitchTokenToMidi = (token) => {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(token);
  if (!m) return null;
  let semi = NAME_SEMITONE[m[1].toLowerCase()];
  if (m[2] === "#") semi++;
  else if (m[2] === "b") semi--;
  return (Number.parseInt(m[3], 10) + 1) * 12 + semi;
};
var collectPitchTokens = (aliases) => {
  const seen = /* @__PURE__ */ new Map();
  for (const a of aliases) {
    const m = PITCH_SUFFIX.exec(a);
    if (!m || seen.has(m[1])) continue;
    const midi = pitchTokenToMidi(m[1]);
    if (midi != null) seen.set(m[1], midi);
  }
  return [...seen].map(([token, midi]) => ({ token, midi }));
};
var resolveKoeAlias = (hasAlias, pitchTokens, syl, prevVowel, noteNum) => {
  const kana = syl.kana;
  const cons = syl.consonant === "N" ? "n" : syl.consonant;
  const vow = syl.vowel === "N" ? "" : syl.vowel;
  const romaji = `${cons}${vow}` || vow;
  const pv = prevVowel || "-";
  const raw = [
    // 連続音（VCV）: 直前母音つき
    `${pv} ${kana}`,
    `${pv} ${romaji}`,
    // 単独音 / CVVC
    kana,
    romaji
  ];
  const vk = VOWEL_KANA[syl.vowel];
  if (vk) raw.push(`${pv} ${vk}`, vk, syl.vowel);
  if (syl.vowel === "N") raw.push("\u3093", "n", "N", `${pv} \u3093`);
  const seen = /* @__PURE__ */ new Set();
  const tryAlias = (candidate) => {
    for (const v of expandSeparators(candidate)) {
      if (seen.has(v)) continue;
      seen.add(v);
      if (hasAlias(v)) return v;
    }
    return null;
  };
  if (pitchTokens.length) {
    const nearest = pitchTokens.slice().sort((a, b) => Math.abs(a.midi - noteNum) - Math.abs(b.midi - noteNum));
    for (const { token } of nearest) {
      for (const base of raw) {
        const hit = tryAlias(`${base}_${token}`);
        if (hit) return hit;
      }
    }
  }
  for (const base of raw) {
    const hit = tryAlias(base);
    if (hit) return hit;
  }
  return null;
};
var createLocalBackend = async (options) => {
  const bank = await VoiceBank.load(options.koe);
  const worldline = options.lightweight ? null : await Worldline.load({
    scriptUrl: options.worldlineScriptUrl ?? DEFAULT_WORLDLINE_SCRIPT
  }).catch(() => null);
  const pcmCache = /* @__PURE__ */ new Map();
  const getPcm = (alias) => {
    let p = pcmCache.get(alias);
    if (!p) {
      p = bank.getPcm(alias);
      pcmCache.set(alias, p);
    }
    return p;
  };
  const renderAlias = async (alias, pitch, durationMs) => {
    const pcm = await getPcm(alias);
    if (!pcm || pcm.length === 0) return null;
    const entry = bank.manifest.phonemes[alias];
    const lead = leadInFromEntry(entry);
    const targetHz = midiToFreq(pitch);
    if (worldline) {
      const audio = worldline.renderNote({
        pcm,
        pitch: targetHz,
        durationMs,
        ...lead
      });
      if (audio) return { pcm: audio, preSec: lead.preMs / 1e3, rate: 1 };
    }
    const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
    return {
      pcm: Float32Array.from(pcm),
      preSec: entry.pre / KOE_SAMPLE_RATE / rate,
      rate
    };
  };
  return {
    hasAlias: (a) => bank.has(a),
    pitchTokens: collectPitchTokens(Object.keys(bank.manifest.phonemes)),
    renderAlias,
    dispose: () => {
    }
  };
};
var spawnVoiceWorker = async (url) => {
  const sameOrigin = new URL(url, location.href).origin === location.origin;
  if (sameOrigin) return new Worker(url);
  const text = await fetch(url).then((r) => r.text());
  return new Worker(
    URL.createObjectURL(new Blob([text], { type: "text/javascript" }))
  );
};
var createWorkerBackend = async (workerUrl, options) => {
  const worker = await spawnVoiceWorker(workerUrl);
  const aliasSet = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Map();
  let reqId = 0;
  let onReady = null;
  let onFail = null;
  worker.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "ready") {
      for (const a of m.aliases) aliasSet.add(a);
      onReady?.();
    } else if (m.type === "error") {
      onFail?.(new Error(m.message));
    } else if (m.type === "rendered") {
      const cb = pending.get(m.id);
      if (cb) {
        pending.delete(m.id);
        cb(m);
      }
    }
  };
  worker.onerror = (e) => {
    const ev = e;
    onFail?.(new Error(ev.message || ev.error || `Event: ${ev.type}`));
  };
  await new Promise((resolve, reject) => {
    onReady = resolve;
    onFail = reject;
    worker.postMessage({
      type: "init",
      koe: options.koe,
      worldlineScriptUrl: options.worldlineScriptUrl ?? DEFAULT_WORLDLINE_SCRIPT,
      lightweight: !!options.lightweight
    });
  });
  onReady = null;
  onFail = null;
  const renderAlias = (alias, pitch, durationMs) => new Promise((resolve) => {
    const id = ++reqId;
    pending.set(
      id,
      (m) => resolve(
        m.pcm ? { pcm: m.pcm, preSec: m.preSec ?? 0, rate: m.rate ?? 1 } : null
      )
    );
    worker.postMessage({
      type: "render",
      id,
      alias,
      pitch,
      durationMs
    });
  });
  return {
    hasAlias: (a) => aliasSet.has(a),
    pitchTokens: collectPitchTokens(aliasSet),
    renderAlias,
    dispose: () => worker.terminate()
  };
};
var createKoeVoice = async (ctx, destination, options) => {
  const backend = options.voiceWorkerUrl ? await createWorkerBackend(options.voiceWorkerUrl, options) : await createLocalBackend(options);
  const renderCache = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  const active = /* @__PURE__ */ new Set();
  let prevVowel = "";
  const keyOf = (alias, pitch, durationMs) => `${alias}|${pitch}|${Math.round(durationMs / 10) * 10}`;
  const renderInto = (alias, pitch, durationMs) => {
    const key = keyOf(alias, pitch, durationMs);
    const existing = renderCache.get(key);
    if (existing !== void 0) return Promise.resolve(existing);
    const flying = inflight.get(key);
    if (flying) return flying;
    const p = (async () => {
      const out = await backend.renderAlias(alias, pitch, durationMs);
      let rendered = null;
      if (out) {
        const buf = ctx.createBuffer(1, out.pcm.length, KOE_SAMPLE_RATE);
        buf.copyToChannel(out.pcm, 0);
        rendered = { audio: buf, preSec: out.preSec, rate: out.rate };
      }
      renderCache.set(key, rendered);
      inflight.delete(key);
      return rendered;
    })();
    inflight.set(key, p);
    return p;
  };
  const LEADCAP_S = 0.09;
  const schedule = (r, t0, peak, pan) => {
    let out = destination;
    let panner = null;
    if (typeof ctx.createStereoPanner === "function") {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(destination);
      out = panner;
    }
    const src = ctx.createBufferSource();
    src.buffer = r.audio;
    src.playbackRate.value = r.rate;
    const effPre = Math.min(r.preSec, LEADCAP_S);
    const skipS = r.preSec - effPre;
    const startAt = Math.max(ctx.currentTime + 1e-3, t0 - effPre);
    const playDurSec = r.audio.duration / r.rate - skipS;
    const endAt = startAt + playDurSec;
    const attack = 0.01;
    const release = 0.04;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1e-4, startAt);
    env.gain.exponentialRampToValueAtTime(peak, startAt + attack);
    const fadeStart = Math.max(startAt + attack, endAt - release);
    env.gain.setValueAtTime(peak, fadeStart);
    env.gain.exponentialRampToValueAtTime(1e-4, endAt);
    src.connect(env).connect(out);
    src.start(startAt, skipS);
    src.stop(endAt + 0.02);
    active.add(src);
    src.onended = () => {
      active.delete(src);
      src.disconnect();
      env.disconnect();
      panner?.disconnect();
    };
  };
  const model = (syllable, e) => {
    if (syllable.consonant === "Q" || syllable.vowel === "") return;
    const alias = resolveKoeAlias(
      backend.hasAlias,
      backend.pitchTokens,
      syllable,
      prevVowel,
      e.pitch
    );
    if (syllable.vowel && syllable.vowel !== "N") prevVowel = syllable.vowel;
    if (!alias) return;
    const t0 = ctx.currentTime + e.when;
    const peak = Math.max(1e-4, e.volume);
    const pan = e.pan ?? 0;
    const durationMs = Math.max(60, e.duration * 1e3);
    void renderInto(alias, e.pitch, durationMs).then((r) => {
      if (r) schedule(r, t0, peak, pan);
    });
  };
  model.renderToCache = async (syllable, prevVowelArg, pitch, durationMs) => {
    if (syllable.consonant === "Q" || syllable.vowel === "") return null;
    const alias = resolveKoeAlias(
      backend.hasAlias,
      backend.pitchTokens,
      syllable,
      prevVowelArg,
      pitch
    );
    if (!alias) return null;
    const dMs = Math.max(60, durationMs);
    const r = await renderInto(alias, pitch, dMs);
    return r ? keyOf(alias, pitch, dMs) : null;
  };
  model.scheduleCached = (key, t0, peak, pan) => {
    const r = renderCache.get(key);
    if (r) schedule(r, t0, peak, pan);
  };
  model.stopAll = () => {
    for (const src of active) {
      try {
        src.stop();
      } catch {
      }
      src.disconnect();
    }
    active.clear();
  };
  model.reset = () => {
    prevVowel = "";
  };
  return model;
};
var PREWARM_NOTES = 3;
var STREAM_LOOKAHEAD_SEC = 1.5;
var STREAM_POLL_MS = 100;
var FALLBACK_MODEL = "klatt";
var createSingingVoices = (ctx, destination, options = {}) => {
  const catalog = {};
  for (const [k, file] of Object.entries(KOE_VOICEBANKS))
    catalog[k] = koeUrl(file);
  for (const [k, v] of Object.entries(options.voicebanks ?? {}))
    catalog[k.toLowerCase()] = v;
  let streamSession = 0;
  const loaded = /* @__PURE__ */ new Map([
    [FALLBACK_MODEL, createKlattVoice(ctx, destination)]
  ]);
  const loading = /* @__PURE__ */ new Map();
  const load = (model) => {
    const m = model.toLowerCase();
    const ready = loaded.get(m);
    if (ready) return Promise.resolve(ready);
    const inflight = loading.get(m);
    if (inflight) return inflight;
    const koe = catalog[m];
    if (!koe) return Promise.resolve(null);
    const p = (async () => (
      // URL文字列はそのまま渡す。koe側が VoiceBank.load 内で HTTP Range により
      // マニフェストだけ先読みし、音素PCMは歌う直前にオンデマンド取得する
      // （= 初回に .koe 全体をDLしない。モバイル初回ロードの待ちを解消）。
      // Blob/File が直接渡されたケース（ローカル読み込み）はそのまま BlobVoiceSource。
      createKoeVoice(ctx, destination, {
        koe,
        worldlineScriptUrl: options.worldlineScriptUrl,
        lightweight: options.lightweight,
        voiceWorkerUrl: options.voiceWorkerUrl
      })
    ))().then((v) => {
      loaded.set(m, v);
      return v;
    }).catch((err2) => {
      console.warn(`[dtm] koe\u97F3\u6E90 "${m}" \u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F`, err2);
      return null;
    });
    loading.set(m, p);
    return p;
  };
  const loadModels = async (models) => {
    const set = /* @__PURE__ */ new Set();
    for (const m of models) if (m) set.add(m.toLowerCase());
    await Promise.all([...set].map((m) => load(m)));
  };
  const forEachSungNote = (track, fn) => {
    let prevVowel = "";
    for (const note of track.notes) {
      const syl = note.syllable;
      if (syl.consonant === "Q" || syl.vowel === "") continue;
      fn(note, prevVowel);
      if (syl.vowel && syl.vowel !== "N") prevVowel = syl.vowel;
    }
  };
  const warm = async (tracks, count = PREWARM_NOTES) => {
    const promises = [];
    for (const track of tracks) {
      const m = loaded.get(track.model.toLowerCase());
      if (!m?.renderToCache) continue;
      let n = 0;
      forEachSungNote(track, (note, prevVowel) => {
        if (n >= count) return;
        n++;
        promises.push(
          m.renderToCache?.(
            note.syllable,
            prevVowel,
            note.pitch,
            note.durationSec * 1e3
          ) ?? Promise.resolve(null)
        );
      });
    }
    await Promise.all(promises);
  };
  const startStream = (tracks, anchorTime, opts) => {
    const session = ++streamSession;
    const runTrack = async (track) => {
      const model = loaded.get(track.model.toLowerCase());
      if (!model) return;
      const items = [];
      forEachSungNote(track, (note, prevVowel) => {
        items.push({ note, prevVowel });
      });
      const peak = Math.max(1e-4, track.volume);
      for (const { note, prevVowel } of items) {
        if (session !== streamSession) return;
        while (note.startSec - (ctx.currentTime - anchorTime) > STREAM_LOOKAHEAD_SEC) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
          if (session !== streamSession) return;
        }
        if (opts?.isAudible && !opts.isAudible(track)) continue;
        const t0 = anchorTime + note.startSec;
        if (model.renderToCache && model.scheduleCached) {
          const key = await model.renderToCache(
            note.syllable,
            prevVowel,
            note.pitch,
            note.durationSec * 1e3
          );
          if (session !== streamSession) return;
          if (key) model.scheduleCached(key, t0, peak, track.pan);
        } else {
          const when = t0 - ctx.currentTime;
          model(note.syllable, {
            trackId: "",
            pitch: note.pitch,
            velocity: 100,
            volume: peak,
            when,
            duration: note.durationSec,
            pan: track.pan
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    };
    for (const track of tracks) void runTrack(track);
  };
  const stopStream = () => {
    streamSession++;
    for (const v of loaded.values()) v.stopAll?.();
  };
  const reset = () => {
    stopStream();
    for (const v of loaded.values()) v.reset?.();
  };
  return { loadModels, warm, startStream, stopStream, reset };
};
var createVoiceRegistry = (models = {}, fallback = "klatt") => {
  const sing = (model, syllable, e) => {
    const fn = models[model] ?? models[fallback];
    fn?.(syllable, e);
  };
  const register = (name, m) => {
    models[name.toLowerCase()] = m;
  };
  return { sing, register };
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
        (n.velocity ?? DEFAULT_VELOCITY) * (track.volume ?? 100) / 100
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
  const WHITE_KEY = "#ccc8b4";
  const BLACK_KEY = "#111111";
  const BK_EDGE = "#383838";
  const WW_SEP = "#807a6a";
  const BK_RATIO = 0.62;
  for (let y = startY; y < endY; y += keyHeight) {
    const pitchIndex = keyCount - 1 - y / keyHeight;
    const totalPitch = pitchIndex + pitchRangeStart;
    const pitchMod12 = totalPitch % 12;
    const isBlackKey = blackKeyPitches.has(pitchMod12);
    const screenY = y - g_draw_offset_y;
    const bkW = Math.floor(KEYBOARD_WIDTH * BK_RATIO);
    if (isBlackKey) {
      g_key_ctx.fillStyle = WHITE_KEY;
      g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
      g_key_ctx.fillStyle = BLACK_KEY;
      g_key_ctx.fillRect(0, screenY, bkW, keyHeight);
      g_key_ctx.strokeStyle = BK_EDGE;
      g_key_ctx.lineWidth = 1;
      g_key_ctx.beginPath();
      g_key_ctx.moveTo(bkW, screenY);
      g_key_ctx.lineTo(bkW, screenY + keyHeight);
      g_key_ctx.stroke();
    } else {
      g_key_ctx.fillStyle = WHITE_KEY;
      g_key_ctx.fillRect(0, screenY, KEYBOARD_WIDTH, keyHeight);
      if (pitchMod12 === 5 || pitchMod12 === 0) {
        g_key_ctx.strokeStyle = WW_SEP;
        g_key_ctx.lineWidth = 1;
        g_key_ctx.beginPath();
        g_key_ctx.moveTo(0, screenY + keyHeight - 0.5);
        g_key_ctx.lineTo(KEYBOARD_WIDTH, screenY + keyHeight - 0.5);
        g_key_ctx.stroke();
      }
    }
    if (pitchMod12 === 0) {
      const octave = Math.floor(totalPitch / 12) - 1;
      g_key_ctx.fillStyle = "#555040";
      g_key_ctx.font = "10px 'k8x12',monospace";
      g_key_ctx.textAlign = "right";
      g_key_ctx.textBaseline = "bottom";
      g_key_ctx.fillText(
        `${KEY_NAMES[pitchMod12]}${octave}`,
        KEYBOARD_WIDTH - 4,
        screenY + keyHeight - 2
      );
    }
  }
  g_key_ctx.beginPath();
  g_key_ctx.strokeStyle = "#29adff";
  g_key_ctx.lineWidth = 2;
  g_key_ctx.moveTo(KEYBOARD_WIDTH, 0);
  g_key_ctx.lineTo(KEYBOARD_WIDTH, g_key_canvas.height);
  g_key_ctx.stroke();
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
  g_header_ctx.font = "11px 'k8x12',monospace";
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
        velocity: options.velocity ?? DEFAULT_VELOCITY
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
      { dur: "1.", s: total * 1.5 },
      // 付点全音符（最長。これ以上はタイ未対応のため表現不可）
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
   * MML生成（単一パス・発音順スキャン）
   *
   * 以前は1/2小節ごとのウィンドウで走査していたが、それだと半小節境界をまたぐ音符が
   * 境界で切り詰められて「ぶつ切り」になり、境界直前に始まる音符は隙間が潰れて欠落し、
   * 歌詞（@@n）の音節割り当てがずれていた。
   * 全ノートを発音順に一度で処理し、次の発音までの距離だけを上限として
   * 各音符の長さを忠実に出力する（次の音符がなければ曲末まで伸ばせる）。
   */
  generateMML = (volumeOverride) => {
    const config = getRenderConfig();
    const vol = volumeOverride ?? this.volume;
    const header = `t${this.tempo} v${vol}`;
    const segments = [];
    let lastOctave = -1;
    let currentCursor = 0;
    if (this.notes.length === 0) return header;
    const endStep = Math.max(
      ...this.notes.map((n) => n.startStep + n.durationSteps)
    );
    const notesByStep = /* @__PURE__ */ new Map();
    for (const n of this.notes) {
      const list = notesByStep.get(n.startStep) ?? [];
      list.push(n);
      notesByStep.set(n.startStep, list);
    }
    const sortedSteps = Array.from(notesByStep.keys()).sort((a, b) => a - b);
    const MIN_STEP = config.stepsPerBar / 64;
    const fillRests = (until) => {
      while (until - currentCursor >= MIN_STEP) {
        const gap = until - currentCursor;
        const { dur, steps } = this.findBestFitDuration(gap);
        segments.push(`r${dur}`);
        currentCursor += steps;
      }
    };
    for (let i = 0; i < sortedSteps.length; i++) {
      const startStep = sortedSteps[i];
      const notes = notesByStep.get(startStep);
      if (!notes) continue;
      fillRests(startStep);
      const nextStart = sortedSteps[i + 1] ?? endStep;
      const physicsLimit = nextStart - currentCursor;
      if (physicsLimit < MIN_STEP) {
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
    fillRests(endStep);
    return `${header} ${segments.join(" ")}`;
  };
  /**
   * ノート配列を直接渡してMMLを生成する（一時的に内部状態を差し替えて生成後に復元）
   */
  getMMLFromNotes(notes, tempo, volume) {
    const savedNotes = this.notes;
    const savedTempo = this.tempo;
    const savedVolume = this.volume;
    this.notes = [...notes].sort((a, b) => a.startStep - b.startStep);
    if (tempo !== void 0) this.tempo = tempo;
    if (volume !== void 0) this.volume = volume;
    const result = this.generateMML();
    this.notes = savedNotes;
    this.tempo = savedTempo;
    this.volume = savedVolume;
    return result;
  }
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
var decomposeToMonophonic = (notes) => {
  const sorted = [...notes].sort(
    (a, b) => a.startStep - b.startStep || a.pitch - b.pitch
  );
  const tracks = [];
  const trackEnds = [];
  for (const note of sorted) {
    let assigned = -1;
    let minEnd = Infinity;
    for (let i = 0; i < tracks.length; i++) {
      if (trackEnds[i] <= note.startStep && trackEnds[i] < minEnd) {
        minEnd = trackEnds[i];
        assigned = i;
      }
    }
    if (assigned === -1) {
      tracks.push([note]);
      trackEnds.push(note.startStep + note.durationSteps);
    } else {
      tracks[assigned].push(note);
      trackEnds[assigned] = note.startStep + note.durationSteps;
    }
  }
  return tracks;
};
var isChordHeavyTrack = (notes, threshold = 0.6) => {
  if (notes.length < 3) return false;
  const stepCounts = /* @__PURE__ */ new Map();
  for (const n of notes) {
    stepCounts.set(n.startStep, (stepCounts.get(n.startStep) ?? 0) + 1);
  }
  const chordNotes = notes.filter(
    (n) => (stepCounts.get(n.startStep) ?? 0) >= 3
  ).length;
  return chordNotes / notes.length >= threshold;
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
var clamp2 = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
var META_DIRECTIVE = /#(inst|drum|volume)=([\w-]+)/gi;
var parseMmlMeta = (mml) => {
  const meta = {};
  for (const m of mml.matchAll(META_DIRECTIVE)) {
    const key = m[1].toLowerCase();
    if (key === "inst") meta.instrument = m[2];
    else if (key === "drum") meta.drum = m[2];
    else if (key === "volume") {
      const v = Number.parseInt(m[2], 10);
      if (!Number.isNaN(v)) meta.volume = v;
    }
  }
  return meta;
};
var stripMmlMeta = (mml) => mml.replace(META_DIRECTIVE, "");
var formatMmlMeta = (meta) => {
  const parts = [];
  if (meta.instrument) parts.push(`#inst=${meta.instrument}`);
  if (meta.drum) parts.push(`#drum=${meta.drum}`);
  if (meta.volume !== void 0) parts.push(`#volume=${meta.volume}`);
  return parts.join(" ");
};
var parseMML = (mml, options = {}) => {
  const stepsPerBar = options.stepsPerBar ?? DEFAULT_STEPS_PER_BAR;
  const collectTokens = options.collectTokens ?? false;
  const collectLyrics = options.collectLyrics ?? false;
  const clampTrackCount = options.clampTrackCount;
  const placements = [];
  const tokenTracks = /* @__PURE__ */ new Map();
  let bpm = null;
  if (!mml) {
    return {
      placements,
      bpm,
      tokenTracks: collectTokens ? tokenTracks : void 0,
      lyrics: collectLyrics ? /* @__PURE__ */ new Map() : void 0,
      meta: {}
    };
  }
  const noComments = mml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const meta = parseMmlMeta(noComments);
  const noMeta = stripMmlMeta(noComments);
  const lyrics = collectLyrics ? parseLyrics(noMeta) : void 0;
  const fullMML = stripLyrics(noMeta).replace(/[\n\r]+/g, " ").trim();
  const parts = fullMML.split(/(@\d+)/).filter((p) => p.trim().length > 0);
  let trackIndex = 0;
  let octave = 4;
  let currentStep = 0;
  let baseLength = 16;
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (part.startsWith("@")) {
      let idx = Number.parseInt(part.substring(1), 10);
      if (clampTrackCount !== void 0 && idx >= clampTrackCount) idx = 2;
      trackIndex = idx;
      octave = 4;
      currentStep = 0;
      baseLength = 16;
      continue;
    }
    const body = part.replace(/\s+/g, "").toLowerCase();
    let j = 0;
    const pushTok = (type, start, dur, from) => {
      if (!collectTokens) return;
      let arr = tokenTracks.get(trackIndex);
      if (!arr) {
        arr = [];
        tokenTracks.set(trackIndex, arr);
      }
      arr.push({
        text: body.slice(from, j),
        startStep: start,
        durationSteps: dur,
        type
      });
    };
    const parseLength = () => {
      let numStr = "";
      while (j < body.length && /\d/.test(body[j])) {
        numStr += body[j];
        j++;
      }
      const len = numStr ? clamp2(Number.parseInt(numStr, 10), 1, 64) : baseLength;
      let steps = Math.round(stepsPerBar / len);
      while (j < body.length && body[j] === ".") {
        steps = Math.round(steps * 1.5);
        j++;
      }
      return steps;
    };
    while (j < body.length) {
      const ch = body[j];
      const tokStart = j;
      if (ch === "o") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        octave = numStr ? clamp2(Number.parseInt(numStr, 10), 0, 8) : 4;
        pushTok("octave", currentStep, 0, tokStart);
      } else if (ch === ">") {
        octave = Math.min(8, octave + 1);
        j++;
        pushTok("shift", currentStep, 0, tokStart);
      } else if (ch === "<") {
        octave = Math.max(0, octave - 1);
        j++;
        pushTok("shift", currentStep, 0, tokStart);
      } else if (ch === "l") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        baseLength = clamp2(Number.parseInt(numStr, 10) || 16, 1, 64);
        pushTok("length", currentStep, 0, tokStart);
      } else if (ch === "r") {
        j++;
        const restStart = currentStep;
        const restSteps = parseLength();
        pushTok("rest", restStart, restSteps, tokStart);
        currentStep += restSteps;
      } else if (ch === "t" || ch === "v" || ch === "q" || ch === "p") {
        j++;
        let numStr = "";
        while (j < body.length && /\d/.test(body[j])) {
          numStr += body[j];
          j++;
        }
        if (ch === "t" && numStr) {
          if (bpm === null) {
            bpm = clamp2(Number.parseInt(numStr, 10), 1, 255);
          }
        }
        pushTok("ctrl", currentStep, 0, tokStart);
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
            octave = Math.min(8, octave + 1);
            j++;
          } else if (c === "<") {
            octave = Math.max(0, octave - 1);
            j++;
          } else if (c === "o") {
            j++;
            let numStr = "";
            while (j < body.length && /\d/.test(body[j])) {
              numStr += body[j];
              j++;
            }
            octave = numStr ? clamp2(Number.parseInt(numStr, 10), 0, 8) : 4;
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
        pushTok("chord", currentStep, Math.max(1, steps), tokStart);
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
        pushTok("note", currentStep, Math.max(1, steps), tokStart);
        currentStep += steps;
      } else {
        j++;
      }
    }
  }
  return {
    placements,
    bpm,
    tokenTracks: collectTokens ? tokenTracks : void 0,
    lyrics,
    meta
  };
};

// src/sequencer.ts
var STEPS_PER_BEAT2 = 48;
var PLAN_TIME = 0.5;
var TICK_INTERVAL_MS = 20;
var createSequencer = (options) => {
  let timeline = [];
  let startTime = 0;
  let nowIndex = 0;
  let intervalId = null;
  let animationId = null;
  let active = false;
  let fromStepValue = 0;
  let trackVolumeMap = /* @__PURE__ */ new Map();
  const secondsPerStep = () => 60 / options.getBpm() / STEPS_PER_BEAT2;
  const buildTimeline = (fromStep) => {
    timeline = [];
    trackVolumeMap = /* @__PURE__ */ new Map();
    const sps = secondsPerStep();
    for (const track of options.getTracks()) {
      trackVolumeMap.set(track.id, track.volume);
      for (const note of track.notes) {
        const relativeStart = note.startStep - fromStep;
        if (relativeStart < 0) continue;
        const velocity = note.velocity ?? DEFAULT_PLAYBACK_VELOCITY;
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
    for (const track of options.getTracks()) {
      trackVolumeMap.set(track.id, track.volume);
    }
    while (nowIndex < timeline.length) {
      const ev = timeline[nowIndex];
      const _when = ev.when - time;
      if (_when > PLAN_TIME) break;
      nowIndex++;
      if (soloId && ev.trackId !== soloId) continue;
      const velocityVolume = ev.velocity / 127;
      const currentVolume = (trackVolumeMap.get(ev.trackId) ?? ev.volume * 100) / 100;
      options.onPlayNote({
        trackId: ev.trackId,
        pitch: ev.pitch,
        velocity: ev.velocity,
        volume: currentVolume * velocityVolume,
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
  const START_DELAY = 0.1;
  const start = (fromStep) => {
    stop();
    fromStepValue = fromStep ?? options.getPlayStartStep();
    buildTimeline(fromStepValue);
    if (timeline.length === 0 && !options.getDrumPattern()?.length) return;
    active = true;
    startTime = options.getAudioTime() + START_DELAY;
    nowIndex = 0;
    intervalId = setInterval(scheduleTick, TICK_INTERVAL_MS);
    animationId = requestAnimationFrame(animate);
  };
  return {
    start,
    stop,
    isActive: () => active,
    getStartTime: () => startTime
  };
};

// src/styles.ts
var STYLE_ID = "dtm-daw-styles";
var DAW_CSS = `
@font-face {
  font-family: 'k8x12';
  src: url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.woff2') format('woff2'),
       url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.woff') format('woff'),
       url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.ttf') format('truetype');
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
  --dtm-font:     'k8x12',ui-monospace,monospace;

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
.dtm-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--dtm-font);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--dtm-muted);
  cursor: pointer;
  user-select: none;
  margin-top: 4px;
}
.dtm-checkbox-label:hover { color: var(--dtm-text); }
.dtm-checkbox-label--sub { margin-left: 20px; font-size: 10px; }
.dtm-checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--dtm-success);
  cursor: pointer;
  flex-shrink: 0;
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
.dtm-textarea.dtm-grow { width: 0; }
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
  width: 20px;
  background: var(--dtm-deep);
  border: 2px solid var(--dtm-border2);
  cursor: pointer;
  flex: 0 0 auto;
  touch-action: none;
}
.dtm-vscroll-thumb, .dtm-hscroll-thumb {
  position: absolute;
  background: var(--dtm-primary);
  min-width: 20px;
  min-height: 20px;
}
.dtm-vscroll-thumb { left: 0; width: 100%; }
.dtm-hscroll {
  position: relative;
  width: 100%; height: 20px;
  background: var(--dtm-deep);
  border: 2px solid var(--dtm-border2);
  cursor: pointer;
  touch-action: none;
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
  position: absolute; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.92);
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 14px;
  pointer-events: auto;
  cursor: wait;
}
.dtm-overlay[hidden] { display: none; }
.dtm-overlay::before {
  content: 'NOW LOADING';
  font-family: var(--dtm-font);
  font-size: 13px;
  color: var(--dtm-primary);
  text-transform: uppercase;
  letter-spacing: .25em;
  animation: dtm-blink 1s steps(1) infinite;
}
/* 8\u30D6\u30ED\u30C3\u30AF\u523B\u307F\u3067\u57CB\u307E\u308B\u30D4\u30AF\u30BB\u30EB\u30D0\u30FC */
.dtm-spinner {
  width: 96px; height: 12px;
  position: relative;
  background: var(--c-navy);
  border: 2px solid var(--dtm-primary);
  box-shadow: 0 0 0 2px var(--c-black), 4px 4px 0 var(--c-black);
}
.dtm-spinner::after {
  content: '';
  position: absolute;
  left: 0; top: 0; height: 100%;
  background: var(--dtm-primary);
  animation: dtm-load 1.6s steps(8) infinite;
}
@keyframes dtm-load { 0%{width:0} 100%{width:100%} }
/* \u9032\u6357\u304C\u78BA\u5B9A\u3057\u305F\u3089\u7121\u9650\u30EB\u30FC\u30D7\u6F14\u51FA\u3092\u6B62\u3081\u3001\u5B9F\u6E2C\u5024\u3067\u5857\u308A\u3064\u3076\u3059 */
.dtm-spinner--determinate::after { display: none; }
.dtm-spinner-fill {
  position: absolute;
  left: 0; top: 0; height: 100%;
  width: 0;
  background: var(--dtm-primary);
  transition: width .12s steps(8);
}
.dtm-loading-label {
  font-family: var(--dtm-font);
  font-size: 11px;
  color: var(--dtm-primary);
  letter-spacing: .15em;
  min-height: 1em;
}

@keyframes dtm-blink { 0%,100%{opacity:1} 50%{opacity:0} }
.dtm-blink { animation: dtm-blink 1s steps(1) infinite; }

.dtm-hidden { display: none !important; }
.dtm-grow { flex: 1 1 auto; }
.dtm-lyric-icon {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

/* \u2500\u2500\u2500 \u5E83\u5E45\u62E1\u5F35 \u2500\u2500\u2500 */
@media (min-width: 768px) {
  .dtm-daw { gap: 8px; padding: 10px; }
  .dtm-roll { height: 420px; }
}

/* ====================================================
   MML PLAYER \u2014 \u518D\u751F\u5C02\u7528\u30D3\u30E5\u30FC\uFF08mountMmlPlayer\uFF09
   ==================================================== */
.dtm-player {
  display: flex;
  flex-direction: column;
  gap: var(--dtm-gap);
  padding: var(--dtm-gap);
  background: var(--dtm-deep);
  border: 2px solid var(--dtm-border2);
  box-shadow: 4px 4px 0 var(--c-black);
}
.dtm-player-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dtm-player-play {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dtm-primary);
  color: var(--dtm-pfg);
  border: 2px solid var(--c-black);
  box-shadow: 2px 2px 0 var(--c-black);
  cursor: pointer;
  padding: 0;
}
.dtm-player-play:active { transform: translate(2px, 2px); box-shadow: none; }
.dtm-player-play--stop { background: var(--dtm-danger); }
.dtm-player-play:disabled { opacity: 0.4; cursor: default; }
.dtm-player-beat-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.dtm-player-beat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dtm-border2);
  transition: background 0.06s;
}
.dtm-player-beat-dot--on { background: var(--dtm-primary); }
.dtm-player-bar {
  font-family: 'k8x12', monospace;
  font-size: 11px;
  color: var(--dtm-text);
  min-width: 2em;
  margin-left: 4px;
}
.dtm-player-chord {
  font-family: 'k8x12', monospace;
  font-size: 11px;
  color: var(--dtm-accent);
  min-width: 4em;
  margin-left: 8px;
  font-weight: bold;
}
.dtm-player-dots {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dtm-player-dot { width: 8px; height: 8px; display: inline-block; }
.dtm-player-mml-header {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.dtm-player-mml-link {
  font-family: 'k8x12', monospace;
  font-size: 10px;
  color: var(--dtm-muted);
  text-decoration: none;
  white-space: nowrap;
}
.dtm-player-mml-link:hover { color: var(--dtm-primary); }
.dtm-player-emoji {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 18px;
  line-height: 1;
  user-select: none;
}
@keyframes dtm-emoji-jump {
  0%   { transform: translateY(0); }
  35%  { transform: translateY(-5px); }
  65%  { transform: translateY(-5px); }
  100% { transform: translateY(0); }
}
.dtm-player-emoji--jump {
  animation: dtm-emoji-jump 0.18s ease-out forwards;
}
.dtm-player-chip {
  font-family: 'k8x12', monospace;
  font-size: 9px;
  color: var(--dtm-text);
  background: var(--dtm-border2);
  padding: 2px 6px;
  white-space: nowrap;
}
.dtm-player-body {
  position: relative; /* \u30ED\u30FC\u30C7\u30A3\u30F3\u30B0\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4\u306E\u57FA\u6E96\u3002\u30EC\u30FC\u30F3\u7FA4\u3060\u3051\u3092\u8986\u3046 */
  display: flex;
  flex-direction: column;
  gap: var(--dtm-gap);
}
.dtm-player-lane-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.dtm-player-lane-label {
  flex: 0 0 auto;
  width: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-top: 4px;
}
.dtm-player-lane-label--btn {
  cursor: pointer;
  user-select: none;
}
.dtm-player-lane-label--btn:hover { opacity: 0.7; }
.dtm-player-lane-label--muted { opacity: 0.3; }
.dtm-player-lane-no {
  font-family: 'k8x12', monospace;
  font-size: 9px;
  color: var(--dtm-muted);
}
.dtm-player-lane {
  position: relative; /* \u30C8\u30FC\u30AF\u30F3\u306E offsetParent \u3092\u30EC\u30FC\u30F3\u306B\u56FA\u5B9A\u3057\u3001\u4E2D\u592E\u5BC4\u305B\u8A08\u7B97\u3092\u6B63\u3059 */
  flex: 1 1 auto;
  overflow-x: auto;
  white-space: nowrap;
  background: var(--c-black);
  border: 2px solid var(--dtm-border2);
  padding: 6px;
  scrollbar-width: none;
}
.dtm-player-lane::-webkit-scrollbar { display: none; }
.dtm-tk {
  font-family: 'k8x12', monospace;
  font-size: 12px;
  color: var(--dtm-text);
}
.dtm-tk--rest { color: var(--dtm-muted); }
.dtm-tk--octave,
.dtm-tk--shift,
.dtm-tk--length,
.dtm-tk--ctrl { color: var(--dtm-border2); }
.dtm-tk--lyric { color: var(--dtm-text); letter-spacing: 1px; }
.dtm-tk--break { color: var(--dtm-muted); opacity: 0.7; margin: 0 2px; }
.dtm-tk--meta { color: var(--dtm-border2); margin-right: 4px; }
.dtm-tk.is-active {
  background: var(--tk, var(--dtm-primary));
  color: var(--c-black);
  font-weight: bold;
}
`;
var injectStyles = (doc = document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DAW_CSS;
  doc.head.appendChild(style);
};
var showLoadingOverlay = (container) => {
  const origPos = container.style.position;
  const computed = window.getComputedStyle(container).position;
  if (computed === "static") {
    container.style.position = "relative";
  }
  const doc = container.ownerDocument ?? document;
  const overlay = doc.createElement("div");
  overlay.className = "dtm-overlay";
  const spinner = doc.createElement("div");
  spinner.className = "dtm-spinner";
  const fill = doc.createElement("i");
  fill.className = "dtm-spinner-fill";
  spinner.appendChild(fill);
  overlay.appendChild(spinner);
  const label = doc.createElement("div");
  label.className = "dtm-loading-label";
  overlay.appendChild(label);
  container.appendChild(overlay);
  const setProgress = (done, total) => {
    if (total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round(done / total * 100)));
      spinner.classList.add("dtm-spinner--determinate");
      fill.style.width = `${pct}%`;
      label.textContent = `${done} / ${total} (${pct}%)`;
    } else {
      spinner.classList.remove("dtm-spinner--determinate");
      fill.style.width = "0";
      label.textContent = "";
    }
  };
  return {
    remove: () => {
      overlay.remove();
      container.style.position = origPos;
    },
    setProgress
  };
};

// assets/puyuyu.png
var puyuyu_default = "data:image/png;base64,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";

// assets/rino.png
var rino_default = "data:image/png;base64,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";

// assets/roze.png
var roze_default = "data:image/png;base64,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";

// assets/ruko.png
var ruko_default = "data:image/png;base64,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";

// assets/shiyo.png
var shiyo_default = "data:image/png;base64,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";

// assets/teto.png
var teto_default = "data:image/png;base64,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";

// assets/tsukuyomi.png
var tsukuyomi_default = "data:image/png;base64,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";

// src/voice-images.ts
var VOICE_IMAGES = {
  puyuyu: puyuyu_default,
  rino: rino_default,
  roze: roze_default,
  ruko: ruko_default,
  shiyo: shiyo_default,
  teto: teto_default,
  tsukuyomi: tsukuyomi_default
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
var LYRIC_MODELS = ["klatt", ...Object.keys(KOE_VOICEBANKS)];
var LYRIC_MODEL_LABELS = {
  klatt: "\u8EFD\u91CF\u30ED\u30DC\u58F0",
  ...KOE_VOICEBANK_LABELS
};
var lyricModelLabel = (model) => LYRIC_MODEL_LABELS[model] ?? model;
var clamp3 = (v, min, max) => Math.min(Math.max(v, min), max);
var mountDAW = (target, options = {}) => {
  injectStyles();
  const getAudioTime = options.getAudioTime ?? (() => performance.now() / 1e3);
  const trackConfigs = options.tracks ?? DEFAULT_TRACKS;
  const drumPatterns = options.drumPatterns ?? DRUM_PATTERNS;
  const showMidi = !!options.parseMidi;
  const showChord = true;
  const refs = buildUI(target, {
    tracks: trackConfigs,
    drumPatternNames: Object.keys(drumPatterns),
    defaultDrumPattern: drumPatterns.dance ? "dance" : Object.keys(drumPatterns)[0] ?? "none",
    defaultBpm: options.defaultBpm ?? DEFAULT_BPM,
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
  let bpm = options.defaultBpm ?? DEFAULT_BPM;
  let masterVolume = 50;
  let drumVolume = 80;
  let currentDrumPattern = refs.drumSelect.value;
  let currentInstrument = "";
  let activeTrackId = trackConfigs[0].id;
  let activeToolMode = "pen";
  let currentInsertLength = 48;
  let snapGridSteps = 12;
  const gridLineSteps = 48;
  let currentOffsetX = 0;
  let currentOffsetY = (104 - 1 - 60) * renderConfig.keyHeight - 215;
  let playStartStep = 0;
  let isSolo = false;
  let lyricTrackIndices = /* @__PURE__ */ new Set();
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
      savedChordRoot: 0,
      lyrics: "",
      lyricModel: "",
      // 既定は「なし」（歌わない）
      vocalVolume: DEFAULT_VOCAL_VOLUME,
      vocalGate: 100,
      vocalPan: 64,
      vocalOctave: 0
    }));
  };
  const buildLyricsMap = () => {
    const map = /* @__PURE__ */ new Map();
    trackStates.forEach((t, i) => {
      const model = t.lyricModel.trim();
      const text = t.lyrics.trim();
      if (!model || !text) return;
      const syllables = normalizeLyrics(text);
      if (syllables.length === 0) return;
      map.set(i, {
        trackId: i,
        model: model.toLowerCase(),
        volume: t.vocalVolume,
        gate: t.vocalGate,
        pan: t.vocalPan,
        octave: t.vocalOctave,
        syllables
      });
    });
    return map;
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
      refs.hScrollThumb.style.left = `${clamp3(ratio * (sbW - thumbW), 0, sbW - thumbW)}px`;
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
      refs.hScroll.setPointerCapture(e.pointerId);
      moveH(e.clientX);
    });
    refs.vScroll.addEventListener("pointerdown", (e) => {
      draggingV = true;
      e.preventDefault();
      refs.vScroll.setPointerCapture(e.pointerId);
      moveV(e.clientY);
    });
    refs.hScroll.addEventListener("pointermove", (e) => {
      if (draggingH) moveH(e.clientX);
    });
    refs.vScroll.addEventListener("pointermove", (e) => {
      if (draggingV) moveV(e.clientY);
    });
    refs.hScroll.addEventListener("pointerup", () => {
      draggingH = false;
    });
    refs.vScroll.addEventListener("pointerup", () => {
      draggingV = false;
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
      const x = clamp3(clientX - rect.left - thumbW / 2, 0, rect.width - thumbW);
      const ratio = x / (rect.width - thumbW);
      currentOffsetX = clamp3(ratio * maxOffsetX, 0, maxOffsetX);
      setDrawOffset(currentOffsetX, currentOffsetY);
      redrawAll();
    };
    const moveV = (clientY) => {
      const maxOffset = getMaxOffsetY();
      if (maxOffset <= 0) return;
      const rect = refs.vScroll.getBoundingClientRect();
      const thumbH = Number.parseFloat(refs.vScrollThumb.style.height) || 40;
      const y = clamp3(clientY - rect.top - thumbH / 2, 0, rect.height - thumbH);
      const ratio = y / (rect.height - thumbH);
      currentOffsetY = clamp3(ratio * maxOffset, 0, maxOffset);
      setDrawOffset(currentOffsetX, currentOffsetY);
      redrawAll();
    };
  };
  const resizeHandleWidth = 10;
  const TOUCH_HIT_MARGIN = 6;
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
  const findActiveNoteAt = (x, y, margin = 0) => {
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
      if (x >= renderX - margin && x <= renderX + w + margin && y >= renderY - margin && y <= renderY + keyHeight + margin)
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
    const existing = findActiveNoteAt(x, y, TOUCH_HIT_MARGIN);
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
      (n) => n.pitch === pitch && newStart < n.startStep + n.durationSteps && newEnd > n.startStep
    );
    if (!overlapping) {
      active.core.addNote(snappedStep, pitch, {
        noteLengthSteps: currentInsertLength
      });
      playPreview(pitch);
      const newNote = active.core.getNotes().find((n) => n.startStep === snappedStep && n.pitch === pitch);
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
        currentOffsetY = clamp3(
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
    currentOffsetY = clamp3(
      centerKey * renderConfig.keyHeight - canvas.height / 2,
      0,
      getMaxOffsetY()
    );
    setDrawOffset(currentOffsetX, currentOffsetY);
    redrawAll();
  };
  const getViewState = () => ({
    zoomX,
    zoomY,
    decomposeChord: refs.decomposeChordToggle.checked,
    ignoreChordHeavy: refs.ignoreChordHeavyToggle.checked
  });
  const notifyViewState = () => options.onViewStateChange?.(getViewState());
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
      const idx = trackStates.findIndex((t) => t.config.id === e.trackId);
      if (idx >= 0 && lyricTrackIndices.has(idx) && options.singingVoices) {
        return;
      }
      options.onPlayNote?.({ ...e, volume: e.volume * (masterVolume / 100) });
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
  const play = async () => {
    options.onResumeAudio?.();
    if (playbackState === "playing") return;
    const fromStep = playbackState === "paused" ? pausedPlayStep : playStartStep;
    options.singingVoices?.reset();
    const lyricMap = buildLyricsMap();
    lyricTrackIndices = new Set(lyricMap.keys());
    const secondsPerStep = 60 / bpm / 48;
    const streamTracks = options.singingVoices ? [...lyricMap.values()].map((lt) => {
      const trackState = trackStates[lt.trackId];
      const sorted = [...trackState?.core.getNotes() ?? []].sort(
        (a, b) => a.startStep - b.startStep
      );
      const gate = (lt.gate ?? DEFAULT_GATE) / 100;
      const semis = (lt.octave ?? 0) * 12;
      const count = Math.min(sorted.length, lt.syllables.length);
      const notes = [];
      for (let i = 0; i < count; i++) {
        const n = sorted[i];
        if (n.startStep < fromStep) continue;
        notes.push({
          syllable: lt.syllables[i],
          pitch: n.pitch + semis,
          startSec: (n.startStep - fromStep) * secondsPerStep,
          durationSec: n.durationSteps * secondsPerStep * gate
        });
      }
      return {
        id: trackState?.config.id,
        model: lt.model,
        volume: vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME) * (masterVolume / 100),
        pan: panToStereo(lt.pan ?? DEFAULT_PAN),
        notes
      };
    }) : [];
    const voices = options.singingVoices;
    const streaming = !!voices && streamTracks.some((t) => t.notes.length > 0);
    if (streaming && voices) {
      const overlay = showLoadingOverlay(refs.rollContainer);
      try {
        await voices.loadModels(streamTracks.map((t) => t.model));
        await voices.warm(streamTracks);
      } catch (err2) {
        console.warn("[dtm] voice preload failed", err2);
      } finally {
        overlay.remove();
      }
    }
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
    if (streaming && voices) {
      voices.startStream(streamTracks, sequencer.getStartTime(), {
        isAudible: (t) => !isSolo || t.id === activeTrackId
      });
    }
    updateTransport();
  };
  const pause = () => {
    if (playbackState !== "playing") return;
    pausedPlayStep = currentPlayStep;
    sequencer.stop();
    options.singingVoices?.stopStream();
    playbackState = "paused";
    updateTransport();
  };
  const stop = () => {
    sequencer.stop();
    options.singingVoices?.stopStream();
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
    const lyricDiv = document.createElement("div");
    lyricDiv.className = "dtm-row";
    lyricDiv.style.flexDirection = "column";
    lyricDiv.style.alignItems = "stretch";
    lyricDiv.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">\u266A \u6B4C\u8A5E</span>
        <select class="dtm-select" data-dtm="lyric-model" aria-label="\u6B4C\u5531\u30E2\u30C7\u30EB"></select>
        <img class="dtm-lyric-icon dtm-hidden" data-dtm="lyric-icon" width="20" height="20" alt="" draggable="false">
        <select class="dtm-select" data-dtm="lyric-octave" aria-label="\u30AA\u30AF\u30BF\u30FC\u30D6\uFF08\u97F3\u6E90\u306E\u5F97\u610F\u97F3\u57DF\u306B\u5408\u308F\u305B\u308B\uFF09" title="\u30AA\u30AF\u30BF\u30FC\u30D6">
          <option value="2">+2 oct</option>
          <option value="1">+1 oct</option>
          <option value="0">\xB10 oct</option>
          <option value="-1">-1 oct</option>
          <option value="-2">-2 oct</option>
        </select>
        <span class="dtm-label dtm-grow" data-dtm="lyric-count" style="text-align:right"></span>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="lyric-terms" style="font-size:10px;gap:4px;color:var(--dtm-warn)">
        <span>\u4F7F\u7528\u6642\u306B\u306F</span>
        <a data-dtm="lyric-terms-link" target="_blank" rel="noopener" style="color:var(--dtm-primary);text-decoration:underline"></a>
        <span>\u306E\u5229\u7528\u898F\u7D04\u306B\u5F93\u3063\u3066\u304F\u3060\u3055\u3044</span>
      </div>
      <div class="dtm-row" data-dtm="lyric-body" style="flex-direction:column;align-items:stretch">
        <div class="dtm-row">
          <span class="dtm-label">\u58F0\u91CF</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-vol" min="0" max="${MAX_VOCAL_VOLUME}" aria-label="\u6B4C\u5531\u306E\u58F0\u91CF\uFF08100=\u7B49\u500D\u3001100\u8D85\u3067\u30D6\u30FC\u30B9\u30C8\u3001\u65E2\u5B9A200\uFF09">
          <span class="dtm-label" data-dtm="lyric-vol-label"></span>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">\u5B9A\u4F4D</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-pan" min="0" max="127" aria-label="\u6B4C\u5531\u306E\u30B9\u30C6\u30EC\u30AA\u5B9A\u4F4D\uFF08\u5DE6\u53F3\uFF09">
          <span class="dtm-label" data-dtm="lyric-pan-label"></span>
        </div>
        <textarea class="dtm-textarea" data-dtm="lyric-input" rows="2" placeholder="\u3072\u3089\u304C\u306A\u30FB\u30AB\u30BF\u30AB\u30CA\u3067\u6B4C\u8A5E\uFF08\u4F8B: \u3069\u308C\u307F\u3075\u3041\u305D\u3089\u3057\u3069\uFF09"></textarea>
      </div>`;
    refs.trackBody.appendChild(lyricDiv);
    const lyricModelSel = lyricDiv.querySelector(
      '[data-dtm="lyric-model"]'
    );
    const lyricOctaveSel = lyricDiv.querySelector(
      '[data-dtm="lyric-octave"]'
    );
    const lyricIcon = lyricDiv.querySelector(
      '[data-dtm="lyric-icon"]'
    );
    const lyricBody = lyricDiv.querySelector(
      '[data-dtm="lyric-body"]'
    );
    const lyricInput = lyricDiv.querySelector(
      '[data-dtm="lyric-input"]'
    );
    const lyricCount = lyricDiv.querySelector(
      '[data-dtm="lyric-count"]'
    );
    const lyricVol = lyricDiv.querySelector(
      '[data-dtm="lyric-vol"]'
    );
    const lyricVolLabel = lyricDiv.querySelector(
      '[data-dtm="lyric-vol-label"]'
    );
    const lyricPan = lyricDiv.querySelector(
      '[data-dtm="lyric-pan"]'
    );
    const lyricPanLabel = lyricDiv.querySelector(
      '[data-dtm="lyric-pan-label"]'
    );
    const lyricTerms = lyricDiv.querySelector(
      '[data-dtm="lyric-terms"]'
    );
    const lyricTermsLink = lyricDiv.querySelector(
      '[data-dtm="lyric-terms-link"]'
    );
    const fmtPan = (pan) => pan === 64 ? "C" : pan < 64 ? `L${64 - pan}` : `R${pan - 64}`;
    const addOpt = (value, label) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      lyricModelSel.appendChild(o);
    };
    addOpt("", "\u306A\u3057");
    for (const m of LYRIC_MODELS) addOpt(m, lyricModelLabel(m));
    if (active.lyricModel && !LYRIC_MODELS.includes(active.lyricModel)) {
      addOpt(active.lyricModel, lyricModelLabel(active.lyricModel));
    }
    lyricModelSel.value = active.lyricModel;
    lyricOctaveSel.value = String(active.vocalOctave);
    lyricInput.value = active.lyrics;
    lyricVol.value = String(active.vocalVolume);
    lyricVolLabel.textContent = String(active.vocalVolume);
    lyricPan.value = String(active.vocalPan);
    lyricPanLabel.textContent = fmtPan(active.vocalPan);
    const updateLyricCount = () => {
      const n = normalizeLyrics(lyricInput.value).length;
      lyricCount.textContent = active.lyricModel && n > 0 ? `${n}\u97F3\u7BC0` : "";
    };
    const syncLyricTerms = () => {
      const url = active.lyricModel ? KOE_VOICEBANK_TERMS[active.lyricModel] : void 0;
      if (url) {
        const label = lyricModelLabel(active.lyricModel);
        lyricTermsLink.textContent = `${label}UTAU\u97F3\u6E90`;
        lyricTermsLink.href = url;
        lyricTerms.classList.remove("dtm-hidden");
      } else {
        lyricTerms.classList.add("dtm-hidden");
      }
    };
    const syncLyricIcon = () => {
      const imgKey = active.lyricModel ? VOICE_IMAGE_KEY[active.lyricModel.toLowerCase()] : void 0;
      const src = imgKey ? VOICE_IMAGES[imgKey] : void 0;
      if (src) {
        lyricIcon.src = src;
        lyricIcon.classList.remove("dtm-hidden");
      } else {
        lyricIcon.removeAttribute("src");
        lyricIcon.classList.add("dtm-hidden");
      }
    };
    const syncLyricVisibility = () => {
      lyricBody.style.display = active.lyricModel ? "" : "none";
      lyricOctaveSel.style.display = active.lyricModel ? "" : "none";
      updateLyricCount();
      syncLyricTerms();
      syncLyricIcon();
    };
    syncLyricVisibility();
    lyricModelSel.addEventListener("change", () => {
      active.lyricModel = lyricModelSel.value;
      syncLyricVisibility();
    });
    lyricOctaveSel.addEventListener("change", () => {
      active.vocalOctave = Number.parseInt(lyricOctaveSel.value, 10);
    });
    lyricInput.addEventListener("input", () => {
      active.lyrics = lyricInput.value;
      updateLyricCount();
    });
    lyricVol.addEventListener("input", () => {
      active.vocalVolume = Number.parseInt(lyricVol.value, 10);
      lyricVolLabel.textContent = lyricVol.value;
    });
    lyricPan.addEventListener("input", () => {
      active.vocalPan = Number.parseInt(lyricPan.value, 10);
      lyricPanLabel.textContent = fmtPan(active.vocalPan);
    });
    lyricPanLabel.style.cursor = "pointer";
    lyricPanLabel.title = "\u30BF\u30C3\u30D7\u3067\u4E2D\u592E(C)\u3078";
    lyricPanLabel.addEventListener("click", () => {
      active.vocalPan = 64;
      lyricPan.value = "64";
      lyricPanLabel.textContent = fmtPan(64);
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
    const barLimitBars = Number(refs.barLimitSelect.value);
    const limitSteps = barLimitBars > 0 ? barLimitBars * renderConfig.stepsPerBar : Infinity;
    const clipNotes = (notes) => limitSteps === Infinity ? notes : notes.filter((n) => n.startStep < limitSteps);
    const metaLine = formatMmlMeta({
      instrument: currentInstrument || void 0,
      drum: currentDrumPattern !== "none" ? currentDrumPattern : void 0,
      volume: masterVolume
    });
    if (refs.decomposeChordToggle.checked) {
      const ignoreHeavy = refs.ignoreChordHeavyToggle.checked;
      const targetStates = ignoreHeavy ? trackStates.filter((t) => !isChordHeavyTrack(t.core.getNotes())) : trackStates;
      const ignoredCount = trackStates.length - targetStates.length;
      const allNotes = clipNotes(
        targetStates.flatMap((t) => t.core.getNotes())
      );
      const monoTracks = decomposeToMonophonic(allNotes);
      const refCore = trackStates[0].core;
      const decomposedFull = monoTracks.map(
        (notes, i) => `@${i} ${refCore.getMMLFromNotes(notes, bpm, 100).trim()}`
      );
      const decomposedMini = monoTracks.map(
        (notes, i) => `@${i}${refCore.getMMLFromNotes(notes, bpm, 100).trim().replace(/\s+/g, "")}`
      );
      const full2 = [metaLine, ...decomposedFull].filter((s) => s.length > 0).join(";\n");
      const minified2 = [metaLine, ...decomposedMini].filter((s) => s.length > 0).join(";");
      return {
        full: full2,
        minified: minified2,
        ignoredCount,
        trackCount: monoTracks.length,
        barLimit: barLimitBars
      };
    }
    const trackLines = [];
    const trackLinesMini = [];
    trackStates.forEach((t, i) => {
      const notes = clipNotes(t.core.getNotes());
      if (notes.length > 0) {
        const mml = t.core.getMMLFromNotes(notes, bpm, t.volume).trim();
        trackLines.push(`@${i} ${mml}`);
        trackLinesMini.push(`@${i}${mml.replace(/\s+/g, "")}`);
      }
    });
    const lyricLines = trackStates.map((t, i) => ({
      i,
      notes: clipNotes(t.core.getNotes()),
      text: t.lyrics.replace(/[\r\n]+/g, " ").trim(),
      model: t.lyricModel.trim(),
      vol: t.vocalVolume,
      gate: t.vocalGate,
      pan: t.vocalPan,
      oct: t.vocalOctave
    })).filter(
      (x) => x.model.length > 0 && x.text.length > 0 && x.notes.length > 0
    ).map((x) => {
      const params = [
        x.vol === DEFAULT_VOCAL_VOLUME ? "" : `v${x.vol}`,
        x.gate === 100 ? "" : `q${x.gate}`,
        x.pan === 64 ? "" : `p${x.pan}`,
        x.oct === 0 ? "" : `o${x.oct}`
      ].filter((s) => s.length > 0).join(" ");
      const head = params ? `${x.model} ${params}` : x.model;
      return `@@${x.i} ${head} ${x.text}`;
    });
    const full = [metaLine, ...trackLines, ...lyricLines].filter((s) => s.length > 0).join(";\n");
    const minified = [metaLine, ...trackLinesMini, ...lyricLines].filter((s) => s.length > 0).join(";");
    return {
      full,
      minified,
      ignoredCount: 0,
      trackCount: trackLines.length,
      barLimit: barLimitBars
    };
  };
  const showMML = () => {
    const { full, minified, ignoredCount, trackCount, barLimit } = generateMML();
    refs.outputFull.textContent = full;
    refs.outputMini.textContent = minified;
    const isDecompose = refs.decomposeChordToggle.checked;
    const modeLabel = isDecompose ? "\u548C\u97F3\u5206\u89E3" : "\u901A\u5E38";
    const ignoredLabel = ignoredCount > 0 ? ` / \u4F34\u594F${ignoredCount}\u30C8\u30E9\u30C3\u30AF\u9664\u5916` : "";
    const barLabel = barLimit > 0 ? ` / \u301C${barLimit}\u5C0F\u7BC0` : "";
    refs.outputStatus.textContent = `[${modeLabel}] (${trackCount}\u30C8\u30E9\u30C3\u30AF${ignoredLabel}${barLabel}) \u901A\u5E38: ${full.length}\u6587\u5B57 / minify: ${minified.length}\u6587\u5B57`;
    refs.outputContainer.classList.remove("dtm-hidden");
    updateUndoRedo();
  };
  const getFirstDetectedPitch = () => {
    let minStep = Number.MAX_SAFE_INTEGER;
    let candidateNotes = [];
    for (const t of trackStates) {
      for (const note of t.core.getNotes()) {
        if (note.startStep < minStep) {
          minStep = note.startStep;
          candidateNotes = [note];
        } else if (note.startStep === minStep) {
          candidateNotes.push(note);
        }
      }
    }
    if (candidateNotes.length === 0) return null;
    const sum = candidateNotes.reduce((acc, note) => acc + note.pitch, 0);
    return Math.round(sum / candidateNotes.length);
  };
  const centerPitch = (pitch) => {
    const canvas = getGridCanvas();
    const yIndex = renderConfig.keyCount - 1 - (pitch - renderConfig.pitchRangeStart);
    const logicalY = yIndex * renderConfig.keyHeight;
    currentOffsetY = clamp3(
      logicalY - (canvas.height - renderConfig.keyHeight) / 2,
      0,
      getMaxOffsetY()
    );
    setDrawOffset(currentOffsetX, currentOffsetY);
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
    const {
      placements,
      bpm: parsedBpm,
      lyrics,
      meta
    } = parseMML(mml, {
      stepsPerBar: renderConfig.stepsPerBar,
      collectLyrics: true,
      // このDAWのトラック数を超えるチャンネルはベースへ畳み込む（従来挙動）
      clampTrackCount: trackStates.length
    });
    currentInstrument = meta.instrument ?? "";
    if (meta.drum && drumPatterns[meta.drum]) {
      currentDrumPattern = meta.drum;
      refs.drumSelect.value = meta.drum;
      options.onDrumChange?.(meta.drum);
    }
    if (meta.volume !== void 0) {
      masterVolume = meta.volume;
      refs.masterVolume.value = String(meta.volume);
      refs.masterVolumeLabel.textContent = `${meta.volume}%`;
    }
    for (const t of trackStates) {
      t.lyrics = "";
      t.lyricModel = "";
      t.vocalVolume = DEFAULT_VOCAL_VOLUME;
      t.vocalGate = 100;
      t.vocalPan = 64;
      t.vocalOctave = 0;
    }
    lyrics?.forEach((lt, idx) => {
      const t = trackStates[idx];
      if (!t) return;
      t.lyrics = lt.syllables.map((s) => s.kana).join("");
      t.lyricModel = lt.model;
      t.vocalVolume = lt.volume;
      t.vocalGate = lt.gate;
      t.vocalPan = lt.pan;
      t.vocalOctave = lt.octave ?? 0;
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
    const firstPitch = getFirstDetectedPitch();
    if (firstPitch !== null) {
      centerPitch(firstPitch);
    } else {
      setDrawOffset(currentOffsetX, currentOffsetY);
    }
    redrawAll();
    updateTrackPanel();
    updateUndoRedo();
  };
  const applyChord = () => {
    const active = getActive();
    const chordTrack = trackStates.find((t) => t.config.id === "chord");
    if (!chordTrack) return;
    const placements = buildChordPlacements({
      chordStr: active.savedChordInput,
      patternType: active.savedChordPattern,
      rootShift: active.savedChordRoot,
      bpm,
      stepsPerBar: renderConfig.stepsPerBar
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
    const firstPitch = getFirstDetectedPitch();
    if (firstPitch !== null) {
      centerPitch(firstPitch);
    } else {
      setDrawOffset(currentOffsetX, currentOffsetY);
    }
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
      notifyViewState();
    });
    refs.zoomXOut.addEventListener("click", () => {
      zoomX = Math.max(25, zoomX - 25);
      applyZoomX();
      notifyViewState();
    });
    refs.zoomYIn.addEventListener("click", () => {
      zoomY = Math.min(200, zoomY + 25);
      applyZoomY();
      notifyViewState();
    });
    refs.zoomYOut.addEventListener("click", () => {
      zoomY = Math.max(50, zoomY - 25);
      applyZoomY();
      notifyViewState();
    });
    refs.decomposeChordToggle.addEventListener("change", notifyViewState);
    refs.ignoreChordHeavyToggle.addEventListener("change", notifyViewState);
    refs.masterVolume.addEventListener("input", () => {
      masterVolume = Number.parseInt(refs.masterVolume.value, 10) || 0;
      refs.masterVolumeLabel.textContent = `${masterVolume}%`;
    });
    refs.drumSelect.addEventListener("change", () => {
      currentDrumPattern = refs.drumSelect.value;
      options.onDrumChange?.(currentDrumPattern);
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
    setInstrument: (name) => {
      currentInstrument = name;
    },
    getDrum: () => currentDrumPattern,
    setDrum: (name) => {
      if (name !== "none" && !drumPatterns[name]) return;
      currentDrumPattern = name;
      refs.drumSelect.value = name;
      options.onDrumChange?.(name);
    },
    getViewState,
    setViewState: (state) => {
      if (typeof state.zoomX === "number") {
        zoomX = clamp3(state.zoomX, 25, 200);
        applyZoomX();
      }
      if (typeof state.zoomY === "number") {
        zoomY = clamp3(state.zoomY, 50, 200);
        applyZoomY();
      }
      if (typeof state.decomposeChord === "boolean") {
        refs.decomposeChordToggle.checked = state.decomposeChord;
      }
      if (typeof state.ignoreChordHeavy === "boolean") {
        refs.ignoreChordHeavyToggle.checked = state.ignoreChordHeavy;
      }
    },
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

// src/mml-player.ts
var STEPS_PER_BEAT3 = 48;
var STEPS_PER_BAR = 192;
var DEFAULT_TRACK_COLORS = ["#00e436", "#29adff", "#ff77a8", "#ffec27"];
var activePlayer = null;
var freqFromPitch = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
var mountMmlPlayer = (target, mml, options = {}) => {
  injectStyles(target.ownerDocument ?? document);
  const {
    placements,
    bpm: parsedBpm,
    tokenTracks,
    lyrics,
    meta
  } = parseMML(mml, {
    collectTokens: true,
    collectLyrics: true
  });
  const lyricTracks = lyrics ?? /* @__PURE__ */ new Map();
  const bpm = parsedBpm ?? options.defaultBpm ?? DEFAULT_BPM;
  const drumPatternDict = options.drumPatterns ?? DRUM_PATTERNS;
  const drumPattern = meta.drum ? drumPatternDict[meta.drum] ?? null : null;
  const trackVolume = meta.volume ?? options.volume ?? 100;
  const colors = options.trackColors ?? DEFAULT_TRACK_COLORS;
  const useSynth = options.synth ?? !options.onPlayNote;
  const secondsPerStep = 60 / bpm / STEPS_PER_BEAT3;
  const trackIndices = [...new Set(placements.map((p) => p.trackIndex))].sort(
    (a, b) => a - b
  );
  const maxStep = placements.reduce(
    (max, p) => Math.max(max, p.startStep + p.durationSteps),
    0
  );
  const stepPitches = Array.from(
    { length: maxStep + 1 },
    () => /* @__PURE__ */ new Set()
  );
  for (const p of placements) {
    for (let s = p.startStep; s < p.startStep + p.durationSteps; s++) {
      if (s >= 0 && s <= maxStep) {
        stepPitches[s].add(p.pitch);
      }
    }
  }
  const stepChords = [];
  const chordCache = /* @__PURE__ */ new Map();
  for (let s = 0; s <= maxStep; s++) {
    const pitches = Array.from(stepPitches[s]);
    if (pitches.length === 0) {
      stepChords.push("");
      continue;
    }
    const sortedPitches = pitches.sort((a, b) => a - b);
    const cacheKey = sortedPitches.join(",");
    if (chordCache.has(cacheKey)) {
      stepChords.push(chordCache.get(cacheKey));
    } else {
      const candidates = detectChord(sortedPitches);
      const chordName = candidates[0]?.symbol ?? "";
      chordCache.set(cacheKey, chordName);
      stepChords.push(chordName);
    }
  }
  const seqTracks = trackIndices.map((index) => {
    let id = 0;
    const notes = placements.filter((p) => p.trackIndex === index).map((p) => ({
      id: id++,
      startStep: p.startStep,
      durationSteps: p.durationSteps,
      pitch: p.pitch,
      velocity: 100
    }));
    return { id: String(index), volume: trackVolume, notes };
  });
  const colorOf = (index) => colors[index % colors.length] ?? DEFAULT_TRACK_COLORS[0];
  let audioCtx = null;
  const ensureCtx = () => {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  };
  const synthPlay = (e) => {
    const ctx = ensureCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freqFromPitch(e.pitch);
    const t0 = ctx.currentTime + e.when;
    const peak = Math.max(1e-4, 0.06 * e.volume * 1.5);
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(1e-3, t0 + e.duration);
    osc.connect(gain);
    if (typeof ctx.createStereoPanner === "function" && e.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, e.pan));
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
    osc.start(t0);
    osc.stop(t0 + e.duration + 0.02);
  };
  const drumSynth = (e) => {
    const ctx = ensureCtx();
    const t0 = ctx.currentTime + e.when;
    const vol = Math.max(1e-4, Math.min(1, e.velocity));
    const isKick = e.pitch === 35 || e.pitch === 36;
    const isSnareLike = e.pitch === 38 || e.pitch === 39 || e.pitch === 40;
    if (isKick) {
      const osc = ctx.createOscillator();
      const g2 = ctx.createGain();
      osc.frequency.setValueAtTime(150, t0);
      osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
      g2.gain.setValueAtTime(vol * 0.9, t0);
      g2.gain.exponentialRampToValueAtTime(1e-3, t0 + 0.18);
      osc.connect(g2).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.2);
      osc.onended = () => osc.disconnect();
      return;
    }
    const dur = isSnareLike ? 0.18 : 0.05;
    const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = isSnareLike ? "bandpass" : "highpass";
    filter.frequency.value = isSnareLike ? 2e3 : 8e3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * (isSnareLike ? 0.7 : 0.4), t0);
    g.gain.exponentialRampToValueAtTime(1e-3, t0 + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  };
  let voices = null;
  const ensureVoices = () => {
    if (options.singingVoices) return options.singingVoices;
    if (!voices) {
      const ctx = ensureCtx();
      voices = createSingingVoices(ctx, ctx.destination);
    }
    return voices;
  };
  const voicesAvailable = useSynth || !!options.singingVoices;
  const peekVoices = () => options.singingVoices ?? voices;
  const getAudioTime = () => {
    if (useSynth) return ensureCtx().currentTime;
    return options.getAudioTime?.() ?? performance.now() / 1e3;
  };
  const doc = target.ownerDocument ?? document;
  const root = doc.createElement("div");
  root.className = "dtm-daw dtm-player";
  const head = doc.createElement("div");
  head.className = "dtm-player-head";
  const playBtn = doc.createElement("button");
  playBtn.type = "button";
  playBtn.className = "dtm-player-play";
  playBtn.innerHTML = icon("play", 12);
  playBtn.disabled = trackIndices.length === 0;
  const mmlHeader = doc.createElement("div");
  mmlHeader.className = "dtm-player-mml-header";
  const emojiEls = [];
  const emojiByTrack = /* @__PURE__ */ new Map();
  for (const index of trackIndices) {
    const em = doc.createElement("span");
    em.className = "dtm-player-emoji";
    em.style.backgroundColor = colorOf(index);
    em.textContent = "\u{1F97A}";
    mmlHeader.appendChild(em);
    emojiEls.push(em);
    emojiByTrack.set(index, em);
  }
  const promotedToImage = /* @__PURE__ */ new Set();
  for (const [index, lt] of lyricTracks) {
    const em = emojiByTrack.get(index);
    if (!em) continue;
    const imgKey = VOICE_IMAGE_KEY[lt.model.toLowerCase()];
    const src = imgKey ? VOICE_IMAGES[imgKey] : void 0;
    if (!src) continue;
    const img = doc.createElement("img");
    img.src = src;
    img.width = 20;
    img.height = 20;
    img.style.borderRadius = "50%";
    img.style.objectFit = "cover";
    img.draggable = false;
    promotedToImage.add(em);
    em.textContent = "";
    em.appendChild(img);
  }
  const JUMP_DEDUPE_MS = 50;
  const lastJumpAt = /* @__PURE__ */ new WeakMap();
  const jumpEmoji = (em) => {
    const now = performance.now();
    const prev = lastJumpAt.get(em);
    if (prev !== void 0 && now - prev < JUMP_DEDUPE_MS) return;
    lastJumpAt.set(em, now);
    em.classList.remove("dtm-player-emoji--jump");
    void em.offsetWidth;
    em.classList.add("dtm-player-emoji--jump");
  };
  const jumpTimers = [];
  const jumpEmojiAt = (em, when) => {
    if (when <= 0) {
      jumpEmoji(em);
      return;
    }
    jumpTimers.push(setTimeout(() => jumpEmoji(em), when * 1e3));
  };
  const clearJumpTimers = () => {
    for (const t of jumpTimers) clearTimeout(t);
    jumpTimers.length = 0;
  };
  const blinkTimers = [];
  const scheduleBlink = (em) => {
    const delay = 2e3 + Math.random() * 5e3;
    const t = setTimeout(() => {
      if (promotedToImage.has(em)) return;
      em.textContent = "\u{1F60C}";
      const t2 = setTimeout(
        () => {
          if (promotedToImage.has(em)) return;
          em.textContent = "\u{1F97A}";
          scheduleBlink(em);
        },
        200 + Math.random() * 150
      );
      blinkTimers.push(t2);
    }, delay);
    blinkTimers.push(t);
  };
  for (const em of emojiEls) scheduleBlink(em);
  const dots = doc.createElement("div");
  dots.className = "dtm-player-dots";
  dots.style.display = "none";
  for (const index of trackIndices) {
    const dot = doc.createElement("span");
    dot.className = "dtm-player-dot";
    dot.style.backgroundColor = colorOf(index);
    dots.appendChild(dot);
  }
  const beatRow = doc.createElement("div");
  beatRow.className = "dtm-player-beat-row";
  const beatDots = [];
  for (let i = 0; i < 4; i++) {
    const d = doc.createElement("span");
    d.className = "dtm-player-beat-dot";
    beatRow.appendChild(d);
    beatDots.push(d);
  }
  const barEl = doc.createElement("span");
  barEl.className = "dtm-player-bar";
  barEl.textContent = "-";
  beatRow.appendChild(barEl);
  const chordEl = doc.createElement("span");
  chordEl.className = "dtm-player-chord";
  chordEl.textContent = "";
  beatRow.appendChild(chordEl);
  const chips = [];
  const makeChip = (label) => {
    const chip = doc.createElement("span");
    chip.className = "dtm-player-chip";
    chip.textContent = label;
    chips.push(chip);
    return chip;
  };
  if (meta.instrument) makeChip(`\u266A ${meta.instrument}`);
  if (meta.drum) makeChip(`\u{1F941} ${meta.drum}${drumPattern ? "" : " (?)"}`);
  if (meta.volume !== void 0) makeChip(`\u{1F50A} ${meta.volume}%`);
  head.append(playBtn, beatRow, ...chips, dots, mmlHeader);
  root.appendChild(head);
  const body = doc.createElement("div");
  body.className = "dtm-player-body";
  root.appendChild(body);
  const mutedTracks = /* @__PURE__ */ new Set();
  const laneViews = [];
  for (const index of trackIndices) {
    const lyricTrack = lyricTracks.get(index);
    const isLyricLane = !!lyricTrack && lyricTrack.syllables.length > 0;
    const row = doc.createElement("div");
    row.className = "dtm-player-lane-row";
    const label = doc.createElement("div");
    label.className = "dtm-player-lane-label dtm-player-lane-label--btn";
    const swatch = doc.createElement("span");
    swatch.className = "dtm-player-dot";
    swatch.style.backgroundColor = colorOf(index);
    const no = doc.createElement("span");
    no.className = "dtm-player-lane-no";
    no.textContent = `@${index}`;
    label.append(swatch, no);
    label.addEventListener("click", () => {
      if (mutedTracks.has(index)) {
        mutedTracks.delete(index);
        label.classList.remove("dtm-player-lane-label--muted");
      } else {
        mutedTracks.add(index);
        label.classList.add("dtm-player-lane-label--muted");
      }
    });
    const lane = doc.createElement("div");
    lane.className = "dtm-player-lane";
    lane.style.setProperty("--tk", colorOf(index));
    const laneTokens = [];
    if (isLyricLane) {
      const notes = placements.filter((p) => p.trackIndex === index).sort((a, b) => a.startStep - b.startStep);
      const gateScale = (lyricTrack.gate ?? DEFAULT_GATE) / 100;
      const breaks = new Set(lyricTrack.lineBreaks ?? []);
      if (lyricTrack.metaText) {
        const metaEl = doc.createElement("span");
        metaEl.className = "dtm-tk dtm-tk--meta";
        metaEl.textContent = lyricTrack.metaText;
        lane.appendChild(metaEl);
      }
      const count = Math.min(notes.length, lyricTrack.syllables.length);
      for (let i = 0; i < count; i++) {
        const note = notes[i];
        if (breaks.has(i)) {
          const br = doc.createElement("span");
          br.className = "dtm-tk dtm-tk--break";
          br.textContent = "\\n";
          lane.appendChild(br);
        }
        const span = doc.createElement("span");
        span.className = "dtm-tk dtm-tk--lyric";
        span.textContent = lyricTrack.syllables[i].kana;
        lane.appendChild(span);
        laneTokens.push({
          el: span,
          startStep: note.startStep,
          durationSteps: Math.max(
            1,
            Math.round(note.durationSteps * gateScale)
          )
        });
      }
    } else {
      const tokens = tokenTracks?.get(index) ?? [];
      for (const tok of tokens) {
        const span = doc.createElement("span");
        span.className = `dtm-tk dtm-tk--${tok.type}`;
        span.textContent = tok.text;
        lane.appendChild(span);
        if (tok.durationSteps > 0) {
          laneTokens.push({
            el: span,
            startStep: tok.startStep,
            durationSteps: tok.durationSteps
          });
        }
      }
    }
    row.append(label, lane);
    body.appendChild(row);
    laneViews.push({ lane, tokens: laneTokens });
  }
  const termsModels = [
    ...new Set([...lyricTracks.values()].map((lt) => lt.model))
  ].filter((model) => KOE_VOICEBANK_TERMS[model]);
  if (termsModels.length > 0) {
    const termsDiv = doc.createElement("div");
    termsDiv.className = "dtm-player-terms";
    termsDiv.style.fontSize = "10px";
    termsDiv.style.color = "var(--dtm-warn)";
    termsDiv.style.display = "flex";
    termsDiv.style.flexDirection = "column";
    termsDiv.style.gap = "4px";
    termsDiv.style.marginTop = "4px";
    termsDiv.style.padding = "0 4px";
    for (const model of termsModels) {
      const termsRow = doc.createElement("div");
      termsRow.style.display = "flex";
      termsRow.style.alignItems = "center";
      termsRow.style.gap = "4px";
      termsRow.style.flexWrap = "wrap";
      const label = KOE_VOICEBANK_LABELS[model] ?? model;
      const url = KOE_VOICEBANK_TERMS[model];
      const span1 = doc.createElement("span");
      span1.textContent = "\u4F7F\u7528\u6642\u306B\u306F";
      const a = doc.createElement("a");
      a.textContent = `${label}UTAU\u97F3\u6E90`;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.color = "var(--dtm-primary)";
      a.style.textDecoration = "underline";
      const span2 = doc.createElement("span");
      span2.textContent = "\u306E\u5229\u7528\u898F\u7D04\u306B\u5F93\u3063\u3066\u304F\u3060\u3055\u3044";
      termsRow.append(span1, a, span2);
      termsDiv.appendChild(termsRow);
    }
    root.appendChild(termsDiv);
  }
  target.appendChild(root);
  const autoScroll = (lane, el) => {
    if (el.offsetWidth === 0 || lane.clientWidth === 0) return;
    const elementCenter = el.offsetLeft + el.offsetWidth / 2;
    const maxScroll = Math.max(0, lane.scrollWidth - lane.clientWidth);
    const next = elementCenter - lane.clientWidth / 2;
    lane.scrollLeft = Math.max(0, Math.min(next, maxScroll));
  };
  const renderPlayhead = (step) => {
    const beatIndex = Math.floor(step / STEPS_PER_BEAT3) % 4;
    for (let i = 0; i < 4; i++)
      beatDots[i].classList.toggle("dtm-player-beat-dot--on", i === beatIndex);
    barEl.textContent = String(Math.floor(step / STEPS_PER_BAR) + 1);
    const chordName = stepChords[step] ?? "";
    if (chordEl.textContent !== chordName) {
      chordEl.textContent = chordName;
      if (chordName) {
        console.log(
          `[dtm-player-chord] Active Chord: ${chordName} (step: ${step})`
        );
      }
    }
    for (const view of laneViews) {
      let active = null;
      for (const t of view.tokens) {
        const on = step >= t.startStep && step < t.startStep + t.durationSteps;
        t.el.classList.toggle("is-active", on);
        if (on && !active) active = t;
      }
      if (active) autoScroll(view.lane, active.el);
    }
  };
  const resetPlayhead = () => {
    for (const d of beatDots) d.classList.remove("dtm-player-beat-dot--on");
    barEl.textContent = "-";
    chordEl.textContent = "";
    for (const view of laneViews) {
      for (const t of view.tokens) t.el.classList.remove("is-active");
      view.lane.scrollLeft = 0;
    }
  };
  const seq = createSequencer({
    getTracks: () => seqTracks,
    getBpm: () => bpm,
    getPlayStartStep: () => 0,
    getDrumPattern: () => drumPattern,
    getSoloTrackId: () => null,
    getAudioTime,
    onPlayNote: (e) => {
      const trackIdx = Number(e.trackId);
      if (mutedTracks.has(trackIdx)) return;
      const em = emojiByTrack.get(trackIdx);
      if (em) jumpEmojiAt(em, e.when);
      if (lyricTracks.has(trackIdx)) return;
      options.onPlayNote?.(e);
      if (useSynth) synthPlay(e);
    },
    onPlayDrum: (e) => {
      const velocity = e.velocity * (trackVolume / 100);
      options.onPlayDrum?.({ ...e, velocity });
      if (useSynth) drumSynth({ ...e, velocity });
    },
    onTick: (step) => {
      renderPlayhead(step);
    },
    onEnd: () => finish(),
    stepsPerBar: STEPS_PER_BAR
  });
  let playing = false;
  const setPlayingUI = (on) => {
    playing = on;
    playBtn.innerHTML = icon(on ? "stop" : "play", 12);
    playBtn.classList.toggle("dtm-player-play--stop", on);
  };
  const finish = () => {
    setPlayingUI(false);
    clearJumpTimers();
    resetPlayhead();
    if (activePlayer === instance) activePlayer = null;
  };
  const buildStreamTracks = () => [...lyricTracks.entries()].map(([index, lt]) => {
    const seqTrack = seqTracks.find((t) => Number(t.id) === index);
    const sorted = [...seqTrack?.notes ?? []].sort(
      (a, b) => a.startStep - b.startStep
    );
    const gate = (lt.gate ?? DEFAULT_GATE) / 100;
    const semis = (lt.octave ?? 0) * 12;
    const count = Math.min(sorted.length, lt.syllables.length);
    const notes = [];
    for (let i = 0; i < count; i++) {
      const n = sorted[i];
      notes.push({
        syllable: lt.syllables[i],
        pitch: n.pitch + semis,
        startSec: n.startStep * secondsPerStep,
        durationSec: n.durationSteps * secondsPerStep * gate
      });
    }
    return {
      model: lt.model,
      volume: vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME) * (trackVolume / 100),
      pan: panToStereo(lt.pan ?? DEFAULT_PAN),
      notes
    };
  });
  const startWhenReady = async () => {
    const streaming = voicesAvailable && lyricTracks.size > 0;
    const tracks = streaming ? buildStreamTracks() : [];
    if (streaming) {
      const v = ensureVoices();
      const overlay = showLoadingOverlay(body);
      try {
        await v.loadModels(tracks.map((t) => t.model));
        await v.warm(tracks);
      } catch (err2) {
        console.warn("[dtm] voice preload failed", err2);
      } finally {
        overlay.remove();
      }
      if (!playing || activePlayer !== instance) return;
    }
    seq.start(0);
    if (streaming) ensureVoices().startStream(tracks, seq.getStartTime());
  };
  const play = () => {
    if (playing || trackIndices.length === 0) return;
    if (activePlayer && activePlayer !== instance) activePlayer.stop();
    activePlayer = instance;
    setPlayingUI(true);
    void options.onResumeAudio?.();
    if (useSynth) {
      const ctx = ensureCtx();
      if (ctx.state === "suspended") void ctx.resume();
    }
    if (voicesAvailable && lyricTracks.size > 0) ensureVoices().reset();
    void startWhenReady();
  };
  const stop = () => {
    if (!playing) return;
    seq.stop();
    peekVoices()?.stopStream();
    finish();
  };
  playBtn.addEventListener("click", () => {
    if (playing) stop();
    else play();
  });
  const destroy = () => {
    seq.stop();
    peekVoices()?.stopStream();
    if (activePlayer === instance) activePlayer = null;
    if (audioCtx) {
      void audioCtx.close();
      audioCtx = null;
    }
    for (const t of blinkTimers) clearTimeout(t);
    clearJumpTimers();
    root.remove();
  };
  const instance = {
    play,
    stop,
    isPlaying: () => playing,
    destroy
  };
  return instance;
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

// src/studio.ts
var DEFAULT_CDN = {
  soundFont: "https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs",
  soundFontDrum: "https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_drum.mjs",
  soundFontList: "https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_list.mjs",
  midiParser: "https://cdn.jsdelivr.net/npm/midi-parser-js@4.0.4/+esm"
};
var SOUNDFONT_NAME = "FluidR3_GM_sf2_file";
var TRACK_ROLES = ["melody", "submelody", "bass", "chord"];
var resolveDefaultVoiceWorkerUrl = () => {
  try {
    return new URL("./voice-worker.js", import.meta.url).href;
  } catch {
    return void 0;
  }
};
var importFrom = async (url, name) => {
  const mod = await import(
    /* @vite-ignore */
    url
  );
  return mod[name] ?? mod.default;
};
var createDtmStudio = async (options = {}) => {
  const cdn = { ...DEFAULT_CDN, ...options.cdn };
  const features = {
    recorder: true,
    midi: true,
    chord: true,
    presetUI: true,
    ...options.features
  };
  const audioCtx = options.audioContext ?? new AudioContext();
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = options.masterVolume ?? 1;
  masterGain.connect(audioCtx.destination);
  const drumGain = audioCtx.createGain();
  drumGain.gain.value = options.drumVolume ?? 1;
  drumGain.connect(audioCtx.destination);
  const resumeAudio = () => {
    if (audioCtx.state === "suspended") void audioCtx.resume();
  };
  const eng = options.engines ?? {};
  const [SoundFont, SoundFont_drum, SoundFont_list] = await Promise.all([
    eng.SoundFont ?? importFrom(cdn.soundFont, "SoundFont"),
    eng.SoundFont_drum ?? importFrom(cdn.soundFontDrum, "SoundFont_drum"),
    eng.SoundFont_list ?? importFrom(cdn.soundFontList, "SoundFont_list")
  ]);
  let midiParser = null;
  let parseMidi;
  if (features.midi) {
    parseMidi = eng.parseMidi;
    if (!parseMidi) {
      const midiPromise = importFrom(
        cdn.midiParser,
        "default"
      ).then((m) => {
        midiParser = m;
      }).catch((e) => console.warn("[dtm] midi-parser \u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557", e));
      void midiPromise;
      parseMidi = (bytes) => {
        if (!midiParser) throw new Error("midi-parser not ready");
        return midiParser.parse(bytes);
      };
    }
  }
  const voiceWorkerUrl = options.voiceWorkerUrl === null ? void 0 : options.voiceWorkerUrl ?? resolveDefaultVoiceWorkerUrl();
  const singingVoices = createSingingVoices(audioCtx, masterGain, {
    voiceWorkerUrl
  });
  const recorder = features.recorder ? setupRecorder(audioCtx, masterGain, drumGain) : null;
  const downloadWav = () => {
    if (!recorder) return;
    const recordedData = recorder.getRecordedData();
    const ch = recordedData.length;
    const len = recordedData[0].length;
    if (len === 0) return;
    const bufSize = recordedData[0][0].length;
    const wave = new Float32Array(ch * len * bufSize);
    let idx = 0;
    for (let i = 0; i < len; i++)
      for (let j = 0; j < bufSize; j++)
        for (let k = 0; k < ch; k++) wave[idx++] = recordedData[k][i][j];
    const sampleRate = audioCtx.sampleRate;
    const channels = 2;
    const bitRate = 16;
    const step = bitRate / 8;
    const blockSize = channels * step;
    const byteLen = wave.length * step;
    const view = new DataView(new ArrayBuffer(44 + byteLen));
    const ws = (off2, s) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(off2 + i, s.charCodeAt(i));
    };
    ws(0, "RIFF");
    view.setUint32(4, 32 + byteLen, true);
    ws(8, "WAVE");
    ws(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockSize, true);
    view.setUint16(32, blockSize, true);
    view.setUint16(34, bitRate, true);
    ws(36, "data");
    view.setUint32(40, byteLen, true);
    const clamp4 = (n, a2, b) => Math.max(a2, Math.min(b, n));
    let off = 44;
    for (let i = 0; i < wave.length; i++, off += step)
      view.setInt16(
        off,
        clamp4(Math.round(wave[i] * 32768), -32768, 32767),
        true
      );
    const blob = new Blob([view], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "record.wav";
    a.click();
    URL.revokeObjectURL(url);
  };
  const onToggleRecord = recorder ? () => {
    if (recorder.isRecording()) {
      recorder.stopRecording();
      downloadWav();
    } else {
      recorder.clearRecordedData();
      recorder.startRecording();
    }
  } : void 0;
  const listReady = new Promise((resolve) => {
    SoundFont_list.init();
    SoundFont_list.onload(() => resolve());
  });
  const drumReady = (async () => {
    try {
      await SoundFont_drum.load({
        ctx: audioCtx,
        font: DRUM_FONT,
        id: "0",
        keys: Object.values(DRUM_KEYS)
      });
    } catch (e) {
      console.error("[dtm] \u30C9\u30E9\u30E0\u97F3\u6E90\u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557", e);
    }
  })();
  let nameToKey = {};
  const soundFonts = /* @__PURE__ */ new Map();
  const loadedKeyByTrack = /* @__PURE__ */ new Map();
  const loadSoundFont = async (instrumentKey, trackId) => {
    if (loadedKeyByTrack.get(trackId) === instrumentKey) return;
    try {
      const fullName = `${instrumentKey}_${SOUNDFONT_NAME}`;
      soundFonts.set(
        trackId,
        await SoundFont.load({
          ctx: audioCtx,
          fontName: `_tone_${fullName}`,
          url: SoundFont.toURL(fullName)
        })
      );
      loadedKeyByTrack.set(trackId, instrumentKey);
    } catch (e) {
      console.error(`[dtm] \u697D\u5668 "${instrumentKey}" \u306E\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557`, e);
    }
  };
  const defaultPreset = options.defaultPreset ?? "retro_game";
  const instrumentNameFor = (preset, trackId) => preset[trackId] ?? preset.melody;
  const loadPreset = async (presetKey, trackIds = [...TRACK_ROLES]) => {
    const preset = INSTRUMENT_PRESETS[presetKey];
    if (!preset) return;
    await listReady;
    await Promise.all(
      trackIds.map((trackId) => {
        const key = nameToKey[instrumentNameFor(preset, trackId)];
        return key ? loadSoundFont(key, trackId) : Promise.resolve();
      })
    );
  };
  await listReady;
  nameToKey = await buildNameToKeyMapping();
  await Promise.all([drumReady, loadPreset(defaultPreset)]);
  const playNote = (e) => {
    const sf = soundFonts.get(e.trackId);
    if (!sf) return;
    sf.play({
      ctx: audioCtx,
      destination: masterGain,
      pitch: e.pitch,
      volume: e.volume,
      when: e.when,
      duration: e.duration
    });
  };
  const playDrum = (e) => {
    if (!SoundFont_drum.font) return;
    SoundFont_drum.play({
      ctx: audioCtx,
      destination: drumGain,
      pitch: e.pitch,
      volume: e.velocity,
      when: e.when,
      duration: e.duration
    });
  };
  const sfForPlayerTrack = (trackId) => soundFonts.get(TRACK_ROLES[Number(trackId)] ?? "") ?? soundFonts.get(`t${trackId}`);
  const playPlayerNote = (e) => {
    const sf = sfForPlayerTrack(e.trackId);
    if (!sf) return;
    sf.play({
      ctx: audioCtx,
      destination: masterGain,
      pitch: e.pitch,
      volume: e.volume,
      when: e.when,
      duration: e.duration
    });
  };
  const editorPresetSelects = /* @__PURE__ */ new WeakMap();
  const mountedEditors = [];
  const mountedPlayers = [];
  const mountEditor = (target, opts = {}) => {
    const { preset, presetUI, ...dawOverrides } = opts;
    const tracks = dawOverrides.tracks ?? TRACKS_SIMPLE;
    const trackIds = tracks.map((t) => t.id);
    const base = {
      getAudioTime: () => audioCtx.currentTime,
      onResumeAudio: resumeAudio,
      onPlayNote: playNote,
      onPlayDrum: playDrum,
      singingVoices,
      parseMidi,
      onToggleRecord,
      ...dawOverrides
    };
    const wantPresetUI = presetUI ?? features.presetUI;
    let select = null;
    if (wantPresetUI) {
      editorPresetSelects.get(target)?.remove();
      select = target.ownerDocument.createElement("select");
      select.className = "dtm-studio-preset";
      for (const [key, p] of Object.entries(INSTRUMENT_PRESETS)) {
        const opt = target.ownerDocument.createElement("option");
        opt.value = key;
        opt.textContent = p.displayName;
        select.appendChild(opt);
      }
      select.value = preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;
      target.appendChild(select);
      editorPresetSelects.set(target, select);
      select.addEventListener("change", async () => {
        if (!select) return;
        const wasPlaying = daw.getPlaybackState() === "playing";
        if (wasPlaying) {
          daw.pause();
        }
        const overlay = showLoadingOverlay(target);
        try {
          daw.setInstrument(select.value);
          await loadPreset(select.value, trackIds);
        } finally {
          overlay.remove();
          if (wasPlaying) {
            daw.play();
          }
        }
      });
    }
    const daw = mountDAW(target, base);
    mountedEditors.push(daw);
    const presetKey = preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;
    daw.setInstrument(presetKey);
    void loadPreset(presetKey, trackIds);
    const destroy = () => {
      daw.destroy();
      select?.remove();
      if (editorPresetSelects.get(target) === select)
        editorPresetSelects.delete(target);
      const i = mountedEditors.indexOf(daw);
      if (i >= 0) mountedEditors.splice(i, 1);
    };
    return { ...daw, destroy };
  };
  const mountPlayer = (target, mml, opts = {}) => {
    const meta = parseMML(mml, {}).meta ?? {};
    if (meta.instrument && INSTRUMENT_PRESETS[meta.instrument]) {
      void loadPreset(meta.instrument);
    }
    const player = mountMmlPlayer(target, mml, {
      getAudioTime: () => audioCtx.currentTime,
      onResumeAudio: resumeAudio,
      onPlayNote: playPlayerNote,
      onPlayDrum: playDrum,
      singingVoices,
      ...opts
    });
    mountedPlayers.push(player);
    const destroy = () => {
      player.destroy();
      const i = mountedPlayers.indexOf(player);
      if (i >= 0) mountedPlayers.splice(i, 1);
    };
    return { ...player, destroy };
  };
  const dispose = () => {
    for (const p of mountedPlayers) p.destroy();
    for (const d of mountedEditors) d.destroy();
    mountedPlayers.length = 0;
    mountedEditors.length = 0;
    void audioCtx.close();
  };
  return {
    audioContext: audioCtx,
    singingVoices,
    mountEditor,
    mountPlayer,
    loadPreset,
    dispose
  };
};
export {
  DAW_CSS,
  DEFAULT_BPM,
  DEFAULT_GATE,
  DEFAULT_PAN,
  DEFAULT_PLAYBACK_VELOCITY,
  DEFAULT_STEPS_PER_BAR,
  DEFAULT_VELOCITY,
  DEFAULT_VOCAL_VOLUME,
  DRUM_FONT,
  DRUM_KEYS,
  DRUM_PATTERNS,
  INSTRUMENT_PRESETS,
  KOE_BASE_URL,
  KOE_VOICEBANKS,
  KOE_VOICEBANK_LABELS,
  KOE_VOICEBANK_TERMS,
  LinkedList,
  MAX_VOCAL_VOLUME,
  MMLCore,
  PITCH_MAP,
  PREWARM_NOTES,
  TRACKS_ADVANCED,
  TRACKS_SIMPLE,
  VOICE_IMAGE_KEY,
  analyzeMidiTracks,
  applyHarmonicFilter,
  applyMonophonic,
  buildChordPlacements,
  buildNameToKeyMapping,
  collectPitchTokens,
  createAudioContext,
  createDtmStudio,
  createKlattVoice,
  createKoeVoice,
  createLyricsConductor,
  createPianoRoll,
  createSequencer,
  createSingingVoices,
  createVoiceRegistry,
  decomposeToMonophonic,
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
  formatMmlMeta,
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
  isChordHeavyTrack,
  koeUrl,
  mountDAW,
  mountMmlPlayer,
  normalizeLyrics,
  onClick,
  panToStereo,
  parseLyrics,
  parseMML,
  parseMmlMeta,
  setDrawOffset,
  setupRecorder,
  shiftNotes,
  stripLyrics,
  stripMmlMeta,
  vocalVolumeToGain
};
