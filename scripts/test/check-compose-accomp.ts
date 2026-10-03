/**
 * 伴奏主体モード（`composeAccomp`）の検算（`docs/accomp-compose.md` §12.2・§12.3）。
 *
 * 段階1-A の時点で確かめるのは、表と計画器まで。
 * - 依存: `compose-accomp*.ts` が koe・mml-parser・voice/lyrics・daw を実行時に読まないこと
 * - 表の健全性: 和音がすべて `romanToC` と `parseChord` を通る、借用の組が規則③⑤を満たす、
 *   セル・低音型・和音の打ち方の合計が16、音価が使える8種、ミックスが fb の宣言どおり
 * - `romanToC` の検算: fb のローマ数字をホ長調で鳴らすと gen-fb.mjs の和音名と同じ音になる
 * - 陽性対照の計画: `fbPlan()` が手書きの fb の計画（fixture）と一致し、計画の段の前提を全部満たす
 * - 計画器: 種ごとに前提を満たす・決定的・候補番号で作り直せる・区間長の上書きで調/テンポ/借用の組が
 *   変わらない・短調は平行長調を家にする。曲ごとの違い（種類数と分布）を表示する
 * - 切除対照（計画の段）: fb の計画を1点ずつ壊し、狙った関門だけが落ちる
 *
 * 段階1-B で、実現（段4〜段10）を足した。
 * - 陽性対照の実現: fb の計画を realize して、fb.mml の実測（区間ごとの分散の毎秒音数・上半分の平均・
 *   低音の音数・往復率・分散の v・和音の打つ回数）に許容幅で一致する（§12.3）。和音の置き方が fb の
 *   辞書と一致する割合は表示だけ
 * - 和声との整合: 分散・和音・色の線はすべて鳴っている和音の構成音か書かれたテンション。低音の和音外音は
 *   経過音と半音渡しだけで、強拍（1・3拍）にも4分より長い音にも来ない
 * - ぶつかり: 分散と和音トラック・色の線と分散の短2度／短9度が0、全トラックで 0.35/小節以下
 * - 継ぎ目（ループの閉じ方5点）・表現（段10）・正規化・規則①④を音を置いた後で
 * - 種ごと（12平均律・31平均律・いろいろな調）に同じことを確かめる。決定性。31平均律の綴り（A♭≠G#）
 *
 * 段階1-C で、関門（`compose-accomp-check.ts`）・入口（`composeAccomp`・`accompMeta`）・MML の
 * 書き出し（`compose-accomp-mml.ts`）を足した。
 * - 関門: 上の「音を置いた後」の検査は `accompGates`（src）そのものを使う。関門そのものの検算は、
 *   計画の段と音を置いた後の両方の切除対照（1点ずつ壊すと狙った関門だけが落ちる）で行う
 * - 入口: 種ごとに関門を満たす（採った候補を (seed, k) から作り直すと同じトラックになり、関門を通る）・
 *   決定的・`pick` で作り直せる・`recent` を避けても再現できる・上書き（区間長・テンポ・計画）・
 *   保険の計画が全調・全テンポで関門を通る・正規化・ミックス（`accompMeta`）
 * - MML の往復: `parseMML(accompToMml(song))` が、音符と絶対値の v・宣言まで一致する（31平均律・minify も）
 *
 *   npx tsx scripts/test/check-compose-accomp.ts
 */

import Module from "node:module";

// ---- 依存: koe のスタブを入れる前に読む。禁じた読み込みがあれば例外にする ----
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;
// 歌詞は歌唱合成の `src/voice/lyrics.ts` を禁じる。`compose-lyrics.ts`（仮歌詞の文の型）は
// 依存の無い文字列の表なので対象外。
const FORBIDDEN = /(@onjmin\/koe|mml-parser|voice\/lyrics|(^|\/)daw(-ui)?$)/;
const forbiddenHits: string[] = [];
loader._load = (request, ...rest) => {
	if (FORBIDDEN.test(request)) forbiddenHits.push(request);
	return originalLoad(request, ...rest);
};
const plan =
	require("../../src/compose/compose-accomp-plan") as typeof import("../../src/compose/compose-accomp-plan");
const tables =
	require("../../src/compose/compose-accomp-tables") as typeof import("../../src/compose/compose-accomp-tables");
const realize =
	require("../../src/compose/compose-accomp-realize") as typeof import("../../src/compose/compose-accomp-realize");
const gates =
	require("../../src/compose/compose-accomp-check") as typeof import("../../src/compose/compose-accomp-check");
const entry =
	require("../../src/compose/compose-accomp") as typeof import("../../src/compose/compose-accomp");
const styles =
	require("../../src/compose/accomp-styles/index") as typeof import("../../src/compose/accomp-styles/index");
// ---- ここから先は mml-parser（→ lyrics → koe）を読む。koe はブラウザ専用なので空のスタブへ ----
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: originalLoad(request, ...rest);
const { parseMML } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");
const { accompToMml } =
	require("../../src/compose/compose-accomp-mml") as typeof import("../../src/compose/compose-accomp-mml");
const { masterFxToMeta } =
	require("../../src/audio/master-fx") as typeof import("../../src/audio/master-fx");
const { DTM_VERSION } =
	require("../../src/version") as typeof import("../../src/version");

const { parseChord, parseChords } =
	require("@onjmin/chord-parser") as typeof import("@onjmin/chord-parser");
const { seededRandom } =
	require("../../src/compose/compose") as typeof import("../../src/compose/compose");
const { COMPOSE_KEYS } =
	require("../../src/compose/compose-keys") as typeof import("../../src/compose/compose-keys");
const {
	FB_PLAN,
	FB_CHORD_NAMES,
	FB_METRICS,
	FB_V_KINDS,
	FB_CLASHES_PER_BAR,
	FB_COLOR_LINE,
	FB_VOICINGS,
} =
	require("./fixtures/accomp-fb-plan") as typeof import("./fixtures/accomp-fb-plan");
const { spelledToUnits } =
	require("../../src/chord/chords") as typeof import("../../src/chord/chords");
const { effectiveVelocity } =
	require("../../src/mml/mml-velocity") as typeof import("../../src/mml/mml-velocity");

type AccompPlan = import("../../src/compose/compose-accomp").AccompPlan;
type AccompRole = import("../../src/compose/compose-accomp").AccompRole;
type AccompRegion = import("../../src/compose/compose-accomp").AccompRegion;
type AccompGate = import("../../src/compose/compose-accomp").AccompGate;
type AccompArpCell = import("../../src/compose/compose-accomp-tables").AccompArpCell;

const {
	analyzeRoman,
	barChords,
	candidateStreams,
	drawSeed,
	echoBars,
	fbPlan,
	foreshadowBars,
	planAccomp,
	planBars,
	planChordProgression,
	planSeconds,
	planSignature,
	planViolations,
	resolveAccompKey,
	romanToC,
	splitBars,
} = plan;
const {
	ACCOMP_ITINERARY,
	ACCOMP_MIX,
	ARP_CELLS,
	BASS_PATTERNS,
	BORROW_PAIRS,
	BPM_TABLE,
	CANDIDATE_LIMIT,
	CELL_NOTES,
	COLOR_LINE,
	COMP_HITS,
	COMP_TONES,
	FB_LENGTHS,
	HOME_MID,
	HOME_OPEN,
	LEVELS,
	LIFT,
	MINOR_CLIMB,
	MINOR_MID,
	MINOR_OPEN,
	NOTE_LENGTHS_16,
	REGION_LENGTHS,
	RETURN_END,
	ROLE_TEXTURE,
	SECONDS_RANGE,
	SUPPORTED_LENGTHS,
} = tables;

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
/**
 * 実現の段が記録した打ち方（`regions[].compHits`、PlanPins）を消した計画。曲の計画（記録を埋めたもの）を、
 * 計画器が作ったままの計画と比べるため。欄の並びは変えない。
 */
const withoutCompHits = (p: AccompPlan): AccompPlan => ({
	...p,
	regions: p.regions.map(({ compHits: _c, ...r }) => r),
});
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mod12 = (n: number): number => ((n % 12) + 12) % 12;

// ============================================================
section("依存");
ok(
	"compose-accomp・-tables・-plan・-realize・-check・accomp-styles は koe・mml-parser・voice/lyrics・daw を読まない",
	forbiddenHits.length === 0,
	forbiddenHits,
);

// ============================================================
section("表の健全性: 和声");
{
	const rowTables: [string, readonly { id: string; bars: string }[]][] = [
		["HOME_OPEN", HOME_OPEN],
		["HOME_MID", HOME_MID],
		["MINOR_OPEN", MINOR_OPEN],
		["MINOR_MID", MINOR_MID],
		["MINOR_CLIMB", MINOR_CLIMB],
		["LIFT", LIFT],
		["RETURN_END", RETURN_END],
	];
	const allChords = new Set<string>();
	for (const [name, rows] of rowTables) {
		const ids = new Set(rows.map((r) => r.id));
		ok(`${name}: id が重複しない`, ids.size === rows.length);
		for (const r of rows) {
			const bars = splitBars(r.bars);
			ok(`${name}.${r.id}: 4小節`, bars.length === 4, r.bars);
			for (const b of bars) for (const c of b.split(/\s+/)) allChords.add(c);
		}
	}
	for (const p of BORROW_PAIRS) {
		for (const k of ["fore", "a8", "a12", "b8", "b12"] as const)
			for (const b of splitBars(p[k]))
				for (const c of b.split(/\s+/)) allChords.add(c);
		allChords.add(p.glimpseEnd);
	}
	const bad: string[] = [];
	for (const roman of allChords) {
		try {
			const c = analyzeRoman(roman);
			// 分数和音は名前のまま（DAW の和音欄と同じ形）でも読めること
			parseChord(c.name);
			if (c.tones.length < 3) bad.push(`${roman}: 構成音が ${c.tones.length}`);
		} catch (e) {
			bad.push(`${roman}: ${(e as Error).message}`);
		}
	}
	ok(
		`表の和音 ${allChords.size} 種がすべて romanToC と parseChord を通る`,
		bad.length === 0,
		bad,
	);

	// 借用の判定（§6 段2-9）
	const expectBorrowed: Record<string, boolean> = {
		bVIM7: true,
		"bVIM7(#11)": true,
		bVIIadd9: true,
		bVII: true,
		bIIIM7: true,
		iv7: true,
		i7: true,
		iv6: true,
		"IVM7(#11)": false,
		"vi(add9)": false,
		Iadd9: false,
		"IM7/3": false,
		Vsus4: false,
	};
	ok(
		"借用の判定（IVM7(#11) の #11 は音階内なので数えない）",
		Object.entries(expectBorrowed).every(
			([r, b]) => analyzeRoman(r).borrowed === b,
		),
		Object.entries(expectBorrowed)
			.filter(([r, b]) => analyzeRoman(r).borrowed !== b)
			.map(([r]) => r),
	);
	ok(
		"romanToC の例",
		romanToC("Iadd9") === "Cadd9" &&
			romanToC("vi(add9)") === "Am(add9)" &&
			romanToC("bVIM7(#11)") === "AbM7(#11)" &&
			romanToC("iv6") === "Fm6" &&
			romanToC("IM7/3") === "CM7/E" &&
			romanToC("vi7/5") === "Am7/G" &&
			romanToC("bVIIadd9") === "Bbadd9",
	);
	ok(
		"借用和音はフラットで綴る（bVI の根音は五度圏 −4 ＝ A♭）",
		analyzeRoman("bVIM7").root.fifth === -4 &&
			analyzeRoman("bIIIM7").root.fifth === -3 &&
			analyzeRoman("bVIIadd9").root.fifth === -2,
	);
	ok(
		"分数和音の低音（IM7/3 は E、vi7/5 は G）",
		analyzeRoman("IM7/3").bass.pc === 4 && analyzeRoman("vi7/5").bass.pc === 7,
	);
	ok(
		"置き方の度数の組（COMP_TONES のキー）",
		analyzeRoman("IVM7").voicing === "seventh" &&
			analyzeRoman("Iadd9").voicing === "add9" &&
			analyzeRoman("V").voicing === "triad" &&
			analyzeRoman("Vsus4").voicing === "triad" &&
			analyzeRoman("iv6").voicing === "m6" &&
			analyzeRoman("bVIM7(#11)").voicing === "maj7s11" &&
			analyzeRoman("IVM7(9)").voicing === "maj7add9" &&
			[...allChords].every((r) => analyzeRoman(r).voicing in COMP_TONES),
	);
}

