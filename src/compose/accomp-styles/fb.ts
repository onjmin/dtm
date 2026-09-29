/**
 * 伴奏主体モードの最初のスタイル `fb`（`docs/accomp-style-engine.md` §3.2）。
 *
 * 段階 S1 で、`compose-accomp-tables.ts` の表をここへ移した（値は1つも変えていない。黄金値と1バイトも
 * 違わないことを `scripts/check-accomp-golden.ts` で確かめる）。エンジン（`compose-accomp*.ts`）は
 * この表を `compose-accomp-style.ts` 経由で読む。`compose-accomp-tables.ts` は、いままでの名前と形で
 * ここを読み直すだけの互換の口になった。
 *
 * 初期値は所有者が評価した手書き編曲 fb（`references/fb/fb.mml`）、その出発点の backing
 * （`references/fb/backing.mml`）、選ばれなかった別版 fa（`references/fb/fa.mml`）から起こした。
 * 行ごとに `from`（出所の小節）と `note`（いままでの `source` の文字列）を書いてある。
 *
 * 聴いて直すときに触るのが**表の1行**で済むようにしてある。後処理の規則で色を足したりはしない。
 * 版を上げるのは、同じ `#compose` から同じ曲が出なくなる変更のとき（S2 で `fb.v2`、S4a で `fb.v3`、
 * S5 で `fb.v4` の予定。§8）。
 *
 * 和音はローマ数字で書く（ハ長調基準）。大文字は長、小文字は短、`b` はフラット、`/数字` は
 * 低音の**音階度数**（`IM7/3` はハ長調で CM7/E）。1小節は `|` で区切り、半小節2和音は空白で並べる。
 *
 * 参考曲名・作者名はここにも references にも書かない（§4.3・§9.1.1-10）。
 */

import { NO_DRUM_PATTERN } from "../../instruments/drum-config";
import type { AccompRole } from "../compose-accomp";
import {
	type ArpCellBody,
	type BassPatternBody,
	type BorrowSetBody,
	type CompHitsBody,
	derived,
	fromRef,
	type LevelSpec,
	type PhraseBody,
	type Provenance,
	parseArpSteps,
	parseBassSteps,
	parseCompHits,
	type RoleTexture,
	type Row,
	type StylePack,
} from "./schema";

// ============================================================
// 行を書く道具
// ============================================================

const phrase = (
	id: string,
	bars: string,
	weight: number,
	from: Provenance,
	note: string,
): Row<PhraseBody> => ({ id, body: { bars }, weight, from, note });

const cell = (
	id: string,
	family: string,
	dir: ArpCellBody["dir"],
	steps: string,
	from: Provenance,
	note: string,
	liftVariant?: string,
): Row<ArpCellBody> => {
	const parsed = parseArpSteps(id, steps);
	return {
		id,
		body: {
			family,
			dir,
			steps: parsed,
			notes: parsed.length,
			...(liftVariant ? { liftVariant } : {}),
		},
		weight: 1,
		from,
		note,
	};
};

const bass = (
	id: string,
	bars: readonly string[],
	from: Provenance,
	note: string,
	extra: Pick<BassPatternBody, "alternate" | "split" | "last"> = {},
): Row<BassPatternBody> => ({
	id,
	body: { bars: bars.map((b) => parseBassSteps(id, b)), ...extra },
	weight: 1,
	from,
	note,
});

const hits = (
	id: string,
	one: readonly string[],
	two: readonly string[],
	from: Provenance,
	note: string,
	extra: {
		late?: readonly string[];
		alternate?: CompHitsBody["alternate"];
	} = {},
): Row<CompHitsBody> => ({
	id,
	body: {
		one: one.map((t) => parseCompHits(id, t)),
		two: two.map((t) => parseCompHits(id, t)),
		...(extra.late
			? { late: extra.late.map((t) => parseCompHits(id, t)) }
			: {}),
		...(extra.alternate ? { alternate: extra.alternate } : {}),
	},
	weight: 1,
	from,
	note,
});

// ============================================================
// 和声の句（§6 段2・付録 A）
// ============================================================

/** home の1〜4小節。主和音で始まる句。 */
const HOME_OPEN = [
	phrase(
		"ho_fb",
		"Iadd9|IVM7|iii7 vi7|ii7 V",
		2,
		fromRef("fb", 1, 4),
		"backing・fb A 1〜4",
	),
	phrase(
		"ho_fa",
		"Iadd9|IVM7|Iadd9|IVM7",
		1,
		fromRef("fa", 17, 20),
		"fa A' 17〜20",
	),
];

/** home の5〜12小節。重複なしで2つ並べる。 */
const HOME_MID = [
	phrase(
		"hm_fb1",
		"IM7|vi7|IVM7 iii7|ii7 Vsus4",
		2,
		fromRef("fb", 5, 8),
		"fb A 5〜8",
	),
	phrase(
		"hm_fb2",
		"vi7|iii7|IVM7 V|vi7",
		2,
		fromRef("fb", 9, 12),
		"fb A 9〜12",
	),
	phrase(
		"hm_fa1",
		"iii7|vi7|ii7|Vsus4 V",
		1,
		fromRef("fa", 21, 24),
		"fa A' 21〜24",
	),
	phrase(
		"hm_fa2",
		"IM7|IVM7|iii7|vi7",
		1,
		fromRef("fa", 25, 28),
		"fa A' 25〜28",
	),
];

