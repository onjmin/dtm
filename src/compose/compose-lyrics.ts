/**
 * 仮歌詞の文を組む。くじ引きで単語を並べるのではなく、**文の型に語を当てて、句のモーラ数
 * ぴったりに詰める**。規則と実測は [docs/lyric-design.md](../../docs/lyric-design.md)。
 *
 * 守る約束（実測から）:
 *  - ひらがなだけ。小書きかな（ゃゅょ）は使わない——アプリは歌詞を**1文字＝1音符**で読むので、
 *    小書きかなを入れると文字数とモーラ数（`normalizeLyrics`）がずれる。
 *  - 伸ばし（`ー`）は使わない（原曲は16曲中15曲で2%以下）。
 *  - 文末は曲ごとにひとつの形へ寄せる（報告体と言い切りを混ぜない）。
 */

/**
 * 語のモーラ数。ここの語彙は小書きかなを使わないので、文字数がそのままモーラ数になる
 * （`src/voice/lyrics.ts` の `normalizeLyrics` と同じ数。あちらは歌唱合成エンジンを
 * 連れてくるので読まない。一致は `scripts/test/check-compose-lyrics.ts` が検算する）。
 */
const lyricMora = (text: string): number => [...text].length;

/** 語の並べ方。`kaiwai` は海鮮系の報告型、`pop` は一般の歌もの。 */
export type LyricVocabName = "kaiwai" | "pop";
/** 文末の寄せ方。曲ごとにどちらかへ決める。 */
export type LyricRegister = "report" | "plain";

type Chunk = { text: string; mora: number };
/** 文の型のひとこま。`optional` は飛ばせる。 */
type Slot = { chunks: Chunk[]; optional: boolean };

const chunk = (text: string): Chunk => ({ text, mora: lyricMora(text) });
const cross = (heads: string[], tails: string[]): string[] =>
	heads.flatMap((h) => tails.map((t) => h + t));

// ============================================================
// 語彙
// ============================================================

/** 海のもの。暮らしの場へ方向違いで入ってくる側（実測: 9/16曲）。 */
const SEA = [
	"いわし",
	"くらげ",
	"さかな",
	"まぐろ",
	"くじら",
	"うろこ",
	"えび",
	"たこ",
	"いか",
	"すなめり",
];
/** 自然・天（実測: 14/16曲）。 */
const NATURE = [
	"そら",
	"つち",
	"うみ",
	"あめ",
	"ゆき",
	"くも",
	"ひかり",
	"つき",
	"ほし",
	"かぜ",
	"みず",
	"しお",
	"なみ",
	"すな",
	"かげ",
];
/** 暮らしの場（実測: 13/16曲）。 */
const PLACE = [
	"こうえん",
	"えき",
	"かいだん",
	"やね",
	"まど",
	"へや",
	"いえ",
	"ばすてい",
	"まち",
	"がっこう",
	"とおり",
	"こうさてん",
	"ほこら",
	"ろうか",
	"だいどころ",
	"ふとん",
	"しんぶん",
	"せんろ",
	"のりば",
	"かわら",
];
/** 体（実測: 8/16曲）。 */
const BODY = [
	"ゆび",
	"からだ",
	"こえ",
	"ほね",
	"あたま",
	"せなか",
	"むね",
	"かお",
];
/** 時間（実測: 13/16曲）。 */
const TIME = [
	"あした",
	"きのう",
	"こんや",
	"あさ",
	"よる",
	"ゆうべ",
	"まいにち",
	"ゆうがた",
	"そのひ",
	"ひるま",
];
/** 1モーラの句（実測: 句のモーラ数は p10 が 1）を埋める語。 */
const ONE_MORA = ["ひ", "て", "め", "き", "よ", "ち"];
/** 位置のことば。場所の語に重ねて長さを稼ぐ。 */
const SIDES = [
	"なか",
	"そと",
	"うえ",
	"した",
	"すみ",
	"おく",
	"まえ",
	"うら",
	"そば",
];
/** 飾り。長さの刻みを増やすために置く（意味は足さない）。 */
const ADJ = [
	"しろい",
	"くろい",
	"つめたい",
	"ちいさな",
	"おおきな",
	"ふるい",
	"とおい",
];

