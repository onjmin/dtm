/**
 * UST（UTAU Sequence Text）入出力ユーティリティ。
 *
 * - 入力: `.ust` のテキストを解析し、ノート配置と歌詞（かな）を返す。
 *   USTは1ファイル＝1パートなので、ハモリ等で分かれた複数ファイルを
 *   それぞれ別トラックへ流し込む使い方を想定している。
 * - 出力: 1トラックぶんのノートと歌詞から `.ust` テキストを生成する。
 *
 * MIDIと違い、USTは**歌詞を持っている**のが取り込む価値の中心にある。
 * ノートだけならMIDIで足りるので、歌詞をこのアプリの歌詞表現
 * （かな＋制御記号。ノート1つにつき1音節）へ落とすことに注力する。
 *
 * 中国語音源のUST（原音名がピンイン）も、かなへ転写して取り込む。
 * 詳細は {@link looksLikePinyin} と `pinyin.ts`。
 */

import { pinyinToMoras } from "./pinyin";
import { unitsToMidiDetune } from "./tuning";
import { DEFAULT_VELOCITY, type Note } from "./types";

/** このアプリの内部ステップ解像度（4分音符あたり）。 */
const STEPS_PER_BEAT = 48;
/** USTの音価の解像度（4分音符あたり）。UTAUでは480固定。 */
export const UST_TICKS_PER_BEAT = 480;
/** UST tick → 内部ステップの倍率（480tick = 48step）。 */
const TICKS_TO_STEPS = STEPS_PER_BEAT / UST_TICKS_PER_BEAT;
/** 内部ステップ → UST tick の倍率。 */
const STEPS_TO_TICKS = UST_TICKS_PER_BEAT / STEPS_PER_BEAT;
/**
 * 1音節を複数モーラへ割るとき、尻のモーラに与える最大の長さ（16分音符ぶん）。
 * 全音符の `xing` で「ん」が2拍伸び続ける、といったことを防ぐ。
 */
const MORA_TAIL_MAX_STEPS = 12;

/** UTAUの「直前のノートの歌詞を続ける」記号。継続記号 `ー` と同じ意味。 */
const UST_CONTINUE_LYRICS = ["+", "+~", "+-", "+*", "*", "ー", "-"];

/** 継続記号（`lyrics.ts` の TIE_MARK と同じ文字）。 */
const TIE = "ー";
/** ポルタメント＝時間を掛けて隣の高さへ滑る（`lyrics.ts` の PORTAMENTO_MARK と同じ文字）。 */
const PORTAMENTO = "〜";
/** 明示的な休符＝ノートを消費するが歌わない（`lyrics.ts` の REST_MARK と同じ文字）。 */
const REST = "_";
/** ブレス＝ノートを消費せず、直前の音の尻へ息継ぎを差し込む（`lyrics.ts` の BREATH_MARK と同じ文字）。 */
const BREATH = "、";
/** デクレッシェンド＝ノートを消費せず、直前の音を歌いながら小さくする（`lyrics.ts` の FADE_OUT_MARK）。 */
const FADE_OUT = "↓";
/** クレッシェンド（`lyrics.ts` の FADE_IN_MARK と同じ文字）。 */
const FADE_IN = "↑";

/**
 * UTAUのブレス（息継ぎ）ノートの綴り。
 *
 * 音源ごとに流儀が違うが、実用上は次の2系統に収まる:
 * - 原音名にそのまま `息`（吐く）/ `吸`（吸う）を含むもの（`息R` `R吸` `e 息R` など）。
 *   この2字はかな歌詞に現れないので、どこに出てきてもブレスと見てよい。
 * - OpenUtau等が使う `@br` 系のエイリアス（`@br1` `@br2` …、`breath` と書く音源もある）。
 */
const UST_BREATH_KANJI_RE = /[息吸]/;
const UST_BREATH_ALIAS_RE = /^@?br(?:eath)?\d*$/i;

/**
 * UTAUの休符（ノートの時間は占めるが歌わない）の綴り。
 *
 * 素の `R` のほかに、多音階・声色を接尾辞で切り替える音源は休符にも同じ接尾辞を
 * 付ける（`RE` `R2` `R_D` …。連続音では `a RE` のように前置きも付く）。接尾辞ごと
 * 休符と見たいが、`re` `ra` `ro` はローマ字命名の「れ」「ら」「ろ」なので、
 * **大文字 `R` に小文字の母音が続く綴りだけ**は休符から外す。
 */
const UST_REST_RE = /^r(?:est)?$/i;
const UST_SUFFIXED_REST_RE = /^R(?![aiueo])\S*$/;

/** 原音名が休符か（接尾辞付きを含む）。 */
const isUstRest = (token: string): boolean =>
	UST_REST_RE.test(token) || UST_SUFFIXED_REST_RE.test(token);

// ============================================================
// ローマ字 → かな
// ============================================================

/**
 * UTAU音源は原音をローマ字で並べていることがある（`ka` `kya` など）。
 * このアプリの歌詞はかなで持つので、取り込み時にかなへ寄せる。
 *
 * 表は「子音＋母音」の規則から組み立て、綴り違い（`si`/`shi`、`ti`/`chi`、
 * `tu`/`tsu`、`hu`/`fu`、`zi`/`ji`）だけを後から足す。
 */
