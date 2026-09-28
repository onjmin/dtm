/**
 * 伴奏主体モードのスタイルの検査（`docs/accomp-style-engine.md` §7.1 の `check-accomp-styles.ts`、段階 S1）。
 * 登録した全スタイルを同じコードで回す（スタイルが増えると実行時間だけが増える）。
 *
 * - スキーマ（`validateStylePack`）と、いまのエンジンの前提（`engineSupportProblems`）を全スタイルが満たす。
 *   壊したスタイルを、それぞれの検査が捕まえる（陰性対照）
 * - 登録表: id が重ならない・既定のスタイルが登録されている・タグの語彙が増えていない
 * - 型ごとの参照計画: 全調・型のテンポの表の全テンポで計画の段の前提を満たし、秒数の範囲に入る
 *   （§4.2 の lint。いままで fb 専用だった検査を全スタイル・全型へ）。基準の調では関門も通る
 * - エンジンは表をスタイルから読む: `compose-accomp*.ts` は互換の口（`compose-accomp-tables.ts`）も
 *   スタイルの本体（`accomp-styles/<id>.ts`）も直接読まない。互換の口の値はスタイルの値そのもの
 * - DAW のミックス解放（§2.4）: `accompMixToRelease` の判定と、`daw.ts` がスタイルの表を直接見ずに
 *   曲のミックス（`song.mix`）とスタイルの層（`LayerDef.presetSlot`）を使っていること。DAW と UI の
 *   コードにスタイル名が無いこと
 * - 表示だけ: エンジンのコードに出てくるスタイルの id（役割・行・パターン）の数（S3g で0にする。§2.1）
 *
 * 黄金値（1バイトも違わないこと）は `scripts/check-accomp-golden.ts`（`pnpm test` で続けて回す）。
 *
 *   npx tsx scripts/check-accomp-styles.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const styles =
	require("../src/accomp-styles/index") as typeof import("../src/accomp-styles/index");
const styleView =
	require("../src/compose-accomp-style") as typeof import("../src/compose-accomp-style");
const plan =
	require("../src/compose-accomp-plan") as typeof import("../src/compose-accomp-plan");
const realize =
	require("../src/compose-accomp-realize") as typeof import("../src/compose-accomp-realize");
const gates =
	require("../src/compose-accomp-check") as typeof import("../src/compose-accomp-check");
const entry =
	require("../src/compose-accomp") as typeof import("../src/compose-accomp");
const tables =
	require("../src/compose-accomp-tables") as typeof import("../src/compose-accomp-tables");
const { seededRandom } =
	require("../src/compose") as typeof import("../src/compose");
const { COMPOSE_KEYS } =
	require("../src/compose-keys") as typeof import("../src/compose-keys");

type StylePack = import("../src/accomp-styles/schema").StylePack;
type AccompMix = import("../src/compose-accomp").AccompMix;

const {
	ACCOMP_STYLES,
	DEFAULT_ACCOMP_STYLE,
	ROLE_TAGS,
	accompStyleById,
	validateStylePack,
} = styles;
const { accompStyleView, engineSupportProblems } = styleView;
const { accompMixToRelease, accompPresetSlots, composeAccomp } = entry;

let failed = 0;
const ok = (label: string, cond: boolean, detail?: unknown): void => {
	if (cond) {
		console.log(`  ok   ${label}`);
		return;
	}
	failed++;
	console.log(`  FAIL ${label}`);
	if (detail !== undefined)
		console.log(
			`       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
		);
};
const section = (name: string): void => console.log(`\n# ${name}`);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const throws = (f: () => unknown): boolean => {
	try {
		f();
		return false;
	} catch {
		return true;
	}
};
const src = (file: string): string =>
	readFileSync(join(__dirname, "..", "src", file), "utf8");

// ============================================================
section("登録表");
{
	const ids = ACCOMP_STYLES.map((s) => s.id);
	ok(
		`スタイル ${ids.join("・")}: id が重ならず、既定のスタイル（${DEFAULT_ACCOMP_STYLE.id}）が登録されている`,
		new Set(ids).size === ids.length &&
			ACCOMP_STYLES.includes(DEFAULT_ACCOMP_STYLE) &&
			ids.every((id) => accompStyleById(id)?.id === id) &&
			accompStyleById("nope") === undefined,
	);
	ok(
		"役割のタグの語彙が増えていない（home・peak・weakest・echo・borrow・loopStart。§3.1）",
		JSON.stringify(ROLE_TAGS) ===
			JSON.stringify([
				"home",
				"peak",
				"weakest",
				"echo",
				"borrow",
				"loopStart",
			]),
	);
}

// ============================================================
section("スキーマといまのエンジンの前提（全スタイル）");
for (const pack of ACCOMP_STYLES) {
	const v = validateStylePack(pack);
	ok(`${pack.id}: スキーマ（validateStylePack）を満たす`, v.length === 0, v);
	const e = engineSupportProblems(pack);
	ok(
		`${pack.id}: 段階 S1 のエンジンの前提を満たす（7役割・4層・型とミックスと並びが1つ）`,
		e.length === 0,
		e,
	);
	ok(
		`${pack.id}: 表示名と説明がある・版が 1 以上・出所は references/${pack.id}/ の中`,
		pack.label.length > 0 &&
			pack.description.length > 0 &&
			pack.version >= 1 &&
			pack.provenance.every((p) => p.startsWith(`references/${pack.id}/`)),
	);
}
{
	// 陰性対照: 壊したスタイルを、それぞれの検査が捕まえる
	const base = DEFAULT_ACCOMP_STYLE;
	const broken: { label: string; mutate: (p: StylePack) => void }[] = [
		{
			label: "id に . を入れる",
			mutate: (p) => {
				(p as { id: string }).id = "fb.x";
			},
		},
		{
			label: "版を 0 にする",
			mutate: (p) => {
				(p as { version: number }).version = 0;
			},
		},
		{
			label: "セルの行 id を重ねる",
			mutate: (p) => {
				(p.patterns.arp as { id: string }[])[1].id = p.patterns.arp[0].id;
			},
		},
		{
			label: "句の重みを 0 にする",
			mutate: (p) => {
				(p.harmony.pools.homeOpen[0] as { weight: number }).weight = 0;
			},
		},
		{
			label: "出所（from）を消す",
			mutate: (p) => {
				delete (p.patterns.bass[0] as { from?: unknown }).from;
			},
		},
		{
			label: "低音型の1小節を16でなくする",
			mutate: (p) => {
				(p.patterns.bass[0].body.bars[0] as [string, number][])[0][1] = 5;
			},
		},
		{
			label: "役割の質感に無いセルを書く",
			mutate: (p) => {
				const t = p.archetypes[0][0].texture as Record<
					string,
					{ cells: { kind: string; pool?: [string, number][] } }
				>;
				t.home.cells.pool = [["nope", 1]];
			},
		},
		{
			label: "ミックスの層を1つ消す",
			mutate: (p) => {
				delete (p.archetypes[0][0].mix[0][0].layers as Record<string, unknown>)
					.comp;
			},
		},
		{
			label: "並びに無い役割を書く",
			mutate: (p) => {
				(p.archetypes[0][0].form[0][0] as string[])[1] = "nope";
			},
		},
		{
			label: "知らないタグを付ける",
			mutate: (p) => {
				(p.roles as Record<string, { tags: string[] }>).home.tags = ["fb"];
			},
		},
	];
	const missed = broken
		.filter(({ mutate }) => {
			const p = clone(base);
			mutate(p);
			return validateStylePack(p).length === 0;
		})
		.map((b) => b.label);
	ok(
		`スキーマの陰性対照 ${broken.length} 項目（id の文字・版・行 id の重複・重み・出所・16の合計・参照先・ミックスの層・並びの役割・タグ）をすべて捕まえる`,
		missed.length === 0,
		missed,
	);
	const unsupported: { label: string; mutate: (p: StylePack) => void }[] = [
		{
			label: "型を2つにする",
			mutate: (p) => {
				const a = clone(p.archetypes[0][0]);
				(a as { id: string }).id = "fb2";
				(p.archetypes as unknown[]).push([a, 1]);
			},
		},
		{
			label: "ミックスを2つにする",
			mutate: (p) => {
				const m = clone(p.archetypes[0][0].mix[0][0]);
				(m as { id: string }).id = "other";
				(p.archetypes[0][0].mix as unknown[]).push([m, 1]);
			},
		},
		{
			label: "層を入れ替える",
			mutate: (p) => {
				(p.layers as unknown[]).reverse();
			},
		},
		{
			label: "並びの順を変える（役割は7つのまま）",
			mutate: (p) => {
				const f = p.archetypes[0][0].form[0][0] as string[];
				const i = f.indexOf("glimpse");
				[f[i], f[i + 1]] = [f[i + 1], f[i]];
			},
		},
		{
			label: "短調を asIs にする",
			mutate: (p) => {
				(p.key as { minorPolicy: string }).minorPolicy = "asIs";
			},
		},
		{
			label: "和音の打ち方 final を消す",
			mutate: (p) => {
				(p.patterns as { comp: unknown[] }).comp = p.patterns.comp.filter(
					(r) => r.id !== "final",
				);
			},
		},
	];
	const missedEngine = unsupported
		.filter(({ mutate }) => {
			const p = clone(base);
			mutate(p);
			return engineSupportProblems(p).length === 0;
		})
		.map((b) => b.label);
	const p = clone(base);
	(p as { version: number }).version = 0;
	ok(
		`エンジンの前提の陰性対照 ${unsupported.length} 項目（型2つ・ミックス2つ・層の並び・役割の並びの順・短調の扱い・優先順位が引く打ち方）をすべて捕まえ、読めないスタイルは accompStyleView が例外にする`,
		missedEngine.length === 0 && throws(() => accompStyleView(p)),
		missedEngine,
	);
}

// ============================================================
section(
	"型ごとの参照計画（全スタイル・全型・全調・型のテンポの全テンポ。§4.2・§5）",
);
{
	const majorShifts = [
		...new Set(
			Object.values(COMPOSE_KEYS)
				.filter((k) => k.mode === "major")
				.map((k) => k.rootShift),
		),
	].sort((a, b) => a - b);
	for (const pack of ACCOMP_STYLES)
		for (const [a] of pack.archetypes) {
			const v = accompStyleView(pack.id, a.id);
			const bars = v.itinerary.reduce((s, r) => s + v.referenceLengths[r], 0);
			const outOfRange = v.tempo
				.map(([bpm]) => [bpm, (bars * 240) / bpm] as const)
				.filter(([, sec]) => sec < a.seconds.min || sec > a.seconds.max);
			ok(
				`${pack.id}/${a.id}: 参照計画（${bars}小節）が、テンポの表の全テンポ（${v.tempo.map(([b]) => b).join("・")}）で秒数の範囲（${a.seconds.min}〜${a.seconds.max}）に入る`,
				outOfRange.length === 0,
				outOfRange,
			);
			const problems: string[] = [];
			for (const rs of majorShifts)
				for (const [bpm] of v.tempo) {
					const p = plan.fbPlan(rs, bpm, pack.id);
					const pv = plan.planViolations(p);
					if (pv.length > 0)
						problems.push(`${rs} ${bpm}: ${pv[0].gate} ${pv[0].detail}`);
					if (p.style !== pack.id || p.archetype !== a.id)
						problems.push(`${rs} ${bpm}: 記録 ${p.style}/${p.archetype}`);
				}
			for (const [bpm] of v.tempo) {
				const p = plan.fbPlan(4, bpm, pack.id);
				const g = gates.accompGates(p, realize.realizeAccomp({ plan: p }));
				if (g.length > 0) problems.push(`4 ${bpm}: 関門 ${g[0].gate}`);
			}
			ok(
				`${pack.id}/${a.id}: 参照計画が長調${majorShifts.length}調 × ${v.tempo.length}テンポで計画の段の前提を満たし、基準の調（rootShift 4）では全テンポで関門も通る`,
				problems.length === 0,
				problems.slice(0, 5),
			);
		}
}

// ============================================================
section("エンジンは表をスタイルから読む（§2.1・段階 S1）");
{
	const ENGINE = [
		"compose-accomp.ts",
		"compose-accomp-plan.ts",
		"compose-accomp-realize.ts",
		"compose-accomp-check.ts",
		"compose-accomp-mml.ts",
		"compose-accomp-style.ts",
	];
	const offenders = ENGINE.filter((f) => {
		const s = src(f);
		return (
			/from "\.\/compose-accomp-tables"/.test(s) ||
			/from "\.\/accomp-styles\/(?!index"|schema")/.test(s)
		);
	});
	ok(
		"エンジンの6ファイルは、互換の口（compose-accomp-tables）もスタイルの本体（accomp-styles/<id>）も直接 import しない（登録表と型だけ）",
		offenders.length === 0,
		offenders,
	);
	const shim = src("compose-accomp-tables.ts");
	ok(
		"互換の口（compose-accomp-tables.ts）は値を持たず、スタイルとエンジンから読み直すだけ（数の配列・文字列の表が無い）",
		!/\[\s*\d+\s*,\s*\d+\s*\]/.test(shim) &&
			!/"(Lead|Synth|Electric|retro_game|short2|ho_fb|walk)/.test(shim),
	);
	const v = accompStyleView();
	ok(
		"互換の口の値は、既定のスタイルの値そのもの（ARP_CELLS・ROLE_TEXTURE・LEVELS・BORROW_PAIRS・ACCOMP_MIX ほか）",
		tables.ARP_CELLS === v.arpCells &&
			tables.ROLE_TEXTURE === v.roleTexture &&
			tables.LEVELS === v.levels &&
			tables.BORROW_PAIRS === v.borrowPairs &&
			tables.HOME_OPEN === v.pools.homeOpen &&
			tables.COMP_HITS === v.compHits &&
			tables.BPM_TABLE === v.tempo &&
			tables.ACCOMP_MIX === v.mixes.get(v.mixId) &&
			tables.ARP_RATE.lift === v.arpRate.lift &&
			tables.FB_LENGTHS === v.referenceLengths,
	);

	// 表示だけ: エンジンのコードに出てくるスタイルの id（S3g で0にする）
	const ids = new Set<string>();
	for (const pack of ACCOMP_STYLES) {
		ids.add(pack.id);
		for (const r of Object.keys(pack.roles)) ids.add(r);
		for (const [a] of pack.archetypes) {
			ids.add(a.id);
			for (const [m] of a.mix) ids.add(m.id);
		}
		for (const name of Object.keys(pack.harmony.pools)) ids.add(name);
		for (const list of [
			...Object.values(pack.harmony.pools),
			pack.harmony.borrowSets,
			pack.patterns.arp,
			pack.patterns.bass,
			pack.patterns.comp,
		])
			for (const r of list) ids.add(r.id);
	}
	const counts = ENGINE.map((f) => {
		const s = src(f);
		let n = 0;
		for (const m of s.matchAll(/"([A-Za-z0-9_]+)"/g)) if (ids.has(m[1])) n++;
		return `${f.replace(".ts", "")} ${n}`;
	});
	console.log(
		`  info エンジンのコードの引用符つきのスタイルの id（役割・行・パターン・句の表・型・ミックス。S3g で0にする）: ${counts.join("・")}`,
	);
}

// ============================================================
section("DAW のミックス解放（§2.4）");
{
	const song = composeAccomp({ random: seededRandom(11), baseKey: "major" });
	const m = song.mix;
	const now = {
		delayAmount: m.masterFx.delayAmount,
		delayDivision: m.masterFx.delayDivision as string,
		loop: m.loop,
	};
	const remembered = { compose: song.compose, mix: m };
	const r = (
		compose: string | null,
		state: typeof now,
		rem?: { compose: string; mix: AccompMix } | null,
	): string => {
		const x = accompMixToRelease(compose, state, rem);
		return `${x.delay ? "delay" : "-"}/${x.loop ? "loop" : "-"}`;
	};
	const other: AccompMix = {
		...clone(m),
		masterFx: { ...m.masterFx, delayAmount: 40, delayDivision: "4" },
		loop: false,
	};
	const cases: [string, string, string][] = [
		[
			"作った直後（作った時点の song.mix と同じ値）→ ディレイもループも戻す",
			r(song.compose, now, remembered),
			"delay/loop",
		],
		[
			"利用者がディレイの量を変えた → ディレイは残し、ループは戻す",
			r(song.compose, { ...now, delayAmount: now.delayAmount + 1 }, remembered),
			"-/loop",
		],
		[
			"利用者がディレイの音価だけ変えた → ディレイは残す",
			r(song.compose, { ...now, delayDivision: "4" }, remembered),
			"-/loop",
		],
		[
			"利用者がループを切った → ループは触らない",
			r(song.compose, { ...now, loop: false }, remembered),
			"delay/-",
		],
		[
			"歌ものの作曲（#compose=テンプレート:調:音階:構成）→ 何も戻さない",
			r("custom:any:auto:intro-verse-chorus", now, remembered),
			"-/-",
		],
		["#compose が無い → 何も戻さない", r(null, now, remembered), "-/-"],
		[
			"キープや読み込みで別の伴奏主体の曲に替わった（覚えた #compose と違う）→ その曲のスタイルのミックスと比べる",
			r(song.compose.replace(/:\d+$/, ":7"), now, remembered),
			"delay/loop",
		],
		[
			"旧書式（accomp:<baseKey>:<k>）で覚えた値が無い → fb のミックスと比べる",
			r("accomp:major:0", now, null),
			"delay/loop",
		],
		[
			"知らないスタイルで覚えた値が無い → 何も戻さない",
			r("style:zz.v1:any:0", now, null),
			"-/-",
		],
		[
			"覚えた song.mix と比べる（定数ではない）: 覚えたミックスがディレイ 40・4分・ループなしなら、fb の値のままでも戻さない",
			r(song.compose, now, { compose: song.compose, mix: other }),
			"-/-",
		],
		[
			"覚えたミックスの値のままなら戻す",
			r(
				song.compose,
				{ delayAmount: 40, delayDivision: "4", loop: false },
				{ compose: song.compose, mix: other },
			),
			"delay/loop",
		],
	];
	const wrong = cases.filter(([, got, want]) => got !== want);
	ok(
		`accompMixToRelease の判定 ${cases.length} 通り（作った直後・利用者が変えた値・歌もの・キープと読み込み・旧書式・知らないスタイル・覚えた song.mix と比べること）`,
		wrong.length === 0,
		wrong.map(([label, got, want]) => `${label}: ${got}（${want} のはず）`),
	);
	ok(
		"曲のトラックから DAW の枠への対応は、スタイルの層の定義（LayerDef.presetSlot）から作り、fb ではいままでの値（color→submelody・arp→melody・bass→bass・comp→chord）",
		JSON.stringify(accompPresetSlots(song)) ===
			JSON.stringify({
				color: "submelody",
				arp: "melody",
				bass: "bass",
				comp: "chord",
			}) &&
			song.tracks.every((t) => accompPresetSlots(song)[t.slot] !== undefined),
	);

	const daw = src("daw.ts");
	const fn = (name: string): string => {
		const i = daw.indexOf(`const ${name} = `);
		if (i < 0) return "";
		const j = daw.indexOf("\n\t\tconst ", i + 1);
		return daw.slice(i, j < 0 ? undefined : j);
	};
	const release = fn("releaseAccompMix");
	const runCompose = fn("runCompose");
	const runAccomp = fn("runComposeAccomp");
	const problems: string[] = [];
	if (/compose-accomp-tables/.test(daw))
		problems.push("compose-accomp-tables を import している");
	if (/ACCOMP_MIX|ACCOMP_COMPOSE_SLOT|Record<AccompSlot/.test(daw))
		problems.push("ACCOMP_MIX か4枠の固定の対応を持っている");
	if (
		!/accompMixToRelease\(/.test(release) ||
		!/composedAccompMix/.test(release)
	)
		problems.push(
			"releaseAccompMix が accompMixToRelease と覚えた song.mix を使っていない",
		);
	if (
		!(
			runCompose.indexOf("releaseAccompMix()") >= 0 &&
			runCompose.indexOf("releaseAccompMix()") <
				runCompose.indexOf("composeSetting =")
		)
	)
		problems.push(
			"runCompose が composeSetting を書き換える前に releaseAccompMix を呼んでいない",
		);
	if (
		!/composedAccompMix = \{ compose: song\.compose, mix: song\.mix \}/.test(
			runAccomp,
		)
	)
		problems.push("runComposeAccomp が作った時点の song.mix を覚えていない");
	// MML を読み込んだら覚えた song.mix を捨てる（#compose は種を含まず、別の曲でも同じ文字列になる）
	if (
		!/composeSetting = meta\.compose \?\? null;\n(?:\s*\/\/[^\n]*\n)*\s*composedAccompMix = null;/.test(
			daw,
		)
	)
		problems.push(
			"MML の読み込みで、覚えた song.mix を捨てていない（#compose が同じ別の曲と比べてしまう）",
		);
	if (!/accompPresetSlots\(song\)/.test(runAccomp))
		problems.push("runComposeAccomp が層の定義から枠を引いていない");
	if (!/song\.mix\.drum/.test(runAccomp) || /NO_DRUM_PATTERN/.test(runAccomp))
		problems.push("runComposeAccomp のドラムが曲のミックスでない");
	if (!/recentAccompSignatures\.set\(song\.plan\.style/.test(runAccomp))
		problems.push("直近の計画をスタイル id ごとに持っていない");
	ok(
		"daw.ts: スタイルの表を直接見ず（ACCOMP_MIX・4枠の固定の対応が無い）、作った時点の song.mix を覚えて比べ（MML を読み込んだら捨てる）、層の定義から枠を引き、ドラムは曲のミックス、直近の計画はスタイルごと。歌ものの作曲は composeSetting を書き換える前に解放する",
		problems.length === 0,
		problems,
	);
	const ui = src("daw-ui.ts");
	const named = ACCOMP_STYLES.flatMap((s) =>
		[`"${s.id}"`, `'${s.id}'`, s.label].filter(
			(x) => daw.includes(x) || ui.includes(x),
		),
	);
	ok(
		"DAW と UI のコード（daw.ts・daw-ui.ts）にスタイルの id と表示名が無い（スタイルを足しても DAW と UI のコードは変わらない。§2.4・§7）",
		named.length === 0,
		named,
	);
}

console.log(failed === 0 ? "\nall ok" : `\n${failed} failed`);
if (failed > 0) process.exit(1);
