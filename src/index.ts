// ============================================================
// Layer 2: フルDAW（簡易な1関数でマウント）
// ============================================================

// 設定・プリセット
export * from "./audio-config";
export * from "./chords";
export { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./daw";
export * from "./drum-config";
export { icon } from "./icons";
export * from "./instrument-presets";
export * from "./linked-list";
// 歌詞拡張（@@n model lyrics）— 解析・正規化・同期・歌唱合成ヘルパ
export * from "./lyrics";
export * from "./macros";
export * from "./midi-io";
// ============================================================
// Layer 1: ヘッドレスコア & プリミティブ
// ============================================================
export * from "./mml-core";
// 補助ロジック（再利用可能）
export * from "./mml-parser";
export type { MmlPlayerInstance, MmlPlayerOptions } from "./mml-player";
// 再生専用ビュー（mountDAW と対）
export { mountMmlPlayer } from "./mml-player";
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
export { DAW_CSS, injectStyles } from "./styles";
export * from "./types";
