/**
 * トラック単位の「チャンネルストリップ」— コンプレッサー（音圧強化）とステレオワイド。
 *
 * ボーカル・楽器を問わず、各トラックの発音はこのストリップの `input` へ接続してから
 * 共通のマスタへ送る想定（`input → compressor → M/Sワイド → destination`）。
 * どちらも生のパラメータ（threshold/ratio/M-S係数）をUIに出さず、0-100の単一の
 * 「量」つまみへ丸めて提供する（DTMエディタ側の思想: 難しいパラメータは単純化する）。
 */

export type ChannelStripOptions = {
	/** コンプレッサーの掛かり具合 0-100。既定0（実質バイパス＝無圧縮）。 */
	compression?: number;
	/** ステレオ幅 0-200。既定100（原音のまま）。0で完全モノラル、200で誇張したワイド。 */
	width?: number;
	/** 低域（シェルフ, ~200Hz）のゲイン -12〜+12dB。既定0（無変化）。 */
	eqLow?: number;
	/** 中域（ピーキング, ~1000Hz）のゲイン -12〜+12dB。既定0（無変化）。 */
	eqMid?: number;
	/** 高域（シェルフ, ~5000Hz）のゲイン -12〜+12dB。既定0（無変化）。 */
	eqHigh?: number;
};

export type ChannelStrip = {
	/** このトラックの発音はここへ接続する。 */
	input: AudioNode;
	/** 低域シェルフのゲインを -12〜+12dB でリアルタイムに変更する。 */
	setEqLow: (db: number) => void;
	/** 中域ピーキングのゲインを -12〜+12dB でリアルタイムに変更する。 */
	setEqMid: (db: number) => void;
	/** 高域シェルフのゲインを -12〜+12dB でリアルタイムに変更する。 */
	setEqHigh: (db: number) => void;
	/** コンプレッサーの掛かり具合を 0-100 でリアルタイムに変更する。 */
	setCompression: (amount: number) => void;
	/** ステレオ幅を 0-200 でリアルタイムに変更する。 */
	setWidth: (width: number) => void;
	/** ノードを切断して破棄する。 */
	dispose: () => void;
};

const clamp = (v: number, lo: number, hi: number): number =>
	Math.max(lo, Math.min(hi, v));

/**
 * amount(0-100) → DynamicsCompressorNode のパラメータ。
 * 0 でほぼバイパス（threshold=0dB, ratio=1:1）、100 でマスタリング的な強圧縮
 * （threshold=-24dB, ratio=12:1）まで線形補間する。
 */
const compressionParams = (
	amount: number,
): {
	threshold: number;
	ratio: number;
	knee: number;
	attack: number;
	release: number;
} => {
	const t = clamp(amount, 0, 100) / 100;
	return {
		threshold: 0 + (-24 - 0) * t,
		ratio: 1 + (12 - 1) * t,
		knee: 0 + (6 - 0) * t,
		attack: 0.02 + (0.003 - 0.02) * t,
		release: 0.25 + (0.15 - 0.25) * t,
	};
};

/** EQの各帯域の中心/カットオフ周波数（Hz）。固定 — 一般用途で無難な値。 */
const EQ_LOW_FREQ = 200;
const EQ_MID_FREQ = 1000;
const EQ_HIGH_FREQ = 5000;
/** 中域ピーキングのQ（帯域幅）。固定。 */
const EQ_MID_Q = 1.0;
/** EQゲインの許容範囲（dB）。±12dBを超える極端な設定はミックスを破綻させやすいため制限する。 */
const EQ_MAX_DB = 12;

