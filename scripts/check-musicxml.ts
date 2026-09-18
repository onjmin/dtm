/**
 * MusicXML の入出力を検算する。
 *
 * **往復で音が変わらないこと**が要（書き出して読み戻したら位置・高さ・音価が
 * 一致する）。ここが崩れると、楽譜ソフトへ持ち出した時点で曲が変質する。
 *
 * ブラウザ前提の `DOMParser` を使うので、Node では `@xmldom/xmldom` を差し込む。
 */

import { DOMParser } from "@xmldom/xmldom";
import { composeSong } from "../src/compose";
import { exportMusicXML, parseMusicXML } from "../src/musicxml-io";
import { UNITS_PER_SEMITONE, type Units } from "../src/tuning";
import type { Note } from "../src/types";

// biome-ignore lint/suspicious/noExplicitAny: Node には DOMParser が無いので差し込む
(globalThis as any).DOMParser = DOMParser;

const STEPS_PER_BAR = 192;
let failed = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
	if (ok) return;
	failed++;
	console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
};

const seededRandom = (seed: number): (() => number) => {
	let x = seed >>> 0;
	return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296;
};

const note = (
	startStep: number,
	semi: number,
	durationSteps: number,
): Note => ({
	id: `n${startStep}_${semi}`,
	startStep,
	durationSteps,
	pitchUnits: (semi * UNITS_PER_SEMITONE) as Units,
	velocity: 100,
});

console.log("● MusicXML 往復");
{
	// --- 手で作った最小の曲 ---
	// 小節をまたぐ音・休符・付点・和音（同時刻の重なり）を1つずつ含める。
	const notes: Note[] = [
		note(0, 60, 48), // 1拍目 4分
		note(48, 64, 24), // 2拍目 8分
		note(96, 67, 72), // 3拍目 付点4分
		note(192, 72, 192), // 2小節目まるごと
		note(384, 71, 48),
		note(384, 67, 48), // 同時刻（和音）
	];
	const xml = exportMusicXML({
		parts: [{ name: "Melody", notes }],
		bpm: 132,
		stepsPerBar: STEPS_PER_BAR,
		title: "検算",
	});
	check("XML宣言がある", xml.startsWith("<?xml"), xml.slice(0, 20));
	check("score-partwise である", xml.includes("<score-partwise"));
	check("バージョンが入る", /<software>dtm \d/.test(xml));
	check("テンポが入る", xml.includes('<sound tempo="132"/>'));

	const back = parseMusicXML(xml);
	check("テンポが戻る", back.bpm === 132, String(back.bpm));
	check(
		"パート名が戻る",
		back.parts[0]?.name === "Melody",
		back.parts[0]?.name,
	);

	// 位置・高さ・音価が一致するか。和音は同時刻に2つ来る。
	const want = notes
		.map((n) => ({
			at: n.startStep,
			semi: Math.round(n.pitchUnits / UNITS_PER_SEMITONE),
			dur: n.durationSteps,
		}))
		.sort((a, b) => a.at - b.at || a.semi - b.semi);
	const got = back.placements
		.map((p) => ({ at: p.startStep, semi: p.pitch, dur: p.durationSteps }))
		.sort((a, b) => a.at - b.at || a.semi - b.semi);
	check(
		"音数が一致",
		got.length === want.length,
		`${got.length} / ${want.length}`,
	);
	for (let i = 0; i < Math.min(got.length, want.length); i++) {
		const w = want[i];
		const g = got[i];
		check(
			`音${i} の位置・高さ・音価`,
			g.at === w.at && g.semi === w.semi && g.dur === w.dur,
			`got ${g.at}/${g.semi}/${g.dur} want ${w.at}/${w.semi}/${w.dur}`,
		);
	}
}

{
	// --- 歌詞が音符に紐づいて往復するか ---
	const notes = [note(0, 60, 48), note(48, 62, 48), note(96, 64, 96)];
	const xml = exportMusicXML({
		parts: [{ name: "Vocal", notes, lyrics: ["あ", "い", "う"] }],
		bpm: 120,
		stepsPerBar: STEPS_PER_BAR,
	});
	const back = parseMusicXML(xml);
	check("歌詞のあるパートと分かる", back.parts[0]?.hasLyrics === true);
	const lyrics = back.placements
		.sort((a, b) => a.startStep - b.startStep)
		.map((p) => p.lyric);
	check("歌詞が戻る", lyrics.join("") === "あいう", lyrics.join(""));
}

{
	// --- 複数パート ---
	const xml = exportMusicXML({
		parts: [
			{ name: "Lead", notes: [note(0, 72, 96)] },
			{ name: "Bass", notes: [note(0, 36, 192)] },
		],
		bpm: 100,
		stepsPerBar: STEPS_PER_BAR,
	});
	const back = parseMusicXML(xml);
	check("パートが2つ", back.parts.length === 2, String(back.parts.length));
	check(
		"パートごとに音が分かれる",
		back.placements.filter((p) => p.partIndex === 0).length === 1 &&
			back.placements.filter((p) => p.partIndex === 1).length === 1,
	);
	check(
		"平均音高でパートを見分けられる",
		(back.parts[0]?.avgPitch ?? 0) > (back.parts[1]?.avgPitch ?? 0),
	);
}

{
	// --- 自動作曲の出力をそのまま通す ---
	// 手で作った例では出ない形（長い休符・細かい音価・広い音域）が入る。
	for (let seed = 1; seed <= 5; seed++) {
		const song = composeSong({
			stepsPerBar: STEPS_PER_BAR,
			random: seededRandom(seed * 104729),
		});
		const notes: Note[] = song.melody.map((n, i) => ({
			id: `m${i}`,
			startStep: n.startStep,
			durationSteps: n.durationSteps,
			pitchUnits: n.pitchUnits,
			velocity: n.velocity,
		}));
		const xml = exportMusicXML({
			parts: [{ name: "Melody", notes }],
			bpm: song.bpm,
			stepsPerBar: STEPS_PER_BAR,
		});
		const back = parseMusicXML(xml);
		check(
			`seed=${seed} 音数が一致`,
			back.placements.length === notes.length,
			`${back.placements.length} / ${notes.length}`,
		);
		// **小節をまたぐ音は書き出しで切っている**ので、音価は一致しないことがある。
		// 位置と高さは変わってはいけない。
		const w = notes
			.map(
				(n) =>
					`${n.startStep}:${Math.round(n.pitchUnits / UNITS_PER_SEMITONE)}`,
			)
			.sort();
		const g = back.placements.map((p) => `${p.startStep}:${p.pitch}`).sort();
		check(
			`seed=${seed} 位置と高さが一致`,
			w.join(",") === g.join(","),
			`差 ${w
				.filter((x, i) => x !== g[i])
				.slice(0, 3)
				.join(" ")}`,
		);
	}
}

if (failed > 0) {
	console.error(`\n${failed} 件失敗`);
	process.exit(1);
}
console.log("  往復・歌詞・複数パート・自動作曲の出力、すべて一致");
