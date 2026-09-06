/**
 * 調性格論に基づくベース調および雰囲気の定義と抽選ロジック。
 *
 * ## 背景
 * バロック〜古典派の調性格論（M.A.シャルパンティエ『作曲規則』、J.マッテゾン、
 * C.F.D.シューバルト等の文献やハルモニア楽典サイトのまとめ）に基づき、
 * 24調（長調12調・短調12調）の特徴を定義し、UIの幅がコンパクトになるよう
 * 類似する形容詞を8つの雰囲気カテゴリに集約している。
 */

export type KeyMode = "major" | "minor";

export type ComposeMoodId =
	| "mood_happy"
	| "mood_triumphant"
	| "mood_fierce"
	| "mood_solemn"
	| "mood_plaintive"
	| "mood_melancholy"
	| "mood_anxious"
	| "mood_dark";

export type ComposeKeyTarget = {
	id: string;
	name: string;
	label: string;
	mode: KeyMode;
	/** ハ長調（長調）またはイ短調（短調）からの移調量（半音、-5〜+6） */
	rootShift: number;
	moodId: ComposeMoodId;
	/** 調性格のキーワード・雰囲気説明 */
	description: string;
};

export type ComposeMoodGroup = {
	id: ComposeMoodId;
	label: string;
	description: string;
	keyIds: string[];
};

/**
 * 24調のマスターデータ。
 * 長調はハ長調（C=0）、短調はイ短調（Am=0）からの半音シフト（-5〜+6）で管理。
 */
export const COMPOSE_KEYS: Record<string, ComposeKeyTarget> = {
	// --- 長調 (12調) ---
	key_C: {
		id: "key_C",
		name: "C",
		label: "ハ長調 (C)",
		mode: "major",
		rootShift: 0,
		moodId: "mood_happy",
		description: "無垢に喜ばしい、純粋、素朴、出発",
	},
	key_Db: {
		id: "key_Db",
		name: "D♭",
		label: "変ニ長調 (D♭)",
		mode: "major",
		rootShift: 1,
		moodId: "mood_melancholy",
		description: "悲しみ、憂鬱な、甘美な感傷（嬰ハ長調と同音）",
	},
	key_D: {
		id: "key_D",
		name: "D",
		label: "ニ長調 (D)",
		mode: "major",
		rootShift: 2,
		moodId: "mood_triumphant",
		description: "意気揚々とした、勝利の、喊声、華やか",
	},
	key_Eb: {
		id: "key_Eb",
		name: "E♭",
		label: "変ホ長調 (E♭)",
		mode: "major",
		rootShift: 3,
		moodId: "mood_dark",
		description: "厳しい、きつい、それでいて愛に満ちた、荘重",
	},
	key_E: {
		id: "key_E",
		name: "E",
		label: "ホ長調 (E)",
		mode: "major",
		rootShift: 4,
		moodId: "mood_fierce",
		description: "けんかっ早い、荒々しい、輝かしい情熱",
	},
	key_F: {
		id: "key_F",
		name: "F",
		label: "ヘ長調 (F)",
		mode: "major",
		rootShift: 5,
		moodId: "mood_fierce",
		description: "怒り狂った、気性の荒い、一時的な悲嘆、激動",
	},
	key_Gb: {
		id: "key_Gb",
		name: "G♭",
		label: "変ト長調 (G♭)",
		mode: "major",
		rootShift: 6,
		moodId: "mood_triumphant",
		description: "困難の打破、安堵のため息、凱旋（嬰ヘ長調と同音）",
	},
	key_G: {
		id: "key_G",
		name: "G",
		label: "ト長調 (G)",
		mode: "major",
		rootShift: -5,
		moodId: "mood_solemn",
		description: "厳粛な、崇高な、幻想、誠実、広がり",
	},
	key_Ab: {
		id: "key_Ab",
		name: "A♭",
		label: "変イ長調 (A♭)",
		mode: "major",
		rootShift: -4,
		moodId: "mood_dark",
		description: "死、永遠、裁き、深遠な瞑想",
	},
	key_A: {
		id: "key_A",
		name: "A",
		label: "イ長調 (A)",
		mode: "major",
		rootShift: -3,
		moodId: "mood_happy",
		description: "うれしい、牧歌的な、愛の告白、きらびやか",
	},
	key_Bb: {
		id: "key_Bb",
		name: "B♭",
		label: "変ロ長調 (B♭)",
		mode: "major",
		rootShift: -2,
		moodId: "mood_happy",
		description: "喜ばしい、風変わりな、陽気な、軽快",
	},
	key_B: {
		id: "key_B",
		name: "B",
		label: "ロ長調 (B)",
		mode: "major",
		rootShift: -1,
		moodId: "mood_fierce",
		description: "どぎつい、強烈な、荒っぽい、猛烈",
	},

	// --- 短調 (12調) ---
	key_Am: {
		id: "key_Am",
		name: "Am",
		label: "イ短調 (Am)",
		mode: "minor",
		rootShift: 0,
		moodId: "mood_solemn",
		description: "柔らかな、物悲しい、敬虔な、素朴な哀愁",
	},
	key_Bbm: {
		id: "key_Bbm",
		name: "B♭m",
		label: "変ロ短調 (B♭m)",
		mode: "minor",
		rootShift: 1,
		moodId: "mood_dark",
		description: "恐ろしい、暗闇、嘲るような、不気味（嬰イ短調と同音）",
	},
	key_Bm: {
		id: "key_Bm",
		name: "Bm",
		label: "ロ短調 (Bm)",
		mode: "minor",
		rootShift: 2,
		moodId: "mood_melancholy",
		description: "孤独な、憂鬱な、忍耐、静かな諦念",
	},
	key_Cm: {
		id: "key_Cm",
		name: "Cm",
		label: "ハ短調 (Cm)",
		mode: "minor",
		rootShift: 3,
		moodId: "mood_plaintive",
		description: "純粋に悲しげな、恋わずらいの、悲劇的",
	},
	key_Csm: {
		id: "key_Csm",
		name: "C♯m",
		label: "嬰ハ短調 (C♯m)",
		mode: "minor",
		rootShift: 4,
		moodId: "mood_melancholy",
		description: "落胆、泣き叫んだ、悲涙の、深い嘆き",
	},
	key_Dm: {
		id: "key_Dm",
		name: "Dm",
		label: "ニ短調 (Dm)",
		mode: "minor",
		rootShift: 5,
		moodId: "mood_solemn",
		description: "厳粛な、敬虔な、思索的な、重厚な祈り",
	},
	key_Ebm: {
		id: "key_Ebm",
		name: "E♭m",
		label: "変ホ短調 (E♭m)",
		mode: "minor",
		rootShift: 6,
		moodId: "mood_anxious",
		description: "深い苦悩、実存的な不安、戦慄（嬰ニ短調と同音）",
	},
	key_Em: {
		id: "key_Em",
		name: "Em",
		label: "ホ短調 (Em)",
		mode: "minor",
		rootShift: -5,
		moodId: "mood_plaintive",
		description: "弱々しい、なまめかしい、落ち着きのない、繊細",
	},
	key_Fm: {
		id: "key_Fm",
		name: "Fm",
		label: "ヘ短調 (Fm)",
		mode: "minor",
		rootShift: -4,
		moodId: "mood_plaintive",
		description: "ぼんやりした、物悲しい、しめやかな、葬送",
	},
	key_Fsm: {
		id: "key_Fsm",
		name: "F♯m",
		label: "嬰ヘ短調 (F♯m)",
		mode: "minor",
		rootShift: -3,
		moodId: "mood_anxious",
		description: "陰気な、激しい憤り、暗い情念",
	},
	key_Gm: {
		id: "key_Gm",
		name: "Gm",
		label: "ト短調 (Gm)",
		mode: "minor",
		rootShift: -2,
		moodId: "mood_anxious",
		description: "不満、不安、やるせなさ、悲痛な叫び",
	},
	key_Abm: {
		id: "key_Abm",
		name: "A♭m",
		label: "変イ短調 (A♭m)",
		mode: "minor",
		rootShift: -1,
		moodId: "mood_anxious",
		description: "不服な、嘆きの、泣き叫んだ（嬰ト短調と同音）",
	},
};

