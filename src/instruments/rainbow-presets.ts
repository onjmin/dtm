/**
 * 音源バンク「レ淫棒」2版のバンクとプリセットの表。
 *
 * - プリセット（バンク・プログラム・日本語名）は onjmin/inc-sf2 の `sound/list.txt` から。
 * - バンクの名前は sf2 ごとに作者の付け方に従う。虹.版はバンク＝キャラで、Domino の音源定義の
 *   Map 名（シリーズの見出しは `series`）。お天気雨版はバンク＝シリーズで、配布の sforzando の
 *   フォルダ名（`000 王道淫夢` など）。キャラはバンクの中の音色のまとまり（Map 名）で `group` に持つ。
 * - 名前の無いバンク（虹.版の 125）は「バンク 125」。
 * - ドラム（バンク 128）は旋律の音源では使わないので入れない。
 */

export type BankedBank = {
	bank: number;
	/** バンクの名前（sf2 ごとの付け方）。 */
	name: string;
	/** バンクの上の見出し（虹.版の「淫夢」「クッキー☆」など）。 */
	series?: string;
};

export type BankedPreset = {
	/** .sf2 のバンク。 */
	bank: number;
	/** プログラム。 */
	program: number;
	/** 日本語の音色名（Domino の音源定義から）。 */
	name: string;
	/** バンクの中のまとまり（お天気雨版のキャラ）。 */
	group?: string;
};

/** 虹.のレ淫棒（20171022）。 */
export const NIJI_20171022_BANKS: readonly BankedBank[] = [
	{ bank: 0, name: "野獣", series: "淫夢" },
	{ bank: 1, name: "遠野", series: "淫夢" },
	{ bank: 2, name: "MUR", series: "淫夢" },
	{ bank: 3, name: "HTN", series: "淫夢" },
	{ bank: 4, name: "AOK", series: "淫夢" },
	{ bank: 5, name: "ひで", series: "淫夢" },
	{ bank: 6, name: "TKGW", series: "淫夢" },
	{ bank: 31, name: "淫夢その他", series: "淫夢" },
	{ bank: 32, name: "RU", series: "クッキー☆" },
	{ bank: 33, name: "UDK", series: "クッキー☆" },
	{ bank: 34, name: "HNS", series: "クッキー☆" },
	{ bank: 35, name: "YMN", series: "クッキー☆" },
	{ bank: 36, name: "NDK", series: "クッキー☆" },
	{ bank: 37, name: "YZY", series: "クッキー☆" },
	{ bank: 38, name: "YKMR(原発姉貴)", series: "クッキー☆" },
	{ bank: 40, name: "BNKRG", series: "クッキー☆☆" },
	{ bank: 41, name: "MZ", series: "クッキー☆☆" },
	{ bank: 47, name: "海綿体", series: "クッキー☆☆" },
	{ bank: 48, name: "KNN", series: "クッキー☆☆" },
	{ bank: 49, name: "AZS", series: "クッキー☆☆" },
	{ bank: 56, name: "RI", series: "クッキー☆☆" },
	{ bank: 64, name: "JOKER", series: "鍋☆" },
	{ bank: 72, name: "NYN", series: "クッソー☆" },
	{ bank: 73, name: "ICG", series: "クッソー☆" },
	{ bank: 74, name: "RRM", series: "クッソー☆" },
	{ bank: 75, name: "SZ", series: "クッソー☆" },
	{ bank: 88, name: "SRMY", series: "クッソー☆" },
	{ bank: 96, name: "CL(Cり)", series: "クラピー☆" },
	{ bank: 97, name: "NBR(ナビラ)", series: "クラピー☆" },
	{ bank: 98, name: "MIMI(銘々)", series: "クラピー☆" },
	{ bank: 104, name: "Web", series: "イースター☆" },
	{ bank: 105, name: "Kofji", series: "イースター☆" },
	{ bank: 113, name: "KN(きぬ)", series: "スペカ☆" },
	{ bank: 114, name: "BBAN(びびあん)", series: "スペカ☆" },
	{ bank: 115, name: "偽NYN(青目ルミコ)", series: "スペカ☆" },
	{ bank: 125, name: "バンク 125" },
	{ bank: 126, name: "レスリング", series: "レスリング" },
];

