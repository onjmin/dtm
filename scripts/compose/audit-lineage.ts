/**
 * 自動作曲の生成物を、所有者が聴く前に機械で点検する。基準は所有者の感想ではなく**流派の原曲（耳コピ）**で、
 * 生成の曲どうしと原曲どうしを同じ物差しで測って並べる。
 *
 *   npx tsx scripts/compose/audit-lineage.ts --template kaiwai_2go_lead --count 100 --out tmp/audit/2go_lead.md
 *   # 特定の seed を標本に足し、その seed どうしの共有も出す
 *   npx tsx scripts/compose/audit-lineage.ts --template kaiwai_speder2_lead --seeds 2201471562,2862405860
 *
 * 点検: ① 曲をまたいだ使い回し（層ごと・2小節ごとの移調を除いた形）② 生成側だけの不変量
 * ③ 歌えるか（音域・重ね・跳躍・息継ぎ）④ 原曲との近さ（最長一致）⑤ 直すべき候補の要約。
 *
 * 耳コピは読むだけ（`tmp/lineage/` と `$KAIWAI_DIR`、既定 `C:/Users/frgk2/Music/_own/自作/界隈曲`）。
 * 音符は出力しない。手元に無ければ生成側だけを出す。
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import {
	type AdvancedLayer,
	buildAdvancedLayers,
} from "../../src/compose/advanced-layers";
import {
	type ComposeResult,
	composeSong,
	seededRandom,
} from "../../src/compose/compose";
import {
	STRUCTURE_TEMPLATES,
	type StructureTemplate,
} from "../../src/compose/compose-sections";
import { DRUM_PATTERNS } from "../../src/instruments/drum-config";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { estimateKey, parseSmf } from "../corpus/calibrate-corpus";

// ============================================================
// 引数
// ============================================================

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : fallback;
};
const TEMPLATES = (arg("template") ?? "kaiwai_2go_lead").split(",");
const COUNT = Number(arg("count", "100"));
const MASTER_SEED = Number(arg("seed", "1"));
const EXTRA_SEEDS = (arg("seeds") ?? "").split(",").filter(Boolean).map(Number);
const WINDOW = Number(arg("window", "2"));
const THRESHOLD = Number(arg("threshold", "0.9"));
const OUT = arg("out");
const USE_REFS = !argv.includes("--no-refs");
const VOCAL_MODE = arg("vocal", "auto"); // auto | on | off

const BAR = 192;
const ROOT = join(__dirname, "../..");
const LINEAGE_DIR = join(ROOT, "tmp/lineage");
const KAIWAI_DIR =
	process.env.KAIWAI_DIR ?? "C:/Users/frgk2/Music/_own/自作/界隈曲";

// ============================================================
// 共通の形
// ============================================================

/** s・d はステップ（1小節=192）、p は MIDI ノート番号。 */
type N = { s: number; d: number; p: number };
type Track = { id: string; label: string; inst: string; notes: N[] };
type VocalPart = { label: string; notes: N[] };
type SongData = {
	/** 生成は seed、原曲は曲名（同じ曲の別の耳コピは同じ title）。 */
	title: string;
	file?: string;
	bpm: number;
	bars: number;
	tracks: Track[];
	drums: N[];
	lead: N[];
	bass: N[];
	vocals: VocalPart[];
	/** 歌の絶対音高が信用できるか（他人の耳コピは記譜オクターブが写譜者で違う）。 */
	vocalAbs: boolean;
	gen?: { song: ComposeResult; layers: AdvancedLayer[]; seed: number };
};

const pct = (x: number): string =>
	Number.isFinite(x) ? `${Math.round(x * 1000) / 10}%` : "-";
const r1 = (x: number): string =>
	Number.isFinite(x) ? String(Math.round(x * 10) / 10) : "-";
const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[Math.floor(s.length / 2)] : Number.NaN;
};
const quant = (xs: number[], q: number): number => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length
		? s[Math.min(s.length - 1, Math.floor(q * s.length))]
		: Number.NaN;
};
const mean = (xs: number[]): number =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
const inc = <K>(m: Map<K, number>, k: K, v = 1): void => {
	m.set(k, (m.get(k) ?? 0) + v);
};

/** 16分（12）と3連（16）の格子のうち近い方へ寄せる。耳コピの揺れを生成と同じ格子に乗せる。 */
const snap = (s: number): number => {
	const a = Math.round(s / 12) * 12;
	const b = Math.round(s / 16) * 16;
	return Math.abs(a - s) <= Math.abs(b - s) ? a : b;
};

/** 同じ発音位置は最高音だけ残し、重なりは切る。 */
const mono = (ns: N[], low = false): N[] => {
	const s = [...ns].sort((a, b) => a.s - b.s || (low ? a.p - b.p : b.p - a.p));
	const out: N[] = [];
	for (const n of s) {
		const pr = out[out.length - 1];
		if (pr && pr.s === n.s) continue;
		if (pr && pr.s + pr.d > n.s) pr.d = n.s - pr.s;
		out.push({ ...n });
	}
	return out.filter((n) => n.d > 0);
};

const secondsOf = (steps: number, bpm: number): number =>
	(steps / 48) * (60 / bpm);

// ============================================================
// 生成
// ============================================================

const LAYER_LABEL: Record<number, string> = {
	0: "t0 主旋律",
	1: "t1 サビ重ね",
	2: "t2 ハモリ",
	3: "t3 サブメロ(静)",
	4: "t4 ベース",
	5: "t5 ベース2",
	6: "t6 パッド",
	7: "t7 伴奏1",
	8: "t8 伴奏2",
	9: "t9 伴奏3",
	10: "t10 ウワモノ",
	11: "t11 掛け合い",
	12: "t12 ハモリ2/持続",
	13: "t13 重ね/なぞり",
	14: "t14 ソロ/サブメロ(盛)",
};

const toN = (
	ns: { startStep: number; durationSteps: number; pitchUnits: number }[],
	shift = 0,
): N[] =>
	ns.map((n) => ({
		s: n.startStep,
		d: n.durationSteps,
		p: Math.round(n.pitchUnits / UNITS_PER_SEMITONE) + shift,
	}));

const templateOf = (name: string) =>
	STRUCTURE_TEMPLATES.find((t) => t.name === name);

/** 歌入り作曲（daw.ts）が歌わせる声部と、そのときの発音オクターブ（vocalOctave）。 */
const sungParts = (song: ComposeResult): VocalPart[] => {
	const spans = song.vocal.duetSpans;
	const inDuet = (s: number): boolean =>
		spans.some(([a, b]) => s >= a && s < b);
	const duetting = spans.length > 0;
	// daw.ts: 主旋律・掛け合い・ハモリは vocalOctave -1、オクターブ重ねは -2。
	const parts: VocalPart[] = [
		{
			label: "主旋律(t0)",
			notes: toN(
				song.melody.filter((n) => !inDuet(n.startStep)),
				-12,
			),
		},
	];
	if (duetting)
		parts.push({
			label: "掛け合い(t11)",
			notes: toN(
				song.melody.filter((n) => inDuet(n.startStep)),
				-12,
			),
		});
	if (song.harmony.length)
		parts.push({ label: "ハモリ(t2)", notes: toN(song.harmony, -12) });
	if (!duetting && song.harmony2.length)
		parts.push({ label: "ハモリ2(t12)", notes: toN(song.harmony2, -12) });
	if (!duetting && song.octave.length)
		parts.push({
			label: "オクターブ下の重ね(t13)",
			notes: toN(song.octave, -24),
		});
	return parts.filter((p) => p.notes.length > 0);
};

const drumNotes = (name: string, bars: number): N[] => {
	const pat = DRUM_PATTERNS[name]?.pattern;
	if (!Array.isArray(pat) || pat.length === 0 || "ranges" in (pat[0] as object))
		return [];
	const len =
		Math.max(1, Math.ceil((Math.max(...pat.map((p) => p.step)) + 1) / BAR)) *
		BAR;
	const out: N[] = [];
	for (let at = 0; at < bars * BAR; at += len)
		for (const p of pat)
			if (at + p.step < bars * BAR)
				out.push({ s: at + p.step, d: 6, p: p.pitch });
	return out;
};

const generate = (template: string, seed: number, sing: boolean): SongData => {
	const song = composeSong({
		random: seededRandom(seed),
		template,
		stepsPerBar: BAR,
		edo: 12,
		baseKey: "any",
		scale: "auto",
	});
	const preset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	const layers = buildAdvancedLayers(song, {
		stepsPerBar: BAR,
		edo: 12,
		preset,
	});
	const instOf = (slot?: string): string =>
		slot
			? ((preset as unknown as Record<string, string>)[slot] ?? "?")
			: "(役割推定)";
	return {
		title: String(seed),
		bpm: song.bpm,
		bars: song.bars,
		tracks: layers
			.filter((l) => l.notes.length > 0)
			.map((l) => ({
				id: `t${l.index}`,
				label: LAYER_LABEL[l.index],
				inst: instOf(l.slot),
				notes: toN(l.notes, 12 * l.octave),
			})),
		drums: drumNotes(song.drum, song.bars),
		lead: toN(song.melody),
		bass: toN(song.bass),
		vocals: sing ? sungParts(song) : [],
		vocalAbs: true,
		gen: { song, layers, seed },
	};
};

// ============================================================
// 原曲（耳コピ）
// ============================================================

