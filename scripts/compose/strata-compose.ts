/**
 * Strata（このPCのローカル LLM）に界隈曲を作らせる。判断は Strata がし、このスクリプトは道具を渡すだけ。
 *
 *   npx tsx scripts/compose/strata-compose.ts new [--title <曲名>] [--request <依頼文>] [--max-turns 80]
 *       棚（tmp/songs/）にフォルダを作り、Strata に依頼して会話を回す。Strata が finish を呼ぶか
 *       --max-turns に達したら止まる。曲名を省くと岩石・鉱石の英名（ore-names.ts、棚で未使用のもの）から選ぶ。
 *       会話・手直しの操作列は曲フォルダの strata-session.json に残る。
 *   npx tsx scripts/compose/strata-compose.ts continue <曲> --say <追加の指示> [--max-turns 40]
 *       同じ会話の続きに指示を足して回す（試聴の感想・直してほしい所を渡す）。
 *   npx tsx scripts/compose/strata-compose.ts rebuild <曲>
 *       strata-session.json の操作列を seed から当て直して song.mml を作り直す（会話はしない）。
 *
 * 手順と注意は docs/strata-compose.md。Strata の起動・接続は「Strata 呼び出しガイド」（STRATA_URL で接続先を変えられる）。
 *
 * 道具は事実だけを返す（小節ごとの和音・層・リードの音、こすれの場所の一覧）。点数や合否は返さない
 * （docs/handover-compose.md §2: 点検の数値が目標になって曲が揃うため、作曲ハーネスは外した）。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import type { AutoRole, PresetSlot } from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { MMLCore } from "../../src/mml/mml-core";
import type { Note, RenderConfig } from "../../src/types";
import { roleOfSlot } from "../../src/ui/auto-role";
import { DTM_VERSION } from "../../src/version";
import { pickOreName } from "./ore-names";

const STRATA_URL = process.env.STRATA_URL ?? "http://127.0.0.1:8080/v1";
const MODEL_LABEL = "Strata Qwen3.8-Flash-Next";
const SHELF = resolve("tmp/songs");
const BAR = 192;
const S16 = 12;
const SEMI = 31;
const TEMPLATES = ["kaiwai_2go_lead", "kaiwai_speder2_lead"] as const;
type Template = (typeof TEMPLATES)[number];
// 耳コピ由来の kaiwai_1〜4 は渡さない（docs/handover-compose.md §1）
const DRUMS = [
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

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT: Record<string, string> = {
	Db: "C#",
	Eb: "D#",
	Gb: "F#",
	Ab: "G#",
	Bb: "A#",
	Cb: "B",
	Fb: "E",
};
const nameOf = (units: number): string => {
	const m = Math.round(units / SEMI);
	return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};
const unitsOf = (name: string): number => {
	const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
	if (!m) throw new Error(`音名が読めない: ${name}（例 E5・F#4・Bb3）`);
	const pc = NAMES.indexOf(
		FLAT[`${m[1]}${m[2] ?? ""}`] ?? `${m[1]}${m[2] ?? ""}`,
	);
	return ((Number(m[3]) + 1) * 12 + pc) * SEMI;
};
const transposeChord = (chord: string, semis: number): string =>
	chord.replace(
		/(^|\/)([A-G])(#|b)?/g,
		(_all, pre: string, l: string, acc: string | undefined) => {
			const pc = NAMES.indexOf(FLAT[`${l}${acc ?? ""}`] ?? `${l}${acc ?? ""}`);
			return `${pre}${NAMES[(((pc + semis) % 12) + 12) % 12]}`;
		},
	);
const num = (x: number): string => String(+x.toFixed(2));

// ---------------------------------------------------------------- 曲の状態

type N = { s: number; d: number; p: number; v: number };
type Track = {
	index: number;
	slot?: PresetSlot;
	role: AutoRole;
	inst: string;
	volume: number;
	notes: N[];
};
type Op = { name: string; args: Record<string, unknown> };
type Song = {
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

const LEAD_SLOTS = new Set<string | undefined>([
	"melody",
	"submelody",
	"chorusLead",
	"solo",
	undefined,
]);

const generate = (template: Template, seed: number): Song => {
	const song = composeSong({
		random: seededRandom(seed),
		template,
		stepsPerBar: BAR,
		edo: 12,
		baseKey: "any",
		scale: "auto",
		sections: ["intro", "verse", "chorus"],
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

const notesIn = (t: Track, bar: number): N[] =>
	t.notes.filter((n) => n.s >= bar * BAR && n.s < (bar + 1) * BAR);
const soundingAt = (t: Track, step: number): N[] =>
	t.notes.filter((n) => n.s <= step && n.s + n.d > step);
const parseTracks = (song: Song, v: unknown): number[] => {
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
const barRange = (song: Song, from: unknown, to: unknown): [number, number] => {
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
const deleteBars = (song: Song, b0: number, b1: number): void => {
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
const insertCopy = (
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

const AUTO_ROLE_MIX: Record<
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
const PAN: Record<AutoRole, number[]> = {
	melody: [0],
	bass: [0],
	submelody: [18, -18, 30, -30],
	chord: [36, -36, 48, -48],
};

const toMML = (song: Song): string => {
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

// ---------------------------------------------------------------- 読む道具

const describeSeed = (template: Template, seed: number): string => {
	const s = generate(template, seed);
	const secs: string[] = [];
	for (let b = 0; b < s.bars; b++)
		if (b === 0 || s.labels[b] !== s.labels[b - 1])
			secs.push(`${s.labels[b]}@${b + 1}`);
	const lead = s.tracks.get(0);
	const lo = lead ? Math.min(...lead.notes.map((n) => n.p)) : 0;
	const hi = lead ? Math.max(...lead.notes.map((n) => n.p)) : 0;
	return `seed ${seed}: ${s.key} ${s.bpm}BPM ${s.bars}小節 drum=${s.drum} inst=${s.instrument} scale=${s.scale} lead=${nameOf(lo)}〜${nameOf(hi)} | ${secs.join(" ")}`;
};

const fmtNotes = (ns: N[], bar: number): string =>
	ns
		.sort((a, b) => a.s - b.s || b.p - a.p)
		.map(
			(n) => `${num((n.s - bar * BAR) / S16)}:${nameOf(n.p)}:${num(n.d / S16)}`,
		)
		.join(" ");

const readBars = (
	song: Song,
	from: unknown,
	to: unknown,
	tracksArg: unknown,
): string => {
	const [b0, b1] = barRange(song, from, to);
	if (b1 - b0 >= 16) throw new Error("一度に読めるのは16小節まで");
	const detail = tracksArg === undefined ? [0] : parseTracks(song, tracksArg);
	const out: string[] = [];
	for (let b = b0; b <= b1; b++) {
		const on = [...song.tracks.values()].filter((t) =>
			t.notes.some((n) => n.s < (b + 1) * BAR && n.s + n.d > b * BAR),
		);
		// 主旋律と同じ音を鳴らしている層（重ね）を印す
		const leadKey = song.tracks.get(0)
			? fmtNotes(notesIn(song.tracks.get(0) as Track, b), b)
			: "";
		const tags = on.map((t) => {
			if (t.index === 0 || !leadKey) return `t${t.index}`;
			const k = fmtNotes(notesIn(t, b), b);
			const shifted = notesIn(t, b).map((n) => ({ ...n, p: n.p + 12 * SEMI }));
			const shiftedDown = notesIn(t, b).map((n) => ({
				...n,
				p: n.p - 12 * SEMI,
			}));
			if (k === leadKey) return `t${t.index}(=t0)`;
			if (fmtNotes(shifted, b) === leadKey) return `t${t.index}(=t0の8va下)`;
			if (fmtNotes(shiftedDown, b) === leadKey)
				return `t${t.index}(=t0の8va上)`;
			return `t${t.index}`;
		});
		const bass = [...song.tracks.values()].find(
			(t) => t.role === "bass" && notesIn(t, b).length,
		);
		const bn = bass
			? notesIn(bass, b)
					.sort((x, y) => x.s - y.s)
					.slice(0, 4)
					.map((n) => nameOf(n.p))
					.join(" ")
			: "-";
		// 伴奏がリードの最高音より上で鳴っている層（パッドの持続音がリードを覆う、など）
		const leadNotes = song.tracks.get(0)
			? notesIn(song.tracks.get(0) as Track, b)
			: [];
		const leadTop = leadNotes.length
			? Math.max(...leadNotes.map((n) => n.p))
			: undefined;
		const above =
			leadTop === undefined
				? []
				: on
						.filter((t) => !LEAD_SLOTS.has(t.slot))
						.flatMap((t) => {
							const top = Math.max(
								...t.notes
									.filter((n) => n.s < (b + 1) * BAR && n.s + n.d > b * BAR)
									.map((n) => n.p),
							);
							return top > leadTop ? [`t${t.index} ${nameOf(top)}`] : [];
						});
		out.push(
			`${b + 1} [${song.labels[b]}] ${song.chords[b]} | 層 ${tags.join(",")} | ベース ${bn}${above.length ? ` | リードより上: ${above.join(" ")}` : ""}`,
		);
		for (const ti of detail) {
			const t = song.tracks.get(ti);
			if (!t) continue;
			const ns = notesIn(t, b);
			if (ns.length) out.push(`   t${ti}: ${fmtNotes(ns, b)}`);
		}
	}
	return out.join("\n");
};

/** リードが伴奏と半音（短9度含む）でこする場所の一覧。件数の評価はしない。 */
const listRubs = (
	song: Song,
	from: unknown,
	to: unknown,
	all: unknown,
): string => {
	const [b0, b1] = barRange(song, from, to);
	const lead = song.tracks.get(0);
	if (!lead) return "t0 が無い";
	const acc = [...song.tracks.values()].filter((t) => !LEAD_SLOTS.has(t.slot));
	const out: string[] = [];
	// 主旋律の重ね（サビの重ね・オクターブの重ね）が t0 と別の音を同時に鳴らしている小節
	for (const t of song.tracks.values()) {
		if (t.index === 0 || !LEAD_SLOTS.has(t.slot)) continue;
		for (let b = b0; b <= b1; b++) {
			const mine = notesIn(t, b);
			const ref = notesIn(lead, b);
			if (!mine.length || !ref.length) continue;
			const pcs = (ns: N[]) =>
				ns
					.map((n) => `${n.s}:${((Math.round(n.p / SEMI) % 12) + 12) % 12}`)
					.sort()
					.join(" ");
			const shared = mine.filter((n) => ref.some((r) => r.s === n.s)).length;
			if (shared >= mine.length / 2 && pcs(mine) !== pcs(ref))
				out.push(
					`${b + 1}小節 t${t.index} が主旋律と違う音を重ねている（t0 と揃えるか clear_bars で外す）`,
				);
		}
	}
	for (const n of lead.notes) {
		if (n.s < b0 * BAR || n.s >= (b1 + 1) * BAR) continue;
		const onBeat = n.s % (BAR / 4) === 0;
		if (!all && n.d < 2 * S16 && !onBeat) continue; // 既定では16分の裏の経過音は見ない
		const hits: string[] = [];
		for (const t of acc)
			for (const a of soundingAt(t, n.s)) {
				const iv = ((Math.round((n.p - a.p) / SEMI) % 12) + 12) % 12;
				if (iv === 1 || iv === 11) hits.push(`${nameOf(a.p)}(t${t.index})`);
			}
		if (hits.length) {
			const b = Math.floor(n.s / BAR);
			out.push(
				`${b + 1}小節 ${num((n.s - b * BAR) / S16)}/16 リード${nameOf(n.p)}(長さ${num(n.d / S16)}) vs ${[...new Set(hits)].join(" ")} 和音 ${song.chords[b]}`,
			);
		}
	}
	return out.length
		? out.slice(0, 60).join("\n") +
				(out.length > 60 ? `\n…ほか${out.length - 60}か所` : "")
		: "こすれる場所は無い";
};

