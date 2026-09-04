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
import { CORPUS_BANDS, CORPUS_SIZE } from "./compose-corpus";
import {
	type Band,
	band,
	featureDistance,
	featureVector,
	type MetricNote,
	type StructureFeatures,
	structureFeatures,
	type TensionFeatures,
	tensionFeatures,
} from "./compose-metrics";
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
	complementarity: [0.05, 0.25, 0.7, 0.95] as Band,
	climaxPeaks: [0, 1, 2, 5] as Band,
} as const;

/** 1曲作るのに引く候補数。この中から一番点数の高いものを返す。 */
const DRAW_COUNT = 40;

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
 * テンポ（BPM）の候補。参考曲100本の実測は 中央値132・p25〜p75 が 126〜136 で、
 * その周辺を厚めに、外れたテンポも少し混ぜてある。初版はテンポを設定しておらず、
 * 全曲が既定値のままだった。
 */
const BPM_CHOICES = [
	88, 96, 104, 112, 120, 124, 126, 128, 130, 132, 132, 134, 136, 138, 142, 150,
	160, 174,
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
	// 16分グルーヴの曲用。**モチーフ自体が16分を持たないと、曲の顔にならない。**
	// モチーフは曲中で最も多く鳴る型なので、ここに16分が無いと、16分は結局
	// 走句の小節だけに現れる「装飾」に留まってしまう。
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
	// **16分が主役の型。** 上の4つは16分を「混ぜて」いるので音価の種類が増え、
	// 音価エントロピーの目標帯（参考曲 0.62〜1.18）から外れて候補選抜で負ける。
	// 実測で16分を使う曲が30曲中1曲まで減った。16分が大半を占める形なら
	// 「1つの音価が支配的」になるのでエントロピーは低いままで、16分の曲が
	// ちゃんと選ばれるようになる。
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
const ANSWER_FIGURES: number[][] = [
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
	/** 曲のテンポ（BPM）。 */
	bpm: number;
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
	/** 曲全体の基準音価。16分を使う曲かどうかを曲単位で決める。 */
	groove: Groove;
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
	/** この小節で強拍に着地させる構成音の重み下限。B部だけ緩める。 */
	barHeadWeight: 2 | 3,
	/** 強拍で和音の色を出す音（3度・7度）を優先するか。B部だけ true。 */
	preferColor: boolean,
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
			nearestChordTone(
				degreeToPitch(out[i]).semi,
				tones,
				barHeadWeight,
				preferColor,
			).semi,
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

/** 1回分の draw。点数を付けるのは呼び出し側（{@link evaluate}）の仕事。 */
type Draw = Omit<ComposeResult, "stats"> & {
	melodyDurations: number[];
	restSteps: number;
	totalSteps: number;
	maxLeap: number;
	leapRatio: number;
	melodyRange: number;
	submelodyRange: number;
	/** 小節ごとの緊張度（0〜1）。{@link tensionFeatures} の材料。 */
	barTension: number[];
	stepsPerBar: number;
};

const draw = (options: ComposeOptions, rnd: () => number): Draw => {
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
	// 調とテンポも曲ごとに引く。生成はハ長調で行い、最後にまとめて移調する
	// （生成中に移調すると音域の折り返しが調ごとにずれ、輪郭が壊れる）。
	const rootShift = pick(ROOT_SHIFTS, rnd);
	const bpm = pick(BPM_CHOICES, rnd);

	// --- 曲の骨格と書法を引く（ここが曲どうしの違いの出どころ） ---
	const barRoles: BarRole[] = [
		...pick(SECTION_FORMS.a, rnd),
		...pick(SECTION_FORMS.a2, rnd),
		...pick(SECTION_FORMS.b, rnd),
		...pick(SECTION_FORMS.a3, rnd),
	];
	const style: MelodyStyle = {
		groove: pick<Groove>(["eighth", "sixteenth"], rnd),
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
		leapAffinity: 0.15 + rnd() * 0.4,
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
			["pad", "long-short", "answer", "harmony", "counter", "pedal"],
			rnd,
		),
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
	const motifCell = pick(groovyCells(MOTIF_CELLS, style.groove, rnd), rnd);
	// モチーフの変奏（逆行）は1曲に1回程度に留める。初版は6割の曲で使っていて、
	// これも音価のばらけ（エントロピー過多）の一因だった。
	const motifRetro: RhythmCell = {
		value: [...motifCell.value].reverse(),
		density: motifCell.density,
	};
	const useRetro = rnd() < 0.3;
	/** つなぎの小節にモチーフのリズムを流用するか。曲ごとに引く。 */
	const stepUsesMotif = rnd() < 0.55;

	/** 役割 → その曲でその役割に使うリズム型。曲の「リズムの顔」になる。 */
	const cellByRole = new Map<BarRole, RhythmCell>();
	const cellFor = (role: BarRole): RhythmCell => {
		const cached = cellByRole.get(role);
		if (cached) return cached;
		const wanted =
			role === "run" ? "dense" : role === "hold" ? "sparse" : "medium";
		let pool = groovyCells(
			RHYTHM_CELLS.filter((c) => c.density === wanted),
			style.groove,
			rnd,
		);
		// 8分グルーヴの曲に「走句」が来たら、16分ではなく8分の細かい形で走る。
		// 16分を1小節だけ差し込むと、前後と繋がらない一発ネタになる（実測で
		// 16分を含む小節の100%が、前後に16分を持たない孤立した小節だった）。
		if (pool.length === 0)
			pool = RHYTHM_CELLS.filter((c) => c.density === "medium");
		// **モチーフの音価の語彙から、はみ出しの少ない型を選ぶ。**
		//
		// 役割ごとに無関係な型を引くと1曲の音価の種類が増えすぎる。参考曲91本の
		// 音価エントロピーは 0.62〜1.18 で、これは「種類が3〜5あるが、そのうち1つが
		// 大半を占める」状態を意味する。役割ごとに好き勝手な型を引くと種類が均等に
		// ばらけ、実測1.70まで上がっていた。均等にばらけた音価は「変化に富む」のでは
		// なく、**どの曲も同じのっぺりしたテクスチャ**になる。
		//
		// 「2つ以上共通していればよい」では緩すぎたので、**新しく持ち込む音価の数が
		// 最小の型**に絞る。
		const motifValues = new Set(motifCell.value.map(Math.abs));
		const novelty = (c: RhythmCell): number =>
			new Set(c.value.map(Math.abs).filter((v) => !motifValues.has(v))).size;
		const fewest = Math.min(...pool.map(novelty));
		const kin = pool.filter((c) => novelty(c) === fewest);
		const cell = pick(kin.length > 0 ? kin : pool, rnd);
		cellByRole.set(role, cell);
		return cell;
	};

	// 対旋律のリズム。曲ごとに1つ引いて使い回す（サブメロにも「その曲の型」を持たせる）。
	const counterRhythm = pick(
		groovyCells(
			RHYTHM_CELLS.filter((c) => c.density === "medium"),
			style.groove,
			rnd,
		),
		rnd,
	).value;

	const barRhythms: number[][] = [];
	let motifSeen = 0;
	for (let bar = 0; bar < BARS; bar++) {
		const role = barRoles[bar];
		let cell: RhythmCell;
		if (role === "motif" || role === "sequence" || role === "climax") {
			motifSeen++;
			cell = useRetro && motifSeen === 3 ? motifRetro : motifCell;
		} else if (role === "step" && stepUsesMotif) {
			// **つなぎの小節でもモチーフのリズムを使う。** `step` は曲の半分近くを
			// 占める最頻の役割なので、ここに別の型を当てると音価の種類が一気に増える。
			// 参考曲の音価エントロピーは 0.62〜1.18 で、型を役割ごとに分けた時点の
			// 生成物（1.37）はまだ上振れしていた。同じ型が戻ってくることが
			// 「その曲らしさ」になる。
			cell = motifCell;
		} else {
			cell = cellFor(role);
		}
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
	/** 小節ごとの緊張度（0〜1）。和音が無い小節は0のまま。 */
	const barTension: number[] = new Array(BARS).fill(0);
	let restSteps = 0;
	let maxLeap = 0;
	let leaps = 0;
	let intervals = 0;
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
		// **B部（9〜12小節）だけは3度・7度への着地を許す。** ルート・5度へ落とし続けると
		// 和音がいくら動いても緊張が上がらず、「サビで景色が変わる」効果が出ない
		// （実測で {@link TensionFeatures.rise} が 0.1 前後に張り付いていた）。
		const isSectionB = bar >= 8 && bar < 12;
		const headWeight: 2 | 3 = isSectionB ? 2 : style.barHeadWeight;
		const headSemi = nearestChordTone(
			prevSemi,
			tones,
			headWeight,
			isSectionB,
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
			headWeight,
			isSectionB,
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
		barTension[bar] = tensionSteps === 0 ? 0 : tensionSum / tensionSteps;
		for (const value of rhythm) if (value < 0) restSteps += -value;

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
		const subStyle: SubStyle =
			role === "cadence"
				? "pad"
				: role === "hold"
					? "pedal"
					: gapSteps >= scaleStep(EIGHTH) * 2 && style.subStyle !== "harmony"
						? "answer"
						: style.subStyle;
		/** サブメロの1音を、和音の色が出る音（3度・7度）へ寄せて置く。 */
		const pushSub = (at: number, len: number, wantedSemi: number): number => {
			if (len <= 0 || at + len > stepsPerBar) return wantedSemi;
			const tone = nearestChordTone(wantedSemi, tones, 2);
			const semi = clampSemi(tone.semi, SUBMELODY_LOW, SUBMELODY_HIGH);
			submelody.push({
				startStep: barStart + at,
				pitchUnits: spelledToUnits(semi, tone.fifth, edo),
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

	// 曲全体を同じ量だけずらす。units は絶対音高なので、綴りの関係は保たれたまま動く。
	const shiftUnits = semitonesToUnits(rootShift, edo);
	if (shiftUnits !== 0)
		for (const list of [melody, submelody, bass])
			for (const n of list) n.pitchUnits = (n.pitchUnits + shiftUnits) as Units;

	return {
		chordProgression,
		chordPattern,
		rootShift,
		bpm,
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
	const opts = { stepsPerBar: d.stepsPerBar, bars: BARS };
	const structure = structureFeatures(
		toMetricNotes(d.melody),
		toMetricNotes(d.submelody),
		opts,
	);
	const tension = tensionFeatures(d.barTension);
	const fingerprint = featureVector({
		entropy,
		restRatio,
		leapRatio: d.leapRatio,
		melodyRange: d.melodyRange,
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
	const scoreBreakdown: Record<string, number> = {
		entropy: at(CORPUS_BANDS.entropy, entropy),
		valueKinds: at(CORPUS_BANDS.valueKinds, valueKinds),
		restRatio: at(CORPUS_BANDS.restRatio, restRatio),
		leapRatio: at(CORPUS_BANDS.leapRatio, d.leapRatio),
		maxLeap: at(CORPUS_BANDS.maxLeap, d.maxLeap),
		melodyRange: at(CORPUS_BANDS.melodyRange, d.melodyRange),
		sim1: at(CORPUS_BANDS.sim1, structure.sim1),
		sim2: at(CORPUS_BANDS.sim2, structure.sim2),
		sim4: at(CORPUS_BANDS.sim4, structure.sim4),
		sim8: at(CORPUS_BANDS.sim8, structure.sim8),
		phraseBreath: at(CORPUS_BANDS.phraseBreath, structure.phraseBreath),
		climaxPosition: at(CORPUS_BANDS.climaxPosition, structure.climaxPosition),
		climaxPeaks: at(HAND_BANDS.climaxPeaks, structure.climaxPeaks),
		complementarity: at(HAND_BANDS.complementarity, structure.complementarity),
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

	let best: ComposeResult | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	let bestIsValid = false;
	let rejected = 0;

	for (let attempt = 1; attempt <= count; attempt++) {
		const d = draw(options, rnd);
		const { stats, ok } = evaluate(d, recent);
		if (!ok) rejected++;
		// ハード制約を通った候補は、通らなかった候補より必ず優先する。
		const better = ok === bestIsValid ? stats.score > bestScore : ok;
		if (!better) continue;
		bestScore = stats.score;
		bestIsValid = ok;
		best = {
			chordProgression: d.chordProgression,
			chordPattern: d.chordPattern,
			rootShift: d.rootShift,
			bpm: d.bpm,
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
	return result;
};
