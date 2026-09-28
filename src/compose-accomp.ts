/**
 * 伴奏主体モード（`composeAccomp`）の公開 API。設計は `docs/accomp-compose.md`（§5）。
 *
 * 歌メロが主役の `composeSong`（`compose.ts`）とは**別系統**の自動作曲で、旋律は
 * ほとんど置かず、分散和音・低音・短い和音で約2分半〜3分のループ曲を作る。手本は所有者が
 * 評価した手書き編曲 `tmp/full/fb.mml`。
 *
 * ここには公開の型と入口（{@link composeAccomp}・{@link accompMeta}）を置く。
 * - 表 … スタイル（`src/accomp-styles/<id>.ts`、`docs/accomp-style-engine.md` §3）。エンジンは
 *   `compose-accomp-style.ts` を通して読む。`compose-accomp-tables.ts` は、いままでの名前で読み直すだけの
 *   互換の口（エンジンは読まない）
 * - 計画器（段0〜3）… `compose-accomp-plan.ts`
 * - 実現器（段4〜10）… `compose-accomp-realize.ts`
 * - 関門と指標（§7）… `compose-accomp-check.ts`
 * - MML の書き出し（`accompToMml`）… `compose-accomp-mml.ts`（mml-parser を読むので、ここからは
 *   import しない）
 *
 * **実行時の import を増やさないこと**（`docs/accomp-compose.md` §4.2）。このモジュールは
 * Node から検算するので、`mml-parser`・`lyrics`・`daw` を実行時に読んではいけない。
 */

import type { PresetSlot } from "./advanced-layers";
import { ACCOMP_STYLE_ID_RE, accompStyleById } from "./accomp-styles/index";
import type { ComposedNote } from "./compose";
import { seededRandom } from "./compose";
import { accompGates, accompStats } from "./compose-accomp-check";
import {
	type AccompKey,
	type AccompPlanDiag,
	candidateStreams,
	drawSeed,
	fbPlan,
	planAccomp,
	planChordProgression,
	planSeconds,
	planSignature,
	resolveAccompKey,
} from "./compose-accomp-plan";
import { type AccompRealized, realizeAccomp } from "./compose-accomp-realize";
import {
	type AccompStyleView,
	accompStyleView,
	mixToAccompMix,
	planMix,
	planStyleView,
} from "./compose-accomp-style";
import { COMPOSE_KEYS } from "./compose-keys";
import type { MasterFxSettings } from "./master-fx";
import type { MmlMeta } from "./mml-parser";

/** 候補を引く上限（§7.1）。エンジンの定数（スタイルによらない）。 */
export const CANDIDATE_LIMIT = 24;

/**
 * 区間の役割。並びは固定で、`home → minorDwell → borrowA → glimpse → borrowB → lift → return`
 * （`ACCOMP_ITINERARY`）。fb の区間 A・B・C1・R・C2・L・A' に当たる。
 */
export type AccompRole =
	| "home"
	| "minorDwell"
	| "borrowA"
	| "glimpse"
	| "borrowB"
	| "lift"
	| "return";

