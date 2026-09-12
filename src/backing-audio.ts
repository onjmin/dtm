/**
 * 伴奏音源（mp3 / wav / YouTube）の同時再生。
 *
 * 打ち込みと**同じ時計（AudioContext）**で頭を揃えるのがこのモジュールの仕事で、
 * 音源の種類ごとに揃え方が違う:
 *
 * - `buffer` … デコード済みの {@link AudioBuffer} を `start(when, offset)` で予約する。
 *   サンプル単位で正確。オーディオグラフを通るのでWAV書き出し・録音にも入る。
 * - `element` … `<audio>` 直再生。CORSが無いURLはデコードできないのでこちらへ落ちる。
 *   グラフの外で鳴るため録音には入らない。再生開始の遅延とドリフトを実測して詰める。
 * - `youtube` … IFrame Player API。`element` と同じくグラフの外＋ドリフト補正。
 *   ただし再生速度の微調整が効かない（離散値しか受け付けない）ので、ズレたら seek で直す。
 *
 * 「曲のどこで」「音源のどこから」鳴らすかは呼び出し側が {@link backingMediaSec} で
 * 1つの数（再生開始時点における音源内の位置）へ畳んでから渡す。イントロを飛ばす、
 * 曲の途中から重ねる、といった指定はすべてこの数の符号と大きさに吸収される。
 */

/** 音源の鳴らし方。URL/ファイルの種類と、デコードできたかで決まる。 */
export type BackingMode = "buffer" | "element" | "youtube";

/** 読み込み結果。UIの状態表示に使う。 */
export type BackingLoaded = {
	mode: BackingMode;
	/** 音源の長さ（秒）。取得できないときは0。 */
	durationSec: number;
	/**
	 * オーディオグラフを通るか（＝マスタ音量・WAV書き出し・録音に乗るか）。
	 * `buffer` のみ true。
	 */
	routed: boolean;
	/** 表示名（ファイル名・動画ID等）。 */
	label: string;
};

/** 再生開始の指定。 */
export type BackingStartOptions = {
	/** 打ち込み側の再生開始時刻（`getAudioTime()` と同じ時計の絶対秒）。 */
	atTime: number;
	/**
	 * `atTime` の瞬間に鳴っているべき音源内の位置（秒）。
	 * 負なら「まだ鳴らさない」区間で、0に達した時刻から鳴り始める。
	 */
	mediaSec: number;
	/** 音源を止める位置（秒）。0/未指定なら最後まで。 */
	endSec?: number;
};

export type BackingAudio = {
	/** 音源を読み込む。URL文字列（mp3/wav/YouTube）またはアップロードされたファイル。 */
	load: (src: string | File) => Promise<BackingLoaded>;
	/** 読み込み済みの音源を破棄する（再生中なら止める）。 */
	clear: () => void;
	/**
	 * 再生開始の直前に呼ぶ準備。YouTubeのように「鳴り始めるまで待ちが要る」音源が
	 * 目的位置をバッファするための猶予で、他の音源では何もしない。
	 */
	arm: (mediaSec: number) => Promise<void>;
	start: (options: BackingStartOptions) => void;
	stop: () => void;
	/** 0-100。 */
	setVolume: (volume: number) => void;
	setMuted: (muted: boolean) => void;
	/** 読み込み済みなら true。 */
	isLoaded: () => boolean;
	getLoaded: () => BackingLoaded | null;
	destroy: () => void;
};

export type BackingAudioOptions = {
	audioContext: AudioContext;
	/** グラフを通る音源（buffer）の接続先。通常はマスタゲイン。 */
	destination: AudioNode;
	/** YouTubeプレイヤーを描く枠。未指定/nullのときYouTubeは読み込めない。 */
	getYoutubeContainer?: () => HTMLElement | null;
	/** 読み込み・再生の失敗を利用側へ伝える（UIの状態表示用）。 */
	onError?: (message: string) => void;
};

// ============================================================
// 位置の計算とフォーマット
// ============================================================

