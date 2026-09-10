/**
 * **生成系の到達範囲を測る。**「出てこない曲」の原因が採点なのか生成なのかを分ける。
 *
 *   npx tsx scripts/compare-reach.ts --dir "C:/path/to/midis" --songs 1500
 *
 * ## なぜ要るか
 *
 * `check-evaluator.ts` は採点式を疑うが、採点式は**引けたものを選ぶことしかできない**。
 * 候補に一度も現れない形は、重みをどう変えても出てこない。実際、
 *
 *   採点を完全に切って（`drawCount: 1`）音階15種×調3種×構成6種を1500本引いても、
 *   コーパス91本のうち**到達できるのは58本(64%)**。残る33本は生成系の外側にある。
 *
 * ——採点式をいくら直しても、この33本は出ない。「参考曲のような曲が生成されない」の
 * 原因の切り分けは、まずここでやる。
 *
 * ## 何を出すか
 *
 * 1. コーパスの各曲へ、生成系が最短でどこまで近づけるか（`CORPUS_NN_RADIUS` が基準）
 * 2. 届かない曲について、**どの軸が原因か**——その曲の値が生成系の実測レンジ
 *    （p01〜p99）からどれだけ外れているかを軸ごとに集計する。
 *
 * 2 がそのまま「生成系のどこを開ければ何本届くようになるか」の優先順位になる。
 * 個別の推測ではなく実測で順番を決めるためのもの。
 */

import { composeSong } from "../src/compose";
import {
	CORPUS_BANDS,
	CORPUS_NN_RADIUS,
	CORPUS_PROFILE_KEYS,
} from "../src/compose-corpus";
import {
	densityFeatures,
	type MetricNote,
	normalizeByBand,
	profileDistance,
	structureFeatures,
} from "../src/compose-metrics";
import { UNITS_PER_SEMITONE } from "../src/tuning";
import {
	channelNotes,
	chromaticRatioOf,
	collectFromDir,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";

const STEPS_PER_BAR = 192;
const WINDOW = 20;
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** 生成系の設定を総当りする（狭い設定だけで測ると到達範囲を過小に見積もる）。 */
const SCALES = [
	"auto",
	"minyo",
	"dorian",
	"phrygian",
	"harmonic_minor",
	"hungarian",
	"miyakobushi",
	"blues",
	"ritsu",
	"ryukyu",
	"yo",
	"mixolydian",
	"lydian",
	"hijaz",
	"any",
];
const KEYS = ["any", "major", "minor"];
const TEMPLATES = [
	undefined,
	"1chorus",
	"jpop_standard",
	"jpop_drop",
	"vocaloid",
	"verse_chorus",
];

const durationEntropy = (ns: MetricNote[]): number => {
	const counts = new Map<number, number>();
	for (const n of ns)
		counts.set(n.durationSteps, (counts.get(n.durationSteps) ?? 0) + 1);
	let h = 0;
	for (const v of counts.values()) {
		const p = v / ns.length;
		h -= p * Math.log2(p);
	}
	return h;
};

const featuresOf = (m: MetricNote[]): Record<string, number> => {
	const bars = Math.max(
		4,
		Math.ceil(
			Math.max(...m.map((n) => n.startStep + n.durationSteps)) / STEPS_PER_BAR,
		),
	);
	const durations = m.map((n) => n.durationSteps);
	const played = durations.reduce((a, b) => a + b, 0);
	const pitches = m.map((n) => n.pitchSemi);
	let steps = 0;
	let leaps = 0;
	let intervals = 0;
	let maxLeap = 0;
	for (let i = 1; i < m.length; i++) {
		const gap = Math.abs(m[i].pitchSemi - m[i - 1].pitchSemi);
		intervals++;
		if (gap !== 0 && gap <= 2) steps++;
		else if (gap > 2) leaps++;
		maxLeap = Math.max(maxLeap, gap);
	}
	const opts = { stepsPerBar: STEPS_PER_BAR, bars };
	const density = densityFeatures(m, opts);
	const structure = structureFeatures(m, [], opts);
	return {
		entropy: durationEntropy(m),
		valueKinds: new Set(durations).size,
		restRatio: Math.max(0, 1 - played / (bars * STEPS_PER_BAR)),
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		stepRatio: intervals === 0 ? 0 : steps / intervals,
		chromaticRatio: chromaticRatioOf(m),
		maxLeap,
		melodyRange: Math.max(...pitches) - Math.min(...pitches),
		notesPerBar: density.notesPerBar,
		shortNoteRatio: density.shortNoteRatio,
		barDensityCv: density.barDensityCv,
		densityCliff: density.densityCliff,
		sim1: structure.sim1,
		sim2: structure.sim2,
		sim4: structure.sim4,
		sim8: structure.sim8,
		phraseBreath: structure.phraseBreath,
		turnRatio: structure.turnRatio,
		climaxPosition: structure.climaxPosition,
		climaxPeaks: structure.climaxPeaks,
		// メロディ1本では測れないので両者そろって0に固定し、距離に効かせない。
		complementarity: 0,
	};
};

const profileOf = (f: Record<string, number>): number[] =>
	CORPUS_PROFILE_KEYS.map((k) => normalizeByBand(f[k] ?? 0, CORPUS_BANDS[k]));

const clip = (ns: MetricNote[]): MetricNote[] | null => {
	if (ns.length === 0) return null;
	const from = Math.floor(ns[0].startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
	const out = ns
		.filter(
			(n) => n.startStep >= from && n.startStep < from + WINDOW * STEPS_PER_BAR,
		)
		.map((n) => ({ ...n, startStep: n.startStep - from }));
	return out.length < 16 ? null : out;
};

const percentile = (values: number[], q: number): number => {
	const s = [...values].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.round((s.length - 1) * q))];
};

