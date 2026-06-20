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
import type { LyricSyllable, LyricTrack, PlayNoteEvent } from "./types";

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
const LYRIC_LINE = /^@@(\d+)\s+(.*)$/;

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
		// 空白区切りトークンへ分解（歌詞内の空白は sanitize で破棄されるので後で結合する）
		const tokens = m[2].trim().split(/\s+/);
		const modelToken = tokens.shift() ?? "";

		let volume = 300; // 省略時の声量
		let gate = 100; // 省略時のゲート（レガート）
		let pan = 64; // 省略時の定位（中央）

		// 後方互換: "klatt:80" のコロン区切り声量
		const colon = modelToken.indexOf(":");
		const model = (
			colon === -1 ? modelToken : modelToken.slice(0, colon)
		).toLowerCase();
		if (colon !== -1) {
			const v = Number.parseInt(modelToken.slice(colon + 1), 10);
			if (Number.isFinite(v)) volume = clamp(v, 0, MAX_VOCAL_VOLUME);
		}

		// メタ部分（モデル名＋オプション）の原文。再生専用UIがグレーアウト表示に使う。
		const metaTokens = [modelToken];

		// モデル名直後の v<n>/q<n>/p<n> トークンを声量・ゲート・定位として消費する。
		// 歌詞はかな（非ASCII）なので v/q/p と衝突しない。
		while (tokens.length > 0) {
			const v = /^v(\d+)$/.exec(tokens[0]);
			const q = /^q(\d+)$/.exec(tokens[0]);
			const p = /^p(\d+)$/.exec(tokens[0]);
			if (v) {
				volume = clamp(Number.parseInt(v[1], 10), 0, MAX_VOCAL_VOLUME);
			} else if (q) {
				gate = clamp(Number.parseInt(q[1], 10), 0, 100);
			} else if (p) {
				pan = clamp(Number.parseInt(p[1], 10), 0, 127);
			} else {
				break;
			}
			metaTokens.push(tokens.shift() as string);
		}

		// 先頭行の残り＋改行で続く継続行を1つの歌詞として扱う。
		// 継続行は新しい文（@… / #…）が現れるか、空行で途切れるまで歌詞の続きとみなす。
		const lyricLines = [tokens.join(" ")];
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
			volume: vocalVolumeToGain(track.volume ?? 300),
			gate: (track.gate ?? 100) / 100,
			pan: panToStereo(track.pan ?? 64),
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
	(syllable: LyricSyllable, e: PlayNoteEvent): void;
	reset?: () => void;
	preloadRender?: (
		syllables: LyricSyllable[],
		notes: { pitch: number; duration: number }[],
	) => Promise<void>;
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
	return (syllable, e) => {
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
			src.onended = () => {
				src.disconnect();
				hp.disconnect();
				ng.disconnect();
			};
		}

		osc.start(t0);
		osc.stop(sustainEnd + release + 0.02);
		osc.onended = () => {
			osc.disconnect();
			panner?.disconnect();
		};
	};
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
	ruko: "欲音ルコ♀歌連続音普1.00.koe",
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
	ruko: "欲音ルコ",
	teto: "重音テト",
	shiyo: "革命シヨ",
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

/**
 * 音節（子音・母音・かな）と直前母音から、音源マニフェストに実在する音素エイリアスを解決する。
 * 単独音（"か"）・連続音（"a か" / "- か"）・ローマ字命名（"ka"）など幅広い命名を順に試す。
 * 見つからなければ母音単独へフォールバックし、それも無ければ null。
 */
