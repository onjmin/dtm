/**
 * MML → 公開デモの URL（再生専用プレイヤーと編集画面）。`mml-embed-url.ts` と `song-shelf.ts` が使う。
 *
 * 形式は demo/embed.html の `decodeMml` が読む "g.<gzip+base64url>"（曲データは location.hash に載るので
 * サーバへ送られず、長さの制限も緩い）。
 */

import { gzipSync } from "node:zlib";

export const DEMO_SITE = "https://onjmin.github.io/dtm/demo/";

const toBase64Url = (b: Buffer): string =>
	b
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export const mmlShareUrls = (mml: string): { embed: string; edit: string } => {
	const payload = `g.${toBase64Url(gzipSync(Buffer.from(mml, "utf8"), { level: 9 }))}`;
	return {
		embed: `${DEMO_SITE}embed.html#${payload}`,
		edit: `${DEMO_SITE}#${payload}`,
	};
};
