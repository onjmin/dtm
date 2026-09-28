/**
 * 伴奏主体モードの実現器（`docs/accomp-compose.md` §6 段4〜段10）。計画（`AccompPlan`）を
 * 4トラックのノートにする。純関数だけを置く。
 *
 * - 段4 和音の配置（@3）… 3声の密集配置。分散のぶつかり回避に使うので最初に決める
 * - 段5 和音の打ち方 … スタイルの `patterns.comp`。借用和音だけ長く、home の予告は fore、最終小節は
 *   final。決めた打ち方は小節ごとに記録し（{@link AccompRealized.compHits}）、計画が記録を持っていれば
 *   それに従う（`PlanPins`、`docs/accomp-style-engine.md` §3.1）
 * - 段6 低音（@2）… スタイルの `patterns.bass`。経過音 P・区間の境の半音渡し・曲末の導音
 * - 段7 分散（@1、主役）… 和音ごとに5音の組を選び、4小節ごとのセルに流し込む
 * - 段8 色の線（@0）… borrowB の4小節と最終小節だけ
 * - 段9 強弱 … 絶対値の v を3層（区間の起伏・拍の加減・丸め）で付け、`splitTrackVelocity` で正規化
 * - 段10 表現上の制約 … {@link expressionViolations}
 *
 * **ハ長調で作る**（§6 共通の約束）。音は（MIDI 相当の半音, 五度圏の位置）の組で持ち、最後に
 * `spelledToUnits(...) + semitonesToUnits(rootShift)` で units へ写す。31平均律でも ♭VI（A♭）が
 * G# に化けない。音域の窓は**実際に鳴る高さ（絶対 MIDI）**で表にあり、−rootShift して当てる。
 *
 * 乱数は候補の乱数列のうち「配置」（和音の置き方と分散の組の同点）と「色」（色の線）だけを使う。
 * 強弱は計画（`AccompRegion.arpLevel`）と表から決まり、乱数を使わない。
 *
 * **設計書からずらした点**（どれも陽性対照 fb の実測に合わせるため。値は表にある）
 * - 分散の窓は硬い制約にせず、`widenMax`（スタイルの分散の層）まで外へ出るのを許して距離を費用に足す。窓は fb
 *   （ホ長調）の実測で天辺の幅が2〜4半音しかなく、調と和音によっては構成音が1つも無い。
 * - s0 は3度も候補に入れ、1点重くする（「無ければ3度」の代わり）。M7 の和音は和音トラックの7度が
 *   根音を塞ぐ（短2度・短9度になる）ので、fb C1 の「3度から上の組」を作れるようにする。
 * - sus4 の4度→5度（全音）を、組の中で隣り合ってよい音程に足す（fb L 64 の Bsus4 は E5・F#5 を並べる）。
 * - 分散の組の「前の組」との距離は、区間の頭で忘れる（区間ごとに窓が違う）。
 * - 和音の置き方は、窓の中で組めない和音（`vi(add9)`・`M7(#11)`）だけ窓の外を許す。
 * - home の最終小節（`Vsus4 V`）も曲の最終小節と同じ final で打つ（fb の A16 がそう。曲末と home の
 *   終わりが同じ形になり、ループの頭へつながる）。
 * - 最終小節の色の線（sus4 の4度→3度）には「分散の天辺より2半音以上下」を求めない（fb は E5→D#5 を
 *   天辺の高さで鳴らしている。設計書の例「C5→B4」もその高さ）。2拍ずつ必ず置き（閉じ方⑤）、`range` の
 *   中に置けなければ `finalWiden` だけ広げて探す。
 * - 色の線の「分散が途中で天辺を弾くなら、その手前で切る」は、分散と半音（短2度・短9度）でぶつかる
 *   ときだけ切る、と読んだ（fb の50小節の F#5 と G5 の解消は、ぶつかりを切った例。fb は天辺の G5 の下を
 *   伸ばしている小節もある）。切って2拍に満たない高さには置かない。
 * - 色の線の「同じ拍で分散と同じ音を弾かない」は外した。fb は @0 の6音すべてで分散と同音が重なり、
 *   50・54小節は鳴り出しも同時。
 *
 * 表は計画の `style`・`archetype` からスタイルを引いて読む（`compose-accomp-style.ts` の
 * `planStyleView`。段階 S1）。
 *
 * 実行時に import してよいものは §4.2 のとおり（`mml-parser`・`lyrics`・`daw` は読まない）。
 */

import type {
	Accents,
	ArpSetParams,
	BassStep,
	BassTone,
	CompHit,
} from "./accomp-styles/schema";
import { semitonesToUnits, spelledToUnits } from "./chords";
import type { ComposedNote } from "./compose";
import { seededRandom } from "./compose";
import type {
	AccompPlan,
	AccompRegion,
	AccompRole,
	AccompSlot,
	AccompTrack,
} from "./compose-accomp";
import {
	type AccompChord,
	type AccompPlanViolation,
	type AccompStreams,
	type AccompTone,
	echoBars,
	foreshadowBars,
	planBars,
} from "./compose-accomp-plan";
import {
	type AccompStyleView,
	type ColorLine,
	type CompHitPattern,
	planStyleView,
} from "./compose-accomp-style";
import { splitTrackVelocity } from "./mml-velocity";
import type { Units } from "./tuning";

/**
 * 使う音価（16分の数）。MMLCore が表せる長さで、タイは使えない（§6 共通の約束）。エンジンの定数
 * （スタイルによらない。関門「表現」）。
 */
export const NOTE_LENGTHS_16: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16];

// ============================================================
// 公開の型
// ============================================================

/**
 * 音の和声上の扱い（関門「和声との整合」と表示のため）。
 * - `chord` 鳴っている和音の構成音（三和音と7度・6度・sus の4度）
 * - `tension` 記号に書かれたテンション（9・#11）
 * - `passing` 低音の経過音 P のうち、和音外の音
 * - `approach` 低音の半音渡し（区間の境・借用和音に入る所・曲末）のうち、和音外の音
 */
export type AccompNoteKind = "chord" | "tension" | "passing" | "approach";

/** 実現した音（正規化の前の、絶対値の v を持つ形）。 */
export type AccompRealizedNote = {
	slot: AccompSlot;
	/** 曲の中の小節（0 始まり）。 */
	bar: number;
	/** 小節の中の位置（16分）。 */
	pos16: number;
	/** 長さ（16分）。`NOTE_LENGTHS_16` のどれか。 */
	len16: number;
	/** 実際に鳴る高さ（12平均律の MIDI 番号。ハ長調の座標 + rootShift）。 */
	midi: number;
	/** ハ長調の座標での綴り（五度圏の位置。C=0、G=1、A♭=−4）。 */
	fifth: number;
	/** 絶対値の v（1〜127）。 */
	v: number;
	kind: AccompNoteKind;
	regionIndex: number;
	role: AccompRole;
};

