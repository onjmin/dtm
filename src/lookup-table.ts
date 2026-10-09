/**
 * 曲データ・モデル名など外から来るキーで引く辞書を、プロトタイプなしで作る。
 * `{}` のままだと `#inst=constructor` などが Object.prototype のプロパティに当たる。
 */
export const lookupTable = <T>(entries: Record<string, T>): Record<string, T> =>
	Object.assign(Object.create(null), entries);
