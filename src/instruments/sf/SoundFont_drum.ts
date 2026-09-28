/**
 * @credits rpgen3 https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_drum.mjs (MIT)
 */

import { SoundFont } from "./SoundFont";

const touch = <K, V>(map: Map<K, V>, key: K, ctor: new () => V): V => {
	if (!map.has(key)) map.set(key, new ctor());
	const val = map.get(key);
	if (val === undefined) throw new Error("touch: unexpected undefined");
	return val;
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
		const map = touch(
			touch(this.fonts, font, Map) as Map<string, Map<number, SoundFont>>,
			id,
			Map,
		) as Map<number, SoundFont>;
		const missingKeys = keys.filter((k) => !map.has(k));
		if (missingKeys.length > 0) {
			const results = await Promise.all(
				missingKeys.map(async (key) => {
					const fontName = `${key}_${id}_${font}`;
					try {
						const sf = await SoundFont.load({
							ctx,
							fontName: `_drum_${fontName}`,
							url: `https://surikov.github.io/webaudiofontdata/sound/128${fontName}.js`,
							isDrum: true,
							pitchs: [key],
						});
						return [Number(key), sf] as const;
					} catch (e) {
						console.warn(
							`[dtm] ドラムキー ${key} のロードをスキップしました`,
							e,
						);
						return null;
					}
				}),
			);
			for (const res of results) {
				if (res) map.set(res[0], res[1]);
			}
		}
		this.font = map;
	}

	play(v: Parameters<SoundFont["play"]>[0]): void {
		const { font } = this;
		if (!font) return;
		const pitch = v?.pitch ?? 60;
		if (font.has(pitch)) font.get(pitch)?.play(v);
	}
})();
