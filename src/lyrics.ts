/**
 * MML歌詞拡張 — 解析・正規化・同期（ヘッドレス）と、任意の歌唱合成ヘルパ。
 *
 * 既存の演奏トラック（@n）とは独立した「歌詞専用行」(@@n) を扱う。
 *   @@<トラックID> <モデル名> <歌詞>
 *   例: `@@2 klatt どはどなつのど`
 *       `@@3 external_engine きょー`
 *
 * 区切りは半角スペース（引用符不要）。歌詞内のひらがな・カタカナ・長音記号(ー)以外は破棄する。
 *
 * 演奏データ（テンポ・休符・音符長）とは完全に分離されており、
 * Note On のタイミングで音節を1つずつ消費して歌わせる。
 *
 * このライブラリ自体は音を出さない方針のため、解析・同期（createLyricsConductor）と
 * オプトインのフォルマント合成ヘルパ（createKlattVoice / createVoiceRegistry）を分離して提供する。
 */

import { leadInFromEntry, VoiceBank, Worldline } from "@onjmin/koe";
import { DEFAULT_GATE, DEFAULT_PAN, DEFAULT_VOCAL_VOLUME } from "./types";
import type { LyricSyllable, LyricTrack, PlayNoteEvent } from "./types";
import type {
	VoiceWorkerInit,
	VoiceWorkerOutbound,
	VoiceWorkerRendered,
	VoiceWorkerRenderReq,
} from "./voice-worker-types";

export type { LyricSyllable, LyricTrack } from "./types";

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

/** 直前のかなと結合して1音節を成す「小さいかな」 */
const SMALL_KANA = "ぁぃぅぇぉゃゅょっ";

/** 母音文字（あ・い・う・え・お）。長音記号の置換先に使う */
const VOWEL_KANA: Record<string, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
};

/**
 * カタカナをひらがなへ寄せ、ひらがな・長音記号以外を破棄する。
 * 仕様: ひらがな／カタカナ／長音記号（ー）のみ抽出。
 */
const sanitizeText = (text: string): string =>
	text
		.normalize("NFKC")
		// カタカナ(ァ-ヶ)→ひらがなへ寄せる
		.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
		// ひらがな(ぁ-ゖ)と長音記号(ー)以外を破棄
		.replace(/[^ぁ-ゖー]/g, "");

/**
 * 文字列を音節単位へ分解する。
 * 小さいかな（ぁぃぅぇぉゃゅょっ）は直前の文字と結合して1音節にする。
 */
