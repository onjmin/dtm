/**
 * MML歌詞拡張 — 解析・正規化・同期（ヘッドレス）と、任意の歌唱合成ヘルパ。
 *
 * 既存の演奏トラック（@n）とは独立した「歌詞専用行」(@@n) を扱う。
 *   @@<トラックID> <モデル名> <歌詞>
 *   例: `@@2 klatt どはどなつのど`
 *       `@@3 external_engine きょー`
 *
 * 区切りは半角スペース（引用符不要）。歌詞内のひらがな・カタカナと、
 * 制御記号 `ー` `〜`（継続）・`っ`（促音）・`_`（休符）・`、`（ブレス）以外は破棄する。
 *
 * 演奏データ（テンポ・休符・音符長）とは完全に分離されており、
 * Note On のタイミングで音節を1つずつ消費して歌わせる。
 *
 * このライブラリ自体は音を出さない方針のため、解析・同期（createLyricsConductor）と
 * オプトインのフォルマント合成ヘルパ（createKlattVoice / createVoiceRegistry）を分離して提供する。
 */

import {
	leadInFromEntry,
	type PhonemeEntry,
	type SpeakingStyleInput,
	UtauTTSAdapter,
	type UtauTTSPlan,
	type UtauTTSRenderOptions,
	VoiceBank,
	Worldline,
} from "@onjmin/koe";
import type { PitchSegment } from "./pitch-curve";
import {
	glideMsForSegments,
	pitchCurveFor,
	segmentsCacheKey,
	transposeSegments,
} from "./pitch-curve";
import {
	getSpeechPlanner,
	medianRecordedPitchHz,
	prefetchSpeechPcm,
	prepareSpeechPlan,
	type SpeechBank,
	type SpeechEmotion,
	type SpeechMora,
	type SpeechPlanner,
	speechBankView,
	speechPlanDurationSec,
	speechPlanLeadingSec,
	speechPlanMorae,
	speechRenderOptions,
} from "./speech";
import {
	createSpeechScheduler,
	resolveLateChunks,
	type SpeechLateChunks,
	type SpeechPlacement,
	skipPlacement,
	speechBufferReached,
	speechStartTime,
} from "./speech-schedule";
import { UNITS_PER_SEMITONE, type Units, units } from "./tuning";
import type {
	CustomVocalDef,
	FadeStop,
	LyricSyllable,
	LyricTrack,
	OctaveUnisonMode,
	PlayNoteEvent,
} from "./types";
import { DEFAULT_GATE, DEFAULT_PAN, DEFAULT_VOCAL_VOLUME } from "./types";
import { VIBRATO_MIN_SEC } from "./vibrato";
import type {
	VoiceWorkerInit,
	VoiceWorkerOutbound,
	VoiceWorkerPcm,
	VoiceWorkerPcmReq,
	VoiceWorkerRendered,
	VoiceWorkerRenderReq,
	VoiceWorkerSpeakAbort,
	VoiceWorkerSpeakReq,
} from "./voice-worker-types";
import { packCompositeAlias, unpackCompositeAlias } from "./voice-worker-types";

export type { PitchSegment } from "./pitch-curve";
export type {
	LyricSyllable,
	LyricSyllableKind,
	LyricTrack,
	OctaveUnisonMode,
} from "./types";
export { VIBRATO_MIN_SEC } from "./vibrato";

/** かな → [子音, 母音] のローマ字対応表（清音・濁音・半濁音・撥音） */
const kanaTable: Record<string, [string, string]> = {
	あ: ["", "a"],
	い: ["", "i"],
	う: ["", "u"],
	え: ["", "e"],
	お: ["", "o"],
	か: ["k", "a"],
	き: ["k", "i"],
	く: ["k", "u"],
	け: ["k", "e"],
	こ: ["k", "o"],
	さ: ["s", "a"],
	し: ["sh", "i"],
	す: ["s", "u"],
	せ: ["s", "e"],
	そ: ["s", "o"],
	た: ["t", "a"],
	ち: ["ch", "i"],
	つ: ["ts", "u"],
	て: ["t", "e"],
	と: ["t", "o"],
	な: ["n", "a"],
	に: ["n", "i"],
	ぬ: ["n", "u"],
	ね: ["n", "e"],
	の: ["n", "o"],
	は: ["h", "a"],
	ひ: ["h", "i"],
	ふ: ["f", "u"],
	へ: ["h", "e"],
	ほ: ["h", "o"],
	ま: ["m", "a"],
	み: ["m", "i"],
	む: ["m", "u"],
	め: ["m", "e"],
	も: ["m", "o"],
	や: ["y", "a"],
	ゆ: ["y", "u"],
	よ: ["y", "o"],
	ら: ["r", "a"],
	り: ["r", "i"],
	る: ["r", "u"],
	れ: ["r", "e"],
	ろ: ["r", "o"],
	わ: ["w", "a"],
	を: ["w", "o"],
	が: ["g", "a"],
	ぎ: ["g", "i"],
	ぐ: ["g", "u"],
	げ: ["g", "e"],
	ご: ["g", "o"],
	ざ: ["z", "a"],
	じ: ["j", "i"],
	ず: ["z", "u"],
	ぜ: ["z", "e"],
	ぞ: ["z", "o"],
	だ: ["d", "a"],
	ぢ: ["j", "i"],
	づ: ["z", "u"],
	で: ["d", "e"],
	ど: ["d", "o"],
	ば: ["b", "a"],
	び: ["b", "i"],
	ぶ: ["b", "u"],
	べ: ["b", "e"],
	ぼ: ["b", "o"],
	ぱ: ["p", "a"],
	ぴ: ["p", "i"],
	ぷ: ["p", "u"],
	ぺ: ["p", "e"],
	ぽ: ["p", "o"],
	ゔ: ["v", "u"],
	ん: ["N", "N"],
};

/**
 * 同じ発音で別の綴りのかな。音源に綴りが無いとき（つくよみちゃん・ロゼ・リノ0.3 に
 * ぢ・づが無い）に、同じ音の素片で歌うための対応。
 */
const SAME_SOUND_KANA: Record<string, string> = {
	ぢ: "じ",
	づ: "ず",
	ぢゃ: "じゃ",
	ぢゅ: "じゅ",
	ぢょ: "じょ",
};

/** ヴ系の代用（音源にヴが無いとき）。日本語の慣習どおりバ行で近似する。 */
const V_TO_B_KANA: Record<string, string> = {
	a: "ば",
	i: "び",
	u: "ぶ",
	e: "べ",
	o: "ぼ",
};

/** ひらがなをカタカナへ（音源のカタカナ別名を引くため）。 */
const toKatakana = (kana: string): string =>
	kana.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/**
 * 直前のかなと結合して1音節を成す「小さいかな」（拗音・小さい母音）。
 * 促音「っ」は sanitizeText の時点で除去済みのためここには現れない。
 */
const SMALL_KANA = "ぁぃぅぇぉゃゅょ";

/**
 * 鼻濁音の印（半濁点 `゜`）。`が゜` / `か゚` は鼻濁音の標準的な書き方で、
 * カタカナのガ行（`ガ`）も同じ意味に畳む（UTAU音源の慣習に合わせる）。
 * 直前のかなへ付いて1音節になる。
 */
const NASAL_MARK = "゜";

/** 母音文字（あ・い・う・え・お）。長音記号の置換先に使う */
const VOWEL_KANA: Record<string, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
};

/**
 * 継続記号。直前の音を言い直さずに保ち、ピッチだけを次の音へ移す。
 * 声が繋がっている以上ピッチも繋がっているべきなので、移動は音価に比例した
 * 短いグライドで行う（瞬間移動させると耳が「言い直した」と受け取る）。
 */
export const TIE_MARK = "ー";
/**
 * 継続記号（ポルタメント）。{@link TIE_MARK} と同じだが、区間の大半を掛けて
 * ゆっくり滑る＝しゃくり・スラーになる。違いは掛ける時間だけ。
 */
export const PORTAMENTO_MARK = "〜";
/** 促音。ノートを消費し、無音の閉鎖として間を作る。 */
export const STOP_MARK = "っ";
/** 明示的な休符。ノートを消費するが歌わない（そのノートは無音になる）。 */
export const REST_MARK = "_";
/** ブレス。ノートは消費せず、直前ノートの尻を削って息継ぎを差し込む。 */
export const BREATH_MARK = "、";
/**
 * デクレッシェンド。ノートは消費せず、直前の音（継続で結合されていればその全体）を
 * 歌いながら声量0へ落とす。`あーーーーー↓` で「あ」を伸ばしたまま消えていく。
 *
 * 1音へ複数書くと、書いた位置が減り方の中継点になる（`ぎ↓ー↓` = 50%→0%）。
 * 詳細は {@link buildFadeCurve}。
 */
export const FADE_OUT_MARK = "↓";
/**
 * クレッシェンド。ノートは消費せず、直前の音（継続で結合されていればその全体）を
 * 歌いながら声量を上げていく。{@link FADE_OUT_MARK} と併用するとスウェルになる。
 */
export const FADE_IN_MARK = "↑";
/**
 * 語り（読み上げ）の開き括弧。`「こんにちは」` のように囲んだ部分は歌わずに
 * UtauTTS で読み上げる。括弧ひとかたまりでノートを1つ消費し、そのノートの位置から
 * 話し始める。中身は漢字・数字・句読点を含んでよい（読みは jpreprocess が決める）。
 * 閉じ括弧が無ければ行末までを語りとみなす。
 */
export const SPEAK_OPEN = "「";
/** 語りの閉じ括弧（{@link SPEAK_OPEN} の対）。対応する開き括弧が無ければ無視する。 */
export const SPEAK_CLOSE = "」";

/** 歌詞テキストを「歌う部分」と「語る部分（`「…」` の中身）」へ切り分けた1片。 */
type LyricPiece = { sung: string } | { speak: string };

/**
 * 歌詞テキストを `「…」` で歌う部分と語る部分へ切り分ける。
 *
 * 半角の `｢` `｣` も同じ括弧として扱う。最初の `「` から最初の `」` までを1つの語りに
 * する（入れ子は解釈しない）。閉じ括弧が無ければ行末までを語りとし、対応する開き括弧の
 * 無い `」` はそのまま歌う側へ流す（{@link sanitizeText} がかな以外を捨てるので消える）。
 */
const splitSpeech = (text: string): LyricPiece[] => {
	const pieces: LyricPiece[] = [];
	let sung = "";
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === SPEAK_OPEN || ch === "｢") {
			let end = -1;
			for (let j = i + 1; j < text.length; j++) {
				if (text[j] === SPEAK_CLOSE || text[j] === "｣") {
					end = j;
					break;
				}
			}
			if (sung) pieces.push({ sung });
			sung = "";
			const body = end < 0 ? text.slice(i + 1) : text.slice(i + 1, end);
			pieces.push({ speak: body });
			i = end < 0 ? text.length : end + 1;
			continue;
		}
		sung += ch;
		i++;
	}
	if (sung) pieces.push({ sung });
	return pieces;
};

/**
 * 語りの本文を正規化する。前後の空白を落とし、改行は読点相当の区切りとして
 * 空白へ潰す（MMLでは `;` と改行が区切り文字なので、本文に含められない）。
 */
