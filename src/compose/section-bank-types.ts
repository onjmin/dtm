/**
 * 継ぎ合わせ（`compose-splice.ts`）が読む**抽象骨格バンク**の型と符号化。
 *
 * 骨格（`skeleton-types.ts`、耳コピの和音・ベース・旋律をそのまま持つ）から
 * `scripts/corpus/build-section-bank.ts` が作る。単位はセクションで、**元曲を特定できる情報を持たない**:
 * 曲名・ファイル名・旋律の度数・ベースの実音は落とし、和音名（Am/C 基準）・ベースの型の種類・
 * 歌メロのリズム・反復の地図・層だけを残す。データ本体は `compose-section-bank.ts`（自動生成。
 * 骨格データと違って **git とバンドルに入れる**）。
 */

import type { ChordPatternType } from "../chord/chords";
import type { SkeletonSectionKind } from "./skeleton-types";

type BankSectionKind = SkeletonSectionKind;

/** 歌うセクションの種類。ベースの donor が全小節 rest でもここは無音にしない。 */
export const isSungKind = (kind: BankSectionKind): boolean =>
	kind === "verse" || kind === "bridge" || kind === "chorus";

/**
 * 歌わない種類（intro/interlude/outro）の長さの上限（小節）。抽出のセクション分けが大きな後奏を
 * まとめた 64〜72 小節の outro があり、そのまま構成に使うと歌 14 小節の 88 小節曲になる。
 * バンクを作るときにここで頭打ちにし、生成の揺らぎも超えない。
 */
export const NON_SUNG_MAX_BARS = 16;

/**
 * 構成の長さを揺らす候補（重み付き。生成は抽選、UI の長さ表示は min/max）。intro は 2/4/8 の
 * 近いもの（無ければ 8）、他は ±4 で 4 以上、歌わない種類は {@link NON_SUNG_MAX_BARS} まで。
 */
export const bankSectionBarChoices = (
	kind: BankSectionKind,
	base: number,
): number[] => {
	if (kind === "intro") {
		const near = [2, 4, 8].filter((c) => Math.abs(c - base) <= 4);
		return near.length > 0 ? near : [8];
	}
	const cap = isSungKind(kind) ? Number.POSITIVE_INFINITY : NON_SUNG_MAX_BARS;
	return [-4, 0, 0, 4].map((d) => Math.min(cap, Math.max(4, base + d)));
};

/**
 * ベースの型の種類。実音は持たず、生成側が型テンプレートからその時点の和音ルートで作る。
 * 分類の規則は `build-section-bank.ts` の `classifyBass`。`offbeat`（裏打ち）は仕様の一覧に無かったが
 * 実データで 8分オクターブ・休みに次いで多い型なので足した。
 */
export type BassFigure =
	| "octave8"
	| "root8"
	| "dotted"
	| "fifthmix"
	| "tresillo"
	| "quarter"
	| "offbeat"
	| "sustain"
	| "rest"
	| "other";

export type BankSection = {
	kind: BankSectionKind;
	/** 元曲の長短。生成側は曲の長短と同じ donor だけを引く（和音名の基準が Am/C で違う）。 */
	mode: "minor" | "major";
	/** 4 の倍数（余りは切ってある）。 */
	bars: number;
	/** 元曲の通し番号（匿名）。同じ番号＝同じ曲。 */
	src: number;
	/** 小節ごと [前半, 後半]。Am/C 基準の和音名。null は前の和音の継続（先頭小節の前半は必ず名前）。 */
	chords: (string | null)[][];
	/** 小節ごとのベースの型の種類。 */
	bass: BassFigure[];
	/** 元曲のドラム型（DRUM_PATTERNS のキー or "none"）。 */
	drum: string;
	/** 伴奏の刻み。 */
	chordPattern: ChordPatternType;
	/** 小節ごとの歌メロのリズム（RhythmCell と同じ、正=音・負=休符、合計 192）。null は歌わない。度数は持たない。 */
	rhythm: (number[] | null)[];
	/** セクション内の反復の地図（セクション先頭からの相対小節番号）。 */
	sameAs: (number | null)[];
	rhythmSameAs: (number | null)[];
	layers: { arp: boolean; pad: boolean }[];
	/** 歌の音域の中心（曲の主音からの半音差。実音ではない）。 */
	melodyCenterRel: number;
};

export type BankForm = {
	kinds: BankSectionKind[];
	bars: number[];
	src: number;
	mode: "minor" | "major";
};

// ============================================================
// 符号化（compose-section-bank.ts を小さく保つ）
// ============================================================

const STEPS_PER_BAR = 192;
const GRID = STEPS_PER_BAR / 16;

const FIGURE_CODE: Record<BassFigure, string> = {
	octave8: "o",
	root8: "r",
	dotted: "d",
	fifthmix: "f",
	tresillo: "t",
	quarter: "q",
	offbeat: "b",
	sustain: "s",
	rest: "-",
	other: "x",
};
const CODE_FIGURE = new Map(
	Object.entries(FIGURE_CODE).map(([k, v]) => [v, k as BassFigure]),
);

/**
 * セクション1つの符号化形。`b` の各要素は小節1つで `;` 区切りの6欄:
 * `<chords>;<bass>;<rhythm>;<sameAs>;<rhythmSameAs>;<layers>`。
 * chords は `Am7|E7`（空欄は継続、両半小節が同じなら1つ）、bass は型の1文字、rhythm は16分単位、
 * layers は `a`/`p` の並び。chords / rhythm の欄は `@<小節>` で先行する小節の同じ欄を指せる。
 */
export type EncodedBankSection = {
	k: BankSectionKind;
	m: "minor" | "major";
	n: number;
	s: number;
	d: string;
	p: ChordPatternType;
	c: number;
	b: string[];
};

