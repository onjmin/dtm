export type RechordScore = {
	id: number;
	title: string;
	content: string;
	bpm?: number;
	capo?: number;
	beat?: string;
	instrument?: string;
	loop?: boolean;
	user?: {
		id: number;
		name: string;
		screen_name: string;
		twitter?: string;
	};
};

export type MidiSearchConfig = {
	apiKey?: string;
	baseUrl?: string;
};

export type PicotuneSong = {
	id: string;
	file: string;
	title: string;
	user: string;
	twitter_id?: string;
	date?: string;
	no?: number;
	description?: string;
};

export type PicotuneSearchParams = {
	title?: string;
	user?: string;
	twitter_id?: string;
};

export class MidiSearchClient {
	private config: MidiSearchConfig;

	constructor(config: MidiSearchConfig = {}) {
		this.config = config;
	}

	get enabled(): boolean {
		return !!this.config.apiKey;
	}

	private get baseUrl(): string {
		return this.config.baseUrl ?? "https://rpgen-search.pages.dev/api";
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = {};
		if (this.config.apiKey) {
			h.Authorization = `Bearer ${this.config.apiKey}`;
		}
		return h;
	}

	async searchSongs(params: PicotuneSearchParams): Promise<PicotuneSong[]> {
		if (!this.enabled) return [];
		const qs = new URLSearchParams();
		if (params.title) qs.set("title", params.title);
		if (params.user) qs.set("user", params.user);
		if (params.twitter_id) qs.set("twitter_id", params.twitter_id);
		const url = `${this.baseUrl}/picotune/songs${qs.toString() ? `?${qs.toString()}` : ""}`;
		const res = await fetch(url, { headers: this.headers() });
		if (!res.ok) throw new Error(`picotune search failed: ${res.status}`);
		const body = await res.json();
		return (body.data ?? body.songs ?? body) as PicotuneSong[];
	}

	async fetchMidi(fileName: string): Promise<ArrayBuffer> {
		const url = `${this.baseUrl}/picotune/songs/${encodeURIComponent(fileName)}`;
		const res = await fetch(url, { headers: this.headers() });
		if (!res.ok) throw new Error(`picotune fetch failed: ${res.status}`);
		return res.arrayBuffer();
	}

	async searchRechord(word: string): Promise<RechordScore[]> {
		if (!this.enabled) return [];
		const qs = new URLSearchParams();
		qs.set("word", word);
		qs.set("guest", "true");
		const url = `${this.baseUrl}/rechord/scores?${qs.toString()}`;
		const res = await fetch(url, { headers: this.headers() });
		if (!res.ok) throw new Error(`rechord search failed: ${res.status}`);
		const body = await res.json();
		return (body.data ?? body) as RechordScore[];
	}
}
