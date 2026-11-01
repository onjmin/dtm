import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import type { AutoRole, PresetSlot } from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { MMLCore } from "../../src/mml/mml-core";
import type { Note, RenderConfig } from "../../src/types";
import { roleOfSlot } from "../../src/ui/auto-role";
import { DTM_VERSION } from "../../src/version";
export const SECTIONS: any = ["intro", "verse", "chorus"];
export const BAR = 192;
export const S16 = 12;
export const SEMI = 31;
export type Template = string;
// 耳コピ由来の kaiwai_1〜4 は渡さない（docs/design/handover-compose.md §1）
export const DRUMS = [
	"4beat",
	"8beat",
	"16beat",
	"dance",
	"disco",
	"four_clap",
	"four_clap_pedal",
	"four_openhat",
	"four_clap_16hat",
	"four_clap_pedal_open",
	"four_clap_snare_closed",
	"four_openhat_double",
	"four_openhat_snare",
	"break_openhat",
	"four_clap_16hat_sparse",
	"four_clap_16hat_run",
	"four_clap_16hat_snare",
];

// ---------------------------------------------------------------- 音名

export const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT: Record<string, string> = {
	Db: "C#",
	Eb: "D#",
	Gb: "F#",
	Ab: "G#",
	Bb: "A#",
	Cb: "B",
	Fb: "E",
};
export const nameOf = (units: number): string => {
	const m = Math.round(units / SEMI);
	return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};
