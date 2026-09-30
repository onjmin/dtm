/**
 * 自動作曲の一次選抜（機械だけでやる）。
 *
 * 審査員（サブエージェント）は1曲あたり数千トークン掛かるので、**全候補を読ませるのは無駄**。
 * ここで「聴かなくても分かる欠点」を数えて落とし、残った上位だけをエージェントに回す。
 *
 * 数える項目は、実際にエージェント審査が繰り返し指摘した欠点そのもの：
 *   - 歌が始まるまでが長い（イントロの小節数ではなく**秒**で測る。BPMで3倍違う）
 *   - 終止が主音に解決しない
 *   - サビ固有のフックが無い（サビ冒頭2小節型がサビ内で再現されない／他セクションにも出る）
 *   - Aメロとサビのリズム型が同じ＝対比が「オクターブを上げただけ」
 *   - 歌えない跳躍
 *
 *   npx tsx scripts/screen-compose.ts <count> <startSeed> [top]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { composeOne } from "./compose-lab";

const STEPS_PER_BAR = 192;
const UNITS_PER_SEMITONE = 31;

const midiOf = (u: number): number =>
	Math.floor(u / 372) * 12 +
	Math.round((((u % 372) + 372) % 372) / UNITS_PER_SEMITONE);

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

export type Screened = {
	seed: number;
	score: number;
	/** 減点の理由。人が読む用。 */
	faults: string[];
	vocalInSec: number;
	hookRepeats: number;
	hookLeaks: number;
	contrast: number;
	maxLeap: number;
	resolves: boolean;
	/** メロ＋サブ＋ベースの発音数を秒で割ったもの。鳴りの厚み。 */
	density: number;
	machineScore: number;
};

export const screen = (seed: number): Screened => {
	const { song } = composeOne(seed);
	const tonicPc = PC[song.keyName.replace(/m$/, "")] ?? 0;
	const faults: string[] = [];

	const barNotes = (bar: number) => {
		const from = bar * STEPS_PER_BAR;
		return song.melody
			.filter((n) => n.startStep >= from && n.startStep < from + STEPS_PER_BAR)
			.sort((a, b) => a.startStep - b.startStep);
	};
	const rhythmKey = (bar: number): string =>
		barNotes(bar)
			.map((n) => `${n.startStep - bar * STEPS_PER_BAR}/${n.durationSteps}`)
			.join(",");

	// --- 歌が始まるまでの秒数 ---
	let firstBar = 0;
	while (firstBar < song.bars && barNotes(firstBar).length === 0) firstBar++;
	const secPerBar = (60 / song.bpm) * 4;
	const vocalInSec = firstBar * secPerBar;
	let s = 1;
	if (vocalInSec > 12) {
		faults.push(`歌の入りが ${vocalInSec.toFixed(1)}秒（12秒超）`);
		s -= 0.25;
	} else if (vocalInSec > 8) {
		faults.push(`歌の入りが ${vocalInSec.toFixed(1)}秒（やや遅い）`);
		s -= 0.1;
	}

	// --- 終止が主音へ解決するか ---
	const lastNote = [...song.melody]
		.sort((a, b) => a.startStep - b.startStep)
		.at(-1);
	const lastDeg = lastNote
		? (((midiOf(lastNote.pitchUnits) - tonicPc) % 12) + 12) % 12
		: -1;
	const resolves = lastDeg === 0;
	if (!resolves) {
		faults.push(`最後の音が主音でない（度数 ${lastDeg}）`);
		s -= 0.2;
	}

	// --- サビ固有のフック ---
	const chorus = song.sections.filter(
		(x) => x.kind === "chorus" || x.kind === "lastChorus",
	);
	let hookRepeats = 0;
	let hookLeaks = 0;
	if (chorus.length) {
		const head = chorus[0].startBar;
		const hook = `${rhythmKey(head)}|${rhythmKey(head + 1)}`;
		const chorusBars = new Set<number>();
		for (const c of chorus)
			for (let b = c.startBar; b < c.startBar + c.bars; b++) chorusBars.add(b);
		for (let b = 0; b + 1 < song.bars; b += 2) {
			const k = `${rhythmKey(b)}|${rhythmKey(b + 1)}`;
			if (k !== hook) continue;
			if (chorusBars.has(b)) hookRepeats++;
			else hookLeaks++;
		}
		if (hookRepeats < 2) {
			faults.push(`サビ冒頭2小節型がサビ内で ${hookRepeats} 回しか出ない`);
			s -= 0.2;
		}
		if (hookLeaks > 0) {
			faults.push(
				`サビ冒頭2小節型が他セクションにも ${hookLeaks} 回出る（サビに聞こえない）`,
			);
			s -= 0.15 * Math.min(2, hookLeaks);
		}
	}

	// --- Aメロとサビのリズム型の重なり ---
	const kindBars = (kinds: string[]): number[] => {
		const out: number[] = [];
		for (const sec of song.sections)
			if (kinds.includes(sec.kind))
				for (let b = sec.startBar; b < sec.startBar + sec.bars; b++)
					out.push(b);
		return out;
	};
	const verseKeys = new Set(kindBars(["verse"]).map(rhythmKey).filter(Boolean));
	const chorusKeys = new Set(
		kindBars(["chorus", "lastChorus"]).map(rhythmKey).filter(Boolean),
	);
	let shared = 0;
	for (const k of chorusKeys) if (verseKeys.has(k)) shared++;
	const contrast = chorusKeys.size ? 1 - shared / chorusKeys.size : 0;
	if (contrast < 0.5) {
		faults.push(
			`Aメロとサビのリズム型が ${Math.round((1 - contrast) * 100)}% 共通（対比が音域だけ）`,
		);
		s -= 0.25;
	}

	// --- 歌える跳躍か ---
	const seq = song.melody
		.slice()
		.sort((a, b) => a.startStep - b.startStep)
		.map((n) => midiOf(n.pitchUnits));
	let maxLeap = 0;
	let bigLeaps = 0;
	for (let i = 1; i < seq.length; i++) {
		const d = Math.abs(seq[i] - seq[i - 1]);
		if (d > maxLeap) maxLeap = d;
		if (d > 9) bigLeaps++;
	}
	if (bigLeaps > 2) {
		faults.push(`10半音超の跳躍が ${bigLeaps} 箇所（最大 ${maxLeap}）`);
		s -= 0.15;
	}

	// --- サビが曲の最高音を持つか ---
	const chorusSeq = kindBars(["chorus", "lastChorus"]).flatMap((b) =>
		barNotes(b).map((n) => midiOf(n.pitchUnits)),
	);
	if (
		seq.length &&
		chorusSeq.length &&
		Math.max(...chorusSeq) < Math.max(...seq)
	) {
		faults.push("曲の最高音がサビの外にある");
		s -= 0.15;
	}

	// --- 鳴りの厚み（観測のみ。減点しない） ---
	//
	// 秒あたりの発音数。伴奏（コード）トラックは進行から機械的に展開されて曲ごとの差が
	// 出ないので数えない。
	//
	// **これを減点にしてはいけない。** 一度 4/7 発音/秒を下限として減点に入れたが、根拠は
	// 所有者が気に入った曲1本（12.9）と却下した曲3本（2.4〜2.5）だけだった。
	// `docs/handover-compose.md` に、同じ轍を踏まないための実測と戒めがある——所有者が当たり
	// として選んだ13本は確かに速く厚い側（テンポ中央値150・ドラムは dance/16beat/disco のみ）
	// だが、それは**選ばれた側の特徴**であって「そこへ寄せれば良い曲」ではない。全曲を寄せれば
	// 全曲が同じ顔になる。厚みは系統（ゲーム音楽風かどうか）の選択で決めるものであって、
	// すべての曲に課す合否条件ではない。数字は残す——どの領域の曲かを見分けるのに要る。
	const perSec =
		(song.melody.length + song.submelody.length + song.bass.length) /
		(song.bars * (60 / song.bpm) * 4);

	return {
		seed,
		score: Math.max(0, s),
		faults,
		vocalInSec: Number(vocalInSec.toFixed(1)),
		hookRepeats,
		hookLeaks,
		contrast: Number(contrast.toFixed(2)),
		maxLeap,
		resolves,
		density: Number(perSec.toFixed(1)),
		machineScore: Number(song.stats.score.toFixed(3)),
	};
};

