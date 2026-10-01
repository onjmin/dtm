/**
 * 抽象骨格バンクの生成。手元の骨格データ（`src/compose/compose-skeletons.ts`、git に入れない）から
 * セクション単位の設計図を抜き、`src/compose/compose-section-bank.ts`（git にもバンドルにも入れない）を書く。
 *
 *   npx tsx scripts/corpus/build-section-bank.ts [--out src/compose/compose-section-bank.ts] [--check]
 *
 * 落とすもの: 曲名・ファイル名・旋律の度数・ベースの実音・bpm・GM 音色。残すもの: 和音名（Am/C 基準）・
 * ベースの型の種類・ドラム型・刻み・歌メロのリズムと反復の地図・層・音域の中心（主音からの半音差）。
 * 元曲の通し番号 `src` は id 順の添字（対応表は tmp/section-bank-map.json に置く。git に入れない）。
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { parseChord } from "@onjmin/chord-parser";
import { type FitBar, headOfBar } from "../../src/compose/compose-melody-fit";
import {
	type BankForm,
	type BankSection,
	type BassFigure,
	decodeBankSection,
	type EncodedBankSection,
	encodeBankSection,
	isSungKind,
	NON_SUNG_MAX_BARS,
	validateSectionBank,
} from "../../src/compose/section-bank-types";
import type { Skeleton, SkeletonBar } from "../../src/compose/skeleton-types";
import { DRUM_PATTERNS } from "../../src/instruments/drum-config";
import { bankSourceOrder, loadSkeletons } from "./skeleton-data";

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = join(__dirname, "../../");
const outArg = argOf("--out") ?? "src/compose/compose-section-bank.ts";
const OUT = isAbsolute(outArg) ? outArg : join(ROOT, outArg);
const CHECK_ONLY = argv.includes("--check");

const BAR = 192;
const HALF = BAR / 2;
const EIGHTH = BAR / 8;
const UNIT = 4;

/**
 * donor に使わないセクション。置換は最初と最後の和音に掛けないので、和音が 2 つ以下（4 小節でも
 * 8 小節へ繰り返すと 16 半小節そのまま残る）、または最初／最後の和音が MAX_FIXED_HALF_BARS 半小節を
 * 超えて続くセクションは、donor と同じ並びを 12 半小節以下に縮められない（src42 のサビ
 * `Gdim7 | F | 継続×14` など）。調外のルートが過半のセクションは抽出の和音名がクロマチックに付いた印
 * （長調の outro `F#M7 F7 Db G#m7`）で、置換表にも無い。
 */
const MAX_FIXED_HALF_BARS = 12;
const MINOR_ROOTS = new Set([9, 11, 0, 2, 4, 5, 7, 8]);
const MAJOR_ROOTS = new Set([0, 2, 4, 5, 7, 9, 11]);
const pcOf = (v: number): number => ((v % 12) + 12) % 12;
const rootPcOf = (name: string): number => {
	try {
		return pcOf(parseChord(name).notes[0] ?? 0);
	} catch {
		return 0;
	}
};
export const donorRejection = (
	chords: (string | null)[][],
	mode: "minor" | "major",
): string | null => {
	const tokens: number[] = [];
	chords.forEach((pair, bar) => {
		if (pair[0] !== null) tokens.push(bar * 2);
		if (pair[1] !== null) tokens.push(bar * 2 + 1);
	});
	const halfBars = chords.length * 2;
	if (tokens.length <= 2) return "few_chords";
	const firstSpan = (tokens[1] ?? halfBars) - tokens[0];
	const lastSpan = halfBars - tokens[tokens.length - 1];
	if (firstSpan > MAX_FIXED_HALF_BARS || lastSpan > MAX_FIXED_HALF_BARS)
		return "long_fixed_chord";
	const names = chords.flat().filter((c): c is string => c !== null);
	const inKey = mode === "minor" ? MINOR_ROOTS : MAJOR_ROOTS;
	const out = names.filter((c) => !inKey.has(rootPcOf(c))).length;
	if (out * 2 > names.length) return "out_of_key_roots";
	return null;
};

// ============================================================
// ベースの型の分類
// ============================================================

