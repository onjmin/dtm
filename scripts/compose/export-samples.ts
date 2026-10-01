/**
 * 生成した曲を .mid で書き出す。**指標ではなく耳で確かめる**ための唯一の出口。
 *
 *   npx tsx scripts/compose/export-samples.ts [--out tmp/samples] [--count 6] [--seed 1]
 *                                     [--template jpop_standard] [--bars 24]
 *
 * **アプリで作った曲を再現する:** 書き出した MML の先頭にある `#seed=` と `#compose=` を
 * そのまま渡す。同じ曲が1本出る（アプリと同じ乱数列 `seededRandom` を使う）。
 *
 *   npx tsx scripts/compose/export-samples.ts --app-seed 4022250974 --compose jpop_standard:any:auto:intro-verse-chorus
 *
 * **伴奏主体モード**（`#compose=style:<スタイル id>.v<版>:<baseKey>:<候補番号>`、
 * `docs/accomp-style-engine.md` §2.5）は `composeAccomp` と `accompToMml` へ振り分け、.mid ではなく
 * .mml（強弱・ミックス込み。DAW に貼って聴ける）を書く。31平均律で作った曲は `--edo 31` を足す
 * （`#compose` は音律を持たない）。段階 S0 より前の書式 `accomp:<baseKey>:<候補番号>` は
 * `style:fb.v1:…` として読む。
 *
 *   npx tsx scripts/compose/export-samples.ts --app-seed 3842857959 --compose style:fb.v1:any:0
 *
 * 知らないテンプレート名（`--template`・`--compose` の1項目め）はエラーにする（黙って既定構成の
 * 歌もの曲を出さない）。
 *
 * `compare-*.ts` はどれも代理指標で、全部が参考コーパスの帯へ収まっても
 * 「良い曲」である保証は無い。書き出した .mid を DAW なり再生ソフトなりへ
 * 放り込んで聴くところまでが検算の一部。
 *
 * seed を指定すると決定的に同じ曲が出るので、変更の前後で聴き比べられる。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";
import { programOfInstrumentName } from "../../src/audio/audio-config";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import { buildChordPlacements } from "../../src/chord/chords";
import {
	seededRandom as appSeededRandom,
	composeSong,
} from "../../src/compose/compose";
import { STRUCTURE_TEMPLATES } from "../../src/compose/compose-sections";
import {
	DRUM_PATTERNS,
	resolveDrumPattern,
} from "../../src/instruments/drum-config";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { exportMIDI } from "../../src/io/midi-io";
import type { Note } from "../../src/types";
import { loadSkeletons, localExperimentData } from "../corpus/skeleton-data";

const KAIWAI_SKELETONS = loadSkeletons();
const LOCAL = localExperimentData();
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

/**
 * 構成テンプレートの名前（`compose-sections.ts` の `STRUCTURE_TEMPLATES`）。`composeSong` は知らない
 * 名前を黙って既定構成にする（`orderedKinds`）ので、打ち間違えると別物の曲が出て気づけない。ここで弾く。
 */
const TEMPLATE_NAMES = STRUCTURE_TEMPLATES.map((t) => t.name);
const assertTemplate = (name: string | undefined, flag: string): void => {
	if (name === undefined || TEMPLATE_NAMES.includes(name)) return;
	const extra = flag === "--compose" ? " / custom / accomp" : "";
	throw new Error(
		`${flag}: 知らないテンプレート "${name}"（${TEMPLATE_NAMES.join(" / ")}${extra}）`,
	);
};
const template = argOf("--template");
assertTemplate(template, "--template");
mkdirSync(outDir, { recursive: true });

/**
 * アプリの `#seed=` `#compose=` から作曲の引数を組み立てる。
 * `#compose=` は `テンプレート:調:音階:セクション(-区切り)`（daw.ts の runCompose と同じ並び）。
 */
const appSeedArg = argOf("--app-seed");
const appCompose = argOf("--compose");
/**
 * 伴奏主体モードの `#compose`（`style:<スタイル id>.v<版>:<baseKey>:<候補番号>`。旧書式 `accomp:…` も）。
 * 中身は `exportAccomp` が `parseAccompCompose` で読む（ここで compose-accomp を読まないのは、
 * 歌ものの書き出しで読み込みを増やさないため）。
 */
const isAccomp = /^(style|accomp):/.test(appCompose ?? "");
if (isAccomp && appSeedArg === undefined)
	throw new Error("--compose style:… には --app-seed が要る");
