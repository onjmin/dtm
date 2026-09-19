/**
 * `package.json` のバージョンを `src/version.ts` と `docs/dataset-provenance.md` へ写す。
 *
 * `pnpm version patch` は package.json しか上げない。埋め込む定数と台帳が置き去りに
 * なるのは 2.1.12 と 2.1.13 で二度起きていて（どちらも `check-version.ts` が
 * 弾いて発覚）、手順として覚えるのは無理筋なので `version` ライフサイクルから
 * 自動で呼ぶ（package.json の `scripts.version`）。手で実行してもよい。
 *
 * 台帳は「素材が変わっていない」前提で最終行の上限を伸ばすだけ。素材を差し替えた
 * ときは台帳に新しい行を**手で**足す（それはこのスクリプトには分からない）。
 */

import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};
const version = pkg.version;
const SEMVER = /\d+\.\d+\.\d+/g;

// src/version.ts
{
	const path = "src/version.ts";
	const src = readFileSync(path, "utf8");
	const next = src.replace(
		/export const DTM_VERSION = "[^"]+";/,
		`export const DTM_VERSION = "${version}";`,
	);
	if (next === src && !src.includes(`"${version}"`)) {
		console.error(`  ✗ ${path} に DTM_VERSION の定義が見つからない`);
		process.exit(1);
	}
	writeFileSync(path, next);
	console.log(`  ${path} → ${version}`);
}

// docs/dataset-provenance.md
{
	const path = "docs/dataset-provenance.md";
	const src = readFileSync(path, "utf8");
	const lines = src.split("\n");
	let lastLedgerRow = -1;
	const out = lines.map((line, i) => {
		// 「埋まる場所」の表: `#ver=x.y.z` / `dtm x.y.z`
		if (/^\| (MML|MIDI|MusicXML) \|/.test(line)) {
			return line.replace(SEMVER, version);
		}
		// 素材の表の「〜 x.y.z」行は最後の1行だけ上限を伸ばす
		if (/^\| 〜 \d+\.\d+\.\d+ \|/.test(line)) lastLedgerRow = i;
		return line;
	});
	if (lastLedgerRow >= 0) {
		out[lastLedgerRow] = out[lastLedgerRow].replace(
			/^\| 〜 \d+\.\d+\.\d+ \|/,
			`| 〜 ${version} |`,
		);
	}
	writeFileSync(path, out.join("\n"));
	console.log(`  ${path} → ${version}`);
}
