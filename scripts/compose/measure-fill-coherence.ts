/**
 * 範囲補完（`src/compose/compose-fill.ts`）で埋めた旋律が、前後の旋律と「筋」でつながっているかを測る。
 *
 *   npx tsx scripts/compose/measure-fill-coherence.ts [--seeds 15] [--seed0 1] [--true-key]
 *
 * 公開4カードで曲を作り、途中のセクション（歌うもの・転調なし・先頭と末尾以外）を1つずつ同じ種別で
 * 補完する。基準は「同じ曲の中の別セクションどうし」＝補完する前にそこにあった composeSong の旋律。
 *
 * - モチーフ: 2小節ごとのリズム型（16分の発音位置）・輪郭（上下の並び）・音程列（移調で不変）が
 *   範囲の外（全部／別種別だけ）にも出る割合。リズムは Jaccard ≥ 0.75 の近似一致も数える。
 *   別種別だけは2番が1番を写す（restatement）ぶんを除いた値。
 * - 音域: 鳴っている長さで重みづけた中央値（歌う中心）の差と、p10〜p90 の幅。
 * - 句: 1拍以上の休みで区切る。句頭・句末の2小節内の位置（16分）が範囲の外にも出る割合。
 * - 境目: 範囲の直前の音→範囲の最初の音、範囲の最後の音→直後の音の跳躍（半音）。
 */

import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import {
	type ComposedNote,
	type ComposeResult,
	composeSong,
	seededRandom,
} from "../../src/compose/compose";
import { detectSongKey, fillRange } from "../../src/compose/compose-fill";
import type { PlacedSection } from "../../src/compose/compose-sections";

const SPB = 192;
const SIXTEENTH = SPB / 16;
const UNIT_BARS = 2;
const PHRASE_GAP = SPB / 4;
const TEMPLATES = [
	"kaiwai_2go",
	"kaiwai_speder2",
	"kaiwai_kaisen",
	"game_loop",
];
const SUNG = new Set(["verse", "prechorus", "chorus", "bridge", "drop_chorus"]);

const arg = (name: string, def: number): number => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const SEEDS = arg("seeds", 15);
const SEED0 = arg("seed0", 1);
/** 調を曲の本当の調で渡す（アプリは detectSongKey の推定を使う。推定の外れを切り分ける用）。 */
const TRUE_KEY = process.argv.includes("--true-key");

const semi = (n: ComposedNote): number => n.pitchUnits / UNITS_PER_SEMITONE;

type Unit = {
	rhythm: string;
	onsets: Set<number>;
	contour: string;
	ivs: string;
};

/** [from, to) を2小節ごとに切った単位（空の単位は除く）。 */
const unitsOf = (notes: ComposedNote[], from: number, to: number): Unit[] => {
	const out: Unit[] = [];
	const len = UNIT_BARS * SPB;
	for (let a = from; a + len <= to; a += len) {
		const ns = notes
			.filter((n) => n.startStep >= a && n.startStep < a + len)
			.sort((x, y) => x.startStep - y.startStep);
		if (ns.length === 0) continue;
		const on = ns.map((n) => Math.round((n.startStep - a) / SIXTEENTH));
		const ps = ns.map(semi);
		const d = ps.slice(1).map((p, i) => Math.round(p - ps[i]));
		out.push({
			rhythm: on.join(","),
			onsets: new Set(on),
			contour: d.map((x) => (x > 0 ? "u" : x < 0 ? "d" : "s")).join(""),
			ivs: `${on.join(",")}|${d.join(",")}`,
		});
	}
	return out;
};

const jaccard = (a: Set<number>, b: Set<number>): number => {
	let i = 0;
	for (const x of a) if (b.has(x)) i++;
	return i / (a.size + b.size - i);
};

type Motif = { rhythm: number; near: number; contour: number; ivs: number };
const motifShare = (inside: Unit[], outside: Unit[]): Motif | null => {
	if (inside.length === 0 || outside.length === 0) return null;
	const r = new Set(outside.map((u) => u.rhythm));
	const c = new Set(outside.map((u) => u.contour));
	const v = new Set(outside.map((u) => u.ivs));
	const f = (p: (u: Unit) => boolean) =>
		inside.filter(p).length / inside.length;
	return {
		rhythm: f((u) => r.has(u.rhythm)),
		near: f((u) => outside.some((o) => jaccard(u.onsets, o.onsets) >= 0.75)),
		contour: f((u) => c.has(u.contour)),
		ivs: f((u) => v.has(u.ivs)),
	};
};

const weightedQuantile = (notes: ComposedNote[], q: number): number => {
	const s = [...notes].sort((a, b) => semi(a) - semi(b));
	const total = s.reduce((t, n) => t + n.durationSteps, 0);
	let acc = 0;
	for (const n of s) {
		acc += n.durationSteps;
		if (acc >= total * q) return semi(n);
	}
	return semi(s.at(-1) as ComposedNote);
};

