/**
 * VOICEVOX の歌唱 API で歌わせる（試作）。
 *
 * koe（UTAU音源）とは別の経路。ブラウザで合成するのではなく、VOICEVOX エンジン
 * （既定 `http://127.0.0.1:50021`）に楽譜を送って WAV を受け取る。
 *
 * 流れ: ノート＋音節 → {@link buildVoicevoxScore}（VOICEVOX の Score）
 *   → `/sing_frame_audio_query`（歌唱ティーチャーが音素長とピッチを決める）
 *   → `/frame_synthesis`（ずんだもん等の歌唱スタイルで鳴らす）→ WAV。
 *
 * VOICEVOX の楽譜はフレーム単位（24000Hz / 256 = 93.75 フレーム/秒）。
 * 秒で累積してから丸めるので、長い曲でも丸め誤差は溜まらない。
 */

import { units, unitsToMidiDetune } from "../audio/tuning";
import { sanitizeText } from "../safe-text";
import type { LyricSyllable, Note } from "../types";
import { createPriorityQueue } from "./priority-queue";
import { normalizeExternalVoice } from "./voice-level";

/** VOICEVOX 楽譜のフレームレート。 */
export const VOICEVOX_FRAME_RATE = 24000 / 256;

/** 既定のエンジンURL（VOICEVOX アプリ／エンジン単体の既定ポート）。 */
export const VOICEVOX_DEFAULT_URL = "http://127.0.0.1:50021";

/**
 * 歌唱ティーチャー（波音リツ）のスタイルID。音素長とピッチを決める役で、
 * 声色は {@link synthesizeVoicevoxSong} の `singer` が決める。
 */
export const VOICEVOX_SING_TEACHER = 6000;

/** ブレス（`、`）で前の音の尻を削って差し込む休符の長さ（秒）。 */
const BREATH_SECONDS = 0.12;

export type VoicevoxScoreNote = {
	/** MIDI ノート番号。休符は null。 */
	key: number | null;
	frame_length: number;
	/** 1モーラのかな。休符は空文字。 */
	lyric: string;
};

export type VoicevoxScore = { notes: VoicevoxScoreNote[] };

export type BuildVoicevoxScoreOptions = {
	/** 歌うトラックのノート（並びは問わない）。 */
	notes: Note[];
	/** `normalizeLyrics` の結果。startStep 昇順のノートと index で 1:1。 */
	syllables: LyricSyllable[];
	bpm: number;
	/** 1拍あたりのステップ数（dtm の既定は 48）。 */
	stepsPerBeat?: number;
};

/** 楽譜の1音（秒で持ち、最後にフレームへ割る）。 */
export type TimedNote = {
	start: number;
	end: number;
	key: number | null;
	lyric: string;
};

/**
 * 音節1つを VOICEVOX の歌詞へ。歌わない音節は null（休符にする）。
 *
 * 継続（`ー`）の音節は `normalizeLyrics` が直前の母音のかなを焼き込んでいるので、
 * そのまま1モーラとして渡せる（同じ高さなら呼び出し側で前の音へ結合する）。
 * 語り（`「…」`）は歌唱 API では鳴らせないので休符にする。
 */
const lyricOf = (syl: LyricSyllable | undefined): string | null => {
	if (!syl) return "ら";
	if (syl.kind === "rest" || syl.kind === "speak") return null;
	return engineKana(syl.kana);
};

/** 小さいかな → 大きいかな。 */
const LARGE_KANA: Record<string, string> = {
	ぁ: "あ",
	ぃ: "い",
	ぅ: "う",
	ぇ: "え",
	ぉ: "お",
	ゃ: "や",
	ゅ: "ゆ",
	ょ: "よ",
	ゎ: "わ",
};
/**
 * 小さいかなを含む2文字のモーラのうち、VOICEVOX が歌える拗音（2026-11-01 にエンジン 0.26.0 へ
 * 全組み合わせを送って確かめた）。`きぃ` `てぇ` のように伸ばすだけのものと、ENUNU が落ちる `ゔゃ` `ゔょ` は除く。
 */
const ENGINE_YOUON = new Set(
	(
		"いぇ うぃ うぇ うぉ きぇ きゃ きゅ きょ くぁ くぃ くぇ くぉ くゎ しぇ しゃ しゅ しょ すぃ " +
		"ちぇ ちゃ ちゅ ちょ つぁ つぃ つぇ つぉ てぃ てゃ てゅ てょ とぅ にぇ にゃ にゅ にょ " +
		"ひぇ ひゃ ひゅ ひょ ふぁ ふぃ ふぇ ふぉ みぇ みゃ みゅ みょ りぇ りゃ りゅ りょ " +
		"ぎぇ ぎゃ ぎゅ ぎょ ぐぁ ぐぃ ぐぇ ぐぉ ぐゎ じぇ じゃ じゅ じょ ずぃ ぢぇ ぢゃ ぢゅ ぢょ " +
		"でぃ でゃ でゅ でょ どぅ びぇ びゃ びゅ びょ ぴぇ ぴゃ ぴゅ ぴょ ゔぁ ゔぃ ゔぇ ゔぉ ゔゅ"
	).split(" "),
);

