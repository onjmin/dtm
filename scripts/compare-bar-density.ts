/**
 * **1小節ごとの音数の分布**を、参考コーパスと生成物で突き合わせる調査スクリプト。
 *
 *   npx tsx scripts/compare-bar-density.ts --dir "C:/path/to/midis" --songs 80
 *
 * `compare-corpus.ts` は曲全体の平均（notesPerBar など）を並べるが、平均が同じでも
 * **どの小節に音が集まっているか**は分からない。「セクションの終わりだけ1音になる」
 * ような偏りは平均に埋もれるので、ここでは小節ごとの音数そのものを分布として見る。
 *
 * 見る項目：
 *   - 音数の p10/p50/p90（歌っている小節だけを母数にする）
 *   - 変動係数 CV（小節間のばらつき）
 *   - 「1音以下の小節」の割合（＝急に音が消える小節）
 *   - 「直前の小節の3割以下に落ちる」段差の割合
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

const STEPS_PER_BAR = 192;
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** 小節ごとの音数（メロディの入りから最後の音まで）。 */
const barCounts = (ns: MetricNote[]): number[] => {
	if (ns.length === 0) return [];
	const from = Math.floor(ns[0].startStep / STEPS_PER_BAR);
	const to = Math.floor(
		Math.max(...ns.map((n) => n.startStep + n.durationSteps - 1)) /
			STEPS_PER_BAR,
	);
	const out = new Array(to - from + 1).fill(0);
	for (const n of ns) out[Math.floor(n.startStep / STEPS_PER_BAR) - from]++;
	return out;
};

type Row = {
	p10: number;
	p50: number;
	p90: number;
	cv: number;
	thinRatio: number;
	cliffRatio: number;
};

const percentile = (values: number[], q: number): number => {
	const s = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (s.length === 0) return Number.NaN;
	const i = (s.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

const rowOf = (counts: number[]): Row | null => {
	// イントロ・間奏のような「そもそもメロディを書かない区間」は母数から外す。
	const sung = counts.filter((c) => c > 0);
	if (sung.length < 8) return null;
	const mean = sung.reduce((a, b) => a + b, 0) / sung.length;
	const varr = sung.reduce((a, b) => a + (b - mean) ** 2, 0) / sung.length;
	let cliffs = 0;
	let pairs = 0;
	for (let i = 1; i < counts.length; i++) {
		if (counts[i - 1] < 3) continue;
		pairs++;
		if (counts[i] <= counts[i - 1] * 0.3) cliffs++;
	}
	return {
		p10: percentile(sung, 0.1),
		p50: percentile(sung, 0.5),
		p90: percentile(sung, 0.9),
		cv: mean === 0 ? 0 : Math.sqrt(varr) / mean,
		thinRatio: counts.filter((c) => c > 0 && c <= 1).length / counts.length,
		cliffRatio: pairs === 0 ? 0 : cliffs / pairs,
	};
};

const dir = argOf("--dir");
const songs = Number.parseInt(argOf("--songs") ?? "80", 10);
const template = argOf("--template");

const corpus: Row[] = [];
if (dir) {
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
			const row = rowOf(barCounts(toMonophonic(quantize(melody))));
			if (row) corpus.push(row);
		} catch {
			// 読めないMIDIは飛ばす
		}
	}
}

const generated: Row[] = [];
const recent: number[][] = [];
/** 小節番号ごとの音数（--profile で表にする）。 */
const profile: number[][] = [];
let sectionLabels: string[] = [];
for (let i = 0; i < songs; i++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		recent: recent.slice(-3),
		template,
	});
	recent.push(song.stats.fingerprint);
	const notes: MetricNote[] = song.melody
		.map((n) => ({
			startStep: n.startStep,
			pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
			durationSteps: n.durationSteps,
		}))
		.sort((a, b) => a.startStep - b.startStep);
	const row = rowOf(barCounts(notes));
	if (row) generated.push(row);

	// 曲の頭からの絶対位置で数える（崖が何小節目に出るかを見たいので、
	// メロディの入りへ揃えない）。
	const counts = new Array(song.bars).fill(0);
	for (const n of song.melody) {
		const bar = Math.floor(n.startStep / STEPS_PER_BAR);
		if (bar >= 0 && bar < song.bars) counts[bar]++;
	}
	profile.push(counts);
	if (sectionLabels.length === 0) {
		sectionLabels = new Array(song.bars).fill("");
		for (const sec of song.sections)
			for (
				let b = sec.startBar;
				b < sec.startBar + sec.bars && b < song.bars;
				b++
			)
				sectionLabels[b] = sec.kind + (sec.restatement ? "'" : "");
	}
}

if (argv.includes("--profile") && profile.length > 0) {
	// 構成テンプレートを指定していれば全曲の小節数が揃う。揃っていない小節は
	// そこまで届いた曲だけで平均する。
	const bars = Math.max(...profile.map((c) => c.length));
	console.log(
		`● 小節ごとの音数（${profile.length}曲・template=${template ?? "既定"}）`,
	);
	console.log("  小節  セクション    平均   最小   最大  1音以下");
	for (let b = 0; b < bars; b++) {
		const vals = profile.filter((c) => b < c.length).map((c) => c[b]);
		if (vals.length === 0) continue;
		const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
		const thin = vals.filter((v) => v <= 1).length / vals.length;
		console.log(
			`  ${String(b + 1).padStart(4)}  ${(sectionLabels[b] ?? "").padEnd(12)}${mean.toFixed(2).padStart(5)}${String(Math.min(...vals)).padStart(7)}${String(Math.max(...vals)).padStart(7)}${`${(thin * 100).toFixed(0)}%`.padStart(8)}`,
		);
	}
	console.log("");
}

console.log(
	`● 参考曲 ${corpus.length}本 / 生成 ${generated.length}曲（template=${template ?? "既定"}）`,
);
console.log(
	"  指標          参考 p25    p50    p75  |  生成 p25    p50    p75",
);
for (const key of [
	"p10",
	"p50",
	"p90",
	"cv",
	"thinRatio",
	"cliffRatio",
] as const) {
	const c = corpus.map((r) => r[key]);
	const g = generated.map((r) => r[key]);
	const f = (v: number): string =>
		(Number.isFinite(v) ? v.toFixed(2) : "  -").padStart(7);
	console.log(
		`  ${key.padEnd(11)}${f(percentile(c, 0.25))}${f(percentile(c, 0.5))}${f(percentile(c, 0.75))}  |${f(percentile(g, 0.25))}${f(percentile(g, 0.5))}${f(percentile(g, 0.75))}`,
	);
}