if (process.argv[1]?.includes("screen-compose")) {
	const count = Number(process.argv[2] ?? 100);
	const start = Number(process.argv[3] ?? 1);
	const top = Number(process.argv[4] ?? 10);
	const rows: Screened[] = [];
	for (let i = 0; i < count; i++) rows.push(screen(start + i));
	rows.sort((a, b) => b.score - a.score || b.machineScore - a.machineScore);
	const lines = rows.map(
		(r) =>
			`seed=${r.seed} 選抜点=${r.score.toFixed(2)} 機械採点=${r.machineScore} 歌入り=${r.vocalInSec}s フック再現=${r.hookRepeats} 漏れ=${r.hookLeaks} 対比=${r.contrast} 最大跳躍=${r.maxLeap} 主音終止=${r.resolves ? "○" : "×"} 厚み=${r.density}${r.faults.length ? `\n    ${r.faults.join(" / ")}` : ""}`,
	);
	mkdirSync("tmp", { recursive: true });
	writeFileSync("tmp/screen-result.txt", lines.join("\n"), "utf8");
	console.log(`--- 上位${top}件 ---`);
	console.log(lines.slice(0, top).join("\n"));
	console.log(
		`\n合格ライン(1.0満点・減点なし)の曲: ${rows.filter((r) => r.faults.length === 0).length}/${count}`,
	);
	const hist: Record<string, number> = {};
	for (const r of rows)
		for (const f of r.faults) {
			const key = f.replace(/\d+(\.\d+)?/g, "N");
			hist[key] = (hist[key] ?? 0) + 1;
		}
	console.log("\n--- 欠点の出現数 ---");
	for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1]))
		console.log(`${String(v).padStart(4)} / ${count}  ${k}`);
}