const resolveKoeAlias = (
	bank: VoiceBank,
	syl: LyricSyllable,
	prevVowel: string,
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
	for (const c of raw) {
		for (const v of expandSeparators(c)) {
			if (seen.has(v)) continue;
			seen.add(v);
			if (bank.has(v)) return v;
		}
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
};

type RenderedNote = {
	audio: Float32Array;
	/** 母音オンセット（拍頭）までの先行秒。バッファをこの分だけ前から鳴らす */
	preSec: number;
	/** 再生レート（Worldline使用時は1、素片フォールバック時はピッチ比） */
	rate: number;
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
	const bank = await VoiceBank.load(options.koe);
	const worldline = options.lightweight
		? null
		: await Worldline.load({
				scriptUrl: options.worldlineScriptUrl ?? DEFAULT_WORLDLINE_SCRIPT,
			}).catch(() => null); // WASM不可なら素片フォールバックで動かす

	// 音素PCM（fetch）と再合成結果のキャッシュ。同じ音素・ピッチ・音価の再演を高速化する。
	const pcmCache = new Map<string, Promise<Float64Array | null>>();
	const getPcm = (alias: string): Promise<Float64Array | null> => {
		let p = pcmCache.get(alias);
		if (!p) {
			p = bank.getPcm(alias);
			pcmCache.set(alias, p);
		}
		return p;
	};
	const renderCache = new Map<string, RenderedNote | null>();

	let prevVowel = "";

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

		const buf = ctx.createBuffer(1, r.audio.length, KOE_SAMPLE_RATE);
		buf.copyToChannel(r.audio, 0);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.playbackRate.value = r.rate;

		// 拍頭 t0 に母音オンセットが来るよう、先行（子音・前うち）ぶん前から鳴らす
		const startAt = Math.max(ctx.currentTime + 0.001, t0 - r.preSec);
		const bufDurSec = r.audio.length / KOE_SAMPLE_RATE / r.rate;
		const endAt = startAt + bufDurSec;

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
		src.start(startAt);
		src.stop(endAt + 0.02);
		src.onended = () => {
			src.disconnect();
			env.disconnect();
			panner?.disconnect();
		};
	};

	const model: VoiceModel = (syllable, e) => {
		// 促音(っ)・無声は発音せず間として消費する
		if (syllable.consonant === "Q" || syllable.vowel === "") return;

		const alias = resolveKoeAlias(bank, syllable, prevVowel);
		if (syllable.vowel && syllable.vowel !== "N") prevVowel = syllable.vowel;
		if (!alias) return; // 音源に該当音素が無ければ無音

		const t0 = ctx.currentTime + e.when;
		// 声量は等倍=1。100超(>1)はブーストとして上限なしで通す（クリップは利用側の判断）。
		const peak = Math.max(0.0001, e.volume);
		const pan = e.pan ?? 0;
		const targetHz = midiToFreq(e.pitch);
		const durationMs = Math.max(60, e.duration * 1000);
		const key = `${alias}|${e.pitch}|${Math.round(durationMs)}`;

		const cached = renderCache.get(key);
		if (cached !== undefined) {
			if (cached) schedule(cached, t0, peak, pan);
			return;
		}

		void getPcm(alias).then((pcm) => {
			if (!pcm || pcm.length === 0) {
				renderCache.set(key, null);
				return;
			}
			const entry = bank.manifest.phonemes[alias];
			const lead = leadInFromEntry(entry);

			let rendered: RenderedNote | null = null;
			if (worldline) {
				const audio = worldline.renderNote({
					pcm,
					pitch: targetHz,
					durationMs,
					...lead,
				});
				if (audio) rendered = { audio, preSec: lead.preMs / 1000, rate: 1 };
			}
			if (!rendered) {
				// Worldline不可（WASM未ロード or 素片が短すぎる）→ 素片をピッチシフト再生
				const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
				rendered = {
					audio: Float32Array.from(pcm),
					preSec: entry.pre / KOE_SAMPLE_RATE / rate,
					rate,
				};
			}

			renderCache.set(key, rendered);
			schedule(rendered, t0, peak, pan);
		});
	};

	model.preloadRender = async (syllables, notes) => {
		let tempPrevVowel = "";
		const promises: Promise<void>[] = [];
		const count = Math.min(syllables.length, notes.length);

		for (let i = 0; i < count; i++) {
			const syllable = syllables[i];
			const note = notes[i];

			if (syllable.consonant === "Q" || syllable.vowel === "") {
				continue;
			}

			const alias = resolveKoeAlias(bank, syllable, tempPrevVowel);
			if (syllable.vowel && syllable.vowel !== "N") {
				tempPrevVowel = syllable.vowel;
			}
			if (!alias) continue;

			const targetHz = midiToFreq(note.pitch);
			const durationMs = Math.max(60, note.duration * 1000);
			const key = `${alias}|${note.pitch}|${Math.round(durationMs)}`;

			if (renderCache.has(key)) {
				continue;
			}

			const p = (async () => {
				try {
					const pcm = await getPcm(alias);
					if (!pcm || pcm.length === 0) {
						renderCache.set(key, null);
						return;
					}
					const entry = bank.manifest.phonemes[alias];
					const lead = leadInFromEntry(entry);

					let rendered: RenderedNote | null = null;
					if (worldline) {
						const audio = worldline.renderNote({
							pcm,
							pitch: targetHz,
							durationMs,
							...lead,
						});
						if (audio) {
							rendered = { audio, preSec: lead.preMs / 1000, rate: 1 };
						}
					}
					if (!rendered) {
						const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
						rendered = {
							audio: Float32Array.from(pcm),
							preSec: entry.pre / KOE_SAMPLE_RATE / rate,
							rate,
						};
					}
					renderCache.set(key, rendered);
				} catch (err) {
					console.warn(`[dtm] preloadRender failed for ${key}`, err);
				}
			})();
			promises.push(p);
		}

		await Promise.all(promises);
	};

	model.reset = () => {
		prevVowel = "";
	};

	return model;
};

