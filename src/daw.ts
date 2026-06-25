/**
 * mountDAW — 1関数でマウントできるモバイルファーストDAWコンポーネント（Layer 2）。
 *
 * 発音は注入フック（onPlayNote / onPlayDrum）へ委譲し、ライブラリ自体は音を出さない。
 * MIDI/コード解析も注入（parseMidi / parseChord / parseChords）。未注入なら該当UIを隠す。
 */

import { buildChordPlacements, type ChordPatternType } from "./chords";
import { buildUI } from "./daw-ui";
import { DRUM_PATTERNS } from "./drum-config";
import { GM_INSTRUMENT_NAMES } from "./audio-config";
import { icon } from "./icons";
import { INSTRUMENT_PRESETS } from "./instrument-presets";
import {
	KOE_VOICEBANK_LABELS,
	KOE_VOICEBANK_TERMS,
	KOE_VOICEBANKS,
	MAX_VOCAL_VOLUME,
	normalizeLyrics,
	panToStereo,
	type StreamVoiceTrack,
	VOICE_IMAGE_KEY,
	vocalVolumeToGain,
} from "./lyrics";
import {
	applyHarmonicFilter,
	applyMonophonic,
	generateRandomPattern,
	shiftNotes,
} from "./macros";
import {
	analyzeMidiTracks,
	exportMIDI as exportMIDIBlob,
	extractMidiPlacements,
	extractMidiPlacementsByTrack,
} from "./midi-io";
import { decomposeToMonophonic, isChordHeavyTrack, MMLCore } from "./mml-core";
import { MML_INFO_HTML } from "./mml-info";
import { formatMmlMeta, parseMML } from "./mml-parser";
import { mountMmlPlayer } from "./mml-player";
import {
	drawGrid,
	drawNotes,
	drawSelectedNotes,
	getDrawOffset,
	getGridCanvas,
	getGridContext,
	getGridPosition,
	getHeaderCanvas,
	init,
	setDrawOffset,
} from "./renderer";
import { createSequencer, type Sequencer } from "./sequencer";
import { injectStyles, showLoadingOverlay } from "./styles";
import type {
	DawInstance,
	DawMode,
	DawOptions,
	DawViewState,
	LyricTrack,
	Note,
	PlaybackState,
	RenderConfig,
	ToolMode,
	TrackConfig,
} from "./types";
import {
	DEFAULT_BPM,
	DEFAULT_GATE,
	DEFAULT_PAN,
	DEFAULT_VOCAL_VOLUME,
	MML_END_MARKER,
} from "./types";
import { VOICE_IMAGES } from "./voice-images";

const CHORD_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. 基本の書き方</h4>
  <p>コード名（和音記号）を縦線 <code>|</code>、スペース、またはカンマで区切って入力します。縦線で区切ると1小節ごとの配置になります。</p>
  <pre>例: C | G | Am | F</pre>
  <p style="margin-top:4px;"><small>コード進行を自分で考えるのが難しいときは、コード進行の共有サイト（例: <a href="https://rechord.cc/scores" target="_blank" rel="noopener">rechord.cc</a>）から好きな進行を探してコピペするのも手です。区切り文字（<code>|</code> / スペース / カンマ）だけ上の形式に合わせれば、そのまま使えます。</small></p>

  <h4>2. 1小節に複数コードを入れる</h4>
  <p>小節の区切り（縦線 <code>|</code>）の中に、スペース区切りでコードを並べます。等間隔に配置されます。</p>
  <pre>例: C G | Am F</pre>
  <p style="margin-top:4px;"><small>（1小節目：前半C・後半G、2小節目：前半Am・後半F）</small></p>

  <h4>3. 対応コード名</h4>
  <ul>
    <li>メジャー / マイナー: <code>C</code>, <code>Dm</code>, <code>Am</code> など</li>
    <li>セブンス: <code>C7</code>, <code>Am7</code>, <code>FM7</code> など</li>
    <li>その他: <code>Csus4</code>, <code>Cdim</code>, <code>Caug</code>, <code>Cadd9</code> など</li>
  </ul>

  <h4>4. 演奏パターン</h4>
  <ul>
    <li><strong>ブロック</strong>: 和音の構成音をすべて同時に伸ばして演奏します。</li>
    <li><strong>アルペジオ</strong>: 和音の構成音を低い順に分散して演奏します。</li>
    <li><strong>アルペジオ（ジャラーン）</strong>: 素早くアルペジオを鳴らします。</li>
    <li><strong>裏打ち</strong>: 各拍の裏（8分裏）のタイミングでコードを刻みます。</li>
    <li><strong>ヤツメ穴</strong>: リズミカルなピコピコゲーム風の伴奏パターンです。</li>
    <li><strong>交互奏</strong>: ルート音（低音）とコード構成音（高音）を交互に刻みます。</li>
  </ul>
</div>
`;

const MIDI_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. MIDIファイルとは</h4>
  <p>「どの音を・いつ・どのくらいの長さで鳴らすか」を記録した、演奏データのファイル（拡張子 <code>.mid</code> / <code>.midi</code>）です。音そのものではなく楽譜に近いデータなので、読み込んでそのまま編集できます。</p>

  <h4>2. 読み込みのしかた</h4>
  <ul>
    <li>「ファイルを選択」から <code>.mid</code> ファイルを選びます。</li>
    <li>ファイル内のトラック一覧が出るので、取り込みたいトラックを選びます。</li>
    <li>「読込」を押すと反映されます。</li>
  </ul>

  <h4>3. モードによる取り込み方の違い</h4>
  <ul>
    <li><strong>SIMPLE</strong>: 各トラックの特徴から、メロディー・サブメロ・ベース・伴奏の4つの役割に自動で振り分けられます。</li>
    <li><strong>ADVANCED</strong>: MIDIのトラック構成がそのまま反映されます（1対1）。</li>
  </ul>

  <h4>4. MIDIファイルを手に入れる</h4>
  <p>手元にMIDIが無いときは、「<code>曲名 midi</code>」などで検索すれば、無料で配布しているサイトが見つかります。</p>
  <p style="margin-top:4px;"><small>みんながMIDIを投稿できる投稿型プラットフォーム: <a href="http://picotune.me/" target="_blank" rel="noopener">picotune.me</a>（いろんなジャンルのMIDIを無料ダウンロードできます。サイト上ではチップチューン風に再生されます）</small></p>
  <p style="margin-top:4px;"><small>※検索で見つかる配布サイトは、個人運営のものから権利的にグレーなものまで様々です。そのため、それらへの直接リンクは載せていません。利用の際は配布元や権利関係をご自身でご確認ください。</small></p>

  <h4>5. UST（UTAU）の歌詞を使う</h4>
  <p>UTAUのUSTファイルから歌詞だけを取り出して、歌わせることもできます。</p>
  <ul>
    <li>音符: UTAUなどでUSTをMIDIに書き出し、上の手順で読み込みます。</li>
    <li>歌詞: 下記サイトでUSTから歌詞テキストを抜き出し、MML/歌詞入力欄の <code>@@</code> 構文に貼り付けます。</li>
  </ul>
  <p style="margin-top:4px;"><small>歌詞の抽出: <a href="https://rpgen3.github.io/ust2txt/" target="_blank" rel="noopener">ust2txt</a></small></p>
</div>
`;

const BASE_STEP_WIDTH = 0.5;
const BASE_KEY_HEIGHT = 15;

/** シンプルモード（4トラック）— 役割別に自動分類してMIDIを読み込む */
export const TRACKS_SIMPLE: TrackConfig[] = [
	{
		id: "melody",
		name: "メロディー",
		color: [41, 173, 255],
		instrument: 0,
		volume: 100,
	},
	{
		id: "submelody",
		name: "サブメロ",
		color: [255, 119, 168],
		instrument: 1,
		volume: 95,
	},
	{
		id: "bass",
		name: "ベース",
		color: [0, 228, 54],
		instrument: 2,
		volume: 88,
	},
	{
		id: "chord",
		name: "伴奏",
		color: [255, 163, 0],
		instrument: 3,
		volume: 76,
	},
];

/**
 * advancedモード（15トラック）— MIDIトラックを1:1で扱う。
 * 採番はMML仕様に合わせてフラットな連番（@0〜@14 / TRACK 01〜15、欠番なし）。
 * MIDIの「ch10=ドラム」の慣習は内部モデルに持ち込まず、MIDI入出力の変換時にだけ扱う:
 * 出力は打楽器ch（内部 channel 9）を避けて割り当て（TRACK 10以降は ch11〜16 へ）、
 * 入力は channel 9 のドラムを除外する。ドラム自体は別系統の「ドラム設定」で編集する。
 */
export const TRACKS_ADVANCED: TrackConfig[] = [
	{
		id: "t0",
		name: "TRACK 01",
		color: [41, 173, 255],
		instrument: 0,
		volume: 100,
	},
	{
		id: "t1",
		name: "TRACK 02",
		color: [0, 228, 54],
		instrument: 1,
		volume: 100,
	},
	{
		id: "t2",
		name: "TRACK 03",
		color: [255, 119, 168],
		instrument: 2,
		volume: 100,
	},
	{
		id: "t3",
		name: "TRACK 04",
		color: [255, 163, 0],
		instrument: 3,
		volume: 100,
	},
	{
		id: "t4",
		name: "TRACK 05",
		color: [255, 236, 39],
		instrument: 4,
		volume: 100,
	},
	{
		id: "t5",
		name: "TRACK 06",
		color: [131, 118, 156],
		instrument: 5,
		volume: 100,
	},
	{
		id: "t6",
		name: "TRACK 07",
		color: [255, 0, 77],
		instrument: 6,
		volume: 100,
	},
	{
		id: "t7",
		name: "TRACK 08",
		color: [255, 204, 170],
		instrument: 7,
		volume: 100,
	},
	{
		id: "t8",
		name: "TRACK 09",
		color: [194, 195, 199],
		instrument: 8,
		volume: 100,
	},
	{
		id: "t9",
		name: "TRACK 10",
		color: [0, 135, 81],
		instrument: 9,
		volume: 100,
	},
	{
		id: "t10",
		name: "TRACK 11",
		color: [171, 82, 54],
		instrument: 10,
		volume: 100,
	},
	{
		id: "t11",
		name: "TRACK 12",
		color: [126, 37, 83],
		instrument: 11,
		volume: 100,
	},
	{
		id: "t12",
		name: "TRACK 13",
		color: [255, 241, 232],
		instrument: 12,
		volume: 100,
	},
	{
		id: "t13",
		name: "TRACK 14",
		color: [120, 200, 255],
		instrument: 13,
		volume: 100,
	},
	{
		id: "t14",
		name: "TRACK 15",
		color: [100, 255, 160],
		instrument: 14,
		volume: 100,
	},
];

const DEFAULT_TRACKS = TRACKS_SIMPLE;

/**
 * 歌詞エディタのモデル選択肢（空文字＝「なし」は別途先頭に追加する）。
 * 内蔵フォルマント合成 "klatt" に加え、@onjmin/koe のUTAU音源（簡略キーワード）を並べる。
 */
const LYRIC_MODELS = ["klatt", ...Object.keys(KOE_VOICEBANKS)];

/** モデルキーワード → プルダウン表示名。未登録はキーワードをそのまま表示する */
const LYRIC_MODEL_LABELS: Record<string, string> = {
	klatt: "軽量ロボ声",
	...KOE_VOICEBANK_LABELS,
};

/** モデルキーワードのUI表示名を返す（未登録はキーワードそのまま） */
const lyricModelLabel = (model: string): string =>
	LYRIC_MODEL_LABELS[model] ?? model;

const clamp = (v: number, min: number, max: number): number =>
	Math.min(Math.max(v, min), max);

