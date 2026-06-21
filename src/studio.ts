/**
 * createDtmStudio — 「import して関数1つ」で鳴る、全部入りスタジオ（Layer 3）。
 *
 * @onjmin/dtm 本体（mountDAW / mountMmlPlayer）は発音を持たない注入式設計で、
 * 楽器・ドラムの実音は外部 SoundFont（rpgen3）に委ねる。デモ index.html では
 * その配線（AudioContext・SoundFontロード・歌声ワーカー・録音・MIDI/コード解析）を
 * 手書きしていたが、本モジュールはそれを丸ごと内包する。
 *
 *   const studio = await createDtmStudio();
 *   studio.mountEditor(editorEl, { initialMML });  // 編集UI（音・歌声込み）
 *   studio.mountPlayer(playerEl, mml);             // 再生専用UI（音・歌声込み）
 *
 * 何も渡さなければ rpgen3 SoundFont を実行時にCDNから動的importし、歌声合成ワーカーは
 * パッケージ同梱の dist/voice-worker.js を用いる。エンジンやURLは options で差し替え可能。
 */

import { buildNameToKeyMapping, setupRecorder } from "./audio-config";
import { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./daw";
import { DRUM_FONT, DRUM_KEYS } from "./drum-config";
import { INSTRUMENT_PRESETS } from "./instrument-presets";
import { createSingingVoices, type SingingVoices } from "./lyrics";
import {
	type MmlPlayerInstance,
	type MmlPlayerOptions,
	mountMmlPlayer,
} from "./mml-player";
import { parseMML } from "./mml-parser";
import { showLoadingOverlay } from "./styles";
import { parseArrayBuffer } from "midi-json-parser";
import type {
	DawInstance,
	DawMode,
	DawOptions,
	PlayDrumEvent,
	PlayNoteEvent,
	TrackConfig,
} from "./types";

// ── 外部エンジンの最小型（rpgen3 SoundFont / midi-parser）──
type SoundFontInstance = {
	play: (o: {
		ctx: AudioContext;
		destination: AudioNode;
		pitch: number;
		volume: number;
		when: number;
		duration: number;
	}) => void;
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

/** 既定の取得元URL（rpgen3 / jsDelivr）。options.cdn で個別に上書きできる。 */
const DEFAULT_CDN = {
	soundFont: "https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs",
	soundFontDrum:
		"https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_drum.mjs",
	soundFontList:
		"https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_list.mjs",
} as const;

/** SoundFont の楽器名解決に使う SoundFont 名（FluidR3 GM）。 */
const SOUNDFONT_NAME = "FluidR3_GM_sf2_file";

/** 再生専用ビューの @n（数値）→ 役割キーの対応（simple モードのトラック順）。 */
const TRACK_ROLES = ["melody", "submelody", "bass", "chord"] as const;

/** 同梱ワーカー（dist/voice-worker.js）の既定URLを import.meta 基準で解決する。 */
const resolveDefaultVoiceWorkerUrl = (): string | undefined => {
	try {
		// ESMビルド（dist/index.mjs）では import.meta.url 基準で隣の voice-worker.js を
		// 解決する。Vite等のバンドラはこの new URL(...) パターンを資産として拾う。
		// NodeNext は本ファイルをCJS扱いし import.meta を禁ずるが、実体のビルドは
		// tsup(esbuild) が行い両フォーマットで import.meta.url を供給するため無視する。
		// @ts-ignore TS1470: import.meta は ESM ビルド出力でのみ評価される
		return new URL("./voice-worker.js", import.meta.url).href;
	} catch {
		return undefined;
	}
};

export type DtmStudioOptions = {
	/** 既存の AudioContext を使う（未指定なら内部生成）。 */
	audioContext?: AudioContext;
	/** マスター音量 0-1（楽器・歌声）。既定 1。 */
	masterVolume?: number;
	/** ドラム音量 0-1。既定 1。 */
	drumVolume?: number;
	/**
	 * 歌声合成ワーカー（voice-worker.js）のURL。
	 * 既定はパッケージ同梱の dist/voice-worker.js。
	 * `null` を渡すとワーカーを使わず klatt のみ（koe音源はメインスレッド合成）。
	 */
	voiceWorkerUrl?: string | null;
	/** 初期の楽器プリセットキー（INSTRUMENT_PRESETS）。既定 "retro_game"。 */
	defaultPreset?: string;
	/** 外部エンジンの注入（指定したものは CDN 取得をスキップ）。 */
	engines?: DtmStudioEngines;
	/** CDN URL の上書き。 */
	cdn?: Partial<typeof DEFAULT_CDN>;
	/** 有効化する機能。既定はすべて true。 */
	features?: {
		/** 録音→WAVダウンロード（編集UIの録音ボタン）。 */
		recorder?: boolean;
		/** MIDIファイル読み込み。 */
		midi?: boolean;
		/** コード入力（和音）。 */
		chord?: boolean;
		/** 編集UIに楽器プリセット選択UIを差し込む。 */
		presetUI?: boolean;
	};
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
	/** AudioContext を閉じ、生成物を破棄する。 */
	dispose: () => void;
};

/** CDN から名前付きエクスポートを動的importする（バンドラには委ねない）。 */
const importFrom = async <T>(url: string, name: string): Promise<T> => {
	const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
	return (mod[name] ?? mod.default) as T;
};

/**
 * 全部入りスタジオを生成する。SoundFontエンジン・ドラム音源・楽器プリセットの
 * 初期ロードまで待ってから解決するため、await して使う。
 */
export const createDtmStudio = async (
	options: DtmStudioOptions = {},
): Promise<DtmStudio> => {
	const cdn = { ...DEFAULT_CDN, ...options.cdn };
	const features = {
		recorder: true,
		midi: true,
		chord: true,
		presetUI: true,
		...options.features,
	};

	// ── AudioContext とゲイン段 ──
	const audioCtx = options.audioContext ?? new AudioContext();
	const masterGain = audioCtx.createGain();
	masterGain.gain.value = options.masterVolume ?? 1;
	masterGain.connect(audioCtx.destination);
	const drumGain = audioCtx.createGain();
	drumGain.gain.value = options.drumVolume ?? 1;
	drumGain.connect(audioCtx.destination);

	const resumeAudio = (): void => {
		if (audioCtx.state === "suspended") void audioCtx.resume();
	};

	// ── 外部エンジン（注入優先、無ければ CDN）──
	const eng = options.engines ?? {};
	const [SoundFont, SoundFont_drum, SoundFont_list] = await Promise.all([
		eng.SoundFont ?? importFrom<SoundFontEngine>(cdn.soundFont, "SoundFont"),
		eng.SoundFont_drum ??
			importFrom<SoundFontDrumEngine>(cdn.soundFontDrum, "SoundFont_drum"),
		eng.SoundFont_list ??
			importFrom<SoundFontListEngine>(cdn.soundFontList, "SoundFont_list"),
	]);

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
	const singingVoices = createSingingVoices(audioCtx, masterGain, {
		voiceWorkerUrl,
	});

	// ── 録音 ──
	const recorder = features.recorder
		? setupRecorder(audioCtx, masterGain, drumGain)
		: null;

	const downloadWav = (): void => {
		if (!recorder) return;
		const recordedData = recorder.getRecordedData();
		const ch = recordedData.length;
		const len = recordedData[0].length;
		if (len === 0) return;
		const bufSize = recordedData[0][0].length;
		const wave = new Float32Array(ch * len * bufSize);
		let idx = 0;
		for (let i = 0; i < len; i++)
			for (let j = 0; j < bufSize; j++)
				for (let k = 0; k < ch; k++) wave[idx++] = recordedData[k][i][j];
		const sampleRate = audioCtx.sampleRate;
		const channels = 2;
		const bitRate = 16;
		const step = bitRate / 8;
		const blockSize = channels * step;
		const byteLen = wave.length * step;
		const view = new DataView(new ArrayBuffer(44 + byteLen));
		const ws = (off: number, s: string): void => {
			for (let i = 0; i < s.length; i++)
				view.setUint8(off + i, s.charCodeAt(i));
		};
		ws(0, "RIFF");
		view.setUint32(4, 32 + byteLen, true);
		ws(8, "WAVE");
		ws(12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, channels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, sampleRate * blockSize, true);
		view.setUint16(32, blockSize, true);
		view.setUint16(34, bitRate, true);
		ws(36, "data");
		view.setUint32(40, byteLen, true);
		const clamp = (n: number, a: number, b: number): number =>
			Math.max(a, Math.min(b, n));
		let off = 44;
		for (let i = 0; i < wave.length; i++, off += step)
			view.setInt16(
				off,
				clamp(Math.round(wave[i] * 0x8000), -0x8000, 0x7fff),
				true,
			);
		const blob = new Blob([view], { type: "audio/wav" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "record.wav";
		a.click();
		URL.revokeObjectURL(url);
	};

	const onToggleRecord = recorder
		? (): void => {
				if (recorder.isRecording()) {
					recorder.stopRecording();
					downloadWav();
				} else {
					recorder.clearRecordedData();
					recorder.startRecording();
				}
			}
		: undefined;

	// ── SoundFont（楽器）ロード ──
	// SoundFont.toURL は SoundFont_list の初期化完了後に有効になる。
	const listReady = new Promise<void>((resolve) => {
		SoundFont_list.init();
		SoundFont_list.onload(() => resolve());
	});

	// ドラム音源ロード（GMキー一式）。
	const drumReady = (async () => {
		try {
			await SoundFont_drum.load({
				ctx: audioCtx,
				font: DRUM_FONT,
				id: "0",
				keys: Object.values(DRUM_KEYS),
			});
		} catch (e) {
			console.error("[dtm] ドラム音源の読み込みに失敗", e);
		}
	})();

	let nameToKey: Record<string, string> = {};
	const soundFonts = new Map<string, SoundFontInstance>();
	// trackId ごとに現在ロード済みの楽器キーを覚えておき、同一キーの再ロードを避ける
	// （スタジオ生成時の先読みと mountEditor のロードが重複するのを防ぐ）。
	const loadedKeyByTrack = new Map<string, string>();

	const loadSoundFont = async (
		instrumentKey: string,
		trackId: string,
	): Promise<void> => {
		if (loadedKeyByTrack.get(trackId) === instrumentKey) return;
		try {
			const fullName = `${instrumentKey}_${SOUNDFONT_NAME}`;
			soundFonts.set(
				trackId,
				await SoundFont.load({
					ctx: audioCtx,
					fontName: `_tone_${fullName}`,
					url: SoundFont.toURL(fullName),
				}),
			);
			loadedKeyByTrack.set(trackId, instrumentKey);
		} catch (e) {
			console.error(`[dtm] 楽器 "${instrumentKey}" の読み込みに失敗`, e);
		}
	};

	const defaultPreset = options.defaultPreset ?? "retro_game";

	/** トラックの役割から楽器名を引く（役割キー以外は melody を使う＝上級者モード互換）。 */
	const instrumentNameFor = (
		preset: (typeof INSTRUMENT_PRESETS)[string],
		trackId: string,
	): string => (preset as Record<string, string>)[trackId] ?? preset.melody;

	const loadPreset = async (
		presetKey: string,
		trackIds: string[] = [...TRACK_ROLES],
	): Promise<void> => {
		const preset = INSTRUMENT_PRESETS[presetKey];
		if (!preset) return;
		await listReady;
		await Promise.all(
			trackIds.map((trackId) => {
				const key = nameToKey[instrumentNameFor(preset, trackId)];
				return key ? loadSoundFont(key, trackId) : Promise.resolve();
			}),
		);
	};

	// 楽器プリセット変更の共通処理（編集UI内蔵・mountPresetSelect 双方で使う）。
	// 再生中なら一旦停止し、ロード中はローディング表示、完了後に同じ位置から再開する。
	const applyPreset = async (
		daw: DawInstance,
		presetKey: string,
		trackIds: string[],
		loadingTarget?: HTMLElement | null,
	): Promise<void> => {
		const wasPlaying = daw.getPlaybackState() === "playing";
		if (wasPlaying) daw.pause();
		const overlay = loadingTarget ? showLoadingOverlay(loadingTarget) : null;
		daw.setLoading?.(true);
		try {
			daw.setInstrument(presetKey);
			await loadPreset(presetKey, trackIds);
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
			lab.textContent = opts.label ?? "INSTRUMENT";
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
			try {
				await applyPreset(daw, key, trackIds, opts.loadingTarget);
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

	// ── 発音ハンドラ（編集UI・再生UI 共通の楽器/ドラム） ──
	const playNote = (e: PlayNoteEvent): void => {
		const sf = soundFonts.get(e.trackId);
		if (!sf) return;
		sf.play({
			ctx: audioCtx,
			destination: masterGain,
			pitch: e.pitch,
			volume: e.volume,
			when: e.when,
			duration: e.duration,
		});
	};
	const playDrum = (e: PlayDrumEvent): void => {
		if (!SoundFont_drum.font) return;
		SoundFont_drum.play({
			ctx: audioCtx,
			destination: drumGain,
			pitch: e.pitch,
			volume: e.velocity,
			when: e.when,
			duration: e.duration,
		});
	};
	// 再生専用ビューの @n（数値トラック）→ 読み込み済み SoundFont を引く。
	const sfForPlayerTrack = (trackId: string): SoundFontInstance | undefined =>
		soundFonts.get(TRACK_ROLES[Number(trackId)] ?? "") ??
		soundFonts.get(`t${trackId}`);
	const playPlayerNote = (e: PlayNoteEvent): void => {
		const sf = sfForPlayerTrack(e.trackId);
		if (!sf) return;
		sf.play({
			ctx: audioCtx,
			destination: masterGain,
			pitch: e.pitch,
			volume: e.volume,
			when: e.when,
			duration: e.duration,
		});
	};

	// ── マウント ──
	const editorPresetSelects = new WeakMap<HTMLElement, PresetSelectInstance>();
	const mountedEditors: DawInstance[] = [];
	const mountedPlayers: MmlPlayerInstance[] = [];
	const mountedModeSwitches: ModeSwitchInstance[] = [];

	const mountEditor = (
		target: HTMLElement,
		opts: MountEditorOptions = {},
	): DawInstance => {
		const { preset, presetUI, ...dawOverrides } = opts;
		const tracks: TrackConfig[] = dawOverrides.tracks ?? TRACKS_SIMPLE;
		const trackIds = tracks.map((t) => t.id);

		const base: DawOptions = {
			getAudioTime: () => audioCtx.currentTime,
			onResumeAudio: resumeAudio,
			onPlayNote: playNote,
			onPlayDrum: playDrum,
			singingVoices,
			parseMidi,
			onToggleRecord,
			...dawOverrides,
		};

		// 先に DAW を組む。buildUI が target.innerHTML を総入れ替えするため、
		// プリセット選択UIの差し込みは mountDAW の「後」でなければ消えてしまう。
		const daw = mountDAW(target, base);
		mountedEditors.push(daw);

		const presetKey =
			preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;

		// プリセット選択UI（任意）。DAW の先頭へ差し込み、配線は mountPresetSelect に委ねる。
		// 同じ target への再マウントで重複しないよう、既存分は破棄する。
		const wantPresetUI = presetUI ?? features.presetUI;
		let presetSelect: PresetSelectInstance | null = null;
		if (wantPresetUI) {
			editorPresetSelects.get(target)?.destroy();
			presetSelect = mountPresetSelect(target, {
				getDaw: () => daw,
				getTrackIds: () => trackIds,
				value: presetKey,
				loadingTarget: target,
				position: "prepend",
			});
			editorPresetSelects.set(target, presetSelect);
		}

		// このエディタのトラック構成ぶんプリセットをロードして名前も埋め込む。
		daw.setInstrument(presetKey);
		daw.setLoading?.(true);
		void loadPreset(presetKey, trackIds).finally(() => {
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
		return { ...daw, destroy };
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
			simple: opts.labels?.simple ?? "シンプル",
			advanced: opts.labels?.advanced ?? "アドバンス",
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
			lab.textContent = opts.label ?? "MODE";
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

		// ── マウント／アンマウント ──
		const doMount = (mode: DawMode, mml?: string): void => {
			const editorOpts = editorOptionsFor(mode);
			daw = mountEditor(opts.editorTarget, {
				...editorOpts,
				mode,
				tracks: tracksFor(mode),
				initialMML: mml ?? editorOpts.initialMML,
			});
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

		if (opts.position === "prepend")
			target.insertBefore(wrapper, target.firstChild);
		else target.appendChild(wrapper);

		// 初期マウント（onChange は呼ばない）。
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
		// MMLの #inst= があれば、そのプリセットを用意してから再生する。
		const meta = parseMML(mml, {}).meta ?? {};
		if (meta.instrument && INSTRUMENT_PRESETS[meta.instrument]) {
			void loadPreset(meta.instrument);
		}
		const player = mountMmlPlayer(target, mml, {
			getAudioTime: () => audioCtx.currentTime,
			onResumeAudio: resumeAudio,
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

	const dispose = (): void => {
		for (const m of [...mountedModeSwitches]) m.destroy();
		for (const p of mountedPlayers) p.destroy();
		for (const d of mountedEditors) d.destroy();
		mountedModeSwitches.length = 0;
		mountedPlayers.length = 0;
		mountedEditors.length = 0;
		void audioCtx.close();
	};

	return {
		audioContext: audioCtx,
		singingVoices,
		mountEditor,
		mountPlayer,
		loadPreset,
		defaultPreset,
		mountPresetSelect,
		mountModeSwitch,
		dispose,
	};
};
