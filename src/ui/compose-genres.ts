/**
 * 自動作曲パネルの「何を作る？」カード。ジャンル → 作曲テンプレート名の対応表。
 *
 * テンプレート名・`#compose=` の書式は変えない。カードは既存テンプレートへの入口を並べ替えるだけ。
 */

export type ComposeGenreId =
	| "jpop"
	| "vocaloid"
	| "game"
	| "kaiwai"
	| "kaisen"
	| "nigo"
	| "speder2"
	| "bgm";

export type ComposeGenre = {
	id: ComposeGenreId;
	label: string;
	desc: string;
	/** `"accomp"` は伴奏主体のループ曲（composeAccomp）。歌は付けられない。 */
	engine: "song" | "accomp";
	/** 歌の既定。ジャンルを選び直すたびにこの値へ戻す。 */
	vocalDefault: boolean;
	/** 「曲の形」を選べるか。選べないジャンルは形がテンプレートで決まっている。 */
	shapeSelectable: boolean;
	/** 作曲テンプレート名。`shape` は「曲の形」の値（`custom` はテンプレート無し）。 */
	template: (vocal: boolean, shape: string) => string | undefined;
};

/** 「曲の形」で選べる値。J-POP カードのときだけ効く。 */
export const COMPOSE_SHAPES = [
	"jpop_standard",
	"1chorus",
	"jpop_drop",
	"verse_chorus",
	"custom",
] as const;
export const DEFAULT_COMPOSE_SHAPE = "jpop_standard";

const shapeTemplate = (shape: string): string | undefined =>
	shape === "custom"
		? undefined
		: (COMPOSE_SHAPES as readonly string[]).includes(shape)
			? shape
			: DEFAULT_COMPOSE_SHAPE;

export const COMPOSE_GENRES: ComposeGenre[] = [
	{
		id: "jpop",
		label: "J-POP",
		desc: "Aメロ→Bメロ→サビの王道",
		engine: "song",
		vocalDefault: true,
		shapeSelectable: true,
		template: (_v, shape) => shapeTemplate(shape),
	},
	{
		id: "vocaloid",
		label: "ボカロ",
		desc: "疾走感のある2番・Cメロ入り",
		engine: "song",
		vocalDefault: true,
		shapeSelectable: false,
		template: () => "vocaloid",
	},
	{
		id: "game",
		label: "ゲームBGM",
		desc: "16分のリフで回るループ",
		engine: "song",
		// 主旋律が楽器の16分リフ（template.lead = "riff"）なので、歌わせると早口になる。
		vocalDefault: false,
		shapeSelectable: false,
		template: () => "game_loop",
	},
	{
		id: "kaiwai",
		label: "界隈曲",
		desc: "短調・4つ打ち・8分ベース",
		engine: "song",
		vocalDefault: true,
		shapeSelectable: false,
		template: () => "kaiwai",
	},
	{
		id: "kaisen",
		label: "界隈曲・海鮮リスペクト",
		desc: "歌を2本重ねる厚い界隈曲",
		engine: "song",
		vocalDefault: true,
		shapeSelectable: false,
		template: () => "kaiwai_kaisen",
	},
	{
		id: "nigo",
		label: "界隈曲・2号兄貴リスペクト",
		desc: "休まず走るシンセリード",
		engine: "song",
		vocalDefault: false,
		shapeSelectable: false,
		template: (vocal) => (vocal ? "kaiwai_2go" : "kaiwai_2go_lead"),
	},
	{
		id: "speder2",
		label: "界隈曲・Speder2リスペクト",
		desc: "1小節の型を回すエレピ",
		engine: "song",
		vocalDefault: false,
		shapeSelectable: false,
		template: (vocal) => (vocal ? "kaiwai_speder2" : "kaiwai_speder2_lead"),
	},
	{
		id: "bgm",
		label: "BGM",
		desc: "伴奏主体のループ（約3分・ドラムなし）",
		engine: "accomp",
		vocalDefault: false,
		shapeSelectable: false,
		template: () => undefined,
	},
];

export const DEFAULT_COMPOSE_GENRE: ComposeGenreId = "jpop";

export const findComposeGenre = (id: string | null | undefined): ComposeGenre =>
	COMPOSE_GENRES.find((g) => g.id === id) ??
	(COMPOSE_GENRES[0] as ComposeGenre);

/**
 * 旧 UI の「構成」セレクトの保存値から、カード・曲の形・歌を起こす（保存値の移行用）。
 * 歌が決まらないもの（歌入り版と楽器版が分かれていないテンプレート）は `vocal` を返さない。
 */
export const genreFromTemplate = (
	template: string | null | undefined,
): { genre: ComposeGenreId; shape: string; vocal?: boolean } => {
	const shape = DEFAULT_COMPOSE_SHAPE;
	switch (template) {
		case "vocaloid":
			return { genre: "vocaloid", shape };
		case "game_loop":
			return { genre: "game", shape };
		case "kaiwai":
			return { genre: "kaiwai", shape };
		case "kaiwai_kaisen":
			return { genre: "kaisen", shape };
		case "kaiwai_2go":
			return { genre: "nigo", shape, vocal: true };
		case "kaiwai_2go_lead":
			return { genre: "nigo", shape, vocal: false };
		case "kaiwai_speder2":
			return { genre: "speder2", shape, vocal: true };
		case "kaiwai_speder2_lead":
			return { genre: "speder2", shape, vocal: false };
		default:
			return {
				genre: "jpop",
				shape:
					template && (COMPOSE_SHAPES as readonly string[]).includes(template)
						? template
						: shape,
			};
	}
};
