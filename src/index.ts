// ============================================================
// Layer 2: フルDAW（簡易な1関数でマウント）
// ============================================================

// 設定・プリセット
export * from "./audio-config";
export * from "./chords";
export { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./daw";
export * from "./drum-config";
// ヘッドレス再生（DOM非依存・BGM向け）＋ 内蔵synthプリミティブ
export {
	type MmlPlayback,
	type PlayMmlOptions,
	playMML,
	playPlacements,
	type PlayPlacementsOptions,
	playNote,
	type PlayNoteOptions,
	playChords,
	type PlayChordsOptions,
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
export type { NoteData, NoteRemove } from "./types";
export * from "./types";
export { VOICE_IMAGES } from "./voice-images";
