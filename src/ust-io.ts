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
 */

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

/** UTAUの「直前のノートの歌詞を続ける」記号。継続記号 `ー` と同じ意味。 */
const UST_CONTINUE_LYRICS = ["+", "+~", "+-", "+*", "*", "ー", "-"];

/** 継続記号（`lyrics.ts` の TIE_MARK と同じ文字）。 */
const TIE = "ー";
/** 明示的な休符＝ノートを消費するが歌わない（`lyrics.ts` の REST_MARK と同じ文字）。 */
const REST = "_";

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

/**
 * カタカナをひらがなへ寄せる。歌唱側（`normalizeLyrics`）もどちらでも読めるが、
 * 歌詞欄に両方が混ざると編集しづらいので、取り込んだ時点で片方へ揃える。
 */
const toHiragana = (text: string): string =>
	text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** {@link lyricToSyllable} の結果。 */
type ParsedLyric = {
	/** このアプリの歌詞1音節。休符なら空文字。 */
	syllable: string;
	/** `Lyric=R` 等の休符か。 */
	rest: boolean;
	/** かなへ落とせなかったか（読み込み結果の注意書き用）。 */
	unknown: boolean;
};

/**
 * USTの `Lyric=` 1つを、このアプリの歌詞1音節へ変換する。
 *
 * UTAUの原音名は音源ごとに流儀が違うので、実体のかなだけを掬う:
 * - 連続音 `a か` / `- か` … 空白区切りの**最後の語**が実体。
 * - サフィックス付き `かC4` `か強` … 先頭のかな列だけを採る。
 * - ローマ字命名 `ka` `kya` … {@link ROMAJI_KANA} でかなへ寄せる。
 *
 * 変換できない綴り（CVVCの `a k` のような子音だけの断片など）は継続記号にする。
 * 言い直さずに繋ぐのが元の意図に一番近く、音節とノートの1:1もずれない。
 */
export const lyricToSyllable = (raw: string): ParsedLyric => {
	const trimmed = raw.trim();
	if (trimmed === "") return { syllable: "", rest: true, unknown: false };
	if (UST_CONTINUE_LYRICS.includes(trimmed))
		return { syllable: TIE, rest: false, unknown: false };
	// 空白区切りの最後の語が実体（連続音・CVVCの前置きを落とす）
	const token = trimmed.split(/\s+/).pop() ?? "";
	if (/^r(?:est)?$/i.test(token))
		return { syllable: "", rest: true, unknown: false };
	const kana = token.match(KANA_HEAD_RE)?.[0];
	if (kana) return { syllable: toHiragana(kana), rest: false, unknown: false };
	const romaji = token.match(/^[A-Za-z]+/)?.[0] ?? "";
	const fromRomaji = ROMAJI_KANA[romaji] ?? ROMAJI_KANA[romaji.toLowerCase()];
	if (fromRomaji) return { syllable: fromRomaji, rest: false, unknown: false };
	return { syllable: TIE, rest: false, unknown: true };
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
};

/**
 * USTを解析し、ノート配置と歌詞を返す。
 *
 * `[#PREV]` / `[#NEXT]` は編集中の前後関係を表す参考情報でパートの一部ではないため、
 * 取り込まない。休符（`Lyric=R`）はノートを作らず位置だけを進める
 * （ピアノロールでは音符の無い隙間が休符そのものなので、歌詞も消費しない）。
 */
