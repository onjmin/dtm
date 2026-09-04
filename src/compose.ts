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
 *   全部同じ音価（エントロピー0bit）は論外。
 * - 休符を全体の {@link MIN_REST_RATIO}〜{@link MAX_REST_RATIO} 程度入れる。
 * - **順番が本質**: ①コード進行を決める →②先に各小節のリズム型を、隣接小節で変化を
 *   つけて設計する →③その上に音を乗せる。「音を決めてから音価を機械的に均等割りする」
 *   手順は、テンプレート的なアルペジオを生む温床なので採らない。
 * - **短いモチーフを1つ作り、3種類の変形で展開する**（そのまま反復／音程を上げて発展＝
 *   セクエンツ／1オクターブ上げてクライマックス）。同じ型に別の音を当てはめるのではなく、
 *   同じアイデアを別の文脈で展開する、という質的に違う作り方。
 * - メロディは**順次進行（スケールワイズ）が基本**。跳躍はB部頭のクライマックス1箇所だけに
 *   限定し、それ以外は {@link MAX_LEAP_SEMITONES} 以内に収める。
 * - **緩急**をつける。休符・ロングトーンの「緩」と16分音符の「急」を意図的に対比させる。
 * - 三和音だけの単純ループを避け、7th・セカンダリドミナントを混ぜる。
 *
 * ## 強拍に何を置くか
 *
 * 和音の構成音には重みがある（ルート・5度＝最重要／3度・7度＝重要／それ以外＝経過音）。
 * 強拍（小節頭と3拍目）では重みの高い音へ着地させ、弱拍は隣接音でつなぐ。これで
 * 「和音の上を適当に上下している」印象を避ける。{@link CHORD_TONE_WEIGHT} 参照。
 */

import { parseChord } from "@onjmin/chord-parser";
import { type ChordPatternType, spelledToUnits } from "./chords";
import type { Units } from "./tuning";

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
/**
 * 小節の中で許す隣接音の跳躍（半音）。これを超えるものは順次進行へ潰す。
 * 「順次進行または和音内の小さい跳躍」に収める、という基準の実装。
 */
const MAX_LEAP_SEMITONES = 5;
/**
 * 小節をまたぐときに許す跳躍（半音）。小節頭は和音の重要構成音へ着地させたいので、
 * 小節内より少しだけ広く取る（完全5度まではメロディとして自然に歌える範囲）。
 * クライマックスのオクターブ跳躍だけはこの制限を受けない。
 */
const MAX_BAR_LEAP_SEMITONES = 7;
/** 基準を満たす draw が出るまでの再試行回数。 */
const MAX_ATTEMPTS = 60;

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
];

/** B部（9〜12小節）の候補。A部と質感を変えるため、必ず別の進行から引く。 */
const SECTION_B_PROGRESSIONS: string[][] = [
	["F", "G", "Em7", "Am"],
	["Dm7", "G7", "CM7", "A7"],
	["F", "Bm7-5", "E7", "Am"],
	["FM7", "G", "Am", "D7"],
	["Dm7", "E7", "Am", "A7"],
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
 * 強拍ではこの重みが高い音へ着地させる。
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
	// --- 中: 4分・8分が主体 ---
	{ value: [QUARTER, QUARTER, HALF], density: "medium" },
	{ value: [HALF, QUARTER, QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, HALF], density: "medium" },
	{ value: [QUARTER, EIGHTH, EIGHTH, HALF], density: "medium" },
	{ value: [QUARTER, QUARTER, EIGHTH, EIGHTH, QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, QUARTER, DOT_QUARTER, EIGHTH], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, QUARTER, -QUARTER], density: "medium" },
	{ value: [QUARTER, -EIGHTH, EIGHTH, QUARTER, QUARTER], density: "medium" },
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
];

// ============================================================
// 曲の骨格
// ============================================================

