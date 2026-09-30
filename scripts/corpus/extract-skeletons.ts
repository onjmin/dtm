/**
 * 界隈曲の耳コピ MIDI から曲ごとの**骨格**（`Skeleton`）を抜き出し、`src/compose/compose-skeletons.ts` を生成する。
 *
 *   npx tsx scripts/corpus/extract-skeletons.ts --dir "C:/Users/frgk2/Music/_own/自作/界隈曲" --out src/compose/compose-skeletons.ts
 *   npx tsx scripts/corpus/extract-skeletons.ts --check            # 生成済みファイルの検算だけ
 *   npx tsx scripts/corpus/extract-skeletons.ts --dir ... --show ヤツメ穴   # 1曲の和音・セクションを表示
 *
 * 骨格借用（docs/handover-compose.md）の素材。曲の集め方・主旋律/ベース/ドラム役割の推定は
 * `measure-arrangement.ts` と同じ関数を通し、和音は推定ではなく**和音チャンネルを読む**。
 * 型と符号化は `src/compose/skeleton-types.ts`（生成側と共有）。
 *
 * 辞書に無いドラム型は `kaiwai_<n>` として `src/instruments/drum-config.ts` に**追記**する
 * （マーカーコメントの間を毎回書き直すので再実行しても増えない）。
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { QUALITIES } from "@onjmin/chord-parser";
import type { MetricNote } from "../../src/compose/compose-metrics";
import {
	decodeSkeleton,
	type EncodedSkeleton,
	encodeSkeleton,
	type Skeleton,
	type SkeletonBar,
	type SkeletonChordPattern,
	type SkeletonLayers,
	type SkeletonSection,
	type SkeletonSectionKind,
	validateSkeletons,
} from "../../src/compose/skeleton-types";
import { DRUM_PATTERNS } from "../../src/instruments/drum-config";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import {
	channelNotes,
	estimateKey,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";
import {
	collectSongs,
	type DrumRole,
	inferDrumRoles,
} from "./measure-arrangement";

const BAR = 192;
const HALF = BAR / 2;
const GRID = BAR / 16;
const UNIT = 4;
/** 8小節の塊どうしを同じ型とみなす類似度（打点＋度数 0.65・打点 0.35 の混合）。 */
const CLUSTER_THRESHOLD = 0.4;

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** `--bars 60-66` で、その小節の和音の重みを表示する（--show と併用）。 */
const DEBUG_BARS = argOf("--bars")
	? (argOf("--bars") as string).split("-").map(Number)
	: null;

const median = (xs: number[]): number => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const barOf = (step: number): number => Math.floor(step / BAR);
const pcOf = (p: number): number => ((p % 12) + 12) % 12;
const jaccard = (a: Set<string>, b: Set<string>): number => {
	if (a.size === 0 && b.size === 0) return 1;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	return inter / (a.size + b.size - inter);
};
const stackedRatio = (ns: MetricNote[]): number => {
	const starts = new Map<number, number>();
	for (const n of ns)
		starts.set(n.startStep, (starts.get(n.startStep) ?? 0) + 1);
	let stacked = 0;
	for (const c of starts.values()) if (c > 1) stacked += c;
	return ns.length === 0 ? 0 : stacked / ns.length;
};

// ============================================================
// SMF の読み込み（measure-arrangement.featuresOf の前段と同じ詰め方）
// ============================================================

type Song = {
	bpm: number;
	bars: number;
	/** 非ドラム ch → 量子化済みノート列（8音未満の ch は捨てる）。 */
	channels: Map<number, MetricNote[]>;
	/** 同じ ch の量子化前。同時発音の判定はこちらで見る（16分格子に丸めると32分の連打が「同時」になる）。 */
	raw: Map<number, MetricNote[]>;
	drums: { step: number; pitch: number }[];
	programs: Map<number, number>;
	names: Map<number, string>;
};

const loadSong = (buf: Buffer): Song | null => {
	const midi = parseSmf(buf);
	const ticksPerStep = midi.division / 48;
	const tempos: { tick: number; us: number }[] = [];
	const programs = new Map<number, number>();
	const names = new Map<number, string>();
	const drumsRaw: { step: number; pitch: number }[] = [];
	let earliestNonDrum = Number.POSITIVE_INFINITY;
	let earliestDrum = Number.POSITIVE_INFINITY;
	for (const events of midi.tracks) {
		let tick = 0;
		let trackName = "";
		const chs = new Set<number>();
		for (const e of events) {
			tick += e.delta;
			if (e.setTempo)
				tempos.push({ tick, us: e.setTempo.microsecondsPerQuarter });
			if (e.trackName) trackName = e.trackName;
			const ch = e.channel ?? 0;
			if (e.programChange && !programs.has(ch))
				programs.set(ch, e.programChange.program);
			if (e.noteOn) {
				chs.add(ch);
				const step = Math.round(tick / ticksPerStep);
				if (ch === 9) {
					drumsRaw.push({ step, pitch: e.noteOn.noteNumber });
					earliestDrum = Math.min(earliestDrum, step);
				} else earliestNonDrum = Math.min(earliestNonDrum, step);
			}
		}
		if (trackName)
			for (const ch of chs)
				names.set(
					ch,
					names.has(ch) ? `${names.get(ch)}/${trackName}` : trackName,
				);
	}
	tempos.sort((a, b) => a.tick - b.tick);
	const bpm = tempos.length > 0 ? 6e7 / tempos[0].us : 120;

	const byChannel = channelNotes(midi);
	if (byChannel.size === 0) return null;
	const nonDrumShift =
		Number.isFinite(earliestNonDrum) && earliestNonDrum >= BAR
			? barOf(earliestNonDrum) * BAR
			: 0;
	const earliest = Math.min(earliestNonDrum, earliestDrum);
	const shift =
		Number.isFinite(earliest) && earliest >= BAR ? barOf(earliest) * BAR : 0;
	const channels = new Map<number, MetricNote[]>();
	const raw = new Map<number, MetricNote[]>();
	for (const [ch, ns] of byChannel) {
		if (ns.length < 8) continue;
		const shifted = ns.map((n) => ({
			...n,
			startStep: n.startStep + nonDrumShift - shift,
		}));
		raw.set(ch, shifted);
		channels.set(ch, quantize(shifted));
	}
	const drums = drumsRaw.map((d) => ({
		step: Math.round((d.step - shift) / GRID) * GRID,
		pitch: d.pitch,
	}));
	let maxEnd = 0;
	for (const ns of channels.values())
		for (const n of ns)
			maxEnd = Math.max(maxEnd, n.startStep + n.durationSteps);
	for (const d of drums) maxEnd = Math.max(maxEnd, d.step + 1);
	return {
		bpm: Math.round(bpm * 10) / 10,
		bars: Math.max(1, Math.ceil(maxEnd / BAR)),
		channels,
		raw,
		drums,
		programs,
		names,
	};
};

// ============================================================
// 役割: 主旋律・ベース・和音 ch
// ============================================================

/** トラック名が歌を指しているか。耳コピはボカロ名・「ウタ」「主旋律」で付けることが多い。 */
const VOCAL_NAME =
	/ウタ|うた|歌|vocal|voice|vo\b|主旋律|メロ|melody|ボーカル|ボカロ|テト|ミク|リン|レン|ルカ|グミ|ずんだ|フラワ|きりたん|ゆかり|ころんば/i;
const NON_VOCAL_NAME = /ハモ|harmony|コーラス|chorus|裏|sub|副/i;

