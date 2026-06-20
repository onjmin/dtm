/**
 * 歌声合成Worker（{@link file://./voice-worker.ts}）とメインスレッドの間でやり取りする
 * メッセージ型。型のみのモジュールなので双方の別バンドルから安全に import できる。
 *
 * 役割分担:
 *  - Worker: VoiceBank（音素PCM）＋ Worldline（WASM）を保持し、エイリアス指定の重い再合成を行う。
 *  - メイン: エイリアス解決とキャッシュ（AudioBuffer）・Web Audio スケジュールを行う。
 */

/** init: 音源（.koe）とworldline.jsのURLを渡してWorkerを初期化する。 */
export type VoiceWorkerInit = {
	type: "init";
	/** .koe アーカイブのURL、または Blob/File。 */
	koe: string | Blob;
	/** worldline.js のURL（Worker内 importScripts で読む）。 */
	worldlineScriptUrl: string;
	/** Worldlineを使わず素片ピッチシフトのみで鳴らす軽量モード。 */
	lightweight: boolean;
};

/** render: 解決済みエイリアスを目標ピッチ・音価で合成依頼する。 */
export type VoiceWorkerRenderReq = {
	type: "render";
	/** リクエスト識別子（応答の突き合わせ用）。 */
	id: number;
	/** 音源マニフェストに実在する音素エイリアス。 */
	alias: string;
	/** MIDIノート番号。 */
	pitch: number;
	/** 発音長（ms, 60未満は呼び出し側で丸め済み想定）。 */
	durationMs: number;
};

export type VoiceWorkerInbound = VoiceWorkerInit | VoiceWorkerRenderReq;

/** ready: 初期化完了。aliases はマニフェストの全音素キー（メインのエイリアス解決に使う）。 */
export type VoiceWorkerReady = { type: "ready"; aliases: string[] };

/** error: 初期化失敗（音源/WASMロード不可など）。 */
export type VoiceWorkerError = { type: "error"; message: string };

/**
 * rendered: 合成結果。pcm は Float32 @48kHz（transferで返す）。
 * 該当音素なし・無声・短すぎ等で合成できなければ pcm=null。
 */
export type VoiceWorkerRendered = {
	type: "rendered";
	id: number;
	pcm: Float32Array | null;
	/** 母音オンセットまでの先行秒（バッファ先頭からのオフセット）。 */
	preSec?: number;
	/** 再生レート（Worldline使用時は1、素片フォールバック時はピッチ比）。 */
	rate?: number;
};

export type VoiceWorkerOutbound =
	| VoiceWorkerReady
	| VoiceWorkerError
	| VoiceWorkerRendered;
