/**
 * 自動作曲マクロ。シンプルモードの4トラック（メロディ／サブメロ／ベース／伴奏）へ
 * 16小節の曲を丸ごと組み立てる。
 *
 * ## 設計の根拠
 *
 * 「和音構成音を均等音価で並べる」素朴な自動生成は、**リズムが単調で機械的に聞こえる**。
 * この実装は、実際に人が聴いて評価した結果から逆算した次の基準を満たすように作ってある
 * （{@link ComposeStats} で毎回検算し、満たさない draw は引き直す）。
 *
 * - 音価は4種類以上を混在させる。メロディの音価のシャノンエントロピーが
 *   {@link MIN_ENTROPY_BITS} を下回るものは「単調」とみなして採用しない。
 * - 休符を全体の {@link MIN_REST_RATIO}〜{@link MAX_REST_RATIO} 程度入れる。
 * - **順番が本質**: ①コード進行を決める →②先に各小節のリズム型を、隣接小節で変化を
 *   つけて設計する →③その上に音を乗せる。
 * - **短いモチーフを1つ作り、変形で展開する**（反復／セクエンツ／オクターブ上げ）。
 * - **緩急**をつける。休符・ロングトーンの「緩」と16分音符の「急」を対比させる。
 *
 * ## 「どの曲も似ている」を潰すための設計
 *
 * 初版は品質基準こそ満たしていたが、**曲どうしの違い**が出ていなかった。300曲を生成して
 * 測ったところ、ベースの配置は1種類（全曲同一）、サブメロの配置も1種類、メロディの
 * 隣接音程は77%が2半音以内、16小節の役割配置は定数で固定——つまり「同じ設計図の上で
 * 音名だけが違う曲」を量産していた。そこで次を曲ごとの引きに変えてある。
 *
 * - **曲の骨格をランダムに組む**。{@link SECTION_FORMS} から4セクションぶんを引く。
 *   固定するのは「1小節目はモチーフ提示」「B部にクライマックスが1回」「16小節目は終止」
 *   の3点だけで、残りの配置は曲ごとに変わる。
 * - **メロディの書法を曲ごとに引く**（{@link MelodyStyle}）。走句の形・つなぎの形・
 *   ロングトーンの形・終止形・モチーフの原型・跳躍の混ぜ具合を、曲ごとに選び直す。
 * - **跳躍を積極的に使う**。順次進行だけのメロディは「歌いやすい」が「印象に残らない」。
 *   跳躍が隣接音程に占める比率を {@link MIN_LEAP_RATIO}〜{@link MAX_LEAP_RATIO} に収め、
 *   **跳躍の直後は反行の順次進行で埋める**（gap fill）という古典的な定石で歌える形に保つ。
 * - **サブメロを対旋律にする**。初版は和音構成音を1小節に1〜2個置くだけで、旋律と
 *   呼べる形をしていなかった。メロディと反行（contrary motion）する輪郭を持たせ、
 *   置き方も曲ごとに変える。ただし**単音・低密度・長音価**という形は崩さない——
 *   おまかせマスタリングの役割推定がこの3点でサブメロを判定するため。
 * - **ベースに奏法を持たせる**。ルート4分打ち固定をやめ、オルタネイト／ウォーキング／
 *   8分ドライブ／シンコペ等から曲ごとに引く。
 *
 * ## 強拍に何を置くか（重み3階層）
 *
 * 和音の構成音には重みがある（ルート・5度＝最重要／3度・7度＝重要／それ以外＝経過音）。
 * 強拍（小節頭と3拍目）では重みの高い音へ着地させ、弱拍は隣接音でつなぐ。
 * さらに**その瞬間の和音によって、同じ音でも重要度が変わる**。半音上に和音構成音が
 * 来るスケール音は「アボイドノート」として重み0とし、強拍・長い音価では使わない
 * （弱拍の経過音としてだけ通す）。{@link toneWeight} 参照。
 */

import { parseChord } from "@onjmin/chord-parser";
import { type ChordPatternType, spelledToUnits } from "./chords";
import { UNITS_PER_SEMITONE, type Units } from "./tuning";

// ============================================================
// 品質基準（{@link ComposeStats} の受け入れ条件）
// ============================================================

/** メロディの音価のシャノンエントロピー下限（bit）。これを下回ると単調と判定する。 */
const MIN_ENTROPY_BITS = 1.1;
/** メロディの音価の種類数の下限。 */
const MIN_VALUE_KINDS = 4;
/** 休符が占めるステップ比率の下限・上限。 */
const MIN_REST_RATIO = 0.03;
const MAX_REST_RATIO = 0.08;
/** 順次進行とみなす音程の上限（半音）。これを超えるものを「跳躍」と数える。 */
const STEP_SEMITONES = 2;
/**
 * 許す跳躍の上限（半音）。長6度まで。初版はここが5（完全4度）で、しかも跳躍を
 * ほとんど作らない書き方だったため、全曲が音階の上をうろつくだけになっていた。
 * クライマックスのオクターブ跳躍だけはこの制限を受けない。
 */
const MAX_LEAP_SEMITONES = 9;
/** 小節をまたぐときに許す跳躍（半音）。 */
const MAX_BAR_LEAP_SEMITONES = 9;
/**
 * 跳躍が隣接音程に占める比率。低すぎると「のっぺり」、高すぎると「歌えない」。
 * 実測で77%が2半音以内だった初版は、この下限にまるで届いていなかった。
 */
const MIN_LEAP_RATIO = 0.08;
const MAX_LEAP_RATIO = 0.32;
/** メロディが使う音域（半音）の下限。1オクターブは動かす。 */
const MIN_MELODY_RANGE = 12;
/** サブメロが使う音域（半音）の下限。0 だと「同じ音を置いただけ」になる。 */
const MIN_SUBMELODY_RANGE = 5;
/** 基準を満たす draw が出るまでの再試行回数。 */
const MAX_ATTEMPTS = 80;

// ============================================================
// 音価（1小節 = stepsPerBar。既定192ステップ ＝ 4分音符48ステップ）
// ============================================================

/** 1小節を192ステップとしたときの音価。実際の stepsPerBar に合わせて比率で伸縮する。 */
const BASE_STEPS_PER_BAR = 192;
const WHOLE = 192;
const DOT_HALF = 144;
const HALF = 96;
const DOT_QUARTER = 72;
const QUARTER = 48;
const EIGHTH = 24;
const SIXTEENTH = 12;

/** 曲の長さ。A(4) - A'(4) - B(4) - A''(4) の16小節。 */
const BARS = 16;

// ============================================================
// 音階
// ============================================================

/**
 * ダイアトニック音階の1オクターブ分。`semi` は主音からの半音、`fifth` は五度圏
 * インデックス（綴りを保持するために持つ。31平均律で増4度と減5度を区別するのに要る）。
 */
