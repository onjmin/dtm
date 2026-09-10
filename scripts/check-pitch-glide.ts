/**
 * 継続記号（`ー` / `〜`）のピッチ移動チェック。
 *
 * 「`ぎ〜` と書いても『い』が言い直されたように聞こえる」という報告から作った。
 * 声は1回の合成で繋がっているのに言い直して聞こえるのは、伸ばしている途中で
 * **ピッチだけが瞬間移動**するせい——耳はそこを新しい音の始まりとして切る。
 * だからグライド長は固定msではなく音価に比例させてある。
 *
 * ## 何を測るか
 *
 * 1. **グライド長** … 音価ごとに `ー` / `〜` が何msかけて移るか。割合と上限が
 *    効いているか、短い音符で「相対的に一瞬」に戻っていないかを見る。
 * 2. **重なり** … グライドは境界を跨いで中央に置くので、隣の切り替えと範囲が
 *    重なるとピッチが区間を飛び越して暴れる。数式上重ならないことを総当たりで確認する。
 * 3. **曲線そのもの** … 1msごとにサンプルして、NaN・区間ピッチのレンジ超え
 *    （＝オーバーシュート）・目標未達が無いか。
 */
import {
	glideMsForSegments,
	MAX_PORTAMENTO_MS,
	MAX_STEP_GLIDE_MS,
	type PitchSegment,
	PORTAMENTO_RATIO,
	pitchCurveFor,
	STEP_GLIDE_RATIO,
	unitsToHz,
} from "../src/pitch-curve";

/** A4 = 2139 units（1半音 = 31 units）。 */
const A4 = 2139;
const semi = (n: number): number => A4 + n * 31;

/** 等間隔の区間列を作る（`atSec` は先頭ノートのオンセットからの相対秒）。 */
const evenSegments = (
	pitches: number[],
	segMs: number,
	portamento: boolean,
): PitchSegment[] =>
	pitches.map((p, i) => ({
		pitch: p,
		atSec: ((i + 1) * segMs) / 1000,
		portamento,
	}));

let failed = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
	if (!ok) failed++;
	console.log(
		`  ${ok ? "OK  " : "NG  "}${label}${detail ? `  ${detail}` : ""}`,
	);
};

// ------------------------------------------------------------------
// 1. 音価ごとのグライド長
// ------------------------------------------------------------------
console.log("● グライド長（音価に対する割合と上限）");
/** [ラベル, 1区間の長さ(ms)] */
const NOTE_LENGTHS: [string, number][] = [
	["16分", 125],
	["8分", 250],
	["4分", 500],
	["2分", 1000],
	["全音符", 2000],
];
for (const [label, segMs] of NOTE_LENGTHS) {
	for (const [mark, portamento, ratio, cap] of [
		["ー", false, STEP_GLIDE_RATIO, MAX_STEP_GLIDE_MS],
		["〜", true, PORTAMENTO_RATIO, MAX_PORTAMENTO_MS],
	] as [string, boolean, number, number][]) {
		const segments = evenSegments([semi(2), semi(4)], segMs, portamento);
		const [glideMs] = glideMsForSegments(segments, segMs * 3);
		const want = Math.min(segMs * ratio, cap);
		check(
			Math.abs(glideMs - want) < 0.001,
			`${label}(${segMs}ms) ${mark}`,
			`${glideMs.toFixed(0)}ms = 区間の${((glideMs / segMs) * 100).toFixed(0)}%${glideMs >= cap ? "（上限）" : ""}`,
		);
	}
}