/** 句頭・句末の2小節内の位置（16分）。 */
const phraseMarks = (
	notes: ComposedNote[],
): { heads: number[]; tails: number[]; lens: number[] } => {
	const s = [...notes].sort((a, b) => a.startStep - b.startStep);
	const heads: number[] = [];
	const tails: number[] = [];
	const lens: number[] = [];
	const pos = (step: number) =>
		Math.round((step % (UNIT_BARS * SPB)) / SIXTEENTH) % 32;
	let start = -1;
	for (let i = 0; i < s.length; i++) {
		if (start < 0) start = s[i].startStep;
		const end = s[i].startStep + s[i].durationSteps;
		const next = s[i + 1];
		if (!next || next.startStep - end >= PHRASE_GAP) {
			heads.push(pos(start));
			tails.push(pos(end));
			lens.push((end - start) / (SPB / 4));
			start = -1;
		}
	}
	return { heads, tails, lens };
};

const markShare = (inside: number[], outside: number[]): number | null => {
	if (inside.length === 0 || outside.length === 0) return null;
	const o = new Set(outside);
	return inside.filter((x) => o.has(x)).length / inside.length;
};

type Row = {
	template: string;
	kind: string;
	who: "orig" | "fill";
	/** 同じ種別のセクションが範囲の外にもある（2番のサビなど、元は写しで埋まる）。 */
	repeated: boolean;
	all: Motif | null;
	cross: Motif | null;
	donorOwn: Motif | null;
	centerDiff: number;
	spanIn: number;
	spanOut: number;
	head: number | null;
	tail: number | null;
	lenIn: number;
	lenOut: number;
	leapIn: number | null;
	leapOut: number | null;
};

const inRange = (n: ComposedNote, from: number, to: number) =>
	n.startStep >= from && n.startStep < to;

const measure = (
	template: string,
	song: ComposeResult,
	target: PlacedSection,
	inside: ComposedNote[],
	who: "orig" | "fill",
	donorOwn: Motif | null,
): Row => {
	const from = target.startBar * SPB;
	const to = (target.startBar + target.bars) * SPB;
	const outsideNotes = song.melody.filter((n) => !inRange(n, from, to));
	const otherSecs = song.sections.filter((s) => s !== target);
	const outUnits = (secs: PlacedSection[]) =>
		secs.flatMap((s) =>
			unitsOf(outsideNotes, s.startBar * SPB, (s.startBar + s.bars) * SPB),
		);
	const insideUnits = unitsOf(inside, from, to);
	const pIn = phraseMarks(inside);
	const pOut = phraseMarks(outsideNotes);
	const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
	const before = outsideNotes
		.filter((n) => n.startStep < from)
		.sort((a, b) => a.startStep - b.startStep)
		.at(-1);
	const after = outsideNotes
		.filter((n) => n.startStep >= to)
		.sort((a, b) => a.startStep - b.startStep)[0];
	const sorted = [...inside].sort((a, b) => a.startStep - b.startStep);
	return {
		template,
		kind: target.kind,
		who,
		repeated: otherSecs.some((s) => s.kind === target.kind),
		all: motifShare(insideUnits, outUnits(otherSecs)),
		cross: motifShare(
			insideUnits,
			outUnits(otherSecs.filter((s) => s.kind !== target.kind)),
		),
		donorOwn,
		centerDiff:
			weightedQuantile(inside, 0.5) - weightedQuantile(outsideNotes, 0.5),
		spanIn: weightedQuantile(inside, 0.9) - weightedQuantile(inside, 0.1),
		spanOut:
			weightedQuantile(outsideNotes, 0.9) - weightedQuantile(outsideNotes, 0.1),
		head: markShare(pIn.heads, pOut.heads),
		tail: markShare(pIn.tails, pOut.tails),
		lenIn: mean(pIn.lens),
		lenOut: mean(pOut.lens),
		leapIn:
			before && sorted[0] ? Math.abs(semi(sorted[0]) - semi(before)) : null,
		leapOut:
			after && sorted.at(-1)
				? Math.abs(semi(after) - semi(sorted.at(-1) as ComposedNote))
				: null,
	};
};

