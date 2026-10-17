/**
 * 楽器リードと伴奏の噛み合いを測る。リードの発音時に鳴っている伴奏（t0・t1・t13 以外の全層）の
 * 音名と比べ、長さで重みづけて「同じ音名」「半音でこすれる」の割合を出す。
 * こすれの相手が和音の展開（パッド・刻み・装飾）か、旋律から作る層（ハモリ・サブメロ）か、ベースかも分ける。
 *
 *   npx tsx scripts/compose/measure-lead-harmony.ts --template kaiwai_2go_lead --seeds 1-20
 *
 * 手書きのリード（所有者が「使う」とした kw4）は 83%・3%、直す前の生成器は 57〜59%・27%（2026-10-18）。
 */

import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : fallback;
};
const TEMPLATE = arg("template", "kaiwai_2go_lead");
const seeds = arg("seeds", "1-20")
	.split(",")
	.flatMap((r) => {
		const [a, b] = r.split("-").map(Number);
		return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
	});
const BAR = 192;
const LEADS = new Set([0, 1, 13]);
const GROUP: Record<number, string> = {
	2: "melodic",
	3: "melodic",
	14: "melodic",
	4: "bass",
	5: "bass",
};
const pc = (u: number): number => ((Math.round(u / 31) % 12) + 12) % 12;
const pct = (x: number, d: number): string =>
	`${((100 * x) / Math.max(1, d)).toFixed(0)}%`.padStart(4);

type Row = {
	ct: number;
	half: number;
	tot: number;
	longHalf: number;
	longTot: number;
};
const sum: Row = { ct: 0, half: 0, tot: 0, longHalf: 0, longTot: 0 };
const bySrc = new Map<string, number>();
for (const seed of seeds) {
	const song = composeSong({
		random: seededRandom(seed),
		template: TEMPLATE,
		stepsPerBar: BAR,
		edo: 12,
		baseKey: "any",
		scale: "auto",
	});
	const layers = buildAdvancedLayers(song, {
		stepsPerBar: BAR,
		edo: 12,
		preset: INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano,
	});
	const lead = layers.find((l) => l.index === 0)?.notes ?? [];
	const acc = layers
		.filter((l) => !LEADS.has(l.index))
		.flatMap((l) =>
			l.notes.map((n) => ({ ...n, g: GROUP[l.index] ?? "chord" })),
		);
	const r: Row = { ct: 0, half: 0, tot: 0, longHalf: 0, longTot: 0 };
	for (const n of lead) {
		const at = n.startStep + 1;
		const on = acc.filter(
			(x) => x.startStep <= at && x.startStep + x.durationSteps > at,
		);
		if (!on.length) continue;
		const p = pc(n.pitchUnits);
		const pcs = new Set(on.map((x) => pc(x.pitchUnits)));
		const w = n.durationSteps;
		r.tot += w;
		if (w >= 24) r.longTot += w;
		if (pcs.has(p)) {
			r.ct += w;
			continue;
		}
		const rub = on.filter((x) => {
			const d = (pc(x.pitchUnits) - p + 12) % 12;
			return d === 1 || d === 11;
		});
		if (!rub.length) continue;
		r.half += w;
		if (w >= 24) r.longHalf += w;
		for (const g of new Set(rub.map((x) => x.g)))
			bySrc.set(g, (bySrc.get(g) ?? 0) + w);
	}
	for (const k of Object.keys(sum) as (keyof Row)[]) sum[k] += r[k];
	console.log(
		`${String(seed).padStart(5)} bpm${song.bpm} 和音の音 ${pct(r.ct, r.tot)}  半音 ${pct(r.half, r.tot)}  8分以上の半音 ${pct(r.longHalf, r.longTot)}`,
	);
}
console.log(
	`合計  和音の音 ${pct(sum.ct, sum.tot)}  半音 ${pct(sum.half, sum.tot)}  8分以上の半音 ${pct(sum.longHalf, sum.longTot)}`,
);
console.log(
	"半音の相手（重複あり）:",
	[...bySrc].map(([g, w]) => `${g} ${pct(w, sum.half)}`).join("  "),
);
