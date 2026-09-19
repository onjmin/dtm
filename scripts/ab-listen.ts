/**
 * **目隠し A/B の作成器。同じ曲から、歌の旋律だけを差し替えた2本を出す。**
 *
 *   npx tsx scripts/ab-listen.ts --variant broken --out tmp/ab-broken
 *   npx tsx scripts/ab-listen.ts --variant chords --out tmp/ab-chords
 *   npx tsx scripts/ab-listen.ts --pdmx tmp/pdmx.jsonl --release --out tmp/abc-release
 *   npx tsx scripts/ab-listen.ts --pdmx tmp/pdmx.jsonl --out tmp/ab-pdmx
 *   npx tsx scripts/ab-listen.ts --human "<他人の曲のフォルダ>" --out tmp/ab-human
 *   npx tsx scripts/ab-listen.ts --model tmp/whole-melodies.jsonl --out tmp/ab-model
 *
 *   --release     A/B/C にする。A = main で出荷しているものそのまま（12本引き＋選抜・
 *                 ハモリ・サブメロ・自前の進行・楽器プリセット）、B = その曲の旋律を
 *                 この道具の和声付け直しに通したもの、C = 素材の旋律を同じ道具に通したもの
 *   --variant chords
 *                 旋律の外側の実験。素材は要らない。A = 出荷版の旋律＋出荷版の進行・
 *                 ベース・パッド、B = 同じ旋律＋旋律に合わせて付け直した進行・ベース・
 *                 パッド。ハモリ・サブメロは和音から導く声部なので両方とも外す。
 *                 違うのは和声だけ
 *   --variant broken
 *                 **測定器の感度検査。** A = 出荷版の旋律＋出荷版の伴奏、B = 同じ旋律に
 *                 わざと壊した伴奏（奇数組: 旋律を見ずに無作為に引いたダイアトニック
 *                 三和音／偶数組: 伴奏だけ三全音ずらす）。B が負けないなら、この形式は
 *                 和声の良否をそもそも聴き分けられていない
 *   --bars 8      切り出す小節数（既定 8。最初のサビを含み、その終わりに揃える）
 *   --alone       伴奏・ドラムを外し、歌だけをピアノ音色で鳴らす（`tmp/blind.ts` の形式）
 *   --pairs 5     組数（既定 5。聴取予算は1回5組10本。[[ab-listening-budget]]）
 *   --seed N      曲の抽選・素材の抽選・左右の入れ替えの種（既定 20260919）
 *
 * 出力は `01_1.mid` `01_2.mid` … の中立な連番。答えは `_key.txt`。
 * 訊く内容は「1と2のどちらがましか」の1問だけにする。
 *
 * ## なぜこれが要るのか（陽性対照）
 *
 * 2026-09-16〜19 の4回の実験は「旋律の音符列を変えても耳に差が出ない」で終わった
 * （`docs/handover-compose.md`）。ただしそのうち後半2回は、**サビ8小節・全トラック
 * 入り・素材だけ差し替え**の A/B で測っている。この形式が「本当に違うもの」を
 * 違うと言えるかは、一度も確かめていない。
 *
 * そこで **B に人間の本物の旋律を入れる**。人間の旋律でも差が出ないなら、差が
 * 出ないのは素材ではなく**測定形式の側**で、「旋律は効かない」という結論は撤回する。
 * 差が出るなら測定器は生きていて、モデル製の旋律が人間に届いていないだけ、と読める。
 *
 * ## 素材は「聴いたことのない人間の曲」でなければならない
 *
 * `--human`（他作フォルダ `it_is_used`）で最初に出したとき、所有者は1本を
 * 「よく覚えてる」と言った。**知っている旋律は「ましか」の判定に使えない**。
 * 既定の素材は **PDMX**（`tmp/pdmx.jsonl`、`scripts/export-dataset.ts` の出力）。
 * 18万曲のパブリックドメイン譜面で、所有者が知っている確率が無視できる。
 * 作風は界隈曲と完全には重ならない（9項目中6項目で近い。`docs/dataset-provenance.md`）
 * ので、「人間の本物」ではあっても「界隈の本物」ではないことは覚えておく。
 *
 * ## 旋律は別の曲のコード進行には載らない——だから両方とも和声を付け直す
 *
 * `tmp/ab-whole.ts` は、曲のコード進行はそのままに歌だけを入れ替えていた。
 * 測り直すと B（よそから持ってきた旋律）は5組中4組で和音内の割合が A より低く、
 * 3組で半音衝突が多い。A の旋律はそのコード進行と一緒に生成されたもので、B は
 * よそのコードへ後から載せたものなのだから当然で、**この形式は成立していなかった**
 * （所有者の指摘「不協和音になっている」。移調量を伴奏に当てて選び直しても
 * 衝突は減らなかった＝移調の問題ではない）。
 *
 * かといって歌だけで鳴らすと「メロディ単体では判断しづらい」（同じ所有者の実測）。
 *
 * そこで全トラック版は、**A と B の両方に、その旋律へ合う和声を同じ手続きで付け直す**。
 * 曲のコード進行は A にも使わない。手続き:
 *
 *   1. 元の進行の小節割り（1小節に1つか2つ）をそのまま単位にする
 *   2. 調のダイアトニック三和音を候補に、単位ごとの「和音内の音価 −衝突」と
 *      進行の常套（V→I、IV→V、同じ和音の連続を軽く嫌う）を Viterbi で解く
 *   3. コードは曲と同じ奏法（`chordPattern`）で鳴らす
 *   4. ベースは曲のベースの**リズムと根音からの度数**を保って新しい根音へ写す。
 *      パッドは曲のパッドの時刻を保って最寄りの構成音へ写す
 *   5. サブメロとハモリは主旋律から導かれる声部なので両方とも外す
 *
 * ハーモナイザの出来は A・B に等しく効くので、独立変数は旋律だけに戻る。
 * A・B とも「和音内の割合」と「半音衝突の割合」を出力に印字する。
 *
 * ## 出荷版を対照に置く（`--release`、A/B/C）
 *
 * ここまでの A/B は「試作 対 人間」ばかりで、**main で出荷している出力そのもの**を
 * 対照に置いていなかった（所有者の指摘）。`--release` は1曲につき3本出す。
 *
 *   A … 出荷版そのまま。`composeSong` の既定（12本引き＋選抜）で、ハモリ・2声・
 *       オクターブ重ね・サブメロ・自前のコード進行・楽器プリセットまで全部入り。
 *       書き出しは `scripts/export-samples.ts` と同じ（オクターブ重ねだけは
 *       アプリと同じく1オクターブ下げる）
 *   B … 同じ曲の同じ旋律を、この道具の和声付け直し（ハモリ・サブメロ無し）に通したもの
 *   C … 素材（PDMX の人間の旋律）を同じ道具に通したもの
 *
 * A と B の差は**道具の損失**（付け直しと声部の削減がどれだけ聴感を落とすか）。
 * B と C の差は**旋律の差**。A と C を直接比べるのは出荷版対人間だが、道具の損失が
 * 混ざるので、A≈B が確かめられて初めて読める。3本とも同じ曲・同じテンポ・同じ
 * ドラム・同じ楽器で、順番は組ごとに無作為。
 *
 * ## 旋律の外側: 和声だけを変える（`--variant chords`）
 *
 * A/B/C の結果（2026-09-19）は A≈B で、B が A に勝った2組は**付け直しで和音内の
 * 割合が大きく上がった組**（38→64%、49→59%）と一致していた。5組の中の2組なので
 * 弱いが、この一連の実験で唯一「何かと一致した」信号。旋律を固定し和声だけを
 * 入れ替えて、これを直接測る。
 *
 * ## 測定器の感度検査（`--variant broken`）
 *
 * `--variant chords` の結果（2026-09-19）は A 2 / B 1 / 引き分け 2 で、和音内の割合とも
 * 逆向き（B の和音内が大きく上がった組1で A が勝ち、A の和音内が高い組5で B が勝った）。
 * 旋律の素材4回・全部入り対削減・和声、と**この形式で差が出たものが一つも無い**。
 * 「全部本当に効かない」のか「この形式が何も聴き分けられない」のかを切り分けるには、
 * **必ず聴き分けられるはずの差**を同じ形式で出して当てられるかを見るしかない。
 * 当てられなければ、8小節・目隠し・「どちらがましか」の形式は捨てる。
 *
 * ## そのほかの差し込み方
 *
 * - 曲は `drawCount: 1` で引く（既定の12本引き＋選抜だと素材で勝者が変わる）。
 *   `--release` のときは出荷版そのものが対照なので既定の引き方にする
 * - 曲の音階は長調（陽）か短調（民謡・和声的短音階）に限り、素材の長短を合わせる
 * - 素材の移調量は、窓の音が曲の音階へ最も多く乗る量（同点なら主音合わせに近いほう）。
 *   オクターブは素材Aの中央値へ合わせる（線の形を変えない唯一の直し方）
 * - 切り出す窓は、素材自身の音高中央値が最も高い8小節（サビ相当）。音域が
 *   2オクターブを超える窓・1小節14音を超える窓は、主旋律に伴奏が混ざっている
 * - ベロシティは両方とも同じ規則（小節頭 112 / 16分 88 / 他 100）で付け直す
 */

