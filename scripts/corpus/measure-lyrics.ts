/**
 * 参考コーパス（耳コピの UST）の**歌詞**と、自動作曲が付ける仮歌詞を、同じ物差しで測る。
 *
 *   npx tsx scripts/corpus/measure-lyrics.ts --dir "C:/path/to/界隈曲" [--md tmp/lyrics.md]
 *   npx tsx scripts/corpus/measure-lyrics.ts --generate kaiwai --count 20 --seed 1
 *
 * 出すのは**数だけ**。歌詞の本文・曲ごとの語句は出さない（他人の曲なので
 * [docs/dataset-provenance.md](../../docs/dataset-provenance.md) のとおり git にもバンドルにも入れない）。
 * 結果のまとめは [docs/lyric-design.md](../../docs/lyric-design.md)。
 *
 * 測るもの:
 *  - 表記: ひらがな・カタカナ・漢字の比率、助詞「を」「は」を書くか（表音表記かどうか）
 *  - 音符と文字: 1音符が1モーラか、伸ばし（`ー`・母音だけの音符）の割合、句のモーラ数
 *  - 句末の形: 「〜ました」「〜ない」「〜んだ」等の語尾が、何曲の何文に出るか
 *  - 語彙: 海のもの・暮らしの場・自然・体・時間の語が、何曲に出るか
 *  - 反復: 同じ句がそのまま出てくる割合と、まとまりごとの反復の単位
 *
 * 規則として採るのは**2曲以上**に出たものだけ（[docs/handover-compose.md](../../docs/handover-compose.md) §0 と同じ基準）。
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { join, relative, sep } from "node:path";
import { composeLyrics, composeSong } from "../../src/compose/compose";

// `src/voice/lyrics.ts` は歌唱合成エンジン @onjmin/koe（ブラウザ専用）を読む。
// ここではモーラ分割だけ使うので、名前解決を空スタブへ差し替える。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);
const { normalizeLyrics } =
	require("../../src/voice/lyrics") as typeof import("../../src/voice/lyrics");

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

const dir = argOf("--dir");
const generate = argOf("--generate");
if (!dir && !generate) {
	console.log(
		"--dir に耳コピ UST のフォルダを渡す。生成側は --generate <template>（両方渡すと並べて出す）",
	);
	process.exit(0);
}

/** 音符1つ。歌詞は VCV の接頭辞（`- か`）を外した素のかな。休符は `R`。 */
type Note = { lengthTicks: number; lyric: string };

const REST = new Set(["R", "r", ""]);
const QUARTER = 480; // UST の Length は4分音符=480
const STEPS_PER_BAR = 192; // アプリ側の1小節。UST の 1920 ticks に当たる

const walk = (d: string): string[] =>
	readdirSync(d, { withFileTypes: true }).flatMap((e) => {
		const p = join(d, e.name);
		if (e.isDirectory()) return e.name === "History" ? [] : walk(p);
		return e.name.toLowerCase().endsWith(".ust") ? [p] : [];
	});

/** Shift_JIS と UTF-8 のどちらでも読む（UST は宣言がヘッダにある）。 */
const decode = (buf: Buffer): string =>
	new TextDecoder(
		/Charset=UTF-8/i.test(buf.subarray(0, 400).toString("latin1"))
			? "utf-8"
			: "shift_jis",
	).decode(buf);

