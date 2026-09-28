/**
 * 伴奏主体モードのばらつきの監査（`docs/accomp-style-engine.md` §4.5・§5、段階 S0）。**報告だけ。**
 * 落ちる検査ではなく、`pnpm test` にも入れない。**測った値で曲を選ばない**（内蔵採点 r = −0.06 と
 * 同じ罠になる、§4.5）。
 *
 *   pnpm audit:accomp
 *   npx tsx scripts/audit-accomp-variety.ts --count 20 --seed 777 --out tmp/audit
 *
 * - `--style fb` … スタイル（いまは fb だけ）。基準は `references/<style>/baseline.json`
 * - `--count n --seed s --keys major,minor,any` … 生成曲（調の指定ごとに n 曲。種は調ごとにずらす。
 *   同じ種は baseKey を変えても同じ計画になるため）。既定 16 × 3 = 48 曲
 * - `--local-baseline <path>` … gitignore の基準（却下した試作・ファイル名から参考曲が分かる試作）を
 *   足す。既定は `tmp/audit/<style>.baseline.local.json` があれば読む。`--no-local` で読まない
 * - `--diag-count n --diag-seed s` … 退避率・候補 k=0 の通過率・計画の中の引き直しの使い切りを
 *   数える曲数（調の指定ごと。既定 200 × 3 = 600 曲、種 1〜200）
 * - `--boot b` … ブートストラップの回数（既定 4000）
 * - `--out dir` … 表（`audit-<style>.md`）と生データ（`audit-<style>.json`）。既定 tmp/audit
 *
 * **MML だけを読む**（生成曲も `accompToMml` → `parseMML` を通す）ので、どのスタイルにも同じ
 * コードで使える。計画を読むのは、区間で揃えた比較・計画の指標・聴いた行の割合・退避率だけ。
 *
 * `scratch/accomp-variety.ts` から上げたときに直したこと（§4.5）:
 * - リズムと形の語彙を完全一致で数えない。1小節の発音位置の集合の Jaccard で重み付けた重なり
 *   （貪欲な輸送: Jaccard の高い組から頻度を割り当てる。完全一致だけなら今までのヒストグラムの
 *   重なりと同じ値）。形は、位置の Jaccard と輪郭の一致の積。完全一致の値も「exact」として並べる
 * - 音色の欄に、役割ごとの音源バンク・EQ（低中高）・パン・幅・コンプ・残響とディレイの送り、
 *   マスタの残響の長さ・プリディレイ・ディレイの音価・ドラムを足した（旧い欄の値も並べる）
 * - 曲の頭（最初の16小節）と継ぎ目（最終小節・最初の小節）を別に測る
 * - 基準をスタイルごとに `references/<style>/baseline.json` から読み、組の数 n とブートストラップの
 *   95%区間を出す。印（flag: draft）の付いた組は、除いた値も出す
 * - ほぼ重複: 型の中の組は、型が固定しない4指標（和音の語彙・低音のリズム・和音のリズム・分散の形）の
 *   うち3つ以上が H-ver の平均以上。型の間の組は7指標のうち4つ以上（別に報告）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

// mml-parser は歌詞解析の先で @onjmin/koe（ブラウザ専用）を読むので、空のスタブへ
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { composeAccomp } =
	require("../src/compose-accomp") as typeof import("../src/compose-accomp");
const { accompToMml } =
	require("../src/compose-accomp-mml") as typeof import("../src/compose-accomp-mml");
const { fbPlan } =
	require("../src/compose-accomp-plan") as typeof import("../src/compose-accomp-plan");
const { accompStyleById } =
	require("../src/accomp-styles/index") as typeof import("../src/accomp-styles/index");
const { seededRandom } =
	require("../src/compose") as typeof import("../src/compose");
const { parseMML } =
	require("../src/mml-parser") as typeof import("../src/mml-parser");
const { DEFAULT_SOUNDFONT_BANK, normalizeSoundFontBank } =
	require("../src/soundfont-banks") as typeof import("../src/soundfont-banks");

type AccompPlan = import("../src/compose-accomp").AccompPlan;
type AccompSong = import("../src/compose-accomp").AccompSong;
type AccompCandidateDiag = import("../src/compose-accomp").AccompCandidateDiag;
type MmlMeta = import("../src/mml-parser").MmlMeta;

// ============================================================
// CLI
// ============================================================

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);
const STYLE_ID = argOf("--style") ?? "fb";
const COUNT = Number.parseInt(argOf("--count") ?? "16", 10);
const SEED = Number.parseInt(argOf("--seed") ?? "20260929", 10);
const KEYS = (argOf("--keys") ?? "major,minor,any").split(",");
const OUT = argOf("--out") ?? "tmp/audit";
const BOOT = Number.parseInt(argOf("--boot") ?? "4000", 10);
const DIAG_COUNT = Number.parseInt(argOf("--diag-count") ?? "200", 10);
const DIAG_SEED = Number.parseInt(argOf("--diag-seed") ?? "1", 10);
const LOCAL_BASELINE = has("--no-local")
	? undefined
	: (argOf("--local-baseline") ?? `tmp/audit/${STYLE_ID}.baseline.local.json`);
const RESAMPLE = 64;
/** 曲の頭として測る小節数（112BPM で約34秒。§4.5）。 */
const OPENING_BARS = 16;
/** 聴いていない組の割合の警告（§4.1。3割は仮の値）。 */
const UNHEARD_WARN = 0.3;

const style = accompStyleById(STYLE_ID);
if (!style) throw new Error(`--style ${STYLE_ID}: 知らないスタイル`);
/** 型ごとの参照計画（陽性対照）。注釈から組み立てるまで（S3 以降。付録 F.7）は fb の計画だけ。 */
const REFERENCE_PLANS: Record<string, () => AccompPlan> = {
	fb: () => fbPlan(),
};
const referencePlan = REFERENCE_PLANS[STYLE_ID];

// ============================================================
// 曲の表現
// ============================================================

/** 層。lead は @0 の色の線（控えめな長い音）や旋律。 */
type Role = "lead" | "arp" | "bass" | "comp";
const ROLES: Role[] = ["lead", "arp", "bass", "comp"];
const NOTE_ROLES: Role[] = ["arp", "bass", "comp"];

type Note = { bar: number; pos: number; len: number; midi: number; v: number };
type Piece = {
	name: string;
	group: "gen" | "refplan" | "hand";
	bpm: number;
	bars: number;
	seconds: number;
	notes: Record<Role, Note[]>;
	trackOfRole: Partial<Record<Role, number>>;
	meta: MmlMeta;
	plan?: AccompPlan;
	/** 小節 → "役割:区間内の小節"。区間で揃えた比較に使う。 */
	regionKey?: string[];
	rootShift?: number;
	pick?: number;
	/** 型 id（生成曲だけ）。 */
	archetype?: string;
	f?: Features;
	/** 最初の {@link OPENING_BARS} 小節だけの特徴量。 */
	open?: Features;
};

const SPB = 192;
const offsetMidi = (() => {
	const p = parseMML("@0 o4c4").placements[0];
	return 60 - Math.round(p.pitchUnits / 31);
})();

/** MML → Piece。trackRoles を与えなければ役割を自動で割り当てる。 */
const pieceFromMml = (
	name: string,
	group: Piece["group"],
	mml: string,
	trackRoles?: Partial<Record<number, Role>>,
): Piece => {
	const parsed = parseMML(mml, { stepsPerBar: SPB });
	const byTrack = new Map<number, Note[]>();
	let lastStep = 0;
	for (const p of parsed.placements) {
		if (!(p.velocity > 0)) continue;
		const q = Math.round(p.startStep / (SPB / 16));
		const n: Note = {
			bar: Math.floor(q / 16),
			pos: q % 16,
			len: Math.max(1, Math.round(p.durationSteps / (SPB / 16))),
			midi: Math.round(p.pitchUnits / 31) + offsetMidi,
			v: p.velocity,
		};
		lastStep = Math.max(lastStep, p.startStep + p.durationSteps);
		const arr = byTrack.get(p.trackIndex) ?? [];
		arr.push(n);
		byTrack.set(p.trackIndex, arr);
	}
	const bars = Math.max(1, Math.ceil(lastStep / SPB - 1e-6));
	const roles = trackRoles ?? autoRoles(byTrack, bars);
	const notes: Record<Role, Note[]> = { lead: [], arp: [], bass: [], comp: [] };
	const trackOfRole: Partial<Record<Role, number>> = {};
	for (const [t, ns] of byTrack) {
		const r = roles[t];
		if (!r) continue;
		notes[r].push(...ns);
		trackOfRole[r] ??= t;
	}
	for (const r of ROLES)
		notes[r].sort((a, b) => a.bar - b.bar || a.pos - b.pos || a.midi - b.midi);
	const bpm = parsed.bpm ?? 120;
	return {
		name,
		group,
		bpm,
		bars,
		seconds: (bars * 240) / bpm,
		notes,
		trackOfRole,
		meta: parsed.meta,
	};
};

