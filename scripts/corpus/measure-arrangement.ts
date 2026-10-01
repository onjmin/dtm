/**
 * 参考コーパスの**旋律の外側**（テンポ・調・和声・ベース・ドラム・音色・構成・リフ）を実測し、
 * 自動作曲（`composeSong`）の出力を同じ物差しで測って並べる。
 *
 *   npx tsx scripts/corpus/measure-arrangement.ts --dir "C:/Users/frgk2/Music/_own/自作/界隈曲" --out tmp/kaiwai
 *
 *   # 生成側だけ（テンプレート名 / all）。--count 本を --seed から連番で引く
 *   npx tsx scripts/corpus/measure-arrangement.ts --generate game_loop --count 40 --seed 1 --out tmp/kaiwai
 *   # 生成側を省く / 採否の一覧を出す
 *   npx tsx scripts/corpus/measure-arrangement.ts --dir ... --no-generate --list
 *   # 未完成の耳コピを対照から外す（小節数・非ドラム ch 数の下限。既定は絞らない）
 *   npx tsx scripts/corpus/measure-arrangement.ts --dir ... --generate kaiwai --min-bars 40 --min-channels 6 --out tmp/kaiwai
 *   npx tsx scripts/corpus/measure-arrangement.ts --dir ... --generate kaiwai_skeleton --count 40 --seed 1 --min-bars 40 --min-channels 6 --out tmp/kaiwai-skel
 *   npx tsx scripts/corpus/measure-arrangement.ts --dir ... --generate kaiwai_splice --count 40 --seed 1 --min-bars 40 --min-channels 6 --out tmp/kaiwai-splice
 *
 * 旋律の分布は `calibrate-corpus.ts` が較正済みで、**旋律を合わせても界隈曲に聞こえない**ことが
 * `docs/handover-compose.md` で確定している。ここは旋律以外を測るためのもので、SMF の読み込み・
 * 量子化（1小節=192、16分=12）・調の推定・主旋律の判定は calibrate-corpus.ts の同じ関数を通す。
 *
 * 生成物は `scripts/compose/export-samples.ts` と同じ手順で .mid（`exportMIDI`）にしてから、
 * コーパスと**同じ関数**で読む。生成器の内部表現から直接測ると物差しがずれる。
 *
 * 出力: `<out>/corpus-profile.{md,json}`・`<out>/gen-<template>.json`・`<out>/gap.md`。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
	GM_INSTRUMENT_NAMES,
	programOfInstrumentName,
} from "../../src/audio/audio-config";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import { buildChordPlacements } from "../../src/chord/chords";
import { composeSong } from "../../src/compose/compose";
import type { MetricNote } from "../../src/compose/compose-metrics";
import { STRUCTURE_TEMPLATES } from "../../src/compose/compose-sections";
import {
	DRUM_PATTERNS,
	resolveDrumPattern,
} from "../../src/instruments/drum-config";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { exportMIDI } from "../../src/io/midi-io";
import type { Note } from "../../src/types";
import {
	channelNotes,
	estimateKey,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";
import { loadSkeletons, localExperimentData } from "./skeleton-data";

const KAIWAI_SKELETONS = loadSkeletons();
const LOCAL = localExperimentData();

const BAR = 192;
const HALF = BAR / 2;
const GRID = BAR / 16;
const EIGHTH = BAR / 8;

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const DEBUG = argv.includes("--debug");

// ============================================================
// コーパスの収集と重複除去
// ============================================================

/**
 * 派生版の名前。曲名フォルダの中に「ピアノだけ」「ドラムだけ」「サビだけ」等の抜き出しが
 * 混ざっているので、パス（フォルダ名＋ファイル名）にこれらを含むものは落とす。
 * `_dram` は `_drum` の綴り違い、`.inm` と `midiSplit` は実在した派生名。
 */
const DERIVED =
	/gomi|cookie|piano|muted|_base|_drum|_dram|_other|arpeggio|sabi|imported|short|omit|mod|midisplit|\.inm/i;
/** `History/`（自動保存）と `他作/`（所有者以外の耳コピ）は丸ごと外す。 */
const EXCLUDED_DIR = /(^|[\\/])(History|他作)([\\/]|$)/;
/** 曲名フォルダの下にある日付・媒体フォルダ。曲の単位ではないので畳む。 */
const COLLAPSIBLE_DIR = /^(\d{6}|Media|full)$/;
/** imgur 由来の7文字 id（英字を含む。7桁の日付 `2204132` と区別する）。作者フォルダ直下にあるときはそれ自体が1曲。 */
const IMGUR_ID = /^(?=.*[A-Za-z])[A-Za-z0-9]{7}$/;

type Candidate = {
	rel: string;
	songKey: string;
	buf: Buffer;
	notes: number;
	/** 非ドラムch数＋ドラムの有無。1ch に全部まとまったダンプは編成を測れない。 */
	channels: number;
};

const walkMid = (dir: string, out: string[] = []): string[] => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walkMid(full, out);
		else if (entry.name.toLowerCase().endsWith(".mid")) out.push(full);
	}
	return out;
};

const songKeyOf = (rel: string): string => {
	const parts = rel.split(/[\\/]/);
	const file = parts.pop() ?? "";
	while (parts.length > 1 && COLLAPSIBLE_DIR.test(parts[parts.length - 1]))
		parts.pop();
	const stem = file.replace(/\.mid$/i, "");
	if (parts.length === 1 && IMGUR_ID.test(stem)) parts.push(stem);
	return parts.join("/");
};

const countNotes = (buf: Buffer): { notes: number; channels: number } => {
	let notes = 0;
	const chs = new Set<number>();
	for (const track of parseSmf(buf).tracks)
		for (const e of track)
			if (e.noteOn) {
				notes++;
				chs.add(e.channel ?? 0);
			}
	return { notes, channels: chs.size };
};

/**
 * 曲名フォルダごとに1本。派生名と History を除き、残りが複数なら最も音数が多いもの。
 * ただし 1ch にまとまったダンプ（編成を測れない）は、他に候補があれば後回しにする。
 * 曲名フォルダの下にさらに切られたフォルダ（マッシュアップ・別歌メロ版）は親の曲へ畳む。
 */
export const collectSongs = (
	dir: string,
): { picked: Candidate[]; dropped: { rel: string; why: string }[] } => {
	const dropped: { rel: string; why: string }[] = [];
	const bySong = new Map<string, Candidate[]>();
	const files = walkMid(dir).sort();
	/** 直下に（imgur id 以外の）.mid を持つフォルダ＝曲名フォルダ。 */
	const songDirs = new Set<string>();
	for (const full of files) {
		const rel = relative(dir, full);
		if (EXCLUDED_DIR.test(rel) || DERIVED.test(rel)) continue;
		const parts = rel.split(/[\\/]/);
		const stem = (parts.pop() ?? "").replace(/\.mid$/i, "");
		if (!IMGUR_ID.test(stem)) songDirs.add(parts.join("/"));
	}
	for (const full of files) {
		const rel = relative(dir, full);
		if (EXCLUDED_DIR.test(rel)) {
			dropped.push({ rel, why: "History/他作" });
			continue;
		}
		if (DERIVED.test(rel)) {
			dropped.push({ rel, why: "派生名" });
			continue;
		}
		const buf = readFileSync(full);
		let counted = { notes: 0, channels: 0 };
		try {
			counted = countNotes(buf);
		} catch (e) {
			dropped.push({ rel, why: `読めない: ${(e as Error).message}` });
			continue;
		}
		let songKey = songKeyOf(rel);
		const parts = songKey.split("/");
		for (let i = 1; i < parts.length; i++) {
			const ancestor = parts.slice(0, i).join("/");
			if (songDirs.has(ancestor)) {
				songKey = ancestor;
				break;
			}
		}
		const list = bySong.get(songKey) ?? [];
		list.push({ rel, songKey, buf, ...counted });
		bySong.set(songKey, list);
	}
	const picked: Candidate[] = [];
	for (const list of bySong.values()) {
		list.sort((a, b) => {
			const ma = a.channels >= 2 ? 1 : 0;
			const mb = b.channels >= 2 ? 1 : 0;
			return mb - ma || b.notes - a.notes;
		});
		if (list[0].channels < 2) {
			dropped.push({
				rel: list[0].rel,
				why: "1ch にまとまったダンプ（編成を測れない）",
			});
			continue;
		}
		picked.push(list[0]);
		for (const c of list.slice(1))
			dropped.push({
				rel: c.rel,
				why: `同じ曲の別版（${list[0].rel} を採用）`,
			});
	}
	picked.sort((a, b) => a.songKey.localeCompare(b.songKey, "ja"));
	return { picked, dropped };
};

// ============================================================
// 特徴量
// ============================================================

type ChordType = "major" | "minor" | "power" | "dim" | "aug" | "sus" | "other";
type Chord = { root: number; type: ChordType; score: number } | null;

