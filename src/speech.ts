/**
 * 語り（読み上げ）の前段 — テキストから UtauTTS の合成計画を作る。
 *
 * 歌詞の `「…」`（{@link file://./lyrics.ts} の `kind: "speak"`）は、歌唱の
 * 「1文字＝1ノート」とは別の経路で音になる:
 *
 *   本文 → jpreprocess（読み・アクセント・ポーズ）→ HTS 音声モデル（モーラ長・F0）
 *        → UtauTTS プランナー（ユニット選択・配置・F0 曲線）→ worldline（合成）
 *
 * このファイルは最後の合成を除く**計画まで**を担う。計画は Wasm（Go）と
 * jpreprocess（Rust）をメインスレッドで動かす（koe のデモと同じ構成。合成と違い
 * 1文あたり数十 ms なので UI を塞がない）。合成そのものは音源 PCM と WORLD を持つ
 * バックエンド（voice-worker / ローカル）が計画を受け取って行う。
 *
 * 必要なアセット（約 45MB。Cache API に保存され 2 回目以降はネットワークを使わない）:
 *   - `utautts.wasm` + `wasm_exec.js` … UtauTTS プランナー（Go）
 *   - `jpreprocess_wasm/` + `naist-jdic/*.gz` … OpenJTalk 互換の読み解析と辞書
 *   - `frame-intonation-v8.json` … TCN イントネーションモデル（HTS 整列失敗時の保険）
 *   - `hts/tohoku-f01-neutral.htsvoice` … HTS 音声モデル（音素長と F0 だけを移植する）
 */

import {
	alignHtsProsody,
	fetchAsset,
	fetchAssetBytes,
	fetchAssetText,
	type HtsProsody,
	initJpreprocessDictionary,
	isQuestion,
	type JpreprocessModule,
	loadNaistJdic,
	openjtalkAnalyze,
	type PhonemeEntry,
	resolveSpeakingStyle,
	type SpeakingStyleInput,
	shapeProsody,
	styleAlignOptions,
	styleRenderOptions,
	styleShapeOptions,
	UtauTTSAdapter,
	type UtauTTSPlan,
	type UtauTTSRenderOptions,
	type VoiceBank,
	type Worldline,
} from "@onjmin/koe";

/**
 * HTS 音声モデルの感情。tohoku-f01（CC BY 4.0）は 4 種を同梱し、音素長と F0 の
 * 「起伏そのもの」が変わる（話し方プリセット {@link SpeakingStyleInput} は
 * その上に掛かる話速・抑揚幅・ポーズなどの係数）。各約 2MB、初めて使うときに取得する。
 */
export type SpeechEmotion = "neutral" | "happy" | "sad" | "angry";
export const SPEECH_EMOTIONS: readonly SpeechEmotion[] = [
	"neutral",
	"happy",
	"sad",
	"angry",
];

/** 感情 → HTS 音声モデルのアセットパス（ベース URL 相対）。 */
const htsVoicePath = (emotion: SpeechEmotion): string =>
	`hts/tohoku-f01-${emotion}.htsvoice`;

/**
 * 話し方プリセットから、合成段（`renderChunks`）に渡すオプションを引く。
 * 計画（{@link SpeechPlanner.plan}）と合成は別スレッドになり得るので、
 * 合成側はこれを計画とは別に受け取る。
 */
export const speechRenderOptions = (
	style?: SpeakingStyleInput,
): UtauTTSRenderOptions => styleRenderOptions(resolveSpeakingStyle(style));

/**
 * TTS アセットの既定の配信元（koe のデモと同じ配置）。`createDtmStudio` の
 * `ttsBaseUrl` / `createSingingVoices` の `ttsBaseUrl` で差し替えられる。
 */
export const DEFAULT_TTS_BASE_URL =
	"https://onjmin.github.io/koe/demo/utautts/";

/** 読み上げの計画に必要な音源の見え方（マニフェストの音素表だけ。PCM は要らない）。 */
export type SpeechBank = {
	manifest: { phonemes: Record<string, PhonemeEntry> };
};

