/**
 * 伴奏主体モードのスタイルの型（`docs/accomp-style-engine.md` §3.1）と、表を書くための小さな道具。
 *
 * 設計では `src/accomp/schema.ts` に置くものだが、`src/accomp/` への引っ越しは段階 S3 まで待つので、
 * 段階 S1 ではここに置く（付録 F.7）。
 *
 * **段階 S1 の時点で、エンジン（`compose-accomp*.ts`）が読む欄と、まだ読まない欄がある。**
 * まだ読まない欄は、設計（§3.2）の fb の値を**宣言として**書いておき、その段階で読む。
 * - 読む: 見出し・層（`layers`。窓と生成器の引数）・役割（`roles`。表示名・長さ・組める長さ・規則①の帯）・
 *   型（`archetypes`。テンポ・秒数・並び・強弱・ミックス・役割ごとの質感・参照計画の選び方）・
 *   和声の表（`harmony`）・パターンの表（`patterns`）・固有の制約のうち数値の引数
 *   （`contrast.levelMargin`・`arc.order.margin`）
 * - まだ読まない: `compRules`（S3a。いまは realize の `compHitsFor`）・`constraints` の判定そのもの（S3d）・
 *   `seam`（S3e）・`RoleDef.harmony` と `derive`（S3f・S3c。いまは plan の文法のコード）・
 *   行の `energy`・`mask`・`fits`（S2）・`variety`（監査、S2 以降）・`ablations`（fixtures へ移すとき）
 *
 * **実行時の import を増やさないこと**（`compose-accomp.ts` から読むので、Node から koe 無しで
 * 読めなければならない。`docs/accomp-compose.md` §4.2）。型の import は構わない。
 */

import type { MasterFxSettings } from "../../audio/master-fx";
import type { PresetSlot } from "../advanced-layers";
import type { AccompTexture } from "../compose-accomp";

// ============================================================
// 共通
// ============================================================

/** `[値, 重み]`。重みは正の数。 */
export type Weighted<T> = readonly [T, number];
/** 重み付きの表（§3.1 の `W<T>`）。 */
export type W<T> = readonly Weighted<T>[];

/** スタイル id。`/^[a-z0-9_-]+$/`（`.` と `:` は `#compose` の区切り）。{@link validateStylePack} で検査する。 */
export type StyleId = string;

/** スタイル id に使える文字（§2.5）。 */
export const ACCOMP_STYLE_ID_RE = /^[a-z0-9_-]+$/;

/** 役割のタグ。閉じた語彙で、増えていないことを検査する。スタイル id の言い換えにしない。 */
export type RoleTag =
	| "home"
	| "peak"
	| "weakest"
	| "echo"
	| "borrow"
	| "loopStart";

/** {@link RoleTag} の語彙（検査で、増えていないことを見る）。 */
export const ROLE_TAGS: readonly RoleTag[] = [
	"home",
	"peak",
	"weakest",
	"echo",
	"borrow",
	"loopStart",
];

/**
 * 行やミックスの出所。所有者が承認した手書きの試作まで辿れること。聴いただけでは足りない。
 * - `ref` … `references/<style>/<ref>.mml` の小節（1 始まり、両端を含む）
 * - `op` … 変形で作った行。`approved` が true になるまで引かない（§4.3。**段階 S1 ではまだ
 *   引く前に見ていない**。lint は S2）
 */
export type Provenance =
	| { ref: string; bars: readonly [number, number] }
	| { op: string; parent: string; approved: boolean };

/** 行を引く条件（S2 から使う。段階 S1 ではどの行も持たない）。 */
export type Mask = {
	chordClass?: readonly ("maj" | "min" | "sus" | "dom" | "borrowed")[];
	/** 和音の長さ（小節）。 */
	span?: readonly (0.5 | 1 | 2)[];
	/** 4小節の中の位置。 */
	barInBlock?: readonly number[];
	/** 区間の境目。 */
	boundary?: "pre" | "on" | "last";
};

/** 表の1行（§3.1）。 */
export type Row<T> = {
	id: string;
	body: T;
	/**
	 * 重み。和声の句と借用の組は、いまの表の重み（fb 由来 2・それ以外 1 など）。**分散のセル・低音型・
	 * 和音の打ち方の行は 1 の仮置き**で、引くときの重みは型の `texture`（役割ごとの候補と重み）が持つ
	 * （S2 でエネルギー段の表にするまで。付録 F.7）。
	 */
	weight: number;
	/** 0 抜け 〜 3 山。S2 から（段階 S1 では持たない）。 */
	energy?: 0 | 1 | 2 | 3;
	mask?: Mask;
	from: Provenance;
	/** 合う型の id。省くと、起こした試作の型だけに合う（S2 から）。 */
	fits?: readonly string[];
	/**
	 * 出所の説明（いまの表の `source`・`use` の文字列そのまま）。段階 S1 で足した欄（付録 F.7）。
	 * 表示と、`compose-accomp-tables.ts` の互換の形（`source`）を作るためだけに使う。
	 */
	note?: string;
};

// ============================================================
// 表の中身（行の body）
// ============================================================

/** 和声の句（4小節。`|` 区切り）。 */
export type PhraseBody = { bars: string };

