/**
 * MusicXML の入出力。
 *
 * ## MIDI と何が違うか
 *
 * MIDI は「いつ・どの高さの音を鳴らすか」しか持たない。MusicXML は**楽譜**なので、
 * パートの名前・声部・歌詞・調号・拍子・音符の綴り（ファ♯かソ♭か）まで持つ。
 * このライブラリにとって効くのは主に2つ。
 *
 * - **主旋律がどれか分かる。** MIDI からの取り込みはチャンネルを見て推定するしか
 *   なく、ハモリや対旋律を主旋律と取り違える（`scripts/calibrate-corpus.ts` の
 *   主旋律選択が長い注釈を必要としているのはそのため）。MusicXML はパートが
 *   明示されている。
 * - **歌詞が音符に紐づいている。** 歌声合成へそのまま渡せる。MIDI では歌詞と
 *   音符の対応が失われる。
 *
 * ## 音律について
 *
 * 31平均律（{@link file://./tuning.ts}）の音は MusicXML の `<alter>` に小数を書けば
 * 表現できる（仕様上は許されている）。ただし**読める相手は限られる**ので、
 * 書き出しでは12平均律へ丸めた整数を使い、微分音は捨てる。31平均律の曲を
 * 往復させたいときは MML を使うこと。
 *
 * ## 対応範囲
 *
 * 読み込みは `score-partwise`（一般的なほう）のみ。`score-timewise` は実物が
 * ほぼ流通していないので見ない。和音（`<chord>`）・タイ・声部・複数パートは扱う。
 * 繰り返し記号（`<repeat>`）は**展開しない**——展開すると小節番号がずれて、
 * 取り込んだ後の編集で位置を見失う。
 *
 * ## 歌詞の記号と楽譜の要素
 *
 * 歌詞の制御記号（{@link file://./lyrics.ts}）は、楽譜ソフトが同じ意味で読み書きする
 * 標準の要素へ写す。記号を `<text>` に文字として書くと、楽譜ソフトでは歌詞の
 * ゴミになり、他の楽譜からは読めない。
 *
 * | 歌詞 | MusicXML | 備考 |
 * |---|---|---|
 * | `ー`（伸ばす） | 歌詞なしの音符。直前の歌詞に `<extend/>`（メリスマ線） | 読みは「歌詞の無い音符 = ー」 |
 * | `〜`（しゃくり） | `<notations><slide type="start"/>` … `<slide type="stop"/>` | ポルタメント記号。`<glissando>` も読む |
 * | `、`（ブレス） | `<notations><articulations><breath-mark/>` | 楽譜のブレス記号（コンマ形） |
 * | `↓` `↑` | `<direction><direction-type><wedge type="diminuendo"/"crescendo"/>` | 音符の前に開始、伸ばした音の後に `stop` |
 * | `っ` `_` `「…」` | `<text>` にそのまま | 楽譜側に対応物が無い |
 * | 鼻濁音 `ガ` | `<text>` にカタカナのまま | 読み直すと同じ意味になる |
 */

import { UNITS_PER_SEMITONE, type Units } from "./tuning";
import type { Note } from "./types";
import { DTM_VERSION } from "./version";

/** 4分音符あたりのステップ数。このライブラリの内部表現。 */
const STEPS_PER_BEAT = 48;

/** 取り込んだ1音。 */
export type MusicXmlNotePlacement = {
	/** 何番目のパートから来たか（0始まり）。 */
	partIndex: number;
	startStep: number;
	/** MIDIノート番号。 */
	pitch: number;
	durationSteps: number;
	/**
	 * 音符に紐づいた歌詞。`<lyric><text>` の文字に、楽譜の要素から起こした記号
	 * （ブレス `、`・強弱 `↑` `↓`）を後ろへ付けた形（`displayKana` と同じ並び）。
	 * 歌詞が無くポルタメントの着地なら `〜`、記号だけなら `ー` + 記号。無ければ空。
	 */
	lyric: string;
};

export type MusicXmlPart = {
	index: number;
	/** `<part-name>`。無ければ `Part 1` のような既定名。 */
	name: string;
	noteCount: number;
	/** このパートに歌詞が付いているか。歌トラックの候補を見分けるのに使う。 */
	hasLyrics: boolean;
	/** 平均音高（MIDIノート番号）。主旋律の目安。 */
	avgPitch: number;
};

