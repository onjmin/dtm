/**
 * 歌詞付き MML を VOICEVOX の歌唱 API で歌わせて WAV に書き出す（試作）。
 *
 *   tsx scripts/misc/voicevox-sing.ts <MMLファイル or MML文字列> [--track 0] [--singer ずんだもん]
 *     [--key 0] [--out scratch/voicevox/sing.wav] [--url http://127.0.0.1:50021]
 *
 * VOICEVOX エンジンを先に起動しておくこと。歌うのは `@@<track>` の歌詞が付いた
 * `@<track>` の旋律だけ（伴奏は入らない）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { dirname } from "node:path";
import { DEFAULT_BPM, type Note } from "../../src/types";
import {
	buildVoicevoxScore,
	findVoicevoxSinger,
	synthesizeVoicevoxSong,
	VOICEVOX_DEFAULT_URL,
} from "../../src/voice/voicevox-sing";

// `src/mml/mml-parser.ts` は歌詞解析の先で @onjmin/koe（ブラウザ専用）を読む。
// ここでは koe で鳴らさないので空のスタブへ（scripts/test/check-mml-meta.ts と同じ）。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { parseMML } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const input = args.find(
	(a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
if (!input) {
	console.error(
		"usage: tsx scripts/misc/voicevox-sing.ts <mml file | mml> [--track 0] [--singer ずんだもん]",
	);
	process.exit(1);
}
const mml = existsSync(input) ? readFileSync(input, "utf8") : input;
const track = Number(flag("track", "0"));
const singerName = flag("singer", "ずんだもん");
const keyShift = Number(flag("key", "0"));
const out = flag("out", "scratch/voicevox/sing.wav");
const baseUrl = flag("url", VOICEVOX_DEFAULT_URL);

const { placements, bpm, lyrics } = parseMML(mml, { collectLyrics: true });
const lyricTrack = lyrics?.get(track);
if (!lyricTrack) {
	console.error(`@@${track} の歌詞が見つからない`);
	process.exit(1);
}
const notes: Note[] = placements
	.filter((p) => p.trackIndex === track)
	.map((p, id) => ({
		id,
		startStep: p.startStep,
		durationSteps: p.durationSteps,
		pitchUnits: p.pitchUnits,
		velocity: p.velocity,
	}));
const score = buildVoicevoxScore({
	notes,
	syllables: lyricTrack.syllables,
	bpm: bpm ?? DEFAULT_BPM,
});

const main = async (): Promise<void> => {
	const singer = await findVoicevoxSinger(singerName, baseUrl);
	if (!singer) {
		console.error(`歌唱スタイルが見つからない: ${singerName}`);
		process.exit(1);
	}
	console.log(
		`${singer.label} id=${singer.id} / ${notes.length}音 → 楽譜${score.notes.length}音`,
	);
	const wav = await synthesizeVoicevoxSong(score, {
		singer: singer.id,
		baseUrl,
		keyShift,
	});
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, Buffer.from(wav));
	console.log(`書き出し: ${out}（${(wav.byteLength / 1024).toFixed(0)}KB）`);
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
