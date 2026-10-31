/**
 * 手元の OpenUtau（コマンドラインで書き出せる版）を dtm から呼ぶ中継サーバー（試作）。
 * DiffSinger などの歌い手を、NEUTRINO と同じ形（MusicXML を送ると WAV が返る）で使う。
 *
 *   npx tsx scripts/misc/openutau-server.ts --openutau <OpenUtau のフォルダ> [--port 50023]
 *     [--phonemizer OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer] [--onnx-runner DirectML|CPU]
 *     [--allow-file-origin]
 *
 * OpenUtau の `render` コマンドは、本家への提案（openutau/OpenUtau PR #2162）の段階で、
 * まだ公式の版には入っていない。使い方と、歌い手の下ごしらえは docs/guide/openutau-sing.md。
 *
 * 口と安全のための決まりは local-engine-server.ts（NEUTRINO の中継サーバーと共通）。
 * phonemizer・onnx-runner は起動時の引数だけで決め、ブラウザからは変えられない。
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
const rootArg = args.opt("openutau") ?? process.env.OPENUTAU_DIR;
const root = rootArg ? resolve(rootArg) : "";
const port = args.int("port", 50023, 1024, 65535);
const phonemizer =
	args.opt("phonemizer") ??
	"OpenUtau.Core.DiffSinger.DiffSingerJapanesePhonemizer";
const onnxRunner = args.opt("onnx-runner") ?? "DirectML";
const exe = join(
	root,
	process.platform === "win32" ? "OpenUtau.exe" : "OpenUtau",
);

if (!root || !existsSync(exe) || !existsSync(join(root, "Singers"))) {
	console.error(
		"OpenUtau のフォルダ（OpenUtau.exe と Singers/ がある所）を --openutau か環境変数 OPENUTAU_DIR で指定してください。",
	);
	process.exit(2);
}

const work = join(tmpdir(), "dtm-openutau");
mkdirSync(work, { recursive: true });

/** Singers/ 以下の歌い手（character.txt のある所）。表示名は character.txt の name=。 */
const listSingers = (): { dir: string; name: string }[] =>
	readdirSync(join(root, "Singers"), { withFileTypes: true })
		.filter(
			(d) =>
				d.isDirectory() &&
				existsSync(join(root, "Singers", d.name, "character.txt")),
		)
		.map((d) => {
			const bytes = readFileSync(
				join(root, "Singers", d.name, "character.txt"),
			);
			// UTAU 由来の音源は Shift_JIS のことが多い。UTF-8 として読めなければ Shift_JIS で読む。
			let txt: string;
			try {
				txt = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				txt = new TextDecoder("shift_jis").decode(bytes);
			}
			const name = /^name=(.*)$/m.exec(txt)?.[1]?.trim() || d.name;
			return { dir: d.name, name };
		});

/**
 * 歌い手の音素変換。歌い手の `character.yaml` に `default_phonemizer` があればそれ
 * （ENUNU は ENUNU の、DiffSinger は日本語 DiffSinger の音素変換が要る）、無ければ起動時の値。
 * 値は手元のファイルからだけ読み、型名として正しい形（英数・ドット・下線）だけ使う。
 */
const phonemizerOf = (model: string): string => {
	const yaml = join(root, "Singers", model, "character.yaml");
	if (existsSync(yaml)) {
		const m = /^default_phonemizer:\s*([A-Za-z0-9_.]+)\s*$/m.exec(
			readFileSync(yaml, "utf8"),
		);
		if (m) return m[1];
	}
	return phonemizer;
};

let seq = 0;

const sing = async (xml: string, model: string): Promise<Buffer> => {
	const dir = join(work, `${process.pid}-${++seq}`);
	mkdirSync(dir, { recursive: true });
	const input = join(dir, "score.musicxml");
	const output = join(dir, "score.wav");
	try {
		writeFileSync(input, xml);
		await runProcess(
			exe,
			[
				"render",
				"--input",
				input,
				"--output",
				output,
				"--singer",
				model,
				"--phonemizer",
				phonemizerOf(model),
				"--onnx-runner",
				onnxRunner,
			],
			{ cwd: root },
		);
		return readFileSync(output);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

startLocalEngineServer({
	name: `OpenUtau（${onnxRunner}）`,
	port,
	allowFileOrigin: args.has("allow-file-origin"),
	info: { engine: "openutau", phonemizer, onnxRunner },
	listSingers,
	sing,
});