const sanitizeSpeech = (text: string): string =>
	text
		.replace(/[\r\n;]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * カタカナをひらがなへ寄せ、かなと制御記号以外を破棄する。
 * 仕様: ひらがな／カタカナ ＋ {@link TIE_MARK} `ー` / {@link PORTAMENTO_MARK} `〜` /
 * {@link REST_MARK} `_` / {@link BREATH_MARK} `、`（促音 `っ` はかなに含まれる）。
 *
 * 記号の異体字はここで正規形へ寄せる（NFKC で `～`→`~`、`，`→`,`、`＿`→`_` になるため、
 * 残りの `~`→`〜`、`,`→`、` を明示で畳む）。
 *
 * 2.0系までは `っ` `ー` を「音声サンプルが存在しない」として丸ごと除去していたが、
 * どちらもノートを消費する制御記号になったため、ここでは残す。
 */
const sanitizeText = (text: string): string =>
	text
		.normalize("NFKC")
		// 結合半濁点（NFKC で `゜` もこれに分解される）→ 鼻濁音の印
		.replace(/\u309a/g, NASAL_MARK)
		// カタカナのガ行は鼻濁音（音源の慣習）。ひらがな + 印へ畳んでから一般の畳み込みへ
		.replace(
			/[ガギグゲゴ]/g,
			(c) => String.fromCharCode(c.charCodeAt(0) - 0x60) + NASAL_MARK,
		)
		// カタカナ(ァ-ヶ)→ひらがなへ寄せる
		.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
		// 記号の異体字を正規形へ寄せる
		.replace(/~/g, PORTAMENTO_MARK)
		.replace(/,/g, BREATH_MARK)
		// 上下矢印の異体字を正規形へ寄せる（↡ ⇩ ⬇ / ↟ ⇧ ⬆ など）
		.replace(/[↡⇩⬇🡇]/gu, FADE_OUT_MARK)
		.replace(/[↟⇧⬆🡅]/gu, FADE_IN_MARK)
		// ひらがな(ぁ-ゖ)と制御記号・鼻濁音の印以外を破棄
		.replace(/[^ぁ-ゖー〜_、↓↑゜]/g, "");

/**
 * 文字列を音節単位へ分解する。
 * 小さいかな（ぁぃぅぇぉゃゅょ）は直前の文字と結合して1音節にする。
 * 制御記号（`ー` `〜` `_` `、`）は結合対象にせず、常に単独で切り出す。
 */
const splitSyllables = (text: string): string[] => {
	const MARKS = `${TIE_MARK}${PORTAMENTO_MARK}${REST_MARK}${BREATH_MARK}${FADE_OUT_MARK}${FADE_IN_MARK}`;
	const result: string[] = [];
	for (const ch of text) {
		const prev = result[result.length - 1];
		const attachable =
			prev !== undefined && !MARKS.includes(prev[prev.length - 1]);
		if (attachable && SMALL_KANA.includes(ch)) {
			result[result.length - 1] += ch;
		} else if (ch === NASAL_MARK) {
			// 鼻濁音の印は直前のかなへ付く。付く相手が無ければ捨てる（音節にはしない）。
			if (attachable && !prev.includes(NASAL_MARK))
				result[result.length - 1] += ch;
		} else {
			result.push(ch);
		}
	}
	return result;
};

/** 1文字のかなから母音を判定する（小さいかな・拗音にも対応） */
const kanaToVowel = (kana: string): string => {
	if (/[ぁゃ]/.test(kana)) return "a";
	if (/[ぃ]/.test(kana)) return "i";
	if (/[ぅゅ]/.test(kana)) return "u";
	if (/[ぇ]/.test(kana)) return "e";
	if (/[ぉょ]/.test(kana)) return "o";
	if (/[あかさたなはまやらわがざだばぱ]/.test(kana)) return "a";
	if (/[いきしちにひみりぎじぢびぴ]/.test(kana)) return "i";
	if (/[うくすつぬふむゆるぐずづぶぷ]/.test(kana)) return "u";
	if (/[えけせてねへめれげぜでべぺ]/.test(kana)) return "e";
	if (/[おこそとのほもよろごぞどぼぽ]/.test(kana)) return "o";
	return "";
};

/**
 * 音節文字列を子音・母音へ分解する。
 * 制御記号（継続 `ー`/`〜`・促音 `っ`・休符 `_`）は種別だけを立てて返し、
 * 継続の母音は {@link normalizeLyrics} が直前の音節から埋める。
 */
const analyzeSyllable = (syllable: string): LyricSyllable => {
	if (syllable === TIE_MARK)
		return { kana: syllable, consonant: "-", vowel: "-", kind: "tie" };
	if (syllable === PORTAMENTO_MARK)
		return {
			kana: syllable,
			consonant: "-",
			vowel: "-",
			kind: "tie",
			portamento: true,
		};
	if (syllable === STOP_MARK)
		return { kana: syllable, consonant: "Q", vowel: "", kind: "stop" };
	if (syllable === REST_MARK)
		return { kana: syllable, consonant: "", vowel: "", kind: "rest" };

	// 鼻濁音の印は綴りから外し、フラグとして持つ（"ぎ゜ゃ" → "ぎゃ" + nasal）。
	const nasal = syllable.includes(NASAL_MARK);
	if (nasal) syllable = syllable.replace(NASAL_MARK, "");

	const head = syllable[0];
	const row = kanaTable[head];
	const consonant = row ? row[0] : "";
	let vowel = row ? row[1] : kanaToVowel(head);

	// 拗音・小さい母音（2文字目）が母音を上書きする。促音(っ)は単独音節として
	// 別分岐で処理されるため、ここに来る2文字音節は常に拗音・小さい母音の合体。
	if (syllable.length === 2) {
		const v = kanaToVowel(syllable[1]);
		if (v) vowel = v;
	}
	return nasal
		? { kana: syllable, consonant, vowel, nasal: true }
		: { kana: syllable, consonant, vowel };
};

/**
 * 歌詞文字列（かな＋制御記号）を正規化済み音節列へ変換する。
 *
 * 出力の1要素＝ノート1つぶん。ブレス（`、`）だけはノートを消費せず、
 * 直前の音節の {@link LyricSyllable.breathAfter} へ畳まれる。
 *
 * 継続記号（`ー` / `〜`）は直前の音節の母音を焼き込んで返す（例: きょ + ー → きょ + お）。
 * `kind: "tie"` は残るので、発音側は「言い直さない」判断ができ、表示側は `ー` へ戻せる。
 *
 * - 撥音（ん）の直後の継続は「ん」を伸ばす（ハミング）。
 * - 促音（`っ`）は母音の文脈を切らない（語中の詰まりなので直前母音を保つ）。
 * - 休符（`_`）は歌わず、ブレス（`、`）ともども母音の文脈を切る。次の音節は語頭として歌われる。
 * - 引き継ぐ母音が無い継続（行頭・ブレス直後）は意味を持たないので捨てる。
 * - `「…」` は語り（{@link SPEAK_OPEN}）。ひとかたまりで `kind: "speak"` の1音節になり、
 *   中身は {@link LyricSyllable.text} に生のまま残る（かな以外も捨てない）。
 *   語りのあとは母音の文脈が切れる。
 */
export const normalizeLyrics = (text: string): LyricSyllable[] => {
	const result: LyricSyllable[] = [];
	let prevVowel = "";
	for (const piece of splitSpeech(text)) {
		if ("speak" in piece) {
			const body = sanitizeSpeech(piece.speak);
			// 空の `「」` は「ノートを1つ使って何も言わない」＝休符と同じ。
			result.push(
				body
					? { kana: body, consonant: "", vowel: "", kind: "speak", text: body }
					: { kana: REST_MARK, consonant: "", vowel: "", kind: "rest" },
			);
			// 語りの後は息が切れる。次の音節は語頭として歌う（`_` と同じ）。
			prevVowel = "";
			continue;
		}
		for (const mark of splitSyllables(sanitizeText(piece.sung))) {
			if (mark === BREATH_MARK) {
				const last = result[result.length - 1];
				if (last) last.breathAfter = true;
				prevVowel = "";
				continue;
			}
			// デクレッシェンドもノートを消費しない。直前の音（＝結合後の1音）へ畳む。
			// 母音の文脈は切らない——音は続いたまま小さくなるだけなので、
			// 後ろに継続記号が来たら引き続き伸ばせる（`あー↓ー` が成立する）。
			if (mark === FADE_OUT_MARK) {
				const last = result[result.length - 1];
				if (last) last.fadeOut = true;
				continue;
			}
			if (mark === FADE_IN_MARK) {
				const last = result[result.length - 1];
				if (last) last.fadeIn = true;
				continue;
			}
			const syl = analyzeSyllable(mark);
			if (syl.kind === "tie") {
				// 引き継ぐ母音が無い継続（行頭・ブレス直後・語りの直後）は意味を持たないので捨てる。
				if (!prevVowel) continue;
				result.push({
					...syl,
					kana: prevVowel === "N" ? "ん" : (VOWEL_KANA[prevVowel] ?? syl.kana),
					consonant: "",
					vowel: prevVowel,
				});
				continue;
			}
			if (syl.kind === "rest") prevVowel = "";
			else if (syl.vowel) prevVowel = syl.vowel; // 撥音(N)も継続の引き継ぎ元になる
			result.push(syl);
		}
	}
	return result;
};

/**
 * 音節を歌詞テキストの1文字（表示・MMLへの書き戻し用）へ戻す。
 * 継続・休符は元の記号へ、ブレスは直後に `、` を付けて返す。
 *
 * {@link LyricSyllable.kana} は継続のとき「引き継いだ母音のかな」なので、
 * これをそのまま繋ぐと `あーー` が `あああ` になって継続の意図が失われる。
 * 表示と往復（MML ⇄ エディタ）には必ずこちらを使うこと。
 */
export const displayKana = (syl: LyricSyllable): string => {
	const head =
		syl.kind === "tie"
			? syl.portamento
				? PORTAMENTO_MARK
				: TIE_MARK
			: syl.kind === "rest"
				? REST_MARK
				: syl.kind === "speak"
					? `${SPEAK_OPEN}${syl.text ?? syl.kana}${SPEAK_CLOSE}`
					: syl.nasal
						? toKatakana(syl.kana) // 鼻濁音はカタカナで書き戻す（読み直せば同じ印になる）
						: syl.kana;
	let out = syl.breathAfter ? head + BREATH_MARK : head;
	// 併記の順は ↑↓ に正規化する（スウェルは書いた順を問わないため）。
	if (syl.fadeIn) out += FADE_IN_MARK;
	if (syl.fadeOut) out += FADE_OUT_MARK;
	return out;
};

/** 音節列を歌詞テキストへ戻す（{@link displayKana} の連結）。 */
export const syllablesToText = (syllables: LyricSyllable[]): string =>
	syllables.map(displayKana).join("");

/**
 * 複数行に分かれた歌詞を1つの音節列へまとめ、改行位置を併せて返す。
 * lineBreaks には「直前に改行があった」音節のインデックスが入る（先頭行ぶんは含めない）。
 */
const normalizeLyricLines = (
	lines: string[],
): { syllables: LyricSyllable[]; lineBreaks: number[] } => {
	const syllables: LyricSyllable[] = [];
	const lineBreaks: number[] = [];
	for (const line of lines) {
		const part = normalizeLyrics(line);
		if (part.length === 0) continue; // 空行・かな無しの行は改行として数えない
		if (syllables.length > 0) lineBreaks.push(syllables.length);
		syllables.push(...part);
	}
	return { syllables, lineBreaks };
};

/** 歌詞専用行か判定する（@@<数字> で始まる行） */
const LYRIC_LINE = /^@@(\d+)\s*(.*)$/;

/**
 * 歌詞の継続行か判定する。@@n 歌詞行のあとに改行で続くセグメントのうち、
 * 新しい文（@… のトラック/歌詞行、#… のトップレベル宣言）でないものを歌詞の続きとみなす。
 */
const isLyricContinuation = (seg: string): boolean => !/^[@#]/.test(seg);

/** MMLを物理行・`;`区切りでセグメントへ分割する */
const splitSegments = (mml: string): string[] =>
	mml
		.split(/[;\n\r]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

/** 値を [lo, hi] にクリップする（パーサのクラッシュ・暴走防止） */
const clamp = (value: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, value));

/**
 * 歌唱の声量の上限（%）。100=等倍。100超は合成音声をブースト（増幅）する。
 * 100では音量が足りないケース向けに大きめのヘッドルームを確保する。
 * UIスライダー・MML（`v<n>`）パースの双方でこの上限を共有する。
 * {@link vocalVolumeToGain} により v=400 で約 +24dB（≒15.8倍）まで上げられる。
 */
export const MAX_VOCAL_VOLUME = 400;

/**
 * 100超ブースト域での 1%（=1目盛り）あたりの増分（dB）。
 * v=400 のとき (400-100)*0.08 = +24dB ≒ 15.8倍。
 */
const VOCAL_BOOST_DB_PER_PERCENT = 0.08;

/**
 * 声量値（0-{@link MAX_VOCAL_VOLUME}）を実際のゲイン係数へ変換する。
 *
 * - 0 → 0（無音）, 100 → 1（等倍）。
 * - 0-100 は従来どおりの線形（既存MMLの音量を変えないため）。
 * - 100超は dB 線形（=ゲインは対数）のブースト。スライダーを等間隔で動かすと
 *   等dB＝知覚的に均等な音量変化になる。
 *
 * v=100 で両分岐が連続（線形側=1、対数側=10^0=1）するため、つなぎ目で段差は出ない。
 */
export const vocalVolumeToGain = (v: number): number => {
	if (v <= 0) return 0;
	if (v <= 100) return v / 100; // 0-100は従来互換の線形フェード
	return 10 ** (((v - 100) * VOCAL_BOOST_DB_PER_PERCENT) / 20);
};

/**
 * MMLから全歌詞トラックを解析し、トラックIDをキーにした辞書を返す（プリスキャン）。
 * 同一IDが複数あれば後勝ち。
 *
 * 記法: `@@<トラックID> <モデル名> [v<声量>] [q<ゲート>] <歌詞>`
 *   例: `@@4 klatt v100 歌詞`（声量100＝等倍。100超でブースト、上限 {@link MAX_VOCAL_VOLUME}）
 * 声量は 0-{@link MAX_VOCAL_VOLUME}、ゲートは 0-100。モデル名直後の `v`/`q` トークンとして任意順で付与でき、
 * 最初に現れた歌詞（かな）トークンより前にあるものだけを解釈する。
 * 後方互換として `klatt:80` のコロン区切り声量も受け付ける。
 */
export const parseLyrics = (mml: string): Map<number, LyricTrack> => {
	const tracks = new Map<number, LyricTrack>();
	const segments = splitSegments(mml);
	for (let i = 0; i < segments.length; i++) {
		const m = segments[i].match(LYRIC_LINE);
		if (!m) continue;
		const trackId = Number.parseInt(m[1], 10);
		let rest = m[2].trim();

		let volume = DEFAULT_VOCAL_VOLUME; // 省略時の声量
		let gate = 100; // 省略時のゲート（レガート）
		let pan = 64; // 省略時の定位（中央）
		let octave = 0; // 省略時のオクターブシフト（演奏ノートのピッチそのまま）
		let vibrato = false; // 省略時は自動ビブラートOFF
		let reverb = 0; // 省略時はリバーブセンドOFF（マスタリバーブが掛からない）
		let delay = 0; // 省略時はディレイセンドOFF（マスタディレイが掛からない）
		let gender = 50; // 省略時は無変化（中央）
		let breathiness = 50; // 省略時は無変化（中央）
		let tension = 50; // 省略時は無変化（中央）
		let octaveUnison: OctaveUnisonMode = "none"; // 省略時はオクターブユニゾンなし

		// モデル名は英字・アンダースコア始まりで、2文字目以降は数字も許す
		// （カスタムボーカルのキー custom1 等）。`v100` 等のパラメータトークンは
		// 先読みの [vqpobrghew]-?\d で区切るため誤って取り込まない。
		const modelMatch = rest.match(
			/^([a-z_][a-z0-9_]*?)(?=(?:[vqpobrghewt]-?\d)|[^a-z0-9_]|$)(?::(\d+))?/i,
		);
		let model = "";
		const metaTokens: string[] = [];

		if (modelMatch) {
			model = modelMatch[1].toLowerCase();
			if (modelMatch[2]) {
				volume = clamp(Number.parseInt(modelMatch[2], 10), 0, MAX_VOCAL_VOLUME);
			}
			metaTokens.push(modelMatch[0]);
			rest = rest.substring(modelMatch[0].length).trim();
		}

		while (true) {
			const vMatch = rest.match(/^v(\d+)/i);
			if (vMatch) {
				volume = clamp(Number.parseInt(vMatch[1], 10), 0, MAX_VOCAL_VOLUME);
				metaTokens.push(vMatch[0]);
				rest = rest.substring(vMatch[0].length).trim();
				continue;
			}
			const qMatch = rest.match(/^q(\d+)/i);
			if (qMatch) {
				gate = clamp(Number.parseInt(qMatch[1], 10), 0, 100);
				metaTokens.push(qMatch[0]);
				rest = rest.substring(qMatch[0].length).trim();
				continue;
			}
			const pMatch = rest.match(/^p(\d+)/i);
			if (pMatch) {
				pan = clamp(Number.parseInt(pMatch[1], 10), 0, 127);
				metaTokens.push(pMatch[0]);
				rest = rest.substring(pMatch[0].length).trim();
				continue;
			}
			const oMatch = rest.match(/^o(-?\d+)/i);
			if (oMatch) {
				octave = clamp(Number.parseInt(oMatch[1], 10), -2, 2);
				metaTokens.push(oMatch[0]);
				rest = rest.substring(oMatch[0].length).trim();
				continue;
			}
			const bMatch = rest.match(/^b([01])/i);
			if (bMatch) {
				vibrato = bMatch[1] === "1";
				metaTokens.push(bMatch[0]);
				rest = rest.substring(bMatch[0].length).trim();
				continue;
			}
			const rMatch = rest.match(/^r(\d+)/i);
			if (rMatch) {
				reverb = clamp(Number.parseInt(rMatch[1], 10), 0, 100);
				metaTokens.push(rMatch[0]);
				rest = rest.substring(rMatch[0].length).trim();
				continue;
			}
			const gMatch = rest.match(/^g(\d+)/i);
			if (gMatch) {
				gender = clamp(Number.parseInt(gMatch[1], 10), 0, 100);
				metaTokens.push(gMatch[0]);
				rest = rest.substring(gMatch[0].length).trim();
				continue;
			}
			const hMatch = rest.match(/^h(\d+)/i);
			if (hMatch) {
				breathiness = clamp(Number.parseInt(hMatch[1], 10), 0, 100);
				metaTokens.push(hMatch[0]);
				rest = rest.substring(hMatch[0].length).trim();
				continue;
			}
			const tMatch = rest.match(/^t(\d+)/i);
			if (tMatch) {
				tension = clamp(Number.parseInt(tMatch[1], 10), 0, 100);
				metaTokens.push(tMatch[0]);
				rest = rest.substring(tMatch[0].length).trim();
				continue;
			}
			const eMatch = rest.match(/^e(\d+)/i);
			if (eMatch) {
				delay = clamp(Number.parseInt(eMatch[1], 10), 0, 100);
				metaTokens.push(eMatch[0]);
				rest = rest.substring(eMatch[0].length).trim();
				continue;
			}
			const wMatch = rest.match(/^w([0-3])/i);
			if (wMatch) {
				// 0=none 1=down（旧オクターブダブル、後方互換） 2=up 3=both
				octaveUnison = (["none", "down", "up", "both"] as const)[
					Number.parseInt(wMatch[1], 10)
				];
				metaTokens.push(wMatch[0]);
				rest = rest.substring(wMatch[0].length).trim();
				continue;
			}
			break;
		}

		// 先頭行の残り＋改行で続く継続行を1つの歌詞として扱う。
		// 継続行は新しい文（@… / #…）が現れるか、空行で途切れるまで歌詞の続きとみなす。
		const lyricLines = [rest];
		while (i + 1 < segments.length && isLyricContinuation(segments[i + 1])) {
			lyricLines.push(segments[++i]);
		}
		const { syllables, lineBreaks } = normalizeLyricLines(lyricLines);

		tracks.set(trackId, {
			trackId,
			model,
			volume,
			gate,
			pan,
			octave,
			vibrato,
			reverb,
			delay,
			gender,
			breathiness,
			tension,
			octaveUnison,
			syllables,
			metaText: metaTokens.join(" "),
			...(lineBreaks.length > 0 ? { lineBreaks } : {}),
		});
	}
	return tracks;
};

/**
 * 歌詞専用行を除去し、演奏トラックのみのMMLを返す。
 * parseMML が @@n を演奏ノートとして誤解釈しないよう前処理する。
 */
export const stripLyrics = (mml: string): string => {
	const segments = splitSegments(mml);
	const kept: string[] = [];
	for (let i = 0; i < segments.length; i++) {
		if (LYRIC_LINE.test(segments[i])) {
			// 歌詞行に続く継続行（改行で書かれた歌詞の続き）もまとめて除去する
			while (i + 1 < segments.length && isLyricContinuation(segments[i + 1]))
				i++;
			continue;
		}
		kept.push(segments[i]);
	}
	return kept.join("\n");
};

// ─────────────────────────────────────────────────────────────
// カスタムボーカル宣言（@@keyword icon_url koe_url）
// ─────────────────────────────────────────────────────────────

/**
 * カスタムボーカル宣言行のパターン。`@@数字` とは区別するため先頭トークンは英字必須。
 * キャプチャ: [1]=key（英数字+アンダースコア）, [2]=iconUrl, [3]=koeUrl
 */
const CUSTOM_VOCAL_LINE = /^@@([a-zA-Z_][a-zA-Z0-9_]*)\s+(\S+)\s+(\S+)\s*$/;

/** カスタムボーカル URL の常識的な最大長（これを超えるものは読み込まない） */
const CUSTOM_VOCAL_URL_MAX_LEN = 2048;

/** URL 文字列が http / https スキームの妥当な形式かを簡易チェックする（UI入力の検証にも使う） */
export const isValidHttpUrl = (s: string): boolean => {
	if (s.length > CUSTOM_VOCAL_URL_MAX_LEN) return false;
	try {
		const u = new URL(s);
		return u.protocol === "http:" || u.protocol === "https:";
	} catch {
		return false;
	}
};

/**
 * MMLからカスタムボーカル宣言行を解析し、定義配列を返す。
 *
 * 記法: `@@key icon_url koe_url`
 *   例: `@@testvocal https://example.com/icon.png https://example.com/voice.koe`
 *
 * - key は英字始まりの英数字・アンダースコア列（数字のみは既存 LYRIC_LINE 扱い）
 * - icon_url は http / https の URL のみ有効。不正・長すぎは 404Chip.png にフォールバック
 * - koe_url は http / https の URL かつ {CUSTOM_VOCAL_URL_MAX_LEN} 文字以内のみ有効。
 *   不正・長すぎの場合はその宣言ごとスキップ（楽曲読み込みは継続する）。
 * - 同一 key が複数あれば後勝ち。
 */
export const parseCustomVocals = (mml: string): CustomVocalDef[] => {
	const map = new Map<string, CustomVocalDef>();
	for (const seg of splitSegments(mml)) {
		const m = seg.match(CUSTOM_VOCAL_LINE);
		if (!m) continue;
		const key = m[1].toLowerCase();
		const iconUrl = m[2];
		const koeUrl = m[3];
		// koe URL が不正・長すぎならスキップ（楽曲読み込みは中断しない）
		if (!isValidHttpUrl(koeUrl)) {
			console.warn(
				`[dtm] カスタムボーカル "${key}": koe URL が不正または長すぎるためスキップします`,
				koeUrl.slice(0, 80),
			);
			continue;
		}
		// icon URL は不正でも宣言全体は生かし、フォールバックで表示する
		const resolvedIconUrl = isValidHttpUrl(iconUrl) ? iconUrl : "";
		map.set(key, { key, iconUrl: resolvedIconUrl, url: koeUrl });
	}
	return [...map.values()];
};

/**
 * カスタムボーカル宣言行を除去し、残りの MML を返す。
 * `parseMML` / `parseLyrics` が `@@keyword` を誤解釈しないよう前処理する。
 *
 * 宣言セグメントだけを取り除き、それ以外の行・`;` 区切りは元の構造のまま残す
 * （コメント除去より前の生MMLに適用しても他セグメントへ影響しないため）。
 */
export const stripCustomVocals = (mml: string): string =>
	mml
		.split(/[\n\r]+/)
		.map((line) =>
			line
				.split(";")
				.filter((seg) => !CUSTOM_VOCAL_LINE.test(seg.trim()))
				.join(";"),
		)
		.join("\n");

// ─────────────────────────────────────────────────────────────
// 同期（ヘッドレス）
// ─────────────────────────────────────────────────────────────

/** 1つの音節を消費した結果。利用側はこれを歌唱合成へ渡す */
export type ConsumedSyllable = {
	/** 歌う合成モデル名 */
	model: string;
	/** 消費した音節 */
	syllable: LyricSyllable;
	/**
	 * 歌唱の声量係数（歌詞トラックの volume 0-{@link MAX_VOCAL_VOLUME} を正規化したもの）。
	 * 1=等倍で、100超指定時は 1 を超える（ブースト）。ノートのvelocityとは独立。
	 * 利用側はこれにマスタ音量を掛けて発音音量とする。
	 */
	volume: number;
	/**
	 * 歌唱のゲートタイム係数 0-1（歌詞トラックの gate 0-100 を正規化したもの）。
	 * 利用側はノートの発音長（秒）にこれを掛けて実際の歌唱長とする。既定1（レガート）。
	 */
	gate: number;
	/**
	 * ステレオ定位 -1(左)〜+1(右)、0が中央（歌詞トラックの pan 0-127 を正規化したもの）。
	 * 利用側は StereoPannerNode.pan などへそのまま渡す。
	 */
	pan: number;
};

/** MML の pan 値(0-127, 64=中央) を StereoPanner 用の -1〜+1 へ正規化する */
export const panToStereo = (pan: number): number =>
	Math.max(-1, Math.min(1, (pan - 64) / 64));

/** 歌詞同期コンダクタ。音節ポインタを保持し、Note On ごとに1音節消費する */
export type LyricsConductor = {
	/**
	 * 演奏トラック trackId の Note On に対応する音節を1つ消費して返す。
	 * 歌詞が無い／尽きた場合は null（利用側は楽器音として鳴らす）。
	 */
	consume: (trackId: number) => ConsumedSyllable | null;
	/** ポインタを初期化する（再生開始時に呼ぶ） */
	reset: () => void;
};

/**
 * 歌詞トラック辞書から同期コンダクタを生成する。
 *
 * 演奏トラック（@n）で Note On されるたびに consume(n) を呼び、対応する歌詞配列の
 * 現在の音節を消費（ポインタをインクリメント）する。合成方法には依存しない。
 */
export const createLyricsConductor = (
	lyrics: Map<number, LyricTrack>,
): LyricsConductor => {
	const pointers = new Map<number, number>();

	const consume = (trackId: number): ConsumedSyllable | null => {
		const track = lyrics.get(trackId);
		if (!track || track.syllables.length === 0) return null;
		const ptr = pointers.get(trackId) ?? 0;
		const syllable = track.syllables[ptr];
		if (!syllable) return null; // 音節を使い切ったら以降は楽器音
		pointers.set(trackId, ptr + 1);
		return {
			model: track.model,
			syllable,
			volume: vocalVolumeToGain(track.volume ?? DEFAULT_VOCAL_VOLUME),
			gate: (track.gate ?? DEFAULT_GATE) / 100,
			pan: panToStereo(track.pan ?? DEFAULT_PAN),
		};
	};

	const reset = (): void => pointers.clear();

	return { consume, reset };
};

// ─────────────────────────────────────────────────────────────
// 音声合成モデル（オプトイン。Web Audio を使う利用側／内蔵synthのためのヘルパ）
// ─────────────────────────────────────────────────────────────

/**
 * トラック単位で固定の声質パラメータ（0-1、既定0.5=無変化）。koe音源（Worldline）限定
 * — klattフォールバックには効かない。ビブラート/リバーブ送りと違い、ノート単位の判定は
 * 挟まず、指定されたトラックの全ノートへ一律に掛かる（声質そのものを決めるパラメータのため）。
 */
export type VoiceExpression = {
	/** フォルマント/ジェンダーファクター。0.5未満で低め/太め、0.5超で高め/細めに寄る。 */
	gender?: number;
	/** ブレシネス（息成分）。大きいほど息っぽく（ささやき寄り）。 */
	breathiness?: number;
	/** テンション（張り/力強さ）。大きいほど張った・押した声（こぶし寄り、力強く歌う）。 */
	tension?: number;
};

/** 歌唱合成モデルの実装シグネチャ */
export type VoiceModel = {
	/** 1音節を `ctx.currentTime + e.when` のタイミングで即時発音する（直接呼び出し用）。 */
	(syllable: LyricSyllable, e: PlayNoteEvent): void;
	/** 内部状態（直前母音など）を初期化する。 */
	reset?: () => void;
	/**
	 * 1音節を合成してキャッシュへ積み、再生に使うキャッシュキーを返す（重い処理はここ）。
	 * ストリーミングスケジューラが「先回り合成」に使う。直前母音は呼び出し側が明示で渡す
	 * （モデル内部状態に依存しないので、同一モデルを複数トラックで共有しても干渉しない）。
	 * 合成不能（該当音素なし・無声）なら null。klatt 等の軽量モデルは未実装でよい。
	 */
	renderToCache?: (
		syllable: LyricSyllable,
		prevVowel: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		/**
		 * 継続記号（`ー` / `〜`）で結合されたノート内のピッチ推移（2区間目以降）。
		 * 先頭区間は `pitch`、`durationMs` は結合後の全長。未指定なら単一ピッチ。
		 */
		pitchSegments?: PitchSegment[],
	) => Promise<string | null>;
	/**
	 * {@link renderToCache} 済みのバッファを絶対時刻 t0（AudioContextクロック秒）へスケジュールする。
	 * t0 は未来の任意時刻でよく、再生はオーディオスレッドが担うのでメインスレッドのもたつきに影響されない。
	 */
	scheduleCached?: (
		key: string,
		t0: number,
		peak: number,
		pan: number,
		reverbSend?: number,
		delaySend?: number,
		destination?: AudioNode,
		/**
		 * 直前ノートからの継続として鳴らす（継続記号がノート結合できなかったときの分割再生）。
		 * 先行母音を切り、立ち上がりを直前ノートの減衰へ被せて言い直し感を消す。
		 */
		continuation?: boolean,
		/** 歌いながら声量0へ落とす（`↓`）。{@link LyricSyllable.fadeOut} を引き回したもの。 */
		fadeOut?: boolean,
		/** 歌いながら声量を上げる（`↑`）。両方立てるとスウェルになる。 */
		fadeIn?: boolean,
		/** 記号を複数書いたときの声量の中継点列（{@link buildFadeCurve}）。 */
		fadeCurve?: FadeStop[],
		/**
		 * この音が占める長さ（秒。`t0` から数える）。
		 * 合成した素片は音価より長いことがある（短すぎるノートは合成の都合で
		 * 引き伸ばして作られる）ので、渡すと**その長さで切って**鳴らす。
		 * 省略すると素片の長さのまま鳴らす（従来どおり）。
		 */
		durationSec?: number,
	) => void;
	/** スケジュール済みの発音をすべて即停止する（停止・一時停止・シーク時）。 */
	stopAll?: () => void;
	/**
	 * 語尾の素片（連続音バンクの `a R` `n R` 等: 母音が自然に抜けていく収録）を
	 * 目標ピッチで合成してキャッシュへ積み、キーを返す。音源に無ければ null
	 * （呼び出し側はゲインのフェードだけで終える従来どおりになる）。
	 * 長さは素片の固定範囲（抜けの部分）から決めるので、呼び出し側は指定しない。
	 */
	renderEndingToCache?: (
		vowel: string,
		pitch: Units,
		expr?: VoiceExpression,
	) => Promise<string | null>;
	/**
	 * 音源が持つ息継ぎ素片（`息` `息短` `b1` など）から、吸う形（包絡の山が後ろ寄り）で
	 * `targetSec` の隙間にいちばん合う長さのものを選んで AudioBuffer で返す。
	 * 素片は最大振幅1へ正規化済み。音源に息継ぎ素片が無ければ null
	 * （呼び出し側はノイズ合成へ落とす）。候補の PCM は音源ごとに1度だけまとめて引く。
	 */
	breathSample?: (targetSec: number) => Promise<AudioBuffer | null>;
	/**
	 * 語り（`「…」`）を合成してキャッシュへ積み、再生に使うキャッシュキーを返す。
	 * 計画（読み・韻律・ユニット選択）が出来た時点で返り、合成はチャンクごとに裏で続く
	 * （{@link scheduleSpeech} は届いたチャンクから順に置く）。`awaitRender` は
	 * `"first-chunk"` で最初のチャンクが出るまで（頭出しの貯金用。長文でも再生開始を
	 * 塞がない）、`true` で全チャンクの合成完了まで待つ（書き出し用）。
	 * `pitch` は話す基準ピッチ（units）。計画不能（読みが取れない・アセット取得失敗）なら null。
	 * koe 音源専用。klatt 等は未実装でよい（その場合は語りは鳴らない）。
	 */
	speakToCache?: (
		text: string,
		pitch: number,
		expr?: VoiceExpression,
		awaitRender?: boolean | "first-chunk",
	) => Promise<string | null>;
	/**
	 * {@link speakToCache} 済みの語りを絶対時刻 t0（AudioContext クロック秒）へスケジュールする。
	 * まだ合成中のチャンクは届き次第、同じ t0 基準で置く。t0 を過ぎてから届いた分は
	 * 途中から（遅れたぶんを飛ばして）鳴らし、後続との同期を保つ。
	 */
	scheduleSpeech?: (
		key: string,
		t0: number,
		peak: number,
		pan: number,
		reverbSend?: number,
		delaySend?: number,
		destination?: AudioNode,
	) => void;
	/** {@link speakToCache} 済みの語りが占める長さ（秒）。未計画なら undefined。 */
	speechDurationSec?: (key: string) => number | undefined;
	/**
	 * 語りの計画だけを行い、占める長さ（秒）を返す（ピアノロールの帯表示用）。
	 * 長さは基準ピッチに依らないので本文だけで引ける。アセット未取得なら取得から始める。
	 * `options` の感情・話し方で長さは変わる（省略時 neutral）。
	 */
	planSpeech?: (
		text: string,
		options?: SpeechPlanDetailOptions,
	) => Promise<number | null>;
	/** {@link planSpeech} と同じ計画から、長さに加えてモーラ列も返す。 */
	planSpeechDetail?: (
		text: string,
		options?: SpeechPlanDetailOptions,
	) => Promise<SpeechPlanInfo | null>;
	/** 計画済みの語りの長さ（秒）を同期で引く（描画ループ用。未計画なら undefined）。 */
	peekSpeechDurationSec?: (text: string) => number | undefined;
	/**
	 * 語りの基準ピッチ（units）。この行にノートを置くと音源の素の声の高さで話す。
	 * 音源の収録ピッチの中央値（多音階音源では収録セットの中央値）。
	 */
	speechReferenceUnits?: () => number | undefined;
	/**
	 * 本文をこの音源で読み上げる（MML を介さない単発の語り）。{@link speakToCache} と
	 * 同じ合成を、発話ごとに止められるハンドル付きで鳴らす。いつ鳴らし始めるか・遅れて
	 * 届いたチャンクをどう置くかは {@link SpeakVoiceOptions.awaitRender} /
	 * {@link SpeakVoiceOptions.lateChunks} で選ぶ（{@link scheduleSpeech} は常に skip）。
	 * 計画不能（読みが取れない・アセット取得失敗）なら null。koe 音源専用。
	 */
	speak?: (
		text: string,
		pitch: number,
		options?: SpeakVoiceOptions,
	) => Promise<SpeechHandle | null>;
};

/** {@link VoiceModel.speak} のオプション（ピッチは引数で受けるので含まない）。 */
export type SpeakVoiceOptions = {
	/** 声色（ジェンダー/息/張り）。 */
	expr?: VoiceExpression;
	/**
	 * 話し方プリセット（"neutral" / "calm" / "lively"、またはプリセット＋上書き）。
	 * 話速・抑揚幅・基準ピッチ・ポーズ倍率・音量曲線に効く。既定 neutral。
	 */
	style?: SpeakingStyleInput;
	/**
	 * 感情（HTS 音声モデル neutral / happy / sad / angry の差し替え）。既定 neutral。
	 * 初めて使う感情は約 2MB を取得してから鳴る（{@link SingingVoices.prepareSpeech} の
	 * `emotions` で先取りできる）。
	 */
	emotion?: SpeechEmotion;
	/** 音量（ピーク、0〜1。既定 1）。 */
	volume?: number;
	/** 定位（-1〜1。既定 0）。 */
	pan?: number;
	/**
	 * 最初のモーラを鳴らす AudioContext クロック秒。省略時は「今」（`awaitRender` で
	 * 待つものが揃いしだい）。過去を渡しても今に丸める（`lateChunks: "skip"` では、最初の子音の
	 * 先行発声が今より前にはみ出さない時刻まで丸める）。`lateChunks: "shift"` では、
	 * 先頭余白（最初の子音の先行発声）が今より前にはみ出すときも頭を切らずに後ろへずらすので、
	 * これより遅れることがある（実際の時刻は {@link SpeechHandle.startTime}）。
	 */
	at?: number;
	/**
	 * 鳴らし始める前に合成をどこまで待つか。
	 *
	 * - `false`（既定）… 計画が出来たらすぐ時刻を決め、チャンクは届いた順に置く。
	 *   **最初のチャンクの合成が間に合わないと、そのぶん頭が欠ける**（`lateChunks` 既定
	 *   `"skip"`）。実測では速い音源でも 0〜450ms、遅い音源では 3.3 秒の行の 2.3 秒が欠けた。
	 *   既定を変えると呼び出し側の待ちが変わるので従来どおりにしてあるが、セリフには使わないこと。
	 * - `"first-chunk"` … 最初のチャンクが出来てから時刻を決める。長文でも待ちは
	 *   最初の数モーラぶんだけで、頭から鳴る。後続が間に合わなければ時間軸ごと後ろへ
	 *   ずらす（`lateChunks` 既定 `"shift"`）。セリフの読み上げはこれを勧める。
	 *   待ちを増やして途中の間を減らすなら {@link SpeakVoiceOptions.minBufferSec}。
	 * - `true` … 全チャンクの合成完了を待つ。長文をぴったり揃えて出したいとき用。
	 */
	awaitRender?: boolean | "first-chunk";
	/**
	 * `awaitRender: "first-chunk"` のとき、鳴らし始める前に合成しておく語りの長さ（秒。
	 * 最初のモーラから数える）。既定 0（最初のチャンクだけ）。語りがこれより短ければ全部を待つ。
	 *
	 * 最初のチャンクは数モーラしかないので、合成が遅い音源（URL 配信でユニットの取得が
	 * 1 つずつ往復する初回など）では 2 つ目が最初の音の終わりに間に合わず、`"shift"` で
	 * 行の途中に間が空く。0.3〜0.5 秒ほど貯めてから鳴らすと、鳴り出しが少し遅れる代わりに
	 * 間が減る。`awaitRender` が `true` / `false` のときは使わない。
	 */
	minBufferSec?: number;
	/**
	 * 置き場所を過ぎてから届いたチャンク（合成が再生に追いつかなかった分）の扱い。
	 *
	 * - `"shift"` … 飛ばさず、そのチャンクと後続すべてを後ろへずらして頭から鳴らす
	 *   （間が空き、後ろのモーラは遅れて鳴る。遅れの合計は {@link SpeechHandle.shiftSec}）。
	 * - `"skip"` … 時刻は動かさず、遅れたぶんを飛ばして途中から鳴らす（言葉が欠ける）。
	 *
	 * 既定は `awaitRender: "first-chunk"` なら `"shift"`、それ以外は `"skip"`（従来どおり）。
	 */
	lateChunks?: SpeechLateChunks;
	/** 出力先ノード（既定は音源共有の出力＝ singingVoices のマスタ）。 */
	destination?: AudioNode;
	/** 中断用。abort されると計画中なら null を返し、再生中なら止める。 */
	signal?: AbortSignal;
};

/** 計画だけの結果（{@link VoiceModel.planSpeechDetail} / {@link SingingVoices.planSpeechDetail}）。 */
export type SpeechPlanInfo = {
	/** 語りが音を占める長さ（秒）。 */
	durationSec: number;
	/** モーラ列。時刻は最初のモーラが鳴る時点を 0 とする秒。 */
	morae: SpeechMora[];
};

/** 計画だけを行うときのオプション（感情・話し方。ピッチは長さに効かないので無い）。 */
export type SpeechPlanDetailOptions = {
	style?: SpeakingStyleInput;
	emotion?: SpeechEmotion;
};

/** 単発の語り 1 回ぶんのハンドル。 */
export type SpeechHandle = {
	/** 語りが音を占める長さ（秒）。 */
	durationSec: number;
	/**
	 * 最初のモーラが鳴る AudioContext クロック秒。
	 * `awaitRender: false` かつ `lateChunks: "shift"` で最初のチャンクがまだ無いうちは
	 * 見込みで、最初のチャンクが届いて置かれた時点で確定する（読むたびに今の値を返す）。
	 * それ以外では返った時点で確定している。
	 */
	startTime: number;
	/**
	 * `lateChunks: "shift"` で、最初のチャンクを置いたあとに後続を後ろへずらした合計（秒。
	 * 読むたびに今の値を返す）。0 なら計画どおり。`"skip"` では常に 0。
	 * まだ鳴っていないモーラは `startTime + shiftSec + mora.startSec` 以降に鳴る。
	 */
	readonly shiftSec: number;
	/**
	 * モーラ列（口パク・字幕送り用）。時刻は `startTime` 基準の秒で、計画どおりの値
	 * （`"shift"` のずれは含まない。ずれた後のモーラは {@link shiftSec} だけ遅れて鳴る）。
	 */
	morae: SpeechMora[];
	/**
	 * 今の再生位置（`morae` と同じ軸の秒。最初のモーラが 0、鳴る前は負）。
	 * 実際に置いた音から測るので、合成待ちで空いた間は進まず、単調に増える。
	 * 字幕送り・口パクは `morae.filter((m) => m.startSec <= handle.position())` のように
	 * これと比べれば、`"shift"` のずれがあっても音と揃う。
	 */
	position: () => number;
	/** この発話だけを即停止する（他の語り・歌には触らない）。 */
	stop: () => void;
	/** 鳴り終わった（または止められた）ときに解決する。 */
	ended: Promise<void>;
};

/**
 * デクレッシェンド（`↓`）で落とし切る先の音量比。完全な0にはしない——
 * `exponentialRampToValueAtTime` は0を受け付けないうえ、最後まで芯を残したほうが
 * 「消えていった」と聞こえる（本当に0まで落とすと途中で消音したように感じる）。
 */
const FADE_OUT_FLOOR = 0.02;

/**
 * 声量エンベロープの本体（立ち上がり〜サステイン）を書き込む。
 *
 * koe音源と klatt は合成方法がまるで違うが、**強弱の付き方は同じであるべき**なので
 * ここに1本化してある。別々に書くと、片方だけクレッシェンドが効かない・カーブが違う
 * といったズレが必ず出る。最後のリリース（0への落とし込み）は、音源ごとに終端時刻の
 * 決め方が違うので呼び出し側に残す。
 *
 * - `fadeIn` … 小さく入ってサステイン終端で最大（クレッシェンド）
 * - `fadeOut` … 最大で入ってサステイン終端で最小（デクレッシェンド）
 * - 両方 … 小さく入って中央で最大、そこから最小（スウェル／messa di voce）
 * - どちらも無し … 従来どおりサステイン一定
 * - `curve` … 記号を複数書いたときの中継点列（{@link buildFadeCurve}）。
 *   サステイン区間を 0〜1 で見た位置へ写して折れ線で繋ぐ。スウェルとは併用しない。
 *
 * `exponentialRampToValueAtTime` は0を受け付けないので、下限は
 * {@link FADE_OUT_FLOOR} 倍で止める。芯を残したほうが「消えていった」と聞こえる。
 */
const applyDynamicsEnvelope = (
	gain: AudioParam,
	o: {
		startAt: number;
		attackEnd: number;
		sustainEnd: number;
		peak: number;
		fadeIn?: boolean;
		fadeOut?: boolean;
		/** 記号を複数書いたときの中継点列。スウェル（fadeIn かつ fadeOut）では無視する。 */
		curve?: FadeStop[];
	},
): void => {
	const { startAt, attackEnd, sustainEnd, peak, fadeIn, fadeOut, curve } = o;
	const floor = Math.max(0.0001, peak * FADE_OUT_FLOOR);
	gain.setValueAtTime(0.0001, startAt);
	// クレッシェンドは「小さく入る」ので、立ち上がりの到達点が下限になる。
	gain.exponentialRampToValueAtTime(fadeIn ? floor : peak, attackEnd);
	if (curve?.length && !(fadeIn && fadeOut)) {
		// 中継点を順に繋ぐ。時刻はサステイン区間内へ写し、逆行しないよう単調化する
		// （AudioParam は過去へ向かうランプを受け付けない）。
		const span = Math.max(0, sustainEnd - attackEnd);
		let prev = attackEnd;
		let last = fadeIn ? floor : peak;
		for (const stop of curve) {
			const at = Math.min(1, Math.max(0, stop.at));
			const t = Math.min(sustainEnd, Math.max(prev, attackEnd + span * at));
			last = Math.max(floor, peak * Math.min(1, Math.max(0, stop.level)));
			gain.exponentialRampToValueAtTime(last, t);
			prev = t;
		}
		// 最後の中継点が終端より手前で終わっていたら、その声量のまま終端まで保つ。
		if (prev < sustainEnd) gain.setValueAtTime(last, sustainEnd);
	} else if (fadeIn && fadeOut) {
		const mid = attackEnd + (sustainEnd - attackEnd) / 2;
		gain.exponentialRampToValueAtTime(peak, mid);
		gain.exponentialRampToValueAtTime(floor, sustainEnd);
	} else if (fadeIn) {
		gain.exponentialRampToValueAtTime(peak, sustainEnd);
	} else if (fadeOut) {
		gain.exponentialRampToValueAtTime(floor, sustainEnd);
	} else {
		gain.setValueAtTime(peak, sustainEnd);
	}
};

/** 母音ごとのフォルマント周波数 [F1, F2]（Hz） */
const FORMANTS: Record<string, [number, number]> = {
	a: [800, 1200],
	i: [300, 2300],
	u: [350, 800],
	e: [500, 1900],
	o: [500, 900],
	// 撥音(ん)は鼻音寄りの低フォルマント
	N: [250, 1000],
};

/**
 * ピッチ(units) → 周波数(Hz)。単位は 1/372オクターブの整数（A4 = 2139 units = 440Hz）。
 * koe/worldline は Hz を受けるので、31平均律の音もそのまま連続ピッチとして鳴る。
 */
const unitsToFreq = (units: number): number =>
	440 * 2 ** ((units - 2139) / 372);
/** units → MIDIノート番号（小数）。多音階音源の最寄りピッチ選択に使う。 */
const unitsToMidiFloat = (units: number): number => units / 31;

/**
 * klatt風フォルマント合成モデルを生成する。
 *
 * のこぎり波の声門音源を2つのバンドパス(F1,F2)で共鳴させ母音を作る。
 * 子音が摩擦音・破裂音なら短いノイズバーストを頭に付加する。
 *
 * 戻り値の VoiceModel は (音節, PlayNoteEvent) を受け取り、
 * `ctx.currentTime + e.when` のタイミングで destination へ発音する。
 */
export const createKlattVoice = (
	ctx: AudioContext,
	destination: AudioNode,
	reverbBus?: AudioNode,
	delayBus?: AudioNode,
): VoiceModel => {
	// スケジュール済みの音源ノード。stopAll（停止/一時停止）で一括停止する。
	const active = new Set<AudioScheduledSourceNode>();

	const voice: VoiceModel = (syllable, e) => {
		const t0 = ctx.currentTime + e.when;
		// 声量は等倍=1。100超(>1)はブーストとして上限なしで通す（クリップは利用側の判断）。
		const peak = Math.max(0.0001, e.volume);

		// 促音(っ)・休符(_)は無声。発音せず間（ま）として消費する
		if (syllable.vowel === "" || syllable.consonant === "Q") return;

		const [f1, f2] = FORMANTS[syllable.vowel] ?? FORMANTS.a;
		// 継続（結合できずに分割された ー / 〜）は言い直さない。立ち上がりを長めに取り、
		// 直前ノートの減衰へ被せることでアタック感を消す。
		const attack = syllable.kind === "tie" ? 0.06 : 0.02;
		const release = 0.06;
		const sustainEnd = t0 + Math.max(attack + 0.02, e.duration);

		// トラック単位チャンネルストリップの入口が指定されていればそちらへ、無ければ共有destinationへ。
		const dest = e.destination ?? destination;

		// ステレオ定位。母音(env)と子音ノイズの両方をまとめて左右へ振る。
		// StereoPanner非対応の古い環境では dest へ直結（中央）にフォールバック。
		let panner: StereoPannerNode | null = null;
		let out: AudioNode = dest;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, e.pan ?? 0));
			panner.connect(dest);
			out = panner;
		}

		// マスタリバーブ/ディレイへのセンド（koe音源側 schedule() と同じ考え方）。
		let reverbSendGain: GainNode | null = null;
		if (reverbBus && e.reverbSend && e.reverbSend > 0 && panner) {
			reverbSendGain = ctx.createGain();
			reverbSendGain.gain.value = Math.max(0, Math.min(1, e.reverbSend));
			panner.connect(reverbSendGain).connect(reverbBus);
		}
		let delaySendGain: GainNode | null = null;
		if (delayBus && e.delaySend && e.delaySend > 0 && panner) {
			delaySendGain = ctx.createGain();
			delaySendGain.gain.value = Math.max(0, Math.min(1, e.delaySend));
			panner.connect(delaySendGain).connect(delayBus);
		}

		// 声門音源（倍音豊富なのこぎり波）
		const osc = ctx.createOscillator();
		osc.type = "sawtooth";
		let oscHz = unitsToFreq(e.pitchUnits);
		osc.frequency.setValueAtTime(oscHz, t0);
		// 継続記号（ー / 〜）で結合されたノートは、言い直さずにピッチだけを動かす。
		// klatt は生きたオシレータなので、境界へ周波数オートメーションを置くだけでよい。
		// AudioParam.value はスケジュール済みの自動化を反映しないため、直前ピッチは
		// ここで自前に持ち回る（value を読むと毎回先頭ピッチへ戻ってしまう）。
		// グライド長は koe 側と同じ規則で決める（音源ごとに滑り方が変わらないように）。
		const segs = e.pitchSegments ?? [];
		const glides = glideMsForSegments(segs, e.duration * 1000);
		segs.forEach((seg, i) => {
			const hz = Math.max(1, unitsToFreq(seg.pitch));
			const glideS = glides[i] / 1000;
			const from = Math.max(t0, t0 + Math.max(0, seg.atSec) - glideS / 2);
			osc.frequency.setValueAtTime(oscHz, from);
			osc.frequency.exponentialRampToValueAtTime(hz, from + glideS);
			oscHz = hz;
		});

		const makeFormant = (
			freq: number,
			q: number,
			gainScale: number,
		): GainNode => {
			const filter = ctx.createBiquadFilter();
			filter.type = "bandpass";
			filter.frequency.value = freq;
			filter.Q.value = q;
			const g = ctx.createGain();
			g.gain.value = gainScale;
			osc.connect(filter).connect(g);
			return g;
		};

		const env = ctx.createGain();
		applyDynamicsEnvelope(env.gain, {
			startAt: t0,
			attackEnd: t0 + attack,
			sustainEnd,
			peak,
			fadeIn: syllable.fadeIn,
			fadeOut: syllable.fadeOut,
			curve: e.fadeCurve,
		});
		env.gain.exponentialRampToValueAtTime(0.0001, sustainEnd + release);

		// 狭帯域バンドパス2段はのこぎり波のエネルギーを大きく削るため、
		// 他の音源と釣り合うようメイクアップゲインで底上げする（帯域もやや広げる）。
		const MAKEUP = 4.0;
		makeFormant(f1, 6, MAKEUP).connect(env);
		makeFormant(f2, 9, MAKEUP * 0.7).connect(env);
		env.connect(out);

		// 子音の頭にノイズ（摩擦音/破裂音の質感）
		const fricatives = new Set(["s", "sh", "ch", "ts", "h", "f"]);
		if (fricatives.has(syllable.consonant)) {
			const dur = 0.05;
			const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
			const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			const hp = ctx.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = syllable.consonant === "sh" ? 3000 : 4500;
			const ng = ctx.createGain();
			ng.gain.setValueAtTime(peak * 0.5, t0);
			ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
			src.connect(hp).connect(ng).connect(out);
			src.start(t0);
			src.stop(t0 + dur);
			active.add(src);
			src.onended = () => {
				active.delete(src);
				src.disconnect();
				hp.disconnect();
				ng.disconnect();
			};
		}

		osc.start(t0);
		osc.stop(sustainEnd + release + 0.02);
		active.add(osc);
		osc.onended = () => {
			active.delete(osc);
			osc.disconnect();
			panner?.disconnect();
			reverbSendGain?.disconnect();
			delaySendGain?.disconnect();
		};
	};

	voice.stopAll = () => {
		for (const n of active) {
			try {
				n.stop();
			} catch {}
			n.disconnect();
		}
		active.clear();
	};

	return voice;
};