const pickMelody = (
	song: Song,
): { ch: number; notes: MetricNote[]; by: string } | null => {
	const coverage = (ns: MetricNote[]): number =>
		ns.reduce((s, n) => s + n.durationSteps, 0);
	// 旋律らしさは量子化前で見る（measure-arrangement と同じ。16分格子に丸めると音価が1種類に潰れて落ちる曲がある）。
	const plausible = [...song.channels].filter(([ch]) =>
		isPlausibleMelody(song.raw.get(ch) ?? []),
	);
	if (plausible.length === 0) return null;
	const named = plausible.filter(([ch]) => {
		const name = song.names.get(ch) ?? "";
		return VOCAL_NAME.test(name) && !NON_VOCAL_NAME.test(name);
	});
	const upper = plausible.filter(
		([, ns]) => median(ns.map((n) => n.pitchSemi)) >= 48,
	);
	const pool = (named.length > 0 ? named : upper.length > 0 ? upper : plausible)
		.slice()
		.sort((a, b) => coverage(b[1]) - coverage(a[1]));
	const [primary, ...others] = pool;
	const label = (ch: number): string =>
		`ch${ch}${song.names.get(ch) ? `「${song.names.get(ch)}」` : ""}`;
	if (named.length === 0)
		return {
			ch: primary[0],
			notes: toMonophonic(primary[1]),
			by: `最長被覆 ${label(primary[0])}`,
		};
	// 歌トラックが複数あるとき（Aメロとサビで音源を変える、掛け合い）は、被覆の長い順に
	// **主が歌わない小節だけ**を他から埋める。同時に歌う小節は主を採る。
	const merged = [...primary[1]];
	const used = [label(primary[0])];
	for (const [ch, ns] of others) {
		const sung = new Set(merged.map((n) => barOf(n.startStep)));
		const fill = ns.filter((n) => !sung.has(barOf(n.startStep)));
		if (fill.length === 0) continue;
		merged.push(...fill);
		used.push(label(ch));
	}
	return {
		ch: primary[0],
		notes: toMonophonic(merged),
		by: `トラック名 ${used.join("+")}`,
	};
};

/** toMonophonic の下声版（ベース用）。 */
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

const pickBass = (
	song: Song,
	melodyCh: number,
): { ch: number; notes: MetricNote[] } | null => {
	let best: { ch: number; med: number; stacked: number } | null = null;
	for (const [ch, ns] of song.channels) {
		if (ch === melodyCh) continue;
		const covered = new Set(ns.map((n) => barOf(n.startStep))).size;
		if (covered < song.bars * 0.3) continue;
		const med = median(ns.map((n) => n.pitchSemi));
		const stacked = stackedRatio(song.raw.get(ch) ?? ns) >= 0.5 ? 1 : 0;
		if (
			!best ||
			stacked < best.stacked ||
			(stacked === best.stacked && med < best.med)
		)
			best = { ch, med, stacked };
	}
	return best
		? { ch: best.ch, notes: toMonophonicLow(song.channels.get(best.ch) ?? []) }
		: null;
};

/** 同時発音が半分以上の ch を和音 ch とみなす（複数可）。 */
const pickChordChannels = (song: Song, exclude: number[]): number[] =>
	[...song.raw]
		.filter(([ch, ns]) => !exclude.includes(ch) && stackedRatio(ns) >= 0.5)
		.map(([ch]) => ch);

// ============================================================
// 和音の命名（構成音集合 → parseChord が読める名前）
// ============================================================

/** 使う品質と綴り（既存の進行プールと同じ綴り: M7 / m7-5 / +）。上ほど優先。 */
const QUALITY_SPELLING: Record<string, string> = {
	"": "",
	m: "m",
	"7": "7",
	M7: "M7",
	m7: "m7",
	dim: "dim",
	m7b5: "m7-5",
	aug: "+",
	sus4: "sus4",
	sus2: "sus2",
	"6": "6",
	m6: "m6",
	mM7: "mM7",
	dim7: "dim7",
	"7sus4": "7sus4",
};
/** 完全一致以外（包含・最近傍）で許す品質。sus や 6 は経過音で出やすいので完全一致のときだけ。 */
const CORE_QUALITIES = new Set([
	"",
	"m",
	"7",
	"M7",
	"m7",
	"dim",
	"m7b5",
	"aug",
	"dim7",
	"mM7",
]);
const QUALITY_DEFS = QUALITIES.filter((q) =>
	Object.hasOwn(QUALITY_SPELLING, q.quality),
);
const MINORISH = new Set(["m", "m7", "dim", "m7b5", "m6", "mM7", "dim7"]);
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** 短調（A 基準）は和声的短音階まで、長調（C 基準）は全音階。 */
const KEY_PCS = {
	minor: new Set([9, 11, 0, 2, 4, 5, 7, 8]),
	major: new Set([0, 2, 4, 5, 7, 9, 11]),
};

/** 黒鍵のルート名。短調寄りの品質なら # で、それ以外は ♭ で書く（Db7 / AbM7 / G#dim7 / C#m7）。 */
const rootName = (pc: number, quality: string): string =>
	MINORISH.has(quality) ? SHARP[pc] : FLAT[pc];

type Candidate = { root: number; quality: string; pcs: Set<number> };
const CANDIDATES: Candidate[] = [];
for (let root = 0; root < 12; root++)
	for (const q of QUALITY_DEFS)
		CANDIDATES.push({
			root,
			quality: q.quality,
			pcs: new Set(q.pitchClasses.map((p) => (p + root) % 12)),
		});

const setEq = (a: Set<number>, b: Set<number>): boolean =>
	a.size === b.size && [...a].every((x) => b.has(x));
const superset = (a: Set<number>, b: Set<number>): boolean =>
	[...b].every((x) => a.has(x));

/**
 * ピッチクラス集合とベース音から和音名を決める。完全一致 → 包含（最小の上位集合／最大の部分集合）→ 最近傍（Jaccard）。
 * 同点は「ルート＝ベース」「調の中の音だけ」「品質の優先度」の順で割る。
 * ベースが構成音の外なら分数（Em7/A）。返す名前は必ず parseChord が読める。
 * `bassRoot` は和音 ch がダイアドのとき: ベース音を根音とする名前を先に探す（完全一致 → 包含）。
 * 上位集合/部分集合の名前が付いてベースと根音が食い違う（ヤツメ穴 F+A#/D# が A#m になった）のを防ぐ。
 */