export type SpeechPlanOptions = {
	/** prefix.map 用の音名（多音階音源の収録セット名。省略時 "C4"）。 */
	tone?: string;
	/** イントネーションの強さ 0..4。省略時は `style` の抑揚（neutral で 1）。 */
	intonationStrength?: number;
	/**
	 * 話し方プリセット（"neutral" / "calm" / "lively"、またはプリセット＋上書き）。
	 * 話速・抑揚幅・基準ピッチ・ポーズ倍率・モーラ長コントラストに効く。既定 neutral。
	 */
	style?: SpeakingStyleInput;
	/**
	 * 感情（HTS 音声モデルの差し替え）。既定 neutral。未取得の感情を指定したときは
	 * {@link SpeechPlanner.prepareEmotion} を先に済ませておくこと（済んでいなければ
	 * 直前まで使っていた音声モデルのまま計画する）。
	 */
	emotion?: SpeechEmotion;
};

/** ダウンロード進捗（全アセット合算のバイト数）。 */
export type SpeechProgressListener = (
	loadedBytes: number,
	totalBytes: number,
) => void;

export type SpeechPlannerOptions = {
	/** アセットのベース URL（末尾 `/` は無くてもよい）。既定 {@link DEFAULT_TTS_BASE_URL}。 */
	baseUrl?: string;
	/**
	 * ダウンロード進捗（全アセット合算のバイト数）。{@link getSpeechPlanner} に渡した場合、
	 * 計画器が既に存在していても購読として追加される（{@link SpeechPlanner.onProgress}）。
	 */
	onProgress?: SpeechProgressListener;
};

export type SpeechPlanner = {
	/** アセットをすべて読み込む（初回のみ実際にダウンロード。以降は即解決）。 */
	ready: () => Promise<void>;
	/** {@link ready} が完了しているか。 */
	isReady: () => boolean;
	/**
	 * ダウンロード進捗の購読を追加する。戻り値で解除する。読み込み中に追加すると、
	 * それまでの合算値が直後に 1 回通知される（途中参加でも表示が空にならない）。
	 */
	onProgress: (listener: SpeechProgressListener) => () => void;
	/**
	 * 感情の HTS 音声モデルを取得しておく（初回のみダウンロード、以降は即解決）。
	 * {@link ready} を含む。`plan` は同期なので、感情を使う計画の前に必ず呼ぶ。
	 */
	prepareEmotion: (emotion: SpeechEmotion) => Promise<void>;
	/**
	 * 本文の合成計画を作る。{@link ready} 完了後に呼ぶこと。
	 * 読みが取れない本文（記号だけ等）は例外を投げる。
	 */
	plan: (
		bank: SpeechBank,
		text: string,
		options?: SpeechPlanOptions,
	) => UtauTTSPlan;
};

/** wasm-bindgen の ESM グルー（`jpreprocess_wasm.js`）が持つ口のうち使うもの。 */
type JpreprocessGlue = JpreprocessModule & {
	default: (init: {
		module_or_path: Promise<Response> | Response | string;
	}) => Promise<unknown>;
	init_voice: (htsvoice: Uint8Array) => void;
	is_voice_ready: () => boolean;
	analyze_prosody: (text: string, speed: number) => string;
};

const joinUrl = (base: string, path: string): string =>
	`${base.endsWith("/") ? base : `${base}/`}${path}`;

/**
 * `wasm_exec.js`（Go の Wasm ランタイム）を classic script として読み込む。
 * グローバル `Go` を定義するだけのファイルで、ESM として import できないため
 * script タグで読む。既に定義済みなら何もしない。
 */
const loadGoRuntime = (url: string): Promise<void> =>
	new Promise((resolve, reject) => {
		if (typeof (globalThis as { Go?: unknown }).Go !== "undefined") {
			resolve();
			return;
		}
		if (typeof document === "undefined") {
			reject(new Error("wasm_exec.js needs a document to load into"));
			return;
		}
		const script = document.createElement("script");
		script.src = url;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`failed to load ${url}`));
		document.head.appendChild(script);
	});

/**
 * jpreprocess の ESM グルーを実行時 URL から読む。バンドラに静的解決させない
 * （配信元は利用側が決める）ため、意図的に文字列変数で `import()` する。
 */
const importJpreprocess = (url: string): Promise<JpreprocessGlue> =>
	import(
		/* @vite-ignore */ /* webpackIgnore: true */ url
	) as Promise<JpreprocessGlue>;

/** ページ全体で 1 つ（Wasm のグローバル状態を共有するため）。 */
let shared: { baseUrl: string; planner: SpeechPlanner } | null = null;

/**
 * 語りの計画器を取得する。Wasm（Go / jpreprocess）はページにつき 1 インスタンスなので、
 * ベース URL が違っても最初に作られたものを使い回す（警告を出す）。
 */
