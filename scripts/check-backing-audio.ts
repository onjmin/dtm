/**
 * 伴奏音源（mp3 / wav / YouTube）の同時再生まわりのチェック。
 *
 * 音は鳴らせないので、**鳴らす前に決まる値**だけを突き合わせる:
 *
 * - 開始位置の指定（`音源のどこから` × `曲のどこで`）が、再生開始時点の
 *   「音源内の位置」1つへ正しく畳まれるか。ここを間違えると、曲の途中から
 *   再生したときだけ頭がズレる、という気付きにくい壊れ方をする。
 * - 時間表記（`1:23.456`）の読み書きが往復するか。
 * - YouTubeのURLから動画IDを取れるか（短縮・埋め込み・Shorts）。
 * - MMLへの往復。**アップロードしたファイルは出力されない**という約束が、
 *   宣言まるごと（開始位置・音量も）落ちる形で守られているか。
 */

import Module from "node:module";

import {
	backingMediaSec,
	formatTimeSec,
	parseTimeSec,
	parseYoutubeId,
} from "../src/backing-audio";

// `src/mml-parser.ts` は歌詞解析のために `src/lyrics.ts` を、その先で歌唱合成エンジン
// @onjmin/koe（WebAssembly + AudioWorklet 前提のブラウザ専用パッケージ）を読む。
// ここで触るのは宣言文字列の読み書きだけなので、名前解決だけ空のスタブへ差し替える。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { formatMmlMeta, parseMML, parseMmlMeta, stripMmlMeta } =
	require("../src/mml-parser") as typeof import("../src/mml-parser");
const { shiftNotes } =
	require("../src/macros") as typeof import("../src/macros");
const { pitchV1ToUnits } =
	require("../src/tuning") as typeof import("../src/tuning");

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

/** BPM120・1拍=48ステップなので 1ステップ = 0.0104166…秒、1小節(192)=2秒。 */
const SPS = 60 / 120 / 48;

console.log("■ 開始位置（音源のどこから × 曲のどこで）");
{
	// 頭から重ねる素直な例。
	check(
		"曲頭から再生＝音源の開始位置そのもの",
		backingMediaSec({
			fromStep: 0,
			atStep: 0,
			startSec: 12.5,
			secondsPerStep: SPS,
		}),
		12.5,
	);
	// 曲の途中（3小節目 = 384step = 4秒）から再生したら、音源も4秒ぶん進んだ位置。
	check(
		"途中から再生すると音源も同じだけ進む",
		backingMediaSec({
			fromStep: 384,
			atStep: 0,
			startSec: 12.5,
			secondsPerStep: SPS,
		}),
		16.5,
	);
	// 音源を5小節目(768step=8秒)に貼った場合、曲頭から再生すると8秒待ってから鳴る。
	check(
		"曲の途中へ貼ると、その手前は負（＝待ち時間）になる",
		backingMediaSec({
			fromStep: 0,
			atStep: 768,
			startSec: 0,
			secondsPerStep: SPS,
		}),
		-8,
	);
	check(
		"貼った位置ちょうどから再生すれば、音源の開始位置に戻る",
		backingMediaSec({
			fromStep: 768,
			atStep: 768,
			startSec: 3,
			secondsPerStep: SPS,
		}),
		3,
	);
}

console.log("■ 時間表記");
{
	check("分:秒.ミリ秒を読む", parseTimeSec("1:23.456"), 83.456);
	check("秒だけでも読む", parseTimeSec("12.5"), 12.5);
	check("時:分:秒も読む", parseTimeSec("1:02:03"), 3723);
	check("空欄は0", parseTimeSec(""), 0);
	check("読めない書き方はnull", parseTimeSec("1分23秒"), null);
	check("秒→表記", formatTimeSec(83.456), "1:23.456");
	check("1分未満も0詰め", formatTimeSec(3.5), "0:03.500");
	check("1時間以上", formatTimeSec(3723), "1:02:03.000");
	for (const text of ["0:00.000", "1:23.456", "12:34.001"]) {
		check(`往復する: ${text}`, formatTimeSec(parseTimeSec(text) ?? -1), text);
	}
}

console.log("■ YouTubeのURL");
{
	check(
		"通常のURL",
		parseYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),
		"dQw4w9WgXcQ",
	);
	check(
		"短縮URL",
		parseYoutubeId("https://youtu.be/dQw4w9WgXcQ"),
		"dQw4w9WgXcQ",
	);
	check(
		"埋め込みURL",
		parseYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
		"dQw4w9WgXcQ",
	);
	check(
		"Shorts",
		parseYoutubeId("https://youtube.com/shorts/dQw4w9WgXcQ"),
		"dQw4w9WgXcQ",
	);
	check(
		"音声ファイルのURLはYouTubeではない",
		parseYoutubeId("https://example.com/a.mp3"),
		null,
	);
	check(
		"YouTubeでも動画IDが無ければnull",
		parseYoutubeId("https://www.youtube.com/"),
		null,
	);
}

