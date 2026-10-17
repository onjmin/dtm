/**
 * 「おまかせマスタリング」の役割推定（src/ui/auto-role.ts）の検算。
 *
 *   npx tsx scripts/test/check-auto-role.ts
 *
 * 1. 手作りのノート列: 刻み（短い4声和音）・パッド（単音の全音符）・白玉の和音は伴奏、
 *    低い音はベース、残りの単音は主旋律かサブメロ。
 * 2. 作曲のスロット → 役割の対応が全スロットで決まっている。
 * 3. 生成曲（公開カード4枚 × seed 3本）の全層を推定だけに通す（スロットを隠す）。推定で分けられる
 *    もの——ベース・和音で鳴る層・パッド・主旋律——が作曲のスロットと一致するか。
 *    **単音のアルペジオは推定しない**: 1小節の異なる音高数・型の反復率とも主旋律と分布が重なる
 *    （2026-10-17 実測）。作曲の層は {@link roleOfSlot} で引くのでここでは数えない。
 *    修正前は主旋律 36/40 が「サブメロ」、刻み・パッドが「サブメロ」「主旋律」になっていた。
 */
import assert from "node:assert/strict";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import {
	buildAdvancedLayers,
	type PresetSlot,
} from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import {
	AUTO_ROLE_PAD_MIN_DUR,
	classifyTrackRole,
	computeAutoRoleStats,
	pickTopSingleVoice,
	roleOfSlot,
} from "../../src/ui/auto-role";

console.log("● auto-role tests");
const STEPS_PER_BAR = 192;
const u = (midi: number) => midi * UNITS_PER_SEMITONE;
type N = { pitchUnits: number; startStep: number; durationSteps: number };

// ---- 1. 手作り ----
const stab: N[] = [];
const pad: N[] = [];
const block: N[] = [];
const bass: N[] = [];
const lead: N[] = [];
const obbligato: N[] = [];
for (let bar = 0; bar < 8; bar++) {
	const b = bar * STEPS_PER_BAR;
	for (const pos of [0, 24, 48, 72, 84, 120, 168])
		for (const p of [60, 64, 67, 71])
			stab.push({ pitchUnits: u(p), startStep: b + pos, durationSteps: 12 });
	pad.push({ pitchUnits: u(79), startStep: b, durationSteps: STEPS_PER_BAR });
	for (const p of [60, 64, 67])
		block.push({ pitchUnits: u(p), startStep: b, durationSteps: 96 });
	for (let i = 0; i < 8; i++)
		bass.push({
			pitchUnits: u(i % 2 ? 48 : 36),
			startStep: b + i * 24,
			durationSteps: 22,
		});
	for (let i = 0; i < 16; i++)
		lead.push({
			pitchUnits: u(67 + (i % 5) * 2),
			startStep: b + i * 12,
			durationSteps: 10,
		});
	// 後半2小節だけ上で鳴る対旋律（鳴っている時間は主旋律の半分未満）
	if (bar >= 6)
		for (let i = 0; i < 2; i++)
			obbligato.push({
				pitchUnits: u(84 + i),
				startStep: b + i * 96,
				durationSteps: 90,
			});
}
const stats = new Map(
	Object.entries({ stab, pad, block, bass, lead, obbligato }).map(([k, ns]) => [
		k,
		computeAutoRoleStats(ns),
	]),
);
const top = pickTopSingleVoice(stats);
assert.equal(
	top,
	"lead",
	"主旋律は鳴っている時間が十分ある単音トラックのうち最も高いもの",
);
const role = (k: string) => {
	const st = stats.get(k);
	if (!st) throw new Error(k);
	return classifyTrackRole(st, top === k);
};
assert.equal(role("stab"), "chord", "刻み（短い4声和音）は伴奏");
assert.equal(role("pad"), "chord", "パッド（単音の全音符）は伴奏");
assert.equal(role("block"), "chord", "白玉の和音は伴奏");
assert.equal(role("bass"), "bass", "C3 未満はベース");
assert.equal(role("lead"), "melody", "主旋律");
assert.equal(role("obbligato"), "submelody", "後半だけ上で鳴る単音はサブメロ");
console.log("  OK  手作りのノート列");

// ---- 2. スロット → 役割 ----
const SLOTS: PresetSlot[] = [
	"melody",
	"submelody",
	"bass",
	"chord",
	"solo",
	"chorusLead",
	"chordAlt",
	"sparkle",
	"bassAlt",
	"harmonyAlt",
];
for (const s of SLOTS) assert.ok(roleOfSlot(s), `roleOfSlot(${s})`);
assert.equal(roleOfSlot("chordAlt"), "chord");
assert.equal(roleOfSlot("sparkle"), "chord");
assert.equal(roleOfSlot("bassAlt"), "bass");
assert.equal(roleOfSlot("chorusLead"), "submelody");
console.log("  OK  スロット → 役割");

// ---- 3. 生成曲（推定だけに通す） ----
const TEMPLATES = [
	"kaiwai_2go_lead",
	"kaiwai_speder2_lead",
	"kaiwai_kaisen",
	"game_loop",
];
let total = 0;
let mismatch = 0;
const detail: string[] = [];
for (const template of TEMPLATES) {
	for (let seed = 1; seed <= 3; seed++) {
		const song = composeSong({
			random: seededRandom(seed),
			template,
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			baseKey: "any",
			scale: "auto",
		});
		const layers = buildAdvancedLayers(song, {
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			preset: INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano,
		}).filter((l) => l.notes.length > 0 && l.slot);
		const st = new Map(
			layers.map((l) => [l.index, computeAutoRoleStats(l.notes)]),
		);
		const topIndex = pickTopSingleVoice(st);
		const isSingleArpeggio = (l: (typeof layers)[number]) => {
			const s = st.get(l.index);
			return (
				roleOfSlot(l.slot as PresetSlot) === "chord" &&
				s !== undefined &&
				s.maxPoly === 1 &&
				s.avgDur < AUTO_ROLE_PAD_MIN_DUR
			);
		};
		const topLayer = layers.find((l) => l.index === topIndex);
		for (const l of layers) {
			const s = st.get(l.index);
			if (!s) continue;
			const want = roleOfSlot(l.slot as PresetSlot);
			// 数えないもの: サブメロ側（主旋律との区別は曲次第）、単音のアルペジオ（推定の対象外）、
			// t13 の主旋律写し（静かな側の重ね。主旋律そのものではない）、
			// 主旋律が単音のアルペジオやサブメロ側の層（オクターブ上のサビ重ね等）に上を取られた曲
			// （どちらが主旋律かは音符だけでは決まらない。作曲の層はスロットで引く）。
			if (want === "submelody" || isSingleArpeggio(l) || l.index === 13)
				continue;
			if (
				want === "melody" &&
				topLayer &&
				topLayer.index !== l.index &&
				(isSingleArpeggio(topLayer) ||
					roleOfSlot(topLayer.slot as PresetSlot) === "submelody")
			)
				continue;
			const got = classifyTrackRole(s, l.index === topIndex);
			total++;
			if (got !== want) {
				mismatch++;
				detail.push(
					`${template} seed ${seed} t${l.index} ${l.slot}: ${want} → ${got}`,
				);
			}
		}
	}
}
for (const d of detail) console.log("    ", d);
console.log(`  推定で分けられる層 ${total} のうち外れ ${mismatch}`);
assert.ok(
	mismatch <= Math.floor(total * 0.05),
	`役割推定の外れが 5% を超えた: ${mismatch}/${total}`,
);
console.log("  OK  生成曲の層");
console.log("✓ auto-role: すべて一致");
