/**
 * 外部の歌声エンジン（VOICEVOX・NEUTRINO・OpenUtau・Sinsy）が返す歌声の大きさをそろえる。
 *
 * エンジンや歌い手ごとに、返ってくる歌声の大きさが 10 dB 近く違う（2026-11-01 の実測で、
 * 声の出ている所の RMS が NEUTRINO めろう -19 dBFS 〜 DiffSinger・ENUNU 波音リツ -29 dBFS）。
 * そのまま鳴らすと、koe（UTAU 音源）の声や伴奏に対して小さく聞こえる。そこで、声の出ている
 * 所の RMS の中央値を {@link EXTERNAL_VOICE_TARGET_DB} にそろえる。ピークは
 * {@link EXTERNAL_VOICE_PEAK_DB} を超えないところで止める（割れないように）。
 *
 * トラックの音量（`v`）やミックスはこのあとに掛かるので、ここでは「素の声の大きさ」だけを
 * エンジン間でそろえる。
 */

/**
 * 声の出ている所の RMS（中央値）の目標（dBFS）。2026-11-01 に海鬼月の歌のトラックだけを
 * 鳴らして測り、koe（UTAU 音源）の声と dtm の中で同じくらいの大きさになる値にした
 * （そろえる前は、koe に対して NEUTRINO -4 dB・VOICEVOX -7 dB・DiffSinger -10 dB・Sinsy -15 dB）。
 */
export const EXTERNAL_VOICE_TARGET_DB = -16;
/** ピークの上限（dBFS）。 */
export const EXTERNAL_VOICE_PEAK_DB = -1;
/** 声が出ているとみなす窓の RMS の下限（dBFS）。無音・息の端を中央値から外す。 */
const GATE_DB = -45;
/** 上げすぎない上限（倍）。ほぼ無音の音声を雑音まで持ち上げないように。 */
const MAX_GAIN = 16;

const db = (x: number): number => 10 ** (x / 20);

/** チャンネルを混ぜた振幅で、窓ごとの RMS とピークを測る。 */
const measure = (
	channels: Float32Array[],
	win = 2048,
): { voicedRms: number; peak: number } => {
	const n = channels[0]?.length ?? 0;
	const rms: number[] = [];
	let peak = 0;
	for (let i = 0; i < n; i += win) {
		let ss = 0;
		const end = Math.min(n, i + win);
		for (let j = i; j < end; j++) {
			let v = 0;
			for (const c of channels) v += c[j];
			v /= channels.length;
			ss += v * v;
			const a = Math.abs(v);
			if (a > peak) peak = a;
		}
		const r = Math.sqrt(ss / Math.max(1, end - i));
		if (r > db(GATE_DB)) rms.push(r);
	}
	rms.sort((a, b) => a - b);
	return { voicedRms: rms[Math.floor(rms.length / 2)] ?? 0, peak };
};

/**
 * 掛ける倍率（声が無ければ 1）。ピークでは止めない——トラック全体を1回で合成するエンジン
 * （NEUTRINO など）は、どこか一瞬の大きな音でピークの上限に当たり、それで持ち上げが
 * 止まって声が小さいままになっていた（2026-11-01 の実測で koe より 3〜7 dB 小さかった）。
 * はみ出す分は {@link softLimit} が柔らかく抑える。
 */
export const externalVoiceGain = (channels: Float32Array[]): number => {
	const { voicedRms } = measure(channels);
	if (!(voicedRms > 0)) return 1;
	const g = Math.min(db(EXTERNAL_VOICE_TARGET_DB) / voicedRms, MAX_GAIN);
	return Number.isFinite(g) && g > 0 ? g : 1;
};

/** ソフトリミッターが効き始める大きさ（dBFS）。これより小さい所は変えない。 */
const KNEE_DB = -6;

/**
 * {@link KNEE_DB} を超える所だけを、{@link EXTERNAL_VOICE_PEAK_DB} に向かって tanh で
 * なめらかに抑える（割れ・段差を出さない）。
 */
export const softLimit = (v: number): number => {
	const knee = db(KNEE_DB);
	const ceil = db(EXTERNAL_VOICE_PEAK_DB);
	const a = Math.abs(v);
	if (a <= knee) return v;
	const room = ceil - knee;
	return Math.sign(v) * (knee + room * Math.tanh((a - knee) / room));
};

/** AudioBuffer の大きさをその場でそろえる（同じバッファを返す）。 */
export const normalizeExternalVoice = (buffer: AudioBuffer): AudioBuffer => {
	const channels: Float32Array[] = [];
	for (let c = 0; c < buffer.numberOfChannels; c++)
		channels.push(buffer.getChannelData(c));
	const g = externalVoiceGain(channels);
	if (g !== 1)
		for (const ch of channels)
			for (let i = 0; i < ch.length; i++) ch[i] = softLimit(ch[i] * g);
	return buffer;
};