type ScaleDegree = { semi: number; fifth: number };

/** ハ長調（イ短調も同じ音の集合で、主音の取り方だけが違う）。 */
const MAJOR_SCALE: ScaleDegree[] = [
	{ semi: 0, fifth: 0 }, // C
	{ semi: 2, fifth: 2 }, // D
	{ semi: 4, fifth: 4 }, // E
	{ semi: 5, fifth: -1 }, // F
	{ semi: 7, fifth: 1 }, // G
	{ semi: 9, fifth: 3 }, // A
	{ semi: 11, fifth: 5 }, // B
];

/**
 * 音階の度数 → 綴り付きの音。`degree` はオクターブを跨いで連続する整数
 * （7 で1オクターブ上、-1 で1つ下）。
 */
const degreeToPitch = (degree: number): ScaleDegree => {
	const index = ((degree % 7) + 7) % 7;
	const octave = Math.floor(degree / 7);
	const d = MAJOR_SCALE[index];
	return { semi: d.semi + octave * 12, fifth: d.fifth };
};

/** 半音 → 音階の度数（最も近い構成音）。順次進行の起点を探すのに使う。 */
const semitoneToDegree = (semi: number): number => {
	const octave = Math.floor(semi / 12);
	const within = semi - octave * 12;
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < MAJOR_SCALE.length; i++) {
		const dist = Math.abs(MAJOR_SCALE[i].semi - within);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return octave * 7 + best;
};

/** 音階上を `delta` 度動かす（半音でなく度数で動かすのでスケールから外れない）。 */
const walk = (semi: number, delta: number): number =>
	degreeToPitch(semitoneToDegree(semi) + delta).semi;

// ============================================================
// コード進行
// ============================================================

/**
 * A部（1〜4小節）の候補。三和音だけの単純ループを避けるため、どれかに7th か
 * セカンダリドミナントを含めてある。ハ長調／イ短調から動かさないのは、初心者モードの
 * ボタン1つで押される機能だからで、調が要るなら後からマクロの「移調」で動かせる。
 */
const SECTION_A_PROGRESSIONS: string[][] = [
	["C", "G", "Am", "Em7"], // カノン進行の前半
	["C", "Am", "Dm7", "G7"], // 1-6-2-5
	["F", "G", "Em7", "Am"], // 王道進行
	["C", "E7", "Am", "Am7"], // セカンダリドミナントでAmを強調
	["Am", "F", "C", "G"], // 小室進行（イ短調寄り）
	["Am", "Dm7", "G7", "CM7"], // マイナーからの循環
	["C", "CM7", "F", "G"], // トニック保続からサブドミナントへ
	["C", "G", "Am", "F"], // 4536の並べ替え
	["Am", "Em", "F", "G"], // マイナーの順次感
	["C", "Em7", "F", "G7"], // 1-3-4-5
	["F", "Em7", "Dm7", "C"], // ベース下行
	["Am", "G", "F", "E7"], // 下行クリシェ → ドミナント
	["C", "A7", "Dm7", "G7"], // 循環（セカンダリドミナント入り）
	["Am", "C", "F", "G"], // マイナー始まりの4536
	["FM7", "G7", "CM7", "Am7"], // ジャズ寄りの2-5-1
	["Dm7", "G7", "Em7", "Am7"], // 2-5-3-6
];

/** B部（9〜12小節）の候補。A部と質感を変えるため、必ず別の進行から引く。 */
const SECTION_B_PROGRESSIONS: string[][] = [
	["F", "G", "Em7", "Am"],
	["Dm7", "G7", "CM7", "A7"],
	["F", "Bm7-5", "E7", "Am"],
	["FM7", "G", "Am", "D7"],
	["Dm7", "E7", "Am", "A7"],
	["F", "G", "C", "Am"],
	["FM7", "Em7", "Dm7", "G7"],
	["Bm7-5", "E7", "Am", "A7"],
	["F", "C", "Dm7", "E7"],
	["Dm7", "A7", "Dm7", "G7"],
	["FM7", "E7", "Am", "G7"],
	["Am7", "D7", "Dm7", "G7"], // ドッペルドミナント
];

/**
 * A'（5〜8小節）の作り方。A部を土台に末尾だけドミナントへ差し替えて
 * 「まだ続く」感じを出す。**必ず G か G7 で終える**（半終止）。
 */
const SECTION_A2_DERIVATIONS: ((a: string[]) => string[])[] = [
	(a) => [a[0], a[1], a[2], "G7"],
	(a) => [a[0], a[1], "Dm7", "G7"],
	(a) => [a[0], a[1], a[2], "G"],
	(a) => [a[0], "F", "Dm7", "G7"],
	(a) => [a[0], a[2], "Am7", "G7"],
];

/**
 * A''（13〜16小節）の作り方。**必ず主音（C か Am）へ着地させる**（全終止）。
 * `tonic` は A部の始まりが Am 系かどうかで決める。
 */
const SECTION_A3_DERIVATIONS: ((a: string[], tonic: string) => string[])[] = [
	(a, t) => [a[0], a[1], "G7", t],
	(a, t) => [a[0], "Dm7", "G7", t],
	(a, t) => [a[0], "F", "G7", t],
	(a, t) => [a[0], a[1], "Em7", t],
	(a, t) => [a[0], "FM7", "G7", t],
];

/** 伴奏の奏法。曲ごとにランダムに引く。 */
const CHORD_PATTERNS: ChordPatternType[] = [
	"block",
	"arpeggio",
	"offbeat",
	"yatsume",
	"alternating",
];

/**
 * 和音構成音の重み。ルートからの音程（半音）で引く。
 * ルート・5度が最重要、3度・7度が重要、それ以外（テンション・経過音）は一般。
 */
const CHORD_TONE_WEIGHT: Record<number, number> = {
	0: 3, // ルート
	7: 3, // 完全5度
	3: 2, // 短3度
	4: 2, // 長3度
	10: 2, // 短7度
	11: 2, // 長7度
	6: 1, // 減5度（ハーフディミニッシュ等）
	8: 1, // 増5度
};

/** コード1つ分の構成音（綴り付き・重み付き）。 */
type ChordTone = ScaleDegree & { weight: number };

/** コード名 → 構成音。パースできない名前は空配列を返す（呼び出し側でスキップ）。 */
const chordTones = (name: string): ChordTone[] => {
	try {
		const parsed = parseChord(name);
		const root = parsed.notes[0] ?? 0;
		return parsed.notes.map((semi, i) => ({
			semi,
			fifth: parsed.noteFifths[i],
			weight: CHORD_TONE_WEIGHT[(((semi - root) % 12) + 12) % 12] ?? 1,
		}));
	} catch {
		return [];
	}
};

const pitchClass = (semi: number): number => ((semi % 12) + 12) % 12;

