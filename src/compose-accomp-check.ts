/**
 * 伴奏主体モードの関門（硬い制約）と、表示用の指標（`docs/accomp-compose.md` §7）。
 * 生成器（`composeAccomp` の候補のループ）と scripts（検算・試聴）の両方から使う。純関数だけを置く。
 *
 * - {@link accompGates} … §7.2 の関門を全部調べる。空なら候補は壊れていない。計画の段で分かるもの
 *   （`planViolations`）に、音を置いた後で分かるもの（和声との整合・ぶつかり・継ぎ目・表現・
 *   規則①④の実測）を足す
 * - {@link accompRegionMetrics}・{@link accompStats} … §7.3 の指標（区間ごとの分散の毎秒音数・
 *   往復率・上半分の平均・v 平均など）
 *
 * **関門は「壊れていないか」の確認で、「良いか」の判定ではない。** 指標は表示・検算・将来の較正にだけ
 * 使い、採点や候補の選抜には使わない（§7.1。handover の「内蔵採点は品質と無相関」）。
 *
 * 実行時に import してよいものは §4.2 のとおり（`mml-parser`・`lyrics`・`daw` は読まない）。
 */

import type {
	AccompGate,
	AccompPlan,
	AccompRole,
	AccompStats,
} from "./compose-accomp";
import {
	type AccompPlanViolation,
	planBars,
	planSeconds,
	planViolations,
} from "./compose-accomp-plan";
import {
	ACCOMP_SLOTS,
	type AccompRealized,
	type AccompRealizedNote,
	expressionViolations,
	isClash,
} from "./compose-accomp-realize";
import { planStyleView } from "./compose-accomp-style";
import { effectiveVelocity } from "./mml-velocity";

/**
 * 関門「ぶつかり」（§7.2）: 全トラックの組で、別トラックの音が半音（短2度・短9度）で重なる数の
 * 1小節あたりの上限（fb 0.24、fa 0.20）。分散と和音トラック、色の線と分散は別に0を求める。
 * 衛生の制約（エンジンが全スタイルに掛ける。`docs/accomp-style-engine.md` §2.1）なので、エンジンの定数。
 */
export const CLASH_PER_BAR_MAX = 0.35;

/** 関門の並び（§7.2 の表の順）。{@link accompGates} はこの順に並べて返す。 */
export const ACCOMP_GATE_ORDER: readonly AccompGate[] = [
	"length",
	"itinerary",
	"rule1",
	"rule2",
	"rule3",
	"rule4",
	"rule5",
	"harmony",
	"clash",
	"seam",
	"expression",
];

const startOf = (n: { bar: number; pos16: number }): number =>
	n.bar * 16 + n.pos16;
const mod12 = (n: number): number => ((n % 12) + 12) % 12;
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]): number =>
	xs.length === 0 ? 0 : sum(xs) / xs.length;

// ============================================================
// 指標（§7.3。表示・検算・陽性対照だけに使う）
// ============================================================

export type AccompRegionMetrics = {
	role: AccompRole;
	/** M1 分散の毎秒音数。 */
	arpPerSec: number;
	/** M9 分散の上半分（音高の中央値より上）の平均（実際に鳴る MIDI）。 */
	upperMean: number;
	/** M5 低音の音数/小節。 */
	bassPerBar: number;
	/** M2 往復率。p[i] = p[i−2] ≠ p[i−1] の割合。 */
	roundTrip: number;
	/** M10 分散の v（絶対値）の平均。 */
	vMean: number;
	/** 和音を打つ回数/小節（同じ位置の構成音は1回）。 */
	compHitsPerBar: number;
};

