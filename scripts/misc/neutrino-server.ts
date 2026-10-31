/**
 * 手元の NEUTRINO を dtm から呼ぶための小さな中継サーバー（試作）。
 *
 *   npx tsx scripts/misc/neutrino-server.ts --neutrino <NEUTRINO のフォルダ> [--port 50022] [--cpu] [--allow-file-origin]
 *
 * NEUTRINO はコマンドラインで動くソフトなので、ブラウザからは直接呼べない。このサーバーが
 * MusicXML を受け取り、利用者が公式から入れた NEUTRINO（`bin/musicXMLtoLabel` と
 * `bin/neutrino`）を順に呼んで、出来た WAV を返す。dtm は NEUTRINO 本体も歌声ライブラリも
 * 同梱しない（規約の解釈は docs/research/neutrino-terms.md）。
 *
 * - 127.0.0.1 でだけ待ち受ける。手元で開いた dtm のページ（localhost・127.0.0.1・file:）
 *   以外の Origin からの呼び出しは断る（他のサイトから GPU を使われないように）。
 * - 合成は1件ずつ順に行う。
 *
 * API:
 *   GET  /version            → {"neutrino": "<フォルダ>", "gpu": true}
 *   GET  /singers            → [{"dir":"MERROW","name":"Merrow"}, ...]（model/ 以下）
 *   POST /sing?model=<dir>   本文 MusicXML → audio/wav
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const rootArg = opt("neutrino") ?? process.env.NEUTRINO_DIR;
const root = rootArg ? resolve(rootArg) : "";
/** 整数の引数。NaN・Infinity・範囲外は既定値に戻す。 */
const intArg = (
	name: string,
	def: number,
	min: number,
	max: number,
): number => {
	const v = Number(opt(name) ?? def);
	return Number.isInteger(v) && v >= min && v <= max ? v : def;
};
const port = intArg("port", 50022, 1024, 65535);
const useGpu = !args.includes("--cpu");
const threads = intArg("threads", 4, 1, 64);

if (
	!root ||
	!existsSync(join(root, "bin")) ||
	!existsSync(join(root, "model"))
) {
	console.error(
		"NEUTRINO のフォルダ（bin/ と model/ がある所）を --neutrino か環境変数 NEUTRINO_DIR で指定してください。",
	);
	process.exit(2);
}

const exe = (name: string): string =>
	join(root, "bin", process.platform === "win32" ? `${name}.exe` : name);
const MAX_BODY = 8 * 1024 * 1024;
const work = join(tmpdir(), "dtm-neutrino");
mkdirSync(work, { recursive: true });

/** model/ 以下の歌声ライブラリ（info.toml のある所）。 */
const listSingers = (): { dir: string; name: string }[] =>
	readdirSync(join(root, "model"), { withFileTypes: true })
		.filter(
			(d) =>
				d.isDirectory() && existsSync(join(root, "model", d.name, "info.toml")),
		)
		.map((d) => {
			const toml = readFileSync(
				join(root, "model", d.name, "info.toml"),
				"utf8",
			);
			const name = /^\s*name\s*=\s*"([^"]*)"/m.exec(toml)?.[1] ?? d.name;
			return { dir: d.name, name };
		});

/**
 * 手元を指すホスト名か。`127.` で始まる公開ドメイン（`127.attacker.example`）を通さないよう、
 * IPv4 は数字4つの完全一致で見る。
 */
const isLoopbackHost = (hostname: string): boolean => {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	return (
		host === "localhost" ||
		host === "::1" ||
		/^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host)
	);
};

/**
 * 手元で開いた dtm のページからの呼び出しか。
 *
 * - `Origin: null` は断る。公開サイトでも sandbox 付きの iframe で作れるため。file: で開いた
 *   ページから使うときだけ、起動時に `--allow-file-origin` を付ける。
 * - Origin の無い呼び出し（curl など）は通す。ブラウザの別サイトからの POST・CORS には
 *   必ず Origin が付く。DNS リバインディングは {@link allowedHost} で止める。
 */
const allowFileOrigin = args.includes("--allow-file-origin");
const allowedOrigin = (origin: string | undefined): boolean => {
	if (origin === undefined) return true;
	if (origin === "null") return allowFileOrigin;
	try {
		return isLoopbackHost(new URL(origin).hostname);
	} catch {
		return false;
	}
};