const appOptions = (() => {
	if (appSeedArg === undefined || isAccomp) return null;
	const seed = Number.parseInt(appSeedArg, 10);
	if (!Number.isFinite(seed)) throw new Error("--app-seed は整数");
	const [tmpl = "custom", baseKey = "any", scale = "auto", sections = ""] = (
		appCompose ?? ""
	).split(":");
	if (tmpl !== "custom") assertTemplate(tmpl, "--compose");
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

/**
 * 伴奏主体モードの再現（`docs/accomp-compose.md` §12.5）。アプリと同じ種・同じ候補番号で
 * `composeAccomp` を呼び、`accompToMml` で .mml を書く。`accompToMml` は mml-parser を読み、その先で
 * 歌唱合成エンジン @onjmin/koe（ブラウザ専用）を読むので、ここだけ空のスタブを入れてから読む。
 */
const exportAccomp = (seed: number, compose: string): void => {
	const edo = argOf("--edo") === "31" ? 31 : 12;
	type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
	const loader = Module as unknown as Loader;
	const load = loader._load;
	loader._load = (request, ...rest) =>
		request === "@onjmin/koe"
			? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
			: load(request, ...rest);
	const { composeAccomp, parseAccompCompose } =
		require("../../src/compose/compose-accomp") as typeof import("../../src/compose/compose-accomp");
	const { accompStyleById } =
		require("../../src/compose/accomp-styles/index") as typeof import("../../src/compose/accomp-styles/index");
	const tag = parseAccompCompose(compose);
	if (!tag)
		throw new Error(
			`--compose ${compose}: style:<スタイル id>.v<版>:<baseKey>:<候補番号> ではない`,
		);
	const style = accompStyleById(tag.style);
	if (!style)
		throw new Error(`--compose ${compose}: 知らないスタイル ${tag.style}`);
	if (tag.version !== style.version)
		console.warn(
			`   ${tag.style} の版 ${tag.version} は今の版 ${style.version} と違うので、同じ曲にはならない（古い版は残していない）`,
		);
	if (tag.legacy)
		console.warn(
			`   旧書式 ${compose} を style:fb.v1:${tag.baseKey}:${tag.pick} として読む`,
		);
	if (tag.pick === "plan")
		throw new Error(
			`--compose ${compose}: …:plan は計画を丸ごと与えた曲で、種からは再現できない（scripts/accomp/accomp-audition.ts --fb-plan を使う）`,
		);
	const { baseKey, pick } = tag;
	const k = String(pick);
	const { accompToMml } =
		require("../../src/compose/compose-accomp-mml") as typeof import("../../src/compose/compose-accomp-mml");
	const song = composeAccomp({
		style: tag.style,
		stepsPerBar: STEPS_PER_BAR,
		edo,
		random: appSeededRandom(seed),
		baseKey,
		pick,
	});
	if (song.pick !== pick)
		console.warn(
			`   候補 ${pick} は関門で落ちたので保険の計画（pick −1）になった: ${JSON.stringify(song.draws.rejected)}`,
		);
	const keyTag = song.keyName
		.replace(/♭/g, "b")
		.replace(/[♯#]/g, "s")
		.replace(/[^\w]/g, "");
	const name = `accomp_seed${seed}_${baseKey}_${k}_${keyTag}_${song.bpm}bpm.mml`;
	const file = join(outDir, name);
	writeFileSync(file, accompToMml(song, { seed }));
	console.log(
		`${file}\n   ${song.bars}小節 ${song.seconds.toFixed(0)}秒 ${song.keyLabel} ${song.bpm}BPM  ${song.compose}${song.homeFromMinor ? `  ${song.homeFromMinor}` : ""}`,
	);
};

const recent: number[][] = [];
const main = async (): Promise<void> => {
	if (isAccomp && appSeedArg !== undefined && appCompose !== undefined) {
		const seed = Number.parseInt(appSeedArg, 10);
		if (!Number.isFinite(seed)) throw new Error("--app-seed は整数");
		exportAccomp(seed, appCompose);
		return;
	}
	for (let i = 0; i < (appOptions ? 1 : count); i++) {
		const seed = appOptions ? appOptions.seed : baseSeed + i;
		// アプリの種はアプリと同じ乱数列で、`recent`（直近の曲から離す加点）は渡さない
		// ——アプリも作曲時点の直近を渡しているので厳密には一致しないが、
		// 候補の選抜順位が僅かに動く程度で、種が同じなら同じ素材から同じ曲が出る。
		const song = composeSong(
			appOptions
				? {
						skeletons: KAIWAI_SKELETONS,
						...LOCAL,
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
