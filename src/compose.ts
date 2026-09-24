/**
 * 自動作曲マクロ。コード進行・メロディ・サブメロ・ハモリ・ベース・伴奏・パッドを
 * まとめて組み立てる。曲の長さは選んだセクションで決まる
 * （{@link file://./compose-sections.ts}）。
 *
 * 組み立ては ①セクションの設計図 →②コード進行 →③各小節のリズム型 →④その上に音、の順。
 * 音を先に置いて音価を均等割りすると機械的な曲にしかならない。
 *
 * {@link DRAW_COUNT} 本の候補を引き、{@link HARD} に触れたものを捨て、残りから確率的に
 * 引く（{@link evaluate}・{@link SELECT_TEMPERATURE}）。目標帯（{@link CORPUS_BANDS}）は
 * 人間のMIDIからの実測で、較正は `scripts/calibrate-corpus.ts`。生成物とコーパスを同じ
 * 物差しで並べるのは `scripts/compare-*.ts`。
 */

import { parseChord } from "@onjmin/chord-parser";
import {
	type ChordPatternType,
	semitonesToUnits,
	spelledToUnits,
} from "./chords";
import {
	CORPUS_BANDS,
	CORPUS_CELL_WEIGHTS,
	CORPUS_DEVIATION_BUDGET,
	CORPUS_PROFILE_KEYS,
} from "./compose-corpus";
import { type ResolvedComposeKey, resolveComposeKey } from "./compose-keys";
import {
	type Band,
	band,
	type DensityFeatures,
	densityFeatures,
	featureDistance,
	featureVector,
	type MetricNote,
	plausibleBand,
	type StructureFeatures,
	structureFeatures,
	type TensionFeatures,
	tensionFeatures,
} from "./compose-metrics";
import { CORPUS_PHRASES, type CorpusPhrase } from "./compose-phrases";
import {
	type ComposeScale,
	type ComposeScaleId,
	coreToDegree,
	degreeToCore,
	degreeToPitch,
	isOutsideCore,
	resolveCenter,
	resolveComposeScale,
	type ScaleDegree,
	scaleFifth,
	scalePcs,
	scaleSize,
	semitoneToDegree,
	type TonicCenter,
	walk,
} from "./compose-scales";
import {
	buildSectionPlan,
	DEFAULT_SECTIONS,
	type PlacedSection,
	type SectionKind,
	STRUCTURE_TEMPLATES,
	sectionAt,
} from "./compose-sections";
import { UNITS_PER_SEMITONE, type Units } from "./tuning";

// ============================================================
// 受け入れ基準
//
// しきい値の合否は「ハード制約（常に間違いなもの）」だけに絞り、残りは台形の当てはめ
// （{@link band}）で連続的な点数にする。真偽値の合否だと、構造が良くても休符率が0.09なら
// 破棄する、という落とし方しかできない。順序依存の指標は
// {@link file://./compose-metrics.ts} にある——分布の指標は小節の順番をシャッフルして曲を
// 破壊しても値が動かないので、それだけでは構造を測れない。
// 目標帯は手で決めた定数ではなく、人間が書いた曲から実測した分布（{@link CORPUS_BANDS}）。
// ============================================================

/** 順次進行とみなす音程の上限（半音）。これを超えるものを「跳躍」と数える。 */
const STEP_SEMITONES = 2;
/** 許す跳躍の上限（半音）。クライマックスのオクターブ跳躍だけは対象外。 */
const MAX_LEAP_SEMITONES = 10;
/** 曲ごとの跳躍上限の候補。固定値にすると跳躍で歌う曲が作れない。 */
const LEAP_CEILINGS = [5, 6, 7, 7, 8, 9, 10, 10, 12, 14, 16];

/**
 * 「歌える限界を超えた跳躍」とみなす音程（半音）。長7度より広い動きは、音程を取る手がかりが
 * 和音以外に無くなる。
 */
const WIDE_LEAP_SEMITONES = 9;
/**
 * その跳躍を1曲に何回まで置いてよいか。
 *
 * **上限（{@link LEAP_CEILINGS}）と回数は別の話。** 上限は「どこまで跳んでよいか」しか
 * 決めないので、広い上限を引いた曲では10半音超えが7箇所出て、旋律ではなく分散和音になる。
 * かといって上限を下げると跳んで歌う曲そのものが作れない。上限は残したまま、回数だけ絞る。
 * 予算を使い切った跳躍はオクターブ折り返しで音域の中へ戻す——音名が変わらないので、
 * 和音との関係は壊れない。
 */
const WIDE_LEAP_BUDGET = 2;

/** 小楽節の【答え】が【問い】と別のリズム型になる確率。 */
const ANSWER_VARY = 0.4;
/** 小節をまたぐときに許す跳躍（半音）。 */
const MAX_BAR_LEAP_SEMITONES = 10;

/**
 * ハード制約。**満たさない曲は「音楽として壊れている」ので点数を付ける前に捨てる。**
 * ここを厚くすると初版の「落とすだけ」に戻るので、本当に常に間違いなものだけを置く。
 */
const HARD = {
	/** メロディが1音も無い、音域が半音未満（同じ音を並べただけ）。 */
	minMelodyRange: 3,
	/** サブメロが動いていない。 */
	minSubmelodyRange: 2,
	/** クライマックスを除く跳躍がこれを超える＝歌えない。 */
	maxLeapSemitones: 14,
	/** 曲の8割以上が休符＝曲になっていない。 */
	maxRestRatio: 0.8,
} as const;

/**
 * 採点の重み。構造（順序依存）の指標に半分以上を配分する。分布の指標は「壊れていないこと」
 * の確認であって、そこを最適化しても曲は良くならない。
 */
const WEIGHTS = {
	// --- 分布（順序非依存）。壊れ検知としてだけ効かせる ---
	entropy: 0.6,
	valueKinds: 0.4,
	restRatio: 0.6,
	leapRatio: 0.6,
	maxLeap: 0.4,
	melodyRange: 0.6,
	/** メロディの速さ。放っておくと「スカスカで跳ねてばかり」へ寄る。 */
	notesPerBar: 0.8,
	shortNoteRatio: 0.6,
	/** 小節ごとの音数のばらつきと崖。平均だけを見ていて見逃していた偏り。 */
	barDensityCv: 0.6,
	densityCliff: 1.0,
	/** 順次進行の比率。跳躍率だけを見ていると、跳躍の帯の上端に張り付く。 */
	stepRatio: 0.8,
	/** 調の外の音。0のままだと全曲が同じ音階をなぞるだけになる。 */
	chromaticRatio: 0.6,
	// --- 構造（順序依存）。ここが本体 ---
	/** 隣り合う小節は違う形をしているか（高すぎると「同じ小節の連打」）。 */
	sim1: 0.8,
	sim2: 0.8,
	/** 4小節・8小節で形が戻ってくるか。フレーズ感の本体。 */
	sim4: 1.4,
	sim8: 1.4,
	phraseBreath: 1.0,
	/** 折り返しの多さ。跳躍率・順次進行率が揃っていても、これは別に足りなくなる。 */
	turnRatio: 0.8,
	climaxPosition: 1.0,
	climaxPeaks: 1.0,
	/** メロディとサブメロが呼応しているか。 */
	complementarity: 1.0,
	/** サブメロの音数と、その崖。メロディと同じ物差しで見る。 */
	subDensity: 0.6,
	subDensityCliff: 0.5,
	// --- 和声（コードが要るのでコーパスからは較正できない） ---
	/** B部でテンションが上がるか。 */
	tensionRise: 1.0,
	/** 終止で解決するか。 */
	tensionResolve: 0.8,
	// --- 直近に作った曲と違うか ---
	novelty: 1.2,
} as const;

// **コーパスへの「近さ」は採点しない。** コーパスが示すのは「これらは成立する」という
// 十分性であって、「これら以外は成立しない」という必要性ではない。人間の曲が、人の居ない
// 領域の曲より音楽的に優れていると言える根拠が無い以上、「人が1本も居ない場所に居ること」を
// 減点する理由も無い。**フィルタは引けたものを選ぶことしかできない**ので、出てこない曲の
// 原因は採点式ではなく生成系の側にある。

/**
 * 素点の低い項目を何本まで採点から外すか（{@link CORPUS_DEVIATION_BUDGET}）。
 *
 * 目標帯は各項目を独立に採った周辺分布なので、「全項目を同時に満たせ」は人間の曲が実際に
 * やっていることではない。点の低い数項目を見逃して「1つの軸で振り切ってよい、ただし残りは
 * 人間の範囲に居ろ」という基準にする。壊れた曲は {@link HARD} が別に落とす。
 */
const DEVIATION_BUDGET = CORPUS_DEVIATION_BUDGET;

/**
 * 予算の対象＝コーパスから較正した周辺分布の項目。手で決めた帯（{@link HAND_BANDS}）・
 * 和声・novelty・typicality は対象外で、必ず採点される。
 */
const BUDGETED_KEYS: ReadonlySet<string> = new Set<string>(CORPUS_PROFILE_KEYS);

/**
 * コーパスから較正できない指標の目標帯（手で決めたもの）。
 *
 * - `complementarity` … コーパス側で「対旋律」を機械的に選ぶ精度が低く p25 が 0 に張り付く
 *   ので、そのまま目標にすると誤った基準になる。
 * - `climaxPeaks` … コーパスの曲は長いぶん頂点が増える。16小節の曲には緩すぎる。
 */
const HAND_BANDS = {
	/** サブメロの音数/小節。少なすぎると「置いただけ」、多すぎるとメロディを食う。 */
	subDensity: [0.5, 1.8, 4.5, 8] as Band,
	complementarity: [0.05, 0.25, 0.7, 0.95] as Band,
	climaxPeaks: [0, 1, 2, 5] as Band,
} as const;

/**
 * 1曲作るのに引く候補数。本数を増やすほど採点式の頂点1点へ収束して分布が狭まるので、多くは
 * 引かず、選び方も {@link SELECT_TEMPERATURE} で確率的にする。
 */
const DRAW_COUNT = 12;

/**
 * 候補の選び方の温度。0 なら最高点を必ず選ぶ。採点式の細かい上下は「どちらが良い曲か」を
 * 判定できる分解能を持たない、という前提で僅差の候補を切り捨てない。
 */
const SELECT_TEMPERATURE = 0.05;

// ============================================================
// 音価（1小節 = stepsPerBar。既定192ステップ ＝ 4分音符48ステップ）
// ============================================================

/** 1小節を192ステップとしたときの音価。実際の stepsPerBar に合わせて比率で伸縮する。 */
export const BASE_STEPS_PER_BAR = 192;
const WHOLE = 192;
const DOT_HALF = 144;
const HALF = 96;
const DOT_QUARTER = 72;
const QUARTER = 48;
const DOT_EIGHTH = 36;
const EIGHTH = 24;
const SIXTEENTH = 12;

const NOTE_NAME_TO_PC: Record<string, number> = {
	C: 0,
	"B#": 0,
	"C#": 1,
	Db: 1,
	D: 2,
	"D#": 3,
	Eb: 3,
	E: 4,
	Fb: 4,
	F: 5,
	"E#": 5,
	"F#": 6,
	Gb: 6,
	G: 7,
	"G#": 8,
	Ab: 8,
	A: 9,
	"A#": 10,
	Bb: 10,
	B: 11,
	Cb: 11,
};

const SHARP_NOTE_NAMES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B",
];
const FLAT_NOTE_NAMES = [
	"C",
	"Db",
	"D",
	"Eb",
	"E",
	"F",
	"Gb",
	"G",
	"Ab",
	"A",
	"Bb",
	"B",
];

/**
 * 2つの調が五度圏で何歩離れているか（0〜6）。近いほど共通するダイアトニックコードが
 * 多く、転調が自然になる。属調・下属調が1歩、長2度・短3度が2〜3歩、半音上げは5歩。
 */
const fifthsDistance = (semitones: number): number => {
	const steps = (((semitones * 7) % 12) + 12) % 12;
	return Math.min(steps, 12 - steps);
};

const SEMITONE_TO_FIFTH_SHIFT = [
	0, // 0: C
	7, // 1: C# (+7)
	2, // 2: D (+2)
	-3, // 3: Eb (-3)
	4, // 4: E (+4)
	-1, // 5: F (-1)
	6, // 6: F# (+6)
	1, // 7: G (+1)
	-4, // 8: Ab (-4)
	3, // 9: A (+3)
	-2, // 10: Bb (-2)
	5, // 11: B (+5)
];

/**
 * コードネーム（例: "C", "Am7", "F#m/C#", "Bb" など）を半音単位で移調する。
 * セクションごとの曲中転調に伴奏トラックを追従させるのに使う。
 */
export const transposeChordName = (chord: string, shift: number): string => {
	if (shift === 0 || !chord.trim()) return chord;
	const normShift = ((shift % 12) + 12) % 12;
	if (normShift === 0) return chord;
	const preferFlat =
		chord.includes("b") ||
		(!chord.includes("#") &&
			(normShift === 3 || normShift === 5 || normShift === 10));
	const names = preferFlat ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
	return chord.replace(/([A-G][#b]?)/g, (match) => {
		const pc = NOTE_NAME_TO_PC[match];
		if (pc === undefined) return match;
		return names[(((pc + normShift) % 12) + 12) % 12];
	});
};

/**
 * テンポ（BPM）の候補。120未満を落とし、170〜185の高速帯を足してある（1拍に16分が4つ
 * 収まって「詰め込み感」が出る帯）。
 */
const BPM_CHOICES = [
	112, 120, 124, 126, 128, 130, 132, 132, 134, 136, 138, 142, 150, 155, 160,
	168, 172, 175, 180, 185,
];

// ============================================================
// 音階
// ============================================================
//
// 音程の計算は `compose-scales.ts` にある。**どれも曲の音階を第1引数に取る**——
// 音程集合そのものが曲ごとに変わる（{@link ComposeScale.parent}）ので、
// モジュールの定数として持てない。旋律はここの度数だけで組み立て、
// 最後に {@link applyChromatic} が音階の外の音を通す。

// ============================================================
// コード進行
// ============================================================

/**
 * A部（1〜4小節）の候補。三和音だけの単純ループを避けるため、どれかに7th かセカンダリ
 * ドミナントを含める。調はハ長調／イ短調のままで、要るならマクロの「移調」で動かす。
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
	// --- ライン・クリシェ（内声が半音ずつ動く） ---
	// 和音の1声だけを半音で動かして、和音記号は変わるのに響きは繋がったまま進む。
	// J-POPのサビ後半やAメロの定番。
	["Am", "AmM7", "Am7", "Am6"], // ラ→ソ#→ソ→ファ# の下行
	["C", "CM7", "C7", "F"], // ド→シ→シb→ラ
	["Am", "AmM7", "Am7", "D7"], // クリシェからドリアンのIVへ
	["F", "Fm", "CM7", "Am7"], // サブドミナントマイナーのクリシェ
	// --- ペダルポイント（ベースを保続する） ---
	// ベースだけ動かさずに上の和音を変える。緊張感が出る。分数和音のルートを
	// {@link chordTones} が先頭で返すので、ベースは自然に保続音になる。
	["C", "Am/C", "F/C", "G/C"],
	["Am", "Em/A", "F/A", "G/A"],
	// --- 借用和音（同主短調・ミクソリディアンから借りる） ---
	// 調の外の和音を進行そのものに持たせる。メロディが変化音を採れる
	// （{@link applyChromatic}）ので、和音の側にも「調の外」の受け皿を用意しておく。
	["F", "Fm", "C", "G7"], // サブドミナントマイナー（王道の陰り）
	["C", "Bb", "F", "C"], // bVII（ミクソリディアン借用）
	["Am", "Dm7", "Bb", "E7"], // bVI からドミナントへ
];

/** Cメロ（bridge）の候補。AメロともBメロとも雰囲気が違う、ドラマチックな進行。 */
const SECTION_C_PROGRESSIONS: string[][] = [
	["Am", "Em", "F", "C"],
	["Dm7", "Em7", "FM7", "G7"],
	["Am7", "Dm7", "G7", "CM7"],
	["F", "G", "Am", "G"],
	["Dm7", "G7", "Em7", "Am"],
	["FM7", "Em7", "Am7", "Dm7"],
	["Am", "G", "FM7", "E7"],
	["C", "Am", "FM7", "G7"],
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
	// --- 借用和音 ---
	["FM7", "Fm7", "Em7", "Am"], // サブドミナントマイナーで陰らせる
	["F", "G", "Ab", "Bb"], // bVI→bVII（サビ前の持ち上げ）
	["Dm7", "Db7", "CM7", "A7"], // 裏コード（トライトーン代理）
	["Am", "C7", "F", "Fm"], // セカンダリドミナント → サブドミナントマイナー
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
 * セクションの締めの4小節。`tonic` は A部の始まりが Am 系かどうかで決める。
 *
 * - 全終止（V→I）… 曲の終わりと大きな区切りに
 * - アーメン終止（IV→I）… 柔らかく終わりたいところに
 * - サブドミナントマイナー終止（IVm→I）… アーメン終止の変形
 * - 偽終止（V→VI）… 着地したのに終わっていない。曲を続けたいところに
 */
const SECTION_A3_DERIVATIONS: ((a: string[], tonic: string) => string[])[] = [
	(a, t) => [a[0], a[1], "G7", t],
	(a, t) => [a[0], "Dm7", "G7", t],
	(a, t) => [a[0], a[1], "Em7", t],
	// アーメン終止（IV→I）
	(a, t) => [a[0], "G7", "F", t],
	(a, t) => [a[0], "Dm7", "FM7", t],
	// サブドミナントマイナー終止（IVm→I）
	(a, t) => [a[0], "G7", "Fm", t],
	(a, t) => [a[0], "F", "Fm", t],
];

/**
 * 偽終止の4小節。主和音の代わりに、その代理（長調なら VIm、短調なら VI）へ落とす。
 * **途中のサビ**に置く——ここで全終止すると曲がそのたびに終わってしまう。
 */
const SECTION_DECEPTIVE_DERIVATIONS: ((
	a: string[],
	tonic: string,
) => string[])[] = [
	(a, t) => [a[0], a[1], "G7", t === "Am" ? "F" : "Am"],
	(a, t) => [a[0], "Dm7", "G7", t === "Am" ? "FM7" : "Am7"],
	(a, t) => [a[0], "F", "G7", t === "Am" ? "F" : "Am7"],
];

/**
 * モードの曲の締めの4小節。セカンダリドミナントを使わずに終止を作る——V7→I を鳴らすと導音が
 * 出て主音がドへ引き戻される（D ドリアンの `A7` の C♯）。主和音を尻に置いて中心を示し、
 * 手前には {@link TonicCenter.half} を置く。
 */
const MODAL_FULL_DERIVATIONS: ((a: string[], c: TonicCenter) => string[])[] = [
	(a, c) => [a[0], a[1], c.half, c.tonic],
	(a, c) => [a[0], c.half, a[2], c.tonic],
	(a, c) => [a[0], a[1], a[2], c.tonic],
	(a, c) => [c.tonic, c.half, a[2], c.tonic],
];

/** モードの曲の半終止（「まだ続く」で止める4小節）。 */
const MODAL_HALF_DERIVATIONS: ((a: string[], c: TonicCenter) => string[])[] = [
	(a, c) => [a[0], a[1], a[2], c.half],
	(a, c) => [a[0], a[1], c.tonic, c.half],
	(a, c) => [a[0], c.tonic, a[2], c.half],
];

/** モードの曲の偽終止（主和音の代理へ落とす4小節）。 */
const MODAL_DECEPTIVE_DERIVATIONS: ((
	a: string[],
	c: TonicCenter,
) => string[])[] = [
	(a, c) => [a[0], a[1], c.half, c.deceptive],
	(a, c) => [a[0], c.half, a[2], c.deceptive],
	(a, c) => [a[0], a[1], a[2], c.deceptive],
];

/**
 * モーダルインターチェンジ（借用和音）。同主短調のダイアトニックコードを1つだけ借りる。
 * 調性感を失いやすいので、1曲に1和音だけ・主和音へ向かう手前に置く（IV→IVm→I）。
 * キーはハ長調のダイアトニック、値が同主短調から借りた形。
 */
const MODAL_BORROW: Record<string, string> = {
	F: "Fm", // IV → IVm（サブドミナントマイナー。いちばん定番）
	FM7: "Fm7",
	Am: "Ab", // VIm → ♭VI
	Am7: "Ab",
	G: "Bb", // V → ♭VII（ミクソリディアン）
	G7: "Bb",
	Em7: "Eb", // IIIm → ♭III
	Dm7: "Dm7-5", // IIm7 → IIm7♭5（エオリアン）
};

/**
 * 伴奏の奏法の候補。`arpeggio-fast` は速い曲だと伴奏がメロディを食うので、
 * テンポで絞ってから引く（{@link chordPatternPool}）。
 */
const CHORD_PATTERNS: ChordPatternType[] = [
	"block",
	"arpeggio",
	"offbeat",
	"yatsume",
	"alternating",
];
/** テンポに応じた奏法の候補。 */
const chordPatternPool = (bpm: number): ChordPatternType[] =>
	bpm <= 130 ? [...CHORD_PATTERNS, "arpeggio-fast"] : CHORD_PATTERNS;

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
 * その瞬間の和音における、ある音の重要度。
 *
 * - 和音構成音 … {@link CHORD_TONE_WEIGHT}（3=ルート・5度／2=3度・7度／1=その他）
 * - アボイドノート … 0。半音上に和音構成音があるスケール音（C の上の F など）。強拍や長い
 *   音価で鳴らすと濁るので、弱拍の経過音としてしか通さない。
 * - それ以外のスケール音 … 1
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
 * 1小節分のリズム型。正が音、負が休符（絶対値がステップ数）。合計は必ず1小節。
 * `density` は緩急の設計に使う——`sparse` と `dense` を曲の中で必ず対比させる。
 */
type RhythmCell = { value: number[]; density: "sparse" | "medium" | "dense" };

export const RHYTHM_CELLS: RhythmCell[] = [
	// --- 緩: ロングトーン・休符主体 ---
	{ value: [WHOLE], density: "sparse" },
	{ value: [DOT_HALF, QUARTER], density: "sparse" },
	{ value: [HALF, HALF], density: "sparse" },
	{ value: [HALF, QUARTER, -QUARTER], density: "sparse" },
	{ value: [DOT_HALF, -QUARTER], density: "sparse" },
	{ value: [QUARTER, DOT_HALF], density: "sparse" },
	{ value: [-QUARTER, DOT_HALF], density: "sparse" },
	{ value: [HALF, -QUARTER, QUARTER], density: "sparse" },
	// --- 緩・息継ぎ型: 小節の末尾を休符で空ける ---
	// フレーズの切れ目の息継ぎ（{@link StructureFeatures.phraseBreath}）にもそのまま効く。
	{ value: [DOT_QUARTER, EIGHTH, -HALF], density: "sparse" },
	{ value: [QUARTER, QUARTER, -HALF], density: "sparse" },
	{ value: [HALF, -HALF], density: "sparse" },
	{ value: [-QUARTER, HALF, -QUARTER], density: "sparse" },
	// 3拍休む形。人間の主旋律は曲によっては小節のほとんどを休むので、ここまで
	// 空ける形が無いと休符率が10%あたりで頭打ちになる。**1音は必ず残す**——
	// 完全な空小節にすると、この小節のサブメロとベースまで書かれなくなる。
	{ value: [-DOT_HALF, QUARTER], density: "sparse" },
	{ value: [QUARTER, -DOT_HALF], density: "sparse" },
	{ value: [-HALF, QUARTER, -QUARTER], density: "sparse" },
	// --- 中: 4分・8分が主体 ---
	{ value: [QUARTER, EIGHTH, EIGHTH, QUARTER, -QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, QUARTER, QUARTER, -QUARTER], density: "medium" },
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
	// --- 中・シンコペーション: 拍の裏から入る形 ---
	// 参考曲は主旋律の音の47%が拍頭に無い（生成物は35%）。拍の頭にきれいに揃った
	// メロディは、それだけで打ち込みらしく聞こえる。合計は必ず1小節。
	{ value: [EIGHTH, QUARTER, QUARTER, QUARTER, EIGHTH], density: "medium" },
	{ value: [EIGHTH, EIGHTH, DOT_QUARTER, DOT_QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, DOT_QUARTER, EIGHTH, EIGHTH], density: "medium" },
	{ value: [-EIGHTH, EIGHTH, DOT_QUARTER, DOT_QUARTER], density: "medium" },
	{ value: [QUARTER, EIGHTH, DOT_QUARTER, QUARTER], density: "medium" },
	{
		value: [SIXTEENTH, EIGHTH, SIXTEENTH, QUARTER, QUARTER, QUARTER],
		density: "medium",
	},
	// --- 中・16分グルーヴ: 走句ではなく「地」として16分を含む形 ---
	// これが無いと16分グルーヴの曲でも `run` の小節にしか16分が出ず、
	// 1曲に1〜3個の孤立した16分小節（＝思い出したように入る一発ネタ）になる。
	{ value: [QUARTER, EIGHTH, SIXTEENTH, SIXTEENTH, HALF], density: "medium" },
	{
		value: [EIGHTH, SIXTEENTH, SIXTEENTH, QUARTER, QUARTER, QUARTER],
		density: "medium",
	},
	{
		value: [SIXTEENTH, SIXTEENTH, EIGHTH, QUARTER, DOT_QUARTER, EIGHTH],
		density: "medium",
	},
	{
		value: [QUARTER, QUARTER, EIGHTH, SIXTEENTH, SIXTEENTH, QUARTER],
		density: "medium",
	},
	{
		value: [DOT_QUARTER, SIXTEENTH, SIXTEENTH, QUARTER, QUARTER],
		density: "medium",
	},
	{
		value: [EIGHTH, EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, QUARTER, -QUARTER],
		density: "medium",
	},
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
 * 楽節の終わり（セクションの最終小節）に置く息継ぎの型。息継ぎは「着地してから息を継ぐ」
 * ことで、小節を空けることではない。2〜4音で着地し、末尾を休符で空ける。合計は必ず1小節。
 */
const PHRASE_END_CELLS: RhythmCell[] = [
	// 白玉で受けてから息を継ぐ（いちばん歌らしい終わり方）。
	{ value: [HALF, QUARTER, -QUARTER], density: "sparse" },
	{ value: [DOT_QUARTER, EIGHTH, HALF], density: "sparse" },
	{ value: [QUARTER, DOT_QUARTER, EIGHTH, -QUARTER], density: "sparse" },
	// 2音で降りてから息を継ぐ。
	{ value: [QUARTER, QUARTER, -HALF], density: "sparse" },
	{ value: [DOT_QUARTER, EIGHTH, -HALF], density: "sparse" },
	{ value: [HALF, -QUARTER, QUARTER], density: "sparse" },
	// 3音で言い切ってから息を継ぐ。
	{ value: [EIGHTH, EIGHTH, QUARTER, -HALF], density: "sparse" },
	{ value: [QUARTER, EIGHTH, EIGHTH, -HALF], density: "sparse" },
	{ value: [QUARTER, QUARTER, QUARTER, -QUARTER], density: "sparse" },
	{ value: [HALF, EIGHTH, EIGHTH, -QUARTER], density: "sparse" },
	// 4音で言い切ってから息を継ぐ。周りが7音前後の曲では、2音まで落とすと崖になる。
	{ value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, -HALF], density: "sparse" },
	{ value: [QUARTER, EIGHTH, EIGHTH, QUARTER, -QUARTER], density: "sparse" },
	{ value: [EIGHTH, EIGHTH, QUARTER, QUARTER, -QUARTER], density: "sparse" },
];

/**
 * 小楽節の切れ目（8小節セクションの4小節目）に置く軽い息継ぎの型。
 * 落とすのは1音ぶんまで——空けると崖がもう1つ増える。
 */
const MID_BREATH_CELLS: RhythmCell[] = [
	{ value: [QUARTER, EIGHTH, EIGHTH, QUARTER, -QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, QUARTER, QUARTER, -QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, EIGHTH, QUARTER, QUARTER], density: "medium" },
	{ value: [QUARTER, QUARTER, EIGHTH, EIGHTH, -QUARTER], density: "medium" },
	{ value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, HALF], density: "medium" },
	{ value: [QUARTER, EIGHTH, EIGHTH, DOT_QUARTER, EIGHTH], density: "medium" },
];

/**
 * リズム型を参考曲の出現頻度で重み付けする表。語彙は2拍の言い回しの直積なので、一様に引くと
 * 誰も歌わない組み合わせが混ざる。参考曲に無い形も外さずに低い重みで残す——語彙に無い形の
 * 大半は実在形と発音位置が1〜2個違うだけの微変種。
 */
const CELL_GRID = BASE_STEPS_PER_BAR / 16;
const onsetKeyOf = (value: number[]): string => {
	const on: number[] = [];
	let at = 0;
	for (const v of value) {
		if (v > 0) on.push(Math.round(at / CELL_GRID));
		at += Math.abs(v);
	}
	return on.join(",");
};
/** 参考曲に一度も現れない形の重み。1回だけ出た形の半分。 */
const UNSEEN_CELL_WEIGHT = 0.5;
/**
 * 同じ発音パターンを持つ語彙エントリの数。頻度をエントリ数で割らないと、
 * 直積で何通りにも書ける形だけが出現頻度の何倍も引かれてしまう。
 */
const cellEntryCount = new Map<string, number>();
const cellWeightCache = new Map<number[], number>();
const cellWeight = (c: RhythmCell): number => {
	const cached = cellWeightCache.get(c.value);
	if (cached !== undefined) return cached;
	const key = onsetKeyOf(c.value);
	const w =
		(CORPUS_CELL_WEIGHTS[key] ?? UNSEEN_CELL_WEIGHT) /
		Math.max(1, cellEntryCount.get(key) ?? 1);
	cellWeightCache.set(c.value, w);
	return w;
};

/**
 * 2拍（半小節）の言い回し。モチーフのリズムはここから2つ引いて組み立てる。言い回しの単位は
 * 1小節ではなく2拍なので、2拍で持って組み合わせる。並びの重複がそのまま重み付け。
 */
const HALF_BAR_FIGURES: number[][] = [
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH], // タタタタ
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH],
	[QUARTER, EIGHTH, EIGHTH], // ター・タタ
	[QUARTER, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, QUARTER], // タタ・ター
	[DOT_QUARTER, EIGHTH], // 食い（シンコペーション）
	[DOT_QUARTER, EIGHTH],
	[EIGHTH, QUARTER, EIGHTH], // 頭抜き
	// 4分音符主体・ロングトーン（J-POPの歌い上げるバラード〜ミドル向け。音数過多を是正）
	[QUARTER, QUARTER], // ター・ター
	[QUARTER, QUARTER],
	[HALF], // ターーー
	[HALF],
	[-QUARTER, QUARTER], // 休・ター
	[QUARTER, -QUARTER], // ター・休
	// 弱起（アウフタクト）パターン：末尾から次へ飛び込む言い回し
	[-DOT_QUARTER, EIGHTH], // 3拍半休みからの裏拍アウフタクト
	[-QUARTER, EIGHTH, EIGHTH], // 2拍目裏からのアウフタクト（タタ）
	[QUARTER, -EIGHTH, EIGHTH], // ター・休タ（8分裏弱起）
	// **3+3+2（トレシーヨ）。** 参考曲91本で最も多かった「語彙に無い形」で、
	// 174小節ぶんの穴が空いていた（`scripts/compare-vocabulary.ts` の①）。
	// 付点8分が `[DOT_EIGHTH, SIXTEENTH]` の対でしか入っておらず、
	// 付点8分を2つ並べる形が作れなかった。界隈曲・ボカロの推進力の中心。
	[DOT_EIGHTH, DOT_EIGHTH, EIGHTH],
	[DOT_EIGHTH, DOT_EIGHTH, EIGHTH],
	// 4分音符が全部8分裏に来る形（食い）。参考曲で67小節ぶん取りこぼしていた。
	[-EIGHTH, QUARTER, EIGHTH],
	// 付点8分＋16分（タッカ）。歌モノで非常に多用される跳ね・推進力の型。
	[DOT_EIGHTH, SIXTEENTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, DOT_EIGHTH, SIXTEENTH],
	[DOT_EIGHTH, SIXTEENTH, DOT_EIGHTH, SIXTEENTH],
	// 休符。参考曲の休符率は中央値9%（p25〜p75で3〜16%）。
	// 4分休符のような大休符はメロディをスカスカにするので、短い8分の息継ぎ・頭抜きに絞る。
	[-EIGHTH, EIGHTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, EIGHTH, -EIGHTH],
	[EIGHTH, -EIGHTH, EIGHTH, EIGHTH],
	// 16分。参考曲は音の20%が16分で、8分に次いで多い。
	[SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH, EIGHTH],
	[SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH, EIGHTH],
	[EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH],
	[EIGHTH, EIGHTH, EIGHTH, SIXTEENTH, SIXTEENTH],
	[EIGHTH, SIXTEENTH, SIXTEENTH, QUARTER],
	[SIXTEENTH, SIXTEENTH, SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, SIXTEENTH, SIXTEENTH, SIXTEENTH, SIXTEENTH],
	[SIXTEENTH, SIXTEENTH, EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH],
	[
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
		SIXTEENTH,
	],
	[EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, -EIGHTH],
	[-EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH],
];