/** 借用和音の組（`compose-accomp-tables.ts` の `BorrowPair` の中身）。 */
export type BorrowSetBody = {
	/** borrowA の和音の並び（表示用）。 */
	labelA: string;
	/** borrowB の和音の並び（表示用）。 */
	labelB: string;
	/** home 13〜16小節の予告の句。最終小節は必ず `Vsus4 V`（規則⑤）。 */
	fore: string;
	a8: string;
	a12: string;
	b8: string;
	b12: string;
	glimpseEnd: string;
};

/**
 * 分散の1音。`[音の番号, 16分の数]`。音の番号は、和音ごとに選ぶ5音の組 s0 < s1 < s2 < s3 < s4
 * （s0 は窓の支え、s4 は窓の天辺）の添字。
 */
export type ArpStep = readonly [index: number, len16: number];

export type ArpCellBody = {
	/** 族（表示と説明用）。規則②の「セル」の軸は id で比べる。 */
	family: string;
	/** 向き。 */
	dir: "up" | "down" | "wave";
	/** 1小節分（合計16）。 */
	steps: readonly ArpStep[];
	/** 1小節の音数（`steps` から数える）。規則①のため 8〜10 に限る。 */
	notes: number;
	/** glimpse 用の変形（上の音を1段上げたもの）の id。home で使うセルだけが持つ。 */
	liftVariant?: string;
};

/**
 * 低音の1音の度数。
 * - `R` 根音（絶対 MIDI 30〜42 の中で、前の根音に最も近いオクターブ）
 * - `5` 5度上（52 を超えるなら 5度下）、`5v` 5度下（fb の「5↓」）
 * - `8` オクターブ上（52 を超えるなら根音）
 * - `P` 経過音（次の根音へ寄せる音。区間の境と借用和音に入る所は次の根音の半音下）
 * - `R'`・`5'` 半小節2和音の小節の、2つめの和音の根音・5度
 * - `N` 次の根音へ全音か半音で寄せる**構成音**（fb C2 56 の Am6 の F#→E。無ければ5度）
 * - `r` 休符
 */
export type BassTone = "R" | "5" | "5v" | "8" | "P" | "N" | "R'" | "5'" | "r";
export type BassStep = readonly [tone: BassTone, len16: number];

export type BassPatternBody = {
	/** 1小節の形（合計16）。2つあるものは `alternate` の規則で交互に使う。 */
	bars: readonly (readonly BassStep[])[];
	/**
	 * 2つめの形へ移る規則。`sameChord` は同じ和音の2小節目（fb の B・C1）、`barParity` は
	 * 区間の中の小節の偶奇（fb の L）。形が1つなら使わない。
	 */
	alternate?: "sameChord" | "barParity";
	/** 半小節2和音の小節で代わりに使う型。 */
	split?: string;
	/**
	 * 区間の最終小節で代わりに使う型（§6 段3 の「borrowB は最終小節を2分に緩める」、fb の L の
	 * 最後の小節 `b1:2 r:2`）。
	 */
	last?: string;
};

/** 和音の打ち方の1つ。`[和音, 16分の数]`。和音は 0 = 1つめ、1 = 2つめ（半小節2和音）、-1 = 休符。 */
export type CompHit = readonly [chord: 0 | 1 | -1, len16: number];

export type CompHitsBody = {
	/** 1小節1和音のときの形。2つあるものは `alternate` の規則で使い分ける。 */
	one: readonly (readonly CompHit[])[];
	/** 半小節2和音のときの形（いつも1つめを使う）。 */
	two: readonly (readonly CompHit[])[];
	/** 区間の後半（区間の中の小節 ≥ 区間長 / 2）で `one` の代わりに使う形。 */
	late?: readonly (readonly CompHit[])[];
	/**
	 * 1和音の形が2つあるときの使い分け（段階 S1 で足した欄。付録 F.7）。
	 * - `sameChord` … 同じ和音の2小節目は2つめ、それ以外は1つめ（`long`）
	 * - `sameChordElseParity` … 同じ和音の2小節目は2つめ、1小節目は1つめ、組にならない小節は
	 *   区間の中の小節の偶奇（`alt13`）
	 * 形が1つなら使わない。いままでは realize の `compHitsFor` が打ち方の id で分けていた。計画に
	 * 打ち方の id を記録して従わせる（`PlanPins`）には、id から形を選ぶ規則が id の外に要る。
	 */
	alternate?: "sameChord" | "sameChordElseParity";
};

// ============================================================
// 役割の質感（型が役割ごとに持つ。段階 S1 ではいまの `ROLE_TEXTURE` そのまま）
// ============================================================

/**
 * セルの決め方。
 * - `pool` … 4小節ブロックごとに重みで引く。同じセルを2ブロック続けない。`last` があれば
 *   最後のブロックはそれに固定（home の予告の句、minorDwell の上がって終わる句）。
 * - `alternate` … 先頭を `first` の重みで引き、あとは2つを交互に並べる。
 * - `homeLift` … home 第1ブロックのセルの `liftVariant`（glimpse）。
 * - `homeEcho` … home と同じ和声の前半は home の同じブロックのセル（音ごと複写する）、
 *   `RETURN_END` のブロックは home 第3ブロックのセル（return）。
 */
export type CellRule =
	| { kind: "pool"; pool: W<string>; last?: string }
	| {
			kind: "alternate";
			cells: readonly [string, string];
			first: readonly [number, number];
	  }
	| { kind: "homeLift" }
	| { kind: "homeEcho" };

