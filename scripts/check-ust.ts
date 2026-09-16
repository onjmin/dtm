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

import { pinyinToMoras } from "../src/pinyin";
import { pitchV1ToUnits } from "../src/tuning";
import type { Note } from "../src/types";
import {
	buildUst,
	decodeUstText,
	looksLikePinyin,
	parseUst,
} from "../src/ust-io";

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
	notes: {
		length: number;
		lyric: string;
		noteNum: number;
		/** Mode2 のピッチ線（`PBS=…`）。書いた行がそのままノートへ入る。 */
		mode2?: string[];
	}[],
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
			...(n.mode2 ?? []),
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

console.log("■ Mode2のピッチ線");
{
	// BPM150 → 1ステップ 8.33ms。全音符(1920tick=192step)を、頭から順に5半音
	// 下げる線を描く。NoteNum は動かさず、ポルタメント記号のノートで写す。
	const parsed = parseUst(
		ust([
			{
				length: 1920,
				lyric: "あ",
				noteNum: 72,
				mode2: ["PBS=0;0.0", "PBW=400,400,400", "PBY=-20.0,-40.0,-50.0"],
			},
		]),
	);
	check(
		"先頭は NoteNum のまま（ピアノロールの位置を動かさない）",
		[parsed.notes[0].startStep, parsed.notes[0].pitch],
		[0, 72],
	);
	check(
		"描かれた高さがノートになる",
		parsed.notes.map((n) => n.pitch),
		[72, 71, 70, 69, 68, 67],
	);
	check("音節はポルタメント記号で繋ぐ", parsed.lyrics, "あ〜〜〜〜〜");
	// ピッチ線のノートは MML が1音で書ける音価に乗っていないといけない。
	// 乗っていないと書き出しで手前を切られ、余りの休符がポルタメントの直前へ
	// 入って結合が切れる＝滑らかな1音のはずが短い音の連打になる。
	const MML_STEPS = [6, 8, 12, 16, 18, 24, 36, 48, 72, 96, 144, 192];
	check(
		"繋ぎの手前はMMLで書ける音価（書き出しで休符が挟まらない）",
		parsed.notes
			.slice(0, -1)
			.map((n) => n.durationSteps)
			.filter((d) => !MML_STEPS.includes(d)),
		[],
	);
	// 合成側は60ms未満のノートを60msへ引き伸ばすため、それより短く刻むと
	// 次の音と実際に重なってしまう。
	const msPerStep = 60000 / 150 / 48;
	check(
		"どの区間も60ms以上",
		parsed.notes.every((n) => n.durationSteps * msPerStep >= 60),
		true,
	);
	check(
		"隙間なく並ぶ（1音へ結合できる形）",
		parsed.notes.every(
			(n, i) =>
				i === 0 ||
				n.startStep ===
					parsed.notes[i - 1].startStep + parsed.notes[i - 1].durationSteps,
		),
		true,
	);
}

console.log("■ Mode2のピッチ線（写さないもの）");
{
	// 前のノートの高さから滑り込む入りのポルタメント（UTAUが繋ぎ目に既定で書く）。
	// ピアノロールでは隣のノートへ移ることがそのまま繋ぎなので、階段にしない。
	const glide = parseUst(
		ust([
			{ length: 480, lyric: "あ", noteNum: 72 },
			{
				length: 480,
				lyric: "い",
				noteNum: 67,
				mode2: ["PBS=-50;50.0", "PBW=100", "PBY=0.0"],
			},
		]),
	);
	check("入りのポルタメントはノートにしない", glide.notes.length, 2);
	check("歌詞もそのまま", glide.lyrics, "あい");

	// 半音に満たない揺れは、写しても同じ高さへ丸まるだけなのでノートを増やさない。
	const tiny = parseUst(
		ust([
			{
				length: 1920,
				lyric: "あ",
				noteNum: 72,
				mode2: ["PBS=0;0.0", "PBW=400,400", "PBY=-4.0,0.0"],
			},
		]),
	);
	check("半音未満の揺れはノートにしない", tiny.notes.length, 1);
}

