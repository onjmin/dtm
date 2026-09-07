/**
 * 全体トラック設定アコーディオン内で選択された設定値の localStorage 永続化
 *
 * 音律、ループ再生、全体音量、グルーコンプ、マスタリバーブ（量・Decay・PreDelay）、
 * マスタディレイ（量・音価）、フェードイン、フェードアウトの各設定を保持し、
 * 次回ロード時に復元できるようにする。
 */

export const GLOBAL_STORAGE_KEYS = {
	edo: "dtm-global:edo",
	loop: "dtm-global:loop",
	masterVolume: "dtm-global:master-volume",
	masterComp: "dtm-global:master-comp",
	reverbAmount: "dtm-global:reverb-amount",
	reverbDecay: "dtm-global:reverb-decay",
	reverbPreDelay: "dtm-global:reverb-predelay",
	delayAmount: "dtm-global:delay-amount",
	delayDivision: "dtm-global:delay-division",
	fadeIn: "dtm-global:fade-in",
	fadeOut: "dtm-global:fade-out",
} as const;

export type GlobalStorageKey = keyof typeof GLOBAL_STORAGE_KEYS;

/**
 * 全体トラック設定の単一項目を localStorage から取得する。
 * 未設定または localStorage にアクセスできない場合は null を返す。
 */
export const readGlobalSetting = (key: GlobalStorageKey): string | null => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return null;
		return localStorage.getItem(GLOBAL_STORAGE_KEYS[key]);
	} catch (_) {
		return null;
	}
};

/**
 * 全体トラック設定の単一項目を localStorage に保存する。
 * localStorage にアクセスできない環境や容量制限等は無視する。
 */
export const writeGlobalSetting = (
	key: GlobalStorageKey,
	value: string,
): void => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return;
		localStorage.setItem(GLOBAL_STORAGE_KEYS[key], value);
	} catch (_) {}
};

/**
 * 全体トラック設定の数値項目を localStorage から取得し、クランプして返す。
 * 未設定・パース失敗の場合は null を返す。
 */
export const readGlobalNumber = (
	key: GlobalStorageKey,
	min: number,
	max: number,
): number | null => {
	const raw = readGlobalSetting(key);
	if (raw === null) return null;
	const n = Number.parseFloat(raw);
	if (Number.isNaN(n)) return null;
	return Math.max(min, Math.min(max, n));
};

/**
 * 全体トラック設定の真偽値項目を localStorage から取得して返す。
 * 未設定・不正値の場合は null を返す。
 */
export const readGlobalBool = (key: GlobalStorageKey): boolean | null => {
	const raw = readGlobalSetting(key);
	if (raw === "1" || raw === "true") return true;
	if (raw === "0" || raw === "false") return false;
	return null;
};