// ------------------------------------------------------------------
// 2. 隣接グライドが重ならない
// ------------------------------------------------------------------
console.log("● 隣接グライドの重なり（重なると補間が区間を飛び越えて暴れる）");
/** 長短が入り混じった区間列（`atSec` は累積）。 */
const unevenSegments = (
	lengthsMs: number[],
	portamento: boolean,
): PitchSegment[] => {
	let at = 0;
	return lengthsMs.map((ms, i) => {
		at += ms;
		return {
			pitch: semi((i % 5) - 2),
			atSec: at / 1000,
			portamento,
		};
	});
};
const OVERLAP_CASES: number[][] = [
	[1000, 60, 1000, 60], // 長い音の間に極端に短い音
	[60, 2000, 60, 2000], // その逆
	[8, 8, 8, 8], // すべて極端に短い
	[500, 500, 500, 500], // 素直な等間隔
	[125, 1000, 250, 60, 4000], // ばらばら
];
for (const lengths of OVERLAP_CASES) {
	for (const portamento of [false, true]) {
		// 先頭区間は「頭からその境界まで」なので lengths[0]、以降は lengths[i]。
		const segments = unevenSegments(lengths.slice(1), portamento);
		const totalMs = lengths.reduce((a, b) => a + b, 0);
		const glides = glideMsForSegments(segments, totalMs);
		let ok = true;
		let worst = "";
		for (let i = 0; i < segments.length; i++) {
			// 区間 i の長さ = 境界 i から次の境界（最後はノート終端）まで。
			const atMs = segments[i].atSec * 1000;
			const nextMs =
				i + 1 < segments.length ? segments[i + 1].atSec * 1000 : totalMs;
			const own = glides[i] / 2;
			const next = (glides[i + 1] ?? 0) / 2;
			if (own + next > nextMs - atMs + 1e-9) {
				ok = false;
				worst = `区間${i}: ${(own + next).toFixed(1)}ms > ${(nextMs - atMs).toFixed(1)}ms`;
			}
			if (glides[i] <= 0) {
				ok = false;
				worst = `区間${i}: グライド長 ${glides[i]}`;
			}
		}
		check(ok, `${portamento ? "〜" : "ー"} [${lengths.join(",")}]`, worst);
	}
}

// ------------------------------------------------------------------
// 3. 曲線そのもの（NaN・レンジ超え・未達が無いか）
// ------------------------------------------------------------------
console.log("● ピッチ曲線（1msごとにサンプル）");
const PRE_MS = 90;
for (const lengths of OVERLAP_CASES) {
	for (const portamento of [false, true]) {
		const segments = unevenSegments(lengths.slice(1), portamento);
		const totalMs = lengths.reduce((a, b) => a + b, 0);
		const baseHz = unitsToHz(semi(0));
		const curve = pitchCurveFor(baseHz, segments, PRE_MS, false, totalMs);
		if (typeof curve !== "function") {
			check(false, "曲線が関数で返らない");
			continue;
		}
		const all = [baseHz, ...segments.map((s) => unitsToHz(s.pitch))];
		const lo = Math.min(...all);
		const hi = Math.max(...all);
		let bad = "";
		for (let t = 0; t <= PRE_MS + totalMs; t++) {
			const hz = curve(t);
			if (!Number.isFinite(hz)) {
				bad = `t=${t}ms で ${hz}`;
				break;
			}
			// 補間はセント直線なので、両端のピッチの外へ出たら重なり事故。
			if (hz < lo - 0.001 || hz > hi + 0.001) {
				bad = `t=${t}ms で ${hz.toFixed(1)}Hz（範囲 ${lo.toFixed(1)}〜${hi.toFixed(1)}）`;
				break;
			}
		}
		// 終端では最後の区間のピッチへ着いているべき。
		const endHz = curve(PRE_MS + totalMs);
		const wantHz = unitsToHz(segments[segments.length - 1].pitch);
		if (!bad && Math.abs(endHz - wantHz) > 0.01) {
			bad = `終端 ${endHz.toFixed(1)}Hz ≠ ${wantHz.toFixed(1)}Hz`;
		}
		check(!bad, `${portamento ? "〜" : "ー"} [${lengths.join(",")}]`, bad);
	}
}

// ------------------------------------------------------------------
// 4. 先行区間（子音・先行母音）ではピッチを動かさない
// ------------------------------------------------------------------
console.log("● 母音オンセット前");
{
	const segments = evenSegments([semi(5)], 500, true);
	const baseHz = unitsToHz(semi(0));
	const curve = pitchCurveFor(baseHz, segments, PRE_MS, false, 1000);
	const ok =
		typeof curve === "function" &&
		[0, 30, 60, PRE_MS].every((t) => Math.abs(curve(t) - baseHz) < 0.001);
	check(ok, "preMs までは先頭ピッチのまま（子音が音痴にならない）");
}

if (failed > 0) {
	console.log(`\n${failed}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log("\nすべて期待どおりです");
}
