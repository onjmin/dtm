/**
 * 内蔵シンセの音色をトラックの楽器から決める処理（src/audio/synth-tone.ts）の検算。
 *
 *   npx tsx scripts/test/check-synth-tone.ts
 *
 * 1. 楽器が決まらない（`#inst=` も `#t<n>inst=` も無い）トラックは undefined＝従来の square。
 * 2. プリセットの役割どおりに楽器が引かれる（シンプルモードは 3 以上が伴奏、
 *    上級者モードは 4 以上が主旋律の楽器）。`#t<n>inst=` はプリセットより優先。
 * 3. 全プリセット・全役割の楽器名が GM 番号へ引ける（引けないと黙って square に戻る）。
 */
import assert from "node:assert/strict";
import { programOfInstrumentName } from "../../src/audio/audio-config";
import {
	synthToneForProgram,
	synthToneForTrack,
} from "../../src/audio/synth-tone";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";

console.log("● synth-tone tests");

// ---- 1. 楽器なし ----
assert.equal(synthToneForTrack({}, 0), undefined);
assert.equal(synthToneForTrack({ instrument: "no_such_preset" }, 0), undefined);
console.log("  OK  楽器が決まらないトラックは既定の音色");

// ---- 2. 役割・個別楽器 ----
// mml-parser は歌唱合成（ブラウザ専用）まで読むので、宣言は解析済みの形で渡す。
// retro_game: melody=Lead 1 (square), bass=Synth Bass 1, chord=Clavinet
const retro = { instrument: "retro_game" };
assert.deepEqual(synthToneForTrack(retro, 0), { wave: "square" });
assert.deepEqual(synthToneForTrack(retro, 2), { wave: "sawtooth" });
assert.deepEqual(synthToneForTrack(retro, 3), {
	wave: "triangle",
	decay: true,
});
// シンプルモードの @5 は伴奏（Clavinet）、上級者モードは主旋律の楽器
assert.deepEqual(synthToneForTrack(retro, 5), synthToneForTrack(retro, 3));
assert.deepEqual(
	synthToneForTrack({ instrument: "retro_game", mode: "advanced" }, 5),
	{ wave: "square" },
);
// 個別楽器はプリセットより優先（Acoustic Bass → 減衰する三角波）
assert.deepEqual(
	synthToneForTrack(
		{ instrument: "retro_game", trackInstruments: { 0: "Acoustic Bass" } },
		0,
	),
	{ wave: "triangle", decay: true },
);
console.log("  OK  プリセットの役割と個別楽器");

// ---- 3. 全プリセットの楽器名が引ける ----
const missing: string[] = [];
for (const [key, preset] of Object.entries(INSTRUMENT_PRESETS)) {
	for (const role of ["melody", "submelody", "bass", "chord"] as const) {
		if (programOfInstrumentName(preset[role]) === null)
			missing.push(`${key}.${role}: ${preset[role]}`);
	}
}
assert.deepEqual(missing, [], `GM 番号へ引けない楽器名: ${missing.join(", ")}`);
for (let p = 0; p < 128; p++) synthToneForProgram(p);
console.log("  OK  全プリセットの楽器名が GM 番号へ引ける");
console.log("✓ synth-tone: すべて一致");
