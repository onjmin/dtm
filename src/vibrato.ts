/**
 * 自動ビブラート（ロングトーンに自動で掛けるピッチLFO）の定数と曲線生成。
 *
 * メインスレッド（{@link file://./lyrics.ts} の local backend）とWorker
 * （{@link file://./voice-worker.ts}）の両方から使う共通ロジックなのでここへ切り出す。
 * 実際のLFOは koe の `Worldline.renderNote` が受け取る `CurveInput`（関数）として渡す
 * だけで、koe自身は「ビブラートとは何か」を知らない — 表現の中身はdtm側の責務。
 */

/**
 * 自動ビブラートを掛ける最短ノート長（秒）。テンポに関わらず一定（実時間基準）。
 * ビブラート(5.5Hz程度)が最低1周期以上揺れきるには ~180ms 要るが、聴感上わかる
 * 「歌っぽさ」を出すには2周期分は欲しいため、余裕を見て350msを既定閾値とする。
 * これより短い音符は対象外（1周期も揺れきらず、ただの音程ブレとして不自然に響く）。
 * beat/BPM基準ではなくms基準にしているのは、同じ「1拍」でもテンポが変われば実時間の
 * 長さが変わり、ビブラートが自然に聞こえるかどうかは実時間側に依存するため。
 */
export const VIBRATO_MIN_SEC = 0.35;

/** 自動ビブラートの速さ（Hz）。人の歌唱ビブラートの標準域（5〜6Hz）の中庸値。 */
const VIBRATO_RATE_HZ = 5.5;

/** 自動ビブラートの深さ（セント）。±35セント ≈ 半音の1/3強、控えめで違和感の少ない量。 */
const VIBRATO_DEPTH_CENTS = 35;

/** ビブラート開始までのフェードイン長（ms）。発音直後は素直な音程を保つ。 */
const VIBRATO_FADE_MS = 150;

/**
 * ピッチにビブラートLFOを掛けた曲線関数を返す（koeの `RenderNoteParams.pitch` へ渡す）。
 * ノート先頭 {@link VIBRATO_FADE_MS} は深さを線形フェードインし、子音・立ち上がりの
 * 音程を素直に保つ。preMs 以前（子音・先行母音の重なり区間）はビブラートを掛けない。
 *
 * @param baseHz 目標ピッチ（Hz）
 * @param preMs レンダリング先頭からの母音オンセットまでの先行秒（ms）
 */
export const vibratoPitchCurve =
	(baseHz: number, preMs: number) =>
	(tMs: number): number => {
		const sinceOnset = tMs - preMs;
		if (sinceOnset <= 0) return baseHz;
		const depth =
			VIBRATO_DEPTH_CENTS * Math.min(1, sinceOnset / VIBRATO_FADE_MS);
		const cents =
			depth * Math.sin((2 * Math.PI * VIBRATO_RATE_HZ * sinceOnset) / 1000);
		return baseHz * 2 ** (cents / 1200);
	};