export type AccompRealized = {
	bars: number;
	stepsPerBar: number;
	edo: 12 | 31;
	/**
	 * @0 の色の線を置いたか（`RealizeAccompInput.colorLine`）。true なら関門「継ぎ目」は、最終小節の
	 * sus4 の4度→3度（2拍ずつ）を必ず求める（ループの閉じ方⑤）。
	 */
	colorLine: boolean;
	/** トラックごとの音（絶対値の v）。関門・指標・表示はこちらを見る。 */
	notes: Record<AccompSlot, AccompRealizedNote[]>;
	/**
	 * 正規化した4トラック（§6 段9）。velocity は相対値（100 = volume）で、MML を読み込んだ直後と
	 * 同じ形。DAW へはこのまま書く。
	 */
	tracks: [AccompTrack, AccompTrack, AccompTrack, AccompTrack];
	/**
	 * 小節ごとに使った和音の打ち方の id（区間ごと。`plan.regions` と同じ並び）。計画が記録
	 * （`AccompRegion.compHits`）を持っていればその写し、無ければ優先順位で決めたもの。
	 * `composeAccomp` はこれを曲の計画に記録する（`PlanPins`）。
	 */
	compHits: string[][];
};

export type RealizeAccompInput = {
	plan: AccompPlan;
	/**
	 * 候補の乱数列（`candidateStreams`）。使うのは voicing と color。省略すると決まった種
	 * （保険の計画や陽性対照を、乱数なしで鳴らすため）。
	 */
	streams?: Pick<AccompStreams, "voicing" | "color">;
	/** 既定 192。16 の倍数でなければ例外。 */
	stepsPerBar?: number;
	/** 既定 12。 */
	edo?: 12 | 31;
	/** @0 の色の線。既定 true。 */
	colorLine?: boolean;
};

/** トラックの並び（`AccompTrack.index` の順）。 */
export const ACCOMP_SLOTS: readonly AccompSlot[] = [
	"color",
	"arp",
	"bass",
	"comp",
];

// ============================================================
// 共通
// ============================================================

const mod12 = (n: number): number => ((n % 12) + 12) % 12;
const EPS = 1e-9;

/** 2音が短2度・短9度（半音差。オクターブ違いを含み、長7度は含まない）か。`tmp/full/clash-all.ts` と同じ判定。 */
export const isClash = (a: number, b: number): boolean =>
	Math.abs(a - b) % 12 === 1;

/** 音（ハ長調の座標）。 */
type Pitch = { midi: number; fifth: number; tone?: AccompTone };

/** 同じ和音か（根音・長短・借用が同じ。テンションと分数の低音は見ない）。vi7 と vi(add9) は同じ。 */
const sameChord = (a: AccompChord, b: AccompChord): boolean =>
	a.root.pc === b.root.pc && a.third === b.third && a.borrowed === b.borrowed;

/** 候補のうち費用が最小のものを選ぶ。同点は乱数（同点が無ければ乱数を引かない）。 */
const pickMin = <T>(
	items: readonly T[],
	cost: (x: T) => number,
	rnd: () => number,
): T => {
	let best = Number.POSITIVE_INFINITY;
	let ties: T[] = [];
	for (const it of items) {
		const c = cost(it);
		if (c < best - EPS) {
			best = c;
			ties = [it];
		} else if (Math.abs(c - best) <= EPS) ties.push(it);
	}
	if (ties.length === 0) throw new Error("pickMin: 候補が無い");
	return ties.length === 1 ? ties[0] : ties[Math.floor(rnd() * ties.length)];
};

/** その音（音高クラス）が lo〜hi に取りうる高さ。 */
const tonePitches = (tone: AccompTone, lo: number, hi: number): Pitch[] => {
	const out: Pitch[] = [];
	for (let m = lo + mod12(tone.pc - lo); m <= hi; m += 12)
		out.push({ midi: m, fifth: tone.fifth, tone });
	return out;
};

const isChordTone = (pc: number, chord: AccompChord): boolean =>
	chord.tones.some((t) => t.pc === mod12(pc));

/**
 * 和音と「短2度でぶつかる」か（§6 段6）。和音のどれかの音が、その音の**半音上**にある。
 * 上の声部との短2度・短9度になる向きだけを見る（`isClash` と同じ向き）。fb の D→D#→E
 * （D の和音の上で D#）は下に半音なので、ぶつかりに数えない。
 */
const clashesUnder = (pc: number, chord: AccompChord): boolean =>
	chord.tones.some((t) => mod12(t.pc - pc) === 1);

// ============================================================
// 小節の展開
// ============================================================

type ChordSlot = { chord: AccompChord; from: number; to: number };

type BarInfo = {
	bar: number;
	regionIndex: number;
	region: AccompRegion;
	role: AccompRole;
	barInRegion: number;
	/** その小節の和音（1つなら 0〜16、2つなら 0〜8・8〜16）。 */
	slots: ChordSlot[];
	/** 同じ和音の2小節目（1和音の小節どうし、区間の中だけ）。 */
	second: boolean;
	/** 次の小節が同じ和音の2小節目になる。 */
	pairedNext: boolean;
	lastInRegion: boolean;
};

const buildBars = (plan: AccompPlan): BarInfo[] => {
	const out: BarInfo[] = planBars(plan).map((pb) => {
		const region = plan.regions[pb.regionIndex];
		const slots: ChordSlot[] =
			pb.chords.length === 1
				? [{ chord: pb.chords[0], from: 0, to: 16 }]
				: [
						{ chord: pb.chords[0], from: 0, to: 8 },
						{ chord: pb.chords[1], from: 8, to: 16 },
					];
		return {
			bar: pb.bar,
			regionIndex: pb.regionIndex,
			region,
			role: pb.role,
			barInRegion: pb.barInRegion,
			slots,
			second: false,
			pairedNext: false,
			lastInRegion: pb.barInRegion === region.bars - 1,
		};
	});
	for (let i = 1; i < out.length; i++) {
		const p = out[i - 1];
		const b = out[i];
		if (
			p.regionIndex === b.regionIndex &&
			p.slots.length === 1 &&
			b.slots.length === 1 &&
			!p.second &&
			sameChord(p.slots[0].chord, b.slots[0].chord)
		) {
			b.second = true;
			p.pairedNext = true;
		}
	}
	return out;
};

/** 音の内部の形（ハ長調の座標、v は段9で入れる）。 */
type Draft = {
	slot: AccompSlot;
	bar: number;
	pos16: number;
	len16: number;
	midi: number;
	fifth: number;
	kind: AccompNoteKind;
	v: number;
};

const startOf = (n: { bar: number; pos16: number }): number =>
	n.bar * 16 + n.pos16;

// ============================================================
// 段4: 和音の配置（@3）
// ============================================================

/** 置き方で使う3音（スタイルの和音の層の `tones` の度数。足りなければテンション以外の構成音で埋める）。 */
const compTones = (chord: AccompChord, v: AccompStyleView): AccompTone[] => {
	const picked: AccompTone[] = [];
	for (const d of v.compTones[chord.voicing]) {
		const t = chord.tones.find((x) => x.degree === d && !picked.includes(x));
		if (t) picked.push(t);
	}
	for (const t of chord.tones)
		if (picked.length < 3 && !t.tension && !picked.includes(t)) picked.push(t);
	return picked.slice(0, 3);
};

const voicingCandidates = (
	tones: readonly AccompTone[],
	lo: number,
	hi: number,
): Pitch[][] => {
	const lists = tones.map((t) => tonePitches(t, lo, hi));
	const out: Pitch[][] = [];
	const rec = (i: number, acc: Pitch[]): void => {
		if (i === lists.length) {
			const v = [...acc].sort((a, b) => a.midi - b.midi);
			for (let k = 1; k < v.length; k++)
				if (v[k].midi - v[k - 1].midi <= 1) return; // 隣の声部と半音（か同音）
			if (v[v.length - 1].midi - v[0].midi > 12) return; // 幅がオクターブを超える
			out.push(v);
			return;
		}
		for (const p of lists[i]) rec(i + 1, [...acc, p]);
	};
	rec(0, []);
	return out;
};

