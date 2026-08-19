/**
 * マスタリバーブ — 全トラック（楽器・歌唱とも）に一律で掛かるマスタエフェクト。
 * 外部ファイル（インパルス応答wav）を使わず、減衰ホワイトノイズから手続き的に
 * インパルス応答を合成する（`ConvolverNode` は事前録音・生成いずれのバッファでも動く）。
 */

/** インパルス応答の長さ（秒）。ルーム〜ホール程度の残響感。 */
const IMPULSE_DURATION_SEC = 2.2;

/** 減衰カーブの指数。大きいほど早く減衰し、こもらず自然に聞こえる。 */
const IMPULSE_DECAY = 2.5;

/**
 * 減衰ホワイトノイズによる疑似インパルス応答を生成する。
 * ステレオ2ch、チャンネルごとに独立乱数（相関を避けて広がりを出す）。
 */
export const createReverbImpulse = (ctx: BaseAudioContext): AudioBuffer => {
	const rate = ctx.sampleRate;
	const length = Math.max(1, Math.floor(rate * IMPULSE_DURATION_SEC));
	const impulse = ctx.createBuffer(2, length, rate);
	for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
		const data = impulse.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			const envelope = (1 - i / length) ** IMPULSE_DECAY;
			data[i] = (Math.random() * 2 - 1) * envelope;
		}
	}
	return impulse;
};

/**
 * amount(0-100) → ウェットゲイン。上限を抑えて「掛けすぎ」を防ぐ
 * （フルスケールにすると歌詞の子音・アタックが埋もれて聞き取りにくくなるため）。
 */
const REVERB_MAX_WET = 0.6;
export const reverbAmountToGain = (amount: number): number =>
	(Math.max(0, Math.min(100, amount)) / 100) * REVERB_MAX_WET;
