/**
 * 曲のセクション（イントロ・Aメロ・Bメロ・サビ・間奏・アウトロ）。
 *
 * ## なぜ要るか
 *
 * 作曲マクロは長らく**16小節を A-A'-B-A'' という抽象的な形でしか作っていなかった**。
 * 「いま作っているのが曲のどこなのか」を持っていないので、どの小節も同じ密度・同じ音域で
 * 鳴り、イントロもサビも区別が付かない。人が聴いて最初に分かるのは和音や音程ではなく
 * **「ここはAメロだ」「サビに入った」というセクションの切り替わり**なので、そこが
 * 無いまま細部を詰めても「曲の一部を切り出したもの」にしかならない。
 *
 * ## セクションごとに何を変えるか
 *
 * | | メロディ | 音域 | 密度 | ドラム | 終わり方 |
 * |---|---|---|---|---|---|
 * | イントロ | 無し | — | — | 抑えめ | — |
 * | Aメロ | 有り | 低め | 控えめ | 抑えめ | 半終止 |
 * | Bメロ | 有り | 中 | 上げる | 標準 | ドミナントで宙吊り |
 * | サビ | 有り | 高い | 最大 | 最大 | 主音へ全終止 |
 * | 間奏 | 無し | — | — | 標準 | — |
 * | アウトロ | 有り | 低め | 薄い | 薄い | 主音へ全終止 |
 *
 * メロディを書かないセクション（イントロ・間奏）でも、伴奏・ベース・ドラムは鳴る。
 * ここを「メロディが無いだけの同じ小節」にすると、結局のっぺりしたままになるので、
 * ドラムの強度と伴奏の奏法で差を付ける。
 */

/** セクションの種類。 */
export type SectionKind =
	| "intro"
	| "verse"
	| "prechorus"
	| "chorus"
	| "interlude"
	| "outro";

export const SECTION_LABELS: Record<SectionKind, string> = {
	intro: "イントロ",
	verse: "Aメロ",
	prechorus: "Bメロ",
	chorus: "サビ",
	interlude: "間奏",
	outro: "アウトロ",
};

/** セクションの並び順（UIの並びと、指定が無いときの既定の順序）。 */
export const SECTION_ORDER: SectionKind[] = [
	"intro",
	"verse",
	"prechorus",
	"chorus",
	"interlude",
	"outro",
];

/**
 * 既定で作るセクション。イントロ→Aメロ→Bメロ→サビ の、いちばん短い「1コーラス」。
 * 全部入れると長くなりすぎるので、間奏とアウトロは既定では作らない。
 */
export const DEFAULT_SECTIONS: SectionKind[] = [
	"intro",
	"verse",
	"prechorus",
	"chorus",
];

export type SectionSpec = {
	/** 小節数。 */
	bars: number;
	/** メロディを書くか。イントロと間奏は伴奏だけ。 */
	melody: boolean;
	/**
	 * メロディの音域の中心をどれだけずらすか（半音）。
	 * サビが高く、Aメロが低いのが、セクションの差として最も分かりやすい。
	 */
	registerShift: number;
	/**
	 * 音数の傾き。1より小さいと休符寄りの薄いセクション、大きいと詰める。
	 * リズム型を選ぶときの「休符を含む型」の引きやすさに効く。
	 */
	density: number;
	/** ドラムの強度。0=抑えめ 1=標準 2=最大。 */
	drumLevel: 0 | 1 | 2;
	/**
	 * セクションの終わりの着地音（主音からの音階度数）。
	 * `null` はメロディが無いセクション。
	 */
	landing: number | null;
	/** 伴奏に使うコード進行の役割。 */
	progression: "a" | "b";
};

export const SECTION_SPECS: Record<SectionKind, SectionSpec> = {
	// イントロは曲の顔を先に見せる場所なので、和音はサビのものを使う。
	intro: {
		bars: 4,
		melody: false,
		registerShift: 0,
		density: 0.6,
		drumLevel: 0,
		landing: null,
		progression: "b",
	},
	verse: {
		bars: 8,
		melody: true,
		registerShift: -3,
		density: 0.85,
		drumLevel: 0,
		landing: 4, // 5度で止めて「まだ続く」
		progression: "a",
	},
	// Bメロはサビへの助走。音域を上げ、密度も上げ、最後をドミナントで宙吊りにする。
	prechorus: {
		bars: 4,
		melody: true,
		registerShift: 0,
		density: 1.1,
		drumLevel: 1,
		landing: 1, // 2度＝解決しない音で止める
		progression: "a",
	},
	chorus: {
		bars: 8,
		melody: true,
		registerShift: 4,
		density: 1.2,
		drumLevel: 2,
		landing: 0, // 主音へ全終止
		progression: "b",
	},
	interlude: {
		bars: 4,
		melody: false,
		registerShift: 0,
		density: 0.8,
		drumLevel: 1,
		landing: null,
		progression: "b",
	},
	outro: {
		bars: 4,
		melody: true,
		registerShift: -3,
		density: 0.6,
		drumLevel: 0,
		landing: 0,
		progression: "a",
	},
};

/** 曲の中に置かれた1つのセクション。 */
export type PlacedSection = {
	kind: SectionKind;
	/** 開始小節（0始まり）。 */
	startBar: number;
	bars: number;
	spec: SectionSpec;
	/**
	 * セクション内の転調量（ハ長調基準からの半音シフト）。
	 * ラスサビで +1/+2 半音上がるなど、曲中の転調を小節単位で表現する。
	 */
	keyShift: number;
};

/**
 * 選ばれたセクションを並べて、曲の設計図にする。
 *
 * 指定が空のときは {@link DEFAULT_SECTIONS} を使う——チェックを全部外した状態で
 * 「何も作られない」より、既定の構成が出たほうが押した意味がある。
 */
export const buildSectionPlan = (kinds: SectionKind[]): PlacedSection[] => {
	const wanted = kinds.length > 0 ? kinds : DEFAULT_SECTIONS;
	// 並び順は SECTION_ORDER に従う（チェックの付け外しの順に依存させない）。
	const ordered = SECTION_ORDER.filter((k) => wanted.includes(k));
	const plan: PlacedSection[] = [];
	let bar = 0;
	for (const kind of ordered) {
		const spec = SECTION_SPECS[kind];
		plan.push({ kind, startBar: bar, bars: spec.bars, spec, keyShift: 0 });
		bar += spec.bars;
	}
	return plan;
};

/** その小節が属するセクション。 */
export const sectionAt = (
	plan: PlacedSection[],
	bar: number,
): PlacedSection => {
	for (const section of plan) {
		if (bar >= section.startBar && bar < section.startBar + section.bars)
			return section;
	}
	return plan[plan.length - 1];
};