/**
 * 段4。3声の密集配置を選ぶ。窓は F#3〜F#4（段 ±1 で 4 半音ずつ）を −rootShift して当てる。
 * 直前の配置からの移動量 Σ|Δ| が最小のもの。最上音が D4〜F#4 にあれば加点。同点は乱数。
 *
 * 窓の中で組めない和音だけ、窓の外を `widenMax`（スタイルの和音の層）まで許し、外へ出た距離に `outside` を
 * 掛けて費用に足す。`vi(add9)` の {3,5,9} や `M7(#11)` の {5,7,#11} は、隣の声部と半音に
 * ならない並びが1つ（幅11半音）しか無く、13半音の窓に入る調が限られる（上か下か近い方へ出る）。
 */
const chooseVoicing = (
	chord: AccompChord,
	register: number,
	rootShift: number,
	prev: readonly Pitch[] | null,
	rnd: () => number,
	v: AccompStyleView,
): Pitch[] => {
	const cv = v.compVoicing;
	const shift = register * cv.registerStep - rootShift;
	const lo = cv.low + shift;
	const hi = cv.high + shift;
	const center = (lo + hi) / 2;
	const pLo = cv.preferTop.low + shift;
	const pHi = cv.preferTop.high + shift;
	const tones = compTones(chord, v);
	let cands = voicingCandidates(tones, lo, hi);
	if (cands.length === 0) {
		const w = cv.widenMax;
		cands = voicingCandidates(tones, lo - w, hi + w);
	}
	if (cands.length === 0)
		throw new Error(`和音の置き方が見つからない: ${chord.roman}`);
	return pickMin(
		cands,
		(v) => {
			const bottom = v[0].midi;
			const top = v[v.length - 1].midi;
			const move =
				prev && prev.length === v.length
					? v.reduce((a, p, i) => a + Math.abs(p.midi - prev[i].midi), 0)
					: Math.abs(v.reduce((a, p) => a + p.midi, 0) / v.length - center);
			const outside = Math.max(0, lo - bottom) + Math.max(0, top - hi);
			return (
				move +
				cv.outside * outside -
				(top >= pLo && top <= pHi ? cv.topBonus : 0)
			);
		},
		rnd,
	);
};

// ============================================================
// 段5: 和音の打ち方
// ============================================================

/**
 * 段5 の1。その小節の打ち方の id（スタイルの `patterns.comp`）。優先順は次のとおり
 * （S3a でスタイルの `compRules` へ移す）。
 * 1. 曲の最終小節と home の最終小節（どちらも `Vsus4 V`）→ final
 * 2. home の予告の小節 → fore
 * 3. 借用和音の小節 → long（同じ和音の2小節目・区間の後半で形を変える）
 * 4. 区間の打ち方。alt13 は、同じ和音の2小節を1拍目→3拍目の順で打つ。minorDwell の1小節1和音は
 *    short2、lift のように組が無い区間は小節の偶奇で交互。
 *
 * 計画が記録（`AccompRegion.compHits`）を持っていれば、この優先順位は使わずに記録に従う。
 */
const compHitIdFor = (
	b: BarInfo,
	fore: ReadonlySet<number>,
	songLast: boolean,
): string => {
	if (songLast || (b.role === "home" && b.lastInRegion)) return "final";
	if (fore.has(b.bar)) return "fore";
	if (b.slots.some((s) => s.chord.borrowed)) return "long";
	if (b.region.texture.comp === "alt13") {
		if (
			b.slots.length === 1 &&
			!b.second &&
			!b.pairedNext &&
			b.role === "minorDwell"
		)
			return "short2";
		return "alt13";
	}
	return "short2";
};

/**
 * 段5 の2。打ち方 id の、その小節の形（1小節ぶん）。半小節2和音は `two` の1つめ。1和音は、区間の
 * 後半なら `late`（あれば）、形が2つあるときは打ち方の `alternate` で選ぶ（同じ和音の2小節目・
 * 組の1小節目・小節の偶奇）。いままで `compHitsFor` が id ごとに書いていた選び方と同じ。
 */
const compForm = (h: CompHitPattern, b: BarInfo): readonly CompHit[] => {
	if (b.slots.length === 2) return h.two[0];
	const forms = h.late && b.barInRegion >= b.region.bars / 2 ? h.late : h.one;
	if (forms.length === 1) return forms[0];
	switch (h.alternate) {
		case "sameChord":
			return forms[b.second ? 1 : 0];
		case "sameChordElseParity":
			return b.second
				? forms[1]
				: b.pairedNext
					? forms[0]
					: forms[b.barInRegion % 2];
		default:
			return forms[0];
	}
};

// ============================================================
// 段6: 低音（@2）
// ============================================================

/** ハ長調の音階（経過音 P の「音階上の隣の音」）。 */
const SCALE = [
	{ pc: 0, fifth: 0 },
	{ pc: 2, fifth: 2 },
	{ pc: 4, fifth: 4 },
	{ pc: 5, fifth: -1 },
	{ pc: 7, fifth: 1 },
	{ pc: 9, fifth: 3 },
	{ pc: 11, fifth: 5 },
] as const;

type BassRange = {
	rootLow: number;
	rootHigh: number;
	high: number;
	/** 半音渡しの音だけ、根音の下限より1つ下まで許す。 */
	floor: number;
};

/** 根音（分数和音なら低音）の置き場所を、前の根音に最も近いオクターブに決める。 */
const placeRoot = (
	chord: AccompChord,
	prev: number,
	range: BassRange,
): Pitch => {
	let best = Number.NaN;
	for (
		let m = range.rootLow + mod12(chord.bass.pc - range.rootLow);
		m <= range.rootHigh;
		m += 12
	)
		if (Number.isNaN(best) || Math.abs(m - prev) < Math.abs(best - prev))
			best = m;
	return { midi: best, fifth: chord.bass.fifth };
};

/**
 * 根音の完全5度上（52 を超えるなら 5度下）。分数和音で5度上が和音に無ければ、低音から完全5度に
 * 最も近い構成音（Am7/G なら C）。
 */
const fifthOf = (
	root: Pitch,
	chord: AccompChord,
	range: BassRange,
	below: boolean,
): Pitch => {
	let iv = 7;
	let fifth = root.fifth + 1;
	if (!chord.tones.some((t) => !t.tension && t.pc === mod12(root.midi + 7))) {
		let bestD = Number.POSITIVE_INFINITY;
		for (const t of chord.tones) {
			if (t.tension || t.pc === mod12(root.midi)) continue;
			const d = mod12(t.pc - root.midi);
			if (Math.abs(d - 7) < bestD) {
				bestD = Math.abs(d - 7);
				iv = d;
				fifth = t.fifth;
			}
		}
	}
	let m = root.midi + iv;
	if (below) {
		m -= 12;
		if (m < range.rootLow) m += 12;
	}
	if (m > range.high) m -= 12;
	return { midi: m, fifth };
};

type BassCtx = {
	chord: AccompChord;
	root: Pitch;
	/** 次の和音（小節の中の2つめ、次の小節の頭、曲末なら曲頭）。 */
	next: { chord: AccompChord; root: Pitch };
	/** 次の和音が別の区間（曲末は曲頭へのループ）。 */
	boundary: boolean;
	prevMidi: number;
	range: BassRange;
};

