/**
 * 歌声合成Worker — 重いWORLD再合成（worldline.renderNote ≈ 200ms/音）を別スレッドで実行する。
 *
 * classic Web Worker として動かす（koe を同梱した IIFE でビルド）。Worker内では
 * `Worldline.load` が `importScripts` 経由で worldline.js を読み込むため、WASM合成が
 * メインスレッドを一切ブロックしない。メインへは完成PCM（Float32, transfer）だけを返す。
 *
 * このファイルはエイリアス解決やスケジューリングを持たない「合成専用サービス」。
 * エイリアス解決・キャッシュ・Web Audio スケジュールはメイン（lyrics.ts）が担う。
 */

import { leadInFromEntry, VoiceBank, Worldline } from "@onjmin/koe";
import { vibratoPitchCurve } from "./vibrato";
import type {
	VoiceWorkerInbound,
	VoiceWorkerOutbound,
} from "./voice-worker-types";
import { unpackCompositeAlias } from "./voice-worker-types";

const KOE_SAMPLE_RATE = 48000;
/**
 * ピッチ(units) → 周波数(Hz)。単位は 1/372オクターブの整数（A4 = 2139 units = 440Hz）。
 * koe/worldline は Hz を受けるので、31平均律の音もそのまま連続ピッチとして鳴る。
 */
const unitsToFreq = (units: number): number =>
	440 * 2 ** ((units - 2139) / 372);

// DOM/WebWorker の lib 衝突を避けるため、必要な口だけを型付けして globalThis を使う。
const wself = globalThis as unknown as {
	onmessage: ((ev: MessageEvent<VoiceWorkerInbound>) => void) | null;
	postMessage: (msg: VoiceWorkerOutbound, transfer?: Transferable[]) => void;
};

let bank: VoiceBank | null = null;
let worldline: Worldline | null = null;

// 音素PCMのフェッチ結果をキャッシュ（同一音素の再フェッチを避ける）。
const pcmCache = new Map<string, Promise<Float64Array | null>>();
const getPcm = (alias: string): Promise<Float64Array | null> => {
	let p = pcmCache.get(alias);
	if (!p) {
		// biome-ignore lint/style/noNonNullAssertion: init 完了後のみ呼ばれる
		p = bank!.getPcm(alias);
		pcmCache.set(alias, p);
	}
	return p;
};

type Rendered = { pcm: Float32Array; preSec: number; rate: number };

/** 子音単体＋母音単体エイリアスを繋ぎ合わせる際のクロスフェード長（秒）。繋ぎ目のクリックを抑える。 */
const COMPOSITE_SPLICE_XFADE_SEC = 0.005;

/**
 * 子音単体PCM＋母音単体PCMを1本のPCMへ繋ぎ合わせ、WORLD再合成へそのまま渡せる
 * pre/consonant（ms）を計算する。境界を短くリニアクロスフェードして接続音のクリックを防ぐ。
 * どちらかが空、またはクロスフェード幅を確保できないほど短ければ null。
 */
const spliceCompositePcm = (
	consonantPcm: Float64Array,
	vowelPcm: Float64Array,
	sampleRate: number,
): { pcm: Float64Array; preMs: number; consonantMs: number } | null => {
	if (consonantPcm.length === 0 || vowelPcm.length === 0) return null;
	const xfade = Math.min(
		Math.floor(sampleRate * COMPOSITE_SPLICE_XFADE_SEC),
		consonantPcm.length,
		vowelPcm.length,
	);
	const pcm = new Float64Array(consonantPcm.length + vowelPcm.length - xfade);
	pcm.set(consonantPcm, 0);
	for (let i = 0; i < xfade; i++) {
		const t = (i + 1) / (xfade + 1);
		const idx = consonantPcm.length - xfade + i;
		pcm[idx] = consonantPcm[idx] * (1 - t) + vowelPcm[i] * t;
	}
	pcm.set(vowelPcm.subarray(xfade), consonantPcm.length);
	// 母音の立ち上がり（ビート位置）＝子音区間の直後。overlap相当は持たないので
	// pre と consonant を同じ長さにし、子音全体が発音前リードとして再生されるようにする。
	const consonantMs = ((consonantPcm.length - xfade / 2) / sampleRate) * 1000;
	return { pcm, preMs: consonantMs, consonantMs };
};

