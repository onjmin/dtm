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

/** 歌詞専用行か判定する（@@<数字> で始まる行） */
const LYRIC_LINE = /^@@(\d+)\s+(.*)$/;

/** MMLを物理行・`;`区切りでセグメントへ分割する */
const splitSegments = (mml: string): string[] =>
	mml
		.split(/[;\n\r]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

/**
 * MMLから全歌詞トラックを解析し、トラックIDをキーにした辞書を返す（プリスキャン）。
 * 同一IDが複数あれば後勝ち。
 */
export const parseLyrics = (mml: string): Map<number, LyricTrack> => {
	const tracks = new Map<number, LyricTrack>();
	for (const seg of splitSegments(mml)) {
		const m = seg.match(LYRIC_LINE);
		if (!m) continue;
		const trackId = Number.parseInt(m[1], 10);
		// "<モデル名[:声量]> <歌詞>" を先頭の空白で分離（歌詞内の空白は破棄されるので残余を結合）
		const rest = m[2].trim();
		const sp = rest.search(/\s/);
		const modelToken = sp === -1 ? rest : rest.slice(0, sp);
		const lyricText = sp === -1 ? "" : rest.slice(sp + 1);
		// モデル名に "klatt:80" のようにコロン区切りで声量(0-100)を付与できる
		const colon = modelToken.indexOf(":");
		const model = colon === -1 ? modelToken : modelToken.slice(0, colon);
		const parsedVol =
			colon === -1
				? Number.NaN
				: Number.parseInt(modelToken.slice(colon + 1), 10);
		const volume = Number.isFinite(parsedVol)
			? Math.min(100, Math.max(0, parsedVol))
			: 100;
		tracks.set(trackId, {
			trackId,
			model: model.toLowerCase(),
			volume,
			syllables: normalizeLyrics(lyricText),
		});
	}
	return tracks;
};

/**
 * 歌詞専用行を除去し、演奏トラックのみのMMLを返す。
 * parseMML が @@n を演奏ノートとして誤解釈しないよう前処理する。
 */
export const stripLyrics = (mml: string): string =>
	splitSegments(mml)
		.filter((seg) => !LYRIC_LINE.test(seg))
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
	 * 歌唱の声量係数 0-1（歌詞トラックの volume 0-100 を正規化したもの）。
	 * ノートのvelocityとは独立。利用側はこれにマスタ音量を掛けて発音音量とする。
	 */
	volume: number;
};

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
			volume: (track.volume ?? 100) / 100,
		};
	};

	const reset = (): void => pointers.clear();

	return { consume, reset };
};

// ─────────────────────────────────────────────────────────────
// 音声合成モデル（オプトイン。Web Audio を使う利用側／内蔵synthのためのヘルパ）
// ─────────────────────────────────────────────────────────────

/** 歌唱合成モデルの実装シグネチャ */
export type VoiceModel = (syllable: LyricSyllable, e: PlayNoteEvent) => void;

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
		const peak = Math.max(0.0001, Math.min(1, e.volume));

		// 促音(っ)は無声。発音せず間（ま）として消費する
		if (syllable.vowel === "" || syllable.consonant === "Q") return;

		const [f1, f2] = FORMANTS[syllable.vowel] ?? FORMANTS.a;
		const attack = 0.02;
		const release = 0.06;
		const sustainEnd = t0 + Math.max(attack + 0.02, e.duration);

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
		env.connect(destination);

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
			src.connect(hp).connect(ng).connect(destination);
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
		osc.onended = () => osc.disconnect();
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
