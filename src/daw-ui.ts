/**
 * DAWのDOM構築。innerHTMLでマークアップを生成し、要素参照を返す。
 * すべて `dtm-` クラスでスタイル付けし、参照は data-dtm 属性経由で取得する。
 */

import { icon } from "./icons";
import type { TrackConfig } from "./types";

export type DawUIRefs = {
	root: HTMLElement;
	// transport
	topbar: HTMLElement;
	topbarLoading: HTMLElement;
	playBtn: HTMLButtonElement;
	prevBarBtn: HTMLButtonElement;
	nextBarBtn: HTMLButtonElement;
	soloCheckbox: HTMLInputElement;
	// tools
	toolPen: HTMLButtonElement;
	toolSelect: HTMLButtonElement;
	toolEraser: HTMLButtonElement;
	undoBtn: HTMLButtonElement;
	redoBtn: HTMLButtonElement;
	noteLengthSelect: HTMLSelectElement;
	bpmInput: HTMLInputElement;
	zoomXLabel: HTMLElement;
	zoomYLabel: HTMLElement;
	zoomXIn: HTMLButtonElement;
	zoomXOut: HTMLButtonElement;
	zoomYIn: HTMLButtonElement;
	zoomYOut: HTMLButtonElement;
	// roll
	rollContainer: HTMLElement;
	wrapper: HTMLElement;
	vScroll: HTMLElement;
	vScrollThumb: HTMLElement;
	hScroll: HTMLElement;
	hScrollThumb: HTMLElement;
	// track panel
	masterVolume: HTMLInputElement;
	masterVolumeLabel: HTMLElement;
	trackTabs: HTMLElement;
	trackBody: HTMLElement;
	// drum
	drumSelect: HTMLSelectElement;
	drumVolume: HTMLInputElement;
	drumVolumeLabel: HTMLElement;
	// io
	midiInput: HTMLInputElement;
	midiLoadBtn: HTMLButtonElement;
	midiInfoBtn: HTMLButtonElement;
	midiTrackSelection: HTMLElement;
	midiPanel: HTMLElement;
	mmlInput: HTMLTextAreaElement;
	mmlLoadBtn: HTMLButtonElement;
	mmlLoadNote: HTMLElement;
	shiftSelect: HTMLSelectElement;
	shiftApplyBtn: HTMLButtonElement;
	// macros
	macroClear: HTMLButtonElement;
	macroRandom: HTMLButtonElement;
	macroHarmonic: HTMLButtonElement;
	macroMono: HTMLButtonElement;
	// output
	exportMidiBtn: HTMLButtonElement;
	generateMmlBtn: HTMLButtonElement;
	decomposeChordToggle: HTMLInputElement;
	ignoreChordHeavyToggle: HTMLInputElement;
	barLimitSelect: HTMLSelectElement;
	outputContainer: HTMLElement;
	outputStatus: HTMLElement;
	outputFull: HTMLElement;
	outputMini: HTMLElement;
	copyFullBtn: HTMLButtonElement;
	copyMiniBtn: HTMLButtonElement;
	// overlay
	overlay: HTMLElement;
	// modal
	mmlInfoBtn: HTMLButtonElement;
	modalOverlay: HTMLElement;
	modalTitle: HTMLElement;
	modalBody: HTMLElement;
	modalClose: HTMLButtonElement;
};

const q = <T extends HTMLElement>(root: HTMLElement, sel: string): T =>
	root.querySelector(sel) as T;

export type BuildUIOptions = {
	tracks: TrackConfig[];
	drumPatternNames: string[];
	defaultDrumPattern: string;
	defaultBpm: number;
	showMidi: boolean;
	showChord: boolean;
};

/**
 * DAWのUIを構築し、要素参照を返す。
 */
