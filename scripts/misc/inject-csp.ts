/**
 * 公開デモの HTML へ CSP の <meta> を差し込む（gh-pages.yml がデプロイ時に呼ぶ）。
 * インライン <script> は本文の sha256 で許す。本文が変わると外れるので demo/*.html 本体には入れない。
 * 既存の CSP <meta> は置き換える（何度かけてもよい）。
 *
 *   pnpm exec tsx scripts/misc/inject-csp.ts docs/demo/*.html
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

// 共有リンクの #audio= や自前の歌声音源は任意の https を指せるので、connect/media は https: を広く許す。
// https://onjmin.github.io は本番では 'self' と同じ。localhost で確かめるときも koe の資材が読めるよう明示する。
const POLICY: [string, ...string[]][] = [
	["default-src", "'self'"],
	[
		"script-src",
		"'self'",
		"'wasm-unsafe-eval'",
		"https://onjmin.github.io",
		"https://www.googletagmanager.com",
		"https://cdn.jsdelivr.net",
		"https://surikov.github.io",
		"https://www.youtube.com",
		"https://s.ytimg.com",
	],
	["connect-src", "'self'", "https:", "blob:", "data:"],
	["img-src", "'self'", "https:", "data:", "blob:"],
	["media-src", "'self'", "https:", "blob:", "data:"],
	["font-src", "'self'", "https://db.onlinewebfonts.com", "data:"],
	["style-src", "'self'", "'unsafe-inline'"],
	["frame-src", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
	["worker-src", "'self'", "blob:"],
	["object-src", "'none'"],
	["base-uri", "'none'"],
	["form-action", "'none'"],
];

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const CSP_META_RE =
	/[ \t]*<meta\s[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>[ \t]*\r?\n?/gi;

const inlineScriptHashes = (html: string): string[] => {
	const hashes = new Set<string>();
	for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
		if (/\ssrc\s*=/i.test(` ${attrs}`)) continue;
		// JSON-LD は実行されないので許可リストに載せない
		if (/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) continue;
		// ブラウザは改行を LF にそろえてからハッシュを取る（CRLF の作業コピーでも一致させる）
		const text = body.replace(/\r\n?/g, "\n");
		const digest = createHash("sha256").update(text, "utf8").digest("base64");
		hashes.add(`'sha256-${digest}'`);
	}
	return [...hashes];
};

const buildPolicy = (hashes: string[]): string =>
	POLICY.map(([name, ...values]) =>
		[name, ...values, ...(name === "script-src" ? hashes : [])].join(" "),
	).join("; ");

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error("usage: tsx scripts/misc/inject-csp.ts <file.html>...");
	process.exit(1);
}

for (const file of files) {
	const original = readFileSync(file, "utf8");
	const html = original.replace(CSP_META_RE, "");
	const head = /<head\b[^>]*>/i.exec(html);
	if (!head) {
		console.error(`  ✗ ${file}: <head> が見つからない`);
		process.exit(1);
	}
	const policy = buildPolicy(inlineScriptHashes(html));
	const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
	// <meta charset> は先頭 1024 バイト以内に要るので、あればその直後、なければ <head> の直後へ
	let at = head.index + head[0].length;
	const charset = /^\s*<meta\s+charset\s*=[^>]*>/i.exec(html.slice(at));
	if (charset) at += charset[0].length;
	const eol = original.includes("\r\n") ? "\r\n" : "\n";
	writeFileSync(file, `${html.slice(0, at)}${eol}    ${meta}${html.slice(at)}`);
	console.log(`  ${file}: ${policy}`);
}
