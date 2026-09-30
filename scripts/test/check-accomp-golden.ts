/**
 * 伴奏主体モードの黄金値（`docs/accomp-style-engine.md` §7.2・§8 段階 S0）。
 *
 * 出力を1バイトも変えない作り替え（段階 S1・S3）の番をする。スタイルごとに
 * `scripts/test/fixtures/styles/<id>/golden.json` を持ち、次の sha256 を照合する（いまは fb だけ）。
 *
 * - 200種 × baseKey {major, minor, any}: 採った候補番号・計画 JSON・MML
 *   （`composeAccomp({ random: seededRandom(seed), baseKey })` を `accompToMml(song, { seed, version: "0" })`）
 * - `fbPlan` × 長調12調 × `BPM_TABLE` の全テンポ: 計画 JSON・保険の計画として鳴らした MML
 *   （`pick: -1`、決まった乱数列）・計画を丸ごと与えて鳴らした MML（`overrides.plan`、種 0 の乱数列）
 *
 *   npx tsx scripts/test/check-accomp-golden.ts            # 照合（pnpm test に入っている）
 *   npx tsx scripts/test/check-accomp-golden.ts --bless    # 取り直し（pnpm accomp:bless）
 *
 * - MML の `#ver` は "0" に固定する。パッケージの版を上げただけで黄金値が変わらないように。
 * - 取り直すのは、出力を**意図して**変えたときだけ。そのときはスタイルの版（`#compose` の
 *   `style:fb.v<n>`）も上げる（§2.5・§7.2）。版を上げずに取り直すと、同じ `#compose` から
 *   別の曲が出る。
 * - 上の2つは 12平均律・stepsPerBar 192・色の線あり（DAW の既定）。600曲とも候補 k=0 が通るので、
 *   それだけだと DAW の 31平均律と、候補を読み飛ばす経路（`pick`・`recent`）の出力が番をされない。
 *   そこで「変種」を少し足す（検証の回で追加。付録 F.4）: 31平均律 20種 × baseKey 3・色の線なし 10種・
 *   `pick` 1 と 7 を 10種ずつ・`recent`（候補 0 の計画を渡して候補 1 以降を採らせる）10種。
 *   stepsPerBar は DAW が 192 固定なので足さない（他の分解能は `check-compose-accomp.ts` が往復と関門で見る）。
 * - 段階 S1 で、計画に記録（`PlanPins`: `plan.style`・`archetype`・`mix` と、実現の段が決めた
 *   `regions[].compHits`）を足した。曲の計画の sha256 はこれを含む（S1 で取り直したのは計画の sha256 だけで、
 *   MML の sha256 は S0 と1バイトも違わない。記録を消した計画の sha256 は S0 の値に戻る。付録 F.8）。
 *   `fbPlan` の行の計画は計画器が書く記録（スタイル・型・ミックス）だけを持ち、打ち方の記録は持たない。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { dirname, join } from "node:path";

// mml-parser は歌詞解析の先で @onjmin/koe（ブラウザ専用）を読むので、空のスタブへ
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { composeAccomp } =
	require("../../src/compose/compose-accomp") as typeof import("../../src/compose/compose-accomp");
const { accompToMml } =
	require("../../src/compose/compose-accomp-mml") as typeof import("../../src/compose/compose-accomp-mml");
const { fbPlan } =
	require("../../src/compose/compose-accomp-plan") as typeof import("../../src/compose/compose-accomp-plan");
const { accompStyleView } =
	require("../../src/compose/compose-accomp-style") as typeof import("../../src/compose/compose-accomp-style");
const { DEFAULT_ACCOMP_STYLE } =
	require("../../src/compose/accomp-styles/index") as typeof import("../../src/compose/accomp-styles/index");
const { seededRandom } =
	require("../../src/compose/compose") as typeof import("../../src/compose/compose");
const { COMPOSE_KEYS } =
	require("../../src/compose/compose-keys") as typeof import("../../src/compose/compose-keys");

type AccompSong = import("../../src/compose/compose-accomp").AccompSong;
type AccompPlan = import("../../src/compose/compose-accomp").AccompPlan;

const BLESS = process.argv.includes("--bless");
const STYLE = DEFAULT_ACCOMP_STYLE;
const FILE = join(__dirname, "fixtures", "styles", STYLE.id, "golden.json");
const SEED_FROM = 1;
const SEED_COUNT = 200;
const BASE_KEYS = ["major", "minor", "any"] as const;
/** MML の `#ver`。パッケージの版に引きずられないよう固定する。 */
const MML_VERSION = "0";