/** 役割（主旋律・ベース・歌）のトラック。数字は MIDI のトラック番号、"番号:ch" はチャンネルまで指定。 */
type Roles = {
	lead: (number | string)[];
	bass: (number | string)[];
	vocal?: (number | string)[];
	vocalAbs?: false;
};
// 耳コピのトラック名と音域から手で決めた（scratch/lineage/measure.ts の表を引き継ぎ、歌を足した）。
const ROLES: Record<string, Roles> = {
	"ころんば/demo_c/220324.mid": { lead: [2], bass: [5], vocal: [2] },
	"ころんば/untitled_0346/241010.mid": { lead: [2], bass: [5], vocal: [2] },
	"ころんば/イワシがつちからはえてくるんだ/220510.mid": {
		lead: [3],
		bass: [1],
		vocal: [3, 4, 8, 9],
	},
	"ころんば/クラゲ/240508.mid": { lead: [2], bass: [5], vocal: [2] },
	"ころんば/ヤツメ穴/220626.mid": { lead: [5, 4], bass: [3], vocal: [4, 5] },
	"kaisen/Kurage_Night.mid": {
		lead: [2, 3],
		bass: [16],
		vocal: [2, 3],
		vocalAbs: false,
	},
	"kaisen/Iwashi_Night.mid": {
		lead: [2],
		bass: [17],
		vocal: [2, 3, 4, 5, 6, 7, 8],
		vocalAbs: false,
	},
	"kaisen/Iwashi_sagallium.mid": {
		lead: [8],
		bass: [16],
		vocal: [8, 9, 10, 11, 12, 13, 14],
		vocalAbs: false,
	},
	"kaisen/untitled_0404_ribetsu.mid": {
		lead: ["0:2"],
		bass: ["0:1"],
		vocal: ["0:2"],
		vocalAbs: false,
	},
	"2go/Amber_ikura.mid": { lead: [2, 3], bass: [0] },
	"2go/Andesite_Akatsuki.mid": { lead: [3, 11], bass: [9] },
	"2go/Andesite_ikura.mid": { lead: [2, 4], bass: [3] },
	"2go/Basalt_ikura.mid": { lead: [3, 2, 1], bass: [6] },
	"2go/Granite_ikura.mid": { lead: [0], bass: [3] },
	"2go/Peridotite_ikura.mid": { lead: [0, 2], bass: [4] },
	"2go/Sanukite_ikura.mid": { lead: [0], bass: [1] },
	"2go/SecretPureLove_ikura.mid": { lead: [2, 3], bass: [1] },
	"2go/Sanukite_EveningLunar.mid": { lead: [4, 5], bass: [2] },
	"2go/Granite_EveningLunar.mid": { lead: [2], bass: [3] },
	"2go/Amber_EveningLunar.mid": { lead: [4, 5], bass: [12] },
	"2go/OjisNBass_Night.mid": { lead: [4, 5, 6, 7], bass: [2] },
	"2go/Peridotite_Night.mid": { lead: [2, 3], bass: [9] },
	"2go_extra/GenkyokuWoKizamu_EveningLunar.mid": { lead: [5], bass: [4] },
	"2go_extra/Hyoujo_EveningLunar.mid": { lead: [5], bass: [2] },
	"2go_extra/Hutoi_EveningLunar.mid": { lead: [5, 7, 8], bass: [2] },
	"2go_extra/FCOHremix_EveningLunar.mid": { lead: [2, 7], bass: [5] },
	"speder2/Kikyo_em.mid": { lead: [14, 17], bass: [4] },
	"speder2/Sitsugaiki_EveningLunar.mid": { lead: [6, 8], bass: [3] },
	"speder2/Murasaki_EveningLunar.mid": { lead: [5, 6, 7], bass: [4] },
	"speder2/GhostMayoker_EveningLunar.mid": { lead: [11, 5], bass: [6, 13] },
};
/** 同じ曲の別の耳コピを1曲として数えるための別名。 */
const TITLE_ALIAS: Record<string, string> = {
	Iwashi: "イワシがつちからはえてくるんだ",
	Kurage: "クラゲ",
};
const VOCAL_NAME =
	/vocal|\bvo\b|ボーカル|ウタ|歌|うた|テト|ミク|utau|ずんだ|ハモ|コーラス/i;

const shortName = (f: string): string => {
	const x = f.split("\\").join("/");
	const k = KAIWAI_DIR.split("\\").join("/");
	return x.startsWith(`${k}/`)
		? x.slice(k.length + 1)
		: x.replace(/^.*\/lineage\//, "");
};

const walk = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir).flatMap((e) => {
				const f = join(dir, e);
				return statSync(f).isDirectory()
					? walk(f)
					: e.toLowerCase().endsWith(".mid")
						? [f]
						: [];
			})
		: [];

const loadRef = (file: string, title: string): SongData | null => {
	let midi: ReturnType<typeof parseSmf>;
	try {
		midi = parseSmf(readFileSync(file));
	} catch {
		return null;
	}
	const tps = midi.division / 48;
	const bpms: number[] = [];
	const byKey = new Map<
		string,
		{ idx: number; ch: number; name: string; notes: N[] }
	>();
	const drums: N[] = [];
	midi.tracks.forEach((evs, idx) => {
		let tick = 0;
		let name = "";
		const open = new Map<string, { s: number }>();
		for (const e of evs) {
			tick += e.delta;
			if (e.setTempo)
				bpms.push(
					Math.round((60e6 / e.setTempo.microsecondsPerQuarter) * 10) / 10,
				);
			if (e.trackName && !name) name = e.trackName.trim();
			const ch = e.channel ?? 0;
			if (e.noteOn) open.set(`${ch}:${e.noteOn.noteNumber}`, { s: tick });
			else if (e.noteOff) {
				const k = `${ch}:${e.noteOff.noteNumber}`;
				const o = open.get(k);
				if (!o) continue;
				open.delete(k);
				const n = {
					s: snap(o.s / tps),
					d: Math.max(1, Math.round((tick - o.s) / tps)),
					p: e.noteOff.noteNumber,
				};
				if (ch === 9) drums.push(n);
				else {
					const key = `${idx}:${ch}`;
					const t = byKey.get(key) ?? { idx, ch, name, notes: [] };
					t.notes.push(n);
					byKey.set(key, t);
				}
			}
		}
	});
	const raw = [...byKey.values()].filter((t) => t.notes.length > 0);
	const tracks: Track[] = raw.map((t) => ({
		id: `${t.idx}:${t.ch}`,
		label: t.name || `#${t.idx}`,
		inst: "",
		notes: t.notes.sort((a, b) => a.s - b.s || a.p - b.p),
	}));
	const end = Math.max(
		0,
		...tracks.flatMap((t) => t.notes.map((n) => n.s + n.d)),
	);
	const roles = ROLES[shortName(file)];
	const sel = (spec: (number | string)[]): Track[] =>
		spec.flatMap((x) =>
			tracks.filter((t) =>
				typeof x === "number" ? t.id.startsWith(`${x}:`) : t.id === x,
			),
		);
	let leadTr: Track[];
	let bassTr: Track[];
	let vocTr: Track[];
	const meanP = (t: Track): number => mean(t.notes.map((n) => n.p));
	if (roles) {
		leadTr = sel(roles.lead);
		bassTr = sel(roles.bass);
		vocTr = sel(roles.vocal ?? []);
	} else {
		const cand = tracks.filter((t) => t.notes.length >= 30);
		vocTr = cand.filter((t) => VOCAL_NAME.test(t.label) && meanP(t) > 45);
		const poly = (t: Track): number =>
			t.notes.length / new Set(t.notes.map((n) => n.s)).size;
		leadTr = vocTr.length
			? [vocTr[0]]
			: cand
					.filter((t) => poly(t) < 1.15 && meanP(t) > 55 && meanP(t) < 82)
					.sort((a, b) => b.notes.length - a.notes.length)
					.slice(0, 1);
		bassTr = cand
			.filter((t) => !leadTr.includes(t))
			.sort((a, b) => meanP(a) - meanP(b))
			.slice(0, 1);
		if (bassTr[0] && meanP(bassTr[0]) > 52) bassTr = [];
	}
	// 主旋律: 小節ごとに、表の先にある役割トラックが鳴っていればそれを採る。
	const leadBars = new Map<number, N[]>();
	for (const t of leadTr) {
		const own = new Map<number, N[]>();
		for (const n of t.notes) {
			const b = Math.floor(n.s / BAR);
			own.set(b, [...(own.get(b) ?? []), n]);
		}
		for (const [b, l] of own) if (!leadBars.has(b)) leadBars.set(b, l);
	}
	return {
		title,
		file,
		bpm: bpms[0] ?? 120,
		bars: Math.ceil(end / BAR),
		tracks,
		drums: drums.sort((a, b) => a.s - b.s),
		lead: mono([...leadBars.values()].flat()),
		bass: mono(
			bassTr.flatMap((t) => t.notes),
			true,
		),
		vocals: vocTr.map((t) => ({ label: t.label, notes: mono(t.notes) })),
		vocalAbs: roles?.vocalAbs !== false,
	};
};

type RefSet = { name: string; songs: SongData[] };

const lineageOf = (template: string): "2go" | "speder2" | "kaisen" | null =>
	/^kaiwai_2go/.test(template)
		? "2go"
		: /^kaiwai_speder2/.test(template)
			? "speder2"
			: /^kaiwai_kaisen/.test(template)
				? "kaisen"
				: null;

const refCache = new Map<string, RefSet>();
const loadLineage = (lin: "2go" | "speder2" | "kaisen"): RefSet => {
	const hit = refCache.get(lin);
	if (hit) return hit;
	const prefixTitle = (f: string): string => {
		const b =
			f
				.split(/[\\/]/)
				.pop()
				?.replace(/\.mid$/i, "") ?? f;
		const p = b.split("_")[0];
		return TITLE_ALIAS[p] ?? p;
	};
	let files: [string, string][] = [];
	if (lin === "2go")
		files = [
			...walk(join(LINEAGE_DIR, "2go")),
			...walk(join(LINEAGE_DIR, "2go_extra")),
		].map((f) => [f, prefixTitle(f)]);
	if (lin === "speder2")
		files = walk(join(LINEAGE_DIR, "speder2"))
			.filter((f) => !/gameover/i.test(f))
			.map((f) => [f, prefixTitle(f)]);
	if (lin === "kaisen") {
		const own = walk(join(KAIWAI_DIR, "ころんば"))
			.filter((f) => !/gomi|History|cookie|リックロール/.test(f))
			.map((f): [string, string] => [f, shortName(f).split("/")[1] ?? f]);
		files = [
			...own,
			...walk(join(LINEAGE_DIR, "kaisen")).map((f): [string, string] => [
				f,
				prefixTitle(f),
			]),
		];
	}
	const songs = files
		.map(([f, t]) => loadRef(f, t))
		.filter((s): s is SongData => s !== null && s.bars >= 4);
	const set = { name: lin, songs };
	refCache.set(lin, set);
	return set;
};
/** 流派と無関係な界隈曲（近さの比較群・歌の音域の一般の物差し）。 */
const loadControl = (): RefSet => {
	const hit = refCache.get("control");
	if (hit) return hit;
	const files = existsSync(KAIWAI_DIR)
		? readdirSync(KAIWAI_DIR)
				.filter(
					(d) =>
						!["ころんば", "2号兄貴", "Speder2"].includes(d) &&
						statSync(join(KAIWAI_DIR, d)).isDirectory(),
				)
				.flatMap((d) => walk(join(KAIWAI_DIR, d)))
				.filter((f) => !/gomi|History|cookie/.test(f))
		: [];
	const songs = files
		.map((f) => loadRef(f, shortName(f)))
		.filter((s): s is SongData => s !== null);
	const set = { name: "control", songs };
	refCache.set("control", set);
	return set;
};
/** 曲名ごとに1本（特徴の分布で同じ曲を2回数えない）。 */
const onePerTitle = (songs: SongData[]): SongData[] => {
	const seen = new Map<string, SongData>();
	for (const s of songs) if (!seen.has(s.title)) seen.set(s.title, s);
	return [...seen.values()];
};

// ============================================================
// ① 曲をまたいだ使い回し
// ============================================================

/** key は音程まで、contour は上下の向きだけ、rhythm は発音位置と長さだけ（音程を問わない）。 */
type Shape = {
	key: string;
	contour: string;
	rhythm: string;
	trivial: string | null;
};

