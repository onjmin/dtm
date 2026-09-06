/**
 * 自動作曲マクロ（`src/compose.ts`）の検算。
 *
 * 「聴いて確かめる」ができない代わりに、生成物の性質を機械的に測って落とす。
 * 測る項目は、実際に人が聴いて「これは質が高い／単調だ」と評価した曲の差から
 * 逆算したもの（`src/compose.ts` の冒頭コメント参照）。
 *
 *   pnpm test
 */

import { parseChord } from "@onjmin/chord-parser";
import { buildChordPlacements } from "../src/chords";
import {
	ANSWER_FIGURES,
	BASE_STEPS_PER_BAR,
	composeSong,
	durationEntropy,
	MOTIF_CELLS,
	RHYTHM_CELLS,
	TRIPLET_EIGHTH,
} from "../src/compose";
import { structureFeatures } from "../src/compose-metrics";
import { DRUM_KEYS, resolveDrumPattern } from "../src/drum-config";
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
			(n) => n.startStep + n.durationSteps > song.bars * STEPS_PER_BAR,
		);
		check(
			`${tag} ${name}が曲の長さに収まる`,
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
	const progBars = song.chordProgression.split("|");
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
	const pre = song.sections.find((x) => x.kind === "prechorus");
	if (pre) {
		const last = progBars[pre.startBar + pre.bars - 1];
		check(`${tag} Bメロがドミナントで終わる`, /^G7?$/.test(last), last);
	}
	// サビとアウトロは主音へ着地して締める。
	for (const kind of ["chorus", "outro"]) {
		const sec = song.sections.find((x) => x.kind === kind);
		if (!sec) continue;
		const last = progBars[sec.startBar + sec.bars - 1];
		check(`${tag} ${kind}が主音で終わる`, /^(C|Am)$/.test(last), last);
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
		check(`${tag} 4小節で形が戻る`, f.sim4 >= 0.4, `lag4 ${f.sim4.toFixed(2)}`);
		// フレーズの切れ目（2小節ごと）で息継ぎがあること。
		check(
			`${tag} フレーズの切れ目で息継ぎ`,
			f.phraseBreath >= 0.1,
			`${f.phraseBreath.toFixed(2)}`,
		);
		// 楽句は2小節。**メロディのあるセクションの末尾**は必ずロングトーンか
		// 休符で受ける（歌手の息継ぎ）。小節番号で固定していた頃は、セクションの
		// 選び方で位置が変わると成立しなくなっていた。
		const endBars = song.sections
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
	check("小節線をまたがない", cross === 0, `${cross}/${notes}音がまたぎ`);
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
			// 生成はハ長調で行い、最後に rootShift だけ移調してある。
			const semi = n.pitchUnits / UNITS_PER_SEMITONE;
			const pc = (((Math.round(semi) - song.rootShift) % 12) + 12) % 12;
			if (DIATONIC.has(pc)) continue;
			chromatic++;
			inSong++;
			// 許されるのは「その瞬間の和音の構成音」か「順次で入って順次で出る短い音」。
			const bar = Math.floor(n.startStep / STEPS_PER_BAR);
			let tones: number[] = [];
			try {
				tones = parseChord(progression[bar] ?? "C").notes.map(
					(v) => ((v % 12) + 12) % 12,
				);
			} catch {}
			if (tones.includes(pc)) continue;
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
// 2.7 ドラム編曲
//
//     作曲マクロは長らくドラムに一切触っておらず、既定の1小節ループが16小節
//     そのまま鳴っていた。参考にした人間の曲13本は全曲がドラムに2〜31種
//     （平均5.9種）の小節パターンを持つ。ここが1種に戻ったら退行。
// ============================================================

console.log("● ドラム編曲");
{
	const N = 40;
	const styles = new Set<string>();
	let minVariety = Number.POSITIVE_INFINITY;
	for (let seed = 1; seed <= N; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(seed * 31),
		});
		const tag = `seed=${seed}`;
		const { drums } = song;
		styles.add(drums.style);
		minVariety = Math.min(minVariety, drums.variety);
		check(
			`${tag} 小節パターンが2種以上`,
			drums.variety >= 2,
			`${drums.variety}種（1種＝1小節ループ）`,
		);
		// 打点が小節からはみ出していないこと。はみ出すと次の小節へ回り込む。
		const overflow = drums.def.pattern.flatMap((i) =>
			i.pattern.filter((h) => h.step < 0 || h.step >= STEPS_PER_BAR),
		);
		check(`${tag} 打点が小節内`, overflow.length === 0, `${overflow.length}打`);
		// 全小節が埋まっていること（無音の小節があるとドラムが抜ける）。
		const covered = new Set<number>();
		for (const i of drums.def.pattern)
			for (const [lo, hi] of i.ranges)
				for (let b = lo; b <= hi; b++) covered.add(b);
		check(
			`${tag} 全小節にドラムがある`,
			covered.size === song.bars,
			`${covered.size}/${song.bars}小節`,
		);
		const barOf = (bar: number) =>
			drums.def.pattern.find((i) =>
				i.ranges.some(([lo, hi]) => bar >= lo && bar <= hi),
			)?.pattern ?? [];
		// **セクションの頭にクラッシュ。** 切り替わりを耳で分からせる主役。
		for (const section of song.sections) {
			check(
				`${tag} ${section.kind}の頭にクラッシュ`,
				barOf(section.startBar + 1).some(
					(h) => h.pitch === DRUM_KEYS.crashCymbal1,
				),
				`${section.startBar + 1}小節目にクラッシュが無い`,
			);
		}
		// **セクションの終わりの1つ手前にフィル**（次のセクションへの助走）。
		const toms = [DRUM_KEYS.highTom, DRUM_KEYS.lowMidTom, DRUM_KEYS.lowTom];
		const isFillBar = (bar: number) =>
			barOf(bar).filter(
				(h) =>
					h.step >= STEPS_PER_BAR / 2 &&
					(h.pitch === DRUM_KEYS.acousticSnare || toms.includes(h.pitch)),
			).length >= 2;
		for (const section of song.sections) {
			const fillBar = section.startBar + section.bars - 1;
			// 最終小節は鳴らし切る側なので、フィルは入らない。
			if (fillBar >= song.bars) continue;
			check(
				`${tag} ${section.kind}の終わりにフィル`,
				isFillBar(fillBar),
				`${fillBar}小節目にフィルが無い`,
			);
		}
		// 最終小節は鳴らし切る（刻み続けると終わった感じが出ない）。
		check(
			`${tag} 最終小節で締める`,
			barOf(song.bars).some((h) => h.pitch === DRUM_KEYS.crashCymbal1) &&
				barOf(song.bars).length <= 4,
			`${barOf(song.bars).length}打`,
		);
	}
	check(
		"ドラムの型が複数出る",
		styles.size >= 3,
		`${styles.size}種: ${[...styles].join(",")}`,
	);

	// シャッフルのドラム（三連のハイハット）は、跳ねているメロディの曲にだけ当てる。
	// 一般の抽選プールにも入れていたときは、イーブンなメロディの上で三連が鳴る曲が
	// 42曲中21曲出ていた。ドラムだけが跳ねている状態は、はっきり喧嘩して聞こえる。
	{
		let shuffleSongs = 0;
		let mismatched = 0;
		for (let seed = 1; seed <= 120; seed++) {
			const song = composeSong({
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				random: seededRandom(seed * 7919),
			});
			if (song.drums.style !== "shuffle") continue;
			shuffleSongs++;
			const quarter = STEPS_PER_BAR / 4;
			const eighth = STEPS_PER_BAR / 8;
			// 跳ねている＝拍のウラが8分の位置から後ろへずれて、16分の格子から外れている。
			const swung = song.melody.some(
				(n) =>
					n.startStep % quarter > eighth &&
					n.startStep % (STEPS_PER_BAR / 16) !== 0,
			);
			if (!swung) mismatched++;
		}
		check(
			"シャッフルのドラムは跳ねている曲にだけ当たる",
			mismatched === 0,
			`${shuffleSongs}曲中 ${mismatched}曲がイーブン`,
		);
	}

	// --- 再生経路との結合 ---
	// daw.ts は生成した定義を drumPatterns へ入れ、シーケンサが小節ごとに
	// resolveDrumPattern() で引く。ranges / patternBars の形が噛み合っていないと、
	// 生成側が正しくてもここで空になったり別の小節の型が返ったりする。
	// 生成物を直接見るだけでは検出できないので、実際に引いて確かめる。
	{
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random: seededRandom(12345),
		});
		const dict = { _composed: song.drums.def };
		const resolved: ReturnType<typeof resolveDrumPattern>[] = [];
		for (let bar = 1; bar <= BARS; bar++)
			resolved.push(resolveDrumPattern("_composed", dict, bar));
		check(
			"全小節でドラムが解決できる",
			resolved.every((r) => r !== null && r.length > 0),
			`空の小節 ${resolved.filter((r) => !r || r.length === 0).length}個`,
		);
		check(
			"解決後の打点も小節内",
			resolved.every((r) =>
				(r ?? []).every((h) => h.step >= 0 && h.step < STEPS_PER_BAR),
			),
			"小節からはみ出した打点がある",
		);
		// 解決結果が小節ごとに違うこと（1種に潰れていたらループに戻っている）。
		const kinds = new Set(resolved.map((r) => JSON.stringify(r)));
		check("解決後も小節ごとに違う", kinds.size >= 2, `${kinds.size}種`);
		// 生成した定義と解決結果が一致すること。
		const mismatched = resolved.filter((r, i) => {
			const expected = song.drums.def.pattern.find((ins) =>
				ins.ranges.some(([lo, hi]) => i + 1 >= lo && i + 1 <= hi),
			)?.pattern;
			return JSON.stringify(r) !== JSON.stringify(expected);
		});
		check(
			"解決結果が定義どおり",
			mismatched.length === 0,
			`${mismatched.length}小節でずれ`,
		);
	}
	console.log(
		`  ${N}曲: 型${styles.size}種（${[...styles].join(" ")}） / 小節パターンの最小種類数 ${minVariety}`,
	);
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
