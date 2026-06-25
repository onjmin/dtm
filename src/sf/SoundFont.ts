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
		const { fonts } = this;
		if (!fonts.has(fontName)) {
			const zones = new Map<number, Zone>();
			let ch = -1;
			for (const [pitch, v] of await findZone(
				ctx,
				(window as any)[fontName].zones,
				pitchs,
			)) {
				const { numberOfChannels } = v.buffer!;
				if (ch < numberOfChannels) ch = numberOfChannels;
				zones.set(Number(pitch), v);
			}
			if (this.ch < ch) this.ch = ch;
			fonts.set(fontName, new this(zones, ch, isDrum));
		}
		return fonts.get(fontName)!;
	}

	constructor(
		private zones: Map<number, Zone>,
		public ch: number,
		private isDrum: boolean,
	) {}

	play({
		ctx = new AudioContext(),
		destination = ctx.destination,
		pitch = 60,
		volume = 1.0,
		when = 0.0,
		duration = 1.0,
	} = {}): void {
		const { zones, isDrum } = this;
		if (!zones.has(pitch)) return;
		const zone = zones.get(pitch)!;
		const src = ctx.createBufferSource();
		const g = ctx.createGain();
		const _when = when + ctx.currentTime;
		const { buffer, _param } = zone;
		src.buffer = buffer!;
		g.gain.value = volume;
		src.playbackRate.setValueAtTime(_param!.playbackRate, 0);
		Object.assign(src, _param!.src);
		const _duration = duration + SoundFont.afterTime;
		const end =
			_when +
			(isDrum
				? buffer!.duration
				: src.loop
					? _duration
					: Math.min(_duration, _param!.max));
		if (!isDrum) g.gain.linearRampToValueAtTime(0, end);
		src.connect(g).connect(destination);
		src.start(_when);
		src.stop(end);
	}
}

const findZone = (
	ctx: AudioContext,
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
			if (v < zone.keyRangeLow || v > zone.keyRangeHigh + 1) continue;
			set.delete(v);
			map.set(v, { ...zone });
		}
	return Promise.all(
		[...map].map(async ([k, v]) => {
			await adjustZone(ctx, v);
			await addParam(v, k);
			return [k, v] as [number, Zone];
		}),
	);
};

const adjustZone = async (ctx: AudioContext, zone: Zone): Promise<void> => {
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
		const buf = Uint8Array.from(atob(zone.file), (c) => c.charCodeAt(0)).buffer;
		zone.buffer = await ctx.decodeAudioData(buf);
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
		if (Number.isNaN(Number(zone[k]))) (zone as any)[k] = v;
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
	const playbackRate = Math.pow(2, (100 * pitch - baseDetune) / 1200);
	const max = buffer!.duration / playbackRate;
	const src: { loop: boolean; loopStart?: number; loopEnd?: number } = {
		loop: loopStart >= 1 && loopStart < loopEnd,
	};
	if (src.loop)
		[src.loopStart, src.loopEnd] = [loopStart, loopEnd].map(
			(v) => v / sampleRate + delay,
		);
	zone._param = { playbackRate, max, src };
};
