/**
 * 内蔵シンセのドラム音源。SoundFont を持たない環境向けに、GM ドラムキーごとに
 * 胴鳴り（ピッチ降下するサイン）・金属音（非整数比の矩形波の束）・ノイズを組み合わせて近似する。
 */

import type { PlayDrumEvent } from "./types";

/** 立ち上がりに最低限確保する時間（秒）。無音→ピークの段差をプチノイズにしない。 */
export const MIN_ATTACK_SEC = 0.0015;
/** 消え際に最低限確保する時間（秒）。ここで 0 まで落とし切ってから停止する。 */
export const MIN_RELEASE_SEC = 0.004;
/** 指数減衰の到達点（ピークに対する比）。ここから直線で 0 へ繋ぐ。 */
export const TAIL_RATIO = 0.001;

/** TR-808 のシンバル回路の発振比。非整数比なので和音にならず金属的に濁る。 */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
const getNoise = (ctx: BaseAudioContext): AudioBuffer => {
	let buf = noiseBuffers.get(ctx);
	if (!buf) {
		const length = ctx.sampleRate * 2;
		buf = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
		noiseBuffers.set(ctx, buf);
	}
	return buf;
};

type Tom = { from: number; to: number; decay: number };
/** 胴鳴り系（タム・コンガ・ボンゴ等）のキー → 打点周波数・落ち着き先・減衰。 */
const TOMS: Record<number, Tom> = {
	41: { from: 110, to: 70, decay: 0.45 },
	43: { from: 130, to: 85, decay: 0.42 },
	45: { from: 155, to: 100, decay: 0.4 },
	47: { from: 180, to: 120, decay: 0.36 },
	48: { from: 210, to: 140, decay: 0.33 },
	50: { from: 245, to: 165, decay: 0.3 },
	60: { from: 480, to: 420, decay: 0.12 },
	61: { from: 360, to: 310, decay: 0.15 },
	62: { from: 330, to: 300, decay: 0.08 },
	63: { from: 300, to: 270, decay: 0.22 },
	64: { from: 210, to: 190, decay: 0.26 },
	65: { from: 420, to: 380, decay: 0.2 },
	66: { from: 320, to: 290, decay: 0.24 },
};

export type DrumKit = { playDrum: (e: PlayDrumEvent) => void };

