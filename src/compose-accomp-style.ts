/**
 * スタイル（`src/accomp-styles/`）を、エンジン（`compose-accomp*.ts`）が引く形にする
 * （`docs/accomp-style-engine.md` §2.1・段階 S1）。
 *
 * エンジンは表の定数を import せず、ここで作る {@link AccompStyleView}（スタイルと型1つぶんの表を
 * id で引ける形に並べたもの）を読む。計画から引くときは計画の `style`・`archetype`（`PlanPins`）で
 * スタイルと型を選ぶ（{@link planStyleView}。無ければ既定のスタイルとその最初の型）。
 *
 * **段階 S1 のエンジンが前提にしていること**（{@link engineSupportProblems} が読み込み時に確かめる。
 * S3・S4a・S5 で外す）:
 * - 役割は fb の7つ（`AccompRole`）で、型の並びもその順（home で始まり return で終わる）。並び・写し・
 *   規則②〜⑤のコードが役割名を名指している（S3g まで。並びの変種は S5）
 * - 層は color・arp・bass・comp の4つをこの順（トラック @0〜@3。N 層は S5）
 * - 型・型の並び・型のミックスは1つずつ（引くのは S4a から。いまは乱数を引かずにそれを使う）
 * - 短調は平行長調を家にする（`asIs` は S5）
 * - 和声の句の表は plan の文法が名前で引く7つ（S3f まで）。和音の打ち方は realize の優先順位が
 *   id で引く5つ（S3a まで）
 *
 * 実行時の import を増やさないこと（`docs/accomp-compose.md` §4.2）。
 */

import {
	accompStyleById,
	DEFAULT_ACCOMP_STYLE,
	validateStylePack,
} from "./accomp-styles/index";
import type {
	Accents,
	Archetype,
	ArpSetParams,
	ArpStep,
	BassStep,
	ChordVoicingKind,
	CompHit,
	LayerDef,
	LevelSpec,
	Mix,
	RoleTexture,
	StylePack,
	W,
} from "./accomp-styles/schema";
import type { AccompMix, AccompPlan, AccompRole } from "./compose-accomp";

// ============================================================
// エンジンが引く形（いままでの `compose-accomp-tables.ts` の形と同じ）
// ============================================================

export type PhraseRow = {
	id: string;
	/** 4小節の句（`|` 区切り）。 */
	bars: string;
	weight: number;
	source: string;
};

export type BorrowPair = {
	id: string;
	weight: number;
	/** borrowA の和音の並び（表示用）。 */
	labelA: string;
	/** borrowB の和音の並び（表示用）。 */
	labelB: string;
	/** home 13〜16小節の予告の句。最終小節は必ず `Vsus4 V`（規則⑤）。 */
	fore: string;
	a8: string;
	a12: string;
	b8: string;
	b12: string;
	glimpseEnd: string;
	source: string;
};

export type AccompArpCell = {
	id: string;
	/** 族（表示と説明用）。規則②の「セル」の軸は id で比べる。 */
	family: string;
	/** 向き。 */
	dir: "up" | "down" | "wave";
	/** 1小節分（合計16）。 */
	steps: readonly ArpStep[];
	/** 1小節の音数（`steps` から数える）。規則①のため 8〜10 に限る。 */
	notes: number;
	/** glimpse 用の変形（上の音を1段上げたもの）の id。home で使うセルだけが持つ。 */
	liftVariant?: string;
	source: string;
};

export type BassPattern = {
	id: string;
	/** 1小節の形（合計16）。2つあるものは `alternate` の規則で交互に使う。 */
	bars: readonly (readonly BassStep[])[];
	/**
	 * 2つめの形へ移る規則。`sameChord` は同じ和音の2小節目（fb の B・C1）、`barParity` は
	 * 区間の中の小節の偶奇（fb の L）。形が1つなら使わない。
	 */
	alternate?: "sameChord" | "barParity";
	/** 半小節2和音の小節で代わりに使う型。 */
	split?: string;
	/** 区間の最終小節で代わりに使う型。 */
	last?: string;
	source: string;
};

