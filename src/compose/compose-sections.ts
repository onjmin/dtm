/**
 * 曲のセクション（イントロ・Aメロ・Bメロ・サビ・Cメロ・落ちサビ・間奏・アウトロ）。
 *
 * 人が聴いて最初に分かるのは和音や音程ではなく**「ここはAメロだ」「サビに入った」という
 * 切り替わり**なので、どの小節が何なのかを持っていないと、細部を詰めても
 * 「曲の一部を切り出したもの」にしかならない。
 *
 * ## セクションごとに何を変えるか
 *
 * | | メロディ | 音域 | 密度 | 終わり方 |
 * |---|---|---|---|---|
 * | イントロ | 無し | — | — | — |
 * | Aメロ | 有り | 低め | 控えめ | 半終止 |
 * | Bメロ | 有り | 中 | 上げる | ドミナントで宙吊り |
 * | サビ | 有り | 高い | 最大 | 主音へ全終止 |
 * | Cメロ | 有り | 中高 | やや控えめ | 解決しない音 |
 * | 落ちサビ | 有り | 高い | 薄い | 主音へ全終止 |
 * | 間奏 | 無し | — | — | — |
 * | アウトロ | 有り | 低め | 薄い | 主音へ全終止 |
 *
 * メロディを書かないセクション（イントロ・間奏）でも、伴奏・ベース・ドラムは鳴る。
 * ここを「メロディが無いだけの同じ小節」にすると、結局のっぺりしたままになるので、
 * 伴奏の奏法で差を付ける。
 *
 * **ドラムはセクションで変えない。** 自動作曲のドラムは曲を通して固定パターンを
 * 選ぶ仕様なので（`compose.ts` の `pickBuiltinDrum`）、セクションごとの強度は持たない。
 *
 * 同じセクションの**繰り返し**が曲の基本構造なので、{@link STRUCTURE_TEMPLATES} に構成
 * パターンを持ち、2回目以降には `restatement: true` を付ける（compose側がメロディ・リズムを
 * 1回目から再現する）。
 */

import type { ChordPatternType } from "../chord/chords";
import {
	grammarPlan,
	type KaiwaiGrammar,
	type NigoFeel,
} from "./compose-kaiwai";

/** セクションの種類。 */
export type SectionKind =
	| "intro"
	| "verse"
	| "prechorus"
	| "chorus"
	/** Cメロ。Verse/Pre chorusとは違うメロディで、ラストのサビ前に緊張感を持たせる。 */
	| "bridge"
	/**
	 * 落ちサビ。サビのメロディを伴奏控えめに歌う。J-POPの王道パターン。
	 * 2000年代のヒット曲に多く、現在も根強い人気がある。
	 */
	| "drop_chorus"
	| "interlude"
	| "outro";

export const SECTION_LABELS: Record<SectionKind, string> = {
	intro: "イントロ",
	verse: "Aメロ",
	prechorus: "Bメロ",
	chorus: "サビ",
	bridge: "Cメロ",
	drop_chorus: "落ちサビ",
	interlude: "間奏",
	outro: "アウトロ",
};

/** セクションの並び順（UIの並びと、指定が無いときの既定の順序）。 */
export const SECTION_ORDER: SectionKind[] = [
	"intro",
	"verse",
	"prechorus",
	"chorus",
	"bridge",
	"drop_chorus",
	"interlude",
	"outro",
];

/**
 * 既定で作るセクション。イントロ→Aメロ→Bメロ→サビ の、いちばん短い「1コーラス」。
 * 全部入れると長くなりすぎるので、間奏とアウトロは既定では作らない。
 */
export const DEFAULT_SECTIONS: SectionKind[] = [
	"intro",
	"verse",
	"prechorus",
	"chorus",
];

export type SectionSpec = {
	/**
	 * 小節数の代表値。`rnd` を渡さずに {@link buildSectionPlan} を呼んだときの長さで、
	 * 「押す前に曲の長さを見せる」UI 表示などが使う。実際の作曲は
	 * {@link SectionSpec.barChoices} から seed ごとに引く。
	 */
	bars: number;
	/**
	 * seed ごとに引くセクション長の候補（要素の重複が重み）。
	 *
	 * **定数にしない。** 長さが定数だと、BPM も調もメロディ型も引き直しているのに**曲の骨格だけが
	 * 全 seed で同一**になる。曲の頭からの小節割りが毎回同じなのは生成器の指紋そのもの。加えて、
	 * **候補に一度も現れない長さは、採点の重みをどう変えても出てこない**
	 * （`scripts/README.md` の4番）。
	 *
	 * **4の倍数にする。** 参考コーパスの主旋律のブロック長は7割が4の倍数で、8/16/24/32小節に山が
	 * 立つ。コード進行も4小節単位のまとまりで組んでいるので、4の倍数から外れた長さは締めの4小節が
	 * 途中で切れる。**メロディの無いイントロだけは例外**（{@link SECTION_SPECS} の `intro`）。
	 *
	 * イントロは長さを秒で決めるので（{@link SectionSpec.seconds}）、ここの候補はテンポで
	 * 絞られる前の母集団になる。0小節はここでは引かない——「イントロを作るか」は UI の
	 * チェックで表明されているので、チェックが付いているのに消すのは筋が違う。
	 *
	 * 省略時は {@link SectionSpec.bars} 固定（外から独自の spec を渡す場合のため）。
	 */
	barChoices?: number[];
	/**
	 * そのセクションが占めてよい秒数の帯。{@link buildSectionPlan} に BPM を渡したときだけ効き、
	 * 帯から外れる小節数は {@link SectionSpec.barChoices} から落とす。
	 *
	 * **小節数は時間ではない。** 同じ8小節でも BPM 112 なら 17秒、185 なら 10秒で、聴き手が
	 * 感じる長さは3倍近くぶれる。曲の中ほどならそれでよい（拍で数えて聴いているので）が、
	 * **歌が始まる前だけは違う**——まだ曲が始まっていない聴き手は拍ではなく時計で待っている
	 * ので、ここが長い曲は歌に辿り着く前に閉じられる。
	 */
	seconds?: { min: number; max: number };
	/** メロディを書くか。イントロと間奏は伴奏だけ。 */
	melody: boolean;
	/**
	 * メロディの音域の中心をどれだけずらすか（半音）。
	 * サビが高く、Aメロが低いのが、セクションの差として最も分かりやすい。
	 */
	registerShift: number;
	/**
	 * 音数の傾き。1より小さいと休符寄りの薄いセクション、大きいと詰める。
	 * リズム型を選ぶときの「休符を含む型」の引きやすさに効く。
	 */
	density: number;
	/**
	 * セクションの終わりの着地音（主音からの音階度数）。
	 * `null` はメロディが無いセクション。
	 */
	landing: number | null;
	/** 伴奏に使うコード進行の役割。 */
	progression: "a" | "b" | "c";
};