/**
 * 1小節のベース（オンセット・ルートからの半音差）を型の種類へ落とす。実音は捨てる。
 * 判定は上から順（先に当たった型）。8分格子＝全オンセットが 24 の倍数。
 */
export const classifyBass = (bass: SkeletonBar["bass"]): BassFigure => {
	const n = bass.steps.length;
	if (n === 0) return "rest";
	const steps = bass.steps;
	const rel = bass.rel;
	const on = (grid: number): boolean => steps.every((s) => s % grid === 0);
	const within = (set: number[]): boolean =>
		steps.every((s) => set.includes(s));
	// 全音符・2分音符の持続
	if (n <= 2 && bass.durs.every((d) => d >= HALF)) return "sustain";
	// 3:3:2（付点8分・付点8分・8分。ヤツメ穴型）
	if (
		n >= 4 &&
		within([0, 36, 72, 96, 132, 168]) &&
		steps.some((s) => s === 36 || s === 132)
	)
		return "tresillo";
	// 付点8分＋16分（ギャロップ）
	if (
		n >= 4 &&
		within([0, 36, 48, 84, 96, 132, 144, 180]) &&
		steps.some((s) => s % 48 === 36)
	)
		return "dotted";
	if (n >= 3 && within([0, 48, 96, 144])) return "quarter";
	if (n >= 3 && within([24, 72, 120, 168])) return "offbeat";
	if (n >= 6 && on(EIGHTH)) {
		// 型は形で決める。ルートからの半音差の pc は見ない（和音名がベースと食い違う小節でも往復は往復）。
		let octaveFlips = 0;
		let fifthMoves = 0;
		for (let i = 1; i < n; i++) {
			const d = Math.abs(rel[i] - rel[i - 1]);
			if (d === 12) octaveFlips++;
			if (d % 12 === 7 || d % 12 === 5) fifthMoves++;
		}
		if (octaveFlips >= n - 3) return "octave8";
		if (new Set(rel).size <= 2 && octaveFlips === 0 && fifthMoves === 0)
			return "root8";
		if (octaveFlips + fifthMoves >= n - 3) return "fifthmix";
	}
	return "other";
};

// ============================================================
// 骨格 → セクション
// ============================================================

/** ダイアトニック度数（C=0）→ C4 からの半音。 */
const MAJOR_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const degreeSemi = (d: number): number =>
	MAJOR_SEMIS[((d % 7) + 7) % 7] + Math.floor(d / 7) * 12;

const rhythmKey = (r: number[]): string => r.join(",");

type Built = {
	sections: BankSection[];
	forms: BankForm[];
	stats: Record<string, number>;
};