/** 窓の中の音を、移調を除いた形にする（発音位置・長さ・窓の最低音からの音程）。 */
const shapeOf = (ns: N[]): Shape => {
	const on = new Map<number, N[]>();
	for (const n of ns) on.set(n.s, [...(on.get(n.s) ?? []), n]);
	const starts = [...on.keys()].sort((a, b) => a - b);
	if (starts.length < 3)
		return {
			key: "",
			contour: "",
			rhythm: "",
			trivial: "発音2つ以下（休符・白玉）",
		};
	const base = Math.min(...ns.map((n) => n.p));
	const sets: string[] = [];
	const parts: string[] = [];
	const rparts: string[] = [];
	const cparts: string[] = [];
	let prevTop: number | null = null;
	for (const s of starts) {
		const g = on.get(s) ?? [];
		const uniq = [...new Set(g.map((n) => n.p - base))].sort((a, b) => a - b);
		const ps = uniq.join(".");
		const dq = Math.min(16, Math.round(Math.max(...g.map((n) => n.d)) / 12));
		const top = uniq[uniq.length - 1];
		const dir =
			prevTop === null ? "" : top > prevTop ? "+" : top < prevTop ? "-" : "=";
		prevTop = top;
		sets.push(ps);
		parts.push(`${s}:${dq}:${ps}`);
		rparts.push(`${s}:${dq}x${uniq.length}`);
		cparts.push(`${s}:${dq}x${uniq.length}${dir}`);
	}
	const iois = new Set(starts.slice(1).map((s, i) => s - starts[i]));
	const trivial =
		new Set(sets).size === 1 && iois.size <= 1
			? "同じ音・和音の等間隔の刻み"
			: null;
	return {
		key: parts.join(" "),
		contour: cparts.join(" "),
		rhythm: rparts.join(" "),
		trivial,
	};
};

type Win = {
	song: string;
	track: string;
	label: string;
	inst: string;
	bar: number;
	shape: Shape;
	span: number;
	onsets: number;
};

const windowsOf = (sd: SongData, tracks: Track[]): Win[] => {
	const out: Win[] = [];
	const len = WINDOW * BAR;
	for (const t of tracks) {
		const by = new Map<number, N[]>();
		for (const n of t.notes) {
			const w = Math.floor(n.s / len);
			by.set(w, [...(by.get(w) ?? []), { ...n, s: n.s - w * len }]);
		}
		for (const [w, ns] of by) {
			const shape = shapeOf(ns);
			const ps = ns.map((n) => n.p);
			out.push({
				song: sd.title,
				track: t.id,
				label: t.label,
				inst: t.inst,
				bar: w * WINDOW,
				shape,
				span: Math.max(...ps) - Math.min(...ps),
				onsets: new Set(ns.map((n) => n.s)).size,
			});
		}
	}
	return out;
};

/** 曲ごとの非自明な形の集合。 */
const shapeSets = (
	wins: Win[],
	keyOf: (w: Win) => string = (w) => w.shape.key,
): Map<string, Set<string>> => {
	const m = new Map<string, Set<string>>();
	for (const w of wins) {
		if (w.shape.trivial) continue;
		const s = m.get(w.song) ?? new Set<string>();
		s.add(keyOf(w));
		m.set(w.song, s);
	}
	return m;
};
const overlap = (a: Set<string>, b: Set<string>): number => {
	if (a.size === 0 || b.size === 0) return 0;
	let n = 0;
	const [x, y] = a.size < b.size ? [a, b] : [b, a];
	for (const k of x) if (y.has(k)) n++;
	return n / x.size;
};
/** 曲の組ごとの「小さい方の形のうち相手にもある割合」。 */
const pairOverlaps = (
	sets: Map<string, Set<string>>,
	titles: string[],
): number[] => {
	const xs: number[] = [];
	for (let i = 0; i < titles.length; i++)
		for (let j = i + 1; j < titles.length; j++) {
			const a = sets.get(titles[i]);
			const b = sets.get(titles[j]);
			if (a && b && a.size && b.size) xs.push(overlap(a, b));
		}
	return xs;
};
/** 非自明な窓のうち、形が他の曲にも出る割合。曲数を `n` 曲に揃えた部分標本で平均する。 */
type KeyFn = (w: Win) => string;
const KEYS: [string, KeyFn][] = [
	["形", (w) => w.shape.key],
	["輪郭", (w) => w.shape.contour],
	["リズム", (w) => w.shape.rhythm],
];
const sharedWindowRate = (
	wins: Win[],
	songs: string[],
	n: number,
	rnd: () => number,
	keyOf: KeyFn = (w) => w.shape.key,
): number => {
	const nt = wins.filter((w) => !w.shape.trivial);
	const trials = songs.length <= n ? 1 : 30;
	const rates: number[] = [];
	for (let t = 0; t < trials; t++) {
		const pick = new Set(
			songs.length <= n
				? songs
				: [...songs].sort(() => rnd() - 0.5).slice(0, n),
		);
		const owners = new Map<string, Set<string>>();
		for (const w of nt)
			if (pick.has(w.song))
				owners.set(keyOf(w), (owners.get(keyOf(w)) ?? new Set()).add(w.song));
		const ws = nt.filter((w) => pick.has(w.song));
		if (ws.length)
			rates.push(
				ws.filter((w) => (owners.get(keyOf(w))?.size ?? 0) >= 2).length /
					ws.length,
			);
	}
	return mean(rates);
};

// ============================================================
// ② 特徴
// ============================================================

type FeatureValue = string | number | null;
type Feature = {
	key: string;
	label: string;
	/** 数値は `bucket` 刻みで同じ値かを数える。 */
	bucket?: number;
	common: boolean;
	get: (sd: SongData) => FeatureValue;
	/** テンプレートがこの値を1つに決めているか（流派の規則として書かれた不変量）。 */
	pinned?: (t: StructureTemplate) => boolean;
};
const one = <T>(xs: T[] | undefined): boolean =>
	xs !== undefined && new Set(xs).size === 1;

const iois = (ns: N[]): number[] =>
	ns
		.slice(1)
		.map((n, i) => n.s - ns[i].s)
		.filter((x) => x > 0 && x <= 96);
const shareOf = (xs: number[], ok: (x: number) => boolean): number | null =>
	xs.length ? xs.filter(ok).length / xs.length : null;
const modeOf = <T>(xs: T[]): [T | null, number] => {
	const m = new Map<T, number>();
	for (const x of xs) inc(m, x);
	let best: T | null = null;
	let bc = 0;
	for (const [k, c] of m) if (c > bc) [best, bc] = [k, c];
	return [best, xs.length ? bc / xs.length : 0];
};
const barsOf = (ns: N[]): Map<number, N[]> => {
	const m = new Map<number, N[]>();
	for (const n of ns) {
		const b = Math.floor(n.s / BAR);
		m.set(b, [...(m.get(b) ?? []), n]);
	}
	return m;
};
const barRhythm = (ns: N[], b: number): string =>
	[...new Set(ns.map((n) => n.s - b * BAR))].sort((x, y) => x - y).join(",");
const leadMono = new WeakMap<SongData, N[]>();
const L = (sd: SongData): N[] => {
	let m = leadMono.get(sd);
	if (!m) {
		m = mono(sd.lead);
		leadMono.set(sd, m);
	}
	return m;
};
const ints = (ns: N[]): number[] => ns.slice(1).map((n, i) => n.p - ns[i].p);
const keyOfSong = new WeakMap<SongData, { tonic: number; minor: boolean }>();
const songKey = (sd: SongData): { tonic: number; minor: boolean } => {
	let k = keyOfSong.get(sd);
	if (!k) {
		k = estimateKey(
			sd.tracks
				.flatMap((t) => t.notes)
				.map((n) => ({ startStep: n.s, pitchSemi: n.p, durationSteps: n.d })),
		);
		keyOfSong.set(sd, k);
	}
	return k;
};
/** 4小節ごとの鳴っている層（トラック）の数。ドラムは1層。 */
const layerCounts = (sd: SongData): number[] => {
	const blocks = Math.max(1, Math.ceil(sd.bars / 4));
	const out: number[] = [];
	for (let k = 0; k < blocks; k++) {
		const lo = k * 4 * BAR;
		const hi = lo + 4 * BAR;
		const act = sd.tracks.filter((t) =>
			t.notes.some((n) => n.s >= lo && n.s < hi),
		).length;
		out.push(act + (sd.drums.some((n) => n.s >= lo && n.s < hi) ? 1 : 0));
	}
	return out;
};
const drumBarMode = (sd: SongData, pitches: number[]): string | null => {
	const by = barsOf(sd.drums.filter((n) => pitches.includes(n.p)));
	const pats = [...by].map(([b, ns]) => barRhythm(ns, b));
	return modeOf(pats)[0];
};

const sectionKindsWith = (sd: SongData, notes: N[]): string => {
	const song = sd.gen?.song;
	if (!song) return "";
	const kinds = new Set<string>();
	for (const n of notes) {
		const b = Math.floor(n.s / BAR);
		const sec = song.sections.find(
			(x) => b >= x.startBar && b < x.startBar + x.bars,
		);
		if (sec) kinds.add(sec.kind);
	}
	return [...kinds].sort().join("+") || "なし";
};
const meanPitchIn = (sd: SongData, kind: string): number | null => {
	const song = sd.gen?.song;
	if (!song) return null;
	const ps = sd.lead
		.filter((n) => {
			const b = Math.floor(n.s / BAR);
			return song.sections.some(
				(x) => x.kind === kind && b >= x.startBar && b < x.startBar + x.bars,
			);
		})
		.map((n) => n.p);
	return ps.length ? mean(ps) : null;
};

