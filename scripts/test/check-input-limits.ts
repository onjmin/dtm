/**
 * 共有リンク・取り込みファイル・localStorage など外から来る値で、タブが固まったり
 * HTML が差し込まれたりしないか。2026-10 の脆弱性洗い出しで直した箇所の回帰検査。
 *
 * 固まる系の検査は「時間内に終わる」ことも見る。上限が外れると、この検査自体が
 * 終わらなくなるか、時間の検査で落ちる。
 */

import Module from "node:module";
import { gzipSync } from "node:zlib";

// mml-parser → lyrics → @onjmin/koe（ブラウザ専用）と、mml-player が読む歌声の画像（.png）。
// 入力の上限しか見ないので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) => {
	if (request === "@onjmin/koe")
		return {
			VoiceBank: class {},
			Worldline: class {},
			leadInFromEntry: () => 0,
		};
	if (request.endsWith(".png")) return "";
	return load(request, ...rest);
};

const { parseMML } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");
const { MMLCore } =
	require("../../src/mml/mml-core") as typeof import("../../src/mml/mml-core");
const { parseUst } =
	require("../../src/io/ust-io") as typeof import("../../src/io/ust-io");
const { getMidiBPM, extractMidiPlacementsByTrack } =
	require("../../src/io/midi-io") as typeof import("../../src/io/midi-io");
const { INSTRUMENT_PRESETS } =
	require("../../src/instruments/instrument-presets") as typeof import("../../src/instruments/instrument-presets");
const { KOE_VOICEBANK_TERMS, VOICE_IMAGE_KEY } =
	require("../../src/voice/lyrics") as typeof import("../../src/voice/lyrics");
const { readTrack1Settings, TRACK1_STORAGE_KEY } =
	require("../../src/ui/state/track1-state") as typeof import("../../src/ui/state/track1-state");
const { escapeHtml } =
	require("../../src/ui/html") as typeof import("../../src/ui/html");
const { decodeMml } =
	require("../../src/mml/mml-player") as typeof import("../../src/mml/mml-player");
const { MAX_SONG_BARS, DEFAULT_STEPS_PER_BAR } =
	require("../../src/types") as typeof import("../../src/types");

let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown): void => {
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok && detail !== undefined)
		console.log(`        実際: ${JSON.stringify(detail)}`);
};
const timed = <T>(fn: () => T): { value: T; ms: number } => {
	const t0 = performance.now();
	const value = fn();
	return { value, ms: performance.now() - t0 };
};

const maxSteps = MAX_SONG_BARS * DEFAULT_STEPS_PER_BAR;

console.log("■ MML パーサ");
{
	const { value, ms } = timed(() => parseMML(`c1${".".repeat(60)}d4`));
	const [c, d] = value.placements;
	check(
		"付点は3つまで効く（c1... = 648 ステップ）",
		c?.durationSteps === 648,
		c,
	);
	check("付点の後ろの音は続けて読む", d?.startStep === 648, d);
	check("付点60個でもすぐ終わる", ms < 200, ms);
}
{
	const { value } = timed(() => parseMML("c1".repeat(MAX_SONG_BARS + 50)));
	const last = value.placements.at(-1);
	check(
		"曲の長さの上限より後ろの音は読まない",
		value.placements.length === MAX_SONG_BARS &&
			!!last &&
			last.startStep + last.durationSteps <= maxSteps,
		value.placements.length,
	);
}
{
	const { ms } = timed(() => parseMML(`c${"{".repeat(200000)}`));
	check("閉じの無い { の連続が二乗時間にならない", ms < 1000, ms);
	const { value } = timed(() => parseMML("{ceg}4"));
	check("閉じのある連符は従来どおり", value.placements.length === 3);
}
{
	let threw: unknown = null;
	try {
		parseMML(`@@0 klatt ${"あ".repeat(150000)}\nc4`, { collectLyrics: true });
	} catch (e) {
		threw = String(e);
	}
	check("15万音節の歌詞1行でスタックが溢れない", threw === null, threw);
}

