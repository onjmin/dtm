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
		when = 0.0,
		duration = 1.0,
	}: {
		ctx?: AudioContext;
		destination?: AudioNode;
		pitch?: number;
		volume?: number;
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
		// Start with 0 volume at currentTime to avoid clicking on connection
		g.gain.setValueAtTime(0, ctx.currentTime);
		const attackTime = 0.005; // 5ms fade-in
		const startGainTime = Math.max(ctx.currentTime, _when);
		g.gain.setValueAtTime(0, startGainTime);
		g.gain.linearRampToValueAtTime(volume, startGainTime + attackTime);

		const _duration = duration + SoundFont.afterTime;
		const end =
			_when +
			(isDrum
				? buffer.duration
				: src.loop
					? _duration
					: Math.min(_duration, _param.max));

		if (!isDrum) {
			g.gain.setValueAtTime(volume, startGainTime + attackTime);
			g.gain.linearRampToValueAtTime(0, end);
		}

		src.connect(g).connect(destination);
		src.start(_when);
		src.stop(end);

		src.onended = () => {
			src.disconnect();
			g.disconnect();
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
	if (24 <= program && program <= 39) return true; // Guitars, Basses
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
				if (oldBuf.numberOfChannels > 0) {
					const ch0 = oldBuf.getChannelData(0);
					for (let i = 0; i < ch0.length; i++) {
						const abs = Math.abs(ch0[i]);
						if (abs > totalPeak) totalPeak = abs;
						if (i >= loopStartFrame && i < loopEndFrame) {
							if (abs > loopPeak) loopPeak = abs;
						}
					}
				}

				// ゲイン補正倍率の計算
				let gainMultiplier = 1.0;
				if (
					!isDecayInstrument(fontName) &&
					loopPeak > 0 &&
					totalPeak > 0 &&
					loopPeak < totalPeak * 0.8
				) {
					gainMultiplier = (totalPeak * 0.75) / loopPeak; // アタック（全体）ピークの75%を目標にする
					if (gainMultiplier > 20.0) gainMultiplier = 20.0; // 過剰増幅によるクリップ防止
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
						zone.loopStart + (zone.loopEnd - zone.loopStart) * repeatCount;
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
