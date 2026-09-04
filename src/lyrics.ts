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

import { leadInFromEntry, VoiceBank, Worldline } from "@onjmin/koe";
import type { PitchSegment } from "./pitch-curve";
import {
	PORTAMENTO_MS,
	pitchCurveFor,
	STEP_GLIDE_MS,
	segmentsCacheKey,
	transposeSegments,
} from "./pitch-curve";
import { type Units, units } from "./tuning";
import type {
	CustomVocalDef,
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
	VoiceWorkerRendered,
	VoiceWorkerRenderReq,
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
	ん: ["N", "N"],
};

/**
 * 直前のかなと結合して1音節を成す「小さいかな」（拗音・小さい母音）。
 * 促音「っ」は sanitizeText の時点で除去済みのためここには現れない。
 */
const SMALL_KANA = "ぁぃぅぇぉゃゅょ";

/** 母音文字（あ・い・う・え・お）。長音記号の置換先に使う */
const VOWEL_KANA: Record<string, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
};

/** 継続記号（階段）。直前の音を言い直さずに保ち、ピッチだけを切り替える。 */
export const TIE_MARK = "ー";
/** 継続記号（ポルタメント）。{@link TIE_MARK} と同じだが、ピッチを滑らかに繋ぐ。 */
export const PORTAMENTO_MARK = "〜";
/** 促音。ノートを消費し、無音の閉鎖として間を作る。 */
export const STOP_MARK = "っ";
/** 明示的な休符。ノートを消費するが歌わない（そのノートは無音になる）。 */
export const REST_MARK = "_";
/** ブレス。ノートは消費せず、直前ノートの尻を削って息継ぎを差し込む。 */
export const BREATH_MARK = "、";

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
		// カタカナ(ァ-ヶ)→ひらがなへ寄せる
		.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
		// 記号の異体字を正規形へ寄せる
		.replace(/~/g, PORTAMENTO_MARK)
		.replace(/,/g, BREATH_MARK)
		// ひらがな(ぁ-ゖ)と制御記号以外を破棄
		.replace(/[^ぁ-ゖー〜_、]/g, "");

/**
 * 文字列を音節単位へ分解する。
 * 小さいかな（ぁぃぅぇぉゃゅょ）は直前の文字と結合して1音節にする。
 * 制御記号（`ー` `〜` `_` `、`）は結合対象にせず、常に単独で切り出す。
 */
