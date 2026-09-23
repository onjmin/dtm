/**
 * 単発の語り（`VoiceModel.speak`）のチャンクを、AudioContext のどの時刻に置くかの計算。
 *
 * 語りは計画（モーラの時刻）が先に出来て、音はチャンクごとに後から届く。届いたチャンクは
 * 「タイムライン 0（＝最初のモーラ）をどの時刻に合わせるか」＝ anchor を基準に置くが、
 * 合成が再生に追いつかないと、次のチャンクが届いた時点で置き場所がもう過ぎていることがある。
 * そのときの扱いが 2 通りある（{@link SpeechLateChunks}）。
 *
 * - `"skip"` … 過ぎたぶんを飛ばして途中から鳴らす。anchor は動かないので、曲の伴奏など
 *   外の時間軸との同期は保たれるが、遅れたぶんの言葉が欠ける（先頭が遅れれば頭が欠ける）。
 *   MML の `「…」` 語りと、`speak` の従来の既定（`awaitRender` が `false` / `true`）。
 * - `"shift"` … anchor（と、まだ置いていない後続すべて）を後ろへずらして頭から鳴らす。
 *   言葉は欠けない代わりに、遅れたぶんだけ間が空き、後ろのモーラが遅れて鳴る。
 *   koe のデモ（最初のチャンクで時間軸を決め、遅れたら残りをずらす）と同じ考え方。
 *
 * AudioContext に触らない純粋な計算だけを置き、`scripts/check-speech-schedule.ts` で
 * チャンクの到着時刻を偽って検算する。
 *
 * @module
 */

/** 置き場所を過ぎてから届いたチャンクの扱い（`SpeakVoiceOptions.lateChunks`）。 */
export type SpeechLateChunks = "shift" | "skip";

/**
 * `speak` の `lateChunks` の既定: 最初のチャンクを待ってから鳴らす（`"first-chunk"`）なら
 * 頭から欠かさず鳴らしたいはずなので `"shift"`、それ以外は従来どおり `"skip"`。
 */
export const resolveLateChunks = (
	awaitRender: boolean | "first-chunk" | undefined,
	lateChunks?: SpeechLateChunks,
): SpeechLateChunks =>
	lateChunks ?? (awaitRender === "first-chunk" ? "shift" : "skip");

/** `speak` の開始猶予（秒）。最初のチャンクを置くまでのメインスレッド 1 周ぶん。 */
export const SPEECH_START_LEAD_SEC = 0.05;
/** これより近い（今から秒）置き場所は「過ぎた」とみなす。 */
export const SPEECH_MIN_LEAD_SEC = 0.01;
/** `"shift"` で後ろへずらすときの置き先（今から秒）。閾値との差がずらし直しの連発を防ぐ。 */
export const SPEECH_SHIFT_LEAD_SEC = 0.03;
/** 途中から鳴らしても残りがこれ未満なら鳴らさない（秒）。 */
const SPEECH_MIN_TAIL_SEC = 0.005;

/** チャンク 1 つの置き方。 */
export type SpeechPlacement = {
	/** 鳴らし始める AudioContext クロック秒。 */
	at: number;
	/** バッファのどこから鳴らすか（秒）。`"skip"` で遅れたぶんを飛ばすときだけ 0 より大きい。 */
	offset: number;
};

/**
 * `"skip"` の置き方: `startAt`（本来鳴るべき時刻）が過ぎていれば、過ぎたぶんを飛ばして
 * 今から鳴らす。丸ごと過ぎていれば null。
 */
export const skipPlacement = (
	startAt: number,
	durationSec: number,
	now: number,
): SpeechPlacement | null => {
	const earliest = now + SPEECH_MIN_LEAD_SEC;
	let at = startAt;
	let offset = 0;
	if (at < earliest) {
		offset = earliest - at;
		at = earliest;
	}
	if (offset >= durationSec - SPEECH_MIN_TAIL_SEC) return null;
	return { at, offset };
};

