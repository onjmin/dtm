/**
 * 自動作曲・一括編集アコーディオン内で選択された設定値の localStorage 永続化
 *
 * ジャンル、ベース調、音階（自動作曲パネル）と、
 * 全体シフト、移調（一括編集パネル）の選択状態を保持し、次回ロード時に復元できる
 * ようにする。キーの `dtm-macro:` 接頭辞は、両パネルが1枚だった頃の名残。
 */

export const MACRO_STORAGE_KEYS = {
	/** 旧 UI の「構成」。ジャンルのカードへ移す（genreFromTemplate）ためだけに読む。 */
	template: "dtm-macro:template",
	key: "dtm-macro:key",
	scale: "dtm-macro:scale",
	shift: "dtm-macro:shift",
	shiftActiveOnly: "dtm-macro:shift-active-only",
	transpose: "dtm-macro:transpose",
	genre: "dtm-macro:genre",
	vocal: "dtm-macro:vocal",
	voice: "dtm-macro:voice",
	tempo: "dtm-macro:tempo",
	/** 利用者が楽器プリセットを自分で選んだときの値。自動作曲はこれを優先する。 */
	userInstrument: "dtm-macro:user-instrument",
	/** 歌入り作曲が自動で当てた声。声はトラック設定に残るので、読み込み直しても自分で選んだ声と区別する。 */
	autoVoice: "dtm-macro:auto-voice",
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
	/** 一覧の識別子（「残した曲」一覧のみ）。 */
	id?: string;
	/** 一覧の見出し（例「界隈曲・歌あり」）。 */
	title?: string;
	/** 一覧の補足（テンポ・調・小節数・楽器）。 */
	info?: string;
	/** 残した時刻（ms）。 */
	savedAt?: number;
};

/** 「残した曲」一覧の上限。1曲あたり数十KBの MML なので localStorage に収まる数にする。 */
export const KEPT_SONGS_LIMIT = 10;

const KEPT_STORAGE_KEY = "dtm-macro:kept";
const KEPT_LIST_STORAGE_KEY = "dtm-macro:kept-list";

/**
 * 旧キープ枠（1曲）を localStorage から読む。無い・壊れている・読めない場合は null。
 * 今の UI は {@link readKeptSongs}（一覧）を使い、初回にこの枠を一覧へ移す。
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

const parseKept = (parsed: unknown): KeptSong | null => {
	if (!parsed || typeof parsed !== "object") return null;
	const o = parsed as Record<string, unknown>;
	if (typeof o.mml !== "string" || o.mml.length === 0) return null;
	const startStep =
		typeof o.startStep === "number" &&
		Number.isFinite(o.startStep) &&
		o.startStep >= 0
			? Math.floor(o.startStep)
			: 0;
	const song: KeptSong = { mml: o.mml, startStep };
	if (typeof o.id === "string") song.id = o.id;
	if (typeof o.title === "string") song.title = o.title;
	if (typeof o.info === "string") song.info = o.info;
	if (typeof o.savedAt === "number" && Number.isFinite(o.savedAt))
		song.savedAt = o.savedAt;
	return song;
};

let keptIdSeq = 0;
/** 一覧の識別子を振る。 */
export const newKeptId = (): string =>
	`k${Date.now().toString(36)}${(keptIdSeq++).toString(36)}`;

/**
 * 「残した曲」一覧を読む（新しい順）。旧キープ枠（1曲）しか無ければ、それを一覧へ移して旧枠を消す。
 */
export const readKeptSongs = (): KeptSong[] => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return [];
		const raw = localStorage.getItem(KEPT_LIST_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map(parseKept)
				.filter((s): s is KeptSong => s !== null)
				.map((s) => (s.id ? s : { ...s, id: newKeptId() }))
				.slice(0, KEPT_SONGS_LIMIT);
		}
		const old = readKeptSong();
		if (!old) return [];
		const migrated: KeptSong[] = [
			{ ...old, id: newKeptId(), title: "キープしていた曲" },
		];
		if (writeKeptSongs(migrated)) localStorage.removeItem(KEPT_STORAGE_KEY);
		return migrated;
	} catch (_) {}
	return [];
};

/**
 * 「残した曲」一覧を書く。書けたら true（容量超過などで書けなければ false。メモリ上の一覧は生きている）。
 */
export const writeKeptSongs = (songs: KeptSong[]): boolean => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return false;
		localStorage.setItem(
			KEPT_LIST_STORAGE_KEY,
			JSON.stringify(songs.slice(0, KEPT_SONGS_LIMIT)),
		);
		return true;
	} catch (_) {}
	return false;
};