/** minorDwell の最初。vi から、2小節1和音で始まる。 */
const MINOR_OPEN = [
	phrase("mo_fb", "vi7|vi7|iii7|iii7", 1, fromRef("fb", 17, 20), "fb B 17〜20"),
];

/**
 * minorDwell の途中。(L−8)/4 個を、同じ句を続けずに並べる。
 *
 * `mm_fa` は付録 A では `vi7|vi7/7|ii7/4|iii7` と書かれていたが、fa の実物は
 * `C#m7|C#m7/B|F#m7/A|G#m7`（ホ長調）で、B はホ長調の**5度**。`/数字` を音階度数と
 * 決めた（付録 A の冒頭）ので `vi7/5` と書く（`/7` のままだとハ長調で Am7/B になる）。
 */
const MINOR_MID = [
	phrase("mm_fb1", "ii7|ii7|vi7|vi7", 2, fromRef("fb", 21, 24), "fb B 21〜24"),
	phrase(
		"mm_fb2",
		"IVM7|iii7|ii7|iii7",
		2,
		fromRef("fb", 25, 28),
		"fb B 25〜28",
	),
	phrase(
		"mm_fb3",
		"vi7|vi(add9)|IVM7|IVM7(#11)",
		2,
		fromRef("fb", 29, 32),
		"fb B 29〜32",
	),
	phrase(
		"mm_fa",
		"vi7|vi7/5|ii7/4|iii7",
		1,
		fromRef("fa", 33, 36),
		"fa B 33〜36",
	),
];

/** minorDwell の最後。ii→iii→IV→Vsus4 V と上がって半終止で終える。 */
const MINOR_CLIMB = [
	phrase(
		"mc_fb",
		"ii7|iii7|IVM7|Vsus4 V",
		1,
		fromRef("fb", 33, 36),
		"fb B 33〜36",
	),
];

/** lift。区間の長さぶん並べ、最後の句は V 系の和音で終わる。 */
const LIFT = [
	phrase(
		"li_fb1",
		"IM7|IVM7|IM7/3|IVM7(9)",
		1,
		fromRef("fb", 57, 60),
		"fb L 57〜60",
	),
	phrase(
		"li_fb2",
		"vi7|IVM7|ii7|Vsus4",
		1,
		fromRef("fb", 61, 64),
		"fb L 61〜64",
	),
];

/** return の最後の4小節。借用和音の予告は入れない（規則⑤）。 */
const RETURN_END = [
	phrase(
		"re_fb",
		"vi7|iii7|IVM7|Vsus4 V",
		1,
		fromRef("fb", 73, 76),
		"fb A' 73〜76",
	),
];

/**
 * 借用和音の組。1つの組が、予告の句・borrowA と borrowB の和声（8小節版と12小節版）・
 * glimpse の終わりの和音をまとめて持つ（§6 段2-1）。
 *
 * - `glimpseEnd` は borrowB の頭の根音へ、低音が半音で上がれる和音。
 * - 12小節版は、8小節版の後ろに4小節を足した形（付録 A の末尾）。足した4小節は、8小節版の
 *   後半をそのまま繰り返さず1小節ずつ和音を動かし、最後の和音は8小節版と同じにした
 *   （次の区間への渡し方を変えないため）。
 * - 規則③（借用の長和音の直後に完全4度上の借用和音を置かない）は、borrowA・borrowB と区間の境で
 *   満たす。**P1 の予告の句には `bVIIadd9|bIIIM7`（fb の A14→15、ホ長調で Dadd9→GM7）があり、
 *   厳密には③に当たる。** fb がそのまま持っている箇所で、陽性対照（fb の計画）と保険の計画が
 *   関門を通ることが前提なので、③は home の中の組を数えない（`compose-accomp-plan.ts` の
 *   `rule3Violations`）。fa で指摘されたのは借用区間の中の D→G が到達点になったこと。
 */
const P1_A8 =
	"bVIM7|bVIM7(#11)|bVIIadd9|bVIIadd9|bVIM7|bVIM7(#11)|bVIIadd9|bVII";
const P1_A12 = `${P1_A8}|bVIM7|bVIIadd9|bVIM7(#11)|bVII`;
const P1_B8 = "bIIIM7|bIIIM7|iv7|iv7|bIIIM7|i7|iv7|iv6";
const P1_B12 = `${P1_B8}|bIIIM7|iv7|i7|iv6`;

const BORROW_SETS: readonly Row<BorrowSetBody>[] = [
	{
		id: "P1",
		body: {
			labelA: "♭VI・♭VII",
			labelB: "♭III・iv・i",
			fore: "bVIM7|bVIIadd9|bIIIM7 iv7|Vsus4 V",
			a8: P1_A8,
			a12: P1_A12,
			b8: P1_B8,
			b12: P1_B12,
			glimpseEnd: "ii7",
		},
		weight: 1,
		// 予告は A 13〜16、C1 37〜44・R 45〜48・C2 49〜56（まとめて 13〜56 の中）
		from: fromRef("fb", 13, 56),
		note: "fb A 13〜16・C1・C2・R",
	},
	{
		id: "P2",
		body: {
			labelA: "♭III・iv・i",
			labelB: "♭VI・♭VII",
			fore: "bIIIM7|iv7|bVIM7 bVIIadd9|Vsus4 V",
			a8: P1_B8,
			a12: P1_B12,
			b8: P1_A8,
			b12: P1_A12,
			glimpseEnd: "V",
		},
		weight: 1,
		// 2日目の試聴（生成曲）で聴いた組（references/fb/heard.json の pair:P2）。1・2日目は「だいたい良い」
		from: derived("swapAB", "P1", true),
		note: "新規（P1 の A と B を入れ替え）",
	},
];