export type ArrangementFeatures = {
	name: string;
	// テンポ・拍子・長さ
	bpm: number;
	tempoChanges: number;
	timeSig: string;
	bars: number;
	seconds: number;
	// 調
	minor: boolean;
	keyName: string;
	chromaticDur: number;
	// チャンネル
	channels: number;
	programs: string[];
	simultaneousMedian: number;
	melodyProgram: string;
	bassProgram: string;
	// 主旋律
	hasMelody: boolean;
	/** 音域の関門が効いた（ベース音域の候補のほうが長く鳴っていたが外した）。 */
	melodyGuardHit: boolean;
	melIntroBars: number;
	melSixteenth: number;
	melRepeat: number;
	melRange: number;
	melNotesPerBar: number;
	melRest: number;
	// ベース
	hasBass: boolean;
	bassNotesPerBar: number;
	bassOctaveAlt: number;
	bassSemitone: number;
	bassOnEighth: number;
	bassOffEighth: number;
	bassRepeat: number;
	bassRegister: number;
	bassMedianDur: number;
	bassBarIdentical: number;
	// 和声
	chordBars: number;
	minorChord: number;
	dimChord: number;
	augChord: number;
	susChord: number;
	powerChord: number;
	otherChord: number;
	chordChangesPerBar: number;
	halfBarChange: number;
	rootFlat2: number;
	rootFlat5: number;
	rootFlat6: number;
	rootFlat7: number;
	rootNonDiatonic: number;
	parallelShift: number;
	rootHistogram: number[];
	// ドラム
	hasDrums: boolean;
	drumBarRatio: number;
	hatPerBar: number;
	hatOffEighth: number;
	kickPerBar: number;
	kickFour: number;
	snare24: number;
	backbeat24: number;
	snarePerBar: number;
	openHatOffbeat: number;
	clap: boolean;
	tomPerBar: number;
	crashPerBar: number;
	percPerBar: number;
	drumPitches: number[];
	drumRolesInferred: string[];
	// 反復
	melBlockRhythm: number;
	melBlockContour: number;
	bassBlockRhythm: number;
	bassBlockContour: number;
	melBarIdentical: number;
	melBarIdentical4: number;
	bassBarIdentical4: number;
	// アルペジオ/リフ
	arpBarRatio: number;
	arpChannels: number;
	/** 生成物だけ: コード進行の文字列から出した真の値（推定器の検算用）。 */
	truthHalfBarChange?: number;
	truthChangesPerBar?: number;
};

const median = (xs: number[]): number => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);
const barOf = (step: number): number => Math.floor(step / BAR);

/** toMonophonic の下声版（ベース用。同時発音は低いほうを採る）。 */
const toMonophonicLow = (ns: MetricNote[]): MetricNote[] => {
	const sorted = [...ns].sort((a, b) => a.startStep - b.startStep);
	const out: MetricNote[] = [];
	for (const n of sorted) {
		const prev = out[out.length - 1];
		if (prev && prev.startStep === n.startStep) {
			if (n.pitchSemi < prev.pitchSemi) out[out.length - 1] = { ...n };
			continue;
		}
		if (prev && prev.startStep + prev.durationSteps > n.startStep)
			prev.durationSteps = n.startStep - prev.startStep;
		out.push({ ...n });
	}
	return out.filter((n) => n.durationSteps > 0);
};

const stackedRatio = (ns: MetricNote[]): number => {
	const starts = new Map<number, number>();
	for (const n of ns)
		starts.set(n.startStep, (starts.get(n.startStep) ?? 0) + 1);
	let stacked = 0;
	for (const c of starts.values()) if (c > 1) stacked += c;
	return ratio(stacked, ns.length);
};

const CHORD_TEMPLATES: { type: ChordType; pcs: number[] }[] = [
	{ type: "major", pcs: [0, 4, 7] },
	{ type: "minor", pcs: [0, 3, 7] },
	{ type: "sus", pcs: [0, 5, 7] },
	{ type: "sus", pcs: [0, 2, 7] },
	{ type: "dim", pcs: [0, 3, 6] },
	{ type: "aug", pcs: [0, 4, 8] },
];

/**
 * ピッチクラスの重み（音価）から和音を推定する。三和音の型に載る重みの割合が最大のもの。
 * 7th は「型の外」と数えるので、しきい値は 0.55（Cm7 の4音均等なら 0.75 で通る）。
 * ベース音が根音と一致すれば +0.1（Cm7 と E♭ の同点を割る）。
 *
 * **3度が無い和音は power にする。** 界隈曲の伴奏は根音＋5度（＋オクターブ）だけのことが多く、
 * そのままだと対旋律の経過音1つで sus2/sus4 に化ける（初版で sus が小節の 35% を占めた）。
 * 根音と5度の重みに対して長短どちらの3度も 12% 未満なら、3度の無い和音として数える。
 */
const estimateChord = (w: number[], bassPc: number | null): Chord => {
	const total = w.reduce((a, b) => a + b, 0);
	if (total <= 0) return null;
	let best: { root: number; type: ChordType; score: number } | null = null;
	for (let root = 0; root < 12; root++) {
		for (const t of CHORD_TEMPLATES) {
			let inside = 0;
			for (const pc of t.pcs) inside += w[(root + pc) % 12];
			let score = inside / total;
			if (bassPc === root) score += 0.1;
			if (!best || score > best.score + 1e-9)
				best = { root, type: t.type, score };
		}
	}
	if (!best) return null;
	if (best.score < 0.55)
		return { root: best.root, type: "other", score: best.score };
	if (best.type === "major" || best.type === "minor" || best.type === "sus") {
		const r = best.root;
		const thirds = w[(r + 3) % 12] + w[(r + 4) % 12];
		const frame = w[r] + w[(r + 7) % 12];
		if (frame > 0 && thirds < frame * 0.12) return { ...best, type: "power" };
	}
	return best;
};

/**
 * 和音が「変わった」とみなす条件: 根音が変わる、または長⇄短が入れ替わる。
 * sus/power/other は3度の有無の揺れ（伴奏の奏法や経過音）なので、同じ根音なら同じ和音として扱う。
 */
const sameChord = (a: Chord, b: Chord): boolean => {
	if (!a || !b) return false;
	if (a.root !== b.root) return false;
	const q = (t: ChordType): string =>
		t === "major" || t === "minor" || t === "dim" || t === "aug" ? t : "open";
	const qa = q(a.type);
	const qb = q(b.type);
	return qa === qb || qa === "open" || qb === "open";
};

/** 8小節ブロックどうしの類似（リズム＝小節ごとの発音位置の Jaccard、輪郭＝音程の符号列の一致率）。 */
const blockSimilarity = (
	mono: MetricNote[],
	fromBar: number,
	toBar: number,
): { rhythm: number; contour: number } => {
	const blocks: { rhythm: Set<string>[]; contour: number[] }[] = [];
	for (let b = fromBar; b + 8 <= toBar + 1; b += 8) {
		const rhythm: Set<string>[] = [];
		for (let i = 0; i < 8; i++) rhythm.push(new Set());
		const inBlock = mono.filter(
			(n) => barOf(n.startStep) >= b && barOf(n.startStep) < b + 8,
		);
		for (const n of inBlock)
			rhythm[barOf(n.startStep) - b].add(String(n.startStep % BAR));
		const contour: number[] = [];
		for (let i = 1; i < inBlock.length; i++)
			contour.push(Math.sign(inBlock[i].pitchSemi - inBlock[i - 1].pitchSemi));
		blocks.push({ rhythm, contour });
	}
	if (blocks.length < 2) return { rhythm: 0, contour: 0 };
	const jaccard = (a: Set<string>, b: Set<string>): number => {
		if (a.size === 0 && b.size === 0) return 1;
		let inter = 0;
		for (const x of a) if (b.has(x)) inter++;
		return inter / (a.size + b.size - inter);
	};
	const rhythmMax: number[] = [];
	const contourMax: number[] = [];
	for (let i = 0; i < blocks.length; i++) {
		let bestR = 0;
		let bestC = 0;
		for (let j = 0; j < blocks.length; j++) {
			if (i === j) continue;
			let r = 0;
			for (let k = 0; k < 8; k++)
				r += jaccard(blocks[i].rhythm[k], blocks[j].rhythm[k]);
			r /= 8;
			const ca = blocks[i].contour;
			const cb = blocks[j].contour;
			let match = 0;
			for (let k = 0; k < Math.min(ca.length, cb.length); k++)
				if (ca[k] === cb[k]) match++;
			const c = ratio(match, Math.max(ca.length, cb.length));
			bestR = Math.max(bestR, r);
			bestC = Math.max(bestC, c);
		}
		rhythmMax.push(bestR);
		contourMax.push(bestC);
	}
	return { rhythm: median(rhythmMax), contour: median(contourMax) };
};

/** `lag` 小節前と中身（相対位置＋音高＋音価）が完全に同じ小節の割合。 */
const identicalBarRatio = (mono: MetricNote[], lag: number): number => {
	if (mono.length === 0) return 0;
	const sig = new Map<number, string[]>();
	for (const n of mono) {
		const b = barOf(n.startStep);
		const list = sig.get(b) ?? [];
		list.push(`${n.startStep % BAR}:${n.pitchSemi}:${n.durationSteps}`);
		sig.set(b, list);
	}
	let same = 0;
	let pairs = 0;
	for (const [b, list] of sig) {
		const prev = sig.get(b - lag);
		if (!prev) continue;
		pairs++;
		if (list.join("|") === prev.join("|")) same++;
	}
	return ratio(same, pairs);
};

const gmName = (program: number | undefined): string =>
	program === undefined
		? "(none)"
		: `${program}:${GM_INSTRUMENT_NAMES[program] ?? "?"}`;

const KICK = new Set([35, 36]);
const SNARE = new Set([38, 40]);
const HAT = new Set([42, 44, 46]);
const TOM = new Set([41, 43, 45, 47, 48, 50]);

