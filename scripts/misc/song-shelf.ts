/**
 * 作った曲の棚（`tmp/songs/`、git 管理外）。曲ごとに「日本時間 タイトル」のフォルダを作り、作曲の手順を
 * 1段ずつ書きためて、仕上がった MML・試聴 URL・自動作曲と手書きの比率を置く。一覧は `tmp/songs/index.html`。
 *
 *   npx tsx scripts/misc/song-shelf.ts new --title <タイトル> [--model <モデル名>] [--at "2026-10-25 15:30" | "2026-10-25"]
 *       作り始めにフォルダを作る。出力はフォルダのパス。--at は日本時間（省略時は今）。日付だけなら時刻不明。
 *       フォルダ名は "YYYY-MM-DD HHmm - <モデル名> - <タイトル>"（--model 省略時は "YYYY-MM-DD HHmm <タイトル>"）。
 *   npx tsx scripts/misc/song-shelf.ts step <曲> --did <やったこと> [--saw <見たもの・数値>] [--why <判断と理由>] [--ref <参考資料との照合>] [--at ...]
 *       作曲の手順を1段足す（steps.md を書き直す）。
 *   npx tsx scripts/misc/song-shelf.ts publish <曲> <song.mml> --origin "4,5,6,7,12=auto;0,1=hand;8=derived" [--key Bbm] [--summary <一言>] [--with <file>...]
 *       仕上がった MML を置き、試聴 URL と比率を出す。--origin はトラックの出どころ（auto＝自動作曲の出力を採用、
 *       hand＝手書き、derived＝自動作曲の素材から手で組んだ新しい層）。書かないトラックは「未申告」として数える。
 *       --with は作るのに使ったスクリプトなど（src/ へ写す）。
 *   npx tsx scripts/misc/song-shelf.ts verdict <曲> --verdict 使う|捨てる [--note <理由>]
 *   npx tsx scripts/misc/song-shelf.ts index
 *
 * <曲> はフォルダのパスか、tmp/songs の中のフォルダ名の一部（1つに決まること）。どのコマンドも最後に index.html を作り直す。
 * 曲の概要（設計・確かめたこと・確かめていないこと）は各フォルダの notes.md に自分で書く。音の確かめ方は scripts/README.md（スピーカーへ出さない）。比率は発音イベント数で、作業量の目安であって
 * 創作上の寄与の比ではない。ドラムは型の指定なので数えない。
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import Module from "node:module";
import { basename, join, resolve } from "node:path";
import { mmlShareUrls } from "./embed-url";

// mml-parser は lyrics → @onjmin/koe（ブラウザ専用）を読むので空のスタブを入れてから読む
const loader = Module as unknown as {
	_load: (request: string, ...rest: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = (request: string, ...rest: unknown[]) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: originalLoad(request, ...rest);
const { parseMML } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");

const SHELF = resolve("tmp/songs");
const BAR = 192;
const ORIGINS = {
	auto: "自動作曲の出力",
	hand: "手書き",
	derived: "自動作曲の素材から組んだ層",
	unknown: "未申告",
} as const;
type Origin = keyof typeof ORIGINS;

type Step = {
	at: string;
	did: string;
	saw?: string;
	why?: string;
	ref?: string;
};
type Meta = {
	title: string;
	/** 日本時間。"2026-10-25 15:30" か、時刻不明なら "2026-10-25" */
	at: string;
	/** 作成した AI モデル名（例: "Gemini 3.8 Flash"） */
	model?: string;
	summary?: string;
	key?: string;
	song?: {
		bpm: number;
		bars: number;
		seconds: number;
		tracks: number;
		version?: string;
		seed?: string;
		compose?: string;
		embed: string;
		edit: string;
	};
	/** トラックごとの発音イベント数と出どころ。比率は origins から出す */
	tracks?: {
		index: number;
		instrument?: string;
		notes: number;
		origin: Origin;
	}[];
	origins?: Partial<Record<Origin, number>>;
	files?: string[];
	steps: Step[];
	verdict?: { value: string; note?: string; at: string };
};

const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const opts = (name: string): string[] =>
	argv.flatMap((a, i) =>
		a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : [],
	);
const positional = argv
	.slice(1)
	.filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));

const jstNow = (): string =>
	new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	})
		.format(new Date())
		.replace("T", " ");
