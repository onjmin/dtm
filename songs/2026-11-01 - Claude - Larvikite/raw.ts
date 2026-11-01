import { writeFileSync } from "node:fs";
import { SECTIONS, generate, toMML } from "./lib";
SECTIONS.length = 0; SECTIONS.push("intro", "verse", "chorus", "bridge", "outro");
writeFileSync(process.argv[2], toMML(generate("kaiwai_2go_lead", 2)));
