/**
 * 界隈曲の「骨格」——所有者の耳コピ MIDI から曲ごとに抜き出した設計図。
 *
 * 抽出（`scripts/corpus/extract-skeletons.ts`）と生成（骨格借用）の両方がこの型を読む。
 * 形を変えるときは両者を同じ変更で揃える。データ本体は `compose-skeletons.ts`（自動生成）。
 *
 * 基準の取り方（生成側もこの前提で読む）:
 * - 和音名・度数・ベースは、曲の主音を短調なら A、長調なら C へ移調した後の値。
 * - 度数は C を 0 とするダイアトニック度数（C=0 D=1 E=2 F=3 G=4 A=5 B=6）。C4（MIDI 60）が 0 で、
 *   オクターブは ±7。調の外の音は最寄りの下の度数へ寄せる（CORPUS_PHRASES と同じ表）。
 * - ベースの rel は「移調後の MIDI ノート − (36 + その時点の和音ルートの pc)」。つまり
 *   ルートを C2〜B2（36〜47）に置いたときの半音差で、0 がルートそのもの、12 が1オクターブ上。
 */

import { parseChord } from "@onjmin/chord-parser";
import type { ChordPatternType } from "../chord/chords";
import type { SectionKind } from "./compose-sections";

/** 骨格が持つセクション種（compose-sections.ts の SectionKind の部分集合。ずれは型で止める）。 */
export type SkeletonSectionKind = Extract<
	SectionKind,
	"intro" | "verse" | "chorus" | "bridge" | "interlude" | "outro"
>;

export type SkeletonSection = {
	kind: SkeletonSectionKind;
	start: number;
	bars: number;
};

export type SkeletonLayers = {
	arp: boolean;
	pad: boolean;
	counter: boolean;
	stab: boolean;
};

export type SkeletonBar = {
	/** 半小節ごとの和音名。曲の主音を短調なら A、長調なら C へ移調した名前（例 "Am7","E7","FM7","Bm7-5","E+","Db7","Em7/A"）。null は前の和音の継続。 */
	chords: [string | null, string | null];
	/** ベース: この小節のオンセット（0..191 ステップ）と、各音の「その時点の和音ルートからの半音差」（例 0,12,7,-1）。休みなら空配列。 */
	bass: { steps: number[]; rel: number[]; durs: number[] };
	/** 主旋律: 歌う小節なら rhythm（RhythmCell と同じ、正=音・負=休符、合計192）と degrees（Aマイナー/C長調基準のダイアトニック度数。0=C … 5=A、オクターブは ±7。**C4=0 の絶対度数**で、CORPUS_PHRASES の「1音目=0」の相対度数とは違う）。歌わない小節は null。 */
	melody: { rhythm: number[]; degrees: number[] } | null;
	/** この小節の主旋律が何小節目の再現か（リズムも度数も同じ）。**曲頭から**探すのでセクションを跨ぐ（2番サビ＝1番サビ）。無ければ null。 */
	sameAs: number | null;
	/** リズムだけ同じ先行小節（度数は違う）。sameAs と同じく曲頭から探す。無ければ null。 */
	rhythmSameAs: number | null;
	/** 鳴っている層（主旋律・ベース・ドラム以外）。 */
	layers: SkeletonLayers;
};

/** 伴奏の刻み。chords.ts の型そのもの（生成側は buildChordPlacements へそのまま渡す）。 */
export type SkeletonChordPattern = ChordPatternType;

export type Skeleton = {
	/** 出自（作者/曲名/ファイル）。docs と試聴の表示にだけ使う。 */
	id: string;
	mode: "minor" | "major";
	bpm: number;
	bars: number;
	sections: SkeletonSection[];
	barsData: SkeletonBar[];
	/** 曲で最も使われた1小節のドラム型。DRUM_PATTERNS のキー（辞書に無い型は抽出側が `kaiwai_*` として drum-config.ts に足す）。ドラム無しは "none"。 */
	drum: string;
	/** 伴奏の刻みの最近傍（chords.ts の ChordPatternType）。 */
	chordPattern: SkeletonChordPattern;
	/** 主旋律の音域の中心（MIDI ノート、元曲の実測。移調前）。生成側は「移調後の実音の中心」として読む——歌い手の音域は調に依らない。C3（48）未満は抽出が歌ではなくベース音域の ch を採った印。 */
	melodyCenter: number;
	/** 音色の手がかり: 主旋律/ベース/和音チャンネルの GM プログラム（無ければ null）と、INSTRUMENT_PRESETS の最近傍キー。 */
	programs: {
		melody: number | null;
		bass: number | null;
		chord: number | null;
	};
	instrument: string;
	/** 抽出の確度メモ（和音チャンネルの有無、主旋律の判定根拠、警告）。 */
	confidence: { chordTrack: boolean; melodyBy: string; warnings: string[] };
};

