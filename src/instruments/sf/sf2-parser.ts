/**
 * SoundFont 2（.sf2）を読んで、楽器（プリセット）ごとの鍵盤ゾーンとサンプルにする。
 *
 * 外部のサウンドフォントは、配信元の JS（`<script>` で読む WebAudioFont 形式）と違って
 * **データとしてだけ**扱う（コードを実行しない）。中身は外から来るバイナリなので、
 * 全部の読み取りで範囲を確かめ、壊れた・細工されたファイルは例外にする（部分的に読まない）。
 *
 * 対応する範囲（鳴らすのに要る最小限）:
 * - プリセット → インストゥルメント → サンプルの2段のゾーン（グローバルゾーン込み）。
 * - 鍵盤範囲（keyRange）。ベロシティ範囲は見ない（各鍵で最初に当たったゾーンを使う）。
 * - ルートキー（overridingRootKey／サンプルの originalPitch）、粗い・細かい調律、
 *   サンプルのピッチ補正、ループ（sampleModes が 1 か 3 のとき）、開始・終了・ループ点のオフセット。
 * - 16bit のサンプル（sdta/smpl）。24bit の下位（sm24）は使わない。ROM サンプルは読まない。
 *
 * DOM に依存しない（Node のテストで検算する）。
 */

/** 読み込める .sf2 の大きさの上限。 */
export const MAX_SF2_BYTES = 256 * 1024 * 1024;

export type Sf2Zone = {
	keyLow: number;
	keyHigh: number;
	/** ルートキー（MIDI ノート番号）。 */
	rootKey: number;
	/** 調律（セント）。粗い調律×100＋細かい調律＋サンプルのピッチ補正。 */
	tuneCents: number;
	sampleRate: number;
	/** 鳴らす範囲のサンプル（-1〜1）。 */
	pcm: Float32Array;
	/** ループ（pcm の先頭からのサンプル位置）。ループしないときは null。 */
	loop: { start: number; end: number } | null;
};

export type Sf2Preset = {
	name: string;
	bank: number;
	program: number;
	zones: Sf2Zone[];
};

export type Sf2File = {
	name: string;
	presets: Sf2Preset[];
};

class Sf2Error extends Error {}

const fail = (msg: string): never => {
	throw new Sf2Error(`SoundFont を読めません: ${msg}`);
};

type Chunk = { id: string; offset: number; size: number };

/** 範囲を確かめながら読む小さな読み手。 */
class Reader {
	constructor(
		private view: DataView,
		private bytes: Uint8Array,
	) {}
	get length(): number {
		return this.view.byteLength;
	}
	check(offset: number, size: number): void {
		if (
			!Number.isInteger(offset) ||
			!Number.isInteger(size) ||
			offset < 0 ||
			size < 0 ||
			offset + size > this.view.byteLength
		)
			fail("範囲外を指しています");
	}
	u8(o: number): number {
		this.check(o, 1);
		return this.view.getUint8(o);
	}
	i8(o: number): number {
		this.check(o, 1);
		return this.view.getInt8(o);
	}
	u16(o: number): number {
		this.check(o, 2);
		return this.view.getUint16(o, true);
	}
	i16(o: number): number {
		this.check(o, 2);
		return this.view.getInt16(o, true);
	}
	u32(o: number): number {
		this.check(o, 4);
		return this.view.getUint32(o, true);
	}
	/** 16bit のサンプルを count 個、-1〜1 へ（範囲は先に1回だけ確かめる）。 */
	pcm16(o: number, count: number): Float32Array {
		this.check(o, count * 2);
		const out = new Float32Array(count);
		const v = this.view;
		for (let i = 0; i < count; i++)
			out[i] = v.getInt16(o + i * 2, true) / 32768;
		return out;
	}
	id(o: number): string {
		this.check(o, 4);
		return String.fromCharCode(...this.bytes.subarray(o, o + 4));
	}
	/** 固定長の名前（NUL まで。ASCII の印字可能文字だけ残す）。 */
	name(o: number, len: number): string {
		this.check(o, len);
		let s = "";
		for (let i = 0; i < len; i++) {
			const c = this.bytes[o + i];
			if (c === 0) break;
			if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
		}
		return s.trim();
	}
}

