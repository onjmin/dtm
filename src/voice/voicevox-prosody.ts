/**
 * 語り（`「…」`）の抑揚を、手元の VOICEVOX エンジンから借りる。
 *
 * 既定の語りは HTS 音声モデル（tohoku-f01）がモーラの長さと高さを決める
 * （{@link file://./speech.ts}）。ここは、その長さと高さだけを VOICEVOX の
 * `/audio_query`（ニューラルの予測）に差し替えるための変換と問い合わせ。
 * 声そのものは UTAU 音源のままで、VOICEVOX の音声は作らない。
 *
 * - エンジンは利用者の PC の 127.0.0.1 で動くので、利用側が明示的に有効にしたときだけ使う
 *   （{@link file://./lyrics.ts} の `voicevoxProsody`）。既定では問い合わせない。
 * - エンジンに届かない・本文を読めないときは null を返し、呼び出し側は HTS へ戻る。
 * - VOICEVOX を利用するので「VOICEVOX:<話者名>」のクレジット表記が要る
 *   （docs/guide/voicevox-sing.md の「語りの抑揚を借りる」）。
 */

import type { HtsProsodyFrames } from "@onjmin/koe";
import { sanitizeText } from "../safe-text";

/** `/audio_query` の 1 モーラ（使う所だけ）。 */
export type VoicevoxMora = {
	consonant?: string | null;
	consonant_length?: number | null;
	vowel: string;
	vowel_length: number;
	/** 高さ（Hz の自然対数）。無声のモーラと間は 0。 */
	pitch: number;
};

/** `/audio_query` の戻り値（使う所だけ）。 */
export type VoicevoxAudioQuery = {
	accent_phrases: {
		moras: VoicevoxMora[];
		pause_mora?: VoicevoxMora | null;
	}[];
	prePhonemeLength: number;
	postPhonemeLength: number;
};

/** 抑揚に使う話者の既定（四国めたん ノーマル）。 */
export const VOICEVOX_PROSODY_DEFAULT_SPEAKER = 2;

/**
 * `/audio_query` の結果を、koe の `alignHtsProsody` が読める形（音素の時刻表と
 * フレームごとの F0）に直す。音素名は OpenJTalk と同じ（無声化した母音は大文字、
 * 促音は `cl`、撥音は `N`、間は `pau`）なのでそのまま渡せる。
 *
 * 高さはモーラごとに 1 点なので、母音の中心に置いて、同じ息継ぎの中では対数で直線に
 * つなぐ。無声のモーラ（pitch 0）と間は 0（無声）にし、橋渡しは `alignHtsProsody` に任せる。
 * 鳴るモーラが 1 つも無ければ null。
 */
export const voicevoxQueryToProsodyFrames = (
	query: VoicevoxAudioQuery,
	frameMs = 5,
): HtsProsodyFrames | null => {
	const phonemes: HtsProsodyFrames["phonemes"] = [];
	/** 母音の中心の高さ。`group` は息継ぎ（間）で区切った番号。 */
	const anchors: { ms: number; hz: number; group: number }[] = [];
	/** 無声にする区間 [開始, 終了)（ms）。 */
	const silent: [number, number][] = [];
	let t = 0;
	let group = 0;
	const push = (phone: string, sec: number): void => {
		const ms = Math.max(0, sec || 0) * 1000;
		phonemes.push({ phone, start_ms: t, duration_ms: ms });
		t += ms;
	};
	push("sil", query.prePhonemeLength);
	silent.push([0, t]);
	for (const phrase of query.accent_phrases) {
		for (const mora of phrase.moras) {
			const from = t;
			if (mora.consonant) push(mora.consonant, mora.consonant_length ?? 0);
			const vowelFrom = t;
			push(mora.vowel, mora.vowel_length);
			if (mora.pitch > 0) {
				anchors.push({
					ms: (vowelFrom + t) / 2,
					hz: Math.exp(mora.pitch),
					group,
				});
			} else silent.push([from, t]);
		}
		if (phrase.pause_mora) {
			const from = t;
			push("pau", phrase.pause_mora.vowel_length);
			silent.push([from, t]);
			group++;
		}
	}
	const tail = t;
	push("sil", query.postPhonemeLength);
	silent.push([tail, t]);
	if (anchors.length === 0) return null;

	const count = Math.ceil(t / frameMs);
	const f0 = new Array<number>(count).fill(0);
	let k = 0; // anchors[k] が今のフレームより後ろの最初の点
	let s = 0;
	for (let i = 0; i < count; i++) {
		const ms = i * frameMs;
		while (s < silent.length && silent[s][1] <= ms) s++;
		if (s < silent.length && silent[s][0] <= ms) continue;
		while (k < anchors.length && anchors[k].ms <= ms) k++;
		const left = anchors[k - 1];
		const right = anchors[k];
		if (left && right && left.group === right.group) {
			const u = (ms - left.ms) / (right.ms - left.ms);
			f0[i] = Math.exp(Math.log(left.hz) * (1 - u) + Math.log(right.hz) * u);
		} else if (left && (!right || ms - left.ms <= right.ms - ms)) {
			f0[i] = left.hz;
		} else if (right) f0[i] = right.hz;
	}
	return { frame_ms: frameMs, sample_rate: 48000, phonemes, f0_hz: f0 };
};

