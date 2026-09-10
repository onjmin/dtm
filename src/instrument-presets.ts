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
	/**
	 * 間奏のソロを弾く楽器。**歌が休んでいる場所を担当する**ので、`melody` と
	 * 同じでも構わない（ロックの間奏がボーカルと同じ歪みギターなのは正しい）。
	 * 逆に、ここを持たせないと間奏が「伴奏だけの空白」になる。
	 */
	solo: string;
	/**
	 * サビでだけ重ねる楽器。主旋律のオクターブ上に薄く足して、サビの手前と
	 * 音色そのものを変える。1トラック1楽器という制約の下で
	 * 「セクションで楽器が変わる」を作る唯一の方法が、**セクションごとに
	 * 別トラックへ書き分けること**。
	 */
	chorusLead: string;
	/**
	 * 伴奏の2色目。**同じ進行を別の奏法で鳴らす層を、別の音色にするため**にある。
	 *
	 * 上級者モードは伴奏を t7〜t9 の3本に書き分けていて、奏法（`ChordPatternType`）は
	 * 実際に別のリズムになっている——発音位置の一致は中央 Jaccard 0.13、ほぼ完全一致は
	 * 4%しかない。にもかかわらず**t6〜t10 の5本すべてが `chord` の1楽器**だったため、
	 * せっかく書き分けた層が同じ音色で重なって団子になっていた。
	 * `chord` と喧嘩しない、かつ他のスロットと被らないものを選ぶこと。
	 */
	chordAlt: string;
	/**
	 * ウワモノ（装飾）の楽器。高い位置で薄く鳴らす、きらびやかな音。
	 * ここも以前は `chord` を使い回していた。
	 */
	sparkle: string;
	/**
	 * ベースの2色目。**セクションでベースの音色を替える**ために使う。
	 * t4 が静かな側、t5 が盛り上がる側を持ち、**同じ音を二度鳴らさずに**
	 * 境目で音色だけが入れ替わる。`bass` と喧嘩しない同族を選ぶこと。
	 */
	bassAlt: string;
	/**
	 * ハモリの2色目。同じくセクションで音色を替えるため（t2 が静かな側、
	 * t12 が盛り上がる側）。ハモリは声部なので、声もの・柔らかい持続音が合う。
	 */
	harmonyAlt: string;
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
		solo: "Electric Guitar (clean)",
		// **Glockenspiel は使わない。音源側のサンプルが音程を外している**（実聴で確認）。
		// 音域の問題（G5〜の高音楽器）なら {@link GM_BRIGHT_CEILING} で下げれば済むが、
		// ピッチそのものがずれているものは置き場所を変えても直らない。同じ役割
		// （サビの上に乗る明るい音板）で、素直に鳴る Celesta へ差し替えてある。
		// ※ {@link GM_INSTRUMENT_RANGE} / {@link GM_BRIGHT_CEILING} の Glockenspiel の
		//    項は残す。手で選んだときの置き場所の判断はそのまま要るため。
		chorusLead: "Celesta",
		chordAlt: "Electric Piano 1",
		sparkle: "Music Box",
		bassAlt: "Acoustic Bass",
		harmonyAlt: "Choir Aahs",
	},
	acoustic: {
		displayName: "アコースティック",
		description: "生楽器の温かみを重視。フォークやポップスに。",
		melody: "Acoustic Guitar (steel)",
		submelody: "Harmonica",
		bass: "Acoustic Bass",
		chord: "Acoustic Guitar (nylon)",
		solo: "Overdriven Guitar",
		chorusLead: "String Ensemble 1",
		chordAlt: "Acoustic Grand Piano",
		sparkle: "Celesta",
		bassAlt: "Electric Bass (finger)",
		harmonyAlt: "Choir Aahs",
	},
	jazz_night: {
		displayName: "ジャズ・ナイト",
		description: "Rhodes風のEPとウッドベースによる、大人びたアンサンブル。",
		melody: "Electric Piano 1",
		submelody: "Flute",
		bass: "Acoustic Bass",
		chord: "Electric Guitar (jazz)",
		solo: "Tenor Sax",
		chorusLead: "Muted Trumpet",
		chordAlt: "Vibraphone",
		sparkle: "Celesta",
		bassAlt: "Electric Bass (finger)",
		harmonyAlt: "Choir Aahs",
	},

	// --- MODERN & VIBE: エッジの効いた現代的な響き ---
	synth_pop: {
		displayName: "シンセポップ",
		description: "80s〜現代まで。抜けるリードと太いベースの王道。",
		melody: "Lead 2 (sawtooth)",
		submelody: "Lead 4 (chiff)",
		bass: "Synth Bass 2",
		chord: "Pad 3 (polysynth)",
		solo: "Distortion Guitar",
		chorusLead: "Synth Brass 1",
		chordAlt: "Electric Piano 2",
		sparkle: "FX 3 (crystal)",
		bassAlt: "Synth Bass 1",
		harmonyAlt: "Synth Choir",
	},
	cyber_punk: {
		displayName: "サイバーパンク",
		description: "デジタルな冷たさと歪みが混ざり合う、未来的な響き。",
		melody: "Lead 8 (bass + lead)",
		submelody: "Lead 5 (charang)",
		bass: "Synth Bass 2",
		chord: "Pad 8 (sweep)",
		solo: "Distortion Guitar",
		chorusLead: "Lead 7 (fifths)",
		chordAlt: "Pad 4 (choir)",
		sparkle: "FX 3 (crystal)",
		bassAlt: "Synth Bass 1",
		harmonyAlt: "Synth Choir",
	},
	rock: {
		displayName: "ハードロック",
		description: "歪みギターと重厚なベースで、パワーを前面に。",
		melody: "Distortion Guitar",
		submelody: "Rock Organ",
		bass: "Electric Bass (pick)",
		chord: "Overdriven Guitar",
		solo: "Distortion Guitar",
		chorusLead: "Brass Section",
		chordAlt: "Electric Guitar (clean)",
		sparkle: "Electric Guitar (muted)",
		bassAlt: "Electric Bass (finger)",
		harmonyAlt: "Choir Aahs",
	},

	// --- WORLD & CLASSIC: 特定のジャンル・地域 ---
	orchestra: {
		displayName: "オーケストラ",
		description: "壮大な物語を予感させる、管弦楽器の重厚な響き。",
		melody: "French Horn",
		submelody: "Pizzicato Strings",
		bass: "Cello",
		chord: "Tremolo Strings",
		solo: "Violin",
		chorusLead: "Trumpet",
		chordAlt: "String Ensemble 1",
		sparkle: "Orchestral Harp",
		bassAlt: "Contrabass",
		harmonyAlt: "Choir Aahs",
	},
	japanese_wa: {
		displayName: "和風・雅",
		description: "琴と三味線の繊細な調べに、尺八の情緒を添えて。",
		melody: "Koto",
		submelody: "Shamisen",
		bass: "Taiko Drum",
		chord: "Shakuhachi",
		solo: "Shakuhachi",
		// piano プリセットと同じ理由で Glockenspiel を避ける（音源のピッチずれ）。
		chorusLead: "Celesta",
		chordAlt: "Kalimba",
		sparkle: "Music Box",
		bassAlt: "Acoustic Bass",
		harmonyAlt: "Choir Aahs",
	},
	arabic_exotic: {
		displayName: "エキゾチック",
		description: "シタールやバグパイプによる、異国情緒溢れるサウンド。",
		melody: "Sitar",
		submelody: "Bagpipe",
		bass: "Fretless Bass",
		chord: "Kalimba",
		solo: "Shanai",
		chorusLead: "Steel Drums",
		chordAlt: "Orchestral Harp",
		sparkle: "Tinkle Bell",
		bassAlt: "Acoustic Bass",
		harmonyAlt: "Choir Aahs",
	},

	// --- FANTASY & ATMOSPHERE: 雰囲気と余韻 ---
	fantasy_rpg: {
		displayName: "ファンタジーRPG",
		description: "オカリナとハープが紡ぐ、冒険と魔法の世界観。",
		melody: "Ocarina",
		submelody: "Celesta",
		bass: "Timpani",
		chord: "Orchestral Harp",
		solo: "Pan Flute",
		chorusLead: "Choir Aahs",
		chordAlt: "String Ensemble 2",
		sparkle: "Tinkle Bell",
		bassAlt: "Contrabass",
		harmonyAlt: "Choir Aahs",
	},
	ambient_cloud: {
		displayName: "アンビエント",
		description: "輪郭をぼかした音色で、深い没入感と余韻を演出。",
		melody: "Lead 6 (voice)",
		submelody: "Music Box",
		bass: "Synth Bass 1",
		chord: "Pad 7 (halo)",
		solo: "Lead 3 (calliope)",
		chorusLead: "Synth Choir",
		chordAlt: "Pad 5 (bowed)",
		sparkle: "FX 3 (crystal)",
		bassAlt: "Synth Bass 2",
		harmonyAlt: "Synth Choir",
	},
	retro_game: {
		displayName: "8-bit レトロ",
		description: "矩形波を想起させる、初期ゲーム機のような懐かしい響き。",
		melody: "Lead 1 (square)",
		submelody: "Lead 2 (sawtooth)",
		bass: "Synth Bass 1",
		chord: "Clavinet",
		solo: "Lead 8 (bass + lead)",
		chorusLead: "Lead 4 (chiff)",
		chordAlt: "Lead 5 (charang)",
		sparkle: "Xylophone",
		bassAlt: "Synth Bass 2",
		harmonyAlt: "Lead 6 (voice)",
	},
};

