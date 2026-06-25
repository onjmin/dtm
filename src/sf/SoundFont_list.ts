/**
 * @credits rpgen3 https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_list.mjs (MIT)
 */

const touch = <K, V>(map: Map<K, V>, key: K, ctor: new () => V): V => {
	if (!map.has(key)) map.set(key, new ctor());
	return map.get(key)!;
};

export const SoundFont_list = new (class {
	tone = new Map<string, Set<string>>();
	drum = new Map<string, Map<string, Set<string>>>();
	callback = new Set<() => void>();

	onload(callback: () => void): void {
		this.callback.add(callback);
	}

	async init(): Promise<void> {
		const res = await fetch(
			"https://surikov.github.io/webaudiofontdata/sf2/list.txt",
		);
		const str = await res.text();
		const { tone, drum } = this;
		for (const s of str.trim().split("\n")) {
			if (s.slice(0, 3) === "128") {
				const a = s.slice(3).split("_");
				const [key, id] = a;
				const font = a.slice(2).join("_").slice(0, -3);
				touch(touch(drum, font, Map), id, Set).add(key);
			} else {
				const a = s.split("_");
				const [id] = a;
				const font = a.slice(1).join("_").slice(0, -3);
				touch(tone, font, Set).add(id);
			}
		}
		for (const callback of this.callback) callback();
		this.callback.clear();
	}
})();
