/**
 * **評価機そのものの検算。** 生成物ではなく、`src/compose.ts` の採点式を疑う。
 *
 *   npx tsx scripts/check-evaluator.ts --dir "C:/path/to/midis"
 *
 * ## なぜ要るか
 *
 * `scripts/check-compose.ts` は「生成物が基準を満たすか」を見る。だがそれは
 * **基準が正しいことを前提にしている**。実際、この検算を初めて走らせたとき
 *
 *   コーパス91本の素点  中央値 0.673
 *   生成物の素点        中央値 0.851
 *
 * ——**較正元の人間の曲より、生成物のほうが高い点を取っていた**。しかも人間の曲は
 * 21項目のうち中央値10項目が帯（p25〜p75）の外にある。「良い曲を作るには評価機を
 * 意図的に外さねばならない」状態で、これは生成側ではなく基準の側の誤り。
 *
 * ここで見るのは1つだけ:
 *
 *   **人間の曲が、生成物と同じかそれ以上の点を取るか。**
 *
 * 取らないなら、採点式は「人間の曲らしさ」ではない別の何かを測っている。
 * 参考コーパスを差し替えたり `compose-metrics.ts` を触ったら、ここを通すこと。
 */

import { composeSong } from "../src/compose";
import { CORPUS_BANDS, CORPUS_DEVIATION_BUDGET } from "../src/compose-corpus";
import {
	densityFeatures,
	type MetricNote,
	plausibleBand,
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

/**
 * 採点で使う重み。`compose.ts` の WEIGHTS のうち**メロディ1本から測れる項目だけ**。
 * コーパスのMIDIにはサブメロ・和声の情報が無いので、両者を同じ土俵に載せるには
 * ここを揃えるしかない（complementarity・tension・novelty は両方から外す）。
 */
const WEIGHTS: Record<string, number> = {
	entropy: 0.6,
	valueKinds: 0.4,
	restRatio: 0.6,
	leapRatio: 0.6,
	maxLeap: 0.4,
	melodyRange: 0.6,
	notesPerBar: 0.8,
	shortNoteRatio: 0.6,
	barDensityCv: 0.6,
	densityCliff: 1.0,
	stepRatio: 0.8,
	chromaticRatio: 0.6,
	sim1: 0.8,
	sim2: 0.8,
	sim4: 1.4,
	sim8: 1.4,
	phraseBreath: 1.0,
	turnRatio: 0.8,
	climaxPosition: 1.0,
	climaxPeaks: 1.0,
};

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

type Features = Record<string, number>;

const featuresOf = (m: MetricNote[], bars: number): Features => {
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
		// メロディ1本では測れないので、両者そろって満点扱いにして土俵から外す。
		complementarity: 0,
	};
};

/** `compose.ts` の evaluate と同じ形で点を出す（逸脱の予算・最近傍を含む）。 */
const scoreOf = (
	f: Features,
): { score: number; forgiven: string[]; rejected: number } => {
	const parts: Record<string, number> = {};
	for (const key of Object.keys(WEIGHTS))
		parts[key] = plausibleBand(
			f[key],
			CORPUS_BANDS[key as keyof typeof CORPUS_BANDS],
		);
	// 予算を使い切ってなお素点0が残る項目数＝この曲が採点式に「拒まれている」度合い。
	const zeros = Object.keys(WEIGHTS).filter((k) => parts[k] === 0).length;
	const rejected = Math.max(0, zeros - CORPUS_DEVIATION_BUDGET);
	const forgiven = Object.entries(WEIGHTS)
		.map(([key, weight]) => ({ key, deficit: weight * (1 - parts[key]) }))
		.sort((a, b) => b.deficit - a.deficit)
		.slice(0, CORPUS_DEVIATION_BUDGET)
		.filter((e) => e.deficit > 0)
		.map((e) => e.key);
	let weighted = 0;
	let weightSum = 0;
	for (const [key, weight] of Object.entries(WEIGHTS)) {
		if (forgiven.includes(key)) continue;
		weighted += parts[key] * weight;
		weightSum += weight;
	}
	return {
		score: weightSum === 0 ? 0 : weighted / weightSum,
		forgiven,
		rejected,
	};
};

