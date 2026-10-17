/**
 * SoundFont のサンプルの大きさを測る純関数。ブラウザ（`SoundFont.ts`）と
 * Node の検算（`scripts/test/check-sf-level.ts`）で同じ計算を使うために分けてある。
 *
 * 大きさは **K 特性（ITU-R BS.1770）で重み付けした RMS** で測る。素の RMS で揃えても
 * 聴こえる大きさは揃わない（2026-10-17 実測: 矩形波リードを −10 dB RMS に揃えても
 * ベース・伴奏より 1〜2 dB 大きく、K 特性ではさらに 1 dB 上）。倍音が 1.5 kHz より上に
 * 集まる音色ほど重く数えるので、高い音域のゾーンほど下がる。
 */

/**
 * 短いループを引き伸ばすときにループ部へ掛ける倍率。ループ点がたまたま静かな所を
 * 掴んだサンプルの音量落ちを補う。減衰系（ピアノ・ギター・ベース等）はループ部が
 * 静かなのが自然なことも多いので、目標を控えめにする。
 */
export const loopGainMultiplier = (
	channels: Float32Array[],
	loopStartFrame: number,
	loopEndFrame: number,
	decay: boolean,
): number => {
	let totalPeak = 0;
	let loopPeak = 0;
	// 全チャンネルを見る（ch0だけだとステレオで右chに寄ったサンプルの判定がずれる）
	for (const data of channels) {
		for (let i = 0; i < data.length; i++) {
			const abs = Math.abs(data[i]);
			if (abs > totalPeak) totalPeak = abs;
			if (i >= loopStartFrame && i < loopEndFrame && abs > loopPeak)
				loopPeak = abs;
		}
	}
	const targetRatio = decay ? 0.4 : 0.75;
	const maxMultiplier = decay ? 6.0 : 20.0; // 過剰増幅によるクリップ防止
	if (loopPeak > 0 && totalPeak > 0 && loopPeak < totalPeak * 0.8)
		return Math.min((totalPeak * targetRatio) / loopPeak, maxMultiplier);
	return 1.0;
};

/** 2次 IIR（Direct Form I）を1チャンネルへ掛ける。 */
const biquad = (
	data: Float32Array,
	c: { b0: number; b1: number; b2: number; a1: number; a2: number },
): Float32Array => {
	const out = new Float32Array(data.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < data.length; i++) {
		const x0 = data[i];
		const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
		out[i] = y0;
	}
	return out;
};

/**
 * K 特性の前段（高域棚 +4 dB、1681 Hz）と後段（38 Hz のハイパス）。係数は BS.1770 の
 * 48 kHz 用の値を、任意のサンプルレートへパラメータから引き直す（Audio EQ Cookbook）。
 */
export const kWeight = (
	data: Float32Array,
	sampleRate: number,
): Float32Array => {
	const shelf = (() => {
		const f0 = 1681.974450955533;
		const gainDb = 3.999843853973347;
		const q = 0.7071752369554196;
		const A = 10 ** (gainDb / 40);
		const w = (2 * Math.PI * f0) / sampleRate;
		const cosw = Math.cos(w);
		const alpha = Math.sin(w) / (2 * q);
		const sa = 2 * Math.sqrt(A) * alpha;
		const a0 = A + 1 - (A - 1) * cosw + sa;
		return {
			b0: (A * (A + 1 + (A - 1) * cosw + sa)) / a0,
			b1: (-2 * A * (A - 1 + (A + 1) * cosw)) / a0,
			b2: (A * (A + 1 + (A - 1) * cosw - sa)) / a0,
			a1: (2 * (A - 1 - (A + 1) * cosw)) / a0,
			a2: (A + 1 - (A - 1) * cosw - sa) / a0,
		};
	})();
	const highpass = (() => {
		const f0 = 38.13547087602444;
		const q = 0.5003270373238773;
		const w = (2 * Math.PI * f0) / sampleRate;
		const cosw = Math.cos(w);
		const alpha = Math.sin(w) / (2 * q);
		const a0 = 1 + alpha;
		return {
			b0: (1 + cosw) / 2 / a0,
			b1: -(1 + cosw) / a0,
			b2: (1 + cosw) / 2 / a0,
			a1: (-2 * cosw) / a0,
			a2: (1 - alpha) / a0,
		};
	})();
	return biquad(biquad(data, shelf), highpass);
};

