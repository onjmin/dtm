/**
 * 仮歌詞の語彙（[compose-lyrics.ts](compose-lyrics.ts) が文の型へ当てる語）。
 *
 * 原曲（耳コピ）から取るのは**語の種類**（海のもの・暮らしの場・時間・体…）と文の型だけで、
 * 種類の中身は一般の日本語から広く持つ（docs/lyric-design.md §20）。原曲に出る語だけに絞ると、
 * どの曲も同じ語になる。
 *
 * 約束: ひらがなだけ。小書きの ゃゅょ・伸ばし棒 は使わない（アプリは1文字を1音符として読む）。
 * 「っ」「ん」は1文字1モーラなので使ってよい。検算は `scripts/test/check-compose-lyrics.ts`。
 */

/** 文末の寄せ方。曲ごとにどちらかへ決める。 */
export type LyricRegister = "report" | "plain";

/** 空白区切りの語の一覧。小書きの ゃゅょ を含む語は落とす（1文字＝1音符で読めない）。 */
const words = (s: string): string[] =>
	s
		.trim()
		.split(/\s+/)
		.filter((w) => !/[ゃゅょ]/.test(w));

// ============================================================
// 名詞
// ============================================================

/** 海と水辺の生き物。界隈曲の「らしさ」の核で、暮らしの場へ方向違いで入ってくる側。 */
export const SEA = words(`
いわし くらげ さかな まぐろ くじら うろこ えび たこ いか すなめり さめ ひらめ かれい たい
さば あじ いるか あざらし かに かい うに なまこ ひとで さんご わかめ こんぶ うつぼ ふぐ
かめ やどかり あんこう えい めだか きんぎょ こい なまず うなぎ どじょう ほたるいか かつお
さんま ぶり にしん たら あゆ ます しらす かき あさり はまぐり ほたて いそぎんちゃく
`);

/** 海以外の生き物。 */
export const CREATURES = words(`
とり からす すずめ はと かもめ つばめ ふくろう さぎ かえる むし かげろう ほたる せみ とんぼ
あり はち かたつむり なめくじ へび とかげ ねこ いぬ うさぎ ねずみ きつね たぬき しか うま
うし ひつじ やぎ くま さる もぐら こうもり みみず だんごむし かまきり ばった こおろぎ すずむし
`);

/** 草木と実。 */
export const PLANTS = words(`
はな くさ こけ きのこ どんぐり たんぽぽ あさがお ひまわり さくら つばき ゆり すすき あじさい
もみじ いちょう まつ たけ いね むぎ まめ かき なし いちご みかん りんご ぶどう もも すいか
`);

/** 暮らしの持ち物。 */
export const THINGS = words(`
かさ らじお でんわ てがみ かぎ とけい ろうそく かがみ ほん くつ ぼたん じょうろ はこ いす
ひも はさみ ふうせん ばけつ ほうき すず てぶくろ まくら もうふ かばん ぼうし めがね えんぴつ
こっぷ さら おわん なべ やかん たまご ぱん おにぎり びん かんづめ まり おもちゃ にんぎょう
せんぷうき れいぞうこ てれび しんぶん きっぷ さいふ はがき ふうとう いと はり ぼうえんきょう
はぶらし せっけん たおる ふくろ つみき おりがみ かざぐるま たこあげ
`);

/** 自然・天。 */
export const NATURE = words(`
そら つち うみ あめ ゆき くも ひかり つき ほし かぜ みず しお なみ すな かげ きり しも にじ
かみなり いし いわ かわ やま もり いけ ぬま たき おか のはら はたけ たんぼ ゆうひ あさひ
よぞら けむり ほのお こおり つらら どろ あられ ひょう たいよう ゆうやけ あさやけ さざなみ
`);

/** 暮らしの場。 */
export const PLACES = words(`
こうえん えき かいだん やね まど へや いえ ばすてい まち がっこう とおり こうさてん ほこら
ろうか だいどころ ふとん せんろ のりば かわら じんじゃ とりい おてら はかば とんねる はし
ふみきり ていぼう みなと さかみち ろじ うらにわ ものおき おしいれ げんかん べらんだ おくじょう
ちかてつ みせ いちば すいどう ほどう ばしょ にわ もん へい いど ふろば せんたくき あきち
こうじょう そうこ やたい えんがわ たたみ しょうじ てんじょう ゆかした
`);

/** 体。「〜の〜が」の後ろにも置く。 */
export const BODY = words(`
ゆび からだ こえ ほね あたま せなか むね かお うで くび のど まぶた ひたい つめ ほお ひざ
かかと しんぞう あし みみ くち かみ てのひら くちびる まつげ ひとみ はだ ち
`);

