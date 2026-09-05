/**
 * 受け入れ基準を**人間の曲から採る**ための較正スクリプト。
 *
 * `src/compose.ts` のしきい値（`MIN_ENTROPY_BITS = 1.1` など）は、もともと手で決めた
 * 定数だった。「勘で決めた代理指標」のままでは、いくら引き直しても人間の曲に近づく
 * 保証が無い。そこで人間が書いたMIDIから `src/compose-metrics.ts` と**同じ指標**を
 * 抽出し、その分布のパーセンタイルを目標帯として `src/compose-corpus.ts` へ書き出す。
 *
 *   # ローカルのMIDIフォルダから較正する
 *   npx tsx scripts/calibrate-corpus.ts --dir "C:/path/to/midis"
 *
 *   # picotune から取ってきて較正する（AGENTS.md のAPI）
 *   npx tsx scripts/calibrate-corpus.ts --api --limit 200
 *
 * 生成された `src/compose-corpus.ts` はコミットする。実行時にネットワークを触らせない
 * ため、較正は開発時に済ませて定数として焼き込む。
 *
 * ## MIDIパーサを内蔵している理由
 *
 * 依存の `midi-json-parser` はWorker前提でNodeから素直に呼べない。ここは開発用
 * スクリプトなので、標準MIDIファイルを読むだけの最小のパーサを持ち、
 * `extractMidiPlacements` が期待する形（`{division, format, tracks}`）へ変換して渡す。
 * **役割分類（melody/submelody/bass/chord）はアプリ本体と同じ関数を通す**ので、
 * 「較正に使った定義」と「実行時の定義」がずれない。
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { durationEntropy } from "../src/compose";
import {
	type MetricNote,
	type StructureFeatures,
	structureFeatures,
} from "../src/compose-metrics";

const STEPS_PER_BAR = 192;
const DEBUG = process.argv.includes("--debug");

// ============================================================
// 最小SMFパーサ（開発用スクリプト内でのみ使う）
// ============================================================

type MidiEvent = {
	delta: number;
	channel?: number;
	noteOn?: { noteNumber: number; velocity: number };
	noteOff?: { noteNumber: number; velocity: number };
	setTempo?: { microsecondsPerQuarter: number };
};

export const parseSmf = (
	buf: Buffer,
): { division: number; format: number; tracks: MidiEvent[][] } => {
	let p = 0;
	const u32 = (): number => {
		const v = buf.readUInt32BE(p);
		p += 4;
		return v;
	};
	const u16 = (): number => {
		const v = buf.readUInt16BE(p);
		p += 2;
		return v;
	};
	if (buf.toString("ascii", 0, 4) !== "MThd")
		throw new Error("not a MIDI file");
	p = 4;
	const headerLength = u32();
	const format = u16();
	const trackCount = u16();
	const division = u16();
	p = 8 + headerLength;

	const tracks: MidiEvent[][] = [];
	for (let t = 0; t < trackCount; t++) {
		if (buf.toString("ascii", p, p + 4) !== "MTrk") break;
		p += 4;
		// u32() が p を進めるので、長さを先に取り出してから終端を出す
		// （`p + u32()` と書くと左辺の p が加算前の値で評価され、4バイト手前で切れる）
		const trackLength = u32();
		const end = p + trackLength;
		const events: MidiEvent[] = [];
		let running = 0;
		while (p < end) {
			// 可変長デルタタイム
			let delta = 0;
			let b: number;
			do {
				b = buf[p++];
				delta = (delta << 7) | (b & 0x7f);
			} while (b & 0x80);

			let status = buf[p];
			if (status & 0x80) {
				p++;
				running = status;
			} else {
				status = running; // ランニングステータス
			}
			const type = status & 0xf0;
			const channel = status & 0x0f;

			if (status === 0xff) {
				const metaType = buf[p++];
				let length = 0;
				let lb: number;
				do {
					lb = buf[p++];
					length = (length << 7) | (lb & 0x7f);
				} while (lb & 0x80);
				const data = buf.subarray(p, p + length);
				p += length;
				if (metaType === 0x51 && length === 3) {
					events.push({
						delta,
						setTempo: {
							microsecondsPerQuarter:
								(data[0] << 16) | (data[1] << 8) | data[2],
						},
					});
				} else {
					events.push({ delta });
				}
			} else if (status === 0xf0 || status === 0xf7) {
				let length = 0;
				let lb: number;
				do {
					lb = buf[p++];
					length = (length << 7) | (lb & 0x7f);
				} while (lb & 0x80);
				p += length;
				events.push({ delta });
			} else if (type === 0xc0 || type === 0xd0) {
				p += 1;
				events.push({ delta, channel });
			} else {
				const a = buf[p++];
				const b2 = buf[p++];
				if (type === 0x90 && b2 > 0)
					events.push({
						delta,
						channel,
						noteOn: { noteNumber: a, velocity: b2 },
					});
				else if (type === 0x80 || type === 0x90)
					events.push({
						delta,
						channel,
						noteOff: { noteNumber: a, velocity: b2 },
					});
				else events.push({ delta, channel });
			}
		}
		p = end;
		tracks.push(events);
	}
	return { division, format, tracks };
};

// ============================================================
// 1曲ぶんの特徴抽出
// ============================================================

/** 主旋律の取り出し元の内訳（役割分類が当たったのか、フォールバックなのか）。 */
const sourceCounts: Record<string, number> = {};