// ─────────────────────────────────────────────────────────────
// koe音源（@onjmin/koe）による歌唱合成
// ─────────────────────────────────────────────────────────────

/** koe音源（.koe）が置かれているパブリックバケットのベースURL */
export const KOE_BASE_URL =
	"https://pub-12482a6b5cbc4c9e906b2e1904cabae5.r2.dev";

/**
 * 内蔵koe音源カタログ: MML中の簡略キーワード → バケット直下の .koe ファイル名。
 * 例: `@@0 roze かな…` で「束音ロゼ」を使う。
 * ファイル名はそのまま encodeURIComponent して URL を組み立てる（{@link koeUrl}）。
 */
export const KOE_VOICEBANKS: Record<string, string> = {
	tsukuyomi: "つくよみちゃん.koe",
	rino: "春音リノver0.3.koe",
	rino121: "春音リノver.1.1(226).koe",
	roze: "束音ロゼver0.５1(多音階).koe",
	ruko_male: "欲音ルコ♂連続音Ver.1.03.koe",
	ruko_female: "欲音ルコ♀歌連続音普1.00.koe",
	teto: "TETO-tandoku-100619.koe",
	shiyo: "革命シヨ.koe",
	rei: "足立レイver3.5.0.koe",
	mgroid: "MGRoid_原音設定済み.koe",
	motroid: "MOTRoid完全版V2.koe",
	nynroid: "NYNRoidver1.4.koe",
	uc: "蓄音キリコ （beta1.1）.koe",
	hibika_aru: "響化アル.koe",
};

/**
 * 内蔵koe音源の表示名（キーワード → 音源名）。音源選択 UI のラベル用。
 * {@link KOE_VOICEBANKS} のファイル名から版数を落としたもの。
 */
export const KOE_VOICEBANK_NAMES: Record<string, string> = {
	tsukuyomi: "つくよみちゃん",
	rino: "春音リノ",
	rino121: "春音リノ (1.1)",
	roze: "束音ロゼ",
	ruko_male: "欲音ルコ♂",
	ruko_female: "欲音ルコ♀",
	teto: "重音テト",
	shiyo: "革命シヨ",
	rei: "足立レイ",
	mgroid: "MGRoid",
	motroid: "MOTRoid",
	nynroid: "NYNRoid",
	uc: "蓄音キリコ",
	hibika_aru: "響化アル",
};

/**
 * koe音源キーワード → UI表示名（日本語）。歌詞モデルのプルダウン等で使う。
 * MML中の値はキーワード（{@link KOE_VOICEBANKS} のキー）のまま、表示だけ和名にする。
 */
export const KOE_VOICEBANK_LABELS: Record<string, string> = {
	tsukuyomi: "つくよみちゃん",
	rino: "春音リノ",
	rino121: "春音リノv1.2.1",
	roze: "束音ロゼ",
	ruko_male: "欲音ルコ♂",
	ruko_female: "欲音ルコ♀",
	teto: "重音テト",
	shiyo: "革命シヨ",
	rei: "足立レイ",
	mgroid: "MGRoid",
	motroid: "MOTRoid",
	nynroid: "NYNRoid",
	uc: "蓄音キリコ",
	hibika_aru: "響化アル",
};

/**
 * 音源プルダウンの大分類（optgroup）。歌唱モデルの選択 UI（mountDAW）と、
 * 読み上げ（{@link DtmStudio.speak}）を使う側の音源選択 UI で共通に使う。
 *
 * 分類に載せ忘れたキーが選べなくなると音源が増やせないので、実際の並びは
 * {@link groupVoiceModels} が作り、ここに無いキーは「その他」へ落とす。
 */
export const VOICE_MODEL_CATEGORIES: ReadonlyArray<{
	label: string;
	models: readonly string[];
}> = [
	{ label: "kusaプリセット", models: ["klatt", "tsukuyomi"] },
	{
		label: "おんJ",
		models: ["roze", "shiyo", "rino", "rino121", "uc", "hibika_aru"],
	},
	{ label: "一般", models: ["teto", "rei", "ruko_male", "ruko_female"] },
	{ label: "クッキー☆", models: ["mgroid", "motroid", "nynroid"] },
];

/** {@link groupVoiceModels} が返す 1 グループ（`<optgroup>` 1 つぶん）。 */
export type VoiceModelGroup = {
	label: string;
	models: { value: string; label: string }[];
};

/**
 * 音源一覧（キーワード → 表示名）を {@link VOICE_MODEL_CATEGORIES} の大分類へ分ける。
 * 渡された `names` に載っているキーだけを返すので、歌唱用（klatt 込み＝
 * {@link KOE_VOICEBANK_LABELS} + klatt）でも読み上げ用（klatt は語れないので
 * {@link KOE_VOICEBANK_NAMES} だけ）でも同じ関数で組める。
 * 分類に無いキーは末尾の「その他」にまとめる（音源を足した日に選べなくならないように）。
 */
export const groupVoiceModels = (
	names: Record<string, string>,
): VoiceModelGroup[] => {
	const rest = new Set(Object.keys(names));
	const groups: VoiceModelGroup[] = [];
	for (const cat of VOICE_MODEL_CATEGORIES) {
		const models = cat.models
			.filter((m) => rest.delete(m))
			.map((m) => ({ value: m, label: names[m] ?? m }));
		if (models.length > 0) groups.push({ label: cat.label, models });
	}
	if (rest.size > 0) {
		groups.push({
			label: "その他",
			models: [...rest].map((m) => ({ value: m, label: names[m] ?? m })),
		});
	}
	return groups;
};

/**
 * モデルキーワード → 内蔵キャラクター画像キー（voice-images.ts の VOICE_IMAGES キー）。
 * klatt合成は "puyuyu"、koe音源は音源名に対応する画像キーを返す。
 */
export const VOICE_IMAGE_KEY: Record<string, string> = {
	klatt: "puyuyu",
	tsukuyomi: "tsukuyomi",
	rino: "rino",
	rino121: "rino",
	roze: "roze",
	ruko_male: "ruko",
	ruko_female: "ruko",
	teto: "teto",
	shiyo: "shiyo",
	rei: "rei",
	mgroid: "MGRoid",
	motroid: "MOTRoid",
	nynroid: "NYNRoid",
	uc: "uc",
	hibika_aru: "hibika_aru",
};

/**
 * UTAU音源キーワード → 利用規約URL。
 */
export const KOE_VOICEBANK_TERMS: Record<string, string> = {
	tsukuyomi: "https://tyc.rei-yumesaki.net/material/utau/terms/",
	rino: "https://hatenakun1.github.io/halunelino/",
	rino121: "https://harunerino.vercel.app/",
	roze: "https://tabaneroze.ninja-web.net/terms-of-use.html",
	ruko_male: "https://long-sleeper.net/index.php?id=22",
	ruko_female: "https://long-sleeper.net/index.php?id=22",
	teto: "https://kasaneteto.jp/guidelines/voice.html",
	shiyo: "https://kakumeisiyo.my.canva.site/dagkuyjwycs",
	rei: "https://mechanicalgirl.jp/guidelines/",
	mgroid: "https://x.com/nisusansu/status/1048825378188353536",
	motroid: "https://www.nicovideo.jp/watch/sm40031282",
	nynroid: "https://www.bilibili.com/video/BV1V24y1a7qs",
	uc: "https://chi9nekiriko.wixsite.com/home/%E5%88%A9%E7%94%A8%E8%A6%8F%E7%B4%84",
	// hibika_aru: "",
};

/** ファイル名（日本語可）を encodeURIComponent して .koe のフルURLにする */
export const koeUrl = (name: string, base: string = KOE_BASE_URL): string =>
	`${base}/${encodeURIComponent(name)}`;

/** worldline.js（WORLDボコーダWASMローダ）の既定ホスト */
const DEFAULT_WORLDLINE_SCRIPT =
	"https://onjmin.github.io/koe/demo/world/worldline.js";

const KOE_SAMPLE_RATE = 48000;

/**
 * 候補エイリアス文字列のスペース表記を揺らす（半角/全角/無し）。
 * 連続音は音源ごとに "a か" / "a　か" / "aか" など区切りが異なるため。
 */
const expandSeparators = (candidate: string): string[] =>
	candidate.includes(" ")
		? [candidate, candidate.replace(/ /g, "　"), candidate.replace(/ /g, "")]
		: [candidate];

