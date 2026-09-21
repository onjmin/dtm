/**
 * 手書き譜面を、自動作曲と**同じ物差し**（screen-compose.ts の減点表）に掛ける。
 *   npx tsx scripts/screen-handscore.ts <score.json> [<score.json> ...]
 */
import { readFileSync } from "node:fs";
import type { HandScore } from "./hand-compile";

const STEPS_PER_BAR = 192;
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
const DEG: Record<string, number> = {
	"1": 0,
	b2: 1,
	"2": 2,
	"#2": 3,
	b3: 3,
	"3": 4,
	"4": 5,
	"#4": 6,
	b5: 6,
	"5": 7,
	"#5": 8,
	b6: 8,
	"6": 9,
	"#6": 10,
	b7: 10,
	"7": 11,
};

type N = { startStep: number; midi: number; durationSteps: number };

const parseBar = (text: string, bar: number, tonicPc: number): N[] => {
	const out: N[] = [];
	let cursor = bar * STEPS_PER_BAR;
	for (const tok of (text ?? "").trim().split(/\s+/).filter(Boolean)) {
		const rest = /^(?:休|r)(\d+)$/.exec(tok);
		if (rest) {
			cursor += Number(rest[1]) * 12;
			continue;
		}
		const m = /^([#b]?\d)\^(-?\d+):(\d+)$/.exec(tok);
		if (!m) continue;
		const pc = (((tonicPc + DEG[m[1]]) % 12) + 12) % 12;
		out.push({
			startStep: cursor,
			midi: (Number(m[2]) + 1) * 12 + pc,
			durationSteps: Number(m[3]) * 12,
		});
		cursor += Number(m[3]) * 12;
	}
	return out;
};

for (const path of process.argv.slice(2)) {
	const sc: HandScore = JSON.parse(readFileSync(path, "utf8"));
	const tonicPc = PC[sc.key.replace(/m$/, "")] ?? 0;
	const bars = sc.melody.length;
	const melody = sc.melody.flatMap((t, i) => parseBar(t, i, tonicPc));
	let startBar = 0;
	const sections = (sc.sections ?? []).map((x) => {
		const s = { kind: x.kind, startBar, bars: x.bars };
		startBar += x.bars;
		return s;
	});

	const barNotes = (b: number) =>
		melody
			.filter(
				(n) =>
					n.startStep >= b * STEPS_PER_BAR &&
					n.startStep < (b + 1) * STEPS_PER_BAR,
			)
			.sort((a, x) => a.startStep - x.startStep);
	const rhythmKey = (b: number) =>
		barNotes(b)
			.map((n) => `${n.startStep - b * STEPS_PER_BAR}/${n.durationSteps}`)
			.join(",");
	const faults: string[] = [];
	let s = 1;

	let first = 0;
	while (first < bars && barNotes(first).length === 0) first++;
	const sec = first * (60 / sc.bpm) * 4;
	if (sec > 12) {
		faults.push(`歌の入りが ${sec.toFixed(1)}秒`);
		s -= 0.25;
	} else if (sec > 8) {
		faults.push(`歌の入りが ${sec.toFixed(1)}秒（やや遅い）`);
		s -= 0.1;
	}

	const last = melody.at(-1);
	const lastDeg = last ? (((last.midi - tonicPc) % 12) + 12) % 12 : -1;
	if (lastDeg !== 0) {
		faults.push(`最後の音が主音でない（度数 ${lastDeg}）`);
		s -= 0.2;
	}

	const chorus = sections.filter(
		(x) => x.kind === "chorus" || x.kind === "lastChorus",
	);
	let rep = 0,
		leak = 0;
	if (chorus.length) {
		const head = chorus[0].startBar;
		const hook = `${rhythmKey(head)}|${rhythmKey(head + 1)}`;
		const cb = new Set<number>();
		for (const c of chorus)
			for (let b = c.startBar; b < c.startBar + c.bars; b++) cb.add(b);
		for (let b = 0; b + 1 < bars; b += 2) {
			if (`${rhythmKey(b)}|${rhythmKey(b + 1)}` !== hook) continue;
			if (cb.has(b)) rep++;
			else leak++;
		}
		if (rep < 2) {
			faults.push(`サビ冒頭2小節型がサビ内で ${rep} 回しか出ない`);
			s -= 0.2;
		}
		if (leak > 0) {
			faults.push(`サビ冒頭2小節型が他セクションにも ${leak} 回出る`);
			s -= 0.15 * Math.min(2, leak);
		}
	}

	const kindBars = (kinds: string[]) => {
		const o: number[] = [];
		for (const x of sections)
			if (kinds.includes(x.kind))
				for (let b = x.startBar; b < x.startBar + x.bars; b++) o.push(b);
		return o;
	};
	const vk = new Set(kindBars(["verse"]).map(rhythmKey).filter(Boolean));
	const ck = new Set(
		kindBars(["chorus", "lastChorus"]).map(rhythmKey).filter(Boolean),
	);
	let shared = 0;
	for (const k of ck) if (vk.has(k)) shared++;
	const contrast = ck.size ? 1 - shared / ck.size : 0;
	if (contrast < 0.5) {
		faults.push(
			`Aメロとサビのリズム型が ${Math.round((1 - contrast) * 100)}% 共通`,
		);
		s -= 0.25;
	}

	const seq = melody.map((n) => n.midi);
	let big = 0,
		maxLeap = 0;
	for (let i = 1; i < seq.length; i++) {
		const d = Math.abs(seq[i] - seq[i - 1]);
		if (d > maxLeap) maxLeap = d;
		if (d > 9) big++;
	}
	if (big > 2) {
		faults.push(`10半音超の跳躍が ${big} 箇所（最大 ${maxLeap}）`);
		s -= 0.15;
	}

	const cs = kindBars(["chorus", "lastChorus"]).flatMap((b) =>
		barNotes(b).map((n) => n.midi),
	);
	if (seq.length && cs.length && Math.max(...cs) < Math.max(...seq)) {
		faults.push("曲の最高音がサビの外にある");
		s -= 0.15;
	}

	console.log(
		`${path}\n  選抜点=${Math.max(0, s).toFixed(2)} 歌入り=${sec.toFixed(1)}s フック再現=${rep} 漏れ=${leak} 対比=${contrast.toFixed(2)} 最大跳躍=${maxLeap} 主音終止=${lastDeg === 0 ? "○" : "×"}${faults.length ? `\n  減点: ${faults.join(" / ")}` : "\n  減点: なし"}`,
	);
}
