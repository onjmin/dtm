/**
 * 外部のサウンドフォント（.sf2）を、トラックの音源バンクの1つ（{@link EXTERNAL_SF2_BANK}）として鳴らす。
 *
 * - 読み込み元は1つ（URL かローカルのファイル）。URL は MML の `#sf2=` に書けるが、ファイルは
 *   書けない（受け取った相手の手元に無いため。同時再生の音声と同じ扱い）。
 * - .sf2 はデータとしてだけ読む（{@link parseSf2}）。配信元の WebAudioFont のように
 *   `<script>` で JS を実行することはしない。URL は http / https だけ（{@link normalizeMediaUrl}）、
 *   大きさは {@link MAX_SF2_BYTES} まで。
 * - トラックの楽器（GM のプログラム番号）に当たるプリセットを選ぶ。無ければ呼び出し側が
 *   既定の FluidR3 で鳴らす（studio.ts の loadInstrument）。
 * - ドラム（バンク 128）は今は使わない。
 */

import { normalizeMediaUrl } from "../../mml/mml-parser";
import { sanitizeText } from "../../safe-text";
import { SoundFont } from "./SoundFont";
import {
	findSf2Preset,
	MAX_SF2_BYTES,
	parseSf2,
	type Sf2File,
	type Sf2Preset,
} from "./sf2-parser";

/** 外部 SF2 を指す音源バンク名（`#t<n>font=ExtSF2`）。 */
export const EXTERNAL_SF2_BANK = "ExtSF2";

/** バンク名が外部 SF2 か（大小文字は問わない）。 */
export const isExternalSf2Bank = (bank: string | null | undefined): boolean =>
	(bank ?? "").toLowerCase() === EXTERNAL_SF2_BANK.toLowerCase();

type Source = {
	/** 差し替えのたびに増える番号（読み込み済みの楽器のキャッシュを分けるため）。 */
	gen: number;
	/** 表示名（ファイル名か URL のホスト）。 */
	label: string;
	/** MML に書ける URL（ファイルのときは空）。 */
	url: string;
	/** 読み込み（最初に呼ばれたときに取りに行き、以降は同じ結果を返す）。 */
	file: () => Promise<Sf2File>;
	/** もう取りに行ったか。 */
	started: () => boolean;
};

/** 最初に呼ばれたときだけ動かす。 */
const lazy = (
	f: () => Promise<Sf2File>,
): { file: () => Promise<Sf2File>; started: () => boolean } => {
	let p: Promise<Sf2File> | null = null;
	return {
		file: () => {
			p ??= f();
			p.catch(() => {});
			return p;
		},
		started: () => p !== null,
	};
};

let current: Source | null = null;
let generation = 0;

/** 上限つきで URL を読む（Content-Length を信じず、読みながら数える）。 */
const fetchLimited = async (url: string): Promise<ArrayBuffer> => {
	const res = await fetch(url, { credentials: "omit", redirect: "follow" });
	if (!res.ok) throw new Error(`SoundFont を取得できません（${res.status}）`);
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_SF2_BYTES)
		throw new Error("SoundFont が大きすぎます");
	if (!res.body) return res.arrayBuffer();
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_SF2_BYTES) {
			await reader.cancel();
			throw new Error("SoundFont が大きすぎます");
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.byteLength;
	}
	return out.buffer;
};

/**
 * 外部 SF2 の読み込み元を差し替える（null で外す）。取りに行くのは、最初に楽器が要るとき
 * （再生の前）か {@link getExternalSf2Status} を呼んだとき。共有リンクを開いただけで
 * 第三者の URL へ要求が飛ばないようにするため。URL が使えない形なら例外。
 */
export const setExternalSf2Source = (src: File | string | null): void => {
	generation++;
	if (src === null) {
		current = null;
		return;
	}
	if (typeof src === "string") {
		const url = normalizeMediaUrl(src);
		if (!url)
			throw new Error(
				"使えない URL です（http / https で、空白・; ・# などの記号を含まないもの）",
			);
		let host = url;
		try {
			host = new URL(url).host;
		} catch {
			// 表示だけ
		}
		current = {
			gen: generation,
			label: host,
			url,
			...lazy(() => fetchLimited(url).then(parseSf2)),
		};
	} else {
		if (src.size > MAX_SF2_BYTES)
			throw new Error(
				`SoundFont が大きすぎます（${Math.round(MAX_SF2_BYTES / 1024 / 1024)}MB まで）`,
			);
		current = {
			gen: generation,
			label: sanitizeText(src.name, 120),
			url: "",
			...lazy(() => src.arrayBuffer().then(parseSf2)),
		};
	}
};

/** 読み込み元があり、まだ取りに行っていないか（表示用）。 */
export const isExternalSf2Pending = (): boolean =>
	!!current && !current.started();

/** いまの読み込み元の URL（MML の `#sf2=` に書く。ファイルや未設定なら undefined）。 */
export const getExternalSf2Url = (): string | undefined =>
	current?.url || undefined;

/** 読み込みの結果（表示用）。 */
export const getExternalSf2Status = async (): Promise<
	| { state: "none" }
	| { state: "ok"; label: string; name: string; presets: number }
	| { state: "error"; label: string; message: string }
> => {
	const src = current;
	if (!src) return { state: "none" };
	try {
		const f = await src.file();
		return {
			state: "ok",
			label: src.label,
			name: sanitizeText(f.name, 80),
			presets: f.presets.length,
		};
	} catch (e) {
		return {
			state: "error",
			label: src.label,
			message: e instanceof Error ? e.message : String(e),
		};
	}
};

/** プリセットを、既存の再生の仕組み（{@link SoundFont}）が受け取るゾーンにする。 */
const presetZones = (ctx: AudioContext, preset: Sf2Preset) =>
	preset.zones.map((z) => {
		const buffer = ctx.createBuffer(1, z.pcm.length, z.sampleRate);
		buffer.copyToChannel(z.pcm, 0);
		return {
			keyRangeLow: z.keyLow,
			keyRangeHigh: z.keyHigh,
			sampleRate: z.sampleRate,
			loopStart: z.loop?.start ?? 0,
			loopEnd: z.loop?.end ?? 0,
			// 再生側の式: rate = 2^((100*pitch - (originalPitch - 100*coarse - fine)) / 1200)
			originalPitch: z.rootKey * 100,
			coarseTune: 0,
			fineTune: z.tuneCents,
			sustain: 0,
			delay: 0,
			buffer,
		};
	});

/**
 * 外部 SF2 から、GM のプログラム番号（0〜127）に当たる楽器を読む。
 * 読み込み元が無い・壊れている・その番号の楽器が無いときは例外（呼び出し側が FluidR3 へ落とす）。
 */
export const loadExternalSf2Instrument = async (
	ctx: AudioContext,
	program: number,
): Promise<SoundFont> => {
	const src = current;
	if (!src) throw new Error("外部 SoundFont が読み込まれていません");
	if (!Number.isInteger(program) || program < 0 || program > 127)
		throw new Error("楽器の番号が不正です");
	const f = await src.file();
	const preset = findSf2Preset(f, program);
	if (!preset) throw new Error(`外部 SoundFont に楽器 ${program} がありません`);
	const ppp = String(program).padStart(3, "0");
	return SoundFont.fromZones({
		ctx,
		// `_tone_PPP0_` で始めると、楽器の種別（ベース・ギター等）の判定が FluidR3 と同じになる。
		fontName: `_tone_${ppp}0_${EXTERNAL_SF2_BANK}_g${src.gen}`,
		zones: presetZones(ctx, preset),
	});
};