/** 多音階エイリアスの末尾ピッチ接尾辞（例: "a か_G4" の "_G4"）。 */
const PITCH_SUFFIX = /_([A-G][#b]?-?\d+)$/;

/** 音名 → 半音オフセット（C=0）。ピッチトークンのMIDI換算に使う。 */
const NAME_SEMITONE: Record<string, number> = {
	c: 0,
	d: 2,
	e: 4,
	f: 5,
	g: 7,
	a: 9,
	b: 11,
};

/** ピッチトークン（"G4" / "D#4" / "C-1" など）→ MIDIノート番号。不正なら null。 */
const pitchTokenToMidi = (token: string): number | null => {
	const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(token);
	if (!m) return null;
	let semi = NAME_SEMITONE[m[1].toLowerCase()];
	if (m[2] === "#") semi++;
	else if (m[2] === "b") semi--;
	// UTAU/MIDI慣習: C4 = MIDI 60（オクターブ+1して12倍）
	return (Number.parseInt(m[3], 10) + 1) * 12 + semi;
};

/** 多音階バンクのピッチトークン1件（トークン文字列とそのMIDI番号）。 */
export type PitchToken = { token: string; midi: number };

/**
 * 音源マニフェストのエイリアス一覧から、多音階のピッチトークン（"_G4" 等）を収集する。
 * 接尾辞を持つエイリアスが1つも無ければ空配列（＝単独音/連続音バンク）。
 * 多音階バンクでは全エイリアスが `_ピッチ` 付きで bare エイリアスが存在しないことがあり、
 * その場合は目標ノートに最も近いトークンを base に付与しないと解決できない。
 */
export const collectPitchTokens = (aliases: Iterable<string>): PitchToken[] => {
	const seen = new Map<string, number>();
	for (const a of aliases) {
		const m = PITCH_SUFFIX.exec(a);
		if (!m || seen.has(m[1])) continue;
		const midi = pitchTokenToMidi(m[1]);
		if (midi != null) seen.set(m[1], midi);
	}
	return [...seen].map(([token, midi]) => ({ token, midi }));
};

/** 目標ノート（MIDI番号）に最も近いピッチトークン。トークンが無ければ null。 */
const nearestPitchToken = (
	pitchTokens: PitchToken[],
	noteNum: number,
): PitchToken | null => {
	let best: PitchToken | null = null;
	for (const t of pitchTokens) {
		if (!best || Math.abs(t.midi - noteNum) < Math.abs(best.midi - noteNum))
			best = t;
	}
	return best;
};

/**
 * 語り（UtauTTS）の計画に渡す「音源の見え方」。
 *
 * UtauTTS のユニット選択は prefix.map 前提で、音名接尾辞つきのエイリアス
 * （`- あ_G4`）を素の名前では引けない。多音階音源では**収録セットを1つ選び**、
 * その接尾辞を剥がした音素表を計画に見せ、出来た計画のエイリアスを {@link toReal} で
 * 実在の名前へ戻す。接尾辞の無いエイリアスはそのまま残す（接尾辞つきと重複したら
 * 接尾辞つき＝選んだセットを優先）。単独音・連続音バンク（`token` null）は素通し。
 */
export type SpeechToneView = {
	view: SpeechBank;
	/** 計画上のエイリアス → 音源に実在するエイリアス。 */
	toReal: (alias: string) => string;
	/** この見え方での収録ピッチの中央値（Hz）。基準ピッチのガイドに使う。 */
	referenceHz: number | undefined;
};

export const createSpeechToneView = (
	phonemes: Record<string, PhonemeEntry>,
	token: string | null,
): SpeechToneView => {
	if (!token) {
		return {
			view: { manifest: { phonemes } },
			toReal: (a) => a,
			referenceHz: medianRecordedPitchHz(phonemes),
		};
	}
	const suffix = `_${token}`;
	const stripped: Record<string, PhonemeEntry> = {};
	const real = new Map<string, string>();
	for (const [alias, entry] of Object.entries(phonemes)) {
		if (alias.endsWith(suffix)) {
			const bare = alias.slice(0, -suffix.length);
			stripped[bare] = entry;
			real.set(bare, alias);
		} else if (!PITCH_SUFFIX.test(alias) && !(alias in stripped)) {
			stripped[alias] = entry;
		}
	}
	return {
		view: { manifest: { phonemes: stripped } },
		toReal: (a) => real.get(a) ?? a,
		referenceHz: medianRecordedPitchHz(stripped),
	};
};

/**
 * 音節と直前母音から、音源へ問い合わせるエイリアス候補を優先順で作る（純粋関数）。
 *
 * 命名の幅（単独音 "か" / 連続音 "a か" "- か" / ローマ字 "ka"）に加えて、
 * 音源に「本来あるのに引けていなかった」素片を拾う:
 *  - 鼻濁音（{@link LyricSyllable.nasal}）: カタカナ別名（"ガ" / "a ガ"）を最優先。
 *  - ヴ系: 音源の綴りは "ヴぁ"（ヴ+小書きひらがな）か "ヴァ"（全角カタカナ）。
 *    どちらも無ければバ行で近似する。
 *  - ぢ・づ: 同じ音の じ・ず（{@link SAME_SOUND_KANA}）。母音だけに落とす前に試す。
 *  - 語中の柔らかい立ち上がり "* あ"（重音テト単独音）: 語頭でないときに素の "あ" より優先。
 * 最後は母音単体、撥音は "ん" "n" "N" へ落とす。
 */
export const koeAliasCandidates = (
	syl: LyricSyllable,
	prevVowel: string,
): string[] => {
	const kana = syl.kana;
	const cons = syl.consonant === "N" ? "n" : syl.consonant;
	const vow = syl.vowel === "N" ? "" : syl.vowel;
	const romaji = `${cons}${vow}` || vow;
	const pv = prevVowel || "-"; // 直前母音が無ければ語頭扱い
	const raw: string[] = [];
	const push = (...cs: string[]): void => {
		for (const c of cs) if (c && !raw.includes(c)) raw.push(c);
	};

	// 鼻濁音: カタカナ別名を最優先（無ければ通常のガ行へ落ちる）
	if (syl.nasal) {
		const kata = toKatakana(kana);
		push(`${pv} ${kata}`, kata);
	}
	// ヴ系: 綴りの流儀が2つある
	if (cons === "v") {
		const small = kana.slice(1);
		const forms = small ? [`ヴ${small}`, toKatakana(`ゔ${small}`)] : ["ヴ"];
		for (const f of forms) push(`${pv} ${f}`, f);
	}
	const alt = SAME_SOUND_KANA[kana];

	// 継続（ー / 〜）は「言い直さない」音なので、子音つきの候補を一切引かない。
	// 同母音の連続音（"a あ"）→ 柔らかい "* あ" → 母音単体（"あ" / "a"）の順で、
	// 当たりの柔らかい素片を選ぶ。
	if (syl.kind === "tie") {
		push(
			`${syl.vowel === "N" ? "n" : syl.vowel} ${kana}`,
			`${pv} ${kana}`,
			`* ${kana}`,
			kana,
		);
	} else {
		// 連続音（VCV）: 直前母音つき
		push(`${pv} ${kana}`);
		if (alt) push(`${pv} ${alt}`);
		push(`${pv} ${romaji}`);
		// 語中の柔らかい立ち上がり（語頭には使わない）
		if (pv !== "-") push(`* ${kana}`);
		// 単独音 / CVVC
		push(kana);
		if (alt) push(alt);
		push(romaji);
	}
	// ヴが無い音源はバ行で近似
	if (cons === "v" && vow) {
		const b = V_TO_B_KANA[vow];
		push(`${pv} ${b}`, b, `b${vow}`);
	}
	// 母音フォールバック
	const vk = VOWEL_KANA[syl.vowel];
	if (vk) push(`${pv} ${vk}`, vk, syl.vowel);
	// 撥音(ん)
	if (syl.vowel === "N") push("ん", "n", "N", `${pv} ん`);
	return raw;
};

/**
 * 候補列を音源に突き合わせて、最初に実在するエイリアスを返す。
 * 多音階バンクは目標ノートに近いピッチ順で接尾辞を付けて試し（pitch優先・base副次）、
 * その後で素のキーを試す。区切りの異体（全角空白・無し）も {@link expandSeparators} で吸収する。
 */
const matchAliases = (
	hasAlias: (alias: string) => boolean,
	pitchTokens: PitchToken[],
	raw: readonly string[],
	noteNum: number,
): string | null => {
	const seen = new Set<string>();
	const tryAlias = (candidate: string): string | null => {
		for (const v of expandSeparators(candidate)) {
			if (seen.has(v)) continue;
			seen.add(v);
			if (hasAlias(v)) return v;
		}
		return null;
	};
	if (pitchTokens.length) {
		const nearest = pitchTokens
			.slice()
			.sort((a, b) => Math.abs(a.midi - noteNum) - Math.abs(b.midi - noteNum));
		for (const { token } of nearest) {
			for (const base of raw) {
				const hit = tryAlias(`${base}_${token}`);
				if (hit) return hit;
			}
		}
	}
	for (const base of raw) {
		const hit = tryAlias(base);
		if (hit) return hit;
	}
	return null;
};

const resolveKoeAlias = (
	hasAlias: (alias: string) => boolean,
	pitchTokens: PitchToken[],
	syl: LyricSyllable,
	prevVowel: string,
	noteNum: number,
): string | null => {
	const hit = matchAliases(
		hasAlias,
		pitchTokens,
		koeAliasCandidates(syl, prevVowel),
		noteNum,
	);
	if (hit) return hit;

	// 子音単体＋母音単体エイリアスの合成フォールバック（例: 音源に "ka" が無くても
	// "k" と "a" の単体データがあれば繋ぎ合わせて代用する）。多音階バンク（ピッチ接尾辞
	// 付き）は組み合わせ爆発を避けるため非対応、bareエイリアスのみで試す。
	const cons = syl.consonant === "N" ? "n" : syl.consonant;
	const vow = syl.vowel === "N" ? "" : syl.vowel;
	const pv = prevVowel || "-";
	if (cons && vow) {
		const vowelAlias = matchAliases(
			hasAlias,
			[],
			[vow, `${pv} ${vow}`],
			noteNum,
		);
		const consAlias = vowelAlias
			? matchAliases(hasAlias, [], [cons], noteNum)
			: null;
		if (vowelAlias && consAlias)
			return packCompositeAlias(consAlias, vowelAlias);
	}
	return null;
};

/** 子音単体＋母音単体エイリアスを繋ぎ合わせる際のクロスフェード長（秒）。繋ぎ目のクリックを抑える。 */
const COMPOSITE_SPLICE_XFADE_SEC = 0.005;

/**
 * 子音単体PCM＋母音単体PCMを1本のPCMへ繋ぎ合わせ、WORLD再合成へそのまま渡せる
 * pre/consonant（ms）を計算する。境界を短くリニアクロスフェードして接続音のクリックを防ぐ。
 * どちらかが空、またはクロスフェード幅を確保できないほど短ければ null。
 */
const spliceCompositePcm = (
	consonantPcm: Float64Array,
	vowelPcm: Float64Array,
	sampleRate: number,
): { pcm: Float64Array; preMs: number; consonantMs: number } | null => {
	if (consonantPcm.length === 0 || vowelPcm.length === 0) return null;
	const xfade = Math.min(
		Math.floor(sampleRate * COMPOSITE_SPLICE_XFADE_SEC),
		consonantPcm.length,
		vowelPcm.length,
	);
	const pcm = new Float64Array(consonantPcm.length + vowelPcm.length - xfade);
	pcm.set(consonantPcm, 0);
	for (let i = 0; i < xfade; i++) {
		const t = (i + 1) / (xfade + 1);
		const idx = consonantPcm.length - xfade + i;
		pcm[idx] = consonantPcm[idx] * (1 - t) + vowelPcm[i] * t;
	}
	pcm.set(vowelPcm.subarray(xfade), consonantPcm.length);
	// 母音の立ち上がり（ビート位置）＝子音区間の直後。overlap相当は持たないので
	// pre と consonant を同じ長さにし、子音全体が発音前リードとして再生されるようにする。
	const consonantMs = ((consonantPcm.length - xfade / 2) / sampleRate) * 1000;
	return { pcm, preMs: consonantMs, consonantMs };
};

/** koe音源の生成オプション */
export type KoeVoiceOptions = {
	/** .koe アーカイブのURL、または Blob/File */
	koe: string | Blob;
	/**
	 * worldline.js のURL（WORLDボコーダによる高品質再合成）。
	 * 省略時は GitHub Pages のホストを使う。`worldline.wasm` は同じ階層から解決される。
	 */
	worldlineScriptUrl?: string;
	/**
	 * Worldline（WASM）を使わず、素片を AudioBufferSource の playbackRate で
	 * ピッチシフトして鳴らす軽量モード。WASMの読み込みを避けたいときに。
	 */
	lightweight?: boolean;
	/**
	 * 歌声合成Worker（`voice-worker.js`）のURL。指定すると重いWORLD再合成を
	 * 別スレッドで実行し、メインスレッド（楽器・UI）を一切ブロックしない。
	 * 省略時は従来どおりメインスレッドで合成する（後方互換）。
	 */
	voiceWorkerUrl?: string;
	/**
	 * マスタリバーブのバス（センド先）。指定時のみ、ノートごとの `reverbSend` に応じて
	 * ドライ経路とは別にこのノードへ送る。未指定ならリバーブ送りは常にスキップされる
	 * （＝トラックごとの `r` トークンを書いてもリバーブが掛からない）。
	 */
	reverbBus?: AudioNode;
	/**
	 * マスタディレイのバス（センド先）。指定時のみ、ノートごとの `delaySend` に応じて
	 * ドライ経路とは別にこのノードへ送る。未指定ならディレイ送りは常にスキップされる。
	 */
	delayBus?: AudioNode;
	/**
	 * 語り（`「…」`）用の TTS アセットのベース URL（{@link file://./speech.ts}）。
	 * 省略時は koe のデモと同じ GitHub Pages のホストを使う。アセットはページにつき
	 * 一度だけ読み込まれ、最初の語りを合成するときに取得が始まる。
	 */
	ttsBaseUrl?: string;
};

type RenderedNote = {
	audio: AudioBuffer;
	/** 母音オンセット（拍頭）までの先行秒。バッファをこの分だけ前から鳴らす */
	preSec: number;
	/** 再生レート（Worldline使用時は1、素片フォールバック時はピッチ比） */
	rate: number;
};

/** backend が返す生PCM（メイン側でAudioBuffer化する）。 */
type BackendRender = { pcm: Float32Array; preSec: number; rate: number } | null;

/**
 * 「エイリアス → 合成PCM」を供給するバックエンド。
 * - local: メインスレッドで VoiceBank + Worldline を持って合成（後方互換）。
 * - worker: 別スレッドの {@link file://./voice-worker.ts} へ委譲（メインを塞がない）。
 */
type RenderBackend = {
	/** 音源マニフェストに該当エイリアスが存在するか（エイリアス解決用）。 */
	hasAlias: (alias: string) => boolean;
	/** 多音階バンクのピッチトークン一覧（単独音/連続音バンクでは空配列）。 */
	pitchTokens: PitchToken[];
	/** エイリアスを目標ピッチ・音価で合成して生PCMを返す（重い処理）。 */
	renderAlias: (
		alias: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		/** 継続記号で結合されたノート内のピッチ推移（2区間目以降）。 */
		pitchSegments?: PitchSegment[],
	) => Promise<BackendRender>;
	/** 音源マニフェストの音素表（語りの計画に使う）。 */
	phonemes: Record<string, PhonemeEntry>;
	/** エイリアスの素片PCM（Float32 @48kHz、oto の範囲で切り出し済み）を加工せず返す。 */
	getPcm: (alias: string) => Promise<Float32Array | null>;
	/**
	 * 語りの計画（エイリアスは実在名へ写し済み）を worldline でチャンクごとに合成する。
	 * チャンクは出来た順に `onChunk` へ渡し、全部終わったら解決する（打ち切り・失敗でも
	 * 例外にはせず解決する。WORLD 不可＝軽量モードでは何も渡さない）。
	 */
	renderSpeech: (
		plan: UtauTTSPlan,
		expr: VoiceExpression | undefined,
		onChunk: (chunk: SpeechChunk) => void,
		signal?: AbortSignal,
		/** 話し方プリセット由来の合成オプション（{@link speechRenderOptions}）。 */
		render?: UtauTTSRenderOptions,
	) => Promise<void>;
	/** 破棄（Worker終了など）。 */
	dispose: () => void;
};

/** バックエンドが返す語りの 1 片（Float32 @48kHz、startMs は計画のタイムライン 0 から）。 */
type SpeechChunk = { pcm: Float32Array; startMs: number; index: number };

/** メインスレッドで合成する従来バックエンド（voiceWorkerUrl 未指定時）。 */
const createLocalBackend = async (
	options: KoeVoiceOptions,
): Promise<RenderBackend> => {
	const bank = await VoiceBank.load(options.koe);
	const worldline = options.lightweight
		? null
		: await Worldline.load({
				scriptUrl: options.worldlineScriptUrl ?? DEFAULT_WORLDLINE_SCRIPT,
			}).catch(() => null); // WASM不可なら素片フォールバックで動かす

	const pcmCache = new Map<string, Promise<Float64Array | null>>();
	const getPcm = (alias: string): Promise<Float64Array | null> => {
		let p = pcmCache.get(alias);
		if (!p) {
			p = bank.getPcm(alias);
			pcmCache.set(alias, p);
		}
		return p;
	};

	/**
	 * 音源に直接存在しない音節を、子音単体＋母音単体エイリアスを繋いだ合成PCMで代用する。
	 * WORLD再合成必須（Worldline不可時の素片フォールバックには非対応 — 繋ぎ目のクリックを
	 * ピッチシフトだけで誤魔化せないため）。
	 */
	const renderComposite = async (
		consonantAlias: string,
		vowelAlias: string,
		pitch: number,
		durationMs: number,
		vibrato: boolean | undefined,
		expr: VoiceExpression | undefined,
		pitchSegments: PitchSegment[] | undefined,
	): Promise<BackendRender> => {
		if (!worldline) return null;
		const [consonantPcm, vowelPcm] = await Promise.all([
			getPcm(consonantAlias),
			getPcm(vowelAlias),
		]);
		if (!consonantPcm || !vowelPcm) return null;
		const spliced = spliceCompositePcm(consonantPcm, vowelPcm, KOE_SAMPLE_RATE);
		if (!spliced) return null;
		const targetHz = unitsToFreq(pitch);
		const audio = worldline.renderNote({
			pcm: spliced.pcm,
			pitch: pitchCurveFor(
				targetHz,
				pitchSegments,
				spliced.preMs,
				!!vibrato,
				durationMs,
			),
			durationMs,
			preMs: spliced.preMs,
			consonantMs: spliced.consonantMs,
			gender: expr?.gender,
			breathiness: expr?.breathiness,
			tension: expr?.tension,
		});
		return audio ? { pcm: audio, preSec: spliced.preMs / 1000, rate: 1 } : null;
	};

	const renderAlias = async (
		alias: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		pitchSegments?: PitchSegment[],
	): Promise<BackendRender> => {
		const composite = unpackCompositeAlias(alias);
		if (composite) {
			return renderComposite(
				composite[0],
				composite[1],
				pitch,
				durationMs,
				vibrato,
				expr,
				pitchSegments,
			);
		}
		const pcm = await getPcm(alias);
		if (!pcm || pcm.length === 0) return null;
		const entry = bank.manifest.phonemes[alias];
		const lead = leadInFromEntry(entry);
		const targetHz = unitsToFreq(pitch);
		if (worldline) {
			const audio = worldline.renderNote({
				pcm,
				pitch: pitchCurveFor(
					targetHz,
					pitchSegments,
					lead.preMs,
					!!vibrato,
					durationMs,
				),
				durationMs,
				...lead,
				gender: expr?.gender,
				breathiness: expr?.breathiness,
				tension: expr?.tension,
			});
			if (audio) return { pcm: audio, preSec: lead.preMs / 1000, rate: 1 };
		}
		const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
		return {
			pcm: new Float32Array(pcm),
			preSec: entry.pre / KOE_SAMPLE_RATE / rate,
			rate,
		};
	};

	// 語り: 計画（メイン側で作成済み）を worldline でチャンク合成する。
	let speechAdapter: UtauTTSAdapter | null = null;
	const renderSpeech: RenderBackend["renderSpeech"] = async (
		plan,
		expr,
		onChunk,
		signal,
		render,
	) => {
		if (!worldline) return; // 軽量モードでは語りは鳴らせない
		speechAdapter ??= new UtauTTSAdapter(worldline);
		try {
			// ユニット PCM の取得（URL 音源は 1 ユニット 1 往復）を合成と重ねる（speech.ts 参照）。
			prefetchSpeechPcm(plan, getPcm);
			const view = speechBankView(bank, getPcm);
			for await (const chunk of speechAdapter.renderChunks(view, plan, {
				...render,
				signal,
				gender: expr?.gender,
				breathiness: expr?.breathiness,
				tension: expr?.tension,
			})) {
				onChunk({ pcm: chunk.pcm, startMs: chunk.startMs, index: chunk.index });
			}
		} catch (err) {
			console.warn("[dtm] speech synthesis failed", err);
		}
	};

	return {
		hasAlias: (a) => bank.has(a),
		pitchTokens: collectPitchTokens(Object.keys(bank.manifest.phonemes)),
		renderAlias,
		phonemes: bank.manifest.phonemes,
		getPcm: (a) => getPcm(a).then((p) => (p ? Float32Array.from(p) : null)),
		renderSpeech,
		dispose: () => {},
	};
};

/** クロスオリジン（CDN配信）でも起動できるよう Worker を生成する。 */
const spawnVoiceWorker = async (url: string): Promise<Worker> => {
	const sameOrigin = new URL(url, location.href).origin === location.origin;
	if (sameOrigin) return new Worker(url);
	// 別オリジンの URL は直接 new Worker できないため、取得して Blob URL から起動する。
	const text = await fetch(url).then((r) => r.text());
	return new Worker(
		URL.createObjectURL(new Blob([text], { type: "text/javascript" })),
	);
};

/** 重い合成を別スレッドへ委譲するバックエンド（voiceWorkerUrl 指定時）。 */
const createWorkerBackend = async (
	workerUrl: string,
	options: KoeVoiceOptions,
): Promise<RenderBackend> => {
	const worker = await spawnVoiceWorker(workerUrl);
	const aliasSet = new Set<string>();
	let phonemes: Record<string, PhonemeEntry> = {};
	const pending = new Map<number, (m: VoiceWorkerRendered) => void>();
	const pcmPending = new Map<number, (m: VoiceWorkerPcm) => void>();
	/** 進行中の語り合成（id → チャンク受け取りと完了）。 */
	const speechPending = new Map<
		number,
		{ onChunk: (c: SpeechChunk) => void; done: () => void }
	>();
	let reqId = 0;
	let onReady: (() => void) | null = null;
	let onFail: ((e: Error) => void) | null = null;

	worker.onmessage = (ev: MessageEvent<VoiceWorkerOutbound>) => {
		const m = ev.data;
		if (m.type === "ready") {
			for (const a of m.aliases) aliasSet.add(a);
			phonemes = m.phonemes ?? {};
			onReady?.();
		} else if (m.type === "error") {
			onFail?.(new Error(m.message));
		} else if (m.type === "rendered") {
			const cb = pending.get(m.id);
			if (cb) {
				pending.delete(m.id);
				cb(m);
			}
		} else if (m.type === "pcm") {
			const cb = pcmPending.get(m.id);
			if (cb) {
				pcmPending.delete(m.id);
				cb(m);
			}
		} else if (m.type === "speech-chunk") {
			speechPending
				.get(m.id)
				?.onChunk({ pcm: m.pcm, startMs: m.startMs, index: m.index });
		} else if (m.type === "speech-end") {
			const s = speechPending.get(m.id);
			if (s) {
				speechPending.delete(m.id);
				if (m.error) console.warn("[dtm] speech synthesis failed", m.error);
				s.done();
			}
		}
	};
	worker.onerror = (e) => {
		const ev = e as ErrorEvent;
		onFail?.(new Error(ev.message || ev.error || `Event: ${ev.type}`));
	};

	await new Promise<void>((resolve, reject) => {
		onReady = resolve;
		onFail = reject;
		worker.postMessage({
			type: "init",
			koe: options.koe,
			worldlineScriptUrl:
				options.worldlineScriptUrl ?? DEFAULT_WORLDLINE_SCRIPT,
			lightweight: !!options.lightweight,
		} satisfies VoiceWorkerInit);
	});
	onReady = null;
	onFail = null;

	const renderAlias = (
		alias: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		pitchSegments?: PitchSegment[],
	): Promise<BackendRender> =>
		new Promise((resolve) => {
			const id = ++reqId;
			pending.set(id, (m) =>
				resolve(
					m.pcm
						? { pcm: m.pcm, preSec: m.preSec ?? 0, rate: m.rate ?? 1 }
						: null,
				),
			);
			worker.postMessage({
				type: "render",
				id,
				alias,
				pitch,
				durationMs,
				vibrato,
				gender: expr?.gender,
				breathiness: expr?.breathiness,
				tension: expr?.tension,
				pitchSegments,
			} satisfies VoiceWorkerRenderReq);
		});

	const renderSpeech: RenderBackend["renderSpeech"] = (
		plan,
		expr,
		onChunk,
		signal,
		render,
	) =>
		new Promise<void>((resolve) => {
			const id = ++reqId;
			speechPending.set(id, { onChunk, done: resolve });
			signal?.addEventListener("abort", () => {
				worker.postMessage({
					type: "speak-abort",
					id,
				} satisfies VoiceWorkerSpeakAbort);
			});
			worker.postMessage({
				type: "speak",
				id,
				plan,
				gender: expr?.gender,
				breathiness: expr?.breathiness,
				tension: expr?.tension,
				energyDbPerSemitone: render?.energyDbPerSemitone,
			} satisfies VoiceWorkerSpeakReq);
		});

	const getPcm = (alias: string): Promise<Float32Array | null> =>
		new Promise((resolve) => {
			const id = ++reqId;
			pcmPending.set(id, (m) => resolve(m.pcm));
			worker.postMessage({
				type: "pcm",
				id,
				alias,
			} satisfies VoiceWorkerPcmReq);
		});

	return {
		hasAlias: (a) => aliasSet.has(a),
		pitchTokens: collectPitchTokens(aliasSet),
		renderAlias,
		get phonemes() {
			return phonemes;
		},
		getPcm,
		renderSpeech,
		dispose: () => worker.terminate(),
	};
};

/**
 * @onjmin/koe の音源（UTAU由来 .koe）で1音節を歌う {@link VoiceModel} を生成する。
 *
 * VoiceBank で音素PCMをオンデマンド取得し、Worldline（WORLDボコーダ）で目標ピッチ・
 * 音価へ再合成して、共有 AudioContext のタイムライン（`ctx.currentTime + e.when`）へ
 * スケジュールする。Worldlineが使えない／素片が短すぎる場合は素片のピッチシフトへ自動フォールバックする。
 *
 * 音源とWASMの読み込みは非同期のため、戻り値は Promise。`await` してから歌わせること。
 */
export const createKoeVoice = async (
	ctx: AudioContext,
	destination: AudioNode,
	options: KoeVoiceOptions,
): Promise<VoiceModel> => {
	// 重い合成のバックエンド。voiceWorkerUrl があれば別スレッド、無ければメインスレッド。
	// ただし、セキュリティ制限（Sandbox化されたiframeやfile://など）により Worker の起動に失敗した場合は
	// 自動的にメインスレッド（createLocalBackend）へフォールバックする。
	let backend: RenderBackend;
	if (options.voiceWorkerUrl) {
		try {
			backend = await createWorkerBackend(options.voiceWorkerUrl, options);
		} catch (err) {
			console.warn(
				"[dtm] Failed to spawn voice worker. Falling back to local backend.",
				err,
			);
			backend = await createLocalBackend(options);
		}
	} else {
		backend = await createLocalBackend(options);
	}

	// 合成済み AudioBuffer のキャッシュ（同じ音素・ピッチ・音価の再演を高速化）。
	const renderCache = new Map<string, RenderedNote | null>();
	// 同一キーの同時要求をまとめる（warm と stream の競合で二重合成しないため）。
	const inflight = new Map<string, Promise<RenderedNote | null>>();

	// この音源がスケジュール済みの BufferSource 群。stopAll で一括停止する。
	const active = new Set<AudioBufferSourceNode>();

	// 直接呼び出し（VoiceModel as function）用の内部直前母音。
	// ストリーミング経路（renderToCache）は使わず、呼び出し側が母音を明示で渡す。
	let prevVowel = "";

	const keyOf = (
		alias: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		pitchSegments?: PitchSegment[],
	): string =>
		`${alias}|${pitch}|${Math.round(durationMs / 10) * 10}${segmentsCacheKey(pitchSegments)}${vibrato ? "|vib" : ""}${
			expr?.gender !== undefined ? `|g${Math.round(expr.gender * 100)}` : ""
		}${
			expr?.breathiness !== undefined
				? `|h${Math.round(expr.breathiness * 100)}`
				: ""
		}${
			expr?.tension !== undefined ? `|t${Math.round(expr.tension * 100)}` : ""
		}`;

	/** backend で合成 → AudioBuffer 化して renderCache へ積む。重複・同時要求はまとめる。 */
	const renderInto = (
		alias: string,
		pitch: number,
		durationMs: number,
		vibrato?: boolean,
		expr?: VoiceExpression,
		pitchSegments?: PitchSegment[],
	): Promise<RenderedNote | null> => {
		const key = keyOf(alias, pitch, durationMs, vibrato, expr, pitchSegments);
		const existing = renderCache.get(key);
		if (existing !== undefined) return Promise.resolve(existing);
		const flying = inflight.get(key);
		if (flying) return flying;

		const p = (async () => {
			const out = await backend.renderAlias(
				alias,
				pitch,
				durationMs,
				vibrato,
				expr,
				pitchSegments,
			);
			let rendered: RenderedNote | null = null;
			if (out) {
				const buf = ctx.createBuffer(1, out.pcm.length, KOE_SAMPLE_RATE);
				buf.copyToChannel(out.pcm, 0);
				rendered = { audio: buf, preSec: out.preSec, rate: out.rate };
			}
			renderCache.set(key, rendered);
			inflight.delete(key);
			return rendered;
		})();
		inflight.set(key, p);
		return p;
	};

	/** プリ発声(preutterance)の最大長（秒）。VCV連続音の長い先行母音を切り詰めて
	 * 「2重声」を防ぐ。koeデモの LEADCAP_MS=90 に準拠。 */
	const LEADCAP_S = 0.09;

	/**
	 * 素片を合成する最短の長さ（ms）。これより短い音価でもこの長さで作る
	 * （短すぎると子音が立ち上がりきらず、合成そのものが破綻するため）。
	 *
	 * **作る長さであって鳴らす長さではない。** 実際の発音は音価で切る
	 * （{@link schedule} の `durationSec`）。ここを鳴らす長さにしてしまうと、
	 * 速い曲の短い音が軒並み自分の枠をはみ出して次の音と重なる。
	 */
	const MIN_RENDER_MS = 60;

	/**
	 * 継続ノート（結合できなかった `ー` / `〜`）を直前ノートへ被せる長さ（秒）。
	 * この分だけ前倒しで鳴らし始め、同じ長さを掛けて立ち上げることで、
	 * 直前ノートの減衰と等パワーに近い形で交差させる（＝言い直しに聞こえない）。
	 */
	const TIE_XFADE_S = 0.03;

	const schedule = (
		r: RenderedNote,
		t0: number,
		peak: number,
		pan: number,
		reverbSend = 0,
		delaySend = 0,
		destOverride?: AudioNode,
		continuation = false,
		fadeOut = false,
		fadeIn = false,
		fadeCurve?: FadeStop[],
		/**
		 * この音が占める長さ（秒。`t0` から数える）。
		 * 素片は {@link RenderedNote} の長さぶん用意されているが、それは
		 * 合成の都合で決まる長さで、音価そのものではない。渡されたらここで切る。
		 */
		durationSec?: number,
	): void => {
		// トラック単位チャンネルストリップの入口が指定されていればそちらへ。
		const dest = destOverride ?? destination;

		// ステレオ定位（非対応環境では dest 直結）
		let out: AudioNode = dest;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(dest);
			out = panner;
		}

		// マスタリバーブ/ディレイへのセンド（ドライ経路とは別に、パン後の信号を割合分だけ流す）。
		// 対応する options.xxxBus が無い、またはこのトラックのセンド量が0ならスキップ。
		let reverbSendGain: GainNode | null = null;
		if (options.reverbBus && reverbSend > 0 && panner) {
			reverbSendGain = ctx.createGain();
			reverbSendGain.gain.value = Math.max(0, Math.min(1, reverbSend));
			panner.connect(reverbSendGain).connect(options.reverbBus);
		}
		let delaySendGain: GainNode | null = null;
		if (options.delayBus && delaySend > 0 && panner) {
			delaySendGain = ctx.createGain();
			delaySendGain.gain.value = Math.max(0, Math.min(1, delaySend));
			panner.connect(delaySendGain).connect(options.delayBus);
		}

		const src = ctx.createBufferSource();
		src.buffer = r.audio;
		src.playbackRate.value = r.rate;

		// VCV連続音の長いプリ発声（〜300ms以上）を cap し、前のノートの母音と
		// 重なり過ぎないようにする。余剰分はバッファ先頭からスキップする。
		// 継続ノートは先行母音そのものが「言い直し」に聞こえるため丸ごと捨て、
		// 代わりに直前ノートの尻へ短く被せて立ち上げる。
		const effPre = continuation ? TIE_XFADE_S : Math.min(r.preSec, LEADCAP_S);
		const skipS = continuation ? r.preSec : r.preSec - effPre;
		const startAt = Math.max(ctx.currentTime + 0.001, t0 - effPre);
		// 先行母音を丸ごと捨てる継続ノートで、素片が先行分しか無い場合に長さが
		// 0以下にならないようにする（stop < start は例外になる）。
		const playDurSec = Math.max(0.01, r.audio.duration / r.rate - skipS);
		// 素片の長さではなく**音価**で切る。合成側は短すぎるノートを
		// {@link MIN_RENDER_MS} まで引き伸ばして作るので、素片の終わりを
		// そのまま終端にすると自分の枠をはみ出し、次の音と本当に重なってしまう
		// （速い曲ほど効く。BPM188の32分音符は40msで、20msぶん食い込む）。
		const endAt =
			durationSec === undefined
				? startAt + playDurSec
				: Math.min(startAt + playDurSec, t0 + Math.max(0.02, durationSec));

		// クリック防止のフェードと声量エンベロープ。継続ノートは立ち上がりを
		// 被せ幅いっぱいまで伸ばし、アタック感（発音のたちあがり）を消す。
		const attack = continuation ? TIE_XFADE_S : 0.01;
		// 離鍵のフェードは、短い音では音価そのものを食い潰さない長さまで縮める
		// （40msの音に40msのフェードを掛けると、全部が減衰になってしまう）。
		const release = Math.min(0.04, Math.max(0.005, (endAt - t0) / 2));
		const env = ctx.createGain();
		const fadeStart = Math.max(startAt + attack, endAt - release);
		// 素片は最後まで鳴らしたまま声量だけを動かすので、途中で音が切れない。
		applyDynamicsEnvelope(env.gain, {
			startAt,
			attackEnd: startAt + attack,
			sustainEnd: fadeStart,
			peak,
			fadeIn,
			fadeOut,
			curve: fadeCurve,
		});
		env.gain.exponentialRampToValueAtTime(0.0001, endAt);

		src.connect(env).connect(out);
		src.start(startAt, skipS);
		src.stop(endAt + 0.02);
		active.add(src);
		src.onended = () => {
			active.delete(src);
			src.disconnect();
			env.disconnect();
			panner?.disconnect();
			reverbSendGain?.disconnect();
			delaySendGain?.disconnect();
		};
	};

	// 直接呼び出し（その場で合成→発音）。ストリーミング経路では使われないが、
	// VoiceModel が callable であることの後方互換のために残す。
	const model: VoiceModel = (syllable, e) => {
		if (syllable.consonant === "Q" || syllable.vowel === "") return;
		const alias = resolveKoeAlias(
			backend.hasAlias,
			backend.pitchTokens,
			syllable,
			prevVowel,
			unitsToMidiFloat(e.pitchUnits),
		);
		if (syllable.vowel && syllable.vowel !== "N") prevVowel = syllable.vowel;
		if (!alias) return;
		const t0 = ctx.currentTime + e.when;
		const peak = Math.max(0.0001, e.volume);
		const pan = e.pan ?? 0;
		const durationMs = Math.max(MIN_RENDER_MS, e.duration * 1000);
		void renderInto(
			alias,
			e.pitchUnits,
			durationMs,
			undefined,
			undefined,
			e.pitchSegments,
		).then((r) => {
			if (r)
				schedule(
					r,
					t0,
					peak,
					pan,
					e.reverbSend,
					e.delaySend,
					e.destination,
					syllable.kind === "tie",
					false,
					false,
					undefined,
					e.duration,
				);
		});
	};

	model.renderToCache = async (
		syllable,
		prevVowelArg,
		pitch,
		durationMs,
		vibrato,
		expr,
		pitchSegments,
	) => {
		if (syllable.consonant === "Q" || syllable.vowel === "") return null;
		const alias = resolveKoeAlias(
			backend.hasAlias,
			backend.pitchTokens,
			syllable,
			prevVowelArg,
			// 多音階バンクのピッチトークン（"_G4" 等）は録音の音名なので、
			// 最寄り選択はMIDIノート番号の尺度で行う。units のまま渡すと常に
			// 最高音のトークンが選ばれてしまう。
			unitsToMidiFloat(pitch),
		);
		if (!alias) return null;
		const dMs = Math.max(MIN_RENDER_MS, durationMs);
		// 短いノートは1周期も揺れきらず不自然になるため、ここで最終的な適用可否を決める。
		const vib = !!vibrato && dMs / 1000 >= VIBRATO_MIN_SEC;
		const r = await renderInto(alias, pitch, dMs, vib, expr, pitchSegments);
		return r ? keyOf(alias, pitch, dMs, vib, expr, pitchSegments) : null;
	};

	model.scheduleCached = (
		key,
		t0,
		peak,
		pan,
		reverbSend,
		delaySend,
		dest,
		continuation,
		fadeOut,
		fadeIn,
		fadeCurve,
		durationSec,
	) => {
		const r = renderCache.get(key);
		if (r)
			schedule(
				r,
				t0,
				peak,
				pan,
				reverbSend,
				delaySend,
				dest,
				continuation,
				fadeOut,
				fadeIn,
				fadeCurve,
				durationSec,
			);
	};

	// ── 語り（`「…」`）────────────────────────────────────────────
	// 計画（読み・韻律・ユニット選択）はメイン側の SpeechPlanner、合成は backend。
	// 計画は本文と収録セット（多音階のトークン）ごとに、合成結果は基準ピッチと
	// 表情（g/h/t）まで含めてキャッシュする。

	/** ページ共有の計画器。最初の語りで初めてアセット取得が走る。 */
	const planner: SpeechPlanner = getSpeechPlanner({
		baseUrl: options.ttsBaseUrl,
	});

	/** 収録セットごとの音源の見え方（多音階でなければ "" の1件だけ）。 */
	const toneViews = new Map<string, SpeechToneView>();
	const toneViewFor = (token: string | null): SpeechToneView => {
		const k = token ?? "";
		let v = toneViews.get(k);
		if (!v) {
			v = createSpeechToneView(backend.phonemes, token);
			toneViews.set(k, v);
		}
		return v;
	};
	/** 目標ピッチに最も近い収録セット（多音階でなければ null）。 */
	const toneFor = (pitch: number): string | null =>
		nearestPitchToken(backend.pitchTokens, unitsToMidiFloat(pitch))?.token ??
		null;

	/** 本文 × 収録セット → 計画（失敗は null で覚えて再試行しない）。 */
	const plans = new Map<string, Promise<UtauTTSPlan | null>>();
	const planFor = (
		text: string,
		token: string | null,
		style?: SpeakingStyleInput,
		emotion?: SpeechEmotion,
	): Promise<UtauTTSPlan | null> => {
		const k = `${token ?? ""}|${styleKey(style)}|${emotion ?? ""}|${text}`;
		let p = plans.get(k);
		if (!p) {
			p = (async () => {
				try {
					await planner.ready();
					if (emotion && emotion !== "neutral") {
						await planner.prepareEmotion(emotion);
					}
					return planner.plan(toneViewFor(token).view, text, {
						tone: token ?? "C4",
						style,
						emotion,
					});
				} catch (err) {
					console.warn(`[dtm] speech plan failed for "${text}"`, err);
					return null;
				}
			})();
			plans.set(k, p);
		}
		return p;
	};

	type SpeechRendered = { audio: AudioBuffer; startSec: number };
	type SpeechEntry = {
		/** 計画が出来た（合成が始まった）時点で解決。null は失敗。 */
		planned: Promise<number | null>;
		/** 全チャンクの合成完了で解決。 */
		rendered: Promise<void>;
		/**
		 * 最初のチャンクが届いた時点で解決（失敗・チャンク無しでも合成終了時に解決）。
		 * 頭出しの貯金はこれで足りる。残りは再生中に届いた順で置かれる。
		 */
		firstChunk: Promise<void>;
		durationSec: number;
		/**
		 * タイムラインの先頭余白（秒。最初の子音の先行発声）。最初のチャンクは最初のモーラより
		 * これだけ前から鳴る。計画が出来た時点で埋まる。
		 */
		leadingSec: number;
		/** モーラ列（計画が出来た時点で埋まる）。 */
		morae: SpeechMora[];
		chunks: SpeechRendered[];
		done: boolean;
		/** 合成中に届いたチャンクを受け取る（scheduleSpeech が登録）。 */
		listeners: Set<(c: SpeechRendered) => void>;
		abort: AbortController;
	};
	const speechCache = new Map<string, SpeechEntry>();
	/** 話し方プリセットのキャッシュキー（プリセット名、または上書き込みの JSON）。 */
	const styleKey = (style?: SpeakingStyleInput): string =>
		style === undefined
			? ""
			: typeof style === "string"
				? style
				: JSON.stringify(style);
	const speechKeyOf = (
		text: string,
		pitch: number,
		expr?: VoiceExpression,
		style?: SpeakingStyleInput,
		emotion?: SpeechEmotion,
	): string =>
		`speak|${text}|${Math.round(pitch)}${
			expr?.gender !== undefined ? `|g${Math.round(expr.gender * 100)}` : ""
		}${
			expr?.breathiness !== undefined
				? `|h${Math.round(expr.breathiness * 100)}`
				: ""
		}${expr?.tension !== undefined ? `|t${Math.round(expr.tension * 100)}` : ""}${
			style !== undefined ? `|s${styleKey(style)}` : ""
		}${emotion ? `|e${emotion}` : ""}`;

	/** 基準ピッチからの平行移動の上限（±2オクターブ。それ以上は声にならない）。 */
	const SPEECH_PITCH_RATIO_MAX = 4;

	const speechEntryFor = (
		text: string,
		pitch: number,
		expr?: VoiceExpression,
		style?: SpeakingStyleInput,
		emotion?: SpeechEmotion,
	): SpeechEntry => {
		const key = speechKeyOf(text, pitch, expr, style, emotion);
		let entry = speechCache.get(key);
		if (entry) return entry;
		const abort = new AbortController();
		let resolvePlanned!: (d: number | null) => void;
		const planned = new Promise<number | null>((r) => {
			resolvePlanned = r;
		});
		let resolveFirstChunk!: () => void;
		const firstChunk = new Promise<void>((r) => {
			resolveFirstChunk = r;
		});
		const e: SpeechEntry = {
			planned,
			rendered: Promise.resolve(),
			firstChunk,
			durationSec: 0,
			leadingSec: 0,
			morae: [],
			chunks: [],
			done: false,
			listeners: new Set(),
			abort,
		};
		e.rendered = (async () => {
			const token = toneFor(pitch);
			const plan = await planFor(text, token, style, emotion);
			if (!plan) {
				e.done = true;
				resolvePlanned(null);
				resolveFirstChunk();
				return;
			}
			const view = toneViewFor(token);
			// ノートの音高 ÷ 計画の基準ピッチ（選ばれたユニットの収録ピッチの中央値）。
			// 基準の行にノートを置けば比 1 ＝ 音源の素の声になる。
			const reference = plan.timeline.reference_hz || view.referenceHz || 0;
			const ratio =
				reference > 0
					? Math.min(
							SPEECH_PITCH_RATIO_MAX,
							Math.max(
								1 / SPEECH_PITCH_RATIO_MAX,
								unitsToFreq(pitch) / reference,
							),
						)
					: 1;
			const prepared = prepareSpeechPlan(plan, ratio, view.toReal);
			e.durationSec = speechPlanDurationSec(prepared);
			e.morae = speechPlanMorae(prepared);
			// ノートの位置には最初のモーラを合わせる。タイムラインの先頭余白（先行発声ぶん）は
			// ノートより前へはみ出して鳴る（歌唱の preSec と同じ扱い）。
			const leadingSec = speechPlanLeadingSec(prepared);
			e.leadingSec = leadingSec;
			resolvePlanned(e.durationSec);
			await backend.renderSpeech(
				prepared,
				expr,
				(chunk) => {
					const buf = ctx.createBuffer(1, chunk.pcm.length, KOE_SAMPLE_RATE);
					buf.copyToChannel(chunk.pcm, 0);
					const r: SpeechRendered = {
						audio: buf,
						startSec: chunk.startMs / 1000 - leadingSec,
					};
					e.chunks.push(r);
					resolveFirstChunk();
					for (const l of e.listeners) l(r);
				},
				abort.signal,
				speechRenderOptions(style),
			);
			e.done = true;
			e.listeners.clear();
			resolveFirstChunk(); // チャンクが 1 つも出なかった（失敗・中断）場合の取りこぼし防止
		})();
		entry = e;
		speechCache.set(key, entry);
		return entry;
	};

	/**
	 * 語りの 1 チャンクを、決めた置き方（時刻とバッファ内の開始位置）で鳴らす。
	 * 置き方の計算は speech-schedule.ts（MML の語りは {@link skipPlacement}＝遅れて届いた分は
	 * 途中から鳴らして同期を保つ。`speak` は {@link createSpeechScheduler}）。
	 */
	const placeSpeechChunk = (
		r: SpeechRendered,
		placement: SpeechPlacement,
		peak: number,
		pan: number,
		reverbSend = 0,
		delaySend = 0,
		destOverride?: AudioNode,
		own?: Set<AudioBufferSourceNode>,
	): void => {
		const dest = destOverride ?? destination;
		const { at: startAt, offset } = placement;

		let out: AudioNode = dest;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(dest);
			out = panner;
		}
		let reverbSendGain: GainNode | null = null;
		if (options.reverbBus && reverbSend > 0 && panner) {
			reverbSendGain = ctx.createGain();
			reverbSendGain.gain.value = Math.max(0, Math.min(1, reverbSend));
			panner.connect(reverbSendGain).connect(options.reverbBus);
		}
		let delaySendGain: GainNode | null = null;
		if (options.delayBus && delaySend > 0 && panner) {
			delaySendGain = ctx.createGain();
			delaySendGain.gain.value = Math.max(0, Math.min(1, delaySend));
			panner.connect(delaySendGain).connect(options.delayBus);
		}
		const env = ctx.createGain();
		// 途中から鳴らすときだけ、切り口のクリックを短い立ち上がりで消す。
		if (offset > 0) {
			env.gain.setValueAtTime(0.0001, startAt);
			env.gain.exponentialRampToValueAtTime(peak, startAt + 0.005);
		} else {
			env.gain.setValueAtTime(peak, startAt);
		}
		const src = ctx.createBufferSource();
		src.buffer = r.audio;
		src.connect(env).connect(out);
		src.start(startAt, offset);
		active.add(src);
		own?.add(src);
		src.onended = () => {
			active.delete(src);
			own?.delete(src);
			src.disconnect();
			env.disconnect();
			panner?.disconnect();
			reverbSendGain?.disconnect();
			delaySendGain?.disconnect();
		};
	};

	/** scheduleSpeech が登録した「合成中チャンクの受け取り」。stopAll で全部外す。 */
	const speechListeners = new Set<{
		entry: SpeechEntry;
		listener: (c: SpeechRendered) => void;
	}>();

	model.speakToCache = async (text, pitch, expr, awaitRender) => {
		const entry = speechEntryFor(text, pitch, expr);
		const duration = await entry.planned;
		if (duration === null) return null;
		if (awaitRender === "first-chunk") await entry.firstChunk;
		else if (awaitRender) await entry.rendered;
		return speechKeyOf(text, pitch, expr);
	};

	model.scheduleSpeech = (key, t0, peak, pan, reverbSend, delaySend, dest) => {
		const entry = speechCache.get(key);
		if (!entry) return;
		// 曲の中の語りは伴奏との同期が先なので、遅れて届いた分は途中から鳴らす（skip）。
		const place = (r: SpeechRendered) => {
			const p = skipPlacement(
				t0 + r.startSec,
				r.audio.duration,
				ctx.currentTime,
			);
			if (p) placeSpeechChunk(r, p, peak, pan, reverbSend, delaySend, dest);
		};
		for (const r of entry.chunks) place(r);
		if (!entry.done) {
			entry.listeners.add(place);
			const reg = { entry, listener: place };
			speechListeners.add(reg);
			void entry.rendered.then(() => speechListeners.delete(reg));
		}
	};

	model.speechDurationSec = (key) => {
		const entry = speechCache.get(key);
		return entry && entry.durationSec > 0 ? entry.durationSec : undefined;
	};

	/**
	 * 最初のチャンクが届き、さらに最初のモーラから `minBufferSec` 秒ぶんの音が揃う
	 * （または合成が終わる）まで待つ（`awaitRender: "first-chunk"` の待ち）。
	 */
	const speechBuffered = async (
		e: SpeechEntry,
		minBufferSec: number,
	): Promise<void> => {
		await e.firstChunk;
		const reached = () => {
			const last = e.chunks[e.chunks.length - 1];
			return speechBufferReached({
				renderedUntilSec: last ? last.startSec + last.audio.duration : null,
				minBufferSec,
				durationSec: e.durationSec,
				done: e.done,
			});
		};
		if (reached()) return;
		await new Promise<void>((resolve) => {
			const settle = () => {
				e.listeners.delete(onChunk);
				resolve();
			};
			const onChunk = () => {
				if (reached()) settle();
			};
			e.listeners.add(onChunk);
			void e.rendered.then(settle, settle);
		});
	};

	model.speak = async (text, pitch, o = {}) => {
		const entry = speechEntryFor(text, pitch, o.expr, o.style, o.emotion);
		const duration = await entry.planned;
		if (duration === null || o.signal?.aborted) return null;
		if (o.awaitRender === "first-chunk")
			await speechBuffered(entry, o.minBufferSec ?? 0);
		else if (o.awaitRender) await entry.rendered;
		if (o.signal?.aborted) return null;
		const lateChunks = resolveLateChunks(o.awaitRender, o.lateChunks);
		// 最初のチャンクを置くまでの猶予（メインスレッド 1 周ぶん。skip では先頭余白も足す）。
		const sched = createSpeechScheduler({
			t0: speechStartTime({
				now: ctx.currentTime,
				leadingSec: entry.leadingSec,
				lateChunks,
				at: o.at,
			}),
			durationSec: duration,
			lateChunks,
		});
		const peak = Math.max(0, o.volume ?? 1);
		const pan = o.pan ?? 0;
		const own = new Set<AudioBufferSourceNode>();
		let finished = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const place = (r: SpeechRendered) => {
			const anchor = sched.anchor;
			const p = sched.place(r.startSec, r.audio.duration, ctx.currentTime);
			if (p) placeSpeechChunk(r, p, peak, pan, 0, 0, o.destination, own);
			// 後ろへずれたら、終わりの見込みも同じだけ延ばす。
			if (sched.anchor !== anchor && timer !== undefined) armTimer();
		};
		const reg = { entry, listener: place };
		let resolveEnded!: () => void;
		const ended = new Promise<void>((r) => {
			resolveEnded = r;
		});
		// 終了はオーディオクロックで測る（合成中のチャンクはまだノードが無いので
		// onended では数えられない）。少し余裕を足して末尾のリリースを切らない。
		const armTimer = () => {
			if (finished) return;
			clearTimeout(timer);
			timer = setTimeout(
				onTimer,
				Math.max(0, sched.endTime - ctx.currentTime) * 1000 + 150,
			);
		};
		const onTimer = () => {
			// shift では、まだ届いていないチャンクは遅れても鳴る（後ろへずれる）ので、
			// 合成が終わるまでは終わらせない。終わったら改めて終わりの見込みまで待つ。
			if (lateChunks === "shift" && !entry.done) {
				void entry.rendered.then(armTimer);
				return;
			}
			finish();
		};
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			o.signal?.removeEventListener("abort", finish);
			entry.listeners.delete(place);
			speechListeners.delete(reg);
			for (const src of own) {
				try {
					src.stop();
				} catch {}
				src.disconnect();
				active.delete(src);
			}
			own.clear();
			resolveEnded();
		};
		for (const r of entry.chunks) place(r);
		if (!entry.done) {
			entry.listeners.add(place);
			speechListeners.add(reg);
			void entry.rendered.then(() => speechListeners.delete(reg));
		}
		armTimer();
		o.signal?.addEventListener("abort", finish, { once: true });
		return {
			durationSec: duration,
			// 最初のチャンクを置いた時点で確定する（shift で後から届くときのために getter）。
			get startTime() {
				return sched.startTime;
			},
			get shiftSec() {
				return sched.shiftSec;
			},
			morae: entry.morae,
			position: () => sched.position(ctx.currentTime, entry.done),
			stop: finish,
			ended,
		};
	};

	// 帯表示用: 長さはピッチに依らないので、基準ピッチ（比 1）の計画で引く。
	const previewDurations = new Map<string, number>();
	const previewInfos = new Map<string, SpeechPlanInfo>();
	model.planSpeechDetail = async (text, o = {}) => {
		const key = `${styleKey(o.style)}|${o.emotion ?? ""}|${text}`;
		const cached = previewInfos.get(key);
		if (cached) return cached;
		const token =
			backend.pitchTokens.length > 0
				? (nearestPitchToken(
						backend.pitchTokens,
						unitsToMidiFloat(model.speechReferenceUnits?.() ?? 0),
					)?.token ?? null)
				: null;
		const plan = await planFor(text, token, o.style, o.emotion);
		if (!plan) return null;
		const info: SpeechPlanInfo = {
			durationSec: speechPlanDurationSec(plan),
			morae: speechPlanMorae(plan),
		};
		previewInfos.set(key, info);
		// 帯表示の同期参照（peekSpeechDurationSec）は本文だけのキーで引く。
		if (!o.style && !o.emotion) previewDurations.set(text, info.durationSec);
		return info;
	};
	model.planSpeech = async (text, o) => {
		if (!o?.style && !o?.emotion) {
			const cached = previewDurations.get(text);
			if (cached !== undefined) return cached;
		}
		const info = await model.planSpeechDetail?.(text, o);
		return info ? info.durationSec : null;
	};
	model.peekSpeechDurationSec = (text) => previewDurations.get(text);

	model.speechReferenceUnits = () => {
		// 多音階音源は中央付近の収録セット、それ以外は全音素の中央値。
		const tokens = backend.pitchTokens;
		let hz: number | undefined;
		if (tokens.length > 0) {
			const sorted = tokens.slice().sort((a, b) => a.midi - b.midi);
			hz = toneViewFor(sorted[sorted.length >> 1].token).referenceHz;
		} else {
			hz = toneViewFor(null).referenceHz;
		}
		if (!hz || hz <= 0) return undefined;
		// Hz → units（A4 = 2139 units = 440Hz、1オクターブ = 372 units）
		return Math.round(2139 + 372 * Math.log2(hz / 440));
	};

	model.stopAll = () => {
		for (const src of active) {
			try {
				src.stop();
			} catch {}
			src.disconnect();
		}
		active.clear();
		// 合成中の語りが、止めたあとに届いて鳴り出さないよう受け取りを外す。
		for (const { entry, listener } of speechListeners)
			entry.listeners.delete(listener);
		speechListeners.clear();
	};

	model.reset = () => {
		prevVowel = "";
	};

	// 語尾素片（"a R" 等）。母音の抜けを音源の収録で終える。
	model.renderEndingToCache = async (vowel, pitch, expr) => {
		if (!vowel) return null;
		const bases = vowel === "N" ? ["n R", "N R"] : [`${vowel} R`];
		const alias = matchAliases(
			backend.hasAlias,
			backend.pitchTokens,
			bases,
			unitsToMidiFloat(pitch),
		);
		if (!alias) return null;
		// 固定範囲（抜けそのもの）は伸縮させず、その後ろに短い余白を足すだけにする。
		const entry = backend.phonemes[alias];
		const fixedMs = entry
			? Math.max(0, ((entry.consonant - entry.pre) / KOE_SAMPLE_RATE) * 1000)
			: 0;
		const dMs = Math.min(
			ENDING_MAX_MS,
			Math.max(ENDING_MIN_MS, fixedMs + ENDING_TAIL_MS),
		);
		const r = await renderInto(alias, pitch, dMs, false, expr);
		return r ? keyOf(alias, pitch, dMs, false, expr) : null;
	};

	// 息継ぎ素片。候補は音素表で決め、PCM は音源ごとに1度だけまとめて引く。
	// 吸う息か吐く息かは名前では分からない（テトの 息3 は山が頭にある＝吐く形）ので、
	// 包絡の山の位置（{@link breathPeakPosition}）で見分け、吸う形を優先して選ぶ。
	let breathCatalog: Promise<BreathSample[]> | null = null;
	const loadBreathCatalog = (): Promise<BreathSample[]> => {
		breathCatalog ??= (async () => {
			const seen = new Set<string>();
			const picks: string[] = [];
			for (const [alias, entry] of Object.entries(backend.phonemes)) {
				if (!isBreathAlias(alias)) continue;
				// 同じ収録の別名（テトの b1 = 息1）は1つでよい。.koe は別名ごとに PCM を
				// 複製して詰めるので offset では見分けられず、oto 由来の値の組で見る。
				const key = `${entry.length}:${entry.pre}:${entry.consonant}:${entry.pitch}`;
				if (seen.has(key)) continue;
				seen.add(key);
				picks.push(alias);
				if (picks.length >= BREATH_CATALOG_MAX) break;
			}
			const out: BreathSample[] = [];
			await Promise.all(
				picks.map(async (alias) => {
					const pcm = await backend.getPcm(alias).catch(() => null);
					if (!pcm || pcm.length === 0) return;
					let peak = 0;
					for (let i = 0; i < pcm.length; i++) {
						const v = Math.abs(pcm[i]);
						if (v > peak) peak = v;
					}
					if (peak <= 0) return;
					const buffer = ctx.createBuffer(1, pcm.length, KOE_SAMPLE_RATE);
					const ch = buffer.getChannelData(0);
					const scale = 1 / peak;
					for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] * scale;
					out.push({
						alias,
						buffer,
						sec: pcm.length / KOE_SAMPLE_RATE,
						peakAt: breathPeakPosition(pcm, KOE_SAMPLE_RATE),
					});
				}),
			);
			return out;
		})();
		return breathCatalog;
	};
	model.breathSample = async (targetSec) =>
		pickBreathSample(await loadBreathCatalog(), targetSec)?.buffer ?? null;

	return model;
};