export type MusicXmlExtraction = {
	parts: MusicXmlPart[];
	placements: MusicXmlNotePlacement[];
	bpm: number;
};

// ============================================================
// 読み込み
// ============================================================

/** 歌詞の制御記号（{@link file://./lyrics.ts} と同じ文字。あちらを読み込まずに済ませる）。 */
const TIE = "ー";
const PORTAMENTO = "〜";
const BREATH = "、";
const FADE_IN = "↑";
const FADE_OUT = "↓";

/** 1音の歌詞に付く、ノートを消費しない記号と、継続の種別。 */
type LyricMarks = {
	breath: boolean;
	fadeIn: boolean;
	fadeOut: boolean;
	/** ポルタメントの着地（`<slide type="stop">`）。歌詞が無ければ `〜` になる。 */
	slideStop: boolean;
};

/** `<note>` の記譜要素から記号を起こす。松葉は音符の前の `<direction>` で拾って渡す。 */
const noteMarksOf = (
	note: Element,
	fadeIn: boolean,
	fadeOut: boolean,
): LyricMarks => {
	const has = (tag: string, type?: string): boolean =>
		Array.from(note.getElementsByTagName(tag)).some(
			(el) => !type || el.getAttribute("type") === type,
		);
	return {
		breath: has("breath-mark"),
		fadeIn,
		fadeOut,
		slideStop: has("slide", "stop") || has("glissando", "stop"),
	};
};

/** 歌詞の文字と記号を `displayKana` と同じ並び（文字 + 、 + ↑ + ↓）へ組む。 */
const lyricWithMarks = (text: string, m: LyricMarks): string => {
	const suffix =
		(m.breath ? BREATH : "") +
		(m.fadeIn ? FADE_IN : "") +
		(m.fadeOut ? FADE_OUT : "");
	// 歌詞の無い音符は「伸ばす」。ポルタメントの着地なら「しゃくり」。
	// 記号だけが付いていても、記号は音符を消費しないので頭に継続記号が要る。
	const head = text || (m.slideStop ? PORTAMENTO : suffix ? TIE : "");
	return head + suffix;
};

/** 既にある歌詞へ記号を足す（同じ記号は重ねない）。タイで伸ばした音に使う。 */
const appendMarks = (lyric: string, m: LyricMarks): string => {
	let out = lyric;
	for (const [on, mark] of [
		[m.breath, BREATH],
		[m.fadeIn, FADE_IN],
		[m.fadeOut, FADE_OUT],
	] as const) {
		if (on && !out.includes(mark)) out += mark;
	}
	return out;
};

/** `displayKana` の形（文字 + 記号）を、文字と記号へ割る（書き出し用）。 */
type LyricSyllable = {
	text: string;
	tie: boolean;
	portamento: boolean;
	breath: boolean;
	fadeIn: boolean;
	fadeOut: boolean;
};
const splitLyric = (raw: string): LyricSyllable => {
	let text = raw;
	const m = { breath: false, fadeIn: false, fadeOut: false };
	while (text.length > 1) {
		const last = text[text.length - 1];
		if (last === BREATH) m.breath = true;
		else if (last === FADE_IN) m.fadeIn = true;
		else if (last === FADE_OUT) m.fadeOut = true;
		else break;
		text = text.slice(0, -1);
	}
	return {
		text,
		tie: text === TIE,
		portamento: text === PORTAMENTO,
		...m,
	};
};

const PITCH_CLASS: Record<string, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

const textOf = (el: Element | null | undefined, tag: string): string =>
	el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";

const numOf = (
	el: Element | null | undefined,
	tag: string,
	fallback = 0,
): number => {
	const raw = textOf(el, tag);
	if (!raw) return fallback;
	const v = Number.parseFloat(raw);
	return Number.isFinite(v) ? v : fallback;
};

/**
 * `<note>` から MIDI ノート番号を出す。
 *
 * `<alter>` は小数もありうる（微分音）が、**四捨五入して半音へ丸める**。
 * このライブラリの取り込み先は12平均律のピアノロールなので、中途半端な高さを
 * 持ち込んでも編集できない。
 */