/**
 * 経過音 P（§6 段6）。区間の境と借用和音に入る所では次の根音の半音下（綴りは導音）。
 * それ以外は音階上の隣の音（和音の音を優先し、前の音に近いほう）。次の根音が同じなら5度。
 * 半音下が和音と短2度でぶつかる（和音に次の根音そのものがある）ときは5度に戻す。
 */
const passingTone = (c: BassCtx): { p: Pitch; kind: AccompNoteKind } => {
	const fifth = (): { p: Pitch; kind: AccompNoteKind } => ({
		p: fifthOf(c.root, c.chord, c.range, false),
		kind: "chord",
	});
	const kindOf = (p: Pitch, off: AccompNoteKind): AccompNoteKind =>
		isChordTone(p.midi, c.chord) ? "chord" : off;
	if (c.boundary || c.next.chord.borrowed) {
		const p = { midi: c.next.root.midi - 1, fifth: c.next.root.fifth + 5 };
		if (p.midi < c.range.floor || clashesUnder(p.midi, c.chord)) return fifth();
		return { p, kind: kindOf(p, "approach") };
	}
	if (mod12(c.next.root.midi) === mod12(c.root.midi)) return fifth();
	const i = SCALE.findIndex((s) => s.pc === mod12(c.next.root.midi));
	if (i < 0) return fifth();
	const below = SCALE[(i + 6) % 7];
	const above = SCALE[(i + 1) % 7];
	const cands: Pitch[] = [
		{
			midi: c.next.root.midi - mod12(c.next.root.midi - below.pc),
			fifth: below.fifth,
		},
		{
			midi: c.next.root.midi + mod12(above.pc - c.next.root.midi),
			fifth: above.fifth,
		},
	].filter((p) => {
		if (p.midi < c.range.floor || p.midi > c.range.high) return false;
		if (isChordTone(p.midi, c.chord)) return true;
		// 和音外の経過音は、和音の音と半音で並ばない（どちら向きでも）
		return !c.chord.tones.some((t) => {
			const d = mod12(t.pc - p.midi);
			return d === 1 || d === 11;
		});
	});
	if (cands.length === 0) return fifth();
	const p = [...cands].sort(
		(a, b) =>
			Number(isChordTone(b.midi, c.chord)) -
				Number(isChordTone(a.midi, c.chord)) ||
			Math.abs(a.midi - c.prevMidi) - Math.abs(b.midi - c.prevMidi),
	)[0];
	return { p, kind: kindOf(p, "passing") };
};

/**
 * `N`（fb C2 56 の Am6 の F#→E）。次の根音へ全音か半音で寄せる**構成音**。無ければ5度。
 */
const neighborChordTone = (c: BassCtx): Pitch => {
	let best: Pitch | undefined;
	for (const t of c.chord.tones) {
		if (t.tension) continue;
		for (const d of [1, 2, -1, -2]) {
			if (mod12(c.next.root.midi + d) !== t.pc) continue;
			const p = { midi: c.next.root.midi + d, fifth: t.fifth };
			if (p.midi < c.range.rootLow || p.midi > c.range.high) continue;
			if (
				!best ||
				Math.abs(p.midi - c.root.midi) < Math.abs(best.midi - c.root.midi)
			)
				best = p;
		}
	}
	return best ?? fifthOf(c.root, c.chord, c.range, false);
};

/** その小節の低音型（1小節ぶん）。2和音の小節は split、区間の最終小節は last の型へ替える。 */
const bassForm = (b: BarInfo, v: AccompStyleView): readonly BassStep[] => {
	const id = b.region.texture.bass[Math.floor(b.barInRegion / 4)];
	let pat = v.bassPatterns[id];
	if (!pat) throw new Error(`低音型が無い: ${id}`);
	if (b.slots.length === 2 && pat.split) pat = v.bassPatterns[pat.split];
	if (b.lastInRegion && pat.last) pat = v.bassPatterns[pat.last];
	if (pat.bars.length === 1) return pat.bars[0];
	const i =
		pat.alternate === "barParity" ? b.barInRegion % 2 : b.second ? 1 : 0;
	return pat.bars[i];
};

// ============================================================
// 段7: 分散（@1）
// ============================================================

type ArpWindow = {
	lowMin: number;
	lowMax: number;
	topMin: number;
	topMax: number;
};

/** セルの1音（小節の中の位置と、音の番号）。 */
type ArpStepAt = { idx: number; pos16: number; len16: number };

/** その音と同時に鳴る、和音トラック・低音の音。 */
type Overlap = { midi: number; slot: "comp" | "bass" };

/**
 * 段7 の音の組の候補（§6 段7）。s0 は根音・5度・3度（無ければテンション以外の構成音）、
 * s1〜s4 は構成音とテンション。隣り合う音程は 3〜9 半音で、全音は s4 がテンションのときの
 * s3→s4 と sus4 の4度→5度だけ。音域は窓を `widenMax`（スタイルの分散の層）だけ広げた範囲（窓の外は
 * {@link setCost} が重くする）。
 */
const arpCandidates = (
	chord: AccompChord,
	win: ArpWindow,
	set: ArpSetParams,
): Pitch[][] => {
	const w = set.widenMax;
	const lo = win.lowMin - w;
	const lowHi = win.lowMax + w;
	const topLo = win.topMin - w;
	const hi = win.topMax + w;
	const all = chord.tones
		.flatMap((t) => tonePitches(t, lo, hi))
		.sort((a, b) => a.midi - b.midi);
	const inLow = all.filter((p) => p.midi <= lowHi);
	let s0s = inLow.filter(
		(p) =>
			p.tone?.degree === "R" ||
			p.tone?.degree === "5" ||
			p.tone?.degree === "3",
	);
	if (s0s.length === 0) s0s = inLow.filter((p) => !p.tone?.tension);
	const sus = chord.third === "sus4";
	const out: Pitch[][] = [];
	const rec = (acc: Pitch[]): void => {
		const last = acc[acc.length - 1];
		if (acc.length === 5) {
			out.push([...acc]);
			return;
		}
		const isTop = acc.length === 4;
		for (const p of all) {
			const iv = p.midi - last.midi;
			if (iv <= 0) continue;
			if (iv > set.stepMax) break;
			const wholeStepOk =
				(isTop && p.tone?.tension) ||
				(sus && last.tone?.degree === "3" && p.tone?.degree === "5");
			if (iv < (wholeStepOk ? set.tensionStepMin : set.stepMin)) continue;
			if (isTop && p.midi < topLo) continue;
			acc.push(p);
			rec(acc);
			acc.pop();
		}
	};
	for (const s0 of s0s) rec([s0]);
	return out;
};

const setCost = (
	s: readonly Pitch[],
	prev: readonly Pitch[] | null,
	win: ArpWindow,
	set: ArpSetParams,
): number => {
	const k = set.cost;
	let c = 0;
	for (let i = 1; i < s.length; i++) {
		const iv = s[i].midi - s[i - 1].midi;
		c += k.interval * Math.abs(iv - k.idealInterval);
		if (iv <= 2) c += k.second;
	}
	if (prev) {
		c += k.top * Math.abs(s[4].midi - prev[4].midi);
		c += k.bottom * Math.abs(s[0].midi - prev[0].midi);
	}
	if (s[0].tone?.degree === "3") c += k.third;
	const o = k.outside;
	c +=
		o.lowDown * Math.max(0, win.lowMin - s[0].midi) +
		o.lowUp * Math.max(0, s[0].midi - win.lowMax) +
		o.topDown * Math.max(0, win.topMin - s[4].midi) +
		o.topUp * Math.max(0, s[4].midi - win.topMax);
	return c;
};

