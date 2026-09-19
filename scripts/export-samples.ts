/**
 * 生成した曲を .mid で書き出す。**指標ではなく耳で確かめる**ための唯一の出口。
 *
 *   npx tsx scripts/export-samples.ts [--out tmp/samples] [--count 6] [--seed 1]
 *                                     [--template jpop_standard] [--bars 24]
 *
 * **アプリで作った曲を再現する:** 書き出した MML の先頭にある `#seed=` と `#compose=` を
 * そのまま渡す。同じ曲が1本出る（アプリと同じ乱数列 `seededRandom` を使う）。
 *
 *   npx tsx scripts/export-samples.ts --app-seed 4022250974 --compose jpop_standard:any:auto:intro-verse-chorus
 *
 * `compare-*.ts` はどれも代理指標で、全部が参考コーパスの帯へ収まっても
 * 「良い曲」である保証は無い。書き出した .mid を DAW なり再生ソフトなりへ
 * 放り込んで聴くところまでが検算の一部。
 *
 * seed を指定すると決定的に同じ曲が出るので、変更の前後で聴き比べられる。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { programOfInstrumentName } from "../src/audio-config";
import { buildChordPlacements } from "../src/chords";
import { seededRandom as appSeededRandom, composeSong } from "../src/compose";
import { DRUM_PATTERNS, resolveDrumPattern } from "../src/drum-config";
import { INSTRUMENT_PRESETS } from "../src/instrument-presets";
import { exportMIDI } from "../src/midi-io";
import { UNITS_PER_SEMITONE } from "../src/tuning";
import type { Note } from "../src/types";

const STEPS_PER_BAR = 192;
const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** 決定的に回すための線形合同法の乱数（check-compose.ts と同じもの）。 */
const seededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

let nextId = 1;
const toNotes = (
	ns: {
		startStep: number;
		pitchUnits: number;
		durationSteps: number;
		velocity?: number;
	}[],
): Note[] =>
	ns.map((n) => ({
		id: nextId++,
		startStep: n.startStep,
		durationSteps: n.durationSteps,
		pitchUnits: n.pitchUnits as Note["pitchUnits"],
		velocity: n.velocity ?? 100,
	}));

const outDir = argOf("--out") ?? "tmp/samples";
const count = Number.parseInt(argOf("--count") ?? "6", 10);
const baseSeed = Number.parseInt(argOf("--seed") ?? "1", 10);
const template = argOf("--template");
mkdirSync(outDir, { recursive: true });

/**
 * アプリの `#seed=` `#compose=` から作曲の引数を組み立てる。
 * `#compose=` は `テンプレート:調:音階:セクション(-区切り)`（daw.ts の runCompose と同じ並び）。
 */
const appSeedArg = argOf("--app-seed");
const appCompose = argOf("--compose");
const appOptions = (() => {
	if (appSeedArg === undefined) return null;
	const seed = Number.parseInt(appSeedArg, 10);
	if (!Number.isFinite(seed)) throw new Error("--app-seed は整数");
	const [tmpl = "custom", baseKey = "any", scale = "auto", sections = ""] = (
		appCompose ?? ""
	).split(":");
	return {
		seed,
		template: tmpl === "custom" ? undefined : tmpl,
		sections:
			tmpl === "custom" && sections
				? (sections.split("-") as Parameters<typeof composeSong>[0]["sections"])
				: undefined,
		baseKey,
		scale,
	};
})();

const recent: number[][] = [];
const main = async (): Promise<void> => {
	for (let i = 0; i < (appOptions ? 1 : count); i++) {
		const seed = appOptions ? appOptions.seed : baseSeed + i;
		// アプリの種はアプリと同じ乱数列で、`recent`（直近の曲から離す加点）は渡さない
		// ——アプリも作曲時点の直近を渡しているので厳密には一致しないが、
		// 候補の選抜順位が僅かに動く程度で、種が同じなら同じ素材から同じ曲が出る。
		const song = composeSong(
			appOptions
				? {
						stepsPerBar: STEPS_PER_BAR,
						random: appSeededRandom(seed),
						template: appOptions.template,
						sections: appOptions.sections,
						baseKey: appOptions.baseKey,
						scale: appOptions.scale,
					}
				: {
						stepsPerBar: STEPS_PER_BAR,
						random: seededRandom(seed * 104729),
						recent: recent.slice(-3),
						template,
					},
		);
		recent.push(song.stats.fingerprint);

		// 伴奏（コード）トラックはコード進行の文字列から組み立てる。
		const chords = buildChordPlacements({
			chordStr: song.chordProgression,
			patternType: song.chordPattern,
			rootShift: song.rootShift,
			bpm: song.bpm,
			stepsPerBar: STEPS_PER_BAR,
		});
		const preset =
			INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
		const melProg = programOfInstrumentName(preset.melody) ?? 0;
		const subProg = programOfInstrumentName(preset.submelody) ?? 11;
		const bassProg = programOfInstrumentName(preset.bass) ?? 33;
		const chordProg = programOfInstrumentName(preset.chord) ?? 89;

		const blob = exportMIDI({
			tracks: [
				{ notes: toNotes(song.melody), volume: 100, program: melProg },
				{ notes: toNotes(song.submelody), volume: 70, program: subProg },
				{ notes: toNotes(song.harmony), volume: 60, program: melProg },
				{ notes: toNotes(song.harmony2), volume: 52, program: melProg },
				// オクターブ重ねは音高が主旋律のままで、アプリではトラック側で
				// 1オクターブ下げる（advanced-layers.ts の octave: -1）。同じ音高で
				// 書き出すと主旋律を重ねただけになるので、ここでも下げる。
				{
					notes: toNotes(
						song.octave.map((n) => ({
							...n,
							pitchUnits: n.pitchUnits - 12 * UNITS_PER_SEMITONE,
						})),
					),
					volume: 44,
					program: melProg,
				},
				{ notes: toNotes(song.bass), volume: 85, program: bassProg },
				{ notes: toNotes(song.pad), volume: 50, program: chordProg },
				{ notes: toNotes(chords), volume: 65, program: chordProg },
			],
			getDrumPattern: (bar) =>
				resolveDrumPattern(song.drum, DRUM_PATTERNS, bar),
			drumVolume: 80,
			bpm: song.bpm,
			stepsPerBar: STEPS_PER_BAR,
		});

		const name = `${String(i + 1).padStart(2, "0")}_seed${seed}_${song.keyName.replace(/[^\w]/g, "")}_${song.bpm}bpm_${song.instrument}_${song.drum}.mid`;
		const file = join(outDir, name);
		writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
		console.log(
			`${file}\n   ${song.bars}小節 ${song.keyLabel} ${song.bpm}BPM  ${song.chordPattern}  点数 ${song.stats.score.toFixed(3)}`,
		);
		console.log(
			`   ${song.chordProgression.split("|").slice(0, 8).join(" | ")} ...`,
		);
		const harmonyBars = new Set(
			song.harmony.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
		).size;
		console.log(
			`   歌: ハモリ ${song.vocal.harmonyKinds.join("/")} ${harmonyBars}小節${song.vocal.harmony2 ? "・2声" : ""}${song.vocal.octaveLayer ? "・オクターブ重ね" : ""}  掛け合い ${song.vocal.duetStyle}${song.vocal.duetSpans.length ? `（${song.vocal.duetSpans.length}区間）` : ""}`,
		);
	}
};
void main();
