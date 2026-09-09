/**
 * 作曲で使う音階の定義。
 *
 * ## なぜ「中核音」と「主音の位置」だけで足りるのか
 *
 * `compose.ts` の旋律は、ハ長調の7音（`MAJOR_SCALE`）の**度数**で組み立ててから
 * 最後に半音へ落とす。この作りのまま音階を増やせるのは、**日本の伝統的な5音音階
 * （陽・民謡・律・都節・琉球）が4つともハ長調の7音の部分集合**だからで、違うのは
 *
 * - どの音を主音に置くか（{@link ComposeScale.tonic}）
 * - 7音のうちどの5音を旋律の柱にするか（{@link ComposeScale.core}）
 *
 * の2点しかない。チャーチモード（ドリアン等）も同じ2点で書ける。
 *
 * | 音階 | 主音 | 構成音 | 主音からの半音 |
 * |---|---|---|---|
 * | 陽 | ド | ド レ ミ ソ ラ | 0,2,4,7,9 |
 * | 民謡 | ラ | ラ ド レ ミ ソ | 0,3,5,7,10 |
 * | 律 | レ | レ ミ ソ ラ シ | 0,2,5,7,9 |
 * | 都節 | ミ | ミ ファ ラ シ ド | 0,1,5,7,8 |
 * | 琉球 | ド | ド ミ ファ ソ シ | 0,4,5,7,11 |
 *
 * 陽＝従来の長調、民謡＝従来の短調なので、**この2つは以前と完全に同じ挙動**になる
 * （`core` が昇順で `[0,1,2,4,5]`、`tonic` が 0 と 5）。
 *
 * ## 親音階を差し替える音階
 *
 * ハーモニックマイナー・ヒジャーズ・ハンガリアン・ブルースはハ長調に無いピッチクラスを
 * 含むので、上の2点では書けない。こちらは **{@link ComposeScale.parent} で音程集合
 * そのものを差し替える**。度数の計算は親音階の長さで回るので、6音のブルースも
 * そのまま乗る。
 *
 * | 音階 | 親の音程集合 | 主音 | 中核音 |
 * |---|---|---|---|
 * | ハーモニックマイナー | ド レ ミ ファ ソ♯ ラ シ | ラ | ラ ド レ ミ ソ♯ |
 * | ヒジャーズ | 同上 | ミ | ミ ファ ソ♯ ラ シ |
 * | ハンガリアン | ド レ♯ ミ ファ ソ♯ ラ シ | ラ | ラ ド レ♯ ミ ソ♯ |
 * | ブルース | ド ミ♭ ファ ソ♭ ソ シ♭ | ド | ド ミ♭ ファ ソ シ♭ |
 *
 * **親音階を差し替える音階は進行プールを必ず自前で持つ**（{@link ComposeScale.center}）。
 * ハ長調の和音をそのまま当てると、音階に無い音が伴奏から鳴って音階が壊れるため。
 */

/**
 * 音階の1つの音。`semi` は主音からの半音、`fifth` は五度圏インデックス
 * （C=0, G=1, D=2 … F=-1, B♭=-2 …）。**綴りを保持するために `fifth` を持つ**。
 * 31平均律で増4度と減5度、ソ♯とラ♭を区別するのに要る。
 */
export type ScaleDegree = { semi: number; fifth: number };

/**
 * ハ長調（イ短調も同じ音の集合で、主音の取り方だけが違う）。
 * 既定の親音階で、日本の5音音階もチャーチモードも全部この上に乗る。
 */
export const MAJOR_SCALE: ScaleDegree[] = [
	{ semi: 0, fifth: 0 }, // C
	{ semi: 2, fifth: 2 }, // D
	{ semi: 4, fifth: 4 }, // E
	{ semi: 5, fifth: -1 }, // F
	{ semi: 7, fifth: 1 }, // G
	{ semi: 9, fifth: 3 }, // A
	{ semi: 11, fifth: 5 }, // B
];

/**
 * 和声的短音階の音程集合（イ短調から見て A B C D E F G♯）。ハ長調の座標で書くので
 * ソがソ♯に入れ替わった形になる。
 *
 * **導音（ソ♯）を持つのがこの音階の全部**で、`E7 → Am` の引力はここから出る。
 * ファとソ♯の間が増2度（3半音）空くのが特徴で、旋律がそこを跨ぐと一気に
 * 「泣き」の響きになる。主音をラに取れば和声的短音階、ミに取ればヒジャーズ
 * （フリジアン・ドミナント）で、音の集合は同じ。
 */
export const HARMONIC_MINOR_SCALE: ScaleDegree[] = [
	{ semi: 0, fifth: 0 }, // C
	{ semi: 2, fifth: 2 }, // D
	{ semi: 4, fifth: 4 }, // E
	{ semi: 5, fifth: -1 }, // F
	{ semi: 8, fifth: 8 }, // G#
	{ semi: 9, fifth: 3 }, // A
	{ semi: 11, fifth: 5 }, // B
];

/**
 * ハンガリアン・マイナー（ジプシー音階）の音程集合（A B C D♯ E F G♯）。
 *
 * 和声的短音階のレをレ♯へ上げた形で、**増2度が2か所**（ド→レ♯、ファ→ソ♯）になる。
 * 音階の中で最も跳ねた響きを持つ代わりに、三和音がほとんど組めない
 * （{@link HUNGARIAN_CENTER} 参照）。
 */
