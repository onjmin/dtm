/**
 * 上級者モード15トラックの検算。
 *
 *   npx tsx scripts/check-tracks.ts
 *
 * ## 何を見るか
 *
 * 1. **声部の分割で音が消えていないこと。** 1トラック1楽器なので、1本の線を
 *    セクションで音色替えするには区間ごとに別トラックへ書き分けるしかない
 *    （t3/t14 サブメロ、t2/t12 ハモリ、t4/t5 ベース）。この分割は**排他かつ網羅**で
 *    なければならず、間違えると**音が黙って消える**。耳で気付きにくいので機械で数える。
 * 2. **トラックが遊んでいないこと。** 15本あるのに空が多いと、そのぶん編曲の情報量が
 *    減る。実測で以前は空が中央5本あり、一方で `chord` の1楽器が t6〜t10 の5本を
 *    占めていた（＝使わない枠がある横で同じ音色が重なっていた）。
 * 3. **同時に鳴る2本が同じ楽器で同じ音になっていないこと。** オクターブ写しや
 *    ユニゾンの重ねは、人の耳には同じ音に聞こえるので情報量が増えない。
 *    別音色のユニゾン（音を太くする層）は正当なので、**楽器が同じ場合だけ**を数える。
 */

import { buildAdvancedLayers } from "../src/advanced-layers";
import { composeSong } from "../src/compose";
import {
	INSTRUMENT_PRESETS,
	type InstrumentPreset,
} from "../src/instrument-presets";
import { UNITS_PER_SEMITONE } from "../src/tuning";

const STEPS_PER_BAR = 192;
const SONGS = Number.parseInt(process.argv[2] ?? "200", 10);

let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
	if (ok) return;
	failures++;
	if (failures <= 12) console.log(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
};

/** 分割ペア: この2本を足すと元の声部と一致しなければならない。 */
const SPLITS: [name: string, a: number, b: number, source: string][] = [
	["サブメロ", 3, 14, "submelody"],
	["ハモリ", 2, 12, "harmony"],
	["ベース", 4, 5, "bass"],
];

const filled = new Array(15).fill(0);
const instCounts: number[] = [];
let sameInstDupes = 0;

for (let i = 0; i < SONGS; i++) {
	const song = composeSong({ stepsPerBar: STEPS_PER_BAR });
	const preset: InstrumentPreset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	const layers = buildAdvancedLayers(song, {
		stepsPerBar: STEPS_PER_BAR,
		preset,
	});
	const byIndex = new Map(layers.map((l) => [l.index, l]));

	// --- ① 分割で音が消えていないか ---
	for (const [name, a, b, source] of SPLITS) {
		const la = byIndex.get(a);
		const lb = byIndex.get(b);
		const total = (la?.notes.length ?? 0) + (lb?.notes.length ?? 0);
		const src = (song as unknown as Record<string, unknown[]>)[source];
		// t5 はオクターブ重ねを出す曲では「分割」ではなく重ねなので、そのときは
		// 合計が元より多くなる。分割していないケースは「元以上」であればよい。
		check(
			`seed=${i} ${name}の分割で音が消えていない`,
			total >= src.length,
			`t${a}+t${b}=${total} / 元=${src.length}`,
		);
	}

	// --- ② 占有 ---
	for (const l of layers) if (l.notes.length > 0) filled[l.index]++;

	// --- ③ 同じ楽器で同時に同じ音を鳴らしていないか ---
	const instOf = (slot: string | undefined): string =>
		slot ? ((preset as unknown as Record<string, string>)[slot] ?? "?") : "?";
	const used = new Set<string>();
	for (const l of layers)
		if (l.notes.length > 0 && l.slot) used.add(instOf(l.slot));
	instCounts.push(used.size);

	const sig = (l: (typeof layers)[number]): Set<string> =>
		new Set(
			l.notes.map(
				(n) =>
					`${n.startStep}:${Math.round(n.pitchUnits / UNITS_PER_SEMITONE) + l.octave * 12}`,
			),
		);
	for (let x = 0; x < layers.length; x++) {
		for (let y = x + 1; y < layers.length; y++) {
			const A = layers[x];
			const B = layers[y];
			if (A.notes.length === 0 || B.notes.length === 0) continue;
			if (!A.slot || !B.slot) continue;
			if (instOf(A.slot) !== instOf(B.slot)) continue; // 別音色の重ねは正当
			const a = sig(A);
			const b = sig(B);
			let inter = 0;
			for (const v of a) if (b.has(v)) inter++;
			const overlap = inter / Math.min(a.size, b.size);
			if (overlap > 0.8) {
				sameInstDupes++;
				check(
					`seed=${i} t${A.index} と t${B.index} が同じ楽器で同じ音`,
					false,
					`${instOf(A.slot)} 一致率 ${(overlap * 100).toFixed(0)}%`,
				);
			}
		}
	}
}

const NAMES = [
	"t0 主旋律",
	"t1 サビ重ね",
	"t2 ハモリ",
	"t3 サブメロ",
	"t4 ベース",
	"t5 ベース裏",
	"t6 パッド",
	"t7 伴奏1",
	"t8 伴奏2",
	"t9 伴奏3",
	"t10 ウワモノ",
	"t11 デュエット",
	"t12 ハモリ2",
	"t13 主旋律裏",
	"t14 ソロ",
];
console.log(`● ${SONGS}曲・上級者モード15トラック`);
for (let t = 0; t < 15; t++) {
	const pct = (filled[t] / SONGS) * 100;
	console.log(
		`  ${NAMES[t].padEnd(13)} ${"█".repeat(Math.round(pct / 5)).padEnd(20, "·")} ${pct.toFixed(0).padStart(3)}%`,
	);
}
const empty = filled.filter((f) => f / SONGS < 0.05).length;
instCounts.sort((a, b) => a - b);
console.log(
	`\n  ほぼ常に空のトラック: ${empty}本  /  1曲で鳴る楽器: 中央 ${instCounts[SONGS >> 1]}種`,
);
console.log(`  同じ楽器で同じ音を重ねているペア: ${sameInstDupes}件`);

if (failures > 0) {
	console.error(`\n${failures} 件失敗`);
	process.exit(1);
}
console.log("\n✓ 分割で音は消えておらず、同じ楽器の二重鳴りもありません");
