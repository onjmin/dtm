/**
 * `src/version.ts` と `package.json` のバージョンが一致するかを検算する。
 *
 * 書き出す MML と MIDI には {@link DTM_VERSION} を埋めてある。これが
 * `package.json` とずれていると、**手元のファイルから素材の由来を引けなくなる**
 * （`docs/dataset-provenance.md` は package.json のバージョンで引く台帳なので）。
 *
 * ブラウザ向けのバンドルに `package.json` を読ませたくないので定数で二重に
 * 持っている。二重管理そのものは避けられないが、ずれたまま気付かないのは避けられる。
 */

import { readFileSync } from "node:fs";
import { DTM_VERSION } from "../src/version";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};

console.log("● バージョンの一致");
if (pkg.version !== DTM_VERSION) {
	console.error(
		`  ✗ package.json は ${pkg.version} だが src/version.ts は ${DTM_VERSION}`,
	);
	console.error("    src/version.ts の DTM_VERSION を合わせること。");
	process.exit(1);
}
console.log(`  ${DTM_VERSION} で一致`);