/** 先頭から測る区間（秒）。減衰音の尾の無音で薄まらないようにする。 */
export const NON_LOOP_WINDOW_SEC = 0.5;

/**
 * 1ゾーンの代表の大きさ。持続音でループがあれば鳴り続ける部分＝ループ区間、
 * 減衰音（ループは減衰し切った尾で、聞こえる大きさは頭が決める）とループの無いものは
 * 先頭 {@link NON_LOOP_WINDOW_SEC} 秒。RMS は K 特性を掛けてから、ピークは素の波形から取る。
 */
export const zoneLevel = (
	channels: Float32Array[],
	sampleRate: number,
	loopStartFrame: number,
	loopEndFrame: number,
	decay: boolean,
): { rms: number; peak: number } => {
	const length = channels[0]?.length ?? 0;
	const looped = !decay && loopStartFrame >= 1 && loopStartFrame < loopEndFrame;
	const from = looped ? loopStartFrame : 0;
	const to = Math.min(
		length,
		looped ? loopEndFrame : Math.round(NON_LOOP_WINDOW_SEC * sampleRate),
	);
	let sum = 0;
	let n = 0;
	let peak = 0;
	for (const data of channels) {
		for (let i = 0; i < data.length; i++) {
			const abs = Math.abs(data[i]);
			if (abs > peak) peak = abs;
		}
		// フィルタの立ち上がりが測る区間に掛からないよう、区間の少し手前から通す。
		const lead = Math.min(from, Math.round(sampleRate * 0.05));
		const weighted = kWeight(data.subarray(from - lead, to), sampleRate);
		for (let i = lead; i < weighted.length; i++) {
			sum += weighted[i] * weighted[i];
			n++;
		}
	}
	return { rms: n > 0 ? Math.sqrt(sum / n) : 0, peak };
};

export const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const toDb = (x: number): number => 20 * Math.log10(x);

/**
 * 楽器1つ分のゾーンの大きさから、再生時の音量へ掛ける倍率を求める。
 * ゾーンの K 特性 RMS の中央値を `targetDb` へ寄せ、上げ下げとも上限で止める。
 * 上げる側はさらに、ピークの中央値が `peakCeiling` を越えない所で止める
 * （ループが静かで頭が大きい撥弦を持ち上げて割らないため）。
 */
export const levelGain = (
	levels: { rms: number; peak: number }[],
	opts: {
		targetDb: number;
		maxBoostDb: number;
		maxCutDb: number;
		peakCeiling: number;
	},
): number => {
	const live = levels.filter((l) => l.rms > 0);
	if (!live.length) return 1;
	const rmsDb = toDb(median(live.map((l) => l.rms)));
	let db = Math.max(
		-opts.maxCutDb,
		Math.min(opts.maxBoostDb, opts.targetDb - rmsDb),
	);
	if (db > 0) {
		const headroomDb = toDb(opts.peakCeiling / median(live.map((l) => l.peak)));
		db = Math.max(0, Math.min(db, headroomDb));
	}
	return 10 ** (db / 20);
};

/**
 * ゾーンごとの残りの補正倍率。楽器の倍率（{@link levelGain}）を掛けた後にまだ目標から
 * 外れている分を、ゾーンごとに `spreadDb` の範囲で寄せる。高い音域のサンプルは K 特性で
 * 重く数えられるので、ここで下がる（鍵盤の上で聴こえる大きさが揃う）。上げる側は
 * そのゾーンのピークが `peakCeiling` を越えない所で止める。無音のゾーンは 1。
 */
export const zoneGains = (
	levels: { rms: number; peak: number }[],
	instrumentGain: number,
	opts: { targetDb: number; spreadDb: number; peakCeiling: number },
): number[] => {
	const instDb = toDb(instrumentGain);
	return levels.map((l) => {
		if (!(l.rms > 0)) return 1;
		let db = Math.max(
			-opts.spreadDb,
			Math.min(opts.spreadDb, opts.targetDb - toDb(l.rms) - instDb),
		);
		if (db > 0 && l.peak > 0) {
			const headroomDb = toDb(opts.peakCeiling / (l.peak * instrumentGain));
			db = Math.max(0, Math.min(db, headroomDb));
		}
		return 10 ** (db / 20);
	});
};