/**
 * **その瞬間の和音における、ある音の重要度**。同じ音でも和音が変われば重みが変わる、
 * というのがこの関数の要点。
 *
 * - 和音構成音 … {@link CHORD_TONE_WEIGHT} の重み（3=ルート・5度／2=3度・7度／1=その他）
 * - アボイドノート … **0**。半音上に和音構成音があるスケール音のこと（C の上の F など）。
 *   強拍や長い音価で鳴らすと和音の響きを濁すので、弱拍の経過音としてしか通さない。
 * - それ以外のスケール音 … 1（経過音として自由に使える）
 */
const toneWeight = (semi: number, tones: ChordTone[]): number => {
	const pc = pitchClass(semi);
	for (const t of tones) if (pitchClass(t.semi) === pc) return t.weight;
	const above = (pc + 1) % 12;
	for (const t of tones) if (pitchClass(t.semi) === above) return 0;
	return 1;
};

// ============================================================
// リズム型
// ============================================================

/**
 * 1小節分のリズム型。正の数が音、負の数が休符（絶対値がステップ数）。合計は必ず1小節。
 * `density` は緩急の設計に使う——`sparse`（ロングトーン・休符主体）と `dense`（16分の走句）を
 * 曲の中で必ず対比させ、`medium` でつなぐ。
 */
type RhythmCell = { value: number[]; density: "sparse" | "medium" | "dense" };

const RHYTHM_CELLS: RhythmCell[] = [
	// --- 緩: ロングトーン・休符主体 ---
	{ value: [WHOLE], density: "sparse" },
	{ value: [DOT_HALF, QUARTER], density: "sparse" },
	{ value: [HALF, HALF], density: "sparse" },
	{ value: [HALF, QUARTER, -QUARTER], density: "sparse" },
	{ value: [DOT_HALF, -QUARTER], density: "sparse" },
	{ value: [QUARTER, DOT_HALF], density: "sparse" },
	{ value: [-QUARTER, DOT_HALF], density: "sparse" },
	{ value: [HALF, -QUARTER, QUARTER], density: "sparse" },
	// --- 中: 4分・8分が主体 ---
	{ value: [QUARTER, QUARTER, HALF], density: "medium" },
	{ value: [HALF, QUARTER, QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, HALF], density: "medium" },
	{ value: [QUARTER, EIGHTH, EIGHTH, HALF], density: "medium" },
	{ value: [QUARTER, QUARTER, EIGHTH, EIGHTH, QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, QUARTER, DOT_QUARTER, EIGHTH], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, QUARTER, -QUARTER], density: "medium" },
	{ value: [QUARTER, -EIGHTH, EIGHTH, QUARTER, QUARTER], density: "medium" },
	{ value: [EIGHTH, QUARTER, EIGHTH, HALF], density: "medium" }, // 頭抜きシンコペ
	{ value: [DOT_QUARTER, DOT_QUARTER, QUARTER], density: "medium" }, // 3+3+2
	{ value: [QUARTER, DOT_QUARTER, EIGHTH, QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, HALF], density: "medium" },
	{ value: [HALF, EIGHTH, EIGHTH, QUARTER], density: "medium" },
	{ value: [-EIGHTH, EIGHTH, QUARTER, QUARTER, QUARTER], density: "medium" },
	// --- 急: 16分の走句を含む ---
	{
		value: [SIXTEENTH, SIXTEENTH, SIXTEENTH, SIXTEENTH, QUARTER, HALF],
		density: "dense",
	},
	{
		value: [EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH, QUARTER, QUARTER],
		density: "dense",
	},
	{
		value: [
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			HALF,
		],
		density: "dense",
	},
	{
		value: [QUARTER, SIXTEENTH, SIXTEENTH, SIXTEENTH, SIXTEENTH, HALF],
		density: "dense",
	},
	{
		value: [HALF, SIXTEENTH, SIXTEENTH, SIXTEENTH, SIXTEENTH, QUARTER],
		density: "dense",
	},
	{
		value: [
			EIGHTH,
			EIGHTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			QUARTER,
			QUARTER,
		],
		density: "dense",
	},
	{
		value: [
			SIXTEENTH,
			SIXTEENTH,
			EIGHTH,
			SIXTEENTH,
			SIXTEENTH,
			EIGHTH,
			QUARTER,
			QUARTER,
		],
		density: "dense",
	},
];

/**
 * モチーフに使うリズム型。5音前後で、音価に変化があり、覚えやすい形のものだけを選ぶ
 * （モチーフは「そのまま反復して記憶に残す」のが仕事なので、走句のような流れる形は不向き）。
 */
const MOTIF_CELLS: RhythmCell[] = [
	{ value: [QUARTER, EIGHTH, EIGHTH, QUARTER, QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, DOT_QUARTER, EIGHTH, QUARTER], density: "medium" },
	{ value: [QUARTER, QUARTER, EIGHTH, EIGHTH, QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, QUARTER, EIGHTH, EIGHTH], density: "medium" },
	{
		value: [EIGHTH, EIGHTH, QUARTER, QUARTER, -EIGHTH, EIGHTH],
		density: "medium",
	},
	{ value: [DOT_QUARTER, DOT_QUARTER, EIGHTH, EIGHTH], density: "medium" },
	{ value: [EIGHTH, QUARTER, EIGHTH, QUARTER, QUARTER], density: "medium" },
	{ value: [QUARTER, EIGHTH, EIGHTH, HALF], density: "medium" },
	{
		value: [-EIGHTH, EIGHTH, QUARTER, EIGHTH, EIGHTH, QUARTER],
		density: "medium",
	},
	{ value: [HALF, EIGHTH, EIGHTH, QUARTER], density: "medium" },
];

// ============================================================
// 曲の骨格
// ============================================================

/**
 * 各小節の役割。
 *
 * - `motif` … モチーフの原形。反復して記憶に残す。
 * - `sequence` … モチーフを音程ごと上下にずらす（セクエンツ）。
 * - `climax` … モチーフを1オクターブ上げる。曲中で唯一の大跳躍を許す場所。
 * - `step` … 順次進行と小さな跳躍でつなぐ。
 * - `run` … 16分の走句（急）。
 * - `hold` … ロングトーン・休符（緩）。
 * - `cadence` … 主音へ着地して終わる。
 */
type BarRole =
	| "motif"
	| "sequence"
	| "climax"
	| "step"
	| "run"
	| "hold"
	| "cadence";

/**
 * 4小節セクションの型。初版はこれが16小節ぶんの定数1本だったため、
 * **全曲がまったく同じドラマ展開**になっていた。曲ごとに引き直す。
 *
 * 固定するのは3点だけ——1小節目あたりでモチーフを提示する、B部にクライマックスが1回、
 * 16小節目は終止。これらは「曲として成立させる」ための最低条件で、
 * ここまでランダムにすると構成が破綻する。
 */
