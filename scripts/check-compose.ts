/**
 * 自動作曲マクロ（`src/compose.ts`）の検算。
 *
 * 「聴いて確かめる」ができない代わりに、生成物の性質を機械的に測って落とす。
 * 測る項目は、実際に人が聴いて「これは質が高い／単調だ」と評価した曲の差から
 * 逆算したもの（`src/compose.ts` の冒頭コメント参照）。
 *
 *   pnpm test
 */

import { buildChordPlacements } from "../src/chords";
import { composeSong, durationEntropy } from "../src/compose";
import { UNITS_PER_SEMITONE } from "../src/tuning";

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
// 2. 作曲マクロの生成物
// ============================================================

console.log("● 自動作曲の生成物");
const SEEDS = 200;
let entropySum = 0;
let restSum = 0;
let attemptsSum = 0;
let worstEntropy = Number.POSITIVE_INFINITY;

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

	// --- 品質基準 ---
	check(
		`${tag} 音価の種類数`,
		song.stats.valueKinds >= 4,
		`${song.stats.valueKinds}種`,
	);
	check(
		`${tag} 音価のエントロピー`,
		song.stats.entropy >= 1.1,
		`${song.stats.entropy.toFixed(3)}bit`,
	);
	check(
		`${tag} 休符率`,
		song.stats.restRatio >= 0.03 && song.stats.restRatio <= 0.08,
		`${(song.stats.restRatio * 100).toFixed(1)}%`,
	);
	check(
		`${tag} 小節内の跳躍`,
		song.stats.maxLeapSemitones <= 5,
		`${song.stats.maxLeapSemitones}半音`,
	);

	// --- 構造 ---
	for (const [name, notes] of [
		["メロディ", song.melody],
		["サブメロ", song.submelody],
		["ベース", song.bass],
	] as const) {
		check(`${tag} ${name}が空でない`, notes.length > 0, "0音");
		const overshoot = notes.filter(
			(n) => n.startStep + n.durationSteps > BARS * STEPS_PER_BAR,
		);
		check(
			`${tag} ${name}が16小節に収まる`,
			overshoot.length === 0,
			`${overshoot.length}音がはみ出し`,
		);
		// 単音であること。和音になると「おまかせマスタリング」の役割推定が
		// 伴奏だと誤判定して楽器を取り違える（daw.ts の classifyTrackRole 参照）。
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
	}

	// --- 1小節がちょうど4拍か（メロディ） ---
	for (let bar = 0; bar < BARS; bar++) {
		const start = bar * STEPS_PER_BAR;
		const inBar = song.melody.filter(
			(n) => n.startStep >= start && n.startStep < start + STEPS_PER_BAR,
		);
		if (inBar.length === 0) continue;
		const last = inBar[inBar.length - 1];
		check(
			`${tag} bar${bar + 1} が小節をはみ出さない`,
			last.startStep + last.durationSteps <= start + STEPS_PER_BAR,
			`末尾 ${last.startStep + last.durationSteps - start}/${STEPS_PER_BAR}`,
		);
	}

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
	// サブメロは「単音・音数が少なく・音価が長い」形でないと伴奏と誤判定される
	const subSpanBeats = (BARS * STEPS_PER_BAR) / (STEPS_PER_BAR / 4);
	const subPerBeat = song.submelody.length / subSpanBeats;
	const subAvgDur =
		song.submelody.reduce((s, n) => s + n.durationSteps, 0) /
		song.submelody.length;
	check(
		`${tag} サブメロの密度 < 1.2音/拍`,
		subPerBeat < 1.2,
		`${subPerBeat.toFixed(2)}`,
	);
	check(
		`${tag} サブメロの平均音価 >= 1.5拍`,
		subAvgDur >= (STEPS_PER_BAR / 4) * 1.5,
		`${(subAvgDur / (STEPS_PER_BAR / 4)).toFixed(2)}拍`,
	);

	// --- コード進行が伴奏として展開できるか ---
	const chordNotes = buildChordPlacements({
		chordStr: song.chordProgression,
		patternType: song.chordPattern,
		rootShift: 0,
		bpm: 120,
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
	});
	check(`${tag} 伴奏が生成できる`, chordNotes.length > 0, "0音");
	check(
		`${tag} 進行が16小節`,
		song.chordProgression.split("|").length === BARS,
		`${song.chordProgression.split("|").length}小節`,
	);
	// 単純ループを避ける。A(0-3) A'(4-7) B(8-11) A''(12-15) のうち、
	// A' と A'' は A の変形なので似ていてよいが、**B部はA部と違う進行**でなければ
	// 「サビで景色が変わる」効果が出ない。
	const bars = song.chordProgression.split("|");
	const [secA, secA2, secB, secA3] = [
		bars.slice(0, 4).join("|"),
		bars.slice(4, 8).join("|"),
		bars.slice(8, 12).join("|"),
		bars.slice(12, 16).join("|"),
	];
	check(`${tag} B部がA部と異なる`, secB !== secA, `A=${secA} / B=${secB}`);
	// A' は「まだ続く」感じを出すためドミナントで終わる。A部が元からG7で終わる進行なら
	// A' と同じ形になるのが正しい挙動なので、比較ではなく終止和音を見る。
	check(`${tag} A'がドミナントで終わる`, /\|G7?$/.test(secA2), secA2);
	check(`${tag} A''が主音で終わる`, /\|(C|Am)$/.test(secA3), secA3);
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

console.log("");
console.log(
	`平均エントロピー ${(entropySum / SEEDS).toFixed(3)}bit（最低 ${worstEntropy.toFixed(3)}bit）`,
);
console.log(`平均休符率     ${((restSum / SEEDS) * 100).toFixed(1)}%`);
console.log(
	`平均引き直し回数 ${(attemptsSum / SEEDS).toFixed(1)}回 / 上限60回`,
);
console.log("");
if (failures > 0) {
	console.error(`${failures} 件失敗`);
	process.exit(1);
}
console.log(`${SEEDS}曲すべて基準を満たしました`);
