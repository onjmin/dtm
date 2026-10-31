/**
 * 外から来る文字列・数値で MML や外部エンジンへの入力が壊れないかを確かめる。
 *
 * - 音源の URL（`#audio=` `#audio2=` 〜）が、`;` `#` や見えない文字・向きを変える制御文字で
 *   MML の本文へ漏れて音符や別の宣言に読まれないこと（normalizeMediaUrl）。
 * - 2本目以降の音源の宣言の読み書きが往復すること。
 * - 数値に NaN・Infinity・極端な値が来ても、指数表記などで本文へ漏れないこと。
 * - 歌詞・語りの文字列から、制御文字・壊れたサロゲート・長すぎる部分が落ちること（sanitizeText）。
 */

import Module from "node:module";

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { parseMML, formatMmlMeta, normalizeMediaUrl } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");
const { sanitizeText, toWellFormed } =
	require("../../src/safe-text") as typeof import("../../src/safe-text");
const { scoreToNeutrinoMusicXml } =
	require("../../src/voice/neutrino-sing") as typeof import("../../src/voice/neutrino-sing");

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

/** MML の本文に音符が何個あるか（メタ宣言から音が生えていないかを見る）。 */
const noteCount = (mml: string): number =>
	parseMML(mml).placements?.length ?? -1;

console.log("■ 音源の URL をそろえる");
{
	const n = normalizeMediaUrl;
	check(
		"ふつうの https",
		n("https://a.example/x.wav"),
		"https://a.example/x.wav",
	);
	check("javascript: は受けない", n("javascript:alert(1)"), undefined);
	check("data: は受けない", n("data:audio/wav;base64,AAAA"), undefined);
	check(
		"全角の ｊａｖａｓｃｒｉｐｔ： は受けない",
		n("ｊａｖａｓｃｒｉｐｔ：alert(1)"),
		undefined,
	);
	check(
		"; を含むものは受けない",
		n("https://a.example/x.wav;@0 c d e"),
		undefined,
	);
	check(
		"フラグメント（#…）は外す",
		n("https://a.example/x.wav#audio3=https://evil"),
		"https://a.example/x.wav",
	);
	check(
		"ユーザー名入りは受けない",
		n("https://user:pw@a.example/x.wav"),
		undefined,
	);
	check(
		"向きを変える制御文字はパーセントエンコードされる",
		n("https://a.example/a‮wav.mp3"),
		"https://a.example/a%E2%80%AEwav.mp3",
	);
	check(
		"改行は URL から消えるが受ける（URL 標準どおり）",
		n("https://a.example/x\n.wav"),
		"https://a.example/x.wav",
	);
	check(
		"空白はパーセントエンコード",
		n("https://a.example/a b.wav"),
		"https://a.example/a%20b.wav",
	);
	check(
		"引用符はパーセントエンコード",
		n('https://a.example/"onload=x.wav'),
		"https://a.example/%22onload=x.wav",
	);
	check(
		"長すぎる URL は受けない",
		n(`https://a.example/${"a".repeat(3000)}`),
		undefined,
	);
	check(
		"ホストの全角は punycode に",
		n("https://ｅｘａｍｐｌｅ．com/x.wav"),
		"https://example.com/x.wav",
	);
	check(
		"壊れたサロゲート",
		n("https://a.example/\uD800.wav"),
		"https://a.example/%EF%BF%BD.wav",
	);
}

console.log("■ 2本目以降の音源の宣言");
{
	const mml =
		"#audio=https://a.example/x.mp3 #audio2=https://b.example/v.wav #audio2offset=-1.5 #audio3=https://c.example/i.wav #audio3vol=60 #audio4=javascript:alert(1)\n@0 t120 c4 d4;";
	const p = parseMML(mml);
	check("読める", p.meta.extraAudio, [
		{ url: "https://b.example/v.wav", offset: -1.5 },
		{ url: "https://c.example/i.wav", volume: 60 },
	]);
	check("宣言から音符が生えない", p.placements.length, 2);
	check(
		"書き出しは番号を振り直す",
		formatMmlMeta(p.meta, " "),
		"#audio=https://a.example/x.mp3 #audio2=https://b.example/v.wav #audio2offset=-1.5 #audio3=https://c.example/i.wav #audio3vol=60",
	);
}