export const parseUst = (
	source: Uint8Array | string,
	name = "",
): UstTrackData => {
	const text = typeof source === "string" ? source : decodeUstText(source);
	let bpm: number | null = null;
	/** パート先頭からの位置（UST tick）。休符も含めて積み上げる。 */
	let tickPos = 0;
	const notes: UstNotePlacement[] = [];
	const syllables: string[] = [];
	let unknownLyricCount = 0;
	/** 既に歌える音節を置いたか。行き場の無い先頭の継続記号は休符へ倒す。 */
	let hasVoiced = false;
	let current: UstNoteFields | null = null;

	const flush = (): void => {
		const fields = current;
		current = null;
		if (!fields) return;
		const length = Number.parseFloat(fields.length ?? "");
		if (!Number.isFinite(length) || length <= 0) return;
		const startTick = tickPos;
		tickPos += length;
		const noteNum = Number.parseInt(fields.noteNum ?? "", 10);
		// 音高が無いノートは鳴らしようがないので、休符と同じく位置だけ進める
		if (!Number.isFinite(noteNum)) return;
		const { syllable, rest, unknown } = lyricToSyllable(fields.lyric ?? "");
		if (rest) return; // 休符はノートも音節も作らない
		if (unknown) unknownLyricCount++;
		const startStep = Math.round(startTick * TICKS_TO_STEPS);
		const endStep = Math.round(tickPos * TICKS_TO_STEPS);
		const intensity = Number.parseFloat(fields.intensity ?? "");
		const velocity = Number.isFinite(intensity)
			? Math.max(
					1,
					Math.min(127, Math.round((intensity / 100) * DEFAULT_VELOCITY)),
				)
			: DEFAULT_VELOCITY;
		notes.push({
			startStep,
			pitch: noteNum,
			durationSteps: Math.max(1, endStep - startStep),
			velocity,
		});
		const placed = syllable === TIE && !hasVoiced ? REST : syllable;
		if (placed !== REST) hasVoiced = true;
		syllables.push(placed);
	};

	for (const rawLine of text.split(/\r\n|\r|\n/)) {
		const line = rawLine.trim();
		if (line === "") continue;
		if (line.startsWith("[")) {
			flush();
			// `[#0000]` のような連番セクションだけがパートのノート。
			// `[#SETTING]` `[#PREV]` `[#NEXT]` `[#TRACKEND]` はノートではない。
			if (/^\[#\d+\]$/.test(line)) current = {};
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
	}
	flush();

	return { name, bpm, notes, lyrics: syllables.join(""), unknownLyricCount };
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

/** UST 1ノートぶんのセクションを組み立てる。 */
const ustNoteSection = (
	index: number,
	lengthTicks: number,
	lyric: string,
	noteNum: number,
	intensity?: number,
): string[] => [
	`[#${String(index).padStart(4, "0")}]`,
	`Length=${lengthTicks}`,
	`Lyric=${lyric}`,
	`NoteNum=${noteNum}`,
	"PreUtterance=",
	...(intensity === undefined ? [] : [`Intensity=${intensity}`]),
];

/**
 * このアプリの音節1つをUSTの `Lyric=` へ戻す。
 *
 * 継続記号はUTAUの「前の歌詞を続ける」記号 `+` へ、休符（歌わないノート）は
 * `R` へ写す。歌詞が無いノートは {@link DEFAULT_UST_LYRIC}。
 */
const ustLyricOf = (syllable: string | undefined): string => {
	if (syllable === undefined || syllable === "") return DEFAULT_UST_LYRIC;
	if (syllable === TIE || syllable === "〜") return "+";
	if (syllable === REST) return "R";
	return syllable;
};

/**
 * 1トラックぶんのノートと歌詞から `.ust` テキストを生成する。
 *
 * USTは**単旋律しか表現できない**フォーマットなので、和音・重なりは先勝ちで
 * 1本へ潰す（同時刻なら先に置かれたノート、跨ぎは前のノートを優先）。捨てた
 * ノートに割り当たっていた音節も一緒に捨て、音節とノートの1:1を保つ。
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

	let index = 0;
	/** 直前のノートの終端（UST tick）。ここより前から始まるノートは重なり。 */
	let cursorTick = 0;
	for (const { note, syllable } of sorted) {
		const startTick = Math.round(note.startStep * STEPS_TO_TICKS);
		const endTick = Math.round(
			(note.startStep + note.durationSteps) * STEPS_TO_TICKS,
		);
		if (startTick < cursorTick) continue; // 和音の下側・重なりは捨てる
		if (startTick > cursorTick) {
			lines.push(...ustNoteSection(index++, startTick - cursorTick, "R", 60));
		}
		const length = Math.max(1, endTick - startTick);
		// 31平均律の微分音はUSTに書けないので最寄りの半音へ丸める（UTAUは半音格子）。
		const { midi } = unitsToMidiDetune(note.pitchUnits);
		const velocity = note.velocity ?? DEFAULT_VELOCITY;
		lines.push(
			...ustNoteSection(
				index++,
				length,
				ustLyricOf(syllable),
				midi,
				Math.max(
					0,
					Math.min(200, Math.round((velocity / DEFAULT_VELOCITY) * 100)),
				),
			),
		);
		cursorTick = startTick + length;
	}
	lines.push("[#TRACKEND]");
	return `${lines.join("\r\n")}\r\n`;
};