const SECTION_FORMS: Record<"a" | "a2" | "b" | "a3", BarRole[][]> = {
	a: [
		["motif", "step", "sequence", "step"],
		["motif", "motif", "sequence", "hold"],
		["motif", "run", "sequence", "step"],
		["motif", "step", "motif", "run"],
		["motif", "hold", "sequence", "run"],
		["motif", "step", "step", "sequence"],
		["motif", "sequence", "step", "hold"],
	],
	a2: [
		["motif", "run", "sequence", "hold"],
		["motif", "step", "run", "hold"],
		["sequence", "motif", "run", "hold"],
		["motif", "run", "step", "hold"],
		["motif", "sequence", "run", "step"],
		["sequence", "step", "motif", "run"],
	],
	b: [
		["climax", "run", "step", "hold"],
		["climax", "step", "run", "hold"],
		["climax", "sequence", "run", "hold"],
		["climax", "run", "sequence", "step"],
		["hold", "climax", "run", "step"],
		["step", "climax", "run", "hold"],
		["climax", "hold", "run", "sequence"],
	],
	a3: [
		["motif", "step", "run", "cadence"],
		["motif", "sequence", "step", "cadence"],
		["motif", "run", "step", "cadence"],
		["motif", "step", "hold", "cadence"],
		["motif", "motif", "run", "cadence"],
		["sequence", "motif", "step", "cadence"],
	],
};

// ============================================================
// メロディの書法（曲ごとに引く）
// ============================================================

/** 走句（`run`）の形。初版は「音階を一直線に上る／下る」しか無かった。 */
type RunShape = "scale" | "turn" | "broken" | "zigzag";
/** つなぎ（`step`）の形。初版は「±1のコイントス」＝方向性のない酔歩だった。 */
type StepShape = "arch" | "valley" | "ascend" | "descend" | "wave" | "pivot";
/** ロングトーン（`hold`）の形。初版は同じ音の据え置きだけ。 */
type HoldShape = "long" | "third" | "neighbor";
/** 終止（`cadence`）の形。初版は「順次下降して主音」だけで、全曲の最後が同じ形だった。 */
type CadenceShape = "descend" | "five-three-one" | "leap-up" | "hold-tonic";
/** ベースの奏法。初版はルート4分打ちの1種類しか無かった。 */
type BassStyle =
	| "quarter"
	| "alternate"
	| "half"
	| "eighth"
	| "syncopated"
	| "walking"
	| "octave";
/** サブメロの置き方。初版は「小節を等分して1〜2音」の1種類しか無かった。 */
type SubStyle = "pad" | "half" | "answer" | "long-short" | "anticipate";

/**
 * モチーフの原型（音階の度数差の列）。初版はここが「±1／±2 の乱数の累積」だったため、
 * どの曲のモチーフも似た形の酔歩になっていた。**輪郭に名前が付く形**を並べておき、
 * 曲ごとに1本引く。
 */
const MOTIF_ARCHETYPES: number[][] = [
	[0, 1, 2, 3, 2], // 上行して一歩戻る
	[0, -1, -2, -3, -2], // 下行して一歩戻る
	[0, 2, 1, 0, -1], // 跳ねてから埋める
	[0, 4, 3, 2, 1], // 5度上へ跳んで順次下降（gap fill の教科書形）
	[0, -4, -3, -2, -1], // 下へ跳んで順次上行
	[0, 0, 1, 2, 1], // 同音反復から動き出す
	[0, 1, 0, -1, 0], // 軸音まわりの揺れ
	[0, 2, 4, 3, 2], // 分散和音風の上行
	[0, -2, -1, 1, 0], // 沈んでから跳ね上がる
	[0, 3, 2, 4, 3], // 二段跳び
	[0, 1, 3, 2, 0], // アーチ
	[0, -1, 1, -2, 0], // ジグザグ
	[0, 5, 4, 2, 0], // 6度跳躍からの大きな下降
	[0, 0, -1, -3, -2], // 反復してから落ちる
];

// ============================================================
// 入出力
// ============================================================

export type ComposedNote = {
	startStep: number;
	pitchUnits: Units;
	durationSteps: number;
	velocity: number;
};

/** 生成結果の検算値。{@link composeSong} が基準を満たすまで引き直すのに使う。 */
export type ComposeStats = {
	/** メロディの音価の種類数。 */
	valueKinds: number;
	/** メロディの音価のシャノンエントロピー（bit）。 */
	entropy: number;
	/** 休符が占めるステップの比率。 */
	restRatio: number;
	/** クライマックスを除く隣接音の最大跳躍（半音）。 */
	maxLeapSemitones: number;
	/** 隣接音程のうち跳躍（3半音以上）が占める比率。低すぎると「のっぺり」。 */
	leapRatio: number;
	/** メロディが使った音域（半音）。 */
	melodyRange: number;
	/** サブメロが使った音域（半音）。小さいと旋律になっていない。 */
	submelodyRange: number;
	/** 実際に採用されるまでに引き直した回数。 */
	attempts: number;
};

export type ComposeOptions = {
	/** 1小節のステップ数。DAW の renderConfig.stepsPerBar をそのまま渡す。 */
	stepsPerBar: number;
	/** 曲の音律。省略時は12平均律。 */
	edo?: number;
	/** 乱数源。テストから決定的な値を注入するために差し替えられる。 */
	random?: () => number;
};

export type ComposeResult = {
	/** 伴奏トラック用のコード進行文字列。`buildChordPlacements` へそのまま渡せる。 */
	chordProgression: string;
	/** 伴奏の奏法。 */
	chordPattern: ChordPatternType;
	melody: ComposedNote[];
	submelody: ComposedNote[];
	bass: ComposedNote[];
	stats: ComposeStats;
};

// ============================================================
// 生成
// ============================================================

const pick = <T>(items: T[], rnd: () => number): T =>
	items[Math.floor(rnd() * items.length)];

/** 音価のシャノンエントロピー（bit）。全部同じ音価なら 0 になる。 */
export const durationEntropy = (durations: number[]): number => {
	if (durations.length === 0) return 0;
	const counts = new Map<number, number>();
	for (const d of durations) counts.set(d, (counts.get(d) ?? 0) + 1);
	let entropy = 0;
	for (const c of counts.values()) {
		const p = c / durations.length;
		entropy -= p * Math.log2(p);
	}
	return entropy;
};

/**
 * 指定の高さに最も近い和音構成音を返す。`minWeight` を上げると重要な構成音
 * （強拍で着地させたいルート・5度）だけに絞れる。
 */
