// 録音と聴き返しの手元用サーバー（127.0.0.1 だけで待つ）。
//   /            録音ページ（rec.html）。?song=<曲名> でその曲の daw.json を DAW へ書き込む
//   /distrec/    録音用の dist の写し（make-dist-rec.mjs で作る）
//   /songs/      SPEECH_OUT_DIR の中身（daw.json・wav。Range に応えるので再生位置を動かせる）
//   /shelf/      聴き返しページ（shelf_build.py が SPEECH_OUT_DIR/shelf/ に書き出す）
//   POST /save?song=<曲名>&name=<ファイル名>  受け取った本文をその曲のフォルダへ保存する
// node scripts/speech-melody/rec/server.mjs
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "..", "..", "..");
// config.py と同じく、環境変数が無ければリポジトリ直下の .env の SPEECH_* を読む
const env = { ...process.env };
if (existsSync(join(repo, ".env"))) {
	for (const line of readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)) {
		const m = /^\s*(SPEECH_\w+)\s*=\s*(.*?)\s*$/.exec(line);
		if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}
const outDir = normalize(env.SPEECH_OUT_DIR || join(repo, "scratch", "speech-songs"));
const port = Number(process.env.PORT ?? 40321);
const TYPES = {
	".mjs": "text/javascript", ".js": "text/javascript", ".html": "text/html; charset=utf-8", ".wasm": "application/wasm",
	".json": "application/json", ".wav": "audio/wav",
};
const safe = (s) => (s ?? "").replace(/[^\w.-]/g, "_");
const inside = (root, p) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

const send = (req, res, file) => {
	const size = statSync(file).size;
	const type = TYPES[extname(file)] ?? "application/octet-stream";
	const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
	if (m) {
		const start = m[1] ? Number(m[1]) : size - Number(m[2]);
		const end = m[1] && m[2] ? Number(m[2]) : size - 1;
		res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
		createReadStream(file, { start, end }).pipe(res);
		return;
	}
	res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
	createReadStream(file).pipe(res);
};

createServer((req, res) => {
	const url = new URL(req.url, "http://x");
	const path = decodeURIComponent(url.pathname);
	if (req.method === "POST" && path === "/save") {
		const song = safe(url.searchParams.get("song"));
		const name = safe(url.searchParams.get("name") ?? "out.bin");
		if (!song) return res.writeHead(400).end("song がない");
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			mkdirSync(join(outDir, song), { recursive: true });
			writeFileSync(join(outDir, song, name), Buffer.concat(chunks));
			res.writeHead(200).end("ok");
		});
		return;
	}
	if (req.method === "POST" && path === "/done") {
		const song = safe(url.searchParams.get("song"));
		console.log(`[REC DONE] for song: ${song}`);
		res.writeHead(200).end("done");
		return;
	}
	let file;
	let root = here;
	if (path === "/" || path === "/rec.html") file = join(here, "rec.html");
	else if (path.startsWith("/distrec/")) file = normalize(join(here, "dist-rec", path.slice(9)));
	else if (path.startsWith("/songs/")) [root, file] = [outDir, normalize(join(outDir, path.slice(7)))];
	else if (path.startsWith("/shelf/")) [root, file] = [outDir, normalize(join(outDir, path.slice(1)))];
	else if (path.startsWith("/") && /^\/[^/]+\/(song|voice)\.wav$/.test(path)) [root, file] = [outDir, normalize(join(outDir, path.slice(1)))]; // 棚の ../<曲>/song.wav
	if (!file || !inside(root, file) || !existsSync(file) || !statSync(file).isFile()) {
		if (path.startsWith("/distrec/")) return res.writeHead(404).end("dist-rec が無い: node scripts/speech-melody/rec/make-dist-rec.mjs");
		return res.writeHead(404).end();
	}
	send(req, res, file);
}).listen(port, "127.0.0.1", () => console.log(`rec http://localhost:${port}/?song=<曲名>  shelf http://localhost:${port}/shelf/index.html  (${outDir})`));