/**
 * 歌詞の1モーラを、歌唱エンジン（VOICEVOX・ENUNU）が読めるかなへ。
 *
 * 歌詞解析は `なぁ` `ねぇ` `かぃ` のような「かな＋小さいかな」を1モーラにまとめるが、
 * エンジンは拗音のほかを知らず（VOICEVOX は 400、ENUNU は 500）、フレーズ・区切りが
 * 丸ごと無音になる。知らない組み合わせは小さいかなを落として前のかなだけ歌い、
 * 小さいかな1文字（`ぁ` `ゎ`）は大きいかなにする。`ふゅ` は VOICEVOX が知らないので近い `ひゅ` へ。
 */
export const engineKana = (kana: string): string => {
	const chars = [...kana];
	if (chars.length === 1) return LARGE_KANA[kana] ?? kana;
	if (chars.length !== 2) return kana;
	if (kana === "ふゅ") return "ひゅ";
	if (ENGINE_YOUON.has(kana)) return kana;
	return LARGE_KANA[chars[0]] ?? chars[0];
};

/**
 * ノートと音節から VOICEVOX の楽譜を組み立てる。
 *
 * 単旋律しか歌えないので、和音・重なりは UST 書き出しと同じく先勝ちで1本へ潰す。
 * 先頭には必ず休符を置く（VOICEVOX の楽譜の決まり）。
 */
export const buildVoicevoxScore = (
	options: BuildVoicevoxScoreOptions,
): VoicevoxScore => {
	const { notes, syllables, bpm, stepsPerBeat = 48 } = options;
	const secPerStep = 60 / bpm / stepsPerBeat;
	const sorted = [...notes]
		.map((note, index) => ({ note, syl: syllables[index] }))
		.sort((a, b) => a.note.startStep - b.note.startStep);

	const out: TimedNote[] = [];
	let cursor = 0;
	for (const { note, syl } of sorted) {
		const start = note.startStep * secPerStep;
		let end = (note.startStep + note.durationSteps) * secPerStep;
		if (start < cursor - 1e-9) continue; // 和音の下側・重なりは捨てる
		const lyric = lyricOf(syl);
		const { midi } = unitsToMidiDetune(note.pitchUnits);
		const prev = out[out.length - 1];
		if (lyric === null) {
			// 歌わない音は休符。直後の隙間と一緒にまとめて書く。
			cursor = end;
			continue;
		}
		if (
			syl?.kind === "tie" &&
			prev &&
			prev.key === midi &&
			Math.abs(prev.end - start) < 1e-9
		) {
			prev.end = end; // 同じ高さの継続は言い直さず伸ばす
		} else {
			out.push({ start, end, key: midi, lyric });
		}
		if (syl?.breathAfter) {
			const last = out[out.length - 1];
			const cut = Math.min(BREATH_SECONDS, (last.end - last.start) / 3);
			last.end -= cut;
			end = last.end;
		}
		cursor = end;
	}

	// 曲頭から歌い出す場合も、先頭の休符は最低限の長さを確保する。
	const frames = Math.max(
		8,
		Math.round((out[0]?.start ?? 0) * VOICEVOX_FRAME_RATE),
	);
	return timedToScore(out, frames, 8);
};

/** 音の間に休符として残す最短の長さ（フレーム）。これより短い隙間は前の音を伸ばして埋める。 */
const MIN_REST_FRAMES = 3;

/**
 * 秒で並べた音を楽譜へ割る。先頭に `leadFrames` の休符、末尾に `tailFrames` の休符を置き、
 * 音の間の隙間も休符で埋める。先頭の休符の終わりが `out[0].start` に当たる。
 */
export const timedToScore = (
	out: TimedNote[],
	leadFrames: number,
	tailFrames: number,
): VoicevoxScore => {
	const origin = out[0]?.start ?? 0;
	const frames = (sec: number): number =>
		Math.round((sec - origin) * VOICEVOX_FRAME_RATE);
	const score: VoicevoxScoreNote[] = [
		{ key: null, frame_length: leadFrames, lyric: "" },
	];
	let at = origin;
	for (const n of out) {
		const gap = frames(n.start) - frames(at);
		if (gap > 0) {
			const last = score[score.length - 1];
			if (last.key === null) last.frame_length += gap;
			// ごく短い休符は前の音へ足す。1フレームの休符の直後が子音で始まると、
			// 子音の長さを休符から取れずエンジンが 500 を返し、フレーズごと歌わなくなる。
			else if (gap < MIN_REST_FRAMES) last.frame_length += gap;
			else score.push({ key: null, frame_length: gap, lyric: "" });
		}
		const length = frames(n.end) - frames(n.start);
		if (length > 0)
			score.push({ key: n.key, frame_length: length, lyric: n.lyric });
		at = n.end;
	}
	score.push({ key: null, frame_length: tailFrames, lyric: "" });
	return { notes: score };
};

