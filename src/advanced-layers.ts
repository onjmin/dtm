/**
 * 上級者モード（15トラック）の編曲を、トラック番号へ写す層。
 *
 * **daw.ts から切り出してある。** ここは DOM も音声も触らない純粋な写像で、
 * 声部をどのトラックへ・どの音色で置くかを決めるだけ。daw.ts に置いたままだと
 * `@onjmin/koe`（ブラウザ前提）を巻き込んで Node から読めず、
 * **分割で音が消えていないかを機械で検算できなかった**（`scripts/check-tracks.ts`）。
 * 編曲の割り当ては耳で気付きにくい壊れ方をするので、テストできる場所に置く。
 */

import { buildChordPlacements, type ChordPatternType } from "./chords";
import type { ComposedNote, ComposeResult } from "./compose";
import type { SectionKind } from "./compose-sections";
import {
	fitInstrumentOctave,
	type InstrumentPreset,
} from "./instrument-presets";
import { UNITS_PER_SEMITONE } from "./tuning";

/** 音色を引く役割。{@link INSTRUMENT_PRESETS} のキーに対応する。 */
export type AutoRole = "melody" | "submelody" | "bass" | "chord";

export type PresetSlot =
	| AutoRole
	| "solo"
	| "chorusLead"
	| "chordAlt"
	| "sparkle"
	| "bassAlt"
	| "harmonyAlt";

export type AdvancedLayer = {
	index: number;
	notes: ComposedNote[];
	octave: number;
	volume: number;
	/** 引く音色スロット。省略すると役割推定にまかせる。 */
	slot?: PresetSlot;
};

/**
 * 編曲プランを15トラックへ写す。
 *
 * `duet`（t11）は歌入り作曲だけが後から埋めるので、ここでは空で置く。
 */
/**
 * @internal 検証用に公開している（`scripts/check-tracks.ts`）。
 * 声部をトラックへ分割する処理は、**間違えると音が黙って消える**ので機械で検算する。
 */
