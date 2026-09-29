// ============================================================
// Layer 2: フルDAW（簡易な1関数でマウント）
// ============================================================

// 設定・プリセット
export * from "./audio/audio-config";
// 伴奏音源（mp3 / wav / YouTube）の同時再生
export {
	type BackingAudio,
	type BackingAudioOptions,
	type BackingLoaded,
	type BackingMode,
	type BackingStartOptions,
	backingMediaSec,
	createBackingAudio,
	formatTimeSec,
	isYoutubeUrl,
	parseTimeSec,
	parseYoutubeId,
	resolveYoutubeThumbnail,
} from "./audio/backing-audio";
export * from "./audio/sequencer";
export { createSynth, freqFromPitch, type Synth } from "./audio/synth";
// 音律とピッチの内部表現（units ⇄ Hz / MIDI、五度圏、協調編集のバージョン）
export * from "./audio/tuning";
export { concatFloat32, encodeWavPCM16 } from "./audio/wav-export";
export * from "./chord/chord-player";
export * from "./chord/chords";
// 自動作曲（コード進行→リズム→モチーフ展開で16小節を組み立てる）
export {
	type ComposedNote,
	type ComposeOptions,
	type ComposeResult,
	type ComposeStats,
	composeSong,
	durationEntropy,
	type MelodyForm,
} from "./compose/compose";
// 伴奏主体モード（旋律をほとんど置かず、分散和音・低音・和音で約2分半〜3分のループ曲を作る。
// docs/accomp-compose.md）
export {
	type AccompGate,
	type AccompMix,
	type AccompOptions,
	type AccompPlan,
	type AccompRegion,
	type AccompRole,
	type AccompSlot,
	type AccompSong,
	type AccompStats,
	type AccompTexture,
	type AccompTrack,
	accompMeta,
	composeAccomp,
} from "./compose/compose-accomp";
export {
	type AccompMmlProvenance,
	accompToMml,
} from "./compose/compose-accomp-mml";
// 作曲の採点に使う目標帯（人間の曲から実測したもの）
export { CORPUS_BANDS, CORPUS_SIZE } from "./compose/compose-corpus";
// ベース調・調性格・雰囲気グループ
export {
	COMPOSE_KEYS,
	COMPOSE_MOOD_GROUPS,
	type ComposeKeyTarget,
	type ComposeMoodGroup,
	type ComposeMoodId,
	getComposeKeyDescription,
	type KeyMode,
	MAJOR_KEY_IDS,
	MINOR_KEY_IDS,
	type ResolvedComposeKey,
	resolveComposeKey,
} from "./compose/compose-keys";
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
} from "./compose/compose-metrics";
// 音階（琉球・都節・律・チャーチモード・和声的短音階・ヒジャーズ・ハンガリアン・ブルース）
export {
	BLUES_SCALE,
	COMPOSE_SCALE_IDS,
	COMPOSE_SCALES,
	type ComposeScale,
	type ComposeScaleId,
	getComposeScaleDescription,
	HARMONIC_MINOR_SCALE,
	HUNGARIAN_SCALE,
	MAJOR_SCALE,
	resolveCenter,
	resolveComposeScale,
	type ScaleDegree,
	scaleDegrees,
	scaleSize,
	type TonicCenter,
	type TonicDegree,
} from "./compose/compose-scales";
export {
	buildSectionPlan,
	DEFAULT_SECTIONS,
	type PlacedSection,
	SECTION_LABELS,
	SECTION_ORDER,
	SECTION_SPECS,
	type SectionKind,
	type SectionSpec,
	sectionPlanBarRange,
} from "./compose/compose-sections";
export * from "./instruments/drum-config";
export * from "./instruments/instrument-presets";
// 旋律楽器の音源バンク（`#t<n>font=`）の一覧・正規化
export * from "./instruments/soundfont-banks";
export * from "./io/midi-io";
export type {
	MidiSearchConfig,
	PicotuneSearchParams,
	PicotuneSong,
} from "./io/midi-search";
export { MidiSearchClient } from "./io/midi-search";
// MusicXML 入出力 — 楽譜としての読み書き。MIDI と違ってパートと歌詞が明示される
export {
	type ExportMusicXmlOptions,
	type ExportMusicXmlPart,
	exportMusicXML,
	type MusicXmlExtraction,
	type MusicXmlNotePlacement,
	type MusicXmlPart,
	musicXmlToNotes,
	parseMusicXML,
} from "./io/musicxml-io";
// UST（UTAU）入出力 — 歌詞付きで読み込み、選択中のトラックを書き出す
export * from "./io/ust-io";
export * from "./linked-list";
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
} from "./mml/headless-player";
export * from "./mml/macros";
// ============================================================
// Layer 1: ヘッドレスコア & プリミティブ
// ============================================================
export * from "./mml/mml-core";
// 補助ロジック（再利用可能）
export * from "./mml/mml-parser";
export type { MmlPlayerInstance, MmlPlayerOptions } from "./mml/mml-player";
// 再生専用ビュー（mountDAW と対）
export { decodeMml, encodeMml, mountMmlPlayer } from "./mml/mml-player";
// 音符ごとの強弱（v）の読み書き規則。MML の v（実効値）⇄ {トラック音量, 相対 velocity}
export { effectiveVelocity, splitTrackVelocity } from "./mml/mml-velocity";
export type { NoteData, NoteRemove } from "./types";
export * from "./types";
export { mountDAW, TRACKS_ADVANCED, TRACKS_SIMPLE } from "./ui/daw";
export { icon } from "./ui/icons";
export * from "./ui/piano-roll";
export * from "./ui/renderer";
export * from "./ui/state/global-state";
export * from "./ui/state/macro-state";
// ============================================================
// Layer 3: 全部入りスタジオ（CDN SoundFont + 歌声 + 録音 を内包）
// ============================================================
export {
	createDtmStudio,
	DEFAULT_SPEECH_MODEL,
	type DtmStudio,
	type DtmStudioEngines,
	type DtmStudioOptions,
	type ModeSwitchInstance,
	type ModeSwitchOptions,
	type MountEditorOptions,
	type MountPlayerOptions,
	type PresetSelectInstance,
	type PresetSelectOptions,
} from "./ui/studio";
// UIユーティリティ
export { DAW_CSS, injectStyles, showLoadingOverlay } from "./ui/styles";
// ガイドツアー（スポットライト型ウォークスルー）。mountDAW に依存しないので、
// 埋め込み側が自分のUIを指すステップを書いて単体で呼ぶこともできる。
export {
	clearTourSeen,
	DAW_TOUR_BRANCHES,
	DAW_TOUR_STEPS,
	hasSeenTour,
	isTourTargetVisible,
	markTourSeen,
	startTour,
	TOUR_STORAGE_KEY,
	type TourBranch,
	type TourInstance,
	type TourLabels,
	type TourOptions,
	type TourStep,
} from "./ui/tour";
// ライブラリのバージョン。書き出したMML/MIDI/MusicXMLに埋まる値
export { DTM_VERSION } from "./version";
export {
	type PlaySingingMmlOptions,
	playSingingMML,
} from "./voice/headless-singing-player";
// 歌詞拡張（@@n model lyrics）— 解析・正規化・同期・歌唱合成ヘルパ
export * from "./voice/lyrics";
// 中国語ピンイン → かな の転写（中国語USTの取り込みに使う）
export * from "./voice/pinyin";
// 語り（歌詞の「…」）— UtauTTS の計画器とプレビュー用ヘルパ
export * from "./voice/speech";
// 単発の語り（speak）で遅れて届いたチャンクの扱い（SpeakVoiceOptions.lateChunks）
export type { SpeechLateChunks } from "./voice/speech-schedule";
export { VOICE_IMAGES } from "./voice/voice-images";