// ─────────────────────────────────────────────────────────────
// DAW から歌わせる（フレーズ単位の合成）
// ─────────────────────────────────────────────────────────────

/** VOICEVOX の歌い手1人ぶん（1スタイル）。 */
export type VoicevoxSingerEntry = {
	/** 歌唱スタイルID（`/singers` の frame_decode） */
	style: number;
	/** 語り（`「…」`）を読み上げる話し声のスタイルID */
	talk: number;
	name: string;
	terms: string;
	/** ノーマル以外のスタイルのとき、元のキャラのモデル名（アイコンなどを引き継ぐ） */
	base?: string;
};

/**
 * キャラごとのノーマルのスタイル。歌えるキャラ30人全員（0.26.0 の `/singers` で確かめた。
 * 東北三姉妹など 0.26.0 のエンジンに入っていないキャラは、スタイルIDを確かめられないので入れていない）。
 * `talk` は語り（`「…」`）を読み上げる同じキャラの話し声のスタイル（`/speakers` のノーマル）。
 */
const VOICEVOX_CHARACTERS: Record<string, Omit<VoicevoxSingerEntry, "base">> = {
	vv_zundamon: {
		talk: 3,
		style: 3003,
		name: "VOICEVOX:ずんだもん",
		terms: "https://voicevox.hiroshiba.jp/product/zundamon/",
	},
	vv_metan: {
		talk: 2,
		style: 3002,
		name: "VOICEVOX:四国めたん",
		terms: "https://voicevox.hiroshiba.jp/product/shikoku_metan/",
	},
	vv_tsumugi: {
		talk: 8,
		style: 3008,
		name: "VOICEVOX:春日部つむぎ",
		terms: "https://voicevox.hiroshiba.jp/product/kasukabe_tsumugi/",
	},
	vv_hau: {
		talk: 10,
		style: 3010,
		name: "VOICEVOX:雨晴はう",
		terms: "https://voicevox.hiroshiba.jp/product/amehare_hau/",
	},
	vv_ritsu: {
		talk: 9,
		style: 3009,
		name: "VOICEVOX:波音リツ",
		terms: "https://voicevox.hiroshiba.jp/product/namine_ritsu/",
	},
	vv_takehiro: {
		talk: 11,
		style: 3011,
		name: "VOICEVOX:玄野武宏",
		terms: "https://voicevox.hiroshiba.jp/product/kurono_takehiro/",
	},
	vv_kotarou: {
		talk: 12,
		style: 3012,
		name: "VOICEVOX:白上虎太郎",
		terms: "https://voicevox.hiroshiba.jp/product/shirakami_kotarou/",
	},
	vv_ryusei: {
		talk: 13,
		style: 3013,
		name: "VOICEVOX:青山龍星",
		terms: "https://voicevox.hiroshiba.jp/product/aoyama_ryusei/",
	},
	vv_himari: {
		talk: 14,
		style: 3014,
		name: "VOICEVOX:冥鳴ひまり",
		terms: "https://voicevox.hiroshiba.jp/product/meimei_himari/",
	},
	vv_sora: {
		talk: 16,
		style: 3016,
		name: "VOICEVOX:九州そら",
		terms: "https://voicevox.hiroshiba.jp/product/kyushu_sora/",
	},
	vv_mochiko: {
		talk: 20,
		style: 3020,
		name: "VOICEVOX:もち子(cv 明日葉よもぎ)",
		terms: "https://voicevox.hiroshiba.jp/product/mochikosan/",
	},
	vv_mesuo: {
		talk: 21,
		style: 3021,
		name: "VOICEVOX:剣崎雌雄",
		terms: "https://voicevox.hiroshiba.jp/product/kenzaki_mesuo/",
	},
	vv_whitecul: {
		talk: 23,
		style: 3023,
		name: "VOICEVOX:WhiteCUL",
		terms: "https://voicevox.hiroshiba.jp/product/white_cul/",
	},
	vv_goki: {
		talk: 27,
		style: 3027,
		name: "VOICEVOX:後鬼",
		terms: "https://voicevox.hiroshiba.jp/product/goki/",
	},
	vv_no7: {
		talk: 29,
		style: 3029,
		name: "VOICEVOX:No.7",
		terms: "https://voicevox.hiroshiba.jp/product/number_seven/",
	},
	vv_chibijii: {
		talk: 42,
		style: 3042,
		name: "VOICEVOX:ちび式じい",
		terms: "https://voicevox.hiroshiba.jp/product/chibishikiji/",
	},
	vv_miko: {
		talk: 43,
		style: 3043,
		name: "VOICEVOX:櫻歌ミコ",
		terms: "https://voicevox.hiroshiba.jp/product/ouka_miko/",
	},
	vv_sayo: {
		talk: 46,
		style: 3046,
		name: "VOICEVOX:小夜/SAYO",
		terms: "https://voicevox.hiroshiba.jp/product/sayo/",
	},
	vv_nurserobo: {
		talk: 47,
		style: 3047,
		name: "VOICEVOX:ナースロボ＿タイプＴ",
		terms: "https://voicevox.hiroshiba.jp/product/nurserobo_typet/",
	},
	vv_benizakura: {
		talk: 51,
		style: 3051,
		name: "VOICEVOX:†聖騎士 紅桜†",
		terms: "https://voicevox.hiroshiba.jp/product/horinaito_benizakura/",
	},
	vv_akashi: {
		talk: 52,
		style: 3052,
		name: "VOICEVOX:雀松朱司",
		terms: "https://voicevox.hiroshiba.jp/product/wakamatsu_akashi/",
	},
	vv_sourin: {
		talk: 53,
		style: 3053,
		name: "VOICEVOX:麒ヶ島宗麟",
		terms: "https://voicevox.hiroshiba.jp/product/kigashima_sourin/",
	},
	vv_nana: {
		talk: 54,
		style: 3054,
		name: "VOICEVOX:春歌ナナ",
		terms: "https://voicevox.hiroshiba.jp/product/haruka_nana/",
	},
	vv_aru: {
		talk: 55,
		style: 3055,
		name: "VOICEVOX:猫使アル",
		terms: "https://voicevox.hiroshiba.jp/product/nekotsuka_aru/",
	},
	vv_bi: {
		talk: 58,
		style: 3058,
		name: "VOICEVOX:猫使ビィ",
		terms: "https://voicevox.hiroshiba.jp/product/nekotsuka_bi/",
	},
	vv_usagi: {
		talk: 61,
		style: 3061,
		name: "VOICEVOX:中国うさぎ",
		terms: "https://voicevox.hiroshiba.jp/product/chugoku_usagi/",
	},
	vv_maron: {
		talk: 67,
		style: 3067,
		name: "VOICEVOX:栗田まろん",
		terms: "https://voicevox.hiroshiba.jp/product/kurita_maron/",
	},
	vv_aierutan: {
		talk: 68,
		style: 3068,
		name: "VOICEVOX:あいえるたん",
		terms: "https://voicevox.hiroshiba.jp/product/aierutan/",
	},
	vv_hanamaru: {
		talk: 69,
		style: 3069,
		name: "VOICEVOX:満別花丸",
		terms: "https://voicevox.hiroshiba.jp/product/manbetsu_hanamaru/",
	},
	vv_nia: {
		talk: 74,
		style: 3074,
		name: "VOICEVOX:琴詠ニア",
		terms: "https://voicevox.hiroshiba.jp/product/kotoyomi_nia/",
	},
};

