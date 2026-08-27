/**
 * @credits rpgen3 https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs (MIT)
 * https://github.com/surikov/webaudiofontdata/
 */
import { getScript } from "./import";

type Zone = {
	keyRangeLow: number;
	keyRangeHigh: number;
	sample?: string;
	file?: string;
	sampleRate: number;
	loopStart: number;
	loopEnd: number;
	coarseTune: number;
	fineTune: number;
	originalPitch: number;
	sustain: number;
	delay: number;
	buffer?: AudioBuffer;
	_param?: {
		playbackRate: number;
		max: number;
		src: { loop: boolean; loopStart?: number; loopEnd?: number };
	};
};

export class SoundFont {
	static afterTime = 0.5;
	static fonts = new Map<string, SoundFont>();
	static ch = -1;

	// ── ヒューマナイズ（疑似ラウンドロビン）──
	// サンプルを複数持たない代わりに、発音のたびピッチと音量をごく僅かにランダムへ
	// ブレさせて「毎回寸分違わず同じ波形」という機械的な均一さを崩す。
	/** 発音ごとのピッチ微揺らぎ幅（セント、±この値の範囲で一様乱数）。 */
	static humanizeDetuneCents = 4;
	/** 発音ごとの音量微揺らぎ幅（比率、0.06 = ±6%の範囲で一様乱数）。 */
	static humanizeGainRatio = 0.06;

	// ── ベロシティ→明るさ連動フィルタ ──
	// velocity は音量にしか効かず音色（明るさ）が変わらないのを補うため、
	// ローパスのカットオフを velocity に連動させる（弱いほど丸く、強いほど明るく）。
	// 連動元は必ず velocity であって volume ではない。volume には
	// 「トラック音量フェーダー×velocity」が既に畳み込まれている（sequencer.ts参照）ため、
	// volume を使うとフェーダーを下げただけで音色まで暗くなり、音量がゲインと音色へ
	// 二重に効いてしまう。音量フェーダーは音色を変えてはならない。
	/** velocity=0 のときのローパスカットオフ(Hz)。 */
	static brightnessMinHz = 2400;
	/** velocity=127 のときのローパスカットオフ(Hz)。サンプルの帯域を実質塞がない値。 */
	static brightnessMaxHz = 20000;
	/** ベロシティ→明るさフィルタのQ値。共鳴が付かないButterworth特性。 */
	static brightnessQ = Math.SQRT1_2;
	/**
	 * この明るさ比率以上ならフィルタ自体を挿入しない。最強ベロシティの音は改修前と
	 * 完全に同一の信号経路を通り、余計な音痩せや位相変化が起きないようにするため。
	 */
	static brightnessBypassAbove = 0.98;

	// ── ロングトーン用ビブラート(ピッチLFO) ──
	// 伸ばす音が完全に静止していると不自然に聞こえるため、一定長以上持続する
	// 音符にだけ、発音直後フェードインしつつ穏やかなピッチ揺れを掛ける。
	// 閾値・速さは歌声合成側の vibrato.ts (VIBRATO_MIN_SEC/VIBRATO_RATE_HZ) と
	// 同じ考え方だが、MIDI楽器はここでは独立した定数として持つ
	// （koeのCurveInput契約に縛られない汎用のWeb Audio LFOのため）。
	/** ロングトーン判定の最短秒数。これ未満の音符にはビブラートを掛けない。 */
	static longToneThresholdSec = 0.35;
	/** ロングトーンビブラートの速さ(Hz)。 */
	static vibratoRateHz = 5.5;
	/** ロングトーンビブラートの深さ(セント)。歌声用(±35セント)より控えめ。 */
	static vibratoDepthCents = 12;
	/** ロングトーンビブラートのフェードイン秒数。発音直後は素直な音程を保つ。 */
	static vibratoFadeSec = 0.2;

	static toURL(fontName: string): string {
		return `https://surikov.github.io/webaudiofontdata/sound/${fontName}.js`;
	}