/** 一番低い＝低音、同時発音が多い＝和音、残りで一番音数が多い＝分散、残り＝旋律（色）。 */
const autoRoles = (
	byTrack: Map<number, Note[]>,
	bars: number,
): Partial<Record<number, Role>> => {
	const stats = [...byTrack].map(([t, ns]) => {
		const mean = ns.reduce((a, n) => a + n.midi, 0) / ns.length;
		const key = (n: Note) => `${n.bar}:${n.pos}`;
		const c = new Map<string, number>();
		for (const n of ns) c.set(key(n), (c.get(key(n)) ?? 0) + 1);
		const poly = ns.filter((n) => (c.get(key(n)) ?? 0) > 1).length / ns.length;
		return { t, mean, poly, perBar: ns.length / bars };
	});
	type S = (typeof stats)[number];
	const out: Partial<Record<number, Role>> = {};
	const rest = [...stats];
	const take = (pred: (s: S) => number, role: Role, ok = (_: S) => true) => {
		const cands = rest.filter(ok);
		if (cands.length === 0) return;
		cands.sort((a, b) => pred(b) - pred(a));
		out[cands[0].t] = role;
		rest.splice(rest.indexOf(cands[0]), 1);
	};
	take((s) => -s.mean, "bass");
	take(
		(s) => s.poly,
		"comp",
		(s) => s.poly >= 0.5,
	);
	take((s) => s.perBar, "arp");
	take((s) => s.mean, "lead");
	return out;
};

/** 最初の n 小節だけにした曲（曲の頭の指標）。 */
const truncated = (p: Piece, n: number): Piece => {
	const bars = Math.min(n, p.bars);
	const notes = {} as Record<Role, Note[]>;
	for (const r of ROLES) notes[r] = p.notes[r].filter((x) => x.bar < bars);
	return {
		...p,
		bars,
		seconds: (bars * 240) / p.bpm,
		notes,
		regionKey: p.regionKey?.slice(0, bars),
		f: undefined,
		open: undefined,
	};
};

// ============================================================
// 特徴量
// ============================================================

/** 小節の型（リズム）: 16分の発音位置のビット集合。 */
type BarRhythm = number;
/** 小節の型（形）: 位置ごとの代表音の高さ・長さ・同時発音数（無い位置は NaN）。 */
type BarShape = { mask: number; h: number[]; len: number[]; n: number[] };
/** 重み付きの語彙（頻度は合計1）。キーは完全一致の数え方の文字列。 */
type Vocab<T> = Map<string, { w: number; item: T }>;

type Features = {
	pcHist: number[];
	barSets: Record<Role, Map<number, Note[]>>;
	onsetSet: Record<Role, Set<string>>;
	onsetPitch: Record<Role, { bar: number; pos: number; pc: number }[]>;
	rhythm: Record<Role, Vocab<BarRhythm>>;
	shape: Record<Role, Vocab<BarShape>>;
	barRoot: (number | null)[];
	barComp: (number[] | null)[];
	vPerBar: number[];
	curves: number[][];
	meanMidi: Partial<Record<Role, number>>;
	perSec: Partial<Record<Role, number>>;
};

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const popcount = (x: number): number => {
	let c = 0;
	let v = x;
	while (v) {
		v &= v - 1;
		c++;
	}
	return c;
};
const normalize = <T>(m: Vocab<T>): Vocab<T> => {
	let s = 0;
	for (const x of m.values()) s += x.w;
	if (s > 0) for (const x of m.values()) x.w /= s;
	return m;
};
const addTo = <T>(m: Vocab<T>, key: string, item: T): void => {
	const o = m.get(key);
	if (o) o.w += 1;
	else m.set(key, { w: 1, item });
};
const inc = (m: Map<string, number>, k: string, w = 1) =>
	m.set(k, (m.get(k) ?? 0) + w);
const normHist = (m: Map<string, number>): Map<string, number> => {
	const s = [...m.values()].reduce((a, b) => a + b, 0);
	const out = new Map<string, number>();
	if (s > 0) for (const [k, v] of m) out.set(k, v / s);
	return out;
};

const features = (p: Piece): Features => {
	const pcHist = Array(12).fill(0);
	for (const r of ROLES)
		for (const n of p.notes[r]) pcHist[mod12(n.midi)] += n.len;
	const barSets = {} as Features["barSets"];
	const onsetSet = {} as Features["onsetSet"];
	const onsetPitch = {} as Features["onsetPitch"];
	const rhythm = {} as Features["rhythm"];
	const shape = {} as Features["shape"];
	const meanMidi: Features["meanMidi"] = {};
	const perSec: Features["perSec"] = {};
	for (const r of ROLES) {
		const ns = p.notes[r];
		const bs = new Map<number, Note[]>();
		for (const n of ns) {
			const a = bs.get(n.bar) ?? [];
			a.push(n);
			bs.set(n.bar, a);
		}
		barSets[r] = bs;
		onsetSet[r] = new Set(ns.map((n) => `${n.bar}:${n.pos}`));
		// 同じ位置の音は代表1つ（分散・旋律・和音は最高音、低音は最低音）
		const rep = new Map<string, Note>();
		for (const n of ns) {
			const k = `${n.bar}:${n.pos}`;
			const o = rep.get(k);
			if (!o || (r === "bass" ? n.midi < o.midi : n.midi > o.midi))
				rep.set(k, n);
		}
		onsetPitch[r] = [...rep.values()].map((n) => ({
			bar: n.bar,
			pos: n.pos,
			pc: mod12(n.midi),
		}));
		const rh: Vocab<BarRhythm> = new Map();
		const sh: Vocab<BarShape> = new Map();
		for (const [, bn] of bs) {
			const byPos = new Map<number, Note[]>();
			for (const n of bn) {
				const a = byPos.get(n.pos) ?? [];
				a.push(n);
				byPos.set(n.pos, a);
			}
			const poss = [...byPos.keys()].sort((a, b) => a - b);
			let mask = 0;
			for (const q of poss) mask |= 1 << q;
			addTo(rh, poss.join(","), mask);
			const tops = poss.map((q) => {
				const g = byPos.get(q) ?? [];
				return r === "bass"
					? Math.min(...g.map((n) => n.midi))
					: Math.max(...g.map((n) => n.midi));
			});
			const distinct = [...new Set(tops)].sort((a, b) => a - b);
			const item: BarShape = {
				mask,
				h: Array(16).fill(Number.NaN),
				len: Array(16).fill(Number.NaN),
				n: Array(16).fill(Number.NaN),
			};
			const key = poss
				.map((q, i) => {
					const g = byPos.get(q) ?? [];
					const len = Math.max(...g.map((n) => n.len));
					item.h[q] = tops[i];
					item.len[q] = len;
					item.n[q] = g.length;
					// 完全一致の数え方（scratch/accomp-variety.ts と同じ文字列）
					return r === "comp"
						? `${q}x${g.length}l${len}`
						: r === "bass"
							? `${q}r${distinct.indexOf(tops[i])}l${len}`
							: `${q}r${distinct.indexOf(tops[i])}`;
				})
				.join(" ");
			addTo(sh, key, item);
		}
		rhythm[r] = normalize(rh);
		shape[r] = normalize(sh);
		if (ns.length) {
			meanMidi[r] = ns.reduce((a, n) => a + n.midi, 0) / ns.length;
			perSec[r] = new Set(ns.map((n) => `${n.bar}:${n.pos}`)).size / p.seconds;
		}
	}
	const barRoot: (number | null)[] = [];
	const barComp: (number[] | null)[] = [];
	const vPerBar: number[] = [];
	for (let b = 0; b < p.bars; b++) {
		const bn = barSets.bass.get(b) ?? [];
		// 小節の根音 = 小節頭に最も近い低音の最低音（無ければ前の小節の値）
		let root: number | null = null;
		if (bn.length) {
			const first = Math.min(...bn.map((n) => n.pos));
			root = mod12(
				Math.min(...bn.filter((n) => n.pos === first).map((n) => n.midi)),
			);
		} else root = barRoot[b - 1] ?? null;
		barRoot.push(root);
		// 小節の和音の音高クラス: 分散＋和音の音を長さで重みづけ、全体の 10% 以上を占める音高クラス
		const src = [...(barSets.comp.get(b) ?? []), ...(barSets.arp.get(b) ?? [])];
		const w = Array(12).fill(0);
		for (const n of src) w[mod12(n.midi)] += n.len;
		const tot = w.reduce((a, x) => a + x, 0);
		const pcs = w.flatMap((x, pc) => (tot > 0 && x >= 0.1 * tot ? [pc] : []));
		barComp.push(pcs.length ? pcs : null);
		const all = ROLES.flatMap((r) => barSets[r].get(b) ?? []);
		vPerBar.push(
			all.length ? all.reduce((a, n) => a + n.v, 0) / all.length : Number.NaN,
		);
	}
	// 全体の形の比較用の曲線（小節ごと）: 各層の打点数、分散の平均音高
	const curves: number[][] = [];
	for (const r of NOTE_ROLES)
		curves.push(
			Array.from(
				{ length: p.bars },
				(_, b) => new Set((barSets[r].get(b) ?? []).map((n) => n.pos)).size,
			),
		);
	curves.push(
		Array.from({ length: p.bars }, (_, b) => {
			const a = barSets.arp.get(b) ?? [];
			return a.length
				? a.reduce((s, n) => s + n.midi, 0) / a.length
				: Number.NaN;
		}),
	);
	return {
		pcHist,
		barSets,
		onsetSet,
		onsetPitch,
		rhythm,
		shape,
		barRoot,
		barComp,
		vPerBar,
		curves,
		meanMidi,
		perSec,
	};
};