/**
 * ノーマル以外の歌えるスタイル（キャラのモデル名 → 接尾辞 → スタイル）。モデル名は
 * `<キャラのモデル名>_<接尾辞>`（例: `vv_zundamon_hisohiso`）。0.26.0 の `/singers` の
 * frame_decode をすべて載せた。歌唱スタイルIDは話し声のスタイルID + 3000 で、語りは同じスタイルの
 * 話し声で読む（ヒソヒソで歌うキャラは語りもヒソヒソ）。話し声にしか無いスタイル
 * （ずんだもんの「ささやき」など）は歌えないので載せていない。
 */
const VOICEVOX_EXTRA_STYLES: Record<
	string,
	Record<string, { label: string; style: number; talk: number }>
> = {
	vv_metan: {
		amaama: { label: "あまあま", style: 3000, talk: 0 },
		tsuntsun: { label: "ツンツン", style: 3006, talk: 6 },
		sexy: { label: "セクシー", style: 3004, talk: 4 },
		hisohiso: { label: "ヒソヒソ", style: 3037, talk: 37 },
	},
	vv_zundamon: {
		amaama: { label: "あまあま", style: 3001, talk: 1 },
		tsuntsun: { label: "ツンツン", style: 3007, talk: 7 },
		sexy: { label: "セクシー", style: 3005, talk: 5 },
		hisohiso: { label: "ヒソヒソ", style: 3038, talk: 38 },
		herohero: { label: "ヘロヘロ", style: 3075, talk: 75 },
		namidame: { label: "なみだめ", style: 3076, talk: 76 },
	},
	vv_ritsu: {
		queen: { label: "クイーン", style: 3065, talk: 65 },
	},
	vv_takehiro: {
		yorokobi: { label: "喜び", style: 3039, talk: 39 },
		tsungire: { label: "ツンギレ", style: 3040, talk: 40 },
		kanashimi: { label: "悲しみ", style: 3041, talk: 41 },
	},
	vv_kotarou: {
		wai: { label: "わーい", style: 3032, talk: 32 },
		bikubiku: { label: "びくびく", style: 3033, talk: 33 },
		oko: { label: "おこ", style: 3034, talk: 34 },
		bien: { label: "びえーん", style: 3035, talk: 35 },
	},
	vv_ryusei: {
		nekketsu: { label: "熱血", style: 3081, talk: 81 },
		fukigen: { label: "不機嫌", style: 3082, talk: 82 },
		yorokobi: { label: "喜び", style: 3083, talk: 83 },
		shittori: { label: "しっとり", style: 3084, talk: 84 },
		kanashimi: { label: "かなしみ", style: 3085, talk: 85 },
	},
	vv_sora: {
		amaama: { label: "あまあま", style: 3015, talk: 15 },
		tsuntsun: { label: "ツンツン", style: 3018, talk: 18 },
		sexy: { label: "セクシー", style: 3017, talk: 17 },
	},
	vv_mochiko: {
		sexy: { label: "セクシー／あん子", style: 3066, talk: 66 },
		naki: { label: "泣き", style: 3077, talk: 77 },
		ikari: { label: "怒り", style: 3078, talk: 78 },
		yorokobi: { label: "喜び", style: 3079, talk: 79 },
		nonbiri: { label: "のんびり", style: 3080, talk: 80 },
	},
	vv_whitecul: {
		tanoshii: { label: "たのしい", style: 3024, talk: 24 },
		kanashii: { label: "かなしい", style: 3025, talk: 25 },
		bien: { label: "びえーん", style: 3026, talk: 26 },
	},
	vv_goki: {
		nuigurumi: { label: "ぬいぐるみver.", style: 3028, talk: 28 },
	},
	vv_no7: {
		announce: { label: "アナウンス", style: 3030, talk: 30 },
		yomikikase: { label: "読み聞かせ", style: 3031, talk: 31 },
	},
	vv_miko: {
		daini: { label: "第二形態", style: 3044, talk: 44 },
		loli: { label: "ロリ", style: 3045, talk: 45 },
	},
	vv_nurserobo: {
		rakuraku: { label: "楽々", style: 3048, talk: 48 },
		kyofu: { label: "恐怖", style: 3049, talk: 49 },
	},
	vv_aru: {
		ochitsuki: { label: "おちつき", style: 3056, talk: 56 },
		ukiuki: { label: "うきうき", style: 3057, talk: 57 },
	},
	vv_bi: {
		ochitsuki: { label: "おちつき", style: 3059, talk: 59 },
	},
	vv_usagi: {
		odoroki: { label: "おどろき", style: 3062, talk: 62 },
		kowagari: { label: "こわがり", style: 3063, talk: 63 },
		herohero: { label: "へろへろ", style: 3064, talk: 64 },
	},
	vv_hanamaru: {
		genki: { label: "元気", style: 3070, talk: 70 },
		sasayaki: { label: "ささやき", style: 3071, talk: 71 },
		burikko: { label: "ぶりっ子", style: 3072, talk: 72 },
		boy: { label: "ボーイ", style: 3073, talk: 73 },
	},
};