// ============================================================
// 分散のセル（§6 段7・付録 A）
// ============================================================

/**
 * セルの表。リズムは付録 A のまま。音の番号は fb の実際の音を5音の組の添字に読み直して
 * 当てた初期値で、**陽性対照（fb の計画を realize して fb の実測に合うか）で詰める前提**
 * （§6 段7、§12.3）。
 *
 * fa（gen-kifuku.mjs）の型は、規則①（1小節8〜10音）を満たし、かつ役割の向きに合うものだけ採った。
 * `T_C1`（11音）と `T_C2`（向きが無い。借用区間は向きを持たせるのが fb の改善点 (e)）、
 * `T_A2a`/`T_A2b`（3音の組で書かれている）は採らない。
 *
 * `*_lift` のうち `ret_a_lift` だけは fb R 45〜48 の実物。残りは home のセルから上の音を1段上げて
 * 起こした行で、所有者はまだ聴いていない（heard.json に無い）ので `approved: false`。段階 S1 では
 * `approved` で引く行を絞らない（S2 の lint から）。
 */
const CELLS: readonly Row<ArpCellBody>[] = [
	// home（往復・跳躍系）と、その glimpse 用の変形
	cell(
		"ret_a",
		"往復",
		"wave",
		"0:2 2:1 1:1 2:2 1:2 | 0:2 4:1 2:1 4:2 2:2",
		fromRef("fb", 1, 4),
		"fb A 1〜4",
		"ret_a_lift",
	),
	cell(
		"ret_a_lift",
		"往復（上げ）",
		"wave",
		"0:2 2:1 1:1 4:2 2:2 | 0:2 3:1 2:1 4:2 2:2",
		fromRef("fb", 45, 48),
		"fb R 45〜48",
	),
	cell(
		"leap_a",
		"跳躍",
		"wave",
		"0:3 4:1 2:2 4:1 2:1 | 0:3 3:1 2:2 3:1 2:1",
		fromRef("fb", 5, 8),
		"fb A 5〜8",
		"leap_a_lift",
	),
	cell(
		"leap_a_lift",
		"跳躍（上げ）",
		"wave",
		"0:3 4:1 3:2 4:1 3:1 | 0:3 4:1 2:2 4:1 3:1",
		derived("liftVariant", "leap_a", false),
		"leap_a から起こした",
	),
	cell(
		"ret_b",
		"往復",
		"wave",
		"2:2 4:1 3:1 4:2 3:1 4:1 | 0:2 2:2 3:2 2:2",
		fromRef("fb", 9, 12),
		"fb A 9〜12",
		"ret_b_lift",
	),
	cell(
		"ret_b_lift",
		"往復（上げ）",
		"wave",
		"2:2 4:1 3:1 4:2 3:1 4:1 | 0:2 3:2 4:2 3:2",
		derived("liftVariant", "ret_b", false),
		"ret_b から起こした",
	),
	cell(
		"k_a1a",
		"波",
		"wave",
		"0:2 1:2 4:1 2:1 3:2 | 0:2 2:2 4:1 3:1 1:2",
		fromRef("fa", 17, 24),
		"fa T_A1a（A' 17〜24）",
		"k_a1a_lift",
	),
	cell(
		"k_a1a_lift",
		"波（上げ）",
		"wave",
		"0:2 2:2 4:1 3:1 4:2 | 0:2 3:2 4:1 2:1 3:2",
		derived("liftVariant", "k_a1a", false),
		"k_a1a から起こした",
	),
	cell(
		"k_a1b",
		"食い込み",
		"up",
		"0:3 2:3 4:2 | 1:2 3:1 4:1 2:2 3:1 4:1",
		fromRef("fa", 25, 32),
		"fa T_A1b（A' 25〜32）",
		"k_a1b_lift",
	),
	cell(
		"k_a1b_lift",
		"食い込み（上げ）",
		"up",
		"0:3 3:3 4:2 | 2:2 4:1 3:1 4:2 3:1 4:1",
		derived("liftVariant", "k_a1b", false),
		"k_a1b から起こした",
	),
	// home の予告の句（上がる型）
	cell(
		"fore_up",
		"上がる",
		"up",
		"0:2 1:2 3:2 1:1 3:1 | 0:2 2:2 4:2 2:1 4:1",
		fromRef("fb", 13, 16),
		"fb A 13〜16",
	),
	// minorDwell（転がる・まばら・上がる系、低い窓）
	cell(
		"dw_a",
		"低く揺れる",
		"wave",
		"0:2 2:2 4:1 3:1 2:2 | 1:2 2:2 4:1 3:1 2:2",
		fromRef("fb", 17, 20),
		"fb B 17〜20",
	),
	cell(
		"roll",
		"転がる",
		"wave",
		"0:3 1:1 2:1 4:1 2:2 | 0:3 1:1 2:1 3:1 2:2",
		fromRef("fb", 21, 24),
		"fb B 21〜24",
	),
	cell(
		"dw_walk",
		"歩く",
		"wave",
		"0:2 1:1 2:1 4:2 2:2 | 1:2 3:2 4:2 2:2",
		fromRef("fb", 25, 28),
		"fb B 25〜28",
	),
	cell(
		"sparse",
		"まばら",
		"wave",
		"1:3 3:1 2:2 4:2 | 0:3 2:1 1:2 3:2",
		fromRef("fb", 29, 32),
		"fb B 29〜32",
	),
	cell(
		"rising",
		"上がる",
		"up",
		"0:2 1:2 3:2 2:1 3:1 | 0:2 1:2 4:2 2:1 4:1",
		fromRef("fb", 33, 36),
		"fb B 33〜36",
	),
	cell(
		"k_b1",
		"揺れ",
		"wave",
		"0:2 2:1 1:1 3:2 2:2 | 0:2 2:1 1:1 4:2 2:2",
		fromRef("fa", 33, 38),
		"fa T_B1（B 33〜38）",
	),
	cell(
		"k_b2",
		"山なり",
		"wave",
		"0:2 2:2 4:2 3:1 2:1 | 1:2 3:2 2:2 1:1 2:1",
		fromRef("fa", 39, 44),
		"fa T_B2（B 39〜44）",
	),
	// borrowA（下る。G5/F#5 から）
	cell(
		"desc_a",
		"下る",
		"down",
		"4:2 3:2 2:2 1:2 | 3:2 2:1 1:1 0:2 2:2",
		fromRef("fb", 37, 40),
		"fb C1 37〜40",
	),
	cell(
		"desc_b",
		"下る",
		"down",
		"4:2 3:2 2:2 1:1 0:1 | 3:2 2:2 1:2 0:1 2:1",
		fromRef("fb", 41, 44),
		"fb C1 41〜44",
	),
	// borrowB（上る）
	cell(
		"flutter",
		"はためき",
		"up",
		"0:1 1:1 2:2 4:2 3:2 | 0:1 1:1 2:2 3:2 4:2",
		fromRef("fb", 49, 52),
		"fb C2 49〜52",
	),
	cell(
		"asc_walk",
		"上る",
		"up",
		"0:2 1:2 2:1 3:1 4:2 | 0:2 1:2 3:2 4:2",
		fromRef("fb", 53, 56),
		"fb C2 53〜56",
	),
	// lift（振り子・頭から降りる、高い窓）
	cell(
		"pendulum",
		"振り子",
		"wave",
		"2:2 0:2 4:2 0:2 | 1:2 0:2 4:2 0:2",
		fromRef("fb", 57, 60),
		"fb L 57〜60",
	),
	cell(
		"lift_desc",
		"頭から降りる",
		"down",
		"3:2 0:2 1:2 4:2 | 3:2 2:1 1:1 0:2 3:2",
		fromRef("fb", 61, 64),
		"fb L 61〜64",
	),
	cell(
		"k_d",
		"高く軽い",
		"wave",
		"1:2 3:2 4:1 3:1 2:2 | 1:2 3:2 4:2 2:2",
		fromRef("fa", 57, 64),
		"fa T_D（D 57〜64。s0 を使わない）",
	),
];

