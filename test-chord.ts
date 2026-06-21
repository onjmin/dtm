const fs = require("fs");
const { parseMML } = require("./dist/index.js");
const { detectChord } = require("@onjmin/chord-parser");

const mml = fs.readFileSync("tmp/mml.md", "utf-8");
const { placements } = parseMML(mml, { collectTokens: true });

console.log("Placements count:", placements.length);

const maxStep = placements.reduce(
	(max, p) => Math.max(max, p.startStep + p.durationSteps),
	0,
);
console.log("Max step:", maxStep);

const stepPitches = Array.from(
	{ length: maxStep + 1 },
	() => new Set(),
);
for (const p of placements) {
	for (let s = p.startStep; s < p.startStep + p.durationSteps; s++) {
		if (s >= 0 && s <= maxStep) {
			stepPitches[s].add(p.pitch);
		}
	}
}

// 1. ラッチ（ホールド）なしの場合のコード検出
const stepChordsNoLatch = [];
let detectedCountNoLatch = 0;
for (let s = 0; s <= maxStep; s++) {
	const pitches = Array.from(stepPitches[s]);
	if (pitches.length === 0) {
		stepChordsNoLatch.push("");
		continue;
	}
	const sortedPitches = pitches.sort((a, b) => a - b);
	const candidates = detectChord(sortedPitches);
	const chordName = candidates[0]?.symbol ?? "";
	stepChordsNoLatch.push(chordName);
	if (chordName) detectedCountNoLatch++;
}

// 2. ラッチ（ホールド）ありの場合のコード検出
const stepChordsWithLatch = [];
let lastChord = "";
let detectedCountWithLatch = 0;
for (let s = 0; s <= maxStep; s++) {
	const pitches = Array.from(stepPitches[s]);
	if (pitches.length === 0) {
		stepChordsWithLatch.push(lastChord);
		if (lastChord) detectedCountWithLatch++;
		continue;
	}
	const sortedPitches = pitches.sort((a, b) => a - b);
	const candidates = detectChord(sortedPitches);
	const chordName = candidates[0]?.symbol ?? "";
	if (chordName) lastChord = chordName;
	stepChordsWithLatch.push(lastChord);
	if (lastChord) detectedCountWithLatch++;
}

console.log("\n--- Coverage Statistics ---");
console.log(`No Latch:  ${detectedCountNoLatch}/${maxStep} steps (${((detectedCountNoLatch/maxStep)*100).toFixed(1)}%) have chord names.`);
console.log(`With Latch: ${detectedCountWithLatch}/${maxStep} steps (${((detectedCountWithLatch/maxStep)*100).toFixed(1)}%) have chord names.`);

console.log("\n--- First 400 steps comparison (Sample every 12 steps) ---");
for (let s = 0; s <= Math.min(400, maxStep); s += 12) {
	console.log(`Step ${s.toString().padStart(3, " ")} | No Latch: ${stepChordsNoLatch[s].padEnd(10, " ")} | With Latch: ${stepChordsWithLatch[s]}`);
}
