// ============================================================
// Layer 2: フルDAW（簡易な1関数でマウント）
// ============================================================

// 設定・プリセット
export * from "./audio-config";
export * from "./chord-player";
export * from "./chords";
// 自動作曲（コード進行→リズム→モチーフ展開で16小節を組み立てる）
export {
	type ComposedNote,
	type ComposeOptions,
	type ComposeResult,
	type ComposeStats,
	composeSong,
	durationEntropy,
} from "./compose";
// 作曲の採点に使う目標帯（人間の曲から実測したもの）
export { CORPUS_BANDS, CORPUS_SIZE } from "./compose-corpus";
// 生成物の良さを測る指標（順序に依存する構造の指標・緊張カーブ・曲どうしの距離）
export {
	type Band,
	band,
	complementarity,
	featureDistance,
	featureVector,
	type MetricNote,
	type MetricOptions,
	type StructureFeatures,
	structureFeatures,
	type TensionFeatures,
	tensionFeatures,
} from "./compose-metrics";
export {
	buildSectionPlan,
	DEFAULT_SECTIONS,
	type PlacedSection,
	SECTION_LABELS,
	SECTION_ORDER,
	SECTION_SPECS,
	type SectionKind,
	type SectionSpec,
} from "./compose-sections";
export { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./daw";
export * from "./drum-config";
// ヘッドレス再生（DOM非依存・BGM向け）＋ 内蔵synthプリミティブ
export {
	type MmlPlayback,
	type PlayChordsOptions,
	type PlayMmlOptions,
	type PlayNoteOptions,
	type PlayPlacementsOptions,
	playChords,
	playMML,
	playNote,
	playPlacements,
} from "./headless-player";
export {
	type PlaySingingMmlOptions,
	playSingingMML,
} from "./headless-singing-player";
export { icon } from "./icons";
export * from "./instrument-presets";
export * from "./linked-list";
// 歌詞拡張（@@n model lyrics）— 解析・正規化・同期・歌唱合成ヘルパ
export * from "./lyrics";
export * from "./macros";
export * from "./midi-io";
export type {
	MidiSearchConfig,
	PicotuneSearchParams,
	PicotuneSong,
} from "./midi-search";
export { MidiSearchClient } from "./midi-search";
// ============================================================
// Layer 1: ヘッドレスコア & プリミティブ
// ============================================================
export * from "./mml-core";
// 補助ロジック（再利用可能）
export * from "./mml-parser";
export type { MmlPlayerInstance, MmlPlayerOptions } from "./mml-player";
// 再生専用ビュー（mountDAW と対）
export { decodeMml, encodeMml, mountMmlPlayer } from "./mml-player";
export * from "./piano-roll";
export * from "./renderer";
export * from "./sequencer";
// ============================================================
// Layer 3: 全部入りスタジオ（CDN SoundFont + 歌声 + 録音 を内包）
// ============================================================
export {
	createDtmStudio,
	type DtmStudio,
	type DtmStudioEngines,
	type DtmStudioOptions,
	type ModeSwitchInstance,
	type ModeSwitchOptions,
	type MountEditorOptions,
	type MountPlayerOptions,
	type PresetSelectInstance,
	type PresetSelectOptions,
} from "./studio";
// UIユーティリティ
export { DAW_CSS, injectStyles, showLoadingOverlay } from "./styles";
export { createSynth, freqFromPitch, type Synth } from "./synth";
// 音律とピッチの内部表現（units ⇄ Hz / MIDI、五度圏、協調編集のバージョン）
export * from "./tuning";
export type { NoteData, NoteRemove } from "./types";
export * from "./types";
export { VOICE_IMAGES } from "./voice-images";
export { concatFloat32, encodeWavPCM16 } from "./wav-export";
