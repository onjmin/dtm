/**
 * 生成物と参考コーパスを**同じ物差しで並べる**調査スクリプト。
 *
 *   npx tsx scripts/compare-corpus.ts --dir "C:/path/to/midis" --songs 80
 *
 * `scripts/calibrate-corpus.ts` が目標帯（`src/compose-corpus.ts`）を作るのに対し、
 * こちらは**採点に入っていない観点まで含めて**両者の分布を突き合わせる。
 * 「基準は満たしているのに人間の曲と違って聞こえる」ときに、どこが違うのかを
 * 数字で出すために使う。実際、この比較で
 *
 *   - 生成物の非ダイアトニック音が **0%**（参考曲は中央値4%）＝調が固定に聞こえる
 *   - 1小節の音数 5.2 / 6.3、順次進行 0.36 / 0.50、休符率 0.18 / 0.07
 *     ＝**どの項目も目標帯の内側なのに、揃って同じ側へ寄っていた**
 *
 * が分かった。目標帯（周辺分布）を1つずつ見ているだけでは出てこない差なので、
 * 中央値を並べて見るこの形が要る。
 *
 * 窓（`--window`）は**両者で揃える**こと。反復率や休符率は曲の長さで変わるので、
 * 20小節なら20小節どうしで比べないと意味が無い。コーパス側は主旋律の入りから、
 * 生成側もメロディの入りから測る（イントロの無音を休符に数えない）。
 */

import { composeSong } from "../src/compose";
import type { MetricNote } from "../src/compose-metrics";
import { densityFeatures } from "../src/compose-metrics";
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
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

type Row = Record<string, number>;

/** 1本の主旋律から、比較に使う特徴をまとめて出す。 */
const featuresOf = (m: MetricNote[], bars: number): Row | null => {
	if (m.length < 16) return null;
	const durations = m.map((n) => n.durationSteps);
	const played = durations.reduce((a, b) => a + b, 0);
	const pitches = m.map((n) => n.pitchSemi);
	let same = 0;
	let steps = 0;
	let leaps = 0;
	let intervals = 0;
	let maxLeap = 0;
	let turns = 0;
	let prevDir = 0;
	for (let i = 1; i < m.length; i++) {
		const d = m[i].pitchSemi - m[i - 1].pitchSemi;
		const gap = Math.abs(d);
		intervals++;
		if (gap === 0) same++;
		else if (gap <= 2) steps++;
		else leaps++;
		maxLeap = Math.max(maxLeap, gap);
		const dir = Math.sign(d);
		if (dir !== 0) {
			if (prevDir !== 0 && dir !== prevDir) turns++;
			prevDir = dir;
		}
	}
	// 拍の裏（192ステップ = 1小節なら 48 が4分、24 が8分）。
	let offBeat = 0;
	let offEighth = 0;
	for (const n of m) {
		const at = ((n.startStep % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
		if (at % 48 !== 0) offBeat++;
		if (at % 24 !== 0) offEighth++;
	}
	// 音程列の4音ぶんの並びが、曲中でもう一度出てくる割合（フックの反復）。
	const intervalsList: number[] = [];
	for (let i = 1; i < m.length; i++)
		intervalsList.push(m[i].pitchSemi - m[i - 1].pitchSemi);
	const grams = new Map<string, number>();
	for (let i = 0; i + 4 <= intervalsList.length; i++) {
		const key = intervalsList.slice(i, i + 4).join(",");
		grams.set(key, (grams.get(key) ?? 0) + 1);
	}
	let repeated = 0;
	let gramTotal = 0;
	for (const count of grams.values()) {
		gramTotal += count;
		if (count > 1) repeated += count;
	}
	// 小節ごとの発音パターンの種類数。反復と変化のバランスを見る。
	const barPatterns = new Set<string>();
	for (let bar = 0; bar < bars; bar++) {
		const onsets = m
			.filter((n) => Math.floor(n.startStep / STEPS_PER_BAR) === bar)
			.map((n) => n.startStep % STEPS_PER_BAR)
			.join(",");
		if (onsets) barPatterns.add(onsets);
	}
	const density = densityFeatures(m, { stepsPerBar: STEPS_PER_BAR, bars });
	return {
		notesPerBar: density.notesPerBar,
		shortNoteRatio: density.shortNoteRatio,
		valueKinds: new Set(durations).size,
		restRatio: Math.max(0, 1 - played / (bars * STEPS_PER_BAR)),
		maxDuration: Math.max(...durations),
		sameRatio: intervals === 0 ? 0 : same / intervals,
		stepRatio: intervals === 0 ? 0 : steps / intervals,
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		maxLeap,
		turnRatio: intervals === 0 ? 0 : turns / intervals,
		melodyRange: Math.max(...pitches) - Math.min(...pitches),
		distinctPitches: new Set(pitches.map((p) => Math.round(p))).size,
		offBeatRatio: offBeat / m.length,
		offEighthRatio: offEighth / m.length,
		chromaticRatio: chromaticRatioOf(m),
		gramRepeatRatio: gramTotal === 0 ? 0 : repeated / gramTotal,
		barPatternKinds: barPatterns.size,
	};
};

/** 先頭の音から `window` 小節ぶんに切り出す（両者で長さを揃えるため）。 */
const clip = (ns: MetricNote[], window: number): MetricNote[] | null => {
	if (ns.length === 0) return null;
	const from = Math.floor(ns[0].startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
	const to = from + window * STEPS_PER_BAR;
	const out = ns
		.filter((n) => n.startStep >= from && (window <= 0 || n.startStep < to))
		.map((n) => ({ ...n, startStep: n.startStep - from }));
	return out.length < 16 ? null : out;
};

const percentile = (values: number[], q: number): number => {
	const s = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (s.length === 0) return Number.NaN;
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
const window = Number.parseInt(argOf("--window") ?? "20", 10);
const songs = Number.parseInt(argOf("--songs") ?? "80", 10);

// --- コーパス側 ---
const corpus: Row[] = [];
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
		const clipped = clip(toMonophonic(quantize(melody)), window);
		if (!clipped) continue;
		const end = Math.max(...clipped.map((n) => n.startStep + n.durationSteps));
		const row = featuresOf(
			clipped,
			Math.max(4, Math.ceil(end / STEPS_PER_BAR)),
		);
		if (row) corpus.push(row);
	} catch {
		// 読めないMIDIは飛ばす（較正と同じ扱い）
	}
}

// --- 生成側 ---
const generated: Row[] = [];
const recent: number[][] = [];
for (let i = 0; i < songs; i++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
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
	const clipped = clip(notes, window);
	if (!clipped) continue;
	const end = Math.max(...clipped.map((n) => n.startStep + n.durationSteps));
	const row = featuresOf(clipped, Math.max(4, Math.ceil(end / STEPS_PER_BAR)));
	if (row) generated.push(row);
}

console.log(
	`● 参考曲 ${corpus.length}本 / 生成 ${generated.length}曲（先頭${window}小節で比較）`,
);
console.log(
	"  指標                 参考 p25    p50    p75  |  生成 p25    p50    p75",
);
for (const key of Object.keys(corpus[0] ?? generated[0] ?? {})) {
	const c = corpus.map((r) => r[key]);
	const g = generated.map((r) => r[key]);
	const f = (v: number): string => v.toFixed(2).padStart(7);
	console.log(
		`  ${key.padEnd(18)}${f(percentile(c, 0.25))}${f(percentile(c, 0.5))}${f(percentile(c, 0.75))}  |${f(percentile(g, 0.25))}${f(percentile(g, 0.5))}${f(percentile(g, 0.75))}`,
	);
}