/**
 * 低音型の決め方（4小節ブロックごと）。
 * - `each` … 全ブロック `id`。`last` があれば最後のブロックはそれ。
 * - `split` … 前半 `first` → 後半 `second`。3ブロックなら真ん中を `middle` の重みで引く。
 * - `lead` … 最初のブロックだけ `first`、残りは `rest`。
 */
export type BassRule =
	| { kind: "each"; id: string; last?: string }
	| {
			kind: "split";
			first: string;
			second: string;
			middle: W<string>;
	  }
	| { kind: "lead"; first: string; rest: string };

export type RoleTexture = {
	cells: CellRule;
	window: AccompTexture["arpWindow"];
	bass: BassRule;
	comp: AccompTexture["comp"];
	register: W<AccompTexture["compRegister"]>;
	accent: AccompTexture["accent"];
};

// ============================================================
// 強弱（型の arc）
// ============================================================

/**
 * 役割ごとの強弱。`arp` はキーフレーム（fb の小節ごとの分散の基準 v）で、区間の長さへ
 * 線形に伸ばす（長さが fb と同じならそのまま）。低音と和音は分散からのオフセット。
 */
export type LevelSpec = {
	arp: readonly number[];
	/** 低音: 分散からのオフセット（`lastBar` は区間の最終小節だけの値）か、固定値。 */
	bass: { offset: number; lastBar?: number } | { fixed: number };
	/** 和音: 分散からのオフセット（`to` があれば区間の終わりへ向けて線形に変える）か、固定値。 */
	comp: { offset: number; to?: number } | { fixed: number };
};

/**
 * 拍位置の加減（`gen-fb.mjs:340-346` そのまま）。pos は小節内の16分の位置。
 * pos%8==0 → `beat`、pos%4==0 → `half`、偶数 → `even`、奇数 → `odd`。
 * 和音は pos≥8 で `late`。最後に 1〜127 に丸める。
 */
export type Accents = {
	arp: Readonly<
		Record<
			AccompTexture["accent"],
			{ beat: number; half: number; even: number; odd: number }
		>
	>;
	bass: { beat: number; half: number; other: number };
	comp: { late: number };
};

/**
 * 山と谷（規則④）。段階 S1 で読むのは `margin`（山と2番手の差の下限）だけ。判定そのものは
 * まだ plan・check のコード（S3d で1つの制約にまとめる）。
 */
export type DynamicsOrder<R extends string = string> = {
	/** 唯一の山。 */
	peak: R;
	/** 山と2番手の差の下限（いまの `PEAK_MARGIN`）。 */
	margin: number;
	/** 最弱。 */
	min: R;
	/** `[a, b]` で a < b。 */
	lt: readonly (readonly [R, R])[];
};

// ============================================================
// 層（トラック）
// ============================================================

/** 分散の音の組の選び方（生成器 arpCells の引数。いまの `ARP_SET`）。 */
export type ArpSetParams = {
	stepMin: number;
	stepMax: number;
	tensionStepMin: number;
	/**
	 * 窓を広げてよい幅（半音）。窓は fb（ホ長調）の実測で天辺の幅が2〜4半音しかないので、調や和音
	 * によってはそこに構成音が1つも無い（ハ長調の V は E5〜F#5 に音が無い）。窓は硬い制約にせず、
	 * この幅の中で外へ出た距離を `cost.outside` で重くする。
	 */
	widenMax: number;
	cost: {
		interval: number;
		idealInterval: number;
		second: number;
		top: number;
		bottom: number;
		clash: number;
		/** s0 が3度のとき。 */
		third: number;
		/**
		 * 窓の外へ出た距離（半音）あたり。天辺は上へ出るのを重く、下へ出るのを軽くする（fb の家の
		 * 天辺は 3・4・6・8・10小節で B4〜D#5 と、窓 E5〜F#5 より下に来ることが多い）。支えは下へ
		 * 出ると和音トラックの音域（F#3〜F#4）に沈むので、上へ出るより重くする。
		 */
		outside: { lowDown: number; lowUp: number; topDown: number; topUp: number };
	};
};

/** 低音の引数（窓は `LayerDef.window` の lo〜hi が「根音の下限〜上の音の上限」）。 */
export type BassParams = {
	/** 根音を置いてよい上限（絶対 MIDI）。 */
	rootHigh: number;
};

/** 和音の置き方で使う度数の組の名前（`analyzeRoman` の `voicing`）。 */
export type ChordVoicingKind =
	| "seventh"
	| "add9"
	| "triad"
	| "m6"
	| "maj7s11"
	| "maj7add9";

/** 和音の置き方の引数（窓は `LayerDef.window`。いまの `COMP_VOICING` の窓以外と `COMP_TONES`）。 */
export type CompParams = {
	/** 段 +1 なら `registerStep` だけ上、−1 なら下。 */
	registerStep: number;
	/** 段の上下と一緒に動く。最上音がこの範囲にある配置を加点する。 */
	preferTop: { low: number; high: number };
	/** 最上音が `preferTop` にあるときに移動量 Σ|Δ| から引く値。 */
	topBonus: number;
	/** 窓の外へ出てよい幅（半音）。 */
	widenMax: number;
	/** 窓の外へ出た距離あたりの費用。 */
	outside: number;
	/**
	 * 和音の置き方で使う度数（3声の密集配置、根音は低音に任せる）。度数の `3` は sus4 では4度を指す。
	 */
	tones: Readonly<Record<ChordVoicingKind, readonly string[]>>;
};

