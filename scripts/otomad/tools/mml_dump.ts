/** 当たりの MML を音符の JSON にする（使い捨て）。 npx tsx scratch/speech-melody/mml_dump.ts <in.mml> <out.json> */
import { readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";

// mml-parser の先で読む @onjmin/koe はブラウザ専用（export-samples.ts と同じスタブ）
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe" ? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 } : load(request, ...rest);
const { parseMML, parseMmlMeta } = require("../../../src/mml/mml-parser") as typeof import("../../../src/mml/mml-parser");

const [inp, out] = process.argv.slice(2);
const mml = readFileSync(inp as string, "utf-8");
const p = parseMML(mml, { stepsPerBar: 192, collectLyrics: true });
writeFileSync(out as string, JSON.stringify({ bpm: p.bpm, meta: parseMmlMeta(mml), placements: p.placements, lyrics: p.lyrics ? [...p.lyrics] : [] }));
console.log("bpm", p.bpm, "notes", p.placements.length);
