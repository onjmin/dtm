/**
 * 自動作曲のヘッドレス実験台。
 *   - 種（seed）を指定して composeSong を回す
 *   - DAW と同じ経路で MML を組み立てる（そのままエディタへインポートできる）
 *   - 人／エージェントが読める「譜面シート」を出す
 *
 *   npx tsx scripts/compose-lab.ts <count> <startSeed> [outDir] [optionsJson]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildChordPlacements } from "../src/chords";
import { composeSong } from "../src/compose";
import { MMLCore } from "../src/mml-core";
import type { CoreEventHandlers, Note, RenderConfig } from "../src/types";

const STEPS_PER_BAR = 192;
const UNITS_PER_SEMITONE = 31;

const renderConfig: RenderConfig = {
	stepsPerBar: STEPS_PER_BAR,
	keyCount: 88,
	pitchRangeStart: 0,
	unitsPerRow: 31,
	keyHeight: 12,
	stepWidth: 2,
	edo: 12,
};

const handlers: CoreEventHandlers = {
	onMMLGenerated: () => {},
	onNotesChanged: () => {},
};

const newCore = (volume: number) =>
	new MMLCore(handlers, volume, () => renderConfig);

/** 線形合同法。daw.ts の seededRandom と同じ式。 */
const seededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

type Opts = {
	template?: string;
	baseKey?: string;
	scale?: string;
	form?: string;
	drawCount?: number;
};

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

const midiOf = (pitchUnits: number): number => {
	const octave = Math.floor(pitchUnits / 372);
	const within = ((pitchUnits % 372) + 372) % 372;
	return octave * 12 + Math.round(within / UNITS_PER_SEMITONE);
};

const nameOf = (midi: number): string =>
	`${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export const composeOne = (seed: number, opts: Opts = {}) => {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		random: seededRandom(seed),
		...opts,
	});

	// --- DAW と同じ4トラック（シンプルモード）を組む ---
	const tracks: { name: string; volume: number; notes: Note[] }[] = [];
	const push = (name: string, volume: number, notes: typeof song.melody) => {
		const core = newCore(volume);
		core.clearNotesWithoutHistory();
		core.beginBatch();
		for (const n of notes)
			core.addNote(n.startStep, n.pitchUnits, {
				noteLengthSteps: Math.max(1, n.durationSteps),
				velocity: n.velocity,
			});
		core.endBatch();
		tracks.push({ name, volume, notes: core.getNotes() });
	};
	push("melody", 100, song.melody);
	push("submelody", 95, song.submelody);
	push("bass", 88, song.bass);

	const placements = buildChordPlacements({
		edo: 12,
		chordStr: song.chordProgression,
		patternType: song.chordPattern,
		rootShift: song.rootShift,
		bpm: song.bpm,
		stepsPerBar: STEPS_PER_BAR,
	});
	push(
		"chord",
		80,
		placements.map((p) => ({
			startStep: p.startStep,
			pitchUnits: p.pitchUnits,
			durationSteps: Math.max(1, p.durationSteps),
			velocity: p.velocity,
		})),
	);

	const core = newCore(100);
	// メタ行。mml-parser を import すると lyrics → @onjmin/koe まで引きずるので、
	// 必要な宣言だけここで組む（formatMmlMeta の出力と同じ並び）。
	const metaLine = [
		`#inst=${song.instrument}`,
		`#drum=${song.drum}`,
		"#volume=80",
		`#seed=${seed}`,
		`#compose=${[opts.template ?? "custom", opts.baseKey ?? "any", opts.scale ?? "auto", ""].join(":")}`,
	].join("");
	const lines = tracks
		.map((t, i) =>
			t.notes.length
				? `@${i}${core.getMMLFromNotes(t.notes, song.bpm, t.volume).trim().replace(/\s+/g, "")}`
				: "",
		)
		.filter((s) => s.length > 0);
	const mml = [metaLine, ...lines, "#end;"].join(";");

	return { song, mml, tracks };
};

// ============================================================
// 譜面シート（エージェントが読む用）
// ============================================================

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

/** 16分音符いくつ分か。 */
const inSixteenths = (steps: number): number =>
	Math.round((steps / STEPS_PER_BAR) * 16);