export const SECTION_SPECS: Record<SectionKind, SectionSpec> = {
	// イントロは曲の顔を先に見せる場所なので、和音はサビのものを使う。
	// 長さは秒で決める（{@link SectionSpec.seconds}）。2小節・6小節を候補に足してあるのは、
	// 4の倍数だけでは遅い曲も速い曲も4小節一択になり、テンポごとの幅が出ないため。
	// イントロにはメロディが無いので、4小節の楽句が途中で切れる心配もこの区間だけは無い。
	intro: {
		bars: 4,
		barChoices: [2, 4, 4, 6, 6, 8, 8],
		seconds: { min: 4, max: 8 },
		melody: false,
		registerShift: 0,
		density: 0.6,
		landing: null,
		progression: "b",
	},
	verse: {
		bars: 8,
		barChoices: [8, 8, 8, 16],
		melody: true,
		registerShift: -3,
		density: 0.85,
		landing: 4, // 5度で止めて「まだ続く」
		progression: "a",
	},
	// Bメロはサビへの助走。音域を上げ、密度も上げ、最後をドミナントで宙吊りにする。
	prechorus: {
		bars: 4,
		barChoices: [4, 4, 4, 8],
		melody: true,
		registerShift: 0,
		density: 1.1,
		landing: 1, // 2度＝解決しない音で止める
		progression: "a",
	},
	chorus: {
		bars: 8,
		barChoices: [8, 8, 8, 16],
		melody: true,
		registerShift: 4,
		density: 1.2,
		landing: 0, // 主音へ全終止
		progression: "b",
	},
	// Cメロ。Verse/Pre chorusとは違うメロディで、ラストのサビ前に緊張感を持たせる。
	// 2番のサビの後に来ることが多い（参考: ONLIVE Studio blog）。
	// 専用のコード進行 "c" を持ち、AメロともBメロとも雰囲気が違う。
	bridge: {
		bars: 4,
		barChoices: [4, 4, 8, 8],
		melody: true,
		registerShift: 2,
		density: 0.9,
		landing: 1, // 解決しない音で止めてラスサビへ渡す
		progression: "c",
	},
	// 落ちサビ。サビのメロディを伴奏控えめに歌う。J-POPの王道パターン。
	// density だけ下げ、メロディはサビと同じものを使う。
	drop_chorus: {
		bars: 4,
		barChoices: [4, 4, 8],
		melody: true,
		registerShift: 4, // サビと同じ高さ
		density: 0.6, // 薄い（ここが「落ち」の実体）
		landing: 0, // 主音へ全終止
		progression: "b", // サビと同じ進行
	},
	interlude: {
		bars: 4,
		barChoices: [4, 4, 8],
		melody: false,
		registerShift: 0,
		density: 0.8,
		landing: null,
		progression: "b",
	},
	outro: {
		bars: 4,
		barChoices: [4, 4, 8],
		melody: true,
		registerShift: -3,
		density: 0.6,
		landing: 0,
		progression: "a",
	},
};

/** 曲の中に置かれた1つのセクション。 */
export type PlacedSection = {
	kind: SectionKind;
	/** 開始小節（0始まり）。 */
	startBar: number;
	bars: number;
	spec: SectionSpec;
	/**
	 * セクション内の転調量（ハ長調基準からの半音シフト）。
	 * ラスサビで +1/+2 半音上がるなど、曲中の転調を小節単位で表現する。
	 */
	keyShift: number;
	/**
	 * 同じ種類のセクションが曲中で2回目以降に現れた場合に true。
	 * compose側でメロディ・リズムを1回目から再現するために使う。
	 * 2番のAメロは1番と同じフレーズを使い回す、というのが曲の基本構造。
	 */
	restatement: boolean;
};

// ============================================================
// テンプレートによる曲構成
// ============================================================

/**
 * 曲構成テンプレート。名前付きで、UIのドロップダウンから選べるようにする。同じセクションの
 * **繰り返し**が曲の基本構造なので、plan配列で同一種別を複数回指定できるようにしてある。
 *
 * **省略可能なフィールドは、読む側が `template?.field` の有無で分岐する。** 無ければ従来の
 * 経路をそのまま通す（テンプレート名の文字列比較は書かない）。共通経路の乱数消費を変えると
 * 既存テンプレートの `#seed` から別の曲が出るので、分岐の中でだけ `rnd()` を引く。
 */