/**
 * 再生開始時点における音源内の位置（秒）を求める。
 *
 * `atStep`（曲側の開始位置）に音源の `startSec` が来るように貼るので、
 * そこから `fromStep` までのぶんだけ音源側も進める。`fromStep` が `atStep` より
 * 手前なら負になり、「その秒数だけ待ってから鳴らす」意味になる。
 */
export const backingMediaSec = (o: {
	/** 打ち込みの再生開始ステップ。 */
	fromStep: number;
	/** 音源を貼り付ける曲側のステップ。 */
	atStep: number;
	/** 音源のどこから鳴らすか（秒）。頭の不要部分を飛ばす。 */
	startSec: number;
	secondsPerStep: number;
}): number => o.startSec + (o.fromStep - o.atStep) * o.secondsPerStep;

/**
 * `1:23.456` / `83.456` / `1:02:03` のような時間表記を秒へ直す。
 * 読めない文字列は null（呼び出し側で入力を弾く）。
 */
export const parseTimeSec = (text: string): number | null => {
	const trimmed = text.trim();
	if (trimmed === "") return 0;
	if (!/^-?(\d+:)?(\d+:)?\d*(\.\d+)?$/.test(trimmed)) return null;
	const negative = trimmed.startsWith("-");
	const parts = (negative ? trimmed.slice(1) : trimmed).split(":");
	let sec = 0;
	for (const part of parts) {
		const n = Number.parseFloat(part === "" ? "0" : part);
		if (!Number.isFinite(n)) return null;
		sec = sec * 60 + n;
	}
	return negative ? -sec : sec;
};

/** 秒を `1:23.456` 表記へ直す（1時間以上は `1:02:03.000`）。 */
export const formatTimeSec = (sec: number): string => {
	const sign = sec < 0 ? "-" : "";
	const abs = Math.abs(sec);
	const hours = Math.floor(abs / 3600);
	const minutes = Math.floor((abs % 3600) / 60);
	const seconds = abs % 60;
	const ss = seconds.toFixed(3).padStart(6, "0");
	return hours > 0
		? `${sign}${hours}:${String(minutes).padStart(2, "0")}:${ss}`
		: `${sign}${minutes}:${ss}`;
};

// ============================================================
// YouTube
// ============================================================

/** YouTubeのURLから動画IDを取り出す（`youtu.be` 短縮・`/embed/`・`/shorts/` も見る）。 */
export const parseYoutubeId = (url: string): string | null => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const host = parsed.hostname.replace(/^www\./, "");
	const idLike = /^[\w-]{11}$/;
	if (host === "youtu.be") {
		const id = parsed.pathname.slice(1).split("/")[0];
		return idLike.test(id) ? id : null;
	}
	if (host !== "youtube.com" && host !== "m.youtube.com") return null;
	const v = parsed.searchParams.get("v");
	if (v && idLike.test(v)) return v;
	const m = parsed.pathname.match(/^\/(?:embed|shorts|v|live)\/([\w-]{11})/);
	return m ? m[1] : null;
};

/** URLがYouTubeか。 */
export const isYoutubeUrl = (url: string): boolean =>
	parseYoutubeId(url) !== null;

/** YouTube IFrame Player API の、このモジュールが使う範囲だけの型。 */
type YtPlayer = {
	playVideo: () => void;
	pauseVideo: () => void;
	stopVideo: () => void;
	seekTo: (seconds: number, allowSeekAhead: boolean) => void;
	getCurrentTime: () => number;
	getDuration: () => number;
	getPlayerState: () => number;
	setVolume: (volume: number) => void;
	mute: () => void;
	unMute: () => void;
	destroy: () => void;
};
type YtApi = {
	Player: new (
		el: HTMLElement,
		config: {
			videoId: string;
			playerVars?: Record<string, string | number>;
			events?: {
				onReady?: () => void;
				onError?: (e: { data: number }) => void;
			};
		},
	) => YtPlayer;
};
type YtWindow = typeof globalThis & {
	YT?: YtApi & { Player?: unknown };
	onYouTubeIframeAPIReady?: () => void;
};