/**
 * 各小節の役割。モチーフをどう扱うかで曲の記憶に残りやすさが決まるので、ここは
 * ランダムにせず固定の設計にしてある（ランダム性はモチーフ自体・リズム型・音の選び方に持たせる）。
 *
 * - `motif` … モチーフの原形。反復して記憶に残す。
 * - `sequence` … モチーフを音程ごと上下にずらす（セクエンツ）。同じ形が別の高さで出る。
 * - `climax` … モチーフを1オクターブ上げる。曲中で唯一の大跳躍を許す場所。
 * - `step` … 順次進行でつなぐ。
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

/** 16小節の骨格。A(0-3) A'(4-7) B(8-11) A''(12-15)。 */
const BAR_ROLES: BarRole[] = [
	"motif", // 1  A: 主題提示
	"step", // 2
	"sequence", // 3  セクエンツで発展
	"step", // 4
	"motif", // 5  A': 主題の反復（記憶に残す）
	"run", // 6  急
	"sequence", // 7
	"hold", // 8  緩（B部へのタメ）
	"climax", // 9  B: オクターブ上のクライマックス
	"run", // 10 急
	"step", // 11
	"hold", // 12 緩
	"motif", // 13 A'': 主題の回帰
	"step", // 14
	"run", // 15 最後の盛り上げ
	"cadence", // 16 主音へ着地
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
		const base = ((tone.semi % 12) + 12) % 12;
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
const SUBMELODY_HIGH = 72;
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

/**
 * 1小節分のメロディの音を決める。リズム（音価の並び）は既に決まっていて、そこへ音を
 * 乗せる、という順番を守る。
 */
const fillBarPitches = (
	role: BarRole,
	rhythm: number[],
	tones: ChordTone[],
	motifContour: number[],
	prevSemi: number,
	rnd: () => number,
): number[] => {
	const noteCount = rhythm.filter((v) => v > 0).length;
	const pitches: number[] = [];
	// 小節頭は必ず重要構成音（ルート・5度）へ着地させる。ここが決まらないと
	// 「和音の上を適当に上下している」印象になる。
	const current = nearestChordTone(prevSemi, tones, 3).semi;

	if (role === "motif" || role === "sequence" || role === "climax") {
		// モチーフの輪郭（音階の度数差）をそのまま乗せる。sequence は音程ごと上へずらし、
		// climax は1オクターブ上げる——「同じ型に別の音を当てはめる」のではなく
		// 「同じアイデアを別の文脈で置き直す」のが狙い。
		const shift =
			role === "sequence" ? (rnd() < 0.5 ? 1 : 2) : role === "climax" ? 7 : 0;
		const startDegree = semitoneToDegree(current) + shift;
		for (let i = 0; i < noteCount; i++) {
			const delta = motifContour[i % motifContour.length];
			pitches.push(degreeToPitch(startDegree + delta).semi);
		}
	} else if (role === "run") {
		// 走句: 音階を隣接音で駆け上がる／駆け下りる。跳躍を作らずに密度だけを上げる。
		const dir = rnd() < 0.5 ? 1 : -1;
		let degree = semitoneToDegree(current);
		for (let i = 0; i < noteCount; i++) {
			pitches.push(degreeToPitch(degree).semi);
			degree += dir;
		}
	} else if (role === "hold") {
		// 緩: 和音の色を出す3度・7度を長く伸ばす。
		for (let i = 0; i < noteCount; i++) {
			pitches.push(nearestChordTone(current, tones, 2).semi);
		}
	} else if (role === "cadence") {
		// 終止: 主音（ハ長調のC）へ順次進行で降りて着地する。
		const tonicDegree = semitoneToDegree(
			clampSemi(60, MELODY_LOW, MELODY_HIGH),
		);
		let degree = tonicDegree + noteCount - 1;
		for (let i = 0; i < noteCount; i++) {
			pitches.push(degreeToPitch(degree).semi);
			degree -= 1;
		}
	} else {
		// 順次進行でつなぐ。強拍だけ構成音へ寄せ、弱拍は隣接音で埋める。
		let degree = semitoneToDegree(current);
		let elapsed = 0;
		for (const value of rhythm) {
			if (value < 0) {
				elapsed += -value;
				continue;
			}
			const isStrong = elapsed % HALF === 0;
			if (isStrong) {
				degree = semitoneToDegree(
					nearestChordTone(degreeToPitch(degree).semi, tones, 3).semi,
				);
			} else {
				degree += rnd() < 0.5 ? 1 : -1;
			}
			pitches.push(degreeToPitch(degree).semi);
			elapsed += value;
		}
		while (pitches.length < noteCount) pitches.push(degreeToPitch(degree).semi);
	}

	// 音域へ畳み込み、クライマックス以外の跳躍を潰す。
	const allowLeap = role === "climax";
	const out: number[] = [];
	let prev = prevSemi;
	for (const raw of pitches) {
		let semi = clampSemi(raw, MELODY_LOW, MELODY_HIGH);
		if (
			!allowLeap &&
			out.length === 0 &&
			Math.abs(semi - prev) > MAX_BAR_LEAP_SEMITONES
		) {
			// 小節をまたぐ跳躍もクライマックス以外では潰す
			semi = clampSemi(
				semi,
				prev - MAX_BAR_LEAP_SEMITONES,
				prev + MAX_BAR_LEAP_SEMITONES,
			);
		}
		if (out.length > 0) {
			const gap = semi - prev;
			if (!allowLeap && Math.abs(gap) > MAX_LEAP_SEMITONES) {
				semi = prev + Math.sign(gap) * MAX_LEAP_SEMITONES;
				semi = clampSemi(semi, MELODY_LOW, MELODY_HIGH);
			}
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
} => {
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	// 音価は192ステップ基準で書いてあるので、実際の stepsPerBar へ比率で写す。
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);

	// --- ①コード進行を決める ---
	const progA = pick(SECTION_A_PROGRESSIONS, rnd);
	// B部はA部と質感を変えるのが役目なので、同じ進行を引いたら引き直す。
	// 両方の候補に同じ進行が入っている（ある進行はA部としてもB部としても使える）ため、
	// 独立に引くと B が A と丸ごと同じになり、コントラストが消えてしまう。
	const progBPool = SECTION_B_PROGRESSIONS.filter(
		(p) => p.join("|") !== progA.join("|"),
	);
	const progB = pick(progBPool, rnd);
	// A' は A の終わりだけドミナントへ差し替えて「まだ続く」感じにし、
	// A'' は主音へ落として終止させる。同じ4小節をただ4回繰り返さないための工夫。
	const progA2 = [...progA.slice(0, 3), "G7"];
	const tonic = progA[0].startsWith("Am") ? "Am" : "C";
	const progA3 = [...progA.slice(0, 2), "G7", tonic];
	const progression = [...progA, ...progA2, ...progB, ...progA3];
	const chordProgression = progression.join("|");
	const chordPattern = pick(CHORD_PATTERNS, rnd);

	// --- ②リズム型を先に設計する ---
	const motifCell = pick(MOTIF_CELLS, rnd);
	const barRhythms: number[][] = [];
	let prevCell: RhythmCell | null = null;
	for (let bar = 0; bar < BARS; bar++) {
		const role = BAR_ROLES[bar];
		let cell: RhythmCell;
		if (role === "motif" || role === "sequence" || role === "climax") {
			cell = motifCell;
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
	// モチーフの輪郭（音階の度数差）。順次進行を基本にするため ±1 を厚くする。
	const motifNoteCount = motifCell.value.filter((v) => v > 0).length;
	const motifContour: number[] = [0];
	for (let i = 1; i < motifNoteCount; i++) {
		const r = rnd();
		const delta = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
		motifContour.push(motifContour[i - 1] + delta);
	}

	const melody: ComposedNote[] = [];
	const submelody: ComposedNote[] = [];
	const bass: ComposedNote[] = [];
	const melodyDurations: number[] = [];
	let restSteps = 0;
	let maxLeap = 0;
	let prevSemi = 72; // C5 から始める

	for (let bar = 0; bar < BARS; bar++) {
		const role = BAR_ROLES[bar];
		const barStart = bar * stepsPerBar;
		const tones = chordTones(progression[bar]);
		if (tones.length === 0) continue;
		const rhythm = barRhythms[bar];
		const pitches = fillBarPitches(
			role,
			rhythm,
			tones,
			motifContour,
			prevSemi,
			rnd,
		);

		// メロディ
		let cursor = 0;
		let noteIndex = 0;
		for (const value of rhythm) {
			if (value < 0) {
				restSteps += -value;
				cursor += -value;
				continue;
			}
			const semi = pitches[noteIndex] ?? prevSemi;
			// 跳躍の検算は小節内の隣接音だけを見る。小節またぎは
			// MAX_BAR_LEAP_SEMITONES 側で別に抑えてある。
			if (noteIndex > 0 && role !== "climax") {
				maxLeap = Math.max(maxLeap, Math.abs(semi - prevSemi));
			}
			const { semi: s, fifth } = {
				semi,
				fifth: degreeToPitch(semitoneToDegree(semi)).fifth,
			};
			melody.push({
				startStep: barStart + cursor,
				pitchUnits: spelledToUnits(s, fifth, edo),
				durationSteps: value,
				// 小節頭は少し強く、16分の走句は少し弱く弾く（打ち込みの定石）。
				velocity: cursor === 0 ? 112 : value <= scaleStep(SIXTEENTH) ? 88 : 100,
			});
			melodyDurations.push(value);
			prevSemi = semi;
			cursor += value;
			noteIndex++;
		}

		// サブメロ: 和音の色を出す3度・7度を、1小節に1〜2音だけ長く置く。
		// **単音で・音数が少なく・音価が長い**という形を守るのは、おまかせマスタリングの
		// 役割推定が（同時発音数と音価と密度で）サブメロを判定するため。
		// 和音になったり音数が増えたりすると「伴奏」と誤判定され、楽器が変わってしまう。
		const subCount = role === "hold" || role === "cadence" ? 1 : 2;
		const subLen = Math.floor(stepsPerBar / subCount);
		for (let i = 0; i < subCount; i++) {
			const target = clampSemi(prevSemi - 9, SUBMELODY_LOW, SUBMELODY_HIGH);
			const tone = nearestChordTone(target, tones, 2);
			submelody.push({
				startStep: barStart + i * subLen,
				pitchUnits: spelledToUnits(
					clampSemi(tone.semi, SUBMELODY_LOW, SUBMELODY_HIGH),
					tone.fifth,
					edo,
				),
				durationSteps: subLen,
				velocity: 88,
			});
		}

		// ベース: ルート主体。小節ごとにリズムを変えて土台が単調にならないようにする。
		const rootTone = tones[0];
		const fifthTone = tones.find((t) => t.weight === 3 && t !== rootTone);
		const rootSemi = clampSemi(rootTone.semi, BASS_LOW, BASS_HIGH);
		const fifthSemi = fifthTone
			? clampSemi(fifthTone.semi, BASS_LOW, BASS_HIGH)
			: rootSemi;
		const bassPattern =
			role === "hold" || role === "cadence"
				? [[rootSemi, WHOLE] as const]
				: role === "run"
					? ([
							[rootSemi, EIGHTH],
							[rootSemi, EIGHTH],
							[fifthSemi, QUARTER],
							[rootSemi, QUARTER],
							[fifthSemi, QUARTER],
						] as const)
					: ([
							[rootSemi, QUARTER],
							[rootSemi, QUARTER],
							[fifthSemi, QUARTER],
							[rootSemi, QUARTER],
						] as const);
		let bassCursor = 0;
		for (const [semi, value] of bassPattern) {
			const len = scaleStep(value);
			bass.push({
				startStep: barStart + bassCursor,
				pitchUnits: spelledToUnits(
					semi,
					semi === rootSemi
						? rootTone.fifth
						: (fifthTone?.fifth ?? rootTone.fifth),
					edo,
				),
				durationSteps: len,
				velocity: bassCursor === 0 ? 108 : 96,
			});
			bassCursor += len;
		}
	}

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
			d.maxLeap <= MAX_LEAP_SEMITONES;
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
