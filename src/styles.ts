/**
 * mountDAW が注入する自己完結スタイル。
 * すべてのクラスは `dtm-` プレフィックスでスコープし、ホスト側CSSと衝突しにくくする。
 * モバイルファースト（狭幅基準）で設計し、min-width メディアクエリで広幅に拡張する。
 */

const STYLE_ID = "dtm-daw-styles";

export const DAW_CSS = `
.dtm-daw {
  --dtm-bg: #eef2f7;
  --dtm-surface: #ffffff;
  --dtm-border: #d8dee9;
  --dtm-text: #1f2937;
  --dtm-muted: #6b7280;
  --dtm-primary: #3b82f6;
  --dtm-primary-fg: #ffffff;
  --dtm-danger: #ef4444;
  --dtm-success: #10b981;
  --dtm-accent: #8b5cf6;
  --dtm-radius: 12px;
  --dtm-tap: 44px;
  --dtm-shadow: 0 1px 3px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.04);
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

/* --- 共通ボタン（パネル内） --- */
.dtm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--dtm-tap);
  min-width: var(--dtm-tap);
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--dtm-radius);
  background: #e5e7eb;
  color: var(--dtm-text);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background .15s, color .15s, opacity .15s, box-shadow .15s;
}
.dtm-btn:active { transform: translateY(1px); }
.dtm-btn:disabled { opacity: .4; cursor: not-allowed; }
.dtm-btn--primary { background: var(--dtm-primary); color: var(--dtm-primary-fg); }
.dtm-btn--success { background: var(--dtm-success); color: #fff; }
.dtm-btn--danger { background: var(--dtm-danger); color: #fff; }
.dtm-btn--accent { background: var(--dtm-accent); color: #fff; }
.dtm-btn--ghost { background: var(--dtm-surface); border-color: var(--dtm-border); }
.dtm-btn--icon { padding: 0; }

/* --- アイコンボタン --- */
.dtm-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  flex: 0 0 auto;
  border: 1px solid var(--dtm-border);
  border-radius: 10px;
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background .15s, color .15s, opacity .15s;
}
.dtm-iconbtn:active { transform: translateY(1px); }
.dtm-iconbtn:disabled { opacity: .35; cursor: not-allowed; }

/* --- トランスポートバー（常時表示・上部固定） --- */
.dtm-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  box-shadow: var(--dtm-shadow);
}
.dtm-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: var(--dtm-tap);
  padding: 0 22px;
  border: none;
  border-radius: 999px;
  background: var(--dtm-success);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(16,185,129,.35);
  transition: background .15s, box-shadow .15s, transform .1s;
}
.dtm-play:active { transform: translateY(1px); }
.dtm-play:disabled { opacity: .5; cursor: not-allowed; }
.dtm-play--stop { background: var(--dtm-danger); box-shadow: 0 2px 6px rgba(239,68,68,.35); }
.dtm-rec { color: var(--dtm-danger); }
.dtm-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dtm-muted);
  cursor: pointer;
}
.dtm-toggle input { width: 18px; height: 18px; accent-color: var(--dtm-accent); }

/* --- ツールドック（折返し・横スクロールなし） --- */
.dtm-tooldock {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  box-shadow: var(--dtm-shadow);
}
.dtm-sep { width: 1px; align-self: stretch; background: var(--dtm-border); margin: 2px; }
.dtm-label { font-size: 13px; color: var(--dtm-muted); font-weight: 600; white-space: nowrap; }
.dtm-row .dtm-label[data-dtm] { min-width: 44px; text-align: center; }

/* --- セグメント型ツール選択 --- */
.dtm-seg {
  display: inline-flex;
  border: 1px solid var(--dtm-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--dtm-surface);
}
.dtm-segbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--dtm-tap);
  height: var(--dtm-tap);
  border: none;
  border-right: 1px solid var(--dtm-border);
  background: transparent;
  color: var(--dtm-muted);
  cursor: pointer;
  transition: background .15s, color .15s;
}
.dtm-segbtn:last-child { border-right: none; }
.dtm-segbtn--active { background: var(--dtm-primary); color: #fff; }

/* --- フォーム要素 --- */
.dtm-select, .dtm-input, .dtm-textarea {
  min-height: var(--dtm-tap);
  padding: 6px 10px;
  border: 1px solid var(--dtm-border);
  border-radius: 10px;
  background: var(--dtm-surface);
  color: var(--dtm-text);
  font-size: 14px;
}
.dtm-input--num { width: 70px; text-align: center; }
.dtm-textarea { width: 100%; min-height: 56px; resize: vertical; font-family: ui-monospace, monospace; }
.dtm-range { height: var(--dtm-tap); accent-color: var(--dtm-primary); }

/* --- トラックピル（色分け・常時表示・折返し） --- */
.dtm-tracks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px;
}
.dtm-pill {
  --dtm-pill-color: var(--dtm-primary);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border: 1.5px solid var(--dtm-border);
  border-radius: 999px;
  background: var(--dtm-surface);
  color: var(--dtm-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .15s, color .15s, box-shadow .15s;
}
.dtm-pill .dtm-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--dtm-pill-color);
  flex: 0 0 auto;
}
.dtm-pill--active {
  border-color: var(--dtm-pill-color);
  color: var(--dtm-text);
  font-weight: 800;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dtm-pill-color) 18%, transparent);
}

/* --- ピアノロール --- */
.dtm-roll-wrap { display: flex; gap: 6px; }
.dtm-roll {
  position: relative;
  flex: 1 1 auto;
  height: 60vh;
  min-height: 300px;
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  box-shadow: var(--dtm-shadow);
  overflow: hidden;
}
.dtm-vscroll {
  position: relative;
  width: 16px;
  border-radius: 8px;
  background: #e2e8f0;
  cursor: pointer;
  flex: 0 0 auto;
}
.dtm-vscroll-thumb, .dtm-hscroll-thumb {
  position: absolute;
  background: var(--dtm-primary);
  border-radius: 8px;
  opacity: .65;
}
.dtm-vscroll-thumb { left: 0; width: 100%; }
.dtm-hscroll {
  position: relative;
  width: 100%;
  height: 16px;
  border-radius: 8px;
  background: #e2e8f0;
  cursor: pointer;
}
.dtm-hscroll-thumb { top: 0; height: 100%; }

/* --- パネル（折りたたみ） --- */
.dtm-panel {
  background: var(--dtm-surface);
  border: 1px solid var(--dtm-border);
  border-radius: var(--dtm-radius);
  box-shadow: var(--dtm-shadow);
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

/* --- アクティブトラックのボディ --- */
.dtm-track-body { display: flex; flex-direction: column; gap: 10px; }

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

/* --- 広幅（タブレット/PC）拡張 --- */
@media (min-width: 768px) {
  .dtm-daw { --dtm-tap: 40px; gap: 12px; padding: 12px; }
  .dtm-roll { height: 460px; }
  .dtm-iconbtn { font-size: 18px; }
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