// ---------------------------------------------------------------- 手直しの道具（操作列として記録し、再生成で当て直せる）

const applyOp = (song: Song, op: Op): string => {
	const a = op.args;
	switch (op.name) {
		case "write_bar": {
			const [b] = barRange(song, a.bar, a.bar);
			const targets = parseTracks(song, a.tracks ?? [0]);
			// 書く前に主旋律を重ねていた層（同じ音・オクターブ違い）を覚えておき、取り残したら知らせる
			const lead0 = song.tracks.get(0);
			const before = lead0 ? fmtNotes(notesIn(lead0, b), b) : "";
			const doubles = [...song.tracks.values()].filter((t) => {
				if (t.index === 0 || targets.includes(t.index) || !before) return false;
				return [0, 12, -12].some(
					(o) =>
						fmtNotes(
							notesIn(t, b).map((n) => ({ ...n, p: n.p + o * SEMI })),
							b,
						) === before,
				);
			});
			const parsed = String(a.notes ?? "")
				.split(/\s+/)
				.filter(Boolean)
				.map((tok) => {
					const [pos, name, len] = tok.split(":");
					const s = Number(pos);
					const d = Number(len);
					if (!(s >= 0 && s < 16) || !(d > 0 && s + d <= 32) || !name)
						throw new Error(
							`音符が読めない: ${tok}（位置:音名:長さ、16分単位。例 0:E5:2）`,
						);
					return { s, d, p: unitsOf(name) };
				});
			for (const ti of targets) {
				const t = song.tracks.get(ti) as Track;
				const old = notesIn(t, b);
				const vs = old.map((n) => n.v).sort((x, y) => x - y);
				const v =
					vs[Math.floor(vs.length / 2)] ??
					Math.round(
						t.notes.reduce((x, n) => x + n.v, 0) / Math.max(1, t.notes.length),
					);
				const shift =
					Number(a.octave_for_others ?? 0) *
					(ti === targets[0] ? 0 : 12 * SEMI);
				t.notes = t.notes.filter((n) => !old.includes(n));
				// 前の小節から食い込んでいる音は、書いた音の頭で切る
				const first = parsed.length
					? Math.min(...parsed.map((x) => x.s)) * S16 + b * BAR
					: (b + 1) * BAR;
				for (const n of t.notes)
					if (n.s < b * BAR && n.s + n.d > first) n.d = first - n.s;
				for (const x of parsed)
					t.notes.push({
						s: b * BAR + Math.round(x.s * S16),
						d: Math.round(x.d * S16),
						p: x.p + shift,
						v: Math.round(x.s) % 4 === 0 ? v : Math.max(1, v - 6),
					});
			}
			const left =
				targets.includes(0) && doubles.length
					? `。注意: t${doubles.map((t) => t.index).join(",t")} はこの小節で主旋律を重ねていたが古い音のまま（揃えるなら tracks に入れて書き直す。外すなら clear_bars）`
					: "";
			return `${b + 1}小節目の t${targets.join(",t")} を書き換えた（${parsed.length}音）${left}`;
		}
		case "transpose": {
			const [b0, b1] = barRange(song, a.from, a.to);
			const semis = Number(a.semitones);
			if (!Number.isInteger(semis) || Math.abs(semis) > 24)
				throw new Error("semitones は ±24 までの整数");
			const ts = parseTracks(song, a.tracks);
			for (const ti of ts)
				for (const n of (song.tracks.get(ti) as Track).notes)
					if (n.s >= b0 * BAR && n.s < (b1 + 1) * BAR) n.p += semis * SEMI;
			if (a.tracks === undefined || a.tracks === "all")
				for (let b = b0; b <= b1; b++)
					song.chords[b] = transposeChord(song.chords[b] ?? "", semis);
			return `${b0 + 1}〜${b1 + 1}小節の t${ts.join(",t")} を ${semis} 半音動かした`;
		}
		case "copy_bars": {
			const [s0, s1] = barRange(song, a.src_from, a.src_to);
			const [d0] = barRange(song, a.dst_from, a.dst_from);
			const n = s1 - s0 + 1;
			if (d0 + n > song.bars)
				throw new Error("写し先が曲の終わりを越える（insert_bars を使う）");
			const ts = parseTracks(song, a.tracks);
			const semis = Number(a.semitones ?? 0);
			for (const ti of ts) {
				const t = song.tracks.get(ti) as Track;
				const src = t.notes
					.filter((x) => x.s >= s0 * BAR && x.s < (s1 + 1) * BAR)
					.map((x) => ({
						...x,
						s: x.s - s0 * BAR + d0 * BAR,
						p: x.p + semis * SEMI,
					}));
				t.notes = t.notes
					.filter((x) => x.s < d0 * BAR || x.s >= (d0 + n) * BAR)
					.concat(src);
			}
			if (a.tracks === undefined || a.tracks === "all")
				for (let i = 0; i < n; i++) {
					song.chords[d0 + i] = transposeChord(
						song.chords[s0 + i] ?? "",
						semis,
					);
					song.labels[d0 + i] = song.labels[s0 + i] ?? "";
				}
			return `${s0 + 1}〜${s1 + 1}小節を ${d0 + 1}小節目からへ写した（t${ts.join(",t")}）`;
		}
		case "clear_bars": {
			const [b0, b1] = barRange(song, a.from, a.to);
			const ts = parseTracks(song, a.tracks);
			if (a.tracks === undefined || a.tracks === "all")
				throw new Error(
					"clear_bars は tracks を指定する（全部消すなら delete_bars）",
				);
			for (const ti of ts) {
				const t = song.tracks.get(ti) as Track;
				t.notes = t.notes.filter(
					(x) => x.s < b0 * BAR || x.s >= (b1 + 1) * BAR,
				);
			}
			return `${b0 + 1}〜${b1 + 1}小節の t${ts.join(",t")} を空にした`;
		}
		case "delete_bars": {
			const [b0, b1] = barRange(song, a.from, a.to);
			deleteBars(song, b0, b1);
			return `${b0 + 1}〜${b1 + 1}小節を消して詰めた（全${song.bars}小節）`;
		}
		case "insert_bars": {
			const [s0, s1] = barRange(song, a.src_from, a.src_to);
			const at = Number(a.before_bar) - 1;
			if (!Number.isInteger(at) || at < 0 || at > song.bars)
				throw new Error(`before_bar は 1〜${song.bars + 1}`);
			insertCopy(song, s0, s1, at, Number(a.semitones ?? 0));
			return `${s0 + 1}〜${s1 + 1}小節の写しを ${at + 1}小節目の前へ差し込んだ（全${song.bars}小節）`;
		}
		case "double_lead": {
			// 重ねの層を、範囲の中だけ主旋律（t0）の写しにする（octave でオクターブ違い）
			const [b0, b1] = barRange(song, a.from, a.to);
			const [ti] = parseTracks(song, [a.track]);
			if (ti === 0 || ti === undefined)
				throw new Error("track は t0 以外の重ねの層");
			const t = song.tracks.get(ti) as Track;
			const lead = song.tracks.get(0) as Track;
			const inRange = (x: N) => x.s >= b0 * BAR && x.s < (b1 + 1) * BAR;
			const vs = t.notes
				.filter(inRange)
				.map((n) => n.v)
				.sort((x, y) => x - y);
			const v = vs[Math.floor(vs.length / 2)] ?? 90;
			const oct = Number(a.octave ?? 0) * 12 * SEMI;
			t.notes = t.notes
				.filter((x) => !inRange(x))
				.concat(
					lead.notes.filter(inRange).map((n) => ({ ...n, p: n.p + oct, v })),
				);
			return `${b0 + 1}〜${b1 + 1}小節の t${ti} を主旋律の写しにした`;
		}
		case "set_drum": {
			if (!DRUMS.includes(String(a.pattern)))
				throw new Error(
					`知らないドラム: ${a.pattern}。使える: ${DRUMS.join(" ")}`,
				);
			song.drum = String(a.pattern);
			return `ドラムを ${song.drum} にした`;
		}
		case "set_volume": {
			const t = song.tracks.get(Number(String(a.track).replace(/^t/, "")));
			const v = Number(a.volume);
			if (!t || !(v >= 0 && v <= 127))
				throw new Error("track は音のあるトラック、volume は 0〜127");
			t.volume = v;
			return `t${t.index} の音量を ${v} にした`;
		}
	}
	throw new Error(`知らない操作: ${op.name}`);
};
const EDIT_OPS = new Set([
	"double_lead",
	"write_bar",
	"transpose",
	"copy_bars",
	"clear_bars",
	"delete_bars",
	"insert_bars",
	"set_drum",
	"set_volume",
]);