export type AccompOptions = {
	/**
	 * スタイル id（`src/accomp-styles/` の登録表。`docs/accomp-style-engine.md` §2.2）。省くと `fb`。
	 * 知らない id は例外。`overrides.plan` に `style` があるときは、それと同じでなければ例外。
	 */
	style?: string;
	/** 既定 192。16 の倍数でなければ例外。 */
	stepsPerBar?: number;
	/** 既定 12。 */
	edo?: 12 | 31;
	/**
	 * DAW の「ベース調」の値。"any" は "major" として扱う。短調（`key_*m` / "minor" /
	 * 短調の `mood_*`）は同じ rootShift の長調（＝平行長調）を家にする。
	 */
	baseKey?: string;
	/** `seededRandom(seed)` を渡すと決定的になる。 */
	random?: () => number;
	/**
	 * 候補番号を固定する（再現用。`#compose` の最後の項目）。指定時は recent を無視する。
	 * 0〜`CANDIDATE_LIMIT`−1 か、−1（保険の計画）。その候補が関門で落ちれば保険の計画になる。
	 */
	pick?: number;
	/** 直近の planSignature（最大5）。一致した候補は飛ばす。 */
	recent?: string[];
	/** @0 の色の線。既定 true（1曲あたり4〜6音）。 */
	colorLine?: boolean;
	/** 一変数の A/B と検算用。v1 で持つのはこの3つだけ。 */
	overrides?: {
		lengths?: Partial<Record<AccompRole, number>>;
		bpm?: number;
		/**
		 * 計画を丸ごと与える（陽性対照の fb 計画、保険の計画）。調とテンポは計画のものになり、
		 * `lengths`・`bpm`・`pick`・`recent` は使わない。関門で落ちても返す（落ちた関門は
		 * `draws.rejected` に数える）。`pick` は −1、`compose` は `style:fb.v1:<baseKey>:plan`
		 * （種からは再現できないという印）。
		 *
		 * 計画が記録（`PlanPins`: スタイル・型・ミックス・小節ごとの和音の打ち方）を持っていれば、
		 * 実現の段はそれに従う。曲の `plan` は、記録を埋めた計画（{@link AccompSong.plan}）。
		 */
		plan?: AccompPlan;
	};
	/**
	 * 監査用（`scripts/audit-accomp-variety.ts`、`docs/accomp-style-engine.md` §5「退避の率を数える」）。
	 * 候補を1つ関門に掛けるたび、保険の計画を鳴らしたときに1回ずつ呼ぶ。**曲は変えない**（乱数の
	 * 引き方も同じ）。選抜には使わない。
	 */
	diagnostics?: (c: AccompCandidateDiag) => void;
};

/** {@link AccompOptions.diagnostics} に渡す、候補1つぶんの記録。 */
export type AccompCandidateDiag = {
	/** 候補番号。−1 は保険の計画、`"plan"` は計画を丸ごと与えた曲。 */
	k: number | "plan";
	/** 落ちた理由（最初に落ちた関門の名前・`"recent"`）。通った曲は null。 */
	rejectedBy: string | null;
	/** 計画の中の引き直しを使い切ったか。計画器を通っていない曲（保険・丸ごと与えた計画）は null。 */
	plan: AccompPlanDiag | null;
};

/**
 * 区間の質感（§6 段3）。4小節ブロックごとの値は、区間の小節数 / 4 と同じ長さの配列。
 */
export type AccompTexture = {
	/** 4小節ブロックごとの分散のセル id（スタイルの `patterns.arp`）。 */
	arpCells: string[];
	/**
	 * 分散の音域の窓。**絶対 MIDI（実際に鳴る高さ）**で持ち、ハ長調の座標へは −rootShift して
	 * 当てる。`low*` は音の組の最低音 s0 の範囲、`top*` は最高音 s4 の範囲。
	 */
	arpWindow: {
		lowMin: number;
		lowMax: number;
		topMin: number;
		topMax: number;
	};
	/** 4小節ブロックごとの低音型 id（スタイルの `patterns.bass`）。 */
	bass: string[];
	/**
	 * 区間の基本の打ち方（スタイルの `patterns.comp`）。次は実現の段が規則で上書きする（§6 段5）。
	 * - 借用和音の小節 → long（本調の和音は、どの区間でも short2 か alt13）
	 * - home の予告の小節 → fore
	 * - 曲の最終小節 → final
	 * - minorDwell で1小節1和音の小節 → short2（alt13 は2小節1和音のところ）
	 */
	comp: "short2" | "alt13" | "long";
	/** 和音の段。窓（F#3〜F#4）を 4 半音ずつずらす。 */
	compRegister: -1 | 0 | 1;
	/** 拍位置の加減の強さ（`ACCENTS`）。lift だけ gentle。 */
	accent: "normal" | "gentle";
};