/**
 * 似た形容詞をまとめた8つの雰囲気グループ。
 */
export const COMPOSE_MOOD_GROUPS: ComposeMoodGroup[] = [
	{
		id: "mood_happy",
		label: "喜ばしい・陽気な曲",
		description: "無垢に喜ばしい、牧歌的、愛の告白、風変わりで陽気",
		keyIds: ["key_C", "key_A", "key_Bb"],
	},
	{
		id: "mood_triumphant",
		label: "勝利・力強い曲",
		description: "意気揚々、勝利の喊声、困難の打破、安堵のため息",
		keyIds: ["key_D", "key_Gb"],
	},
	{
		id: "mood_fierce",
		label: "激しい・荒々しい曲",
		description: "けんかっ早い、怒り狂った気性の荒さ、どぎつく猛烈",
		keyIds: ["key_E", "key_F", "key_B"],
	},
	{
		id: "mood_solemn",
		label: "厳粛・幻想的な曲",
		description: "厳粛、崇高、幻想、敬虔、思索的、柔らかな物悲しさ",
		keyIds: ["key_G", "key_Dm", "key_Am"],
	},
	{
		id: "mood_plaintive",
		label: "物悲しい・哀愁の曲",
		description: "純粋に悲しげ、恋わずらい、落ち着きのない、しめやかな悲哀",
		keyIds: ["key_Cm", "key_Em", "key_Fm"],
	},
	{
		id: "mood_melancholy",
		label: "憂鬱・孤独な曲",
		description: "悲しみ、憂鬱、孤独、忍耐、落胆、悲涙の嘆き",
		keyIds: ["key_Db", "key_Bm", "key_Csm"],
	},
	{
		id: "mood_anxious",
		label: "不安・苦悩な曲",
		description: "不満、不安、深い苦悩、実存的不安、陰気な憤り、嘆き",
		keyIds: ["key_Gm", "key_Ebm", "key_Fsm", "key_Abm"],
	},
	{
		id: "mood_dark",
		label: "暗闇・重厚な曲",
		description: "厳しい愛、死、永遠、裁き、恐ろしい暗闇、嘲り",
		keyIds: ["key_Eb", "key_Ab", "key_Bbm"],
	},
];