/**
 * 音源の息継ぎ素片のエイリアスかどうか。
 *
 * 手元の UTAU 音源を洗った命名（oto.ini のエイリアス側）:
 *   - 重音テト（エクストラ）: `息1` `息2` `息3` と、その別名 `b1` `b2` `b3`
 *   - 蓄音キリコ: `息`
 *   - 束音ロゼ: `息短` `息短2` `息中` `息深` `息深2`（拡張音声は `息（短）拡` 等）
 *   - 欲音ルコ♀: `息1`〜`息3`、吐く息 `息吐1` `息吐2`
 *   - 英語圏の慣習: `br` `br1` `breath`
 * 除くもの: `息吐`（吐く息＝語尾の抜け）、`a息 R`（母音の後の吐息。テトの `_あb.wav`）、
 * `巻`（巻き舌）。ブレス記号 `、` は吸気なので、吸う素片だけを拾う。
 */
export const isBreathAlias = (alias: string): boolean => {
	const a = alias.trim();
	if (/吐/.test(a)) return false;
	if (/^_?息/.test(a)) return true;
	return /^_?(br|breath)\d*$/i.test(a) || /^b\d$/i.test(a);
};

/**
 * 隙間 `targetSec` にいちばん合う息継ぎ素片を音素表から選ぶ。
 *
 * 吸気は終わり際（発声直前）が山なので、隙間より長い素片は尻を揃えて頭を切れば
 * 自然に収まる。逆に短すぎる素片は伸ばせない。そこで「隙間以上でいちばん短いもの」を
 * 第一候補にし、無ければ「いちばん長いもの」を選ぶ。ただし極端に長い素片
 * （深い息）は頭を切っても質感が違うので、上限を超えるものは後回しにする。
 */
