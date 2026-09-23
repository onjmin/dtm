/**
 * 単発の語り（`speak`）のチャンク配置のチェック。
 *
 *   npx tsx scripts/check-speech-schedule.ts
 *
 * 語りは計画が先に出来て、音はチャンクごとに後から届く。`awaitRender: false` のまま
 * 計画が出来た時点で時刻を決めると、最初のチャンクが間に合わず**頭が欠けた**
 * （置き場所を過ぎたぶんを飛ばして途中から鳴らしていた）。そこで
 *
 * 1. `awaitRender: "first-chunk"` … 最初のチャンクが出来てから時刻を決める。
 * 2. `lateChunks: "shift"` … 遅れて届いたチャンクは飛ばさず、時間軸ごと後ろへずらす
 *    （koe のデモと同じ）。`"first-chunk"` の既定。
 *
 * を足した。ここでは音を出さずに決められる時刻の計算（src/speech-schedule.ts）を、
 * チャンクの到着時刻を偽って確かめる。
 *
 * - shift: 先頭余白（先行発声）ぶん今より前にはみ出す最初のチャンクも頭から鳴る
 *   （startTime＝最初のモーラの時刻が後ろへずれる）。
 * - shift: 遅れたチャンクは途中から鳴らさず（offset 0）、後続も同じだけずれ、
 *   終わりの見込み（ended のタイマー）も延びる。
 * - skip: 従来どおり時刻は動かさず、過ぎたぶんを飛ばす（MML の語り・従来の既定）。
 * - position(): 合成待ちの間は進まず、単調に増え、ずれた後続のモーラは実際に鳴る時刻に届く。
 */
import {
	createSpeechScheduler,
	resolveLateChunks,
	SPEECH_MIN_LEAD_SEC,
	SPEECH_SHIFT_LEAD_SEC,
	type SpeechLateChunks,
	skipPlacement,
} from "../src/speech-schedule";

let failed = 0;
let total = 0;
const EPS = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const check = (ok: boolean, label: string, detail = ""): void => {
	total++;
	if (!ok) failed++;
	console.log(
		`  ${ok ? "ok  " : "NG  "}${label}${detail ? `  (${detail})` : ""}`,
	);
};
const f = (x: number): string => x.toFixed(3);

/**
 * 偽の語り: 先頭余白 0.08 秒（最初のチャンクはタイムライン 0 より前から始まる）、
 * 3 チャンク（継ぎ目は 20ms 重なる）、語りの長さ 2.1 秒。
 */
const LEADING = 0.08;
const CHUNKS = [
	{ startSec: -LEADING, durationSec: 0.6 }, // -0.08 .. 0.52
	{ startSec: 0.5, durationSec: 0.9 }, //       0.50 .. 1.40
	{ startSec: 1.4, durationSec: 0.8 }, //       1.40 .. 2.20
];
const DURATION = 2.1;

/** speak を呼んだ時刻 `now` から t0 を決める（lyrics.ts の model.speak と同じ式）。 */
const scheduler = (now: number, lateChunks: SpeechLateChunks, at = 0) =>
	createSpeechScheduler({
		t0: Math.max(now + 0.05, at),
		durationSec: DURATION,
		lateChunks,
	});

console.log("● 既定の lateChunks");
{
	check(
		resolveLateChunks("first-chunk") === "shift",
		'awaitRender: "first-chunk" → shift',
	);
	check(
		resolveLateChunks(false) === "skip",
		"awaitRender: false → skip（従来どおり）",
	);
	check(
		resolveLateChunks(undefined) === "skip",
		"awaitRender 省略 → skip（従来どおり）",
	);
	check(
		resolveLateChunks(true) === "skip",
		"awaitRender: true → skip（従来どおり）",
	);
	check(
		resolveLateChunks("first-chunk", "skip") === "skip" &&
			resolveLateChunks(false, "shift") === "shift",
		"明示した lateChunks が優先",
	);
}