/**
 * DAW の歌詞トラックで選べる VOICEVOX の歌い手（モデル名 → 歌唱スタイル）。
 * モデル名は `vv_` で始める（koe 音源のキーワードと混ざらないように）。
 * キャラのノーマルのすぐ後にそのキャラのほかのスタイルを並べる（音源の一覧の並び順になる）。
 */
export const VOICEVOX_SINGERS: Record<string, VoicevoxSingerEntry> =
	Object.fromEntries(
		Object.entries(VOICEVOX_CHARACTERS).flatMap(([key, singer]) => [
			[key, singer],
			...Object.entries(VOICEVOX_EXTRA_STYLES[key] ?? {}).map(
				([suffix, { label, style, talk }]) => [
					`${key}_${suffix}`,
					{
						...singer,
						style,
						talk,
						name: `${singer.name}（${label}）`,
						base: key,
					},
				],
			),
		]),
	);

/** VOICEVOX で歌うモデル名か。 */
export const isVoicevoxModel = (model: string): boolean =>
	Object.hasOwn(VOICEVOX_SINGERS, model.toLowerCase());

/** フレーズ1つぶんの楽譜。 */
export type VoicevoxPhrase<N> = {
	/** フレーズ最初の音の開始（アンカーからの秒）。 */
	startSec: number;
	/**
	 * 合成された音声の頭から、最初の音の開始までの秒。子音はこの休符の中に
	 * 前倒しで置かれるので、`startSec - leadSec` から鳴らすと拍に合う。
	 */
	leadSec: number;
	score: VoicevoxScore;
	/** このフレーズに入った元の音（再生中の表示用）。 */
	notes: N[];
};