/**
 * 実物の楽器の音域（実音・MIDIノート番号、C4=60）。
 *
 * **音を作るためではなく、置き場所を決めるために要る。** 1トラック1楽器という制約の下で
 * セクションごとに音色を変えるには、同じ旋律を別のトラックへオクターブを変えて置くことに
 * なるが、そのオクターブを楽器の都合と無関係に決めると**その楽器が出せない高さ**へ行く。
 * サンプルが引き伸ばされて金切り音になり、聴き手には「耳が痛い」としか感じられない。
 *
 * 実測すると、サビの重ねを1オクターブ上げる指定は、ミュートトランペット・トランペットで
 * 14半音、ブラス・合唱・Lead 7 で12半音ぶん音域を突き抜けていた。コードパッド（実音
 * 77〜93）も、伴奏用の楽器をそのまま使うためナイロンギターで10半音・カリンバで9半音
 * はみ出していた。
 *
 * ソフトシンセは実物が無いので、一般的な音源の使用域を入れてある。
 * **この表は判断であって実測ではない**——音源を差し替えたら見直すこと。
 * 未登録の楽器は制限なしとして扱う（{@link fitInstrumentOctave}）。
 */
export const GM_INSTRUMENT_RANGE: Record<string, [number, number]> = {
	// 鍵盤・音板
	"Acoustic Grand Piano": [21, 108],
	"Electric Piano 1": [28, 103],
	Clavinet: [36, 96],
	Celesta: [60, 108],
	Glockenspiel: [79, 108],
	"Music Box": [72, 108],
	Vibraphone: [53, 89],
	Kalimba: [60, 84],
	"Orchestral Harp": [23, 104],
	// 弦・撥弦
	"Acoustic Guitar (steel)": [40, 83],
	"Acoustic Guitar (nylon)": [40, 83],
	"Electric Guitar (clean)": [40, 86],
	"Electric Guitar (jazz)": [40, 86],
	"Overdriven Guitar": [40, 88],
	"Distortion Guitar": [40, 88],
	Violin: [55, 103],
	Cello: [36, 76],
	"String Ensemble 1": [28, 100],
	"Tremolo Strings": [28, 100],
	"Pizzicato Strings": [28, 96],
	Sitar: [48, 79],
	Shamisen: [48, 84],
	Koto: [41, 77],
	// ベース
	"Acoustic Bass": [28, 60],
	"Electric Bass (finger)": [28, 67],
	"Electric Bass (pick)": [28, 67],
	"Fretless Bass": [28, 67],
	"Synth Bass 1": [24, 72],
	"Synth Bass 2": [24, 72],
	// 管
	Flute: [60, 96],
	"Pan Flute": [60, 91],
	Shakuhachi: [62, 86],
	Ocarina: [60, 84],
	Harmonica: [60, 96],
	Bagpipe: [62, 86],
	Shanai: [60, 86],
	"Tenor Sax": [44, 75],
	Trumpet: [55, 82],
	"Muted Trumpet": [55, 82],
	"French Horn": [41, 77],
	"Brass Section": [41, 84],
	// 声・打・オルガン
	"Choir Aahs": [43, 84],
	"Synth Choir": [43, 84],
	"Steel Drums": [55, 86],
	"Taiko Drum": [30, 60],
	Timpani: [36, 57],
	"Rock Organ": [36, 96],
	// シンセ（実物が無いので一般的な使用域）
	"Synth Brass 1": [36, 96],
	"Lead 1 (square)": [36, 96],
	"Lead 2 (sawtooth)": [36, 96],
	"Lead 3 (calliope)": [48, 96],
	"Lead 4 (chiff)": [48, 96],
	"Lead 5 (charang)": [40, 96],
	"Lead 6 (voice)": [43, 91],
	"Lead 7 (fifths)": [36, 84],
	"Lead 8 (bass + lead)": [28, 91],
	"Pad 2 (warm)": [24, 96],
	"Pad 3 (polysynth)": [24, 96],
	"Pad 7 (halo)": [24, 96],
	"Pad 8 (sweep)": [24, 96],
};