export const scoreSheet = (
	seed: number,
	r: ReturnType<typeof composeOne>,
): string => {
	const { song } = r;
	// 主音は keyName から取る。rootShift はハ長調からの移調量なので、短調では
	// 平行長調の主音になってしまい、音度が3度ずれる。
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
	const tonicPc = PC[song.keyName.replace(/m$/, "")] ?? 0;
	const out: string[] = [];
	out.push(`### seed=${seed}`);
	out.push(
		`調: ${song.keyLabel} / 音階: ${song.scaleLabel} / 形: ${song.form} / BPM: ${song.bpm} / ${song.bars}小節 / ドラム: ${song.drum} / 音色: ${song.instrument}`,
	);
	out.push(
		`構成: ${song.sections
			.map((s) => `${s.kind}(${s.startBar + 1}-${s.startBar + s.bars})`)
			.join(" → ")}`,
	);
	out.push(
		`コード進行: ${song.chordProgression}（ハ長調表記 / 移調量 ${song.rootShift}半音）`,
	);
	out.push(`伴奏の奏法: ${song.chordPattern}`);
	out.push("");

	const sectionOf = (bar: number): string => {
		for (const s of song.sections)
			if (bar >= s.startBar && bar < s.startBar + s.bars) return s.kind;
		return "-";
	};

	const layer = (notes: typeof song.melody, bar: number): string => {
		const from = bar * STEPS_PER_BAR;
		const to = from + STEPS_PER_BAR;
		const ns = notes
			.filter((n) => n.startStep >= from && n.startStep < to)
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
			const deg = DEG_NAMES[(((midi - tonicPc) % 12) + 12) % 12];
			const oct = Math.floor(midi / 12) - 1;
			parts.push(`${deg}^${oct}:${inSixteenths(n.durationSteps)}`);
			cursor = n.startStep + n.durationSteps;
		}
		return parts.join(" ");
	};

	// --- ヒット曲らしさの機械的な目安（聴けない分、構造だけでも数えておく） ---
	const melBars: number[][] = [];
	for (let bar = 0; bar < song.bars; bar++) {
		const from = bar * STEPS_PER_BAR;
		melBars.push(
			song.melody
				.filter(
					(n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR,
				)
				.sort((a, b) => a.startStep - b.startStep)
				.map((n) => midiOf(n.pitchUnits)),
		);
	}
	const rhythmKey = (bar: number): string => {
		const from = bar * STEPS_PER_BAR;
		return song.melody
			.filter((n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR)
			.sort((a, b) => a.startStep - b.startStep)
			.map((n) => `${n.startStep - from}/${n.durationSteps}`)
			.join(",");
	};
	const pairKeys = new Map<string, number>();
	for (let bar = 0; bar + 1 < song.bars; bar += 2) {
		const k = `${rhythmKey(bar)}|${rhythmKey(bar + 1)}`;
		if (k === "|") continue;
		pairKeys.set(k, (pairKeys.get(k) ?? 0) + 1);
	}
	const topRepeat = Math.max(0, ...pairKeys.values());
	const chorusBars: number[] = [];
	for (const sec of song.sections)
		if (sec.kind === "chorus" || sec.kind === "lastChorus")
			for (let b = sec.startBar; b < sec.startBar + sec.bars; b++)
				chorusBars.push(b);
	const allNotes = melBars.flat();
	const peak = allNotes.length ? Math.max(...allNotes) : 0;
	const chorusNotes = chorusBars.flatMap((b) => melBars[b] ?? []);
	const chorusPeak = chorusNotes.length ? Math.max(...chorusNotes) : 0;
	const emptyBars = melBars.filter((b) => b.length === 0).length;
	let longestSameNote = 0;
	let run = 0;
	for (let i = 1; i < allNotes.length; i++) {
		run = allNotes[i] === allNotes[i - 1] ? run + 1 : 0;
		if (run + 1 > longestSameNote) longestSameNote = run + 1;
	}
	out.push(
		`ヒット目安: サビ最高音=${chorusPeak ? nameOf(chorusPeak) : "-"} / 曲の最高音=${peak ? nameOf(peak) : "-"} / サビが最高音を持つ=${chorusPeak >= peak ? "はい" : "いいえ"} / 同じ2小節型の最多反復=${topRepeat}回 / メロ無しの小節=${emptyBars}/${song.bars} / 同音連打の最長=${longestSameNote}`,
	);
	out.push("");
	out.push(
		"小節ごと（音度^オクターブ:長さ、長さは16分音符いくつ分か。休n=休符）",
	);
	for (let bar = 0; bar < song.bars; bar++) {
		out.push(
			`bar${String(bar + 1).padStart(2, " ")} [${sectionOf(bar)}] メロ: ${layer(song.melody, bar)}`,
		);
		const sub = layer(song.submelody, bar);
		if (sub !== "－") out.push(`        サブ: ${sub}`);
	}
	out.push("");
	const s = song.stats;
	out.push(
		`機械採点: score=${s.score.toFixed(3)} / 音価の種類=${s.valueKinds} / エントロピー=${s.entropy.toFixed(2)} / 休符率=${s.restRatio.toFixed(2)} / 跳躍率=${s.leapRatio.toFixed(2)} / 最大跳躍=${s.maxLeapSemitones} / 音域=${s.melodyRange} / 候補${s.attempts}本中${s.rejected}本を破棄`,
	);
	return out.join("\n");
};

// ============================================================
// CLI
// ============================================================

if (process.argv[1]?.includes("compose-lab")) {
	const count = Number(process.argv[2] ?? 8);
	const startSeed = Number(process.argv[3] ?? 1);
	const outDir = process.argv[4] ?? join(__dirname, "..", "tmp", "compose");
	const opts: Opts = process.argv[5] ? JSON.parse(process.argv[5]) : {};
	mkdirSync(outDir, { recursive: true });
	const sheets: string[] = [];
	for (let i = 0; i < count; i++) {
		const seed = startSeed + i;
		const r = composeOne(seed, opts);
		writeFileSync(join(outDir, `song-${seed}.mml`), r.mml, "utf8");
		const sheet = scoreSheet(seed, r);
		writeFileSync(join(outDir, `sheet-${seed}.md`), sheet, "utf8");
		sheets.push(sheet);
	}
	writeFileSync(join(outDir, "sheets.md"), sheets.join("\n\n---\n\n"), "utf8");
	console.log(`wrote ${count} songs to ${outDir}`);
}
