/**
 * 仮歌詞（[compose-lyrics.ts](../../src/compose/compose-lyrics.ts)）の検算。
 * 規則と実測は [docs/lyric-design.md](../../docs/lyric-design.md)。
 *
 *   npx tsx scripts/test/check-compose-lyrics.ts
 *
 * 守りたいのは「歌詞と音符が1対1である」こと。ここがずれると、以降の歌詞が全部ずれて
 * 別の音で歌われる。文字数（アプリが読む数）と音節数（歌唱合成が読む数）の両方で確かめる。
 */

import Module from "node:module";

// `src/voice/lyrics.ts` は @onjmin/koe（ブラウザ専用）を読むので、名前解決だけ空スタブへ差し替える。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { normalizeLyrics } =
	require("../../src/voice/lyrics") as typeof import("../../src/voice/lyrics");
const { composeLyrics, composeSong } =
	require("../../src/compose/compose") as typeof import("../../src/compose/compose");
const { createLyricWriter } =
	require("../../src/compose/compose-lyrics") as typeof import("../../src/compose/compose-lyrics");

const STEPS_PER_BAR = 192;

let failed = 0;
const check = (ok: boolean, label: string, why: string, detail = ""): void => {
	if (!ok) failed++;
	console.log(
		`  ${ok ? "OK  " : "NG  "}${label}${detail ? `  →  ${detail}` : ""}`,
	);
	console.log(`        ${why}`);
};

const seededRandom = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

console.log("--- 句の長さ ---");
{
	// 1〜40モーラのすべての長さで、文字数・音節数・使う文字を確かめる。
	const bad: string[] = [];
	for (const vocab of ["kaiwai", "pop"] as const)
		for (let seed = 1; seed <= 40; seed++) {
			const writer = createLyricWriter({
				random: seededRandom(seed * 7919),
				vocab,
			});
			for (let mora = 1; mora <= 40; mora++) {
				const text = writer.write(mora);
				const chars = [...text];
				const where = `${vocab}/${writer.register} ${mora}モーラ`;
				if (chars.length !== mora)
					bad.push(`${where} → 文字数 ${chars.length}`);
				if (normalizeLyrics(text).length !== mora)
					bad.push(`${where} → 音節数 ${normalizeLyrics(text).length}`);
				const wrong = chars.filter((c) => !/[ぁ-ゖ]/.test(c));
				if (wrong.length) bad.push(`${where} → かな以外 ${wrong.join("")}`);
				const small = chars.filter((c) => /[ぁぃぅぇぉゃゅょゎ]/.test(c));
				if (small.length) bad.push(`${where} → 小書きかな ${small.join("")}`);
				if (text.endsWith("の") || text.endsWith("を"))
					bad.push(`${where} → 助詞で終わった`);
			}
		}
	check(
		bad.length === 0,
		"1〜40モーラ × 2語彙 × 40曲",
		"文字数＝モーラ数＝音節数。ひらがなだけで、小書きかな・伸ばし棒・尻切れの助詞は使わない",
		bad.slice(0, 5).join(" / "),
	);
}

