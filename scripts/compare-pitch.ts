/**
 * **音高側**を参考コーパスと突き合わせる調査スクリプト。
 *
 *   npx tsx scripts/compare-pitch.ts --dir "C:/path/to/midis" [--songs 80]
 *
 * `compare-vocabulary.ts` がリズムの語彙を測るのに対し、こちらは音の並びを測る。
 * リズム側で「語彙の被覆率」「集中度」「反復」が問題になったので、音高側にも
 * 同じ検査を当てる。
 *
 * 1. 音程の分布   … 隣接2音の音程（半音）の出方
 * 2. 輪郭の集中度 … 3音の輪郭（音程2つ）の上位パターンが占める割合
 * 3. 使う材料     … 音域・使用音数・オクターブ跳躍
 */

import { composeSong } from "../src/compose";
import type { MetricNote } from "../src/compose-metrics";
import { UNITS_PER_SEMITONE } from "../src/tuning";
import {
	channelNotes,
	collectFromDir,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

type Song = { intervals: number[]; pitches: number[] };

const songOf = (m: MetricNote[]): Song => {
	const sorted = [...m].sort((a, b) => a.startStep - b.startStep);
	const pitches = sorted.map((n) => Math.round(n.pitchSemi));
	const intervals: number[] = [];
	for (let i = 1; i < pitches.length; i++)
		intervals.push(pitches[i] - pitches[i - 1]);
	return { intervals, pitches };
};

const dir = argOf("--dir");
if (!dir) {
	console.error("--dir <MIDIのフォルダ> を指定してください。");
	process.exit(1);
}
const songCount = Number.parseInt(argOf("--songs") ?? "80", 10);

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
		const m = toMonophonic(quantize(melody));
		if (m.length >= 32) corpus.push(songOf(m));
	} catch {
		// 読めないMIDIは飛ばす
	}
}

const generated: Song[] = [];
const recent: number[][] = [];
for (let i = 0; i < songCount; i++) {
	const song = composeSong({
		stepsPerBar: 192,
		recent: recent.slice(-3),
		template: argOf("--template"),
	});
	recent.push(song.stats.fingerprint);
	if (song.melody.length === 0) continue;
	generated.push(
		songOf(
			song.melody.map((n) => ({
				startStep: n.startStep,
				pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
				durationSteps: n.durationSteps,
			})),
		),
	);
}

console.log(`● 参考曲 ${corpus.length}本 / 生成 ${generated.length}曲\n`);

// --- 1. 音程の分布 ---
const intervalShare = (songs: Song[]): Map<number, number> => {
	const h = new Map<number, number>();
	let total = 0;
	for (const s of songs)
		for (const v of s.intervals) {
			const k = Math.max(-13, Math.min(13, v));
			h.set(k, (h.get(k) ?? 0) + 1);
			total++;
		}
	for (const [k, v] of h) h.set(k, v / total);
	return h;
};
const ci = intervalShare(corpus);
const gi = intervalShare(generated);
console.log("① 隣接音程の分布（半音、|13|は13以上をまとめたもの）");
console.log("  音程    参考    生成");
for (let v = -13; v <= 13; v++) {
	const c = (ci.get(v) ?? 0) * 100;
	const g = (gi.get(v) ?? 0) * 100;
	if (c < 0.4 && g < 0.4) continue;
	console.log(
		`  ${String(v).padStart(4)}${c.toFixed(1).padStart(8)}%${g.toFixed(1).padStart(8)}%`,
	);
}
const wide = (h: Map<number, number>): number => {
	let sum = 0;
	for (const [k, v] of h) if (Math.abs(k) >= 9) sum += v;
	return sum;
};
console.log(
	`  9半音以上の跳躍  参考 ${(wide(ci) * 100).toFixed(1)}% / 生成 ${(wide(gi) * 100).toFixed(1)}%`,
);

// --- 2. 輪郭の集中度 ---
const gramShare = (songs: Song[], n: number): Map<string, number> => {
	const h = new Map<string, number>();
	for (const s of songs)
		for (let i = 0; i + n <= s.intervals.length; i++) {
			const key = s.intervals.slice(i, i + n).join(",");
			h.set(key, (h.get(key) ?? 0) + 1);
		}
	return h;
};
const share = (m: Map<string, number>, n: number): string => {
	const s = [...m.values()].sort((a, b) => b - a);
	const total = s.reduce((a, b) => a + b, 0);
	return `${((s.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)}%`;
};
console.log("\n② 輪郭の集中度（音程 n 個の並びが、上位いくつに集まるか）");
for (const n of [2, 3]) {
	const c = gramShare(corpus, n);
	const g = gramShare(generated, n);
	console.log(
		`  音程${n}つ  上位10種 参考 ${share(c, 10)} / 生成 ${share(g, 10)}   異なり 参考 ${c.size} / 生成 ${g.size}`,
	);
}

// --- 3. 使う材料 ---
const percentile = (values: number[], q: number): number => {
	const s = [...values].sort((a, b) => a - b);
	const i = (s.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
console.log("\n③ 使う材料（1曲あたり）");
console.log(
	"  指標              参考 p25    p50    p75  |  生成 p25    p50    p75",
);
for (const [label, f] of [
	[
		"音域（半音）",
		(s: Song) => Math.max(...s.pitches) - Math.min(...s.pitches),
	],
	["使う音の種類", (s: Song) => new Set(s.pitches).size],
	[
		"音名の種類",
		(s: Song) => new Set(s.pitches.map((p) => ((p % 12) + 12) % 12)).size,
	],
] as const) {
	const c = corpus.map(f);
	const g = generated.map(f);
	const fmt = (v: number): string => v.toFixed(1).padStart(7);
	console.log(
		`  ${label.padEnd(14)}${fmt(percentile(c, 0.25))}${fmt(percentile(c, 0.5))}${fmt(percentile(c, 0.75))}  |${fmt(percentile(g, 0.25))}${fmt(percentile(g, 0.5))}${fmt(percentile(g, 0.75))}`,
	);
}