/** 2拍の言い回しを2つ並べて1小節のモチーフを作る。 */
const buildMotifCells = (): RhythmCell[] => {
	const unique = HALF_BAR_FIGURES.filter(
		(f, i) =>
			HALF_BAR_FIGURES.findIndex((g) => g.join(",") === f.join(",")) === i,
	);
	const out: RhythmCell[] = [];
	for (const a of HALF_BAR_FIGURES)
		for (const b of unique)
			out.push({ value: [...a, ...b], density: "medium" });
	return out;
};

const HAND_MOTIF_CELLS: RhythmCell[] = [
	// 詰まった8分の王道歌メロ型（6〜8音）。参考曲の中央値 6.2音/小節を支える。
	{
		value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH],
		density: "medium",
	},
	{
		value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, QUARTER],
		density: "medium",
	},
	{
		value: [QUARTER, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH],
		density: "medium",
	},
	{
		value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, QUARTER, QUARTER],
		density: "medium",
	},
	{
		value: [QUARTER, QUARTER, EIGHTH, EIGHTH, EIGHTH, EIGHTH],
		density: "medium",
	},
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
	// シンコペーションのモチーフ。**拍の裏はモチーフ自体が持っていないと曲に出ない。**
	{ value: [EIGHTH, QUARTER, QUARTER, QUARTER, EIGHTH], density: "medium" },
	{ value: [EIGHTH, EIGHTH, DOT_QUARTER, DOT_QUARTER], density: "medium" },
	{ value: [DOT_QUARTER, DOT_QUARTER, EIGHTH, EIGHTH], density: "medium" },
	{ value: [-EIGHTH, EIGHTH, DOT_QUARTER, DOT_QUARTER], density: "medium" },
	{ value: [EIGHTH, DOT_QUARTER, EIGHTH, DOT_QUARTER], density: "medium" },
	// 16分グルーヴの曲用。**モチーフ自体が16分を持たないと、曲の顔にならない。**
	{
		value: [EIGHTH, SIXTEENTH, SIXTEENTH, QUARTER, QUARTER, QUARTER],
		density: "medium",
	},
	{
		value: [SIXTEENTH, SIXTEENTH, EIGHTH, EIGHTH, EIGHTH, HALF],
		density: "medium",
	},
	{
		value: [QUARTER, SIXTEENTH, SIXTEENTH, EIGHTH, HALF],
		density: "medium",
	},
	{
		value: [EIGHTH, EIGHTH, SIXTEENTH, SIXTEENTH, EIGHTH, QUARTER, QUARTER],
		density: "medium",
	},
	{
		value: [
			SIXTEENTH,
			SIXTEENTH,
			EIGHTH,
			SIXTEENTH,
			SIXTEENTH,
			EIGHTH,
			EIGHTH,
			EIGHTH,
			QUARTER,
		],
		density: "medium",
	},
	// **16分が主役の型。**
	{
		value: [
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			EIGHTH,
			QUARTER,
			QUARTER,
		],
		density: "medium",
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
		density: "medium",
	},
	{
		value: [
			EIGHTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			SIXTEENTH,
			QUARTER,
			QUARTER,
		],
		density: "medium",
	},
];

/**
 * モチーフに使うリズム型。2拍の言い回し2つで組み立てたもの（{@link HALF_BAR_FIGURES}）に、
 * シンコペーション・16分・三連の手書きの型を足したもの。
 */
export const MOTIF_CELLS: RhythmCell[] = [
	...buildMotifCells(),
	...HAND_MOTIF_CELLS,
];

for (const c of [...MOTIF_CELLS, ...RHYTHM_CELLS]) {
	const key = onsetKeyOf(c.value);
	cellEntryCount.set(key, (cellEntryCount.get(key) ?? 0) + 1);
}

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
	/**
	 * 答えの小節。問い（モチーフ）を受けて、同じリズムのまま着地音を変える。
	 * 解説の言う「上行フレーズ終わり＝疑問／下行フレーズ終わり＝応答」の応答側。
	 */
	| "answer"
	| "sequence"
	| "climax"
	| "step"
	| "run"
	| "hold"
	| "cadence";

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
/**
 * 曲全体を貫く基準音価（グルーヴ）。「16分を使う曲か、使わない曲か」を曲単位で決める。
 * 小節ごとに独立に引くと、16分の小節が1〜3個だけ孤立して思い付きに聞こえる。
 */
type Groove = "eighth" | "sixteenth";

/**
 * 曲の展開の仕方。
 *
 * - `motif` … 2小節のモチーフを反復・セクエンツ・オクターブ上げに変形して展開する。
 * - `ostinato` … 同じ型を曲全体で回す。変形しない。対比は編曲の側が担う。
 * - `through` … 通し作曲。同じ楽句を再現せず書き進める。
 *
 * `motif` しか無かった頃は反復プロファイルが狭い帯に固定され、通し作曲にも静的なリフにも
 * なれなかった。採点式をどう直しても出ないので、生成の型そのものを増やしてある。
 */
export type MelodyForm = "motif" | "ostinato" | "through";

/**
 * `form` の指定を解く。省略時（`"auto"`）は曲ごとに引く。
 * リフ型を少数派にしてあるのは、歌モノが既定の作風だから。
 */
const resolveMelodyForm = (
	choice: string | undefined,
	rnd: () => number,
): MelodyForm => {
	const c = (choice ?? "").trim() || "auto";
	if (c === "motif" || c === "ostinato" || c === "through") return c;
	const r = rnd();
	if (r < 0.25) return "ostinato";
	if (r < 0.4) return "through";
	return "motif";
};

/**
 * リズム型をグルーヴで絞る。8分の曲からは16分を含む型を丸ごと外し、16分の曲では
 * 16分を含む型を優先する。**16分は曲の性格であって、装飾ではない。**
 */
const groovyCells = (
	cells: RhythmCell[],
	groove: Groove,
	rnd: () => number,
): RhythmCell[] => {
	const hasSixteenth = (c: RhythmCell): boolean =>
		c.value.some((v) => Math.abs(v) <= SIXTEENTH);
	if (groove === "eighth") {
		// **丸ごと外すと薄くなりすぎる。** 16分入りを全部落とすと使える語彙が
		// 平均7.01音→4.60音、8音以上の型は0.9%しか残らない（参考曲の最頻値は8音）。
		// 参考曲も8分の曲で16分を中央値4.1%含む。素の型を地に、1割ほど混ぜる。
		const plain = cells.filter((c) => !hasSixteenth(c));
		const spiced = cells.filter(hasSixteenth);
		if (spiced.length === 0) return plain;
		const out = [...plain];
		const take = Math.max(1, Math.round(plain.length * 0.1));
		for (let i = 0; i < take; i++) out.push(pick(spiced, rnd));
		return out;
	}
	const withSixteenth = cells.filter(hasSixteenth);
	// 16分の曲でも全部の小節を16分で埋めると息が詰まるので、たまに素の型も通す。
	return withSixteenth.length > 0 && rnd() < 0.75 ? withSixteenth : cells;
};

/**
 * 合いの手の言い回し。メロディの隙間へ差し込む短いリズム。隙間を8分で等分して埋めると
 * サブメロが機械的な刻みになるので、等分ではなく言い回しとして置く。
 */
export const ANSWER_FIGURES: number[][] = [
	[EIGHTH, EIGHTH, QUARTER],
	[QUARTER, EIGHTH],
	[EIGHTH, DOT_QUARTER],
	[SIXTEENTH, SIXTEENTH, EIGHTH, QUARTER],
	[EIGHTH, QUARTER, EIGHTH],
	[DOT_QUARTER, EIGHTH],
	[QUARTER, QUARTER],
	[EIGHTH, EIGHTH, EIGHTH, DOT_QUARTER],
	[HALF],
	[QUARTER],
];

/** ベースの奏法。初版はルート4分打ちの1種類しか無かった。 */
type BassStyle =
	| "quarter"
	| "alternate"
	| "half"
	| "eighth"
	| "syncopated"
	| "walking"
	| "octave"
	// --- 以下、ルート始まり以外の型 ---
	/** 5度から入る。ルートは2拍目に置く。 */
	| "fifth-first"
	/** 3度から入る。転回形の響き。 */
	| "third-first"
	/** 拍アタマを抜く。休符で入って8分裏からルートを置く。 */
	| "offbeat"
	/** 16分の刻み。ルート連打で推進力だけを作る。 */
	| "driving"
	/** 1音だけ。小節をまたいで伸ばす。 */
	| "sustain"
	/** 息継ぎのある型。2拍目を空ける。 */
	| "breath"
	// --- 以下、テンプレートが指名したときだけ使う（{@link BASS_STYLES} に入れない） ---
	/** ルートから半音ずつ4つ下がる。減七の上で鳴らす Ghost Fight 型。 */
	| "chromatic-descent"
	/** ルートと5度を16分のシンコペーションで刻む一発リフ。Pepper Steak 型。 */
	| "power-riff";

/**
 * ベースの骨格。奏法（{@link BassStyle}）の上位にある、「1小節をどう扱うか」。
 *
 * 1小節・ルート始まり・毎小節リセットという骨格が全曲同じだと、奏法をいくら増やしても
 * ベース単体を聴いただけで生成器が分かる。骨格の側を引く。
 */
type BassSkeleton =
	/** 毎小節1フレーズ。従来の唯一の骨格。 */
	| "per-bar"
	/** 2小節で1フレーズ。後半の小節は前半と違う形にする。 */
	| "two-bar"
	/** 小節の終わりで次の和音のルートへ半音・全音で入る（アプローチノート）。 */
	| "approach"
	/** ペダル。和音が変わってもベースは主音に留まる。 */
	| "pedal";

/** ベースの奏法の候補。よく使う型ほど多く入れてある。 */
const BASS_STYLES: BassStyle[] = [
	"quarter",
	"quarter",
	"alternate",
	"alternate",
	"half",
	"eighth",
	"eighth",
	"syncopated",
	"syncopated",
	"walking",
	"octave",
	"fifth-first",
	"fifth-first",
	"third-first",
	"offbeat",
	"offbeat",
	"driving",
	"sustain",
	"breath",
	"breath",
];

/**
 * 和声リズム——1つの和音が何小節（何拍）鳴るか。
 *
 * - `bar`  … 1小節1和音。
 * - `half` … 半小節1和音。近年のJ-POP・ボカロの標準的な速度。
 * - `slow` … 2小節1和音。ゆったり構える曲・リフ物。
 */
type HarmonicRhythm = "bar" | "half" | "slow";

const HARMONIC_RHYTHMS: HarmonicRhythm[] = [
	"bar",
	"bar",
	"bar",
	"half",
	"half",
	"slow",
];

const BASS_SKELETONS: BassSkeleton[] = [
	"per-bar",
	"per-bar",
	"two-bar",
	"two-bar",
	"approach",
	"approach",
	"pedal",
];
/**
 * サブメロの書法。
 *
 * - `pad` … 全音符1つ。和音の色を支える。
 * - `long-short` … 付点2分＋4分。
 * - `answer` … 合いの手。メロディが休んでいる隙間にだけ入る。
 * - `harmony` … ハモリ。メロディのリズムをなぞって3度／6度下を歌う。
 * - `counter` … 対旋律。8分でメロディと反行する。
 * - `pedal` … 保続音。小節を通して同じ音を伸ばす。
 */
type SubStyle =
	| "pad"
	| "long-short"
	| "answer"
	| "harmony"
	| "counter"
	| "pedal";

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
	/** 隣接音程のうち順次進行（1〜2半音）が占める比率。歌いやすさの側。 */
	stepRatio: number;
	/** 調の外の音（変化音）が音数に占める比率。0が続くと「調が固定」に聞こえる。 */
	chromaticRatio: number;
	/** メロディの密度（1小節あたりの音数・短い音の比率）。 */
	density: DensityFeatures;
	/** メロディが使った音域（半音）。 */
	melodyRange: number;
	/** サブメロが使った音域（半音）。小さいと旋律になっていない。 */
	submelodyRange: number;
	/** 順序に依存する構造の指標。{@link file://./compose-metrics.ts} 参照。 */
	structure: StructureFeatures;
	/** 緊張カーブの指標（B部で上がるか・終止で解けるか）。 */
	tension: TensionFeatures;
	/** 採点の総合点（0〜1）。{@link WEIGHTS} の加重和を重みの合計で割ったもの。 */
	score: number;
	/** 項目ごとの得点（0〜1）。どこで点を落としたかを調べるために持つ。 */
	scoreBreakdown: Record<string, number>;
	/** 引いた候補の数。 */
	attempts: number;
	/** ハード制約で捨てられた候補の数。 */
	rejected: number;
	/**
	 * この曲の特徴ベクトル。次に作曲するとき {@link ComposeOptions.recent} へ
	 * 渡すと、「前と似た曲」が出にくくなる。
	 */
	fingerprint: number[];
};

export type ComposeOptions = {
	/** 1小節のステップ数。DAW の renderConfig.stepsPerBar をそのまま渡す。 */
	stepsPerBar: number;
	/** 曲の音律。省略時は12平均律。 */
	edo?: number;
	/** 乱数源。テストから決定的な値を注入するために差し替えられる。 */
	random?: () => number;
	/**
	 * 直近に作った曲の特徴ベクトル（{@link ComposeStats.fingerprint}）。指標に最適化すると
	 * 全曲が同じ統計値へ寄るので、それらから離れている候補に加点する（{@link WEIGHTS.novelty}）。
	 */
	recent?: number[][];
	/** 引く候補の数。既定 {@link DRAW_COUNT}。 */
	drawCount?: number;
	/**
	 * 作るセクション。省略時は {@link DEFAULT_SECTIONS}。並び順は指定によらず
	 * `SECTION_ORDER` に従う。
	 */
	sections?: SectionKind[];
	/**
	 * 曲構成テンプレート名（"1chorus" | "jpop_standard" | "jpop_drop" | "vocaloid" | "verse_chorus" | "game_loop"）。
	 * 指定時は sections より優先され、2コーラスやCメロ、落ちサビなどの王道構成を展開する。
	 */
	template?: string;
	/**
	 * ベースとなる調・雰囲気の指定（"any" | "major" | "minor" | "mood_*" | "key_*"）。
	 * 省略時は "any"（全24調からランダム抽選）。
	 */
	baseKey?: string;
	/**
	 * 展開の仕方（`"auto"` | `"motif"` | `"ostinato"`）。省略時は `"auto"` で曲ごとに引く。
	 * `"ostinato"` は同じ型を曲全体で回すリフ主体の作り。{@link MelodyForm}
	 */
	form?: string;
	/**
	 * 音階の指定（`"auto"` | `"any"` | 音階ID）。`"auto"` はベース調の長短に合わせて
	 * 陽音階（長調）／民謡音階（短調）を使う。{@link COMPOSE_SCALES}
	 */
	scale?: string;
};

export type ComposeResult = {
	/** 伴奏トラック用のコード進行文字列。`buildChordPlacements` へそのまま渡せる。 */
	chordProgression: string;
	/** 伴奏の奏法。 */
	chordPattern: ChordPatternType;
	/**
	 * 曲の調。ハ長調からの移調量（半音）。メロディ・サブメロ・ベースの音は既に移調済みなので、
	 * 呼び出し側は伴奏トラックの `rootShift` へ同じ値を渡すだけでよい。
	 */
	rootShift: number;
	/** 曲の調の名前（例: "C", "D", "Am"）。 */
	keyName: string;
	/** 曲の調の表示ラベル（例: "ハ長調 (C)", "イ短調 (Am)"）。 */
	keyLabel: string;
	/** 曲の音階の識別子（例: "yo", "ryukyu"）。{@link COMPOSE_SCALES} */
	scaleId: ComposeScaleId;
	/** 曲の音階の表示ラベル（例: "琉球音階"）。 */
	scaleLabel: string;
	/** 曲の展開の仕方。{@link MelodyForm} */
	form: MelodyForm;
	/** 雰囲気カテゴリのラベル（該当する場合）。 */
	moodLabel?: string;
	/** 曲のテンポ（BPM）。 */
	bpm: number;
	/** 曲の設計図。どの小節がどのセクションかを表す。 */
	sections: PlacedSection[];
	/** 曲の長さ（小節）。セクションの選び方で変わる。 */
	bars: number;
	/** 歌の割り当て（ハモリ・デュエット）。{@link VocalPlan} */
	vocal: VocalPlan;
	/** 調のふるまい（平行調・トニック回避）。{@link TonalPlan} */
	tonal: TonalPlan;
	/** 曲に合わせて組み込みから自動選択されたドラムパターン名（DRUM_PATTERNS のキー）。 */
	drum: string;
	/** 曲に合わせて組み込みから自動選択された楽器プリセット名（INSTRUMENT_PRESETS のキー）。 */
	instrument: string;
	melody: ComposedNote[];
	submelody: ComposedNote[];
	bass: ComposedNote[];
	/** ハモリトラック。メロディの3度/6度上。サビセクションでのみ鳴る。 */
	harmony: ComposedNote[];
	/** 2声目のハモリ。{@link VocalPlan.harmony2} が true のときだけ中身が入る。 */
	harmony2: ComposedNote[];
	/**
	 * 主旋律のオクターブ下の重ね（{@link VocalPlan.octaveLayer}）。音高は主旋律の
	 * ままで、トラック側のオクターブ設定で下げる。要所だけなので主旋律の一部。
	 */
	octave: ComposedNote[];
	/** コードパッド。ストリングス/シンセパッド的なロングトーン。Bメロ以降で鳴る。 */
	pad: ComposedNote[];
	/**
	 * 間奏の器楽ソロ。間奏の小節にしか音が入らないので、専用トラックへそのまま書き込めば
	 * その1本だけ別の楽器に割り当てられる。歌メロと同時には鳴らない。
	 */
	solo: ComposedNote[];
	/**
	 * 上級者モードの編曲プラン。どの層をどのセクションでどの奏法で鳴らすか。
	 * {@link ArrangePlan}
	 */
	arrange: ArrangePlan;
	stats: ComposeStats;
};

// ============================================================
// 生成
// ============================================================

const pick = <T>(items: T[], rnd: () => number): T =>
	items[Math.floor(rnd() * items.length)];

/**
 * 32bit の種から決定的な乱数列を作る（mulberry32）。{@link ComposeOptions.random} へ渡す。
 * 同じ種なら同じ曲が出るので、MML に種を埋めておけば（`#seed=`）後から再現できる。
 */
export const seededRandom = (seed: number): (() => number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

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
	/**
	 * 和音の色を出す音（3度・7度＝重み2）があるなら、そちらを優先する。`minWeight` を下げる
	 * だけではルート・5度が候補に残って結局そちらが選ばれ、和音が動いても緊張が上がらない。
	 * 「許す」ではなく「選ぶ」に変えるためのフラグ。
	 */
	preferColor = false,
): ScaleDegree => {
	const candidates = tones.filter((t) => t.weight >= minWeight);
	const colored = preferColor ? tones.filter((t) => t.weight === 2) : [];
	const pool =
		colored.length > 0 ? colored : candidates.length > 0 ? candidates : tones;
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

/**
 * 歌える音域の絶対の上限・下限（半音・MIDIノート番号相当）。C4〜A5。歌声合成が出せる範囲
 * そのものなので曲ごとに動かさない。動くのはこの中のどこを使うか（{@link Register}）。
 */
const MELODY_LOW = 59;
const MELODY_HIGH = 83;

/**
 * その曲・そのセクションでメロディが使う音域。中心も幅も曲ごとに引く。
 *
 * 中心が定数だと全曲が同じ高さで歌う。音域の中心は「声の高さ」としてそのまま耳に残るので、
 * 何曲聴いても同じ歌い手に聞こえる——曲ごとに変わらない部分が生成器の指紋になる。
 * 幅は、狭い窓（12半音）がリフ型・語り口調、広い窓（21半音）が歌い上げる曲になる。
 */
type Register = {
	low: number;
	high: number;
	/** 大きなうねり（{@link MelodyStyle.contour}）が振れる基準の高さ。 */
	center: number;
};

/**
 * 中心と幅から音域の窓を作る。**絶対の上限・下限からはみ出す分は押し戻す**——
 * 高い窓を引いた曲がそのまま歌えない高さへ出ていくのを防ぐ。
 */
const makeRegister = (center: number, width: number): Register => {
	const half = width / 2;
	let lo = Math.round(center - half);
	let hi = Math.round(center + half);
	if (lo < MELODY_LOW) {
		hi += MELODY_LOW - lo;
		lo = MELODY_LOW;
	}
	if (hi > MELODY_HIGH) {
		lo -= hi - MELODY_HIGH;
		hi = MELODY_HIGH;
	}
	lo = Math.max(MELODY_LOW, lo);
	hi = Math.min(MELODY_HIGH, hi);
	return { low: lo, high: hi, center: (lo + hi) / 2 };
};

/**
 * 音域の窓を平行移動する（セクションごとの {@link SectionSpec.registerShift} 用）。
 * 幅は変えずに動かし、絶対の範囲で止める。
 */
const shiftRegister = (reg: Register, semitones: number): Register =>
	semitones === 0
		? reg
		: makeRegister(reg.center + semitones, reg.high - reg.low);

/**
 * 曲全体を貫く音高のうねりの形。
 *
 * 正弦波1種類でパラメータだけ引いていると、「上げて下げてを等間隔で繰り返す」動きが癖として
 * 耳に残る。写像が1本しか無い限り指紋は消えないので、形そのものを引く。
 */
type ContourShape =
	/** 正弦波。上げ下げを等間隔で繰り返す。従来の唯一の形。 */
	| "sine"
	/** 階段状の台地。数小節ごとに高さを変えて、その中では留まる。 */
	| "terrace"
	/** 単峰。曲の後半（6〜7割の位置）に一度だけ頂点を取る。歌モノの王道。 */
	| "peak"
	/** 下降の反復。高いところから降りてきて、また高いところへ戻る。 */
	| "descend"
	/** ほぼ動かない。リフ・オスティナート・語り口調の曲。 */
	| "flat";

const CONTOUR_SHAPES: ContourShape[] = [
	"sine",
	"terrace",
	"terrace",
	"peak",
	"peak",
	"descend",
	"flat",
];

/**
 * 輪郭の高さ（−1〜+1）。{@link MelodyStyle.arcAmp} を掛けて音域の中心からのずれ（半音）に
 * なる。セクション境界とは独立——セクションごとの高さは {@link SectionSpec.registerShift}
 * が持ち、ここは窓の中での大きな動きを担当する。
 */
const contourAt = (
	shape: ContourShape,
	bar: number,
	totalBars: number,
	period: number,
	phase: number,
): number => {
	switch (shape) {
		case "sine":
			return Math.sin(((bar + phase) / period) * Math.PI * 2);
		case "terrace": {
			// 台地の高さは周期ごとに切り替わる。−1 → +0.5 → 0 → +1 を巡回して、
			// 「留まる・上がる・落ち着く・いちばん上」という段を作る。
			const steps = [-1, 0.5, 0, 1, -0.5, 0.75];
			return steps[Math.floor((bar + phase) / period) % steps.length];
		}
		case "peak": {
			// 単峰。頂点は曲の 2/3 あたり。そこへ向かって上がり、そこから降りる。
			const at = totalBars <= 1 ? 0 : bar / (totalBars - 1);
			const top = 0.66;
			return at <= top
				? -1 + (at / top) * 2
				: 1 - ((at - top) / Math.max(0.01, 1 - top)) * 1.4;
		}
		case "descend": {
			// 周期のあたまで跳ね上がり、そこから降りる（下降フレーズの反復）。
			const at = ((bar + phase) % period) / period;
			return 1 - at * 2;
		}
		case "flat":
			// 完全な水平にはしない。**0 で固定すると全曲が同じ高さに揃ってしまい、
			// 指紋を1つ減らすつもりが別の指紋を作る。** 周期の長いごく浅い揺れを残す。
			return (
				Math.sin(((bar + phase) / Math.max(8, period * 2)) * Math.PI * 2) * 0.2
			);
	}
};

/**
 * ハモリの音を選ぶ。平行3度を並べるのではなく、「似ているが別の旋律線」を書く。
 *
 * 参考曲のハモリには動き方が2種類ある。
 *
 * - 静的 … 主旋律が跳ねている間もハモリは同じ音に留まる。その結果として音程が刻々と変わり、
 *   ユニゾンにも完全4度にもなる
 * - 並走 … 主旋律と同じだけ動く、いわゆる3度・6度ハモリ
 *
 * 度数を固定して平行移動させる書き方では静的が作れず、直前の音に貼り付ける書き方では並走が
 * 作れない。両方を生成の幅として持つ。平行ハモリを前提にした規則（完全5度を避ける等）は、
 * そのまま当てはめると実際に使われている形を落とすので採らない。
 */
const harmonyPitch = (
	/**
	 * 曲の音階。ハモリも歌声なので、音階の外を歌えばその曲の音階の色が薄まる。ハモリは和音
	 * 構成音から選ぶ作りなので、音階に無い音が和音の側から供給されてしまう。本物の5音音階
	 * （{@link ComposeScale.strict}）ではそこに罰則を置く。
	 */
	scale: ComposeScale,
	melodySemi: number,
	tones: ChordTone[],
	/** 直前のハモリの音。無ければ null。 */
	prevHarmony: number | null,
	/** 曲ごとの居場所（主旋律から何半音ずれた辺りに置くか）。負が下。 */
	offset: number,
	/** 主旋律と同じだけ動く並走ハモリか。false なら動かない静的ハモリ。 */
	parallel: boolean,
	/**
	 * 同時に鳴るもう1声（3声のときの1声目）。ハモリどうしも協和する——主旋律との関係だけで
	 * 独立に決めると、ここが濁る。
	 */
	against: number | null,
): ScaleDegree => {
	// 探す範囲は居場所の周り。上ハモの曲で上を切ると、6度上（+9）が作れない。
	const lo = Math.max(-12, Math.min(offset, 0) - 7);
	const hi = Math.min(12, Math.max(offset, 0) + 7);
	let best: ScaleDegree | null = null;
	let bestCost = Number.POSITIVE_INFINITY;
	for (const tone of tones) {
		const pc = pitchClass(tone.semi);
		for (let oct = 0; oct <= 10; oct++) {
			const semi = pc + oct * 12;
			const delta = semi - melodySemi;
			if (delta > hi || delta < lo) continue;
			const move = prevHarmony === null ? 0 : Math.abs(semi - prevHarmony);
			// 静的は「動かないこと」を、並走は「居場所を保つこと」を優先する。
			// 静的側は、参考曲のハモリが「よく動くが1〜2半音ずつ」なので
			// 順次進行をほぼ無料にして跳躍だけ高くする。
			const stay = parallel
				? move * 0.06
				: move <= 2
					? move * 0.04
					: 0.1 + (move - 2) * 0.9;
			// もう1声との音程。3度・6度・5度を良しとし、同じ音名（ユニゾン・
			// オクターブ）は3声に聞こえないので少し避ける。参考曲でも +12 は14%で、
			// 3度・6度・5度が7割を占める。
			let clash = 0;
			if (against !== null) {
				const g = Math.abs(semi - against) % 12;
				clash =
					g === 3 || g === 4 || g === 8 || g === 9 || g === 7
						? 0
						: g === 0
							? 0.5
							: 1.2;
			}
			// 和音構成音であっても音階の中核から外れていれば重く見る。1.5 は
			// 「居場所が2半音ずれる」よりやや重く、「3度が5度に変わる」より軽い——
			// 音階に居る構成音があればそちらを選び、無ければ諦めて和音に従う。
			const offCore = scale.strict && isOutsideCore(scale, semi) ? 1.5 : 0;
			const cost =
				stay +
				clash +
				offCore +
				Math.abs(delta - offset) * (parallel ? 1.4 : 0.7) +
				(3 - tone.weight) * 0.4;
			if (cost < bestCost) {
				bestCost = cost;
				best = { semi, fifth: tone.fifth };
			}
		}
	}
	return best ?? nearestChordTone(melodySemi + offset, tones, 2);
};
/** サブメロの音域。メロディの下・ベースの上に置く。 */
const SUBMELODY_LOW = 55;
const SUBMELODY_HIGH = 74;
/**
 * ベースの音域。**平均音高が C3(48) を下回るようにする**——おまかせマスタリングの
 * 役割推定がこのしきい値でベースを判定するため、ここを外すと楽器が当たらなくなる。
 */
const BASS_LOW = 33;
const BASS_HIGH = 45;

// ベースの強弱。初版は「小節頭108・それ以外96」の2値しか無く、どの音も同じ強さで
// 並ぶ＝グルーヴが生まれない状態だった。実際のベースは拍の重み付けとゴーストで
// リズムを作るので、4段階に分ける。
/** キックが居る拍（1拍目・3拍目）。曲の芯になる打点。 */
const BASS_ACCENT_VELOCITY = 112;
/** その他の拍頭。 */
const BASS_BEAT_VELOCITY = 98;
/** 拍の裏。 */
const BASS_OFFBEAT_VELOCITY = 86;
/**
 * ゴースト（デッドノート）。極端に弱くすることで、再生側のベロシティ→明るさ連動が
 * カットオフを1kHz付近まで落とし、音程感の薄いくぐもった打点になる。
 */
const BASS_GHOST_VELOCITY = 44;

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
	/** 曲全体の基準音価。16分を使う曲かどうかを曲単位で決める。 */
	groove: Groove;
	/**
	 * **その曲が使う音域の窓**（{@link Register}）。セクションごとに
	 * {@link SectionSpec.registerShift} で上下する前の、曲の基準の高さ。
	 */
	register: Register;
	/** 大きなうねりの形（{@link ContourShape}）。 */
	contour: ContourShape;
	/**
	 * 小節頭を非和声音にする確率（掛留・倚音）。小節頭が必ず和音構成音だと、「小節頭が和音の
	 * 外」という曲が1本も出ないという意味で指紋になる。アボイドノート（{@link toneWeight} が
	 * 0）にはしない——そこは避けられているから避けられているので、緊張ではなく事故になる。
	 */
	headTension: number;
	/**
	 * 大きなうねりの周期（小節）。上げるフレーズと下げるフレーズを交互に置くための、
	 * 曲全体を貫く音高の波。4なら2小節上げて2小節下げる、8なら4小節ずつ。
	 */
	arcPeriod: number;
	/** うねりの位相（小節）。上げから始まるか下げから始まるか。 */
	arcPhase: number;
	/** うねりの振幅（半音）。 */
	arcAmp: number;
	/** 弱拍でオクターブ跳躍を入れる確率。 */
	octaveAffinity: number;
	/** その曲で許す跳躍の上限（半音）。{@link LEAP_CEILINGS} */
	maxLeap: number;
	/**
	 * モチーフをペンタトニックの度数で組むか。全曲をそれで通すとファ・シが一切出なくなり、
	 * 半音の動きも一緒に消えて平坦な線になる。制約は曲単位で掛け、掛けない曲も混ぜる。
	 */
	pentatonicMotif: boolean;
	runShape: RunShape;
	stepShape: StepShape;
	holdShape: HoldShape;
	cadenceShape: CadenceShape;
	/** 弱拍で跳躍を混ぜる確率。 */
	leapAffinity: number;
	/**
	 * 調の外の音（変化音）を使う度合い。{@link applyChromatic} 参照。0 の曲も混ぜる——全曲に
	 * 半音を撒くと今度はどの曲も同じ「半音まみれ」の顔になる。
	 */
	chromaticAffinity: number;
	/** 強拍で着地させる構成音の重み下限（3=ルート/5度のみ、2=3度/7度も許す）。 */
	barHeadWeight: 2 | 3;
	bassStyle: BassStyle;
	/** ベースの骨格（{@link BassSkeleton}）。奏法より上位の、1小節の扱い方。 */
	bassSkeleton: BassSkeleton;
	/** 2小節フレーズの後半に使う奏法。骨格が `two-bar` のときだけ使う。 */
	bassStyleAlt: BassStyle;
	/** ベースを短く切って弾むように弾くか（スタッカート）。 */
	bassStaccato: boolean;
	/** 小節にゴーストノート（弦に触れて音程を殺した打点）を混ぜる確率。 */
	bassGhost: number;
	subStyle: SubStyle;
	/** サブメロがメロディから何半音下を歌うか。 */
	subInterval: number;
};

