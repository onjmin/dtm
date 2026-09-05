/**
 * 自動作曲のドラム編曲。16小節ぶんのドラムを、セクションに合わせて組み立てる。
 *
 * ## なぜ要るか
 *
 * 作曲マクロは長らく**ドラムに一切触っていなかった**。メロディ・サブメロ・ベース・伴奏の
 * ノートだけを書き、ドラムは既定の `dance`（1小節10ヒットのループ）が16小節そのまま
 * 鳴り続ける、という状態だった。
 *
 * 参考にした人間の曲13本を測ると、**全曲がドラムに2〜31種（平均5.9種）の小節パターンを
 * 持っている**。イントロ、サビ頭のクラッシュ、4小節ごとのフィル、セクションごとの
 * ハイハットの開け閉め——曲の「進行している感じ」の大半はここが作っている。
 * 同じ1小節を16回鳴らすと、上物が何をしていても打ち込みらしさが残る。
 *
 * ## 作り方
 *
 * 曲の骨格（A / A' / B / A''）に対して**強度**を割り当て、その強度でキック・スネア・
 * ハイハットの刻みを選び、4小節ごとの区切りにフィルを置く。フィルは毎回違う形を引く。
 *
 * ```
 *  1  2  3  4 |  5  6  7  8 |  9 10 11 12 | 13 14 15 16
 *  A（抑えめ）   A'（標準）     B（サビ・最大） A''（標準→締め）
 *  ↑クラッシュ                 ↑クラッシュ     ↑クラッシュ  ↑クラッシュ
 *           ↑フィル       ↑フィル       ↑フィル       ↑フィル
 * ```
 *
 * フィルは4小節の切れ目に置くが、**最終小節の1つ手前**にも置く。フィルは「次の小節へ
 * 入る助走」なので、次が無い16小節目に置いても行き場が無い。16小節目はクラッシュと
 * キックを1発ずつ置いて鳴らし切る。
 *
 * ## グリッド
 *
 * `shuffle` だけは**16分の格子から外れる**。1小節192ステップは3で割り切れるので、
 * 8分三連（16ステップ）でハネを表現できる。参考曲は平均24%の音が16分格子の外に
 * あり、生成物は0%だった——グルーヴを作るには格子から出る必要がある。
 */

import {
	DRUM_KEYS,
	type DrumPattern,
	type DrumPatternDef,
} from "./drum-config";
import type { SongDrumInstruction, SongDrumPattern } from "./song-drum-config";

/** 曲全体のドラムの性格。曲ごとに1つ引く。 */
export type DrumStyle =
	| "eight"
	| "sixteen"
	| "four"
	| "shuffle"
	| "ballad"
	| "rock";

export const DRUM_STYLE_LABELS: Record<DrumStyle, string> = {
	eight: "8ビート",
	sixteen: "16ビート",
	four: "4つ打ち",
	shuffle: "シャッフル",
	ballad: "バラード",
	rock: "ロック",
};

/** セクションの強度。0=抑えめ（A部） 1=標準（A'/A''） 2=最大（B部＝サビ）。 */
type Intensity = 0 | 1 | 2;

/**
 * 16分の格子インデックス（0〜15）で書いた刻み。実際のステップへは
 * {@link toStep} で写す。ステップ数を直接書くより、拍との対応が読める。
 */
type Grid = number[];

const KICKS: Record<DrumStyle, [Grid, Grid, Grid]> = {
	// [抑えめ, 標準, 最大]
	eight: [
		[0, 8],
		[0, 6, 8],
		[0, 6, 8, 14],
	],
	sixteen: [
		[0, 3, 8],
		[0, 3, 8, 11],
		[0, 3, 6, 8, 11, 14],
	],
	four: [
		[0, 4, 8, 12],
		[0, 4, 8, 12],
		[0, 4, 8, 12, 14],
	],
	shuffle: [
		[0, 8],
		[0, 8, 11],
		[0, 5, 8, 11],
	],
	ballad: [[0], [0, 8], [0, 8, 12]],
	rock: [
		[0, 8],
		[0, 3, 8],
		[0, 3, 8, 10, 14],
	],
};

const SNARES: Record<DrumStyle, [Grid, Grid, Grid]> = {
	eight: [
		[4, 12],
		[4, 12],
		[4, 12],
	],
	sixteen: [
		[4, 12],
		[4, 12],
		[4, 12],
	],
	four: [
		[4, 12],
		[4, 12],
		[4, 12],
	],
	shuffle: [
		[4, 12],
		[4, 12],
		[4, 12],
	],
	// バラードはサイドスティック（リムショット）から入って、盛り上がりでスネアへ移る。
	ballad: [[12], [4, 12], [4, 12]],
	rock: [
		[4, 12],
		[4, 12],
		[4, 12],
	],
};

/** ゴーストノート（弱く叩く裏のスネア）。密度を上げずにノリだけ足す。 */
const GHOSTS: Record<DrumStyle, Grid> = {
	eight: [7],
	sixteen: [7, 11, 15],
	four: [],
	shuffle: [11],
	ballad: [],
	rock: [7, 15],
};

