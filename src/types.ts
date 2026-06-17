// ノートデータ構造
export type Note = {
	id: number;
	startStep: number;
	durationSteps: number;
	pitch: number;
	velocity?: number; // 0-127, 未設定の場合は100
};

// ピアノロールの描画とステップ計算に必要な設定
export type RenderConfig = {
	stepsPerBar: number;
	keyCount: number;
	pitchRangeStart: number;
	keyHeight: number;
	stepWidth: number;
};

// 外部イベント
export type CoreEventHandlers = {
	onMMLGenerated: (mml: string) => void;
	onNotesChanged: (notes: Note[]) => void;
	onNoteClick?: (step: number, pitch: number, isErasing: boolean) => void;
};

// 試聴音再生コールバック
export type PreviewSoundCallback = (pitch: number, position: number) => void;

// ノート追加時のオプション
export type AddNoteOptions = {
	noteLengthSteps: number;
	velocity?: number;
};

// ピアノロール作成時のオプション
export type PianoRollOptions = {
	mountTarget: HTMLElement;
	width?: number;
	height?: number;
	config: RenderConfig;
	noteLengthSteps?: number;
	onPreviewSound?: PreviewSoundCallback;
};

// 編集ツールモード
export type ToolMode = "pen" | "select" | "eraser";

// ============================================================
// DAW (Layer 2) 関連の型
// ============================================================

// トラックの初期設定
export type TrackConfig = {
	id: string;
	name: string;
	/** ノート描画色 [r, g, b] */
	color: [number, number, number];
	/** MMLチャンネル番号 (@n)。再生時のトラック識別にも使う */
	instrument: number;
	/** 0-127。velocity兼ボリューム（既存挙動を踏襲） */
	volume: number;
};

// 発音フックに渡すメロディックノートの情報
export type PlayNoteEvent = {
	trackId: string;
	pitch: number;
	/** 元ノートのvelocity (0-127) */
	velocity: number;
	/** トラックvolume×velocityを反映した 0-1 程度の音量係数 */
	volume: number;
	/** 「今」からの相対秒。利用側は audioCtx.currentTime + when で発音する */
	when: number;
	/** 秒 */
	duration: number;
	/**
	 * 歌詞同期で消費された音節（@@n 歌詞トラックがあるときのみ）。
	 * 利用側は voiceModel に応じて歌唱合成へ回す。未指定なら楽器音として鳴らす。
	 *
	 * この音節が載っているとき、volume はノートのvelocityではなく
	 * 歌詞トラック独自の「声量」(model:vol) ×マスタ音量を反映する。
	 * 合成音声は velocity を参照せず volume をそのまま音量係数として使えばよい。
	 */
	syllable?: LyricSyllable;
	/** syllable を歌う合成モデル名（"klatt" 等）。syllable とセットで届く */
	voiceModel?: string;
};

// ============================================================
// 歌詞拡張（MML歌詞拡張仕様）関連の型
// ============================================================

// 解析済みの1音節。子音・母音はフォルマント合成のパラメータ選択に使う
export type LyricSyllable = {
	/** 表示用かな（"きょ" 等。長音は置換後の母音かな） */
	kana: string;
	/** ローマ字子音（"k" "sh" 等。母音始まり・撥音は ""／"N"、促音は "Q"） */
	consonant: string;
	/** 母音 "a"|"i"|"u"|"e"|"o"、撥音 "N"、促音 "" */
	vowel: string;
};

// 1本の歌詞トラック（@@n model[:volume] lyrics）
export type LyricTrack = {
	/** 対応する演奏トラックID（@n の n） */
	trackId: number;
	/** 合成モデル名（"klatt" 等。小文字化済み） */
	model: string;
	/**
	 * 歌唱の声量 0-100。ノートのvelocity（楽器の強弱）とは独立した合成音声専用パラメータ。
	 * MMLでは `@@n model:80 …` のように model にコロン区切りで付与する。既定100。
	 */
	volume: number;
	/** 正規化済み音節列 */
	syllables: LyricSyllable[];
};

// 発音フックに渡すドラムノートの情報
export type PlayDrumEvent = {
	pitch: number;
	/** 0-1 */
	velocity: number;
	/** 「今」からの相対秒 */
	when: number;
	/** 秒 */
	duration: number;
};

// 注入されるコード解析関数（rpgen3 parseChord 互換）
export type ParseChordFn = (str: string) => { value: Iterable<number> };

// 注入されるコード進行解析関数（rpgen3 parseChords 互換）
export type ParseChordsFn = (
	str: string,
	bpm: number,
) => Array<{ key: string; chord: string; when: number; duration: number }>;

// 注入されるMIDIバイナリ解析関数（midi-parser-js 互換）
export type ParseMidiFn = (bytes: Uint8Array) => unknown;

// mountDAW のオプション
export type DawOptions = {
	// --- 発音フック（ライブラリは音を出さない） ---
	/** メロディックトラックのノート発音要求 */
	onPlayNote?: (e: PlayNoteEvent) => void;
	/** ドラムノート発音要求 */
	onPlayDrum?: (e: PlayDrumEvent) => void;
	/** 初回ユーザー操作時に呼ばれる（AudioContextのresume等に使う） */
	onResumeAudio?: () => void | Promise<void>;
	/** 再生の基準クロック秒。既定 performance.now()/1000。利用側は audioCtx.currentTime を返す */
	getAudioTime?: () => number;
	/** 録音ボタン押下（利用側のオーディオグラフに依存するため任意） */
	onToggleRecord?: () => void;

	// --- 注入される外部パーサ（任意） ---
	parseChord?: ParseChordFn;
	parseChords?: ParseChordsFn;
	parseMidi?: ParseMidiFn;

	// --- 設定 ---
	/** トラック構成。既定は melody/submelody/bass/chord の4本 */
	tracks?: TrackConfig[];
	/** ドラムパターン辞書。既定は DRUM_PATTERNS */
	drumPatterns?: Record<string, import("./drum-config").DrumPattern>;
	defaultBpm?: number;
	initialMML?: string;
};

// 再生状態
export type PlaybackState = "stopped" | "playing" | "paused";

// mountDAW の戻り値
export type DawInstance = {
	play: () => void;
	pause: () => void;
	stop: () => void;
	getMML: () => { full: string; minified: string };
	loadMML: (mml: string) => void;
	loadMIDI: (bytes: Uint8Array) => void;
	exportMIDI: () => Blob;
	setBpm: (bpm: number) => void;
	getPlaybackState: () => PlaybackState;
	destroy: () => void;
};