/**
 * 跳躍の着地点を探す。和音の構成音の中からしか選ばない（「跳躍進行はコードトーン間に限る」
 * の実装）。3〜9半音離れた構成音から近いものを優先し、無ければ跳ばない。
 */
const leapTarget = (
	from: number,
	tones: ChordTone[],
	rnd: () => number,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
	/** その曲で許す跳躍の上限（半音）。{@link LEAP_CEILINGS} */
	maxLeap: number = MAX_LEAP_SEMITONES,
): number | null => {
	const candidates: number[] = [];
	for (const tone of tones) {
		const base = pitchClass(tone.semi);
		for (let oct = 0; oct <= 10; oct++) {
			const semi = base + oct * 12;
			if (semi < reg.low || semi > reg.high) continue;
			const gap = Math.abs(semi - from);
			if (gap >= 3 && gap <= maxLeap) candidates.push(semi);
		}
	}
	if (candidates.length === 0) return null;
	// **オクターブを厚く引く。** 参考曲の隣接音程はオクターブが17%を占めていて、
	// 2度の次に多い。この様式の顔になっている跳躍なので、「大跳躍は控えめに」
	// という一般論のまま近い跳躍だけ引くと再現できない。
	const octaves = candidates.filter((c) => Math.abs(c - from) === 12);
	const near = candidates
		.filter((c) => Math.abs(c - from) < 12)
		.sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
	const weighted = [
		...octaves,
		...octaves,
		...octaves,
		...near.slice(0, Math.max(2, Math.ceil(near.length / 2))),
	];
	return pick(weighted.length > 0 ? weighted : candidates, rnd);
};

/**
 * フレーズの最後の音を、指定の音階度数へ着地させる。主音へ落とせば解決、主音以外
 * （2度・5度）で止めればまだ続く、という言い分けになる。
 */
const landOn = (
	scale: ComposeScale,
	degrees: number[],
	scaleIndex: number,
): void => {
	if (degrees.length === 0) return;
	const size = scaleSize(scale);
	const last = degrees[degrees.length - 1];
	const index = ((last % size) + size) % size;
	let delta = scaleIndex - index;
	// 近い方へ寄せる（7度上ではなく2度下、のように）。
	if (delta > size / 2) delta -= size;
	if (delta < -size / 2) delta += size;
	degrees[degrees.length - 1] = last + delta;
};

/**
 * 音高が確定した後に、フレーズの最後の音を着地音へ確定させる。度数の段階で決めても
 * {@link shapeBar} の跳躍制限・gap fill が書き換えてしまうので、最後に上書きし直す。
 */
const landPitch = (
	scale: ComposeScale,
	pitches: number[],
	scaleIndex: number,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
): void => {
	if (pitches.length === 0) return;
	const size = scaleSize(scale);
	const last = pitches[pitches.length - 1];
	const degree = semitoneToDegree(scale, last);
	const index = ((degree % size) + size) % size;
	let delta = scaleIndex - index;
	if (delta > size / 2) delta -= size;
	if (delta < -size / 2) delta += size;
	pitches[pitches.length - 1] = clampSemi(
		degreeToPitch(scale, degree + delta).semi,
		reg.low,
		reg.high,
	);
};

/**
 * 1小節分の音の並び（度数）を、役割と書法から作る。ここではまだ音域も跳躍制限も見ない
 * ——形を作るのが仕事で、整えるのは {@link shapeBar} の役目。
 */