console.log("■ 接尾辞付きの休符");
{
	// 多音階・声色を接尾辞で切り替える音源は、休符にも同じ接尾辞を付ける
	// （`RE` `R2`、連続音では `a RE`）。`re` `ra` はローマ字命名の「れ」「ら」
	// なので、大文字Rに小文字の母音が続く綴りだけは休符にしない。
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "あ", noteNum: 60 },
			{ length: 240, lyric: "a RE", noteNum: 60 }, // 連続音＋接尾辞付き休符
			{ length: 240, lyric: "R2", noteNum: 60 }, // 数字の接尾辞
			{ length: 480, lyric: "い", noteNum: 62 },
			{ length: 480, lyric: "re", noteNum: 64 }, // ローマ字の「れ」
		]),
	);
	check("接尾辞付きの休符はノートにならない", parsed.notes.length, 3);
	check("小文字のローマ字は休符と混同しない", parsed.lyrics, "あいれ");
	check("読めなかった歌詞は無い", parsed.unknownLyricCount, 0);
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

console.log("■ ブレス（息継ぎ）");
{
	// UST側ではブレス用のノートが時間を占めるが、このアプリの `、` はノートを
	// 消費しない記号なので、ノートは作らず直前の音節へ畳む。
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "あ", noteNum: 60 },
			{ length: 240, lyric: "息R", noteNum: 60 }, // 吐く息
			{ length: 480, lyric: "い", noteNum: 62 },
			{ length: 240, lyric: "R吸", noteNum: 60 }, // 吸う息
			{ length: 480, lyric: "e 息R", noteNum: 64 }, // 連続音の前置き付き
			{ length: 240, lyric: "@br1", noteNum: 60 }, // OpenUtauのエイリアス
			{ length: 480, lyric: "う", noteNum: 65 },
		]),
	);
	check(
		"ブレスは直前の音節へ畳む（連続したぶんは1つ）",
		parsed.lyrics,
		"あ、い、う",
	);
	check("ブレス表記は読めなかった歌詞に数えない", parsed.unknownLyricCount, 0);
	check(
		"ブレスはノートにならず、その時間は隙間として残る",
		parsed.notes.map((n) => [n.startStep, n.durationSteps, n.pitch]),
		[
			[0, 48, 60],
			[72, 48, 62],
			[216, 48, 65],
		],
	);
	// 畳む相手が無いブレス（先頭・休符の直後）は息継ぎにならないので捨てる。
	const head = parseUst(
		ust([
			{ length: 240, lyric: "@br1", noteNum: 60 },
			{ length: 480, lyric: "あ", noteNum: 60 },
		]),
	);
	check("行き場の無い先頭のブレスは捨てる", head.lyrics, "あ");
	check("捨てても位置は進む", head.notes[0]?.startStep, 24);
	// ブレスの直後の継続記号は引き継ぐ母音を失う（normalizeLyrics に捨てられ、
	// 以降が1つずれる）。パート先頭と同じく休符記号へ倒して1:1を守る。
	const after = parseUst(
		ust([
			{ length: 480, lyric: "あ", noteNum: 60 },
			{ length: 240, lyric: "息R", noteNum: 60 },
			{ length: 480, lyric: "+", noteNum: 62 },
			{ length: 480, lyric: "+", noteNum: 64 },
			{ length: 480, lyric: "い", noteNum: 65 },
		]),
	);
	check("ブレス直後の継続記号は休符記号になる", after.lyrics, "あ、__い");
	check("ノートは4つとも残る", after.notes.length, 4);
}