/** 色の線の引数（窓は `LayerDef.window`。いまの `COLOR_LINE` の `range` 以外）。 */
export type ColorLineParams = {
	/** borrowB の中で置く小節（0 始まり）。 */
	borrowBBars: readonly number[];
	placement: {
		first: { pos16: number; len16: number };
		second: { pos16: number; len16: number };
		final: { len16: number };
	};
	/** v。借用区間の音は max、借用区間の最後の音と最終小節は min。 */
	velocity: { min: number; max: number };
	/** その小節の分散の天辺より、これだけ以上下に置く（半音）。最終小節には求めない。 */
	belowTop: number;
	/** 音の長さの下限（16分の数）。 */
	minLen16: number;
	/** 最終小節の sus4 の4度を置きたい高さ（ハ長調の座標の MIDI）。 */
	finalFourth: number;
	/** 最終小節の4度→3度を置ける高さが窓に無いとき、上下へ広げる幅（半音）。 */
	finalWiden: number;
	/** ローマ数字の根音と長短（`AccompChord.colorKey`）から、使う度数。 */
	tones: Readonly<Record<string, readonly string[]>>;
	/** 1曲の音数（検査の期待値。関門ではない）。 */
	notesPerSong: { min: number; max: number };
};

type LayerBase = {
	/** 層 id。段階 S1 のエンジンは `color`・`arp`・`bass`・`comp` の4層だけを扱う（N 層は S5）。 */
	id: string;
	/** DAW の枠（上級者モードのおまかせマスタリングの割り当て）。 */
	presetSlot: PresetSlot;
	/**
	 * 音域の窓（絶対 MIDI）。`relTo: "absolute"` は S5 まで（いまの値、ホ長調で測った値）。
	 * - color: 置いてよい高さ（いまの `COLOR_LINE.range`）
	 * - bass: 根音の下限〜上の音の上限（いまの `BASS_RANGE.rootLow`・`high`）
	 * - comp: 3声の窓（いまの `COMP_VOICING.low`・`high`）
	 * - arp: 役割ごとの窓（型の `texture[役割].window`）を包む範囲。**段階 S1 のエンジンは読まない**
	 *   （楽器の音域との lint のための値。S2）
	 */
	window: { lo: number; hi: number; relTo: "tonic" | "absolute" };
	nonChordTones: readonly ("passing" | "neighbour" | "approach")[];
};

/**
 * 層の定義（§3.1）。段階 S1 で、生成器の引数 `params` を足した（付録 F.7）。いまの表のうち、
 * 生成器を fb に合わせて詰めた値（`ARP_SET`・`COMP_VOICING`・`COMP_TONES`・`COLOR_LINE`・`BASS_RANGE`）を
 * ここへ移した。
 */
export type LayerDef =
	| (LayerBase & { generator: "colorLine"; params: ColorLineParams })
	| (LayerBase & { generator: "arpCells"; params: ArpSetParams })
	| (LayerBase & { generator: "bassPattern"; params: BassParams })
	| (LayerBase & { generator: "compHits"; params: CompParams });

// ============================================================
// 役割・型・ミックス
// ============================================================

/** 和声の欄（S3f で読む。段階 S1 では宣言だけ）。 */
export type Slot =
	| {
			pool: string;
			count?: number;
			noRepeat?: boolean;
			fill?: boolean;
			endsOn?: string;
	  }
	| { copy: { from: string; bars: readonly [number, number] } }
	| { ref: string };

export type RoleDef = {
	tags: readonly RoleTag[];
	/** 区間の表示名（段階 S1 で足した欄。いまの `ROLE_LABELS`）。 */
	label: string;
	/** 区間長の候補（小節、4の倍数）。 */
	lengths: W<number>;
	/**
	 * 和声の表で組み立てられる区間長（段階 S1 で足した欄。いまの `SUPPORTED_LENGTHS`。
	 * `overrides.lengths` の検算に使う）。S3f で和声の文法から出すようにする。
	 */
	supportedLengths: readonly number[];
	/** 和声の欄（S3f。段階 S1 では宣言だけ）。 */
	harmony?: readonly Slot[];
	/** 写しと派生（S3c。段階 S1 では宣言だけ）。 */
	derive?: {
		from: string;
		transform: "same" | "liftVariant";
		blockMap?: readonly number[];
	};
	/** 規則①の帯（毎秒の音数）。層 id ごと。段階 S1 のエンジンが読むのは `arp` だけ。 */
	rate?: Readonly<Partial<Record<string, readonly [number, number]>>>;
};

/** トラック（層）ごとの効果。段階 S1 は `AccompMix` が持つ4つだけ（EQ 低・中・幅・バンクは S2 で）。 */
export type StripFx = {
	eqHigh?: number;
	pan?: number;
	reverbSend?: number;
	delaySend?: number;
};