export const HUNGARIAN_SCALE: ScaleDegree[] = [
	{ semi: 0, fifth: 0 }, // C
	{ semi: 3, fifth: 9 }, // D#
	{ semi: 4, fifth: 4 }, // E
	{ semi: 5, fifth: -1 }, // F
	{ semi: 8, fifth: 8 }, // G#
	{ semi: 9, fifth: 3 }, // A
	{ semi: 11, fifth: 5 }, // B
];

/**
 * ブルース音階（C E♭ F G♭ G B♭）。**この音階だけ6音**で、度数の計算が
 * 7で回らないことの試金石になっている。
 *
 * ソ♭がブルーノート。中核から外して経過音の位置に置くと、マイナーペンタの上を
 * 掠める本来の使われ方になる。伴奏は `C7`・`F7`・`G7` で長3度を鳴らすので、
 * **旋律の短3度と伴奏の長3度がぶつかる**——それがブルースの響きそのもの。
 */
export const BLUES_SCALE: ScaleDegree[] = [
	{ semi: 0, fifth: 0 }, // C
	{ semi: 3, fifth: -3 }, // Eb
	{ semi: 5, fifth: -1 }, // F
	{ semi: 6, fifth: -6 }, // Gb（ブルーノート）
	{ semi: 7, fifth: 1 }, // G
	{ semi: 10, fifth: -2 }, // Bb
];

/** 音階の識別子。 */
export type ComposeScaleId =
	| "yo"
	| "minyo"
	| "ritsu"
	| "miyakobushi"
	| "ryukyu"
	| "dorian"
	| "phrygian"
	| "lydian"
	| "mixolydian"
	| "harmonic_minor"
	| "hijaz"
	| "hungarian"
	| "blues";

/**
 * 主音のダイアトニック度数。0=ド, 1=レ, ..., 6=シ。
 * 進行プールはこの値で引く（{@link TONIC_CENTERS}）。
 */
export type TonicDegree = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ComposeScale = {
	id: ComposeScaleId;
	/** 表示名。 */
	label: string;
	/** 主音の度数（{@link ComposeScale.parent} の何番目か）。 */
	tonic: TonicDegree;
	/**
	 * 音程集合そのものの差し替え。省略時は {@link MAJOR_SCALE}（ハ長調の7音）。
	 *
	 * ここを差し替えると `degreeToPitch` の返す音が変わるので、**旋律だけでなく
	 * 順次進行・跳躍の埋め・着地音まで全部が新しい音程集合の上に乗る**。
	 * 長さは7でなくてよい（ブルースは6音）。
	 */
	parent?: ScaleDegree[];
	/**
	 * 旋律の柱にする5音（ダイアトニック度数）。主音から順に書く。
	 * ここに無い2音は「音階の外」として、和音構成音か経過音のときだけ通す。
	 */
	core: number[];
	/**
	 * 主和音が短三和音か。調性格（`COMPOSE_KEYS`）をどちら側から引くかに使う。
	 * 主音が短三和音を持つ音階に長調の調性格を当てると、説明と響きが食い違う。
	 */
	minorish: boolean;
	/**
	 * **中核音の外を厳しく締めるか。**
	 *
	 * `true` にすると、和音の構成音であっても中核の外なら隣へ逃がし、変化音も減らし、
	 * モチーフを必ず中核音の歩数で組み、ハモリも中核へ寄せる。
	 *
	 * 締めるのは、**中核の外が「音階に無い音」になる音階**だけ。
	 *
	 * - 律・都節・琉球 … 本物の5音音階。中核から外れた2音は音階に無い。琉球音階の
	 *   `F` と `G` はレとラを持っていて、そこを無条件に通すと**「レとラを抜く」という
	 *   音階の定義そのものが崩れる**（実測でレ8%・ラ6%が紛れ込んでいた）
	 * - ブルース … 中核外のソ♭は音階の中だが、**伴奏の `C7`・`F7`・`G7` が
	 *   音階に無い長3度を供給してくる**。締めないと旋律がそちらへ引かれ、
	 *   短3度で歌う／長3度で鳴るというブルースの構図が消える
	 *
	 * 締めないのは次の2つ。
	 *
	 * - 陽・民謡 … ファ・シを自由に使うのはJ-POPの実際の書法で、参考曲の実測値も
	 *   そちら（`compose.ts` の `applyPentatonic` 参照）。締めると従来の曲が変わる
	 * - モード・和声的短音階・ヒジャーズ・ハンガリアン … 7音音階なので、中核の5音は
	 *   旋律の柱を選んだだけ。残りの2音も立派な音階の構成音で、締める理由が無い
	 */
	strict: boolean;
	/**
	 * 進行プールの上書き。省略時は主音の位置から {@link TONIC_CENTERS} を引き、
	 * それも無ければ（主音がド／ラ）従来の長調・短調のプールを使う。
	 *
	 * **音程集合を差し替える音階（{@link ComposeScale.parent}）では必須。** ハ長調の
	 * 和音をそのまま当てると、音階に無い音が伴奏から鳴って音階が壊れる。
	 *
	 * **主音が同じでも音階が違えば使える和音が違う**ので、親が同じでもここが要る。琉球音階は
	 * 主音がドだが `Am`・`Dm` を使うとレとラが前に出てしまうし、都節音階と
	 * フリジアンはどちらも主音がミだが、`Am`（ラ・ド・ミ）が中核に収まるのは
	 * 都節だけ。
	 */
	center?: TonicCenter;
	/** どんな曲になるかの説明。UI のヒントに出す。 */
	description: string;
};