const dir = argOf("--dir");
if (!dir) {
	console.error("--dir <MIDIのフォルダ> を指定してください。");
	process.exit(1);
}

// --- コーパス側 ---
type Song = { name: string; feat: Record<string, number>; profile: number[] };
const corpus: Song[] = [];
for (const buf of collectFromDir(dir)) {
	try {
		const byChannel = channelNotes(parseSmf(buf));
		let melody: MetricNote[] = [];
		let best = -1;
		for (const ns of byChannel.values()) {
			if (!isPlausibleMelody(ns)) continue;
			const coverage = ns.reduce((sum, n) => sum + n.durationSteps, 0);
			if (coverage > best) {
				best = coverage;
				melody = ns;
			}
		}
		const clipped = clip(toMonophonic(quantize(melody)));
		if (!clipped) continue;
		const feat = featuresOf(clipped);
		corpus.push({
			name: `#${corpus.length + 1}`,
			feat,
			profile: profileOf(feat),
		});
	} catch {
		// 読めないMIDIは飛ばす（較正と同じ扱い）
	}
}

// --- 生成側（採点を完全に切る） ---
const songs = Number.parseInt(argOf("--songs") ?? "1500", 10);
const generated: { feat: Record<string, number>; profile: number[] }[] = [];
for (let i = 0; i < songs; i++) {
	try {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			drawCount: 1, // ← 採点で選ばせない。生成系そのものの範囲を測る
			baseKey: KEYS[i % KEYS.length],
			scale: SCALES[i % SCALES.length],
			template: TEMPLATES[i % TEMPLATES.length],
		});
		const notes: MetricNote[] = song.melody
			.map((n) => ({
				startStep: n.startStep,
				pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
				durationSteps: n.durationSteps,
			}))
			.sort((a, b) => a.startStep - b.startStep);
		const clipped = clip(notes);
		if (!clipped) continue;
		const feat = featuresOf(clipped);
		generated.push({ feat, profile: profileOf(feat) });
	} catch {
		// 引きの失敗は数えない
	}
}

