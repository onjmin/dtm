/**
 * mountDAW が注入する自己完結スタイル。
 * すべてのクラスは `dtm-` プレフィックスでスコープし、ホスト側CSSと衝突しにくくする。
 * ドット絵・レトロゲーム風ピクセルアートデザイン（美咲フォント・角なし・ハードシャドウ）。
 * モバイルファースト（狭幅基準）で設計し、min-width メディアクエリで広幅に拡張する。
 */

const STYLE_ID = "dtm-daw-styles";

export const DAW_CSS = `
@font-face {
  font-family: 'MisakiGothic';
  src: url('https://cdn.jsdelivr.net/npm/misaki-font/misaki_gothic.woff2') format('woff2'),
       url('https://cdn.jsdelivr.net/npm/misaki-font/misaki_gothic.woff') format('woff');
  font-weight: normal;
  font-style: normal;
}

.dtm-daw {
  --dtm-bg: #1a1c2c;
  --dtm-surface: #16213e;
  --dtm-surface2: #0f0f23;
  --dtm-border: #3d405b;
  --dtm-text: #f4f4f4;
  --dtm-muted: #7e7e8a;
  --dtm-primary: #29adff;
  --dtm-primary-fg: #000a1a;
  --dtm-danger: #ff004d;
  --dtm-success: #00e436;
  --dtm-accent: #ff77a8;
  --dtm-warn: #ffa300;
  --dtm-radius: 0px;
  --dtm-tap: 40px;
  --dtm-shadow: 3px 3px 0 #000;
  --dtm-font: 'MisakiGothic', 'MS Gothic', 'ＭＳ ゴシック', ui-monospace, monospace;
  box-sizing: border-box;
  font-family: var(--dtm-font);
  color: var(--dtm-text);
  background: var(--dtm-bg);
  background-image: repeating-linear-gradient(
    0deg, transparent, transparent 3px,
    rgba(0,0,0,.18) 3px, rgba(0,0,0,.18) 4px
  );
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  image-rendering: pixelated;
  -webkit-tap-highlight-color: transparent;
}
.dtm-daw *,
.dtm-daw *::before,
.dtm-daw *::after { box-sizing: border-box; }

/* --- 共通ボタン（パネル内） --- */
.dtm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--dtm-tap);
  min-width: var(--dtm-tap);
  padding: 0 12px;
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-family: var(--dtm-font);
  font-size: 13px;
  font-weight: normal;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  box-shadow: var(--dtm-shadow);
  transition: none;
  letter-spacing: .05em;
}
.dtm-btn:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #000; }
.dtm-btn:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; }
.dtm-btn--primary { background: var(--dtm-primary); color: var(--dtm-primary-fg); border-color: var(--dtm-primary); }
.dtm-btn--success { background: var(--dtm-success); color: #000; border-color: var(--dtm-success); }
.dtm-btn--danger  { background: var(--dtm-danger);  color: #fff; border-color: var(--dtm-danger); }
.dtm-btn--accent  { background: var(--dtm-accent);  color: #000; border-color: var(--dtm-accent); }
.dtm-btn--ghost   { background: transparent; border-color: var(--dtm-border); }
.dtm-btn--icon    { padding: 0; }

/* --- アイコンボタン --- */
.dtm-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  flex: 0 0 auto;
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--dtm-shadow);
}
.dtm-iconbtn:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #000; }
.dtm-iconbtn:disabled { opacity: .3; cursor: not-allowed; box-shadow: none; }

/* --- トランスポートバー（常時表示・上部固定） --- */
.dtm-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: var(--dtm-surface2);
  border: 2px solid var(--dtm-border);
  box-shadow: var(--dtm-shadow);
}
.dtm-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--dtm-tap);
  padding: 0 18px;
  border: 2px solid var(--dtm-success);
  border-radius: 0;
  background: var(--dtm-success);
  color: #000;
  font-family: var(--dtm-font);
  font-size: 13px;
  font-weight: normal;
  cursor: pointer;
  box-shadow: var(--dtm-shadow);
  letter-spacing: .1em;
}
.dtm-play:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #000; }
.dtm-play:disabled { opacity: .4; cursor: not-allowed; box-shadow: none; }
.dtm-play--stop {
  background: var(--dtm-danger);
  border-color: var(--dtm-danger);
  color: #fff;
}
.dtm-rec { color: var(--dtm-danger); }
.dtm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--dtm-font);
  font-size: 12px;
  color: var(--dtm-muted);
  cursor: pointer;
  letter-spacing: .05em;
}
.dtm-toggle input { width: 16px; height: 16px; accent-color: var(--dtm-accent); }

/* --- ツールドック（折返し・横スクロールなし） --- */
.dtm-tooldock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: var(--dtm-surface2);
  border: 2px solid var(--dtm-border);
  box-shadow: var(--dtm-shadow);
}
.dtm-sep {
  width: 2px; align-self: stretch;
  background: var(--dtm-border); margin: 2px;
}
.dtm-label {
  font-family: var(--dtm-font);
  font-size: 12px;
  color: var(--dtm-muted);
  white-space: nowrap;
  letter-spacing: .05em;
}
.dtm-row .dtm-label[data-dtm] { min-width: 44px; text-align: center; }

/* --- セグメント型ツール選択（ピクセルアート） --- */
.dtm-seg {
  display: inline-flex;
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  overflow: hidden;
  background: var(--dtm-surface2);
  box-shadow: var(--dtm-shadow);
}
.dtm-segbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  border: none;
  border-right: 2px solid var(--dtm-border);
  background: transparent;
  color: var(--dtm-muted);
  cursor: pointer;
}
.dtm-segbtn:last-child { border-right: none; }
.dtm-segbtn--active {
  background: var(--dtm-primary);
  color: var(--dtm-primary-fg);
}
.dtm-segbtn:active:not(.dtm-segbtn--active) { background: var(--dtm-border); }

/* --- フォーム要素 --- */
.dtm-select, .dtm-input, .dtm-textarea {
  min-height: var(--dtm-tap);
  padding: 4px 8px;
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  background: var(--dtm-surface2);
  color: var(--dtm-text);
  font-family: var(--dtm-font);
  font-size: 13px;
  box-shadow: inset 1px 1px 0 #000;
}
.dtm-select:focus, .dtm-input:focus, .dtm-textarea:focus {
  outline: 2px solid var(--dtm-primary);
  outline-offset: 0;
}
.dtm-input--num { width: 68px; text-align: center; }
.dtm-textarea {
  width: 100%; min-height: 56px; resize: vertical;
  letter-spacing: .04em; line-height: 1.6;
}
.dtm-range { height: var(--dtm-tap); accent-color: var(--dtm-primary); }

/* --- トラックピル（色分け・常時表示・折返し） --- */
.dtm-tracks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px;
}
.dtm-pill {
  --dtm-pill-color: var(--dtm-primary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 40px;
  padding: 0 12px;
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  background: var(--dtm-surface2);
  color: var(--dtm-muted);
  font-family: var(--dtm-font);
  font-size: 13px;
  cursor: pointer;
  box-shadow: var(--dtm-shadow);
  letter-spacing: .06em;
}
.dtm-pill .dtm-dot {
  width: 8px;
  height: 8px;
  border-radius: 0;
  background: var(--dtm-pill-color);
  flex: 0 0 auto;
  box-shadow: 1px 1px 0 #000;
}
.dtm-pill--active {
  border-color: var(--dtm-pill-color);
  color: var(--dtm-text);
  background: var(--dtm-surface);
  box-shadow: 3px 3px 0 var(--dtm-pill-color);
}
.dtm-pill:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #000; }

/* --- ピアノロール --- */
.dtm-roll-wrap { display: flex; gap: 6px; }
.dtm-roll {
  position: relative;
  flex: 1 1 auto;
  height: 58vh;
  min-height: 280px;
  background: var(--dtm-surface2);
  border: 2px solid var(--dtm-border);
  box-shadow: var(--dtm-shadow);
  overflow: hidden;
}
.dtm-vscroll {
  position: relative;
  width: 12px;
  border-radius: 0;
  background: var(--dtm-surface2);
  border: 2px solid var(--dtm-border);
  cursor: pointer;
  flex: 0 0 auto;
}
.dtm-vscroll-thumb, .dtm-hscroll-thumb {
  position: absolute;
  background: var(--dtm-primary);
  border-radius: 0;
  opacity: .8;
}
.dtm-vscroll-thumb { left: 0; width: 100%; }
.dtm-hscroll {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 0;
  background: var(--dtm-surface2);
  border: 2px solid var(--dtm-border);
  cursor: pointer;
}
.dtm-hscroll-thumb { top: 0; height: 100%; }

/* --- パネル（折りたたみ） --- */
.dtm-panel {
  background: var(--dtm-surface);
  border: 2px solid var(--dtm-border);
  border-radius: 0;
  box-shadow: var(--dtm-shadow);
  overflow: hidden;
}
.dtm-panel > summary {
  list-style: none;
  cursor: pointer;
  padding: 8px 12px;
  font-family: var(--dtm-font);
  font-size: 13px;
  letter-spacing: .1em;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--dtm-tap);
  background: var(--dtm-surface2);
  border-bottom: 2px solid var(--dtm-border);
  color: var(--dtm-primary);
}
.dtm-panel:not([open]) > summary { border-bottom: none; }
.dtm-panel > summary::-webkit-details-marker { display: none; }
.dtm-panel > summary::before { content: "▶ "; color: var(--dtm-accent); }
.dtm-panel[open] > summary::before { content: "▼ "; }
.dtm-panel > summary::after { content: none; }
.dtm-panel-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.dtm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

/* --- アクティブトラックのボディ --- */
.dtm-track-body { display: flex; flex-direction: column; gap: 10px; }

/* --- MML出力 --- */
.dtm-output {
  background: #000;
  color: var(--dtm-success);
  border: 2px solid var(--dtm-success);
  padding: 10px;
  box-shadow: 3px 3px 0 rgba(0,228,54,.4);
}
.dtm-output pre {
  margin: 0;
  background: transparent;
  padding: 8px 0 0;
  overflow-x: auto;
  font-family: var(--dtm-font);
  font-size: 12px;
  line-height: 1.7;
  color: var(--dtm-success);
}
.dtm-output-row { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; }
.dtm-output-row pre { flex: 1; }

/* --- オーバーレイ --- */
.dtm-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center;
}
.dtm-overlay[hidden] { display: none; }
.dtm-spinner {
  width: 32px; height: 32px;
  border: 4px solid var(--dtm-primary);
  border-top-color: transparent;
  border-radius: 0;
  animation: dtm-spin .6s steps(8) infinite;
}
@keyframes dtm-spin { to { transform: rotate(360deg); } }

.dtm-hidden { display: none !important; }
.dtm-grow { flex: 1 1 auto; }

/* --- 広幅（タブレット/PC）拡張 --- */
@media (min-width: 768px) {
  .dtm-daw { gap: 8px; padding: 12px; }
  .dtm-roll { height: 440px; }
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