const nameChord = (
	pcs: Set<number>,
	bassPc: number | null,
	mode: "minor" | "major",
	bassRoot = false,
): { name: string; root: number } | null => {
	const S = new Set(pcs);
	if (bassPc !== null) S.add(bassPc);
	if (S.size === 0) return null;
	const inKey = KEY_PCS[mode];
	const rank = (c: Candidate): number => {
		let r = 0;
		if (bassPc !== null && c.root === bassPc) r -= 1000;
		if ([...c.pcs].every((p) => inKey.has(p))) r -= 100;
		r += QUALITY_DEFS.findIndex((q) => q.quality === c.quality);
		return r;
	};
	const pick = (list: Candidate[]): Candidate | null =>
		list.length === 0 ? null : list.sort((a, b) => rank(a) - rank(b))[0];
	const label = (
		c: Candidate,
		slash: number | null,
	): { name: string; root: number } => ({
		name: `${rootName(c.root, c.quality)}${QUALITY_SPELLING[c.quality]}${slash === null ? "" : `/${rootName(slash, "")}`}`,
		root: c.root,
	});

	const CORE = CANDIDATES.filter((c) => CORE_QUALITIES.has(c.quality));
	const minimal = (list: Candidate[]): Candidate | null => {
		if (list.length === 0) return null;
		const size = Math.min(...list.map((c) => c.pcs.size));
		return pick(list.filter((c) => c.pcs.size === size));
	};
	const maximal = (list: Candidate[]): Candidate | null => {
		if (list.length === 0) return null;
		const size = Math.max(...list.map((c) => c.pcs.size));
		return pick(list.filter((c) => c.pcs.size === size));
	};
	let hit: Candidate | null = null;
	if (bassRoot && bassPc !== null) {
		const rooted = (list: Candidate[]): Candidate[] =>
			list.filter((c) => c.root === bassPc);
		hit =
			pick(rooted(CANDIDATES.filter((c) => setEq(c.pcs, S)))) ??
			minimal(rooted(CORE.filter((c) => superset(c.pcs, S)))) ??
			maximal(rooted(CORE.filter((c) => superset(S, c.pcs))));
		if (hit) return label(hit, null);
	}
	hit = pick(CANDIDATES.filter((c) => setEq(c.pcs, S)));
	if (hit) return label(hit, null);
	if (bassPc !== null && !pcs.has(bassPc) && pcs.size >= 3) {
		hit = pick(CORE.filter((c) => setEq(c.pcs, pcs)));
		if (hit) return label(hit, bassPc);
	}
	hit = minimal(CORE.filter((c) => superset(c.pcs, S)));
	if (hit) return label(hit, null);
	hit = maximal(CORE.filter((c) => superset(S, c.pcs)));
	if (hit) return label(hit, null);
	let bestScore = -1;
	let best: Candidate[] = [];
	for (const c of CORE) {
		let inter = 0;
		for (const p of c.pcs) if (S.has(p)) inter++;
		const score = inter / (c.pcs.size + S.size - inter);
		if (score > bestScore + 1e-9) {
			bestScore = score;
			best = [c];
		} else if (Math.abs(score - bestScore) < 1e-9) best.push(c);
	}
	hit = pick(best);
	return hit ? label(hit, null) : null;
};

// ============================================================
// 度数（CORPUS_PHRASES と同じ表。C4=60 を 0 にした絶対度数）
// ============================================================

const MAJOR_PC_TO_DEGREE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const toAbsDegree = (transposedPitch: number): number => {
	const rel = transposedPitch - 60;
	return Math.floor(rel / 12) * 7 + MAJOR_PC_TO_DEGREE[pcOf(rel)];
};

// ============================================================
// ドラム型
// ============================================================

type BeatRole = "kick" | "snare" | "hat" | "ohat";
/** 1小節のドラム型: `role@step` の集合。 */
type DrumSig = Set<string>;

const roleOfPitch = (
	pitch: number,
	roles: Map<number, DrumRole>,
): BeatRole | null => {
	if (pitch === 46) return "ohat";
	const r = roles.get(pitch);
	if (r === "kick") return "kick";
	if (r === "snare" || r === "clap") return "snare";
	if (r === "hat") return "hat";
	return null;
};

const sigOfPattern = (pattern: { step: number; pitch: number }[]): DrumSig => {
	const sig: DrumSig = new Set();
	for (const p of pattern) {
		const role: BeatRole | null =
			p.pitch === 35 || p.pitch === 36
				? "kick"
				: p.pitch === 37 || p.pitch === 38 || p.pitch === 39 || p.pitch === 40
					? "snare"
					: p.pitch === 42 || p.pitch === 44
						? "hat"
						: p.pitch === 46
							? "ohat"
							: null;
		if (role) sig.add(`${role}@${p.step}`);
	}
	return sig;
};

/** 曲で最も使われた1小節型（ドラムの鳴る小節だけで数える）。ドラム無しなら null。 */
const dominantDrumSig = (
	song: Song,
): { sig: DrumSig; usesClap: boolean; share: number } | null => {
	if (song.drums.length === 0) return null;
	const roles = inferDrumRoles(song.drums, song.bars);
	const byBar = new Map<number, DrumSig>();
	for (const d of song.drums) {
		const b = barOf(d.step);
		if (b < 0) continue;
		const role = roleOfPitch(d.pitch, roles);
		if (!role) continue;
		const sig = byBar.get(b) ?? new Set();
		sig.add(`${role}@${d.step % BAR}`);
		byBar.set(b, sig);
	}
	if (byBar.size === 0) return null;
	const counts = new Map<string, { sig: DrumSig; n: number }>();
	for (const sig of byBar.values()) {
		const key = [...sig].sort().join(",");
		const c = counts.get(key) ?? { sig, n: 0 };
		c.n++;
		counts.set(key, c);
	}
	let best: { sig: DrumSig; n: number } | null = null;
	for (const c of counts.values()) if (!best || c.n > best.n) best = c;
	if (!best) return null;
	return {
		sig: best.sig,
		usesClap: song.drums.some((d) => d.pitch === 39),
		share: best.n / byBar.size,
	};
};

const DRUM_MATCH = 0.8;
const MAX_NEW_DRUMS = 4;
const NEW_DRUM_PREFIX = "kaiwai_";

const stepVelocity = (role: BeatRole, step: number): number => {
	if (role === "kick" || role === "snare") return step % 48 === 0 ? 1.0 : 0.8;
	return role === "ohat" ? 0.8 : 0.6;
};

/** 新しい固定パターンを drum-config.ts の書式で書く。 */
const renderDrumPattern = (
	key: string,
	label: string,
	origin: string,
	sig: DrumSig,
	usesClap: boolean,
): string => {
	const rows = [...sig]
		.map((tok) => {
			const [role, step] = tok.split("@");
			return { role: role as BeatRole, step: Number(step) };
		})
		.sort((a, b) => a.step - b.step || a.role.localeCompare(b.role));
	const pitchOf: Record<BeatRole, string> = {
		kick: "DRUM_KEYS.bassDrum1",
		snare: usesClap ? "DRUM_KEYS.handClap" : "DRUM_KEYS.acousticSnare",
		hat: "DRUM_KEYS.closedHihat",
		ohat: "DRUM_KEYS.openHihat",
	};
	const lines = rows.map(
		(r) =>
			`\t\t\t{ step: ${r.step}, pitch: ${pitchOf[r.role]}, velocity: ${stepVelocity(r.role, r.step).toFixed(1)} },`,
	);
	// 出自（作者/曲名）は UI に出さずコメントに残す。
	return `\t// 出自: ${origin}\n\t${key}: {\n\t\tlabel: ${JSON.stringify(label)},\n\t\tpattern: [\n${lines.join("\n")}\n\t\t],\n\t},`;
};

const DRUM_MARK_BEGIN =
	"\t// --- 界隈曲の骨格のドラム型（scripts/corpus/extract-skeletons.ts が生成。ここから） ---";
const DRUM_MARK_END = "\t// --- （ここまで） ---";

const writeDrumConfig = (
	path: string,
	entries: {
		key: string;
		label: string;
		origin: string;
		sig: DrumSig;
		usesClap: boolean;
	}[],
): void => {
	let src = readFileSync(path, "utf8");
	const b = src.indexOf(DRUM_MARK_BEGIN);
	const e = src.indexOf(DRUM_MARK_END);
	if (b >= 0 && e > b)
		src = src.slice(0, b) + src.slice(e + DRUM_MARK_END.length + 1);
	if (entries.length === 0) {
		writeFileSync(path, src, "utf8");
		return;
	}
	const block = [
		DRUM_MARK_BEGIN,
		...entries.map((x) =>
			renderDrumPattern(x.key, x.label, x.origin, x.sig, x.usesClap),
		),
		DRUM_MARK_END,
		"",
	].join("\n");
	// DRUM_PATTERNS を閉じる `};` の直前へ入れる。
	const head = src.indexOf("export const DRUM_PATTERNS");
	const close = src.indexOf("\n};", head);
	if (head < 0 || close < 0) throw new Error("DRUM_PATTERNS が見つからない");
	src = `${src.slice(0, close + 1)}${block}${src.slice(close + 1)}`;
	writeFileSync(path, src, "utf8");
};

