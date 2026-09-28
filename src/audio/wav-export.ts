/**
 * PCM（Float32、チャンネル別）から 16bit PCM WAV の Blob を作る、依存なしの小さなエンコーダ。
 * 追加ライブラリなしで完結させたいので RIFF/WAVE ヘッダを手書きしている。
 */

/** [-1, 1] の Float32 を 16bit 符号あり整数へクランプ変換する。 */
const floatTo16BitPCM = (
	view: DataView,
	offset: number,
	input: Float32Array,
): void => {
	for (let i = 0; i < input.length; i++, offset += 2) {
		const s = Math.max(-1, Math.min(1, input[i]));
		view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
};

const writeString = (view: DataView, offset: number, str: string): void => {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
};

/**
 * チャンネルごとの Float32Array（同じ長さ）から 16bit PCM WAV の Blob を生成する。
 * @param channels 各チャンネルのサンプル列（例: [left, right]）
 * @param sampleRate サンプリングレート（Hz）
 */
export const encodeWavPCM16 = (
	channels: Float32Array[],
	sampleRate: number,
): Blob => {
	const numChannels = channels.length;
	const numFrames = channels[0]?.length ?? 0;
	const bytesPerSample = 2;
	const blockAlign = numChannels * bytesPerSample;
	const dataSize = numFrames * blockAlign;

	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	writeString(view, 0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, "WAVE");
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true); // fmtチャンクサイズ
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true); // バイトレート
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bytesPerSample * 8, true); // bit深度
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	// インターリーブしつつ16bit化して書き込む
	if (numChannels === 1) {
		floatTo16BitPCM(view, 44, channels[0]);
	} else {
		let offset = 44;
		for (let i = 0; i < numFrames; i++) {
			for (let c = 0; c < numChannels; c++) {
				const s = Math.max(-1, Math.min(1, channels[c][i]));
				view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
				offset += 2;
			}
		}
	}

	return new Blob([buffer], { type: "audio/wav" });
};

/** Float32Array のチャンクを1本へ連結する。 */
export const concatFloat32 = (chunks: Float32Array[]): Float32Array => {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
};