// ---------------------------------------------------------------- Strata へ渡す道具の定義

const fn = (
	name: string,
	description: string,
	properties: Record<string, unknown>,
	required: string[],
) => ({
	type: "function",
	function: {
		name,
		description,
		parameters: { type: "object", properties, required },
	},
});
const WHY = { type: "string", description: "なぜそうするか（棚の記録に残る）" };
const TRK = {
	description: 'トラック番号の配列（例 [0,13]）か "all"。省略は all',
	anyOf: [{ type: "array", items: { type: "integer" } }, { type: "string" }],
};
const TOOLS = [
	fn(
		"read_doc",
		"資料を読む。lineage_2go / lineage_speder2 は流派の実測、owner は所有者の判断と試聴の記録",
		{
			name: {
				type: "string",
				enum: ["lineage_2go", "lineage_speder2", "owner"],
			},
		},
		["name"],
	),
	fn(
		"list_seeds",
		"流派テンプレートの seed を一覧する（最大20）。調・テンポ・ドラム・楽器・リードの音域・セクションの並び",
		{
			template: { type: "string", enum: [...TEMPLATES] },
			from: { type: "integer" },
			count: { type: "integer" },
		},
		["template", "from", "count"],
	),
	fn(
		"select_seed",
		"この seed の曲を土台にする（それまでの手直しは捨てる）",
		{
			template: { type: "string", enum: [...TEMPLATES] },
			seed: { type: "integer" },
			why: WHY,
		},
		["template", "seed", "why"],
	),
	fn(
		"read_bars",
		"曲を小節ごとに読む（最大16小節）。和音は実音。tracks に挙げたトラックの音符を「位置:音名:長さ」（16分単位、3連は小数）で出す。template と seed を付けると、土台に選ぶ前の候補（手直し無し）を読める",
		{
			from: { type: "integer" },
			to: { type: "integer" },
			tracks: TRK,
			template: { type: "string", enum: [...TEMPLATES] },
			seed: { type: "integer" },
		},
		["from", "to"],
	),
	fn(
		"list_rubs",
		"リード(t0)の拍頭か8分以上の音が、伴奏・ベースと半音でこする場所と、主旋律の重ね（t1・t13 など）が t0 と違う音を鳴らしている小節を一覧する。all を true にすると16分の裏の音も見る（走句を書いたら使う）。直すか残すかは自分で決める",
		{
			from: { type: "integer" },
			to: { type: "integer" },
			all: { type: "boolean" },
		},
		["from", "to"],
	),
	fn(
		"write_bar",
		'1小節の音符を書き換える。notes は空白区切りの「位置:音名:長さ」（16分単位。例 "0:E5:2 2:D5:1 3:B4:1"）。tracks の各トラックに同じ音を置く（重ねの層も揃えるとき）。octave_for_others で2番目以降のトラックをオクターブずらせる',
		{
			bar: { type: "integer" },
			notes: { type: "string" },
			tracks: TRK,
			octave_for_others: { type: "integer" },
			why: WHY,
		},
		["bar", "notes", "why"],
	),
	fn(
		"transpose",
		"小節範囲を半音単位で動かす。tracks 省略で全トラック（和音名も動く）",
		{
			from: { type: "integer" },
			to: { type: "integer" },
			semitones: { type: "integer" },
			tracks: TRK,
			why: WHY,
		},
		["from", "to", "semitones", "why"],
	),
	fn(
		"copy_bars",
		"小節範囲を別の位置へ上書きで写す（長さは変わらない）",
		{
			src_from: { type: "integer" },
			src_to: { type: "integer" },
			dst_from: { type: "integer" },
			tracks: TRK,
			semitones: { type: "integer" },
			why: WHY,
		},
		["src_from", "src_to", "dst_from", "why"],
	),
	fn(
		"clear_bars",
		"小節範囲の指定トラックを空にする（層を抜く）",
		{
			from: { type: "integer" },
			to: { type: "integer" },
			tracks: TRK,
			why: WHY,
		},
		["from", "to", "tracks", "why"],
	),
	fn(
		"delete_bars",
		"小節範囲を全トラックから消して後ろを詰める（構成を短くする）",
		{ from: { type: "integer" }, to: { type: "integer" }, why: WHY },
		["from", "to", "why"],
	),
	fn(
		"insert_bars",
		"小節範囲の写しを before_bar の前へ差し込む（構成を長くする）",
		{
			src_from: { type: "integer" },
			src_to: { type: "integer" },
			before_bar: { type: "integer" },
			semitones: { type: "integer" },
			why: WHY,
		},
		["src_from", "src_to", "before_bar", "why"],
	),
	fn(
		"double_lead",
		"重ねの層（サビの t1、Aメロの t13 など）を、範囲の中だけ主旋律 t0 の写しにする。t0 を書き換えた後に重ねを揃えるのに使う",
		{
			from: { type: "integer" },
			to: { type: "integer" },
			track: { type: "integer" },
			octave: {
				type: "integer",
				description: "t0 からのオクターブ差（省略 0）",
			},
			why: WHY,
		},
		["from", "to", "track", "why"],
	),
	fn(
		"set_drum",
		`ドラムの型を変える。使える: ${DRUMS.join(" ")}`,
		{ pattern: { type: "string" }, why: WHY },
		["pattern", "why"],
	),
	fn(
		"set_volume",
		"トラックの音量（0〜127）",
		{ track: { type: "integer" }, volume: { type: "integer" }, why: WHY },
		["track", "volume", "why"],
	),
	fn(
		"note",
		"作曲の記録に1段書く（読んで分かったこと・決めたこと）",
		{ did: { type: "string" }, saw: { type: "string" }, why: WHY },
		["did"],
	),
	fn(
		"finish",
		"仕上げる。MML を書き出して棚に置き、作業を終える",
		{
			title: { type: "string", description: "曲名（依頼文で指定したもの）" },
			summary: { type: "string", description: "曲の一言紹介" },
			self_review: {
				type: "string",
				description: "自分の品質評価: 聴き所・弱い所・確かめていないこと",
			},
		},
		["title", "summary", "self_review"],
	),
];

