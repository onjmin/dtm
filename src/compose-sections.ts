/**
 * 曲のセクション（イントロ・Aメロ・Bメロ・サビ・Cメロ・落ちサビ・間奏・アウトロ）。
 *
 * 人が聴いて最初に分かるのは和音や音程ではなく**「ここはAメロだ」「サビに入った」という
 * 切り替わり**なので、どの小節が何なのかを持っていないと、細部を詰めても
 * 「曲の一部を切り出したもの」にしかならない。
 *
 * ## セクションごとに何を変えるか
 *
 * | | メロディ | 音域 | 密度 | ドラム | 終わり方 |
 * |---|---|---|---|---|---|
 * | イントロ | 無し | — | — | 抑えめ | — |
 * | Aメロ | 有り | 低め | 控えめ | 抑えめ | 半終止 |
 * | Bメロ | 有り | 中 | 上げる | 標準 | ドミナントで宙吊り |
 * | サビ | 有り | 高い | 最大 | 最大 | 主音へ全終止 |
 * | Cメロ | 有り | 中高 | やや控えめ | 標準 | 解決しない音 |
 * | 落ちサビ | 有り | 高い | 薄い | 抑えめ | 主音へ全終止 |
 * | 間奏 | 無し | — | — | 標準 | — |
 * | アウトロ | 有り | 低め | 薄い | 薄い | 主音へ全終止 |
 *
 * メロディを書かないセクション（イントロ・間奏）でも、伴奏・ベース・ドラムは鳴る。
 * ここを「メロディが無いだけの同じ小節」にすると、結局のっぺりしたままになるので、
 * ドラムの強度と伴奏の奏法で差を付ける。
 *
 * ## テンプレートによる曲構成
 *
 * 現代のJ-POPは「Aメロ→Bメロ→サビ」を2回繰り返し、Cメロを挟んでラスサビへ至る構成が
 * 王道。同じセクションの**繰り返し**が曲の基本構造なので、{@link STRUCTURE_TEMPLATES}
 * に構成パターンを持ち、2回目以降には `restatement: true` を付ける（compose側が
 * メロディ・リズムを1回目から再現する）。
 */

/** セクションの種類。 */
export type SectionKind =
	| "intro"
	| "verse"
	| "prechorus"
	| "chorus"
	/** Cメロ。Verse/Pre chorusとは違うメロディで、ラストのサビ前に緊張感を持たせる。 */
	| "bridge"
	/**
	 * 落ちサビ。サビのメロディを伴奏控えめに歌う。J-POPの王道パターン。
	 * 2000年代のヒット曲に多く、現在も根強い人気がある。
	 */
	| "drop_chorus"
	| "interlude"
	| "outro";

export const SECTION_LABELS: Record<SectionKind, string> = {
	intro: "イントロ",
	verse: "Aメロ",
	prechorus: "Bメロ",
	chorus: "サビ",
	bridge: "Cメロ",
	drop_chorus: "落ちサビ",
	interlude: "間奏",
	outro: "アウトロ",
};