const parseUst = (text: string): Note[] => {
	const notes: Note[] = [];
	for (const sec of text.split(/\r?\n(?=\[#)/)) {
		if (!/^\[#\d+\]/.test(sec)) continue;
		const lengthTicks = Number((sec.match(/\nLength=(\d+)/) ?? [])[1] ?? 0);
		const lyric = ((sec.match(/\nLyric=(.*)/) ?? [])[1] ?? "")
			.trim()
			.replace(/^[aiueonN-] /, "");
		notes.push({ lengthTicks, lyric });
	}
	return notes;
};

/** 曲の単位。`作者/曲名/...` の上2階層を1曲とみなす（版・パートはその下）。 */
const songKeyOf = (rel: string): string => {
	const parts = rel.split(sep);
	const dirs = parts.slice(0, -1);
	return dirs.length ? dirs.slice(0, 2).join("/") : parts[0];
};

const trigrams = (s: string): Set<string> => {
	const set = new Set<string>();
	for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3));
	return set;
};
const jaccard = (a: Set<string>, b: Set<string>): number => {
	if (a.size === 0 || b.size === 0) return 0;
	let hit = 0;
	for (const x of a) if (b.has(x)) hit++;
	return hit / (a.size + b.size - hit);
};

/** 句: 休符で切る。文: 4分以上の休符で切る。 */
const split = (notes: Note[], minRest: number): string[] => {
	const out: string[] = [];
	let cur = "";
	for (const n of notes) {
		if (REST.has(n.lyric)) {
			if (n.lengthTicks >= minRest && cur) {
				out.push(cur);
				cur = "";
			}
			continue;
		}
		cur += n.lyric;
	}
	if (cur) out.push(cur);
	return out;
};

/** 句末の形を数える（{@link ENDINGS} の順に当て、最初に当たったものだけ）。 */
const endingsOf = (units: string[]): Map<string, number> => {
	const out = new Map<string, number>();
	for (const u of units) {
		const hit = ENDINGS.find(([, re]) => re.test(u));
		const key = hit ? hit[0] : "どれでもない";
		out.set(key, (out.get(key) ?? 0) + 1);
	}
	return out;
};

/** 句を、鳴り始め・鳴り終わり（ticks）つきで取る。層の重なりを測るのに使う。 */
const spansOf = (notes: Note[]): { from: number; to: number }[] => {
	const out: { from: number; to: number }[] = [];
	let cur: { from: number; to: number } | null = null;
	let at = 0;
	for (const n of notes) {
		if (REST.has(n.lyric)) {
			if (cur) {
				out.push(cur);
				cur = null;
			}
			at += n.lengthTicks;
			continue;
		}
		if (!cur) cur = { from: at, to: at };
		at += n.lengthTicks;
		cur.to = at;
	}
	if (cur) out.push(cur);
	return out;
};

const TIE = /^[ー\-+~〜]$/;
const BARE_VOWEL = /^[aiueonN]$/;
const moraOf = (s: string): number => normalizeLyrics(s).length;
const quantile = (xs: number[], r: number): number =>
	xs.length === 0
		? 0
		: [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * r)];
const pct = (num: number, den: number): number =>
	den === 0 ? 0 : (num / den) * 100;

/** 句末の形。先に当たったものだけ数えるので、長い形を先に置く。 */
const ENDINGS: [string, RegExp][] = [
	["〜ました・ません（報告体）", /(ました|ません|ましょ[うお]?|です|ですか)$/],
	["〜てくる・〜てきた（到来）", /(てく[るぅ]|てきた|でく[るぅ]|できた)$/],
	["〜ない・〜なく（打ち消し）", /(ない|なく|なかった|ぬ)$/],
	["〜んだ・〜のだ（言い切り）", /(んだ|のだ|んです)$/],
	["〜る・〜た（普通体の動詞）", /[るたういくすつむぬぶ]$/],
];

/** 語彙のまとまり。曲をまたいで出るかだけを見る（1曲だけの言い回しは規則にしない）。 */
const VOCAB: [string, string[]][] = [
	[
		"海のもの",
		[
			"いわし",
			"くらげ",
			"さかな",
			"まぐろ",
			"くじら",
			"すなめり",
			"うろこ",
			"しんかいぎょ",
			"かいせん",
			"えび",
			"たこ",
			"いか",
		],
	],
	[
		"暮らしの場",
		[
			"えき",
			"ほーむ",
			"こうえん",
			"かいだん",
			"やね",
			"まど",
			"へや",
			"いえ",
			"あぱーと",
			"ばす",
			"まち",
			"やちん",
			"ふとん",
			"しんぶん",
			"がっこう",
			"でんしゃ",
			"こうさてん",
			"じんじゃ",
			"らじお",
		],
	],
	[
		"自然・天",
		[
			"そら",
			"つち",
			"うみ",
			"あめ",
			"ゆき",
			"くも",
			"ひかり",
			"つき",
			"ほし",
			"かぜ",
			"あさやけ",
			"ゆうやけ",
			"よあけ",
			"みず",
			"しお",
		],
	],
	[
		"体",
		[
			"ゆび",
			"からだ",
			"こえ",
			"ほね",
			"あたま",
			"せなか",
			"むね",
			"かお",
			"めだま",
			"しんぞう",
		],
	],
	[
		"時間",
		[
			"あした",
			"きのう",
			"きょう",
			"あさ",
			"よる",
			"ゆうべ",
			"じかん",
			"いま",
			"まいにち",
			"ことし",
			"むかし",
		],
	],
];

/** かな1文字の母音。歌える歌詞かどうかは、伸びる音にどの母音が来るかで決まる。 */
const VOWEL_OF = ((): Map<string, string> => {
	const map = new Map<string, string>();
	for (const [row, v] of [
		["あかさたなはまやらわがざだばぱ", "a"],
		["いきしちにひみりぎじぢびぴ", "i"],
		["うくすつぬふむゆるぐずづぶぷ", "u"],
		["えけせてねへめれげぜでべぺ", "e"],
		["おこそとのほもよろごぞどぼぽ", "o"],
		["ん", "N"],
	] as const)
		for (const c of row) map.set(c, v);
	return map;
})();
const VOWEL_KEYS = ["a", "i", "u", "e", "o", "N"] as const;
type VowelCount = Record<string, number>;

const countVowels = (notes: Note[], onlyLong: boolean): VowelCount => {
	const out: VowelCount = {};
	for (const n of notes) {
		if (REST.has(n.lyric)) continue;
		if (onlyLong && n.lengthTicks < QUARTER) continue;
		const v = VOWEL_OF.get([...n.lyric][0] ?? "") ?? "?";
		out[v] = (out[v] ?? 0) + 1;
	}
	return out;
};

/**
 * 曲名のかなの連（3文字以上）が歌詞に何回出るか。「曲名の1文をサビで歌う」が規則かを見る。
 * 漢字の題（ヤツメ穴・拝啓など）は測れないので、連の数も一緒に返す。
 */
const titleHits = (
	key: string,
	text: string,
): { hits: number; runs: number } => {
	const title = key.split("/").pop() ?? "";
	const runs = title.match(/[ぁ-ゖー]{3,}/g) ?? [];
	let hits = 0;
	for (const run of runs)
		for (let n = run.length; n >= 3; n--) {
			const c = text.split(run.slice(0, n)).length - 1;
			if (c > 0) {
				hits += c;
				break;
			}
		}
	return { hits, runs: runs.length };
};

type Row = {
	key: string;
	files: number;
	parts: number;
	notes: number;
	phrases: number;
	sentences: number;
	moras: number[];
	oneMora: number;
	tie: number;
	hira: number;
	kata: number;
	kanji: number;
	wo: number;
	ha: number;
	repeat: number;
	maxRun: number;
	maxBlock: number;
	endings: Map<string, number>;
	vocab: Map<string, number>;
	vowelsAll: VowelCount;
	vowelsLong: VowelCount;
	title: { hits: number; runs: number };
	/** 2回以上出る句（サビ候補）と1回だけの句（Aメロ候補）のモーラ数と句末の形。 */
	repeatedMoras: number[];
	onceMoras: number[];
	repeatedEnds: Map<string, number>;
	onceEnds: Map<string, number>;
	/** 層ごとの音符数と、主の層（音符が最多）の区間との重なり。 */
	layers: { notes: number; overlap: number }[];
};

/** 連続する k 句のまとまりが、あとでそのまま出てくる最大の k（反復の単位）。 */
const longestRepeatedBlock = (phrases: string[]): number => {
	for (let k = Math.floor(phrases.length / 2); k >= 2; k--) {
		const seen = new Set<string>();
		for (let i = 0; i + k <= phrases.length; i++) {
			const block = phrases.slice(i, i + k).join("\u0000");
			if (seen.has(block)) return k;
			seen.add(block);
		}
	}
	return phrases.length > 1 && new Set(phrases).size < phrases.length ? 1 : 0;
};

/** 1曲（声の層ごとの音符列）から数を出す。UST と生成物で同じ関数を通す。 */
const rowOf = (key: string, files: number, parts: Note[][]): Row => {
	const sung = parts.flat().filter((n) => !REST.has(n.lyric));
	const phrases = parts.flatMap((p) => split(p, 1));
	const sentences = parts.flatMap((p) => split(p, QUARTER));
	const text = phrases.join("");
	const chars = [...text];

	const endings = new Map<string, number>();
	for (const s of sentences) {
		for (const [label, re] of ENDINGS) {
			if (re.test(s)) {
				endings.set(label, (endings.get(label) ?? 0) + 1);
				break;
			}
		}
	}
	const vocab = new Map<string, number>();
	for (const [label, words] of VOCAB) {
		let hit = 0;
		for (const w of words) hit += text.split(w).length - 1;
		if (hit) vocab.set(label, hit);
	}

	// 同じ句がそのまま出てくる割合と、連続で並ぶ最長の回数。
	const counts = new Map<string, number>();
	for (const p of phrases) counts.set(p, (counts.get(p) ?? 0) + 1);
	let maxRun = 1;
	let run = 1;
	for (let i = 1; i < phrases.length; i++) {
		run = phrases[i] === phrases[i - 1] ? run + 1 : 1;
		if (run > maxRun) maxRun = run;
	}

	return {
		key,
		files,
		parts: parts.length,
		notes: sung.length,
		phrases: phrases.length,
		sentences: sentences.length,
		moras: phrases.map(moraOf).filter((x) => x > 0),
		oneMora: pct(sung.filter((n) => moraOf(n.lyric) === 1).length, sung.length),
		tie: pct(
			sung.filter((n) => TIE.test(n.lyric) || BARE_VOWEL.test(n.lyric)).length,
			sung.length,
		),
		hira: pct(chars.filter((c) => /[ぁ-ゖ]/.test(c)).length, chars.length),
		kata: pct(chars.filter((c) => /[ァ-ヶ]/.test(c)).length, chars.length),
		kanji: pct(
			chars.filter((c) => /[\u4e00-\u9fff]/.test(c)).length,
			chars.length,
		),
		wo: text.split("を").length - 1,
		ha: text.split("は").length - 1,
		repeat: pct(phrases.length - counts.size, phrases.length),
		maxRun,
		maxBlock: longestRepeatedBlock(phrases),
		endings,
		vocab,
		vowelsAll: countVowels(parts.flat(), false),
		vowelsLong: countVowels(parts.flat(), true),
		title: titleHits(key, text),
		repeatedMoras: phrases.filter((p) => (counts.get(p) ?? 0) >= 2).map(moraOf),
		onceMoras: phrases.filter((p) => (counts.get(p) ?? 0) === 1).map(moraOf),
		repeatedEnds: endingsOf(phrases.filter((p) => (counts.get(p) ?? 0) >= 2)),
		onceEnds: endingsOf(phrases.filter((p) => (counts.get(p) ?? 0) === 1)),
		layers: ((): { notes: number; overlap: number }[] => {
			const spans = parts.map((p) => {
				const s = spansOf(p);
				return {
					notes: p.filter((n) => !REST.has(n.lyric)).length,
					from: s[0]?.from ?? 0,
					to: s[s.length - 1]?.to ?? 0,
				};
			});
			const main = spans.reduce(
				(a, b) => (b.notes > a.notes ? b : a),
				spans[0],
			);
			return spans.map((s) => ({
				notes: s.notes,
				overlap:
					Math.max(0, Math.min(s.to, main.to) - Math.max(s.from, main.from)) /
					(main.to - main.from || 1),
			}));
		})(),
	};
};

/** 耳コピ UST を曲ごとにまとめて読む。 */
const corpusRows = (root: string): Row[] => {
	const byKey = new Map<
		string,
		{ parts: Note[][]; grams: Set<string>[]; files: number }
	>();
	for (const f of walk(root)) {
		const notes = parseUst(decode(readFileSync(f)));
		const sung = notes.filter((n) => !REST.has(n.lyric));
		if (sung.length < 30) continue; // ハモリの断片・空ファイルは除く
		const key = songKeyOf(relative(root, f));
		const g = trigrams(sung.map((n) => n.lyric).join(""));
		const entry = byKey.get(key) ?? { parts: [], grams: [], files: 0 };
		entry.files++;
		// 同じ曲の再保存・ハモリは同じ歌詞を持つ。歌詞の違う層（裏歌詞）だけ別に数える。
		if (!entry.grams.some((prev) => jaccard(prev, g) >= 0.5)) {
			entry.parts.push(notes);
			entry.grams.push(g);
		}
		byKey.set(key, entry);
	}
	return [...byKey]
		.map(([key, v]) => rowOf(key, v.files, v.parts))
		.sort((a, b) => (a.key < b.key ? -1 : 1));
};

/**
 * 生成曲の仮歌詞を UST と同じ形へ写す。1文字が1音符なので、旋律の音符と文字を突き合わせ、
 * 旋律の隙間（8分以上）を休符として入れる——これで「句」が UST と同じ意味になる。
 */
const generatedRows = (
	template: string,
	count: number,
	startSeed: number,
): Row[] => {
	const rows: Row[] = [];
	for (let i = 0; i < count; i++) {
		const seed = startSeed + i;
		let state = seed >>> 0;
		const random = (): number => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 0x100000000;
		};
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			edo: 12,
			random,
			template,
		});
		const melody = [...song.melody].sort((a, b) => a.startStep - b.startStep);
		if (melody.length === 0) continue;
		const text = composeLyrics(song.melody, {
			stepsPerBar: STEPS_PER_BAR,
			random,
			vocab: song.lyricVocab,
		});
		const kana = [...text].filter((c) => c !== "、");
		const notes: Note[] = [];
		for (let k = 0; k < melody.length; k++) {
			const note = melody[k];
			notes.push({
				lengthTicks: note.durationSteps * 10,
				lyric: kana[k] ?? "",
			});
			const next = melody[k + 1];
			const gap = next
				? next.startStep - (note.startStep + note.durationSteps)
				: 0;
			if (gap >= STEPS_PER_BAR / 8)
				notes.push({ lengthTicks: gap * 10, lyric: "R" });
		}
		rows.push(rowOf(`seed ${seed}`, 1, [notes]));
	}
	return rows;
};