/**
 * 歌唱モデルをまとめて管理する高レベルヘルパ。
 *
 * "klatt"（内蔵フォルマント合成）は同期生成し、koe音源（{@link KOE_VOICEBANKS} の
 * キーワードや任意のURL/Blob）は要求時に非同期ロードする。ロードが終わるまでは無音、
 * 未知のモデル名は klatt へフォールバックする。
 *
 * 再生開始前に {@link SingingVoices.preload} で使用モデルを先読みしておくと、初回から歌える。
 */
export type SingingVoices = {
	/** 指定モデルで1音節を歌う。koe音源はロード完了までは無音、未知モデルは klatt */
	sing: (model: string, syllable: LyricSyllable, e: PlayNoteEvent) => void;
	/** 指定モデル群を事前ロードする（再生開始前に await すると初回から歌える） */
	preload: (
		models: Iterable<string>,
		trackSyllables?: {
			model: string;
			syllables: LyricSyllable[];
			notes?: { pitch: number; duration: number }[];
		}[],
	) => Promise<void>;
	/** 歌唱モデルの内部状態（直前母音など）を初期化する */
	reset: () => void;
};

export type SingingVoicesOptions = {
	/** 追加・上書きするkoe音源カタログ（キーワード → .koe URL または Blob） */
	voicebanks?: Record<string, string | Blob>;
	/** worldline.js のURL（{@link createKoeVoice} に渡す） */
	worldlineScriptUrl?: string;
	/** koe音源を軽量モード（素片ピッチシフト）で鳴らす */
	lightweight?: boolean;
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
		const p = (async () => {
			let source = koe;
			if (typeof source === "string") {
				const res = await fetch(source);
				if (!res.ok) {
					throw new Error(`fetch failed: ${res.statusText}`);
				}
				source = await res.blob();
			}
			return createKoeVoice(ctx, destination, {
				koe: source,
				worldlineScriptUrl: options.worldlineScriptUrl,
				lightweight: options.lightweight,
			});
		})()
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

	const sing: SingingVoices["sing"] = (model, syllable, e) => {
		const m = (model || FALLBACK_MODEL).toLowerCase();
		const v = loaded.get(m);
		if (v) {
			v(syllable, e);
			return;
		}
		// 未知モデルは klatt で歌う。koe音源ならロードを開始（完了までは無音）。
		if (!catalog[m]) {
			loaded.get(FALLBACK_MODEL)?.(syllable, e);
			return;
		}
		void load(m);
	};

	const preload: SingingVoices["preload"] = async (models, trackSyllables) => {
		const set = new Set<string>();
		for (const m of models) if (m) set.add(m.toLowerCase());

		// 1. 各モデルのロードを開始して完了を待つ（.koeファイル自体のロード）
		const loadedModels = new Map<string, VoiceModel | null>();
		await Promise.all(
			[...set].map(async (m) => {
				const v = await load(m);
				loadedModels.set(m, v);
			}),
		);

		// 2. trackSyllables が渡されている場合は、プリロード（音声合成キャッシュ）を実行する
		if (trackSyllables) {
			const promises: Promise<void>[] = [];
			for (const ts of trackSyllables) {
				const m = ts.model.toLowerCase();
				const v = loadedModels.get(m);
				if (!v) continue;

				if (ts.notes && typeof v.preloadRender === "function") {
					promises.push(v.preloadRender(ts.syllables, ts.notes));
				}
			}
			await Promise.all(promises);
		}
	};

	const reset = (): void => {
		for (const v of loaded.values()) {
			if (typeof v.reset === "function") v.reset();
		}
	};

	return { sing, preload, reset };
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