// ============================================================
// 類似度の道具
// ============================================================

const jaccard = <T>(a: Set<T>, b: Set<T>): number => {
	if (a.size === 0 && b.size === 0) return Number.NaN;
	let i = 0;
	for (const x of a) if (b.has(x)) i++;
	return i / (a.size + b.size - i);
};
const maskJaccard = (a: number, b: number): number => {
	const u = popcount(a | b);
	return u === 0 ? 1 : popcount(a & b) / u;
};
const histInter = (a: Map<string, number>, b: Map<string, number>): number => {
	if (a.size === 0 || b.size === 0) return Number.NaN;
	let s = 0;
	for (const [k, v] of a) s += Math.min(v, b.get(k) ?? 0);
	return s;
};
/** 完全一致の重なり（scratch と同じ値）。 */
const exactOverlap = <T>(a: Vocab<T>, b: Vocab<T>): number => {
	if (a.size === 0 || b.size === 0) return Number.NaN;
	let s = 0;
	for (const [k, x] of a) s += Math.min(x.w, b.get(k)?.w ?? 0);
	return s;
};
/**
 * 類似度で重み付けた語彙の重なり（貪欲な輸送）。類似度の高い組から、残っている頻度の小さい方を
 * 割り当てて足す。類似度が完全一致（1 か 0）だけなら {@link exactOverlap} と同じ値。貪欲なので
 * 最適な輸送の値以下（下限）になる。
 */
const softOverlap = <T>(
	a: Vocab<T>,
	b: Vocab<T>,
	sim: (x: T, y: T) => number,
): number => {
	if (a.size === 0 || b.size === 0) return Number.NaN;
	const A = [...a.values()];
	const B = [...b.values()];
	const pairs: [number, number, number][] = [];
	for (let i = 0; i < A.length; i++)
		for (let j = 0; j < B.length; j++) {
			const s = sim(A[i].item, B[j].item);
			if (s > 0) pairs.push([s, i, j]);
		}
	pairs.sort((x, y) => y[0] - x[0] || x[1] - y[1] || x[2] - y[2]);
	const ra = A.map((x) => x.w);
	const rb = B.map((x) => x.w);
	let total = 0;
	for (const [s, i, j] of pairs) {
		const m = Math.min(ra[i], rb[j]);
		if (m <= 0) continue;
		total += s * m;
		ra[i] -= m;
		rb[j] -= m;
	}
	return total;
};
const rhythmSim = (x: BarRhythm, y: BarRhythm): number => maskJaccard(x, y);
/**
 * 形の類似度 = 位置の Jaccard × 輪郭の一致。輪郭は、両方にある発音位置の間の上下の向き
 * （分散・低音・旋律）、同時発音数（和音）、音の長さ（低音・和音）の一致の割合の平均。
 */
const shapeSim =
	(role: Role) =>
	(x: BarShape, y: BarShape): number => {
		const j = maskJaccard(x.mask, y.mask);
		if (j === 0) return 0;
		const common: number[] = [];
		for (let q = 0; q < 16; q++) if (x.mask & y.mask & (1 << q)) common.push(q);
		const parts: number[] = [];
		if (role !== "comp") {
			if (common.length >= 2) {
				let agree = 0;
				for (let i = 0; i + 1 < common.length; i++)
					if (
						Math.sign(x.h[common[i + 1]] - x.h[common[i]]) ===
						Math.sign(y.h[common[i + 1]] - y.h[common[i]])
					)
						agree++;
				parts.push(agree / (common.length - 1));
			} else parts.push(1);
		}
		if (role === "comp")
			parts.push(
				common.filter((q) => x.n[q] === y.n[q]).length / common.length,
			);
		if (role === "comp" || role === "bass")
			parts.push(
				common.filter((q) => x.len[q] === y.len[q]).length / common.length,
			);
		return j * (parts.reduce((s, v) => s + v, 0) / parts.length);
	};
const pearson = (x: number[], y: number[]): number => {
	const pts = x
		.map((v, i) => [v, y[i]])
		.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
	if (pts.length < 3) return Number.NaN;
	const mx = pts.reduce((a, [v]) => a + v, 0) / pts.length;
	const my = pts.reduce((a, [, v]) => a + v, 0) / pts.length;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (const [a, b] of pts) {
		sxy += (a - mx) * (b - my);
		sxx += (a - mx) ** 2;
		syy += (b - my) ** 2;
	}
	if (sxx < 1e-9 || syy < 1e-9) return Number.NaN;
	return sxy / Math.sqrt(sxx * syy);
};
/** NaN を前後の値で埋めて n 点へ線形に伸縮。 */
const resample = (c: number[], n = RESAMPLE): number[] => {
	const filled = [...c];
	let last = Number.NaN;
	for (let i = 0; i < filled.length; i++)
		if (Number.isFinite(filled[i])) last = filled[i];
		else filled[i] = last;
	const firstFinite = filled.find((v) => Number.isFinite(v)) ?? 0;
	for (let i = 0; i < filled.length && !Number.isFinite(filled[i]); i++)
		filled[i] = firstFinite;
	if (filled.length === 1) return Array(n).fill(filled[0]);
	return Array.from({ length: n }, (_, i) => {
		const t = (i * (filled.length - 1)) / (n - 1);
		const lo = Math.floor(t);
		const hi = Math.min(lo + 1, filled.length - 1);
		return filled[lo] + (filled[hi] - filled[lo]) * (t - lo);
	});
};
const cosRot = (a: number[], b: number[], t: number): number => {
	let s = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < 12; i++) {
		s += a[i] * b[mod12(i + t)];
		na += a[i] ** 2;
		nb += b[i] ** 2;
	}
	return s / Math.sqrt(na * nb || 1);
};
/** a の pc + t = b の pc になる移調（音の長さで重みづけた音高クラス分布の余弦が最大）。 */
const bestShift = (a: number[], b: number[]): number => {
	let best = 0;
	let bv = -1;
	for (let t = 0; t < 12; t++) {
		const v = cosRot(a, b, t);
		if (v > bv + 1e-12) {
			bv = v;
			best = t;
		}
	}
	return best;
};

// ============================================================
// 音色（MML の宣言）
// ============================================================

const trackField = <T>(
	rec: Record<number, T> | undefined,
	t: number | undefined,
	fallback: string,
): string => {
	if (t === undefined) return "-";
	const v = rec?.[t];
	return v === undefined ? fallback : String(v);
};

/** 音色とミックスの欄（§4.5 で広げた）。書いていない値は既定値として比べる。 */
const timbreFields = (p: Piece): Record<string, string> => {
	const m = p.meta;
	const out: Record<string, string> = {
		preset: String(m.instrument ?? ""),
		"master.reverb": String(m.reverb ?? 0),
		"master.reverbDecay": String(m.reverbDecay ?? 22),
		"master.reverbPreDelay": String(m.reverbPreDelay ?? 0),
		"master.delay": String(m.delay ?? 0),
		"master.delayDivision": String(m.delayDivision ?? "8"),
		"master.drum": String(m.drum ?? "none"),
	};
	for (const r of ROLES) {
		const t = p.trackOfRole[r];
		out[`${r}.inst`] = trackField(m.trackInstruments, t, "(default)");
		out[`${r}.font`] =
			t === undefined
				? "-"
				: (normalizeSoundFontBank(m.trackFonts?.[t]) ?? DEFAULT_SOUNDFONT_BANK);
		out[`${r}.eqLow`] = trackField(m.trackEqLow, t, "0");
		out[`${r}.eqMid`] = trackField(m.trackEqMid, t, "0");
		out[`${r}.eqHigh`] = trackField(m.trackEqHigh, t, "0");
		out[`${r}.pan`] = trackField(m.trackPan, t, "0");
		out[`${r}.width`] = trackField(m.trackWidth, t, "100");
		out[`${r}.compression`] = trackField(m.trackCompression, t, "0");
		out[`${r}.reverbSend`] = trackField(m.trackReverbSend, t, "0");
		out[`${r}.delaySend`] = trackField(m.trackDelaySend, t, "0");
	}
	return out;
};
/** 旧い欄（scratch/accomp-variety.ts の TIMBRE_FIELDS。プリセット・役割ごとの GM 名・残響・ディレイ）。 */
const legacyTimbreFields = (p: Piece): Record<string, string> => {
	const ti = (p.meta.trackInstruments ?? {}) as Record<number, string>;
	const out: Record<string, string> = {
		preset: String(p.meta.instrument ?? ""),
	};
	for (const r of ROLES) {
		const t = p.trackOfRole[r];
		out[`inst.${r}`] = t === undefined ? "-" : String(ti[t] ?? "(default)");
	}
	out.reverb = String(p.meta.reverb ?? 0);
	out.delay = String(p.meta.delay ?? 0);
	return out;
};
const fieldMatch = (
	a: Record<string, string>,
	b: Record<string, string>,
): number => {
	const keys = Object.keys(a);
	return keys.filter((k) => a[k] === b[k]).length / keys.length;
};

