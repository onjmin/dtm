/**
 * 骨格借用（`src/compose/compose-skeleton.ts`）の生成物が、借りた骨格の**元曲にどれだけ近いか**を測る。
 *
 *   npx tsx scripts/corpus/check-skeleton-closeness.ts --count 40 --seed 1
 *   npx tsx scripts/corpus/check-skeleton-closeness.ts --source original   # 対照（元曲の度数をそのまま）
 *
 * 生成 N 曲について、借りた骨格（`skeletonId`）の元曲と次を突き合わせる。
 *   (a) 和音列の一致率  … 半小節ごとに構成音のピッチクラス集合が同じ（進行は基準調のまま返るのでそのまま比べる）。骨格どおりなので高い。
 *   (b) 主旋律の度数列  … 歌う小節ごとに音のピッチクラス列が同じ。既定の "phrases" では ≤10% であること
 *                        （元曲の旋律の音は使わない）。"original" では 100% になること。
 *                        比べる相手は骨格（元 MIDI をダイアトニックへ丸めた度数）で、元 MIDI そのものではない。
 *   (c) 主旋律のリズム  … 歌う小節ごとにオンセットと音価の列が同じ。骨格のリズムを借りるので高い。
 * `--max-same` を超えたら exit 1（既定 0.10。"original" は 1.0 未満で exit 1）。
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
import { loadSkeletons } from "./skeleton-data";

const KAIWAI_SKELETONS = loadSkeletons();

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const count = Number.parseInt(argOf("--count") ?? "40", 10);
const baseSeed = Number.parseInt(argOf("--seed") ?? "1", 10);
const template = argOf("--template") ?? "kaiwai_skeleton";
const sourceArg = argOf("--source") ?? "both";
const maxSame = Number.parseFloat(argOf("--max-same") ?? "0.10");
const sources: ("phrases" | "original")[] =
	sourceArg === "both"
		? ["phrases", "original"]
		: [sourceArg as "phrases" | "original"];

const BAR = BASE_STEPS_PER_BAR;
const pc = (v: number): number => ((v % 12) + 12) % 12;
const semiOf = (u: number): number => Math.round(u / UNITS_PER_SEMITONE);

/** 和音名 → 構成音のピッチクラス集合（読めなければ空）。 */
const chordPcs = (name: string, shift: number): string => {
	try {
		return [...new Set(parseChord(name).notes.map((n) => pc(n + shift)))]
			.sort((a, b) => a - b)
			.join(",");
	} catch {
		return "";
	}
};

/** 骨格の和音列（null は継続）を半小節ごとの名前に解く。compose-skeleton.ts と同じ規則。 */
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

/** 生成物の進行（`|` 小節・空白 半小節）を半小節ごとに。1つだけなら両半小節同じ。 */
const songChords = (song: ComposeResult): [string, string][] =>
	song.chordProgression.split("|").map((bar) => {
		const parts = bar.trim().split(/\s+/);
		return [parts[0], parts[1] ?? parts[0]];
	});

type BarRow = { pcs: number[]; onsets: number[]; durs: number[] };

const songRows = (song: ComposeResult): Map<number, BarRow> => {
	const rows = new Map<number, BarRow>();
	const sorted = [...song.melody].sort((a, b) => a.startStep - b.startStep);
	for (const n of sorted) {
		const b = Math.floor(n.startStep / BAR);
		const row = rows.get(b) ?? { pcs: [], onsets: [], durs: [] };
		row.pcs.push(pc(semiOf(n.pitchUnits) - song.rootShift));
		row.onsets.push(n.startStep - b * BAR);
		row.durs.push(n.durationSteps);
		rows.set(b, row);
	}
	return rows;
};

const skeletonRows = (s: Skeleton, scaleId: string): Map<number, BarRow> => {
	const scale = COMPOSE_SCALES[scaleId as keyof typeof COMPOSE_SCALES];
	const rows = new Map<number, BarRow>();
	s.barsData.forEach((bar, b) => {
		if (!bar.melody) return;
		const row: BarRow = { pcs: [], onsets: [], durs: [] };
		let at = 0;
		for (const v of bar.melody.rhythm) {
			if (v > 0) {
				row.onsets.push(at);
				row.durs.push(v);
			}
			at += Math.abs(v);
		}
		row.pcs = bar.melody.degrees.map((d) => pc(degreeToPitch(scale, d).semi));
		rows.set(b, row);
	});
	return rows;
};

