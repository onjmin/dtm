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

// UIユーティリティ
export { DAW_CSS, injectStyles } from "./styles";
export * from "./types";
