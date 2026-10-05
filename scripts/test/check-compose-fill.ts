/**
 * 範囲補完（`src/compose/compose-fill.ts`）の検算。
 *
 *   npx tsx scripts/test/check-compose-fill.ts
 *
 * 1. UI に出ている全スタイル × 全種別で、音が範囲の外へ出ない・和音の小節数が合う・
 *    上級者モードの層も範囲の中に収まる。
 * 2. 移調: 借用曲の主音が曲の調の主音（長調なら平行短調）へ来る。
 * 3. 代用: 間奏を持たないスタイルでも間奏が作れ、歌メロはソロへ回る（歌の層は空）。
 * 4. 範囲の見つけ方（空いている小節・曲の末尾）と歌詞の継ぎ。
 */

import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import {
	type ComposedNote,
	seededRandom,
	transposeChordName,
} from "../../src/compose/compose";
import {
	detectSongKey,
	FILL_FALLBACKS,
	fillRange,
	findEmptyBars,
	songEndBar,
	spliceLyrics,
	transposeFor,
} from "../../src/compose/compose-fill";
import {
	SECTION_ORDER,
	type SectionKind,
	STRUCTURE_TEMPLATES,
} from "../../src/compose/compose-sections";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import { COMPOSE_GENRES } from "../../src/ui/compose-genres";

const STEPS_PER_BAR = 192;
let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
	if (ok) return;
	failures++;
	if (failures <= 20) console.log(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
};

const templates = [
	...new Set(
		COMPOSE_GENRES.flatMap((g) => [g.template(true), g.template(false)]),
	),
];
check(
	"カードのテンプレートが全部ある",
	templates.every((t) => STRUCTURE_TEMPLATES.some((s) => s.name === t)),
	templates.join(","),
);

const inRange = (notes: ComposedNote[], from: number, to: number): boolean =>
	notes.every(
		(n) =>
			n.startStep >= from &&
			n.startStep < to &&
			n.startStep + n.durationSteps <= to &&
			n.durationSteps >= 1,
	);

const preset = INSTRUMENT_PRESETS.piano;
let runs = 0;
for (const template of templates) {
	for (const kind of SECTION_ORDER) {
		const startBar = 7;
		const bars = kind === "intro" ? 4 : 12;
		const key = { tonicPc: 2, mode: "minor" as const };
		const fill = fillRange({
			stepsPerBar: STEPS_PER_BAR,
			template,
			kind,
			startBar,
			bars,
			key,
			random: seededRandom(runs + 1),
		});
		runs++;
		const label = `${template}/${kind}`;
		const from = startBar * STEPS_PER_BAR;
		const to = (startBar + bars) * STEPS_PER_BAR;
		check(
			`${label}: 代用順にある種別`,
			FILL_FALLBACKS[kind].includes(fill.usedKind),
			fill.usedKind,
		);
		for (const [role, notes] of Object.entries(fill.roles))
			check(`${label}: ${role} が範囲内`, inRange(notes, from, to));
		check(`${label}: 和音が範囲内`, inRange(fill.chordNotes, from, to));
		check(
			`${label}: 和音の小節数`,
			fill.chordBars.length === bars &&
				fill.chordBars.every((c) => c.length > 0),
			fill.chordBars.join("|"),
		);
		const total = Object.values(fill.roles).reduce((a, n) => a + n.length, 0);
		check(`${label}: 何か鳴る`, total + fill.chordNotes.length > 0);
		if (kind !== "intro")
			check(`${label}: ベースが鳴る`, fill.roles.bass.length > 0);
		const layers = fill.advancedLayers(preset);
		check(`${label}: 15層`, layers.length === 15, String(layers.length));
		for (const layer of layers)
			check(
				`${label}: t${layer.index} が範囲内`,
				inRange(layer.notes, from, to),
			);
		// 歌わない種別は歌の層が空。間奏はソロか主旋律（楽器リードのスタイル）が鳴る。
		if (kind === "interlude" || kind === "intro") {
			const tmpl = STRUCTURE_TEMPLATES.find((t) => t.name === template);
			const sung = !tmpl?.lead;
			if (sung)
				check(
					`${label}: 歌の層が空`,
					fill.roles.melody.length === 0 &&
						fill.roles.harmony.length === 0 &&
						fill.roles.octave.length === 0,
				);
			if (kind === "interlude")
				check(
					`${label}: 間奏に旋律がある`,
					fill.roles.solo.length + fill.roles.melody.length > 0,
				);
		}
		// 移調: 借用曲の主音（イ短調＋rootShift）が曲の主音へ来る
		const donorTonic = (9 + fill.donor.rootShift) % 12;
		check(
			`${label}: 移調`,
			(((donorTonic + fill.transpose) % 12) + 12) % 12 === key.tonicPc,
			`${donorTonic}+${fill.transpose}`,
		);
		// 和音は絶対名で、借用曲の進行を rootShift＋移調で動かしたもの
		const donorBar =
			fill.donor.chordProgression.split("|")[fill.section.startBar];
		check(
			`${label}: 和音の移調`,
			fill.chordBars[0] ===
				donorBar
					.split(" ")
					.map((c) =>
						transposeChordName(c, fill.donor.rootShift + fill.transpose),
					)
					.join(" "),
			`${fill.chordBars[0]} vs ${donorBar}`,
		);
	}
}
console.log(`範囲補完: ${runs} 通り`);

