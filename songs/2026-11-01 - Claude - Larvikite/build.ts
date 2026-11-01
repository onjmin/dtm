/**
 * 2号兄貴（楽器リード）seed 2 の伴奏に、手で書いたリードを載せる。
 * 軸1: 主題「ラドレミーレドー」（半小節）を2小節ごとの頭に置き続ける。
 * 軸2: リードと重ねはAマイナーペンタ（ラドレミソ）の5音だけ。
 *
 *   npx tsx "songs/2026-11-01 - Claude - Larvikite/build.ts" <出力フォルダ>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseChord } from "@onjmin/chord-parser";
import { BAR, type N, SECTIONS, generate, toMML } from "./lib";

const out = process.argv[2] ?? "scratch/larvikite";
SECTIONS.length = 0;
SECTIONS.push("intro", "verse", "chorus", "bridge", "outro");
const song = generate("kaiwai_2go_lead", 2);

// ------------------------------------------------------------ 記法
// "a5:2" = A5 を16分2つ。"r:2" = 休み。長さ "t" = 16分3連（8 step）。
// "a5:2>" = アクセント（ベロシティ高め）、"a5:1." = ゴースト（低め）。
const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const S16 = BAR / 16;
const parseBar = (src: string, bar: number, base = 100): N[] => {
	const ns: N[] = [];
	let pos = 0;
	for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
		if (tok === "|") continue;
		const m = /^(r|[a-g])(#|-)?(\d)?:(t|\d+(?:\.\d+)?)(>|\.)?$/.exec(tok);
		if (!m) throw new Error(`読めない: ${tok} (bar ${bar + 1})`);
		const len = m[4] === "t" ? 8 : Number(m[4]) * S16;
		if (m[1] !== "r") {
			const semi =
				(Number(m[3]) + 1) * 12 +
				PC[m[1]] +
				(m[2] === "#" ? 1 : m[2] === "-" ? -1 : 0);
			const v = m[5] === ">" ? base + 12 : m[5] === "." ? base - 30 : base;
			// 少しだけ切ってタンギングの粒を出す（16分は 85%、それ以上は 92%）
			const gate = 1;
			ns.push({
				s: bar * BAR + pos,
				d: Math.max(4, Math.round(len * gate)),
				p: semi * 31,
				v: Math.min(127, v),
			});
		}
		pos += len;
	}
	if (pos !== BAR) throw new Error(`bar ${bar + 1}: 長さ ${pos / S16} (16分) != 16`);
	return ns;
};
const shift = (src: string, oct: number, semi = 0): string =>
	src.replace(
		/\b([a-g])(#|-)?(\d):/g,
		(_a, l: string, acc: string | undefined, o: string) => {
			const n = (Number(o) + 1) * 12 + PC[l] + (acc === "#" ? 1 : acc === "-" ? -1 : 0) + oct * 12 + semi;
			const names = ["c", "c#", "d", "e-", "e", "f", "f#", "g", "a-", "a", "b-", "b"];
			return `${names[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}:`;
		},
	);

// ------------------------------------------------------------ 主題と句
// 主題 X（半小節）: ラドレミーレドー
const X = (o: number) => shift("a4:1> c5:1 d5:1 e5:2 d5:1 c5:2", o - 4);

// Aメロ（Am7 | Gm7 | C7 | FM7 ×2、オクターブ4〜5）
const VERSE = [
	`${X(4)} a4:2 g4:1 a4:1 c5:2 r:2`,
	"d5:3> c5:1 a4:2 c5:2 d5:6 r:2",
	// 主題を1段下の音階で（ソラドレードラー）
	"g4:1> a4:1 c5:1 d5:2 c5:1 g4:2 e4:2 g4:1 a4:1 c5:2 d5:2",
	"e5:4> d5:1 c5:1 a4:2 g4:2 a4:2 c5:4",
	`${X(4)} a4:2 g4:1 a4:1 c5:2 r:2`,
	"d5:3> c5:1 a4:2 c5:2 d5:2 c5:1 d5:1 g5:4",
	// 主題の反行（ラソミレーミソー）で上へ
	"a5:1> g5:1 e5:1 d5:2 e5:1 g5:2 e5:1 d5:1 c5:1 d5:1 e5:2 g5:2",
	"a5:4> g5:2 a5:2 g5:2 e5:1 d5:1 e5:1 g5:1 r:1 g5:1.",
];

// サビ（2和音／小節、オクターブ5〜6。Aメロの1オクターブ上）
const CH_A = [
	// Am7 E7: 主題 → E7 の上はミ・レ・ソ（♯9）だけ
	`${X(5)} d6:1 e6:1 r:1 e6:1 d6:2 e6:2`,
	// Am7 Gm7: Gm7 の上はレ（5度）を伸ばす
	"g6:2> e6:2 d6:1 e6:1 c6:2 d6:4 r:1 c6:1 a5:2",
	// C7 FM7: 主題の変形で FM7 の3度（ラ）へ駆け上がる
	"a5:1> c6:1 d6:1 e6:2 g6:1 e6:2 a6:6> g6:1 e6:1",
	// Bm7-5 E7: レ・ラ（和音の音）で降り、3連でミへ
	"d6:2> c6:1 a5:1 d6:2 a5:2 g6:t e6:t d6:t e6:t d6:t a5:t e6:4",
];
const CH_B = [
	`${X(5)} d6:1 e6:1 r:1 e6:1 d6:2 e6:2`,
	"g6:2> e6:2 d6:1 e6:1 c6:2 d6:4 r:1 c6:1 a5:2",
	// 2回目は上で回る
	"c6:1> d6:1 e6:1 g6:2 e6:1 g6:2 a6:4> c7:2 a6:2",
	"g6:2> e6:1 d6:1 e6:2 d6:2 e6:6 r:2",
];
// 締め（Am7 E7 | Am7 Gm7 | Dm7 E7 | FM7 E7）
const CH_END = [
	`${X(5)} d6:1 e6:1 r:1 e6:1 d6:2 e6:2`,
	"g6:2> e6:2 d6:1 e6:1 c6:2 d6:4 r:1 c6:1 a5:2",
	// Dm7 の上で主題を4度上から（レファ…ではなくペンタのままレミソラーソミー）
	"d6:1> e6:1 g6:1 a6:2 g6:1 e6:2 e6:t g6:t e6:t d6:t e6:t g6:t e6:4",
	"a6:4> g6:2 e6:2 d6:2 e6:1 d6:1 e6:2 r:2",
];
const CHORUS = [...CH_A, ...CH_B, ...CH_A, ...CH_END];

// イントロ（3〜4小節目に主題を予告）とアウトロ
const INTRO = [
	"r:16",
	"r:16",
	`${X(5)} r:8`,
	"d6:2> a5:2 d6:2 e6:2 r:4 g5:t a5:t c6:t d6:t e6:t g6:t",
];
const OUTRO = [
	`${X(4)} a4:2 g4:1 a4:1 c5:2 r:2`,
	"d5:3> c5:1 a4:2 g4:2 a4:6 r:2",
	`${X(4)} d5:1 e5:1 r:1 e5:1 d5:2 e5:2`,
	"a5:12> r:4",
];

// ------------------------------------------------------------ 並べる
const lead: N[] = [];
const put = (bars: string[], at: number, base = 100) =>
	bars.forEach((b, i) => lead.push(...parseBar(b, at + i, base)));
const SEC = (name: string) => song.labels.findIndex((l) => l === name);
const starts: number[] = [];
for (let b = 0; b < song.bars; b++)
	if (b === 0 || song.labels[b] !== song.labels[b - 1]) starts.push(b);
const at = (i: number) => starts[i];
// 0 intro / 1 verse / 2 chorus / 3 verse(-2) / 4 chorus / 5 outro
if (starts.length !== 6 || SEC("outro") !== 52) throw new Error(`構成が想定と違う: ${starts}`);
put(INTRO, at(0), 84);
put(VERSE, at(1), 96);
put(CHORUS, at(2), 100);
put(VERSE.map((b) => shift(b, 0, -2)), at(3), 96);
// 2回目のサビは最後の小節だけ、3連で回ってアウトロ（Aメロの高さ）へ降りる形にする
put([...CHORUS.slice(0, 15), "a6:4> g6:2 e6:2 g6:t e6:t d6:t e6:t g6:t e6:t d6:4"], at(4), 104);
put(OUTRO, at(5), 96);

// 重ね（サビだけ、Synth Brass）: ペンタで2つ下の音（4度か3度下）
const PENTA = [0, 3, 5, 7, 10]; // A を 0 とした A C D E G
// 生成器のパッドはサビ締めの Dm7 E7・FM7 E7 で F6 を伸ばし、E7 の G♯ と短9度でこする。E6 に替える。
for (const n of song.tracks.get(6)?.notes ?? []) {
	const bar = Math.floor(n.s / BAR);
	if (/E7$/.test(song.chords[bar]) && Math.round(n.p / 31) === 89) n.p = 88 * 31;
}

const chorusBars = new Set<number>();
song.labels.forEach((l, b) => l === "chorus" && chorusBars.add(b));
/** その時刻の和音の構成音（ピッチクラス）。1小節2和音なら半小節で切り替える。 */
const chordAt = (step: number): number[] => {
	const bar = Math.floor(step / BAR);
	const cs = song.chords[bar].split(/\s+/);
	const c = cs.length > 1 && step % BAR >= BAR / 2 ? cs[1] : cs[0];
	return parseChord(c).pitchClasses;
};
const clashes = (pc: number, tones: number[]) =>
	tones.some((t) => ((pc - t + 12) % 12 === 1) || ((t - pc + 12) % 12 === 1));