/** 区間ごとの指標（§7.3 の M1・M2・M5・M9・M10 と、和音の打つ回数）。 */
export const accompRegionMetrics = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompRegionMetrics[] =>
	plan.regions.map((reg, ri) => {
		const arp = r.notes.arp.filter((n) => n.regionIndex === ri);
		const ps = arp.map((n) => n.midi);
		let rt = 0;
		for (let i = 2; i < ps.length; i++)
			if (ps[i] === ps[i - 2] && ps[i] !== ps[i - 1]) rt++;
		const sorted = [...ps].sort((a, b) => a - b);
		return {
			role: reg.role,
			arpPerSec: arp.length / ((reg.bars * 240) / plan.bpm),
			upperMean: mean(sorted.slice(Math.floor(sorted.length / 2))),
			bassPerBar:
				r.notes.bass.filter((n) => n.regionIndex === ri).length / reg.bars,
			roundTrip: ps.length > 2 ? rt / (ps.length - 2) : 0,
			vMean: mean(arp.map((n) => n.v)),
			compHitsPerBar:
				new Set(r.notes.comp.filter((n) => n.regionIndex === ri).map(startOf))
					.size / reg.bars,
		};
	});

/**
 * 別トラックの音が16分1つ以上重なって短2度・短9度（半音差。オクターブ違いを含み、長7度は
 * 含まない）になる組の数（M13。`tmp/full/clash-all.ts` と同じ判定）。キーはトラックの組を
 * 名前順に `-` でつないだもの（例 `arp-comp`）。
 */
export const accompClashPairs = (r: AccompRealized): Record<string, number> => {
	const all = ACCOMP_SLOTS.flatMap((slot) => r.notes[slot])
		.map((n) => ({ n, s: startOf(n), e: startOf(n) + n.len16 }))
		.sort((a, b) => a.s - b.s);
	const out: Record<string, number> = {};
	for (let i = 0; i < all.length; i++) {
		const a = all[i];
		// 開始順に並べてあるので、a が鳴り終わる前に始まる音だけを見ればよい
		for (let j = i + 1; j < all.length && all[j].s < a.e; j++) {
			const b = all[j];
			if (a.n.slot === b.n.slot) continue;
			if (Math.min(a.e, b.e) - Math.max(a.s, b.s) < 1) continue;
			if (!isClash(a.n.midi, b.n.midi)) continue;
			const k = [a.n.slot, b.n.slot].sort().join("-");
			out[k] = (out[k] ?? 0) + 1;
		}
	}
	return out;
};

/**
 * 表示と自己検査のための指標（§5 `AccompStats`）。**採点・選抜には使わない。**
 * `compVoicingMatchesFb` は陽性対照のときに検査の側が数える（fb の辞書は scripts にある）。
 */
export const accompStats = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompStats => {
	const ms = accompRegionMetrics(plan, r);
	const bars = planBars(plan);

	// 和音の長さ（16分）の平均。借用和音だけ長く伸ばす規則（§6 段5）が効いているかを見る
	const compGroups = new Map<number, AccompRealizedNote>();
	for (const n of r.notes.comp)
		if (!compGroups.has(startOf(n))) compGroups.set(startOf(n), n);
	const borrowedLens: number[] = [];
	const diatonicLens: number[] = [];
	for (const n of compGroups.values()) {
		const cs = bars[n.bar]?.chords ?? [];
		const c = cs.length > 1 && n.pos16 >= 8 ? cs[1] : cs[0];
		if (c?.borrowed) borrowedLens.push(n.len16);
		else diatonicLens.push(n.len16);
	}

	// 分散の隣り合う音の音程（半音の絶対値）: 0〜2 step、3〜4 3rd、5〜6 4th、7〜11 5th、12〜 8ve+
	const hist = { step: 0, "3rd": 0, "4th": 0, "5th": 0, "8ve+": 0 };
	const arp = r.notes.arp;
	for (let i = 1; i < arp.length; i++) {
		const d = Math.abs(arp[i].midi - arp[i - 1].midi);
		if (d <= 2) hist.step++;
		else if (d <= 4) hist["3rd"]++;
		else if (d <= 6) hist["4th"]++;
		else if (d <= 11) hist["5th"]++;
		else hist["8ve+"]++;
	}
	const intervals = Math.max(1, arp.length - 1);
	const round3 = (x: number): number => Math.round(x * 1000) / 1000;

	return {
		seconds: planSeconds(plan),
		arpNotesPerSec: ms.map((m) => round3(m.arpPerSec)),
		arpUpperMean: ms.map((m) => round3(m.upperMean)),
		arpVMean: ms.map((m) => round3(m.vMean)),
		bassNotesPerBar: ms.map((m) => round3(m.bassPerBar)),
		compMeanLen: {
			borrowed: round3(mean(borrowedLens)),
			diatonic: round3(mean(diatonicLens)),
		},
		arpIntervalHist: {
			step: round3(hist.step / intervals),
			"3rd": round3(hist["3rd"] / intervals),
			"4th": round3(hist["4th"] / intervals),
			"5th": round3(hist["5th"] / intervals),
			"8ve+": round3(hist["8ve+"] / intervals),
		},
		clashesPerBar: round3(sum(Object.values(accompClashPairs(r))) / r.bars),
		vKinds: ACCOMP_SLOTS.map(
			(slot) => new Set(r.notes[slot].map((n) => n.v)).size,
		) as [number, number, number, number],
	};
};