export const buildBank = (skeletons: Skeleton[]): Built => {
	const sections: BankSection[] = [];
	const forms: BankForm[] = [];
	const stats: Record<string, number> = {};
	const bump = (k: string): void => {
		stats[k] = (stats[k] ?? 0) + 1;
	};
	skeletons.forEach((skel, src) => {
		const data = skel.barsData;
		const sung = (b: number): boolean =>
			b >= 0 && b < skel.bars && data[b]?.melody !== null;
		/** sameAs 連鎖の先頭。生成側（compose-melody-fit.ts の headOfBar）と同じ規則で解く。 */
		const fitBars: FitBar[] = data.map((bar) =>
			bar.melody
				? {
						rhythm: bar.melody.rhythm,
						sameAs: bar.sameAs,
						rhythmSameAs: bar.rhythmSameAs,
					}
				: null,
		);
		const headOf = (b: number): number => headOfBar(fitBars, b);
		// 曲全体の音域の中心（歌わないセクションの既定）。主音（短調 A3=57、長調 C4=60）からの半音差。
		const tonic = skel.mode === "minor" ? 57 : 60;
		const centerOf = (bars: number[]): number | null => {
			const semis: number[] = [];
			for (const b of bars)
				for (const d of data[b]?.melody?.degrees ?? [])
					semis.push(60 + degreeSemi(d));
			if (semis.length === 0) return null;
			semis.sort((a, b) => a - b);
			return semis[semis.length >> 1] - tonic;
		};
		const songCenter = centerOf([...Array(skel.bars).keys()]) ?? 12;
		// 和音の継続を解く（セクションの先頭小節の前半に必ず名前を置くため）。
		const resolved: [string, string][] = [];
		let prev = skel.mode === "minor" ? "Am" : "C";
		for (let b = 0; b < skel.bars; b++) {
			const [c0, c1] = data[b]?.chords ?? [null, null];
			const first = c0 ?? prev;
			const second = c1 ?? first;
			resolved.push([first, second]);
			prev = second;
		}
		const form: BankForm = { kinds: [], bars: [], src, mode: skel.mode };
		for (const sec of skel.sections) {
			// 歌わない種類は NON_SUNG_MAX_BARS で頭打ち（抽出が大きな後奏を 1 セクションにまとめている）。
			const bars = Math.min(
				isSungKind(sec.kind) ? Number.POSITIVE_INFINITY : NON_SUNG_MAX_BARS,
				Math.floor(sec.bars / UNIT) * UNIT,
			);
			if (bars === 0) {
				bump("dropped_short");
				continue;
			}
			const start = sec.start;
			const end = start + bars;
			const chords: (string | null)[][] = [];
			const bass: BassFigure[] = [];
			const rhythm: (number[] | null)[] = [];
			const sameAs: (number | null)[] = [];
			const rhythmSameAs: (number | null)[] = [];
			const layers: { arp: boolean; pad: boolean }[] = [];
			let last: string | null = null;
			for (let b = start; b < end; b++) {
				const bar = data[b];
				const [c0, c1] = resolved[b];
				// 継続は null に戻す（置換が和音の塊ごとに掛かるように）。先頭小節の前半だけは必ず名前。
				const first = b === start || c0 !== last ? c0 : null;
				const second = c1 === (first ?? last) ? null : c1;
				chords.push([first, second]);
				last = c1;
				bass.push(classifyBass(bar.bass));
				bump(`bass_${bass[bass.length - 1]}`);
				const m = bar.melody;
				rhythm.push(m ? [...m.rhythm] : null);
				let same: number | null = null;
				let rhySame: number | null = null;
				if (m) {
					const head = headOf(b);
					if (head !== b) {
						if (head >= start && head < b) same = head - start;
						else
							for (let j = start; j < b; j++)
								if (sung(j) && headOf(j) === head) {
									same = j - start;
									break;
								}
					}
					if (same === null) {
						const key = rhythmKey(m.rhythm);
						for (let j = start; j < b; j++)
							if (sung(j) && rhythmKey(data[j].melody?.rhythm ?? []) === key) {
								rhySame = j - start;
								break;
							}
					}
				}
				sameAs.push(same);
				rhythmSameAs.push(rhySame);
				layers.push({ arp: bar.layers.arp, pad: bar.layers.pad });
			}
			const rejection = donorRejection(chords, skel.mode);
			if (rejection !== null) {
				bump(`dropped_${rejection}`);
				continue;
			}
			const center =
				centerOf([...Array(bars).keys()].map((i) => start + i)) ?? songCenter;
			sections.push({
				kind: sec.kind,
				mode: skel.mode,
				bars,
				src,
				chords,
				bass,
				drum: skel.drum,
				chordPattern: skel.chordPattern,
				rhythm,
				sameAs,
				rhythmSameAs,
				layers,
				melodyCenterRel: center,
			});
			bump(`kind_${sec.kind}`);
			form.kinds.push(sec.kind);
			form.bars.push(bars);
		}
		// 構成は「サビがあって 24 小節以上」の曲だけ（未完成の耳コピ 3 本を除く）。セクションは donor として残す。
		const total = form.bars.reduce((x, y) => x + y, 0);
		if (form.kinds.includes("chorus") && total >= 24) forms.push(form);
		else bump("dropped_form");
	});
	return { sections, forms, stats };
};