export type CompHitPattern = {
	id: string;
	/** 1小節1和音のときの形。2つあるものは `alternate` の規則で使い分ける。 */
	one: readonly (readonly CompHit[])[];
	/** 半小節2和音のときの形。 */
	two: readonly (readonly CompHit[])[];
	/** 区間の後半で使う形（付点2分＋4分休符と、2分＋2分休符）。 */
	late?: readonly (readonly CompHit[])[];
	/** 1和音の形が2つあるときの使い分け（`CompHitsBody.alternate`）。 */
	alternate?: "sameChord" | "sameChordElseParity";
	use: string;
};

/** 色の線（いままでの `COLOR_LINE`。`range` は層の窓）。 */
export type ColorLine = {
	borrowBBars: readonly number[];
	placement: {
		first: { pos16: number; len16: number };
		second: { pos16: number; len16: number };
		final: { len16: number };
	};
	velocity: { min: number; max: number };
	range: { low: number; high: number };
	belowTop: number;
	minLen16: number;
	finalFourth: number;
	finalWiden: number;
	tones: Readonly<Record<string, readonly string[]>>;
	notesPerSong: { min: number; max: number };
};

/** 和音の窓（いままでの `COMP_VOICING`。`low`・`high` は層の窓）。 */
export type CompVoicing = {
	low: number;
	high: number;
	registerStep: number;
	preferTop: { low: number; high: number };
	topBonus: number;
	widenMax: number;
	outside: number;
};

/** 低音の音域（いままでの `BASS_RANGE`。`rootLow`・`high` は層の窓）。 */
export type BassRange = { rootLow: number; rootHigh: number; high: number };

/** 和声の句の表の名前（段階 S1 の plan の文法が名前で引く）。 */
export type PhrasePool =
	| "homeOpen"
	| "homeMid"
	| "minorOpen"
	| "minorMid"
	| "minorClimb"
	| "lift"
	| "returnEnd";

const PHRASE_POOLS: readonly PhrasePool[] = [
	"homeOpen",
	"homeMid",
	"minorOpen",
	"minorMid",
	"minorClimb",
	"lift",
	"returnEnd",
];

/** 段階 S1 のエンジンが前提にしている役割（並び・写し・規則が名指している）。 */
const ENGINE_ROLES: readonly AccompRole[] = [
	"home",
	"minorDwell",
	"borrowA",
	"glimpse",
	"borrowB",
	"lift",
	"return",
];

/** 段階 S1 のエンジンが前提にしている層（トラック @0〜@3）と生成器。 */
const ENGINE_LAYERS: readonly (readonly [string, LayerDef["generator"]])[] = [
	["color", "colorLine"],
	["arp", "arpCells"],
	["bass", "bassPattern"],
	["comp", "compHits"],
];

/** 段階 S1 の realize の優先順位（`compHitsFor`）が id で引く和音の打ち方。 */
const ENGINE_COMP_HITS: readonly string[] = [
	"short2",
	"alt13",
	"fore",
	"long",
	"final",
];

/** スタイルと型1つぶんの表（エンジンが引く形）。 */
export type AccompStyleView = {
	pack: StylePack;
	archetype: Archetype<AccompRole>;
	/** 役割の並び（型の並び。段階 S1 は1通り）。 */
	itinerary: readonly AccompRole[];
	roleLabels: Readonly<Record<AccompRole, string>>;
	regionLengths: Readonly<Record<AccompRole, W<number>>>;
	supportedLengths: Readonly<Record<AccompRole, readonly number[]>>;
	/** 参照計画の区間長（区間長の引き直しが続いたときの戻り先）。 */
	referenceLengths: Readonly<Record<AccompRole, number>>;
	seconds: { min: number; max: number };
	tempo: W<number>;
	/** 規則①の帯（分散の毎秒音数）。 */
	arpRate: Readonly<Record<AccompRole, { min: number; max: number }>>;
	/** セルの1小節の音数（規則①。検査が読む）。 */
	cellNotes: { min: number; max: number };
	levels: Readonly<Record<AccompRole, LevelSpec>>;
	offsetMax: number;
	peakMargin: number;
	echoLevelMargin: number;
	accents: Accents;
	roleTexture: Readonly<Record<AccompRole, RoleTexture>>;
	pools: Readonly<Record<PhrasePool, readonly PhraseRow[]>>;
	borrowPairs: readonly BorrowPair[];
	arpCells: Readonly<Record<string, AccompArpCell>>;
	bassPatterns: Readonly<Record<string, BassPattern>>;
	compHits: Readonly<Record<string, CompHitPattern>>;
	arpSet: ArpSetParams;
	bassRange: BassRange;
	colorLine: ColorLine;
	compVoicing: CompVoicing;
	compTones: Readonly<Record<ChordVoicingKind, readonly string[]>>;
	/** 層 id（= トラックの slot）→ DAW の枠。 */
	presetSlots: Readonly<Record<string, LayerDef["presetSlot"]>>;
	/** 型のミックス（id → 曲が持つ形）。段階 S1 は1つ。 */
	mixes: ReadonlyMap<string, AccompMix>;
	/** 型の既定のミックス（段階 S1 は唯一のミックス）。 */
	mixId: string;
	/** 参照計画の選び方。 */
	referencePicks: {
		harmony: Readonly<Record<string, readonly (string | number)[]>>;
		texture: Readonly<Record<string, readonly (string | number)[]>>;
	};
};