const FEATURES: Feature[] = [
	// --- 原曲と共通に測れるもの ---
	{ key: "bpm", label: "テンポ", bucket: 5, common: true, get: (s) => s.bpm },
	{
		key: "bars",
		label: "曲の長さ（小節）",
		bucket: 8,
		common: true,
		get: (s) => s.bars,
	},
	{
		key: "secs",
		label: "曲の長さ（秒）",
		bucket: 15,
		common: true,
		get: (s) => secondsOf(s.bars * BAR, s.bpm),
	},
	{
		key: "mode",
		label: "調の長短（推定）",
		common: true,
		get: (s) => (songKey(s).minor ? "短調" : "長調"),
	},
	{
		key: "leadRange",
		label: "リードの音域（半音）",
		bucket: 3,
		common: true,
		get: (s) =>
			L(s).length
				? Math.max(...L(s).map((n) => n.p)) - Math.min(...L(s).map((n) => n.p))
				: null,
	},
	{
		key: "leadMean",
		label: "リードの中心（平均の MIDI 音高）",
		bucket: 3,
		common: true,
		get: (s) => (L(s).length ? mean(L(s).map((n) => n.p)) : null),
	},
	{
		key: "leadCenterRel",
		label: "リードの中心（主音からの度、mod12）",
		common: true,
		get: (s) =>
			L(s).length
				? (((Math.round(mean(L(s).map((n) => n.p))) - songKey(s).tonic) % 12) +
						12) %
					12
				: null,
	},
	{
		key: "leadDensity",
		label: "リードの密度（音のある小節あたりの音数）",
		bucket: 2,
		common: true,
		get: (s) => (L(s).length ? L(s).length / barsOf(L(s)).size : null),
	},
	{
		key: "leadRest",
		label: "リードの休符率",
		bucket: 0.1,
		common: true,
		get: (s) => {
			const m = L(s);
			if (m.length < 2) return null;
			const span = m[m.length - 1].s + m[m.length - 1].d - m[0].s;
			const sound = m.reduce((a, n) => a + n.d, 0);
			return Math.max(0, 1 - sound / span);
		},
	},
	{
		key: "lead16",
		label: "リードの16分間隔率",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(iois(L(s)), (x) => x === 12),
	},
	{
		key: "lead8",
		label: "リードの8分間隔率",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(iois(L(s)), (x) => x === 24),
	},
	{
		key: "leadTrip",
		label: "リードの3連間隔率",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(iois(L(s)), (x) => x === 16 || x === 32),
	},
	{
		key: "leadIoiMode",
		label: "リードの最頻の発音間隔",
		common: true,
		get: (s) => modeOf(iois(L(s)))[0],
	},
	{
		key: "leadStep",
		label: "リードの順次進行率（1〜2半音）",
		bucket: 0.1,
		common: true,
		get: (s) =>
			shareOf(ints(L(s)), (x) => Math.abs(x) >= 1 && Math.abs(x) <= 2),
	},
	{
		key: "leadLeap",
		label: "リードの跳躍率（5半音以上）",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(ints(L(s)), (x) => Math.abs(x) >= 5),
	},
	{
		key: "leadSame",
		label: "リードの同音率",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(ints(L(s)), (x) => x === 0),
	},
	{
		key: "leadMaxLeap",
		label: "リードの最大跳躍（半音）",
		bucket: 3,
		common: true,
		get: (s) =>
			ints(L(s)).length ? Math.max(...ints(L(s)).map(Math.abs)) : null,
	},
	{
		key: "leadRepeat",
		label: "リードの2小節の反復率（同じ曲の前に出た2小節と同一）",
		bucket: 0.1,
		common: true,
		get: (s) => {
			const by = new Map<number, string>();
			for (const n of L(s)) {
				const w = Math.floor(n.s / (2 * BAR));
				by.set(w, `${by.get(w) ?? ""}${n.s - w * 2 * BAR}:${n.p}:${n.d},`);
			}
			const seen = new Set<string>();
			let rep = 0;
			for (const w of [...by.keys()].sort((a, b) => a - b)) {
				const k = by.get(w) ?? "";
				if (seen.has(k)) rep++;
				seen.add(k);
			}
			return by.size ? rep / by.size : null;
		},
	},
	{
		key: "leadRhythmVariety",
		label: "リードの1小節リズム型の種類数／小節数",
		bucket: 0.1,
		common: true,
		get: (s) => {
			const by = barsOf(L(s));
			return by.size
				? new Set([...by].map(([b, ns]) => barRhythm(ns, b))).size / by.size
				: null;
		},
	},
	{
		key: "leadEntry",
		label: "リードの入り（最初の音の小節）",
		common: true,
		get: (s) => {
			const m = L(s);
			if (!m.length) return null;
			const b = Math.floor(m[0].s / BAR);
			return b === 0
				? "曲頭"
				: b <= 4
					? "1〜4"
					: b <= 8
						? "5〜8"
						: b <= 16
							? "9〜16"
							: "17〜";
		},
	},
	{
		key: "leadSwing",
		label: "リードの8小節ごとの平均音高の幅（盛り上がりの音域変化）",
		bucket: 3,
		common: true,
		get: (s) => {
			const by = new Map<number, number[]>();
			for (const n of L(s)) {
				const w = Math.floor(n.s / (8 * BAR));
				by.set(w, [...(by.get(w) ?? []), n.p]);
			}
			const ms = [...by.values()].filter((x) => x.length >= 8).map(mean);
			return ms.length >= 2 ? Math.max(...ms) - Math.min(...ms) : null;
		},
	},
	{
		key: "bassDensity",
		label: "ベースの音数／小節",
		bucket: 2,
		common: true,
		get: (s) => (s.bass.length ? s.bass.length / barsOf(s.bass).size : null),
	},
	{
		key: "bassOct",
		label: "ベースのオクターブ跳躍率",
		bucket: 0.1,
		common: true,
		get: (s) => shareOf(ints(s.bass), (x) => Math.abs(x) === 12),
	},
	{
		key: "bassIoiMode",
		label: "ベースの最頻の発音間隔",
		common: true,
		get: (s) => modeOf(iois(s.bass))[0],
	},
	{
		key: "bassBarMode",
		label: "ベースの最頻の1小節リズム型",
		common: true,
		get: (s) =>
			modeOf([...barsOf(s.bass)].map(([b, ns]) => barRhythm(ns, b)))[0],
	},
	{
		key: "bassBarModeShare",
		label: "ベースの最頻リズム型が占める小節の割合",
		bucket: 0.1,
		common: true,
		get: (s) =>
			s.bass.length
				? modeOf([...barsOf(s.bass)].map(([b, ns]) => barRhythm(ns, b)))[1]
				: null,
	},
	{
		key: "kick",
		label: "ドラム: キックの型（最頻の小節）",
		common: true,
		get: (s) => drumBarMode(s, [35, 36]),
	},
	{
		key: "hat16",
		label: "ドラム: 16分裏のハット",
		common: true,
		get: (s) => {
			if (!s.drums.length) return null;
			const by = barsOf(s.drums);
			const hit = [...by].filter(([b, ns]) =>
				ns.some(
					(n) => [42, 44, 46].includes(n.p) && (n.s - b * BAR) % 24 === 12,
				),
			).length;
			return hit / by.size >= 0.25 ? "あり" : "なし";
		},
	},
	{
		key: "backbeat",
		label: "ドラム: 2・4拍の楽器",
		common: true,
		get: (s) => {
			const bb = s.drums.filter((n) => [48, 144].includes(n.s % BAR));
			if (!s.drums.length) return null;
			const sn = bb.some((n) => n.p === 38 || n.p === 40);
			const cl = bb.some((n) => n.p === 39);
			return sn && cl
				? "スネア＋クラップ"
				: sn
					? "スネア"
					: cl
						? "クラップ"
						: "なし";
		},
	},
	{
		key: "layersMax",
		label: "同時に鳴る層の最大（4小節ごと）",
		bucket: 2,
		common: true,
		get: (s) => Math.max(...layerCounts(s)),
	},
	{
		key: "layersIntro",
		label: "曲頭4小節の層の数",
		bucket: 1,
		common: true,
		get: (s) => layerCounts(s)[0],
	},
	{
		key: "layerChanges",
		label: "層の数が変わる回数／4小節ブロック数",
		bucket: 0.1,
		common: true,
		get: (s) => {
			const c = layerCounts(s);
			return c.length > 1
				? c.slice(1).filter((x, i) => x !== c[i]).length / (c.length - 1)
				: null;
		},
	},
	{
		key: "opening",
		label: "曲頭2小節に鳴るもの",
		common: true,
		get: (s) => {
			const inHead = (ns: N[]): boolean => ns.some((n) => n.s < 2 * BAR);
			const parts = [
				inHead(s.drums) ? "ドラム" : "",
				inHead(s.bass) ? "ベース" : "",
				inHead(s.lead) ? "リード" : "",
			].filter(Boolean);
			const others = s.tracks.some((t) => inHead(t.notes)) ? "和音等" : "";
			return [...parts, others].filter(Boolean).join("+") || "無音";
		},
	},
	// --- 生成側だけ（曲の設計図から） ---
	{
		key: "plan",
		label: "構成（セクションの並び）",
		common: false,
		pinned: (t) => !t.plans && !t.grammar,
		get: (s) => s.gen?.song.sections.map((x) => x.kind).join(" ") ?? null,
	},
	{
		key: "nSections",
		label: "セクション数",
		bucket: 1,
		common: false,
		pinned: (t) => !t.plans && !t.grammar,
		get: (s) => s.gen?.song.sections.length ?? null,
	},
	{
		key: "introBars",
		label: "イントロの小節数",
		common: false,
		get: (s) => s.gen?.song.sections.find((x) => x.kind === "intro")?.bars ?? 0,
	},
	{
		key: "verseBars",
		label: "Aメロの小節数",
		common: false,
		get: (s) => s.gen?.song.sections.find((x) => x.kind === "verse")?.bars ?? 0,
	},
	{
		key: "chorusBars",
		label: "サビの小節数",
		common: false,
		get: (s) =>
			s.gen?.song.sections.find((x) => x.kind === "chorus")?.bars ?? 0,
	},
	{
		key: "keyShift",
		label: "曲中の転調",
		common: false,
		pinned: (t) => t.tonalMoves === false && t.grammar !== "nigo",
		get: (s) =>
			s.gen
				? s.gen.song.sections.some(
						(x) => x.keyShift !== s.gen?.song.sections[0].keyShift,
					)
					? "あり"
					: "なし"
				: null,
	},
	{
		key: "scale",
		label: "音階",
		common: false,
		pinned: (t) => one(t.scales),
		get: (s) => s.gen?.song.scaleId ?? null,
	},
	{
		key: "keyMode",
		label: "調（長短、設計図）",
		common: false,
		pinned: (t) => !!t.baseKey,
		get: (s) =>
			s.gen ? (/m$/.test(s.gen.song.keyName) ? "短調" : "長調") : null,
	},
	{
		key: "form",
		label: "展開の仕方（form）",
		common: false,
		pinned: (t) => !!t.form,
		get: (s) => s.gen?.song.form ?? null,
	},
	{
		key: "bassStyle",
		label: "ベースの奏法",
		common: false,
		pinned: (t) => one(t.bass?.styles),
		get: (s) => s.gen?.song.stats.bassStyle ?? null,
	},
	{
		key: "drum",
		label: "ドラムパターン",
		common: false,
		pinned: (t) => one(t.drums?.pool),
		get: (s) => s.gen?.song.drum ?? null,
	},
	{
		key: "instrument",
		label: "楽器プリセット",
		common: false,
		pinned: (t) => one(t.instruments),
		get: (s) => s.gen?.song.instrument ?? null,
	},
	{
		key: "chordPattern",
		label: "伴奏の奏法",
		common: false,
		pinned: (t) => one(t.chordPatterns),
		get: (s) => s.gen?.song.chordPattern ?? null,
	},
	{
		key: "harmRhythm",
		label: "和声リズム（1小節あたりの和音数）",
		bucket: 0.5,
		common: false,
		pinned: (t) => one(t.harmonicRhythms),
		get: (s) => {
			const bars = s.gen?.song.chordProgression.split("|") ?? [];
			return bars.length
				? mean(bars.map((b) => b.trim().split(/\s+/).filter(Boolean).length))
				: null;
		},
	},
	{
		key: "firstChord",
		label: "最初の和音（ハ長／イ短の綴り）",
		common: false,
		get: (s) =>
			s.gen?.song.chordProgression.split("|")[0]?.trim().split(/\s+/)[0] ??
			null,
	},
	{
		key: "topChord",
		label: "最も長く鳴る和音",
		common: false,
		get: (s) =>
			modeOf(
				(s.gen?.song.chordProgression.split("|") ?? []).flatMap((b) =>
					b.trim().split(/\s+/).filter(Boolean),
				),
			)[0],
	},
	{
		key: "seventhShare",
		label: "セブンス以上の和音の割合",
		bucket: 0.1,
		common: false,
		pinned: (t) => t.grammar === "nigo" || t.grammar === "speder",
		get: (s) => {
			const cs = (s.gen?.song.chordProgression.split("|") ?? []).flatMap((b) =>
				b.trim().split(/\s+/).filter(Boolean),
			);
			return cs.length
				? cs.filter((c) => /7|9|11|13/.test(c)).length / cs.length
				: null;
		},
	},
	{
		key: "backing",
		label: "伴奏の層（奏法:セクション）",
		common: false,
		pinned: (t) => !!t.arrange,
		get: (s) =>
			s.gen?.song.arrange.backing
				.map((b) => `${b.pattern}:${b.sections?.join("+") ?? "全体"}`)
				.join(" / ") ?? null,
	},
	{
		key: "sparkle",
		label: "ウワモノの奏法",
		common: false,
		pinned: (t) => !!t.arrange,
		get: (s) =>
			s.gen
				? s.gen.song.arrange.sparkle
					? `${s.gen.song.arrange.sparkle.pattern}:${s.gen.song.arrange.sparkle.sections?.join("+")}`
					: "なし"
				: null,
	},
	{
		key: "leadLayer",
		label: "サビ重ね（t1）",
		common: false,
		pinned: (t) => !!t.arrange,
		get: (s) =>
			s.gen
				? s.gen.song.arrange.lead
					? `oct${s.gen.song.arrange.lead.octave}:${s.gen.song.arrange.lead.sections.join("+")}`
					: "なし"
				: null,
	},
	{
		key: "pad",
		label: "パッドのセクション",
		common: false,
		pinned: (t) => !!t.arrange,
		get: (s) => s.gen?.song.arrange.padSections.join("+") ?? null,
	},
	{
		key: "assign",
		label: "層の割り当て（全層: どのセクションで鳴るか）",
		common: false,
		get: (s) =>
			s.gen?.layers
				.map(
					(l) =>
						`t${l.index}=${l.notes.length ? sectionKindsWith(s, toN(l.notes)) : "-"}`,
				)
				.join(" ") ?? null,
	},
	{
		key: "assignShape",
		label:
			"層の割り当て（鳴る層の数とセクション種別の対応、層の番号は問わない）",
		common: false,
		get: (s) => {
			const song = s.gen?.song;
			if (!song) return null;
			const kinds = [...new Set(song.sections.map((x) => x.kind))];
			return kinds
				.map((k) => {
					const n =
						s.gen?.layers.filter((l) =>
							toN(l.notes).some((x) => sectionKindsWith(s, [x]) === k),
						).length ?? 0;
					return `${k}:${n}`;
				})
				.join(" ");
		},
	},
	{
		key: "bar0",
		label: "曲頭の小節に鳴る層",
		common: false,
		get: (s) =>
			s.gen?.layers
				.filter((l) => l.notes.some((n) => n.startStep < BAR))
				.map((l) => `t${l.index}`)
				.join("+") || "なし",
	},
	{
		key: "chorusLift",
		label: "サビとAメロのリードの平均音高差（半音）",
		bucket: 3,
		common: false,
		get: (s) => {
			const c = meanPitchIn(s, "chorus");
			const v = meanPitchIn(s, "verse");
			return c !== null && v !== null ? c - v : null;
		},
	},
	{
		key: "harmony",
		label: "ハモリの有無",
		common: false,
		get: (s) => (s.gen ? (s.gen.song.harmony.length ? "あり" : "なし") : null),
	},
	{
		key: "octaveLayer",
		label: "オクターブ下の重ねの有無",
		common: false,
		pinned: (t) => !!t.vocal,
		get: (s) => (s.gen ? (s.gen.song.octave.length ? "あり" : "なし") : null),
	},
	{
		key: "duet",
		label: "掛け合いの型",
		common: false,
		pinned: (t) => one(t.vocal?.duetStyles),
		get: (s) => s.gen?.song.vocal.duetStyle ?? null,
	},
];