const barDegrees = (
	role: BarRole,
	slots: Slot[],
	tones: ChordTone[],
	style: MelodyStyle,
	/** 曲の音階。モチーフの輪郭はこの中核音の歩数で組み立てる。 */
	scale: ComposeScale,
	motifContour: number[],
	startDegree: number,
	/**
	 * この小節が輪郭のどこから始まるか。モチーフは2小節でひとまとまりなので、2小節目は1小節目
	 * の続きから読む。常に0にすると2小節の楽句にならない。
	 */
	contourOffset: number,
	/** 直前の小節もモチーフだったときにずらす度数。同じ小節が2つ並ぶのを避ける。 */
	repeatShift: number,
	/** この小節で強拍に着地させる構成音の重み下限。B部だけ緩める。 */
	barHeadWeight: 2 | 3,
	/** 強拍で和音の色を出す音（3度・7度）を優先するか。B部だけ true。 */
	preferColor: boolean,
	/** 4分音符のステップ数。「長い音」の判定に使う。 */
	quarterSteps: number,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
	rnd: () => number,
): number[] => {
	const noteCount = slots.length;
	const out: number[] = [];

	if (
		role === "motif" ||
		role === "sequence" ||
		role === "climax" ||
		role === "answer"
	) {
		// モチーフの輪郭をそのまま乗せる。sequence は音程ごとずらし、climax は1オクターブ上げる
		// ——「同じ型に別の音を当てはめる」のではなく「同じアイデアを別の文脈で置き直す」のが狙い。
		// 組み立てはペンタトニックの歩数で数える。ダイアトニックの度数だと「1つ上」がミ→ファ
		// （半音）にもなり、移調するたびにファやシが紛れ込んで歌えない形へ化ける。
		const shift =
			(role === "sequence"
				? pick([-2, -1, 1, 2], rnd)
				: role === "climax"
					? 5 // ペンタトニックの5歩＝1オクターブ
					: 0) + repeatShift;
		if (style.pentatonicMotif) {
			const startCore = degreeToCore(scale, startDegree);
			for (let i = 0; i < noteCount; i++)
				out.push(
					coreToDegree(
						scale,
						startCore +
							shift +
							motifContour[(contourOffset + i) % motifContour.length],
					),
				);
		} else {
			// ダイアトニックで組む曲。ファ・シが輪郭の中に入るので、
			// 半音の動きと、ペンタトニックでは出ない2度の並びが出る。
			for (let i = 0; i < noteCount; i++)
				out.push(
					startDegree +
						shift +
						motifContour[(contourOffset + i) % motifContour.length],
				);
		}
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
				.map((t) => semitoneToDegree(scale, clampSemi(t.semi, 60, 71)))
				.sort((a, b) => a - b);
			for (let i = 0; i < noteCount; i++) {
				const oct = Math.floor(i / arp.length) * scaleSize(scale);
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
		const tonic = semitoneToDegree(scale, clampSemi(72, reg.low, reg.high));
		for (let i = 0; i < noteCount; i++) {
			if (style.cadenceShape === "descend") {
				out.push(tonic + noteCount - 1 - i);
			} else if (style.cadenceShape === "five-three-one") {
				// ソ→ミ→ド。分散和音で降りる古典的な終止。
				const shape = [4, 2, 0];
				out.push(tonic + shape[Math.min(i, shape.length - 1)]);
			} else if (style.cadenceShape === "leap-up") {
				// 下からソ→ドへ跳ね上がって終わる。
				out.push(
					i === noteCount - 1
						? tonic
						: tonic - scaleSize(scale) + Math.min(i, 4),
				);
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
	// 界隈曲らしさ：モチーフの内部構造（音程カーブ）を和音の都合で破壊しない。
	for (let i = 0; i < out.length; i++) {
		if (!slots[i].isStrong) continue;
		out[i] = semitoneToDegree(
			scale,
			nearestChordTone(
				degreeToPitch(scale, out[i]).semi,
				tones,
				barHeadWeight,
				preferColor,
			).semi,
		);
	}

	// **音価と音の動きを対応させる。** 歌メロの定石として「短い音符では順次進行か同音連打、
	// 長い音符では跳躍」がある（細かい音で跳ぶと歌えないし、長い音が順次に動くと平坦）。
	// 音価と無関係に跳躍を撒くと、16分の走句の途中で唐突に跳ぶ「人が書かない形」が出る。
	for (let i = 1; i < out.length - 1; i++) {
		if (slots[i].isStrong) continue;
		if (slots[i].value >= quarterSteps) {
			// 長い音 → 跳躍。直後は shapeBar の gap fill が反行の順次進行で埋める。
			// **跳ぶ先は和音の構成音に限る**（跳躍進行はコードトーン間に限れ、の定石）。度数を適当に
			// 足すと、和音と関係ない音へ着地して跳躍のたびに調子外れに聞こえる。
			if (rnd() < style.leapAffinity) {
				const from = degreeToPitch(scale, out[i - 1]).semi;
				const target = leapTarget(from, tones, rnd, reg, style.maxLeap);
				if (target !== null) out[i] = semitoneToDegree(scale, target);
			}
			continue;
		}
		// 短い音 → 順次進行、または同音連打。
		// 同音連打は歌メロで頻出だが、初版は実測 7.6%（参考曲は10.3%）と少なかった。
		if (rnd() < 0.22) out[i] = out[i - 1];
		else if (Math.abs(out[i] - out[i - 1]) > 2)
			out[i] = out[i - 1] + Math.sign(out[i] - out[i - 1]);
	}
	return out;
};

/**
 * モチーフを塊ごと和音に合わせる。音を1つずつ和音へ寄せると、同じモチーフでも和音が変わる
 * たびに別の形へ化ける。形はそのままに置く高さを変えて合わせる——強拍の音がどれだけ和音
 * 構成音に乗るか（重み付き）と、直前の音とのつながりで移調量を選ぶ。
 */
const fitMotif = (
	degrees: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	quarterSteps: number,
	/** 曲の音階。移調も中核音の歩数で数える。 */
	scale: ComposeScale,
	/** ペンタトニックの歩数で移調するか。ダイアトニックで組んだモチーフには掛けない。 */
	pentatonic: boolean,
	/**
	 * 同じ素材を置いた小節が前に使った移調量。輪郭が返ってきたと耳で分かるのは同じ高さで返って
	 * きたときだけで、度数の並びが同じでも移調量が違えば音程の並びが変わる（ドレミ→レミファ は
	 * 2,2半音 が 2,1半音 になる）。和音の当たりが大きく悪化しないかぎり前と同じ移調量を使う。
	 */
	preferShift: number | null,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
	/**
	 * 小節の後半で鳴る和音（{@link HarmonicRhythm} が `half` のとき）。モチーフの小節は
	 * {@link shapeBar} の和音補正を通らない（`preserveContour`）ので、両方の和音に当たる
	 * 移調量をここで選んでおかないと後半が和音とぶつかる。
	 */
	tonesLate: ChordTone[] | null,
	/** 後半の和音へ切り替わるステップ位置。 */
	lateAt: number,
	/**
	 * 移調を何歩まで許すか。既定は3歩（ペンタトニックなら±7半音相当）。0 を渡すと輪郭が一切
	 * 動かない——リフ型（{@link MelodyForm}）で使う。和音が変わっても同じセルを回し続けるのが
	 * オスティナートなので、小節ごとに寄せるとその時点で別の作りになる。
	 */
	maxShift = 3,
): { degrees: number[]; shift: number } => {
	let best = degrees;
	let bestShift = 0;
	let bestScore = Number.NEGATIVE_INFINITY;
	let preferScore = Number.NEGATIVE_INFINITY;
	let preferMoved: number[] | null = null;
	// ペンタトニックで組んだモチーフは**ペンタトニックの歩数**で移調する。
	// ダイアトニックの度数で ±1 するとミ→ファのような半音移動が混ざり、輪郭が崩れる。
	// 逆に、ダイアトニックで組んだモチーフをペンタトニックの歩数で動かすと、
	// せっかく輪郭に入れたファ・シがその場で潰れる（実測でペンタ外が9%から動かなかった）。
	for (let shift = -maxShift; shift <= maxShift; shift++) {
		const moved = degrees.map((d) =>
			pentatonic
				? coreToDegree(scale, degreeToCore(scale, d) + shift)
				: d + shift,
		);
		let score = 0;
		for (let i = 0; i < moved.length; i++) {
			const semi = clampSemi(
				degreeToPitch(scale, moved[i]).semi,
				reg.low,
				reg.high,
			);
			const w = toneWeight(
				semi,
				tonesLate && slots[i].at >= lateAt ? tonesLate : tones,
			);
			// 強拍と長い音は和音構成音であってほしい。弱拍の経過音は自由。
			const important = slots[i].isStrong || slots[i].value >= quarterSteps;
			score += important ? w * 3 : w;
		}
		// 前の小節からのつながり。跳びすぎる置き方は避ける。
		const head = clampSemi(
			degreeToPitch(scale, moved[0]).semi,
			reg.low,
			reg.high,
		);
		score -= Math.max(0, Math.abs(head - prevSemi) - MAX_BAR_LEAP_SEMITONES);
		if (shift === preferShift) {
			preferScore = score;
			preferMoved = moved;
		}
		if (score > bestScore) {
			bestScore = score;
			bestShift = shift;
			best = moved;
		}
	}
	// 前と同じ移調量が「まずまず」なら、そちらを採る。1音ぶんの重み（3点）まで譲る。
	if (preferMoved !== null && preferScore >= bestScore - 3)
		return { degrees: preferMoved, shift: preferShift as number };
	return { degrees: best, shift: bestShift };
};

/**
 * 度数の列を、実際に鳴らせる音の列へ整える。音域へ畳み込む→小節またぎ／小節内の跳躍を上限で
 * 抑える→跳躍の直後を反行の順次進行で埋める（gap fill）→強拍・長い音価のアボイドノートを
 * 隣のスケール音へ逃がす。
 */
const shapeBar = (
	degrees: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	opts: {
		allowLeap: boolean;
		allowArpeggio: boolean;
		quarterSteps: number;
		/** 曲の音階。中核音の外へ出た音を整理するのに要る。 */
		scale: ComposeScale;
		/** 弱拍でオクターブ跳躍を入れる確率。 */
		octaveAffinity: number;
		/** その曲で許す跳躍の上限（半音）。{@link LEAP_CEILINGS} */
		maxLeap: number;
		/** アボイドノートを半音上の和音構成音へ解決させる確率。 */
		chromaticAffinity: number;
		/** その小節で使う音域（{@link Register}）。 */
		register: Register;
		/**
		 * 小節の後半で鳴る和音（{@link HarmonicRhythm} が `half` のとき）。
		 * `null` なら小節を通して `tones` のまま。
		 */
		tonesLate?: ChordTone[] | null;
		/** 後半の和音へ切り替わるステップ位置。 */
		lateAt?: number;
		rnd: () => number;
		/**
		 * モチーフの輪郭をそのまま鳴らす。通常は音を1つずつ和音へ寄せる（強拍の着地・gap fill・
		 * アボイド回避）が、モチーフの小節でそれをやると同じモチーフが和音ごとに別の形へ化けて、
		 * 聴き手にはフックが繰り返されていると分からない。モチーフは塊ごと移調して合わせる
		 * （{@link fitMotif}）ので、ここでは音域に収めるだけにする。
		 */
		preserveContour?: boolean;
	},
): number[] => {
	const out: number[] = [];
	let prev = prevSemi;
	if (opts.preserveContour) {
		// **音域へは塊ごと収める。** 1音ずつ折り返すと、オクターブ跳躍のように
		// 音域の端をまたぐ動きがその場で潰れ、跳んだ先が跳ぶ前と同じ音になる
		// （実測でオクターブの隣接音程が 4% 止まりだった原因）。輪郭を保つのが
		// この分岐の役目なので、収める操作も輪郭を壊さない形で行う。
		const raw = degrees.map((d) => degreeToPitch(opts.scale, d).semi);
		const lo = Math.min(...raw);
		const hi = Math.max(...raw);
		let shift = 0;
		while (lo + shift < opts.register.low) shift += 12;
		while (hi + shift > opts.register.high) shift -= 12;
		// 塊が音域より広いときだけ、はみ出した音を1つずつ折り返す。
		for (const semi of raw)
			out.push(
				semi + shift >= opts.register.low && semi + shift <= opts.register.high
					? semi + shift
					: clampSemi(semi + shift, opts.register.low, opts.register.high),
			);
		return out;
	}
	for (let i = 0; i < degrees.length; i++) {
		// 半小節で和音が動く曲では、後半の音は**後半の和音**に対して整える。
		// ここを小節頭の和音のままにすると、2つ目の和音の上で旋律だけが
		// 前の和音に留まる（半小節進行を入れた意味が消える）。
		const barTones =
			opts.tonesLate && slots[i].at >= (opts.lateAt ?? Number.POSITIVE_INFINITY)
				? opts.tonesLate
				: tones;
		let semi = clampSemi(
			degreeToPitch(opts.scale, degrees[i]).semi,
			opts.register.low,
			opts.register.high,
		);
		// **小節をまたぐ跳躍もその曲の上限に従う。**
		// ここが定数 {@link MAX_BAR_LEAP_SEMITONES}(10) のままだったので、
		// 跳躍上限5半音の曲でも小節の頭だけ10半音跳べてしまい、**最大跳躍の下限が
		// 10から下がらなかった**（参考コーパスは p25 が 7）。
		const limit =
			i === 0
				? Math.min(MAX_BAR_LEAP_SEMITONES, opts.maxLeap + 2)
				: opts.maxLeap;
		// **サビの小節でも青天井にはしない。** `allowLeap` は「跳躍を許す」であって
		// 「際限なく跳ぶ」ではない。ここが無制限だった間、`climax` の小節が
		// 音域いっぱいの跳躍を作り、曲の最大跳躍を独りで決めていた。
		const hardLimit = opts.allowLeap
			? Math.max(limit, opts.maxLeap + 4)
			: limit;
		if (Math.abs(semi - prev) > hardLimit) {
			semi = clampSemi(
				walk(opts.scale, prev, Math.sign(semi - prev) * 3),
				opts.register.low,
				opts.register.high,
			);
		}
		// gap fill: 直前が跳躍なら、この音は反行の順次進行で埋める
		if (
			!opts.allowArpeggio &&
			i >= 2 &&
			Math.abs(out[i - 1] - out[i - 2]) > STEP_SEMITONES
		) {
			const back = -Math.sign(out[i - 1] - out[i - 2]);
			semi = clampSemi(
				walk(opts.scale, out[i - 1], back),
				opts.register.low,
				opts.register.high,
			);
		}
		// アボイドノートは強拍・長い音では鳴らさない。逃がす先は上下どちらでもよいが、
		// **直前と同じ音になる方は選ばない**——ここで同音へ潰すと、せっかく作った
		// モチーフの輪郭が「同じ音の連打」に化ける（実測で同音反復が16%まで膨らんだ）。
		if (
			toneWeight(semi, barTones) === 0 &&
			(slots[i].isStrong || slots[i].value >= opts.quarterSteps)
		) {
			// **アボイドノートは半音上に和音構成音があるから避けられている。** その構成音そのものへ
			// 半音上げて解決するのが、いちばん自然な逃げ先。`E7` の上のソ→ソ#、`A7` の上のド→ド#
			// がここで出る——調の外の音だが、この様式の泣きメロの芯はまさにこの音。
			const resolved = semi + 1;
			const useResolved =
				resolved <= opts.register.high &&
				!scalePcs(opts.scale).has(pitchClass(resolved)) &&
				toneWeight(resolved, barTones) >= 2 &&
				resolved !== prev &&
				opts.rnd() < opts.chromaticAffinity;
			if (useResolved) {
				semi = resolved;
			} else {
				const up = clampSemi(
					walk(opts.scale, semi, 1),
					opts.register.low,
					opts.register.high,
				);
				const down = clampSemi(
					walk(opts.scale, semi, -1),
					opts.register.low,
					opts.register.high,
				);
				const score = (s: number) =>
					toneWeight(s, barTones) * 2 + (i > 0 && s === prev ? -3 : 0);
				semi = score(down) >= score(up) ? down : up;
			}
		}
		out.push(semi);
		prev = semi;
	}
	applyPentatonic(
		out,
		slots,
		tones,
		prevSemi,
		opts.quarterSteps / 2,
		opts.scale,
		opts.register,
	);
	applyOctaveJumps(out, slots, opts.octaveAffinity, opts.register, opts.rnd);
	return out;
};

/**
 * オクターブの跳ね上げ／落とし。「細かくジグザグ動かしながら大きな周期で上下する」動きは、
 * なめらかに移調するのではなくオクターブで飛ぶことで作られる。
 *
 * 音域へ畳み込んだ後に入れる。度数の段階で足すと跳んだ先が音域の外に出てその場で折り返され、
 * 跳ぶ前と同じ音に潰れる。オクターブ移動は音名を変えないので和音との関係は壊さない。
 */
const applyOctaveJumps = (
	out: number[],
	slots: Slot[],
	affinity: number,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
	rnd: () => number,
): void => {
	// 小節の最後の音は動かさない。オクターブ移動は「直前の音の1オクターブ上下」へ
	// 置き換える操作なので、終止の音に掛けると**主音でなくなる**（実測で200曲中4曲、
	// 終止が主音から外れた）。次の小節へのつなぎにもなる音なので触らない。
	for (let i = 1; i < out.length - 1; i++) {
		if (slots[i].isStrong) continue;
		if (rnd() >= affinity) continue;
		const from = out[i - 1];
		const up = from + 12;
		const down = from - 12;
		const canUp = up <= reg.high;
		const canDown = down >= reg.low;
		if (!canUp && !canDown) continue;
		out[i] = canUp && (!canDown || rnd() < 0.5) ? up : down;
	}
};

/**
 * ペンタトニックの外の音（ファ・シ）を整理する。クセが強いので、残してよいのは
 *
 * - その瞬間の和音の構成音（F の上のファ、G7 の上のシ）
 * - 前からも次へも順次進行で出入りしている（経過音・刺繍音として通り過ぎるだけ）
 *
 * のどちらか。それ以外は隣のペンタトニック音へ逃がす。逃がす向きは輪郭を壊さない方を選び、
 * 前の音と同じ高さになる向きは避ける。
 */
const applyPentatonic = (
	out: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	shortSteps: number,
	/** 曲の音階。どの5音を柱にするかがここで決まる。 */
	scale: ComposeScale,
	/** その小節で使う音域（{@link Register}）。 */
	reg: Register,
): void => {
	for (let i = 0; i < out.length; i++) {
		const semi = out[i];
		if (!isOutsideCore(scale, semi)) continue;
		// 和音構成音なら触らない。**ただし音階を厳しく締める曲（{@link ComposeScale.strict}）
		// は別。** 琉球音階の `F` はラを、`G` はレを持っていて、そこを無条件に通すと
		// 「レとラを抜く」という音階の定義そのものが崩れる。ブルース音階も同じで、
		// `C7` の長3度を通すと短3度で歌うという前提が消える。
		if (
			!scale.strict &&
			tones.some((t) => pitchClass(t.semi) === pitchClass(semi))
		)
			continue;
		const before = i === 0 ? prevSemi : out[i - 1];
		const after = i + 1 < out.length ? out[i + 1] : null;
		const inByStep = Math.abs(semi - before) <= STEP_SEMITONES;
		const outByStep =
			after !== null && Math.abs(after - semi) <= STEP_SEMITONES;
		// **順次で入るか順次で出るか、どちらかを満たせば通す。** 両方を要求するとファ・シも半音の
		// 動きも一緒に消える。**音階を厳しく締める曲（{@link ComposeScale.strict}）だけは両側を
		// 要求する**——あちらは中核の外＝音階に無い音なので、通り過ぎる形以外で出てはいけない。
		// 琉球音階はドとミ、ソとシの間が3半音空いていて、片側だけの条件だと抜いたはずのレとラが
		// 順次進行の受け皿として居座る。
		if (scale.strict ? inByStep && outByStep : inByStep || outByStep) continue;
		// 短い弱拍の音は通り過ぎるだけなので、そのまま通す。ここまで縛ると
		// 「ペンタトニックをなぞるだけ」になって、今度は別の単調さが出る。
		if (!scale.strict && !slots[i].isStrong && slots[i].value <= shortSteps)
			continue;
		const up = clampSemi(walk(scale, semi, 1), reg.low, reg.high);
		const down = clampSemi(walk(scale, semi, -1), reg.low, reg.high);
		// ファの隣はミとソ、シの隣はラとド。どちらもペンタトニックの音になる。
		const score = (s: number): number =>
			(isOutsideCore(scale, s) ? -4 : 0) +
			toneWeight(s, tones) +
			(s === before ? -3 : 0) +
			(after !== null ? -Math.abs(after - s) / 12 : 0);
		out[i] = score(down) >= score(up) ? down : up;
	}
};

// ============================================================
// 変化音（調の外の音）
// ============================================================

/**
 * ピッチクラス → 五度圏インデックス。上行の変化音はシャープ、下行はフラットで綴る。綴りが
 * 要るのは31平均律で C# と Db が別の音になるためで、12平均律でもピアノロールの表示がこれで
 * 決まる。
 */
const SHARP_FIFTHS = [0, 7, 2, 9, 4, -1, 6, 1, 8, 3, 10, 5];
const FLAT_FIFTHS = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];

/** `semi` と同じピッチクラスのうち、`near` にいちばん近い高さ。 */
const nearestOctaveOf = (near: number, semi: number): number => {
	const pc = pitchClass(semi);
	let best = pc;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let oct = 0; oct <= 10; oct++) {
		const s = pc + oct * 12;
		const d = Math.abs(s - near);
		if (d < bestDist) {
			bestDist = d;
			best = s;
		}
	}
	return best;
};

/**
 * 小節頭を非和声音にする（掛留・倚音）。成立する条件だけで掛ける。
 *
 * 1. 小節頭が強拍で、次の音がある（解決先が要る）
 * 2. 動かした先がアボイドノートでない（{@link toneWeight} が 0 の音は事故になる）
 * 3. 動かした先が和音の外（構成音のままなら、ただ音が変わっただけ）
 * 4. 次の音へ順次進行で解決する（2半音以内）。跳んで逃げると和音から外れた音として耳に残る
 */
const applyHeadTension = (
	pitches: number[],
	fifths: number[],
	slots: Slot[],
	tones: ChordTone[],
	scale: ComposeScale,
	affinity: number,
	rnd: () => number,
): void => {
	if (affinity <= 0) return;
	if (pitches.length < 2) return;
	if (!slots[0].isStrong) return;
	if (rnd() >= affinity) return;
	// 解決先が和音構成音でなければ、動かしても「解決」にならない。
	if (toneWeight(pitches[1], tones) < 2) return;

	const degree = semitoneToDegree(scale, pitches[0]);
	// 上隣を先に見る（9th・11th・13th 側。掛留の定番は上から解決する）。
	for (const dir of rnd() < 0.7 ? [1, -1] : [-1, 1]) {
		const to = degreeToPitch(scale, degree + dir);
		if (to.semi === pitches[0]) continue;
		const w = toneWeight(to.semi, tones);
		// 0＝アボイド、2以上＝和音構成音。狙いは「音階の中の非和声音」＝1。
		if (w !== 1) continue;
		if (Math.abs(to.semi - pitches[1]) > STEP_SEMITONES) continue;
		pitches[0] = to.semi;
		fifths[0] = to.fifth;
		return;
	}
};

/**
 * 調の外の音（変化音）を通す。メロディの音を作り終えた最後に掛ける。ここまでの生成は音階の
 * 度数だけで組み立てるので、進行にセカンダリドミナントを入れても旋律が付いていかない
 * （`E7` の上で `G` を鳴らして `G#` とぶつかるか、`A` へ逃げるかしかない）。
 *
 * 通すのは3つ。和音の変化音は強拍と長い音で、半音〜全音以内にあるときだけ寄せる（ここが
 * 泣きメロの芯になる）。半音の経過音と半音のアプローチは弱拍・短い音でだけ作るので、調の
 * 感じは壊れない。曲ごとに {@link MelodyStyle.chromaticAffinity} を引く。
 */
const applyChromatic = (
	/** 曲の音階。「調の外」の基準がここで決まる。 */
	scale: ComposeScale,
	pitches: number[],
	fifths: number[],
	slots: Slot[],
	tones: ChordTone[],
	opts: {
		affinity: number;
		quarterSteps: number;
		shortSteps: number;
		/** 最後の音を触らない（着地音が決まっている楽句の終わり）。 */
		keepLast: boolean;
		/** その小節で使う音域（{@link Register}）。 */
		register: Register;
		/**
		 * 小節の後半で鳴る和音（{@link HarmonicRhythm} が `half` のとき）。渡し忘れると後半の音が
		 * 前半の和音の変化音へ引き戻され、和音とぶつかる。
		 */
		tonesLate?: ChordTone[] | null;
		/** 後半の和音へ切り替わるステップ位置。 */
		lateAt?: number;
		rnd: () => number;
	},
): void => {
	const last = pitches.length - 1;
	/** その音の位置で鳴っている和音。 */
	const at = (i: number): ChordTone[] =>
		opts.tonesLate && slots[i].at >= (opts.lateAt ?? Number.POSITIVE_INFINITY)
			? opts.tonesLate
			: tones;
	// ⓪ 和音構成音と同じ高さの音は、**その構成音の綴りで書く**。
	// `E7` の上のソ#を「ラのフラット」と綴ると、31平均律で別の音になってしまう。
	for (let i = 0; i < pitches.length; i++) {
		const tone = at(i).find(
			(x) => pitchClass(x.semi) === pitchClass(pitches[i]),
		);
		if (tone) fifths[i] = tone.fifth;
	}
	// ① 和音の変化音を採る。
	const pcs = scalePcs(scale);
	for (let i = 0; i < pitches.length; i++) {
		if (opts.keepLast && i === last) continue;
		if (!slots[i].isStrong && slots[i].value < opts.quarterSteps) continue;
		const altered = at(i).filter((t) => !pcs.has(pitchClass(t.semi)));
		for (const tone of altered) {
			const target = nearestOctaveOf(pitches[i], tone.semi);
			const gap = Math.abs(target - pitches[i]);
			// 半音差は無条件（避けて逃げた先から戻す）。全音差は輪郭が動くので確率で。
			if (gap === 0 || gap > 2) continue;
			if (gap === 2 && opts.rnd() > opts.affinity) continue;
			// 直前の音と同じ高さへ潰れる寄せ方はしない。
			if (i > 0 && target === pitches[i - 1]) continue;
			pitches[i] = target;
			fifths[i] = tone.fifth;
			break;
		}
	}
	if (opts.affinity <= 0) return;
	// ② 半音の経過音・アプローチ。短い弱拍だけを書き換える。
	// **必ず順次で入って順次で出る形にする。** 変化音を跳躍で掴んだり、そこから跳んで離れたり
	// すると、通り過ぎる音ではなく「調を外した音」として耳に残る。
	let lastAltered = -2;
	for (let i = 1; i < last; i++) {
		if (slots[i].isStrong || slots[i].value > opts.shortSteps) continue;
		// 変化音を続けて置かない（半音階の走句になってしまう）。
		if (i - lastAltered <= 1) continue;
		if (opts.rnd() > opts.affinity) continue;
		const before = pitches[i - 1];
		const after = pitches[i + 1];
		const dir = Math.sign(after - before);
		if (dir === 0) continue;
		const span = Math.abs(after - before);
		// 経過音（全音の間を埋める）と、アプローチ（全音で入って半音で出る）。
		const target = span === 2 ? before + dir : span === 3 ? after - dir : null;
		if (target === null) continue;
		if (pcs.has(pitchClass(target))) continue; // 変化音になる場合だけ
		if (target === before || target === after) continue;
		if (target < opts.register.low || target > opts.register.high) continue;
		pitches[i] = target;
		fifths[i] = (dir > 0 ? SHARP_FIFTHS : FLAT_FIFTHS)[pitchClass(target)];
		lastAltered = i;
	}
};

/**
 * 歌の割り当て。歌入り作曲が、どのトラックに誰の声を当てるかを決めるのに使う。ハモリはサビ
 * （または Bメロ）から、デュエットは掛け合いで交互に。どちらもトラックが潤沢な advanced
 * モードでだけ展開し、ユーザーの操作パラメータにはしない——曲ごとに自動で引く。
 */
export type DuetStyle =
	| "none"
	/** セクションごとに交代（1番のAメロはA、2番のAメロはB）。 */
	| "section"
	/** Aメロ・Bメロで2小節ごとに交代（問い＝A、答え＝B）。 */
	| "phrase"
	/** サビで2小節ごとに交代する掛け合いサビ。 */
	| "chorus"
	/** Aメロだけ交代し、あとは1人が歌う。 */
	| "verse";

export type VocalPlan = {
	/**
	 * 2人目が歌う区間 `[開始ステップ, 終了ステップ)`。小節番号ではなく区間で持つ——小節線で
	 * ぴったり交代すると機械的に聞こえるので、手前から食い気味に入れる。
	 */
	duetSpans: [number, number][];
	duetStyle: DuetStyle;
	/** ハモリが入るセクション種別。 */
	harmonyKinds: SectionKind[];
	/**
	 * 2声目のハモリを鳴らすか。参考曲（チョウチン少女 ch12/ch11/ch13）では
	 * **1声目が下〜ユニゾン寄り、2声目が上**で主旋律を挟む形になっていた。
	 */
	harmony2: boolean;
	/** 主旋律のオクターブ下を重ねるか（ハモリではなく厚みの層）。 */
	octaveLayer: boolean;
};

/**
 * 編曲の1層。伴奏・装飾・重ねを同じ形で表す。`sections` が `null` なら曲全体。
 * `octave` はトラック側のオクターブ設定（ノート自体は動かさない）。
 */
export type ArrangeLayer = {
	pattern: ChordPatternType;
	sections: SectionKind[] | null;
	octave: number;
};

/**
 * 上級者モードの編曲プラン。曲ごとに引く。
 *
 * オクターブの重ねは主役にしない——人の耳はオクターブ違いを同じ音として聞く（オクターブ
 * 等価）ので、写した層は新しい声部にならず、音量と音色がわずかに変わるだけになる。
 *
 * - 伴奏の層は奏法そのものを変える（{@link ArrangeLayer.pattern}）。同じ和音でも鳴る音の
 *   位置が違うので、写しではない。
 * - 主旋律に重ねる層（{@link ArrangePlan.lead}）はオクターブ上だけでなくユニゾンも引く。
 * - ベースの重ね（{@link ArrangePlan.bassLayer}）は既定で出さない。出すときも下ではなく上へ
 *   ——下へ重ねると 30Hz 前後まで落ちて輪郭が濁る。
 */
export type ArrangePlan = {
	/**
	 * 伴奏の層。1本目は曲全体の「地」で、2本目以降はセクションを絞って足す。
	 * 長さは1〜3。
	 */
	backing: ArrangeLayer[];
	/** きらびやかな装飾（ウワモノ）。`null` なら出さない。 */
	sparkle: ArrangeLayer | null;
	/** コードパッドを鳴らすセクション。 */
	padSections: SectionKind[];
	/**
	 * 主旋律に重ねる別音色の層。`null` なら重ねない。
	 * `octave` が 0 ならユニゾン（音色だけが変わる）、1 ならオクターブ上。
	 */
	lead: { sections: SectionKind[]; octave: number } | null;
	/** ベースの重ね。`null` なら出さない（多くの曲はこちら）。 */
	bassLayer: { sections: SectionKind[]; octave: number } | null;
};

/** 曲の調のふるまい。 */
export type TonalPlan = {
	/**
	 * 平行調へ振ったセクション種別。ハ長調とイ短調は同じ音の集合なので、調号も
	 * 仲介の和音も要らずに明暗だけが入れ替わる（`keyShift` は 0 のまま）。
	 */
	relativeKinds: SectionKind[];
	/**
	 * 平行調なら 0、同主調なら ±3。平行調は調号が変わらないのが利点なので 0 のまま、
	 * 同主調（ハ長調→ハ短調）は主音を保ったまま調号が3つ変わるので ±3 になる。
	 */
	relativeShift: number;
	/** トニックを避けて浮遊感を出す曲か。主和音を鳴らさず、主音へも着地しない。 */
	floating: boolean;
};

/** 1回分の draw。点数を付けるのは呼び出し側（{@link evaluate}）の仕事。 */
type Draw = Omit<ComposeResult, "stats" | "drum" | "instrument" | "arrange"> & {
	melodyDurations: number[];
	restSteps: number;
	totalSteps: number;
	maxLeap: number;
	leapRatio: number;
	/** 隣接音程が2半音以内（同音を除く）だった割合。順次進行の多さ。 */
	stepRatio: number;
	/** 調の外の音が音数に占める割合。 */
	chromaticRatio: number;
	melodyRange: number;
	submelodyRange: number;
	/** 小節ごとの緊張度（0〜1）。{@link tensionFeatures} の材料。 */
	barTension: number[];
	stepsPerBar: number;
};

/**
 * リフの1音。`step` は主音から数えた中核音の歩数（ペンタトニック上の位置）、
 * `chrom` は半音下の刺繍音、`len` は16分を1とした長さ（負は休符）。
 */
type RiffNote = { step: number; chrom: boolean; len: number };

/**
 * リフの部品。どれも半小節（16分8つ）で、`a` は起点の歩数。手本2曲の上声は
 * この3種の組み合わせだった——刺繍音で回る・隣の中核音と往復する・同じ音を刻む。
 * 分散和音（和音の構成音を上下する）は手本に無く、入れると伴奏に聞こえる。
 */
const RIFF_FIGURES: ((a: number, rnd: () => number) => RiffNote[])[] = [
	// 回る: a, 半音下, a, 上へ抜けて、隣と往復
	(a) => [
		{ step: a, chrom: false, len: 1 },
		{ step: a, chrom: true, len: 1 },
		{ step: a, chrom: false, len: 1 },
		{ step: a + 1, chrom: false, len: 1 },
		{ step: a - 1, chrom: false, len: 1 },
		{ step: a - 2, chrom: false, len: 1 },
		{ step: a - 1, chrom: false, len: 1 },
		{ step: a - 2, chrom: false, len: 1 },
	],
	// 往復: 隣の中核音と16分で行き来し、最後を伸ばす
	(a, rnd) => {
		const d = rnd() < 0.5 ? -1 : 1;
		return [
			{ step: a, chrom: false, len: 1 },
			{ step: a + d, chrom: false, len: 1 },
			{ step: a, chrom: false, len: 1 },
			{ step: a + d, chrom: false, len: 1 },
			{ step: a, chrom: false, len: 1 },
			{ step: a + d * 2, chrom: false, len: 1 },
			{ step: a, chrom: false, len: 2 },
		];
	},
	// 刻む: 同じ音を付点で刻み、裏で半音下を掠める
	(a) => [
		{ step: a, chrom: false, len: 2 },
		{ step: a, chrom: false, len: 1 },
		{ step: a, chrom: true, len: 1 },
		{ step: a, chrom: false, len: 2 },
		{ step: a - 1, chrom: false, len: 2 },
	],
	// 下降して戻る: 2つ下りて半音下から戻る
	(a) => [
		{ step: a, chrom: false, len: 1 },
		{ step: a - 1, chrom: false, len: 1 },
		{ step: a - 2, chrom: false, len: 2 },
		{ step: a - 1, chrom: true, len: 1 },
		{ step: a - 1, chrom: false, len: 1 },
		{ step: a, chrom: false, len: 2 },
	],
];

/**
 * リフ1小節（前半・後半）。起点は主音の周り（主音から -1〜+3 歩）から引き、後半は前半より
 * 低い所から始める。手本はどちらも「上で回って、下で往復する」形だった。
 */
const makeRiffHalf = (rnd: () => number, lo: number, hi: number): RiffNote[] =>
	pick(RIFF_FIGURES, rnd)(lo + Math.floor(rnd() * (hi - lo + 1)), rnd);

const draw = (
	options: ComposeOptions,
	resolvedKey: ResolvedComposeKey,
	/** 曲の音階。40本引く候補すべてで同じものを使う。 */
	scale: ComposeScale,
	rnd: () => number,
): Draw => {
	/**
	 * 主音がドでもラでもない曲は、進行プールごと差し替える。既存のプールは全部ハ長調／イ短調の
	 * トニックを前提にしているので、D ドリアンにそのまま使うと和音が主音を指さず、旋律だけが
	 * モードになる。ド（陽・琉球）とラ（民謡）は `null` になる。
	 */
	const center = resolveCenter(scale);
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	// 音価は192ステップ基準で書いてあるので、実際の stepsPerBar へ比率で写す。
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);
	/**
	 * リズム型を実際の stepsPerBar へ写す。写した後の合計を必ず1小節に揃える——型は192ステップ
	 * 基準なので、三連のように192の約数でも16分の倍数でもない音価は1音ずつ丸めると小節から
	 * はみ出す。ずれは最後の音で吸収する。
	 */
	const scaleCell = (value: number[]): number[] => {
		const scaled = value.map(scaleStep);
		const total = scaled.reduce((sum, v) => sum + Math.abs(v), 0);
		let diff = stepsPerBar - total;
		if (diff !== 0) {
			for (let i = scaled.length - 1; i >= 0 && diff !== 0; i--) {
				const sign = Math.sign(scaled[i]);
				const next = Math.abs(scaled[i]) + diff;
				if (next < 1) continue;
				scaled[i] = next * sign;
				diff = 0;
			}
		}
		return scaled;
	};
	const quarterSteps = scaleStep(QUARTER);
	const strongStep = Math.max(1, Math.round(stepsPerBar / 2));

	// --- ⓪曲の設計図（セクション）と曲中転調 ---
	// どこがイントロで、どこがサビなのかを持つ（{@link file://./compose-sections.ts}）。
	// **セクション長も seed ごとに引く**——定数のままだと BPM も調もメロディ型も引き直して
	// いるのに骨格だけが全 seed で同一になる（{@link SectionSpec.barChoices}）。
	//
	// **テンポは設計図より先に引く。** イントロの長さは小節数ではなく秒で決める
	// （{@link SectionSpec.seconds}）ので、BPM が分からないうちには小節数を選べない。
	const template = STRUCTURE_TEMPLATES.find(
		(tm) => tm.name === options.template,
	);
	const bpm = pick(template?.bpmChoices ?? BPM_CHOICES, rnd);
	const bassOverride = template?.bassByScale?.[scale.id] as
		| BassStyle
		| undefined;
	const sectionPlan = buildSectionPlan(
		options.sections ?? DEFAULT_SECTIONS,
		options.template,
		rnd,
		bpm,
	);
	const totalBars = sectionPlan.reduce((sum, s) => sum + s.bars, 0);

	/**
	 * 進行と着地音を平行調側へ振るセクション。ハ長調とイ短調は同じ音の集合なので、調号も仲介の
	 * 和音も要らずに明暗だけ入れ替えられる（`keyShift` は 0 のまま）。同主調も同じ仕組みで、
	 * 短調側の進行を引いて `keyShift` を +3 すれば主音が動かないまま暗くなる。
	 */
	const relativeKinds = new Set<SectionKind>();
	/** 同主調のときだけ 0 以外。平行調は 0（調号が変わらないのが平行調の利点）。 */
	let relativeShift = 0;
	// **モードの曲では平行調・同主調へ振らない。** 明暗の入れ替えは長調と短調が
	// 同じ音集合を共有していることに乗った仕掛けで、主音がドでもラでもない曲には
	// 対応する「平行調」が無い。`rnd()` は必ず消費して、従来の曲の抽選を変えない。
	if (rnd() < 0.25 && !center) {
		// **Aメロは含めない。** 調を名乗る場所なので、最初のAメロが平行調だと
		// その曲が何調なのかが決まらないまま進む。陰らせるのはBメロ・Cメロ。
		for (const kind of pick<SectionKind[]>(
			[["prechorus"], ["bridge"], ["prechorus", "bridge"]],
			rnd,
		))
			relativeKinds.add(kind);
		// 3回に1回は同主調にする。平行調より遠い（調号が3つ変わる）ぶん陰りが強い。
		if (rnd() < 0.33) relativeShift = resolvedKey.mode === "minor" ? -3 : 3;
	}

	/**
	 * トニックを避ける（浮遊感）。主和音を鳴らさず主音へも着地しないと、明るいのか暗いのか
	 * 決まらない。曲全体でやると芯が無くなるので、1割強の曲でだけ引く。
	 */
	const floating = rnd() < 0.12;

	// --- 曲中転調 ---
	//
	// **五度圏で近いほど自然、遠いほどドラマチック。** 属調（+7）と下属調（+5）は共通の和音が
	// 多く、橋渡しを置けば違和感なく移れる。半音上げは「サビへの直接転調」の定番。伴奏は
	// `rootShift` が曲全体に掛かるので、曲中の調変化は小節ごとにコード名を移調し、メロディ・
	// サブメロ・ベースもその小節だけ音高をずらす。
	//
	// 平行調・同主調の曲では重ねない（明暗の入れ替えが埋もれる）。浮遊感の曲でも掛けない
	// ——移調すると避けていたはずの和音が主和音の位置へ来てしまう。
	if (relativeKinds.size > 0 && relativeShift !== 0)
		for (const s of sectionPlan)
			if (relativeKinds.has(s.kind)) s.keyShift = relativeShift;

	if (relativeKinds.size === 0 && !floating && rnd() < 0.32) {
		const modType = pick<"chorus_up" | "color" | "dominant" | "subdominant">(
			["chorus_up", "chorus_up", "color", "dominant", "subdominant"],
			rnd,
		);
		if (modType === "chorus_up") {
			// ラスサビで +1 半音（または +2 半音）。理屈の橋渡しは無く、直接転調で上げる。
			const shift = pick([1, 1, 2], rnd);
			let lastChorusIdx = -1;
			for (let i = 0; i < sectionPlan.length; i++) {
				if (sectionPlan[i].kind === "chorus") lastChorusIdx = i;
			}
			if (lastChorusIdx >= 0)
				for (let i = lastChorusIdx; i < sectionPlan.length; i++)
					sectionPlan[i].keyShift = shift;
		} else {
			// Bメロ／Cメロを一時的に別の調へ振り、サビで主調へ戻る。
			const shift =
				modType === "dominant"
					? 7
					: modType === "subdominant"
						? 5
						: pick([-2, 3], rnd);
			const kinds: SectionKind[] = pick(
				[["prechorus"], ["bridge"], ["prechorus", "bridge"]],
				rnd,
			);
			for (const s of sectionPlan)
				if (kinds.includes(s.kind)) s.keyShift = shift;
		}
	}

	// --- 歌の設計（ハモリ・デュエット） ---
	//
	// **ハモリはサビから、曲によってはBメロから入る。** 全編には付けない。
	// 上ハモはサビ、下ハモはBメロ・Cメロ。落ちサビは外す（声だけを聞かせる場所）。
	const harmonyFrom = pick<"chorus" | "prechorus">(
		["chorus", "chorus", "prechorus"],
		rnd,
	);
	/** 主旋律と同じだけ動く並走ハモリか（{@link harmonyPitch}）。 */
	const harmonyParallel = rnd() < 0.45;
	/**
	 * **ハモリは主旋律の全部には付かない。** 参考7組の被覆率は66〜100%（平均85%）で、
	 * 短い音や走句を飛ばして要所だけ重なる。全音に付けると輪郭が主旋律と一体化する。
	 */
	const harmonyCoverage = 0.7 + rnd() * 0.3;
	/** 2声目のハモリ（主旋律を上下から挟む3声）。 */
	const useHarmony2 = rnd() < 0.3;
	/** 主旋律のオクターブ下の重ね。3声のときは声を増やしすぎるので出さない。 */
	const useOctaveLayer = !useHarmony2 && rnd() < 0.25;
	/** その重ねが主旋律のどれだけを覆うか。参考曲は29〜59%。 */
	const octaveCoverage = 0.3 + rnd() * 0.3;
	/** ハモリの居場所（主旋律から何半音ずれた辺りに置くか）。上へ行くほうが多い。 */
	const harmonyOffset = useHarmony2
		? // 3声のときは1声目を下〜ユニゾン側へ寄せ、2声目を上へ回して主旋律を挟む
			// （参考: チョウチン少女 ch12/ch11/ch13）。
			pick([-5, -3, 0, 0, 3], rnd)
		: harmonyParallel
			? pick([3, 4, 5, 9, 7, 0, -5], rnd)
			: pick([3, 4, 5, 0, -5, -4, -7], rnd);
	/** 直前のハモリの音。小節をまたいで持ち越す（動かない線を作るため）。 */
	let prevHarmony: number | null = null;
	let prevHarmony2: number | null = null;
	/**
	 * 2声目の居場所。1声目から3度・6度・5度の位置に置く。主旋律との関係だけで独立に決めると
	 * 2声がオクターブで重なりやすく、3声に聞こえない。
	 */
	const harmony2Offset = harmonyOffset + pick([9, 9, 9, 8, 7], rnd);
	const harmonyKinds: SectionKind[] =
		harmonyFrom === "prechorus"
			? ["prechorus", "chorus", "bridge"]
			: ["chorus"];

	// **掛け合い（デュエット）。** どこで交代するかを曲ごとに引く。同じ「2小節交代」
	// でも、どのセクションでやるかで曲の顔が変わる。
	const duetStyle = pick<DuetStyle>(
		[
			"none",
			"none",
			"none",
			"none",
			"none",
			"section",
			"phrase",
			"chorus",
			"verse",
		],
		rnd,
	);
	/** 小節ごとの担当（false=1人目 / true=2人目）。 */
	const duetOwner = new Array<boolean>(totalBars).fill(false);
	if (duetStyle !== "none") {
		let melodySection = 0;
		for (const section of sectionPlan) {
			if (!section.spec.melody) continue;
			const isChorus =
				section.kind === "chorus" || section.kind === "drop_chorus";
			const isVerse = section.kind === "verse";
			const takeSection = melodySection % 2 === 1;
			melodySection++;
			/** このセクションで2小節ごとに交代するか。 */
			const alternate =
				duetStyle === "phrase"
					? !isChorus
					: duetStyle === "chorus"
						? isChorus
						: duetStyle === "verse"
							? isVerse
							: false;
			if (!alternate && !(duetStyle === "section" && takeSection && !isChorus))
				continue;
			for (let b = section.startBar; b < section.startBar + section.bars; b++) {
				if (alternate) {
					if (Math.floor((b - section.startBar) / 2) % 2 === 1)
						duetOwner[b] = true;
				} else duetOwner[b] = true;
			}
		}
	}

	// 小節の担当を区間へ畳み、**受け渡しを食い気味にする**（8分〜付点4分だけ手前から）。
	const duetSpans: [number, number][] = [];
	{
		let from = -1;
		for (let b = 0; b <= totalBars; b++) {
			const owned = b < totalBars && duetOwner[b];
			if (owned && from < 0) from = b;
			if (!owned && from >= 0) {
				// 入りだけ食う。終わりもずらすと次の人の頭を食う。
				const lead =
					from === 0
						? 0
						: scaleStep(
								pick([0, 0, EIGHTH, EIGHTH, QUARTER, DOT_QUARTER], rnd),
							);
				duetSpans.push([from * stepsPerBar - lead, b * stepsPerBar]);
				from = -1;
			}
		}
	}

	const barKeyShift: number[] = new Array(totalBars).fill(0);
	for (const s of sectionPlan) {
		for (let b = s.startBar; b < s.startBar + s.bars && b < totalBars; b++) {
			barKeyShift[b] = s.keyShift;
		}
	}

	// --- ①コード進行を決める ---
	// セクションごとに進行を割り当てる。Aメロ系は progA、サビ系は progB。イントロがサビの和音
	// で始まるのは「曲の顔を先に見せる」定石で、間奏も同じ理由でサビ側を使う。ベース調が
	// 長調／短調に指定されている場合は進行をそれに合わせる。
	const progAPool = center
		? center.a
		: resolvedKey.mode === "major"
			? SECTION_A_PROGRESSIONS.filter((p) => !p[0].startsWith("Am"))
			: resolvedKey.mode === "minor"
				? SECTION_A_PROGRESSIONS.filter((p) => p[0].startsWith("Am"))
				: SECTION_A_PROGRESSIONS;
	/** トニックを含まない進行だけに絞る（浮遊感の曲用）。 */
	const withoutTonic = (pool: string[][], root: string): string[][] => {
		// "CM7" は C のトニック、"Cm" は別物。ルートの文字だけで判定する。
		const isTonic = (c: string): boolean =>
			center
				? center.tonicPattern.test(c)
				: root === "Am"
					? /^Am/.test(c)
					: /^C(?![#b]|m)/.test(c);
		const out = pool.filter((p) => !p.some(isTonic));
		return out.length > 0 ? out : pool;
	};
	const homeRoot = center
		? center.tonic
		: resolvedKey.mode === "minor"
			? "Am"
			: "C";
	const progA = pick(
		floating ? withoutTonic(progAPool, homeRoot) : progAPool,
		rnd,
	);
	// サビはAメロと質感を変えるのが役目なので、同じ進行を引いたら引き直す。
	//
	// **並び全体ではなく1和音目で弾く。** 和声リズムが `slow`（2小節に1和音）の曲では
	// 4和音のうち2つしか鳴らないので、途中の和音だけが違う進行はAメロとサビで
	// 同じ和音列へ潰れる。1和音目は `slow` でも必ず鳴り、しかもセクションの半分を占める。
	const progBAll = center ? center.b : SECTION_B_PROGRESSIONS;
	const progBHead = progBAll.filter((p) => p[0] !== progA[0]);
	const progBPool = (progBHead.length > 0 ? progBHead : progBAll).filter(
		(p) => p.join("|") !== progA.join("|"),
	);
	const progB = pick(
		floating ? withoutTonic(progBPool, homeRoot) : progBPool,
		rnd,
	);
	/**
	 * 平行調の進行。長調の曲ならイ短調側、短調の曲ならハ長調側から引く。
	 * 同じ音階の上に居るので、移調も仲介の和音も要らない。
	 */
	const progRelativePool = center
		? center.a
		: SECTION_A_PROGRESSIONS.filter((p) =>
				resolvedKey.mode === "minor"
					? !p[0].startsWith("Am")
					: p[0].startsWith("Am"),
			);
	const progRelative = pick(
		floating ? withoutTonic(progRelativePool, homeRoot) : progRelativePool,
		rnd,
	);
	const progCPool = (center ? center.c : SECTION_C_PROGRESSIONS).filter(
		(p) => p.join("|") !== progA.join("|") && p.join("|") !== progB.join("|"),
	);
	const progC = pick(
		floating ? withoutTonic(progCPool, homeRoot) : progCPool,
		rnd,
	);
	const tonic = center ? center.tonic : progA[0].startsWith("Am") ? "Am" : "C";
	/** ドミナントで終わる4小節（Bメロの末尾＝サビへの助走に使う）。 */
	const progHalf = center
		? pick(MODAL_HALF_DERIVATIONS, rnd)(progA, center)
		: pick(SECTION_A2_DERIVATIONS, rnd)(progA);
	/** 主音で終わる4小節（セクションの締めに使う）。 */
	const progFull = center
		? pick(MODAL_FULL_DERIVATIONS, rnd)(progA, center)
		: pick(SECTION_A3_DERIVATIONS, rnd)(progA, tonic);
	/** 主和音の代理へ落とす4小節（途中のサビを続けるのに使う）。 */
	const progDeceptive = center
		? pick(MODAL_DECEPTIVE_DERIVATIONS, rnd)(progA, center)
		: pick(SECTION_DECEPTIVE_DERIVATIONS, rnd)(progA, tonic);
	/** 曲の最後のサビ。ここだけは全終止で締める。 */
	let lastChorusBar = -1;
	for (const section of sectionPlan)
		if (section.kind === "chorus" || section.kind === "outro")
			lastChorusBar = section.startBar;
	const progression: string[] = [];
	for (const section of sectionPlan) {
		const base = relativeKinds.has(section.kind)
			? progRelative
			: section.spec.progression === "c"
				? progC
				: section.spec.progression === "b"
					? progB
					: progA;
		for (let i = 0; i < section.bars; i += 4) {
			const isLastPhrase = i + 4 >= section.bars;
			// セクションの最後の4小節は、そのセクションの役目に合わせて締める。Bメロは半終止
			// （ドミナント）でサビへ渡し、サビとアウトロは全終止。
			//
			// **押し込める小節数だけ入れる。** 進行は4小節ひとまとまりだがセクション長は4の倍数とは
			// 限らず、丸ごと push すると後続の和音が後ろへずれて曲の末尾が落ちる。
			const room = Math.min(4, section.bars - i);
			const put = (cells: string[]): void => {
				progression.push(...cells.slice(0, room));
			};
			if (!isLastPhrase) {
				put(base);
				continue;
			}
			// 浮遊感の曲は主音で締めない（{@link floating}）。締めの進行は
			// 定義上トニックで終わるので、ドミナントで宙吊りのまま渡す。
			if (relativeKinds.has(section.kind)) put(base);
			else if (section.kind === "prechorus") put(progHalf);
			else if (section.kind === "chorus" || section.kind === "outro") {
				// **途中のサビは偽終止で続ける。** 毎回主音へ全終止すると、サビのたびに
				// 曲が終わってしまう。全終止は最後のサビ（またはアウトロ）だけ。
				const close = floating
					? progHalf
					: section.startBar === lastChorusBar
						? progFull
						: progDeceptive;
				// **サビの後半は、前半の和音を2小節そのまま返してから締める。** フックは「同じ和音の上に
				// 同じフレーズが返ってくる」ことで記憶に残るので、返る場所が無いと旋律側にどれだけ反復の
				// 仕組みを積んでも働かない。J-POPのサビは4小節の進行を2周して最後だけ解決する形が定石で、
				// 締めの進行の**後ろ2小節**を使えば終止（主音への着地）は保たれる。
				put(
					section.kind === "chorus"
						? [...base.slice(0, 2), ...close.slice(2)]
						: close,
				);
			} else put(base);
		}
	}
	progression.length = totalBars;
	// 伴奏トラック用のコード文字列。転調セクションはコード名そのものを移調して出力する。
	// --- 転調の橋渡し ---
	//
	// 調が変わる直前の1小節を橋渡しに使う。やり方は2つ。
	//
	// - **ピボットコード**: 両方の調にあるダイアトニックコードを、**前の調のまま**置く。
	//   五度圏で隣（属調・下属調）でしか成立しない。
	// - **ドミナントモーション**: 新しい調のV7を、**新しい調で**置く。共通の和音が無くても
	//   どこへでも移れる代わりに、転調したことがはっきり聞こえる。
	//
	// 半音上げ（ラスサビ）には橋渡しを置かない。準備の無い直接転調そのものがあの効果の正体
	// なので、滑らかにすると狙いが消える。
	/** 移調量ごとの、元の調と共通するダイアトニックコード（ハ長調の綴りで書く）。 */
	const PIVOT_CHORDS: Record<number, string[]> = {
		7: ["C", "Em7", "G", "Am"], // 属調（ト長調）と共通
		5: ["C", "Dm7", "F", "Am"], // 下属調（ヘ長調）と共通
	};
	for (let bar = 1; bar < totalBars; bar++) {
		const shift = barKeyShift[bar];
		const prev = barKeyShift[bar - 1];
		if (shift === prev) continue;
		// **五度圏で何歩離れたかで、橋渡しの要否と種類が決まる。**
		//   1歩（属調・下属調）… 共通の和音が多い。ピボットが効く
		//   2〜3歩（長2度・短3度）… 共通が減る。新しい調のドミナントで引っぱる
		//   5歩（半音上げ）… 遠い。準備の無さそのものが効果なので何も置かない
		const distance = fifthsDistance(shift - prev);
		if (distance >= 4) continue;
		// **役目の決まっている小節は潰さない。** Bメロ末尾はサビへの助走（半終止）、
		// サビ・アウトロ末尾は全終止で、そこを橋渡しに使うと役目が競合する。
		const prevSec = sectionAt(sectionPlan, bar - 1);
		if (
			prevSec.kind === "prechorus" ||
			prevSec.kind === "chorus" ||
			prevSec.kind === "outro"
		)
			continue;
		// 転調のたびに毎回は置かない。置きすぎると進行が橋渡しだらけになる。
		if (rnd() < 0.35) continue;
		const pivots = PIVOT_CHORDS[(((shift - prev) % 12) + 12) % 12];
		if (distance <= 1 && pivots && rnd() < 0.6) {
			// ピボット: 前の調のまま、共通の和音を鳴らす。
			progression[bar - 1] = pick(pivots, rnd);
		} else {
			// ドミナントモーション: 新しい調のV7を1小節先取りする。
			// **小節の調（`barKeyShift`）は動かさない。** 動かすとその小節だけ
			// セクションと別の調になり、旋律も検算もセクション単位の前提が崩れる。
			// 和音の名前を移調して書き込めば、鳴る音は同じで前提だけ保たれる。
			progression[bar - 1] = transposeChordName("G7", shift - prev);
		}
	}

	// --- モーダルインターチェンジ ---
	// 同主短調から1和音だけ借りる（{@link MODAL_BORROW}）。**次が主和音の小節**にだけ置くので、
	// 借りた響きは必ず解決先を持つ。モードの曲では借りない——仕掛けが主音はドかラであることに
	// 乗っているうえ、借用和音が入った瞬間にモードの色が上書きされる。
	if (rnd() < 0.3 && !center) {
		const tonicNames = tonic === "Am" ? ["Am", "Am7"] : ["C", "CM7"];
		const spots: number[] = [];
		for (let bar = 0; bar + 1 < totalBars; bar++) {
			if (barKeyShift[bar] !== barKeyShift[bar + 1]) continue;
			if (!MODAL_BORROW[progression[bar]]) continue;
			if (!tonicNames.includes(progression[bar + 1])) continue;
			spots.push(bar);
		}
		if (spots.length > 0) {
			const at = pick(spots, rnd);
			progression[at] = MODAL_BORROW[progression[at]];
		}
	}

	// --- 和声リズムを引く ---
	//
	// 和音の**速度**は進行の中身と同じくらい曲の印象を決める。セクションの頭から4小節ずつの
	// まとまりで写す（セクション境界をまたがない）。
	//
	// **モードの曲では `slow` を引かない。** 音階の中心を立てる進行（{@link TONIC_CENTERS}）は
	// 4和音そろって初めて音階の色を決めるので、半分を間引くと主和音が進行から消える。
	// 速める側（`half`）は全部残るので通す。
	const harmonicRhythm = pick(
		center ? HARMONIC_RHYTHMS.filter((h) => h !== "slow") : HARMONIC_RHYTHMS,
		rnd,
	);
	const barChords: string[][] = progression.map((c) => [c]);
	if (harmonicRhythm !== "bar") {
		for (const sec of sectionPlan) {
			for (let i = 0; i < sec.bars; i += 4) {
				const at = sec.startBar + i;
				const room = Math.min(4, sec.bars - i, totalBars - at);
				if (room < 4) continue;
				const cell = [0, 1, 2, 3].map((k) => progression[at + k]);
				if (harmonicRhythm === "half") {
					// 4和音を2小節へ詰めて、それを2回回す。半小節で和音が動く。
					const pairs = [
						[cell[0], cell[1]],
						[cell[2], cell[3]],
					];
					for (let k = 0; k < 4; k++) barChords[at + k] = pairs[k % 2];
				} else {
					// 2小節に1和音。1番目と3番目（進行の骨になる和音）だけを残す。
					// **セクション最後の4小節だけは3番目ではなく4番目を残す。**
					// 進行の締めは最後の和音が持っているので、そこを落とすと
					// 「Bメロがドミナントで終わる」「サビが主音で終わる」が成立しない。
					const isLastGroup = i + 4 >= sec.bars;
					const late = isLastGroup ? cell[3] : cell[2];
					for (let k = 0; k < 4; k++)
						barChords[at + k] = [k < 2 ? cell[0] : late];
				}
			}
		}
		// **`progression` はその小節の主和音に揃える。** 旋律・ベース・パッドは
		// ここを見ているので、同期していないと和音と音が食い違う。
		for (let b = 0; b < totalBars; b++) progression[b] = barChords[b][0];
	}

	// 1小節に2和音ある小節は空白で並べる。`parseChords` は小節を均等割りする。
	const chordProgression = barChords
		.map((chords, bar) =>
			chords.map((c) => transposeChordName(c, barKeyShift[bar])).join(" "),
		)
		.join("|");
	// 調も曲ごとに引く。生成はハ長調で行い、最後にまとめて移調する
	// （生成中に移調すると音域の折り返しが調ごとにずれ、輪郭が壊れる）。
	// テンポ（`bpm`）はセクションの設計図より前で引いてある。
	const rootShift = resolvedKey.rootShift;
	const chordPattern = pick(chordPatternPool(bpm), rnd);

	// --- 曲の骨格と書法を引く（ここが曲どうしの違いの出どころ） ---
	//
	// **楽句は2小節、小楽節は4小節。** 1小節単位で役割を配ると2小節のまとまりが無くなり、
	// 「同じフレーズが返ってきた」という手応えがどこにも生まれない。8小節のセクションは
	// 「問い→答え→問いの変形→答え」、4小節は「問い→答え」。答えは問いのリズムを受けて着地音
	// だけを変える。イントロと間奏はメロディを書かない（伴奏・ベース・ドラムだけが鳴る）。
	type Unit = {
		role: BarRole;
		/** どのモチーフを使うか。同じ素材の楽句は音の並びごと再現する。 */
		source: "a" | "a2" | "b" | "c" | "answer" | "silent" | "solo";
		/** セクションの終わりの着地音（主音からの音階度数）。途中は null。 */
		landing: number | null;
		section: PlacedSection;
	};
	/**
	 * セクション → モチーフの素材。BメロはサビともAメロとも違う顔でなければならないので、
	 * Aメロと同じ素材のセクエンツにする（無関係な素材だと曲としての統一感が消える）。
	 */
	const sourceOf = (kind: SectionKind): "a" | "a2" | "b" | "c" =>
		kind === "chorus" || kind === "interlude" || kind === "drop_chorus"
			? "b"
			: kind === "prechorus"
				? "a2"
				: kind === "bridge"
					? "c"
					: "a";
	/**
	 * そのセクションの着地音（主音からの音階度数）。
	 *
	 * - 平行調のセクションは平行調の主音へ着地する。和音だけ平行調にして着地音を主調のままに
	 *   すると、進行と旋律が別の調を向いて宙に浮く。
	 * - 浮遊感の曲は主音へ着地しない。3度か5度で止める。
	 */
	const landingOf = (section: PlacedSection): number | null => {
		if (section.spec.landing === null) return null;
		// **音階の主音のぶんだけずらす。** {@link SECTION_SPECS} の着地音はハ長調の度数で書いて
		// あるので、主音がラ（民謡＝従来の短調）なら +5、レ（律・ドリアン）なら +1 する。0 のままだと
		// 短調の曲が平行長調の主音へ着地して、自分の調へ解決しない。平行調のセクションは長短が
		// 入れ替わるので、ずらす／ずらさないも入れ替わる。
		const relativeHere = relativeKinds.has(section.kind);
		const tonicDegree = relativeHere
			? scale.tonic === 5
				? 0
				: 5
			: scale.tonic;
		// 音階の長さで回す。ブルース音階は6音なので7で割ると度数が1つずれる。
		const size = scaleSize(scale);
		let landing = (section.spec.landing + tonicDegree) % size;
		if (floating && landing === tonicDegree)
			landing = (landing + pick([2, 4], rnd)) % size;
		return landing;
	};

	// **展開の仕方は小節の役割を決める前に引く。** `style` は下で引いているが、
	// 役割の割り当てはそれより前なので、ここで独立に持つ。
	const form = resolveMelodyForm(
		options.form && options.form !== "auto" ? options.form : template?.form,
		rnd,
	);

	const units: Unit[] = [];
	for (const section of sectionPlan) {
		const unitCount = Math.max(1, Math.round(section.bars / 2));
		const src = sourceOf(section.kind);
		for (let u = 0; u < unitCount; u++) {
			if (!section.spec.melody) {
				// **間奏は「歌が休む場所」であって「音楽が休む場所」ではない。** 伴奏だけにすると曲の中で
				// 最ものっぺりした4〜8小節になるので、器楽のソロ（`solo`）を書いて別トラック＋別楽器で
				// 鳴らす。素材はサビと同じ（{@link sourceOf} の "b"）。イントロはソロを置かない——曲の頭で
				// 聞かせどころを使い切ると、サビが来たときに上がり幅が無くなる。
				const solo = section.kind === "interlude";
				units.push({
					// 見せ場なので走句と山を交互に置く。`hold` のままだと
					// リズム型が最も薄いものになり、ソロにならない。
					role: solo ? (u % 2 === 0 ? "run" : "climax") : "hold",
					source: solo ? "solo" : "silent",
					landing: null,
					section,
				});
				continue;
			}
			const isLast = u === unitCount - 1;
			if (u % 2 === 0) {
				// 問い。サビはオクターブ上げて聞かせどころにする。
				// Cメロは「AメロともBメロとも違うメロディ」が役目なので、モチーフの
				// 輪郭を借りずに `step` の書法（{@link MelodyStyle.stepShape} の
				// アーチ・谷・波）で独立した線を書く。
				units.push({
					// リフ主体の曲は**変形しない**。セクエンツもオクターブ上げも入れず、
					// 同じ型を回し続ける。セクションの対比は編曲側（ドラム・楽器・レイヤ）
					// が担う——ヤツメ穴型の曲がまさにその作りで、120小節を通して
					// 5半音のセルが変わらない。
					role:
						form === "ostinato"
							? "motif"
							: form === "through"
								? // 通し作曲は素材を戻さない。`step` の書法（アーチ・谷・波）で
									// 独立した線を書き、たまに走句と山を挟んで単調さを避ける。
									u % 3 === 2
									? "run"
									: u % 3 === 1
										? "climax"
										: "step"
								: section.kind === "bridge"
									? "step"
									: section.kind === "chorus"
										? "climax"
										: src === "a2" || u > 0
											? "sequence"
											: "motif",
					// リフ型は素材も1つに揃える（`sourceOf` でセクションごとに
					// 変えると、そこだけ別の型が始まってオスティナートにならない）。
					source: form === "ostinato" ? "a" : src,
					landing: null,
					section,
				});
			} else {
				// 答え。セクションの最後だけ、そのセクションの役目に応じて着地する。
				const landing = landingOf(section);
				// リフ型は「問いと答え」で書かない。曲の最後だけ着地させて、
				// それ以外は同じ型を回す。
				const riff = form === "ostinato" && !(isLast && landing === 0);
				units.push({
					role:
						isLast && landing === 0
							? "cadence"
							: riff
								? "motif"
								: // 通し作曲は「問いと答え」で閉じない。answer は問いのリズムを
									// 受けて着地音だけ変える形なので、そのままだと反復が戻る。
									form === "through"
									? "step"
									: "answer",
					source: riff ? "a" : "answer",
					landing: isLast ? landing : null,
					section,
				});
			}
		}
	}
	const barRoles: BarRole[] = units.flatMap((u) => [u.role, u.role]);
	// Bメロの最後の小節はリズムだけビルドアップしていた（{@link buildUpCell}）。
	// 走句の書法（{@link MelodyStyle.runShape}）を当てて、音の側も駆け上がらせる。
	for (const section of sectionPlan) {
		if (section.kind !== "prechorus") continue;
		const last = section.startBar + section.bars - 1;
		if (last < barRoles.length) barRoles[last] = "run";
	}
	/** その小節が楽句のどちら側か（0=前半、1=後半）。輪郭の読み出し位置に使う。 */
	const barInUnit = (bar: number): number => bar % 2;
	const unitOf = (bar: number): number => Math.floor(bar / 2);

	/**
	 * セクション内で楽句をそのまま再現する割合。曲ごとに引く——フックを繰り返す曲もあれば、
	 * 8小節を通して書く曲もある。
	 */
	const phraseRestateRate = 0.25 + rnd() * 0.45;
	/** 楽句ごとの判定。2小節で答えを揃えるために覚える。 */
	const phraseRestate = new Map<number, boolean>();
	const restatementOf = (bar: number): number | null => {
		const curSec = sectionAt(sectionPlan, bar);
		if (!curSec.spec.melody) return null;
		// **通し作曲は楽句を再現しない。** ここを通すと、2番のAメロが1番をそのまま
		// 歌い直し、楽句レベルでも同じ形が戻ってきて、結局 sim が下がらない。
		// 「同じフレーズが返ってくる」ことこそが歌モノの手応えなので、
		// それを外すのが通し作曲という型の中身になる。
		if (form === "through") return null;

		// 2番・3番のセクション（restatement === true）の場合、1番の同一セクションの対応小節を再現
		if (curSec.restatement) {
			const firstSec = sectionPlan.find(
				(s) => s.kind === curSec.kind && !s.restatement,
			);
			if (firstSec) {
				const offset = bar - curSec.startBar;
				if (offset < firstSec.bars) {
					return firstSec.startBar + offset;
				}
			}
		}

		// 1コーラス内での楽句レベルの再現
		const u = unitOf(bar);
		if (units[u].source === "silent") return null;
		// **楽句レベルの再現は確率で行う。** 無条件だと、8小節のセクション【問い→答え→問いの変形
		// →答え】の「問いの変形」が1つ目の問いの完全な複製になる。繰り返しすぎているのはセクション
		// 間ではなくセクション内。楽句（2小節）単位で決める——小節ごとに引くと、同じ楽句の前半だけが
		// 再現になって形が食い違う。
		const decided = phraseRestate.get(u);
		const restate = decided ?? rnd() < phraseRestateRate;
		if (decided === undefined) phraseRestate.set(u, restate);
		if (!restate) return null;
		for (let v = 0; v < u; v++) {
			if (units[v].source !== units[u].source) continue;
			if (units[v].role !== units[u].role) continue;
			// 答えどうしは着地音が違うので、後半の小節は再現しない。
			if (units[u].source === "answer" && barInUnit(bar) === 1) return null;
			return v * 2 + barInUnit(bar);
		}
		return null;
	};

	/**
	 * 音域をどれだけ広げる曲か（0〜1）。うねりの振幅とオクターブ跳躍の出やすさに掛ける。下限が
	 * 0でないとどの曲も必ず音域が広がり、狭いリフ曲が作れない。リフ型（{@link MelodyForm}）は
	 * 狭い側へ寄せる——同じ型を回す曲がオクターブを跳んで回っていたらオスティナートではない。
	 */
	const registerSpread =
		form === "ostinato" ? rnd() ** 2 * 0.5 : 0.25 + rnd() * 0.75;

	/**
	 * その曲の音域の窓を引く。幅は `registerSpread` から（狭いリフ曲〜広い歌い上げ）、中心は
	 * 絶対の音域（{@link MELODY_LOW}〜{@link MELODY_HIGH}）の中で余った幅ぶんを動かす。幅だけ
	 * 引いて中心を固定すると、全曲が同じ高さで歌う。
	 */
	const registerWidth = 15 + Math.round(registerSpread * 6);
	const registerRoom = MELODY_HIGH - MELODY_LOW - registerWidth;
	const registerCenter =
		MELODY_LOW +
		registerWidth / 2 +
		Math.round(rnd() * Math.max(0, registerRoom));

	const style: MelodyStyle = {
		groove: pick<Groove>(["eighth", "sixteenth"], rnd),
		register: makeRegister(registerCenter, registerWidth),
		contour: form === "ostinato" ? "flat" : pick(CONTOUR_SHAPES, rnd),
		// 掛留・倚音を使わない曲も混ぜる。全曲に撒くと「小節頭がいつも宙ぶらりん」
		// という別の癖になる。
		headTension: rnd() < 0.35 ? 0 : 0.12 + rnd() * 0.3,
		arcPeriod: pick([4, 8, 8, 16], rnd),
		arcPhase: pick([0, 1, 2], rnd),
		arcAmp: 5 * registerSpread,
		// **オクターブを一度も跳ばない曲を混ぜる。** ここが常に正だと、どの曲にもオクターブ跳躍が
		// 入って最大跳躍が必ず12半音以上になる。参考コーパスは半分の曲がオクターブを一度も跳ばない。
		octaveAffinity: rnd() < 0.35 ? 0 : 0.18 * registerSpread,
		maxLeap: pick(LEAP_CEILINGS, rnd),
		// **音階を厳しく締める曲は必ず中核音の歩数で組む**（{@link ComposeScale.strict}）——あの
		// 音階は「その5音である」ことが定義なので、ダイアトニックの度数で輪郭を作ると琉球音階なのに
		// レやラが入り込む。借りたフレーズはダイアトニックの度数で持っているので、ファ・シを自由に
		// 使う陽・民謡ではそのまま読む。
		pentatonicMotif: scale.strict,
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
		// 参考曲の跳躍率は p25〜p75 で 0.28〜0.41、最大跳躍の中央値は9半音。
		// 2声を交互に書いたチャンネルを主旋律と誤検出していた頃は 0.31〜0.65 に
		// 見えており、それに合わせて上限を高く取っていた。
		leapAffinity: 0.05 + rnd() * 0.2,
		// 界隈曲らしさ：調の外の音（クロマチック）や微小な逸脱を積極的に許容する。刻みを細かくすると
		// 経過音の置き場所が増えるので、同じ係数でも変化音は増える。
		// **音階を厳しく締める曲は変化音を控える。** 半音の経過音は長調・短調の泣きメロの芯だが、
		// 琉球・都節・律ではその半音が音階の外にしか無く、入れたぶんだけ音階の色が薄まる。
		// 0 にはしない——民族音階の実際の曲にも装飾の半音は出る。
		chromaticAffinity:
			(rnd() < 0.2 ? 0 : 0.12 + rnd() * 0.33) * (scale.strict ? 0.4 : 1),
		barHeadWeight: rnd() < 0.5 ? 3 : 2,
		bassStyle: bassOverride ?? pick<BassStyle>(BASS_STYLES, rnd),
		// 指名された奏法は線そのものが作風なので、ペダルや経過音の差し替えで崩さない。
		bassSkeleton: bassOverride ? "per-bar" : pick(BASS_SKELETONS, rnd),
		// 2小節フレーズの後半。前半と同じ型を引いたら「1小節フレーズ×2」に戻るので、
		// **必ず別の型**にする。
		bassStyleAlt: bassOverride ?? pick<BassStyle>(BASS_STYLES, rnd),
		// 短く切る奏法は、刻みの細かい書法（8分・オクターブ・オルタネイト）でだけ引く。
		// 4分打ちやウォーキングを短く切ると、支えるべき土台がスカスカになる。
		bassStaccato: rnd() < 0.45,
		// ゴーストは入れすぎるとただの雑音になるので、曲ごとに 0〜0.5 の範囲で引く。
		bassGhost: rnd() * 0.5,
		// **サブメロは旋律であること。** 曲単位の書法をハモリと対旋律に絞る。
		// パッド・保続音・付点2分は「置いただけの音」になりやすく、実際
		// サブメロの音の38%が全音符1つ（1.5音/小節）まで薄くなっていた。
		// それらは終止の小節でだけ使う逃げ道に降格する。
		subStyle: pick<SubStyle>(["harmony", "harmony", "counter"], rnd),
		subInterval: pick([3, 4, 8, 9], rnd),
	};

	/**
	 * 小節ごとの音域。曲の窓（{@link MelodyStyle.register}）を、セクションの
	 * {@link SectionSpec.registerShift} だけ上下させたもの。ヒット曲の推進力はほとんどが
	 * セクション間の落差なので、ここが平らだとメロディを何本引き直しても出てこない。
	 */
	const barRegister: Register[] = new Array(totalBars).fill(style.register);
	for (const sec of sectionPlan) {
		const secReg = shiftRegister(style.register, sec.spec.registerShift);
		for (
			let b = sec.startBar;
			b < sec.startBar + sec.bars && b < totalBars;
			b++
		)
			barRegister[b] = secReg;
	}

	// --- ②リズム型を先に設計する ---
	//
	// **役割ごとに1つのリズム型を曲全体で使い回す。** 参考にした曲は、隣り合う小節で毎回別の型を
	// 引くより**はるかに反復し、音価の種類も絞っている**。毎小節ちがう形を引くと、1曲の中では
	// 変化に富むが曲どうしの区別が付かなくなる——どの曲も同じ「均等にばらけた」テクスチャに
	// なるため。曲の顔になるのは変化ではなく反復の型。
	// **モチーフは2小節。** 1小節の型から全部作ると、「ボーカルが一息で歌いきる長さ」という
	// 言い回しの単位を持てない。
	const motifPool = groovyCells(MOTIF_CELLS, style.groove, rnd);

	/**
	 * 曲ごとの狙いの休符率。範囲を狭く取ると「メロディが休まない曲」しか作れない。参考コーパスの
	 * 帯の全域を覆いつつ、二乗で低い側へ寄せる——歌モノは詰まっているのが普通で、スカスカな曲は
	 * 少数派。
	 */
	const targetRestRatio = 0.02 + rnd() ** 2 * 0.42;
	/**
	 * 曲ごとの「刻みの細かさ」の狙い（1小節あたりの音数）。型をただ引くと密度が引きの平均へ
	 * 集まるので、狙いを先に決めて近い型を引く。
	 *
	 * 休符率と独立に引くと「休符率0.40なのに音数9.0」のような両立しない狙いが出て、
	 * {@link cellDistance} が音数の項と休符の項で引っぱり合ってどちらも達成できない。コーパス
	 * では両者に負の相関があるので、その回帰線を中心に±2音の幅で引く。
	 */
	const targetNotesPerBar = Math.max(
		2.8,
		Math.min(12.5, 7.4 - 6.0 * targetRestRatio + (rnd() * 7 - 2.5)),
	);
	/** 1小節の型が持つ音数。 */
	const cellNotes = (c: RhythmCell): number =>
		c.value.filter((v) => v > 0).length;
	/** 1小節の型が休符に使うステップの比率。 */
	const cellRest = (c: RhythmCell): number => {
		let rest = 0;
		let total = 0;
		for (const v of c.value) {
			total += Math.abs(v);
			if (v < 0) rest += -v;
		}
		return total === 0 ? 0 : rest / total;
	};
	/**
	 * 狙いの密度からの遠さ。`densityMul` はセクションごとの倍率で、
	 * Aメロは落ち着いた音数、Bメロ・サビは詰まった音数へ寄る。
	 */
	const cellDistance = (c: RhythmCell, densityMul = 1.0): number =>
		Math.abs(cellNotes(c) - targetNotesPerBar * densityMul) +
		Math.abs(cellRest(c) - targetRestRatio / Math.max(0.5, densityMul)) * 8;
	/** 参考曲の出現頻度に比例して1本引く（{@link cellWeight}）。 */
	const weightedPick = (pool: RhythmCell[]): RhythmCell => {
		let total = 0;
		for (const c of pool) total += cellWeight(c);
		let r = rnd() * total;
		for (const c of pool) {
			r -= cellWeight(c);
			if (r <= 0) return c;
		}
		return pool[pool.length - 1];
	};
	/**
	 * 型を1本引く。狙いの休符率でプールを絞ってから、その中を参考曲の頻度で引く。
	 *
	 * {@link cellWeight} の上位は休符ゼロの密な型が占めるので、頻度で引いてから狙いに近いものを
	 * 選ぶ形だと休符の多い型はほぼ当たらず、「メロディが休まない曲」しか作れない。引く本数を
	 * 増やしても頭打ちで、頻度で引く前に狙いの帯へ入る型だけを残すのが要点。
	 */
	const pickCell = (pool: RhythmCell[], densityMul = 1.0): RhythmCell => {
		const want = targetRestRatio / Math.max(0.5, densityMul);
		// 帯の幅は狙いに比例させる。休符の少ない曲まで細かく絞ると、
		// 「休符ゼロ」しか残らず語彙が痩せる。
		const tol = Math.max(0.08, want * 0.6);
		const near = pool.filter((c) => Math.abs(cellRest(c) - want) <= tol);
		const from = near.length > 0 ? near : pool;
		let best = weightedPick(from);
		// **本数は増やさない。** 狙いへ精密に当てにいくと、どの小節も狙いぴったりになって小節ごとの
		// 密度の差が消える（{@link DRAW_COUNT} と同じ罠——選抜を強めると分布が痩せる）。
		// 密度の幅はここではなく**セクションごとの狙い**（`densityMul`）で作る。
		for (let i = 0; i < 2; i++) {
			const c = weightedPick(from);
			if (cellDistance(c, densityMul) < cellDistance(best, densityMul))
				best = c;
		}
		return best;
	};

	/**
	 * セクション間の密度差の大きさ。曲ごとに引く。倍率が全曲共通の定数だと、密度の付け方そのもの
	 * が指紋になる。差をほとんど付けない曲から、Aメロを絞ってサビで一気に詰める曲まで。
	 */
	const densityContrast = 0.5 + rnd() * 1.3;
	/** セクションの役割 → 音数の倍率。1.0 が曲の狙いそのもの。 */
	const densityOf = (deviation: number): number =>
		1 + deviation * densityContrast;
	/** Aメロは控えめ。 */
	const densityA = densityOf(-0.15);
	/** サビは詰める。 */
	const densityB = densityOf(0.2);
	/** Bメロはサビへの助走。 */
	const densityA2 = densityOf(0.1);
	/** Cメロは少し引く。 */
	const densityC = densityOf(-0.1);

	/**
	 * 人間が書いた2小節フレーズを1つ引く。ここが今の作曲の要。
	 *
	 * 統計を目標にする方式は、分布を参考コーパスと一致させたうえで1曲もキャッチーにならなかった。
	 * 差は分布ではなく並び順にあり、距離を目標にする限りその情報は入らない。だから並び順は作らず
	 * に借りてくる。リズムと音高を対にしたまま引くのが肝。
	 *
	 * 引き方はコーパスでの出現回数（`weight`）× 狙いの密度への近さ。密度から離れたフレーズを
	 * 引くと緩急の設計が崩れる。
	 */
	const pickPhrase = (
		densityMul: number,
		exclude: CorpusPhrase[],
		/** このリズムを持つフレーズは引かない（サビのフックを他所へ漏らさないため）。 */
		banRhythm?: string,
	): CorpusPhrase => {
		const want = targetNotesPerBar * densityMul * 2;
		const pool = CORPUS_PHRASES.filter(
			(x) =>
				!exclude.includes(x) &&
				(banRhythm === undefined || x.rhythm.join(",") !== banRhythm),
		);
		let total = 0;
		const weights = pool.map((x) => {
			const notes = x.rhythm.filter((v) => v > 0).length;
			const w = x.weight / (1 + (notes - want) ** 2 * 0.25);
			total += w;
			return w;
		});
		let ticket = rnd() * total;
		for (let i = 0; i < pool.length; i++) {
			ticket -= weights[i];
			if (ticket <= 0) return pool[i];
		}
		return pool[pool.length - 1];
	};

	/** フレーズのリズムを小節線で2つに割る。バンクは割れる形だけを持っている。 */
	const splitPhrase = (p: CorpusPhrase): [RhythmCell, RhythmCell] => {
		const head: number[] = [];
		const tail: number[] = [];
		let acc = 0;
		for (const v of p.rhythm) {
			(acc < BASE_STEPS_PER_BAR ? head : tail).push(v);
			acc += Math.abs(v);
		}
		return [
			{ value: head, density: "medium" },
			{ value: tail.length > 0 ? tail : head, density: "medium" },
		];
	};

	// --- モチーフの素材は、人間が書いたフレーズから借りる ---
	//
	// リズム型と音高の輪郭を別々に引いて掛け合わせる方式は、17指標も隣接音程のヒストグラムも
	// コーパスと一致させたうえで**1曲もキャッチーにならなかった**。分布が一致して知覚が完全に
	// 分離するなら差は並び順にあるので、並び順は作らずに借りる。リズムと音高を**対のまま**引く
	// のが肝で、別々に持って掛け合わせた時点で人間が選んだ情報が消える。
	//
	// セクションごとに別のフレーズを引く（A / Bメロ / サビ / Cメロ）。展開・息継ぎ・ビルド
	// アップの型は合成の語彙から引く——フレーズは「顔」を作る場所で、つなぎまで借りると曲が
	// コーパスの継ぎ接ぎになる。
	const drawnPhrases: CorpusPhrase[] = [];
	const drawPhrase = (mul: number, banRhythm?: string): CorpusPhrase => {
		const got = pickPhrase(mul, drawnPhrases, banRhythm);
		drawnPhrases.push(got);
		return got;
	};
	// **サビのフレーズを最初に引く。** サビ冒頭2小節はこの曲のフック
	// （{@link hookUnits}）で、「サビでしか鳴らない型」であることがフックの条件そのもの。
	// 後から引く側を避けさせるには、避ける対象が先に決まっていなければならない。
	const phraseB = drawPhrase(densityB);
	/** フックのリズム。サビ以外のセクションの素材はこれを引かない。 */
	const hookRhythm = phraseB.rhythm.join(",");
	const phraseA = drawPhrase(densityA, hookRhythm);
	const phraseA2 = drawPhrase(densityA2, hookRhythm);
	const phraseC = drawPhrase(densityC, hookRhythm);
	// **答えにも別のフレーズを引く。** 1セクションに1フレーズだと問いも答えも同じ素材を使い回す
	// ことになり、参考曲より反復が過剰になる（聴くと「同じフレーズの繰り返しで精度が悪い」と
	// 受け取られる）。**反復は多いほど良いわけではない**——フックが記憶に残るのは同じ形が
	// **変化を伴って**返るからで、無変化の反復は機械が作ったことの目印になる。
	const phraseAnsA = drawPhrase(densityA, hookRhythm);
	const phraseAnsB = drawPhrase(densityB);
	/**
	 * 2周目の問いに使う素材。8小節のセクションは【問い→答え→問いの変形→答え】で、3つ目の楽句は
	 * 1つ目と同じ `source` を持つ。素材が1つしか無いと「変形」が複製になるので、2周目には
	 * 別の素材を当てる（同じ側の性格＝密度は保ったまま形だけ変える）。
	 */
	const phraseA2nd = drawPhrase(densityA, hookRhythm);
	const phraseB2nd = drawPhrase(densityB);
	/**
	 * 素材をどれだけ使い回すか。曲ごとに引く。0に近いほど1つの素材を回し続け（リフ物）、
	 * 1に近いほど楽句ごとに別の素材を出す（展開していく曲）。
	 *
	 * 反復の量をコーパスの平均へ合わせてはいけない——反復の多い曲と少ない曲が混ざった集団の平均
	 * に全曲を揃えると、どの曲も同じ反復量になる。曲調の側を引く。
	 */
	const phraseVariety = rnd();
	const [motifA2nd, motifA2nd2] = splitPhrase(phraseA2nd);
	const [motifB2nd, motifB2nd2] = splitPhrase(phraseB2nd);
	const [motifAnsA, motifAnsA2] = splitPhrase(phraseAnsA);
	const [motifAnsB, motifAnsB2] = splitPhrase(phraseAnsB);
	const [motifCell, motifCell2] = splitPhrase(phraseA);
	const [motifA2, motifA22] = splitPhrase(phraseA2);
	const [motifB, motifB2] = splitPhrase(phraseB);
	const [motifC, motifC2] = splitPhrase(phraseC);
	/**
	 * 素材 → 音高の並び（音階度数）。バンクの度数はダイアトニックの7度で数えてあり、そのまま
	 * 使う。5音音階の中核音の歩数へ写すと2度と3度が同じ歩数へ丸められ、借りてきた旋律の顔が
	 * そこで消える。
	 */
	const contourCache = new Map<string, number[]>();
	/**
	 * その小節が使う素材の名前。答えの楽句は**直前の楽句の側**（Aメロ側かサビ側か）で
	 * 答え用のフレーズへ振り分ける。
	 */
	const sourceOfBar = (bar: number): string => {
		const u = unitOf(bar);
		const src = units[u].source;
		if (src === "answer") {
			// 反復が身上の曲は、答えも問いの素材で受ける。
			if (!useAlt(u)) return units[u - 1]?.source === "b" ? "b" : "a";
			return units[u - 1]?.source === "b" ? "ansB" : "ansA";
		}
		// 同じセクション内で同じ素材が2度目に出てきたら、2周目の素材へ移ることがある。
		// 移るかどうかは曲の性格（{@link phraseVariety}）で決まる。
		if (secondRound(u) && useAlt(u))
			return src === "b" || src === "solo" ? "b2nd" : "a2nd";
		return src;
	};

	/**
	 * 2周目に別の素材を出すか。楽句ごとに1度だけ決めて覚える
	 * （小節ごとに引くと同じ楽句の前半と後半で食い違う）。
	 */
	const altMemo = new Map<number, boolean>();
	const useAlt = (u: number): boolean => {
		const hit = altMemo.get(u);
		if (hit !== undefined) return hit;
		const made = rnd() < phraseVariety;
		altMemo.set(u, made);
		return made;
	};

	/** その楽句が、セクション内で同じ素材の2度目以降か。 */
	const secondRound = (u: number): boolean => {
		const sec = units[u].section;
		const src = units[u].source;
		for (let v = 0; v < u; v++)
			if (units[v].section === sec && units[v].source === src) return true;
		return false;
	};
	const contourOf = (source: string): number[] => {
		const hit = contourCache.get(source);
		if (hit) return hit;
		const raw =
			source === "a2nd"
				? phraseA2nd.degrees
				: source === "b2nd"
					? phraseB2nd.degrees
					: source === "ansB"
						? phraseAnsB.degrees
						: source === "ansA"
							? phraseAnsA.degrees
							: source === "b" || source === "solo"
								? phraseB.degrees
								: source === "a2"
									? phraseA2.degrees
									: source === "c"
										? phraseC.degrees
										: phraseA.degrees;
		contourCache.set(source, raw);
		return raw;
	};

	/**
	 * 応答・展開用のバリエーション型。毎小節バラバラにはせず、基本のモチーフを反復しつつ
	 * 小楽節の後半や答えの応答で変化をつける。
	 */
	const motifVar = pickCell(
		motifPool.filter((c) => c !== motifCell && c !== motifCell2),
	);
	const motifBVar = pickCell(
		motifPool.filter((c) => c !== motifB && c !== motifB2),
	);
	/** Bメロの最後の小節（サビ直前）のビルドアップ型（8分連打・キメ）。 */
	const buildUpCell: RhythmCell = pick(
		[
			{
				value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, QUARTER, -QUARTER],
				density: "medium",
			},
			{
				value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, -QUARTER],
				density: "medium",
			},
			{
				value: [QUARTER, QUARTER, QUARTER, QUARTER],
				density: "medium",
			},
			{
				value: [EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, EIGHTH, QUARTER],
				density: "medium",
			},
		],
		rnd,
	);

	// 対旋律のリズム。曲ごとに1つ引いて使い回す（サブメロにも「その曲の型」を持たせる）。
	const counterRhythm = pick(
		groovyCells(
			RHYTHM_CELLS.filter((c) => c.density === "medium"),
			style.groove,
			rnd,
		),
		rnd,
	).value;

	/**
	 * 答えの後半小節。曲全体で1つだけ引くと、どのセクションの終わりも
	 * 寸分違わず同じ形で空く。セクションごとに、隣と重ならないよう引き直す。
	 */
	const breathBySection = new Map<number, RhythmCell>();
	{
		let prev: RhythmCell | null = null;
		for (const section of sectionPlan) {
			if (!section.spec.melody) continue;
			const pool = PHRASE_END_CELLS.filter((c) => c !== prev);
			const cell = pick(pool.length > 0 ? pool : PHRASE_END_CELLS, rnd);
			breathBySection.set(section.startBar, cell);
			prev = cell;
		}
	}
	/** 小楽節の切れ目に置く軽い息継ぎ。こちらは曲の型として1つに揃える。 */
	const midBreathCell = pick(MID_BREATH_CELLS, rnd);

	/** 息継ぎの小節。ここへタイを食い込ませると無音の小節ができるので覚えておく。 */
	const breathBars = new Set<number>();

	/**
	 * メロディのあるセクションの最終小節。形を作り込んであるので、後段の「リズムの有機的な
	 * 揺らぎ」で割らせない（割ると受けのロングトーンが8分になり、息継ぎが消える）。
	 */
	const phraseEndBars = new Set<number>();
	for (const section of sectionPlan) {
		if (!section.spec.melody) continue;
		phraseEndBars.add(section.startBar + section.bars - 1);
	}

	// --- サビのフック ---
	//
	// **フックは「サビの冒頭2小節」ではなく「サビの中で返ってくる2小節」。** 冒頭に何かを
	// 置けばフックになるわけではなく、同じサビの中でもう一度返ってきて初めて覚えられる。
	// 逆に、その型がAメロやBメロでも鳴っていたら、サビに入ったことが分からない
	// （リズム型が同じなら、音域が上がっただけの同じ景色に聞こえる）。
	//
	// 曲ごとの反復量（{@link phraseVariety}）に任せていた間は、サビ内での再現も他セクションへの
	// 漏れも運任せだった。素材の側で漏らさないようにし（{@link hookRhythm}）、返す場所は
	// ここで確保する。
	const hookUnits = new Set<number>();
	for (const section of sectionPlan) {
		if (section.kind !== "chorus") continue;
		const base = unitOf(section.startBar);
		hookUnits.add(base);
		// 2つ目は4小節あと（【問い→答え→問いの変形→答え】の3つ目の楽句）。
		// 8小節に満たないサビには返す場所が無いので置かない。
		if (section.bars >= 8) hookUnits.add(base + 2);
	}
	/** フックの小節。後段の食い・分割で形を崩させない。 */
	const hookBars = new Set<number>();
	for (const u of hookUnits) {
		hookBars.add(u * 2);
		hookBars.add(u * 2 + 1);
	}

	// **返ってくるフックのうち1回は上で歌う。** 同じ高さで2回繰り返すだけでは「もう一度
	// 鳴った」で終わり、そこが曲の頂点にならない。最後のサビの2回目のフックを音域の上端へ
	// 寄せて（＝フックを移調して）、曲の最高音をサビの中に置く。
	{
		let last: PlacedSection | null = null;
		for (const section of sectionPlan)
			if (section.kind === "chorus" && section.bars >= 8) last = section;
		if (last) {
			const u = unitOf(last.startBar) + 2;
			const reg = barRegister[u * 2];
			// 上端から1オクターブぶん。これより狭めるとフレーズが窓に収まらず、
			// 輪郭を保ったまま置けなくなる（{@link shapeBar} の `preserveContour`）。
			const top: Register = {
				low: Math.max(reg.low, reg.high - 12),
				high: reg.high,
				center: reg.high - 6,
			};
			barRegister[u * 2] = top;
			barRegister[u * 2 + 1] = top;
		}
	}

	const barRhythms: number[][] = [];
	/**
	 * その小節がどの小節を歌い直しているか（{@link restatementOf} の結論）。音高の側も
	 * 同じ答えを使う——リズムだけ別の型に差し替えると、写す音の数が合わなくなる。
	 */
	const restateBar: (number | null)[] = [];
	/** 通し作曲で楽句ごとに引いた型。2小節でひとまとまりにするため楽句単位で覚える。 */
	const throughPairs = new Map<number, [RhythmCell, RhythmCell]>();
	for (let bar = 0; bar < totalBars; bar++) {
		const u = unitOf(bar);
		const half = barInUnit(bar);
		const found = restatementOf(bar);
		// フックの小節が歌い直せるのはフックの小節だけ。別の楽句を写すと、
		// この小節に置いたフックの型と音の数が食い違う。
		const source =
			found !== null && (!hookUnits.has(u) || hookBars.has(found))
				? found
				: null;
		restateBar.push(source);
		if (source !== null) {
			// 同じ素材の楽句は、リズムもそのまま歌い直す。
			barRhythms.push(barRhythms[source]);
			if (breathBars.has(source)) breathBars.add(bar);
			continue;
		}
		// フックはサビのフレーズそのものを置く。曲の性格（{@link phraseVariety}）で
		// 2周目の素材へ移る枝も、答えのリズムで受ける枝も、ここだけは通さない。
		if (hookUnits.has(u)) {
			barRhythms.push(scaleCell((half === 0 ? motifB : motifB2).value));
			continue;
		}
		// ソロ（間奏）はサビと同じ素材で書く。{@link sourceOf} が interlude を "b" に
		// 割り当てているのと同じ理由で、間奏だけ無関係な語彙にすると曲から浮く。
		const isB = units[u].source === "b" || units[u].source === "solo";
		const isA2 = units[u].source === "a2";
		const isC = units[u].source === "c";
		const isPrechorusEnd =
			units[u].section.kind === "prechorus" &&
			bar === units[u].section.startBar + units[u].section.bars - 1;

		if (isPrechorusEnd) {
			// Bメロの最後の小節はサビへのビルドアップ
			barRhythms.push(scaleCell(buildUpCell.value));
			continue;
		}

		/** その楽句が使う2小節ぶんのリズム型（前半・後半）。 */
		const pair = (): [RhythmCell, RhythmCell] => {
			// **通し作曲は楽句ごとに型を引き直す。** 音の再現だけ止めてリズムを使い回すと、
			// {@link barSimilarity} は6割がリズムの一致なので自己相似が下がらない。通し作曲という型の
			// 中身は「素材が戻ってこないこと」そのもの。
			if (form === "through") {
				const memo = throughPairs.get(u);
				if (memo) return memo;
				const mul = isB
					? densityB
					: isA2
						? densityA2
						: isC
							? densityC
							: densityA;
				const head = pickCell(motifPool, mul);
				const tail =
					rnd() < 0.45
						? head
						: pickCell(
								motifPool.filter((c) => c !== head),
								mul,
							);
				const made: [RhythmCell, RhythmCell] = [head, tail];
				throughPairs.set(u, made);
				return made;
			}
			if (secondRound(u) && useAlt(u))
				return isB ? [motifB2nd, motifB2nd2] : [motifA2nd, motifA2nd2];
			return isB
				? [motifB, motifB2]
				: isA2
					? [motifA2, motifA22]
					: isC
						? [motifC, motifC2]
						: [motifCell, motifCell2];
		};
		let cell: RhythmCell;
		if (units[u].source === "answer") {
			// 答えは問いのリズムを受けて着地する。
			const isPeriodEnd = units[u].landing !== null;
			const prevSource = units[u - 1]?.source;
			// 答えは問いの**続き**。別素材で受けるか問いの素材で受けるかは曲の性格で決まる。
			const [head, tail] = useAlt(u)
				? prevSource === "b"
					? [motifAnsB, motifAnsB2]
					: [motifAnsA, motifAnsA2]
				: prevSource === "b"
					? [motifB, motifB2]
					: [motifCell, motifCell2];
			// 答えの小節で、問いのリズムから適度に発展・応答するバリエーション
			const answerVar = prevSource === "b" ? motifBVar : motifVar;
			if (half === 0) {
				// **答えが問いのリズムをそのまま受ける割合。**
				// 0.15（＝85%そのまま）だった頃は lag2 の完全一致が 44%まで膨らんでいた
				// （参考曲 28.1%）。「問いを受ける」は着地音と輪郭の話で、
				// リズムまで毎回同一である必要はない。
				cell = rnd() < ANSWER_VARY ? answerVar : head;
			} else if (isPeriodEnd) {
				// セクションの終わり。着地してから息を継ぐ。
				cell = breathBySection.get(units[u].section.startBar) ?? tail;
				breathBars.add(bar);
			} else {
				// **小楽節の切れ目にも息継ぎを置く。** ここを普通の密度で埋めると、
				// 8小節のセクションが「7小節ベタ詰め＋1小節スカ」になる。
				cell = rnd() < 0.28 ? midBreathCell : rnd() < 0.12 ? answerVar : tail;
			}
		} else {
			const [head, tail] = pair();
			cell = half === 0 ? head : tail;
		}
		barRhythms.push(scaleCell(cell.value));
	}

	// --- ③その上に音を乗せる ---
	// 音高の並びは**フレーズが持っている**（{@link contourOf}）。以前はここで
	// 手書きの型の一覧を周回させて輪郭を組み立てていたが、リズムと音高を
	// 別々に作って掛け合わせる作り方そのものをやめた。

	/** 小節ごとに実際に使った音の並び（度数）。A' / A'' の再現で読み直す。 */
	const plannedDegrees: (number[] | null)[] = new Array(totalBars).fill(null);
	/** 同じ度数の並びに対して前回使った移調量（{@link fitMotif} の preferShift）。 */
	const motifShiftMemo = new Map<string, number>();
	/** 楽句（2小節）ごとの移調量。素材は2小節でひとまとまりなので前後半で揃える。 */
	const unitShiftMemo = new Map<number, number>();
	const melody: ComposedNote[] = [];
	const submelody: ComposedNote[] = [];
	const bass: ComposedNote[] = [];
	const harmony: ComposedNote[] = [];
	const harmony2: ComposedNote[] = [];
	const pad: ComposedNote[] = [];
	/** 間奏の器楽ソロ。主旋律とは別のトラック・別の楽器で鳴らす。 */
	const solo: ComposedNote[] = [];
	const melodyDurations: number[] = [];
	/** 小節ごとの緊張度（0〜1）。和音が無い小節は0のまま。 */
	const barTension: number[] = new Array(totalBars).fill(0);
	let restSteps = 0;
	let maxLeap = 0;
	let leaps = 0;
	let steps = 0;
	let intervals = 0;
	/** 調の外の音（変化音）の数。{@link applyChromatic} が通した音。 */
	let chromaticNotes = 0;
	/** メロディを書いた小節の数（休符率の母数）。 */
	let sungBars = 0;
	// 開始音を曲ごとに変える。初版はここが 72 固定で、60%の曲が同じ音から始まっていた。
	let prevSemi = pick([60, 64, 65, 67, 69, 72, 74, 76], rnd);
	/**
	 * 直前に**歌った**音。跳躍は歌い手が声で辿る距離なので、間奏のソロや曲頭の仮の音
	 * （`prevSemi` の初期値）を起点に数えても意味が無い。
	 */
	let lastSungSemi: number | null = null;
	/** 大跳躍の残り回数（{@link WIDE_LEAP_BUDGET}）。 */
	let wideLeapsLeft = WIDE_LEAP_BUDGET;

	/** 隙間の長さに収まる言い回しを1つ引く。収まるものが無ければ置かない。 */
	const pickFigure = (
		gapSteps: number,
		scale: (v: number) => number,
	): number[] | null => {
		const fits = ANSWER_FIGURES.filter(
			(f) => f.reduce((sum, v) => sum + scale(Math.abs(v)), 0) <= gapSteps,
		);
		return fits.length === 0 ? null : pick(fits, rnd);
	};

	/** 小節内でメロディが鳴っていない区間。合いの手をメロディの隙間にだけ置くのに使う。 */
	const melodyGaps = (slots: Slot[]): [number, number][] => {
		const gaps: [number, number][] = [];
		let cursor = 0;
		for (const s of slots) {
			if (s.at > cursor) gaps.push([cursor, s.at - cursor]);
			cursor = s.at + s.value;
		}
		if (cursor < stepsPerBar) gaps.push([cursor, stepsPerBar - cursor]);
		return gaps;
	};

	for (let bar = 0; bar < totalBars; bar++) {
		const role = barRoles[bar];
		const barStart = bar * stepsPerBar;
		const tones = chordTones(progression[bar]);
		// 半小節で和音が動く曲の、後半の和音（{@link HarmonicRhythm}）。
		const lateChordName = barChords[bar][1] ?? null;
		const tonesLate = lateChordName ? chordTones(lateChordName) : null;
		const lateAt = Math.floor(stepsPerBar / 2);
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
		// **盛り上がる側のセクションだけは3度・7度への着地を許す。** ルート・5度へ落とし続けると
		// 和音がいくら動いても緊張が上がらず、「サビで景色が変わる」効果が出ない。
		// 判定は**セクションで**行う——セクション長を {@link SectionSpec.barChoices} から引くので、
		// 小節番号の決め打ちでは狙ったセクションに当たらない。
		const headKind = sectionAt(sectionPlan, bar).kind;
		const isSectionB =
			headKind === "prechorus" ||
			headKind === "chorus" ||
			headKind === "drop_chorus" ||
			headKind === "bridge";
		const headWeight: 2 | 3 = isSectionB ? 2 : style.barHeadWeight;
		// **大きな周期で上下させる。** 直前の音の近くへ着地させるだけだと、細かいジグザグはあっても
		// 曲全体では同じ高さをうろつき続ける。上げるメロディと下げるメロディを交互に置くのが歌モノの
		// 定石なので、小節ごとの目標の高さを曲単位の周期で振って引き寄せる。形そのものも曲ごとに引く
		// （{@link ContourShape}）——正弦波1種類では、周期と位相を振っても癖が全曲に残る。
		const arc = contourAt(
			style.contour,
			bar,
			totalBars,
			style.arcPeriod,
			style.arcPhase,
		);
		// **うねりの基準はその小節の音域の中心。** 定数（全曲同じ高さ）だったのを、
		// 曲ごとの窓（{@link MelodyStyle.register}）＋セクションごとの上下
		// （{@link SectionSpec.registerShift}）へ移した。
		const reg = barRegister[bar];
		const arcCenter = reg.center + arc * style.arcAmp;
		// 楽句の2小節目（barInUnit === 1）は1小節目のフレーズの続きなので、
		// 前小節末尾の音（prevSemi）からの順次・スムーズな接続を優先する。
		// 1小節目（barInUnit === 0）は楽句の開始なので、arcCenter を交えて目標を定める。
		const inUnit = barInUnit(bar);
		let headSemi: number;
		if (inUnit === 1 && bar > 0) {
			// 前小節末尾の音からスムーズに繋がる和音構成音へ着地（小節境界の跳躍を防ぐ）
			headSemi = nearestChordTone(prevSemi, tones, headWeight, isSectionB).semi;
			if (Math.abs(headSemi - prevSemi) > 4) {
				// 跳躍が大きすぎる場合はより近い構成音を許容
				headSemi = nearestChordTone(prevSemi, tones, 1, isSectionB).semi;
			}
		} else {
			// 直前の音と目標の中間へ寄せる（いきなり飛ばず、数小節かけて上下する）。
			const headTarget = prevSemi + (arcCenter - prevSemi) * 0.5;
			headSemi = nearestChordTone(
				headTarget,
				tones,
				headWeight,
				isSectionB,
			).semi;
		}
		// モチーフ小節が2つ続くと、和音が同じなら音まで完全に同じ小節が並ぶ。
		// 2度目は少しずらして「反復」ではなく「一歩進んだ反復」にする。
		// この小節が輪郭のどこから始まるか。楽句の後半小節は前半の続きを読む。
		const contourOffset =
			barInUnit(bar) === 0
				? 0
				: barRhythms[bar - 1].filter((v) => v > 0).length;
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
			scale,
			contourOf(sourceOfBar(bar)),
			semitoneToDegree(scale, headSemi),
			contourOffset,
			repeatShift,
			headWeight,
			isSectionB,
			quarterSteps,
			reg,
			rnd,
		);
		// 再現の小節は、元の小節の音の並びをそのまま使う。和音が違っても
		// **音を曲げず、塊ごと移調して**合わせる（{@link fitMotif}）ので、
		// 同じフレーズが返ってきたと耳で分かる。
		const source = restateBar[bar];
		if (source !== null && plannedDegrees[source])
			degrees.splice(
				0,
				degrees.length,
				...(plannedDegrees[source] as number[]),
			);
		// 楽句の最後の小節は、着地音を決めて終わる（半終止／全終止）。
		const landing = units[unitOf(bar)].landing;
		if (landing !== null && barInUnit(bar) === 1)
			landOn(scale, degrees, landing);
		plannedDegrees[bar] = [...degrees];

		// モチーフ系と再現の小節は「塊ごと移調して輪郭を保つ」、それ以外は従来どおり
		// 1音ずつ和音へ寄せる。フックは形が変わらないことに意味がある。
		const isMotifBar =
			source !== null ||
			role === "motif" ||
			role === "sequence" ||
			role === "climax" ||
			role === "answer";
		let fitted = degrees;
		if (isMotifBar) {
			// 同じ度数の並びを置いた小節どうしは、同じ移調量で置く（{@link fitMotif}）。
			const shiftKey = degrees.join(",");
			// **楽句の2小節は同じ移調量で置く。** 素材は2小節でひとまとまり（{@link CORPUS_PHRASES}）
			// なので、度数の並びをキーにすると前半と後半が別々に移調され、借りてきたフレーズが小節線で
			// 割れて継ぎ目に大跳躍が出る。`preferShift` は「和音の当たりが大きく悪化しないかぎり使う」
			// という柔らかい指定なので、和音が変わる小節では必要なぶんだけずれる。
			const unitKey = unitOf(bar);
			const prefer =
				barInUnit(bar) === 1
					? (unitShiftMemo.get(unitKey) ?? motifShiftMemo.get(shiftKey) ?? null)
					: (motifShiftMemo.get(shiftKey) ?? null);
			const r = fitMotif(
				degrees,
				slots,
				tones,
				prevSemi,
				quarterSteps,
				scale,
				style.pentatonicMotif,
				prefer,
				reg,
				tonesLate,
				lateAt,
				// リフ型は和音へ寄せない。同じセルを回し続けるのが役目。
				form === "ostinato" ? 0 : 3,
			);
			fitted = r.degrees;
			motifShiftMemo.set(shiftKey, r.shift);
			if (barInUnit(bar) === 0) unitShiftMemo.set(unitKey, r.shift);
		}
		const pitches = shapeBar(fitted, slots, tones, prevSemi, {
			scale,
			register: reg,
			maxLeap: style.maxLeap,
			allowLeap: role === "climax",
			allowArpeggio:
				role === "climax" ||
				(role === "run" && style.runShape === "broken") ||
				(role === "cadence" && style.cadenceShape !== "descend"),
			quarterSteps,
			// モチーフ・セクエンツ・サビの小節はオクターブ移動を入れない。輪郭が命なので、後から音を1つ
			// 跳ばすと「同じフレーズが返ってきた」と分からなくなる（モチーフ側は借りてきたフレーズが自前
			// で輪郭を持つ）。答えの小節は輪郭を借りているだけなので許す。
			octaveAffinity:
				role === "motif" || role === "sequence" || role === "climax"
					? 0
					: style.octaveAffinity,
			chromaticAffinity: style.chromaticAffinity,
			tonesLate,
			lateAt,
			rnd,
			// **半小節で和音が動く小節は輪郭保持を外す。** `preserveContour` は和音補正（強拍の着地・
			// アボイド回避）を一切通らない素通りなので、和音が2つある小節でどちらにも当たる移調量が
			// 無いと、後半の音が前半の和音のまま取り残される。実際の作編曲でも、和音が速く動く曲の
			// モチーフは和音ごとに音を差し替える——「同じ形が返ってくる」のは音単位ではなく楽句単位。
			preserveContour: isMotifBar && !tonesLate,
		});

		if (landing !== null && barInUnit(bar) === 1)
			landPitch(scale, pitches, landing, reg);

		// **イントロと間奏は歌メロを書かない。** 置くとどのセクションも同じ顔になり「ずっと歌って
		// いる曲」になる。伴奏・ベース・ドラム（とサブメロ）は鳴るので無音にはならない。
		// 間奏だけは同じ音の並びを `melody` ではなく `solo` へ書く——歌が休む場所を器楽が引き取る
		// 形で、別トラック・別楽器で鳴らせば「間奏はギターソロ」になる。
		const unitSource = units[unitOf(bar)].source;
		const isSolo = unitSource === "solo";
		const silent = unitSource === "silent" || isSolo;

		// **大跳躍は回数で絞る**（{@link WIDE_LEAP_BUDGET}）。予算を使い切った跳躍は、
		// 跳んだ先をオクターブ折り返して音域の中へ戻す。
		//
		// 収まったかどうかは**歌える音域の全体**（{@link MELODY_LOW}〜{@link MELODY_HIGH}）で
		// 見る。その小節の窓で見ると、10半音の跳躍を折り返した先が窓の外へ2〜3半音はみ出す
		// ——つまり**直したい跳躍ほど直せない**——ことになる。窓はセクションの高さを作るための
		// 目安であって、歌える／歌えないの境目ではない。
		//
		// **変化音を通すより前に畳む。** 経過音の変化音は順次で入って順次で出るから通り過ぎる音に
		// なるので（{@link applyChromatic} の②）、置いた後でその隣をオクターブ動かすと、行き場の
		// 無い音として耳に残る。
		if (!silent && lastSungSemi !== null) {
			let ref = lastSungSemi;
			for (let i = 0; i < pitches.length; i++) {
				const gap = pitches[i] - ref;
				if (Math.abs(gap) > WIDE_LEAP_SEMITONES) {
					const by = -Math.sign(gap) * 12;
					const sings = (p: number): boolean =>
						p + by >= MELODY_LOW && p + by <= MELODY_HIGH;
					// **小節の頭で跳んでいるなら、まず小節ごと折り返す。** その1音だけ動かすと
					// 借りてきたフレーズの形がその小節でだけ崩れ、「同じ形が返ってきた」が
					// 消える（4小節の自己相似が落ちる）。塊ごと動かせば形は保たれる。
					// 塊では音域からはみ出す小節だけ、1音ずつの折り返しに落とす。
					const whole = i === 0 && pitches.every(sings);
					if (
						wideLeapsLeft <= 0 &&
						Math.abs(pitches[i] + by - ref) < Math.abs(gap) &&
						(whole || sings(pitches[i]))
					) {
						if (whole)
							for (let j = 0; j < pitches.length; j++) pitches[j] += by;
						else pitches[i] += by;
					} else wideLeapsLeft = Math.max(0, wideLeapsLeft - 1);
				}
				ref = pitches[i];
			}
		}

		// **最後に変化音を通す。** ここまでの音は全部ハ長調の音階の上にあり、
		// セカンダリドミナントの上でも和音の変化音を採れていなかった
		// （実測で非ダイアトニック音が1音も出ない＝調が固定に聞こえる原因）。
		const fifths = pitches.map((semi) => scaleFifth(scale, semi));
		// 小節頭の掛留・倚音。**モチーフの小節には掛けない**——モチーフは同じ形で
		// 返ってくることに意味があるので、頭の音だけが小節ごとに変わると崩れる。
		if (!isMotifBar && !(landing !== null && barInUnit(bar) === 1))
			applyHeadTension(
				pitches,
				fifths,
				slots,
				tones,
				scale,
				style.headTension,
				rnd,
			);
		applyChromatic(scale, pitches, fifths, slots, tones, {
			register: reg,
			tonesLate,
			lateAt,
			affinity: style.chromaticAffinity,
			quarterSteps,
			shortSteps: scaleStep(EIGHTH),
			keepLast: landing !== null && barInUnit(bar) === 1,
			rnd,
		});

		// メロディ
		const barHead = pitches[0];
		// この小節の緊張度。`toneWeight` は「その瞬間の和音におけるこの音の重要度」
		// （3=ルート/5度 … 0=アボイドノート）なので、3から引くと不協和度になる。
		// **初版はこの値を1音ごとに使い捨てていた**——時系列に積むと曲の緊張カーブが
		// 出るのに、それを測っていなかった。{@link tensionFeatures} で使う。
		let tensionSum = 0;
		let tensionSteps = 0;
		for (let i = 0; i < slots.length; i++) {
			const semi = pitches[i];
			tensionSum += ((3 - toneWeight(semi, tones)) / 3) * slots[i].value;
			tensionSteps += slots[i].value;
			// **跳躍・順次の統計は歌う小節だけで測る。** 休符率を `sungBars` で測って
			// いるのと同じ理由で、歌メロの無い小節（イントロ・間奏のソロ）をここへ
			// 混ぜると「間奏で走句を弾く曲＝跳躍の多い歌」に見えてしまい、採点が
			// 旋律の性格ではなく構成の選び方に引きずられる。
			if (!silent && role !== "climax") {
				const gap = Math.abs(semi - prevSemi);
				maxLeap = Math.max(maxLeap, gap);
				intervals++;
				if (gap > STEP_SEMITONES) leaps++;
				else if (gap > 0) steps++;
			}
			const slot = slots[i];
			if (silent) {
				if (isSolo) {
					const ks = barKeyShift[bar];
					const fifthShiftSolo =
						ks === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((ks % 12) + 12) % 12];
					solo.push({
						startStep: barStart + slot.at,
						pitchUnits: spelledToUnits(
							semi + ks,
							fifths[i] + fifthShiftSolo,
							edo,
						),
						durationSteps: slot.value,
						// ソロは前に出る声部なので、歌メロより気持ち強く弾く。
						velocity:
							slot.at === 0
								? 116
								: slot.value <= scaleStep(SIXTEENTH)
									? 96
									: 106,
					});
				}
				prevSemi = semi;
				continue;
			}
			if (!scalePcs(scale).has(pitchClass(semi))) chromaticNotes++;
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			melody.push({
				startStep: barStart + slot.at,
				pitchUnits: spelledToUnits(semi + k, fifths[i] + fifthShift, edo),
				durationSteps: slot.value,
				// 小節頭は少し強く、16分の走句は少し弱く弾く（打ち込みの定石）。
				velocity:
					slot.at === 0 ? 112 : slot.value <= scaleStep(SIXTEENTH) ? 88 : 100,
			});
			melodyDurations.push(slot.value);
			prevSemi = semi;
			lastSungSemi = semi;
		}
		barTension[bar] = tensionSteps === 0 ? 0 : tensionSum / tensionSteps;
		// **休符率はメロディを書く小節だけで測る。** イントロ・間奏はそもそも
		// メロディを置かない小節なので、ここを母数に入れると「イントロが長い曲＝
		// 休符が多い曲」になり、歌っている間の詰まり具合が見えなくなる。
		if (!silent) {
			for (const value of rhythm) if (value < 0) restSteps += -value;
			sungBars++;
		}

		// --- サブメロ（対旋律） ---
		// 単音であることだけは守る——ピアノロールの1トラックは単旋律を前提にしていて、和音にすると
		// 重なり判定やレガート処理が壊れる。
		const melodyRising = prevSemi >= barHead;
		const subDir = melodyRising ? -1 : 1; // 反行（contrary motion）
		// 役割ごとに書法を差し替える。終止は和音を支える、緩む小節は保続音、それ以外は曲ごとに引いた
		// 書法をそのまま使う。メロディが休んでいる区間が8分2つぶん以上あるなら、曲の書法によらず
		// **その小節だけ合いの手にする**——書法を曲単位で固定すると、サブメロがほぼ常にメロディと
		// 重なる。ハモリはメロディと重なるのが正しい書法なので、そこだけは差し替えない。
		const gapSteps = melodyGaps(slots).reduce((sum, [, len]) => sum + len, 0);
		// 終止だけは和音を支えて伸ばす。それ以外は、メロディが休む小節なら合いの手、
		// 鳴っている小節なら曲ごとの書法（ハモリ／対旋律）で**旋律を歌い続ける**。
		// 以前は `hold` の小節を保続音にしていたが、緩む小節ほどサブメロが聞こえる
		// ので、そこで動きを止めると「伴奏の一部」に落ちてしまう。
		const subStyle: SubStyle =
			role === "cadence"
				? "pad"
				: gapSteps >= scaleStep(EIGHTH) * 2 && style.subStyle !== "harmony"
					? "answer"
					: style.subStyle;
		/** サブメロの1音を、和音の色が出る音（3度・7度）へ寄せて置く。 */
		const pushSub = (at: number, len: number, wantedSemi: number): number => {
			if (len <= 0 || at + len > stepsPerBar) return wantedSemi;
			const tone = nearestChordTone(wantedSemi, tones, 2);
			const semi = clampSemi(tone.semi, SUBMELODY_LOW, SUBMELODY_HIGH);
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			submelody.push({
				startStep: barStart + at,
				pitchUnits: spelledToUnits(semi + k, tone.fifth + fifthShift, edo),
				durationSteps: len,
				velocity: at === 0 ? 90 : 84,
			});
			return semi;
		};
		let subSemi = clampSemi(
			barHead - style.subInterval,
			SUBMELODY_LOW,
			SUBMELODY_HIGH,
		);

		if (subStyle === "answer") {
			// 合いの手。メロディが休んでいる区間にだけ入る。
			// **等間隔に刻まない。** 8分を並べるだけだと、サブメロが曲を通して
			// 機械的な刻みになる（実測で、サブメロの音の40%——最大100%——が
			// 「同じ音価が3つ以上続く」形だった）。隙間に入る短い言い回しを引く。
			let placed = 0;
			for (const [at, len] of melodyGaps(slots)) {
				const figure = pickFigure(len, scaleStep);
				if (!figure) continue;
				let cursor = at;
				for (let i = 0; i < figure.length; i++) {
					const raw = figure[i];
					const step = scaleStep(Math.abs(raw));
					if (raw > 0) {
						subSemi = pushSub(
							cursor,
							step,
							i === 0 ? subSemi : walk(scale, subSemi, subDir),
						);
						placed++;
					}
					cursor += step;
				}
			}
			// 隙間が無い小節では合いの手が1音も置けない。空のままだとサブメロが
			// 途切れるので、メロディの下でロングトーンに切り替える。
			if (placed === 0) subSemi = pushSub(0, stepsPerBar, subSemi);
		} else if (subStyle === "harmony") {
			// ハモリ。メロディのリズムをそのままなぞり、3度／6度下を歌う。
			// **メロディと重なるのが正しい**書法なので、コール&レスポンスの指標
			// （complementarity）は下がる。そのための重みづけにしてある。
			for (let i = 0; i < slots.length; i++)
				subSemi = pushSub(
					slots[i].at,
					slots[i].value,
					pitches[i] - style.subInterval,
				);
		} else if (subStyle === "counter") {
			// 対旋律。メロディと反行する独立した旋律線。**小節頭は空ける**——
			// メロディの打ち出しに重ねると対旋律ではなく厚みになる。
			// リズムは曲ごとに引いた型を使う。等間隔の8分を並べると対旋律ではなく
			// ただの刻みになるため。
			let cursor = 0;
			let index = 0;
			for (const raw of counterRhythm) {
				const step = scaleStep(Math.abs(raw));
				if (raw > 0 && cursor > 0) {
					subSemi = pushSub(
						cursor,
						step,
						index === 0
							? subSemi
							: walk(scale, subSemi, subDir * (index % 2 === 0 ? 1 : -1)),
					);
					index++;
				}
				cursor += step;
			}
		} else if (subStyle === "pedal") {
			// 保続音。小節を通して1音を伸ばす。
			pushSub(0, stepsPerBar, subSemi);
		} else if (subStyle === "long-short") {
			subSemi = pushSub(0, scaleStep(DOT_HALF), subSemi);
			pushSub(
				scaleStep(DOT_HALF),
				scaleStep(QUARTER),
				walk(scale, subSemi, subDir),
			);
		} else if (role === "cadence") {
			// 終止だけは和音を支えたいので小節を通して伸ばす。
			pushSub(0, stepsPerBar, subSemi);
		} else {
			// pad。1拍空けてから3拍伸ばす。ここも小節頭を空けて、メロディの
			// 打ち出しとぶつからないようにする。
			pushSub(scaleStep(QUARTER), scaleStep(DOT_HALF), subSemi);
		}

		// --- ハモリ ---
		// 居場所と動き方は曲ごとに引く（{@link harmonyPitch}）。参考曲では主旋律の
		// 66〜100%（平均85%）にしか付かないので、短い音を中心に間引く。
		const barSec = sectionAt(sectionPlan, bar);
		if (!silent && harmonyKinds.includes(barSec.kind)) {
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			/**
			 * 1声ぶんのハモリを書く。`prev` を返して次の小節へ持ち越す。
			 * `against` にもう1声の音を渡すと、そこと協和する音を選ぶ。
			 */
			const writeHarmony = (
				out: ComposedNote[],
				prev: number | null,
				offset: number,
				against: (number | null)[] | null,
			): (number | null)[] => {
				let last = prev;
				const written: (number | null)[] = [];
				for (let i = 0; i < slots.length; i++) {
					const hTone = harmonyPitch(
						scale,
						pitches[i],
						tones,
						last,
						offset,
						harmonyParallel,
						against?.[i] ?? null,
					);
					// 折り返す範囲を主旋律の音域より広く取る。ここを MELODY_HIGH で切ると、
					// 高いところの上ハモがオクターブ下へ畳まれて下ハモに化ける。
					let hClamped = clampSemi(
						hTone.semi,
						MELODY_LOW - 12,
						MELODY_HIGH + 7,
					);
					// 音域の折り返しで主旋律から1オクターブ以上離れたら、戻す。
					// 離れるとハモリではなく別の声部に聞こえる。
					while (hClamped - pitches[i] > 12) hClamped -= 12;
					while (hClamped - pitches[i] < -12) hClamped += 12;
					last = hClamped;
					written.push(hClamped);
					// 間引き。強拍と長い音は残し、短い弱拍から落とす。
					const keep =
						slots[i].isStrong ||
						slots[i].value >= quarterSteps ||
						rnd() < harmonyCoverage;
					if (!keep) continue;
					out.push({
						startStep: barStart + slots[i].at,
						pitchUnits: spelledToUnits(
							hClamped + k,
							hTone.fifth + fifthShift,
							edo,
						),
						durationSteps: slots[i].value,
						velocity: slots[i].at === 0 ? 82 : 76,
					});
				}
				return written;
			};
			const h1 = writeHarmony(harmony, prevHarmony, harmonyOffset, null);
			prevHarmony = h1[h1.length - 1] ?? prevHarmony;
			// 2声目は主旋律の上へ。1声目と協和する音を選ぶ。
			if (useHarmony2) {
				const h2 = writeHarmony(harmony2, prevHarmony2, harmony2Offset, h1);
				prevHarmony2 = h2[h2.length - 1] ?? prevHarmony2;
			}
		}

		// --- コードパッド ---
		// Bメロ以降でコード構成音のロングトーンを鳴らす。
		if (
			barSec.kind === "prechorus" ||
			barSec.kind === "chorus" ||
			barSec.kind === "bridge" ||
			barSec.kind === "drop_chorus"
		) {
			const padTone = nearestChordTone(
				MELODY_HIGH + 2, // メロディの上の音域
				tones,
				2,
			);
			const padSemi = clampSemi(padTone.semi, MELODY_HIGH - 4, MELODY_HIGH + 8);
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			pad.push({
				startStep: barStart,
				pitchUnits: spelledToUnits(
					padSemi + k,
					padTone.fifth + fifthShift,
					edo,
				),
				durationSteps: stepsPerBar, // 小節全体を伸ばす
				velocity: barSec.kind === "drop_chorus" ? 50 : 62,
			});
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
		const nextTones = chordTones(progression[(bar + 1) % totalBars]);
		const A = clampSemi(
			walk(
				scale,
				nextTones[0] ? clampSemi(nextTones[0].semi, BASS_LOW, BASS_HIGH) : R,
				-1,
			),
			BASS_LOW,
			BASS_HIGH,
		);
		// 半音で下がる線の頂点。4つ下がると音域の底を割るルートでは、オクターブ上から下ろす。
		const descTop = R - 4 >= BASS_LOW ? R : R + 12;
		/** 頂点から n 半音下の音の綴り（短2度・長2度・短3度・長3度の下行）。 */
		const descFifth = [0, 5, -2, 3, -4].map((d) => rootTone.fifth + d);
		const BASS_CELLS: Record<BassStyle, [number, number, number?][]> = {
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
			// **ルートを拍アタマに置かない型。** ここが無かったので、どの曲のベースも
			// 小節のアタマで和音のルートを宣言していた。
			"fifth-first": [
				[F, QUARTER],
				[R, QUARTER],
				[R, EIGHTH],
				[F, EIGHTH],
				[R, QUARTER],
			],
			// **小節のアタマを空ける。** 休符（負の音価）で始めて、ルートを8分裏へ置く。
			// 従来のセルは7種すべてが拍アタマのルートで始まっていたので、
			// どの曲のベースも小節ごとに和音のルートを宣言していた。
			offbeat: [
				[R, -EIGHTH],
				[R, DOT_QUARTER],
				[F, EIGHTH],
				[R, DOT_QUARTER],
			],
			driving: [
				[R, SIXTEENTH],
				[R, SIXTEENTH],
				[R, EIGHTH],
				[R, SIXTEENTH],
				[R, SIXTEENTH],
				[R, EIGHTH],
				[F, EIGHTH],
				[R, EIGHTH],
				[R, QUARTER],
			],
			sustain: [[R, WHOLE]],
			// 3度から入る。ルートは裏で補う（転回形の響き）。
			"third-first": [
				[T, DOT_QUARTER],
				[R, EIGHTH],
				[F, QUARTER],
				[R, QUARTER],
			],
			// 息継ぎのある型。2拍目を空ける。
			breath: [
				[R, QUARTER],
				[R, -QUARTER],
				[F, QUARTER],
				[R, QUARTER],
			],
			"chromatic-descent": [
				[descTop, SIXTEENTH, descFifth[0]],
				[descTop, SIXTEENTH, descFifth[0]],
				[descTop - 1, EIGHTH, descFifth[1]],
				[descTop - 2, EIGHTH, descFifth[2]],
				[descTop - 3, EIGHTH, descFifth[3]],
				[descTop - 4, EIGHTH, descFifth[4]],
				[F, EIGHTH],
				[R, EIGHTH],
				[A, EIGHTH],
			],
			"power-riff": [
				[R, EIGHTH],
				[R, SIXTEENTH],
				[R, -SIXTEENTH],
				[F, SIXTEENTH],
				[R, -SIXTEENTH],
				// ♭5。5度から半音下へ掠める、この型の顔。
				[F - 1, SIXTEENTH, (fifthTone?.fifth ?? rootTone.fifth + 1) - 7],
				[R, -SIXTEENTH],
				[R, EIGHTH],
				[R, SIXTEENTH],
				[R, -SIXTEENTH],
				[F, SIXTEENTH],
				[R, -SIXTEENTH],
				[T, EIGHTH],
			],
		};
		// **骨格（{@link BassSkeleton}）で1小節の扱い方を決める。** 奏法だけを引くと、どの曲も
		// 「毎小節アタマにルート＋同じ型の反復」という同一の骨格になる。
		//
		// - `two-bar` … 2小節でひとまとまり。後半の小節は別の奏法で書く。
		// - `pedal`   … 4小節のまとまりの頭の和音のルートに留まる（ペダルポイント）。
		// - `approach`… 小節の最後の音を、次の小節のルートへ入る経過音に差し替える。
		const isLateBar = bar % 2 === 1;
		const activeStyle: BassStyle =
			style.bassSkeleton === "two-bar" && isLateBar
				? style.bassStyleAlt
				: style.bassStyle;
		const baseCell: [number, number, number?][] =
			role === "hold" || role === "cadence"
				? [[R, WHOLE]]
				: role === "run"
					? BASS_CELLS[
							activeStyle === "half" ||
							activeStyle === "quarter" ||
							activeStyle === "sustain"
								? "eighth"
								: activeStyle
						]
					: BASS_CELLS[activeStyle];
		// ペダル。4小節のまとまりの頭の和音のルートへ全部差し替える。
		const pedalSemi =
			style.bassSkeleton === "pedal"
				? clampSemi(
						(chordTones(progression[bar - (bar % 4)])[0] ?? rootTone).semi,
						BASS_LOW,
						BASS_HIGH,
					)
				: null;
		let bassCell: [number, number, number?][] =
			pedalSemi === null
				? baseCell
				: baseCell.map(([semi, value]): [number, number] => [
						// 5度は5度のまま残す（ペダルの上で5度が動くのは普通）。
						semi === F
							? clampSemi(pedalSemi + 7, BASS_LOW, BASS_HIGH)
							: pedalSemi,
						value,
					]);
		// アプローチノート。**次の小節の和音が変わるときだけ**入れる。同じ和音が続く
		// 小節で入れると、行き先の無い経過音になる。
		if (
			style.bassSkeleton === "approach" &&
			bassCell.length >= 2 &&
			role !== "hold" &&
			role !== "cadence" &&
			progression[(bar + 1) % totalBars] !== progression[bar]
		) {
			const last = bassCell.length - 1;
			bassCell = bassCell.map((cell, i): [number, number, number?] =>
				i === last ? [A, cell[1]] : cell,
			);
		}
		// 音の強弱・切り方・ゴーストは、この小節ぶんを組み立ててから後段でまとめて付ける。
		const barBass: ComposedNote[] = [];
		let bassCursor = 0;
		for (const [semi, value, spelled] of bassCell) {
			// **小節からはみ出させない。** セルの合計は1小節ぴったりのはずだが、
			// 型を書き足したときに合計を間違えると、次の小節の音と重なった状態で
			// 出荷される（`check-compose.ts` の「ベースが単音」が落ちる）。
			// 音価を書き間違えても曲が壊れないように、ここで切る。
			const room = stepsPerBar - bassCursor;
			if (room <= 0) break;
			// 負の音価は休符。**ベースにも息継ぎが要る。** 音価が全部正だった頃は、
			// どの型も小節を音で埋め尽くしていた。
			if (value < 0) {
				bassCursor += Math.min(scaleStep(-value), room);
				continue;
			}
			const len = Math.min(scaleStep(value), room);
			let useSemi = semi;
			let fifth =
				spelled !== undefined
					? spelled
					: semi === R || semi === O
						? rootTone.fifth
						: semi === F
							? (fifthTone?.fifth ?? rootTone.fifth)
							: semi === T
								? (thirdTone?.fifth ?? rootTone.fifth)
								: scaleFifth(scale, semi);
			// **半小節で和音が動く曲は、後半の音を後半の和音へ移す。**
			// ベースが前半の和音に留まると、上で鳴っている和音と根音が食い違う。
			// ペダルの曲は動かさない——留まるのがペダルの役目。
			if (
				tonesLate &&
				bassCursor >= lateAt &&
				pedalSemi === null &&
				spelled === undefined
			) {
				const t = nearestChordTone(useSemi, tonesLate, 1);
				useSemi = clampSemi(t.semi, BASS_LOW, BASS_HIGH);
				fifth = t.fifth;
			}
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			barBass.push({
				startStep: barStart + bassCursor,
				pitchUnits: spelledToUnits(useSemi + k, fifth + fifthShift, edo),
				durationSteps: len,
				// 強弱は「キックが居る場所」を基準に付ける。ドラムのパターンは
				// このモジュールの外（DAWのドラム設定）で選ぶので実物は見られないが、
				// 8ビート系のキックはまず1拍目と3拍目に居る。そこへベースのアクセントを
				// 揃えると、低域の芯が同じ場所で立ち上がって曲がまとまって聞こえる。
				velocity:
					bassCursor % (quarterSteps * 2) === 0
						? BASS_ACCENT_VELOCITY
						: bassCursor % quarterSteps === 0
							? BASS_BEAT_VELOCITY
							: BASS_OFFBEAT_VELOCITY,
			});
			bassCursor += len;
		}

		// スタッカート。音価を半分にして、残りを休符（＝弾いたら止める）にする。
		// 音価の半分は必ず表現できる音価（4分→8分、付点4分→付点8分）なので、
		// MMLへ書き出しても汚れない。伸ばすことに意味がある小節（hold/cadence）と、
		// 土台を作る役目の書法（4分打ち・ウォーキング）では掛けない。
		if (
			style.bassStaccato &&
			role !== "hold" &&
			role !== "cadence" &&
			(activeStyle === "eighth" ||
				activeStyle === "octave" ||
				activeStyle === "alternate" ||
				activeStyle === "driving" ||
				activeStyle === "offbeat")
		)
			for (const n of barBass)
				if (n.durationSteps >= 2 && n.durationSteps < quarterSteps * 2)
					n.durationSteps = Math.max(1, Math.round(n.durationSteps / 2));

		// ゴーストノート（デッドノート）。強拍の直前に、弦に触れて音程を殺した打点を1つだけ挟む。
		// velocity を極端に低くすると、再生側のベロシティ→明るさ連動（SoundFont の
		// bassBrightness*）がカットオフを1kHz付近まで落とし、音程感の薄いくぐもった打点になる。
		if (role !== "hold" && role !== "cadence" && rnd() < style.bassGhost) {
			const sixteenth = scaleStep(SIXTEENTH);
			const eighth = scaleStep(EIGHTH);
			// 直前が4分か8分のときだけ挟む。そこから16分を借りた残り（付点8分・16分）は
			// どちらも表現できる音価なので、MMLへ書き出しても端数が出ない。
			const idx = barBass.findIndex(
				(n, i) =>
					i > 0 &&
					(barBass[i - 1].durationSteps === quarterSteps ||
						barBass[i - 1].durationSteps === eighth) &&
					n.startStep % quarterSteps === 0,
			);
			if (idx > 0 && sixteenth >= 1) {
				const prev = barBass[idx - 1];
				prev.durationSteps -= sixteenth;
				barBass.splice(idx, 0, {
					startStep: barBass[idx].startStep - sixteenth,
					// 直後に鳴らす音と同じ音（同じ弦を触って鳴らすため）。
					pitchUnits: barBass[idx].pitchUnits,
					durationSteps: sixteenth,
					velocity: BASS_GHOST_VELOCITY,
				});
			}
		}

		for (const n of barBass) bass.push(n);
	}

	// --- 小節をまたぐメロディライン（シンコペーションタイ） ---
	// J-POPの王道である「4拍目裏からの食い（アンティシペーション）」。前の小節の末尾が短い音で
	// 小節境界に接し、次の小節の頭（強拍）に音があるとき、確率でタイで小節線をまたがせる。
	const eighthSteps = scaleStep(EIGHTH);
	/** 食うかどうかの判定。同じリズム型・同じ楽句内位置なら使い回す（下の説明）。 */
	const tieMemo = new Map<string, boolean>();
	for (let i = 0; i < melody.length - 1; i++) {
		const cur = melody[i];
		const nxt = melody[i + 1];
		const curEnd = cur.startStep + cur.durationSteps;
		const atBarBoundary =
			curEnd % stepsPerBar === 0 && nxt.startStep === curEnd;
		if (!atBarBoundary) continue;

		// 8分以下の短い音で小節境界に突入しているか（食い）
		if (cur.durationSteps > eighthSteps) continue;

		const barIdx = Math.floor(curEnd / stepsPerBar);
		if (barIdx >= totalBars) continue;

		// 終止音（曲末尾の最後の音、またはセクション終了の終止音）はタイで吸収しない
		if (i + 1 >= melody.length - 1) continue;
		const curSec = sectionAt(sectionPlan, barIdx - 1);
		const nextSec = sectionAt(sectionPlan, barIdx);
		if (!nextSec.spec.melody || curSec !== nextSec) continue;

		// **息継ぎの小節へは食い込ませない。** 2〜3音しか無い小節から1音が消えると、
		// メロディが1音も無い小節が生まれる（セクション内なので上のガードは効かない）。
		if (breathBars.has(barIdx)) continue;

		// **フックの小節は食いで崩さない。** 頭の音を吸収されると同じ型に聞こえないし、
		// 食うかどうかは前の小節の末尾（サビの入り口か、サビの途中か）で条件が変わるので、
		// 1回目と2回目で判定が食い違って「返ってきた」が成立しなくなる。
		if (hookBars.has(barIdx) || hookBars.has(barIdx - 1)) continue;

		// 界隈曲らしさ：変化音（クロマチックテンション）であっても小節を跨ぐタイを許容し、強烈な食いを演出する。
		const curSemi = Math.round(cur.pitchUnits / UNITS_PER_SEMITONE);
		const nxtSemi = Math.round(nxt.pitchUnits / UNITS_PER_SEMITONE);

		// 大きな跳躍がある場合はタイにしない（同音または順次・3度以内のスムーズな食い）
		if (Math.abs(nxtSemi - curSemi) > 3) continue;

		// **順次で入る変化音の足場を奪わない。** 変化音は順次で入って順次で出るから
		// 通り過ぎる音になる（{@link applyChromatic} の②）。足場をタイで吸収すると
		// 跳躍で掴まれた形になり、「調を外した音」として耳に残る。
		const after = melody[i + 2];
		if (after && Math.floor(after.startStep / stepsPerBar) === barIdx) {
			const afterSemi =
				Math.round(after.pitchUnits / UNITS_PER_SEMITONE) -
				(barKeyShift[barIdx] ?? 0);
			if (!scalePcs(scale).has(pitchClass(afterSemi))) continue;
		}

		// 文脈（BarRole）に合わせたタイ（食い）の発生確率の制御
		// motif (1回目) は原形を提示するためほぼ食わない
		// sequence (2回目) は展開感を出すため積極的に食う
		// climax は感情の爆発なので非常に高い確率で食う
		const nextRole = barRoles[barIdx];
		// 提示（motif）と再来（sequence）で確率が違いすぎると、同じ型を置いた小節が
		// 食いの有無で食い違い、4小節周期の完全一致が落ちる。差は残しつつ縮める。
		let tieProb = 0.3;
		if (nextRole === "motif") tieProb = 0.1;
		else if (nextRole === "sequence") tieProb = 0.35;
		else if (nextRole === "climax") tieProb = 0.45;
		else if (nextRole === "cadence") tieProb = 0.1;

		// **同じ型を置いた小節には同じ食いを入れる。** 1小節ずつ独立に抽選すると、
		// 同じリズム型を置いた2小節が片方だけ食って別の形になる。食いの量を減らさずに
		// 完全一致率だけを上げられる数少ない場所。
		const tieKey = `${barRhythms[barIdx].join(",")}|${barInUnit(barIdx)}`;
		let tie = tieMemo.get(tieKey);
		if (tie === undefined) {
			tie = rnd() < tieProb;
			tieMemo.set(tieKey, tie);
		}

		if (tie) {
			// タイ結合：curをnxtの分まで伸ばし、nxtを吸収
			cur.durationSteps += nxt.durationSteps;
			melody.splice(i + 1, 1);
			// melodyDurations も同期
			if (i < melodyDurations.length - 1) {
				melodyDurations[i] += melodyDurations[i + 1];
				melodyDurations.splice(i + 1, 1);
			}
			// **ハモリも一緒に食わせる。** 主旋律だけタイで伸ばすと、小節頭でハモリだけが新しい音を出し、
			// 既に鳴っていない音に対してハモる形になる。直前の音へ繋げられないときは落とす——ハモリは
			// もともと主旋律の一部にしか付けない声部なので、1音減っても穴にはならない。2声目
			// （{@link ComposeResult.harmony2}）も同じ扱いにする。
			for (const voice of [harmony, harmony2]) {
				const nxtIdx = voice.findIndex((h) => h.startStep === nxt.startStep);
				if (nxtIdx < 0) continue;
				const curIdx = voice.findIndex((h) => h.startStep === cur.startStep);
				if (curIdx >= 0)
					voice[curIdx].durationSteps += voice[nxtIdx].durationSteps;
				voice.splice(nxtIdx, 1);
			}
			i--;
		}
	}

	// --- リズムの有機的な揺らぎ（Permutation） ---
	// 全く同じリズムセルのコピペ感を消すため、確率で音符を分割し、ボーカル特有の「細かい言葉の詰め込み」を表現する。
	/**
	 * 割るかどうかの判定。**同じ型を置いた小節は同じ割り方をする。**
	 * 1音ずつ独立に抽選すると、同じ型の2小節が片方だけ割れて反復の完全一致が壊れる。
	 */
	const splitMemo = new Map<string, boolean>();
	let splitLastBar = -1;
	let splitIdxInBar = 0;
	for (let i = 0; i < melody.length; i++) {
		const barIdx = Math.floor(melody[i].startStep / stepsPerBar);
		if (barIdx !== splitLastBar) {
			splitLastBar = barIdx;
			splitIdxInBar = 0;
		} else splitIdxInBar++;
		if (barIdx >= totalBars) continue;
		// セクションの最終小節は息継ぎ（ロングトーン＋休符）を作り込んであるので割らない。
		if (phraseEndBars.has(barIdx)) continue;
		// フックも割らない。揺らぎは「同じ型を毎回同じに置かない」ための仕掛けだが、
		// フックは毎回同じに置くことが役目。
		if (hookBars.has(barIdx)) continue;
		const role = barRoles[barIdx];

		// 文脈（BarRole）に合わせたリズム分割の制御
		// motif, sequence は言葉を割らずに原形を保つ
		// climax は感情の爆発を表現するため高確率で割る
		// 分割は反復の完全一致を壊すので、「揺らぎ」は控えめにする。
		let splitProb = 0.08;
		if (role === "motif" || role === "sequence") splitProb = 0.0;
		else if (role === "climax") splitProb = 0.3;
		else if (role === "cadence") splitProb = 0.0;

		let doSplit = false;
		if (melody[i].durationSteps === quarterSteps) {
			const key = `${barRhythms[barIdx].join(",")}|${barInUnit(barIdx)}|${role}|${splitIdxInBar}`;
			const memo = splitMemo.get(key);
			if (memo === undefined) {
				doSplit = rnd() < splitProb;
				splitMemo.set(key, doSplit);
			} else doSplit = memo;
		}
		if (doSplit) {
			// 4分音符を8分音符2つに分割（同音連打）
			const half = scaleStep(EIGHTH);
			const newNote = {
				...melody[i],
				startStep: melody[i].startStep + half,
				durationSteps: half,
			};
			melody[i].durationSteps = half;
			melody.splice(i + 1, 0, newNote);

			// melodyDurations も同期
			if (i < melodyDurations.length) {
				melodyDurations[i] = half;
				melodyDurations.splice(i + 1, 0, half);
			}
			i++;
			splitIdxInBar++;
		}
	}

	/** ノート列が使った音域（半音）。 */
	const range = (notes: ComposedNote[]): number => {
		if (notes.length === 0) return 0;
		const us = notes.map((n) => n.pitchUnits);
		return (Math.max(...us) - Math.min(...us)) / UNITS_PER_SEMITONE;
	};

	// --- 楽器リフの主旋律（{@link StructureTemplate.lead}） ---
	// 歌メロを捨てて、2小節周期の16分リフで置き換える。**リフは和音に付いて動かない。**
	// 手本2曲とも上声の型は固定で、下でベースが動く（Pepper Steak は A#→C#→G#、
	// Ghost Fight は半音下降）。和音ごとに移すと分散和音になり、リフに聞こえない。
	// サブメロは中核音で1つ下を重ねた2音（Ghost Fight の平行3度）。ハモリ・パッドは外す。
	if (template?.lead === "riff") {
		melody.length = 0;
		submelody.length = 0;
		harmony.length = 0;
		harmony2.length = 0;
		pad.length = 0;
		const first = makeRiffHalf(rnd, 1, 3);
		const cellA = [...first, ...makeRiffHalf(rnd, -1, 1)];
		const cellB = [...first, ...makeRiffHalf(rnd, -1, 1)];
		// 対比のセクション（Aメロ）は8分へ間引く。ずっと同じ密度だとループの一周が区切れない。
		const thin = (cell: RiffNote[]): RiffNote[] => {
			const out: RiffNote[] = [];
			let acc = 0;
			for (const n of cell) {
				if (acc % 2 === 0) out.push({ ...n, chrom: false });
				else if (out.length > 0) out[out.length - 1].len += n.len;
				acc += n.len;
			}
			return out;
		};
		const sixteenth = scaleStep(SIXTEENTH);
		const tonicStep = degreeToCore(scale, scale.tonic);
		/** 移調後に主音が C4〜B4 へ来る高さ（移調はこの後で掛かる）。 */
		const tonicSemi = degreeToPitch(scale, scale.tonic).semi;
		const octave = Math.ceil((60 - rootShift - tonicSemi) / 12) * 12;
		const pitchOf = (step: number): ScaleDegree => {
			const d = degreeToPitch(scale, coreToDegree(scale, tonicStep + step));
			return { semi: d.semi + octave, fifth: d.fifth };
		};
		for (let bar = 0; bar < totalBars; bar++) {
			const sec = sectionAt(sectionPlan, bar);
			if (!sec?.spec.melody) continue;
			const barStart = bar * stepsPerBar;
			const inSec = bar - sec.startBar;
			let cell = inSec % 2 === 0 ? cellA : cellB;
			if (sec.kind === "verse") cell = thin(cell);
			// Cメロは型ごと1歩上げて、同じリフの別の顔にする。
			const lift = sec.kind === "bridge" ? 1 : 0;
			if (bar === totalBars - 1)
				cell = [
					{ step: 0, chrom: false, len: 8 },
					{ step: 0, chrom: false, len: -8 },
				];
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			let at = 0;
			for (const n of cell) {
				if (n.len < 0) {
					at -= n.len;
					continue;
				}
				const base = pitchOf(n.step + lift);
				const semi = base.semi - (n.chrom ? 1 : 0);
				const fifth = base.fifth + (n.chrom ? 5 : 0);
				const start = barStart + at * sixteenth;
				const dur = n.len * sixteenth;
				const accent = at % 4 === 0;
				melody.push({
					startStep: start,
					pitchUnits: spelledToUnits(semi + k, fifth + fifthShift, edo),
					durationSteps: dur,
					velocity: accent ? 100 : 82,
				});
				if (!n.chrom) {
					const under = pitchOf(n.step + lift - 1);
					submelody.push({
						startStep: start,
						pitchUnits: spelledToUnits(
							under.semi + k,
							under.fifth + fifthShift,
							edo,
						),
						durationSteps: dur,
						velocity: accent ? 88 : 72,
					});
				}
				at += n.len;
			}
		}
	}

	// 曲全体を同じ量だけずらす。units は絶対音高なので、綴りの関係は保たれたまま動く。
	const shiftUnits = semitonesToUnits(rootShift, edo);
	if (shiftUnits !== 0)
		for (const list of [melody, submelody, bass, harmony, harmony2, pad, solo])
			for (const n of list) n.pitchUnits = (n.pitchUnits + shiftUnits) as Units;

	// **ベースの平均音高を C3(48) より下に保つ。** `daw.ts` の `classifyTrackRole` はこの
	// しきい値でベースを判定するので、外すとおまかせマスタリングで楽器が当たらない。生成空間では
	// {@link BASS_HIGH} で抑えてあるが**移調はその後に掛かる**ので、高い調を引いた曲だけが越え
	// うる。オクターブ下げるのは線そのものを動かさない唯一の直し方。綴りは変わらない。
	if (bass.length > 0) {
		const octaveUnits = semitonesToUnits(12, edo);
		const meanSemi = (): number =>
			bass.reduce((a, n) => a + n.pitchUnits, 0) /
			bass.length /
			UNITS_PER_SEMITONE;
		while (meanSemi() >= 48)
			for (const n of bass)
				n.pitchUnits = (n.pitchUnits - octaveUnits) as Units;
	}

	// **オクターブ重ねは主旋律の全部にはかけない。** 参考曲の重ねの層は主旋律の
	// 29〜59%にしか乗っておらず、要所だけ厚くする使い方だった。長い音を残して
	// 短い音から落とす。移調が済んだ後の音をそのまま写す（トラック側のオクターブ
	// 設定で下げるので、ここでは音高を触らない）。
	const octave: ComposedNote[] = useOctaveLayer
		? melody
				.filter(
					(n) => n.durationSteps >= quarterSteps || rnd() < octaveCoverage,
				)
				.map((n) => ({ ...n, velocity: Math.max(40, n.velocity - 26) }))
		: [];

	return {
		form,
		chordProgression,
		chordPattern,
		rootShift,
		keyName: resolvedKey.keyName,
		keyLabel: resolvedKey.keyLabel,
		scaleId: scale.id,
		scaleLabel: scale.label,
		moodLabel: resolvedKey.moodLabel,
		bpm,
		sections: sectionPlan,
		bars: totalBars,
		vocal: {
			duetSpans,
			duetStyle,
			harmonyKinds,
			harmony2: useHarmony2,
			octaveLayer: useOctaveLayer,
		},
		tonal: { relativeKinds: [...relativeKinds], relativeShift, floating },
		melody,
		submelody,
		bass,
		harmony,
		harmony2,
		octave,
		pad,
		solo,
		melodyDurations,
		restSteps,
		totalSteps: Math.max(1, sungBars) * stepsPerBar,
		maxLeap,
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		stepRatio: intervals === 0 ? 0 : steps / intervals,
		chromaticRatio: melody.length === 0 ? 0 : chromaticNotes / melody.length,
		melodyRange: range(melody),
		submelodyRange: range(submelody),
		barTension,
		stepsPerBar,
	};
};