console.log("■ 中国語ピンイン（かなへの転写）");
{
	// 声母×韻母の組み立てと、慣用のカタカナ表記へ倒している箇所を代表で見る。
	const moras = (token: string): string =>
		pinyinToMoras(token)?.join("+") ?? "";
	check("基本（声母＋韻母）", moras("ni"), "に");
	check("撥音の韻尾は別モーラ", moras("xing"), "し+ん");
	check("-ng も撥音へ倒す", moras("kan"), "か+ん");
	check("二重母音の後半も別モーラ", moras("tou"), "と+お");
	check("介音iは拗音へ畳む", moras("xiao"), "しゃ+お");
	check("介音uは畳まず並べる", moras("guo"), "ぐ+お");
	check("そり舌音はジャ行・チャ行・シャ行", moras("zhong"), "じょ+ん");
	check("e[ɤ]はア段（慣用）", moras("she"), "しゃ");
	check(
		"-en -ei はエ段（慣用）",
		`${moras("hen")}/${moras("mei")}`,
		"へ+ん/め+い",
	);
	check(
		"舌尖母音のi",
		`${moras("zi")}/${moras("ci")}/${moras("si")}`,
		"ず/つ/す",
	);
	check(
		"üはユ段（j/q/xの後ろのuもü）",
		`${moras("qu")}/${moras("lv")}`,
		"ちゅ/りゅ",
	);
	check(
		"省略綴り（iu=iou, ui=uei, un=uen）",
		`${moras("liu")}/${moras("dui")}/${moras("dun")}`,
		"りょ+お/どぅ+え+い/どぅ+え+ん",
	);
	check(
		"零声母（y/w）",
		`${moras("yi")}/${moras("wo")}/${moras("yue")}/${moras("you")}`,
		"い/う+お/ゆぇ/よ+お",
	);
	check("erは巻き舌", moras("er"), "あ+る");
	check("声調番号は無視する", moras("xing1"), "し+ん");
	check("ピンインでない綴りは読まない", `${moras("tsu")}|${moras("xyz")}`, "|");
}

console.log("■ 中国語ピンイン（取り込み）");
{
	// 1音節が複数モーラになるぶんは、元のノートを割って割り当てる。
	const parsed = parseUst(
		ust([
			{ length: 480, lyric: "xing", noteNum: 68 },
			{ length: 480, lyric: "xing", noteNum: 68 },
			{ length: 240, lyric: "ti", noteNum: 66 },
			{ length: 240, lyric: "tou", noteNum: 66 },
			{ length: 480, lyric: "she", noteNum: 68 },
		]),
	);
	check("ピンインをかなへ写す", parsed.lyrics, "しんしんてぃとおしゃ");
	check("読めなかった歌詞は無い", parsed.unknownLyricCount, 0);
	check(
		"尻のモーラは短く、頭が大半を持つ",
		parsed.notes.map((n) => [n.startStep, n.durationSteps, n.pitch]),
		[
			[0, 36, 68],
			[36, 12, 68],
			[48, 36, 68],
			[84, 12, 68],
			[96, 24, 66],
			[120, 18, 66],
			[138, 6, 66],
			[144, 48, 68],
		],
	);
	// 長いノートで撥音だけが伸び続けないよう、尻には上限がある。
	const long = parseUst(
		ust([
			{ length: 1920, lyric: "xing", noteNum: 60 },
			{ length: 480, lyric: "xing", noteNum: 60 },
			{ length: 480, lyric: "xing", noteNum: 60 },
		]),
	);
	check(
		"尻のモーラの長さには上限がある",
		long.notes.map((n) => n.durationSteps),
		[180, 12, 36, 12, 36, 12],
	);
}

