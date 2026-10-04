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
const { composeLyrics, composeSong, isMonophonic, lyricConstraintsOf } =
	require("../../src/compose/compose") as typeof import("../../src/compose/compose");
const { MMLCore } =
	require("../../src/mml/mml-core") as typeof import("../../src/mml/mml-core");
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

console.log("--- 報告体の語り手 ---");
{
	// 報告体の曲は「〜ので／〜から」で異変を受ける文と、主語のない語り手の動きを持つ（§17）。
	// 「〜ました」は詰めすぎない（§18）。1曲ぶん（約300字）の長さで測る——短いと出る・出ないが揺れる。
	let reportSongs = 0;
	const density: number[] = [];
	let withCause = 0;
	let withAct = 0;
	let plainLeak = 0;
	for (let seed = 1; seed <= 200; seed++) {
		const writer = createLyricWriter({
			random: seededRandom(seed * 104729),
			vocab: "kaiwai",
		});
		const lengths = [12, 14, 10, 16, 9, 13, 15, 11];
		const text = [...lengths, ...lengths, ...lengths]
			.map((m) => writer.write(m))
			.join("");
		if (writer.register !== "report") {
			if (/(ので|から)(かえり|いき|はしり|まち|ねむり|ね)ました/.test(text))
				plainLeak++;
			continue;
		}
		reportSongs++;
		density.push(
			((text.match(/ました/g)?.length ?? 0) / [...text].length) * 1000,
		);
		if (/[たいだ](ので|から)/.test(text)) withCause++;
		if (
			/(かえり|いき|はしり|いそぎ|にげ|あるき|もどり|まち|ねむり|かくれ|ね|すわり)ました/.test(
				text,
			)
		)
			withAct++;
	}
	check(
		reportSongs > 0 && withCause / reportSongs >= 0.5,
		`理由でつなぐ文（${withCause}/${reportSongs}曲）`,
		"報告体の曲の半分以上に「〜たので」「〜たから」が出る",
	);
	check(
		reportSongs > 0 && withAct / reportSongs >= 0.8,
		`語り手の動き（${withAct}/${reportSongs}曲）`,
		"報告体の曲のほとんどに、主語のない「帰りました」「待ちました」の類が出る",
	);
	const mid =
		[...density].sort((a, b) => a - b)[Math.floor(density.length / 2)] ?? 0;
	check(
		mid >= 15 && mid <= 45,
		`「〜ました」の密度（中央 ${mid.toFixed(0)}／1000字）`,
		"報告体の曲でも光景の文は普通体が多い。耳コピの報告型は1000字あたり12〜42（§18）",
	);
	check(
		plainLeak === 0,
		"言い切りの曲には混ざらない",
		"語り手の型は報告体の曲だけ（文末の形を曲の中で混ぜない）",
		plainLeak ? `${plainLeak}曲` : "",
	);
}

