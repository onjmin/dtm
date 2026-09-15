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

/**
 * {@link BackingAudio.startRolling} の結果。
 *
 * `measured` が false でも**音源は鳴らし始めている**（時間内に進み始めたのを
 * 確認できなかっただけ）。呼び出し側は改めて鳴らし直してはいけない——
 * 止めて鳴らし直すと、立ち上がりをもう一度やり直すことになって余計に遅れる。
 */
export type BackingRoll = {
	/** 実測（または推定）した時刻。 */
	atTime: number;
	/** その時刻に音源がいた位置（秒）。 */
	mediaSec: number;
	/** 本当に進み始めたのを確認できたか。 */
	measured: boolean;
};

/** 再生開始の指定。 */
export type BackingStartOptions = {
	/** 打ち込み側の再生開始時刻（`getAudioTime()` と同じ時計の絶対秒）。 */
	atTime: number;
	/**
	 * `atTime` の瞬間に鳴っているべき音源内の位置（秒）。
	 * {@link rangeStartSec} より手前なら「まだ鳴らさない」区間で、そこへ達した時刻から鳴り始める。
	 */
	mediaSec: number;
	/** 音源を鳴らし始める位置（秒）。未指定なら頭から。ここより手前は鳴らさない。 */
	rangeStartSec?: number;
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
	/**
	 * 音源を**今すぐ**鳴らし始め、本当に音が進み出すまで待ってから、
	 * 「その瞬間の時計（`getAudioTime` と同じ絶対秒）と、そのとき音源がいた位置」を返す。
	 *
	 * 再生要求から実際に鳴り出すまでの遅れは環境依存で事前に読めない
	 * （YouTubeのバッファ、`<audio>` のデコード、初回再生のウォームアップ等）。
	 * 呼び出し側はこの実測値を見て、**打ち込み側の開始時刻を決められる**。
	 *
	 * 待ち合わせるのは**待たないと直しようがない音源だけ**（YouTube）。
	 * - デコード済み（`buffer`）… 予約がサンプル単位で正確。`null`。
	 * - `<audio>` 直再生 … 予約してから実測で詰めるほうが精度が出る（実測で数ms）。
	 *   待ち合わせると、待った時点で音源が先行してしまい、戻す手段が
	 *   seek（＝毎回100ms前後の立ち上がりを伴う）しか無くなる。`null`。
	 * - 時間内に鳴り始めなかった … `null`（呼び出し側は従来どおり予約で始める）。
	 */
	startRolling: (options: {
		mediaSec: number;
		rangeStartSec?: number;
		endSec?: number;
		/** 鳴り始めを待つ上限（秒）。既定5。 */
		timeoutSec?: number;
	}) => Promise<BackingRoll | null>;
	/**
	 * 鳴らしたまま、合わせる先（時刻と音源位置の対応）だけ差し替える。
	 * {@link startRolling} の実測で打ち込み側の開始時刻がずれたときに、
	 * 音源をそこへ合わせ直すために使う。
	 */
	rebase: (
		line: { atTime: number; mediaSec: number },
		options?: { snap?: boolean },
	) => void;
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
 * 音源と打ち込みのずれは「**どちらが何秒先に始まるか**」の1つの符号付きの数
 * （{@link BackingOffset.offsetSec}）だけで決まる。
 *
 * - `offsetSec > 0` … 音源が先。その秒数だけ音源を鳴らしてから打ち込みが始まる。
 * - `offsetSec < 0` … 打ち込みが先。その秒数だけ経ってから音源が鳴り出す。
 * - `offsetSec = 0` … 同時。
 *
 * 戻り値が再生範囲の開始より手前なら、そこへ届くまで音源は鳴らない（負なら待ち時間）。
 */
export const backingMediaSec = (o: BackingOffset): number =>
	o.rangeStartSec + o.offsetSec + o.fromStep * o.secondsPerStep;

/** {@link backingMediaSec} の引数。 */
export type BackingOffset = {
	/** 打ち込みの再生開始ステップ。 */
	fromStep: number;
	/** 開始のずれ（秒）。正=音源が先、負=打ち込みが先。 */
	offsetSec: number;
	/** 音源の再生範囲の開始（秒）。頭のいらない部分を飛ばす。 */
	rangeStartSec: number;
	secondsPerStep: number;
};

/**
 * 曲が始まるまでに先に鳴らす音源の秒数（＝前奏の長さ）。
 *
 * 音源が先に始まる指定のときだけ正になる。曲の途中から再生したときは
 * 前奏を鳴らす場面ではないので0（その位置の音源がすぐ鳴る）。
 */
export const backingPreRollSec = (o: {
	fromStep: number;
	offsetSec: number;
}): number => (o.fromStep <= 0 ? Math.max(0, o.offsetSec) : 0);

/**
 * 実測した「鳴り始め」から、打ち込みを始めるまでの待ち時間を求める。
 *
 * 外部プレイヤーは再生要求から音が出るまでの遅れが読めないので、先に鳴らして
 * 「いつ・どこを鳴らしていたか」を実測し（{@link BackingAudio.startRolling}）、
 * **音源がその位置へ達する時刻**に打ち込みを始める。こうすると遅れの大きさが
 * 毎回変わっても、音源と打ち込みの対応は変わらない。
 *
 * 既に通り過ぎていた（＝待つ余地が無い）ときは0。呼び出し側は音源側を
 * 実測で詰め直すこと（{@link BackingAudio.rebase} の `snap`）。
 */
export const backingPreRollFromRoll = (o: {
	/** 実測値。取れなかった（デコード済み・時間切れ）なら null か `measured: false`。 */
	rolled: { atTime: number; mediaSec: number; measured?: boolean } | null;
	/** 曲の開始時点で音源がいるべき位置（秒）。 */
	mediaAtSongStart: number;
	/** いまの時刻（`getAudioTime` と同じ時計）。 */
	now: number;
	/** 再生開始の要求から実際に走り出すまでの余裕（秒）。 */
	startDelaySec: number;
	/** 実測が取れなかったときに使う待ち時間（秒）。 */
	fallbackPreRollSec: number;
}): number =>
	o.rolled && o.rolled.measured !== false
		? Math.max(
				0,
				o.rolled.atTime +
					(o.mediaAtSongStart - o.rolled.mediaSec) -
					(o.now + o.startDelaySec),
			)
		: o.fallbackPreRollSec;

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

/** {@link driveExternalMedia} のハンドル。 */
type MediaDrive = {
	stop: () => void;
	/**
	 * 合わせる先の直線を差し替える（再生は止めない）。
	 * `snap` を付けると、その場で1回だけ実測して線の上へ乗せ直す。
	 */
	rebase: (
		line: { atTime: number; mediaSec: number },
		options?: { snap?: boolean },
	) => void;
};

/** ドリフトを見に行く間隔（ms）。 */
const DRIFT_CHECK_MS = 250;
/** 鳴り始めたかを見に行く間隔（ms）。実測の誤差はここまでに収まる。 */
const ROLL_POLL_MS = 40;
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
/**
 * 鳴り始めに実測で詰める回数の上限。
 * seek のたびに立ち上がりの遅れが乗るので、1回では詰め切れないことがある。
 */
const SNAP_MAX_PASSES = 3;
/** これ以上ズレたら speed では戻せないので seek で直す（秒）。 */
const HARD_SEEK_SEC = 0.3;
/** この範囲は許容して何もしない（秒）。詰めすぎると速度が揺れて気持ち悪い。 */
const DRIFT_DEAD_ZONE_SEC = 0.02;
/**
 * 速度の微調整の上限（±5%。`preservesPitch` が効くので音程は動かず、速さだけが変わる）。
 * seek と違って音が途切れないので、多少強くても耳につきにくい。
 */
const MAX_RATE_NUDGE = 0.05;
/** ズレ1秒あたりの速度の変え方。大きいほど速く寄るが、行き過ぎやすい。 */
const RATE_GAIN = 1.5;
/** 速度を変えられない音源（YouTube）で、seek してでも直すズレ（秒）。 */
const SEEK_ONLY_THRESHOLD_SEC = 0.06;
/** 補正 seek の「鳴り直すまでの遅れ」の初期見積り（秒）。実測で学習して置き換わる。 */
const DEFAULT_SEEK_LAG_SEC = 0.07;
/** 学習する見越し量の上限（秒）。 */
const MAX_SEEK_LAG_SEC = 0.6;
/** 補正 seek のあと、着地を測るまでに置く時間（秒）。 */
const SEEK_SETTLE_SEC = 0.6;
/**
 * seek し直す価値があるズレ（秒）。seek 自体が100ms前後の立ち上がりを伴うので、
 * これより小さいズレを seek で詰めようとすると、詰めた量より大きく遅れ直す。
 */
const SEEK_WORTH_SEC = 0.15;

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
	o: BackingStartOptions & {
		now: () => number;
		/** 既に鳴っている音源に後から追従だけ始める（頭出しと再生はしない）。 */
		alreadyRolling?: boolean;
	},
): MediaDrive => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let initialFix: ReturnType<typeof setTimeout> | null = null;
	let interval: ReturnType<typeof setInterval> | null = null;
	let stopped = false;
	/** 合わせる先の直線。時刻 `atTime` に音源が `mediaSec` にいる、という1点で決まる。 */
	let line = { atTime: o.atTime, mediaSec: o.mediaSec };
	/**
	 * 補正の seek をしてから実際に鳴り直すまでの遅れ（秒）。
	 *
	 * seek は「その位置へ飛ぶ」だけでなく、飛んだ先を読み直すぶん必ず遅れて鳴り出す。
	 * 見越さずに撃つと、撃つたびにその遅れぶん後ろへ着地してしまう
	 * （YouTubeで実測 約70ms。速度で寄せられないので、そこで固定されてしまう）。
	 * 1回撃つごとに残差から学習し、次からはそのぶん先を狙う。
	 */
	let seekLagSec = DEFAULT_SEEK_LAG_SEC;
	/** 直近の補正 seek の時刻（落ち着いたころに残差を測って学習する）。 */
	let correctedAt: number | null = null;

	/** 補正の seek。見越したぶん先を狙い、あとで残差から見越し量を学習する。 */
	const correctTo = (position: number): void => {
		media.seek(position + seekLagSec);
		correctedAt = o.now();
	};

	/** `line` を起点に、いま鳴っているべき音源内の位置。 */
	const expectedAt = (now: number): number =>
		line.mediaSec + (now - line.atTime);

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

	const rangeStart = Math.max(0, o.rangeStartSec ?? 0);

	const begin = (): void => {
		if (stopped) return;
		const at = Math.max(rangeStart, expectedAt(o.now()));
		media.seek(at);
		media.play();
		// 鳴り始めの遅れを実測して一度だけ詰める。
		snapToLine(at);
		watch();
	};

	/**
	 * 実測したズレを1回で詰める。
	 *
	 * 厄介なのは、`currentTime` が「実際に鳴り始めてから」しか進まないこと。
	 * 再生開始（と seek のやり直し）には毎回同じだけの立ち上がり時間が掛かるので、
	 * 素直に「あるべき位置」へ seek しても、その seek の立ち上がりぶんだけまた遅れる。
	 * なので**測った遅れを足した先**へ撃つ。1回で系統的なズレが消える。
	 *
	 * @param from まだ動き出していないことを判定する基準位置。
	 */
	const snapToLine = (from: number, pass = 1): void => {
		let waited = 0;
		const fix = (): void => {
			initialFix = null;
			if (stopped) return;
			const moving = media.currentTime() > from + 0.01;
			waited += INITIAL_FIX_MS;
			// まだ進み始めていないなら測っても無意味なので、動き出すまで待つ
			if (!moving && waited < INITIAL_FIX_TIMEOUT_MS) {
				initialFix = setTimeout(fix, INITIAL_FIX_MS);
				return;
			}
			const lag = expectedAt(o.now()) - media.currentTime();
			// **遅れているときだけ** seek で詰める。進みすぎを seek で戻すと、
			// seek 自体の立ち上がり（`<audio>` で実測 約100ms）ぶん今度は遅れ、
			// それをまた seek で…と振動する。戻す側は再生速度に任せる。
			//
			// 2回目以降は「seek の立ち上がりより大きく遅れている」ときだけ撃つ。
			// 残りが立ち上がりより小さいのに撃つと、詰めた量より大きく遅れ直して
			// かえって悪化する（1回目で大抵は入る）。
			if (lag <= (pass === 1 ? 0.015 : SEEK_WORTH_SEC)) return;
			// 測った遅れを足した先へ撃つ（seek の立ち上がりを見越す）。
			media.seek(expectedAt(o.now()) + lag);
			// 1回で詰め切れないことがあるので、残りをもう一度だけ測って詰める。
			if (pass < SNAP_MAX_PASSES) {
				snapToLine(Number.NEGATIVE_INFINITY, pass + 1);
			}
		};
		if (initialFix !== null) clearTimeout(initialFix);
		initialFix = setTimeout(fix, INITIAL_FIX_MS);
	};

	/** 鳴っている音源のズレを見張って詰め続ける。 */
	const watch = (): void => {
		if (stopped || interval !== null) return;
		interval = setInterval(() => {
			const now = o.now();
			const expected = expectedAt(now);
			if (o.endSec && expected >= o.endSec) {
				stop();
				return;
			}
			const drift = media.currentTime() - expected;
			const distance = Math.abs(drift);
			// 補正の seek が落ち着いたら、残差から「見越し量」を学習する。
			// 狙いどおり着地していれば残差0、遅れて着地していればその分だけ足りない。
			if (correctedAt !== null && now - correctedAt >= SEEK_SETTLE_SEC) {
				correctedAt = null;
				seekLagSec = Math.max(
					0,
					Math.min(MAX_SEEK_LAG_SEC, seekLagSec - drift),
				);
			}
			if (!media.canNudgeRate) {
				// 速度を変えられない音源（YouTube）は seek で直すしかない。
				// 読み取りが粗い（数百ms刻み）ので小さなズレは触らず、はっきり
				// ズレたときだけ飛ばす（毎回飛ばすと音が途切れて耳につく）。
				// 補正待ちの間は測っても seek の途中なので触らない。
				if (correctedAt === null && distance > SEEK_ONLY_THRESHOLD_SEC) {
					correctTo(expected);
				}
				return;
			}
			if (distance > HARD_SEEK_SEC) {
				media.setRate(1);
				correctTo(expected);
				return;
			}
			if (distance <= DRIFT_DEAD_ZONE_SEC) {
				media.setRate(1);
				return;
			}
			// 進みすぎ（drift>0）なら遅く、遅れているなら速く。
			// seek と違って音が途切れないぶん、強めに寄せても気付かれにくい。
			const nudge = Math.max(
				-MAX_RATE_NUDGE,
				Math.min(MAX_RATE_NUDGE, -drift * RATE_GAIN),
			);
			media.setRate(1 + nudge);
		}, DRIFT_CHECK_MS);
	};

	if (o.alreadyRolling) {
		// 既に鳴っている＝頭出しも待ちも要らない。追従だけ始める。
		watch();
	} else {
		// 再生範囲の頭より手前を指されている＝まだ鳴らさない区間。`expectedAt` が
		// 範囲の頭に届く時刻まで待ってから始める。届いているなら atTime ちょうど。
		const waitSec = Math.max(
			0,
			o.atTime - o.now(),
			o.atTime + (rangeStart - o.mediaSec) - o.now(),
		);
		const delayMs = waitSec * 1000;
		if (delayMs < 1) begin();
		else timer = setTimeout(begin, delayMs);
	}

	return {
		stop,
		// 合わせる先だけ差し替える。既に鳴っている音は止めない。
		// `snap` 付きなら、その場で1回だけ実測して線の上へ乗せ直す
		// （鳴らし始めた直後は、じわじわ寄せるより飛ばしたほうが気にならない）。
		rebase: (next, opts) => {
			line = { ...next };
			if (opts?.snap) snapToLine(Number.NEGATIVE_INFINITY);
		},
	};
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
	/** グラフ外音源の追従ハンドル（再生中のみ）。 */
	let drive: MediaDrive | null = null;

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
		drive?.stop();
		drive = null;
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

	/** いまの音源を {@link ExternalMedia} として扱う口（グラフ外の音源だけ）。 */
	const externalMediaOf = (): ExternalMedia | null => {
		if (loaded?.mode === "element" && element) {
			const el = element;
			return {
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
			};
		}
		if (loaded?.mode === "youtube" && ytPlayer) {
			const player = ytPlayer;
			return {
				seek: (sec) => player.seekTo(sec, true),
				play: () => player.playVideo(),
				pause: () => player.pauseVideo(),
				currentTime: () => player.getCurrentTime(),
				// YouTubeの再生速度は離散値（0.25/0.5/1/1.25…）しか受け付けないので、
				// 微調整はできない。ズレたら seek で直す。
				canNudgeRate: false,
				setRate: () => {},
			};
		}
		return null;
	};

	/**
	 * 鳴らし始めて、**読み取り値が動いた瞬間**を捕まえる。
	 *
	 * 現在位置をそのまま読むと、YouTubeのように更新が粗い（数百ms刻み）プレイヤーでは
	 * 「いつの値か」が分からず、遅れて見える。値が変わった瞬間なら、その値は
	 * たった今のものだと分かるので、誤差をポーリング間隔まで押し込める。
	 */
	const rollNow = async (
		media: ExternalMedia,
		target: number,
		timeoutSec: number,
	): Promise<{ atTime: number; mediaSec: number } | null> => {
		media.seek(target);
		media.play();
		const deadline = audioContext.currentTime + timeoutSec;
		let previous = media.currentTime();
		while (audioContext.currentTime < deadline) {
			await new Promise((resolve) => setTimeout(resolve, ROLL_POLL_MS));
			if (!loaded) return null; // 待っている間に音源が外された
			const current = media.currentTime();
			if (current !== previous && current > target + 0.001) {
				return { atTime: audioContext.currentTime, mediaSec: current };
			}
			previous = current;
		}
		return null;
	};

	const startRolling = async (o: {
		mediaSec: number;
		rangeStartSec?: number;
		endSec?: number;
		timeoutSec?: number;
	}): Promise<BackingRoll | null> => {
		if (!loaded) return null;
		// 速度を微調整できる音源（`<audio>`）とデコード済みは、予約してから
		// 実測で詰めたほうが揃う。待ち合わせるのはYouTubeだけ。
		if (loaded.mode !== "youtube") return null;
		const media = externalMediaOf();
		if (!media) return null;
		stopSources();
		const target = Math.max(0, o.rangeStartSec ?? 0, o.mediaSec);
		const rolled = await rollNow(media, target, o.timeoutSec ?? 5);
		if (!loaded) return null;
		const line = rolled ?? {
			atTime: audioContext.currentTime,
			mediaSec: target,
		};
		drive = driveExternalMedia(media, {
			...line,
			rangeStartSec: o.rangeStartSec,
			endSec: o.endSec,
			now: () => audioContext.currentTime,
			alreadyRolling: true,
		});
		// 測れなくても「鳴らし始めた」ことは呼び出し側へ返す。ここで null を返すと
		// 呼び出し側が改めて `start()` を呼び、止めて鳴らし直す＝立ち上がりを
		// 二重に食らって余計に遅れる。
		return { ...line, measured: rolled !== null };
	};

	const start = (o: BackingStartOptions): void => {
		if (!loaded) return;
		stopSources();
		const now = (): number => audioContext.currentTime;
		const rangeStart = Math.max(0, o.rangeStartSec ?? 0);
		if (loaded.mode === "buffer" && buffer) {
			if (o.mediaSec >= buffer.duration) return; // 音源の終端より後ろから再生した
			const src = audioContext.createBufferSource();
			src.buffer = buffer;
			src.connect(gain);
			const offset = Math.max(rangeStart, o.mediaSec);
			// 再生範囲の頭より手前を指されていたら、そこへ届く時刻まで待ってから鳴らす。
			const when = o.atTime + Math.max(0, rangeStart - o.mediaSec);
			const until = o.endSec && o.endSec > offset ? o.endSec : buffer.duration;
			src.start(when, offset, Math.max(0, until - offset));
			source = src;
			return;
		}
		const media = externalMediaOf();
		if (media) {
			if (element) element.volume = gainValue();
			drive = driveExternalMedia(media, { ...o, now });
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
		startRolling,
		rebase: (line, opts) => drive?.rebase(line, opts),
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
