/**
 * マスタディレイ（テンポ同期エコー）— send/return バス。
 *
 * リバーブ（{@link file://./reverb.ts}）と同じ設計: masterGain の並列センドとして
 * 独立に存在し、各ボーカルトラックが個別のセンド量（`e`トークン）で参加を決める。
 * リバーブと違い、ディレイは曲のBPMに同期しないと不自然に聞こえるため、音価
 * （8分・付点8分等）を選ばせて実秒数へ変換する方式にしている（DTMツールの定番UX）。
 */

/** 選べる音価。value は保存用の短いキー、beats は四分音符を1とした拍数。 */
export type DelayDivision = "4" | "8" | "8d" | "16";

export const DELAY_DIVISIONS: {
	value: DelayDivision;
	label: string;
	beats: number;
}[] = [
	{ value: "4", label: "4分", beats: 1 },
	{ value: "8", label: "8分", beats: 0.5 },
	{ value: "8d", label: "付点8分", beats: 0.75 },
	{ value: "16", label: "16分", beats: 0.25 },
];

const clamp = (v: number, lo: number, hi: number): number =>
	Math.max(lo, Math.min(hi, v));

/** 音価とBPMから実際のディレイタイム（秒）を計算する。 */
export const divisionToSeconds = (
	division: DelayDivision,
	bpm: number,
): number => {
	const beats = DELAY_DIVISIONS.find((d) => d.value === division)?.beats ?? 0.5;
	const safeBpm = bpm > 0 ? bpm : 120;
	return (60 / safeBpm) * beats;
};

/**
 * amount(0-100) → ウェットゲイン。上限を抑える（リバーブより低め: 62-63% dry+wetの
 * バランス感を意図的に強くするとリード音がすぐ「二重に聞こえる」耳障りな効果になるため）。
 */
const DELAY_MAX_WET = 0.45;
export const delayAmountToGain = (amount: number): number =>
	(clamp(amount, 0, 100) / 100) * DELAY_MAX_WET;

/** フィードバック（繰り返し回数）は固定。0.3程度で2-3回自然に減衰しつつ聞こえる。 */
const FEEDBACK_GAIN = 0.3;
/** ディレイタイムの最大値（秒）。低いBPM×4分音符でも収まる余裕を持たせる。 */
const MAX_DELAY_SEC = 2.0;

export type DelayBusOptions = {
	amount?: number;
	division?: DelayDivision;
	bpm?: number;
};

export type DelayBus = {
	/** 各トラックのセンドはここへ接続する（ドライ経路とは別の並列パス）。 */
	input: AudioNode;
	/** ウェットゲインを 0-100 でリアルタイムに変更する。 */
	setAmount: (amount: number) => void;
	/** 音価を変更する（現在のBPMと合わせて実秒数へ反映）。 */
	setDivision: (division: DelayDivision) => void;
	/** BPM変化に追従してディレイタイムを再計算する。 */
	setBpm: (bpm: number) => void;
	dispose: () => void;
};

export const createDelayBus = (
	ctx: AudioContext,
	destination: AudioNode,
	options: DelayBusOptions = {},
): DelayBus => {
	const input = ctx.createGain();
	const delayNode = ctx.createDelay(MAX_DELAY_SEC);
	const feedback = ctx.createGain();
	feedback.gain.value = FEEDBACK_GAIN;
	const wetGain = ctx.createGain();
	wetGain.gain.value = delayAmountToGain(options.amount ?? 0);

	input.connect(delayNode);
	delayNode.connect(feedback);
	feedback.connect(delayNode); // フィードバックループ（繰り返しエコー）
	delayNode.connect(wetGain);
	wetGain.connect(destination);

	let bpm = options.bpm ?? 120;
	let division = options.division ?? "8";
	const applyTime = (): void => {
		delayNode.delayTime.setTargetAtTime(
			divisionToSeconds(division, bpm),
			ctx.currentTime,
			0.05,
		);
	};
	applyTime();

	return {
		input,
		setAmount: (amount) => {
			wetGain.gain.setTargetAtTime(
				delayAmountToGain(amount),
				ctx.currentTime,
				0.02,
			);
		},
		setDivision: (d) => {
			division = d;
			applyTime();
		},
		setBpm: (b) => {
			bpm = b;
			applyTime();
		},
		dispose: () => {
			input.disconnect();
			delayNode.disconnect();
			feedback.disconnect();
			wetGain.disconnect();
		},
	};
};