// ============================================================
// 組ごとの指標
// ============================================================

type Metrics = Record<string, number>;

/** 計画の指標（計画がある曲どうし）。区間は役割で揃え、区間の中は先頭から揃える。 */
const planMetrics = (A: AccompPlan, B: AccompPlan): Metrics => {
	const m: Metrics = {};
	const ra = A.regions;
	const rb = B.regions;
	if (ra.length !== rb.length) return m;
	m["plan.lengths"] =
		ra.filter((r, i) => r.bars === rb[i].bars).length / ra.length;
	let eq = 0;
	let tot = 0;
	let ceq = 0;
	let ctot = 0;
	let beq = 0;
	let btot = 0;
	let keq = 0;
	ra.forEach((r, i) => {
		const s = rb[i];
		for (let j = 0; j < Math.min(r.bars, s.bars); j++) {
			tot++;
			if (r.chords[j] === s.chords[j]) eq++;
		}
		for (
			let j = 0;
			j < Math.min(r.texture.arpCells.length, s.texture.arpCells.length);
			j++
		) {
			ctot++;
			if (r.texture.arpCells[j] === s.texture.arpCells[j]) ceq++;
			btot++;
			if (r.texture.bass[j] === s.texture.bass[j]) beq++;
		}
		if (
			r.texture.comp === s.texture.comp &&
			r.texture.compRegister === s.texture.compRegister
		)
			keq++;
	});
	m["plan.roman aligned"] = eq / tot;
	m["plan.arp cell aligned"] = ceq / ctot;
	m["plan.bass pattern aligned"] = beq / btot;
	m["plan.comp hit+register aligned"] = keq / ra.length;
	m["plan.borrow pair same"] = A.borrowPair === B.borrowPair ? 1 : 0;
	return m;
};

/** 音から測る指標（曲全体、または曲の頭）。 */
const noteMetrics = (
	A: Piece,
	B: Piece,
	fa: Features,
	fb: Features,
	t: number,
	prefix: string,
	full: boolean,
): Metrics => {
	const m: Metrics = {};
	const n = Math.min(A.bars, B.bars);
	const label = (f: Features, b: number, shift: number) => {
		const r = f.barRoot[b];
		const c = f.barComp[b];
		if (r === null && !c) return null;
		const rr = r === null ? "-" : mod12(r + shift);
		const cc = c
			? c
					.map((x) => mod12(x + shift))
					.sort((p, q) => p - q)
					.join(".")
			: "-";
		return `${rr}|${cc}`;
	};
	const LA = new Map<string, number>();
	const LB = new Map<string, number>();
	const MA = new Map<string, number>();
	const MB = new Map<string, number>();
	for (const [f, L, M, shift, bars] of [
		[fa, LA, MA, t, A.bars],
		[fb, LB, MB, 0, B.bars],
	] as const) {
		let prev: number | null = null;
		for (let b = 0; b < bars; b++) {
			const l = label(f, b, shift);
			if (l) inc(L, l);
			const r = f.barRoot[b];
			if (r !== null) {
				const rr = mod12(r + shift);
				if (prev !== null && prev !== rr) inc(M, `${prev}>${rr}`);
				prev = rr;
			}
		}
	}
	m[`${prefix}harm.bar chord vocab`] = histInter(normHist(LA), normHist(LB));
	for (const r of NOTE_ROLES) {
		m[`${prefix}${r}.rhythm vocab`] = softOverlap(
			fa.rhythm[r],
			fb.rhythm[r],
			rhythmSim,
		);
		m[`${prefix}${r}.shape vocab`] = softOverlap(
			fa.shape[r],
			fb.shape[r],
			shapeSim(r),
		);
		m[`${prefix}${r}.rhythm vocab exact`] = exactOverlap(
			fa.rhythm[r],
			fb.rhythm[r],
		);
		m[`${prefix}${r}.shape vocab exact`] = exactOverlap(
			fa.shape[r],
			fb.shape[r],
		);
	}
	if (!full) {
		// 曲の頭: 同じ小節・同じ位置・同じ音高クラス（層をまとめて）
		const sa = new Set<string>();
		const sb = new Set<string>();
		for (const r of NOTE_ROLES) {
			for (const x of fa.onsetPitch[r])
				if (x.bar < n) sa.add(`${r}:${x.bar}:${x.pos}:${mod12(x.pc + t)}`);
			for (const x of fb.onsetPitch[r])
				if (x.bar < n) sb.add(`${r}:${x.bar}:${x.pos}:${x.pc}`);
		}
		m[`${prefix}all.onset+pc aligned`] = jaccard(sa, sb);
		return m;
	}
	let req = 0;
	let rtot = 0;
	for (let b = 0; b < n; b++) {
		const x = fa.barRoot[b];
		const y = fb.barRoot[b];
		if (x === null || y === null) continue;
		rtot++;
		if (mod12(x + t) === y) req++;
	}
	m["harm.bar root aligned"] = rtot ? req / rtot : Number.NaN;
	m["harm.root motion vocab"] = histInter(normHist(MA), normHist(MB));
	const arcs = fa.curves.map((c, i) =>
		pearson(resample(c), resample(fb.curves[i])),
	);
	const fin = arcs.filter(Number.isFinite);
	m["form.arc (texture curves)"] = fin.length
		? fin.reduce((a, b) => a + b, 0) / fin.length
		: Number.NaN;
	for (const r of NOTE_ROLES) {
		const sa = new Set(
			[...fa.onsetSet[r]].filter((k) => Number(k.split(":")[0]) < n),
		);
		const sb = new Set(
			[...fb.onsetSet[r]].filter((k) => Number(k.split(":")[0]) < n),
		);
		const both = fa.onsetSet[r].size > 0 && fb.onsetSet[r].size > 0;
		m[`${r}.rhythm aligned`] = both ? jaccard(sa, sb) : Number.NaN;
		const pa = new Set(
			fa.onsetPitch[r]
				.filter((x) => x.bar < n)
				.map((x) => `${x.bar}:${x.pos}:${mod12(x.pc + t)}`),
		);
		const pb = new Set(
			fb.onsetPitch[r]
				.filter((x) => x.bar < n)
				.map((x) => `${x.bar}:${x.pos}:${x.pc}`),
		);
		m[`${r}.onset+pc aligned`] = both ? jaccard(pa, pb) : Number.NaN;
		const x = fa.meanMidi[r];
		const y = fb.meanMidi[r];
		m[`${r}.register (abs)`] =
			x === undefined || y === undefined
				? Number.NaN
				: 1 - Math.min(1, Math.abs(x - y) / 12);
		const u = fa.perSec[r];
		const w = fb.perSec[r];
		m[`${r}.density`] =
			u === undefined || w === undefined
				? Number.NaN
				: 1 - Math.abs(u - w) / Math.max(u, w);
	}
	m["dyn.v per bar aligned (r)"] = pearson(
		fa.vPerBar.slice(0, n),
		fb.vPerBar.slice(0, n),
	);
	m["dyn.v curve shape (r)"] = pearson(
		resample(fa.vPerBar),
		resample(fb.vPerBar),
	);
	return m;
};

/** 継ぎ目の小節（最終小節・最初の小節）の音の集合（層・位置・長さ・移調した音高クラス）。 */
const barNotes = (p: Piece, bar: number, shift: number): Set<string> => {
	const out = new Set<string>();
	for (const r of ROLES)
		for (const n of p.notes[r])
			if (n.bar === bar)
				out.add(`${r}:${n.pos}:${n.len}:${mod12(n.midi + shift)}`);
	return out;
};
const sameSet = (a: Set<string>, b: Set<string>): boolean =>
	a.size === b.size && [...a].every((x) => b.has(x));
