/**
 * **人間が書いた2小節フレーズを、そのまま素材として抜き出す。**
 *
 *   npx tsx scripts/calibrate-phrases.ts --dir <MIDIのフォルダ> [--out src/compose-phrases.ts]
 *
 * ## なぜ要るか
 *
 * 生成物と参考コーパスは、`compare-corpus.ts` の17指標も、**隣接音程のヒストグラムも**
 * ほぼ一致している（0度 16.5/14.1、2度 34.9/36.2 …）。反復はむしろ生成物の方が多い。
 * それでも耳で聴くと、コーパスは9割がキャッチーで生成物は1曲もそうではない。
 *
 * **分布が一致していて知覚が完全に分離するなら、差は分布ではなく並び順にある。**
 * 同じ音程ヒストグラムを持つ2つの列の一方が「曲」に、他方が「制約を満たしただけの
 * 音の列」になりうる。距離を目標にする方式ではこの情報は原理的に入らない。
 *
 * そこで、統計ではなく**実在したフレーズそのもの**を素材にする。リズムについては
 * 既に {@link file://../src/compose-corpus.ts} の `CORPUS_CELL_WEIGHTS` が出現頻度を
 * 取り込んでいたが、**音高の並びだけが取り込まれていなかった**。ここを同じ仕組みで埋める。
 *
 * ## 何を保存するか
 *
 * **リズムと音高を対にしたまま保存する。** 別々に持って後で掛け合わせると、
 * 「この並びがこのリズムに乗っている」という情報——まさに人間が選んだ部分——が消える。
 *
 * - `rhythm` … 2小節（384ステップ）ぶんの音価。正が音、負が休符。合計は必ず384。
 * - `degrees` … 各音の**音階度数**。フレーズの1音目を0とする相対値で、
 *   オクターブは7度＝1オクターブ。{@link MOTIF_ARCHETYPES} と同じ表現なので、
 *   曲の音階が5音でも7音でもそのまま「何歩動くか」として読める。
 *
 * 半音そのものではなく度数で持つのは、生成側が音階の度数で組み立てるため。
 * 調の外の音は最寄りの度数へ寄せる（後段の `applyChromatic` が戻す）。
 */

import { writeFileSync } from "node:fs";
import {
	channelNotes,
	collectFromDir,
	estimateKey,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";

const STEPS_PER_BAR = 192;
const WINDOW = STEPS_PER_BAR * 2;

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

/** 長調の音度（半音 → 度数）。調の外は最寄りの下の度数へ寄せる。 */
const MAJOR_PC_TO_DEGREE = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
/** 短調（自然的短音階）。 */
const MINOR_PC_TO_DEGREE = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];

/** 主音からの半音差を度数へ写す（オクターブは7度）。 */
export const toDegree = (
	semitonesFromTonic: number,
	minor: boolean,
): number => {
	const table = minor ? MINOR_PC_TO_DEGREE : MAJOR_PC_TO_DEGREE;
	const oct = Math.floor(semitonesFromTonic / 12);
	const pc = ((semitonesFromTonic % 12) + 12) % 12;
	return oct * 7 + table[pc];
};

export type CorpusPhrase = {
	rhythm: number[];
	degrees: number[];
	/** コーパスに何回現れたか。引くときの重みにする。 */
	weight: number;
};

/**
 * 素材として使える形かを見る。
 *
 * ここを緩めると、**採譜の都合でできた断片**（トラックの切れ目、ロングトーンだけの
 * 小節、装飾の連打）がバンクの大半を占める。フレーズとして成立する密度と幅だけ通す。
 */
const usable = (notes: number, degrees: number[]): boolean => {
	if (notes < 4 || notes > 18) return false;
	const lo = Math.min(...degrees);
	const hi = Math.max(...degrees);
	// 2小節で2オクターブ超えるものは、たいてい2声を1本に潰した誤検出。
	if (hi - lo > 12) return false;
	for (let i = 1; i < degrees.length; i++)
		if (Math.abs(degrees[i] - degrees[i - 1]) > 7) return false;
	// 全部同じ高さのものは輪郭を持たない（リズムは `CORPUS_CELL_WEIGHTS` の担当）。
	return hi !== lo;
};