export const getSpeechPlanner = (
	options: SpeechPlannerOptions = {},
): SpeechPlanner => {
	const baseUrl = options.baseUrl ?? DEFAULT_TTS_BASE_URL;
	if (shared) {
		if (shared.baseUrl !== baseUrl) {
			console.warn(
				`[dtm] TTS assets are already loaded from ${shared.baseUrl}; ignoring ${baseUrl}`,
			);
		}
		// 2 度目以降の呼び出しでも進捗は受け取れるようにする（利用側が purpose ごとに
		// 進捗表示を持つため。最初の onProgress だけが有効だと後から来た画面が沈黙する）。
		if (options.onProgress) shared.planner.onProgress(options.onProgress);
		return shared.planner;
	}
	const planner = createSpeechPlanner({ ...options, baseUrl });
	shared = { baseUrl, planner };
	return planner;
};

/**
 * 語りの計画器を作る（通常は {@link getSpeechPlanner} を使う）。
 * 読み込みは {@link SpeechPlanner.ready} を呼んだときに始まる（作っただけでは何も取りに行かない）。
 */
export const createSpeechPlanner = (
	options: SpeechPlannerOptions = {},
): SpeechPlanner => {
	const baseUrl = options.baseUrl ?? DEFAULT_TTS_BASE_URL;
	let jp: JpreprocessGlue | null = null;
	let adapter: UtauTTSAdapter | null = null;
	let readyPromise: Promise<void> | null = null;
	let isReady = false;
	/** 取得済みの HTS 音声モデル（感情 → バイト列）。差し替えは init_voice の呼び直し。 */
	const voices = new Map<SpeechEmotion, Uint8Array>();
	const voiceLoading = new Map<SpeechEmotion, Promise<void>>();
	/** いま jpreprocess に入っている音声モデル（init_voice 未呼び出しなら null）。 */
	let loadedVoice: SpeechEmotion | null = null;
	const listeners = new Set<SpeechProgressListener>();
	if (options.onProgress) listeners.add(options.onProgress);
	// 進捗は URL ごとの (loaded, total) を合算する（koe のデモと同じ）。
	const progress = new Map<string, { loaded: number; total: number }>();
	const sumProgress = (): [number, number] => {
		let loaded = 0;
		let total = 0;
		for (const item of progress.values()) {
			loaded += item.loaded;
			total += item.total;
		}
		return [loaded, total];
	};
	const subscribe: SpeechPlanner["onProgress"] = (listener) => {
		listeners.add(listener);
		if (readyPromise && !isReady) {
			const [loaded, total] = sumProgress();
			if (total > 0) listener(loaded, total);
		}
		return () => {
			listeners.delete(listener);
		};
	};

	const load = async (): Promise<void> => {
		progress.clear();
		const onProgress = (p: { url: string; loaded: number; total: number }) => {
			if (listeners.size === 0) return;
			progress.set(p.url, p);
			const [loaded, total] = sumProgress();
			for (const l of listeners) l(loaded, total);
		};
		const fetchWithProgress = (url: string) => fetchAsset(url, { onProgress });

		const jpreprocessReady = (async () => {
			const glue = await importJpreprocess(
				joinUrl(baseUrl, "jpreprocess_wasm/jpreprocess_wasm.js"),
			);
			await glue.default({
				module_or_path: fetchWithProgress(
					joinUrl(baseUrl, "jpreprocess_wasm/jpreprocess_wasm_bg.wasm"),
				),
			});
			if (!glue.is_ready()) {
				const dict = await loadNaistJdic(
					joinUrl(baseUrl, "jpreprocess_wasm/naist-jdic"),
					{ onProgress },
				);
				initJpreprocessDictionary(glue, dict);
			}
			return glue;
		})();
		const utauttsReady = (async () => {
			await loadGoRuntime(joinUrl(baseUrl, "wasm_exec.js"));
			await UtauTTSAdapter.initializeWasm(joinUrl(baseUrl, "utautts.wasm"), {
				fetch: fetchWithProgress,
			});
			UtauTTSAdapter.setModel(
				await fetchAssetText(joinUrl(baseUrl, "frame-intonation-v8.json"), {
					onProgress,
				}),
			);
		})();
		const htsVoiceReady = fetchAssetBytes(
			joinUrl(baseUrl, htsVoicePath("neutral")),
			{ onProgress },
		);
		const [glue, , htsVoice] = await Promise.all([
			jpreprocessReady,
			utauttsReady,
			htsVoiceReady,
		]);
		voices.set("neutral", htsVoice);
		if (!glue.is_voice_ready()) {
			glue.init_voice(htsVoice);
			loadedVoice = "neutral";
		}
		jp = glue;
		// 計画だけに使うので worldline は要らない（renderChunks は呼ばない）。
		adapter = new UtauTTSAdapter(null as unknown as Worldline);
		isReady = true;
	};

	const ready = (): Promise<void> => {
		if (!readyPromise) {
			readyPromise = load().catch((err) => {
				readyPromise = null; // 次回の呼び出しで再試行できるようにする
				throw err;
			});
		}
		return readyPromise;
	};

	const prepareEmotion: SpeechPlanner["prepareEmotion"] = async (emotion) => {
		await ready();
		if (voices.has(emotion)) return;
		let p = voiceLoading.get(emotion);
		if (!p) {
			p = fetchAssetBytes(joinUrl(baseUrl, htsVoicePath(emotion)), {
				onProgress: (q) => {
					if (listeners.size === 0) return;
					progress.set(q.url, q);
					const [loaded, total] = sumProgress();
					for (const l of listeners) l(loaded, total);
				},
			})
				.then((bytes) => {
					voices.set(emotion, bytes);
				})
				.finally(() => voiceLoading.delete(emotion));
			voiceLoading.set(emotion, p);
		}
		await p;
	};

	/** 指定した感情の音声モデルへ切り替える（未取得なら今のまま）。 */
	const useVoice = (emotion: SpeechEmotion): void => {
		if (!jp || loadedVoice === emotion) return;
		const bytes = voices.get(emotion);
		if (!bytes) {
			console.warn(
				`[dtm] HTS voice "${emotion}" is not prepared; keeping "${loadedVoice ?? "neutral"}"`,
			);
			return;
		}
		jp.init_voice(bytes);
		loadedVoice = emotion;
	};

	const plan: SpeechPlanner["plan"] = (bank, text, o = {}) => {
		if (!jp || !adapter) {
			throw new Error("speech planner is not ready; await ready() first");
		}
		const style = resolveSpeakingStyle(o.style);
		const intonationStrength = o.intonationStrength ?? style.intonation;
		const nodes = JSON.parse(jp.analyze_text(text));
		const { features } = openjtalkAnalyze(nodes);
		if (features.length === 0) {
			throw new Error(`no readable morae in "${text}"`);
		}
		// 韻律は HTS 音声モデルの音素長と F0 を移植する（アクセントの起伏が大きい）。
		// モーラに整列できない文だけ UtauTTS の TCN モデルに任せる。
		let prosody: HtsProsody | null = null;
		if (jp.is_voice_ready()) {
			useVoice(o.emotion ?? "neutral");
			const frames = JSON.parse(jp.analyze_prosody(text, style.speed));
			prosody = alignHtsProsody(frames, features, {
				...styleAlignOptions(style),
				intonationStrength,
			});
			if (prosody) {
				prosody = shapeProsody(prosody, features, {
					...styleShapeOptions(style),
					question: isQuestion(text),
				});
			}
		}
		return adapter.plan(bank as unknown as VoiceBank, text, features, {
			tone: o.tone ?? "C4",
			intonationStrength,
			prosody: prosody ?? undefined,
		});
	};

	return {
		ready,
		isReady: () => isReady,
		onProgress: subscribe,
		prepareEmotion,
		plan,
	};
};