/** 音高を外した「層・位置・長さ」だけの集合（継ぎ目のリズムが同じか）。 */
const barRhythmOf = (notes: Set<string>): Set<string> =>
	new Set([...notes].map((x) => x.split(":").slice(0, 3).join(":")));

const pairMetrics = (A: Piece, B: Piece): { m: Metrics; shift: number } => {
	const fa = A.f ?? features(A);
	const fb = B.f ?? features(B);
	const t = bestShift(fa.pcHist, fb.pcHist); // pc_B = pc_A + t
	const m: Metrics = noteMetrics(A, B, fa, fb, t, "", true);
	// 曲の頭（最初の 16 小節）
	A.open ??= features(truncated(A, OPENING_BARS));
	B.open ??= features(truncated(B, OPENING_BARS));
	Object.assign(
		m,
		noteMetrics(
			truncated(A, OPENING_BARS),
			truncated(B, OPENING_BARS),
			A.open,
			B.open,
			t,
			"open.",
			false,
		),
	);
	// 継ぎ目
	const lastA = barNotes(A, A.bars - 1, t);
	const lastB = barNotes(B, B.bars - 1, 0);
	const firstA = barNotes(A, 0, t);
	const firstB = barNotes(B, 0, 0);
	m["seam.last bar identical"] = sameSet(lastA, lastB) ? 1 : 0;
	m["seam.first bar identical"] = sameSet(firstA, firstB) ? 1 : 0;
	m["seam.last bar rhythm identical"] = sameSet(
		barRhythmOf(lastA),
		barRhythmOf(lastB),
	)
		? 1
		: 0;
	m["seam.first bar rhythm identical"] = sameSet(
		barRhythmOf(firstA),
		barRhythmOf(firstB),
	)
		? 1
		: 0;
	m["seam.last bar J"] = jaccard(lastA, lastB);
	m["seam.first bar J"] = jaccard(firstA, firstB);
	// テンポ・音色
	m.tempo = 1 - Math.min(1, Math.abs(Math.log(A.bpm / B.bpm)) / Math.log(2));
	const ta = timbreFields(A);
	const tb = timbreFields(B);
	m["timbre/mix fields"] = fieldMatch(ta, tb);
	m["timbre/mix fields (旧い欄)"] = fieldMatch(
		legacyTimbreFields(A),
		legacyTimbreFields(B),
	);
	const both = ROLES.filter(
		(r) => A.trackOfRole[r] !== undefined && B.trackOfRole[r] !== undefined,
	);
	m["timbre.instrument (GM+bank)"] = both.length
		? both.filter(
				(r) =>
					ta[`${r}.inst`] === tb[`${r}.inst`] &&
					ta[`${r}.font`] === tb[`${r}.font`],
			).length / both.length
		: Number.NaN;
	if (A.plan && B.plan) Object.assign(m, planMetrics(A.plan, B.plan));
	// 区間で揃えた比較（小節 → 役割:区間内の小節）
	if (A.regionKey && B.regionKey) {
		const rkA = A.regionKey;
		const rkB = B.regionKey;
		const common = new Set(rkA.filter((k) => rkB.includes(k)));
		for (const r of NOTE_ROLES) {
			const sa = new Set<string>();
			const sb = new Set<string>();
			const pa = new Set<string>();
			const pb = new Set<string>();
			for (const x of fa.onsetPitch[r]) {
				const k = rkA[x.bar];
				if (!k || !common.has(k)) continue;
				sa.add(`${k}:${x.pos}`);
				pa.add(`${k}:${x.pos}:${mod12(x.pc + t)}`);
			}
			for (const x of fb.onsetPitch[r]) {
				const k = rkB[x.bar];
				if (!k || !common.has(k)) continue;
				sb.add(`${k}:${x.pos}`);
				pb.add(`${k}:${x.pos}:${x.pc}`);
			}
			m[`${r}.rhythm region-aligned`] = jaccard(sa, sb);
			m[`${r}.onset+pc region-aligned`] = jaccard(pa, pb);
		}
	}
	return { m, shift: t };
};

const regionKeysOf = (regions: readonly (readonly [string, number])[]) =>
	regions.flatMap(([role, bars]) =>
		Array.from({ length: bars }, (_, i) => `${role}:${i}`),
	);
const planRegions = (plan: AccompPlan): [string, number][] =>
	plan.regions.map((r) => [r.role, r.bars]);

// ============================================================
// 基準（references/<style>/baseline.json と、ローカルの基準）
// ============================================================

type BaselinePiece = {
	file: string;
	status: string;
	note?: string;
	roles?: Record<string, Role>;
	regions?: [string, number][];
};
type BaselinePair = {
	a: string;
	b: string;
	tier: string;
	flag?: string;
	ownerLabel?: "same" | "different" | null;
	note?: string;
};
type BaselineFile = {
	style: string;
	about?: string;
	pieces: Record<string, BaselinePiece>;
	pairs: BaselinePair[];
};

const readJson = <T>(path: string): T =>
	JSON.parse(readFileSync(path, "utf8")) as T;
const BASELINE_PATH = `references/${STYLE_ID}/baseline.json`;
const baseline = readJson<BaselineFile>(BASELINE_PATH);
const localBaseline =
	LOCAL_BASELINE && existsSync(LOCAL_BASELINE)
		? readJson<BaselineFile>(LOCAL_BASELINE)
		: undefined;
const basePieces: Record<string, BaselinePiece & { local: boolean }> = {};
for (const [k, v] of Object.entries(baseline.pieces))
	basePieces[k] = { ...v, local: false };
for (const [k, v] of Object.entries(localBaseline?.pieces ?? {}))
	basePieces[k] ??= { ...v, local: true };
const basePairs: (BaselinePair & { local: boolean })[] = [
	...baseline.pairs.map((p) => ({ ...p, local: false })),
	...(localBaseline?.pairs ?? []).map((p) => ({ ...p, local: true })),
];

type Heard = { heard: Record<string, string[]> };
const HEARD_PATH = `references/${STYLE_ID}/heard.json`;
const heard = existsSync(HEARD_PATH)
	? readJson<Heard>(HEARD_PATH)
	: { heard: {} };

// ============================================================
// 曲を集める
// ============================================================

const t0 = Date.now();
const pieces: Piece[] = [];
const genSongs: AccompSong[] = [];
KEYS.forEach((key, ki) => {
	for (let i = 0; i < COUNT; i++) {
		const seed = SEED + ki * COUNT + i;
		const song = composeAccomp({
			style: STYLE_ID,
			random: seededRandom(seed),
			baseKey: key,
		});
		genSongs.push(song);
		const p = pieceFromMml(
			`g:${key}:${seed}`,
			"gen",
			accompToMml(song, { seed }),
			{ 0: "lead", 1: "arp", 2: "bass", 3: "comp" },
		);
		p.plan = song.plan;
		p.regionKey = regionKeysOf(planRegions(song.plan));
		p.rootShift = song.rootShift;
		p.pick = song.pick;
		// 型は計画の記録（§3.1 の PlanPins。段階 S1 から計画にある。型が2つ以上になるのは S4a）
		p.archetype = song.plan.archetype ?? style.id;
		pieces.push(p);
	}
});
const refPlanPiece = (() => {
	if (!referencePlan) return undefined;
	const song = composeAccomp({
		random: seededRandom(SEED),
		overrides: { plan: referencePlan() },
	});
	const p = pieceFromMml("ref-plan", "refplan", accompToMml(song), {
		0: "lead",
		1: "arp",
		2: "bass",
		3: "comp",
	});
	p.plan = song.plan;
	p.regionKey = regionKeysOf(planRegions(song.plan));
	p.rootShift = song.rootShift;
	pieces.push(p);
	return p;
})();
const missing: string[] = [];
for (const [name, bp] of Object.entries(basePieces)) {
	if (!existsSync(bp.file)) {
		missing.push(bp.file);
		continue;
	}
	const roles = bp.roles
		? Object.fromEntries(
				Object.entries(bp.roles).map(([t, r]) => [Number(t), r]),
			)
		: undefined;
	const hp = pieceFromMml(name, "hand", readFileSync(bp.file, "utf8"), roles);
	if (bp.regions) {
		hp.regionKey = regionKeysOf(bp.regions);
		if (hp.regionKey.length !== hp.bars)
			console.warn(
				`  ${name}: 区間の注釈 ${hp.regionKey.length} 小節と MML の ${hp.bars} 小節が違う`,
			);
	}
	pieces.push(hp);
}
for (const p of pieces) p.f = features(p);
const byName = new Map(pieces.map((p) => [p.name, p]));
const gens = pieces.filter((p) => p.group === "gen");
const refName = baseline.pieces[STYLE_ID] ? STYLE_ID : undefined;