/** セクションの並び順（UIの並びと、指定が無いときの既定の順序）。 */
export const SECTION_ORDER: SectionKind[] = [
	"intro",
	"verse",
	"prechorus",
	"chorus",
	"bridge",
	"drop_chorus",
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
	progression: "a" | "b" | "c";
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
	// Cメロ。Verse/Pre chorusとは違うメロディで、ラストのサビ前に緊張感を持たせる。
	// 2番のサビの後に来ることが多い（参考: ONLIVE Studio blog）。
	// 専用のコード進行 "c" を持ち、AメロともBメロとも雰囲気が違う。
	bridge: {
		bars: 4,
		melody: true,
		registerShift: 2,
		density: 0.9,
		drumLevel: 1,
		landing: 1, // 解決しない音で止めてラスサビへ渡す
		progression: "c",
	},
	// 落ちサビ。サビのメロディを伴奏控えめに歌う。J-POPの王道パターン。
	// density と drumLevel だけ下げ、メロディはサビと同じものを使う。
	drop_chorus: {
		bars: 4,
		melody: true,
		registerShift: 4, // サビと同じ高さ
		density: 0.6, // 薄い（ここが「落ち」の実体）
		drumLevel: 0, // ドラム控えめ
		landing: 0, // 主音へ全終止
		progression: "b", // サビと同じ進行
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
	/**
	 * 同じ種類のセクションが曲中で2回目以降に現れた場合に true。
	 * compose側でメロディ・リズムを1回目から再現するために使う。
	 * 2番のAメロは1番と同じフレーズを使い回す、というのが曲の基本構造。
	 */
	restatement: boolean;
};

// ============================================================
// テンプレートによる曲構成
// ============================================================

/**
 * 曲構成テンプレート。名前付きで、UIのドロップダウンから選べるようにする。
 *
 * 現代のJ-POPは「Aメロ→Bメロ→サビ」を2回繰り返し、Cメロを挟んで
 * ラスサビへ至る構成が王道。同じセクションの**繰り返し**が曲の基本構造
 * であるため、plan配列で同一種別を複数回指定できるようにしてある。
 *
 * 参考: ONLIVE Studio blog「Aメロ→Bメロ→サビだけじゃない！」
 * 参考: マリーゴールドの構成
 */
export type StructureTemplate = {
	name: string;
	label: string;
	plan: SectionKind[];
};

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
	// 1コーラス（現行デフォルト、短い曲・初心者向け）
	{
		name: "1chorus",
		label: "1コーラス",
		plan: ["intro", "verse", "prechorus", "chorus"],
	},

	// JPOP王道（マリーゴールド型）
	// イントロ→Aメロ→Aメロ→Bメロ→サビ→Aメロ→Bメロ→サビ→Cメロ→間奏→サビ→アウトロ
	{
		name: "jpop_standard",
		label: "JPOP王道",
		plan: [
			"intro",
			"verse",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"interlude",
			"chorus",
			"outro",
		],
	},

	// 落ちサビ入り（J-POP王道の変形。ラスサビ前に落ちサビ）
	{
		name: "jpop_drop",
		label: "落ちサビ入り",
		plan: [
			"intro",
			"verse",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"drop_chorus",
			"chorus",
			"outro",
		],
	},

	// ボカロ王道（短め高速、Aメロ繰り返しなし）
	{
		name: "vocaloid",
		label: "ボカロ王道",
		plan: [
			"intro",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"chorus",
			"outro",
		],
	},

	// Verse-Chorus形式（Bメロなし、洋楽的）
	{
		name: "verse_chorus",
		label: "Verse-Chorus",
		plan: [
			"intro",
			"verse",
			"chorus",
			"verse",
			"chorus",
			"bridge",
			"chorus",
			"outro",
		],
	},
];

/**
 * 選ばれたセクションを並べて、曲の設計図にする。
 *
 * テンプレート名が指定された場合はテンプレートの plan をそのまま使う。
 * kinds 配列が指定された場合は {@link SECTION_ORDER} に従って並べる
 * （従来の互換モード。各種別は1回ずつ）。
 * どちらも空のときは {@link DEFAULT_SECTIONS} を使う。
 *
 * 同じ種別が2回以上現れた場合、2回目以降は `restatement: true` が付く。
 * compose側はこのフラグを見て、1回目のメロディ・リズムを再現する。
 */
export const buildSectionPlan = (
	kinds: SectionKind[],
	templateName?: string,
): PlacedSection[] => {
	let ordered: SectionKind[];
	if (templateName) {
		const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === templateName);
		ordered = tmpl ? tmpl.plan : DEFAULT_SECTIONS;
	} else {
		const wanted = kinds.length > 0 ? kinds : DEFAULT_SECTIONS;
		// 並び順は SECTION_ORDER に従う（チェックの付け外しの順に依存させない）。
		ordered = SECTION_ORDER.filter((k) => wanted.includes(k));
	}

	const plan: PlacedSection[] = [];
	let bar = 0;
	/** 各種別が何回出てきたか。2回目以降は restatement。 */
	const seen = new Map<SectionKind, number>();
	for (const kind of ordered) {
		const spec = SECTION_SPECS[kind];
		const count = seen.get(kind) ?? 0;
		plan.push({
			kind,
			startBar: bar,
			bars: spec.bars,
			spec,
			keyShift: 0,
			restatement: count > 0,
		});
		seen.set(kind, count + 1);
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
