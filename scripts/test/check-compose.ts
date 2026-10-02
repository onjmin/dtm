/**
 * 自動作曲マクロ（`src/compose/compose.ts`）の検算。
 *
 * 「聴いて確かめる」ができない代わりに、生成物の性質を機械的に測って落とす。
 * 測る項目は、実際に人が聴いて「これは質が高い／単調だ」と評価した曲の差から
 * 逆算したもの（`src/compose/compose.ts` の冒頭コメント参照）。
 *
 *   pnpm test
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseChord } from "@onjmin/chord-parser";
import { UNITS_PER_OCTAVE, UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import { buildChordPlacements } from "../../src/chord/chords";
import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import {
	ANSWER_FIGURES,
	seededRandom as appSeededRandom,
	BASE_STEPS_PER_BAR,
	composeSong,
	SYNTH_PHRASES,
	durationEntropy,
	MELODY_HIGH,
	MELODY_LOW,
	MOTIF_CELLS,
	RHYTHM_CELLS,
	transposeChordName,
} from "../../src/compose/compose";
import {
	COMPOSE_KEYS,
	COMPOSE_MOOD_GROUPS,
	resolveComposeKey,
} from "../../src/compose/compose-keys";
import { structureFeatures } from "../../src/compose/compose-metrics";
import {
	COMPOSE_SCALE_IDS,
	COMPOSE_SCALES,
	corePcs,
	resolveCenter,
	scaleDegrees,
	scalePcs,
} from "../../src/compose/compose-scales";
import { STRUCTURE_TEMPLATES } from "../../src/compose/compose-sections";
import { composeSkeleton } from "../../src/compose/compose-skeleton";
import {
	genericSubstitutes,
	SPLICE_BASS_HIGH,
	SPLICE_BASS_LOW,
} from "../../src/compose/compose-splice";
import {
	isSungKind,
	NON_SUNG_MAX_BARS,
	validateSectionBank,
} from "../../src/compose/section-bank-types";
import { validateSkeletons } from "../../src/compose/skeleton-types";
import {
	DRUM_PATTERNS,
	resolveDrumPattern,
} from "../../src/instruments/drum-config";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { loadSkeletons, localExperimentData } from "../corpus/skeleton-data";
import { FIXTURE_SKELETONS } from "./fixtures/skeleton-fixture";

const KAIWAI_SKELETONS = loadSkeletons();
const LOCAL = localExperimentData();
const STEPS_PER_BAR = 192;
const BARS = 16;

let failures = 0;

const check = (label: string, ok: boolean, detail: string): void => {
	if (ok) return;
	failures++;
	console.error(`  ✗ ${label}: ${detail}`);
};

/** 決定的に回すための線形合同法の乱数。seed ごとに違う曲が出る。 */
const seededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

// ============================================================
// 1. コード進行 → 伴奏ノートの回帰テスト
//    （全コードがC系へ潰れていた不具合の再発防止）
// ============================================================

console.log("● コード進行 → 伴奏の構成音");
{
	const NAMES = [
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
	const pc = (u: number) =>
		NAMES[((Math.round(u / UNITS_PER_SEMITONE) % 12) + 12) % 12];
	const expected: Record<string, string[]> = {
		Am: ["A", "C", "E"],
		F: ["F", "A", "C"],
		C: ["C", "E", "G"],
		G: ["G", "B", "D"],
		Dm: ["D", "F", "A"],
		E: ["E", "G#", "B"],
		Em7: ["E", "G", "B", "D"],
		D7: ["D", "F#", "A", "C"],
		// 界隈曲テンプレートの進行プールで初めて使う綴り（増三和音・♭VI の M7/m7・半減七・裏コード）。
		"E+": ["E", "G#", "C"],
		AbM7: ["G#", "C", "D#", "G"],
		Abm7: ["G#", "B", "D#", "F#"],
		"Bm7-5": ["B", "D", "F", "A"],
		Db7: ["C#", "F", "G#", "B"],
	};
	const chordStr = Object.keys(expected).join("|");
	const placements = buildChordPlacements({
		chordStr,
		patternType: "block",
		rootShift: 0,
		bpm: 120,
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
	});
	Object.keys(expected).forEach((name, bar) => {
		const got = placements
			.filter((p) => Math.floor(p.startStep / STEPS_PER_BAR) === bar)
			.sort((a, b) => a.pitchUnits - b.pitchUnits)
			.map((p) => pc(p.pitchUnits));
		check(
			`${name} の構成音`,
			JSON.stringify(got) === JSON.stringify(expected[name]),
			`期待 ${expected[name].join(",")} / 実際 ${got.join(",")}`,
		);
	});

	// 31平均律では綴りが分かれる。D7 の F# は増4度(15ステップ)で、
	// 減5度(16ステップ)へ丸まっていないこと。
	const p31 = buildChordPlacements({
		chordStr: "C|D7",
		patternType: "block",
		rootShift: 0,
		bpm: 120,
		stepsPerBar: STEPS_PER_BAR,
		edo: 31,
	});
	const c31 = p31
		.filter((p) => p.startStep < STEPS_PER_BAR)
		.map((p) => p.pitchUnits / 12);
	const d31 = p31
		.filter((p) => p.startStep >= STEPS_PER_BAR)
		.map((p) => p.pitchUnits / 12);
	check(
		"31平均律 C の長3度=10ステップ・完全5度=18ステップ",
		c31[1] - c31[0] === 10 && c31[2] - c31[0] === 18,
		`実際 ${c31.map((v) => v - c31[0]).join(",")}`,
	);
	// D7 の F# は C から見て増4度。31平均律では増4度=15ステップ・減5度=16ステップに
	// 分かれるので、Gb(16) へ丸まっていないことを絶対位置で確かめる。
	check(
		"31平均律 D7 の F# が増4度=15ステップ（減5度16へ丸めていない）",
		d31[1] % 31 === 15,
		`実際 ${d31[1] % 31}`,
	);
	check(
		"31平均律 D7 の D→F# が長3度=10ステップ",
		d31[1] - d31[0] === 10,
		`実際 ${d31[1] - d31[0]}`,
	);
}

// ============================================================
// 1.5 リズム型の合計が必ず1小節か
//
//     セルの数値を手で足し合わせて書いているので、1つでも合計を間違えると
//     その型を引いた曲だけノートが小節からはみ出す。実際 [EIGHTH, DOT_QUARTER,
//     EIGHTH, QUARTER, QUARTER] を 216ステップで書いてしまい、200曲中1曲だけが
//     壊れる、という形で表面化した。型は増え続けるので機械で検算する。
// ============================================================

console.log("● リズム型の合計");
{
	for (const [label, cells] of [
		["RHYTHM_CELLS", RHYTHM_CELLS],
		["MOTIF_CELLS", MOTIF_CELLS],
	] as const) {
		cells.forEach((cell, i) => {
			const total = cell.value.reduce((sum, v) => sum + Math.abs(v), 0);
			check(
				`${label}[${i}] の合計が1小節`,
				total === BASE_STEPS_PER_BAR,
				`${total}/${BASE_STEPS_PER_BAR} (${cell.value.join(",")})`,
			);
		});
	}
	// 合いの手の言い回しは小節に収まればよい（隙間へ差し込むので合計は可変）。
	ANSWER_FIGURES.forEach((figure, i) => {
		const total = figure.reduce((sum, v) => sum + Math.abs(v), 0);
		check(
			`ANSWER_FIGURES[${i}] が1小節に収まる`,
			total > 0 && total <= BASE_STEPS_PER_BAR,
			`${total}`,
		);
	});
	console.log(
		`  リズム型 ${RHYTHM_CELLS.length} / モチーフ ${MOTIF_CELLS.length} / 合いの手 ${ANSWER_FIGURES.length}`,
	);
}

// ============================================================
// 1.7 既存テンプレートの黄金値
//
//     テンプレートを足すときの約束は「共通経路に rnd() を足さない・順序を変えない」。
//     破ると既存の #seed から別の曲が出る。既存7構成 × アプリの種3つの生成物の sha256 を
//     fixtures/compose-golden.json と照合する（check-accomp-golden.ts と同じ作法）。
//     取り直しは --bless だけ。出力を**意図して**変えたときにしか取り直さない。
// ============================================================

console.log("● 既存テンプレートの黄金値");
{
	const BLESS = process.argv.includes("--bless");
	const FILE = join(__dirname, "fixtures", "compose-golden.json");
	const TEMPLATES: (string | undefined)[] = [
		undefined,
		"1chorus",
		"jpop_standard",
		"jpop_drop",
		"vocaloid",
		"verse_chorus",
		"game_loop",
	];
	const GOLDEN_SEEDS = [1, 4022250974, 3842857959];
	const sha = (s: string): string =>
		createHash("sha256").update(s).digest("hex");
	type Golden = {
		about: string;
		rows: Record<string, Record<string, string>>;
		/** 骨格借用（別エンジン）。共通経路の保証ではなく「出力が黙って変わらない」ための黄金値。 */
		skeleton: Record<string, Record<string, string>>;
	};
	const now: Golden = {
		about:
			"既存テンプレートの黄金値（scripts/test/check-compose.ts）。取り直しは npx tsx scripts/test/check-compose.ts --bless。出力を意図して変えたときだけ取り直す。skeleton は骨格借用（kaiwai_skeleton）の seed 1..3。",
		rows: {},
		skeleton: {},
	};
	const digest = (template: string | undefined, seed: number): string => {
		const song = composeSong({
			skeletons: KAIWAI_SKELETONS,
			...LOCAL,
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			template,
			baseKey: "any",
			scale: "auto",
			random: appSeededRandom(seed),
		});
		return sha(
			JSON.stringify({
				bpm: song.bpm,
				keyName: song.keyName,
				drum: song.drum,
				instrument: song.instrument,
				chordProgression: song.chordProgression,
				chordPattern: song.chordPattern,
				sections: song.sections.map((s) => [s.kind, s.bars]),
				melody: song.melody,
				submelody: song.submelody,
				bass: song.bass,
			}),
		);
	};
	for (const template of TEMPLATES) {
		const key = template ?? "default";
		now.rows[key] = {};
		for (const seed of GOLDEN_SEEDS)
			now.rows[key][String(seed)] = digest(template, seed);
	}
	// 骨格データは git に入れない（scripts/corpus/skeleton-data.ts）。無ければ骨格の黄金値は取らない・比べない
	const SKELETON_SEEDS = KAIWAI_SKELETONS.length > 0 ? [1, 2, 3] : [];
	now.skeleton.kaiwai_skeleton = {};
	for (const seed of SKELETON_SEEDS)
		now.skeleton.kaiwai_skeleton[String(seed)] = digest(
			"kaiwai_skeleton",
			seed,
		);
	if (BLESS) {
		writeFileSync(FILE, `${JSON.stringify(now, null, "\t")}\n`);
		console.log(`  黄金値を取り直した → ${FILE}`);
	} else if (!existsSync(FILE)) {
		check("黄金値ファイルがある", false, `${FILE} が無い（--bless で取る）`);
	} else {
		const old = JSON.parse(readFileSync(FILE, "utf8")) as Golden;
		let same = 0;
		for (const [key, seeds] of Object.entries(now.rows))
			for (const [seed, hash] of Object.entries(seeds)) {
				const ok = old.rows[key]?.[seed] === hash;
				if (ok) same++;
				check(
					`黄金値 ${key} seed=${seed}`,
					ok,
					"生成物が変わった（意図した変更なら --bless で取り直す）",
				);
			}
		console.log(
			`  ${TEMPLATES.length}構成 × ${GOLDEN_SEEDS.length}種: 一致 ${same}/${TEMPLATES.length * GOLDEN_SEEDS.length}`,
		);
		let sameSkel = 0;
		for (const [key, seeds] of Object.entries(now.skeleton))
			for (const [seed, hash] of Object.entries(seeds)) {
				const ok = old.skeleton?.[key]?.[seed] === hash;
				if (ok) sameSkel++;
				check(
					`黄金値（骨格借用） ${key} seed=${seed}`,
					ok,
					"生成物が変わった（意図した変更なら --bless で取り直す）",
				);
			}
		console.log(
			`  骨格借用 ${Object.keys(now.skeleton).length}構成 × ${SKELETON_SEEDS.length}種: 一致 ${sameSkel}/${Object.keys(now.skeleton).length * SKELETON_SEEDS.length}`,
		);
	}
}

// ============================================================
// 2. 作曲マクロの生成物
// ============================================================

/**
 * 1声部の基本形: 空でない・曲の長さに収まる・単音・重ならない。
 * 単音であること——和音になると「おまかせマスタリング」の役割推定が
 * 伴奏だと誤判定して楽器を取り違える（daw.ts の classifyTrackRole 参照）。
 */
const checkVoice = (
	tag: string,
	name: string,
	notes: { startStep: number; durationSteps: number }[],
	bars: number,
): void => {
	check(`${tag} ${name}が空でない`, notes.length > 0, "0音");
	const overshoot = notes.filter(
		(n) => n.startStep + n.durationSteps > bars * STEPS_PER_BAR,
	);
	check(
		`${tag} ${name}が曲の長さに収まる`,
		overshoot.length === 0,
		`${overshoot.length}音がはみ出し`,
	);
	const starts = notes.map((n) => n.startStep);
	check(
		`${tag} ${name}が単音`,
		new Set(starts).size === starts.length,
		"同時刻に複数の音がある",
	);
	// 隙間なく前の音が終わってから次が鳴ること
	const sorted = [...notes].sort((a, b) => a.startStep - b.startStep);
	const overlap = sorted.findIndex(
		(n, i) =>
			i > 0 &&
			n.startStep < sorted[i - 1].startStep + sorted[i - 1].durationSteps,
	);
	check(
		`${tag} ${name}が重ならない`,
		overlap === -1,
		`index ${overlap} で重複`,
	);
};

console.log("● 自動作曲の生成物");
const SEEDS = 200;
let entropySum = 0;
let restSum = 0;
let attemptsSum = 0;
let worstEntropy = Number.POSITIVE_INFINITY;
let scoreSum = 0;
let worstScore = Number.POSITIVE_INFINITY;

for (let seed = 1; seed <= SEEDS; seed++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		random: seededRandom(seed),
	});
	const tag = `seed=${seed}`;
	entropySum += song.stats.entropy;
	restSum += song.stats.restRatio;
	attemptsSum += song.stats.attempts;
	worstEntropy = Math.min(worstEntropy, song.stats.entropy);

	// --- ハード制約（これを外れた曲は「音楽として壊れている」） ---
	// しきい値の合否で採否を決めるのはここまで。残りは連続値の点数にして
	// 候補どうしを比べる方式へ変わった（src/compose/compose.ts の WEIGHTS 参照）ので、
	// 「休符率が0.09だから不合格」といった判定はもう行わない。
	check(
		`${tag} メロディが同じ音の連打になっていない`,
		song.stats.melodyRange >= 3,
		`${song.stats.melodyRange}半音`,
	);
	check(
		`${tag} サブメロが動いている`,
		song.stats.submelodyRange >= 2,
		`${song.stats.submelodyRange}半音`,
	);
	check(
		`${tag} 歌える範囲の跳躍`,
		song.stats.maxLeapSemitones <= 14,
		`${song.stats.maxLeapSemitones}半音`,
	);
	check(
		`${tag} 曲が休符だらけでない`,
		song.stats.restRatio <= 0.8,
		`${(song.stats.restRatio * 100).toFixed(1)}%`,
	);

	// --- 採点 ---
	// 総合点は「人間の曲として普通の範囲にどれだけ収まっているか」。
	// 候補40本から最良を選んでいるので、下限を大きく割ることは無い。
	check(
		`${tag} 総合点`,
		song.stats.score >= 0.6,
		`${song.stats.score.toFixed(3)}`,
	);
	scoreSum += song.stats.score;
	worstScore = Math.min(worstScore, song.stats.score);

	// --- 構造 ---
	for (const [name, notes] of [
		["メロディ", song.melody],
		["サブメロ", song.submelody],
		["ベース", song.bass],
	] as const)
		checkVoice(tag, name, notes, song.bars);

	// --- 小節線をまたぐ音（フレーズ）---
	// **「小節をはみ出さない」ことは不変条件ではない。** 以前はここで各小節の最後の音が
	// 小節内に収まることを検算していたが、それはリズム型が1小節で閉じている実装を
	// なぞっていただけで、結果として小節線をまたぐ音が0.0%（参考曲は平均3.5%・最大32%）
	// になり、呼吸が1小節周期でリセットされていた。守るべきなのは
	// 「曲の終端をはみ出さない」「重ならない」の2つで、どちらも別に検算している。
	// ここではまたぎが長すぎないことだけを見る（1音で2小節を越えたら形が壊れている）。
	const tooLong = song.melody.filter(
		(n) => n.durationSteps > STEPS_PER_BAR + STEPS_PER_BAR / 2,
	);
	check(
		`${tag} 1音が1.5小節を超えない`,
		tooLong.length === 0,
		`${tooLong.length}音`,
	);

	// --- おまかせマスタリングの役割推定に乗るか ---
	// daw.ts の classifyTrackRole は「平均音高が C3(MIDI48) 未満ならベース」と判定する。
	// ベースがここを外すと楽器が当たらないので、生成側で保証しておく。
	const avgMidi = (ns: typeof song.bass) =>
		ns.reduce((s, n) => s + n.pitchUnits / UNITS_PER_SEMITONE, 0) / ns.length;
	check(
		`${tag} ベースの平均音高がC3未満`,
		avgMidi(song.bass) < 48,
		`${avgMidi(song.bass).toFixed(1)}`,
	);
	check(
		`${tag} メロディの平均音高がC3以上`,
		avgMidi(song.melody) >= 48,
		`${avgMidi(song.melody).toFixed(1)}`,
	);
	check(
		`${tag} サブメロの平均音高がC3以上`,
		avgMidi(song.submelody) >= 48,
		`${avgMidi(song.submelody).toFixed(1)}`,
	);
	// かつてここには「サブメロの密度 < 1.2音/拍」「平均音価 >= 1.5拍」という検査が
	// あった。おまかせマスタリングの役割推定（daw.ts の classifyTrackRole）が
	// **単音・低密度・長音価**でサブメロを判定していたため、その形を外すと伴奏だと
	// 誤判定されて楽器が変わってしまうからだった。
	//
	// daw.ts は simple モードではトラックIDをそのまま役割として使うようになり
	// （DECLARED_ROLE）、推定を通さなくなったので、この制約は消えた。合いの手・
	// ハモリ・対旋律といった密度の高い書法が選べるのはそのため。**この検査を
	// 復活させないこと**——復活させると、また書法が1種類に潰れる。

	// --- 調（rootShift）とノートが揃っているか ---
	// メロディ・サブメロ・ベースは生成側で移調済み、伴奏は rootShift を渡して展開する。
	// この2つがずれると曲全体が半音単位で不協和になるので、終止音で検算する。
	// 進行はハ長調で書かれているので、終止音は主音（C=0 か Am=9）を移調したもの。
	// セクション転調がある場合はそのセクションの keyShift も加味する。
	const lastNote = song.melody[song.melody.length - 1];
	const lastBar = Math.floor(lastNote.startStep / STEPS_PER_BAR);
	const lastSec = song.sections.find(
		(s) => lastBar >= s.startBar && lastBar < s.startBar + s.bars,
	);
	const lastKeyShift = lastSec?.keyShift ?? 0;
	const lastPc =
		(((Math.round(lastNote.pitchUnits / UNITS_PER_SEMITONE) -
			song.rootShift -
			lastKeyShift) %
			12) +
			12) %
		12;
	// 浮遊感の曲（{@link TonalPlan.floating}）は主音へ着地しないのが狙いなので、
	// 移調が揃っているかだけを別の形で見る（伴奏との照合は下のコード展開で行う）。
	if (!song.tonal.floating)
		check(
			`${tag} 終止音が調の主音（移調後）`,
			lastPc === 0,
			`移調 ${song.rootShift}+${lastKeyShift} 半音 / 終止音のハ長調換算 ${lastPc}`,
		);
	check(
		`${tag} テンポが妥当`,
		song.bpm >= 60 && song.bpm <= 200,
		`${song.bpm}`,
	);

	// --- コード進行が伴奏として展開できるか ---
	const chordNotes = buildChordPlacements({
		chordStr: song.chordProgression,
		patternType: song.chordPattern,
		rootShift: song.rootShift,
		bpm: 120,
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
	});
	check(`${tag} 伴奏が生成できる`, chordNotes.length > 0, "0音");
	const progBars = song.chordProgression.split("|");
	/**
	 * その小節の**最後の**和音。半小節で和音が動く曲（{@link HarmonicRhythm}）では
	 * 1小節に2和音入るので、終止の判定は末尾の和音を見る。
	 */
	const lastChordOf = (bar: string | undefined): string =>
		(bar ?? "").trim().split(/\s+/).at(-1) ?? "";
	check(
		`${tag} 進行が曲の長さと一致`,
		progBars.length === song.bars,
		`${progBars.length}小節 / 曲は${song.bars}小節`,
	);

	// --- セクション ---
	// **どこがイントロで、どこがサビなのかを持っていること。** これが無いと
	// どの小節も同じ密度・同じ音域で鳴り、聴き手が最初に掴む切り替わりが生まれない。
	check(`${tag} セクションがある`, song.sections.length > 0, "0個");
	const sectionBars = song.sections.reduce((sum, x) => sum + x.bars, 0);
	check(
		`${tag} セクションの合計が曲の長さ`,
		sectionBars === song.bars,
		`${sectionBars} / ${song.bars}`,
	);
	// セクションが隙間なく並んでいること。
	let expectedStart = 0;
	for (const section of song.sections) {
		check(
			`${tag} ${section.kind} が隙間なく並ぶ`,
			section.startBar === expectedStart,
			`開始${section.startBar} / 期待${expectedStart}`,
		);
		expectedStart += section.bars;
	}
	// サビの進行はAメロと違うこと（「サビで景色が変わる」効果の土台）。
	const barsOf = (kind: string): string =>
		song.sections
			.filter((x) => x.kind === kind)
			.flatMap((x) => progBars.slice(x.startBar, x.startBar + x.bars))
			.join("|");
	const verse = barsOf("verse");
	const chorus = barsOf("chorus");
	if (verse && chorus)
		check(`${tag} サビの進行がAメロと違う`, verse !== chorus, `A=${verse}`);
	// Bメロはサビへの助走なので、ドミナントで宙吊りにして終わる。
	// 平行調へ振ったセクションは主調のドミナントを通らない（明暗の入れ替えが目的）。
	const pre = song.sections.find((x) => x.kind === "prechorus");
	if (pre && !song.tonal.relativeKinds.includes("prechorus")) {
		const last = lastChordOf(progBars[pre.startBar + pre.bars - 1]);
		const expG = transposeChordName("G", pre.keyShift);
		const expG7 = transposeChordName("G7", pre.keyShift);
		check(
			`${tag} Bメロがドミナントで終わる`,
			last === expG || last === expG7,
			`${last} (期待 ${expG})`,
		);
	}
	// サビとアウトロは主音へ着地して締める。浮遊感の曲は解決しないのが狙いなので除く。
	for (const kind of ["chorus", "outro"]) {
		const sec = song.sections.find((x) => x.kind === kind);
		if (!sec || song.tonal.floating) continue;
		const last = lastChordOf(progBars[sec.startBar + sec.bars - 1]);
		const expC = transposeChordName("C", sec.keyShift);
		const expAm = transposeChordName("Am", sec.keyShift);
		check(
			`${tag} ${kind}が主音で終わる`,
			last === expC || last === expAm,
			`${last} (期待 ${expC}または${expAm})`,
		);
	}
}