console.log("■ MMLへの往復");
{
	const meta = {
		audio: "https://example.com/karaoke.mp3",
		audioStart: 12.5,
		audioEnd: 200.25,
		audioAt: 768,
		audioVolume: 60,
	};
	const line = formatMmlMeta(meta, " ");
	check(
		"URL・開始・終了・貼り付け位置・音量が出力される",
		line,
		"#audio=https://example.com/karaoke.mp3 #audiostart=12.5 #audioend=200.25 #audioat=768 #audiovol=60",
	);
	const back = parseMmlMeta(`${line} @0 t120 o4 c;`);
	check(
		"読み戻せる",
		[
			back.audio,
			back.audioStart,
			back.audioEnd,
			back.audioAt,
			back.audioVolume,
		],
		[
			meta.audio,
			meta.audioStart,
			meta.audioEnd,
			meta.audioAt,
			meta.audioVolume,
		],
	);

	// アップロードされたファイルは url が無い＝関連する宣言ごと出さない、が約束。
	check(
		"ファイル読み込み（URL無し）は開始位置ごと出力されない",
		formatMmlMeta({
			audioStart: 12.5,
			audioEnd: 200.25,
			audioAt: 768,
			audioVolume: 60,
			volume: 100,
		}),
		"#volume=100",
	);
	check(
		"既定値（音量80・開始0）は書かない",
		formatMmlMeta({
			audio: "https://example.com/a.wav",
			audioStart: 0,
			audioVolume: 80,
		}),
		"#audio=https://example.com/a.wav",
	);
	check(
		"http/https以外のURLは読み込まない",
		parseMmlMeta("#audio=javascript:alert(1) @0 c;").audio,
		undefined,
	);
	// 宣言が本文へ混ざるとノート解析が壊れるので、確実に取り除けること。
	check(
		"宣言は本文から取り除かれる",
		stripMmlMeta(
			"#audio=https://example.com/a.mp3 #audiostart=1.5 @0 c;",
		).trim(),
		"@0 c;",
	);
}

console.log("■ URLの // を行コメントと誤認しない");
{
	// 1行MMLでは、URLの "//" から後ろが行コメントとして丸ごと消えてしまう。
	// 宣言も音符も落ちるのに読み込み自体は成功するので、気付きにくい壊れ方をする。
	const mml = [
		"#volume=50 #audio=https://example.com/a.mp3 #audiostart=1.25 #audioat=192;",
		"@0 t120 o4 c d e;",
		"#end;",
	].join("\n");
	const parsed = parseMML(mml, {});
	check(
		"URLの後ろの宣言が生き残る",
		[parsed.meta.audio, parsed.meta.audioStart, parsed.meta.audioAt],
		["https://example.com/a.mp3", 1.25, 192],
	);
	check("URLの後ろの音符が生き残る", parsed.placements.length, 3);
}

console.log("■ 「イントロも鳴らす」のシフト");
{
	// イントロぶん（＝何十秒＝数千ステップ）まとめて後ろへずらす操作。
	// 1ノートずつ moveNote で動かしていた頃は「いまの曲の長さ＋1小節」で
	// クランプされ、大きくずらすと末尾へ団子になっていた。
	const { MMLCore } =
		require("../src/mml-core") as typeof import("../src/mml-core");
	const core = new MMLCore(
		{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
		100,
		() => ({
			stepsPerBar: 192,
			keyCount: 128,
			pitchRangeStart: 0,
			keyHeight: 12,
			stepWidth: 8,
		}),
	);
	core.addNote(0, pitchV1ToUnits(60), { noteLengthSteps: 48 });
	core.addNote(96, pitchV1ToUnits(62), { noteLengthSteps: 48 });
	// 34.2秒 ≒ 3283ステップ（BPM120）。元の曲の長さ（144ステップ）よりずっと遠い。
	const steps = Math.round(34.2 / SPS);
	shiftNotes([core], steps);
	check(
		"曲の長さを超えるシフトでも、間隔を保ったまま後ろへ動く",
		core.getNotes().map((n) => n.startStep),
		[steps, steps + 96],
	);
	check(
		"音価は変わらない",
		core.getNotes().map((n) => n.durationSteps),
		[48, 48],
	);
	// 前へずらすと、0より前へ出たものは捨てる（従来のシフトと同じ約束）。
	shiftNotes([core], -steps - 48);
	check(
		"0より前へ出たノートは捨てる",
		core.getNotes().map((n) => n.startStep),
		[48],
	);
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