export const createChannelStrip = (
	ctx: AudioContext,
	destination: AudioNode,
	options: ChannelStripOptions = {},
): ChannelStrip => {
	const input = ctx.createGain(); // 発音の合流点（複数ソースの接続を受け付ける）

	// ── EQ（3バンド: 低域シェルフ・中域ピーキング・高域シェルフ）──
	// ミックスの定石通り、コンプレッサーより手前（EQ→コンプ→ステレオ幅）に置く。
	// 不要な帯域を先に削ってからコンプを掛けることで、変な帯域を含めて丸ごと
	// 潰してしまうのを防ぐ。
	const eqLow = ctx.createBiquadFilter();
	eqLow.type = "lowshelf";
	eqLow.frequency.value = EQ_LOW_FREQ;
	eqLow.gain.value = clamp(options.eqLow ?? 0, -EQ_MAX_DB, EQ_MAX_DB);
	const eqMid = ctx.createBiquadFilter();
	eqMid.type = "peaking";
	eqMid.frequency.value = EQ_MID_FREQ;
	eqMid.Q.value = EQ_MID_Q;
	eqMid.gain.value = clamp(options.eqMid ?? 0, -EQ_MAX_DB, EQ_MAX_DB);
	const eqHigh = ctx.createBiquadFilter();
	eqHigh.type = "highshelf";
	eqHigh.frequency.value = EQ_HIGH_FREQ;
	eqHigh.gain.value = clamp(options.eqHigh ?? 0, -EQ_MAX_DB, EQ_MAX_DB);
	input.connect(eqLow);
	eqLow.connect(eqMid);
	eqMid.connect(eqHigh);

	// ── コンプレッサー ──
	const compressor = ctx.createDynamicsCompressor();
	const applyCompression = (amount: number): void => {
		const p = compressionParams(amount);
		const now = ctx.currentTime;
		compressor.threshold.setValueAtTime(p.threshold, now);
		compressor.ratio.setValueAtTime(p.ratio, now);
		compressor.knee.setValueAtTime(p.knee, now);
		compressor.attack.setValueAtTime(p.attack, now);
		compressor.release.setValueAtTime(p.release, now);
	};
	applyCompression(options.compression ?? 0);

	// ── ステレオワイド（Mid-Side処理）──
	// mid = 0.5*(L+R) は単一GainNodeへL/R両方を接続するだけで実現できる
	// （Web Audioは同一ノードへの複数接続を自動的に加算合成するため）。
	// side = 0.5*(L-R) は符号違いの2本のGainNodeを同じ合流ノードへ接続して作る。
	const splitter = ctx.createChannelSplitter(2);
	const mid = ctx.createGain();
	mid.gain.value = 0.5;
	splitter.connect(mid, 0);
	splitter.connect(mid, 1);

	const sideSum = ctx.createGain();
	sideSum.gain.value = 1;
	const sideL = ctx.createGain();
	sideL.gain.value = 0.5;
	const sideR = ctx.createGain();
	sideR.gain.value = -0.5;
	splitter.connect(sideL, 0);
	splitter.connect(sideR, 1);
	sideL.connect(sideSum);
	sideR.connect(sideSum);

	// width係数（1.0=原音）を掛けたsideを、Lには+、Rには-で合成し直す。
	const widthGain = ctx.createGain();
	sideSum.connect(widthGain);
	const widthInv = ctx.createGain();
	widthInv.gain.value = -1;
	widthGain.connect(widthInv);

	const outL = ctx.createGain();
	mid.connect(outL);
	widthGain.connect(outL);
	const outR = ctx.createGain();
	mid.connect(outR);
	widthInv.connect(outR);

	const merger = ctx.createChannelMerger(2);
	outL.connect(merger, 0, 0);
	outR.connect(merger, 0, 1);

	const setWidth = (width: number): void => {
		widthGain.gain.setTargetAtTime(
			clamp(width, 0, 200) / 100,
			ctx.currentTime,
			0.02,
		);
	};
	setWidth(options.width ?? 100);

	// input → EQ(低→中→高) → compressor → M/Sワイド → destination
	eqHigh.connect(compressor);
	compressor.connect(splitter);
	merger.connect(destination);

	return {
		input,
		setEqLow: (db) => {
			eqLow.gain.setTargetAtTime(
				clamp(db, -EQ_MAX_DB, EQ_MAX_DB),
				ctx.currentTime,
				0.02,
			);
		},
		setEqMid: (db) => {
			eqMid.gain.setTargetAtTime(
				clamp(db, -EQ_MAX_DB, EQ_MAX_DB),
				ctx.currentTime,
				0.02,
			);
		},
		setEqHigh: (db) => {
			eqHigh.gain.setTargetAtTime(
				clamp(db, -EQ_MAX_DB, EQ_MAX_DB),
				ctx.currentTime,
				0.02,
			);
		},
		setCompression: applyCompression,
		setWidth,
		dispose: () => {
			input.disconnect();
			eqLow.disconnect();
			eqMid.disconnect();
			eqHigh.disconnect();
			compressor.disconnect();
			splitter.disconnect();
			mid.disconnect();
			sideSum.disconnect();
			sideL.disconnect();
			sideR.disconnect();
			widthGain.disconnect();
			widthInv.disconnect();
			outL.disconnect();
			outR.disconnect();
			merger.disconnect();
		},
	};
};