/**
 * 主旋律の中心がこれ（C3）未満の骨格は生成に使わない。抽出が「C3 以上の単旋律 ch が無い」曲で
 * ベース音域の ch を主旋律に採った印（62本中2本）。生成と UI の長さ表示が同じ門を通る。
 */
export const MELODY_CENTER_MIN = 48;
export const usableSkeletons = (skeletons: Skeleton[]): Skeleton[] =>
	skeletons.filter((s) => s.melodyCenter >= MELODY_CENTER_MIN);

// ============================================================
// 符号化（compose-skeletons.ts の要素数を抑えるための小節ごとの短い文字列）
// ============================================================

/** 1小節=192ステップ。符号化ではステップと音価を 16分（12ステップ）単位の整数で書く。 */
const STEPS_PER_BAR = 192;
const GRID = STEPS_PER_BAR / 16;

/**
 * 骨格1本の符号化形。`barsData` の各要素は小節1つで、`;` 区切りの6欄:
 *
 *   `<chords>;<bass>;<melody>;<sameAs>;<rhythmSameAs>;<layers>`
 *
 * - chords … `Am7|E7`。空欄は null（継続）。
 * - bass   … `s:r:d` を `,` で並べる。s と d は16分単位（0..16）、r は半音差。休みは空。
 * - melody … `<rhythm>=<degrees>`。rhythm は16分単位（負は休符）、degrees はそのまま。歌わなければ空。
 * - sameAs / rhythmSameAs … 小節番号。無ければ空。
 * - layers … `a`(arp) `p`(pad) `c`(counter) `s`(stab) の並び。
 *
 * chords / bass / melody の欄は `@<小節番号>` で先行する小節の同じ欄を指せる（同一内容の圧縮）。
 */
export type EncodedSkeleton = {
	id: string;
	mode: "minor" | "major";
	bpm: number;
	bars: number;
	/** `kind:start:bars` を `,` で並べる。 */
	sections: string;
	drum: string;
	chordPattern: SkeletonChordPattern;
	melodyCenter: number;
	/** `melody,bass,chord` の GM 番号。無ければ `-`。 */
	programs: string;
	instrument: string;
	confidence: { chordTrack: boolean; melodyBy: string; warnings: string[] };
	barsData: string[];
};

const encodeBar = (bar: SkeletonBar): string => {
	const chords = bar.chords.map((c) => c ?? "").join("|");
	const bass = bar.bass.steps
		.map((s, i) => `${s / GRID}:${bar.bass.rel[i]}:${bar.bass.durs[i] / GRID}`)
		.join(",");
	const melody = bar.melody
		? `${bar.melody.rhythm.map((v) => v / GRID).join(",")}=${bar.melody.degrees.join(",")}`
		: "";
	const layers = `${bar.layers.arp ? "a" : ""}${bar.layers.pad ? "p" : ""}${bar.layers.counter ? "c" : ""}${bar.layers.stab ? "s" : ""}`;
	return [
		chords,
		bass,
		melody,
		bar.sameAs ?? "",
		bar.rhythmSameAs ?? "",
		layers,
	].join(";");
};

export const encodeSkeleton = (s: Skeleton): EncodedSkeleton => {
	const raw = s.barsData.map(encodeBar);
	// chords / bass / melody の欄は、同じ文字列が先行小節にあればそこを指す。
	const seen: Map<string, number>[] = [new Map(), new Map(), new Map()];
	const barsData = raw.map((line, b) => {
		const cols = line.split(";");
		for (let k = 0; k < 3; k++) {
			const v = cols[k];
			if (v === "") continue;
			const prev = seen[k].get(v);
			if (prev !== undefined) cols[k] = `@${prev}`;
			else seen[k].set(v, b);
		}
		return cols.join(";");
	});
	return {
		id: s.id,
		mode: s.mode,
		bpm: s.bpm,
		bars: s.bars,
		sections: s.sections.map((x) => `${x.kind}:${x.start}:${x.bars}`).join(","),
		drum: s.drum,
		chordPattern: s.chordPattern,
		melodyCenter: s.melodyCenter,
		programs: [s.programs.melody, s.programs.bass, s.programs.chord]
			.map((p) => (p === null ? "-" : String(p)))
			.join(","),
		instrument: s.instrument,
		confidence: s.confidence,
		barsData,
	};
};

const numOrNull = (v: string): number | null => (v === "" ? null : Number(v));