console.log("■ MMLCore");
{
	let generated = 0;
	const core = new MMLCore(
		{ onMMLGenerated: () => generated++, onNotesChanged: () => {} },
		80,
		() => ({
			stepsPerBar: DEFAULT_STEPS_PER_BAR,
			keyCount: 88,
			pitchRangeStart: 0,
			keyHeight: 10,
			stepWidth: 2,
		}),
	);
	core.addNote(Number.POSITIVE_INFINITY, 60 as never, { noteLengthSteps: 12 });
	core.addNote(maxSteps, 60 as never, { noteLengthSteps: 12 });
	check("Infinity・上限外の位置は置かない", core.getNotes().length === 0);

	const before = generated;
	const { ms } = timed(() => {
		core.setLoadMode(true);
		for (let i = 0; i < 20000; i++) {
			core.addNote(((i * 7919) % 20000) * 12, 60 as never, {
				noteLengthSteps: 12,
			});
		}
		core.addNote(0, 60 as never, { noteLengthSteps: 12 }); // 重複
		core.setLoadMode(false);
	});
	const notes = core.getNotes();
	check(
		"読み込み中の MML 生成は最後の1回だけ",
		generated - before === 1,
		generated - before,
	);
	check("2万音の読み込みが二乗時間にならない", ms < 3000, ms);
	check("読み込み中も重複は足さない", notes.length === 20000, notes.length);
	check(
		"読み込み後は開始順に並ぶ",
		notes.every((n, i) => i === 0 || notes[i - 1].startStep <= n.startStep),
	);
}

console.log("■ 取り込みファイル");
{
	const ust = [
		"[#SETTING]",
		"Tempo=120",
		"[#0000]",
		"Length=1e308",
		"Lyric=あ",
		"NoteNum=60",
		"[#0001]",
		"Length=1e308",
		"Lyric=あ",
		"NoteNum=60",
		"PBS=0;0",
		"PBW=100",
		"PBY=50",
		"[#TRACKEND]",
	].join("\n");
	const { value, ms } = timed(() => parseUst(ust));
	check("UST の Length=1e308 で止まらなくならない", ms < 1000, ms);
	check(
		"UST の桁外れの位置は読まない",
		value.notes.every((n) => Number.isFinite(n.startStep)),
		value.notes,
	);
}
{
	const tempo = (us: number) => ({
		division: 480,
		format: 1,
		tracks: [[{ delta: 0, setTempo: { microsecondsPerQuarter: us } }]],
	});
	check("MIDI のテンポ 0 は捨てて既定 120", getMidiBPM(tempo(0)) === 120);
	check("MIDI の桁外れのテンポは 300 で止める", getMidiBPM(tempo(1)) === 300);
	const midi = {
		division: 0,
		format: 1,
		tracks: [
			[
				{ delta: 0, channel: 0, noteOn: { noteNumber: 60, velocity: 100 } },
				{ delta: 1, channel: 0, noteOff: { noteNumber: 60, velocity: 0 } },
			],
		],
	};
	const { placements } = extractMidiPlacementsByTrack(midi, [0], ["melody"]);
	check(
		"MIDI の division 0 でも位置が有限",
		placements.length === 1 &&
			Number.isFinite(placements[0].startStep) &&
			Number.isFinite(placements[0].durationSteps),
		placements,
	);
}

console.log("■ プロトタイプ名");
for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
	check(
		`${key} は辞書に当たらない`,
		INSTRUMENT_PRESETS[key] === undefined &&
			KOE_VOICEBANK_TERMS[key] === undefined &&
			VOICE_IMAGE_KEY[key] === undefined,
	);
}
check("既存のプリセットは引ける", !!INSTRUMENT_PRESETS.piano);
check("Object.keys で列挙できる", Object.keys(INSTRUMENT_PRESETS).length > 0);

console.log("■ localStorage・HTML");
{
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
		removeItem: (k: string) => store.delete(k),
	};
	store.set(
		TRACK1_STORAGE_KEY,
		JSON.stringify({
			volume: '"><img src=x onerror=alert(1)>',
			trackOctave: 1,
			vocalVibrato: true,
			trackPan: Number.NaN,
			lyricModel: "tsukuyomi",
		}),
	);
	const got = readTrack1Settings();
	check(
		"型の違う値は落とし、正しい値だけ残す",
		JSON.stringify(got) ===
			JSON.stringify({
				trackOctave: 1,
				lyricModel: "tsukuyomi",
				vocalVibrato: true,
			}),
		got,
	);
	delete (globalThis as { localStorage?: unknown }).localStorage;
}
check(
	"escapeHtml は本文・属性どちらにも安全",
	escapeHtml(`<a href="x" title='y'>&</a>`) ===
		"&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
);

console.log("■ 共有リンクの展開");
const toBase64Url = (buf: Buffer): string =>
	buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const run = async (): Promise<void> => {
	const small = await decodeMml(`g.${toBase64Url(gzipSync("c4d4e4"))}`);
	check("普通の共有リンクは展開できる", small === "c4d4e4", small);
	const bomb = await decodeMml(
		`g.${toBase64Url(gzipSync("c".repeat(6 * 1024 * 1024)))}`,
	);
	check("展開後 4MB を超える共有リンクは読まない", bomb === "", bomb.length);

	if (failed > 0) {
		console.error(`✗ 入力の上限: ${failed} 件が不一致`);
		process.exit(1);
	}
	console.log("✓ 入力の上限: すべて一致");
};
void run();