const splitSyllables = (text: string): string[] => {
	const MARKS = `${TIE_MARK}${PORTAMENTO_MARK}${REST_MARK}${BREATH_MARK}`;
	const result: string[] = [];
	for (const ch of text) {
		const prev = result[result.length - 1];
		if (
			prev !== undefined &&
			SMALL_KANA.includes(ch) &&
			!MARKS.includes(prev[prev.length - 1])
		) {
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
	return { kana: syllable, consonant, vowel };
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
 */
export const normalizeLyrics = (text: string): LyricSyllable[] => {
	const result: LyricSyllable[] = [];
	let prevVowel = "";
	for (const mark of splitSyllables(sanitizeText(text))) {
		if (mark === BREATH_MARK) {
			const last = result[result.length - 1];
			if (last) last.breathAfter = true;
			prevVowel = "";
			continue;
		}
		const syl = analyzeSyllable(mark);
		if (syl.kind === "tie") {
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
				: syl.kana;
	return syl.breathAfter ? head + BREATH_MARK : head;
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
	) => void;
	/** スケジュール済みの発音をすべて即停止する（停止・一時停止・シーク時）。 */
	stopAll?: () => void;
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

/** MIDIノート番号 → 周波数(Hz) */
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
		for (const seg of e.pitchSegments ?? []) {
			const hz = Math.max(1, unitsToFreq(seg.pitch));
			const glideS = (seg.portamento ? PORTAMENTO_MS : STEP_GLIDE_MS) / 1000;
			const from = Math.max(t0, t0 + Math.max(0, seg.atSec) - glideS / 2);
			osc.frequency.setValueAtTime(oscHz, from);
			osc.frequency.exponentialRampToValueAtTime(hz, from + glideS);
			oscHz = hz;
		}

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
		env.gain.setValueAtTime(0.0001, t0);
		env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
		env.gain.setValueAtTime(peak, sustainEnd);
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
	teto: "重音テト単独音.koe",
	shiyo: "革命シヨ.koe",
	rei: "足立レイver3.5.0.koe",
	mgroid: "MGRoid_原音設定済み.koe",
	motroid: "MOTRoid完全版V2.koe",
	nynroid: "NYNRoidver1.4.koe",
	uc: "蓄音キリコ （beta1.1）.koe",
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

/**
 * 音節（子音・母音・かな）と直前母音から、音源マニフェストに実在する音素エイリアスを解決する。
 * 単独音（"か"）・連続音（"a か" / "- か"）・ローマ字命名（"ka"）など幅広い命名を順に試す。
 *
 * 多音階バンク（全エイリアスが "_G4" 等のピッチ接尾辞付き、例: つくよみちゃん・束音ロゼ）では、
 * 各 base 候補に目標ノートへ最も近いピッチトークンを付与して照合する（koeデモと同等のロジック）。
 * pitchTokens が空（接尾辞なしバンク）なら bare 候補のみで解決する。
 *
 * 見つからなければ母音単独へフォールバックし、それも無ければ null。
 */
const resolveKoeAlias = (
	hasAlias: (alias: string) => boolean,
	pitchTokens: PitchToken[],
	syl: LyricSyllable,
	prevVowel: string,
	noteNum: number,
): string | null => {
	const kana = syl.kana;
	const cons = syl.consonant === "N" ? "n" : syl.consonant;
	const vow = syl.vowel === "N" ? "" : syl.vowel;
	const romaji = `${cons}${vow}` || vow;
	const pv = prevVowel || "-"; // 直前母音が無ければ語頭扱い

	// 継続（ー / 〜）は「言い直さない」音なので、子音つきの候補を一切引かない。
	// 同母音の連続音（"a あ"）→ 母音単体（"あ" / "a"）の順で、当たりの柔らかい素片を選ぶ。
	const raw: string[] =
		syl.kind === "tie"
			? [
					`${syl.vowel === "N" ? "n" : syl.vowel} ${kana}`,
					`${pv} ${kana}`,
					kana,
				]
			: [
					// 連続音（VCV）: 直前母音つき
					`${pv} ${kana}`,
					`${pv} ${romaji}`,
					// 単独音 / CVVC
					kana,
					romaji,
				];
	// 母音フォールバック
	const vk = VOWEL_KANA[syl.vowel];
	if (vk) raw.push(`${pv} ${vk}`, vk, syl.vowel);
	// 撥音(ん)
	if (syl.vowel === "N") raw.push("ん", "n", "N", `${pv} ん`);

	const seen = new Set<string>();
	const tryAlias = (candidate: string): string | null => {
		for (const v of expandSeparators(candidate)) {
			if (seen.has(v)) continue;
			seen.add(v);
			if (hasAlias(v)) return v;
		}
		return null;
	};

	// 多音階: 目標ノートに近いピッチ順で base に接尾辞を付けて試す（pitch優先・base副次）。
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

	// bare エイリアス（接尾辞なしバンク or 多音階で素のキーも持つバンク）
	for (const base of raw) {
		const hit = tryAlias(base);
		if (hit) return hit;
	}

	// 子音単体＋母音単体エイリアスの合成フォールバック（例: 音源に "ka" が無くても
	// "k" と "a" の単体データがあれば繋ぎ合わせて代用する）。多音階バンク（ピッチ接尾辞
	// 付き）は組み合わせ爆発を避けるため非対応、bareエイリアスのみで試す。
	if (cons && vow) {
		const vowelAlias = tryAlias(vow) ?? tryAlias(`${pv} ${vow}`);
		const consAlias = vowelAlias ? tryAlias(cons) : null;
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
	/** 破棄（Worker終了など）。 */
	dispose: () => void;
};

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
			pitch: pitchCurveFor(targetHz, pitchSegments, spliced.preMs, !!vibrato),
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
				pitch: pitchCurveFor(targetHz, pitchSegments, lead.preMs, !!vibrato),
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

	return {
		hasAlias: (a) => bank.has(a),
		pitchTokens: collectPitchTokens(Object.keys(bank.manifest.phonemes)),
		renderAlias,
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
	const pending = new Map<number, (m: VoiceWorkerRendered) => void>();
	let reqId = 0;
	let onReady: (() => void) | null = null;
	let onFail: ((e: Error) => void) | null = null;

	worker.onmessage = (ev: MessageEvent<VoiceWorkerOutbound>) => {
		const m = ev.data;
		if (m.type === "ready") {
			for (const a of m.aliases) aliasSet.add(a);
			onReady?.();
		} else if (m.type === "error") {
			onFail?.(new Error(m.message));
		} else if (m.type === "rendered") {
			const cb = pending.get(m.id);
			if (cb) {
				pending.delete(m.id);
				cb(m);
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

	return {
		hasAlias: (a) => aliasSet.has(a),
		pitchTokens: collectPitchTokens(aliasSet),
		renderAlias,
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
		const endAt = startAt + playDurSec;

		// クリック防止のフェードと声量エンベロープ。継続ノートは立ち上がりを
		// 被せ幅いっぱいまで伸ばし、アタック感（発音のたちあがり）を消す。
		const attack = continuation ? TIE_XFADE_S : 0.01;
		const release = 0.04;
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, startAt);
		env.gain.exponentialRampToValueAtTime(peak, startAt + attack);
		const fadeStart = Math.max(startAt + attack, endAt - release);
		env.gain.setValueAtTime(peak, fadeStart);
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
		const durationMs = Math.max(60, e.duration * 1000);
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
		const dMs = Math.max(60, durationMs);
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
	) => {
		const r = renderCache.get(key);
		if (r)
			schedule(r, t0, peak, pan, reverbSend, delaySend, dest, continuation);
	};

	model.stopAll = () => {
		for (const src of active) {
			try {
				src.stop();
			} catch {}
			src.disconnect();
		}
		active.clear();
	};

	model.reset = () => {
		prevVowel = "";
	};

	return model;
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

/** ブレス（`、`）で直前ノートから削る長さ（秒）。息そのものの長さも兼ねる。 */
const BREATH_SEC = 0.16;

/** ブレス音の音量（歌唱のピークに対する比）。歌を邪魔しない程度に控えめ。 */
const BREATH_PEAK_SCALE = 0.16;

/** ブレスで削ってよい直前ノートの割合の上限（短い音符を消してしまわないため）。 */
const BREATH_MAX_RATIO = 0.4;

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

	let i = 0;
	while (i < count) {
		const head = sorted[i];
		const syl = syllables[i];
		i++;
		if (head.startStep < fromStep) continue; // シークで切り落とされたノート

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
			segments.push({
				pitch: pitchOf(n),
				atSec: (n.startStep - head.startStep) * secondsPerStep,
				portamento: !!syllables[i].portamento,
			});
			last = n;
			breath = !!syllables[i].breathAfter;
			i++;
		}

		// 結合後の全長 = 先頭の開始から最終区間の（ゲート適用済み）終端まで。
		let durationSec =
			(last.startStep - head.startStep) * secondsPerStep + gatedSec(last);
		if (breath) {
			durationSec = Math.max(
				durationSec * (1 - BREATH_MAX_RATIO),
				durationSec - BREATH_SEC,
			);
		}

		out.push({
			syllable: syl,
			pitch: pitchOf(head),
			startSec: startSecOf(head),
			durationSec,
			...(segments.length ? { pitchSegments: segments } : {}),
			...(continuation ? { continuation: true } : {}),
			...(breath ? { breath: true } : {}),
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

/** `octaveUnison` から、原音に対して重ねる声のピッチオフセット（半音）の一覧を求める。 */
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
	 * ブレス（`、`）を鳴らす。音源の素片には頼らず、帯域を絞ったノイズで作る。
	 *
	 * UTAU音源の息継ぎ素片（`息` `br` 等）は存在するバンクとしないバンクがあり、
	 * エイリアス名も揃っていない。ブレスは「どの音源でも同じように効く表現」で
	 * あってほしいので、音源非依存のノイズで統一する。
	 */
	const scheduleBreath = (
		t0: number,
		peak: number,
		pan: number,
		destOverride?: AudioNode,
	): void => {
		const dur = BREATH_SEC;
		const startAt = Math.max(ctx.currentTime + 0.001, t0);
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

		const src = ctx.createBufferSource();
		src.buffer = buffer;
		// 息の帯域（子音のノイズより低く、広め）。ささやきに近い質感になる。
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 1400;
		bp.Q.value = 0.7;

		const env = ctx.createGain();
		// 吸う息は「すっ」と立ち上がって緩やかに引く。前半で山を作る。
		env.gain.setValueAtTime(0.0001, startAt);
		env.gain.exponentialRampToValueAtTime(
			Math.max(0.0001, peak * BREATH_PEAK_SCALE),
			startAt + dur * 0.35,
		);
		env.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);

		let out: AudioNode = destOverride ?? masterGain;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(out);
			out = panner;
		}
		src.connect(bp).connect(env).connect(out);
		src.start(startAt);
		src.stop(startAt + dur + 0.02);
		activeBreaths.add(src);
		src.onended = () => {
			activeBreaths.delete(src);
			src.disconnect();
			bp.disconnect();
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
			// 休符(_)は歌わないうえ、母音の文脈もここで切る（次は語頭 "- か" として歌う）
			if (syl.kind === "rest") {
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
		}[] = [];

		for (const track of tracks) {
			const m = loaded.get(track.model.toLowerCase());
			if (!m?.renderToCache) continue; // klatt等（軽量）は先合成不要
			let n = 0;
			const expr: VoiceExpression = {
				gender: track.gender,
				breathiness: track.breathiness,
				tension: track.tension,
			};
			forEachSungNote(track, (note, prevVowel) => {
				if (n >= count && note.startSec >= STREAM_LOOKAHEAD_SEC) return;
				n++;
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
			await (task.model.renderToCache?.(
				task.note.syllable,
				task.prevVowel,
				task.pitch,
				task.note.durationSec * 1000,
				task.vibrato,
				task.expr,
				task.pitchSegments,
			) ?? Promise.resolve(null));
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
							model(note.syllable, {
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
							});
							opts?.onScheduled?.(track, note, t0);
						}
					};

					dispatchNote(0, 1);
					for (const offset of octaveUnisonOffsets(track.octaveUnison)) {
						dispatchNote(offset, OCTAVE_UNISON_PEAK_SCALE);
					}
					// ブレス（、）は音源に依存しないノイズで作る。歌の直後へ差し込む。
					if (note.breath) {
						const breathDest = options.getTrackDestination?.(track.id ?? "");
						scheduleBreath(
							t0 + note.durationSec,
							breathDest ? peak * masterVolumeScalar : peak,
							track.pan,
							breathDest,
						);
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

	return {
		loadModels,
		registerVoicebanks,
		warm,
		startStream,
		stopStream,
		reset,
		setVolume,
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