export type AccompRegion = {
	role: AccompRole;
	/** 表示用（例 "B 短調側に長く留まる"）。 */
	label: string;
	/** 区間の先頭の小節。**0 始まり**（fb の B は 16）。 */
	startBar: number;
	/** 4 の倍数。 */
	bars: number;
	/**
	 * 小節ごとのローマ数字（ハ長調基準。大文字は長、小文字は短、`b` はフラット、`/数字` は
	 * 低音の音階度数）。半小節2和音は空白区切り（例 "iii7 vi7"）。
	 */
	chords: string[];
	texture: AccompTexture;
	/** 小節ごとの分散の基準 v（区間ごとの ±2 のずれ `levelOffset` を含む）。 */
	arpLevel: number[];
	/**
	 * 区間ごとの ±2 のずれ（§6 段9 の regionOffset）。**`arpLevel` には足してある。**
	 * 低音・和音を分散からのオフセットで決める区間はそのままで効くが、lift のように固定値で
	 * 決める区間は、実現の段がこの値を足す（「区間内の全トラックへ同じ値を足す」）。
	 * 設計書 §5 の型には無い。実現の段がこれを要るので足した。
	 */
	levelOffset: number;
	/**
	 * 小節ごとの和音の打ち方の id（スタイルの `patterns.comp`。区間の小節数と同じ長さ）。
	 * `docs/accomp-style-engine.md` §3.1 の `PlanPins`。実現の段が決めて記録し（{@link AccompSong.plan}）、
	 * 与えられたら実現の段はそれに従う。省くと実現の段が優先順位（いまは `compHitsFor`）で決める。
	 */
	compHits?: string[];
};

export type AccompPlan = {
	bpm: number;
	/** ハ長調からの移調量（半音、-5〜+6）。家の長調の値。 */
	rootShift: number;
	/** 借用の組の id（スタイルの `harmony.borrowSets`）。 */
	borrowPair: string;
	regions: AccompRegion[];
	/**
	 * スタイル id（`PlanPins`、§3.1）。計画器が書く。省くと既定のスタイル（fb）として読む。
	 * 表はすべてこのスタイルから引く。
	 */
	style?: string;
	/** 型 id（`PlanPins`）。強弱（`arc.levels`）の出どころもこれで決まる。省くとスタイルの最初の型。 */
	archetype?: string;
	/** ミックス id（`PlanPins`。型の `mix` の1つ）。曲の `mix` はこれ。省くと型の既定のミックス。 */
	mix?: string;
};

export type AccompSlot = "color" | "arp" | "bass" | "comp";

export type AccompTrack = {
	/** @0 color / @1 arp / @2 bass / @3 comp */
	index: 0 | 1 | 2 | 3;
	slot: AccompSlot;
	/** トラック音量 T（DAW のベロシティスライダーの値）。 */
	volume: number;
	/** velocity は相対値（100 = T）。読み込み直後と同じ形にしておく。 */
	notes: ComposedNote[];
};

/**
 * 曲が持つミックス（DAW と MML の宣言が読む形）。スタイルの型のミックス（`Mix`、§3.1）を、層の並び順を
 * トラック番号にして写したもの（`compose-accomp-style.ts` の `mixToAccompMix`）。値の例は fb。
 * 段階 S1 で、欄の型を fb のリテラル（`"retro_game"`・`80`・`"none"` など）から文字列・数へ広げた。
 */
export type AccompMix = {
	/** 楽器プリセット（fb は retro_game）。 */
	instrument: string;
	/** マスタ音量（fb は 80）。 */
	volume: number;
	/** ドラムのパターン id か `NO_DRUM_PATTERN`（fb は none）。 */
	drum: string;
	/** ループ（fb は true）。 */
	loop: boolean;
	/** reverb 50 / decay 3.0s / predelay 25ms / delay 25 / "8d" */
	masterFx: MasterFxSettings;
	/** 前の曲の値を残さないよう、0 を明示する。 */
	masterCompression: number;
	fadeIn: number;
	fadeOut: number;
	/** 0,1: Lead 1 (square) / 2: Synth Bass 1 / 3: Electric Piano 2 */
	trackInstruments: Record<0 | 1 | 2 | 3, string>;
	/** {1:-9, 2:-6, 3:-3} */
	trackEqHigh: Partial<Record<0 | 1 | 2 | 3, number>>;
	/** {1:50, 3:80} */
	trackPan: Partial<Record<0 | 1 | 2 | 3, number>>;
	/** {0:45, 1:55, 2:10, 3:65} */
	trackReverbSend: Record<0 | 1 | 2 | 3, number>;
	/** {0:30, 1:15} */
	trackDelaySend: Partial<Record<0 | 1 | 2 | 3, number>>;
};

