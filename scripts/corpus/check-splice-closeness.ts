/**
 * 継ぎ合わせ（`src/compose/compose-splice.ts`）の生成物が、手元の骨格データの**元曲にどれだけ近いか**を測る。
 *
 *   npx tsx scripts/corpus/check-splice-closeness.ts --count 200 --seed 1
 *
 * 骨格データ（`src/compose/compose-skeletons.ts`、git に入れない）が無ければ skip（exit 0）。生成 N 曲について:
 *   (a) 半小節の和音列の最長一致 … 構成音のピッチクラス集合の列で、どの元曲とも最長の連続一致 ≤ `--max-run`（既定 16 半小節＝8小節）
 *   (b) ベースの実音の一致       … 和音の donor とベースの型の donor、それぞれの元曲の同じ小節と（オンセット, 実音）の列が
 *                                一致する小節（多い方）。一致率 ≤ `--max-bass`（既定 5%）と、連続して一致する小節の最長
 *                                ≤ `--max-bass-run`（既定 8 小節。(a) と同じ長さ）で縛る。
 *   (c) 旋律の度数列の一致       … donor の元曲の同じ小節と音のピッチクラス列が一致する小節 ≤ `--max-melody`（既定 5%）
 *   (d) 同じ src のセクションが連続しない（2回目の再現＝restatement は除く）
 * 閾値を超えたら exit 1。seed 1..40 だけでは上限ちょうどの曲を拾えないので既定は 200 曲。
 */

import { parseChord } from "@onjmin/chord-parser";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import {
	BASE_STEPS_PER_BAR,
	type ComposeResult,
	composeSong,
	seededRandom,
} from "../../src/compose/compose";
import {
	COMPOSE_SCALES,
	degreeToPitch,
} from "../../src/compose/compose-scales";
import type { Skeleton } from "../../src/compose/skeleton-types";
import {
	bankSourceOrder,
	loadSkeletons,
	localExperimentData,
} from "./skeleton-data";

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const count = Number.parseInt(argOf("--count") ?? "200", 10);
const baseSeed = Number.parseInt(argOf("--seed") ?? "1", 10);
const maxRun = Number.parseInt(argOf("--max-run") ?? "16", 10);
const maxBass = Number.parseFloat(argOf("--max-bass") ?? "0.05");
const maxBassRun = Number.parseInt(argOf("--max-bass-run") ?? "8", 10);
const maxMelody = Number.parseFloat(argOf("--max-melody") ?? "0.05");

const skeletons = bankSourceOrder(loadSkeletons());
if (skeletons.length === 0) {
	console.log("skip: 骨格データ（src/compose/compose-skeletons.ts）が無い");
	process.exit(0);
}

const BAR = BASE_STEPS_PER_BAR;
const pc = (v: number): number => ((v % 12) + 12) % 12;
const semiOf = (u: number): number => Math.round(u / UNITS_PER_SEMITONE);

/** 和音名 → 構成音のピッチクラス集合（`shift` 半音だけ戻して）。読めなければ空。 */
const chordKey = (name: string, shift = 0): string => {
	try {
		return [...new Set(parseChord(name).notes.map((n) => pc(n - shift)))]
			.sort((a, b) => a - b)
			.join(",");
	} catch {
		return "";
	}
};
const rootPc = (name: string): number => {
	try {
		return pc(parseChord(name).notes[0] ?? 0);
	} catch {
		return 0;
	}
};

/** 骨格の和音列（null は継続）を半小節ごとに解く（compose-skeleton.ts と同じ規則）。 */
const skeletonChords = (s: Skeleton): [string, string][] => {
	const out: [string, string][] = [];
	let prev = s.mode === "minor" ? "Am" : "C";
	for (let b = 0; b < s.bars; b++) {
		const [c0, c1] = s.barsData[b]?.chords ?? [null, null];
		const first = c0 ?? prev;
		const second = c1 ?? first;
		out.push([first, second]);
		prev = second;
	}
	return out;
};
const skeletonHalfKeys = skeletons.map((s) =>
	skeletonChords(s).flatMap((p) => p.map((n) => chordKey(n))),
);

/** 生成物の進行を基準調へ戻した半小節ごとの構成音キー（転調した小節は keyShift を引く）。 */
const songHalfKeys = (song: ComposeResult): string[] => {
	const keyShiftAt = (b: number): number =>
		song.sections.find((s) => b >= s.startBar && b < s.startBar + s.bars)
			?.keyShift ?? 0;
	return song.chordProgression.split("|").flatMap((bar, b) => {
		const parts = bar.trim().split(/\s+/);
		const k = keyShiftAt(b);
		return [chordKey(parts[0], k), chordKey(parts[1] ?? parts[0], k)];
	});
};