const same = (a: number[] | undefined, b: number[] | undefined): boolean =>
	a !== undefined &&
	b !== undefined &&
	a.length === b.length &&
	a.every((v, i) => v === b[i]);

let exitCode = 0;
const byId = new Map(KAIWAI_SKELETONS.map((s) => [s.id, s]));

for (const source of sources) {
	console.log(
		`● 元曲との近さ（${template}, melodySource=${source}, ${count}曲, seed ${baseSeed}〜）`,
	);
	const totals = {
		chordHalf: 0,
		chordSame: 0,
		sung: 0,
		degSame: 0,
		rhySame: 0,
	};
	const used = new Map<string, number>();
	const perSong: string[] = [];
	for (let i = 0; i < count; i++) {
		const seed = baseSeed + i;
		const song = composeSong({
			skeletons: KAIWAI_SKELETONS,
			stepsPerBar: BAR,
			edo: 12,
			template,
			baseKey: "any",
			scale: "auto",
			random: seededRandom(seed * 104729),
			melodySource: source,
		});
		const skel = byId.get(song.skeletonId ?? "");
		if (!skel) {
			console.log(
				`  seed ${seed}: skeletonId ${song.skeletonId} が実データに無い`,
			);
			exitCode = 1;
			continue;
		}
		used.set(skel.id, (used.get(skel.id) ?? 0) + 1);
		// (a) 和音
		const sc = skeletonChords(skel);
		const gc = songChords(song);
		let chordHalf = 0;
		let chordSame = 0;
		for (let b = 0; b < skel.bars; b++)
			for (const h of [0, 1] as const) {
				chordHalf++;
				// 生成物の進行は基準調のまま（移調は rootShift で消費側が掛ける）なので、そのまま比べる。
				if (chordPcs(sc[b][h], 0) === chordPcs(gc[b]?.[h] ?? "", 0))
					chordSame++;
			}
		// (b)(c) 主旋律
		const gr = songRows(song);
		const sr = skeletonRows(skel, song.scaleId);
		let sung = 0;
		let degSame = 0;
		let rhySame = 0;
		for (const [b, row] of sr) {
			sung++;
			const g = gr.get(b);
			if (same(row.pcs, g?.pcs)) degSame++;
			if (same(row.onsets, g?.onsets) && same(row.durs, g?.durs)) rhySame++;
		}
		totals.chordHalf += chordHalf;
		totals.chordSame += chordSame;
		totals.sung += sung;
		totals.degSame += degSame;
		totals.rhySame += rhySame;
		perSong.push(
			`  seed ${String(seed).padStart(3)} ${song.keyName.padEnd(4)} 和音 ${((chordSame / Math.max(1, chordHalf)) * 100).toFixed(0).padStart(3)}% 度数 ${((degSame / Math.max(1, sung)) * 100).toFixed(0).padStart(3)}% リズム ${((rhySame / Math.max(1, sung)) * 100).toFixed(0).padStart(3)}%  ${skel.id}`,
		);
	}
	for (const line of perSong) console.log(line);
	const chordRate = totals.chordSame / Math.max(1, totals.chordHalf);
	const degRate = totals.degSame / Math.max(1, totals.sung);
	const rhyRate = totals.rhySame / Math.max(1, totals.sung);
	console.log(
		`  合計: 骨格 ${used.size} 種 / (a) 和音列の一致 ${(chordRate * 100).toFixed(1)}%（${totals.chordSame}/${totals.chordHalf} 半小節） / (b) 主旋律の度数列の一致 ${(degRate * 100).toFixed(1)}%（${totals.degSame}/${totals.sung} 小節） / (c) 主旋律のリズムの一致 ${(rhyRate * 100).toFixed(1)}%`,
	);
	if (source === "phrases" && degRate > maxSame) {
		console.log(
			`  ✗ 度数列の一致 ${(degRate * 100).toFixed(1)}% が上限 ${(maxSame * 100).toFixed(0)}% を超えた`,
		);
		exitCode = 1;
	}
	if (source === "original" && degRate < 1) {
		console.log("  ✗ original なのに度数列が 100% 一致しない");
		exitCode = 1;
	}
}
process.exit(exitCode);
