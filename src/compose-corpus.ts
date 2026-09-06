/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/calibrate-corpus.ts --dir <MIDIのフォルダ>
 *   npx tsx scripts/calibrate-corpus.ts --api --limit 200
 *
 * 人間が書いた曲 91本 から `src/compose-metrics.ts` と同じ指標を抽出し、
 * その分布の中央50%（p25〜p75）を満点、p05〜p95 の外側を0点とする目標帯にしたもの。
 * 手で決めた定数の代わりにこれを使うことで、受け入れ基準が
 * 「勘で決めた代理指標」から「人間の曲から採った代理指標」になる。
 *
 * コーパスを増やして測り直したら、このファイルごと差し替える。
 */

import type { Band } from "./compose-metrics";

/** 較正に使った曲数。少ないほど帯が狭く・偏る点に注意。 */
export const CORPUS_SIZE = 91;

export const CORPUS_BANDS = {
	entropy: [0.127, 0.621, 1.182, 1.754] as Band,
	valueKinds: [2, 3, 5.5, 7] as Band,
	restRatio: [0.009, 0.06, 0.167, 0.351] as Band,
	leapRatio: [0.255, 0.306, 0.653, 0.959] as Band,
	stepRatio: [0.023, 0.202, 0.61, 0.693] as Band,
	chromaticRatio: [0, 0.018, 0.121, 0.237] as Band,
	maxLeap: [6.5, 9, 15, 19] as Band,
	melodyRange: [11, 17, 24, 29.5] as Band,
	notesPerBar: [3.192, 5.043, 7.261, 11.995] as Band,
	shortNoteRatio: [0.428, 0.756, 0.957, 1] as Band,
	sim1: [0.362, 0.483, 0.709, 0.898] as Band,
	sim2: [0.397, 0.508, 0.781, 0.909] as Band,
	sim4: [0.437, 0.569, 0.786, 0.916] as Band,
	sim8: [0.063, 0.585, 0.784, 0.972] as Band,
	phraseBreath: [0, 0.058, 0.26, 0.884] as Band,
	climaxPosition: [0.026, 0.132, 0.625, 0.92] as Band,
	climaxPeaks: [1, 2, 14.5, 26] as Band,
	complementarity: [0, 0.013, 0.115, 0.388] as Band,
} satisfies Record<string, Band>;

/**
 * 同じ分布の中央値。**帯の内側で「人間の曲の真ん中に近いか」を見る**のに使う
 * （compose-metrics.ts の centeredBand）。周辺分布の帯だけだと、全項目が帯の端に
 * 同時に寄った曲も満点になってしまう。
 */
export const CORPUS_MEDIANS = {
	entropy: 0.898,
	valueKinds: 4,
	restRatio: 0.116,
	leapRatio: 0.391,
	stepRatio: 0.504,
	chromaticRatio: 0.06,
	maxLeap: 12,
	melodyRange: 21,
	notesPerBar: 5.898,
	shortNoteRatio: 0.842,
	sim1: 0.554,
	sim2: 0.575,
	sim4: 0.676,
	sim8: 0.699,
	phraseBreath: 0.167,
	climaxPosition: 0.273,
	climaxPeaks: 7,
	complementarity: 0.045,
} satisfies Record<keyof typeof CORPUS_BANDS, number>;