section("表の健全性: 借用の組（規則③⑤）");
{
	// 規則③の判定（plan の rule3Violations と同じ式を、区間の並びへ組む前の表に当てる）
	const violates = (a: string, b: string): boolean => {
		const x = analyzeRoman(a);
		const y = analyzeRoman(b);
		return (
			x.borrowed &&
			x.third === "major" &&
			y.borrowed &&
			mod12(y.root.pc - x.root.pc) === 5
		);
	};
	const flat = (text: string): string[] =>
		splitBars(text).flatMap((b) => b.split(/\s+/));
	for (const p of BORROW_PAIRS) {
		ok(
			`${p.id}: 予告は4小節で Vsus4 V で終わる`,
			(() => {
				const bars = splitBars(p.fore);
				return bars.length === 4 && bars[3] === "Vsus4 V";
			})(),
		);
		ok(
			`${p.id}: 8小節版と12小節版の長さ、12小節版は8小節版の後ろに4小節を足した形`,
			splitBars(p.a8).length === 8 &&
				splitBars(p.b8).length === 8 &&
				splitBars(p.a12).length === 12 &&
				splitBars(p.b12).length === 12 &&
				p.a12.startsWith(`${p.a8}|`) &&
				p.b12.startsWith(`${p.b8}|`) &&
				splitBars(p.a12)[11] === splitBars(p.a8)[7] &&
				splitBars(p.b12)[11] === splitBars(p.b8)[7],
		);
		for (const [aKey, bKey] of [
			["a8", "b8"],
			["a12", "b12"],
		] as const) {
			// borrowA → glimpse（home の頭 Iadd9 …）→ glimpseEnd → borrowB → lift（IM7 か vi7）
			const seq = [
				...flat(p[aKey]),
				"Iadd9",
				p.glimpseEnd,
				...flat(p[bKey]),
				"IM7",
			];
			const hits = seq
				.slice(1)
				.flatMap((c, i) => (violates(seq[i], c) ? [`${seq[i]}→${c}`] : []));
			ok(`${p.id} (${aKey}/${bKey}): 規則③`, hits.length === 0, hits);
		}
		const glimpseEnd = analyzeRoman(p.glimpseEnd);
		const bHead = analyzeRoman(flat(p.b8)[0]);
		ok(
			`${p.id}: glimpseEnd（${p.glimpseEnd}）から borrowB の頭（${bHead.roman}）へ低音が半音で上がる`,
			mod12(bHead.root.pc - glimpseEnd.bass.pc) === 1 && !glimpseEnd.borrowed,
		);
		const expanded = new Set(
			[...flat(p.a8), ...flat(p.b8)]
				.map(analyzeRoman)
				.filter((c) => c.borrowed)
				.map((c) => `${c.root.fifth}:${c.third}`),
		);
		const fore = flat(p.fore)
			.map(analyzeRoman)
			.filter((c) => c.borrowed);
		ok(
			`${p.id}: 規則⑤ 予告の借用和音 ⊆ borrowA ∪ borrowB`,
			fore.length > 0 &&
				fore.every((c) => expanded.has(`${c.root.fifth}:${c.third}`)),
		);
	}
	const p1ForeHits = (() => {
		const f = splitBars(BORROW_PAIRS[0].fore).flatMap((b) => b.split(/\s+/));
		return f
			.slice(1)
			.flatMap((c, i) => (violates(f[i], c) ? [`${f[i]}→${c}`] : []));
	})();
	console.log(
		`  info P1 の予告の句の中の③相当（home の中なので数えない）: ${p1ForeHits.join(", ") || "なし"}`,
	);
}

section("表の健全性: セル・低音型・打ち方・強弱・ミックス");
{
	const lens16 = new Set(NOTE_LENGTHS_16);
	const cellProblems: string[] = [];
	for (const [key, c] of Object.entries(ARP_CELLS)) {
		if (c.id !== key) cellProblems.push(`${key}: id ${c.id}`);
		if (sum(c.steps.map((s) => s[1])) !== 16)
			cellProblems.push(`${key}: 合計 ${sum(c.steps.map((s) => s[1]))}`);
		if (c.steps.some(([i]) => !Number.isInteger(i) || i < 0 || i > 4))
			cellProblems.push(`${key}: 番号が 0〜4 の外`);
		if (c.steps.some(([, l]) => !lens16.has(l)))
			cellProblems.push(`${key}: 使えない音価`);
		if (
			c.notes !== c.steps.length ||
			c.notes < CELL_NOTES.min ||
			c.notes > CELL_NOTES.max
		)
			cellProblems.push(`${key}: 1小節 ${c.notes} 音`);
		// 半小節（8）の境をまたぐ音が無い（2和音の小節で、後半の組へ切り替える位置）
		let pos = 0;
		for (const [, l] of c.steps) {
			if (pos < 8 && pos + l > 8) cellProblems.push(`${key}: 8をまたぐ`);
			pos += l;
		}
		if (c.liftVariant) {
			const v = ARP_CELLS[c.liftVariant];
			if (!v) cellProblems.push(`${key}: liftVariant ${c.liftVariant} が無い`);
			else if (
				v.steps.map((s) => s[1]).join() !== c.steps.map((s) => s[1]).join()
			)
				cellProblems.push(`${key}: liftVariant のリズムが違う`);
		}
	}
	ok(
		`セル ${Object.keys(ARP_CELLS).length} 種: 合計16・番号0〜4・1小節8〜10音・8種の音価・変形のリズムが同じ`,
		cellProblems.length === 0,
		cellProblems,
	);

	const textureProblems: string[] = [];
	for (const role of ACCOMP_ITINERARY) {
		const t = ROLE_TEXTURE[role];
		const cells: string[] = [];
		if (t.cells.kind === "pool") {
			cells.push(...t.cells.pool.map(([id]) => id));
			if (t.cells.last) cells.push(t.cells.last);
			if (t.cells.pool.length < 2)
				textureProblems.push(
					`${role}: 候補が2つ未満（同じセルを続けられない）`,
				);
		}
		if (t.cells.kind === "alternate") cells.push(...t.cells.cells);
		for (const id of cells)
			if (!ARP_CELLS[id]) textureProblems.push(`${role}: セル ${id} が無い`);
		if (role === "home" && t.cells.kind === "pool")
			for (const [id] of t.cells.pool)
				if (!ARP_CELLS[id]?.liftVariant)
					textureProblems.push(`home のセル ${id} に liftVariant が無い`);
		const bassIds =
			t.bass.kind === "each"
				? [t.bass.id, ...(t.bass.last ? [t.bass.last] : [])]
				: t.bass.kind === "lead"
					? [t.bass.first, t.bass.rest]
					: [t.bass.first, t.bass.second, ...t.bass.middle.map(([id]) => id)];
		for (const id of bassIds)
			if (!BASS_PATTERNS[id])
				textureProblems.push(`${role}: 低音型 ${id} が無い`);
		if (!COMP_HITS[t.comp])
			textureProblems.push(`${role}: 打ち方 ${t.comp} が無い`);
	}
	ok(
		"ROLE_TEXTURE の参照先がすべてある",
		textureProblems.length === 0,
		textureProblems,
	);

	const bassProblems: string[] = [];
	for (const [key, b] of Object.entries(BASS_PATTERNS)) {
		if (b.id !== key) bassProblems.push(`${key}: id`);
		for (const bar of b.bars) {
			if (sum(bar.map((s) => s[1])) !== 16)
				bassProblems.push(`${key}: 合計 ${sum(bar.map((s) => s[1]))}`);
			if (bar.some(([t, l]) => t !== "r" && !lens16.has(l)))
				bassProblems.push(`${key}: 使えない音価`);
		}
		if (b.bars.length > 1 !== (b.alternate !== undefined))
			bassProblems.push(`${key}: 形の数と alternate が合わない`);
		if (b.split && !BASS_PATTERNS[b.split])
			bassProblems.push(`${key}: split ${b.split} が無い`);
		if (b.last && !BASS_PATTERNS[b.last])
			bassProblems.push(`${key}: last ${b.last} が無い`);
		// N（次の根音へ寄せる構成音）は区間の最終小節の型でしか意味を持たない
		const isLast = Object.values(BASS_PATTERNS).some((x) => x.last === key);
		if (!isLast && b.bars.some((bar) => bar.some(([t]) => t === "N")))
			bassProblems.push(`${key}: 区間の最終小節の型でないのに N を使う`);
	}
	ok(
		"低音型: 合計16・8種の音価・交互の規則・split と last の参照先",
		bassProblems.length === 0,
		bassProblems,
	);

	const hitProblems: string[] = [];
	for (const [key, h] of Object.entries(COMP_HITS))
		for (const bar of [...h.one, ...h.two, ...(h.late ?? [])]) {
			if (sum(bar.map((s) => s[1])) !== 16)
				hitProblems.push(`${key}: 合計 ${sum(bar.map((s) => s[1]))}`);
			// 休符の長さは MMLCore が隙間から作るので、使える音価の制約は発音にだけ掛かる
			if (bar.some(([c, l]) => c !== -1 && !lens16.has(l)))
				hitProblems.push(`${key}: 使えない音価`);
		}
	for (const [key, h] of Object.entries(COMP_HITS))
		if (h.one.some((bar) => bar.some(([c]) => c === 1)))
			hitProblems.push(`${key}: 1和音の形に2つめの和音がある`);
	ok("和音の打ち方: 合計16・8種の音価", hitProblems.length === 0, hitProblems);

	ok(
		"強弱のキーフレームは fb の区間長と同じ長さで 1〜127",
		ACCOMP_ITINERARY.every(
			(r) =>
				LEVELS[r].arp.length === FB_LENGTHS[r] &&
				LEVELS[r].arp.every((v) => v >= 1 && v <= 127),
		),
	);
	ok(
		"区間長の候補はすべて4の倍数で、和声の表で組める長さ",
		ACCOMP_ITINERARY.every((r) =>
			REGION_LENGTHS[r].every(
				([n, w]) => n % 4 === 0 && w > 0 && SUPPORTED_LENGTHS[r].includes(n),
			),
		),
	);
	ok(
		"テンポの候補は 110〜116",
		BPM_TABLE.every(([b, w]) => b >= 110 && b <= 116 && w > 0),
	);
	ok(
		"色の線の度数は COMP_TONES と同じ記号",
		Object.values(COLOR_LINE.tones).every((ds) =>
			ds.every((d) => ["3", "5", "7"].includes(d)),
		),
	);
	const m = ACCOMP_MIX;
	ok(
		"ミックス: fb.space.mml の宣言どおり（drum=none・loop・reverb 50/3.0s/25ms・delay 25/8d・comp/fade 0）",
		m.instrument === "retro_game" &&
			m.volume === 80 &&
			m.drum === "none" &&
			m.loop === true &&
			m.masterFx.reverbAmount === 50 &&
			m.masterFx.reverbDecaySec === 3 &&
			m.masterFx.reverbPreDelayMs === 25 &&
			m.masterFx.delayAmount === 25 &&
			m.masterFx.delayDivision === "8d" &&
			m.masterCompression === 0 &&
			m.fadeIn === 0 &&
			m.fadeOut === 0,
	);
	ok(
		"ミックス: トラックの楽器・EQ・パン・送り",
		JSON.stringify(m.trackInstruments) ===
			JSON.stringify({
				0: "Lead 1 (square)",
				1: "Lead 1 (square)",
				2: "Synth Bass 1",
				3: "Electric Piano 2",
			}) &&
			JSON.stringify(m.trackEqHigh) ===
				JSON.stringify({ 1: -9, 2: -6, 3: -3 }) &&
			JSON.stringify(m.trackPan) === JSON.stringify({ 1: 50, 3: 80 }) &&
			JSON.stringify(m.trackReverbSend) ===
				JSON.stringify({ 0: 45, 1: 55, 2: 10, 3: 65 }) &&
			JSON.stringify(m.trackDelaySend) === JSON.stringify({ 0: 30, 1: 15 }),
	);
}

// ============================================================
section("romanToC の検算: fb をホ長調で鳴らした音");
{
	const fbRomans = FB_PLAN.regions.flatMap((r) => r.chords);
	ok(
		"fixture の小節数 76",
		fbRomans.length === 76 && FB_CHORD_NAMES.length === 76,
	);
	const mismatch: string[] = [];
	fbRomans.forEach((bar, i) => {
		const romans = bar.split(/\s+/);
		const names = FB_CHORD_NAMES[i].split(/\s+/);
		if (romans.length !== names.length) {
			mismatch.push(`${i + 1}: ${bar} / ${FB_CHORD_NAMES[i]}`);
			return;
		}
		romans.forEach((r, k) => {
			const c = analyzeRoman(r);
			const e = parseChord(names[k]);
			const shifted = c.tones.map((t) => mod12(t.pc + 4)).sort((a, b) => a - b);
			const expect = [...e.pitchClasses].sort((a, b) => a - b);
			const bassE = names[k].includes("/")
				? parseChord(names[k]).notes[0]
				: e.root;
			if (
				JSON.stringify([...new Set(shifted)]) !== JSON.stringify(expect) ||
				mod12(c.root.pc + 4) !== e.root ||
				mod12(c.bass.pc + 4) !== mod12(bassE)
			)
				mismatch.push(`${i + 1}: ${r}（${c.name}）≠ ${names[k]}`);
		});
	});
	ok(
		"76小節の和音が、ローマ数字 → ハ長調 → +4 で gen-fb.mjs の和音名と同じ音・根音・低音",
		mismatch.length === 0,
		mismatch,
	);
}

