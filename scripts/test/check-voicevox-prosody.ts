/**
 * 語りの抑揚を VOICEVOX から借りる変換と問い合わせのチェック。
 *
 *   npx tsx scripts/test/check-voicevox-prosody.ts
 *
 * エンジンには繋がない（`/audio_query` の形を手で作り、fetch は差し替える）。守りたいのは次の 3 点。
 *
 * 1. 音素の時刻表が query の長さどおりに並び、間は `pau`、前後は `sil` になること。
 * 2. 高さが母音の中心で query の値になり、無声のモーラと間は 0、息継ぎをまたいでつながないこと。
 * 3. エンジンに届かないときは問い合わせずに null を返し（HTS へ戻る合図）、
 *    時間を置けば確かめ直すこと。
 */
import {
	createVoicevoxProsodySource,
	type VoicevoxAudioQuery,
	voicevoxQueryToProsodyFrames,
} from "../../src/voice/voicevox-prosody";

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	const ok = a === b;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) console.log(`       got    ${a}\n       expect ${b}`);
};

const ln = Math.log;
// 「あき、すね」: あ(200Hz) き(300Hz) / 間 / す(無声) ね(100Hz)
const query: VoicevoxAudioQuery = {
	prePhonemeLength: 0.1,
	postPhonemeLength: 0.1,
	accent_phrases: [
		{
			moras: [
				{ vowel: "a", vowel_length: 0.1, pitch: ln(200) },
				{
					consonant: "k",
					consonant_length: 0.05,
					vowel: "i",
					vowel_length: 0.1,
					pitch: ln(300),
				},
			],
			pause_mora: { vowel: "pau", vowel_length: 0.2, pitch: 0 },
		},
		{
			moras: [
				{
					consonant: "s",
					consonant_length: 0.05,
					vowel: "U",
					vowel_length: 0.05,
					pitch: 0,
				},
				{
					consonant: "n",
					consonant_length: 0.05,
					vowel: "e",
					vowel_length: 0.1,
					pitch: ln(100),
				},
			],
		},
	],
};

console.log("音素の時刻表");
const frames = voicevoxQueryToProsodyFrames(query);
if (!frames) throw new Error("frames is null");
check(
	"並びと開始時刻",
	frames.phonemes.map((p) => `${p.phone}@${Math.round(p.start_ms)}`),
	[
		"sil@0",
		"a@100",
		"k@200",
		"i@250",
		"pau@350",
		"s@550",
		"U@600",
		"n@650",
		"e@700",
		"sil@800",
	],
);
check("フレーム数（900ms / 5ms）", frames.f0_hz.length, 180);

console.log("高さ");
const at = (ms: number): number => Math.round(frames.f0_hz[ms / 5]);
check("頭の無音は 0", at(50), 0);
check("「あ」の中心は 200Hz", at(150), 200);
check("「き」の中心は 300Hz", at(300), 300);
check("あ→き の中間は対数の中点", at(225), Math.round(Math.sqrt(200 * 300)));
check("「き」の後ろは 300Hz のまま", at(345), 300);
check("間は 0", at(450), 0);
check("無声の「す」は 0", at(620), 0);
check("「ね」は息継ぎをまたがず 100Hz", at(655), 100);
check("尻の無音は 0", at(850), 0);
check(
	"鳴るモーラが無ければ null",
	voicevoxQueryToProsodyFrames({
		prePhonemeLength: 0.1,
		postPhonemeLength: 0.1,
		accent_phrases: [{ moras: [{ vowel: "cl", vowel_length: 0.1, pitch: 0 }] }],
	}),
	null,
);

const main = async (): Promise<void> => {
	console.log("エンジンに届かないとき");
	let clock = 0;
	let up = false;
	const calls: string[] = [];
	const fakeFetch = (async (input: unknown) => {
		const url = String(input);
		calls.push(url.includes("/version") ? "version" : "query");
		if (!up) throw new TypeError("Failed to fetch");
		return {
			ok: true,
			json: async () => query,
		} as Response;
	}) as typeof fetch;
	const source = createVoicevoxProsodySource({
		fetch: fakeFetch,
		now: () => clock,
		retryMs: 30000,
	});
	check("null を返す", await source.frames("あき、すね"), null);
	check("確認だけして問い合わせない", calls, ["version"]);
	check("続けて頼んでも確認し直さない", await source.frames("べつ"), null);
	check("呼び出しは増えない", calls, ["version"]);

	console.log("エンジンを後から起動したとき");
	up = true;
	clock = 10000;
	check("時間が経つまでは null", await source.frames("あき、すね"), null);
	clock = 31000;
	const got = await source.frames("あき、すね");
	check("時間が経てば引ける", got?.phonemes.length, 10);
	check("確認し直してから問い合わせる", calls, ["version", "version", "query"]);
	await source.frames("あき、すね");
	check("同じ本文は 1 回だけ問い合わせる", calls.length, 3);
	check("空の本文は null", await source.frames(""), null);

	if (failed > 0) {
		console.error(`\n${failed} 件の不一致`);
		process.exit(1);
	}
	console.log("\nすべて一致");
};
void main();
