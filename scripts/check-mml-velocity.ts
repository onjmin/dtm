/**
 * 音符ごとの強弱（v）が、書き出し・DAW の読み込み・再生専用プレイヤー・MIDI 書き出しを
 * 通しても保たれるか（`docs/accomp-compose.md` §8・§12.1）。
 *
 * 2.1.29 までは、MML を読み書きするたびに音符ごとの v がトラックごとに1値へ潰れていた。
 *
 * - 書き出し（`MMLCore.generateMML`）… 先頭に `v<トラック音量>` を1回出すだけで、音符の velocity を見ない
 * - DAW の読み込み … 全音符を既定値に戻し、トラック音量を**最後の v** にする
 * - 再生専用プレイヤー … トラック全体を**先頭の v** で平らにする
 *
 * 規則は `src/mml/mml-velocity.ts` に1か所で置いた。DAW とプレイヤーは Node で読めないので、
 * 呼び出し側は1行にとどめ、その関数をここで検算する。
 *
 * 使い方: `npx tsx scripts/check-mml-velocity.ts [--file <MMLファイル>]`
 * `--file` を付けると、そのファイルを DAW と同じ手順で往復させて v の種類数を表示する
 * （tmp/ の手本など。ファイルが無ければ飛ばしたと表示する）。
 */

import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

// `src/mml/mml-parser.ts` は歌詞解析のために `src/voice/lyrics.ts` を、その先で歌唱合成エンジン
// @onjmin/koe（ブラウザ専用）を読む。ノート配置しか触らないので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { parseMML } =
	require("../src/mml/mml-parser") as typeof import("../src/mml/mml-parser");
const { MMLCore } =
	require("../src/mml/mml-core") as typeof import("../src/mml/mml-core");
const {
	bakeTrackVelocity,
	chordVelocity,
	effectiveVelocity,
	playerTrackVelocity,
	splitPlacementVelocities,
	splitTrackVelocity,
} = require("../src/mml/mml-velocity") as typeof import("../src/mml/mml-velocity");
const { exportMIDI } =
	require("../src/io/midi-io") as typeof import("../src/io/midi-io");
const { goldenCases } =
	require("./fixtures/mml-velocity-golden-cases") as typeof import("./fixtures/mml-velocity-golden-cases");
type Note = import("../src/types").Note;
type RenderConfig = import("../src/types").RenderConfig;
type MMLNotePlacement = import("../src/mml/mml-parser").MMLNotePlacement;
type MMLCoreT = InstanceType<typeof MMLCore>;

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	if (a === b) {
		console.log(`  ok   ${label}`);
		return;
	}
	console.error(`  NG   ${label}\n       got    ${a}\n       expect ${b}`);
	failed++;
};