/** RIFF の子チャンクを並べる（LIST の中身を含む）。 */
const childChunks = (r: Reader, start: number, end: number): Chunk[] => {
	const out: Chunk[] = [];
	let o = start;
	while (o + 8 <= end) {
		const id = r.id(o);
		const size = r.u32(o + 4);
		if (o + 8 + size > end) fail(`${id} チャンクの長さが壊れています`);
		out.push({ id, offset: o + 8, size });
		o += 8 + size + (size & 1);
		if (out.length > 4096) fail("チャンクが多すぎます");
	}
	return out;
};

const listOf = (r: Reader, chunks: Chunk[], type: string): Chunk[] => {
	const list = chunks.find((c) => c.id === "LIST" && r.id(c.offset) === type);
	if (!list) fail(`${type} がありません`);
	const l = list as Chunk;
	return childChunks(r, l.offset + 4, l.offset + l.size);
};

const sub = (chunks: Chunk[], id: string, recordSize: number): Chunk => {
	const c = chunks.find((x) => x.id === id);
	if (!c) fail(`${id} がありません`);
	const ch = c as Chunk;
	if (ch.size % recordSize !== 0) fail(`${id} の長さが壊れています`);
	return ch;
};

// 生成子（generator）の番号。
const GEN = {
	startAddrsOffset: 0,
	endAddrsOffset: 1,
	startloopAddrsOffset: 2,
	endloopAddrsOffset: 3,
	startAddrsCoarseOffset: 4,
	endAddrsCoarseOffset: 12,
	instrument: 41,
	keyRange: 43,
	startloopAddrsCoarseOffset: 45,
	coarseTune: 51,
	fineTune: 52,
	sampleID: 53,
	sampleModes: 54,
	endloopAddrsCoarseOffset: 50,
	overridingRootKey: 58,
} as const;

type Gens = Map<number, number>;
type ZoneGens = { gens: Gens; keyLow: number; keyHigh: number };

/** bag（ゾーン）ごとの生成子を読む。鍵盤範囲は別に持つ。 */
const readZones = (
	r: Reader,
	bag: Chunk,
	gen: Chunk,
	from: number,
	to: number,
): ZoneGens[] => {
	const bagCount = bag.size / 4;
	const genCount = gen.size / 4;
	const zones: ZoneGens[] = [];
	for (let b = from; b < to; b++) {
		if (b + 1 >= bagCount) fail("ゾーンの番号が範囲外です");
		const g0 = r.u16(bag.offset + b * 4);
		const g1 = r.u16(bag.offset + (b + 1) * 4);
		if (g1 < g0 || g1 > genCount) fail("生成子の番号が範囲外です");
		const gens: Gens = new Map();
		let keyLow = 0;
		let keyHigh = 127;
		for (let g = g0; g < g1; g++) {
			const o = gen.offset + g * 4;
			const op = r.u16(o);
			if (op === GEN.keyRange) {
				keyLow = r.u8(o + 2);
				keyHigh = r.u8(o + 3);
			} else if (op === GEN.instrument || op === GEN.sampleID) {
				gens.set(op, r.u16(o + 2));
			} else {
				gens.set(op, r.i16(o + 2));
			}
		}
		zones.push({ gens, keyLow, keyHigh });
	}
	return zones;
};

/** ゾーン列の頭がグローバルゾーン（終端の生成子を持たない）なら分ける。 */
const splitGlobal = (
	zones: ZoneGens[],
	terminal: number,
): { global: Gens | null; local: ZoneGens[] } => {
	if (zones.length > 0 && !zones[0].gens.has(terminal))
		return { global: zones[0].gens, local: zones.slice(1) };
	return { global: null, local: zones };
};