export type StructureTemplate = {
	name: string;
	label: string;
	plan: SectionKind[];
	/**
	 * seed ごとに引く構成の候補（要素の重複が重み）。`plan` は UI の長さ表示に使う代表で、
	 * 作曲は `plans` があればこちらから引く。
	 */
	plans?: SectionKind[][];
	/** セクション仕様の上書き（{@link SECTION_SPECS} に浅く重ねる）。 */
	sectionSpecs?: Partial<Record<SectionKind, Partial<SectionSpec>>>;
	/** テンポの候補。省略時は compose 側の既定の候補から引く。 */
	bpmChoices?: number[];
	/** UI の調が `"any"` のときの既定（`"major"` / `"minor"`）。利用者の指定が優先。 */
	baseKey?: string;
	/** 展開の仕方（`ComposeOptions.form`）。呼び出し側の明示指定が優先。 */
	form?: string;
	/** 音階の候補。音階が `"auto"` のときだけ、ここから引く。 */
	scales?: string[];
	/**
	 * 音階ごとのベースの奏法。音階だけ替えてもベースが4度・5度を跳ぶままだと
	 * 作風が出ない（手本との差はベースの動き方にもあった）。
	 */
	bassByScale?: Record<string, string>;
	/**
	 * ベースの奏法・骨格の候補（compose 側の `BassStyle` / `BassSkeleton` の名前）。
	 * `sustainCadence: false` は hold/cadence の小節でも全音符に伸ばさず型を刻み続ける。
	 */
	bass?: {
		styles: string[];
		skeletons?: string[];
		sustainCadence?: boolean;
		/** 骨格 `two-bar` / `fourth-bar` が差し替える小節の奏法の候補。 */
		alt?: string[];
	};
	/**
	 * 固定ドラムパターンの候補（`DRUM_PATTERNS` のキー）。`dense` は主旋律が
	 * 音のある小節1つあたり `notesPerBar` 音以上のときに使う候補（裏拍の音を外すなど）。
	 */
	drums?: { pool: string[]; dense?: { notesPerBar: number; pool: string[] } };
	/** 楽器プリセットの候補（`INSTRUMENT_PRESETS` のキー）。 */
	instruments?: string[];
	/** 伴奏の奏法の候補。 */
	chordPatterns?: ChordPatternType[];
	/** 和声リズムの候補（compose 側の `HarmonicRhythm` の名前）。 */
	harmonicRhythms?: string[];
	/**
	 * 進行プールの差し替え（ハ長調／イ短調の綴り）。短調のときだけ効く——利用者が長調を
	 * 手で指定したら従来プールへ退避する。既存プールへ要素を足すと `pick` の添字がずれるので、
	 * テンプレートは必ず自前のプールを持つ。
	 */
	progressions?: { a: string[][]; b: string[][]; c: string[][] };
	/**
	 * 流派の文法（compose-kaiwai.ts）。構成は `plan`/`plans` の代わりに曲ごとに組む。進行は
	 * `progressions` より優先して文法から組み（短調のときだけ）、締めの候補も文法が出す。
	 */
	grammar?: KaiwaiGrammar;
	/** 旋律の「歌の制約」を緩める値。 */
	melody?: {
		wideLeapBudget?: number;
		midBreath?: number;
		maxLeapChoices?: number[];
		groove?: string;
		/** 詠唱の素材を2度寄りに引く（同音連打を減らし、拍内の付点だけは16分でも通す）。 */
		smooth?: true;
		/** 詠唱を1小節の型の繰り返しにする曲を引く（半分の曲。セクション内の全小節が最初の小節を写す）。 */
		barLoop?: true;
		/** 主旋律から抜く度数（`omit`）と、拍の裏の短い音にだけ残す度数（`weakOnly`）。ハ長調の度数。 */
		snap?: { omit: number[]; weakOnly: number[] };
	};
	/**
	 * 歌の割り当ての候補（compose 側の `DuetStyle` の名前）。`octave` は主旋律のオクターブ下を
	 * 全音で重ねる（歌入り作曲では2本目の歌になる）。
	 */
	vocal?: { duetStyles?: string[]; octave?: true };
	/** 仮歌詞の語彙。 */
	lyricWords?: string[];
	/**
	 * 主旋律の書き方。`"riff"` は歌メロの代わりに楽器の16分リフを回す。
	 * 手本2曲の上声は16分間隔が35〜67%あり、歌メロ（1〜13%）とは別物だった。
	 * `"riff16"` は16分と3連の走句を4小節ブロックで回し続け、サビでオクターブ上へ移る。
	 * `"riff-bar"` は曲ごとに作る1小節の型をセクションの全小節で繰り返す（半分の曲は4小節ブロック）。
	 */
	lead?: "riff" | "riff16" | "riff-bar";
	/**
	 * 歌メロの書き方。`"sentence"` は8小節の文を2小節の句4つで組み（同じリズムの家族・句ごとの息継ぎ）、
	 * サビに2本目の声（4〜5度下が主）を曲によって付ける。歌う高さは原曲の歌の帯へ置く。
	 */
	vocalLine?: "sentence";
	/**
	 * サブメロの書き方。`"arpeggio"` はハモリ／対旋律の代わりに、進行の構成音を16分で回す
	 * アルペジオ（1オクターブ上）を全小節に置く。ハモリ2声は空になる。
	 */
	sub?: "arpeggio";
	/** アルペジオを置くセクション。省略時は最後のサビだけ。 */
	arpeggioKinds?: SectionKind[];
	/** コードパッドを書くセクション。省略時は Bメロ・サビ・Cメロ・落ちサビ。 */
	padKinds?: SectionKind[];
	/**
	 * `"loop"` はセクションを締めず（最後の4小節を締めの進行に差し替えず）に進行をそのまま回す。
	 */
	cadences?: "loop";
	/** `false` で平行調・同主調・曲中転調・借用和音・トニック回避を掛けない。 */
	tonalMoves?: false;
	/** 旋律の無いイントロで、ベース→パッド→サブメロの順に4分の1ずつ遅らせて入れる。 */
	introBuild?: true;
	/**
	 * 上級者モードの層の割り当て（抽選しない）。地の伴奏と同じ奏法の層は飛ばし、
	 * 残りの先頭2本を使う。
	 */
	arrange?: {
		backing: { pattern: ChordPatternType; sections: SectionKind[] | null }[];
		sparkle: { pattern: ChordPatternType; sections: SectionKind[] } | null;
		pad: SectionKind[];
		lead: { sections: SectionKind[]; octave: number } | null;
	};
	/**
	 * 生成エンジンの差し替え。`"skeleton"` は `composeSong` の先頭で骨格借用
	 * （{@link file://./compose-skeleton.ts}）へ、`"splice"` は継ぎ合わせ
	 * （{@link file://./compose-splice.ts}）へ渡す。共通経路の乱数は消費しない。
	 */
	engine?: "skeleton" | "splice";
	/** 2号兄貴の曲ごとの作り（{@link file://./compose-kaiwai.ts} の `varyNigo` が埋める）。 */
	nigo?: NigoFeel;
};