/**
 * 段7。1つの和音の音の組を選ぶ。費用（§6 段7 の式に、s0 の3度と窓の外の距離を足したもの）が
 * 最小のもの。同点は乱数。**和音トラックとの短2度・短9度（関門「ぶつかり」）が0になる組が
 * あれば、その中から選ぶ。** 低音とのぶつかりは費用に入る（1つ `cost.clash`）。
 */
const chooseArpSet = (
	chord: AccompChord,
	win: ArpWindow,
	steps: readonly { idx: number; over: readonly Overlap[] }[],
	prev: readonly Pitch[] | null,
	rnd: () => number,
	set: ArpSetParams,
): Pitch[] => {
	const cands = arpCandidates(chord, win, set);
	if (cands.length === 0)
		throw new Error(`分散の音の組が見つからない: ${chord.roman}`);
	const scored = cands.map((s) => {
		let comp = 0;
		let bass = 0;
		for (const st of steps) {
			const m = s[st.idx].midi;
			for (const o of st.over)
				if (isClash(m, o.midi)) {
					if (o.slot === "comp") comp++;
					else bass++;
				}
		}
		return {
			s,
			comp,
			cost: setCost(s, prev, win, set) + set.cost.clash * (comp + bass),
		};
	});
	const clean = scored.filter((x) => x.comp === 0);
	return pickMin(clean.length > 0 ? clean : scored, (x) => x.cost, rnd).s;
};

/** 同じ和音の2小節目は、番号 3 と 4 を入れ替える（fb の「上の音だけずらす」）。 */
const swap34 = (idx: number): number => (idx === 3 ? 4 : idx === 4 ? 3 : idx);

// ============================================================
// 段9: 強弱
// ============================================================

const clampV = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

const arpAccent = (
	pos: number,
	accent: "normal" | "gentle",
	accents: Accents,
): number => {
	const a = accents.arp[accent];
	return pos % 8 === 0
		? a.beat
		: pos % 4 === 0
			? a.half
			: pos % 2 === 0
				? a.even
				: a.odd;
};

const bassAccent = (pos: number, accents: Accents): number =>
	pos % 8 === 0
		? accents.bass.beat
		: pos % 4 === 0
			? accents.bass.half
			: accents.bass.other;

/** 段9。絶対値の v（区間の起伏 → 拍の加減 → 1〜127 に丸める）。色の線は段8で決めた値のまま。 */
const velocityOf = (
	n: Draft,
	region: AccompRegion,
	v: AccompStyleView,
): number => {
	const i = n.bar - region.startBar;
	const level = region.arpLevel[i];
	const spec = v.levels[region.role];
	switch (n.slot) {
		case "arp":
			return clampV(
				level + arpAccent(n.pos16, region.texture.accent, v.accents),
			);
		case "bass": {
			const b = spec.bass;
			const base =
				"fixed" in b
					? b.fixed + region.levelOffset
					: level +
						(i === region.bars - 1 && b.lastBar !== undefined
							? b.lastBar
							: b.offset);
			return clampV(base + bassAccent(n.pos16, v.accents));
		}
		case "comp": {
			const c = spec.comp;
			const base =
				"fixed" in c
					? c.fixed + region.levelOffset
					: level +
						(c.to === undefined || region.bars <= 1
							? c.offset
							: Math.round(
									c.offset + ((c.to - c.offset) * i) / (region.bars - 1),
								));
			return clampV(base + (n.pos16 >= 8 ? v.accents.comp.late : 0));
		}
		default:
			return n.v;
	}
};

// ============================================================
// 本体
// ============================================================

const DEFAULT_STREAMS = (): Pick<AccompStreams, "voicing" | "color"> => ({
	voicing: seededRandom(0x61636370),
	color: seededRandom(0x636f6c72),
});

/**
 * 計画を4トラックのノートにする（§6 段4〜段9）。
 *
 * - return の頭で和声とセルが home と同じ小節（`echoBars`）は、分散を home の同じ小節から
 *   **音ごと複写**し、和音の置き方も同じにする（fb の A' 65〜74）。強弱は return の値で付け直す。
 * - 曲の最終小節は、分散と和音の置き方を home の最終小節から複写する（ループの閉じ方③）。
 * - 低音の最後は導音（頭の主音の半音下）で終える（閉じ方④）。
 * - 和音の打ち方は、計画が記録（`AccompRegion.compHits`）を持っていればそれに従い、無ければ優先順位で
 *   決める。どちらでも、使った id を {@link AccompRealized.compHits} に返す。
 *
 * 表は計画の `style`・`archetype` のスタイルから引く（無ければ既定のスタイル）。
 */