export const decodeSkeleton = (e: EncodedSkeleton): Skeleton => {
	const cols: string[][] = [];
	const resolve = (b: number, k: number): string => {
		const v = cols[b][k];
		return v.startsWith("@") ? resolve(Number(v.slice(1)), k) : v;
	};
	const barsData: SkeletonBar[] = e.barsData.map((line, b) => {
		cols.push(line.split(";"));
		const chordCols = resolve(b, 0).split("|");
		const bassCol = resolve(b, 1);
		const melodyCol = resolve(b, 2);
		const bass = {
			steps: [] as number[],
			rel: [] as number[],
			durs: [] as number[],
		};
		if (bassCol !== "")
			for (const tok of bassCol.split(",")) {
				const [s, r, d] = tok.split(":").map(Number);
				bass.steps.push(s * GRID);
				bass.rel.push(r);
				bass.durs.push(d * GRID);
			}
		let melody: SkeletonBar["melody"] = null;
		if (melodyCol !== "") {
			const [rhythm, degrees] = melodyCol.split("=");
			melody = {
				rhythm: rhythm.split(",").map((v) => Number(v) * GRID),
				degrees: degrees === "" ? [] : degrees.split(",").map(Number),
			};
		}
		const layers = cols[b][5] ?? "";
		return {
			chords: [chordCols[0] || null, chordCols[1] || null],
			bass,
			melody,
			sameAs: numOrNull(cols[b][3]),
			rhythmSameAs: numOrNull(cols[b][4]),
			layers: {
				arp: layers.includes("a"),
				pad: layers.includes("p"),
				counter: layers.includes("c"),
				stab: layers.includes("s"),
			},
		};
	});
	const [pm, pb, pc] = e.programs
		.split(",")
		.map((p) => (p === "-" ? null : Number(p)));
	return {
		id: e.id,
		mode: e.mode,
		bpm: e.bpm,
		bars: e.bars,
		sections: e.sections
			? e.sections.split(",").map((tok) => {
					const [kind, start, bars] = tok.split(":");
					return {
						kind: kind as SkeletonSectionKind,
						start: Number(start),
						bars: Number(bars),
					};
				})
			: [],
		barsData,
		drum: e.drum,
		chordPattern: e.chordPattern,
		melodyCenter: e.melodyCenter,
		programs: { melody: pm, bass: pb, chord: pc },
		instrument: e.instrument,
		confidence: e.confidence,
	};
};

// ============================================================
// 検算（抽出の出力と、テストの実データ・fixture が同じ条件で通る）
// ============================================================

/** セクションの開始は4小節単位。 */
const SECTION_UNIT = 4;

/**
 * 骨格の不変条件を検算して、破れを文字列で返す（空なら OK）。
 * `drumKeys` は DRUM_PATTERNS のキー集合（`"none"` は辞書に無くてよい）。
 * 和音名は `parseChord` に通す（読めない名前は生成側で落ちる）。
 */
export const validateSkeletons = (
	skeletons: Skeleton[],
	drumKeys: Set<string>,
): string[] => {
	const errors: string[] = [];
	for (const s of skeletons) {
		const err = (msg: string): void => {
			errors.push(`${s.id}: ${msg}`);
		};
		if (s.barsData.length !== s.bars)
			err(`barsData ${s.barsData.length} ≠ bars ${s.bars}`);
		let covered = 0;
		let cursor = 0;
		for (const sec of s.sections) {
			if (sec.start !== cursor)
				err(`section ${sec.kind} が ${cursor} でなく ${sec.start} から`);
			if (sec.start % SECTION_UNIT !== 0)
				err(`section ${sec.kind} の開始 ${sec.start} が4の倍数でない`);
			cursor = sec.start + sec.bars;
			covered += sec.bars;
		}
		if (covered !== s.bars)
			err(`sections が ${covered} 小節（曲は ${s.bars}）`);
		if (s.drum !== "none" && !drumKeys.has(s.drum))
			err(`drum ${s.drum} が辞書に無い`);
		if (!s.barsData[0]?.chords[0]) err("1小節目の頭に和音が無い");
		s.barsData.forEach((b, i) => {
			for (const c of b.chords)
				if (c !== null) {
					try {
						parseChord(c);
					} catch {
						err(`小節 ${i} の和音 ${c} を parseChord が読めない`);
					}
				}
			if (b.melody) {
				const sum = b.melody.rhythm.reduce((a, v) => a + Math.abs(v), 0);
				if (sum !== STEPS_PER_BAR) err(`小節 ${i} の rhythm 合計 ${sum}`);
				if (
					b.melody.rhythm.filter((v) => v > 0).length !==
					b.melody.degrees.length
				)
					err(`小節 ${i} の音数と度数の数が違う`);
			}
			if (b.sameAs !== null && (b.sameAs >= i || !s.barsData[b.sameAs]?.melody))
				err(`小節 ${i} の sameAs ${b.sameAs} が前の歌う小節を指していない`);
			if (
				b.rhythmSameAs !== null &&
				(b.rhythmSameAs >= i || !s.barsData[b.rhythmSameAs]?.melody)
			)
				err(`小節 ${i} の rhythmSameAs ${b.rhythmSameAs} が前を指していない`);
			if (
				b.bass.steps.length !== b.bass.rel.length ||
				b.bass.steps.length !== b.bass.durs.length
			)
				err(`小節 ${i} のベース配列の長さが揃わない`);
			for (const st of b.bass.steps)
				if (st < 0 || st >= STEPS_PER_BAR) err(`小節 ${i} のベース step ${st}`);
		});
	}
	return errors;
};