// ============================================================
// 採点
// ============================================================

/** ノート列を指標モジュールが読める形（半音・ステップ）へ落とす。 */
const toMetricNotes = (notes: ComposedNote[]): MetricNote[] =>
	notes
		.map((n) => ({
			startStep: n.startStep,
			pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
			durationSteps: n.durationSteps,
		}))
		.sort((a, b) => a.startStep - b.startStep);

/** 候補1本を採点する。ハード制約に触れたものは `null`。 */
const evaluate = (
	d: Draw,
	recent: number[][],
): { stats: Omit<ComposeStats, "attempts" | "rejected">; ok: boolean } => {
	const entropy = durationEntropy(d.melodyDurations);
	const valueKinds = new Set(d.melodyDurations).size;
	const restRatio = d.restSteps / d.totalSteps;
	// **メロディが歌い始めるところから測る。** イントロはメロディを書かないので、
	// 曲頭から測ると休符率も密度もクライマックスの位置も「イントロの長さ」に
	// 引きずられる。較正側（`scripts/calibrate-corpus.ts`）も主旋律の入りから
	// 測っているので、ここを揃えないと目標帯と別のものを比べることになる。
	const melodyNotes = toMetricNotes(d.melody);
	const offset =
		melodyNotes.length === 0
			? 0
			: Math.floor(melodyNotes[0].startStep / d.stepsPerBar) * d.stepsPerBar;
	const fromMelody = (ns: MetricNote[]): MetricNote[] =>
		offset === 0
			? ns
			: ns.map((n) => ({ ...n, startStep: n.startStep - offset }));
	const opts = {
		stepsPerBar: d.stepsPerBar,
		bars: Math.max(1, d.bars - offset / d.stepsPerBar),
	};
	const melodyFrom = fromMelody(melodyNotes);
	const structure = structureFeatures(
		melodyFrom,
		fromMelody(toMetricNotes(d.submelody)),
		opts,
	);
	const verseBars: number[] = [];
	const chorusBars: number[] = [];
	for (const s of d.sections) {
		for (let b = s.startBar; b < s.startBar + s.bars; b++) {
			if (s.kind === "verse") verseBars.push(b);
			else if (s.kind === "chorus" || s.kind === "drop_chorus")
				chorusBars.push(b);
		}
	}
	const tension = tensionFeatures(d.barTension, { verseBars, chorusBars });
	const density = densityFeatures(melodyFrom, opts);
	const fingerprint = featureVector({
		entropy,
		restRatio,
		leapRatio: d.leapRatio,
		melodyRange: d.melodyRange,
		density,
		structure,
	});

	// 直近の曲からどれだけ離れているか。1.0 離れていれば満点。
	const novelty =
		recent.length === 0
			? 1
			: Math.min(
					1,
					Math.min(...recent.map((r) => featureDistance(fingerprint, r))) / 1.0,
				);

	const at = (b: Band, v: number): number => band(v, b[0], b[1], b[2], b[3]);
	/**
	 * コーパスから採った項目は「人間の範囲に居るか」だけを見る（{@link plausibleBand}）。中央値
	 * へ寄せると人間の曲そのものが落ちる（{@link DEVIATION_BUDGET}）。「全項目が帯の端に同時に
	 * 寄った曲」もここでは弾かない——弾こうとすると必ず「コーパスの真ん中に寄れ」になる。
	 * 壊れているものは {@link HARD} が落とす。
	 */
	const atc = (key: keyof typeof CORPUS_BANDS, v: number): number =>
		plausibleBand(v, CORPUS_BANDS[key]);

	const peakBand: Band =
		d.bars > 24
			? [0, 1, Math.round(d.bars / 16), Math.round(d.bars / 8) + 2]
			: HAND_BANDS.climaxPeaks;
	const scoreBreakdown: Record<string, number> = {
		entropy: atc("entropy", entropy),
		valueKinds: atc("valueKinds", valueKinds),
		restRatio: atc("restRatio", restRatio),
		leapRatio: atc("leapRatio", d.leapRatio),
		maxLeap: atc("maxLeap", d.maxLeap),
		melodyRange: atc("melodyRange", d.melodyRange),
		notesPerBar: atc("notesPerBar", density.notesPerBar),
		shortNoteRatio: atc("shortNoteRatio", density.shortNoteRatio),
		barDensityCv: atc("barDensityCv", density.barDensityCv),
		densityCliff: atc("densityCliff", density.densityCliff),
		stepRatio: atc("stepRatio", d.stepRatio),
		chromaticRatio: atc("chromaticRatio", d.chromaticRatio),
		sim1: atc("sim1", structure.sim1),
		sim2: atc("sim2", structure.sim2),
		sim4: atc("sim4", structure.sim4),
		sim8: atc("sim8", structure.sim8),
		phraseBreath: atc("phraseBreath", structure.phraseBreath),
		turnRatio: atc("turnRatio", structure.turnRatio),
		climaxPosition: atc("climaxPosition", structure.climaxPosition),
		climaxPeaks: at(peakBand, structure.climaxPeaks),
		complementarity: at(HAND_BANDS.complementarity, structure.complementarity),
		subDensity: at(HAND_BANDS.subDensity, d.submelody.length / d.bars),
		// サブメロにも同じ崖の物差しを当てる。帯はメロディから採ったものを流用する。
		subDensityCliff: atc(
			"densityCliff",
			densityFeatures(fromMelody(toMetricNotes(d.submelody)), opts)
				.densityCliff,
		),
		tensionRise: tension.rise,
		// **浮遊感の曲に「終止で解決しろ」は要求しない。** 解決しないことが狙いなので、
		// この項目で減点すると候補40本の選抜で必ず負けて、狙って引いた曲が出てこない。
		tensionResolve: d.tonal.floating ? 1 : tension.resolve,
		novelty,
	};

	// --- 逸脱の予算：周辺分布の項目のうち、最も損している数本を採点から外す ---
	//
	// 「損している」は重み込みの不足分 `weight * (1 - score)` で見る。重み1.4の項目で
	// 0.5落とすことと、重み0.4の項目で丸ごと0点になることを同じ土俵に載せるため。
	const forgiven = new Set<string>(
		Object.entries(WEIGHTS)
			.filter(([key]) => BUDGETED_KEYS.has(key))
			.map(([key, weight]) => ({
				key,
				deficit: weight * (1 - (scoreBreakdown[key] ?? 0)),
			}))
			.sort((a, b) => b.deficit - a.deficit)
			.slice(0, DEVIATION_BUDGET)
			.filter((e) => e.deficit > 0)
			.map((e) => e.key),
	);

	let weighted = 0;
	let weightSum = 0;
	for (const [key, weight] of Object.entries(WEIGHTS)) {
		if (forgiven.has(key)) continue;
		weighted += (scoreBreakdown[key] ?? 0) * weight;
		weightSum += weight;
	}
	const score = weightSum === 0 ? 0 : weighted / weightSum;

	const ok =
		d.melody.length > 0 &&
		d.melodyRange >= HARD.minMelodyRange &&
		d.submelodyRange >= HARD.minSubmelodyRange &&
		d.maxLeap <= HARD.maxLeapSemitones &&
		restRatio <= HARD.maxRestRatio;

	return {
		stats: {
			valueKinds,
			entropy,
			restRatio,
			maxLeapSemitones: d.maxLeap,
			leapRatio: d.leapRatio,
			stepRatio: d.stepRatio,
			chromaticRatio: d.chromaticRatio,
			density,
			melodyRange: d.melodyRange,
			submelodyRange: d.submelodyRange,
			structure,
			tension,
			score,
			scoreBreakdown,
			fingerprint,
		},
		ok,
	};
};