export const realizeAccomp = (input: RealizeAccompInput): AccompRealized => {
	const { plan } = input;
	const view = planStyleView(plan);
	const stepsPerBar = input.stepsPerBar ?? 192;
	if (!Number.isInteger(stepsPerBar) || stepsPerBar % 16 !== 0)
		throw new Error(`stepsPerBar は 16 の倍数（${stepsPerBar}）`);
	const edo = input.edo ?? 12;
	const streams = input.streams ?? DEFAULT_STREAMS();
	const colorLine = input.colorLine ?? true;
	const rs = plan.rootShift;
	for (const r of plan.regions) {
		if (!r.compHits) continue;
		if (r.compHits.length !== r.bars)
			throw new Error(
				`計画の compHits（${r.role}）が ${r.compHits.length} 小節（${r.bars} のはず）`,
			);
		for (const id of r.compHits)
			if (!view.compHits[id])
				throw new Error(`和音の打ち方が無い: ${id}（${r.role}）`);
	}

	const bars = buildBars(plan);
	const totalBars = bars.length;
	if (totalBars === 0) throw new Error("計画に小節が無い");
	const home = plan.regions.find((r) => r.role === "home");
	const homeStart = home?.startBar ?? 0;
	const homeLastBar = home ? home.startBar + home.bars - 1 : -1;
	const retRegion = plan.regions.find((r) => r.role === "return");
	const echo = home && retRegion ? echoBars(plan) : 0;
	const fore = new Set(foreshadowBars(plan));
	const songLastBar = totalBars - 1;
	/** return の頭の複写と曲の最終小節で、複写元になる home の小節（無ければ −1）。 */
	const copyFrom = (b: BarInfo): number => {
		if (!home) return -1;
		if (b.bar === songLastBar && b.bar !== homeLastBar) return homeLastBar;
		if (b.role === "return" && b.barInRegion < echo)
			return homeStart + b.barInRegion;
		return -1;
	};

	const notes: Record<AccompSlot, Draft[]> = {
		color: [],
		arp: [],
		bass: [],
		comp: [],
	};

	// ---- 段4・段5: 和音 ----
	const voicings: Pitch[][][] = [];
	/** 小節ごとに使った打ち方の id（区間ごと）。計画に記録する（PlanPins）。 */
	const compHitIds: string[][] = plan.regions.map(() => []);
	let prevVoicing: Pitch[] | null = null;
	for (const b of bars) {
		const src = copyFrom(b);
		const vs = b.slots.map((s, i) => {
			const copied = src >= 0 ? voicings[src]?.[i] : undefined;
			const v =
				copied ??
				chooseVoicing(
					s.chord,
					b.region.texture.compRegister,
					rs,
					prevVoicing,
					streams.voicing,
					view,
				);
			prevVoicing = v;
			return v;
		});
		voicings.push(vs);
		const hitId =
			b.region.compHits?.[b.barInRegion] ??
			compHitIdFor(b, fore, b.bar === songLastBar);
		compHitIds[b.regionIndex].push(hitId);
		const hits = compForm(view.compHits[hitId], b);
		let pos = 0;
		for (const [ci, len] of hits) {
			if (ci >= 0) {
				const k = Math.min(ci, b.slots.length - 1);
				for (const p of vs[k])
					notes.comp.push({
						slot: "comp",
						bar: b.bar,
						pos16: pos,
						len16: len,
						midi: p.midi,
						fifth: p.fifth,
						kind: p.tone?.tension ? "tension" : "chord",
						v: 0,
					});
			}
			pos += len;
		}
	}

	// ---- 段6: 低音 ----
	const bassRange = view.bassRange;
	const range: BassRange = {
		rootLow: bassRange.rootLow - rs,
		rootHigh: bassRange.rootHigh - rs,
		high: bassRange.high - rs,
		floor: bassRange.rootLow - rs - 1,
	};
	const roots: Pitch[][] = [];
	{
		let prev = (bassRange.rootLow + bassRange.rootHigh) / 2 - rs;
		for (const b of bars)
			roots.push(
				b.slots.map((s) => {
					const p = placeRoot(s.chord, prev, range);
					prev = p.midi;
					return p;
				}),
			);
	}
	const nextOf = (
		b: BarInfo,
		slotIdx: number,
	): { chord: AccompChord; root: Pitch; boundary: boolean } => {
		if (slotIdx + 1 < b.slots.length)
			return {
				chord: b.slots[slotIdx + 1].chord,
				root: roots[b.bar][slotIdx + 1],
				boundary: false,
			};
		const nb = bars[(b.bar + 1) % totalBars];
		return {
			chord: nb.slots[0].chord,
			root: roots[nb.bar][0],
			boundary: nb.regionIndex !== b.regionIndex || b.bar === songLastBar,
		};
	};
	{
		let prevMidi = roots[0][0].midi;
		for (const b of bars) {
			const form = bassForm(b, view);
			const barNotes: (Draft & { tone: BassTone })[] = [];
			let pos = 0;
			for (const [tone, len] of form) {
				if (tone === "r") {
					pos += len;
					continue;
				}
				const slotIdx = Math.min(
					tone === "R'" || tone === "5'"
						? 1
						: b.slots.length === 2 && pos >= 8
							? 1
							: 0,
					b.slots.length - 1,
				);
				const chord = b.slots[slotIdx].chord;
				const root = roots[b.bar][slotIdx];
				const nx = nextOf(b, slotIdx);
				const ctx: BassCtx = {
					chord,
					root,
					next: nx,
					boundary: nx.boundary,
					prevMidi,
					range,
				};
				let p: Pitch;
				let kind: AccompNoteKind = "chord";
				switch (tone) {
					case "R":
					case "R'":
						p = root;
						break;
					case "5":
					case "5'":
						p = fifthOf(root, chord, range, false);
						break;
					case "5v":
						p = fifthOf(root, chord, range, true);
						break;
					case "8":
						p =
							root.midi + 12 <= range.high
								? { midi: root.midi + 12, fifth: root.fifth }
								: root;
						break;
					case "P": {
						const r = passingTone(ctx);
						p = r.p;
						kind = r.kind;
						break;
					}
					case "N":
						p = neighborChordTone(ctx);
						break;
				}
				barNotes.push({
					slot: "bass",
					bar: b.bar,
					pos16: pos,
					len16: len,
					midi: p.midi,
					fifth: p.fifth,
					kind,
					v: 0,
					tone,
				});
				prevMidi = p.midi;
				pos += len;
			}
			// 区間の境の半音渡し（§6 段6）。P と N は自分で次の根音を見ているので触らない
			const last = barNotes[barNotes.length - 1];
			if (b.lastInRegion && last && last.tone !== "P" && last.tone !== "N") {
				const slotIdx = last.pos16 >= 8 ? b.slots.length - 1 : 0;
				const chord = b.slots[slotIdx].chord;
				const nx = nextOf(b, b.slots.length - 1);
				const target = nx.root.midi - 1;
				if (last.len16 <= 4) {
					if (target >= range.floor && !clashesUnder(target, chord)) {
						last.midi = target;
						last.fifth = nx.root.fifth + 5;
						last.kind = isChordTone(target, chord) ? "chord" : "approach";
					} else {
						const f = fifthOf(roots[b.bar][slotIdx], chord, range, false);
						last.midi = f.midi;
						last.fifth = f.fifth;
						last.kind = "chord";
					}
				} else if (
					mod12(last.midi) === mod12(target) &&
					target >= range.floor &&
					target <= range.high
				) {
					// 伸ばす音（glimpse の終わりの thinned など）は、同じ音のままオクターブだけ寄せる
					last.midi = target;
				}
			}
			for (const n of barNotes) {
				const { tone: _tone, ...d } = n;
				notes.bass.push(d);
			}
		}
	}

	// ---- 段7: 分散 ----
	const overlapsOf = (from: number, to: number): Overlap[] => {
		const out: Overlap[] = [];
		for (const slot of ["comp", "bass"] as const)
			for (const n of notes[slot]) {
				const s = startOf(n);
				if (Math.min(to, s + n.len16) - Math.max(from, s) >= 1)
					out.push({ midi: n.midi, slot });
			}
		return out;
	};
	const arpSets: Pitch[][][] = [];
	{
		let prevSet: Pitch[] | null = null;
		for (const b of bars) {
			const src = copyFrom(b);
			if (src >= 0 && arpSets[src]) {
				for (const n of notes.arp.filter((x) => x.bar === src))
					notes.arp.push({ ...n, bar: b.bar });
				arpSets.push(arpSets[src]);
				prevSet = arpSets[src][arpSets[src].length - 1];
				continue;
			}
			// 区間ごとに窓が違うので、前の区間の高さへ引っぱらない
			if (b.barInRegion === 0) prevSet = null;
			const cellId = b.region.texture.arpCells[Math.floor(b.barInRegion / 4)];
			const cell = view.arpCells[cellId];
			if (!cell) throw new Error(`分散のセルが無い: ${cellId}`);
			const w = b.region.texture.arpWindow;
			const win: ArpWindow = {
				lowMin: w.lowMin - rs,
				lowMax: w.lowMax - rs,
				topMin: w.topMin - rs,
				topMax: w.topMax - rs,
			};
			const steps: ArpStepAt[] = [];
			{
				let pos = 0;
				for (const [idx, len] of cell.steps) {
					steps.push({
						idx: b.second ? swap34(idx) : idx,
						pos16: pos,
						len16: len,
					});
					pos += len;
				}
			}
			const sets = b.slots.map((s, si) => {
				const mine = steps.filter(
					(st) => (b.slots.length > 1 && st.pos16 >= 8 ? 1 : 0) === si,
				);
				const set = chooseArpSet(
					s.chord,
					win,
					mine.map((st) => {
						const at = b.bar * 16 + st.pos16;
						return { idx: st.idx, over: overlapsOf(at, at + st.len16) };
					}),
					prevSet,
					streams.voicing,
					view.arpSet,
				);
				for (const st of mine) {
					const p = set[st.idx];
					notes.arp.push({
						slot: "arp",
						bar: b.bar,
						pos16: st.pos16,
						len16: st.len16,
						midi: p.midi,
						fifth: p.fifth,
						kind: p.tone?.tension ? "tension" : "chord",
						v: 0,
					});
				}
				prevSet = set;
				return set;
			});
			arpSets.push(sets);
		}
	}

	// ---- 段8: 色の線 ----
	if (colorLine)
		placeColorLine(plan, bars, notes, streams.color, view.colorLine);

	// ---- 段9: 強弱 → 正規化 ----
	for (const slot of ACCOMP_SLOTS)
		for (const n of notes[slot]) {
			const b = bars[n.bar];
			n.v = velocityOf(n, b.region, view);
		}
	const realized = {} as Record<AccompSlot, AccompRealizedNote[]>;
	for (const slot of ACCOMP_SLOTS) {
		const list = [...notes[slot]].sort(
			(a, b) => startOf(a) - startOf(b) || a.midi - b.midi,
		);
		realized[slot] = list.map((n) => {
			const b = bars[n.bar];
			return {
				slot,
				bar: n.bar,
				pos16: n.pos16,
				len16: n.len16,
				midi: n.midi + rs,
				fifth: n.fifth,
				v: n.v,
				kind: n.kind,
				regionIndex: b.regionIndex,
				role: b.role,
			};
		});
	}
	const tracks = accompTracksFromNotes(realized, {
		stepsPerBar,
		edo,
		rootShift: rs,
	});
	return {
		bars: totalBars,
		stepsPerBar,
		edo,
		colorLine,
		notes: realized,
		tracks,
		compHits: compHitIds,
	};
};