// ============================================================
// 伴奏の刻み
// ============================================================

/** chords.ts の各刻みが1小節に置く打点（和音の変わり目 96 を含む）。 */
const PATTERN_ONSETS: Record<SkeletonChordPattern, number[]> = {
	block: [0, 96],
	offbeat: [24, 72, 120, 168],
	yatsume: [0, 36, 96, 132],
	"arpeggio-fast": [0, 6, 12, 96, 102, 108],
	alternating: [0, 48, 96, 144],
	arpeggio: [],
};

/** ch の最頻の1小節打点集合。 */
const dominantOnsets = (ns: MetricNote[]): Set<string> => {
	const byBar = new Map<number, Set<number>>();
	for (const n of ns) {
		const set = byBar.get(barOf(n.startStep)) ?? new Set();
		set.add(n.startStep % BAR);
		byBar.set(barOf(n.startStep), set);
	}
	const counts = new Map<string, number>();
	for (const set of byBar.values()) {
		const key = [...set].sort((a, b) => a - b).join(",");
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	let bestKey = "0";
	let bestN = -1;
	for (const [k, n] of counts)
		if (n > bestN) {
			bestN = n;
			bestKey = k;
		}
	return new Set(bestKey.split(","));
};

/**
 * 伴奏の刻み。同時発音のある ch（和音 ch と、短い音の刻み ch）の最頻の打点を chords.ts の
 * 各刻みに当てる。裏拍や跳ねの刻み（offbeat / yatsume）が 0.6 以上で当たればそれを採る
 * （界隈曲の「らしさ」は白玉より刻みの側にある）。無ければ和音 ch が block、
 * 和音 ch が無くアルペジオの小節が3割以上なら arpeggio。
 */
const pickChordPattern = (
	song: Song,
	chordChs: number[],
	exclude: number[],
	arpBars: number,
): SkeletonChordPattern => {
	const stabChs = [...song.channels]
		.filter(
			([ch, ns]) =>
				!exclude.includes(ch) &&
				!chordChs.includes(ch) &&
				stackedRatio(song.raw.get(ch) ?? ns) >= 0.3 &&
				median(ns.map((n) => n.durationSteps)) <= 24,
		)
		.map(([ch]) => ch);
	let rhythmic: { name: SkeletonChordPattern; score: number } = {
		name: "block",
		score: 0,
	};
	for (const ch of [...chordChs, ...stabChs]) {
		const onsets = dominantOnsets(song.channels.get(ch) ?? []);
		for (const name of ["offbeat", "yatsume"] as const) {
			const score = jaccard(onsets, new Set(PATTERN_ONSETS[name].map(String)));
			if (score > rhythmic.score) rhythmic = { name, score };
		}
	}
	if (rhythmic.score >= 0.6) return rhythmic.name;
	if (chordChs.length === 0)
		return arpBars >= song.bars * 0.3 ? "arpeggio" : "block";
	const onsets = dominantOnsets(song.channels.get(chordChs[0]) ?? []);
	let best: SkeletonChordPattern = "block";
	let bestScore = -1;
	for (const name of [
		"block",
		"arpeggio-fast",
		"offbeat",
		"yatsume",
	] as const) {
		const score = jaccard(onsets, new Set(PATTERN_ONSETS[name].map(String)));
		if (score > bestScore) {
			bestScore = score;
			best = name;
		}
	}
	return best;
};

// ============================================================
// 1曲の骨格
// ============================================================

const PRESET_KEYS = Object.keys(INSTRUMENT_PRESETS);
const nearestPreset = (melodyProgram: number | null): string => {
	let key = "synth_pop";
	if (melodyProgram === null) key = "synth_pop";
	else if (melodyProgram >= 0 && melodyProgram <= 7) key = "piano";
	else if (melodyProgram === 80 || melodyProgram === 81) key = "retro_game";
	else if (melodyProgram >= 82 && melodyProgram <= 87) key = "chip_pop";
	else if (melodyProgram === 38 || melodyProgram === 39) key = "synth_pop";
	return PRESET_KEYS.includes(key) ? key : PRESET_KEYS[0];
};

type Extracted = {
	skeleton: Skeleton;
	drumSig: { sig: DrumSig; usesClap: boolean; share: number } | null;
};

const extractSkeleton = (buf: Buffer, id: string): Extracted | null => {
	const song = loadSong(buf);
	if (!song) return null;
	const warnings: string[] = [];
	const all = [...song.channels.values()].flat();
	if (all.length === 0) return null;
	const key = estimateKey(all);
	const keyMode: "minor" | "major" = key.minor ? "minor" : "major";
	// 主音を A（短調）/ C（長調）へ。移調量は ±6 半音に収める。平行調どうしは同じ移調量になるので、
	// estimateKey が長短を取り違えても shift は変わらない（長短は後で和音ルートから決め直す）。
	let shift = ((key.minor ? 9 : 0) - key.tonic + 12) % 12;
	if (shift > 6) shift -= 12;
	const tp = (p: number): number => p + shift;

	const mel = pickMelody(song);
	const melodyCh = mel?.ch ?? -1;
	if (!mel) warnings.push("主旋律の候補が無い（歌わない曲として扱う）");
	const bass = pickBass(song, melodyCh);
	const bassCh = bass?.ch ?? -1;
	if (!bass) warnings.push("ベース ch が無い");
	const chordChs = pickChordChannels(song, [melodyCh, bassCh]);
	const chordTrack = chordChs.length > 0;
	if (!chordTrack) warnings.push("和音 ch が無い（全 ch のクロマから推定）");

	// --- 半小節ごとの和音 ---
	const halves = song.bars * 2;
	const chordWeights = (chs: number[], from: number, to: number): number[] => {
		const w = new Array<number>(12).fill(0);
		for (const ch of chs)
			for (const n of song.channels.get(ch) ?? []) {
				const end = n.startStep + n.durationSteps;
				if (n.startStep >= to || end <= from) continue;
				w[pcOf(tp(n.pitchSemi))] +=
					Math.min(end, to) - Math.max(n.startStep, from);
			}
		return w;
	};
	/**
	 * 和音 ch は「半小節の頭の拍で鳴っている和音」を読む。半小節を丸ごと重ねると、4拍目で
	 * 次の和音へ動く小節（ヤツメ穴のサビ `Am | C …` の C が {C}+{A,C,D} に混ざって Dm7 になった）
	 * が別の名前になる。頭の拍に何も無ければ半小節全体。
	 */
	const chordTrackWeights = (h: number): number[] => {
		const from = h * HALF;
		const first = chordWeights(chordChs, from, from + HALF / 2);
		return first.some((v) => v > 0)
			? first
			: chordWeights(chordChs, from, from + HALF);
	};
	const bassPcAt = (h: number): number | null => {
		if (!bass) return null;
		const from = h * HALF;
		const to = from + HALF;
		let hit: MetricNote | null = null;
		for (const n of bass.notes) {
			if (n.startStep >= to) break;
			if (n.startStep + n.durationSteps <= from) continue;
			// 半小節の頭で鳴っている音（無ければ最初に始まる音）
			if (!hit || (n.startStep <= from && hit.startStep < n.startStep)) hit = n;
			if (n.startStep > from && hit && hit.startStep <= from) break;
		}
		return hit ? pcOf(tp(hit.pitchSemi)) : null;
	};
	// 推定用のクロマ。ベース ch は外す（オクターブ往復の重みが和音を根音一色にする）。
	// ベースは bassPc として別に入る。主旋律は 3ch 以上あるときだけ外す。
	const fallbackChs = [...song.channels.keys()].filter(
		(ch) => ch !== bassCh && (ch !== melodyCh || song.channels.size < 3),
	);
	const nameHalves = (
		mode: "minor" | "major",
	): {
		chordNames: (string | null)[];
		chordRoots: (number | null)[];
		fallbackHalves: number;
	} => {
		const chordNames: (string | null)[] = [];
		const chordRoots: (number | null)[] = [];
		let fallbackHalves = 0;
		for (let h = 0; h < halves; h++) {
			let w = chordTrackWeights(h);
			let max = Math.max(...w);
			let threshold = 0.25;
			const bassPc = bassPcAt(h);
			if (max === 0) {
				w = chordWeights(fallbackChs, h * HALF, (h + 1) * HALF);
				max = Math.max(...w);
				// 推定ではベース音を根音の先験として最大の重みで足す（経過音に埋もれない）。
				if (max > 0 && bassPc !== null) w[bassPc] += max;
				threshold = 0.3;
				if (max > 0 && chordTrack) fallbackHalves++;
			}
			const pcs = new Set<number>();
			const addTop = (weights: number[], th: number, limit: number): void => {
				const top = Math.max(...weights);
				if (top <= 0) return;
				const order = weights
					.map((v, pc) => ({ v, pc }))
					.filter((x) => x.v >= top * th && !pcs.has(x.pc))
					.sort((a, b) => b.v - a.v);
				for (const x of order) if (pcs.size < limit) pcs.add(x.pc);
			};
			if (max > 0) addTop(w, threshold, threshold === 0.25 ? 4 : 5);
			// 和音 ch が2音以下（ダイアド）の半小節は、ベース音を根音にした名前が付くならそれを採り、
			// 付かなければ他の伴奏 ch で3〜4音まで補ってから、なおベース根音を優先して名付ける。
			const dyad = threshold === 0.25 && pcs.size < 3 && pcs.size > 0;
			let named = dyad ? nameChord(pcs, bassPc, mode, true) : null;
			if (dyad && (!named || named.root !== bassPc))
				addTop(
					chordWeights(
						fallbackChs.filter((ch) => !chordChs.includes(ch)),
						h * HALF,
						(h + 1) * HALF,
					),
					0.5,
					4,
				);
			if (!dyad || !named || named.root !== bassPc)
				named = nameChord(pcs, bassPc, mode, dyad);
			chordNames.push(named?.name ?? null);
			chordRoots.push(named?.root ?? null);
			if (
				DEBUG_BARS &&
				barOf(h * HALF) >= DEBUG_BARS[0] &&
				barOf(h * HALF) <= DEBUG_BARS[1]
			)
				console.log(
					`    half ${h} (bar ${barOf(h * HALF)}) ${threshold === 0.25 ? "chord-ch" : "fallback"} w=${w
						.map((v, pc) => (v > 0 ? `${SHARP[pc]}:${v}` : ""))
						.filter(Boolean)
						.join(
							" ",
						)} bass=${bassPc === null ? "-" : SHARP[bassPc]} → ${named?.name}`,
				);
		}
		return { chordNames, chordRoots, fallbackHalves };
	};
	// 長短は和音ルートの A と C の多い方で決める（estimateKey は平行調を取り違える: A マイナー主体の
	// 曲が major と札付けされ、生成が長調名・陽音階で歌っていた）。同数なら末尾の和音、それも決め手に
	// ならなければ estimateKey。長短が変わると命名の同点処理（調の中の音）が変わるので付け直す。
	let mode = keyMode;
	let named = nameHalves(mode);
	{
		const roots = named.chordRoots.filter((r): r is number => r !== null);
		const a = roots.filter((r) => r === 9).length;
		const c = roots.filter((r) => r === 0).length;
		const last = roots[roots.length - 1];
		const byRoots: "minor" | "major" | null =
			a > c
				? "minor"
				: c > a
					? "major"
					: last === 9
						? "minor"
						: last === 0
							? "major"
							: null;
		if (byRoots && byRoots !== mode) {
			mode = byRoots;
			named = nameHalves(mode);
			warnings.push(
				`長短を和音ルートで ${keyMode} → ${mode} に直した（A ${a} / C ${c}）`,
			);
		}
	}
	const { chordNames, chordRoots, fallbackHalves } = named;
	if (fallbackHalves > 0)
		warnings.push(
			`和音 ch が鳴らない半小節 ${fallbackHalves}/${halves} は全 ch から推定`,
		);
	// 継続の解決: 決まらない半小節は前を引き継ぐ。先頭が空なら最初に決まった和音で埋める。
	const firstIdx = chordNames.findIndex((c) => c !== null);
	if (firstIdx < 0) {
		warnings.push("和音が1つも決まらない");
		return null;
	}
	if (firstIdx > 0)
		warnings.push(`先頭 ${firstIdx} 半小節は和音無し（最初の和音で埋めた）`);
	const resolvedNames: string[] = [];
	const resolvedRoots: number[] = [];
	for (let h = 0; h < halves; h++) {
		const name =
			chordNames[h] ?? (h === 0 ? chordNames[firstIdx] : resolvedNames[h - 1]);
		const root =
			chordRoots[h] ??
			(h === 0 ? (chordRoots[firstIdx] as number) : resolvedRoots[h - 1]);
		resolvedNames.push(name as string);
		resolvedRoots.push(root);
	}

	// --- 主旋律の小節ごとの rhythm / degrees ---
	const melodyBars: SkeletonBar["melody"][] = new Array(song.bars).fill(null);
	let truncated = 0;
	if (mel) {
		const byBar = new Map<number, MetricNote[]>();
		for (const n of mel.notes) {
			const list = byBar.get(barOf(n.startStep)) ?? [];
			list.push(n);
			byBar.set(barOf(n.startStep), list);
		}
		for (const [b, ns] of byBar) {
			if (b >= song.bars) continue;
			ns.sort((a, c) => a.startStep - c.startStep);
			const from = b * BAR;
			const rhythm: number[] = [];
			const degrees: number[] = [];
			let cursor = 0;
			for (let i = 0; i < ns.length; i++) {
				const at = ns[i].startStep - from;
				if (at < cursor) continue;
				if (at > cursor) rhythm.push(-(at - cursor));
				const nextAt = i + 1 < ns.length ? ns[i + 1].startStep - from : BAR;
				const dur = Math.max(
					GRID,
					Math.min(ns[i].durationSteps, nextAt - at, BAR - at),
				);
				if (ns[i].durationSteps > BAR - at) truncated++;
				rhythm.push(dur);
				degrees.push(toAbsDegree(tp(ns[i].pitchSemi)));
				cursor = at + dur;
			}
			if (cursor < BAR) rhythm.push(-(BAR - cursor));
			if (degrees.length > 0) melodyBars[b] = { rhythm, degrees };
		}
	}
	if (truncated > 0)
		warnings.push(`小節線をまたぐ主旋律の音 ${truncated} 個を小節末で切った`);

	// --- セクション ---
	const sections: SkeletonSection[] = [];
	const sectionOfBar = new Array<number>(song.bars).fill(-1);
	const unitCount = Math.ceil(song.bars / UNIT);
	const unitSings: boolean[] = [];
	for (let u = 0; u < unitCount; u++) {
		let n = 0;
		for (let b = u * UNIT; b < Math.min(song.bars, (u + 1) * UNIT); b++)
			if (melodyBars[b]) n++;
		unitSings.push(n >= 2);
	}
	const barSig = (b: number, pitched = false): Set<string> => {
		const set = new Set<string>();
		const m = melodyBars[b];
		if (!m) return set;
		let at = 0;
		let i = 0;
		for (const v of m.rhythm) {
			if (v > 0) set.add(pitched ? `${at}:${m.degrees[i++]}` : String(at));
			at += Math.abs(v);
		}
		return set;
	};
	type Block = { start: number; bars: number; cluster: number };
	const blocks: Block[] = [];
	const clusterFirst: Block[] = [];
	// 塊の類似はリズムだけでは足りない（界隈曲はAメロもサビも8分の詠唱で、打点集合が似る）。
	// 打点＋度数の一致を主に、打点だけの一致を従にして混ぜる。
	const blockSimilarity = (a: Block, b: Block): number => {
		const len = Math.min(a.bars, b.bars);
		let s = 0;
		for (let i = 0; i < len; i++)
			s +=
				0.35 * jaccard(barSig(a.start + i), barSig(b.start + i)) +
				0.65 * jaccard(barSig(a.start + i, true), barSig(b.start + i, true));
		return s / len;
	};
	const clusterMembers = new Map<number, Block[]>();
	const similarityToCluster = (cluster: number, block: Block): number =>
		Math.max(
			...(clusterMembers.get(cluster) ?? []).map((m) =>
				blockSimilarity(m, block),
			),
		);
	const spans: { start: number; end: number; sings: boolean }[] = [];
	for (let u = 0; u < unitCount; u++) {
		const start = u * UNIT;
		const end = Math.min(song.bars, start + UNIT);
		const last = spans[spans.length - 1];
		if (last && last.sings === unitSings[u]) last.end = end;
		else spans.push({ start, end, sings: unitSings[u] });
	}
	const roleNotes: string[] = [];
	for (const span of spans) {
		if (!span.sings) continue;
		for (let s = span.start; s < span.end; s += 8) {
			const block: Block = {
				start: s,
				bars: Math.min(8, span.end - s),
				cluster: -1,
			};
			let bestSim = 0;
			for (const first of clusterFirst) {
				const sim = similarityToCluster(first.cluster, block);
				if (sim > bestSim) {
					bestSim = sim;
					block.cluster = first.cluster;
				}
			}
			// 8小節に満たない端の塊は新しい塊にしない（前の塊へ付ける）。
			const tail = block.bars < 8 && blocks.length > 0;
			if (bestSim < CLUSTER_THRESHOLD && !tail) {
				block.cluster = clusterFirst.length;
				clusterFirst.push(block);
			} else if (bestSim < CLUSTER_THRESHOLD && tail)
				block.cluster = blocks[blocks.length - 1].cluster;
			blocks.push(block);
			clusterMembers.set(block.cluster, [
				...(clusterMembers.get(block.cluster) ?? []),
				block,
			]);
		}
	}
	// 塊の役割: 最初の塊が verse、残りで**小節数が最も多い**塊（同数なら音域中心、次に音数）が
	// chorus、他は bridge。音域中心だけで選ぶと、界隈曲の多回サビ（低めの詠唱）より高いBメロが
	// サビになる（あさやけ・ヤツメ穴で実測）。
	const clusterStat = clusterFirst.map((first) => {
		const members = blocks.filter((b) => b.cluster === first.cluster);
		let degSum = 0;
		let notes = 0;
		let bars = 0;
		for (const m of members)
			for (let b = m.start; b < m.start + m.bars; b++) {
				const mb = melodyBars[b];
				if (!mb) continue;
				bars++;
				for (const d of mb.degrees) {
					degSum += d;
					notes++;
				}
			}
		return {
			center: notes ? degSum / notes : 0,
			density: bars ? notes / bars : 0,
			total: members.reduce((s, m) => s + m.bars, 0),
		};
	});
	const roleOfCluster = new Map<number, SkeletonSectionKind>();
	if (clusterFirst.length > 0) roleOfCluster.set(0, "verse");
	if (clusterFirst.length >= 2) {
		let chorus = 1;
		for (let c = 2; c < clusterFirst.length; c++) {
			const a = clusterStat[c];
			const b = clusterStat[chorus];
			if (
				a.total > b.total ||
				(a.total === b.total &&
					(a.center > b.center + 1e-9 ||
						(Math.abs(a.center - b.center) < 1e-9 && a.density > b.density)))
			)
				chorus = c;
		}
		roleOfCluster.set(chorus, "chorus");
		for (let c = 1; c < clusterFirst.length; c++)
			if (!roleOfCluster.has(c)) roleOfCluster.set(c, "bridge");
		roleNotes.push(
			`塊 ${clusterFirst.length}（8小節）: verse=塊0 chorus=塊${chorus}（小節 ${clusterStat.map((s) => s.total).join("/")}・中心 ${clusterStat.map((s) => s.center.toFixed(1)).join("/")}）`,
		);
	} else if (clusterFirst.length === 1) {
		warnings.push("主旋律のリズムの塊が1つ（全部 verse）");
	}
	// スパン → セクション（歌わない区間は intro/interlude/outro、歌う区間は塊の役割）
	const firstSing = spans.findIndex((s) => s.sings);
	const lastSing = spans.map((s) => s.sings).lastIndexOf(true);
	const push = (
		kind: SkeletonSectionKind,
		start: number,
		bars: number,
	): void => {
		const last = sections[sections.length - 1];
		if (last && last.kind === kind && last.start + last.bars === start)
			last.bars += bars;
		else sections.push({ kind, start, bars });
	};
	spans.forEach((span, i) => {
		if (!span.sings) {
			const kind: SkeletonSectionKind =
				firstSing < 0 || i < firstSing
					? "intro"
					: i > lastSing
						? "outro"
						: "interlude";
			push(kind, span.start, span.end - span.start);
			return;
		}
		for (const block of blocks.filter(
			(b) => b.start >= span.start && b.start < span.end,
		))
			push(
				roleOfCluster.get(block.cluster) ?? "verse",
				block.start,
				block.bars,
			);
	});
	sections.forEach((s, i) => {
		for (let b = s.start; b < s.start + s.bars; b++) sectionOfBar[b] = i;
	});
	if (firstSing < 0) warnings.push("歌う小節が無い（全部 intro）");

	// --- sameAs / rhythmSameAs（曲頭からの先行小節。セクションを跨ぐ: 2番サビ＝1番サビ） ---
	const sameAs: (number | null)[] = new Array(song.bars).fill(null);
	const rhythmSameAs: (number | null)[] = new Array(song.bars).fill(null);
	for (let b = 0; b < song.bars; b++) {
		const m = melodyBars[b];
		if (!m) continue;
		for (let p = 0; p < b; p++) {
			const q = melodyBars[p];
			if (!q) continue;
			const rhythmEq = q.rhythm.join(",") === m.rhythm.join(",");
			if (!rhythmEq) continue;
			if (q.degrees.join(",") === m.degrees.join(",")) {
				sameAs[b] = p;
				break;
			}
			if (rhythmSameAs[b] === null) rhythmSameAs[b] = p;
		}
		if (sameAs[b] !== null) rhythmSameAs[b] = null;
	}

	// --- ベース ---
	const bassBars: SkeletonBar["bass"][] = [];
	for (let b = 0; b < song.bars; b++)
		bassBars.push({ steps: [], rel: [], durs: [] });
	if (bass)
		for (const n of bass.notes) {
			const b = barOf(n.startStep);
			if (b < 0 || b >= song.bars) continue;
			const h = Math.floor(n.startStep / HALF);
			const root = resolvedRoots[Math.min(h, halves - 1)];
			bassBars[b].steps.push(n.startStep % BAR);
			bassBars[b].rel.push(tp(n.pitchSemi) - (36 + root));
			bassBars[b].durs.push(
				Math.min(n.durationSteps, BAR - (n.startStep % BAR)),
			);
		}

	// --- 層 ---
	const layersBars: SkeletonLayers[] = [];
	for (let b = 0; b < song.bars; b++)
		layersBars.push({ arp: false, pad: false, counter: false, stab: false });
	let arpBarCount = 0;
	const melodyOnsets = (b: number): Set<string> => barSig(b);
	for (const [ch, ns] of song.channels) {
		if (ch === melodyCh || ch === bassCh) continue;
		const byBar = new Map<number, MetricNote[]>();
		for (const n of ns) {
			for (
				let b = barOf(n.startStep);
				b <= barOf(n.startStep + n.durationSteps - 1);
				b++
			) {
				if (b < 0 || b >= song.bars) continue;
				const list = byBar.get(b) ?? [];
				list.push(n);
				byBar.set(b, list);
			}
		}
		for (const [b, sounding] of byBar) {
			const from = b * BAR;
			const starts = sounding.filter(
				(n) => n.startStep >= from && n.startStep < from + BAR,
			);
			const stacked = stackedRatio(starts);
			const L = layersBars[b];
			if (starts.length >= 8 && stacked < 0.2) {
				const pcs = new Set(starts.map((n) => pcOf(n.pitchSemi)));
				const ps = starts.map((n) => n.pitchSemi);
				const mono = toMonophonic(starts);
				let turns = 0;
				let lastDir = 0;
				for (let i = 1; i < mono.length; i++) {
					const dir = Math.sign(mono[i].pitchSemi - mono[i - 1].pitchSemi);
					if (dir === 0) continue;
					if (lastDir !== 0 && dir !== lastDir) turns++;
					lastDir = dir;
				}
				if (
					pcs.size >= 2 &&
					pcs.size <= 4 &&
					Math.max(...ps) - Math.min(...ps) <= 24 &&
					turns >= 2
				) {
					if (!L.arp) arpBarCount++;
					L.arp = true;
					continue;
				}
			}
			if (
				stacked >= 0.5 &&
				starts.length >= 2 &&
				median(starts.map((n) => n.durationSteps)) < 96
			) {
				L.stab = true;
				continue;
			}
			const longest = Math.max(...sounding.map((n) => n.durationSteps));
			if (starts.length <= 4 && longest >= 96) {
				L.pad = true;
				continue;
			}
			if (stacked < 0.2 && starts.length >= 2 && starts.length <= 7) {
				const onsets = new Set(starts.map((n) => String(n.startStep - from)));
				if (jaccard(onsets, melodyOnsets(b)) < 0.8) L.counter = true;
			}
		}
	}

	// --- 小節データ ---
	const barsData: SkeletonBar[] = [];
	for (let b = 0; b < song.bars; b++) {
		const c0 = resolvedNames[b * 2];
		const c1 = resolvedNames[b * 2 + 1];
		const prev = b === 0 ? null : resolvedNames[b * 2 - 1];
		barsData.push({
			chords: [b === 0 || c0 !== prev ? c0 : null, c1 !== c0 ? c1 : null],
			bass: bassBars[b],
			melody: melodyBars[b],
			sameAs: sameAs[b],
			rhythmSameAs: rhythmSameAs[b],
			layers: layersBars[b],
		});
	}

	const drumSig = dominantDrumSig(song);
	const melodyProgram = mel ? (song.programs.get(mel.ch) ?? null) : null;
	const skeleton: Skeleton = {
		id,
		mode,
		bpm: song.bpm,
		bars: song.bars,
		sections,
		barsData,
		drum: drumSig ? "" : "none",
		chordPattern: pickChordPattern(
			song,
			chordChs,
			[melodyCh, bassCh],
			arpBarCount,
		),
		melodyCenter: mel ? median(mel.notes.map((n) => n.pitchSemi)) : 0,
		programs: {
			melody: melodyProgram,
			bass: bass ? (song.programs.get(bass.ch) ?? null) : null,
			chord:
				chordChs.length > 0 ? (song.programs.get(chordChs[0]) ?? null) : null,
		},
		instrument: nearestPreset(melodyProgram),
		confidence: {
			chordTrack,
			melodyBy: `${mel ? mel.by : "無し"}${chordTrack ? `; 和音 ch${chordChs.join(",")}` : ""}${bass ? `; ベース ch${bass.ch}` : ""}; ${roleNotes.join(" ")}`,
			warnings,
		},
	};
	return { skeleton, drumSig };
};

// ============================================================
// ドラム型の割り当て（全曲を見てから、合わない型の多い順に kaiwai_<n> を足す）
// ============================================================

const assignDrums = (
	items: Extracted[],
): {
	key: string;
	label: string;
	origin: string;
	sig: DrumSig;
	usesClap: boolean;
}[] => {
	const builtin: { key: string; sig: DrumSig }[] = Object.entries(DRUM_PATTERNS)
		.filter(([k]) => !k.startsWith(NEW_DRUM_PREFIX))
		.map(([k, def]) => ({ key: k, sig: sigOfPattern(def.pattern) }));
	const added: {
		key: string;
		label: string;
		origin: string;
		sig: DrumSig;
		usesClap: boolean;
	}[] = [];
	const bestOf = (sig: DrumSig): { key: string; score: number } => {
		let best = { key: "none", score: -1 };
		for (const p of [...builtin, ...added]) {
			const score = jaccard(sig, p.sig);
			if (score > best.score) best = { key: p.key, score };
		}
		return best;
	};
	const pending = items.filter((x) => x.drumSig);
	for (let round = 0; round < MAX_NEW_DRUMS; round++) {
		const unmatched = pending.filter(
			(x) => bestOf((x.drumSig as { sig: DrumSig }).sig).score < DRUM_MATCH,
		);
		if (unmatched.length === 0) break;
		// 合わない曲どうしで最も仲間の多い型を新しい固定パターンにする。
		let pick = unmatched[0];
		let pickN = -1;
		for (const x of unmatched) {
			const sig = (x.drumSig as { sig: DrumSig }).sig;
			const n = unmatched.filter(
				(y) => jaccard(sig, (y.drumSig as { sig: DrumSig }).sig) >= DRUM_MATCH,
			).length;
			if (n > pickN) {
				pickN = n;
				pick = x;
			}
		}
		const d = pick.drumSig as { sig: DrumSig; usesClap: boolean };
		added.push({
			key: `${NEW_DRUM_PREFIX}${added.length + 1}`,
			label: `界隈曲 骨格${added.length + 1}`,
			origin: pick.skeleton.id,
			sig: d.sig,
			usesClap: d.usesClap,
		});
	}
	for (const x of items) {
		if (!x.drumSig) continue;
		const best = bestOf(x.drumSig.sig);
		x.skeleton.drum = best.key;
		if (best.score < DRUM_MATCH)
			x.skeleton.confidence.warnings.push(
				`ドラム型の一致率 ${best.score.toFixed(2)}（${best.key} を当てた）`,
			);
	}
	return added;
};

// ============================================================
// 出力と検算
// ============================================================

const renderTs = (encoded: EncodedSkeleton[], songs: number): string => {
	const lines: string[] = [];
	lines.push(`/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/corpus/extract-skeletons.ts --dir <界隈曲のフォルダ> --out src/compose/compose-skeletons.ts
 *
 * 界隈曲の耳コピ ${songs} 本から抜き出した骨格（曲ごとの設計図）。形と符号化は
 * {@link file://./skeleton-types.ts}、抽出の手順は {@link file://../../scripts/corpus/extract-skeletons.ts}。
 */

import {
	decodeSkeleton,
	type EncodedSkeleton,
	type Skeleton,
} from "./skeleton-types";

const DATA: EncodedSkeleton[] = [`);
	for (const e of encoded) {
		lines.push("\t{");
		lines.push(`\t\tid: ${JSON.stringify(e.id)},`);
		lines.push(`\t\tmode: ${JSON.stringify(e.mode)},`);
		lines.push(`\t\tbpm: ${e.bpm},`);
		lines.push(`\t\tbars: ${e.bars},`);
		lines.push(`\t\tsections: ${JSON.stringify(e.sections)},`);
		lines.push(`\t\tdrum: ${JSON.stringify(e.drum)},`);
		lines.push(`\t\tchordPattern: ${JSON.stringify(e.chordPattern)},`);
		lines.push(`\t\tmelodyCenter: ${e.melodyCenter},`);
		lines.push(`\t\tprograms: ${JSON.stringify(e.programs)},`);
		lines.push(`\t\tinstrument: ${JSON.stringify(e.instrument)},`);
		lines.push(
			`\t\tconfidence: { chordTrack: ${e.confidence.chordTrack}, melodyBy: ${JSON.stringify(e.confidence.melodyBy)}, warnings: ${JSON.stringify(e.confidence.warnings)} },`,
		);
		lines.push("\t\tbarsData: [");
		for (const b of e.barsData) lines.push(`\t\t\t${JSON.stringify(b)},`);
		lines.push("\t\t],");
		lines.push("\t},");
	}
	lines.push("];");
	lines.push("");
	lines.push(
		"export const KAIWAI_SKELETONS: Skeleton[] = DATA.map(decodeSkeleton);",
	);
	lines.push("");
	return lines.join("\n");
};

// ============================================================
// main
// ============================================================

const main = async (): Promise<void> => {
	const out = resolve(argOf("--out") ?? "src/compose/compose-skeletons.ts");
	const drumPath = resolve("src/instruments/drum-config.ts");
	if (argv.includes("--check") && !argOf("--dir")) {
		const mod = (await import(pathToFileURL(out).href)) as {
			KAIWAI_SKELETONS: Skeleton[];
		};
		const errors = validateSkeletons(
			mod.KAIWAI_SKELETONS,
			new Set(Object.keys(DRUM_PATTERNS)),
		);
		for (const e of errors) console.log(`NG ${e}`);
		console.log(
			`● 検算 ${mod.KAIWAI_SKELETONS.length}本: ${errors.length === 0 ? "OK" : `NG ${errors.length}`}`,
		);
		if (errors.length > 0) process.exit(1);
		return;
	}
	const dir = argOf("--dir");
	if (!dir) {
		console.error("--dir <界隈曲のフォルダ> が要ります");
		process.exit(1);
	}
	const show = argOf("--show");
	const { picked } = collectSongs(dir);
	const items: Extracted[] = [];
	const failed: string[] = [];
	for (const c of picked) {
		if (show && !c.songKey.includes(show)) continue;
		try {
			const x = extractSkeleton(c.buf, `${c.songKey} (${basename(c.rel)})`);
			if (x) items.push(x);
			else failed.push(`${c.songKey}: 抽出不能`);
		} catch (e) {
			failed.push(`${c.songKey}: ${(e as Error).message}`);
		}
	}
	const added = assignDrums(items);

	if (show) {
		for (const x of items) {
			const s = x.skeleton;
			console.log(
				`=== ${s.id} ${s.mode} ${s.bpm}bpm ${s.bars}小節 drum=${s.drum} pattern=${s.chordPattern} inst=${s.instrument} center=${s.melodyCenter}`,
			);
			console.log(`  ${s.confidence.melodyBy}`);
			for (const w of s.confidence.warnings) console.log(`  ! ${w}`);
			console.log(
				`  sections: ${s.sections.map((z) => `${z.kind}@${z.start}+${z.bars}`).join(" ")}`,
			);
			let prev = "";
			const line: string[] = [];
			s.barsData.forEach((b, i) => {
				const c0 = b.chords[0] ?? prev;
				const c1 = b.chords[1] ?? c0;
				prev = c1;
				line.push(
					`${i}:${c0}${b.chords[1] ? ` ${c1}` : ""}${b.melody ? "*" : ""}`,
				);
			});
			console.log(`  ${line.join(" | ")}`);
		}
		return;
	}

	writeDrumConfig(drumPath, added);
	const encoded = items.map((x) => encodeSkeleton(x.skeleton));
	writeFileSync(out, renderTs(encoded, items.length), "utf8");
	try {
		execSync(`npx biome format --write "${out}" "${drumPath}"`, {
			stdio: "ignore",
		});
	} catch {
		console.log("  biome format に失敗（手で通すこと）");
	}

	// 検算: 符号化→復号の往復と、生成側が前提にする不変条件。
	const decoded = encoded.map(decodeSkeleton);
	const roundTrip = decoded.every(
		(d, i) => JSON.stringify(d) === JSON.stringify(items[i].skeleton),
	);
	const drumKeys = new Set([
		...Object.keys(DRUM_PATTERNS).filter((k) => !k.startsWith(NEW_DRUM_PREFIX)),
		...added.map((a) => a.key),
	]);
	const errors = validateSkeletons(decoded, drumKeys);
	if (!roundTrip) errors.push("符号化の往復が一致しない");

	// 要約
	const secCount = new Map<string, number>();
	const drumCount = new Map<string, number>();
	const warnCount = new Map<string, number>();
	let chordTrackYes = 0;
	for (const x of items) {
		const s = x.skeleton;
		for (const sec of s.sections)
			secCount.set(sec.kind, (secCount.get(sec.kind) ?? 0) + 1);
		drumCount.set(s.drum, (drumCount.get(s.drum) ?? 0) + 1);
		if (s.confidence.chordTrack) chordTrackYes++;
		for (const w of s.confidence.warnings) {
			const k = w.replace(/[\d.]+/g, "n");
			warnCount.set(k, (warnCount.get(k) ?? 0) + 1);
		}
	}
	const size = Buffer.byteLength(readFileSync(out, "utf8"));
	console.log(
		`● 骨格 ${items.length}本 → ${out}（${(size / 1024).toFixed(0)}KB）`,
	);
	for (const f of failed) console.log(`  抽出不能: ${f}`);
	console.log(
		`  和音 ch あり ${chordTrackYes} / なし ${items.length - chordTrackYes}`,
	);
	console.log(
		`  セクション: ${[...secCount].map(([k, n]) => `${k}×${n}`).join(" ")}`,
	);
	console.log(
		`  ドラム型: ${[...drumCount]
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => `${k}×${n}`)
			.join(" ")}`,
	);
	console.log(
		`  追加した固定パターン: ${added.map((a) => `${a.key}（${a.origin}）`).join(", ") || "無し"}`,
	);
	console.log("  警告:");
	for (const [k, n] of [...warnCount].sort((a, b) => b[1] - a[1]))
		console.log(`    ${n}× ${k}`);
	for (const e of errors) console.log(`NG ${e}`);
	console.log(`● 検算: ${errors.length === 0 ? "OK" : `NG ${errors.length}`}`);
	if (errors.length > 0) process.exit(1);
};

if (basename(process.argv[1] ?? "").includes("extract-skeletons")) void main();
