/**
 * 伴奏主体モードの曲を MML にする（`docs/accomp-compose.md` §4.1・§5 `accompToMml`）。
 *
 * **mml-parser を読むので koe まで引く。** `compose-accomp.ts` からは import しないこと（生成器は
 * Node から koe 無しで検算するため、§4.2）。scripts（試聴・再現・往復の検算）と外部利用のための口。
 *
 * 書き方は DAW の full 書き出し（`daw.ts` の `getMML`）と同じ。
 * - 先頭に宣言（`formatMmlMeta`。`accompMeta` ＋ `#ver` ＋ `#seed`）
 * - トラックは `@<n> <MMLCore.getMMLFromNotes(notes, bpm, volume)>`。音符ごとの v は、トラック音量と
 *   相対 velocity から実効値として書かれる（段階0の修正）
 * - `;\n` で区切り、最後に `#end;`
 *
 * **DAW と違う点が1つ。** `#loop=on` を先頭の**単独の行**に書く。再生専用プレイヤー
 * （`mml-player.ts` の `parseLoopMeta`、unj-reze の投稿の埋め込みが通る）は、行の頭から行末までが
 * `#loop=on` の行しかループの指定と読まない。DAW の書き出しのように宣言の行の途中へ置くと、
 * DAW の読み込み（`parseMmlMeta`）はループとして読むが、埋め込みではループしない。
 */

import { MMLCore } from "../mml/mml-core";
import { formatMmlMeta } from "../mml/mml-parser";
import { MML_END_MARKER, type Note, type RenderConfig } from "../types";
import { DTM_VERSION } from "../version";
import { type AccompSong, accompMeta } from "./compose-accomp";

export type AccompMmlProvenance = {
	/** アプリの種（`#seed=`。`composeAccomp` に `seededRandom(seed)` を渡したときの値）。 */
	seed?: number;
	/** 既定は `DTM_VERSION`。 */
	version?: string;
	/** DAW の minify 書き出しと同じ形（トラックの空白を詰め、`;` で区切る）。既定 false。 */
	minified?: boolean;
};

/**
 * 曲を MML 文字列にする。`parseMML` で読み戻すと、音符（開始・長さ・音高）と絶対値の v まで
 * `s.tracks` と一致する（`scripts/test/check-compose-accomp.ts` が検算する）。
 */
export const accompToMml = (
	s: AccompSong,
	prov: AccompMmlProvenance = {},
): string => {
	const minified = prov.minified ?? false;
	const config: RenderConfig = {
		stepsPerBar: s.stepsPerBar,
		keyCount: 88,
		pitchRangeStart: 0,
		unitsPerRow: s.edo === 31 ? 12 : 31,
		keyHeight: 12,
		stepWidth: 2,
		edo: s.edo,
	};
	const core = new MMLCore(
		{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
		100,
		() => config,
	);
	const metaLine = formatMmlMeta(
		{
			...accompMeta(s),
			// 先頭の単独の行へ出す（上の説明）
			loop: undefined,
			version: prov.version ?? DTM_VERSION,
			seed: prov.seed,
		},
		minified ? "" : " ",
	);
	let id = 1;
	const lines = s.tracks.flatMap((t) => {
		if (t.notes.length === 0) return [];
		const notes: Note[] = t.notes.map((n) => ({
			id: id++,
			startStep: n.startStep,
			durationSteps: n.durationSteps,
			pitchUnits: n.pitchUnits,
			velocity: n.velocity,
		}));
		const mml = core.getMMLFromNotes(notes, s.bpm, t.volume).trim();
		return [
			minified ? `@${t.index}${mml.replace(/\s+/g, "")}` : `@${t.index} ${mml}`,
		];
	});
	const body = [metaLine, ...lines, MML_END_MARKER]
		.filter((x) => x.length > 0)
		.join(minified ? ";" : ";\n");
	return s.mix.loop ? `#loop=on\n${body}` : body;
};