export const buildUI = (
	target: HTMLElement,
	options: BuildUIOptions,
): DawUIRefs => {
	const { drumPatternNames, defaultDrumPattern, defaultBpm, showMidi } =
		options;

	const drumOptions = [`<option value="none">なし</option>`]
		.concat(
			drumPatternNames.map(
				(name) =>
					`<option value="${name}" ${name === defaultDrumPattern ? "selected" : ""}>${name}</option>`,
			),
		)
		.join("");

	target.innerHTML = `
<div class="dtm-daw" data-dtm="root">
  <div class="dtm-topbar" data-dtm="transport">
    <div class="dtm-topbar-row1">
      <button class="dtm-iconbtn" data-dtm="prev-bar" title="1小節前">${icon("chevronLeft")}</button>
      <button class="dtm-play" data-dtm="play" disabled>${icon("play")}</button>
      <button class="dtm-iconbtn" data-dtm="next-bar" title="1小節後">${icon("chevronRight")}</button>
      <label class="dtm-toggle"><input type="checkbox" data-dtm="solo"><span>ソロ</span></label>
      <span class="dtm-topbar-loading dtm-blink" data-dtm="topbar-loading">... LOADING ...</span>
      <span class="dtm-grow"></span>
      <span class="dtm-label">BPM</span>
      <input type="number" class="dtm-input dtm-input--num" data-dtm="bpm" value="${defaultBpm}" min="20" max="300">
    </div>
    <div class="dtm-tracks" data-dtm="track-tabs"></div>
  </div>

  <div class="dtm-tooldock">
    <div class="dtm-seg">
      <button class="dtm-segbtn dtm-segbtn--active" data-dtm="tool-pen" title="ペン">${icon("pen")}</button>
      <button class="dtm-segbtn" data-dtm="tool-select" title="選択">${icon("select")}</button>
      <button class="dtm-segbtn" data-dtm="tool-eraser" title="消しゴム">${icon("eraser")}</button>
    </div>
    <button class="dtm-iconbtn" data-dtm="undo" title="元に戻す" disabled>${icon("undo")}</button>
    <button class="dtm-iconbtn" data-dtm="redo" title="やり直し" disabled>${icon("redo")}</button>
    <select class="dtm-select dtm-grow" data-dtm="note-length" title="音符の長さ">
      <option value="48">4分</option>
      <option value="32">3連4</option>
      <option value="24">8分</option>
      <option value="16">3連8</option>
      <option value="12" selected>16分</option>
      <option value="8">3連16</option>
      <option value="6">32分</option>
      <option value="4">3連32</option>
    </select>
  </div>

  <div class="dtm-roll-wrap">
    <div class="dtm-roll" data-dtm="roll">
      <div data-dtm="wrapper" style="position:absolute;inset:0;"></div>
      <div class="dtm-overlay" data-dtm="overlay" hidden><div class="dtm-spinner"></div></div>
    </div>
    <div class="dtm-vscroll" data-dtm="vscroll"><div class="dtm-vscroll-thumb" data-dtm="vscroll-thumb"></div></div>
  </div>
  <div class="dtm-hscroll" data-dtm="hscroll"><div class="dtm-hscroll-thumb" data-dtm="hscroll-thumb"></div></div>

  <details class="dtm-panel" open>
    <summary>トラック設定</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">全体音量</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="master-volume" value="50" min="0" max="100">
        <span class="dtm-label" data-dtm="master-volume-label">50%</span>
      </div>
      <div class="dtm-track-body" data-dtm="track-body"></div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>表示</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">横ズーム</span>
        <button class="dtm-iconbtn" data-dtm="zoomx-out" title="縮小">−</button>
        <span class="dtm-label" data-dtm="zoomx-label">100%</span>
        <button class="dtm-iconbtn" data-dtm="zoomx-in" title="拡大">＋</button>
      </div>
      <div class="dtm-row">
        <span class="dtm-label">縦ズーム</span>
        <button class="dtm-iconbtn" data-dtm="zoomy-out" title="縮小">−</button>
        <span class="dtm-label" data-dtm="zoomy-label">100%</span>
        <button class="dtm-iconbtn" data-dtm="zoomy-in" title="拡大">＋</button>
      </div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>ドラム設定</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">リズム</span>
        <select class="dtm-select" data-dtm="drum-select">${drumOptions}</select>
      </div>
      <div class="dtm-row">
        <span class="dtm-label">音量</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="drum-volume" value="80" min="0" max="100">
        <span class="dtm-label" data-dtm="drum-volume-label">80%</span>
      </div>
    </div>
  </details>

  <details class="dtm-panel ${showMidi ? "" : "dtm-hidden"}" data-dtm="midi-panel">
    <summary>MIDI / MML 入力</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row" style="flex-wrap:nowrap">
        <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 4px; justify-content: center; flex-shrink:0;">
          <span class="dtm-label" style="line-height: 1;">MIDI</span>
          <button class="dtm-infobtn" data-dtm="midi-info" title="MIDIの読み込み解説">${icon("info", 12)}</button>
        </div>
        <input type="file" class="dtm-input dtm-grow" accept=".mid,.midi" data-dtm="midi-input" style="min-width:0">
        <button class="dtm-btn dtm-btn--success" data-dtm="midi-load" style="flex-shrink:0">読込</button>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="midi-track-selection"></div>
      <div class="dtm-row" style="flex-wrap:nowrap">
        <div style="display: inline-flex; flex-direction: column; align-items: center; gap: 4px; justify-content: center; flex-shrink:0;">
          <span class="dtm-label" style="line-height: 1;">MML</span>
          <button class="dtm-infobtn" data-dtm="mml-info" title="MMLの書き方解説">${icon("info", 12)}</button>
        </div>
        <textarea class="dtm-textarea dtm-grow" data-dtm="mml-input" placeholder="MMLを入力"></textarea>
        <button class="dtm-btn dtm-btn--primary" data-dtm="mml-load" style="flex-shrink:0">読込</button>
      </div>
      <p class="dtm-load-note dtm-hidden" data-dtm="mml-load-note"></p>
    </div>
  </details>

  <details class="dtm-panel" style="display: none;">
    <summary>マクロ</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <span class="dtm-label">全体シフト</span>
        <select class="dtm-select" data-dtm="shift-select">
          <option value="-192">-1小節</option>
          <option value="-96">-2分</option>
          <option value="-48">-4分</option>
          <option value="-24">-8分</option>
          <option value="-12">-16分</option>
          <option value="12">+16分</option>
          <option value="24">+8分</option>
          <option value="48">+4分</option>
          <option value="96">+2分</option>
          <option value="192">+1小節</option>
        </select>
        <button class="dtm-btn dtm-btn--primary" data-dtm="shift-apply">適用</button>
      </div>
      <div class="dtm-row">
        <button class="dtm-btn dtm-btn--danger" data-dtm="macro-clear">全消去</button>
        <button class="dtm-btn dtm-btn--accent" data-dtm="macro-random">ランダム配置</button>
        <button class="dtm-btn dtm-btn--primary" data-dtm="macro-harmonic">伴奏フィルタ</button>
        <button class="dtm-btn dtm-btn--primary" data-dtm="macro-mono">単音化</button>
      </div>
    </div>
  </details>

  <details class="dtm-panel">
    <summary>MIDI / MML 出力</summary>
    <div class="dtm-panel-body">
      <div class="dtm-row">
        <button class="dtm-btn dtm-btn--accent" data-dtm="export-midi">MIDI出力</button>
        <button class="dtm-btn dtm-btn--success" data-dtm="generate-mml">MML生成</button>
      </div>
      <label class="dtm-checkbox-label">
        <input type="checkbox" class="dtm-checkbox" data-dtm="decompose-chord">
        <span>和音分解モード（単音トラックに最適分割）</span>
      </label>
      <label class="dtm-checkbox-label dtm-checkbox-label--sub">
        <input type="checkbox" class="dtm-checkbox" data-dtm="ignore-chord-heavy">
        <span>和音伴奏トラックを無視（分解対象から除外）</span>
      </label>
      <div class="dtm-row" style="margin-top:6px;align-items:center;gap:8px;">
        <span class="dtm-label">生成上限</span>
        <select class="dtm-select" data-dtm="bar-limit">
          <option value="0">制限なし</option>
          <option value="8">8小節</option>
          <option value="16">16小節</option>
          <option value="24">24小節</option>
          <option value="32">32小節</option>
          <option value="64">64小節</option>
          <option value="128">128小節</option>
        </select>
      </div>
      <div class="dtm-output dtm-hidden" data-dtm="output-container">
        <p class="dtm-label" data-dtm="output-status"></p>
        <div class="dtm-output-label">改行あり版</div>
        <div class="dtm-output-row">
          <pre><code data-dtm="output-full"></code></pre>
          <button class="dtm-btn dtm-btn--primary dtm-btn--icon" data-dtm="copy-full" title="コピー">${icon("copy")}</button>
        </div>
        <div class="dtm-output-label">１行版</div>
        <div class="dtm-output-row">
          <pre><code data-dtm="output-mini"></code></pre>
          <button class="dtm-btn dtm-btn--primary dtm-btn--icon" data-dtm="copy-mini" title="コピー">${icon("copy")}</button>
        </div>
      </div>
    </div>
  </details>

  <!-- ════ 解説モーダル ════ -->
  <div class="dtm-modal-overlay" data-dtm="modal-overlay" hidden>
    <div class="dtm-win dtm-modal">
      <div class="dtm-modal-header">
        <span class="dtm-modal-title" data-dtm="modal-title"></span>
        <button class="dtm-modal-close" data-dtm="modal-close">&times;</button>
      </div>
      <div class="dtm-modal-body" data-dtm="modal-body"></div>
    </div>
  </div>

</div>`;

	const root = q<HTMLElement>(target, '[data-dtm="root"]');
	const sel = <T extends HTMLElement>(name: string): T =>
		q<T>(root, `[data-dtm="${name}"]`);

	return {
		root,
		topbar: sel("transport"),
		topbarLoading: sel("topbar-loading"),
		playBtn: sel("play"),
		prevBarBtn: sel("prev-bar"),
		nextBarBtn: sel("next-bar"),
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
		midiInfoBtn: sel("midi-info"),
		midiTrackSelection: sel("midi-track-selection"),
		midiPanel: sel("midi-panel"),
		mmlInput: sel("mml-input"),
		mmlLoadBtn: sel("mml-load"),
		mmlLoadNote: sel("mml-load-note"),
		shiftSelect: sel("shift-select"),
		shiftApplyBtn: sel("shift-apply"),
		macroClear: sel("macro-clear"),
		macroRandom: sel("macro-random"),
		macroHarmonic: sel("macro-harmonic"),
		macroMono: sel("macro-mono"),
		exportMidiBtn: sel("export-midi"),
		generateMmlBtn: sel("generate-mml"),
		decomposeChordToggle: sel<HTMLInputElement>("decompose-chord"),
		ignoreChordHeavyToggle: sel<HTMLInputElement>("ignore-chord-heavy"),
		barLimitSelect: sel<HTMLSelectElement>("bar-limit"),
		outputContainer: sel("output-container"),
		outputStatus: sel("output-status"),
		outputFull: sel("output-full"),
		outputMini: sel("output-mini"),
		copyFullBtn: sel("copy-full"),
		copyMiniBtn: sel("copy-mini"),
		overlay: sel("overlay"),
		mmlInfoBtn: sel("mml-info"),
		modalOverlay: sel("modal-overlay"),
		modalTitle: sel("modal-title"),
		modalBody: sel("modal-body"),
		modalClose: sel("modal-close"),
	};
};