export type DrumRole =
	| "kick"
	| "snare"
	| "hat"
	| "tom"
	| "crash"
	| "clap"
	| "perc";

/**
 * ドラムの音番号を役割へ写す。GM の番号はそのまま、GM 外（コーパスは 60/61/62/68 のボンゴ・
 * コンガを主要キットとして使う曲がある。PxTone/Domino のキット由来）は**置かれ方**から推定する:
 * 1小節に6発以上なら hat、2・4拍に半分以上あれば snare、1・3拍に半分以上あれば kick。
 */
export const inferDrumRoles = (
	drums: { step: number; pitch: number }[],
	bars: number,
): Map<number, DrumRole> => {
	const byPitch = new Map<number, number[]>();
	for (const d of drums) {
		const list = byPitch.get(d.pitch) ?? [];
		list.push(d.step % BAR);
		byPitch.set(d.pitch, list);
	}
	const roles = new Map<number, DrumRole>();
	for (const [pitch, positions] of byPitch) {
		if (KICK.has(pitch)) roles.set(pitch, "kick");
		else if (SNARE.has(pitch)) roles.set(pitch, "snare");
		else if (HAT.has(pitch)) roles.set(pitch, "hat");
		else if (TOM.has(pitch)) roles.set(pitch, "tom");
		else if (CRASH.has(pitch)) roles.set(pitch, "crash");
		else if (pitch === 39) roles.set(pitch, "clap");
		else {
			const perBar = positions.length / Math.max(1, bars);
			const on = (at: number[]): number =>
				ratio(positions.filter((p) => at.includes(p)).length, positions.length);
			if (perBar >= 6) roles.set(pitch, "hat");
			else if (on([48, 144]) >= 0.5) roles.set(pitch, "snare");
			else if (on([0, 96]) >= 0.5) roles.set(pitch, "kick");
			else roles.set(pitch, "perc");
		}
	}
	return roles;
};
const CRASH = new Set([49, 52, 55, 57]);

