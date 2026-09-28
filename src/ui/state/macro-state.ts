/**
 * 自動作曲・一括編集アコーディオン内で選択された設定値の localStorage 永続化
 *
 * 構成プリセット、作る部分（セクション）、ベース調、音階（自動作曲パネル）と、
 * 全体シフト、移調（一括編集パネル）の選択状態を保持し、次回ロード時に復元できる
 * ようにする。キーの `dtm-macro:` 接頭辞は、両パネルが1枚だった頃の名残。
 */

export const MACRO_STORAGE_KEYS = {
	template: "dtm-macro:template",
	sections: "dtm-macro:sections",
	key: "dtm-macro:key",
	scale: "dtm-macro:scale",
	shift: "dtm-macro:shift",
	shiftActiveOnly: "dtm-macro:shift-active-only",
	transpose: "dtm-macro:transpose",
} as const;

export type MacroStorageKey = keyof typeof MACRO_STORAGE_KEYS;

/**
 * 単一項目を localStorage から取得する。
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
 * 単一項目を localStorage に保存する。
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

// ============================================================
// キープ枠
// ============================================================

/**
 * 自動作曲の「キープ」に取っておいた曲。
 *
 * 中身は `generateMML` が出す MML そのもの（トラック・楽器・ドラム・テンポ・歌詞・
 * エフェクトまで全部入り）と、キープした時点の再生開始位置。再生位置も一緒に
 * 持つのは、キープした曲を呼び出したときに**同じ場所（サビの頭）から**聴き比べたい
 * ため——MML には曲の設計図（どこがサビか）が残らないので、位置だけ別に控える。
 */
export type KeptSong = {
	mml: string;
	/** キープした時点の再生開始位置（ステップ）。 */
	startStep: number;
};

const KEPT_STORAGE_KEY = "dtm-macro:kept";

/**
 * キープ枠を localStorage から読む。無い・壊れている・読めない場合は null。
 *
 * **リロードをまたいで残す**のは、スマホでは「別アプリを見て戻ったらタブが
 * 再読み込みされていた」が日常的に起きるため。メモリだけに持つと、取っておいた
 * つもりの曲がそこで消える。
 */
export const readKeptSong = (): KeptSong | null => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return null;
		const raw = localStorage.getItem(KEPT_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			typeof parsed.mml === "string" &&
			parsed.mml.length > 0
		) {
			const startStep =
				typeof parsed.startStep === "number" &&
				Number.isFinite(parsed.startStep) &&
				parsed.startStep >= 0
					? Math.floor(parsed.startStep)
					: 0;
			return { mml: parsed.mml, startStep };
		}
	} catch (_) {}
	return null;
};

/**
 * キープ枠を localStorage へ書く。null で枠を空にする。
 * 容量超過や private モードなど、書けない環境では黙って諦める
 * （その場合もメモリ上の枠は生きているので、リロードまでは使える）。
 */
export const writeKeptSong = (kept: KeptSong | null): void => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return;
		if (kept === null) {
			localStorage.removeItem(KEPT_STORAGE_KEY);
			return;
		}
		localStorage.setItem(KEPT_STORAGE_KEY, JSON.stringify(kept));
	} catch (_) {}
};