/**
 * 界隈曲の Aメロ・アウトロ用（12本）。**全行 Am 始まり**——compose 側は A の1和音目で
 * 主和音を決めるので、外すと短調曲の締めがハ長調へ落ちる。空白区切りの要素は1小節に2和音。
 */
// 第3版の試聴で、三和音の王道進行（Am Em F G・Am C G D）のAメロは「似ない」、二次ドミナントや
// 増和音で短調へ引き戻すサビ（FM7 E7 Am7 C7・Dm7 E+ Am7 A7）は「若干似る」だった。ダイアトニックな
// 7th だけの行（Am7 Em7 Dm7 G7 CM7）も似なかったので、**全行に 7th の二次ドミナントか変化和音を置く**。
const KAIWAI_A: string[][] = [
	["Am7", "G7", "FM7", "E7"],
	["Am7", "E7", "Am7", "E7"],
	["Am7", "Dm7", "BbM7", "E7"],
	["Am7 Em7", "Dm7 G7", "CM7 C7", "Bm7-5 E7"],
	["Am7", "C7", "FM7", "E7"],
	["Am7 G7", "FM7 E7", "Am7 G7", "FM7 E7"],
	["Am", "AmM7", "Am7", "D7"],
	["Am7", "A7", "Dm7", "E+"],
	["Am7", "AbM7", "GM7", "E7"],
	["Am7", "Dm7 G7", "CM7", "Bm7-5 E7"],
	["Am7 Dm7", "G7 CM7", "FM7 Bm7-5", "E7 E+"],
	["Am7", "Em7/A", "FM7/A", "E7/A"],
];
/**
 * 界隈曲のイントロ・サビ・間奏用（11本）。サビ頭に 7th・裏コード・SDM・♭II・I7 を置く。
 * Am を含まない行を3本持つ——浮遊感の曲（`withoutTonic`）が1本へ潰れないため。
 */
const KAIWAI_B: string[][] = [
	["Dm7", "Db7", "CM7", "A7"],
	["Bm7-5", "E7", "Am", "A7"],
	["Dm7", "E7", "Am", "A7"],
	["FM7", "Fm7", "Em7", "Am"],
	["FM7", "G7", "CM7", "Am7"],
	["Am7", "AbM7", "GM7", "E7"],
	["Am7", "Abm7", "Gm7", "C7"],
	["Dm7", "E+", "Am7", "A7"],
	["FM7 E7", "Am7 C7", "FM7 E7", "Am7 A7"],
	["Dm7", "G7", "CM7", "FM7"],
	["FM7", "G7", "Em7", "A7"],
];
/** 界隈曲の Cメロ用（5本）。Am を含まない行を2本持つ（上と同じ理由）。 */
const KAIWAI_C: string[][] = [
	["FM7", "Em7", "Am7", "Dm7"],
	["Am", "G", "FM7", "E7"],
	["Dm7", "G7", "Em7", "Am"],
	["F", "G", "Ab", "Bb"],
	["Dm7", "Em7", "FM7", "G7"],
];
/** 界隈曲の仮歌詞。開音節・2〜3拍・海産物と断片。 */
const KAIWAI_LYRIC_WORDS: string[] = [
	"いわし",
	"くらげ",
	"さかな",
	"うみ",
	"しお",
	"なみ",
	"すな",
	"つち",
	"そら",
	"あめ",
	"かげ",
	"ひかり",
	"そこ",
	"ふかく",
	"はえる",
	"とぶ",
	"しずむ",
	"ゆれる",
	"きえる",
	"とける",
	"まわる",
	"ながれる",
	"こえ",
	"みず",
	"ほね",
	"よる",
	"あさ",
	"まち",
	"ゆび",
	"くも",
	"ほし",
	"つき",
	"そして",
	"どこか",
	"なにも",
	"ない",
	"もう",
	"まだ",
	"しろい",
	"あかい",
];

// 3流派の進行は compose-kaiwai.ts の文法から曲ごとに組む（どの曲の写しでもない）。

/** 海鮮リスペクト。歌入り（UTAU）前提。2本目の声はサビで4〜5度下に重ねる（曲による）。 */
const KAIWAI_KAISEN: StructureTemplate = {
	name: "kaiwai_kaisen",
	label: "界隈曲・海鮮リスペクト",
	plan: [
		"intro",
		"verse",
		"chorus",
		"verse",
		"chorus",
		"interlude",
		"chorus",
		"outro",
	],
	// 構成は grammar（compose-kaiwai.ts）が曲ごとに組む。ここの長さは UI の代表値。
	sectionSpecs: {
		intro: { bars: 8, barChoices: [8], seconds: { min: 1, max: 30 } },
		chorus: { barChoices: [8] },
		interlude: { bars: 8, barChoices: [8] },
		// 後半は同じ進行（サビの "b"）を使い回す。
		outro: {
			bars: 8,
			barChoices: [4, 8],
			melody: false,
			landing: null,
			progression: "b",
		},
	},
	form: "chant",
	sub: "arpeggio",
	arpeggioKinds: ["interlude", "outro"],
	padKinds: ["chorus", "interlude"],
	bpmChoices: [130, 131, 132, 133, 134, 135],
	baseKey: "minor",
	scales: ["yonuki_penta"],
	drums: {
		pool: [
			"four_clap_pedal",
			"dance",
			"four_clap_pedal_open",
			"four_clap_snare_closed",
		],
	},
	instruments: ["retro_game", "synth_pop", "chip_pop"],
	chordPatterns: ["block", "offbeat"],
	harmonicRhythms: ["half"],
	bass: {
		styles: ["octave-eighth"],
		skeletons: ["fourth-bar", "fourth-bar", "per-bar"],
		alt: ["tresillo"],
		sustainCadence: false,
	},
	grammar: "kaisen",
	tonalMoves: false,
	melody: {
		wideLeapBudget: 2,
		midBreath: 0.15,
		groove: "eighth",
		smooth: true,
		snap: { omit: [3], weakOnly: [6] },
	},
	vocal: { duetStyles: ["none"] },
	vocalLine: "sentence",
	lyricWords: KAIWAI_LYRIC_WORDS,
	// イントロ 2〜3層 → サビ 7層前後 → 間奏 8〜9層。
	arrange: {
		backing: [
			{ pattern: "arpeggio", sections: ["chorus", "interlude", "outro"] },
			{ pattern: "offbeat", sections: ["interlude"] },
			{ pattern: "block", sections: ["interlude"] },
		],
		sparkle: { pattern: "alternating", sections: ["interlude"] },
		pad: ["chorus", "interlude"],
		lead: { sections: ["chorus"], octave: 0 },
	},
};

