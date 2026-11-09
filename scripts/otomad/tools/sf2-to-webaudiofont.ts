/**
 * .sf2 を、プリセットごとの WebAudioFont（surikov/webaudiofont の形の JS）にする。
 *
 * 他の作者のサウンドフォント（レ淫棒など）を onjmin/inc-sf2 から web で呼べるようにするために使う。
 * 読むのは dtm の `parseSf2`（外部 SF2 と同じ範囲: 鍵盤範囲・ルートキー・調律・ループ・オフセット）。
 *
 * ファイル名は `<バンク3桁><プログラム3桁>_<名前>.js`、変数は `_tone_<同じ>`。
 * GM の番号では選べない（キャラごとにバンクを分けた作りなので）ため、バンクも名前に入れる。
 * Domino の音源定義（.xml、Shift_JIS）を渡すと、一覧に日本語の音色名を載せる。
 *
 *   npx tsx scripts/otomad/tools/sf2-to-webaudiofont.ts <in.sf2> <出力フォルダ> <名前> [音源定義.xml]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSf2, type Sf2Zone } from "../../../src/instruments/sf/sf2-parser";

const [inPath, outDir, fontName, xmlPath] = process.argv.slice(2);
if (!inPath || !outDir || !fontName || !/^[A-Za-z0-9_]+$/.test(fontName)) {
	console.error(
		"使い方: tsx sf2-to-webaudiofont.ts <in.sf2> <出力フォルダ> <英数と_の名前> [音源定義.xml]",
	);
	process.exit(1);
}

/** Domino の音源定義から (バンク, プログラム) → 日本語名。ドラムはバンク 128。 */
const xmlNames = (path: string): Map<string, string> => {
	const text = new TextDecoder("shift_jis").decode(readFileSync(path));
	const names = new Map<string, string>();
	const drumAt = text.indexOf("<DrumSetList");
	const pcRe = /<PC Name="([^"]*)" PC="(\d+)"\s*>([\s\S]*?)<\/PC>/g;
	for (const m of text.matchAll(pcRe)) {
		const pc = Number(m[2]) - 1;
		const drum = drumAt >= 0 && (m.index ?? 0) > drumAt;
		const banks = [...m[3].matchAll(/<Bank Name="([^"]*)"[^>]*MSB="(\d+)"/g)];
		if (drum) names.set(`128:${pc}`, m[1]);
		for (const b of banks) names.set(`${drum ? 128 : Number(b[2])}:${pc}`, b[1]);
	}
	return names;
};

/** 先に出たゾーンで鍵盤が全部埋まっているゾーンは捨てる（同じ鍵のベロシティ違いなど）。 */
const firstHitZones = (zones: Sf2Zone[]): Sf2Zone[] => {
	const taken = new Set<number>();
	const out: Sf2Zone[] = [];
	for (const z of zones) {
		let fresh = false;
		for (let k = z.keyLow; k <= z.keyHigh; k++) if (!taken.has(k)) fresh = true;
		if (!fresh) continue;
		for (let k = z.keyLow; k <= z.keyHigh; k++) taken.add(k);
		out.push(z);
	}
	return out;
};

const pcm16Base64 = (pcm: Float32Array): string => {
	const buf = Buffer.alloc(pcm.length * 2);
	for (let i = 0; i < pcm.length; i++) {
		const v = Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767);
		buf.writeInt16LE(v, i * 2);
	}
	return buf.toString("base64");
};

const data = readFileSync(inPath);
const sf2 = parseSf2(
	data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
);
const names = xmlPath ? xmlNames(xmlPath) : new Map<string, string>();
mkdirSync(outDir, { recursive: true });
const list: string[] = [];
const sorted = [...sf2.presets].sort(
	(a, b) => a.bank - b.bank || a.program - b.program,
);
for (const p of sorted) {
	const id = `${String(p.bank).padStart(3, "0")}${String(p.program).padStart(3, "0")}`;
	const file = `${id}_${fontName}`;
	const zones = firstHitZones(p.zones).map(
		(z) =>
			`{midi:${p.program},originalPitch:${z.rootKey * 100},keyRangeLow:${z.keyLow},keyRangeHigh:${z.keyHigh},` +
			`loopStart:${z.loop?.start ?? 0},loopEnd:${z.loop?.end ?? 0},coarseTune:0,fineTune:${z.tuneCents},` +
			`sampleRate:${z.sampleRate},ahdsr:true,sample:'${pcm16Base64(z.pcm)}'}`,
	);
	writeFileSync(
		join(outDir, `${file}.js`),
		`console.log('load _tone_${file}');\nvar _tone_${file}={zones:[\n${zones.join(",\n")}\n]};\n`,
	);
	const ja = names.get(`${p.bank}:${p.program}`) ?? "";
	list.push([file, p.bank, p.program, p.name, ja].join("\t"));
}
writeFileSync(join(outDir, "list.txt"), `${list.join("\n")}\n`);
console.log(`${sf2.name}: ${sorted.length} 音色 → ${outDir}`);