// ---------------------------------------------------------------- 資料

const section = (file: string, start: RegExp, end: RegExp): string => {
	const text = readFileSync(file, "utf8");
	const i = text.search(start);
	if (i < 0) return "";
	const rest = text.slice(i);
	const j = rest.slice(1).search(end);
	return j < 0 ? rest : rest.slice(0, j + 1);
};
const DOCS: Record<string, () => string> = {
	lineage_2go: () =>
		section(
			"docs/kaiwai-lineages.md",
			/^## 2号兄貴 — 規則/m,
			/^## 規則案：Speder2/m,
		) +
		section("docs/kaiwai-lineages.md", /^## 構成の幅/m, /^## 試聴/m)
			.split("\n")
			.filter((l) => !l.includes("Speder2") && !l.includes("海鮮"))
			.join("\n"),
	lineage_speder2: () =>
		section("docs/kaiwai-lineages.md", /^## 規則案：Speder2/m, /^## 両流派/m),
	owner: () =>
		section("docs/handover-compose.md", /^### 戒め/m, /^## 3\. 不変条件/m),
};

const SYSTEM = `あなたは作曲者です。DAW の自動作曲機能（界隈曲の流派テンプレート）が作った曲を土台に、聴く価値のあるインスト曲を1曲仕上げます。
判断はすべてあなたがします。道具は事実を返すだけで、良し悪しの点数は返しません。

## 所有者（この曲を聴く人）について分かっていること
- 目標は「人が手を入れる出発点」。判定は「出発点として使うか／捨てるか」。
- 捨てる理由の定番は「テーマが無い」「耳に訴えるメロディラインが無い」。原曲は1〜2個の軸（執拗な同音連打、テンション和音、1〜2コードのミニマル、徹底したペンタトニックなど）で大胆に振り切り、残りは素直。生成器や手直しが全軸で中庸・安全を狙うと、メッセージのない平均的な出力になって捨てられる。
- 使うとされた曲の理由は「サビが聴けるレベル」「メロディが伴奏と調和とれてた」「今までにないAメロで良い」。
- 当たりとして選ばれた曲は速め（テンポ中央 150）・16分が多い傾向。ただし全曲をそこへ寄せると同じ顔になるので、寄せることを目標にしない。
- 生成器のリードのまま並べ直し・音量調整しただけの版は捨てられた。効いたのはリードの書き方（主題・メッセージ性があり、伴奏と調和する）。
- 調和だけでは決まらない（伴奏と全くこすれないのに捨てられた曲がある）。数値を目標にして直すと旋律が痩せる。
- 耳コピ由来の旋律・進行は使わない。音符は生成器の出力か、あなたが書いたもの。
- 2号兄貴の seed 1〜60 と 101〜160 は前の作曲で検討・試聴済み。新しい曲にするため、それ以外（例 200 以降）から探す。

## 進め方
1. read_doc で流派の実測と所有者の記録を読み、流派を決める（2号兄貴=kaiwai_2go_lead か Speder2=kaiwai_speder2_lead）。
2. list_seeds で候補を眺め、良さそうなもの数曲を read_bars で小節ごとに読み比べて、1曲を select_seed で選ぶ。決め手は「主題（覚えられる短い動機）が曲の中で戻ってくるか」「部ごとに新しく聴くものがあるか」。選んだら、**「この曲は何の軸で大胆に振り切るか（意図・メッセージ）」を1文で決めて note に書く**。
3. 選んだ曲を全部読む（16小節ずつ）。部のつなぎ目・サビの入り・終わり方・リードの主題を確かめる。
4. 足りない所だけ手を入れる（write_bar・copy_bars・transpose など）。サビのリードが主題として弱ければ書き直してよい。list_rubs でこすれる場所を見て、直すか、残すなら理由を note に書く。
5. 書き換えた小節は read_bars で読み直して確かめる。
6. finish で仕上げる。self_review には聴き所（振り切った軸をどこで聴かせるか）・弱い所・確かめていないことを正直に書く。

## 注意
- 和音名は実音の調で書いてある。セクション名の (+2) は全音上へ転調した部分。
- 音符の位置と長さは16分音符単位（1小節=16）。3連は小数で出る。
- 主旋律は t0。read_bars の層の欄で「t13(=t0)」のように出るトラックは主旋律の重ね。主旋律を書き換えるときは重ねも tracks に入れて揃える（オクターブ違いなら octave_for_others）。
- こすれを消すために旋律を和音の音だけの往復や安全な音階歩きに痩せさせない。16分の経過音・刺繍音のこすれは残してよい（2号兄貴の原曲もリードが伴奏と半音でこする長さは 4〜39%、中央 19%）。直すのは拍頭や長い音で濁るところ。
- 高すぎる音（E6 以上）を続けない（所有者の指摘「高音が痛い」）。伴奏（パッドなど）がリードより上で鳴り続けるときは（read_bars の「リードより上」）、その層を transpose でオクターブ下げる（前の手直しでもパッドを1オクターブ下げた）。
- 決めたことと理由は note か各道具の why に必ず書く。後で所有者が読む作曲の記録になる。
- 日本語で考え、日本語で書く。`;

// ---------------------------------------------------------------- 棚

const shelf = (args: string[]): string =>
	execFileSync(
		process.execPath,
		[require.resolve("tsx/cli"), "scripts/misc/song-shelf.ts", ...args],
		{ encoding: "utf8" },
	).trim();
const findDir = (q: string): string => {
	if (existsSync(q)) return resolve(q);
	const hits = readdirSync(SHELF).filter((d) => d.includes(q));
	if (hits.length !== 1)
		throw new Error(
			`曲フォルダが1つに決まらない: ${q} → ${hits.join(" / ") || "なし"}`,
		);
	return join(SHELF, hits[0] as string);
};

type Msg = {
	role: string;
	content?: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	reasoning_content?: string;
};
type ToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};
type Session = {
	messages: Msg[];
	template?: Template;
	seed?: number;
	ops: Op[];
	finished?: { title: string; summary: string; self_review: string };
};

const rebuild = (s: Session): Song | undefined => {
	if (!s.template || s.seed === undefined) return undefined;
	const song = generate(s.template, s.seed);
	for (const op of s.ops) applyOp(song, op);
	return song;
};

// ---------------------------------------------------------------- Strata との会話

const chat = async (messages: Msg[]): Promise<Msg> => {
	const res = await fetch(`${STRATA_URL}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "strata",
			messages,
			tools: TOOLS,
			max_tokens: 16000,
			reasoning_effort: "medium",
			stream: true,
		}),
	});
	if (!res.ok || !res.body)
		throw new Error(`Strata ${res.status}: ${await res.text()}`);
	const msg: Msg = { role: "assistant", content: "", reasoning_content: "" };
	const calls: ToolCall[] = [];
	const decoder = new TextDecoder();
	let buf = "";
	for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
		buf += decoder.decode(chunk, { stream: true });
		let nl = buf.indexOf("\n");
		while (nl >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			nl = buf.indexOf("\n");
			if (!line.startsWith("data:")) continue;
			const data = line.slice(5).trim();
			if (data === "[DONE]") continue;
			const delta = JSON.parse(data).choices?.[0]?.delta;
			if (!delta) continue;
			if (delta.reasoning_content) {
				msg.reasoning_content += delta.reasoning_content;
				process.stdout.write(".");
			}
			if (delta.content) {
				msg.content += delta.content;
				process.stdout.write(delta.content);
			}
			for (const tc of delta.tool_calls ?? []) {
				if (!calls[tc.index])
					calls[tc.index] = {
						id: "",
						type: "function",
						function: { name: "", arguments: "" },
					};
				const c = calls[tc.index] as ToolCall;
				if (tc.id) c.id = tc.id;
				if (tc.function?.name) c.function.name += tc.function.name;
				if (tc.function?.arguments)
					c.function.arguments += tc.function.arguments;
			}
		}
	}
	process.stdout.write("\n");
	if (calls.length) msg.tool_calls = calls.filter(Boolean);
	return msg;
};

/** 64K に収めるため、古い道具の結果と思考を縮める（最新の12件は残す）。 */
const compact = (messages: Msg[]): Msg[] => {
	const size = () =>
		messages.reduce(
			(n, m) =>
				n + (m.content?.length ?? 0) + (m.reasoning_content?.length ?? 0),
			0,
		);
	const idx = messages
		.map((m, i) => (m.role === "tool" || m.reasoning_content ? i : -1))
		.filter((i) => i >= 0);
	for (const i of idx.slice(0, -12)) {
		if (size() < 70000) break;
		const m = messages[i] as Msg;
		if (m.role === "tool" && (m.content?.length ?? 0) > 400)
			m.content = `${m.content?.slice(0, 300)}\n…（古い結果なので省略。要るなら同じ道具で読み直す）`;
		if (m.reasoning_content) m.reasoning_content = "";
	}
	return messages;
};

const run = async (
	dir: string,
	session: Session,
	maxTurns: number,
): Promise<void> => {
	const save = () =>
		writeFileSync(
			join(dir, "strata-session.json"),
			JSON.stringify(session, null, 1),
		);
	const log = (text: string) =>
		writeFileSync(
			join(dir, "strata-log.md"),
			`${existsSync(join(dir, "strata-log.md")) ? readFileSync(join(dir, "strata-log.md"), "utf8") : ""}${text}\n`,
		);
	let song = rebuild(session);
	for (let turn = 0; turn < maxTurns && !session.finished; turn++) {
		console.log(`--- turn ${turn + 1}`);
		const reply = await chat(compact(session.messages));
		session.messages.push(reply);
		if (reply.content?.trim()) log(`\n**Strata**: ${reply.content.trim()}\n`);
		if (!reply.tool_calls?.length) {
			// 道具を呼ばずに話して止まったら、続けるよう促す（finish まで）
			session.messages.push({
				role: "user",
				content: "続けてください。仕上がったら finish を呼んでください。",
			});
			save();
			continue;
		}
		for (const call of reply.tool_calls) {
			let result: string;
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(call.function.arguments || "{}");
				const name = call.function.name;
				if (name === "read_doc")
					result = DOCS[String(args.name)]?.() ?? "その資料は無い";
				else if (name === "list_seeds") {
					const tpl = String(args.template) as Template;
					if (!TEMPLATES.includes(tpl))
						throw new Error(`template は ${TEMPLATES.join(" / ")}`);
					const from = Number(args.from ?? 1);
					const count = Math.min(20, Math.max(1, Number(args.count ?? 10)));
					result = Array.from({ length: count }, (_, i) =>
						describeSeed(tpl, from + i),
					).join("\n");
				} else if (name === "select_seed") {
					const tpl = String(args.template) as Template;
					if (!TEMPLATES.includes(tpl))
						throw new Error(`template は ${TEMPLATES.join(" / ")}`);
					session.template = tpl;
					session.seed = Number(args.seed);
					session.ops = [];
					song = rebuild(session);
					shelf([
						"step",
						dir,
						"--did",
						`${tpl} の seed ${session.seed} を土台に選んだ`,
						"--saw",
						describeSeed(tpl, session.seed),
						"--why",
						String(args.why ?? ""),
					]);
					result = `選んだ: ${describeSeed(tpl, session.seed)}\nトラック: ${[...(song?.tracks.values() ?? [])].map((t) => `t${t.index}=${t.inst}(${t.slot ?? "合いの手"})`).join(" ")}`;
				} else if (name === "read_bars" && args.seed !== undefined) {
					const tpl = String(
						args.template ?? session.template ?? "",
					) as Template;
					if (!TEMPLATES.includes(tpl))
						throw new Error(`template は ${TEMPLATES.join(" / ")}`);
					result = readBars(
						generate(tpl, Number(args.seed)),
						args.from,
						args.to,
						args.tracks,
					);
				} else if (!song)
					throw new Error(
						"先に select_seed で土台を選ぶ（候補を読むだけなら read_bars に template と seed を付ける）",
					);
				else if (name === "read_bars")
					result = readBars(song, args.from, args.to, args.tracks);
				else if (name === "list_rubs")
					result = listRubs(song, args.from, args.to, args.all);
				else if (EDIT_OPS.has(name)) {
					const op = { name, args };
					result = applyOp(song, op);
					session.ops.push(op);
					shelf([
						"step",
						dir,
						"--did",
						`${name} ${JSON.stringify({ ...args, why: undefined })}: ${result}`,
						"--why",
						String(args.why ?? ""),
					]);
				} else if (name === "note") {
					shelf([
						"step",
						dir,
						"--did",
						String(args.did ?? ""),
						...(args.saw ? ["--saw", String(args.saw)] : []),
						...(args.why ? ["--why", String(args.why)] : []),
					]);
					result = "記録した";
				} else if (name === "finish") {
					const mml = toMML(song);
					writeFileSync(join(dir, "song.mml"), mml);
					session.finished = {
						title: String(args.title),
						summary: String(args.summary),
						self_review: String(args.self_review),
					};
					result = `書き出した（${song.bars}小節・${mml.length}文字）`;
				} else result = `知らない道具: ${name}`;
			} catch (e) {
				result = `エラー: ${(e as Error).message}`;
			}
			console.log(
				`  ${call.function.name}(${call.function.arguments.slice(0, 160)}) → ${result.split("\n")[0]?.slice(0, 160)}`,
			);
			log(
				`- \`${call.function.name}\` ${call.function.arguments}\n  → ${result.split("\n").slice(0, 3).join(" / ").slice(0, 400)}`,
			);
			session.messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: result,
			});
		}
		save();
	}
	if (!session.finished)
		console.log(
			`--max-turns に達した。続けるなら: npx tsx scripts/compose/strata-compose.ts continue "${dir}" --say "続けて"`,
		);
	else await publish(dir, session);
};