const pitchOf = (note: Element): number | null => {
	const p = note.getElementsByTagName("pitch")[0];
	if (!p) return null;
	const step = textOf(p, "step").toUpperCase();
	const base = PITCH_CLASS[step];
	if (base === undefined) return null;
	const octave = numOf(p, "octave", 4);
	const alter = Math.round(numOf(p, "alter", 0));
	// MusicXML のオクターブは中央ハ = C4 = MIDI 60。
	return (octave + 1) * 12 + base + alter;
};

/**
 * MusicXML を読んで、音符・パート情報・テンポを返す。
 *
 * @param xml `.musicxml` / `.xml` のテキスト。圧縮形式（`.mxl`）は呼び出し側で
 *            展開してから渡すこと（ZIP の展開をこのライブラリへ持ち込まない）。
 */
export const parseMusicXML = (xml: string): MusicXmlExtraction => {
	const doc = new DOMParser().parseFromString(xml, "application/xml");
	if (doc.getElementsByTagName("parserror").length > 0)
		throw new Error("MusicXML として読めません");

	// パート名は `<part-list>` 側にある（`<part>` 側は id しか持たない）。
	const nameById = new Map<string, string>();
	for (const sp of Array.from(doc.getElementsByTagName("score-part"))) {
		const id = sp.getAttribute("id");
		if (id) nameById.set(id, textOf(sp, "part-name") || id);
	}

	const placements: MusicXmlNotePlacement[] = [];
	const parts: MusicXmlPart[] = [];
	let bpm = 0;

	const partEls = Array.from(doc.getElementsByTagName("part"));
	partEls.forEach((partEl, partIndex) => {
		const id = partEl.getAttribute("id") ?? "";
		let divisions = 1;
		/** その小節の先頭からの位置（ステップ）。`<backup>`/`<forward>` で動く。 */
		let cursor = 0;
		let measureStart = 0;
		/** 直前に置いた音（`<chord>` はこれと同じ位置に重ねる）。 */
		let lastStart = 0;
		let lastDurSteps = 0;
		/** タイで繋がっている音を、あとから伸ばすために覚えておく。 */
		const tied = new Map<number, MusicXmlNotePlacement>();
		let count = 0;
		let pitchSum = 0;
		let lyricSeen = false;
		/** 音符の前に置かれた松葉（`<wedge>`）。次に置く音へ `↑` / `↓` として付ける。 */
		let pendingFadeIn = false;
		let pendingFadeOut = false;

		for (const measure of Array.from(partEl.getElementsByTagName("measure"))) {
			measureStart += cursor;
			cursor = 0;
			for (const child of Array.from(measure.children)) {
				const tag = child.tagName.toLowerCase();

				if (tag === "attributes") {
					const d = numOf(child, "divisions", 0);
					if (d > 0) divisions = d;
					continue;
				}
				if (tag === "direction") {
					// テンポは `<sound tempo="...">`。最初に見つかったものを採る
					// （曲中のテンポ変化はこのライブラリが持てない）。
					const sound = child.getElementsByTagName("sound")[0];
					const t = Number.parseFloat(sound?.getAttribute("tempo") ?? "");
					if (!bpm && Number.isFinite(t) && t > 0) bpm = t;
					// 松葉の開始は次の音へ掛ける。`stop` は音符側の記号に含まれるので見ない。
					for (const w of Array.from(child.getElementsByTagName("wedge"))) {
						const type = w.getAttribute("type");
						if (type === "crescendo") pendingFadeIn = true;
						else if (type === "diminuendo") pendingFadeOut = true;
					}
					continue;
				}
				if (tag === "backup" || tag === "forward") {
					const steps =
						(numOf(child, "duration", 0) / divisions) * STEPS_PER_BEAT;
					cursor += tag === "backup" ? -steps : steps;
					continue;
				}
				if (tag !== "note") continue;

				const durSteps = Math.round(
					(numOf(child, "duration", 0) / divisions) * STEPS_PER_BEAT,
				);
				const isChord = child.getElementsByTagName("chord").length > 0;
				const isRest = child.getElementsByTagName("rest").length > 0;
				// **和音の2音目以降は時間を進めない。** `<chord>` は「直前の音と
				// 同時に鳴る」という意味で、`<duration>` は持つが位置は進まない。
				const start = isChord ? lastStart : measureStart + cursor;

				if (!isRest) {
					const pitch = pitchOf(child);
					if (pitch !== null) {
						// 歌詞。エリジオン（`<text>` が複数）は繋げて1音節にする。
						const lyricEl = child.getElementsByTagName("lyric")[0];
						const text = lyricEl
							? Array.from(lyricEl.getElementsByTagName("text"))
									.map((t) => t.textContent?.trim() ?? "")
									.join("")
							: "";
						if (text) lyricSeen = true;
						const marks = noteMarksOf(child, pendingFadeIn, pendingFadeOut);
						pendingFadeIn = false;
						pendingFadeOut = false;

						// タイ。`type="stop"` は直前の同じ高さの音を伸ばす。
						const ties = Array.from(child.getElementsByTagName("tie"));
						const stops = ties.some((t) => t.getAttribute("type") === "stop");
						const starts = ties.some((t) => t.getAttribute("type") === "start");
						const held = tied.get(pitch);
						if (stops && held) {
							held.durationSteps += durSteps;
							// 伸ばした先に付いたブレスや松葉は、伸ばした音そのものに付ける。
							held.lyric = appendMarks(held.lyric, marks);
							if (!starts) tied.delete(pitch);
						} else {
							const placed: MusicXmlNotePlacement = {
								partIndex,
								startStep: Math.max(0, Math.round(start)),
								pitch,
								durationSteps: Math.max(1, durSteps),
								lyric: lyricWithMarks(text, marks),
							};
							placements.push(placed);
							count++;
							pitchSum += pitch;
							if (starts) tied.set(pitch, placed);
						}
					}
				}

				if (!isChord) {
					lastStart = start;
					lastDurSteps = durSteps;
					cursor += durSteps;
				} else {
					// 和音の中で音価が食い違うファイルがある。長いほうに合わせる。
					lastDurSteps = Math.max(lastDurSteps, durSteps);
				}
			}
		}

		parts.push({
			index: partIndex,
			name: nameById.get(id) || `Part ${partIndex + 1}`,
			noteCount: count,
			hasLyrics: lyricSeen,
			avgPitch: count > 0 ? pitchSum / count : 0,
		});
	});

	return { parts, placements, bpm: bpm > 0 ? Math.round(bpm) : 120 };
};