console.log("■ 画面で打たれた値が MML に漏れない");
{
	const meta = {
		audio: "https://a.example/x.wav;@0 c d e f g",
		extraAudio: [
			{ url: "https://b.example/v.wav#volume=0" },
			{ url: "https://c.example/i.wav", offset: Number.POSITIVE_INFINITY },
			{ url: "https://d.example/j.wav", offset: Number.NaN },
			{ url: "https://e.example/k.wav", offset: 1e300 },
		],
	};
	const line = formatMmlMeta(meta, " ");
	check(
		"; 入りの URL は出さない・# 以降は落とす・NaN・Infinity のずれは出さない・極端なずれは丸める",
		line,
		"#audio2=https://b.example/v.wav #audio3=https://c.example/i.wav #audio4=https://d.example/j.wav #audio5=https://e.example/k.wav #audio5offset=86400",
	);
	check("読み戻して音符が生えない", noteCount(`${line}\n@0 c4;`), 1);
	check(
		"読み戻して音量が勝手に変わらない",
		parseMML(`${line}\n@0 c4;`).meta.volume,
		undefined,
	);
}

console.log("■ 文字列をそろえる（歌詞・語り・表示）");
{
	check(
		"制御文字を落とす",
		sanitizeText("か\u0000な\u001b[31m", 10),
		"かな[31m",
	);
	check(
		"向きを変える制御文字・幅ゼロを落とす",
		sanitizeText("abc‮txt.exe​", 20),
		"abctxt.exe",
	);
	check("壊れたサロゲートは U+FFFD", toWellFormed("a\uD800b"), "a�b");
	check("絵文字（正しいサロゲート対）は残す", sanitizeText("🎵", 5), "🎵");
	check("長さはコードポイントで切る", sanitizeText("🎵🎵🎵", 2), "🎵🎵");
	check("文字列以外は空", sanitizeText(undefined as unknown as string, 5), "");
}

console.log("■ NEUTRINO 用 MusicXML に壊れた値が入らない");
{
	const xml = scoreToNeutrinoMusicXml(
		{
			notes: [
				{ key: null, frame_length: 24, lyric: "" },
				{ key: Number.NaN, frame_length: 50, lyric: "あ" },
				{ key: 60, frame_length: Number.POSITIVE_INFINITY, lyric: "い" },
				{ key: 60, frame_length: -5, lyric: "う" },
				{ key: 999, frame_length: 50, lyric: "え\u0000</text><x>" },
			],
		},
		Number.NaN,
	);
	check("NaN・Infinity を書かない", /NaN|Infinity/.test(xml), false);
	check(
		"高さは 0〜127 に収める（G9）",
		/<step>G<\/step><octave>9<\/octave>/.test(xml),
		true,
	);
	check(
		"歌詞のタグは文字としてエスケープ・制御文字は落とす",
		xml.includes("<text>え&lt;/text&gt;</text>"),
		true,
	);
}

console.log("■ 外部エンジンの声の大きさをそろえる");
{
	const { externalVoiceGain, softLimit, EXTERNAL_VOICE_TARGET_DB } =
		require("../../src/voice/voice-level") as typeof import("../../src/voice/voice-level");
	// -30 dBFS の正弦波（声の出ている所）と無音
	const x = new Float32Array(48000 * 2);
	const amp = 10 ** (-30 / 20) * Math.SQRT2;
	for (let i = 0; i < 48000; i++) x[i] = amp * Math.sin((i / 48000) * 2 * Math.PI * 220);
	const g = externalVoiceGain([x]);
	check(
		"声の所の RMS を目標へ（無音は数えない）",
		Math.round(20 * Math.log10(g) - (EXTERNAL_VOICE_TARGET_DB + 30)),
		0,
	);
	check("無音なら倍率 1", externalVoiceGain([new Float32Array(1000)]), 1);
	check("小さい音は変えない", softLimit(0.3), 0.3);
	check("大きい音は上限（-1 dBFS）を超えない", softLimit(5) < 10 ** (-1 / 20), true);
	check("負の側も同じ", softLimit(-5) > -(10 ** (-1 / 20)), true);
	check("単調に増える", softLimit(0.6) < softLimit(0.8) && softLimit(0.8) < softLimit(1.5), true);
	check("NaN は倍率 1", externalVoiceGain([new Float32Array([Number.NaN, 0.5])]) > 0, true);
}

if (failed > 0) {
	console.log(`\n${failed} 件失敗`);
	process.exit(1);
}
console.log("\n外からの入力: すべて成功");
