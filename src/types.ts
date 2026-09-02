import type { ClipMeter } from "./clip-meter";
import type { DelayDivision } from "./delay";
import type { SingingVoices } from "./lyrics";
import type { MidiSearchConfig } from "./midi-search";

export const DEFAULT_VOCAL_VOLUME = 200;
export const DEFAULT_BPM = 120;
export const DEFAULT_GATE = 100;
export const DEFAULT_PAN = 64;
export const DEFAULT_VELOCITY = 100;
export const DEFAULT_PLAYBACK_VELOCITY = 127;
export const DEFAULT_STEPS_PER_BAR = 192;
export const MML_END_MARKER = "#end;";

/**
 * ピアノロールが扱う音域の下端・上端（両端含む）。音律に依らず固定で、MIDI 0-127 に相当する。
 * 「音律を変えても鳴らせる音の高さの範囲は変わらない」を保証するための不変条件。
 */
export const PITCH_RANGE_START = 0;
/** MIDI 127 相当。単位は 1/372オクターブ（127 × 31）。 */
export const PITCH_RANGE_END = 3937;
/**
 * 1行が受け持つピッチ幅（units）。12平均律は1半音 = 31、31平均律は1度 = 12。
 * 行数はここから導出されるので、12平均律で128行・31平均律で328行になる。
 */
export const unitsPerRow = (edo: number): number => 372 / edo;
/** その音律での行数。音域と1行あたりのピッチ幅から導出する（直接指定しないこと）。 */
export const keyCountFor = (edo: number): number =>
	Math.floor((PITCH_RANGE_END - PITCH_RANGE_START) / unitsPerRow(edo)) + 1;
/** 12平均律の行数（従来と同じ128）。 */
export const KEY_COUNT = keyCountFor(12);

// ノートデータ構造
export type Note = {
	id: number;
	startStep: number;
	durationSteps: number;
	/**
	 * ピッチ。単位は **1/372オクターブの整数**（`tuning.ts` 参照）。
	 * 12平均律の1半音 = 31、31平均律の1度 = 12。MIDIノート番号ではないので注意。
	 * dtm 1.x の `pitch`（半音）から意味が変わっている。
	 */
	pitchUnits: number;
	velocity?: number; // 0-127, 未設定の場合は100
};