// ============================================================
// 2.5 曲どうしの違い（バリエーション）
//
//     品質基準を全部満たしていても「同じ設計図の上で音名だけが違う曲」は量産できる。
//     実際、初版は 300曲を生成してもベースの配置が1種類・サブメロの配置も1種類しか
//     出なかった。1曲だけ見ていては気づけない種類の劣化なので、まとめて測って落とす。
// ============================================================

console.log("● 曲どうしの違い");
{
	const N = 200;
	const uniq = {
		progression: new Set<string>(),
		melody: new Set<string>(),
		bass: new Set<string>(),
		submelody: new Set<string>(),
		firstNote: new Set<number>(),
	};
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 7919),
		});
		/** 音高を抜いた「置き方」だけの指紋。ここが同じ曲は骨格が同じ。 */
		const layout = (ns: typeof song.bass) =>
			ns.map((n) => `${n.startStep}/${n.durationSteps}`).join(",");
		uniq.progression.add(song.chordProgression);
		uniq.melody.add(layout(song.melody));
		uniq.bass.add(layout(song.bass));
		uniq.submelody.add(layout(song.submelody));
		uniq.firstNote.add(song.melody[0].pitchUnits);
	}
	const ratios: [string, number, number][] = [
		["コード進行", uniq.progression.size, 0.5],
		["メロディの配置", uniq.melody.size, 0.9],
		["ベースの配置", uniq.bass.size, 0.2],
		["サブメロの配置", uniq.submelody.size, 0.2],
	];
	for (const [name, size, min] of ratios) {
		check(
			`${name}の多様性`,
			size / N >= min,
			`${N}曲中 ${size}種（下限 ${Math.ceil(min * N)}種）`,
		);
	}
	check(
		"メロディの開始音がばらける",
		uniq.firstNote.size >= 5,
		`${uniq.firstNote.size}種`,
	);
	console.log(
		`  ${N}曲: 進行${uniq.progression.size}種 / メロディ${uniq.melody.size}種 / ベース${uniq.bass.size}種 / サブメロ${uniq.submelody.size}種 / 開始音${uniq.firstNote.size}種`,
	);
}

// ============================================================
// 2.6 受け入れ基準が「曲の構造」を見ているか
//
//     初版の指標は7項目中5つが順序非依存で、**16小節の順番をシャッフルして曲を
//     破壊しても値が1つも動かなかった**（実測: entropy 1.925 → 1.925、
//     valueKinds 5 → 5、restRatio 0.039 → 0.039、range 15 → 15）。
//     つまり「曲かどうか」を一切測っていなかった。
//
//     この検査は、その状態への逆戻りを防ぐためにある。小節の順番を入れ替えたら
//     構造の指標が確かに悪化することを確かめる。ここが通らなくなったら、
//     指標がまた分布だけを見るものに戻っている。
// ============================================================

console.log("● 構造の指標が順序に反応するか");
{
	const toMetric = (
		ns: { startStep: number; pitchUnits: number; durationSteps: number }[],
	) =>
		ns
			.map((n) => ({
				startStep: n.startStep,
				pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
				durationSteps: n.durationSteps,
			}))
			.sort((a, b) => a.startStep - b.startStep);

	let degraded = 0;
	const TRIALS = 30;
	for (let seed = 1; seed <= TRIALS; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 104729),
		});
		const rnd = seededRandom(seed * 7 + 3);
		const order = [...Array(BARS).keys()];
		for (let i = BARS - 1; i > 0; i--) {
			const j = Math.floor(rnd() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		const shuffled = song.melody.map((n) => {
			const bar = Math.floor(n.startStep / STEPS_PER_BAR);
			return {
				...n,
				startStep:
					order.indexOf(bar) * STEPS_PER_BAR + (n.startStep % STEPS_PER_BAR),
			};
		});
		const opts = { stepsPerBar: STEPS_PER_BAR, bars: BARS };
		const before = structureFeatures(toMetric(song.melody), [], opts);
		const after = structureFeatures(toMetric(shuffled), [], opts);
		// 自己相似プロファイルは小節の並び順そのものなので、必ず動く。
		const moved =
			Math.abs(before.sim4 - after.sim4) +
			Math.abs(before.sim8 - after.sim8) +
			Math.abs(before.climaxPosition - after.climaxPosition);
		if (moved > 0.05) degraded++;
	}
	check(
		"小節をシャッフルすると構造の指標が動く",
		degraded >= TRIALS * 0.9,
		`${TRIALS}回中 ${degraded}回しか動かなかった（指標が順序を見ていない）`,
	);
	console.log(`  ${TRIALS}回中 ${degraded}回で構造の指標が変化`);
}

// ============================================================
// 2.55 フレーズ構造（2小節の楽句・問いと答え）
//
//     解説はどれも「モチーフは2小節、繰り返して4小節の小楽節、AABA等で並べる」
//     と書いている。初版はここが1小節単位で、2小節のまとまりが存在しなかった。
//     自己相似が lag4/lag8 で戻ってくること、フレーズの終わりが着地することを
//     機械で確かめる。
// ============================================================

console.log("● フレーズ構造");
{
	const N = 60;
	let sim4Sum = 0;
	let sim1Sum = 0;
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 7919),
		});
		const tag = `seed=${seed}`;
		const notes = song.melody.map((n) => ({
			startStep: n.startStep,
			pitchSemi: n.pitchUnits / UNITS_PER_SEMITONE,
			durationSteps: n.durationSteps,
		}));
		const f = structureFeatures(notes, [], {
			stepsPerBar: STEPS_PER_BAR,
			bars: song.bars,
		});
		sim4Sum += f.sim4;
		sim1Sum += f.sim1;
		// **4小節で形が戻ってくること。** 1曲ずつ lag4 > lag1 を要求はしない——
		// 2小節の楽句を「同じ型を2回」で作る曲では lag1 が高くて当然で、参考曲でも
		// lag1（0.48〜0.71）と lag4（0.57〜0.80）は重なっている。曲ごとには
		// 「小楽節が戻ってきている」ことだけを見て、大小関係は全体の平均で見る。
		// **通し作曲（`through`）には緩い下限を当てる。** 楽句を再現しないのがその型の
		// 中身で、反復の下側を開けるために足したもの（コーパスの sim4 の p05 は 0.437 で、
		// 生成系はそこへ届かず上に詰まっていた）。実測で 0.4 を下回るのは through の
		// 200曲中1曲だけ——狙って開けた裾なので、ここで落とすと型ごと使えなくなる。
		check(
			`${tag} 4小節で形が戻る`,
			f.sim4 >= (song.form === "through" ? 0.3 : 0.4),
			`lag4 ${f.sim4.toFixed(2)}`,
		);
		// フレーズの切れ目（2小節ごと）で息継ぎがあること。リフ型は上と同じ理由で除く。
		if (song.form !== "ostinato")
			check(
				`${tag} フレーズの切れ目で息継ぎ`,
				f.phraseBreath >= 0.1,
				`${f.phraseBreath.toFixed(2)}`,
			);
		// 楽句は2小節。**メロディのあるセクションの末尾**は必ずロングトーンか
		// 休符で受ける（歌手の息継ぎ）。小節番号で固定していた頃は、セクションの
		// 選び方で位置が変わると成立しなくなっていた。
		//
		// **リフ型（`form === "ostinato"`）には要求しない。** 同じ型を曲全体で回すのが
		// その作りで、セクションの切れ目は編曲（ドラム・楽器・レイヤ）が示す。
		// 参考コーパスのリフ曲も実際に息継ぎしない（イワシの phraseBreath は 0.00、
		// ヤツメ穴は 0.25）。ここを全曲に課すと、歌モノ以外を作れない生成系に戻る。
		const endBars =
			song.form === "ostinato"
				? []
				: song.sections
						.filter((x) => x.spec.melody)
						.map((x) => x.startBar + x.bars - 1);
		for (const bar of endBars) {
			const inBar = song.melody.filter(
				(n) =>
					n.startStep >= bar * STEPS_PER_BAR &&
					n.startStep < (bar + 1) * STEPS_PER_BAR,
			);
			if (inBar.length === 0) continue;
			const last = inBar[inBar.length - 1];
			const tail =
				(bar + 1) * STEPS_PER_BAR - (last.startStep + last.durationSteps);
			check(
				`${tag} bar${bar + 1} がセクションの切れ目として受ける`,
				last.durationSteps >= STEPS_PER_BAR / 4 || tail >= STEPS_PER_BAR / 8,
				`末尾の音 ${last.durationSteps}ステップ / 空き ${tail}`,
			);
		}
	}
	// 全体としては lag4 のほうが高いこと。ここが逆転していたら、4小節の小楽節が
	// 機能しておらず「隣どうしが似ているだけ」の曲を量産している。
	check(
		"平均では4小節周期の反復が勝つ",
		sim4Sum / N > sim1Sum / N,
		`lag1 ${(sim1Sum / N).toFixed(3)} / lag4 ${(sim4Sum / N).toFixed(3)}`,
	);
	console.log(
		`  ${N}曲: 自己相似 lag1 ${(sim1Sum / N).toFixed(2)} / lag4 ${(sim4Sum / N).toFixed(2)}`,
	);
}

// ============================================================
// 2.6 格子への乗り
//
//     参考曲（他作13本・自作91本）を192ステップの格子へ量子化して測ると、
//     **小節線をまたぐ音も16分格子から外れる音も中央値0%**だった。
//     一時期この逆（またぎ3.5%・格子外24%）を目標にして三連・スウィング・
//     弱起を入れたが、それは量子化せず生のtickで測った値で、演奏上のズレと
//     tickの丸めを拾っていただけだった。**この様式のメロディは格子の上に乗る。**
// ============================================================

console.log("● 格子への乗り");
{
	const N = 60;
	let notes = 0;
	let offGrid = 0;
	let cross = 0;
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 7919),
		});
		for (const n of song.melody) {
			notes++;
			if (n.startStep % (STEPS_PER_BAR / 16) !== 0) offGrid++;
			const bar = Math.floor(n.startStep / STEPS_PER_BAR);
			if (
				Math.floor((n.startStep + n.durationSteps - 1) / STEPS_PER_BAR) !== bar
			)
				cross++;
		}
		const over = song.melody.filter(
			(n) => n.startStep + n.durationSteps > song.bars * STEPS_PER_BAR,
		);
		check(
			`seed=${seed} 曲の終端をはみ出さない`,
			over.length === 0,
			`${over.length}音`,
		);
	}
	check("16分格子の上に乗る", offGrid === 0, `${offGrid}/${notes}音が格子外`);
	// J-POPの疾走感を作るため、小節線をまたぐシンコペーションタイが適度に生成されていること。
	check(
		"小節線をまたぐシンコペーションがある",
		cross > 0,
		`${cross}/${notes}音がまたぎ`,
	);
	console.log(`  ${N}曲: 格子外 ${offGrid}音 / 小節線またぎ ${cross}音`);
}

// ============================================================
// 2.65 変化音（調の外の音）
//
//     メロディは長らく音階の度数だけで組み立てられていて、`nearestChordTone` が
//     `E7` の `G#` を返してもその場で音階へ丸められていた。実測で非ダイアトニック音は
//     **40曲・約4000音を測って0音**。参考曲91本は音数比で中央値4%・p75で11%あり、
//     「どの曲も同じ音階をなぞっている＝調が固定に聞こえる」の実体がここだった。
//
//     変化音は**置けば良いというものではない**。和音構成音でもなく、順次で入って
//     順次で出るのでもない半音は、通り過ぎる音ではなく「調を外した音」として耳に残る。
//     実装当初はそれが変化音の45%を占めていたので、ここで0であることを検算する。
// ============================================================

console.log("● 変化音（調の外の音）");
{
	const N = 60;
	const DIATONIC = new Set([0, 2, 4, 5, 7, 9, 11]);
	let notes = 0;
	let chromatic = 0;
	let unresolved = 0;
	let songsWithChromatic = 0;
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 104729),
		});
		const progression = song.chordProgression.split("|");
		let inSong = 0;
		for (let i = 0; i < song.melody.length; i++) {
			const n = song.melody[i];
			notes++;
			const bar = Math.floor(n.startStep / STEPS_PER_BAR);
			const sec = song.sections.find(
				(s) => bar >= s.startBar && bar < s.startBar + s.bars,
			);
			const keyShift = sec?.keyShift ?? 0;
			// 生成はハ長調で行い、セクション転調(keyShift)と曲全体のrootShiftだけ移調してある。
			const semi = n.pitchUnits / UNITS_PER_SEMITONE;
			const pc =
				(((Math.round(semi) - song.rootShift - keyShift) % 12) + 12) % 12;
			if (DIATONIC.has(pc)) continue;
			chromatic++;
			inSong++;
			// 許されるのは「その瞬間の和音の構成音」か「順次で入って順次で出る短い音」。
			// **1小節に複数の和音が入る曲がある**（半小節進行）ので、小節の和音ではなく
			// その音の位置で鳴っている和音を見る。
			const inBar = progression[bar]?.trim().split(/\s+/) ?? ["C"];
			const slot = Math.min(
				inBar.length - 1,
				Math.floor(
					((n.startStep % STEPS_PER_BAR) / STEPS_PER_BAR) * inBar.length,
				),
			);
			let tones: number[] = [];
			try {
				tones = parseChord(inBar[slot] ?? "C").notes.map(
					(v) => ((v % 12) + 12) % 12,
				);
			} catch {}
			const localPc = (((Math.round(semi) - song.rootShift) % 12) + 12) % 12;
			if (tones.includes(localPc)) continue;
			const prev = song.melody[i - 1];
			const next = song.melody[i + 1];
			const stepIn =
				!prev || Math.abs(semi - prev.pitchUnits / UNITS_PER_SEMITONE) <= 2;
			const stepOut =
				!next || Math.abs(next.pitchUnits / UNITS_PER_SEMITONE - semi) <= 2;
			if (n.durationSteps <= STEPS_PER_BAR / 8 && stepIn && stepOut) continue;
			unresolved++;
		}
		if (inSong > 0) songsWithChromatic++;
	}
	check(
		"変化音は和音構成音か順次で出入りする経過音のどちらか",
		unresolved === 0,
		`${unresolved}/${chromatic}音が浮いている`,
	);
	check(
		"変化音がまったく出ない状態に戻っていない",
		songsWithChromatic >= N / 2,
		`${songsWithChromatic}/${N}曲`,
	);
	// 参考曲は音数比で p05 0.000 / p50 0.040 / p95 0.237。撒きすぎも退行。
	check(
		"変化音の割合が参考曲の範囲に収まる",
		chromatic / notes <= 0.237,
		`${((chromatic / notes) * 100).toFixed(1)}%`,
	);
	console.log(
		`  ${N}曲: 変化音 ${((chromatic / notes) * 100).toFixed(1)}% / 浮いた変化音 ${unresolved}音 / 変化音を含む曲 ${songsWithChromatic}曲`,
	);
}