console.log('● "first-chunk" + shift: 全チャンクが間に合う');
{
	// 最初のチャンクが出来た時点（now=10.0）で speak が時刻を決める。
	const s = scheduler(10.0, "shift");
	const p0 = s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.0);
	check(
		p0 !== null && p0.offset === 0,
		"最初のチャンクは頭から鳴る（offset 0）",
	);
	check(
		p0 !== null && p0.at >= 10.0 + SPEECH_MIN_LEAD_SEC - EPS,
		"最初のチャンクは今より先に置く",
		`at=${f(p0?.at ?? Number.NaN)}`,
	);
	// 先頭余白 0.08 > 猶予 0.05 なので、時間軸ごと後ろへずれて最初のモーラは 10.11。
	check(
		near(s.startTime, 10.0 + SPEECH_SHIFT_LEAD_SEC + LEADING),
		"startTime は最初のモーラの実際の時刻（先頭余白のぶん後ろ）",
		`startTime=${f(s.startTime)}`,
	);
	check(
		p0 !== null && near(p0.at + LEADING, s.startTime),
		"最初のチャンクの頭から先頭余白だけ後が startTime",
	);
	check(
		near(s.shiftSec, 0),
		"最初のチャンクで決まったずれは shiftSec に数えない",
	);
	const p1 = s.place(CHUNKS[1].startSec, CHUNKS[1].durationSec, 10.3);
	const p2 = s.place(CHUNKS[2].startSec, CHUNKS[2].durationSec, 11.0);
	check(
		p1 !== null &&
			p2 !== null &&
			near(p1.at, s.startTime + 0.5) &&
			near(p2.at, s.startTime + 1.4),
		"間に合った後続は計画どおりの位置",
	);
	check(near(s.shiftSec, 0), "ずれは無い");
	check(near(s.endTime, s.startTime + DURATION), "終わりは startTime + 長さ");
}

console.log('● "first-chunk" + shift: 2 つ目のチャンクが遅れる');
{
	const s = scheduler(10.0, "shift");
	s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.0);
	const startTime = s.startTime; // 10.11
	const endBefore = s.endTime;
	// 2 つ目は startTime+0.5 = 10.61 に鳴るはずが、10.7 に届いた。
	const p1 = s.place(CHUNKS[1].startSec, CHUNKS[1].durationSec, 10.7);
	check(p1 !== null && p1.offset === 0, "遅れたチャンクも飛ばさず頭から鳴らす");
	check(
		p1 !== null && near(p1.at, 10.7 + SPEECH_SHIFT_LEAD_SEC),
		"遅れたチャンクは今の少し先へ置く",
		`at=${f(p1?.at ?? Number.NaN)}`,
	);
	check(near(s.startTime, startTime), "startTime（最初のモーラ）は動かない");
	const shift = 10.7 + SPEECH_SHIFT_LEAD_SEC - (startTime + 0.5);
	check(
		near(s.shiftSec, shift),
		"ずれた量が shiftSec に出る",
		`shiftSec=${f(s.shiftSec)}`,
	);
	check(
		near(s.endTime, endBefore + shift),
		"終わりの見込み（ended のタイマー）も同じだけ延びる",
	);
	const p2 = s.place(CHUNKS[2].startSec, CHUNKS[2].durationSec, 11.2);
	check(
		p1 !== null && p2 !== null && near(p2.at - p1.at, 1.4 - 0.5),
		"後続も同じだけずれ、チャンク同士の間隔は計画どおり",
	);
	check(
		p2 !== null && near(p2.at, startTime + s.shiftSec + 1.4),
		"まだ鳴っていないモーラは startTime + shiftSec + startSec に鳴る",
	);
}

console.log("● skip（従来の既定・MML の語り）: 遅れたぶんを飛ばす");
{
	// 計画が出来た時点（now=10.0）で時刻を決め、最初のチャンクは 10.3 に届いた。
	const s = scheduler(10.0, "skip");
	const p0 = s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.3);
	check(
		p0 !== null &&
			near(p0.offset, 10.3 + SPEECH_MIN_LEAD_SEC - (10.05 - LEADING)),
		"最初のチャンクは過ぎたぶんを飛ばして途中から（頭が欠ける＝従来の挙動）",
		`offset=${f(p0?.offset ?? Number.NaN)}`,
	);
	check(near(s.startTime, 10.05), "startTime は動かない");
	const p1 = s.place(CHUNKS[1].startSec, CHUNKS[1].durationSec, 10.7);
	check(p1 !== null && p1.offset > 0, "遅れた後続も途中から");
	check(
		near(s.shiftSec, 0) && near(s.endTime, 10.05 + DURATION),
		"ずれず、終わりも動かない",
	);
	check(
		s.place(CHUNKS[2].startSec, CHUNKS[2].durationSec, 13.0) === null,
		"丸ごと過ぎたチャンクは鳴らさない",
	);
	// scheduleSpeech（MML）の置き方そのもの。
	const q = skipPlacement(5.0, 1.0, 4.0);
	check(
		q !== null && q.at === 5.0 && q.offset === 0,
		"間に合えば計画どおり（skipPlacement）",
	);
}