// ============================================================
// 低音型（§6 段6）
// ============================================================

const BASS: readonly Row<BassPatternBody>[] = [
	bass("walk", ["R:6 5:2 8:4 5:2 P:2"], fromRef("fb", 1, 16), "fb A", {
		split: "walk2",
	}),
	bass(
		"walk2",
		["R:4 5:2 8:2 R':4 5':2 P:2"],
		fromRef("fb", 3, 4),
		"fb A の3・4小節",
	),
	bass("walkLite", ["R:6 5:2 8:4 5:4"], fromRef("fb", 33, 36), "fb B 33〜36"),
	bass(
		"sparse",
		["R:12 5v:4", "R:6 5:2 R:8"],
		fromRef("fb", 17, 32),
		"fb B 17〜32",
		{ alternate: "sameChord" },
	),
	bass(
		"pedal",
		["R:16", "R:8 R:6 5v:2"],
		fromRef("fb", 37, 40),
		"fb C1 37〜40",
		{ alternate: "sameChord" },
	),
	bass("332", ["R:6 R:6 8:4"], fromRef("fb", 41, 44), "fb C1 41〜44"),
	bass(
		"pulse8",
		["R:2 R:2 R:2 8:4 R:2 5:4"],
		fromRef("fb", 49, 55),
		"fb C2 49〜55",
		{ last: "pulse8End" },
	),
	bass(
		"pulse8End",
		["R:8 N:8"],
		fromRef("fb", 56),
		"fb C2 56（2分に緩めて L へ）",
	),
	bass("dropout", ["R:12 r:4", "r:16"], fromRef("fb", 57, 64), "fb L", {
		alternate: "barParity",
		last: "dropoutEnd",
	}),
	bass("dropoutEnd", ["R:8 r:8"], fromRef("fb", 64), "fb L 64"),
	bass("thinned", ["R:6 5:2 8:8"], fromRef("fb", 65, 68), "fb R・A' 65〜68", {
		split: "thinned2",
	}),
	bass("thinned2", ["R:4 5:2 8:2 R':8"], fromRef("fb", 67), "fb R 47・A' 67"),
];