// ============================================================
// 書き出し
// ============================================================

export type ExportMusicXmlPart = {
	/** パート名。楽譜ソフトの左端に出る。 */
	name: string;
	notes: Note[];
	/**
	 * 音符に付ける歌詞（`displayKana` の形: 文字 + `、` `↑` `↓`、継続は `ー` `〜`）。
	 * `notes` と同じ並び順で対応させる。短ければ足りないぶんは付かない。
	 * 記号は楽譜の要素（ブレス記号・松葉・メリスマ線・スライド）へ写す。
	 */
	lyrics?: string[];
};

export type ExportMusicXmlOptions = {
	parts: ExportMusicXmlPart[];
	bpm: number;
	stepsPerBar: number;
	/** 曲名。`<work-title>` に入る。 */
	title?: string;
};

/** 半音 → 綴り。**♯側で書く。** 調号を持たないので、どちらかに決め打つしかない。 */
const SHARP_SPELLING: [string, number][] = [
	["C", 0],
	["C", 1],
	["D", 0],
	["D", 1],
	["E", 0],
	["F", 0],
	["F", 1],
	["G", 0],
	["G", 1],
	["A", 0],
	["A", 1],
	["B", 0],
];

/** ステップ数 → `<type>`。近いものを選ぶ（付点は `<dot>` で足す）。 */
const NOTE_TYPES: [number, string][] = [
	[STEPS_PER_BEAT * 4, "whole"],
	[STEPS_PER_BEAT * 2, "half"],
	[STEPS_PER_BEAT, "quarter"],
	[STEPS_PER_BEAT / 2, "eighth"],
	[STEPS_PER_BEAT / 4, "16th"],
	[STEPS_PER_BEAT / 8, "32nd"],
];

const typeOf = (steps: number): { type: string; dots: number } => {
	for (const [len, type] of NOTE_TYPES) {
		if (steps >= len) {
			// 付点は1つまで。2つ以上要る音価は、見た目が合わなくても諦める
			// （`<duration>` が正しければ鳴りと編集は合う）。
			const dots = steps >= len * 1.5 && steps < len * 2 ? 1 : 0;
			return { type, dots };
		}
	}
	return { type: "32nd", dots: 0 };
};