/**
 * 16小節の曲を組み立てる。{@link DRAW_COUNT} 本の候補を引き、ハード制約（{@link HARD}）に
 * 触れたものだけを捨てて残りから選ぶ。全滅した場合も点数最大のものを返すので、「ボタンを
 * 押して何も起きない」状態にはならない。
 */
export const composeSong = (options: ComposeOptions): ComposeResult => {
	const rnd = options.random ?? Math.random;
	const recent = options.recent ?? [];
	const count = Math.max(1, options.drawCount ?? DRAW_COUNT);
	const resolvedKey = resolveComposeKey(options.baseKey, rnd);
	const templateScales = STRUCTURE_TEMPLATES.find(
		(tm) => tm.name === options.template,
	)?.scales;
	const scaleChoice = options.scale?.trim() || "auto";
	const scale = resolveComposeScale(
		scaleChoice === "auto" && templateScales
			? pick(templateScales, rnd)
			: options.scale,
		resolvedKey.mode === "minor",
		rnd,
	);

	type Candidate = { d: Draw; stats: ReturnType<typeof evaluate>["stats"] };
	const valid: Candidate[] = [];
	const invalid: Candidate[] = [];
	let rejected = 0;

	for (let attempt = 1; attempt <= count; attempt++) {
		const d = draw(options, resolvedKey, scale, rnd);
		const { stats, ok } = evaluate(d, recent);
		if (ok) valid.push({ d, stats });
		else {
			rejected++;
			invalid.push({ d, stats });
		}
	}

	// ハード制約を通った候補は、通らなかった候補より必ず優先する。
	const pool = valid.length > 0 ? valid : invalid;

	// **最高点を必ず選ぶのをやめる。** 採点式は「壊れた曲」と「そうでない曲」を分ける分解能は
	// あっても、0.85 と 0.87 のどちらが良い曲かを言えるほどの分解能は無い。必ず最大値を取ると、
	// 引く本数を増やすほど**採点式の頂点1点へ収束する**（{@link DRAW_COUNT}）。
	const top = Math.max(...pool.map((c) => c.stats.score));
	const weights = pool.map((c) =>
		Math.exp((c.stats.score - top) / SELECT_TEMPERATURE),
	);
	const total = weights.reduce((a, b) => a + b, 0);
	let ticket = rnd() * total;
	let chosen = pool[pool.length - 1];
	for (let i = 0; i < pool.length; i++) {
		ticket -= weights[i];
		if (ticket <= 0) {
			chosen = pool[i];
			break;
		}
	}

	const d = chosen.d;
	const result: ComposeResult = {
		// ドラム・楽器・編曲プランは勝った候補にだけ後から付ける（メロディに
		// 依存しないので候補ごとに引いても採点は動かず、候補数ぶん無駄になる）。
		drum: "",
		instrument: "",
		arrange: EMPTY_ARRANGE,
		chordProgression: d.chordProgression,
		chordPattern: d.chordPattern,
		rootShift: d.rootShift,
		keyName: d.keyName,
		keyLabel: d.keyLabel,
		scaleId: scale.id,
		scaleLabel: scale.label,
		form: d.form,
		moodLabel: d.moodLabel,
		bpm: d.bpm,
		sections: d.sections,
		bars: d.bars,
		vocal: d.vocal,
		tonal: d.tonal,
		melody: d.melody,
		submelody: d.submelody,
		bass: d.bass,
		harmony: d.harmony,
		harmony2: d.harmony2,
		octave: d.octave,
		pad: d.pad,
		solo: d.solo,
		stats: { ...chosen.stats, attempts: count, rejected },
	};
	result.stats.attempts = count;
	result.stats.rejected = rejected;
	result.drum = pickBuiltinDrum(result, rnd);
	result.instrument = pickBuiltinInstrument(result, rnd);
	result.arrange = buildArrangePlan(result, rnd);
	return result;
};

