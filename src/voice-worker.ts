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
import type {
	VoiceWorkerInbound,
	VoiceWorkerOutbound,
} from "./voice-worker-types";

const KOE_SAMPLE_RATE = 48000;
const midiToFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);

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

const renderAlias = async (
	alias: string,
	pitch: number,
	durationMs: number,
): Promise<Rendered | null> => {
	if (!bank) return null;
	const pcm = await getPcm(alias);
	if (!pcm || pcm.length === 0) return null;
	const entry = bank.manifest.phonemes[alias];
	const lead = leadInFromEntry(entry);
	const targetHz = midiToFreq(pitch);

	if (worldline) {
		const audio = worldline.renderNote({
			pcm,
			pitch: targetHz,
			durationMs,
			...lead,
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
		const { id, alias, pitch, durationMs } = msg;
		try {
			const out = await renderAlias(alias, pitch, durationMs);
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