/** フレーズ頭の休符（子音を前倒しする余地）。 */
const PHRASE_LEAD_FRAMES = 24;
/** フレーズ尻の休符（語尾の減衰を切らない余地）。 */
const PHRASE_TAIL_FRAMES = 16;
/** これ以上の隙間があればフレーズを切る（秒）。 */
const PHRASE_SPLIT_GAP_SEC = 0.3;

/** 母音 → 伸ばすときのかな（継続のピッチ推移で言い直さずに歌う音）。 */
const VOWEL_KANA: Record<string, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
	N: "ん",
};

/** {@link buildVoicevoxPhrases} が読む、歌声ストリームの音の形（lyrics.ts の StreamVoiceNote）。 */
export type VoicevoxSourceNote = {
	syllable: LyricSyllable;
	pitch: number;
	startSec: number;
	durationSec: number;
	pitchSegments?: { pitch: number; atSec: number }[];
	breath?: boolean;
	phraseStart?: boolean;
};

/**
 * 歌声ストリームの音を、休符・ブレス・語りで区切ったフレーズへまとめる。
 *
 * 曲まるごと1回で合成すると、編集やシークのたびに全部を作り直すことになる。
 * フレーズ単位なら楽譜が同じフレーズはキャッシュが効き、最初のフレーズが
 * できた時点で鳴らし始められる。
 *
 * 単旋律しか歌えないので、和音・重なりは先勝ちで1本へ潰す。`dropped` を渡すと、
 * 潰して捨てた音をそこへ積む（{@link splitVoicevoxVoices} が別の声へ回す）。
 */
export const buildVoicevoxPhrases = <N extends VoicevoxSourceNote>(
	notes: N[],
	dropped?: N[],
): VoicevoxPhrase<N>[] => {
	const phrases: VoicevoxPhrase<N>[] = [];
	let timed: TimedNote[] = [];
	let members: N[] = [];
	const flush = (): void => {
		if (timed.length === 0) return;
		phrases.push({
			startSec: timed[0].start,
			leadSec: PHRASE_LEAD_FRAMES / VOICEVOX_FRAME_RATE,
			score: timedToScore(timed, PHRASE_LEAD_FRAMES, PHRASE_TAIL_FRAMES),
			notes: members,
		});
		timed = [];
		members = [];
	};
	for (const note of notes) {
		const syl = note.syllable;
		// 時刻が NaN・Infinity の音は楽譜に入れない（フレーム数が壊れるため）。
		if (!Number.isFinite(note.startSec) || !Number.isFinite(note.durationSec))
			continue;
		// 休符・語りは歌わず、フレーズもそこで切る。
		if (syl.kind === "rest" || syl.kind === "speak") {
			flush();
			continue;
		}
		// 促音・無声は鳴らさない（隙間として残る）。
		if (syl.consonant === "Q" || syl.vowel === "") continue;
		const prev = timed[timed.length - 1];
		const start = note.startSec;
		const end = note.startSec + note.durationSec;
		// 和音・重なりは先勝ち
		if (prev && start < prev.end - 1e-6) {
			dropped?.push(note);
			continue;
		}
		if (prev && (note.phraseStart || start - prev.end > PHRASE_SPLIT_GAP_SEC))
			flush();
		const key = (pitch: number): number => unitsToMidiDetune(units(pitch)).midi;
		// 結合できなかった継続（隙間なく続く同じ高さ）は前の音を伸ばす。
		if (
			syl.kind === "tie" &&
			prev &&
			prev.key === key(note.pitch) &&
			start - prev.end < 1e-3 &&
			!note.pitchSegments?.length
		) {
			prev.end = end;
			members.push(note);
			if (note.breath) flush();
			continue;
		}
		// 継続で結合された音は、高さが変わる所だけ母音で区切る（VOICEVOX の楽譜は
		// 1音1高さなので）。同じ高さの区間は1音のまま伸ばす。
		const segments = note.pitchSegments ?? [];
		let segStart = start;
		let segKey = key(note.pitch);
		let lyric = engineKana(syl.kana);
		for (const seg of segments) {
			if (key(seg.pitch) === segKey) continue;
			const at = Math.min(end, start + seg.atSec);
			if (at > segStart)
				timed.push({ start: segStart, end: at, key: segKey, lyric });
			segStart = at;
			segKey = key(seg.pitch);
			lyric = VOWEL_KANA[syl.vowel] ?? lyric;
		}
		if (end > segStart)
			timed.push({ start: segStart, end, key: segKey, lyric });
		members.push(note);
		if (note.breath) flush();
	}
	flush();
	return phrases;
};