/** 時間。 */
export const TIMES = words(`
あした きのう こんや あさ よる ゆうべ まいにち ゆうがた そのひ ひるま あさって おととい
まよなか よあけ たそがれ ゆうぐれ はる なつ あき ふゆ むかし いつか さっき つぎのひ まえのひ
にちようび げつようび まいばん ことし らいねん さくねん
`);

/** 位置のことば。場所の語に重ねて長さを稼ぐ。 */
export const SIDES = words(
	`なか そと うえ した すみ おく まえ うら そば よこ むこう てまえ`,
);

/** 1モーラの句（原曲の句のモーラ数は p10 が 1）を埋める語。 */
export const ONE_MORA = words(`ひ て め き よ ち は ね`);

/** 飾り。長さの刻みを増やす。 */
export const ADJS = words(`
しろい くろい あかい あおい つめたい あたたかい ちいさな おおきな ふるい とおい ながい みじかい
まるい しずかな くらい あかるい やわらかい かたい おもい かるい あさい ふかい うすい にぶい
するどい さびた ぬれた かわいた こわれた あたらしい なつかしい
`);

// ---- 一般の歌もの ----

export const POP_SUBJECT = words(`
きみ ぼく こえ ゆめ かぜ ひかり なみだ あさ そら ほし はな きせつ せかい ことば おもいで
こころ うた あめ にじ つき たいよう みらい きおく やくそく てのひら ひとみ えがお かげ ゆうひ
さくら いのち ねがい きせき まち よる あした まなざし ぬくもり こたえ
`);
export const POP_PLACE = words(`
まち みち そら うみ へや えき おか まど こうえん かわ えきまえ ほどう ろじ おくじょう はま
みなと のはら ばすてい かわぞい さかみち こうてい ふみきり
`);
export const POP_TIME = words(`
いま あした きのう あさ よる ゆうがた なつ ふゆ はる あき よあけ ゆうぐれ まよなか あのひ
いつか ことし むかし
`);
export const POP_BODY = words(`こえ ゆめ なみだ ことば むね ひとみ てのひら`);

// ============================================================
// 動詞（辞書形から活用を組む）
// ============================================================

/** 五段（g）・一段（i）・来る（k）。 */
type Kind = "g" | "i" | "k";
type Verb = { dict: string; kind: Kind };
const verbs = (s: string): Verb[] =>
	words(s).map((w) => {
		const [dict, kind] = w.split(":");
		return { dict, kind: (kind ?? "g") as Kind };
	});

const I_ROW: Record<string, string> = {
	う: "い",
	く: "き",
	ぐ: "ぎ",
	す: "し",
	つ: "ち",
	ぬ: "に",
	ぶ: "び",
	む: "み",
	る: "り",
};
const A_ROW: Record<string, string> = {
	う: "わ",
	く: "か",
	ぐ: "が",
	す: "さ",
	つ: "た",
	ぬ: "な",
	ぶ: "ば",
	む: "ま",
	る: "ら",
};

/** 連用形（〜ます の前）。 */
const masuStem = (v: Verb): string => {
	if (v.kind === "k") return v.dict.slice(0, -2) + "き";
	if (v.kind === "i") return v.dict.slice(0, -1);
	return v.dict.slice(0, -1) + I_ROW[v.dict.slice(-1)];
};
/** 未然形（〜ない の前）。 */
const naiStem = (v: Verb): string => {
	if (v.kind === "k") return v.dict.slice(0, -2) + "こ";
	if (v.kind === "i") return v.dict.slice(0, -1);
	return v.dict.slice(0, -1) + A_ROW[v.dict.slice(-1)];
};
/** て形。 */
const teForm = (v: Verb): string => {
	if (v.kind === "k") return v.dict.slice(0, -2) + "きて";
	if (v.kind === "i") return v.dict.slice(0, -1) + "て";
	const head = v.dict.slice(0, -1);
	const last = v.dict.slice(-1);
	if (v.dict.endsWith("いく")) return head + "って";
	if (last === "う" || last === "つ" || last === "る") return head + "って";
	if (last === "む" || last === "ぶ" || last === "ぬ") return head + "んで";
	if (last === "く") return head + "いて";
	if (last === "ぐ") return head + "いで";
	return head + "して";
};
/** た形。 */
const taForm = (v: Verb): string =>
	teForm(v).replace(/て$/, "た").replace(/で$/, "だ");
/** て形＋補助動詞（「〜てくる」「〜でいく」）。 */
const teAux = (v: Verb, aux: string): string => teForm(v) + aux;