/**
 * 音源に直接存在しない音節を、子音単体＋母音単体エイリアスを繋いだ合成PCMで代用する。
 * WORLD再合成必須（Worldline不可時の素片フォールバックには非対応）。
 */
const renderComposite = async (
	consonantAlias: string,
	vowelAlias: string,
	pitch: number,
	durationMs: number,
	vibrato: boolean | undefined,
	gender: number | undefined,
	breathiness: number | undefined,
	tension: number | undefined,
): Promise<Rendered | null> => {
	if (!worldline) return null;
	const [consonantPcm, vowelPcm] = await Promise.all([
		getPcm(consonantAlias),
		getPcm(vowelAlias),
	]);
	if (!consonantPcm || !vowelPcm) return null;
	const spliced = spliceCompositePcm(consonantPcm, vowelPcm, KOE_SAMPLE_RATE);
	if (!spliced) return null;
	const targetHz = unitsToFreq(pitch);
	const audio = worldline.renderNote({
		pcm: spliced.pcm,
		pitch: vibrato ? vibratoPitchCurve(targetHz, spliced.preMs) : targetHz,
		durationMs,
		preMs: spliced.preMs,
		consonantMs: spliced.consonantMs,
		gender,
		breathiness,
		tension,
	});
	return audio ? { pcm: audio, preSec: spliced.preMs / 1000, rate: 1 } : null;
};

const renderAlias = async (
	alias: string,
	pitch: number,
	durationMs: number,
	vibrato?: boolean,
	gender?: number,
	breathiness?: number,
	tension?: number,
): Promise<Rendered | null> => {
	if (!bank) return null;
	const composite = unpackCompositeAlias(alias);
	if (composite) {
		return renderComposite(
			composite[0],
			composite[1],
			pitch,
			durationMs,
			vibrato,
			gender,
			breathiness,
			tension,
		);
	}
	const pcm = await getPcm(alias);
	if (!pcm || pcm.length === 0) return null;
	const entry = bank.manifest.phonemes[alias];
	const lead = leadInFromEntry(entry);
	const targetHz = unitsToFreq(pitch);

	if (worldline) {
		const audio = worldline.renderNote({
			pcm,
			pitch: vibrato ? vibratoPitchCurve(targetHz, lead.preMs) : targetHz,
			durationMs,
			...lead,
			gender,
			breathiness,
			tension,
		});
		if (audio) return { pcm: audio, preSec: lead.preMs / 1000, rate: 1 };
	}
	// Worldline不可（軽量モード or 素片が短すぎる）→ 素片をピッチシフト再生
	const rate = entry.pitch > 0 ? targetHz / entry.pitch : 1;
	return {
		pcm: Float32Array.from(pcm),
		preSec: entry.pre / KOE_SAMPLE_RATE / rate,
		rate,
	};
};

wself.onmessage = async (ev) => {
	const msg = ev.data;
	if (msg.type === "init") {
		try {
			bank = await VoiceBank.load(msg.koe);
			worldline = msg.lightweight
				? null
				: await Worldline.load({ scriptUrl: msg.worldlineScriptUrl }).catch(
						() => null,
					);
			wself.postMessage({
				type: "ready",
				aliases: Object.keys(bank.manifest.phonemes),
			});
		} catch (err) {
			wself.postMessage({
				type: "error",
				message: String((err as Error)?.message ?? err),
			});
		}
		return;
	}
	if (msg.type === "render") {
		const {
			id,
			alias,
			pitch,
			durationMs,
			vibrato,
			gender,
			breathiness,
			tension,
		} = msg;
		try {
			const out = await renderAlias(
				alias,
				pitch,
				durationMs,
				vibrato,
				gender,
				breathiness,
				tension,
			);
			if (out) {
				wself.postMessage(
					{
						type: "rendered",
						id,
						pcm: out.pcm,
						preSec: out.preSec,
						rate: out.rate,
					},
					[out.pcm.buffer],
				);
			} else {
				wself.postMessage({ type: "rendered", id, pcm: null });
			}
		} catch {
			wself.postMessage({ type: "rendered", id, pcm: null });
		}
	}
};