/**
 * ミックス（§3.1）。所有者が承認したものだけ（`from`）。`compose-accomp.ts` の `AccompMix`
 * （曲が持ち、DAW と MML の宣言が読む形）へは、層の並び順をトラック番号にして写す。
 * `master` の `compression`・`fadeIn`・`fadeOut` は段階 S1 で足した欄（いまの `AccompMix` が 0 を明示するため）。
 */
export type Mix = {
	id: string;
	from: Provenance;
	/** 層 id ごと。`gm` は GM の楽器名。音源バンク（`font`）は S2（`accompMeta` が `#tNfont` を書くようにしてから）。 */
	layers: Readonly<Record<string, { gm: string; strip: StripFx }>>;
	master: {
		inst: string;
		volume: number;
		fx: MasterFxSettings;
		/** ドラムのパターン id（`DRUM_PATTERNS`）か `"none"`。 */
		drum: string;
		loop: boolean;
		compression: number;
		/** 0.1 秒単位。 */
		fadeIn: number;
		/** 0.1 秒単位。 */
		fadeOut: number;
	};
};

/**
 * 型: 一緒に設計した束。1曲はまず型を1つ引く。型は承認した手書きの試作1本から1つ起こす。
 * **段階 S1 は型が1つ・ミックスが1つ・並びが1つ**（乱数を引かずにそれを使う。S4a で引く）。
 */
export type Archetype<R extends string = string> = {
	id: string;
	from: readonly Provenance[];
	/**
	 * 型ごとの参照計画（§5）。設計では注釈（`annotations`）から組み立てる。段階 S1 は注釈がまだ無いので、
	 * いまの `fbPlan` と同じく「区間長と、表の行 id を決めた値で並べたもの（`picks`）」で組み立てる
	 * （付録 F.7。いままで `compose-accomp-plan.ts` にあった `FB_LENGTHS`・`FB_HARMONY_SCRIPT`・
	 * `FB_TEXTURE_SCRIPT`）。
	 */
	reference: {
		/** 注釈（S3 以降。段階 S1 ではまだ無い）。 */
		annotations?: string;
		mml: string;
		/** 参照計画の区間長。区間長の引き直しが続いたときの戻り先でもある。 */
		lengths: Readonly<Record<R, number>>;
		/** 和声の句・借用の組の選び方（キーは和声の段の抽選の名前、値は順に返す行 id）。 */
		harmonyPicks: Readonly<Record<string, readonly (string | number)[]>>;
		/** 質感の選び方（キーは `<役割>.cells` など、値は順に返す id か値）。 */
		texturePicks: Readonly<Record<string, readonly (string | number)[]>>;
	};
	tempo: W<number>;
	seconds: { min: number; max: number };
	/** 役割の並び。S4 までは長さの違いだけ（段階 S1 は1通り）。 */
	form: W<readonly R[]>;
	/** 型ごとの区間長（S4a。段階 S1 は役割の `lengths` を使う）。 */
	lengths?: Readonly<Partial<Record<R, W<number>>>>;
	arc: {
		levels: Readonly<Record<R, LevelSpec>>;
		order: DynamicsOrder<R>;
		/** 区間ごとの強弱のずれの幅（±）。段階 S1 で足した欄（いまの `LEVEL_OFFSET_MAX`）。 */
		offsetMax: number;
		/** 拍位置の加減。段階 S1 で足した欄（いまの `ACCENTS`）。 */
		accents: Accents;
	};
	mix: W<Mix>;
	/**
	 * 役割ごとの質感。**段階 S1 はいまの `ROLE_TEXTURE` そのまま**（役割ごとの候補と重み）。
	 * 設計（§3.1）の「層ごとのエネルギー段」の形へは S2 で書き直す（付録 F.7）。
	 */
	texture: Readonly<Record<R, RoleTexture>>;
	/** いまのエンジンに無い。足すなら実現の段とエンジンの検査（§6）。 */
	groove?: { swing16?: number };
};

/** 和音の打ち方の優先順位（S3a で読む。段階 S1 では宣言だけ。いまは realize の `compHitsFor`）。 */
export type CompRule = {
	when: {
		songLast?: true;
		lastOfTag?: RoleTag;
		foreshadow?: true;
		chordClass?: "borrowed";
	};
	hits: string | { energy: readonly number[] };
};

/**
 * 固有の制約（S3d で判定のコードを汎用の制約へ移す）。段階 S1 のエンジンが読むのは
 * `contrast.levelMargin` だけ（規則②の return と home の強弱の差の下限、いまの `ECHO_LEVEL_MARGIN`）。
 * `rateBand.cellNotes`（いまの `CELL_NOTES`）は検査だけが読む。
 */
export type Constraint = {
	id: string;
	/** 名指しした役割が並びに無いとき。省略不可。 */
	ifRoleMissing: "skip" | "fail";
} & (
	| { kind: "rateBand"; cellNotes: { min: number; max: number } }
	| {
			kind: "contrast";
			axes: number;
			echoPairs: readonly (readonly [string, string])[];
			levelMargin: number;
	  }
	| {
			kind: "forbiddenMotion";
			from: { borrowed: true; third: "major" };
			interval: number;
			to: { borrowed: true };
			exceptWithin: readonly string[];
	  }
	| { kind: "dynamicsOrder"; source: "archetype" }
	| {
			kind: "borrowSubset";
			of: string;
			in: readonly string[];
			forbidIn: readonly string[];
	  }
);

