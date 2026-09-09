/**
 * マスタ出力の安全リミッター（常時ON）。
 *
 * 音が突然大きくなって耳やスピーカーを傷めることがないよう、ユーザー設定に関わらず
 * 出力の直前でピークを抑える（0dBFS付近のブリックウォール）。トラック単位の
 * コンプレッサー（{@link file://./channel-strip.ts}、音圧強化）やマスタの
 * グルーコンプ（表現目的）とは別物 — こちらは「保険」であって表現ではない。
 *
 * **これが無い経路があるとプチノイズの発生源になる。** 各トラックが個別にコンプを
 * 通っていても、その**和**は誰も抑えていない。合計が ±1.0 を超えるとデバイス側で
 * ハードクリップし、波形が頭打ちの角になって「バリッ」「プチ」と鳴る。内蔵synth経路
 * （{@link file://./headless-player.ts} / {@link file://./mml-player.ts}）は
 * 1トラック1発音器の構成なので、同時発音が増えるほど和が伸びて特に起きやすい。
 * そのため DAWエディタ（{@link file://./studio.ts}）と同じものを全経路へ通す。
 */

/** ピークを抑え始める水準(dBFS)。0dBFSぎりぎりではなく少し余裕を持たせる。 */
const THRESHOLD_DB = -1;
/** ニー(dB)。0 = ハードニー（閾値を境にはっきり効かせる）。 */
const KNEE_DB = 0;
/** 圧縮比。20:1 で実質リミッター。 */
const RATIO = 20;
/** アタック(秒)。1ms。突発ピークを取り逃さない速さ。 */
const ATTACK_SEC = 0.001;
/** リリース(秒)。100ms。抑えたあと素早く戻る。 */
const RELEASE_SEC = 0.1;

// ── 最終段のソフトクリップ ──
// DynamicsCompressorNode は**ブリックウォールではない**。20:1 で圧縮するだけなので、
// 入力が振り切れるほど出力もじわじわ 1.0 を超えていく（実測: 閾値-1dB で入力2倍→1.016、
// 4倍→1.062、16倍→1.162）。超えた分はデバイス側でハードクリップされ、波形が角の付いた
// 頭打ちになる＝プチ／バリッと鳴る。そこで最後に「角の立たない上限」を掛けて、
// はみ出しをハードクリップではなく滑らかな飽和で受け止める。
/** カーブの分解能。 */
const CURVE_SAMPLES = 2048;
/** この振幅までは完全に素通し（-1.4dBFS）。通常の再生はここに収まる。 */
const SOFT_KNEE = 0.85;
/** 漸近する上限。0dBFSより下に置いて、絶対に振り切らせない。 */
const CEILING = 0.98;
/** カーブへ載せる入力レンジ（±この値）。リミッター通過後の想定最大より広く取る。 */
const SHAPER_RANGE = 4;
/**
 * オーバーサンプリングは `"none"` 固定。`"2x"` 以上は Chromium で 128サンプルの遅延が
 * 付き、マスタ全体が遅れて他の音（歌声ストリーム等）と位相がずれる
 * （{@link file://./amp-sim.ts} の OVERSAMPLE の注記と同じ理由）。
 */
const OVERSAMPLE: OverSampleType = "none";

/** SOFT_KNEE までは y=x、そこから CEILING へ tanh で漸近するカーブ。接線も連続。 */
const createSoftClipCurve = (): Float32Array => {
	const curve = new Float32Array(CURVE_SAMPLES);
	const span = CEILING - SOFT_KNEE;
	for (let i = 0; i < CURVE_SAMPLES; i++) {
		const x = ((i / (CURVE_SAMPLES - 1)) * 2 - 1) * SHAPER_RANGE;
		const a = Math.abs(x);
		curve[i] =
			Math.sign(x) *
			(a <= SOFT_KNEE
				? a
				: SOFT_KNEE + span * Math.tanh((a - SOFT_KNEE) / span));
	}
	return curve;
};

/**
 * 安全リミッター（コンプ → ソフトクリップ）を作り、`destination` へ接続して返す。
 * 出力したい音は返り値のノードへ接続する。
 */
export const createSafetyLimiter = (
	ctx: AudioContext,
	destination: AudioNode,
): DynamicsCompressorNode => {
	const limiter = ctx.createDynamicsCompressor();
	limiter.threshold.value = THRESHOLD_DB;
	limiter.knee.value = KNEE_DB;
	limiter.ratio.value = RATIO;
	limiter.attack.value = ATTACK_SEC;
	limiter.release.value = RELEASE_SEC;

	// カーブは ±1 の入力にしか対応しないので、±SHAPER_RANGE を ±1 へ畳んでから通す。
	// カーブの値は最終的な出力そのものなので、後段でゲインを戻してはいけない。
	const preScale = ctx.createGain();
	preScale.gain.value = 1 / SHAPER_RANGE;
	const softClip = ctx.createWaveShaper();
	softClip.curve = createSoftClipCurve();
	softClip.oversample = OVERSAMPLE;

	limiter.connect(preScale);
	preScale.connect(softClip);
	softClip.connect(destination);
	return limiter;
};