// ============================================================
section("陽性対照の計画（fbPlan = 保険の計画）");
const fb = fbPlan();
{
	ok(
		"fbPlan() が手書きの fb の計画（fixture）と一致する（fixture の打ち方の記録 compHits のほか。記録は下の「計画の記録」で見る）",
		JSON.stringify(fb) === JSON.stringify(withoutCompHits(FB_PLAN)),
		(() => {
			const diff: string[] = [];
			fb.regions.forEach((r, i) => {
				const f = FB_PLAN.regions[i];
				for (const k of Object.keys(r) as (keyof AccompRegion)[])
					if (JSON.stringify(r[k]) !== JSON.stringify(f?.[k]))
						diff.push(`${r.role}.${k}`);
			});
			return diff;
		})(),
	);
	const v = planViolations(fb);
	ok("fb の計画は計画の段の前提を全部満たす", v.length === 0, v);
	ok(
		"fb: 76小節・約163秒",
		planBars(fb).length === 76 && Math.abs(planSeconds(fb) - 162.857) < 0.01,
	);
	ok(
		"fb: 予告の小節は13〜15小節目（0始まりで 12〜14）",
		JSON.stringify(foreshadowBars(fb)) === "[12,13,14]",
	);
	ok(
		"fb: return の頭10小節は home と同じ音（A' 65〜74 = A 1〜10）",
		echoBars(fb) === 10,
	);
	const prog = planChordProgression(fb);
	const events = parseChords(prog, fb.bpm);
	ok(
		"fb: 和音欄の進行（ハ長調）が parseChords で読め、和音の数が合う",
		prog.split("|").length === 76 &&
			events.length ===
				fb.regions
					.flatMap((r) => r.chords)
					.join(" ")
					.split(/\s+/).length,
		{ bars: prog.split("|").length, events: events.length },
	);
	ok(
		"fbPlan は調とテンポを差し替えられる（ホ長調以外の保険の計画）",
		(() => {
			const g = fbPlan(-5, 116);
			return (
				g.rootShift === -5 &&
				g.bpm === 116 &&
				JSON.stringify(g.regions) === JSON.stringify(fb.regions)
			);
		})(),
	);
	ok(
		"保険の計画は表のどのテンポ（110〜116）・どの調でも計画の段の前提を満たす",
		BPM_TABLE.every(([bpm]) =>
			[-5, -1, 0, 4, 6].every(
				(rs) => planViolations(fbPlan(rs, bpm)).length === 0,
			),
		),
	);
}

// ============================================================
section("計画器");
type Drawn = { key: ReturnType<typeof resolveAccompKey>; plan: AccompPlan };
/** composeAccomp と同じ乱数の引き方で、候補 k の計画を作る（段4以降は後の段）。 */
const drawPlan = (
	seed: number,
	baseKey: string,
	k = 0,
	lengths?: Partial<Record<AccompRole, number>>,
): Drawn => {
	const random = seededRandom(seed);
	const key = resolveAccompKey(baseKey, seededRandom(drawSeed(random)));
	for (let i = 0; i < k; i++) candidateStreams(random);
	const streams = candidateStreams(random);
	return {
		key,
		plan: planAccomp({
			bpm: key.bpm,
			rootShift: key.rootShift,
			streams,
			lengths,
		}),
	};
};

{
	const SEEDS12 = Array.from({ length: 40 }, (_, i) => 20260929 + i);
	const cases: { seed: number; baseKey: string }[] = [
		...SEEDS12.map((seed) => ({ seed, baseKey: "major" })),
		...[0, 1, 2, 3, 4].map((i) => ({ seed: 20261100 + i, baseKey: "key_E" })),
		...[0, 1, 2, 3, 4].map((i) => ({ seed: 20261200 + i, baseKey: "minor" })),
		...[0, 1, 2].map((i) => ({ seed: 20261300 + i, baseKey: "key_Em" })),
		...[0, 1, 2].map((i) => ({ seed: 20261400 + i, baseKey: "mood_dark" })),
		...[0, 1, 2].map((i) => ({ seed: 20261500 + i, baseKey: "mood_happy" })),
		...[0, 1].map((i) => ({ seed: 20261600 + i, baseKey: "any" })),
	];
	const failures: string[] = [];
	for (const { seed, baseKey } of cases) {
		const { plan: p } = drawPlan(seed, baseKey);
		const v = planViolations(p);
		if (v.length) failures.push(`${baseKey} ${seed}: ${JSON.stringify(v)}`);
	}
	ok(
		`${cases.length} 曲（major 40・key_E・minor・key_Em・mood_*・any）の計画が前提を全部満たす`,
		failures.length === 0,
		failures.slice(0, 5),
	);

	// 候補 0〜23 まで、どの候補も計画の段では壊れていない（関門で落ちるのは実現の後）
	const candFailures: string[] = [];
	for (const seed of SEEDS12.slice(0, 5))
		for (let k = 0; k < CANDIDATE_LIMIT; k++) {
			const v = planViolations(drawPlan(seed, "major", k).plan);
			if (v.length)
				candFailures.push(`${seed} k=${k}: ${v[0].gate} ${v[0].detail}`);
		}
	ok(
		`候補 0〜${CANDIDATE_LIMIT - 1}（5種）も計画の段の前提を満たす`,
		candFailures.length === 0,
		candFailures.slice(0, 5),
	);

	// 決定性
	const a = drawPlan(20260929, "major");
	const b = drawPlan(20260929, "major");
	ok(
		"同じ種で同じ計画（JSON が完全一致）",
		JSON.stringify(a) === JSON.stringify(b),
	);

	// 候補番号で作り直せる（呼び出しの乱数を 6·k 個読み飛ばす）
	{
		const random = seededRandom(20260930);
		const key = resolveAccompKey("major", seededRandom(drawSeed(random)));
		const seq: AccompPlan[] = [];
		for (let k = 0; k < 4; k++)
			seq.push(
				planAccomp({
					bpm: key.bpm,
					rootShift: key.rootShift,
					streams: candidateStreams(random),
				}),
			);
		const direct = drawPlan(20260930, "major", 3).plan;
		ok(
			"候補 3 を直接作っても、順に作った4つめと一致する（pick）",
			JSON.stringify(direct) === JSON.stringify(seq[3]),
		);
		const r2 = seededRandom(1);
		const before = r2();
		const r3 = seededRandom(1);
		candidateStreams(r3);
		ok(
			"candidateStreams は呼び出しの乱数をちょうど6個使う",
			(() => {
				const r4 = seededRandom(1);
				for (let i = 0; i < 6; i++) r4();
				return r3() === r4() && before === seededRandom(1)();
			})(),
		);
	}

	// 区間長の上書きで、調・テンポ・借用の組・質感以外の段は変わらない
	{
		const base = drawPlan(20260931, "major");
		const over = drawPlan(20260931, "major", 0, { minorDwell: 24 });
		ok(
			"overrides.lengths を変えても、調・テンポ・借用の組は変わらない",
			over.plan.rootShift === base.plan.rootShift &&
				over.plan.bpm === base.plan.bpm &&
				over.plan.borrowPair === base.plan.borrowPair &&
				over.plan.regions.find((r) => r.role === "minorDwell")?.bars === 24,
			{
				base: [base.plan.bpm, base.plan.borrowPair],
				over: [over.plan.bpm, over.plan.borrowPair],
			},
		);
		let threw = false;
		try {
			drawPlan(20260931, "major", 0, { home: 12 });
		} catch {
			threw = true;
		}
		ok("組めない区間長の上書き（home 12）は例外", threw);
	}

	// 短調は平行長調を家にする
	{
		const em = drawPlan(20261300, "key_Em");
		ok(
			"ホ短調を選ぶと、ト長調（rootShift −5）を家にして注記が付く",
			em.key.rootShift === -5 &&
				em.key.keyName === COMPOSE_KEYS.key_G.name &&
				em.plan.rootShift === -5 &&
				(em.key.homeFromMinor ?? "").includes("ト長調"),
			em.key,
		);
		const e = drawPlan(20261100, "key_E");
		ok(
			"ホ長調はそのまま（rootShift 4、注記なし）",
			e.key.rootShift === 4 && e.key.homeFromMinor === undefined,
		);
		const any = drawPlan(20261600, "any");
		const major = drawPlan(20261600, "major");
		ok(
			'"any" は "major" と同じ',
			JSON.stringify(any.plan) === JSON.stringify(major.plan),
		);
		ok(
			"テンポは表の候補（110〜116）",
			cases.every(({ seed, baseKey }) =>
				BPM_TABLE.some(([bpm]) => bpm === drawPlan(seed, baseKey).plan.bpm),
			),
		);
	}

	// 曲ごとの違い（下限だけ assert。分布は表示）
	{
		const plans = SEEDS12.map((seed) => drawPlan(seed, "major").plan);
		const sigs = new Set(plans.map(planSignature));
		const count = (f: (p: AccompPlan) => string): string => {
			const m = new Map<string, number>();
			for (const p of plans) m.set(f(p), (m.get(f(p)) ?? 0) + 1);
			return [...m]
				.sort((x, y) => y[1] - x[1])
				.map(([k, n]) => `${k}×${n}`)
				.join("  ");
		};
		console.log(`  info planSignature の種類数 ${sigs.size}/${plans.length}`);
		console.log(
			`  info 区間長 ${count((p) => p.regions.map((r) => r.bars).join(","))}`,
		);
		console.log(`  info 借用の組 ${count((p) => p.borrowPair)}`);
		console.log(`  info テンポ ${count((p) => String(p.bpm))}`);
		const cellUse = new Map<string, number>();
		for (const p of plans)
			for (const r of p.regions)
				for (const id of r.texture.arpCells)
					cellUse.set(id, (cellUse.get(id) ?? 0) + 1);
		console.log(
			`  info セルの使用ブロック数 ${[...cellUse]
				.sort((x, y) => y[1] - x[1])
				.map(([k, n]) => `${k}×${n}`)
				.join("  ")}`,
		);
		ok(
			"表のセルは（fa の候補も含めて）どれも1回以上使われる",
			Object.keys(ARP_CELLS).every((id) => cellUse.has(id)),
			Object.keys(ARP_CELLS).filter((id) => !cellUse.has(id)),
		);
		console.log(
			`  info 秒数 ${Math.min(...plans.map(planSeconds)).toFixed(0)}〜${Math.max(...plans.map(planSeconds)).toFixed(0)}`,
		);
		ok("40曲の planSignature が 30 種以上", sigs.size >= 30, sigs.size);
		ok(
			"借用の組が両方とも出る",
			new Set(plans.map((p) => p.borrowPair)).size === BORROW_PAIRS.length,
		);
		ok(
			"長さが 150〜180 秒",
			plans.every((p) => {
				const s = planSeconds(p);
				return s >= SECONDS_RANGE.min && s <= SECONDS_RANGE.max;
			}),
		);
	}
}

// ============================================================
section("切除対照（計画の段）: 1点ずつ壊すと、狙った関門だけが落ちる");
{
	const gatesOf = (
		p: AccompPlan,
		cells?: Readonly<Record<string, AccompArpCell>>,
	): AccompGate[] => [
		...new Set(planViolations(p, cells ? { cells } : {}).map((v) => v.gate)),
	];
	const region = (p: AccompPlan, role: AccompRole): AccompRegion => {
		const r = p.regions.find((x) => x.role === role);
		if (!r) throw new Error(role);
		return r;
	};
	const expectOnly = (
		label: string,
		p: AccompPlan,
		gate: AccompGate,
		cells?: Readonly<Record<string, AccompArpCell>>,
	): void => {
		const g = gatesOf(p, cells);
		ok(`${label} → ${gate} だけ`, g.length === 1 && g[0] === gate, g);
	};

	// 強弱を壊すと、規則②の return と home の組も落ちる。この組は「同じ和声で質感を変える」組で、
	// 強弱（return が静か）を軸の1つに数える（§6 段3）ので、そこが消えるのは設計どおり
	const expectGates = (
		label: string,
		p: AccompPlan,
		gates: AccompGate[],
	): void => {
		const g = gatesOf(p).sort();
		ok(
			`${label} → ${gates.join("・")} だけ`,
			JSON.stringify(g) === JSON.stringify([...gates].sort()),
			g,
		);
	};
	{
		const p = clone(fb);
		for (const r of p.regions) r.arpLevel = r.arpLevel.map(() => 60);
		expectGates("強弱を平らにする", p, ["rule4", "rule2"]);
	}
	{
		const p = clone(fb);
		const r = region(p, "return");
		r.arpLevel = r.arpLevel.map((v) => v + 30);
		expectGates("山を return に移す", p, ["rule4", "rule2"]);
	}
	{
		// return を home より静かなまま、山だけ lift へ移す（②は残る）
		const p = clone(fb);
		const r = region(p, "lift");
		r.arpLevel = r.arpLevel.map((v) => v + 40);
		expectOnly("山を lift に移す", p, "rule4");
	}
	{
		// glimpse の和声を borrowA の続きにして、借用区間を隣接させる（旅程は変えない）
		const p = clone(fb);
		region(p, "glimpse").chords = region(p, "borrowA").chords.slice(4);
		expectOnly("glimpse を借用区間にして借用区間を隣接させる", p, "rule3");
	}
	{
		// glimpse を抜く（旅程も壊れるが、③も落ちること）
		const p = clone(fb);
		p.regions = p.regions.filter((r) => r.role !== "glimpse");
		let start = 0;
		for (const r of p.regions) {
			r.startBar = start;
			start += r.bars;
		}
		const g = gatesOf(p);
		ok("glimpse を抜く → rule3 も落ちる", g.includes("rule3"), g);
	}
	{
		const p = clone(fb);
		const g = region(p, "glimpse");
		g.chords[g.chords.length - 1] = "bVII";
		expectOnly("borrowB の頭の ♭III を ♭VII の直後にする", p, "rule3");
	}
	{
		const p = clone(fb);
		const r = region(p, "return");
		const p2Fore = splitBars(BORROW_PAIRS[1].fore);
		r.chords = [...r.chords.slice(0, 8), ...p2Fore];
		expectOnly("return に予告の句を入れる", p, "rule5");
	}
	{
		const p = clone(fb);
		const md = region(p, "minorDwell");
		const ba = region(p, "borrowA");
		ba.texture = {
			...clone(md.texture),
			arpCells: [md.texture.arpCells[md.texture.arpCells.length - 1], "desc_b"],
			bass: [md.texture.bass[md.texture.bass.length - 1], "332"],
		};
		expectOnly(
			"隣り合う区間（minorDwell→borrowA）の質感をそろえる",
			p,
			"rule2",
		);
	}
	{
		const p = clone(fb);
		const r = region(p, "return");
		r.chords[r.chords.length - 1] = "Iadd9";
		expectOnly("最後を I で終える", p, "seam");
	}
	{
		const p = clone(fb);
		const cells: Record<string, AccompArpCell> = {
			...ARP_CELLS,
			four_a: {
				id: "four_a",
				family: "4音",
				dir: "wave",
				steps: [
					[0, 4],
					[2, 4],
					[1, 4],
					[3, 4],
				],
				notes: 4,
				source: "切除対照",
			},
			four_b: {
				id: "four_b",
				family: "4音",
				dir: "wave",
				steps: [
					[0, 4],
					[3, 4],
					[2, 4],
					[4, 4],
				],
				notes: 4,
				source: "切除対照",
			},
		};
		const home = region(p, "home");
		home.texture.arpCells = ["four_a", "four_b", "four_a", "four_b"];
		expectOnly("分散を1小節4音のセルにする", p, "rule1", cells);
	}
}

