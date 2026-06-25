import type { SingingVoices } from "./lyrics";

export const DEFAULT_VOCAL_VOLUME = 200;
export const DEFAULT_BPM = 120;
export const DEFAULT_GATE = 100;
export const DEFAULT_PAN = 64;
export const DEFAULT_VELOCITY = 100;
export const DEFAULT_PLAYBACK_VELOCITY = 127;
export const DEFAULT_STEPS_PER_BAR = 192;
export const MML_END_MARKER = "#end;";

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

/** パッチ送受信用ノートデータ（ローカルIDを持たない）。 */
export type NoteData = {
	startStep: number;
	pitch: number;
	durationSteps: number;
	velocity?: number;
};

/** パッチ削除指定（startStep + pitch で音符を特定）。 */
export type NoteRemove = {
	startStep: number;
	pitch: number;
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
	 * MMLでは `@@n klatt v80 …` のように v トークンで付与する（`model:80` も後方互換で可）。既定300。
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
	 * ステレオ定位 0-127（0=完全左, 64=中央, 127=右）。既定64。
	 * MMLでは `@@n klatt p0 …` のように p トークンで付与する。
	 */
	pan: number;
	/**
	 * オクターブシフト -2〜+2（半音換算で octave×12 だけ歌唱ピッチを上下する）。既定0。
	 * 音源ごとに得意な音域が異なるため、演奏ノート（@n）のピッチをそのまま使わず
	 * オクターブ単位でずらして歌わせるための合成専用パラメータ。
	 * MMLでは `@@n klatt o-1 …` のように o トークンで付与する。
	 */
	octave?: number;
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

// 注入されるMIDIバイナリ解析関数
export type ParseMidiFn = (bytes: Uint8Array) => unknown | Promise<unknown>;

/**
 * 永続化対象の表示・出力設定。利用側がブラウザ再訪時に復元する用途に使う。
 * （ノートやMML本体ではなく、エディタの見え方/出力の挙動の設定）
 */
export type DawViewState = {
	/** 横方向ズーム（%） */
	zoomX: number;
	/** 縦方向ズーム（%） */
	zoomY: number;
	/** 和音分解モード（getMMLで和音を単音トラックへ分解する） */
	decomposeChord: boolean;
	/** 和音分解時に和音伴奏トラックを分解対象から除外するフラグ */
	ignoreChordHeavy: boolean;
};

/**
 * DAWの動作モード。
 * - `simple`: 4トラック（メロディー/サブメロ/ベース/伴奏）。MIDIは役割別に自動分類して取り込み、
 *   id `chord` のトラックには歌詞欄の代わりに伴奏（コード進行）UIを出す。
 * - `advanced`: MIDIトラックを1:1でマッピング。全トラックが通常のノートトラックとして振る舞う。
 */
export type DawMode = "simple" | "advanced";

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
	/**
	 * ドラムパターンが変化したときに呼ばれる（ユーザー操作・MML読み込みによる自動入力の両方）。
	 * 利用側が選択状態を永続化する用途に使う。
	 */
	onDrumChange?: (name: string) => void;
	/**
	 * 楽器プリセットが変化したときに呼ばれる（ユーザー操作・MML読み込みによる自動入力の両方）。
	 * 利用側が選択状態を永続化したり、外部音源のロードを行ったりする用途に使う。
	 */
	onInstrumentChange?: (name: string) => void;
	/**
	 * 表示・出力設定（ズーム / 和音分解モード / 和音伴奏トラック無視）が変化したときに呼ばれる。
	 * 利用側が選択状態を永続化する用途に使う。
	 */
	onViewStateChange?: (state: DawViewState) => void;
	/**
	 * ユーザー操作によってノートが追加・削除されたときに呼ばれる（差分パッチ）。
	 * リアルタイム同期のための送信フックとして使う。
	 * `applyPatch` による適用時には呼ばれない（エコーループ防止）。
	 */
	onNotesPatch?: (
		trackId: string,
		added: NoteData[],
		removed: NoteRemove[],
	) => void;
	/**
	 * 編集をロックするトラックIDの配列。
	 * 指定されたトラックへのユーザー操作（音符追加・削除）は無視される。
	 * 協力DAWで他人のトラックを誤編集しないために使う。
	 */
	lockedTracks?: string[];

	// --- 注入される外部パーサ（任意） ---
	parseMidi?: ParseMidiFn;

	// --- 設定 ---
	/**
	 * 動作モード（{@link DawMode}）。
	 * 未指定のときは後方互換のため `tracks` の本数から推論する（4本以下→simple / 5本以上→advanced）。
	 * 4トラック構成でも1:1取り込みをしたい等、トラック数と意図がずれる場合は明示指定する。
	 */
	mode?: DawMode;
	/** トラック構成。既定は melody/submelody/bass/chord の4本 */
	tracks?: TrackConfig[];
	/** ドラムパターン辞書。既定は DRUM_PATTERNS */
	drumPatterns?: Record<string, import("./drum-config").DrumPattern>;
	/** 歌唱合成の先読みや制御を行うヘルパ（.koe音源の再生前プリロードに使用） */
	singingVoices?: SingingVoices;
	defaultBpm?: number;
	initialMML?: string;
	/** 利用規約への同意画面の表示をスキップするかどうか */
	skipConsent?: boolean;
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
	/** 現在のドラムパターン名を返す（永続化の保存用）。 */
	getDrum: () => string;
	/** ドラムパターンを設定する（未知のキーは無視）。選択UIにも反映する。 */
	setDrum: (name: string) => void;
	/** 現在の表示・出力設定を返す（永続化の保存用）。 */
	getViewState: () => DawViewState;
	/** 表示・出力設定を復元する（指定したキーのみ反映。UIにも反映する）。 */
	setViewState: (state: Partial<DawViewState>) => void;
	loadMML: (mml: string) => void;
	loadMIDI: (bytes: Uint8Array) => void | Promise<void>;
	exportMIDI: () => Blob;
	setBpm: (bpm: number) => void;
	getPlaybackState: () => PlaybackState;
	getCurrentPlayStep: () => number;
	forcePauseAt: (step: number) => void;
	setLoading?: (loading: boolean) => void;
	/**
	 * リモートから受信したパッチをローカルに適用する。
	 * `onNotesPatch` は発火しない（エコーループ防止）。
	 * 音符の識別は (startStep, pitch) ペアで行う（ローカルIDに依存しない）。
	 */
	applyPatch: (
		trackId: string,
		added: NoteData[],
		removed: NoteRemove[],
	) => void;
	/**
	 * 指定トラックの音符をキャンバス上で表示・非表示にする（目ミュート）。
	 * 非表示にしても内部データは保持される。
	 */
	setTrackVisible: (trackId: string, visible: boolean) => void;
	/**
	 * 指定トラックの発音を有効・無効にする（音ミュート）。
	 * false にすると onPlayNote が呼ばれなくなる。
	 */
	setTrackAudible: (trackId: string, audible: boolean) => void;
	destroy: () => void;
};

// ============================================================
// BGM ループ/キュー関連の型
// ============================================================

export type LoopPoint =
	| { bar: number }
	| { step: number }
	| { seconds: number };

export type LoopConfig = {
	start?: LoopPoint;
	end?: LoopPoint;
};

export type PlaybackCue = {
	id: string;
	time: LoopPoint;
};