console.log("--- 曲に載せる ---");
{
	const mismatched: string[] = [];
	const tieSongs: string[] = [];
	const breathOutside: string[] = [];
	let verbEnding = 0;
	let repeated = 0;
	let longNotes = 0;
	let longOpen = 0;
	let shortNotes = 0;
	let shortOpen = 0;
	let castRecurs = 0;
	const songs = 12;
	/** その曲の登場物。`composeLyrics` と同じ順（曲→歌詞）で乱数を進めて作り直す。 */
	const writerCast = (
		seed: number,
		vocab: "kaiwai" | "pop" | undefined,
	): string[] => {
		const random = seededRandom(seed);
		composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random,
			template: "kaiwai",
		});
		return createLyricWriter({ random, vocab }).cast.heads;
	};
	for (let i = 0; i < songs; i++) {
		const seed = 1000 + i;
		const random = seededRandom(seed);
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random,
			template: "kaiwai",
		});
		const text = composeLyrics(song.melody, {
			stepsPerBar: STEPS_PER_BAR,
			random,
			vocab: song.lyricVocab,
		});
		const kana = [...text].filter((c) => c !== "、");
		if (kana.length !== song.melody.length)
			mismatched.push(
				`種${seed}: 歌詞${kana.length} 音符${song.melody.length}`,
			);
		if (text.includes("ー")) tieSongs.push(`種${seed}`);

		// 読点は4小節の切れ目にだけ立つ（音符を消費しない）。
		const sorted = [...song.melody].sort((a, b) => a.startStep - b.startStep);
		let at = 0;
		for (const c of text) {
			if (c !== "、") {
				at++;
				continue;
			}
			const here = sorted[at - 1];
			const next = sorted[at];
			if (
				here &&
				next &&
				Math.floor(here.startStep / (STEPS_PER_BAR * 4)) ===
					Math.floor(next.startStep / (STEPS_PER_BAR * 4))
			)
				breathOutside.push(`種${seed}`);
		}

		const groups = text.split("、").filter(Boolean);
		if (
			/(ました|てくる|ている|いく|った|えた|んだ|ない)$/.test(groups[0] ?? "")
		)
			verbEnding++;
		if (new Set(groups).size < groups.length) repeated++;

		// 伸びる音（4分以上）に あ・い が寄っているか。原曲は あ 33→39%（§5）。
		for (let k = 0; k < sorted.length && k < kana.length; k++) {
			const open =
				/[あいかきさしたちなにはひまみやらりわがぎざじだぢばびぱぴ]/.test(
					kana[k],
				);
			if (sorted[k].durationSteps >= STEPS_PER_BAR / 4) {
				longNotes++;
				if (open) longOpen++;
			} else {
				shortNotes++;
				if (open) shortOpen++;
			}
		}

		// 登場物が曲の中で何度も戻ってくるか。
		const used = writerCast(seed, song.lyricVocab).filter((w) =>
			text.includes(w),
		);
		const counts = used.map((w) => text.split(w).length - 1);
		if (used.length > 0 && Math.max(...counts) >= 3) castRecurs++;
	}
	check(
		mismatched.length === 0,
		`音符と歌詞の数（${songs}曲）`,
		"1音符に1文字。読点は音符を消費しない",
		mismatched.slice(0, 3).join(" / "),
	);
	check(
		tieSongs.length === 0,
		`伸ばし棒を置かない（${songs}曲）`,
		"原曲の伸ばしは16曲中15曲で2%以下（docs/lyric-design.md §1）",
		tieSongs.slice(0, 3).join(" / "),
	);
	check(
		breathOutside.length === 0,
		`読点の位置（${songs}曲）`,
		"息継ぎは4小節の切れ目にだけ入る",
		breathOutside.slice(0, 3).join(" / "),
	);
	check(
		verbEnding >= songs / 2,
		`文で終わる（${verbEnding}/${songs}曲）`,
		"くじ引きの単語列ではなく、動詞か文末の形で閉じた文になっている",
	);
	check(
		repeated >= songs / 2,
		`まとまりを繰り返す（${repeated}/${songs}曲）`,
		"同じ形のまとまりには同じ歌詞を載せる（原曲の句の重複は23%）",
	);
	const longShare = (longOpen / longNotes) * 100;
	const shortShare = (shortOpen / shortNotes) * 100;
	check(
		longShare > shortShare + 3,
		`伸びる音の母音（あ・い 列 ${longShare.toFixed(0)}% 対 短い音 ${shortShare.toFixed(0)}%）`,
		"原曲は4分以上で あ 33→39%・い 21→25% と増える（docs/lyric-design.md §5）",
	);
	check(
		castRecurs >= songs / 2,
		`登場物が戻ってくる（${castRecurs}/${songs}曲）`,
		"曲ごとに引いた登場物のどれかが3回以上出る（層⑤）",
	);
}

console.log("--- 種の再現 ---");
{
	const once = (): string => {
		const random = seededRandom(4242);
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random,
			template: "kaiwai",
		});
		return composeLyrics(song.melody, {
			stepsPerBar: STEPS_PER_BAR,
			random,
			vocab: song.lyricVocab,
		});
	};
	const a = once();
	const b = once();
	check(
		a === b,
		"同じ種で同じ歌詞",
		"乱数は渡されたものだけを使う（Math.random を混ぜない）",
	);
}

console.log(failed === 0 ? "\nすべて OK" : `\n${failed} 件 NG`);
process.exit(failed === 0 ? 0 : 1);