// ============================================================
section("計画の読み出し");
{
	const bars = planBars(fb);
	ok(
		"planBars: 小節番号が 0〜75 で連続し、和音は1つか2つ",
		bars.every(
			(b, i) => b.bar === i && b.chords.length >= 1 && b.chords.length <= 2,
		),
	);
	ok(
		"barChords: 半小節2和音は空白区切り",
		barChords("iii7 vi7")
			.map((c) => c.name)
			.join(" ") === "Em7 Am7",
	);
	ok(
		"planSignature に bpm・区間長・借用の組・セル・低音型が入る",
		(() => {
			const s = planSignature(fb);
			return (
				s.startsWith("112|16,20,8,4,8,8,12|P1|") &&
				s.includes("ret_a+leap_a+ret_b+fore_up") &&
				s.includes("pulse8+pulse8")
			);
		})(),
	);
}

// ============================================================
// 実現（段4〜段10）
// ============================================================
type Realized = import("../../src/compose/compose-accomp-realize").AccompRealized;
type RNote = import("../../src/compose/compose-accomp-realize").AccompRealizedNote;
const { realizeAccomp, accompTracksFromNotes, ACCOMP_SLOTS } = realize;
const {
	accompGates,
	accompRegionMetrics,
	accompClashPairs,
	ACCOMP_GATE_ORDER,
} = gates;
const { composeAccomp, accompMeta } = entry;
const { CLASH_PER_BAR_MAX } = tables;

const startOf = (n: RNote): number => n.bar * 16 + n.pos16;
const mean = (xs: readonly number[]): number =>
	xs.length === 0 ? 0 : sum(xs) / xs.length;

/** 区間ごとの指標（§7.3。src の `accompRegionMetrics`）。表示と陽性対照だけに使う。 */
const regionMetrics = accompRegionMetrics;
/** 別トラックとの半音のぶつかり（src の `accompClashPairs`）。 */
const clashPairs = accompClashPairs;

/** 関門（src の `accompGates`）を1行ずつの文字列にする。空なら壊れていない。 */
const realizedProblems = (p: AccompPlan, r: Realized): string[] =>
	accompGates(p, r).map((v) => `${v.gate}: ${v.detail}`);

section("陽性対照の実現（fb の計画を realize する）");
{
	const r = realizeAccomp({ plan: fb });
	const probs = realizedProblems(fb, r);
	ok(
		"fb の計画を realize すると、音を置いた後の関門を全部満たす",
		probs.length === 0,
		probs.slice(0, 8),
	);
	ok(
		"76小節・トラック4本（@0 色の線 / @1 分散 / @2 低音 / @3 和音）",
		r.bars === 76 &&
			r.tracks.map((t) => t.slot).join() === "color,arp,bass,comp",
	);

	const ms = regionMetrics(fb, r);
	const tol = {
		arpPerSec: 0.2,
		upperMean: 1.5,
		bassPerBar: 0.5,
		roundTrip: 0.08,
		vMean: 1.0,
		compHitsPerBar: 0.01,
	} as const;
	for (const key of Object.keys(tol) as (keyof typeof tol)[]) {
		const off = ms.filter(
			(m) => Math.abs(m[key] - FB_METRICS[m.role][key]) > tol[key],
		);
		ok(
			`${key}: 区間ごとに fb の実測 ±${tol[key]}`,
			off.length === 0,
			off.map(
				(m) =>
					`${m.role} ${m[key].toFixed(3)}（fb ${FB_METRICS[m.role][key]}）`,
			),
		);
	}
	console.log(
		`  info ${ms
			.map(
				(m) =>
					`${m.role} 上半分${m.upperMean.toFixed(1)}（fb ${FB_METRICS[m.role].upperMean}）・往復${m.roundTrip.toFixed(2)}（fb ${FB_METRICS[m.role].roundTrip}）`,
			)
			.join(" / ")}`,
	);
	const peak = [...ms].sort((a, b) => b.vMean - a.vMean)[0];
	ok(
		"強弱の山の区間が fb と同じ（borrowB）",
		peak.role === "borrowB",
		peak.role,
	);

	// 和音の置き方: fb の手選びの辞書（ホ長調の和音名）と一致する割合（表示だけ）
	{
		const groups = new Map<number, RNote[]>();
		for (const n of r.notes.comp) {
			const g = groups.get(startOf(n));
			if (g) g.push(n);
			else groups.set(startOf(n), [n]);
		}
		let match = 0;
		let total = 0;
		const seen = new Set<string>();
		for (const g of groups.values()) {
			const n0 = g[0];
			if (fb.regions[n0.regionIndex].texture.compRegister !== 0) continue;
			const parts = FB_CHORD_NAMES[n0.bar].split(" ");
			const name = parts.length > 1 && n0.pos16 >= 8 ? parts[1] : parts[0];
			const want = FB_VOICINGS[name];
			if (!want || seen.has(`${n0.bar}:${name}`)) continue;
			seen.add(`${n0.bar}:${name}`);
			total++;
			const got = g.map((n) => n.midi).sort((a, b) => a - b);
			if (JSON.stringify(got) === JSON.stringify(want)) match++;
		}
		console.log(`  info 和音の置き方が fb の辞書と一致: ${match}/${total}`);
		ok(
			"和音の置き方の辞書一致を数えられる（合わなくても失敗にしない）",
			total > 0,
		);
	}

	const vKinds = ACCOMP_SLOTS.map(
		(slot) => new Set(r.notes[slot].map((n) => n.v)).size,
	);
	console.log(
		`  info v の種類数 ${vKinds.join("／")}（fb ${FB_V_KINDS.join("／")}）`,
	);
	ok(
		"v の種類数は分散・低音・和音とも 10 以上（音符ごとの強弱がある）",
		vKinds.slice(1).every((k) => k >= 10),
		vKinds,
	);
	const c = clashPairs(r);
	console.log(
		`  info ぶつかり ${JSON.stringify(c)}（1小節 ${(sum(Object.values(c)) / r.bars).toFixed(3)}、fb ${FB_CLASHES_PER_BAR}）`,
	);

	// return の頭は home を音ごと複写、強弱は return の値
	{
		const home = fb.regions[0];
		const ret = fb.regions[6];
		const n = echoBars(fb);
		const same = Array.from({ length: n }, (_, i) => {
			const shape = (bar: number): string =>
				r.notes.arp
					.filter((x) => x.bar === bar)
					.map((x) => `${x.pos16}:${x.len16}:${x.midi}`)
					.join();
			return shape(home.startBar + i) === shape(ret.startBar + i);
		});
		ok(
			`return の頭 ${n} 小節は、分散が home と同じ音`,
			n === 10 && same.every(Boolean),
		);
		const vh = mean(r.notes.arp.filter((x) => x.bar < n).map((x) => x.v));
		const vr = mean(
			r.notes.arp
				.filter((x) => x.bar >= ret.startBar && x.bar < ret.startBar + n)
				.map((x) => x.v),
		);
		ok("複写した return の頭は、home より静か", vr < vh - 3, {
			home: vh,
			return: vr,
		});
	}

	// 色の線（@0）
	{
		const cl = r.notes.color;
		const bb = fb.regions.find((x) => x.role === "borrowB");
		const okBars = cl.every(
			(n) =>
				n.bar === r.bars - 1 ||
				(bb !== undefined &&
					(COLOR_LINE.borrowBBars as readonly number[]).includes(
						n.bar - bb.startBar,
					)),
		);
		ok(
			`色の線は borrowB の {1,2,5,6} と最終小節だけ、4〜6音、v ${COLOR_LINE.velocity.min}〜${COLOR_LINE.velocity.max}`,
			okBars &&
				cl.length >= COLOR_LINE.notesPerSong.min &&
				cl.length <= COLOR_LINE.notesPerSong.max &&
				cl.every(
					(n) =>
						n.v >= COLOR_LINE.velocity.min && n.v <= COLOR_LINE.velocity.max,
				),
			cl.map((n) => `${n.bar + 1}:${n.pos16}+${n.len16} ${n.midi} v${n.v}`),
		);
		// fb の @0 と同じ小節・位置・長さ・v・音名（高さは50小節だけ1オクターブ下: 分散の天辺が F#5 なので
		// 「天辺より2半音以上下」で F#5 を置けない。付録 D）
		const got = cl.map((n) => `${n.bar + 1}:${n.pos16}+${n.len16} v${n.v}`);
		const want = FB_COLOR_LINE.map(
			(n) => `${n.bar}:${n.pos16}+${n.len16} v${n.v}`,
		);
		const samePitch = cl.filter(
			(n, i) => FB_COLOR_LINE[i] && n.midi === FB_COLOR_LINE[i].midi,
		).length;
		ok(
			"色の線が fb の @0 と同じ小節・位置・長さ（2拍・3拍・最後は2拍ずつ）・v・音名",
			JSON.stringify(got) === JSON.stringify(want) &&
				cl.every(
					(n, i) => (((n.midi - FB_COLOR_LINE[i].midi) % 12) + 12) % 12 === 0,
				),
			{ got: cl.map((n) => `${n.bar + 1}:${n.pos16}+${n.len16} ${n.midi}`) },
		);
		ok(
			"色の線の高さは fb と 5/6 一致（違うのは50小節の F#4 / F#5 だけ）",
			samePitch === FB_COLOR_LINE.length - 1 &&
				cl[0]?.bar === 49 &&
				cl[0]?.midi === FB_COLOR_LINE[0].midi - 12,
			`${samePitch}/${FB_COLOR_LINE.length}`,
		);
		const none = realizeAccomp({ plan: fb, colorLine: false });
		ok(
			"colorLine: false なら @0 は空で、ほかのトラックは同じ",
			none.notes.color.length === 0 &&
				!none.colorLine &&
				r.colorLine &&
				JSON.stringify(none.tracks.slice(1)) ===
					JSON.stringify(r.tracks.slice(1)),
		);
		ok(
			"colorLine: false の実現も関門を全部通る（最終小節の @0 を求めない）",
			realizedProblems(fb, none).length === 0,
			realizedProblems(fb, none).slice(0, 3),
		);
	}

	// 低音の和音外音（経過音・半音渡し）の置き場所を表示
	console.log(
		`  info 低音の和音外音 ${r.notes.bass
			.filter((n) => n.kind !== "chord")
			.map((n) => `${n.bar + 1}小節${n.pos16}+${n.len16}(${n.kind})`)
			.join(" ")}`,
	);

	ok(
		"決定性: 同じ計画・同じ乱数列で JSON が完全一致",
		JSON.stringify(realizeAccomp({ plan: fb })) === JSON.stringify(r),
	);
	ok(
		"stepsPerBar を変えると、ステップだけが比例して変わる（96・384）",
		[96, 384].every((spb) => {
			const x = realizeAccomp({ plan: fb, stepsPerBar: spb });
			return x.tracks.every((t, i) =>
				t.notes.every(
					(n, k) =>
						n.startStep * 192 === r.tracks[i].notes[k].startStep * spb &&
						n.durationSteps * 192 ===
							r.tracks[i].notes[k].durationSteps * spb &&
						n.pitchUnits === r.tracks[i].notes[k].pitchUnits &&
						n.velocity === r.tracks[i].notes[k].velocity,
				),
			);
		}),
	);
	let threw = false;
	try {
		realizeAccomp({ plan: fb, stepsPerBar: 100 });
	} catch {
		threw = true;
	}
	ok("stepsPerBar が 16 の倍数でなければ例外", threw);
	ok(
		"12平均律: 音高はすべて半音の格子（31 units）の上で、MIDI 番号と一致",
		r.tracks.every((t, i) =>
			t.notes.every(
				(n, k) =>
					n.pitchUnits % 31 === 0 &&
					n.pitchUnits / 31 === r.notes[ACCOMP_SLOTS[i]][k].midi,
			),
		),
	);
}

section("31平均律の綴り（ハ長調の保険の計画で A♭≠G#・導音）");
{
	const p0 = fbPlan(0, 112);
	const r31 = realizeAccomp({ plan: p0, edo: 31 });
	ok(
		"31平均律: 音高はすべて31の格子（12 units）の上",
		r31.tracks.every((t) => t.notes.every((n) => n.pitchUnits % 12 === 0)),
	);
	/** 31平均律の度（オクターブ内、C = 0）。 */
	const step = (u: number): number => (((u % 372) + 372) % 372) / 12;
	const bass = r31.notes.bass;
	const bassTrack = r31.tracks[2].notes;
	const abIdx = bass.flatMap((n, k) => (n.fifth === -4 ? [k] : []));
	ok(
		"♭VI の根音は A♭（31平均律で 21 度。G# の 20 度ではない）",
		abIdx.length > 0 &&
			abIdx.every((k) => step(bassTrack[k].pitchUnits) === 21),
		abIdx.map((k) => step(bassTrack[k].pitchUnits)),
	);
	const lastK = bass.length - 1;
	ok(
		"曲末の導音は B（28 度）で、頭の C（0 度）へ上がる",
		bass[lastK].fifth === 5 &&
			step(bassTrack[lastK].pitchUnits) === 28 &&
			step(bassTrack[0].pitchUnits) === 0,
	);
	ok(
		"31平均律でも、units は綴りどおり（spelledToUnits と一致）",
		ACCOMP_SLOTS.every((slot, i) =>
			r31.notes[slot].every(
				(n, k) =>
					r31.tracks[i].notes[k].pitchUnits ===
					spelledToUnits(n.midi, n.fifth, 31),
			),
		),
	);
	const probs = realizedProblems(p0, r31);
	ok(
		"ハ長調・31平均律でも音を置いた後の関門を満たす",
		probs.length === 0,
		probs.slice(0, 5),
	);
}