const ROMAJI_KANA: Record<string, string> = (() => {
	const map: Record<string, string> = {};
	const vowels = ["a", "i", "u", "e", "o"];
	// 清音・濁音・半濁音。`*` はその綴りのかなが無い位置（yi / wu など）。
	const rows: [string, string][] = [
		["", "あいうえお"],
		["k", "かきくけこ"],
		["s", "さしすせそ"],
		["t", "たちつてと"],
		["n", "なにぬねの"],
		["h", "はひふへほ"],
		["m", "まみむめも"],
		["y", "や*ゆ*よ"],
		["r", "らりるれろ"],
		["w", "わ***を"],
		["g", "がぎぐげご"],
		["z", "ざじずぜぞ"],
		["d", "だぢづでど"],
		["b", "ばびぶべぼ"],
		["p", "ぱぴぷぺぽ"],
	];
	for (const [consonant, kanas] of rows) {
		[...kanas].forEach((kana, i) => {
			if (kana === "*") return;
			map[`${consonant}${vowels[i]}`] = kana;
		});
	}
	// 拗音（い段＋小さいかな）。`sh` `ch` `j` はヘボン式の綴りをそのまま受ける。
	const smalls: [string, string][] = [
		["a", "ゃ"],
		["u", "ゅ"],
		["o", "ょ"],
	];
	const palatals: [string, string][] = [
		["ky", "き"],
		["sy", "し"],
		["sh", "し"],
		["ty", "ち"],
		["ch", "ち"],
		["ny", "に"],
		["hy", "ひ"],
		["my", "み"],
		["ry", "り"],
		["gy", "ぎ"],
		["zy", "じ"],
		["jy", "じ"],
		["j", "じ"],
		["dy", "ぢ"],
		["by", "び"],
		["py", "ぴ"],
	];
	for (const [romaji, kana] of palatals) {
		for (const [vowel, small] of smalls)
			map[`${romaji}${vowel}`] = `${kana}${small}`;
	}
	// 綴り違い・単独で成立する綴り
	Object.assign(map, {
		shi: "し",
		chi: "ち",
		tsu: "つ",
		fu: "ふ",
		ji: "じ",
		di: "ぢ",
		du: "づ",
		n: "ん",
		nn: "ん",
		cl: "っ",
		q: "っ",
	});
	return map;
})();

/** 歌詞として使えるかな（促音・撥音・小書きかな・長音記号を含む）。 */
const KANA_HEAD_RE = /^[ぁ-ゖァ-ヶー〜]+/;

/** 小書きかな（直前の文字と合わせて1モーラになる。`lyrics.ts` と同じ規則）。 */
const SMALL_KANA = "ぁぃぅぇぉゃゅょ";

/**
 * かな列をモーラ（＝このアプリの1音節＝ノート1つ）へ割る。
 * 拗音・小さい母音は直前の文字と合わせて1つに数える（`しゃ` `てぃ` で1モーラ）。
 */
const splitMoras = (kana: string): string[] => {
	const moras: string[] = [];
	for (const ch of kana) {
		const last = moras.length - 1;
		if (last >= 0 && SMALL_KANA.includes(ch)) moras[last] += ch;
		else moras.push(ch);
	}
	return moras;
};

/**
 * カタカナをひらがなへ寄せる。歌唱側（`normalizeLyrics`）もどちらでも読めるが、
 * 歌詞欄に両方が混ざると編集しづらいので、取り込んだ時点で片方へ揃える。
 */
const toHiragana = (text: string): string =>
	text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** {@link lyricToSyllable} の結果。 */
type ParsedLyric = {
	/**
	 * このアプリの歌詞へ写したモーラ列（＝必要なノート数）。休符・ブレスなら空。
	 * 日本語の原音名なら必ず1つだが、ピンインは1音節が2〜3モーラになる
	 * （`xing` → `["し", "ん"]`）。呼び出し側はノートを割って割り当てる。
	 */
	moras: string[];
	/** `Lyric=R` 等の休符か。 */
	rest: boolean;
	/** `息R` `R吸` `@br1` 等のブレスか。休符と同じくノートを作らない。 */
	breath: boolean;
	/** かなへ落とせなかったか（読み込み結果の注意書き用）。 */
	unknown: boolean;
};

/** 原音名から実体の綴りを取り出す（連続音・CVVCの前置きを落とす）。 */
const lyricToken = (trimmed: string): string =>
	trimmed.split(/\s+/).pop() ?? "";

/**
 * USTの `Lyric=` 1つを、このアプリの歌詞へ変換する。
 *
 * UTAUの原音名は音源ごとに流儀が違うので、実体のかなだけを掬う:
 * - 連続音 `a か` / `- か` … 空白区切りの**最後の語**が実体。
 * - サフィックス付き `かC4` `か強` … 先頭のかな列だけを採る。
 * - ローマ字命名 `ka` `kya` … {@link ROMAJI_KANA} でかなへ寄せる。
 * - ブレス `息R` `R吸` `@br1` … 歌詞ではなく息継ぎ（{@link UST_BREATH_KANJI_RE}）。
 * - 休符 `R` `RE` `a R2` … 歌わない（{@link isUstRest}）。接尾辞付きも休符。
 * - ピンイン `xing` `tou` … 中国語音源のとき（{@link looksLikePinyin}）だけ
 *   {@link pinyinToMoras} でかなへ寄せる。日本語ローマ字と綴りが衝突する
 *   （`wo` = を / ウオ）ため、ファイル単位で決めた結果を渡してもらう。
 *
 * 変換できない綴り（CVVCの `a k` のような子音だけの断片など）は継続記号にする。
 * 言い直さずに繋ぐのが元の意図に一番近く、音節とノートの1:1もずれない。
 */