/**
 * 琉球音階（ド・ミ・ファ・ソ・シ）の進行。
 *
 * 主音はドだが、**従来の長調プールは使えない**。`Am`（ラ・ド・ミ）と `Dm`（レ・ファ・ラ）は
 * この音階が抜いているレとラを和音の根に据えてしまい、旋律がそこへ引っ張られる。
 * 沖縄の実際の曲がそうであるように I・IV・V の3和音を軸に組む。
 */
const RYUKYU_CENTER: TonicCenter = {
	tonic: "C",
	half: "G",
	deceptive: "Em",
	tonicPattern: /^C(?![#b]|m)/,
	a: [
		["C", "F", "G", "C"],
		["C", "C", "F", "G"],
		["F", "G", "C", "C"],
		["C", "G", "F", "G"],
		["CM7", "F", "G", "C"],
		["C", "F", "C", "G"],
		["C", "Em", "F", "G"],
		["F", "C", "G", "C"],
	],
	b: [
		["F", "G", "Em", "C"],
		["F", "G", "C", "G"],
		["G", "F", "C", "C"],
		["FM7", "G", "Em", "F"],
		["C", "G", "F", "C"],
		["F", "Em", "F", "G"],
	],
	c: [
		["Em", "F", "G", "C"],
		["F", "C", "G", "Em"],
		["C", "Em", "F", "G"],
	],
};

/**
 * 都節音階（ミ・ファ・ラ・シ・ド）の進行。
 *
 * **`F`（ファ・ラ・ド）と `Am`（ラ・ド・ミ）が音階の中に丸ごと収まる。** ここが
 * 同じ主音のフリジアン（ミ・ファ・ラ・シ・レ）との分かれ目で、あちらはドを持たない。
 * 主和音の `Em` はソを含んで音階から1音はみ出すので、`Esus4`（ミ・ラ・シ）を
 * 混ぜて濁りを薄める——5音音階に三和音を組もうとすると必ずどこかがはみ出す。
 */
const MIYAKOBUSHI_CENTER: TonicCenter = {
	tonic: "Em",
	half: "Am",
	deceptive: "F",
	tonicPattern: /^E(?:m|sus)/,
	a: [
		["Em", "F", "Em", "Em"],
		["Esus4", "F", "Esus4", "Em"],
		["Em", "Am", "F", "Em"],
		["Am", "Em", "F", "Em"],
		["Em", "F", "Am", "Em"],
		["Em", "Em", "F", "F"],
		["Am", "F", "Em", "Em"],
		["Em", "FM7", "Am", "Em"],
	],
	b: [
		["F", "Am", "Em", "Em"],
		["Am", "F", "Em", "Em"],
		["F", "Em", "Am", "Em"],
		["FM7", "Am", "F", "Em"],
		["Am", "Em", "F", "Am"],
		["F", "Am", "F", "Em"],
	],
	c: [
		["Am", "Em", "F", "Am"],
		["F", "Am", "Esus4", "Em"],
		["Am", "F", "Em", "Em"],
	],
};

/**
 * 律音階（レ・ミ・ソ・ラ・シ）の進行。
 *
 * **この音階には主和音の3度が無い。** レの3度はファで、律音階はファを持たない。
 * だから主和音は三和音ではなく `Dsus4`（レ・ソ・ラ）になる——雅楽や声明の
 * 響きが四度堆積で書かれるのはこれが理由で、無理に `Dm` を当てると
 * その場でファが鳴って音階が壊れる。`Em7`（ミ・ソ・シ・レ）は4音すべてが
 * 音階の中に収まる、この音階でいちばん厚く鳴らせる和音。
 */
const RITSU_CENTER: TonicCenter = {
	tonic: "Dsus4",
	half: "G",
	deceptive: "Em",
	tonicPattern: /^Dsus/,
	a: [
		["Dsus4", "G", "Dsus4", "Dsus4"],
		["Dsus4", "Em", "G", "Dsus4"],
		["G", "Dsus4", "Em", "Dsus4"],
		["Dsus4", "G", "Em", "G"],
		["Em", "G", "Dsus4", "Dsus4"],
		["Dsus4", "Em7", "G", "Dsus4"],
		["G", "Em", "Dsus4", "G"],
		["Dsus4", "Am", "G", "Dsus4"],
	],
	b: [
		["G", "Em", "Dsus4", "Dsus4"],
		["Em", "G", "Em", "Dsus4"],
		["G", "Am", "Em", "Dsus4"],
		["Em7", "G", "Dsus4", "Dsus4"],
		["Am", "G", "Em", "Dsus4"],
		["Dsus4", "Em", "G", "Em"],
	],
	c: [
		["Em", "Dsus4", "G", "Em"],
		["G", "Em7", "Am", "G"],
		["Am", "G", "Em", "Dsus4"],
	],
};

/**
 * 和声的短音階（主音ラ）の進行。**`E7 → Am` の全終止がこの音階の顔。**
 *
 * ソ♯を持つので `E7`（ミ・ソ♯・シ・レ）と `G#dim` が音階の中に丸ごと収まる。
 * 逆に `Am7`（ラ・ド・ミ・ソ）は使えない——ソが音階に無い。`AmM7`（ラ・ド・ミ・ソ♯）が
 * その代わりで、主和音に導音を重ねた独特の張りが出る。
 */
const HARMONIC_MINOR_CENTER: TonicCenter = {
	tonic: "Am",
	half: "E7",
	deceptive: "F",
	tonicPattern: /^Am/,
	a: [
		["Am", "Dm", "E7", "Am"], // i-iv-V7-i。和声的短音階の基本形
		["Am", "F", "E7", "Am"],
		["Am", "E7", "Am", "Am"],
		["Dm", "E7", "Am", "Am"],
		["Am", "AmM7", "Dm", "E7"], // 主和音に導音を重ねたクリシェ
		["Am", "F", "Dm", "E7"],
		["F", "E7", "Am", "Am"],
		["Am", "Bm7-5", "E7", "Am"],
	],
	b: [
		["Dm", "E7", "Am", "Am"],
		["F", "E7", "Am", "E7"],
		["Dm7", "G#dim", "Am", "E7"],
		["F", "Dm", "E7", "Am"],
		["Am", "Dm", "Bm7-5", "E7"],
		["FM7", "E7", "Am", "Am"],
	],
	c: [
		["Dm", "Am", "Bm7-5", "E7"],
		["F", "C+", "Dm", "E7"],
		["Am", "F", "Dm", "E7"],
	],
};

/**
 * ヒジャーズ／フリジアン・ドミナント（主音ミ）の進行。和声的短音階と音の集合は
 * 同じで、主音をミに取ったもの。
 *
 * **`E`（ミ・ソ♯・シ）と `F`（ファ・ラ・ド）の往復がこの音階の顔。** 主音のすぐ上が
 * 半音で、しかも主和音が長三和音という組み合わせが、中東・スパニッシュの
 * あの響きを作る。`E → Am` へ解決させると和声的短音階に聞こえてしまうので、
 * **どの候補も `E` で終える**。
 */
const HIJAZ_CENTER: TonicCenter = {
	tonic: "E",
	half: "F",
	deceptive: "Am",
	tonicPattern: /^E(?![#b]|m)/,
	a: [
		["E", "F", "E", "E"], // I-♭II。ヒジャーズの顔
		["E7", "F", "E", "E"],
		["Am", "F", "E", "E"],
		["E", "F", "Dm", "E"],
		["F", "E", "F", "E"],
		["Dm", "E", "F", "E"],
		["E7", "Am", "F", "E"],
		["E", "Dm", "F", "E"],
	],
	b: [
		["F", "E", "Am", "E"],
		["Dm", "C+", "F", "E"],
		["Am", "Dm", "F", "E"],
		["F", "Dm", "E", "E"],
		["E7", "F", "Dm", "E"],
		["Bm7-5", "E7", "Am", "E"],
	],
	c: [
		["Am", "Dm", "F", "E"],
		["Dm", "Am", "F", "E7"],
		["F", "C+", "Dm", "E"],
	],
};

/**
 * ハンガリアン・マイナー（主音ラ）の進行。
 *
 * **この音階では三和音がほとんど組めない。** レがレ♯に、ソがソ♯に上がっているので、
 * ハ長調のダイアトニック和音のうち生き残るのは `Am`・`E`・`F` の3つだけ。
 * 代わりに `AmM7`（ラ・ド・ミ・ソ♯）・`Fm`（ファ・ラ♭・ド＝ファ・ソ♯・ド）・
 * `C+`（ド・ミ・ソ♯）が音階の中に収まるので、そちらで色を付ける。
 * `E7` は使えない——7度のレが音階に無い（レ♯しかない）。
 */
const HUNGARIAN_CENTER: TonicCenter = {
	tonic: "Am",
	half: "E",
	deceptive: "F",
	tonicPattern: /^Am/,
	a: [
		["Am", "E", "Am", "Am"],
		["Am", "F", "E", "Am"],
		["Am", "AmM7", "F", "E"],
		["F", "E", "Am", "Am"],
		["Am", "Fm", "E", "Am"], // ♭VIm。増2度を和音の側でも鳴らす
		["Am", "E", "F", "E"],
		["FM7", "E", "Am", "Am"],
		["Am", "C+", "F", "E"],
	],
	b: [
		["F", "E", "Am", "E"],
		["Fm", "E", "Am", "Am"],
		["Am", "F", "C+", "E"],
		["FM7", "Am", "F", "E"],
		["E", "F", "E", "Am"],
		["Am", "AmM7", "Fm", "E"],
	],
	c: [
		["F", "Am", "Fm", "E"],
		["C+", "F", "Am", "E"],
		["Am", "Fm", "F", "E"],
	],
};

/**
 * ブルース（主音ド）の進行。**12小節ブルースを4小節ずつに割った形**で持つ。
 *
 * 伴奏は3つとも属7の和音（`C7`・`F7`・`G7`）で、これらは長3度を含むから
 * 音階の外の音を鳴らす。**それでいい**——短3度で歌う旋律と長3度で鳴る伴奏が
 * ぶつかるのがブルースの響きで、ここを「揃える」と、ただのマイナーペンタの曲になる。
 * 旋律の側は {@link ComposeScale.strict} で音階に留める。
 */
const BLUES_CENTER: TonicCenter = {
	tonic: "C7",
	half: "G7",
	deceptive: "F7",
	tonicPattern: /^C7/,
	a: [
		["C7", "C7", "C7", "C7"], // 12小節ブルースの1〜4小節
		["C7", "F7", "C7", "C7"],
		["C7", "C7", "F7", "F7"],
		["F7", "F7", "C7", "C7"], // 5〜8小節
		["C7", "F7", "C7", "G7"],
		["C7", "C7", "G7", "F7"],
		["C7", "F7", "G7", "C7"],
		["F7", "C7", "G7", "C7"],
	],
	b: [
		["F7", "F7", "C7", "C7"],
		["G7", "F7", "C7", "C7"], // 9〜12小節（ターンアラウンド）
		["F7", "G7", "C7", "C7"],
		["C7", "F7", "G7", "C7"],
		["F7", "C7", "G7", "F7"],
		["G7", "G7", "F7", "C7"],
	],
	c: [
		["G7", "F7", "C7", "G7"],
		["F7", "F7", "G7", "G7"],
		["C7", "C7", "F7", "G7"],
	],
};

/** 音階のマスターデータ。 */
export const COMPOSE_SCALES: Record<ComposeScaleId, ComposeScale> = {
	yo: {
		id: "yo",
		label: "陽音階（長調ペンタトニック）",
		tonic: 0,
		core: [0, 1, 2, 4, 5], // ド レ ミ ソ ラ
		minorish: false,
		strict: false,
		description: "J-POPの標準。明るく素直で歌いやすい。従来の長調と同じ",
	},
	minyo: {
		id: "minyo",
		label: "民謡音階（短調ペンタトニック）",
		tonic: 5,
		core: [5, 0, 1, 2, 4], // ラ ド レ ミ ソ
		minorish: true,
		strict: false,
		description:
			"わらべ歌・民謡の音階。翳りがあるが暗すぎない。従来の短調と同じ",
	},
	ritsu: {
		id: "ritsu",
		label: "律音階",
		tonic: 1,
		core: [1, 2, 4, 5, 6], // レ ミ ソ ラ シ
		minorish: true,
		strict: true,
		center: RITSU_CENTER,
		description: "雅楽・声明の音階。半音を含まず、平らで荘重に流れる",
	},
	miyakobushi: {
		id: "miyakobushi",
		label: "都節音階（陰音階）",
		tonic: 2,
		core: [2, 3, 5, 6, 0], // ミ ファ ラ シ ド
		minorish: true,
		strict: true,
		center: MIYAKOBUSHI_CENTER,
		description: "『さくらさくら』の音階。主音のすぐ上が半音で、翳りが濃い",
	},
	ryukyu: {
		id: "ryukyu",
		label: "琉球音階",
		tonic: 0,
		core: [0, 2, 3, 4, 6], // ド ミ ファ ソ シ
		minorish: false,
		strict: true,
		center: RYUKYU_CENTER,
		description: "沖縄音階。レとラを抜き、ファとシを柱にする。明るく跳ねる",
	},
	dorian: {
		id: "dorian",
		label: "ドリアン",
		tonic: 1,
		core: [1, 3, 4, 5, 0], // レ ファ ソ ラ ド
		minorish: true,
		strict: false,
		description: "短調だが6度が明るい。ケルト・ロック・シティポップ",
	},
	phrygian: {
		id: "phrygian",
		label: "フリジアン",
		tonic: 2,
		core: [2, 3, 5, 6, 1], // ミ ファ ラ シ レ
		minorish: true,
		strict: false,
		description: "主音の上が半音。スパニッシュ／メタルの緊迫した響き",
	},
	lydian: {
		id: "lydian",
		label: "リディアン",
		tonic: 3,
		core: [3, 4, 6, 0, 2], // ファ ソ シ ド ミ
		minorish: false,
		strict: false,
		description: "4度が高く、浮遊して広がる。映画音楽・ゲームの空の色",
	},
	mixolydian: {
		id: "mixolydian",
		label: "ミクソリディアン",
		tonic: 4,
		core: [4, 5, 0, 1, 3], // ソ ラ ド レ ファ
		minorish: false,
		strict: false,
		description: "長調だが7度が低い。ブルースロック・民族音楽の土くささ",
	},
	harmonic_minor: {
		id: "harmonic_minor",
		label: "和声的短音階",
		tonic: 5,
		parent: HARMONIC_MINOR_SCALE,
		core: [5, 0, 1, 2, 4], // ラ ド レ ミ ソ♯
		minorish: true,
		strict: false,
		center: HARMONIC_MINOR_CENTER,
		description: "導音ソ♯を持つ短調。増2度が泣きを作る。クラシック・V系・劇伴",
	},
	hijaz: {
		id: "hijaz",
		label: "ヒジャーズ（フリジアン・ドミナント）",
		tonic: 2,
		parent: HARMONIC_MINOR_SCALE,
		core: [2, 3, 4, 5, 6], // ミ ファ ソ♯ ラ シ
		minorish: false,
		strict: false,
		center: HIJAZ_CENTER,
		description: "主音の上が半音、主和音は長三和音。中東・スパニッシュ・メタル",
	},
	hungarian: {
		id: "hungarian",
		label: "ハンガリアン・マイナー（ジプシー）",
		tonic: 5,
		parent: HUNGARIAN_SCALE,
		core: [5, 0, 1, 2, 4], // ラ ド レ♯ ミ ソ♯
		minorish: true,
		strict: false,
		center: HUNGARIAN_CENTER,
		description: "増2度が2か所。音階の中でいちばん跳ねた、異国めいた響き",
	},
	blues: {
		id: "blues",
		label: "ブルース音階",
		tonic: 0,
		parent: BLUES_SCALE,
		core: [0, 1, 2, 4, 5], // ド ミ♭ ファ ソ シ♭
		minorish: true,
		strict: true,
		center: BLUES_CENTER,
		description: "ブルーノート入りの6音音階。短3度で歌い、伴奏は長3度で鳴る",
	},
};

/** 全音階の識別子。 */
export const COMPOSE_SCALE_IDS = Object.keys(
	COMPOSE_SCALES,
) as ComposeScaleId[];

/**
 * 既定（従来互換）の2音階。`scale` 未指定のときはここから調に合わせて引くので、
 * **音階を指定しない呼び出しは以前と1音も変わらない。**
 */
export const DEFAULT_SCALE_IDS: ComposeScaleId[] = ["yo", "minyo"];

/**
 * 主音の位置ごとの「和声の中心」。進行プールと終止形をここで引く。
 *
 * **旋律が5音でも伴奏は7音のダイアトニック和音を使う。** ペンタトニックの旋律を
 * ダイアトニックの和音に乗せるのは民俗音楽でもポップスでも標準の書き方で、
 * 和音まで5音に絞ると三和音が組めない音階が出る（律音階には主音の3度が無い）。
 *
 * ド（0）とラ（5）は従来の長調・短調そのものなので、ここには置かず
 * `compose.ts` の既存プール（`SECTION_A_PROGRESSIONS` 他）をそのまま使う。
 */
export type TonicCenter = {
	/** 主和音。セクションの締めはここへ落とす。 */
	tonic: string;
	/** 半終止に使う和音。「まだ続く」で止めるところに置く。 */
	half: string;
	/** 偽終止の落とし先。主和音の代理。 */
	deceptive: string;
	/** その主音がトニックかどうかを和音名から判定する正規表現。 */
	tonicPattern: RegExp;
	/** A部（Aメロ系）の進行候補。 */
	a: string[][];
	/** B部（サビ系）の進行候補。 */
	b: string[][];
	/** Cメロの進行候補。 */
	c: string[][];
};

/**
 * レ・ミ・ファ・ソを主音にする曲の進行。
 *
 * **候補は全部ハ長調のダイアトニック和音だけで組む。** モードの曲に
 * セカンダリドミナントを入れると、その瞬間に主音がドへ引き戻される
 * （D ドリアンで A7 を鳴らすと C♯ が出て、耳はこれをニ短調＝ハ長調の外と解釈し、
 * ドリアンではなくなる）。モードらしさは旋律の中核音が作るので、和音は
 * **主音の和音を頭と尻に置いて調の中心を耳に示す**役に徹する。
 */
export const TONIC_CENTERS: Partial<Record<TonicDegree, TonicCenter>> = {
	// --- レ（律・ドリアン） ---
	1: {
		tonic: "Dm",
		half: "G",
		deceptive: "F",
		tonicPattern: /^Dm/,
		a: [
			["Dm", "G", "Dm", "Dm"], // i-IV の往復。ドリアンの顔
			["Dm", "Am", "G", "Dm"],
			["Dm", "C", "G", "Dm"],
			["Dm7", "G", "Dm7", "C"],
			["Dm", "F", "C", "G"],
			["Dm", "Em", "F", "G"],
			["Dm", "G", "F", "C"],
			["Dm7", "Em7", "FM7", "G"],
		],
		b: [
			["F", "G", "Am", "Dm"],
			["C", "G", "Dm", "Dm"],
			["G", "F", "C", "Dm"],
			["Am", "G", "F", "Dm"],
			["FM7", "G", "Em7", "Dm7"],
			["Dm", "G", "C", "Am"],
		],
		c: [
			["Am", "Dm", "G", "C"],
			["F", "Em", "Dm", "G"],
			["Dm", "Am", "Em", "G"],
		],
	},
	// --- ミ（都節・フリジアン） ---
	2: {
		tonic: "Em",
		half: "Am",
		deceptive: "C",
		tonicPattern: /^Em/,
		a: [
			["Em", "F", "Em", "Em"], // i-♭II。フリジアン／都節の顔
			["Em", "Am", "F", "Em"],
			["Am", "Em", "F", "Em"],
			["Em", "F", "G", "Em"],
			["Em", "Em", "F", "F"],
			["Em", "C", "F", "Em"],
			["Am", "F", "Em", "Em"],
			["Em7", "FM7", "Em7", "Am7"],
		],
		b: [
			["F", "G", "Am", "Em"],
			["Am", "G", "F", "Em"],
			["F", "Em", "Am", "Em"],
			["C", "F", "Em", "Em"],
			["FM7", "G", "Em7", "Am"],
			["Am", "Em", "F", "G"],
		],
		c: [
			["Am", "Em", "F", "C"],
			["C", "G", "Am", "Em"],
			["F", "C", "Am", "Em"],
		],
	},
	// --- ファ（リディアン） ---
	3: {
		tonic: "FM7",
		half: "C",
		deceptive: "Dm",
		tonicPattern: /^F(?![#b]|m)/,
		a: [
			["FM7", "G", "FM7", "FM7"], // I-II。リディアンの顔（♯4 が G の3度に居る）
			["FM7", "G", "Em", "Am"],
			["F", "G", "C", "F"],
			["FM7", "G", "Am", "F"],
			["F", "C", "G", "F"],
			["FM7", "Em7", "Dm7", "G"],
			["F", "G", "F", "C"],
			["FM7", "G", "Dm7", "F"],
		],
		b: [
			["G", "F", "C", "F"],
			["Am", "G", "FM7", "FM7"],
			["C", "G", "Am", "F"],
			["G", "Em", "Am", "F"],
			["Dm7", "G", "FM7", "FM7"],
			["FM7", "G", "Em7", "F"],
		],
		c: [
			["Dm", "Am", "F", "G"],
			["Am", "Em", "F", "G"],
			["C", "Am", "Dm", "F"],
		],
	},
	// --- ソ（ミクソリディアン） ---
	4: {
		tonic: "G",
		half: "Dm",
		deceptive: "Em",
		tonicPattern: /^G(?![#b]|m)/,
		a: [
			["G", "F", "C", "G"], // I-♭VII-IV。ミクソリディアンの顔
			["G", "C", "F", "G"],
			["G", "F", "G", "G"],
			["C", "G", "F", "G"],
			["G", "Dm", "F", "G"],
			["G", "Am", "F", "G"],
			["G", "F", "Dm", "C"],
			["G", "C", "G", "F"],
		],
		b: [
			["F", "C", "G", "G"],
			["Am", "F", "C", "G"],
			["C", "Dm", "F", "G"],
			["Em", "F", "C", "G"],
			["F", "G", "Am", "G"],
			["Dm7", "F", "C", "G"],
		],
		c: [
			["Am", "Em", "F", "G"],
			["C", "Am", "Dm", "G"],
			["Em", "Am", "F", "C"],
		],
	},
};

// ============================================================
// 音程の計算
// ============================================================
//
// ここから下は**すべて曲の音階を第1引数に取る**。音程集合そのものが曲ごとに
// 変わる（{@link ComposeScale.parent}）ので、モジュールの定数として持てない。

/** その音階の音程集合。省略されていればハ長調。 */
export const scaleDegrees = (scale: ComposeScale): ScaleDegree[] =>
	scale.parent ?? MAJOR_SCALE;

/** 1オクターブあたりの音数。7とは限らない（ブルースは6）。 */
export const scaleSize = (scale: ComposeScale): number =>
	scaleDegrees(scale).length;

/**
 * 音階の度数 → 綴り付きの音。`degree` はオクターブを跨いで連続する整数
 * （{@link scaleSize} で1オクターブ上、-1 で1つ下）。
 */
export const degreeToPitch = (
	scale: ComposeScale,
	degree: number,
): ScaleDegree => {
	const list = scaleDegrees(scale);
	const size = list.length;
	const index = ((degree % size) + size) % size;
	const octave = Math.floor(degree / size);
	const d = list[index];
	return { semi: d.semi + octave * 12, fifth: d.fifth };
};

/** 半音 → 音階の度数（最も近い構成音）。順次進行の起点を探すのに使う。 */
export const semitoneToDegree = (scale: ComposeScale, semi: number): number => {
	const list = scaleDegrees(scale);
	const octave = Math.floor(semi / 12);
	const within = semi - octave * 12;
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < list.length; i++) {
		const dist = Math.abs(list[i].semi - within);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return octave * list.length + best;
};

/** 音階上を `delta` 度動かす（半音でなく度数で動かすのでスケールから外れない）。 */
export const walk = (
	scale: ComposeScale,
	semi: number,
	delta: number,
): number => degreeToPitch(scale, semitoneToDegree(scale, semi) + delta).semi;

/** 音階の中の音の綴り。変化音でない音はこちらで綴る。 */
export const scaleFifth = (scale: ComposeScale, semi: number): number =>
	degreeToPitch(scale, semitoneToDegree(scale, semi)).fifth;

/**
 * その音階のピッチクラス。ここに無い音が「調の外の音（変化音）」。
 * 音階ごとに変わらないのでキャッシュする。
 */
const SCALE_PCS = new Map<ComposeScaleId, Set<number>>();
export const scalePcs = (scale: ComposeScale): Set<number> => {
	const hit = SCALE_PCS.get(scale.id);
	if (hit) return hit;
	const set = new Set(
		scaleDegrees(scale).map((d) => ((d.semi % 12) + 12) % 12),
	);
	SCALE_PCS.set(scale.id, set);
	return set;
};

/**
 * 中核音を昇順に並べたもの。`core` は主音から書いてあるので、度数の大小で
 * 引くにはここを通す。音階ごとに変わらないのでキャッシュする。
 */
const CORE_SORTED = new Map<ComposeScaleId, number[]>();
const sortedCore = (scale: ComposeScale): number[] => {
	const hit = CORE_SORTED.get(scale.id);
	if (hit) return hit;
	const sorted = [...scale.core].sort((a, b) => a - b);
	CORE_SORTED.set(scale.id, sorted);
	return sorted;
};

/** 中核音のピッチクラス。{@link ComposeScale.strict} の判定に使う。 */
const CORE_PCS = new Map<ComposeScaleId, Set<number>>();
export const corePcs = (scale: ComposeScale): Set<number> => {
	const hit = CORE_PCS.get(scale.id);
	if (hit) return hit;
	const list = scaleDegrees(scale);
	const set = new Set(scale.core.map((d) => ((list[d].semi % 12) + 12) % 12));
	CORE_PCS.set(scale.id, set);
	return set;
};

/** その度数が音階の中核音か。`degree` はオクターブを跨いでよい。 */
export const isCoreDegree = (scale: ComposeScale, degree: number): boolean => {
	const size = scaleSize(scale);
	return sortedCore(scale).includes(((degree % size) + size) % size);
};

/**
 * 中核音の歩数（5音で1オクターブ）→ 音階の度数。
 *
 * **モチーフはこちらの歩数で組み立てる。** 音階の度数で輪郭を作ると、
 * 「1つ上」が文脈によって半音にも全音にもなり、モチーフを移調したとたんに
 * 中核の外の音が紛れ込む。中核音の歩数で持てば、どこへ移調しても中核に居る。
 */
export const coreToDegree = (scale: ComposeScale, step: number): number => {
	const sorted = sortedCore(scale);
	const n = sorted.length;
	const index = ((step % n) + n) % n;
	const octave = Math.floor(step / n);
	return sorted[index] + octave * scaleSize(scale);
};

/** 音階の度数 → いちばん近い中核音の歩数。 */
export const degreeToCore = (scale: ComposeScale, degree: number): number => {
	const sorted = sortedCore(scale);
	const size = scaleSize(scale);
	const index = ((degree % size) + size) % size;
	const octave = Math.floor(degree / size);
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < sorted.length; i++) {
		const dist = Math.abs(sorted[i] - index);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return octave * sorted.length + best;
};

/**
 * その音が中核音の外か。
 *
 * **`strict` な音階だけは実際の音名で見る。** 度数へ丸めてから見ると、ブルース音階の
 * 上に `F7` が鳴ったときのラが、いちばん近い度数（シ♭）へ丸められて「中核音だ」と
 * 判定されてしまう。丸めずに見れば、音階に無い音として弾かれる。
 * 緩い音階は従来どおり度数で見る——変化音は後段の `applyChromatic` の担当で、
 * ここで潰すと従来の曲が変わる。
 */
export const isOutsideCore = (scale: ComposeScale, semi: number): boolean =>
	scale.strict
		? !corePcs(scale).has(((semi % 12) + 12) % 12)
		: !isCoreDegree(scale, semitoneToDegree(scale, semi));

/**
 * 音階の指定（`"auto"` | `"any"` | 音階ID）を解決する。
 *
 * - `"auto"`（既定）… 従来通り。長調なら陽音階、短調なら民謡音階
 * - `"any"` … 全音階から抽選
 * - 音階ID … その音階を使う
 */
export const resolveComposeScale = (
	choice: string | undefined,
	minorKey: boolean,
	rnd: () => number = Math.random,
): ComposeScale => {
	const c = (choice ?? "").trim() || "auto";
	const hit = COMPOSE_SCALES[c as ComposeScaleId];
	if (hit) return hit;
	if (c === "any")
		return COMPOSE_SCALES[
			COMPOSE_SCALE_IDS[Math.floor(rnd() * COMPOSE_SCALE_IDS.length)] ?? "yo"
		];
	return COMPOSE_SCALES[minorKey ? "minyo" : "yo"];
};

/** 音階の説明文（UI のヒント用）。 */
export const getComposeScaleDescription = (choice: string): string => {
	const hit = COMPOSE_SCALES[choice as ComposeScaleId];
	if (hit) return hit.description;
	if (choice === "any")
		return `${COMPOSE_SCALE_IDS.length}つの音階からランダムに抽選します`;
	return "ベース調の長短に合わせて、陽音階（長調）か民謡音階（短調）を使います";
};

/**
 * その音階が使う和声の中心。音階ごとの上書き → 主音の位置の既定 → 無し（＝従来の
 * 長調・短調のプールを使う）の順に引く。
 */
export const resolveCenter = (scale: ComposeScale): TonicCenter | null =>
	scale.center ?? TONIC_CENTERS[scale.tonic] ?? null;