/**
 * 声部をひとつの単旋律へ均す。**和音の判定には使わない**——レガートやリリースで
 * 前の音に少し重なるのは旋律でも普通に起きるので、重なりの有無で旋律かどうかを
 * 決めると本物の主旋律まで落ちる（実測: この扱いを誤ると、採用54曲のうち41曲で
 * 疎な合いの手のほうを「メロディ」として測っていた）。
 * ここでは前の音を次の音の手前で切るだけ。
 */
/** 16分の格子。人間の演奏MIDIは音価が数ティックずつ揺れるため、測る前に丸める。 */
const GRID = STEPS_PER_BAR / 16;

/**
 * 音価と位置を16分の格子へ丸める。
 *
 * 生成物は必ず格子の上に置かれるので、丸めずに比べると**人間の曲だけが不当に
 * 「音価の種類が多い」ことになる**。実測で音価の種類数の p95 が 48.6（＝1音ごとに
 * 違う長さ）まで膨らみ、エントロピーの目標帯も 4.4bit まで伸びていた。生成側は
 * 構造上そこへ到達できないので、比べる意味のない帯になっていた。
 */
export const quantize = (ns: MetricNote[]): MetricNote[] =>
	ns.map((n) => ({
		startStep: Math.round(n.startStep / GRID) * GRID,
		pitchSemi: n.pitchSemi,
		durationSteps: Math.max(GRID, Math.round(n.durationSteps / GRID) * GRID),
	}));

export const toMonophonic = (ns: MetricNote[]): MetricNote[] => {
	const sorted = [...ns].sort((a, b) => a.startStep - b.startStep);
	const out: MetricNote[] = [];
	for (const n of sorted) {
		const prev = out[out.length - 1];
		if (prev && prev.startStep === n.startStep) {
			if (n.pitchSemi > prev.pitchSemi) out[out.length - 1] = { ...n }; // 上声を採る
			continue;
		}
		if (prev && prev.startStep + prev.durationSteps > n.startStep)
			prev.durationSteps = n.startStep - prev.startStep;
		out.push({ ...n });
	}
	return out.filter((n) => n.durationSteps > 0);
};