const YT_API_SRC = "https://www.youtube.com/iframe_api";
let ytApiPromise: Promise<YtApi> | null = null;

/**
 * YouTube IFrame Player API を読み込む（多重読み込みはしない）。
 *
 * 公式APIは `onYouTubeIframeAPIReady` というグローバル1つで準備完了を知らせる
 * 仕様なので、既に誰かが定義していれば繋いでから上書きする。
 */
const loadYoutubeApi = (): Promise<YtApi> => {
	const w = globalThis as YtWindow;
	if (w.YT?.Player) return Promise.resolve(w.YT as YtApi);
	ytApiPromise ??= new Promise<YtApi>((resolve, reject) => {
		const previous = w.onYouTubeIframeAPIReady;
		w.onYouTubeIframeAPIReady = () => {
			previous?.();
			const api = (globalThis as YtWindow).YT;
			if (api?.Player) resolve(api as YtApi);
			else reject(new Error("YouTube IFrame API の初期化に失敗しました"));
		};
		const existing = document.querySelector(`script[src="${YT_API_SRC}"]`);
		if (existing) return;
		const script = document.createElement("script");
		script.src = YT_API_SRC;
		script.async = true;
		script.onerror = () =>
			reject(new Error("YouTube IFrame API を読み込めませんでした"));
		document.head.appendChild(script);
	});
	return ytApiPromise;
};

// ============================================================
// グラフ外の音源（element / youtube）を打ち込みへ合わせる
// ============================================================

/**
 * グラフの外で鳴る音源へ、種類の違いを吸収して指示を出すための口。
 * `<audio>` と YouTube はAPIの名前が違うだけで、やることは同じ。
 */
type ExternalMedia = {
	seek: (sec: number) => void;
	play: () => void;
	pause: () => void;
	currentTime: () => number;
	/** 再生速度の微調整が効くか（YouTubeは離散値しか受け付けないので false）。 */
	canNudgeRate: boolean;
	setRate: (rate: number) => void;
};

/** ドリフトを見に行く間隔（ms）。 */
const DRIFT_CHECK_MS = 250;
/**
 * 鳴らし始めてから、実測で1回だけ合わせ直すまでの時間（ms）。
 *
 * `play()` が実際に音を出すまでの遅れ（数十ms）は環境依存で事前には読めず、
 * 放っておくと「常に少し遅れたまま」になる。鳴り始めた直後なら seek で飛ばしても
 * 気付かれにくいので、ここで一度だけ実測値へ合わせて系統的なズレを消す。
 */
const INITIAL_FIX_MS = 120;
/** 鳴り始めるのを待つ上限（ms）。これを過ぎたら、進んでいなくても1回だけ詰めて諦める。 */
const INITIAL_FIX_TIMEOUT_MS = 1500;
/** これ以上ズレたら speed では戻せないので seek で直す（秒）。 */
const HARD_SEEK_SEC = 0.3;
/** この範囲は許容して何もしない（秒）。詰めすぎると速度が揺れて気持ち悪い。 */
const DRIFT_DEAD_ZONE_SEC = 0.02;
/** 速度の微調整の上限（±2%。`preservesPitch` が効くので音程は動かず、速さだけが変わる）。 */
const MAX_RATE_NUDGE = 0.02;

/**
 * グラフ外の音源を、打ち込みの時計に合わせて鳴らし続ける。
 *
 * 再生開始は「`atTime` になったら seek して play」。ただし `play()` が実際に音を
 * 出すまでの遅れは環境依存で読めないので、鳴り始めてからは**実測したズレを毎回詰める**。
 * ズレが小さいうちは再生速度をごく僅かに変えて滑らかに寄せ、大きいときだけ seek する
 * （常に seek で直すと、その度に音が飛んで耳につく）。
 *
 * @returns 停止用のハンドル。
 */