// ============================================================
// 2.7 ドラム自動選択
//
//     組み込みの DRUM_PATTERNS から曲調（テンポ・刻み）に適したものが
//     自動選択され、MMLにも実体のある名前が出力されること。
// ============================================================

// ============================================================
// ハモリと掛け合い
//   ハモリの定石: 3度か6度で当てる／完全5度は浮くので避ける／
//   必ず和音構成音へ合わせる／全編ではなく要所（サビ・Bメロ）で入れる。
// ============================================================

console.log("● 平行調とトニック回避");
{
	const N = 300;
	let relative = 0;
	let floating = 0;
	let floatingNoTonic = 0;
	let floatingTonicSum = 0;
	let other = 0;
	let otherTonicSum = 0;
	let relativeAndShift = 0;
	let parallelKey = 0;
	const modKinds = new Set<string>();
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			random: seededRandom(seed * 104729),
			template: "jpop_standard",
		});
		const chords = song.chordProgression.split("|");
		const minor = song.keyName.endsWith("m");
		const isTonic = (c: string): boolean =>
			minor ? /^Am/.test(c) : /^C(?![#b]|m)/.test(c);

		if (song.tonal.relativeKinds.length > 0) {
			relative++;
			if (song.tonal.relativeShift !== 0) parallelKey++;
			// 平行調（relativeShift 0）は調号を変えないのが利点なので、keyShift は
			// 動かない。同主調（±3）はそのセクションだけがその量で動く。
			const allowed = new Set([0, song.tonal.relativeShift]);
			if (song.sections.some((x) => !allowed.has(x.keyShift)))
				relativeAndShift++;
		}
		const tonicShare = chords.filter(isTonic).length / chords.length;
		if (song.tonal.floating) {
			floating++;
			floatingTonicSum += tonicShare;
			if (!chords.some(isTonic)) floatingNoTonic++;
		} else {
			other++;
			otherTonicSum += tonicShare;
		}
		const shifts = [...new Set(song.sections.map((x) => x.keyShift))].filter(
			(v) => v !== 0,
		);
		modKinds.add(
			song.tonal.relativeShift !== 0
				? "同主調"
				: song.tonal.relativeKinds.length > 0
					? "平行調"
					: shifts.length === 0
						? "無し"
						: shifts.includes(7)
							? "属調"
							: shifts.includes(5)
								? "下属調"
								: shifts.some((v) => v === 1 || v === 2)
									? "半音上げ"
									: "色付け",
		);
	}
	const floatingTonicShare = floating === 0 ? 0 : floatingTonicSum / floating;
	const otherTonicShare = other === 0 ? 0 : otherTonicSum / other;
	// 下限に**サンプリング誤差のぶんの余裕**を持たせてある。
	// 平行調の抽選は `rnd() < 0.25`（さらにモードの曲は除外）なので実効の設計値は20%強。
	// N=300 の二項分布の標準偏差は約2.3%あり、下限を設計値と同じ 0.20 に置くと
	// **乱数列が少しずれるだけで約1/3の確率で落ちる**——実装を何も変えていなくても
	// 落ちるので、テストとして機能しない。見たいのは「平行調が使われている／
	// ただし乱発ではない」なので、下限を2σぶん下げる。
	check(
		"平行調のセクションを持つ曲が15〜50%",
		relative / N >= 0.15 && relative / N <= 0.5,
		`${((relative / N) * 100).toFixed(1)}%`,
	);
	check(
		"平行調・同主調の曲に別の転調を重ねない",
		relativeAndShift === 0,
		`${relativeAndShift}曲`,
	);
	check("同主調の曲も出る", parallelKey > 0, `${parallelKey}/${relative}曲`);
	// 五度圏の近い調（属調・下属調）から遠い直接転調（半音上げ）まで、
	// 生成の幅として一通り出ること。
	check(
		"転調の種類が5通り以上出る",
		modKinds.size >= 5,
		[...modKinds].join(" "),
	);
	check(
		"浮遊感の曲が1割前後",
		floating / N >= 0.05 && floating / N <= 0.2,
		`${((floating / N) * 100).toFixed(0)}%`,
	);
	// ここも上と同じ理由で**サンプリング誤差ぶんの余裕**を持たせる。浮遊感の曲は
	// N=300 のうち40本前後しか出ないので、皆無率の標準偏差は 7〜8% ある。実測（1200 seed）
	// では 41% で安定しているが、下限を 0.3 に置くと**乱数列がずれるだけで落ちる**。
	// 実際、セクション長を seed ごとに引くようにした（長さの定数をやめた）だけで
	// 29%（12/41）に振れて落ちた。1200 seed で測り直すと 41% で、長さとの関係は無い。
	check(
		"浮遊感の曲の2割以上がトニックを一度も鳴らさない",
		floating === 0 || floatingNoTonic / floating >= 0.2,
		`${floatingNoTonic}/${floating}`,
	);
	// 「一度も鳴らさない」は0か1かなので、曲が長いほど当たりにくくなる。狙いそのもの
	// （＝トニックを避けている）は占有率で見るほうが曲の長さに左右されない。
	// 実測: 浮遊感 14.3% / それ以外 23.7%（1200 seed）。
	check(
		"浮遊感の曲はトニック和音の占有率が低い",
		floating === 0 || floatingTonicShare < otherTonicShare * 0.8,
		`浮遊感 ${(floatingTonicShare * 100).toFixed(1)}% / それ以外 ${(otherTonicShare * 100).toFixed(1)}%`,
	);
	console.log(
		`  ${N}曲: 転調の型 ${[...modKinds].join("・")} / 平行調 ${(((relative - parallelKey) / N) * 100).toFixed(0)}% / 同主調 ${((parallelKey / N) * 100).toFixed(0)}% / 浮遊感 ${((floating / N) * 100).toFixed(0)}%（うちトニック皆無 ${floating ? Math.round((floatingNoTonic / floating) * 100) : 0}%）`,
	);
}

console.log("● ハモリと掛け合い");
{
	const N = 60;
	let harmNotes = 0;
	let above = 0;
	let unison = 0;
	let outOfRange = 0;
	let harmMove = 0;
	let harmSteps = 0;
	let melMove = 0;
	let melSteps = 0;
	let duetSpans = 0;
	let anticipated = 0;
	let harmBars = 0;
	let melodyBars = 0;
	const duetStyles = new Set<string>();
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			random: seededRandom(seed * 104729),
			template: "jpop_standard",
		});
		duetStyles.add(song.vocal.duetStyle);

		// ハモリが鳴る小節は、メロディのある小節の一部であること（全編に付けない）。
		const mel = new Map(song.melody.map((n) => [n.startStep, n.pitchUnits]));
		const hBars = new Set(
			song.harmony.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
		);
		const mBars = new Set(
			song.melody.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
		);
		harmBars += hBars.size;
		melodyBars += mBars.size;
		for (const b of hBars)
			check(
				`seed=${seed} ハモリはメロディのある小節にだけ乗る`,
				mBars.has(b),
				`bar${b + 1}`,
			);

		// **ハモリは主旋律より動かない別の旋律線であること。**
		// 参考曲（`ぺぽよ/±0/220715.mid` ch6/ch7）を測ると、隣の音への平均移動が
		// 主旋律3.07半音に対しハモリ1.23半音、同音を繰り返す割合が30%対54%だった。
		// 平行3度を並べると、この差は原理的に出ない。
		// 参考曲の7組には1声目と2声目の両方が入っているので、こちらも両方を数える。
		const allHarmony = [...song.harmony, ...song.harmony2];
		const hs = [...song.harmony]
			.sort((a, b) => a.startStep - b.startStep)
			.map((n) => Math.round(n.pitchUnits / UNITS_PER_SEMITONE));
		for (let i = 1; i < hs.length; i++) {
			harmMove += Math.abs(hs[i] - hs[i - 1]);
			harmSteps++;
		}
		const ms = [...song.melody]
			.sort((a, b) => a.startStep - b.startStep)
			.map((n) => Math.round(n.pitchUnits / UNITS_PER_SEMITONE));
		for (let i = 1; i < ms.length; i++) {
			melMove += Math.abs(ms[i] - ms[i - 1]);
			melSteps++;
		}
		for (const h of allHarmony) {
			const m = mel.get(h.startStep);
			if (m === undefined) continue;
			harmNotes++;
			const gap = Math.round((h.pitchUnits - m) / UNITS_PER_SEMITONE);
			if (gap > 0) above++;
			else if (gap === 0) unison++;
			if (gap > 12 || gap < -12) outOfRange++;
		}

		// 掛け合いの区間は曲の中に収まり、前後が入れ替わらないこと。
		let prevEnd = -1;
		for (const [a, b] of song.vocal.duetSpans) {
			check(
				`seed=${seed} 掛け合いの区間が曲の中に収まる`,
				a >= 0 && b <= song.bars * STEPS_PER_BAR && a < b && a >= prevEnd,
				`[${a}, ${b}) / ${song.bars * STEPS_PER_BAR}ステップ`,
			);
			prevEnd = b;
			// 受け渡しが小節線ぴったりでない（食い気味に入る）ことがあるか数える。
			if (a % STEPS_PER_BAR !== 0) anticipated++;
			duetSpans++;
		}
	}
	// 参考曲7組（±0 / ヤツメ穴 / チョウチン少女×3 / とべない深海魚×2、1705音）を
	// 集計した目標: 上62% ユニゾン8% 下30%、移動 主旋律2.58 / ハモリ1.73（1.49倍）。
	const harmAvg = harmMove / Math.max(1, harmSteps);
	const melAvg = melMove / Math.max(1, melSteps);
	check(
		"ハモリは主旋律より動かない",
		harmAvg < melAvg * 0.9,
		`主旋律 ${melAvg.toFixed(2)} / ハモリ ${harmAvg.toFixed(2)}半音（参考 2.58 / 1.73）`,
	);
	check(
		"上ハモが主だが、下ハモとユニゾンも出る",
		above / Math.max(1, harmNotes) > 0.4 &&
			above / Math.max(1, harmNotes) < 0.75 &&
			unison > 0,
		`上 ${((above / Math.max(1, harmNotes)) * 100).toFixed(0)}% / ユニゾン ${((unison / Math.max(1, harmNotes)) * 100).toFixed(0)}%（参考 62 / 8）`,
	);
	check(
		"ハモリが主旋律から1オクターブより離れない",
		outOfRange === 0,
		`${outOfRange}音が ±12半音の外`,
	);
	check(
		"ハモリは全編には付けない",
		harmBars / Math.max(1, melodyBars) < 0.7,
		`歌う小節の ${((harmBars / Math.max(1, melodyBars)) * 100).toFixed(0)}%`,
	);
	check(
		"掛け合いの型が3種類以上出る",
		duetStyles.size >= 3,
		[...duetStyles].join(" "),
	);
	// 小節線でぴったり交代し続けると受け渡しが機械的に聞こえる。
	check(
		"掛け合いの受け渡しが食い気味に入ることがある",
		duetSpans === 0 || anticipated / duetSpans > 0.2,
		`${anticipated}/${duetSpans}`,
	);
	console.log(
		`  ${N}曲: ハモリ 上${((above / Math.max(1, harmNotes)) * 100).toFixed(0)}%/ユニゾン${((unison / Math.max(1, harmNotes)) * 100).toFixed(0)}%/下${(((harmNotes - above - unison) / Math.max(1, harmNotes)) * 100).toFixed(0)}% 移動${harmAvg.toFixed(2)}(主旋律${melAvg.toFixed(2)}) / 歌う小節の ${((harmBars / Math.max(1, melodyBars)) * 100).toFixed(0)}% に付く / 掛け合い ${[...duetStyles].join(" ")}（食い ${duetSpans === 0 ? 0 : Math.round((anticipated / duetSpans) * 100)}%）`,
	);
}

console.log("● ドラム自動選択");
{
	const N = 40;
	const drums = new Set<string>();
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 31),
		});
		const tag = `seed=${seed}`;
		drums.add(song.drum);
		check(
			`${tag} 組み込みドラムパターンが存在する`,
			song.drum in DRUM_PATTERNS,
			`不明なキー: ${song.drum}`,
		);
		const pattern = resolveDrumPattern(song.drum, DRUM_PATTERNS, 1);
		check(
			`${tag} ドラムパターンが解決できる`,
			pattern !== null && pattern.length > 0,
			`解決失敗: ${song.drum}`,
		);
	}
	check(
		"ドラムの型が複数出る",
		drums.size >= 3,
		`${drums.size}種: ${[...drums].join(",")}`,
	);
	console.log(`  ${N}曲: 型${drums.size}種（${[...drums].join(" ")}）`);
}

// ============================================================
// 2.8 楽器プリセット自動選択
//
//     組み込みの INSTRUMENT_PRESETS から曲調に適したものが
//     自動選択され、実体のあるプリセット名が出力されること。
// ============================================================

console.log("● 楽器プリセット自動選択");
{
	const N = 40;
	const instruments = new Set<string>();
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 47),
		});
		const tag = `seed=${seed}`;
		instruments.add(song.instrument);
		check(
			`${tag} 組み込み楽器プリセットが存在する`,
			song.instrument in INSTRUMENT_PRESETS,
			`不明なキー: ${song.instrument}`,
		);
	}
	check(
		"楽器プリセットが複数種出る",
		instruments.size >= 4,
		`${instruments.size}種: ${[...instruments].join(",")}`,
	);
	console.log(
		`  ${N}曲: 型${instruments.size}種（${[...instruments].join(" ")}）`,
	);
}

// ============================================================
// 2.9 界隈曲テンプレート
//
//     テンプレートが自前で持つもの（進行・ベース4型・ドラム・楽器・構成の候補）が
//     生成物に**届いているか**の検算。良否ではなく到達を見る（docs/handover-compose.md
//     「界隈曲テンプレート」）。
// ============================================================

