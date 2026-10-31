/**
 * OpenUtau（DiffSinger など）で歌わせる（試作）。
 *
 * 手元の中継サーバー（`scripts/misc/openutau-server.ts`、既定 `http://127.0.0.1:50023`）に
 * NEUTRINO と同じ MusicXML を送って WAV を受け取る。楽譜の組み立て・トラック全体を1回で
 * 合成して切って並べる仕組みは NEUTRINO と共通（{@link file://./neutrino-sing.ts}）。
 * dtm は OpenUtau も歌い手も同梱しない。
 */

/** 既定のサーバーURL（NEUTRINO の 50022 の隣）。 */
export const OPENUTAU_DEFAULT_URL = "http://127.0.0.1:50023";

/**
 * DAW の歌詞トラックで選べる OpenUtau の歌い手（モデル名 → 歌い手）。
 * モデル名は `ou_` で始める。`dir` は OpenUtau の `Singers/` 以下のフォルダ名で、
 * 利用者がその歌い手を入れていなければ鳴らない。`terms` は歌い手の規約（歌い手を選んだときに出す）。
 */
export const OPENUTAU_SINGERS: Record<
	string,
	{ dir: string; name: string; terms: string }
> = {
	ou_ritsu_ds: {
		dir: "NamineRitsu_DiffSinger",
		name: "DiffSinger:波音リツ",
		terms: "https://www.canon-voice.com/kiyaku.html",
	},
};

/** OpenUtau で歌うモデル名か。 */
export const isOpenUtauModel = (model: string): boolean =>
	Object.hasOwn(OPENUTAU_SINGERS, model.toLowerCase());
