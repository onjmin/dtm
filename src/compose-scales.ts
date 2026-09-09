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
 * ## 親音階を差し替える音階はここに無い
 *
 * ハーモニックマイナー・ハンガリアン・ヒジャーズ・ブルース・ホールトーンは
 * ハ長調に無いピッチクラスを含むので、`MAJOR_SCALE` 自体を曲ごとに差し替える
 * 作り替えが要る。ここでは扱わない。
 */

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
	| "mixolydian";

/**
 * 主音のダイアトニック度数。0=ド, 1=レ, ..., 6=シ。
 * 進行プールはこの値で引く（{@link TONIC_CENTERS}）。
 */
export type TonicDegree = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ComposeScale = {
	id: ComposeScaleId;
	/** 表示名。 */
	label: string;
	/** 主音のダイアトニック度数。 */
	tonic: TonicDegree;
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
	 * 音階には2種類ある。陽・民謡・律・都節・琉球は**本物の5音音階**で、中核から
	 * 外れた2音は「使いどころが限られる音」ではなく**音階に無い音**。対してモード
	 * （ドリアン等）は7音音階で、中核の5音は旋律の柱を選んだだけだから、残りの2音も
	 * 立派な音階の構成音になる。
	 *
	 * `true` にすると、和音の構成音であっても中核の外なら隣へ逃がす。琉球音階の
	 * `F` と `G` はレとラを持っていて、そこを無条件に通すと**「レとラを抜く」という
	 * 音階の定義そのものが崩れる**（実測でレ8%・ラ6%が紛れ込んでいた）。
	 *
	 * 陽・民謡は `false`。ファ・シを自由に使うのはJ-POPの実際の書法で、参考曲の
	 * 実測値もそちら（`compose.ts` の `applyPentatonic` 参照）。ここを締めると
	 * 従来の曲が変わってしまう。
	 */
	strict: boolean;
	/**
	 * 進行プールの上書き。省略時は主音の位置から {@link TONIC_CENTERS} を引き、
	 * それも無ければ（主音がド／ラ）従来の長調・短調のプールを使う。
	 *
	 * **主音が同じでも音階が違えば使える和音が違う**ので、ここが要る。琉球音階は
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

/**
 * 中核音を昇順（0〜6）に並べたもの。`core` は主音から書いてあるので、度数の
 * 大小で引くにはここを通す。音階ごとに変わらないのでキャッシュする。
 */
const CORE_SORTED = new Map<ComposeScaleId, number[]>();
const sortedCore = (scale: ComposeScale): number[] => {
	const hit = CORE_SORTED.get(scale.id);
	if (hit) return hit;
	const sorted = [...scale.core].sort((a, b) => a - b);
	CORE_SORTED.set(scale.id, sorted);
	return sorted;
};

/** その度数が音階の中核音か。`degree` はオクターブを跨いでよい。 */
export const isCoreDegree = (scale: ComposeScale, degree: number): boolean =>
	sortedCore(scale).includes(((degree % 7) + 7) % 7);

/**
 * 中核音の歩数（5音で1オクターブ）→ ダイアトニック度数。
 *
 * **モチーフはこちらの歩数で組み立てる。** ダイアトニックの度数で輪郭を作ると、
 * 「1つ上」が文脈によって半音にも全音にもなり、モチーフを移調したとたんに
 * 音階の外の音が紛れ込む。中核音の歩数で持てば、どこへ移調しても音階の中に居る。
 */
export const coreToDegree = (scale: ComposeScale, step: number): number => {
	const sorted = sortedCore(scale);
	const index = ((step % 5) + 5) % 5;
	const octave = Math.floor(step / 5);
	return sorted[index] + octave * 7;
};

/** ダイアトニック度数 → いちばん近い中核音の歩数。 */
export const degreeToCore = (scale: ComposeScale, degree: number): number => {
	const sorted = sortedCore(scale);
	const index = ((degree % 7) + 7) % 7;
	const octave = Math.floor(degree / 7);
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < sorted.length; i++) {
		const dist = Math.abs(sorted[i] - index);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return octave * 5 + best;
};

/**
 * 音階の指定（`"auto"` | `"any"` | 音階ID）を解決する。
 *
 * - `"auto"`（既定）… 従来通り。長調なら陽音階、短調なら民謡音階
 * - `"any"` … 全9音階から抽選
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
	if (choice === "any") return "9つの音階からランダムに抽選します";
	return "ベース調の長短に合わせて、陽音階（長調）か民謡音階（短調）を使います";
};

/**
 * その音階が使う和声の中心。音階ごとの上書き → 主音の位置の既定 → 無し（＝従来の
 * 長調・短調のプールを使う）の順に引く。
 */
export const resolveCenter = (scale: ComposeScale): TonicCenter | null =>
	scale.center ?? TONIC_CENTERS[scale.tonic] ?? null;
