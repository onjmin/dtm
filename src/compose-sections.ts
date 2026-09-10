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
	/**
	 * 小節数の代表値。`rnd` を渡さずに {@link buildSectionPlan} を呼んだときの長さで、
	 * 「押す前に曲の長さを見せる」UI 表示などが使う。実際の作曲は
	 * {@link SectionSpec.barChoices} から seed ごとに引く。
	 */
	bars: number;
	/**
	 * seed ごとに引くセクション長の候補（要素の重複が重み）。
	 *
	 * **なぜ定数をやめたか。** 長さが定数だと、BPM も調もメロディ型も引き直している
	 * のに**曲の骨格だけが全 seed で同一**になる。曲の頭からの小節割りが毎回同じなのは
	 * 生成器の指紋そのもので、参考曲と一致しているかどうか以前の問題。加えて
	 * `scripts/compare-reach.ts` の教訓（`scripts/README.md` の4番）どおり、
	 * **候補に一度も現れない長さは、採点の重みをどう変えても出てこない**。
	 *
	 * **なぜ4の倍数か。** 参考コーパス91本の主旋律を1小節以上の休みで切って
	 * ブロック長を測ると、71%が4の倍数・82%が偶数で、8/16/24/32小節に山が立つ。
	 * 加えてコード進行を4小節単位のまとまりで組んでいる（`compose.ts` の `progression`）
	 * ので、4の倍数から外れた長さは締めの4小節が途中で切れる。
	 *
	 * イントロだけは実測がはっきりしている。曲頭から主旋律が入るまでの小節数は
	 * 0小節が33%・8小節が30%・4小節が15%で、**8小節が4小節の約2倍**。曲の長さとの
	 * 相関は r=0.01 で、長い曲ほどイントロが長いという関係は無い（＝曲長の関数に
	 * してはいけない）。0小節はここでは引かない。「イントロを作るか」は UI の
	 * チェックで表明されているので、チェックが付いているのに消すのは筋が違う。
	 *
	 * 省略時は {@link SectionSpec.bars} 固定（外から独自の spec を渡す場合のため）。
	 */
	barChoices?: number[];
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
	// 長さは実測（8小節が4小節の約2倍）に合わせて引く。
	intro: {
		bars: 4,
		barChoices: [4, 4, 8, 8, 8],
		melody: false,
		registerShift: 0,
		density: 0.6,
		drumLevel: 0,
		landing: null,
		progression: "b",
	},
	verse: {
		bars: 8,
		barChoices: [8, 8, 8, 16],
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
		barChoices: [4, 4, 4, 8],
		melody: true,
		registerShift: 0,
		density: 1.1,
		drumLevel: 1,
		landing: 1, // 2度＝解決しない音で止める
		progression: "a",
	},
	chorus: {
		bars: 8,
		barChoices: [8, 8, 8, 16],
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
		barChoices: [4, 4, 8, 8],
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
		barChoices: [4, 4, 8],
		melody: true,
		registerShift: 4, // サビと同じ高さ
		density: 0.6, // 薄い（ここが「落ち」の実体）
		drumLevel: 0, // ドラム控えめ
		landing: 0, // 主音へ全終止
		progression: "b", // サビと同じ進行
	},
	interlude: {
		bars: 4,
		barChoices: [4, 4, 8],
		melody: false,
		registerShift: 0,
		density: 0.8,
		drumLevel: 1,
		landing: null,
		progression: "b",
	},
	outro: {
		bars: 4,
		barChoices: [4, 4, 8],
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

/** {@link buildSectionPlan} の並び順を決める（テンプレート優先、無ければチェック）。 */
const orderedKinds = (
	kinds: SectionKind[],
	templateName?: string,
): SectionKind[] => {
	if (templateName) {
		const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === templateName);
		return tmpl ? tmpl.plan : DEFAULT_SECTIONS;
	}
	const wanted = kinds.length > 0 ? kinds : DEFAULT_SECTIONS;
	// 並び順は SECTION_ORDER に従う（チェックの付け外しの順に依存させない）。
	return SECTION_ORDER.filter((k) => wanted.includes(k));
};

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
 *
 * `rnd` を渡すと、セクション長を {@link SectionSpec.barChoices} から引く
 * （渡さなければ {@link SectionSpec.bars} の代表値。UI の長さ表示など、
 * 引くたびに答えが変わっては困る場所のため）。
 *
 * **長さは種別ごとに1回だけ引く。** 1番のAメロが8小節で2番が16小節、という
 * 曲は書けなくはないが、`restatement` は1番の対応小節をそのまま歌い直す仕組み
 * なので、長さが違うと後半だけ別のフレーズになる。同じ名前のセクションは同じ
 * 長さで揃えるほうが「同じフレーズが返ってきた」という手応えを壊さない。
 */
export const buildSectionPlan = (
	kinds: SectionKind[],
	templateName?: string,
	rnd?: () => number,
): PlacedSection[] => {
	const ordered = orderedKinds(kinds, templateName);

	/** 種別ごとの長さ。同じ種別は曲中で同じ長さに揃える。 */
	const barsOf = new Map<SectionKind, number>();
	for (const kind of ordered) {
		if (barsOf.has(kind)) continue;
		const spec = SECTION_SPECS[kind];
		const choices = spec.barChoices ?? [];
		barsOf.set(
			kind,
			rnd && choices.length > 0
				? choices[
						Math.min(choices.length - 1, Math.floor(rnd() * choices.length))
					]
				: spec.bars,
		);
	}

	const plan: PlacedSection[] = [];
	let bar = 0;
	/** 各種別が何回出てきたか。2回目以降は restatement。 */
	const seen = new Map<SectionKind, number>();
	for (const kind of ordered) {
		const spec = SECTION_SPECS[kind];
		const bars = barsOf.get(kind) ?? spec.bars;
		const count = seen.get(kind) ?? 0;
		plan.push({
			kind,
			startBar: bar,
			bars,
			spec,
			keyShift: 0,
			restatement: count > 0,
		});
		seen.set(kind, count + 1);
		bar += bars;
	}
	return plan;
};

/**
 * その構成で曲が何小節になりうるか（最短・最長・代表値）。
 *
 * セクション長を seed ごとに引くようにしたので、「押す前に何小節か」を
 * 1つの数で見せることはできない。UI はここが返す幅を出す。
 */
export const sectionPlanBarRange = (
	kinds: SectionKind[],
	templateName?: string,
): { min: number; max: number; typical: number } => {
	const ordered = orderedKinds(kinds, templateName);
	let min = 0;
	let max = 0;
	let typical = 0;
	for (const kind of ordered) {
		const spec = SECTION_SPECS[kind];
		const choices = spec.barChoices?.length ? spec.barChoices : [spec.bars];
		min += Math.min(...choices);
		max += Math.max(...choices);
		typical += spec.bars;
	}
	return { min, max, typical };
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