// ============================================================
// 関門（§7.2。音を置いた後で分かるもの）
// ============================================================

/**
 * 和声との整合（§7.2）。
 * - 分散・和音・色の線・低音の構成音: 鳴っている和音（半小節2和音の境をまたぐなら両方）の構成音か
 *   書かれたテンションで、綴り（五度圏の位置）も和音の音と同じ
 * - 低音の和音外音（経過音 P・半音渡し）: 低音だけ。小節の最後の音で、強拍（1・3拍）でなく、4分以下
 */
export const harmonyViolations = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompPlanViolation[] => {
	const bars = planBars(plan);
	const out: AccompPlanViolation[] = [];
	const bad = (detail: string): void => {
		out.push({ gate: "harmony", detail });
	};
	for (const slot of ACCOMP_SLOTS)
		for (const n of r.notes[slot]) {
			const cs = bars[n.bar]?.chords;
			const where = `${slot} ${n.bar + 1}小節 ${n.pos16}`;
			if (!cs) {
				bad(`${where}: 小節が計画に無い`);
				continue;
			}
			const chords =
				cs.length > 1
					? n.pos16 >= 8
						? [cs[1]]
						: n.pos16 + n.len16 > 8
							? cs
							: [cs[0]]
					: cs;
			const pc = mod12(n.midi - plan.rootShift);
			if (n.kind === "passing" || n.kind === "approach") {
				if (slot !== "bass") bad(`${where}: 低音以外に和音外音`);
				if (n.pos16 % 8 === 0 || n.len16 > 4 || n.pos16 + n.len16 !== 16)
					bad(`${where}: 和音外音が強拍・長い音・小節の途中`);
				if (chords.every((c) => c.tones.some((t) => t.pc === pc)))
					bad(`${where}: 構成音なのに ${n.kind}`);
				continue;
			}
			for (const c of chords) {
				const tone = c.tones.find((t) => t.pc === pc);
				if (!tone) bad(`${where}: ${n.midi} が ${c.roman} の外`);
				else if (tone.fifth !== n.fifth)
					bad(`${where}: ${c.roman} の音の綴りが違う`);
			}
		}
	return out;
};

/**
 * ぶつかり（§7.2）。分散と和音トラック・色の線と分散の短2度／短9度が0、全トラックの組で
 * {@link CLASH_PER_BAR_MAX}/小節以下。
 */
