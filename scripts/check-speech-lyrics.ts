/**
 * 語り（`「…」`）の歌詞解析のチェック。
 *
 *   npx tsx scripts/check-speech-lyrics.ts
 *
 * `@@0 tsukuyomi ふつうにうたう「かたるばしょ」ふつうにうたう` のように、歌詞の中で
 * `「」` で囲んだ部分は歌わずに読み上げる（UtauTTS）。ここで守りたいのは次の 4 点。
 *
 * 1. `「…」` ひとかたまりが**ノートを 1 つ**消費し、外側は従来どおり 1 文字 1 ノートであること。
 * 2. 中身の漢字・数字・句読点が**捨てられずに残る**こと（読みは jpreprocess が決める）。
 *    歌唱側の正規化はかな以外を全部落とすので、混ぜ方を間違えると本文が消える。
 * 3. 表示・MML への書き戻し（`syllablesToText`）で `「…」` に戻り、往復で壊れないこと。
 * 4. 語りの前後の母音文脈が切れること（直後の `ー` は落ち、次の音節は語頭になる）。
 *
 * 音は出せないので、{@link normalizeLyrics} と {@link buildStreamVoiceNotes} の出力を
 * 文字列に畳んで突き合わせる。
 */
import Module from "node:module";

// `src/lyrics.ts` は @onjmin/koe（ブラウザ専用）を読むので、名前解決だけスタブへ差し替える。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? {
				VoiceBank: class {},
				Worldline: class {},
				UtauTTSAdapter: class {},
				leadInFromEntry: () => 0,
				alignHtsProsody: () => null,
				shapeProsody: (p: unknown) => p,
				isQuestion: () => false,
				openjtalkAnalyze: () => ({ reading: "", features: [] }),
				fetchAsset: () => Promise.reject(new Error("stub")),
				fetchAssetBytes: () => Promise.reject(new Error("stub")),
				fetchAssetText: () => Promise.reject(new Error("stub")),
				loadNaistJdic: () => Promise.reject(new Error("stub")),
				initJpreprocessDictionary: () => {},
			}
		: load(request, ...rest);

const { buildStreamVoiceNotes, normalizeLyrics, syllablesToText } =
	require("../src/lyrics") as typeof import("../src/lyrics");
const { units } = require("../src/tuning") as typeof import("../src/tuning");
type TieSourceNote = import("../src/lyrics").TieSourceNote;
type LyricSyllable = import("../src/types").LyricSyllable;

/** 音節 1 つを `種別:中身` の 1 語へ畳む（歌唱のかなはそのまま、語りは `S:` 付き）。 */
const fmtSyllable = (s: LyricSyllable): string => {
	const marks = `${s.breathAfter ? "、" : ""}${s.fadeIn ? "↑" : ""}${s.fadeOut ? "↓" : ""}`;
	if (s.kind === "speak") return `S:${s.text}${marks}`;
	if (s.kind === "tie")
		return `${s.portamento ? "〜" : "ー"}(${s.vowel})${marks}`;
	if (s.kind === "rest") return `_${marks}`;
	if (s.kind === "stop") return `っ${marks}`;
	return `${s.kana}${marks}`;
};

type Case = {
	lyrics: string;
	/** 期待する音節列（{@link fmtSyllable} の形）。 */
	expect: string[];
	/** 書き戻しの期待値。省略時は入力と同じ。 */
	roundTrip?: string;
	why: string;
};

