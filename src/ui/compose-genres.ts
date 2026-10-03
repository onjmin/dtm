/**
 * 自動作曲パネルの「何を作る？」カード。ジャンル → 作曲テンプレート名の対応表。
 *
 * テンプレート名・`#compose=` の書式は変えない。カードは既存テンプレートへの入口を並べ替えるだけ。
 * **カードを足す前に docs/handover-compose.md「0. ジャンルに載せてよい基準」を読む。** 手本のある狭い作風だけ・
 * 複数の曲から測った規則だけを載せ、1曲の写し（音そのものを並べ替えるもの）は載せない。
 */

export type ComposeGenreId = "nigo" | "speder2" | "kaisen" | "game";

export type ComposeGenre = {
	id: ComposeGenreId;
	label: string;
	desc: string;
	/** 歌の既定。ジャンルを選び直すたびにこの値へ戻す。 */
	vocalDefault: boolean;
	/** 作曲テンプレート名。 */
	template: (vocal: boolean) => string;
};

export const COMPOSE_GENRES: ComposeGenre[] = [
	{
		id: "nigo",
		label: "界隈曲・2号兄貴リスペクト",
		desc: "休まず走るシンセリード",
		vocalDefault: false,
		template: (vocal) => (vocal ? "kaiwai_2go" : "kaiwai_2go_lead"),
	},
	{
		id: "speder2",
		label: "界隈曲・Speder2リスペクト",
		desc: "1小節の型を回すエレピ",
		vocalDefault: false,
		template: (vocal) => (vocal ? "kaiwai_speder2" : "kaiwai_speder2_lead"),
	},
	{
		id: "kaisen",
		label: "界隈曲・海鮮リスペクト",
		desc: "歌を2本重ねる厚い界隈曲",
		vocalDefault: true,
		template: () => "kaiwai_kaisen",
	},
	{
		id: "game",
		label: "ゲームBGM・Ghost Fight / Pepper Steak風",
		desc: "16分のリフで回るループ",
		// 主旋律が楽器の16分リフ（template.lead = "riff"）なので、歌わせると早口になる。
		vocalDefault: false,
		template: () => "game_loop",
	},
];

export const DEFAULT_COMPOSE_GENRE: ComposeGenreId = "nigo";

/** 外したジャンル（jpop・vocaloid・kaiwai・bgm）の保存値は既定のジャンルへ落とす。 */
export const findComposeGenre = (id: string | null | undefined): ComposeGenre =>
	COMPOSE_GENRES.find((g) => g.id === id) ??
	(COMPOSE_GENRES[0] as ComposeGenre);

/**
 * 旧 UI の「構成」セレクトの保存値から、カード・歌を起こす（保存値の移行用）。
 * 歌が決まらないもの（歌入り版と楽器版が分かれていないテンプレート）は `vocal` を返さない。
 */
export const genreFromTemplate = (
	template: string | null | undefined,
): { genre: ComposeGenreId; vocal?: boolean } => {
	switch (template) {
		case "game_loop":
			return { genre: "game" };
		case "kaiwai_kaisen":
			return { genre: "kaisen" };
		case "kaiwai_2go":
			return { genre: "nigo", vocal: true };
		case "kaiwai_2go_lead":
			return { genre: "nigo", vocal: false };
		case "kaiwai_speder2":
			return { genre: "speder2", vocal: true };
		case "kaiwai_speder2_lead":
			return { genre: "speder2", vocal: false };
		default:
			return { genre: DEFAULT_COMPOSE_GENRE };
	}
};