section("実現: 種ごと（候補 0 の計画を realize する）");
{
	const cases: { seed: number; baseKey: string; edo: 12 | 31 }[] = [
		...Array.from({ length: 40 }, (_, i) => ({
			seed: 20260929 + i,
			baseKey: "major",
			edo: 12 as const,
		})),
		...Array.from({ length: 5 }, (_, i) => ({
			seed: 20262100 + i,
			baseKey: "major",
			edo: 31 as const,
		})),
		...["key_E", "key_F", "key_Bb", "key_Ab", "key_Gb", "key_B", "key_Db"].map(
			(baseKey, i) => ({ seed: 20262200 + i, baseKey, edo: 12 as const }),
		),
		...["minor", "key_Em", "key_Csm", "mood_dark", "mood_happy", "any"].map(
			(baseKey, i) => ({ seed: 20262300 + i, baseKey, edo: 12 as const }),
		),
	];
	const failures: string[] = [];
	const upper = new Map<AccompRole, number[]>();
	const colorCounts = new Map<number, number>();
	let clashTotal = 0;
	let nonChord = 0;
	const t0 = Date.now();
	for (const c of cases) {
		const random = seededRandom(c.seed);
		const key = resolveAccompKey(c.baseKey, seededRandom(drawSeed(random)));
		const streams = candidateStreams(random);
		const p = planAccomp({ bpm: key.bpm, rootShift: key.rootShift, streams });
		const r = realizeAccomp({ plan: p, streams, edo: c.edo });
		const probs = realizedProblems(p, r);
		if (probs.length)
			failures.push(
				`${c.baseKey} ${c.seed} edo${c.edo}: ${probs.slice(0, 3).join(" / ")}`,
			);
		for (const m of regionMetrics(p, r)) {
			const xs = upper.get(m.role) ?? [];
			xs.push(m.upperMean);
			upper.set(m.role, xs);
		}
		colorCounts.set(
			r.notes.color.length,
			(colorCounts.get(r.notes.color.length) ?? 0) + 1,
		);
		clashTotal += sum(Object.values(clashPairs(r))) / r.bars;
		nonChord += r.notes.bass.filter((n) => n.kind !== "chord").length / r.bars;
		if (
			c.edo === 31 &&
			r.tracks.some((t) => t.notes.some((n) => n.pitchUnits % 12 !== 0))
		)
			failures.push(`${c.seed}: 31平均律の格子の外`);
	}
	const ms = (Date.now() - t0) / cases.length;
	ok(
		`${cases.length} 曲（12平均律 40・31平均律 5・いろいろな調）が音を置いた後の関門を全部満たす`,
		failures.length === 0,
		failures.slice(0, 5),
	);
	console.log(`  info 1曲あたり ${ms.toFixed(0)}ms（計画＋実現＋この検査）`);
	console.log(
		`  info ぶつかりの平均 ${(clashTotal / cases.length).toFixed(3)}/小節、低音の和音外音の平均 ${(nonChord / cases.length).toFixed(2)}/小節`,
	);
	console.log(
		`  info 分散の上半分の平均（実際に鳴る高さ）: ${[...upper]
			.map(
				([role, xs]) =>
					`${role} ${Math.min(...xs).toFixed(1)}〜${Math.max(...xs).toFixed(1)}`,
			)
			.join(" / ")}`,
	);
	console.log(
		`  info 色の線の音数: ${[...colorCounts]
			.sort((a, b) => a[0] - b[0])
			.map(([n, k]) => `${n}音×${k}`)
			.join(
				" ",
			)}（借用の組 P2 の borrowB は ♭VI・♭VII で、色の音を持つのは ♭VI の小節だけ）`,
	);
	const again = (seed: number): Realized => {
		const random = seededRandom(seed);
		const key = resolveAccompKey("major", seededRandom(drawSeed(random)));
		const streams = candidateStreams(random);
		return realizeAccomp({
			plan: planAccomp({ bpm: key.bpm, rootShift: key.rootShift, streams }),
			streams,
		});
	};
	const first = JSON.stringify(again(20260933));
	ok("種ごとの実現も決定的", first === JSON.stringify(again(20260933)));
}

// ============================================================
// 段階1-C: 関門・入口・ミックス・MML の往復
// ============================================================
type AccompSong = import("../../src/compose/compose-accomp").AccompSong;

section("切除対照（音を置いた後）: 1点ずつ壊すと、狙った関門だけが落ちる");
{
	const base = realizeAccomp({ plan: fb });
	ok(
		"壊す前（fb の計画を realize したもの）は関門を全部通る",
		accompGates(fb, base).length === 0,
		realizedProblems(fb, base).slice(0, 5),
	);
	ok(
		"accompTracksFromNotes で作り直したトラックは realize の結果と同じ",
		JSON.stringify(
			accompTracksFromNotes(base.notes, {
				stepsPerBar: base.stepsPerBar,
				edo: base.edo,
				rootShift: fb.rootShift,
			}),
		) === JSON.stringify(base.tracks),
	);
	/** 音を書き換えてから、トラック（正規化）を作り直す。 */
	const mutate = (fn: (notes: Realized["notes"]) => void): Realized => {
		const notes = clone(base.notes);
		fn(notes);
		for (const slot of ACCOMP_SLOTS)
			notes[slot].sort((a, b) => startOf(a) - startOf(b) || a.midi - b.midi);
		return {
			...base,
			notes,
			tracks: accompTracksFromNotes(notes, {
				stepsPerBar: base.stepsPerBar,
				edo: base.edo,
				rootShift: fb.rootShift,
			}),
		};
	};
	const gatesOfR = (r: Realized): AccompGate[] => [
		...new Set(accompGates(fb, r).map((v) => v.gate)),
	];
	const expectR = (label: string, r: Realized, want: AccompGate[]): void => {
		const g = gatesOfR(r).sort();
		ok(
			`${label} → ${want.join("・")} だけ`,
			JSON.stringify(g) === JSON.stringify([...want].sort()),
			g,
		);
	};
	const regionIdx = (role: AccompRole): number =>
		fb.regions.findIndex((r) => r.role === role);
	const md = regionIdx("minorDwell");

	expectR(
		"分散の v を平らにする",
		mutate((ns) => {
			for (const n of ns.arp) n.v = 60;
		}),
		["rule4"],
	);
	expectR(
		"minorDwell の分散を拍の頭（4分）の音だけにする",
		mutate((ns) => {
			ns.arp = ns.arp.filter((n) => n.regionIndex !== md || n.pos16 % 4 === 0);
		}),
		["rule1"],
	);
	expectR(
		"分散の1音の綴りを変える（同じ高さの異名同音）",
		mutate((ns) => {
			const n = ns.arp.find((x) => x.regionIndex === md);
			if (n) n.fifth += 12;
		}),
		["harmony"],
	);
	{
		const r = mutate((ns) => {
			const n = ns.arp.find((x) => x.regionIndex === md);
			if (n) {
				n.midi += 1;
				n.fifth += 7;
			}
		});
		const g = gatesOfR(r);
		ok(
			"分散の1音を半音上げる → harmony が落ちる（ぶつかりも伴ってよい）",
			g.includes("harmony") && g.every((x) => x === "harmony" || x === "clash"),
			g,
		);
	}
	{
		// M7 の和音で、分散の音を和音トラックの7度の半音上（＝根音。構成音なので和声は壊れない）に置く
		let placed = "";
		const r = mutate((ns) => {
			const bars = planBars(fb);
			for (const c of ns.comp) {
				if (c.regionIndex !== md) continue;
				const chord = bars[c.bar].chords[0];
				if (bars[c.bar].chords.length !== 1 || chord.third !== "major")
					continue;
				const seventh = chord.tones.find((t) => t.degree === "7");
				const root = chord.tones.find((t) => t.degree === "R");
				if (!seventh || !root || c.fifth !== seventh.fifth) continue;
				const a = ns.arp.find(
					(x) =>
						x.bar === c.bar &&
						startOf(x) < startOf(c) + c.len16 &&
						startOf(x) + x.len16 > startOf(c) &&
						x.midi !== c.midi + 1,
				);
				if (!a) continue;
				a.midi = c.midi + 1;
				a.fifth = root.fifth;
				a.kind = "chord";
				placed = `${a.bar + 1}小節 ${chord.roman}`;
				return;
			}
		});
		ok("（M7 の小節が見つかる）", placed !== "", placed);
		expectR(`分散を和音トラックの7度と半音でぶつける（${placed}）`, r, [
			"clash",
		]);
	}
	expectR(
		"低音の最後を導音から V の5度にする",
		mutate((ns) => {
			const last = ns.bass[ns.bass.length - 1];
			last.midi += 3;
			last.fifth = 2;
			last.kind = "chord";
		}),
		["seam"],
	);
	expectR(
		"色の線が on のまま、最終小節の @0（4度→3度）を消す",
		mutate((ns) => {
			ns.color = ns.color.filter((n) => n.bar !== base.bars - 1);
		}),
		["seam"],
	);
	expectR(
		"最終小節の @0 の3度を1拍に縮める",
		mutate((ns) => {
			const last = ns.color[ns.color.length - 1];
			if (last?.bar === base.bars - 1) last.len16 = 4;
		}),
		["seam"],
	);
	expectR(
		"分散の1音を伸ばして次の音に重ねる",
		mutate((ns) => {
			const i = ns.arp.findIndex((x) => x.regionIndex === md && x.len16 === 2);
			if (i >= 0) ns.arp[i].len16 = 4;
		}),
		["expression"],
	);
	console.log(
		`  info 関門の並び（rejected の代表になる順）: ${ACCOMP_GATE_ORDER.join(" → ")}`,
	);
}

// ------------------------------------------------------------
section("入口（composeAccomp）: 種ごとに関門を満たす");
/** composeAccomp と同じ乱数の引き方で、候補 k の乱数列を作る（調の種を1つ、候補ごとに6つ）。 */
const streamsAt = (
	seed: number,
	k: number,
): ReturnType<typeof candidateStreams> => {
	const random = seededRandom(seed);
	drawSeed(random);
	for (let i = 0; i < k; i++) candidateStreams(random);
	return candidateStreams(random);
};
/**
 * 採った曲を、計画と (seed, k) から作り直す（保険の計画は決まった乱数列）。composeAccomp の中で
 * 関門に掛けたものと同じ音になるはずなので、トラックが一致し、関門を通ることを外から確かめる。
 */
const rerealize = (song: AccompSong, seed: number): Realized =>
	realizeAccomp({
		plan: song.plan,
		...(song.pick >= 0 ? { streams: streamsAt(seed, song.pick) } : {}),
		stepsPerBar: song.stepsPerBar,
		edo: song.edo,
	});
/** draws（引いた数と落ちた理由）は pick で作り直すと変わるので外して比べる。 */
const withoutDraws = (s: AccompSong): string =>
	JSON.stringify({ ...s, draws: undefined });