export const lyricToSyllable = (raw: string, pinyin = false): ParsedLyric => {
	const trimmed = raw.trim();
	const none = {
		moras: [] as string[],
		rest: false,
		breath: false,
		unknown: false,
	};
	if (trimmed === "") return { ...none, rest: true };
	if (UST_CONTINUE_LYRICS.includes(trimmed)) return { ...none, moras: [TIE] };
	// ブレスは原音名のどこに `息` / `吸` が入っていても成立する（`e 息R` など）ので、
	// 最後の語を切り出す前に全体で見る。
	if (UST_BREATH_KANJI_RE.test(trimmed)) return { ...none, breath: true };
	const token = lyricToken(trimmed);
	if (UST_BREATH_ALIAS_RE.test(token)) return { ...none, breath: true };
	if (isUstRest(token)) return { ...none, rest: true };
	const kana = token.match(KANA_HEAD_RE)?.[0];
	if (kana) return { ...none, moras: splitMoras(toHiragana(kana)) };
	const romaji = token.match(/^[A-Za-z]+/)?.[0] ?? "";
	// 中国語音源では、日本語ローマ字としても読める綴り（`ni` `wo` `ta`）も
	// ピンインとして読む。ファイル全体で片方に決まっているべきものなので。
	if (pinyin) {
		const moras = pinyinToMoras(token);
		if (moras) return { ...none, moras };
	}
	const fromRomaji = ROMAJI_KANA[romaji] ?? ROMAJI_KANA[romaji.toLowerCase()];
	if (fromRomaji) return { ...none, moras: [fromRomaji] };
	return { ...none, moras: [TIE], unknown: true };
};

/**
 * このUSTが中国語ピンインで書かれているか、歌詞全体から決める。
 *
 * `ni` `ta` `ka` は日本語ローマ字とピンインの両方で成立し、`wo` に至っては
 * 読みが違う（を / ウオ）。トークン単位では決められないので、**ピンインでしか
 * 成立しない綴り**（`xing` `tou` `she` …）がローマ字歌詞の過半を占めるか、で見る。
 *
 * 日本語音源が持つ拡張かなの原音名（`she` `fa` など）はピンインとしても読めて
 * しまうため、数個の一致では倒れないように割合で判定する。
 */
export const looksLikePinyin = (lyrics: Iterable<string>): boolean => {
	let romaji = 0;
	let pinyinOnly = 0;
	for (const raw of lyrics) {
		const trimmed = raw.trim();
		if (trimmed === "" || UST_CONTINUE_LYRICS.includes(trimmed)) continue;
		if (UST_BREATH_KANJI_RE.test(trimmed)) continue;
		const token = lyricToken(trimmed);
		if (
			UST_BREATH_ALIAS_RE.test(token) ||
			isUstRest(token) ||
			!/^[A-Za-z]+[0-5]?$/.test(token)
		)
			continue;
		romaji++;
		const lower = token.toLowerCase().replace(/[0-5]$/, "");
		if (!ROMAJI_KANA[lower] && pinyinToMoras(token)) pinyinOnly++;
	}
	return pinyinOnly >= 3 && pinyinOnly * 2 >= romaji;
};

// ============================================================
// 入力
// ============================================================

/** USTから取り出したノート1つ（ピッチはMIDIノート番号＝`NoteNum` そのまま）。 */
export type UstNotePlacement = {
	startStep: number;
	pitch: number;
	durationSteps: number;
	velocity: number;
};

/** UST1ファイル＝1パートぶんの取り込み結果。 */
export type UstTrackData = {
	/** 読み込んだファイル名（トラック割り当ての表示用）。 */
	name: string;
	/** `Tempo` の値。書かれていなければ null。 */
	bpm: number | null;
	notes: UstNotePlacement[];
	/** ノート1つにつき1音節の歌詞テキスト（かな＋制御記号）。 */
	lyrics: string;
	/** かなへ落とせなかった歌詞の数（読み込み結果の注意書き用）。 */
	unknownLyricCount: number;
	/** 中国語ピンインとして読んだか（{@link looksLikePinyin} の判定結果）。 */
	pinyin: boolean;
};

/**
 * USTのバイト列を文字列へ復号する。
 *
 * UTAUの標準はShift_JIS、OpenUtau等の新しい環境はUTF-8で書く。拡張子では
 * 見分けられないので、**UTF-8として妥当かどうか**で判定する（日本語の
 * Shift_JIS列がUTF-8として妥当になることはほぼ無い）。
 */
export const decodeUstText = (bytes: Uint8Array): string => {
	const utf8 = (() => {
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return null;
		}
	})();
	if (utf8 !== null) return utf8.replace(/^﻿/, "");
	for (const label of ["shift_jis", "windows-31j", "cp932"]) {
		try {
			return new TextDecoder(label).decode(bytes);
		} catch {
			// この環境がそのラベルを知らないだけ。次の別名を試す。
		}
	}
	// Shift_JISを読めない環境（極めて稀）。文字化けしてでも構造だけは拾う。
	return new TextDecoder("utf-8").decode(bytes);
};

/** ノートセクションから拾うキー。値は文字列のまま持ち、flush でまとめて解釈する。 */
type UstNoteFields = {
	length?: string;
	lyric?: string;
	noteNum?: string;
	intensity?: string;
	/** Mode2 ピッチ線（{@link bendPoints}）。 */
	pbs?: string;
	pbw?: string;
	pby?: string;
};

/**
 * USTを解析し、ノート配置と歌詞を返す。
 *
 * `[#PREV]` / `[#NEXT]` は編集中の前後関係を表す参考情報でパートの一部ではないため、
 * 取り込まない。休符（`Lyric=R`）はノートを作らず位置だけを進める
 * （ピアノロールでは音符の無い隙間が休符そのものなので、歌詞も消費しない）。
 *
 * ブレス（`息R` `R吸` `@br1`）も同じくノートを作らない。UST側では息継ぎ用の
 * ノートが時間を占めているが、このアプリのブレス `、` はノートを消費しない記号
 * なので、直前の音節へ畳んで「その隙間で息を吸う」形に写す。
 *
 * 逆に、1音節が複数モーラになる歌詞（ピンインの `xing` → シ＋ン）では
 * **ノートを割って**増やす（{@link splitNoteSteps}）。どちらの場合も
 * 「ノート1つにつき音節1つ」は保たれる。
 */
/**
 * 本文を走査して、`[#nnnn]` のノートとテンポを集める。
 *
 * 歌詞の読み方（日本語ローマ字かピンインか）はファイル全体を見ないと決められない
 * ので、解釈は {@link parseUst} に任せ、ここでは生の値だけを並べて返す。
 */
