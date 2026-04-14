/**
 * 楽器プリセット定義
 * FluidR3_GM Instrument Presets
 *
 * 独自の価値観に基づくソート基準:
 * 1. 汎用性 (Standard): どんな曲にも合う基本セット
 * 2. 時代感 (Vibe): シンセやレトロなど特定の空気感
 * 3. 世界観 (World): 特定の地域やファンタジー
 * 4. 感情 (Atmosphere): アンビエントやシネマティック
 */

export type InstrumentPreset = {
	displayName: string;
	description: string;
	melody: string;
	submelody: string;
	bass: string;
	chord: string;
};

export const INSTRUMENT_PRESETS: Record<string, InstrumentPreset> = {
	// --- STANDARD: 汎用性と完成度重視 ---
	piano: {
		displayName: "グランドピアノ",
		description: "最も破綻しにくい構成。楽曲制作のスケッチにも最適。",
		melody: "Acoustic Grand Piano",
		submelody: "Vibraphone",
		bass: "Electric Bass (finger)",
		chord: "Pad 2 (warm)",
	},
	acoustic: {
		displayName: "アコースティック",
		description: "生楽器の温かみを重視。フォークやポップスに。",
		melody: "Acoustic Guitar (steel)",
		submelody: "Harmonica",
		bass: "Acoustic Bass",
		chord: "Acoustic Guitar (nylon)",
	},
	jazz_night: {
		displayName: "ジャズ・ナイト",
		description: "Rhodes風のEPとウッドベースによる、大人びたアンサンブル。",
		melody: "Electric Piano 1",
		submelody: "Flute",
		bass: "Acoustic Bass",
		chord: "Electric Guitar (jazz)",
	},

	// --- MODERN & VIBE: エッジの効いた現代的な響き ---
	synth_pop: {
		displayName: "シンセポップ",
		description: "80s〜現代まで。抜けるリードと太いベースの王道。",
		melody: "Lead 2 (sawtooth)",
		submelody: "Lead 4 (chiff)",
		bass: "Synth Bass 2",
		chord: "Pad 3 (polysynth)",
	},
	cyber_punk: {
		displayName: "サイバーパンク",
		description: "デジタルな冷たさと歪みが混ざり合う、未来的な響き。",
		melody: "Lead 8 (bass + lead)",
		submelody: "Lead 5 (charang)",
		bass: "Synth Bass 2",
		chord: "Pad 8 (sweep)",
	},
	rock: {
		displayName: "ハードロック",
		description: "歪みギターと重厚なベースで、パワーを前面に。",
		melody: "Distortion Guitar",
		submelody: "Rock Organ",
		bass: "Electric Bass (pick)",
		chord: "Overdriven Guitar",
	},

	// --- WORLD & CLASSIC: 特定のジャンル・地域 ---
	orchestra: {
		displayName: "オーケストラ",
		description: "壮大な物語を予感させる、管弦楽器の重厚な響き。",
		melody: "French Horn",
		submelody: "Pizzicato Strings",
		bass: "Cello",
		chord: "Tremolo Strings",
	},
	japanese_wa: {
		displayName: "和風・雅",
		description: "琴と三味線の繊細な調べに、尺八の情緒を添えて。",
		melody: "Koto",
		submelody: "Shamisen",
		bass: "Taiko Drum",
		chord: "Shakuhachi",
	},
	arabic_exotic: {
		displayName: "エキゾチック",
		description: "シタールやバグパイプによる、異国情緒溢れるサウンド。",
		melody: "Sitar",
		submelody: "Bagpipe",
		bass: "Fretless Bass",
		chord: "Kalimba",
	},

	// --- FANTASY & ATMOSPHERE: 雰囲気と余韻 ---
	fantasy_rpg: {
		displayName: "ファンタジーRPG",
		description: "オカリナとハープが紡ぐ、冒険と魔法の世界観。",
		melody: "Ocarina",
		submelody: "Celesta",
		bass: "Timpani",
		chord: "Orchestral Harp",
	},
	ambient_cloud: {
		displayName: "アンビエント",
		description: "輪郭をぼかした音色で、深い没入感と余韻を演出。",
		melody: "Lead 6 (voice)",
		submelody: "Music Box",
		bass: "Synth Bass 1",
		chord: "Pad 7 (halo)",
	},
	retro_game: {
		displayName: "8-bit レトロ",
		description: "矩形波を想起させる、初期ゲーム機のような懐かしい響き。",
		melody: "Lead 1 (square)",
		submelody: "Lead 2 (sawtooth)",
		bass: "Synth Bass 1",
		chord: "Clavinet",
	},
};
