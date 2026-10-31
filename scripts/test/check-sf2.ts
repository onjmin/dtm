/**
 * 外部サウンドフォント（.sf2）の読み取り（parseSf2）を確かめる。
 *
 * テストの中で最小の .sf2（正弦波1本・楽器1つ）を組み立てて読み、鍵盤範囲・ルートキー・
 * 調律・ループが取れること、壊れた・細工されたファイルが例外になること（範囲外を読まない）、
 * `#sf2=` の宣言が URL をそろえて往復することを見る。
 */

import Module from "node:module";

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { parseSf2, findSf2Preset } =
	require("../../src/instruments/sf/sf2-parser") as typeof import("../../src/instruments/sf/sf2-parser");
const { parseMML, formatMmlMeta } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");
const { resolveSoundFontFile } =
	require("../../src/instruments/soundfont-banks") as typeof import("../../src/instruments/soundfont-banks");

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	const ok = a === b;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) {
		console.log(`        実際: ${a}`);
		console.log(`        期待: ${b}`);
	}
};
const throws = (label: string, f: () => unknown): void => {
	let threw = false;
	try {
		f();
	} catch (e) {
		threw = /SoundFont を読めません/.test(String(e));
	}
	check(label, threw, true);
};

// ── 最小の .sf2 を組み立てる ──
const u16 = (v: number) => {
	const b = Buffer.alloc(2);
	b.writeUInt16LE(v);
	return b;
};
const i16 = (v: number) => {
	const b = Buffer.alloc(2);
	b.writeInt16LE(v);
	return b;
};
const u32 = (v: number) => {
	const b = Buffer.alloc(4);
	b.writeUInt32LE(v);
	return b;
};
const name20 = (s: string) => {
	const b = Buffer.alloc(20);
	b.write(s, "ascii");
	return b;
};
const chunk = (id: string, body: Buffer) =>
	Buffer.concat([
		Buffer.from(id, "ascii"),
		u32(body.length),
		body,
		body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0),
	]);
const list = (type: string, ...chunks: Buffer[]) =>
	chunk("LIST", Buffer.concat([Buffer.from(type, "ascii"), ...chunks]));
const gen = (op: number, amount: Buffer) => Buffer.concat([u16(op), amount]);

const N = 1000;
const buildSf2 = (opts: { sampleEnd?: number; instBag?: number } = {}) => {
	const pcm = Buffer.alloc((N + 46) * 2);
	for (let i = 0; i < N; i++)
		pcm.writeInt16LE(
			Math.round(Math.sin((i / N) * Math.PI * 20) * 16000),
			i * 2,
		);
	const phdr = Buffer.concat([
		name20("Sine"),
		u16(0), // program
		u16(0), // bank
		u16(0), // bag index
		u32(0),
		u32(0),
		u32(0),
		name20("EOP"),
		u16(0),
		u16(0),
		u16(1),
		u32(0),
		u32(0),
		u32(0),
	]);
	const pbag = Buffer.concat([u16(0), u16(0), u16(1), u16(0)]);
	const pgen = Buffer.concat([gen(41, u16(0)), gen(0, u16(0))]);
	const inst = Buffer.concat([
		name20("SineInst"),
		u16(opts.instBag ?? 0),
		name20("EOI"),
		u16(1),
	]);
	const ibag = Buffer.concat([u16(0), u16(0), u16(4), u16(0)]);
	const igen = Buffer.concat([
		gen(43, Buffer.from([48, 72])), // keyRange 48-72
		gen(54, i16(1)), // sampleModes = loop
		gen(51, i16(1)), // coarseTune +1
		gen(53, u16(0)), // sampleID 0
		gen(0, u16(0)),
	]);
	const shdr = Buffer.concat([
		name20("sine"),
		u32(0),
		u32(opts.sampleEnd ?? N),
		u32(100),
		u32(900),
		u32(22050),
		Buffer.from([69, 5]), // originalPitch A4, correction +5
		u16(0),
		u16(1),
		name20("EOS"),
		Buffer.alloc(26),
	]);
	const mod = Buffer.alloc(10);
	const body = Buffer.concat([
		Buffer.from("sfbk", "ascii"),
		list(
			"INFO",
			chunk("ifil", Buffer.concat([u16(2), u16(1)])),
			chunk("INAM", Buffer.from("Test SF2\0", "ascii")),
		),
		list("sdta", chunk("smpl", pcm)),
		list(
			"pdta",
			chunk("phdr", phdr),
			chunk("pbag", pbag),
			chunk("pmod", mod),
			chunk("pgen", pgen),
			chunk("inst", inst),
			chunk("ibag", ibag),
			chunk("imod", mod),
			chunk("igen", igen),
			chunk("shdr", shdr),
		),
	]);
	const file = Buffer.concat([
		Buffer.from("RIFF", "ascii"),
		u32(body.length),
		body,
	]);
	return file.buffer.slice(
		file.byteOffset,
		file.byteOffset + file.byteLength,
	) as ArrayBuffer;
};