const HIHATS: Record<DrumStyle, [Grid, Grid, Grid]> = {
	eight: [
		[0, 4, 8, 12],
		[0, 2, 4, 6, 8, 10, 12, 14],
		[0, 2, 4, 6, 8, 10, 12, 14],
	],
	sixteen: [
		[0, 2, 4, 6, 8, 10, 12, 14],
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
	],
	four: [
		[2, 6, 10, 14],
		[0, 2, 4, 6, 8, 10, 12, 14],
		[0, 2, 4, 6, 8, 10, 12, 14],
	],
	shuffle: [[], [], []], // 三連なので格子では書けない。{@link shuffleHats} が作る
	ballad: [
		[0, 8],
		[0, 4, 8, 12],
		[0, 2, 4, 6, 8, 10, 12, 14],
	],
	rock: [
		[0, 4, 8, 12],
		[0, 2, 4, 6, 8, 10, 12, 14],
		[0, 2, 4, 6, 8, 10, 12, 14],
	],
};

/**
 * フィルの型。4小節の切れ目に置く。**毎回違う形を引く**——同じフィルが4回出ると、
 * それ自体が「1小節ループ」と同じ単調さになる。
 * `[16分の位置, 太鼓]` の並びで、拍3〜4（8〜15）に置く。
 */
const FILLS: { grid: Grid; drums: number[] }[] = [
	// スネアの16分の詰め
	{
		grid: [12, 13, 14, 15],
		drums: [
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
		],
	},
	// タムで降りる
	{
		grid: [8, 10, 12, 14],
		drums: [
			DRUM_KEYS.highTom,
			DRUM_KEYS.highTom,
			DRUM_KEYS.lowMidTom,
			DRUM_KEYS.lowTom,
		],
	},
	// スネア → タム
	{
		grid: [8, 9, 10, 11, 12, 14],
		drums: [
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.highTom,
			DRUM_KEYS.highTom,
			DRUM_KEYS.lowMidTom,
			DRUM_KEYS.lowTom,
		],
	},
	// 短く締める
	{
		grid: [14, 15],
		drums: [DRUM_KEYS.acousticSnare, DRUM_KEYS.acousticSnare],
	},
	// 16分の連打から解放
	{
		grid: [8, 9, 10, 11, 12, 13, 14, 15],
		drums: [
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.acousticSnare,
			DRUM_KEYS.highTom,
			DRUM_KEYS.highTom,
			DRUM_KEYS.lowMidTom,
			DRUM_KEYS.lowTom,
		],
	},
	// 3連のタム回し（16分格子の外）
	{
		grid: [12, 13.33, 14.67],
		drums: [DRUM_KEYS.highTom, DRUM_KEYS.lowMidTom, DRUM_KEYS.lowTom],
	},
];

const pick = <T>(items: T[], rnd: () => number): T =>
	items[Math.floor(rnd() * items.length)];

export type ComposeDrumOptions = {
	/** 曲の長さ（小節）。 */
	bars: number;
	/** 1小節のステップ数。 */
	stepsPerBar: number;
	rnd: () => number;
	/** 曲の性格を外から決めたいとき（省略時はランダム）。 */
	style?: DrumStyle;
};

export type ComposedDrums = {
	style: DrumStyle;
	def: DrumPatternDef<SongDrumPattern>;
	/** 小節パターンの種類数。単調さの検算に使う。 */
	variety: number;
};

/**
 * シャッフルのハイハット。8分三連（1拍を3等分）の1つ目と3つ目を叩く、いわゆるハネ。
 * 1小節192ステップは3で割り切れるので、**16分の格子から外れた位置**に置ける。
 */
const shuffleHats = (stepsPerBar: number, level: Intensity): number[] => {
	const beat = stepsPerBar / 4;
	const triplet = beat / 3;
	const out: number[] = [];
	for (let b = 0; b < 4; b++) {
		out.push(b * beat);
		out.push(b * beat + triplet * 2);
		if (level === 2) out.push(b * beat + triplet); // サビは三連を埋める
	}
	return out;
};