/**
 * このノート列を「主旋律」として較正に使ってよいか。
 *
 * 和音かどうかは**同時に始まる音の割合**で見る。これはレガートの重なりと違い、
 * 旋律ではまず起こらない。伴奏を主旋律と取り違えると、和音を単音へ潰した結果が
 * 「跳躍の中央値が15〜24半音のメロディ」になり、目標帯がまるごと汚染される。
 * 残りの条件はどれも「旋律ならこうはならない」形: 音数が少なすぎる／音価が1種類しかない
 * （パッドや単調なアルペジオ）／恒常的にオクターブ超えで跳ぶ／曲が短すぎる。
 */
export const isPlausibleMelody = (ns: MetricNote[]): boolean => {
	if (ns.length < 32) return false;
	// 同じ音を繰り返しているだけの線（ドラム代わりのパルス等）は旋律ではない
	const pitches = ns.map((n) => n.pitchSemi);
	if (Math.max(...pitches) - Math.min(...pitches) < 5) return false;
	// 同時発音（和音）の検出
	const starts = new Map<number, number>();
	for (const n of ns)
		starts.set(n.startStep, (starts.get(n.startStep) ?? 0) + 1);
	let stacked = 0;
	for (const c of starts.values()) if (c > 1) stacked += c;
	if (stacked / ns.length > 0.05) return false;

	const mono = toMonophonic(ns);
	if (mono.length < 32) return false;
	if (new Set(mono.map((n) => n.durationSteps)).size < 2) return false;
	let maxLeap = 0;
	for (let i = 1; i < mono.length; i++)
		maxLeap = Math.max(
			maxLeap,
			Math.abs(mono[i].pitchSemi - mono[i - 1].pitchSemi),
		);
	if (maxLeap > 19) return false; // 1オクターブ+5度超の跳躍が出る＝和音の潰れ
	const end = Math.max(...mono.map((n) => n.startStep + n.durationSteps));
	return end >= STEPS_PER_BAR * 8;
};

type SongFeatures = StructureFeatures & {
	entropy: number;
	valueKinds: number;
	restRatio: number;
	leapRatio: number;
	maxLeap: number;
	melodyRange: number;
	bars: number;
};

/**
 * MIDIをチャンネル単位のノート列へ展開する（打楽器 ch10 は除く）。
 *
 * 当初はアプリ本体の {@link extractMidiPlacements} を通していた。「較正に使う定義と
 * 実行時の定義を揃える」ためだったが、あれは**役割ごとに複数チャンネルをまとめて
 * 1グループにする**ので、多チャンネルのチップチューンでは主旋律と伴奏が同じ
 * グループへ混ざる。実測で、採用55曲のうち41曲が疎な合いの手のグループを
 * 「メロディ」として測っており、休符率の p75 が 0.92（ほとんど鳴っていない）という
 * 明らかにおかしい帯が出ていた。
 *
 * 役割分類はもともと取り込みUXのためのもので、コーパス採掘用ではない。ここは
 * チャンネル単位で見て、{@link isPlausibleMelody} を通ったものから選ぶ。
 */
export const channelNotes = (
	midi: ReturnType<typeof parseSmf>,
): Map<number, MetricNote[]> => {
	const ticksPerStep = midi.division / 48; // 48ステップ = 4分音符
	const byChannel = new Map<number, MetricNote[]>();
	for (const events of midi.tracks) {
		let tick = 0;
		const open = new Map<string, { pitch: number; start: number }>();
		for (const e of events) {
			tick += e.delta;
			const ch = e.channel ?? 0;
			if (ch === 9) continue; // 打楽器
			if (e.noteOn) {
				open.set(`${ch}:${e.noteOn.noteNumber}`, {
					pitch: e.noteOn.noteNumber,
					start: tick,
				});
			} else if (e.noteOff) {
				const key = `${ch}:${e.noteOff.noteNumber}`;
				const started = open.get(key);
				if (!started) continue;
				open.delete(key);
				const list = byChannel.get(ch) ?? [];
				list.push({
					startStep: Math.round(started.start / ticksPerStep),
					pitchSemi: started.pitch,
					durationSteps: Math.max(
						1,
						Math.round((tick - started.start) / ticksPerStep),
					),
				});
				byChannel.set(ch, list);
			}
		}
	}
	// 曲頭の空白小節を詰める（生成物は必ず0小節目から始まるので揃えておく）
	let earliest = Number.POSITIVE_INFINITY;
	for (const ns of byChannel.values())
		for (const n of ns) earliest = Math.min(earliest, n.startStep);
	if (Number.isFinite(earliest) && earliest >= STEPS_PER_BAR) {
		const shift = Math.floor(earliest / STEPS_PER_BAR) * STEPS_PER_BAR;
		for (const ns of byChannel.values())
			for (const n of ns) n.startStep -= shift;
	}
	for (const ns of byChannel.values())
		ns.sort((a, b) => a.startStep - b.startStep);
	return byChannel;
};