const esc = (s: string): string =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/**
 * トラック群から MusicXML（`score-partwise`）を作る。
 *
 * **同時刻に始まる音は `<chord>` でまとめる。** ここを素直に並べて書くと、重なって
 * いた音が後ろへずれて**曲が変わる**（実測で 384/67 の音が 432 へ動いた）。
 * `<chord>` は声部の概念ではなく「直前の音と同時に鳴る」という意味なので、
 * 声部を持たないピアノロールでもそのまま使える。
 *
 * 声部は分けない。開始位置が違うまま重なる音（`<backup>` が要る形）は、
 * **次の音までで切る**——位置は保たれ、音価だけが短くなる。小節をまたぐ音を
 * 小節の終わりで切るのと同じ扱いで、鳴りの開始と高さは変えない。
 */
export const exportMusicXML = (options: ExportMusicXmlOptions): string => {
	const { parts, bpm, stepsPerBar, title } = options;
	const beatsPerBar = Math.max(1, Math.round(stepsPerBar / STEPS_PER_BEAT));

	const partList = parts
		.map(
			(p, i) =>
				`    <score-part id="P${i + 1}">\n      <part-name>${esc(p.name)}</part-name>\n    </score-part>`,
		)
		.join("\n");

	const body = parts
		.map((part, pi) => {
			const notes = [...part.notes].sort((a, b) => a.startStep - b.startStep);
			const end = notes.reduce(
				(m, n) => Math.max(m, n.startStep + n.durationSteps),
				0,
			);
			const bars = Math.max(1, Math.ceil(end / stepsPerBar));
			const lines: string[] = [`  <part id="P${pi + 1}">`];

			const syl = (part.lyrics ?? []).map(splitLyric);
			/** 松葉の終わり（伸ばした音の後ろ）を待っている開始。 */
			const openWedges: { endLi: number; number: number }[] = [];
			/** 歌詞 `li` から続く継続（ー / 〜）の末尾の index。 */
			const lastOfGroup = (from: number): number => {
				let end = from;
				while (syl[end + 1]?.tie || syl[end + 1]?.portamento) end++;
				return end;
			};

			let li = 0;
			for (let bar = 0; bar < bars; bar++) {
				const from = bar * stepsPerBar;
				const to = from + stepsPerBar;
				lines.push(`    <measure number="${bar + 1}">`);
				if (bar === 0) {
					lines.push(
						`      <attributes>\n        <divisions>${STEPS_PER_BEAT}</divisions>`,
						`        <key><fifths>0</fifths></key>`,
						`        <time><beats>${beatsPerBar}</beats><beat-type>4</beat-type></time>`,
						`        <clef><sign>G</sign><line>2</line></clef>\n      </attributes>`,
					);
					if (pi === 0)
						lines.push(
							`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`,
						);
				}

				// この小節に入る音を、**同時刻ごとにまとめて**休符で繋ぎながら並べる。
				let cursor = from;
				const inBar = notes.filter(
					(n) => n.startStep >= from && n.startStep < to,
				);
				/** 開始位置 → 同時に鳴る音。順番は開始位置の昇順。 */
				const groups = new Map<number, Note[]>();
				for (const n of inBar) {
					const g = groups.get(n.startStep);
					if (g) g.push(n);
					else groups.set(n.startStep, [n]);
				}
				const starts = [...groups.keys()].sort((a, b) => a - b);
				for (let gi = 0; gi < starts.length; gi++) {
					const at = starts[gi];
					const group = groups.get(at) as Note[];
					if (at > cursor) {
						const { type, dots } = typeOf(at - cursor);
						lines.push(
							`      <note><rest/><duration>${at - cursor}</duration><type>${type}</type>${"<dot/>".repeat(dots)}</note>`,
						);
						cursor = at;
					}
					// **次の音まで／小節の終わりまでで切る。** またいだまま書くと小節の
					// 合計が拍子と合わず、楽譜ソフトが読めない。位置と高さは変えない。
					const nextAt = gi + 1 < starts.length ? starts[gi + 1] : to;
					const room = Math.min(to, nextAt) - at;
					const dur = Math.max(
						1,
						Math.min(Math.max(...group.map((n) => n.durationSteps)), room),
					);
					// この音の歌詞と、そこから起こす記譜要素。和音は先頭の音にだけ付ける。
					const s = syl[li];
					const next = syl[li + 1];
					if (s?.fadeIn) {
						openWedges.push({ endLi: lastOfGroup(li), number: 1 });
						lines.push(
							`      <direction placement="below"><direction-type><wedge type="crescendo" number="1"/></direction-type></direction>`,
						);
					}
					if (s?.fadeOut) {
						openWedges.push({ endLi: lastOfGroup(li), number: 2 });
						lines.push(
							`      <direction placement="below"><direction-type><wedge type="diminuendo" number="2"/></direction-type></direction>`,
						);
					}
					const notations: string[] = [];
					if (s?.portamento) notations.push(`<slide type="stop" number="1"/>`);
					if (next?.portamento)
						notations.push(`<slide type="start" number="1"/>`);
					if (s?.breath)
						notations.push(`<articulations><breath-mark/></articulations>`);
					const notationsXml = notations.length
						? `<notations>${notations.join("")}</notations>`
						: "";
					// 継続（ー / 〜）は歌詞の無い音符。直前の歌詞にメリスマ線を付けて繋ぐ。
					const lyricXml =
						s && !s.tie && !s.portamento && s.text
							? `<lyric><syllabic>single</syllabic><text>${esc(s.text)}</text>${next?.tie || next?.portamento ? "<extend/>" : ""}</lyric>`
							: "";
					group.forEach((n, ni) => {
						const semi = Math.round(n.pitchUnits / UNITS_PER_SEMITONE);
						const [step, alter] = SHARP_SPELLING[((semi % 12) + 12) % 12];
						const octave = Math.floor(semi / 12) - 1;
						const { type, dots } = typeOf(dur);
						lines.push(
							`      <note>${ni > 0 ? "<chord/>" : ""}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>` +
								`<duration>${dur}</duration><type>${type}</type>${"<dot/>".repeat(dots)}` +
								(ni === 0 ? notationsXml + lyricXml : "") +
								`</note>`,
						);
					});
					// 松葉の終わり: 伸ばした音（継続で繋いだ最後）の後ろに置く。
					for (let wi = openWedges.length - 1; wi >= 0; wi--) {
						if (openWedges[wi].endLi !== li) continue;
						lines.push(
							`      <direction placement="below"><direction-type><wedge type="stop" number="${openWedges[wi].number}"/></direction-type></direction>`,
						);
						openWedges.splice(wi, 1);
					}
					li++;
					cursor = at + dur;
				}
				if (cursor < to) {
					const { type, dots } = typeOf(to - cursor);
					lines.push(
						`      <note><rest/><duration>${to - cursor}</duration><type>${type}</type>${"<dot/>".repeat(dots)}</note>`,
					);
				}
				lines.push("    </measure>");
			}
			lines.push("  </part>");
			return lines.join("\n");
		})
		.join("\n");

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
		'<score-partwise version="4.0">',
		`  <work><work-title>${esc(title ?? "Untitled")}</work-title></work>`,
		// 書き出し元を残す。MML・MIDI と揃えてある（`src/version.ts` に理由）。
		`  <identification><encoding><software>dtm ${DTM_VERSION}</software></encoding></identification>`,
		"  <part-list>",
		partList,
		"  </part-list>",
		body,
		"</score-partwise>",
		"",
	].join("\n");
};

/**
 * 取り込んだ音を、このライブラリのノート表現へ写す。
 *
 * `id` は付けない——採番はピアノロール側（`addNote`）の仕事で、ここで振ると
 * 既存のノートと衝突する。MIDI 取り込みが `MidiNotePlacement` を返して
 * 呼び出し側に置かせているのと同じ形。
 */
export const musicXmlToNotes = (
	placements: MusicXmlNotePlacement[],
	partIndex: number,
): Omit<Note, "id">[] =>
	placements
		.filter((p) => p.partIndex === partIndex)
		.map((p) => ({
			startStep: p.startStep,
			durationSteps: p.durationSteps,
			pitchUnits: (p.pitch * UNITS_PER_SEMITONE) as Units,
			velocity: 100,
		}));
