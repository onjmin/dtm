/**
 * mountDAW が注入する自己完結スタイル。
 * すべてのクラスは `dtm-` プレフィックスでスコープし、ホスト側CSSと衝突しにくくする。
 * ドット絵・レトロゲーム風ピクセルアートデザイン（美咲フォント・角なし・ハードシャドウ）。
 * モバイルファースト（狭幅基準）で設計し、min-width メディアクエリで広幅に拡張する。
 */

const STYLE_ID = "dtm-daw-styles";

export const DAW_CSS = `
@font-face {
  font-family: 'k8x12';
  src: url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.woff2') format('woff2'),
       url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.woff') format('woff'),
       url('https://db.onlinewebfonts.com/t/777630d46640dc5a928ea833c2fcb875.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
}

/* ====================================================
   PIXEL MUSIC STUDIO — ドット絵UIシステム
   PICO-8カラーパレット・美咲フォント・ゲームウィンドウ枠
   ==================================================== */

.dtm-daw {
  /* PICO-8 16色パレットより */
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

  /* セマンティックトークン */
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

/* ─── ゲームウィンドウ共通枠 ─── */
/* 外枠(黒2px) → 色付き2px border → 内枠(黒inset2px) の3重構造 */
.dtm-win {
  border: 2px solid var(--c-black);
  box-shadow:
    inset 0 0 0 2px var(--c-black),
    0 0 0 2px var(--dtm-primary),
    4px 4px 0 var(--c-black);
  background: var(--dtm-surface);
}

/* ─── 共通ボタン ─── */
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

/* ─── アイコンボタン ─── */
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

/* ─── トランスポートバー（HUDスタイル） ─── */
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

/* PLAYボタン — ゲームの「決定ボタン」的存在感 */
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

/* BPM — デジタルカウンター風 */
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

/* ─── ツールドック（装備スロット風） ─── */
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

/* ─── セグメント（アイテムスロット） ─── */
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

/* ─── フォーム要素 ─── */
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

/* ─── トラックピル（キャラクター選択ボタン） ─── */
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
/* アクティブ選択 = 金色ハイライト + カーソル */
.dtm-pill--active {
  border-color: var(--dtm-gold);
  color: var(--dtm-gold);
  background: var(--dtm-surface);
  box-shadow: 0 0 0 2px var(--dtm-gold), 3px 3px 0 var(--c-black);
}
.dtm-pill--active::before { content: "► "; font-size: 10px; }
.dtm-pill:not(.dtm-pill--active):active { transform: translate(3px,3px); box-shadow: none; }

/* ─── ピアノロール（トラッカー風） ─── */
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

/* ─── パネル（RPGダイアログウィンドウ） ─── */
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
/* 左端ライン（ゲームUIのセクション色分け） */
.dtm-panel > summary::before {
  content: '';
  display: block;
  width: 4px;
  height: 20px;
  background: var(--dtm-accent);
  flex: 0 0 auto;
}
.dtm-panel[open] > summary::before { background: var(--dtm-primary); }
/* 折りたたみ矢印 */
.dtm-panel > summary::after {
  content: "▶";
  margin-left: auto;
  color: var(--dtm-muted);
  font-size: 10px;
}
.dtm-panel[open] > summary::after { content: "▼"; }
.dtm-panel-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.dtm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dtm-track-body { display: flex; flex-direction: column; gap: 10px; }

/* ─── MML出力（CRTターミナル） ─── */
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

/* ─── ローディングオーバーレイ ─── */
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
/* 8ブロック刻みで埋まるピクセルバー */
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
/* 進捗が確定したら無限ループ演出を止め、実測値で塗りつぶす */
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

/* ─── 広幅拡張 ─── */
@media (min-width: 768px) {
  .dtm-daw { gap: 8px; padding: 10px; }
  .dtm-roll { height: 420px; }
}

/* ====================================================
   MML PLAYER — 再生専用ビュー（mountMmlPlayer）
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
.dtm-player-tempo,
.dtm-player-time {
  font-family: 'k8x12', monospace;
  font-size: 12px;
  color: var(--dtm-muted);
}
.dtm-player-time { color: var(--dtm-text); min-width: 3em; }
.dtm-player-dots {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dtm-player-dot { width: 8px; height: 8px; display: inline-block; }
.dtm-player-chip {
  font-family: 'k8x12', monospace;
  font-size: 9px;
  color: var(--dtm-text);
  background: var(--dtm-border2);
  padding: 2px 6px;
  white-space: nowrap;
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
.dtm-player-lane-no {
  font-family: 'k8x12', monospace;
  font-size: 9px;
  color: var(--dtm-muted);
}
.dtm-player-lane {
  position: relative; /* トークンの offsetParent をレーンに固定し、中央寄せ計算を正す */
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

/**
 * スタイルを document.head に一度だけ注入する。
 */
export const injectStyles = (doc: Document = document): void => {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.textContent = DAW_CSS;
	doc.head.appendChild(style);
};

/**
 * container 内にローディング画面を表示する。
 *
 * - `remove()` でオーバーレイを除去する。
 * - `setProgress(done, total)` で進捗を反映する。total>0 のときはバーを実測値で
 *   塗り、`done / total (NN%)` を表示する。total<=0 なら不確定（無限ループ）演出に戻す。
 */
export const showLoadingOverlay = (
	container: HTMLElement,
): {
	remove: () => void;
	setProgress: (done: number, total: number) => void;
} => {
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

	const setProgress = (done: number, total: number): void => {
		if (total > 0) {
			const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
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
		setProgress,
	};
};
