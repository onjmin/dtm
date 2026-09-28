/**
 * マスタリバーブ／ディレイ（曲全体に効く送りエフェクトの戻り）の設定。
 *
 * エディタは MML の `#reverb=` `#reverbdecay=` `#reverbpredelay=` `#delay=` `#delaydiv=` を
 * 読み込み時にスライダーへ反映して鳴らすが、再生専用の経路（`studio.play` /
 * `studio.mountPlayer`）はこれを読んでいなかった。トラックごとの送り（`#t<n>rev=` 等）は
 * 効いているのに戻り（ウェットゲイン）が 0 のままなので、残響が一切鳴らず乾いた音になる。
 *
 * studio のリバーブ／ディレイは全プレイヤー・エディタで1つを共有するので、曲に書かれて
 * いない項目は**studio 生成時の既定値へ戻す**（前に鳴らした曲・エディタの値を持ち越さない。
 * チャンネルストリップの `applyStripSettings` と同じ考え方）。
 *
 * DAW の**全体読み込み**も同じ規則（{@link masterFxFromMeta} に DAW 生成時の既定値を渡す）で
 * スライダーを決める。書かれている項目だけ更新すると、前の曲（や「おまかせ」）の値が残り、
 * 書き出しで `#reverb=…` として投稿に乗ってしまう（0 は書き出しで省かれるので、
 * リバーブ無しの曲を読み込み直しても戻らなかった）。
 *
 * DOM に依存しない（`scripts/check-fx-font-drum.ts` が Node で検算する）。
 */

import type { DelayDivision } from "./delay";
import type { MmlMeta } from "./mml-parser";

export type MasterFxSettings = {
	/** リバーブの掛かり具合 0-100。 */
	reverbAmount: number;
	/** リバーブの Decay（秒）。 */
	reverbDecaySec: number;
	/** リバーブの Pre Delay（ms）。 */
	reverbPreDelayMs: number;
	/** ディレイの掛かり具合 0-100。 */
	delayAmount: number;
	/** ディレイの音価。 */
	delayDivision: DelayDivision;
};

const DELAY_DIVISION_VALUES: readonly string[] = ["4", "8", "8d", "16"];

const isDelayDivision = (v: string | undefined): v is DelayDivision =>
	v !== undefined && DELAY_DIVISION_VALUES.includes(v);

/**
 * MML のメタから、その曲を鳴らすときのマスタエフェクト設定を作る。
 * 書かれていない項目は `defaults`（studio 生成時の既定値）になる。
 * 単位はエディタの読み込みと同じ（`#reverbdecay=` は 0.1 秒単位）。
 */
export const masterFxFromMeta = (
	meta: Pick<
		MmlMeta,
		"reverb" | "reverbDecay" | "reverbPreDelay" | "delay" | "delayDivision"
	>,
	defaults: MasterFxSettings,
): MasterFxSettings => ({
	reverbAmount: meta.reverb ?? defaults.reverbAmount,
	reverbDecaySec:
		meta.reverbDecay !== undefined
			? meta.reverbDecay / 10
			: defaults.reverbDecaySec,
	reverbPreDelayMs: meta.reverbPreDelay ?? defaults.reverbPreDelayMs,
	delayAmount: meta.delay ?? defaults.delayAmount,
	delayDivision: isDelayDivision(meta.delayDivision)
		? meta.delayDivision
		: defaults.delayDivision,
});

/**
 * {@link masterFxFromMeta} の逆。DAW の書き出しが `formatMmlMeta` へ渡す形
 * （`#reverbdecay=` は 0.1 秒単位の整数）へ戻す。既定値（reverb 0 等）を省くのは
 * `formatMmlMeta` 側。
 */
export const masterFxToMeta = (
	fx: MasterFxSettings,
): Pick<
	MmlMeta,
	"reverb" | "reverbDecay" | "reverbPreDelay" | "delay" | "delayDivision"
> => ({
	reverb: fx.reverbAmount,
	reverbDecay: Math.round(fx.reverbDecaySec * 10),
	reverbPreDelay: fx.reverbPreDelayMs,
	delay: fx.delayAmount,
	delayDivision: fx.delayDivision,
});

/** マスタエフェクトの設定先（studio のリバーブ・ディレイ）。 */
export type MasterFxTarget = {
	setReverbAmount: (amount: number) => void;
	setReverbDecay: (seconds: number) => void;
	setReverbPreDelay: (ms: number) => void;
	setDelayAmount: (amount: number) => void;
	setDelayDivision: (division: DelayDivision) => void;
	/** ディレイはテンポ同期なので、曲の BPM も合わせて渡す。 */
	setDelayBpm: (bpm: number) => void;
};

/** 設定一式を設定先へ流し込む（全項目を必ず上書きする＝持ち越さない）。 */
export const applyMasterFx = (
	target: MasterFxTarget,
	fx: MasterFxSettings,
	bpm: number,
): void => {
	target.setReverbAmount(fx.reverbAmount);
	target.setReverbDecay(fx.reverbDecaySec);
	target.setReverbPreDelay(fx.reverbPreDelayMs);
	target.setDelayAmount(fx.delayAmount);
	target.setDelayDivision(fx.delayDivision);
	target.setDelayBpm(bpm);
};

/**
 * マスタのグルーコンプとフェード（`#mastercomp=` `#fadein=` `#fadeout=`）。DAW のスライダーの値で持つ
 * （フェードは秒）。
 */
export type MasterDynamics = {
	/** グルーコンプ 0-100。 */
	masterCompression: number;
	/** フェードイン（秒）。 */
	fadeInSec: number;
	/** フェードアウト（秒）。 */
	fadeOutSec: number;
};

/**
 * MML のメタから、DAW の全体読み込みで当てるグルーコンプとフェードを作る。**書かれていない項目は
 * `defaults`（DAW 生成時の既定値）になる**（{@link masterFxFromMeta} と同じ規則）。
 *
 * 書き出し（`formatMmlMeta`）は 0 を省くので、書かれた項目だけ更新すると、前の曲や「おまかせ」の
 * 値（グルーコンプ 25・フェードアウト 1.5 秒）が残る。伴奏主体のループ曲をキープ → 歌もので作曲 →
 * 入れ替え、とすると、ループ曲にフェードとコンプが付いたまま鳴っていた。
 * 単位は `#fadein=` `#fadeout=` が 0.1 秒、戻り値は秒。
 */
export const masterDynamicsFromMeta = (
	meta: Pick<MmlMeta, "masterCompression" | "fadeIn" | "fadeOut">,
	defaults: MasterDynamics,
): MasterDynamics => ({
	masterCompression: meta.masterCompression ?? defaults.masterCompression,
	fadeInSec: meta.fadeIn !== undefined ? meta.fadeIn / 10 : defaults.fadeInSec,
	fadeOutSec:
		meta.fadeOut !== undefined ? meta.fadeOut / 10 : defaults.fadeOutSec,
});
