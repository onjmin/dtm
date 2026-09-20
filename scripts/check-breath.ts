/**
 * ブレス（`、`）のチェック。
 *
 * 「どの音源でも `、` で『ツ』と鳴る。ブレスに聞こえない」という指摘から、
 * ブレスを (1) 音源が息継ぎ素片を持っていればそれを、(2) 無ければ吸気の形をした
 * ノイズを鳴らす、に変えた。ここでは音を出さずに決められる2点を見る。
 *
 *  - 息継ぎ素片のエイリアス判定と、隙間の長さに対する素片の選び方
 *    （手元の UTAU 音源を洗った命名: テト `息1`/`b1`、キリコ `息`、ロゼ `息短`〜`息深2`、
 *      ルコ♀ `息1`〜`息3` と吐く息 `息吐1`、テトの `a息 R`）。
 *  - 結合後のノートが「実際に削った隙間」（`breathGapSec`）を持つこと。
 *    ノイズ経路はこの隙間を息の長さにするので、短い音符では隙間も短くなる。
 */
import Module from "node:module";

// `src/lyrics.ts` はブラウザ専用の @onjmin/koe を読むので、名前解決だけ空スタブへ差し替える
// （check-lyrics-fade.ts と同じ手口）。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const {
	buildStreamVoiceNotes,
	normalizeLyrics,
	isBreathAlias,
	pickBreathAlias,
	pickBreathSample,
	breathPeakPosition,
} = require("../src/lyrics") as typeof import("../src/lyrics");
const { units } = require("../src/tuning") as typeof import("../src/tuning");
type TieSourceNote = import("../src/lyrics").TieSourceNote;
type PhonemeEntry = import("@onjmin/koe").PhonemeEntry;

let failed = 0;
const check = (ok: boolean, label: string, why: string, detail = ""): void => {
	if (!ok) failed++;
	console.log(
		`  ${ok ? "OK  " : "NG  "}${label}${detail ? `  →  ${detail}` : ""}`,
	);
	console.log(`        ${why}`);
};

// ── 1. エイリアス判定 ─────────────────────────────────────────────
console.log("● 息継ぎ素片のエイリアス判定");
const ALIAS_CASES: [alias: string, expect: boolean, why: string][] = [
	["息", true, "キリコ: 素の「息」"],
	["息1", true, "テト（エクストラ）/ルコ♀: 番号つき"],
	["b1", true, "テト（エクストラ）の別名 b1〜b3"],
	["息短2", true, "ロゼ: 短/中/深 + 番号"],
	["息（短）拡", true, "ロゼ拡張音声: 全角括弧つき"],
	["_息2", true, "ファイル名側の下線つきでも拾う"],
	["br", true, "英語圏の慣習 br"],
	["breath2", true, "英語圏の慣習 breath + 番号"],
	["息吐1", false, "吐く息（語尾の抜け）は吸気ではない"],
	["a息 R", false, "母音の後の吐息（テトの _あb.wav）は吸気ではない"],
	["巻", false, "巻き舌はブレスではない"],
	["ば", false, "ふつうの音節"],
	["b", false, "単独 b は子音単体のエイリアスかもしれないので拾わない"],
	["bo", false, "b + 母音は音節"],
];
for (const [alias, expect, why] of ALIAS_CASES) {
	check(
		isBreathAlias(alias) === expect,
		`${alias} → ${expect ? "息" : "×"}`,
		why,
	);
}

// ── 2. 隙間に対する素片の選び方 ───────────────────────────────────
console.log("\n● 隙間の長さに対する素片の選択");
const entry = (sec: number): PhonemeEntry => ({
	offset: 0,
	length: Math.round(sec * 48000),
	pre: 0,
	overlap: 0,
	consonant: 0,
	pitch: 0,
});
const ROZE: Record<string, PhonemeEntry> = {
	あ: entry(1.0),
	息深: entry(1.163),
	息深2: entry(1.368),
	息短: entry(0.561),
	息短2: entry(0.347),
	息中: entry(0.841),
};
check(
	pickBreathAlias(ROZE, 0.29) === "息短2",
	"ロゼ / 隙間0.29s",
	"隙間以上でいちばん短い素片（0.347s）を選ぶ",
	pickBreathAlias(ROZE, 0.29) ?? "null",
);
check(
	pickBreathAlias(ROZE, 0.5) === "息短",
	"ロゼ / 隙間0.5s",
	"0.347s では足りないので次に短い 0.561s",
	pickBreathAlias(ROZE, 0.5) ?? "null",
);
check(
	pickBreathAlias(ROZE, 2.0) === "息深2",
	"ロゼ / 隙間2.0s",
	"どれも足りなければいちばん長いもの（深い息）",
	pickBreathAlias(ROZE, 2.0) ?? "null",
);
const KIRIKO: Record<string, PhonemeEntry> = {
	あ: entry(1.0),
	息: entry(0.657),
};
check(
	pickBreathAlias(KIRIKO, 0.2) === "息",
	"キリコ / 隙間0.2s",
	"1つしか無ければそれ（隙間より長い分は頭を切って尻を揃える）",
	pickBreathAlias(KIRIKO, 0.2) ?? "null",
);
const RUKO: Record<string, PhonemeEntry> = {
	あ: entry(1.0),
	息1: entry(0.336),
	息2: entry(1.057),
	息3: entry(0.917),
	息吐1: entry(0.61),
	息吐2: entry(0.856),
};
check(
	pickBreathAlias(RUKO, 0.5) === "息3",
	"ルコ♀ / 隙間0.5s",
	"吐く息（息吐1 0.61s）は候補に入れず、吸気の中で上限（0.9s）を超えるものしか無ければ頭を切る量が少ない 0.917s",
	pickBreathAlias(RUKO, 0.5) ?? "null",
);
const TETO: Record<string, PhonemeEntry> = {
	あ: entry(1.0),
	"a息 R": entry(0.4),
};
check(
	pickBreathAlias(TETO, 0.2) === null,
	"テト単独音（配信中の .koe）/ 隙間0.2s",
	"吸気の素片が無い音源は null → ノイズのブレスへ落ちる",
	String(pickBreathAlias(TETO, 0.2)),
);