const featuresOf = (buf: Buffer): SongFeatures | null => {
	const midi = parseSmf(buf);
	const byChannel = channelNotes(midi);
	if (byChannel.size === 0) return null;

	// 主旋律 = 条件を満たすチャンネルのうち、**鳴っている時間がいちばん長いもの**。
	// 「いちばん高いチャンネル」で選ぶと、主旋律の上に乗った疎な合いの手を拾ってしまう。
	let melody: MetricNote[] = [];
	let melodyChannel = -1;
	let bestCoverage = -1;
	for (const [ch, ns] of byChannel) {
		if (!isPlausibleMelody(ns)) continue;
		const coverage = ns.reduce((sum, n) => sum + n.durationSteps, 0);
		if (coverage > bestCoverage) {
			bestCoverage = coverage;
			melody = ns;
			melodyChannel = ch;
		}
	}
	if (melody.length === 0) return null;
	sourceCounts.ok = (sourceCounts.ok ?? 0) + 1;

	const mono = toMonophonic(quantize(melody));
	const end = Math.max(...mono.map((n) => n.startStep + n.durationSteps));
	const bars = Math.max(4, Math.ceil(end / STEPS_PER_BAR));
	const opts = { stepsPerBar: STEPS_PER_BAR, bars };

	// 対旋律 = 主旋律以外で、いちばん鳴っている時間が長い単音チャンネル。
	// コール&レスポンスを測るのに要る。
	let submelody: MetricNote[] = [];
	let subCoverage = -1;
	for (const [ch, ns] of byChannel) {
		if (ch === melodyChannel || ns.length < 8) continue;
		const starts = new Map<number, number>();
		for (const n of ns)
			starts.set(n.startStep, (starts.get(n.startStep) ?? 0) + 1);
		let stacked = 0;
		for (const c of starts.values()) if (c > 1) stacked += c;
		if (stacked / ns.length > 0.05) continue; // 和音は対旋律ではない
		const coverage = ns.reduce((sum, n) => sum + n.durationSteps, 0);
		if (coverage > subCoverage) {
			subCoverage = coverage;
			submelody = toMonophonic(quantize(ns));
		}
	}

	if (DEBUG)
		console.log(
			`   ch=${[...byChannel.keys()].join(",")} 主旋律ch${melodyChannel} ${mono.length}音 ${bars}小節 対旋律 ${submelody.length}音`,
		);

	const durations = mono.map((n) => n.durationSteps);
	let leaps = 0;
	let intervals = 0;
	let maxLeap = 0;
	for (let i = 1; i < mono.length; i++) {
		const gap = Math.abs(mono[i].pitchSemi - mono[i - 1].pitchSemi);
		intervals++;
		if (gap > 2) leaps++;
		maxLeap = Math.max(maxLeap, gap);
	}
	const played = durations.reduce((a, b) => a + b, 0);
	const pitches = mono.map((n) => n.pitchSemi);

	return {
		...structureFeatures(mono, submelody, opts),
		entropy: durationEntropy(durations),
		valueKinds: new Set(durations).size,
		restRatio: Math.max(0, 1 - played / (bars * STEPS_PER_BAR)),
		leapRatio: intervals === 0 ? 0 : leaps / intervals,
		maxLeap,
		melodyRange: Math.max(...pitches) - Math.min(...pitches),
		bars,
	};
};

