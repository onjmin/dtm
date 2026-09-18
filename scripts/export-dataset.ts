/**
 * **学習用のデータセットを書き出す。**
 *
 *   npx tsx scripts/export-dataset.ts --dir <MIDIのフォルダ> [--out tmp/dataset.jsonl]
 *
 * ## 何のためか
 *
 * 旋律の「並び順」を学習するモデルを外（Python 側）で作るための入り口。
 * リポジトリ本体はブラウザ向けの TypeScript なのでモデルは載せない。**オフラインで
 * 大量に生成して、通ったものをデータとして同梱する**——今の {@link file://../src/compose-phrases.ts}
 * と同じ形で、素材が「実在した2小節」から「学習した任意長の旋律」に変わるだけ。
 *
 * ## なぜこの形式か
 *
 * **トークン化はここでやらない。** 何を1トークンにするか（音高だけ／音価と組／
 * 拍内位置を別トークンに）はモデルの設計事項で、ここで決めると後から変えられない。
 * 素の事実だけを JSONL で出して、切り方は読む側に任せる。
 *
 * 1行1曲。`notes` は主旋律だけ（{@link isPlausibleMelody} を通り、鳴っている時間が
 * 最長のチャンネル。選び方を間違えるとハモリや対旋律の統計を学ぶことになる——
 * `calibrate-corpus.ts` の主旋律選択に理由がある）。
 *
 * - `at` … 曲頭からのステップ（1小節=192）。主旋律が歌い始める小節を0に詰めてある
 * - `dur` … 音価（ステップ）
 * - `semi` … MIDIノート番号
 * - `deg` … 主音からの音階度数（7度＝1オクターブ）。調に依存しない形
 *
 * `source` を残すのは**出自を追えるようにするため**。学習物の由来が問題になったとき、
 * どの曲から来たかを辿れないデータは捨てるしかなくなる。
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
	channelNotes,
	estimateKey,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";
import { toDegree } from "./calibrate-phrases";

const STEPS_PER_BAR = 192;

/**
 * .mid を再帰的に集める。`collectFromDir` と違って**パスも返す**——学習物の出自を
 * 追えないデータは、由来が問題になった時点で捨てるしかなくなる。
 */
function* collectWithPaths(
	root: string,
	dir = root,
): Generator<{ path: string; buf: Buffer }> {
	// **ジェネレータにする。** 配列に貯めて `push(...再帰結果)` で繋いでいた頃は、
	// 25万件のコーパスで `Maximum call stack size exceeded` になった（spread は
	// 要素を引数として展開するので、引数の数の上限に当たる）。
	// 1件ずつ返せば、`--limit` で打ち切ったぶんはファイルを読みにも行かない。
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) yield* collectWithPaths(root, full);
		else if (entry.name.toLowerCase().endsWith(".mid"))
			yield {
				path: relative(root, full).split("\\").join("/"),
				buf: readFileSync(full),
			};
	}
}

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

type DatasetSong = {
	source: string;
	tonic: number;
	minor: boolean;
	bars: number;
	notes: { at: number; dur: number; semi: number; deg: number }[];
};

const main = (): void => {
	const dir = argOf("--dir");
	if (!dir) {
		console.error("--dir <MIDIのフォルダ> が要ります");
		process.exit(1);
	}
	const out = argOf("--out") ?? "tmp/dataset.jsonl";
	// **標本数の上限。** 25万曲のコーパスを丸ごと通すと数時間かかる。作風を
	// 比べたいだけのときは一部で足りるので、先頭から打ち切れるようにしておく。
	const limit = Number(argOf("--limit") ?? 0) || Number.POSITIVE_INFINITY;
	mkdirSync(dirname(out), { recursive: true });

	// **除外リスト。** パブリックドメインの申告が誤っていたと分かったファイルを
	// 外すための口（`docs/dataset-provenance.md` の是正手順）。外部コーパスから
	// 素材を作る以上、あとから「あれは違った」が起きうる前提で作っておく。
	const excludePath = argOf("--exclude") ?? "tools/melody-model/exclude.txt";
	const excluded = new Set<string>();
	try {
		for (const line of readFileSync(excludePath, "utf8").split(/\r?\n/)) {
			const t = line.trim();
			if (t && !t.startsWith("#")) excluded.add(t);
		}
	} catch {
		// 無ければ何も外さない。
	}
	if (excluded.size > 0) console.log(`  除外リスト ${excluded.size} 件`);

	const songs: DatasetSong[] = [];
	let skipped = 0;

	for (const { path, buf } of collectWithPaths(dir)) {
		if (songs.length >= limit) break;
		if (excluded.has(path)) continue;
		// 主旋律 = 条件を満たすチャンネルのうち、鳴っている時間が最長のもの。
		let melody: ReturnType<typeof quantize> | null = null;
		let bestCoverage = -1;
		try {
			for (const ns of channelNotes(parseSmf(buf)).values()) {
				if (!isPlausibleMelody(ns)) continue;
				const coverage = ns.reduce((sum, n) => sum + n.durationSteps, 0);
				if (coverage <= bestCoverage) continue;
				bestCoverage = coverage;
				melody = quantize(toMonophonic(ns));
			}
		} catch {
			skipped++;
			continue;
		}
		if (!melody || melody.length < 40) {
			skipped++;
			continue;
		}

		const { tonic, minor } = estimateKey(melody);
		// 主旋律が歌い始める小節を0に詰める。イントロの長さを学習させない。
		const offset =
			Math.floor(melody[0].startStep / STEPS_PER_BAR) * STEPS_PER_BAR;
		const notes = melody.map((n) => ({
			at: n.startStep - offset,
			dur: n.durationSteps,
			semi: Math.round(n.pitchSemi),
			deg: toDegree(Math.round(n.pitchSemi) - tonic, minor),
		}));
		const end = Math.max(...notes.map((n) => n.at + n.dur));
		songs.push({
			source: path,
			tonic,
			minor,
			bars: Math.ceil(end / STEPS_PER_BAR),
			notes,
		});
	}

	writeFileSync(
		out,
		`${songs.map((s) => JSON.stringify(s)).join("\n")}\n`,
		"utf8",
	);

	const noteCounts = songs.map((s) => s.notes.length);
	const total = noteCounts.reduce((a, b) => a + b, 0);
	const q = (t: number): number => {
		const a = [...noteCounts].sort((x, y) => x - y);
		return a[Math.min(a.length - 1, Math.floor(a.length * t))];
	};
	console.log(`● 学習用データセットを書き出した: ${out}`);
	console.log(`  ${songs.length}曲 / 読めなかったもの ${skipped}件`);
	console.log(
		`  音数 合計 ${total} / 1曲あたり p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)}`,
	);
	console.log(
		`  短調 ${songs.filter((s) => s.minor).length}曲 / 長調 ${songs.filter((s) => !s.minor).length}曲`,
	);
};

main();
