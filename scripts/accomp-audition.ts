/**
 * 伴奏主体モード（`composeAccomp`）の試聴用の書き出し（`docs/accomp-compose.md` §12.5・§12.7）。
 * **テストには入れない。** 耳で仕様を聞き取るための出口。
 *
 *   npx tsx scripts/accomp-audition.ts --count 3 --seed 20260929 --key major --out tmp/accomp
 *   npx tsx scripts/accomp-audition.ts --count 3 --seed 20260929 --fb-plan --out tmp/accomp
 *   npx tsx scripts/accomp-audition.ts --app-seed 3842857959 --compose style:fb.v1:any:0 --out tmp/accomp
 *
 * - `--count n --seed s` … 種 s, s+1, … で n 曲。種はアプリと同じ使い方（`seededRandom(seed)` を
 *   `composeAccomp` に渡す）なので、書いた `#seed` と `#compose` でアプリの出力と同じ曲になる
 * - `--key` … ベース調（DAW の select の値。既定 any）。`--edo 31` で31平均律。`--no-color` で @0 なし
 * - `--app-seed n --compose style:<id>.v<版>:<baseKey>:<k>` … アプリで作った曲の再現（1曲）。
 *   旧書式 `accomp:<baseKey>:<k>`（段階 S0 より前。1・2日目の試聴ファイル）は `style:fb.v1:…` として読む
 * - `--fb-plan` … 陽性対照。fb を計画として書き直したもの（`scripts/fixtures/accomp-fb-plan.ts`）を
 *   生成器で鳴らす。`--count 0 --fb-plan` なら陽性対照だけ
 *
 * 出力（`--out`、既定 tmp/accomp）:
 * - `NN_….mml` … DAW の full 書き出しと同じ形（宣言・音符ごとの v・`#seed`・`#compose` 込み、`;\n` 区切り）
 * - `_summary.md` … 曲ごとの区間表（和声・セル・低音型・和音・基準 v・秒数・実測）と関門の結果
 * - `_questions.md` … 聞き取りの問い（1日目は陽性対照、2日目以降は生成曲を1日3本まで）
 *
 * **公開中の github.io の埋め込みは段階0（音符ごとの v）より前のビルド**なので、強弱が平らになって
 * 試聴にならない。ローカルの `pnpm dev`（demo/）の DAW に貼って聴くこと。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

// mml-parser は歌詞解析の先で @onjmin/koe（ブラウザ専用）を読むので、空のスタブへ
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { composeAccomp, parseAccompCompose } =
	require("../src/compose-accomp") as typeof import("../src/compose-accomp");
const { accompStyleById } =
	require("../src/accomp-styles/index") as typeof import("../src/accomp-styles/index");
const { accompToMml } =
	require("../src/compose-accomp-mml") as typeof import("../src/compose-accomp-mml");
const { accompGates, accompRegionMetrics } =
	require("../src/compose-accomp-check") as typeof import("../src/compose-accomp-check");
const { candidateStreams, drawSeed, fbPlan } =
	require("../src/compose-accomp-plan") as typeof import("../src/compose-accomp-plan");
const { realizeAccomp } =
	require("../src/compose-accomp-realize") as typeof import("../src/compose-accomp-realize");
const { seededRandom } =
	require("../src/compose") as typeof import("../src/compose");
const { FB_METRICS } =
	require("./fixtures/accomp-fb-plan") as typeof import("./fixtures/accomp-fb-plan");

type AccompSong = import("../src/compose-accomp").AccompSong;
type AccompRealized = import("../src/compose-accomp-realize").AccompRealized;

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);

const outDir = argOf("--out") ?? "tmp/accomp";
const count = Number.parseInt(argOf("--count") ?? "3", 10);
const baseSeed = Number.parseInt(argOf("--seed") ?? "20260929", 10);
const baseKey = argOf("--key") ?? "any";
const edo = argOf("--edo") === "31" ? 31 : 12;
const colorLine = !has("--no-color");
const withFb = has("--fb-plan");
const appSeedArg = argOf("--app-seed");
const appCompose = argOf("--compose");
if (!Number.isInteger(count) || count < 0)
	throw new Error("--count は 0 以上の整数");
if (!Number.isInteger(baseSeed)) throw new Error("--seed は整数");

type Entry = {
	file: string;
	/** 表示用の名前。 */
	label: string;
	song: AccompSong;
	seed: number;
	/** 陽性対照（fb の計画）か。 */
	fb: boolean;
};