const scanUst = (
	text: string,
): { bpm: number | null; sections: UstNoteFields[] } => {
	let bpm: number | null = null;
	const sections: UstNoteFields[] = [];
	let current: UstNoteFields | null = null;
	for (const rawLine of text.split(/\r\n|\r|\n/)) {
		const line = rawLine.trim();
		if (line === "") continue;
		if (line.startsWith("[")) {
			if (current) sections.push(current);
			// `[#0000]` のような連番セクションだけがパートのノート。
			// `[#SETTING]` `[#PREV]` `[#NEXT]` `[#TRACKEND]` はノートではない。
			current = /^\[#\d+\]$/.test(line) ? {} : null;
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 0) continue; // `UST Version1.2` のような値だけの行
		const key = line.slice(0, eq).trim().toLowerCase();
		const value = line.slice(eq + 1);
		// テンポはファイル先頭（[#SETTING]）が基準。ノート側のテンポ変化は
		// このアプリが曲全体で1つのBPMしか持てないため、最初の1つだけ採る。
		if (key === "tempo" && bpm === null) {
			const t = Number.parseFloat(value.replace(",", "."));
			if (Number.isFinite(t) && t > 0) bpm = t;
		}
		if (!current) continue;
		if (key === "length") current.length = value;
		else if (key === "lyric") current.lyric = value;
		else if (key === "notenum") current.noteNum = value;
		else if (key === "intensity") current.intensity = value;
		else if (key === "pbs") current.pbs = value;
		else if (key === "pbw") current.pbw = value;
		else if (key === "pby") current.pby = value;
	}
	if (current) sections.push(current);
	return { bpm, sections };
};

/**
 * USTの1ノートを、モーラ数ぶんのノートへ割る。
 *
 * 頭のモーラが大半を持ち、後ろ（二重母音の後半・撥音）は尻へ短く付ける。
 * 日本語の歌でも「ん」は音の終わりで閉じるので、この配分が歌い方に近い
 * （`xing` を4分音符で置くと「し」が付点8分、「ん」が16分になる）。
 *
 * 割るだけの長さが無いノートでは、入り切らない尻のモーラを落とす。
 */
const splitNoteSteps = (
	startStep: number,
	endStep: number,
	moraCount: number,
): { startStep: number; durationSteps: number }[] => {
	const total = Math.max(1, endStep - startStep);
	const count = Math.max(1, Math.min(moraCount, total));
	const tail =
		count > 1
			? Math.max(
					1,
					Math.min(MORA_TAIL_MAX_STEPS, Math.floor(total / (count * 2))),
				)
			: 0;
	const slots: { startStep: number; durationSteps: number }[] = [];
	let at = startStep;
	for (let i = 0; i < count; i++) {
		const durationSteps = i === 0 ? total - tail * (count - 1) : tail;
		slots.push({ startStep: at, durationSteps });
		at += durationSteps;
	}
	return slots;
};

// ============================================================
// Mode2 ピッチ線（PBS / PBW / PBY）
// ============================================================

/**
 * 「ピッチを描く」流儀のUSTでは、`NoteNum` は**基準の高さでしかない**。
 * 実際に歌う高さは Mode2 のピッチ線を足したもので、音価の大半を使って
 * 数半音落ちる・上がる書き方も珍しくない。線を捨てると別の旋律になる。
 *
 * - `PBS=x;y` … 開始点。x はノート頭からの相対ms（前のノートへ食い込む負値が普通）、
 *   y は**セントの1/10**。区切りは `;` のことも `,` のこともある。
 * - `PBW=w1,w2,…` … 各区間の長さ（ms）。
 * - `PBY=y1,y2,…` … 各区間の終点の高さ（セントの1/10）。書かれていない分は0（＝基準へ戻る）。
 * - `PBM` … 区間ごとの曲線種別。このアプリのグライドは常に滑らかに繋ぐので使わない。
 */
type BendPoint = { ms: number; cents: number };

/** カンマ区切りの数値列。空欄は0として読む（`PBY=-27.9,,10,` のような書き方がある）。 */
const bendNumbers = (value: string | undefined): number[] =>
	(value ?? "")
		.split(",")
		.map((x) => Number.parseFloat(x))
		.map((x) => (Number.isFinite(x) ? x : 0));

/** `PBS` / `PBW` / `PBY` から制御点列を組み立てる（ピッチ線が無ければ空）。 */
const bendPoints = (fields: UstNoteFields): BendPoint[] => {
	if (fields.pbw === undefined && fields.pbs === undefined) return [];
	const [rawMs, rawCents] = (fields.pbs ?? "0").split(/[;,]/);
	let ms = Number.parseFloat(rawMs);
	if (!Number.isFinite(ms)) ms = 0;
	const head = Number.parseFloat(rawCents ?? "");
	const points: BendPoint[] = [
		{ ms, cents: (Number.isFinite(head) ? head : 0) * 10 },
	];
	const widths = bendNumbers(fields.pbw);
	const heights = bendNumbers(fields.pby);
	widths.forEach((w, i) => {
		ms += w;
		points.push({ ms, cents: (heights[i] ?? 0) * 10 });
	});
	return points;
};

/** 制御点の間を直線で読む（範囲外は端の値のまま）。 */
const bendCentsAt = (points: BendPoint[], ms: number): number => {
	if (ms <= points[0].ms) return points[0].cents;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (ms > b.ms) continue;
		const span = b.ms - a.ms;
		return span <= 0
			? b.cents
			: a.cents + ((b.cents - a.cents) * (ms - a.ms)) / span;
	}
	return points[points.length - 1].cents;
};

/**
 * ピッチ線を採る下限（セント）。
 *
 * このアプリのピアノロールは半音格子なので、半音に満たない揺れは書き写しても
 * 同じ高さへ丸まるだけでノートが増える。しゃくり・ビブラート程度の綾は捨てて、
 * 「旋律が変わる」大きさの曲がりだけを写す。
 */