// ============================================================
// 組を作って測る
// ============================================================

type PairRec = {
	group: string;
	a: string;
	b: string;
	m: Metrics;
	shift: number;
	flag?: string;
	ownerLabel?: string | null;
	local?: boolean;
};
const pairs: PairRec[] = [];
const add = (
	group: string,
	a: Piece | undefined,
	b: Piece | undefined,
	extra: Partial<PairRec> = {},
) => {
	if (!a || !b) return;
	const { m, shift } = pairMetrics(a, b);
	pairs.push({ group, a: a.name, b: b.name, m, shift, ...extra });
};
for (let i = 0; i < gens.length; i++)
	for (let j = i + 1; j < gens.length; j++)
		add(
			gens[i].archetype === gens[j].archetype ? "GG-within" : "GG-between",
			gens[i],
			gens[j],
		);
for (const g of gens) {
	if (refName) add("G-ref", g, byName.get(refName));
	add("G-refPlan", g, refPlanPiece);
}
for (const bp of basePairs)
	add(bp.tier, byName.get(bp.a), byName.get(bp.b), {
		flag: bp.flag,
		ownerLabel: bp.ownerLabel ?? null,
		local: bp.local,
	});
const tMeasure = (Date.now() - t0) / 1000;

// ============================================================
// 集計
// ============================================================

type Stat = { mean: number; min: number; max: number; n: number };
const stat = (xs: number[]): Stat => {
	const v = xs.filter(Number.isFinite);
	if (!v.length)
		return { mean: Number.NaN, min: Number.NaN, max: Number.NaN, n: 0 };
	return {
		mean: v.reduce((a, b) => a + b, 0) / v.length,
		min: Math.min(...v),
		max: Math.max(...v),
		n: v.length,
	};
};
/** 決まった乱数列（ブートストラップを実行ごとに同じ値にする）。 */
const mulberry32 = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};
/** 組の平均のブートストラップ95%区間（組を復元抽出、百分位）。 */
const bootCI = (xs: number[]): [number, number] => {
	const v = xs.filter(Number.isFinite);
	if (v.length < 2) return [Number.NaN, Number.NaN];
	const rnd = mulberry32(20260928);
	const means = new Float64Array(BOOT);
	for (let b = 0; b < BOOT; b++) {
		let s = 0;
		for (let i = 0; i < v.length; i++) s += v[Math.floor(rnd() * v.length)];
		means[b] = s / v.length;
	}
	means.sort();
	return [
		means[Math.floor(0.025 * (BOOT - 1))],
		means[Math.ceil(0.975 * (BOOT - 1))],
	];
};
const valuesOf = (
	group: string,
	k: string,
	filter: (p: PairRec) => boolean = () => true,
): number[] =>
	pairs.filter((p) => p.group === group && filter(p)).map((p) => p.m[k]);

const GROUPS = [
	"GG-within",
	"GG-between",
	"G-ref",
	"G-refPlan",
	...[...new Set(basePairs.map((p) => p.tier))],
];
const metricNames = [...new Set(pairs.flatMap((p) => Object.keys(p.m)))];
const ORDER = [
	"form",
	"harm",
	"arp",
	"bass",
	"comp",
	"dyn",
	"tempo",
	"timbre",
	"open",
	"seam",
	"plan",
];
metricNames.sort((a, b) => {
	const ia = ORDER.findIndex((x) => a.startsWith(x));
	const ib = ORDER.findIndex((x) => b.startsWith(x));
	return ia - ib || a.localeCompare(b);
});
const table: Record<string, Record<string, Stat>> = {};
for (const k of metricNames) {
	table[k] = {};
	for (const g of GROUPS) {
		const s = stat(valuesOf(g, k));
		if (s.n) table[k][g] = s;
	}
}

/** 型の中の組を数える4指標（§4.5 の新しい規則）。 */
const WITHIN_METRICS = [
	"harm.bar chord vocab",
	"bass.rhythm vocab",
	"comp.rhythm vocab",
	"arp.shape vocab",
];
/** 型の間の組を数える7指標。 */
const BETWEEN_METRICS = [
	"harm.bar chord vocab",
	"bass.rhythm vocab",
	"arp.shape vocab",
	"comp.rhythm vocab",
	"form.arc (texture curves)",
	"dyn.v curve shape (r)",
	"timbre/mix fields",
];
const LABEL: Record<string, string> = {
	"harm.bar chord vocab": "1小節の和音の語彙",
	"bass.rhythm vocab": "低音のリズム語彙",
	"comp.rhythm vocab": "和音のリズム語彙",
	"arp.shape vocab": "分散の形の語彙",
	"arp.rhythm vocab": "分散のリズム語彙",
	"form.arc (texture curves)": "全体の形",
	"dyn.v curve shape (r)": "強弱の曲線の形",
	"timbre/mix fields": "楽器・ミックス",
};
const HEADLINE = [
	"harm.bar chord vocab",
	"bass.rhythm vocab",
	"comp.rhythm vocab",
	"arp.shape vocab",
	"arp.rhythm vocab",
	"form.arc (texture curves)",
	"dyn.v curve shape (r)",
	"timbre/mix fields",
];

type Base = {
	all: Stat & { ci: [number, number] };
	/** 印（flag）の付いた組を除いた値。 */
	clean: Stat;
	flagged: number;
};
const baseStatCache = new Map<string, Base>();
const baseStat = (tier: string, k: string): Base => {
	const key = `${tier}\u0000${k}`;
	const hit = baseStatCache.get(key);
	if (hit) return hit;
	const xs = valuesOf(tier, k);
	const out: Base = {
		all: { ...stat(xs), ci: bootCI(xs) },
		clean: stat(valuesOf(tier, k, (p) => !p.flag)),
		flagged: pairs.filter((p) => p.group === tier && p.flag).length,
	};
	baseStatCache.set(key, out);
	return out;
};
type Thresholds = { a: number; b: number; lowTier: string };
const thresholdCache = new Map<string, Thresholds>();
/** 段階A = H-ver の平均。段階B = (H-ref の平均 + H-ver の平均)/2（和音のリズムと、H-ref が無いときは H-diff）。 */
const thresholds = (k: string): Thresholds => {
	const hit = thresholdCache.get(k);
	if (hit) return hit;
	const hv = baseStat("H-ver", k).all.mean;
	const lowTier =
		k === "comp.rhythm vocab" || !Number.isFinite(baseStat("H-ref", k).all.mean)
			? "H-diff"
			: "H-ref";
	const lo = baseStat(lowTier, k).all.mean;
	const out = { a: hv, b: (lo + hv) / 2, lowTier };
	thresholdCache.set(k, out);
	return out;
};
const votes = (m: Metrics, keys: string[]): number =>
	keys.filter((k) => {
		const a = thresholds(k).a;
		return Number.isFinite(m[k]) && Number.isFinite(a) && m[k] >= a;
	}).length;

// ============================================================
// 退避率・候補 k=0 の通過率・計画の中の引き直しの使い切り（§5）
// ============================================================

const diagT0 = Date.now();
type DiagSummary = {
	songs: number;
	fallback: number;
	pick0: number;
	picks: Record<string, number>;
	candidates: number;
	rejectedBy: Record<string, number>;
	exhausted: {
		lengths: number;
		texture: number;
		offsets: number;
		anyCandidates: number;
	};
	exhaustedAccepted: {
		lengths: number;
		texture: number;
		offsets: number;
		any: number;
	};
	fallbackGateFailures: number;
};
const diag: DiagSummary = {
	songs: 0,
	fallback: 0,
	pick0: 0,
	picks: {},
	candidates: 0,
	rejectedBy: {},
	exhausted: { lengths: 0, texture: 0, offsets: 0, anyCandidates: 0 },
	exhaustedAccepted: { lengths: 0, texture: 0, offsets: 0, any: 0 },
	fallbackGateFailures: 0,
};
for (const key of KEYS)
	for (let seed = DIAG_SEED; seed < DIAG_SEED + DIAG_COUNT; seed++) {
		const log: AccompCandidateDiag[] = [];
		const song = composeAccomp({
			random: seededRandom(seed),
			baseKey: key,
			diagnostics: (d) => log.push(d),
		});
		diag.songs++;
		diag.picks[song.pick] = (diag.picks[song.pick] ?? 0) + 1;
		if (song.pick === -1) diag.fallback++;
		if (song.pick === 0) diag.pick0++;
		for (const d of log) {
			if (d.k === -1) {
				if (d.rejectedBy) diag.fallbackGateFailures++;
				continue;
			}
			diag.candidates++;
			if (d.rejectedBy)
				diag.rejectedBy[d.rejectedBy] =
					(diag.rejectedBy[d.rejectedBy] ?? 0) + 1;
			const p = d.plan;
			if (!p) continue;
			if (p.lengthsExhausted) diag.exhausted.lengths++;
			if (p.textureExhausted) diag.exhausted.texture++;
			if (p.offsetsExhausted) diag.exhausted.offsets++;
			const anyEx =
				p.lengthsExhausted || p.textureExhausted || p.offsetsExhausted;
			if (anyEx) diag.exhausted.anyCandidates++;
			if (d.rejectedBy === null) {
				if (p.lengthsExhausted) diag.exhaustedAccepted.lengths++;
				if (p.textureExhausted) diag.exhaustedAccepted.texture++;
				if (p.offsetsExhausted) diag.exhaustedAccepted.offsets++;
				if (anyEx) diag.exhaustedAccepted.any++;
			}
		}
	}