/** 表示と自己検査のため。**採点・選抜には使わない**（§7）。 */
export type AccompStats = {
	seconds: number;
	/** 区間ごと。 */
	arpNotesPerSec: number[];
	/** 区間ごとの分散上半分の平均音高。 */
	arpUpperMean: number[];
	/** 区間ごとの分散の v 平均。 */
	arpVMean: number[];
	bassNotesPerBar: number[];
	/** 和音の一打の長さ（16分の数）の平均。借用和音とそれ以外（§6 段5「借用だけ長く」）。 */
	compMeanLen: { borrowed: number; diatonic: number };
	/**
	 * 分散の隣り合う音の音程（半音の絶対値）の割合。0〜2 step、3〜4 3rd、5〜6 4th、
	 * 7〜11 5th、12〜 8ve+。
	 */
	arpIntervalHist: Record<"step" | "3rd" | "4th" | "5th" | "8ve+", number>;
	/** 別トラックとの半音のぶつかり（M13）の数/小節。 */
	clashesPerBar: number;
	/** トラックごと（@0〜@3）の v（絶対値）の種類数。 */
	vKinds: [number, number, number, number];
	/** 陽性対照の時だけ。 */
	compVoicingMatchesFb?: number;
};

/**
 * 硬い制約（関門）の名前（§7.2）。`AccompSong.draws.rejected` のキーにもなる。
 * 計画の段で確かめられる前提は `compose-accomp-plan.ts` の `planViolations` が同じ名前で返す。
 */
export type AccompGate =
	| "length"
	| "itinerary"
	| "rule1"
	| "rule2"
	| "rule3"
	| "rule4"
	| "rule5"
	| "harmony"
	| "clash"
	| "seam"
	| "expression";

export type AccompSong = {
	kind: "accomp";
	bpm: number;
	rootShift: number;
	keyName: string;
	keyLabel: string;
	/** 短調を選んだとき「ホ短調→ト長調を家に」の注記。 */
	homeFromMinor?: string;
	bars: number;
	seconds: number;
	stepsPerBar: number;
	edo: 12 | 31;
	/**
	 * 鳴らした計画。**記録（`PlanPins`）を全部埋めてある**: スタイル・型・ミックスの id と、実現の段が
	 * 決めた小節ごとの和音の打ち方（`regions[].compHits`）。`overrides.plan` にこのまま渡すと、同じ
	 * 計画で鳴らす（`#compose` は `…:plan`）。同じトラックになるのは、同じ種の乱数で作った候補 0 の
	 * 曲だけ。和音の置き方・分散の組の同点の割り方と色の線の順は記録に無く、`overrides.plan` は種の
	 * 最初の乱数列で引くため（候補 1 以降と保険の計画は変わりうる。`docs/accomp-style-engine.md` 付録 F.8）。
	 */
	plan: AccompPlan;
	/** ComposeResult と同じ書式（"|" 区切り・ハ長調基準）。表示用。 */
	chordProgression: string;
	tracks: [AccompTrack, AccompTrack, AccompTrack, AccompTrack];
	/** 計画のミックス（`plan.mix`）の写し。書き換えてもスタイルは変わらない。 */
	mix: AccompMix;
	/**
	 * `style:<スタイル id>.v<版>:<baseKey>:<k>`（#compose の値。[\w:.-]+ に収まる。
	 * `docs/accomp-style-engine.md` §2.5）。例 `style:fb.v1:major:0`。書式は
	 * {@link formatAccompCompose}・{@link parseAccompCompose}。
	 */
	compose: string;
	/** 採った候補番号。-1 は保険の計画。 */
	pick: number;
	/** 区間長・借用組・セル id・低音型・bpm を連結したもの。 */
	planSignature: string;
	/**
	 * 引いた候補の数と、落ちた理由（関門の名前、`recent` は直近と同じ計画）ごとの数。保険の計画が
	 * 関門で落ちたとき（検算上は起きない）は `fallback:<関門>` を数える。
	 */
	draws: { tried: number; rejected: Record<string, number> };
	stats: AccompStats;
};

// ============================================================
// 入口
// ============================================================

/** `#compose` に入る値の文字集合（`mml-parser.ts` の宣言 `[\w:.-]+`。`:` は区切りなので除く）。 */
const BASE_KEY_RE = /^[\w.-]+$/;

// ============================================================
// #compose の書式（docs/accomp-style-engine.md §2.5）
// ============================================================

/** 伴奏主体モードの `#compose` の接頭辞。全スタイル共通。 */
export const ACCOMP_COMPOSE_PREFIX = "style:";