/** 2号兄貴リスペクト（歌）。主旋律を楽器で回す版は {@link KAIWAI_NIGO_LEAD}。 */
const KAIWAI_NIGO: StructureTemplate = {
	name: "kaiwai_2go",
	label: "界隈曲・2号兄貴リスペクト（歌入り）",
	plan: ["intro", "verse", "chorus", "verse", "chorus", "chorus"],
	sectionSpecs: {
		intro: { barChoices: [4, 8], seconds: { min: 1, max: 20 } },
		bridge: { barChoices: [8] },
	},
	form: "motif",
	bpmChoices: [140, 142, 145, 145, 145, 145, 148, 150, 152, 155, 160, 170, 180],
	baseKey: "minor",
	scales: ["penta_minor"],
	drums: {
		pool: [
			"four_openhat",
			"four_openhat",
			"dance",
			"four_openhat_double",
			"four_openhat_snare",
			"break_openhat",
			"break_openhat",
		],
	},
	instruments: ["synth_pop", "synth_pop", "retro_game"],
	chordPatterns: ["block", "block", "stab-eighth"],
	harmonicRhythms: ["half"],
	bass: {
		styles: ["octave-eighth", "octave-eighth", "tresillo"],
		skeletons: ["per-bar"],
		sustainCadence: false,
	},
	grammar: "nigo",
	tonalMoves: false,
	padKinds: ["intro", "verse", "chorus", "bridge"],
	melody: {
		groove: "sixteenth",
		maxLeapChoices: [7, 9, 10, 12, 14],
		wideLeapBudget: 4,
	},
	vocal: { duetStyles: ["none"] },
	arrange: {
		backing: [
			{ pattern: "stab-quarter", sections: ["chorus", "bridge"] },
			{ pattern: "offbeat", sections: ["verse"] },
		],
		sparkle: null,
		pad: ["intro", "verse", "chorus", "bridge"],
		lead: { sections: ["chorus"], octave: 1 },
	},
};
/** 2号兄貴リスペクト（楽器リード）。原曲どおりインストで、リードが休まず鳴る。 */
const KAIWAI_NIGO_LEAD: StructureTemplate = {
	...KAIWAI_NIGO,
	name: "kaiwai_2go_lead",
	label: "界隈曲・2号兄貴リスペクト",
	lead: "riff16",
};

/** Speder2 リスペクト（歌）。主旋律を楽器で回す版は {@link KAIWAI_SPEDER_LEAD}。 */
const KAIWAI_SPEDER: StructureTemplate = {
	name: "kaiwai_speder2",
	label: "界隈曲・Speder2リスペクト（歌入り）",
	plan: ["intro", "verse", "chorus", "verse", "chorus"],
	sectionSpecs: {
		intro: {
			bars: 16,
			barChoices: [16],
			seconds: { min: 1, max: 60 },
			progression: "a",
		},
		verse: { barChoices: [8, 16] },
		chorus: { barChoices: [8, 16] },
		bridge: { barChoices: [8] },
		// 層が抜ける区間と薄いアウトロは、旋律なしでループを回し続ける。
		interlude: { progression: "a" },
		outro: { melody: false, landing: null, progression: "a" },
	},
	form: "chant",
	sub: "arpeggio",
	arpeggioKinds: ["intro", "chorus"],
	padKinds: ["intro", "verse", "chorus", "bridge"],
	introBuild: true,
	bpmChoices: [
		100, 104, 108, 110, 112, 115, 118, 120, 122, 125, 128, 130, 132, 135,
	],
	baseKey: "minor",
	scales: ["penta_minor", "yonuki_penta"],
	drums: {
		pool: [
			"four_clap_16hat",
			"four_clap_16hat_sparse",
			"four_clap_16hat_run",
			"four_clap_16hat_snare",
			"dance",
		],
	},
	instruments: ["ep_celesta", "ep_celesta", "chip_pop"],
	chordPatterns: ["block"],
	harmonicRhythms: ["bar", "bar", "slow"],
	bass: {
		styles: ["octave-dotted", "octave-offbeat16"],
		skeletons: ["per-bar"],
		sustainCadence: false,
	},
	grammar: "speder",
	cadences: "loop",
	tonalMoves: false,
	melody: { barLoop: true },
	vocal: { duetStyles: ["none"] },
	// 和音の層を刻みの長さ違いで重ねる（全音符＝地・4分・8分・16分）。
	arrange: {
		backing: [
			{ pattern: "stab-quarter", sections: null },
			{ pattern: "stab-eighth", sections: ["chorus", "bridge"] },
		],
		sparkle: { pattern: "stab-sixteenth", sections: ["chorus"] },
		pad: ["intro", "verse", "chorus", "bridge"],
		lead: null,
	},
};
/** Speder2 リスペクト（楽器リード）。原曲どおりインストで、短い型を楽器で回す。 */
const KAIWAI_SPEDER_LEAD: StructureTemplate = {
	...KAIWAI_SPEDER,
	name: "kaiwai_speder2_lead",
	label: "界隈曲・Speder2リスペクト",
	lead: "riff-bar",
};