/** 候補 k の乱数列（composeAccomp と同じ引き方: 調の種を1つ、候補ごとに6つ）。 */
const streamsAt = (seed: number, k: number) => {
	const random = seededRandom(seed);
	drawSeed(random);
	for (let i = 0; i < k; i++) candidateStreams(random);
	return candidateStreams(random);
};

/**
 * 曲の音（絶対値の v・和声上の扱い）を作り直す。composeAccomp の中と同じ乱数列を使うので、
 * トラックは曲と一致する（一致しなければ警告する）。関門と区間ごとの実測に使う。
 */
const realizedOf = (e: Entry): AccompRealized => {
	const s = e.song;
	const given = s.compose.endsWith(":plan");
	const r = realizeAccomp({
		plan: s.plan,
		...(s.pick >= 0 || given
			? { streams: streamsAt(e.seed, given ? 0 : s.pick) }
			: {}),
		stepsPerBar: s.stepsPerBar,
		edo: s.edo,
		colorLine: s.tracks[0].notes.length > 0 || colorLine,
	});
	if (JSON.stringify(r.tracks) !== JSON.stringify(s.tracks))
		console.warn(`  警告: ${e.file} の作り直しがトラックと一致しない`);
	return r;
};

const NOTE_NAMES = [
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
const noteName = (midi: number): string => {
	const m = Math.round(midi);
	return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};
/** ファイル名に使う調の名前（G♭ → Gb、C♯ → Cs）。 */
const fileKey = (s: AccompSong): string =>
	s.keyName.replace(/♭/g, "b").replace(/[♯#]/g, "s").replace(/[^\w]/g, "") ||
	`rs${s.rootShift}`;

// ============================================================
// 曲を作る
// ============================================================

mkdirSync(outDir, { recursive: true });
const entries: Entry[] = [];

if (appSeedArg !== undefined) {
	const seed = Number.parseInt(appSeedArg, 10);
	if (!Number.isFinite(seed)) throw new Error("--app-seed は整数");
	const tag = parseAccompCompose(appCompose ?? "style:fb.v1:any:0");
	if (!tag)
		throw new Error(
			`--compose ${appCompose}: style:<スタイル id>.v<版>:<baseKey>:<候補番号> ではない`,
		);
	const style = accompStyleById(tag.style);
	if (!style)
		throw new Error(`--compose ${appCompose}: 知らないスタイル ${tag.style}`);
	if (tag.version !== style.version)
		console.warn(
			`  ${tag.style} の版 ${tag.version} は今の版 ${style.version} と違うので、同じ曲にはならない（古い版は残していない）`,
		);
	if (tag.legacy)
		console.warn(
			`  旧書式 ${appCompose} を style:fb.v1:${tag.baseKey}:${tag.pick} として読む`,
		);
	if (tag.pick === "plan")
		throw new Error(
			`--compose ${appCompose}: …:plan は種から再現できない（--fb-plan を使う）`,
		);
	const key = tag.baseKey;
	const pick = tag.pick;
	const k = String(pick);
	const song = composeAccomp({
		style: tag.style,
		random: seededRandom(seed),
		baseKey: key,
		pick,
		edo,
		colorLine,
	});
	if (song.pick !== pick)
		console.warn(`  候補 ${pick} は関門で落ちたので保険の計画になった`);
	entries.push({
		file: `app_seed${seed}_${key}-${k}_${fileKey(song)}_${song.bpm}bpm.mml`,
		label: `アプリの再現（#seed=${seed} #compose=${song.compose}）`,
		song,
		seed,
		fb: false,
	});
} else {
	if (withFb) {
		const seed = baseSeed;
		const song = composeAccomp({
			random: seededRandom(seed),
			overrides: { plan: fbPlan() },
			edo,
			colorLine,
		});
		entries.push({
			file: `00_fb-plan_${fileKey(song)}_${song.bpm}bpm.mml`,
			label: "陽性対照（fb を計画として書き直し、生成器で鳴らしたもの）",
			song,
			seed,
			fb: true,
		});
	}
	for (let i = 0; i < count; i++) {
		const seed = baseSeed + i;
		const song = composeAccomp({
			random: seededRandom(seed),
			baseKey,
			edo,
			colorLine,
		});
		entries.push({
			file: `${String(i + 1).padStart(2, "0")}_seed${seed}_${baseKey}-${song.pick}_${fileKey(song)}_${song.bpm}bpm.mml`,
			label: `生成曲 ${i + 1}`,
			song,
			seed,
			fb: false,
		});
	}
}

// ============================================================
// 書き出す
// ============================================================

const summary: string[] = [
	"# 伴奏主体モードの試聴: 曲ごとの区間表",
	"",
	"`scripts/accomp-audition.ts` が書いた。区間の値は計画（表から引いたもの）と、音を置いた後の実測。",
	"実測は**表示だけ**で、採点・選抜には使っていない（`docs/accomp-compose.md` §7）。",
	"",
];

for (const e of entries) {
	const s = e.song;
	const file = join(outDir, e.file);
	writeFileSync(file, accompToMml(s, { seed: e.fb ? undefined : e.seed }));
	const r = realizedOf(e);
	const gates = accompGates(s.plan, r);
	const ms = accompRegionMetrics(s.plan, r);
	const colorNotes = r.notes.color;

	console.log(
		`${file}\n   ${s.bars}小節 ${s.seconds.toFixed(0)}秒 ${s.keyLabel} ${s.bpm}BPM  ${s.compose}  借用の組 ${s.plan.borrowPair}  関門 ${gates.length === 0 ? "全部通る" : gates.map((g) => g.gate).join(",")}`,
	);

	summary.push(`## ${e.file}`, "");
	summary.push(`- ${e.label}`);
	summary.push(
		`- ${s.keyLabel}・${s.bpm}BPM・${s.bars}小節・${s.seconds.toFixed(1)}秒・${s.edo}平均律${s.homeFromMinor ? `・${s.homeFromMinor}` : ""}`,
	);
	summary.push(
		`- \`#compose=${s.compose}\`${e.fb ? "" : ` \`#seed=${e.seed}\``}・候補 ${s.pick}（引いた候補 ${s.draws.tried}、落ちた理由 ${JSON.stringify(s.draws.rejected)}）`,
	);
	if (!e.fb && s.pick >= 0)
		summary.push(
			`- 再現: \`npx tsx scripts/accomp-audition.ts --app-seed ${e.seed} --compose ${s.compose}${edo === 31 ? " --edo 31" : ""}\``,
		);
	summary.push(
		`- 関門: ${gates.length === 0 ? "全部通る" : gates.map((g) => `${g.gate}（${g.detail}）`).join("、")}`,
	);
	summary.push(
		`- 全体: ぶつかり ${s.stats.clashesPerBar}/小節・v の種類 ${s.stats.vKinds.join("／")}（@0〜@3）・和音の一打の長さ 借用 ${s.stats.compMeanLen.borrowed} / 本調 ${s.stats.compMeanLen.diatonic}（16分）・分散の音程 ${Object.entries(
			s.stats.arpIntervalHist,
		)
			.map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
			.join(" ")}`,
	);
	summary.push(
		`- @0 色の線: ${colorNotes.length}音（${colorNotes.map((n) => `${n.bar + 1}小節 ${noteName(n.midi)}`).join("、") || "なし"}）`,
	);
	summary.push("");
	summary.push(
		"| 区間 | 小節 | 秒 | セル（4小節ごと） | 低音型 | 和音 | 基準 v | 分散/秒 | 上半分 | v 平均 | 低音/小節 | 往復率 |",
	);
	summary.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
	s.plan.regions.forEach((reg, i) => {
		const m = ms[i];
		const fbm = e.fb ? FB_METRICS[reg.role] : undefined;
		const withFbValue = (v: string, f: number | undefined): string =>
			f === undefined ? v : `${v}（fb ${f}）`;
		const lv = reg.arpLevel;
		summary.push(
			`| ${reg.label} | ${reg.startBar + 1}〜${reg.startBar + reg.bars} | ${((reg.bars * 240) / s.bpm).toFixed(1)} | ${reg.texture.arpCells.join(" ")} | ${reg.texture.bass.join(" ")} | ${reg.texture.comp}・段${reg.texture.compRegister} | ${lv[0]}→${Math.max(...lv)}→${lv[lv.length - 1]} | ${withFbValue(m.arpPerSec.toFixed(2), fbm?.arpPerSec)} | ${withFbValue(`${m.upperMean.toFixed(1)}（${noteName(m.upperMean)}）`, fbm?.upperMean)} | ${withFbValue(m.vMean.toFixed(1), fbm?.vMean)} | ${withFbValue(m.bassPerBar.toFixed(2), fbm?.bassPerBar)} | ${withFbValue(m.roundTrip.toFixed(2), fbm?.roundTrip)} |`,
		);
	});
	summary.push("");
	summary.push(
		"和声（ハ長調基準のローマ数字。調は上の rootShift で移す）:",
		"",
	);
	for (const reg of s.plan.regions)
		summary.push(`- ${reg.label}: \`${reg.chords.join(" | ")}\``);
	summary.push("");
}
writeFileSync(join(outDir, "_summary.md"), summary.join("\n"));

const fbEntry = entries.find((e) => e.fb);
const generated = entries.filter((e) => !e.fb);
const questions: string[] = [
	"# 伴奏主体モードの試聴: 聞き取りの問い",
	"",
	"**聴き方**: ローカルの `pnpm dev`（demo/）の DAW に .mml を貼って鳴らす。公開中の github.io の埋め込みは",
	"段階0（音符ごとの v の保持）より前のビルドなので、強弱が平らになって試聴にならない。",
	"",
	"**1日に聴くのは3本まで**（1本2分半〜3分）。陽性対照の日と生成曲の日を分ける（`docs/accomp-compose.md` §12.7）。",
	"目隠しの A/B や順位付けはしない。回答は `docs/accomp-reviews.md` に記録し、挙がった「直す場所」を",
	"表（`src/compose-accomp-tables.ts`）のどの行かに対応づける。",
	"",
];
if (fbEntry)
	questions.push(
		"## 1日目: 陽性対照（2本）",
		"",
		"- `tmp/full/fb.space.mml`（原曲。所有者が評価した手書き編曲）",
		`- \`${fbEntry.file}\`（fb を計画として書き直し、生成器で鳴らしたもの）`,
		"",
		"1. 同じ種類の曲か",
		"2. 別物になった所はどこか（区間・トラック・何が）",
		"",
	);
if (generated.length > 0) {
	questions.push(
		`## ${fbEntry ? "2日目以降" : "生成曲"}: 生成曲（1日3本まで）`,
		"",
		"曲ごとに3問（handover の曲まるごとの聞き取りと同じ）。",
		"",
		"1. 出発点として使うか（この曲を土台に手を入れるか、捨ててゼロから書くか）",
		"2. 最初に直す場所（どの区間の、どのトラックの、何を）",
		"3. 直す理由を一言（つまらない／おかしい／足りない／多い、など）",
		"",
	);
	for (const e of generated)
		questions.push(
			`### ${e.file}`,
			"",
			`${e.song.keyLabel}・${e.song.bpm}BPM・${e.song.seconds.toFixed(0)}秒（区間の表は \`_summary.md\`）`,
			"",
			"1. 使う／捨てる: ",
			"2. 最初に直す場所: ",
			"3. 理由: ",
			"",
		);
}
writeFileSync(join(outDir, "_questions.md"), questions.join("\n"));
console.log(`${join(outDir, "_summary.md")}\n${join(outDir, "_questions.md")}`);