const nearestChordTone = (
	targetSemi: number,
	tones: ChordTone[],
	minWeight: number,
): ScaleDegree => {
	const candidates = tones.filter((t) => t.weight >= minWeight);
	const pool = candidates.length > 0 ? candidates : tones;
	let best: ScaleDegree = pool[0];
	let bestDist = Number.POSITIVE_INFINITY;
	for (const tone of pool) {
		// 構成音は C からの絶対半音なので、オクターブを動かして目標に寄せる
		const base = pitchClass(tone.semi);
		for (let oct = 0; oct <= 10; oct++) {
			const semi = base + oct * 12;
			const dist = Math.abs(semi - targetSemi);
			if (dist < bestDist) {
				bestDist = dist;
				best = { semi, fifth: tone.fifth };
			}
		}
	}
	return best;
};

/** メロディの音域（半音・MIDIノート番号相当）。C4〜C6あたりに収める。 */
const MELODY_LOW = 60;
const MELODY_HIGH = 84;
/** サブメロの音域。メロディの下・ベースの上に置く。 */
const SUBMELODY_LOW = 55;
const SUBMELODY_HIGH = 74;
/**
 * ベースの音域。**平均音高が C3(48) を下回るようにする**——おまかせマスタリングの
 * 役割推定がこのしきい値でベースを判定するため、ここを外すと楽器が当たらなくなる。
 */
const BASS_LOW = 33;
const BASS_HIGH = 45;

const clampSemi = (semi: number, low: number, high: number): number => {
	let s = semi;
	while (s < low) s += 12;
	while (s > high) s -= 12;
	return s;
};

/** 1音ぶんの置き場所。リズムが先に決まっているので、音はここへ乗せるだけ。 */
type Slot = { isStrong: boolean; value: number; at: number };

/** 曲ごとに引くメロディの書法。ここが曲どうしの違いの主な出どころ。 */
type MelodyStyle = {
	runShape: RunShape;
	stepShape: StepShape;
	holdShape: HoldShape;
	cadenceShape: CadenceShape;
	/** 弱拍で跳躍を混ぜる確率。 */
	leapAffinity: number;
	/** 強拍で着地させる構成音の重み下限（3=ルート/5度のみ、2=3度/7度も許す）。 */
	barHeadWeight: 2 | 3;
	bassStyle: BassStyle;
	subStyle: SubStyle;
	/** サブメロがメロディから何半音下を歌うか。 */
	subInterval: number;
};

/**
 * 1小節分の「音の並び（度数）」を、役割と書法から作る。
 * ここではまだ音域も跳躍制限も見ない——形を作るのが仕事で、
 * 整えるのは {@link shapeBar} の役目。
 */
const barDegrees = (
	role: BarRole,
	slots: Slot[],
	tones: ChordTone[],
	style: MelodyStyle,
	motifContour: number[],
	startDegree: number,
	/** 直前の小節もモチーフだったときにずらす度数。同じ小節が2つ並ぶのを避ける。 */
	repeatShift: number,
	rnd: () => number,
): number[] => {
	const noteCount = slots.length;
	const out: number[] = [];

	if (role === "motif" || role === "sequence" || role === "climax") {
		// モチーフの輪郭をそのまま乗せる。sequence は音程ごとずらし、climax は
		// 1オクターブ上げる——「同じ型に別の音を当てはめる」のではなく
		// 「同じアイデアを別の文脈で置き直す」のが狙い。
		const shift =
			(role === "sequence"
				? pick([-2, -1, 1, 2, 3], rnd)
				: role === "climax"
					? 7
					: 0) + repeatShift;
		for (let i = 0; i < noteCount; i++)
			out.push(startDegree + shift + motifContour[i % motifContour.length]);
		return out;
	}

	if (role === "run") {
		// 走句。密度を上げる場所なので、形の違いがそのまま曲の表情の違いになる。
		const dir = rnd() < 0.5 ? 1 : -1;
		if (style.runShape === "scale") {
			for (let i = 0; i < noteCount; i++) out.push(startDegree + dir * i);
		} else if (style.runShape === "turn") {
			// 上って折り返す（またはその逆）。走句が一直線に飛んでいかない。
			const peak = Math.ceil(noteCount / 2);
			for (let i = 0; i < noteCount; i++)
				out.push(startDegree + dir * (i < peak ? i : peak * 2 - i - 1));
		} else if (style.runShape === "broken") {
			// 分散和音の走句。3度・4度の跳躍が並ぶので順次進行の走句と質感が変わる。
			const arp = tones
				.map((t) => semitoneToDegree(clampSemi(t.semi, 60, 71)))
				.sort((a, b) => a - b);
			for (let i = 0; i < noteCount; i++) {
				const oct = Math.floor(i / arp.length) * 7;
				const idx =
					dir > 0 ? i % arp.length : arp.length - 1 - (i % arp.length);
				out.push(arp[idx] + dir * oct);
			}
		} else {
			// ジグザグ。2つ進んで1つ戻る。
			let d = 0;
			for (let i = 0; i < noteCount; i++) {
				out.push(startDegree + dir * d);
				d += i % 3 === 2 ? -1 : 1;
			}
		}
		return out;
	}

	if (role === "hold") {
		for (let i = 0; i < noteCount; i++) {
			if (style.holdShape === "long") out.push(startDegree);
			// 3度下がって受け止める。ロングトーンでも動きが1つ入る。
			else if (style.holdShape === "third")
				out.push(startDegree - (i === 0 ? 0 : 2));
			// 刺繍音。上隣へ寄って戻る。
			else out.push(startDegree + (i % 3 === 1 ? 1 : 0));
		}
		return out;
	}

	if (role === "cadence") {
		// 終止。主音（C）へ着地するのは共通で、そこへ至る形を曲ごとに変える。
		const tonic = semitoneToDegree(clampSemi(72, MELODY_LOW, MELODY_HIGH));
		for (let i = 0; i < noteCount; i++) {
			if (style.cadenceShape === "descend") {
				out.push(tonic + noteCount - 1 - i);
			} else if (style.cadenceShape === "five-three-one") {
				// ソ→ミ→ド。分散和音で降りる古典的な終止。
				const shape = [4, 2, 0];
				out.push(tonic + shape[Math.min(i, shape.length - 1)]);
			} else if (style.cadenceShape === "leap-up") {
				// 下からソ→ドへ跳ね上がって終わる。
				out.push(i === noteCount - 1 ? tonic : tonic - 7 + Math.min(i, 4));
			} else {
				// 主音のロングトーン。手前に刺繍音を1つだけ置く。
				out.push(i === 0 && noteCount > 1 ? tonic + 1 : tonic);
			}
		}
		return out;
	}

	// step: つなぎ。曲の半分近くを占めるので、ここが酔歩だと曲全体が凡庸になる。
	// 「どう動くか」の形（アーチ／下降／揺れ等）を曲ごとに決めてたどる。
	const span = pick([2, 3, 4], rnd);
	const dir =
		style.stepShape === "descend"
			? -1
			: style.stepShape === "ascend"
				? 1
				: rnd() < 0.5
					? 1
					: -1;
	for (let i = 0; i < noteCount; i++) {
		const t = noteCount === 1 ? 0 : i / (noteCount - 1);
		let d: number;
		switch (style.stepShape) {
			case "arch":
				d = Math.round(Math.sin(t * Math.PI) * span);
				break;
			case "valley":
				d = -Math.round(Math.sin(t * Math.PI) * span);
				break;
			case "ascend":
			case "descend":
				d = Math.round(t * span) * dir;
				break;
			case "wave":
				d = Math.round(Math.sin(t * Math.PI * 2) * span) * dir;
				break;
			default: // pivot: 軸音のまわりを行き来する
				d = [0, 1, 0, -1, 0, 2][i % 6];
				break;
		}
		out.push(startDegree + d);
	}

	// 強拍は和音の重要構成音へ着地させる。ここで初めて「和音の上に乗った」音になる。
	for (let i = 0; i < out.length; i++) {
		if (!slots[i].isStrong) continue;
		out[i] = semitoneToDegree(
			nearestChordTone(degreeToPitch(out[i]).semi, tones, style.barHeadWeight)
				.semi,
		);
	}

	// 弱拍に跳躍を混ぜる。跳躍のないメロディは歌いやすいが印象に残らない。
	// 直後は {@link shapeBar} の gap fill が反行の順次進行で埋める。
	for (let i = 1; i < out.length - 1; i++) {
		if (rnd() >= style.leapAffinity) continue;
		if (slots[i].isStrong) continue;
		out[i] = out[i - 1] + pick([-4, -3, -2, 2, 3, 4], rnd);
	}
	return out;
};

