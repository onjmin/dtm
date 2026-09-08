/**
 * **語彙**（リズム型の集合）を参考コーパスと突き合わせる調査スクリプト。
 *
 *   npx tsx scripts/compare-vocabulary.ts --dir "C:/path/to/midis" [--songs 80]
 *
 * `compare-corpus.ts` が曲の特徴量を比べるのに対し、こちらは
 * **「そもそも語彙が足りているのか」「多すぎないか」** を測る。
 *
 * 1. 被覆率     … 参考曲の小節リズムのうち、語彙に存在する割合
 * 2. 抽選の実態 … 生成物が実際に鳴らした小節のうち、参考曲に実在する形の割合
 * 3. 集中度     … 上位パターンが小節を占める割合（人間の曲は少数の型に集中する）
 * 4. 切除の是非 … Good-Turing による未観測質量。「参考曲に無い＝外してよい」が
 *                 成り立つかを判定する材料
 * 5. モデル規模 … 交差検証で、どこまで学習すると割に合うかを測る
 */

import { composeSong, MOTIF_CELLS, RHYTHM_CELLS } from "../src/compose";
import type { MetricNote } from "../src/compose-metrics";
import {
	channelNotes,
	collectFromDir,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";

const STEPS_PER_BAR = 192;
const GRID = STEPS_PER_BAR / 16;
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** 音価の並び（休符込み）→ 発音位置の集合（16分格子）。 */
const onsetKeyOfCell = (value: number[]): string => {
	const on: number[] = [];
	let at = 0;
	for (const v of value) {
		if (v > 0) on.push(Math.round(at / GRID));
		at += Math.abs(v);
	}
	return on.join(",");
};

/** 1曲ぶんの小節リズム列。音が無い小節は "-"。 */
const barKeysOf = (m: MetricNote[], bars?: number): string[] => {
	const from = Math.floor(m[0].startStep / STEPS_PER_BAR);
	const to = bars
		? bars - 1
		: Math.floor(Math.max(...m.map((n) => n.startStep)) / STEPS_PER_BAR);
	const out: string[] = [];
	for (let b = from; b <= to; b++) {
		const on = [
			...new Set(
				m
					.filter((n) => Math.floor(n.startStep / STEPS_PER_BAR) === b)
					.map((n) => Math.round((n.startStep - b * STEPS_PER_BAR) / GRID)),
			),
		].sort((a, x) => a - x);
		out.push(on.length ? on.join(",") : "-");
	}
	return out;
};

const dir = argOf("--dir");
if (!dir) {
	console.error("--dir <MIDIのフォルダ> を指定してください。");
	process.exit(1);
}
const songCount = Number.parseInt(argOf("--songs") ?? "80", 10);

// --- コーパスの読み込み ---
const corpusSongs: string[][] = [];
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
		const m = toMonophonic(quantize(melody));
		if (m.length >= 32) corpusSongs.push(barKeysOf(m));
	} catch {
		// 読めないMIDIは飛ばす
	}
}
const real = new Map<string, number>();
for (const s of corpusSongs)
	for (const k of s) if (k !== "-") real.set(k, (real.get(k) ?? 0) + 1);
const corpusBars = [...real.values()].reduce((a, b) => a + b, 0);

const vocabEntries = [...MOTIF_CELLS, ...RHYTHM_CELLS].map((c) =>
	onsetKeyOfCell(c.value),
);
const vocab = new Set(vocabEntries);

console.log(
	`● 語彙 ${vocab.size}種（${vocabEntries.length}エントリの重複除去） / 参考曲 ${corpusSongs.length}本 ${corpusBars}小節 ${real.size}種\n`,
);

// --- 1. 被覆率 ---
let hitBars = 0;
for (const [k, n] of real) if (vocab.has(k)) hitBars += n;
const hitKinds = [...real.keys()].filter((k) => vocab.has(k)).length;
console.log("① 被覆率（参考曲の小節リズムが語彙に存在するか）");
console.log(
	`   延べ ${((hitBars / corpusBars) * 100).toFixed(1)}%  /  異なり ${((hitKinds / real.size) * 100).toFixed(1)}%  /  語彙のうち参考曲に現れる形 ${((hitKinds / vocab.size) * 100).toFixed(1)}%`,
);
const missing = [...real.entries()]
	.filter(([k]) => !vocab.has(k))
	.sort((a, b) => b[1] - a[1])
	.slice(0, 8);
if (missing.length > 0) {
	console.log("   参考曲で多いのに語彙に無い形（発音位置, 出現小節数）");
	for (const [k, n] of missing)
		console.log(`     ${String(n).padStart(4)}小節  [${k}]`);
}

// --- 2〜3. 生成物の抽選の実態と集中度 ---
const genKeys: string[][] = [];
const recent: number[][] = [];
for (let i = 0; i < songCount; i++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		recent: recent.slice(-3),
		template: argOf("--template"),
	});
	recent.push(song.stats.fingerprint);
	if (song.melody.length === 0) continue;
	genKeys.push(
		barKeysOf(
			song.melody.map((n) => ({
				startStep: n.startStep,
				pitchSemi: 0,
				durationSteps: n.durationSteps,
			})),
			song.bars,
		),
	);
}
const genCount = new Map<string, number>();
for (const s of genKeys)
	for (const k of s) if (k !== "-") genCount.set(k, (genCount.get(k) ?? 0) + 1);