// ============================================================
// 収集
// ============================================================

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** フォルダを再帰的に辿って .mid を集める（曲ごとにフォルダを切ってある構成に合わせる）。 */
export const collectFromDir = (dir: string): Buffer[] => {
	const out: Buffer[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...collectFromDir(full));
		else if (entry.name.toLowerCase().endsWith(".mid"))
			out.push(readFileSync(full));
	}
	return out;
};

const API_BASE = "https://rpgen-search.pages.dev/api";

/**
 * APIトークン。**このファイルに直接書かない**——`AGENTS.md` が唯一の出どころで、
 * トークンが更新されたときに2箇所直す必要が出ないようにしている。
 * 環境変数 `RPGEN_SEARCH_TOKEN` があればそちらを優先する。
 */
const apiToken = (): string => {
	const fromEnv = process.env.RPGEN_SEARCH_TOKEN;
	if (fromEnv) return fromEnv;
	const agents = readFileSync(
		new URL("../AGENTS.md", import.meta.url),
		"utf-8",
	);
	const found = agents.match(/Authorization:\s*Bearer\s+(\S+?)`/);
	if (!found)
		throw new Error(
			"AGENTS.md からAPIトークンを読めませんでした。RPGEN_SEARCH_TOKEN を設定してください。",
		);
	return found[1];
};

/** ダウンロードしたMIDIの置き場。tmp/ は gitignore 済み。 */
const CACHE_DIR = new URL(
	"../tmp/picotune-cache/",
	import.meta.url,
).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const collectFromApi = async (limit: number): Promise<Buffer[]> => {
	mkdirSync(CACHE_DIR, { recursive: true });
	const headers = { Authorization: `Bearer ${apiToken()}` };
	const out: Buffer[] = [];
	for (let page = 1; out.length < limit; page++) {
		const res = await fetch(
			`${API_BASE}/picotune/songs?page=${page}&limit=50`,
			{ headers },
		);
		if (!res.ok) throw new Error(`picotune list: HTTP ${res.status}`);
		const json = (await res.json()) as {
			data?: { file?: string }[];
			error?: string;
			meta?: { hasNext?: boolean };
		};
		if (json.error) throw new Error(`picotune list: ${json.error}`);
		const rows = json.data ?? [];
		if (rows.length === 0) break;
		for (const row of rows) {
			if (!row.file || out.length >= limit) continue;
			// 落としたMIDIは tmp/ へ残す（gitignore 済み）。抽出条件を試行錯誤するたびに
			// 数百曲をダウンロードし直さずに済むようにするため。
			const cached = join(CACHE_DIR, row.file);
			if (existsSync(cached)) {
				out.push(readFileSync(cached));
			} else {
				const midi = await fetch(`${API_BASE}/picotune/songs/${row.file}`, {
					headers,
				});
				if (!midi.ok) continue;
				const buf = Buffer.from(await midi.arrayBuffer());
				writeFileSync(cached, buf);
				out.push(buf);
			}
			if (out.length % 50 === 0) console.log(`  取得 ${out.length}/${limit}`);
		}
		if (!json.meta?.hasNext) break;
	}
	return out;
};

// ============================================================
// パーセンタイル → 目標帯
// ============================================================

const percentile = (sorted: number[], q: number): number => {
	if (sorted.length === 0) return 0;
	const i = (sorted.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * 目標帯 `[lo, idealLo, idealHi, hi]`。中央50%（p25〜p75）を満点、
 * p05〜p95 の外側を0点にする。**「人間の曲として普通の範囲」を満点にする**という
 * 定義で、外れ値を弾きつつ端も完全には切り捨てない。
 */
const bandOf = (values: number[]): [number, number, number, number] => {
	const s = [...values].sort((a, b) => a - b);
	const round = (v: number): number => Math.round(v * 1000) / 1000;
	return [
		round(percentile(s, 0.05)),
		round(percentile(s, 0.25)),
		round(percentile(s, 0.75)),
		round(percentile(s, 0.95)),
	];
};

const main = async (): Promise<void> => {
	const dir = argOf("--dir");
	const useApi = argv.includes("--api");
	const limit = Number.parseInt(argOf("--limit") ?? "200", 10);

	const buffers: Buffer[] = [];
	if (dir) buffers.push(...collectFromDir(dir));
	if (useApi) buffers.push(...(await collectFromApi(limit)));
	if (buffers.length === 0) {
		console.error(
			"MIDIが1本もありません。--dir <フォルダ> か --api を指定してください。",
		);
		process.exit(1);
	}

	const rows: SongFeatures[] = [];
	let skipped = 0;
	for (const buf of buffers) {
		try {
			const f = featuresOf(buf);
			if (f) rows.push(f);
			else skipped++;
		} catch (e) {
			if (DEBUG) console.log("   例外:", (e as Error).message);
			skipped++;
		}
	}
	if (rows.length < 5) {
		console.error(`較正に使えた曲が ${rows.length} 本しかありません。`);
		process.exit(1);
	}

	const keys = [
		"entropy",
		"valueKinds",
		"restRatio",
		"leapRatio",
		"maxLeap",
		"melodyRange",
		"sim1",
		"sim2",
		"sim4",
		"sim8",
		"phraseBreath",
		"climaxPosition",
		"climaxPeaks",
		"complementarity",
	] as const;

	const bands: Record<string, [number, number, number, number]> = {};
	console.log(
		`● コーパス ${rows.length}曲（主旋律を取り出せず除外 ${skipped}本）`,
	);
	console.log(
		`  主旋律の取り出し元: ${Object.entries(sourceCounts)
			.map(([k, v]) => `${k} ${v}`)
			.join(" / ")}`,
	);
	console.log("  指標              p05     p25     p75     p95");
	for (const k of keys) {
		const values = rows.map((r) => r[k] as number).filter(Number.isFinite);
		bands[k] = bandOf(values);
		console.log(
			`  ${k.padEnd(16)}${bands[k].map((v) => v.toFixed(3).padStart(7)).join(" ")}`,
		);
	}

	const body = `/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/calibrate-corpus.ts --dir <MIDIのフォルダ>
 *   npx tsx scripts/calibrate-corpus.ts --api --limit 200
 *
 * 人間が書いた曲 ${rows.length}本 から \`src/compose-metrics.ts\` と同じ指標を抽出し、
 * その分布の中央50%（p25〜p75）を満点、p05〜p95 の外側を0点とする目標帯にしたもの。
 * 手で決めた定数の代わりにこれを使うことで、受け入れ基準が
 * 「勘で決めた代理指標」から「人間の曲から採った代理指標」になる。
 *
 * コーパスを増やして測り直したら、このファイルごと差し替える。
 */

import type { Band } from "./compose-metrics";

/** 較正に使った曲数。少ないほど帯が狭く・偏る点に注意。 */
export const CORPUS_SIZE = ${rows.length};

export const CORPUS_BANDS = {
${keys.map((k) => `\t${k}: [${bands[k].join(", ")}] as Band,`).join("\n")}
} satisfies Record<string, Band>;
`;
	writeFileSync(new URL("../src/compose-corpus.ts", import.meta.url), body);
	console.log("\n  → src/compose-corpus.ts を書き出しました");
};

// 直接実行されたときだけ較正を走らせる（分析スクリプトから部品を import できるように）。
if (process.argv[1]?.includes("calibrate-corpus")) void main();
