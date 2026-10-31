/**
 * アプリの自動作曲（`#seed=` `#compose=`）を1曲作り、層ごとの音符・和音・構成を JSON に書く（使い捨て）。
 * 台詞の曲の伴奏を、手書きの型ではなくリポジトリの作曲器から借りるため。export-samples.ts の appOptions 経路と同じ呼び方。
 *   npx tsx scratch/speech-melody/compose_dump.ts <seed> <template:key:scale:sections> <out.json>
 */
import { writeFileSync } from "node:fs";
import { UNITS_PER_SEMITONE } from "../../../src/audio/tuning";
import { buildChordPlacements } from "../../../src/chord/chords";
import { seededRandom, composeSong } from "../../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../../src/instruments/instrument-presets";
import { loadSkeletons, localExperimentData } from "../../../scripts/corpus/skeleton-data";

const [seedArg, compose, out] = process.argv.slice(2);
const seed = Number.parseInt(seedArg ?? "", 10);
const [template = "custom", baseKey = "any", scale = "auto", sections = ""] = (compose ?? "").split(":");
const song = composeSong({
	skeletons: loadSkeletons(),
	...localExperimentData(),
	stepsPerBar: 192,
	random: seededRandom(seed),
	template: template === "custom" ? undefined : template,
	sections: template === "custom" && sections ? (sections.split("-") as never) : undefined,
	baseKey,
	scale,
} as Parameters<typeof composeSong>[0]);
const chords = buildChordPlacements({
	chordStr: song.chordProgression,
	patternType: song.chordPattern,
	rootShift: song.rootShift,
	bpm: song.bpm,
	stepsPerBar: 192,
});
const mid = (ns: { startStep: number; durationSteps: number; pitchUnits: number; velocity?: number }[]) =>
	ns.map((n) => ({ startStep: n.startStep, durationSteps: n.durationSteps, midi: Math.round(n.pitchUnits / UNITS_PER_SEMITONE), velocity: n.velocity ?? 100 }));
const s = song as unknown as Record<string, unknown>;
writeFileSync(
	out ?? "dump.json",
	JSON.stringify(
		{
			seed,
			compose,
			bpm: song.bpm,
			bars: song.bars,
			keyName: song.keyName,
			rootShift: song.rootShift,
			drum: song.drum,
			instrument: song.instrument,
			preset: INSTRUMENT_PRESETS[song.instrument],
			chordProgression: song.chordProgression,
			chordPattern: song.chordPattern,
			sections: song.sections.map((x) => ({ kind: x.kind, startBar: x.startBar, bars: x.bars, keyShift: x.keyShift })),
			layers: Object.fromEntries(
				["melody", "submelody", "harmony", "harmony2", "octave", "bass", "pad"].filter((k) => Array.isArray(s[k])).map((k) => [k, mid(s[k] as never)]),
			),
			chords: mid(chords),
			otherKeys: Object.keys(s),
		},
		null,
		1,
	),
);
console.log(song.bars, "bars", song.keyName, song.bpm, "BPM", song.drum, song.instrument);
console.log(song.chordProgression.split("|").slice(0, 16).join(" | "));
console.log(song.sections.map((x) => `${x.kind}@${x.startBar}+${x.bars}`).join(" "));