// --- ① 到達できるか ---
const reachable: Song[] = [];
const unreachable: { song: Song; distance: number }[] = [];
for (const song of corpus) {
	const d = Math.min(
		...generated.map((g) => profileDistance(g.profile, song.profile)),
	);
	if (d <= CORPUS_NN_RADIUS) reachable.push(song);
	else unreachable.push({ song, distance: d });
}

console.log(
	`● 採点なし(drawCount=1)で ${generated.length}曲を引き、コーパス ${corpus.length}本への到達を測る`,
);
console.log(
	`  到達（距離 ≦ ${CORPUS_NN_RADIUS}）: ${reachable.length}本 (${((reachable.length / corpus.length) * 100).toFixed(0)}%)`,
);
console.log(
	`  未到達: ${unreachable.length}本 — 距離 中央 ${percentile(
		unreachable.map((u) => u.distance),
		0.5,
	).toFixed(3)} / 最大 ${percentile(
		unreachable.map((u) => u.distance),
		1,
	).toFixed(3)}`,
);

// --- ② どの軸が原因か ---
//
// 生成系の実測レンジ（p01〜p99）を各軸で出し、未到達の曲の値がそこから
// どれだけ外れているかを見る。外れている曲が多い軸ほど、開ける価値が高い。
const KEYS_M = CORPUS_PROFILE_KEYS.filter((k) => k !== "complementarity");
type Blame = {
	key: string;
	songs: number;
	lo: number;
	hi: number;
	worst: number;
};
const blames: Blame[] = [];
for (const key of KEYS_M) {
	const gv = generated.map((g) => g.feat[key]);
	const lo = percentile(gv, 0.01);
	const hi = percentile(gv, 0.99);
	let count = 0;
	let worst = 0;
	for (const { song } of unreachable) {
		const v = song.feat[key];
		const out = v < lo ? lo - v : v > hi ? v - hi : 0;
		if (out > 0) {
			count++;
			// 帯幅で正規化して軸どうしを比べられるようにする
			const span = CORPUS_BANDS[key][3] - CORPUS_BANDS[key][0] || 1;
			worst = Math.max(worst, out / span);
		}
	}
	blames.push({ key, songs: count, lo, hi, worst });
}
blames.sort((a, b) => b.songs - a.songs || b.worst - a.worst);

console.log(
	`\n● 未到達 ${unreachable.length}本を、生成系の実測レンジ(p01〜p99)から外れる軸で分解`,
);
console.log(
	"  軸                 外れる曲数   生成系のレンジ        最大の外れ(帯幅比)",
);
for (const b of blames) {
	if (b.songs === 0) continue;
	console.log(
		`  ${b.key.padEnd(18)}${String(b.songs).padStart(6)}本   ${b.lo.toFixed(2).padStart(7)} 〜 ${b.hi.toFixed(2).padStart(7)}   ${b.worst.toFixed(2).padStart(8)}`,
	);
}
const none = blames.every((b) => b.songs === 0);
if (none)
	console.log(
		"  （どの軸も単独では外れていない＝周辺分布ではなく**組み合わせ**が届いていない）",
	);

// --- ③ 単独の軸では説明できない曲 ---
//
// どの軸も生成系のレンジ内なのに未到達＝「その値の組み合わせ」が出てこない曲。
// 定数を緩めても届かないので、生成の型そのものを増やす必要がある。
let jointOnly = 0;
for (const { song } of unreachable) {
	let outside = false;
	for (const b of blames) {
		const v = song.feat[b.key];
		if (v < b.lo || v > b.hi) {
			outside = true;
			break;
		}
	}
	if (!outside) jointOnly++;
}
console.log(
	`\n  うち、どの軸も生成系のレンジ内なのに未到達の曲: ${jointOnly}本` +
		`\n  （＝定数を緩めても届かない。組み合わせを作れる生成の型が要る）`,
);