/**
 * 明るい音色を持続的に鳴らしてよい高さの上限（実音・MIDIノート番号）。
 *
 * **「耳が痛い」は音域の話ではなく、絶対的な高さの話。** 金属体・ベル系の音色は
 * 倍音が 2〜4kHz に集まり、そこは人の耳がいちばん敏感な帯域なので、実物の音域に
 * 収まっていても高いところで鳴らし続けると刺さる。グロッケンは実物の音域が
 * G5(79)〜C8 なので、{@link GM_INSTRUMENT_RANGE} だけで見ると旋律の音域（〜C6）は
 * 「余裕で範囲内」と判定されてしまう。実際には C6 のグロッケンは金切り音になる。
 *
 * ここに載せた楽器は、この高さより上で鳴らないところまでオクターブを下げる
 * （{@link fitInstrumentOctave}）。**楽器を候補から外すのではなく、置き場所を変える**
 * ——トラックのオクターブ設定（{@link TrackState.trackOctave} 相当）は、まさに
 * こういう「得意な音域が偏った音源」を使えるようにするために在る。
 * 低く鳴らしたグロッケンやオルゴールは、ポップスで普通に使われる柔らかい音になる。
 */
export const GM_BRIGHT_CEILING: Record<string, number> = {
	Glockenspiel: 72,
	"Tinkle Bell": 72,
	"Music Box": 79,
	Celesta: 84,
	Kalimba: 79,
	"Steel Drums": 84,
	"FX 3 (crystal)": 79,
};