// 移調の向き（長調は平行短調へ、差は -5〜6 に畳む）
check("transposeFor: 不明なら 0", transposeFor(3, null) === 0);
check(
	"transposeFor: Am→Dm",
	transposeFor(0, { tonicPc: 2, mode: "minor" }) === 5,
);
check(
	"transposeFor: C major → Am（平行短調）",
	transposeFor(0, { tonicPc: 0, mode: "major" }) === 0,
);
check(
	"transposeFor: -5〜6 に畳む",
	transposeFor(0, { tonicPc: 3, mode: "minor" }) === 6 &&
		transposeFor(0, { tonicPc: 4, mode: "minor" }) === -5,
);

// 同じ種で同じ結果（再現性）
{
	const a = fillRange({
		stepsPerBar: STEPS_PER_BAR,
		template: "kaiwai_2go",
		kind: "chorus",
		startBar: 0,
		bars: 8,
		key: null,
		random: seededRandom(42),
	});
	const b = fillRange({
		stepsPerBar: STEPS_PER_BAR,
		template: "kaiwai_2go",
		kind: "chorus",
		startBar: 0,
		bars: 8,
		key: null,
		random: seededRandom(42),
	});
	check(
		"同じ種で同じ結果",
		JSON.stringify(a.roles) === JSON.stringify(b.roles) &&
			a.donorSeed === b.donorSeed,
	);
	// 範囲がセクションより長いときは回す（音が途切れない）
	const long = fillRange({
		stepsPerBar: STEPS_PER_BAR,
		template: "kaiwai_speder2_lead",
		kind: "verse",
		startBar: 2,
		bars: 40,
		key: null,
		random: seededRandom(7),
	});
	const barsWithBass = new Set(
		long.roles.bass.map((n) => Math.floor(n.startStep / STEPS_PER_BAR)),
	);
	check(
		"長い範囲でもベースが全小節にある",
		barsWithBass.size === 40,
		String(barsWithBass.size),
	);
}

// 範囲の見つけ方
{
	const n = (
		bar: number,
		len = 1,
	): { startStep: number; durationSteps: number } => ({
		startStep: bar * STEPS_PER_BAR,
		durationSteps: len * STEPS_PER_BAR,
	});
	check("空: 音が無い", findEmptyBars([], STEPS_PER_BAR) === null);
	const r = findEmptyBars([n(0), n(1), n(4), n(5)], STEPS_PER_BAR);
	check("空: 2〜3小節目", r?.startBar === 2 && r.bars === 2, JSON.stringify(r));
	check(
		"空: 途切れが無ければ null",
		findEmptyBars([n(0, 2), n(2)], STEPS_PER_BAR) === null,
	);
	check(
		"空: 長い音がまたぐ小節は空でない",
		findEmptyBars([n(0, 3), n(3)], STEPS_PER_BAR) === null,
	);
	check("末尾: 空の曲は 0", songEndBar([], STEPS_PER_BAR) === 0);
	check(
		"末尾: 2小節目の途中まで→2",
		songEndBar([{ startStep: 192, durationSteps: 10 }], STEPS_PER_BAR) === 2,
	);
}

// 歌詞の継ぎ（1文字1音の素朴な分割で検算）
{
	const tok = (s: string): string[] => [...s];
	check(
		"歌詞: 真ん中を差し替える",
		spliceLyrics("あいうえお", tok, 2, 2, "かき") === "あいかきお",
	);
	check(
		"歌詞: 末尾に足す",
		spliceLyrics("あい", tok, 2, 0, "かき") === "あいかき",
	);
	check("歌詞: 消すだけ", spliceLyrics("あいうえお", tok, 1, 3, "") === "あお");
	check(
		"歌詞: 歌詞が足りなくても落ちない",
		spliceLyrics("あ", tok, 3, 2, "か") === "あか",
	);
}

// 調の推定（UNITS 基準の音から）
{
	const notes = [0, 2, 4, 5, 7, 9, 11, 0].map((semi) => ({
		pitchUnits: (60 + semi) * UNITS_PER_SEMITONE,
		durationSteps: semi === 0 ? 96 : 24,
	}));
	const key = detectSongKey(notes);
	check(
		"調: ハ長調の音階はハ長調",
		key?.tonicPc === 0 && key.mode === "major",
		JSON.stringify(key),
	);
	check("調: 音が無ければ null", detectSongKey([]) === null);
}

if (failures > 0) {
	console.log(`check-compose-fill: ${failures} 件の失敗`);
	process.exit(1);
}
console.log("check-compose-fill: OK");