// ── 2b. 吸う形と吐く形の見分けと、取得済み素片の選択 ───────────────
console.log("\n● 包絡の山の位置（吸う形 / 吐く形）");
const SR = 48000;
/** 包絡 f(t) (0..1) を持つノイズを作る。 */
const shaped = (sec: number, f: (t: number) => number): Float64Array => {
	const n = Math.round(sec * SR);
	const out = new Float64Array(n);
	for (let i = 0; i < n; i++) out[i] = (Math.random() * 2 - 1) * f(i / n);
	return out;
};
const rising = breathPeakPosition(
	shaped(0.3, (t) => 0.05 + 0.95 * t ** 2),
	SR,
);
const falling = breathPeakPosition(
	shaped(0.3, (t) => Math.exp(-6 * t)),
	SR,
);
check(
	rising > 0.9,
	"尻へ向かって膨らむ（吸う形）",
	"山が 0.9 より後ろ",
	rising.toFixed(2),
);
check(
	falling < 0.1,
	"頭で出て減る（吐く形）",
	"山が 0.1 より前",
	falling.toFixed(2),
);
// テトの実測: 息1 0.17s 山0.67 / 息2 0.36s 山0.40 / 息3 0.35s 山0.21（吐く形）
const TETO_SAMPLES = [
	{ alias: "息1", sec: 0.17, peakAt: 0.67 },
	{ alias: "息2", sec: 0.36, peakAt: 0.4 },
	{ alias: "息3", sec: 0.35, peakAt: 0.21 },
];
check(
	pickBreathSample(TETO_SAMPLES, 0.24)?.alias === "息2",
	"テト / 隙間0.24s",
	"長さだけなら 息3（0.35s）だが、吐く形なので除いて 息2 を選ぶ",
	pickBreathSample(TETO_SAMPLES, 0.24)?.alias ?? "null",
);
check(
	pickBreathSample(TETO_SAMPLES, 0.1)?.alias === "息1",
	"テト / 隙間0.10s",
	"短い隙間には短い吸う形（息1）",
	pickBreathSample(TETO_SAMPLES, 0.1)?.alias ?? "null",
);
const ALL_EXHALE = [
	{ alias: "x1", sec: 0.2, peakAt: 0.1 },
	{ alias: "x2", sec: 0.4, peakAt: 0.2 },
];
check(
	pickBreathSample(ALL_EXHALE, 0.24)?.alias === "x2",
	"吸う形が1つも無い音源",
	"全部の中から長さで選ぶ（無音にはしない）",
	pickBreathSample(ALL_EXHALE, 0.24)?.alias ?? "null",
);

// ── 3. 結合後ノートの隙間 ─────────────────────────────────────────
console.log("\n● ブレスで削った隙間（breathGapSec）");
const SECONDS_PER_STEP = 0.25;
const notesOf = (durations: number[]): TieSourceNote[] => {
	let step = 0;
	return durations.map((d) => {
		const n: TieSourceNote = {
			startStep: step,
			durationSteps: d,
			pitchUnits: units(2139),
		};
		step += d;
		return n;
	});
};
const build = (lyrics: string, durations: number[]) =>
	buildStreamVoiceNotes(normalizeLyrics(lyrics), notesOf(durations), {
		fromStep: 0,
		secondsPerStep: SECONDS_PER_STEP,
		gate: 1,
		octaveShiftUnits: 0,
	});
{
	const [a, b] = build("あ、い", [4, 4]); // 1.0s + 1.0s
	const gap = a.breathGapSec ?? 0;
	check(
		a.breath === true &&
			Math.abs(gap - 0.24) < 1e-9 &&
			Math.abs(a.durationSec - 0.76) < 1e-9,
		"あ(1.0s)、い",
		"長い音符からは息1回ぶん（0.24s）を削り、削った長さをノートが持つ",
		`gap=${gap.toFixed(3)} dur=${a.durationSec.toFixed(3)}`,
	);
	check(
		!b.breath && b.breathGapSec === undefined,
		"次の音",
		"ブレスは直前ノートにだけ立つ",
	);
}
{
	const [a] = build("あ、い", [1, 1]); // 0.25s
	const gap = a.breathGapSec ?? 0;
	check(
		Math.abs(gap - 0.1) < 1e-9 && Math.abs(a.durationSec - 0.15) < 1e-9,
		"あ(0.25s)、い",
		"短い音符は4割までしか削らない（0.25s → 隙間0.10s）。息はこの隙間に合わせて短くなる",
		`gap=${gap.toFixed(3)} dur=${a.durationSec.toFixed(3)}`,
	);
}
{
	const [a] = build("あーー、い", [1, 1, 1, 1]); // 結合 0.75s
	const gap = a.breathGapSec ?? 0;
	check(
		a.breath === true && Math.abs(gap - 0.24) < 1e-9,
		"あーー(0.75s)、い",
		"継続で結合した音でも、削るのは結合後の全体から1回ぶん",
		`gap=${gap.toFixed(3)}`,
	);
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