console.log("■ 中国語ピンイン（判定）");
{
	// `wo` は日本語ローマ字なら「を」、ピンインなら「ウオ」。トークン単体では
	// 決められないので、ピンインでしか成立しない綴りが過半を占めるかで決める。
	const japanese = parseUst(
		ust([
			{ length: 480, lyric: "wo", noteNum: 60 },
			{ length: 480, lyric: "ka", noteNum: 60 },
			{ length: 480, lyric: "ki", noteNum: 60 },
			{ length: 480, lyric: "ku", noteNum: 60 },
		]),
	);
	check("日本語ローマ字のUSTはそのまま読む", japanese.lyrics, "をかきく");
	check("ノートも割らない", japanese.notes.length, 4);
	// 日本語音源の拡張かな（`she` `fa`）はピンインとしても読めるので、
	// 数個の一致でピンインへ倒れないことを見る。
	const extended = parseUst(
		ust([
			{ length: 480, lyric: "she", noteNum: 60 },
			{ length: 480, lyric: "fa", noteNum: 60 },
			{ length: 480, lyric: "ka", noteNum: 60 },
			{ length: 480, lyric: "ki", noteNum: 60 },
			{ length: 480, lyric: "ku", noteNum: 60 },
			{ length: 480, lyric: "ke", noteNum: 60 },
			{ length: 480, lyric: "ko", noteNum: 60 },
			{ length: 480, lyric: "sa", noteNum: 60 },
		]),
	);
	check("拡張かなの原音名では倒れない", extended.notes.length, 8);
	check(
		"ピンイン判定は歌詞全体で決める",
		looksLikePinyin(["xing", "tou", "she"]),
		true,
	);
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

console.log("■ 書き出し（ノートを消費しない記号）");
{
	const note = (startStep: number, pitch: number): Note => ({
		id: 0,
		startStep,
		durationSteps: 48,
		pitchUnits: pitchV1ToUnits(pitch),
		velocity: 100,
	});
	// ブレス `、` はUSTに書ける表現が無いので落とす。フェード `↓` `↑` は
	// エンベロープへ写すので、`Lyric=` には残さない。
	const text = buildUst({
		notes: [note(0, 60), note(48, 62), note(96, 64)],
		syllables: ["あ、", "ー↓", "_、"],
		bpm: 120,
	});
	check(
		"記号は原音名に残さない",
		[...text.matchAll(/^Lyric=(.*)$/gm)].map((m) => m[1]),
		["あ", "+", "R"],
	);
}

console.log("■ 書き出し（クレッシェンド・デクレッシェンド）");
{
	/** `count` 個の4分音符を隙間なく並べる。 */
	const run = (count: number): Note[] =>
		Array.from({ length: count }, (_, i) => ({
			id: i,
			startStep: i * 48,
			durationSteps: 48,
			pitchUnits: pitchV1ToUnits(60),
			velocity: 100,
		}));
	/** 書き出したUSTから `Envelope=` の値だけを拾う。 */
	const envelopes = (syllables: string[]): string[] => {
		const text = buildUst({
			notes: run(syllables.length),
			syllables,
			bpm: 120,
		});
		return [...text.matchAll(/^Envelope=(.*)$/gm)].map((m) => m[1]);
	};

	check("記号が無ければエンベロープを書かない", envelopes(["あ", "ー"]), []);
	check("1音のデクレッシェンドはピークから下限まで", envelopes(["あ↓"]), [
		"0,5,35,0,100,2,0",
	]);
	// 継続で繋がった範囲＝アプリが1つの音として扱う範囲へ、通しで掛ける。
	// 各ノートの出口と次のノートの入口が同じ値になっていること（＝階段にならない）。
	check(
		"継続で繋がったノートを跨いで掛かる",
		envelopes(["あ", "ー", "ー", "ー↓"]),
		[
			"0,5,35,0,100,38,0",
			"0,5,35,0,38,14,0",
			"0,5,35,0,14,5,0",
			"0,5,35,0,5,2,0",
		],
	);
	check("クレッシェンドは小さく入って最大で終わる", envelopes(["あ", "ー↑"]), [
		"0,5,35,0,2,14,0",
		"0,5,35,0,14,100,0",
	]);
	check("併記はスウェル（中央で最大）", envelopes(["あ↑", "ー↓"]), [
		"0,5,35,0,2,100,0",
		"0,5,35,0,100,2,0",
	]);
	// 複数書くと、書いた位置が減り方の中継点になる（`ぎ↓ー↓` = 50%→0%）。
	check("複数書いたぶんは中継点になる", envelopes(["ぎ↓", "ー↓"]), [
		"0,5,35,0,100,50,0",
		"0,5,35,0,50,2,0",
	]);
	// ブレスを挟んだら別の息＝別のグループ。手前の音には掛からない。
	check("ブレスでグループが切れる", envelopes(["あ", "ー、", "ー↓"]), [
		"0,5,35,0,100,2,0",
	]);
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
