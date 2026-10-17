/**
 * audit-arrangement.ts の関門を生成器の素の出力（流派の規則で作った曲）に掛け、指標の分布と不合格の数を流派ごとに出す。
 * 関門の閾値を動かしたら必ず回す。素の出力を多く落とす関門は、流派に忠実な曲を落とす関門（docs/compose-harness.md §3）。
 *
 *   npx tsx scripts/compose/calibrate-arrangement-gates.ts [--count 20] [--template game_loop]
 *
 * 1曲ごとに audit-arrangement.ts を子プロセスで回すので 4 流派 × 20 曲で数分かかる。
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { MMLCore } from "../../src/mml/mml-core";
import type { Note, RenderConfig } from "../../src/types";

const BAR = 192;
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const COUNT = Number(arg("count") ?? "20");
const ONLY = arg("template");
const OUT_DIR = "tmp/arrangement-gates";
/** テンプレート → audit-arrangement の --profile */
const PROFILE_OF: Record<string, string> = {
	kaiwai_2go_lead: "2go",
	kaiwai_speder2_lead: "speder2",
	kaiwai_kaisen: "kaisen",
	game_loop: "game",
};
/** セクション種別 → 部の名前（A で始まればAメロ、B で始まればサビ） */
const PART_OF: Record<string, string> = {
	intro: "intro",
	verse: "A",
	prechorus: "pre",
	chorus: "B",
	drop_chorus: "B",
	bridge: "break",
	interlude: "break",
	outro: "outro",
};
const config: RenderConfig = {
	stepsPerBar: BAR,
	keyCount: 88,
	pitchRangeStart: 0,
	unitsPerRow: 31,
	keyHeight: 12,
	stepWidth: 2,
	edo: 12,
};
const core = new MMLCore(
	{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
	100,
	() => config,
);
const quantile = (xs: number[], f: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))];
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [template, profile] of Object.entries(PROFILE_OF)) {
	if (ONLY && ONLY !== template) continue;
	const metrics: Record<string, number>[] = [];
	const fails = new Map<string, number>();
	for (let seed = 1; seed <= COUNT; seed++) {
		const song = composeSong({
			random: seededRandom(seed),
			template,
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
		let id = 1;
		const lines = layers
			.filter((l) => l.notes.length)
			.map((l) => {
				const notes = l.notes.map(
					(n) =>
						({
							id: id++,
							startStep: n.startStep,
							durationSteps: n.durationSteps,
							pitchUnits: n.pitchUnits + l.octave * 12 * 31,
							velocity: n.velocity ?? 100,
						}) as Note,
				);
				return `@${l.index} ${core.getMMLFromNotes(notes, song.bpm, l.volume).trim()}`;
			});
		const file = `${OUT_DIR}/${template}-${seed}.mml`;
		writeFileSync(file, `${["#mode=advanced", ...lines, "#end"].join(";\n")};`);
		const sections = song.sections
			.map((s) => `${PART_OF[s.kind] ?? s.kind}:${s.bars}`)
			.join(",");
		const key = song.keyName.replace("♯", "#").replace("♭", "b");
		const json = `${file}.json`;
		spawnSync(
			"npx",
			[
				"tsx",
				"scripts/compose/audit-arrangement.ts",
				file,
				"--profile",
				profile,
				"--key",
				key,
				"--sections",
				sections,
				"--json",
				json,
			],
			{ encoding: "utf8", shell: true },
		);
		const r = JSON.parse(readFileSync(json, "utf8"));
		metrics.push(r.metrics);
		for (const g of r.gates)
			if (g.ok === false) fails.set(g.name, (fails.get(g.name) ?? 0) + 1);
	}
	console.log(`\n## ${template}（--profile ${profile}、seed 1〜${COUNT}）\n`);
	console.log(
		"| 指標 | 最小 | p10 | p50 | p90 | 最大 |\n|---|---|---|---|---|---|",
	);
	for (const k of [
		"clash",
		"bpm",
		"sixteenth",
		"occupancy",
		"range",
		"harmonies",
		"lift",
		"ioiRatio",
	]) {
		const xs = metrics.map((m) => Number(m[k])).filter(Number.isFinite);
		if (!xs.length) continue;
		console.log(
			`| ${k} | ${[0, 0.1, 0.5, 0.9, 1].map((f) => quantile(xs, f).toFixed(2)).join(" | ")} |`,
		);
	}
	console.log(
		`\n関門の不合格: ${[...fails].map(([k, v]) => `${k} ${v}`).join(" / ") || "なし"}`,
	);
}
