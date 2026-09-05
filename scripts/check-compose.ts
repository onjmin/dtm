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
import {
	ANSWER_FIGURES,
	BASE_STEPS_PER_BAR,
	composeSong,
	durationEntropy,
	MOTIF_CELLS,
	RHYTHM_CELLS,
} from "../src/compose";
import { structureFeatures } from "../src/compose-metrics";
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
// 2. 作曲マクロの生成物
// ============================================================

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
	// 候補どうしを比べる方式へ変わった（src/compose.ts の WEIGHTS 参照）ので、
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
	const lastNote = song.melody[song.melody.length - 1];
	const lastPc =
		(((Math.round(lastNote.pitchUnits / UNITS_PER_SEMITONE) - song.rootShift) %
			12) +
			12) %
		12;
	check(
		`${tag} 終止音が調の主音（移調後）`,
		lastPc === 0,
		`移調 ${song.rootShift} 半音 / 終止音のハ長調換算 ${lastPc}`,
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
