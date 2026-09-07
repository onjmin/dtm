/**
 * トラック1（先頭トラック＝メロディ/主旋律）の個別トラック設定の localStorage 永続化。
 *
 * 個別トラック設定は基本的に曲データ（MML/meta）側で保存・復元されるため、他の
 * トラックまで含めて localStorage に持たせると、曲を読み込むたびに曲データの値と
 * 競合してしまう（{@link file://./global-state.ts} と役割が異なる理由）。
 *
 * ただしトラック1に限っては、「歌入り作曲」を押し直すたびにボーカル選択（歌唱モデル・
 * オクターブ等）を含む設定が既定値へ戻ってしまい、毎回同じ声・同じ鳴りに整え直す
 * 手間が発生するUX上の課題がある。これを避けるため、トラック1だけは「最後に使った
 * 個別トラック設定」を localStorage に覚えておき、新規（曲データを読み込んでいない）
 * トラック1の初期値として復元する。曲データを読み込んだ場合はそちらの値で上書き
 * されるため、保存済み曲の再現性には影響しない。
 */

export const TRACK1_STORAGE_KEY = "dtm-track1:settings";

/** トラック1の個別トラック設定のうち、永続化対象のもの。 */
export type Track1Settings = {
	volume: number;
	trackInstrument: string;
	trackOctave: number;
	trackOctaveUnison: string;
	trackCompression: number;
	trackWidth: number;
	trackReverbSend: number;
	trackEqLow: number;
	trackEqMid: number;
	trackEqHigh: number;
	trackPan: number;
	trackDelaySend: number;
	lyricModel: string;
	vocalVolume: number;
	vocalGate: number;
	vocalPan: number;
	vocalOctave: number;
	vocalVibrato: boolean;
	vocalReverb: number;
	vocalDelay: number;
	vocalGender: number;
	vocalBreathiness: number;
	vocalTension: number;
	vocalOctaveUnison: string;
};

/**
 * トラック1の設定を localStorage から読み出す。未保存・壊れたJSON・localStorage
 * にアクセスできない環境では null を返し、呼び出し側の既定値をそのまま使わせる。
 * 型が壊れている個別フィールドは無視する（部分的な復元を許す）。
 */
export const readTrack1Settings = (): Partial<Track1Settings> | null => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return null;
		const raw = localStorage.getItem(TRACK1_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return parsed as Partial<Track1Settings>;
	} catch (_) {
		return null;
	}
};

/**
 * トラック1の設定を localStorage に保存する。localStorage にアクセスできない
 * 環境や容量制限等は無視する。
 */
export const writeTrack1Settings = (settings: Track1Settings): void => {
	try {
		if (typeof localStorage === "undefined" || !localStorage) return;
		localStorage.setItem(TRACK1_STORAGE_KEY, JSON.stringify(settings));
	} catch (_) {}
};