/** `#compose` の中身。 */
export type AccompComposeTag = {
	/** スタイル id（`/^[a-z0-9_-]+$/`）。 */
	style: string;
	/** スタイルの版（1 以上の整数）。 */
	version: number;
	/** DAW の「ベース調」の値（`[\w.-]+`）。 */
	baseKey: string;
	/** 採った候補番号（−1 は保険の計画）か、計画を丸ごと与えた印 `"plan"`。 */
	pick: number | "plan";
	/**
	 * 段階 S0 より前の書式 `accomp:<baseKey>:<k>` から読んだ。未コミット・未 publish だったので
	 * 投稿には無いが、手元の試聴ファイル（1・2日目）にはある。中身は `fb.v1` と同じ曲。
	 */
	legacy?: true;
};

const STYLE_COMPOSE_RE =
	/^style:([a-z0-9_-]+)\.v([1-9]\d*):([\w.-]+):(-1|\d+|plan)$/;
const LEGACY_COMPOSE_RE = /^accomp:([\w.-]+):(-1|\d+|plan)$/;

/**
 * `#compose` の値を作る: `style:<id>.v<version>:<baseKey>:<k>`。書けない値（id に `.`・`:`・
 * 大文字、baseKey に `:`、版が 1 未満など）は例外。
 */
export const formatAccompCompose = (
	tag: Omit<AccompComposeTag, "legacy">,
): string => {
	if (!ACCOMP_STYLE_ID_RE.test(tag.style))
		throw new Error(
			`formatAccompCompose: スタイル id に使えない文字（"${tag.style}"。/^[a-z0-9_-]+$/）`,
		);
	if (!Number.isInteger(tag.version) || tag.version < 1)
		throw new Error(`formatAccompCompose: 版は 1 以上の整数（${tag.version}）`);
	if (!BASE_KEY_RE.test(tag.baseKey))
		throw new Error(
			`formatAccompCompose: baseKey に使えない文字（"${tag.baseKey}"）`,
		);
	if (tag.pick !== "plan" && (!Number.isInteger(tag.pick) || tag.pick < -1))
		throw new Error(
			`formatAccompCompose: 候補番号は −1 以上の整数か "plan"（${tag.pick}）`,
		);
	return `${ACCOMP_COMPOSE_PREFIX}${tag.style}.v${tag.version}:${tag.baseKey}:${tag.pick}`;
};

/**
 * `#compose` の値を読む。伴奏主体モードの値でなければ null（歌ものの `テンプレート:調:音階:…` も
 * null）。旧書式 `accomp:<baseKey>:<k>` は `fb` の版 1 として読み、`legacy: true` を付ける。
 */
export const parseAccompCompose = (
	value: string | null | undefined,
): AccompComposeTag | null => {
	if (!value) return null;
	const m = STYLE_COMPOSE_RE.exec(value);
	if (m)
		return {
			style: m[1],
			version: Number(m[2]),
			baseKey: m[3],
			pick: m[4] === "plan" ? "plan" : Number(m[4]),
		};
	const l = LEGACY_COMPOSE_RE.exec(value);
	if (l)
		return {
			style: "fb",
			version: 1,
			baseKey: l[1],
			pick: l[2] === "plan" ? "plan" : Number(l[2]),
			legacy: true,
		};
	return null;
};

/** 家の長調の表示名（計画を丸ごと与えたとき、計画の rootShift から引く）。 */
const majorKeyOf = (
	rootShift: number,
): { keyName: string; keyLabel: string } => {
	const k = Object.values(COMPOSE_KEYS).find(
		(x) => x.mode === "major" && x.rootShift === rootShift,
	);
	return k
		? { keyName: k.name, keyLabel: k.label }
		: { keyName: `C+${rootShift}`, keyLabel: `ハ長調+${rootShift}` };
};

/**
 * 計画に記録（`PlanPins`、`docs/accomp-style-engine.md` §3.1）を埋める。スタイル・型・ミックスは計画に
 * 無ければ引いた表のもの、小節ごとの和音の打ち方は実現の段が決めたもの（`realized.compHits`）。
 * 欄は後ろに足す（元の欄の並びは変えない。記録を消すと元の計画の JSON に戻る）。
 */