type TrackState = {
	config: TrackConfig;
	core: MMLCore;
	volume: number;
	savedChordInput: string;
	savedChordPattern: ChordPatternType;
	savedChordRoot: number;
	/** 歌詞（生のかな入力。空なら歌わない） */
	lyrics: string;
	/** 歌唱合成モデル名（既定 "klatt"） */
	lyricModel: string;
	/** 歌唱の声量 0-400（100=等倍、100超でブースト＝dB対数）。ノートvelocityとは独立した合成音声専用パラメータ。既定 {@link DEFAULT_VOCAL_VOLUME} */
	vocalVolume: number;
	/** 歌唱のゲートタイム 0-100（音価に対する発音長の割合）。既定100（レガート） */
	vocalGate: number;
	/** 歌唱のステレオ定位 0-127（0=左, 64=中央, 127=右）。既定64（中央） */
	vocalPan: number;
	/** 歌唱のオクターブシフト -2〜+2（音源の得意音域に合わせてピッチを上下）。既定0 */
	vocalOctave: number;
	/** トラック個別の楽器名（GM楽器名）。空文字でプリセット適用 */
	trackInstrument: string;
};

/**
 * DAWコンポーネントをマウントする。
 */
export const mountDAW = (
	target: HTMLElement,
	options: DawOptions = {},
): DawInstance => {
	injectStyles();

	const getAudioTime = options.getAudioTime ?? (() => performance.now() / 1000);
	const trackConfigs = options.tracks ?? DEFAULT_TRACKS;
	// モードは明示指定が最優先。未指定なら後方互換でトラック数から推論する。
	// 以降の simple/advanced 分岐はすべてこの mode / isAdvanced を経由させ、
	// 「トラック数」や id "chord" といった暗黙シグナルへの相乗りをなくす。
	const mode: DawMode =
		options.mode ??
		(trackConfigs.length > TRACKS_SIMPLE.length ? "advanced" : "simple");
	const isAdvanced = mode === "advanced";
	const drumPatterns = options.drumPatterns ?? DRUM_PATTERNS;
	const showMidi = !!options.parseMidi;
	const showChord = !isAdvanced;

	const refs = buildUI(target, {
		tracks: trackConfigs,
		drumPatternNames: Object.keys(drumPatterns),
		defaultDrumPattern: drumPatterns.dance
			? "dance"
			: (Object.keys(drumPatterns)[0] ?? "none"),
		defaultBpm: options.defaultBpm ?? DEFAULT_BPM,
		showMidi,
		showChord,
	});

	// --- 描画設定 ---
	const renderConfig: RenderConfig = {
		stepsPerBar: 192,
		keyCount: 128,
		pitchRangeStart: 0,
		keyHeight: BASE_KEY_HEIGHT,
		stepWidth: BASE_STEP_WIDTH * 2, // zoom100% 相当
	};
	const leftPaddingSteps = renderConfig.stepsPerBar * 16;

	// --- 状態 ---
	let zoomX = 100;
	let zoomY = 100;
	let bpm = options.defaultBpm ?? DEFAULT_BPM;
	let masterVolume = 50;
	let drumVolume = 80;
	let currentDrumPattern = refs.drumSelect.value;
	// MML出力の先頭に埋め込む楽器プリセット名（トップレベル宣言。空なら宣言なし）
	let currentInstrument = "";
	let activeTrackId = options.initialActiveTrack ?? trackConfigs[0].id;
	let activeToolMode: ToolMode = "pen";
	let currentInsertLength = 48;
	let snapGridSteps = 12;
	const gridLineSteps = 48;
	let currentOffsetX = 0;
	const _initPitch = options.initialScrollPitch;
	let currentOffsetY =
		_initPitch !== undefined
			? (renderConfig.keyCount - 1 - _initPitch) * renderConfig.keyHeight - 215
			: (104 - 1 - 60) * renderConfig.keyHeight - 215;
	let playStartStep = 0;
	let isSolo = false;
	// loadMML で取り込んだ歌詞トラック（@@n）の同期コンダクタ。歌詞が無ければ空
	// 歌声ストリーミングが担当するトラックの添字集合（play時に確定）。
	// onPlayNote はここに含まれるトラックの楽器音を鳴らさない。
	let lyricTrackIndices = new Set<number>();
	let playbackState: PlaybackState = "stopped";
	let pausedPlayStep = 0;
	let currentPlayStep = 0;
	// 初期化完了フラグ（MMLCore構築時の早期コールバックを抑止）
	let ready = false;

	// 選択・コピー
	let selectedNotes: Note[] = [];
	let selectionRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;
	let copiedNotes: Note[] = [];

	// MMLCore は renderer.init() による g_config 設定後に生成する（generateMML が依存）。
	let trackStates: TrackState[] = [];
	// applyPatch 実行中は onNotesPatch を発火しない（エコーループ防止）。
	let suppressPatch = false;
	// onLyricsChange デバウンス用タイマー。
	let lyricsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const fireLyricsChange = (t: TrackState): void => {
		if (!options.onLyricsChange) return;
		const trackId = t.config.id;
		const data: import("./types").LyricSyncData = {
			lyrics: t.lyrics,
			model: t.lyricModel,
			vocalVolume: t.vocalVolume,
			vocalGate: t.vocalGate,
			vocalPan: t.vocalPan,
			vocalOctave: t.vocalOctave,
		};
		if (lyricsDebounceTimer) clearTimeout(lyricsDebounceTimer);
		lyricsDebounceTimer = setTimeout(() => {
			options.onLyricsChange!(trackId, data);
			lyricsDebounceTimer = null;
		}, 300);
	};
	// 目ミュート中のトラックID集合。
	const hiddenTracks = new Set<string>();
	// 音ミュート中のトラックID集合。
	const audioMutedTracks = new Set<string>();

	const createTrackStates = (): void => {
		trackStates = trackConfigs.map((config) => {
			let prevNotes: import("./types").Note[] = [];
			return {
				config,
				core: new MMLCore(
					{
						onMMLGenerated: () => {},
						onNotesChanged: (notes) => {
							if (!ready) return;
							if (!suppressPatch && options.onNotesPatch) {
								const prevByKey = new Map(
									prevNotes.map((n) => [`${n.startStep}_${n.pitch}`, n]),
								);
								const currByKey = new Map(
									notes.map((n) => [`${n.startStep}_${n.pitch}`, n]),
								);
								const added = notes
									.filter((n) => !prevByKey.has(`${n.startStep}_${n.pitch}`))
									.map((n) => ({
										startStep: n.startStep,
										pitch: n.pitch,
										durationSteps: n.durationSteps,
										velocity: n.velocity,
									}));
								const removed = prevNotes
									.filter((n) => !currByKey.has(`${n.startStep}_${n.pitch}`))
									.map((n) => ({ startStep: n.startStep, pitch: n.pitch }));
								if (added.length > 0 || removed.length > 0) {
									options.onNotesPatch(config.id, added, removed);
								}
							}
							prevNotes = [...notes];
							redrawAll();
							updateUndoRedo();
						},
					},
					config.volume,
				),
				volume: config.volume,
				savedChordInput: "",
				savedChordPattern: "block",
				savedChordRoot: 0,
				lyrics: "",
				lyricModel: "", // 既定は「なし」（歌わない）
				vocalVolume: DEFAULT_VOCAL_VOLUME,
				vocalGate: 100,
				vocalPan: 64,
				vocalOctave: 0,
				trackInstrument: "",
			};
		});
	};

	// 各トラックの歌詞入力から歌詞トラック辞書を構築する（@@n の n = トラックの並び順）
	const buildLyricsMap = (): Map<number, LyricTrack> => {
		const map = new Map<number, LyricTrack>();
		trackStates.forEach((t, i) => {
			const model = t.lyricModel.trim();
			const text = t.lyrics.trim();
			if (!model || !text) return; // モデル「なし」または歌詞空なら歌わない
			const syllables = normalizeLyrics(text);
			if (syllables.length === 0) return;
			map.set(i, {
				trackId: i,
				model: model.toLowerCase(),
				volume: t.vocalVolume,
				gate: t.vocalGate,
				pan: t.vocalPan,
				octave: t.vocalOctave,
				syllables,
			});
		});
		return map;
	};

	const getActive = (): TrackState =>
		trackStates.find((t) => t.config.id === activeTrackId) ?? trackStates[0];

	let showModal: (title: string, bodyHTML: string) => void;

	// ============================================================
	// 描画
	// ============================================================
	const getMaxNoteStep = (): number => {
		let maxStep = renderConfig.stepsPerBar * 4;
		for (const t of trackStates) {
			for (const n of t.core.getNotes()) {
				const end = n.startStep + n.durationSteps;
				if (end > maxStep) maxStep = end;
			}
		}
		return maxStep;
	};

	const getMaxOffsetY = (): number => {
		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		return Math.max(0, totalHeight - getGridCanvas().height);
	};

	const drawStartLine = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = playStartStep * renderConfig.stepWidth - currentOffsetX;
		if (x < -10 || x > canvas.width + 10) return;
		ctx.save();
		ctx.strokeStyle = "#ffec27";
		ctx.lineWidth = 2;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const drawPlayhead = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = currentPlayStep * renderConfig.stepWidth - currentOffsetX;
		if (x < 0 || x > canvas.width) return;
		ctx.save();
		ctx.strokeStyle = "#ff004d";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const redrawAll = (): void => {
		drawGrid(gridLineSteps);
		for (const t of trackStates) {
			if (hiddenTracks.has(t.config.id)) continue;
			const [r, g, b] = t.config.color;
			const a = t.config.id === activeTrackId ? 1 : 0.3;
			drawNotes(t.core.getNotes(), [r, g, b, a]);
		}
		if (activeToolMode === "select" && selectionRect) {
			const ctx = getGridContext();
			ctx.save();
			ctx.strokeStyle = "#ffec27";
			ctx.lineWidth = 2;
			ctx.setLineDash([4, 4]);
			ctx.strokeRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.fillStyle = "rgba(255,236,39,0.08)";
			ctx.fillRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.restore();
		}
		if (activeToolMode === "select" && selectedNotes.length > 0) {
			const ids = new Set(selectedNotes.map((n) => n.id));
			const active = getActive();
			drawSelectedNotes(active.core.getNotes(), ids, [
				...active.config.color,
				1,
			]);
		}
		drawStartLine();
		if (playbackState === "playing") drawPlayhead();
		updateScrollbars();
	};

	// ============================================================
	// スクロールバー
	// ============================================================
	const updateScrollbars = (): void => {
		const canvas = getGridCanvas();
		const maxNoteStep = getMaxNoteStep();
		const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
		const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
		const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
		const sbW = refs.hScroll.clientWidth;
		if (maxOffsetX <= 0) {
			refs.hScrollThumb.style.width = "100%";
			refs.hScrollThumb.style.left = "0";
		} else {
			const thumbW = Math.max(
				40,
				(canvas.width / (totalContentWidth + leftPaddingWidth)) * sbW,
			);
			const ratio = currentOffsetX / maxOffsetX;
			refs.hScrollThumb.style.width = `${thumbW}px`;
			refs.hScrollThumb.style.left = `${clamp(ratio * (sbW - thumbW), 0, sbW - thumbW)}px`;
		}

		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		const sbH = refs.vScroll.clientHeight;
		if (totalHeight <= canvas.height) {
			refs.vScrollThumb.style.height = "100%";
			refs.vScrollThumb.style.top = "0";
		} else {
			const thumbH = Math.max(40, (canvas.height / totalHeight) * sbH);
			const maxOffset = getMaxOffsetY();
			const ratio = currentOffsetY / maxOffset;
			refs.vScrollThumb.style.height = `${thumbH}px`;
			refs.vScrollThumb.style.top = `${ratio * (sbH - thumbH)}px`;
		}
	};

	const initScrollbarDrag = (): void => {
		let draggingH = false;
		let draggingV = false;
		refs.hScroll.addEventListener("pointerdown", (e) => {
			draggingH = true;
			e.preventDefault();
			refs.hScroll.setPointerCapture(e.pointerId);
			moveH(e.clientX);
		});
		refs.vScroll.addEventListener("pointerdown", (e) => {
			draggingV = true;
			e.preventDefault();
			refs.vScroll.setPointerCapture(e.pointerId);
			moveV(e.clientY);
		});
		refs.hScroll.addEventListener("pointermove", (e) => {
			if (draggingH) moveH(e.clientX);
		});
		refs.vScroll.addEventListener("pointermove", (e) => {
			if (draggingV) moveV(e.clientY);
		});
		refs.hScroll.addEventListener("pointerup", () => {
			draggingH = false;
		});
		refs.vScroll.addEventListener("pointerup", () => {
			draggingV = false;
		});
		document.addEventListener("pointermove", (e) => {
			if (draggingH) moveH(e.clientX);
			if (draggingV) moveV(e.clientY);
		});
		document.addEventListener("pointerup", () => {
			draggingH = false;
			draggingV = false;
		});

		const moveH = (clientX: number): void => {
			const canvas = getGridCanvas();
			const maxNoteStep = getMaxNoteStep();
			const leftPaddingWidth = leftPaddingSteps * renderConfig.stepWidth;
			const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
			const maxOffsetX = totalContentWidth - canvas.width + leftPaddingWidth;
			if (maxOffsetX <= 0) return;
			const rect = refs.hScroll.getBoundingClientRect();
			const thumbW = Number.parseFloat(refs.hScrollThumb.style.width) || 40;
			const x = clamp(clientX - rect.left - thumbW / 2, 0, rect.width - thumbW);
			const ratio = x / (rect.width - thumbW);
			currentOffsetX = clamp(ratio * maxOffsetX, 0, maxOffsetX);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
		const moveV = (clientY: number): void => {
			const maxOffset = getMaxOffsetY();
			if (maxOffset <= 0) return;
			const rect = refs.vScroll.getBoundingClientRect();
			const thumbH = Number.parseFloat(refs.vScrollThumb.style.height) || 40;
			const y = clamp(clientY - rect.top - thumbH / 2, 0, rect.height - thumbH);
			const ratio = y / (rect.height - thumbH);
			currentOffsetY = clamp(ratio * maxOffset, 0, maxOffset);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
	};

	// ============================================================
	// グリッド操作（ペン/選択/消しゴム）
	// ============================================================
	const resizeHandleWidth = 10;
	const TOUCH_HIT_MARGIN = 6;
	let suppressClick = false;
	let hasDragged = false;
	let dragState: null | {
		noteId: number;
		mode: "move" | "resize";
		dragOffsetStep: number;
		dragOffsetPitch: number;
		startStep: number;
		durationSteps: number;
		lastPreviewPitch: number;
	} = null;
	// 選択モードのドラッグ
	let isSelecting = false;
	let dragMode: "rect" | "move" = "rect";
	let selectionStart: {
		x: number;
		y: number;
		step: number;
		pitch: number;
	} | null = null;
	let selectedOriginal: { id: number; startStep: number; pitch: number }[] = [];
	let lastMultiPreviewPitch: number | null = null;

	const playPreview = (pitch: number): void => {
		options.onResumeAudio?.();
		const active = getActive();
		dispatchNote(active.config.id, pitch, active.volume, 100, 0, 0.1);
	};

	const findActiveNoteAt = (x: number, y: number, margin = 0): Note | null => {
		const active = getActive();
		const { stepWidth, keyHeight, keyCount, pitchRangeStart } = renderConfig;
		const offset = getDrawOffset();
		for (const note of active.core.getNotes()) {
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const logicalY = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const renderX = logicalX - offset.x;
			const renderY = logicalY - offset.y;
			if (
				x >= renderX - margin &&
				x <= renderX + w + margin &&
				y >= renderY - margin &&
				y <= renderY + keyHeight + margin
			)
				return note;
		}
		return null;
	};

	const hasNoteAt = (
		step: number,
		pitch: number,
		excludeId: number,
	): boolean => {
		const active = getActive();
		return active.core
			.getNotes()
			.some(
				(n) =>
					n.id !== excludeId &&
					n.pitch === pitch &&
					step >= n.startStep &&
					step < n.startStep + n.durationSteps,
			);
	};

	const snapToGrid = (duration: number): number =>
		Math.max(
			Math.round(duration / snapGridSteps) * snapGridSteps,
			snapGridSteps,
		);

	const isActiveLocked = (): boolean =>
		options.lockedTracks?.includes(getActive().config.id) ?? false;

	const onGridPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		options.onResumeAudio?.();
		const { x, y, step, pitch } = getGridPosition(event);
		const active = getActive();

		if (activeToolMode === "eraser") {
			if (isActiveLocked()) return;
			const note = findActiveNoteAt(x, y);
			if (note) active.core.deleteNoteById(note.id);
			return;
		}

		if (activeToolMode === "select") {
			if (selectedNotes.length > 0) {
				const clicked = findActiveNoteAt(x, y);
				if (clicked && selectedNotes.some((n) => n.id === clicked.id)) {
					selectedOriginal = selectedNotes.map((n) => ({
						id: n.id,
						startStep: n.startStep,
						pitch: n.pitch,
					}));
					isSelecting = true;
					dragMode = "move";
					selectionStart = { x, y, step, pitch };
					hasDragged = false;
					lastMultiPreviewPitch = null;
					return;
				}
				selectedNotes = [];
				selectionRect = null;
			}
			const clicked = findActiveNoteAt(x, y);
			if (clicked) {
				selectedNotes = [clicked];
				selectedOriginal = [
					{
						id: clicked.id,
						startStep: clicked.startStep,
						pitch: clicked.pitch,
					},
				];
				isSelecting = true;
				dragMode = "move";
			} else {
				selectedNotes = [];
				selectionRect = null;
				isSelecting = true;
				dragMode = "rect";
			}
			selectionStart = { x, y, step, pitch };
			hasDragged = false;
			return;
		}

		// pen
		hasDragged = false;
		// ピクセルレベルのヒット判定（タッチ操作用のマージン付き）
		const existing = findActiveNoteAt(x, y, TOUCH_HIT_MARGIN);
		if (existing) {
			playPreview(existing.pitch);
			const { stepWidth } = renderConfig;
			const offset = getDrawOffset();
			const renderX = existing.startStep * stepWidth - offset.x;
			const w = existing.durationSteps * stepWidth;
			if (x >= renderX + w - resizeHandleWidth && x <= renderX + w) {
				dragState = {
					noteId: existing.id,
					mode: "resize",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			} else {
				dragState = {
					noteId: existing.id,
					mode: "move",
					dragOffsetStep: step - existing.startStep,
					dragOffsetPitch: pitch - existing.pitch,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			}
			suppressClick = true;
			return;
		}

		if (isActiveLocked()) return;

		const snappedStep =
			Math.floor(step / currentInsertLength) * currentInsertLength;
		const newStart = snappedStep;
		const newEnd = newStart + currentInsertLength;
		const overlapping = active.core
			.getNotes()
			.some(
				(n) =>
					n.pitch === pitch &&
					newStart < n.startStep + n.durationSteps &&
					newEnd > n.startStep,
			);
		if (!overlapping) {
			active.core.addNote(snappedStep, pitch, {
				noteLengthSteps: currentInsertLength,
			});
			playPreview(pitch);
			const newNote = active.core
				.getNotes()
				.find((n) => n.startStep === snappedStep && n.pitch === pitch);
			if (newNote) {
				dragState = {
					noteId: newNote.id,
					mode: "move",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: newNote.startStep,
					durationSteps: newNote.durationSteps,
					lastPreviewPitch: newNote.pitch,
				};
				hasDragged = true;
			}
			suppressClick = true;
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		const active = getActive();
		if (activeToolMode === "pen") {
			if (!dragState) return;
			const { step, pitch } = getGridPosition(event);
			hasDragged = true;
			if (dragState.mode === "move") {
				const nextStart = step - dragState.dragOffsetStep;
				const snappedStart =
					Math.round(nextStart / snapGridSteps) * snapGridSteps;
				const nextPitch = pitch - dragState.dragOffsetPitch;
				if (hasNoteAt(snappedStart, nextPitch, dragState.noteId)) return;
				active.core.moveNote(dragState.noteId, snappedStart, nextPitch);
				if (nextPitch !== dragState.lastPreviewPitch) {
					dragState.lastPreviewPitch = nextPitch;
					playPreview(nextPitch);
				}
				return;
			}
			const rawDuration = step - dragState.startStep + 1;
			const snapped = snapToGrid(rawDuration);
			active.core.resizeNote(dragState.noteId, snapped);
			dragState.durationSteps = snapped;
			currentInsertLength = snapped;
			redrawAll();
			return;
		}

		if (activeToolMode === "select" && isSelecting && selectionStart) {
			const { x, y, step, pitch } = getGridPosition(event);
			if (dragMode === "rect") {
				const rect = {
					x: Math.min(x, selectionStart.x),
					y: Math.min(y, selectionStart.y),
					width: Math.abs(x - selectionStart.x),
					height: Math.abs(y - selectionStart.y),
				};
				selectionRect = rect;
				const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
					renderConfig;
				const offset = getDrawOffset();
				selectedNotes = active.core.getNotes().filter((note) => {
					const logicalX = note.startStep * stepWidth;
					const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
					const logicalY = yIndex * keyHeight;
					const nx = logicalX - offset.x;
					const ny = logicalY - offset.y;
					const nw = note.durationSteps * stepWidth;
					return (
						rect.x < nx + nw &&
						rect.x + rect.width > nx &&
						rect.y < ny + keyHeight &&
						rect.y + rect.height > ny
					);
				});
				redrawAll();
			} else {
				const rawDeltaStep = step - selectionStart.step;
				const snappedDelta =
					Math.round(rawDeltaStep / snapGridSteps) * snapGridSteps;
				const deltaPitch = pitch - selectionStart.pitch;
				if (snappedDelta !== 0 || deltaPitch !== 0) {
					hasDragged = true;
					if (!active.core.isBatchOperation) active.core.beginBatch();
					for (const note of selectedNotes) {
						const orig = selectedOriginal.find((o) => o.id === note.id);
						if (!orig) continue;
						const newPitch = orig.pitch + deltaPitch;
						if (newPitch >= 0 && newPitch < 128)
							active.core.moveNote(
								note.id,
								orig.startStep + snappedDelta,
								newPitch,
							);
					}
					if (selectedNotes.length > 0) {
						const grab = selectedNotes[0];
						const orig = selectedOriginal.find((o) => o.id === grab.id);
						if (orig) {
							const newGrab = orig.pitch + deltaPitch;
							if (
								newGrab !== lastMultiPreviewPitch &&
								newGrab >= 0 &&
								newGrab < 128
							) {
								lastMultiPreviewPitch = newGrab;
								playPreview(newGrab);
							}
						}
					}
				}
				redrawAll();
			}
		}
	};

	const onPointerUp = (): void => {
		if (activeToolMode === "pen" && dragState) {
			if (hasDragged) {
				const active = getActive();
				if (dragState.mode === "move")
					active.core.moveNoteEnd(dragState.noteId);
				else active.core.resizeNoteEnd(dragState.noteId);
				suppressClick = true;
			}
			dragState = null;
			hasDragged = false;
		}
		if (activeToolMode === "select" && isSelecting) {
			if (hasDragged && dragMode === "move" && selectedNotes.length > 0) {
				getActive().core.endBatch();
			}
			isSelecting = false;
			selectionStart = null;
			hasDragged = false;
			lastMultiPreviewPitch = null;
			selectionRect = null;
			selectedOriginal = [];
			redrawAll();
		}
	};

	// ============================================================
	// Canvas セットアップ（リサイズ時に再構築）
	// ============================================================
	const setupCanvas = (): void => {
		const w = refs.rollContainer.clientWidth || 800;
		const h = refs.rollContainer.clientHeight || 450;
		init(refs.wrapper, w, h, renderConfig);

		const gridCanvas = getGridCanvas();
		gridCanvas.addEventListener("pointerdown", onGridPointerDown);
		gridCanvas.addEventListener("dblclick", (event) => {
			event.preventDefault();
			if (isActiveLocked()) return;
			const { step, pitch } = getGridPosition(event);
			const active = getActive();
			const note = active.core
				.getNotes()
				.find(
					(n) =>
						n.pitch === pitch &&
						step >= n.startStep &&
						step < n.startStep + n.durationSteps,
				);
			if (note) active.core.deleteNoteById(note.id);
		});
		gridCanvas.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				currentOffsetY = clamp(
					currentOffsetY + event.deltaY,
					0,
					getMaxOffsetY(),
				);
				currentOffsetX = Math.max(0, currentOffsetX + event.deltaX);
				setDrawOffset(currentOffsetX, currentOffsetY);
				redrawAll();
			},
			{ passive: false },
		);
		// クリック＝再生開始位置 / ノート追加はpointerdownで処理済
		gridCanvas.addEventListener("click", () => {
			if (suppressClick) {
				suppressClick = false;
			}
		});

		const headerCanvas = getHeaderCanvas();
		headerCanvas.addEventListener("click", (event) => {
			if (playbackState === "playing") return;
			const rect = headerCanvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const step = Math.floor((x + currentOffsetX) / renderConfig.stepWidth);
			playStartStep = Math.max(
				0,
				Math.floor(step / snapGridSteps) * snapGridSteps,
			);
			if (playbackState === "paused") {
				playbackState = "stopped";
				updateTransport();
			}
			redrawAll();
		});

		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// ============================================================
	// ズーム
	// ============================================================
	const applyZoomX = (): void => {
		const canvas = getGridCanvas();
		const centerStep =
			(currentOffsetX + canvas.width / 2) / renderConfig.stepWidth;
		renderConfig.stepWidth = (BASE_STEP_WIDTH * (zoomX * 2)) / 100;
		refs.zoomXLabel.textContent = `${zoomX}%`;
		currentOffsetX = Math.max(
			0,
			centerStep * renderConfig.stepWidth - canvas.width / 2,
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};
	const applyZoomY = (): void => {
		const canvas = getGridCanvas();
		const centerKey =
			(currentOffsetY + canvas.height / 2) / renderConfig.keyHeight;
		renderConfig.keyHeight = (BASE_KEY_HEIGHT * zoomY) / 100;
		refs.zoomYLabel.textContent = `${zoomY}%`;
		currentOffsetY = clamp(
			centerKey * renderConfig.keyHeight - canvas.height / 2,
			0,
			getMaxOffsetY(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// 永続化対象の表示・出力設定（ズーム / 和音分解）を収集・通知する
	const getViewState = (): DawViewState => ({
		zoomX,
		zoomY,
		decomposeChord: refs.decomposeChordToggle.checked,
		ignoreChordHeavy: refs.ignoreChordHeavyToggle.checked,
	});
	const notifyViewState = (): void =>
		options.onViewStateChange?.(getViewState());

	// ============================================================
	// 発音ディスパッチ（マスタ/ドラム音量を適用してフックへ）
	// ============================================================
	const dispatchNote = (
		trackId: string,
		pitch: number,
		trackVol: number,
		velocity: number,
		when: number,
		duration: number,
	): void => {
		const volume = (trackVol / 100) * (velocity / 127) * (masterVolume / 100);
		options.onPlayNote?.({ trackId, pitch, velocity, volume, when, duration });
	};

	// ============================================================
	// 再生
	// ============================================================
	const sequencer: Sequencer = createSequencer({
		getTracks: () =>
			trackStates.map((t) => ({
				id: t.config.id,
				volume: t.volume,
				notes: t.core.getNotes(),
			})),
		getBpm: () => bpm,
		getPlayStartStep: () => playStartStep,
		getDrumPattern: () => drumPatterns[currentDrumPattern] ?? null,
		getSoloTrackId: () => (isSolo ? activeTrackId : null),
		getAudioTime,
		onPlayNote: (e) => {
			// 音ミュート中のトラックはスキップ。
			if (audioMutedTracks.has(e.trackId)) return;
			// 歌詞トラックの発音は歌声ストリーミング（startStream）が担当するため、
			// 楽器音は鳴らさない。@@n の n は trackStates の並び順（@n）に対応づく。
			const idx = trackStates.findIndex((t) => t.config.id === e.trackId);
			if (idx >= 0 && lyricTrackIndices.has(idx) && options.singingVoices) {
				return;
			}
			options.onPlayNote?.({ ...e, volume: e.volume * (masterVolume / 100) });
		},
		onPlayDrum: (e) => {
			const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
		},
		onTick: (step) => {
			currentPlayStep = step;
			const canvas = getGridCanvas();
			const visibleSteps = canvas.width / renderConfig.stepWidth;
			const threshold =
				currentOffsetX / renderConfig.stepWidth + visibleSteps - 4;
			if (currentPlayStep > threshold) {
				const visibleBars = Math.round(visibleSteps / renderConfig.stepsPerBar);
				currentOffsetX +=
					visibleBars * renderConfig.stepsPerBar * renderConfig.stepWidth;
				setDrawOffset(currentOffsetX, currentOffsetY);
			}
			redrawAll();
		},
		onEnd: (interrupted) => {
			if (interrupted) {
				playbackState = "paused";
				pausedPlayStep = currentPlayStep;
			} else {
				playbackState = "stopped";
				currentPlayStep = 0;
			}
			updateTransport();
			redrawAll();
		},
		stepsPerBar: renderConfig.stepsPerBar,
	});

	const play = async (): Promise<void> => {
		if (playbackState === "playing") return;
		// AudioContext の resume は非同期。suspended（currentTime 凍結）のまま
		// sequencer.start すると resume 完了の瞬間に先読み予約が一斉発音され、冒頭で
		// 「ピチュ」という潰れた音が鳴る。resume の完了を待ってからスケジュールを始める。
		await options.onResumeAudio?.();

		const fromStep =
			playbackState === "paused" ? pausedPlayStep : playStartStep;

		options.singingVoices?.reset();

		// 歌詞トラックを「絶対時刻ベースのストリーミング用」ノート列へ変換する。
		// fromStep より前のノートは切り落とし、startSec は fromStep 基準にする。
		const lyricMap = buildLyricsMap();
		lyricTrackIndices = new Set(lyricMap.keys());
		const secondsPerStep = 60 / bpm / 48; // STEPS_PER_BEAT = 48
		const streamTracks: StreamVoiceTrack[] = options.singingVoices
			? [...lyricMap.values()].map((lt) => {
					const trackState = trackStates[lt.trackId];
					const sorted = [...(trackState?.core.getNotes() ?? [])].sort(
						(a, b) => a.startStep - b.startStep,
					);
					const gate = (lt.gate ?? DEFAULT_GATE) / 100;
					const semis = (lt.octave ?? 0) * 12; // オクターブシフトを半音換算でピッチへ加算
					const count = Math.min(sorted.length, lt.syllables.length);
					const notes = [];
					for (let i = 0; i < count; i++) {
						const n = sorted[i];
						if (n.startStep < fromStep) continue;
						notes.push({
							syllable: lt.syllables[i],
							pitch: n.pitch + semis,
							startSec: (n.startStep - fromStep) * secondsPerStep,
							durationSec: n.durationSteps * secondsPerStep * gate,
						});
					}
					return {
						id: trackState?.config.id,
						model: lt.model,
						volume:
							vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME) *
							(masterVolume / 100),
						pan: panToStereo(lt.pan ?? DEFAULT_PAN),
						notes,
					};
				})
			: [];

		const voices = options.singingVoices;
		const streaming = !!voices && streamTracks.some((t) => t.notes.length > 0);
		if (streaming && voices) {
			// オーバーレイはピアノロール部分だけに被せる（操作パネルまで覆わない）
			const overlay = showLoadingOverlay(refs.rollContainer);
			setLoading(true);
			try {
				await voices.loadModels(streamTracks.map((t) => t.model));
				await voices.warm(streamTracks);
			} catch (err) {
				console.warn("[dtm] voice preload failed", err);
			} finally {
				overlay.remove();
				setLoading(false);
			}
		}

		if (playbackState !== "paused") {
			// 再生開始位置までスクロール
			const canvas = getGridCanvas();
			currentOffsetX = Math.max(
				0,
				playStartStep * renderConfig.stepWidth - canvas.width * 0.5,
			);
			setDrawOffset(currentOffsetX, currentOffsetY);
		}
		playbackState = "playing";
		sequencer.start(fromStep);
		// 楽器と同じアンカー（開始時刻）で歌声の先読みストリーミングを開始する。
		// ソロはライブ判定（楽器側＝シーケンサの getSoloTrackId と同じ基準）で渡す。
		if (streaming && voices) {
			voices.startStream(streamTracks, sequencer.getStartTime(), {
				isAudible: (t) => !isSolo || t.id === activeTrackId,
			});
		}
		updateTransport();
	};
	const pause = (): void => {
		if (playbackState !== "playing") return;
		pausedPlayStep = currentPlayStep;
		sequencer.stop();
		options.singingVoices?.stopStream();
		playbackState = "paused";
		updateTransport();
	};
	const stop = (): void => {
		sequencer.stop();
		options.singingVoices?.stopStream();
		playbackState = "stopped";
		currentPlayStep = 0;
		updateTransport();
		redrawAll();
	};
	const togglePlay = (): void => {
		if (playbackState === "playing") stop();
		else play();
	};

	// ============================================================
	// UIコントロール
	// ============================================================
	const updateTransport = (): void => {
		const playing = playbackState === "playing";
		const label = playing
			? "停止"
			: playbackState === "paused"
				? "再開"
				: "試聴";
		refs.playBtn.innerHTML = `${icon(playing ? "pause" : "play")}<span>${label}</span>`;
		refs.playBtn.classList.toggle("dtm-play--stop", playing);
	};

	const updateUndoRedo = (): void => {
		const core = getActive().core;
		refs.undoBtn.disabled = !core.canUndo();
		refs.redoBtn.disabled = !core.canRedo();
	};

	const updateTrackPanel = (): void => {
		// トラックピル（色分け・常時表示）
		refs.trackTabs.innerHTML = "";
		for (const t of trackStates) {
			const [r, g, b] = t.config.color;
			const btn = document.createElement("button");
			btn.className = `dtm-pill ${t.config.id === activeTrackId ? "dtm-pill--active" : ""}`;
			btn.style.setProperty("--dtm-pill-color", `rgb(${r},${g},${b})`);
			btn.innerHTML = `<span class="dtm-dot"></span><span>${t.config.name}</span>`;
			btn.addEventListener("click", () => switchTrack(t.config.id));
			refs.trackTabs.appendChild(btn);
		}
		// ボディ
		const active = getActive();
		refs.trackBody.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">velocity</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="track-vol" min="0" max="127" value="${active.volume}">
        <span class="dtm-label" data-dtm="track-vol-label">${active.volume}</span>
      </div>`;
		const volInput = refs.trackBody.querySelector(
			'[data-dtm="track-vol"]',
		) as HTMLInputElement;
		const volLabel = refs.trackBody.querySelector(
			'[data-dtm="track-vol-label"]',
		) as HTMLElement;
		volInput.addEventListener("input", () => {
			active.volume = Number.parseInt(volInput.value, 10);
			active.core.setVolume(active.volume);
			volLabel.textContent = String(active.volume);
		});

		// 楽器個別選択（デフォルト＝プリセット or GM楽器名指定）
		const instRow = document.createElement("div");
		instRow.className = "dtm-row";
		instRow.innerHTML = `<span class="dtm-label">楽器</span>`;
		const instSel = document.createElement("select");
		instSel.className = "dtm-select dtm-grow";
		const defaultOpt = document.createElement("option");
		defaultOpt.value = "";
		defaultOpt.textContent = "デフォルト（プリセット）";
		instSel.appendChild(defaultOpt);
		// GM楽器は8音色ごと16カテゴリに分類される
		const GM_GROUPS = [
			"ピアノ",
			"クロマティックパーカッション",
			"オルガン",
			"ギター",
			"ベース",
			"ストリングス",
			"アンサンブル",
			"ブラス",
			"リード（木管）",
			"パイプ",
			"シンセリード",
			"シンセパッド",
			"シンセエフェクト",
			"エスニック",
			"パーカッシブ",
			"サウンドエフェクト",
		];
		GM_GROUPS.forEach((groupName, gi) => {
			const grp = document.createElement("optgroup");
			grp.label = groupName;
			for (let j = 0; j < 8; j++) {
				const name = GM_INSTRUMENT_NAMES[gi * 8 + j];
				if (!name) break;
				const o = document.createElement("option");
				o.value = name;
				o.textContent = name;
				grp.appendChild(o);
			}
			instSel.appendChild(grp);
		});
		instSel.value = active.trackInstrument;
		// 歌詞モデルが設定されているトラックは歌声が楽器音を置き換えるため、個別楽器を無効化する
		const syncInstDisabled = (): void => {
			instSel.disabled = !!active.lyricModel;
			instSel.title = active.lyricModel
				? "歌詞モードのときは楽器を個別指定できません"
				: "";
		};
		syncInstDisabled();
		instSel.addEventListener("change", () => {
			active.trackInstrument = instSel.value;
			const trackIndex = trackStates.indexOf(active);
			options.onTrackInstrumentChange?.(trackIndex, active.trackInstrument);
		});
		instRow.appendChild(instSel);
		refs.trackBody.appendChild(instRow);

		// 歌詞エディタ（全トラック共通）。歌唱モデルのプルダウン既定「なし」が無効状態を兼ねる。
		// モデルを選んだときだけ声量・歌詞欄を出す（使わないときは隠す）。@@n model[:声量] lyrics として往復。
		// simpleモードの伴奏(chord)トラックだけは歌詞欄を出さず、下の伴奏UIに置き換える。
		if (isAdvanced || active.config.id !== "chord") {
			const lyricDiv = document.createElement("div");
			lyricDiv.className = "dtm-row";
			lyricDiv.style.flexDirection = "column";
			lyricDiv.style.alignItems = "stretch";
			lyricDiv.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">♪ UTAU</span>
        <select class="dtm-select" data-dtm="lyric-model" aria-label="歌唱モデル"></select>
        <img class="dtm-lyric-icon dtm-hidden" data-dtm="lyric-icon" width="20" height="20" alt="" draggable="false">
        <select class="dtm-select" data-dtm="lyric-octave" aria-label="オクターブ（音源の得意音域に合わせる）" title="オクターブ">
          <option value="2">+2 oct</option>
          <option value="1">+1 oct</option>
          <option value="0">±0 oct</option>
          <option value="-1">-1 oct</option>
          <option value="-2">-2 oct</option>
        </select>
        <span class="dtm-label dtm-grow" data-dtm="lyric-count" style="text-align:right"></span>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="lyric-terms" style="font-size:10px;gap:4px;color:var(--dtm-warn)">
        <span>使用時には</span>
        <a data-dtm="lyric-terms-link" target="_blank" rel="noopener" style="color:var(--dtm-primary);text-decoration:underline"></a>
        <span>の利用規約に従ってください</span>
      </div>
      <div class="dtm-row" data-dtm="lyric-body" style="flex-direction:column;align-items:stretch">
        <div class="dtm-row">
          <span class="dtm-label">声量</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-vol" min="0" max="${MAX_VOCAL_VOLUME}" aria-label="歌唱の声量（100=等倍、100超でブースト、既定200）">
          <span class="dtm-label" data-dtm="lyric-vol-label"></span>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">定位</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-pan" min="0" max="127" aria-label="歌唱のステレオ定位（左右）">
          <span class="dtm-label" data-dtm="lyric-pan-label"></span>
        </div>
        <textarea class="dtm-textarea" data-dtm="lyric-input" rows="2" placeholder="ひらがな・カタカナで歌詞（例: どれみふぁそらしど）"></textarea>
      </div>`;
			refs.trackBody.appendChild(lyricDiv);
			const lyricModelSel = lyricDiv.querySelector(
				'[data-dtm="lyric-model"]',
			) as HTMLSelectElement;
			const lyricOctaveSel = lyricDiv.querySelector(
				'[data-dtm="lyric-octave"]',
			) as HTMLSelectElement;
			const lyricIcon = lyricDiv.querySelector(
				'[data-dtm="lyric-icon"]',
			) as HTMLImageElement;
			const lyricBody = lyricDiv.querySelector(
				'[data-dtm="lyric-body"]',
			) as HTMLElement;
			const lyricInput = lyricDiv.querySelector(
				'[data-dtm="lyric-input"]',
			) as HTMLTextAreaElement;
			const lyricCount = lyricDiv.querySelector(
				'[data-dtm="lyric-count"]',
			) as HTMLElement;
			const lyricVol = lyricDiv.querySelector(
				'[data-dtm="lyric-vol"]',
			) as HTMLInputElement;
			const lyricVolLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-vol-label"]',
			) as HTMLElement;
			const lyricPan = lyricDiv.querySelector(
				'[data-dtm="lyric-pan"]',
			) as HTMLInputElement;
			const lyricPanLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-pan-label"]',
			) as HTMLElement;
			const lyricTerms = lyricDiv.querySelector(
				'[data-dtm="lyric-terms"]',
			) as HTMLElement;
			const lyricTermsLink = lyricDiv.querySelector(
				'[data-dtm="lyric-terms-link"]',
			) as HTMLAnchorElement;
			// 定位ラベル: 64=C / 左寄りは L<量> / 右寄りは R<量>
			const fmtPan = (pan: number): string =>
				pan === 64 ? "C" : pan < 64 ? `L${64 - pan}` : `R${pan - 64}`;
			// 選択肢: なし(空＝無効、既定) + 既知モデル + 読込MML由来の非標準モデル（往復維持）
			const addOpt = (value: string, label: string): void => {
				const o = document.createElement("option");
				o.value = value;
				o.textContent = label;
				lyricModelSel.appendChild(o);
			};
			addOpt("", "ボーカルなし");
			for (const m of LYRIC_MODELS) addOpt(m, lyricModelLabel(m));
			if (active.lyricModel && !LYRIC_MODELS.includes(active.lyricModel)) {
				addOpt(active.lyricModel, lyricModelLabel(active.lyricModel));
			}
			lyricModelSel.value = active.lyricModel;
			lyricOctaveSel.value = String(active.vocalOctave);
			// 値はプロパティ経由で設定（HTML文字列に混ぜず、</textarea>等の混入を防ぐ）
			lyricInput.value = active.lyrics;
			lyricVol.value = String(active.vocalVolume);
			lyricVolLabel.textContent = String(active.vocalVolume);
			lyricPan.value = String(active.vocalPan);
			lyricPanLabel.textContent = fmtPan(active.vocalPan);
			const updateLyricCount = (): void => {
				const n = normalizeLyrics(lyricInput.value).length;
				lyricCount.textContent = active.lyricModel && n > 0 ? `${n}音節` : "";
			};
			const syncLyricTerms = (): void => {
				const url = active.lyricModel
					? KOE_VOICEBANK_TERMS[active.lyricModel]
					: undefined;
				if (url) {
					const label = lyricModelLabel(active.lyricModel);
					lyricTermsLink.textContent = `${label}UTAU音源`;
					lyricTermsLink.href = url;
					lyricTerms.classList.remove("dtm-hidden");
				} else {
					lyricTerms.classList.add("dtm-hidden");
				}
			};
			const syncLyricIcon = (): void => {
				const imgKey = active.lyricModel
					? VOICE_IMAGE_KEY[active.lyricModel.toLowerCase()]
					: undefined;
				const src = imgKey ? VOICE_IMAGES[imgKey] : undefined;
				if (src) {
					lyricIcon.src = src;
					lyricIcon.classList.remove("dtm-hidden");
				} else {
					lyricIcon.removeAttribute("src");
					lyricIcon.classList.add("dtm-hidden");
				}
			};
			const syncLyricVisibility = (): void => {
				lyricBody.style.display = active.lyricModel ? "" : "none";
				// オクターブは歌うときだけ意味を持つので、モデル「なし」では隠す
				lyricOctaveSel.style.display = active.lyricModel ? "" : "none";
				updateLyricCount();
				syncLyricTerms();
				syncLyricIcon();
			};
			syncLyricVisibility();
			lyricModelSel.addEventListener("change", () => {
				active.lyricModel = lyricModelSel.value;
				syncLyricVisibility();
				syncInstDisabled();
				fireLyricsChange(active);
			});
			lyricOctaveSel.addEventListener("change", () => {
				active.vocalOctave = Number.parseInt(lyricOctaveSel.value, 10);
				fireLyricsChange(active);
			});
			lyricInput.addEventListener("input", () => {
				active.lyrics = lyricInput.value;
				updateLyricCount();
				fireLyricsChange(active);
			});
			lyricVol.addEventListener("input", () => {
				active.vocalVolume = Number.parseInt(lyricVol.value, 10);
				lyricVolLabel.textContent = lyricVol.value;
				fireLyricsChange(active);
			});
			lyricPan.addEventListener("input", () => {
				active.vocalPan = Number.parseInt(lyricPan.value, 10);
				lyricPanLabel.textContent = fmtPan(active.vocalPan);
				fireLyricsChange(active);
			});
			// モバイルでスライダーをちょうど中央に合わせるのは難しいため、ラベルタップで中央へ戻す
			lyricPanLabel.style.cursor = "pointer";
			lyricPanLabel.title = "タップで中央(C)へ";
			lyricPanLabel.addEventListener("click", () => {
				active.vocalPan = 64;
				lyricPan.value = "64";
				lyricPanLabel.textContent = fmtPan(64);
				fireLyricsChange(active);
			});
		}

		if (active.config.id === "chord" && showChord) {
			const div = document.createElement("div");
			div.className = "dtm-row";
			div.style.flexDirection = "column";
			div.style.alignItems = "stretch";
			div.innerHTML = `
        <div class="dtm-row" style="justify-content: space-between; align-items: center;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <span class="dtm-label">和音</span>
            <button class="dtm-infobtn" data-dtm="chord-info" title="コード進行の書き方解説">${icon("info", 12)}</button>
          </div>
          <select class="dtm-select" data-dtm="chord-pattern">
            <option value="block">ブロック</option>
            <option value="arpeggio">アルペジオ</option>
            <option value="arpeggio-fast">アルペジオ（ジャラーン）</option>
            <option value="offbeat">裏打ち</option>
            <option value="yatsume">ヤツメ穴</option>
            <option value="alternating">交互奏</option>
          </select>
        </div>
        <div class="dtm-row">
          <textarea class="dtm-textarea dtm-grow" data-dtm="chord-input" placeholder="例: C|G|Am|Em|F|C|F|G">${active.savedChordInput}</textarea>
          <button class="dtm-btn dtm-btn--primary" data-dtm="chord-apply">適用</button>
        </div>`;
			refs.trackBody.appendChild(div);
			const patternSel = div.querySelector(
				'[data-dtm="chord-pattern"]',
			) as HTMLSelectElement;
			const input = div.querySelector(
				'[data-dtm="chord-input"]',
			) as HTMLTextAreaElement;
			patternSel.value = active.savedChordPattern;
			const save = (): void => {
				active.savedChordInput = input.value;
				active.savedChordPattern = patternSel.value as ChordPatternType;
			};
			patternSel.addEventListener("change", save);
			input.addEventListener("input", save);
			(
				div.querySelector('[data-dtm="chord-info"]') as HTMLButtonElement
			).addEventListener("click", () => {
				showModal("コード進行の自動入力解説", CHORD_INFO_HTML);
			});
			(
				div.querySelector('[data-dtm="chord-apply"]') as HTMLButtonElement
			).addEventListener("click", () => {
				save();
				applyChord();
			});
		}
	};

	const switchTrack = (id: string): void => {
		activeTrackId = id;
		updateTrackPanel();
		updateUndoRedo();
		redrawAll();
	};

	const setToolMode = (mode: ToolMode): void => {
		activeToolMode = mode;
		for (const [btn, m] of [
			[refs.toolPen, "pen"],
			[refs.toolSelect, "select"],
			[refs.toolEraser, "eraser"],
		] as [HTMLButtonElement, ToolMode][]) {
			btn.classList.toggle("dtm-segbtn--active", m === mode);
		}
		if (mode !== "select") {
			selectionRect = null;
			selectedNotes = [];
		}
		redrawAll();
	};

	// ============================================================
	// MML / MIDI / コード / マクロ
	// ============================================================
	const generateMML = (): {
		full: string;
		minified: string;
		ignoredCount: number;
		trackCount: number;
		barLimit: number;
	} => {
		const barLimitBars = Number(refs.barLimitSelect.value);
		const limitSteps =
			barLimitBars > 0 ? barLimitBars * renderConfig.stepsPerBar : Infinity;
		const clipNotes = (notes: ReturnType<MMLCore["getNotes"]>) =>
			limitSteps === Infinity
				? notes
				: notes.filter((n) => n.startStep < limitSteps);

		// トラック個別楽器（空＝デフォルト/プリセットは出力しない）
		const trackInstrumentsForMeta: Record<number, string> = {};
		trackStates.forEach((t, i) => {
			if (t.trackInstrument) trackInstrumentsForMeta[i] = t.trackInstrument;
		});
		const trackInstMeta =
			Object.keys(trackInstrumentsForMeta).length > 0
				? trackInstrumentsForMeta
				: undefined;

		// トップレベル宣言（楽器プリセット・ドラムパターン・全体音量・モード）。トラックとは1対1でなく曲全体に効く。
		// 既定/未設定（楽器=空, ドラム="none"）の項目は出力しない。
		const metaLineFull = formatMmlMeta(
			{
				instrument: currentInstrument || undefined,
				drum: currentDrumPattern !== "none" ? currentDrumPattern : undefined,
				volume: masterVolume,
				drumVolume: drumVolume,
				mode: mode,
				trackInstruments: trackInstMeta,
			},
			" ",
		);
		const metaLineMini = formatMmlMeta(
			{
				instrument: currentInstrument || undefined,
				drum: currentDrumPattern !== "none" ? currentDrumPattern : undefined,
				volume: masterVolume,
				drumVolume: drumVolume,
				mode: mode,
				trackInstruments: trackInstMeta,
			},
			"",
		);

		if (refs.decomposeChordToggle.checked) {
			const ignoreHeavy = refs.ignoreChordHeavyToggle.checked;
			const targetStates = ignoreHeavy
				? trackStates.filter((t) => !isChordHeavyTrack(t.core.getNotes()))
				: trackStates;
			const ignoredCount = trackStates.length - targetStates.length;
			const allNotes = clipNotes(
				targetStates.flatMap((t) => t.core.getNotes()),
			);
			const monoTracks = decomposeToMonophonic(allNotes);
			const refCore = trackStates[0].core;
			const decomposedFull = monoTracks.map(
				(notes, i) =>
					`@${i} ${refCore.getMMLFromNotes(notes, bpm, 100).trim()}`,
			);
			const decomposedMini = monoTracks.map(
				(notes, i) =>
					`@${i}${refCore.getMMLFromNotes(notes, bpm, 100).trim().replace(/\s+/g, "")}`,
			);
			const full = [metaLineFull, ...decomposedFull, MML_END_MARKER]
				.filter((s) => s.length > 0)
				.join(";\n");
			const minified = [metaLineMini, ...decomposedMini, MML_END_MARKER]
				.filter((s) => s.length > 0)
				.join(";");
			return {
				full,
				minified,
				ignoredCount,
				trackCount: monoTracks.length,
				barLimit: barLimitBars,
			};
		}
		const trackLines: string[] = [];
		const trackLinesMini: string[] = [];

		trackStates.forEach((t, i) => {
			const notes = clipNotes(t.core.getNotes());
			if (notes.length > 0) {
				const mml = t.core.getMMLFromNotes(notes, bpm, t.volume).trim();
				trackLines.push(`@${i} ${mml}`);
				trackLinesMini.push(`@${i}${mml.replace(/\s+/g, "")}`);
			}
		});

		// 歌詞行（@@n model [v声量] [qゲート] [p定位] [oオクターブ] lyrics）。スペースは仕様上の区切りなのでminifyでも残す。
		// 声量・ゲート・定位・オクターブは既定(声量=DEFAULT_VOCAL_VOLUME, ゲート=100, 定位=64, オクターブ=0)でないときだけ v/q/p/o トークンで付与する。
		const lyricLines = trackStates
			.map((t, i) => ({
				i,
				notes: clipNotes(t.core.getNotes()),
				text: t.lyrics.replace(/[\r\n]+/g, " ").trim(),
				model: t.lyricModel.trim(),
				vol: t.vocalVolume,
				gate: t.vocalGate,
				pan: t.vocalPan,
				oct: t.vocalOctave,
			}))
			.filter(
				(x) => x.model.length > 0 && x.text.length > 0 && x.notes.length > 0,
			)
			.map((x) => {
				const params = [
					x.vol === DEFAULT_VOCAL_VOLUME ? "" : `v${x.vol}`,
					x.gate === 100 ? "" : `q${x.gate}`,
					x.pan === 64 ? "" : `p${x.pan}`,
					x.oct === 0 ? "" : `o${x.oct}`,
				]
					.filter((s) => s.length > 0)
					.join(" ");
				const head = params ? `${x.model} ${params}` : x.model;
				return `@@${x.i} ${head} ${x.text}`;
			});
		const full = [metaLineFull, ...trackLines, ...lyricLines, MML_END_MARKER]
			.filter((s) => s.length > 0)
			.join(";\n");
		const minified = [
			metaLineMini,
			...trackLinesMini,
			...lyricLines,
			MML_END_MARKER,
		]
			.filter((s) => s.length > 0)
			.join(";");
		return {
			full,
			minified,
			ignoredCount: 0,
			trackCount: trackLines.length,
			barLimit: barLimitBars,
		};
	};

	const showMML = (): void => {
		const { full, minified, ignoredCount, trackCount, barLimit } =
			generateMML();
		refs.outputFull.textContent = full;
		refs.outputMini.textContent = minified;
		const isDecompose = refs.decomposeChordToggle.checked;
		const modeLabel = isDecompose ? "和音分解" : "通常";
		const ignoredLabel =
			ignoredCount > 0 ? ` / 伴奏${ignoredCount}トラック除外` : "";
		const barLabel = barLimit > 0 ? ` / 〜${barLimit}小節` : "";
		refs.outputStatus.textContent = `[${modeLabel}] (${trackCount}トラック${ignoredLabel}${barLabel}) 通常: ${full.length}文字 / minify: ${minified.length}文字`;
		refs.outputContainer.classList.remove("dtm-hidden");
		updateUndoRedo();
	};

	const getFirstDetectedPitch = (): number | null => {
		let minStep = Number.MAX_SAFE_INTEGER;
		let candidateNotes: Note[] = [];
		for (const t of trackStates) {
			for (const note of t.core.getNotes()) {
				if (note.startStep < minStep) {
					minStep = note.startStep;
					candidateNotes = [note];
				} else if (note.startStep === minStep) {
					candidateNotes.push(note);
				}
			}
		}
		if (candidateNotes.length === 0) return null;
		const sum = candidateNotes.reduce((acc, note) => acc + note.pitch, 0);
		return Math.round(sum / candidateNotes.length);
	};

	const centerPitch = (pitch: number): void => {
		const canvas = getGridCanvas();
		const yIndex =
			renderConfig.keyCount - 1 - (pitch - renderConfig.pitchRangeStart);
		const logicalY = yIndex * renderConfig.keyHeight;
		currentOffsetY = clamp(
			logicalY - (canvas.height - renderConfig.keyHeight) / 2,
			0,
			getMaxOffsetY(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
	};

	const clearAll = (): void => {
		for (const t of trackStates) {
			t.core.resetHistory();
			t.core.clearNotesWithoutHistory();
		}
		redrawAll();
	};

	const loadMML = (mml: string): void => {
		if (!mml) return;
		stop();
		clearAll();
		for (const t of trackStates) t.core.setLoadMode(true);
		const {
			placements,
			bpm: parsedBpm,
			lyrics,
			meta,
			mergedTrackCount,
		} = parseMML(mml, {
			stepsPerBar: renderConfig.stepsPerBar,
			collectLyrics: true,
			// このDAWのトラック数を超えるチャンネルはベースへ畳み込む（従来挙動）
			clampTrackCount: trackStates.length,
		});
		// トップレベル宣言（楽器プリセット・ドラムパターン・全体音量）を復元する
		if (meta.instrument && INSTRUMENT_PRESETS[meta.instrument]) {
			currentInstrument = meta.instrument;
			options.onInstrumentChange?.(meta.instrument);
		}
		if (meta.drum && drumPatterns[meta.drum]) {
			currentDrumPattern = meta.drum;
			refs.drumSelect.value = meta.drum;
			options.onDrumChange?.(meta.drum);
		}
		if (meta.volume !== undefined) {
			masterVolume = meta.volume;
			refs.masterVolume.value = String(meta.volume);
			refs.masterVolumeLabel.textContent = `${meta.volume}%`;
		}
		if (meta.drumVolume !== undefined) {
			drumVolume = meta.drumVolume;
			refs.drumVolume.value = String(meta.drumVolume);
			refs.drumVolumeLabel.textContent = `${meta.drumVolume}%`;
		}
		// トラック個別楽器を復元する
		trackStates.forEach((t, i) => {
			const name = meta.trackInstruments?.[i] ?? "";
			if (t.trackInstrument !== name) {
				t.trackInstrument = name;
				options.onTrackInstrumentChange?.(i, name);
			}
		});

		// 歌詞トラック（@@n）を各トラックの歌詞入力へ復元する（編集UIに反映）。
		// 表示用かなは正規化済み音節を結合したもの（長音は母音かなに展開済み）。
		for (const t of trackStates) {
			t.lyrics = "";
			t.lyricModel = ""; // 既定は「なし」（歌わない）
			t.vocalVolume = DEFAULT_VOCAL_VOLUME;
			t.vocalGate = 100;
			t.vocalPan = 64;
			t.vocalOctave = 0;
		}
		lyrics?.forEach((lt) => {
			const t = trackStates[lt.trackId];
			if (!t) return;
			t.lyrics = lt.syllables.map((s) => s.kana).join("");
			t.lyricModel = lt.model;
			t.vocalVolume = lt.volume;
			t.vocalGate = lt.gate;
			t.vocalPan = lt.pan;
			t.vocalOctave = lt.octave ?? 0;
		});
		for (const p of placements) {
			const t = trackStates[p.trackIndex];
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
			});
		}
		if (parsedBpm) setBpm(parsedBpm);
		for (const t of trackStates) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		const firstPitch = getFirstDetectedPitch();
		if (firstPitch !== null) {
			centerPitch(firstPitch);
		} else {
			setDrawOffset(currentOffsetX, currentOffsetY);
		}
		redrawAll();
		updateTrackPanel(); // 読み込んだ歌詞を編集UIへ反映
		updateUndoRedo();
		// シンプルモードでは4トラックを超えるチャンネルが伴奏へ畳み込まれ合算される。
		// 起きたときだけ控えめにお知らせする（advancedモードは1:1なので出さない）。
		if (!isAdvanced && mergedTrackCount > 0) {
			refs.mmlLoadNote.textContent =
				"シンプルモードのため、一部のトラックを合算して読み込みました";
			refs.mmlLoadNote.classList.remove("dtm-hidden");
		} else {
			refs.mmlLoadNote.textContent = "";
			refs.mmlLoadNote.classList.add("dtm-hidden");
		}
	};

	const applyChord = (): void => {
		const active = getActive();
		const chordTrack = trackStates.find((t) => t.config.id === "chord");
		if (!chordTrack) return;
		const placements = buildChordPlacements({
			chordStr: active.savedChordInput,
			patternType: active.savedChordPattern,
			rootShift: active.savedChordRoot,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
		});
		chordTrack.core.clearNotesWithoutHistory();
		chordTrack.core.beginBatch();
		for (const p of placements) {
			chordTrack.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: Math.max(1, p.durationSteps),
				velocity: p.velocity,
			});
		}
		chordTrack.core.endBatch();
		chordTrack.core.addHistoryOnce();
		redrawAll();
	};

	const loadMIDI = async (bytes: Uint8Array): Promise<void> => {
		if (!options.parseMidi) return;
		const midi = await options.parseMidi(bytes);
		const analysis = analyzeMidiTracks(midi);
		const selected = analysis.filter((a) => a.selected).map((a) => a.index);
		applyMidiSelection(midi, selected);
	};

	const applyMidiSelection = (
		midi: unknown,
		selectedIndices: number[],
	): void => {
		stop();
		clearAll();
		for (const t of trackStates) t.core.setLoadMode(true);
		// MIDI入力には歌詞情報がないので全トラックの歌詞を初期化する
		for (const t of trackStates) {
			t.lyrics = "";
			t.lyricModel = "";
			t.vocalVolume = DEFAULT_VOCAL_VOLUME;
			t.vocalGate = 100;
			t.vocalPan = 64;
			t.vocalOctave = 0;
		}
		// advancedモードはMIDIトラックインデックスで1:1マッピング、simpleは役割別に自動分類
		const { placements, bpm: parsedBpm } = isAdvanced
			? extractMidiPlacementsByTrack(
					midi,
					selectedIndices,
					trackStates.map((t) => t.config.id),
				)
			: extractMidiPlacements(midi, selectedIndices);
		for (const p of placements) {
			const t = trackStates.find((ts) => ts.config.id === p.trackId);
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
				velocity: p.velocity,
			});
		}
		setBpm(Math.round(parsedBpm));
		for (const t of trackStates) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		const firstPitch = getFirstDetectedPitch();
		if (firstPitch !== null) {
			centerPitch(firstPitch);
		} else {
			setDrawOffset(currentOffsetX, currentOffsetY);
		}
		redrawAll();
		updateTrackPanel();
		updateUndoRedo();
	};

	const exportMIDI = (): Blob =>
		exportMIDIBlob({
			tracks: trackStates.map((t) => ({
				notes: t.core.getNotes(),
				volume: t.volume,
			})),
			drumPattern: drumPatterns[currentDrumPattern],
			drumVolume,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
		});

	const setBpm = (value: number): void => {
		bpm = value;
		refs.bpmInput.value = String(value);
		for (const t of trackStates) t.core.setTempo(value);
	};

	// ============================================================
	// undo / redo / copy / paste
	// ============================================================
	let lastUndoTime = 0;
	const undo = (): void => {
		const now = Date.now();
		if (now - lastUndoTime < 100) return;
		lastUndoTime = now;
		getActive().core.undo();
		redrawAll();
		updateUndoRedo();
	};
	const redo = (): void => {
		getActive().core.redo();
		redrawAll();
		updateUndoRedo();
	};

	// ============================================================
	// イベント配線
	// ============================================================
	const overlayDuring = (fn: () => void): void => {
		refs.overlay.hidden = false;
		setLoading(true);
		setTimeout(() => {
			fn();
			refs.overlay.hidden = true;
			setLoading(false);
		}, 30);
	};

	const wireEvents = (): void => {
		refs.playBtn.addEventListener("click", togglePlay);
		refs.playBtn.disabled = false;
		refs.prevBarBtn.addEventListener("click", () => {
			const targetStep = Math.max(
				0,
				Math.floor((getCurrentPlayStep() - 1) / renderConfig.stepsPerBar) *
					renderConfig.stepsPerBar,
			);
			jumpTo(targetStep);
		});
		refs.nextBarBtn.addEventListener("click", () => {
			const targetStep =
				Math.floor(getCurrentPlayStep() / renderConfig.stepsPerBar + 1) *
				renderConfig.stepsPerBar;
			jumpTo(targetStep);
		});

		refs.soloCheckbox.addEventListener("change", () => {
			isSolo = refs.soloCheckbox.checked;
		});

		refs.toolPen.addEventListener("click", () => setToolMode("pen"));
		refs.toolSelect.addEventListener("click", () => setToolMode("select"));
		refs.toolEraser.addEventListener("click", () => setToolMode("eraser"));
		refs.undoBtn.addEventListener("click", undo);
		refs.redoBtn.addEventListener("click", redo);

		refs.noteLengthSelect.addEventListener("change", () => {
			snapGridSteps = Number.parseInt(refs.noteLengthSelect.value, 10);
			currentInsertLength = snapGridSteps;
			redrawAll();
		});
		refs.bpmInput.addEventListener("input", () => {
			setBpm(Number.parseInt(refs.bpmInput.value, 10) || 120);
		});

		refs.zoomXIn.addEventListener("click", () => {
			zoomX = Math.min(200, zoomX + 25);
			applyZoomX();
			notifyViewState();
		});
		refs.zoomXOut.addEventListener("click", () => {
			zoomX = Math.max(25, zoomX - 25);
			applyZoomX();
			notifyViewState();
		});
		refs.zoomYIn.addEventListener("click", () => {
			zoomY = Math.min(200, zoomY + 25);
			applyZoomY();
			notifyViewState();
		});
		refs.zoomYOut.addEventListener("click", () => {
			zoomY = Math.max(50, zoomY - 25);
			applyZoomY();
			notifyViewState();
		});

		// 和音分解モード / 和音伴奏トラック無視のチェック状態変化を通知（永続化用）
		refs.decomposeChordToggle.addEventListener("change", notifyViewState);
		refs.ignoreChordHeavyToggle.addEventListener("change", notifyViewState);

		refs.masterVolume.addEventListener("input", () => {
			masterVolume = Number.parseInt(refs.masterVolume.value, 10) || 0;
			refs.masterVolumeLabel.textContent = `${masterVolume}%`;
		});
		refs.drumSelect.addEventListener("change", () => {
			currentDrumPattern = refs.drumSelect.value;
			options.onDrumChange?.(currentDrumPattern);
		});
		refs.drumVolume.addEventListener("input", () => {
			drumVolume = Number.parseInt(refs.drumVolume.value, 10) || 0;
			refs.drumVolumeLabel.textContent = `${drumVolume}%`;
		});

		// マクロ
		refs.macroClear.addEventListener("click", () => {
			const active = getActive();
			active.core.beginBatch();
			active.core.clearNotesWithoutHistory();
			active.core.endBatch();
			active.core.saveHistory();
			redrawAll();
		});
		refs.macroRandom.addEventListener("click", () => {
			generateRandomPattern(getActive().core, {
				stepsPerBar: renderConfig.stepsPerBar,
				startStep: playStartStep,
				pitchRangeStart: renderConfig.pitchRangeStart,
			});
			redrawAll();
		});
		refs.macroHarmonic.addEventListener("click", () => {
			const chord = trackStates.find((t) => t.config.id === "chord");
			if (!chord || activeTrackId === "chord") return;
			applyHarmonicFilter(getActive().core, chord.core, {
				stepsPerBar: renderConfig.stepsPerBar,
			});
			redrawAll();
		});
		refs.macroMono.addEventListener("click", () => {
			const chord = trackStates.find((t) => t.config.id === "chord");
			if (!chord || activeTrackId === "chord") return;
			applyMonophonic(getActive().core, chord.core, {
				stepsPerBar: renderConfig.stepsPerBar,
			});
			redrawAll();
		});

		// 出力
		refs.generateMmlBtn.addEventListener("click", showMML);
		refs.exportMidiBtn.addEventListener("click", () => {
			const blob = exportMIDI();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "dtm.mid";
			a.click();
			URL.revokeObjectURL(url);
		});
		const copy = (text: string, btn: HTMLButtonElement): void => {
			navigator.clipboard?.writeText(text);
			btn.classList.add("dtm-btn--success");
			setTimeout(() => btn.classList.remove("dtm-btn--success"), 1200);
		};
		refs.copyFullBtn.addEventListener("click", () =>
			copy(refs.outputFull.textContent ?? "", refs.copyFullBtn),
		);
		refs.copyMiniBtn.addEventListener("click", () =>
			copy(refs.outputMini.textContent ?? "", refs.copyMiniBtn),
		);

		// MML/MIDI入力
		refs.mmlLoadBtn.addEventListener("click", () =>
			overlayDuring(() => loadMML(refs.mmlInput.value)),
		);

		// サンプル再生用状態変数
		let activeSamplePlayer: import("./mml-player").MmlPlayerInstance | null =
			null;
		let activeSampleButton: HTMLButtonElement | null = null;

		const collapseActiveSample = (): void => {
			if (activeSamplePlayer) {
				activeSamplePlayer.stop();
				activeSamplePlayer.destroy();
				activeSamplePlayer = null;
			}
			if (activeSampleButton) {
				activeSampleButton.textContent = "▶ 試聴";
				activeSampleButton.classList.remove("dtm-btn--danger");
				activeSampleButton.classList.add("dtm-btn--primary");
				const box = activeSampleButton.closest(".dtm-modal-sample-box");
				const container = box?.querySelector(
					".dtm-modal-sample-player-container",
				);
				if (container) container.innerHTML = "";
				activeSampleButton = null;
			}
		};

		// 解説モーダル初期化とイベントハンドラ
		showModal = (title: string, bodyHTML: string): void => {
			collapseActiveSample();

			refs.modalTitle.textContent = title;
			refs.modalBody.innerHTML = bodyHTML;
			refs.modalOverlay.removeAttribute("hidden");

			// コピーボタンのイベント接続
			const copyBtns = refs.modalBody.querySelectorAll(
				".dtm-modal-sample-copy-btn",
			);
			for (const btn of copyBtns) {
				btn.addEventListener("click", () => {
					const mml = btn.getAttribute("data-mml") || "";
					navigator.clipboard.writeText(mml).then(() => {
						const originalText = btn.textContent;
						btn.textContent = "✓ コピー完了";
						btn.classList.add("dtm-btn--success");
						setTimeout(() => {
							btn.textContent = originalText;
							btn.classList.remove("dtm-btn--success");
						}, 1200);
					});
				});
			}

			// 試聴ボタンのイベント接続
			const playBtns = refs.modalBody.querySelectorAll(
				".dtm-modal-sample-play-btn",
			);
			for (const btn of playBtns) {
				const htmlBtn = btn as HTMLButtonElement;
				htmlBtn.addEventListener("click", () => {
					const sampleBox = htmlBtn.closest(".dtm-modal-sample-box");
					const container = sampleBox?.querySelector(
						".dtm-modal-sample-player-container",
					) as HTMLElement;
					const mml = htmlBtn.getAttribute("data-mml") || "";

					if (activeSampleButton === htmlBtn) {
						if (activeSamplePlayer?.isPlaying()) {
							activeSamplePlayer.stop();
						} else {
							stop(); // メインエディタの再生を停止
							if (activeSamplePlayer) {
								activeSamplePlayer.play();
								htmlBtn.textContent = "■ 停止";
								htmlBtn.classList.remove("dtm-btn--primary");
								htmlBtn.classList.add("dtm-btn--danger");
							}
						}
					} else {
						collapseActiveSample();
						stop(); // メインエディタの再生を停止

						activeSampleButton = htmlBtn;
						htmlBtn.textContent = "■ 停止";
						htmlBtn.classList.remove("dtm-btn--primary");
						htmlBtn.classList.add("dtm-btn--danger");

						if (container) {
							container.innerHTML = "";
							const player = mountMmlPlayer(container, mml, {
								onPlayNote: (e) => {
									if (options.onPlayNote) {
										const trackIndex = Number(e.trackId);
										const config = trackConfigs[trackIndex];
										const mappedTrackId = config ? config.id : e.trackId;
										options.onPlayNote({
											...e,
											trackId: mappedTrackId,
										});
									}
								},
								onPlayDrum: options.onPlayDrum,
								onResumeAudio: options.onResumeAudio,
								getAudioTime: options.getAudioTime,
								singingVoices: options.singingVoices,
								drumPatterns: options.drumPatterns,
								volume: masterVolume,
								onStop: () => {
									if (activeSampleButton === htmlBtn) {
										htmlBtn.textContent = "▶ 試聴";
										htmlBtn.classList.remove("dtm-btn--danger");
										htmlBtn.classList.add("dtm-btn--primary");
									}
								},
							});
							activeSamplePlayer = player;
							player.play();
						}
					}
				});
			}
		};
		refs.modalClose.addEventListener("click", () => {
			collapseActiveSample();
			refs.modalOverlay.setAttribute("hidden", "");
		});
		refs.modalOverlay.addEventListener("click", (e) => {
			if (e.target === refs.modalOverlay) {
				collapseActiveSample();
				refs.modalOverlay.setAttribute("hidden", "");
			}
		});

		refs.mmlInfoBtn.addEventListener("click", () => {
			showModal("MMLの書き方解説", MML_INFO_HTML);
		});
		refs.midiInfoBtn.addEventListener("click", () => {
			showModal("MIDIの読み込み解説", MIDI_INFO_HTML);
		});
		refs.shiftApplyBtn.addEventListener("click", () =>
			overlayDuring(() => {
				shiftNotes(
					trackStates.map((t) => t.core),
					Number.parseInt(refs.shiftSelect.value, 10) || 0,
				);
				redrawAll();
			}),
		);

		if (showMidi) wireMidi();

		// キーボードショートカット
		document.addEventListener("keydown", onKeyDown);

		// 入力欄のキー伝搬抑制（動的追加要素にも対応するため委譲）
		refs.root.addEventListener("keydown", (e) => {
			const t = e.target as Element;
			if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT") return;
			const ke = e as KeyboardEvent;
			if (
				(ke.ctrlKey || ke.metaKey) &&
				["KeyZ", "KeyY", "KeyV", "KeyC", "KeyX"].includes(ke.code)
			)
				e.stopPropagation();
		});
	};

	let pendingMidi: unknown = null;
	let detectedTracks: ReturnType<typeof analyzeMidiTracks> = [];
	const wireMidi = (): void => {
		refs.midiInput.addEventListener("change", async () => {
			const file = refs.midiInput.files?.[0];
			if (!file || !options.parseMidi) return;
			refs.overlay.hidden = false;
			setLoading(true);
			const buffer = new Uint8Array(await file.arrayBuffer());
			pendingMidi = await options.parseMidi(buffer);
			detectedTracks = analyzeMidiTracks(pendingMidi);
			refs.midiTrackSelection.innerHTML = `<span class="dtm-label">トラック</span>`;
			detectedTracks.forEach((t, i) => {
				const btn = document.createElement("button");
				btn.className = `dtm-btn ${t.selected ? "dtm-btn--primary" : "dtm-btn--ghost"}`;
				btn.dataset.selected = String(t.selected);
				btn.textContent = `${t.name} (${t.noteCount})`;
				btn.addEventListener("click", () => {
					const on = btn.dataset.selected !== "true";
					btn.dataset.selected = String(on);
					btn.classList.toggle("dtm-btn--primary", on);
					btn.classList.toggle("dtm-btn--ghost", !on);
				});
				refs.midiTrackSelection.appendChild(btn);
				if (i === 0) refs.midiTrackSelection.dataset.ready = "1";
			});
			refs.midiTrackSelection.classList.remove("dtm-hidden");
			refs.overlay.hidden = true;
			setLoading(false);
		});
		refs.midiLoadBtn.addEventListener("click", () => {
			if (!pendingMidi) return;
			const selected: number[] = [];
			const btns = refs.midiTrackSelection.querySelectorAll("button");
			btns.forEach((b, i) => {
				if ((b as HTMLElement).dataset.selected === "true")
					selected.push(detectedTracks[i].index);
			});
			if (selected.length === 0) return;
			overlayDuring(() => applyMidiSelection(pendingMidi, selected));
		});
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.code === "KeyZ" && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") {
			e.preventDefault();
			redo();
		} else if (e.code === "KeyC" && selectedNotes.length > 0) {
			e.preventDefault();
			copiedNotes = [...selectedNotes];
		} else if (e.code === "KeyX" && selectedNotes.length > 0) {
			e.preventDefault();
			if (!isActiveLocked()) {
				copiedNotes = [...selectedNotes];
				const core = getActive().core;
				core.beginBatch();
				for (const n of selectedNotes) core.deleteNoteById(n.id);
				core.endBatch();
				selectedNotes = [];
			}
		} else if (e.code === "KeyV" && copiedNotes.length > 0) {
			e.preventDefault();
			if (isActiveLocked()) return;
			const core = getActive().core;
			const notes = core.getNotes();
			const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
			core.beginBatch();
			for (const note of copiedNotes) {
				const newStart = playStartStep + (note.startStep - minStart);
				const newEnd = newStart + note.durationSteps;
				const overlap = notes.some(
					(ex) =>
						ex.pitch === note.pitch &&
						newStart < ex.startStep + ex.durationSteps &&
						newEnd > ex.startStep,
				);
				if (!overlap)
					core.addNote(newStart, note.pitch, {
						noteLengthSteps: note.durationSteps,
						velocity: note.velocity,
					});
			}
			core.endBatch();
			redrawAll();
		}
	};

	// ============================================================
	// 初期化
	// ============================================================
	setupCanvas(); // renderer.init() で g_config を設定
	createTrackStates(); // g_config 設定後に MMLCore を生成
	ready = true;
	initScrollbarDrag();
	wireEvents();
	setBpm(bpm);
	updateTrackPanel();
	updateTransport();
	updateUndoRedo();
	redrawAll();
	if (options.initialMML) loadMML(options.initialMML);

	// リサイズ対応（Canvas再構築）
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	const resizeObserver = new ResizeObserver(() => {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => setupCanvas(), 150);
	});
	resizeObserver.observe(refs.rollContainer);

	// document レベルのリスナ（pointermove/up）
	document.addEventListener("pointermove", onPointerMove);
	document.addEventListener("pointerup", onPointerUp);

	const setLoading = (loading: boolean): void => {
		refs.topbar.classList.toggle("is-loading", loading);
	};

	const getCurrentPlayStep = (): number => {
		if (playbackState === "playing") return currentPlayStep;
		if (playbackState === "paused") return pausedPlayStep;
		return playStartStep;
	};

	const jumpTo = async (step: number): Promise<void> => {
		const wasPlaying = playbackState === "playing";
		if (wasPlaying) {
			sequencer.stop();
			options.singingVoices?.stopStream();
			playStartStep = step;
			pausedPlayStep = step;
			currentPlayStep = step;
			playbackState = "paused";
			await play();
		} else {
			forcePauseAt(step);
		}
	};

	const forcePauseAt = (step: number): void => {
		playStartStep = step;
		pausedPlayStep = step;
		currentPlayStep = step;
		playbackState = "paused";

		const canvas = getGridCanvas();
		currentOffsetX = Math.max(
			0,
			step * renderConfig.stepWidth - canvas.width * 0.5,
		);
		setDrawOffset(currentOffsetX, currentOffsetY);

		updateTransport();
		redrawAll();
	};

	// ============================================================
	// 公開API
	// ============================================================
	return {
		play,
		pause,
		stop,
		getMML: generateMML,
		setInstrument: (name: string) => {
			currentInstrument = name;
		},
		getDrum: () => currentDrumPattern,
		setDrum: (name: string) => {
			// "none"（ドラムなし）も有効な選択肢。それ以外は既知のパターンのみ受け付ける
			if (name !== "none" && !drumPatterns[name]) return;
			currentDrumPattern = name;
			refs.drumSelect.value = name;
			options.onDrumChange?.(name);
		},
		getViewState,
		setViewState: (state: Partial<DawViewState>) => {
			if (typeof state.zoomX === "number") {
				zoomX = clamp(state.zoomX, 25, 200);
				applyZoomX();
			}
			if (typeof state.zoomY === "number") {
				zoomY = clamp(state.zoomY, 50, 200);
				applyZoomY();
			}
			if (typeof state.decomposeChord === "boolean") {
				refs.decomposeChordToggle.checked = state.decomposeChord;
			}
			if (typeof state.ignoreChordHeavy === "boolean") {
				refs.ignoreChordHeavyToggle.checked = state.ignoreChordHeavy;
			}
		},
		loadMML,
		loadMIDI,
		exportMIDI,
		setBpm,
		getPlaybackState: () => playbackState,
		getCurrentPlayStep,
		forcePauseAt,
		setLoading,
		applyPatch: (
			trackId: string,
			added: import("./types").NoteData[],
			removed: import("./types").NoteRemove[],
		): void => {
			const track = trackStates.find((t) => t.config.id === trackId);
			if (!track) return;
			suppressPatch = true;
			track.core.beginBatch();
			for (const n of added) {
				track.core.addNote(n.startStep, n.pitch, {
					noteLengthSteps: n.durationSteps,
					velocity: n.velocity,
				});
			}
			for (const r of removed) {
				const note = track.core
					.getNotes()
					.find((n) => n.startStep === r.startStep && n.pitch === r.pitch);
				if (note) track.core.deleteNoteById(note.id);
			}
			track.core.endBatch();
			suppressPatch = false;
			redrawAll();
		},
		setTrackVisible: (trackId: string, visible: boolean): void => {
			if (visible) hiddenTracks.delete(trackId);
			else hiddenTracks.add(trackId);
			redrawAll();
		},
		setTrackAudible: (trackId: string, audible: boolean): void => {
			if (audible) audioMutedTracks.delete(trackId);
			else audioMutedTracks.add(trackId);
		},
		applyLyrics: (
			trackId: string,
			data: import("./types").LyricSyncData,
		): void => {
			const t = trackStates.find((s) => s.config.id === trackId);
			if (!t) return;
			t.lyrics = data.lyrics;
			t.lyricModel = data.model;
			t.vocalVolume = data.vocalVolume;
			t.vocalGate = data.vocalGate;
			t.vocalPan = data.vocalPan;
			t.vocalOctave = data.vocalOctave;
		},
		noteToCanvas: (step: number, pitch: number) => {
			const canvas = getGridCanvas();
			const x = step * renderConfig.stepWidth - currentOffsetX;
			const y =
				(renderConfig.keyCount - 1 - pitch) * renderConfig.keyHeight -
				currentOffsetY;
			const onScreen =
				x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height;
			let side: "left" | "right" | "top" | "bottom" | null = null;
			if (!onScreen) {
				if (x < 0) side = "left";
				else if (x > canvas.width) side = "right";
				else if (y < 0) side = "top";
				else side = "bottom";
			}
			return { x, y, onScreen, side };
		},
		destroy: () => {
			sequencer.stop();
			options.singingVoices?.stopStream();
			resizeObserver.disconnect();
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
			document.removeEventListener("keydown", onKeyDown);
			target.innerHTML = "";
		},
	};
};