const driveExternalMedia = (
	media: ExternalMedia,
	o: BackingStartOptions & { now: () => number },
): (() => void) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let initialFix: ReturnType<typeof setTimeout> | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;
	let stopped = false;

	/** `atTime` を起点に、いま鳴っているべき音源内の位置。 */
	const expectedAt = (now: number): number => o.mediaSec + (now - o.atTime);

	const stop = (): void => {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		if (initialFix !== null) clearTimeout(initialFix);
		if (interval !== null) clearInterval(interval);
		timer = null;
		initialFix = null;
		interval = null;
		media.setRate(1);
		media.pause();
	};

	const begin = (): void => {
		if (stopped) return;
		const at = Math.max(0, expectedAt(o.now()));
		media.seek(at);
		media.play();
		// 鳴り始めの遅れを実測して一度だけ詰める。
		//
		// 厄介なのは、`currentTime` が「実際に鳴り始めてから」しか進まないこと。
		// 再生開始（と seek のやり直し）には毎回同じだけの立ち上がり時間が掛かるので、
		// 素直に「あるべき位置」へ seek しても、その seek の立ち上がりぶんだけまた遅れる。
		// なので**測った遅れを足した先**へ撃つ。1回で系統的なズレが消える。
		let waited = 0;
		const fix = (): void => {
			initialFix = null;
			if (stopped) return;
			const moving = media.currentTime() > at + 0.01;
			waited += INITIAL_FIX_MS;
			// まだ進み始めていないなら測っても無意味なので、動き出すまで待つ
			if (!moving && waited < INITIAL_FIX_TIMEOUT_MS) {
				initialFix = setTimeout(fix, INITIAL_FIX_MS);
				return;
			}
			const lag = expectedAt(o.now()) - media.currentTime();
			if (lag > 0.015) media.seek(expectedAt(o.now()) + lag);
		};
		initialFix = setTimeout(fix, INITIAL_FIX_MS);
		interval = setInterval(() => {
			const now = o.now();
			const expected = expectedAt(now);
			if (o.endSec && expected >= o.endSec) {
				stop();
				return;
			}
			const drift = media.currentTime() - expected;
			if (Math.abs(drift) > HARD_SEEK_SEC) {
				media.setRate(1);
				media.seek(expected);
				return;
			}
			if (!media.canNudgeRate || Math.abs(drift) <= DRIFT_DEAD_ZONE_SEC) {
				media.setRate(1);
				return;
			}
			// 進みすぎ（drift>0）なら遅く、遅れているなら速く。
			const nudge = Math.max(
				-MAX_RATE_NUDGE,
				Math.min(MAX_RATE_NUDGE, -drift * 0.5),
			);
			media.setRate(1 + nudge);
		}, DRIFT_CHECK_MS);
	};

	// 音源の頭出し位置が負＝まだ鳴らさない区間。`expectedAt` が0になる時刻
	// （atTime - mediaSec）まで待ってから始める。正のときは atTime ちょうど。
	const waitSec = Math.max(
		0,
		o.atTime - o.now(),
		o.atTime - o.mediaSec - o.now(),
	);
	const delayMs = waitSec * 1000;
	if (delayMs < 1) begin();
	else timer = setTimeout(begin, delayMs);

	return stop;
};

// ============================================================
// 本体
// ============================================================

