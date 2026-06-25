/**
 * @credits rpgen3 https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_drum.mjs (MIT)
 */
import { SoundFont } from "./SoundFont";

const touch = <K, V>(map: Map<K, V>, key: K, ctor: new () => V): V => {
	if (!map.has(key)) map.set(key, new ctor());
	return map.get(key)!;
};

export const SoundFont_drum = new (class {
	font: Map<number, SoundFont> | null = null;
	fonts = new Map<string, Map<string, Map<number, SoundFont>>>();

	async load({
		ctx,
		font,
		id,
		keys,
	}: {
		ctx: AudioContext;
		font: string;
		id: string;
		keys: number[];
	}): Promise<void> {
		const map = touch(touch(this.fonts, font, Map), id, Map);
		if (!map.size) {
			for (const [pitch, sf] of await Promise.all(
				[...keys].map(async (key) => {
					const fontName = `${key}_${id}_${font}`;
					return [
						Number(key),
						await SoundFont.load({
							ctx,
							fontName: `_drum_${fontName}`,
							url: `https://surikov.github.io/webaudiofontdata/sound/128${fontName}.js`,
							isDrum: true,
							pitchs: [key],
						}),
					] as [number, SoundFont];
				}),
			))
				map.set(pitch, sf);
		}
		this.font = map;
	}

	play(v: Parameters<SoundFont["play"]>[0]): void {
		const { font } = this;
		if (!font) return;
		const pitch = v?.pitch ?? 60;
		if (font.has(pitch)) font.get(pitch)!.play(v);
	}
})();