const CASES: Case[] = [
	{
		lyrics: "ふつうにうたう「かたるばしょ」ふつうにうたう",
		expect: [
			"ふ",
			"つ",
			"う",
			"に",
			"う",
			"た",
			"う",
			"S:かたるばしょ",
			"ふ",
			"つ",
			"う",
			"に",
			"う",
			"た",
			"う",
		],
		why: "「」ひとかたまりが 1 ノート、外側は 1 文字 1 ノート",
	},
	{
		lyrics: "どんぐり「みなさん、こんにちは！2024年です。」ころころ",
		expect: [
			"ど",
			"ん",
			"ぐ",
			"り",
			"S:みなさん、こんにちは！2024年です。",
			"こ",
			"ろ",
			"こ",
			"ろ",
		],
		why: "本文の漢字・数字・句読点・読点は捨てない（歌唱側の正規化を通さない）",
	},
	{
		lyrics: "「こんにちは」",
		expect: ["S:こんにちは"],
		why: "語りだけの歌詞も成立する（全行語り＝セリフだけのトラック）",
	},
	{
		lyrics: "「一行目」「二行目」",
		expect: ["S:一行目", "S:二行目"],
		why: "連続する語りはそれぞれ 1 ノートずつ",
	},
	{
		lyrics: "あ「閉じない",
		expect: ["あ", "S:閉じない"],
		roundTrip: "あ「閉じない」",
		why: "閉じ括弧が無ければ行末までを語りにする（書き戻しでは閉じる）",
	},
	{
		lyrics: "あ」い",
		expect: ["あ", "い"],
		roundTrip: "あい",
		why: "対応する開き括弧の無い 」 は無視する",
	},
	{
		lyrics: "あ「」い",
		expect: ["あ", "_", "い"],
		roundTrip: "あ_い",
		why: "空の「」は休符と同じ（1 ノート消費して無音）",
	},
	{
		lyrics: "き「語り」ーい",
		expect: ["き", "S:語り", "い"],
		roundTrip: "き「語り」い",
		why: "語りの直後の ー は引き継ぐ母音が無いので落ちる",
	},
	{
		lyrics: "あ「語り」、い",
		expect: ["あ", "S:語り、", "い"],
		why: "語りの直後のブレスは語りの音節に畳まれる（ノートを消費しない）",
	},
	{
		lyrics: "あ｢半角｣い",
		expect: ["あ", "S:半角", "い"],
		roundTrip: "あ「半角」い",
		why: "半角の ｢｣ も同じ括弧として読む",
	},
	{
		lyrics: "あ「 前後の空白は落とす 」い",
		expect: ["あ", "S:前後の空白は落とす", "い"],
		roundTrip: "あ「前後の空白は落とす」い",
		why: "本文の前後の空白は落とす",
	},
];

let failed = 0;
console.log("語り（「」）の歌詞解析:\n");
for (const c of CASES) {
	const syllables = normalizeLyrics(c.lyrics);
	const got = syllables.map(fmtSyllable);
	const back = syllablesToText(syllables);
	const expectBack = c.roundTrip ?? c.lyrics;
	const okSyl =
		got.length === c.expect.length && got.every((g, i) => g === c.expect[i]);
	const okBack = back === expectBack;
	const ok = okSyl && okBack;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${c.lyrics}`);
	console.log(`        ${c.why}`);
	if (!okSyl) {
		console.log(`        音節: ${got.join(" / ")}`);
		console.log(`        期待: ${c.expect.join(" / ")}`);
	}
	if (!okBack) {
		console.log(`        書き戻し: ${back}`);
		console.log(`        期待:     ${expectBack}`);
	}
}

// ── 発音側: 語りは 1 ノートを取り、次の音節は語頭（prevVowel 無し）になる ──
console.log("\nストリーミング用ノート列との対応:\n");
{
	const notes: TieSourceNote[] = [0, 48, 96, 144].map((step) => ({
		startStep: step,
		durationSteps: 48,
		pitchUnits: units(2139),
	}));
	const syllables = normalizeLyrics("あ「せりふ」ーい");
	const stream = buildStreamVoiceNotes(syllables, notes, {
		fromStep: 0,
		secondsPerStep: 0.25,
		gate: 1,
		octaveShiftUnits: 0,
	});
	const got = stream.map((n) => `${fmtSyllable(n.syllable)}@${n.startSec}s`);
	const expect = ["あ@0s", "S:せりふ@12s", "い@24s"];
	const ok =
		got.length === expect.length && got.every((g, i) => g === expect[i]);
	if (!ok) failed++;
	console.log(
		`  ${ok ? "OK  " : "NG  "}あ「せりふ」ーい  →  ${got.join(" / ")}`,
	);
	console.log(
		"        語りは 2 番目のノートの開始位置に置かれ、ー は落ちて い が 3 番目のノートへ",
	);
	if (!ok) console.log(`        期待: ${expect.join(" / ")}`);
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log(`\n${CASES.length + 1}件すべて期待どおりです`);
}