/**
 * `Host` ヘッダーが手元のこのポートか（DNS リバインディングで、攻撃者のドメイン名のまま
 * 127.0.0.1 に届いた呼び出しを断る）。
 */
const allowedHost = (host: string | undefined): boolean => {
	if (!host) return false;
	try {
		const u = new URL(`http://${host}`);
		return isLoopbackHost(u.hostname) && u.port === String(port);
	} catch {
		return false;
	}
};

const run = (cmd: string, cmdArgs: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, cmdArgs, { cwd: root, windowsHide: true });
		let log = "";
		child.stdout.on("data", (d) => {
			log += d;
		});
		child.stderr.on("data", (d) => {
			log += d;
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(
						new Error(`${cmd} が ${code} で終わりました\n${log.slice(-2000)}`),
					),
		);
	});

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

/** MusicXML を歌わせて WAV のバイト列を返す（1件ずつ）。 */
const sing = (xml: string, model: string): Promise<Buffer> => {
	const job = queue
		.catch(() => {})
		.then(async () => {
			const dir = join(work, `${process.pid}-${++seq}`);
			mkdirSync(dir, { recursive: true });
			const f = (ext: string) => join(dir, `score.${ext}`);
			try {
				writeFileSync(f("musicxml"), xml);
				await run(exe("musicXMLtoLabel"), [
					f("musicxml"),
					f("full.lab"),
					f("mono.lab"),
				]);
				await run(exe("neutrino"), [
					f("full.lab"),
					f("timing.lab"),
					f("f0"),
					f("melspec"),
					f("wav"),
					`${join(root, "model", model)}${process.platform === "win32" ? "\\" : "/"}`,
					"-n",
					String(threads),
					"-k",
					"0",
					"-f",
					"0",
					"-s",
					"48000",
					"-b",
					"16",
					...(useGpu ? ["-m"] : []),
					"-t",
				]);
				return readFileSync(f("wav"));
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	queue = job;
	return job;
};

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY) {
				reject(new Error("楽譜が大きすぎます"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});

const send = (
	res: ServerResponse,
	status: number,
	body: string | Buffer,
	type = "text/plain; charset=utf-8",
) => {
	res.writeHead(status, { "Content-Type": type });
	res.end(body);
};

createServer(async (req, res) => {
	const origin = req.headers.origin;
	if (!allowedHost(req.headers.host))
		return send(res, 403, "Host が手元（127.0.0.1・localhost）ではありません");
	if (!allowedOrigin(origin))
		return send(
			res,
			403,
			"このページからは使えません（手元で開いた dtm だけ）",
		);
	if (origin) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Vary", "Origin");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		// Chrome の Private Network Access（公開サイト→localhost は断る）にも答えておく
		res.setHeader("Access-Control-Allow-Private-Network", "true");
	}
	if (req.method === "OPTIONS") return send(res, 204, "");
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	try {
		if (req.method === "GET" && url.pathname === "/version")
			return send(
				res,
				200,
				JSON.stringify({ neutrino: root, gpu: useGpu }),
				"application/json",
			);
		if (req.method === "GET" && url.pathname === "/singers")
			return send(res, 200, JSON.stringify(listSingers()), "application/json");
		if (req.method === "POST" && url.pathname === "/sing") {
			const model = url.searchParams.get("model") ?? "";
			// フォルダ名はインストール済みの一覧と完全一致だけ通す（パスの細工を防ぐ）
			if (!listSingers().some((s) => s.dir === model))
				return send(
					res,
					404,
					`歌声ライブラリ ${model} が NEUTRINO の model/ にありません`,
				);
			const xml = await readBody(req);
			const t = Date.now();
			const wav = await sing(xml, model);
			console.log(
				`${new Date().toLocaleTimeString()} ${model} ${((Date.now() - t) / 1000).toFixed(1)}s`,
			);
			return send(res, 200, wav, "audio/wav");
		}
		send(res, 404, "not found");
	} catch (err) {
		console.error(err);
		send(res, 500, err instanceof Error ? err.message : String(err));
	}
}).listen(port, "127.0.0.1", () => {
	console.log(
		`NEUTRINO 中継サーバー: http://127.0.0.1:${port}（${root}、${useGpu ? "GPU" : "CPU"}）`,
	);
	console.log(
		`歌声ライブラリ: ${listSingers()
			.map((s) => s.dir)
			.join(", ")}`,
	);
});
