/**
 * 手書き譜面 → MML のコンパイラ。
 *
 * 自動作曲を使わずに「人（やエージェント）が書いた譜面」を同じ土俵へ載せるための道具。
 * 入力の記法は compose-lab.ts が出す譜面シートと**同じ**なので、自動作曲の出力を読んで
 * 書き直す、という使い方ができる。
 *
 *   npx tsx scripts/hand-compile.ts <score.json> <out.mml>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { buildChordPlacements } from "../src/chords";
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

export type HandScore = {
	title?: string;
	/** 曲の狙い。人が読むためのメモ。 */
	note?: string;
	bpm: number;
	/** 主音。"C" / "Am" のように短調は m を付ける。 */
	key: string;
	instrument?: string;
	drum?: string;
	chordPattern?: string;
	/** 小節ごとのコード。`|` で小節区切り、小節内の空白で分割。実音（移調済み）で書く。 */
	chords: string;
	sections?: { kind: string; bars: number }[];
	/** 1要素＝1小節。`音度^オクターブ:16分いくつ分` と `休n` を空白区切り。空文字は全休符。 */
	melody: string[];
	submelody?: string[];
	bass?: string[];
	pad?: string[];
};

type Parsed = {
	startStep: number;
	pitchUnits: number;
	durationSteps: number;
	velocity: number;
};

export const parseBar = (
	text: string,
	barIndex: number,
	tonicPc: number,
	velocity: number,
): Parsed[] => {
	const notes: Parsed[] = [];
	let cursor = barIndex * STEPS_PER_BAR;
	const tokens = (text ?? "").trim().split(/\s+/).filter(Boolean);
	for (const tok of tokens) {
		if (tok === "－" || tok === "-") continue;
		const rest = /^(?:休|r)(\d+)$/.exec(tok);
		if (rest) {
			cursor += Number(rest[1]) * 12;
			continue;
		}
		const m = /^([#b]?\d)\^(-?\d+):(\d+)$/.exec(tok);
		if (!m) throw new Error(`bar${barIndex + 1}: 読めないトークン "${tok}"`);
		const deg = DEG[m[1]];
		if (deg === undefined)
			throw new Error(`bar${barIndex + 1}: 音度 "${m[1]}" が不明`);
		const oct = Number(m[2]);
		const len = Number(m[3]) * 12;
		const pc = (((tonicPc + deg) % 12) + 12) % 12;
		const midi = (oct + 1) * 12 + pc;
		notes.push({
			startStep: cursor,
			pitchUnits: midi * UNITS_PER_SEMITONE,
			durationSteps: len,
			velocity,
		});
		cursor += len;
	}
	return notes;
};

export const compileScore = (score: HandScore): string => {
	const tonicPc = PC[score.key.replace(/m$/, "")] ?? 0;
	const bars = score.melody.length;

	const toNotes = (lines: string[] | undefined, velocity: number): Parsed[] => {
		if (!lines) return [];
		const out: Parsed[] = [];
		for (let i = 0; i < lines.length; i++)
			out.push(...parseBar(lines[i], i, tonicPc, velocity));
		return out;
	};

	const tracks: { volume: number; notes: Note[] }[] = [];
	const push = (volume: number, notes: Parsed[]) => {
		const core = newCore(volume);
		core.clearNotesWithoutHistory();
		core.beginBatch();
		for (const n of notes)
			core.addNote(n.startStep, n.pitchUnits, {
				noteLengthSteps: Math.max(1, n.durationSteps),
				velocity: n.velocity,
			});
		core.endBatch();
		tracks.push({ volume, notes: core.getNotes() });
	};

	push(100, toNotes(score.melody, 100));
	push(95, toNotes(score.submelody, 90));
	push(88, toNotes(score.bass, 100));

	// 伴奏。コードは実音で書かせるので rootShift は 0。
	const placements = buildChordPlacements({
		edo: 12,
		chordStr: score.chords,
		patternType: (score.chordPattern ?? "arpeggio") as never,
		rootShift: 0,
		bpm: score.bpm,
		stepsPerBar: STEPS_PER_BAR,
	});
	if (!placements.length && score.chords.trim())
		throw new Error("コード進行を解釈できなかった（コード名の綴りを確認）");
	push(
		80,
		placements.map((p) => ({
			startStep: p.startStep,
			pitchUnits: p.pitchUnits,
			durationSteps: Math.max(1, p.durationSteps),
			velocity: p.velocity,
		})),
	);

	const core = newCore(100);
	// **ドラム無しは `#drum=` ごと省く。** `#drum=none` と書くと、再生側（`mml-player.ts` の
	// `meta.drum ?? "none"`）では同じ無音になるが、DAW の読み込みは
	// `if (meta.drum && drumPatterns[meta.drum])` なので `none` が辞書に無く分岐を素通りし、
	// **その編集画面に前から入っていたドラムが残る**。再編集した人が気づかないまま鳴る。
	const drum = score.drum && score.drum !== "none" ? `#drum=${score.drum}` : "";
	const meta = [`#inst=${score.instrument ?? "piano"}`, drum, "#volume=80"]
		.filter((s) => s.length > 0)
		.join("");
	const lines = tracks
		.map((t, i) =>
			t.notes.length
				? `@${i}${core.getMMLFromNotes(t.notes, score.bpm, t.volume).trim().replace(/\s+/g, "")}`
				: "",
		)
		.filter((s) => s.length > 0);
	if (bars === 0) throw new Error("melody が空");
	return [meta, ...lines, "#end;"].join(";");
};

if (process.argv[1]?.includes("hand-compile")) {
	const score: HandScore = JSON.parse(readFileSync(process.argv[2], "utf8"));
	const mml = compileScore(score);
	writeFileSync(process.argv[3], mml, "utf8");
	console.log(
		`ok: ${score.title ?? "(untitled)"} → ${process.argv[3]} (${mml.length} bytes)`,
	);
}
