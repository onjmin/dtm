/**
 * Playload (ZX Spectrum 128 PLAY文) 出力のチェック。
 *
 * Playload は最大3チャンネル（Channel 0, 1, 2）の音源を持ち、
 * 4トラック目以降は無視される。
 */

import { midiToUnits } from "../../src/audio/tuning";
import {
	exportPlayload,
	exportPlayloadChannel,
	pitchToPlayload,
} from "../../src/io/playload-io";
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

console.log("Playload 出力テスト:");

// 1. ピッチ変換の確認 (Middle C = MIDI 60 は O5c)
{
	const c4 = pitchToPlayload(midiToUnits(60));
	check("Middle C (MIDI 60) -> O5c", c4, { octave: 5, note: "c" });

	const cs4 = pitchToPlayload(midiToUnits(61));
	check("C#4 (MIDI 61) -> O5#c", cs4, { octave: 5, note: "#c" });

	const a4 = pitchToPlayload(midiToUnits(69));
	check("A4 (MIDI 69) -> O5a", a4, { octave: 5, note: "a" });

	const c5 = pitchToPlayload(midiToUnits(72));
	check("C5 (MIDI 72) -> O6c", c5, { octave: 6, note: "c" });

	const c3 = pitchToPlayload(midiToUnits(48));
	check("C3 (MIDI 48) -> O4c", c3, { octave: 4, note: "c" });
}

// 2. 基本的なチャンネル変換 (Channel 0: T120V15... 4分音符=5)
{
	const notes: Note[] = [
		{
			id: 1,
			startStep: 0,
			durationSteps: 48,
			pitchUnits: midiToUnits(60),
		},
		{
			id: 2,
			startStep: 48,
			durationSteps: 48,
			pitchUnits: midiToUnits(62),
		},
		{
			id: 3,
			startStep: 96,
			durationSteps: 48,
			pitchUnits: midiToUnits(64),
		},
		{
			id: 4,
			startStep: 144,
			durationSteps: 48,
			pitchUnits: midiToUnits(65),
		},
	];

	const res = exportPlayloadChannel(notes, 0, {
		tempo: 120,
		volume: 100,
		stepsPerBar: 192,
		limitSteps: Number.POSITIVE_INFINITY,
	});

	// T120 V15 O5 N5 c d e f (sticky により音長5とオクターブO5は省略)
	check("基本4音 (C D E F)", res, "T120V15O5N5cdef");
}

// 3. 休符 (&) の挿入確認
{
	const notes: Note[] = [
		{
			id: 1,
			startStep: 0,
			durationSteps: 48, // 4分音符
			pitchUnits: midiToUnits(60),
		},
		// 48..96 は休符 (48 steps = 4分音符)
		{
			id: 2,
			startStep: 96,
			durationSteps: 48,
			pitchUnits: midiToUnits(67),
		},
	];

	const res = exportPlayloadChannel(notes, 1, {
		tempo: 120,
		volume: 80,
		stepsPerBar: 192,
		limitSteps: Number.POSITIVE_INFINITY,
	});

	// Ch 1 なので T はなく V12。O5N5c & g
	check("休符挟み (C & G)", res, "V12O5N5c&g");

	// 先頭が全音符休符の場合: V15 の後に N9& となる（V159 にならない）
	const leadingRestNotes: Note[] = [
		{
			id: 1,
			startStep: 192, // 1小節目は休符
			durationSteps: 48,
			pitchUnits: midiToUnits(60),
		},
	];
	const resRest = exportPlayloadChannel(leadingRestNotes, 0, {
		tempo: 120,
		volume: 100,
		stepsPerBar: 192,
		limitSteps: Number.POSITIVE_INFINITY,
	});
	check(
		"先頭休符で V15 直後に N9& が来る（V159 にならない）",
		resRest,
		"T120V15N9&O5N5c",
	);
}

// 4. 複数トラック（3トラック制限）の確認
{
	const makeTrack = (midi: number): Note[] => [
		{ id: 1, startStep: 0, durationSteps: 48, pitchUnits: midiToUnits(midi) },
	];

	// 5トラック渡す
	const tracks = [
		makeTrack(60), // Track 0 -> Ch 0
		makeTrack(64), // Track 1 -> Ch 1
		makeTrack(67), // Track 2 -> Ch 2
		makeTrack(72), // Track 3 -> 無視される
		makeTrack(76), // Track 4 -> 無視される
	];

	const result = exportPlayload(tracks, { tempo: 150 });
	check("総トラック数", result.totalTrackCount, 5);
	check("使用チャンネル数", result.usedChannelCount, 3);
	check("無視されたトラック数", result.ignoredTrackCount, 2);
	check("出力コード行数", result.code.split("\n").length, 3);
	check(
		"先頭チャンネル出力",
		result.code.includes('play(0, "T150V15O5N5c");'),
		true,
	);
	check(
		"2番目チャンネル出力",
		result.code.includes('play(1, "V15O5N5e");'),
		true,
	);
	check(
		"3番目チャンネル出力",
		result.code.includes('play(2, "V15O5N5g");'),
		true,
	);
}

// 5. 和音の単音化（最高音優先）の確認
{
	const chordNotes: Note[] = [
		// 3音が同時
		{ id: 1, startStep: 0, durationSteps: 48, pitchUnits: midiToUnits(60) }, // C4
		{ id: 2, startStep: 0, durationSteps: 48, pitchUnits: midiToUnits(64) }, // E4
		{ id: 3, startStep: 0, durationSteps: 48, pitchUnits: midiToUnits(67) }, // G4 (最高音)
	];

	const res = exportPlayloadChannel(chordNotes, 0, {
		tempo: 120,
		volume: 100,
		stepsPerBar: 192,
		limitSteps: Number.POSITIVE_INFINITY,
	});

	// 最高音の G4 (MIDI 67 = O5g) だけが選ばれる
	check("和音から最高音 (G4) 抽出", res, "T120V15O5N5g");
}

if (failed > 0) {
	console.error(`\n失敗: ${failed} 件`);
	process.exit(1);
} else {
	console.log("\n全テスト成功！");
}
