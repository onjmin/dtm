/**
 * 覆面審査用の譜面シート。自動作曲の曲も手書きの曲も、**同じ書式・同じ見出し**で出す。
 * どちらの出自かが分かる情報（seed・機械採点・自動生成のラベル）は一切載せない。
 *
 *   npx tsx scripts/blind-sheet.ts auto <seed> <label> <outFile>
 *   npx tsx scripts/blind-sheet.ts hand <score.json> <label> <outFile>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { transposeChordName } from "../src/compose";
import { composeOne } from "./compose-lab";
import type { HandScore } from "./hand-compile";

const STEPS_PER_BAR = 192;
const UNITS_PER_SEMITONE = 31;
const NOTE_NAMES = [
	"C",
	"C#",
	"D",
	"D#",
	"E",
	"F",
	"F#",
	"G",
	"G#",
	"A",
	"A#",
	"B",
];
const DEG_NAMES = [
	"1",
	"b2",
	"2",
	"b3",
	"3",
	"4",
	"b5",
	"5",
	"b6",
	"6",
	"b7",
	"7",
];
const PC: Record<string, number> = {
	C: 0,
	"C#": 1,
	Db: 1,
	D: 2,
	"D#": 3,
	Eb: 3,
	E: 4,
	F: 5,
	"F#": 6,
	Gb: 6,
	G: 7,
	"G#": 8,
	Ab: 8,
	A: 9,
	"A#": 10,
	Bb: 10,
	B: 11,
};

type N = { startStep: number; pitchUnits: number; durationSteps: number };

const midiOf = (u: number): number =>
	Math.floor(u / 372) * 12 +
	Math.round((((u % 372) + 372) % 372) / UNITS_PER_SEMITONE);
const nameOf = (m: number): string =>
	`${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
const inSixteenths = (steps: number): number =>
	Math.round((steps / STEPS_PER_BAR) * 16);

type Song = {
	label: string;
	keyLabel: string;
	bpm: number;
	bars: number;
	chords: string;
	chordNote: string;
	pattern: string;
	drum: string;
	instrument: string;
	sections: { kind: string; startBar: number; bars: number }[];
	tonicPc: number;
	melody: N[];
	submelody: N[];
};

export const render = (s: Song): string => {
	const out: string[] = [];
	out.push(`### 候補 ${s.label}`);
	out.push(
		`調: ${s.keyLabel} / BPM: ${s.bpm} / ${s.bars}小節 / ドラム: ${s.drum} / 音色: ${s.instrument}`,
	);
	out.push(
		`構成: ${s.sections.map((x) => `${x.kind}(${x.startBar + 1}-${x.startBar + x.bars})`).join(" → ")}`,
	);
	out.push(`コード進行: ${s.chords}${s.chordNote}`);
	out.push(`伴奏の奏法: ${s.pattern}`);
	out.push("");

	const sectionOf = (bar: number): string => {
		for (const x of s.sections)
			if (bar >= x.startBar && bar < x.startBar + x.bars) return x.kind;
		return "-";
	};
	const layer = (notes: N[], bar: number): string => {
		const from = bar * STEPS_PER_BAR;
		const ns = notes
			.filter((n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR)
			.sort((a, b) => a.startStep - b.startStep);
		if (!ns.length) return "－";
		const parts: string[] = [];
		let cursor = from;
		for (const n of ns) {
			if (n.startStep > cursor) {
				const rest = inSixteenths(n.startStep - cursor);
				if (rest > 0) parts.push(`休${rest}`);
			}
			const midi = midiOf(n.pitchUnits);
			parts.push(
				`${DEG_NAMES[(((midi - s.tonicPc) % 12) + 12) % 12]}^${Math.floor(midi / 12) - 1}:${inSixteenths(n.durationSteps)}`,
			);
			cursor = n.startStep + n.durationSteps;
		}
		return parts.join(" ");
	};

	// --- 構造の目安（両トラック同じ式で出す） ---
	const melBars: number[][] = [];
	for (let bar = 0; bar < s.bars; bar++) {
		const from = bar * STEPS_PER_BAR;
		melBars.push(
			s.melody
				.filter(
					(n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR,
				)
				.sort((a, b) => a.startStep - b.startStep)
				.map((n) => midiOf(n.pitchUnits)),
		);
	}
	const rhythmKey = (bar: number): string => {
		const from = bar * STEPS_PER_BAR;
		return s.melody
			.filter((n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR)
			.sort((a, b) => a.startStep - b.startStep)
			.map((n) => `${n.startStep - from}/${n.durationSteps}`)
			.join(",");
	};
	const pairs = new Map<string, number>();
	for (let bar = 0; bar + 1 < s.bars; bar += 2) {
		const k = `${rhythmKey(bar)}|${rhythmKey(bar + 1)}`;
		if (k === "|") continue;
		pairs.set(k, (pairs.get(k) ?? 0) + 1);
	}
	const chorusBars: number[] = [];
	for (const sec of s.sections)
		if (sec.kind === "chorus" || sec.kind === "lastChorus")
			for (let b = sec.startBar; b < sec.startBar + sec.bars; b++)
				chorusBars.push(b);
	const all = melBars.flat();
	const peak = all.length ? Math.max(...all) : 0;
	const cn = chorusBars.flatMap((b) => melBars[b] ?? []);
	const cPeak = cn.length ? Math.max(...cn) : 0;
	let longest = 0;
	let run = 0;
	for (let i = 1; i < all.length; i++) {
		run = all[i] === all[i - 1] ? run + 1 : 0;
		if (run + 1 > longest) longest = run + 1;
	}
	out.push(
		`構造の目安: サビ最高音=${cPeak ? nameOf(cPeak) : "-"} / 曲の最高音=${peak ? nameOf(peak) : "-"} / サビが最高音を持つ=${cPeak >= peak ? "はい" : "いいえ"} / 同じ2小節型の最多反復=${Math.max(0, ...pairs.values())}回 / メロ無しの小節=${melBars.filter((b) => !b.length).length}/${s.bars} / 同音連打の最長=${longest}`,
	);
	out.push("");
	out.push(
		"小節ごと（音度^オクターブ:長さ、長さは16分音符いくつ分か。休n=休符）",
	);
	for (let bar = 0; bar < s.bars; bar++) {
		out.push(
			`bar${String(bar + 1).padStart(2, " ")} [${sectionOf(bar)}] メロ: ${layer(s.melody, bar)}`,
		);
		const sub = layer(s.submelody, bar);
		if (sub !== "－") out.push(`        サブ: ${sub}`);
	}
	return out.join("\n");
};

export const fromAuto = (seed: number, label: string): Song => {
	const { song } = composeOne(seed);
	// 出自が割れないよう、手書き側と同じ「実音のコード名・主音だけの調名」に揃える。
	const chords = song.chordProgression
		.split("|")
		.map((bar) =>
			bar
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map((c) => transposeChordName(c, song.rootShift))
				.join(" "),
		)
		.join("|");
	return {
		label,
		keyLabel: song.keyName,
		bpm: song.bpm,
		bars: song.bars,
		chords,
		chordNote: "（実音表記）",
		pattern: song.chordPattern,
		drum: song.drum,
		instrument: song.instrument,
		sections: song.sections.map((x) => ({
			kind: x.kind,
			startBar: x.startBar,
			bars: x.bars,
		})),
		tonicPc: PC[song.keyName.replace(/m$/, "")] ?? 0,
		melody: song.melody,
		submelody: song.submelody,
	};
};

const parseBarTokens = (text: string, bar: number, tonicPc: number): N[] => {
	const DEG: Record<string, number> = {
		"1": 0,
		b2: 1,
		"2": 2,
		"#2": 3,
		b3: 3,
		"3": 4,
		"4": 5,
		"#4": 6,
		b5: 6,
		"5": 7,
		"#5": 8,
		b6: 8,
		"6": 9,
		"#6": 10,
		b7: 10,
		"7": 11,
	};
	const notes: N[] = [];
	let cursor = bar * STEPS_PER_BAR;
	for (const tok of (text ?? "").trim().split(/\s+/).filter(Boolean)) {
		const rest = /^(?:休|r)(\d+)$/.exec(tok);
		if (rest) {
			cursor += Number(rest[1]) * 12;
			continue;
		}
		const m = /^([#b]?\d)\^(-?\d+):(\d+)$/.exec(tok);
		if (!m) continue;
		const pc = (((tonicPc + DEG[m[1]]) % 12) + 12) % 12;
		const midi = (Number(m[2]) + 1) * 12 + pc;
		notes.push({
			startStep: cursor,
			pitchUnits: midi * UNITS_PER_SEMITONE,
			durationSteps: Number(m[3]) * 12,
		});
		cursor += Number(m[3]) * 12;
	}
	return notes;
};

export const fromHand = (path: string, label: string): Song => {
	const sc: HandScore = JSON.parse(readFileSync(path, "utf8"));
	const tonicPc = PC[sc.key.replace(/m$/, "")] ?? 0;
	const bars = sc.melody.length;
	let startBar = 0;
	const sections = (sc.sections ?? [{ kind: "-", bars }]).map((x) => {
		const s = { kind: x.kind, startBar, bars: x.bars };
		startBar += x.bars;
		return s;
	});
	const lines = (arr: string[] | undefined): N[] =>
		(arr ?? []).flatMap((t, i) => parseBarTokens(t, i, tonicPc));
	return {
		label,
		keyLabel: sc.key,
		bpm: sc.bpm,
		bars,
		chords: sc.chords,
		chordNote: "（実音表記）",
		pattern: sc.chordPattern ?? "arpeggio",
		drum: sc.drum ?? "8beat",
		instrument: sc.instrument ?? "piano",
		sections,
		tonicPc,
		melody: lines(sc.melody),
		submelody: lines(sc.submelody),
	};
};

if (process.argv[1]?.includes("blind-sheet")) {
	const [kind, src, label, out] = process.argv.slice(2);
	const song =
		kind === "auto" ? fromAuto(Number(src), label) : fromHand(src, label);
	writeFileSync(out, render(song), "utf8");
	console.log(`wrote ${out}`);
}