export const NIJI_20171022_PRESETS: readonly BankedPreset[] = [
	{ bank: 0, program: 0, name: "オォン！_P" },
	{ bank: 0, program: 1, name: "アォン！_P" },
	{ bank: 0, program: 2, name: "ンアッー！_P" },
	{ bank: 0, program: 3, name: "ンアッー！_S" },
	{ bank: 0, program: 4, name: "ンアッー！_S2" },
	{ bank: 0, program: 5, name: "ファッ！？" },
	{ bank: 0, program: 6, name: "ぬわああ_S" },
	{ bank: 0, program: 7, name: "ヌッ！" },
	{ bank: 1, program: 0, name: "アン！" },
	{ bank: 1, program: 1, name: "アーン！" },
	{ bank: 1, program: 2, name: "アーン！_S" },
	{ bank: 1, program: 3, name: "アーン！_S2" },
	{ bank: 1, program: 4, name: "アーン！_S3" },
	{ bank: 2, program: 0, name: "s「お」うだよ_B" },
	{ bank: 2, program: 1, name: "s「お」うだよ_B2" },
	{ bank: 2, program: 2, name: "s「お」うだよ_S" },
	{ bank: 3, program: 0, name: "ウィ「ヒッ！」" },
	{ bank: 3, program: 1, name: "ア゜ッー_S" },
	{ bank: 4, program: 0, name: "あああ！_S" },
	{ bank: 5, program: 0, name: "あぅぅ！_S" },
	{ bank: 6, program: 0, name: "マ゜ッ！" },
	{ bank: 31, program: 0, name: "COATロゴ" },
	{ bank: 31, program: 1, name: "セミ兄貴" },
	{ bank: 31, program: 2, name: "ストラディバリ椅子_S" },
	{ bank: 31, program: 3, name: "ホモビーム" },
	{ bank: 32, program: 0, name: "ぷはー" },
	{ bank: 32, program: 1, name: "いい「天」気_P" },
	{ bank: 32, program: 2, name: "「クォ」ラ！_P" },
	{ bank: 33, program: 0, name: "「バン」ホーテン_P" },
	{ bank: 33, program: 1, name: "バン「ホー」テン_S" },
	{ bank: 33, program: 2, name: "あああ！_S" },
	{ bank: 33, program: 3, name: "あああ！_S2" },
	{ bank: 33, program: 4, name: "あああ！_S3" },
	{ bank: 33, program: 5, name: "あああ！_S4" },
	{ bank: 33, program: 6, name: "あああ！_S5" },
	{ bank: 33, program: 7, name: "忘れてた「ー！」_S" },
	{ bank: 34, program: 0, name: "きゃっ！" },
	{ bank: 34, program: 1, name: "もういっ「かー」い_S" },
	{ bank: 34, program: 2, name: "もういっか「－」い_S" },
	{ bank: 34, program: 3, name: "あっ！…_P" },
	{ bank: 35, program: 0, name: "あっ…「まい！」" },
	{ bank: 35, program: 1, name: "食べさせる「ー」_S" },
	{ bank: 35, program: 2, name: "食べさせる「ー」_S2" },
	{ bank: 35, program: 3, name: "食べさせる「ー」_S3" },
	{ bank: 35, program: 4, name: "食べさせる「－」_B" },
	{ bank: 35, program: 5, name: "「完」成" },
	{ bank: 35, program: 6, name: "扱っ「て！」" },
	{ bank: 36, program: 0, name: "「そー」なのかー_S" },
	{ bank: 36, program: 1, name: "そ「ー」なのかー_B" },
	{ bank: 37, program: 0, name: "えい！_P" },
	{ bank: 37, program: 1, name: "わっ！？" },
	{ bank: 38, program: 0, name: "おは「よ」う_S" },
	{ bank: 40, program: 0, name: "「だ」って" },
	{ bank: 40, program: 1, name: "んーっ「と」_S" },
	{ bank: 41, program: 0, name: "「ちょ」っとまった！_P" },
	{ bank: 41, program: 1, name: "いら「ねー」_S" },
	{ bank: 47, program: 0, name: "クリス「マ」ス_S" },
	{ bank: 47, program: 1, name: "クリスm「ア」ス_B" },
	{ bank: 48, program: 0, name: "「あ＾～」生き返るわ～_S" },
	{ bank: 48, program: 1, name: "「あ＾～」生き返るわ～_S2" },
	{ bank: 49, program: 0, name: "あー_S" },
	{ bank: 49, program: 1, name: "「そー」だなー_B" },
	{ bank: 56, program: 0, name: "ひつじ" },
	{ bank: 64, program: 0, name: "「あ」とは_S" },
	{ bank: 72, program: 0, name: "いらっしゃいま「せー」_S" },
	{ bank: 72, program: 1, name: "「な」いです_S" },
	{ bank: 72, program: 2, name: "バレン「タイン」_P" },
	{ bank: 72, program: 3, name: "まいどあり「－」_B" },
	{ bank: 72, program: 4, name: "NYN_P" },
	{ bank: 73, program: 0, name: "えっと「ー」_S" },
	{ bank: 73, program: 1, name: "えっ「とー」_S" },
	{ bank: 74, program: 0, name: "バレン「タイン」_P" },
	{ bank: 74, program: 1, name: "「こ」んなもの！_S" },
	{ bank: 74, program: 2, name: "こん「な」もの！_S" },
	{ bank: 74, program: 3, name: "うぅ…_P" },
	{ bank: 75, program: 0, name: "フ「フ」フフ" },
	{ bank: 75, program: 1, name: "フフ「フ」フ" },
	{ bank: 75, program: 2, name: "フフフ「フ」" },
	{ bank: 88, program: 0, name: "おー_S" },
	{ bank: 96, program: 0, name: "じぇんとる「め！」" },
	{ bank: 97, program: 0, name: "し「まー」す_S" },
	{ bank: 98, program: 0, name: "「そ」こで" },
	{ bank: 98, program: 1, name: "そ「こ」で" },
	{ bank: 98, program: 2, name: "そこ「で」" },
	{ bank: 98, program: 3, name: "ぬえ「ちゃん」" },
	{ bank: 104, program: 0, name: "But_P" },
	{ bank: 104, program: 1, name: "One" },
	{ bank: 105, program: 0, name: "Hmm_S" },
	{ bank: 105, program: 1, name: "Hmm_B" },
	{ bank: 105, program: 2, name: "Sure_P" },
	{ bank: 113, program: 0, name: "「こ」↑こ↓" },
	{ bank: 113, program: 1, name: "ぽい" },
	{ bank: 114, program: 0, name: "「あ＾～」生き返るわ～_S" },
	{ bank: 115, program: 0, name: "いらっしゃいま「せー」_S" },
	{ bank: 125, program: 0, name: "SPC_SE_0049" },
	{ bank: 126, program: 0, name: "アッー！" },
	{ bank: 126, program: 1, name: "ファ楽器" },
	{ bank: 126, program: 2, name: "サンダー" },
];