// ピアノロールの描画とステップ計算に必要な設定
export type RenderConfig = {
	stepsPerBar: number;
	/**
	 * 行数。{@link KEY_COUNT} のように「音域 ÷ 1行あたりのピッチ幅」から導出した値を渡す。
	 * 音律ごとに直接指定しないこと（31平均律で音域が勝手に縮む）。
	 */
	keyCount: number;
	/** 音域の下端。単位は units（1/372オクターブ）。 */
	pitchRangeStart: number;
	/** 1行が受け持つ units。{@link unitsPerRow} から導出した値を渡す。省略時は31（12平均律）。 */
	unitsPerRow?: number;
	keyHeight: number;
	stepWidth: number;
	/**
	 * 曲全体の音律（1オクターブの分割数）。省略時は12（12平均律）。
	 *
	 * 音律はデータにも音声経路にも入らず、格子・記譜・表示だけに効く編集上の概念なので、
	 * 描画設定と同じ場所に置く。MMLCore も `getConfig()` 経由でここから音律を読み、
	 * 綴り（`#`=2度 / `+`=1度 など）を切り替える。
	 */
	edo?: number;
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

/** 歌詞・UTAU設定の同期データ。 */
export type LyricSyncData = {
	lyrics: string;
	model: string;
	vocalVolume: number;
	vocalGate: number;
	vocalPan: number;
	vocalOctave: number;
	vocalVibrato?: boolean;
	vocalReverb?: number;
	vocalDelay?: number;
	vocalGender?: number;
	vocalBreathiness?: number;
	vocalTension?: number;
	vocalOctaveUnison?: OctaveUnisonMode;
};

/** パッチ送受信用ノートデータ（ローカルIDを持たない）。 */
export type NoteData = {
	startStep: number;
	/** 1/372オクターブ単位。{@link Note.pitchUnits} と同じ。 */
	pitchUnits: number;
	durationSteps: number;
	velocity?: number;
};

/** パッチ削除指定（startStep + pitchUnits で音符を特定）。 */
export type NoteRemove = {
	startStep: number;
	/** 1/372オクターブ単位。{@link Note.pitchUnits} と同じ。 */
	pitchUnits: number;
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

/**
 * カスタムボーカル定義。
 * MML 中の `@@key icon_url koe_url` 構文で宣言するか、
 * `DawOptions.customVocals` から静的に登録できる。
 *
 * - `key`     : MML 中のモデル名（例: "testvocal"）。小文字で一意。
 * - `iconUrl` : アイコン画像の URL。読み込み失敗時は assets/404Chip.png にフォールバック。
 *              未指定・空文字・不正 URL もフォールバック扱い。
 * - `url`     : koe 音源 URL（.koe ファイル）。常識外の長さ（> 2048 文字）は無視する。
 * - `label`   : UI プルダウン表示名。省略時は key をそのまま使う。
 */
export type CustomVocalDef = {
	key: string;
	iconUrl: string;
	url: string;
	label?: string;
};

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
	/**
	 * ピッチ。単位は 1/372オクターブの整数（{@link Note.pitchUnits} と同じ）。
	 * 周波数へは `tuning.ts` の `unitsToHz`、SoundFont のような整数ゾーンの音源へは
	 * `unitsToMidiDetune` を使う。{@link PlayDrumEvent.pitch} はGM打楽器のキー番号で
	 * 音高ではないため、こちらとは別物。
	 */
	pitchUnits: number;
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
	/**
	 * マスタリバーブへのセンド量 0-1（既定0）。歌詞トラックの個別リバーブ設定を
	 * 反映する。合成側はドライ経路とは別にこの割合だけリバーブバスへ送ればよい。
	 */
	reverbSend?: number;
	/**
	 * マスタディレイへのセンド量 0-1（既定0）。歌詞トラックの個別ディレイ送り設定を反映する。
	 * リバーブと同じくドライ経路とは別にこの割合だけディレイバスへ送ればよい。
	 */
	delaySend?: number;
	/**
	 * 発音先の上書き（未指定なら合成側の既定destinationへ）。トラック単位チャンネルストリップ
	 * （コンプレッサー/ステレオワイド）の入口ノードを渡すことを想定。
	 */
	destination?: AudioNode;
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

/**
 * オクターブユニゾンの重ね方。
 * - "none": 重ねない（既定）
 * - "down": 1オクターブ下をもう1声重ねる（声に厚み・重みを足す）
 * - "up"  : 1オクターブ上をもう1声重ねる（煌びやかさ・可憐さを足す）
 * - "both": 上下両方を重ねる
 */
export type OctaveUnisonMode = "none" | "down" | "up" | "both";

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
	 * オクターブシフト -2〜+2（octave×372 units = octave オクターブぶん歌唱ピッチを上下する）。既定0。
	 * 音源ごとに得意な音域が異なるため、演奏ノート（@n）のピッチをそのまま使わず
	 * オクターブ単位でずらして歌わせるための合成専用パラメータ。
	 * MMLでは `@@n klatt o-1 …` のように o トークンで付与する。
	 */
	octave?: number;
	/**
	 * 自動ビブラート ON/OFF。既定false。
	 * ONでも全ノートに掛かるわけではなく、一定の長さ以上（ロングトーン）のノートにだけ
	 * 自動で適用される（短い音符は1周期も揺れきらず不自然になるため対象外）。
	 * MMLでは `@@n klatt b1 …` のように b トークンで付与する。
	 */
	vibrato?: boolean;
	/**
	 * このボーカルトラック個別のリバーブセンド量 0-100。既定0（マスタリバーブの影響を受けない）。
	 * マスタリバーブのつまみ（全トラック共通の残響そのもの）とは別軸で、
	 * 「このトラックをどれだけリバーブバスへ送るか」を個別に決める。
	 * MMLでは `@@n klatt r50 …` のように r トークンで付与する。
	 */
	reverb?: number;
	/**
	 * このボーカルトラック個別のディレイセンド量 0-100。既定0（マスタディレイの影響を受けない）。
	 * マスタディレイのつまみ（テンポ同期した音価・掛かり具合そのもの）とは別軸で、
	 * 「このトラックをどれだけディレイバスへ送るか」を個別に決める。
	 * MMLでは `@@n klatt e50 …` のように e トークンで付与する。
	 */
	delay?: number;
	/**
	 * フォルマント/ジェンダーファクター 0-100。既定50（無変化）。
	 * ピッチはそのままに声の太さ/細さ（年齢・性別感）だけを動かす。
	 * 50未満で低め/太め（大人びる）、50超で高め/細め（若く/明るく）に寄る。
	 * MMLでは `@@n klatt g30 …` のように g トークンで付与する。
	 */
	gender?: number;
	/**
	 * ブレシネス（息成分）0-100。既定50（無変化）。大きいほど息っぽく（ささやき寄り）、
	 * 小さいほど芯のある声になる。
	 * MMLでは `@@n klatt h70 …` のように h トークンで付与する。
	 */
	breathiness?: number;
	/**
	 * テンション（張り/力強さ）0-100。既定50（無変化）。大きいほど張った・押した声
	 * （こぶし寄り、力強く歌わせる）、小さいほど脱力・リラックス（ブレシネス寄り）になる。
	 * MMLでは `@@n klatt t70 …` のように t トークンで付与する。
	 */
	tension?: number;
	/**
	 * オクターブユニゾン。既定"none"。
	 * "down"/"up"/"both" にすると各音節をもう1オクターブ上/下/両方（控えめな音量）で
	 * 同時に重ねて発音し、声に厚み（down）や煌びやかさ（up）を足す。
	 * MMLでは `@@n klatt w1 …`（0=none,1=down,2=up,3=both）のように w トークンで付与する。
	 */
	octaveUnison?: OctaveUnisonMode;
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
 * 1回の play() 呼び出しで使うフェードのスケジュール（絶対 AudioContext 時刻、秒）。
 * いずれも未指定ならそちらのフェードは掛けない（曲頭から再生していない/フェード長0等）。
 */
export type FadeScheduleParams = {
	/** フェードイン開始時刻（通常は再生アンカー時刻と同じ）。 */
	fadeInStartAt?: number;
	/** フェードイン完了時刻（この時刻に音量1へ到達）。 */
	fadeInEndAt?: number;
	/** フェードアウト開始時刻（この時刻までは音量1を維持）。 */
	fadeOutStartAt?: number;
	/** フェードアウト完了時刻（この時刻に音量0へ到達、通常は曲の終端）。 */
	fadeOutEndAt?: number;
};

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
	/**
	 * 「MIDI / MML 出力」パネルの「WAV書き出し」ボタン押下時に呼ばれる。
	 * 未指定ならボタン自体を表示しない（ライブラリは音を出さないため、書き出し処理は
	 * AudioContextを持つ利用側 = createDtmStudio 等が担う）。
	 */
	onExportWav?: () => void | Promise<void>;
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
	 * トラックごとの個別楽器が変化したときに呼ばれる。
	 * `trackIndex` は @n の n と同じトラック番号。`instrumentName` は GM楽器名（空文字はデフォルト＝プリセット）。
	 */
	onTrackInstrumentChange?: (
		trackIndex: number,
		instrumentName: string,
	) => void;
	/**
	 * トラック単位のコンプレッサー（音圧強化）量 0-100 が変化したときに呼ばれる。
	 * `trackId` は演奏トラックのID（歌詞トラックと同じIDを共有していれば同じ処理が掛かる）。
	 * 実際の音声処理は呼び出し側（studio）が担う。
	 */
	onTrackCompressionChange?: (trackId: string, amount: number) => void;
	/** トラック単位のステレオ幅 0-200 が変化したときに呼ばれる。 */
	onTrackWidthChange?: (trackId: string, width: number) => void;
	/**
	 * トラック単位のマスタリバーブへのセンド量 0-100 が変化したときに呼ばれる。
	 * 楽器・歌詞トラックを問わず掛かる（歌詞トラック固有の `vocalReverb`/`r`トークンとは別軸で、
	 * 両方が同じマスタリバーブへ加算的に送られる）。既定0（センドしない＝リバーブが掛からない）。
	 */
	onTrackReverbSendChange?: (trackId: string, amount: number) => void;
	/**
	 * トラック単位のマスタディレイへのセンド量 0-100 が変化したときに呼ばれる。
	 * 楽器・歌詞トラックを問わず掛かる（歌詞トラック固有の `vocalDelay`/`d`トークンとは別軸で、
	 * 両方が同じマスタディレイへ加算的に送られる）。既定0（センドしない＝ディレイが掛からない）。
	 */
	onTrackDelaySendChange?: (trackId: string, amount: number) => void;
	/** トラック単位EQの低域（シェルフ）ゲイン -12〜+12dB が変化したときに呼ばれる。 */
	onTrackEqLowChange?: (trackId: string, db: number) => void;
	/** トラック単位EQの中域（ピーキング）ゲイン -12〜+12dB が変化したときに呼ばれる。 */
	onTrackEqMidChange?: (trackId: string, db: number) => void;
	/** トラック単位EQの高域（シェルフ）ゲイン -12〜+12dB が変化したときに呼ばれる。 */
	onTrackEqHighChange?: (trackId: string, db: number) => void;
	/**
	 * トラック単位のステレオ定位（パン）0-127（64=中央、0=左いっぱい、127=右いっぱい）が
	 * 変化したときに呼ばれる。歌詞トラック固有の `vocalPan`（歌唱の定位）とは別軸で、
	 * 楽器トラック自体の左右配置を決める。
	 */
	onTrackPanChange?: (trackId: string, pan: number) => void;
	/**
	 * BPMが変化したときに呼ばれる（MML読込・スライダー操作・MIDI取り込み等、経路に依らず単一の窓口）。
	 * テンポ同期エフェクト（ディレイ等）が実時間へ再計算するために使う。
	 */
	onBpmChange?: (bpm: number) => void;
	/** 曲頭のフェードイン長（秒）。既定0（フェードなし）。範囲0〜10。 */
	fadeInSec?: number;
	/** 曲尾のフェードアウト長（秒）。既定0（フェードなし）。範囲0〜10。 */
	fadeOutSec?: number;
	/**
	 * play() のたびに、今回の再生で使うフェードのスケジュール（絶対 AudioContext 時刻）を
	 * 通知する。`params` が null ならフェードを解除し音量を1へ戻す（pause/stop時）。
	 * 実際のゲイン自動化は呼び出し側（studio）が担う。
	 */
	onScheduleFade?: (params: FadeScheduleParams | null) => void;
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
	/** 歌詞・UTAUデータが変更されたときに呼ばれる（300msデバウンス済み）。 */
	onLyricsChange?: (trackId: string, data: LyricSyncData) => void;
	/**
	 * 編集をロックするトラックIDの配列。
	 * 指定されたトラックへのユーザー操作（音符追加・削除）は無視される。
	 * 協力DAWで他人のトラックを誤編集しないために使う。
	 */
	lockedTracks?: string[];
	/** 初期アクティブトラックID（未指定なら最初のトラック）。協力DAWで自分のトラックを初期選択するために使う。 */
	initialActiveTrack?: string;
	/** 初期スクロールで中央に表示するMIDIピッチ番号（0–127）。未指定なら既定位置。 */
	initialScrollPitch?: number;
	/** マスタ音量 0-100。既定50。 */
	masterVolume?: number;
	/** ドラム音量 0-100。既定80。 */
	drumVolume?: number;
	/**
	 * マスタリバーブの掛かり具合 0-100。既定0（オフ）。
	 * 全トラック（楽器・歌唱とも）に一律で掛かるマスタエフェクト。
	 */
	reverbAmount?: number;
	/** マスタリバーブのつまみが動かされたときに呼ばれる（0-100）。実際の音声処理は呼び出し側（studio）が担う。 */
	onReverbChange?: (amount: number) => void;
	/** マスタリバーブのDecay（残響の長さ、秒）。既定2.2、範囲0.3〜4.0。 */
	reverbDecay?: number;
	/** マスタリバーブのDecayが変化したときに呼ばれる（秒）。 */
	onReverbDecayChange?: (seconds: number) => void;
	/** マスタリバーブのPre Delay（原音から残響が立ち上がるまでの遅延、ms）。既定0、範囲0〜150。 */
	reverbPreDelay?: number;
	/** マスタリバーブのPre Delayが変化したときに呼ばれる（ms）。 */
	onReverbPreDelayChange?: (ms: number) => void;
	/**
	 * マスタディレイの掛かり具合 0-100。既定0（オフ）。テンポに同期したエコー。
	 * 全トラック共通のバス自体は用意されるが、実際に送る量はボーカルトラック個別の
	 * ディレイ送り（`e`トークン）で決める（リバーブと同じ send/return の考え方）。
	 */
	delayAmount?: number;
	/** マスタディレイのつまみが動かされたときに呼ばれる（0-100）。 */
	onDelayChange?: (amount: number) => void;
	/** マスタディレイの音価（既定 "8" = 8分音符）。曲のBPMに同期した実秒数へ変換される。 */
	delayDivision?: DelayDivision;
	/** マスタディレイの音価が変更されたときに呼ばれる。 */
	onDelayDivisionChange?: (division: DelayDivision) => void;
	/**
	 * マスタバスの「グルーコンプレッサー」量 0-100。既定0（オフ）。
	 * 全トラックの合流点（リバーブ・ディレイの戻りも含む）にまとめて軽く掛ける、
	 * 表現目的の音楽的な圧縮（常時ONの安全リミッターとは別物）。
	 */
	masterCompression?: number;
	/** マスタバスのグルーコンプレッサー量のつまみが動かされたときに呼ばれる（0-100）。 */
	onMasterCompressionChange?: (amount: number) => void;

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
	drumPatterns?: Record<
		string,
		| import("./drum-config").AnyDrumPattern
		| import("./drum-config").DrumPatternDef
	>;
	/** ドラム音源が変更されたときのコールバック（font:id形式） */
	onDrumFontChange?: (fontId: string) => void;
	/** 初期ドラム音源（font:id形式）。既定は "FluidR3_GM_sf2_file:0" */
	drumFont?: string;
	/** 歌唱合成の先読みや制御を行うヘルパ（.koe音源の再生前プリロードに使用） */
	singingVoices?: SingingVoices;
	/**
	 * 編集中の音割れ検知メーター（マスタの安全リミッター手前を監視）。
	 * 渡すとDAW UIにクリップ警告バッジを表示できる。studio.mountEditor が自動的に渡す。
	 */
	clipMeter?: ClipMeter;
	/**
	 * 静的に登録するカスタムボーカル定義の配列。
	 * MML 中の `@@key icon_url koe_url` 宣言行と同等だが、コードから直接渡せる。
	 * MML 宣言行と両方ある場合は MML 側（後読み）が優先して上書きする。
	 */
	customVocals?: CustomVocalDef[];
	defaultBpm?: number;
	initialMML?: string;
	/** 利用規約への同意画面の表示をスキップするかどうか */
	skipConsent?: boolean;
	/**
	 * シンプルモードでトラック数超過コンテンツを読み込もうとしたとき、上級者モードへの切替を要求するコールバック。
	 * `mountModeSwitch` が自動的に接続する。未接続なら確認モーダルは表示しない。
	 * - MML読み込み時: `pendingMml` にMML文字列が渡され、`applyMidi` は undefined。
	 * - MIDI読み込み時: `pendingMml` は undefined、`applyMidi` に新DAWへ適用する関数が渡される。
	 */
	/** MIDI検索クライアントの設定（未指定なら検索UI非表示）。 */
	midiSearch?: MidiSearchConfig;
	onRequestAdvancedMode?: (
		pendingMml?: string,
		applyMidi?: (daw: DawInstance) => void,
	) => void;
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
	/** 現在のドラムパターンで使用されているキー一覧を返す */
	getUsedDrumKeys: () => number[];
	/** ドラムパターンを設定する（未知のキーは無視）。選択UIにも反映する。 */
	setDrum: (name: string) => void;
	/** 指定したドラムパターンを追加し、利用可能にする */
	addDrumPattern: (
		name: string,
		pattern: import("./drum-config").DrumPatternDef,
	) => void;
	/** 現在のドラム音源（font:id）を返す */
	getDrumFont: () => string;
	/** ドラム音源を設定する（font:id） */
	setDrumFont: (fontId: string) => void;
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
	/** リモートから受信した歌詞・UTAU設定を適用する。 */
	applyLyrics: (trackId: string, data: LyricSyncData) => void;
	/**
	 * このDAWインスタンス自身が持つ「曲自体の音量」（`#volume=`）を 0-100 で変更する。
	 * `getMML()`で出力・`loadMML()`で復元される、曲データの一部として永続化される値。
	 * `loadMML()` を呼ぶたびにそのMMLの `#volume=` で上書きされるため、リスナー側の
	 * 音量の好みを別途乗せたい場合は代わりに `DtmStudio.setMasterVolume`
	 * （`studio.masterGain`、曲データと無関係な出力段ゲイン）を使うこと。
	 */
	setMasterVolume: (volume: number) => void;
	/** `setMasterVolume` のエイリアス。 */
	setVolume: (volume: number) => void;
	/** ドラム音量を 0-100 で変更する。 */
	setDrumVolume: (volume: number) => void;
	/** マスタリバーブの掛かり具合を 0-100 で変更する。 */
	setReverbAmount: (amount: number) => void;
	/** マスタリバーブのDecay（残響の長さ）を秒で変更する。 */
	setReverbDecay: (seconds: number) => void;
	/** マスタリバーブのPre Delayをmsで変更する。 */
	setReverbPreDelay: (ms: number) => void;
	/** マスタディレイの掛かり具合を 0-100 で変更する。 */
	setDelayAmount: (amount: number) => void;
	/** リモートから受信したトラック個別楽器を適用する（`onTrackInstrumentChange` は発火しない）。 */
	applyTrackInstrument: (trackIndex: number, instrumentName: string) => void;
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
	/**
	 * 指定ノート位置（step, pitchUnits）のキャンバス上のピクセル座標を返す。
	 * `pitch` の単位は units（1/372オクターブ）。
	 * 画面外の場合は onScreen=false と方角 side を返す。
	 * 協力DAWでのカーソル表示に使う。
	 */
	noteToCanvas: (
		step: number,
		pitch: number,
	) => {
		x: number;
		y: number;
		onScreen: boolean;
		side: "left" | "right" | "top" | "bottom" | null;
	};
	/** パース済みMIDIオブジェクトと選択トラックインデックスを直接適用する（上級者モード切替後の再ロード用）。 */
	applyMidiParsed?: (midi: unknown, selectedIndices: number[]) => void;
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