export const STRUCTURE_TEMPLATES: StructureTemplate[] = [
	// 1コーラス（現行デフォルト、短い曲・初心者向け）
	{
		name: "1chorus",
		label: "1コーラス",
		plan: ["intro", "verse", "prechorus", "chorus"],
	},

	// JPOP王道（マリーゴールド型）
	// イントロ→Aメロ→Aメロ→Bメロ→サビ→Aメロ→Bメロ→サビ→Cメロ→間奏→サビ→アウトロ
	{
		name: "jpop_standard",
		label: "JPOP王道",
		plan: [
			"intro",
			"verse",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"interlude",
			"chorus",
			"outro",
		],
	},

	// 落ちサビ入り（J-POP王道の変形。ラスサビ前に落ちサビ）
	{
		name: "jpop_drop",
		label: "落ちサビ入り",
		plan: [
			"intro",
			"verse",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"drop_chorus",
			"chorus",
			"outro",
		],
	},

	// ボカロ王道（短め高速、Aメロ繰り返しなし）
	{
		name: "vocaloid",
		label: "ボカロ王道",
		plan: [
			"intro",
			"verse",
			"prechorus",
			"chorus",
			"verse",
			"prechorus",
			"chorus",
			"bridge",
			"chorus",
			"outro",
		],
	},

	// Verse-Chorus形式（Bメロなし、洋楽的）
	{
		name: "verse_chorus",
		label: "Verse-Chorus",
		plan: [
			"intro",
			"verse",
			"chorus",
			"verse",
			"chorus",
			"bridge",
			"chorus",
			"outro",
		],
	},

	// ゲームBGM（ループ）。テーマ（サビ）を頭から出し、対比→テーマ→緊張→テーマで一周。
	// アウトロを持たないのは、最後のテーマから最初のテーマへ戻して鳴らし続ける前提のため。
	{
		name: "game_loop",
		label: "ゲームBGM（ループ）",
		plan: ["intro", "chorus", "verse", "chorus", "bridge", "chorus"],
		// 手本2曲は約110で、速さは16分の詰まりから来る（テンポを上げても近づかない）。
		bpmChoices: [105, 108, 110, 112, 115, 118, 120],
		form: "ostinato",
		// 手本は2系統。Ghost Fight（減七の平行移動＋半音で下がるベース）と
		// Pepper Steak（短調の一発リフ＋♭5）。
		lead: "riff",
		scales: ["harmonic_minor", "minor_blues"],
		bassByScale: {
			harmonic_minor: "chromatic-descent",
			minor_blues: "power-riff",
		},
	},

	// 界隈曲。短調・4つ打ち・8分ベース・多回サビ。コーパス（bars≥40・非ドラム ch≥6 の43曲）と
	// 当たり12曲の実測から。細部の根拠は docs/handover-compose.md「界隈曲テンプレート」。
	{
		name: "kaiwai",
		label: "界隈曲（短調・4つ打ち・8分ベース）",
		plan: [
			"intro",
			"verse",
			"chorus",
			"verse",
			"chorus",
			"bridge",
			"chorus",
			"chorus",
		],
		// 2:1:1。64小節型（当たり 60小節 7/12・ラスサビ2連）／イントロ無し（歌が1小節目から。
		// 絞り後 8/43）／36小節前後（コーパスの 32〜40 の峰）。
		// Bメロは持たない（第3版）——界隈曲の歌はAメロの型とサビの型の詠唱で、サビへの助走が無い。
		plans: [
			[
				"intro",
				"verse",
				"chorus",
				"verse",
				"chorus",
				"bridge",
				"chorus",
				"chorus",
			],
			[
				"intro",
				"verse",
				"chorus",
				"verse",
				"chorus",
				"bridge",
				"chorus",
				"chorus",
			],
			["verse", "chorus", "verse", "chorus", "chorus"],
			["intro", "verse", "chorus", "verse", "chorus"],
		],
		// 歌メロは詠唱（{@link MelodyForm} の `chant`）、サブメロは16分のアルペジオ。第2版の
		// 試聴で「イントロ（伴奏だけ）は若干似ている、歌が入ると化けの皮が剥がれる」——犯人は
		// 旋律の作り（動機→セクエンツ→駆け上がり→歌い上げ→終止形）とハモリだった。
		form: "chant",
		sub: "arpeggio",
		// 128〜142 に10本（コーパス中央135）、150〜185 に6本（当たり中央152.5）。
		// 第1段の試聴（2026-09-30）で、当たり集合由来の「幅」（16beat・ピアノ・ルート刻み・disco・
		// アルペジオ・トレシーロ）は「界隈曲っぽくない」、4つ打ち＋8分オクターブ＋140 の1本だけが
		// 「若干」だった。以後はコーパスの核（130〜140・4つ打ち・8分オクターブ往復・2拍で動く和声・
		// 8分の歌メロ）へ絞る。幅は調・進行・構成の側で出す。
		bpmChoices: [
			128, 130, 130, 132, 132, 135, 135, 135, 135, 138, 140, 140, 142, 150,
		],
		baseKey: "minor",
		// 民謡ペンタ（シとファが無い）だと歌メロが民謡・ゲーム音楽側へ寄る。界隈曲の歌メロは
		// 四抜き短調（ラシドレミソ。イワシ・ヤツメ穴の実測）なので、シを柱に戻す。
		scales: ["yonuki_minor"],
		drums: {
			pool: ["four_clap", "four_clap", "four_clap", "dance", "dance"],
			// 主旋律が7音/小節以上（歌のある小節で割る）なら裏拍オープンハット（dance）を外す
			// ——16分旋律と帯域を取り合う。
			dense: {
				notesPerBar: 7,
				pool: ["four_clap"],
			},
		},
		// 第3版で「若干似た」のは retro_game（矩形波＋クラビネット）と synth_pop、似なかったのは chip_pop。
		instruments: [
			"retro_game",
			"retro_game",
			"synth_pop",
			"synth_pop",
			"chip_pop",
		],
		// 第3版で「若干似た」2本は block と offbeat、似なかった1本は yatsume（ヤツメ穴固有の刻み）。
		chordPatterns: ["block", "block", "offbeat", "offbeat", "yatsume"],
		harmonicRhythms: ["half", "half", "half", "bar"],
		bass: {
			styles: [
				"octave-eighth",
				"octave-eighth",
				"octave-eighth",
				"octave-fifth",
			],
			skeletons: ["per-bar", "per-bar", "approach"],
			sustainCadence: false,
		},
		progressions: { a: KAIWAI_A, b: KAIWAI_B, c: KAIWAI_C },
		// 主旋律が出るまでの小節数はコーパスで 0/1/4/8 に峰（0 はイントロ無しの plan で出す）。
		// 1小節のイントロは置けない——compose 側の楽句は2小節単位で、奇数長のセクションを挟むと
		// 以降の楽句が全部1小節ずれる（実測：1小節イントロの曲は歌が2小節目から始まり、詠唱の
		// 4小節周期も和声の4小節から1小節ずれる）。最短は2にする。
		sectionSpecs: {
			intro: { barChoices: [2, 2, 4, 4, 8, 8], seconds: { min: 1, max: 16 } },
		},
		// 歌メロは8分で組む（コーパスの主旋律の16分間隔は中央 0.027・p75 0.095。16分で走る曲は例外）。
		melody: { wideLeapBudget: 3, midBreath: 0.15, groove: "eighth" },
		vocal: { duetStyles: ["none", "section", "phrase", "chorus", "verse"] },
		lyricWords: KAIWAI_LYRIC_WORDS,
	},

	// 界隈曲（骨格借用）。所有者の耳コピから抜いた設計図を1つ引き、調だけ変えて、和音・ベース・
	// ドラム・層の配置は骨格どおり、歌メロは骨格のリズムに他曲の実在フレーズを当てる。
	// plan は UI の長さ表示の代表で、実際の構成は骨格が持つ。
	{
		name: "kaiwai_skeleton",
		label: "界隈曲（骨格借用）",
		plan: ["intro", "verse", "chorus"],
		engine: "skeleton",
		baseKey: "minor",
		// 音階 "auto" のとき短調の骨格で引く（長調の骨格は陽音階）。
		scales: ["yonuki_minor"],
		instruments: ["retro_game", "synth_pop", "chip_pop"],
		vocal: { duetStyles: ["none", "section", "phrase", "chorus", "verse"] },
		lyricWords: KAIWAI_LYRIC_WORDS,
	},

	// 界隈曲（継ぎ合わせ、実験用）。セクションごとに別々の曲の設計図を継ぐ。バンク（compose-section-bank.ts）
	// は耳コピから作るので git にもバンドルにも入れず、scripts/ から options.sectionBank で渡す。UI には出さない。
	{
		name: "kaiwai_splice",
		label: "界隈曲（継ぎ合わせ）",
		plan: ["intro", "verse", "chorus"],
		engine: "splice",
		baseKey: "minor",
		scales: ["yonuki_minor"],
		bpmChoices: [
			128, 130, 130, 132, 132, 135, 135, 135, 135, 138, 140, 140, 142, 150,
		],
		instruments: [
			"retro_game",
			"retro_game",
			"synth_pop",
			"synth_pop",
			"chip_pop",
		],
		vocal: { duetStyles: ["none", "section", "phrase", "chorus", "verse"] },
		lyricWords: KAIWAI_LYRIC_WORDS,
	},

	// 界隈曲の流派（docs/kaiwai-lineages.md の規則案）。
	KAIWAI_KAISEN,
	KAIWAI_NIGO,
	KAIWAI_NIGO_LEAD,
	KAIWAI_SPEDER,
	KAIWAI_SPEDER_LEAD,
];