const splitSyllables = (text: string): string[] => {
	const result: string[] = [];
	for (const ch of text) {
		if (result.length > 0 && SMALL_KANA.includes(ch)) {
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

/** 音節文字列を子音・母音へ分解する。長音記号は呼び出し側で解決する */
const analyzeSyllable = (syllable: string): LyricSyllable => {
	if (syllable === "ー") return { kana: syllable, consonant: "-", vowel: "-" };
	if (syllable === "っ") return { kana: syllable, consonant: "Q", vowel: "" };

	const head = syllable[0];
	const row = kanaTable[head];
	const consonant = row ? row[0] : "";
	let vowel = row ? row[1] : kanaToVowel(head);

	// 拗音・小さい母音（2文字目）が母音を上書きする。促音(っ)は直前の母音を維持
	if (syllable.length === 2 && syllable[1] !== "っ") {
		const v = kanaToVowel(syllable[1]);
		if (v) vowel = v;
	}
	return { kana: syllable, consonant, vowel };
};

/**
 * 長音記号（ー）を直前の音節の母音かなへ置換する。
 * 例: きょ + ー → きょ + お
 */
const resolveLongVowels = (syllables: LyricSyllable[]): LyricSyllable[] => {
	const result: LyricSyllable[] = [];
	let prevVowel = "";
	for (const syl of syllables) {
		if (syl.consonant === "-") {
			// 直前の母音を引き継ぐ。先頭にある等で判定不能なら破棄
			if (!prevVowel) continue;
			result.push({
				kana: VOWEL_KANA[prevVowel] ?? syl.kana,
				consonant: "",
				vowel: prevVowel,
			});
			continue;
		}
		if (syl.vowel && syl.vowel !== "N") prevVowel = syl.vowel;
		result.push(syl);
	}
	return result;
};

/** 歌詞文字列（かな）を正規化済み音節列へ変換する */
export const normalizeLyrics = (text: string): LyricSyllable[] =>
	resolveLongVowels(splitSyllables(sanitizeText(text)).map(analyzeSyllable));

/**
 * 複数行に分かれた歌詞を1つの音節列へまとめ、改行位置を併せて返す。
 * lineBreaks には「直前に改行があった」音節のインデックスが入る（先頭行ぶんは含めない）。
 * 長音(ー)は行ごとに解決する（改行は自然なフレーズの切れ目なので前の母音は引き継がない）。
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

		const modelMatch = rest.match(
			/^([a-z_]+?)(?=(?:[vqpo]-?\d)|[^a-z_]|$)(?::(\d+))?/i,
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
	) => Promise<string | null>;
	/**
	 * {@link renderToCache} 済みのバッファを絶対時刻 t0（AudioContextクロック秒）へスケジュールする。
	 * t0 は未来の任意時刻でよく、再生はオーディオスレッドが担うのでメインスレッドのもたつきに影響されない。
	 */
	scheduleCached?: (key: string, t0: number, peak: number, pan: number) => void;
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
const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

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
): VoiceModel => {
	// スケジュール済みの音源ノード。stopAll（停止/一時停止）で一括停止する。
	const active = new Set<AudioScheduledSourceNode>();

	const voice: VoiceModel = (syllable, e) => {
		const t0 = ctx.currentTime + e.when;
		// 声量は等倍=1。100超(>1)はブーストとして上限なしで通す（クリップは利用側の判断）。
		const peak = Math.max(0.0001, e.volume);

		// 促音(っ)は無声。発音せず間（ま）として消費する
		if (syllable.vowel === "" || syllable.consonant === "Q") return;

		const [f1, f2] = FORMANTS[syllable.vowel] ?? FORMANTS.a;
		const attack = 0.02;
		const release = 0.06;
		const sustainEnd = t0 + Math.max(attack + 0.02, e.duration);

		// ステレオ定位。母音(env)と子音ノイズの両方をまとめて左右へ振る。
		// StereoPanner非対応の古い環境では destination へ直結（中央）にフォールバック。
		let panner: StereoPannerNode | null = null;
		let out: AudioNode = destination;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, e.pan ?? 0));
			panner.connect(destination);
			out = panner;
		}

		// 声門音源（倍音豊富なのこぎり波）
		const osc = ctx.createOscillator();
		osc.type = "sawtooth";
		osc.frequency.value = midiToFreq(e.pitch);

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
	roze: "束音ロゼver0.５1(多音階).koe",
	ruko_male: "欲音ルコ♂連続音Ver.1.03.koe",
	ruko_female: "欲音ルコ♀歌連続音普1.00.koe",
	teto: "重音テト単独音.koe",
	shiyo: "革命シヨ.koe",
};

/**
 * koe音源キーワード → UI表示名（日本語）。歌詞モデルのプルダウン等で使う。
 * MML中の値はキーワード（{@link KOE_VOICEBANKS} のキー）のまま、表示だけ和名にする。
 */
export const KOE_VOICEBANK_LABELS: Record<string, string> = {
	tsukuyomi: "つくよみちゃん",
	rino: "春音リノ",
	roze: "束音ロゼ",
	ruko_male: "欲音ルコ♂",
	ruko_female: "欲音ルコ♀",
	teto: "重音テト",
	shiyo: "革命シヨ",
};

/**
 * モデルキーワード → 内蔵キャラクター画像キー（voice-images.ts の VOICE_IMAGES キー）。
 * klatt合成は "puyuyu"、koe音源は音源名に対応する画像キーを返す。
 */
export const VOICE_IMAGE_KEY: Record<string, string> = {
	klatt: "puyuyu",
	tsukuyomi: "tsukuyomi",
	rino: "rino",
	roze: "roze",
	ruko_male: "ruko",
	ruko_female: "ruko",
	teto: "teto",
	shiyo: "shiyo",
};

/**
 * UTAU音源キーワード → 利用規約URL。
 */
