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
const {
	absorbTinyFragments,
	buildNeutrinoTrack,
	isNeutrinoModel,
	OPENUTAU_XML_TIMING,
	scoreToNeutrinoMusicXml,
	splitNeutrinoTrack,
} =
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

	// OpenUtau 向けの区切り: 2秒のフレーズを、間を 0.5 秒・1.5 秒と交互にあけて10個並べる
	const many: VoicevoxSourceNote[] = [];
	let t = 1;
	for (let k = 0; k < 10; k++) {
		many.push(n(k % 5, t, 1, 60), n((k + 1) % 5, t + 1, 1, 62));
		t += 2 + (k % 2 === 0 ? 0.5 : 1.5);
	}
	const chunks = splitNeutrinoTrack(many, {
		firstSec: 3,
		chunkSec: 6,
		minGapSec: 1,
	});
	check(
		"区切りごとの音の数（最初は短め、1 秒以上の休符でだけ区切る）",
		chunks.map(
			(c) => (c.score?.notes ?? []).filter((x) => x.key !== null).length,
		),
		[4, 8, 8],
	);
	check(
		"フレーズは割らずに全部どこかの区切りに入る",
		chunks.reduce((a, c) => a + c.phrases.length, 0),
		buildNeutrinoTrack(many).phrases.length,
	);
	const bounds = chunks.flatMap((c) =>
		c.phrases.map((p) => [round(p.sliceStartSec), round(p.sliceEndSec)]),
	);
	check(
		"区切りをまたいでも切り出しは重ならない",
		bounds.every((b, k) => k === 0 || bounds[k - 1][1] <= b[0]),
		true,
	);
	// 0.5 秒の休符でも区切ると、前後の余白（各 0.5 秒）が重なりうる。受け渡しで重ならないこと
	const fine = splitNeutrinoTrack(many, {
		firstSec: 1,
		chunkSec: 1,
		minGapSec: 0.5,
	});
	const fineBounds = fine.flatMap((c) =>
		c.phrases.map((p) => [
			p.sliceStartSec,
			p.sliceEndSec,
			p.startSec - p.leadSec,
		]),
	);
	check("0.5 秒の休符でも区切る", fine.length, 10);
	check(
		"短い休符で区切っても、切り出しは重ならず、鳴らし始めは切り出しの頭",
		fineBounds.every(
			(b, k) =>
				(k === 0 || fineBounds[k - 1][1] <= b[0] + 1e-9) &&
				Math.abs(b[2] - b[0]) < 1e-9,
		),
		true,
	);
	check(
		"区切れる所が無ければ1つ",
		splitNeutrinoTrack(many.slice(0, 4), {
			firstSec: 100,
			chunkSec: 100,
			minGapSec: 1,
		}).length,
		1,
	);
}

console.log(
	"■ ごく短い休符・音のかけらを隣へまとめる（ENUNU が 0 で割って落ちるため）",
);
{
	const r = (f: number) => ({ key: null, frame_length: f, lyric: "" });
	const n = (k: number, f: number, l: string) => ({
		key: k,
		frame_length: f,
		lyric: l,
	});
	const out = absorbTinyFragments([
		r(24),
		n(60, 20, "か"),
		r(2), // 音の間の短い休符 → 直前の音へ
		n(62, 3, "き"), // 短い音 → 直前の音へ
		n(64, 20, "く"),
		r(30),
		n(65, 2, "け"), // 休符の直後の短い音 → 直後の音へ
		n(67, 20, "こ"),
		r(16),
	]);
	check(
		"並び",
		out.map((x) => `${x.lyric || "_"}${x.frame_length}`),
		["_24", "か25", "く20", "_30", "こ22", "_16"],
	);
	check(
		"合計の長さは変わらない",
		out.reduce((s, x) => s + x.frame_length, 0),
		24 + 20 + 2 + 3 + 20 + 30 + 2 + 20 + 16,
	);
	check(
		"NaN・0 の長さは捨てる",
		absorbTinyFragments([
			r(10),
			n(60, Number.NaN, "あ"),
			n(60, 0, "い"),
			n(60, 10, "う"),
			r(10),
		]).map((x) => x.lyric),
		["", "う", ""],
	);
}

console.log("■ OpenUtau 用 MusicXML（ENUNU の丸めで遅れが溜まらない）");
{
	// 75ms 前後の速い音を 200 個（テンポ 60・960 分割の書き方だと ENUNU で約 1 秒遅れた並び）
	const notes = [{ key: null, frame_length: frames(0.5), lyric: "" }];
	for (let i = 0; i < 200; i++)
		notes.push({ key: 60 + (i % 5), frame_length: 7 + (i % 3), lyric: "な" });
	const xml = scoreToNeutrinoMusicXml({ notes }, 0, OPENUTAU_XML_TIMING);
	check(
		"テンポ 150・480 分割",
		[
			xml.match(/<divisions>(\d+)/)?.[1],
			xml.match(/<sound tempo="(\d+)"/)?.[1],
		],
		["480", "150"],
	);
	const durs = [...xml.matchAll(/<duration>(\d+)/g)].map((m) => Number(m[1]));
	check(
		"長さはすべて 20 分割（96分音符）の倍数",
		durs.every((d) => d > 0 && d % 20 === 0),
		true,
	);
	// 音の頭の時刻（秒）を楽譜から戻し、元の時刻とのずれを見る
	const sec = (div: number): number => (div / 480) * (60 / 150);
	let pos = 0;
	let frame = 0;
	let worst = 0;
	const parts = [...xml.matchAll(/<note>(.*?)<\/note>/g)].map((m) => m[1]);
	let k = 0;
	for (const p of parts) {
		const d = Number(p.match(/<duration>(\d+)/)?.[1]);
		if (!p.includes("<rest/>") && !p.includes('tie type="stop"')) {
			k++;
			const want = (frame + frames(0.5)) / VOICEVOX_FRAME_RATE;
			worst = Math.max(worst, Math.abs(sec(pos) - want));
			frame += notes[k].frame_length;
		}
		pos += d;
	}
	check("音の数", k, 200);
	check("音の頭のずれは 1 格子の半分（8.4ms）以内", worst <= 0.0084, true);
	check(
		"NEUTRINO 用は今までどおり（テンポ 60・960 分割）",
		[
			scoreToNeutrinoMusicXml({ notes }).match(/<divisions>(\d+)/)?.[1],
			scoreToNeutrinoMusicXml({ notes }).match(/<sound tempo="(\d+)"/)?.[1],
		],
		["960", "60"],
	);
}

console.log("■ 手元のエンジンの声を選択肢に出すか");
{
	const page = (protocol: string, hostname: string) =>
		isLocalPage({ protocol, hostname });
	check("localhost", page("http:", "localhost"), true);
	check("127.0.0.1", page("http:", "127.0.0.1"), true);
	check("127.0.0.2", page("http:", "127.0.0.2"), true);
	check(
		"127. で始まる公開ドメインは手元ではない",
		page("https:", "127.attacker.example"),
		false,
	);
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