export const buildAdvancedLayers = (
	song: ComposeResult,
	config: {
		edo?: number;
		stepsPerBar: number;
		/** この曲で鳴らす音色セット。層のオクターブを楽器の音域へ合わせるのに要る。 */
		preset: InstrumentPreset;
	},
): AdvancedLayer[] => {
	const { edo, stepsPerBar, preset } = config;
	/** ノート列が使う音域（半音）。空なら null。 */
	const semitoneRange = (notes: ComposedNote[]): [number, number] | null => {
		if (notes.length === 0) return null;
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (const n of notes) {
			const semi = n.pitchUnits / UNITS_PER_SEMITONE;
			if (semi < lo) lo = semi;
			if (semi > hi) hi = semi;
		}
		return [Math.round(lo), Math.round(hi)];
	};
	/**
	 * 編曲が指定したオクターブを、その楽器が無理なく鳴らせる位置まで下げる。
	 *
	 * **足す層にだけ掛ける。** 主旋律・サブメロ・ベースの音域は曲の骨格そのもので、
	 * 楽器の都合で勝手に1オクターブ動かすと別の曲になる（そちらは音色の選び方の問題
	 * なので、`scripts/check-registers.ts` が報告して人が直す）。
	 */
	const fit = (
		notes: ComposedNote[],
		slot: PresetSlot,
		wanted: number,
	): number => fitInstrumentOctave(semitoneRange(notes), preset[slot], wanted);
	const kindAtBar = (bar: number): SectionKind | null =>
		song.sections.find(
			(sec) => bar >= sec.startBar && bar < sec.startBar + sec.bars,
		)?.kind ?? null;
	/**
	 * 指定したセクションの小節にある音だけ残す。**これがセクション別の楽器替えの実体**
	 * ——1トラックは1楽器なので、別の音色で鳴らしたい区間は別のトラックへ抜き出すしかない。
	 */
	const onlyIn = (
		notes: ComposedNote[],
		kinds: SectionKind[] | null,
	): ComposedNote[] => {
		if (!kinds) return notes;
		const want = new Set(kinds);
		return notes.filter((n) => {
			const kind = kindAtBar(Math.floor(n.startStep / stepsPerBar));
			return kind !== null && want.has(kind);
		});
	};
	/** コード進行を1つの奏法で展開する。 */
	const chordNotes = (
		pattern: ChordPatternType,
		velocityShift = 0,
	): ComposedNote[] =>
		buildChordPlacements({
			edo,
			chordStr: song.chordProgression,
			patternType: pattern,
			rootShift: song.rootShift,
			bpm: song.bpm,
			stepsPerBar,
		}).map((p) => ({
			startStep: p.startStep,
			pitchUnits: p.pitchUnits,
			durationSteps: p.durationSteps,
			velocity: Math.max(30, p.velocity + velocityShift),
		}));

	const plan = song.arrange;

	/**
	 * セクションを「盛り上がる側」と「静かな側」に二分する。
	 *
	 * **同じ声部を2本のトラックへ“分割”するために使う（重ねるためではない）。**
	 * 1トラック1楽器なので、1本の線をセクションで音色替えするには、区間ごとに
	 * 別トラックへ書き分けるしかない。二分は排他かつ網羅——どの音もちょうど1回鳴る。
	 * オクターブ写しやユニゾン重ねと違い、音数は1音も増えない。
	 */
	const kindsPresent = [...new Set(song.sections.map((sec) => sec.kind))];
	const LOUD: SectionKind[] = ["chorus", "drop_chorus"];
	const loudKinds = kindsPresent.filter((k) => LOUD.includes(k));
	const quietKinds = kindsPresent.filter((k) => !LOUD.includes(k));
	/** 盛り上がる側が無い曲では分割しない（全部を静かな側が持つ）。 */
	const splittable = loudKinds.length > 0 && quietKinds.length > 0;

	// --- 楽器の音域に合わせてから並べる層 ---
	// サビの重ね。編曲は「オクターブ上」を引くことがあるが、その楽器が届かなければ
	// ユニゾンへ落ちる。実測では、トランペットやブラス・合唱で12〜14半音ぶん
	// 音域を突き抜けていた（＝金切り音）。
	const leadNotes = plan.lead ? onlyIn(song.melody, plan.lead.sections) : [];
	const leadOctave = fit(leadNotes, "chorusLead", plan.lead?.octave ?? 0);
	const leadLayer: AdvancedLayer = {
		index: 1,
		notes: leadNotes,
		octave: leadOctave,
		// ユニゾンで重ねるときは、オクターブ上より前に出やすいので少し引く。
		volume: leadOctave === 0 ? 54 : 62,
		slot: "chorusLead",
	};

	// ベースの重ね。**楽器へ合わせた結果オクターブ上でなくなったら落とす**——
	// ベース本体と同じ楽器・同じ音・同じ高さになり、ただの重複になるため
	// （ティンパニやタイコは上へ4半音も伸ばせない）。
	const bassNotes = plan.bassLayer
		? onlyIn(song.bass, plan.bassLayer.sections)
		: [];
	const bassOctave = fit(bassNotes, "bass", plan.bassLayer?.octave ?? 0);
	const wantBassLayer = plan.bassLayer !== null && bassOctave !== 0;
	/**
	 * t5。オクターブ上の重ねは**既定では出さない**（実測28%）——オクターブ等価の
	 * 写しに常設の価値は無い。だが**空けておく価値はもっと無い**ので、出ない曲では
	 * ベースを盛り上がる側／静かな側に**分割**し、t5 に別の音色（`bassAlt`）で
	 * 盛り上がる側を持たせる。音数は増えず、セクションの境目でベースの音色が変わる。
	 */
	const bassLayer: AdvancedLayer = wantBassLayer
		? {
				index: 5,
				notes: bassNotes,
				octave: bassOctave,
				volume: 58,
				slot: "bass",
			}
		: {
				index: 5,
				notes: splittable ? onlyIn(song.bass, loudKinds) : [],
				octave: 0,
				volume: 92,
				slot: "bassAlt",
			};

	const padNotes = onlyIn(song.pad, plan.padSections);

	const layers: AdvancedLayer[] = [
		{ index: 0, notes: song.melody, octave: 0, volume: 104, slot: "melody" },
		leadLayer,
		// t2 ハモリ。**セクションで分割しない。**
		// 一度 t12 と loud/quiet で分けてみたが、ハモリは音の87%が盛り上がる側にあり、
		// 71%の曲は静かな側に1音も無い——分割すると t2 が空になって中身が t12 へ移る。
		// 「トラック番号と役割の対応は固定」（ピアノロールのどこに何があるかが曲ごとに
		// 動くとユーザーが編集できない）という原則にも反するので、ここは丸ごと持つ。
		{ index: 2, notes: song.harmony, octave: 0, volume: 82 },
		// t3 サブメロ。t14 が間奏ソロを持たないとき、そちらへ盛り上がる側を渡して
		// こちらは静かな側だけ持つ。対旋律・合いの手がセクションで音色替えする。
		{
			index: 3,
			notes:
				song.solo.length === 0 && splittable
					? onlyIn(song.submelody, quietKinds)
					: song.submelody,
			octave: 0,
			volume: 86,
			slot: "submelody",
		},
		// t4。t5 が `bassAlt` で盛り上がる側を持つときは、こちらは静かな側だけ持つ
		// （分割であって間引きではない——2本合わせて元のベースが漏れなく鳴る）。
		{
			index: 4,
			notes:
				!wantBassLayer && splittable
					? onlyIn(song.bass, quietKinds)
					: song.bass,
			octave: 0,
			volume: 92,
			slot: "bass",
		},
		bassLayer,
		// **パッドは伴奏用の楽器で、伴奏より1.5オクターブ高いところを鳴らす。**
		// そのまま置くとナイロンギターで10半音、カリンバで9半音、尺八で7半音ぶん
		// 音域を突き抜ける。楽器に合わせて下げる。
		{
			index: 6,
			notes: padNotes,
			octave: fit(padNotes, "chord", 0),
			volume: 64,
			slot: "chord",
		},
	];

	// 伴奏は t7〜t9。プランが2本しか持たなければ3本目は空のまま。
	//
	// **音色を交互にする。** 奏法（`ChordPatternType`）は層ごとに別のものを引いていて、
	// 実測でも発音位置の一致は中央 Jaccard 0.13・ほぼ完全一致は4%しかない——つまり
	// リズムは書き分けられている。にもかかわらず t6〜t10 の**5本すべてが `chord` の
	// 1楽器**だったため、書き分けた層が同じ音色で重なって団子になっていた。
	// パッド(t6)=chord に対して交互に置き、隣り合う層が必ず違う音色になるようにする。
	const backingVolumes = [62, 54, 50];
	for (let i = 0; i < 3; i++) {
		const layer = plan.backing[i];
		layers.push({
			index: 7 + i,
			notes: layer ? onlyIn(chordNotes(layer.pattern), layer.sections) : [],
			octave: layer?.octave ?? 0,
			volume: backingVolumes[i],
			slot: i % 2 === 0 ? "chordAlt" : "chord",
		});
	}

	const sparkleNotes = plan.sparkle
		? onlyIn(chordNotes(plan.sparkle.pattern, -14), plan.sparkle.sections)
		: [];
	layers.push(
		{
			index: 10,
			notes: sparkleNotes,
			// 装飾は伴奏と別の音色にする（以前はここも `chord` の使い回しだった）。
			octave: fit(sparkleNotes, "sparkle", plan.sparkle?.octave ?? 0),
			volume: 56,
			slot: "sparkle",
		},
		// 掛け合い（デュエット）の相手。**歌入り作曲のときだけ**中身が入る。
		{ index: 11, notes: [], octave: 0, volume: 104, slot: "melody" },
		// 2声目のハモリ（主旋律を上下から挟む3声）と、主旋律のオクターブ下の重ね。
		// どちらも曲ごとに出るかどうかが決まる（`song.vocal`）。
		// t12。3声目のハモリは曲ごとに出るかが決まり、実測28%。
		//
		// 出ない曲では**パッド(t6)が鳴っていないセクション**を、別の音色
		// （`harmonyAlt` ＝声もの・柔らかい持続音）で受け持つ。パッドはセクション種別の
		// 39%しか覆っておらず補集合は常に存在するので、ここは**いま何も鳴っていない
		// 場所に持続音を足す**ことになる——重ねでも写しでもなく、純粋な追加。
		song.harmony2.length > 0
			? { index: 12, notes: song.harmony2, octave: 0, volume: 74 }
			: (() => {
					const rest = plan.padSections
						? kindsPresent.filter((k) => !plan.padSections?.includes(k))
						: [];
					const notes = rest.length > 0 ? onlyIn(song.pad, rest) : [];
					return {
						index: 12,
						notes,
						octave: fit(notes, "harmonyAlt", 0),
						volume: 60,
						slot: "harmonyAlt" as PresetSlot,
					};
				})(),
		// t13。既定は**主旋律のオクターブ下の重ね**で、歌入り作曲ではここに歌詞が付く
		// （オクターブ下でハモる歌手。単なる写しではない）。
		//
		// ただしこの層は曲ごとに出るかどうかが決まり、実測で**18%しか鳴らない**。
		// 残り82%はトラックが1本まるごと遊ぶ。オクターブ等価の写しに常設の価値は
		// 無いが、**空けておく価値はもっと無い**ので、層が無い曲では
		// 「t1（サビ重ね）が担当しないセクションの主旋律を、別の楽器でなぞる」層に回す。
		// t1 は CHORUS/LOUD 側を持つので、こちらは静かな側を持つ——結果として
		// **セクションの境目で主旋律に付く音色が入れ替わる**。1トラック1楽器の制約下で
		// 「パートごとに楽器が変わる」を作れるのは、この書き分けだけ。
		song.octave.length > 0
			? {
					index: 13,
					notes: song.octave,
					octave: -1,
					volume: 56,
					slot: "melody" as PresetSlot,
				}
			: (() => {
					const leadKinds = new Set(plan.lead?.sections ?? []);
					const quiet = song.sections
						.filter((sec) => sec.spec.melody && !leadKinds.has(sec.kind))
						.map((sec) => sec.kind);
					const notes = quiet.length > 0 ? onlyIn(song.melody, quiet) : [];
					// **主旋律とも伴奏とも同じ楽器になっては意味が無い。** プリセットによっては
					// `solo` が `melody` と同じ（ハードロックはどちらも歪みギター）だったり、
					// `chord` と同じ（和風はどちらも尺八）だったりする。そのまま使うと
					// 「同じ音を同じ音色で重ねる」——直したはずの被りに戻る。
					// 主旋律とも伴奏とも違う音色になる最初のスロットを採る。
					const slot: PresetSlot =
						(["solo", "chorusLead", "submelody", "chordAlt"] as const).find(
							(k) => preset[k] !== preset.melody && preset[k] !== preset.chord,
						) ?? "submelody";
					return {
						index: 13,
						notes,
						// ユニゾンで置く。**音色だけを変えるのが狙い**なので、
						// オクターブを動かすと「オクターブ写し」に戻ってしまう。
						octave: fit(notes, slot, 0),
						volume: 58,
						slot,
					};
				})(),
		// **間奏のソロ。** 音が入るのは間奏の小節だけなので、この1本だけを
		// 別の楽器にしても他のセクションの鳴りは変わらない。歌の音域をそのまま
		// 渡すと管楽器が上へ抜ける（テナーサックスで10半音）ので、ここも合わせる。
		// t14。**間奏のソロ。** ただし間奏は既定の構成（`DEFAULT_SECTIONS`）に無く、
		// テンプレートも `jpop_standard` しか含まないので、実測で**0%**——設計上の
		// 出番が既定では一度も来ないトラックだった。
		// 間奏が無い曲では、サブメロの盛り上がる側を `solo` の音色で受け持つ
		// （t3 は静かな側。分割なので音数は増えない）。
		song.solo.length > 0
			? {
					index: 14,
					notes: song.solo,
					octave: fit(song.solo, "solo", 0),
					volume: 100,
					slot: "solo" as PresetSlot,
				}
			: (() => {
					const notes = splittable ? onlyIn(song.submelody, loudKinds) : [];
					return {
						index: 14,
						notes,
						octave: fit(notes, "solo", 0),
						volume: 86,
						slot: "solo" as PresetSlot,
					};
				})(),
	);
	return layers;
};