console.log("● 界隈曲テンプレート");
{
	const N = 40;
	const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === "kaiwai");
	check("kaiwai テンプレートがある", tmpl !== undefined, "無い");
	const drums = tmpl?.drums;
	const plans = tmpl?.plans;
	if (tmpl && drums && plans) {
		const drumPool = new Set([...drums.pool, ...(drums.dense?.pool ?? [])]);
		const chordPatterns = new Set<string>(tmpl.chordPatterns ?? []);
		const instruments = new Set(tmpl.instruments ?? []);
		const bpms = new Set(tmpl.bpmChoices ?? []);
		const introChoices = new Set(tmpl.sectionSpecs?.intro?.barChoices ?? []);
		const median = (xs: number[]): number =>
			[...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
		let twoChordSum = 0;
		let noIntro = 0;
		const totals = new Set<number>();
		const bassNotesPerBar: number[] = [];
		const bassDurMedian: number[] = [];
		const styles = new Set<string>();
		let lateMeasured = 0;
		/** 詠唱の検算（8.）：楽句の再現・同音連打・16分間隔・跳躍・ファの40曲集計。 */
		let chantUnits = 0;
		let chantRepeated = 0;
		const sameNoteShare: number[] = [];
		const sixteenthShare: number[] = [];
		const leapShare: number[] = [];
		const faShare: number[] = [];
		const SPLITS: [name: string, a: number, b: number, source: string][] = [
			["サブメロ", 3, 14, "submelody"],
			["ハモリ", 2, 12, "harmony"],
			["ベース", 4, 5, "bass"],
		];
		for (let seed = 1; seed <= N; seed++) {
			const opts = {
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				template: "kaiwai",
			};
			const song = composeSong({ ...opts, random: seededRandom(seed * 7919) });
			const tag = `kaiwai seed=${seed}`;
			styles.add(song.stats.bassStyle);

			// --- 1. テンプレートの候補から引けているか ---
			check(
				`${tag} ドラムがテンプレートの候補`,
				drumPool.has(song.drum) && song.drum in DRUM_PATTERNS,
				song.drum,
			);
			const pattern = resolveDrumPattern(song.drum, DRUM_PATTERNS, 1);
			check(
				`${tag} ドラムパターンが解決できる`,
				pattern !== null && pattern.length > 0,
				song.drum,
			);
			check(
				`${tag} 楽器がテンプレートの候補`,
				instruments.has(song.instrument) &&
					song.instrument in INSTRUMENT_PRESETS,
				song.instrument,
			);
			check(`${tag} テンポが候補の中`, bpms.has(song.bpm), `${song.bpm}`);
			check(
				`${tag} 調が短調（UI の any 経路で baseKey が効く）`,
				song.keyName.endsWith("m"),
				song.keyName,
			);
			// テンプレートが音階を指名していればその中、無ければ短調の既定（民謡音階）
			check(
				`${tag} 音階がテンプレートの音階`,
				(tmpl.scales ?? ["minyo"]).includes(song.scaleId),
				song.scaleId,
			);
			check(
				`${tag} 伴奏の奏法が候補の中`,
				chordPatterns.has(song.chordPattern),
				song.chordPattern,
			);

			// --- 2. 進行が全部解析でき、伴奏が全小節で鳴る ---
			const bars = song.chordProgression.split("|");
			const chords = bars.flatMap((b) => b.trim().split(/\s+/));
			const unparsable = chords.filter((c) => {
				try {
					parseChord(c);
					return false;
				} catch {
					return true;
				}
			});
			check(
				`${tag} 進行の全和音が解析できる`,
				unparsable.length === 0,
				unparsable.join(" "),
			);
			// bpm は 120 固定——`parseChords` は秒で刻むので、割り切れないテンポでは小節頭が
			// 1ステップ前へ丸まり、小節の数え方がずれる（上の 2. と同じ）。
			const placements = buildChordPlacements({
				chordStr: song.chordProgression,
				patternType: "block",
				rootShift: song.rootShift,
				bpm: 120,
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
			});
			const soundingBars = new Set(
				placements.map((p) => Math.floor(p.startStep / STEPS_PER_BAR)),
			);
			check(
				`${tag} 伴奏が全小節で鳴る`,
				soundingBars.size === song.bars,
				`${soundingBars.size}/${song.bars}小節`,
			);

			// --- 3. 和声（2拍の動き・締め・イントロ＝サビの顔・サビ頭の色） ---
			twoChordSum +=
				bars.filter((b) => b.trim().includes(" ")).length / bars.length;
			const lastSec = song.sections[song.sections.length - 1];
			if (!song.tonal.floating) {
				const last = (bars.at(-1) ?? "").trim().split(/\s+/).at(-1) ?? "";
				const expAm = transposeChordName("Am", lastSec.keyShift);
				check(
					`${tag} 最終小節が主和音（Am 系）`,
					last.startsWith(expAm),
					`${last}（期待 ${expAm}…）`,
				);
			}
			const intro = song.sections.find((s) => s.kind === "intro");
			const firstChorus = song.sections.find((s) => s.kind === "chorus");
			if (intro && firstChorus && intro.keyShift === firstChorus.keyShift) {
				// 和音の並び（小節を平らに展開）で比べる。2小節のイントロは `half` で2和音に割られず
				// 1小節1和音（進行の先頭2つ）なので、小節頭だけを比べるとサビの2和音小節と食い違う。
				// イントロ末尾は次が主和音なので MODAL_BORROW（Em7→Eb 等）が掛かりうる。借用形は同一視する。
				const BORROWED = new Set(["Fm", "Fm7", "Ab", "Bb", "Eb", "Dm7-5"]);
				const flat = (from: number, count: number): string[] =>
					bars.slice(from, from + count).flatMap((b) => b.trim().split(/\s+/));
				const ih = flat(intro.startBar, Math.min(intro.bars, 4));
				const ch = flat(firstChorus.startBar, 4).slice(0, ih.length);
				check(
					`${tag} イントロがサビの和音で始まる`,
					ih.every((c, i) => c === ch[i] || BORROWED.has(c)),
					`intro=${ih.join("|")} / chorus=${ch.join("|")}`,
				);
			}
			if (firstChorus) {
				const head = bars
					.slice(firstChorus.startBar, firstChorus.startBar + 4)
					.join(" ");
				check(
					`${tag} サビ頭4小節に 7th・6・M7・-5・aug のどれかがある`,
					/7|6|M7|-5|\+/.test(head),
					head,
				);
			}

			// --- 4. ベース（8分・オクターブ往復・音域） ---
			checkVoice(tag, "ベース", song.bass, song.bars);
			const bass = [...song.bass].sort((a, b) => a.startStep - b.startStep);
			const semis = bass.map((n) =>
				Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
			);
			const avg = semis.reduce((a, b) => a + b, 0) / Math.max(1, semis.length);
			check(`${tag} ベースの平均音高がC3未満`, avg < 48, avg.toFixed(1));
			// Synth Bass 1/2 の音域 [24,72]（instrument-presets.ts の GM_INSTRUMENT_RANGE）。
			const outside = semis.filter((s) => s < 24 || s > 72).length;
			check(
				`${tag} ベースの全音が [24,72]`,
				outside === 0,
				`${outside}音（${Math.min(...semis)}〜${Math.max(...semis)}）`,
			);
			bassNotesPerBar.push(bass.length / song.bars);
			bassDurMedian.push(median(bass.map((n) => n.durationSteps)));
			/** 同じ小節の中の隣接対で |Δ|=12 の割合。`late` は両方が2和音小節の後半にある対だけ。 */
			const octaveShare = (late: boolean): number => {
				let pairs = 0;
				let oct = 0;
				for (let i = 1; i < bass.length; i++) {
					const bar = Math.floor(bass[i].startStep / STEPS_PER_BAR);
					if (Math.floor(bass[i - 1].startStep / STEPS_PER_BAR) !== bar)
						continue;
					if (late) {
						if (!bars[bar]?.trim().includes(" ")) continue;
						if (bass[i - 1].startStep % STEPS_PER_BAR < STEPS_PER_BAR / 2)
							continue;
					}
					pairs++;
					if (Math.abs(semis[i] - semis[i - 1]) === 12) oct++;
				}
				return pairs === 0 ? -1 : oct / pairs;
			};
			if (song.stats.bassStyle === "octave-eighth") {
				// 上限は 7/8 弱——approach 骨格の経過音・ゴースト・2和音の境目で対が切れる。
				const all = octaveShare(false);
				check(
					`${tag} octave-eighth がオクターブ往復（小節内の隣接対）`,
					all >= 0.6,
					all.toFixed(2),
				);
				const late = octaveShare(true);
				if (late >= 0) lateMeasured++;
				check(
					`${tag} octave-eighth が2和音小節の後半でも往復（オクターブ保持）`,
					late < 0 || late >= 0.6,
					late.toFixed(2),
				);
			}
			if (song.stats.bassStyle === "root-eighth")
				check(`${tag} root-eighth の平均が 45 以下`, avg <= 45, avg.toFixed(1));

			// --- 5. 構成 ---
			const kinds = song.sections.map((s) => s.kind);
			check(
				`${tag} 構成が plans のどれか`,
				plans.some((p) => p.join("-") === kinds.join("-")),
				kinds.join("-"),
			);
			check(
				`${tag} セクションの合計が曲の長さ`,
				song.sections.reduce((s, x) => s + x.bars, 0) === song.bars,
				`${song.bars}`,
			);
			if (intro)
				check(
					`${tag} イントロが ${[...introChoices].join("/")} 小節`,
					introChoices.has(intro.bars),
					`${intro.bars}`,
				);
			else noIntro++;
			totals.add(song.bars);
			check(
				`${tag} 連続サビで候補が全滅していない`,
				song.stats.rejected < song.stats.attempts,
				`${song.stats.rejected}/${song.stats.attempts}`,
			);

			// --- 6. 上級者モードの15トラック分割（chip_pop） ---
			const layers = buildAdvancedLayers(song, {
				stepsPerBar: STEPS_PER_BAR,
				preset: INSTRUMENT_PRESETS.chip_pop,
			});
			const byIndex = new Map(layers.map((l) => [l.index, l]));
			for (const [name, a, b, source] of SPLITS) {
				const total =
					(byIndex.get(a)?.notes.length ?? 0) +
					(byIndex.get(b)?.notes.length ?? 0);
				const src = (song as unknown as Record<string, unknown[]>)[source];
				check(
					`${tag} ${name}の分割で音が消えていない`,
					total >= src.length,
					`t${a}+t${b}=${total} / 元=${src.length}`,
				);
			}

			// --- 7. 決定性 ---
			const again = composeSong({ ...opts, random: seededRandom(seed * 7919) });
			check(
				`${tag} 同じ種で同じ曲`,
				JSON.stringify(song) === JSON.stringify(again),
				"生成物が違う",
			);

			// --- 8. 歌メロが詠唱（第3版）・サブメロが16分アルペジオ ---
			check(`${tag} form が chant`, song.form === "chant", song.form);
			// (b) セクションの中で同じ2小節のリズムが2回以上返る（4小節の型を延々と回す）。
			// 4小節のCメロは問い・答えが1回ずつなので返らない——40曲の合計で見る。
			const rhythmOf = (bar: number): string =>
				song.melody
					.filter(
						(n) =>
							n.startStep >= bar * STEPS_PER_BAR &&
							n.startStep < (bar + 2) * STEPS_PER_BAR,
					)
					.map((n) => `${n.startStep - bar * STEPS_PER_BAR}:${n.durationSteps}`)
					.join(",");
			for (const sec of song.sections) {
				if (!sec.spec.melody) continue;
				const counts = new Map<string, number>();
				const keys: string[] = [];
				for (let b = sec.startBar; b + 1 < sec.startBar + sec.bars; b += 2) {
					const k = rhythmOf(b);
					keys.push(k);
					counts.set(k, (counts.get(k) ?? 0) + 1);
				}
				for (const k of keys) {
					chantUnits++;
					if ((counts.get(k) ?? 0) >= 2) chantRepeated++;
				}
			}
			// (c) 音域は1オクターブ強まで（コーパス 5度〜1オクターブ）。同音連打・16分・跳躍は40曲平均で
			// 見る（素材は実在の2小節フレーズなので、曲ごとには 0 も 0.4 も出る）。
			// ファ（四抜き短調の♭6）は曲ごとに 0.2 以下、平均 0.08 以下（コーパス中央 0.044・p75 0.078。
			// 順次の経過音・刺繍音だけ通す）。セクションの `keyShift` ぶんは戻してから数える。
			const mel = [...song.melody].sort((a, b) => a.startStep - b.startStep);
			const melSemis = mel.map((n) =>
				Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
			);
			const melRange = Math.max(...melSemis) - Math.min(...melSemis);
			check(`${tag} 主旋律の音域が 14 半音以下`, melRange <= 14, `${melRange}`);
			{
				let same = 0;
				let six = 0;
				let leap = 0;
				for (let i = 1; i < mel.length; i++) {
					if (melSemis[i] === melSemis[i - 1]) same++;
					if (Math.abs(melSemis[i] - melSemis[i - 1]) > 3) leap++;
					if (mel[i].startStep - mel[i - 1].startStep <= STEPS_PER_BAR / 16)
						six++;
				}
				sameNoteShare.push(same / Math.max(1, mel.length - 1));
				sixteenthShare.push(six / Math.max(1, mel.length - 1));
				leapShare.push(leap / Math.max(1, mel.length - 1));
				let fa = 0;
				for (let i = 0; i < mel.length; i++) {
					const sec = song.sections.find(
						(x) =>
							mel[i].startStep >= x.startBar * STEPS_PER_BAR &&
							mel[i].startStep < (x.startBar + x.bars) * STEPS_PER_BAR,
					);
					const pc =
						(((melSemis[i] - song.rootShift - (sec?.keyShift ?? 0)) % 12) +
							12) %
						12;
					if (pc === 5) fa++;
				}
				const faRate = fa / Math.max(1, mel.length);
				faShare.push(faRate);
				check(
					`${tag} 主旋律のファ（♭6）が 20% 以下`,
					faRate <= 0.2,
					faRate.toFixed(3),
				);
			}
			// (d) サブメロは全曲で空でなく単音、全音が進行の構成音（arpeggio-fast の配置の
			// オクターブ上）で、主旋律の最高音より下へ降りない。ハモリ2声・オクターブ重ねは空（歌は1本）。
			checkVoice(tag, "サブメロ", song.submelody, song.bars);
			check(
				`${tag} ハモリ・オクターブ重ねが空（sub: arpeggio）`,
				song.harmony.length === 0 &&
					song.harmony2.length === 0 &&
					song.octave.length === 0,
				`harmony=${song.harmony.length} harmony2=${song.harmony2.length} octave=${song.octave.length}`,
			);
			{
				const subLow = Math.min(...song.submelody.map((n) => n.pitchUnits));
				const melHigh = Math.max(...song.melody.map((n) => n.pitchUnits));
				check(
					`${tag} サブメロの最低音が主旋律の最高音以上`,
					subLow >= melHigh,
					`sub ${Math.round(subLow / UNITS_PER_SEMITONE)} < mel ${Math.round(melHigh / UNITS_PER_SEMITONE)}`,
				);
			}
			const fast = buildChordPlacements({
				chordStr: song.chordProgression,
				patternType: "arpeggio-fast",
				rootShift: song.rootShift,
				bpm: 120,
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
			});
			// arpeggio-fast は i 番目の音が 6i ステップ遅れて始まる（5音まで 24）。
			const off = song.submelody.filter(
				(n) =>
					!fast.some(
						(p) =>
							p.startStep - 24 <= n.startStep &&
							n.startStep < p.startStep + p.durationSteps &&
							(n.pitchUnits - p.pitchUnits) % UNITS_PER_OCTAVE === 0 &&
							n.pitchUnits > p.pitchUnits,
					),
			);
			check(
				`${tag} サブメロの全音が進行の構成音（arpeggio-fast のオクターブ上）`,
				off.length === 0,
				`${off.length}/${song.submelody.length}音`,
			);
			// アルペジオは最後のサビだけ（所有者「ラスサビぐらいのイメージ」）。そこは全小節で鳴り、他は無音。
			const subBars = new Set(
				song.submelody.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
			);
			const lastChorus = [...song.sections]
				.reverse()
				.find((x) => x.kind === "chorus");
			const lastBars = new Set(
				lastChorus
					? Array.from(
							{ length: lastChorus.bars },
							(_, i) => lastChorus.startBar + i,
						)
					: [],
			);
			check(
				`${tag} アルペジオが最後のサビの全小節で鳴り、他では鳴らない`,
				[...lastBars].every((b) => subBars.has(b)) &&
					[...subBars].every((b) => lastBars.has(b)),
				`ラスサビ無音 ${[...lastBars].filter((b) => !subBars.has(b)).length} / ラスサビ外で鳴る ${[...subBars].filter((b) => !lastBars.has(b)).length}`,
			);
		}
		check(
			"詠唱：セクション内で同じ2小節のリズムが2回以上返る割合 ≥ 0.8",
			chantRepeated / Math.max(1, chantUnits) >= 0.8,
			`${chantRepeated}/${chantUnits}`,
		);
		const avg = (xs: number[]): number =>
			xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
		check(
			"詠唱：主旋律の同音連打率の平均 ≥ 0.08",
			avg(sameNoteShare) >= 0.08,
			avg(sameNoteShare).toFixed(3),
		);
		check(
			"詠唱：主旋律の16分間隔の割合の平均 ≤ 0.15",
			avg(sixteenthShare) <= 0.15,
			avg(sixteenthShare).toFixed(3),
		);
		// コーパス89曲の主旋律は 0.177（中央）・0.194（平均）。直す前は 0.319 で vocaloid（0.270）より多かった。
		check(
			"詠唱：主旋律の隣接音程 >3半音 の割合の平均 ≤ 0.25",
			avg(leapShare) <= 0.25,
			avg(leapShare).toFixed(3),
		);
		check(
			"詠唱：主旋律のファ（♭6）の割合の平均 ≤ 0.08",
			avg(faShare) <= 0.08,
			avg(faShare).toFixed(3),
		);
		console.log(
			`  詠唱: 楽句の再現 ${chantRepeated}/${chantUnits} / 同音連打 平均 ${avg(sameNoteShare).toFixed(3)} / 16分間隔 平均 ${avg(sixteenthShare).toFixed(3)} / 跳躍>3半音 平均 ${avg(leapShare).toFixed(3)} / ファ 平均 ${avg(faShare).toFixed(3)}`,
		);
		// 期待値は約 55%（harmonicRhythms の half:bar = 2:2 で、half の曲はほぼ全小節・bar の曲は直書きの
		// 2和音行だけ）。曲ごとにほぼ 0 か 1 なので 40曲平均の σ ≈ 0.08。50% は期待値そのもので、
		// 進行プールを1本足すだけで落ちる。
		check(
			"2和音の小節が平均 40% 以上",
			twoChordSum / N >= 0.4,
			`${((twoChordSum / N) * 100).toFixed(0)}%`,
		);
		check(
			"octave-eighth のオクターブ保持が1曲以上で測れた",
			lateMeasured >= 1,
			`${lateMeasured}曲`,
		);
		check(
			"イントロ無しの曲が 10〜45%",
			noIntro / N >= 0.1 && noIntro / N <= 0.45,
			`${((noIntro / N) * 100).toFixed(0)}%`,
		);
		check("総小節数が3通り以上", totals.size >= 3, `${totals.size}通り`);
		check(
			"ベースの音数/小節の中央値が 6 以上",
			median(bassNotesPerBar) >= 6,
			median(bassNotesPerBar).toFixed(2),
		);
		check(
			"ベースの音価の中央値が付点8分以下",
			median(bassDurMedian) <= 36,
			`${median(bassDurMedian)}`,
		);
		// プールの型が全部出ること（プールを絞っても、指名した型が抽選から漏れていないかを見る）
		const poolStyles = new Set(tmpl.bass?.styles ?? []);
		check(
			"ベースの奏法がプールの全型出る",
			[...poolStyles].every((s) => styles.has(s)),
			`${[...styles].join(" ")} / プール ${[...poolStyles].join(" ")}`,
		);
		console.log(
			`  ${N}曲: 2和音小節 ${((twoChordSum / N) * 100).toFixed(0)}% / イントロ無し ${noIntro}曲 / 総小節 ${[...totals].sort((a, b) => a - b).join(",")} / ベース ${median(bassNotesPerBar).toFixed(1)}音/小節・音価中央 ${median(bassDurMedian)} / 奏法 ${[...styles].join(" ")}`,
		);
	}
}

// ============================================================
// 2.95 界隈曲の流派（kaiwai_kaisen / kaiwai_2go / kaiwai_speder2 と楽器リード版）
//     docs/kaiwai-lineages.md の規則案が生成物に出ているか（到達の検算。良否ではない）。
//     音程・音の割合は同文書の測り方（8分以上の休符を挟む対は数えない・音価で重み付け）。
// ============================================================