const bucketOf = (f: Feature, v: FeatureValue): string | null => {
	if (
		v === null ||
		v === undefined ||
		(typeof v === "number" && !Number.isFinite(v))
	)
		return null;
	if (typeof v === "number" && f.bucket)
		return String(
			Math.round(Math.floor(v / f.bucket) * f.bucket * 1000) / 1000,
		);
	return String(v);
};

type FeatStat = {
	f: Feature;
	n: number;
	top: string | null;
	topShare: number;
	distinct: number;
	values: (string | null)[];
	nums: number[];
	pairEq: number;
};
const featStats = (f: Feature, songs: SongData[]): FeatStat => {
	const raw = songs.map((s) => f.get(s));
	const values = raw.map((v) => bucketOf(f, v));
	const vs = values.filter((v): v is string => v !== null);
	const [top, topShare] = modeOf(vs);
	let eq = 0;
	let pairs = 0;
	for (let i = 0; i < vs.length; i++)
		for (let j = i + 1; j < vs.length; j++) {
			pairs++;
			if (vs[i] === vs[j]) eq++;
		}
	return {
		f,
		n: vs.length,
		top,
		topShare,
		distinct: new Set(vs).size,
		values,
		nums: raw.filter(
			(v): v is number => typeof v === "number" && Number.isFinite(v),
		),
		pairEq: pairs ? eq / pairs : Number.NaN,
	};
};

// ============================================================
// ③ 歌えるか
// ============================================================

/**
 * UTAU 音源の実用音域の目安（MIDI）。**出典なしの目安**——src の音源一覧（`KOE_VOICEBANKS`）に
 * 音域の情報は無く、配布物の readme でよく見る推奨音域（女声・中性の単独音で C3〜C5 前後、
 * 男声はその4〜5度下）を丸めた値。判定の主は原曲の歌トラックの実測で、これは補助。
 */
const UTAU_RANGE = { female: [53, 77] as const, male: [45, 69] as const };
const BREATH_GAP = 24; // 8分未満の隙間は歌い続けているとみなす
const LEAP_LIMIT = 12;

type PhraseStats = { maxRunSec: number; leapsOver: number; leaps: number };
const phraseStats = (ns: N[], bpm: number): PhraseStats => {
	const m = mono(ns);
	let runStart = m[0]?.s ?? 0;
	let maxRun = 0;
	let leapsOver = 0;
	let leaps = 0;
	for (let i = 1; i <= m.length; i++) {
		const prev = m[i - 1];
		const cur = m[i];
		const gap = cur ? cur.s - (prev.s + prev.d) : Number.POSITIVE_INFINITY;
		if (gap >= BREATH_GAP) {
			maxRun = Math.max(maxRun, prev.s + prev.d - runStart);
			if (cur) runStart = cur.s;
		} else if (cur) {
			leaps++;
			if (Math.abs(cur.p - prev.p) > LEAP_LIMIT) leapsOver++;
		}
	}
	return { maxRunSec: secondsOf(maxRun, bpm), leapsOver, leaps };
};

/** 2声の同時発音（±6ステップ）の割合と音程の内訳。音程は b − a（半音）。 */
const stackStats = (
	a: N[],
	b: N[],
): { coincide: number; sameRhythm: number; cats: Map<string, number> } => {
	const cats = new Map<string, number>();
	let co = 0;
	let same = 0;
	for (const n of b) {
		const m = a.find((x) => Math.abs(x.s - n.s) <= 6);
		if (!m) continue;
		co++;
		if (Math.abs(m.d - n.d) <= 12) same++;
		const iv = n.p - m.p;
		const ab = Math.abs(iv);
		const c =
			ab === 0
				? "同音"
				: ab === 12
					? iv < 0
						? "1オクターブ下"
						: "1オクターブ上"
					: ab === 24
						? "2オクターブ"
						: [3, 4, 8, 9, 15, 16].includes(ab)
							? "3度・6度"
							: [5, 7, 17, 19].includes(ab)
								? "4度・5度"
								: "その他";
		inc(cats, c);
	}
	return {
		coincide: b.length ? co / b.length : 0,
		sameRhythm: co ? same / co : 0,
		cats,
	};
};
const catsText = (m: Map<string, number>): string => {
	const t = [...m.values()].reduce((a, b) => a + b, 0);
	return (
		[...m]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${pct(v / t)}`)
			.join("・") || "-"
	);
};

// ============================================================
// ④ 原曲との近さ（移調に依らない音程＋発音間隔の最長一致）
// ============================================================

const tokenIds = new Map<string, number>();
const tokensOf = (ns: N[]): number[] => {
	const by = new Map<number, N>();
	for (const n of ns) {
		const o = by.get(n.s);
		if (!o || n.p > o.p) by.set(n.s, n);
	}
	const m = [...by.values()].sort((a, b) => a.s - b.s);
	const out: number[] = [];
	for (let i = 1; i < m.length; i++) {
		const k = `${m[i].p - m[i - 1].p}:${Math.min(96, m[i].s - m[i - 1].s)}`;
		let id = tokenIds.get(k);
		if (id === undefined) {
			id = tokenIds.size + 1;
			tokenIds.set(k, id);
		}
		out.push(id);
	}
	return out;
};
const P1 = 50331653;
const P2 = 25165843;
const B1 = 1000003 % P1;
const B2 = 916411 % P2;
/** 長さ L の部分列の集合を L ごとに作って持ち、最長一致を L を1ずつ伸ばして探す。 */
class GramIndex {
	private cache = new Map<number, Map<number, number>>();
	constructor(private seqs: { name: string; toks: number[] }[]) {}
	private hashes(toks: number[], len: number): number[] {
		const out: number[] = [];
		if (toks.length < len) return out;
		let p1 = 1;
		let p2 = 1;
		for (let i = 0; i < len; i++) {
			p1 = (p1 * B1) % P1;
			p2 = (p2 * B2) % P2;
		}
		let h1 = 0;
		let h2 = 0;
		for (let i = 0; i < toks.length; i++) {
			h1 = (h1 * B1 + toks[i]) % P1;
			h2 = (h2 * B2 + toks[i]) % P2;
			if (i >= len) {
				h1 = (h1 - ((toks[i - len] * p1) % P1) + P1) % P1;
				h2 = (h2 - ((toks[i - len] * p2) % P2) + P2) % P2;
			}
			if (i >= len - 1) out.push(h1 * 67108864 + h2);
		}
		return out;
	}
	private index(len: number): Map<number, number> {
		let m = this.cache.get(len);
		if (!m) {
			m = new Map();
			this.seqs.forEach((s, i) => {
				for (const h of this.hashes(s.toks, len)) if (!m?.has(h)) m?.set(h, i);
			});
			this.cache.set(len, m);
		}
		return m;
	}
	longest(toks: number[]): { len: number; where: string } {
		let len = 0;
		let where = "";
		for (;;) {
			const idx = this.index(len + 1);
			const hit = this.hashes(toks, len + 1).find((h) => idx.has(h));
			if (hit === undefined) break;
			len++;
			where = this.seqs[idx.get(hit) ?? 0].name;
			if (len > 400) break;
		}
		return { len, where };
	}
	get size(): number {
		return this.seqs.length;
	}
}
const gramIndexOf = (songs: SongData[]): GramIndex =>
	new GramIndex(
		songs.flatMap((s) =>
			s.tracks
				.filter((t) => t.notes.length >= 16)
				.map((t) => ({
					name: `${shortName(s.file ?? s.title)}#${t.id}`,
					toks: tokensOf(t.notes),
				})),
		),
	);