/**
 * 度数の列を、実際に鳴らせる音の列へ整える。
 *
 * 1. 音域へ畳み込む
 * 2. 小節またぎ／小節内の跳躍を上限で抑える
 * 3. **跳躍の直後は反行の順次進行で埋める**（gap fill）
 * 4. 強拍・長い音価にアボイドノートが来たら隣のスケール音へ逃がす
 */
const shapeBar = (
	degrees: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	opts: { allowLeap: boolean; allowArpeggio: boolean; quarterSteps: number },
): number[] => {
	const out: number[] = [];
	let prev = prevSemi;
	for (let i = 0; i < degrees.length; i++) {
		let semi = clampSemi(
			degreeToPitch(degrees[i]).semi,
			MELODY_LOW,
			MELODY_HIGH,
		);
		const limit = i === 0 ? MAX_BAR_LEAP_SEMITONES : MAX_LEAP_SEMITONES;
		if (!opts.allowLeap && Math.abs(semi - prev) > limit) {
			semi = clampSemi(
				walk(prev, Math.sign(semi - prev) * 3),
				MELODY_LOW,
				MELODY_HIGH,
			);
		}
		// gap fill: 直前が跳躍なら、この音は反行の順次進行で埋める
		if (
			!opts.allowArpeggio &&
			i >= 2 &&
			Math.abs(out[i - 1] - out[i - 2]) > STEP_SEMITONES
		) {
			const back = -Math.sign(out[i - 1] - out[i - 2]);
			semi = clampSemi(walk(out[i - 1], back), MELODY_LOW, MELODY_HIGH);
		}
		// アボイドノートは強拍・長い音では鳴らさない。逃がす先は上下どちらでもよいが、
		// **直前と同じ音になる方は選ばない**——ここで同音へ潰すと、せっかく作った
		// モチーフの輪郭が「同じ音の連打」に化ける（実測で同音反復が16%まで膨らんだ）。
		if (
			toneWeight(semi, tones) === 0 &&
			(slots[i].isStrong || slots[i].value >= opts.quarterSteps)
		) {
			const up = clampSemi(walk(semi, 1), MELODY_LOW, MELODY_HIGH);
			const down = clampSemi(walk(semi, -1), MELODY_LOW, MELODY_HIGH);
			const score = (s: number) =>
				toneWeight(s, tones) * 2 + (i > 0 && s === prev ? -3 : 0);
			semi = score(down) >= score(up) ? down : up;
		}
		out.push(semi);
		prev = semi;
	}
	return out;
};