const rows: Row[] = [];
let keyHit = 0;
let keyTotal = 0;
const keyMiss: string[] = [];
for (const template of TEMPLATES) {
	for (let k = 0; k < SEEDS; k++) {
		const seed = SEED0 + k;
		const song = composeSong({
			stepsPerBar: SPB,
			template,
			baseKey: "minor",
			scale: "auto",
			random: seededRandom(seed),
			drawCount: 8,
		});
		const trueKey = {
			tonicPc: (9 + song.rootShift) % 12,
			mode: "minor" as const,
		};
		const detected = detectSongKey([
			...song.melody,
			...song.submelody,
			...song.bass,
			...song.pad,
		]);
		keyTotal++;
		// 長調と推定しても平行短調へ合わせるので、主音が合えば移調は同じ
		const pc = detected
			? detected.mode === "minor"
				? detected.tonicPc
				: (detected.tonicPc + 9) % 12
			: -1;
		if (pc === trueKey.tonicPc) keyHit++;
		else
			keyMiss.push(
				`${template}#${seed}: 本当 ${trueKey.tonicPc}m → 推定 ${detected?.tonicPc}${detected?.mode === "minor" ? "m" : ""}`,
			);
		const key = TRUE_KEY ? trueKey : detected;
		const secs = song.sections;
		secs.forEach((target, i) => {
			if (i === 0 || i === secs.length - 1) return;
			if (!SUNG.has(target.kind) || target.keyShift !== 0) return;
			const from = target.startBar * SPB;
			const to = (target.startBar + target.bars) * SPB;
			const orig = song.melody.filter((n) => inRange(n, from, to));
			if (orig.length === 0) return;
			const fill = fillRange({
				stepsPerBar: SPB,
				template,
				kind: target.kind,
				startBar: target.startBar,
				bars: target.bars,
				key,
				random: seededRandom(seed * 1000 + i),
			});
			if (fill.roles.melody.length === 0) return;
			// 借用曲の中での基準: 切り出したセクションの旋律と、借用曲のほかのセクション（別種別）
			const d = fill.donor;
			const ds = fill.section;
			const dFrom = ds.startBar * SPB;
			const dTo = (ds.startBar + ds.bars) * SPB;
			const donorOwn = motifShare(
				unitsOf(
					d.melody.filter((n) => inRange(n, dFrom, dTo)),
					dFrom,
					dTo,
				),
				d.sections
					.filter((s) => s !== ds && s.kind !== ds.kind)
					.flatMap((s) =>
						unitsOf(d.melody, s.startBar * SPB, (s.startBar + s.bars) * SPB),
					),
			);
			rows.push(measure(template, song, target, orig, "orig", null));
			rows.push(
				measure(template, song, target, fill.roles.melody, "fill", donorOwn),
			);
		});
	}
}

const avg = (xs: (number | null)[]): string => {
	const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
	return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "-";
};
const report = (label: string, rs: Row[]) => {
	const m = (sel: (r: Row) => Motif | null, k: keyof Motif) =>
		avg(rs.map((r) => sel(r)?.[k] ?? null));
	console.log(
		[
			label.padEnd(26),
			`n=${String(rs.length).padStart(3)}`,
			`全:律${m((r) => r.all, "rhythm")} 近${m((r) => r.all, "near")} 輪${m((r) => r.all, "contour")} 程${m((r) => r.all, "ivs")}`,
			`別種:律${m((r) => r.cross, "rhythm")} 近${m((r) => r.cross, "near")} 輪${m((r) => r.cross, "contour")} 程${m((r) => r.cross, "ivs")}`,
			`中心差|${avg(rs.map((r) => Math.abs(r.centerDiff)))}| 幅${avg(rs.map((r) => r.spanIn))}/${avg(rs.map((r) => r.spanOut))}`,
			`句頭${avg(rs.map((r) => r.head))} 句末${avg(rs.map((r) => r.tail))} 句長${avg(rs.map((r) => r.lenIn))}/${avg(rs.map((r) => r.lenOut))}拍`,
			`跳躍 入${avg(rs.map((r) => r.leapIn))} 出${avg(rs.map((r) => r.leapOut))}`,
		].join("  "),
	);
};

console.log(
	`調の推定一致 ${keyHit}/${keyTotal}。律=リズム型一致 近=リズム近似 輪=輪郭 程=音程列、全=範囲外の全セクション 別種=別種別のみ`,
);
console.log(`  外れ: ${keyMiss.slice(0, 8).join(" / ")}`);
for (const t of [...TEMPLATES, "全体"]) {
	const rs = t === "全体" ? rows : rows.filter((r) => r.template === t);
	report(
		`${t} 元`,
		rs.filter((r) => r.who === "orig"),
	);
	report(
		`${t} 補完`,
		rs.filter((r) => r.who === "fill"),
	);
}
for (const rep of [true, false]) {
	const rs = rows.filter((r) => r.repeated === rep);
	const label = rep ? "同種別が外にもある" : "同種別は範囲だけ";
	report(
		`${label} 元`,
		rs.filter((r) => r.who === "orig"),
	);
	report(
		`${label} 補完`,
		rs.filter((r) => r.who === "fill"),
	);
}
const fills = rows.filter((r) => r.who === "fill");
const own = (k: keyof Motif) => avg(fills.map((r) => r.donorOwn?.[k] ?? null));
console.log(
	`借用曲の中（切り出し部 vs 借用曲の別種別）: 律${own("rhythm")} 近${own("near")} 輪${own("contour")} 程${own("ivs")}`,
);
console.log("種別ごと（全体、元→補完の 別種:近 / 全:程）");
for (const kind of SUNG) {
	const rs = rows.filter((r) => r.kind === kind);
	if (rs.length === 0) continue;
	const o = rs.filter((r) => r.who === "orig");
	const f = rs.filter((r) => r.who === "fill");
	console.log(
		`  ${kind.padEnd(12)} n=${o.length}  別種近 ${avg(o.map((r) => r.cross?.near ?? null))}→${avg(f.map((r) => r.cross?.near ?? null))}  全程 ${avg(o.map((r) => r.all?.ivs ?? null))}→${avg(f.map((r) => r.all?.ivs ?? null))}`,
	);
}