/**
 * 手元のエンジンで重ねて歌う声の上限（1本目を含む）。和音の音はそれぞれ別の声として
 * 合成するので、声の数だけ合成の手間が増える。これを超える音は従来どおり捨てる。
 */
export const MAX_ENGINE_VOICES = 4;

/**
 * 和音・重なりを、単旋律の声ごとに分ける。1本目は元の音そのまま（{@link buildVoicevoxPhrases}
 * が先勝ちで歌う音）、2本目からは前の声で捨てられた音を同じやり方で拾い直したもの。
 * 和音の無いトラックは1本だけになり、合成の手間は変わらない。
 */
export const splitVoicevoxVoices = <N extends VoicevoxSourceNote>(
	notes: N[],
	maxVoices = MAX_ENGINE_VOICES,
): N[][] => {
	const voices: N[][] = [];
	let left = notes;
	while (left.length > 0 && voices.length < maxVoices) {
		const dropped: N[] = [];
		buildVoicevoxPhrases(left, dropped);
		voices.push(left);
		left = dropped;
	}
	return voices;
};

/** `/singers` の1人ぶん（必要な所だけ）。 */
type VoicevoxSinger = {
	name: string;
	styles: { name: string; id: number; type?: string }[];
};

/**
 * 名前（部分一致）から歌唱用スタイルのIDを探す。見つからなければ null。
 * 歌唱用は `type` が `frame_decode`（ティーチャーは `sing`）。
 */
export const findVoicevoxSinger = async (
	name: string,
	baseUrl = VOICEVOX_DEFAULT_URL,
): Promise<{ id: number; label: string } | null> => {
	const res = await fetch(`${baseUrl}/singers`);
	if (!res.ok) throw new Error(`VOICEVOX /singers: ${res.status}`);
	const singers = (await res.json()) as VoicevoxSinger[];
	for (const singer of singers) {
		if (!singer.name.includes(name)) continue;
		const style =
			singer.styles.find((s) => s.type === "frame_decode") ?? singer.styles[0];
		if (style)
			return { id: style.id, label: `${singer.name}（${style.name}）` };
	}
	return null;
};

export type SynthesizeVoicevoxSongOptions = {
	/** 声色のスタイルID（{@link findVoicevoxSinger} で引く）。 */
	singer: number;
	baseUrl?: string;
	/** 音素長とピッチを決めるティーチャー。既定 {@link VOICEVOX_SING_TEACHER}。 */
	teacher?: number;
	/** 半音単位の移調（声域に合わないときに）。 */
	keyShift?: number;
	/** 0-2 程度。既定 1。 */
	volumeScale?: number;
};

/** 楽譜を VOICEVOX で歌わせ、WAV のバイト列を返す。 */
export const synthesizeVoicevoxSong = async (
	score: VoicevoxScore,
	options: SynthesizeVoicevoxSongOptions,
): Promise<ArrayBuffer> => {
	const {
		singer,
		baseUrl = VOICEVOX_DEFAULT_URL,
		teacher = VOICEVOX_SING_TEACHER,
		keyShift = 0,
		volumeScale,
	} = options;
	if (!Number.isInteger(teacher) || !Number.isInteger(singer))
		throw new Error("VOICEVOX のスタイルIDが不正です");
	const shift = Number.isFinite(keyShift) ? Math.trunc(keyShift) : 0;
	// NaN・Infinity の長さや高さを JSON に入れない（JSON.stringify は null に化かす）。
	const shifted: VoicevoxScore = {
		notes: score.notes
			.filter((n) => Number.isFinite(n.frame_length) && n.frame_length > 0)
			.map((n) =>
				n.key === null || !Number.isFinite(n.key)
					? { ...n, key: null, lyric: "" }
					: { ...n, key: Math.max(0, Math.min(127, n.key + shift)) },
			),
	};
	const json = { "Content-Type": "application/json" };
	const queryRes = await fetch(
		`${baseUrl}/sing_frame_audio_query?speaker=${teacher}`,
		{ method: "POST", headers: json, body: JSON.stringify(shifted) },
	);
	if (!queryRes.ok)
		throw new Error(
			`VOICEVOX /sing_frame_audio_query: ${queryRes.status} ${await queryRes.text()}`,
		);
	const query = await queryRes.json();
	if (volumeScale !== undefined) query.volumeScale = volumeScale;
	const wavRes = await fetch(`${baseUrl}/frame_synthesis?speaker=${singer}`, {
		method: "POST",
		headers: json,
		body: JSON.stringify(query),
	});
	if (!wavRes.ok)
		throw new Error(
			`VOICEVOX /frame_synthesis: ${wavRes.status} ${await wavRes.text()}`,
		);
	return wavRes.arrayBuffer();
};