/** 1 回の発話ぶんのチャンク配置（{@link createSpeechScheduler}）。 */
export type SpeechScheduler = {
	readonly lateChunks: SpeechLateChunks;
	/** 今の見込みでタイムライン 0（最初のモーラ）に当たる時刻。`"shift"` でずれるたびに増える。 */
	readonly anchor: number;
	/**
	 * 最初のモーラが鳴る時刻。最初のチャンクを置いた時点の anchor で確定する
	 * （置く前は今の anchor。`"skip"` では常に開始時刻そのまま）。
	 */
	readonly startTime: number;
	/**
	 * 最初のチャンクを置いたあと、遅れて届いたチャンクのために後ろへずらした合計（秒）。
	 * まだ置いていないモーラは `startTime + shiftSec + mora.startSec` 以降に鳴る。
	 */
	readonly shiftSec: number;
	/** 語りが鳴り終わる見込み（anchor + 語りの長さ）。ずれれば後ろへ動く。 */
	readonly endTime: number;
	/**
	 * チャンク 1 つを置く。`startSec` はタイムライン 0 からの秒（先頭余白のぶん負もあり得る）、
	 * `durationSec` はその音の長さ、`now` は今の AudioContext 時刻。鳴らさないなら null。
	 * チャンクは届いた順（＝タイムラインの順）に渡すこと。
	 */
	place: (
		startSec: number,
		durationSec: number,
		now: number,
	) => SpeechPlacement | null;
	/**
	 * `now` の時点の再生位置（モーラと同じ軸の秒。最初のモーラが 0、鳴る前は負）。
	 * 実際に鳴っている音から測るので、合成待ちで空いた間は進まず、ずれた後続が鳴り出すと
	 * そこから進む。単調非減少。`done`（合成が終わった）なら待ちが無いので止めない。
	 */
	position: (now: number, done: boolean) => number;
};

/** まだ何も鳴っていないときの再生位置（最初のモーラ 0 より手前）。 */
const BEFORE_START = -0.001;

/**
 * 1 回の発話ぶんのチャンク配置を作る。`t0` は最初のモーラを鳴らしたい時刻（今より先）、
 * `durationSec` は語りの長さ（`SpeechHandle.durationSec`）。
 */
export const createSpeechScheduler = (o: {
	t0: number;
	durationSec: number;
	lateChunks: SpeechLateChunks;
}): SpeechScheduler => {
	let anchor = o.t0;
	let startTime: number | null = null;
	/** 置いたチャンク（鳴り始める時刻と、タイムライン上で鳴らす範囲）。時刻の昇順。 */
	const placed: { at: number; from: number; to: number }[] = [];
	let lastPosition = Number.NEGATIVE_INFINITY;
	return {
		lateChunks: o.lateChunks,
		get anchor() {
			return anchor;
		},
		get startTime() {
			return startTime ?? anchor;
		},
		get shiftSec() {
			return startTime === null ? 0 : anchor - startTime;
		},
		get endTime() {
			return anchor + o.durationSec;
		},
		place: (startSec, durationSec, now) => {
			let p: SpeechPlacement | null;
			if (o.lateChunks === "shift") {
				if (durationSec <= 0) return null;
				let at = anchor + startSec;
				if (at < now + SPEECH_MIN_LEAD_SEC) {
					// 合成が再生に追いつかなかった: 飛ばさず、時間軸ごと後ろへずらす。
					anchor += now + SPEECH_SHIFT_LEAD_SEC - at;
					at = anchor + startSec;
				}
				p = { at, offset: 0 };
			} else {
				p = skipPlacement(anchor + startSec, durationSec, now);
			}
			if (!p) return null;
			startTime ??= anchor;
			placed.push({
				at: p.at,
				from: startSec + p.offset,
				to: startSec + durationSec,
			});
			return p;
		},
		position: (now, done) => {
			let pos: number;
			if (placed.length === 0) {
				pos = done ? now - anchor : Math.min(now - anchor, BEFORE_START);
			} else {
				// いちばん最近鳴り始めたチャンクの時計で測る。
				let k = placed.length - 1;
				while (k > 0 && placed[k].at > now) k--;
				const cur = placed[k];
				pos = cur.from + (now - cur.at);
				const next = placed[k + 1];
				// 次のチャンクが後ろへずれて待っている間は、その頭で止める。
				if (next) pos = Math.min(pos, next.from);
				// 次がまだ届いていなければ、鳴っている音の終わりで止める。
				else if (!done) pos = Math.min(pos, cur.to);
			}
			lastPosition = Math.max(lastPosition, pos);
			return lastPosition;
		},
	};
};