export const composeDrumPattern = (
	options: ComposeDrumOptions,
): ComposedDrums => {
	const { bars, stepsPerBar, rnd } = options;
	const style =
		options.style ??
		pick<DrumStyle>(
			["eight", "sixteen", "four", "shuffle", "ballad", "rock"],
			rnd,
		);
	/** 16分の格子インデックス → ステップ。小数を許すのは3連のフィルのため。 */
	const toStep = (g: number): number =>
		Math.round((g * stepsPerBar) / 16) % stepsPerBar;

	// 曲ごとに引く要素。フィルは種類を2つ引いて交互に出す（4回とも同じにしない）。
	const fillA = pick(FILLS, rnd);
	const fillB = pick(
		FILLS.filter((f) => f !== fillA),
		rnd,
	);
	// 小節の最後の8分をオープンハイハットにするか（曲の癖）。
	const openTail = rnd() < 0.6;
	const useClap = style === "four" && rnd() < 0.5;

	const sectionLevel = (bar: number): Intensity => {
		if (bar <= 4) return 0; // A: 抑えめ
		if (bar <= 8) return 1; // A': 標準
		if (bar <= 12) return 2; // B: サビ
		return 1; // A'': 標準へ戻す
	};

	const barPatterns: DrumPattern[] = [];
	for (let bar = 1; bar <= bars; bar++) {
		const level = sectionLevel(bar);
		const isLast = bar === bars;
		// フィルは4小節の切れ目に置く。ただし**最終小節は例外で、1つ手前に置く**——
		// フィルは「次の小節へ入る助走」なので、次が無い小節に置くと行き場を失う。
		// 最終小節はクラッシュを叩いて鳴らし切る形にする。
		const isFill = !isLast && (bar % 4 === 0 || bar === bars - 1);
		const hits: DrumPattern = [];

		// --- クラッシュ（セクションの頭と、曲の締め） ---
		if (bar === 1 || bar === 9 || bar === 13 || isLast)
			hits.push({
				step: 0,
				pitch: DRUM_KEYS.crashCymbal1,
				velocity: bar === 9 || isLast ? 1 : 0.85,
			});

		// 最終小節はクラッシュとキックを1発だけ置いて鳴らし切る。刻み続けると
		// 「16小節目で唐突に切れた」だけになり、終わった感じが出ない。
		if (isLast) {
			hits.push({ step: 0, pitch: DRUM_KEYS.bassDrum1, velocity: 1 });
			hits.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
			barPatterns.push(hits);
			continue;
		}

		// --- キック ---
		for (const g of KICKS[style][level])
			hits.push({
				step: toStep(g),
				pitch: DRUM_KEYS.bassDrum1,
				velocity: g === 0 ? 1 : 0.88,
			});

		// --- スネア ---
		const snarePitch =
			style === "ballad" && level === 0
				? DRUM_KEYS.sideStick
				: DRUM_KEYS.acousticSnare;
		for (const g of SNARES[style][level]) {
			hits.push({ step: toStep(g), pitch: snarePitch, velocity: 0.95 });
			if (useClap)
				hits.push({
					step: toStep(g),
					pitch: DRUM_KEYS.handClap,
					velocity: 0.7,
				});
		}
		// ゴーストは盛り上がってから入れる。抑えめの小節に入れると密度が出すぎる。
		if (level >= 1)
			for (const g of GHOSTS[style])
				hits.push({
					step: toStep(g),
					pitch: DRUM_KEYS.acousticSnare,
					velocity: 0.3,
				});

		// --- ハイハット / ライド ---
		// フィルの小節は拍3〜4をフィルに明け渡すので、ハイハットは前半だけ残す。
		const hatSteps =
			style === "shuffle"
				? shuffleHats(stepsPerBar, level)
				: HIHATS[style][level].map(toStep);
		// サビはライドへ持ち替える（バラードは逆に抑えめの所でライド）。
		const hatPitch =
			level === 2 && style !== "four"
				? DRUM_KEYS.rideCymbal1
				: DRUM_KEYS.closedHihat;
		for (const step of hatSteps) {
			if (isFill && step >= stepsPerBar / 2) continue;
			const isDownbeat = step % (stepsPerBar / 4) === 0;
			// 小節末のオープンハイハットは「次の小節へ引っ張る」ための定番。
			const isTail = openTail && step === toStep(14) && !isFill;
			hits.push({
				step,
				pitch: isTail ? DRUM_KEYS.openHihat : hatPitch,
				velocity: isTail ? 0.8 : isDownbeat ? 0.75 : 0.5,
			});
		}

		// --- フィル ---
		if (isFill) {
			const fill = bar % 8 === 0 ? fillB : fillA;
			fill.grid.forEach((g, i) => {
				hits.push({
					step: toStep(g),
					pitch: fill.drums[i] ?? DRUM_KEYS.acousticSnare,
					// 追い込みで少しずつ強くする
					velocity: 0.7 + (0.28 * i) / Math.max(1, fill.grid.length - 1),
				});
			});
		}

		hits.sort((a, b) => a.step - b.step || a.pitch - b.pitch);
		barPatterns.push(hits);
	}

	// 同じ形が続く小節は ranges にまとめる（読める JSON にするため）。
	const pattern: SongDrumPattern = [];
	let runStart = 1;
	for (let bar = 1; bar <= bars; bar++) {
		const same =
			bar < bars &&
			JSON.stringify(barPatterns[bar]) === JSON.stringify(barPatterns[bar - 1]);
		if (same) continue;
		const instruction: SongDrumInstruction = {
			ranges: [[runStart, bar]],
			patternBars: 1,
			pattern: barPatterns[runStart - 1],
		};
		pattern.push(instruction);
		runStart = bar + 1;
	}

	const variety = new Set(barPatterns.map((p) => JSON.stringify(p))).size;
	return {
		style,
		variety,
		def: { label: `作曲（${DRUM_STYLE_LABELS[style]}）`, pattern },
	};
};
