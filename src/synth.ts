/**
 * 内蔵の簡易square-wave synth + ノイズ系ドラム音。
 *
 * もともと mml-player.ts の中にインラインで持っていたものを、DOM非依存の発音器として
 * 切り出したもの。これにより mountMmlPlayer（DOMビュー）と playMML（ヘッドレス）の双方が
 * 同じ発音ロジックを共有できる。
 *
 * 設計上、AudioContext と出力先ノードは「外から渡す」。これは利用側が自前のマスターGain /
 * ミキサーへルーティングしたり、SE と AudioContext を共有したりできるようにするため。
 */

import type { PlayDrumEvent, PlayNoteEvent } from "./types";

/** MIDIピッチ番号 → 周波数(Hz)。A4(69)=440Hz 基準。 */
export const freqFromPitch = (pitch: number): number =>
	440 * 2 ** ((pitch - 69) / 12);

export type Synth = {
	/** メロディックノートを発音する（PlayNoteEvent.when は ctx.currentTime からの相対秒） */
	playNote: (e: PlayNoteEvent) => void;
	/** ドラムノートを発音する（General MIDI のドラムキー番号で音色を分岐） */
	playDrum: (e: PlayDrumEvent) => void;
};

/** createSynth の音色設定。省略時は従来どおりの square 持続音。 */
export type SynthTone = {
	/** オシレータ波形。既定 "square" */
	wave?: OscillatorType;
	/** アタック秒（0 で即時立ち上がり）。既定 0 */
	attack?: number;
	/** true でピアノ/ギター的な指数減衰（持続音でなく減衰音になる） */
	decay?: boolean;
	/** 波形ごとの聴感補正に使う音量倍率。既定 1 */
	gain?: number;
};

/**
 * AudioContext と出力先ノードを束ねた発音器を作る。
 * @param ctx 発音に使う AudioContext
 * @param destination 接続先（省略時は ctx.destination）。ゲーム側ミキサーへ繋ぐ用途。
 * @param tone 音色設定（波形・エンベロープ）。省略時は従来の square 持続音。
 */
export const createSynth = (
	ctx: AudioContext,
	destination: AudioNode = ctx.destination,
	tone: SynthTone = {},
): Synth => {
	const wave = tone.wave ?? "square";
	const attack = tone.attack ?? 0;
	const gainScale = tone.gain ?? 1;

	const playNote = (e: PlayNoteEvent): void => {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = wave;
		osc.frequency.value = freqFromPitch(e.pitch);
		const t0 = ctx.currentTime + e.when;
		const peak = Math.max(0.0001, 0.06 * e.volume * 1.5 * gainScale);
		if (tone.decay) {
			// 減衰音（ピアノ/ギター系）: 立ち上がり後にノート長いっぱいで指数減衰
			gain.gain.setValueAtTime(0.0001, t0);
			gain.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.003, attack));
			gain.gain.exponentialRampToValueAtTime(0.001, t0 + e.duration);
		} else {
			const releaseTime = Math.min(0.02, e.duration * 0.1);
			const sustainDuration = e.duration - releaseTime;
			if (attack > 0) {
				gain.gain.setValueAtTime(0.0001, t0);
				gain.gain.linearRampToValueAtTime(
					peak,
					t0 + Math.min(attack, sustainDuration),
				);
			} else {
				gain.gain.setValueAtTime(peak, t0);
			}
			gain.gain.setValueAtTime(peak, t0 + sustainDuration);
			gain.gain.exponentialRampToValueAtTime(0.001, t0 + e.duration);
		}
		osc.connect(gain);
		// ステレオ定位（非対応環境では destination 直結）
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function" && e.pan) {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, e.pan));
			gain.connect(panner);
			panner.connect(destination);
		} else {
			gain.connect(destination);
		}
		osc.start(t0);
		osc.stop(t0 + e.duration + 0.02);

		osc.onended = () => {
			osc.disconnect();
			gain.disconnect();
			if (panner) panner.disconnect();
		};
	};

	// 簡易ドラム音。SoundFontを持たないため、キック/スネア/ハイハットを
	// オシレータ＋ノイズで近似する。pitch は General MIDI 準拠のドラムキー番号。
	const playDrum = (e: PlayDrumEvent): void => {
		const t0 = ctx.currentTime + e.when;
		const vol = Math.max(0.0001, Math.min(1, e.velocity));
		const isKick = e.pitch === 35 || e.pitch === 36;
		const isSnareLike = e.pitch === 38 || e.pitch === 39 || e.pitch === 40;
		if (isKick) {
			// キック: 低音サインのピッチダウン
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.frequency.setValueAtTime(150, t0);
			osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
			g.gain.setValueAtTime(vol * 0.9, t0);
			g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
			osc.connect(g).connect(destination);
			osc.start(t0);
			osc.stop(t0 + 0.2);
			osc.onended = () => osc.disconnect();
			return;
		}
		// スネア/ハイハット/その他: ノイズバースト（スネアは帯域広め＋胴鳴り）
		const dur = isSnareLike ? 0.18 : 0.05;
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const filter = ctx.createBiquadFilter();
		filter.type = isSnareLike ? "bandpass" : "highpass";
		filter.frequency.value = isSnareLike ? 2000 : 8000;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol * (isSnareLike ? 0.7 : 0.4), t0);
		g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		src.connect(filter).connect(g).connect(destination);
		src.start(t0);
		src.stop(t0 + dur);
		src.onended = () => {
			src.disconnect();
			filter.disconnect();
			g.disconnect();
		};
	};

	return { playNote, playDrum };
};
