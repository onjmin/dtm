/**
 * Sinsy（pysinsy）で歌わせる（試作）。
 *
 * 手元の中継サーバー（`scripts/misc/sinsy-server.ts`、既定 `http://127.0.0.1:50024`）に
 * NEUTRINO と同じ MusicXML を送って WAV を受け取る。仕組みは NEUTRINO・OpenUtau と共通
 * （{@link file://./neutrino-sing.ts}）。dtm は Sinsy も声も同梱しない。
 */

/** 既定のサーバーURL。 */
export const SINSY_DEFAULT_URL = "http://127.0.0.1:50024";

/**
 * DAW の歌詞トラックで選べる Sinsy の声（モデル名 → 声）。モデル名は `ss_` で始める。
 * `terms` は声のライセンス（NIT SONG070 F001 は CC BY 3.0。出典の表示が要る）。
 */
export const SINSY_SINGERS: Record<
	string,
	{ dir: string; name: string; terms: string }
> = {
	ss_f001: {
		dir: "nitech_jp_song070_f001",
		name: "Sinsy:NIT SONG070 F001（名古屋工業大学）",
		terms: "https://creativecommons.org/licenses/by/3.0/deed.ja",
	},
};

/** Sinsy で歌うモデル名か。 */
export const isSinsyModel = (model: string): boolean =>
	Object.hasOwn(SINSY_SINGERS, model.toLowerCase());