// ============================================================
// 和音（@3）の打ち方（§6 段5）
// ============================================================

const COMP: readonly Row<CompHitsBody>[] = [
	hits(
		"short2",
		["a:2 r:6 a:2 r:6"],
		["a:2 r:6 b:2 r:6"],
		fromRef("fb", 1, 12),
		"本調の和音の既定",
	),
	hits(
		"alt13",
		["a:2 r:14", "r:8 a:2 r:6"],
		["a:2 r:6 b:2 r:6"],
		fromRef("fb", 17, 36),
		"minorDwell の2小節1和音、lift",
		{ alternate: "sameChordElseParity" },
	),
	hits(
		"fore",
		["a:4 r:4 a:2 r:6"],
		["a:4 r:4 b:4 r:4"],
		fromRef("fb", 13, 15),
		"home の予告の小節（fb の A13〜15）",
	),
	hits(
		"long",
		["a:16", "a:8 r:8"],
		["a:8 b:8"],
		fromRef("fb", 37, 56),
		"借用和音だけ",
		{ late: ["a:12 r:4", "a:8 r:8"], alternate: "sameChord" },
	),
	hits(
		"final",
		["a:2 r:6 a:6 r:2"],
		["a:2 r:6 b:6 r:2"],
		fromRef("fb", 16),
		"最終小節（Vsus4 を8分、V を付点4分）",
	),
];

// ============================================================
// 役割ごとの質感（§6 段3）
// ============================================================

/** home・glimpse・return の分散の窓（fb の実測、絶対 MIDI）。 */
const HOME_WINDOW = { lowMin: 59, lowMax: 64, topMin: 76, topMax: 78 };

/**
 * 役割ごとの候補表（いままでの `ROLE_TEXTURE`）。分散の窓は fb の実測（絶対 MIDI、ホ長調で決めた値。
 * `relTo: "absolute"` は S5 まで）。minorDwell の和音の段 −1 は fa の B（1段下げた置き方 `VLOW`）から。
 */
const TEXTURE: Readonly<Record<AccompRole, RoleTexture>> = {
	home: {
		cells: {
			kind: "pool",
			pool: [
				["ret_a", 2],
				["leap_a", 2],
				["ret_b", 2],
				["k_a1a", 1],
				["k_a1b", 1],
			],
			last: "fore_up",
		},
		window: HOME_WINDOW,
		bass: { kind: "each", id: "walk" },
		comp: "short2",
		register: [[0, 1]],
		accent: "normal",
	},
	minorDwell: {
		cells: {
			kind: "pool",
			pool: [
				["dw_a", 2],
				["roll", 2],
				["dw_walk", 2],
				["sparse", 2],
				["k_b1", 1],
				["k_b2", 1],
			],
			last: "rising",
		},
		window: { lowMin: 54, lowMax: 57, topMin: 73, topMax: 76 },
		bass: { kind: "each", id: "sparse", last: "walkLite" },
		comp: "alt13",
		register: [
			[0, 3],
			[-1, 1],
		],
		accent: "normal",
	},
	borrowA: {
		cells: { kind: "alternate", cells: ["desc_a", "desc_b"], first: [2, 1] },
		window: { lowMin: 57, lowMax: 60, topMin: 78, topMax: 79 },
		bass: {
			kind: "split",
			first: "pedal",
			second: "332",
			middle: [
				["pedal", 1],
				["332", 1],
			],
		},
		comp: "long",
		register: [[0, 1]],
		accent: "normal",
	},
	glimpse: {
		cells: { kind: "homeLift" },
		window: HOME_WINDOW,
		bass: { kind: "each", id: "thinned" },
		comp: "short2",
		register: [[0, 1]],
		accent: "normal",
	},
	borrowB: {
		cells: {
			kind: "alternate",
			cells: ["flutter", "asc_walk"],
			first: [2, 1],
		},
		window: { lowMin: 55, lowMax: 64, topMin: 78, topMax: 79 },
		bass: { kind: "each", id: "pulse8" },
		comp: "long",
		register: [[1, 1]],
		accent: "normal",
	},
	lift: {
		cells: {
			kind: "pool",
			pool: [
				["pendulum", 2],
				["lift_desc", 2],
				["k_d", 1],
			],
		},
		window: { lowMin: 66, lowMax: 71, topMin: 80, topMax: 83 },
		bass: { kind: "each", id: "dropout" },
		comp: "alt13",
		register: [[0, 1]],
		accent: "gentle",
	},
	return: {
		cells: { kind: "homeEcho" },
		window: HOME_WINDOW,
		bass: { kind: "lead", first: "thinned", rest: "walk" },
		comp: "short2",
		register: [[0, 1]],
		accent: "normal",
	},
};

// ============================================================
// 強弱（§6 段9）
// ============================================================

/**
 * 役割ごとの強弱（いままでの `LEVELS`）。
 * - home は「58 から。ブロックごとに +4、ブロック内は [0,+2,+4,+2]。予告ブロックは
 *   [−2,+2,+6,−4]（第3ブロックと同じ基準 66 から）」を展開したもの
 * - borrowB は区間の 3/4 で頂点（**唯一の山**）、そこから引く
 * - lift は最弱、glimpse は凹ませる、return は home より静か（規則④）
 */