/** 一般の歌ものの語（旧 `LYRIC_WORDS` の素）。 */
const POP_SUBJECT = [
	"きみ",
	"ぼく",
	"こえ",
	"ゆめ",
	"かぜ",
	"ひかり",
	"なみだ",
	"あさ",
	"そら",
	"ほし",
	"はな",
	"きせつ",
	"せかい",
	"ことば",
	"おもいで",
];
const POP_PLACE = [
	"まち",
	"みち",
	"そら",
	"うみ",
	"へや",
	"えき",
	"おか",
	"まど",
	"こうえん",
	"かわ",
];
const POP_TIME = [
	"いま",
	"あした",
	"きのう",
	"あさ",
	"よる",
	"ゆうがた",
	"なつ",
	"ふゆ",
	"はる",
	"あき",
];

/**
 * 動詞句。報告体（〜ました）と言い切り（〜る・〜た）で別に持つ。
 * 自動詞だけを置く——目的語（「〜を」）を組む型が無いので、他動詞を入れると文が壊れる。
 */
const KAIWAI_VERBS: Record<LyricRegister, string[]> = {
	report: [
		"はえてきました",
		"ふってきました",
		"ながれてきました",
		"しずんでいきました",
		"きえていきました",
		"とんでいきました",
		"ならんでいました",
		"ゆれていました",
		"あふれていました",
		"とけていきました",
		"まわっていました",
		"のぼってきました",
		"おちてきました",
		"ひかっていました",
		"みえなくなりました",
		"うごかなくなりました",
		"とまりました",
		"ありました",
		"いました",
		"きました",
		"おちました",
		"はえました",
		"ふえました",
		"きませんでした",
		"みえませんでした",
	],
	plain: [
		"はえてくる",
		"ふってくる",
		"ながれてくる",
		"しずんでいく",
		"きえていく",
		"とんでいく",
		"ならんでいる",
		"ゆれている",
		"あふれていく",
		"とけていく",
		"のぼってくる",
		"おちてくる",
		"まわっている",
		"ひかっている",
		"はえた",
		"ふった",
		"しずんだ",
		"きえた",
		"とんだ",
		"ゆれた",
		"とけた",
		"まわった",
		"おちた",
		"みえない",
		"とべない",
	],
};
/**
 * 報告体の語り手の型に使う語（docs/lyric-design.md §17）。異変を「〜ので」で受けて、
 * 語り手が暮らしの動作で受け流す。主語は書かない（日記と同じく語り手は省く）。
 *  - causes: 「〜ので／〜から」の前に置く過去形
 *  - moves: 語り手が移る（場所は「へ」「から」）
 *  - stays: 語り手がとどまる（場所は「で」「に」）
 *  - objActs: 「〜を」を取る語り手の動作
 */
type Narration = {
	causes: string[];
	moves: string[];
	stays: string[];
	objActs: string[];
};
const KAIWAI_NARRATION: Narration = {
	causes: [
		"ふってきた",
		"はえてきた",
		"おちてきた",
		"ながれてきた",
		"のぼってきた",
		"きえた",
		"しずんだ",
		"とけた",
		"ゆれた",
		"ひかった",
		"ふえた",
		"ならんだ",
	],
	moves: [
		"かえりました",
		"いきました",
		"はしりました",
		"いそぎました",
		"にげました",
		"あるきました",
		"もどりました",
	],
	stays: [
		"まちました",
		"ねむりました",
		"かくれました",
		"ねました",
		"すわりました",
	],
	objActs: [
		"みました",
		"ひろいました",
		"かぞえました",
		"さがしました",
		"よけました",
		"しまいました",
		"あつめました",
		"うめました",
	],
};
const POP_NARRATION: Narration = {
	causes: [
		"ひかった",
		"きえた",
		"とどいた",
		"かさなった",
		"つづいた",
		"ふった",
	],
	moves: ["あるきました", "かえりました", "はしりました"],
	stays: ["まちました", "うたいました", "ねむりました"],
	objActs: ["みました", "さがしました", "おもいだしました", "かぞえました"],
};

const POP_VERBS: Record<LyricRegister, string[]> = {
	report: [
		"とどきました",
		"わらいました",
		"めぐりました",
		"かさなりました",
		"つづきました",
		"ひかりました",
		"きえました",
		"あるきました",
		"まちました",
	],
	plain: [
		"とどく",
		"わらう",
		"めぐる",
		"かさなる",
		"つづく",
		"ひかる",
		"きえる",
		"あるく",
		"まつ",
		"とどいた",
		"わらった",
		"きえた",
		"つづいた",
		"まぶしい",
		"しずか",
		"とおい",
	],
};

// ============================================================
// 曲ごとの登場物（キャスト）
// ============================================================