export const createDrumKit = (
	ctx: BaseAudioContext,
	out: AudioNode,
): DrumKit => {
	/** オープンハイハットの発音中ゲイン。クローズ/ペダルが鳴ったら止める（チョーク）。 */
	let openHats: { g: GainNode; t0: number; end: number }[] = [];

	/** 0 → peak → 指数減衰 → 0 のエンベロープを張り、鳴り終わり時刻を返す。 */
	const env = (
		g: GainNode,
		t0: number,
		peak: number,
		decay: number,
		attack = MIN_ATTACK_SEC,
	): number => {
		const end = t0 + attack + decay;
		g.gain.setValueAtTime(0, t0);
		g.gain.linearRampToValueAtTime(peak, t0 + attack);
		g.gain.exponentialRampToValueAtTime(peak * TAIL_RATIO, end);
		g.gain.linearRampToValueAtTime(0, end + MIN_RELEASE_SEC);
		return end + MIN_RELEASE_SEC;
	};

	const release = (src: AudioScheduledSourceNode, extra: AudioNode[]) => {
		src.onended = () => {
			src.disconnect();
			for (const n of extra) n.disconnect();
		};
	};

	const tone = (
		t0: number,
		type: OscillatorType,
		from: number,
		to: number,
		sweep: number,
		peak: number,
		decay: number,
		dest: AudioNode = out,
	): OscillatorNode => {
		const osc = ctx.createOscillator();
		const g = ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(from, t0);
		if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + sweep);
		const end = env(g, t0, peak, decay);
		osc.connect(g).connect(dest);
		osc.start(t0);
		osc.stop(end);
		release(osc, [g]);
		return osc;
	};

	const noise = (
		t0: number,
		filterType: BiquadFilterType,
		freq: number,
		q: number,
		peak: number,
		decay: number,
		attack = MIN_ATTACK_SEC,
	): GainNode => {
		const src = ctx.createBufferSource();
		src.buffer = getNoise(ctx);
		const f = ctx.createBiquadFilter();
		f.type = filterType;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		const end = env(g, t0, peak, decay, attack);
		src.connect(f).connect(g).connect(out);
		// バッファ内の開始位置を散らし、連打が毎回同じ波形にならないようにする
		src.start(t0, Math.random() * 1.5);
		src.stop(end);
		release(src, [f, g]);
		return g;
	};

	/** 金属音（ハイハット・シンバル）。base を変えると同じ回路で色味が変わる。 */
	const metal = (
		t0: number,
		base: number,
		bandHz: number,
		hpHz: number,
		peak: number,
		decay: number,
	): GainNode => {
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = bandHz;
		bp.Q.value = 0.8;
		const hp = ctx.createBiquadFilter();
		hp.type = "highpass";
		hp.frequency.value = hpHz;
		const g = ctx.createGain();
		const end = env(g, t0, peak, decay);
		bp.connect(hp).connect(g).connect(out);
		const oscs = METAL_RATIOS.map((r) => {
			const osc = ctx.createOscillator();
			osc.type = "square";
			osc.frequency.value = base * r;
			osc.connect(bp);
			osc.start(t0);
			osc.stop(end);
			return osc;
		});
		release(oscs[0], [...oscs.slice(1), bp, hp, g]);
		return g;
	};

	const chokeOpenHats = (t: number) => {
		openHats = openHats.filter((h) => h.end > t);
		for (const h of openHats) {
			if (h.t0 >= t) continue;
			const p = h.g.gain;
			if (typeof p.cancelAndHoldAtTime === "function") p.cancelAndHoldAtTime(t);
			else p.cancelScheduledValues(t);
			p.linearRampToValueAtTime(0, t + 0.012);
		}
		openHats = openHats.filter((h) => h.t0 >= t);
	};

	const playDrum = (e: PlayDrumEvent): void => {
		const t0 = ctx.currentTime + Math.max(0, e.when);
		const v = Math.max(0.0001, Math.min(1, e.velocity));
		const k = e.pitch;

		switch (k) {
			case 35:
			case 36:
				// 胴（ピッチが急降下するサイン）＋ビーターのアタック
				tone(t0, "sine", 170, 48, 0.07, v * 0.34, 0.38);
				tone(t0, "triangle", 900, 120, 0.012, v * 0.12, 0.012);
				noise(t0, "highpass", 3500, 0.7, v * 0.05, 0.008);
				return;
			case 38:
			case 40: {
				const bright = k === 40 ? 1.15 : 1;
				tone(t0, "triangle", 240 * bright, 180 * bright, 0.03, v * 0.26, 0.09);
				tone(t0, "sine", 400 * bright, 330 * bright, 0.03, v * 0.1, 0.05);
				noise(t0, "highpass", 1800, 0.7, v * 0.26, 0.16);
				noise(t0, "bandpass", 5000, 0.9, v * 0.12, 0.1);
				return;
			}
			case 37:
				// サイドスティック：短い高めの胴＋乾いたクリック
				tone(t0, "triangle", 1650, 1500, 0.01, v * 0.16, 0.035);
				tone(t0, "sine", 480, 440, 0.01, v * 0.1, 0.04);
				noise(t0, "bandpass", 3000, 2, v * 0.08, 0.02);
				return;
			case 39:
				// ハンドクラップ：数人がずれて叩く＝短いバーストを少しずつ遅らせて重ねる
				for (const [d, a] of [
					[0, 0.4],
					[0.011, 0.36],
					[0.023, 0.32],
				])
					noise(t0 + d, "bandpass", 1300, 1.4, v * a, 0.012);
				noise(t0 + 0.031, "bandpass", 1300, 1.2, v * 0.32, 0.16);
				return;
			case 42:
				chokeOpenHats(t0);
				metal(t0, 40, 10000, 7000, v * 0.3, 0.045);
				noise(t0, "highpass", 8000, 0.7, v * 0.05, 0.035);
				return;
			case 44:
				chokeOpenHats(t0);
				metal(t0, 40, 9000, 6500, v * 0.22, 0.07);
				return;
			case 46: {
				const g = metal(t0, 40, 10000, 7000, v * 0.26, 0.42);
				noise(t0, "highpass", 8000, 0.7, v * 0.04, 0.3);
				openHats.push({ g, t0, end: t0 + 0.45 });
				return;
			}
			case 49:
			case 57:
				metal(t0, k === 57 ? 44 : 38, 8000, 4500, v * 0.14, 1.6);
				noise(t0, "highpass", 5500, 0.7, v * 0.07, 1.3);
				return;
			case 52:
				metal(t0, 34, 6000, 3000, v * 0.16, 1.2);
				noise(t0, "bandpass", 4500, 0.6, v * 0.07, 0.9);
				return;
			case 55:
				metal(t0, 48, 9000, 6000, v * 0.2, 0.6);
				noise(t0, "highpass", 7000, 0.7, v * 0.08, 0.45);
				return;
			case 51:
			case 59:
				metal(t0, k === 59 ? 52 : 48, 7000, 5000, v * 0.14, 0.9);
				tone(t0, "sine", 3100, 3100, 0, v * 0.03, 0.5);
				return;
			case 53:
				metal(t0, 52, 6500, 3500, v * 0.12, 0.8);
				tone(t0, "sine", 1480, 1480, 0, v * 0.1, 0.9);
				tone(t0, "sine", 2210, 2210, 0, v * 0.06, 0.6);
				return;
			case 56: {
				// カウベル：2つの矩形波をバンドパスで丸める（808 と同じ構成）
				const bp = ctx.createBiquadFilter();
				bp.type = "bandpass";
				bp.frequency.value = 900;
				bp.Q.value = 1.5;
				bp.connect(out);
				tone(t0, "square", 562, 562, 0, v * 0.14, 0.26, bp);
				const last = tone(t0, "square", 845, 845, 0, v * 0.14, 0.26, bp);
				last.addEventListener("ended", () => bp.disconnect());
				return;
			}
			case 54:
				noise(t0, "highpass", 7000, 0.7, v * 0.12, 0.06, 0.004);
				metal(t0, 70, 9000, 7000, v * 0.08, 0.12);
				return;
			case 69:
			case 70:
			case 82:
				noise(t0, "highpass", 6000, 0.7, v * 0.12, 0.05, 0.006);
				return;
			case 67:
			case 68: {
				// アゴゴ：鐘なので基音と非整数倍の上音
				const f = k === 67 ? 920 : 690;
				tone(t0, "triangle", f, f, 0, v * 0.14, 0.18);
				tone(t0, "sine", f * 2.66, f * 2.66, 0, v * 0.05, 0.12);
				return;
			}
			case 75:
				tone(t0, "sine", 2500, 2500, 0, v * 0.2, 0.04);
				return;
			case 76:
			case 77: {
				const f = k === 76 ? 900 : 700;
				tone(t0, "sine", f, f, 0, v * 0.2, 0.05);
				tone(t0, "triangle", f * 2.3, f * 2.3, 0, v * 0.05, 0.02);
				return;
			}
			case 81:
				tone(t0, "sine", 5200, 5200, 0, v * 0.06, 0.9);
				tone(t0, "sine", 7650, 7650, 0, v * 0.03, 0.6);
				return;
			case 80:
				tone(t0, "sine", 5200, 5200, 0, v * 0.06, 0.12);
				tone(t0, "sine", 7650, 7650, 0, v * 0.03, 0.08);
				return;
		}

		const tom = TOMS[k];
		if (tom) {
			tone(t0, "sine", tom.from, tom.to, tom.decay * 0.6, v * 0.34, tom.decay);
			noise(t0, "bandpass", tom.from * 8, 1, v * 0.04, 0.02);
			return;
		}
		// 未対応キー：素のノイズより当たりの柔らかい短いパーカッション
		noise(t0, "bandpass", 2500, 1, v * 0.1, 0.05);
	};

	return { playDrum };
};
