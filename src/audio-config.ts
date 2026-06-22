/**
 * オーディオ設定とSoundFont管理
 * Audio Context初期化、SoundFont読み込み、ノート再生等
 */

/**
 * Audio Context初期化
 * DOMに依存しない純粋な音声設定
 */
export function createAudioContext() {
	const audioCtx = new AudioContext();
	const gainNode = audioCtx.createGain();
	gainNode.connect(audioCtx.destination);

	// ドラム用の独立したGainNode
	const drumGainNode = audioCtx.createGain();
	drumGainNode.connect(audioCtx.destination);

	return { audioCtx, gainNode, drumGainNode };
}

/**
 * SoundFontリストの取得
 */
export async function fetchSoundFontList(ttl: string): Promise<string[]> {
	const res = await fetch(`https://rpgen3.github.io/soundfont/list/${ttl}.txt`);
	const str = await res.text();
	return str.trim().split("\n");
}

/**
 * 楽器名からキーへのマッピングを構築
 */
export async function buildNameToKeyMapping(): Promise<Record<string, string>> {
	const nameToKey: Record<string, string> = {};
	try {
		const fontNames = await fetchSoundFontList("fontName_surikov");
		fontNames.forEach((line) => {
			const [key, ...nameParts] = line.split(" ");
			const name = nameParts.join(" ");
			nameToKey[name] = key;
		});
	} catch (e) {
		console.error("Failed to build name-to-key mapping:", e);
	}
	return nameToKey;
}