export type VoicevoxProsodyOptions = {
	/** エンジンの URL。既定 `http://127.0.0.1:50021`。 */
	baseUrl?: string;
	/** 抑揚を借りる話し声のスタイル ID。既定 {@link VOICEVOX_PROSODY_DEFAULT_SPEAKER}。 */
	speaker?: number;
	/** エンジンが動いているかの確認を待つ時間（ms）。既定 1000。 */
	probeTimeoutMs?: number;
	/** 1 文の問い合わせを待つ時間（ms）。既定 5000。 */
	queryTimeoutMs?: number;
	/** 届かなかったあと、次に確かめ直すまでの時間（ms）。既定 30000。 */
	retryMs?: number;
	/** テスト用の差し替え。 */
	fetch?: typeof fetch;
	now?: () => number;
};

export type VoicevoxProsodySource = {
	/**
	 * 本文の抑揚を引く。エンジンに届かない・読めない本文は null（HTS へ戻る合図）。
	 * 同じ本文は 1 回だけ問い合わせる。投げない。
	 */
	frames: (text: string) => Promise<HtsProsodyFrames | null>;
};

/** 語り 1 つの本文の上限（文字数）。{@link file://./voicevox-sing.ts} の語りと同じ。 */
const MAX_TALK_CHARS = 300;

/**
 * VOICEVOX から抑揚を引く係を作る。最初の問い合わせの前に `/version` でエンジンを確かめ、
 * 届かなければ `retryMs` のあいだは問い合わせずに null を返す（語りのたびに待たせない）。
 */
export const createVoicevoxProsodySource = (
	options: VoicevoxProsodyOptions = {},
): VoicevoxProsodySource => {
	const {
		baseUrl = "http://127.0.0.1:50021",
		speaker = VOICEVOX_PROSODY_DEFAULT_SPEAKER,
		probeTimeoutMs = 1000,
		queryTimeoutMs = 5000,
		retryMs = 30000,
		now = Date.now,
	} = options;
	const doFetch = options.fetch ?? fetch;
	const timed = async (
		url: string,
		init: RequestInit,
		ms: number,
	): Promise<Response> => {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), ms);
		try {
			return await doFetch(url, { ...init, signal: abort.signal });
		} finally {
			clearTimeout(timer);
		}
	};

	let alive: Promise<boolean> | null = null;
	/** 届かなかった時刻（届いている・未確認は null）。 */
	let downSince: number | null = null;
	const probe = (): Promise<boolean> => {
		if (alive && (downSince === null || now() - downSince < retryMs))
			return alive;
		downSince = null;
		alive = timed(`${baseUrl}/version`, {}, probeTimeoutMs)
			.then((r) => r.ok)
			.catch(() => false)
			.then((ok) => {
				if (!ok) downSince = now();
				return ok;
			});
		return alive;
	};

	const cache = new Map<string, Promise<HtsProsodyFrames | null>>();
	const frames: VoicevoxProsodySource["frames"] = (text) => {
		const safe = sanitizeText(text, MAX_TALK_CHARS);
		if (!safe) return Promise.resolve(null);
		const hit = cache.get(safe);
		if (hit) return hit;
		const job = (async () => {
			if (!(await probe())) return null;
			try {
				const res = await timed(
					`${baseUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(safe)}`,
					{ method: "POST" },
					queryTimeoutMs,
				);
				if (!res.ok) return null;
				return voicevoxQueryToProsodyFrames(
					(await res.json()) as VoicevoxAudioQuery,
				);
			} catch {
				return null;
			}
		})();
		cache.set(safe, job);
		// 届かなかった結果は覚えない（エンジンを後から起動したら次は引けるように）。
		void job.then((f) => {
			if (!f && cache.get(safe) === job) cache.delete(safe);
		});
		return job;
	};
	return { frames };
};

/** ページ共有（URL と話者ごとに 1 つ。エンジンの確認と問い合わせの結果を使い回す）。 */
const sharedSources = new Map<string, VoicevoxProsodySource>();
export const getVoicevoxProsodySource = (
	options: Pick<VoicevoxProsodyOptions, "baseUrl" | "speaker"> = {},
): VoicevoxProsodySource => {
	const key = `${options.baseUrl ?? ""}|${options.speaker ?? ""}`;
	let source = sharedSources.get(key);
	if (!source) {
		source = createVoicevoxProsodySource(options);
		sharedSources.set(key, source);
	}
	return source;
};
