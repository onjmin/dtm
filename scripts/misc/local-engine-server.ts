/**
 * 手元の歌声エンジン（NEUTRINO・OpenUtau）を dtm から呼ぶ中継サーバーの共通部品。
 *
 * どの中継サーバーも同じ口を持つ:
 *   GET  /version            → エンジンの情報（JSON）
 *   GET  /singers            → [{"dir":"<フォルダ名>","name":"<表示名>"}, ...]
 *   POST /sing?model=<dir>   本文 MusicXML → audio/wav
 *
 * 安全のための決まり（2026-10-31 のセキュリティレビューで直したもの）:
 * - 127.0.0.1 でだけ待ち受ける。
 * - `Host` ヘッダーが手元のこのポートでない呼び出しは断る（DNS リバインディング）。
 * - Origin は localhost・::1・127.0.0.0/8 の数字表記だけ通す（`127.` で始まる公開ドメインを通さない）。
 *   `Origin: null`（sandbox 付きの iframe で公開サイトからも作れる）は `--allow-file-origin` のときだけ。
 * - 歌い手の名前は、インストール済みの一覧と完全一致だけ通す（パスの細工を防ぐ）。
 * - 外部プロセスはシェルを通さず、引数は配列で渡す。合成は1件ずつ。本文は 8MB まで。
 */

import { spawn } from "node:child_process";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

const MAX_BODY = 8 * 1024 * 1024;

/** 手元を指すホスト名か。IPv4 は数字4つの完全一致で見る。 */
export const isLoopbackHost = (hostname: string): boolean => {
	const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	return (
		host === "localhost" ||
		host === "::1" ||
		/^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host)
	);
};

/** コマンドライン引数の読み取り。 */
export const cliArgs = (argv = process.argv.slice(2)) => {
	const opt = (name: string): string | undefined => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	/** 整数の引数。NaN・Infinity・範囲外は既定値に戻す。 */
	const int = (name: string, def: number, min: number, max: number): number => {
		const v = Number(opt(name) ?? def);
		return Number.isInteger(v) && v >= min && v <= max ? v : def;
	};
	return { opt, int, has: (name: string) => argv.includes(`--${name}`) };
};

/** 外部プロセスを、シェルを通さずに動かす。0 以外で終わったらログの末尾つきで失敗。 */
export const runProcess = (
	cmd: string,
	cmdArgs: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn(cmd, cmdArgs, {
			cwd: options.cwd,
			env: options.env,
			windowsHide: true,
			shell: false,
		});
		let log = "";
		const keep = (d: Buffer) => {
			log = (log + d).slice(-20000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(log)
				: reject(
						new Error(`${cmd} が ${code} で終わりました\n${log.slice(-2000)}`),
					),
		);
	});

export type LocalEngineServerOptions = {
	/** ログの見出し（「NEUTRINO」など）。 */
	name: string;
	port: number;
	allowFileOrigin: boolean;
	/** /version で返す情報。 */
	info: Record<string, unknown>;
	listSingers: () => { dir: string; name: string }[];
	/** MusicXML を歌わせて WAV を返す。`model` は {@link listSingers} にある `dir` だけが来る。 */
	sing: (xml: string, model: string) => Promise<Buffer>;
};

export const startLocalEngineServer = (o: LocalEngineServerOptions): void => {
	const allowedOrigin = (origin: string | undefined): boolean => {
		// Origin の無い呼び出し（curl など）は通す。ブラウザの別サイトからの POST・CORS には必ず付く。
		if (origin === undefined) return true;
		if (origin === "null") return o.allowFileOrigin;
		try {
			return isLoopbackHost(new URL(origin).hostname);
		} catch {
			return false;
		}
	};
	const allowedHost = (host: string | undefined): boolean => {
		if (!host) return false;
		try {
			const u = new URL(`http://${host}`);
			return isLoopbackHost(u.hostname) && u.port === String(o.port);
		} catch {
			return false;
		}
	};

	let queue: Promise<unknown> = Promise.resolve();
	const singQueued = (xml: string, model: string): Promise<Buffer> => {
		const job = queue.catch(() => {}).then(() => o.sing(xml, model));
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
		res.writeHead(status, {
			"Content-Type": type,
			"X-Content-Type-Options": "nosniff",
		});
		res.end(body);
	};

	createServer(async (req, res) => {
		const origin = req.headers.origin;
		if (!allowedHost(req.headers.host))
			return send(
				res,
				403,
				"Host が手元（127.0.0.1・localhost）ではありません",
			);
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
			// Chrome の Private Network Access にも答える（手元の Origin にだけ届く）
			res.setHeader("Access-Control-Allow-Private-Network", "true");
		}
		if (req.method === "OPTIONS") return send(res, 204, "");
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		try {
			if (req.method === "GET" && url.pathname === "/version")
				return send(res, 200, JSON.stringify(o.info), "application/json");
			if (req.method === "GET" && url.pathname === "/singers")
				return send(
					res,
					200,
					JSON.stringify(o.listSingers()),
					"application/json",
				);
			if (req.method === "POST" && url.pathname === "/sing") {
				const model = url.searchParams.get("model") ?? "";
				if (!o.listSingers().some((s) => s.dir === model))
					return send(res, 404, "その歌い手は入っていません");
				const xml = await readBody(req);
				const t = Date.now();
				const wav = await singQueued(xml, model);
				console.log(
					`${new Date().toLocaleTimeString()} ${model} ${((Date.now() - t) / 1000).toFixed(1)}s`,
				);
				return send(res, 200, wav, "audio/wav");
			}
			send(res, 404, "not found");
		} catch (err) {
			console.error(err);
			send(res, 500, "合成できませんでした（サーバーのログを見てください）");
		}
	}).listen(o.port, "127.0.0.1", () => {
		console.log(`${o.name} 中継サーバー: http://127.0.0.1:${o.port}`);
		console.log(
			`歌い手: ${o
				.listSingers()
				.map((s) => s.dir)
				.join(", ")}`,
		);
	});
};