export const clashViolations = (r: AccompRealized): AccompPlanViolation[] => {
	const c = accompClashPairs(r);
	const out: AccompPlanViolation[] = [];
	if ((c["arp-comp"] ?? 0) > 0)
		out.push({ gate: "clash", detail: `分散と和音 ${c["arp-comp"]}` });
	if ((c["arp-color"] ?? 0) > 0)
		out.push({ gate: "clash", detail: `色の線と分散 ${c["arp-color"]}` });
	const perBar = sum(Object.values(c)) / Math.max(1, r.bars);
	if (perBar > CLASH_PER_BAR_MAX)
		out.push({ gate: "clash", detail: `全体 ${perBar.toFixed(2)}/小節` });
	return out;
};

/**
 * 継ぎ目（ループの閉じ方。§2.3 の5点のうち音の側、§7.2）。和声（最終小節が Vsus4→V・home の
 * 最終小節と同じ）は計画の段（`planViolations`）が見る。
 * - 分散の最終小節が home の最終小節と同じ音
 * - 低音が曲頭で鳴り、最後の音が頭の音への導音（半音下、綴りは導音）
 * - 和音の最後の一打が付点4分
 * - 色の線（`r.colorLine`）が on なら、最終小節に sus4 の4度→3度が2拍ずつ（閉じ方⑤。省けない）。
 *   off なら最終小節に @0 が無いこと
 */
export const seamViolations = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const bad = (detail: string): void => {
		out.push({ gate: "seam", detail });
	};
	const home = plan.regions.find((x) => x.role === "home");
	if (!home) {
		bad("home が無い");
		return out;
	}
	const lastBar = r.bars - 1;
	const homeLast = home.startBar + home.bars - 1;
	const shape = (bar: number): string =>
		r.notes.arp
			.filter((n) => n.bar === bar)
			.map((n) => `${n.pos16}:${n.len16}:${n.midi}:${n.fifth}`)
			.join(" ");
	if (shape(lastBar) !== shape(homeLast))
		bad("分散の最終小節が home の最終小節と違う");
	const bass = r.notes.bass;
	const first = bass[0];
	const last = bass[bass.length - 1];
	if (!first || first.bar !== 0 || first.pos16 !== 0)
		bad("低音が曲頭で鳴らない");
	else if (last.midi !== first.midi - 1 || last.fifth !== first.fifth + 5)
		bad(`低音の最後が頭の音への導音でない（${last.midi}/${first.midi}）`);
	const comp = r.notes.comp;
	const lastComp = comp[comp.length - 1];
	if (!lastComp || lastComp.bar !== lastBar || lastComp.len16 !== 6)
		bad("和音の最後の一打が付点4分でない");
	const color = r.notes.color.filter((n) => n.bar === lastBar);
	if (r.colorLine) {
		if (color.length === 0) bad("色の線が on なのに、最終小節に @0 が無い");
		else if (
			color.length !== 2 ||
			color[0].pos16 !== 0 ||
			color[0].len16 !== 8 ||
			color[1].pos16 !== 8 ||
			color[1].len16 !== 8 ||
			color[1].midi !== color[0].midi - 1
		)
			bad(
				`色の線の最後が sus4 の4度→3度（2拍ずつ）でない（${color.map((n) => `${n.pos16}+${n.len16}:${n.midi}`).join(" ")}）`,
			);
	} else if (color.length > 0) bad("色の線が off なのに、最終小節に @0 がある");
	return out;
};

/**
 * 正規化（§6 段9。関門「表現」の一部）: トラック音量 T = min(100, 最大の v)、実効値
 * round(T·velocity/100) が絶対値の v に戻る、velocity の最大は 100（最大の v が100を超える
 * トラックは v のまま）。
 */
