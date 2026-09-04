/**
 * **自動生成ファイル。手で編集しないこと。**
 *
 *   npx tsx scripts/calibrate-corpus.ts --dir <MIDIのフォルダ>
 *   npx tsx scripts/calibrate-corpus.ts --api --limit 200
 *
 * 人間が書いた曲 180本 から `src/compose-metrics.ts` と同じ指標を抽出し、
 * その分布の中央50%（p25〜p75）を満点、p05〜p95 の外側を0点とする目標帯にしたもの。
 * 手で決めた定数の代わりにこれを使うことで、受け入れ基準が
 * 「勘で決めた代理指標」から「人間の曲から採った代理指標」になる。
 *
 * コーパスを増やして測り直したら、このファイルごと差し替える。
 */

import type { Band } from "./compose-metrics";

/** 較正に使った曲数。少ないほど帯が狭く・偏る点に注意。 */
export const CORPUS_SIZE = 180;

export const CORPUS_BANDS = {
	entropy: [0, 0.999, 2.056, 2.546] as Band,
	valueKinds: [1, 3, 8, 13] as Band,
	restRatio: [0, 0.139, 0.588, 0.97] as Band,
	leapRatio: [0.104, 0.404, 0.551, 0.96] as Band,
	maxLeap: [9, 12, 17, 19] as Band,
	melodyRange: [14, 16, 27, 37] as Band,
	sim1: [0.176, 0.411, 0.704, 0.934] as Band,
	sim2: [0.137, 0.448, 0.846, 0.968] as Band,
	sim4: [0.139, 0.544, 0.885, 1] as Band,
	sim8: [0, 0.393, 0.92, 1] as Band,
	phraseBreath: [0.053, 0.239, 0.769, 1] as Band,
	climaxPosition: [0.058, 0.199, 0.715, 0.998] as Band,
	climaxPeaks: [1, 4, 13, 26] as Band,
	complementarity: [0, 0, 0.367, 0.733] as Band,
} satisfies Record<string, Band>;
