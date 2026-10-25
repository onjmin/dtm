/**
 * AddMusicK（AMK）MML 出力のチェック。
 *
 * AMK は 8 チャンネル・各チャンネル単音・o1〜o6・テンポは `t = BPM × 0.4096`。
 * 和音の声部分け、小節をまたぐ音の `^`、繰り返しのラベル付きループを確かめる。
 */

import { midiToUnits } from "../../src/audio/tuning";
import {
	amkLength,
	bpmToAmkTempo,
	exportAMK,
	splitVoices,
} from "../../src/io/amk-io";
import type { Note } from "../../src/types";

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	const ok = a === b;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) {
		console.log(`        実際: ${a}`);
		console.log(`        期待: ${b}`);
	}
};

let nextId = 1;
const note = (midi: number, start: number, dur: number): Note => ({
	id: nextId++,
	startStep: start,
	durationSteps: dur,
	pitchUnits: midiToUnits(midi),
});

/** ヘッダとコメントを除いた本文（チャンネル行以降）だけを取り出す。 */
const body = (text: string): string[] =>
	text
		.split("\n")
		.filter((l) => l !== "" && !l.startsWith(";") && !l.startsWith("#amk"));

console.log("AddMusicK 出力テスト:");

// 1. テンポと音長
{
	check("120 BPM -> t49", bpmToAmkTempo(120), 49);
	check("4分音符 = 48 tick -> 4", amkLength(48), "4");
	check("付点8分 = 36 tick -> 8.", amkLength(36), "8.");
	check("3連8分 = 16 tick -> 12", amkLength(16), "12");
	check("割り切れない長さ -> =60", amkLength(60), "=60");
	check("全音符より長い -> 1^4", amkLength(240), "1^4");
}

// 2. 単旋律 1 小節（C4 = o4c）
{
	const res = exportAMK([{ notes: [note(60, 0, 48), note(64, 48, 48)] }], {
		bpm: 120,
	});
	check("1チャンネル", res.channelCount, 1);
	check("本文", body(res.text), ["#0 t49 @9 v220 y10", "o4c4e4r2"]);
}

// 3. 和音は声部に分かれ、上の声が先のチャンネル
{
	const voices = splitVoices(
		[note(60, 0, 96), note(64, 0, 96), note(67, 0, 96)],
		Number.POSITIVE_INFINITY,
	);
	check("3声に分かれる", voices.length, 3);
	check(
		"上から G E C",
		voices.map((v) => Math.round(v[0].pitchUnits / midiToUnits(1))),
		[67, 64, 60],
	);
}

// 4. 8チャンネルを超えた声部は捨てる。第1声部が優先される
{
	const chord = (base: number): Note[] =>
		[0, 2, 4, 5, 7].map((d) => note(base + d, 0, 48));
	const res = exportAMK([
		{ notes: chord(60), role: "chord" },
		{ notes: chord(48), role: "chord" },
		{ notes: [note(36, 0, 48)], role: "bass" },
	]);
	check("8チャンネルに収まる", res.channelCount, 8);
	check("11声部のうち3声部が捨てられる", res.droppedVoiceCount, 3);
	check("ベースは残る", res.text.includes("@8"), true);
}

// 5. 小節をまたぐ音は次の小節頭の ^ でつながる
{
	const res = exportAMK([{ notes: [note(60, 144, 96)] }], { bpm: 120 });
	check("タイ", body(res.text).slice(1), ["r2.o4c4 ^4r2."]);
}

// 6. 音域外はオクターブを寄せて数える
{
	const res = exportAMK([{ notes: [note(108, 0, 192)] }]);
	check("C8 -> o6c", body(res.text)[1], "o6c1");
	check("寄せた数", res.octaveShiftedCount, 1);
}

// 7. 繰り返しはラベル付きループになり、2 回目以降は呼び出しになる
{
	const phrase = (bar: number): Note[] =>
		[60, 62, 64, 65].map((m, k) => note(m, bar * 192 + k * 48, 48));
	const other = [note(72, 2 * 192, 192)];
	const res = exportAMK([
		{ notes: [...phrase(0), ...phrase(1), ...other, ...phrase(3)] },
	]);
	check("ループ", body(res.text).slice(1), ["(1)[o4c4d4e4f4]2 o5c1 (1)1"]);
	const flat = exportAMK([{ notes: [...phrase(0), ...phrase(1)] }], {
		compress: false,
	});
	check("compress: false は展開", body(flat.text).slice(1), [
		"o4c4d4e4f4 o4c4d4e4f4",
	]);
}

// 8. 小節数の上限
{
	const res = exportAMK([{ notes: [note(60, 0, 192), note(62, 192, 192)] }], {
		barLimit: 1,
	});
	check("1小節で切る", body(res.text).slice(1), ["o4c1"]);
}

if (failed > 0) {
	console.error(`\n失敗: ${failed} 件`);
	process.exit(1);
} else {
	console.log("\n全テスト成功！");
}