/** テンプレートのセクション仕様（上書きがあれば {@link SECTION_SPECS} に重ねる）。 */
const specOf = (kind: SectionKind, tmpl?: StructureTemplate): SectionSpec =>
	tmpl?.sectionSpecs?.[kind]
		? { ...SECTION_SPECS[kind], ...tmpl.sectionSpecs[kind] }
		: SECTION_SPECS[kind];

const findTemplate = (name?: string): StructureTemplate | undefined =>
	name ? STRUCTURE_TEMPLATES.find((t) => t.name === name) : undefined;

/**
 * {@link buildSectionPlan} の並び順を決める（テンプレート優先、無ければチェック）。
 * `plans` を持つテンプレートは `rnd` があるときだけそこから引く（セクション長の抽選より前に1回）。
 */
const orderedKinds = (
	kinds: SectionKind[],
	templateName?: string,
	rnd?: () => number,
): SectionKind[] => {
	if (templateName) {
		const tmpl = findTemplate(templateName);
		if (!tmpl) return DEFAULT_SECTIONS;
		return tmpl.plans?.length && rnd
			? tmpl.plans[Math.floor(rnd() * tmpl.plans.length)]
			: tmpl.plan;
	}
	const wanted = kinds.length > 0 ? kinds : DEFAULT_SECTIONS;
	// 並び順は SECTION_ORDER に従う（チェックの付け外しの順に依存させない）。
	return SECTION_ORDER.filter((k) => wanted.includes(k));
};