/** 最長の連続一致（空キーは一致に数えない）。 */
const longestCommonRun = (a: string[], b: string[]): number => {
	let best = 0;
	let prev = new Int32Array(b.length + 1);
	let cur = new Int32Array(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			if (a[i - 1] !== "" && a[i - 1] === b[j - 1]) {
				cur[j] = prev[j - 1] + 1;
				if (cur[j] > best) best = cur[j];
			} else cur[j] = 0;
		}
		[prev, cur] = [cur, prev];
	}
	return best;
};

/** 元曲の小節のベース（オンセット:実音 の列）。rel は和音ルート（36〜47）からの半音差。 */
const skeletonBassBar = (
	s: Skeleton,
	b: number,
	chords: [string, string][],
): string => {
	const bar = s.barsData[b];
	if (!bar) return "";
	return bar.bass.steps
		.map((st, i) => {
			const half = st < BAR / 2 ? 0 : 1;
			return `${st}:${36 + rootPc(chords[b][half]) + bar.bass.rel[i]}`;
		})
		.join(",");
};
const skeletonMelodyBar = (
	s: Skeleton,
	b: number,
	scaleId: string,
): string | null => {
	const m = s.barsData[b]?.melody;
	if (!m) return null;
	const scale = COMPOSE_SCALES[scaleId as keyof typeof COMPOSE_SCALES];
	return m.degrees.map((d) => pc(degreeToPitch(scale, d).semi)).join(",");
};