/** ループの閉じ方（S3e で読む。段階 S1 では宣言だけ）。 */
export type SeamRecipe = {
	kind: "loop:halfCadence" | "loop:modal" | "stop:tonic" | "fade";
	finalBar?: string;
	copyArpFrom?: string;
	bassLeadingTone?: boolean;
	lastCompLen16?: number;
	color?: string;
};

/** 監査の軸の名前（`scripts/accomp/audit-accomp-variety.ts`）。 */
export type AuditAxis = string;

/** スタイル（§3.1）。役割 id の型 `R` は、fb では `AccompRole`（S3g で文字列にする）。 */
export type StylePack<R extends string = string> = {
	id: StyleId;
	/** 版。同じ `#compose` から同じ曲が出なくなる変更のたびに上げる（§2.5）。 */
	version: number;
	/** DAW の選択肢に出す名前。参考曲名・作者名を入れない（§4.3）。 */
	label: string;
	/** DAW の説明文。参考曲名・作者名を入れない。 */
	description: string;
	/** `references/<id>/` の承認した手書き試作だけ。採譜は使わない。 */
	provenance: readonly string[];
	key: {
		modes: W<string>;
		/** 段階 S1 のエンジンは `parallelMajorHome` だけ（`asIs` は S5）。 */
		minorPolicy: "parallelMajorHome" | "asIs";
	};
	/** いまは 4/4・16分の格子だけ。他の拍子はエンジンのコードが要る（§6）。 */
	meter: "4/4";
	layers: readonly LayerDef[];
	roles: Readonly<Record<R, RoleDef>>;
	archetypes: W<Archetype<R>>;
	harmony: {
		/** 句の表。キーは句の段の名前（段階 S1 のエンジンが名前で引く。S3f で `RoleDef.harmony` から引く）。 */
		pools: Readonly<Record<string, readonly Row<PhraseBody>[]>>;
		borrowSets: readonly Row<BorrowSetBody>[];
	};
	patterns: {
		arp: readonly Row<ArpCellBody>[];
		bass: readonly Row<BassPatternBody>[];
		comp: readonly Row<CompHitsBody>[];
	};
	/** S3a で読む（段階 S1 では宣言だけ）。 */
	compRules?: readonly CompRule[];
	constraints: readonly Constraint[];
	/** S3e で読む（段階 S1 では宣言だけ）。 */
	seam?: SeamRecipe;
	/** 切除対照（expect は制約 id）。段階 S1 ではまだ `scripts/test/check-compose-accomp.ts` にある。 */
	ablations?: readonly { mutate: string; expect: string }[];
	variety?: {
		/** 設計で固定する軸。合否から外し、値は表示する。 */
		fixed: readonly AuditAxis[];
		/** 一時的な不足。until の版を過ぎたら落とす。 */
		debt: readonly { axis: AuditAxis; until: number }[];
		/** `references/<id>/baseline.json`。 */
		baseline: string;
	};
};

/**
 * 計画に足す欄（§3.1 の `PlanPins`）。実現の段で決めたものを記録し、与えられたら実現の段はそれに従う。
 * `AccompPlan` と `AccompRegion`（`compose-accomp.ts`）に、省略可の欄として足してある。
 */
export type PlanPins = {
	style: StyleId;
	/** 強弱（`arc.levels`）の出どころもこれで決まる。 */
	archetype: string;
	/** `Mix.id`。 */
	mix: string;
	regions: { compHits?: readonly string[] }[];
};

// ============================================================
// 表を書くための道具（行の文字列の読み方）
// ============================================================

/** `references/<ref>.mml` の小節 a〜b（1 始まり、両端を含む）。 */
export const fromRef = (ref: string, a: number, b: number = a): Provenance => ({
	ref,
	bars: [a, b],
});

/** 変形で作った行（`op` は変形の名前、`parent` は元の行 id）。 */
export const derived = (
	op: string,
	parent: string,
	approved: boolean,
): Provenance => ({ op, parent, approved });

/** "0:2 2:1 | 0:2" → [[0,2],[2,1],[0,2]]（`|` は半小節の区切りで、読みやすさのためだけ）。 */
export const parseArpSteps = (id: string, text: string): ArpStep[] =>
	text
		.replace(/\|/g, " ")
		.trim()
		.split(/\s+/)
		.map((tok) => {
			const m = tok.match(/^(\d):(\d+)$/);
			if (!m) throw new Error(`ARP_CELLS ${id}: bad step "${tok}"`);
			return [Number(m[1]), Number(m[2])] as const;
		});

/** "R:6 5:2 8:4" → 低音の1小節。 */
export const parseBassSteps = (id: string, text: string): BassStep[] =>
	text
		.trim()
		.split(/\s+/)
		.map((tok) => {
			const m = tok.match(/^(R'|5'|5v|R|5|8|P|N|r):(\d+)$/);
			if (!m) throw new Error(`BASS_PATTERNS ${id}: bad step "${tok}"`);
			return [m[1] as BassTone, Number(m[2])] as const;
		});

/** "a:2 r:6 b:2 r:6" → 和音の打ち方の1小節（a = 1つめ、b = 2つめ、r = 休符）。 */
export const parseCompHits = (id: string, text: string): CompHit[] =>
	text
		.trim()
		.split(/\s+/)
		.map((tok) => {
			const m = tok.match(/^([abr]):(\d+)$/);
			if (!m) throw new Error(`COMP_HITS ${id}: bad hit "${tok}"`);
			const chord = m[1] === "a" ? 0 : m[1] === "b" ? 1 : -1;
			return [chord, Number(m[2])] as const;
		});