const genBars = [...genCount.values()].reduce((a, b) => a + b, 0);
let genReal = 0;
for (const [k, n] of genCount) if (real.has(k)) genReal += n;
const uniformHit =
	vocabEntries.filter((k) => real.has(k)).length / vocabEntries.length;

console.log("\n② 抽選の実態（生成物が鳴らした小節が、参考曲に実在する形か）");
console.log(
	`   語彙を一様に引いた場合 ${(uniformHit * 100).toFixed(1)}%  →  実際の生成物 ${((genReal / genBars) * 100).toFixed(1)}%`,
);

const share = (m: Map<string, number>, n: number): string => {
	const s = [...m.values()].sort((a, b) => b - a);
	const total = s.reduce((a, b) => a + b, 0);
	return `${((s.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)}%`;
};
console.log("\n③ 集中度（人間の曲は少数の型で大半の小節を書く）");
console.log(
	`   上位10種の占有率  参考 ${share(real, 10)} / 生成 ${share(genCount, 10)}`,
);
console.log(
	`   上位30種の占有率  参考 ${share(real, 30)} / 生成 ${share(genCount, 30)}`,
);

// --- 4. 切除の是非 ---
const n1 = [...real.values()].filter((v) => v === 1).length;
console.log("\n④ 「参考曲に無い＝外してよい」が成り立つか");
console.log(
	`   1回だけ出た形 ${n1}種  /  Good-Turing による未観測質量 ${((n1 / corpusBars) * 100).toFixed(2)}%`,
);
const realSets = [...real.keys()].map((k) => new Set(k.split(",").map(Number)));
const diff = (a: Set<number>, b: Set<number>): number => {
	let d = 0;
	for (const v of a) if (!b.has(v)) d++;
	for (const v of b) if (!a.has(v)) d++;
	return d;
};
const nearHist = new Map<number, number>();
for (const k of vocab) {
	if (real.has(k)) continue;
	const s = new Set(k.split(",").map(Number));
	let min = Number.POSITIVE_INFINITY;
	for (const r of realSets) min = Math.min(min, diff(s, r));
	nearHist.set(min, (nearHist.get(min) ?? 0) + 1);
}
const nonReal = [...nearHist.values()].reduce((a, b) => a + b, 0);
console.log(
	`   語彙のうち参考曲に無い ${nonReal}種と、最も近い実在形との発音位置の差:`,
);
for (const d of [...nearHist.keys()].sort((a, b) => a - b).slice(0, 5))
	console.log(
		`     差${d}個  ${String(nearHist.get(d)).padStart(4)}種  ${(((nearHist.get(d) ?? 0) / nonReal) * 100).toFixed(1)}%`,
	);

// --- 5. モデル規模 ---
const FOLDS = 5;
const ALPHA = 0.5;
const V = real.size + 1;
const ppl: Record<string, number[]> = {
	uniform: [],
	unigram: [],
	repeat: [],
	bigram: [],
};
for (let f = 0; f < FOLDS; f++) {
	const train = corpusSongs.filter((_, i) => i % FOLDS !== f);
	const test = corpusSongs.filter((_, i) => i % FOLDS === f);
	const uni = new Map<string, number>();
	const bi = new Map<string, Map<string, number>>();
	const biN = new Map<string, number>();
	let N = 0;
	let rep = 0;
	let repN = 0;
	for (const s of train)
		for (let i = 0; i < s.length; i++) {
			uni.set(s[i], (uni.get(s[i]) ?? 0) + 1);
			N++;
			if (i > 0) {
				const p = s[i - 1];
				if (!bi.has(p)) bi.set(p, new Map());
				const m2 = bi.get(p) as Map<string, number>;
				m2.set(s[i], (m2.get(s[i]) ?? 0) + 1);
				biN.set(p, (biN.get(p) ?? 0) + 1);
				repN++;
				if (s[i] === s[i - 1]) rep++;
			}
		}
	const pRep = rep / Math.max(1, repN);
	const ll = { uniform: 0, unigram: 0, repeat: 0, bigram: 0 };
	let n = 0;
	for (const s of test)
		for (let i = 0; i < s.length; i++) {
			n++;
			const pU = ((uni.get(s[i]) ?? 0) + ALPHA) / (N + ALPHA * V);
			ll.uniform += Math.log(1 / V);
			ll.unigram += Math.log(pU);
			if (i === 0) {
				ll.repeat += Math.log(pU);
				ll.bigram += Math.log(pU);
				continue;
			}
			ll.repeat += Math.log(
				s[i] === s[i - 1] ? pRep + (1 - pRep) * pU : (1 - pRep) * pU,
			);
			const prev = s[i - 1];
			const c = bi.get(prev)?.get(s[i]) ?? 0;
			const tot = biN.get(prev) ?? 0;
			const lambda = tot / (tot + 8);
			ll.bigram += Math.log(
				lambda * (tot ? c / tot : 0) + (1 - lambda) * pU || 1e-12,
			);
		}
	for (const k of Object.keys(ll) as (keyof typeof ll)[])
		ppl[k].push(Math.exp(-ll[k] / n));
}
const mean = (a: number[]): string =>
	(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(
	`\n⑤ モデル規模（${FOLDS}分割交差検証・未見の曲へのパープレキシティ。小さいほど良い）`,
);
console.log(`   一様ランダム              ${mean(ppl.uniform)}`);
console.log(`   ユニグラム（頻度だけ）      ${mean(ppl.unigram)}`);
console.log(`   直前をそのまま繰り返すだけ  ${mean(ppl.repeat)}`);
console.log(`   バイグラム                ${mean(ppl.bigram)}`);