type SongCase = { seed: number; baseKey: string; edo: 12 | 31 };
const songCases: SongCase[] = [
	...Array.from({ length: 40 }, (_, i) => ({
		seed: 20260929 + i,
		baseKey: "major",
		edo: 12 as const,
	})),
	...Array.from({ length: 5 }, (_, i) => ({
		seed: 20263100 + i,
		baseKey: "major",
		edo: 31 as const,
	})),
	...["key_E", "minor", "key_Em", "mood_dark", "mood_happy", "any"].flatMap(
		(baseKey, i) =>
			[0, 1].map((j) => ({
				seed: 20263200 + i * 10 + j,
				baseKey,
				edo: 12 as const,
			})),
	),
];
const songs: { c: SongCase; song: AccompSong }[] = [];
{
	const failures: string[] = [];
	const t0 = Date.now();
	for (const c of songCases)
		songs.push({
			c,
			song: composeAccomp({
				random: seededRandom(c.seed),
				baseKey: c.baseKey,
				edo: c.edo,
			}),
		});
	const ms = (Date.now() - t0) / songCases.length;
	for (const { c, song } of songs) {
		const r = rerealize(song, c.seed);
		const where = `${c.baseKey} ${c.seed} edo${c.edo}`;
		if (JSON.stringify(r.tracks) !== JSON.stringify(song.tracks))
			failures.push(`${where}: (seed, k) から作り直すとトラックが違う`);
		const probs = realizedProblems(song.plan, r);
		if (probs.length)
			failures.push(`${where}: ${probs.slice(0, 3).join(" / ")}`);
		if (
			song.compose !== `style:fb.v1:${c.baseKey}:${song.pick}` ||
			song.stepsPerBar !== 192 ||
			song.edo !== c.edo ||
			song.bars !== r.bars ||
			song.kind !== "accomp"
		)
			failures.push(`${where}: compose/bars/edo ${song.compose}`);
	}
	ok(
		`${songCases.length} 曲（major 40・31平均律 5・key_E・minor・key_Em・mood_*・any）: 採った曲を (seed, k) から作り直すと同じトラックで、関門を全部通る`,
		failures.length === 0,
		failures.slice(0, 5),
	);
	const fallback = songs.filter((x) => x.song.pick === -1).length;
	const picks = new Map<number, number>();
	for (const { song } of songs)
		picks.set(song.pick, (picks.get(song.pick) ?? 0) + 1);
	const rejected = new Map<string, number>();
	for (const { song } of songs)
		for (const [g, n] of Object.entries(song.draws.rejected))
			rejected.set(g, (rejected.get(g) ?? 0) + n);
	console.log(
		`  info 1曲あたり ${ms.toFixed(0)}ms（候補のループ・関門・指標込み）。採った候補 ${[
			...picks,
		]
			.sort((a, b) => a[0] - b[0])
			.map(([k, n]) => `k=${k}×${n}`)
			.join(
				" ",
			)}。保険の計画 ${fallback}/${songs.length}。落ちた理由 ${[...rejected].map(([g, n]) => `${g}×${n}`).join(" ") || "なし"}`,
	);
	ok(
		"保険の計画に落ちるのは 1 割未満（表と計画器が関門を満たす候補を作れている）",
		fallback < songs.length / 10,
		fallback,
	);
	ok("1曲 200ms 未満（数十ms の見込み。§7.1）", ms < 200, `${ms.toFixed(0)}ms`);
	const sigs = new Set(
		songs
			.filter((x) => x.c.baseKey === "major")
			.map((x) => x.song.planSignature),
	);
	console.log(`  info major 45 曲の planSignature の種類数 ${sigs.size}`);
	ok("major 45 曲の planSignature が 35 種以上", sigs.size >= 35, sigs.size);

	// 表示用の指標（AccompStats）
	const s0 = songs[0].song;
	console.log(
		`  info 1曲目の stats: ${s0.seconds.toFixed(0)}秒・分散/秒 ${s0.stats.arpNotesPerSec.join(",")}・v ${s0.stats.arpVMean.map((v) => v.toFixed(0)).join(",")}・和音の長さ 借用 ${s0.stats.compMeanLen.borrowed} / 本調 ${s0.stats.compMeanLen.diatonic}（16分）・音程 ${JSON.stringify(s0.stats.arpIntervalHist)}・v の種類 ${s0.stats.vKinds.join("／")}`,
	);
	ok(
		"stats: 区間ごとの配列は7つ・借用和音は本調より長い・音程の割合の和が1・ぶつかりが上限以下",
		songs.every(
			({ song: s }) =>
				s.stats.arpNotesPerSec.length === 7 &&
				s.stats.arpUpperMean.length === 7 &&
				s.stats.arpVMean.length === 7 &&
				s.stats.bassNotesPerBar.length === 7 &&
				s.stats.compMeanLen.borrowed > s.stats.compMeanLen.diatonic &&
				Math.abs(sum(Object.values(s.stats.arpIntervalHist)) - 1) < 0.01 &&
				s.stats.clashesPerBar <= CLASH_PER_BAR_MAX,
		),
	);

	// 色の線（@0。§6 段8）: 生成曲にも、最終小節の4度→3度（2拍ずつ）・borrowB の音価（組の1つめは
	// 2拍目から2拍、2つめは1拍目から2〜3拍）・1曲の音数を掛ける。音数の上限は、borrowB の {1,2,5,6} の
	// うち色の音を持つ小節の数＋2（借用の組 P1 は6、P2 は ♭VI の2小節だけなので4）
	{
		const bad: string[] = [];
		const byPair = new Map<string, number[]>();
		const lens: number[] = [];
		const tones = COLOR_LINE.tones as Readonly<Record<string, unknown>>;
		const bbBars = COLOR_LINE.borrowBBars as readonly number[];
		for (const { c, song } of songs) {
			const r = rerealize(song, c.seed);
			const where = `${c.baseKey} ${c.seed} edo${c.edo}`;
			const cl = r.notes.color;
			const last = r.bars - 1;
			const fin = cl.filter((n) => n.bar === last);
			if (
				fin.map((n) => `${n.pos16}+${n.len16}`).join(" ") !== "0+8 8+8" ||
				fin[1].midi !== fin[0].midi - 1
			)
				bad.push(
					`${where}: 最終小節 ${fin.map((n) => `${n.pos16}+${n.len16}:${n.midi}`).join(" ") || "なし"}`,
				);
			const bb = song.plan.regions.find((x) => x.role === "borrowB");
			const pbs = planBars(song.plan);
			const colorable = bb
				? bbBars.filter((i) => {
						const cs = pbs[bb.startBar + i]?.chords ?? [];
						return cs.length === 1 && tones[cs[0].colorKey] !== undefined;
					}).length
				: 0;
			for (const n of cl) {
				if (n.bar === last) continue;
				lens.push(n.len16);
				const k = bb ? bbBars.indexOf(n.bar - bb.startBar) : -1;
				const place =
					k % 2 === 0
						? COLOR_LINE.placement.first
						: COLOR_LINE.placement.second;
				if (
					k < 0 ||
					n.pos16 !== place.pos16 ||
					n.len16 < COLOR_LINE.minLen16 ||
					n.len16 > place.len16
				)
					bad.push(`${where}: ${n.bar + 1}小節 ${n.pos16}+${n.len16}`);
			}
			const max = Math.min(COLOR_LINE.notesPerSong.max, colorable + 2);
			if (cl.length < COLOR_LINE.notesPerSong.min || cl.length > max)
				bad.push(
					`${where}: ${cl.length}音（${song.plan.borrowPair}、上限 ${max}）`,
				);
			const list = byPair.get(song.plan.borrowPair) ?? [];
			list.push(cl.length);
			byPair.set(song.plan.borrowPair, list);
		}
		ok(
			`${songs.length} 曲: 色の線は最終小節が4度→3度を2拍ずつ・borrowB の音は2〜3拍（組の1つめ2拍）・1曲 ${COLOR_LINE.notesPerSong.min}〜${COLOR_LINE.notesPerSong.max} 音（借用の組ごとの上限以下）`,
			bad.length === 0,
			bad.slice(0, 5),
		);
		const hist = (xs: readonly number[]): string =>
			[...new Set(xs)]
				.sort((a, b) => a - b)
				.map((x) => `${x}×${xs.filter((y) => y === x).length}`)
				.join(" ");
		console.log(
			`  info 色の線の音数（借用の組ごと）${[...byPair]
				.sort()
				.map(([p, xs]) => ` ${p}: ${hist(xs)}`)
				.join("")}。borrowB の音価（16分）${hist(lens)}`,
		);
	}
}

section("入口: 決定性・pick・recent・上書き");
{
	const seed = 20260929;
	const a = composeAccomp({ random: seededRandom(seed), baseKey: "major" });
	const b = composeAccomp({ random: seededRandom(seed), baseKey: "major" });
	ok("同じ種で JSON が完全一致", JSON.stringify(a) === JSON.stringify(b));
	ok(
		'"any"・未指定は "major" と同じ曲（compose の2項目めは与えた値のまま）',
		(() => {
			const x = composeAccomp({ random: seededRandom(seed), baseKey: "any" });
			const y = composeAccomp({ random: seededRandom(seed) });
			return (
				JSON.stringify(x.tracks) === JSON.stringify(a.tracks) &&
				JSON.stringify(y.tracks) === JSON.stringify(a.tracks) &&
				x.compose === `style:fb.v1:any:${a.pick}` &&
				y.compose === `style:fb.v1:any:${a.pick}`
			);
		})(),
	);

	// recent: 採った計画を直近に入れると、次の候補を採る。候補番号で再現できる
	const r1 = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		recent: [a.planSignature],
	});
	ok(
		"recent と同じ計画は飛ばす（rejected.recent を数え、別の計画を採る）",
		r1.planSignature !== a.planSignature &&
			r1.pick > a.pick &&
			r1.draws.rejected.recent === 1,
		{ pick: r1.pick, rejected: r1.draws.rejected },
	);
	const again = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		pick: r1.pick,
		recent: [r1.planSignature],
	});
	ok(
		"pick: k で作り直すと同じ曲（recent は無視する。draws 以外が一致）",
		withoutDraws(again) === withoutDraws(r1) && again.draws.tried === 1,
	);
	ok(
		"pick は (seed, k) だけで決まる: 候補3を直接作ると、候補3の乱数列で計画したものと同じ（曲の計画は、実現の段の打ち方の記録のほか）",
		(() => {
			const s3 = composeAccomp({
				random: seededRandom(seed),
				baseKey: "major",
				pick: 3,
			});
			if (s3.pick !== 3) return false;
			const key = resolveAccompKey(
				"major",
				seededRandom(drawSeed(seededRandom(seed))),
			);
			const p = planAccomp({
				bpm: key.bpm,
				rootShift: key.rootShift,
				streams: streamsAt(seed, 3),
			});
			return JSON.stringify(p) === JSON.stringify(withoutCompHits(s3.plan));
		})(),
	);

	// 保険の計画を直接（pick: −1）
	const fbk = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		pick: -1,
	});
	ok(
		"pick: −1 は保険の計画（その調・テンポの fb 相当。compose は style:fb.v1:<baseKey>:-1）",
		fbk.pick === -1 &&
			fbk.compose === "style:fb.v1:major:-1" &&
			JSON.stringify(withoutCompHits(fbk.plan)) ===
				JSON.stringify(fbPlan(a.rootShift, a.bpm)) &&
			fbk.draws.tried === 0 &&
			Object.keys(fbk.draws.rejected).length === 0,
		{ compose: fbk.compose, draws: fbk.draws },
	);

	// 上書き
	const lens = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		pick: 0,
		overrides: { lengths: { minorDwell: 24 } },
	});
	const plain0 = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		pick: 0,
	});
	ok(
		"overrides.lengths: 区間長を変えても調・テンポ・借用の組は同じ",
		lens.pick === 0 &&
			lens.rootShift === plain0.rootShift &&
			lens.bpm === plain0.bpm &&
			lens.plan.borrowPair === plain0.plan.borrowPair &&
			lens.plan.regions.find((r) => r.role === "minorDwell")?.bars === 24,
		{ pick: lens.pick, rejected: lens.draws.rejected },
	);
	const bpm = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		overrides: { bpm: 110 },
	});
	ok(
		"overrides.bpm: テンポだけ変わり、調は同じ",
		bpm.bpm === 110 && bpm.rootShift === a.rootShift,
	);
	const given = composeAccomp({
		random: seededRandom(seed),
		overrides: { plan: fb },
	});
	ok(
		"overrides.plan: 計画をそのまま鳴らす（fb はホ長調・112BPM。pick −1・compose style:fb.v1:any:plan・関門を通る。曲の計画は打ち方の記録を埋めたもの）",
		JSON.stringify(withoutCompHits(given.plan)) === JSON.stringify(fb) &&
			JSON.stringify(given.plan) === JSON.stringify(FB_PLAN) &&
			given.rootShift === 4 &&
			given.bpm === 112 &&
			given.keyName === COMPOSE_KEYS.key_E.name &&
			given.pick === -1 &&
			given.compose === "style:fb.v1:any:plan" &&
			Object.keys(given.draws.rejected).length === 0,
		{ compose: given.compose, rejected: given.draws.rejected },
	);
	{
		const broken = clone(fb);
		for (const r of broken.regions) r.arpLevel = r.arpLevel.map(() => 60);
		const g = composeAccomp({
			random: seededRandom(seed),
			overrides: { plan: broken },
		});
		ok(
			"overrides.plan が関門で落ちても返し、落ちた関門を draws.rejected に数える",
			(g.draws.rejected.rule4 ?? 0) === 1,
			g.draws.rejected,
		);
	}

	// 短調・色の線
	const em = composeAccomp({ random: seededRandom(seed), baseKey: "key_Em" });
	ok(
		"ホ短調を選ぶと、ト長調を家にして注記が付く",
		em.rootShift === -5 &&
			em.keyName === COMPOSE_KEYS.key_G.name &&
			(em.homeFromMinor ?? "").includes("ホ短調"),
		{ key: em.keyLabel, note: em.homeFromMinor },
	);
	ok("長調では注記が無い（JSON にも出ない）", !("homeFromMinor" in a));
	const noColor = composeAccomp({
		random: seededRandom(seed),
		baseKey: "major",
		colorLine: false,
	});
	ok(
		"colorLine: false なら @0 は空で、@1〜@3 は同じ",
		noColor.tracks[0].notes.length === 0 &&
			JSON.stringify(noColor.tracks.slice(1)) ===
				JSON.stringify(a.tracks.slice(1)),
	);

	// 不正な指定は例外
	const throws = (f: () => unknown): boolean => {
		try {
			f();
			return false;
		} catch {
			return true;
		}
	};
	ok(
		"不正な指定は例外（stepsPerBar が16の倍数でない・edo・baseKey に ':'・pick の範囲外）",
		throws(() => composeAccomp({ stepsPerBar: 100 })) &&
			throws(() => composeAccomp({ edo: 19 as 12 })) &&
			throws(() => composeAccomp({ baseKey: "key_E:x" })) &&
			throws(() => composeAccomp({ pick: CANDIDATE_LIMIT })) &&
			throws(() => composeAccomp({ pick: -2 })),
	);
	ok(
		"stepsPerBar 96・384 でも同じ曲（ステップだけが比例する）",
		[96, 384].every((spb) => {
			const x = composeAccomp({
				random: seededRandom(seed),
				baseKey: "major",
				stepsPerBar: spb,
			});
			return (
				x.planSignature === a.planSignature &&
				x.tracks.every((t, i) =>
					t.notes.every(
						(n, k) =>
							n.startStep * 192 === a.tracks[i].notes[k].startStep * spb &&
							n.pitchUnits === a.tracks[i].notes[k].pitchUnits &&
							n.velocity === a.tracks[i].notes[k].velocity,
					),
				)
			);
		}),
	);
}