/**
 * 語り（`「…」`）の本文を VOICEVOX の話し声で読み上げ、WAV のバイト列を返す。
 * 本文は漢字まじりのままエンジンに渡す（読みとアクセントはエンジンが決める）。
 */
/** 語り1つの本文の上限（文字数）。 */
const MAX_TALK_CHARS = 300;

export const synthesizeVoicevoxTalk = async (
	text: string,
	options: { speaker: number; baseUrl?: string },
): Promise<ArrayBuffer> => {
	const { speaker, baseUrl = VOICEVOX_DEFAULT_URL } = options;
	// 壊れたサロゲートで encodeURIComponent が投げない・長すぎる語りでエンジンを詰まらせないように。
	const safe = sanitizeText(text, MAX_TALK_CHARS);
	if (!safe) throw new Error("語りの本文が空です");
	if (!Number.isInteger(speaker) || speaker < 0)
		throw new Error(`VOICEVOX の話者IDが不正です: ${speaker}`);
	const queryRes = await fetch(
		`${baseUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(safe)}`,
		{ method: "POST" },
	);
	if (!queryRes.ok)
		throw new Error(
			`VOICEVOX /audio_query: ${queryRes.status} ${await queryRes.text()}`,
		);
	const query = await queryRes.json();
	const wavRes = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(query),
	});
	if (!wavRes.ok)
		throw new Error(
			`VOICEVOX /synthesis: ${wavRes.status} ${await wavRes.text()}`,
		);
	return wavRes.arrayBuffer();
};

/** {@link createVoicevoxRenderer} の戻り値。 */
export type VoicevoxRenderer = {
	/**
	 * 楽譜を合成して AudioBuffer にする。同じ歌い手・同じ楽譜は1回だけ合成する。
	 * エンジンへは1件ずつ送る。待っているものは `priority`（曲の中の開始秒）の小さい順、
	 * 同じなら頼んだ順（曲頭から埋まっていく）。`onStart` はエンジンへ送り始めたときに呼ぶ。
	 * 失敗したら null（エンジンが起動していない・歌えない歌詞など）。
	 */
	render: (
		style: number,
		score: VoicevoxScore,
		priority?: number,
		onStart?: () => void,
	) => Promise<AudioBuffer | null>;
	/** 語りを話し声で読み上げて AudioBuffer にする（同じ話者・同じ本文は1回だけ）。 */
	speak: (
		speaker: number,
		text: string,
		priority?: number,
		onStart?: () => void,
	) => Promise<AudioBuffer | null>;
};

/** ブラウザから VOICEVOX エンジンを呼んで歌わせる係。 */
export const createVoicevoxRenderer = (
	ctx: BaseAudioContext,
	baseUrl: string = VOICEVOX_DEFAULT_URL,
): VoicevoxRenderer => {
	const cache = new Map<string, Promise<AudioBuffer | null>>();
	const queue = createPriorityQueue();
	let warned = false;
	const enqueue = (
		key: string,
		synth: () => Promise<ArrayBuffer>,
		priority = 0,
		onStart?: () => void,
	): Promise<AudioBuffer | null> => {
		const hit = cache.get(key);
		if (hit) return hit;
		const job = queue(priority, () => {
			onStart?.();
			return synth();
		})
			.then((wav) => ctx.decodeAudioData(wav))
			// エンジン・歌い手ごとに違う素の大きさを、koe の声に近い大きさへそろえる
			.then(normalizeExternalVoice)
			.catch((err) => {
				// エンジン未起動なら全フレーズが落ちるので、警告は1回だけ出す。
				if (!warned) {
					warned = true;
					console.warn(
						`[dtm] VOICEVOX（${baseUrl}）で歌えませんでした。エンジンが起動しているか確かめてください`,
						err,
					);
				}
				cache.delete(key); // 起動し直したら作り直せるように
				return null;
			});
		cache.set(key, job);
		return job;
	};
	const render: VoicevoxRenderer["render"] = (
		style,
		score,
		priority,
		onStart,
	) =>
		enqueue(
			`${style}|${JSON.stringify(score.notes)}`,
			() => synthesizeVoicevoxSong(score, { singer: style, baseUrl }),
			priority,
			onStart,
		);
	const speak: VoicevoxRenderer["speak"] = (speaker, text, priority, onStart) =>
		enqueue(
			`talk|${speaker}|${text}`,
			() => synthesizeVoicevoxTalk(text, { speaker, baseUrl }),
			priority,
			onStart,
		);
	return { render, speak };
};