const pinPlan = (
	plan: AccompPlan,
	view: AccompStyleView,
	realized: AccompRealized,
): AccompPlan => ({
	...plan,
	regions: plan.regions.map((r, i) => ({
		...r,
		compHits: [...realized.compHits[i]],
	})),
	style: plan.style ?? view.pack.id,
	archetype: plan.archetype ?? view.archetype.id,
	mix: plan.mix ?? view.mixId,
});

const songOf = (args: {
	plan: AccompPlan;
	view: AccompStyleView;
	realized: AccompRealized;
	key: { keyName: string; keyLabel: string; homeFromMinor?: string };
	baseKey: string;
	pick: number;
	/** `#compose` の最後の項目（通常は pick。計画を丸ごと与えたときは "plan"）。 */
	composeTag: number | "plan";
	draws: AccompSong["draws"];
}): AccompSong => {
	const { realized, view } = args;
	const plan = pinPlan(args.plan, view, realized);
	return {
		kind: "accomp",
		bpm: plan.bpm,
		rootShift: plan.rootShift,
		keyName: args.key.keyName,
		keyLabel: args.key.keyLabel,
		...(args.key.homeFromMinor
			? { homeFromMinor: args.key.homeFromMinor }
			: {}),
		bars: realized.bars,
		seconds: planSeconds(plan),
		stepsPerBar: realized.stepsPerBar,
		edo: realized.edo,
		plan,
		chordProgression: planChordProgression(plan),
		tracks: realized.tracks,
		mix: structuredClone(planMix(view, plan.mix)),
		compose: formatAccompCompose({
			style: view.pack.id,
			version: view.pack.version,
			baseKey: args.baseKey,
			pick: args.composeTag,
		}),
		pick: args.pick,
		planSignature: planSignature(args.plan),
		draws: args.draws,
		stats: accompStats(args.plan, realized),
	};
};

/**
 * 伴奏主体のループ曲を1曲作る（`docs/accomp-compose.md` §7.1）。
 *
 * - 段0: 呼び出しの乱数から調の種を1つ引き、調とテンポを決める（短調を選んだら平行長調を家にする）。
 * - 候補 k = 0,1,…（上限 `CANDIDATE_LIMIT`）: 候補ごとに種を6つ引き（計画・和声・質感・配置・強弱・色）、
 *   計画 → 実現 → 関門。**関門で落ちたら次の候補**、`recent` と同じ計画も次の候補。
 *   **採点はしない**。通った最初の候補を採る。
 * - どれも通らなければ保険の計画（fb 相当。関門を通ることを全調・全テンポで検算済み）。`pick` は −1。
 *
 * 再現は `composeAccomp({ random: seededRandom(seed), baseKey, pick: k })`（`#seed` と
 * `#compose=style:fb.v1:<baseKey>:<k>`）。候補 k の中身は（seed, k）だけで決まるので、`recent` が
 * あっても再現できる。
 */