const publish = async (dir: string, session: Session): Promise<void> => {
	const song = rebuild(session);
	if (!song || !session.finished) return;
	writeFileSync(join(dir, "song.mml"), toMML(song));
	// トラックの出どころ: write_bar で書いた音が半分以上なら手書き（Strata）、それ以外は自動作曲の出力
	const written = new Map<number, number>();
	for (const op of session.ops)
		if (op.name === "write_bar")
			for (const t of parseTracks(song, op.args.tracks ?? [0]))
				written.set(
					t,
					(written.get(t) ?? 0) +
						String(op.args.notes).split(/\s+/).filter(Boolean).length,
				);
	const hand: number[] = [];
	const auto: number[] = [];
	for (const t of song.tracks.values()) {
		if (!t.notes.length) continue;
		((written.get(t.index) ?? 0) * 2 >= t.notes.length ? hand : auto).push(
			t.index,
		);
	}
	const origin = [
		auto.length ? `${auto.join(",")}=auto` : "",
		hand.length ? `${hand.join(",")}=hand` : "",
	]
		.filter(Boolean)
		.join(";");
	const f = session.finished;
	const notes = join(dir, "notes.md");
	writeFileSync(
		notes,
		`${readFileSync(notes, "utf8").trimEnd()}\n\n## Strata の仕上げ（${f.title}）\n\n- 一言: ${f.summary}\n- 土台: ${session.template} seed ${session.seed}、手直しの操作 ${session.ops.length} 件（strata-session.json の ops。\`strata-compose.ts rebuild\` で当て直せる）\n- 自己評価: ${f.self_review}\n`,
	);
	console.log(
		shelf([
			"publish",
			dir,
			join(dir, "song.mml"),
			"--origin",
			origin,
			"--key",
			song.key,
			"--summary",
			f.summary,
		]),
	);
};