/**
 * 選ばれたセクションを並べて、曲の設計図にする。
 *
 * テンプレート名が指定された場合はテンプレートの plan をそのまま使う。
 * kinds 配列が指定された場合は {@link SECTION_ORDER} に従って並べる
 * （従来の互換モード。各種別は1回ずつ）。
 * どちらも空のときは {@link DEFAULT_SECTIONS} を使う。
 *
 * 同じ種別が2回以上現れた場合、2回目以降は `restatement: true` が付く。
 * compose側はこのフラグを見て、1回目のメロディ・リズムを再現する。
 *
 * `rnd` を渡すと、セクション長を {@link SectionSpec.barChoices} から引く
 * （渡さなければ {@link SectionSpec.bars} の代表値。UI の長さ表示など、
 * 引くたびに答えが変わっては困る場所のため）。
 *
 * **長さは種別ごとに1回だけ引く。** 1番のAメロが8小節で2番が16小節、という
 * 曲は書けなくはないが、`restatement` は1番の対応小節をそのまま歌い直す仕組み
 * なので、長さが違うと後半だけ別のフレーズになる。同じ名前のセクションは同じ
 * 長さで揃えるほうが「同じフレーズが返ってきた」という手応えを壊さない。
 */
export const buildSectionPlan = (
	kinds: SectionKind[],
	templateName?: string,
	rnd?: () => number,
	bpm?: number,
): PlacedSection[] => {
	const tmpl = findTemplate(templateName);
	const byGrammar =
		tmpl?.grammar && rnd ? grammarPlan(tmpl.grammar, rnd) : undefined;
	const ordered = byGrammar?.kinds ?? orderedKinds(kinds, templateName, rnd);

	/** 種別ごとの長さ。同じ種別は曲中で同じ長さに揃える。 */
	const barsOf = new Map<SectionKind, number>();
	for (const kind of ordered) {
		if (barsOf.has(kind)) continue;
		const spec = specOf(kind, tmpl);
		const fixed = byGrammar?.bars[kind];
		if (fixed) {
			barsOf.set(kind, fixed);
			continue;
		}
		const choices = spec.barChoices ?? [];
		if (!rnd || choices.length === 0) {
			barsOf.set(kind, spec.bars);
			continue;
		}
		let pool = choices;
		const band = spec.seconds;
		if (bpm && band) {
			const sec = (bars: number): number => (bars * 4 * 60) / bpm;
			const fit = choices.filter(
				(b) => sec(b) >= band.min && sec(b) <= band.max,
			);
			// **帯に入る長さが無いテンポでは短いほうへ倒す。** 上限を割るのは
			// 「待たされる」という実害だが、下限を割るのは「あっさり始まる」だけ。
			pool = fit.length > 0 ? fit : [Math.min(...choices)];
		}
		barsOf.set(
			kind,
			pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))],
		);
	}

	const plan: PlacedSection[] = [];
	let bar = 0;
	/** 各種別が何回出てきたか。2回目以降は restatement。 */
	const seen = new Map<SectionKind, number>();
	for (const kind of ordered) {
		const spec = specOf(kind, tmpl);
		const bars = barsOf.get(kind) ?? spec.bars;
		const count = seen.get(kind) ?? 0;
		plan.push({
			kind,
			startBar: bar,
			bars,
			spec,
			keyShift: 0,
			restatement: count > 0,
		});
		seen.set(kind, count + 1);
		bar += bars;
	}
	const shift = byGrammar?.shift;
	if (shift)
		for (let i = shift.from; i <= shift.to && i < plan.length; i++)
			plan[i].keyShift = shift.semitones;
	return plan;
};

/**
 * その構成で曲が何小節になりうるか（最短・最長・代表値）。
 *
 * セクション長を seed ごとに引くようにしたので、「押す前に何小節か」を
 * 1つの数で見せることはできない。UI はここが返す幅を出す。
 */
export const sectionPlanBarRange = (
	kinds: SectionKind[],
	templateName?: string,
): { min: number; max: number; typical: number } => {
	const tmpl = findTemplate(templateName);
	// 骨格借用は plan を読まず、引いた骨格の小節数がそのまま曲の長さになる。骨格データはバンドルに
	// 入れない（scripts/ から渡す）ので、ここは抽出時の実測（62本: 12〜146、中央 49）を定数で返す。
	if (tmpl?.engine === "skeleton") return { min: 12, max: 146, typical: 49 };
	// 継ぎ合わせのバンクも骨格と同じくバンドルに入れないので、生成の実測（300 seed: 16〜168、中央 56）。
	if (tmpl?.engine === "splice") return { min: 16, max: 168, typical: 56 };
	if (tmpl?.grammar) {
		// 構成を規則から組む流派は、固定の種で引いた構成の幅を返す。
		let seed = 1;
		const lcg = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const totals = Array.from({ length: 64 }, () =>
			buildSectionPlan([], templateName, lcg).reduce((a, s) => a + s.bars, 0),
		);
		const typical = tmpl.plan.reduce((a, k) => a + specOf(k, tmpl).bars, 0);
		return { min: Math.min(...totals), max: Math.max(...totals), typical };
	}
	const typicalKinds = orderedKinds(kinds, templateName);
	// 構成を seed ごとに引くテンプレートは、全候補の最短・最長を取る。代表値は `plan`。
	const plans = tmpl?.plans?.length ? tmpl.plans : [typicalKinds];
	let min = Number.POSITIVE_INFINITY;
	let max = 0;
	let typical = 0;
	for (const kinds of plans) {
		let lo = 0;
		let hi = 0;
		for (const kind of kinds) {
			const spec = specOf(kind, tmpl);
			const choices = spec.barChoices?.length ? spec.barChoices : [spec.bars];
			lo += Math.min(...choices);
			hi += Math.max(...choices);
		}
		min = Math.min(min, lo);
		max = Math.max(max, hi);
	}
	for (const kind of typicalKinds) typical += specOf(kind, tmpl).bars;
	return { min, max, typical };
};

/** その小節が属するセクション。 */
export const sectionAt = (
	plan: PlacedSection[],
	bar: number,
): PlacedSection => {
	for (const section of plan) {
		if (bar >= section.startBar && bar < section.startBar + section.bars)
			return section;
	}
	return plan[plan.length - 1];
};