/** 先頭の音から `WINDOW` 小節ぶんに切り出す（両者で長さを揃えるため）。 */
const clip = (ns: MetricNote[]): MetricNote[] | null => {
	if (ns.length === 0) return null;
	const from = Math.floor(ns[0].startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
	const to = from + WINDOW * STEPS_PER_BAR;
	const out = ns
		.filter((n) => n.startStep >= from && n.startStep < to)
		.map((n) => ({ ...n, startStep: n.startStep - from }));
	return out.length < 16 ? null : out;
};

const barsOf = (ns: MetricNote[]): number =>
	Math.max(
		4,
		Math.ceil(
			Math.max(...ns.map((n) => n.startStep + n.durationSteps)) / STEPS_PER_BAR,
		),
	);

const percentile = (values: number[], q: number): number => {
	const s = [...values].sort((a, b) => a - b);
	const i = (s.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

const dir = argOf("--dir");
if (!dir) {
	console.error("--dir <MIDIのフォルダ> を指定してください。");
	process.exit(1);
}

// --- 人間の曲 ---
const human: number[] = [];
/** 予算を使い切ってなお素点0が残る＝採点式が積極的に拒んでいる人間の曲。 */
let humanRejected = 0;
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
		const r = scoreOf(featuresOf(clipped, barsOf(clipped)));
		human.push(r.score);
		if (r.rejected > 0) humanRejected++;
	} catch {
		// 読めないMIDIは飛ばす（較正と同じ扱い）
	}
}

// --- 生成物 ---
const songs = Number.parseInt(argOf("--songs") ?? "60", 10);
const generated: number[] = [];
const recent: number[][] = [];
for (let i = 0; i < songs; i++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		baseKey: argOf("--key") ?? "any",
		drawCount: Number.parseInt(argOf("--draw") ?? "12", 10),
		recent: recent.slice(-3),
	});
	recent.push(song.stats.fingerprint);
	const notes: MetricNote[] = song.melody
		.map((n) => ({
			startStep: n.startStep,
			pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
			durationSteps: n.durationSteps,
		}))
		.sort((a, b) => a.startStep - b.startStep);
	const clipped = clip(notes);
	if (!clipped) continue;
	generated.push(scoreOf(featuresOf(clipped, barsOf(clipped))).score);
}

const row = (label: string, v: number[]): string =>
	`  ${label.padEnd(12)} 最低 ${percentile(v, 0).toFixed(3)} / p25 ${percentile(v, 0.25).toFixed(3)} / 中央 ${percentile(v, 0.5).toFixed(3)} / p75 ${percentile(v, 0.75).toFixed(3)} / 最高 ${percentile(v, 1).toFixed(3)}`;

console.log(
	`● 同じ採点式で ${human.length}本の人間の曲と ${generated.length}曲の生成物を並べる（頭${WINDOW}小節・逸脱の予算${CORPUS_DEVIATION_BUDGET}）`,
);
console.log(row("人間の曲", human));
console.log(
	`  ${"".padEnd(12)} うち予算(${CORPUS_DEVIATION_BUDGET})を超えて素点0が残る曲: ${humanRejected}本 (${((humanRejected / human.length) * 100).toFixed(0)}%)`,
);
console.log(row("生成物", generated));

const humanMedian = percentile(human, 0.5);
const genMedian = percentile(generated, 0.5);
console.log(
	`
  中央値の差（人間 − 生成）: ${(humanMedian - genMedian >= 0 ? "+" : "") + (humanMedian - genMedian).toFixed(3)}`,
);

// **合否は「採点式が人間の曲を拒まないか」で見る。**
//
// 中央値の比較は、周辺分布を合否フィルタへ格下げした（`plausibleBand`）時点で
// 両者とも 1.000 に張り付き、意味を失った。いま測る価値があるのは
// 「較正元の曲を、その較正で作った基準が落とさないか」だけ。
// ——1本でも落とすなら、基準は人間の曲より狭いものを要求している。
if (humanRejected > 0) {
	console.error(
		`
✗ 人間の曲 ${humanRejected}本 が、逸脱の予算(${CORPUS_DEVIATION_BUDGET})を超えて素点0を残しています。` +
			`
  較正元の曲を落とす基準は、人間の曲より狭いものを要求しています。帯か予算を見直してください。`,
	);
	process.exit(1);
}
if (humanMedian < genMedian) {
	console.error(
		`
✗ 人間の曲の中央値 ${humanMedian.toFixed(3)} が生成物 ${genMedian.toFixed(3)} を下回っています。`,
	);
	process.exit(1);
}
console.log(
	`
✓ 採点式は人間の曲を1本も拒んでいません（中央値 ${humanMedian.toFixed(3)} ≧ 生成物 ${genMedian.toFixed(3)}）`,
);
