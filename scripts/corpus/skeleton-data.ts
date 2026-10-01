/**
 * 骨格データ（`src/compose/compose-skeletons.ts`）を、あれば読む。
 *
 * このファイルは耳コピ MIDI から `extract-skeletons.ts` が生成するもので、**git にもバンドルにも入れない**
 * （他人の曲の和音・ベース・構成をそのまま持つ）。手元に無いときは空配列を返し、骨格借用を使う検査や
 * 書き出しは skip する。
 *
 *   npx tsx scripts/corpus/extract-skeletons.ts --dir "<耳コピ MIDI のフォルダ>" --out src/compose/compose-skeletons.ts
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type Skeleton,
	usableSkeletons,
} from "../../src/compose/skeleton-types";

const FILE = join(__dirname, "../../src/compose/compose-skeletons.ts");

export const loadSkeletons = (): Skeleton[] => {
	if (!existsSync(FILE)) return [];
	// 静的 import にすると無いときに読み込み自体が失敗する。tsx は CJS 側で require を通す。
	return (require(FILE) as { KAIWAI_SKELETONS: Skeleton[] }).KAIWAI_SKELETONS;
};

/**
 * 抽象骨格バンク（`build-section-bank.ts`）の `src` 番号の順。使える骨格を id 順に並べた添字が `src`。
 * 近さの検査（`check-splice-closeness.ts`）も同じ順で元曲を引く。
 */
export const bankSourceOrder = (skeletons: Skeleton[]): Skeleton[] =>
	usableSkeletons(skeletons).sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	);