/**
 * 段9 の正規化だけを行う。音（絶対値の v）から4トラックを作る。トラックごとに
 * `splitTrackVelocity` を掛け、T を `volume` に、round(100·v/T) を velocity にする
 * （MML を読み込んだ直後と同じ形）。音高は `spelledToUnits(ハ長調の座標, 綴り) + rootShift` で
 * units に写す（31平均律でも A♭ が G# に化けない）。
 *
 * `realizeAccomp` の最後がこれを呼ぶ。検査（切除対照）が音を1つ書き換えたあと、トラックを
 * 作り直すのにも使う。`notes` の並び（開始位置 → 音高）はそのまま使う。
 */
export const accompTracksFromNotes = (
	notes: Readonly<Record<AccompSlot, readonly AccompRealizedNote[]>>,
	opts: { stepsPerBar: number; edo: 12 | 31; rootShift: number },
): [AccompTrack, AccompTrack, AccompTrack, AccompTrack] => {
	const { stepsPerBar, edo, rootShift } = opts;
	const shiftUnits = semitonesToUnits(rootShift, edo);
	const s16 = stepsPerBar / 16;
	return ACCOMP_SLOTS.map((slot, index) => {
		const list = notes[slot];
		const split = splitTrackVelocity(
			list.map((n) => n.v),
			100,
		);
		const composed: ComposedNote[] = list.map((n, i) => ({
			startStep: startOf(n) * s16,
			pitchUnits: (spelledToUnits(n.midi - rootShift, n.fifth, edo) +
				shiftUnits) as Units,
			durationSteps: n.len16 * s16,
			velocity: split.velocities[i],
		}));
		return {
			index: index as 0 | 1 | 2 | 3,
			slot,
			volume: split.volume,
			notes: composed,
		} satisfies AccompTrack;
	}) as [AccompTrack, AccompTrack, AccompTrack, AccompTrack];
};

// ============================================================
// 段8: 色の線（@0）
// ============================================================

const COLOR_LENGTHS = [...NOTE_LENGTHS_16].sort((a, b) => b - a);

/**
 * 1つの色の音を置けるか調べる。置けるなら（切った後の）長さを返す。
 * - その小節の分散の天辺より `belowTop` 半音以上下
 * - 鳴っている分散の音と短2度・短9度にならない。途中からぶつかるなら、その手前で切る
 *   （fb の50小節の F#5 と G5 の解消）。切って `minLen16`（2拍）より短くなるなら置かない
 *
 * **分散との同音は、置けない理由にも切る理由にもしない。** fb は @0 の6音すべてで、鳴っている間に
 * 分散が同じ音を弾いている（50・54小節は鳴り出しも同時）。分散が天辺を弾くことも切る理由にしない
 * （天辺より2半音以上下なので半音にはならない。fb の51小節は、2拍目に天辺の G5 が来ても E5 を3拍伸ばす）。
 */
const colorFit = (
	midi: number,
	start: number,
	len: number,
	arp: readonly Draft[],
	top: number,
	colorSpec: ColorLine,
): number | undefined => {
	if (midi > top - colorSpec.belowTop) return undefined;
	let cut = len;
	for (const n of arp) {
		const s = startOf(n);
		if (s + n.len16 <= start || s >= start + cut) continue;
		if (!isClash(midi, n.midi)) continue;
		if (s <= start) return undefined;
		cut = Math.min(cut, s - start);
	}
	return COLOR_LENGTHS.find((l) => l <= cut && l >= colorSpec.minLen16);
};

const softClashes = (
	midi: number,
	start: number,
	len: number,
	notes: Record<AccompSlot, Draft[]>,
): number => {
	let c = 0;
	for (const slot of ["comp", "bass"] as const)
		for (const n of notes[slot]) {
			const s = startOf(n);
			if (Math.min(start + len, s + n.len16) - Math.max(start, s) >= 1)
				if (isClash(midi, n.midi)) c++;
		}
	return c;
};

/**
 * 段8。borrowB の小節 {1,2,5,6} に借用和音の色の音（♭III・♭VI の長7度、i の短7度、iv の短3度か5度）を、
 * 最終小節に sus4 の4度→3度を置く。borrowB の小節は、条件を満たす高さが無ければ置かない。高さは、
 * ぶつかり（和音・低音との短2度）が少なく、長さを切らずに済み、なるべく高いもの。
 *
 * 最終小節の4度→3度（2拍ずつ）はループの閉じ方⑤なので省かない。`range` の中に置けなければ、
 * 上下へ `finalWiden` 広げて探す（関門「継ぎ目」がこれを求める）。
 */
