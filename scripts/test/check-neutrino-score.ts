/**
 * NEUTRINO の楽譜まわり（scoreToNeutrinoMusicXml・buildNeutrinoTrack）と、
 * 手元のエンジンの声を選択肢に出すかの判定（isLocalPage）を確かめる。
 * NEUTRINO には繋がない（楽譜の形だけを見る）。
 */

import Module from "node:module";

// 歌詞解析（lyrics.ts）の先で @onjmin/koe（ブラウザ専用）を読むので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { normalizeLyrics } =
	require("../../src/voice/lyrics") as typeof import("../../src/voice/lyrics");
const { buildNeutrinoTrack, isNeutrinoModel, scoreToNeutrinoMusicXml } =
	require("../../src/voice/neutrino-sing") as typeof import("../../src/voice/neutrino-sing");
const { isLocalEngineModel, isLocalPage } =
	require("../../src/voice/local-engines") as typeof import("../../src/voice/local-engines");
const { VOICEVOX_FRAME_RATE } =
	require("../../src/voice/voicevox-sing") as typeof import("../../src/voice/voicevox-sing");

import type { Units } from "../../src/audio/tuning";
import type { VoicevoxSourceNote } from "../../src/voice/voicevox-sing";

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

const frames = (sec: number): number => Math.round(sec * VOICEVOX_FRAME_RATE);

console.log("■ NEUTRINO 用 MusicXML");
{
	const xml = scoreToNeutrinoMusicXml({
		notes: [
			{ key: null, frame_length: frames(0.5), lyric: "" },
			{ key: 61, frame_length: frames(1), lyric: "か" },
			{ key: 60, frame_length: frames(4), lyric: "な" }, // 小節（4秒）をまたぐ
			{ key: null, frame_length: frames(0.5), lyric: "" },
		],
	});
	const notes = [...xml.matchAll(/<note>(.*?)<\/note>/g)].map((m) => m[1]);
	const pitched = notes.filter((n) => n.includes("<pitch>"));
	check(
		"歌詞はタイの頭だけ",
		[...xml.matchAll(/<text>(.*?)<\/text>/g)].map((m) => m[1]),
		["か", "な"],
	);
	check(
		"C#4 は C に #",
		/<step>C<\/step><alter>1<\/alter><octave>4<\/octave>/.test(pitched[0]),
		true,
	);
	check(
		"小節をまたぐ音はタイで2つに分ける",
		pitched
			.slice(1)
			.map((n) => (n.match(/<tie type="(\w+)"\/>/g) ?? []).join("")),
		['<tie type="start"/>', '<tie type="stop"/>'],
	);
	// テンポ 60・divisions 960 なので、1小節＝3840。各小節の長さの合計が揃う。
	const measures = [
		...xml.matchAll(/<measure number="\d+">(.*?)<\/measure>/g),
	].map((m) =>
		[...m[1].matchAll(/<duration>(\d+)<\/duration>/g)].reduce(
			(s, d) => s + Number(d[1]),
			0,
		),
	);
	check("小節の長さはどれも 4/4 ぶん", measures, [3840, 3840]);
	check("テンポ 60", xml.includes('<sound tempo="60"/>'), true);
	check(
		"歌詞の & < はエスケープ",
		scoreToNeutrinoMusicXml({
			notes: [{ key: 60, frame_length: 10, lyric: "<&" }],
		}).includes("<text>&lt;&amp;</text>"),
		true,
	);
}

console.log("■ トラック全体の楽譜とフレーズの切り出し");
{
	const syl = normalizeLyrics("かきくけこ");
	/** 秒で置く。pitch は units（1半音＝31）。 */
	const n = (
		i: number,
		start: number,
		dur: number,
		midi: number,
	): VoicevoxSourceNote => ({
		syllable: syl[i],
		pitch: (midi * 31) as Units,
		startSec: start,
		durationSec: dur,
	});
	// 「かき」と「くけこ」の間を 1 秒あけて、2フレーズにする。
	const track = buildNeutrinoTrack([
		n(0, 1, 0.5, 60),
		n(1, 1.5, 0.5, 62),
		n(2, 3, 0.5, 64),
		n(3, 3.5, 0.5, 65),
		n(4, 4, 0.5, 67),
	]);
	const sung = (track.score?.notes ?? [])
		.filter((x) => x.key !== null)
		.map((x) => `${x.lyric}${x.key}`);
	check("1回で合成する楽譜に全部の音", sung, [
		"か60",
		"き62",
		"く64",
		"け65",
		"こ67",
	]);
	check("フレーズは2つ", track.phrases.length, 2);
	const round = (x: number) => Math.round(x * 100) / 100;
	check(
		"フレーズの頭は最初の音",
		track.phrases.map((p) => round(p.startSec)),
		[1, 3],
	);
	check("音声の頭は最初の音の 0.5 秒前", round(track.originSec), 0.5);
	const [a, b] = track.phrases;
	check(
		"切り出しは重ならず、すき間も無い",
		round(a.sliceEndSec),
		round(b.sliceStartSec),
	);
	check(
		"2つ目の切り出しは最初の音の 0.3 秒前から",
		round(b.sliceStartSec),
		2.7,
	);
	check("leadSec は切り出しの頭から最初の音まで", round(b.leadSec), 0.3);
	check("音の無いトラックは楽譜なし", buildNeutrinoTrack([]).score, null);
}

console.log("■ 手元のエンジンの声を選択肢に出すか");
{
	const page = (protocol: string, hostname: string) =>
		isLocalPage({ protocol, hostname });
	check("localhost", page("http:", "localhost"), true);
	check("127.0.0.1", page("http:", "127.0.0.1"), true);
	check("::1", page("http:", "[::1]"), true);
	check("file:", page("file:", ""), true);
	check("公開サイト", page("https:", "onjmin.github.io"), false);
	check("LAN の IP は手元扱いしない", page("http:", "192.168.1.10"), false);
	check("Node（location なし）", isLocalPage(undefined), false);
	check(
		"vv_・nt_ は手元のエンジン",
		["vv_zundamon", "nt_reina", "NT_AKANE", "tsukuyomi"].map(
			isLocalEngineModel,
		),
		[true, true, true, false],
	);
	check("nt_ でも表に無い名前は違う", isNeutrinoModel("nt_unknown"), false);
}

if (failed > 0) {
	console.log(`\n${failed} 件失敗`);
	process.exit(1);
}
console.log("\nNEUTRINO の楽譜: すべて成功");