import {
	createReadStream,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseChord } from "@onjmin/chord-parser";
import { programOfInstrumentName } from "../src/audio-config";
import { buildChordPlacements } from "../src/chords";
import { composeSong, transposeChordName } from "../src/compose";
import {
	COMPOSE_SCALES,
	degreeToPitch,
	scalePcs,
	scaleSize,
} from "../src/compose-scales";
import { DRUM_PATTERNS, resolveDrumPattern } from "../src/drum-config";
import { INSTRUMENT_PRESETS } from "../src/instrument-presets";
import { exportMIDI } from "../src/midi-io";
import { UNITS_PER_SEMITONE, type Units } from "../src/tuning";
import type { Note } from "../src/types";
import {
	channelNotes,
	collectFromDir,
	estimateKey,
	isPlausibleMelody,
	parseSmf,
	quantize,
	toMonophonic,
} from "./calibrate-corpus";

const SPB = 192;
/** 曲の主旋律の音域は2オクターブ（`compose.ts` の MELODY_LOW/HIGH）。窓の上限もこれ。 */
const MAX_WINDOW_RANGE = 24;
/**
 * 1小節あたりの音数の上限。歌える線は16分の刻みっぱなしでも 16 音で、それを
 * 超える窓はアルペジオや伴奏が主旋律に紛れている（実測: 8小節 281 音の窓が出た）。
 */
const MAX_NOTES_PER_BAR = 14;
/** 1小節あたりの音数の下限。これより疎な窓はサビではなく間や休みの区間。 */
const MIN_NOTES_PER_BAR = 3;
/** PDMX から拾う本数。長短それぞれに数本ずつ残れば足りる。 */
const PDMX_WANT = 120;
/** ベースの音域（`compose.ts` の BASS_LOW/HIGH）。 */
const BASS_LOW = 33;
const BASS_HIGH = 45;

