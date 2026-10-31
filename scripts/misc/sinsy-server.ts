/**
 * 手元の Sinsy（pysinsy）を dtm から呼ぶ中継サーバー（試作）。
 *
 *   npx tsx scripts/misc/sinsy-server.ts --python <pysinsy を入れた python> [--wsl] [--port 50024] [--allow-file-origin]
 *
 * pysinsy は Windows 用の組み立て済みの配布が無いので、WSL の Python に入れて `--wsl` で呼ぶ
 * 形を想定する（例: `--wsl --python ~/dtm-sinsy/bin/python`）。手順は docs/guide/sinsy-sing.md。
 * 合成は scripts/misc/sinsy_synth.py が行う。声は pysinsy 付属の NIT SONG070 F001（CC BY 3.0）。
 *
 * 口と安全のための決まりは local-engine-server.ts（NEUTRINO・OpenUtau と共通）。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	cliArgs,
	runProcess,
	startLocalEngineServer,
} from "./local-engine-server";

const args = cliArgs();
const python = args.opt("python");
const useWsl = args.has("wsl");
const port = args.int("port", 50024, 1024, 65535);
const script = resolve(__dirname, "sinsy_synth.py");

if (!python) {
	console.error(
		"pysinsy を入れた Python を --python で指定してください（WSL の Python なら --wsl も）。",
	);
	process.exit(2);
}

/** Windows のパスを WSL から見たパスへ（C:\a\b → /mnt/c/a/b）。 */
const toWsl = (p: string): string =>
	p
		.replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/mnt/${d.toLowerCase()}/`)
		.replace(/\\/g, "/");

const work = join(tmpdir(), "dtm-sinsy");
mkdirSync(work, { recursive: true });

/** 声は付属の1つだけ。 */
const SINGERS = [
	{ dir: "nitech_jp_song070_f001", name: "Sinsy NIT SONG070 F001" },
];

let seq = 0;

const sing = async (xml: string): Promise<Buffer> => {
	const dir = join(work, `${process.pid}-${++seq}`);
	mkdirSync(dir, { recursive: true });
	const input = join(dir, "score.musicxml");
	const output = join(dir, "score.wav");
	try {
		writeFileSync(input, xml);
		if (useWsl)
			await runProcess("wsl", [
				"-e",
				python,
				toWsl(script),
				toWsl(input),
				toWsl(output),
			]);
		else await runProcess(python, [script, input, output]);
		return readFileSync(output);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

startLocalEngineServer({
	name: `Sinsy${useWsl ? "（WSL）" : ""}`,
	port,
	allowFileOrigin: args.has("allow-file-origin"),
	info: { engine: "sinsy" },
	listSingers: () => SINGERS,
	sing: (xml) => sing(xml),
});
