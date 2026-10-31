// 海鮮リスペクトの MML から、テンポ・トラックごとの音符（MIDI 番号）・メタを JSON に書き出す（使い捨て）。
import { readFileSync, writeFileSync } from "node:fs";
import { unitsToPitchV1 } from "../../../../src/audio/tuning";
import { parseMML, parseMmlMeta } from "../../../../src/mml/mml-parser";

const [, , inPath, outPath] = process.argv;
const mml = readFileSync(inPath, "utf8");
const parsed = parseMML(mml);
const meta = parseMmlMeta(mml);
const tracks: Record<number, { start: number; dur: number; midi: number; vel: number }[]> = {};
for (const p of parsed.placements) {
	(tracks[p.trackIndex] ??= []).push({
		start: p.startStep,
		dur: p.durationSteps,
		midi: unitsToPitchV1(p.pitchUnits),
		vel: p.velocity,
	});
}
writeFileSync(outPath, JSON.stringify({ bpm: parsed.bpm, meta, tracks }, null, 0));
console.log("bpm", parsed.bpm, "tracks", Object.keys(tracks).join(","));