export const composeAccomp = (o: AccompOptions = {}): AccompSong => {
	const stepsPerBar = o.stepsPerBar ?? 192;
	if (
		!Number.isInteger(stepsPerBar) ||
		stepsPerBar <= 0 ||
		stepsPerBar % 16 !== 0
	)
		throw new Error(
			`composeAccomp: stepsPerBar は 16 の倍数（${stepsPerBar}）`,
		);
	const edo = o.edo ?? 12;
	if (edo !== 12 && edo !== 31)
		throw new Error(`composeAccomp: edo は 12 か 31（${edo}）`);
	const baseKey = (o.baseKey ?? "").trim() || "any";
	if (!BASE_KEY_RE.test(baseKey))
		throw new Error(`composeAccomp: baseKey に使えない文字（"${baseKey}"）`);
	const pick = o.pick;
	if (
		pick !== undefined &&
		(!Number.isInteger(pick) || pick < -1 || pick >= CANDIDATE_LIMIT)
	)
		throw new Error(
			`composeAccomp: pick は −1〜${CANDIDATE_LIMIT - 1} の整数（${pick}）`,
		);
	const random = o.random ?? Math.random;
	const colorLine = o.colorLine ?? true;
	const givenPlan = o.overrides?.plan;
	if (
		o.style !== undefined &&
		givenPlan?.style !== undefined &&
		o.style !== givenPlan.style
	)
		throw new Error(
			`composeAccomp: style（${o.style}）と overrides.plan の style（${givenPlan.style}）が違う`,
		);
	if (o.style !== undefined && !accompStyleById(o.style))
		throw new Error(`composeAccomp: 知らないスタイル "${o.style}"`);
	// スタイルと型（段階 S1 は型が1つなので引かない。S4a で候補ごとに引く）
	const view = accompStyleView(
		o.style ?? givenPlan?.style,
		givenPlan?.archetype,
	);

	// 段0（計画を丸ごと与えるときも同じ数だけ引く）
	const key: AccompKey = resolveAccompKey(
		baseKey,
		seededRandom(drawSeed(random)),
		o.overrides?.bpm,
		view,
	);
	const rejected: Record<string, number> = {};
	const reject = (gate: string): void => {
		rejected[gate] = (rejected[gate] ?? 0) + 1;
	};

	// 計画を丸ごと与える（陽性対照・一変数の A/B）
	if (givenPlan) {
		// style を省いた計画は、指定したスタイル（省けば既定）の計画として読む
		const given: AccompPlan =
			givenPlan.style === undefined && o.style !== undefined
				? { ...givenPlan, style: view.pack.id }
				: givenPlan;
		const streams = candidateStreams(random);
		const realized = realizeAccomp({
			plan: given,
			streams,
			stepsPerBar,
			edo,
			colorLine,
		});
		const fails = accompGates(given, realized);
		for (const g of new Set(fails.map((f) => f.gate))) reject(g);
		o.diagnostics?.({
			k: "plan",
			rejectedBy: fails[0]?.gate ?? null,
			plan: null,
		});
		return songOf({
			plan: given,
			view: planStyleView(given),
			realized,
			key: majorKeyOf(given.rootShift),
			baseKey,
			pick: -1,
			composeTag: "plan",
			draws: { tried: 1, rejected },
		});
	}

	const recent = new Set<string>(pick === undefined ? (o.recent ?? []) : []);
	let tried = 0;
	if (pick !== -1) {
		for (let k = 0; k < CANDIDATE_LIMIT; k++) {
			// 候補ごとに種を6つ（読み飛ばす候補でも引く。候補 k の中身を (seed, k) だけで決めるため）
			const streams = candidateStreams(random);
			if (pick !== undefined && k !== pick) continue;
			tried++;
			const diag: AccompPlanDiag | undefined = o.diagnostics
				? {
						lengthsExhausted: false,
						textureExhausted: false,
						offsetsExhausted: false,
					}
				: undefined;
			const plan = planAccomp({
				bpm: key.bpm,
				rootShift: key.rootShift,
				streams,
				lengths: o.overrides?.lengths,
				diag,
				style: view.pack.id,
				archetype: view.archetype.id,
			});
			const realized = realizeAccomp({
				plan,
				streams,
				stepsPerBar,
				edo,
				colorLine,
			});
			const fails = accompGates(plan, realized);
			const rejectedBy =
				fails.length > 0
					? fails[0].gate
					: recent.has(planSignature(plan))
						? "recent"
						: null;
			if (diag) o.diagnostics?.({ k, rejectedBy, plan: diag });
			if (rejectedBy !== null) reject(rejectedBy);
			else
				return songOf({
					plan,
					view,
					realized,
					key,
					baseKey,
					pick: k,
					composeTag: k,
					draws: { tried, rejected },
				});
			if (pick !== undefined) break;
		}
	}

	// 保険の計画（型の参照計画。区間長の上書きは使わない）。配置と色は決まった乱数列
	const plan = fbPlan(key.rootShift, key.bpm, view.pack.id);
	const realized = realizeAccomp({ plan, stepsPerBar, edo, colorLine });
	const fallbackFails = accompGates(plan, realized);
	for (const g of new Set(fallbackFails.map((f) => f.gate)))
		reject(`fallback:${g}`);
	o.diagnostics?.({
		k: -1,
		rejectedBy: fallbackFails[0]?.gate ?? null,
		plan: null,
	});
	return songOf({
		plan,
		view,
		realized,
		key,
		baseKey,
		pick: -1,
		composeTag: -1,
		draws: { tried, rejected },
	});
};

