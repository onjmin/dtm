/**
 * 曲頭/曲尾のフェード。
 *
 * マスタバスの最終段（安全リミッターの後ろ）へ1枚だけ挟むゲインで実現する。最後に置くのは、
 * 他のどの処理よりも優先して音量0まで落とせるようにするため。既定は常に1（フェードなし）。
 */

import type { FadeScheduleParams } from "./types";

/**
 * フェード解除に掛ける秒数。1 へ即座に飛ばすと、リバーブ／ディレイの残響が鳴っている
 * 最中だと波形がその瞬間に段差を作り、プチノイズになる。20msあれば聴感上は即時。
 */
const FADE_RESTORE_SEC = 0.02;

/**
 * フェードアウト完了後、通常音量へ自動復帰させるまでの秒数。0 のまま放置すると停止後の
 * プレビュー試聴までミュートされるので、残響が消え去るだけの猶予を置いてから戻す。
 */
const FADE_TAIL_SEC = 2.0;

export type FadeBus = {
	/**
	 * マスタバス最終段のゲイン。録音タップはここから取る（＝フェード適用後の音が録れる）。
	 */
	node: GainNode;
	/**
	 * 1回の再生で使うフェードスケジュールを適用する。null で解除（音量1へ戻す）。
	 * pause/stop 時に必ず null を渡してもらう想定 — 途中で止めた場合に半端な音量や
	 * 予約済みランプが残らないようにするため。
	 */
	schedule: (params: FadeScheduleParams | null) => void;
	/** フェードで音量が下がったままなら通常音量へ戻す（プレビュー試聴・再生開始時）。 */
	restoreIfMuted: () => void;
};

/** `destination` の手前に挟むフェード用ゲインを作る。 */
export const createFadeBus = (
	ctx: AudioContext,
	destination: AudioNode,
): FadeBus => {
	const node = ctx.createGain();
	node.gain.value = 1;
	node.connect(destination);

	/** 現在値から滑らかに 1 へ戻す。予約済みランプの解除は呼び出し側の責任。 */
	const rampToUnity = (from: number, at: number): void => {
		node.gain.setValueAtTime(from, at);
		node.gain.linearRampToValueAtTime(1, at + FADE_RESTORE_SEC);
	};

	const restoreIfMuted = (): void => {
		const current = node.gain.value;
		if (current >= 1) return;
		const now = ctx.currentTime;
		node.gain.cancelScheduledValues(now);
		// 残響が鳴っている最中に 1 へ飛ばすとそこが段差になるので、必ず傾きを付ける。
		rampToUnity(current, now);
	};

	const schedule = (params: FadeScheduleParams | null): void => {
		const now = ctx.currentTime;
		const current = node.gain.value;
		node.gain.cancelScheduledValues(now);
		if (!params) {
			rampToUnity(current, now);
			return;
		}
		const { fadeInStartAt, fadeInEndAt, fadeOutStartAt, fadeOutEndAt } = params;
		if (fadeInStartAt !== undefined && fadeInEndAt !== undefined) {
			node.gain.setValueAtTime(0, fadeInStartAt);
			node.gain.linearRampToValueAtTime(1, fadeInEndAt);
		} else {
			rampToUnity(current, now);
		}
		if (fadeOutStartAt !== undefined && fadeOutEndAt !== undefined) {
			node.gain.setValueAtTime(1, fadeOutStartAt);
			node.gain.linearRampToValueAtTime(0, fadeOutEndAt);
			// フェードアウト完了後は、リバーブやディレイの残響が完全に減衰するまで 0 を保つ。
			node.gain.setValueAtTime(0, fadeOutEndAt + FADE_TAIL_SEC);
			node.gain.linearRampToValueAtTime(
				1,
				fadeOutEndAt + FADE_TAIL_SEC + FADE_RESTORE_SEC,
			);
		}
	};

	return { node, schedule, restoreIfMuted };
};

/**
 * 1回の再生ぶんのフェード予約を組み立てる。
 *
 * `durationSec` は「再生開始から曲が終わるまで」の秒数で、**シーケンサが曲を終える時刻と
 * 同じもの**を渡すこと。音符の終端で代用すると、音符より後ろまで鳴るもの（ドラムパターンの
 * 残り・伴奏音源）がフェードの外に出て、フェードアウト完了後にフル音量で鳴り出す。
 */
export const computeFadeParams = (o: {
	/** 曲の開始時刻（シーケンサの getStartTime）。 */
	anchor: number;
	fadeInSec: number;
	fadeOutSec: number;
	/** 曲頭から再生しているか（フェードインは曲頭からのときだけ掛ける）。 */
	atSongStart: boolean;
	durationSec: number;
}): FadeScheduleParams => {
	const params: FadeScheduleParams = {};
	if (o.fadeInSec > 0 && o.atSongStart) {
		params.fadeInStartAt = o.anchor;
		params.fadeInEndAt = o.anchor + o.fadeInSec;
	}
	// 残り再生時間がごく短いときは掛けない（頭出し直後に一瞬で0になるのを防ぐ）。
	if (o.fadeOutSec > 0 && o.durationSec > 0.1) {
		const fadeOutEndAt = o.anchor + o.durationSec;
		const earliestStart = params.fadeInEndAt ?? o.anchor;
		const fadeOutStartAt = Math.max(fadeOutEndAt - o.fadeOutSec, earliestStart);
		if (fadeOutStartAt < fadeOutEndAt) {
			params.fadeOutStartAt = fadeOutStartAt;
			params.fadeOutEndAt = fadeOutEndAt;
		}
	}
	return params;
};
