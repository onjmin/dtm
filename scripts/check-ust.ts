/**
 * UST入出力のチェック。
 *
 * USTは「ノート＋歌詞」がひと続きの本文に並ぶだけの素朴なテキストなので、
 * 壊れ方も素朴で分かりにくい——休符でノート番号が1つずれる、連続音の前置き
 * （`a か`）を歌詞に混ぜてしまう、`+`（前の歌詞を続ける）を落として音節と
 * ノートの1:1が崩れる、といった類。目視では気付けないので、代表的な書き方を
 * 並べて「取り込み後のノート列と歌詞」を突き合わせる。
 *
 * 出力側は往復（parse → buildUst → parse）で確かめる。USTは単旋律しか
 * 表現できないため、和音を出力したときに1本へ潰れることも併せて見る。
 */

import { pitchV1ToUnits } from "../src/tuning";
import type { Note } from "../src/types";
import { buildUst, decodeUstText, parseUst } from "../src/ust-io";

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

/** テスト用のUSTを組み立てる（`[#nnnn]` の連番はここで振る）。 */
const ust = (
	notes: { length: number; lyric: string; noteNum: number }[],
	tempo = 150,
): string =>
	[
		"[#VERSION]",
		"UST Version1.2",
		"[#SETTING]",
		`Tempo=${tempo.toFixed(2)}`,
		"Tracks=1",
		...notes.flatMap((n, i) => [
			`[#${String(i).padStart(4, "0")}]`,
			`Length=${n.length}`,
			`Lyric=${n.lyric}`,
			`NoteNum=${n.noteNum}`,
			"PreUtterance=",
		]),
		"[#TRACKEND]",
	].join("\r\n");

console.log("■ 取り込み（ノートと歌詞の1:1）");
{
	// 480tick = 4分音符 = 48step。休符はノートを作らず位置だけ進める。
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "あ", noteNum: 60 },
			{ length: 240, lyric: "R", noteNum: 60 },
			{ length: 240, lyric: "い", noteNum: 62 },
			{ length: 480, lyric: "+", noteNum: 64 },
		]),
		"test.ust",
	);
	check("BPMは[#SETTING]のTempo", parsed.bpm, 150);
	check(
		"休符はノートにならず、位置だけ進む",
		parsed.notes.map((n) => [n.startStep, n.durationSteps, n.pitch]),
		[
			[0, 48, 60],
			[72, 24, 62],
			[96, 48, 64],
		],
	);
	check(
		"歌詞は休符を消費しない（ノート数と同じ音節数）",
		parsed.lyrics,
		"あいー",
	);
}

console.log("■ 原音名の揺れ");
{
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "- か", noteNum: 60 }, // 連続音（語頭）
			{ length: 480, lyric: "a き", noteNum: 60 }, // 連続音
			{ length: 480, lyric: "くC4", noteNum: 60 }, // 音階サフィックス
			{ length: 480, lyric: "kya", noteNum: 60 }, // ローマ字（拗音）
			{ length: 480, lyric: "shi", noteNum: 60 }, // ローマ字（ヘボン式）
			{ length: 480, lyric: "ツ", noteNum: 60 }, // カタカナ
			{ length: 480, lyric: "i k", noteNum: 60 }, // CVVCの子音だけの断片
		]),
	);
	check(
		"実体のかなだけを掬い、読めない断片は継続記号にする",
		parsed.lyrics,
		"かきくきゃしつー",
	);
	check("読めなかった歌詞の数を数える", parsed.unknownLyricCount, 1);
}

console.log("■ 先頭の継続記号");
{
	// 行き場の無い継続記号は normalizeLyrics に捨てられ、以降が1つずれる。
	// ノートを消費する休符記号へ倒して1:1を守る。
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "+", noteNum: 60 },
			{ length: 480, lyric: "あ", noteNum: 62 },
		]),
	);
	check("先頭の継続記号は休符記号になる", parsed.lyrics, "_あ");
	check("ノートは2つとも残る", parsed.notes.length, 2);
}

console.log("■ [#PREV] / [#NEXT] は取り込まない");
{
	const text = [
		"[#SETTING]",
		"Tempo=120.00",
		"[#PREV]",
		"Length=480",
		"Lyric=ぜ",
		"NoteNum=60",
		"[#0000]",
		"Length=480",
		"Lyric=ん",
		"NoteNum=62",
		"[#NEXT]",
		"Length=480",
		"Lyric=ご",
		"NoteNum=64",
		"[#TRACKEND]",
	].join("\r\n");
	const parsed = parseUst(text);
	check("前後の参考ノートは無視する", parsed.lyrics, "ん");
	check("位置も進めない（先頭は0step）", parsed.notes[0]?.startStep, 0);
}

console.log("■ 文字コードの自動判別");
{
	const utf8 = ust([{ length: 480, lyric: "さ", noteNum: 60 }]);
	// Shift_JISの「さ」は 0x82 0xB3。UTF-8としては不正な並びなので判別できる。
	const sjis = new Uint8Array([
		...Buffer.from(utf8.split("Lyric=さ")[0], "ascii"),
		...Buffer.from("Lyric="),
		0x82,
		0xb3,
		...Buffer.from(utf8.split("Lyric=さ")[1], "ascii"),
	]);
	check("Shift_JISのUSTを読める", parseUst(sjis).lyrics, "さ");
	check(
		"UTF-8のUSTを読める",
		parseUst(new Uint8Array(Buffer.from(utf8, "utf8"))).lyrics,
		"さ",
	);
	check(
		"BOM付きUTF-8も読める",
		decodeUstText(new Uint8Array(Buffer.from(`﻿${utf8}`, "utf8"))).startsWith(
			"[#VERSION]",
		),
		true,
	);
}

console.log("■ 書き出し（往復）");
{
	const note = (
		startStep: number,
		durationSteps: number,
		pitch: number,
	): Note => ({
		id: 0,
		startStep,
		durationSteps,
		pitchUnits: pitchV1ToUnits(pitch),
		velocity: 100,
	});
	const notes = [note(0, 48, 60), note(72, 24, 62), note(96, 48, 64)];
	const text = buildUst({ notes, syllables: ["あ", "い", "ー"], bpm: 150 });
	const back = parseUst(text);
	check(
		"ノートが往復する（隙間は休符ノートとして書かれる）",
		back.notes.map((n) => [n.startStep, n.durationSteps, n.pitch]),
		[
			[0, 48, 60],
			[72, 24, 62],
			[96, 48, 64],
		],
	);
	check("歌詞が往復する", back.lyrics, "あいー");
	check(
		"CRLFで書き、TRACKENDで終わる",
		/\r\n\[#TRACKEND\]\r\n$/.test(text),
		true,
	);
}

console.log("■ 書き出し（和音は単旋律へ潰す）");
{
	const note = (startStep: number, pitch: number): Note => ({
		id: 0,
		startStep,
		durationSteps: 48,
		pitchUnits: pitchV1ToUnits(pitch),
		velocity: 100,
	});
	// 同時刻の3和音 + 次の単音。USTは単旋律なので先勝ちで1本になる。
	const notes = [note(0, 60), note(0, 64), note(0, 67), note(48, 62)];
	const back = parseUst(
		buildUst({ notes, syllables: ["あ", "い", "う", "え"], bpm: 120 }),
	);
	check(
		"同時刻のノートは先頭だけ残る",
		back.notes.map((n) => [n.startStep, n.pitch]),
		[
			[0, 60],
			[48, 62],
		],
	);
	check("捨てたノートの音節も捨てる", back.lyrics, "あえ");
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