/**
 * 音域のはみ出しを許す量（半音）。実物の上限を数半音超えるくらいはどの音源も自然に鳴るし、
 * ここを 0 にすると全部のプリセットが1オクターブ下がって曲が別物になる。
 */
const OCTAVE_FIT_TOLERANCE = 3;

/**
 * その楽器で無理なく鳴る位置まで、トラックのオクターブを下げる。
 *
 * **音色を選び直すのではなく、置き場所を変える。** 得意な音域が偏った音源
 * （グロッケンのような高音楽器）を使えるようにするのがオクターブ設定の役目なので、
 * 「その楽器では痛いから候補から外す」は筋が悪い。外すと音色の幅がそのぶん減る。
 *
 * **下げる方向にしか動かさない。** 上げる側は「耳が痛い」を作る方向で、直したい当のもの。
 * 低いほうへはみ出すのは（サンプルは伸びるが）柔らかく鳴るだけなので放っておく。
 *
 * @param semitoneRange そのトラックが実際に鳴らす音域 `[最低, 最高]`（オクターブ補正前）
 * @param instrument GM楽器名。{@link GM_INSTRUMENT_RANGE} に無ければ何もしない
 * @param wanted 編曲が指定したオクターブ
 * @returns 実際に設定するオクターブ（`wanted` 以下）
 */
export const fitInstrumentOctave = (
	semitoneRange: [number, number] | null,
	instrument: string,
	wanted: number,
): number => {
	const range = GM_INSTRUMENT_RANGE[instrument];
	if (!range || !semitoneRange) return wanted;
	// 実物の音域の上限と、明るい音色の「痛くならない上限」の厳しいほうで見る。
	const hi = Math.min(range[1], GM_BRIGHT_CEILING[instrument] ?? range[1]);
	let octave = wanted;
	// 2オクターブより下げると、直すつもりが別の楽曲になる。
	while (octave > wanted - 2) {
		if (semitoneRange[1] + octave * 12 <= hi + OCTAVE_FIT_TOLERANCE) break;
		octave--;
	}
	return octave;
};
