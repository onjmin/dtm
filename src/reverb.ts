/**
 * マスタリバーブ — 全トラック（楽器・歌唱とも）に一律で掛かるマスタエフェクト。
 * 外部ファイル（インパルス応答wav）を使わず、減衰ホワイトノイズから手続き的に
 * インパルス応答を合成する（`ConvolverNode` は事前録音・生成いずれのバッファでも動く）。
 */

/**
 * Decay（残響の長さ）の既定値・範囲（秒）。ルーム〜ホール程度の残響感。
 * 目安: 速い曲 0.6〜1.4秒、遅い曲 1.8〜4.0秒（一般的なプレートリバーブの使い分けに準拠）。
 */
export const DEFAULT_REVERB_DECAY_SEC = 2.2;
export const MIN_REVERB_DECAY_SEC = 0.3;
export const MAX_REVERB_DECAY_SEC = 4.0;

/** 減衰カーブの指数。大きいほど早く減衰し、こもらず自然に聞こえる。 */
const IMPULSE_DECAY_CURVE = 2.5;

/**
 * Pre Delay（原音からリバーブが立ち上がるまでの遅延）の既定値・範囲（ms）。
 * 短いほど「密着」、長いほど原音の輪郭を保ったまま奥行きを足せる。
 */
export const DEFAULT_REVERB_PREDELAY_MS = 0;
export const MIN_REVERB_PREDELAY_MS = 0;
export const MAX_REVERB_PREDELAY_MS = 150;

/**
 * 減衰ホワイトノイズによる疑似インパルス応答を生成する。
 * ステレオ2ch、チャンネルごとに独立乱数（相関を避けて広がりを出す）。
 * @param decaySec 残響の長さ（秒）。Decayつまみの値をそのまま渡す。
 */
export const createReverbImpulse = (
	ctx: BaseAudioContext,
	decaySec: number = DEFAULT_REVERB_DECAY_SEC,
): AudioBuffer => {
	const rate = ctx.sampleRate;
	const length = Math.max(
		1,
		Math.floor(
			rate *
				Math.max(
					MIN_REVERB_DECAY_SEC,
					Math.min(MAX_REVERB_DECAY_SEC, decaySec),
				),
		),
	);
	const impulse = ctx.createBuffer(2, length, rate);
	for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
		const data = impulse.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			const envelope = (1 - i / length) ** IMPULSE_DECAY_CURVE;
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
