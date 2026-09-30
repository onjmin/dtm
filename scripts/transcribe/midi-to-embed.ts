/**
 * MIDI → MML → 埋め込み URL。採譜結果や耳コピ MIDI を、公開デモの再生専用プレイヤーで聴ける形にする。
 *
 *   npx tsx scripts/transcribe/midi-to-embed.ts <file.mid> [...] [--out tmp/embed] [--mode simple|advanced]
 *                                                 [--inst synth_pop] [--drum auto|none|<pattern>] [--map ch:track,...]
 *
 * 出力: `<out>/<name>.mml`（DAW にそのまま貼れる）と `<out>/<name>.urls.txt`（埋め込み URL と編集画面 URL）。
 * 標準出力に Markdown の表を1行ずつ出す。
 *
 * - URL は `https://onjmin.github.io/dtm/demo/embed.html#g.<gzip+base64url>`（demo/embed.html の `decodeMml` の "g." 形式。
 *   曲データは location.hash に載るのでサーバへ送られず、長さの制限も緩い）。編集画面は `demo/#g....`。
 * - simple モード（4トラック: @0 主旋律 / @1 サブメロ / @2 ベース / @3 伴奏）は、ベース＝音高中央値が最低のチャンネル、
 *   主旋律＝残りで単旋律かつ鳴っている時間が最長、それ以外は @3 へまとめる。`--map` で明示できる（例 `--map 0:0,1:2,2:3`）。
 * - advanced モード（15トラック）はチャンネルを順に t0〜t14 へ置き、プログラムチェンジがあれば `#t<n>inst=<GM名>` を付ける。
 *   16チャンネル以上は切り捨てる（警告を出す）。
 * - ドラムは DAW の仕様どおり固定パターンから選ぶ。`auto` は ch9 のキックが1小節に3.5発以上なら dance、
 *   ハイハットが8発以上なら 16beat、それ以外は 8beat、ch9 が無ければ none。
 * - 量子化は calibrate-corpus.ts と同じ 1小節=192 ステップ。重なった音は MML の都合で次の発音まで切られる。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { GM_INSTRUMENT_NAMES } from "../../src/audio/audio-config";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import { MMLCore } from "../../src/mml/mml-core";
import type { CoreEventHandlers, Note, RenderConfig } from "../../src/types";
import { channelNotes, type MetricNote, parseSmf } from "../corpus/calibrate-corpus";

const STEPS_PER_BAR = 192;
const SITE = "https://onjmin.github.io/dtm/demo/";

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const files: string[] = [];
for (let i = 0; i < argv.length; i++) {
	if (argv[i].startsWith("--")) {
		i++;
		continue;
	}
	files.push(argv[i]);
}
if (files.length === 0) throw new Error("MIDI ファイルを1つ以上渡してください");
const outDir = argOf("--out") ?? "tmp/embed";
const mode = (argOf("--mode") ?? "simple") as "simple" | "advanced";
const inst = argOf("--inst") ?? "synth_pop";
const drumArg = argOf("--drum") ?? "auto";
const mapArg = argOf("--map");
mkdirSync(outDir, { recursive: true });

const renderConfig: RenderConfig = {
	stepsPerBar: STEPS_PER_BAR,
	keyCount: 88,
	pitchRangeStart: 0,
	unitsPerRow: 31,
	keyHeight: 12,
	stepWidth: 2,
	edo: 12,
};
const handlers: CoreEventHandlers = { onMMLGenerated: () => {}, onNotesChanged: () => {} };
const core = new MMLCore(handlers, 100, () => renderConfig);

type Channel = {
	ch: number;
	notes: MetricNote[];
	program: number | null;
	median: number;
	coverage: number;
	poly: number;
};

const toNotes = (ns: MetricNote[]): Note[] => {
	core.clearNotesWithoutHistory();
	core.beginBatch();
	for (const n of ns) {
		core.addNote(n.startStep, (n.pitchSemi * UNITS_PER_SEMITONE) as Note["pitchUnits"], {
			noteLengthSteps: Math.max(1, n.durationSteps),
			velocity: Math.max(20, Math.round((((n as { velocity?: number }).velocity ?? 100) * 100) / 127)),
		});
	}
	core.endBatch();
	return core.getNotes();
};

const analyze = (buf: Buffer) => {
	const midi = parseSmf(buf);
	const byCh = channelNotes(midi);
	let bpm = 120;
	const programs = new Map<number, number>();
	const drums: { step: number; pitch: number }[] = [];
	let sawTempo = false;
	for (const events of midi.tracks) {
		let tick = 0;
		for (const e of events) {
			tick += e.delta;
			if (e.setTempo && !sawTempo) {
				bpm = Math.round((60_000_000 / e.setTempo.microsecondsPerQuarter) * 100) / 100;
				sawTempo = true;
			}
			const pc = (e as { programChange?: { program: number } }).programChange;
			if (pc && e.channel !== undefined && !programs.has(e.channel)) programs.set(e.channel, pc.program);
			if (e.channel === 9 && e.noteOn && e.noteOn.velocity > 0)
				drums.push({ step: Math.round(tick / (midi.division / 48)), pitch: e.noteOn.noteNumber });
		}
	}
	const totalSteps = Math.max(1, ...[...byCh.values()].flat().map((n) => n.startStep + n.durationSteps));
	const channels: Channel[] = [...byCh.entries()]
		.filter(([, ns]) => ns.length >= 8)
		.map(([ch, ns]) => {
			const sorted = [...ns].sort((a, b) => a.startStep - b.startStep);
			let same = 0;
			for (let i = 1; i < sorted.length; i++) if (sorted[i].startStep === sorted[i - 1].startStep) same++;
			const pitches = sorted.map((n) => n.pitchSemi).sort((a, b) => a - b);
			let covered = 0;
			let curS = sorted[0].startStep;
			let curE = curS + sorted[0].durationSteps;
			for (const n of sorted.slice(1)) {
				const e = n.startStep + n.durationSteps;
				if (n.startStep <= curE) curE = Math.max(curE, e);
				else {
					covered += curE - curS;
					curS = n.startStep;
					curE = e;
				}
			}
			covered += curE - curS;
			return {
				ch,
				notes: sorted,
				program: programs.get(ch) ?? null,
				median: pitches[Math.floor(pitches.length / 2)],
				coverage: covered / totalSteps,
				poly: same / Math.max(1, sorted.length - 1),
			};
		})
		.sort((a, b) => a.ch - b.ch);
	return { bpm, channels, drums, bars: Math.ceil(totalSteps / STEPS_PER_BAR) };
};

const pickDrum = (drums: { step: number; pitch: number }[], bars: number): string => {
	if (drumArg !== "auto") return drumArg;
	if (drums.length === 0) return "none";
	const kicks = drums.filter((d) => d.pitch === 35 || d.pitch === 36).length / bars;
	const hats = drums.filter((d) => d.pitch === 42 || d.pitch === 44 || d.pitch === 46).length / bars;
	if (kicks >= 3.5) return "dance";
	if (hats >= 8) return "16beat";
	return "8beat";
};

const toBase64Url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encode = (mml: string): string => `g.${toBase64Url(gzipSync(Buffer.from(mml, "utf8"), { level: 9 }))}`;

for (const file of files) {
	const { bpm, channels, drums, bars } = analyze(readFileSync(file));
	const name = `${basename(dirname(file))}-${basename(file, ".mid")}`.replace(/[^\w\-.ぁ-んァ-ン一-龥ー]+/g, "_");
	const trackMml: string[] = [];
	const meta: string[] = [];
	const warnings: string[] = [];
	if (mode === "advanced") {
		meta.push("#mode=advanced");
		if (channels.length > 15) warnings.push(`${channels.length - 15} チャンネルを切り捨て（advanced は15トラック）`);
		channels.slice(0, 15).forEach((c, i) => {
			trackMml[i] = core.getMMLFromNotes(toNotes(c.notes), bpm, 90).trim().replace(/\s+/g, "");
			if (c.program !== null) meta.push(`#t${i}inst=${GM_INSTRUMENT_NAMES[c.program]}`);
		});
	} else {
		/** ch → simple のトラック番号（0 主旋律 / 1 サブメロ / 2 ベース / 3 伴奏） */
		const map = new Map<number, number>();
		if (mapArg) {
			for (const pair of mapArg.split(",")) {
				const [ch, tr] = pair.split(":").map((x) => Number.parseInt(x, 10));
				map.set(ch, tr);
			}
		} else {
			const byLow = [...channels].sort((a, b) => a.median - b.median);
			const bass = byLow[0] && byLow[0].median <= 55 ? byLow[0] : null;
			const rest = channels.filter((c) => c !== bass);
			const mono = rest.filter((c) => c.poly < 0.15).sort((a, b) => b.coverage - a.coverage);
			const melody = mono[0] ?? rest[0] ?? null;
			if (bass) map.set(bass.ch, 2);
			if (melody) map.set(melody.ch, 0);
			for (const c of rest) if (c !== melody) map.set(c.ch, 3);
		}
		const grouped = new Map<number, MetricNote[]>();
		for (const c of channels) {
			const tr = map.get(c.ch);
			if (tr === undefined) continue;
			grouped.set(tr, [...(grouped.get(tr) ?? []), ...c.notes]);
		}
		const volumes = [100, 90, 88, 80];
		for (const [tr, ns] of grouped)
			trackMml[tr] = core.getMMLFromNotes(toNotes(ns), bpm, volumes[tr] ?? 80).trim().replace(/\s+/g, "");
	}
	const drum = pickDrum(drums, bars);
	const metaLine = [`#inst=${inst}`, `#drum=${drum}`, "#volume=80", ...meta].join("");
	const lines: string[] = [];
	trackMml.forEach((m, i) => {
		if (m) lines.push(`@${i}${m}`);
	});
	const mml = [metaLine, ...lines, "#end;"].join(";");
	const payload = encode(mml);
	const embedUrl = `${SITE}embed.html#${payload}`;
	const editUrl = `${SITE}#${payload}`;
	writeFileSync(join(outDir, `${name}.mml`), mml, "utf8");
	writeFileSync(join(outDir, `${name}.urls.txt`), `embed: ${embedUrl}\nedit: ${editUrl}\n`, "utf8");
	const chDesc = channels
		.map((c) => `ch${c.ch}${c.program !== null ? `(${GM_INSTRUMENT_NAMES[c.program]})` : ""}:${c.notes.length}`)
		.join(" ");
	console.log(
		`| ${name} | ${bpm} | ${bars} 小節 | ${drum} | ${mml.length} 文字 → URL ${embedUrl.length} 文字 | ${chDesc}${warnings.length ? ` | ⚠ ${warnings.join("; ")}` : ""} |`,
	);
	console.log(`  ${embedUrl.slice(0, 80)}...`);
}