/**
 * 曲に合わせて組み込みドラムパターン（DRUM_PATTERNS のキー）を選ぶ。引き当てた曲と噛み合って
 * いないと目も当てられない（速い曲にスロードラム、など）ので、テンポと刻みの細かさから
 * 絞ってから引く。
 *
 * **組み立てるのではなく選ぶ、というのがここの仕様。** 小節ごとに組み立てれば「サビでドラム
 * が開く」は作れるが、MMLの記述量が膨らんで他のトラックを圧迫するわりに、音楽的な比重が
 * そこまで高くない。過去2回、セクション対応のドラム生成器を書いて配線しては取り消している
 * （2026-09-06 `1a00fcd6`、2026-09-17 `cbd5586d`）。**同じ提案をする前にここを読むこと。**
 */
const pickBuiltinDrum = (song: ComposeResult, rnd: () => number): string => {
	const eighth = BASE_STEPS_PER_BAR / 8;
	const short =
		song.melody.filter((n) => n.durationSteps <= eighth).length /
		Math.max(1, song.melody.length);

	// 付点8分の比率。タッカ（付点8分＋16分）や3+3+2 が多い曲は跳ねているので、
	// シャッフルのドラムが合う。
	const dotted =
		song.melody.filter(
			(n) => n.durationSteps === Math.round((BASE_STEPS_PER_BAR * 3) / 16),
		).length / Math.max(1, song.melody.length);

	// **7種すべてに出番を作る。** 初版は分岐の条件が実際の生成物と噛み合っておらず、
	// 300曲引いても dance / 16beat / disco / 4beat の4種しか出なかった。
	// `short >= 0.6` はメロディの短音比率が中央値0.84なのでほぼ常に真になり、
	// `8beat` と `bossa` の枝へ到達しない。`shuffle` はどのプールにも無かった。
	const pool: string[] =
		dotted >= 0.08
			? ["shuffle", "8beat", "16beat"]
			: song.bpm >= 150
				? ["4beat", "dance", "16beat", "disco"]
				: short >= 0.85
					? ["16beat", "dance", "disco"]
					: song.bpm <= 115
						? ["bossa", "8beat", "shuffle", "4beat"]
						: ["8beat", "4beat", "16beat", "dance"];
	return pick(pool, rnd);
};