// ─────────────────────────────────────────────────────────────
// 計画の後処理（純関数）
// ─────────────────────────────────────────────────────────────

/**
 * 計画のピッチ曲線を比率で平行移動し、ユニットのエイリアスを実在の名前へ写した
 * 合成用の複製を返す（元の計画は変えない）。
 *
 * - `ratio` … ノートの音高 ÷ 計画の基準ピッチ（`timeline.reference_hz`）。
 *   1 で音源の素の声、2 で 1 オクターブ上。韻律の起伏は保たれる。
 * - `toReal` … 多音階音源の「音名接尾辞を剥がした見え方」で計画したエイリアスを、
 *   音源に実在する名前（`あ` → `あ_G4`）へ戻す。
 */
export const prepareSpeechPlan = (
	plan: UtauTTSPlan,
	ratio: number,
	toReal: (alias: string) => string = (a) => a,
): UtauTTSPlan => {
	const timeline = plan.timeline;
	return {
		...plan,
		timeline: {
			...timeline,
			f0_curve: timeline.f0_curve.map((hz) => hz * ratio),
			units: timeline.units.map((u) => ({
				...u,
				alias: toReal(u.alias),
				target_f0_hz: u.target_f0_hz * ratio,
			})),
		},
	};
};

/**
 * 語りの先頭余白（秒）。タイムラインの 0 は最初のモーラより `leading_ms` だけ前
 * （先行発声ぶんの余白）にあるので、ノートの位置にはタイムラインのこの時刻を合わせる
 * （歌唱が母音オンセットを拍頭に合わせるのと同じ考え方）。
 */