export const unitsOf = (name: string): number => {
	const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
	if (!m) throw new Error(`音名が読めない: ${name}（例 E5・F#4・Bb3）`);
	const pc = NAMES.indexOf(
		FLAT[`${m[1]}${m[2] ?? ""}`] ?? `${m[1]}${m[2] ?? ""}`,
	);
	return ((Number(m[3]) + 1) * 12 + pc) * SEMI;
};
export const transposeChord = (chord: string, semis: number): string =>
	chord.replace(
		/(^|\/)([A-G])(#|b)?/g,
		(_all, pre: string, l: string, acc: string | undefined) => {
			const pc = NAMES.indexOf(FLAT[`${l}${acc ?? ""}`] ?? `${l}${acc ?? ""}`);
			return `${pre}${NAMES[(((pc + semis) % 12) + 12) % 12]}`;
		},
	);
export const num = (x: number): string => String(+x.toFixed(2));

// ---------------------------------------------------------------- 曲の状態

export type N = { s: number; d: number; p: number; v: number };
export type Track = {
	index: number;
	slot?: PresetSlot;
	role: AutoRole;
	inst: string;
	volume: number;
	notes: N[];
};
export type Op = { name: string; args: Record<string, unknown> };
export type Song = {
	template: Template;
	seed: number;
	bpm: number;
	key: string;
	instrument: string;
	drum: string;
	scale: string;
	tracks: Map<number, Track>;
	/** 小節ごとの和音（実音の調） */
	chords: string[];
	/** 小節ごとのセクション名 */
	labels: string[];
	bars: number;
};

export const LEAD_SLOTS = new Set<string | undefined>([
	"melody",
	"submelody",
	"chorusLead",
	"solo",
	undefined,
]);

export const generate = (template: Template, seed: number): Song => {
	const song = composeSong({
		random: seededRandom(seed),
		template,
		stepsPerBar: BAR,
		edo: 12,
		baseKey: "any",
		scale: "auto",
		sections: SECTIONS,
		recent: [],
	});
	const preset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	const layers = buildAdvancedLayers(song, {
		stepsPerBar: BAR,
		edo: 12,
		preset,
	});
	const tracks = new Map<number, Track>();
	for (const l of layers) {
		if (!l.notes.length) continue;
		// スロットの無い層（合いの手）はアプリでは推定に回り、主旋律・音量 100 になる（seed 103 の getMML で確かめた）
		const role = l.slot ? roleOfSlot(l.slot) : "melody";
		const p = preset as unknown as Record<string, string>;
		tracks.set(l.index, {
			index: l.index,
			slot: l.slot,
			role,
			inst: p[l.slot ?? "melody"] ?? p[role] ?? preset.melody,
			volume: l.slot ? l.volume : 100,
			notes: l.notes.map((n) => ({
				s: n.startStep,
				d: n.durationSteps,
				p: n.pitchUnits + l.octave * 12 * SEMI,
				v: n.velocity ?? 100,
			})),
		});
	}
	const base = song.chordProgression.split("|").map((c) => c.trim());
	const chords = Array.from({ length: song.bars }, (_, b) =>
		(base[b] ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.map((c) => transposeChord(c, song.rootShift))
			.join(" "),
	);
	const labels = Array.from({ length: song.bars }, (_, b) => {
		const sec = song.sections.find(
			(s) => b >= s.startBar && b < s.startBar + s.bars,
		);
		return sec
			? `${sec.kind}${sec.keyShift ? `(${sec.keyShift > 0 ? "+" : ""}${sec.keyShift})` : ""}`
			: "";
	});
	return {
		template,
		seed,
		bpm: song.bpm,
		key: song.keyName,
		instrument: song.instrument,
		drum: song.drum,
		scale: song.scaleId,
		tracks,
		chords,
		labels,
		bars: song.bars,
	};
};

export const notesIn = (t: Track, bar: number): N[] =>
	t.notes.filter((n) => n.s >= bar * BAR && n.s < (bar + 1) * BAR);
export const soundingAt = (t: Track, step: number): N[] =>
	t.notes.filter((n) => n.s <= step && n.s + n.d > step);
export const parseTracks = (song: Song, v: unknown): number[] => {
	if (v === undefined || v === "all") return [...song.tracks.keys()];
	const list = (Array.isArray(v) ? v : String(v).split(/[ ,]+/)).map((x) =>
		Number(String(x).replace(/^t/, "")),
	);
	for (const t of list)
		if (!song.tracks.has(t))
			throw new Error(
				`t${t} は音の無いトラック。ある: ${[...song.tracks.keys()].join(",")}`,
			);
	return list;
};
export const barRange = (song: Song, from: unknown, to: unknown): [number, number] => {
	const f = Number(from);
	const t = Number(to ?? from);
	if (
		!Number.isInteger(f) ||
		!Number.isInteger(t) ||
		f < 1 ||
		t < f ||
		t > song.bars
	)
		throw new Error(`小節の範囲が不正: ${from}〜${to}（1〜${song.bars}）`);
	return [f - 1, t - 1];
};

/** 小節の範囲を丸ごと消し、後ろを詰める（全トラック・和音・セクション名）。 */
export const deleteBars = (song: Song, b0: number, b1: number): void => {
	const n = b1 - b0 + 1;
	for (const t of song.tracks.values())
		t.notes = t.notes
			.filter((x) => x.s < b0 * BAR || x.s >= (b1 + 1) * BAR)
			.map((x) => (x.s >= (b1 + 1) * BAR ? { ...x, s: x.s - n * BAR } : x));
	song.chords.splice(b0, n);
	song.labels.splice(b0, n);
	song.bars -= n;
};
/** 小節の範囲の写しを at（0始まり）の前へ差し込み、後ろをずらす。 */
export const insertCopy = (
	song: Song,
	b0: number,
	b1: number,
	at: number,
	semis: number,
): void => {
	const n = b1 - b0 + 1;
	const copies = new Map<number, N[]>();
	for (const t of song.tracks.values())
		copies.set(
			t.index,
			t.notes
				.filter((x) => x.s >= b0 * BAR && x.s < (b1 + 1) * BAR)
				.map((x) => ({
					...x,
					s: x.s - b0 * BAR + at * BAR,
					p: x.p + semis * SEMI,
				})),
		);
	const chords = song.chords
		.slice(b0, b1 + 1)
		.map((c) => transposeChord(c, semis));
	const labels = song.labels.slice(b0, b1 + 1);
	for (const t of song.tracks.values()) {
		t.notes = t.notes.map((x) =>
			x.s >= at * BAR ? { ...x, s: x.s + n * BAR } : x,
		);
		t.notes.push(...(copies.get(t.index) ?? []));
	}
	song.chords.splice(at, 0, ...chords);
	song.labels.splice(at, 0, ...labels);
	song.bars += n;
};

// ---------------------------------------------------------------- 書き出し

export const AUTO_ROLE_MIX: Record<
	AutoRole,
	{
		comp: number;
		width: number;
		rev: number;
		dly: number;
		eqlo: number;
		eqhi: number;
	}
> = {
	// src/ui/daw.ts の AUTO_ROLE_MIX と同じ値（おまかせマスタリングが書くストリップ）
	melody: { comp: 35, width: 115, rev: 12, dly: 15, eqlo: -2, eqhi: 2 },
	submelody: { comp: 32, width: 115, rev: 15, dly: 8, eqlo: -3, eqhi: 1 },
	chord: { comp: 25, width: 118, rev: 22, dly: 0, eqlo: -4, eqhi: 0 },
	bass: { comp: 40, width: 100, rev: 5, dly: 0, eqlo: 2, eqhi: -3 },
};
export const PAN: Record<AutoRole, number[]> = {
	melody: [0],
	bass: [0],
	submelody: [18, -18, 30, -30],
	chord: [36, -36, 48, -48],
};

export const toMML = (song: Song): string => {
	const h = [
		`#ver=${DTM_VERSION} #inst=${song.instrument} #drum=${song.drum} #drumfont=FluidR3_GM_sf2_file:0 #volume=50 #drumvolume=80`,
		"#reverb=12 #reverbdecay=15 #reverbpredelay=20 #mastercomp=25 #fadeout=15 #mode=advanced",
		`#seed=${song.seed} #compose=${song.template}:any:auto:intro-verse-chorus`,
	];
	const all = Array.from({ length: 15 }, (_, i) => song.tracks.get(i));
	const strip: string[] = [];
	for (const t of all) if (t) strip.push(`#t${t.index}inst=${t.inst}`);
	// 音の無いトラックも daw.ts と同じ既定値（comp 35・width 115・rev 15）を書く
	const each = (f: (m: (typeof mix)[number], i: number) => string | false) =>
		mix.forEach((m, i) => {
			const s = f(m, i);
			if (s) strip.push(s);
		});
	const mix = all.map((t) => (t ? AUTO_ROLE_MIX[t.role] : undefined));
	each((m, i) => `#t${i}comp=${m?.comp ?? 35}`);
	each((m, i) => (m?.width ?? 115) !== 100 && `#t${i}width=${m?.width ?? 115}`);
	each((m, i) => `#t${i}rev=${m?.rev ?? 15}`);
	each((m, i) => !!m?.eqlo && `#t${i}eqlo=${m.eqlo}`);
	each((m, i) => !!m?.eqhi && `#t${i}eqhi=${m.eqhi}`);
	const counter = new Map<AutoRole, number>();
	for (const t of all) {
		if (!t) continue;
		const k = counter.get(t.role) ?? 0;
		counter.set(t.role, k + 1);
		const offs = PAN[t.role];
		const pan = Math.max(0, Math.min(127, 64 + (offs[k % offs.length] ?? 0)));
		if (pan !== 64) strip.push(`#t${t.index}pan=${pan}`);
	}
	each((m, i) => !!m?.dly && `#t${i}dly=${m.dly}`);
	const header = `${h.join(" ")} ${strip.join(" ")}`;

	const config: RenderConfig = {
		stepsPerBar: BAR,
		keyCount: 88,
		pitchRangeStart: 0,
		unitsPerRow: 31,
		keyHeight: 12,
		stepWidth: 2,
		edo: 12,
	};
	const core = new MMLCore(
		{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
		100,
		() => config,
	);
	let id = 1;
	const lines = [...song.tracks.values()]
		.filter((t) => t.notes.length)
		.sort((a, b) => a.index - b.index)
		.map((t) => {
			const notes = [...t.notes]
				.sort((a, b) => a.s - b.s || a.p - b.p)
				.map(
					(n) =>
						({
							id: id++,
							startStep: n.s,
							durationSteps: n.d,
							pitchUnits: n.p,
							velocity: n.v,
						}) as Note,
				);
			return `@${t.index} ${core.getMMLFromNotes(notes as never, song.bpm, t.volume).trim()}`;
		});
	return `${[header, ...lines, "#end"].join(";\n")};`;
};