const configFor = (edo: number): RenderConfig => ({
	stepsPerBar: 192,
	keyCount: 128,
	pitchRangeStart: 0,
	unitsPerRow: 372 / edo,
	keyHeight: 12,
	stepWidth: 2,
	edo,
});
const newCore = (volume: number, edo = 12): MMLCoreT => {
	const config = configFor(edo);
	return new MMLCore(
		{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
		volume,
		() => config,
	);
};

// ============================================================
console.log("1. 純関数");
// ============================================================
{
	// 2音の全組（0..127 × 0..127）。T = min(100, 大きい方) が 0〜100 のすべてを通り、
	// 最大が100を超える列・全部0の列も含む。
	let bad = 0;
	let firstBad = "";
	for (let a = 0; a <= 127; a++) {
		for (let b = 0; b <= 127; b++) {
			const vs = [a, b];
			const s = splitTrackVelocity(vs, 77);
			const back = s.velocities.map((r) => effectiveVelocity(s.volume, r));
			if (back[0] !== a || back[1] !== b || s.volume > 100) {
				bad++;
				if (!firstBad) firstBad = `${a},${b} → ${JSON.stringify(s)}`;
			}
		}
	}
	check(`2音の全組で v に戻る（${firstBad || "全 16384 組"}）`, bad, 0);

	// T ∈ 1..127 を狙った列（最大 T の音と、0..127 の全 v）。T>100 は T=100 に丸まる。
	let badT = 0;
	for (let t = 1; t <= 127; t++) {
		const vs = Array.from({ length: 128 }, (_, v) => Math.min(v, t));
		vs.push(t);
		const s = splitTrackVelocity(vs, 0);
		if (s.volume !== Math.min(100, t)) badT++;
		s.velocities.forEach((r, i) => {
			if (effectiveVelocity(s.volume, r) !== vs[i]) badT++;
		});
		// いちばん強い音が相対100（T ≤ 100 のとき）
		if (t <= 100 && Math.max(...s.velocities) !== 100) badT++;
		if (Math.max(...s.velocities) > 127) badT++;
	}
	check("最大が T の列で、T・往復・相対100が期待どおり（T=1..127）", badT, 0);

	// 乱数の長い列（線形合同法。実行環境に依らない）
	let seed = 12345;
	const rand = (): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	let badR = 0;
	for (let trial = 0; trial < 2000; trial++) {
		const top = Math.floor(rand() * 128);
		const vs = Array.from({ length: 1 + Math.floor(rand() * 40) }, () =>
			Math.floor(rand() * (top + 1)),
		);
		const s = splitTrackVelocity(vs, 100);
		s.velocities.forEach((r, i) => {
			if (effectiveVelocity(s.volume, r) !== vs[i]) badR++;
		});
	}
	check("乱数の列 2000 本で v に戻る", badR, 0);

	check("空の列は fallback", splitTrackVelocity([], 58), {
		volume: 58,
		velocities: [],
	});
	check(
		"全部0は T=0・相対100（割り算しない）",
		splitTrackVelocity([0, 0], 70),
		{
			volume: 0,
			velocities: [100, 100],
		},
	);
	check("最大が100超えは T=100・velocity=v", splitTrackVelocity([66, 102], 0), {
		volume: 100,
		velocities: [66, 102],
	});
	check("v が1つだけ（≤100）は T=v・相対100", splitTrackVelocity([80, 80], 0), {
		volume: 80,
		velocities: [100, 100],
	});
	check("effectiveVelocity(127,127) = 127", effectiveVelocity(127, 127), 127);
	check("effectiveVelocity(100,127) = 127", effectiveVelocity(100, 127), 127);
	check(
		"effectiveVelocity(76) = 76（velocity 省略=100）",
		effectiveVelocity(76),
		76,
	);
	check("effectiveVelocity(0,127) = 0", effectiveVelocity(0, 127), 0);

	// placements 版（DAW の読み込み）: v の無いトラックは volumes に入らない
	const ps = [
		{ trackIndex: 0, velocity: 50 },
		{ trackIndex: 1, velocity: 100 },
		{ trackIndex: 0, velocity: 86 },
		{ trackIndex: 1, velocity: 100 },
	];
	const sp = splitPlacementVelocities(
		ps,
		new Map([
			[0, 86],
			[3, 70],
		]),
	);
	check("placements: 並びを保って相対化", sp.velocities, [58, 100, 100, 100]);
	check(
		"placements: T はトラックごと。v の無いトラック1は入らず、音符の無いトラック3は最後の v",
		[...sp.volumes.entries()],
		[
			[0, 86],
			[3, 70],
		],
	);
}

// ============================================================
console.log(
	"2. 互換（全音符が velocity 100 の書き出しは 2.1.29 と1バイトも変わらない）",
);
// ============================================================
{
	const golden = JSON.parse(
		readFileSync(join(__dirname, "fixtures/mml-velocity-golden.json"), "utf8"),
	) as Record<string, string>;
	const cases = goldenCases();
	check("golden のケース数", Object.keys(golden).length, cases.length);
	let same = 0;
	for (const c of cases) {
		const got = newCore(c.volume, c.edo).getMMLFromNotes(
			c.notes,
			c.tempo,
			c.volume,
		);
		if (got === golden[c.name]) same++;
		else check(`golden: ${c.name}`, got, golden[c.name]);
	}
	check(`golden と完全一致（${same}/${cases.length}）`, same, cases.length);

	// 未設定と 100 を混ぜても同じ（上の golden も混ぜてある。ここは明示の対照）
	const core = newCore(88);
	const plain: Note[] = [0, 48, 96].map((s, id) => ({
		id,
		startStep: s,
		durationSteps: 48,
		pitchUnits: (1860 + id * 62) as Note["pitchUnits"],
	}));
	const with100 = plain.map((n) => ({ ...n, velocity: 100 }));
	check(
		"velocity 未設定と 100 で同じ書き出し",
		core.getMMLFromNotes(with100, 120, 88),
		core.getMMLFromNotes(plain, 120, 88),
	);
	check(
		"v は先頭の1つだけ",
		core.getMMLFromNotes(plain, 120, 88),
		"t120 v88 o4c4 d4 e4",
	);
}

// ============================================================
// DAW の読み込み→書き出しの再現（daw.ts の loadMML と getMML().full の該当部分と同じ手順）
// ============================================================

type DawTrack = { volume: number; core: MMLCoreT };
const DAW_DEFAULT_VOLUMES = [100, 95, 88, 76, 100, 100, 100, 100];

/** daw.ts の loadMML と同じ: parse → splitPlacementVelocities → volume と addNote。 */
const dawLoad = (mml: string, trackCount: number): DawTrack[] => {
	const tracks: DawTrack[] = Array.from({ length: trackCount }, (_, i) => ({
		volume: DAW_DEFAULT_VOLUMES[i] ?? 100,
		core: newCore(DAW_DEFAULT_VOLUMES[i] ?? 100),
	}));
	const { placements, trackVelocity } = parseMML(mml, {
		stepsPerBar: 192,
		clampTrackCount: trackCount,
	});
	for (const t of tracks) {
		t.core.clearNotesWithoutHistory();
		t.core.setLoadMode(true);
	}
	const split = splitPlacementVelocities(placements, trackVelocity);
	tracks.forEach((t, i) => {
		const v = split.volumes.get(i);
		if (v !== undefined && v !== t.volume) {
			t.volume = v;
			t.core.setVolume(v);
		}
	});
	placements.forEach((p, k) => {
		tracks[p.trackIndex]?.core.addNote(p.startStep, p.pitchUnits, {
			noteLengthSteps: p.durationSteps,
			velocity: split.velocities[k],
		});
	});
	for (const t of tracks) t.core.setLoadMode(false);
	return tracks;
};

/** daw.ts の getMML() の本体（メタ行・歌詞行を除く）と同じ組み方。 */
const dawExport = (
	tracks: DawTrack[],
	bpm: number,
): { full: string; minified: string } => {
	const full: string[] = [];
	const mini: string[] = [];
	tracks.forEach((t, i) => {
		const notes = t.core.getNotes();
		if (notes.length === 0) return;
		const mml = t.core.getMMLFromNotes(notes, bpm, t.volume).trim();
		full.push(`@${i} ${mml}`);
		mini.push(`@${i}${mml.replace(/\s+/g, "")}`);
	});
	return {
		full: [...full, "#end;"].join(";\n"),
		minified: [...mini, "#end;"].join(";"),
	};
};

/** 比べやすい形: トラック:開始:音高/長さ@v を並べ替えたもの。 */
const noteKeys = (placements: MMLNotePlacement[]): string[] =>
	placements
		.map(
			(p) =>
				`${p.trackIndex}:${p.startStep}:${p.pitchUnits}/${p.durationSteps}@${p.velocity}`,
		)
		.sort();
const vKinds = (placements: MMLNotePlacement[]): Record<number, number> => {
	const kinds = new Map<number, Set<number>>();
	for (const p of placements) {
		const set = kinds.get(p.trackIndex) ?? new Set();
		set.add(p.velocity);
		kinds.set(p.trackIndex, set);
	}
	return Object.fromEntries(
		[...kinds.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([k, s]) => [k, s.size]),
	);
};

// ============================================================
console.log("3. 往復（fb の v の付け方を模した数小節）");
// ============================================================
// @0 は `v0` ヘッダの後に v34/36 の長い音、@1 は v44〜86 の分散、@2 は v66〜102 の低音
// （v>100 を含む）、@3 は v25〜56 の和音（' と [ の両記法）、@4 は音符の無いトラック、
// @5 は v が1つも無いトラック、@6 は v より前に音符があるトラック。
const FB_LIKE = [
	"@0 t112 v0 r1 r2 v36o5f#2 e2. r4 v34c2. r4 e2 d#2",
	[
		"@1 v68o4e8 v58b16 v52g#16 v64b8 v58g#8 v68e8 v58o5f#16 v52o4b16 v64o5f#8 v58o4b8",
		"v70e8 v60o5c#16 v54o4a16 v66o5c#8 v60o4a8 v70e8 v60o5e16 v54o4a16 v66o5e8 v60o4g#8",
		"v44o3b16 v47>d#16 v50f#16 v53b16 v86>d#8 v80c#8 v76<b8 v72a8 v66g#8 v62f#8 v56e4",
	].join(" "),
	"@2 v80o2e8 v66e8 v74b8 v66e8 v102o1b4 v88>e4 v80o2c#8 v70c#8 v94a8 v70e8 v100f#2 v90b2",
	"@3 v35'o3g#o4c#o4e'8 r4 v25'o3g#o4c#o4e'8 r4 v40[a3c#4e4]4 v56[g#3b3d#4]4. r8 v30'o3ao4c#o4e'2",
	"@4 t112 v70",
	"@5 o4c4 e4 g4 >c4",
	"@6 o3c8 d8 v45e8 f8 v90g4 v45a4",
].join(";\n");
{
	const orig = parseMML(FB_LIKE);
	check("元の v の種類数（トラック別）", vKinds(orig.placements), {
		0: 2,
		1: 18,
		2: 9,
		3: 5,
		5: 1,
		6: 3,
	});

	// §12.1 の手順そのまま: parseMML → splitTrackVelocity → getMMLFromNotes(notes, bpm, T) → parseMML
	const lines: string[] = [];
	for (let track = 0; track <= 6; track++) {
		const ps = orig.placements.filter((p) => p.trackIndex === track);
		const split = splitTrackVelocity(
			ps.map((p) => p.velocity),
			orig.trackVelocity.get(track) ?? 100,
		);
		const notes: Note[] = ps.map((p, id) => ({
			id,
			startStep: p.startStep,
			durationSteps: p.durationSteps,
			pitchUnits: p.pitchUnits,
			velocity: split.velocities[id],
		}));
		lines.push(
			`@${track} ${newCore(split.volume).getMMLFromNotes(notes, 112, split.volume)}`,
		);
	}
	const written = lines.join(";\n");
	const back = parseMML(written);
	check(
		"音符ごとの {開始, 音高, 長さ, v} が一致",
		noteKeys(back.placements),
		noteKeys(orig.placements),
	);
	check(
		"トラックごとの v の種類数が保たれる",
		vKinds(back.placements),
		vKinds(orig.placements),
	);
	check(
		"minified（空白なし）でも同じ",
		noteKeys(parseMML(written.replace(/[ \t]+/g, "")).placements),
		noteKeys(orig.placements),
	);
	check(
		"音符の無いトラックの v（最後の v）が残る",
		back.trackVelocity.get(4),
		70,
	);

	// DAW の読み込み→書き出し（advanced 相当の8トラック。畳み込み無し）
	const daw = dawLoad(FB_LIKE, 8);
	check(
		"DAW: 読み込み直後のトラック音量 T（@4 は最後の v、@5 は v が無いので既定のまま、@6 は v より前の音符が v100）",
		daw.map((t) => t.volume),
		[36, 86, 100, 56, 70, 100, 100, 100],
	);
	const out1 = dawExport(daw, 112);
	const back1 = parseMML(out1.full);
	check(
		"DAW: 書き出し→読み込みで音符ごとの v が一致",
		noteKeys(back1.placements),
		noteKeys(orig.placements),
	);
	check(
		"DAW: minified も一致",
		noteKeys(parseMML(out1.minified).placements),
		noteKeys(orig.placements),
	);
	// キープ→入れ替えのように、書き出したものを読み戻して書き出しても文字列が変わらない
	const out2 = dawExport(dawLoad(out1.full, 8), 112);
	check("DAW: 2回目の書き出しが1回目と文字列で一致", out2.full, out1.full);
	check("DAW: minified も一致（2回目）", out2.minified, out1.minified);
	// v は値が変わるところにだけ書く（同じ値を繰り返さない・v を2つ並べない）
	const redundantV = out1.full.split(";\n").filter((line) => {
		let last = "";
		let prevWasV = false;
		for (const tok of line.split(/\s+/)) {
			if (/^v\d+$/.test(tok)) {
				if (tok === last || prevWasV) return true;
				last = tok;
				prevWasV = true;
			} else prevWasV = false;
		}
		return false;
	});
	check("DAW: 余計な v を書かない", redundantV, []);
	const firstTrack = out1.full.split(";\n")[1];
	check(
		"DAW: 先頭の v は最初の音符の v（@1 は v86 v68 と2つ並べない）",
		firstTrack.startsWith("@1 t112 v68 "),
		true,
	);
}

// ============================================================
console.log("3b. v が1つだけの旧 MML（DAW の書き出し形式）はそのまま往復する");
// ============================================================
{
	const OLD = [
		"@0 t120 v127 o4c4 d4 e4 f4",
		"@1 t120 v80 'o4co4eo4g'2 r2 o3c1",
		"@2 t120 v0 o2c1",
		"@3 t120 v100 o5c8 d8 e4",
	].join(";\n");
	const daw = dawLoad(`${OLD};\n#end;`, 4);
	check(
		"T は v（≤100）、v127 のトラックは T=100",
		daw.map((t) => t.volume),
		[100, 80, 0, 100],
	);
	check(
		"v ≤ 100 のトラックの音符は相対100（従来と同じ状態）",
		[1, 2, 3].map((i) => daw[i].core.getNotes().map((n) => n.velocity)),
		[[100, 100, 100, 100], [100], [100, 100, 100]],
	);
	check(
		"v127 のトラックは音符が velocity 127（音量は同じ・明るさだけ上がる）",
		daw[0].core.getNotes().map((n) => n.velocity),
		[127, 127, 127, 127],
	);
	check(
		"書き出しが元の文字列と一致",
		dawExport(daw, 120).full,
		`${OLD};\n#end;`,
	);
}

// ============================================================
console.log("4. 和音");
// ============================================================
{
	const core = newCore(80);
	const notes: Note[] = [
		{
			id: 0,
			startStep: 0,
			durationSteps: 48,
			pitchUnits: 1860 as Note["pitchUnits"],
			velocity: 50,
		},
		{
			id: 1,
			startStep: 48,
			durationSteps: 48,
			pitchUnits: 1860 as Note["pitchUnits"],
			velocity: 60,
		},
		{
			id: 2,
			startStep: 48,
			durationSteps: 48,
			pitchUnits: 1984 as Note["pitchUnits"],
			velocity: 90,
		},
		{
			id: 3,
			startStep: 48,
			durationSteps: 48,
			pitchUnits: 2077 as Note["pitchUnits"],
			velocity: 70,
		},
	];
	check("chordVelocity は最大", chordVelocity(notes.slice(1)), 90);
	check(
		"chordVelocity の未設定は100",
		chordVelocity([{}, { velocity: 40 }]),
		100,
	);
	const written = core.getMMLFromNotes(notes, 120, 80);
	check(
		"混ざった和音は最大の v を1つだけ出す",
		written,
		"t120 v40 o4c4 v72 'o4co4eo4g'4",
	);
	check(
		"v の後の ' 和音を読める（minified も）",
		parseMML(written.replace(/\s+/g, "")).placements.map((p) => p.velocity),
		[40, 72, 72, 72],
	);
	check(
		"v の後の [ 和音を読める",
		parseMML("@0 o4 v50[ceg]4 v60c4").placements.map((p) => p.velocity),
		[50, 50, 50, 60],
	);
}

// ============================================================
console.log("5. プレイヤーの式（mml-player.ts の playerTrackVelocity）");
// ============================================================
{
	let bad = 0;
	let worst = 0;
	for (const trackVolume of [0, 37, 80, 100]) {
		for (const vs of [
			[58, 72, 44, 86, 50],
			[66, 102, 80, 74],
			[25, 56, 40],
			[0, 0],
			[127, 127],
			[100, 100],
		]) {
			const s = playerTrackVelocity(trackVolume, vs);
			vs.forEach((v, i) => {
				// 発音音量: (volume/100) × (velocity/127) ≒ (trackVolume/100) × (v/127)
				const got = (s.volume / 100) * (s.velocities[i] / 127);
				const expect = (trackVolume / 100) * (v / 127);
				const err = Math.abs(got - expect);
				worst = Math.max(worst, err);
				// 誤差は丸めの e（|T·e/100| < 0.5）ぶんだけ = 0.5/127 × trackVolume/100 未満
				if (err > ((0.5 / 127) * trackVolume) / 100 + 1e-12) bad++;
			});
		}
	}
	check(
		`発音音量が trackVolume/100 × v/127 と一致（最大誤差 ${worst.toFixed(5)}）`,
		bad,
		0,
	);
	// v が1つだけのトラック（v ≤ 100）は従来のプレイヤーと同じ（volume = trackVolume·v/100、velocity 100）
	check("v が1つだけ（≤100）は従来どおり", playerTrackVelocity(80, [50, 50]), {
		volume: 40,
		velocities: [100, 100],
	});
	check(
		"v の無いトラック（全部 v100）は従来どおり",
		playerTrackVelocity(80, [100]),
		{
			volume: 80,
			velocities: [100],
		},
	);
}

// ============================================================
console.log("6. 和音分解モード（トラック音量の焼き込み）");
// ============================================================
{
	const baked = bakeTrackVelocity(
		[{ velocity: 127 }, { velocity: 50 }, {}, { velocity: 0 }],
		127,
	);
	check(
		"velocity×音量/100 を 127 で止める",
		baked.map((n) => n.velocity),
		[127, 64, 127, 0],
	);
	check(
		"音量76・未設定は 76",
		bakeTrackVelocity([{}], 76).map((n) => n.velocity),
		[76],
	);
	// 焼き込んだ音符を音量100で書き出すと、元のトラックでの v と同じ
	const src: Note[] = [
		{
			id: 0,
			startStep: 0,
			durationSteps: 48,
			pitchUnits: 1860 as Note["pitchUnits"],
			velocity: 58,
		},
		{
			id: 1,
			startStep: 48,
			durationSteps: 48,
			pitchUnits: 1922 as Note["pitchUnits"],
			velocity: 100,
		},
	];
	check(
		"焼き込み→音量100の書き出しが、元の音量での書き出しと同じ v",
		parseMML(
			newCore(100).getMMLFromNotes(bakeTrackVelocity(src, 86), 120, 100),
		).placements.map((p) => p.velocity),
		parseMML(newCore(86).getMMLFromNotes(src, 120, 86)).placements.map(
			(p) => p.velocity,
		),
	);
}

// ============================================================
// 7. midi-io（Blob を読むので最後にまとめて）
// ============================================================

/** 書き出した .mid からノートオンの velocity を拾う（dtm の書き出しはランニングステータスを使わない）。 */
const noteOnVelocities = (bytes: Uint8Array): number[] => {
	const out: number[] = [];
	let i = 14; // MThd（14バイト）の後
	while (i + 8 <= bytes.length) {
		const len =
			(bytes[i + 4] << 24) |
			(bytes[i + 5] << 16) |
			(bytes[i + 6] << 8) |
			bytes[i + 7];
		let j = i + 8;
		const end = j + len;
		while (j < end) {
			while (bytes[j] & 0x80) j++; // デルタタイム（可変長）
			j++;
			const status = bytes[j++];
			if (status === 0xff) {
				j++; // 種別
				let n = 0;
				while (bytes[j] & 0x80) n = (n << 7) | (bytes[j++] & 0x7f);
				n = (n << 7) | (bytes[j++] & 0x7f);
				j += n;
			} else if ((status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0) {
				j += 1;
			} else {
				if ((status & 0xf0) === 0x90 && bytes[j + 1] > 0)
					out.push(bytes[j + 1]);
				j += 2;
			}
		}
		i = end;
	}
	return out;
};

const checkMidi = async (): Promise<void> => {
	console.log("7. midi-io");
	const notes: Note[] = [127, 100, 50].map((velocity, id) => ({
		id,
		startStep: id * 48,
		durationSteps: 48,
		pitchUnits: (1860 + id * 31) as Note["pitchUnits"],
		velocity,
	}));
	const blob = exportMIDI({
		tracks: [
			{ notes, volume: 127 },
			{ notes: notes.map(({ velocity: _, ...n }) => n), volume: 76 },
			{ notes, volume: 0 },
		],
		bpm: 120,
		stepsPerBar: 192,
	});
	const vels = noteOnVelocities(new Uint8Array(await blob.arrayBuffer()));
	check(
		"ノートオンの velocity が 127 を超えない",
		Math.max(...vels) <= 127,
		true,
	);
	check(
		"velocity×音量/100 を 127 で止めた値（音量0は鳴らさない=ノートオフ扱い）",
		vels,
		[127, 127, 64, 76, 76, 76],
	);
};

// ============================================================
// 8. 任意: 実物のファイルで往復（DAW のシンプルモード＝4トラックと同じ手順）
// ============================================================
const checkFile = (): void => {
	const at = process.argv.indexOf("--file");
	if (at < 0) return;
	const path = process.argv[at + 1];
	console.log(`8. 実物の往復: ${path}`);
	if (!path || !existsSync(path)) {
		console.log("  skip ファイルが無いので飛ばした");
		return;
	}
	const mml = readFileSync(path, "utf8");
	const orig = parseMML(mml, { clampTrackCount: 4 });
	const daw = dawLoad(mml, 4);
	const bpm = orig.bpm ?? 120;
	const out = dawExport(daw, bpm);
	const back = parseMML(out.full, { clampTrackCount: 4 });
	console.log(
		`  info v の種類数 元 ${JSON.stringify(vKinds(orig.placements))} → 往復後 ${JSON.stringify(vKinds(back.placements))}`,
	);
	console.log(
		`  info 読み込み直後のトラック音量 T ${JSON.stringify(daw.map((t) => t.volume))}`,
	);
	check(
		"音符ごとの {開始, 音高, 長さ, v} が一致",
		noteKeys(back.placements),
		noteKeys(orig.placements),
	);
	check(
		"minified も一致",
		noteKeys(parseMML(out.minified, { clampTrackCount: 4 }).placements),
		noteKeys(orig.placements),
	);
	check(
		"2回目の書き出しが1回目と文字列で一致",
		dawExport(dawLoad(out.full, 4), bpm).full,
		out.full,
	);
	console.log(
		`  info 書き出しの長さ ${out.full.length} 文字（minified ${out.minified.length}）`,
	);
};

void (async () => {
	await checkMidi();
	checkFile();
	if (failed > 0) {
		console.error(`\n${failed} 件が期待と違う`);
		process.exit(1);
	}
	console.log("\n音符ごとの v: すべて期待どおり");
})();