let exitCode = 0;
console.log(`● 元曲との近さ（kaiwai_splice, ${count}曲, seed ${baseSeed}〜）`);
let worstRun = 0;
let worstRunSeed = 0;
let bassBars = 0;
let bassSame = 0;
let melBars = 0;
let melSame = 0;
let adjacentSame = 0;
let ambiguous = 0;
let worstBassRun = 0;
let worstBassRunSeed = 0;
/** (b) の内訳: 一致した小節のベース型（生成側 spliceStats.figures）。 */
const bassSameByFigure = new Map<string, number>();
for (let i = 0; i < count; i++) {
	const seed = baseSeed + i;
	const song = composeSong({
		stepsPerBar: BAR,
		edo: 12,
		template: "kaiwai_splice",
		baseKey: "any",
		scale: "auto",
		random: seededRandom(seed * 104729),
		...localExperimentData(),
	});
	const srcs = song.spliceSources ?? [];
	// (a)
	const keys = songHalfKeys(song);
	let run = 0;
	let runSrc = -1;
	skeletonHalfKeys.forEach((sk, idx) => {
		const r = longestCommonRun(keys, sk);
		if (r > run) {
			run = r;
			runSrc = idx;
		}
	});
	if (run > worstRun) {
		worstRun = run;
		worstRunSeed = seed;
	}
	// (b)(c)(d) セクションごとに donor の元曲の同じ小節と比べる。donor は src と種類で引く
	// （同じ曲に同種のセクションが2つあれば両方と比べて多い方＝保守的に数える）。
	const bassByBar = new Map<number, string[]>();
	for (const n of song.bass) {
		const b = Math.floor(n.startStep / BAR);
		const list = bassByBar.get(b) ?? [];
		list.push(`${n.startStep - b * BAR}:${semiOf(n.pitchUnits)}`);
		bassByBar.set(b, list);
	}
	const melByBar = new Map<number, number[]>();
	for (const n of [...song.melody].sort((a, b) => a.startStep - b.startStep)) {
		const b = Math.floor(n.startStep / BAR);
		const list = melByBar.get(b) ?? [];
		list.push(semiOf(n.pitchUnits));
		melByBar.set(b, list);
	}
	const bassSrcs = song.spliceStats?.bassSources ?? [];
	let songBassSame = 0;
	let songMelSame = 0;
	song.sections.forEach((sec, si) => {
		const src = srcs[si];
		if (si > 0 && !sec.restatement && srcs[si - 1] === src) adjacentSame++;
		const shift = song.rootShift + sec.keyShift;
		let bestBass = 0;
		let bestMel = 0;
		// ベースは和音の donor とベースの型の donor の両方の元曲と比べる（多い方）。旋律は和音の donor と。
		for (const [which, s2] of [
			["chord", src],
			["bass", bassSrcs[si] ?? src],
		] as const) {
			const skel = skeletons[s2];
			if (!skel) continue;
			const chords = skeletonChords(skel);
			const starts = skel.sections
				.filter((sk) => sk.kind === sec.kind && Math.floor(sk.bars / 4) > 0)
				.map((sk) => sk.start);
			if (which === "chord" && starts.length > 1) ambiguous++;
			for (const start of starts) {
				let bs = 0;
				let ms = 0;
				let run = 0;
				for (let i2 = 0; i2 < sec.bars; i2++) {
					const b = sec.startBar + i2;
					const ob = start + i2;
					const gen = (bassByBar.get(b) ?? []).map((t) => {
						const [st, semi] = t.split(":").map(Number);
						return `${st}:${semi - shift}`;
					});
					if (
						gen.length > 0 &&
						gen.join(",") === skeletonBassBar(skel, ob, chords)
					) {
						bs++;
						run++;
						if (run > worstBassRun) {
							worstBassRun = run;
							worstBassRunSeed = seed;
						}
						const fig = `${song.spliceStats?.figures[b] ?? "?"}(${which})`;
						bassSameByFigure.set(fig, (bassSameByFigure.get(fig) ?? 0) + 1);
					} else run = 0;
					if (which !== "chord") continue;
					const gm = melByBar.get(b);
					const om = skeletonMelodyBar(skel, ob, song.scaleId);
					if (
						gm &&
						om !== null &&
						gm.map((s) => pc(s - shift)).join(",") === om
					)
						ms++;
				}
				bestBass = Math.max(bestBass, bs);
				bestMel = Math.max(bestMel, ms);
			}
		}
		songBassSame += bestBass;
		songMelSame += bestMel;
		for (let i2 = 0; i2 < sec.bars; i2++) {
			if ((bassByBar.get(sec.startBar + i2) ?? []).length > 0) bassBars++;
			if (melByBar.has(sec.startBar + i2)) melBars++;
		}
	});
	bassSame += songBassSame;
	melSame += songMelSame;
	console.log(
		`  seed ${String(seed).padStart(3)} ${song.keyName.padEnd(4)} ${String(song.bars).padStart(3)}小節 src=[${srcs.join(",")}] (a) 最長一致 ${String(run).padStart(2)} 半小節 (元曲 ${runSrc}) / (b) ベース一致 ${songBassSame} 小節 / (c) 旋律一致 ${songMelSame} 小節`,
	);
}
const bassRate = bassSame / Math.max(1, bassBars);
const melRate = melSame / Math.max(1, melBars);
console.log(
	`  合計: (a) 最長一致の最大 ${worstRun} 半小節（seed ${worstRunSeed}、上限 ${maxRun}） / (b) ベースの実音の一致率 ${(bassRate * 100).toFixed(1)}%（${bassSame}/${bassBars} 小節、上限 ${(maxBass * 100).toFixed(0)}%）・連続一致 最長 ${worstBassRun} 小節（seed ${worstBassRunSeed}、上限 ${maxBassRun}） / (c) 旋律の度数列が一致 ${(melRate * 100).toFixed(1)}%（${melSame}/${melBars} 小節、上限 ${(maxMelody * 100).toFixed(0)}%） / (d) 同じ src の連続 ${adjacentSame}${ambiguous > 0 ? ` / 同種セクションが複数ある donor ${ambiguous}（多い方で数えた）` : ""}`,
);
console.log(
	`  (b) の内訳（型ごとの一致小節。chord=和音の donor の元曲、bass=型の donor の元曲。同種セクションが複数ある donor は重複して数える）: ${[...bassSameByFigure].map(([f, n]) => `${f} ${n}`).join(" / ")}`,
);
if (worstRun > maxRun) {
	console.log(`  ✗ (a) 最長一致 ${worstRun} が上限 ${maxRun} を超えた`);
	exitCode = 1;
}
if (worstBassRun > maxBassRun) {
	console.log(
		`  ✗ (b) ベースの実音の連続一致 ${worstBassRun} 小節が上限 ${maxBassRun} を超えた`,
	);
	exitCode = 1;
}
if (bassRate > maxBass) {
	console.log(
		`  ✗ (b) ベースの実音の一致率 ${(bassRate * 100).toFixed(1)}% が上限を超えた`,
	);
	exitCode = 1;
}
if (melRate > maxMelody) {
	console.log(
		`  ✗ (c) 旋律の度数列の一致 ${(melRate * 100).toFixed(1)}% が上限を超えた`,
	);
	exitCode = 1;
}
if (adjacentSame > 0) {
	console.log(`  ✗ (d) 同じ src のセクションが連続 ${adjacentSame}`);
	exitCode = 1;
}
process.exit(exitCode);
