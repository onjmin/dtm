"use strict";
(() => {
  // node_modules/.pnpm/@onjmin+koe@1.0.4/node_modules/@onjmin/koe/dist/index.js
  var MAGIC = 1263486208;
  function parseKoeHeader(headerBytes) {
    const view = new DataView(headerBytes);
    if (view.byteLength < 8 || view.getUint32(0, false) !== MAGIC) {
      throw new Error("Not a .koe file (bad magic)");
    }
    return { jsonLength: view.getUint32(4, true) };
  }
  var pcmBase = (jsonLength) => 8 + jsonLength;
  var MAX_PHONEME_SAMPLES = 5242880;
  var MAX_JSON_LENGTH = 50 * 1024 * 1024;
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
      return rangeFetch(this.url, start, length);
    }
  };
  async function rangeFetch(url, start, length) {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${start + length - 1}` },
      credentials: "omit"
      // never leak cookies / auth to a MML-supplied URL
    });
    if (res.status !== 206) {
      throw new Error(
        `.koe fetch failed: expected 206 Partial Content, got ${res.status}`
      );
    }
    return readCapped(res, length);
  }
  async function readCapped(res, length) {
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = await res.arrayBuffer();
      if (buf.byteLength > length) {
        throw new Error(
          `.koe fetch failed: response exceeds requested ${length} bytes`
        );
      }
      return buf;
    }
    const out = new Uint8Array(length);
    let received = 0;
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > length) {
        await reader.cancel();
        throw new Error(
          `.koe fetch failed: response exceeds requested ${length} bytes`
        );
      }
      out.set(value, received);
      received += value.byteLength;
    }
    return received === length ? out.buffer : out.buffer.slice(0, received);
  }
  function validateJsonLength(jsonLength) {
    if (!Number.isInteger(jsonLength) || jsonLength < 0 || jsonLength > MAX_JSON_LENGTH) {
      throw new Error(`manifest JSON length out of bounds: ${jsonLength}`);
    }
  }
  function parseManifest(json) {
    const manifest = JSON.parse(new TextDecoder().decode(json));
    if (!manifest || typeof manifest !== "object" || typeof manifest.phonemes !== "object" || manifest.phonemes === null) {
      throw new Error("invalid manifest: missing phonemes table");
    }
    return manifest;
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
      try {
        if (typeof koe === "string") {
          if (/^blob:/i.test(koe)) {
            const res = await fetch(koe);
            if (!res.ok) {
              throw new Error(`blob: URL fetch failed: ${res.status}`);
            }
            return await _VoiceBank.fromBlob(await res.blob());
          }
          if (!/^https?:/i.test(koe)) {
            throw new Error(`unsupported URL protocol: ${koe}`);
          }
          const header = await rangeFetch(koe, 0, 8);
          const { jsonLength } = parseKoeHeader(header);
          validateJsonLength(jsonLength);
          const json = await rangeFetch(koe, 8, jsonLength);
          const manifest = parseManifest(json);
          return new _VoiceBank(
            manifest,
            new RangeVoiceSource(koe, pcmBase(jsonLength))
          );
        }
        return await _VoiceBank.fromBlob(koe);
      } catch (error) {
        throw new Error(
          `Failed to load .koe voice bank: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    static async fromBlob(koe) {
      const header = await koe.slice(0, 8).arrayBuffer();
      const { jsonLength } = parseKoeHeader(header);
      validateJsonLength(jsonLength);
      const json = await koe.slice(8, 8 + jsonLength).arrayBuffer();
      const manifest = parseManifest(json);
      return new _VoiceBank(
        manifest,
        new BlobVoiceSource(koe, pcmBase(jsonLength))
      );
    }
    /** True if the bank contains a phoneme under this alias. */
    has(phoneme) {
      return Object.hasOwn(this.manifest.phonemes, phoneme);
    }
    /**
     * Raw Int16 PCM bytes (48 kHz / mono) for a phoneme, or null if unknown.
     * The returned ArrayBuffer is freshly allocated and safe to transfer to a
     * worker / AudioWorklet.
     */
    async readPcmBytes(phoneme) {
      if (!Object.hasOwn(this.manifest.phonemes, phoneme)) return null;
      const entry = this.manifest.phonemes[phoneme];
      if (!Number.isInteger(entry.offset) || !Number.isInteger(entry.length) || entry.offset < 0 || entry.length < 0 || entry.length > MAX_PHONEME_SAMPLES) {
        throw new Error(`manifest entry out of bounds for phoneme: ${phoneme}`);
      }
      return this.source.readBytes(entry.offset, entry.length * 2);
    }
    /**
     * A phoneme's PCM as a Float64Array normalised to [-1, 1], or null if unknown.
     * Intended for external analysis / resynthesis such as the WORLD vocoder.
     */
    async getPcm(phoneme) {
      const buf = await this.readPcmBytes(phoneme);
      if (!buf) return null;
      const int16 = new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
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
      const audio = outLen > 0 && yPtr ? new Float32Array(WL.HEAPF32.buffer, yPtr, outLen).slice() : null;
      if (yPtr) WL._free(yPtr);
      WL._free(yPtrPtr);
      WL._PhraseSynthDelete(ps);
      return audio;
    }
  };

  // src/voice-worker.ts
  var KOE_SAMPLE_RATE = 48e3;
  var midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);
  var wself = globalThis;
  var bank = null;
  var worldline = null;
  var pcmCache = /* @__PURE__ */ new Map();
  var getPcm = (alias) => {
    let p = pcmCache.get(alias);
    if (!p) {
      p = bank.getPcm(alias);
      pcmCache.set(alias, p);
    }
    return p;
  };
  var renderAlias = async (alias, pitch, durationMs) => {
    if (!bank) return null;
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
  wself.onmessage = async (ev) => {
    const msg = ev.data;
    if (msg.type === "init") {
      try {
        bank = await VoiceBank.load(msg.koe);
        worldline = msg.lightweight ? null : await Worldline.load({ scriptUrl: msg.worldlineScriptUrl }).catch(
          () => null
        );
        wself.postMessage({
          type: "ready",
          aliases: Object.keys(bank.manifest.phonemes)
        });
      } catch (err) {
        wself.postMessage({
          type: "error",
          message: String(err?.message ?? err)
        });
      }
      return;
    }
    if (msg.type === "render") {
      const { id, alias, pitch, durationMs } = msg;
      try {
        const out = await renderAlias(alias, pitch, durationMs);
        if (out) {
          wself.postMessage(
            {
              type: "rendered",
              id,
              pcm: out.pcm,
              preSec: out.preSec,
              rate: out.rate
            },
            [out.pcm.buffer]
          );
        } else {
          wself.postMessage({ type: "rendered", id, pcm: null });
        }
      } catch {
        wself.postMessage({ type: "rendered", id, pcm: null });
      }
    }
  };
})();