/** 場所から場所へ動くもの（降る・流れる）。到来と去りの両方を持つ。 */
const MOVE = verbs(`
ふる おちる:i ながれる:i とぶ のぼる しずむ はう うかぶ まう ころがる すべる はねる:i あふれる:i
わく はえる:i こぼれる:i もぐる ただよう くだる おりる:i すすむ ちる よる はいる でる:i
`);
/** 形が変わっていくもの（消える・溶ける）。 */
const CHANGE = verbs(`
きえる:i とける:i かれる:i こわれる:i くずれる:i ふえる:i へる かわる くさる こおる さびる:i
ほどける:i ちぎれる:i われる:i やける:i ぬれる:i かわく ちぢむ ふくらむ ひろがる にじむ
しおれる:i ねじれる:i しずまる ほころびる:i
`);
/** その場で続くもの（光る・揺れる）。 */
const STATE = verbs(`
ひかる ゆれる:i ならぶ まわる ねむる なく ふるえる:i ひびく さく かがやく うごく わらう うたう
ささやく ふく もえる:i にごる ゆがむ つらなる ひそむ のびる:i ざわめく またたく きしむ
`);
/** 打ち消しで使うもの（飛べない・見えない）。数は少なく（原曲の打ち消しは 3/16曲）。 */
const NEGATABLE = verbs(
	`とべる:i みえる:i うごく きこえる:i とまる おわる もどる ねむれる:i`,
);

/** 光景の文の動詞。普通体と報告体。 */
export const sceneVerbs = (): Record<LyricRegister, string[]> => {
	const plain: string[] = [];
	const report: string[] = [];
	for (const v of MOVE) {
		plain.push(teAux(v, "くる"), teAux(v, "いく"), taForm(v));
		report.push(
			teAux(v, "きました"),
			teAux(v, "いきました"),
			`${masuStem(v)}ました`,
		);
	}
	for (const v of CHANGE) {
		plain.push(teAux(v, "いく"), taForm(v), teAux(v, "いる"));
		report.push(
			teAux(v, "いきました"),
			`${masuStem(v)}ました`,
			teAux(v, "いました"),
		);
	}
	for (const v of STATE) {
		plain.push(teAux(v, "いる"), taForm(v));
		report.push(teAux(v, "いました"), `${masuStem(v)}ました`);
	}
	for (const v of NEGATABLE) {
		plain.push(`${naiStem(v)}ない`);
		report.push(`${masuStem(v)}ませんでした`);
	}
	return { plain, report };
};

/**
 * 報告体の語り手の語（docs/lyric-design.md §17）。主語は書かない。
 *  - causes: 「〜ので／〜から」の前に置く過去形（到来は「〜てきた」）
 *  - moves: 語り手が移る（場所は「へ」「から」）
 *  - stays: 語り手がとどまる（場所は「で」「に」）
 *  - objActs: 「〜を」を取る語り手の動作
 */
export type Narration = {
	causes: string[];
	moves: string[];
	stays: string[];
	objActs: string[];
};

const MOVES = verbs(`
かえる いく はしる いそぐ にげる:i あるく もどる でかける:i むかう わたる すすむ ひきかえす
とおる まわる おりる:i
`);
const STAYS = verbs(`
まつ ねむる かくれる:i ねる:i すわる たつ うずくまる だまる いのる とまる のこる ふせる:i
`);
const OBJ_ACTS = verbs(`
みる:i ひろう かぞえる:i さがす よける:i しまう あつめる:i うめる:i つつむ ふく ならべる:i
ながめる:i なでる:i あらう すてる:i わすれる:i よぶ おう ほる つむ もやす かくす ひろげる:i
`);

export const kaiwaiNarration = (): Narration => ({
	causes: [
		...MOVE.map((v) => teAux(v, "きた")),
		...CHANGE.map(taForm),
		...STATE.map(taForm),
	],
	moves: MOVES.map((v) => `${masuStem(v)}ました`),
	stays: STAYS.map((v) => `${masuStem(v)}ました`),
	objActs: OBJ_ACTS.map((v) => `${masuStem(v)}ました`),
});

const POP_DICT = verbs(`
とどく わらう めぐる かさなる つづく ひかる きえる:i あるく まつ ゆれる:i うたう ほどける:i
かがやく すれちがう とける:i ひろがる こぼれる:i あふれる:i ふりむく ねむる さく ちる はしる
とぶ うまれる:i
`);

export const popVerbs = (): Record<LyricRegister, string[]> => ({
	plain: [
		...POP_DICT.map((v) => v.dict),
		...POP_DICT.map(taForm),
		"まぶしい",
		"しずか",
		"とおい",
	],
	report: POP_DICT.map((v) => `${masuStem(v)}ました`),
});

export const popNarration = (): Narration => ({
	causes: [
		"ひかった",
		"きえた",
		"とどいた",
		"かさなった",
		"つづいた",
		"ふった",
	],
	moves: ["あるきました", "かえりました", "はしりました", "むかいました"],
	stays: ["まちました", "うたいました", "ねむりました", "わらいました"],
	objActs: ["みました", "さがしました", "おもいだしました", "かぞえました"],
});
