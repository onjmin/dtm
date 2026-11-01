/**
 * 手元の歌声エンジンとデモの DAW をまとめて起動する。
 *
 *   pnpm engines                       （= npx tsx scripts/misc/start-engines.ts）
 *   pnpm engines --only voicevox,neutrino
 *   pnpm engines --config <設定ファイル>
 *
 * エンジンの置き場所は手元ごとに違うので、リポジトリ直下の `engines.local.json`（git 管理外）に
 * 書く。書き方は scripts/misc/engines.example.json。書いてあるエンジンだけを起動する。
 * パスは相対ならリポジトリ直下から読む。
 *
 * - すでにそのポートで動いているエンジンは起動しない（エディタ付きの VOICEVOX など）。
 * - 出力は行の頭に [名前] を付けて1つの画面にまとめる。
 * - Ctrl+C で、このスクリプトが起動したものを全部止める（子プロセスごと）。
 * - SimpleEnunuServer は同梱の bat が最後に PAUSE するので、bat を通さず同梱の Python で直に起動する。
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { cliArgs } from "./local-engine-server";

const repo = resolve(__dirname, "../..");
const tsxCli = join(repo, "node_modules/tsx/dist/cli.mjs");

type EngineConfig = {
	voicevox?: { dir: string };
	neutrino?: { dir: string; args?: string[] };
	openutau?: { dir: string; dotnetRoot?: string; args?: string[] };
	enunu?: { dir: string };
	sinsy?: { python: string; wsl?: boolean; args?: string[] };
	demo?: boolean | { build?: boolean };
};

type Launch = {
	name: string;
	port: number;
	cmd: string;
	args: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** 起動の前に確かめるファイル（無ければ設定の誤りとして知らせて飛ばす） */
	needs: string;
};

const args = cliArgs();
const configPath = resolve(repo, args.opt("config") ?? "engines.local.json");
const only = args.opt("only")?.split(",");

if (!existsSync(configPath)) {
	console.error(
		`${configPath} がありません。scripts/misc/engines.example.json を写して、手元のエンジンの場所を書いてください。`,
	);
	process.exit(1);
}
const config: EngineConfig = JSON.parse(readFileSync(configPath, "utf8"));
const at = (p: string) => resolve(repo, p);
const tsx = (script: string, rest: string[]) => [
	tsxCli,
	join(repo, script),
	...rest,
];

const launches: Launch[] = [];
if (config.voicevox) {
	const dir = at(config.voicevox.dir);
	launches.push({
		name: "voicevox",
		port: 50021,
		cmd: join(dir, "run.exe"),
		args: [],
		cwd: dir,
		needs: join(dir, "run.exe"),
	});
}
if (config.neutrino) {
	const dir = at(config.neutrino.dir);
	launches.push({
		name: "neutrino",
		port: 50022,
		cmd: process.execPath,
		args: tsx("scripts/misc/neutrino-server.ts", [
			"--neutrino",
			dir,
			...(config.neutrino.args ?? []),
		]),
		needs: join(dir, "bin"),
	});
}
if (config.openutau) {
	const dir = at(config.openutau.dir);
	const dotnet = config.openutau.dotnetRoot;
	launches.push({
		name: "openutau",
		port: 50023,
		cmd: process.execPath,
		args: tsx("scripts/misc/openutau-server.ts", [
			"--openutau",
			dir,
			...(config.openutau.args ?? []),
		]),
		env: dotnet ? { ...process.env, DOTNET_ROOT: at(dotnet) } : undefined,
		needs: join(dir, "OpenUtau.exe"),
	});
}
if (config.enunu) {
	const dir = at(config.enunu.dir);
	const python = join(dir, "python-3.9.13-embed-amd64", "python.exe");
	launches.push({
		name: "enunu",
		port: 15556,
		cmd: python,
		args: ["simple_enunu_server.py"],
		cwd: dir,
		needs: python,
	});
}
if (config.sinsy) {
	launches.push({
		name: "sinsy",
		port: 50024,
		cmd: process.execPath,
		args: tsx("scripts/misc/sinsy-server.ts", [
			...(config.sinsy.wsl ? ["--wsl"] : []),
			"--python",
			config.sinsy.python,
			...(config.sinsy.args ?? []),
		]),
		needs: tsxCli,
	});
}
if (config.demo) {
	const port = Number(process.env.PORT ?? 40298);
	const wanted = !only || only.includes("demo");
	if (wanted && typeof config.demo === "object" && config.demo.build) {
		console.log("[demo] npx tsup で dist/ を組み立てます");
		const built = spawnSync(
			process.execPath,
			[join(repo, "node_modules/tsup/dist/cli-default.js")],
			{ cwd: repo, stdio: "inherit" },
		);
		if (built.status !== 0) process.exit(built.status ?? 1);
	}
	launches.push({
		name: "demo",
		port,
		cmd: process.execPath,
		args: tsx("demo/server.ts", []),
		cwd: repo,
		needs: join(repo, "dist/index.mjs"),
	});
}

/** そのポートで誰かが待ち受けているか。 */
const portInUse = (port: number): Promise<boolean> =>
	new Promise((done) => {
		const socket = connect({ host: "127.0.0.1", port });
		socket.setTimeout(500);
		socket.once("connect", () => {
			socket.destroy();
			done(true);
		});
		socket.once("timeout", () => {
			socket.destroy();
			done(false);
		});
		socket.once("error", () => done(false));
	});

/** 子の出力を行ごとに [名前] 付きで流す。 */
const pipe = (name: string, stream: NodeJS.ReadableStream | null) => {
	let rest = "";
	stream?.setEncoding("utf8");
	stream?.on("data", (chunk: string) => {
		const lines = (rest + chunk).split(/\r?\n/);
		rest = lines.pop() ?? "";
		for (const line of lines) console.log(`[${name}] ${line}`);
	});
};

const children: { name: string; child: ChildProcess }[] = [];

// tsx はこのリポジトリでは CommonJS として動くので、トップレベルの await は使えない
const main = async () => {
	for (const l of launches) {
		if (only && !only.includes(l.name)) continue;
		if (!existsSync(l.needs)) {
			console.error(`[${l.name}] ${l.needs} が見つからないので飛ばします`);
			continue;
		}
		if (await portInUse(l.port)) {
			console.log(
				`[${l.name}] ポート ${l.port} はもう使われているので起動しません`,
			);
			continue;
		}
		const child = spawn(l.cmd, l.args, {
			cwd: l.cwd,
			env: l.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		pipe(l.name, child.stdout);
		pipe(l.name, child.stderr);
		child.on("error", (e) =>
			console.error(`[${l.name}] 起動できません: ${e.message}`),
		);
		child.on("exit", (code) =>
			console.log(`[${l.name}] 終了しました（${code}）`),
		);
		children.push({ name: l.name, child });
		console.log(`[${l.name}] 起動（ポート ${l.port}）`);
	}

	if (children.length === 0) {
		console.log("起動したものはありません。");
		process.exit(0);
	}
	console.log("Ctrl+C でまとめて止めます。");
};

let stopping = false;
const stopAll = () => {
	if (stopping) return;
	stopping = true;
	for (const { child } of children) {
		if (child.exitCode !== null || !child.pid) continue;
		// Windows は kill だけだと孫プロセス（run.exe の中のエンジンなど）が残るので木ごと止める
		if (process.platform === "win32")
			spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
			});
		else child.kill("SIGTERM");
	}
	process.exit(0);
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
main();
