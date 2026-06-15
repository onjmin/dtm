/**
 * mountDAW が注入する自己完結スタイル。
 * すべてのクラスは `dtm-` プレフィックスでスコープし、ホスト側CSSと衝突しにくくする。
 * モバイルファースト（狭幅基準）で設計し、min-width メディアクエリで広幅に拡張する。
 */

const STYLE_ID = "dtm-daw-styles";

export const DAW_CSS = `
.dtm-daw {
  --dtm-bg: #f3f4f6;
  --dtm-surface: #ffffff;
  --dtm-border: #d1d5db;
  --dtm-text: #1f2937;
  --dtm-muted: #6b7280;
  --dtm-primary: #3b82f6;
  --dtm-primary-fg: #ffffff;
  --dtm-danger: #ef4444;
  --dtm-success: #10b981;
  --dtm-accent: #8b5cf6;
  --dtm-radius: 10px;
  --dtm-tap: 44px;
  box-sizing: border-box;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--dtm-text);
  background: var(--dtm-bg);
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  -webkit-tap-highlight-color: transparent;
}
.dtm-daw *,
.dtm-daw *::before,
.dtm-daw *::after { box-sizing: border-box; }

/* --- ボタン基本 --- */
.dtm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--dtm-tap);
  min-width: var(--dtm-tap);
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--dtm-radius);
  background: #e5e7eb;
  color: var(--dtm-text);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background .15s, color .15s, opacity .15s;
}
.dtm-btn:active { transform: translateY(1px); }
.dtm-btn:disabled { opacity: .45; cursor: not-allowed; }
.dtm-btn--primary { background: var(--dtm-primary); color: var(--dtm-primary-fg); }
.dtm-btn--success { background: var(--dtm-success); color: #fff; }
.dtm-btn--danger { background: var(--dtm-danger); color: #fff; }
.dtm-btn--accent { background: var(--dtm-accent); color: #fff; }
.dtm-btn--ghost { background: transparent; border-color: var(--dtm-border); }
.dtm-btn--active { background: var(--dtm-primary); color: var(--dtm-primary-fg); }
.dtm-btn--icon { padding: 0; }

/* --- 横スクロール式ツールストリップ --- */
.dtm-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  padding: 6px;
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
}
.dtm-strip::-webkit-scrollbar { height: 6px; }
.dtm-strip > * { flex: 0 0 auto; }
.dtm-sep { width: 1px; align-self: stretch; background: var(--dtm-border); margin: 2px 2px; }
.dtm-label { font-size: 13px; color: var(--dtm-muted); font-weight: 600; white-space: nowrap; }

/* --- フォーム要素 --- */
.dtm-select, .dtm-input, .dtm-textarea {
  min-height: var(--dtm-tap);
  padding: 6px 10px;
  border: 1px solid var(--dtm-border);
  border-radius: 8px;
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-size: 14px;
}
.dtm-input--num { width: 72px; text-align: center; }
.dtm-textarea { width: 100%; min-height: 56px; resize: vertical; font-family: ui-monospace, monospace; }
.dtm-range { height: var(--dtm-tap); accent-color: var(--dtm-primary); }

/* --- ピアノロール --- */
.dtm-roll-wrap { display: flex; gap: 6px; }
.dtm-roll {
  position: relative;
  flex: 1 1 auto;
  height: 56vh;
  min-height: 280px;
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  overflow: hidden;
}
.dtm-vscroll {
  position: relative;
  width: 18px;
  border-radius: 6px;
  background: #e5e7eb;
  cursor: pointer;
  flex: 0 0 auto;
}
.dtm-vscroll-thumb, .dtm-hscroll-thumb {
  position: absolute;
  background: var(--dtm-primary);
  border-radius: 6px;
  opacity: .7;
}
.dtm-vscroll-thumb { left: 0; width: 100%; }
.dtm-hscroll {
  position: relative;
  width: 100%;
  height: 18px;
  border-radius: 6px;
  background: #e5e7eb;
  cursor: pointer;
}
.dtm-hscroll-thumb { top: 0; height: 100%; }

/* --- パネル（折りたたみ） --- */
.dtm-panel {
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  overflow: hidden;
}
.dtm-panel > summary {
  list-style: none;
  cursor: pointer;
  padding: 12px 14px;
  font-weight: 700;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: var(--dtm-tap);
}
.dtm-panel > summary::-webkit-details-marker { display: none; }
.dtm-panel > summary::after { content: "▾"; color: var(--dtm-muted); }
.dtm-panel[open] > summary::after { content: "▴"; }
.dtm-panel-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.dtm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

/* --- トラックタブ --- */
.dtm-tabs { display: flex; gap: 4px; overflow-x: auto; }
.dtm-tab {
  flex: 0 0 auto;
  min-height: var(--dtm-tap);
  padding: 0 14px;
  border: 1px solid var(--dtm-border);
  border-radius: 8px 8px 0 0;
  background: #f1f5f9;
  color: var(--dtm-muted);
  font-weight: 600;
  cursor: pointer;
}
.dtm-tab--active { background: var(--dtm-surface); color: var(--dtm-accent); border-bottom-color: transparent; }
.dtm-track-body { border: 1px solid var(--dtm-border); border-top: none; border-radius: 0 0 8px 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

/* --- MML出力 --- */
.dtm-output { background: #1f2937; color: #e5e7eb; border-radius: var(--dtm-radius); padding: 12px; }
.dtm-output pre { margin: 0; background: #000; padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
.dtm-output-row { display: flex; gap: 8px; align-items: flex-start; margin-top: 8px; }
.dtm-output-row pre { flex: 1; }

/* --- オーバーレイ --- */
.dtm-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
}
.dtm-overlay[hidden] { display: none; }
.dtm-spinner {
  width: 40px; height: 40px;
  border: 4px solid var(--dtm-primary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: dtm-spin .8s linear infinite;
}
@keyframes dtm-spin { to { transform: rotate(360deg); } }

.dtm-hidden { display: none !important; }
.dtm-grow { flex: 1 1 auto; }
.dtm-title { font-size: 18px; font-weight: 800; margin: 0 0 4px; }

/* --- 広幅（タブレット/PC）拡張 --- */
@media (min-width: 768px) {
  .dtm-daw { --dtm-tap: 38px; gap: 12px; padding: 12px; }
  .dtm-roll { height: 450px; }
  .dtm-btn { font-size: 14px; }
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
