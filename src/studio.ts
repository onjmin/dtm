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
import type {
	DawInstance,
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
type MidiParserModule = { parse: (bytes: unknown) => unknown };

/** 注入で差し替え可能な外部エンジン群（未指定なら CDN から取得）。 */
export type DtmStudioEngines = {
	SoundFont?: SoundFontEngine;
	SoundFont_drum?: SoundFontDrumEngine;
	SoundFont_list?: SoundFontListEngine;
	parseChord?: DawOptions["parseChord"];
	parseChords?: DawOptions["parseChords"];
	parseMidi?: DawOptions["parseMidi"];
};

/** 既定の取得元URL（rpgen3 / jsDelivr）。options.cdn で個別に上書きできる。 */
const DEFAULT_CDN = {
	soundFont: "https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs",
	soundFontDrum:
		"https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_drum.mjs",
	soundFontList:
		"https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont_list.mjs",
	parseChord: "https://rpgen3.github.io/piano/mjs/parseChord.mjs",
	parseChords: "https://rpgen3.github.io/piano/mjs/parseChords.mjs",
	midiParser: "https://cdn.jsdelivr.net/npm/midi-parser-js@4.0.4/+esm",
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

	// コード解析（任意）。失敗してもスタジオ自体は動かす。
	let parseChord = eng.parseChord;
	let parseChords = eng.parseChords;
	if (features.chord && (!parseChord || !parseChords)) {
		try {
			[parseChord, parseChords] = await Promise.all([
				parseChord ??
					importFrom<NonNullable<typeof parseChord>>(
						cdn.parseChord,
						"parseChord",
					),
				parseChords ??
					importFrom<NonNullable<typeof parseChords>>(
						cdn.parseChords,
						"parseChords",
					),
			]);
		} catch (e) {
			console.warn("[dtm] コード解析の読み込みに失敗しました", e);
		}
	}

	// MIDI解析（任意・遅延）。
	let midiParser: MidiParserModule | null = null;
	let parseMidi: DawOptions["parseMidi"];
	if (features.midi) {
		parseMidi = eng.parseMidi;
		if (!parseMidi) {
			const midiPromise = importFrom<MidiParserModule>(
				cdn.midiParser,
				"default",
			)
				.then((m) => {
					midiParser = m;
				})
				.catch((e) => console.warn("[dtm] midi-parser の読み込みに失敗", e));
			void midiPromise;
			parseMidi = (bytes) => {
				if (!midiParser) throw new Error("midi-parser not ready");
				return midiParser.parse(bytes);
			};
		}
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
	const editorPresetSelects = new WeakMap<HTMLElement, HTMLSelectElement>();
	const mountedEditors: DawInstance[] = [];
	const mountedPlayers: MmlPlayerInstance[] = [];

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
			parseChord,
			parseChords,
			parseMidi,
			onToggleRecord,
			...dawOverrides,
		};

		// プリセット選択UI（任意）。daw のマウント前に target 先頭へ差し込む。
		// 同じ target への再マウントで select が重複しないよう、既存分は除去する。
		const wantPresetUI = presetUI ?? features.presetUI;
		let select: HTMLSelectElement | null = null;
		if (wantPresetUI) {
			editorPresetSelects.get(target)?.remove();
			select = target.ownerDocument.createElement("select");
			select.className = "dtm-studio-preset";
			for (const [key, p] of Object.entries(INSTRUMENT_PRESETS)) {
				const opt = target.ownerDocument.createElement("option");
				opt.value = key;
				opt.textContent = p.displayName;
				select.appendChild(opt);
			}
			select.value =
				preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;
			target.appendChild(select);
			editorPresetSelects.set(target, select);
			select.addEventListener("change", async () => {
				if (!select) return;
				const wasPlaying = daw.getPlaybackState() === "playing";
				if (wasPlaying) {
					daw.pause();
				}
				const overlay = showLoadingOverlay(target);
				try {
					daw.setInstrument(select.value);
					await loadPreset(select.value, trackIds);
				} finally {
					overlay.remove();
					if (wasPlaying) {
						daw.play();
					}
				}
			});
		}

		const daw = mountDAW(target, base);
		mountedEditors.push(daw);

		// このエディタのトラック構成ぶんプリセットをロードして名前も埋め込む。
		const presetKey =
			preset && INSTRUMENT_PRESETS[preset] ? preset : defaultPreset;
		daw.setInstrument(presetKey);
		void loadPreset(presetKey, trackIds);

		// destroy 時に、注入した select と内部参照も後始末する。
		const destroy = (): void => {
			daw.destroy();
			select?.remove();
			if (editorPresetSelects.get(target) === select)
				editorPresetSelects.delete(target);
			const i = mountedEditors.indexOf(daw);
			if (i >= 0) mountedEditors.splice(i, 1);
		};
		return { ...daw, destroy };
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
		for (const p of mountedPlayers) p.destroy();
		for (const d of mountedEditors) d.destroy();
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
		dispose,
	};
};