/** お天気雨のレ淫棒 2020年版（20200424）。 */
export const OTENKIAME_20200424_BANKS: readonly BankedBank[] = [
	{ bank: 0, name: "王道淫夢" },
	{ bank: 8, name: "古典淫夢" },
	{ bank: 16, name: "現代淫夢" },
	{ bank: 64, name: "クッキー☆主要" },
	{ bank: 96, name: "キレテナーイ" },
];

export const OTENKIAME_20200424_PRESETS: readonly BankedPreset[] = [
	{ bank: 0, program: 0, name: "野獣の咆哮", group: "野獣先輩" },
	{ bank: 0, program: 1, name: "野獣の咆哮 Mo", group: "野獣先輩" },
	{ bank: 0, program: 2, name: "野獣の咆哮 Pt", group: "野獣先輩" },
	{ bank: 0, program: 3, name: "野獣の咆哮 Syn1St", group: "野獣先輩" },
	{ bank: 0, program: 4, name: "野獣の咆哮 Syn1Mo", group: "野獣先輩" },
	{ bank: 0, program: 12, name: "ダブリング咆哮", group: "野獣先輩" },
	{ bank: 0, program: 16, name: "オォン！", group: "野獣先輩" },
	{ bank: 0, program: 17, name: "オォン！ Pt", group: "野獣先輩" },
	{ bank: 0, program: 20, name: "こ↑こ↓", group: "野獣先輩" },
	{ bank: 0, program: 21, name: "こ↑こ↓ Mo", group: "野獣先輩" },
	{ bank: 0, program: 32, name: "世界の遠野", group: "遠野" },
	{ bank: 0, program: 33, name: "世界の遠野 Pt", group: "遠野" },
	{ bank: 0, program: 34, name: "宇宙の遠野", group: "遠野" },
	{ bank: 0, program: 64, name: "便乗ベース", group: "MUR" },
	{ bank: 0, program: 65, name: "便乗ベース Mo", group: "MUR" },
	{ bank: 8, program: 0, name: "ワン！", group: "TDN" },
	{ bank: 8, program: 1, name: "ワン！ Mo", group: "TDN" },
	{ bank: 8, program: 4, name: "TDNシンセ", group: "TDN" },
	{ bank: 8, program: 5, name: "TDNシタール", group: "TDN" },
	{ bank: 16, program: 0, name: "ビンビンベース", group: "ゆうさく" },
	{ bank: 16, program: 1, name: "ビンビンベース Mo", group: "ゆうさく" },
	{ bank: 64, program: 0, name: "ぷはー", group: "RU" },
	{ bank: 64, program: 1, name: "ぷはーベル", group: "RU" },
	{ bank: 64, program: 4, name: "てん気", group: "RU" },
	{ bank: 64, program: 5, name: "てん気ピアノ", group: "RU" },
	{ bank: 64, program: 32, name: "UDKシンセA Syn1", group: "UDK" },
	{ bank: 64, program: 33, name: "UDKシンセA Syn2", group: "UDK" },
	{ bank: 64, program: 36, name: "UDKシンセA Dec", group: "UDK" },
	{ bank: 64, program: 40, name: "UDKシンセB", group: "UDK" },
	{ bank: 64, program: 44, name: "VANホーテン", group: "UDK" },
	{ bank: 64, program: 64, name: "SIKシンセ", group: "SIK" },
	{ bank: 64, program: 65, name: "SIKシンセ Dec", group: "SIK" },
	{ bank: 64, program: 72, name: "あっ！", group: "SIK" },
	{ bank: 64, program: 74, name: "まい！ Pt", group: "SIK" },
	{ bank: 64, program: 96, name: "大外刈り", group: "ALC" },
	{ bank: 96, program: 0, name: "TNKシンセ", group: "TNK" },
];
