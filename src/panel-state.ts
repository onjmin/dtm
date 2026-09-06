/**
 * アコーディオン（<details>）の開閉状態を localStorage に永続化する。
 *
 * パネルごとに固定キー（`data-dtm-acc` 属性の値）を持たせ、キー単位で覚える。
 * ページを閉じて後日開き直しても、最後に閉じた／開いた状態から始められる。
 * 同一ページに複数のエディタが載っていても、キーが同じパネルは同じ状態を共有する
 * （どちらで畳んでも次回はどちらも畳まれた状態で開く）。
 */

const STORAGE_PREFIX = "dtm-panel-open:";

/**
 * 保存済みの開閉状態を返す。未保存・localStorage が使えない（プライベートモード等）
 * 場合は null を返し、呼び出し側のマークアップ既定値に従わせる。
 */
export const readPanelOpen = (key: string): boolean | null => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return null;
		const raw = localStorage.getItem(STORAGE_PREFIX + key);
		if (raw === "1") return true;
		if (raw === "0") return false;
	} catch (_) {}
	return null;
};

/** 開閉状態を保存する。失敗（容量超過・アクセス拒否）は無視する。 */
export const writePanelOpen = (key: string, open: boolean): void => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return;
		localStorage.setItem(STORAGE_PREFIX + key, open ? "1" : "0");
	} catch (_) {}
};

/**
 * `root` 配下の `<details data-dtm-acc="...">` すべてについて、
 * 保存済みの開閉状態を復元し、以後の開閉を保存するようにする。
 * 動的に作り直される <details> は対象外なので、
 * そちらは readPanelOpen / writePanelOpen を直接使うこと。
 */
export const persistPanels = (root: HTMLElement): void => {
	const panels = root.querySelectorAll<HTMLDetailsElement>(
		"details[data-dtm-acc]",
	);
	for (const panel of panels) {
		const key = panel.dataset.dtmAcc;
		if (!key) continue;
		const stored = readPanelOpen(key);
		if (stored !== null) panel.open = stored;
		panel.addEventListener("toggle", () => {
			writePanelOpen(key, panel.open);
		});
	}
};