export const KOE_VOICEBANK_TERMS: Record<string, string> = {
	tsukuyomi: "https://tyc.rei-yumesaki.net/material/utau/terms/",
	rino: "https://hatenakun1.github.io/halunelino/",
	roze: "https://tabaneroze.ninja-web.net/terms-of-use.html",
	ruko_male: "https://long-sleeper.net/index.php?id=22",
	ruko_female: "https://long-sleeper.net/index.php?id=22",
	teto: "https://kasaneteto.jp/guidelines/voice.html",
	shiyo: "https://kakumeisiyo.my.canva.site/dagkuyjwycs",
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

	const raw: string[] = [
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
	return null;
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

	const renderAlias = async (
		alias: string,
		pitch: number,
		durationMs: number,
	): Promise<BackendRender> => {
		const pcm = await getPcm(alias);
		if (!pcm || pcm.length === 0) return null;
		const entry = bank.manifest.phonemes[alias];
		const lead = leadInFromEntry(entry);
		const targetHz = midiToFreq(pitch);
		if (worldline) {
			const audio = worldline.renderNote({
				pcm,
				pitch: targetHz,
				durationMs,
				...lead,
			});
			if (audio) return { pcm: audio, preSec: lead.preMs / 1000, rate: 1 };
		}
		const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
		return {
			pcm: Float32Array.from(pcm),
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

	const keyOf = (alias: string, pitch: number, durationMs: number): string =>
		`${alias}|${pitch}|${Math.round(durationMs / 10) * 10}`;

	/** backend で合成 → AudioBuffer 化して renderCache へ積む。重複・同時要求はまとめる。 */
	const renderInto = (
		alias: string,
		pitch: number,
		durationMs: number,
	): Promise<RenderedNote | null> => {
		const key = keyOf(alias, pitch, durationMs);
		const existing = renderCache.get(key);
		if (existing !== undefined) return Promise.resolve(existing);
		const flying = inflight.get(key);
		if (flying) return flying;

		const p = (async () => {
			const out = await backend.renderAlias(alias, pitch, durationMs);
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

	const schedule = (
		r: RenderedNote,
		t0: number,
		peak: number,
		pan: number,
	): void => {
		// ステレオ定位（非対応環境では destination 直結）
		let out: AudioNode = destination;
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function") {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, pan));
			panner.connect(destination);
			out = panner;
		}

		const src = ctx.createBufferSource();
		src.buffer = r.audio;
		src.playbackRate.value = r.rate;

		// VCV連続音の長いプリ発声（〜300ms以上）を cap し、前のノートの母音と
		// 重なり過ぎないようにする。余剰分はバッファ先頭からスキップする。
		const effPre = Math.min(r.preSec, LEADCAP_S);
		const skipS = r.preSec - effPre;
		const startAt = Math.max(ctx.currentTime + 0.001, t0 - effPre);
		const playDurSec = r.audio.duration / r.rate - skipS;
		const endAt = startAt + playDurSec;

		// クリック防止のフェードと声量エンベロープ
		const attack = 0.01;
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
			e.pitch,
		);
		if (syllable.vowel && syllable.vowel !== "N") prevVowel = syllable.vowel;
		if (!alias) return;
		const t0 = ctx.currentTime + e.when;
		const peak = Math.max(0.0001, e.volume);
		const pan = e.pan ?? 0;
		const durationMs = Math.max(60, e.duration * 1000);
		void renderInto(alias, e.pitch, durationMs).then((r) => {
			if (r) schedule(r, t0, peak, pan);
		});
	};

	model.renderToCache = async (syllable, prevVowelArg, pitch, durationMs) => {
		if (syllable.consonant === "Q" || syllable.vowel === "") return null;
		const alias = resolveKoeAlias(
			backend.hasAlias,
			backend.pitchTokens,
			syllable,
			prevVowelArg,
			pitch,
		);
		if (!alias) return null;
		const dMs = Math.max(60, durationMs);
		const r = await renderInto(alias, pitch, dMs);
		return r ? keyOf(alias, pitch, dMs) : null;
	};

	model.scheduleCached = (key, t0, peak, pan) => {
		const r = renderCache.get(key);
		if (r) schedule(r, t0, peak, pan);
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
	/** MIDIノート番号 */
	pitch: number;
	/** アンカー（再生開始時刻）からの相対秒。実発音時刻 = anchorTime + startSec。 */
	startSec: number;
	/** ゲート適用済みの発音長（秒）。 */
	durationSec: number;
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

	const loaded = new Map<string, VoiceModel>([
		[FALLBACK_MODEL, createKlattVoice(ctx, destination)],
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
			createKoeVoice(ctx, destination, {
				koe,
				worldlineScriptUrl: options.worldlineScriptUrl,
				lightweight: options.lightweight,
				voiceWorkerUrl: options.voiceWorkerUrl,
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

	/** 1トラックを発音順に走査し、直前母音を伝播させながらコールバックする（promote/警告共通）。 */
	const forEachSungNote = (
		track: StreamVoiceTrack,
		fn: (note: StreamVoiceNote, prevVowel: string) => void,
	): void => {
		let prevVowel = "";
		for (const note of track.notes) {
			const syl = note.syllable;
			// 促音(っ)・無声は歌わない（合成対象外）。ただし直前母音は維持する
			if (syl.consonant === "Q" || syl.vowel === "") continue;
			fn(note, prevVowel);
			if (syl.vowel && syl.vowel !== "N") prevVowel = syl.vowel;
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
		}[] = [];

		for (const track of tracks) {
			const m = loaded.get(track.model.toLowerCase());
			if (!m?.renderToCache) continue; // klatt等（軽量）は先合成不要
			let n = 0;
			forEachSungNote(track, (note, prevVowel) => {
				if (n >= count && note.startSec >= STREAM_LOOKAHEAD_SEC) return;
				n++;
				tasks.push({ model: m, note, prevVowel });
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
				task.note.pitch,
				task.note.durationSec * 1000,
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

			const peak = Math.max(0.0001, track.volume);

			for (const { note, prevVowel } of items) {
				if (session !== streamSession) return; // 中断
				// 先読み上限を超えていれば、再生ヘッドが近づくまで待つ（合成を曲全体へ分散）。
				// elapsed = ctx.currentTime - anchorTime が現在の再生位置（秒）。
				while (
					note.startSec - (ctx.currentTime - anchorTime) >
					STREAM_LOOKAHEAD_SEC
				) {
					await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
					if (session !== streamSession) return;
				}
				// ソロ/ミュートをライブ判定。地平到達時点で対象外なら合成もスケジュールもしない。
				if (opts?.isAudible && !opts.isAudible(track)) continue;
				const t0 = anchorTime + note.startSec;

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
							note.pitch,
							note.durationSec * 1000,
						);
						if (session !== streamSession) return;
						if (key) {
							// 予定時刻より50ms以上遅れて合成完了した場合は発音をスキップ（ミュート）して音ズレを防ぐ
							const delay = ctx.currentTime - t0;
							if (delay < 0.05) {
								scheduleCached(key, t0, peak, track.pan);
							} else {
								console.warn(
									`[dtm] Synthesizer late skip: ${note.syllable.kana} at ${note.startSec}s (delayed by ${delay.toFixed(3)}s)`,
								);
								opts?.onLateSkip?.(note, delay);
							}
						}
					})();
				} else {
					// klatt等（軽量・状態なし）: 絶対未来時刻へ直接スケジュール。
					// await が無く同期で回るため、UI応答性のため1音ごとに制御を返す。
					const when = t0 - ctx.currentTime;
					model(note.syllable, {
						trackId: "",
						pitch: note.pitch,
						velocity: 100,
						volume: peak,
						when,
						duration: note.durationSec,
						pan: track.pan,
					});
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			}
		};

		// 全トラックを同時に走らせる（待たない）。各ループが別ワーカーを並列に駆動する。
		for (const track of tracks) void runTrack(track);
	};

	const stopStream: SingingVoices["stopStream"] = () => {
		streamSession++; // 進行中の合成ループをキャンセル
		for (const v of loaded.values()) v.stopAll?.();
	};

	const reset: SingingVoices["reset"] = () => {
		stopStream();
		for (const v of loaded.values()) v.reset?.();
	};

	return { loadModels, warm, startStream, stopStream, reset };
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
