/**
 * クリップ検知メーター — 編集中に音割れ（0dBFS到達）が起きていないかを監視する。
 *
 * `AnalyserNode` でピーク振幅を毎フレーム覗き見し、閾値を超えたら一定時間クリップ表示を
 * 保持する（一瞬のピークでも見逃さないように）。マスタの安全リミッター（常時ON、
 * {@link file://./studio.ts} 参照）の**手前**を監視する想定 — リミッター通過後だと
 * ほとんど光らなくなり「素材が実は限界まで来ている」という警告の意味が薄れるため。
 */

export type ClipMeterOptions = {
	/** サンプルの絶対値振幅がこの値以上ならクリップとみなす。既定0.98（若干の余裕）。 */
	threshold?: number;
	/** クリップ表示を保持する時間(ms)。一瞬のピークでも視認できるよう既定800ms。 */
	holdMs?: number;
};

export type ClipMeter = {
	/** クリップ状態（ON/OFF）が変化するたびに呼ばれる。戻り値は購読解除関数。 */
	onClipChange: (cb: (clipping: boolean) => void) => () => void;
	/** 直近フレームのピークレベル（0付近〜1超。1.0が0dBFS）。簡易メーター表示用。 */
	getPeakLevel: () => number;
	/** クリップ表示を手動でリセットする（ユーザーが警告バッジを消す操作向け）。 */
	reset: () => void;
	/** 監視を止めてノードを解放する。 */
	dispose: () => void;
};

export const createClipMeter = (
	ctx: AudioContext,
	source: AudioNode,
	options: ClipMeterOptions = {},
): ClipMeter => {
	const threshold = options.threshold ?? 0.98;
	const holdMs = options.holdMs ?? 800;

	const analyser = ctx.createAnalyser();
	analyser.fftSize = 512;
	source.connect(analyser);
	const buf = new Float32Array(analyser.fftSize);

	let clipping = false;
	let clipUntil = 0;
	let peakLevel = 0;
	const listeners = new Set<(clipping: boolean) => void>();
	let rafId: number | null = null;

	const tick = (): void => {
		analyser.getFloatTimeDomainData(buf);
		let peak = 0;
		let clipped = false;
		for (let i = 0; i < buf.length; i++) {
			const v = Math.abs(buf[i]);
			if (v > peak) peak = v;
			if (v >= threshold) clipped = true;
		}
		peakLevel = peak;
		const now = performance.now();
		if (clipped) clipUntil = now + holdMs;
		const nextClipping = now < clipUntil;
		if (nextClipping !== clipping) {
			clipping = nextClipping;
			for (const cb of listeners) cb(clipping);
		}
		rafId = requestAnimationFrame(tick);
	};
	rafId = requestAnimationFrame(tick);

	return {
		onClipChange: (cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		getPeakLevel: () => peakLevel,
		reset: () => {
			clipUntil = 0;
			if (clipping) {
				clipping = false;
				for (const cb of listeners) cb(false);
			}
		},
		dispose: () => {
			if (rafId !== null) cancelAnimationFrame(rafId);
			rafId = null;
			analyser.disconnect();
			listeners.clear();
		},
	};
};
