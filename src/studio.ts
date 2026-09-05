/**
 * createDtmStudio — 「import して関数1つ」で鳴る、全部入りスタジオ（Layer 3）。
 *
 * @onjmin/dtm 本体（mountDAW / mountMmlPlayer）は発音を持たない注入式設計で、
 * 楽器・ドラムの実音は同梱の SoundFont エンジン（surikov / webaudiofont）に委ねる。デモ index.html では
 * その配線（AudioContext・SoundFontロード・歌声ワーカー・録音・MIDI/コード解析）を
 * 手書きしていたが、本モジュールはそれを丸ごと内包する。
 *
 *   const studio = await createDtmStudio();
 *   studio.mountEditor(editorEl, { initialMML });  // 編集UI（音・歌声込み）
 *   studio.mountPlayer(playerEl, mml);             // 再生専用UI（音・歌声込み）
 *
 * 何も渡さなければ同梱の SoundFont エンジンを使い、歌声合成ワーカーは
 * パッケージ同梱の dist/voice-worker.js を用いる。エンジンやURLは options で差し替え可能。
 */

import { parseArrayBuffer } from "midi-json-parser";
import type { InstrumentTone } from "./amp-sim";
import { buildNameToKeyMapping } from "./audio-config";
import { type ChannelStrip, createChannelStrip } from "./channel-strip";
import {
	type ChordPlayerInstance,
	type MountChordPlayerOptions,
	mountChordPlayer,
} from "./chord-player";
import { buildChordPlacements } from "./chords";
import { createClipMeter } from "./clip-meter";
import { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./daw";
import { createDelayBus, type DelayDivision } from "./delay";
import {
	type AnyDrumPattern,
	DRUM_PATTERNS as DEFAULT_DRUM_PATTERNS,
	DRUM_FONT,
	type DrumPatternDef,
	getDrumPatternKeys,
	normalizeDrumPatterns,
} from "./drum-config";
import {
	type MmlPlayback,
	type PlayChordsOptions,
	type PlayMmlOptions,
	type PlayNoteOptions,
	playChords,
	playMML,
	playNote,
	playPlacements,
} from "./headless-player";
import {
	type PlaySingingMmlOptions,
	playSingingMML,
} from "./headless-singing-player";
import { INSTRUMENT_PRESETS } from "./instrument-presets";
import {
	createSingingVoices,
	KOE_VOICEBANKS,
	koeUrl,
	panToStereo,
	type SingingVoices,
} from "./lyrics";
import { type MmlMeta, parseMML, parseMmlMeta } from "./mml-parser";
import {
	type MmlPlayerInstance,
	type MmlPlayerOptions,
	mountMmlPlayer,
} from "./mml-player";
import {
	createReverbImpulse,
	DEFAULT_REVERB_DECAY_SEC,
	DEFAULT_REVERB_PREDELAY_MS,
	MAX_REVERB_DECAY_SEC,
	MAX_REVERB_PREDELAY_MS,
	MIN_REVERB_DECAY_SEC,
	MIN_REVERB_PREDELAY_MS,
	reverbAmountToGain,
} from "./reverb";
import { SoundFont } from "./sf/SoundFont";
import { SoundFont_drum } from "./sf/SoundFont_drum";
import { SoundFont_list } from "./sf/SoundFont_list";
import { SONG_DRUM_PATTERNS } from "./song-drum-config";
import { showLoadingOverlay } from "./styles";
import { type Units, unitsToMidiDetune } from "./tuning";
import type {
	DawInstance,
	DawMode,
	DawOptions,
	FadeScheduleParams,
	PlayDrumEvent,
	PlayNoteEvent,
	TrackConfig,
} from "./types";
import { DEFAULT_BPM, DEFAULT_STEPS_PER_BAR } from "./types";
import { concatFloat32, encodeWavPCM16 } from "./wav-export";

// ── 外部エンジンの最小型（SoundFont / midi-parser）──
type SoundFontInstance = {
	play: (o: {
		ctx: AudioContext;
		destination: AudioNode;
		/** 最寄りの整数MIDIノート番号（ゾーン選択用）。 */
		pitch: number;
		volume: number;
		/** 元ノートのvelocity(0-127)。音量ではなく音色の明るさにだけ効く。 */
		velocity?: number;
		/** pitch からの微調整（セント）。31平均律など整数ノートに乗らない音高用。 */
		detuneCents?: number;
		when: number;
		duration: number;
	}) => void;
	/**
	 * この音源に合った音作りの種別（ベース／ギター等）。チャンネルストリップへ挿す
	 * 段（サチュレーション・キャビネット）の選択に使う。外部から差し替えたエンジンが
	 * 持たない場合は "none" 扱い。
	 */
	tone?: InstrumentTone;
};
type SoundFontEngine = {
	load: (o: {
		ctx: AudioContext;
		fontName: string;
		url: string;
	}) => Promise<SoundFontInstance>;
	toURL: (fullName: string) => string;
};
type SoundFontDrumEngine = {
	load: (o: {
		ctx: AudioContext;
		font: string;
		id: string;
		keys: number[];
	}) => Promise<void>;
	play: (o: {
		ctx: AudioContext;
		destination: AudioNode;
		pitch: number;
		volume: number;
		when: number;
		duration: number;
	}) => void;
	font: unknown;
};
type SoundFontListEngine = {
	init: () => void;
	onload: (cb: () => void) => void;
};

/** 注入で差し替え可能な外部エンジン群（未指定なら CDN から取得）。 */
export type DtmStudioEngines = {
	SoundFont?: SoundFontEngine;
	SoundFont_drum?: SoundFontDrumEngine;
	SoundFont_list?: SoundFontListEngine;
	parseMidi?: DawOptions["parseMidi"];
};

/** SoundFont の楽器名解決に使う SoundFont 名（FluidR3 GM）。 */
const SOUNDFONT_NAME = "FluidR3_GM_sf2_file";

/** 再生専用ビューの @n（数値）→ 役割キーの対応。0-3はsimpleモード、4以降はadvancedモード対応。 */
const TRACK_ROLES = [
	"melody",
	"submelody",
	"bass",
	"chord",
	"t4",
	"t5",
	"t6",
	"t7",
	"t8",
	"t9",
	"t10",
	"t11",
	"t12",
	"t13",
	"t14",
] as const;

/** trackId（名前付き文字列・t<N>・数値文字列）からインデックスと役割を逆引きする */
const resolveTrackIdxAndRole = (
	trackId: string,
): { trackIdx: number; role: string } => {
	const roleIdx = (TRACK_ROLES as readonly string[]).indexOf(trackId);
	if (roleIdx >= 0) {
		return { trackIdx: roleIdx, role: trackId };
	}
	if (trackId.startsWith("t")) {
		const parsed = Number(trackId.slice(1));
		const validIdx = Number.isNaN(parsed) ? 0 : parsed;
		return {
			trackIdx: validIdx,
			role: TRACK_ROLES[validIdx] ?? `t${validIdx}`,
		};
	}
	const parsed = Number(trackId);
	const validIdx = Number.isNaN(parsed) ? 0 : parsed;
	return { trackIdx: validIdx, role: TRACK_ROLES[validIdx] ?? `t${validIdx}` };
};

/** 同梱ワーカー（dist/voice-worker.js）の既定URLを import.meta 基準で解決する。 */
const resolveDefaultVoiceWorkerUrl = (): string | undefined => {
	try {
		// ESMビルド（dist/index.mjs）では import.meta.url 基準で隣の voice-worker.js を
		// 解決する。Vite等のバンドラはこの new URL(...) パターンを資産として拾う。
		// NodeNext は本ファイルをCJS扱いし import.meta を禁ずるが、実体のビルドは
		// tsup(esbuild) が行い両フォーマットで import.meta.url を供給するため無視する。
		// @ts-expect-error TS1470: import.meta は ESM ビルド出力でのみ評価される
		return new URL("./voice-worker.js", import.meta.url).href;
	} catch {
		return undefined;
	}
};

export type DtmStudioOptions = {
	/** 既存の AudioContext を使う（未指定なら内部生成）。 */
	audioContext?: AudioContext;
	/**
	 * マスター音量 0-100（楽器・歌声）。既定100。
	 * ライブラリ内の他の音量パラメータ（`setMasterVolume` 等）と同じ0-100スケール。
	 */
	masterVolume?: number;
	/** ドラム音量 0-100。既定100。 */
	drumVolume?: number;
	/** マスタリバーブの掛かり具合 0-100。既定0（オフ）。全トラックへ一律で掛かる。 */
	reverbAmount?: number;
	/** マスタリバーブのDecay（残響の長さ、秒）。既定2.2、範囲0.3〜4.0。 */
	reverbDecay?: number;
	/** マスタリバーブのPre Delay（ms）。既定0、範囲0〜150。 */
	reverbPreDelay?: number;
	/** マスタディレイの掛かり具合 0-100。既定0（オフ）。テンポに同期したエコー。 */
	delayAmount?: number;
	/**
	 * マスタバスの「グルーコンプレッサー」量 0-100。既定0（オフ）。
	 * 全トラックの合流点（リバーブ・ディレイの戻りも含む）にまとめて軽く掛ける、
	 * 表現目的の音楽的な圧縮（常時ONの安全リミッターとは別物）。
	 */
	masterCompression?: number;
	/** マスタディレイの音価（既定 "8" = 8分音符）。 */
	delayDivision?: DelayDivision;
	/** 曲頭のフェードイン長（秒）。既定0（フェードなし）。 */
	fadeInSec?: number;
	/** 曲尾のフェードアウト長（秒）。既定0（フェードなし）。 */
	fadeOutSec?: number;
	/**
	 * 最終出力先の AudioNode。未指定時は audioCtx.destination（スピーカー）。
	 * MediaStreamAudioDestinationNode や GainNode を指定できます。
	 */
	destination?: AudioNode;
	/**
	 * 歌声合成ワーカー（voice-worker.js）のURL。
	 * 既定はパッケージ同梱の dist/voice-worker.js。
	 * `null` を渡すとワーカーを使わず klatt のみ（koe音源はメインスレッド合成）。
	 */
	voiceWorkerUrl?: string | null;
	/** 初期の楽器プリセットキー（INSTRUMENT_PRESETS）。既定 "retro_game"。 */
	defaultPreset?: string;
	/** 外部エンジンの注入（指定したものは組み込み実装をスキップ）。 */
	engines?: DtmStudioEngines;
	/**
	 * koe音源（.koe）のベースURL。
	 * Discord Activity など CSP 制限下で `/.proxy/koe` を渡すと
	 * worker 内の fetch も同オリジン経由になり CSP を通過できる。
	 */
	koeBaseUrl?: string;
	/**
	 * worldline.js（WORLDボコーダ）のURL。
	 * Discord Activity など CSP 制限下で `/.proxy/koe-lib/demo/world/worldline.js`
	 * を渡すと worker 内の importScripts も同オリジン経由になり CSP を通過できる。
	 */
	worldlineScriptUrl?: string;
	/** 有効化する機能。既定はすべて true。 */
	features?: {
		/** MIDIファイル読み込み。 */
		midi?: boolean;
		/** コード入力（和音）。 */
		chord?: boolean;
		/** 編集UIに楽器プリセット選択UIを差し込む。 */
		presetUI?: boolean;
	};
	/** MIDI検索クライアントの設定（未指定なら検索UI非表示）。 */
	midiSearch?: import("./midi-search").MidiSearchConfig;
	/** ドラムパターン辞書。 */
	drumPatterns?: Record<string, AnyDrumPattern | DrumPatternDef>;
};

/** 編集UIのマウント時オプション（DawOptions を一部上書きできる）。 */
export type MountEditorOptions = Partial<DawOptions> & {
	/** このエディタで読み込む楽器プリセット（未指定なら studio の defaultPreset）。 */
	preset?: string;
	/** プリセット選択UIを出すか（未指定なら studio の features.presetUI）。 */
	presetUI?: boolean;
};

/** 再生UIのマウント時オプション（MmlPlayerOptions を一部上書きできる）。 */
export type MountPlayerOptions = Partial<MmlPlayerOptions>;

/** {@link DtmStudio.mountPresetSelect} のオプション。 */
export type PresetSelectOptions = {
	/**
	 * 操作対象の現在の DawInstance を返す getter。
	 * モード再マウントで daw が差し替わるため、参照ではなく関数で受け取る。
	 */
	getDaw: () => DawInstance | null;
	/**
	 * プリセットをロードするトラックID群を返す（都度評価）。
	 * モードでトラック構成が変わるため関数。未指定なら4役割（simpleモード相当）。
	 */
	getTrackIds?: () => string[];
	/** 初期選択プリセットキー（未指定なら studio の defaultPreset）。 */
	value?: string;
	/**
	 * プリセット読み込み中にローディングオーバーレイを被せる要素。
	 * 未指定なら DAW 内蔵の「LOADING」表示（setLoading）だけに任せる。
	 */
	loadingTarget?: HTMLElement | null;
	/** プリセット確定時に呼ばれる（永続化用）。 */
	onChange?: (presetKey: string) => void;
	/** wrapper 要素に付与する className（既定 "dtm-controlbar"）。 */
	className?: string;
	/** 先頭ラベルの文言（既定 "INSTRUMENT"）。`null` でラベル無し。 */
	label?: string | null;
	/** target への挿入位置（既定 "append"）。 */
	position?: "append" | "prepend";
};

/** {@link DtmStudio.mountPresetSelect} の戻り値。 */
export type PresetSelectInstance = {
	/** 生成したUIのルート要素（ラベル＋select を内包）。 */
	element: HTMLElement;
	/** select 要素そのもの。 */
	select: HTMLSelectElement;
	/** 選択値を変更する（changeイベントは発火しない）。 */
	setValue: (presetKey: string) => void;
	/** 現在の選択プリセットキーを返す。 */
	getValue: () => string;
	/** UIを破棄する。 */
	destroy: () => void;
};

/** {@link DtmStudio.mountModeSwitch} のオプション。 */
export type ModeSwitchOptions = {
	/** 編集UI（mountEditor）をマウントするコンテナ。 */
	editorTarget: HTMLElement;
	/** 初期モード（既定 "simple"）。 */
	mode?: DawMode;
	/**
	 * モード→トラック構成。
	 * 既定は simple→TRACKS_SIMPLE / advanced→TRACKS_ADVANCED。
	 */
	tracksFor?: (mode: DawMode) => TrackConfig[];
	/**
	 * mountEditor に渡す共通オプション（initialMML / preset / defaultBpm / 各コールバック等）。
	 * 関数を渡すとモードごとに切り替えられる。`mode` / `tracks` / `initialMML` は
	 * モード切替側が上書きするため、ここで指定しても再マウント時には無視される。
	 */
	editorOptions?: MountEditorOptions | ((mode: DawMode) => MountEditorOptions);
	/** マウント／再マウント完了時に呼ばれる（最新 daw を受け取る。MMLポーリング開始等）。 */
	onMount?: (daw: DawInstance, mode: DawMode) => void;
	/**
	 * 破棄直前に呼ばれる（MMLポーリング停止等）。
	 * 再マウント時の最新MMLの引き継ぎは内部で行うため、ここでの保存は任意。
	 */
	onUnmount?: (daw: DawInstance, mode: DawMode) => void;
	/** モード確定時に呼ばれる（永続化用。初期マウントでは呼ばれない）。 */
	onChange?: (mode: DawMode) => void;
	/** 各モードのボタンラベル（既定 simple="シンプル" / advanced="アドバンス"）。 */
	labels?: Partial<Record<DawMode, string>>;
	/** 先頭ラベルの文言（既定 "MODE"）。`null` でラベル無し。 */
	label?: string | null;
	/** wrapper 要素に付与する className（既定 "dtm-controlbar"）。 */
	className?: string;
	/** target への挿入位置（既定 "append"）。 */
	position?: "append" | "prepend";
};

/** {@link DtmStudio.mountModeSwitch} の戻り値。 */
export type ModeSwitchInstance = {
	/** 生成したUIのルート要素。 */
	element: HTMLElement;
	/** 現在マウント中の DawInstance（再マウントで差し替わる）。 */
	getDaw: () => DawInstance | null;
	/** 現在のモード。 */
	getMode: () => DawMode;
	/** モードを変更し、編集UIを再マウントする（MMLは引き継ぐ）。 */
	setMode: (mode: DawMode) => void;
	/** UIと編集UIをまとめて破棄する。 */
	destroy: () => void;
};

export type DtmStudio = {
	/** 内部で使用している AudioContext。 */
	audioContext: AudioContext;
	/** マスターゲインノード（全音色の最終出力先）。 */
	masterGain: GainNode;
	/**
	 * 録画・録音用の MediaStreamAudioDestinationNode を生成/取得する。
	 * masterGain が接続され、その stream から音声トラックを取得できます。
	 */
	createMediaStreamDestination: () => MediaStreamAudioDestinationNode;
	/**
	 * 録画・録音用の Audio MediaStreamTrack を取得する。
	 * MediaRecorder のストリーム合成（canvas + audio）に使えます。
	 */
	getAudioStreamTrack: () => MediaStreamTrack;
	/**
	 * WAV書き出し用の録音を開始する（マスタバス最終段＝リバーブ/ディレイ/コンプ/
	 * リミッター/フェード適用後のPCMをそのままタップする）。
	 * 呼び出し側で再生（daw.play() 等）を開始し、曲が終わったら stopWavRecording を呼ぶ想定。
	 * 実際の再生と同じ経路を録るため等速（曲の長さ分だけ実時間がかかる）。
	 */
	startWavRecording: () => void;
	/** startWavRecording で開始した録音を止め、16bit PCM WAVのBlobを返す。 */
	stopWavRecording: () => Promise<Blob>;
	/** 歌声合成ヘルパ（klatt + koe音源）。 */
	singingVoices: SingingVoices;
	/** 編集UI（mountDAW）を音・歌声込みでマウントする。 */
	mountEditor: (
		target: HTMLElement,
		options?: MountEditorOptions,
	) => DawInstance;
	/** 再生専用UI（mountMmlPlayer）を音・歌声込みでマウントする。 */
	mountPlayer: (
		target: HTMLElement,
		mml: string,
		options?: MountPlayerOptions,
	) => MmlPlayerInstance;
	/** コード進行再生専用プレイヤー（UI）をマウントする */
	mountChordPlayer: (
		target: HTMLElement,
		chords: string,
		options?: Omit<MountChordPlayerOptions, "studio">,
	) => ChordPlayerInstance;
	/** UIなしで高品質な楽器再生（SoundFont）を行う */
	play: (
		mml: string,
		options?: Omit<
			PlayMmlOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		>,
	) => MmlPlayback;
	/** UIなしで高品質な楽器再生（SoundFont）＋歌声合成を行う */
	playSingingMML: (
		mml: string,
		options?: Omit<
			PlaySingingMmlOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		>,
	) => Promise<MmlPlayback>;
	/** SoundFontへ PlayNoteEvent を鳴らす（headless API の onPlayNote フック用） */
	playNoteEvent: (e: PlayNoteEvent) => void;
	/** SoundFontへ PlayDrumEvent を鳴らす（headless API の onPlayDrum フック用） */
	playDrumEvent: (e: PlayDrumEvent) => void;
	/** SoundFontを用いた単音再生を行う */
	playNote: (options: {
		/** ピッチ。単位は units（1/372オクターブ）。`pitchV1ToUnits` でMIDI番号から変換できる。 */
		pitchUnits: Units;
		volume?: number;
		duration?: number;
		instrument?: string;
	}) => Promise<void>;
	/** SoundFontを用いたコード進行再生を行う */
	playChords: (
		chordStr: string,
		options?: Omit<
			PlayChordsOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		>,
	) => MmlPlayback;
	/** 楽器プリセットを（指定トラックぶん）ロードする。 */
	loadPreset: (presetKey: string, trackIds?: string[]) => Promise<void>;
	/** 既定の楽器プリセットキー（options.defaultPreset ?? "retro_game"）。 */
	defaultPreset: string;
	/**
	 * 楽器プリセット選択UI（INSTRUMENT）を target に差し込む。
	 * 変更時に内部で setInstrument＋loadPreset（再生中なら一旦停止→再開）まで配線する。
	 * 編集UIの外側に独自配置したいライブラリ利用者向け（mountEditor の presetUI と同等）。
	 */
	mountPresetSelect: (
		target: HTMLElement,
		options: PresetSelectOptions,
	) => PresetSelectInstance;
	/**
	 * モード切替UI（SIMPLE/ADVANCED）を target に差し込み、編集UIのマウントごと面倒を見る。
	 * 切替時に「最新MML取り込み→destroy→新トラック構成で再マウント→MML復元」まで内部で行う。
	 * getDaw() で現在の DawInstance を取得できる（mountPresetSelect の getDaw に渡せる）。
	 */
	mountModeSwitch: (
		target: HTMLElement,
		options: ModeSwitchOptions,
	) => ModeSwitchInstance;
	/**
	 * studio 全体（このstudioを共有する全ての mountEditor / mountPlayer / mountChordPlayer /
	 * playSingingMML インスタンス）の出力段ゲインを 0-100 で変更する。
	 *
	 * これは「聴く人（リスナー）側の音量設定」用のノブで、曲データとは無関係に
	 * オーディオグラフの最終段（`studio.masterGain`）に一度だけ掛かる。
	 * `DawInstance.setMasterVolume` / `MmlPlayerOptions.masterVolume`（`#volume=`
	 * と往復する“曲自体が持つ音量”）とは別物なので混同しないこと。
	 * `daw.loadMML()` や `#volume=` の内容に一切影響されない。
	 */
	setMasterVolume: (volume: number) => void;
	/** `setMasterVolume` のエイリアス。 */
	setVolume: (volume: number) => void;
	/** マスタリバーブの掛かり具合を 0-100 で変更する。 */
	setReverbAmount: (amount: number) => void;
	/** マスタリバーブのDecay（残響の長さ）を秒で変更する。 */
	setReverbDecay: (seconds: number) => void;
	/** マスタリバーブのPre Delayをmsで変更する。 */
	setReverbPreDelay: (ms: number) => void;
	/** マスタディレイの掛かり具合を 0-100 で変更する。 */
	setDelayAmount: (amount: number) => void;
	/** マスタバスのグルーコンプレッサー量を 0-100 で変更する。 */
	setMasterCompression: (amount: number) => void;
	/** AudioContext を閉じ、生成物を破棄する。 */
	dispose: () => void;
};

/**
 * 全部入りスタジオを生成する。SoundFontエンジン・ドラム音源・楽器プリセットの
 * 初期ロードまで待ってから解決するため、await して使う。
 */
export const createDtmStudio = async (
	options: DtmStudioOptions = {},
): Promise<DtmStudio> => {
	const features = {
		midi: true,
		chord: true,
		presetUI: true,
		...options.features,
	};

	// 汎用プリセット + 曲固有パターン(asayakeなど) + 利用側カスタムをマージした辞書。
	// daw.ts / mml-player.ts / headless-player.ts の解決ロジックと同じ合成順にしないと、
	// 編集画面では鳴るのに再生専用プレイヤーでは曲固有ドラムが無音になる（サンプル未ロード）。
	const resolveDrumPatterns = (
		custom?: Record<string, AnyDrumPattern | DrumPatternDef>,
	) => ({
		...DEFAULT_DRUM_PATTERNS,
		...SONG_DRUM_PATTERNS,
		...normalizeDrumPatterns(custom ?? {}),
	});

	// ── AudioContext とゲイン段 ──
	const audioCtx =
		options.audioContext ?? new AudioContext({ sampleRate: 44100 });
	const masterGain = audioCtx.createGain();
	masterGain.gain.value = (options.masterVolume ?? 100) / 100;
	const drumGain = audioCtx.createGain();
	drumGain.gain.value = (options.drumVolume ?? 100) / 100;
	drumGain.connect(masterGain);

	// ── マスタリバーブ（send/return）── 全トラック一律の強制センドではなく、
	// トラックごとの個別センド量（チャンネルストリップの reverbSend、歌詞トラックは
	// vocalReverb）の合算だけが reverbPreDelay に入る。声だけ・特定トラックだけに
	// リバーブを掛ける（他は掛けない）ことができるようにするための構成。
	// [各トラックのセンド] → preDelay → convolver(Decay) → wetGain(Mix) → finalMix
	let reverbDecaySec = options.reverbDecay ?? DEFAULT_REVERB_DECAY_SEC;
	const reverbPreDelay = audioCtx.createDelay(MAX_REVERB_PREDELAY_MS / 1000);
	reverbPreDelay.delayTime.value =
		(options.reverbPreDelay ?? DEFAULT_REVERB_PREDELAY_MS) / 1000;
	const reverbConvolver = audioCtx.createConvolver();
	reverbConvolver.buffer = createReverbImpulse(audioCtx, reverbDecaySec);
	reverbConvolver.normalize = true;
	const reverbWetGain = audioCtx.createGain();
	reverbWetGain.gain.value = reverbAmountToGain(options.reverbAmount ?? 0);
	reverbPreDelay.connect(reverbConvolver);
	reverbConvolver.connect(reverbWetGain);

	/** マスタリバーブの掛かり具合（Mix）を 0-100 で設定する。急な変化によるクリックを避けて滑らかに遷移する。 */
	const setReverbAmount = (amount: number): void => {
		reverbWetGain.gain.setTargetAtTime(
			reverbAmountToGain(amount),
			audioCtx.currentTime,
			0.02,
		);
	};
	/**
	 * マスタリバーブのDecay（残響の長さ、秒）を設定する。インパルス応答の再生成を伴うため
	 * 連続的にドラッグされても毎フレーム重い処理が走らないよう、呼び出し側（daw.ts）は
	 * スライダーの input イベントごとに呼ぶ想定 — 数秒分のノイズ生成程度は許容範囲の負荷。
	 */
	const setReverbDecay = (seconds: number): void => {
		reverbDecaySec = Math.max(
			MIN_REVERB_DECAY_SEC,
			Math.min(MAX_REVERB_DECAY_SEC, seconds),
		);
		reverbConvolver.buffer = createReverbImpulse(audioCtx, reverbDecaySec);
	};
	/** マスタリバーブのPre Delay（原音からリバーブが立ち上がるまでの遅延、ms）を設定する。 */
	const setReverbPreDelay = (ms: number): void => {
		reverbPreDelay.delayTime.setTargetAtTime(
			Math.max(MIN_REVERB_PREDELAY_MS, Math.min(MAX_REVERB_PREDELAY_MS, ms)) /
				1000,
			audioCtx.currentTime,
			0.02,
		);
	};

	// ── 最終段: ドライ＋ウェットの合流点 → 常時ONの安全リミッター → 実出力 ──
	// 編集中に音が突然大きくなって耳やスピーカーを傷めることがないよう、ユーザー設定に
	// 関わらず常にここでピークを抑える（0dBFS付近のブリックウォール）。トラック単位の
	// コンプレッサー（音圧強化、任意）とは別物 — こちらは「保険」であって表現ではない。
	const finalMix = audioCtx.createGain();
	masterGain.connect(finalMix);
	reverbWetGain.connect(finalMix);

	// ── マスタディレイ（send/return）── リバーブと同じ並列センド構成。
	// テンポ同期のため、初期BPMを渡しておき setBpm で追従させる（DAWのBPM変更に連動）。
	const delayBus = createDelayBus(audioCtx, finalMix, {
		amount: options.delayAmount ?? 0,
		division: options.delayDivision ?? "8",
	});
	const setDelayAmount = (amount: number): void => delayBus.setAmount(amount);

	// ── マスタバスの「グルーコンプレッサー」── 全トラックの合流点（リバーブ・ディレイの
	// 戻りも含む finalMix）にまとめて軽く掛ける、表現目的の音楽的な圧縮。上の安全リミッター
	// とは別物で、既定0（オフ）＝ユーザー（または「おまかせ」）が能動的に選ぶ効果。
	// 「グルー(接着剤)」の名の通り、各トラックの頭をわずかに均して一体感・音圧感を出す。
	const glueComp = audioCtx.createDynamicsCompressor();
	glueComp.knee.value = 6; // ソフトニー固定（急に掛かり始めるとポンピングが目立つため）
	const glueMakeup = audioCtx.createGain();
	finalMix.connect(glueComp);
	glueComp.connect(glueMakeup);

	/**
	 * グルーコンプの掛かり具合（0-100）→ DynamicsCompressorNode パラメータ。
	 * トラック単位のコンプ（channel-strip.ts、最大12:1）より穏やかなレシオ（最大4:1）・
	 * やや遅めのアタックにする（アタックを詰めすぎると各トラックのアタック感が潰れて
	 * 団子になり「グルー」ではなく「圧殺」になるため）。0で実質バイパス
	 * （threshold=0dB, ratio=1:1）。圧縮した分だけ聴感上小さくなるのを補うため、
	 * 掛かり具合に応じて控えめなメイクアップゲイン（最大+2.5dB）を足す。
	 */
	const glueCompressionParams = (
		amount: number,
	): {
		threshold: number;
		ratio: number;
		attack: number;
		release: number;
		makeupDb: number;
	} => {
		const t = Math.max(0, Math.min(100, amount)) / 100;
		return {
			threshold: 0 + (-18 - 0) * t,
			ratio: 1 + (4 - 1) * t,
			attack: 0.03 + (0.01 - 0.03) * t,
			release: 0.3 + (0.15 - 0.3) * t,
			makeupDb: 2.5 * t,
		};
	};
	const applyGlueCompression = (amount: number): void => {
		const p = glueCompressionParams(amount);
		const now = audioCtx.currentTime;
		glueComp.threshold.setValueAtTime(p.threshold, now);
		glueComp.ratio.setValueAtTime(p.ratio, now);
		glueComp.attack.setValueAtTime(p.attack, now);
		glueComp.release.setValueAtTime(p.release, now);
		glueMakeup.gain.setTargetAtTime(10 ** (p.makeupDb / 20), now, 0.02);
	};
	applyGlueCompression(options.masterCompression ?? 0);
	const setMasterCompression = (amount: number): void =>
		applyGlueCompression(amount);

	const safetyLimiter = audioCtx.createDynamicsCompressor();
	safetyLimiter.threshold.value = -1;
	safetyLimiter.knee.value = 0;
	safetyLimiter.ratio.value = 20;
	safetyLimiter.attack.value = 0.001;
	safetyLimiter.release.value = 0.1;
	glueMakeup.connect(safetyLimiter);

	// 曲頭/曲尾のフェード。安全リミッターの後段（最後）に置き、他のどの処理よりも
	// 優先して音量0まで落とせるようにする。既定は常に1（フェードなし）。
	const fadeGain = audioCtx.createGain();
	fadeGain.gain.value = 1;
	safetyLimiter.connect(fadeGain);
	fadeGain.connect(options.destination ?? audioCtx.destination);

	/**
	 * 1回の play() で使うフェードスケジュールを適用する。null で解除（音量1へ即戻す）。
	 * pause/stop 時に必ず null を渡してもらう想定 — 途中で止めた場合に半端な音量や
	 * 予約済みランプが残らないようにするため。
	 */
	const scheduleFade = (params: FadeScheduleParams | null): void => {
		fadeGain.gain.cancelScheduledValues(audioCtx.currentTime);
		if (!params) {
			fadeGain.gain.setValueAtTime(1, audioCtx.currentTime);
			return;
		}
		const { fadeInStartAt, fadeInEndAt, fadeOutStartAt, fadeOutEndAt } = params;
		if (fadeInStartAt !== undefined && fadeInEndAt !== undefined) {
			fadeGain.gain.setValueAtTime(0, fadeInStartAt);
			fadeGain.gain.linearRampToValueAtTime(1, fadeInEndAt);
		} else {
			fadeGain.gain.setValueAtTime(1, audioCtx.currentTime);
		}
		if (fadeOutStartAt !== undefined && fadeOutEndAt !== undefined) {
			fadeGain.gain.setValueAtTime(1, fadeOutStartAt);
			fadeGain.gain.linearRampToValueAtTime(0, fadeOutEndAt);
		}
	};

	// クリップ検知メーター。安全リミッターの「手前」（finalMix）を監視するので、
	// リミッターが常に守ってくれていても「素材自体は限界に来ている」を警告できる。
	// グルーコンプ通過後（安全リミッターの直前）を監視する。グルーコンプは意図的にピークを
	// 抑える処理なので、その手前(finalMix)で測ると「素材は限界だがグルーコンプで既に収まって
	// いる」ケースを誤検知してしまうため。
	const clipMeter = createClipMeter(audioCtx, glueMakeup);

	// ── トラック単位チャンネルストリップ（コンプレッサー＋ステレオワイド）──
	// ボーカル・楽器を問わず、trackId ごとに1本ずつ遅延生成してキャッシュする。
	// 各トラックの発音は masterGain に直結せず、まずこのストリップを通す。
	const channelStrips = new Map<string, ChannelStrip>();
	const getChannelStrip = (trackId: string): ChannelStrip => {
		let strip = channelStrips.get(trackId);
		if (!strip) {
			strip = createChannelStrip(audioCtx, masterGain, {
				reverbBus: reverbPreDelay,
				delayBus: delayBus.input,
			});
			channelStrips.set(trackId, strip);
		}
		return strip;
	};

	/** trackId → 直近にそのトラックで鳴らした楽器の音作り種別。 */
	const trackTones = new Map<string, InstrumentTone>();
	/**
	 * 発音先のノードを返しつつ、そのトラックのチャンネルストリップへ楽器に応じた
	 * 音作り段（ベースのサチュレーション／ギターのキャビネット）を挿す。
	 * 楽器が変わったときだけ差し替わるので、発音のたびに呼んでよい。
	 */
	const routeToStrip = (trackId: string, tone: InstrumentTone): AudioNode => {
		const strip = getChannelStrip(trackId);
		if (trackTones.get(trackId) !== tone) {
			trackTones.set(trackId, tone);
			strip.setInstrumentTone(tone);
		}
		return strip.input;
	};

	// ── キック → ベースのサイドチェイン ──
	// キックとベースは同じ低域に居るので、同時に鳴ると打ち消し合って**両方**が弱くなる。
	// キックの瞬間だけベースを一段譲らせると、キックの芯が通り、ベースも輪郭が出る。
	/** キックとみなすGMドラムキー（35=Acoustic Bass Drum, 36=Bass Drum 1）。 */
	const KICK_PITCHES = new Set([35, 36]);
	/** ダッキングの深さ（0.25 = -25%）と戻り時間（秒）。 */
	const SIDECHAIN_DEPTH = 0.25;
	const SIDECHAIN_RELEASE_SEC = 0.16;
	const duckBassForKick = (whenSec: number): void => {
		const at = audioCtx.currentTime + whenSec;
		for (const [trackId, tone] of trackTones) {
			if (tone !== "bass") continue;
			channelStrips
				.get(trackId)
				?.duck(at, SIDECHAIN_DEPTH, SIDECHAIN_RELEASE_SEC);
		}
	};

	/**
	 * MMLメタのトラック別チャンネルストリップ設定（`#t<n>comp=` 等）を、そのトラックの
	 * 発音先ストリップへ一度だけ適用するアプライヤを作る。
	 *
	 * エディタ（mountEditor）では daw.ts が `onTrackCompressionChange` 等を発火して
	 * 同じ設定を反映するが、再生専用プレイヤー経路にはその配線が無く、ストリップが
	 * 既定値（コンプ0・EQフラット・幅100・センド0・中央定位）のまま鳴っていた。
	 * そのため同じMMLでもエディタと再生専用プレイヤーで音量・聴こえ方がずれていた。
	 *
	 * 適用はストリップ生成後の遅延実行（発音直前）にする。`getChannelStrip` が
	 * trackId をキーに遅延生成する設計で、しかも trackId の表記が経路ごとに違う
	 * （エディタは "melody"、再生専用ビューは数値文字列）ため、事前に一括適用しようと
	 * すると実際に発音で使われるストリップとキーがずれて空振りするため。
	 */
	const createTrackStripApplier = (
		meta: MmlMeta,
	): ((stripId: string, trackIdx: number) => void) => {
		const applied = new Set<string>();
		return (stripId, trackIdx) => {
			if (applied.has(stripId)) return;
			applied.add(stripId);
			const strip = getChannelStrip(stripId);
			const comp = meta.trackCompression?.[trackIdx];
			if (comp !== undefined) strip.setCompression(comp);
			const width = meta.trackWidth?.[trackIdx];
			if (width !== undefined) strip.setWidth(width);
			const eqLow = meta.trackEqLow?.[trackIdx];
			if (eqLow !== undefined) strip.setEqLow(eqLow);
			const eqMid = meta.trackEqMid?.[trackIdx];
			if (eqMid !== undefined) strip.setEqMid(eqMid);
			const eqHigh = meta.trackEqHigh?.[trackIdx];
			if (eqHigh !== undefined) strip.setEqHigh(eqHigh);
			const reverbSend = meta.trackReverbSend?.[trackIdx];
			if (reverbSend !== undefined) strip.setReverbSend(reverbSend);
			const delaySend = meta.trackDelaySend?.[trackIdx];
			if (delaySend !== undefined) strip.setDelaySend(delaySend);
			const pan = meta.trackPan?.[trackIdx];
			if (pan !== undefined) strip.setPan(panToStereo(pan));
		};
	};

	const resumeAudio = (): Promise<void> => {
		// Safari は new AudioContext() 直後に state が "running" と報告するが、
		// ユーザー操作前はオーディオ出力が実際には有効化されていない場合がある。
		// "running" でも resume() を呼ぶことは no-op で安全なため、
		// closed 以外では常に resume() を呼んで Safari の autoplay ゲートを確実に開く。
		if (audioCtx.state === "closed") return Promise.resolve();
		return audioCtx.resume();
	};

	// ── エンジン（注入優先、無ければ組み込み SoundFont）──
	const eng = options.engines ?? {};
	const sf = eng.SoundFont ?? SoundFont;
	const sfDrum = eng.SoundFont_drum ?? SoundFont_drum;
	const sfList = eng.SoundFont_list ?? SoundFont_list;

	// MIDI解析。
	let parseMidi: DawOptions["parseMidi"];
	if (features.midi) {
		parseMidi =
			eng.parseMidi ||
			((bytes) => {
				const buffer = bytes.buffer;
				if (buffer instanceof ArrayBuffer) {
					return parseArrayBuffer(
						buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
					);
				}
				throw new Error("SharedArrayBuffer is not supported for MIDI parsing");
			});
	}

	// ── 歌声合成（klatt + koe音源。ワーカーは同梱 dist/voice-worker.js を既定に）──
	const voiceWorkerUrl =
		options.voiceWorkerUrl === null
			? undefined
			: (options.voiceWorkerUrl ?? resolveDefaultVoiceWorkerUrl());
	const voicebanks = options.koeBaseUrl
		? Object.fromEntries(
				Object.entries(KOE_VOICEBANKS).map(([k, file]) => [
					k,
					koeUrl(file, options.koeBaseUrl),
				]),
			)
		: undefined;
	const singingVoices = createSingingVoices(audioCtx, masterGain, {
		voiceWorkerUrl,
		voicebanks,
		worldlineScriptUrl: options.worldlineScriptUrl,
		// ボーカルトラック個別のリバーブセンド（`r`トークン）先。マスタリバーブの
		// Convolver 入力へ直接センドする（PreDelayは経由しない。チャンネルストリップの
		// reverbSend とは別経路の、音節単位でより細かく制御できるセンド）。
		reverbBus: reverbConvolver,
		// ボーカルトラック個別のディレイセンド（`e`トークン）先。
		delayBus: delayBus.input,
		// トラック単位チャンネルストリップ（コンプレッサー/ステレオワイド）の入口。
		// 楽器と同じ getChannelStrip キャッシュを共有するので、演奏トラックと歌詞トラックが
		// 同じ trackId を指していれば同じ処理が掛かる。
		getTrackDestination: (trackId) => getChannelStrip(trackId).input,
	});

	// ── SoundFont（楽器）ロード ──
	// SoundFont.toURL は SoundFont_list の初期化完了後に有効になる。
	const listReady = new Promise<void>((resolve) => {
		sfList.init();
		sfList.onload(() => resolve());
	});

	// ドラム音源の遅延ロード状態管理
	const loadedDrumKeys = new Map<string, Set<number>>();
	const loadRequiredDrums = async (
		keys: number[],
		drumFontStr: string = "FluidR3_GM_sf2_file:0",
	): Promise<void> => {
		const [font, id] = drumFontStr.split(":");
		let set = loadedDrumKeys.get(drumFontStr);
		if (!set) {
			set = new Set<number>();
			loadedDrumKeys.set(drumFontStr, set);
		}
		const newKeys = keys.filter((k) => !set.has(k));
		try {
			// キャッシュ済みでも sfDrum.font を指定音源へ切り替えるため常に load を呼ぶ。
			// sfDrum.load は未読込キーのみ取得し、読込済みならマップ切り替えだけ行う。
			await sfDrum.load({
				ctx: audioCtx,
				font,
				id: id || "0",
				keys: newKeys,
			});
			for (const k of newKeys) set.add(k);
		} catch (e) {
			console.error("[dtm] ドラム音源の読み込みに失敗", e);
		}
	};
	const drumReady = Promise.resolve();

	let nameToKey: Record<string, string> = {};
	// URLエンコーダがスペースを除去した楽器名を正規の GM 名へ逆引きする
	const resolveNameToKey = (name: string): string | undefined => {
		if (nameToKey[name]) return nameToKey[name];
		const stripped = name.replace(/\s+/g, "").toLowerCase();
		const canonical = Object.keys(nameToKey).find(
			(k) => k.replace(/\s+/g, "").toLowerCase() === stripped,
		);
		return canonical ? nameToKey[canonical] : undefined;
	};
	// 楽器音源は「役割」ではなく「実際の楽器キー」で1つだけ持ち、編集UI・全再生UIで
	// 安全に共有する。役割キー（melody等）で持つと、別プリセットを読むたびに同じ役割キーを
	// 上書きし合い、再生UIの楽器が指定と別物になる（最後に解決したロードが勝つ）。
	const soundFonts = new Map<string, SoundFontInstance>();
	// 同一楽器キーの多重ロードを避けるための進行中Promise。
	const loadingByKey = new Map<string, Promise<void>>();

	const loadInstrument = (instrumentKey: string): Promise<void> => {
		if (soundFonts.has(instrumentKey)) return Promise.resolve();
		const inflight = loadingByKey.get(instrumentKey);
		if (inflight) return inflight;
		const fullName = `${instrumentKey}_${SOUNDFONT_NAME}`;
		const p = sf
			.load({
				ctx: audioCtx,
				fontName: `_tone_${fullName}`,
				url: sf.toURL(fullName),
			})
			.then((sf) => {
				soundFonts.set(instrumentKey, sf);
			})
			.catch((e) => {
				console.error(`[dtm] 楽器 "${instrumentKey}" の読み込みに失敗`, e);
			})
			.finally(() => {
				loadingByKey.delete(instrumentKey);
			});
		loadingByKey.set(instrumentKey, p);
		return p;
	};

	const defaultPreset = options.defaultPreset ?? "retro_game";

	/** トラックのインデックスから役割キーを取得する。シンプルモードでは3以上（分解された伴奏トラック）はすべて伴奏にマッピングする。 */
	const getRoleForTrackIndex = (
		idx: number,
		mode: DawMode = "simple",
	): string => {
		if (mode === "simple") {
			if (idx === 0) return "melody";
			if (idx === 1) return "submelody";
			if (idx === 2) return "bass";
			return "chord"; // 3以上はすべて伴奏（chord）
		} else {
			return TRACK_ROLES[idx] ?? `t${idx}`;
		}
	};

	/** トラックID（"melody"や"t0"など）を適切な役割キー（"melody"や"chord"など）へ正規化する。 */
	const getRoleFromTrackId = (
		trackId: string,
		mode: DawMode = "simple",
	): string => {
		if (
			trackId === "melody" ||
			trackId === "submelody" ||
			trackId === "bass" ||
			trackId === "chord"
		) {
			return trackId;
		}
		if (trackId.startsWith("t")) {
			const idx = Number(trackId.substring(1));
			if (!Number.isNaN(idx)) {
				return getRoleForTrackIndex(idx, mode);
			}
		}
		return trackId;
	};

	/** トラックの役割から楽器名を引く（役割キー以外は melody を使う＝上級者モード互換）。 */
	const instrumentNameFor = (
		preset: (typeof INSTRUMENT_PRESETS)[string],
		trackId: string,
	): string => (preset as Record<string, string>)[trackId] ?? preset.melody;

	/** プリセット＋トラック（役割）から、ロード済みの SoundFont を引く。 */
	const resolveSoundFont = (
		presetKey: string,
		trackId: string,
		mode: DawMode = "simple",
	): SoundFontInstance | undefined => {
		const preset = INSTRUMENT_PRESETS[presetKey];
		if (!preset) return undefined;
		const role = getRoleFromTrackId(trackId, mode);
		const key = nameToKey[instrumentNameFor(preset, role)];
		return key ? soundFonts.get(key) : undefined;
	};

	const loadPreset = async (
		presetKey: string,
		trackIds: string[] = [...TRACK_ROLES],
		mode: DawMode = "simple",
	): Promise<void> => {
		const preset = INSTRUMENT_PRESETS[presetKey];
		if (!preset) return;
		await listReady;
		// 役割→楽器名→楽器キーへ畳み、重複を除いた楽器ぶんだけロードする。
		const keys = new Set<string>();
		for (const trackId of trackIds) {
			const role = getRoleFromTrackId(trackId, mode);
			const key = nameToKey[instrumentNameFor(preset, role)];
			if (key) keys.add(key);
		}
		await Promise.all([...keys].map((key) => loadInstrument(key)));
	};

	// 楽器プリセット変更の共通処理（編集UI内蔵・mountPresetSelect 双方で使う）。
	// 再生中なら一旦停止し、ロード中はローディング表示、完了後に同じ位置から再開する。
	const applyPreset = async (
		daw: DawInstance,
		presetKey: string,
		trackIds: string[],
		loadingTarget?: HTMLElement | null,
		mode: DawMode = "simple",
	): Promise<void> => {
		const wasPlaying = daw.getPlaybackState() === "playing";
		if (wasPlaying) daw.pause();
		const overlay = loadingTarget ? showLoadingOverlay(loadingTarget) : null;
		daw.setLoading?.(true);
		try {
			daw.setInstrument(presetKey);
			await loadPreset(presetKey, trackIds, mode);
		} finally {
			overlay?.remove();
			daw.setLoading?.(false);
			if (wasPlaying) daw.play();
		}
	};

	// 楽器プリセット選択UI（INSTRUMENT）を組み立てて target に差し込む。
	const mountPresetSelect = (
		target: HTMLElement,
		opts: PresetSelectOptions,
	): PresetSelectInstance => {
		const doc = target.ownerDocument;
		const wrapper = doc.createElement("div");
		wrapper.className = opts.className ?? "dtm-controlbar";

		if (opts.label !== null) {
			const lab = doc.createElement("span");
			lab.className = "dtm-controlbar-label";
			lab.textContent = opts.label ?? "楽器プリセット";
			wrapper.appendChild(lab);
		}

		const select = doc.createElement("select");
		select.className = "dtm-select dtm-grow";
		for (const [key, p] of Object.entries(INSTRUMENT_PRESETS)) {
			const o = doc.createElement("option");
			o.value = key;
			o.textContent = p.displayName;
			select.appendChild(o);
		}
		select.value =
			opts.value && INSTRUMENT_PRESETS[opts.value] ? opts.value : defaultPreset;
		wrapper.appendChild(select);

		// 連打で多重ロードしないよう、処理中は次の change を握りつぶす。
		let busy = false;
		const onChange = async (): Promise<void> => {
			const daw = opts.getDaw();
			if (!daw || busy) return;
			busy = true;
			const key = select.value;
			opts.onChange?.(key);
			const trackIds = opts.getTrackIds?.() ?? [...TRACK_ROLES];
			const isAdvanced = trackIds.includes("t0");
			const mode = isAdvanced ? "advanced" : "simple";
			try {
				await applyPreset(daw, key, trackIds, opts.loadingTarget, mode);
			} finally {
				busy = false;
			}
		};
		select.addEventListener("change", onChange);

		if (opts.position === "prepend")
			target.insertBefore(wrapper, target.firstChild);
		else target.appendChild(wrapper);

		return {
			element: wrapper,
			select,
			setValue: (k) => {
				if (INSTRUMENT_PRESETS[k]) select.value = k;
			},
			getValue: () => select.value,
			destroy: () => {
				select.removeEventListener("change", onChange);
				wrapper.remove();
			},
		};
	};

	// 初期化：リスト読み込み→名前マッピング→既定プリセット（4役割ぶん）を先読み。
	await listReady;
	nameToKey = await buildNameToKeyMapping();
	await Promise.all([drumReady, loadPreset(defaultPreset)]);

	// ── 発音ハンドラ（ドラムは曲全体共通。楽器音は編集UI/再生UIごとにプリセットを解決） ──
	const playDrum = (e: PlayDrumEvent): void => {
		if (!sfDrum.font) return;
		if (KICK_PITCHES.has(e.pitch)) duckBassForKick(e.when);
		sfDrum.play({
			ctx: audioCtx,
			destination: drumGain,
			pitch: e.pitch,
			volume: e.velocity,
			when: e.when,
			duration: e.duration,
		});
	};

	// ── マウント ──
	const editorPresetSelects = new WeakMap<HTMLElement, PresetSelectInstance>();
	const mountedEditors: DawInstance[] = [];
	const mountedPlayers: MmlPlayerInstance[] = [];
	const mountedChordPlayers: ChordPlayerInstance[] = [];
	const mountedModeSwitches: ModeSwitchInstance[] = [];

	const mountEditor = (
		target: HTMLElement,
		opts: MountEditorOptions = {},
	): DawInstance => {
		const mergedOpts: MountEditorOptions = {
			midiSearch: options.midiSearch,
			...opts,
		};
		const {
			preset,
			presetUI,
			onInstrumentChange,
			onTrackInstrumentChange: externalOnTrackInstrumentChange,
			...dawOverrides
		} = mergedOpts;
		const tracks: TrackConfig[] = dawOverrides.tracks ?? TRACKS_SIMPLE;
		const trackIds = tracks.map((t) => t.id);

		const presetKey =
			preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;

		// MML内にこのアプリの規定する楽器指定があればそれを初期プリセットにする
		const meta = opts.initialMML ? parseMmlMeta(opts.initialMML) : {};
		const initialPreset =
			meta.instrument && INSTRUMENT_PRESETS[meta.instrument]
				? meta.instrument
				: presetKey;

		// このエディタが現在使うプリセット。プリセット選択UIの変更で更新する。
		// 楽器解決をこのエディタ専属にすることで、他のエディタ/再生UIと音源を取り合わない。
		let editorPreset = initialPreset;
		const isAdvancedMode = dawOverrides.mode === "advanced";

		// トラック個別楽器オーバーライド（trackIndex → GM楽器キー）。空文字はプリセット適用。
		const trackInstOverrides = new Map<number, string>();

		// MMLに埋め込まれた初期 per-track 楽器があれば反映（スペース除去済み名も正規化して解決）
		if (meta.trackInstruments) {
			for (const [idxStr, name] of Object.entries(meta.trackInstruments)) {
				const idx = Number(idxStr);
				const key = resolveNameToKey(name);
				if (key) trackInstOverrides.set(idx, key);
			}
		}

		const playNote = (e: PlayNoteEvent): void => {
			// トラックインデックスを trackId から逆引き（"melody"→0, "t2"→2, "t9"→9 等）
			const { trackIdx, role } = resolveTrackIdxAndRole(e.trackId);
			const overrideKey =
				trackIdx >= 0 ? trackInstOverrides.get(trackIdx) : undefined;
			let sfInst: SoundFontInstance | undefined;
			if (overrideKey) {
				sfInst = soundFonts.get(overrideKey);
			} else {
				sfInst = resolveSoundFont(
					editorPreset,
					role,
					isAdvancedMode ? "advanced" : "simple",
				);
			}
			if (!sfInst) return;
			// SoundFont は整数MIDIノートのゾーンしか持たないため、最寄りのゾーンを鳴らして
			// 残差を detune（セント）で補正する。31平均律の音もこれで正確に鳴る。
			const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
			sfInst.play({
				ctx: audioCtx,
				destination: routeToStrip(e.trackId, sfInst.tone ?? "none"),
				pitch: midi,
				detuneCents,
				volume: e.volume,
				velocity: e.velocity,
				when: e.when,
				duration: e.duration,
			});
		};

		// 楽器変更（MML読込時など）に追従する
		let presetSelect: PresetSelectInstance | null = null;
		const handleInstrumentChange = (key: string): void => {
			editorPreset = key;
			if (presetSelect) {
				presetSelect.setValue(key);
			}
			onInstrumentChange?.(key);
		};

		// トラック個別楽器変更
		const handleTrackInstrumentChange = async (
			trackIndex: number,
			instrumentName: string,
		): Promise<void> => {
			if (!instrumentName) {
				trackInstOverrides.delete(trackIndex);
				return;
			}
			await listReady;
			const key = resolveNameToKey(instrumentName);
			if (!key) return;
			trackInstOverrides.set(trackIndex, key);
			await loadInstrument(key);
		};

		let daw: DawInstance;

		const base: DawOptions = {
			getAudioTime: () => audioCtx.currentTime,
			onResumeAudio: async () => {
				await resumeAudio();
				if (daw) {
					await loadRequiredDrums(daw.getUsedDrumKeys(), daw.getDrumFont());
				}
				await dawOverrides.onResumeAudio?.();
			},
			onPlayNote: playNote,
			onPlayDrum: playDrum,
			onExportWav: async () => {
				if (!daw) return;
				// 曲頭から書き出すため、再生中でも一旦止めて先頭（ループ開始位置）へ戻す。
				daw.stop();
				await resumeAudio();
				startWavRecording();
				await daw.play();
				// 曲が最後まで鳴り終わって playbackState が "stopped" に戻るまで待つ
				// （sequencer の onEnd → daw.stop 相当の内部処理と同じタイミング）。
				await new Promise<void>((resolve) => {
					const iv = setInterval(() => {
						if (daw.getPlaybackState() !== "playing") {
							clearInterval(iv);
							resolve();
						}
					}, 200);
				});
				const blob = await stopWavRecording();
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "dtm.wav";
				a.click();
				URL.revokeObjectURL(url);
			},
			singingVoices,
			parseMidi,
			onInstrumentChange: handleInstrumentChange,
			onTrackInstrumentChange: (idx, name) => {
				void handleTrackInstrumentChange(idx, name);
				externalOnTrackInstrumentChange?.(idx, name);
			},
			reverbAmount: options.reverbAmount,
			onReverbChange: setReverbAmount,
			reverbDecay: options.reverbDecay,
			onReverbDecayChange: setReverbDecay,
			reverbPreDelay: options.reverbPreDelay,
			onReverbPreDelayChange: setReverbPreDelay,
			delayAmount: options.delayAmount,
			onDelayChange: setDelayAmount,
			delayDivision: options.delayDivision,
			onDelayDivisionChange: (division) => delayBus.setDivision(division),
			masterCompression: options.masterCompression,
			onMasterCompressionChange: setMasterCompression,
			onBpmChange: (bpm) => delayBus.setBpm(bpm),
			fadeInSec: options.fadeInSec,
			fadeOutSec: options.fadeOutSec,
			onScheduleFade: scheduleFade,
			onTrackCompressionChange: (trackId, amount) =>
				getChannelStrip(trackId).setCompression(amount),
			onTrackWidthChange: (trackId, width) =>
				getChannelStrip(trackId).setWidth(width),
			onTrackReverbSendChange: (trackId, amount) =>
				getChannelStrip(trackId).setReverbSend(amount),
			onTrackDelaySendChange: (trackId, amount) =>
				getChannelStrip(trackId).setDelaySend(amount),
			onTrackEqLowChange: (trackId, db) =>
				getChannelStrip(trackId).setEqLow(db),
			onTrackEqMidChange: (trackId, db) =>
				getChannelStrip(trackId).setEqMid(db),
			onTrackEqHighChange: (trackId, db) =>
				getChannelStrip(trackId).setEqHigh(db),
			onTrackPanChange: (trackId, pan) =>
				getChannelStrip(trackId).setPan(panToStereo(pan)),
			clipMeter,
			...dawOverrides,
			// dawOverrides で上書きされないよう、スプレッドの後に配置して合成する
			onDrumChange: (name) => {
				if (daw) {
					void loadRequiredDrums(daw.getUsedDrumKeys(), daw.getDrumFont());
				}
				dawOverrides.onDrumChange?.(name);
			},
			// ドラム音源変更も楽器変更と同じく、再生中なら停止→ロード→再開する
			onDrumFontChange: (fontId) => {
				if (daw) {
					const wasPlaying = daw.getPlaybackState() === "playing";
					if (wasPlaying) daw.pause();
					daw.setLoading?.(true);
					void loadRequiredDrums(daw.getUsedDrumKeys(), fontId).finally(() => {
						daw.setLoading?.(false);
						if (wasPlaying) daw.play();
					});
				}
				dawOverrides.onDrumFontChange?.(fontId);
			},
		};

		// 先に DAW を組む。buildUI が target.innerHTML を総入れ替えするため、
		// プリセット選択UIの差し込みは mountDAW の「後」でなければ消えてしまう。
		daw = mountDAW(target, base);
		mountedEditors.push(daw);

		// プリセット選択UI（任意）。「全体トラック設定」パネル内の専用スロットへ差し込み、
		// 配線は mountPresetSelect に委ねる。同じ target への再マウントで重複しないよう、
		// 既存分は破棄する。スロットが無い（古いUI等）場合は従来どおり DAW の先頭へ差し込む。
		const wantPresetUI = presetUI ?? features.presetUI;
		// ローディングの暗幕はコンポーネント全体ではなくピアノロールだけに被せる。
		// buildUI 直後なので roll 要素は存在し、楽器変更では再マウントされない（＝寿命中有効）。
		const rollEl = target.querySelector<HTMLElement>('[data-dtm="roll"]');
		const presetSlot = target.querySelector<HTMLElement>(
			'[data-dtm="preset-select-slot"]',
		);
		if (wantPresetUI) {
			editorPresetSelects.get(target)?.destroy();
			presetSelect = mountPresetSelect(presetSlot ?? target, {
				getDaw: () => daw,
				getTrackIds: () => trackIds,
				value: initialPreset,
				loadingTarget: rollEl ?? target,
				position: presetSlot ? "append" : "prepend",
				// 楽器変更時、このエディタの発音解決が使うプリセットも追従させ、
				// 外部の onInstrumentChange（呼び出し側の永続化フック等）へも通知する。
				// #inst= 付きMML読込時の通知経路（handleInstrumentChange）と揃える。
				onChange: (key) => {
					handleInstrumentChange(key);
				},
			});
			editorPresetSelects.set(target, presetSelect);
		}

		// このエディタのトラック構成ぶんプリセットをロードして名前も埋め込む。
		// プリセット変更時（applyPreset）と同様、ロード中はピアノロールに暗幕を被せる。
		daw.setInstrument(initialPreset);
		const initialOverlay = rollEl ? showLoadingOverlay(rollEl) : null;
		daw.setLoading?.(true);
		void loadPreset(
			initialPreset,
			trackIds,
			isAdvancedMode ? "advanced" : "simple",
		).finally(() => {
			initialOverlay?.remove();
			daw.setLoading?.(false);
		});

		// destroy 時に、注入した select と内部参照も後始末する。
		const destroy = (): void => {
			daw.destroy();
			presetSelect?.destroy();
			if (editorPresetSelects.get(target) === presetSelect)
				editorPresetSelects.delete(target);
			const i = mountedEditors.indexOf(daw);
			if (i >= 0) mountedEditors.splice(i, 1);
		};
		return {
			...daw,
			setInstrument: (name: string) => {
				daw.setInstrument(name);
				editorPreset = name;
				if (presetSelect) {
					presetSelect.setValue(name);
				}
			},
			applyTrackInstrument: (
				trackIndex: number,
				instrumentName: string,
			): void => {
				daw.applyTrackInstrument(trackIndex, instrumentName);
				// SF2 解決用のオーバーライドも更新する
				void handleTrackInstrumentChange(trackIndex, instrumentName);
			},
			destroy,
		};
	};

	// モード切替UI（SIMPLE/ADVANCED）。編集UIのマウント／再マウントごと面倒を見る。
	const mountModeSwitch = (
		target: HTMLElement,
		opts: ModeSwitchOptions,
	): ModeSwitchInstance => {
		const doc = target.ownerDocument;
		const tracksFor =
			opts.tracksFor ??
			((m: DawMode) => (m === "advanced" ? TRACKS_ADVANCED : TRACKS_SIMPLE));
		const labels: Record<DawMode, string> = {
			simple: opts.labels?.simple ?? "初心者",
			advanced: opts.labels?.advanced ?? "上級者",
		};
		const editorOptionsFor = (mode: DawMode): MountEditorOptions =>
			typeof opts.editorOptions === "function"
				? opts.editorOptions(mode)
				: (opts.editorOptions ?? {});

		let currentMode: DawMode = opts.mode ?? "simple";
		let daw: DawInstance | null = null;

		// ── UI 構築 ──
		const wrapper = doc.createElement("div");
		wrapper.className = opts.className ?? "dtm-controlbar";
		if (opts.label !== null) {
			const lab = doc.createElement("span");
			lab.className = "dtm-controlbar-label";
			lab.textContent = opts.label ?? "モード";
			wrapper.appendChild(lab);
		}
		const seg = doc.createElement("div");
		seg.className = "dtm-modeseg";
		const buttons = new Map<DawMode, HTMLButtonElement>();
		const updateButtons = (): void => {
			for (const [mode, btn] of buttons)
				btn.classList.toggle("dtm-modebtn--active", mode === currentMode);
		};
		for (const mode of ["simple", "advanced"] as const) {
			const btn = doc.createElement("button");
			btn.type = "button";
			btn.className = "dtm-modebtn";
			btn.textContent = labels[mode];
			btn.addEventListener("click", () => setMode(mode));
			seg.appendChild(btn);
			buttons.set(mode, btn);
		}
		wrapper.appendChild(seg);

		// wrapper を target へ（再）挿入する。target と editorTarget が同一要素のとき、
		// mountEditor 内の buildUI が target.innerHTML を総入れ替えして wrapper を消すため、
		// マウントの「後」に毎回呼んで貼り直す。別要素なら単に位置が保たれるだけで無害。
		const attachWrapper = (): void => {
			if (opts.position === "prepend")
				target.insertBefore(wrapper, target.firstChild);
			else target.appendChild(wrapper);
		};

		// ── マウント／アンマウント ──
		const doMount = (mode: DawMode, mml?: string): void => {
			const editorOpts = editorOptionsFor(mode);
			daw = mountEditor(opts.editorTarget, {
				...editorOpts,
				mode,
				tracks: tracksFor(mode),
				initialMML: mml ?? editorOpts.initialMML,
				onRequestAdvancedMode: (pendingMml, applyMidi) => {
					doUnmount();
					currentMode = "advanced";
					updateButtons();
					opts.onChange?.("advanced");
					doMount("advanced", pendingMml);
					if (applyMidi && daw) applyMidi(daw);
				},
			});
			// buildUI による wipe の後に貼り直す（同一要素共有でも mode UI が残る）。
			attachWrapper();
			opts.onMount?.(daw, mode);
		};
		const doUnmount = (): string | undefined => {
			if (!daw) return undefined;
			const mml = daw.getMML().full;
			opts.onUnmount?.(daw, currentMode);
			daw.destroy();
			daw = null;
			return mml;
		};

		function setMode(mode: DawMode): void {
			if (mode === currentMode && daw) return;
			const carried = doUnmount();
			currentMode = mode;
			updateButtons();
			opts.onChange?.(mode);
			// 初回（carried===undefined）は editorOptions.initialMML、以降は引き継いだMML。
			doMount(mode, carried);
		}

		// 初期マウント（onChange は呼ばない）。wrapper の挿入は doMount→attachWrapper が行う。
		updateButtons();
		doMount(currentMode, editorOptionsFor(currentMode).initialMML);

		const instance: ModeSwitchInstance = {
			element: wrapper,
			getDaw: () => daw,
			getMode: () => currentMode,
			setMode,
			destroy: () => {
				doUnmount();
				wrapper.remove();
				const i = mountedModeSwitches.indexOf(instance);
				if (i >= 0) mountedModeSwitches.splice(i, 1);
			},
		};
		mountedModeSwitches.push(instance);
		return instance;
	};

	const mountPlayer = (
		target: HTMLElement,
		mml: string,
		opts: MountPlayerOptions = {},
	): MmlPlayerInstance => {
		// MMLの #inst= からこの再生UI専属のプリセットを決め、そのプリセットの楽器を用意する。
		// 楽器解決もこのプリセットに固定するため、他の再生UI/編集UIと音源を取り合わない。
		const parsed = parseMML(mml, {});
		const meta = parsed.meta ?? {};
		const playerPreset =
			meta.instrument && INSTRUMENT_PRESETS[meta.instrument]
				? meta.instrument
				: defaultPreset;

		const isAdvancedMode = meta.mode === "advanced";

		// MML内の演奏トラックインデックスから、ロード対象の trackId リストを生成
		const trackIndices = [
			...new Set(parsed.placements.map((p) => p.trackIndex)),
		];
		const trackIds = trackIndices.map((idx) =>
			getRoleForTrackIndex(idx, isAdvancedMode ? "advanced" : "simple"),
		);
		const loadTrackIds = trackIds.length > 0 ? trackIds : [...TRACK_ROLES];

		// per-track 楽器オーバーライド（trackIndex → SF key）を構築・ロードする
		const playerTrackInstKeys = new Map<number, string>();
		const loadPlayerTrackInstruments = async (): Promise<void> => {
			if (!meta.trackInstruments) return;
			await listReady;
			for (const [idxStr, name] of Object.entries(meta.trackInstruments)) {
				const key = resolveNameToKey(name);
				if (!key) continue;
				playerTrackInstKeys.set(Number(idxStr), key);
				await loadInstrument(key);
			}
		};

		void Promise.all([
			loadPreset(
				playerPreset,
				loadTrackIds,
				isAdvancedMode ? "advanced" : "simple",
			),
			loadPlayerTrackInstruments(),
		]);

		// 再生専用ビューの @n（数値トラック）→ 役割 → このプリセットの楽器。
		// per-track オーバーライドがあればそちらを優先する。
		// ロード未完了の間は undefined（無音）になるだけで、別楽器で鳴ることはない。
		const applyTrackStrip = createTrackStripApplier(meta);

		const playPlayerNote = (e: PlayNoteEvent): void => {
			const idx = Number(e.trackId);
			applyTrackStrip(e.trackId, idx);
			const overrideKey = playerTrackInstKeys.get(idx);
			let sfInst: SoundFontInstance | undefined;
			if (overrideKey) {
				sfInst = soundFonts.get(overrideKey);
			} else {
				const role = getRoleForTrackIndex(
					idx,
					isAdvancedMode ? "advanced" : "simple",
				);
				sfInst = resolveSoundFont(
					playerPreset,
					role,
					isAdvancedMode ? "advanced" : "simple",
				);
			}
			if (!sfInst) return;
			// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
			// 残差を detune で補正する（units のままだとゾーンが無く無音になる）。
			const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
			sfInst.play({
				ctx: audioCtx,
				destination: routeToStrip(e.trackId, sfInst.tone ?? "none"),
				pitch: midi,
				detuneCents,
				volume: e.volume,
				velocity: e.velocity,
				when: e.when,
				duration: e.duration,
			});
		};
		const player = mountMmlPlayer(target, mml, {
			getAudioTime: () => audioCtx.currentTime,
			onResumeAudio: async () => {
				await resumeAudio();
				if (meta.drum) {
					await loadRequiredDrums(
						getDrumPatternKeys(
							meta.drum,
							resolveDrumPatterns(opts.drumPatterns ?? options.drumPatterns),
						),
						meta.drumFont || "FluidR3_GM_sf2_file:0",
					);
				}
				await opts.onResumeAudio?.();
			},
			onPlayNote: playPlayerNote,
			onPlayDrum: playDrum,
			singingVoices,
			...opts,
		});
		mountedPlayers.push(player);
		// destroy 時に内部リストからも外す（多数の再生UIを生成し続けても溜まらないように）。
		const destroy = (): void => {
			player.destroy();
			const i = mountedPlayers.indexOf(player);
			if (i >= 0) mountedPlayers.splice(i, 1);
		};
		return { ...player, destroy };
	};

	const play = (
		mml: string,
		opts: Omit<
			PlayMmlOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		> = {},
	): MmlPlayback => {
		const parsed = parseMML(mml, {});
		const meta = parsed.meta ?? {};
		const playerPreset =
			meta.instrument && INSTRUMENT_PRESETS[meta.instrument]
				? meta.instrument
				: defaultPreset;

		const isAdvancedMode = meta.mode === "advanced";

		const trackIndices = [
			...new Set(parsed.placements.map((p) => p.trackIndex)),
		];
		const trackIds = trackIndices.map((idx) =>
			getRoleForTrackIndex(idx, isAdvancedMode ? "advanced" : "simple"),
		);
		const loadTrackIds = trackIds.length > 0 ? trackIds : [...TRACK_ROLES];

		const playerTrackInstKeys = new Map<number, string>();
		const loadPlayerTrackInstruments = async (): Promise<void> => {
			if (!meta.trackInstruments) return;
			await listReady;
			for (const [idxStr, name] of Object.entries(meta.trackInstruments)) {
				const key = resolveNameToKey(name);
				if (!key) continue;
				playerTrackInstKeys.set(Number(idxStr), key);
				await loadInstrument(key);
			}
		};

		void Promise.all([
			loadPreset(
				playerPreset,
				loadTrackIds,
				isAdvancedMode ? "advanced" : "simple",
			),
			loadPlayerTrackInstruments(),
		]);

		const applyTrackStrip = createTrackStripApplier(meta);

		const playPlayerNote = (e: PlayNoteEvent): void => {
			const { trackIdx } = resolveTrackIdxAndRole(e.trackId);
			applyTrackStrip(e.trackId, trackIdx);
			const overrideKey = playerTrackInstKeys.get(trackIdx);
			let sfInst: SoundFontInstance | undefined;
			if (overrideKey) {
				sfInst = soundFonts.get(overrideKey);
			} else {
				const roleFromIdx = getRoleForTrackIndex(
					trackIdx,
					isAdvancedMode ? "advanced" : "simple",
				);
				sfInst = resolveSoundFont(
					playerPreset,
					roleFromIdx,
					isAdvancedMode ? "advanced" : "simple",
				);
			}
			if (!sfInst) return;
			// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
			// 残差を detune で補正する（units をそのまま渡すとゾーンが無く無音になる）。
			const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
			sfInst.play({
				ctx: audioCtx,
				destination: routeToStrip(e.trackId, sfInst.tone ?? "none"),
				pitch: midi,
				detuneCents,
				volume: e.volume,
				velocity: e.velocity,
				when: e.when,
				duration: e.duration,
			});
		};

		return playMML(mml, {
			...opts,
			audioContext: audioCtx,
			destination: masterGain,
			synth: false,
			onPlayNote: playPlayerNote,
			onPlayDrum: playDrum,
			onResumeAudio: async () => {
				await resumeAudio();
				if (meta.drum) {
					await loadRequiredDrums(
						getDrumPatternKeys(
							meta.drum,
							resolveDrumPatterns(opts.drumPatterns ?? options.drumPatterns),
						),
					);
				}
				await opts.onResumeAudio?.();
			},
		});
	};

	const playSingingMMLInstance = (
		mml: string,
		opts: Omit<
			PlaySingingMmlOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		> = {},
	): Promise<MmlPlayback> => {
		const parsed = parseMML(mml, {});
		const meta = parsed.meta ?? {};
		const playerPreset =
			meta.instrument && INSTRUMENT_PRESETS[meta.instrument]
				? meta.instrument
				: defaultPreset;

		const isAdvancedMode =
			meta.mode === "advanced" ||
			parsed.placements.some((p) => p.trackIndex >= 4);

		const trackIndices = [
			...new Set(parsed.placements.map((p) => p.trackIndex)),
		];
		const trackIds = trackIndices.map((idx) =>
			getRoleForTrackIndex(idx, isAdvancedMode ? "advanced" : "simple"),
		);
		const loadTrackIds = trackIds.length > 0 ? trackIds : [...TRACK_ROLES];

		const playerTrackInstKeys = new Map<number, string>();
		const loadPlayerTrackInstruments = async (): Promise<void> => {
			if (!meta.trackInstruments) return;
			await listReady;
			for (const [idxStr, name] of Object.entries(meta.trackInstruments)) {
				const key = resolveNameToKey(name);
				if (!key) continue;
				playerTrackInstKeys.set(Number(idxStr), key);
				await loadInstrument(key);
			}
		};

		void Promise.all([
			loadPreset(
				playerPreset,
				loadTrackIds,
				isAdvancedMode ? "advanced" : "simple",
			),
			loadPlayerTrackInstruments(),
		]);

		const applyTrackStrip = createTrackStripApplier(meta);

		const playPlayerNote = (e: PlayNoteEvent): void => {
			const { trackIdx } = resolveTrackIdxAndRole(e.trackId);
			applyTrackStrip(e.trackId, trackIdx);
			const overrideKey = playerTrackInstKeys.get(trackIdx);
			let sfInst: SoundFontInstance | undefined;
			if (overrideKey) {
				sfInst = soundFonts.get(overrideKey);
			} else {
				const roleFromIdx = getRoleForTrackIndex(
					trackIdx,
					isAdvancedMode ? "advanced" : "simple",
				);
				sfInst = resolveSoundFont(
					playerPreset,
					roleFromIdx,
					isAdvancedMode ? "advanced" : "simple",
				);
			}
			if (!sfInst) return;
			// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
			// 残差を detune で補正する（units をそのまま渡すとゾーンが無く無音になる）。
			const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
			sfInst.play({
				ctx: audioCtx,
				destination: routeToStrip(e.trackId, sfInst.tone ?? "none"),
				pitch: midi,
				detuneCents,
				volume: e.volume,
				velocity: e.velocity,
				when: e.when,
				duration: e.duration,
			});
		};

		return playSingingMML(mml, {
			...opts,
			audioContext: audioCtx,
			destination: masterGain,
			synth: false,
			singingVoices,
			onPlayNote: playPlayerNote,
			onPlayDrum: playDrum,
			onResumeAudio: async () => {
				await resumeAudio();
				if (meta.drum) {
					await loadRequiredDrums(
						getDrumPatternKeys(
							meta.drum,
							resolveDrumPatterns(opts.drumPatterns ?? options.drumPatterns),
						),
					);
				}
				await opts.onResumeAudio?.();
			},
		});
	};

	const playNoteEvent = (e: PlayNoteEvent): void => {
		const { role } = resolveTrackIdxAndRole(e.trackId);
		let sfInst = resolveSoundFont(defaultPreset, role, "simple");
		if (!sfInst) {
			void loadPreset(defaultPreset, [role], "simple");
			sfInst = resolveSoundFont(defaultPreset, role, "simple");
		}
		if (!sfInst) return;
		// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
		// 残差を detune で補正する（units をそのまま渡すとゾーンが無く無音になる）。
		const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
		sfInst.play({
			ctx: audioCtx,
			destination: routeToStrip(e.trackId, sfInst.tone ?? "none"),
			pitch: midi,
			detuneCents,
			volume: e.volume,
			velocity: e.velocity,
			when: e.when,
			duration: e.duration,
		});
	};

	const playDrumEvent = (e: PlayDrumEvent): void => {
		playDrum(e);
	};

	const playNote = async (options: {
		/** ピッチ。単位は units（1/372オクターブ）。`pitchV1ToUnits` でMIDI番号から変換できる。 */
		pitchUnits: Units;
		volume?: number;
		duration?: number;
		instrument?: string;
	}): Promise<void> => {
		await listReady;
		const key = options.instrument
			? resolveNameToKey(options.instrument)
			: undefined;
		const sfKey = key ?? nameToKey[INSTRUMENT_PRESETS[defaultPreset].melody];
		if (!sfKey) return;
		await loadInstrument(sfKey);
		const sfInst = soundFonts.get(sfKey);
		if (!sfInst) return;

		const vol = options.volume ?? 80;
		const dur = options.duration ?? 1.0;

		if (audioCtx.state === "suspended") {
			await audioCtx.resume();
		}

		// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
		// 残差を detune で補正する（units をそのまま渡すとゾーンが無く無音になる）。
		const { midi, detuneCents } = unitsToMidiDetune(options.pitchUnits);
		sfInst.play({
			ctx: audioCtx,
			destination: masterGain,
			pitch: midi,
			detuneCents,
			volume: vol / 100,
			when: 0,
			duration: dur,
		});
	};

	const playChords = (
		chordStr: string,
		opts: Omit<
			PlayChordsOptions,
			"audioContext" | "destination" | "onPlayNote" | "onPlayDrum" | "synth"
		> = {},
	): MmlPlayback => {
		const bpm = opts.bpm ?? opts.defaultBpm ?? DEFAULT_BPM;
		const chordPlacements = buildChordPlacements({
			chordStr,
			patternType: opts.patternType ?? "block",
			rootShift: opts.rootShift ?? 0,
			bpm,
			stepsPerBar: DEFAULT_STEPS_PER_BAR,
		});

		const placements = chordPlacements.map((p) => ({
			trackIndex: 3, // 伴奏トラック
			startStep: p.startStep,
			durationSteps: p.durationSteps,
			pitchUnits: p.pitchUnits,
			velocity: p.velocity,
		}));

		const playerPreset = defaultPreset;
		void loadPreset(playerPreset, ["chord"]);

		const playPlayerNote = (e: PlayNoteEvent): void => {
			const sfInst = resolveSoundFont(playerPreset, "chord");
			if (!sfInst) return;
			// SoundFont は整数MIDIノートのゾーンしか持たない。最寄りのゾーンを鳴らして
			// 残差を detune で補正する（units のままだとゾーンが無く無音になる）。
			const { midi, detuneCents } = unitsToMidiDetune(e.pitchUnits);
			sfInst.play({
				ctx: audioCtx,
				destination: routeToStrip("chord", sfInst.tone ?? "none"),
				pitch: midi,
				detuneCents,
				volume: e.volume,
				velocity: e.velocity,
				when: e.when,
				duration: e.duration,
			});
		};

		return playPlacements(placements, {
			...opts,
			audioContext: audioCtx,
			destination: masterGain,
			synth: false,
			onPlayNote: playPlayerNote,
			onPlayDrum: playDrum,
			onResumeAudio: resumeAudio,
			bpm,
			metaVolume: opts.volume ?? 100,
		});
	};

	const mountChordPlayerInstance = (
		target: HTMLElement,
		chords: string,
		options: Omit<MountChordPlayerOptions, "studio"> = {},
	): ChordPlayerInstance => {
		const player = mountChordPlayer(target, chords, {
			...options,
			audioContext: audioCtx,
			studio: {
				playChords: (chordsStr: string, playOpts: any) => {
					return playChords(chordsStr, playOpts);
				},
			},
		});
		mountedChordPlayers.push(player);

		const destroy = (): void => {
			player.destroy();
			const i = mountedChordPlayers.indexOf(player);
			if (i >= 0) mountedChordPlayers.splice(i, 1);
		};

		return {
			...player,
			destroy,
			isPlaying: player.isPlaying,
		};
	};

	const dispose = (): void => {
		for (const m of [...mountedModeSwitches]) m.destroy();
		for (const p of mountedPlayers) p.destroy();
		for (const cp of mountedChordPlayers) cp.destroy();
		for (const d of mountedEditors) d.destroy();
		mountedModeSwitches.length = 0;
		mountedPlayers.length = 0;
		mountedChordPlayers.length = 0;
		mountedEditors.length = 0;
		clipMeter.dispose();
		delayBus.dispose();
		for (const strip of channelStrips.values()) strip.dispose();
		channelStrips.clear();
		void audioCtx.close();
	};

	const setMasterVolume = (volume: number): void => {
		const g = Math.max(0, Math.min(100, volume)) / 100;
		masterGain.gain.setValueAtTime(g, audioCtx.currentTime);
	};

	let recordDestNode: MediaStreamAudioDestinationNode | null = null;

	const createMediaStreamDestination = (): MediaStreamAudioDestinationNode => {
		if (!recordDestNode) {
			recordDestNode = audioCtx.createMediaStreamDestination();
			masterGain.connect(recordDestNode);
		}
		return recordDestNode;
	};

	const getAudioStreamTrack = (): MediaStreamTrack => {
		return createMediaStreamDestination().stream.getAudioTracks()[0];
	};

	// ── WAV書き出し用の録音タップ ──
	// fadeGain（マスタバス最終段＝リバーブ/ディレイ/グルーコンプ/安全リミッター/フェード
	// すべて適用済み）から ScriptProcessorNode で生PCMを取り出す。実際の再生と全く同じ
	// 経路を通った音をそのまま記録するので、書き出し専用の別ミックス経路を持たずに済む。
	// 代わりに「等速（曲の長さ分だけ実時間がかかる）」書き出しになるトレードオフがある。
	let wavTap: {
		processor: ScriptProcessorNode;
		silentSink: GainNode;
		chunksL: Float32Array[];
		chunksR: Float32Array[];
	} | null = null;

	const startWavRecording = (): void => {
		if (wavTap) return;
		const bufferSize = 4096;
		const processor = audioCtx.createScriptProcessor(bufferSize, 2, 2);
		const chunksL: Float32Array[] = [];
		const chunksR: Float32Array[] = [];
		processor.onaudioprocess = (e) => {
			chunksL.push(new Float32Array(e.inputBuffer.getChannelData(0)));
			chunksR.push(
				new Float32Array(
					e.inputBuffer.getChannelData(
						e.inputBuffer.numberOfChannels > 1 ? 1 : 0,
					),
				),
			);
		};
		// ScriptProcessorNode はグラフ上で destination まで繋がっていないと
		// onaudioprocess が発火しないブラウザがあるため、無音ゲイン経由で destination へ流す
		// （fadeGain→destination の本来の音声出力を二重化しないよう gain=0 にする）。
		const silentSink = audioCtx.createGain();
		silentSink.gain.value = 0;
		fadeGain.connect(processor);
		processor.connect(silentSink);
		silentSink.connect(audioCtx.destination);
		wavTap = { processor, silentSink, chunksL, chunksR };
	};

	const stopWavRecording = async (): Promise<Blob> => {
		if (!wavTap) throw new Error("[dtm] startWavRecording が呼ばれていません");
		const { processor, silentSink, chunksL, chunksR } = wavTap;
		fadeGain.disconnect(processor);
		processor.disconnect(silentSink);
		silentSink.disconnect(audioCtx.destination);
		wavTap = null;
		const left = concatFloat32(chunksL);
		const right = concatFloat32(chunksR);
		return encodeWavPCM16([left, right], audioCtx.sampleRate);
	};

	return {
		audioContext: audioCtx,
		masterGain,
		createMediaStreamDestination,
		getAudioStreamTrack,
		startWavRecording,
		stopWavRecording,
		singingVoices,
		mountEditor,
		mountPlayer,
		mountChordPlayer: mountChordPlayerInstance,
		play,
		playSingingMML: playSingingMMLInstance,
		playNoteEvent,
		playDrumEvent,
		playNote,
		playChords,
		loadPreset,
		defaultPreset,
		mountPresetSelect,
		mountModeSwitch,
		setMasterVolume,
		setVolume: setMasterVolume,
		setReverbAmount,
		setReverbDecay,
		setReverbPreDelay,
		setDelayAmount,
		setMasterCompression,
		dispose,
	};
};