const BEND_MIN_CENTS = 100;
/**
 * ピッチ線から起こすノートの最短長（ms）。
 *
 * ステップ数ではなく実時間で決める。速い曲ほど1ステップが短くなるので、
 * ステップで切ると同じ「一瞬の綾」が曲によって残ったり消えたりする。
 */
const BEND_MIN_MS = 60;
/** 1つのノートのピッチ線を読む回数。細かく描かれていても、この粗さまでしか写さない。 */
const BEND_SAMPLES = 8;
/** 1つのノートから起こすピッチ変化の上限。描き込みの細かいUSTでも増えすぎないように。 */
const BEND_MAX_POINTS = 8;

/**
 * MMLが**1音で書ける音価**（ステップ。1小節192ステップ基準）。
 *
 * MMLの音長は `4` `8.` `12` … という決まった刻みしか持たない。ここに無い長さの
 * ノートは書き出しのときに手前を切られ、余りが休符になる。その休符が
 * ポルタメントの直前に入ると「隙間がある＝別の息」と見なされて結合が切れ、
 * 滑らかな1音のはずが短い音の連なりとして言い直されてしまう
 * （`lyrics.ts` の `buildStreamVoiceNotes`）。
 *
 * ピッチ線から起こすノートはこの表に乗る長さだけを使い、MMLを経由しても
 * 繋ぎが切れないようにする。
 */
const MML_STEPS = [6, 8, 12, 16, 18, 24, 36, 48, 72, 96, 144, 192];

/** `want` 以上で最小のMML音価。無ければ最大値。 */
const mmlStepsAtLeast = (want: number): number =>
	MML_STEPS.find((s) => s >= want) ?? MML_STEPS[MML_STEPS.length - 1];

/** ピッチ線の高さ（セント）→ 基準からの半音オフセット。半音未満は0へ倒す。 */
const bendSemitones = (cents: number): number =>
	Math.abs(cents) < BEND_MIN_CENTS ? 0 : Math.round(cents / 100);

/**
 * ノート1つぶんのピッチ線を、**ポルタメントで繋ぐノートの並び**へ写す。
 *
 * このアプリは1ノート＝1つの高さしか持てないが、歌詞のポルタメント記号 `〜` で
 * 繋いだ隣のノートは「言い直さずに滑って移る」1つの声になる（`lyrics.ts` の
 * `buildStreamVoiceNotes` が1音へ畳み、koe がその中をグライドで繋ぐ）。
 * ピッチ線の折れ点をそのノート列として置けば、描かれたとおりの高さで歌える。
 *
 * 折れ点をそのまま追うのではなく**一定間隔で読む**。UTAUのピッチ線には
 * 「1msだけ下げて戻す」ようなこの格子では表せない綾が入っていて、折れ点を
 * 追うと戻りのほうが間隔の下限に弾かれ、下げたまま終わる音が出るため。
 *
 * 区切りの位置は {@link MML_STEPS} に合わせる。ここを外すとMMLへ書き出した
 * ときに休符が挟まり、結合が切れて**言い直しの連打**になる（＝濁って聞こえる）。
 * 最短が {@link BEND_MIN_MS} なのも同じ理由で、これより短いノートは合成側が
 * 60msまで引き伸ばすため、次の音と実際に重なってしまう。
 *
 * 先頭は必ず基準（オフセット0）のまま置く。UTAUのピアノロール上でもノートは
 * `NoteNum` の位置にあり、入りのしゃくりは装飾なので、見た目を動かさない。
 *
 * @returns 2つ目以降（＝ポルタメントで繋ぐぶん）だけ。曲がりが無ければ空。
 */
const bendSlots = (
	points: BendPoint[],
	startStep: number,
	endStep: number,
	msPerStep: number,
): { startStep: number; durationSteps: number; semitones: number }[] => {
	if (points.length < 2) return [];
	const total = endStep - startStep;
	const minSteps = mmlStepsAtLeast(Math.round(BEND_MIN_MS / msPerStep));
	if (total < minSteps * 2) return [];
	// 入りのポルタメント（前のノートの高さから基準へ滑り込む区間）は読み飛ばす。
	// UTAUは高さの違う音の繋ぎ目に既定でこれを書くが、ピアノロールでは
	// 「隣のノートへ移る」ことがそのまま繋ぎなので、写すと階段が並ぶだけになる。
	const settleMs = points.find((p) => bendSemitones(p.cents) === 0)?.ms;
	if (settleMs === undefined) return []; // 最後まで基準へ戻らない＝まるごと繋ぎ
	const grid = Math.max(minSteps, Math.ceil(total / BEND_SAMPLES));
	const from = Math.max(minSteps, Math.ceil(settleMs / msPerStep));
	const out: { startStep: number; durationSteps: number; semitones: number }[] =
		[];
	/** 直前に置いた区切り（親ノート頭からのステップ）と、そこでの半音オフセット。 */
	let at = 0;
	let prev = 0;
	for (let step = from; step <= total - minSteps; step += grid) {
		const semitones = bendSemitones(bendCentsAt(points, step * msPerStep));
		if (semitones === prev) continue;
		// 直前の区切りからの長さをMMLの音価へ合わせる（切り上げ＝入りの滑り込みへ
		// 食い込まない側へ倒す）。最後の区間だけは余りを受けるので表に乗らなくてよい
		// ——その後ろに続くのは別の音節で、隙間が空いても繋ぎは切れない。
		const next = at + mmlStepsAtLeast(step - at);
		if (next > total - minSteps) break;
		out.push({ startStep: startStep + next, durationSteps: 0, semitones });
		at = next;
		prev = semitones;
		if (out.length >= BEND_MAX_POINTS) break;
	}
	// 長さは次の折れ点（最後はノートの終わり）まで。
	out.forEach((slot, i) => {
		slot.durationSteps = (out[i + 1]?.startStep ?? endStep) - slot.startStep;
	});
	return out;
};