console.log("● 界隈曲の流派テンプレート");
{
	const N = 30;
	const avg = (xs: number[]): number =>
		xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
	const pc = (n: number): number => ((n % 12) + 12) % 12;
	/** 進行を2拍ごとの和音列へ（1小節1和音は2つ並べる）。 */
	const slotsOf = (prog: string): string[] =>
		prog.split("|").flatMap((b) => {
			const cs = b.trim().split(/\s+/);
			return cs.length === 1 ? [cs[0], cs[0]] : cs;
		});
	const rootOf = (c: string): number => pc(parseChord(c).notes[0] ?? 0);
	const isM7 = (c: string): boolean => /^[A-G][#b]?m7(?!-5)/.test(c);
	const isDom7 = (c: string): boolean => /^[A-G][#b]?(7|9)/.test(c);
	/** 和音の変わり目のうち Ⅱm7→Ⅴ7（m7 から4度上の属7）の数。 */
	const twoFives = (slots: string[]): number => {
		let n = 0;
		for (let i = 1; i < slots.length; i++)
			if (
				isM7(slots[i - 1]) &&
				isDom7(slots[i]) &&
				pc(rootOf(slots[i]) - rootOf(slots[i - 1])) === 5
			)
				n++;
		return n;
	};
	const drumHits = (name: string, pitches: number[]): number[] =>
		(DRUM_PATTERNS[name]?.pattern ?? [])
			.filter((p) => pitches.includes(p.pitch))
			.map((p) => p.step);
	const KICK = [36];
	const CLAP = [39];
	const HAT = [42, 44, 46];
	/** 主旋律の音を曲の主音ラ＝9 の枠（ハ長調／イ短調）へ戻したピッチクラス（曲中の転調も戻す）。 */
	const melPcs = (song: ReturnType<typeof composeSong>): number[] =>
		[...song.melody]
			.sort((a, b) => a.startStep - b.startStep)
			.map((n) => {
				const at = Math.floor(n.startStep / STEPS_PER_BAR);
				const sec = song.sections.find(
					(s) => at >= s.startBar && at < s.startBar + s.bars,
				);
				return pc(
					Math.round(n.pitchUnits / UNITS_PER_SEMITONE) -
						song.rootShift -
						(sec?.keyShift ?? 0),
				);
			});
	const sectionsLayers = (
		song: ReturnType<typeof composeSong>,
	): Map<number, number> => {
		const layers = buildAdvancedLayers(song, {
			stepsPerBar: STEPS_PER_BAR,
			preset: INSTRUMENT_PRESETS[song.instrument],
		});
		const out = new Map<number, number>();
		song.sections.forEach((s, i) => {
			const lo = s.startBar * STEPS_PER_BAR;
			const hi = (s.startBar + s.bars) * STEPS_PER_BAR;
			out.set(
				i,
				layers.filter((l) =>
					l.notes.some((n) => n.startStep >= lo && n.startStep < hi),
				).length,
			);
		});
		return out;
	};
	const notesIn = (
		notes: { startStep: number }[],
		fromBar: number,
		toBar: number,
	): number =>
		notes.filter(
			(n) =>
				n.startStep >= fromBar * STEPS_PER_BAR &&
				n.startStep < toBar * STEPS_PER_BAR,
		).length;
	const PENTA = new Set([9, 0, 2, 4, 7]);
	// 2号は全体の作り（音階・ドラムの組・ベース）を曲ごとに引き直す（compose-kaiwai.ts の varyNigo）。
	const NIGO_SCALES = ["penta_minor", "yonuki_minor", "minyo"];
	const NIGO_DRUMS = [
		"four_clap",
		"four_clap_pedal",
		"four_clap_16hat",
		"four_clap_16hat_snare",
	];

	for (const name of [
		"kaiwai_kaisen",
		"kaiwai_2go",
		"kaiwai_2go_lead",
		"kaiwai_speder2",
		"kaiwai_speder2_lead",
	]) {
		const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === name);
		check(`${name} テンプレートがある`, tmpl !== undefined, "無い");
		if (!tmpl) continue;
		const lineage = name.replace(/_lead$/, "");
		const bpmRange: [number, number] =
			lineage === "kaiwai_kaisen"
				? [130, 135]
				: lineage === "kaiwai_2go"
					? [140, 180]
					: [100, 135];
		const m = {
			step: [] as number[],
			same: [] as number[],
			six: [] as number[],
			dotted: [] as number[],
			triplet: [] as number[],
			penta: [] as number[],
			top5: [] as number[],
			fa: [] as number[],
			range: [] as number[],
			amShare: [] as number[],
			fourthUp: [] as number[],
			seventh: [] as number[],
			twoFive: [] as number[],
			tresilloBars: [] as number[],
			barLoop: [] as number[],
			occupancy: [] as number[],
			lift: [] as number[],
			/** 4つ打ちの曲。 */
			four: [] as number[],
			/** 16分裏のハットが1小節2打以上の曲。 */
			hat16: [] as number[],
			/** 規則どおりのイントロ（海鮮 8小節・Speder2 16小節）を置いた曲。 */
			form: [] as number[],
			/** 歌が引っ込む間奏を置いた曲（海鮮）。 */
			quiet: [] as number[],
			/** 楽器だけのアウトロで終わる曲（海鮮）。 */
			outro: [] as number[],
			/** 2本目の声を付けた曲（海鮮）。 */
			second: [] as number[],
			/** 前の小節と同一の小節の割合（Speder2 の楽器リード）。 */
			repeatPrev: [] as number[],
			/** 2小節前と同一の小節の割合（Speder2 の楽器リードの小節の再出現）。 */
			form2: [] as number[],
			/** 2号: ⅣM7 のある曲・8分オクターブか3:3:2 のベースの曲・ハモリと重ねの無い曲。 */
			fm7: [] as number[],
			bassCore: [] as number[],
			plain: [] as number[],
		};
		let threw = 0;
		for (let seed = 1; seed <= N; seed++) {
			const tag = `${name} seed=${seed}`;
			let song: ReturnType<typeof composeSong>;
			try {
				song = composeSong({
					stepsPerBar: STEPS_PER_BAR,
					edo: 12,
					template: name,
					random: seededRandom(seed * 7919),
				});
			} catch (e) {
				threw++;
				check(`${tag} 例外なし`, false, String(e));
				continue;
			}
			// --- テンポ・調・音階・候補 ---
			check(
				`${tag} bpm が ${bpmRange.join("〜")}`,
				song.bpm >= bpmRange[0] && song.bpm <= bpmRange[1],
				`${song.bpm}`,
			);
			check(`${tag} 短調`, song.keyName.endsWith("m"), song.keyName);
			const nigo = lineage === "kaiwai_2go";
			check(
				`${tag} 音階がテンプレートの候補`,
				(nigo ? NIGO_SCALES : (tmpl.scales ?? [])).includes(song.scaleId),
				song.scaleId,
			);
			check(
				`${tag} ドラムがテンプレートの候補`,
				[...(tmpl.drums?.pool ?? []), ...(nigo ? NIGO_DRUMS : [])].includes(
					song.drum,
				),
				song.drum,
			);
			check(
				`${tag} 楽器がテンプレートの候補`,
				(tmpl.instruments ?? []).includes(song.instrument),
				song.instrument,
			);
			// --- ドラム: 裏8分のハット・4つ打ち（2号は4つ打ちでない曲も出る）・2・4拍クラップ（海鮮・Speder2）・
			//     16分裏の閉じハット（Speder2 の多く） ---
			const kick = drumHits(song.drum, KICK);
			const hat = drumHits(song.drum, HAT);
			check(
				`${tag} ドラムが裏8分ハット`,
				[24, 72, 120, 168].every((s) => hat.includes(s)),
				song.drum,
			);
			const four = [0, 48, 96, 144].every((s) => kick.includes(s));
			m.four.push(four ? 1 : 0);
			if (lineage !== "kaiwai_2go")
				check(`${tag} ドラムが4つ打ち`, four, song.drum);
			if (lineage !== "kaiwai_2go") {
				const clap = drumHits(song.drum, CLAP);
				check(
					`${tag} ドラムが2・4拍クラップ`,
					clap.includes(48) && clap.includes(144),
					song.drum,
				);
			}
			m.hat16.push(hat.filter((s) => s % 24 === 12).length >= 2 ? 1 : 0);

			// --- 和音 ---
			const slots = slotsOf(song.chordProgression);
			const bars = song.chordProgression.split("|");
			const changes = slots.filter((c, i) => i > 0 && c !== slots[i - 1]);
			const fourth =
				slots.filter(
					(c, i) =>
						i > 0 &&
						c !== slots[i - 1] &&
						pc(rootOf(c) - rootOf(slots[i - 1])) === 5,
				).length / Math.max(1, changes.length);
			m.fourthUp.push(fourth);
			const seventh = slots.filter((c) => /7|9/.test(c)).length / slots.length;
			m.seventh.push(seventh);
			m.twoFive.push(twoFives(slots) / Math.max(1, changes.length));
			if (lineage === "kaiwai_kaisen") {
				const am = slots.filter((c) => /^Am(?!aj|M)/.test(c)).length;
				m.amShare.push(am / slots.length);
				check(
					`${tag} 和音が2拍ごと（2和音の小節が9割以上）`,
					bars.filter((b) => b.trim().includes(" ")).length / bars.length >=
						0.9,
					song.chordProgression.slice(0, 80),
				);
				check(
					`${tag} 属7で短調Ⅰへ引き戻す（E7→Am 系）`,
					slots.some((c, i) => c === "E7" && /^Am/.test(slots[i + 1] ?? "")),
					"無い",
				);
			}
			if (lineage === "kaiwai_2go") {
				check(
					`${tag} セブンスが拍の半分以上`,
					seventh >= 0.5,
					seventh.toFixed(2),
				);
				m.fm7.push(slots.includes("FM7") ? 1 : 0);
			}
			if (lineage === "kaiwai_speder2") {
				check(`${tag} 7th 以上が9割以上`, seventh >= 0.9, seventh.toFixed(2));
				check(`${tag} 2-5 が無い`, twoFives(slots) === 0, `${twoFives(slots)}`);
				const heads = bars.map((b) => b.trim().split(/\s+/));
				let vamp = false;
				for (let i = 0; i + 8 <= heads.length && !vamp; i++)
					vamp = new Set(heads.slice(i, i + 8).flat()).size <= 2;
				check(`${tag} 1〜2和音で8小節以上回す区間がある`, vamp, "無い");
			}

			// --- ベース ---
			const bass = [...song.bass].sort((a, b) => a.startStep - b.startStep);
			const bassSemis = bass.map((n) =>
				Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
			);
			let pairs = 0;
			let oct = 0;
			for (let i = 1; i < bass.length; i++) {
				if (
					Math.floor(bass[i].startStep / STEPS_PER_BAR) !==
					Math.floor(bass[i - 1].startStep / STEPS_PER_BAR)
				)
					continue;
				pairs++;
				if (Math.abs(bassSemis[i] - bassSemis[i - 1]) === 12) oct++;
			}
			// Speder2 の原曲はオクターブ跳躍が曲で 1〜5割（規則は3割以上）。他の流派は8分オクターブが主。
			if (
				song.stats.bassStyle !== "tresillo" &&
				(!nigo || /^octave/.test(song.stats.bassStyle))
			)
				check(
					`${tag} ベースがオクターブ往復`,
					pairs > 0 &&
						// 2号は骨格の差し替え小節が根音刻みになる曲がある。
						oct / pairs >=
							(lineage === "kaiwai_speder2" ? 0.3 : nigo ? 0.2 : 0.6),
					`${oct}/${pairs}`,
				);
			const onsetsByBar = new Map<number, number[]>();
			for (const n of bass) {
				const b = Math.floor(n.startStep / STEPS_PER_BAR);
				onsetsByBar.set(b, [
					...(onsetsByBar.get(b) ?? []),
					n.startStep % STEPS_PER_BAR,
				]);
			}
			const tresillo = [...onsetsByBar.values()].filter(
				(on) => on.includes(36) && on.includes(132),
			).length;
			if (lineage !== "kaiwai_speder2")
				m.tresilloBars.push(tresillo / Math.max(1, onsetsByBar.size));
			if (song.stats.bassStyle === "tresillo")
				check(
					`${tag} 3:3:2 のベースが小節の半分以上`,
					tresillo / Math.max(1, onsetsByBar.size) >= 0.5,
					`${tresillo}/${onsetsByBar.size}`,
				);
			if (lineage === "kaiwai_speder2") {
				const onBeat = bass.filter(
					(n) => n.startStep % 48 === 0 && n.startStep % STEPS_PER_BAR !== 0,
				).length;
				check(
					`${tag} ベースが拍頭をずらす（2〜4拍の頭が 2割以下）`,
					onBeat / Math.max(1, bass.length) <= 0.2,
					`${onBeat}/${bass.length}`,
				);
			} else if (nigo)
				m.bassCore.push(
					["octave-eighth", "tresillo"].includes(song.stats.bassStyle) ? 1 : 0,
				);
			else
				check(
					`${tag} ベースが8分オクターブか3:3:2`,
					["octave-eighth", "tresillo"].includes(song.stats.bassStyle),
					song.stats.bassStyle,
				);

			// --- 旋律 ---
			const mel = [...song.melody].sort((a, b) => a.startStep - b.startStep);
			const semis = mel.map((n) =>
				Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
			);
			// 音程は docs/kaiwai-lineages.md の測り方（8分以上の休符を挟む対は数えない）。
			let step = 0;
			let same = 0;
			let pairsMel = 0;
			for (let i = 1; i < semis.length; i++) {
				if (
					mel[i].startStep -
						(mel[i - 1].startStep + mel[i - 1].durationSteps) >=
					24
				)
					continue;
				pairsMel++;
				const d = Math.abs(semis[i] - semis[i - 1]);
				if (d === 0) same++;
				else if (d <= 2) step++;
			}
			m.step.push(step / Math.max(1, pairsMel));
			m.same.push(same / Math.max(1, pairsMel));
			m.six.push(
				mel.filter((n) => n.durationSteps <= STEPS_PER_BAR / 16).length /
					Math.max(1, mel.length),
			);
			m.dotted.push(
				mel.filter((n) => n.durationSteps === 36 && n.startStep % 48 === 0)
					.length / Math.max(1, mel.length),
			);
			m.triplet.push(
				mel.filter((n) => n.startStep % 16 === 0 && n.startStep % 12 !== 0)
					.length / Math.max(1, mel.length),
			);
			// 音の割合は音価で重み付けする（同上）。
			const pcs = melPcs(song);
			const durOf = (keep: (p: number) => boolean): number =>
				mel.reduce((a, n, i) => a + (keep(pcs[i]) ? n.durationSteps : 0), 0) /
				Math.max(
					1,
					mel.reduce((a, n) => a + n.durationSteps, 0),
				);
			m.penta.push(durOf((p) => PENTA.has(p)));
			const byPc = Array.from({ length: 12 }, (_, k) => durOf((p) => p === k));
			m.top5.push(
				[...byPc]
					.sort((a, b) => b - a)
					.slice(0, 5)
					.reduce((a, b) => a + b, 0),
			);
			m.fa.push(durOf((p) => p === 5));
			m.range.push(Math.max(...semis) - Math.min(...semis));

			// --- 構成 ---
			const first = song.sections[0];
			const layers = sectionsLayers(song);
			// 構成の規則は確率で入る（原曲が数曲しかないので全曲には入れない）。曲ごとには
			// 「置いたならその形」を見て、置いた割合は 30 曲の集計で見る。
			const intro = first.kind === "intro" ? first : null;
			if (lineage === "kaiwai_kaisen") {
				if (intro)
					check(
						`${tag} イントロに旋律が無い`,
						notesIn(song.melody, 0, intro.bars) === 0,
						`${intro.bars}`,
					);
				m.form.push(intro?.bars === 8 ? 1 : 0);
				const inter = song.sections.findIndex((s) => s.kind === "interlude");
				const sec = song.sections[inter];
				m.quiet.push(inter >= 0 ? 1 : 0);
				if (sec) {
					check(
						`${tag} 8小節の間奏で歌が引っ込む`,
						sec.bars === 8 &&
							notesIn(song.melody, sec.startBar, sec.startBar + 8) === 0,
						song.sections.map((s) => s.kind).join("-"),
					);
					const maxLayers = Math.max(...layers.values());
					check(
						`${tag} 間奏が一番厚い（間奏 ≥7 層）`,
						layers.get(inter) === maxLayers && (layers.get(inter) ?? 0) >= 7,
						[...layers.values()].join(","),
					);
				}
				if (intro)
					check(
						`${tag} イントロが薄い（≤3 層）`,
						(layers.get(0) ?? 9) <= 3,
						[...layers.values()].join(","),
					);
				const last = song.sections.at(-1);
				m.outro.push(last?.kind === "outro" ? 1 : 0);
				if (last?.kind === "outro")
					check(
						`${tag} 楽器だけのアウトロ`,
						notesIn(song.melody, last.startBar, song.bars) === 0,
						`${last.bars}`,
					);
				// 原曲の歌の重ねはオクターブ 4.5%・4〜5度 35%・3〜6度 27%・同音 18%。オクターブ下の全音重ねはしない。
				check(
					`${tag} オクターブ下の重ねが無い`,
					song.octave.length === 0,
					`${song.octave.length}`,
				);
				m.second.push(song.harmony.length > 0 ? 1 : 0);
				if (song.harmony.length > 0) {
					const at = new Map(
						song.melody.map((n) => [n.startStep, n.pitchUnits] as const),
					);
					const gaps = song.harmony.map((h) =>
						Math.round(
							((at.get(h.startStep) ?? h.pitchUnits) - h.pitchUnits) /
								UNITS_PER_SEMITONE,
						),
					);
					check(
						`${tag} 2本目の声は同時の音の同音〜5度下（オクターブで重ねない）`,
						gaps.every((g) => g >= 0 && g <= 7),
						gaps.slice(0, 12).join(","),
					);
				}
			}
			if (lineage === "kaiwai_2go") {
				const quiet = song.sections.filter(
					(s) =>
						s.kind !== "intro" &&
						notesIn(song.melody, s.startBar, s.startBar + s.bars) === 0,
				);
				check(
					`${tag} 歌（リード）が引っ込むセクションが無い`,
					quiet.length === 0,
					quiet.map((s) => s.kind).join(","),
				);
			}
			if (lineage === "kaiwai_speder2") {
				m.form.push(intro?.bars === 16 ? 1 : 0);
				if (intro) {
					const at = (k: number): number => Math.round((intro.bars * k) / 4);
					check(
						`${tag} 旋律なしのイントロで層を足していく（ベース・サブメロが4分の1・4分の3から）`,
						notesIn(song.melody, 0, intro.bars) === 0 &&
							notesIn(song.bass, 0, at(1)) === 0 &&
							notesIn(song.bass, at(1), intro.bars) > 0 &&
							notesIn(song.pad, 0, at(2)) === 0 &&
							notesIn(song.submelody, 0, at(3)) === 0 &&
							notesIn(song.submelody, at(3), intro.bars) > 0,
						`intro${intro.bars} bass ${notesIn(song.bass, 0, at(1))}/${notesIn(song.bass, at(1), intro.bars)} sub ${notesIn(song.submelody, 0, at(3))}/${notesIn(song.submelody, at(3), intro.bars)}`,
					);
				}
				// 1小節の型の繰り返し：歌のあるセクションの小節が、そのセクションの1小節目と同じリズム
				const keyOf = (bar: number, withPitch: boolean): string =>
					song.melody
						.filter(
							(n) =>
								n.startStep >= bar * STEPS_PER_BAR &&
								n.startStep < (bar + 1) * STEPS_PER_BAR,
						)
						.map(
							(n) =>
								`${n.startStep % STEPS_PER_BAR}:${n.durationSteps}${withPitch ? `:${n.pitchUnits}` : ""}`,
						)
						.join(",");
				let same1 = 0;
				let total1 = 0;
				let prev1 = 0;
				let recur = 0;
				for (const s of song.sections) {
					if (!s.spec.melody) continue;
					const head = keyOf(s.startBar, name.endsWith("_lead"));
					for (let b = s.startBar + 1; b < s.startBar + s.bars; b++) {
						if (b === song.bars - 1) continue;
						total1++;
						const k = keyOf(b, name.endsWith("_lead"));
						if (k === head) same1++;
						if (k === keyOf(b - 1, true)) prev1++;
						if (b - 2 >= s.startBar && k === keyOf(b - 2, true)) recur++;
					}
				}
				m.barLoop.push(same1 / Math.max(1, total1) >= 0.8 ? 1 : 0);
				m.repeatPrev.push(prev1 / Math.max(1, total1));
				m.form2.push(recur / Math.max(1, total1));
			}
			if (name.endsWith("_lead")) {
				let sounding = 0;
				let span = 0;
				for (const s of song.sections) {
					if (!s.spec.melody) continue;
					span += s.bars * STEPS_PER_BAR;
					sounding += song.melody
						.filter(
							(n) =>
								n.startStep >= s.startBar * STEPS_PER_BAR &&
								n.startStep < (s.startBar + s.bars) * STEPS_PER_BAR,
						)
						.reduce((a, n) => a + n.durationSteps, 0);
				}
				m.occupancy.push(sounding / Math.max(1, span));
				m.plain.push(
					song.harmony.length === 0 && song.octave.length === 0 ? 1 : 0,
				);
			}
			if (name === "kaiwai_2go_lead") {
				const meanOf = (kind: string): number => {
					const ps = song.melody
						.filter((n) => {
							const s = song.sections.find(
								(x) =>
									n.startStep >= x.startBar * STEPS_PER_BAR &&
									n.startStep < (x.startBar + x.bars) * STEPS_PER_BAR,
							);
							return s?.kind === kind;
						})
						.map((n) => n.pitchUnits / UNITS_PER_SEMITONE);
					return avg(ps);
				};
				m.lift.push(meanOf("chorus") - meanOf("verse"));
			}
		}
		check(`${name} 例外なし`, threw === 0, `${threw}/${N}`);
		const f = (xs: number[]): string => avg(xs).toFixed(3);
		// --- 30曲の平均で見る規則 ---
		if (lineage === "kaiwai_kaisen") {
			check("海鮮: ラドレミソが旋律の9割以上", avg(m.penta) >= 0.9, f(m.penta));
			check("海鮮: ファが 3% 未満", avg(m.fa) < 0.03, f(m.fa));
			// 規則は 64%。ファ抜き・シ少しへ寄せた後は 5割前後まで（比較群 55%）。
			check("海鮮: 2度が隣接音程の 45% 以上", avg(m.step) >= 0.45, f(m.step));
			check("海鮮: 同音連打が 12% 以下", avg(m.same) <= 0.12, f(m.same));
			check("海鮮: 16分の音価が 15% 以下", avg(m.six) <= 0.15, f(m.six));
			check("海鮮: 拍内の付点が出る", avg(m.dotted) > 0, f(m.dotted));
			check(
				"海鮮: Ⅵm（Am 系）が和音の 2割以上",
				avg(m.amShare) >= 0.2,
				f(m.amShare),
			);
			check(
				"海鮮: 4度上への根音進行が 3割以上",
				avg(m.fourthUp) >= 0.3,
				f(m.fourthUp),
			);
			check(
				"海鮮: 旋律なし8小節イントロの曲が 6割以上（全曲ではない）",
				avg(m.form) >= 0.6 && avg(m.form) < 1,
				f(m.form),
			);
			check(
				"海鮮: 歌が引っ込む間奏の曲が 4割5分以上（全曲ではない）",
				avg(m.quiet) >= 0.45 && avg(m.quiet) < 1,
				f(m.quiet),
			);
			check(
				"海鮮: 楽器だけのアウトロの曲が 5割5分以上（全曲ではない）",
				avg(m.outro) >= 0.55 && avg(m.outro) < 1,
				f(m.outro),
			);
			check(
				"海鮮: 2本目の声を付ける曲が 4割以上（全曲ではない）",
				avg(m.second) >= 0.4 && avg(m.second) < 1,
				f(m.second),
			);
			check(
				"海鮮: 3:3:2 の小節が 15% 以上の曲が出る",
				m.tresilloBars.some((x) => x >= 0.15),
				m.tresilloBars.map((x) => x.toFixed(2)).join(" "),
			);
		}
		if (lineage === "kaiwai_2go")
			check(
				"2号: 4つ打ちの曲が 6割以上（全曲ではない）",
				avg(m.four) >= 0.6 && avg(m.four) < 1,
				f(m.four),
			);
		if (lineage === "kaiwai_2go") {
			check("2号: 旋律がドレミソラ 7割以上", avg(m.penta) >= 0.7, f(m.penta));
			check(
				"2号: セブンスが拍の8割以上（平均）",
				avg(m.seventh) >= 0.8,
				f(m.seventh),
			);
			check("2号: ⅣM7（FM7）のある曲が 7割以上", avg(m.fm7) >= 0.7, f(m.fm7));
			check(
				"2号: ベースが8分オクターブか3:3:2 の曲が 4割以上（全曲ではない）",
				avg(m.bassCore) >= 0.4 && avg(m.bassCore) < 1,
				f(m.bassCore),
			);
			check(
				"2号: 2-5 が和音の変わり目の 5% 以上ある曲が 7割以上",
				m.twoFive.filter((x) => x >= 0.05).length >= m.twoFive.length * 0.7,
				m.twoFive.map((x) => x.toFixed(2)).join(" "),
			);
			// 歌の版は既存の語彙（16分グルーヴ）までで、実測は 3割弱（規則は 47%）。
			check(
				"2号: 16分の音価が 2割5分以上",
				avg(m.six) >= (name.endsWith("_lead") ? 0.4 : 0.25),
				f(m.six),
			);
			if (name.endsWith("_lead")) {
				check("2号（楽器リード）: 3連が出る", avg(m.triplet) > 0, f(m.triplet));
				check(
					"2号（楽器リード）: ハモリ・オクターブ重ねの無い曲が 3割以上（全曲ではない）",
					avg(m.plain) >= 0.3 && avg(m.plain) < 1,
					f(m.plain),
				);
				// 原曲のリードの占有は 77〜93%（平均 87%）。句末で息を継ぐ。
				check(
					"2号（楽器リード）: リードがほぼ鳴り続ける（占有 8割以上）",
					avg(m.occupancy) >= 0.8,
					f(m.occupancy),
				);
				// リードはサビで交代するかオクターブ上へ移る（原曲のリードの音域は 13〜22 半音で、全曲で上げると超える）。
				const lifted = m.lift.filter((x) => x >= 9).length / m.lift.length;
				check(
					"2号（楽器リード）: サビでオクターブ上へ移る曲が 3〜8割（全曲ではない）",
					lifted >= 0.3 && lifted <= 0.8,
					lifted.toFixed(2),
				);
				check(
					"2号（楽器リード）: 音域が広い（平均 20 半音以上）",
					avg(m.range) >= 20,
					f(m.range),
				);
			}
		}
		if (lineage === "kaiwai_speder2") {
			check("Speder2: 旋律の上位5音が9割以上", avg(m.top5) >= 0.9, f(m.top5));
			check(
				"Speder2: 旋律なし16小節イントロの曲が 4割以上（全曲ではない）",
				avg(m.form) >= 0.4 && avg(m.form) < 1,
				f(m.form),
			);
			// 歌の版は詠唱を1小節の型で回す曲がある。楽器リードは原曲4曲とも同じ小節を続けて鳴らさない
			// （前の小節と同一 0〜15%）が、小節は再び出る（4小節ブロック [x y x z]）。
			if (name.endsWith("_lead")) {
				check(
					"Speder2（楽器リード）: 前の小節と同一の小節が 2割以下",
					avg(m.repeatPrev) <= 0.2,
					f(m.repeatPrev),
				);
				check(
					"Speder2（楽器リード）: 2小節前の小節が再び出る（平均 3割以上）",
					avg(m.form2) >= 0.3,
					f(m.form2),
				);
			} else
				check(
					"Speder2: 1小節の型をそのまま繰り返す曲が 3割以上（全曲ではない）",
					avg(m.barLoop) >= 0.3 && avg(m.barLoop) < 1,
					f(m.barLoop),
				);
			check(
				"Speder2: 16分裏のハットが1小節2打以上の曲が 6割以上",
				avg(m.hat16) >= 0.6,
				f(m.hat16),
			);
		}
		console.log(
			`  ${name.padEnd(20)} 2度 ${f(m.step)} / 同音 ${f(m.same)} / 16分 ${f(m.six)} / 付点 ${f(m.dotted)} / 3連 ${f(m.triplet)} / 5音 ${f(m.penta)} / ファ ${f(m.fa)} / 音域 ${avg(m.range).toFixed(1)} / Am ${f(m.amShare)} / 4度上 ${f(m.fourthUp)} / 7th ${f(m.seventh)} / 2-5 ${f(m.twoFive)} / 3:3:2小節 ${f(m.tresilloBars)} / 1小節反復の曲 ${f(m.barLoop)} / 占有 ${f(m.occupancy)} / サビ上げ ${avg(m.lift).toFixed(1)} / 規則のイントロ ${f(m.form)} / 引っ込む間奏 ${f(m.quiet)} / アウトロ ${f(m.outro)} / 4つ打ち ${f(m.four)} / 16分裏ハット ${f(m.hat16)}`,
		);
	}
}

// ============================================================
// 2.96 界隈曲の流派テンプレートの幅
//     規則を満たす範囲で曲ごとに違うものが出るか（scratch/_variety.ts と同じ数え方・同じ種）。
//     リードの半小節の形は、発音位置と音程の列（移調に依らない）。1音だけ・同音だけの形は数えない。
//     上物（上級者モードの t3・t6〜t10・t12・t14）の1小節の形は、層・発音位置・最低音からの半音差。
//     原曲どうしで共通する上物の形は 1〜4%（試聴で「前の曲の上物が次の曲にも出る」と言われた版は 12〜33%）。
// ============================================================

console.log("● 界隈曲の流派テンプレートの幅");
{
	const N = 100;
	const LIMITS: Record<string, { prog: number; shapes?: number }> = {
		kaiwai_kaisen: { prog: 60 },
		kaiwai_2go: { prog: 60 },
		kaiwai_2go_lead: { prog: 60, shapes: 300 },
		kaiwai_speder2: { prog: 25 },
		kaiwai_speder2_lead: { prog: 25, shapes: 150 },
	};
	for (const [name, lim] of Object.entries(LIMITS)) {
		const prog = new Set<string>();
		const drums = new Set<string>();
		const forms = new Set<string>();
		const shapes = new Map<string, Set<number>>();
		const uppers: Set<string>[] = [];
		for (let seed = 1; seed <= N; seed++) {
			const song = composeSong({
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				template: name,
				baseKey: "any",
				scale: "auto",
				random: appSeededRandom(seed),
			});
			prog.add(song.chordProgression.split("|").slice(0, 8).join("|"));
			drums.add(song.drum);
			forms.add(song.sections.map((x) => `${x.kind}${x.bars}`).join("-"));
			const upper = new Set<string>();
			for (const l of buildAdvancedLayers(song, {
				stepsPerBar: STEPS_PER_BAR,
				preset: INSTRUMENT_PRESETS[song.instrument],
			})) {
				if (![3, 6, 7, 8, 9, 10, 12, 14].includes(l.index)) continue;
				const byBar = new Map<number, typeof l.notes>();
				for (const n of l.notes) {
					const b = Math.floor(n.startStep / STEPS_PER_BAR);
					byBar.set(b, [...(byBar.get(b) ?? []), n]);
				}
				for (const ns of byBar.values()) {
					if (ns.length < 2) continue;
					const lo = Math.min(...ns.map((n) => n.pitchUnits));
					upper.add(
						`${l.index}|${ns
							.map(
								(n) =>
									`${n.startStep % STEPS_PER_BAR}:${Math.round((n.pitchUnits - lo) / UNITS_PER_SEMITONE)}`,
							)
							.sort()
							.join(",")}`,
					);
				}
			}
			uppers.push(upper);
			if (!lim.shapes) continue;
			const half = STEPS_PER_BAR / 2;
			const byHalf = new Map<number, typeof song.melody>();
			for (const n of [...song.melody].sort(
				(a, b) => a.startStep - b.startStep,
			)) {
				const h = Math.floor(n.startStep / half);
				byHalf.set(h, [...(byHalf.get(h) ?? []), n]);
			}
			for (const ns of byHalf.values()) {
				const p = ns.map((n) => Math.round(n.pitchUnits / UNITS_PER_SEMITONE));
				if (p.every((x) => x === p[0])) continue;
				const key = ns
					.map((n, i) => `${n.startStep % half}:${i ? p[i] - p[i - 1] : 0}`)
					.join(",");
				if (!shapes.has(key)) shapes.set(key, new Set());
				shapes.get(key)?.add(seed);
			}
		}
		check(
			`${name}: 冒頭8小節の進行が ${lim.prog} 種以上（${N}曲）`,
			prog.size >= lim.prog,
			`${prog.size}`,
		);
		check(`${name}: ドラムの型が3種以上`, drums.size >= 3, `${drums.size}`);
		check(
			`${name}: 構成が30種以上（${N}曲）`,
			forms.size >= 30,
			`${forms.size}`,
		);
		const upperCount = new Map<string, number>();
		for (const u of uppers)
			for (const k of u) upperCount.set(k, (upperCount.get(k) ?? 0) + 1);
		let pairShare = 0;
		let pairs = 0;
		for (let i = 0; i < uppers.length; i++)
			for (let j = i + 1; j < uppers.length; j++) {
				let common = 0;
				for (const k of uppers[i]) if (uppers[j].has(k)) common++;
				pairShare +=
					common / Math.max(1, Math.min(uppers[i].size, uppers[j].size));
				pairs++;
			}
		pairShare /= Math.max(1, pairs);
		const upperTop = Math.max(0, ...upperCount.values());
		check(
			`${name}: 上物の1小節の形が曲の対で共有される割合が平均 5% 未満`,
			pairShare < 0.05,
			pairShare.toFixed(3),
		);
		check(
			`${name}: どの上物の形も ${N}曲中 25曲未満`,
			upperTop < 25,
			`${upperTop}`,
		);
		let line = `  ${name.padEnd(20)} 進行 ${prog.size} / ドラム ${drums.size} / 構成 ${forms.size} / 上物の形 ${upperCount.size}（2曲以上 ${((100 * [...upperCount.values()].filter((v) => v >= 2).length) / Math.max(1, upperCount.size)).toFixed(1)}%・対の共有 ${(pairShare * 100).toFixed(1)}%・最多 ${upperTop}曲）`;
		if (lim.shapes) {
			const most = Math.max(0, ...[...shapes.values()].map((x) => x.size));
			check(
				`${name}: リードの半小節の形が ${lim.shapes} 種以上`,
				shapes.size >= lim.shapes,
				`${shapes.size}`,
			);
			check(`${name}: どの形も ${N}曲中 50曲未満`, most < 50, `${most}`);
			line += ` / 半小節の形 ${shapes.size}（最多 ${most}曲）`;
		}
		console.log(line);
	}
}

// ============================================================
// 3. 31平均律でも成立するか
// ============================================================

console.log("● 31平均律");
for (let seed = 1; seed <= 20; seed++) {
	const song = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		edo: 31,
		random: seededRandom(seed * 7919),
	});
	const allUnits = [...song.melody, ...song.submelody, ...song.bass].map(
		(n) => n.pitchUnits,
	);
	check(
		`edo31 seed=${seed} 全音が31平均律の格子に乗る`,
		allUnits.every((u) => u % 12 === 0),
		"格子から外れた音がある",
	);
	check(
		`edo31 seed=${seed} 音域が妥当`,
		allUnits.every((u) => u > 0 && u < 3937),
		"音域外の音がある",
	);
}