export const normalizationViolations = (
	r: AccompRealized,
): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const bad = (detail: string): void => {
		out.push({ gate: "expression", detail: `正規化: ${detail}` });
	};
	r.tracks.forEach((t, i) => {
		const ns = r.notes[ACCOMP_SLOTS[i]];
		if (t.index !== i || t.slot !== ACCOMP_SLOTS[i])
			bad(`track ${i}: index/slot`);
		if (t.notes.length !== ns.length) {
			bad(`track ${i}: 音の数が合わない`);
			return;
		}
		if (ns.length === 0) return;
		const maxV = Math.max(...ns.map((n) => n.v));
		if (t.volume !== Math.min(100, maxV))
			bad(`track ${i}: volume ${t.volume}（最大の v ${maxV}）`);
		if (
			t.notes.some(
				(c, k) => effectiveVelocity(t.volume, c.velocity) !== ns[k].v,
			)
		)
			bad(`track ${i}: 実効値が v に戻らない`);
		const maxVel = Math.max(...t.notes.map((c) => c.velocity));
		if (maxVel !== (maxV <= 100 ? 100 : maxV))
			bad(`track ${i}: velocity の最大 ${maxVel}`);
	});
	return out;
};

/**
 * 規則①④を、音を置いた後の実測で確かめる（計画の段はセルの音数と基準 v で確かめている）。
 * - ① 区間ごとの分散の毎秒音数が、スタイルの役割ごとの帯（`rate.arp`。fb は lift だけ下限が低い）の中
 * - ④ 区間ごとの分散の v 平均で、山は borrowB だけ（2番手と、型の `arc.order.margin` 以上の差）・lift が最弱・
 *   return < home・glimpse < 両隣（borrowA と borrowB）
 */
export const realizedRuleViolations = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompPlanViolation[] => {
	const out: AccompPlanViolation[] = [];
	const view = planStyleView(plan);
	const ms = accompRegionMetrics(plan, r);
	for (const m of ms) {
		const range = view.arpRate[m.role];
		if (range && (m.arpPerSec < range.min || m.arpPerSec > range.max))
			out.push({
				gate: "rule1",
				detail: `${m.role} の分散が毎秒 ${m.arpPerSec.toFixed(2)} 音（実測）`,
			});
	}
	const v = (role: AccompRole): number =>
		ms.find((m) => m.role === role)?.vMean ?? Number.NaN;
	const others = (role: AccompRole): number[] =>
		ms.filter((m) => m.role !== role).map((m) => m.vMean);
	const rule4 = (detail: string): void => {
		out.push({ gate: "rule4", detail: `${detail}（分散の v 平均）` });
	};
	if (!(v("borrowB") - Math.max(...others("borrowB")) >= view.peakMargin))
		rule4(`山が borrowB だけでない（borrowB ${v("borrowB").toFixed(1)}）`);
	if (!(v("lift") < Math.min(...others("lift"))))
		rule4(`lift が最弱でない（${v("lift").toFixed(1)}）`);
	if (!(v("return") < v("home")))
		rule4(
			`return が home より静かでない（${v("return").toFixed(1)} / ${v("home").toFixed(1)}）`,
		);
	if (!(v("glimpse") < v("borrowA") && v("glimpse") < v("borrowB")))
		rule4(`glimpse が両隣より凹んでいない（${v("glimpse").toFixed(1)}）`);
	return out;
};

/**
 * §7.2 の関門を全部調べる。空なら候補は壊れていない（**良いかどうかは見ない**）。
 * {@link ACCOMP_GATE_ORDER} の順に並べて返すので、`[0].gate` が落ちた理由の代表になる
 * （`AccompSong.draws.rejected` はこれを数える）。
 */
export const accompGates = (
	plan: AccompPlan,
	r: AccompRealized,
): AccompPlanViolation[] => {
	const all = [
		...planViolations(plan),
		...expressionViolations(r),
		...normalizationViolations(r),
		...harmonyViolations(plan, r),
		...clashViolations(r),
		...seamViolations(plan, r),
		...realizedRuleViolations(plan, r),
	];
	const rank = (g: AccompGate): number => {
		const i = ACCOMP_GATE_ORDER.indexOf(g);
		return i < 0 ? ACCOMP_GATE_ORDER.length : i;
	};
	return all
		.map((v, i) => ({ v, i }))
		.sort((a, b) => rank(a.v.gate) - rank(b.v.gate) || a.i - b.i)
		.map((x) => x.v);
};