type Golden = {
	about: string;
	/** `<id>.v<版>`（`#compose` の2項目めと同じ）。 */
	style: string;
	mml: { version: string; stepsPerBar: number; edo: number };
	songs: {
		seeds: [number, number];
		/** 1行1曲: `seed pick 計画の sha256 MML の sha256` */
		rows: Record<(typeof BASE_KEYS)[number], string[]>;
	};
	fbPlan: {
		bpms: number[];
		/** 1行1つ: `rootShift bpm 計画の sha256 保険の計画の MML の sha256 計画を与えた MML の sha256` */
		rows: string[];
	};
	/** 変種（31平均律・色の線なし・pick・recent）。1行1曲: `変種 種 pick 計画の sha256 MML の sha256` */
	variants: { rows: string[] };
};

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const mmlOf = (song: AccompSong, seed?: number): string =>
	accompToMml(song, { seed, version: MML_VERSION });

const t0 = Date.now();
const problems: string[] = [];

// ---- 種 × baseKey ----
const songRows = {} as Golden["songs"]["rows"];
for (const baseKey of BASE_KEYS) {
	songRows[baseKey] = [];
	for (let seed = SEED_FROM; seed < SEED_FROM + SEED_COUNT; seed++) {
		const song = composeAccomp({ random: seededRandom(seed), baseKey });
		songRows[baseKey].push(
			`${seed} ${song.pick} ${sha(JSON.stringify(song.plan))} ${sha(mmlOf(song, seed))}`,
		);
	}
}

// ---- fbPlan × 12調 × テンポ ----
const majorKeys = Object.entries(COMPOSE_KEYS)
	.filter(([, k]) => k.mode === "major")
	.sort(([, a], [, b]) => a.rootShift - b.rootShift);
const bpms = accompStyleView(STYLE.id).tempo.map(([b]) => b);
/** 実現の段が記録した打ち方（`regions[].compHits`）を消した計画（計画器が作ったままの形）。 */
const withoutCompHits = (p: AccompPlan): AccompPlan => ({
	...p,
	regions: p.regions.map(({ compHits: _c, ...r }) => r),
});
const planRows: string[] = [];
for (const [keyId, k] of majorKeys)
	for (const bpm of bpms) {
		const plan = fbPlan(k.rootShift, bpm);
		// 保険の計画（pick −1）。調の選択肢を固定し、テンポを上書きして引く
		const fallback = composeAccomp({
			random: seededRandom(0),
			baseKey: keyId,
			pick: -1,
			overrides: { bpm },
		});
		if (JSON.stringify(withoutCompHits(fallback.plan)) !== JSON.stringify(plan))
			problems.push(
				`${keyId} ${bpm}BPM: pick −1 の計画が fbPlan(${k.rootShift}, ${bpm}) と違う（打ち方の記録のほか）`,
			);
		if (fallback.plan.regions.some((r) => r.compHits?.length !== r.bars))
			problems.push(`${keyId} ${bpm}BPM: 保険の計画に打ち方の記録が無い`);
		const given = composeAccomp({
			random: seededRandom(0),
			overrides: { plan },
		});
		planRows.push(
			`${k.rootShift} ${bpm} ${sha(JSON.stringify(plan))} ${sha(mmlOf(fallback))} ${sha(mmlOf(given))}`,
		);
	}
if (majorKeys.length !== 12) problems.push(`長調が ${majorKeys.length} 調`);

// ---- 変種（31平均律・色の線なし・候補を読み飛ばす経路） ----
const variantRows: string[] = [];
const variantRow = (
	label: string,
	seed: number,
	opts: Parameters<typeof composeAccomp>[0],
): AccompSong => {
	const song = composeAccomp({ random: seededRandom(seed), ...opts });
	variantRows.push(
		`${label} ${seed} ${song.pick} ${sha(JSON.stringify(song.plan))} ${sha(mmlOf(song, seed))}`,
	);
	return song;
};
for (const baseKey of BASE_KEYS)
	for (let seed = 1; seed <= 20; seed++)
		variantRow(`edo31:${baseKey}`, seed, { baseKey, edo: 31 });