// ============================================================
// 4. エントロピー計算そのもの
// ============================================================

console.log("● durationEntropy");
check(
	"全部同じ音価なら0bit",
	durationEntropy([48, 48, 48, 48]) === 0,
	`${durationEntropy([48, 48, 48, 48])}`,
);
check(
	"2種が等分なら1bit",
	Math.abs(durationEntropy([48, 96, 48, 96]) - 1) < 1e-9,
	`${durationEntropy([48, 96, 48, 96])}`,
);
check("空配列は0bit", durationEntropy([]) === 0, `${durationEntropy([])}`);

// ============================================================
// 5. 調性格論に基づくベース調・雰囲気のテスト
// ============================================================

console.log("● ベース調・雰囲気（調性格論）");
{
	const keys = Object.values(COMPOSE_KEYS);
	check("24調が定義されている", keys.length === 24, `${keys.length}`);
	const majorKeys = keys.filter((k) => k.mode === "major");
	const minorKeys = keys.filter((k) => k.mode === "minor");
	check("長調が12調ある", majorKeys.length === 12, `${majorKeys.length}`);
	check("短調が12調ある", minorKeys.length === 12, `${minorKeys.length}`);
	check(
		"8つの雰囲気グループがある",
		COMPOSE_MOOD_GROUPS.length === 8,
		`${COMPOSE_MOOD_GROUPS.length}`,
	);

	const allGroupedKeyIds = COMPOSE_MOOD_GROUPS.flatMap((g) => g.keyIds);
	check(
		"24調すべてがいずれかの雰囲気グループに属している",
		allGroupedKeyIds.length === 24,
		`${allGroupedKeyIds.length}`,
	);

	// 個別指定の解決
	const keyD = resolveComposeKey("key_D");
	check(
		"key_D はニ長調 (rootShift=2, mode=major)",
		keyD.mode === "major" && keyD.rootShift === 2 && keyD.keyName === "D",
		JSON.stringify(keyD),
	);

	const keyAm = resolveComposeKey("key_Am");
	check(
		"key_Am はイ短調 (rootShift=0, mode=minor)",
		keyAm.mode === "minor" && keyAm.rootShift === 0 && keyAm.keyName === "Am",
		JSON.stringify(keyAm),
	);

	// 雰囲気からの抽選（決定的な乱数で確認）
	const mockRnd0 = () => 0; // 最初のアイテムを選択

	const moodHappyFirst = resolveComposeKey("mood_happy", mockRnd0);
	check(
		"mood_happy の先頭は C (ハ長調)",
		moodHappyFirst.keyName === "C" && moodHappyFirst.mode === "major",
		JSON.stringify(moodHappyFirst),
	);

	const moodTriumphant = resolveComposeKey("mood_triumphant", mockRnd0);
	check(
		"mood_triumphant の先頭は D (ニ長調)",
		moodTriumphant.keyName === "D" && moodTriumphant.mode === "major",
		JSON.stringify(moodTriumphant),
	);

	const moodPlaintive = resolveComposeKey("mood_plaintive", mockRnd0);
	check(
		"mood_plaintive の先頭は Cm (ハ短調)",
		moodPlaintive.keyName === "Cm" && moodPlaintive.mode === "minor",
		JSON.stringify(moodPlaintive),
	);

	// composeSong への baseKey 指定
	const songD = composeSong({
		stepsPerBar: 192,
		baseKey: "key_D",
		random: seededRandom(42),
	});
	check(
		"baseKey: key_D で生成された曲の rootShift は 2",
		songD.rootShift === 2,
		`rootShift=${songD.rootShift}`,
	);
	check(
		"baseKey: key_D で生成された曲の keyName は D",
		songD.keyName === "D",
		`keyName=${songD.keyName}`,
	);

	const songMinor = composeSong({
		stepsPerBar: 192,
		baseKey: "key_Am",
		random: seededRandom(100),
	});
	check(
		"baseKey: key_Am で生成された曲の rootShift は 0",
		songMinor.rootShift === 0,
		`rootShift=${songMinor.rootShift}`,
	);
	check(
		"baseKey: key_Am で生成された曲の keyName は Am",
		songMinor.keyName === "Am",
		`keyName=${songMinor.keyName}`,
	);
	// 短調進行のAメロの最初の和音は Am であること
	const verseSection = songMinor.sections.find((s) => s.kind === "verse");
	const verseStartBar = verseSection?.startBar ?? 0;
	const verseChord = songMinor.chordProgression.split("|")[verseStartBar];
	check(
		"短調指定の曲のAメロ開始和音が Am",
		verseChord.startsWith("Am"),
		`verseChord=${verseChord}`,
	);
}

// ============================================================
// 6. 音階のテスト
// ============================================================
//
// **音階は「その音を使わないこと」で成り立つ。** 琉球音階の色はレとラを抜く
// ことそのものなので、生成物にレとラが混ざれば音階を選んだ意味が消える。
// ここでは音階ごとに曲を作り、実際に鳴った音のピッチクラスを数えて、
// 中核の5音から外れた音がどれだけ紛れ込んだかを測る。