console.log("--- 旋律の切れ目と語 ---");
{
	// 語（助詞まで含むまとまり）は休符をまたがず、語の最後の音は後ろの語に吸われない（§19）。
	// 原曲（夏毛・カゲロウ）は休符またぎ 1%・17%、語末が後ろに近い 5%・2%。制約なしと比べる。
	type Tally = { words: number; restCross: number; glued: number };
	const tally = (useCons: boolean): Tally => {
		const t: Tally = { words: 0, restCross: 0, glued: 0 };
		for (let i = 0; i < 12; i++) {
			const random = seededRandom(3000 + i);
			const song = composeSong({
				stepsPerBar: STEPS_PER_BAR,
				edo: 12,
				random,
				template: "kaiwai",
			});
			const notes = [...song.melody].sort((a, b) => a.startStep - b.startStep);
			const writer = createLyricWriter({ random, vocab: "kaiwai" });
			// composeLyrics と同じく4小節ごとに区切る。
			const groups: (typeof notes)[] = [];
			for (const n of notes) {
				const g = Math.floor(n.startStep / (STEPS_PER_BAR * 4));
				const last = groups[groups.length - 1];
				if (last && Math.floor(last[0].startStep / (STEPS_PER_BAR * 4)) === g)
					last.push(n);
				else groups.push([n]);
			}
			groups.forEach((group, gi) => {
				const cons = lyricConstraintsOf(group, groups[gi + 1]?.[0]);
				const words = writer.writeWords(
					group.length,
					group.map((n) => n.durationSteps >= STEPS_PER_BAR / 4),
					useCons ? cons : undefined,
				);
				let at = 0;
				for (const w of words) {
					const len = [...w].length;
					const end = at + len;
					if (len >= 2) {
						t.words++;
						if (cons.cuts.some((k) => at < k && k < end)) t.restCross++;
						if (cons.badEnds.includes(end)) t.glued++;
					}
					at = end;
				}
			});
		}
		return t;
	};
	const before = tally(false);
	const after = tally(true);
	const pc = (x: number, d: number) => `${((x / d) * 100).toFixed(0)}%`;
	check(
		after.restCross / after.words <= 0.05,
		`休符をまたぐ語 ${pc(after.restCross, after.words)}（制約なし ${pc(before.restCross, before.words)}）`,
		"休符は語の切れ目。原曲は 1%・17%",
	);
	check(
		after.glued / after.words <= 0.05,
		`最後の音が後ろの語に近い語 ${pc(after.glued, after.words)}（制約なし ${pc(before.glued, before.words)}）`,
		"「いえか~|らとおい」の形を作らない。原曲は 5%・2%",
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

console.log("--- 和音のトラック ---");
{
	// 既にある曲のトラックへ歌詞を当てるとき（DAW の「自動で作る」）、和音は非対応と出す。
	const n = (startStep: number, durationSteps: number) => ({
		startStep,
		durationSteps,
	});
	check(
		isMonophonic([n(0, 48), n(48, 48), n(96, 96)]),
		"隙間なく続く単音は対象",
		"開始が直前の音の終わりと同じ（レガート）なら重なっていない",
	);
	check(
		isMonophonic([n(0, 24), n(48, 48)]),
		"休符をはさむ単音は対象",
		"間が空くのはふつうの旋律",
	);
	check(
		!isMonophonic([n(0, 48), n(0, 48)]),
		"同時に始まる2音は非対応",
		"和音は1音符1文字に割り当てられない",
	);
	check(
		!isMonophonic([n(0, 96), n(48, 48)]),
		"途中で重なる2音は非対応",
		"並び順を入れ替えても同じ判定になる（startStep で並べ直す）",
	);
	check(
		!isMonophonic([n(48, 48), n(0, 96)]),
		"順番が逆でも重なりを見つける",
		"渡された順に依らない",
	);
}

console.log("--- 読み込んだ曲のトラックへ当てる ---");
{
	// DAW の「自動で作る」と同じ経路（トラックの音符 → isMonophonic → composeLyrics）を
	// ヘッドレスで通す。音符は MMLCore に置いて、アプリと同じ形で取り出す。
	const renderConfig: import("../../src/types").RenderConfig = {
		stepsPerBar: STEPS_PER_BAR,
		keyCount: 88,
		pitchRangeStart: 0,
		unitsPerRow: 31,
		keyHeight: 12,
		stepWidth: 2,
		edo: 12,
	};
	const newCore = () =>
		new MMLCore(
			{ onMMLGenerated: () => {}, onNotesChanged: () => {} },
			100,
			() => renderConfig,
		);
	const core = newCore();
	core.setLoadMode(true);
	// 4小節ぶんの8分音符（単音）。
	for (let i = 0; i < 32; i++)
		core.addNote(i * (STEPS_PER_BAR / 8), 60 * 31 + (i % 5) * 31 * 2, {
			noteLengthSteps: STEPS_PER_BAR / 8,
		});
	core.setLoadMode(false);
	const notes = core.getNotes();
	check(
		notes.length === 32 && isMonophonic(notes),
		`置いた音符を単音と判定（${notes.length}音）`,
		"読み込んだ曲のトラックでも、重なりが無ければ歌詞を当てられる",
	);
	const text = composeLyrics(
		notes.map((n) => ({
			startStep: n.startStep,
			pitchUnits: n.pitchUnits,
			durationSteps: n.durationSteps,
			velocity: n.velocity ?? 100,
		})),
		{ stepsPerBar: STEPS_PER_BAR, random: seededRandom(777), vocab: "kaiwai" },
	);
	const syllables = normalizeLyrics(text).length;
	check(
		syllables === notes.length,
		`当てた歌詞の音節数（${syllables} / 音符 ${notes.length}）`,
		"1音符に1音節。読点（ブレス）は音符を消費しない",
	);

	const chordCore = newCore();
	chordCore.setLoadMode(true);
	chordCore.addNote(0, 60 * 31, { noteLengthSteps: STEPS_PER_BAR / 4 });
	chordCore.addNote(0, 64 * 31, { noteLengthSteps: STEPS_PER_BAR / 4 });
	chordCore.setLoadMode(false);
	check(
		!isMonophonic(chordCore.getNotes()),
		"和音を置いたトラックは非対応と判定",
		"UI は「和音のトラックは非対応です」と出して何も書かない",
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