// ============================================================
// 検査（段階 S1 のエンジンが鳴らせるか）
// ============================================================

/**
 * スタイルを段階 S1 のエンジンで鳴らせるか（空なら鳴らせる）。スキーマの形の検査
 * （`validateStylePack`）とは別。ここに挙がる前提は、S3・S4a・S5 で1つずつ外す。
 */
export const engineSupportProblems = (pack: StylePack): string[] => {
	const out: string[] = [];
	const bad = (s: string): void => {
		out.push(`${pack.id}: ${s}（段階 S1 のエンジンの前提）`);
	};
	const layers = pack.layers.map((l) => [l.id, l.generator].join(":"));
	const want = ENGINE_LAYERS.map((l) => l.join(":"));
	if (layers.join(",") !== want.join(","))
		bad(`層が ${layers.join(",")}（${want.join(",")} のはず）`);
	for (const r of ENGINE_ROLES) if (!(r in pack.roles)) bad(`役割 ${r} が無い`);
	for (const r of Object.keys(pack.roles))
		if (!ENGINE_ROLES.includes(r as AccompRole)) bad(`知らない役割 ${r}`);
	if (pack.archetypes.length !== 1)
		bad(`型が ${pack.archetypes.length} つ（引くのは S4a から）`);
	for (const [a] of pack.archetypes) {
		if (a.form.length !== 1)
			bad(`型 ${a.id} の並びが ${a.form.length} 通り（変種は S4a から）`);
		// 順も固定（質感の写し・閉じ方・規則④の「両隣」が、home で始まり return で終わるこの並びを前提にする）
		for (const [form] of a.form)
			if (form.join(",") !== ENGINE_ROLES.join(","))
				bad(
					`型 ${a.id} の並び ${form.join(",")}（${ENGINE_ROLES.join(",")} の順に1回ずつ）`,
				);
		if (a.mix.length !== 1)
			bad(`型 ${a.id} のミックスが ${a.mix.length} つ（引くのは S4a から）`);
		if (a.lengths) bad(`型 ${a.id} の lengths（S4a から）`);
		if (a.groove) bad(`型 ${a.id} の groove（エンジンに揺れが無い）`);
	}
	if (pack.key.minorPolicy !== "parallelMajorHome")
		bad(`短調の扱い ${pack.key.minorPolicy}（asIs は S5）`);
	for (const p of PHRASE_POOLS)
		if (!(p in pack.harmony.pools)) bad(`句の表 ${p} が無い`);
	const comp = new Set(pack.patterns.comp.map((r) => r.id));
	for (const id of ENGINE_COMP_HITS)
		if (!comp.has(id)) bad(`和音の打ち方 ${id} が無い`);
	for (const r of ENGINE_ROLES) {
		const band = pack.roles[r]?.rate?.arp;
		if (!band) bad(`役割 ${r} に分散の帯（rate.arp）が無い`);
	}
	if (!pack.constraints.some((c) => c.kind === "contrast"))
		bad("規則②（contrast）の制約が無い");
	return out;
};

// ============================================================
// 組み立て
// ============================================================

const byRole = <T>(f: (role: AccompRole) => T): Record<AccompRole, T> => {
	const out = {} as Record<AccompRole, T>;
	for (const r of ENGINE_ROLES) out[r] = f(r);
	return out;
};

/**
 * ミックス（スタイルの形）を、曲が持つ形（`AccompMix`）にする。トラック番号は層の並び順。
 * 送りの残響だけは全トラック書く（書いていない層は 0）。ほかは書いてある層だけ。
 */