const parseAt = (s: string | undefined): string => {
	if (!s || s === "now") return jstNow();
	if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s)) return s;
	throw new Error(
		`--at は "YYYY-MM-DD HH:mm" か "YYYY-MM-DD"（日本時間）: ${s}`,
	);
};
const folderName = (at: string, title: string, model?: string) => {
	const [date, time] = at.split(" ");
	const t = time ? time.replace(":", "") : "----";
	const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();
	return model
		? `${date} ${t} - ${clean(model)} - ${clean(title)}`
		: `${date} ${t} ${clean(title)}`;
};

const findSong = (q: string | undefined): string => {
	if (!q) throw new Error("曲のフォルダを指定してください");
	if (existsSync(join(q, "meta.json"))) return resolve(q);
	const hits = existsSync(SHELF)
		? readdirSync(SHELF).filter(
				(d) => d.includes(q) && existsSync(join(SHELF, d, "meta.json")),
			)
		: [];
	if (hits.length !== 1)
		throw new Error(
			`"${q}" に当たる曲が ${hits.length} 件: ${hits.join(" / ")}`,
		);
	return join(SHELF, hits[0]);
};
const readMeta = (dir: string): Meta =>
	JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
const writeMeta = (dir: string, meta: Meta) => {
	writeFileSync(
		join(dir, "meta.json"),
		`${JSON.stringify(meta, null, 1)}\n`,
		"utf8",
	);
	writeFileSync(join(dir, "steps.md"), stepsMarkdown(meta), "utf8");
};

const stepsMarkdown = (m: Meta): string => {
	const lines = [
		`# ${m.title} — 作曲の記録`,
		"",
		`作り始め: ${m.at}（日本時間）`,
		...(m.model ? [`モデル: ${m.model}`] : []),
		"",
	];
	m.steps.forEach((s, i) => {
		lines.push(`## ${i + 1}. ${s.did}`, "", `- 時刻: ${s.at}`);
		if (s.saw) lines.push(`- 見たもの: ${s.saw}`);
		if (s.why) lines.push(`- 判断: ${s.why}`);
		if (s.ref) lines.push(`- 参考資料との照合: ${s.ref}`);
		lines.push("");
	});
	if (!m.steps.length) lines.push("（まだ記録が無い）", "");
	return lines.join("\n");
};

/** "4,5,6,7,12=auto;0,1=hand;8=derived" → トラック番号 → 出どころ */
const parseOrigin = (s: string | undefined): Map<number, Origin> => {
	const map = new Map<number, Origin>();
	for (const part of (s ?? "").split(";").filter(Boolean)) {
		const [list, kind] = part.split("=");
		if (!(kind in ORIGINS) || kind === "unknown")
			throw new Error(`--origin の種類は auto / hand / derived: ${part}`);
		for (const t of list.split(",")) map.set(Number(t), kind as Origin);
	}
	return map;
};

const publish = (dir: string, mmlFile: string) => {
	const meta = readMeta(dir);
	const mml = readFileSync(mmlFile, "utf8");
	if (resolve(mmlFile) !== join(dir, "song.mml"))
		writeFileSync(join(dir, "song.mml"), mml, "utf8");
	const p = parseMML(mml, { stepsPerBar: BAR });
	const placements = p.placements as unknown as {
		trackIndex: number;
		startStep: number;
		durationSteps: number;
	}[];
	const end = placements.reduce(
		(a, n) => Math.max(a, n.startStep + n.durationSteps),
		0,
	);
	// トラック行の先頭のテンポ（"@0 t145 …"）。ヘッダの "#t1inst=" 等に parseMML が惑わされるのを避ける
	const explicitBpm = Number(/^@\d+\s+t(\d+)/m.exec(mml)?.[1]);
	const bpm = explicitBpm > 0 ? explicitBpm : (p.bpm ?? 120);
	const bars = Math.ceil(end / BAR);
	const header = (k: string) => new RegExp(`#${k}=(\\S+)`).exec(mml)?.[1];
	const counts = new Map<number, number>();
	for (const n of placements)
		counts.set(n.trackIndex, (counts.get(n.trackIndex) ?? 0) + 1);
	const origin = parseOrigin(opt("origin"));
	for (const t of origin.keys())
		if (!counts.has(t)) throw new Error(`--origin のトラック ${t} に音が無い`);
	meta.tracks = [...counts]
		.sort(([a], [b]) => a - b)
		.map(([index, notes]) => ({
			index,
			instrument: new RegExp(`#t${index}inst=(.+?)(?= #|;|$)`, "m").exec(
				mml,
			)?.[1],
			notes,
			origin: origin.get(index) ?? "unknown",
		}));
	meta.origins = {};
	for (const t of meta.tracks)
		meta.origins[t.origin] = (meta.origins[t.origin] ?? 0) + t.notes;
	meta.song = {
		bpm,
		bars,
		seconds: Math.round((bars * 240) / bpm),
		tracks: counts.size,
		version: header("ver"),
		seed: header("seed"),
		compose: header("compose"),
		...mmlShareUrls(mml),
	};
	if (opt("key")) meta.key = opt("key");
	if (opt("summary")) meta.summary = opt("summary");
	const extra = opts("with");
	if (extra.length) {
		mkdirSync(join(dir, "src"), { recursive: true });
		for (const f of extra) copyFileSync(f, join(dir, "src", basename(f)));
		meta.files = [
			...new Set([
				...(meta.files ?? []),
				...extra.map((f) => `src/${basename(f)}`),
			]),
		];
	}
	writeMeta(dir, meta);
	const total = meta.tracks.reduce((a, t) => a + t.notes, 0);
	console.log(
		`${basename(dir)}: ${bars} 小節・${bpm} BPM・${counts.size} トラック・${total} 音 — ${Object.entries(
			meta.origins,
		)
			.map(
				([k, v]) =>
					`${ORIGINS[k as Origin]} ${v}（${Math.round((100 * v) / total)}%）`,
			)
			.join("、")}`,
	);
};