/** 勝った候補へ差し替えるまでの仮の編曲プラン。 */
const EMPTY_ARRANGE: ArrangePlan = {
	backing: [],
	sparkle: null,
	padSections: [],
	lead: null,
	bassLayer: null,
};

/** 盛り上がる側のセクション。層を「足す」場所の候補。 */
const LOUD_KINDS: SectionKind[] = ["prechorus", "chorus", "bridge"];
/** 落ち着いている側のセクション。地の伴奏だけで十分な場所。 */
const QUIET_KINDS: SectionKind[] = [
	"intro",
	"verse",
	"interlude",
	"drop_chorus",
	"outro",
];
/** サビ。音色を変えて「ここが聞かせどころ」を作る場所。 */
const CHORUS_KINDS: SectionKind[] = ["chorus", "drop_chorus"];

/**
 * 上級者モードの編曲プランを1つ引く（{@link ArrangePlan}）。曲に実在するセクションだけを
 * 割り当てる——無いセクションに割り当てるとその層は無音になる。空になったら曲全体へ倒す。
 */
const buildArrangePlan = (
	song: ComposeResult,
	rnd: () => number,
): ArrangePlan => {
	const present = new Set(song.sections.map((s) => s.kind));
	/** 曲に実在するものだけへ絞る。1つも残らなければ null（＝全編）。 */
	const narrow = (kinds: SectionKind[]): SectionKind[] | null => {
		const hit = kinds.filter((k) => present.has(k));
		return hit.length === 0 ? null : hit;
	};

	// --- 伴奏 ---
	// 地は曲の奏法（simpleモードの伴奏トラックと同じもの）。ここを引き直すと
	// 「同じ曲なのにモードで伴奏が違う」ことになる。
	const base: ArrangeLayer = {
		pattern: song.chordPattern,
		sections: null,
		octave: 0,
	};
	/** 地と重ならない奏法。**同じ奏法を2本重ねても音が濃くなるだけ。** */
	const others = chordPatternPool(song.bpm).filter((p) => p !== base.pattern);
	const backing: ArrangeLayer[] = [base];

	// 2本目。足す場所を引く。全編に足すと、セクションで手触りが変わらない元の形に戻る。
	const addKinds = pick(
		[LOUD_KINDS, CHORUS_KINDS, LOUD_KINDS, QUIET_KINDS],
		rnd,
	);
	const second = pick(others, rnd);
	backing.push({
		pattern: second,
		sections: narrow(addKinds),
		octave: 0,
	});

	// 3本目は必ずしも要らない。3本ぶんの和音が常に鳴っていると、どの奏法も聞こえない。
	if (rnd() < 0.55) {
		const rest = others.filter((p) => p !== second);
		backing.push({
			pattern: pick(rest.length > 0 ? rest : others, rnd),
			// 2本目と逆側へ置く（両方サビに寄せると、サビだけ団子になる）。
			sections: narrow(addKinds === QUIET_KINDS ? LOUD_KINDS : QUIET_KINDS),
			octave: 0,
		});
	}

	// --- 装飾（ウワモノ）---
	// **地と同じ奏法をオクターブ上げただけの層にはしない。** それは写しであって装飾ではない。
	// ブロックも外す——和音を丸ごとオクターブ上で鳴らすのは装飾ではなく壁になる。
	const sparklePool = chordPatternPool(song.bpm).filter(
		(p) => p !== "block" && !backing.some((b) => b.pattern === p),
	);
	const sparkle: ArrangeLayer | null =
		sparklePool.length > 0 && rnd() < 0.7
			? {
					pattern: pick(sparklePool, rnd),
					sections:
						narrow(pick([LOUD_KINDS, CHORUS_KINDS], rnd)) ?? CHORUS_KINDS,
					octave: 1,
				}
			: null;

	// --- コードパッド ---
	// 生成側が音を置いているのは Bメロ以降だけ（{@link ComposeResult.pad}）なので、
	// ここで広げることはできない。狭める方向にだけ引く。
	const padSections =
		narrow(
			pick(
				[
					["prechorus", "chorus", "bridge", "drop_chorus"],
					["chorus", "drop_chorus"],
					["prechorus", "chorus", "bridge", "drop_chorus"],
					["bridge", "chorus"],
				] as SectionKind[][],
				rnd,
			),
		) ?? [];

	// --- 主旋律に重ねる別音色 ---
	// オクターブ上（従来の重ね）とユニゾン（音色だけ変える）の両方を引く。
	const lead =
		rnd() < 0.75
			? {
					sections:
						narrow(pick([CHORUS_KINDS, LOUD_KINDS], rnd)) ?? CHORUS_KINDS,
					octave: rnd() < 0.5 ? 0 : 1,
				}
			: null;

	// --- ベースの重ね ---
	// **既定は出さない。** 出すときもオクターブ上（可聴域で輪郭が立つ側）へ、
	// 盛り上がる場所だけに置く。
	const bassLayer =
		rnd() < 0.25
			? { sections: narrow(CHORUS_KINDS) ?? CHORUS_KINDS, octave: 1 }
			: null;

	return { backing, sparkle, padSections, lead, bassLayer };
};

/**
 * 曲に合わせて組み込み楽器プリセット（INSTRUMENT_PRESETS のキー）を選ぶ。ドラムやテンポ、
 * メロディの刻みや跳躍率、雰囲気から曲に合う音色セットを引く。
 */
export const pickBuiltinInstrument = (
	song: ComposeResult,
	rnd: () => number,
): string => {
	// 稀に和風やエキゾチックなどのアクセント枠を出す（約6%）
	if (rnd() < 0.06) {
		return pick(["japanese_wa", "arabic_exotic"], rnd);
	}

	let pool: string[];
	if (song.drum === "dance" || song.drum === "disco") {
		// ダンス・ディスコ系: シンセ・サイバー・レトロ系
		pool =
			song.bpm >= 150
				? ["cyber_punk", "synth_pop", "retro_game"]
				: ["synth_pop", "retro_game", "rock", "piano"];
	} else if (song.drum === "bossa") {
		// ボサノバ: ジャズ、アコースティック、ピアノ
		pool = ["jazz_night", "acoustic", "piano"];
	} else if (song.bpm <= 115) {
		// ゆったりした曲: アンビエント、アコースティック、オーケストラ、ピアノ。
		// `short < 0.4` を併せて要求していた頃は、メロディの短音比率が中央値0.84
		// なのでこの枝へ入れず、`ambient_cloud` が600曲引いても一度も出なかった。
		pool = ["ambient_cloud", "acoustic", "orchestra", "piano", "fantasy_rpg"];
	} else if (song.bpm >= 145) {
		// ハイスピード: ロック、シンセポップ、サイバーパンク、8-bit
		pool = ["rock", "synth_pop", "cyber_punk", "retro_game", "piano"];
	} else if (song.stats.leapRatio >= 0.45) {
		// 跳躍の多いドラマティックな旋律: オーケストラ、ファンタジー、アコースティック
		pool = ["fantasy_rpg", "orchestra", "acoustic", "piano"];
	} else {
		// 中速・スタンダード: 幅広い選択肢
		pool = [
			"piano",
			"acoustic",
			"synth_pop",
			"rock",
			"jazz_night",
			"fantasy_rpg",
		];
	}

	return pick(pool, rnd);
};

// ============================================================
// 歌詞
// ============================================================

/**
 * 歌詞に使う語句の素。意味のある歌詞は作らない——ここが作るのは「メロディに正しく乗る、
 * 日本語として発音できる音の並び」で、詞そのものはユーザーが書き換える前提。母音で終わる
 * 開音節を主体にし、2〜3拍の語をまぜて単調な羅列にならないようにする。
 */
const LYRIC_WORDS: string[] = [
	"あさ",
	"ひかり",
	"そら",
	"かぜ",
	"ゆめ",
	"こえ",
	"みち",
	"とおく",
	"きみ",
	"ぼく",
	"ここ",
	"いま",
	"また",
	"ずっと",
	"そっと",
	"きっと",
	"あした",
	"よる",
	"ほし",
	"うみ",
	"はな",
	"なみだ",
	"わらう",
	"あるく",
	"さがす",
	"とどく",
	"うたう",
	"めぐる",
	"かさなる",
	"つづく",
	"ひとり",
	"ふたり",
	"しずか",
	"まぶしい",
	"せかい",
	"きせつ",
];

/**
 * 主旋律に付いた歌詞を、同じ場所で歌う別のトラック（ハモリ）へ写す。`composeLyrics` を
 * もう一度呼ぶと2人が違う言葉を同時に歌うことになるので、発音位置で突き合わせて並べ直す。
 */
export const alignLyrics = (
	/** 歌詞が付いている側のノート列（主旋律）。 */
	source: ComposedNote[],
	/** その歌詞（{@link composeLyrics} の戻り値）。 */
	lyrics: string,
	/** 歌詞を写す先のノート列（ハモリ）。 */
	target: ComposedNote[],
	options: { stepsPerBar: number },
): string => {
	const sorted = [...source].sort((a, b) => a.startStep - b.startStep);
	// 「、」は音符を消費しないので、写す前に外して1音1文字へ揃える。
	const kana = [...lyrics].filter((c) => c !== "、");
	const at = new Map<number, string>();
	for (let i = 0; i < sorted.length && i < kana.length; i++)
		at.set(sorted[i].startStep, kana[i]);

	const { stepsPerBar } = options;
	const tgt = [...target].sort((a, b) => a.startStep - b.startStep);
	const out: string[] = [];
	for (let i = 0; i < tgt.length; i++) {
		out.push(at.get(tgt[i].startStep) ?? "ー");
		const next = tgt[i + 1];
		if (
			next &&
			Math.floor(tgt[i].startStep / (stepsPerBar * 4)) !==
				Math.floor(next.startStep / (stepsPerBar * 4))
		)
			out.push("、");
	}
	return out.join("");
};

/**
 * メロディに乗る歌詞を作る。`lyrics.ts` の約束は音符1つ＝音節1つ。伸ばし棒（`ー`）も
 * 1音節を占めるので、`ー` は音符を1つ消費する形でしか置かない（足して伸ばすと後半の歌詞が
 * 全部ずれる）。読点（`、`）だけは音符を消費せず、直前の音節に息継ぎフラグを立てる。
 */
export const composeLyrics = (
	melody: ComposedNote[],
	options: { stepsPerBar: number; random?: () => number },
): string => {
	const rnd = options.random ?? Math.random;
	const { stepsPerBar } = options;
	const sorted = [...melody].sort((a, b) => a.startStep - b.startStep);
	if (sorted.length === 0) return "";
	const quarter = stepsPerBar / 4;

	/** 語を1音節ずつ切り出して供給する。尽きたら次の語を引く。 */
	let buffer: string[] = [];
	const nextKana = (): string => {
		if (buffer.length === 0) buffer = [...pick(LYRIC_WORDS, rnd)];
		return buffer.shift() as string;
	};

	const out: string[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const note = sorted[i];
		const prev = sorted[i - 1];
		// 同じ高さへ短い音で続くところは母音を伸ばす（メリスマ）。語の途中では切らない。
		const holds =
			i > 0 &&
			prev !== undefined &&
			note.pitchUnits === prev.pitchUnits &&
			note.durationSteps < quarter &&
			buffer.length === 0 &&
			rnd() < 0.5;
		out.push(holds ? "ー" : nextKana());
		// フレーズの切れ目（4小節ごと）で息継ぎ。`、` は音符を消費しない。
		const next = sorted[i + 1];
		if (
			next &&
			Math.floor(note.startStep / (stepsPerBar * 4)) !==
				Math.floor(next.startStep / (stepsPerBar * 4))
		) {
			out.push("、");
			buffer = []; // フレーズをまたいで語を割らない
		}
	}
	return out.join("");
};