const tDiag = (Date.now() - diagT0) / 1000;

// ============================================================
// 聴いていない組（§4.1・§4.5）
// ============================================================

const rowsOf = (plan: AccompPlan): string[] => {
	const rows = [`pair:${plan.borrowPair}`];
	for (const r of plan.regions) {
		for (const c of r.texture.arpCells) rows.push(`arp:${c}`);
		for (const b of r.texture.bass) rows.push(`bass:${b}`);
		rows.push(`comp:${r.texture.comp}`);
	}
	return rows;
};
const unheard = (() => {
	let draws = 0;
	let miss = 0;
	let songsWithMiss = 0;
	let archetypeMiss = 0;
	const missRows = new Map<string, number>();
	for (const g of gens) {
		const arch = g.archetype ?? style.id;
		const heardRows = new Set(heard.heard[arch] ?? []);
		if (!heard.heard[arch]) archetypeMiss++;
		let songMiss = false;
		for (const row of rowsOf(g.plan as AccompPlan)) {
			draws++;
			if (!heardRows.has(row)) {
				miss++;
				songMiss = true;
				missRows.set(row, (missRows.get(row) ?? 0) + 1);
			}
		}
		if (songMiss) songsWithMiss++;
	}
	return { draws, miss, songsWithMiss, archetypeMiss, missRows };
})();

// ============================================================
// 書き出し
// ============================================================

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const pct = (a: number, b: number) =>
	b ? `${a}/${b}（${((a / b) * 100).toFixed(1)}%）` : "0/0";
const cell = (s?: Stat) =>
	s ? `${f2(s.mean)} [${f2(s.min)}–${f2(s.max)}]` : "–";
const lines: string[] = [];
const push = (...xs: string[]) => lines.push(...xs);
const within = pairs.filter((p) => p.group === "GG-within");
const between = pairs.filter((p) => p.group === "GG-between");
const hverAll = pairs.filter((p) => p.group === "H-ver");
const labels = basePairs.filter((p) => p.ownerLabel);

push(
	`# 伴奏主体モードのばらつきの監査（${style.id}.v${style.version}）`,
	"",
	"`scripts/audit-accomp-variety.ts` が書いた。**報告だけ**（関門ではない。曲の選抜にも使わない）。値は組ごとの類似度（1 = 同一）。",
	"",
	`- 生成 ${gens.length}曲（baseKey ${KEYS.join("/")} × 種 ${SEED}〜${SEED + KEYS.length * COUNT - 1}、調の指定ごとに ${COUNT}曲）。型は ${[...new Set(gens.map((g) => g.archetype))].join("・")}（${[...new Set(gens.map((g) => g.archetype))].length}つ）なので、生成曲の組は型の中 ${within.length}組・型の間 ${between.length}組`,
	`- 基準: \`${BASELINE_PATH}\`（${baseline.pairs.length}組）${localBaseline ? ` ＋ ローカル \`${LOCAL_BASELINE}\`（${localBaseline.pairs.length}組。gitignore）` : "（ローカルの基準なし。H-ref・H-diff は n=0）"}${missing.length ? `。無いファイル: ${missing.join("・")}` : ""}`,
	`- 所有者のラベル: same ${labels.filter((p) => p.ownerLabel === "same").length}組・different ${labels.filter((p) => p.ownerLabel === "different").length}組。両方のクラスが10組以上たまるまで、しきい値は仮の値として表示だけ（§4.5 較正）`,
	`- 測定 ${tMeasure.toFixed(1)}秒、退避率の集計 ${tDiag.toFixed(1)}秒`,
	"",
	"## 主な指標（§4.5 の表と同じ並び）",
	"",
	"段階A = H-ver の平均、段階B = (H-ref の平均 + H-ver の平均)/2（和音のリズム語彙と、H-ref が無いときは H-diff）。語彙は Jaccard で重み付けた重なり（完全一致の値は下の全指標の表の `exact`）。",
	"",
	"| 指標 | GG 型の中 | G-ref | 段階A | 段階B | H-ver 平均 [95%区間] n | H-ver 印を除く n | H-ref 平均 [95%区間] n | H-diff 平均 [95%区間] n |",
	"|---|---|---|---|---|---|---|---|---|",
);
for (const k of HEADLINE) {
	const hv = baseStat("H-ver", k);
	const hr = baseStat("H-ref", k);
	const hd = baseStat("H-diff", k);
	const th = thresholds(k);
	const gg = table[k]?.["GG-within"];
	const mark = (thr: number) =>
		gg && Number.isFinite(thr)
			? gg.mean <= thr
				? "（下）"
				: "（**上**）"
			: "";
	const b3 = (b: Base) =>
		b.all.n
			? `${f2(b.all.mean)} [${f2(b.all.ci[0])}–${f2(b.all.ci[1])}] n=${b.all.n}`
			: "–（n=0）";
	push(
		`| ${LABEL[k] ?? k} | ${cell(gg)} | ${cell(table[k]?.["G-ref"])} | ≤ ${f2(th.a)}${mark(th.a)} | ≤ ${f2(th.b)}${mark(th.b)}${th.lowTier === "H-diff" ? "（H-diff）" : ""} | ${b3(hv)} | ${hv.flagged ? `${f2(hv.clean.mean)} n=${hv.clean.n}` : "–"} | ${b3(hr)} | ${b3(hd)} |`,
	);
}
push("", "（下）＝ GG 型の中の平均がしきい値以下、（**上**）＝ 上回る。", "");

// ---- ほぼ重複 ----
const dist = (ps: PairRec[], keys: string[]) => {
	const d = Array(keys.length + 1).fill(0);
	for (const p of ps) d[votes(p.m, keys)]++;
	return d as number[];
};
push(
	"## ほぼ重複の組（§4.5 の新しい規則）",
	"",
	`- 型の中の組: 4指標（${WITHIN_METRICS.map((k) => LABEL[k]).join("・")}）のうち3つ以上が H-ver の平均以上ならほぼ重複。分散のリズム語彙は形と重なるので参考（下の表）`,
);
if (within.length) {
	const d = dist(within, WITHIN_METRICS);
	const dup = within.filter((p) => votes(p.m, WITHIN_METRICS) >= 3).length;
	push(
		`  - 票の数（0〜4票の順）: ${d.join("/")}。ほぼ重複 ${pct(dup, within.length)}`,
	);
	for (const k of [...WITHIN_METRICS, "arp.rhythm vocab"]) {
		const a = thresholds(k).a;
		const n = within.filter(
			(p) => Number.isFinite(p.m[k]) && p.m[k] >= a,
		).length;
		push(
			`  - ${LABEL[k]}が H-ver の平均（${f2(a)}）以上: ${pct(n, within.length)}${k === "arp.rhythm vocab" ? "（参考）" : ""}`,
		);
	}
}
push(
	`- 型の間の組: 7指標（${BETWEEN_METRICS.map((k) => LABEL[k]).join("・")}）のうち4つ以上でほぼ重複（別に報告）`,
);
if (between.length) {
	const d = dist(between, BETWEEN_METRICS);
	const dup = between.filter((p) => votes(p.m, BETWEEN_METRICS) >= 4).length;
	push(
		`  - 票の数（0〜7票の順）: ${d.join("/")}。ほぼ重複 ${pct(dup, between.length)}`,
	);
} else {
	push(
		"  - 型の間の組は0組（型が1つ）。参考として、型の中の組を7指標で数えると:",
	);
	const d = dist(within, BETWEEN_METRICS);
	const dup = within.filter((p) => votes(p.m, BETWEEN_METRICS) >= 4).length;
	push(
		`    票の数（0〜7票の順）: ${d.join("/")}。4票以上 ${pct(dup, within.length)}`,
	);
}
push(
	`- 基準の組の票（型の中の4指標）: ${hverAll.map((p) => `${p.a}~${p.b}${p.flag ? `（${p.flag}）` : ""} ${votes(p.m, WITHIN_METRICS)}`).join("、") || "–"}`,
	"",
);

// ---- 曲の頭と継ぎ目 ----
const OPEN_KEYS = [
	"open.harm.bar chord vocab",
	"open.bass.rhythm vocab",
	"open.comp.rhythm vocab",
	"open.arp.rhythm vocab",
	"open.arp.shape vocab",
	"open.all.onset+pc aligned",
];
const SEAM_KEYS = [
	"seam.last bar identical",
	"seam.last bar rhythm identical",
	"seam.last bar J",
	"seam.first bar identical",
	"seam.first bar rhythm identical",
	"seam.first bar J",
];
const smallTable = (title: string, keys: string[], note: string) => {
	push(
		title,
		"",
		note,
		"",
		`| 指標 | ${GROUPS.join(" | ")} |`,
		`|---|${GROUPS.map(() => "---").join("|")}|`,
	);
	for (const k of keys)
		push(
			`| ${k} | ${GROUPS.map((g) => (table[k]?.[g] ? `${f2(table[k][g].mean)} n=${table[k][g].n}` : "–")).join(" | ")} |`,
		);
	push("");
};
smallTable(
	`## 曲の頭（最初の ${OPENING_BARS} 小節）`,
	OPEN_KEYS,
	"曲の頭だけで測った語彙と、同じ小節・同じ位置・同じ音高クラスの一致（層をまとめて）。H-part（backing との組）が 1 なのは正しい（fb と fa の頭は backing そのもの）。",
);
smallTable(
	"## 継ぎ目（最終小節・最初の小節）",
	SEAM_KEYS,
	"`identical` は、その小節の音（層・位置・長さ・移調を合わせた音高クラス）が組の両方で完全に同じ割合。`rhythm identical` は音高を外した層・位置・長さだけで同じ割合。`J` は音の集合の Jaccard。ループの閉じ方5点はスタイルの正体として固定した（§9.1.1）。生成曲の最終小節は、リズムと和音は全曲同じだが、分散の音の並び（どの構成音から始まるか）が調によって変わる（音域の窓が絶対 MIDI のため）。",
);

