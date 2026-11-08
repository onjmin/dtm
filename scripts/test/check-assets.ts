/**
 * `assets/` に内蔵キャラ画像（直下の .png）以外が入っていないかを検算する。
 *
 * 動画の素材を dtm の `assets/` に置いてしまったことがある（海鬼月のドット絵）。
 * 素材は asset リポジトリ（`C:\_own\git\asset`、onjmin/asset）に置く。
 */

import { readdirSync } from "node:fs";

console.log("● assets/ の中身");
const bad = readdirSync("assets", { withFileTypes: true }).filter(
	(e) => !(e.isFile() && (e.name.endsWith(".png") || e.name === "README.md")),
);
if (bad.length > 0) {
	console.error(
		`  ✗ 内蔵キャラ画像ではない物がある: ${bad.map((e) => e.name).join(", ")}`,
	);
	console.error(
		"    素材は C:\\_own\\git\\asset（onjmin/asset）へ置くこと。assets/README.md を参照。",
	);
	process.exit(1);
}
console.log("  ✓ 直下の .png だけ");