const ACC = [4, 5, 6, 7, 8, 10, 13];
const soundingPcs = (step: number): number[] =>
	ACC.flatMap((i) =>
		(song.tracks.get(i)?.notes ?? [])
			.filter((y) => y.s <= step + 6 && y.s + y.d > step + 6)
			.map((y) => Math.round(y.p / 31) % 12),
	);
/** 重ね: ペンタで3〜5半音下 → 無ければ和音の音で3〜9半音下 → 無ければ休む。 */
const harmonize = (n: N): N | undefined => {
	const semi = Math.round(n.p / 31);
	const tones = chordAt(n.s);
	const near = [...tones, ...soundingPcs(n.s)];
	for (const d of [3, 4, 5]) {
		const h = semi - d;
		if (PENTA.includes((((h - 9) % 12) + 12) % 12) && !clashes(h % 12, near))
			return { ...n, p: h * 31, v: n.v - 18 };
	}
	for (let d = 3; d <= 9; d++) {
		const h = semi - d;
		if (tones.includes(((h % 12) + 12) % 12) && !clashes(h % 12, near)) return { ...n, p: h * 31, v: n.v - 18 };
	}
	return undefined;
};
const harmony: N[] = lead
	.filter((n) => chorusBars.has(Math.floor(n.s / BAR)) && n.d >= S16 * 0.8)
	.map(harmonize)
	.filter((n): n is N => !!n);

// ------------------------------------------------------------ 層の入れ替え
const t0 = song.tracks.get(0)!;
t0.notes = lead;
t0.inst = "Lead 2 (sawtooth)";
const t1 = song.tracks.get(1)!;
t1.notes = harmony;
t1.inst = "Synth Brass 1";
t1.volume = 72;
// 生成器のサブメロ（Aメロの E4〜B♭4 の持続）と、サビのギターの対旋律は外す。
// どちらもリードと同じ音域で別の線を歌い、主題を聴き取りにくくするため。
song.tracks.delete(3);
song.tracks.delete(14);

mkdirSync(out, { recursive: true });
writeFileSync(`${out}/song.mml`, toMML(song));
writeFileSync(
	`${out}/song.json`,
	JSON.stringify(
		{
			bpm: song.bpm,
			key: song.key,
			chords: song.chords,
			labels: song.labels,
			tracks: [...song.tracks.values()].map((t) => ({
				index: t.index,
				inst: t.inst,
				role: t.role,
				volume: t.volume,
				notes: t.notes,
			})),
		},
		null,
		0,
	),
);
console.log(`書いた: ${out}/song.mml（${song.bars} 小節, ${song.bpm} BPM, ${song.key}）`);
