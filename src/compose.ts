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
 *
 * ## 「基準を満たす」から「候補から選ぶ」へ
 *
 * ここまでの設計でも、**受け入れ基準そのものが曲の構造を測っていなかった**。
 * 16小節の順番をシャッフルして曲を破壊しても、7項目のうち5つは値が1つも動かない。
 * 順序を見ていたのは隣接2音までの2項目だけで、モチーフの配置も盛り上がりの位置も
 * フレーズの呼応も評価対象外だった。しきい値をいくら引き直しても改善しようがない。
 *
 * そこで次の3点を変えてある。
 *
 * - **順序に依存する指標を作った**（{@link file://./compose-metrics.ts}）。
 *   小節どうしの自己相似プロファイル、フレーズの息継ぎ、クライマックスの単峰性、
 *   緊張カーブ、メロディとサブメロのコール&レスポンス。採点の重みは
 *   {@link WEIGHTS} のとおり構造側へ半分以上を配分している。
 * - **合否ではなく点数にした**。ハード制約（{@link HARD}）に触れたものだけを捨て、
 *   残りは {@link DRAW_COUNT} 本の候補から**点数最大のものを選ぶ**。初版は
 *   「しきい値を全部満たした最初の1本」を返していたので、構造が良くても休符率が
 *   0.09なら捨てるし、しきい値さえ満たせば1本目で確定していた。
 * - **しきい値を人間の曲から採った**（{@link CORPUS_BANDS}）。手で決めた定数をやめ、
 *   実際のMIDIから同じ指標を抽出した分布の中央50%を満点にしている。
 *   較正は `scripts/calibrate-corpus.ts`。
 *
 * さらに、指標に最適化した結果として全曲が同じ統計値へ寄るのを防ぐため、直近に作った
 * 曲との距離を加点している（{@link ComposeOptions.recent}）。
 *
 * ## 「調が固定に聞こえる」を潰したこと
 *
 * 曲の調（{@link ROOT_SHIFTS}）は曲ごとに12調へ散らしてあるのに、続けて聴くと
 * どれも同じ調子に聞こえる、という状態が長く残っていた。参考曲91本と生成物を
 * **同じ物差しで測って**原因を特定した（`scripts/compare-corpus.ts`）。
 *
 * - **メロディが調の外の音を1音も出せなかった。** 音の並びは最後まで音階の度数
 *   （{@link MAJOR_SCALE}）で持っていて、{@link nearestChordTone} が `E7` の `G#` を
 *   返しても `semitoneToDegree` がその場で `G` へ丸めていた。実測で非ダイアトニック音は
 *   40曲・約4000音を測って**0音**（参考曲は音数比で中央値4%・p75で11%）。
 *   進行にセカンダリドミナントを入れておきながら、旋律だけが調に留まっていた。
 *   {@link applyChromatic} と、アボイドノートを半音上の和音構成音へ解決させる分岐
 *   （{@link shapeBar}）で、和音の変化音・半音の経過音を通すようにしてある。
 * - **和音の側にも調の外が無かった。** 進行の候補が全部ハ長調／イ短調の
 *   ダイアトニックだったので、借用和音（サブドミナントマイナー・bVII・裏コード）を
 *   候補に足した。
 *
 * ## 帯の内側で、どこに居るか
 *
 * 目標帯（{@link CORPUS_BANDS}）は指標ごとに独立して採った**周辺分布**なので、
 * p25〜p75 を一律に満点にすると**全部の帯の端に同時に居座る曲**も満点を取れる。
 * 実測がまさにそれで、参考曲と生成物の中央値を並べると
 *
 *   1小節の音数 6.3 / 5.2　　順次進行 0.50 / 0.36　　休符率 0.07 / 0.18
 *   跳躍率 0.37 / 0.51　　音域 19 / 23半音
 *
 * と、**どの項目も帯の内側なのに揃って同じ側へ寄っていた**——「スカスカで跳ねて
 * ばかりの曲」は、周辺分布だけ見れば全項目が人間の範囲に収まる。帯の内側にも
 * 中央値へ向かう傾斜を付け（`centeredBand`）、測っていたのに採点していなかった
 * 密度（{@link file://./compose-metrics.ts} の `DensityFeatures`）と順次進行の比率を
 * 採点項目に足した。
 *
 * ただし**採点だけでは密度は動かない**。候補40本はどれも同じ分布から引いた
 * ものなので、選抜しても中央値は1音も動かなかった。曲ごとに狙いの密度と休符率を
 * 先に決めて、それに近いリズム型を引くようにしてある（`targetNotesPerBar` /
 * `targetRestRatio`）。
 *
 * ## サブメロの制約が外れたこと
 *
 * サブメロは長らく「単音・低密度・長音価」の形しか書けなかった。おまかせマスタリングの
 * 役割推定がその3点でサブメロを判定していたため、外すと伴奏と誤判定されて楽器が
 * 変わってしまうからで、**ツールの都合が音楽を縛っていた**。`daw.ts` が simple モードで
 * トラックIDをそのまま役割として使うようになった（推定はMIDI取り込みと advanced モード
 * 専用に退いた）ので、この制約は無くなった。合いの手・ハモリ・対旋律・保続音を
 * {@link SubStyle} として持たせてある。
 */

import { parseChord } from "@onjmin/chord-parser";
import {
	type ChordPatternType,
	semitonesToUnits,
	spelledToUnits,
} from "./chords";
import { CORPUS_BANDS, CORPUS_MEDIANS, CORPUS_SIZE } from "./compose-corpus";
import { type ResolvedComposeKey, resolveComposeKey } from "./compose-keys";
import {
	type Band,
	band,
	centeredBand,
	type DensityFeatures,
	densityFeatures,
	featureDistance,
	featureVector,
	type MetricNote,
	type StructureFeatures,
	structureFeatures,
	type TensionFeatures,
	tensionFeatures,
} from "./compose-metrics";
import {
	buildSectionPlan,
	DEFAULT_SECTIONS,
	type PlacedSection,
	type SectionKind,
	sectionAt,
} from "./compose-sections";
import { UNITS_PER_SEMITONE, type Units } from "./tuning";

// ============================================================
// 受け入れ基準
//
// 初版は「7項目すべてがしきい値内なら採用、1つでも外れたら破棄」という真偽値だった。
// これには2つの欠陥があった。
//
// 1. **構造を測っていない。** 7項目のうち5つ（音価の種類数・エントロピー・休符率・
//    メロディ音域・サブメロ音域）は順序非依存で、16小節の順番をシャッフルして曲を
//    破壊しても値が1つも動かない。残る2つ（最大跳躍・跳躍率）も隣接2音までしか見ない。
//    → {@link file://./compose-metrics.ts} に順序依存の指標を作り、ここで使う。
// 2. **落とすことしかできない。** 構造が良くても休符率が0.09なら破棄されていた。
//    → しきい値の合否を「ハード制約（常に間違いなもの）」だけに絞り、残りは
//      台形の当てはめ（{@link band}）で連続的な点数にして**加重和の最大値を選ぶ**。
//
// しきい値そのものも手で決めた定数をやめ、人間が書いた曲から実測した分布
// （{@link CORPUS_BANDS}）を目標帯にしている。
// ============================================================

/** 順次進行とみなす音程の上限（半音）。これを超えるものを「跳躍」と数える。 */
const STEP_SEMITONES = 2;
/**
 * 許す跳躍の上限（半音）。クライマックスのオクターブ跳躍だけはこの制限を受けない。
 *
 * 初版はここが5（完全4度）で、しかも跳躍をほとんど作らない書き方だったため、
 * 全曲が音階の上をうろつくだけになっていた。次に9（長6度）へ広げたが、人間の曲
 * 180本を測ると**最大跳躍の p05 が9・p25〜p75 が12〜17半音**で、9で頭打ちにすると
 * 目標帯の下限にすら届かない（採点0）ことが分かったので12（オクターブ）にした。
 */
const MAX_LEAP_SEMITONES = 12;
/** 小節をまたぐときに許す跳躍（半音）。 */
const MAX_BAR_LEAP_SEMITONES = 12;

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
 * 採点の重み。**構造（順序依存）の指標に半分以上を配分する**のが初版との一番の違い。
 * 分布の指標（エントロピー・休符率・跳躍率・音域）は「壊れていないこと」の確認であって、
 * そこをいくら最適化しても曲は良くならない、というのが実測から得た結論。
 */
const WEIGHTS = {
	// --- 分布（順序非依存）。壊れ検知としてだけ効かせる ---
	entropy: 0.6,
	valueKinds: 0.4,
	restRatio: 0.6,
	leapRatio: 0.6,
	maxLeap: 0.4,
	melodyRange: 0.6,
	/**
	 * メロディの速さ。**測っていたのに採点していなかった**項目で、実測は
	 * 1小節 4.4音（参考曲 5.0〜7.3）・順次進行 34%（参考曲 20〜61%、中央値50%）と
	 * 「スカスカで跳ねてばかり」に寄っていた。
	 */
	notesPerBar: 0.8,
	shortNoteRatio: 0.6,
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
	climaxPosition: 1.0,
	climaxPeaks: 1.0,
	/** メロディとサブメロが呼応しているか。 */
	complementarity: 1.0,
	// --- 和声（コードが要るのでコーパスからは較正できない） ---
	/** B部でテンションが上がるか。 */
	tensionRise: 1.0,
	/** 終止で解決するか。 */
	tensionResolve: 0.8,
	// --- 直近に作った曲と違うか ---
	novelty: 1.2,
} as const;

/**
 * コーパスから較正できない指標の目標帯（手で決めたもの）。
 *
 * - `complementarity` … コーパス側で「対旋律」に当たるチャンネルを機械的に選ぶ精度が
 *   低く、p25 が 0 に張り付く。これを目標にすると「サブメロは常にメロディと重なって
 *   いろ」という誤った基準になる。合いの手と対旋律が半分、ハモリが重なる、という配分を
 *   想定して 0.25〜0.7 を満点にしてある。
 * - `climaxPeaks` … コーパスの曲は長い（数十小節）ぶん頂点が増え、p25〜p75 が 4〜13 に
 *   なる。16小節の曲にそのまま当てると緩すぎるので「山は1〜2回」を満点にする。
 */
const HAND_BANDS = {
	/** サブメロの音数/小節。少なすぎると「置いただけ」、多すぎるとメロディを食う。 */
	subDensity: [0.5, 1.8, 4.5, 8] as Band,
	complementarity: [0.05, 0.25, 0.7, 0.95] as Band,
	climaxPeaks: [0, 1, 2, 5] as Band,
} as const;

/** 1曲作るのに引く候補数。この中から一番点数の高いものを返す。 */
const DRAW_COUNT = 40;

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
 * 半音シフト量（0〜11）に対応する五度圏インデックスの変化量。
 * 12平均律・31平均律ともに五度圏インデックスを保つために用いる。
 */
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
 * 曲の調（ハ長調からの移調量・半音）。
 *
 * 初版は**全曲がハ長調／イ短調に固定**で、終止音に至っては100%が同じ「ド」だった。
 * 曲の中身をいくら作り分けても、調が同じなら続けて聴いたとき「似た感じ」から抜けない。
 * 参考曲91本の調を数えると C 28 / D# 21 / F 17 / E 11 / G# 7 …と12調すべてに散っており、
 * ここが固定なのは単純に不足していた。
 *
 * 音域は C を基準に組んであるので、上下に極端へ振らず -5〜+6 半音に収める。
 */
const ROOT_SHIFTS = [0, 1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5];

/**
 * テンポ（BPM）の候補。参考曲100本の実測は 中央値132・p25〜p75 が 126〜136。
 * その周辺を厚めにしつつ、**120未満を落として170〜185の高速帯を足してある**——
 * ボカロ曲は120以上でそれらしくなり、高速系は170〜185が最も多い（1拍に16分が4つ
 * 収まって「詰め込み感」が出る帯）。初版はテンポを設定しておらず全曲が既定値だった。
 */
const BPM_CHOICES = [
	112, 120, 124, 126, 128, 130, 132, 132, 134, 136, 138, 142, 150, 155, 160,
	168, 172, 175, 180, 185,
];

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

/**
 * ペンタトニックから外れる度数。**ファ（4度）とシ（7度）**の2つ。
 *
 * 歌メロの解説はどれも「まずペンタトニック（ド・レ・ミ・ソ・ラ）に絞れ」と言う。
 * ハ長調でもイ短調でも外れるのはこの2音で（イ短調のペンタトニックは
 * ラ・ド・レ・ミ・ソ）、どちらも半音上に隣の音が迫っていて主張が強い。
 *
 * この2音を無条件に使うと、**スケールの上をなぞっただけのメロディ**になる。
 * 使ってよいのは次の2つの場合だけ、というのが共通して書かれている規則。
 *
 * - その瞬間の和音の構成音であるとき（F の上のファ、G7 の上のシは和音の芯）
 * - **前後を順次進行で挟むとき**（経過音・刺繍音として通り過ぎるだけ）
 *
 * 生成物はここを一切見ておらず、7音を無差別に使っていた。
 */
const NON_PENTATONIC_DEGREES = new Set([3, 6]); // ファ・シ

/** その音がペンタトニックの外（ファ・シ）か。 */
const isNonPentatonic = (semi: number): boolean =>
	NON_PENTATONIC_DEGREES.has(((semitoneToDegree(semi) % 7) + 7) % 7);

/** ペンタトニックの5音を、ダイアトニックの度数で表したもの（ド・レ・ミ・ソ・ラ）。 */
const PENTATONIC_DEGREES = [0, 1, 2, 4, 5];

/**
 * ペンタトニックの度数（5音で1オクターブ）→ ダイアトニックの度数。
 *
 * **モチーフはこちらの度数で組み立てる。** ダイアトニックの度数で輪郭を作ると、
 * 「1つ上」が文脈によってミ→ファ（半音）にもなり、モチーフを移調したとたんに
 * ファやシが紛れ込む。ペンタトニックの度数で持てば、どこへ移調しても
 * ペンタトニックのままでいられる。
 */
const pentaToDegree = (penta: number): number => {
	const index = ((penta % 5) + 5) % 5;
	const octave = Math.floor(penta / 5);
	return PENTATONIC_DEGREES[index] + octave * 7;
};

/** ダイアトニックの度数 → 最も近いペンタトニックの度数。 */
const degreeToPenta = (degree: number): number => {
	const index = ((degree % 7) + 7) % 7;
	const octave = Math.floor(degree / 7);
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < PENTATONIC_DEGREES.length; i++) {
		const dist = Math.abs(PENTATONIC_DEGREES[i] - index);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return octave * 5 + best;
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
	// --- 借用和音（同主短調・ミクソリディアンから借りる） ---
	// **調の外の和音を進行そのものに持たせる。** ここまでの候補は全部ハ長調／イ短調の
	// ダイアトニックで、セカンダリドミナント以外に調の外の音が出てこなかった。
	// メロディが変化音を採れるようになった（{@link applyChromatic}）ので、
	// 和音の側にも「調の外」を用意しておかないと、その受け皿が無い。
	["F", "Fm", "C", "G7"], // サブドミナントマイナー（王道の陰り）
	["C", "Bb", "F", "C"], // bVII（ミクソリディアン借用）
	["Am", "Dm7", "Bb", "E7"], // bVI からドミナントへ
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
	// 人間の曲を測ると、主旋律の休符はステップ比で15〜43%（p25〜p75）あった。
	// 初版のセルでは全曲が3〜8%にしかならず、目標帯にまるで届かない。
	// 末尾を空ける形は、フレーズの切れ目の息継ぎ（{@link StructureFeatures.phraseBreath}）
	// にもそのまま効く。
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
 * モチーフに使うリズム型。5音前後で、音価に変化があり、覚えやすい形のものだけを選ぶ
 * （モチーフは「そのまま反復して記憶に残す」のが仕事なので、走句のような流れる形は不向き）。
 */
/**
 * **2拍（半小節）の言い回し。** モチーフのリズムはここから2つ引いて組み立てる。
 *
 * 歌モノのメロディで実際に多いのは「タタ／タタ」（8分4つ）と
 * 「ター／タタ」（4分＋8分2つ）で、そこへ時々ロングトーンや16分が混ざる、という形。
 * 初版はモチーフの型を1小節まるごと手書きで並べていたため、この偏りが再現できず、
 * どの型も同じ確率で出ていた。**言い回しの単位は1小節ではなく2拍**なので、
 * 2拍で持って組み合わせる。
 *
 * 並びの重複がそのまま重み付け。よく使う形ほど多く入れてある。
 */
const HALF_BAR_FIGURES: number[][] = [
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH], // タタタタ
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH],
	[EIGHTH, EIGHTH, EIGHTH, EIGHTH],
	[QUARTER, EIGHTH, EIGHTH], // ター・タタ
	[EIGHTH, EIGHTH, QUARTER], // タタ・ター
	[DOT_QUARTER, EIGHTH], // 食い（シンコペーション）
	[DOT_QUARTER, EIGHTH],
	[EIGHTH, QUARTER, EIGHTH], // 頭抜き
	[HALF], // ロングトーン
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
 * モチーフに使うリズム型。**2拍の言い回し2つで組み立てたもの**（
 * {@link HALF_BAR_FIGURES}）に、シンコペーション・16分・三連の手書きの型を足したもの。
 *
 * 手書きの型だけだった頃は、実際の歌メロで多い「タタタタ」「ター・タタ」と、
 * それ以外の型が同じ確率で出ていた。言い回しの単位は1小節ではなく2拍なので、
 * 2拍で持って組み合わせたほうが偏りがそのまま出る。
 */
export const MOTIF_CELLS: RhythmCell[] = [
	...buildMotifCells(),
	...HAND_MOTIF_CELLS,
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
 * 曲全体を貫く基準音価（グルーヴ）。
 *
 * 「16分を使う曲か、使わない曲か」を**曲単位で決める**ためにある。初版はリズム型を
 * 小節ごとに独立に引いていたため、16分を含む小節が曲の中に1〜3個だけ散らばり、
 * **実測でその100%が「前後の小節に16分が無い孤立した小節」**になっていた。
 * 前後と繋がらない場所に細かい音が一度だけ出てくるのは、グルーヴではなく思い付きに聞こえる。
 */
type Groove = "eighth" | "sixteenth";

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
	if (groove === "eighth") return cells.filter((c) => !hasSixteenth(c));
	const withSixteenth = cells.filter(hasSixteenth);
	// 16分の曲でも全部の小節を16分で埋めると息が詰まるので、たまに素の型も通す。
	return withSixteenth.length > 0 && rnd() < 0.75 ? withSixteenth : cells;
};

/**
 * 合いの手の言い回し。メロディの隙間へ差し込む短いリズム。
 *
 * 初版は隙間を8分で等分して埋めていた。その結果サブメロが曲を通して機械的な刻みになり
 * （実測: サブメロの音の40%、最悪の曲では100%が「同じ音価が3つ以上続く」形）、
 * 「思い出したように特定のトラックだけ細かく刻んでいる」という聞こえ方になっていた。
 * 合いの手は等分ではなく、**言い回し**として置く。
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
	| "octave";
/**
 * サブメロの書法。
 *
 * 初版はここが「小節を等分して長い音を1〜2個置く」の変種しか無かった。理由は
 * おまかせマスタリングの役割推定（`daw.ts` の `classifyTrackRole`）が
 * **単音・低密度・長音価**の3点でサブメロを判定していたためで、その形を外すと
 * 「伴奏」と誤判定されて楽器が変わってしまうからだった。
 *
 * その制約は無くなった——`daw.ts` は simple モードでは**トラックIDが役割そのもの**
 * なので推定を通さない（推定は advanced モードとMIDI取り込みのためだけに残っている）。
 * 対旋律として意味のある形を書けるようになったので、書法を増やしてある。
 *
 * - `pad` … 全音符1つ。和音の色を支える。
 * - `long-short` … 付点2分＋4分。
 * - `answer` … **合いの手**。メロディが休んでいる隙間にだけ入る。
 * - `harmony` … **ハモリ**。メロディのリズムをなぞって3度／6度下を歌う。
 * - `counter` … **対旋律**。8分でメロディと反行する。
 * - `pedal` … **保続音**。小節を通して同じ音を伸ばす。
 */
type SubStyle =
	| "pad"
	| "long-short"
	| "answer"
	| "harmony"
	| "counter"
	| "pedal";

/**
 * モチーフの原型（音階の度数差の列）。初版はここが「±1／±2 の乱数の累積」だったため、
 * どの曲のモチーフも似た形の酔歩になっていた。**輪郭に名前が付く形**を並べておき、
 * 曲ごとに1本引く。
 */
const MOTIF_ARCHETYPES: number[][] = [
	// --- 順次進行主体（歌いやすく滑らかな旋律。参考曲の順次進行 50% を支える） ---
	[0, 1, 2, 3, 4], // スケール上行
	[0, 1, 2, 3, 4],
	[4, 3, 2, 1, 0], // スケール下降
	[4, 3, 2, 1, 0],
	[0, 1, 2, 1, 2], // 順次上行・揺れ
	[0, -1, -2, -1, -2], // 順次下降・揺れ
	[0, 1, 2, 3, 2], // 上行して一歩戻る
	[0, 1, 2, 3, 2],
	[0, -1, -2, -3, -2], // 下行して一歩戻る
	[0, 1, 2, 1, 0], // 順次アーチ
	[0, -1, -2, -1, 0], // 順次谷型
	[0, 1, 0, -1, 0], // 軸音まわりの揺れ
	[2, 1, 0, 1, 2], // 折り返し
	[0, 1, 2, 0, 1], // 波型
	[0, 0, 1, 2, 3], // 連打から上行
	[0, 0, -1, -2, -1], // 連打から下降
	[0, 2, 1, 2, 3], // 軽い跳躍からの順次上行
	[0, -2, -1, 0, 1], // 軽い沈み込みからの順次上行
	[0, 1, 2, 2, 3], // 順次進行に同音を挟む
	[0, -1, -2, -2, -3],
	[0, 3, 2, 1, 0], // 跳躍からの順次下降（gap fill の教科書形）
	[0, -3, -2, -1, 0], // 下跳躍からの順次上行
	[0, 1, 3, 2, 1], // アーチ
	[0, 2, 1, 0, -1], // 跳ねてから埋める
	[0, 4, 3, 2, 1], // 5度上へ跳んで順次下降
	[0, -4, -3, -2, -1], // 下へ跳んで順次上行
	// --- 同音連打を含む形（語りかけ・疾走感） ---
	[0, 0, 0, 1, 2],
	[0, 0, 2, 2, 1],
	[0, 0, -1, -1, -2],
	[0, 1, 1, 0, 0],
	[0, 0, 1, 2, 1],
	// --- 跳躍・オクターブを含む形（フック・ドラマ性） ---
	[0, 5, 4, 3, 2], // オクターブ上へ跳んで降りてくる
	[0, 5, 0, 5, 0], // オクターブを行き来する
	[0, -5, 0, 1, 2], // 一度下へ落としてから戻る
	[0, 1, 5, 4, 3],
	[0, 2, 4, 3, 2], // 分散和音風の上行
	[0, 3, 2, 4, 3], // 二段跳び
	[0, -1, 1, -2, 0], // ジグザグ
	[0, 5, 4, 2, 0], // 6度跳躍からの大きな下降
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
	 * 直近に作った曲の特徴ベクトル（{@link ComposeStats.fingerprint}）。
	 *
	 * 指標に最適化すると、**基準を満たすことに最適化された結果として全曲が同じ
	 * 統計値へ寄る**。実際、初版は品質基準こそ満たしていたのに「同じ設計図の上で
	 * 音名だけが違う曲」を量産していた。ここへ直近の曲を渡すと、それらから離れている
	 * 候補に加点する（{@link WEIGHTS.novelty}）。
	 */
	recent?: number[][];
	/** 引く候補の数。既定 {@link DRAW_COUNT}。 */
	drawCount?: number;
	/**
	 * 作るセクション（イントロ・Aメロ・Bメロ・サビ・間奏・アウトロ）。
	 * 省略時は {@link DEFAULT_SECTIONS}。並び順は指定によらず
	 * `SECTION_ORDER` に従う。
	 */
	sections?: SectionKind[];
	/**
	 * ベースとなる調・雰囲気の指定（"any" | "major" | "minor" | "mood_*" | "key_*"）。
	 * 省略時は "any"（全24調からランダム抽選）。
	 */
	baseKey?: string;
};

export type ComposeResult = {
	/** 伴奏トラック用のコード進行文字列。`buildChordPlacements` へそのまま渡せる。 */
	chordProgression: string;
	/** 伴奏の奏法。 */
	chordPattern: ChordPatternType;
	/**
	 * 曲の調。ハ長調からの移調量（半音）。メロディ・サブメロ・ベースの音は
	 * **既にこの量だけ移調済み**なので、呼び出し側は伴奏トラックの `rootShift` へ
	 * 同じ値を渡すだけでよい。
	 */
	rootShift: number;
	/** 曲の調の名前（例: "C", "D", "Am"）。 */
	keyName: string;
	/** 曲の調の表示ラベル（例: "ハ長調 (C)", "イ短調 (Am)"）。 */
	keyLabel: string;
	/** 雰囲気カテゴリのラベル（該当する場合）。 */
	moodLabel?: string;
	/** 曲のテンポ（BPM）。 */
	bpm: number;
	/** 曲の設計図。どの小節がどのセクションかを表す。 */
	sections: PlacedSection[];
	/** 曲の長さ（小節）。セクションの選び方で変わる。 */
	bars: number;
	/** 曲に合わせて組み込みから自動選択されたドラムパターン名（DRUM_PATTERNS のキー）。 */
	drum: string;
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
	/**
	 * 和音の色を出す音（3度・7度＝重み2）があるなら、そちらを優先する。
	 *
	 * `minWeight` を2へ下げるだけでは、ルート・5度も候補に残るので「最も近い音」は
	 * たいてい結局ルートか5度になり、和音がいくら動いても緊張が上がらなかった
	 * （B部の {@link TensionFeatures.rise} が実測で半数の曲において 0）。
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

/** メロディの音域（半音・MIDIノート番号相当）。C4〜C6あたりに収める。 */
const MELODY_LOW = 60;
const MELODY_HIGH = 84;
/** メロディの音域の中心。大きなうねり（{@link MelodyStyle.arcPeriod}）の基準。 */
const MELODY_CENTER = (MELODY_LOW + MELODY_HIGH) / 2;
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
	/**
	 * モチーフをペンタトニックの度数で組むか。
	 *
	 * 解説はどれも「まずペンタトニックに絞れ」と書いているが、**全曲をそれで通すと
	 * 今度はファ・シが一切出なくなる**（実測でペンタ外が9%、参考曲は23%）。
	 * 半音の動き（隣接音程の1半音）も一緒に消え、3半音（ペンタトニックの隣どうし）
	 * ばかりの平坦な線になる。制約は曲単位で掛け、掛けない曲も混ぜる。
	 */
	pentatonicMotif: boolean;
	runShape: RunShape;
	stepShape: StepShape;
	holdShape: HoldShape;
	cadenceShape: CadenceShape;
	/** 弱拍で跳躍を混ぜる確率。 */
	leapAffinity: number;
	/**
	 * 調の外の音（変化音）を使う度合い。{@link applyChromatic} 参照。
	 *
	 * 0 の曲も混ぜる——全曲に半音を撒くと今度はどの曲も同じ「半音まみれ」の
	 * 顔になる。参考曲も非ダイアトニック音が 0 に近い曲から 20% を超える曲まで
	 * 幅がある（音数比で p05 0.00 / p50 0.04 / p95 0.22）。
	 */
	chromaticAffinity: number;
	/** 強拍で着地させる構成音の重み下限（3=ルート/5度のみ、2=3度/7度も許す）。 */
	barHeadWeight: 2 | 3;
	bassStyle: BassStyle;
	/** ベースを短く切って弾むように弾くか（スタッカート）。 */
	bassStaccato: boolean;
	/** 小節にゴーストノート（弦に触れて音程を殺した打点）を混ぜる確率。 */
	bassGhost: number;
	subStyle: SubStyle;
	/** サブメロがメロディから何半音下を歌うか。 */
	subInterval: number;
};

/**
 * 1小節分の「音の並び（度数）」を、役割と書法から作る。
 * ここではまだ音域も跳躍制限も見ない——形を作るのが仕事で、
 * 整えるのは {@link shapeBar} の役目。
 */
/**
 * 跳躍の着地点を探す。**和音の構成音の中からしか選ばない。**
 *
 * 解説に共通して書かれている「跳躍進行はコードトーン間（ドソ・ドミ）に限る」の実装。
 * 3〜9半音（短3度〜長6度）離れた構成音を候補にし、近いものを優先して引く。
 * 候補が無ければ跳ばない（順次進行のまま）。
 */
const leapTarget = (
	from: number,
	tones: ChordTone[],
	rnd: () => number,
): number | null => {
	const candidates: number[] = [];
	for (const tone of tones) {
		const base = pitchClass(tone.semi);
		for (let oct = 0; oct <= 10; oct++) {
			const semi = base + oct * 12;
			if (semi < MELODY_LOW || semi > MELODY_HIGH) continue;
			const gap = Math.abs(semi - from);
			if (gap >= 3 && gap <= MAX_LEAP_SEMITONES) candidates.push(semi);
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
 * フレーズの最後の音を、指定の音階度数へ着地させる。
 *
 * 「上行フレーズ終わり＝疑問／下行フレーズ終わり＝応答」という解説の実装。
 * 小楽節の答えは、**主音へ落とせば解決、主音以外（2度・5度）で止めれば
 * まだ続く**という言い分けになる。これが無いと、どのフレーズも同じように
 * 終わってしまい、問いと答えの関係が生まれない。
 */
const landOn = (degrees: number[], scaleIndex: number): void => {
	if (degrees.length === 0) return;
	const last = degrees[degrees.length - 1];
	const index = ((last % 7) + 7) % 7;
	let delta = scaleIndex - index;
	// 近い方へ寄せる（7度上ではなく2度下、のように）。
	if (delta > 3) delta -= 7;
	if (delta < -3) delta += 7;
	degrees[degrees.length - 1] = last + delta;
};

/**
 * 音高が確定した後に、フレーズの最後の音を着地音へ確定させる。
 *
 * 度数の段階で決めても、{@link shapeBar} の跳躍制限・gap fill が最後の音を
 * 書き換えてしまう（実測で200曲中4曲、全終止が主音から外れた）。着地は
 * フレーズの意味そのものなので、最後に上書きし直す。
 */
const landPitch = (pitches: number[], scaleIndex: number): void => {
	if (pitches.length === 0) return;
	const last = pitches[pitches.length - 1];
	const degree = semitoneToDegree(last);
	const index = ((degree % 7) + 7) % 7;
	let delta = scaleIndex - index;
	if (delta > 3) delta -= 7;
	if (delta < -3) delta += 7;
	pitches[pitches.length - 1] = clampSemi(
		degreeToPitch(degree + delta).semi,
		MELODY_LOW,
		MELODY_HIGH,
	);
};

const barDegrees = (
	role: BarRole,
	slots: Slot[],
	tones: ChordTone[],
	style: MelodyStyle,
	motifContour: number[],
	startDegree: number,
	/**
	 * この小節が輪郭のどこから始まるか。**モチーフは2小節でひとまとまり**なので、
	 * 2小節目は1小節目の続きから読む。ここを常に0にすると2小節目が1小節目と
	 * 同じ形を繰り返すだけになり、2小節の楽句にならない。
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
		// モチーフの輪郭をそのまま乗せる。sequence は音程ごとずらし、climax は
		// 1オクターブ上げる——「同じ型に別の音を当てはめる」のではなく
		// 「同じアイデアを別の文脈で置き直す」のが狙い。
		// **モチーフはペンタトニックの度数で組み立てる。** ダイアトニックの度数で
		// 輪郭を持つと「1つ上」がミ→ファ（半音）にもなり、移調するたびに
		// ファやシが紛れ込んで、モチーフが歌えない形へ化ける。
		// セクエンツもオクターブ上げも、ペンタトニックの歩数で数える。
		const shift =
			(role === "sequence"
				? pick([-2, -1, 1, 2], rnd)
				: role === "climax"
					? 5 // ペンタトニックの5歩＝1オクターブ
					: 0) + repeatShift;
		if (style.pentatonicMotif) {
			const startPenta = degreeToPenta(startDegree);
			for (let i = 0; i < noteCount; i++)
				out.push(
					pentaToDegree(
						startPenta +
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
			nearestChordTone(
				degreeToPitch(out[i]).semi,
				tones,
				barHeadWeight,
				preferColor,
			).semi,
		);
	}

	// **音価と音の動きを対応させる。**
	//
	// 歌メロの定石として「短い音符では順次進行か同音連打、長い音符では跳躍」がある
	// （細かい音で跳ぶと歌えないし、長い音が順次に動くと平坦に聞こえる）。初版は
	// 音価と無関係に弱拍へ跳躍を撒いていたので、16分の走句の途中で唐突に跳ぶ、
	// といった「人が書かない形」が出ていた。ここが自動生成っぽさの主な出どころ。
	for (let i = 1; i < out.length - 1; i++) {
		if (slots[i].isStrong) continue;
		if (slots[i].value >= quarterSteps) {
			// 長い音 → 跳躍。直後は shapeBar の gap fill が反行の順次進行で埋める。
			//
			// **跳ぶ先は和音の構成音に限る。** 解説はどれも「跳躍進行はコードトーン間
			// （ドソ・ドミ）に限れ、無作為な音飛びはしない」と書いている。度数を
			// 適当に足していた頃は、和音と関係ない音へ跳んで着地するので、
			// 跳躍のたびに調子外れに聞こえていた。
			if (rnd() < style.leapAffinity) {
				const from = degreeToPitch(out[i - 1]).semi;
				const target = leapTarget(from, tones, rnd);
				if (target !== null) out[i] = semitoneToDegree(target);
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
 * 度数の列を、実際に鳴らせる音の列へ整える。
 *
 * 1. 音域へ畳み込む
 * 2. 小節またぎ／小節内の跳躍を上限で抑える
 * 3. **跳躍の直後は反行の順次進行で埋める**（gap fill）
 * 4. 強拍・長い音価にアボイドノートが来たら隣のスケール音へ逃がす
 */
/**
 * モチーフを**塊ごと**和音に合わせる。
 *
 * 音を1つずつ和音へ寄せると、同じモチーフでも和音が変わるたびに別の形へ化ける。
 * 人がやるのは逆で、**モチーフの形はそのままに、置く高さを変えて**和音に合わせる。
 * ここでは度数を上下に振ってみて、
 *
 * - 強拍の音がどれだけ和音構成音に乗るか（重み付き）
 * - 直前の音とのつながりが跳びすぎないか
 *
 * が最も良い移調量を選ぶ。1音も曲げないので、輪郭は完全に保たれる。
 */
const fitMotif = (
	degrees: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	quarterSteps: number,
	/** ペンタトニックの歩数で移調するか。ダイアトニックで組んだモチーフには掛けない。 */
	pentatonic: boolean,
): number[] => {
	let best = degrees;
	let bestScore = Number.NEGATIVE_INFINITY;
	// ペンタトニックで組んだモチーフは**ペンタトニックの歩数**で移調する。
	// ダイアトニックの度数で ±1 するとミ→ファのような半音移動が混ざり、輪郭が崩れる。
	// 逆に、ダイアトニックで組んだモチーフをペンタトニックの歩数で動かすと、
	// せっかく輪郭に入れたファ・シがその場で潰れる（実測でペンタ外が9%から動かなかった）。
	for (let shift = -3; shift <= 3; shift++) {
		const moved = degrees.map((d) =>
			pentatonic ? pentaToDegree(degreeToPenta(d) + shift) : d + shift,
		);
		let score = 0;
		for (let i = 0; i < moved.length; i++) {
			const semi = clampSemi(
				degreeToPitch(moved[i]).semi,
				MELODY_LOW,
				MELODY_HIGH,
			);
			const w = toneWeight(semi, tones);
			// 強拍と長い音は和音構成音であってほしい。弱拍の経過音は自由。
			const important = slots[i].isStrong || slots[i].value >= quarterSteps;
			score += important ? w * 3 : w;
		}
		// 前の小節からのつながり。跳びすぎる置き方は避ける。
		const head = clampSemi(
			degreeToPitch(moved[0]).semi,
			MELODY_LOW,
			MELODY_HIGH,
		);
		score -= Math.max(0, Math.abs(head - prevSemi) - MAX_BAR_LEAP_SEMITONES);
		if (score > bestScore) {
			bestScore = score;
			best = moved;
		}
	}
	return best;
};

const shapeBar = (
	degrees: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	opts: {
		allowLeap: boolean;
		allowArpeggio: boolean;
		quarterSteps: number;
		/** 弱拍でオクターブ跳躍を入れる確率。 */
		octaveAffinity: number;
		/** アボイドノートを半音上の和音構成音へ解決させる確率。 */
		chromaticAffinity: number;
		rnd: () => number;
		/**
		 * モチーフの輪郭をそのまま鳴らす。
		 *
		 * 通常は音を1つずつ和音へ寄せる（強拍の着地・gap fill・アボイド回避）が、
		 * **モチーフの小節でそれをやると、同じモチーフが和音ごとに別の形へ化ける**。
		 * 実測で「同じ輪郭が2回以上現れる小節」は61%しかなく、聴き手には
		 * フックが繰り返されていると分からない＝毎小節ちがう音が流れるだけになる。
		 * モチーフは音を曲げるのではなく、**塊ごと移調して**和音に合わせる
		 * （{@link fitMotif}）。ここでは音域に収めるだけにする。
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
		const raw = degrees.map((d) => degreeToPitch(d).semi);
		const lo = Math.min(...raw);
		const hi = Math.max(...raw);
		let shift = 0;
		while (lo + shift < MELODY_LOW) shift += 12;
		while (hi + shift > MELODY_HIGH) shift -= 12;
		// 塊が音域より広いときだけ、はみ出した音を1つずつ折り返す。
		for (const semi of raw)
			out.push(
				semi + shift >= MELODY_LOW && semi + shift <= MELODY_HIGH
					? semi + shift
					: clampSemi(semi + shift, MELODY_LOW, MELODY_HIGH),
			);
		return out;
	}
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
			// **アボイドノートは半音上に和音構成音があるから避けられている。**
			// その構成音そのものへ半音上げて解決するのが、いちばん自然な逃げ先。
			// `E7` の上のソ→ソ#、`A7` の上のド→ド# がここで出る——調の外の音だが、
			// それは「和音がそう鳴っている」というだけのことで、この様式の泣きメロの
			// 芯はまさにこの音。度数へ丸めていた頃は隣の音階音へ逃げるしかなく、
			// セカンダリドミナントの上でメロディだけ調に留まっていた。
			const resolved = semi + 1;
			const useResolved =
				resolved <= MELODY_HIGH &&
				!DIATONIC_PCS.has(pitchClass(resolved)) &&
				toneWeight(resolved, tones) >= 2 &&
				resolved !== prev &&
				opts.rnd() < opts.chromaticAffinity;
			if (useResolved) {
				semi = resolved;
			} else {
				const up = clampSemi(walk(semi, 1), MELODY_LOW, MELODY_HIGH);
				const down = clampSemi(walk(semi, -1), MELODY_LOW, MELODY_HIGH);
				const score = (s: number) =>
					toneWeight(s, tones) * 2 + (i > 0 && s === prev ? -3 : 0);
				semi = score(down) >= score(up) ? down : up;
			}
		}
		out.push(semi);
		prev = semi;
	}
	applyPentatonic(out, slots, tones, prevSemi, opts.quarterSteps / 2);
	applyOctaveJumps(out, slots, opts.octaveAffinity, opts.rnd);
	return out;
};

/**
 * オクターブの跳ね上げ／落とし。
 *
 * 参考曲の隣接音程は**オクターブが17%**を占め、2度に次いで多い。
 * 「細かくジグザグ動かしながら大きな周期で上下する」というこの様式の動きは、
 * なめらかに移調するのではなく**オクターブで飛ぶ**ことで作られている。
 *
 * **音域へ畳み込んだ後に入れる。** 度数の段階で足すと、跳んだ先が音域の外に出て
 * その場で1オクターブ折り返され、跳ぶ前と同じ音に潰れる（実測でオクターブの
 * 隣接音程が5%止まりだった原因）。オクターブ移動は音名を変えないので、
 * 和音との関係も強拍の着地も壊さない。
 */
const applyOctaveJumps = (
	out: number[],
	slots: Slot[],
	affinity: number,
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
		const canUp = up <= MELODY_HIGH;
		const canDown = down >= MELODY_LOW;
		if (!canUp && !canDown) continue;
		out[i] = canUp && (!canDown || rnd() < 0.5) ? up : down;
	}
};

/**
 * ペンタトニックの外の音（ファ・シ）を整理する。
 *
 * 歌メロの解説はどれも「まずペンタトニックに絞れ、ファとシはクセが強いので
 * **前後を順次進行で挟むときだけ**通せ」と言う。生成物はここを一切見ておらず、
 * 7音を無差別に使っていたため、和音の上を移動しているだけで**歌のメロディに
 * 聞こえない**という状態になっていた。
 *
 * 残してよいのは次のどちらか。それ以外は隣のペンタトニック音へ逃がす。
 *
 * - その瞬間の和音の構成音（F の上のファ、G7 の上のシは和音の芯なので当然よい）
 * - 前からも次へも順次進行で出入りしている（経過音・刺繍音として通り過ぎるだけ）
 *
 * 逃がす向きは**輪郭を壊さない方**を選ぶ。前の音と同じ高さになる向きは避ける。
 */
const applyPentatonic = (
	out: number[],
	slots: Slot[],
	tones: ChordTone[],
	prevSemi: number,
	shortSteps: number,
): void => {
	for (let i = 0; i < out.length; i++) {
		const semi = out[i];
		if (!isNonPentatonic(semi)) continue;
		// 和音構成音なら触らない。
		if (tones.some((t) => pitchClass(t.semi) === pitchClass(semi))) continue;
		const before = i === 0 ? prevSemi : out[i - 1];
		const after = i + 1 < out.length ? out[i + 1] : null;
		const inByStep = Math.abs(semi - before) <= STEP_SEMITONES;
		const outByStep =
			after !== null && Math.abs(after - semi) <= STEP_SEMITONES;
		// **順次で入るか順次で出るか、どちらかを満たせば通す。** 両方を要求すると
		// ファ・シが実測7%まで減り、参考曲の23%に遠く届かない。半音の動きも
		// 一緒に消えてしまう（隣接音程の1半音が 9%→3% に落ちていた）。
		if (inByStep || outByStep) continue;
		// 短い弱拍の音は通り過ぎるだけなので、そのまま通す。ここまで縛ると
		// 「ペンタトニックをなぞるだけ」になって、今度は別の単調さが出る。
		if (!slots[i].isStrong && slots[i].value <= shortSteps) continue;
		const up = clampSemi(walk(semi, 1), MELODY_LOW, MELODY_HIGH);
		const down = clampSemi(walk(semi, -1), MELODY_LOW, MELODY_HIGH);
		// ファの隣はミとソ、シの隣はラとド。どちらもペンタトニックの音になる。
		const score = (s: number): number =>
			(isNonPentatonic(s) ? -4 : 0) +
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
 * ハ長調のピッチクラス。ここに無い音が「調の外の音（変化音）」。
 */
const DIATONIC_PCS = new Set(MAJOR_SCALE.map((d) => d.semi));

/**
 * ピッチクラス → 五度圏インデックス。**上行の変化音はシャープ、下行はフラット**で
 * 綴る（C→C#→D と上がるならド・ド#・レ、E→Eb→D と下がるならミ・ミb・レ）。
 * 綴りが要るのは31平均律で C# と Db が別の音になるためで、12平均律でも
 * ピアノロールの表示がこれで決まる。
 */
const SHARP_FIFTHS = [0, 7, 2, 9, 4, -1, 6, 1, 8, 3, 10, 5];
const FLAT_FIFTHS = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];

/** 音階上の音の綴り。変化音でない音はこちらで綴る。 */
const diatonicFifth = (semi: number): number =>
	degreeToPitch(semitoneToDegree(semi)).fifth;

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
 * 調の外の音（変化音）を通す。**メロディの音を作り終えた最後に掛ける。**
 *
 * ## なぜ要るか
 *
 * ここまでの生成は音階の度数（{@link MAJOR_SCALE}）だけで組み立てていて、
 * {@link nearestChordTone} が `E7` の `G#` を返しても `semitoneToDegree` が
 * その場で `G` か `A` へ丸めていた。結果、**生成物の非ダイアトニック音は
 * 実測で1音も無い**（40曲・約4000音を測って0%）。参考曲91本は音数比で
 * 中央値4%・p75で11%あり、ここが「調が固定に聞こえる」の実体だった。
 *
 * セカンダリドミナントを進行に入れておきながらメロディがその変化音を採れないと、
 * `E7` の上で `G` を鳴らす（和音の `G#` と半音でぶつかる）か、避けて `A` へ
 * 逃げるかしかない。**進行だけ借りて旋律が付いていっていない**状態になる。
 *
 * ## 何を通すか
 *
 * - **和音の変化音**（`E7` の `G#`、`D7` の `F#`、`A7` の `C#`、`Bm7-5` の `F`）。
 *   強拍と長い音で、半音〜全音以内にあるときだけ寄せる。ここが泣きメロの芯になる。
 * - **半音の経過音**。全音で隣り合う2音の間を、短い弱拍で半音ずつ通り抜ける。
 * - **半音のアプローチ**。強拍の音へ、その半音下（上行時）から入る。
 *
 * どれも**弱拍・短い音でしか作らない**（和音の変化音を除く）ので、調の感じは
 * 壊れない。曲ごとに {@link MelodyStyle.chromaticAffinity} を引くので、
 * 変化音をまったく使わない曲も混ざる。
 */
const applyChromatic = (
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
		rnd: () => number;
	},
): void => {
	const last = pitches.length - 1;
	// ⓪ 和音構成音と同じ高さの音は、**その構成音の綴りで書く**。
	// `E7` の上のソ#を「ラのフラット」と綴ると、31平均律で別の音になってしまう。
	for (let i = 0; i < pitches.length; i++) {
		const tone = tones.find(
			(x) => pitchClass(x.semi) === pitchClass(pitches[i]),
		);
		if (tone) fifths[i] = tone.fifth;
	}
	// ① 和音の変化音を採る。
	const altered = tones.filter((t) => !DIATONIC_PCS.has(pitchClass(t.semi)));
	for (let i = 0; i < pitches.length; i++) {
		if (opts.keepLast && i === last) continue;
		if (!slots[i].isStrong && slots[i].value < opts.quarterSteps) continue;
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
	//
	// **必ず順次で入って順次で出る形にする。** 変化音を跳躍で掴んだり、変化音から
	// 跳んで離れたりすると、通り過ぎる音ではなく「調を外した音」として耳に残る。
	// 実測でその形が変化音の45%を占めていたので、前後どちらも2半音以内に収まる
	// 置き方（全音で入って半音で出る／半音で入って半音で出る）だけを作る。
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
		if (DIATONIC_PCS.has(pitchClass(target))) continue; // 変化音になる場合だけ
		if (target === before || target === after) continue;
		if (target < MELODY_LOW || target > MELODY_HIGH) continue;
		pitches[i] = target;
		fifths[i] = (dir > 0 ? SHARP_FIFTHS : FLAT_FIFTHS)[pitchClass(target)];
		lastAltered = i;
	}
};

/** 1回分の draw。点数を付けるのは呼び出し側（{@link evaluate}）の仕事。 */
type Draw = Omit<ComposeResult, "stats" | "drum"> & {
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

const draw = (
	options: ComposeOptions,
	resolvedKey: ResolvedComposeKey,
	rnd: () => number,
): Draw => {
	const stepsPerBar = options.stepsPerBar;
	const edo = options.edo === 31 ? 31 : 12;
	// 音価は192ステップ基準で書いてあるので、実際の stepsPerBar へ比率で写す。
	const scaleStep = (v: number): number =>
		Math.max(1, Math.round((Math.abs(v) * stepsPerBar) / BASE_STEPS_PER_BAR)) *
		Math.sign(v);
	/**
	 * リズム型を実際の stepsPerBar へ写す。**写した後の合計を必ず1小節に揃える。**
	 *
	 * 型は192ステップ基準で書いてあり、1音ずつ丸めると合計がずれる。既定の192では
	 * 割り切れるので表面化しなかったが、三連（1音16ステップ）のように192の約数でも
	 * 16分の倍数でもない音価を入れると、stepsPerBar が192以外のときに小節から
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
	// **どこがイントロで、どこがサビなのかを持つ。** これが無いと、どの小節も
	// 同じ密度・同じ音域で鳴り、聴き手が最初に掴む「セクションの切り替わり」が
	// 生まれない（{@link file://./compose-sections.ts} 参照）。
	const sectionPlan = buildSectionPlan(options.sections ?? DEFAULT_SECTIONS);
	const totalBars = sectionPlan.reduce((sum, s) => sum + s.bars, 0);

	// 約35%の曲でセクションごとの曲中転調（ラスサビ転調・Bメロ転調）を入れる。
	// 伴奏トラックは rootShift が曲全体に掛かるため、曲中の調変化は各小節のコード名を移調し、
	// メロディ・サブメロ・ベースの各トラックもそのセクションの小節だけ音高をシフトする。
	if (rnd() < 0.35) {
		const modType = pick<"chorus_up" | "prechorus_down">(
			["chorus_up", "chorus_up", "prechorus_down"],
			rnd,
		);
		if (modType === "chorus_up") {
			// サビで +1 半音（または +2 半音）転調して盛り上げる（J-POP/ボカロの王道）
			const shift = pick([1, 1, 2], rnd);
			let lastChorusIdx = -1;
			for (let i = 0; i < sectionPlan.length; i++) {
				if (sectionPlan[i].kind === "chorus") lastChorusIdx = i;
			}
			if (lastChorusIdx >= 0) {
				for (let i = lastChorusIdx; i < sectionPlan.length; i++) {
					sectionPlan[i].keyShift = shift;
				}
			}
		} else {
			// Bメロで一時的に転調（-2 長2度下 または +3 短3度上）して陰影を付け、サビで主調に戻る
			const shift = pick([-2, 3], rnd);
			for (const s of sectionPlan) {
				if (s.kind === "prechorus") s.keyShift = shift;
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
	// **セクションごとに進行を割り当てる。** Aメロ系は progA、サビ系は progB。
	// イントロがサビの和音で始まるのは「曲の顔を先に見せる」定石で、
	// 間奏も同じ理由でサビ側を使う。
	// ベース調が長調／短調に指定されている場合は進行をそれに合わせる。
	const progAPool =
		resolvedKey.mode === "major"
			? SECTION_A_PROGRESSIONS.filter((p) => !p[0].startsWith("Am"))
			: resolvedKey.mode === "minor"
				? SECTION_A_PROGRESSIONS.filter((p) => p[0].startsWith("Am"))
				: SECTION_A_PROGRESSIONS;
	const progA = pick(progAPool, rnd);
	// サビはAメロと質感を変えるのが役目なので、同じ進行を引いたら引き直す。
	const progBPool = SECTION_B_PROGRESSIONS.filter(
		(p) => p.join("|") !== progA.join("|"),
	);
	const progB = pick(progBPool, rnd);
	const tonic = progA[0].startsWith("Am") ? "Am" : "C";
	/** ドミナントで終わる4小節（Bメロの末尾＝サビへの助走に使う）。 */
	const progHalf = pick(SECTION_A2_DERIVATIONS, rnd)(progA);
	/** 主音で終わる4小節（セクションの締めに使う）。 */
	const progFull = pick(SECTION_A3_DERIVATIONS, rnd)(progA, tonic);
	const progression: string[] = [];
	for (const section of sectionPlan) {
		const base = section.spec.progression === "b" ? progB : progA;
		for (let i = 0; i < section.bars; i += 4) {
			const isLastPhrase = i + 4 >= section.bars;
			// セクションの最後の4小節は、そのセクションの役目に合わせて締める。
			// Bメロは半終止（ドミナント）でサビへ渡し、サビとアウトロは全終止。
			if (!isLastPhrase) {
				progression.push(...base);
				continue;
			}
			if (section.kind === "prechorus") progression.push(...progHalf);
			else if (section.kind === "chorus" || section.kind === "outro")
				progression.push(...progFull);
			else progression.push(...base);
		}
	}
	progression.length = totalBars;
	// 伴奏トラック用のコード文字列。転調セクションはコード名そのものを移調して出力する。
	const chordProgression = progression
		.map((chord, bar) => transposeChordName(chord, barKeyShift[bar]))
		.join("|");
	const chordPattern = pick(CHORD_PATTERNS, rnd);
	// 調とテンポも曲ごとに引く。生成はハ長調で行い、最後にまとめて移調する
	// （生成中に移調すると音域の折り返しが調ごとにずれ、輪郭が壊れる）。
	const rootShift = resolvedKey.rootShift;
	const bpm = pick(BPM_CHOICES, rnd);

	// --- 曲の骨格と書法を引く（ここが曲どうしの違いの出どころ） ---
	// **A' と A'' は A の再現。** 初版は4つのセクションすべてを独立に引いていたため、
	// 「A-A'-B-A''」という名前とは裏腹に、実際には16小節ぶん別々の melodie が並んで
	// いるだけだった。聴き手はどこにも同じフレーズの再来を見つけられず、
	// 「毎小節ちがう音が流れているだけ」＝いかにも自動生成、という印象になる。
	//
	// **16小節 = 4つの小楽節（4小節）= 8つの楽句（2小節）。**
	//
	// 解説はどれも「モチーフは2小節、それを繰り返して4小節の小楽節、
	// 小楽節を AABA / AAAB / ABAB で並べて曲にする」と書いている。
	// 初版はここが1小節単位で、小節ごとに motif/step/run/hold の役割を配っていた。
	// 2小節のまとまりが無いので「同じフレーズが返ってきた」という手応えがどこにも
	// 生まれず、毎小節ちがう音が流れるだけになっていた。
	//
	// 各小楽節は【問い2小節】＋【答え2小節】。答えは問いと同じリズムを受けて
	// （同じリズムの繰り返し＝シーケンス）、着地音だけを変える。
	//
	//   小楽節1 問い→答え（半終止・まだ続く）
	//   小楽節2 問い→答え（一度落ち着く）
	//   小楽節3 サビ：オクターブ上の問い→答え
	//   小楽節4 問いの回帰→全終止（主音・白玉＋休符）
	// **楽句（2小節）はセクションの中で組む。**
	//
	// 各セクションは【問い2小節】＋【答え2小節】の小楽節を1〜2個持つ。
	// 8小節のセクション（Aメロ・サビ）は「問い→答え→問いの変形→答え」、
	// 4小節のセクション（Bメロ等）は「問い→答え」。
	// イントロと間奏はメロディを書かない（伴奏・ベース・ドラムだけが鳴る）。
	type Unit = {
		role: BarRole;
		/** どのモチーフを使うか。同じ素材の楽句は音の並びごと再現する。 */
		source: "a" | "a2" | "b" | "answer" | "silent";
		/** セクションの終わりの着地音（主音からの音階度数）。途中は null。 */
		landing: number | null;
		section: PlacedSection;
	};
	/**
	 * セクション → モチーフの素材。**BメロはサビともAメロとも違う顔でなければ
	 * ならない**ので、Aメロと同じ素材のセクエンツにする（まったく無関係な素材を
	 * 置くと、曲としての統一感が消える）。
	 */
	const sourceOf = (kind: SectionKind): "a" | "a2" | "b" =>
		kind === "chorus" || kind === "interlude"
			? "b"
			: kind === "prechorus"
				? "a2"
				: "a";
	const units: Unit[] = [];
	for (const section of sectionPlan) {
		const unitCount = Math.max(1, Math.round(section.bars / 2));
		const src = sourceOf(section.kind);
		for (let u = 0; u < unitCount; u++) {
			if (!section.spec.melody) {
				units.push({
					role: "hold",
					source: "silent",
					landing: null,
					section,
				});
				continue;
			}
			const isLast = u === unitCount - 1;
			if (u % 2 === 0) {
				// 問い。サビはオクターブ上げて聞かせどころにする。
				units.push({
					role:
						section.kind === "chorus"
							? "climax"
							: src === "a2" || u > 0
								? "sequence"
								: "motif",
					source: src,
					landing: null,
					section,
				});
			} else {
				// 答え。セクションの最後だけ、そのセクションの役目に応じて着地する。
				units.push({
					role: isLast && section.spec.landing === 0 ? "cadence" : "answer",
					source: "answer",
					landing: isLast ? section.spec.landing : null,
					section,
				});
			}
		}
	}
	const barRoles: BarRole[] = units.flatMap((u) => [u.role, u.role]);
	/** その小節が楽句のどちら側か（0=前半、1=後半）。輪郭の読み出し位置に使う。 */
	const barInUnit = (bar: number): number => bar % 2;
	const unitOf = (bar: number): number => Math.floor(bar / 2);

	/**
	 * その小節が、どの小節の再現か。**同じ素材の楽句は音の並びごと歌い直す。**
	 * これが「同じフレーズが返ってきた」という手応えの実体で、Aメロが2回出てくる
	 * のに毎回別の音だったら、セクションとして成立しない。
	 */
	const restatementOf = (bar: number): number | null => {
		const u = unitOf(bar);
		if (units[u].source === "silent") return null;
		for (let v = 0; v < u; v++) {
			if (units[v].source !== units[u].source) continue;
			if (units[v].role !== units[u].role) continue;
			// 答えどうしは着地音が違うので、後半の小節は再現しない。
			if (units[u].source === "answer" && barInUnit(bar) === 1) return null;
			return v * 2 + barInUnit(bar);
		}
		return null;
	};

	const style: MelodyStyle = {
		groove: pick<Groove>(["eighth", "sixteenth"], rnd),
		arcPeriod: pick([4, 8, 8, 16], rnd),
		arcPhase: pick([0, 1, 2], rnd),
		arcAmp: 3 + rnd() * 4,
		octaveAffinity: 0.14 + rnd() * 0.2,
		pentatonicMotif: rnd() < 0.55,
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
		// 人間の曲の跳躍率は p25〜p75 で 0.40〜0.55。上限が低いとその帯へ届かない。
		leapAffinity: 0.08 + rnd() * 0.3,
		// 4曲に1曲は変化音を使わない曲にする（調の外の音は曲の性格そのものなので、
		// 全曲に掛けると「どの曲も同じ味付け」になる）。
		chromaticAffinity: rnd() < 0.25 ? 0 : 0.15 + rnd() * 0.45,
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

	// --- ②リズム型を先に設計する ---
	//
	// **役割ごとに1つのリズム型を曲全体で使い回す。** 初版は隣り合う小節で必ず別の型を
	// 引いていたが、参考にした曲（作者自身の91曲）を測ると逆で、
	//
	//   自己相似 lag1  生成物 0.455 / 参考曲 0.483〜0.709
	//   自己相似 lag4  生成物 0.546 / 参考曲 0.569〜0.786
	//   音価のエントロピー 生成物 1.70 / 参考曲 0.62〜1.18
	//
	// と、**参考曲のほうがはるかに反復し、音価の種類も絞っている**。毎小節ちがう形を
	// 引くと、1曲の中では変化に富むが、曲どうしの区別が付かなくなる——どの曲も同じ
	// 「均等にばらけた」テクスチャになるため。曲の顔になるのは変化ではなく反復の型。
	// **モチーフは2小節。** 1小節の型を1つ引いて全部そこから作っていた頃は、
	// 「ボーカルが一息で歌いきる長さ」という言い回しの単位を持てていなかった。
	const motifPool = groovyCells(MOTIF_CELLS, style.groove, rnd);
	/**
	 * 曲ごとの「刻みの細かさ」の狙い（1小節あたりの音数）。
	 *
	 * **型をただ引くだけでは、曲の密度が引きの平均へ集まる。** 実測で生成物は
	 * 1小節 5.15音（参考曲 5.0〜7.3、中央値5.9）に張り付き、候補を40本引いても
	 * 中央値が1音も動かなかった——どの候補も同じ分布から引いているので、
	 * 選抜では密度は変えられない。**曲ごとに狙いの密度を先に決めて、それに近い型を
	 * 引く**ようにすると、曲どうしの差（詰め込んだ曲・空けた曲）も同時に出る。
	 */
	/**
	 * 曲ごとの「刻みの細かさ」の狙い（1小節あたりの音数）。
	 * 参考曲は中央値6.2（p25〜p75で5.4〜7.3）。狙いをこの帯に合わせる。
	 */
	const targetNotesPerBar = 5.5 + rnd() * 2.5;
	/**
	 * 曲ごとの休符率の狙い。参考曲は中央値0.09（p25〜p75で0.03〜0.16）。
	 * 短い息継ぎを中心にして、歌が程よく詰まるように寄せる。
	 */
	const targetRestRatio = 0.02 + rnd() * 0.1;
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
	 * 狙いの密度に近い型を引く。3本引いて一番近いものを採る——1本に絞ると
	 * 密度が同じ曲ばかりになるので、**寄せるだけで固定はしない**。
	 */
	const cellDistance = (c: RhythmCell): number =>
		Math.abs(cellNotes(c) - targetNotesPerBar) +
		Math.abs(cellRest(c) - targetRestRatio) * 8;
	const pickCell = (pool: RhythmCell[]): RhythmCell => {
		let best = pick(pool, rnd);
		for (let i = 0; i < 2; i++) {
			const c = pick(pool, rnd);
			if (cellDistance(c) < cellDistance(best)) best = c;
		}
		return best;
	};
	const motifCell = pickCell(motifPool);
	/** モチーフ2小節目。 */
	const motifCell2 =
		rnd() < 0.45
			? motifCell
			: pickCell(motifPool.filter((c) => c !== motifCell));
	/** 対照的な楽句（サビ用）のモチーフ。A と別の型を引く。 */
	const motifB = pickCell(
		motifPool.filter((c) => c !== motifCell && c !== motifCell2),
	);
	const motifB2 = pickCell(motifPool.filter((c) => c !== motifB));
	/** Bメロ（`a2`）のモチーフ。Aメロと同じ型を使い回さない。 */
	const motifA2 = pickCell(
		motifPool.filter(
			(c) => c !== motifCell && c !== motifCell2 && c !== motifB,
		),
	);
	const motifA22 =
		rnd() < 0.45 ? motifA2 : pickCell(motifPool.filter((c) => c !== motifA2));

	/**
	 * 応答・展開用のバリエーション型。
	 * 毎小節バラバラにはせず、基本のモチーフを反復しつつも、
	 * 小楽節の後半や答えの応答で適度な変化をつけてリズム型の種類数（参考曲中央値8）を満たす。
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
	 * 答えの後半小節。**フレーズの終わりは白玉で受けて息継ぎを空ける。**
	 */
	const breathCell = pick(
		RHYTHM_CELLS.filter(
			(c) => c.density === "sparse" && c.value.some((v) => v < 0),
		),
		rnd,
	);

	const barRhythms: number[][] = [];
	for (let bar = 0; bar < totalBars; bar++) {
		const u = unitOf(bar);
		const half = barInUnit(bar);
		const source = restatementOf(bar);
		if (source !== null) {
			// 同じ素材の楽句は、リズムもそのまま歌い直す。
			barRhythms.push(barRhythms[source]);
			continue;
		}
		const isB = units[u].source === "b";
		const isA2 = units[u].source === "a2";
		const isPrechorusEnd =
			units[u].section.kind === "prechorus" &&
			bar === units[u].section.startBar + units[u].section.bars - 1;

		if (isPrechorusEnd) {
			// Bメロの最後の小節はサビへのビルドアップ
			barRhythms.push(scaleCell(buildUpCell.value));
			continue;
		}

		/** その楽句が使う2小節ぶんのリズム型（前半・後半）。 */
		const pair = (): [RhythmCell, RhythmCell] =>
			isB
				? [motifB, motifB2]
				: isA2
					? [motifA2, motifA22]
					: [motifCell, motifCell2];
		let cell: RhythmCell;
		if (units[u].source === "answer") {
			// 答えは問いのリズムを受けて着地する。
			const isPeriodEnd = units[u].landing !== null;
			const prevSource = units[u - 1]?.source;
			const [head, tail] =
				prevSource === "b"
					? [motifB, motifB2]
					: prevSource === "a2"
						? [motifA2, motifA22]
						: [motifCell, motifCell2];
			// 答えの小節で、問いのリズムから適度に発展・応答するバリエーション
			const answerVar = prevSource === "b" ? motifBVar : motifVar;
			cell =
				half === 0
					? rnd() < 0.4
						? answerVar
						: head
					: isPeriodEnd
						? breathCell
						: rnd() < 0.35
							? answerVar
							: tail;
		} else {
			const [head, tail] = pair();
			cell = half === 0 ? head : tail;
		}
		barRhythms.push(scaleCell(cell.value));
	}

	// --- ③その上に音を乗せる ---
	// モチーフの輪郭は名前の付く形から引き、足りないぶんだけ曲ごとに伸ばす。
	const motifNoteCount =
		motifCell.value.filter((v) => v > 0).length +
		motifCell2.value.filter((v) => v > 0).length;
	const archetype = pick(MOTIF_ARCHETYPES, rnd);
	// **周回の継ぎ目を順次進行（±1 または 0）で滑らかに繋ぐ。**
	// 初版のように先頭へ機械的に戻すと、アーキタイプの末尾と先頭の間で大きな跳躍（5〜7半音）が
	// 生まれていた。前の周回の最後の音から滑らかに接続することで、旋律全体の順次進行比率が保たれる。
	const motifContour: number[] = [];
	let baseDegree = 0;
	for (let i = 0; i < motifNoteCount; i++) {
		const idx = i % archetype.length;
		if (i > 0 && idx === 0) {
			const lastVal = motifContour[i - 1];
			const connectShift = pick([-1, 0, 1], rnd);
			baseDegree = lastVal + connectShift - archetype[0];
		}
		motifContour.push(baseDegree + archetype[idx]);
	}

	/** 小節ごとに実際に使った音の並び（度数）。A' / A'' の再現で読み直す。 */
	const plannedDegrees: (number[] | null)[] = new Array(totalBars).fill(null);
	const melody: ComposedNote[] = [];
	const submelody: ComposedNote[] = [];
	const bass: ComposedNote[] = [];
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
	 * 小節内でメロディが鳴っていない区間を返す。合いの手（`answer`）を
	 * **メロディの隙間にだけ**置くのに使う。ここが取れるのは、リズムを音より先に
	 * 決めてあるおかげで `slots` に発音位置と長さが揃っているから。
	 */
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
		// **B部（9〜12小節）だけは3度・7度への着地を許す。** ルート・5度へ落とし続けると
		// 和音がいくら動いても緊張が上がらず、「サビで景色が変わる」効果が出ない
		// （実測で {@link TensionFeatures.rise} が 0.1 前後に張り付いていた）。
		const isSectionB = bar >= 8 && bar < 12;
		const headWeight: 2 | 3 = isSectionB ? 2 : style.barHeadWeight;
		// **大きな周期で上下させる。** 直前の音の近くへ着地させるだけだと、細かい
		// ジグザグはあっても曲全体では同じ高さをうろつき続ける（「津軽三味線」の
		// ように細かく動いているだけで、上げるフレーズ・下げるフレーズの交代が無い）。
		// 上げるメロディと下げるメロディを交互に置く、というのが歌モノの定石なので、
		// 小節ごとの目標の高さを曲単位の周期で振り、そこへ引き寄せる。
		const arc = Math.sin(
			((bar + style.arcPhase) / style.arcPeriod) * Math.PI * 2,
		);
		const arcCenter = MELODY_CENTER + arc * style.arcAmp;
		// 直前の音と目標の中間へ寄せる（いきなり飛ばず、数小節かけて上下する）。
		const headTarget = prevSemi + (arcCenter - prevSemi) * 0.5;
		const headSemi = nearestChordTone(
			headTarget,
			tones,
			headWeight,
			isSectionB,
		).semi;
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
			motifContour,
			semitoneToDegree(headSemi),
			contourOffset,
			repeatShift,
			headWeight,
			isSectionB,
			quarterSteps,
			rnd,
		);
		// 再現の小節は、元の小節の音の並びをそのまま使う。和音が違っても
		// **音を曲げず、塊ごと移調して**合わせる（{@link fitMotif}）ので、
		// 同じフレーズが返ってきたと耳で分かる。
		const source = restatementOf(bar);
		if (source !== null && plannedDegrees[source])
			degrees.splice(
				0,
				degrees.length,
				...(plannedDegrees[source] as number[]),
			);
		// 楽句の最後の小節は、着地音を決めて終わる（半終止／全終止）。
		const landing = units[unitOf(bar)].landing;
		if (landing !== null && barInUnit(bar) === 1) landOn(degrees, landing);
		plannedDegrees[bar] = [...degrees];

		// モチーフ系と再現の小節は「塊ごと移調して輪郭を保つ」、それ以外は従来どおり
		// 1音ずつ和音へ寄せる。フックは形が変わらないことに意味がある。
		const isMotifBar =
			source !== null ||
			role === "motif" ||
			role === "sequence" ||
			role === "climax" ||
			role === "answer";
		const pitches = shapeBar(
			isMotifBar
				? fitMotif(
						degrees,
						slots,
						tones,
						prevSemi,
						quarterSteps,
						style.pentatonicMotif,
					)
				: degrees,
			slots,
			tones,
			prevSemi,
			{
				allowLeap: role === "climax",
				allowArpeggio:
					role === "climax" ||
					(role === "run" && style.runShape === "broken") ||
					(role === "cadence" && style.cadenceShape !== "descend"),
				quarterSteps,
				// モチーフの小節はオクターブ移動を入れない。モチーフは輪郭が命なので、
				// 後から音を1つ跳ばすと「同じフレーズが返ってきた」と分からなくなる。
				// モチーフ側は {@link MOTIF_ARCHETYPES} が自前でオクターブを持つ。
				// モチーフ・セクエンツ・サビの小節はオクターブ移動を入れない
				// （輪郭が命なので、後から音を1つ跳ばすと同じフレーズと分からなくなる）。
				// 答えの小節は輪郭を借りているだけなので許す。
				octaveAffinity:
					role === "motif" || role === "sequence" || role === "climax"
						? 0
						: style.octaveAffinity,
				chromaticAffinity: style.chromaticAffinity,
				rnd,
				preserveContour: isMotifBar,
			},
		);

		if (landing !== null && barInUnit(bar) === 1) landPitch(pitches, landing);

		// **最後に変化音を通す。** ここまでの音は全部ハ長調の音階の上にあり、
		// セカンダリドミナントの上でも和音の変化音を採れていなかった
		// （実測で非ダイアトニック音が1音も出ない＝調が固定に聞こえる原因）。
		const fifths = pitches.map(diatonicFifth);
		applyChromatic(pitches, fifths, slots, tones, {
			affinity: style.chromaticAffinity,
			quarterSteps,
			shortSteps: scaleStep(EIGHTH),
			keepLast: landing !== null && barInUnit(bar) === 1,
			rnd,
		});

		// **イントロと間奏はメロディを書かない。** ここに歌メロを置くと、
		// どのセクションも同じ顔になり「ずっと歌っている曲」になってしまう。
		// 伴奏・ベース・ドラム（とサブメロ）は鳴るので、無音にはならない。
		const silent = units[unitOf(bar)].source === "silent";

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
			if (role !== "climax") {
				const gap = Math.abs(semi - prevSemi);
				maxLeap = Math.max(maxLeap, gap);
				intervals++;
				if (gap > STEP_SEMITONES) leaps++;
				else if (gap > 0) steps++;
			}
			const slot = slots[i];
			if (silent) {
				prevSemi = semi;
				continue;
			}
			if (!DIATONIC_PCS.has(pitchClass(semi))) chromaticNotes++;
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
		// 役割推定の都合で「単音・低密度・長音価」に縛られていた制約は外れた
		// （`daw.ts` が simple モードでトラックIDを役割として使うようになったため）。
		// 単音であることだけは守る——ピアノロールの1トラックは単旋律を前提にしていて、
		// 和音にすると重なり判定やレガート処理が壊れる。
		const melodyRising = prevSemi >= barHead;
		const subDir = melodyRising ? -1 : 1; // 反行（contrary motion）
		// 役割ごとに書法を差し替える。終止は和音を支える、緩む小節は保続音、
		// それ以外は曲ごとに引いた書法をそのまま使う。
		// メロディが休んでいる区間が8分2つぶん以上あるなら、曲の書法によらず
		// **その小節だけ合いの手にする**。書法を曲単位で1つに固定していたころは、
		// 6分の1の曲しか合いの手を持たず、サブメロがほぼ常にメロディと重なっていた
		// （実測で {@link StructureFeatures.complementarity} が 0.11）。
		// ハモリはメロディと重なるのが正しい書法なので、そこだけは差し替えない。
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
							i === 0 ? subSemi : walk(subSemi, subDir),
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
							: walk(subSemi, subDir * (index % 2 === 0 ? 1 : -1)),
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
			pushSub(scaleStep(DOT_HALF), scaleStep(QUARTER), walk(subSemi, subDir));
		} else if (role === "cadence") {
			// 終止だけは和音を支えたいので小節を通して伸ばす。
			pushSub(0, stepsPerBar, subSemi);
		} else {
			// pad。1拍空けてから3拍伸ばす。ここも小節頭を空けて、メロディの
			// 打ち出しとぶつからないようにする。
			pushSub(scaleStep(QUARTER), scaleStep(DOT_HALF), subSemi);
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
		// 音の強弱・切り方・ゴーストは、この小節ぶんを組み立ててから後段でまとめて付ける。
		const barBass: ComposedNote[] = [];
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
			const k = barKeyShift[bar];
			const fifthShift =
				k === 0 ? 0 : SEMITONE_TO_FIFTH_SHIFT[((k % 12) + 12) % 12];
			barBass.push({
				startStep: barStart + bassCursor,
				pitchUnits: spelledToUnits(semi + k, fifth + fifthShift, edo),
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
			(style.bassStyle === "eighth" ||
				style.bassStyle === "octave" ||
				style.bassStyle === "alternate")
		)
			for (const n of barBass)
				if (n.durationSteps >= 2 && n.durationSteps < quarterSteps * 2)
					n.durationSteps = Math.max(1, Math.round(n.durationSteps / 2));

		// ゴーストノート（デッドノート）。強拍の直前に、弦に触れて音程を殺した打点を
		// 1つだけ挟む。実際のベーシストがグルーヴを作るときの常套手段で、
		// 「音符と音符の間に何も無い」打ち込み臭さが一番よく消える。
		// velocity を極端に低くすることで、再生側のベロシティ→明るさ連動
		// （SoundFont の bassBrightness*）がカットオフを1kHz付近まで落とし、
		// 音程感の薄いくぐもった打点になる——これがデッドノートの実体。
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

	// **後処理で小節線をまたがせない。** 一時期ここで弱起とタイを入れていたが、
	// 参考にした曲を 192ステップの格子へ量子化して測り直すと、**小節線をまたぐ音も
	// 16分格子から外れる音も、どちらも中央値0%**だった。以前「またぎ3.5%・格子外24%」
	// と読んだのは、量子化せずに生のtickで測っていたためで、演奏上の微妙なズレと
	// tickの丸めを拾っていただけだった。この様式のメロディは格子の上に乗っている。

	/** ノート列が使った音域（半音）。 */
	const range = (notes: ComposedNote[]): number => {
		if (notes.length === 0) return 0;
		const us = notes.map((n) => n.pitchUnits);
		return (Math.max(...us) - Math.min(...us)) / UNITS_PER_SEMITONE;
	};

	// 曲全体を同じ量だけずらす。units は絶対音高なので、綴りの関係は保たれたまま動く。
	const shiftUnits = semitonesToUnits(rootShift, edo);
	if (shiftUnits !== 0)
		for (const list of [melody, submelody, bass])
			for (const n of list) n.pitchUnits = (n.pitchUnits + shiftUnits) as Units;

	return {
		chordProgression,
		chordPattern,
		rootShift,
		keyName: resolvedKey.keyName,
		keyLabel: resolvedKey.keyLabel,
		moodLabel: resolvedKey.moodLabel,
		bpm,
		sections: sectionPlan,
		bars: totalBars,
		melody,
		submelody,
		bass,
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
	const tension = tensionFeatures(d.barTension);
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
	 * コーパスから採った項目は**中央値へ寄っているほど高い点**にする。
	 * 帯（p25〜p75）を一律に満点にしていた頃は、全項目が帯の端へ同時に寄った曲
	 * ——スカスカで跳ねてばかりの曲——も満点を取れていた（{@link centeredBand}）。
	 */
	const atc = (key: keyof typeof CORPUS_BANDS, v: number): number =>
		centeredBand(v, CORPUS_BANDS[key], CORPUS_MEDIANS[key]);
	const scoreBreakdown: Record<string, number> = {
		entropy: atc("entropy", entropy),
		valueKinds: atc("valueKinds", valueKinds),
		restRatio: atc("restRatio", restRatio),
		leapRatio: atc("leapRatio", d.leapRatio),
		maxLeap: atc("maxLeap", d.maxLeap),
		melodyRange: atc("melodyRange", d.melodyRange),
		notesPerBar: atc("notesPerBar", density.notesPerBar),
		shortNoteRatio: atc("shortNoteRatio", density.shortNoteRatio),
		stepRatio: atc("stepRatio", d.stepRatio),
		chromaticRatio: atc("chromaticRatio", d.chromaticRatio),
		sim1: atc("sim1", structure.sim1),
		sim2: atc("sim2", structure.sim2),
		sim4: atc("sim4", structure.sim4),
		sim8: atc("sim8", structure.sim8),
		phraseBreath: atc("phraseBreath", structure.phraseBreath),
		climaxPosition: atc("climaxPosition", structure.climaxPosition),
		climaxPeaks: at(HAND_BANDS.climaxPeaks, structure.climaxPeaks),
		complementarity: at(HAND_BANDS.complementarity, structure.complementarity),
		subDensity: at(HAND_BANDS.subDensity, d.submelody.length / d.bars),
		tensionRise: tension.rise,
		tensionResolve: tension.resolve,
		novelty,
	};

	let weighted = 0;
	let weightSum = 0;
	for (const [key, weight] of Object.entries(WEIGHTS)) {
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
 * 16小節の曲を組み立てる。
 *
 * {@link DRAW_COUNT} 本の候補を引き、**ハード制約（{@link HARD}）に触れたものだけを捨てて、
 * 残りから一番点数の高いものを返す**。初版は「しきい値を全部満たした最初の1本」を
 * 返していたが、それでは
 *
 * - 構造が良くても休符率が0.09なら捨てる（好みを表現できない）
 * - しきい値さえ満たせば1本目で確定する（より良い候補を探しに行かない）
 *
 * という2つの問題があった。全滅した場合も点数最大のものを返すので、
 * 「ボタンを押して何も起きない」状態にはならない。
 *
 * 較正済みの目標帯（{@link CORPUS_BANDS}、人間の曲 {@link CORPUS_SIZE} 本から実測）を
 * 使うので、点数は「人間の曲として普通の範囲にどれだけ収まっているか」を意味する。
 */
export const composeSong = (options: ComposeOptions): ComposeResult => {
	const rnd = options.random ?? Math.random;
	const recent = options.recent ?? [];
	const count = Math.max(1, options.drawCount ?? DRAW_COUNT);
	const resolvedKey = resolveComposeKey(options.baseKey, rnd);

	let best: ComposeResult | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	let bestIsValid = false;
	let rejected = 0;

	for (let attempt = 1; attempt <= count; attempt++) {
		const d = draw(options, resolvedKey, rnd);
		const { stats, ok } = evaluate(d, recent);
		if (!ok) rejected++;
		// ハード制約を通った候補は、通らなかった候補より必ず優先する。
		const better = ok === bestIsValid ? stats.score > bestScore : ok;
		if (!better) continue;
		bestScore = stats.score;
		bestIsValid = ok;
		best = {
			// ドラムは勝った候補にだけ後から付ける（メロディに依存しないので
			// 候補ごとに引いても採点は動かず、40本ぶん無駄になる）。
			drum: "",
			chordProgression: d.chordProgression,
			chordPattern: d.chordPattern,
			rootShift: d.rootShift,
			keyName: d.keyName,
			keyLabel: d.keyLabel,
			moodLabel: d.moodLabel,
			bpm: d.bpm,
			sections: d.sections,
			bars: d.bars,
			melody: d.melody,
			submelody: d.submelody,
			bass: d.bass,
			stats: { ...stats, attempts: attempt, rejected },
		};
	}

	// best は必ず入っている（候補を1本以上引いているため）。
	const result = best as ComposeResult;
	result.stats.attempts = count;
	result.stats.rejected = rejected;
	result.drum = pickBuiltinDrum(result, rnd);
	return result;
};

/**
 * 曲に合わせて組み込みドラムパターン（DRUM_PATTERNS のキー）を選ぶ。
 *
 * ドラムはメロディに依存しないので候補ごとに引く必要はないが、引き当てた曲と噛み合って
 * いないと目も当てられない（速い曲にスロードラム、など）。
 * テンポと刻みの細かさから絞ってから引く。
 */
const pickBuiltinDrum = (song: ComposeResult, rnd: () => number): string => {
	const eighth = BASE_STEPS_PER_BAR / 8;
	const short =
		song.melody.filter((n) => n.durationSteps <= eighth).length /
		Math.max(1, song.melody.length);

	const pool: string[] =
		song.bpm >= 150
			? ["4beat", "dance", "16beat", "disco"]
			: short >= 0.6
				? ["16beat", "dance", "4beat", "disco"]
				: song.bpm <= 110 && short < 0.4
					? ["bossa", "8beat"]
					: ["8beat", "4beat", "16beat"];
	return pick(pool, rnd);
};

// ============================================================
// 歌詞
// ============================================================

/**
 * 歌詞に使う語句の素。**意味のある歌詞は作らない**——文脈も情景も無いところから
 * 意味の通る詞は出せないし、出せたふりをするほうが害がある。ここが作るのは
 * 「メロディに正しく乗る、日本語として発音できる音の並び」で、詞そのものは
 * ユーザーが書き換える前提。歌詞欄に出るので、そのまま上書きできる。
 *
 * 母音で終わる開音節を主体にし、2〜3拍の語をまぜて単調な羅列にならないようにする。
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
 * メロディに乗る歌詞を作る。
 *
 * `lyrics.ts` の約束は **音符1つ ＝ 音節1つ**。伸ばし棒（`ー`）も1音節を占める
 * （直前の母音を引き継ぐ音として扱われる）ので、「長い音符に `ー` を足して伸ばす」
 * という書き方をすると音節が音符より多くなり、後半の歌詞が全部ずれる。
 * したがって **`ー` は音符を1つ消費する形でしか置かない**。
 *
 * 読点（`、`）だけは音符を消費せず、直前の音節に息継ぎフラグを立てる。
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
