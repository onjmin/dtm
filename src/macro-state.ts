/**
 * マクロアコーディオン内で選択された設定値の localStorage 永続化
 *
 * 構成プリセット、作る部分（セクション）、ベース調、音階、全体シフト、移調の
 * 選択状態を保持し、次回ロード時に復元できるようにする。
 */

export const MACRO_STORAGE_KEYS = {
	template: "dtm-macro:template",
	sections: "dtm-macro:sections",
	key: "dtm-macro:key",
	scale: "dtm-macro:scale",
	shift: "dtm-macro:shift",
	transpose: "dtm-macro:transpose",
} as const;

export type MacroStorageKey = keyof typeof MACRO_STORAGE_KEYS;

/**
 * マクロアコーディオンの単一項目を localStorage から取得する。
 * 未設定または localStorage にアクセスできない場合は null を返す。
 */
export const readMacroSetting = (key: MacroStorageKey): string | null => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return null;
		return localStorage.getItem(MACRO_STORAGE_KEYS[key]);
	} catch (_) {
		return null;
	}
};

/**
 * マクロアコーディオンの単一項目を localStorage に保存する。
 * localStorage にアクセスできない環境や容量制限等は無視する。
 */
export const writeMacroSetting = (
	key: MacroStorageKey,
	value: string,
): void => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return;
		localStorage.setItem(MACRO_STORAGE_KEYS[key], value);
	} catch (_) {}
};

/**
 * 作る部分（セクション選択）の配列を localStorage から取得・検証して返す。
 * 未設定・パース失敗・配列でない場合は null を返す。
 */
export const readMacroSections = (): string[] | null => {
	const raw = readMacroSetting("sections");
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
			return parsed;
		}
	} catch (_) {}
	return null;
};

/**
 * 作る部分（セクション選択）の配列を JSON 文字列として localStorage に保存する。
 */
export const writeMacroSections = (sections: string[]): void => {
	writeMacroSetting("sections", JSON.stringify(sections));
};