export const speechPlanLeadingSec = (plan: UtauTTSPlan): number =>
	Math.max(0, plan.timeline.leading_ms || 0) / 1000;

/**
 * 語りが実際に音を占める長さ（秒）。ノートの位置（{@link speechPlanLeadingSec} 後）から
 * 最後のユニットの終わりまで。`timeline.duration_ms` は語尾のリリースや句点の間まで
 * 含む計画上の長さで、鳴る音より長いので帯には使わない。
 */
export const speechPlanDurationSec = (plan: UtauTTSPlan): number => {
	const timeline = plan.timeline;
	let endMs = 0;
	for (const u of timeline.units) {
		endMs = Math.max(endMs, u.position_ms + u.length_ms);
	}
	if (endMs <= 0) endMs = timeline.duration_ms;
	return Math.max(0, endMs / 1000 - speechPlanLeadingSec(plan));
};

/**
 * 計画に出てくるユニットの PCM を、合成に先立って（合成と重ねて）取りに行く。
 *
 * URL 配信の音源は 1 ユニット = 1 回の Range 取得で、`renderChunks` はユニットを
 * 逐次 await するため、何もしないとチャンクごとに「取得 → 合成」が交互に走り、
 * 往復時間がまるごと合成時間に乗る（つくよみちゃん × r2.dev で 1 往復 約 115ms、
 * 1 チャンク 6 ユニット ≈ 0.7 秒。WORLD 合成 約 0.4 秒と足すと 0.9 秒の音に 1.1 秒掛かり
 * 実時間を割る）。先に取得を走らせておけば取得と合成が重なり、実時間を上回る。
 * koe のデモは音源が手元の Blob なのでこの問題が無い。
 *
 * `getPcm` は呼び出し側のキャッシュ付きのもの（同じ関数を `renderChunks` にも
 * 見せること）。取得は計画の順（先頭チャンクのぶんが先に揃う）。失敗は握りつぶす
 * （合成側が改めて同じ取得を待ち、そこで扱う）。
 */
export const prefetchSpeechPcm = (
	plan: UtauTTSPlan,
	getPcm: (alias: string) => Promise<unknown>,
	concurrency = 6,
): void => {
	const aliases = [
		...new Set(
			plan.timeline.units.filter((u) => u.length_ms > 0).map((u) => u.alias),
		),
	];
	let next = 0;
	const run = async (): Promise<void> => {
		while (next < aliases.length) {
			const alias = aliases[next++];
			try {
				await getPcm(alias);
			} catch {
				// 合成側で改めて扱う
			}
		}
	};
	for (let i = 0; i < Math.min(concurrency, aliases.length); i++) void run();
};

/**
 * `renderChunks` に見せる音源の見え方。PCM を引く口だけをキャッシュ付き `getPcm` へ
 * 向ける（`renderChunks` が音源に求めるのは `getPcm` だけ）。{@link prefetchSpeechPcm}
 * と同じ関数を渡すと、先取りした PCM がそのまま合成に使われる。
 */
export const speechBankView = (
	bank: VoiceBank,
	getPcm: (alias: string) => Promise<Float64Array | null>,
): VoiceBank =>
	new Proxy(bank, {
		get: (target, prop, receiver) =>
			prop === "getPcm" ? getPcm : Reflect.get(target, prop, receiver),
	});

/** 音素表の収録ピッチ（Hz）の中央値。0（未検出）は無視する。無ければ undefined。 */
export const medianRecordedPitchHz = (
	phonemes: Record<string, PhonemeEntry>,
): number | undefined => {
	const pitches = Object.values(phonemes)
		.map((p) => p.pitch)
		.filter((hz) => hz > 0)
		.sort((a, b) => a - b);
	if (pitches.length === 0) return undefined;
	const mid = pitches.length >> 1;
	return pitches.length % 2
		? pitches[mid]
		: (pitches[mid - 1] + pitches[mid]) / 2;
};