// ---- 陽性対照（往復） ----
{
	const a = refPlanPiece;
	const b = refName ? byName.get(refName) : undefined;
	if (a && b) {
		const { m } = pairMetrics(a, b);
		push(
			"## 陽性対照（参照計画を鳴らした MML と参照の MML、区間で揃えた値。§5 の往復の下限）",
			"",
			"| 層 | リズム | 音高（同じ位置の発音＋音高クラス） |",
			"|---|---|---|",
		);
		for (const r of NOTE_ROLES)
			push(
				`| ${r} | ${(m[`${r}.rhythm region-aligned`] ?? Number.NaN).toFixed(3)} | ${(m[`${r}.onset+pc region-aligned`] ?? Number.NaN).toFixed(3)} |`,
			);
		push("");
	}
}

// ---- 退避率 ----
{
	const d = diag;
	const k0 = d.songs ? d.pick0 / d.songs : Number.NaN;
	push(
		"## 退避率・候補 k=0 の通過率・計画の中の引き直しの使い切り（§5）",
		"",
		`${d.songs}曲（baseKey ${KEYS.join("/")} × 種 ${DIAG_SEED}〜${DIAG_SEED + DIAG_COUNT - 1}、recent なし）。`,
		"",
		`- 保険の計画への退避（pick −1）: ${pct(d.fallback, d.songs)}。退避先は参照計画そのものなので、増えると参照の複製が増える`,
		`- 候補 k=0 がそのまま通った曲: ${pct(d.pick0, d.songs)}${k0 < 0.5 ? "。**50%を下回った（足した行を疑う。§5）**" : ""}`,
		`- 採った候補番号の分布: ${Object.entries(d.picks)
			.sort(([x], [y]) => Number(x) - Number(y))
			.map(([k, n]) => `k=${k}×${n}`)
			.join("・")}`,
		`- 関門に掛けた候補 ${d.candidates}。落ちた理由: ${
			Object.entries(d.rejectedBy)
				.map(([g, n]) => `${g} ${n}`)
				.join("・") || "なし"
		}`,
		`- 計画の中の引き直しを使い切った候補（関門に掛けた ${d.candidates} のうち）: 区間長 LENGTH_TRIES ${d.exhausted.lengths}・質感 TEXTURE_TRIES ${d.exhausted.texture}・±2 のずれ OFFSET_TRIES ${d.exhausted.offsets}（どれか ${d.exhausted.anyCandidates}）`,
		`- そのうち採った曲（関門を通った）: 区間長 ${d.exhaustedAccepted.lengths}・質感 ${d.exhaustedAccepted.texture}・ずれ ${d.exhaustedAccepted.offsets}（どれか ${d.exhaustedAccepted.any}）`,
		`- 保険の計画が関門で落ちた回数: ${d.fallbackGateFailures}（検算上は 0）`,
		"",
	);
}

// ---- 聴いていない組 ----
{
	const u = unheard;
	const share = u.draws ? u.miss / u.draws : 0;
	push(
		"## 聴いていない組（§4.1 の対策2・§4.5）",
		"",
		`\`${HEARD_PATH}\` に無い（型, 行）の組が引かれた割合。行は分散のセル・低音型・和音の基本の打ち方・借用の組（和声の句はまだ数えない）。`,
		"",
		`- 行の引き: ${pct(u.miss, u.draws)}${share > UNHEARD_WARN ? `。**${UNHEARD_WARN * 100}%を超えた（仮のしきい値）**` : ""}`,
		`- 聴いていない行を1つ以上含む曲: ${pct(u.songsWithMiss, gens.length)}。聴いていない型の曲: ${u.archetypeMiss}`,
		`- 聴いていない行: ${
			[...u.missRows]
				.sort((a, b) => b[1] - a[1])
				.map(([r, n]) => `${r}×${n}`)
				.join("・") || "なし"
		}`,
		"",
	);
}

// ---- 全指標 ----
push(
	"## 全指標（組の種類ごとの 平均 [最小–最大]）",
	"",
	`組の数: ${GROUPS.map((g) => `${g} ${pairs.filter((p) => p.group === g).length}`).join("、")}`,
	"",
	`| 指標 | ${GROUPS.join(" | ")} |`,
	`|---|${GROUPS.map(() => "---").join("|")}|`,
);
for (const k of metricNames)
	push(`| ${k} | ${GROUPS.map((g) => cell(table[k][g])).join(" | ")} |`);
push("");

// ---- 基準の組ごと ----
push(
	"## 基準の組ごとの値（主な指標）",
	"",
	`| 組 | ${HEADLINE.map((k) => LABEL[k]).join(" | ")} |`,
	`|---|${HEADLINE.map(() => "---").join("|")}|`,
);
const GEN_GROUPS = new Set(["GG-within", "GG-between", "G-ref", "G-refPlan"]);
for (const p of pairs.filter(
	(x) => !GEN_GROUPS.has(x.group) && x.group !== "H-diff",
))
	push(
		`| ${p.group} ${p.a}~${p.b}${p.flag ? `（${p.flag}）` : ""}${p.local ? "（ローカル）" : ""} t*=${p.shift} | ${HEADLINE.map((k) => f2(p.m[k])).join(" | ")} |`,
	);
push("", "H-diff の組ごとの値は JSON（pairs）にある。", "");

// ---- 音色の欄 ----
push("## 音色の欄（手書きの基準と、生成曲の1曲目）", "");
for (const p of [
	...pieces.filter((x) => x.group === "hand" && !basePieces[x.name]?.local),
	...gens.slice(0, 1),
])
	push(
		`- ${p.name}（${p.bars}小節・${p.bpm}BPM・${p.seconds.toFixed(0)}秒）: ${Object.entries(
			timbreFields(p),
		)
			.filter(([, v]) => v !== "-")
			.map(([k, v]) => `${k}=${v}`)
			.join(" ")}`,
	);
push("");

mkdirSync(OUT, { recursive: true });
const mdPath = join(OUT, `audit-${STYLE_ID}.md`);
const jsonPath = join(OUT, `audit-${STYLE_ID}.json`);
writeFileSync(mdPath, `${lines.join("\n")}\n`);
writeFileSync(
	jsonPath,
	JSON.stringify(
		{
			style: `${style.id}.v${style.version}`,
			seed: SEED,
			count: COUNT,
			keys: KEYS,
			table,
			baseline: Object.fromEntries(
				HEADLINE.map((k) => [
					k,
					{
						hver: baseStat("H-ver", k),
						href: baseStat("H-ref", k),
						hdiff: baseStat("H-diff", k),
						thresholds: thresholds(k),
					},
				]),
			),
			diag,
			unheard: { ...unheard, missRows: Object.fromEntries(unheard.missRows) },
			pairs,
		},
		null,
		1,
	),
);
console.log(lines.join("\n"));
console.log(
	`書いた: ${mdPath} / ${jsonPath}（${((Date.now() - t0) / 1000).toFixed(1)}秒）`,
);
