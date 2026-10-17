/**
 * 手直しした曲（MML）を渡す前の点検。手順は docs/compose-harness.md。
 *
 *   npx tsx scripts/compose/audit-arrangement.ts <song.mml> --profile 2go --key Gm \
 *     --sections intro:8,A:16,B:16,break:8,A:8,B:16,outro:8 [--lead 0] [--double 13] [--json out.json]
 *
 * 合否（関門）は流派の規則（docs/kaiwai-lineages.md・game-bgm-toby-fox.md）の帯とぶつかりだけ。
 * 閾値は「生成器の素の出力（流派の規則で作った曲）を落とさない」ことで確かめる（compose-harness.md §3）。
 * 2曲比較から出た項目（和声の素材・Aとサビの対比など）は所有者の評価で確かめるまで「仮説」として出すだけ。
 * 部の名前は A で始まればAメロ、B で始まればサビ。
 */

import { readFileSync, writeFileSync } from "node:fs";
import Module from "node:module";

// mml-parser は lyrics → @onjmin/koe（ブラウザ専用）を読むので空のスタブを入れてから読む
const loader = Module as unknown as {
	_load: (request: string, ...rest: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = (request: string, ...rest: unknown[]) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: originalLoad(request, ...rest);
const { parseMML } =
	require("../../src/mml/mml-parser") as typeof import("../../src/mml/mml-parser");

type Band = [number, number];
type Profile = {
	label: string;
	/** 帯の根拠にした原曲の数。少ない流派の帯で落ちたら、曲より先に帯を疑う */
	refs: string;
	bpm?: Band;
	/** リードの 16分以下の音価の割合 */
	sixteenth?: Band;
	/** リードの占有率（鳴っている長さ ÷ 曲の長さ） */
	occupancy?: Band;
	/** リードの音域（半音） */
	range?: Band;
	/** 終わり方の型（仮説として出すだけ）。cadence: Ⅴ→ⅰ / loop: 主音で終わるか先頭へ戻れる */
	ending: "loop" | "cadence";
	/** 最初のリード音がこの小節までに出る（仮説） */
	leadBy: number;
	/** ぶつかりの割合の上限（生成器の素の出力の p90）と目安（p50） */
	clash: { fail: number; typical: number };
};
// 帯の出どころは各文書の原曲の値。ぶつかりは 2026-10-17 に各テンプレート seed 1〜20 の素の出力で測った p90 と p50。
// 終わり方は関門にしない。2号・海鮮・Speder2 の原曲はブロックの切れ目で終わる曲が多く、
// ゲームBGM のループ判定も素の出力の 3 割を落とした。
const PROFILES: Record<string, Profile> = {
	"2go": {
		label: "2号兄貴（楽器）",
		refs: "原曲 8 曲",
		bpm: [140, 180],
		sixteenth: [0.3, 1],
		occupancy: [0.7, 1],
		range: [14, 40],
		ending: "cadence",
		leadBy: 17,
		clash: { fail: 0.18, typical: 0.1 },
	},
	speder2: {
		label: "Speder2（楽器）",
		refs: "原曲 4 曲（帯は薄い）",
		bpm: [100, 132],
		occupancy: [0.25, 0.9],
		range: [12, 40],
		ending: "cadence",
		leadBy: 17,
		clash: { fail: 0.2, typical: 0.07 },
	},
	kaisen: {
		label: "海鮮（歌）",
		refs: "原曲 5 曲（完成 3＋断片 2）",
		sixteenth: [0, 0.25],
		range: [10, 24],
		ending: "cadence",
		leadBy: 9,
		clash: { fail: 0.08, typical: 0.06 },
	},
	game: {
		label: "ゲームBGM・Toby Fox風",
		refs: "Toby Fox の戦闘曲 13 曲",
		bpm: [112, 170],
		sixteenth: [0.3, 1],
		range: [18, 48],
		ending: "loop",
		leadBy: 9,
		clash: { fail: 0.22, typical: 0.15 },
	},
	none: {
		label: "流派なし",
		refs: "帯なし",
		ending: "cadence",
		leadBy: 9,
		clash: { fail: 1, typical: 1 },
	},
};

const BAR = 192;
const S16 = 12;
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const file = argv.find(
	(a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);
const keyArg = arg("key");
const sectionsArg = arg("sections");
const profileName = arg("profile");
if (!file || !keyArg || !sectionsArg || !profileName)
	throw new Error(
		"使い方: <song.mml> --profile 2go|speder2|kaisen|game|none --key C#m --sections intro:16,A:16,...",
	);
const P = PROFILES[profileName];
if (!P) throw new Error(`--profile は ${Object.keys(PROFILES).join(" / ")}`);
const LEAD = Number(arg("lead") ?? "0");
const DOUBLES = new Set(
	(arg("double") ?? "13").split(",").filter(Boolean).map(Number),
);
const jsonOut = arg("json");

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PC: Record<string, number> = {
	C: 0,
	"C#": 1,
	Db: 1,
	D: 2,
	"D#": 3,
	Eb: 3,
	E: 4,
	F: 5,
	"F#": 6,
	Gb: 6,
	G: 7,
	"G#": 8,
	Ab: 8,
	A: 9,
	"A#": 10,
	Bb: 10,
	B: 11,
};
const km = /^([A-G][#b]?)(m?)$/.exec(keyArg);
if (!km) throw new Error(`--key は C#m / Eb のように: ${keyArg}`);
const TONIC = PC[km[1]];

const txt = readFileSync(file, "utf8");
const p = parseMML(txt, { stepsPerBar: BAR });
const semi = (u: number) => Math.round(u / 31);
const pcOf = (s: number) => ((s % 12) + 12) % 12;
const inst = Object.fromEntries(
	[...txt.matchAll(/#t(\d+)inst=([^#;]+)/g)].map((m) => [
		Number(m[1]),
		m[2].trim(),
	]),
);
const lead = p.placements
	.filter((n) => n.trackIndex === LEAD)
	.sort((a, b) => a.startStep - b.startStep);
const acc = p.placements.filter(
	(n) => n.trackIndex !== LEAD && !DOUBLES.has(n.trackIndex),
);
const totalBars = Math.ceil(
	Math.max(...p.placements.map((n) => n.startStep + n.durationSteps)) / BAR,
);
const sections = sectionsArg.split(",").map((s) => {
	const [name, bars] = s.split(":");
	return { name, bars: Number(bars) };
});
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const inBand = (x: number, b?: Band) => (b ? x >= b[0] && x <= b[1] : null);
const bandText = (b?: Band, f = (x: number) => String(x)) =>
	b ? `${f(b[0])}〜${f(b[1])}` : "規則なし";
const gates: { name: string; ok: boolean | null; detail: string }[] = [];
const hypotheses: { name: string; ok: boolean | null; detail: string }[] = [];
const cautions: string[] = [];
const metrics: Record<string, number | string | null> = {};

const sectionBars = sections.reduce((a, s) => a + s.bars, 0);
if (sectionBars !== totalBars)
	cautions.push(
		`--sections の合計 ${sectionBars} 小節と曲の長さ ${totalBars} 小節が違う`,
	);
const sounding = (from: number, to: number) =>
	acc.filter((x) => x.startStep < to && x.startStep + x.durationSteps > from);

// ============ 関門 ============

// ---- 流派の規則の帯 ----
const bpm = p.bpm ?? Number(/\bt(\d+)/.exec(txt)?.[1] ?? Number.NaN);
const leadDur = lead.reduce((a, n) => a + n.durationSteps, 0);
const s16 = lead.length
	? lead.filter((n) => n.durationSteps <= S16).length / lead.length
	: 0;
const occ = leadDur / (totalBars * BAR);
const ps = lead.map((n) => semi(n.pitchUnits));
const range = ps.length ? Math.max(...ps) - Math.min(...ps) : 0;
Object.assign(metrics, { bpm, sixteenth: s16, occupancy: occ, range });
gates.push({
	name: "テンポ",
	ok: inBand(bpm, P.bpm),
	detail: `${bpm}（${bandText(P.bpm)}、${P.refs}）`,
});
gates.push({
	name: "リードの16分",
	ok: inBand(s16, P.sixteenth),
	detail: `${pct(s16)}（${bandText(P.sixteenth, pct)}、${P.refs}）`,
});
gates.push({
	name: "リードの占有率",
	ok: inBand(occ, P.occupancy),
	detail: `${pct(occ)}（${bandText(P.occupancy, pct)}、${P.refs}）`,
});
gates.push({
	name: "リードの音域",
	ok: inBand(range, P.range),
	detail: `${range} 半音（${bandText(P.range)}、${P.refs}）`,
});

// ---- ぶつかり ----
// 数えるもの: 拍頭の8分以上のリード音と最低音の短2度・三全音／鳴っている伴奏の音の半音上（短9度）。
// 除くもの: 最低音と同じ音名のリード（maj7 の上の根音）／属7（根・長3度・短7度）の上の ♭9・♯9。
const clashes: string[] = [];
let longNotes = 0;
for (const n of lead) {
	if (n.durationSteps < 20) continue;
	longNotes++;
	const under = sounding(
		n.startStep,
		n.startStep + Math.min(n.durationSteps, 24),
	);
	if (!under.length) continue;
	const s = semi(n.pitchUnits);
	const pcs = new Set(under.map((x) => pcOf(semi(x.pitchUnits))));
	const lowPcNow = pcOf(Math.min(...under.map((x) => semi(x.pitchUnits))));
	const lpc = pcOf(s);
	const dom7 = pcs.has(pcOf(lowPcNow + 4)) && pcs.has(pcOf(lowPcNow + 10));
	const tension =
		dom7 && (lpc === pcOf(lowPcNow + 1) || lpc === pcOf(lowPcNow + 3));
	const bass =
		n.startStep % 48 === 0 && [1, 6].includes(pcOf(lpc - lowPcNow)) && !tension;
	const b9 =
		lpc !== lowPcNow && !tension && [...pcs].some((pc) => pcOf(lpc - pc) === 1);
	if (bass || b9)
		clashes.push(
			`${Math.floor(n.startStep / BAR) + 1}小節 ${(n.startStep % BAR) / S16}/16 ${NAMES[lpc]} ← {${[...pcs].map((x) => NAMES[x]).join(" ")}}${bass ? "（最低音）" : ""}`,
		);
}
const clashRate = longNotes ? clashes.length / longNotes : 0;
metrics.clash = clashRate;
gates.push({
	name: "ぶつかり",
	ok: clashRate <= P.clash.fail,
	detail: `${clashes.length}/${longNotes} = ${pct(clashRate)}（上限 ${pct(P.clash.fail)}＝生成器の p90、目安 ${pct(P.clash.typical)}）${clashes.length ? ` 例: ${clashes.slice(0, 3).join("、")}` : ""}`,
});

// ---- 終わり方 ----
const harmonyAt: string[] = [];
for (let h = 0; h < totalBars * 2; h++)
	harmonyAt.push(
		[
			...new Set(
				sounding(h * 96, (h + 1) * 96).map((x) => pcOf(semi(x.pitchUnits))),
			),
		]
			.sort((a, b) => a - b)
			.join("."),
	);
const lastBar = (() => {
	for (let b = totalBars - 1; b >= 0; b--)
		if (sounding(b * BAR, (b + 1) * BAR).length) return b;
	return 0;
})();
// 小節頭で鳴っている最低音（動くベースの経過音を根と取らない）。小節頭が空なら小節全体の最低音
// 区間の根: 最低音から1オクターブ以内の音のうち、区間内で一番長く鳴る音名（経過音・休符・オクターブ跳躍に強い）
const rootIn = (from: number, to: number) => {
	const ns = sounding(from, to);
	if (!ns.length) return -1;
	const low = Math.min(...ns.map((x) => semi(x.pitchUnits)));
	const dur = new Map<number, number>();
	for (const x of ns) {
		if (semi(x.pitchUnits) >= low + 12) continue;
		const d =
			Math.min(to, x.startStep + x.durationSteps) - Math.max(from, x.startStep);
		dur.set(
			pcOf(semi(x.pitchUnits)),
			(dur.get(pcOf(semi(x.pitchUnits))) ?? 0) + d,
		);
	}
	return [...dur].sort((a, b) => b[1] - a[1])[0][0];
};
const lowPc = (b: number) => rootIn(b * BAR, (b + 1) * BAR);
const dominant = pcOf(TONIC + 7);
// 導音は求めない（ベースだけで属和音を示す終わり方、♭7 のまま戻る短調がある）
// 属和音は直前2小節のどこか半小節の頭にあればよい（小節の後半に置く Ⅴ を拾う）
const cadence =
	lowPc(lastBar) === TONIC &&
	[1, 2, 3, 4].some((h) => {
		const at = lastBar * BAR - h * (BAR / 2);
		return rootIn(at, at + BAR / 2) === dominant;
	});
// ループ: 最後の小節の最低音から先頭の小節の最低音へ進む流れが、曲の中のどこかに既にある
// （和声の音の集合は層の出入りで変わるので比べない）
const firstBar = (() => {
	for (let b = 0; b < totalBars; b++)
		if (sounding(b * BAR, (b + 1) * BAR).length) return b;
	return 0;
})();
const loop = (() => {
	const from = lowPc(lastBar);
	const to = lowPc(firstBar);
	if (from === to) return true;
	for (let b = 0; b + 1 < lastBar; b++)
		if (lowPc(b) === from && lowPc(b + 1) === to) return true;
	return false;
})();
const endDetail = {
	text: `Ⅴ→ⅰ ${cadence ? "あり" : "無し"}（最後の最低音 ${lowPc(lastBar) >= 0 ? NAMES[lowPc(lastBar)] : "-"}、直前の半小節ごとの根 ${[
		4, 3, 2, 1,
	]
		.map((h) => {
			const at = lastBar * BAR - h * (BAR / 2);
			const r = rootIn(at, at + BAR / 2);
			return r >= 0 ? NAMES[r] : "-";
		})
		.join("→")}）、先頭へ戻れる ${loop ? "はい" : "いいえ"}`,
}.text;
// ループの曲は主音で終われば先頭のどの和音へも戻れるとみなす
const endOk = P.ending === "loop" ? loop || lowPc(lastBar) === TONIC : cadence;
if (P.ending === "loop")
	hypotheses.push({
		name: "先頭へ戻れる終わり方",
		ok: endOk,
		detail: endDetail,
	});

// ============ 仮説（2曲比較から。所有者の評価で確かめるまで合否にしない） ============

type Sec = { name: string; from: number; to: number };
const placed: Sec[] = [];
{
	let b = 0;
	for (const s of sections) {
		placed.push({ name: s.name, from: b, to: b + s.bars });
		b += s.bars;
	}
}
const leadIn = (s: Sec) =>
	lead.filter((n) => n.startStep >= s.from * BAR && n.startStep < s.to * BAR);
const statOf = (secs: Sec[]) => {
	const ns = secs.flatMap(leadIn);
	const bars = secs.reduce((a, s) => a + s.to - s.from, 0);
	const d = ns.reduce((a, n) => a + n.durationSteps, 0);
	return {
		center: d
			? ns.reduce((a, n) => a + n.durationSteps * semi(n.pitchUnits), 0) / d
			: Number.NaN,
		ioi: ns.length ? (bars * 16) / ns.length : Number.NaN,
		occ: bars ? d / (bars * BAR) : 0,
		s16: ns.length
			? ns.filter((n) => n.durationSteps <= S16).length / ns.length
			: 0,
		trip: ns.length
			? ns.filter((n) => n.startStep % S16 !== 0).length / ns.length
			: 0,
	};
};
const harmonies = new Set(harmonyAt.filter(Boolean));
metrics.harmonies = harmonies.size;
hypotheses.push({
	name: "和声の素材 10 種以上",
	// Speder2 は少数の和音のループが規則なので測らない
	ok: profileName === "speder2" ? null : harmonies.size >= 10,
	detail: `${harmonies.size} 種（半小節ごとの伴奏の音の組み合わせ）${profileName === "speder2" ? "。Speder2 は少数和音のループが規則なので判定しない" : ""}`,
});
const A = statOf(placed.filter((s) => s.name.startsWith("A")));
const B = statOf(placed.filter((s) => s.name.startsWith("B")));
const lift = B.center - A.center;
const ioiRatio = Math.max(A.ioi, B.ioi) / Math.min(A.ioi, B.ioi);
Object.assign(metrics, { lift, ioiRatio });
hypotheses.push({
	name: "サビの持ち上げ +6 半音以上",
	ok: Number.isFinite(lift) ? lift >= 6 : null,
	detail: `${lift.toFixed(1)} 半音（長さで重みづけた中心）`,
});
hypotheses.push({
	name: "Aとサビの発音間隔の比 1.2 以上",
	ok: Number.isFinite(ioiRatio) ? ioiRatio >= 1.2 : null,
	detail: `A ${A.ioi.toFixed(2)}／サビ ${B.ioi.toFixed(2)}（16分単位）→ 比 ${ioiRatio.toFixed(2)}。2号は「サビでも走る」が規則なので、流派の規則を優先する`,
});
const stale: string[] = [];
placed.forEach((s, i) => {
	if (i === 0 || s.name.startsWith("A") || s.name.startsWith("B")) return;
	const prev = new Set(
		placed.slice(0, i).flatMap((q) => harmonyAt.slice(q.from * 2, q.to * 2)),
	);
	const newHarm = harmonyAt
		.slice(s.from * 2, s.to * 2)
		.some((h) => h && !prev.has(h));
	if (!newHarm && leadIn(s).length === 0)
		stale.push(`${s.name}（${s.from + 1}〜${s.to}小節）`);
});
hypotheses.push({
	name: "A・サビ以外の部が新しい和声か旋律を持つ",
	ok: stale.length === 0,
	detail: stale.length
		? `既出の和声だけでリード無し: ${stale.join("、")}`
		: "どの部も新しい和声か旋律を持つ",
});
if (P.ending === "cadence")
	hypotheses.push({ name: "Ⅴ→ⅰ で終わる", ok: endOk, detail: endDetail });
const firstLeadBar = lead.length
	? Math.floor(lead[0].startStep / BAR) + 1
	: Number.NaN;
hypotheses.push({
	name: `リードが ${P.leadBy - 1} 小節目までに出る`,
	ok: firstLeadBar < P.leadBy,
	detail: `最初のリード音は ${firstLeadBar} 小節目`,
});

// ============ 注意（聴いて決める） ============

const leadVel =
	lead.reduce((a, n) => a + n.velocity, 0) / Math.max(1, lead.length);
const byTrack = new Map<number, typeof p.placements>();
for (const n of p.placements)
	byTrack.set(n.trackIndex, [...(byTrack.get(n.trackIndex) ?? []), n]);
const leadKeys = new Set(
	lead.map((n) => `${n.startStep}:${semi(n.pitchUnits)}`),
);
const trackRows: string[] = [];
for (const [t, ns] of [...byTrack].sort((a, b) => a[0] - b[0])) {
	const v = ns.reduce((a, n) => a + n.velocity, 0) / ns.length;
	const ss = ns.map((n) => semi(n.pitchUnits));
	const uni =
		ns.filter((n) => leadKeys.has(`${n.startStep}:${semi(n.pitchUnits)}`))
			.length / ns.length;
	const oct =
		ns.filter(
			(n) =>
				leadKeys.has(`${n.startStep}:${semi(n.pitchUnits) + 12}`) ||
				leadKeys.has(`${n.startStep}:${semi(n.pitchUnits) - 12}`),
		).length / ns.length;
	const rel =
		t === LEAD
			? "リード"
			: uni > 0.9
				? "ユニゾンの重ね"
				: oct > 0.9
					? "オクターブの重ね"
					: "";
	trackRows.push(
		`| ${t} | ${inst[t] ?? "?"} | ${ns.length} | ${v.toFixed(0)} | ${Math.min(...ss)}〜${Math.max(...ss)} | ${rel} |`,
	);
	if (t !== LEAD && !DOUBLES.has(t) && v > leadVel && Math.min(...ss) > 45)
		cautions.push(
			`t${t}（${inst[t] ?? "?"}）の平均ベロシティ ${v.toFixed(0)} がリード ${leadVel.toFixed(0)} を上回る`,
		);
	const highLong = ns.filter(
		(n) => n.durationSteps >= BAR && semi(n.pitchUnits) >= 84,
	);
	const cover =
		highLong.reduce((a, n) => a + n.durationSteps, 0) / (totalBars * BAR);
	if (cover >= 0.5)
		cautions.push(
			`t${t}（${inst[t] ?? "?"}）が高さ ${Math.min(...highLong.map((n) => semi(n.pitchUnits)))} 以上の持続音で曲の ${pct(cover)} を覆う（高域の疲れの候補）`,
		);
}
const leadMax = ps.length ? Math.max(...ps) : 0;
if (leadMax >= 84)
	cautions.push(
		`リードの最高音 ${leadMax}（2026-10-17、音源の正規化 e3562c10 より前に矩形波の 82〜89 で「痛い」と言われた。正規化後は条件が違うので WAV で測る）`,
	);

// ============ 出力 ============

const mark = (ok: boolean | null) =>
	ok === null ? "—" : ok ? "合格" : "不合格";
console.log(`# ${file}（${P.label}、${keyArg}）\n`);
console.log("## 関門（流派の規則・ぶつかり）\n");
for (const g of gates) console.log(`- ${mark(g.ok)} ${g.name}: ${g.detail}`);
console.log("\n## 仮説（2曲比較から。合否にしない）\n");
for (const h of hypotheses)
	console.log(
		`- ${h.ok === null ? "—" : h.ok ? "満たす" : "満たさない"} ${h.name}: ${h.detail}`,
	);
console.log("\n## 注意（聴いて決める）\n");
console.log(
	cautions.length ? cautions.map((x) => `- ${x}`).join("\n") : "- なし",
);
console.log("\n## 部ごとのリード\n");
console.log(
	"| 部 | 小節 | 中心 | 発音間隔(16分) | 占有 | 16分 | 3連 |\n|---|---|---|---|---|---|---|",
);
for (const s of placed) {
	const st = statOf([s]);
	console.log(
		`| ${s.name} | ${s.from + 1}〜${s.to} | ${Number.isFinite(st.center) ? st.center.toFixed(1) : "-"} | ${Number.isFinite(st.ioi) ? st.ioi.toFixed(2) : "-"} | ${pct(st.occ)} | ${pct(st.s16)} | ${pct(st.trip)} |`,
	);
}
console.log("\n## トラック\n");
console.log(
	"| t | 音色 | 音数 | 平均ベロシティ | 音域 | リードとの関係 |\n|---|---|---|---|---|---|",
);
console.log(trackRows.join("\n"));
const failed = gates.filter((g) => g.ok === false).length;
console.log(`\n関門の不合格 ${failed} 件`);
if (jsonOut)
	writeFileSync(
		jsonOut,
		JSON.stringify(
			{ file, profile: profileName, failed, gates, hypotheses, metrics },
			null,
			1,
		),
	);
process.exitCode = failed ? 1 : 0;