export const pickBreathAlias = (
	phonemes: Record<string, PhonemeEntry>,
	targetSec: number,
): string | null =>
	pickByLength(
		Object.entries(phonemes)
			.filter(([alias]) => isBreathAlias(alias))
			.map(([alias, entry]) => ({
				alias,
				sec: entry.length / KOE_SAMPLE_RATE,
			})),
		targetSec,
	)?.alias ?? null;

/**
 * 長さで息素片を選ぶ。第1候補: 隙間以上・上限以下でいちばん短い。第2候補: 隙間以上で
 * いちばん短い（深い息しか無いなら、頭を切る量が少ないほう）。第3候補: いちばん長い。
 */
const pickByLength = <T extends { sec: number }>(
	samples: readonly T[],
	targetSec: number,
): T | null => {
	const want = Math.max(0.05, targetSec);
	let fit: T | null = null;
	let over: T | null = null;
	let longest: T | null = null;
	for (const s of samples) {
		if (
			s.sec >= want &&
			s.sec <= BREATH_SAMPLE_MAX_SEC &&
			(!fit || s.sec < fit.sec)
		)
			fit = s;
		if (s.sec >= want && (!over || s.sec < over.sec)) over = s;
		if (!longest || s.sec > longest.sec) longest = s;
	}
	return fit ?? over ?? longest;
};

/** 取得済みの息素片（{@link VoiceModel.breathSample} の候補）。 */
export type BreathSample = {
	alias: string;
	buffer: AudioBuffer;
	/** 長さ（秒）。 */
	sec: number;
	/** 包絡の山の位置 0〜1（{@link breathPeakPosition}）。 */
	peakAt: number;
};

/**
 * 息素片の包絡の山の位置（0=頭、1=尻）。10ms の実効値を取り、最大から -30dB 以上の
 * 区間を有効区間として、その中で最大が何割の位置にあるかを返す。
 * 吸う息は発声の直前が山なので後ろ寄り、吐く息は頭で出て減るので前寄りになる。
 */
export const breathPeakPosition = (
	pcm: ArrayLike<number>,
	sampleRate: number,
): number => {
	const hop = Math.max(1, Math.floor(sampleRate * 0.01));
	const env: number[] = [];
	for (let i = 0; i + hop <= pcm.length; i += hop) {
		let e = 0;
		for (let j = i; j < i + hop; j++) e += pcm[j] * pcm[j];
		env.push(Math.sqrt(e / hop));
	}
	if (env.length < 2) return 0.5;
	let peak = 0;
	let peakIdx = 0;
	for (let i = 0; i < env.length; i++) {
		if (env[i] > peak) {
			peak = env[i];
			peakIdx = i;
		}
	}
	if (peak <= 0) return 0.5;
	const thr = peak * 10 ** (-30 / 20);
	let a = 0;
	while (a < env.length && env[a] < thr) a++;
	let b = env.length - 1;
	while (b > a && env[b] < thr) b--;
	return b > a ? (peakIdx - a) / (b - a) : 0.5;
};

/** 山がこの位置より後ろにある息素片を「吸う形」とみなす。 */
const BREATH_INHALE_PEAK_MIN = 0.35;

/** 1音源から取得する息素片の上限（同じ収録の別名は数えない）。 */
const BREATH_CATALOG_MAX = 6;

/**
 * 隙間 `targetSec` に使う息素片を選ぶ。吸う形（{@link BREATH_INHALE_PEAK_MIN}）のものが
 * あればその中から、無ければ全部の中から、{@link pickByLength} で長さの合うものを取る。
 */
export const pickBreathSample = <T extends { sec: number; peakAt: number }>(
	samples: readonly T[],
	targetSec: number,
): T | null => {
	const inhale = samples.filter((s) => s.peakAt >= BREATH_INHALE_PEAK_MIN);
	return pickByLength(inhale.length ? inhale : samples, targetSec);
};

/** ストリーミング再生する歌唱ノート1つ（絶対時刻ベース）。 */
export type StreamVoiceNote = {
	syllable: LyricSyllable;
	/**
	 * ピッチ。単位は units（1/372オクターブ）。koe は Hz を受けるので、
	 * ここから直接 Hz へ変換して歌わせる（整数MIDIノートに丸めない）。
	 * 継続記号で複数ノートが結合されている場合は**先頭区間**のピッチ。
	 */
	pitch: Units;
	/** アンカー（再生開始時刻）からの相対秒。実発音時刻 = anchorTime + startSec。 */
	startSec: number;
	/** ゲート適用済みの発音長（秒）。結合されている場合は結合後の全長。 */
	durationSec: number;
	/**
	 * 継続記号（`ー` / `〜`）で結合された2区間目以降のピッチ推移。
	 * これがあるノートは「1回の合成で歌い切る長い1音」で、区間の境界では
	 * 言い直さずにピッチだけが動く。
	 */
	pitchSegments?: PitchSegment[];
	/**
	 * 直前ノートからの継続として鳴らす（結合できなかった `ー` / `〜`）。
	 * 発音側は先行母音を切り、立ち上がりを直前ノートへ被せて言い直し感を消す。
	 */
	continuation?: boolean;
	/**
	 * このノートの直後にブレス（`、`）を入れる。
	 * `durationSec` は既にブレスぶん切り詰めてある。
	 */
	breath?: boolean;
	/**
	 * ブレスのために `durationSec` から実際に削った長さ（秒）。息はこの隙間を
	 * 埋めるように鳴る（短い音符では {@link BREATH_MAX_RATIO} で隙間も短くなる）。
	 */
	breathGapSec?: number;
	/**
	 * 直前のノートとの間に {@link PHRASE_GAP_SEC} 以上の休符がある（旋律側の休符）。
	 * 歌詞に `_` が無くても声は一度止まっているので、語頭（"- か"）として歌う。
	 */
	phraseStart?: boolean;
	/**
	 * このノートでフレーズが終わる（次が休符・語り・ブレス・行末、または旋律側の
	 * {@link PHRASE_GAP_SEC} 以上の隙間）。音源に語尾の素片があればそれで抜く。
	 * 促音（っ）の前は閉鎖であって抜けではないので立てない。`↓` で消える音にも立てない。
	 */
	phraseEnd?: boolean;
	/**
	 * このノートを歌いながら声量0へ落とす（`↓`）。継続記号で結合されたグループの
	 * どこに `↓` が付いていても、**結合後の1音全体**に掛かる。
	 */
	fadeOut?: boolean;
	/** このノートを歌いながら声量を上げていく（`↑`）。{@link StreamVoiceNote.fadeOut} の対。 */
	fadeIn?: boolean;
	/**
	 * 声量の中継点列（`↓` / `↑` を1音へ複数書いたとき）。{@link buildFadeCurve} 参照。
	 * 記号が1つだけ／スウェルのときは付かない（＝従来どおり1音まるごと）。
	 */
	fadeCurve?: FadeStop[];
};

/**
 * 継続記号でノートを結合できる上限（秒）。これを超える長さは1回の合成に載せず、
 * 分割して継続ノート（{@link StreamVoiceNote.continuation}）として繋ぐ。
 *
 * WORLD再合成のコストは音価にほぼ比例するので、際限なく結合すると先読みが
 * 間に合わず「遅延スキップ」で歌が抜ける。
 * ロングトーンとして実用になる長さを確保しつつ、合成が破綻しない上限。
 */
export const TIE_MERGE_MAX_SEC = 4;

/**
 * ブレス（`、`）で直前ノートから削る長さ（秒）。吸気1回ぶんの隙間。
 * 0.16 では息というより子音の破裂（「ツ」）に聞こえたので、吸う時間を確保する。
 */
const BREATH_SEC = 0.24;

/**
 * 息が次の音の頭へ食い込む長さ（秒）。実際の歌唱でも吸気は発声の直前まで続き、
 * 声が出た瞬間に隠れる。隙間の中だけで完結させると「間が空いてから歌う」に聞こえる。
 */
const BREATH_TAIL_SEC = 0.05;

/** 息の最短長（秒）。速い曲で隙間が小さくても、これより短くすると子音に戻る。 */
const BREATH_MIN_SEC = 0.14;

/** ブレス音の音量（歌唱のピークに対する比）。 */
const BREATH_PEAK_SCALE = 0.18;

/**
 * ノイズのブレスに掛けるスペクトル形（dB、最大 0）。100Hz〜12kHz を対数周波数で
 * 48 点に刻んだもので、束音ロゼの息継ぎ素片 3 本（息短2・息短・息中）の有効区間を
 * 1024 点 FFT で平均して測った（scratch/_breath-synth.mjs）。
 *
 * 白色雑音を帯域フィルタで削っただけの音は「風」に聞こえる。息は声道を通っているので
 * 1.6k / 2.5k / 4k に山があり 5k から急に落ちる。この山谷をそのまま FIR にして掛ける。
 * 表は「形」だけで、収録そのものは含まない。
 */
const BREATH_EQ_DB = [
	-13, -13, -24.6, -24.6, -24.6, -16.3, -16.3, -16.3, -9, -9, -5, -3, -3, -4.6,
	-10.8, -11.6, -12, -11.2, -7, -6.1, -6.5, -13.9, -14.8, -8.8, -15.6, -12.4,
	-2.9, 0, -5.1, -10.5, -9.5, -4.2, -10.2, -13, -12.6, -4, -4.9, -8.6, -15,
	-15.4, -19.8, -24.5, -27.3, -34.2, -33, -35.3, -38.5, -44.2,
];
const BREATH_EQ_F0 = 100;
const BREATH_EQ_F1 = 12000;
/** {@link BREATH_EQ_DB} を FIR にするときの片側長（タップ数 = 2L+1）と FFT 点数。 */
const BREATH_IR_HALF = 256;
const BREATH_IR_N = 1024;

/**
 * ノイズのブレスの包絡（実測の平均、最大 1）。ロゼ 息短2・息短とルコ♀ 息1 の
 * 10ms RMS を有効区間で 0〜1 に伸ばして平均した。山が 2 つあるのは実物の「二段で吸う」形。
 */
const BREATH_ENV = [
	0.19, 0.26, 0.32, 0.35, 0.52, 0.58, 0.79, 0.94, 0.87, 0.82, 0.9, 0.86, 1, 1,
	0.87, 0.71, 0.47, 0.43, 0.63, 0.66, 0.65, 0.53, 0.35, 0.18,
];

/**
 * {@link BREATH_EQ_DB} から零位相 FIR を作る（Hann 窓、実行時に 1 回だけ）。
 * 表の外側は 24dB/oct で落とす。出力の実効値が白色雑音入力の約 0.3 倍になるよう
 * 正規化し、旧実装（帯域フィルタ）と同じ音量感で {@link BREATH_PEAK_SCALE} が効くようにする。
 */
const buildBreathImpulse = (sampleRate: number): Float32Array => {
	const N = BREATH_IR_N;
	const L = BREATH_IR_HALF;
	const pts = BREATH_EQ_DB.length;
	const mag = new Float64Array(N / 2 + 1);
	for (let k = 0; k <= N / 2; k++) {
		const f = (k * sampleRate) / N;
		let db: number;
		if (f <= BREATH_EQ_F0) {
			db = BREATH_EQ_DB[0] - ((BREATH_EQ_F0 - f) / BREATH_EQ_F0) * 24;
		} else if (f >= BREATH_EQ_F1) {
			db = BREATH_EQ_DB[pts - 1] - ((f - BREATH_EQ_F1) / BREATH_EQ_F1) * 24;
		} else {
			const x =
				(Math.log(f / BREATH_EQ_F0) / Math.log(BREATH_EQ_F1 / BREATH_EQ_F0)) *
				(pts - 1);
			const i = Math.min(pts - 2, Math.floor(x));
			db = BREATH_EQ_DB[i] + (BREATH_EQ_DB[i + 1] - BREATH_EQ_DB[i]) * (x - i);
		}
		mag[k] = 10 ** (db / 20);
	}
	const h = new Float32Array(2 * L + 1);
	let energy = 0;
	for (let n = -L; n <= L; n++) {
		let v = mag[0];
		for (let k = 1; k < N / 2; k++)
			v += 2 * mag[k] * Math.cos((2 * Math.PI * k * n) / N);
		v += mag[N / 2] * Math.cos(Math.PI * n);
		const w = 0.5 + 0.5 * Math.cos((Math.PI * n) / (L + 1));
		h[n + L] = (v / N) * w;
		energy += h[n + L] * h[n + L];
	}
	const scale = 0.3 / Math.sqrt(energy);
	for (let i = 0; i < h.length; i++) h[i] *= scale;
	return h;
};

/**
 * 音源の息継ぎ素片で鳴らすときの最大振幅（トラック音量に対する比）。素片は最大振幅1へ
 * 正規化してあるので、歌のピーク（素片の生の振幅×音量）よりおよそ 10dB 下になる。
 */
const BREATH_SAMPLE_PEAK = 0.3;

/** 息継ぎ素片としてそのまま使う長さの上限（秒）。これより長い深い息は他に無いときだけ使う。 */
const BREATH_SAMPLE_MAX_SEC = 0.9;

/** 息継ぎ素片の頭に掛けるフェード（秒）。頭を切って使うときのクリック防止と、吸気の膨らみ。 */
const BREATH_SAMPLE_FADE_IN_SEC = 0.06;

/** ブレスで削ってよい直前ノートの割合の上限（短い音符を消してしまわないため）。 */
const BREATH_MAX_RATIO = 0.4;

/**
 * 旋律の休符をフレーズの切れ目とみなす最短の隙間（秒）。これ以上空いていれば
 * 歌い手は一度声を止めているので、前は語尾の素片で抜き、次は語頭（"- か"）で入る。
 * これより短い隙間はスタッカート扱いで、声の文脈（直前母音）は繋いだままにする。
 */
export const PHRASE_GAP_SEC = 0.15;

/** 語尾素片の合成長（ms）の下限・上限と、固定範囲の後ろへ足す余白。 */
const ENDING_MIN_MS = 150;
const ENDING_MAX_MS = 500;
const ENDING_TAIL_MS = 80;

/**
 * `↓` / `↑` を1音へ複数書いたときの、声量の中継点列を作る。
 *
 * k個書くと、i番目の記号が付いた区間の**終わり**で声量が (k-i)/k 倍になる
 * （`↑` なら i/k 倍）。`ぎ↓ー↓` は「ぎ」の終わりで50%・音の終わりで0%、
 * `ぎ↓ー↓ー↓` は 66%→33%→0%。どこで減らすかを書いた位置で刻めるので、
 * 「後半で一気に消える」「先に半分落としてから粘る」を書き分けられる。
 *
 * 最後の1つだけは、書いた位置に関わらず**結合後の音の終端**へ置く。記号が1つの
 * ときに「付けた位置に関係なく一続き全体へ掛かる」のと辻褄を合わせるためで、
 * これが無いと `ぎ↓ー↓ー` のように末尾に記号が無いとき、消えたあとに無音の
 * 余りがぶら下がる。
 *
 * @param markedParts 記号が付いた区間の index（`partStarts` の添字）。書いた順。
 * @param partStarts  結合された各区間の開始秒（先頭からの相対）。
 * @param durationSec 結合後の全長（秒）。
 * @param rising      `↑`（クレッシェンド）なら true。
 */
const buildFadeCurve = (
	markedParts: number[],
	partStarts: number[],
	durationSec: number,
	rising: boolean,
): FadeStop[] => {
	const k = markedParts.length;
	let prev = 0;
	return markedParts.map((part, idx) => {
		const i = idx + 1;
		// 記号が付いた区間の終わり = 次の区間の開始（最後の区間なら音の終端）。
		const endSec = partStarts[part + 1] ?? durationSec;
		const at =
			i === k || durationSec <= 0
				? 1
				: Math.min(1, Math.max(prev, endSec / durationSec));
		prev = at;
		return { at, level: rising ? i / k : (k - i) / k };
	});
};

/** {@link buildStreamVoiceNotes} が受け取る演奏ノート（startStep 昇順で渡すこと）。 */
export type TieSourceNote = {
	startStep: number;
	durationSteps: number;
	pitchUnits: Units;
};

/** {@link buildStreamVoiceNotes} のタイミング・移調パラメータ。 */
export type StreamVoiceNoteOptions = {
	/** シーク開始位置（ステップ）。これより前に始まるノートは切り落とす。 */
	fromStep: number;
	/** 1ステップの実時間（秒）。 */
	secondsPerStep: number;
	/** ゲートタイム係数 0-1（歌詞トラックの `q` を正規化したもの）。 */
	gate: number;
	/** 歌唱ピッチのオクターブシフト（units）。 */
	octaveShiftUnits: number;
};