const LEVELS: Readonly<Record<AccompRole, LevelSpec>> = {
	home: {
		arp: [58, 60, 62, 60, 62, 64, 66, 64, 66, 68, 70, 68, 64, 68, 72, 62],
		bass: { offset: 26 },
		comp: { offset: -14 },
	},
	minorDwell: {
		arp: [
			50, 50, 52, 52, 52, 54, 52, 52, 54, 54, 56, 56, 54, 56, 56, 58, 56, 56,
			57, 58,
		],
		bass: { offset: 26 },
		comp: { offset: -14 },
	},
	borrowA: {
		arp: [60, 60, 62, 62, 62, 62, 64, 60],
		bass: { offset: 14 },
		comp: { offset: -14 },
	},
	glimpse: {
		arp: [52, 51, 51, 50],
		bass: { offset: 18 },
		comp: { offset: -15 },
	},
	borrowB: {
		arp: [64, 66, 68, 70, 74, 76, 70, 64],
		bass: { offset: 22, lastBar: 8 },
		comp: { offset: -14, to: -20 },
	},
	lift: {
		arp: [50, 50, 52, 52, 52, 50, 50, 48],
		bass: { fixed: 72 },
		comp: { fixed: 32 },
	},
	return: {
		arp: [52, 52, 54, 54, 54, 54, 56, 56, 56, 56, 58, 56],
		bass: { offset: 25 },
		comp: { offset: -16 },
	},
};

// ============================================================
// スタイル本体
// ============================================================

/** 規則①: 区間ごとの分散の毎秒音数の範囲（lift だけ下限が低い）。 */
const ARP_RATE_NORMAL = [4.0, 5.0] as const;
const ARP_RATE_LIFT = [3.6, 5.0] as const;