/**
 * 曲のミックスと由来を `MmlMeta` にする（§5）。**DAW の適用（`applyTrackStripMeta` 等）と MML の
 * 書き出し（`accompToMml`）が共通で通る唯一の変換。** `#seed` と `#ver` は曲が持たないので
 * 呼び出し側が足す。
 *
 * マスタの Decay は `#reverbdecay=` の 0.1 秒単位へ直す（`master-fx.ts` の `masterFxToMeta` と同じ
 * 変換。§4.2 のため import はしない。一致は検算する）。マスタコンプとフェードは 0 を明示する
 * （`formatMmlMeta` は 0 を省くが、DAW への適用で前の曲の値を残さないため）。
 */
export const accompMeta = (s: AccompSong): MmlMeta => {
	const m = s.mix;
	const rec = <T>(r: Partial<Record<0 | 1 | 2 | 3, T>>): Record<number, T> => {
		const out: Record<number, T> = {};
		for (const [k, v] of Object.entries(r))
			if (v !== undefined) out[Number(k)] = v as T;
		return out;
	};
	return {
		instrument: m.instrument,
		drum: m.drum,
		volume: m.volume,
		reverb: m.masterFx.reverbAmount,
		reverbDecay: Math.round(m.masterFx.reverbDecaySec * 10),
		reverbPreDelay: m.masterFx.reverbPreDelayMs,
		delay: m.masterFx.delayAmount,
		delayDivision: m.masterFx.delayDivision,
		masterCompression: m.masterCompression,
		fadeIn: m.fadeIn,
		fadeOut: m.fadeOut,
		edo: s.edo,
		loop: m.loop,
		compose: s.compose,
		trackInstruments: rec(m.trackInstruments),
		trackEqHigh: rec(m.trackEqHigh),
		trackPan: rec(m.trackPan),
		trackReverbSend: rec(m.trackReverbSend),
		trackDelaySend: rec(m.trackDelaySend),
	};
};

// ============================================================
// DAW との結合（docs/accomp-style-engine.md §2.4）。DAW はスタイル名も表も知らずに、これだけを使う
// ============================================================

/**
 * 曲のトラック（層 id = `AccompTrack.slot`）から DAW の枠（おまかせマスタリングの割り当て）への対応。
 * スタイルの層の定義（`LayerDef.presetSlot`）から作る。
 */
export const accompPresetSlots = (
	song: Pick<AccompSong, "plan">,
): Readonly<Record<string, PresetSlot>> => planStyleView(song.plan).presetSlots;

/** {@link accompMixToRelease} が見る、DAW のいまの値。 */
export type AccompMixState = {
	delayAmount: number;
	delayDivision: string;
	loop: boolean;
};

/** そのスタイルの全部の型の全部のミックス（曲が持つ形）。知らないスタイルは空。 */
const styleMixes = (styleId: string): AccompMix[] => {
	const pack = accompStyleById(styleId);
	if (!pack) return [];
	return pack.archetypes.flatMap(([a]) =>
		a.mix.map(([m]) => mixToAccompMix(m, pack.layers)),
	);
};

/**
 * DAW の「伴奏主体のミックスを戻す」（`daw.ts` の `releaseAccompMix`）の判定。検査できるように
 * 純関数にしてある（`scripts/check-accomp-styles.ts`）。
 *
 * - `compose`（DAW の `#compose` の値）が伴奏主体の値（`style:…`・旧書式 `accomp:…`）でなければ、何も戻さない
 * - 比べる相手は、作った時点の `song.mix`（`remembered`。`#compose` が同じときだけ）。無ければ
 *   （キープから戻した曲・読み込んだ MML）、そのスタイルの型が持つミックスのどれか
 * - ディレイは量と音価の両方が一致したら、ループは一致したら戻す（利用者が変えていれば残す）
 */
export const accompMixToRelease = (
	compose: string | null | undefined,
	now: AccompMixState,
	remembered?: { compose: string; mix: AccompMix } | null,
): { delay: boolean; loop: boolean } => {
	const tag = parseAccompCompose(compose);
	if (!tag) return { delay: false, loop: false };
	const mixes =
		remembered && remembered.compose === compose
			? [remembered.mix]
			: styleMixes(tag.style);
	return {
		delay: mixes.some(
			(m) =>
				now.delayAmount === m.masterFx.delayAmount &&
				now.delayDivision === m.masterFx.delayDivision,
		),
		loop: mixes.some((m) => now.loop === m.loop),
	};
};