section("入口: 正規化（段9）");
{
	const probs: string[] = [];
	for (const { c, song } of songs)
		song.tracks.forEach((t, i) => {
			if (t.index !== i || t.slot !== ACCOMP_SLOTS[i])
				probs.push(`${c.seed}: track ${i} の index/slot`);
			if (t.notes.length === 0) return;
			if (t.volume > 100)
				probs.push(`${c.seed}: track ${i} volume ${t.volume}`);
			const maxVel = Math.max(...t.notes.map((n) => n.velocity));
			if (t.volume < 100 && maxVel !== 100)
				probs.push(`${c.seed}: track ${i} velocity の最大 ${maxVel}`);
		});
	ok(
		"各トラックの volume ≤ 100 で、velocity の最大はちょうど 100（読み込み直後と同じ形）",
		probs.length === 0,
		probs.slice(0, 5),
	);
}

section("保険の計画: 全調・全テンポで関門を通る");
{
	const majorShifts = [
		...new Set(
			Object.values(COMPOSE_KEYS)
				.filter((k) => k.mode === "major")
				.map((k) => k.rootShift),
		),
	];
	const failures: string[] = [];
	for (const rs of majorShifts)
		for (const [bpmV] of BPM_TABLE) {
			const p = fbPlan(rs, bpmV);
			const probs = realizedProblems(p, realizeAccomp({ plan: p }));
			if (probs.length) failures.push(`rs${rs} ${bpmV}: ${probs[0]}`);
		}
	for (const rs of [-5, 0, 4, 6]) {
		const p = fbPlan(rs, 112);
		const probs = realizedProblems(p, realizeAccomp({ plan: p, edo: 31 }));
		if (probs.length) failures.push(`rs${rs} edo31: ${probs[0]}`);
	}
	ok(
		`保険の計画（fbPlan）は長調 ${majorShifts.length} 調 × テンポ ${BPM_TABLE.length} 種（12平均律）と 31平均律 4 調で関門を全部通る`,
		failures.length === 0,
		failures.slice(0, 5),
	);
}

section("ミックス（accompMeta）");
{
	const s = songs[0].song;
	const m = accompMeta(s);
	ok(
		"drum=none・loop・retro_game・volume 80・mastercomp/fade 0・compose・edo",
		m.drum === "none" &&
			m.loop === true &&
			m.instrument === "retro_game" &&
			m.volume === 80 &&
			m.masterCompression === 0 &&
			m.fadeIn === 0 &&
			m.fadeOut === 0 &&
			m.compose === s.compose &&
			m.edo === s.edo,
		m,
	);
	const fx = masterFxToMeta(s.mix.masterFx);
	ok(
		"マスタ: reverb 50・decay 30（3.0秒）・predelay 25・delay 25・8d（master-fx.ts の masterFxToMeta と同じ変換）",
		m.reverb === 50 &&
			m.reverbDecay === 30 &&
			m.reverbPreDelay === 25 &&
			m.delay === 25 &&
			m.delayDivision === "8d" &&
			m.reverb === fx.reverb &&
			m.reverbDecay === fx.reverbDecay &&
			m.reverbPreDelay === fx.reverbPreDelay &&
			m.delay === fx.delay &&
			m.delayDivision === fx.delayDivision,
	);
	ok(
		"トラック: inst（square／square／Synth Bass 1／EP2）・eqhi・pan・rev・dly が fb の値",
		JSON.stringify(m.trackInstruments) ===
			JSON.stringify({
				0: "Lead 1 (square)",
				1: "Lead 1 (square)",
				2: "Synth Bass 1",
				3: "Electric Piano 2",
			}) &&
			JSON.stringify(m.trackEqHigh) ===
				JSON.stringify({ 1: -9, 2: -6, 3: -3 }) &&
			JSON.stringify(m.trackPan) === JSON.stringify({ 1: 50, 3: 80 }) &&
			JSON.stringify(m.trackReverbSend) ===
				JSON.stringify({ 0: 45, 1: 55, 2: 10, 3: 65 }) &&
			JSON.stringify(m.trackDelaySend) === JSON.stringify({ 0: 30, 1: 15 }),
		m,
	);
	ok(
		"曲の mix は表の値の写し（書き換えても表は変わらない）",
		(() => {
			const x = composeAccomp({ random: seededRandom(1) });
			x.mix.trackPan[1] = 0;
			return tables.ACCOMP_MIX.trackPan[1] === 50;
		})(),
	);
}

section("MML の往復（parseMML(accompToMml(song))）");
{
	const sortedKeys = (o: unknown): string =>
		JSON.stringify(
			Object.fromEntries(
				Object.entries((o ?? {}) as Record<string, unknown>).sort(),
			),
		);
	/** placements と宣言を song と突き合わせる。一致しない点を返す。 */
	const roundTripProblems = (song: AccompSong, mml: string): string[] => {
		const out: string[] = [];
		const parsed = parseMML(mml, { stepsPerBar: song.stepsPerBar });
		if (parsed.bpm !== song.bpm) out.push(`bpm ${parsed.bpm}`);
		const byPos = (
			x: { startStep: number; pitchUnits: number },
			y: { startStep: number; pitchUnits: number },
		): number => x.startStep - y.startStep || x.pitchUnits - y.pitchUnits;
		for (const t of song.tracks) {
			const got = parsed.placements
				.filter((p) => p.trackIndex === t.index)
				.sort(byPos);
			const want = [...t.notes].sort(byPos);
			if (got.length !== want.length) {
				out.push(`@${t.index}: 音の数 ${got.length}/${want.length}`);
				continue;
			}
			const bad = want.findIndex(
				(n, k) =>
					got[k].startStep !== n.startStep ||
					got[k].durationSteps !== n.durationSteps ||
					got[k].pitchUnits !== n.pitchUnits ||
					got[k].velocity !== effectiveVelocity(t.volume, n.velocity),
			);
			if (bad >= 0)
				out.push(
					`@${t.index} ${bad}音目: ${JSON.stringify(got[bad])} ≠ ${JSON.stringify(want[bad])}（volume ${t.volume}）`,
				);
			const kinds = new Set(got.map((p) => p.velocity)).size;
			if (kinds !== song.stats.vKinds[t.index])
				out.push(
					`@${t.index}: v の種類数 ${kinds}（${song.stats.vKinds[t.index]}）`,
				);
		}
		// 宣言: accompMeta ＋ #ver（0 の mastercomp・fade と 12 の edo は formatMmlMeta が書かない）
		const meta = parsed.meta as Record<string, unknown>;
		for (const [k, v] of Object.entries(accompMeta(song))) {
			const got = meta[k];
			if ((v === 0 || (k === "edo" && v === 12)) && got === undefined) continue;
			if (typeof v === "object" && v !== null) {
				if (sortedKeys(v) !== sortedKeys(got)) out.push(`meta.${k}`);
			} else if (JSON.stringify(v) !== JSON.stringify(got))
				out.push(`meta.${k} ${String(got)}（${String(v)}）`);
		}
		if (meta.version !== DTM_VERSION) out.push(`meta.version ${meta.version}`);
		return out;
	};
	const targets: { label: string; song: AccompSong; seed?: number }[] = [
		...songs
			.filter((x) => x.c.edo === 12)
			.slice(0, 6)
			.map((x) => ({
				label: `${x.c.baseKey} ${x.c.seed}`,
				song: x.song,
				seed: x.c.seed,
			})),
		...songs
			.filter((x) => x.c.edo === 31)
			.slice(0, 3)
			.map((x) => ({
				label: `31平均律 ${x.c.seed}`,
				song: x.song,
				seed: x.c.seed,
			})),
		{ label: "fb の計画", song: composeAccomp({ overrides: { plan: fb } }) },
		{
			label: "色の線なし",
			song: composeAccomp({ random: seededRandom(7), colorLine: false }),
			seed: 7,
		},
	];
	const failures: string[] = [];
	const sizes: number[] = [];
	const loopLine = /^#\s*loop\s*=\s*on\s*$/im;
	for (const t of targets) {
		const full = accompToMml(t.song, { seed: t.seed });
		const mini = accompToMml(t.song, { seed: t.seed, minified: true });
		sizes.push(full.length);
		for (const [kind, mml] of [
			["full", full],
			["minified", mini],
		] as const) {
			const probs = roundTripProblems(t.song, mml);
			if (t.seed !== undefined && parseMML(mml).meta.seed !== t.seed)
				probs.push("meta.seed");
			if (probs.length)
				failures.push(`${t.label} ${kind}: ${probs.slice(0, 3).join(" / ")}`);
		}
		// 埋め込みの再生専用プレイヤー（mml-player.ts の parseLoopMeta）は、行の頭から行末までが
		// #loop=on の行しかループと読まない
		if (!loopLine.test(full) || !loopLine.test(mini))
			failures.push(`${t.label}: #loop=on が単独の行に無い`);
		if (!full.trimEnd().endsWith("#end;") || !full.includes(";\n@1 "))
			failures.push(
				`${t.label}: DAW の full 書き出しと同じ形（;\\n 区切り・#end;）でない`,
			);
	}
	ok(
		`${targets.length} 曲（12平均律・31平均律・fb の計画・色の線なし）で、音符・長さ・音高・絶対値の v・v の種類数・宣言が往復する（full と minify）`,
		failures.length === 0,
		failures.slice(0, 5),
	);
	console.log(
		`  info MML の長さ ${Math.min(...sizes)}〜${Math.max(...sizes)} 文字（fb.mml は約15KB）`,
	);
	ok(
		"#compose の値が mml-parser の宣言の文字集合 [\\w:.-]+ に収まる",
		songs.every(({ song }) => /^[\w:.-]+$/.test(song.compose)),
	);
}

// ============================================================
section(
	"#compose の書式（style:<id>.v<版>:<baseKey>:<k>、docs/accomp-style-engine.md §2.5）",
);
{
	const { formatAccompCompose, parseAccompCompose, ACCOMP_COMPOSE_PREFIX } =
		entry;
	const { ACCOMP_STYLES, ACCOMP_STYLE_ID_RE, DEFAULT_ACCOMP_STYLE } = styles;
	ok(
		"登録したスタイルの id は /^[a-z0-9_-]+$/ で重複なし・版は1以上・表示名と説明がある。既定は fb の版1",
		ACCOMP_STYLES.every(
			(st) =>
				ACCOMP_STYLE_ID_RE.test(st.id) &&
				Number.isInteger(st.version) &&
				st.version >= 1 &&
				st.label.length > 0 &&
				st.description.length > 0,
		) &&
			new Set(ACCOMP_STYLES.map((st) => st.id)).size === ACCOMP_STYLES.length &&
			DEFAULT_ACCOMP_STYLE.id === "fb" &&
			DEFAULT_ACCOMP_STYLE.version === 1 &&
			ACCOMP_COMPOSE_PREFIX === "style:",
	);
	const bad: string[] = [];
	for (const { c, song } of songs) {
		const t = parseAccompCompose(song.compose);
		if (
			!t ||
			t.style !== "fb" ||
			t.version !== 1 ||
			t.baseKey !== c.baseKey ||
			t.pick !== song.pick ||
			t.legacy ||
			formatAccompCompose(t) !== song.compose
		)
			bad.push(song.compose);
	}
	ok(
		`${songs.length} 曲の compose を読むと (fb, 1, baseKey, pick) で、書き直すと同じ文字列`,
		bad.length === 0,
		bad.slice(0, 5),
	);
	const same = (a: unknown, b: unknown): boolean =>
		JSON.stringify(a) === JSON.stringify(b);
	ok(
		"読める値: style:fb.v1:major:3・style:fb.v12:key_E:-1・style:fb.v1:any:plan・style:minor-pedal.v2:mood_dark:0",
		same(parseAccompCompose("style:fb.v1:major:3"), {
			style: "fb",
			version: 1,
			baseKey: "major",
			pick: 3,
		}) &&
			same(parseAccompCompose("style:fb.v12:key_E:-1"), {
				style: "fb",
				version: 12,
				baseKey: "key_E",
				pick: -1,
			}) &&
			same(parseAccompCompose("style:fb.v1:any:plan"), {
				style: "fb",
				version: 1,
				baseKey: "any",
				pick: "plan",
			}) &&
			same(parseAccompCompose("style:minor-pedal.v2:mood_dark:0"), {
				style: "minor-pedal",
				version: 2,
				baseKey: "mood_dark",
				pick: 0,
			}),
	);
	ok(
		"旧書式 accomp:<baseKey>:<k>（S0 より前。未 publish）は fb の版1として読み、legacy を付ける",
		same(parseAccompCompose("accomp:major:0"), {
			style: "fb",
			version: 1,
			baseKey: "major",
			pick: 0,
			legacy: true,
		}) &&
			same(parseAccompCompose("accomp:any:plan"), {
				style: "fb",
				version: 1,
				baseKey: "any",
				pick: "plan",
				legacy: true,
			}),
	);
	const rejects = [
		"",
		"style:FB.v1:major:0",
		"style:f.b.v1:major:0",
		"style:fb:major:0",
		"style:fb.v0:major:0",
		"style:fb.v01:major:0",
		"style:fb.v1:major",
		"style:fb.v1:ma:jor:0",
		"style:fb.v1:major:-2",
		"style:fb.v1:major:1.5",
		"style:fb.v1:major:0:extra",
		"jpop_standard:any:auto:intro-verse-chorus",
		"custom:any:auto:",
	];
	const accepted = rejects.filter((v) => parseAccompCompose(v) !== null);
	ok(
		`伴奏主体の値でないもの（歌ものの compose・id の大文字や . ・版0・候補 −2 など ${rejects.length} 通り）は null`,
		accepted.length === 0 && parseAccompCompose(undefined) === null,
		accepted,
	);
	const throws = (f: () => unknown): boolean => {
		try {
			f();
			return false;
		} catch {
			return true;
		}
	};
	const base = { style: "fb", version: 1, baseKey: "any", pick: 0 } as const;
	ok(
		"書けない値は例外: id に . と : と大文字・版0・baseKey に :・候補 −2",
		throws(() => formatAccompCompose({ ...base, style: "f.b" })) &&
			throws(() => formatAccompCompose({ ...base, style: "f:b" })) &&
			throws(() => formatAccompCompose({ ...base, style: "Fb" })) &&
			throws(() => formatAccompCompose({ ...base, version: 0 })) &&
			throws(() => formatAccompCompose({ ...base, baseKey: "a:b" })) &&
			throws(() => formatAccompCompose({ ...base, pick: -2 })) &&
			formatAccompCompose(base) === "style:fb.v1:any:0",
	);
	const song = songs[0].song;
	const back = parseMML(accompToMml(song)).meta.compose;
	ok(
		"#compose は MML の宣言を往復する（parseMML(accompToMml(song)).meta.compose が同じ文字列）",
		back === song.compose && /^style:fb\.v1:/.test(song.compose),
		back,
	);
}