/** 語彙の素。ここから曲ごとに少しだけ引いて、その曲の登場物にする。 */
type Base = {
	/** 主語・名詞止めになる語。 */
	heads: string[];
	/** 場所の語。 */
	places: string[];
	/** 時間の語。 */
	times: string[];
	/** 「〜の〜が」の後ろに置く語。 */
	bodies: string[];
	verbs: Record<LyricRegister, string[]>;
	narration: Narration;
};

const BASES: Record<LyricVocabName, Base> = {
	kaiwai: {
		heads: [...SEA, ...NATURE, ...BODY],
		places: PLACE,
		times: TIME,
		bodies: BODY,
		verbs: KAIWAI_VERBS,
		narration: KAIWAI_NARRATION,
	},
	pop: {
		heads: POP_SUBJECT,
		places: POP_PLACE,
		times: POP_TIME,
		bodies: ["こえ", "ゆめ", "なみだ", "ことば"],
		verbs: POP_VERBS,
		narration: POP_NARRATION,
	},
};

/** 曲ごとの登場物の数。原曲は少ない登場物が何度も戻ってくる（docs/lyric-design.md の層⑤）。 */
const CAST = {
	heads: 6,
	places: 3,
	times: 3,
	bodies: 3,
	verbs: 8,
	causes: 4,
	moves: 2,
	stays: 2,
	objActs: 3,
} as const;

/** 重複なく n 個引く。引く順も曲ごとに変わる。 */
const sample = <T>(xs: readonly T[], n: number, rnd: () => number): T[] => {
	const pool = [...xs];
	const out: T[] = [];
	while (out.length < n && pool.length > 0)
		out.push(...pool.splice(Math.floor(rnd() * pool.length) % pool.length, 1));
	return out;
};

const castOf = (
	base: Base,
	register: LyricRegister,
	rnd: () => number,
): Base => ({
	heads: sample(base.heads, CAST.heads, rnd),
	places: sample(base.places, CAST.places, rnd),
	times: sample(base.times, CAST.times, rnd),
	bodies: sample(base.bodies, CAST.bodies, rnd),
	verbs: {
		report: [],
		plain: [],
		[register]: sample(base.verbs[register], CAST.verbs, rnd),
	} as Record<LyricRegister, string[]>,
	// 語り手の語は報告体の曲だけで引く（言い切りの曲の乱数の進みを変えない）。
	narration:
		register === "report"
			? {
					causes: sample(base.narration.causes, CAST.causes, rnd),
					moves: sample(base.narration.moves, CAST.moves, rnd),
					stays: sample(base.narration.stays, CAST.stays, rnd),
					objActs: sample(base.narration.objActs, CAST.objActs, rnd),
				}
			: { causes: [], moves: [], stays: [], objActs: [] },
});

// ============================================================
// 文の型
// ============================================================

type Vocab = {
	/** 「〜が」「〜は」の形。動詞句が続くときだけ使う。 */
	subjects: string[];
	/** 「〜に」「〜で」「〜から」の形。 */
	places: string[];
	/** 時を表す語。 */
	times: string[];
	/** 名詞止めの末尾。助詞で終わらせない（「やねへむねは」のような尻切れを作らない）。 */
	nounEnds: string[];
	/** 断片を埋める素の名詞。 */
	nouns: string[];
	verbs: string[];
	/** 「〜が〜たので」「〜が〜たから」。報告体の曲だけ中身を持つ。 */
	causes: string[];
	/** 語り手が移る・とどまる（主語を書かない）。場所は動きに合う助詞の形を別に持つ。 */
	moves: string[];
	stays: string[];
	movePlaces: string[];
	stayPlaces: string[];
	/** 「〜を」の形。 */
	objects: string[];
	/** 「〜を」に続く語り手の動作。 */
	objActs: string[];
};

/**
 * 主語の助詞は「が」に寄せる（実測の「は」は中央3回で、主語を全部「は」にすると桁が変わる）。
 * 同じ語を重ねて入れると、その分だけ引かれやすくなる。
 */
const subjectForms = (heads: string[]): string[] => [
	...cross(heads, ["が"]),
	...cross(heads, ["が"]),
	...cross(heads, ["が"]),
	...cross(heads, ["は", "も"]),
];