export const parseUst = (
	source: Uint8Array | string,
	name = "",
): UstTrackData => {
	const text = typeof source === "string" ? source : decodeUstText(source);
	const { bpm, sections } = scanUst(text);
	// ピンインかどうかは歌詞全体で決まる（`wo` 単体では日本語と見分けられない）。
	const pinyin = looksLikePinyin(sections.map((f) => f.lyric ?? ""));
	/** パート先頭からの位置（UST tick）。休符も含めて積み上げる。 */
	let tickPos = 0;
	const notes: UstNotePlacement[] = [];
	const syllables: string[] = [];
	let unknownLyricCount = 0;
	/**
	 * 直前に「継続記号が引き継げる音」を置いたか。
	 * 行き場の無い継続記号（パート先頭・ブレス直後）は `normalizeLyrics` に
	 * 捨てられ、以降の音節とノートが1つずつずれるので、休符へ倒して1:1を守る。
	 */
	let hasVoiced = false;
	/** ピッチ線の折れ点をステップへ写すための尺（BPM未記載なら120とみなす）。 */
	const msPerStep = 60000 / (bpm ?? 120) / STEPS_PER_BEAT;

	for (const fields of sections) {
		const length = Number.parseFloat(fields.length ?? "");
		if (!Number.isFinite(length) || length <= 0) continue;
		const startTick = tickPos;
		tickPos += length;
		const noteNum = Number.parseInt(fields.noteNum ?? "", 10);
		// 音高が無いノートは鳴らしようがないので、休符と同じく位置だけ進める
		if (!Number.isFinite(noteNum)) continue;
		const { moras, rest, breath, unknown } = lyricToSyllable(
			fields.lyric ?? "",
			pinyin,
		);
		if (breath) {
			// 直前の音節の後ろへ畳む。歌っていない音（休符・まだ何も無い）に
			// 付けても息継ぎにならないので、その場合は捨てる。
			const last = syllables.length - 1;
			if (
				last >= 0 &&
				syllables[last] !== REST &&
				!syllables[last].endsWith(BREATH)
			)
				syllables[last] += BREATH;
			// 息を継いだ以上、次の継続記号には引き継ぐ母音が無い。
			hasVoiced = false;
			continue;
		}
		if (rest) continue; // 休符はノートも音節も作らない
		if (unknown) unknownLyricCount++;
		const intensity = Number.parseFloat(fields.intensity ?? "");
		const velocity = Number.isFinite(intensity)
			? Math.max(
					1,
					Math.min(127, Math.round((intensity / 100) * DEFAULT_VELOCITY)),
				)
			: DEFAULT_VELOCITY;
		const slots = splitNoteSteps(
			Math.round(startTick * TICKS_TO_STEPS),
			Math.round(tickPos * TICKS_TO_STEPS),
			moras.length,
		);
		slots.forEach((slot, i) => {
			notes.push({ ...slot, pitch: noteNum, velocity });
			const placed = moras[i] === TIE && !hasVoiced ? REST : moras[i];
			if (placed !== REST) hasVoiced = true;
			syllables.push(placed);
		});
		// Mode2 のピッチ線を、ポルタメントで繋ぐノート列として最後の枠へ足す。
		// 歌っていない音（休符へ倒れた継続記号）の後ろへ付けても行き場が無いので置かない。
		const tail = slots[slots.length - 1];
		if (!hasVoiced || !tail) continue;
		const bends = bendSlots(
			bendPoints(fields),
			tail.startStep,
			tail.startStep + tail.durationSteps,
			msPerStep,
		);
		if (bends.length === 0) continue;
		// 折れ点を置いたぶん、元のノートは最初の折れ点までに縮める。
		tail.durationSteps = bends[0].startStep - tail.startStep;
		notes[notes.length - 1].durationSteps = tail.durationSteps;
		for (const bend of bends) {
			notes.push({
				startStep: bend.startStep,
				durationSteps: bend.durationSteps,
				pitch: noteNum + bend.semitones,
				velocity,
			});
			syllables.push(PORTAMENTO);
		}
	}

	return {
		name,
		bpm,
		notes,
		lyrics: syllables.join(""),
		unknownLyricCount,
		pinyin,
	};
};

// ============================================================
// 出力
// ============================================================

export type BuildUstOptions = {
	/** 出力するトラックのノート（`startStep` 昇順）。 */
	notes: Note[];
	/**
	 * ノートと index で1:1に対応する歌詞かな（`normalizeLyrics` の結果を
	 * 1音節ずつ文字列にしたもの）。足りないぶんは {@link DEFAULT_UST_LYRIC} を使う。
	 */
	syllables?: string[];
	bpm: number;
	/** `[#SETTING]` の ProjectName / OutFile の元にする名前。 */
	projectName?: string;
};

/** 歌詞が無いノートに当てる歌詞。UTAU側で必ず何か鳴らせるように「あ」にする。 */
export const DEFAULT_UST_LYRIC = "あ";

/** 書き出すノート1つ（重なりを落とし、隙間の休符も入れたあとの並び）。 */
type UstOutNote = {
	lengthTicks: number;
	lyric: string;
	midi: number;
	intensity?: number;
	/** 継続記号のノート＝直前の音の続き。フェードのグループ分けに使う。 */
	tie: boolean;
	/** この音の直後にブレスが入る（息が切れるのでグループもここで終わる）。 */
	breathAfter: boolean;
	fadeIn: boolean;
	fadeOut: boolean;
	/** `Envelope=` に書く値。フェードが掛からないノートは undefined（UTAUの既定に任せる）。 */
	envelope?: string;
};

