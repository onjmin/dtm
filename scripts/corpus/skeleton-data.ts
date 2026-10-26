/**
 * 骨格データ（`src/compose/compose-skeletons.ts`）を、あれば読む。
 *
 * このファイルは耳コピ MIDI から生成したもので（抽出スクリプトは削除済み、git 履歴にある）、**git にもバンドルにも入れない**
 * （他人の曲の和音・ベース・構成をそのまま持つ）。手元に無いときは空配列を返し、骨格借用を使う検査や
 * 書き出しは skip する。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CorpusPhrase } from "../../src/compose/phrase-types";
import type {
	BankForm,
	BankSection,
	SectionBank,
} from "../../src/compose/section-bank-types";
import type { Skeleton } from "../../src/compose/skeleton-types";

const FILE = join(__dirname, "../../src/compose/compose-skeletons.ts");

export const loadSkeletons = (): Skeleton[] => {
	if (!existsSync(FILE)) return [];
	// 静的 import にすると無いときに読み込み自体が失敗する。tsx は CJS 側で require を通す。
	return (require(FILE) as { KAIWAI_SKELETONS: Skeleton[] }).KAIWAI_SKELETONS;
};

const PHRASES_FILE = join(__dirname, "../../src/compose/compose-phrases.ts");
const SECTION_BANK_FILE = join(
	__dirname,
	"../../src/compose/compose-section-bank.ts",
);

/**
 * 耳コピから抜いたフレーズ集（生成スクリプトは削除済み。git にもバンドルにも入れない）。
 * 骨格借用・継ぎ合わせの実験に options.phrases で渡す。無ければ undefined（生成側は SYNTH_PHRASES）。
 */
export const loadCorpusPhrases = (): CorpusPhrase[] | undefined =>
	existsSync(PHRASES_FILE)
		? (require(PHRASES_FILE) as { CORPUS_PHRASES: CorpusPhrase[] })
				.CORPUS_PHRASES
		: undefined;

/** 継ぎ合わせのバンク（生成スクリプトは削除済み。git にもバンドルにも入れない）。無ければ undefined。 */
export const loadSectionBank = (): SectionBank | undefined => {
	if (!existsSync(SECTION_BANK_FILE)) return undefined;
	const m = require(SECTION_BANK_FILE) as {
		FORM_BANK: BankForm[];
		SECTION_BANK: BankSection[];
	};
	return { forms: m.FORM_BANK, sections: m.SECTION_BANK };
};

/** 実験用テンプレート（骨格借用・継ぎ合わせ）へ渡す手元データ一式。composeSong の options に広げる。 */
export const localExperimentData = (): {
	phrases?: CorpusPhrase[];
	sectionBank?: SectionBank;
} => ({ phrases: loadCorpusPhrases(), sectionBank: loadSectionBank() });