console.log("● awaitRender: false + shift: 最初のチャンクで時間軸が決まる");
{
	const s = scheduler(10.0, "shift");
	check(near(s.startTime, 10.05), "チャンクが届くまで startTime は見込み");
	s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.3);
	check(
		near(s.startTime, 10.3 + SPEECH_SHIFT_LEAD_SEC + LEADING),
		"最初のチャンクが届いた時点で startTime が確定（頭は欠けない）",
		`startTime=${f(s.startTime)}`,
	);
	check(near(s.shiftSec, 0), "最初のチャンクまでの遅れは shiftSec に数えない");
}

console.log("● at に余裕があれば、その時刻ちょうどに最初のモーラ");
{
	const s = scheduler(10.0, "shift", 11.0);
	const p0 = s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.0);
	check(
		near(s.startTime, 11.0) && p0 !== null && near(p0.at, 11.0 - LEADING),
		"startTime === at、先頭余白はその前から鳴る",
	);
}

console.log("● position(): 字幕送り・口パク用の再生位置");
{
	const s = scheduler(10.0, "shift");
	s.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.0); // 10.03 から鳴る、startTime 10.11
	check(s.position(10.0, false) < 0, "鳴る前は負");
	check(s.position(10.05, false) < 0, "先頭余白（最初の子音）の間も負");
	check(near(s.position(10.11, false), 0), "最初のモーラで 0");
	check(near(s.position(10.5, false), 0.39), "鳴っている間は時計どおり進む");
	// 2 つ目が遅れている: 1 つ目の音の終わり（0.52）で止まる。
	check(
		near(s.position(10.66, false), 0.52),
		"次のチャンクを待つ間は、鳴っている音の終わりで止まる",
	);
	s.place(CHUNKS[1].startSec, CHUNKS[1].durationSec, 10.7); // 10.73 から、0.5 の位置を鳴らす
	check(
		near(s.position(10.71, false), 0.52),
		"後ろへずれた次のチャンクを待つ間も戻らない（単調）",
	);
	check(near(s.position(10.73, false), 0.52), "鳴り出しの瞬間も戻らない");
	const mora = 0.55; // 2 つ目のチャンクの中のモーラ
	const heardAt = s.startTime + s.shiftSec + mora; // 10.78
	check(
		s.position(heardAt - 0.01, false) < mora &&
			s.position(heardAt + 0.001, false) >= mora,
		"ずれた後のモーラは、実際に鳴る時刻に position が届く",
		`heardAt=${f(heardAt)}`,
	);
	check(
		near(s.position(10.8, false), 0.57),
		"ずれた後続が鳴り出すと、そこから進む",
	);
	s.place(CHUNKS[2].startSec, CHUNKS[2].durationSec, 11.2);
	check(
		near(s.position(12.0, true), 12.0 - s.anchor),
		"合成が終われば止めずに進む",
	);

	// skip: 飛ばしたぶんは前へ跳ぶ（戻りはしない）。
	const k = scheduler(10.0, "skip");
	k.place(CHUNKS[0].startSec, CHUNKS[0].durationSec, 10.0);
	const before = k.position(10.6, false);
	k.place(CHUNKS[1].startSec, CHUNKS[1].durationSec, 10.7); // 0.5 の位置は 10.55 に過ぎている
	const after = k.position(10.72, false);
	check(
		after >= before && near(after, 10.72 - 10.05),
		"skip では飛ばした先の位置へ跳ぶ",
	);

	// チャンクが 1 つも無いまま合成を待つ間は 0 に届かない。
	const w = scheduler(10.0, "shift");
	check(
		w.position(10.5, false) < 0,
		"何も届いていなければ最初のモーラへ進まない",
	);
}

if (failed > 0) {
	console.log(`\n${failed}/${total}件が期待と違います`);
	process.exitCode = 1;
} else {
	console.log(`\n語りのチャンク配置: ${total}件すべて期待どおりです`);
}