/** UST 1ノートぶんのセクションを組み立てる。 */
const ustNoteSection = (index: number, note: UstOutNote): string[] => [
	`[#${String(index).padStart(4, "0")}]`,
	`Length=${note.lengthTicks}`,
	`Lyric=${note.lyric}`,
	`NoteNum=${note.midi}`,
	"PreUtterance=",
	...(note.intensity === undefined ? [] : [`Intensity=${note.intensity}`]),
	...(note.envelope === undefined ? [] : [`Envelope=${note.envelope}`]),
];

/** {@link parseSyllableMarks} の結果。 */
type SyllableMarks = {
	/** 歌う中身（かな・継続記号・休符記号のいずれか）。 */
	kana: string;
	breath: boolean;
	fadeIn: boolean;
	fadeOut: boolean;
};

/**
 * 音節1つを、歌う中身と「ノートを消費しない記号」へ割る。
 *
 * `displayKana` は `あ、↑↓` のように、かなの後ろへ記号を並べた形で返す。
 * 中身はどれか1つ（かな／`ー`／`_`）なので、末尾から記号を剥がせば分けられる。
 */
const parseSyllableMarks = (raw: string | undefined): SyllableMarks => {
	let kana = raw ?? "";
	let breath = false;
	let fadeIn = false;
	let fadeOut = false;
	while (kana.length > 1) {
		const last = kana[kana.length - 1];
		if (last === BREATH) breath = true;
		else if (last === FADE_IN) fadeIn = true;
		else if (last === FADE_OUT) fadeOut = true;
		else break;
		kana = kana.slice(0, -1);
	}
	return { kana, breath, fadeIn, fadeOut };
};

/**
 * このアプリの音節1つをUSTの `Lyric=` へ戻す。
 *
 * 継続記号はUTAUの「前の歌詞を続ける」記号 `+` へ、休符（歌わないノート）は
 * `R` へ写す。歌詞が無いノートは {@link DEFAULT_UST_LYRIC}。
 */
const ustLyricOf = (kana: string): string => {
	if (kana === "") return DEFAULT_UST_LYRIC;
	if (kana === TIE || kana === "〜") return "+";
	if (kana === REST) return "R";
	return kana;
};

// ------------------------------------------------------------
// クレッシェンド / デクレッシェンド → Envelope
// ------------------------------------------------------------

/**
 * UTAUの音量エンベロープ `Envelope=p1,p2,p3,v1,v2,v3,v4` の時間側の既定値。
 *
 * 形は「0msで音量0 → p1+p2 で v2 → 終端のp3手前で v3 → 終端で v4」で、点と点の
 * 間は直線で結ばれる。立ち上がり（5ms）と切り際（35ms）はUTAUの既定のまま使い、
 * **サステインの入口 `v2` と出口 `v3` だけ**をフェードの声量へ差し替える。
 *
 * 5点目（`%,p4,p5,v5`）は基準の取り方が音源・ツールで揺れるので書かない。
 */
const UST_ENVELOPE_ATTACK_MS = 5;
const UST_ENVELOPE_RELEASE_MS = 35;

/**
 * 落とし切る先の声量比（`lyrics.ts` の FADE_OUT_FLOOR と同じ 2%）。
 * 0にすると「消えた」ではなく「途中で切れた」と聞こえるので、芯を残す。
 */
const UST_FADE_FLOOR = 0.02;

/** フェードの中継点。グループ内の位置（0-1）と、そこでの声量（ピーク比）。 */
type UstFadeStop = { at: number; level: number };

/**
 * 記号の位置から中継点を作る（`lyrics.ts` の buildFadeCurve と同じ規則）。
 *
 * k個書かれていたら、i番目が付いたノートの終わりで声量が (k-i)/k 倍
 * （上げるなら i/k 倍）。最後の1つは書いた位置に関わらずグループの終端へ置く。
 * スウェル（`↑` と `↓` の併記）は中央で最大になる別の形なので、中継点は使わない。
 */
const ustFadeStops = (
	group: UstOutNote[],
	totalTicks: number,
	rising: boolean,
	falling: boolean,
): UstFadeStop[] => {
	if (rising && falling)
		return [
			{ at: 0.5, level: 1 },
			{ at: 1, level: UST_FADE_FLOOR },
		];
	let acc = 0;
	const ends = group.map((n) => {
		acc += n.lengthTicks;
		return acc / totalTicks;
	});
	const marked: number[] = [];
	group.forEach((n, i) => {
		if (rising ? n.fadeIn : n.fadeOut) marked.push(i);
	});
	const k = marked.length;
	let prev = 0;
	return marked.map((noteIndex, idx) => {
		const i = idx + 1;
		const at = i === k ? 1 : Math.min(1, Math.max(prev, ends[noteIndex]));
		prev = at;
		return {
			at,
			level: Math.max(UST_FADE_FLOOR, rising ? i / k : (k - i) / k),
		};
	});
};

/** 中継点の間を等比で補間する（アプリの `exponentialRamp` と同じ効き方＝dB直線）。 */
const ustFadeLevelAt = (
	at: number,
	startLevel: number,
	stops: UstFadeStop[],
): number => {
	let prevAt = 0;
	let prevLevel = startLevel;
	for (const stop of stops) {
		if (at <= stop.at) {
			const span = stop.at - prevAt;
			if (span <= 0) return stop.level;
			const t = Math.min(1, Math.max(0, (at - prevAt) / span));
			return prevLevel * (stop.level / prevLevel) ** t;
		}
		prevAt = stop.at;
		prevLevel = stop.level;
	}
	return prevLevel;
};

/** フェードの声量（ピーク比）を `Envelope=` の値へ。 */
const ustEnvelopeOf = (from: number, to: number): string => {
	const v = (level: number): number =>
		Math.max(0, Math.min(200, Math.round(level * 100)));
	return [
		0,
		UST_ENVELOPE_ATTACK_MS,
		UST_ENVELOPE_RELEASE_MS,
		0,
		v(from),
		v(to),
		0,
	].join(",");
};