const main = (): void => {
	const dir = argOf("--dir");
	if (!dir) {
		console.error("--dir <MIDIのフォルダ> が要ります");
		process.exit(1);
	}
	const out = argOf("--out") ?? "src/compose-phrases.ts";

	const found = new Map<string, CorpusPhrase>();
	let songs = 0;
	let windows = 0;

	for (const buf of collectFromDir(dir)) {
		// **主旋律は「鳴っている時間が最長」で選ぶ**——`calibrate-corpus.ts` と同じ規則。
		//
		// ここを**音数**で選んでいた間、短い単音リフや装飾線が主旋律として採られていた
		// （`チョウチン少女` は500音のイントロのリフが、448音の歌メロを押しのけていた）。
		// 統計を測るだけなら誤差で済むが、**フレーズバンクは音符列そのものを持ち出す**
		// ので、ここが外れるとバンクの中身が歌メロ以外で埋まる。
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
			continue;
		}
		if (!melody || melody.length < 40) continue;
		songs++;

		const { tonic, minor } = estimateKey(melody);
		const first = Math.floor(melody[0].startStep / WINDOW);
		const last = Math.floor(melody[melody.length - 1].startStep / WINDOW);

		for (let w = first; w <= last; w++) {
			const from = w * WINDOW;
			const ns = melody
				.filter((n) => n.startStep >= from && n.startStep < from + WINDOW)
				.sort((a, b) => a.startStep - b.startStep);
			if (ns.length === 0) continue;
			windows++;

			// 度数の並び。1音目を0にそろえる。
			const raw = ns.map((n) =>
				toDegree(Math.round(n.pitchSemi) - tonic, minor),
			);
			const degrees = raw.map((d) => d - raw[0]);
			if (!usable(ns.length, degrees)) continue;

			// リズム。音の前の空きは休符として入れ、末尾も2小節ぶんまで埋める。
			const rhythm: number[] = [];
			let cursor = 0;
			let ok = true;
			for (let i = 0; i < ns.length; i++) {
				const at = ns[i].startStep - from;
				if (at < cursor) {
					ok = false;
					break;
				}
				if (at > cursor) rhythm.push(-(at - cursor));
				// **次の音を越えて伸ばさない。** 採譜のレガートをそのまま持つと、
				// 音価の合計が2小節を超えて型として使えなくなる。
				const nextAt = i + 1 < ns.length ? ns[i + 1].startStep - from : WINDOW;
				const dur = Math.max(
					1,
					Math.min(ns[i].durationSteps, nextAt - at, WINDOW - at),
				);
				rhythm.push(dur);
				cursor = at + dur;
			}
			if (!ok) continue;
			if (cursor < WINDOW) rhythm.push(-(WINDOW - cursor));

			const total = rhythm.reduce((a, b) => a + Math.abs(b), 0);
			if (total !== WINDOW) continue;

			// **小節線で割れる形だけを通す。** 生成側のリズム型は1小節単位なので、
			// 小節をまたぐ音を持つフレーズはそのまま型にできない。ここで割ってしまうと
			// 打点が1つ増えて別のリズムになるので、通さずに落とす。
			// （小節をまたぐ「食い」は後段のシンコペーションタイが別に作る。）
			let acc = 0;
			let splits = false;
			for (const v of rhythm) {
				acc += Math.abs(v);
				if (acc === STEPS_PER_BAR) splits = true;
			}
			if (!splits) continue;

			const key = `${rhythm.join(",")}|${degrees.join(",")}`;
			const hit = found.get(key);
			if (hit) hit.weight++;
			else found.set(key, { rhythm, degrees, weight: 1 });
		}
	}

	const phrases = [...found.values()].sort((a, b) => b.weight - a.weight);

	const header = `/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/calibrate-phrases.ts --dir <MIDIのフォルダ>
 *
 * 人間が書いた曲から抜き出した**2小節フレーズ**のバンク。リズムと音高の並びを
 * 対にしたまま持つ（別々に持つと「この並びがこのリズムに乗っている」という、
 * まさに人間が選んだ情報が消える）。
 *
 * 生成側はここから素材を引いて、移調・和音合わせ・セクション展開に掛ける。
 * **統計を目標にするのをやめた理由**は {@link file://../scripts/calibrate-phrases.ts}
 * の冒頭にある。
 *
 * 抽出元: ${songs}本 / 2小節窓 ${windows} 個 → 使える形 ${phrases.length} 種
 */

/** 2小節（384ステップ）ぶんの素材。 */
export type CorpusPhrase = {
\t/** 音価。正が音、負が休符。合計は必ず384。 */
\trhythm: number[];
\t/** 各音の音階度数。1音目を0とする相対値で、7度＝1オクターブ。 */
\tdegrees: number[];
\t/** コーパスでの出現回数。引くときの重み。 */
\tweight: number;
};

/** 抽出に使った曲数。 */
export const PHRASE_CORPUS_SIZE = ${songs};

export const CORPUS_PHRASES: CorpusPhrase[] = [
`;

	const body = phrases
		.map(
			(p) =>
				`\t{ rhythm: [${p.rhythm.join(", ")}], degrees: [${p.degrees.join(", ")}], weight: ${p.weight} },`,
		)
		.join("\n");

	writeFileSync(out, `${header}${body}\n];\n`, "utf8");

	const noteCounts = phrases.map((p) => p.rhythm.filter((v) => v > 0).length);
	const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	console.log(`● フレーズバンクを書き出した: ${out}`);
	console.log(`  ${songs}本 / 2小節窓 ${windows} 個 → ${phrases.length} 種`);
	console.log(
		`  1フレーズの音数 平均 ${avg(noteCounts).toFixed(1)} / 出現2回以上 ${phrases.filter((p) => p.weight > 1).length} 種`,
	);
};

// 直接実行されたときだけ走らせる（`toDegree` などを import したいだけの
// スクリプトが、副作用でフレーズバンクを書き換えてしまわないように）。
// `calibrate-corpus.ts` と同じ形。
if (process.argv[1]?.includes("calibrate-phrases")) main();