export const featuresOf = (
	buf: Buffer,
	name: string,
): ArrangementFeatures | null => {
	const midi = parseSmf(buf);
	const ticksPerStep = midi.division / 48;

	// --- テンポ・拍子・プログラム・ドラム（channelNotes が捨てるもの）を自前で拾う ---
	const tempos: { tick: number; us: number }[] = [];
	let timeSig = "4/4";
	let sawTimeSig = false;
	const programs = new Map<number, number>();
	const drumsRaw: { step: number; pitch: number }[] = [];
	let earliestNonDrum = Number.POSITIVE_INFINITY;
	let earliestDrum = Number.POSITIVE_INFINITY;
	let maxTick = 0;
	for (const events of midi.tracks) {
		let tick = 0;
		for (const e of events) {
			tick += e.delta;
			maxTick = Math.max(maxTick, tick);
			if (e.setTempo)
				tempos.push({ tick, us: e.setTempo.microsecondsPerQuarter });
			if (e.timeSignature && !sawTimeSig) {
				sawTimeSig = true;
				timeSig = `${e.timeSignature.numerator}/${e.timeSignature.denominator}`;
			}
			const ch = e.channel ?? 0;
			if (e.programChange && !programs.has(ch))
				programs.set(ch, e.programChange.program);
			if (e.noteOn) {
				const step = Math.round(tick / ticksPerStep);
				if (ch === 9) {
					drumsRaw.push({ step, pitch: e.noteOn.noteNumber });
					earliestDrum = Math.min(earliestDrum, step);
				} else earliestNonDrum = Math.min(earliestNonDrum, step);
			}
		}
	}
	tempos.sort((a, b) => a.tick - b.tick);
	const bpm = tempos.length > 0 ? 6e7 / tempos[0].us : 120;
	let tempoChanges = 0;
	for (let i = 1; i < tempos.length; i++)
		if (Math.abs(6e7 / tempos[i].us - 6e7 / tempos[i - 1].us) >= 1)
			tempoChanges++;
	let seconds = 0;
	{
		let us = 500000;
		let lastTick = 0;
		for (const t of tempos) {
			seconds += ((t.tick - lastTick) * us) / midi.division / 1e6;
			lastTick = t.tick;
			us = t.us;
		}
		seconds += ((maxTick - lastTick) * us) / midi.division / 1e6;
	}

	const byChannel = channelNotes(midi);
	if (byChannel.size === 0) return null;
	// channelNotes は非ドラムの最初の小節まで詰めている。ドラムも同じだけ詰め、
	// ドラムが先に始まる曲では詰め幅をドラムの頭へ戻す。
	const nonDrumShift =
		Number.isFinite(earliestNonDrum) && earliestNonDrum >= BAR
			? barOf(earliestNonDrum) * BAR
			: 0;
	const earliest = Math.min(earliestNonDrum, earliestDrum);
	const shift =
		Number.isFinite(earliest) && earliest >= BAR ? barOf(earliest) * BAR : 0;
	const quantized = new Map<number, MetricNote[]>();
	for (const [ch, ns] of byChannel) {
		if (ns.length < 8) continue;
		quantized.set(
			ch,
			quantize(
				ns.map((n) => ({
					...n,
					startStep: n.startStep + nonDrumShift - shift,
				})),
			),
		);
	}
	const drums = drumsRaw.map((d) => ({
		step: Math.round((d.step - shift) / GRID) * GRID,
		pitch: d.pitch,
	}));

	let maxEnd = 0;
	for (const ns of quantized.values())
		for (const n of ns)
			maxEnd = Math.max(maxEnd, n.startStep + n.durationSteps);
	for (const d of drums) maxEnd = Math.max(maxEnd, d.step + 1);
	const bars = Math.max(1, Math.ceil(maxEnd / BAR));

	// --- 調（全非ドラムch・音価重み） ---
	const all: MetricNote[] = [];
	for (const ns of quantized.values()) all.push(...ns);
	if (all.length === 0) return null;
	const key = estimateKey(all);
	const DIATONIC_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
	let outside = 0;
	let weight = 0;
	for (const n of all) {
		const rel = (((n.pitchSemi - key.tonic) % 12) + 12) % 12;
		const inMajor = key.minor ? (rel + 9) % 12 : rel;
		weight += n.durationSteps;
		if (!DIATONIC_MAJOR.has(inMajor)) outside += n.durationSteps;
	}
	const NAMES = [
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

	// --- 同時に鳴っている非ドラムch数（小節ごと）の中央値 ---
	const perBar = new Array<number>(bars).fill(0);
	for (const ns of quantized.values()) {
		const sounding = new Set<number>();
		for (const n of ns) {
			for (
				let b = barOf(n.startStep);
				b <= barOf(n.startStep + n.durationSteps - 1);
				b++
			)
				if (b < bars) sounding.add(b);
		}
		for (const b of sounding) perBar[b]++;
	}
	const simultaneousMedian = median(perBar.filter((c) => c > 0));

	// --- 主旋律（calibrate-corpus.ts と同じ選び方＋音域の関門） ---
	// 鳴っている時間が最長の候補を採るのは calibrate-corpus.ts と同じ。ただし**ベース音域
	// （音高中央値が C3=48 未満）の候補は、他に候補があれば外す**。生成物のベースは休まず鳴り、
	// オクターブ交互もしないので、この関門が無いと 3 テンプレートとも半数近くでベース ch が
	// 「主旋律」になり、押し出されたパッドが「ベース」として測られていた（音高中央値 62）。
	let melodyCh = -1;
	let melody: MetricNote[] = [];
	let bestCoverage = -1;
	const plausible = [...byChannel].filter(([, ns]) => isPlausibleMelody(ns));
	const medianOf = (ns: MetricNote[]): number =>
		median(ns.map((n) => n.pitchSemi));
	const upper = plausible.filter(([, ns]) => medianOf(ns) >= 48);
	for (const [ch, ns] of upper.length > 0 ? upper : plausible) {
		const coverage = ns.reduce((s, n) => s + n.durationSteps, 0);
		if (coverage > bestCoverage) {
			bestCoverage = coverage;
			melodyCh = ch;
			melody = toMonophonic(quantized.get(ch) ?? quantize(ns));
		}
	}
	const melodyGuardHit =
		upper.length > 0 && upper.length < plausible.length
			? plausible.some(
					([ch, ns]) =>
						medianOf(ns) < 48 &&
						ns.reduce((s, n) => s + n.durationSteps, 0) > bestCoverage &&
						ch !== melodyCh,
				)
			: false;
	const hasMelody = melody.length > 0;
	let melIntroBars = 0;
	let melSixteenth = 0;
	let melRepeat = 0;
	let melRange = 0;
	let melNotesPerBar = 0;
	let melRest = 0;
	let melBlock = { rhythm: 0, contour: 0 };
	let melBarIdentical = 0;
	let melBarIdentical4 = 0;
	if (hasMelody) {
		melIntroBars = barOf(melody[0].startStep);
		const lastBar = barOf(melody[melody.length - 1].startStep);
		const span = lastBar - melIntroBars + 1;
		let sixteenth = 0;
		let repeat = 0;
		for (let i = 0; i + 1 < melody.length; i++) {
			if (melody[i + 1].startStep - melody[i].startStep <= GRID) sixteenth++;
			if (melody[i + 1].pitchSemi === melody[i].pitchSemi) repeat++;
		}
		melSixteenth = ratio(sixteenth, melody.length - 1);
		melRepeat = ratio(repeat, melody.length - 1);
		const ps = melody.map((n) => n.pitchSemi);
		melRange = Math.max(...ps) - Math.min(...ps);
		melNotesPerBar = melody.length / span;
		const played = melody.reduce((s, n) => s + n.durationSteps, 0);
		melRest = Math.max(0, 1 - played / (span * BAR));
		melBlock = blockSimilarity(melody, melIntroBars, lastBar);
		melBarIdentical = identicalBarRatio(melody, 1);
		melBarIdentical4 = identicalBarRatio(melody, 4);
	}

	// --- ベース（音高中央値が最も低く、被覆が3割以上。和音を積んだchは後回し） ---
	let bassCh = -1;
	let bassMono: MetricNote[] = [];
	{
		let best: { ch: number; med: number; stacked: number } | null = null;
		for (const [ch, ns] of quantized) {
			if (ch === melodyCh) continue;
			const covered = new Set(ns.map((n) => barOf(n.startStep))).size;
			if (covered < bars * 0.3) continue;
			const med = median(ns.map((n) => n.pitchSemi));
			const stacked = stackedRatio(ns) >= 0.5 ? 1 : 0;
			if (
				!best ||
				stacked < best.stacked ||
				(stacked === best.stacked && med < best.med)
			)
				best = { ch, med, stacked };
		}
		if (best) {
			bassCh = best.ch;
			bassMono = toMonophonicLow(quantized.get(best.ch) ?? []);
		}
	}
	const hasBass = bassMono.length > 0;
	let bassNotesPerBar = 0;
	let bassOctaveAlt = 0;
	let bassSemitone = 0;
	let bassOnEighth = 0;
	let bassOffEighth = 0;
	let bassRepeat = 0;
	let bassRegister = 0;
	let bassMedianDur = 0;
	let bassBarIdentical = 0;
	let bassBarIdentical4 = 0;
	let bassBlock = { rhythm: 0, contour: 0 };
	if (hasBass) {
		const covered = new Set(bassMono.map((n) => barOf(n.startStep)));
		bassNotesPerBar = bassMono.length / covered.size;
		let oct = 0;
		let semi = 0;
		let rep = 0;
		for (let i = 1; i < bassMono.length; i++) {
			const iv = Math.abs(bassMono[i].pitchSemi - bassMono[i - 1].pitchSemi);
			if (iv === 12) oct++;
			if (iv === 1) semi++;
			if (iv === 0) rep++;
		}
		bassOctaveAlt = ratio(oct, bassMono.length - 1);
		bassSemitone = ratio(semi, bassMono.length - 1);
		bassRepeat = ratio(rep, bassMono.length - 1);
		bassOnEighth = ratio(
			bassMono.filter((n) => n.startStep % EIGHTH === 0).length,
			bassMono.length,
		);
		bassOffEighth = 1 - bassOnEighth;
		bassRegister = median(bassMono.map((n) => n.pitchSemi));
		bassMedianDur = median(bassMono.map((n) => n.durationSteps));
		bassBarIdentical = identicalBarRatio(bassMono, 1);
		bassBarIdentical4 = identicalBarRatio(bassMono, 4);
		const first = barOf(bassMono[0].startStep);
		const last = barOf(bassMono[bassMono.length - 1].startStep);
		bassBlock = blockSimilarity(bassMono, first, last);
	}

	// --- 和声（小節・2拍ごとのピッチクラス重み → 和音） ---
	// 主旋律は3ch以上あるときは外す。経過音で和音の推定が小節ごとに揺れ、和音の変わる頻度が
	// 「旋律の動き」を測ってしまう（初版: 2拍で変わる小節 0.875）。
	const pcw: number[][] = [];
	const pcwHalf: number[][] = [];
	for (let b = 0; b < bars; b++) {
		pcw.push(new Array(12).fill(0));
		pcwHalf.push(new Array(12).fill(0), new Array(12).fill(0));
	}
	for (const [ch, ns] of quantized) {
		if (ch === melodyCh && quantized.size >= 3) continue;
		for (const n of ns) {
			const pc = ((n.pitchSemi % 12) + 12) % 12;
			const end = n.startStep + n.durationSteps;
			for (let h = Math.floor(n.startStep / HALF); h * HALF < end; h++) {
				if (h >= bars * 2) break;
				const overlap =
					Math.min(end, (h + 1) * HALF) - Math.max(n.startStep, h * HALF);
				pcwHalf[h][pc] += overlap;
				pcw[Math.floor(h / 2)][pc] += overlap;
			}
		}
	}
	const bassPcAt = (from: number, to: number): number | null => {
		const src = hasBass ? bassMono : all;
		let lowest: MetricNote | null = null;
		for (const n of src) {
			if (n.startStep < from || n.startStep >= to) continue;
			if (!lowest || n.pitchSemi < lowest.pitchSemi) lowest = n;
		}
		return lowest ? ((lowest.pitchSemi % 12) + 12) % 12 : null;
	};
	const chordsBar: Chord[] = [];
	for (let b = 0; b < bars; b++)
		chordsBar.push(estimateChord(pcw[b], bassPcAt(b * BAR, (b + 1) * BAR)));
	const chordsHalf: Chord[] = [];
	for (let h = 0; h < bars * 2; h++)
		chordsHalf.push(
			estimateChord(pcwHalf[h], bassPcAt(h * HALF, (h + 1) * HALF)),
		);
	const determined = chordsBar.filter((c): c is NonNullable<Chord> => !!c);
	const countType = (t: ChordType): number =>
		ratio(determined.filter((c) => c.type === t).length, determined.length);
	let changes = 0;
	let pairs = 0;
	let parallel = 0;
	for (let b = 1; b < bars; b++) {
		const a = chordsBar[b - 1];
		const c = chordsBar[b];
		if (!a || !c) continue;
		pairs++;
		if (sameChord(a, c)) continue;
		changes++;
		if (a.type !== "other" && a.type === c.type) {
			const d = (((c.root - a.root) % 12) + 12) % 12;
			if (d === 1 || d === 11 || d === 3 || d === 9) parallel++;
		}
	}
	let halfChanged = 0;
	let halfPairs = 0;
	for (let b = 0; b < bars; b++) {
		const a = chordsHalf[b * 2];
		const c = chordsHalf[b * 2 + 1];
		if (!a || !c) continue;
		halfPairs++;
		if (!sameChord(a, c)) halfChanged++;
	}
	const rootHistogram = new Array<number>(12).fill(0);
	for (const c of determined) {
		if (c.type === "other") continue;
		rootHistogram[(((c.root - key.tonic) % 12) + 12) % 12]++;
	}
	const named = determined.filter((c) => c.type !== "other").length;
	const rootRate = (interval: number): number =>
		ratio(rootHistogram[interval], named);
	const diatonicRoots = key.minor
		? new Set([0, 2, 3, 5, 7, 8, 10, 11])
		: new Set([0, 2, 4, 5, 7, 9, 11]);
	let nonDiatonic = 0;
	for (let i = 0; i < 12; i++)
		if (!diatonicRoots.has(i)) nonDiatonic += rootHistogram[i];

	// --- ドラム ---
	const drumBarSet = new Map<number, { step: number; pitch: number }[]>();
	for (const d of drums) {
		const b = barOf(d.step);
		if (b < 0) continue;
		const list = drumBarSet.get(b) ?? [];
		list.push({ step: d.step % BAR, pitch: d.pitch });
		drumBarSet.set(b, list);
	}
	const drumBars = [...drumBarSet.values()];
	const hasDrums = drumBars.length > 0;
	const roles = inferDrumRoles(drums, bars);
	const roleOf = (p: number): DrumRole => roles.get(p) ?? "perc";
	const perDrumBar = (role: DrumRole): number =>
		median(
			drumBars.map(
				(list) => list.filter((d) => roleOf(d.pitch) === role).length,
			),
		);
	const hats = drums.filter((d) => roleOf(d.pitch) === "hat");
	const opens = drums.filter((d) => d.pitch === 46);
	const hasAt = (
		list: { step: number; pitch: number }[],
		role: DrumRole[],
		at: number[],
	): boolean =>
		at.every((s) =>
			list.some((d) => role.includes(roleOf(d.pitch)) && d.step === s),
		);
	const drumPitchSet = new Set(drums.map((d) => d.pitch));
	const inferred = [...roles.entries()].filter(
		([p]) =>
			!KICK.has(p) &&
			!SNARE.has(p) &&
			!HAT.has(p) &&
			!TOM.has(p) &&
			!CRASH.has(p) &&
			p !== 39,
	);

	// --- アルペジオ/リフ（主旋律・ベース以外のchで、16分格子に1小節8音以上・和音構成音を往復） ---
	// 定義: その小節に始まる音が8個以上、同時発音が2割未満、ピッチクラスが4種以下、音域が2オクターブ以内、
	// 単旋律化した並びで上下の向きが2回以上変わる。
	const arpBars = new Set<number>();
	let arpChannels = 0;
	for (const [ch, ns] of quantized) {
		if (ch === melodyCh || ch === bassCh) continue;
		const byBar = new Map<number, MetricNote[]>();
		for (const n of ns) {
			const list = byBar.get(barOf(n.startStep)) ?? [];
			list.push(n);
			byBar.set(barOf(n.startStep), list);
		}
		let hit = 0;
		for (const [b, list] of byBar) {
			if (list.length < 8) continue;
			if (stackedRatio(list) >= 0.2) continue;
			const pcs = new Set(list.map((n) => ((n.pitchSemi % 12) + 12) % 12));
			if (pcs.size > 4 || pcs.size < 2) continue;
			const ps = list.map((n) => n.pitchSemi);
			if (Math.max(...ps) - Math.min(...ps) > 24) continue;
			const mono = toMonophonic(list);
			let turns = 0;
			let lastDir = 0;
			for (let i = 1; i < mono.length; i++) {
				const dir = Math.sign(mono[i].pitchSemi - mono[i - 1].pitchSemi);
				if (dir === 0) continue;
				if (lastDir !== 0 && dir !== lastDir) turns++;
				lastDir = dir;
			}
			if (turns < 2) continue;
			hit++;
			arpBars.add(b);
		}
		if (hit >= 4) arpChannels++;
	}

	const programList = [...quantized.keys()]
		.sort((a, b) => a - b)
		.map((ch) => `ch${ch}=${gmName(programs.get(ch))}`);

	if (DEBUG) {
		const show = (c: Chord): string =>
			c ? `${NAMES[c.root]}${c.type === "major" ? "" : c.type[0]}` : "-";
		console.log(
			`   ${name}: ${bars}小節 ${bpm.toFixed(1)}bpm ${NAMES[key.tonic]}${key.minor ? "m" : ""} ch=${[...quantized.keys()].join(",")} mel=ch${melodyCh} bass=ch${bassCh} drums=${drums.length}`,
		);
		console.log(
			`      和音(2拍) ${chordsHalf
				.slice(0, 16)
				.map((c, i) => (i % 2 ? show(c) : `| ${show(c)}`))
				.join(" ")}`,
		);
	}

	return {
		name,
		bpm: Math.round(bpm * 10) / 10,
		tempoChanges,
		timeSig,
		bars,
		seconds: Math.round(seconds),
		minor: key.minor,
		keyName: `${NAMES[key.tonic]}${key.minor ? "m" : ""}`,
		chromaticDur: ratio(outside, weight),
		channels: quantized.size,
		programs: programList,
		simultaneousMedian,
		melodyProgram: gmName(programs.get(melodyCh)),
		bassProgram: gmName(programs.get(bassCh)),
		hasMelody,
		melodyGuardHit,
		melIntroBars,
		melSixteenth,
		melRepeat,
		melRange,
		melNotesPerBar,
		melRest,
		hasBass,
		bassNotesPerBar,
		bassOctaveAlt,
		bassSemitone,
		bassOnEighth,
		bassOffEighth,
		bassRepeat,
		bassRegister,
		bassMedianDur,
		bassBarIdentical,
		chordBars: ratio(determined.length, bars),
		minorChord: countType("minor"),
		dimChord: countType("dim"),
		augChord: countType("aug"),
		susChord: countType("sus"),
		powerChord: countType("power"),
		otherChord: countType("other"),
		chordChangesPerBar: ratio(changes, pairs),
		halfBarChange: ratio(halfChanged, halfPairs),
		rootFlat2: rootRate(1),
		rootFlat5: rootRate(6),
		rootFlat6: rootRate(8),
		rootFlat7: rootRate(10),
		rootNonDiatonic: ratio(nonDiatonic, named),
		parallelShift: ratio(parallel, changes),
		rootHistogram,
		hasDrums,
		drumBarRatio: ratio(drumBars.length, bars),
		hatPerBar: perDrumBar("hat"),
		hatOffEighth: ratio(
			hats.filter((d) => d.step % EIGHTH !== 0).length,
			hats.length,
		),
		kickPerBar: perDrumBar("kick"),
		kickFour: ratio(
			drumBars.filter((list) => hasAt(list, ["kick"], [0, 48, 96, 144])).length,
			drumBars.length,
		),
		snare24: ratio(
			drumBars.filter((list) => hasAt(list, ["snare"], [48, 144])).length,
			drumBars.length,
		),
		backbeat24: ratio(
			drumBars.filter((list) => hasAt(list, ["snare", "clap"], [48, 144]))
				.length,
			drumBars.length,
		),
		snarePerBar: perDrumBar("snare"),
		openHatOffbeat: ratio(
			opens.filter((d) => d.step % 48 === 24).length,
			opens.length,
		),
		clap: drumPitchSet.has(39),
		tomPerBar: perDrumBar("tom"),
		crashPerBar: perDrumBar("crash"),
		percPerBar: perDrumBar("perc"),
		drumPitches: [...drumPitchSet].sort((a, b) => a - b),
		drumRolesInferred: inferred.map(([p, r]) => `${p}→${r}`),
		melBlockRhythm: melBlock.rhythm,
		melBlockContour: melBlock.contour,
		bassBlockRhythm: bassBlock.rhythm,
		bassBlockContour: bassBlock.contour,
		melBarIdentical,
		melBarIdentical4,
		bassBarIdentical4,
		arpBarRatio: ratio(arpBars.size, bars),
		arpChannels,
	};
};

// ============================================================
// 生成物を同じ物差しへ（export-samples.ts と同じ手順で .mid にしてから読む）
// ============================================================

const lcgRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

let nextId = 1;
const toNotes = (
	ns: {
		startStep: number;
		pitchUnits: number;
		durationSteps: number;
		velocity?: number;
	}[],
): Note[] =>
	ns.map((n) => ({
		id: nextId++,
		startStep: n.startStep,
		durationSteps: n.durationSteps,
		pitchUnits: n.pitchUnits as Note["pitchUnits"],
		velocity: n.velocity ?? 100,
	}));

const generateOne = async (
	template: string,
	seed: number,
	recent: number[][],
): Promise<{ buf: Buffer; label: string; fingerprint: number[] }> => {
	const song = composeSong({
		skeletons: KAIWAI_SKELETONS,
		...LOCAL,
		stepsPerBar: BAR,
		random: lcgRandom(seed * 104729),
		recent: recent.slice(-3),
		template,
	});
	const chords = buildChordPlacements({
		chordStr: song.chordProgression,
		patternType: song.chordPattern,
		rootShift: song.rootShift,
		bpm: song.bpm,
		stepsPerBar: BAR,
	});
	const preset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	const melProg = programOfInstrumentName(preset.melody) ?? 0;
	const subProg = programOfInstrumentName(preset.submelody) ?? 11;
	const bassProg = programOfInstrumentName(preset.bass) ?? 33;
	const chordProg = programOfInstrumentName(preset.chord) ?? 89;
	const blob = exportMIDI({
		tracks: [
			{ notes: toNotes(song.melody), volume: 100, program: melProg },
			{ notes: toNotes(song.submelody), volume: 70, program: subProg },
			{ notes: toNotes(song.harmony), volume: 60, program: melProg },
			{ notes: toNotes(song.harmony2), volume: 52, program: melProg },
			{
				notes: toNotes(
					song.octave.map((n) => ({
						...n,
						pitchUnits: n.pitchUnits - 12 * UNITS_PER_SEMITONE,
					})),
				),
				volume: 44,
				program: melProg,
			},
			{ notes: toNotes(song.bass), volume: 85, program: bassProg },
			{ notes: toNotes(song.pad), volume: 50, program: chordProg },
			{ notes: toNotes(chords), volume: 65, program: chordProg },
		],
		getDrumPattern: (bar) => resolveDrumPattern(song.drum, DRUM_PATTERNS, bar),
		drumVolume: 80,
		bpm: song.bpm,
		stepsPerBar: BAR,
	});
	return {
		buf: Buffer.from(await blob.arrayBuffer()),
		label: `${template}#${seed} ${song.keyName} ${song.bpm}bpm ${song.instrument} ${song.drum} ${song.scaleId}`,
		fingerprint: song.stats.fingerprint,
		chordProgression: song.chordProgression,
	};
};

/**
 * 生成物の和音は文字列で分かっている（`1小節 = "F G"` のように空白区切りで 2 コード）。
 * 推定器の検算用に、真の「小節内で変わる割合」と「小節境界で変わる割合」を出す。
 */
const chordTruth = (
	progression: string,
): { halfBarChange: number; changesPerBar: number } => {
	// スラッシュのベース指定（ペダル）は落とす。推定器はペダルの上の和音の入れ替わりを
	// ベース音の重みで同じ和音と見るので、真値も「上の和音」だけで数える。
	const bars = progression
		.split("|")
		.map((b) =>
			b
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map((c) => c.replace(/\/.*$/, "")),
		)
		.filter((b) => b.length > 0);
	let half = 0;
	let boundary = 0;
	for (let i = 0; i < bars.length; i++) {
		if (bars[i].length >= 2 && bars[i][0] !== bars[i][bars[i].length - 1])
			half++;
		if (i > 0 && bars[i - 1][bars[i - 1].length - 1] !== bars[i][0]) boundary++;
	}
	return {
		halfBarChange: ratio(half, bars.length),
		changesPerBar: ratio(boundary, bars.length - 1),
	};
};

// ============================================================
// 集計
// ============================================================

const percentile = (sorted: number[], q: number): number => {
	if (sorted.length === 0) return 0;
	const i = (sorted.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

type NumKey = {
	[K in keyof ArrangementFeatures]: ArrangementFeatures[K] extends number
		? K
		: never;
}[keyof ArrangementFeatures];

/** 集計する数値項目（表示順）。`only` はその条件を満たす曲だけで集計する。 */
const NUM_KEYS: {
	key: NumKey;
	label: string;
	only?: (f: ArrangementFeatures) => boolean;
	lever: string;
}[] = [
	{
		key: "bpm",
		label: "BPM（最初のテンポ）",
		lever: "テンプレート bpmChoices",
	},
	{
		key: "tempoChanges",
		label: "テンポ変更回数",
		lever: "構造（生成器はテンポ一定）",
	},
	{
		key: "bars",
		label: "総小節数",
		lever: "テンプレート plan / SECTION_SPECS.barChoices",
	},
	{ key: "seconds", label: "総秒数", lever: "テンプレート plan・bpm" },
	{
		key: "chromaticDur",
		label: "調号外の音の割合（全ch・音価重み）",
		lever: "音階(scales)・和声の表（構造寄り）",
	},
	{
		key: "channels",
		label: "非ドラムch数（8音以上）",
		lever: "構造（トラック構成は固定8本）",
	},
	{
		key: "simultaneousMedian",
		label: "同時に鳴る非ドラムch数の中央値",
		lever: "構造（arrange plan / pad の出方）",
	},
	{
		key: "melIntroBars",
		label: "主旋律が出るまでの小節数",
		only: (f) => f.hasMelody,
		lever: "SECTION_SPECS.intro.barChoices / seconds",
	},
	{
		key: "melSixteenth",
		label: "主旋律: 16分間隔の割合",
		only: (f) => f.hasMelody,
		lever: 'lead:"riff"（歌メロでは構造）',
	},
	{
		key: "melRepeat",
		label: "主旋律: 同音連打率",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "melRange",
		label: "主旋律: 音域（半音）",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "melNotesPerBar",
		label: "主旋律: 音数/小節",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "melRest",
		label: "主旋律: 休符率",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "bassNotesPerBar",
		label: "ベース: 音数/小節",
		only: (f) => f.hasBass,
		lever: "bassByScale（BASS_STYLES の型）",
	},
	{
		key: "bassOctaveAlt",
		label: "ベース: オクターブ交互の割合",
		only: (f) => f.hasBass,
		lever: "BASS_STYLES に型を足す（データ）",
	},
	{
		key: "bassSemitone",
		label: "ベース: 半音進行の割合",
		only: (f) => f.hasBass,
		lever: "bassByScale=chromatic-descent",
	},
	{
		key: "bassOnEighth",
		label: "ベース: 8分格子の割合",
		only: (f) => f.hasBass,
		lever: "BASS_STYLES の型",
	},
	{
		key: "bassOffEighth",
		label: "ベース: 16分裏の割合",
		only: (f) => f.hasBass,
		lever: "BASS_STYLES の型",
	},
	{
		key: "bassRepeat",
		label: "ベース: 同音連打率",
		only: (f) => f.hasBass,
		lever: "BASS_STYLES の型",
	},
	{
		key: "bassRegister",
		label: "ベース: 音高中央値（MIDI）",
		only: (f) => f.hasBass,
		lever: "ベースの音域定数（構造寄り）",
	},
	{
		key: "bassMedianDur",
		label: "ベース: 音価中央値（step）",
		only: (f) => f.hasBass,
		lever: "BASS_STYLES の型",
	},
	{
		key: "bassBarIdentical",
		label: "ベース: 隣の小節と完全一致の割合",
		only: (f) => f.hasBass,
		lever: "form:ostinato / 和音の変わる頻度",
	},
	{
		key: "chordBars",
		label: "和音が推定できた小節の割合",
		lever: "（測定の健全性）",
	},
	{ key: "minorChord", label: "短三和音の小節割合", lever: "baseKey / 進行表" },
	{ key: "dimChord", label: "減三和音の小節割合", lever: "進行表（データ）" },
	{ key: "augChord", label: "増三和音の小節割合", lever: "進行表（データ）" },
	{ key: "susChord", label: "sus の小節割合", lever: "進行表（データ）" },
	{
		key: "powerChord",
		label: "3度の無い和音（パワーコード）の小節割合",
		lever: "伴奏の奏法（chordPattern / ボイシング。構造寄り）",
	},
	{
		key: "otherChord",
		label: "三和音に当てはまらない小節割合",
		lever: "伴奏の奏法・パッド（構造寄り）",
	},
	{
		key: "chordChangesPerBar",
		label: "和音が変わる頻度（小節境界あたり）",
		lever:
			"進行表・和音の割り方（compose.ts の barChords。1小節2コードの小節は既にある）",
	},
	{
		key: "halfBarChange",
		label: "小節内（2拍）で和音が変わる割合",
		lever:
			"和音の割り方（compose.ts の barChords: 1小節2コードの小節を増やす。データ寄り）",
	},
	{ key: "rootFlat2", label: "根音 ♭II の割合", lever: "進行表（データ）" },
	{ key: "rootFlat5", label: "根音 ♭V の割合", lever: "進行表（データ）" },
	{
		key: "rootFlat6",
		label: "根音 ♭VI の割合（短調では自然音）",
		lever: "進行表（データ）",
	},
	{
		key: "rootFlat7",
		label: "根音 ♭VII の割合（短調では自然音）",
		lever: "進行表（データ）",
	},
	{
		key: "rootNonDiatonic",
		label: "調号外の根音の割合",
		lever: "進行表（データ）",
	},
	{
		key: "parallelShift",
		label: "平行移動（同型が半音/短3度ずれる）の割合",
		lever: "進行表（データ）／riff の型",
	},
	{
		key: "drumBarRatio",
		label: "ドラム: 鳴っている小節の割合",
		only: (f) => f.hasDrums,
		lever: "構造（ドラムは全編固定）",
	},
	{
		key: "hatPerBar",
		label: "ドラム: ハイハット/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "hatOffEighth",
		label: "ドラム: ハイハットが16分裏にある割合",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "kickPerBar",
		label: "ドラム: キック/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "kickFour",
		label: "ドラム: 4つ打ちの小節割合",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "snarePerBar",
		label: "ドラム: スネア/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "snare24",
		label: "ドラム: スネアが2・4拍にある小節割合",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "backbeat24",
		label: "ドラム: スネアかクラップが2・4拍にある小節割合",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "percPerBar",
		label: "ドラム: 役割不明の打楽器/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "openHatOffbeat",
		label: "ドラム: オープンハットが裏拍にある割合",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "tomPerBar",
		label: "ドラム: タム/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "crashPerBar",
		label: "ドラム: クラッシュ/小節",
		only: (f) => f.hasDrums,
		lever: "pickBuiltinDrum のプール／DRUM_PATTERNS（データ。dance が界隈型）",
	},
	{
		key: "melBlockRhythm",
		label: "主旋律: 8小節ブロックのリズム類似",
		only: (f) => f.hasMelody,
		lever: "restatement（構造）",
	},
	{
		key: "melBlockContour",
		label: "主旋律: 8小節ブロックの輪郭類似",
		only: (f) => f.hasMelody,
		lever: "restatement（構造）",
	},
	{
		key: "bassBlockRhythm",
		label: "ベース: 8小節ブロックのリズム類似",
		only: (f) => f.hasBass,
		lever: "form:ostinato",
	},
	{
		key: "bassBlockContour",
		label: "ベース: 8小節ブロックの輪郭類似",
		only: (f) => f.hasBass,
		lever: "form:ostinato",
	},
	{
		key: "melBarIdentical",
		label: "主旋律: 隣の小節と完全一致の割合",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "melBarIdentical4",
		label: "主旋律: 4小節前と完全一致の割合",
		only: (f) => f.hasMelody,
		lever: "旋律側（対象外）",
	},
	{
		key: "bassBarIdentical4",
		label: "ベース: 4小節前と完全一致の割合",
		only: (f) => f.hasBass,
		lever: "form:ostinato / 進行の周期",
	},
	{
		key: "arpBarRatio",
		label: "アルペジオ/リフ小節の割合（主旋律・ベース以外）",
		lever: "構造（arrange.sparkle は上級者モードのみ／.mid 出力に無い）",
	},
	{
		key: "arpChannels",
		label: "アルペジオ/リフを4小節以上持つch数",
		lever: "構造（同上）",
	},
];

type Summary = {
	n: number;
	quantiles: Record<
		string,
		{
			n: number;
			p10: number;
			p25: number;
			p50: number;
			p75: number;
			p90: number;
		}
	>;
	shares: Record<string, number>;
	programsTop: [string, number][];
	drumPitchesTop: [string, number][];
	timeSigs: Record<string, number>;
	rootHistogramMean: number[];
};

const summarize = (rows: ArrangementFeatures[]): Summary => {
	const quantiles: Summary["quantiles"] = {};
	for (const k of NUM_KEYS) {
		const vals = rows
			.filter((r) => !k.only || k.only(r))
			.map((r) => r[k.key])
			.filter((v) => Number.isFinite(v))
			.sort((a, b) => a - b);
		quantiles[k.key] = {
			n: vals.length,
			p10: percentile(vals, 0.1),
			p25: percentile(vals, 0.25),
			p50: percentile(vals, 0.5),
			p75: percentile(vals, 0.75),
			p90: percentile(vals, 0.9),
		};
	}
	const share = (pred: (r: ArrangementFeatures) => boolean): number =>
		ratio(rows.filter(pred).length, rows.length);
	const count = (xs: string[]): [string, number][] => {
		const m = new Map<string, number>();
		for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
		return [...m.entries()].sort((a, b) => b[1] - a[1]);
	};
	const timeSigs: Record<string, number> = {};
	for (const r of rows) timeSigs[r.timeSig] = (timeSigs[r.timeSig] ?? 0) + 1;
	const rootHistogramMean = new Array<number>(12).fill(0);
	for (const r of rows) {
		const total = r.rootHistogram.reduce((a, b) => a + b, 0);
		if (total === 0) continue;
		for (let i = 0; i < 12; i++)
			rootHistogramMean[i] += r.rootHistogram[i] / total / rows.length;
	}
	return {
		n: rows.length,
		quantiles,
		shares: {
			minorKey: share((r) => r.minor),
			hasMelody: share((r) => r.hasMelody),
			melodyGuardHit: share((r) => r.melodyGuardHit),
			hasBass: share((r) => r.hasBass),
			hasDrums: share((r) => r.hasDrums),
			drumless: share((r) => !r.hasDrums),
			clap: share((r) => r.clap),
			openHat: share((r) => r.drumPitches.includes(46)),
			hat16th: share((r) => r.hasDrums && r.hatOffEighth >= 0.25),
			tempoChanged: share((r) => r.tempoChanges > 0),
			fourFour: share((r) => r.timeSig === "4/4"),
			arpAnywhere: share((r) => r.arpChannels > 0),
			halfBarChords: share((r) => r.halfBarChange >= 0.25),
			drumRolesInferred: share((r) => r.drumRolesInferred.length > 0),
			powerChordHeavy: share((r) => r.powerChord >= 0.25),
		},
		programsTop: count(
			rows.flatMap((r) => r.programs.map((p) => p.replace(/^ch\d+=/, ""))),
		).slice(0, 20),
		drumPitchesTop: count(rows.flatMap((r) => r.drumPitches.map(String))).slice(
			0,
			16,
		),
		timeSigs,
		rootHistogramMean,
	};
};

const f3 = (v: number): string =>
	Number.isInteger(v) ? String(v) : v.toFixed(3);

const ROOT_LABELS = [
	"I",
	"♭II",
	"II",
	"♭III",
	"III",
	"IV",
	"♭V",
	"V",
	"♭VI",
	"VI",
	"♭VII",
	"VII",
];

const profileMarkdown = (
	title: string,
	s: Summary,
	rows: ArrangementFeatures[],
	dropped: { rel: string; why: string }[],
	/** サイズで絞る前の集計（絞ったときだけ併記する）。 */
	before?: Summary,
): string => {
	const lines: string[] = [
		`# ${title}`,
		"",
		`曲数: ${s.n}（除外 ${dropped.length}本）`,
		"",
	];
	if (before) {
		lines.push(
			"## 絞る前との比較（中央値）",
			"",
			`絞る前 ${before.n}曲 → 絞った後 ${s.n}曲`,
			"",
			"| 項目 | 絞る前 p25/中央/p75 | 絞った後 p25/中央/p75 |",
			"|---|---|---|",
		);
		for (const k of NUM_KEYS) {
			const a = before.quantiles[k.key];
			const b = s.quantiles[k.key];
			lines.push(
				`| ${k.label} | ${f3(a.p25)} / **${f3(a.p50)}** / ${f3(a.p75)} | ${f3(b.p25)} / **${f3(b.p50)}** / ${f3(b.p75)} |`,
			);
		}
		lines.push("", "| 割合 | 絞る前 | 絞った後 |", "|---|---|---|");
		for (const [k, v] of Object.entries(s.shares))
			lines.push(`| ${k} | ${f3(before.shares[k] ?? 0)} | ${f3(v)} |`);
		lines.push("");
	}
	lines.push("## 割合（曲単位）", "", "| 項目 | 割合 |", "|---|---|");
	for (const [k, v] of Object.entries(s.shares))
		lines.push(`| ${k} | ${f3(v)} |`);
	lines.push(
		"",
		`拍子: ${Object.entries(s.timeSigs)
			.map(([k, v]) => `${k}×${v}`)
			.join(", ")}`,
		"",
	);
	lines.push(
		"## 分位点",
		"",
		"| 項目 | n | p10 | p25 | 中央 | p75 | p90 | 動かす場所 |",
		"|---|---|---|---|---|---|---|---|",
	);
	for (const k of NUM_KEYS) {
		const q = s.quantiles[k.key];
		lines.push(
			`| ${k.label} | ${q.n} | ${f3(q.p10)} | ${f3(q.p25)} | ${f3(q.p50)} | ${f3(q.p75)} | ${f3(q.p90)} | ${k.lever} |`,
		);
	}
	lines.push(
		"",
		"## 根音の度数分布（主音基準・曲ごとの割合の平均）",
		"",
		`| ${ROOT_LABELS.join(" | ")} |`,
		`|${"---|".repeat(12)}`,
	);
	lines.push(`| ${s.rootHistogramMean.map(f3).join(" | ")} |`, "");
	lines.push("## よく使われる音色（GM プログラム・ch 単位の延べ数）", "");
	for (const [p, c] of s.programsTop) lines.push(`- ${p} ×${c}`);
	lines.push("", "## ドラムの音（GM ノート番号・曲単位の延べ数）", "");
	for (const [p, c] of s.drumPitchesTop) lines.push(`- ${p} ×${c}`);
	lines.push("", "## 曲ごと", "");
	lines.push(
		"| 曲 | BPM | 拍子 | 小節 | 秒 | 調 | 変化音 | ch | 同時 | 旋律ch音色 | イントロ | 旋律16分 | ベース音色 | ベース音数/小節 | オクターブ交互 | 半音 | 短三和音 | 減 | 変化/小節 | 2拍変化 | ♭II | ♭V | 平行 | ドラム | HH/小節 | 4つ打ち | 裏オープン | クラップ | アルペジオ |",
		`|${"---|".repeat(29)}`,
	);
	for (const r of rows)
		lines.push(
			`| ${r.name} | ${r.bpm} | ${r.timeSig} | ${r.bars} | ${r.seconds} | ${r.keyName} | ${f3(r.chromaticDur)} | ${r.channels} | ${r.simultaneousMedian} | ${r.melodyProgram} | ${r.hasMelody ? r.melIntroBars : "-"} | ${r.hasMelody ? f3(r.melSixteenth) : "-"} | ${r.bassProgram} | ${r.hasBass ? f3(r.bassNotesPerBar) : "-"} | ${r.hasBass ? f3(r.bassOctaveAlt) : "-"} | ${r.hasBass ? f3(r.bassSemitone) : "-"} | ${f3(r.minorChord)} | ${f3(r.dimChord)} | ${f3(r.chordChangesPerBar)} | ${f3(r.halfBarChange)} | ${f3(r.rootFlat2)} | ${f3(r.rootFlat5)} | ${f3(r.parallelShift)} | ${r.hasDrums ? f3(r.drumBarRatio) : "無"} | ${r.hasDrums ? f3(r.hatPerBar) : "-"} | ${r.hasDrums ? f3(r.kickFour) : "-"} | ${r.hasDrums ? f3(r.openHatOffbeat) : "-"} | ${r.clap ? "有" : "-"} | ${f3(r.arpBarRatio)} |`,
		);
	const withInferred = rows.filter((r) => r.drumRolesInferred.length > 0);
	if (withInferred.length > 0) {
		lines.push("", "## GM 外のドラム音を置かれ方から役割推定した曲", "");
		for (const r of withInferred)
			lines.push(`- ${r.name}: ${r.drumRolesInferred.join(", ")}`);
	}
	if (dropped.length > 0) {
		lines.push("", "## 除外したファイル", "");
		for (const d of dropped) lines.push(`- ${d.rel} — ${d.why}`);
	}
	return `${lines.join("\n")}\n`;
};

const gapMarkdown = (
	corpus: Summary,
	gens: { template: string; summary: Summary }[],
): string => {
	type Row = {
		key: NumKey;
		label: string;
		lever: string;
		corpus: Summary["quantiles"][string];
		gen: { template: string; q: Summary["quantiles"][string]; gap: number }[];
		gap: number;
	};
	const rows: Row[] = NUM_KEYS.map((k) => {
		const c = corpus.quantiles[k.key];
		// 広がりが 0 の項目（コーパスが全曲 0 など）は、割合なら 0.05、それ以外は 1 を最小の尺度にする。
		const floor = c.p90 <= 1 ? 0.05 : 1;
		const iqr = Math.max(
			c.p75 - c.p25,
			(c.p90 - c.p10) / 2,
			Math.abs(c.p50) * 0.1,
			floor,
		);
		const gen = gens.map((g) => {
			const q = g.summary.quantiles[k.key];
			return { template: g.template, q, gap: Math.abs(q.p50 - c.p50) / iqr };
		});
		const gap = gen.length
			? gen.reduce((s, g) => s + g.gap, 0) / gen.length
			: 0;
		return { key: k.key, label: k.label, lever: k.lever, corpus: c, gen, gap };
	});
	rows.sort((a, b) => b.gap - a.gap);
	const structural = (lever: string): boolean =>
		/構造|対象外|健全性/.test(lever);
	const lines: string[] = [
		"# コーパス（界隈曲）と現行生成器の差",
		"",
		"差 = |生成物の中央値 − コーパス中央値| / コーパスの IQR（p75−p25。0 なら (p90−p10)/2、それも 0 なら中央値の1割。最小は割合 0.05／それ以外 1）。",
		"3テンプレートの平均で降順。1.0 を超えると生成物の典型がコーパスの中央50%の外。",
		"",
		`| 項目 | コーパス p25/中央/p75 | ${gens.map((g) => `${g.template} 中央 (p10–p90)`).join(" | ")} | 差 | 動かす場所 |`,
		`|---|---|${gens.map(() => "---|").join("")}---|---|`,
	];
	for (const r of rows)
		lines.push(
			`| ${r.label} | ${f3(r.corpus.p25)} / **${f3(r.corpus.p50)}** / ${f3(r.corpus.p75)} | ${r.gen.map((g) => `**${f3(g.q.p50)}** (${f3(g.q.p10)}–${f3(g.q.p90)})`).join(" | ")} | ${r.gap.toFixed(2)} | ${r.lever} |`,
		);
	lines.push(
		"",
		"## 割合の比較",
		"",
		`| 項目 | コーパス | ${gens.map((g) => g.template).join(" | ")} |`,
		`|---|---|${gens.map(() => "---|").join("")}`,
	);
	for (const k of Object.keys(corpus.shares))
		lines.push(
			`| ${k} | ${f3(corpus.shares[k])} | ${gens.map((g) => f3(g.summary.shares[k] ?? 0)).join(" | ")} |`,
		);
	lines.push(
		"",
		"## 根音の度数分布",
		"",
		`| | ${ROOT_LABELS.join(" | ")} |`,
		`|---|${"---|".repeat(12)}`,
	);
	lines.push(`| コーパス | ${corpus.rootHistogramMean.map(f3).join(" | ")} |`);
	for (const g of gens)
		lines.push(
			`| ${g.template} | ${g.summary.rootHistogramMean.map(f3).join(" | ")} |`,
		);
	lines.push(
		"",
		"## 音色（上位）",
		"",
		`- コーパス: ${corpus.programsTop
			.slice(0, 12)
			.map(([p, c]) => `${p}×${c}`)
			.join(", ")}`,
	);
	for (const g of gens)
		lines.push(
			`- ${g.template}: ${g.summary.programsTop
				.slice(0, 8)
				.map(([p, c]) => `${p}×${c}`)
				.join(", ")}`,
		);
	lines.push(
		"",
		"## ドラムの音（上位）",
		"",
		`- コーパス: ${corpus.drumPitchesTop.map(([p, c]) => `${p}×${c}`).join(", ")}`,
	);
	for (const g of gens)
		lines.push(
			`- ${g.template}: ${g.summary.drumPitchesTop.map(([p, c]) => `${p}×${c}`).join(", ")}`,
		);
	lines.push("", "## テンプレート／データで動かせるもの（差 ≥ 0.5）", "");
	for (const r of rows.filter((r) => r.gap >= 0.5 && !structural(r.lever)))
		lines.push(`- ${r.label}: 差 ${r.gap.toFixed(2)} — ${r.lever}`);
	lines.push("", "## 生成器の構造を変えないと動かないもの（差 ≥ 0.5）", "");
	for (const r of rows.filter((r) => r.gap >= 0.5 && structural(r.lever)))
		lines.push(`- ${r.label}: 差 ${r.gap.toFixed(2)} — ${r.lever}`);
	return `${lines.join("\n")}\n`;
};

// ============================================================
// main
// ============================================================

const main = async (): Promise<void> => {
	const dir = argOf("--dir");
	const out = resolve(argOf("--out") ?? "tmp/kaiwai");
	mkdirSync(out, { recursive: true });
	const generateArg = argOf("--generate");
	const noGenerate = argv.includes("--no-generate");
	const count = Number.parseInt(argOf("--count") ?? "40", 10);
	const baseSeed = Number.parseInt(argOf("--seed") ?? "1", 10);
	// 未完成の耳コピ（短い・声部が少ない）を対照から外す。既定は絞らない。
	const minBars = Number.parseInt(argOf("--min-bars") ?? "0", 10);
	const minChannels = Number.parseInt(argOf("--min-channels") ?? "0", 10);
	const templates = noGenerate
		? []
		: generateArg && generateArg !== "all"
			? [generateArg]
			: [
					"vocaloid",
					"1chorus",
					"game_loop",
					"kaiwai",
					"kaiwai_skeleton",
					"kaiwai_splice",
				];
	for (const t of templates)
		if (!STRUCTURE_TEMPLATES.some((s) => s.name === t))
			throw new Error(`知らないテンプレート ${t}`);

	let corpusSummary: Summary | null = null;
	if (dir) {
		const { picked, dropped } = collectSongs(dir);
		if (argv.includes("--list")) {
			for (const c of picked)
				console.log(`採用 ${c.songKey}  ← ${c.rel} (${c.notes}音)`);
			for (const d of dropped) console.log(`除外 ${d.rel} — ${d.why}`);
		}
		const allRows: ArrangementFeatures[] = [];
		const failed: { rel: string; why: string }[] = [];
		for (const c of picked) {
			try {
				const f = featuresOf(c.buf, c.songKey);
				if (f) allRows.push(f);
				else failed.push({ rel: c.rel, why: "音が無い" });
			} catch (e) {
				failed.push({ rel: c.rel, why: `例外: ${(e as Error).message}` });
			}
		}
		const sized = allRows.filter(
			(r) => r.bars >= minBars && r.channels >= minChannels,
		);
		const rows = sized;
		corpusSummary = summarize(rows);
		const allDropped = [
			...dropped,
			...failed.map((f) => ({ rel: f.rel, why: `測定不能（${f.why}）` })),
			...allRows
				.filter((r) => !sized.includes(r))
				.map((r) => ({
					rel: r.name,
					why: `サイズで除外（${r.bars}小節・${r.channels}ch）`,
				})),
		];
		const filtered = minBars > 0 || minChannels > 0;
		writeFileSync(
			join(out, "corpus-profile.md"),
			profileMarkdown(
				filtered
					? `界隈曲コーパスの編成プロファイル（${minBars}小節以上・非ドラム ${minChannels}ch 以上）`
					: "界隈曲コーパスの編成プロファイル",
				corpusSummary,
				rows,
				allDropped,
				filtered ? summarize(allRows) : undefined,
			),
		);
		writeFileSync(
			join(out, "corpus-profile.json"),
			JSON.stringify(
				{
					summary: corpusSummary,
					songs: rows,
					dropped: allDropped,
					picked: picked.map((c) => c.rel),
				},
				null,
				"\t",
			),
		);
		console.log(
			`● コーパス ${rows.length}曲を測定（.mid ${walkMid(dir).length}本 → 採用 ${picked.length} / 除外 ${dropped.length} / 測定不能 ${failed.length}）`,
		);
		console.log(`  → ${join(out, "corpus-profile.md")}`);
	}

	const gens: { template: string; summary: Summary }[] = [];
	for (const template of templates) {
		const rows: ArrangementFeatures[] = [];
		const recent: number[][] = [];
		const truthErr = { half: [] as number[], boundary: [] as number[] };
		for (let i = 0; i < count; i++) {
			const seed = baseSeed + i;
			const g = await generateOne(template, seed, recent);
			recent.push(g.fingerprint);
			const f = featuresOf(g.buf, g.label);
			if (!f) continue;
			const truth = chordTruth(g.chordProgression);
			f.truthHalfBarChange = truth.halfBarChange;
			f.truthChangesPerBar = truth.changesPerBar;
			truthErr.half.push(f.halfBarChange - truth.halfBarChange);
			truthErr.boundary.push(f.chordChangesPerBar - truth.changesPerBar);
			rows.push(f);
		}
		const summary = summarize(rows);
		const meanAbs = (xs: number[]): number =>
			ratio(
				xs.reduce((s, v) => s + Math.abs(v), 0),
				xs.length,
			);
		const meanSigned = (xs: number[]): number =>
			ratio(
				xs.reduce((s, v) => s + v, 0),
				xs.length,
			);
		console.log(
			`  和音推定の検算（真値との差, 推定−真）: 小節内変化 平均${meanSigned(truthErr.half).toFixed(3)} 絶対${meanAbs(truthErr.half).toFixed(3)} / 境界変化 平均${meanSigned(truthErr.boundary).toFixed(3)} 絶対${meanAbs(truthErr.boundary).toFixed(3)}  真値の中央: 小節内 ${f3(median(rows.map((r) => r.truthHalfBarChange ?? 0)))} 境界 ${f3(median(rows.map((r) => r.truthChangesPerBar ?? 0)))}`,
		);
		gens.push({ template, summary });
		writeFileSync(
			join(out, `gen-${template}.json`),
			JSON.stringify({ summary, songs: rows }, null, "\t"),
		);
		writeFileSync(
			join(out, `gen-${template}.md`),
			profileMarkdown(
				`生成物 ${template}（${count}本, seed ${baseSeed}〜）`,
				summary,
				rows,
				[],
			),
		);
		console.log(
			`● 生成 ${template} ${rows.length}本 → ${join(out, `gen-${template}.md`)}`,
		);
	}

	if (!corpusSummary) {
		try {
			corpusSummary = (
				JSON.parse(readFileSync(join(out, "corpus-profile.json"), "utf-8")) as {
					summary: Summary;
				}
			).summary;
		} catch {
			corpusSummary = null;
		}
	}
	if (corpusSummary && gens.length > 0) {
		writeFileSync(join(out, "gap.md"), gapMarkdown(corpusSummary, gens));
		console.log(`● 差分表 → ${join(out, "gap.md")}`);
	}
};

if (basename(process.argv[1] ?? "").includes("measure-arrangement"))
	void main();