/**
 * 音節列と演奏ノート列を突き合わせ、ストリーミング用のノート列を組み立てる。
 *
 * 音節とノートは**発音順（startStep昇順）の index で1:1**に対応する。これは
 * ピアノロールの歌詞表示（`renderer.drawNoteLyrics`）とも共通の規則。
 *
 * 継続記号（`ー` / `〜`）はここでノートへ畳まれる:
 * - 直前ノートと**隙間なく続いている**なら1音へ結合し、{@link StreamVoiceNote.pitchSegments}
 *   としてピッチ推移だけを持たせる（＝1回の合成で歌い切る）。
 * - 隙間がある／{@link TIE_MERGE_MAX_SEC} を超えるなら結合をやめ、
 *   {@link StreamVoiceNote.continuation} を立てた別ノートとして繋ぐ。
 * - シークで先頭が切り落とされた継続（結合相手が居ない）も同じく継続ノートになる。
 *
 * 隙間の判定は**ゲート適用前のステップ**で行う。ゲートを短くすると全ノートの間に
 * 隙間ができるが、それは発音長の設定であって「音が途切れている」ことではないため。
 */
export const buildStreamVoiceNotes = (
	syllables: LyricSyllable[],
	sorted: TieSourceNote[],
	o: StreamVoiceNoteOptions,
): StreamVoiceNote[] => {
	const { fromStep, secondsPerStep, gate, octaveShiftUnits } = o;
	const count = Math.min(sorted.length, syllables.length);
	const out: StreamVoiceNote[] = [];

	/** ゲート適用済みの発音長（秒）。 */
	const gatedSec = (n: TieSourceNote): number =>
		n.durationSteps * secondsPerStep * gate;
	/** アンカー（fromStep）からの相対開始秒。 */
	const startSecOf = (n: TieSourceNote): number =>
		(n.startStep - fromStep) * secondsPerStep;
	const pitchOf = (n: TieSourceNote): Units =>
		units(n.pitchUnits + octaveShiftUnits);

	/** 2つのノートの間の隙間（秒）。重なっていれば負。 */
	const gapSec = (a: TieSourceNote, b: TieSourceNote): number =>
		(b.startStep - (a.startStep + a.durationSteps)) * secondsPerStep;

	let i = 0;
	while (i < count) {
		const headIdx = i;
		const head = sorted[i];
		const syl = syllables[i];
		i++;
		if (head.startStep < fromStep) continue; // シークで切り落とされたノート
		// 旋律側の休符明け（歌詞に `_` が無くても声は止まっている）
		const phraseStart =
			headIdx > 0 && gapSec(sorted[headIdx - 1], head) >= PHRASE_GAP_SEC;

		// 先頭が継続記号 = 結合相手を失った継続（シークで頭が切られた等）。
		// 言い直さないことだけは守り、ここから新しい結合グループを始める。
		const continuation = syl.kind === "tie";

		// 続く継続記号を、隙間なく繋がっている限り1音へ畳む。
		// 歌わない音節（促音・休符）へは畳まない — 畳むと継続ごと無音になってしまう
		// （例: "あっー" の "ー" は、"っ" の無音へ吸われず単体の継続として鳴らす）。
		const sungHead = syl.kind !== "stop" && syl.kind !== "rest";
		const segments: PitchSegment[] = [];
		let last = head;
		let breath = !!syl.breathAfter;
		// デクレッシェンドは結合を切らない（音量の話であって息の切れ目ではない）。
		// グループ内のどこに付いていても、結合後の1音全体へ掛ける。
		// 複数書かれていたときだけ、書いた位置を中継点として拾う（{@link buildFadeCurve}）。
		const partStarts: number[] = [0];
		const fadeOutParts: number[] = syl.fadeOut ? [0] : [];
		const fadeInParts: number[] = syl.fadeIn ? [0] : [];
		while (
			sungHead &&
			i < count &&
			syllables[i].kind === "tie" &&
			!breath && // ブレスを挟んだら別の息＝別の音
			sorted[i].startStep <= last.startStep + last.durationSteps &&
			(sorted[i].startStep + sorted[i].durationSteps - head.startStep) *
				secondsPerStep <=
				TIE_MERGE_MAX_SEC
		) {
			const n = sorted[i];
			const atSec = (n.startStep - head.startStep) * secondsPerStep;
			segments.push({
				pitch: pitchOf(n),
				atSec,
				portamento: !!syllables[i].portamento,
			});
			partStarts.push(atSec);
			if (syllables[i].fadeOut) fadeOutParts.push(partStarts.length - 1);
			if (syllables[i].fadeIn) fadeInParts.push(partStarts.length - 1);
			last = n;
			breath = !!syllables[i].breathAfter;
			i++;
		}
		const fadeOut = fadeOutParts.length > 0;
		const fadeIn = fadeInParts.length > 0;

		// フレーズの終わり: 次が無い・休符・語り・ブレス、または旋律側の隙間。
		// 促音の前は閉鎖（抜けではない）、`↓` で消える音は抜く声が無い。
		const next = i < count ? syllables[i] : null;
		const phraseEnd =
			sungHead &&
			syl.vowel !== "" &&
			!fadeOut &&
			(breath ||
				next === null ||
				next.kind === "rest" ||
				next.kind === "speak" ||
				(next.kind !== "stop" && gapSec(last, sorted[i]) >= PHRASE_GAP_SEC));

		// 結合後の全長 = 先頭の開始から最終区間の（ゲート適用済み）終端まで。
		let durationSec =
			(last.startStep - head.startStep) * secondsPerStep + gatedSec(last);
		let breathGapSec = 0;
		if (breath) {
			const cut = Math.max(
				durationSec * (1 - BREATH_MAX_RATIO),
				durationSec - BREATH_SEC,
			);
			breathGapSec = durationSec - cut;
			durationSec = cut;
		}

		// 中継点は「同じ向きの記号が2つ以上」のときだけ。スウェル（`↑` と `↓` の
		// 併記）は中央で最大という別の形なので、従来どおり刻まない。
		const fadeCurve =
			fadeOut && fadeIn
				? undefined
				: fadeOutParts.length > 1
					? buildFadeCurve(fadeOutParts, partStarts, durationSec, false)
					: fadeInParts.length > 1
						? buildFadeCurve(fadeInParts, partStarts, durationSec, true)
						: undefined;

		out.push({
			syllable: syl,
			pitch: pitchOf(head),
			startSec: startSecOf(head),
			durationSec,
			...(segments.length ? { pitchSegments: segments } : {}),
			...(continuation ? { continuation: true } : {}),
			...(breath ? { breath: true, breathGapSec } : {}),
			...(phraseStart ? { phraseStart: true } : {}),
			...(phraseEnd ? { phraseEnd: true } : {}),
			...(fadeOut ? { fadeOut: true } : {}),
			...(fadeIn ? { fadeIn: true } : {}),
			...(fadeCurve ? { fadeCurve } : {}),
		});
	}
	return out;
};

/** ストリーミング再生する歌詞トラック1本。 */
export type StreamVoiceTrack = {
	/**
	 * 呼び出し側がソロ/ミュート判定に使う識別子（演奏トラックの config.id 等）。
	 * {@link StreamPlaybackOptions.isAudible} で参照する。省略時は常に可聴。
	 */
	id?: string;
	/** 歌唱モデル名（koe音源キーワード or "klatt"）。 */
	model: string;
	/** 最終ゲイン（声量×マスタ等を適用済み。1=等倍）。 */
	volume: number;
	/** ステレオ定位 -1〜+1。 */
	pan: number;
	/**
	 * 自動ビブラート ON/OFF。ONでも全ノートには掛からず、{@link VIBRATO_MIN_SEC} 以上の
	 * ロングトーンにだけ自動適用される（短い音符は不自然になるため対象外）。
	 */
	vibrato?: boolean;
	/**
	 * マスタリバーブへのセンド量 0-1。既定0（マスタリバーブが掛からない）。
	 * マスタリバーブ自体のつまみ（残響の質・量）とは独立に、このトラックをどれだけ
	 * リバーブバスへ送るかを個別に決める。
	 */
	reverbSend?: number;
	/**
	 * マスタディレイへのセンド量 0-1。既定0（ディレイが掛からない）。マスタディレイ自体の
	 * つまみ（音価・掛かり具合）とは独立に、このトラックをどれだけディレイバスへ送るかを決める。
	 */
	delaySend?: number;
	/**
	 * フォルマント/ジェンダーファクター 0-1。既定0.5（無変化）。koe音源（Worldline）限定
	 * — klattフォールバックには効かない。0.5未満で低め/太め、0.5超で高め/細めに寄る。
	 */
	gender?: number;
	/**
	 * ブレシネス（息成分）0-1。既定0.5（無変化）。koe音源（Worldline）限定
	 * — klattフォールバックには効かない。
	 */
	breathiness?: number;
	/**
	 * テンション（張り/力強さ、"こぶし"寄り）0-1。既定0.5（無変化）。koe音源（Worldline）限定
	 * — klattフォールバックには効かない。
	 */
	tension?: number;
	/**
	 * オクターブユニゾン。各音節をもう1声、1オクターブ上/下（控えめな音量）で重ねて発音し、
	 * 声に厚み（下）または煌びやかさ（上）を足す。既定 "none"（重ねない）。
	 */
	octaveUnison?: OctaveUnisonMode;
	/** 発音順（startSec昇順）の歌唱ノート列。 */
	notes: StreamVoiceNote[];
};

/** {@link SingingVoices.startStream} の任意オプション。 */
export type StreamPlaybackOptions = {
	/**
	 * そのトラックを今この瞬間に発音してよいか（ソロ/ミュート判定）。
	 * 各ノートを合成・スケジュールする直前にライブで評価するため、再生中に
	 * ソロを切り替えると先読み地平（最大 {@link STREAM_LOOKAHEAD_SEC} 秒）以降のノートへ反映される。
	 * 既にスケジュール済みのノートは鳴り切る（楽器側のミュート挙動と同じ）。
	 * 省略時は全トラック可聴。
	 */
	isAudible?: (track: StreamVoiceTrack) => boolean;
	/**
	 * 合成が間に合わず発音をスキップ（ミュート）した際のコールバック。
	 * 引数には遅れたノート情報と遅延秒数が渡されます。
	 */
	onLateSkip?: (note: StreamVoiceNote, delay: number) => void;
	/**
	 * ノートの発音が実際にスケジュールされた瞬間に呼ばれる（合成完了後、AudioContext へ
	 * 予約する直前）。UI側で「今このトラックが鳴っている」を可視化する用途を想定。
	 * t0 は発音予定の AudioContext 絶対時刻。
	 */
	onScheduled?: (
		track: StreamVoiceTrack,
		note: StreamVoiceNote,
		t0: number,
	) => void;
	/** シームレスループ用の1周の長さ（秒）。指定時は曲末に達したら音節インデックスを先頭に戻し内部オフセットへ加算する */
	loopLengthSec?: number;
	/** ループ再開位置（秒）。省略時は 0 */
	loopStartSec?: number;
};

/**
 * 歌唱モデルをまとめて管理し、koeデモ式の「先読みストリーミング合成」で歌わせる高レベルヘルパ。
 *
 * 再生開始時に {@link startStream} を呼ぶと、各音を**全力で先回り合成**しながら、
 * 出来た音を AudioContext クロックの**絶対時刻へ即スケジュール**する。再生はオーディオスレッドが
 * 担うため、合成中にメインスレッドがもたついても同期ズレ・音切れが起きない。スロットルは掛けない。
 *
 * 典型的な使い方（呼び出し側＝シーケンサ）:
 *   await voices.loadModels(models);          // .koe をfetch（ローディング表示）
 *   await voices.warm(tracks);                // 先頭数音だけ先に合成（頭出しの貯金）
 *   seq.start(fromStep);                      // 楽器とUIはシーケンサ
 *   voices.startStream(tracks, seq.getStartTime()); // 歌声は同じアンカーで先読み合成
 */
export type SingingVoices = {
	/** 使用する歌唱モデル（.koe）をロードして完了を待つ。 */
	loadModels: (models: Iterable<string>) => Promise<void>;
	/**
	 * koe音源カタログへキーワード → .koe URL（または Blob）を追加・上書き登録する。
	 * カスタムボーカル（`@@key icon_url koe_url` / DawOptions.customVocals）の音源を
	 * 再生前に流し込むために使う。同一キーへ同じ値を再登録した場合はロード済み
	 * キャッシュを保ったまま無視する。省略可能（外部注入の実装が無くても動くように）。
	 */
	registerVoicebanks?: (banks: Record<string, string | Blob>) => void;
	/**
	 * 各トラック先頭の数音を先に合成してキャッシュへ積む（頭出しの貯金）。
	 * これで再生開始直後の密なフレーズでもアンダーランしにくくなる。count 既定 {@link PREWARM_NOTES}。
	 */
	warm: (
		tracks: StreamVoiceTrack[],
		count?: number,
		onProgress?: (done: number, total: number) => void,
	) => Promise<void>;
	/**
	 * 歌声のストリーミング再生を開始する。anchorTime は startSec=0 が鳴るべき
	 * AudioContextクロック秒（＝シーケンサの開始時刻と一致させること）。
	 * 即座に return し、合成は裏で先回り進行する。
	 */
	startStream: (
		tracks: StreamVoiceTrack[],
		anchorTime: number,
		opts?: StreamPlaybackOptions,
	) => void;
	/** 進行中のストリームを中断し、スケジュール済みの発音をすべて止める（停止・一時停止・シーク）。 */
	stopStream: () => void;
	/** ストリーム停止＋各モデルの内部状態を初期化する。 */
	reset: () => void;
	/**
	 * マスタ音量（0〜1のゲイン）をリアルタイムに反映する。
	 * 発音時にゲインを焼き込む方式だと再生中の音量変更が既にスケジュール済み・
	 * ストリーミング中の音符に効かないため、全モデル共通の GainNode を介して
	 * 常時ライブ反映できるようにする。
	 */
	setVolume: (gain: number) => void;
	/**
	 * 語り（`「…」`）の計画だけを行い、占める長さ（秒）を返す（ピアノロールの帯表示用）。
	 * 音源が未ロードならロードし、TTS アセットが未取得なら取得から始める（初回は重い）。
	 * klatt 等の語りに対応しないモデルや、計画できない本文では null。省略可能。
	 */
	planSpeech?: (
		model: string,
		text: string,
		options?: SpeechPlanDetailOptions,
	) => Promise<number | null>;
	/**
	 * 語りの計画だけを行い、長さとモーラ列（口パク・字幕送り用）を返す。
	 * {@link planSpeech} と同じ条件で null。省略可能。
	 */
	planSpeechDetail?: (
		model: string,
		text: string,
		options?: SpeechPlanDetailOptions,
	) => Promise<SpeechPlanInfo | null>;
	/** 計画済みの語りの長さ（秒）を同期で引く（描画ループ用。未計画なら undefined）。 */
	peekSpeechDurationSec?: (model: string, text: string) => number | undefined;
	/**
	 * 語りの基準ピッチ（units）。この行にノートを置くと音源の素の声の高さで話す。
	 * 音源がロード済みのときだけ返る（ロード前・klatt は undefined）。
	 */
	getSpeechReferenceUnits?: (model: string) => number | undefined;
	/**
	 * 読み上げに必要なもの（TTS アセット約 45MB と、指定した音源のマニフェスト）を
	 * 先に取得する。ゲームのロード画面など、最初の一言で待たせたくない場面で呼ぶ。
	 * 進捗は TTS アセットの合算バイト数（Cache API 済みなら一瞬で total に達する）。
	 * 何度呼んでも二重取得はしない。
	 */
	prepareSpeech?: (
		models: Iterable<string>,
		options?: SpeechPrepareOptions,
	) => Promise<void>;
	/**
	 * 本文を指定した音源で読み上げる（MML を介さない単発の語り。セリフ・ナレーション用）。
	 * 音源が未ロードならロードし、TTS アセットが未取得なら取得から始める（初回は重い。
	 * {@link prepareSpeech} で先に済ませられる）。
	 * klatt 等の語りに対応しないモデル、未知のモデル、計画できない本文では null。
	 */
	speak?: (
		model: string,
		text: string,
		options?: SpeakOptions,
	) => Promise<SpeechHandle | null>;
};

/** {@link SingingVoices.prepareSpeech} のオプション。 */
export type SpeechPrepareOptions = {
	/** ダウンロード進捗（TTS アセット＋感情モデルの合算バイト数）。 */
	onProgress?: (loadedBytes: number, totalBytes: number) => void;
	/** 先取りしておく感情モデル（neutral は常に含まれるので書かなくてよい）。 */
	emotions?: Iterable<SpeechEmotion>;
};

/** {@link SingingVoices.speak} のオプション。 */
export type SpeakOptions = SpeakVoiceOptions & {
	/**
	 * 話す高さ。音源の素の声（収録ピッチ）からの半音オフセット。既定 0。
	 * ±24 を超えると声にならないので、その範囲で丸める。
	 */
	pitchOffset?: number;
};

/** {@link SingingVoices.warm} の既定先合成数（各トラック先頭からの音数）。 */
export const PREWARM_NOTES = 3;

/**
 * ストリーミング合成の先読み上限（秒）。再生ヘッドからこの秒数より先のノートは、
 * ヘッドが近づくまで合成しない。これにより「再生直後に全曲ぶんを一気に合成」して
 * メインスレッドを長時間占有する（→ 楽器スケジューラが枯渇してもたつく）のを防ぎ、
 * 合成負荷を曲全体へ平準化する。小さすぎると密なフレーズでアンダーランしやすくなる。
 */
const STREAM_LOOKAHEAD_SEC = 1.5;

/** 先読み上限に達したときの再ポーリング間隔（ミリ秒）。 */
const STREAM_POLL_MS = 100;

/**
 * オクターブユニゾンで重ねる声の音量係数。原音より控えめにして「重ねてる」感を
 * 出しつつ、原音を喰わないようにする。
 */
const OCTAVE_UNISON_PEAK_SCALE = 0.6;

/**
 * オクターブユニゾンで重ねる声のピッチ差。単位は units（1/372オクターブ）。
 * 1オクターブ = 372 units。半音の12ではないので注意（半音の値を足すと
 * 0.4半音ほどずれた不協和な重ねになる）。
 */
const octaveUnisonOffsets = (mode: OctaveUnisonMode | undefined): number[] => {
	const OCT = 372;
	switch (mode) {
		case "down":
			return [-OCT];
		case "up":
			return [OCT];
		case "both":
			return [-OCT, OCT];
		default:
			return [];
	}
};

export type SingingVoicesOptions = {
	/** 追加・上書きするkoe音源カタログ（キーワード → .koe URL または Blob） */
	voicebanks?: Record<string, string | Blob>;
	/** worldline.js のURL（{@link createKoeVoice} に渡す） */
	worldlineScriptUrl?: string;
	/** koe音源を軽量モード（素片ピッチシフト）で鳴らす */
	lightweight?: boolean;
	/**
	 * 歌声合成Worker（`voice-worker.js`）のURL。指定すると重いWORLD再合成を
	 * 別スレッドで実行し、メインスレッド（楽器・UI）を一切ブロックしない（モバイル推奨）。
	 * 省略時は従来どおりメインスレッドで合成する。
	 */
	voiceWorkerUrl?: string;
	/**
	 * マスタリバーブのバス（センド先）。指定すると、各歌詞トラックの `reverb`（`r`トークン）
	 * に応じて klatt/koe いずれの音源もこのノードへセンドできるようになる。未指定なら
	 * トラック側で `r` を指定してもリバーブは掛からない（studio.ts がマスタの
	 * Convolver 入力を渡す想定）。
	 */
	reverbBus?: AudioNode;
	/**
	 * マスタディレイのバス（センド先）。指定すると、各歌詞トラックの `delay`（`e`トークン）
	 * に応じて klatt/koe いずれの音源もこのノードへセンドできるようになる。未指定なら
	 * トラック側で `e` を指定してもディレイは掛からない。
	 */
	delayBus?: AudioNode;
	/**
	 * トラックID → チャンネルストリップ入口ノードの解決関数。指定すると、各トラックの
	 * 発音は共有の `destination`（singingVoices内部マスタ）へ直結する代わりに、この
	 * 関数が返すノードへ流れる（コンプレッサー/ステレオワイドを個別に掛けるため）。
	 * 未指定または戻り値が undefined のトラックは共有の `destination` へそのまま流れる。
	 */
	getTrackDestination?: (trackId: string) => AudioNode | undefined;
	/**
	 * 語り（`「…」`）用の TTS アセットのベース URL（{@link createKoeVoice} に渡す）。
	 * 省略時は koe のデモと同じ GitHub Pages のホスト（{@link DEFAULT_TTS_BASE_URL}）。
	 */
	ttsBaseUrl?: string;
};

/** 内蔵フォルマント合成のモデル名（koe音源が見つからないときのフォールバック先） */
const FALLBACK_MODEL = "klatt";

/**
 * klatt と koe音源を一括で扱う {@link SingingVoices} を生成する。
 */