export const MAJOR_KEY_IDS = Object.values(COMPOSE_KEYS)
	.filter((k) => k.mode === "major")
	.map((k) => k.id);

export const MINOR_KEY_IDS = Object.values(COMPOSE_KEYS)
	.filter((k) => k.mode === "minor")
	.map((k) => k.id);

export type ResolvedComposeKey = {
	mode?: KeyMode;
	rootShift: number;
	keyName: string;
	keyLabel: string;
	moodLabel?: string;
	description?: string;
};

const pickItem = <T>(list: T[], rnd: () => number): T =>
	list[Math.floor(rnd() * list.length)];

/**
 * プルダウン等の指定値（"any", "major", "minor", "mood_*", "key_*"）から
 * 具体的な調のモードと移調量（rootShift）を抽選・解決する。
 */
export const resolveComposeKey = (
	choice?: string,
	rnd: () => number = Math.random,
): ResolvedComposeKey => {
	const c = (choice ?? "").trim() || "any";

	// 1. 完全個別指定（key_*）
	if (COMPOSE_KEYS[c]) {
		const target = COMPOSE_KEYS[c];
		const mood = COMPOSE_MOOD_GROUPS.find((m) => m.id === target.moodId);
		return {
			mode: target.mode,
			rootShift: target.rootShift,
			keyName: target.name,
			keyLabel: target.label,
			moodLabel: mood?.label,
			description: target.description,
		};
	}

	// 2. 雰囲気カテゴリからの抽選（mood_*）
	const mood = COMPOSE_MOOD_GROUPS.find((m) => m.id === c);
	if (mood) {
		const pickedKeyId = pickItem(mood.keyIds, rnd);
		const target = COMPOSE_KEYS[pickedKeyId];
		return {
			mode: target.mode,
			rootShift: target.rootShift,
			keyName: target.name,
			keyLabel: target.label,
			moodLabel: mood.label,
			description: target.description,
		};
	}

	// 3. 長調全体からの抽選
	if (c === "major") {
		const pickedKeyId = pickItem(MAJOR_KEY_IDS, rnd);
		const target = COMPOSE_KEYS[pickedKeyId];
		const targetMood = COMPOSE_MOOD_GROUPS.find((m) => m.id === target.moodId);
		return {
			mode: "major",
			rootShift: target.rootShift,
			keyName: target.name,
			keyLabel: target.label,
			moodLabel: targetMood?.label,
			description: target.description,
		};
	}

	// 4. 短調全体からの抽選
	if (c === "minor") {
		const pickedKeyId = pickItem(MINOR_KEY_IDS, rnd);
		const target = COMPOSE_KEYS[pickedKeyId];
		const targetMood = COMPOSE_MOOD_GROUPS.find((m) => m.id === target.moodId);
		return {
			mode: "minor",
			rootShift: target.rootShift,
			keyName: target.name,
			keyLabel: target.label,
			moodLabel: targetMood?.label,
			description: target.description,
		};
	}

	// 5. 希望なし (any): 長調・短調の制約なし、全24調からランダム抽選
	const allKeyIds = Object.keys(COMPOSE_KEYS);
	const pickedKeyId = pickItem(allKeyIds, rnd);
	const target = COMPOSE_KEYS[pickedKeyId];
	const targetMood = COMPOSE_MOOD_GROUPS.find((m) => m.id === target.moodId);
	return {
		mode: undefined, // コード進行の長短制約は掛けず従来通りランダム
		rootShift: target.rootShift,
		keyName: target.name,
		keyLabel: target.label,
		moodLabel: targetMood?.label,
		description: target.description,
	};
};

/**
 * UI表示用の説明テキストを取得。
 */
export const getComposeKeyDescription = (choice: string): string => {
	if (!choice || choice === "any") return "全24調からランダムに決定します";
	if (choice === "major") return "12の長調の中からランダムに抽選します";
	if (choice === "minor") return "12の短調の中からランダムに抽選します";
	const mood = COMPOSE_MOOD_GROUPS.find((m) => m.id === choice);
	if (mood) return `${mood.label}：${mood.description}`;
	const target = COMPOSE_KEYS[choice];
	if (target) return `${target.label}：${target.description}`;
	return "";
};