const writeIndex = () => {
	mkdirSync(SHELF, { recursive: true });
	const songs = readdirSync(SHELF)
		.filter((d) => existsSync(join(SHELF, d, "meta.json")))
		.map((d) => ({ dir: d, ...readMeta(join(SHELF, d)) }))
		.sort((a, b) => b.at.localeCompare(a.at) || b.dir.localeCompare(a.dir));
	const data = JSON.stringify(songs).replace(/</g, "\\u003c");
	const template = readFileSync(join(__dirname, "song-shelf.html"), "utf8");
	writeFileSync(
		join(SHELF, "index.html"),
		template.replace("/*SONGS*/[]", data),
		"utf8",
	);
	console.log(`${join(SHELF, "index.html")}（${songs.length} 曲）`);
};

switch (command) {
	case "new": {
		const title = opt("title");
		if (!title) throw new Error("--title が要る");
		const model = opt("model");
		const at = parseAt(opt("at"));
		const dir = join(SHELF, folderName(at, title, model));
		if (existsSync(join(dir, "meta.json"))) throw new Error(`もうある: ${dir}`);
		mkdirSync(dir, { recursive: true });
		writeMeta(dir, { title, at, ...(model ? { model } : {}), steps: [] });
		if (!existsSync(join(dir, "notes.md")))
			writeFileSync(
				join(dir, "notes.md"),
				[
					`# ${title}`,
					"",
					"曲の概要。手順の記録は steps.md。",
					"",
					"## 設計（流派・素材・曲の形・終わり方と、その理由）",
					"",
					"## 確かめたこと（数値・測定）",
					"",
					"## 確かめていないこと（聴けていない・測れなかった所）",
					"",
					"## 所有者に訊くこと（出発点として使うか／最初に直す場所／理由を一言）",
					"",
				].join("\n"),
				"utf8",
			);
		console.log(dir);
		break;
	}
	case "step": {
		const dir = findSong(positional[0]);
		const did = opt("did");
		if (!did) throw new Error("--did が要る");
		const meta = readMeta(dir);
		meta.steps.push({
			at: parseAt(opt("at")),
			did,
			saw: opt("saw"),
			why: opt("why"),
			ref: opt("ref"),
		});
		writeMeta(dir, meta);
		console.log(`${basename(dir)}: ${meta.steps.length}. ${did}`);
		break;
	}
	case "publish": {
		const dir = findSong(positional[0]);
		if (!positional[1]) throw new Error("song.mml を渡してください");
		publish(dir, positional[1]);
		break;
	}
	case "verdict": {
		const dir = findSong(positional[0]);
		const value = opt("verdict");
		if (!value) throw new Error("--verdict が要る");
		const meta = readMeta(dir);
		meta.verdict = { value, note: opt("note"), at: jstNow() };
		writeMeta(dir, meta);
		break;
	}
	case "index":
		break;
	default:
		throw new Error("コマンドは new / step / publish / verdict / index");
}
writeIndex();
