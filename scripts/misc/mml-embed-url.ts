/**
 * MML → 公開デモの埋め込み URL。作曲結果や手書きの .mml を、再生専用プレイヤーで聴ける URL にする。
 *
 *   npx tsx scripts/misc/mml-embed-url.ts <file.mml> [...] [--json out.json]
 *
 * 形式は demo/embed.html の `decodeMml` が読む "g.<gzip+base64url>"（曲データは location.hash に載るので
 * サーバへ送られず、長さの制限も緩い）。編集画面（demo/#g...）の URL も出す。
 * MIDI から作るときは scripts/transcribe/midi-to-embed.ts。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { gzipSync } from "node:zlib";

const SITE = "https://onjmin.github.io/dtm/demo/";
const argv = process.argv.slice(2);
const jsonIdx = argv.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : undefined;
const files = argv.filter((a, i) => !a.startsWith("--") && (jsonIdx < 0 || i !== jsonIdx + 1));
if (files.length === 0) throw new Error(".mml ファイルを1つ以上渡してください");

const toBase64Url = (b: Buffer): string =>
	b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const rows = files.map((file) => {
	const mml = readFileSync(file, "utf8");
	const payload = `g.${toBase64Url(gzipSync(Buffer.from(mml, "utf8"), { level: 9 }))}`;
	return { name: basename(file, ".mml"), file, embed: `${SITE}embed.html#${payload}`, edit: `${SITE}#${payload}` };
});
for (const r of rows) console.log(`| ${r.name} | ${r.embed.length} 文字 | ${r.embed.slice(0, 70)}... |`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1), "utf8");
