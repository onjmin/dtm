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
	 * ステレオ定位 -1(完全左)〜+1(完全右)、0が中央。未指定は中央扱い。
	 * 歌詞トラックに p<n>(0-127, 既定64=中央) があれば正規化した値が載る。
	 * 合成側は StereoPannerNode.pan などにそのまま渡せばよい。
	 */
	pan?: number;
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
	 * 歌唱の声量 0-400。ノートのvelocity（楽器の強弱）とは独立した合成音声専用パラメータ。
	 * MMLでは `@@n klatt v80 …` のように v トークンで付与する（`model:80` も後方互換で可）。既定100。
	 * 0 で無音、100 で等倍、100超は増幅（ブースト）。実ゲインは vocalVolumeToGain により
	 * 0-100は線形・100超はdB線形（対数）で換算され、v=400 で約 +24dB（≒15.8倍）になる。
	 */
	volume: number;
	/**
	 * 歌唱のゲートタイム 0-100（音価に対する発音長の割合）。既定100（レガート）。
	 * MMLでは `@@n klatt q80 …` のように q トークンで付与する。
	 * 小さいほど短く切れた発音（ハイライトも早く消える）、100 で次の音節直前まで持続。
	 */
	gate: number;
	/**
	 * ステレオ定位 0-127（0=完全左, 64=中央, 127=完全右）。既定64。
	 * MMLでは `@@n klatt p0 …` のように p トークンで付与する。
	 */
	pan: number;
	/** 正規化済み音節列 */
	syllables: LyricSyllable[];
	/**
	 * 歌詞が複数行（改行）で書かれていたときの改行位置。
	 * 値は「この音節インデックスの直前に改行があった」を表す syllables のインデックス列。
	 * 表示UIが改行を `\n` として見せるために使う（発音・同期には一切影響しない）。
	 */
	lineBreaks?: number[];
	/**
	 * 歌詞行のメタ部分（モデル名＋ v/q/p 等のオプション）の原文。
	 * 例: `@@3 teto v200 …` なら "teto v200"。
	 * 再生専用UIがメタ部分をグレーアウト表示するために使う（発音・同期には影響しない）。
	 */
	metaText?: string;
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
	/**
	 * MML出力の先頭に埋め込む楽器プリセット名を設定する（トラックとは1対1でないトップレベル宣言）。
	 * 空文字で宣言なし。ライブラリ自体は音源を持たないため、名前を運ぶだけ（再生側が解決する）。
	 */
	setInstrument: (name: string) => void;
	loadMML: (mml: string) => void;
	loadMIDI: (bytes: Uint8Array) => void;
	exportMIDI: () => Blob;
	setBpm: (bpm: number) => void;
	getPlaybackState: () => PlaybackState;
	destroy: () => void;
};