console.log("● 音階");
{
	const SCALE_SEEDS = 24;

	for (const id of COMPOSE_SCALE_IDS) {
		const scale = COMPOSE_SCALES[id];
		// **音程集合は音階ごとに違う**（{@link ComposeScale.parent}）。ハ長調決め打ちで
		// 数えると、ブルース音階のミ♭がハ長調に無いというだけで「調の外」に化ける。
		const core = corePcs(scale);
		const inScale = scalePcs(scale);
		const tag = scale.label;
		const seen = new Set<number>();
		let notes = 0;
		let outside = 0;
		let harmonyNotes = 0;
		let harmonyOutside = 0;
		let tonicChordBars = 0;
		const center = resolveCenter(scale);

		for (let seed = 1; seed <= SCALE_SEEDS; seed++) {
			const song = composeSong({
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				scale: id,
				random: seededRandom(seed * 31 + 7),
			});
			check(
				`${tag} seed=${seed} 音階IDが結果に載る`,
				song.scaleId === id,
				`${song.scaleId}`,
			);
			check(
				`${tag} seed=${seed} 総合点`,
				song.stats.score >= 0.6,
				`${song.stats.score.toFixed(3)}`,
			);
			check(
				`${tag} seed=${seed} メロディが同じ音の連打になっていない`,
				song.stats.melodyRange >= 3,
				`${song.stats.melodyRange}半音`,
			);
			for (const n of song.melody) {
				// 曲全体の移調を戻して、ハ長調の座標で数える。
				const semi = Math.round(n.pitchUnits / UNITS_PER_SEMITONE);
				const pc = (((semi - song.rootShift) % 12) + 12) % 12;
				notes++;
				if (core.has(pc)) seen.add(pc);
				else if (inScale.has(pc)) outside++;
			}
			// **ハモリも歌声。** 和音構成音から選ぶ作りなので、放っておくと音階の外を
			// 歌う（琉球音階の `F` の上でラ、など）。旋律と同じ物差しで測る。
			for (const n of [...song.harmony, ...song.harmony2]) {
				const semi = Math.round(n.pitchUnits / UNITS_PER_SEMITONE);
				const pc = (((semi - song.rootShift) % 12) + 12) % 12;
				harmonyNotes++;
				if (!core.has(pc) && inScale.has(pc)) harmonyOutside++;
			}
			// 進行が音階の主音を指しているか。**旋律だけモードにして和音が
			// ハ長調のトニックを指していると、曲は結局ハ長調に聞こえる。**
			if (center) {
				// 1小節に複数の和音が入る曲がある（半小節進行）。`tonicPattern` は
				// `^` 始まりなので、小節の文字列のまま当てると2つ目の和音が
				// 主和音でも当たらない。和音ごとにばらして当てる。
				const chords = song.chordProgression
					.split("|")
					.flatMap((bar) => bar.trim().split(/\s+/));
				if (chords.some((c) => center.tonicPattern.test(c))) tonicChordBars++;
			}
		}

		check(
			`${tag} 中核の5音がすべて使われる`,
			seen.size === core.size,
			`${seen.size}/${core.size}音`,
		);
		// **strict な音階（本物の5音音階）は中核の外を8%まで。** 陽・民謡・モード・
		// 和声的短音階は中核の外も音階の構成音なので、絶対値ではなく
		// 「偶然そうなった水準」と比べる——音階の音を均等に使えば中核の外は
		// (音数 - 中核数) / 音数（7音音階なら28.6%）になるので、その3/4を上限に置く。
		const ratio = notes === 0 ? 1 : outside / notes;
		const size = scaleDegrees(scale).length;
		// **上限は参考曲から採る。**
		//
		// ここは長らく `((size - core) / size) * 0.75` という手作りの式で、陽・民謡なら
		// 21.4% だった。ところが参考曲91本を同じ物差しで測ると中核外は
		// **p25 12.7% / p50 21.4% / p75 28.1% / p95 39.0%** ——**中央値が上限と同値**で、
		// **人間の曲の49%がこの上限を超える**。生成器だけが、コーパス自身が半分落ちる
		// 音階純度を守らされていた。
		//
		// その制約のせいで、借りてきたフレーズ（{@link CORPUS_PHRASES} はダイアトニックの
		// 度数で持つ）を5音の歩数へ潰す必要があり、2度と3度が同じ歩数に丸まって
		// 旋律の顔が消えていた。上限を人間の範囲へ合わせれば潰さずに置ける。
		//
		// `strict` な音階（琉球・都節・律・ブルース）は別。あれは「その5音である」ことが
		// 音階の定義なので、外れた時点で別の音階になる。
		const limit = scale.strict ? 0.08 : 0.3;
		check(
			`${tag} 中核外の音が ${(limit * 100).toFixed(0)}% 以下`,
			ratio <= limit,
			`${(ratio * 100).toFixed(1)}%`,
		);
		// ハモリは和音に従う都合上、旋律ほどは締められない。倍までを許す。
		const hRatio = harmonyNotes === 0 ? 0 : harmonyOutside / harmonyNotes;
		if (scale.strict)
			check(
				`${tag} ハモリの中核外が ${(limit * 200).toFixed(0)}% 以下`,
				hRatio <= limit * 2,
				`${(hRatio * 100).toFixed(1)}%`,
			);
		if (center)
			check(
				`${tag} 進行が音階の主和音を含む`,
				tonicChordBars === SCALE_SEEDS,
				`${tonicChordBars}/${SCALE_SEEDS}曲`,
			);
		console.log(
			`  ${tag.padEnd(20)} 旋律の中核外 ${(ratio * 100).toFixed(1)}% / ハモリ ${(hRatio * 100).toFixed(1)}% / 進行の中心 ${center ? center.tonic : "長調・短調の既定"}`,
		);
	}

	// **31平均律でも綴りが決まるか。** 音程集合を差し替えた音階はソ♯やミ♭を
	// 持つので、五度圏インデックス（{@link ScaleDegree.fifth}）を書き間違えると
	// 31平均律で異名同音が別の高さへ散る。12の倍数（＝31平均律の1度）に
	// 乗っていない音が出たら、綴りがどこかで落ちている。
	for (const id of COMPOSE_SCALE_IDS) {
		const scale = COMPOSE_SCALES[id];
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 31,
			scale: id,
			random: seededRandom(4242),
		});
		const offGrid = [
			...song.melody,
			...song.submelody,
			...song.bass,
			...song.harmony,
		].filter((n) => n.pitchUnits % 12 !== 0).length;
		check(
			`${scale.label} 31平均律で格子に乗る`,
			offGrid === 0,
			`${offGrid}音が格子外`,
		);
	}

	// **親音階を差し替える音階は進行プールを自前で持つ。** 持たないとハ長調の
	// 和音が当たり、音階に無い音が伴奏から鳴る。
	for (const id of COMPOSE_SCALE_IDS) {
		const scale = COMPOSE_SCALES[id];
		if (!scale.parent) continue;
		check(
			`${scale.label} は専用の進行プールを持つ`,
			scale.center !== undefined,
			"center が無い",
		);
		check(
			`${scale.label} の主音は音程集合の中にある`,
			scale.tonic < scaleDegrees(scale).length,
			`tonic=${scale.tonic} / ${scaleDegrees(scale).length}音`,
		);
	}

	// 未指定は従来どおり（陽＝長調／民謡＝短調）。
	const auto = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		baseKey: "key_Am",
		random: seededRandom(1),
	});
	check("音階未指定 + 短調は民謡音階", auto.scaleId === "minyo", auto.scaleId);
	const autoMajor = composeSong({
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		baseKey: "key_C",
		random: seededRandom(1),
	});
	check(
		"音階未指定 + 長調は陽音階",
		autoMajor.scaleId === "yo",
		autoMajor.scaleId,
	);
}

// ============================================================
// 2.10 骨格借用（`src/compose/compose-skeleton.ts`）
//
//     fixture の骨格2本（scripts/test/fixtures/skeleton-fixture.ts）と実データ
//     （src/compose/compose-skeletons.ts、抽出の出力）のそれぞれで seed 1..20 を回し、
//     「壊れていない」ことだけを見る：骨格データの不変条件（validateSkeletons）・例外なし・
//     全和音が解析できる・旋律が音階内と歌える帯（MELODY_LOW〜HIGH）・ベースの音域・決定性・
//     アルペジオは arp 小節だけ・セクションが小節を覆う・"original" と "phrases" で旋律の度数列が
//     違う・DAW 経路の伴奏（chordProgression + rootShift）の構成音に小節頭のベース音が乗る
//     （進行を移調済みで返すと二重移調になる。その検出）。
//     共通経路に触れていないことは 1.7 の黄金値が見る（骨格借用の出力は同じファイルの skeleton
//     キー）。元曲との近さの数値は scripts/corpus/check-skeleton-closeness.ts。
// ============================================================

console.log("● 骨格借用");
{
	const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === "kaiwai_skeleton");
	check("kaiwai_skeleton テンプレートがある", tmpl !== undefined, "無い");
	check(
		"kaiwai_skeleton は engine: skeleton",
		tmpl?.engine === "skeleton",
		String(tmpl?.engine),
	);
	if (tmpl) {
		const drumKeys = new Set(Object.keys(DRUM_PATTERNS));
		if (KAIWAI_SKELETONS.length === 0)
			console.log(
				"  skip: 骨格データ（src/compose/compose-skeletons.ts）が無い。fixture だけで検査する",
			);
		else
			check(
				"実データの骨格が 50 本以上",
				KAIWAI_SKELETONS.length >= 50,
				`${KAIWAI_SKELETONS.length}`,
			);
		for (const [label, list] of (
			[
				["fixture", FIXTURE_SKELETONS],
				["実データ", KAIWAI_SKELETONS],
			] as const
		).filter(([, l]) => l.length > 0)) {
			const errors = validateSkeletons(list, drumKeys);
			check(
				`骨格データ（${label}）が不変条件を満たす`,
				errors.length === 0,
				errors.slice(0, 5).join(" / "),
			);
		}
		for (const set of [
			{ label: "fixture", skeletons: FIXTURE_SKELETONS },
			...(KAIWAI_SKELETONS.length > 0
				? [{ label: "実データ", skeletons: KAIWAI_SKELETONS }]
				: []),
		]) {
			const skeletonById = new Map(set.skeletons.map((s) => [s.id, s]));
			const semiOf = (u: number): number => Math.round(u / UNITS_PER_SEMITONE);
			const pc = (v: number): number => ((v % 12) + 12) % 12;
			const run = (seed: number, melodySource: "phrases" | "original") =>
				composeSkeleton(
					{
						stepsPerBar: STEPS_PER_BAR,
						edo: 12,
						baseKey: "any",
						scale: "auto",
						random: appSeededRandom(seed),
						melodySource,
					},
					tmpl,
					set.skeletons,
					LOCAL.phrases ?? SYNTH_PHRASES,
				);
			/** 小節ごとの旋律を音階度数の列に戻す（移調を戻し、pc → 度数）。 */
			const degreeRows = (
				song: ReturnType<typeof run>,
			): Map<number, number[]> => {
				const scale = COMPOSE_SCALES[song.scaleId];
				const degs = scaleDegrees(scale).map((d) => pc(d.semi));
				const rows = new Map<number, number[]>();
				for (const n of song.melody) {
					const b = Math.floor(n.startStep / STEPS_PER_BAR);
					const p = pc(semiOf(n.pitchUnits) - song.rootShift);
					const row = rows.get(b) ?? [];
					row.push(degs.indexOf(p));
					rows.set(b, row);
				}
				return rows;
			};
			let differingBarsTotal = 0;
			let sungBarsTotal = 0;
			let bassHeads = 0;
			let bassHeadsOnChord = 0;
			for (let seed = 1; seed <= 20; seed++) {
				const tag = `骨格借用[${set.label}] seed=${seed}`;
				let song: ReturnType<typeof run>;
				try {
					song = run(seed, "phrases");
				} catch (e) {
					check(`${tag} 例外なし`, false, String(e));
					continue;
				}
				const skel = skeletonById.get(song.skeletonId ?? "");
				check(
					`${tag} skeletonId が骨格の一つ`,
					skel !== undefined,
					String(song.skeletonId),
				);
				if (!skel) continue;
				check(`${tag} form が skeleton`, song.form === "skeleton", song.form);
				check(`${tag} bpm が骨格どおり`, song.bpm === skel.bpm, `${song.bpm}`);
				check(
					`${tag} bars が骨格どおり`,
					song.bars === skel.bars,
					`${song.bars}`,
				);
				check(`${tag} drum が骨格どおり`, song.drum === skel.drum, song.drum);
				check(
					`${tag} 奏法が骨格どおり`,
					song.chordPattern === skel.chordPattern,
					song.chordPattern,
				);
				check(
					`${tag} 調の長短が骨格に合う`,
					song.keyName.endsWith("m") === (skel.mode === "minor"),
					`${song.keyName} / ${skel.mode}`,
				);

				// 決定性
				const again = run(seed, "phrases");
				check(
					`${tag} 決定的`,
					JSON.stringify(again) === JSON.stringify(song),
					"同じ seed で違う曲",
				);

				// 全和音が解析できる・小節数が合う
				const bars = song.chordProgression.split("|");
				check(
					`${tag} 進行の小節数`,
					bars.length === song.bars,
					`${bars.length}`,
				);
				const unparsable = bars
					.flatMap((b) => b.trim().split(/\s+/))
					.filter((c) => {
						try {
							parseChord(c);
							return false;
						} catch {
							return true;
						}
					});
				check(
					`${tag} 進行の全和音が解析できる`,
					unparsable.length === 0,
					unparsable.join(" "),
				);

				// 旋律が音階内（移調を戻して pc を見る）
				const pcs = scalePcs(COMPOSE_SCALES[song.scaleId]);
				const outside = song.melody.filter(
					(n) => !pcs.has(pc(semiOf(n.pitchUnits) - song.rootShift)),
				);
				check(
					`${tag} 旋律が音階内`,
					outside.length === 0,
					`${outside.length}音が外`,
				);
				check(`${tag} 旋律がある`, song.melody.length > 0, "0音");
				// 歌える帯（移調後の実音）
				const melSemis = song.melody.map((n) => semiOf(n.pitchUnits));
				check(
					`${tag} 旋律が ${MELODY_LOW}〜${MELODY_HIGH}`,
					melSemis.every((v) => v >= MELODY_LOW && v <= MELODY_HIGH),
					`${Math.min(...melSemis)}〜${Math.max(...melSemis)}`,
				);
				// DAW 経路の伴奏（進行は基準調、移調は rootShift）の構成音に小節頭のベース音が乗る
				{
					const spans: { start: number; end: number; pcs: Set<number> }[] = [];
					for (const pl of buildChordPlacements({
						edo: 12,
						chordStr: song.chordProgression,
						patternType: "block",
						rootShift: song.rootShift,
						bpm: 120,
						stepsPerBar: STEPS_PER_BAR,
					})) {
						const hit = spans.find((x) => x.start === pl.startStep);
						if (hit) hit.pcs.add(pc(semiOf(pl.pitchUnits)));
						else
							spans.push({
								start: pl.startStep,
								end: pl.startStep + pl.durationSteps,
								pcs: new Set([pc(semiOf(pl.pitchUnits))]),
							});
					}
					for (const n of song.bass) {
						if (n.startStep % STEPS_PER_BAR !== 0) continue;
						const span = spans.find(
							(x) => n.startStep >= x.start && n.startStep < x.end,
						);
						if (!span) continue;
						bassHeads++;
						if (span.pcs.has(pc(semiOf(n.pitchUnits)))) bassHeadsOnChord++;
					}
				}
				// 歌う小節だけに旋律がある
				const sungSet = new Set(
					skel.barsData
						.map((b, i) => (b.melody ? i : -1))
						.filter((i) => i >= 0),
				);
				const melodyBars = new Set(
					song.melody.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
				);
				check(
					`${tag} 旋律は骨格の歌う小節だけ`,
					[...melodyBars].every((b) => sungSet.has(b)) &&
						[...sungSet].every((b) => melodyBars.has(b)),
					`旋律 ${[...melodyBars].join(",")} / 骨格 ${[...sungSet].join(",")}`,
				);

				// ベース 24〜60（移調後の実音）
				const bassSemis = song.bass.map((n) => semiOf(n.pitchUnits));
				check(
					`${tag} ベースが 24〜60`,
					bassSemis.every((s) => s >= 24 && s <= 60),
					`${Math.min(...bassSemis)}〜${Math.max(...bassSemis)}`,
				);
				check(`${tag} ベースがある`, song.bass.length > 0, "0音");

				// サブメロ（アルペジオ）は arp 小節だけ、パッドは pad 小節だけ
				const arpSet = new Set(
					skel.barsData
						.map((b, i) => (b.layers.arp ? i : -1))
						.filter((i) => i >= 0),
				);
				const subBars = new Set(
					song.submelody.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
				);
				check(
					`${tag} サブメロは arp 小節だけ`,
					[...subBars].every((b) => arpSet.has(b)) &&
						subBars.size === arpSet.size,
					`sub ${[...subBars].join(",")} / arp ${[...arpSet].join(",")}`,
				);
				const padSet = new Set(
					skel.barsData
						.map((b, i) => (b.layers.pad ? i : -1))
						.filter((i) => i >= 0),
				);
				const padBars = new Set(
					song.pad.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
				);
				check(
					`${tag} パッドは pad 小節だけ`,
					[...padBars].every((b) => padSet.has(b)) &&
						padBars.size === padSet.size,
					`pad ${[...padBars].join(",")} / 骨格 ${[...padSet].join(",")}`,
				);
				// アルペジオは主旋律の最高音以上
				if (song.melody.length > 0 && song.submelody.length > 0) {
					const top = Math.max(...song.melody.map((n) => n.pitchUnits));
					check(
						`${tag} アルペジオが主旋律の上`,
						song.submelody.every((n) => n.pitchUnits >= top),
						`最低 ${semiOf(Math.min(...song.submelody.map((n) => n.pitchUnits)))} / 旋律最高 ${semiOf(top)}`,
					);
				}

				// セクションが小節を隙間なく覆う
				let cursor = 0;
				let covered = true;
				for (const s of song.sections) {
					if (s.startBar !== cursor) covered = false;
					cursor += s.bars;
				}
				check(
					`${tag} セクションが小節を覆う`,
					covered && cursor === song.bars,
					`${cursor}/${song.bars}`,
				);

				// sameAs の小節は先頭と同じ音
				const rows = degreeRows(song);
				for (let b = 0; b < skel.bars; b++) {
					const src = skel.barsData[b].sameAs;
					if (src === null || !skel.barsData[b].melody) continue;
					check(
						`${tag} 小節${b}は小節${src}の再現`,
						JSON.stringify(rows.get(b)) === JSON.stringify(rows.get(src)),
						`${rows.get(b)?.join(",")} / ${rows.get(src)?.join(",")}`,
					);
				}

				// "original" と "phrases" で旋律の度数列が違う（一致小節 ≤10%）
				const orig = run(seed, "original");
				check(
					`${tag} original も例外なし・同じ骨格`,
					orig.skeletonId === song.skeletonId && orig.melody.length > 0,
					String(orig.skeletonId),
				);
				const origRows = degreeRows(orig);
				for (const b of sungSet) {
					sungBarsTotal++;
					if (JSON.stringify(rows.get(b)) !== JSON.stringify(origRows.get(b)))
						differingBarsTotal++;
				}
				// stats（DAW が読む fingerprint）が数
				check(
					`${tag} fingerprint が数`,
					song.stats.fingerprint.length > 0 &&
						song.stats.fingerprint.every((v) => Number.isFinite(v)),
					JSON.stringify(song.stats.fingerprint),
				);
			}
			const sameShare = 1 - differingBarsTotal / Math.max(1, sungBarsTotal);
			check(
				`original と phrases の一致小節が 10% 以下（${set.label}）`,
				sameShare <= 0.1,
				`${(sameShare * 100).toFixed(1)}%（${sungBarsTotal - differingBarsTotal}/${sungBarsTotal}）`,
			);
			check(
				`小節頭のベース音が伴奏トラックの構成音に乗る（${set.label}）≥ 0.9`,
				bassHeadsOnChord / Math.max(1, bassHeads) >= 0.9,
				`${bassHeadsOnChord}/${bassHeads}`,
			);
		}
		// composeSong 経由（共通経路の先頭で骨格借用へ分岐する）。データが無ければ fixture で
		const viaSong = composeSong({
			...LOCAL,
			skeletons:
				KAIWAI_SKELETONS.length > 0 ? KAIWAI_SKELETONS : FIXTURE_SKELETONS,
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			template: "kaiwai_skeleton",
			baseKey: "any",
			scale: "auto",
			random: appSeededRandom(1),
		});
		check(
			"composeSong(kaiwai_skeleton) が曲を返す",
			viaSong.melody.length > 0 && viaSong.bars > 0,
			`${viaSong.melody.length}音 / ${viaSong.bars}小節`,
		);
	}
}