const placeColorLine = (
	plan: AccompPlan,
	bars: readonly BarInfo[],
	notes: Record<AccompSlot, Draft[]>,
	rnd: () => number,
	colorSpec: ColorLine,
): void => {
	const rs = plan.rootShift;
	const lo = colorSpec.range.low - rs;
	const hi = colorSpec.range.high - rs;
	const arpIn = (bar: number): Draft[] =>
		notes.arp.filter((n) => n.bar === bar);
	const placed: Draft[] = [];
	type Fit = { midi: number; fifth: number; len: number; soft: number };
	const best = (fits: Fit[], want: number): Fit | undefined =>
		[...fits].sort(
			(a, b) =>
				a.soft - b.soft ||
				Number(b.len === want) - Number(a.len === want) ||
				b.midi - a.midi,
		)[0];

	const tones = colorSpec.tones as Readonly<Record<string, readonly string[]>>;
	for (const b of bars) {
		if (b.role !== "borrowB" || b.slots.length !== 1) continue;
		const k = (colorSpec.borrowBBars as readonly number[]).indexOf(
			b.barInRegion,
		);
		if (k < 0) continue;
		const chord = b.slots[0].chord;
		const degrees = [...(tones[chord.colorKey] ?? [])];
		if (degrees.length === 0) continue;
		// iv の短3度か5度は乱数で順を決め、置ける方を採る
		for (let i = degrees.length - 1; i > 0; i--) {
			const j = Math.floor(rnd() * (i + 1));
			[degrees[i], degrees[j]] = [degrees[j], degrees[i]];
		}
		const place =
			k % 2 === 0 ? colorSpec.placement.first : colorSpec.placement.second;
		const start = b.bar * 16 + place.pos16;
		const arp = arpIn(b.bar);
		if (arp.length === 0) continue;
		const top = Math.max(...arp.map((n) => n.midi));
		for (const d of degrees) {
			const tone = chord.tones.find((t) => t.degree === d && !t.tension);
			if (!tone) continue;
			const fits: Fit[] = [];
			for (const p of tonePitches(tone, lo, hi)) {
				const len = colorFit(p.midi, start, place.len16, arp, top, colorSpec);
				if (len === undefined) continue;
				fits.push({
					midi: p.midi,
					fifth: p.fifth,
					len,
					soft: softClashes(p.midi, start, len, notes),
				});
			}
			const f = best(fits, place.len16);
			if (!f) continue;
			placed.push({
				slot: "color",
				bar: b.bar,
				pos16: place.pos16,
				len16: f.len,
				midi: f.midi,
				fifth: f.fifth,
				kind: "chord",
				v: colorSpec.velocity.max,
			});
			break;
		}
	}
	if (placed.length > 0) placed[placed.length - 1].v = colorSpec.velocity.min;

	// 最終小節: sus4 の4度 → 長3度（半音下）を2拍ずつ
	const last = bars[bars.length - 1];
	if (last.slots.length === 2) {
		const [a, b] = last.slots.map((s) => s.chord);
		const fourth =
			a.third === "sus4" ? a.tones.find((t) => t.degree === "3") : undefined;
		const third =
			b.third === "major" ? b.tones.find((t) => t.degree === "3") : undefined;
		if (fourth && third && mod12(fourth.pc - third.pc) === 1) {
			const arp = arpIn(last.bar);
			const len = colorSpec.placement.final.len16;
			const at = last.bar * 16;
			// 最終小節は「天辺より下」を求めない（ハ長調なら C5→B4、fb は E5→D#5 を分散の天辺の高さで
			// 鳴らしている）。4度が C5（ハ長調の座標）に近い高さから試す。2拍ずつに満たない高さは使わない
			const noTop = Number.POSITIVE_INFINITY;
			const target = colorSpec.finalFourth;
			const w = colorSpec.finalWiden;
			let chosen: [Fit, Fit] | undefined;
			// まず range の中だけ。置けなければ広げる（広げた方は range の中の高さを含むが、どれも置けない）
			for (const [from, to] of [
				[lo, hi],
				[lo - w, hi + w],
			]) {
				for (const p of tonePitches(fourth, from, to).sort(
					(x, y) => Math.abs(x.midi - target) - Math.abs(y.midi - target),
				)) {
					const l1 = colorFit(p.midi, at, len, arp, noTop, colorSpec);
					const l2 = colorFit(p.midi - 1, at + len, len, arp, noTop, colorSpec);
					if (l1 !== len || l2 !== len) continue;
					const pair: [Fit, Fit] = [
						{
							midi: p.midi,
							fifth: fourth.fifth,
							len: l1,
							soft: softClashes(p.midi, at, l1, notes),
						},
						{
							midi: p.midi - 1,
							fifth: third.fifth,
							len: l2,
							soft: softClashes(p.midi - 1, at + len, l2, notes),
						},
					];
					if (
						!chosen ||
						pair[0].soft + pair[1].soft < chosen[0].soft + chosen[1].soft
					)
						chosen = pair;
				}
				if (chosen) break;
			}
			for (const [i, f] of (chosen ?? []).entries())
				placed.push({
					slot: "color",
					bar: last.bar,
					pos16: i * len,
					len16: f.len,
					midi: f.midi,
					fifth: f.fifth,
					kind: "chord",
					v: colorSpec.velocity.min,
				});
		}
	}
	notes.color.push(...placed);
};

// ============================================================
// 段10: 表現上の制約
// ============================================================

/**
 * 段10。MML に書けない形になっていないか（§6 段10・§7.2「表現」）。空なら壊れていない。
 * - 同じトラック内で、和音以外の音が重ならない（MMLCore は次の発音で切る）
 * - 和音（@3 の同じ位置の音）は長さと v がそろっていて、同じ高さを重ねない
 * - 音価は `NOTE_LENGTHS_16` の8種だけ（最長は全音符。タイは使えない）
 * - 分散と低音の最後の音が、曲末ちょうどで終わる（sequencer は最後の音の終わりをループ長にする）
 * - 正規化したトラックが、絶対値の v と同じ位置・長さ・高さの並びになっている
 */
export const expressionViolations = (
	r: AccompRealized,
): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const bad = (detail: string): void => {
		out.push({ gate: "expression", detail });
	};
	const lens = new Set(NOTE_LENGTHS_16);
	const end = r.bars * 16;
	for (const slot of ACCOMP_SLOTS) {
		const ns = r.notes[slot];
		for (const n of ns) {
			if (!lens.has(n.len16)) bad(`${slot} ${n.bar + 1}小節: 音価 ${n.len16}`);
			if (!Number.isInteger(n.v) || n.v < 1 || n.v > 127)
				bad(`${slot} ${n.bar + 1}小節: v ${n.v}`);
			if (n.pos16 < 0 || n.pos16 >= 16 || startOf(n) + n.len16 > end)
				bad(`${slot} ${n.bar + 1}小節: 位置 ${n.pos16}+${n.len16}`);
		}
		if (slot === "comp") {
			const groups = new Map<number, AccompRealizedNote[]>();
			for (const n of ns) {
				const g = groups.get(startOf(n));
				if (g) g.push(n);
				else groups.set(startOf(n), [n]);
			}
			let prevEnd = 0;
			for (const [s, g] of [...groups].sort((a, b) => a[0] - b[0])) {
				if (g.some((n) => n.len16 !== g[0].len16 || n.v !== g[0].v))
					bad(`comp ${g[0].bar + 1}小節: 和音の長さか v がそろわない`);
				if (new Set(g.map((n) => n.midi)).size !== g.length)
					bad(`comp ${g[0].bar + 1}小節: 和音に同じ高さ`);
				if (s < prevEnd) bad(`comp ${g[0].bar + 1}小節: 和音が重なる`);
				prevEnd = s + g[0].len16;
			}
		} else {
			for (let i = 1; i < ns.length; i++)
				if (startOf(ns[i]) < startOf(ns[i - 1]) + ns[i - 1].len16)
					bad(`${slot} ${ns[i].bar + 1}小節: 音が重なる`);
		}
		if ((slot === "arp" || slot === "bass") && ns.length > 0) {
			const last = ns[ns.length - 1];
			if (startOf(last) + last.len16 !== end)
				bad(`${slot}: 最後の音が曲末（${r.bars}小節）で終わらない`);
		}
		const t = r.tracks[ACCOMP_SLOTS.indexOf(slot)];
		const s16 = r.stepsPerBar / 16;
		if (
			t.notes.length !== ns.length ||
			t.notes.some(
				(c, i) =>
					c.startStep !== startOf(ns[i]) * s16 ||
					c.durationSteps !== ns[i].len16 * s16,
			)
		)
			bad(`${slot}: 正規化したトラックが音の並びと合わない`);
	}
	return out;
};