// ============================================================
section(
	"監査用の記録（diagnostics。docs/accomp-style-engine.md §5「退避の率を数える」）",
);
{
	type Diag = import("../../src/compose/compose-accomp").AccompCandidateDiag;
	const bad: string[] = [];
	let candidates = 0;
	for (const c of songCases.slice(0, 20)) {
		const log: Diag[] = [];
		const plain = composeAccomp({
			random: seededRandom(c.seed),
			baseKey: c.baseKey,
			edo: c.edo,
		});
		const withDiag = composeAccomp({
			random: seededRandom(c.seed),
			baseKey: c.baseKey,
			edo: c.edo,
			diagnostics: (d) => log.push(d),
		});
		candidates += log.length;
		const last = log[log.length - 1];
		if (JSON.stringify(plain) !== JSON.stringify(withDiag))
			bad.push(`${c.seed}: 記録を取ると曲が変わる`);
		else if (
			log.length !== withDiag.draws.tried + (withDiag.pick === -1 ? 1 : 0) ||
			!last ||
			last.k !== withDiag.pick ||
			(withDiag.pick >= 0 && last.rejectedBy !== null) ||
			log.slice(0, -1).some((d) => d.rejectedBy === null || d.plan === null) ||
			(withDiag.pick >= 0 &&
				(last.plan === null ||
					typeof last.plan.lengthsExhausted !== "boolean" ||
					typeof last.plan.textureExhausted !== "boolean" ||
					typeof last.plan.offsetsExhausted !== "boolean"))
		)
			bad.push(`${c.seed}: 記録の形 ${JSON.stringify(log)}`);
	}
	const fbLog: Diag[] = [];
	composeAccomp({
		random: seededRandom(1),
		overrides: { plan: fbPlan() },
		diagnostics: (d) => fbLog.push(d),
	});
	ok(
		`20 曲で、diagnostics を渡しても曲は1バイトも変わらず、関門に掛けた候補ごとに1回（計 ${candidates} 回）、採った候補の記録が最後に来る。計画を丸ごと与えた曲は k="plan" で1回`,
		bad.length === 0 &&
			fbLog.length === 1 &&
			fbLog[0].k === "plan" &&
			fbLog[0].rejectedBy === null &&
			fbLog[0].plan === null,
		bad.slice(0, 3),
	);
}

// ============================================================
section(
	"計画の記録（PlanPins。docs/accomp-style-engine.md §3.1・段階 S1）: 実現の段は決めたものを記録し、記録があれば従う",
);
{
	const compIds = new Set(Object.keys(COMP_HITS));
	const fullyPinned = (p: AccompPlan): string[] => {
		const out: string[] = [];
		if (p.style !== "fb" || p.archetype !== "fb" || p.mix !== "fb")
			out.push(`style/archetype/mix ${p.style}/${p.archetype}/${p.mix}`);
		for (const r of p.regions)
			if (
				!r.compHits ||
				r.compHits.length !== r.bars ||
				r.compHits.some((id) => !compIds.has(id))
			)
				out.push(`${r.role}: compHits ${JSON.stringify(r.compHits)}`);
		return out;
	};
	const recorded = realizeAccomp({ plan: fb });
	ok(
		"fb の計画を鳴らすと、実現の段が記録する打ち方が、手書きの fb（fixture の compHits。gen-fb.mjs の COMP を読み直したもの）と一致する",
		JSON.stringify(recorded.compHits) ===
			JSON.stringify(FB_PLAN.regions.map((r) => r.compHits)),
		recorded.compHits,
	);
	ok(
		"計画器は記録のうちスタイル・型・ミックスを書き（fb/fb/fb）、打ち方は書かない（実現の段が決める）",
		fb.style === "fb" &&
			fb.archetype === "fb" &&
			fb.mix === "fb" &&
			fb.regions.every((r) => r.compHits === undefined),
	);
	ok(
		"記録つきの fb の計画（fixture）を鳴らすと、記録の無い計画（fbPlan）と1音も違わない（12平均律・31平均律）",
		[12, 31].every(
			(edo) =>
				JSON.stringify(
					realizeAccomp({ plan: FB_PLAN, edo: edo as 12 | 31 }).tracks,
				) ===
				JSON.stringify(realizeAccomp({ plan: fb, edo: edo as 12 | 31 }).tracks),
		),
	);

	// 曲の計画は記録を全部持ち、同じ乱数列で鳴らし直すと同じ曲になる
	const bad: string[] = [];
	const cases = [
		...songCases.slice(0, 12),
		...songCases.filter((c) => c.edo === 31).slice(0, 3),
	];
	const stripCompose = (mml: string): string =>
		mml.replace(/#compose=[^\s;]+/, "#compose=");
	let viaOverrides = 0;
	for (const c of cases)
		for (const extra of [
			{},
			{ pick: -1 },
			{ pick: 2 },
			{ colorLine: false },
		] as const) {
			const song = composeAccomp({
				random: seededRandom(c.seed),
				baseKey: c.baseKey,
				edo: c.edo,
				...extra,
			});
			const where = `${c.seed} ${JSON.stringify(extra)}`;
			const missing = fullyPinned(song.plan);
			if (missing.length > 0) {
				bad.push(`${where}: ${missing.join(" / ")}`);
				continue;
			}
			// 記録つきの計画を、その曲と同じ乱数列（候補 k の列。保険の計画は決まった列）で鳴らし直す
			const colorLine = "colorLine" in extra ? extra.colorLine : undefined;
			const streams = song.pick >= 0 ? streamsAt(c.seed, song.pick) : undefined;
			const replay = realizeAccomp({
				plan: song.plan,
				streams,
				edo: c.edo,
				colorLine,
			});
			const unpinnedReplay = realizeAccomp({
				plan: withoutCompHits(song.plan),
				streams: song.pick >= 0 ? streamsAt(c.seed, song.pick) : undefined,
				edo: c.edo,
				colorLine,
			});
			if (JSON.stringify(replay.tracks) !== JSON.stringify(song.tracks))
				bad.push(`${where}: 記録つきの計画を鳴らし直すと音が違う`);
			if (JSON.stringify(unpinnedReplay.tracks) !== JSON.stringify(song.tracks))
				bad.push(`${where}: 記録を消した計画を鳴らし直すと音が違う`);
			if (
				JSON.stringify(replay.compHits) !==
				JSON.stringify(song.plan.regions.map((r) => r.compHits))
			)
				bad.push(`${where}: 鳴らし直した記録が違う`);
			// 候補 0 は overrides.plan（種の最初の乱数列で鳴らす）でも同じ曲になる
			if (song.pick === 0) {
				viaOverrides++;
				const again = composeAccomp({
					random: seededRandom(c.seed),
					edo: c.edo,
					colorLine,
					overrides: { plan: song.plan },
				});
				if (JSON.stringify(again.plan) !== JSON.stringify(song.plan))
					bad.push(`${where}: overrides.plan で記録つきの計画が変わる`);
				if (
					stripCompose(accompToMml(again, { seed: c.seed })) !==
					stripCompose(accompToMml(song, { seed: c.seed }))
				)
					bad.push(`${where}: overrides.plan で鳴らし直すと MML が違う`);
			}
		}
	ok(
		`${cases.length * 4} 曲（候補 0・候補 2・保険の計画・色の線なし、31平均律を含む）で、曲の計画は記録（style・archetype・mix・全区間の compHits）を全部持ち、同じ乱数列で鳴らし直すと記録つきでも記録を消しても同じ音・同じ記録。候補 0 の ${viaOverrides} 曲は overrides.plan でも同じ計画・同じ MML（#compose のほか）`,
		bad.length === 0 && viaOverrides > 0,
		bad.slice(0, 3),
	);

	// 記録に従う: 1小節だけ打ち方を差し替える
	const region = (p: AccompPlan, role: AccompRole): AccompRegion => {
		const r = p.regions.find((x) => x.role === role);
		if (!r) throw new Error(`区間 ${role} が無い`);
		return r;
	};
	{
		const p = clone(FB_PLAN);
		const home = region(p, "home");
		const lift = region(p, "lift");
		if (home.compHits && lift.compHits) {
			home.compHits[0] = "long";
			lift.compHits[1] = "short2";
		}
		const base = realizeAccomp({ plan: FB_PLAN });
		const r = realizeAccomp({ plan: p });
		const compAt = (x: typeof r, bar: number): string =>
			x.notes.comp
				.filter((n) => n.bar === bar)
				.map((n) => `${n.pos16}+${n.len16}`)
				.join(" ");
		const liftBar = lift.startBar + 1;
		const others = (x: typeof r): string =>
			JSON.stringify(
				x.notes.comp.filter((n) => n.bar !== 0 && n.bar !== liftBar),
			);
		ok(
			"実現の段は記録に従う: home の1小節目を long、lift の2小節目を short2 にすると、その2小節だけ打ち方が変わり（全音符・8分の2打）、記録もそのとおり",
			compAt(r, 0) === "0+16 0+16 0+16" &&
				compAt(base, 0) === "0+2 0+2 0+2 8+2 8+2 8+2" &&
				compAt(r, liftBar) === "0+2 0+2 0+2 8+2 8+2 8+2" &&
				compAt(base, liftBar) === "8+2 8+2 8+2" &&
				others(r) === others(base) &&
				r.compHits[0][0] === "long" &&
				r.compHits[5][1] === "short2",
			{ home0: compAt(r, 0), lift1: compAt(r, liftBar) },
		);
	}

	// 記録が壊れているとき
	{
		const unknownId = clone(FB_PLAN);
		const h = region(unknownId, "home").compHits;
		if (h) h[3] = "nope";
		const shortPins = clone(FB_PLAN);
		region(shortPins, "lift").compHits?.pop();
		const badMix = clone(FB_PLAN);
		badMix.mix = "nope";
		const throws = (f: () => unknown): boolean => {
			try {
				f();
				return false;
			} catch {
				return true;
			}
		};
		ok(
			"記録が壊れていたら: 表に無い打ち方・小節数と合わない記録は、実現の段が例外、計画の段が関門「表現」で落とす。表に無いミックスは入口が例外、計画の段が「表現」",
			throws(() => realizeAccomp({ plan: unknownId })) &&
				throws(() => realizeAccomp({ plan: shortPins })) &&
				planViolations(unknownId).some((v) => v.gate === "expression") &&
				planViolations(shortPins).some((v) => v.gate === "expression") &&
				throws(() => composeAccomp({ overrides: { plan: badMix } })) &&
				planViolations(badMix).some((v) => v.gate === "expression"),
		);
		const otherStyle = clone(FB_PLAN);
		otherStyle.style = "nope";
		const otherArchetype = clone(FB_PLAN);
		otherArchetype.archetype = "nope";
		ok(
			'スタイルと型の記録: 知らないスタイル・型は例外、style と overrides.plan.style が違えば例外、style を省けば fb（style: "fb" と同じ曲）',
			throws(() => composeAccomp({ style: "nope" })) &&
				throws(() => realizeAccomp({ plan: otherStyle })) &&
				throws(() => realizeAccomp({ plan: otherArchetype })) &&
				throws(() =>
					composeAccomp({ style: "other", overrides: { plan: FB_PLAN } }),
				) &&
				JSON.stringify(composeAccomp({ random: seededRandom(5) })) ===
					JSON.stringify(
						composeAccomp({ random: seededRandom(5), style: "fb" }),
					),
		);
	}
	ok(
		"曲の mix は計画の mix（fb）のミックスの写しで、スタイルの宣言（fb.space.mml）どおり",
		(() => {
			const s = composeAccomp({ random: seededRandom(3) });
			return (
				s.plan.mix === "fb" &&
				JSON.stringify(s.mix) === JSON.stringify(ACCOMP_MIX) &&
				s.mix !== ACCOMP_MIX
			);
		})(),
	);
}

console.log(failed === 0 ? "\nall ok" : `\n${failed} failed`);
if (failed > 0) process.exit(1);
