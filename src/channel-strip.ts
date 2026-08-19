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
};

export type ChannelStrip = {
	/** このトラックの発音はここへ接続する。 */
	input: AudioNode;
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

export const createChannelStrip = (
	ctx: AudioContext,
	destination: AudioNode,
	options: ChannelStripOptions = {},
): ChannelStrip => {
	const input = ctx.createGain(); // 発音の合流点（複数ソースの接続を受け付ける）

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

	// input → compressor → M/Sワイド → destination
	input.connect(compressor);
	compressor.connect(splitter);
	merger.connect(destination);

	return {
		input,
		setCompression: applyCompression,
		setWidth,
		dispose: () => {
			input.disconnect();
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
