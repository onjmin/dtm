/**
 * MML → 公開デモの埋め込み URL。作曲結果や手書きの .mml を、再生専用プレイヤーで聴ける URL にする。
 *
 *   npx tsx scripts/misc/mml-embed-url.ts <file.mml> [...] [--json out.json]
 *
 * 形式は embed-url.ts（demo/embed.html の `decodeMml` が読む "g.<gzip+base64url>"）。編集画面（demo/#g...）の URL も出す。
 * 作った曲を見返せるように残すなら scripts/misc/song-shelf.ts。MIDI から作るときは scripts/transcribe/midi-to-embed.ts。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { mmlShareUrls } from "./embed-url";

const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : undefined;
const files = argv.filter(
	(a, i) => !a.startsWith("--") && (jsonIdx < 0 || i !== jsonIdx + 1),
);
if (files.length === 0) throw new Error(".mml ファイルを1つ以上渡してください");

const rows = files.map((file) => ({
	name: basename(file, ".mml"),
	file,
	...mmlShareUrls(readFileSync(file, "utf8")),
}));
for (const r of rows)
	console.log(
		`| ${r.name} | ${r.embed.length} 文字 | ${r.embed.slice(0, 70)}... |`,
	);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1), "utf8");