// ============================================================
// スキーマの検証（スタイルを読み込むときの検査。§4.3 の lint の一部）
// ============================================================

/**
 * スタイルの形を確かめる。空なら通る。**エンジンがそのスタイルを鳴らせるか**（段階 S1 のエンジンが
 * 前提にしている役割名・4層・型1つなど）は、ここではなく `compose-accomp-style.ts` が確かめる。
 *
 * 見るもの: id の文字・版・名前・出所／行 id の重複・重み・出所（`from`）／参照先の行（役割の質感の
 * セル・低音型・和音の打ち方、セルの `liftVariant`、低音型の `split`・`last`）／セル・低音型・打ち方の
 * 合計が16／型の並びの役割が `roles` にある・役割ごとの強弱と質感がある・参照計画の区間長／ミックスの
 * id の重複と、ミックスの層が `layers` にあること／層 id の重複／`ifRoleMissing`・タグの語彙。
 */
export const validateStylePack = (pack: StylePack): string[] => {
	const out: string[] = [];
	const bad = (s: string): void => {
		out.push(`${pack.id}: ${s}`);
	};
	if (!ACCOMP_STYLE_ID_RE.test(pack.id))
		bad(`スタイル id に使えない文字（/^[a-z0-9_-]+$/）`);
	if (!Number.isInteger(pack.version) || pack.version < 1)
		bad(`版は 1 以上の整数（${pack.version}）`);
	if (!pack.label.trim()) bad("label が空");
	if (!pack.description.trim()) bad("description が空");
	if (pack.provenance.length === 0) bad("provenance が空");
	if (pack.meter !== "4/4") bad(`拍子 ${pack.meter}`);

	const weights = (label: string, w: W<unknown>): void => {
		if (w.length === 0) bad(`${label}: 候補が無い`);
		for (const [, x] of w)
			if (!(x > 0) || !Number.isFinite(x)) bad(`${label}: 重み ${x}`);
	};
	const provenance = (label: string, p: Provenance | undefined): void => {
		if (!p) {
			bad(`${label}: 出所（from）が無い`);
			return;
		}
		if ("ref" in p) {
			if (!p.ref) bad(`${label}: 出所の ref が空`);
			if (!(p.bars[0] >= 1 && p.bars[1] >= p.bars[0]))
				bad(`${label}: 出所の小節 ${p.bars.join("〜")}`);
		} else if (!p.op || !p.parent) bad(`${label}: 変形の出所が空`);
	};
	const rows = <T>(label: string, list: readonly Row<T>[]): Set<string> => {
		const ids = new Set<string>();
		for (const r of list) {
			if (!r.id) bad(`${label}: id が空`);
			if (ids.has(r.id)) bad(`${label}: id ${r.id} が重複`);
			ids.add(r.id);
			if (!(r.weight > 0)) bad(`${label} ${r.id}: 重み ${r.weight}`);
			provenance(`${label} ${r.id}`, r.from);
		}
		return ids;
	};

	// 表
	for (const [name, list] of Object.entries(pack.harmony.pools)) {
		if (list.length === 0) bad(`句の表 ${name} が空`);
		rows(`句の表 ${name}`, list);
	}
	rows("借用の組", pack.harmony.borrowSets);
	const arpIds = rows("分散のセル", pack.patterns.arp);
	const bassIds = rows("低音型", pack.patterns.bass);
	const compIds = rows("和音の打ち方", pack.patterns.comp);
	const sum16 = (steps: readonly (readonly [unknown, number])[]): number =>
		steps.reduce((a, [, n]) => a + n, 0);
	for (const r of pack.patterns.arp) {
		if (sum16(r.body.steps) !== 16)
			bad(`分散のセル ${r.id}: 合計 ${sum16(r.body.steps)}（16 のはず）`);
		if (r.body.notes !== r.body.steps.length)
			bad(`分散のセル ${r.id}: notes ${r.body.notes}`);
		if (r.body.liftVariant && !arpIds.has(r.body.liftVariant))
			bad(`分散のセル ${r.id}: liftVariant ${r.body.liftVariant} が無い`);
	}
	for (const r of pack.patterns.bass) {
		for (const b of r.body.bars)
			if (sum16(b) !== 16) bad(`低音型 ${r.id}: 合計 ${sum16(b)}`);
		for (const k of ["split", "last"] as const) {
			const to = r.body[k];
			if (to && !bassIds.has(to)) bad(`低音型 ${r.id}: ${k} ${to} が無い`);
		}
		if (r.body.bars.length > 1 && !r.body.alternate)
			bad(`低音型 ${r.id}: 形が2つあるのに alternate が無い`);
	}
	for (const r of pack.patterns.comp) {
		for (const b of [...r.body.one, ...r.body.two, ...(r.body.late ?? [])])
			if (sum16(b) !== 16) bad(`和音の打ち方 ${r.id}: 合計 ${sum16(b)}`);
		if (r.body.two.length === 0) bad(`和音の打ち方 ${r.id}: two が無い`);
		if (
			(r.body.one.length > 1 || (r.body.late?.length ?? 0) > 1) &&
			!r.body.alternate
		)
			bad(`和音の打ち方 ${r.id}: 形が2つあるのに alternate が無い`);
	}

	// 層
	const layerIds = new Set<string>();
	for (const l of pack.layers) {
		if (layerIds.has(l.id)) bad(`層 ${l.id} が重複`);
		layerIds.add(l.id);
		if (!(l.window.lo < l.window.hi))
			bad(`層 ${l.id}: 窓 ${l.window.lo}〜${l.window.hi}`);
	}

	// 役割
	const roleIds = new Set(Object.keys(pack.roles));
	for (const [id, r] of Object.entries(pack.roles) as [string, RoleDef][]) {
		if (!r.label) bad(`役割 ${id}: label が空`);
		weights(`役割 ${id} の長さ`, r.lengths);
		for (const [n] of r.lengths)
			if (!r.supportedLengths.includes(n))
				bad(`役割 ${id}: 長さ ${n} が組める長さ（supportedLengths）に無い`);
		for (const n of r.supportedLengths)
			if (!(n > 0 && n % 4 === 0)) bad(`役割 ${id}: 組める長さ ${n}`);
		for (const t of r.tags)
			if (!ROLE_TAGS.includes(t)) bad(`役割 ${id}: 知らないタグ ${t}`);
		for (const [layer, band] of Object.entries(r.rate ?? {})) {
			if (!layerIds.has(layer)) bad(`役割 ${id}: rate の層 ${layer} が無い`);
			if (band && !(band[0] <= band[1])) bad(`役割 ${id}: rate ${band}`);
		}
	}

	// 制約
	const constraintIds = new Set<string>();
	for (const c of pack.constraints) {
		if (constraintIds.has(c.id)) bad(`制約 ${c.id} が重複`);
		constraintIds.add(c.id);
		if (c.ifRoleMissing !== "skip" && c.ifRoleMissing !== "fail")
			bad(`制約 ${c.id}: ifRoleMissing が無い`);
	}

	// 型
	weights("型", pack.archetypes);
	const archetypeIds = new Set<string>();
	for (const [a] of pack.archetypes) {
		const where = `型 ${a.id}`;
		if (archetypeIds.has(a.id)) bad(`${where} が重複`);
		archetypeIds.add(a.id);
		if (a.from.length === 0) bad(`${where}: 出所が無い`);
		for (const p of a.from) provenance(where, p);
		weights(`${where} のテンポ`, a.tempo);
		weights(`${where} の並び`, a.form);
		weights(`${where} のミックス`, a.mix);
		if (!(a.seconds.min > 0 && a.seconds.max >= a.seconds.min))
			bad(`${where}: 秒数 ${a.seconds.min}〜${a.seconds.max}`);
		const used = new Set<string>();
		for (const [form] of a.form)
			for (const role of form) {
				used.add(role);
				if (!roleIds.has(role)) bad(`${where}: 並びの役割 ${role} が無い`);
			}
		for (const role of used) {
			if (!(role in a.arc.levels)) bad(`${where}: ${role} の強弱が無い`);
			if (!(role in a.texture)) bad(`${where}: ${role} の質感が無い`);
			if (!(role in a.reference.lengths))
				bad(`${where}: ${role} の参照計画の区間長が無い`);
		}
		if (!roleIds.has(a.arc.order.peak) || !roleIds.has(a.arc.order.min))
			bad(`${where}: 山谷の役割が無い`);
		const mixIds = new Set<string>();
		for (const [m] of a.mix) {
			if (mixIds.has(m.id)) bad(`${where}: ミックス ${m.id} が重複`);
			mixIds.add(m.id);
			provenance(`${where} のミックス ${m.id}`, m.from);
			for (const layer of Object.keys(m.layers))
				if (!layerIds.has(layer))
					bad(`${where} のミックス ${m.id}: 層 ${layer} が無い`);
			for (const layer of layerIds)
				if (!(layer in m.layers))
					bad(`${where} のミックス ${m.id}: 層 ${layer} の楽器が無い`);
		}
		for (const [role, t] of Object.entries(a.texture) as [
			string,
			RoleTexture,
		][]) {
			const cellIds =
				t.cells.kind === "pool"
					? [...t.cells.pool.map(([id]) => id), t.cells.last]
					: t.cells.kind === "alternate"
						? [...t.cells.cells]
						: [];
			for (const id of cellIds)
				if (id !== undefined && !arpIds.has(id))
					bad(`${where} の ${role}: セル ${id} が無い`);
			if (t.cells.kind === "pool")
				weights(`${where} の ${role} のセル`, t.cells.pool);
			const bassRefs =
				t.bass.kind === "each"
					? [t.bass.id, t.bass.last]
					: t.bass.kind === "lead"
						? [t.bass.first, t.bass.rest]
						: [t.bass.first, t.bass.second, ...t.bass.middle.map(([id]) => id)];
			for (const id of bassRefs)
				if (id !== undefined && !bassIds.has(id))
					bad(`${where} の ${role}: 低音型 ${id} が無い`);
			if (!compIds.has(t.comp))
				bad(`${where} の ${role}: 和音の打ち方 ${t.comp} が無い`);
			weights(`${where} の ${role} の和音の段`, t.register);
		}
	}
	return out;
};