/** 1回分の draw。基準を満たすかは呼び出し側が {@link ComposeStats} で判定する。 */
const draw = (
	options: ComposeOptions,
	rnd: () => number,
): Omit<ComposeResult, "stats"> & {
	melodyDurations: number[];
	restSteps: number;
	totalSteps: number;
	maxLeap: number;
	leapRatio: number;
	melodyRange: number;
	submelodyRange: number;
} => {
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	// 音価は192ステップ基準で書いてあるので、実際の stepsPerBar へ比率で写す。
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);
	const quarterSteps = scaleStep(QUARTER);
	const strongStep = Math.max(1, Math.round(stepsPerBar / 2));

	// --- ①コード進行を決める ---
	const progA = pick(SECTION_A_PROGRESSIONS, rnd);
	// B部はA部と質感を変えるのが役目なので、同じ進行を引いたら引き直す。
	const progBPool = SECTION_B_PROGRESSIONS.filter(
		(p) => p.join("|") !== progA.join("|"),
	);
	const progB = pick(progBPool, rnd);
	const tonic = progA[0].startsWith("Am") ? "Am" : "C";
	const progA2 = pick(SECTION_A2_DERIVATIONS, rnd)(progA);
	const progA3 = pick(SECTION_A3_DERIVATIONS, rnd)(progA, tonic);
	const progression = [...progA, ...progA2, ...progB, ...progA3];
	const chordProgression = progression.join("|");
	const chordPattern = pick(CHORD_PATTERNS, rnd);

	// --- 曲の骨格と書法を引く（ここが曲どうしの違いの出どころ） ---
	const barRoles: BarRole[] = [
		...pick(SECTION_FORMS.a, rnd),
		...pick(SECTION_FORMS.a2, rnd),
		...pick(SECTION_FORMS.b, rnd),
		...pick(SECTION_FORMS.a3, rnd),
	];
	const style: MelodyStyle = {
		runShape: pick<RunShape>(["scale", "turn", "broken", "zigzag"], rnd),
		stepShape: pick<StepShape>(
			["arch", "valley", "ascend", "descend", "wave", "pivot"],
			rnd,
		),
		holdShape: pick<HoldShape>(["long", "third", "neighbor"], rnd),
		cadenceShape: pick<CadenceShape>(
			["descend", "five-three-one", "leap-up", "hold-tonic"],
			rnd,
		),
		leapAffinity: 0.12 + rnd() * 0.28,
		barHeadWeight: rnd() < 0.65 ? 3 : 2,
		bassStyle: pick<BassStyle>(
			[
				"quarter",
				"alternate",
				"half",
				"eighth",
				"syncopated",
				"walking",
				"octave",
			],
			rnd,
		),
		subStyle: pick<SubStyle>(
			["pad", "half", "answer", "long-short", "anticipate"],
			rnd,
		),
		subInterval: pick([3, 4, 8, 9], rnd),
	};

	// --- ②リズム型を先に設計する ---
	const motifCell = pick(MOTIF_CELLS, rnd);
	// モチーフの反復にリズムの変奏を1種類だけ用意する（逆行）。合計は変わらないので
	// 小節をはみ出さない。同じ形が3〜5回そのまま出ると耳が飽きる。
	const motifRetro: RhythmCell = {
		value: [...motifCell.value].reverse(),
		density: motifCell.density,
	};
	const useRetro = rnd() < 0.6;
	const barRhythms: number[][] = [];
	let prevCell: RhythmCell | null = null;
	let motifSeen = 0;
	for (let bar = 0; bar < BARS; bar++) {
		const role = barRoles[bar];
		let cell: RhythmCell;
		if (role === "motif" || role === "sequence" || role === "climax") {
			motifSeen++;
			cell = useRetro && motifSeen % 3 === 2 ? motifRetro : motifCell;
		} else {
			const wanted =
				role === "run" ? "dense" : role === "hold" ? "sparse" : "medium";
			const pool = RHYTHM_CELLS.filter((c) => c.density === wanted);
			// 隣り合う小節で同じリズム型を続けない（単調さの最大の原因）。
			const fresh = pool.filter((c) => c !== prevCell);
			cell = pick(fresh.length > 0 ? fresh : pool, rnd);
		}
		prevCell = cell;
		barRhythms.push(cell.value.map(scaleStep));
	}

	// --- ③その上に音を乗せる ---
	// モチーフの輪郭は名前の付く形から引き、足りないぶんだけ曲ごとに伸ばす。
	const motifNoteCount = motifCell.value.filter((v) => v > 0).length;
	const archetype = pick(MOTIF_ARCHETYPES, rnd);
	const motifContour: number[] = [];
	for (let i = 0; i < motifNoteCount; i++) {
		if (i < archetype.length) motifContour.push(archetype[i]);
		else motifContour.push(motifContour[i - 1] + (rnd() < 0.5 ? 1 : -1));
	}

	const melody: ComposedNote[] = [];
	const submelody: ComposedNote[] = [];
	const bass: ComposedNote[] = [];
	const melodyDurations: number[] = [];
	let restSteps = 0;
	let maxLeap = 0;
	let leaps = 0;
	let intervals = 0;
	// 開始音を曲ごとに変える。初版はここが 72 固定で、60%の曲が同じ音から始まっていた。
	let prevSemi = pick([60, 64, 65, 67, 69, 72, 74, 76], rnd);

	/** サブメロの置き方。単音・低密度・長音価という形は崩さずに、置き場所だけ変える。 */
	const SUB_CELLS: Record<SubStyle, number[]> = {
		pad: [WHOLE],
		half: [HALF, HALF],
		answer: [-HALF, HALF], // 前半休んでメロディに応える
		"long-short": [DOT_HALF, QUARTER],
		anticipate: [-QUARTER, DOT_QUARTER, DOT_QUARTER],
	};

	for (let bar = 0; bar < BARS; bar++) {
		const role = barRoles[bar];
		const barStart = bar * stepsPerBar;
		const tones = chordTones(progression[bar]);
		if (tones.length === 0) continue;
		const rhythm = barRhythms[bar];

		// 音の位置と強拍かどうかを先に出す（リズムが先、音が後、という順番を守る）
		const slots: Slot[] = [];
		let scan = 0;
		for (const value of rhythm) {
			if (value > 0)
				slots.push({ isStrong: scan % strongStep === 0, value, at: scan });
			scan += Math.abs(value);
		}
		if (slots.length === 0) continue;

		// 小節頭の着地点。曲ごとの重み下限で、ルート/5度固定になりすぎないようにする。
		const headSemi = nearestChordTone(
			prevSemi,
			tones,
			style.barHeadWeight,
		).semi;
		// モチーフ小節が2つ続くと、和音が同じなら音まで完全に同じ小節が並ぶ。
		// 2度目は少しずらして「反復」ではなく「一歩進んだ反復」にする。
		const prevRole = bar > 0 ? barRoles[bar - 1] : null;
		const repeatShift =
			role === "motif" &&
			(prevRole === "motif" || prevRole === "sequence" || prevRole === "climax")
				? pick([-2, -1, 1, 2], rnd)
				: 0;
		const degrees = barDegrees(
			role,
			slots,
			tones,
			style,
			motifContour,
			semitoneToDegree(headSemi),
			repeatShift,
			rnd,
		);
		const pitches = shapeBar(degrees, slots, tones, prevSemi, {
			allowLeap: role === "climax",
			allowArpeggio:
				role === "climax" ||
				(role === "run" && style.runShape === "broken") ||
				(role === "cadence" && style.cadenceShape !== "descend"),
			quarterSteps,
		});

		// メロディ
		const barHead = pitches[0];
		for (let i = 0; i < slots.length; i++) {
			const semi = pitches[i];
			if (role !== "climax") {
				const gap = Math.abs(semi - prevSemi);
				maxLeap = Math.max(maxLeap, gap);
				intervals++;
				if (gap > STEP_SEMITONES) leaps++;
			}
			const slot = slots[i];
			melody.push({
				startStep: barStart + slot.at,
				pitchUnits: spelledToUnits(
					semi,
					degreeToPitch(semitoneToDegree(semi)).fifth,
					edo,
				),
				durationSteps: slot.value,
				// 小節頭は少し強く、16分の走句は少し弱く弾く（打ち込みの定石）。
				velocity:
					slot.at === 0 ? 112 : slot.value <= scaleStep(SIXTEENTH) ? 88 : 100,
			});
			melodyDurations.push(slot.value);
			prevSemi = semi;
		}
		for (const value of rhythm) if (value < 0) restSteps += -value;

		// --- サブメロ（対旋律） ---
		// **単音で・音数が少なく・音価が長い**という形は崩さない。おまかせマスタリングの
		// 役割推定が（同時発音数と音価と密度で）サブメロを判定するため、和音になったり
		// 音数が増えたりすると「伴奏」と誤判定されて楽器が変わってしまう。
		// その制約の中で、**メロディと反行する輪郭**を持たせて旋律の形にする。
		const melodyRising = prevSemi >= barHead;
		const subDir = melodyRising ? -1 : 1; // 反行（contrary motion）
		const subCell =
			role === "hold" || role === "cadence"
				? [WHOLE]
				: role === "run"
					? [HALF, HALF]
					: SUB_CELLS[style.subStyle];
		let subCursor = 0;
		let subIndex = 0;
		let subSemi = clampSemi(
			barHead - style.subInterval,
			SUBMELODY_LOW,
			SUBMELODY_HIGH,
		);
		for (const raw of subCell) {
			const len = scaleStep(raw);
			if (raw < 0) {
				subCursor += -len;
				continue;
			}
			// 2音目以降はメロディと反対方向へ1〜2度動かしてから、
			// 和音の色を出す音（3度・7度）へ寄せる。
			const wanted =
				subIndex === 0
					? subSemi
					: walk(subSemi, subDir * (rnd() < 0.6 ? 1 : 2));
			const tone = nearestChordTone(wanted, tones, 2);
			subSemi = clampSemi(tone.semi, SUBMELODY_LOW, SUBMELODY_HIGH);
			submelody.push({
				startStep: barStart + subCursor,
				pitchUnits: spelledToUnits(subSemi, tone.fifth, edo),
				durationSteps: len,
				velocity: subIndex === 0 ? 90 : 84,
			});
			subCursor += len;
			subIndex++;
		}

		// --- ベース ---
		// 初版はルート4分打ちの1形だけで、300曲すべて同じ配置になっていた。
		// 曲ごとに奏法を引き、役割（緩急）でさらに切り替える。
		const rootTone = tones[0];
		const fifthTone = tones.find((t) => t.weight === 3 && t !== rootTone);
		const thirdTone = tones.find((t) => t.weight === 2);
		const R = clampSemi(rootTone.semi, BASS_LOW, BASS_HIGH);
		const F = fifthTone ? clampSemi(fifthTone.semi, BASS_LOW, BASS_HIGH) : R;
		const T = thirdTone ? clampSemi(thirdTone.semi, BASS_LOW, BASS_HIGH) : R;
		const O = clampSemi(R + 12, BASS_LOW, BASS_HIGH);
		// ウォーキングの経過音は「次の小節のルートの1つ下のスケール音」。
		// 半音の経過音にしないのは、31平均律で綴りの決まらない音を出さないため。
		const nextTones = chordTones(progression[(bar + 1) % BARS]);
		const A = clampSemi(
			walk(
				nextTones[0] ? clampSemi(nextTones[0].semi, BASS_LOW, BASS_HIGH) : R,
				-1,
			),
			BASS_LOW,
			BASS_HIGH,
		);
		const BASS_CELLS: Record<BassStyle, [number, number][]> = {
			quarter: [
				[R, QUARTER],
				[R, QUARTER],
				[F, QUARTER],
				[R, QUARTER],
			],
			alternate: [
				[R, QUARTER],
				[F, QUARTER],
				[R, QUARTER],
				[F, QUARTER],
			],
			half: [
				[R, HALF],
				[F, HALF],
			],
			eighth: [
				[R, EIGHTH],
				[R, EIGHTH],
				[R, EIGHTH],
				[R, EIGHTH],
				[F, EIGHTH],
				[F, EIGHTH],
				[R, QUARTER],
			],
			syncopated: [
				[R, DOT_QUARTER],
				[R, EIGHTH],
				[F, QUARTER],
				[R, QUARTER],
			],
			walking: [
				[R, QUARTER],
				[T, QUARTER],
				[F, QUARTER],
				[A, QUARTER],
			],
			octave: [
				[R, QUARTER],
				[O, QUARTER],
				[F, QUARTER],
				[O, QUARTER],
			],
		};
		const bassCell: [number, number][] =
			role === "hold" || role === "cadence"
				? [[R, WHOLE]]
				: role === "run"
					? BASS_CELLS[
							style.bassStyle === "half" || style.bassStyle === "quarter"
								? "eighth"
								: style.bassStyle
						]
					: BASS_CELLS[style.bassStyle];
		let bassCursor = 0;
		for (const [semi, value] of bassCell) {
			const len = scaleStep(value);
			const fifth =
				semi === R || semi === O
					? rootTone.fifth
					: semi === F
						? (fifthTone?.fifth ?? rootTone.fifth)
						: semi === T
							? (thirdTone?.fifth ?? rootTone.fifth)
							: degreeToPitch(semitoneToDegree(semi)).fifth;
			bass.push({
				startStep: barStart + bassCursor,
				pitchUnits: spelledToUnits(semi, fifth, edo),
				durationSteps: len,
				velocity: bassCursor === 0 ? 108 : 96,
			});
			bassCursor += len;
		}
	}

	/** ノート列が使った音域（半音）。 */
	const range = (notes: ComposedNote[]): number => {
		if (notes.length === 0) return 0;
		const us = notes.map((n) => n.pitchUnits);
		return (Math.max(...us) - Math.min(...us)) / UNITS_PER_SEMITONE;
	};

	return {
		chordProgression,
		chordPattern,
		melody,
		submelody,
		bass,
		melodyDurations,
		restSteps,
		totalSteps: BARS * stepsPerBar,
		maxLeap,
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		melodyRange: range(melody),
		submelodyRange: range(submelody),
	};
};