// ---------------------------------------------------------------- 入口

const main = async (): Promise<void> => {
	const [cmd, target] = process.argv.slice(2);
	const opt = (name: string): string | undefined => {
		const i = process.argv.indexOf(`--${name}`);
		return i >= 0 ? process.argv[i + 1] : undefined;
	};
	const health = await fetch(`${STRATA_URL.replace(/\/v1$/, "")}/health`)
		.then((r) => r.json())
		.catch(() => undefined);
	if (cmd !== "rebuild" && !health?.loaded)
		throw new Error(
			`Strata が応答しない（${STRATA_URL}）。strata launch --model iq2_xs --yes --no-tui で起動する`,
		);
	if (cmd === "new") {
		const title =
			opt("title") ?? pickOreName(existsSync(SHELF) ? readdirSync(SHELF) : []);
		const out = shelf(["new", "--title", title, "--model", MODEL_LABEL])
			.split("\n")
			.map((l) => l.trim());
		const dir = out.find(
			(l) => l.startsWith(SHELF) && existsSync(l) && !l.endsWith(".html"),
		);
		if (!dir) throw new Error(`棚のフォルダが分からない: ${out.join(" / ")}`);
		const request = `${
			opt("request") ??
			"自動作曲機能を土台に界隈曲を1曲作ってください。自分で品質を評価し、納得できるところまで手を入れてから finish してください。"
		}\n\n曲名は「${title}」です。finish の title にはこれをそのまま書いてください。`;
		const session: Session = {
			messages: [
				{ role: "system", content: SYSTEM },
				{ role: "user", content: request },
			],
			ops: [],
		};
		console.log(dir);
		await run(dir, session, Number(opt("max-turns") ?? 80));
	} else if (cmd === "continue" && target) {
		const dir = findDir(target);
		const session = JSON.parse(
			readFileSync(join(dir, "strata-session.json"), "utf8"),
		) as Session;
		session.finished = undefined;
		// 指示文はスクリプトの今の版にする（会話の途中で注意を足したとき）
		if (session.messages[0]?.role === "system")
			session.messages[0].content = SYSTEM;
		session.messages.push({
			role: "user",
			content: opt("say") ?? "続けてください。",
		});
		await run(dir, session, Number(opt("max-turns") ?? 40));
	} else if (cmd === "rebuild" && target) {
		const dir = findDir(target);
		const session = JSON.parse(
			readFileSync(join(dir, "strata-session.json"), "utf8"),
		) as Session;
		const song = rebuild(session);
		if (!song) throw new Error("土台の seed が決まっていない");
		writeFileSync(join(dir, "song.mml"), toMML(song));
		console.log(join(dir, "song.mml"));
	} else {
		console.log(
			"使い方: strata-compose.ts new [--title <曲名>] | continue <曲> --say <指示> | rebuild <曲>",
		);
		process.exitCode = 1;
	}
};
void main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