/** .sf2 のバイト列を読む。壊れていれば例外。 */
export const parseSf2 = (data: ArrayBuffer): Sf2File => {
	if (!(data instanceof ArrayBuffer)) fail("バイト列ではありません");
	if (data.byteLength > MAX_SF2_BYTES)
		fail(`大きすぎます（${Math.round(MAX_SF2_BYTES / 1024 / 1024)}MB まで）`);
	const bytes = new Uint8Array(data);
	const r = new Reader(new DataView(data), bytes);
	if (r.length < 12 || r.id(0) !== "RIFF" || r.id(8) !== "sfbk")
		fail("SoundFont 2（RIFF sfbk）ではありません");
	const riffEnd = Math.min(r.length, 8 + r.u32(4));
	const top = childChunks(r, 12, riffEnd);
	const info = listOf(r, top, "INFO");
	const sdta = listOf(r, top, "sdta");
	const pdta = listOf(r, top, "pdta");

	const inam = info.find((c) => c.id === "INAM");
	const fileName = inam ? r.name(inam.offset, Math.min(inam.size, 256)) : "";

	const smpl = sdta.find((c) => c.id === "smpl");
	if (!smpl) fail("サンプル（smpl）がありません");
	const smplChunk = smpl as Chunk;
	const sampleCount = Math.floor(smplChunk.size / 2);

	const phdr = sub(pdta, "phdr", 38);
	const pbag = sub(pdta, "pbag", 4);
	const pgen = sub(pdta, "pgen", 4);
	const inst = sub(pdta, "inst", 22);
	const ibag = sub(pdta, "ibag", 4);
	const igen = sub(pdta, "igen", 4);
	const shdr = sub(pdta, "shdr", 46);

	type SampleHeader = {
		start: number;
		end: number;
		loopStart: number;
		loopEnd: number;
		sampleRate: number;
		originalPitch: number;
		correction: number;
		rom: boolean;
	};
	const samples: SampleHeader[] = [];
	for (let i = 0; i < shdr.size / 46 - 1; i++) {
		const o = shdr.offset + i * 46;
		const type = r.u16(o + 44);
		samples.push({
			start: r.u32(o + 20),
			end: r.u32(o + 24),
			loopStart: r.u32(o + 28),
			loopEnd: r.u32(o + 32),
			sampleRate: r.u32(o + 36),
			originalPitch: r.u8(o + 40),
			correction: r.i8(o + 41),
			rom: (type & 0x8000) !== 0,
		});
	}

	const instCount = inst.size / 22 - 1;
	const instZones = (
		index: number,
	): { global: Gens | null; local: ZoneGens[] } => {
		if (index < 0 || index >= instCount)
			fail("インストゥルメントの番号が範囲外です");
		const b0 = r.u16(inst.offset + index * 22 + 20);
		const b1 = r.u16(inst.offset + (index + 1) * 22 + 20);
		if (b1 < b0) fail("インストゥルメントのゾーンが壊れています");
		return splitGlobal(readZones(r, ibag, igen, b0, b1), GEN.sampleID);
	};

	// 16bit の PCM を -1〜1 へ（必要な範囲だけ）。
	const pcmOf = (from: number, to: number): Float32Array => {
		if (from < 0 || to > sampleCount || to <= from)
			fail("サンプルの範囲が壊れています");
		return r.pcm16(smplChunk.offset + from * 2, to - from);
	};

	const presetCount = phdr.size / 38 - 1;
	if (presetCount < 1) fail("楽器（プリセット）がありません");
	if (presetCount > 4096) fail("楽器（プリセット）が多すぎます");
	const presets: Sf2Preset[] = [];
	/** 同じサンプルの同じ範囲は1回だけ PCM にする。 */
	const pcmCache = new Map<string, Float32Array>();

	for (let p = 0; p < presetCount; p++) {
		const o = phdr.offset + p * 38;
		const name = r.name(o, 20);
		const program = r.u16(o + 20);
		const bank = r.u16(o + 22);
		const b0 = r.u16(o + 24);
		const b1 = r.u16(phdr.offset + (p + 1) * 38 + 24);
		if (b1 < b0) fail("プリセットのゾーンが壊れています");
		const { global: pGlobal, local: pZones } = splitGlobal(
			readZones(r, pbag, pgen, b0, b1),
			GEN.instrument,
		);
		const zones: Sf2Zone[] = [];
		for (const pz of pZones) {
			const instIndex = pz.gens.get(GEN.instrument);
			if (instIndex === undefined) continue;
			const { global: iGlobal, local: iZones } = instZones(instIndex);
			for (const iz of iZones) {
				const sampleIndex = iz.gens.get(GEN.sampleID);
				if (sampleIndex === undefined || sampleIndex >= samples.length)
					continue;
				const s = samples[sampleIndex];
				if (s.rom || s.sampleRate < 1000 || s.sampleRate > 192000) continue;
				const keyLow = Math.max(pz.keyLow, iz.keyLow);
				const keyHigh = Math.min(pz.keyHigh, iz.keyHigh);
				if (keyLow > keyHigh) continue;
				// インストゥルメントの値（無ければグローバル）。プリセットの値は足し算で効く。
				const ig = (op: number, def = 0): number =>
					iz.gens.get(op) ?? iGlobal?.get(op) ?? def;
				const pg = (op: number): number =>
					pz.gens.get(op) ?? pGlobal?.get(op) ?? 0;
				const addr = (fine: number, coarse: number): number =>
					ig(fine) + ig(coarse) * 32768;
				const start =
					s.start + addr(GEN.startAddrsOffset, GEN.startAddrsCoarseOffset);
				const end = s.end + addr(GEN.endAddrsOffset, GEN.endAddrsCoarseOffset);
				const loopStart =
					s.loopStart +
					addr(GEN.startloopAddrsOffset, GEN.startloopAddrsCoarseOffset);
				const loopEnd =
					s.loopEnd +
					addr(GEN.endloopAddrsOffset, GEN.endloopAddrsCoarseOffset);
				if (start < 0 || end > sampleCount || end - start < 2) continue;
				const key = `${start}:${end}`;
				let pcm = pcmCache.get(key);
				if (!pcm) {
					pcm = pcmOf(start, end);
					pcmCache.set(key, pcm);
				}
				const mode = ig(GEN.sampleModes) & 3;
				const loops =
					(mode === 1 || mode === 3) &&
					loopStart >= start &&
					loopEnd <= end &&
					loopEnd - loopStart >= 2;
				const rootOverride = ig(GEN.overridingRootKey, -1);
				const rootKey =
					rootOverride >= 0 && rootOverride <= 127
						? rootOverride
						: s.originalPitch <= 127
							? s.originalPitch
							: 60;
				zones.push({
					keyLow,
					keyHigh,
					rootKey,
					tuneCents:
						(ig(GEN.coarseTune) + pg(GEN.coarseTune)) * 100 +
						ig(GEN.fineTune) +
						pg(GEN.fineTune) +
						s.correction,
					sampleRate: s.sampleRate,
					pcm,
					loop: loops
						? { start: loopStart - start, end: loopEnd - start }
						: null,
				});
			}
		}
		if (zones.length > 0) presets.push({ name, bank, program, zones });
	}
	if (presets.length === 0) fail("鳴らせる楽器がありません");
	return { name: fileName, presets };
};

/**
 * GM のプログラム番号（0〜127）に当たる旋律楽器のプリセットを選ぶ。
 * バンク 0 を優先し、無ければ同じ番号のほかのバンク（ドラムのバンク 128 は除く）。
 */
export const findSf2Preset = (
	sf2: Sf2File,
	program: number,
): Sf2Preset | undefined =>
	sf2.presets.find((p) => p.bank === 0 && p.program === program) ??
	sf2.presets.find((p) => p.bank !== 128 && p.program === program);