export const createBackingAudio = (
	options: BackingAudioOptions,
): BackingAudio => {
	const { audioContext, destination } = options;

	const gain = audioContext.createGain();
	gain.gain.value = 0.8;
	gain.connect(destination);

	let volume = 80;
	let muted = false;
	let loaded: BackingLoaded | null = null;

	// buffer モード
	let buffer: AudioBuffer | null = null;
	let source: AudioBufferSourceNode | null = null;
	// element モード
	let element: HTMLAudioElement | null = null;
	// youtube モード
	let ytPlayer: YtPlayer | null = null;
	let ytReady: Promise<void> | null = null;
	/** blob: URL を作ったら、解放できるよう覚えておく。 */
	let objectUrl: string | null = null;
	/** グラフ外音源の停止ハンドル（再生中のみ）。 */
	let stopExternal: (() => void) | null = null;

	const gainValue = (): number => (muted ? 0 : volume / 100);

	const applyVolume = (): void => {
		gain.gain.setTargetAtTime(gainValue(), audioContext.currentTime, 0.02);
		if (element) element.volume = gainValue();
		// YouTubeの音量は0-100。ミュートAPIは状態が残るので音量0で統一する。
		ytPlayer?.setVolume(Math.round(gainValue() * 100));
	};

	const stopSources = (): void => {
		if (source) {
			try {
				source.stop();
			} catch {
				// 予約前・停止済みの stop は無害なので握り潰す
			}
			source.disconnect();
			source = null;
		}
		stopExternal?.();
		stopExternal = null;
	};

	const clear = (): void => {
		stopSources();
		buffer = null;
		if (element) {
			element.pause();
			element.removeAttribute("src");
			element.load();
			element = null;
		}
		if (ytPlayer) {
			try {
				ytPlayer.destroy();
			} catch {
				// 初期化途中の destroy は YouTube 側で例外になることがある
			}
			ytPlayer = null;
			ytReady = null;
		}
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
		loaded = null;
	};

	/** `<audio>` 直再生へ落とす（CORSが無いURL向け）。長さが分かるまで待つ。 */
	const loadElement = async (
		url: string,
		label: string,
	): Promise<BackingLoaded> => {
		const el = new Audio();
		el.preload = "auto";
		el.src = url;
		el.volume = gainValue();
		await new Promise<void>((resolve, reject) => {
			const ok = (): void => {
				cleanup();
				resolve();
			};
			const ng = (): void => {
				cleanup();
				reject(
					new Error("音源を再生できませんでした（URLを確認してください）"),
				);
			};
			const cleanup = (): void => {
				el.removeEventListener("loadedmetadata", ok);
				el.removeEventListener("error", ng);
			};
			el.addEventListener("loadedmetadata", ok);
			el.addEventListener("error", ng);
			el.load();
		});
		element = el;
		return {
			mode: "element",
			durationSec: Number.isFinite(el.duration) ? el.duration : 0,
			routed: false,
			label,
		};
	};

	/** YouTubeプレイヤーを枠の中に作る。 */
	const loadYoutube = async (videoId: string): Promise<BackingLoaded> => {
		const container = options.getYoutubeContainer?.();
		if (!container) {
			throw new Error("YouTubeプレイヤーの表示枠がありません");
		}
		const api = await loadYoutubeApi();
		container.innerHTML = "";
		const host = document.createElement("div");
		container.appendChild(host);
		await new Promise<void>((resolve, reject) => {
			ytPlayer = new api.Player(host, {
				videoId,
				playerVars: {
					controls: 1,
					disablekb: 1,
					modestbranding: 1,
					playsinline: 1,
					rel: 0,
				},
				events: {
					onReady: () => resolve(),
					onError: (e) =>
						reject(
							new Error(`YouTubeの動画を読み込めません（code ${e.data}）`),
						),
				},
			});
		});
		ytReady = Promise.resolve();
		ytPlayer?.setVolume(Math.round(gainValue() * 100));
		return {
			mode: "youtube",
			durationSec: ytPlayer?.getDuration() ?? 0,
			routed: false,
			label: videoId,
		};
	};

	const load = async (src: string | File): Promise<BackingLoaded> => {
		clear();
		try {
			if (typeof src !== "string") {
				// アップロードされたファイルは必ずデコードできる（＝グラフを通る）。
				const bytes = await src.arrayBuffer();
				buffer = await audioContext.decodeAudioData(bytes);
				loaded = {
					mode: "buffer",
					durationSec: buffer.duration,
					routed: true,
					label: src.name,
				};
				return loaded;
			}
			const videoId = parseYoutubeId(src);
			if (videoId) {
				loaded = await loadYoutube(videoId);
				return loaded;
			}
			const label = decodeURIComponent(src.split("/").pop() ?? src).slice(
				0,
				80,
			);
			// まずデコードを試す。成功すればサンプル単位で正確に合わせられるうえ、
			// 録音・WAV書き出しにも乗る。CORSヘッダの無い配布URLはここで失敗するので
			// `<audio>` 直再生へ落とす（合わせ方は実測ベースになる）。
			try {
				const res = await fetch(src, { mode: "cors" });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				buffer = await audioContext.decodeAudioData(await res.arrayBuffer());
				loaded = {
					mode: "buffer",
					durationSec: buffer.duration,
					routed: true,
					label,
				};
				return loaded;
			} catch {
				loaded = await loadElement(src, label);
				return loaded;
			}
		} catch (e) {
			clear();
			const message = e instanceof Error ? e.message : String(e);
			options.onError?.(message);
			throw e;
		}
	};

	const arm = async (mediaSec: number): Promise<void> => {
		if (loaded?.mode === "youtube" && ytPlayer) {
			await ytReady;
			// 目的位置を先にバッファさせておく。ここで鳴らし始めはしない
			// （seek だけでも YouTube はその周辺を読みに行く）。
			ytPlayer.seekTo(Math.max(0, mediaSec), true);
			ytPlayer.pauseVideo();
			return;
		}
		if (loaded?.mode === "element" && element) {
			element.currentTime = Math.max(0, mediaSec);
		}
	};

	const start = (o: BackingStartOptions): void => {
		if (!loaded) return;
		stopSources();
		const now = (): number => audioContext.currentTime;
		if (loaded.mode === "buffer" && buffer) {
			if (o.mediaSec >= buffer.duration) return; // 音源の終端より後ろから再生した
			const src = audioContext.createBufferSource();
			src.buffer = buffer;
			src.connect(gain);
			const offset = Math.max(0, o.mediaSec);
			// 音源の頭出しが負＝その秒数だけ待ってから鳴らす。
			const when = o.atTime + Math.max(0, -o.mediaSec);
			const until = o.endSec && o.endSec > offset ? o.endSec : buffer.duration;
			src.start(when, offset, Math.max(0, until - offset));
			source = src;
			return;
		}
		if (loaded.mode === "element" && element) {
			const el = element;
			el.volume = gainValue();
			stopExternal = driveExternalMedia(
				{
					seek: (sec) => {
						el.currentTime = sec;
					},
					play: () => {
						void el.play().catch((err) => {
							options.onError?.(
								`音源を再生できませんでした: ${err instanceof Error ? err.message : String(err)}`,
							);
						});
					},
					pause: () => el.pause(),
					currentTime: () => el.currentTime,
					canNudgeRate: true,
					setRate: (rate) => {
						el.playbackRate = rate;
					},
				},
				{ ...o, now },
			);
			return;
		}
		if (loaded.mode === "youtube" && ytPlayer) {
			const player = ytPlayer;
			stopExternal = driveExternalMedia(
				{
					seek: (sec) => player.seekTo(sec, true),
					play: () => player.playVideo(),
					pause: () => player.pauseVideo(),
					currentTime: () => player.getCurrentTime(),
					// YouTubeの再生速度は離散値（0.25/0.5/1/1.25…）しか受け付けないので、
					// 微調整はできない。ズレたら seek で直す。
					canNudgeRate: false,
					setRate: () => {},
				},
				{ ...o, now },
			);
		}
	};

	const stop = (): void => {
		stopSources();
	};

	applyVolume();

	return {
		load,
		clear,
		arm,
		start,
		stop,
		setVolume: (v: number) => {
			volume = Math.max(0, Math.min(100, v));
			applyVolume();
		},
		setMuted: (m: boolean) => {
			muted = m;
			applyVolume();
		},
		isLoaded: () => loaded !== null,
		getLoaded: () => loaded,
		destroy: () => {
			clear();
			gain.disconnect();
		},
	};
};