/** キャストから、文の型へ入れる語の形を作る。 */
const formsOf = (cast: Base, register: LyricRegister): Vocab => ({
	subjects: [
		...subjectForms(cast.heads),
		...cross(cross(ADJ, cast.heads), ["が"]),
		...cross(cross(cast.heads, ["の"]), cross(cast.bodies, ["が"])),
	],
	places: [
		...cross(cast.places, ["に", "で", "へ", "から"]),
		...cross(cross(cast.places, ["の"]), cross(SIDES, ["に", "で", "から"])),
	],
	times: [...cast.times, ...cross(cast.times, ["の", "には", "から", "まで"])],
	nounEnds: [
		...cast.heads,
		...cast.places,
		...cross(ADJ, cast.heads),
		...cross(cross(cast.heads, ["の"]), [...cast.heads, ...cast.places]),
	],
	nouns: [...cast.heads, ...cast.places, ...cast.times, ...ONE_MORA],
	verbs: cast.verbs[register],
	causes: cross(
		[...cross(cast.heads, ["が"]), ...cross(cross(ADJ, cast.heads), ["が"])],
		cross(cast.narration.causes, ["ので", "から"]),
	),
	moves: cast.narration.moves,
	stays: cast.narration.stays,
	movePlaces: cross(cast.places, ["へ", "から"]),
	stayPlaces: [
		...cross(cast.places, ["で", "に"]),
		...cross(cross(cast.places, ["の"]), cross(SIDES, ["で", "に"])),
	],
	objects: cross(
		[...cast.heads, ...cross(cross(cast.heads, ["の"]), cast.bodies)],
		["を"],
	),
	objActs: cast.narration.objActs,
});

/**
 * 文の型。前から順に埋め、`optional` は飛ばせる。最後は必ず動詞句か名詞で閉じる。
 * 「時間→場所→主語→動き」の順は報告型の語り（docs/lyric-design.md §2）。
 */
const shapesOf = (vocab: Vocab): Slot[][] => {
	const slot = (words: string[], optional = false): Slot => ({
		chunks: words.map(chunk),
		optional,
	});
	const subject = slot(vocab.subjects);
	const place = slot(vocab.places, true);
	const time = slot(vocab.times, true);
	const verb = slot(vocab.verbs);
	const nounEnd = slot(vocab.nounEnds);
	return [
		[time, place, subject, verb],
		[place, subject, verb],
		[subject, verb],
		[time, place, nounEnd], // 名詞止め（実測で6割を占める「どれでもない」側）
		[place, nounEnd],
	];
};

/**
 * 報告体の語り手の型（docs/lyric-design.md §17）。異変を「〜ので」で受けて帰る・逃げる、
 * どこかへ行く、何かを拾う・数える。主語は書かない。言い切りの曲では空。
 */
const narrationShapesOf = (vocab: Vocab): Slot[][] => {
	if (vocab.moves.length === 0) return [];
	const slot = (words: string[], optional = false): Slot => ({
		chunks: words.map(chunk),
		optional,
	});
	const time = slot(vocab.times, true);
	return [
		[slot(vocab.causes), slot([...vocab.moves, ...vocab.stays])],
		[time, slot(vocab.movePlaces, true), slot(vocab.moves)],
		[time, slot(vocab.stayPlaces, true), slot(vocab.stays)],
		[time, slot(vocab.objects), slot(vocab.objActs)],
	];
};

/**
 * 報告体の曲で、句を語り手の型から組む割合。残りは光景の報告（主語＋〜ました）と名詞止め。
 * 原曲の報告体の曲は「〜ました」が1曲に数回で、光景の文と混ざる（§17）。
 */
const NARRATION_SHARE = 0.5;

/** 残り m モーラを、スロット 0〜i でぴったり使い切れるか。 */
const feasible = (
	shape: Slot[],
	i: number,
	m: number,
	memo: Map<number, boolean>,
): boolean => {
	if (i < 0) return m === 0;
	const key = i * 4096 + m;
	const hit = memo.get(key);
	if (hit !== undefined) return hit;
	let ok = false;
	if (shape[i].optional && feasible(shape, i - 1, m, memo)) ok = true;
	if (!ok)
		ok = shape[i].chunks.some(
			(c) => c.mora <= m && feasible(shape, i - 1, m - c.mora, memo),
		);
	memo.set(key, ok);
	return ok;
};

/**
 * 型を1つ選んで、ぴったり mora の文を組む。組めなければ null。
 *
 * 決める順は**後ろから**（動詞句 → 主語 → 場所 → 時間）。前から決めると、時間と場所で
 * モーラを使い切ってしまい、残りに収まる短い動詞（「きました」「いました」）ばかりになる。
 * 足し算の可否は順番に依らないので、後ろから決めても同じ長さに収まる。
 */
