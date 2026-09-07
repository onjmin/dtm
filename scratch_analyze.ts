import { composeSong } from "./src/compose";
import { densityFeatures, MetricNote } from "./src/compose-metrics";
import { UNITS_PER_SEMITONE } from "./src/tuning";
import { chromaticRatioOf } from "./scripts/calibrate-corpus";

const STEPS_PER_BAR = 192;

const featuresOf = (m: MetricNote[], bars: number) => {
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
	let offBeat = 0;
	let offEighth = 0;
	for (const n of m) {
		const at = ((n.startStep % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
		if (at % 48 !== 0) offBeat++;
		if (at % 24 !== 0) offEighth++;
	}
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

const clip = (ns: MetricNote[], window: number): MetricNote[] | null => {
	if (ns.length === 0) return null;
	const from = Math.floor(ns[0].startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
	const to = from + window * STEPS_PER_BAR;
	const out = ns
		.filter((n) => n.startStep >= from && (window <= 0 || n.startStep < to))
		.map((n) => ({ ...n, startStep: n.startStep - from }));
	return out.length < 16 ? null : out;
};

let recent: number[][] = [];
for (let i = 0; i < 3; i++) {
	const song = composeSong({ stepsPerBar: STEPS_PER_BAR, recent: recent.slice(-3) });
	recent.push(song.stats.fingerprint);
	const notes = song.melody
		.map((n) => ({
			startStep: n.startStep,
			pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
			durationSteps: n.durationSteps,
		}))
		.sort((a, b) => a.startStep - b.startStep);
	const clipped = clip(notes, 0);
	if (!clipped) continue;
	const end = Math.max(...clipped.map((n) => n.startStep + n.durationSteps));
	const row = featuresOf(clipped, Math.max(4, Math.ceil(end / STEPS_PER_BAR)));
	console.log(`\nGenerated Song ${i + 1} Features:`);
	console.log(JSON.stringify(row, null, 2));
}