export const fb: StylePack<AccompRole> = {
	id: "fb",
	version: 1,
	label: "明るい分散と借用和音のループ",
	description:
		"旋律をほとんど置かず、分散和音・低音・和音で約2分半〜3分のループ曲。ドラムなし",
	provenance: [
		"references/fb/fb.mml",
		"references/fb/fa.mml",
		"references/fb/backing.mml",
	],
	key: { modes: [["major", 1]], minorPolicy: "parallelMajorHome" },
	meter: "4/4",
	layers: [
		{
			id: "color",
			generator: "colorLine",
			presetSlot: "submelody",
			// 置いてよい高さ（絶対 MIDI）。fb は E5〜F#5 の辺り
			window: { lo: 64, hi: 84, relTo: "absolute" },
			nonChordTones: [],
			params: {
				// 色の線は borrowB の中の小節（0 始まり）と最終小節だけに置く
				borrowBBars: [1, 2, 5, 6],
				// borrowBBars の組（1・2 と 5・6）の1つめは2拍目から2拍、2つめは1拍目から3拍
				// （fb の50小節 `r:4 f#5:2 r:4`・51小節 `e5:2. r:4`）。最終小節は sus4 の4度→3度を2拍ずつ
				placement: {
					first: { pos16: 4, len16: 8 },
					second: { pos16: 0, len16: 12 },
					final: { len16: 8 },
				},
				// 借用区間の音は max、借用区間の最後の音と最終小節は min（fb の 36 / 34）
				velocity: { min: 34, max: 36 },
				belowTop: 2,
				// 分散との半音で切った結果がこれより短くなる高さには置かない（§6 段8 の「長さは2〜3拍」）
				minLen16: 8,
				// C5→B4（ハ長調の座標の MIDI）
				finalFourth: 72,
				// 最終小節の4度→3度はループの閉じ方⑤なので必ず置く。窓に無いときだけ広げる
				finalWiden: 12,
				tones: {
					bIII: ["7"],
					i: ["7"],
					iv: ["3", "5"],
					bVI: ["7"],
				},
				// borrowB の {1,2,5,6} のうち色の音を持つ小節（P1 は4つ、P2 は ♭VI の2つ）＋最終小節の2音
				notesPerSong: { min: 4, max: 6 },
			},
		},
		{
			id: "arp",
			generator: "arpCells",
			presetSlot: "melody",
			// 役割ごとの窓（型の texture）を包む範囲。段階 S1 のエンジンは読まない
			window: { lo: 54, hi: 83, relTo: "absolute" },
			nonChordTones: [],
			params: {
				stepMin: 3,
				stepMax: 9,
				tensionStepMin: 2,
				widenMax: 6,
				cost: {
					interval: 0.2,
					idealInterval: 4,
					second: 3,
					top: 0.3,
					bottom: 0.2,
					clash: 10,
					third: 1,
					outside: { lowDown: 1, lowUp: 0.5, topDown: 0.5, topUp: 1.5 },
				},
			},
		},
		{
			id: "bass",
			generator: "bassPattern",
			presetSlot: "bass",
			// 根音は 30〜rootHigh、上の音は 52 まで
			window: { lo: 30, hi: 52, relTo: "absolute" },
			nonChordTones: ["passing", "approach"],
			params: { rootHigh: 42 },
		},
		{
			id: "comp",
			generator: "compHits",
			presetSlot: "chord",
			// 3声の窓（F#3〜F#4）。段 ±1 で registerStep ずつ動く
			window: { lo: 54, hi: 66, relTo: "absolute" },
			nonChordTones: [],
			params: {
				registerStep: 4,
				preferTop: { low: 62, high: 66 },
				topBonus: 3,
				// `vi(add9)` の {3,5,9}・`M7(#11)` の {5,7,#11} は、隣の声部と半音にならない並びが
				// 幅11半音の1つだけで、窓に入らない調がある
				widenMax: 7,
				outside: 5,
				// fb の手選び（`gen-fb.mjs` の `V`）: AM7=[g#3 c#4 e4]、CM7=[g3 b3 e4]、Eadd9=[g#3 b3 f#4]、
				// Am6=[c4 e4 f#4]、CM7(#11)=[g3 b3 f#4]、AM7(9)=[g#3 b3 c#4]
				tones: {
					seventh: ["3", "5", "7"],
					add9: ["3", "5", "9"],
					triad: ["R", "3", "5"],
					m6: ["3", "5", "6"],
					maj7s11: ["5", "7", "#11"],
					maj7add9: ["3", "7", "9"],
				},
			},
		},
	],
	roles: {
		home: {
			tags: ["home", "loopStart"],
			label: "A 家",
			// v1 では 16 に固定（4つの句のうち最後が予告の句）
			lengths: [[16, 1]],
			supportedLengths: [16],
			harmony: [
				{ pool: "homeOpen" },
				{ pool: "homeMid", count: 2, noRepeat: true },
				{ ref: "borrow.fore" },
			],
			rate: { arp: ARP_RATE_NORMAL },
		},
		minorDwell: {
			tags: [],
			label: "B 短調側に長く留まる",
			lengths: [
				[16, 1],
				[20, 3],
				[24, 1],
			],
			// MINOR_OPEN＋MINOR_MID×n＋MINOR_CLIMB なので 8 以上の4の倍数なら組める
			supportedLengths: [8, 12, 16, 20, 24, 28, 32, 36, 40],
			harmony: [
				{ pool: "minorOpen" },
				{ pool: "minorMid", fill: true },
				{ pool: "minorClimb" },
			],
			rate: { arp: ARP_RATE_NORMAL },
		},
		borrowA: {
			tags: ["borrow"],
			label: "C1 借りた和音1",
			lengths: [
				[8, 3],
				[12, 1],
			],
			supportedLengths: [8, 12],
			harmony: [{ ref: "borrow.a" }],
			rate: { arp: ARP_RATE_NORMAL },
		},
		glimpse: {
			tags: ["echo"],
			label: "R 一度だけ家の近くへ",
			lengths: [[4, 1]],
			supportedLengths: [4],
			harmony: [
				{ copy: { from: "home", bars: [0, -1] } },
				{ ref: "borrow.glimpseEnd" },
			],
			derive: { from: "home", transform: "liftVariant" },
			rate: { arp: ARP_RATE_NORMAL },
		},
		borrowB: {
			tags: ["borrow", "peak"],
			label: "C2 借りた和音2",
			lengths: [
				[8, 3],
				[12, 1],
			],
			supportedLengths: [8, 12],
			harmony: [{ ref: "borrow.b" }],
			rate: { arp: ARP_RATE_NORMAL },
		},
		lift: {
			tags: ["weakest"],
			label: "L 全パートが薄く明るい",
			lengths: [
				[8, 3],
				[4, 1],
			],
			supportedLengths: [4, 8],
			harmony: [{ pool: "lift", fill: true, endsOn: "V" }],
			rate: { arp: ARP_RATE_LIFT },
		},
		return: {
			tags: ["echo"],
			label: "A' 静かに戻る",
			lengths: [
				[12, 3],
				[8, 1],
			],
			supportedLengths: [8, 12],
			harmony: [
				{ copy: { from: "home", bars: [0, -4] } },
				{ pool: "returnEnd" },
			],
			derive: { from: "home", transform: "same" },
			rate: { arp: ARP_RATE_NORMAL },
		},
	},
	archetypes: [
		[
			{
				id: "fb",
				from: [fromRef("fb", 1, 76)],
				reference: {
					mml: "references/fb/fb.mml",
					// fb の区間長。引き直しが続いたときの戻り先（112BPM で 163 秒）
					lengths: {
						home: 16,
						minorDwell: 20,
						borrowA: 8,
						glimpse: 4,
						borrowB: 8,
						lift: 8,
						return: 12,
					},
					// 表の行 id。`scripts/fixtures/accomp-fb-plan.ts` の手書きと一致すること
					harmonyPicks: {
						pair: ["P1"],
						homeOpen: ["ho_fb"],
						homeMid: ["hm_fb1", "hm_fb2"],
						minorOpen: ["mo_fb"],
						minorClimb: ["mc_fb"],
						minorMid: ["mm_fb1", "mm_fb2", "mm_fb3"],
						lift: ["li_fb1", "li_fb2"],
						returnEnd: ["re_fb"],
					},
					texturePicks: {
						"home.cells": ["ret_a", "leap_a", "ret_b"],
						"home.register": [0],
						"minorDwell.cells": ["dw_a", "roll", "dw_walk", "sparse"],
						"minorDwell.register": [0],
						"borrowA.first": ["desc_a"],
						"borrowA.register": [0],
						"glimpse.register": [0],
						"borrowB.first": ["flutter"],
						"borrowB.register": [1],
						"lift.cells": ["pendulum", "lift_desc"],
						"lift.register": [0],
						"return.register": [0],
					},
				},
				// テンポの候補（BPM）。fb は 112
				tempo: [
					[110, 1],
					[112, 3],
					[114, 2],
					[116, 1],
				],
				// 曲の長さの範囲（秒）。関門「長さ」
				seconds: { min: 150, max: 180 },
				// 役割の並び。**固定**（規則①〜⑤とあわせて、このモードの不変量。S5 まで）
				form: [
					[
						[
							"home",
							"minorDwell",
							"borrowA",
							"glimpse",
							"borrowB",
							"lift",
							"return",
						],
						1,
					],
				],
				arc: {
					levels: LEVELS,
					order: {
						peak: "borrowB",
						// 規則④: 山（borrowB）と2番手の差の下限
						margin: 3,
						min: "lift",
						lt: [
							["return", "home"],
							["glimpse", "borrowA"],
							["glimpse", "borrowB"],
						],
					},
					offsetMax: 2,
					accents: {
						arp: {
							normal: { beat: 10, half: 6, even: 0, odd: -6 },
							gentle: { beat: 4, half: 2, even: 0, odd: -3 },
						},
						bass: { beat: 6, half: 2, other: -2 },
						comp: { late: -5 },
					},
				},
				mix: [
					[
						{
							// fb.space.mml の宣言そのまま。音色と効果はモード単位で固定し、区間ごとには変えない
							id: "fb",
							from: fromRef("fb", 1, 76),
							layers: {
								color: {
									gm: "Lead 1 (square)",
									strip: { reverbSend: 45, delaySend: 30 },
								},
								arp: {
									gm: "Lead 1 (square)",
									strip: {
										eqHigh: -9,
										pan: 50,
										reverbSend: 55,
										delaySend: 15,
									},
								},
								bass: {
									gm: "Synth Bass 1",
									strip: { eqHigh: -6, reverbSend: 10 },
								},
								comp: {
									gm: "Electric Piano 2",
									strip: { eqHigh: -3, pan: 80, reverbSend: 65 },
								},
							},
							master: {
								inst: "retro_game",
								volume: 80,
								fx: {
									reverbAmount: 50,
									reverbDecaySec: 3.0,
									reverbPreDelayMs: 25,
									delayAmount: 25,
									delayDivision: "8d",
								},
								drum: NO_DRUM_PATTERN,
								loop: true,
								// 前の曲の値を残さないよう、0 を明示する
								compression: 0,
								fadeIn: 0,
								fadeOut: 0,
							},
						},
						1,
					],
				],
				texture: TEXTURE,
			},
			1,
		],
	],
	harmony: {
		pools: {
			homeOpen: HOME_OPEN,
			homeMid: HOME_MID,
			minorOpen: MINOR_OPEN,
			minorMid: MINOR_MID,
			minorClimb: MINOR_CLIMB,
			lift: LIFT,
			returnEnd: RETURN_END,
		},
		borrowSets: BORROW_SETS,
	},
	patterns: { arp: CELLS, bass: BASS, comp: COMP },
	// 和音の打ち方の優先順位（S3a で読む。いまは realize の compHitsFor）
	compRules: [
		{ when: { songLast: true }, hits: "final" },
		{ when: { lastOfTag: "home" }, hits: "final" },
		{ when: { foreshadow: true }, hits: "fore" },
		// fb の型は long のまま。表から引く型を作るかは §9.1-1（S4b）
		{ when: { chordClass: "borrowed" }, hits: "long" },
	],
	constraints: [
		// 規則①。帯は roles[].rate。cellNotes はセルの1小節の音数（検査が読む）
		{
			id: "r1",
			kind: "rateBand",
			cellNotes: { min: 8, max: 10 },
			ifRoleMissing: "skip",
		},
		// 規則②。levelMargin は return と home の「強弱」の軸が違うとみなす、基準 v の平均の差の下限
		{
			id: "r2",
			kind: "contrast",
			axes: 2,
			echoPairs: [
				["glimpse", "home"],
				["return", "home"],
			],
			levelMargin: 3,
			ifRoleMissing: "fail",
		},
		{
			id: "r3",
			kind: "forbiddenMotion",
			from: { borrowed: true, third: "major" },
			interval: 5,
			to: { borrowed: true },
			exceptWithin: ["home"],
			ifRoleMissing: "skip",
		},
		// 山と谷は型が宣言する（arc.order）
		{
			id: "r4",
			kind: "dynamicsOrder",
			source: "archetype",
			ifRoleMissing: "fail",
		},
		{
			id: "r5",
			kind: "borrowSubset",
			of: "home",
			in: ["borrowA", "borrowB"],
			forbidIn: ["return"],
			ifRoleMissing: "fail",
		},
	],
	// ループの閉じ方（S3e で読む）
	seam: {
		kind: "loop:halfCadence",
		finalBar: "Vsus4 V",
		copyArpFrom: "home.last",
		bassLeadingTone: true,
		lastCompLen16: 6,
		color: "sus4Resolve",
	},
	variety: {
		fixed: ["meter"],
		debt: [],
		baseline: "references/fb/baseline.json",
	},
};