	static async load({
		ctx,
		fontName,
		url,
		isDrum = false,
		pitchs,
	}: {
		ctx: AudioContext;
		fontName: string;
		url: string;
		isDrum?: boolean;
		pitchs?: number[];
	}): Promise<SoundFont> {
		if (!(fontName in window)) await getScript(url);
		if (!(fontName in window)) throw new Error("SoundFont is not found.");
		const { fonts } = SoundFont;
		if (!fonts.has(fontName)) {
			const zones = new Map<number, Zone>();
			let ch = -1;
			const win = window as unknown as Record<string, { zones: Zone[] }>;
			for (const [pitch, v] of await findZone(
				ctx,
				fontName,
				win[fontName].zones,
				pitchs,
			)) {
				if (!v.buffer) continue;
				const { numberOfChannels } = v.buffer;
				if (ch < numberOfChannels) ch = numberOfChannels;
				zones.set(Number(pitch), v);
			}
			if (SoundFont.ch < ch) SoundFont.ch = ch;
			fonts.set(fontName, new SoundFont(zones, ch, isDrum));
		}
		const result = fonts.get(fontName);
		if (!result) throw new Error("SoundFont load failed.");
		return result;
	}

	constructor(
		private zones: Map<number, Zone>,
		public ch: number,
		public isDrum: boolean,
	) {}

	play({
		ctx,
		destination,
		pitch = 60,
		volume = 1.0,
		velocity,
		when = 0.0,
		duration = 1.0,
	}: {
		ctx?: AudioContext;
		destination?: AudioNode;
		pitch?: number;
		volume?: number;
		/**
		 * 元ノートのベロシティ 0-127。ベロシティ→明るさ連動にのみ使い、音量には影響しない
		 * （音量は volume が担う）。未指定なら最強打として扱いフィルタを挿入しないので、
		 * velocity を渡さない既存の呼び出し元は改修前と同じ信号経路のままになる。
		 */
		velocity?: number;
		when?: number;
		duration?: number;
	} = {}): void {
		ctx ??= new AudioContext();
		destination ??= ctx.destination;
		const { zones, isDrum } = this;
		if (!zones.has(pitch)) return;
		const zone = zones.get(pitch);
		if (!zone) return;
		const src = ctx.createBufferSource();
		const g = ctx.createGain();
		const _when = when + ctx.currentTime;
		const { buffer, _param } = zone;
		if (!buffer || !_param) return;
		src.buffer = buffer;
		src.playbackRate.setValueAtTime(_param.playbackRate, 0);
		Object.assign(src, _param.src);

		// ヒューマナイズ: 発音ごとにピッチと音量をごく僅かにランダムへブレさせる。
		const humanizeCents =
			(Math.random() * 2 - 1) * SoundFont.humanizeDetuneCents;
		const humanizeGainMul =
			1 + (Math.random() * 2 - 1) * SoundFont.humanizeGainRatio;
		src.detune.setValueAtTime(humanizeCents, 0);
		const effectiveVolume = volume * humanizeGainMul;

		// ベロシティ→明るさ連動フィルタ: 弱いほど丸く、強いほど明るく。
		// 連動元は velocity のみ。volume（＝トラック音量フェーダー込み）は使わない。
		// velocity 未指定の呼び出し元は最強打扱いにしてフィルタを挿入しない。
		const brightness =
			velocity === undefined ? 1 : Math.max(0, Math.min(1, velocity / 127));
		const filter =
			brightness >= SoundFont.brightnessBypassAbove
				? undefined
				: ctx.createBiquadFilter();
		if (filter) {
			filter.type = "lowpass";
			filter.frequency.setValueAtTime(
				SoundFont.brightnessMinHz +
					(SoundFont.brightnessMaxHz - SoundFont.brightnessMinHz) * brightness,
				0,
			);
			filter.Q.setValueAtTime(SoundFont.brightnessQ, 0);
		}

		// Start with 0 volume at currentTime to avoid clicking on connection
		g.gain.setValueAtTime(0, ctx.currentTime);
		const attackTime = 0.005; // 5ms fade-in
		const startGainTime = Math.max(ctx.currentTime, _when);
		g.gain.setValueAtTime(0, startGainTime);
		g.gain.linearRampToValueAtTime(effectiveVolume, startGainTime + attackTime);

		const _duration = duration + SoundFont.afterTime;
		const end =
			_when +
			(isDrum
				? buffer.duration
				: src.loop
					? _duration
					: Math.min(_duration, _param.max));

		if (!isDrum) {
			g.gain.setValueAtTime(effectiveVolume, startGainTime + attackTime);
			g.gain.linearRampToValueAtTime(0, end);
		}

		if (filter) src.connect(filter).connect(g);
		else src.connect(g);
		g.connect(destination);

		// ロングトーン用ビブラート: 歌モノ以外のMIDI楽器は伸ばす音が完全に静止していた
		// ため、一定長以上の音符にだけ発音直後フェードインしつつピッチLFOを掛ける。
		let vibratoOsc: OscillatorNode | undefined;
		let vibratoDepth: GainNode | undefined;
		if (!isDrum && duration >= SoundFont.longToneThresholdSec) {
			vibratoOsc = ctx.createOscillator();
			vibratoOsc.type = "sine";
			vibratoOsc.frequency.setValueAtTime(SoundFont.vibratoRateHz, 0);
			vibratoDepth = ctx.createGain();
			vibratoDepth.gain.setValueAtTime(0, startGainTime);
			vibratoDepth.gain.linearRampToValueAtTime(
				SoundFont.vibratoDepthCents,
				startGainTime + SoundFont.vibratoFadeSec,
			);
			vibratoOsc.connect(vibratoDepth).connect(src.detune);
			vibratoOsc.start(_when);
			vibratoOsc.stop(end);
		}

		src.start(_when);
		src.stop(end);

		src.onended = () => {
			src.disconnect();
			filter?.disconnect();
			g.disconnect();
			vibratoOsc?.disconnect();
			vibratoDepth?.disconnect();
		};
	}
}