export const mixToAccompMix = (
	mix: Mix,
	layers: readonly LayerDef[],
): AccompMix => {
	const pick = <K extends "eqHigh" | "pan" | "delaySend">(
		k: K,
	): Partial<Record<0 | 1 | 2 | 3, number>> => {
		const out: Partial<Record<0 | 1 | 2 | 3, number>> = {};
		layers.forEach((l, i) => {
			const v = mix.layers[l.id]?.strip[k];
			if (v !== undefined) out[i as 0 | 1 | 2 | 3] = v;
		});
		return out;
	};
	const all = <T>(f: (l: LayerDef) => T): Record<0 | 1 | 2 | 3, T> => {
		const out = {} as Record<0 | 1 | 2 | 3, T>;
		layers.forEach((l, i) => {
			out[i as 0 | 1 | 2 | 3] = f(l);
		});
		return out;
	};
	return {
		instrument: mix.master.inst,
		volume: mix.master.volume,
		drum: mix.master.drum,
		loop: mix.master.loop,
		masterFx: { ...mix.master.fx },
		masterCompression: mix.master.compression,
		fadeIn: mix.master.fadeIn,
		fadeOut: mix.master.fadeOut,
		trackInstruments: all((l) => mix.layers[l.id]?.gm ?? ""),
		trackEqHigh: pick("eqHigh"),
		trackPan: pick("pan"),
		trackReverbSend: all((l) => mix.layers[l.id]?.strip.reverbSend ?? 0),
		trackDelaySend: pick("delaySend"),
	};
};

const layerOf = <G extends LayerDef["generator"]>(
	pack: StylePack,
	generator: G,
): Extract<LayerDef, { generator: G }> => {
	const l = pack.layers.find((x) => x.generator === generator);
	if (!l) throw new Error(`${pack.id}: 生成器 ${generator} の層が無い`);
	return l as Extract<LayerDef, { generator: G }>;
};

const buildView = (
	pack: StylePack,
	archetype: Archetype<AccompRole>,
): AccompStyleView => {
	const roles = pack.roles as Readonly<
		Record<AccompRole, StylePack["roles"][string]>
	>;
	const pools = {} as Record<PhrasePool, readonly PhraseRow[]>;
	for (const p of PHRASE_POOLS)
		pools[p] = pack.harmony.pools[p].map((r) => ({
			id: r.id,
			bars: r.body.bars,
			weight: r.weight,
			source: r.note ?? "",
		}));
	const color = layerOf(pack, "colorLine");
	const arp = layerOf(pack, "arpCells");
	const bassLayer = layerOf(pack, "bassPattern");
	const comp = layerOf(pack, "compHits");
	const contrast = pack.constraints.find((c) => c.kind === "contrast");
	const rateBand = pack.constraints.find((c) => c.kind === "rateBand");
	const mixes = new Map(
		archetype.mix.map(([m]) => [m.id, mixToAccompMix(m, pack.layers)]),
	);
	return {
		pack,
		archetype,
		itinerary: archetype.form[0][0],
		roleLabels: byRole((r) => roles[r].label),
		regionLengths: byRole((r) => roles[r].lengths),
		supportedLengths: byRole((r) => roles[r].supportedLengths),
		referenceLengths: archetype.reference.lengths,
		seconds: archetype.seconds,
		tempo: archetype.tempo,
		arpRate: byRole((r) => {
			const [min, max] = roles[r].rate?.arp ?? [0, Number.POSITIVE_INFINITY];
			return { min, max };
		}),
		cellNotes:
			rateBand?.kind === "rateBand"
				? rateBand.cellNotes
				: { min: 0, max: Number.POSITIVE_INFINITY },
		levels: archetype.arc.levels,
		offsetMax: archetype.arc.offsetMax,
		peakMargin: archetype.arc.order.margin,
		echoLevelMargin: contrast?.kind === "contrast" ? contrast.levelMargin : 0,
		accents: archetype.arc.accents,
		roleTexture: archetype.texture,
		pools,
		borrowPairs: pack.harmony.borrowSets.map((r) => ({
			id: r.id,
			weight: r.weight,
			...r.body,
			source: r.note ?? "",
		})),
		arpCells: Object.fromEntries(
			pack.patterns.arp.map((r) => [
				r.id,
				{
					id: r.id,
					family: r.body.family,
					dir: r.body.dir,
					steps: r.body.steps,
					notes: r.body.notes,
					...(r.body.liftVariant ? { liftVariant: r.body.liftVariant } : {}),
					source: r.note ?? "",
				},
			]),
		),
		bassPatterns: Object.fromEntries(
			pack.patterns.bass.map((r) => [
				r.id,
				{ id: r.id, ...r.body, source: r.note ?? "" },
			]),
		),
		compHits: Object.fromEntries(
			pack.patterns.comp.map((r) => [
				r.id,
				{ id: r.id, ...r.body, use: r.note ?? "" },
			]),
		),
		arpSet: arp.params,
		bassRange: {
			rootLow: bassLayer.window.lo,
			rootHigh: bassLayer.params.rootHigh,
			high: bassLayer.window.hi,
		},
		colorLine: {
			borrowBBars: color.params.borrowBBars,
			placement: color.params.placement,
			velocity: color.params.velocity,
			range: { low: color.window.lo, high: color.window.hi },
			belowTop: color.params.belowTop,
			minLen16: color.params.minLen16,
			finalFourth: color.params.finalFourth,
			finalWiden: color.params.finalWiden,
			tones: color.params.tones,
			notesPerSong: color.params.notesPerSong,
		},
		compVoicing: {
			low: comp.window.lo,
			high: comp.window.hi,
			registerStep: comp.params.registerStep,
			preferTop: comp.params.preferTop,
			topBonus: comp.params.topBonus,
			widenMax: comp.params.widenMax,
			outside: comp.params.outside,
		},
		compTones: comp.params.tones,
		presetSlots: Object.fromEntries(
			pack.layers.map((l) => [l.id, l.presetSlot]),
		),
		mixes,
		mixId: archetype.mix[0][0].id,
		referencePicks: {
			harmony: archetype.reference.harmonyPicks,
			texture: archetype.reference.texturePicks,
		},
	};
};