/**
 * 継続記号で繋がったノートの並び（＝アプリが1つの音として扱う範囲）へ、
 * クレッシェンド／デクレッシェンドの `Envelope=` を割り当てる。
 *
 * アプリの `↓` `↑` は**結合後の音全体**に掛かるので、USTでも同じ範囲に掛ける。
 * UTAUのエンベロープはノート単位なので、グループ全体の曲線をノートの境目で切り出し、
 * 各ノートの出口と次のノートの入口を同じ値にして繋ぐ。ここを合わせずに既定のまま
 * （終端で0）書くと、ノートごとに音が消えては戻る階段になってしまう。
 *
 * 曲線はアプリと同じ等比で作るが、UTAUは点の間を直線で結ぶので、書き出した音は
 * ノート数ぶんの折れ線近似になる（1ノートに収まるフェードは直線1本）。
 */
const assignFadeEnvelopes = (notes: UstOutNote[]): void => {
	for (let i = 0; i < notes.length; i++) {
		// 休符は歌わないので、グループの頭にも続きにもならない。
		if (notes[i].lyric === "R") continue;
		let end = i;
		while (
			end + 1 < notes.length &&
			notes[end + 1].tie &&
			!notes[end].breathAfter
		)
			end++;
		const group = notes.slice(i, end + 1);
		i = end;
		const rising = group.some((n) => n.fadeIn);
		const falling = group.some((n) => n.fadeOut);
		if (!rising && !falling) continue;
		const totalTicks = group.reduce((sum, n) => sum + n.lengthTicks, 0);
		if (totalTicks <= 0) continue;
		const stops = ustFadeStops(group, totalTicks, rising, falling);
		// クレッシェンドは小さく入る。デクレッシェンドはピークから始める。
		const startLevel = rising ? UST_FADE_FLOOR : 1;
		let acc = 0;
		for (const note of group) {
			const from = acc / totalTicks;
			acc += note.lengthTicks;
			const to = acc / totalTicks;
			note.envelope = ustEnvelopeOf(
				ustFadeLevelAt(from, startLevel, stops),
				ustFadeLevelAt(to, startLevel, stops),
			);
		}
	}
};

/**
 * 1トラックぶんのノートと歌詞から `.ust` テキストを生成する。
 *
 * USTは**単旋律しか表現できない**フォーマットなので、和音・重なりは先勝ちで
 * 1本へ潰す（同時刻なら先に置かれたノート、跨ぎは前のノートを優先）。捨てた
 * ノートに割り当たっていた音節も一緒に捨て、音節とノートの1:1を保つ。
 *
 * ノートを消費しない記号のうち、クレッシェンド `↑` とデクレッシェンド `↓` は
 * `Envelope=`（音量エンベロープ）へ写す（{@link assignFadeEnvelopes}）。
 * ブレス `、` に当たる表現はUSTに無いので落とす。
 *
 * 文字コードはUTF-8で書き、`Charset=UTF-8` を添える（UTAU本体はShift_JISが
 * 既定だが、`Charset` 行があればUTF-8のUSTも読める）。改行はUTAUに合わせてCRLF。
 */
export const buildUst = (options: BuildUstOptions): string => {
	const { notes, syllables = [], bpm, projectName = "dtm" } = options;
	// 歌詞との対応は「startStep昇順のindex」で決まる（再生側と同じ規則）。
	const sorted = notes
		.map((note, index) => ({ note, syllable: syllables[index] }))
		.sort((a, b) => a.note.startStep - b.note.startStep);

	const lines: string[] = [
		"[#VERSION]",
		"UST Version1.2",
		"[#SETTING]",
		`Tempo=${bpm.toFixed(2)}`,
		"Tracks=1",
		`ProjectName=${projectName}`,
		"VoiceDir=%VOICE%uta",
		`OutFile=${projectName}.wav`,
		`CacheDir=${projectName}.cache`,
		"Tool1=wavtool.exe",
		"Tool2=resampler.exe",
		"Mode2=True",
		"Charset=UTF-8",
	];

	// フェードはノートを跨いで掛かるので、並びを組み立ててからエンベロープを
	// 割り当て、最後に本文へ流す。
	const out: UstOutNote[] = [];
	/** 直前のノートの終端（UST tick）。ここより前から始まるノートは重なり。 */
	let cursorTick = 0;
	for (const { note, syllable } of sorted) {
		const startTick = Math.round(note.startStep * STEPS_TO_TICKS);
		const endTick = Math.round(
			(note.startStep + note.durationSteps) * STEPS_TO_TICKS,
		);
		if (startTick < cursorTick) continue; // 和音の下側・重なりは捨てる
		if (startTick > cursorTick) {
			out.push({
				lengthTicks: startTick - cursorTick,
				lyric: "R",
				midi: 60,
				tie: false,
				breathAfter: false,
				fadeIn: false,
				fadeOut: false,
			});
		}
		const length = Math.max(1, endTick - startTick);
		// 31平均律の微分音はUSTに書けないので最寄りの半音へ丸める（UTAUは半音格子）。
		const { midi } = unitsToMidiDetune(note.pitchUnits);
		const velocity = note.velocity ?? DEFAULT_VELOCITY;
		const marks = parseSyllableMarks(syllable);
		out.push({
			lengthTicks: length,
			lyric: ustLyricOf(marks.kana),
			midi,
			intensity: Math.max(
				0,
				Math.min(200, Math.round((velocity / DEFAULT_VELOCITY) * 100)),
			),
			tie: marks.kana === TIE || marks.kana === "〜",
			breathAfter: marks.breath,
			fadeIn: marks.fadeIn,
			fadeOut: marks.fadeOut,
		});
		cursorTick = startTick + length;
	}
	assignFadeEnvelopes(out);
	for (const [index, note] of out.entries()) {
		lines.push(...ustNoteSection(index, note));
	}
	lines.push("[#TRACKEND]");
	return `${lines.join("\r\n")}\r\n`;
};