for (let seed = 1; seed <= 10; seed++)
	variantRow("nocolor:any", seed, { baseKey: "any", colorLine: false });
for (const pick of [1, 7])
	for (let seed = 1; seed <= 10; seed++)
		variantRow(`pick${pick}:any`, seed, { baseKey: "any", pick });
let recentSkipped = 0;
for (let seed = 1; seed <= 10; seed++) {
	const first = composeAccomp({ random: seededRandom(seed), baseKey: "any" });
	const song = variantRow("recent:any", seed, {
		baseKey: "any",
		recent: [first.planSignature],
	});
	if (song.pick !== first.pick) recentSkipped++;
}
if (recentSkipped === 0)
	problems.push(
		"recent の変種で、候補を読み飛ばした曲が1つも無い（経路を通っていない）",
	);

const now: Golden = {
	about:
		"伴奏主体モードの黄金値（scripts/test/check-accomp-golden.ts）。取り直しは pnpm accomp:bless。出力を意図して変えたときだけ取り直し、スタイルの版も上げる（docs/accomp-style-engine.md §7.2）。",
	style: `${STYLE.id}.v${STYLE.version}`,
	mml: { version: MML_VERSION, stepsPerBar: 192, edo: 12 },
	songs: { seeds: [SEED_FROM, SEED_FROM + SEED_COUNT - 1], rows: songRows },
	fbPlan: { bpms, rows: planRows },
	variants: { rows: variantRows },
};
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const counts = `種 ${SEED_COUNT} × baseKey ${BASE_KEYS.length} = ${SEED_COUNT * BASE_KEYS.length} 曲（計画と MML）、fbPlan ${majorKeys.length} 調 × ${bpms.length} テンポ = ${planRows.length} 組（計画・保険の計画の MML・計画を与えた MML）、変種 ${variantRows.length} 曲（31平均律・色の線なし・pick・recent）`;

if (problems.length) {
	console.log(`FAIL 黄金値を取る前提が崩れた:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}

if (BLESS) {
	mkdirSync(dirname(FILE), { recursive: true });
	writeFileSync(FILE, `${JSON.stringify(now, null, "\t")}\n`);
	console.log(`黄金値を書いた: ${FILE}\n  ${counts}（${secs}秒）`);
	process.exit(0);
}

console.log(`# 伴奏主体モードの黄金値（${now.style}）`);
if (!existsSync(FILE)) {
	console.log(`  FAIL ${FILE} が無い（pnpm accomp:bless で取る）`);
	process.exit(1);
}
const old = JSON.parse(readFileSync(FILE, "utf8")) as Golden;
const diffs: string[] = [];
if (old.style !== now.style)
	diffs.push(
		`スタイルの版が違う（黄金値 ${old.style}・今 ${now.style}）。版を上げたなら pnpm accomp:bless`,
	);
if (JSON.stringify(old.mml) !== JSON.stringify(now.mml))
	diffs.push(`MML の条件が違う ${JSON.stringify(old.mml)}`);
const compareRows = (label: string, a: string[], b: string[]): void => {
	if (a.length !== b.length)
		diffs.push(`${label}: 件数 ${a.length} → ${b.length}`);
	let n = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++)
		if (a[i] !== b[i]) {
			n++;
			if (n <= 3) diffs.push(`${label}: ${a[i]}\n       → ${b[i]}`);
		}
	if (n > 3) diffs.push(`${label}: ほか ${n - 3} 件`);
};
for (const k of BASE_KEYS)
	compareRows(`種 ${k}`, old.songs.rows[k] ?? [], now.songs.rows[k]);
compareRows("fbPlan", old.fbPlan.rows, now.fbPlan.rows);
compareRows("変種", old.variants?.rows ?? [], now.variants.rows);

if (diffs.length === 0) {
	console.log(`  ok   ${counts} が黄金値と1バイトも違わない（${secs}秒）`);
	console.log("\nall ok");
} else {
	console.log(`  FAIL 黄金値と違う（${secs}秒）`);
	for (const d of diffs) console.log(`       ${d}`);
	console.log(
		"\n  出力を意図して変えたのなら、スタイルの版を上げてから pnpm accomp:bless で取り直す。",
	);
	process.exit(1);
}