// ============================================================
// 本体
// ============================================================

type Candidate = { score: number; text: string };

const runTemplate = (template: string): string => {
	const tmpl = templateOf(template);
	if (!tmpl) throw new Error(`テンプレートが無い: ${template}`);
	const sing = VOCAL_MODE === "on" || (VOCAL_MODE === "auto" && !tmpl.lead);
	const lin = lineageOf(template);
	const refs = USE_REFS && lin ? loadLineage(lin) : null;
	const control = USE_REFS ? loadControl() : null;
	const refTitles = refs ? onePerTitle(refs.songs) : [];
	const hasRefs = refTitles.length >= 3;

	const master = seededRandom(MASTER_SEED);
	const seeds = Array.from({ length: COUNT }, () =>
		Math.floor(master() * 4294967296),
	);
	for (const s of EXTRA_SEEDS) if (!seeds.includes(s)) seeds.push(s);
	const t0 = Date.now();
	const gens = seeds.map((s) => generate(template, s, sing));
	const genSec = (Date.now() - t0) / 1000;
	const out: string[] = [];
	const cands: Candidate[] = [];
	const p = (s = ""): void => {
		out.push(s);
	};

	p(`# 生成物の点検: ${template}（${tmpl.label}）`);
	p();
	p(
		`- 生成 ${gens.length} 曲（seed は --seed ${MASTER_SEED} から引いた ${COUNT} 本${EXTRA_SEEDS.length ? ` ＋指定 ${EXTRA_SEEDS.join(", ")}` : ""}）、上級者モードの全トラックまで。${r1(genSec)} 秒。`,
	);
	p(
		`- 原曲（耳コピ）: ${refs ? `${refs.name} ${refs.songs.length} ファイル／${refTitles.length} 曲（同じ曲の別の耳コピは1曲として数える）` : "無し（生成側だけ）"}。比較群（無関係な界隈曲）: ${control ? `${control.songs.length} ファイル` : "無し"}。`,
	);
	p(
		`- 窓: ${WINDOW} 小節。形は「発音位置・長さ・窓の最低音からの音程（和音は構成音の相対形）」で、移調を除く。原曲は16分・3連の格子へ寄せてから測る。`,
	);
	p(
		`- 歌の点検: ${sing ? "する（歌入り作曲の割り当て: 主旋律・ハモリ・掛け合いは1オクターブ下、オクターブ重ねは2オクターブ下で歌う＝daw.ts の vocalOctave）" : "しない（楽器リードのテンプレート）"}`,
	);
	p();

	// ---------------- ① 使い回し ----------------
	p("## ① 曲をまたいだ使い回し");
	p();
	// 原曲が無いテンプレートは、無関係な界隈曲（人の曲どうし）を使い回しの基準にする。
	const reuseRefs = hasRefs
		? refTitles
		: control
			? onePerTitle(control.songs)
					.filter((_, i) => i % 7 === 0)
					.slice(0, 12)
			: [];
	const hasReuse = reuseRefs.length >= 3;
	const RN = hasRefs ? "原曲" : "人の曲";
	if (hasReuse && !hasRefs)
		p(
			`使い回しの基準: 流派の原曲が無いので、無関係な界隈曲 ${reuseRefs.length} 曲（人の曲どうし）と比べる。`,
		);
	p();
	const genWins = gens.flatMap((g) => windowsOf(g, g.tracks));
	const genTitles = gens.map((g) => g.title);
	const rnd = seededRandom(7);
	const nRef = reuseRefs.length;
	const refWins = reuseRefs.flatMap((r) => windowsOf(r, r.tracks));
	const refNames = reuseRefs.map((r) => r.title);
	const half = (xs: number[]): number =>
		xs.length ? xs.filter((x) => x >= 0.5).length / xs.length : 0;
	type Base = { pairMean: number; half: number; rate: number };
	const refBase = new Map<string, Base>();
	p(`### 全トラックまとめて（${RN}と同じ物差し）`);
	p();
	p(
		"| 鍵 | | 曲数 | 曲の組の共有度（中央 / 平均 / 90%点） | 半分以上同じ組 | 非自明な窓のうち他の曲にも出る割合 |",
	);
	p("| :--- | :--- | ---: | :--- | ---: | :--- |");
	for (const [kind, keyOf] of KEYS) {
		const gp = pairOverlaps(shapeSets(genWins, keyOf), genTitles);
		const gAll = sharedWindowRate(
			genWins,
			genTitles,
			genTitles.length,
			rnd,
			keyOf,
		);
		const gN = hasReuse
			? sharedWindowRate(genWins, genTitles, nRef, rnd, keyOf)
			: Number.NaN;
		p(
			`| ${kind} | 生成 | ${genTitles.length} | ${pct(median(gp))} / ${pct(mean(gp))} / ${pct(quant(gp, 0.9))} | ${pct(half(gp))} | ${pct(gAll)}（全曲）${hasReuse ? `・${pct(gN)}（${nRef}曲の部分標本）` : ""} |`,
		);
		if (!hasReuse) continue;
		const rp = pairOverlaps(shapeSets(refWins, keyOf), refNames);
		const rRate = sharedWindowRate(refWins, refNames, nRef, rnd, keyOf);
		refBase.set(kind, { pairMean: mean(rp), half: half(rp), rate: rRate });
		p(
			`| ${kind} | ${RN} | ${nRef} | ${pct(median(rp))} / ${pct(mean(rp))} / ${pct(quant(rp, 0.9))} | ${pct(half(rp))} | ${pct(rRate)} |`,
		);
		if (kind !== "リズム" && mean(gp) > Math.max(2 * mean(rp), mean(rp) + 0.05))
			cands.push({
				score: 80 + 100 * (mean(gp) - mean(rp)),
				text: `曲どうしの${kind}の共有が${RN}より多い（全トラック）: 曲の組の共有度 平均 ${pct(mean(gp))}（${RN} ${pct(mean(rp))}）、他曲にも出る窓 ${pct(gN)}（${RN} ${pct(rRate)}、${nRef}曲で揃えて）`,
			});
	}
	p();
	p(
		"鍵: **形**＝発音位置・長さ・窓の最低音からの音程（和音は構成音の相対形）。**輪郭**＝発音位置・長さ・同時音数・最高音の上下の向き（音程の大きさは問わない。同じ奏法を別の和音で弾いたものは同じになる）。**リズム**＝発音位置・長さ・同時音数だけ。",
	);
	p(
		"曲の組の共有度 = 2曲の非自明な鍵の集合のうち、小さい方が相手にもある割合（曲数に依らない）。「半分以上同じ組」はそれが50%以上の組の割合。",
	);
	p();

	// 層ごと
	p("### 層（トラック）ごと");
	p();
	p(
		`同じ層の中で、他の曲にも同じ鍵が出るか。「他曲窓」は非自明な窓のうち他の曲の同じ層にも出る割合${hasReuse ? `（${nRef}曲の部分標本。${RN}の全トラックを混ぜた値と比べる。混ぜる方が緩い基準）` : "（全曲）"}、「半分」は半分以上同じ組。`,
	);
	p();
	p(
		"| 層 | 楽器（最頻） | 鳴る曲 | 非自明な窓 | 自明で除外 | 形: 他曲窓 / 半分 | 輪郭: 他曲窓 / 半分 | リズム: 他曲窓 / 半分 |",
	);
	p("| :--- | :--- | ---: | ---: | :--- | :--- | :--- | :--- |");
	if (hasReuse)
		p(
			`| （${RN}・全トラック） | | ${nRef} | | | ${KEYS.map(([k]) => `${pct(refBase.get(k)?.rate ?? Number.NaN)} / ${pct(refBase.get(k)?.half ?? Number.NaN)}`).join(" | ")} |`,
		);
	const layerIds = [...new Set(genWins.map((w) => w.track))].sort(
		(a, b) => Number(a.slice(1)) - Number(b.slice(1)),
	);
	for (const id of layerIds) {
		const ws = genWins.filter((w) => w.track === id);
		const songsWith = [...new Set(ws.map((w) => w.song))];
		const nt = ws.filter((w) => !w.shape.trivial);
		const triv = new Map<string, number>();
		for (const w of ws) if (w.shape.trivial) inc(triv, w.shape.trivial);
		const cells: string[] = [];
		let worst: {
			kind: string;
			rate: number;
			half: number;
			excess: number;
			score: number;
		} | null = null;
		for (const [kind, keyOf] of KEYS) {
			const rate = sharedWindowRate(
				ws,
				songsWith,
				hasReuse ? nRef : songsWith.length,
				rnd,
				keyOf,
			);
			const hp = half(pairOverlaps(shapeSets(ws, keyOf), songsWith));
			cells.push(`${pct(rate)} / ${pct(hp)}`);
			const base = refBase.get(kind) ?? { rate: 0.3, half: 0.1, pairMean: 0 };
			const excess = Math.max(
				rate - Math.max(base.rate + 0.15, 1.5 * base.rate),
				hp - (base.half + 0.2),
			);
			// 音程まで同じ（形・輪郭）を、リズムだけの一致より優先して1件にまとめる。
			// 重み: 音程まで同じ（形）＞ 向きまで同じ（輪郭）＞ リズムだけ。「半分以上同じ組」は曲まるごとの一致なので重く見る。
			const weight = kind === "形" ? 1 : kind === "輪郭" ? 0.9 : 0.45;
			const score =
				weight *
				(40 +
					60 * Math.max(0, rate - Math.max(base.rate + 0.15, 1.5 * base.rate)) +
					100 * Math.max(0, hp - base.half));
			if (excess > 0 && (!worst || score > worst.score))
				worst = { kind, rate, half: hp, excess, score };
		}
		const label = ws[0].label;
		p(
			`| ${label} | ${modeOf(ws.map((w) => w.inst))[0]} | ${songsWith.length} | ${nt.length} | ${[...triv].map(([k, v]) => `${k} ${v}`).join("・") || "0"} | ${cells.join(" | ")} |`,
		);
		if (worst) {
			const base = refBase.get(worst.kind);
			cands.push({
				score: worst.score,
				text: `${label}の${worst.kind}が曲をまたいで同じ: 他曲にも出る窓 ${pct(worst.rate)}・半分以上同じ曲の組 ${pct(worst.half)}${base ? `（${RN}は全トラック混ぜて ${pct(base.rate)}・${pct(base.half)}）` : "（比較なし。目安 30%・10%）"}`,
			});
		}
	}
	p();

	// 上位の形
	p("### 最も多くの曲に出る鍵（上位）");
	p();
	p("| 鍵 | 層 | 出る曲 | 発音数 | 音域（半音） | 例（seed: 小節） |");
	p("| :--- | :--- | ---: | ---: | ---: | :--- |");
	for (const [kind, keyOf] of KEYS.slice(0, 2)) {
		const owners = new Map<string, { songs: Set<string>; ex: Win }>();
		for (const w of genWins) {
			if (w.shape.trivial) continue;
			const k = `${w.track}|${keyOf(w)}`;
			const o = owners.get(k) ?? { songs: new Set(), ex: w };
			o.songs.add(w.song);
			owners.set(k, o);
		}
		for (const o of [...owners.values()]
			.sort((a, b) => b.songs.size - a.songs.size)
			.slice(0, 6))
			p(
				`| ${kind} | ${o.ex.label} | ${o.songs.size}（${pct(o.songs.size / gens.length)}） | ${o.ex.onsets} | ${o.ex.span} | ${[...o.songs].slice(0, 3).join(", ")}: ${o.ex.bar} |`,
			);
	}
	p();
	// 指定 seed どうし
	if (EXTRA_SEEDS.length >= 2) {
		p("### 指定 seed どうしの共有（層ごと、共有する鍵 / 小さい方の鍵の数）");
		p();
		p(
			"| 組 | 層 | 楽器 | 形 | 輪郭 | リズム | 楽器＋リズム（自明な窓も含む） |",
		);
		p("| :--- | :--- | :--- | :--- | :--- | :--- | :--- |");
		const frac = (x: Set<string>, y: Set<string>): string =>
			`${[...x].filter((k) => y.has(k)).length}/${Math.min(x.size, y.size)}`;
		for (let i = 0; i < EXTRA_SEEDS.length; i++)
			for (let j = i + 1; j < EXTRA_SEEDS.length; j++) {
				const a = String(EXTRA_SEEDS[i]);
				const b = String(EXTRA_SEEDS[j]);
				for (const id of layerIds) {
					const wa = genWins.filter((w) => w.song === a && w.track === id);
					const wb = genWins.filter((w) => w.song === b && w.track === id);
					if (!wa.length || !wb.length) continue;
					const cols = KEYS.map(([, keyOf]) =>
						frac(
							new Set(wa.filter((w) => !w.shape.trivial).map(keyOf)),
							new Set(wb.filter((w) => !w.shape.trivial).map(keyOf)),
						),
					);
					const ri = (ws: Win[]): Set<string> =>
						new Set(
							ws.map((w) => `${w.inst}|${w.shape.rhythm || w.shape.trivial}`),
						);
					p(
						`| ${a}–${b} | ${wa[0].label} | ${wa[0].inst}${wa[0].inst !== wb[0].inst ? ` / ${wb[0].inst}` : ""} | ${cols.join(" | ")} | ${frac(ri(wa), ri(wb))} |`,
					);
				}
			}
		p();
	}

	// ---------------- ② 不変量 ----------------
	p("## ② 生成側だけの不変量");
	p();
	p(
		`${gens.length} 曲で同じ値になる割合（数値は表の刻みで丸めて数える）。原曲の列は曲ごとに1本で数えた値。`,
	);
	p();
	const stats = FEATURES.map((f) => ({
		g: featStats(f, gens),
		r: f.common && hasRefs ? featStats(f, refTitles) : null,
	}));
	p(`### ほぼ全曲（${pct(THRESHOLD)}以上）で同じ値の特徴`);
	p();
	p(
		"| 特徴 | 生成の最頻値 | 生成で同じ割合 | 原曲の最頻値 | 原曲で同じ割合 | 原曲の値の種類 | 判定 |",
	);
	p("| :--- | :--- | ---: | :--- | ---: | ---: | :--- |");
	const verdictOf = (g: FeatStat, r: FeatStat | null): string => {
		if (!g.f.common)
			return g.f.pinned?.(tmpl)
				? "テンプレートが1つに決めている（書かれた規則）"
				: "**テンプレートで決めていないのに一定**";
		if (!r || r.n < 3) return "原曲と比べられない";
		if (r.topShare >= THRESHOLD)
			return r.top === g.top
				? "原曲でも一定（流派の性質）"
				: "原曲も一定だが値が違う";
		return "**原曲では曲ごとに違うのに生成では一定**";
	};
	for (const { g, r } of stats
		.filter((x) => x.g.n > 0 && x.g.topShare >= THRESHOLD)
		.sort((a, b) => b.g.topShare - a.g.topShare)) {
		const v = verdictOf(g, r);
		p(
			`| ${g.f.label} | ${String(g.top).slice(0, 60)} | ${pct(g.topShare)} | ${r ? String(r.top).slice(0, 40) : "-"} | ${r ? pct(r.topShare) : "-"} | ${r ? `${r.distinct}/${r.n}` : "-"} | ${v} |`,
		);
		if (v.includes("決めていないのに"))
			cands.push({
				score: 40 + 20 * g.topShare,
				text: `${g.f.label}がテンプレートの指定なしに全曲ほぼ一定: ${pct(g.topShare)} が「${String(g.top).slice(0, 50)}」（原曲と比べられない。規則の副作用か確かめる）`,
			});
		if (v.includes("原曲では曲ごとに違う") || v.includes("値が違う"))
			cands.push({
				score: 50 + 40 * (g.topShare - (r?.topShare ?? 0)),
				text: `${g.f.label}が全曲ほぼ一定: 生成 ${pct(g.topShare)} が「${String(g.top).slice(0, 40)}」、原曲は ${r?.distinct}/${r?.n} 種（最頻 ${pct(r?.topShare ?? 0)}「${String(r?.top).slice(0, 30)}」）`,
			});
	}
	p();
	if (EXTRA_SEEDS.length >= 2) {
		const idx = EXTRA_SEEDS.map((x) =>
			gens.findIndex((g) => g.title === String(x)),
		).filter((i) => i >= 0);
		p(`### 指定 seed（${EXTRA_SEEDS.join(", ")}）で全部同じ値の特徴`);
		p();
		p(
			"2曲が同じ値になる率が生成でも原曲でも低いのに指定 seed で揃っているものは偶然、生成だけ高いものは生成の癖。",
		);
		p();
		p("| 特徴 | 値 | 生成で2曲が同じ値 | 原曲で2曲が同じ値 | 判定 |");
		p("| :--- | :--- | ---: | ---: | :--- |");
		const rows = stats.filter(({ g }) => {
			const vs = idx.map((i) => g.values[i]);
			return vs[0] !== null && vs.every((v) => v === vs[0]);
		});
		for (const { g, r } of rows.sort(
			(a, b) =>
				Number(!!b.r) - Number(!!a.r) ||
				b.g.pairEq - (b.r?.pairEq ?? 0) - (a.g.pairEq - (a.r?.pairEq ?? 0)),
		))
			p(
				`| ${g.f.label} | ${String(g.values[idx[0]]).slice(0, 50)} | ${pct(g.pairEq)} | ${r ? pct(r.pairEq) : "-"} | ${r ? (g.pairEq - r.pairEq >= 0.3 ? "**生成の癖**" : g.pairEq < 0.5 ? "偶然寄り" : "流派の性質寄り") : g.f.pinned?.(tmpl) ? "テンプレートの規則" : "生成側だけ"} |`,
			);
		p();
	}
	if (hasRefs) {
		p("### 生成が原曲の幅からはみ出す（数値の特徴）");
		p();
		p(
			"| 特徴 | 生成 中央（10〜90%点） | 原曲 最小〜最大 | 原曲の幅の外に出る生成の曲 |",
		);
		p("| :--- | :--- | :--- | ---: |");
		for (const { g, r } of stats) {
			if (!r || g.nums.length < 5 || r.nums.length < 3) continue;
			const tol = (g.f.bucket ?? 0) / 2;
			const lo = Math.min(...r.nums) - tol;
			const hi = Math.max(...r.nums) + tol;
			const outShare =
				g.nums.filter((x) => x < lo || x > hi).length / g.nums.length;
			if (outShare < 0.3) continue;
			p(
				`| ${g.f.label} | ${r1(median(g.nums))}（${r1(quant(g.nums, 0.1))}〜${r1(quant(g.nums, 0.9))}） | ${r1(Math.min(...r.nums))}〜${r1(Math.max(...r.nums))} | ${pct(outShare)} |`,
			);
			if (outShare >= 0.5)
				cands.push({
					score: 45 + 40 * outShare,
					text: `${g.f.label}が原曲の幅の外: 生成の ${pct(outShare)} が外（生成 中央 ${r1(median(g.nums))}、原曲 ${r1(Math.min(...r.nums))}〜${r1(Math.max(...r.nums))}）`,
				});
		}
		p();
		p("### 曲どうしが同じ値になる割合（原曲と共通の特徴）");
		p();
		const common = stats.filter((x) => x.r && x.g.n > 1 && x.r.n > 1);
		const gEq = mean(common.map((x) => x.g.pairEq));
		const rEq = mean(common.map((x) => (x.r as FeatStat).pairEq));
		p(
			`無作為な2曲で、共通の特徴 ${common.length} 個のうち同じ値になる割合の平均: **生成 ${pct(gEq)}・原曲 ${pct(rEq)}**（同じ曲の別の耳コピは除く）。`,
		);
		p();
		p("| 特徴 | 生成で2曲が同じ値 | 原曲で2曲が同じ値 | 差 |");
		p("| :--- | ---: | ---: | ---: |");
		for (const x of common
			.sort(
				(a, b) =>
					b.g.pairEq -
					(b.r as FeatStat).pairEq -
					(a.g.pairEq - (a.r as FeatStat).pairEq),
			)
			.slice(0, 12))
			p(
				`| ${x.g.f.label} | ${pct(x.g.pairEq)} | ${pct((x.r as FeatStat).pairEq)} | ${pct(x.g.pairEq - (x.r as FeatStat).pairEq)} |`,
			);
		p();
		if (gEq > rEq + 0.1)
			cands.push({
				score: 55 + 100 * (gEq - rEq),
				text: `曲どうしが似すぎ: 共通の特徴が同じ値になる割合 生成 ${pct(gEq)}（原曲 ${pct(rEq)}）`,
			});
	}
	p("<details><summary>全特徴の分布</summary>");
	p();
	p("| 特徴 | 生成: 最頻値（割合）・種類 | 原曲: 最頻値（割合）・種類 |");
	p("| :--- | :--- | :--- |");
	for (const { g, r } of stats)
		p(
			`| ${g.f.label} | ${String(g.top).slice(0, 50)}（${pct(g.topShare)}）・${g.distinct} | ${r ? `${String(r.top).slice(0, 40)}（${pct(r.topShare)}）・${r.distinct}/${r.n}` : "-"} |`,
		);
	p();
	p("</details>");
	p();

	// ---------------- ③ 歌 ----------------
	if (sing) {
		p("## ③ 歌えるか");
		p();
		const lineageVoc = refs
			? refs.songs.flatMap((s) =>
					s.vocalAbs ? s.vocals.map((v) => v.notes) : [],
				)
			: [];
		const ctrlVoc = control
			? control.songs.flatMap((s) => s.vocals.map((v) => v.notes))
			: [];
		const rangeOf = (vs: N[][]): [number, number] | null => {
			const ps = vs.flat().map((n) => n.p);
			return ps.length >= 50 ? [quant(ps, 0.05), quant(ps, 0.95)] : null;
		};
		const linR = rangeOf(lineageVoc);
		const ctlR = rangeOf(ctrlVoc);
		p(
			`- 原曲の歌（流派、絶対音高が信用できる耳コピだけ）: ${linR ? `${lineageVoc.length} トラック、5〜95%点 ${linR[0]}〜${linR[1]}` : "無し"}`,
		);
		p(
			`- 界隈曲全体の歌トラック（名前で判定）: ${ctlR ? `${ctrlVoc.length} トラック、5〜95%点 ${ctlR[0]}〜${ctlR[1]}` : "無し"}`,
		);
		p(
			`- UTAU の実用音域の目安（出典なしの補助）: 女声・中性 ${UTAU_RANGE.female.join("〜")}、男声 ${UTAU_RANGE.male.join("〜")}`,
		);
		p();
		p("### 声部ごとの音域（歌う高さ＝ノート＋vocalOctave）");
		p();
		const refBand = linR ?? ctlR;
		const bandName = linR ? "流派の原曲の歌" : "界隈曲の歌";
		p(
			`| 声部 | 出る曲 | 最低（5%点） | 中央 | 最高（95%点） | ${bandName}の帯の外 | 女声目安の外 | 男声目安の外 | 跳躍${LEAP_LIMIT}半音超を含む曲 | 息継ぎ無しの最長（中央 / 最大, 秒） |`,
		);
		p(
			"| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
		);
		const parts = [
			...new Set(gens.flatMap((g) => g.vocals.map((v) => v.label))),
		];
		const outside = (
			ps: number[],
			r: readonly [number, number] | null,
		): number =>
			r && ps.length
				? ps.filter((x) => x < r[0] || x > r[1]).length / ps.length
				: Number.NaN;
		for (const label of parts) {
			const vs = gens.flatMap((g) =>
				g.vocals.filter((v) => v.label === label).map((v) => ({ v, g })),
			);
			const ps = vs.flatMap(({ v }) => v.notes.map((n) => n.p));
			const ph = vs.map(({ v, g }) => phraseStats(v.notes, g.bpm));
			const outRef = outside(ps, refBand);
			p(
				`| ${label} | ${vs.length} | ${quant(ps, 0.05)} | ${median(ps)} | ${quant(ps, 0.95)} | ${pct(outRef)} | ${pct(outside(ps, UTAU_RANGE.female))} | ${pct(outside(ps, UTAU_RANGE.male))} | ${pct(ph.filter((x) => x.leapsOver > 0).length / ph.length)} | ${r1(median(ph.map((x) => x.maxRunSec)))} / ${r1(Math.max(...ph.map((x) => x.maxRunSec)))} |`,
			);
			// オクターブ下の重ねは下で専用の候補にする。
			if (outRef >= 0.3 && !label.startsWith("オクターブ下"))
				cands.push({
					score: 70 + 60 * outRef,
					text: `歌の${label}が${bandName}の帯（${refBand?.join("〜")}）の外: 音の ${pct(outRef)}（歌う高さの中央 ${median(ps)}、5%点 ${quant(ps, 0.05)}）`,
				});
		}
		// 原曲の歌の跳躍・息継ぎ
		const refVocSongs = refs ? refs.songs.filter((s) => s.vocals.length) : [];
		if (refVocSongs.length) {
			const ph = refVocSongs.flatMap((s) =>
				s.vocals.map((v) => phraseStats(v.notes, s.bpm)),
			);
			p(
				`| （原曲の歌 ${ph.length} トラック） | ${refVocSongs.length} | ${linR?.[0] ?? "-"} | - | ${linR?.[1] ?? "-"} | - | - | - | ${pct(ph.filter((x) => x.leapsOver > 0).length / ph.length)} | ${r1(median(ph.map((x) => x.maxRunSec)))} / ${r1(Math.max(...ph.map((x) => x.maxRunSec)))} |`,
			);
		}
		p();
		p("### 声の重ね（同時に歌う2声の音程とリズム）");
		p();
		p("| | 曲 | 同時発音の割合 | 同じリズム（長さも同じ） | 音程の内訳 |");
		p("| :--- | ---: | ---: | ---: | :--- |");
		for (const label of parts.filter((x) => !x.startsWith("主旋律"))) {
			const xs = gens.flatMap((g) => {
				const main = g.vocals.find((v) => v.label.startsWith("主旋律"));
				const other = g.vocals.find((v) => v.label === label);
				return main && other ? [stackStats(main.notes, other.notes)] : [];
			});
			if (!xs.length) continue;
			const cats = new Map<string, number>();
			for (const x of xs) for (const [k, v] of x.cats) inc(cats, k, v);
			p(
				`| 生成: 主旋律 × ${label} | ${xs.length} | ${pct(mean(xs.map((x) => x.coincide)))} | ${pct(mean(xs.map((x) => x.sameRhythm)))} | ${catsText(cats)} |`,
			);
		}
		// 原曲の重ね: 同じ曲の歌トラックの組
		let refPairs = 0;
		const refCats = new Map<string, number>();
		const refCo: number[] = [];
		const refSame: number[] = [];
		const refStackSongs = new Set<string>();
		for (const s of refs?.songs ?? []) {
			for (let i = 0; i < s.vocals.length; i++)
				for (let j = i + 1; j < s.vocals.length; j++) {
					const st = stackStats(s.vocals[i].notes, s.vocals[j].notes);
					if (st.coincide < 0.2) continue; // 掛け合い・交代は重ねではない
					refPairs++;
					refStackSongs.add(s.title);
					refCo.push(st.coincide);
					refSame.push(st.sameRhythm);
					for (const [k, v] of st.cats) inc(refCats, k, v);
				}
		}
		if (refs)
			p(
				`| 原曲: 同じ曲の歌トラックの組（同時発音20%以上） | ${refStackSongs.size}曲 ${refPairs}組 | ${pct(mean(refCo))} | ${pct(mean(refSame))} | ${catsText(refCats)} |`,
			);
		p();
		const refVoices = refs
			? refs.songs
					.filter((s) => s.vocals.length)
					.map((s) => `${shortName(s.file ?? "")} ${s.vocals.length}本`)
			: [];
		if (refVoices.length) p(`原曲の歌トラック数: ${refVoices.join("・")}`);
		p();
		const octGen = gens.flatMap((g) =>
			g.vocals.filter((v) => v.label.startsWith("オクターブ下")),
		);
		if (octGen.length) {
			const ps = octGen.flatMap((v) => v.notes.map((n) => n.p));
			const refLow = refBand?.[0] ?? UTAU_RANGE.female[0];
			const below = ps.filter((x) => x < refLow).length / ps.length;
			const octRef =
				(refCats.get("1オクターブ下") ?? 0) +
				(refCats.get("1オクターブ上") ?? 0);
			const refTot = [...refCats.values()].reduce((a, b) => a + b, 0);
			p(
				`**オクターブ下の重ね**: ${octGen.length}/${gens.length} 曲に出る。歌う高さ ${quant(ps, 0.05)}〜${quant(ps, 0.95)}（中央 ${median(ps)}）で、${bandName}の最低（5%点 ${refLow}）より下が ${pct(below)}。原曲の歌の重ねの同時発音のうちオクターブは ${refTot ? pct(octRef / refTot) : "比較なし（流派の原曲が無い）"}。`,
			);
			p();
			if (below >= 0.2)
				cands.push({
					score: 75 + 50 * below,
					text: `オクターブ下の重ね（t13、vocalOctave -2）が${bandName}より低い: 歌う高さの ${pct(below)} が5%点 ${refLow} 未満（中央 ${median(ps)}）。${refTot ? `原曲の歌の重ねでオクターブの音程は ${pct(octRef / refTot)}` : "流派の原曲の重ねとは比べられない"}`,
				});
		}
	}

	// ---------------- ④ 近さ ----------------
	p("## ④ 原曲との近さ（移調に依らない音程＋発音間隔の最長一致、音数）");
	p();
	if (!control || control.songs.length === 0) p("比較群が無いので省略。");
	else {
		const ctlIdx = gramIndexOf(control.songs);
		const linIdx = refs?.songs.length ? gramIndexOf(refs.songs) : null;
		const rows: {
			part: string;
			lin: { len: number; where: string }[];
			ctl: { len: number; where: string }[];
		}[] = [];
		for (const part of ["lead", "bass"] as const) {
			const lin: { len: number; where: string }[] = [];
			const ctl: { len: number; where: string }[] = [];
			for (const g of gens) {
				const toks = tokensOf(g[part]);
				if (linIdx) lin.push(linIdx.longest(toks));
				ctl.push(ctlIdx.longest(toks));
			}
			rows.push({ part: part === "lead" ? "主旋律" : "ベース", lin, ctl });
		}
		p(
			`比較群: 流派の耳コピ ${linIdx ? `${linIdx.size} トラック` : "無し"}、無関係な界隈曲 ${ctlIdx.size} トラック（16音以上のトラック全部）。`,
		);
		p();
		p(
			"| 声部 | 流派: 中央 / 90%点 / 最大（どこ） | 無関係: 中央 / 90%点 / 最大 |",
		);
		p("| :--- | :--- | :--- |");
		for (const r of rows) {
			const lm = r.lin.map((x) => x.len);
			const cm = r.ctl.map((x) => x.len);
			const worst = r.lin.reduce((a, b) => (b.len > a.len ? b : a), {
				len: 0,
				where: "-",
			});
			p(
				`| ${r.part} | ${lm.length ? `${median(lm)} / ${quant(lm, 0.9)} / ${Math.max(...lm)}（${worst.where}）` : "-"} | ${median(cm)} / ${quant(cm, 0.9)} / ${Math.max(...cm)} |`,
			);
			if (lm.length && quant(lm, 0.9) > Math.max(12, 1.5 * quant(cm, 0.9)))
				cands.push({
					score: 85,
					text: `${r.part}が流派の原曲に近すぎる: 最長一致 90%点 ${quant(lm, 0.9)} 音（無関係な界隈曲 ${quant(cm, 0.9)} 音）、最大 ${Math.max(...lm)}（${worst.where}）`,
				});
		}
		p();
		p("流派の値が無関係な界隈曲と同程度なら、写しではなく誰でも書く型の一致。");
		p();
	}

	// ---------------- ⑤ 要約 ----------------
	p("## ⑤ 所有者に聴かせる前に直すべき候補（重大度順）");
	p();
	if (!cands.length) p("- 無し（原曲と比べて目立つ差は見つからなかった）");
	for (const c of cands.sort((a, b) => b.score - a.score))
		p(`- [${Math.round(c.score)}] ${c.text}`);
	p();
	return out.join("\n");
};

const reports = TEMPLATES.map(runTemplate);
const text = reports.join("\n\n---\n\n");
if (OUT) {
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, text);
	console.log(`書き出し: ${OUT}`);
}
console.log(text);