const renderTs = (
	sections: EncodedBankSection[],
	forms: BankForm[],
	songs: number,
): string => {
	const lines: string[] = [];
	lines.push(`/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/corpus/build-section-bank.ts
 *
 * 継ぎ合わせ（{@link file://./compose-splice.ts}）が引く抽象骨格バンク。界隈曲の耳コピ ${songs} 本の
 * セクション ${sections.length} 本と構成 ${forms.length} 本。曲名・旋律の度数・ベースの実音は持たない（形と符号化は
 * {@link file://./section-bank-types.ts}、作り方は {@link file://../../scripts/corpus/build-section-bank.ts}）。
 */

import {
	type BankForm,
	type BankSection,
	decodeBankSection,
	type EncodedBankSection,
} from "./section-bank-types";

const DATA: EncodedBankSection[] = [`);
	for (const e of sections) {
		lines.push(
			`\t{ k: ${JSON.stringify(e.k)}, m: ${JSON.stringify(e.m)}, n: ${e.n}, s: ${e.s}, d: ${JSON.stringify(e.d)}, p: ${JSON.stringify(e.p)}, c: ${e.c}, b: [`,
		);
		for (const b of e.b) lines.push(`\t\t${JSON.stringify(b)},`);
		lines.push("\t] },");
	}
	lines.push("];");
	lines.push("");
	lines.push(
		"export const SECTION_BANK: BankSection[] = DATA.map(decodeBankSection);",
	);
	lines.push("");
	lines.push("/** 曲ごとの構成（種類と長さだけ）。 */");
	lines.push("export const FORM_BANK: BankForm[] = [");
	for (const f of forms)
		lines.push(
			`\t{ kinds: ${JSON.stringify(f.kinds)}, bars: ${JSON.stringify(f.bars)}, src: ${f.src}, mode: ${JSON.stringify(f.mode)} },`,
		);
	lines.push("];");
	lines.push("");
	return lines.join("\n");
};

const main = (): void => {
	const drumKeys = new Set(Object.keys(DRUM_PATTERNS));
	if (CHECK_ONLY) {
		if (!existsSync(OUT)) throw new Error(`${OUT} が無い`);
		const mod = require(OUT) as {
			SECTION_BANK: BankSection[];
			FORM_BANK: BankForm[];
		};
		const errors = validateSectionBank(
			mod.SECTION_BANK,
			mod.FORM_BANK,
			drumKeys,
			parseChord,
		);
		for (const e of errors) console.log(`  ✗ ${e}`);
		console.log(
			`検算: セクション ${mod.SECTION_BANK.length} 本 / 構成 ${mod.FORM_BANK.length} 本 / 破れ ${errors.length}`,
		);
		process.exit(errors.length > 0 ? 1 : 0);
	}
	const skeletons = bankSourceOrder(loadSkeletons());
	if (skeletons.length === 0)
		throw new Error(
			"骨格データ（src/compose/compose-skeletons.ts）が無い。extract-skeletons.ts で作る",
		);
	const { sections, forms, stats } = buildBank(skeletons);
	const encoded = sections.map(encodeBankSection);
	// 符号化の往復で壊れないこと
	const back = encoded.map(decodeBankSection);
	const roundTrip = JSON.stringify(back) === JSON.stringify(sections);
	if (!roundTrip) throw new Error("符号化の往復で内容が変わった");
	const errors = validateSectionBank(back, forms, drumKeys, parseChord);
	for (const e of errors) console.log(`  ✗ ${e}`);
	if (errors.length > 0) process.exit(1);
	const ts = renderTs(encoded, forms, skeletons.length);
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, ts);
	// リポジトリの整形（pnpm check）と同じ形にしておく。素の出力は 1 要素 1 行で biome と差が出る。
	execSync(`npx biome format --write "${OUT}"`, { cwd: ROOT, stdio: "ignore" });
	// 対応表（曲名を含む）は tmp に置く。git に入れない。
	const mapPath = join(__dirname, "../../tmp/section-bank-map.json");
	mkdirSync(dirname(mapPath), { recursive: true });
	writeFileSync(
		mapPath,
		`${JSON.stringify(
			skeletons.map((s, i) => ({ src: i, id: s.id, mode: s.mode })),
			null,
			"\t",
		)}\n`,
	);
	const size = readFileSync(OUT).length;
	console.log(`書いた: ${OUT} (${(size / 1024).toFixed(1)} KB)`);
	console.log(
		`骨格 ${skeletons.length} 本 → セクション ${sections.length} 本 / 構成 ${forms.length} 本`,
	);
	for (const [k, v] of Object.entries(stats).sort())
		console.log(`  ${k}: ${v}`);
};

if (require.main === module) main();