export const createSingingVoices = (
	ctx: AudioContext,
	destination: AudioNode,
	options: SingingVoicesOptions = {},
): SingingVoices => {
	// 既定カタログ（キーワード→フルURL）に利用側のカタログを重ねる
	const catalog: Record<string, string | Blob> = {};
	for (const [k, file] of Object.entries(KOE_VOICEBANKS))
		catalog[k] = koeUrl(file);
	for (const [k, v] of Object.entries(options.voicebanks ?? {}))
		catalog[k.toLowerCase()] = v;

	// 進行中のストリームを世代番号で識別する。stopStream() でインクリメントして
	// 走行中の合成ループを中断（停止・一時停止・別曲への切り替え）させる。
	let streamSession = 0;

	// 全モデル共通のマスタ音量ゲイン。setVolume で常時ライブに変更できる。
	// getTrackDestination 未指定時（destinationへ直結する notes）のフォールバック経路。
	const masterGain = ctx.createGain();
	masterGain.connect(destination);
	// トラック単位チャンネルストリップへ直接ルーティングするノート（getTrackDestination
	// が返す宛先を使うもの）は上の masterGain を経由しない（トラックを跨いで音が
	// 合流してしまうため）。その代わり、スケジュール時点の peak にこの係数を掛けて
	// 同じマスタ音量効果を再現する。setVolume が更新するたび、以降スケジュールされる
	// ノートへ反映される（先読み秒数ぶんの遅延はあるが、実用上は十分ライブに追従する）。
	let masterVolumeScalar = 1;

	// スケジュール済みのブレス音。stopStream で一括停止する（音源のノートとは別管理）。
	const activeBreaths = new Set<AudioBufferSourceNode>();

	/**
	 * 音源の息継ぎ素片でブレスを鳴らす。素片の**尻**を次の音の頭（隙間の終わり +
	 * {@link BREATH_TAIL_SEC}）へ揃える。吸気は発声の直前が山なので、隙間より長い素片は
	 * 頭を切り、短い素片は隙間の途中から始める。
	 */
	const scheduleBreathSample = (
		buffer: AudioBuffer,
		t0: number,
		gapSec: number,
		peak: number,
		pan: number,
		destOverride?: AudioNode,
	): void => {
		const endAt = t0 + Math.max(BREATH_MIN_SEC, gapSec) + BREATH_TAIL_SEC;
		const slot = endAt - t0;
		const len = buffer.duration;
		// 素片の尻を endAt に揃える。隙間より長い素片は頭を切る。
		let playFrom = Math.max(0, len - slot);
		let startAt = endAt - (len - playFrom);
		const now = ctx.currentTime + 0.001;
		if (startAt < now) {
			playFrom += now - startAt;
			startAt = now;
		}
		if (endAt - startAt < 0.03) return; // もう間に合わない
		const top = Math.max(0.0001, peak * BREATH_SAMPLE_PEAK);
		const fadeIn = Math.min(BREATH_SAMPLE_FADE_IN_SEC, (endAt - startAt) / 2);
		const fadeOut = Math.min(BREATH_TAIL_SEC, (endAt - startAt) / 2);

		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, startAt);
		env.gain.exponentialRampToValueAtTime(top, startAt + fadeIn);
		env.gain.setValueAtTime(top, endAt - fadeOut);
		env.gain.exponentialRampToValueAtTime(0.0001, endAt);

		let out: AudioNode = destOverride ?? masterGain;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(out);
			out = panner;
		}
		src.connect(env).connect(out);
		src.start(startAt, playFrom);
		src.stop(endAt + 0.02);
		activeBreaths.add(src);
		src.onended = () => {
			activeBreaths.delete(src);
			src.disconnect();
			env.disconnect();
			panner?.disconnect();
		};
	};

	/**
	 * ブレス（`、`）をノイズで作る（音源に息継ぎ素片が無いときの経路）。
	 *
	 * UTAU音源の息継ぎ素片は存在するバンクとしないバンクがあり、内蔵カタログでは
	 * ロゼとルコ♀だけが持つ（テト単独音の .koe はエクストラ音声を含めずに変換されている）。
	 * 素片があればそちら（{@link scheduleBreathSample}）を使い、無いバンクではこの
	 * ノイズで「どの音源でも同じように効く表現」を保つ。
	 *
	 * 帯域フィルタで削った白色雑音は「風」に聞こえた。ここでは実物の息素片から測った
	 * スペクトル形（{@link BREATH_EQ_DB}: 声道の山谷）を FIR で掛け、包絡も実測の
	 * 二段の形（{@link BREATH_ENV}）にし、20〜45Hz の振幅の揺らぎ（吸気のザラつき）を
	 * 雑音側に焼き込む。実物との差は 1/3 オクターブ帯域の実効値で 5dB 程度（旧 6.6dB）。
	 */
	let breathImpulse: AudioBuffer | null = null;
	const scheduleBreath = (
		t0: number,
		gapSec: number,
		peak: number,
		pan: number,
		destOverride?: AudioNode,
	): void => {
		const dur = Math.max(BREATH_MIN_SEC, gapSec) + BREATH_TAIL_SEC;
		const startAt = Math.max(ctx.currentTime + 0.001, t0);
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		// 白色雑音 × 揺らぎ（20〜45Hz でランダムに 0.7〜1.3 倍）
		let flutter = 1;
		let nextAt = 0;
		for (let i = 0; i < length; i++) {
			if (i >= nextAt) {
				flutter = 0.7 + Math.random() * 0.6;
				nextAt = i + Math.floor(ctx.sampleRate / (20 + Math.random() * 25));
			}
			data[i] = (Math.random() * 2 - 1) * flutter;
		}

		if (!breathImpulse) {
			const h = buildBreathImpulse(ctx.sampleRate);
			breathImpulse = ctx.createBuffer(1, h.length, ctx.sampleRate);
			breathImpulse.copyToChannel(h, 0);
		}
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const shape = ctx.createConvolver();
		shape.normalize = false;
		shape.buffer = breathImpulse;

		// 包絡: 実測の形を隙間の長さへ伸ばし、頭と尻だけ短くフェードして 0 へ。
		const env = ctx.createGain();
		const points = 96;
		const curve = new Float32Array(points);
		const top = Math.max(0.0001, peak * BREATH_PEAK_SCALE);
		const last = BREATH_ENV.length - 1;
		for (let i = 0; i < points; i++) {
			const x = i / (points - 1);
			const xx = x * last;
			const j = Math.min(last - 1, Math.floor(xx));
			const e = BREATH_ENV[j] + (BREATH_ENV[j + 1] - BREATH_ENV[j]) * (xx - j);
			curve[i] = top * e * Math.min(1, x / 0.06, (1 - x) / 0.08);
		}
		env.gain.setValueAtTime(0, startAt);
		env.gain.setValueCurveAtTime(curve, startAt, dur);

		let out: AudioNode = destOverride ?? masterGain;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(out);
			out = panner;
		}
		src.connect(shape).connect(env).connect(out);
		src.start(startAt);
		// FIR の尾（2L+1 タップ）ぶんだけ長く鳴らして切れ目を作らない
		src.stop(startAt + dur + 0.02);
		activeBreaths.add(src);
		src.onended = () => {
			activeBreaths.delete(src);
			src.disconnect();
			shape.disconnect();
			env.disconnect();
			panner?.disconnect();
		};
	};

	const loaded = new Map<string, VoiceModel>([
		[
			FALLBACK_MODEL,
			createKlattVoice(ctx, masterGain, options.reverbBus, options.delayBus),
		],
	]);
	const loading = new Map<string, Promise<VoiceModel | null>>();

	const load = (model: string): Promise<VoiceModel | null> => {
		const m = model.toLowerCase();
		const ready = loaded.get(m);
		if (ready) return Promise.resolve(ready);
		const inflight = loading.get(m);
		if (inflight) return inflight;
		const koe = catalog[m];
		if (!koe) return Promise.resolve(null); // 未知モデル（sing側でklattへ）
		const p = (async () =>
			// URL文字列はそのまま渡す。koe側が VoiceBank.load 内で HTTP Range により
			// マニフェストだけ先読みし、音素PCMは歌う直前にオンデマンド取得する
			// （= 初回に .koe 全体をDLしない。モバイル初回ロードの待ちを解消）。
			// Blob/File が直接渡されたケース（ローカル読み込み）はそのまま BlobVoiceSource。
			createKoeVoice(ctx, masterGain, {
				koe,
				worldlineScriptUrl: options.worldlineScriptUrl,
				lightweight: options.lightweight,
				voiceWorkerUrl: options.voiceWorkerUrl,
				reverbBus: options.reverbBus,
				delayBus: options.delayBus,
				ttsBaseUrl: options.ttsBaseUrl,
			}))()
			.then((v) => {
				loaded.set(m, v);
				return v;
			})
			.catch((err) => {
				console.warn(`[dtm] koe音源 "${m}" の読み込みに失敗しました`, err);
				return null;
			});
		loading.set(m, p);
		return p;
	};

	const loadModels: SingingVoices["loadModels"] = async (models) => {
		const set = new Set<string>();
		for (const m of models) if (m) set.add(m.toLowerCase());
		await Promise.all([...set].map((m) => load(m)));
	};

	const registerVoicebanks: NonNullable<SingingVoices["registerVoicebanks"]> = (
		banks,
	) => {
		for (const [k, v] of Object.entries(banks)) {
			const key = k.toLowerCase();
			// klatt はフォールバック先なので上書き不可（loaded から消すと逃げ場がなくなる）
			if (key === FALLBACK_MODEL) continue;
			// 同じ音源の再登録は無視（ロード済みキャッシュ・進行中ロードを保つ）
			if (catalog[key] === v) continue;
			catalog[key] = v;
			// 差し替え時は旧音源のキャッシュを破棄し、次回 load で新URLから取得する
			loaded.delete(key);
			loading.delete(key);
		}
	};

	/** 1トラックを発音順に走査し、直前母音を伝播させながらコールバックする（promote/警告共通）。 */
	const forEachSungNote = (
		track: StreamVoiceTrack,
		fn: (note: StreamVoiceNote, prevVowel: string) => void,
	): void => {
		let prevVowel = "";
		for (const note of track.notes) {
			const syl = note.syllable;
			// 旋律側の休符明けも語頭（歌詞の `_` と同じ扱い）
			if (note.phraseStart) prevVowel = "";
			// 休符(_)は歌わないうえ、母音の文脈もここで切る（次は語頭 "- か" として歌う）
			if (syl.kind === "rest") {
				prevVowel = "";
				continue;
			}
			// 語り(「…」)は歌唱とは別経路で鳴らす。息が切れるので次は語頭になる。
			if (syl.kind === "speak") {
				fn(note, "");
				prevVowel = "";
				continue;
			}
			// 促音(っ)・無声は歌わない（合成対象外）。ただし直前母音は維持する
			if (syl.consonant === "Q" || syl.vowel === "") continue;
			fn(note, prevVowel);
			if (syl.vowel && syl.vowel !== "N") prevVowel = syl.vowel;
			// ブレス(、)を挟んだら息が切れる。次の音節も語頭として歌わせる
			if (note.breath) prevVowel = "";
		}
	};

	const warm: SingingVoices["warm"] = async (
		tracks,
		count = PREWARM_NOTES,
		onProgress,
	) => {
		const tasks: {
			model: VoiceModel;
			note: StreamVoiceNote;
			prevVowel: string;
			pitch: number;
			vibrato?: boolean;
			expr?: VoiceExpression;
			pitchSegments?: PitchSegment[];
			/** 語りの本文（語りのタスクだけ）。 */
			speak?: string;
		}[] = [];

		for (const track of tracks) {
			const m = loaded.get(track.model.toLowerCase());
			if (!m?.renderToCache) continue; // klatt等（軽量）は先合成不要
			// 息継ぎ素片は音源ごとに1度引けば足りる。最初のブレスがノイズへ落ちないよう先に取る。
			if (m.breathSample && track.notes.some((n) => n.breath)) {
				void m.breathSample(BREATH_SEC).catch(() => null);
			}
			let n = 0;
			const expr: VoiceExpression = {
				gender: track.gender,
				breathiness: track.breathiness,
				tension: track.tension,
			};
			forEachSungNote(track, (note, prevVowel) => {
				if (n >= count && note.startSec >= STREAM_LOOKAHEAD_SEC) return;
				n++;
				if (note.syllable.kind === "speak") {
					// 語りは計画（初回は TTS アセット取得を含む）と最初のチャンクまでをここで
					// 済ませる。全チャンクを待つと長文 1 つで再生開始が文まるごと遅れる
					// （koe のデモと同じく、残りは再生しながら届いた順に置く）。
					tasks.push({
						model: m,
						note,
						prevVowel: "",
						pitch: note.pitch,
						expr,
						speak: note.syllable.text ?? "",
					});
					return;
				}
				tasks.push({
					model: m,
					note,
					prevVowel,
					pitch: note.pitch,
					vibrato: track.vibrato,
					expr,
					pitchSegments: note.pitchSegments,
				});
				// オクターブユニゾン有効時は重ねる声も先読みしておく。
				// 継続のピッチ推移も同じだけ移調しないとキャッシュキーが一致しない。
				for (const offset of octaveUnisonOffsets(track.octaveUnison)) {
					tasks.push({
						model: m,
						note,
						prevVowel,
						pitch: note.pitch + offset,
						vibrato: track.vibrato,
						expr,
						pitchSegments: transposeSegments(note.pitchSegments, offset),
					});
				}
			});
		}

		const total = tasks.length;
		if (total === 0) {
			onProgress?.(0, 0);
			return;
		}

		let done = 0;
		onProgress?.(done, total);

		const promises = tasks.map(async (task) => {
			if (task.speak !== undefined) {
				await (task.model.speakToCache?.(
					task.speak,
					task.pitch,
					task.expr,
					"first-chunk",
				) ?? Promise.resolve(null));
			} else {
				await (task.model.renderToCache?.(
					task.note.syllable,
					task.prevVowel,
					task.pitch,
					task.note.durationSec * 1000,
					task.vibrato,
					task.expr,
					task.pitchSegments,
				) ?? Promise.resolve(null));
			}
			done++;
			onProgress?.(done, total);
		});

		await Promise.all(promises);
	};

	const startStream: SingingVoices["startStream"] = (
		tracks,
		anchorTime,
		opts,
	) => {
		const session = ++streamSession;

		// 1トラック＝1本の独立した先読み合成ループ。トラックごとに別モデル（＝別ワーカー）
		// なので、トラックループを同時起動すると合成がトラック数ぶん並列に走る。
		// （旧実装は全トラックを1列に平坦化して直列 await していたため、ワーカーが
		//  複数あっても常に1つしか動かず、同時発声でスループットが頭打ちだった。）
		const runTrack = async (track: StreamVoiceTrack): Promise<void> => {
			const model = loaded.get(track.model.toLowerCase());
			if (!model) return;

			// 直前母音を焼き込んだ発音順のノート列（促音・無声は除外済み）。
			const items: { note: StreamVoiceNote; prevVowel: string }[] = [];
			forEachSungNote(track, (note, prevVowel) => {
				items.push({ note, prevVowel });
			});
			if (items.length === 0) return;

			const peak = Math.max(0.0001, track.volume);
			const loopStartSec = opts?.loopStartSec ?? 0;
			let loopOffsetSec = 0;
			let pass = 0;

			do {
				for (const { note, prevVowel } of items) {
					if (session !== streamSession) return; // 中断
					if (pass > 0 && note.startSec < loopStartSec - 0.0001) {
						continue;
					}
					if (
						opts?.loopLengthSec &&
						opts.loopLengthSec > 0 &&
						note.startSec >= loopStartSec + opts.loopLengthSec - 0.0001
					) {
						continue;
					}
					const startSec = note.startSec + loopOffsetSec;
					// 先読み上限を超えていれば、再生ヘッドが近づくまで待つ（合成を曲全体へ分散）。
					// elapsed = ctx.currentTime - anchorTime が現在の再生位置（秒）。
					// 継続記号で結合された長い1音は合成にその分だけ時間が掛かるため、
					// 音価に応じて地平を前倒しして合成の猶予を確保する。
					const lookahead =
						STREAM_LOOKAHEAD_SEC +
						Math.min(TIE_MERGE_MAX_SEC, note.durationSec) * 0.4;
					while (startSec - (ctx.currentTime - anchorTime) > lookahead) {
						await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
						if (session !== streamSession) return;
					}
					// ソロ/ミュートをライブ判定。地平到達時点で対象外なら合成もスケジュールもしない。
					if (opts?.isAudible && !opts.isAudible(track)) continue;
					const t0 = anchorTime + startSec;

					// 語り（「…」）: 計画が出来しだい置き、チャンクは届いた順に同じ t0 基準で並ぶ。
					// オクターブユニゾンは重ねない（話し声を重ねても厚みにならない）。
					if (note.syllable.kind === "speak") {
						const text = note.syllable.text ?? "";
						if (text && model.speakToCache && model.scheduleSpeech) {
							const speakToCache = model.speakToCache;
							const scheduleSpeech = model.scheduleSpeech;
							const dest = options.getTrackDestination?.(track.id ?? "");
							const effPeak = dest ? peak * masterVolumeScalar : peak;
							void (async () => {
								const key = await speakToCache(text, note.pitch, {
									gender: track.gender,
									breathiness: track.breathiness,
									tension: track.tension,
								});
								if (session !== streamSession || !key) return;
								// 語りは途中からでも追いつけるので、1文まるごと落とす閾値は歌より緩い。
								const delay = ctx.currentTime - t0;
								if (delay < 1) {
									scheduleSpeech(
										key,
										t0,
										effPeak,
										track.pan,
										track.reverbSend,
										track.delaySend,
										dest,
									);
									opts?.onScheduled?.(
										track,
										{
											...note,
											durationSec:
												model.speechDurationSec?.(key) ?? note.durationSec,
										},
										t0,
									);
								} else {
									console.warn(
										`[dtm] Speech late skip: 「${text}」 at ${startSec}s (delayed by ${delay.toFixed(3)}s)`,
									);
									opts?.onLateSkip?.(note, delay);
								}
							})();
						}
						continue;
					}

					// 1音を指定ピッチ・音量係数で合成→スケジュールする。オクターブユニゾン有効時は
					// 同じ音節をもう1声（±12半音・控えめな音量）重ねるため、通常発声とは
					// 独立に呼び出せる関数へ切り出している。
					const dispatchNote = (
						offsetUnits: number,
						peakScale: number,
					): void => {
						const pitch = units(note.pitch + offsetUnits);
						// 継続のピッチ推移もユニゾンぶん移調する（推移だけ元のままだと
						// 途中から重ねた声が本来のオクターブへ戻ってしまう）。
						const pitchSegments = transposeSegments(
							note.pitchSegments,
							offsetUnits,
						);
						if (model.renderToCache && model.scheduleCached) {
							const renderToCache = model.renderToCache;
							const scheduleCached = model.scheduleCached;
							// koe音源: 重い合成を await せずに非同期で走らせる。
							// これにより、同じ先読み範囲にある後続の音符の合成リクエストも同時に Worker へ送信され、
							// 特に和音などの同時発音における合成の遅延（スループットの頭打ち）を防ぐ。
							void (async () => {
								const key = await renderToCache(
									note.syllable,
									prevVowel,
									pitch,
									note.durationSec * 1000,
									track.vibrato,
									{
										gender: track.gender,
										breathiness: track.breathiness,
										tension: track.tension,
									},
									pitchSegments,
								);
								if (session !== streamSession) return;
								if (key) {
									// 予定時刻より50ms以上遅れて合成完了した場合は発音をスキップ（ミュート）して音ズレを防ぐ
									const delay = ctx.currentTime - t0;
									if (delay < 0.05) {
										const dest = options.getTrackDestination?.(track.id ?? "");
										// dest（チャンネルストリップ直結）は共有masterGainを経由しない
										// ため、マスタ音量係数をここで peak に掛けて再現する。
										const effPeak =
											(dest ? peak * masterVolumeScalar : peak) * peakScale;
										scheduleCached(
											key,
											t0,
											effPeak,
											track.pan,
											track.reverbSend,
											track.delaySend,
											dest,
											note.continuation,
											note.fadeOut,
											note.fadeIn,
											note.fadeCurve,
											note.durationSec,
										);
										opts?.onScheduled?.(track, note, t0);
									} else {
										console.warn(
											`[dtm] Synthesizer late skip: ${note.syllable.kana} at ${startSec}s (delayed by ${delay.toFixed(3)}s)`,
										);
										opts?.onLateSkip?.(note, delay);
									}
								}
							})();
						} else {
							// klatt等（軽量・状態なし）: 絶対未来時刻へ直接スケジュール。
							const when = t0 - ctx.currentTime;
							const dest = options.getTrackDestination?.(track.id ?? "");
							// dest（チャンネルストリップ直結）は共有masterGainを経由しないため、
							// マスタ音量係数をここで peak に掛けて再現する。
							const effPeak =
								(dest ? peak * masterVolumeScalar : peak) * peakScale;
							// デクレッシェンド（`↓`）は結合後のノート側に立っている。
							// klatt は音節を見て判断するので、ここで移し替える
							// （`↓` が継続記号の途中や末尾に付いていると、先頭音節には
							//  フラグが無い）。
							const klattSyllable =
								note.fadeOut || note.fadeIn
									? {
											...note.syllable,
											...(note.fadeOut ? { fadeOut: true } : {}),
											...(note.fadeIn ? { fadeIn: true } : {}),
										}
									: note.syllable;
							model(klattSyllable, {
								trackId: track.id ?? "",
								pitchUnits: pitch,
								velocity: 100,
								volume: effPeak,
								when,
								duration: note.durationSec,
								pan: track.pan,
								reverbSend: track.reverbSend,
								delaySend: track.delaySend,
								destination: dest,
								pitchSegments,
								fadeCurve: note.fadeCurve,
							});
							opts?.onScheduled?.(track, note, t0);
						}
					};

					dispatchNote(0, 1);
					for (const offset of octaveUnisonOffsets(track.octaveUnison)) {
						dispatchNote(offset, OCTAVE_UNISON_PEAK_SCALE);
					}
					// フレーズの終わりは音源の語尾素片（"a R"）で抜く。無い音源は従来どおり
					// ゲインのフェードで終わる。主声だけに付ける（ユニゾンの副声には付けない）。
					if (
						note.phraseEnd &&
						model.renderEndingToCache &&
						model.scheduleCached
					) {
						const renderEnding = model.renderEndingToCache;
						const scheduleCached = model.scheduleCached;
						// 継続で結合された音は最後の区間のピッチで抜く
						const endPitch = note.pitchSegments?.length
							? units(note.pitchSegments[note.pitchSegments.length - 1].pitch)
							: note.pitch;
						const tEnd = t0 + note.durationSec;
						void (async () => {
							const key = await renderEnding(note.syllable.vowel, endPitch, {
								gender: track.gender,
								breathiness: track.breathiness,
								tension: track.tension,
							});
							if (session !== streamSession || !key) return;
							if (ctx.currentTime > tEnd - 0.05) return; // 間に合わなければ付けない
							const dest = options.getTrackDestination?.(track.id ?? "");
							scheduleCached(
								key,
								tEnd,
								dest ? peak * masterVolumeScalar : peak,
								track.pan,
								track.reverbSend,
								track.delaySend,
								dest,
							);
						})();
					}
					// ブレス（、）。音源に息継ぎ素片があればそれを、無ければノイズを歌の直後へ差し込む。
					// 素片の取得は待たない（先読みの余裕内に届かなければノイズへ落とす）。
					if (note.breath) {
						const breathDest = options.getTrackDestination?.(track.id ?? "");
						const breathAt = t0 + note.durationSec;
						const gap = note.breathGapSec ?? BREATH_SEC;
						const breathPeak = breathDest ? peak * masterVolumeScalar : peak;
						const placeNoise = () =>
							scheduleBreath(breathAt, gap, breathPeak, track.pan, breathDest);
						const sample = model.breathSample?.(gap);
						if (!sample) placeNoise();
						else {
							sample
								.then((buf) => {
									if (session !== streamSession) return;
									if (buf && ctx.currentTime < breathAt - 0.01) {
										scheduleBreathSample(
											buf,
											breathAt,
											gap,
											breathPeak,
											track.pan,
											breathDest,
										);
									} else placeNoise();
								})
								.catch(placeNoise);
						}
					}
					// klatt等（軽量・状態なし）はawaitが無く同期で回るため、UI応答性のため1音ごとに制御を返す。
					if (!(model.renderToCache && model.scheduleCached)) {
						await new Promise((resolve) => setTimeout(resolve, 0));
					}
				}
				if (opts?.loopLengthSec && opts.loopLengthSec > 0) {
					loopOffsetSec += opts.loopLengthSec;
					pass++;
				} else {
					break;
				}
			} while (session === streamSession);
		};

		// 全トラックを同時に走らせる（待たない）。各ループが別ワーカーを並列に駆動する。
		for (const track of tracks) void runTrack(track);
	};

	const stopStream: SingingVoices["stopStream"] = () => {
		streamSession++; // 進行中の合成ループをキャンセル
		for (const v of loaded.values()) v.stopAll?.();
		for (const src of activeBreaths) {
			try {
				src.stop();
			} catch {}
			src.disconnect();
		}
		activeBreaths.clear();
	};

	const reset: SingingVoices["reset"] = () => {
		stopStream();
		for (const v of loaded.values()) v.reset?.();
	};

	const setVolume: SingingVoices["setVolume"] = (gain) => {
		const g = Math.max(0, gain);
		masterGain.gain.value = g;
		masterVolumeScalar = g;
	};

	const planSpeech: NonNullable<SingingVoices["planSpeech"]> = async (
		model,
		text,
		o,
	) => {
		const v = await load(model);
		return v?.planSpeech ? v.planSpeech(text, o) : null;
	};
	const planSpeechDetail: NonNullable<
		SingingVoices["planSpeechDetail"]
	> = async (model, text, o) => {
		const v = await load(model);
		return v?.planSpeechDetail ? v.planSpeechDetail(text, o) : null;
	};
	const peekSpeechDurationSec: NonNullable<
		SingingVoices["peekSpeechDurationSec"]
	> = (model, text) =>
		loaded.get(model.toLowerCase())?.peekSpeechDurationSec?.(text);
	const getSpeechReferenceUnits: NonNullable<
		SingingVoices["getSpeechReferenceUnits"]
	> = (model) => loaded.get(model.toLowerCase())?.speechReferenceUnits?.();

	const prepareSpeech: NonNullable<SingingVoices["prepareSpeech"]> = async (
		models,
		o = {},
	) => {
		// 計画器はページ共有。onProgress は 2 回目以降でも購読として足される。
		const planner = getSpeechPlanner({
			baseUrl: options.ttsBaseUrl,
			onProgress: o.onProgress,
		});
		const emotions = new Set<SpeechEmotion>(o.emotions ?? []);
		emotions.delete("neutral");
		await Promise.all([
			planner.ready(),
			loadModels(models),
			...[...emotions].map((e) => planner.prepareEmotion(e)),
		]);
	};

	/** 素の声からの半音オフセットの上限（{@link SpeakOptions.pitchOffset}）。 */
	const SPEAK_PITCH_OFFSET_MAX = 24;

	const speak: NonNullable<SingingVoices["speak"]> = async (
		model,
		text,
		o = {},
	) => {
		const v = await load(model);
		if (!v?.speak || o.signal?.aborted) return null;
		// 基準ピッチは音源ロード後でないと取れない（マニフェストの収録ピッチ）。
		// 取れなければ A3 相当（2139 - 372 = 1767 units）で話す。
		const reference = v.speechReferenceUnits?.() ?? 1767;
		const offset = Math.max(
			-SPEAK_PITCH_OFFSET_MAX,
			Math.min(SPEAK_PITCH_OFFSET_MAX, o.pitchOffset ?? 0),
		);
		const { pitchOffset: _omit, ...rest } = o;
		return v.speak(text, reference + offset * UNITS_PER_SEMITONE, rest);
	};

	return {
		loadModels,
		registerVoicebanks,
		warm,
		startStream,
		stopStream,
		reset,
		setVolume,
		planSpeech,
		planSpeechDetail,
		peekSpeechDurationSec,
		getSpeechReferenceUnits,
		prepareSpeech,
		speak,
	};
};

/** 歌唱合成モデルのレジストリ（プラグイン方式） */
export type VoiceRegistry = {
	/** 指定モデルで1音節を歌う。未登録モデルは fallback へ委譲する */
	sing: (model: string, syllable: LyricSyllable, e: PlayNoteEvent) => void;
	/** 歌唱合成モデルを登録する（拡張用） */
	register: (name: string, model: VoiceModel) => void;
};

/**
 * モデル名 → 合成実装のレジストリを生成する（プラグイン方式）。
 * 未登録のモデル名は fallback（既定 "klatt"）へ委譲する。
 */
export const createVoiceRegistry = (
	models: Record<string, VoiceModel> = {},
	fallback = "klatt",
): VoiceRegistry => {
	const sing = (
		model: string,
		syllable: LyricSyllable,
		e: PlayNoteEvent,
	): void => {
		const fn = models[model] ?? models[fallback];
		fn?.(syllable, e);
	};
	const register = (name: string, m: VoiceModel): void => {
		models[name.toLowerCase()] = m;
	};
	return { sing, register };
};