// ============================================================
// 2.11 継ぎ合わせ（`src/compose/compose-splice.ts`）
//
//     抽象骨格バンク（compose-section-bank.ts。git に入れるので骨格データが無くても回る）の
//     不変条件と、seed 1..30 で「壊れていない」こと：例外なし・全和音が parseChord を通る・
//     旋律が音階内と歌える帯・ベースが 28〜55（歌うセクションには必ずある）・決定性・アルペジオは
//     ラスサビの小節だけ・ラスサビの再現は1番サビの各音 +3・donor の和音列との一致が 16 半小節以下
//     （バンクだけで検算できる）・置換率・同じ src の連続なし・ラスサビ転調が 40 曲中 3 曲以上・
//     バンクが 200 本以上。元曲との近さの数値は scripts/corpus/check-splice-closeness.ts（骨格データが要る）。
// ============================================================

console.log("● 継ぎ合わせ");
splice: {
	// バンクは耳コピから作る手元データ（git に入れない）。無ければ skip。
	if (!LOCAL.sectionBank) {
		console.log("  （compose-section-bank.ts が無いので skip）");
		break splice;
	}
	const SECTION_BANK = LOCAL.sectionBank.sections;
	const FORM_BANK = LOCAL.sectionBank.forms;
	const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === "kaiwai_splice");
	check("kaiwai_splice テンプレートがある", tmpl !== undefined, "無い");
	check(
		"kaiwai_splice は engine: splice",
		tmpl?.engine === "splice",
		String(tmpl?.engine),
	);
	check(
		"SECTION_BANK が 200 本以上",
		SECTION_BANK.length >= 200,
		`${SECTION_BANK.length}`,
	);
	check("FORM_BANK がある", FORM_BANK.length > 0, `${FORM_BANK.length}`);
	{
		const errors = validateSectionBank(
			SECTION_BANK,
			FORM_BANK,
			new Set(Object.keys(DRUM_PATTERNS)),
			parseChord,
		);
		check(
			"バンクが不変条件を満たす",
			errors.length === 0,
			errors.slice(0, 5).join(" / "),
		);
		// 元曲を特定できる情報を持たない（曲名・ファイル名・旋律の度数・ベースの実音）
		const src = readFileSync(
			join(__dirname, "../../src/compose/compose-section-bank.ts"),
			"utf8",
		);
		check(
			"バンクの生成ファイルに曲名・ファイル名・度数が無い",
			!/\.mid|degrees|melodyCenter:|\bid:/.test(src),
			"元曲を特定できる欄がある",
		);
		check(
			"バンクの生成ファイルが 150KB 以下",
			Buffer.byteLength(src) <= 150 * 1024,
			`${Buffer.byteLength(src)}`,
		);
		// 歌わない種類は NON_SUNG_MAX_BARS で頭打ち（64〜72 小節の outro が構成に入らない）
		const longNonSung = SECTION_BANK.filter(
			(sec) => !isSungKind(sec.kind) && sec.bars > NON_SUNG_MAX_BARS,
		).length;
		check(
			`バンクの intro/interlude/outro が ${NON_SUNG_MAX_BARS} 小節以下`,
			longNonSung === 0,
			`${longNonSung} 本`,
		);
		// 置換表に無い和音の既定の置換（同じルートで 7th/6th を付け外す）が全和音にあり、parseChord を通る
		const tokens = new Set(
			SECTION_BANK.flatMap((sec) =>
				sec.chords.flat().filter((c): c is string => c !== null),
			),
		);
		let noGeneric = 0;
		const badGeneric: string[] = [];
		for (const t of tokens) {
			const cands = genericSubstitutes(t);
			if (cands.length === 0) noGeneric++;
			for (const c of cands) {
				try {
					parseChord(c);
				} catch {
					badGeneric.push(`${t}→${c}`);
				}
			}
		}
		check(
			`バンクの全和音（${tokens.size} 種）に既定の置換候補がある`,
			noGeneric === 0,
			`無いもの ${noGeneric}`,
		);
		check(
			"既定の置換候補が全部 parseChord を通る",
			badGeneric.length === 0,
			badGeneric.slice(0, 5).join(" "),
		);
	}
	if (tmpl) {
		const semiOf = (u: number): number => Math.round(u / UNITS_PER_SEMITONE);
		const pc = (v: number): number => ((v % 12) + 12) % 12;
		const run = (seed: number) =>
			composeSong({
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				template: "kaiwai_splice",
				baseKey: "any",
				scale: "auto",
				random: appSeededRandom(seed),
				...LOCAL,
			});
		const digestOf = (song: ReturnType<typeof run>): string =>
			JSON.stringify([
				song.chordProgression,
				song.melody,
				song.bass,
				song.submelody,
				song.pad,
				song.sections.map((s) => [s.kind, s.bars, s.keyShift]),
			]);
		let substituted = 0;
		let eligible = 0;
		let keyShifted = 0;
		let introFrom = 0;
		let introNotFrom = 0;
		for (let seed = 1; seed <= 40; seed++) {
			const tag = `継ぎ合わせ seed=${seed}`;
			let song: ReturnType<typeof run>;
			try {
				song = run(seed);
			} catch (e) {
				check(`${tag} 例外なし`, false, String(e));
				continue;
			}
			const st = song.spliceStats;
			check(`${tag} spliceStats がある`, st !== undefined, "無い");
			if (!st) continue;
			substituted += st.substituted;
			eligible += st.eligible;
			if (st.keyShift !== 0) keyShifted++;
			{
				const intro = song.sections.find((s) => s.kind === "intro");
				const chorus = song.sections.find((s) => s.kind === "chorus");
				if (intro && chorus) {
					if (st.introFromChorus) introFrom++;
					else introNotFrom++;
				} else
					check(
						`${tag} イントロかサビが無い曲は introFromChorus が false`,
						!st.introFromChorus,
						"true",
					);
				if (intro && chorus && st.introFromChorus) {
					// サビがラスサビ1回だけの曲は転調ぶんずれるので、転調を戻した構成音の集合で比べる。
					const bars = song.chordProgression.split("|").map((b) => b.trim());
					const keyOf = (bar: string, k: number): string =>
						bar
							.split(/\s+/)
							.map((c) =>
								[...new Set(parseChord(c).notes.map((n) => pc(n - k)))]
									.sort((x, y) => x - y)
									.join(","),
							)
							.join(" ");
					const ih = bars.slice(intro.startBar, intro.startBar + intro.bars);
					const ch = bars.slice(chorus.startBar, chorus.startBar + chorus.bars);
					check(
						`${tag} イントロの和音が最初のサビの和音`,
						ih.every(
							(b, i) =>
								keyOf(b, intro.keyShift) ===
								keyOf(ch[i % ch.length], chorus.keyShift),
						),
						`intro=${ih.join("|")} / chorus=${ch.slice(0, ih.length).join("|")}`,
					);
				}
			}
			if (seed > 30) continue;
			check(`${tag} form が splice`, song.form === "splice", song.form);
			check(
				`${tag} 全和音が parseChord を通る`,
				song.chordProgression.split("|").every((bar) =>
					bar
						.trim()
						.split(/\s+/)
						.every((c) => {
							try {
								parseChord(c);
								return true;
							} catch {
								return false;
							}
						}),
				),
				song.chordProgression.slice(0, 80),
			);
			check(
				`${tag} セクションが小節を覆う`,
				song.sections.reduce((a, s) => a + s.bars, 0) === song.bars &&
					song.sections.every((s, i) =>
						i === 0
							? s.startBar === 0
							: s.startBar ===
								song.sections[i - 1].startBar + song.sections[i - 1].bars,
					),
				`${song.bars}`,
			);
			const keyShiftAt = (b: number): number =>
				song.sections.find((s) => b >= s.startBar && b < s.startBar + s.bars)
					?.keyShift ?? 0;
			const pcs = scalePcs(COMPOSE_SCALES[song.scaleId]);
			const outOfBand = song.melody.filter((n) => {
				const s = semiOf(n.pitchUnits);
				return s < MELODY_LOW || s > MELODY_HIGH;
			}).length;
			check(`${tag} 旋律が 59〜83`, outOfBand === 0, `${outOfBand} 音`);
			const outOfScale = song.melody.filter((n) => {
				const b = Math.floor(n.startStep / STEPS_PER_BAR);
				return !pcs.has(
					pc(semiOf(n.pitchUnits) - song.rootShift - keyShiftAt(b)),
				);
			}).length;
			check(`${tag} 旋律が音階内`, outOfScale === 0, `${outOfScale} 音`);
			check(`${tag} 旋律がある`, song.melody.length > 0, "0 音");
			const bassOut = song.bass.filter((n) => {
				const s = semiOf(n.pitchUnits);
				return s < SPLICE_BASS_LOW || s > SPLICE_BASS_HIGH;
			}).length;
			check(`${tag} ベースが 28〜55`, bassOut === 0, `${bassOut} 音`);
			check(`${tag} ベースがある`, song.bass.length > 0, "0 音");
			// 歌うセクション（verse/bridge/chorus）はベースの donor が全小節 rest でも無音にしない
			const bassBars = new Set(
				song.bass.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
			);
			const silentSung = song.sections.filter(
				(s) =>
					isSungKind(s.kind) &&
					![...Array(s.bars).keys()].some((i) => bassBars.has(s.startBar + i)),
			);
			check(
				`${tag} 歌うセクションにベースがある`,
				silentSung.length === 0,
				silentSung.map((s) => `${s.kind}@${s.startBar}`).join(","),
			);
			check(
				`${tag} 置換できない並びが残っていない`,
				st.unresolvedRuns === 0,
				`${st.unresolvedRuns}`,
			);
			// ラスサビの小節だけアルペジオ
			let lastChorus: (typeof song.sections)[number] | undefined;
			for (const s of song.sections) if (s.kind === "chorus") lastChorus = s;
			const arpBars = new Set(
				song.submelody.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
			);
			const inLastChorus = (b: number): boolean =>
				lastChorus !== undefined &&
				b >= lastChorus.startBar &&
				b < lastChorus.startBar + lastChorus.bars;
			check(
				`${tag} アルペジオがラスサビの小節だけ`,
				lastChorus
					? [...arpBars].every(inLastChorus) && arpBars.size > 0
					: arpBars.size === 0,
				`${[...arpBars].slice(0, 5)} / ラスサビ ${lastChorus?.startBar}+${lastChorus?.bars}`,
			);
			if (st.keyShift !== 0 && lastChorus) {
				check(
					`${tag} ラスサビ以降の keyShift が +3`,
					song.sections
						.slice(song.sections.indexOf(lastChorus))
						.every((s) => s.keyShift === 3),
					song.sections.map((s) => s.keyShift).join(","),
				);
				// ラスサビが1番サビの再現なら、各音が同じ位置の音の +3（オクターブ折り返しで −9 にならない）
				const firstChorus = song.sections.find((s) => s.kind === "chorus");
				if (
					firstChorus &&
					firstChorus !== lastChorus &&
					lastChorus.restatement
				) {
					const notesIn = (sec: typeof firstChorus): number[] =>
						[...song.melody]
							.filter((n) => {
								const b = Math.floor(n.startStep / STEPS_PER_BAR);
								return b >= sec.startBar && b < sec.startBar + sec.bars;
							})
							.sort((a, b) => a.startStep - b.startStep)
							.map((n) => semiOf(n.pitchUnits));
					const a = notesIn(firstChorus);
					const z = notesIn(lastChorus);
					const off = a.filter((v, i) => z[i] !== v + 3).length;
					check(
						`${tag} ラスサビの各音が1番サビの +3`,
						a.length === z.length && off === 0,
						`${off} 音がずれ（${a.length}/${z.length} 音）`,
					);
				}
			}
			// donor の和音列（バンク）との最長一致 ≤ 16 半小節（構成音の集合で比べる。骨格データは要らない）
			{
				const pcKey = (name: string, k: number): string => {
					try {
						return [...new Set(parseChord(name).notes.map((n) => pc(n - k)))]
							.sort((x, y) => x - y)
							.join(",");
					} catch {
						return "";
					}
				};
				const gen = song.chordProgression.split("|").flatMap((bar, b) => {
					const parts = bar.trim().split(/\s+/);
					const k = keyShiftAt(b);
					return [pcKey(parts[0], k), pcKey(parts[1] ?? parts[0], k)];
				});
				let worst = 0;
				const srcsOf = song.spliceSources ?? [];
				song.sections.forEach((sec, si) => {
					for (const donor of SECTION_BANK.filter(
						(d) => d.src === srcsOf[si] && d.kind === sec.kind,
					)) {
						const dh: string[] = [];
						let p = "Am";
						for (const [c0, c1] of donor.chords) {
							const x = c0 ?? p;
							const y = c1 ?? x;
							dh.push(pcKey(x, 0), pcKey(y, 0));
							p = y;
						}
						let run = 0;
						for (let i = 0; i < sec.bars * 2; i++) {
							const g = gen[sec.startBar * 2 + i];
							if (g !== "" && g === dh[i % dh.length]) {
								run++;
								worst = Math.max(worst, run);
							} else run = 0;
						}
					}
				});
				check(
					`${tag} donor の和音列との一致が 16 半小節以下`,
					worst <= 16,
					`${worst}`,
				);
			}
			// 同じ src の連続なし（restatement は除く）
			const srcs = song.spliceSources ?? [];
			check(
				`${tag} 同じ src のセクションが連続しない`,
				song.sections.every(
					(s, i) => i === 0 || s.restatement || srcs[i] !== srcs[i - 1],
				),
				srcs.join(","),
			);
			check(
				`${tag} spliceSources がセクション数ぶん`,
				srcs.length === song.sections.length,
				`${srcs.length}/${song.sections.length}`,
			);
			// 2回目の再現が1回目と同じ長さ
			const firstBars = new Map<string, number>();
			for (const s of song.sections) {
				const f = firstBars.get(s.kind);
				if (f === undefined) firstBars.set(s.kind, s.bars);
				else
					check(
						`${tag} ${s.kind} の再現が同じ長さ`,
						f === s.bars,
						`${f} / ${s.bars}`,
					);
			}
			// 決定性
			check(
				`${tag} 決定性`,
				digestOf(run(seed)) === digestOf(song),
				"同じ seed で違う曲",
			);
			// DAW 経路の伴奏（chordProgression + rootShift）の構成音に小節頭のベース音が乗る
			// （block の置き方は同じ和音が続くと1つの長い音になるので、小節頭を含む区間で見る）
			const spans: { start: number; end: number; pcs: Set<number> }[] = [];
			for (const pl of buildChordPlacements({
				edo: 12,
				chordStr: song.chordProgression,
				patternType: "block",
				rootShift: song.rootShift,
				bpm: 120,
				stepsPerBar: STEPS_PER_BAR,
			})) {
				const hit = spans.find((x) => x.start === pl.startStep);
				if (hit) hit.pcs.add(pc(semiOf(pl.pitchUnits)));
				else
					spans.push({
						start: pl.startStep,
						end: pl.startStep + pl.durationSteps,
						pcs: new Set([pc(semiOf(pl.pitchUnits))]),
					});
			}
			let heads = 0;
			let onChord = 0;
			for (const n of song.bass) {
				if (n.startStep % STEPS_PER_BAR !== 0) continue;
				const span = spans.find(
					(x) => n.startStep >= x.start && n.startStep < x.end,
				);
				if (!span) continue;
				heads++;
				if (span.pcs.has(pc(semiOf(n.pitchUnits)))) onChord++;
			}
			check(
				`${tag} 小節頭のベース音が伴奏の構成音に乗る ≥ 0.9`,
				heads === 0 || onChord / heads >= 0.9,
				`${onChord}/${heads}`,
			);
			check(
				`${tag} fingerprint が数`,
				song.stats.fingerprint.length > 0 &&
					song.stats.fingerprint.every((v) => Number.isFinite(v)),
				JSON.stringify(song.stats.fingerprint),
			);
		}
		const rate = substituted / Math.max(1, eligible);
		check(
			"置換率が 0.2〜0.5（40 曲）",
			rate >= 0.2 && rate <= 0.5,
			`${rate.toFixed(3)}（${substituted}/${eligible}）`,
		);
		check(
			"keyShift のある曲が 40 曲中 3 曲以上",
			keyShifted >= 3,
			`${keyShifted}`,
		);
		check(
			"イントロをサビの和音で始める曲と始めない曲が両方ある（40 曲）",
			introFrom > 0 && introNotFrom > 0,
			`${introFrom} / ${introNotFrom}`,
		);
	}
}

console.log("");
console.log(
	`平均総合点     ${(scoreSum / SEEDS).toFixed(3)}（最低 ${worstScore.toFixed(3)}）`,
);
console.log(
	`平均エントロピー ${(entropySum / SEEDS).toFixed(3)}bit（最低 ${worstEntropy.toFixed(3)}bit）`,
);
console.log(`平均休符率     ${((restSum / SEEDS) * 100).toFixed(1)}%`);
console.log(`引いた候補数   ${(attemptsSum / SEEDS).toFixed(1)}本/曲`);
console.log("");
if (failures > 0) {
	console.error(`${failures} 件失敗`);
	process.exit(1);
}
console.log(`${SEEDS}曲すべて基準を満たしました`);
