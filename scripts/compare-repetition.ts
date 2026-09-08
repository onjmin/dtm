/**
 * **反復**を参考コーパスと突き合わせる調査スクリプト。
 *
 *   npx tsx scripts/compare-repetition.ts --dir "C:/path/to/midis" [--songs 80] [--template jpop_standard]
 *
 * `compose-metrics.ts` の `sim1`〜`sim8` は Jaccard と輪郭の**ソフトな類似度**なので、
 * 「似ている」で満点が取れてしまい、「**同一である**」が足りないことを検出できない。
 * ここでは小節のリズム（発音位置の集合）と音高の輪郭が、lag 小節後に
 * **そっくりそのまま**もう一度出る割合を測る。
 *
 * 実測（初回）:
 *   lag 1/2/4/8 の完全一致  参考 29.8/41.2/47.2/50.7%  生成 10.7/15.2/31.0/23.3%
 * 人間の曲は小節のリズムを半分近くそのまま繰り返す。ここが生成物の最大の欠落。
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
const GRID = STEPS_PER_BAR / 16;
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

type Bars = { rhythm: string[]; contour: string[] };

/** 小節ごとのリズム（発音位置）と音高の輪郭（隣接音程の並び）。 */
const barsOf = (m: MetricNote[], bars?: number): Bars => {
	const sorted = [...m].sort((a, b) => a.startStep - b.startStep);
	const from = Math.floor(sorted[0].startStep / STEPS_PER_BAR);
	const to = bars
		? bars - 1
		: Math.floor(Math.max(...sorted.map((n) => n.startStep)) / STEPS_PER_BAR);
	const rhythm: string[] = [];
	const contour: string[] = [];
	for (let b = from; b <= to; b++) {
		const inBar = sorted.filter(
			(n) => Math.floor(n.startStep / STEPS_PER_BAR) === b,
		);
		if (inBar.length === 0) {
			rhythm.push("-");
			contour.push("-");
			continue;
		}
		rhythm.push(
			[
				...new Set(
					inBar.map((n) =>
						Math.round((n.startStep - b * STEPS_PER_BAR) / GRID),
					),
				),
			]
				.sort((x, y) => x - y)
				.join(","),
		);
		// 音程の並び。移調しても同じになるので「同じフレーズの再来」を拾える。
		const iv: number[] = [];
		for (let i = 1; i < inBar.length; i++)
			iv.push(Math.round(inBar[i].pitchSemi - inBar[i - 1].pitchSemi));
		contour.push(iv.length === 0 ? "-" : iv.join(","));
	}
	return { rhythm, contour };
};

/** lag 小節離れた小節が完全一致する割合。空の小節は母数から外す。 */
const identity = (songs: string[][], lag: number): number => {
	let same = 0;
	let n = 0;
	for (const s of songs)
		for (let i = lag; i < s.length; i++) {
			if (s[i] === "-" || s[i - lag] === "-") continue;
			n++;
			if (s[i] === s[i - lag]) same++;
		}
	return n === 0 ? 0 : same / n;
};

const dir = argOf("--dir");
if (!dir) {
	console.error("--dir <MIDIのフォルダ> を指定してください。");
	process.exit(1);
}
const songCount = Number.parseInt(argOf("--songs") ?? "80", 10);
const template = argOf("--template");

const corpus: Bars[] = [];
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
		if (m.length >= 32) corpus.push(barsOf(m));
	} catch {
		// 読めないMIDIは飛ばす
	}
}

const generated: Bars[] = [];
const recent: number[][] = [];
for (let i = 0; i < songCount; i++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		recent: recent.slice(-3),
		template,
	});
	recent.push(song.stats.fingerprint);
	if (song.melody.length === 0) continue;
	generated.push(
		barsOf(
			song.melody.map((n) => ({
				startStep: n.startStep,
				pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
				durationSteps: n.durationSteps,
			})),
			song.bars,
		),
	);
}

console.log(
	`● 参考曲 ${corpus.length}本 / 生成 ${generated.length}曲（template=${template ?? "既定"}）`,
);
for (const [label, key] of [
	["リズム（発音位置）が完全一致", "rhythm"],
	["音高の輪郭（音程の並び）が完全一致", "contour"],
] as const) {
	console.log(`\n${label}`);
	console.log("  lag    参考    生成");
	const c = corpus.map((s) => s[key]);
	const g = generated.map((s) => s[key]);
	for (const lag of [1, 2, 4, 8])
		console.log(
			`  ${String(lag).padStart(3)}  ${(identity(c, lag) * 100).toFixed(1).padStart(6)}%${(identity(g, lag) * 100).toFixed(1).padStart(8)}%`,
		);
}