const findZone = (
	ctx: AudioContext,
	fontName: string,
	zones: Zone[],
	pitchs: number[] = [],
): Promise<[number, Zone][]> => {
	if (!pitchs.length)
		for (const zone of zones) {
			const low = zone.keyRangeLow | 0,
				high = zone.keyRangeHigh | 0;
			if (low > high) continue;
			for (let i = low; i <= high; i++) pitchs.push(i);
		}
	const set = new Set(pitchs);
	const map = new Map<number, Zone>(pitchs.map((v) => [v, zones[0]]));
	for (let i = zones.length - 1; i >= 0; i--)
		for (const v of set) {
			const zone = zones[i];
			if (v < zone.keyRangeLow || v > zone.keyRangeHigh) continue;
			set.delete(v);
			map.set(v, { ...zone });
		}
	return Promise.all(
		[...map].map(async ([k, v]) => {
			await adjustZone(ctx, fontName, v);
			await addParam(v, k);
			return [k, v] as [number, Zone];
		}),
	);
};

const isDecayInstrument = (fontName: string): boolean => {
	const match = fontName.match(/_tone_(\d+)_/);
	if (!match) return false;
	const program = Math.floor(Number(match[1]) / 10);
	if (0 <= program && program <= 15) return true; // Pianos, Chromatic Percussion
	if (24 <= program && program <= 37) return true; // Guitars, Basses (Synth Bass 38, 39 are sustain)
	if (program === 46) return true; // Harp
	if (104 <= program && program <= 119) return true; // Ethnic, Percussive
	return false;
};