export const encodeBankSection = (sec: BankSection): EncodedBankSection => {
	const seen: Map<string, number>[] = [new Map(), new Map()];
	const b = sec.chords.map((chords, i) => {
		const [c0, c1] = chords;
		const chordCol =
			c1 === null || c1 === c0 ? (c0 ?? "") : `${c0 ?? ""}|${c1}`;
		const rhythm = sec.rhythm[i];
		const rhythmCol = rhythm ? rhythm.map((v) => v / GRID).join(",") : "";
		const cols = [
			chordCol,
			FIGURE_CODE[sec.bass[i]],
			rhythmCol,
			sec.sameAs[i] === null ? "" : String(sec.sameAs[i]),
			sec.rhythmSameAs[i] === null ? "" : String(sec.rhythmSameAs[i]),
			`${sec.layers[i].arp ? "a" : ""}${sec.layers[i].pad ? "p" : ""}`,
		];
		for (const [k, col] of [
			[0, 0],
			[2, 1],
		] as const) {
			const v = cols[k];
			if (v === "") continue;
			const prev = seen[col].get(v);
			if (prev !== undefined) cols[k] = `@${prev}`;
			else seen[col].set(v, i);
		}
		return cols.join(";");
	});
	return {
		k: sec.kind,
		m: sec.mode,
		n: sec.bars,
		s: sec.src,
		d: sec.drum,
		p: sec.chordPattern,
		c: sec.melodyCenterRel,
		b,
	};
};

export const decodeBankSection = (e: EncodedBankSection): BankSection => {
	const cols: string[][] = [];
	const resolve = (i: number, k: number): string => {
		const v = cols[i][k];
		return v.startsWith("@") ? resolve(Number(v.slice(1)), k) : v;
	};
	const chords: (string | null)[][] = [];
	const bass: BassFigure[] = [];
	const rhythm: (number[] | null)[] = [];
	const sameAs: (number | null)[] = [];
	const rhythmSameAs: (number | null)[] = [];
	const layers: { arp: boolean; pad: boolean }[] = [];
	e.b.forEach((line, i) => {
		cols.push(line.split(";"));
		const chordCol = resolve(i, 0);
		const parts = chordCol.split("|");
		chords.push([parts[0] || null, parts[1] || null]);
		bass.push(CODE_FIGURE.get(cols[i][1]) ?? "other");
		const rhythmCol = resolve(i, 2);
		rhythm.push(
			rhythmCol === ""
				? null
				: rhythmCol.split(",").map((v) => Number(v) * GRID),
		);
		sameAs.push(cols[i][3] === "" ? null : Number(cols[i][3]));
		rhythmSameAs.push(cols[i][4] === "" ? null : Number(cols[i][4]));
		layers.push({
			arp: cols[i][5].includes("a"),
			pad: cols[i][5].includes("p"),
		});
	});
	return {
		kind: e.k,
		mode: e.m,
		bars: e.n,
		src: e.s,
		chords,
		bass,
		drum: e.d,
		chordPattern: e.p,
		rhythm,
		sameAs,
		rhythmSameAs,
		layers,
		melodyCenterRel: e.c,
	};
};

/** バンクの不変条件を検算して破れを返す（空なら OK）。抽出とテストが同じ条件で通る。 */
export const validateSectionBank = (
	sections: BankSection[],
	forms: BankForm[],
	drumKeys: Set<string>,
	parse: (name: string) => void,
): string[] => {
	const errors: string[] = [];
	sections.forEach((s, idx) => {
		const err = (msg: string): void => {
			errors.push(`section ${idx} (${s.kind}, src ${s.src}): ${msg}`);
		};
		if (s.bars <= 0 || s.bars % 4 !== 0) err(`bars ${s.bars} が4の倍数でない`);
		for (const list of [
			s.chords,
			s.bass,
			s.rhythm,
			s.sameAs,
			s.rhythmSameAs,
			s.layers,
		])
			if (list.length !== s.bars)
				err(`配列の長さ ${list.length} ≠ bars ${s.bars}`);
		if (!s.chords[0]?.[0]) err("先頭小節の前半に和音が無い");
		if (s.drum !== "none" && !drumKeys.has(s.drum))
			err(`drum ${s.drum} が辞書に無い`);
		s.chords.forEach((pair, i) => {
			for (const c of pair)
				if (c !== null) {
					try {
						parse(c);
					} catch {
						err(`小節 ${i} の和音 ${c} が読めない`);
					}
				}
		});
		s.rhythm.forEach((r, i) => {
			if (!r) return;
			const sum = r.reduce((a, v) => a + Math.abs(v), 0);
			if (sum !== STEPS_PER_BAR) err(`小節 ${i} の rhythm 合計 ${sum}`);
		});
		s.sameAs.forEach((v, i) => {
			if (v !== null && (v >= i || !s.rhythm[v]))
				err(`小節 ${i} の sameAs ${v}`);
		});
		s.rhythmSameAs.forEach((v, i) => {
			if (v !== null && (v >= i || !s.rhythm[v]))
				err(`小節 ${i} の rhythmSameAs ${v}`);
		});
	});
	forms.forEach((f, idx) => {
		if (f.kinds.length !== f.bars.length || f.kinds.length === 0)
			errors.push(
				`form ${idx}: kinds ${f.kinds.length} / bars ${f.bars.length}`,
			);
		f.kinds.forEach((k, i) => {
			if (
				!sections.some(
					(s) => s.src === f.src && s.kind === k && s.bars === f.bars[i],
				)
			)
				errors.push(
					`form ${idx}: ${k} ${f.bars[i]} 小節の donor が src ${f.src} に無い`,
				);
		});
	});
	return errors;
};