const lines: string[] = [];
const say = (s = ""): void => {
	lines.push(s);
	console.log(s);
};

/** 行の集まりを1つの表と要約にする。 */
const report = (title: string, rows: Row[], detail: boolean): void => {
	const n = rows.length;
	if (n === 0) return;
	const med = (f: (r: Row) => number): string =>
		quantile(rows.map(f), 0.5).toFixed(0);
	const songsWith = (f: (r: Row) => boolean): number => rows.filter(f).length;
	const allMoras = rows.flatMap((r) => r.moras);

	say(`## ${title}`);
	say();
	if (detail) {
		say(
			"| 曲 | 層 | 音符 | 句 | 文 | モーラ/句 p25/50/75 | 1音符1モーラ | 伸ばし | かな | を | は | 句の重複 | 連続 | 反復の単位 |",
		);
		say(
			"| :-- | --: | --: | --: | --: | :-- | --: | --: | --: | --: | --: | --: | --: | --: |",
		);
		for (const r of rows)
			say(
				`| ${r.key} | ${r.parts} | ${r.notes} | ${r.phrases} | ${r.sentences} | ${quantile(r.moras, 0.25)}/${quantile(r.moras, 0.5)}/${quantile(r.moras, 0.75)} | ${r.oneMora.toFixed(0)}% | ${r.tie.toFixed(0)}% | ${r.hira.toFixed(0)}% | ${r.wo} | ${r.ha} | ${r.repeat.toFixed(0)}% | ${r.maxRun} | ${r.maxBlock}句 |`,
			);
		say();
	}
	say(`${n}曲の中央値:`);
	say();
	say(
		`- 音符: ${med((r) => r.notes)}　句: ${med((r) => r.phrases)}　文: ${med((r) => r.sentences)}`,
	);
	say(
		`- モーラ/句（全曲の句をまとめた分布）: p10 ${quantile(allMoras, 0.1)} / p25 ${quantile(allMoras, 0.25)} / p50 ${quantile(allMoras, 0.5)} / p75 ${quantile(allMoras, 0.75)} / p90 ${quantile(allMoras, 0.9)}（${allMoras.length}句）`,
	);
	say(
		`- 1音符1モーラ: ${med((r) => r.oneMora)}%　伸ばし: ${med((r) => r.tie)}%（${songsWith((r) => r.tie <= 2)}/${n}曲が2%以下）`,
	);
	say(
		`- ひらがな: ${med((r) => r.hira)}%　カタカナ: ${med((r) => r.kata)}%　漢字: ${med((r) => r.kanji)}%（${songsWith((r) => r.hira >= 99)}/${n}曲がかな99%以上）`,
	);
	say(
		`- 助詞「を」: ${songsWith((r) => r.wo > 0)}/${n}曲が1回以上書く（中央値 ${med((r) => r.wo)}回）　「は」: 中央値 ${med((r) => r.ha)}回`,
	);
	say(
		`- 句の重複: ${med((r) => r.repeat)}%　同じ句の連続: 中央値 ${med((r) => r.maxRun)}回（最大 ${Math.max(...rows.map((r) => r.maxRun))}回）　まとまりごとの反復: 中央値 ${med((r) => r.maxBlock)}句（最大 ${Math.max(...rows.map((r) => r.maxBlock))}句）`,
	);
	say();
	const vowelSum = (pick: (r: Row) => VowelCount): VowelCount => {
		const out: VowelCount = {};
		for (const r of rows)
			for (const [k, v] of Object.entries(pick(r))) out[k] = (out[k] ?? 0) + v;
		return out;
	};
	const allV = vowelSum((r) => r.vowelsAll);
	const longV = vowelSum((r) => r.vowelsLong);
	const total = (o: VowelCount): number =>
		Object.values(o).reduce((a, b) => a + b, 0);
	say(
		`母音（全 ${total(allV)}音 / 4分以上 ${total(longV)}音）: ${VOWEL_KEYS.map(
			(v) =>
				`${v} ${pct(allV[v] ?? 0, total(allV)).toFixed(0)}→${pct(longV[v] ?? 0, total(longV)).toFixed(0)}%`,
		).join("  ")}`,
	);
	const withRuns = rows.filter((r) => r.title.runs > 0);
	say(
		`曲名のかなの連が歌詞に出る: ${withRuns.filter((r) => r.title.hits > 0).length}/${withRuns.length}曲（連のある曲だけ）`,
	);
	say();
	say("句末の形（文の単位＝4分以上の休符で切る）:");
	say();
	say("| 形 | 出た曲数 | 文の数 | 全文に対する割合 |");
	say("| :-- | --: | --: | --: |");
	const totalSentences = rows.reduce((a, r) => a + r.sentences, 0);
	let classified = 0;
	for (const [label] of ENDINGS) {
		const songsHit = songsWith((r) => (r.endings.get(label) ?? 0) > 0);
		const hits = rows.reduce((a, r) => a + (r.endings.get(label) ?? 0), 0);
		classified += hits;
		say(
			`| ${label} | ${songsHit}/${n} | ${hits} | ${pct(hits, totalSentences).toFixed(0)}% |`,
		);
	}
	say(
		`| 上のどれでもない（名詞止め・助詞止め・母音止め） | - | ${totalSentences - classified} | ${pct(totalSentences - classified, totalSentences).toFixed(0)}% |`,
	);
	say();
	const repeated = rows.flatMap((r) => r.repeatedMoras);
	const once = rows.flatMap((r) => r.onceMoras);
	say(
		`反復する句 ${repeated.length}句（中央 ${quantile(repeated, 0.5)}・p25/75 ${quantile(repeated, 0.25)}/${quantile(repeated, 0.75)}） / 1回だけの句 ${once.length}句（中央 ${quantile(once, 0.5)}・p25/75 ${quantile(once, 0.25)}/${quantile(once, 0.75)}）`,
	);
	const endShare = (pick: (r: Row) => Map<string, number>): string => {
		const sum = new Map<string, number>();
		for (const r of rows)
			for (const [k, v] of pick(r)) sum.set(k, (sum.get(k) ?? 0) + v);
		const total = [...sum.values()].reduce((a, b) => a + b, 0);
		return [...sum]
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `${k} ${pct(v, total).toFixed(0)}%`)
			.join(" / ");
	};
	say(`　反復する句の句末: ${endShare((r) => r.repeatedEnds)}`);
	say(`　1回だけの句の句末: ${endShare((r) => r.onceEnds)}`);
	const multi = rows.filter((r) => r.layers.length >= 2);
	if (multi.length)
		say(
			`層が2つ以上の曲 ${multi.length}: ${multi
				.map(
					(r) =>
						`${r.key.split("/").pop()}（${r.layers
							.map((l) => `${l.notes}音${Math.round(l.overlap * 100)}%`)
							.join(" ")}）`,
				)
				.join("  ")}`,
		);
	say();
	say("語彙のまとまり（曲をまたいで出るか）:");
	say();
	say("| まとまり | 出た曲数 | 出現数 |");
	say("| :-- | --: | --: |");
	for (const [label] of VOCAB) {
		const songsHit = songsWith((r) => (r.vocab.get(label) ?? 0) > 0);
		const hits = rows.reduce((a, r) => a + (r.vocab.get(label) ?? 0), 0);
		say(`| ${label} | ${songsHit}/${n} | ${hits} |`);
	}
	say();
};

say("# 歌詞の実測");
say();
say(
	"句は休符で切った単位、文は4分以上の休符で切った単位。語彙は部分一致で数えている（同じ綴りの別語も入る）ので、曲数の裏づけにだけ使う。",
);
say();
if (dir) {
	const rows = corpusRows(dir);
	report(
		`耳コピ（UST ${rows.reduce((a, r) => a + r.files, 0)}ファイル / ${rows.length}曲）`,
		rows,
		true,
	);
}
if (generate) {
	const count = Number(argOf("--count") ?? 20);
	const seed = Number(argOf("--seed") ?? 1);
	report(
		`自動作曲の仮歌詞（${generate} / 種 ${seed}〜 / ${count}曲）`,
		generatedRows(generate, count, seed),
		false,
	);
}

const out = argOf("--md");
if (out) {
	writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
	console.log(`\n→ ${out}`);
}
