/**
 * 伴奏主体モードのスタイルの登録表（`docs/accomp-style-engine.md` §2.2）。
 *
 * スタイルは `<id>.ts` に `StylePack`（§3.1、型は `./schema`）として書き、ここに並べる。エンジン
 * （`compose-accomp*.ts`）は `compose-accomp-style.ts` を通してスタイルを読む。`#compose` の書式
 * `style:<id>.v<version>:<baseKey>:<k>`（§2.5）は、この id と版から作る（`compose-accomp.ts` の
 * `formatAccompCompose`）。
 *
 * **スタイルを1つ足しても、エンジン・DAW・UI のコードは変えない**（§2.4・§7）。足すのはこの一覧の1行と
 * `<id>.ts`・`references/<id>/`・`scripts/fixtures/styles/<id>/`。
 *
 * **実行時の import を増やさないこと。** `compose-accomp.ts` から読むので、ここも Node から koe 無しで
 * 読めなければならない（`docs/accomp-compose.md` §4.2）。
 */

import { fb } from "./fb";
import type { StylePack } from "./schema";

export {
	ACCOMP_STYLE_ID_RE,
	ROLE_TAGS,
	validateStylePack,
} from "./schema";
export type {
	Archetype,
	LayerDef,
	Mix,
	PlanPins,
	Provenance,
	RoleDef,
	RoleTag,
	Row,
	StyleId,
	StylePack,
	W,
} from "./schema";

/** スタイルの見出し（DAW の選択肢と `#compose` が読む欄）。 */
export type AccompStyleInfo = Pick<
	StylePack,
	"id" | "version" | "label" | "description" | "provenance"
>;

/** 登録したスタイル。いまは fb だけ。 */
export const ACCOMP_STYLES: readonly StylePack[] = [fb];

/** `composeAccomp` で `style` を省いたときのスタイル（§2.2）。 */
export const DEFAULT_ACCOMP_STYLE: StylePack = fb;

/** id からスタイルを引く。無ければ undefined。 */
export const accompStyleById = (id: string): StylePack | undefined =>
	ACCOMP_STYLES.find((s) => s.id === id);