const buildSentence = (
	shape: Slot[],
	mora: number,
	rnd: () => number,
): string | null => {
	const memo = new Map<number, boolean>();
	if (!feasible(shape, shape.length - 1, mora, memo)) return null;
	const picks: string[] = new Array(shape.length).fill("");
	let left = mora;
	for (let i = shape.length - 1; i >= 0; i--) {
		const slot = shape[i];
		// 飛ばす手も1つの候補として同列に扱う（空文字のまとまり）。
		const options: Chunk[] = [];
		if (slot.optional && feasible(shape, i - 1, left, memo))
			options.push({ text: "", mora: 0 });
		for (const c of slot.chunks)
			if (c.mora <= left && feasible(shape, i - 1, left - c.mora, memo))
				options.push(c);
		if (options.length === 0) return null;
		const picked = options[Math.floor(rnd() * options.length) % options.length];
		picks[i] = picked.text;
		left -= picked.mora;
	}
	return left === 0 ? picks.join("") : null;
};

/** 文にならない長さ（1〜3モーラなど）は、名詞を「の」でつないだ断片で埋める。 */
const buildFragment = (
	vocab: Vocab,
	mora: number,
	rnd: () => number,
): string => {
	const pool = vocab.nouns.map(chunk);
	let out = "";
	let left = mora;
	while (left > 0) {
		// 残りをちょうど埋められる語を優先し、無ければ短い語から引く。
		const exact = pool.filter((c) => c.mora === left);
		const fits = pool.filter((c) => c.mora < left);
		// 1モーラの語は必ずあるので、残りが1でも必ず埋まる。
		const options = exact.length
			? exact
			: fits.length
				? fits
				: ONE_MORA.map(chunk);
		const picked = options[Math.floor(rnd() * options.length) % options.length];
		out += picked.text;
		left -= picked.mora;
		if (left === 1) {
			out += ONE_MORA[Math.floor(rnd() * ONE_MORA.length) % ONE_MORA.length];
			left = 0;
		} else if (left > 0) {
			out += "の";
			left -= 1;
		}
	}
	// 「の」で終わってしまったら最後の1モーラを名詞へ差し替える。
	if (out.endsWith("の"))
		out = `${out.slice(0, -1)}${ONE_MORA[Math.floor(rnd() * ONE_MORA.length) % ONE_MORA.length]}`;
	return out;
};

/** ぴったり mora モーラの句。型に収まるなら文、収まらなければ断片。 */
const lyricPhrase = (
	shapes: Slot[][],
	vocab: Vocab,
	mora: number,
	rnd: () => number,
): string => {
	if (mora <= 0) return "";
	// 型は渡された順に試す（長い順＝時間＋場所つきから）。短い句では自然に後ろの型へ落ちる。
	let text: string | null = null;
	for (const shape of shapes) {
		text = buildSentence(shape, mora, rnd);
		if (text) break;
	}
	if (!text) text = buildFragment(vocab, mora, rnd);
	// 歌詞と音符は1対1。ここがずれると以降の歌詞が全部ずれるので、長さは最後に必ず合わせる。
	while (lyricMora(text) < mora)
		text += ONE_MORA[Math.floor(rnd() * ONE_MORA.length) % ONE_MORA.length];
	return lyricMora(text) > mora ? [...text].slice(0, mora).join("") : text;
};

/** 1つの文に収める長さの上限と下限。原曲の文はもっと長いが、1文で言い切れる範囲に区切る。 */
const SENTENCE_MAX = 16;
const SENTENCE_MIN = 4;

// ============================================================
// 母音の当て方（docs/lyric-design.md §5）
// ============================================================

/** かな1文字の母音。 */
const VOWEL_OF = ((): Map<string, string> => {
	const map = new Map<string, string>();
	for (const [row, v] of [
		["あかさたなはまやらわがざだばぱ", "a"],
		["いきしちにひみりぎじぢびぴ", "i"],
		["うくすつぬふむゆるぐずづぶぷ", "u"],
		["えけせてねへめれげぜでべぺ", "e"],
		["おこそとのほもよろごぞどぼぽ", "o"],
		["ん", "N"],
	] as const)
		for (const c of row) map.set(c, v);
	return map;
})();

/**
 * 伸びる音（4分以上）に乗る母音の点。原曲は あ 33→39%・い 21→25% と増え、
 * え 10→7%・お 16→13%・ん 3→1% と減る（4分以上1338音の実測）。う はほぼ変わらない。
 */