const views = new WeakMap<StylePack, Map<string, AccompStyleView>>();

/**
 * スタイル id（省くと既定のスタイル）と型 id（省くとスタイルの最初の型）から表を引く。初めて引くときに
 * スキーマとエンジンの前提を確かめ、だめなら例外にする。結果は使い回す（**書き換えないこと**）。
 */
export const accompStyleView = (
	style?: string | StylePack,
	archetypeId?: string,
): AccompStyleView => {
	const pack =
		style === undefined
			? DEFAULT_ACCOMP_STYLE
			: typeof style === "string"
				? accompStyleById(style)
				: style;
	if (!pack) throw new Error(`伴奏主体: 知らないスタイル "${style}"`);
	let byArchetype = views.get(pack);
	if (!byArchetype) {
		const problems = [
			...validateStylePack(pack),
			...engineSupportProblems(pack),
		];
		if (problems.length > 0)
			throw new Error(
				`伴奏主体: スタイル ${pack.id} を読めない\n  ${problems.join("\n  ")}`,
			);
		byArchetype = new Map();
		views.set(pack, byArchetype);
	}
	const aId = archetypeId ?? pack.archetypes[0][0].id;
	const cached = byArchetype.get(aId);
	if (cached) return cached;
	const archetype = pack.archetypes.find(([a]) => a.id === aId)?.[0] as
		| Archetype<AccompRole>
		| undefined;
	if (!archetype)
		throw new Error(`伴奏主体: スタイル ${pack.id} に型 "${aId}" が無い`);
	const view = buildView(pack, archetype);
	byArchetype.set(aId, view);
	return view;
};

/** 計画の `style`・`archetype`（`PlanPins`）から表を引く。無ければ既定のスタイルとその最初の型。 */
export const planStyleView = (
	plan: Pick<AccompPlan, "style" | "archetype">,
): AccompStyleView => accompStyleView(plan.style, plan.archetype);

/** 計画の `mix`（無ければ型の既定）のミックス。知らない id は例外。 */
export const planMix = (
	view: AccompStyleView,
	mixId: string | undefined,
): AccompMix => {
	const id = mixId ?? view.mixId;
	const m = view.mixes.get(id);
	if (!m)
		throw new Error(
			`伴奏主体: スタイル ${view.pack.id} の型 ${view.archetype.id} にミックス "${id}" が無い`,
		);
	return m;
};
