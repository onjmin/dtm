/**
 * ノート＋歌詞 → VOICEVOX 楽譜（buildVoicevoxScore）の変換規則を確かめる。
 * エンジンには繋がない（楽譜の形だけを見る）。
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
const { buildVoicevoxScore, VOICEVOX_FRAME_RATE } =
	require("../../src/voice/voicevox-sing") as typeof import("../../src/voice/voicevox-sing");

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

/** 1拍=48ステップ。midi はそのまま units へ（1半音=31units）。 */
const note = (startBeat: number, beats: number, midi: number): Note =>
	({
		id: 0,
		startStep: startBeat * 48,
		durationSteps: beats * 48,
		pitchUnits: midi * 31,
		velocity: 100,
	}) as Note;

const score = (notes: Note[], lyrics: string, bpm = 120) =>
	buildVoicevoxScore({ notes, syllables: normalizeLyrics(lyrics), bpm }).notes;
const sung = (s: ReturnType<typeof score>) =>
	s.filter((n) => n.key !== null).map((n) => `${n.lyric}${n.key}`);

console.log("■ VOICEVOX 楽譜");

{
	const s = score([note(0, 1, 60), note(1, 1, 62)], "かな");
	check("先頭と末尾は休符", [s[0].key, s[s.length - 1].key], [null, null]);
	check("音と歌詞が1:1", sung(s), ["か60", "な62"]);
	// 120BPM の1拍 = 0.5秒
	check(
		"1拍のフレーム長",
		s[1].frame_length,
		Math.round(0.5 * VOICEVOX_FRAME_RATE),
	);
}

check(
	"同じ高さの継続は1音へ伸ばす",
	sung(score([note(0, 1, 60), note(1, 1, 60)], "かー")),
	["か60"],
);
check(
	"高さが変わる継続は母音で歌い直す",
	sung(score([note(0, 1, 60), note(1, 1, 62)], "かー")),
	["か60", "あ62"],
);
check(
	"休符記号は歌わない",
	sung(score([note(0, 1, 60), note(1, 1, 62), note(2, 1, 64)], "か_な")),
	["か60", "な64"],
);
check(
	"和音の下側は捨てる（音節も一緒に）",
	sung(score([note(0, 1, 64), note(0, 1, 60), note(1, 1, 62)], "かきく")),
	["か64", "く62"],
);
{
	const s = score([note(0, 1, 60), note(1, 1, 62)], "か、な");
	const rest = s.find((n, i) => i > 0 && n.key === null && i < s.length - 1);
	check("ブレスは間に休符を差し込む", rest !== undefined, true);
}
{
	const s = score([note(0, 1, 60), note(1, 1, 62), note(2, 1, 64)], "かなら");
	const total = s.slice(1, -1).reduce((sum, n) => sum + n.frame_length, 0);
	check(
		"合計フレームが曲の長さと一致",
		total,
		Math.round(1.5 * VOICEVOX_FRAME_RATE),
	);
}

if (failed > 0) {
	console.log(`\n${failed} 件 NG`);
	process.exit(1);
}
console.log("\nすべて OK");