export const vowelFit = (text: string, isLong: readonly boolean[]): number => {
	let score = 0;
	const kana = [...text];
	for (let i = 0; i < kana.length && i < isLong.length; i++) {
		if (!isLong[i]) continue;
		const v = VOWEL_OF.get(kana[i]);
		if (v === "a" || v === "i") score++;
		else if (v === "e" || v === "o" || v === "N") score--;
	}
	return score;
};

/**
 * 母音の当て方を選ぶために引く候補の数。**2本で止める**。8本から最良を採ると
 * 伸びる音の あ が 53%・お が 2% まで寄ってしまい、原曲（あ39%・お13%）より極端になる。
 */
const VOWEL_TRIES = 2;

// ============================================================
// 入口
// ============================================================

/** 文末の形を曲ごとに1つ選ぶ（実測: 報告体 7/16曲、言い切り 11/16曲）。 */
const pickRegister = (rnd: () => number): LyricRegister =>
	rnd() < 0.4 ? "report" : "plain";

/** 1曲ぶんの仮歌詞を書く係。登場物と文末の形は曲ごとに1度だけ決める。 */
export type LyricWriter = {
	/** この曲の文末の形。 */
	register: LyricRegister;
	/** この曲の登場物。検算（`scripts/test/check-compose-lyrics.ts`）と調査のために出す。 */
	cast: { heads: string[]; places: string[]; times: string[]; verbs: string[] };
	/**
	 * ぴったり mora モーラの歌詞。`isLong`（音符ごとに4分以上か）を渡すと、
	 * 伸びる音に あ・い が来る候補を選ぶ。
	 */
	write: (mora: number, isLong?: readonly boolean[]) => string;
};

/**
 * 曲ごとの歌詞係を作る。**登場物（キャスト）をここで引いて固定する**ので、
 * 同じ語が曲の中で何度も戻ってくる（原曲の作り。docs/lyric-design.md の層⑤）。
 */
export const createLyricWriter = (options: {
	random: () => number;
	vocab?: LyricVocabName;
}): LyricWriter => {
	const rnd = options.random;
	const register = pickRegister(rnd);
	const cast = castOf(BASES[options.vocab ?? "pop"], register, rnd);
	const vocab = formsOf(cast, register);
	const shapes = shapesOf(vocab);
	const narrationShapes = narrationShapesOf(vocab);

	/** 句ごとの型の試し順。報告体の曲は半分の句で語り手の型を先に試す。 */
	const shapesForPhrase = (): Slot[][] => {
		if (narrationShapes.length === 0 || rnd() >= NARRATION_SHARE) return shapes;
		// 「〜ので」の型（先頭）は長い句でしか組めないので、半分はこれを先に試す。
		const rest = narrationShapes.length - 1;
		const first = rnd() < 0.5 ? 0 : 1 + (Math.floor(rnd() * rest) % rest);
		return [
			narrationShapes[first],
			...narrationShapes.filter((_, i) => i !== first),
			...shapes,
		];
	};
	const phrase = (mora: number): string =>
		lyricPhrase(shapesForPhrase(), vocab, mora, rnd);

	/** 息継ぎの間（4小節）は音符が20を超えることもあるので、文に区切って埋める。 */
	const spanOnce = (mora: number): string => {
		const out: string[] = [];
		let left = mora;
		while (left > 0) {
			if (left <= SENTENCE_MAX) {
				out.push(phrase(left));
				break;
			}
			const take = 8 + Math.floor(rnd() * 7);
			// 端切れ（4モーラ未満）を残さない。残るなら全部まとめて1文にする。
			if (left - take < SENTENCE_MIN) {
				out.push(phrase(left));
				break;
			}
			out.push(phrase(take));
			left -= take;
		}
		return out.join("");
	};

	return {
		register,
		cast: {
			heads: cast.heads,
			places: cast.places,
			times: cast.times,
			verbs: vocab.verbs,
		},
		write: (mora, isLong) => {
			if (mora <= 0) return "";
			if (!isLong || isLong.every((x) => !x)) return spanOnce(mora);
			// 候補をいくつか引いて、伸びる音に あ・い が来るものを採る。
			let best = "";
			let bestScore = Number.NEGATIVE_INFINITY;
			for (let i = 0; i < VOWEL_TRIES; i++) {
				const candidate = spanOnce(mora);
				const score = vowelFit(candidate, isLong);
				if (score > bestScore) {
					best = candidate;
					bestScore = score;
				}
			}
			return best;
		},
	};
};