/**
 * 16小節の曲を組み立てる。品質基準（{@link MIN_ENTROPY_BITS} 等）を満たす draw が出るまで
 * 引き直し、{@link MAX_ATTEMPTS} 回で出なければその時点で一番良かったものを返す
 * （ボタンを押して何も起きない、という状態にはしない）。
 */
export const composeSong = (options: ComposeOptions): ComposeResult => {
	const rnd = options.random ?? Math.random;
	let best: ComposeResult | null = null;
	let bestScore = -1;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const d = draw(options, rnd);
		const entropy = durationEntropy(d.melodyDurations);
		const valueKinds = new Set(d.melodyDurations).size;
		const restRatio = d.restSteps / d.totalSteps;
		const stats: ComposeStats = {
			valueKinds,
			entropy,
			restRatio,
			maxLeapSemitones: d.maxLeap,
			leapRatio: d.leapRatio,
			melodyRange: d.melodyRange,
			submelodyRange: d.submelodyRange,
			attempts: attempt,
		};
		const result: ComposeResult = {
			chordProgression: d.chordProgression,
			chordPattern: d.chordPattern,
			melody: d.melody,
			submelody: d.submelody,
			bass: d.bass,
			stats,
		};
		const ok =
			entropy >= MIN_ENTROPY_BITS &&
			valueKinds >= MIN_VALUE_KINDS &&
			restRatio >= MIN_REST_RATIO &&
			restRatio <= MAX_REST_RATIO &&
			d.maxLeap <= MAX_LEAP_SEMITONES &&
			d.leapRatio >= MIN_LEAP_RATIO &&
			d.leapRatio <= MAX_LEAP_RATIO &&
			d.melodyRange >= MIN_MELODY_RANGE &&
			d.submelodyRange >= MIN_SUBMELODY_RANGE;
		if (ok) return result;
		// 基準を落としたときのための保険。エントロピーが一番高いものを残す。
		if (entropy > bestScore) {
			bestScore = entropy;
			best = result;
		}
	}
	// MAX_ATTEMPTS 回で基準を満たせなかった場合の保険。best は必ず入っている。
	return best as ComposeResult;
};