const argv = process.argv.slice(2);
const argOf = (n: string): string | undefined => {
	const i = argv.indexOf(n);
	return i >= 0 ? argv[i + 1] : undefined;
};
const humanDir = argOf("--human");
const pdmxSrc = argOf("--pdmx");
const modelSrc = argOf("--model");
const outDir = argOf("--out") ?? "tmp/ab-listen";
const bars = Number(argOf("--bars") ?? 8);
const pairs = Number(argOf("--pairs") ?? 5);
const seed = Number(argOf("--seed") ?? 20260919);
const alone = argv.includes("--alone");
const release = argv.includes("--release");
const variant = argOf("--variant");
/** 素材の要らない実験（旋律は出荷版のまま、伴奏側だけ変える）。 */
const noSource = variant === "chords" || variant === "broken";
if (!humanDir && !pdmxSrc && !modelSrc && !noSource) {
	console.error(
		"--pdmx <jsonl> / --human <フォルダ> / --model <jsonl> のどれかが要ります",
	);
	process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const seededRandom = (s: number): (() => number) => {
	let x = s >>> 0;
	return () => {
		x = (x * 1664525 + 1013904223) >>> 0;
		return x / 4294967296;
	};
};
const median = (xs: number[]): number =>
	[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pcOf = (semi: number): number => ((semi % 12) + 12) % 12;
const semiOf = (n: Note): number =>
	Math.round(n.pitchUnits / UNITS_PER_SEMITONE);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 素材の音。`pitch` は半音（人間・PDMX）か度数（モデル）。 */
type SrcNote = { at: number; dur: number; pitch: number };
type Source = {
	name: string;
	notes: SrcNote[];
	/** 人間の曲だけ持つ。モデルの度数は曲の音階へ写すので調は無い。 */
	key: { tonic: number; minor: boolean } | null;
};

const loadHuman = (dir: string): Source[] => {
	const out: Source[] = [];
	let i = 0;
	for (const buf of collectFromDir(dir)) {
		i++;
		let melody: ReturnType<typeof quantize> | null = null;
		let bestCoverage = -1;
		try {
			// 主旋律の選び方は `calibrate-corpus.ts` と同じ**鳴っている時間が最長**。
			for (const ns of channelNotes(parseSmf(buf)).values()) {
				if (!isPlausibleMelody(ns)) continue;
				const coverage = ns.reduce((sum, n) => sum + n.durationSteps, 0);
				if (coverage <= bestCoverage) continue;
				bestCoverage = coverage;
				melody = quantize(toMonophonic(ns));
			}
		} catch {
			continue;
		}
		if (!melody || melody.length < 60) continue;
		out.push({
			name: `human#${i}`,
			notes: melody.map((n) => ({
				at: n.startStep,
				dur: n.durationSteps,
				pitch: Math.round(n.pitchSemi),
			})),
			key: estimateKey(melody),
		});
	}
	return out;
};

/**
 * PDMX の主旋律（`export-dataset.ts` の出力）。18万行を全部は持たず、
 * 一定確率で拾って {@link PDMX_WANT} 本そろったら止める。
 */
const loadPdmx = async (path: string, rnd: () => number): Promise<Source[]> => {
	const out: Source[] = [];
	const rl = createInterface({ input: createReadStream(path, "utf8") });
	for await (const line of rl) {
		if (!line.trim() || rnd() > 0.002) continue;
		const d = JSON.parse(line) as {
			source: string;
			tonic: number;
			minor: boolean;
			bars: number;
			notes: { at: number; dur: number; semi: number }[];
		};
		if (d.bars < 16) continue;
		out.push({
			name: `pdmx ${d.source}`,
			notes: d.notes.map((n) => ({ at: n.at, dur: n.dur, pitch: n.semi })),
			key: { tonic: d.tonic, minor: d.minor },
		});
		if (out.length >= PDMX_WANT) break;
	}
	rl.close();
	return out;
};

const loadModel = (path: string): Source[] =>
	readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter((l) => l.trim())
		.map((l, i) => ({
			name: `model#${i + 1}`,
			notes: (
				JSON.parse(l).notes as { at: number; dur: number; deg: number }[]
			).map((n) => ({ at: n.at, dur: n.dur, pitch: n.deg })),
			key: null,
		}));

/**
 * その旋律のなかで音高の中央値が最も高い `bars` 小節の窓。サビは音域が上がる
 * （`compose-fingerprint-fix-2026-09`）ので、素材側にも相当する場所を選ばせる。
 */
const peakWindow = (notes: SrcNote[]): SrcNote[] | null => {
	const last = Math.max(...notes.map((n) => n.at));
	let best: SrcNote[] | null = null;
	let bestPitch = Number.NEGATIVE_INFINITY;
	for (let bar = 0; bar + bars <= last / SPB + 1; bar++) {
		const frm = bar * SPB;
		const win = notes.filter((n) => n.at >= frm && n.at < frm + bars * SPB);
		if (win.length < MIN_NOTES_PER_BAR * bars) continue;
		if (win.length > MAX_NOTES_PER_BAR * bars) continue;
		const ps = win.map((n) => n.pitch);
		if (Math.max(...ps) - Math.min(...ps) > MAX_WINDOW_RANGE) continue;
		const pitch = median(ps);
		if (pitch > bestPitch) {
			bestPitch = pitch;
			best = win.map((n) => ({ ...n, at: n.at - frm }));
		}
	}
	return best;
};

/** 小節頭 112 / 16分 88 / 他 100。`compose.ts` の主旋律と同じ規則。 */
const velocityOf = (at: number, dur: number): number =>
	at % SPB === 0 ? 112 : dur <= SPB / 16 ? 88 : 100;

type Song = ReturnType<typeof composeSong>;
type ComposedNote = Song["melody"][number];

const clip = (n: Note): Note => ({
	...n,
	durationSteps: Math.max(
		1,
		Math.min(n.durationSteps, bars * SPB - n.startStep),
	),
});

const cutSong = (notes: ComposedNote[], fromBar: number): Note[] =>
	notes
		.map((n) => ({
			startStep: n.startStep - fromBar * SPB,
			durationSteps: n.durationSteps,
			pitchUnits: n.pitchUnits,
			velocity: n.velocity,
		}))
		.filter((n) => n.startStep >= 0 && n.startStep < bars * SPB)
		.map((n) => clip(n as Note));

const scaleSetOf = (song: Song, keyShift: number): Set<number> =>
	new Set(
		[...scalePcs(COMPOSE_SCALES[song.scaleId])].map((pc) =>
			pcOf(pc + song.rootShift + keyShift),
		),
	);

/** 素材の窓 → この曲の調・音域へ写した歌。 */
const fitToSong = (
	src: Source,
	win: SrcNote[],
	song: Song,
	chorusKeyShift: number,
	targetSemi: number,
	scaleSet: Set<number>,
): { notes: Note[]; shift: number } => {
	const scale = COMPOSE_SCALES[song.scaleId];
	const toNotes = (semis: number[]): Note[] => {
		// 声域合わせはオクターブ単位。線の形を動かさない唯一の直し方。
		const k = Math.round((targetSemi - median(semis)) / 12) * 12;
		return win.map((n, i) =>
			clip({
				startStep: n.at,
				durationSteps: n.dur,
				pitchUnits: ((semis[i] + k) * UNITS_PER_SEMITONE) as Units,
				velocity: velocityOf(n.at, n.dur),
			}),
		);
	};

	if (!src.key) {
		// モデル: 度数0＝主音。曲の音階の主音の度数を足してから音へ写す。
		return {
			notes: toNotes(
				win.map(
					(n) =>
						degreeToPitch(scale, scale.tonic + n.pitch).semi +
						song.rootShift +
						chorusKeyShift,
				),
			),
			shift: 0,
		};
	}

	// 人間: 主音合わせの移調を起点に、窓の音が曲の音階へ最も多く乗る移調を採る。
	// 同点なら主音合わせに近いほう。推定調が5度ずれていた素材の保険。
	const songTonic = pcOf(
		degreeToPitch(scale, scale.tonic).semi + song.rootShift + chorusKeyShift,
	);
	let shift0 = pcOf(songTonic - src.key.tonic);
	if (shift0 > 6) shift0 -= 12;
	let best = { shift: shift0, inScale: Number.NEGATIVE_INFINITY };
	for (let d = -6; d <= 5; d++) {
		const shift = shift0 + d;
		let inScale = 0;
		for (const n of win)
			if (scaleSet.has(pcOf(n.pitch + shift))) inScale += n.dur;
		if (
			inScale > best.inScale ||
			(inScale === best.inScale &&
				Math.abs(shift - shift0) < Math.abs(best.shift - shift0))
		)
			best = { shift, inScale };
	}
	return {
		notes: toNotes(win.map((n) => n.pitch + best.shift)),
		shift: best.shift,
	};
};

// ============================================================
// 和声の付け直し
// ============================================================

/** 窓のなかの1単位（1小節、または半小節）。元の進行の小節割りに従う。 */
type Unit = { start: number; end: number; rootPc: number; minor: boolean };

/**
 * 元の進行の窓の部分を単位へ分解する。単位数（1小節に1つか2つ）と、ベースの
 * 度数を保つための元の根音・長短だけを使う。コード名は C 基準で書かれていて
 * `rootShift` は掛かっていない（セクションの転調は名前に織り込み済み）。
 */
const originalUnits = (song: Song, fromBar: number): Unit[] => {
	const barStrs = song.chordProgression.split("|");
	const out: Unit[] = [];
	for (let b = 0; b < bars; b++) {
		const names = (barStrs[fromBar + b] ?? "")
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		const n = Math.max(1, names.length);
		for (let u = 0; u < n; u++) {
			let rootPc = 0;
			let minor = false;
			try {
				const p = parseChord(names[u] ?? "C");
				rootPc = pcOf(p.root + song.rootShift);
				minor = p.notes.some((x) => pcOf(x - p.root) === 3);
			} catch {}
			out.push({
				start: b * SPB + (u * SPB) / n,
				end: b * SPB + ((u + 1) * SPB) / n,
				rootPc,
				minor,
			});
		}
	}
	return out;
};

type Candidate = { deg: number; minor: boolean; prior: number; label: string };
const MAJOR_CANDIDATES: Candidate[] = [
	{ deg: 0, minor: false, prior: 0, label: "I" },
	{ deg: 5, minor: false, prior: 0, label: "IV" },
	{ deg: 7, minor: false, prior: 0, label: "V" },
	{ deg: 9, minor: true, prior: 0, label: "vi" },
	{ deg: 2, minor: true, prior: -0.3, label: "ii" },
	{ deg: 4, minor: true, prior: -0.6, label: "iii" },
];
const MINOR_CANDIDATES: Candidate[] = [
	{ deg: 0, minor: true, prior: 0, label: "i" },
	{ deg: 8, minor: false, prior: 0, label: "VI" },
	{ deg: 10, minor: false, prior: 0, label: "VII" },
	{ deg: 5, minor: true, prior: 0, label: "iv" },
	{ deg: 7, minor: false, prior: -0.1, label: "V" },
	{ deg: 3, minor: false, prior: -0.2, label: "III" },
	{ deg: 7, minor: true, prior: -0.5, label: "v" },
];
/** 進行の常套。`from→to` の加点。同じ和音の連続は軽く嫌う。 */
const TRANSITIONS: Record<string, number> = {
	"V→I": 0.4,
	"IV→V": 0.3,
	"ii→V": 0.3,
	"vi→IV": 0.2,
	"I→IV": 0.1,
	"I→V": 0.1,
	"V→IV": -0.4,
	"V→i": 0.4,
	"VII→i": 0.2,
	"VI→VII": 0.3,
	"iv→V": 0.3,
	"VI→III": 0.2,
	"V→VI": 0.1,
};
const SAME_CHORD_PENALTY = -0.25;
/** 旋律の当たり（和音内−衝突）を常套に対してどれだけ重く見るか。 */
const EMISSION_WEIGHT = 3;

const chordPcs = (rootPc: number, minor: boolean): number[] => [
	rootPc,
	pcOf(rootPc + (minor ? 3 : 4)),
	pcOf(rootPc + 7),
];

/**
 * 旋律にダイアトニック三和音を Viterbi で付ける。単位ごとの得点は、その単位に
 * 重なる音の「和音内 +1 / 和音外 −0.2 / 構成音と半音でぶつかる −1」を音価で
 * 重み付けし、単位の頭で始まる音は2倍に数える。
 */
const harmonize = (
	vocal: Note[],
	units: Unit[],
	tonicPc: number,
	minorKey: boolean,
): Unit[] => {
	const cands = minorKey ? MINOR_CANDIDATES : MAJOR_CANDIDATES;
	const emission = (u: Unit, c: Candidate): number => {
		const pcs = chordPcs(pcOf(tonicPc + c.deg), c.minor);
		let score = 0;
		for (const n of vocal) {
			const s = Math.max(n.startStep, u.start);
			const e = Math.min(n.startStep + n.durationSteps, u.end);
			if (e <= s) continue;
			const w =
				((e - s) / (u.end - u.start)) * (n.startStep === u.start ? 2 : 1);
			const pc = pcOf(semiOf(n));
			if (pcs.includes(pc)) score += w;
			else if (pcs.some((p) => pcOf(p - pc) === 1 || pcOf(pc - p) === 1))
				score -= w;
			else score -= 0.2 * w;
		}
		return score * EMISSION_WEIGHT;
	};
	const n = units.length;
	const best: number[][] = [];
	const back: number[][] = [];
	for (let i = 0; i < n; i++) {
		best.push([]);
		back.push([]);
		for (let c = 0; c < cands.length; c++) {
			let local = cands[c].prior + emission(units[i], cands[c]);
			// 窓の頭と終わりは主和音に寄せる（サビの入りと締め）。
			if ((i === 0 || i === n - 1) && cands[c].deg === 0) local += 0.2;
			if (i === 0) {
				best[i][c] = local;
				back[i][c] = -1;
				continue;
			}
			let top = Number.NEGATIVE_INFINITY;
			let from = 0;
			for (let p = 0; p < cands.length; p++) {
				const key = `${cands[p].label}→${cands[c].label}`;
				const trans = p === c ? SAME_CHORD_PENALTY : (TRANSITIONS[key] ?? 0);
				const v = best[i - 1][p] + trans;
				if (v > top) {
					top = v;
					from = p;
				}
			}
			best[i][c] = top + local;
			back[i][c] = from;
		}
	}
	let c = best[n - 1].indexOf(Math.max(...best[n - 1]));
	const chosen: Candidate[] = [];
	for (let i = n - 1; i >= 0; i--) {
		chosen.unshift(cands[c]);
		c = back[i][c];
	}
	return units.map((u, i) => ({
		...u,
		rootPc: pcOf(tonicPc + chosen[i].deg),
		minor: chosen[i].minor,
	}));
};

const chordString = (units: Unit[]): string => {
	const perBar: string[][] = [];
	for (const u of units) {
		const b = Math.floor(u.start / SPB);
		perBar[b] ??= [];
		perBar[b].push(`${NAMES[u.rootPc]}${u.minor ? "m" : ""}`);
	}
	return perBar.map((xs) => xs.join(" ")).join("|");
};

const unitAt = (units: Unit[], step: number): Unit =>
	units.find((u) => u.start <= step && step < u.end) ?? units[units.length - 1];

/** `semi` に最も近い、ピッチクラスが `pcs` のどれかである音。 */
const nearestWithPc = (semi: number, pcs: number[]): number => {
	let best = semi;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let d = -6; d <= 6; d++)
		if (pcs.includes(pcOf(semi + d)) && Math.abs(d) < bestDist) {
			bestDist = Math.abs(d);
			best = semi + d;
		}
	return best;
};

/** 曲のベースを、リズムと「根音からの度数」を保って新しい和声へ写す。 */
const rePitchBass = (bass: Note[], orig: Unit[], next: Unit[]): Note[] =>
	bass.map((n) => {
		const o = unitAt(orig, n.startStep);
		const c = unitAt(next, n.startStep);
		const semi = semiOf(n);
		let iv = pcOf(semi - o.rootPc);
		if (iv === 4 && c.minor) iv = 3;
		else if (iv === 3 && !c.minor) iv = 4;
		if (![0, 3, 4, 7].includes(iv)) iv = 0; // 経過音は根音へ
		let p = nearestWithPc(semi, [pcOf(c.rootPc + iv)]);
		while (p < BASS_LOW) p += 12;
		while (p > BASS_HIGH) p -= 12;
		return { ...n, pitchUnits: (p * UNITS_PER_SEMITONE) as Units };
	});

/** 曲のパッドを、時刻を保って最寄りの構成音へ写す。 */
const rePitchPad = (pad: Note[], next: Unit[]): Note[] =>
	pad.map((n) => {
		const c = unitAt(next, n.startStep);
		const p = nearestWithPc(semiOf(n), chordPcs(c.rootPc, c.minor));
		return { ...n, pitchUnits: (p * UNITS_PER_SEMITONE) as Units };
	});

/**
 * 歌が伴奏にどれだけ乗っているか。音価で重み付けした「和音内」「半音衝突」。
 */
type Fit = { inChord: number; clash: number };
const fitOf = (vocal: Note[], backing: Note[]): Fit => {
	let inChord = 0;
	let clash = 0;
	let total = 0;
	for (const n of vocal) {
		const end = n.startStep + n.durationSteps;
		const pcs = new Set(
			backing
				.filter(
					(b) =>
						b.startStep < end && b.startStep + b.durationSteps > n.startStep,
				)
				.map((b) => pcOf(semiOf(b))),
		);
		if (pcs.size === 0) continue;
		total += n.durationSteps;
		const pc = pcOf(semiOf(n));
		if (pcs.has(pc)) inChord += n.durationSteps;
		else if ([...pcs].some((p) => pcOf(p - pc) === 1 || pcOf(pc - p) === 1))
			clash += n.durationSteps;
	}
	return {
		inChord: total ? inChord / total : 0,
		clash: total ? clash / total : 0,
	};
};

type Arrangement = { tracks: Note[][]; fit: Fit; chordStr: string };

/** 歌に和声を付け直し、曲の奏法・ベース・パッドで鳴らす伴奏を作る。 */
const arrangeFor = (
	song: Song,
	fromBar: number,
	vocal: Note[],
	orig: Unit[],
	tonicPc: number,
	minorKey: boolean,
): Arrangement => {
	const next = harmonize(vocal, orig, tonicPc, minorKey);
	const chordStr = chordString(next);
	const chords: Note[] = buildChordPlacements({
		chordStr,
		patternType: song.chordPattern,
		rootShift: 0,
		bpm: song.bpm,
		stepsPerBar: SPB,
	})
		.map((c) => ({
			startStep: c.startStep,
			durationSteps: c.durationSteps,
			pitchUnits: c.pitchUnits as Units,
			velocity: c.velocity,
		}))
		.filter((n) => n.startStep < bars * SPB)
		.map(clip);
	const bass = rePitchBass(cutSong(song.bass, fromBar), orig, next);
	const pad = rePitchPad(cutSong(song.pad, fromBar), next);
	return {
		tracks: [vocal, bass, pad, chords],
		fit: fitOf(vocal, [...chords, ...bass]),
		chordStr,
	};
};

/** 曲の楽器プリセットの GM 番号。A/B/C の3本で音色を揃えるため、道具側もこれを使う。 */
const programsOf = (song: Song) => {
	const preset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	return {
		melody: programOfInstrumentName(preset.melody) ?? 0,
		submelody: programOfInstrumentName(preset.submelody) ?? 11,
		bass: programOfInstrumentName(preset.bass) ?? 33,
		chord: programOfInstrumentName(preset.chord) ?? 89,
	};
};

const render = (song: Song, fromBar: number, arr: Arrangement): Blob => {
	const prog = programsOf(song);
	if (alone)
		return exportMIDI({
			tracks: [{ notes: arr.tracks[0], volume: 100, program: 0 }],
			bpm: song.bpm,
			stepsPerBar: SPB,
		});
	const [vocal, bass, pad, chords] = arr.tracks;
	return exportMIDI({
		tracks: [
			{ notes: vocal, volume: 100, program: prog.melody },
			{ notes: bass, volume: 85, program: prog.bass },
			{ notes: pad, volume: 50, program: prog.chord },
			{ notes: chords, volume: 65, program: prog.chord },
		],
		getDrumPattern: (bar) =>
			resolveDrumPattern(song.drum, DRUM_PATTERNS, bar + fromBar),
		drumVolume: 80,
		bpm: song.bpm,
		stepsPerBar: SPB,
	});
};

/** 出荷版の窓。`scripts/export-samples.ts` と同じトラック構成・音量・音色。 */
const releaseChords = (song: Song): ComposedNote[] =>
	buildChordPlacements({
		chordStr: song.chordProgression,
		patternType: song.chordPattern,
		rootShift: song.rootShift,
		bpm: song.bpm,
		stepsPerBar: SPB,
	}).map((c) => ({
		startStep: c.startStep,
		durationSteps: c.durationSteps,
		pitchUnits: c.pitchUnits as number,
		velocity: c.velocity,
	}));

/** 出荷版の窓の進行を、B・C と同じ実音の名前で表示する（文字列は C 基準）。 */
const releaseChordLabel = (song: Song, fromBar: number): string =>
	song.chordProgression
		.split("|")
		.slice(fromBar, fromBar + bars)
		.map((bar) =>
			bar
				.trim()
				.split(/\s+/)
				.map((c) => transposeChordName(c, song.rootShift))
				.join(" "),
		)
		.join("|");

const renderRelease = (song: Song, fromBar: number): Blob => {
	const prog = programsOf(song);
	const cut = (ns: ComposedNote[]): Note[] => cutSong(ns, fromBar);
	// オクターブ重ねは音高が主旋律のままで、アプリではトラック側で1オクターブ下げる。
	const octave = cut(song.octave).map((n) => ({
		...n,
		pitchUnits: (n.pitchUnits - 12 * UNITS_PER_SEMITONE) as Units,
	}));
	return exportMIDI({
		tracks: [
			{ notes: cut(song.melody), volume: 100, program: prog.melody },
			{ notes: cut(song.submelody), volume: 70, program: prog.submelody },
			{ notes: cut(song.harmony), volume: 60, program: prog.melody },
			{ notes: cut(song.harmony2), volume: 52, program: prog.melody },
			{ notes: octave, volume: 44, program: prog.melody },
			{ notes: cut(song.bass), volume: 85, program: prog.bass },
			{ notes: cut(song.pad), volume: 50, program: prog.chord },
			{ notes: cut(releaseChords(song)), volume: 65, program: prog.chord },
		],
		getDrumPattern: (bar) =>
			resolveDrumPattern(song.drum, DRUM_PATTERNS, bar + fromBar),
		drumVolume: 80,
		bpm: song.bpm,
		stepsPerBar: SPB,
	});
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const fitLabel = (n: number, f: Fit): string =>
	`${n}音(和音内 ${pct(f.inChord)} 衝突 ${pct(f.clash)})`;

/** 0..n-1 の無作為な並び。 */
const shuffled = (n: number, rnd: () => number): number[] => {
	const xs = [...Array(n).keys()];
	for (let i = n - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[xs[i], xs[j]] = [xs[j], xs[i]];
	}
	return xs;
};

/**
 * 出荷版の旋律に、出荷版の進行・ベース・パッドをそのまま付けたもの（ハモリ・サブメロ無し）。
 * `--variant chords` の対照。和声付け直し（{@link arrangeFor}）と声部の数を揃える。
 */
const ownArrangement = (song: Song, fromBar: number): Arrangement => {
	const vocal = cutSong(song.melody, fromBar);
	const chords = cutSong(releaseChords(song), fromBar);
	const bass = cutSong(song.bass, fromBar);
	return {
		tracks: [vocal, bass, cutSong(song.pad, fromBar), chords],
		fit: fitOf(vocal, [...chords, ...bass]),
		chordStr: releaseChordLabel(song, fromBar),
	};
};

/**
 * わざと壊した伴奏。`random` は旋律を見ずに単位ごとにダイアトニック三和音を無作為に
 * 引く（進行の常套も見ない）。`tritone` は出荷版の伴奏（コード・ベース・パッド）だけを
 * 三全音（6半音）ずらし、旋律との関係を最も遠くする。
 */
const brokenArrangement = (
	song: Song,
	fromBar: number,
	orig: Unit[],
	tonicPc: number,
	minorKey: boolean,
	mode: "random" | "tritone",
	rnd: () => number,
): Arrangement => {
	const vocal = cutSong(song.melody, fromBar);
	if (mode === "tritone") {
		const own = ownArrangement(song, fromBar);
		const up = (n: Note): Note => ({
			...n,
			pitchUnits: (n.pitchUnits + 6 * UNITS_PER_SEMITONE) as Units,
		});
		const bass = own.tracks[1].map((n) => {
			let p = semiOf(n) + 6;
			while (p > BASS_HIGH) p -= 12;
			return { ...n, pitchUnits: (p * UNITS_PER_SEMITONE) as Units };
		});
		const pad = own.tracks[2].map(up);
		const chords = own.tracks[3].map(up);
		return {
			tracks: [vocal, bass, pad, chords],
			fit: fitOf(vocal, [...chords, ...bass]),
			chordStr: `${own.chordStr} を +6`,
		};
	}
	const cands = minorKey ? MINOR_CANDIDATES : MAJOR_CANDIDATES;
	const next: Unit[] = orig.map((u) => {
		const c = cands[Math.floor(rnd() * cands.length)];
		return { ...u, rootPc: pcOf(tonicPc + c.deg), minor: c.minor };
	});
	const chordStr = chordString(next);
	const chords: Note[] = buildChordPlacements({
		chordStr,
		patternType: song.chordPattern,
		rootShift: 0,
		bpm: song.bpm,
		stepsPerBar: SPB,
	})
		.map((c) => ({
			startStep: c.startStep,
			durationSteps: c.durationSteps,
			pitchUnits: c.pitchUnits as Units,
			velocity: c.velocity,
		}))
		.filter((n) => n.startStep < bars * SPB)
		.map(clip);
	const bass = rePitchBass(cutSong(song.bass, fromBar), orig, next);
	const pad = rePitchPad(cutSong(song.pad, fromBar), next);
	return {
		tracks: [vocal, bass, pad, chords],
		fit: fitOf(vocal, [...chords, ...bass]),
		chordStr,
	};
};

const main = async (): Promise<void> => {
	const sources = noSource
		? []
		: pdmxSrc
			? await loadPdmx(pdmxSrc, seededRandom(seed ^ 0x5bd1e995))
			: humanDir
				? loadHuman(humanDir)
				: loadModel(modelSrc as string);
	if (!noSource && sources.length === 0) {
		console.error("使える素材がありません");
		process.exit(1);
	}
	const coin = seededRandom(seed);
	const used = new Set<string>();
	const srcLabel = pdmxSrc
		? "人間の曲（PDMX・パブリックドメイン譜面）の主旋律"
		: humanDir
			? "人間（他人の曲）の主旋律"
			: "モデルが2小節へ刻まずに書いた旋律";
	const key: string[] = [
		"# どれがどれか。**聴き終わるまで見ないこと。**",
		"#",
		...(variant === "broken"
			? [
					"# A = 出荷版の旋律 ＋ 出荷版の進行・ベース・パッド（ハモリ・サブメロ無し）",
					"# B = 同じ旋律 ＋ わざと壊した伴奏（奇数組: 無作為な三和音／偶数組: 伴奏だけ三全音ずらし）",
					`# 形式: ${bars}小節 / 全トラック入り / 測定器の感度検査`,
				]
			: variant === "chords"
				? [
						"# A = 出荷版の旋律 ＋ 出荷版の進行・ベース・パッド（ハモリ・サブメロ無し）",
						"# B = 同じ旋律 ＋ 旋律に合わせて付け直した進行・ベース・パッド",
						`# 形式: ${bars}小節 / 全トラック入り / 違うのは和声だけ`,
					]
				: release
					? [
							"# A = main で出荷している出力そのまま（12本引き＋選抜・ハモリ・サブメロ・自前の進行）",
							"# B = 同じ曲の同じ旋律を、和声付け直し（ハモリ・サブメロ無し）に通したもの",
							`# C = ${srcLabel}を、同じ和声付け直しに通したもの`,
							`# 形式: ${bars}小節 / 全トラック入り / 3本とも同じ曲・テンポ・ドラム・楽器`,
						]
					: [
							"# A = 今の作曲（compose.ts）の旋律",
							`# B = ${srcLabel}を、この曲の調と音域へ写したもの`,
							`# 形式: ${bars}小節 / ${alone ? "歌だけ（ピアノ）" : "全トラック入り（A・B とも和声を付け直し）"}`,
						]),
		"",
	];

	let made = 0;
	for (let s = 1; made < pairs && s < 400; s++) {
		const song = composeSong({
			stepsPerBar: SPB,
			// 出荷版を対照に置くときは、出荷版と同じ引き方（既定の本数＋選抜）。
			...(release || noSource ? {} : { drawCount: 1 }),
			random: seededRandom(seed + s * 104729),
		});
		const scale = COMPOSE_SCALES[song.scaleId];
		// 長調（主音ド）か短調（主音ラ）の7音音階だけ。
		if (scaleSize(scale) !== 7) continue;
		if (scale.tonic !== 0 && scale.tonic !== 5) continue;
		const songMinor = scale.tonic === 5;
		const chorus = song.sections.find((sec) => sec.kind === "chorus");
		if (!chorus) continue;
		const fromBar =
			bars <= chorus.bars
				? chorus.startBar
				: Math.max(0, chorus.startBar + chorus.bars - bars);
		if (fromBar + bars > song.bars) continue;
		const aVocal = cutSong(song.melody, fromBar);
		if (aVocal.length < 12) continue;

		const tonicPc = pcOf(
			degreeToPitch(scale, scale.tonic).semi + song.rootShift + chorus.keyShift,
		);
		const orig = originalUnits(song, fromBar);
		const aArr = arrangeFor(song, fromBar, aVocal, orig, tonicPc, songMinor);

		type Item = { label: string; blob: Blob; note: string };
		let items: Item[];
		let srcName = "";
		if (variant === "broken") {
			const own = ownArrangement(song, fromBar);
			const mode = (made + 1) % 2 === 1 ? "random" : "tritone";
			const bad = brokenArrangement(
				song,
				fromBar,
				orig,
				tonicPc,
				songMinor,
				mode,
				coin,
			);
			items = [
				{
					label: "A",
					blob: render(song, fromBar, own),
					note: `A ${fitLabel(aVocal.length, own.fit)}  ${own.chordStr}  出荷版の進行`,
				},
				{
					label: `B (${mode})`,
					blob: render(song, fromBar, bad),
					note: `B ${fitLabel(aVocal.length, bad.fit)}  ${bad.chordStr}  壊した伴奏（${mode}）`,
				},
			];
		} else if (variant === "chords") {
			const own = ownArrangement(song, fromBar);
			items = [
				{
					label: "A",
					blob: render(song, fromBar, own),
					note: `A ${fitLabel(aVocal.length, own.fit)}  ${own.chordStr}  出荷版の進行`,
				},
				{
					label: "B",
					blob: render(song, fromBar, aArr),
					note: `B ${fitLabel(aVocal.length, aArr.fit)}  ${aArr.chordStr}  付け直し`,
				},
			];
		} else {
			// 長短の合う未使用の素材を順に使う。**同じ素材は2度使わない**（窓の選び方は
			// 決定的なので、同じ8小節が別の曲に載るだけになる）。尽きた長短の曲は飛ばす。
			const src = sources.find(
				(x) => !used.has(x.name) && (!x.key || x.key.minor === songMinor),
			);
			if (!src) continue;
			used.add(src.name);
			const win = peakWindow(src.notes);
			if (!win) continue;
			srcName = src.name;

			const scaleSet = scaleSetOf(song, chorus.keyShift);
			const targetSemi = median(aVocal.map(semiOf));
			const b = fitToSong(
				src,
				win,
				song,
				chorus.keyShift,
				targetSemi,
				scaleSet,
			);
			const bArr = arrangeFor(song, fromBar, b.notes, orig, tonicPc, songMinor);
			const shiftLabel = `移調 ${b.shift >= 0 ? "+" : ""}${b.shift}`;
			items = release
				? [
						{
							label: "A",
							blob: renderRelease(song, fromBar),
							note: `A ${fitLabel(aVocal.length, ownArrangement(song, fromBar).fit)}  ${releaseChordLabel(song, fromBar)}  出荷版`,
						},
						{
							label: "B",
							blob: render(song, fromBar, aArr),
							note: `B ${fitLabel(aVocal.length, aArr.fit)}  ${aArr.chordStr}  同じ旋律・付け直し`,
						},
						{
							label: `C (${src.name})`,
							blob: render(song, fromBar, bArr),
							note: `C ${fitLabel(b.notes.length, bArr.fit)}  ${bArr.chordStr}  ${shiftLabel}  ${src.name}`,
						},
					]
				: [
						{
							label: "A",
							blob: render(song, fromBar, aArr),
							note: `A ${fitLabel(aVocal.length, aArr.fit)}  ${aArr.chordStr}`,
						},
						{
							label: `B (${src.name})`,
							blob: render(song, fromBar, bArr),
							note: `B ${fitLabel(b.notes.length, bArr.fit)}  ${bArr.chordStr}  ${shiftLabel}  ${src.name}`,
						},
					];
		}
		made++;

		const order = shuffled(items.length, coin);
		const lines: string[] = [];
		for (let i = 0; i < items.length; i++) {
			const name = `${String(made).padStart(2, "0")}_${order[i] + 1}.mid`;
			const blob = items[i].blob;
			writeFileSync(join(outDir, name), Buffer.from(await blob.arrayBuffer()));
			lines.push(`${name} = ${items[i].label}`);
		}
		key.push(...lines.sort());
		console.log(
			`  組${made}: ${song.keyLabel} / ${song.scaleLabel} / ${song.bpm}BPM / ${song.drum} / ${song.chordPattern} / ${song.instrument}${srcName ? ` / ${srcName}` : ""}\n${items.map((x) => `        ${x.note}`).join("\n")}`,
		);
	}

	writeFileSync(join(outDir, "_key.txt"), `${key.join("\n")}\n`, "utf8");
	const per = release ? 3 : 2;
	console.log(
		`● ${made}組 ${made * per}本。答えは ${join(outDir, "_key.txt")}`,
	);
	console.log(
		release
			? "  訊くのは「1・2・3 のどれがましか（順位）」の1問だけ。"
			: "  訊くのは「1と2のどちらがましか」の1問だけ。",
	);
};

main();
