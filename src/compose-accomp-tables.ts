/**
 * 伴奏主体モード（`composeAccomp`）の表の、**互換の口**（段階 S1。`docs/accomp-style-engine.md` §8）。
 *
 * 表は `src/accomp-styles/fb.ts`（スタイル `fb`、型は `src/accomp-styles/schema.ts`）へ移した。ここは、
 * いままでの名前と形（`ARP_CELLS`・`ROLE_TEXTURE`・`ACCOMP_MIX` など）で既定のスタイル fb を読み直す
 * だけで、値を持たない。**エンジン（`compose-accomp*.ts`）はここを読まない**（スタイルを
 * `compose-accomp-style.ts` の `accompStyleView` で引く）。読むのは検査・試聴・監査の scripts と、
 * 手元の作業用スクリプト（`scratch/`・`tmp/`）。新しく書くコードは `accompStyleView()` を使うこと。
 *
 * エンジンの定数（引き直しの上限・候補の上限・使う音価・ぶつかりの上限）は、それを使うエンジンの
 * ファイルへ移し、ここからも同じ名前で出す。
 *
 * S3 で `src/accomp/` へ引っ越すときに、このファイルを消すかどうか決める。
 */

import type { AccompRole } from "./compose-accomp";
import { accompStyleView, planMix } from "./compose-accomp-style";

export type {
	ArpStep,
	BassRule,
	BassStep,
	BassTone,
	CellRule,
	CompHit,
	LevelSpec,
	RoleTexture,
	Weighted,
} from "./accomp-styles/schema";
export { CANDIDATE_LIMIT } from "./compose-accomp";
export { CLASH_PER_BAR_MAX } from "./compose-accomp-check";
export {
	LENGTH_TRIES,
	OFFSET_TRIES,
	TEXTURE_TRIES,
} from "./compose-accomp-plan";
export { NOTE_LENGTHS_16 } from "./compose-accomp-realize";
export type {
	AccompArpCell,
	BassPattern,
	BorrowPair,
	CompHitPattern,
	PhraseRow,
} from "./compose-accomp-style";

const v = accompStyleView();

/** 役割の並び（型 fb の並び。S5 まで固定）。 */
export const ACCOMP_ITINERARY: readonly AccompRole[] = v.itinerary;
/** 区間の表示名。借用区間には組の和音名を後ろに足す（`BorrowPair.labelA` / `labelB`）。 */
export const ROLE_LABELS = v.roleLabels;
/** テンポの候補（BPM）。fb は 112。 */
export const BPM_TABLE = v.tempo;
/** 区間長の候補（小節、すべて4の倍数）。 */
export const REGION_LENGTHS = v.regionLengths;
/** 和声の表で組み立てられる区間長（`overrides.lengths` の検算に使う）。 */
export const SUPPORTED_LENGTHS = v.supportedLengths;
/** fb の区間長（型 fb の参照計画の区間長）。引き直しが続いたときの戻り先（112BPM で 163 秒）。 */
export const FB_LENGTHS = v.referenceLengths;
/** 曲の長さの範囲（秒）。関門「長さ」。 */
export const SECONDS_RANGE = v.seconds;
/** 区間ごとの強弱のずれの幅（±）。 */
export const LEVEL_OFFSET_MAX = v.offsetMax;

/** home の1〜4小節。主和音で始まる句。 */
export const HOME_OPEN = v.pools.homeOpen;
/** home の5〜12小節。重複なしで2つ並べる。 */
export const HOME_MID = v.pools.homeMid;
/** minorDwell の最初。vi から、2小節1和音で始まる。 */
export const MINOR_OPEN = v.pools.minorOpen;
/** minorDwell の途中。(L−8)/4 個を、同じ句を続けずに並べる。 */
export const MINOR_MID = v.pools.minorMid;
/** minorDwell の最後。ii→iii→IV→Vsus4 V と上がって半終止で終える。 */
export const MINOR_CLIMB = v.pools.minorClimb;
/** lift。区間の長さぶん並べ、最後の句は V 系の和音で終わる。 */
export const LIFT = v.pools.lift;
/** return の最後の4小節。借用和音の予告は入れない（規則⑤）。 */
export const RETURN_END = v.pools.returnEnd;
/** 借用和音の組。 */
export const BORROW_PAIRS = v.borrowPairs;

/** 分散のセル（id → セル）。 */
export const ARP_CELLS = v.arpCells;
/** 規則①: セルの1小節の音数の範囲。 */
export const CELL_NOTES = v.cellNotes;
/** 規則①: 区間ごとの分散の毎秒音数の範囲（lift だけ下限が低い）。 */
export const ARP_RATE = { normal: v.arpRate.home, lift: v.arpRate.lift };
/** 分散の音の組の選び方。 */
export const ARP_SET = v.arpSet;
/** home・glimpse・return の分散の窓（fb の実測、絶対 MIDI）。 */
export const HOME_WINDOW = v.roleTexture.home.window;
/** 役割ごとの候補表。 */
export const ROLE_TEXTURE = v.roleTexture;

/** 低音型（id → 型）。 */
export const BASS_PATTERNS = v.bassPatterns;
/** 低音の音域（絶対 MIDI）。根音は `rootLow`〜`rootHigh`、上の音は `high` まで。 */
export const BASS_RANGE = v.bassRange;

/** 和音の打ち方（id → 打ち方）。 */
export const COMP_HITS = v.compHits;
/** 和音の置き方で使う度数（3声の密集配置、根音は低音に任せる）。 */
export const COMP_TONES = v.compTones;
/** 和音の窓（絶対 MIDI）と置き方の費用。 */
export const COMP_VOICING = v.compVoicing;

/** 色の線。 */
export const COLOR_LINE = v.colorLine;

/** 役割ごとの強弱。 */
export const LEVELS = v.levels;
/** 拍位置の加減。 */
export const ACCENTS = v.accents;
/** 規則④: 山（borrowB）と2番手の差の下限。 */
export const PEAK_MARGIN = v.peakMargin;
/** 規則②: return と home の「強弱」の軸が違うとみなす、基準 v の平均の差の下限。 */
export const ECHO_LEVEL_MARGIN = v.echoLevelMargin;

/** fb.space.mml の宣言そのまま（型 fb のミックスを、曲が持つ形にしたもの）。 */
export const ACCOMP_MIX = planMix(v, undefined);
