// 録音用の dist の写しを rec/dist-rec/ に作る（gitignore）。先に pnpm build で dist/ を作っておく。
// src の既定（先読み 0.5 秒・0.5 秒以上の遅れで割り込み扱い）は変えず、写しだけ書き換える:
//   先読み 3 秒  … 裏のページでタイマーが 1 秒に間引かれても音が途切れない
//   割り込み判定 5 秒 … 間引きを割り込み（停止）と取り違えない
// node scripts/speech-melody/rec/make-dist-rec.mjs
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "..", "..", "..", "dist");
const out = join(here, "dist-rec");
const PATCHES = [
	["var PLAN_TIME = 0.5;", "var PLAN_TIME = 3;"],
	["if (realDelta > 0.5 || audioDelta > 0.5) {", "if (realDelta > 5 || audioDelta > 5) {"],
];

mkdirSync(out, { recursive: true });
for (const f of readdirSync(dist)) {
	if (f !== "index.mjs" && /\.(m?js|wasm)$/.test(f)) copyFileSync(join(dist, f), join(out, f));
}
let src = readFileSync(join(dist, "index.mjs"), "utf8");
for (const [from, to] of PATCHES) {
	const n = src.split(from).length - 1;
	if (n !== 1) {
		console.error(`dist/index.mjs に「${from}」が ${n} 箇所（1 箇所のはず）。src/audio/sequencer.ts が変わったら PATCHES を直す`);
		process.exit(1);
	}
	src = src.replace(from, to);
}
writeFileSync(join(out, "index.mjs"), src);
console.log(`wrote ${out}`);