console.log("■ 最小の .sf2 を読む");
{
	const sf2 = parseSf2(buildSf2());
	check("名前", sf2.name, "Test SF2");
	check(
		"プリセット",
		sf2.presets.map((p) => [p.name, p.bank, p.program]),
		[["Sine", 0, 0]],
	);
	const z = sf2.presets[0].zones[0];
	check("鍵盤範囲", [z.keyLow, z.keyHigh], [48, 72]);
	check("ルートキー", z.rootKey, 69);
	check("調律（粗い +1 半音 ＋ サンプル補正 +5 セント）", z.tuneCents, 105);
	check("サンプル数・周波数", [z.pcm.length, z.sampleRate], [N, 22050]);
	check("ループ", z.loop, { start: 100, end: 900 });
	check("振幅は -1〜1", Math.max(...z.pcm.map(Math.abs)) <= 1, true);
	check("GM 0 番を引ける", findSf2Preset(sf2, 0)?.name, "Sine");
	check("無い番号は undefined", findSf2Preset(sf2, 40), undefined);
}

console.log("■ 壊れた・細工されたファイル");
{
	const good = new Uint8Array(buildSf2());
	throws("RIFF でない", () =>
		parseSf2(new TextEncoder().encode("<script>alert(1)</script>").buffer),
	);
	throws("空", () => parseSf2(new ArrayBuffer(0)));
	throws("途中で切れている", () =>
		parseSf2(good.slice(0, good.length - 300).buffer),
	);
	throws("サンプルの終わりが smpl の外", () =>
		parseSf2(buildSf2({ sampleEnd: 0xffffffff })),
	);
	throws("ゾーンの番号が範囲外", () => parseSf2(buildSf2({ instBag: 60000 })));
	// チャンクの長さを 0xFFFFFFFF に書き換える（巨大な長さで範囲外を読ませる）
	const bad = good.slice();
	new DataView(bad.buffer).setUint32(4, 0xffffffff, true);
	const inner = bad.slice();
	// INFO の LIST の長さを壊す
	new DataView(inner.buffer).setUint32(16, 0xfffffff0, true);
	throws("チャンクの長さが巨大", () => parseSf2(inner.buffer));
}

console.log("■ `#sf2=` と音源バンク");
{
	const p = parseMML("#sf2=https://a.example/x.sf2 #t0font=ExtSF2\n@0 c4;");
	check("URL はそろえて読む", p.meta.soundFontUrl, "https://a.example/x.sf2");
	check("宣言から音符が生えない", p.placements.length, 1);
	check(
		"書き出し",
		formatMmlMeta({ soundFontUrl: "https://a.example/x.sf2" }, " "),
		"#sf2=https://a.example/x.sf2",
	);
	check(
		"; 入りの URL は書かない",
		formatMmlMeta({ soundFontUrl: "https://a.example/x.sf2;@0 c d e" }, " "),
		"",
	);
	check(
		"javascript: は読まない",
		parseMML("#sf2=javascript:alert(1)\n@0 c4;").meta.soundFontUrl,
		undefined,
	);
	check(
		"ExtSF2 のトラックは楽器番号だけ決めて落とさない",
		resolveSoundFontFile("0330", "ExtSF2", new Map()),
		{ key: "0330", bank: "ExtSF2", fellBack: false },
	);
}

if (failed > 0) {
	console.log(`\n${failed} 件失敗`);
	process.exit(1);
}
console.log("\n外部サウンドフォント: すべて成功");

// 手で確かめるとき用: WRITE_SF2=<パス> で、組み立てた .sf2 を書き出す。
if (process.env.WRITE_SF2)
	require("node:fs").writeFileSync(
		process.env.WRITE_SF2,
		Buffer.from(buildSf2()),
	);
