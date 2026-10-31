/**
 * 手元の NEUTRINO を dtm から呼ぶための小さな中継サーバー（試作）。
 *
 *   npx tsx scripts/misc/neutrino-server.ts --neutrino <NEUTRINO のフォルダ> [--port 50022] [--cpu] [--threads 4] [--allow-file-origin]
 *
 * NEUTRINO はコマンドラインで動くソフトなので、ブラウザからは直接呼べない。このサーバーが
 * MusicXML を受け取り、利用者が公式から入れた NEUTRINO（`bin/musicXMLtoLabel` と
 * `bin/neutrino`）を順に呼んで、出来た WAV を返す。dtm は NEUTRINO 本体も歌声ライブラリも
 * 同梱しない（規約の解釈は docs/research/neutrino-terms.md）。
 *
 * 口と安全のための決まりは local-engine-server.ts（OpenUtau の中継サーバーと共通）。
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	cliArgs,
	runProcess,
	startLocalEngineServer,
} from "./local-engine-server";

const args = cliArgs();
const rootArg = args.opt("neutrino") ?? process.env.NEUTRINO_DIR;
const root = rootArg ? resolve(rootArg) : "";
const port = args.int("port", 50022, 1024, 65535);
const useGpu = !args.has("cpu");
const threads = args.int("threads", 4, 1, 64);

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

let seq = 0;

/** MusicXML を歌わせて WAV のバイト列を返す（呼び出しは共通部品が1件ずつに並べる）。 */
const sing = async (xml: string, model: string): Promise<Buffer> => {
	const dir = join(work, `${process.pid}-${++seq}`);
	mkdirSync(dir, { recursive: true });
	const f = (ext: string) => join(dir, `score.${ext}`);
	try {
		writeFileSync(f("musicxml"), xml);
		await runProcess(
			exe("musicXMLtoLabel"),
			[f("musicxml"), f("full.lab"), f("mono.lab")],
			{ cwd: root },
		);
		await runProcess(
			exe("neutrino"),
			[
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
			],
			{ cwd: root },
		);
		return readFileSync(f("wav"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

startLocalEngineServer({
	name: `NEUTRINO（${useGpu ? "GPU" : "CPU"}）`,
	port,
	allowFileOrigin: args.has("allow-file-origin"),
	info: { engine: "neutrino", gpu: useGpu },
	listSingers,
	sing,
});