const adjustZone = async (
	ctx: AudioContext,
	fontName: string,
	zone: Zone,
): Promise<void> => {
	if (zone.buffer) return;
	zone.delay = 0;
	if (zone.sample) {
		const decoded = atob(zone.sample);
		zone.buffer = ctx.createBuffer(1, decoded.length / 2, zone.sampleRate);
		const a = zone.buffer.getChannelData(0);
		for (let i = 0; i < decoded.length / 2; i++) {
			let b1 = decoded.charCodeAt(i * 2),
				b2 = decoded.charCodeAt(i * 2 + 1);
			if (b1 < 0) b1 = 0x100 + b1;
			if (b2 < 0) b2 = 0x100 + b2;
			let n = b2 * 0x100 + b1;
			if (n >= 0x10000 / 2) n = n - 0x10000;
			a[i] = n / 0x10000;
		}
	} else if (zone.file) {
		const bytes = Uint8Array.from(atob(zone.file), (c) => c.charCodeAt(0));
		const buf = bytes.buffer;

		// macOS Safari はスリープ復帰後に AudioContext を "interrupted" 状態にする。
		// その状態で decodeAudioData を呼ぶと "null is not an object" エラーになるため、
		// interrupted のときだけ resume を試みる（"suspended" は autoplay 制限で resume が
		// ユーザー操作なしに完了しないため除外する）。
		if ((ctx.state as string) === "interrupted") {
			try {
				await ctx.resume();
			} catch {}
		}
		try {
			zone.buffer = await ctx.decodeAudioData(buf);
		} catch (e) {
			console.error(
				`[zone.file format] keyRange: ${zone.keyRangeLow}-${zone.keyRangeHigh} - Decode failed:`,
				e,
			);
			throw e;
		}
	}

	// ループ拡張ロジック（Safari等の超短周期ループバグ対策）
	// ループ範囲が30ms（0.03秒）未満の場合、ループ部分を自前で複製して引き伸ばす
	if (zone.buffer && zone.loopStart >= 1 && zone.loopStart < zone.loopEnd) {
		const loopLenSeconds = (zone.loopEnd - zone.loopStart) / zone.sampleRate;
		if (loopLenSeconds < 0.03) {
			const oldBuf = zone.buffer;
			const sampleRate = oldBuf.sampleRate;
			const rateRatio = sampleRate / zone.sampleRate;
			const loopStartFrame = Math.round(zone.loopStart * rateRatio);
			const loopEndFrame = Math.round(zone.loopEnd * rateRatio);
			const loopLengthFrame = loopEndFrame - loopStartFrame;

			if (loopLengthFrame > 0) {
				const minLoopLenFrame = Math.round(0.2 * sampleRate); // 0.2秒（200ms）を目標にする
				const repeatCount = Math.ceil(minLoopLenFrame / loopLengthFrame);
				const attackLength = Math.min(loopStartFrame, oldBuf.length);
				const releaseLength = Math.max(0, oldBuf.length - loopEndFrame);
				const newLength =
					attackLength + loopLengthFrame * repeatCount + releaseLength;
				let totalPeak = 0;
				let loopPeak = 0;
				// 全チャンネルを見てピークを取る（ch0だけだとステレオでピークが
				// 右chに寄っているサンプルの判定がずれるため）
				for (let ch = 0; ch < oldBuf.numberOfChannels; ch++) {
					const chData = oldBuf.getChannelData(ch);
					for (let i = 0; i < chData.length; i++) {
						const abs = Math.abs(chData[i]);
						if (abs > totalPeak) totalPeak = abs;
						if (i >= loopStartFrame && i < loopEndFrame) {
							if (abs > loopPeak) loopPeak = abs;
						}
					}
				}

				// ゲイン補正倍率の計算
				// 減衰系楽器（ピアノ・ギター・ベース等）はループ部分が静かいのが自然な
				// 場合も多いため、完全に補正を切るのではなく控えめな目標値に留める。
				// これにより「バグでたまたま無音に近いループ点を掴んだ」場合の
				// 過度な音量低下は緩和しつつ、自然な減衰感は大きく損なわない。
				const decay = isDecayInstrument(fontName);
				const targetRatio = decay ? 0.4 : 0.75;
				const maxMultiplier = decay ? 6.0 : 20.0;
				let gainMultiplier = 1.0;
				if (loopPeak > 0 && totalPeak > 0 && loopPeak < totalPeak * 0.8) {
					gainMultiplier = (totalPeak * targetRatio) / loopPeak;
					if (gainMultiplier > maxMultiplier) gainMultiplier = maxMultiplier; // 過剰増幅によるクリップ防止
				}

				try {
					const newBuf = ctx.createBuffer(
						oldBuf.numberOfChannels,
						newLength,
						sampleRate,
					);
					for (let ch = 0; ch < oldBuf.numberOfChannels; ch++) {
						const oldData = oldBuf.getChannelData(ch);
						const newData = newBuf.getChannelData(ch);

						// アタック部分をコピーしつつ、ゲイン補正倍率を 1.0 から gainMultiplier へ緩やかに遷移させる
						// これにより、アタック（等倍）からループ（ブースト）への切り替わりでのクリックノイズを完全に防止する
						for (let i = 0; i < attackLength; i++) {
							const ratio = attackLength > 1 ? i / (attackLength - 1) : 0;
							const m = 1.0 + (gainMultiplier - 1.0) * ratio;
							newData[i] = oldData[i] * m;
						}

						// ループ部分を複製して充填（ゲイン補正を適用）
						let offset = attackLength;
						const loopData = oldData.subarray(loopStartFrame, loopEndFrame);
						const normalizedLoopData = new Float32Array(loopLengthFrame);
						for (let i = 0; i < loopLengthFrame; i++) {
							normalizedLoopData[i] = loopData[i] * gainMultiplier;
						}

						for (let r = 0; r < repeatCount; r++) {
							newData.set(normalizedLoopData, offset);
							offset += loopLengthFrame;
						}

						// リリース部分をコピー（ゲイン補正を適用）
						if (releaseLength > 0 && loopEndFrame < oldBuf.length) {
							const releaseData = oldData.subarray(loopEndFrame);
							if (gainMultiplier !== 1.0) {
								const normalizedRelease = new Float32Array(releaseLength);
								for (let i = 0; i < releaseLength; i++) {
									normalizedRelease[i] = releaseData[i] * gainMultiplier;
								}
								newData.set(normalizedRelease, offset);
							} else {
								newData.set(releaseData, offset);
							}
						}
					}

					zone.buffer = newBuf;
					zone.loopEnd =
						zone.loopStart + (loopLengthFrame / rateRatio) * repeatCount;
				} catch (e) {
					console.warn(
						"[SoundFont.loopExtension] Failed to extend loop buffer:",
						e,
					);
				}
			}
		}
	}

	for (const [k, v] of [
		["loopStart", 0],
		["loopEnd", 0],
		["coarseTune", 0],
		["fineTune", 0],
		["originalPitch", 6000],
		["sampleRate", 44100],
		["sustain", 0],
	] as [keyof Zone, number][]) {
		if (Number.isNaN(Number(zone[k]))) (zone[k] as number) = v;
	}
};

const addParam = (zone: Zone, pitch: number): void => {
	const {
		originalPitch,
		loopStart,
		loopEnd,
		coarseTune,
		fineTune,
		sampleRate,
		delay,
		buffer,
	} = zone;
	const baseDetune = originalPitch - 100 * coarseTune - fineTune;
	const playbackRate = 2 ** ((100 * pitch - baseDetune) / 1200);
	const max = (buffer?.duration ?? 0) / playbackRate;
	const src: { loop: boolean; loopStart?: number; loopEnd?: number } = {
		loop: loopStart >= 1 && loopStart < loopEnd,
	};
	if (src.loop)
		[src.loopStart, src.loopEnd] = [loopStart, loopEnd].map(
			(v) => v / sampleRate + delay,
		);
	zone._param = { playbackRate, max, src };
};
