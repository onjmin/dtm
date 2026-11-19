/**
 * 「音MAD化」（src/ui/otomadize.ts）の検算。
 *
 *   npx tsx scripts/test/check-otomadize.ts
 *
 * 1. カタログ整合: OTOMAD_PRESETS の全項目が SOUNDFONT_BANKS / NIJI_20171022_PRESETS /
 *    OTENKIAME_20200424_PRESETS / Inc に存在し、resolveSoundFontFile が fellBack=false で解決し、
 *    重複 ID・除外すべき SE / レスリング / キレテナーイを含まないこと。
 * 2. ジャンル・ソース絞り込み: inmu / cookie / both / auto × all / modern / niji / inc。
 * 3. 役割・ノートの置き方・GM 楽器の反映（ベース、持続パッド、短打、高音ベル、既 Inc トラック）。
 * 4. 得意音域への双方向オクターブ補正（上・下・ベースの低音維持・OFF 時の無補正）。
 * 5. 音量・3バンド EQ・定位・ボーカル/空トラック除外・activeOnly。
 * 6. 自動作曲（composeSong + buildAdvancedLayers）との結合。
 */
import assert from "node:assert/strict";
import { GM_INSTRUMENT_NAMES } from "../../src/audio/audio-config";
import { UNITS_PER_SEMITONE } from "../../src/audio/tuning";
import { buildAdvancedLayers } from "../../src/compose/advanced-layers";
import { composeSong, seededRandom } from "../../src/compose/compose";
import { INSTRUMENT_PRESETS } from "../../src/instruments/instrument-presets";
import {
	NIJI_20171022_PRESETS,
	OTENKIAME_20200424_PRESETS,
} from "../../src/instruments/rainbow-presets";
import {
	parseBankedFont,
	resolveSoundFontFile,
	SOUNDFONT_BANKS,
} from "../../src/instruments/soundfont-banks";
import {
	OTOMAD_PRESETS,
	type OtomadGenre,
	type OtomadizeOptions,
	type OtomadizeTrackInput,
	type OtomadSource,
	planOtomadize,
} from "../../src/ui/otomadize";

console.log("● otomadize tests");

const STEPS_PER_BAR = 192;
const u = (midi: number) => midi * UNITS_PER_SEMITONE;

const makeSeedRng = (seed: number): (() => number) => {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
};

// ---- 1. カタログ整合 ----
{
	const incInfo = SOUNDFONT_BANKS.find((b) => b.name === "Inc_sf2_file");
	assert.ok(incInfo?.named, "Inc_sf2_file が SOUNDFONT_BANKS に存在");
	const ids = new Set<string>();
	for (const p of OTOMAD_PRESETS) {
		assert.ok(!ids.has(p.id), `重複 ID なし: ${p.id}`);
		ids.add(p.id);
		assert.ok(p.sweetMin < p.sweetMax, `得意音域が妥当: ${p.id}`);
		assert.ok(p.roles.length > 0, `役割あり: ${p.id}`);
		assert.ok(
			p.family === "inmu" || p.family === "cookie",
			`ジャンルが淫夢/クッキー☆: ${p.id}`,
		);
		if (p.source === "inc") {
			assert.equal(p.font, "Inc_sf2_file");
			assert.ok(p.gmProgram !== undefined);
			const hit = incInfo.named.presets.find((x) => x.program === p.gmProgram);
			assert.ok(hit, `Inc プリセット実在: ${p.gmProgram}`);
			assert.ok(
				GM_INSTRUMENT_NAMES[p.gmProgram],
				`GM 楽器名が有効: ${p.gmProgram}`,
			);
			const key = `${String(p.gmProgram).padStart(3, "0")}0`;
			const resolved = resolveSoundFontFile(key, p.font);
			assert.equal(resolved.fellBack, false, `Inc 解決: ${p.id}`);
		} else {
			assert.equal(p.gmProgram, undefined, `レ淫棒は gmProgram なし: ${p.id}`);
			const parsed = parseBankedFont(p.font);
			assert.ok(parsed?.bank !== undefined && parsed.program !== undefined);
			const list =
				p.source === "niji"
					? NIJI_20171022_PRESETS
					: OTENKIAME_20200424_PRESETS;
			const found = list.find(
				(x) => x.bank === parsed.bank && x.program === parsed.program,
			);
			assert.ok(found, `rainbow-presets に実在: ${p.font}`);
			const resolved = resolveSoundFontFile("0000", p.font);
			assert.equal(resolved.fellBack, false, `レ淫棒解決: ${p.id}`);
			// 除外対象が入っていないこと
			assert.notEqual(p.font, "Niji_31_1", "セミ兄貴は除外");
			assert.notEqual(p.font, "Niji_125_0", "SPC_SE_0049は除外");
			assert.ok(!p.font.startsWith("Niji_126_"), "レスリングは除外");
			assert.ok(!p.font.startsWith("Otenkiame_96_"), "キレテナーイは除外");
		}
	}
	console.log(`  OK  カタログ整合 (${OTOMAD_PRESETS.length} 音色)`);
}

// テスト用の典型曲（メロディ・サブメロ・ベース・和音）
const buildSampleTracks = (): OtomadizeTrackInput[] => {
	const melody: OtomadizeTrackInput["notes"][number][] = [];
	const sub: OtomadizeTrackInput["notes"][number][] = [];
	const bass: OtomadizeTrackInput["notes"][number][] = [];
	const chord: OtomadizeTrackInput["notes"][number][] = [];
	for (let bar = 0; bar < 4; bar++) {
		const b = bar * STEPS_PER_BAR;
		for (let i = 0; i < 8; i++) {
			melody.push({
				pitchUnits: u(67 + (i % 4) * 2),
				startStep: b + i * 24,
				durationSteps: 22,
			});
		}
		sub.push({ pitchUnits: u(72), startStep: b, durationSteps: 90 });
		sub.push({ pitchUnits: u(74), startStep: b + 96, durationSteps: 90 });
		for (let i = 0; i < 4; i++) {
			bass.push({
				pitchUnits: u(i % 2 === 0 ? 36 : 43),
				startStep: b + i * 48,
				durationSteps: 42,
			});
		}
		for (const p of [60, 64, 67]) {
			chord.push({
				pitchUnits: u(p),
				startStep: b,
				durationSteps: 192,
			});
		}
	}
	return [
		{
			id: "melody",
			index: 0,
			name: "メロディー",
			notes: melody,
			declaredRole: "melody",
			currentInstrument: "Lead 1 (square)",
		},
		{
			id: "submelody",
			index: 1,
			name: "サブメロ",
			notes: sub,
			declaredRole: "submelody",
			currentInstrument: "Flute",
		},
		{
			id: "bass",
			index: 2,
			name: "ベース",
			notes: bass,
			declaredRole: "bass",
			currentInstrument: "Electric Bass (finger)",
		},
		{
			id: "chord",
			index: 3,
			name: "伴奏",
			notes: chord,
			declaredRole: "chord",
			currentInstrument: "Pad 2 (warm)",
		},
	];
};

// ---- 2. ジャンル・ソース絞り込み ----
{
	const tracks = buildSampleTracks();
	const genres: OtomadGenre[] = ["auto", "inmu", "cookie", "both"];
	const sources: OtomadSource[] = ["all", "modern", "niji", "inc"];
	for (const genre of genres) {
		for (const source of sources) {
			const res = planOtomadize(
				tracks,
				{
					genre,
					source,
					castPolicy: "balanced",
					adjustOctave: true,
					adjustMix: true,
					useCurrentInstrument: true,
					rng: makeSeedRng(123),
				},
				140,
			);
			assert.equal(res.tracks.length, 4, `${genre}/${source}: 4トラック`);
			for (const tp of res.tracks) {
				if (genre === "inmu") {
					assert.equal(
						tp.preset.family,
						"inmu",
						`${genre}/${source}: 淫夢のみ`,
					);
				} else if (genre === "cookie") {
					assert.equal(
						tp.preset.family,
						"cookie",
						`${genre}/${source}: クッキー☆のみ`,
					);
				}
				if (source === "modern") {
					assert.ok(
						tp.preset.source === "inc" || tp.preset.source === "otenkiame",
						`${genre}/${source}: modern 範囲`,
					);
				} else if (source === "niji") {
					assert.equal(tp.preset.source, "niji", `${genre}/${source}: niji`);
				} else if (source === "inc") {
					assert.equal(tp.preset.source, "inc", `${genre}/${source}: inc`);
				}
			}
			if (genre === "both") {
				const families = new Set(res.tracks.map((t) => t.preset.family));
				assert.ok(
					families.has("inmu") && families.has("cookie"),
					`both/${source}: 淫夢とクッキー☆が両方含まれる`,
				);
			}
		}
	}
	console.log("  OK  ジャンル × 音源ソース全16組合せ");
}

// ---- 3. 役割・ノートの置き方・GM 楽器の反映 ----
{
	// ベース音域が中音域に飛ばず低音色を受けること
	const tracks = buildSampleTracks();
	const res = planOtomadize(
		tracks,
		{
			genre: "auto",
			source: "all",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(42),
		},
		135,
	);
	const bassPlan = res.tracks.find((t) => t.trackId === "bass");
	assert.ok(bassPlan);
	assert.ok(
		bassPlan.preset.articulation === "bass_loop" ||
			bassPlan.preset.articulation === "bass_punch",
		`ベースに低音用プリセット: ${bassPlan.preset.id}`,
	);
	const bassEffMed = 39.5 + bassPlan.octave * 12;
	assert.ok(bassEffMed <= 54, `ベース実音域が低域内: ${bassEffMed}`);

	// 持続全音符パッドは looped=true を優先すること
	const chordPlan = res.tracks.find((t) => t.trackId === "chord");
	assert.ok(chordPlan);
	assert.equal(
		chordPlan.preset.looped,
		true,
		`持続和音にはループ付き音源: ${chordPlan.preset.id}`,
	);

	// 高音ベル (Music Box / C6) が bell / sparkle 系を優先すること
	const sparkleTrack: OtomadizeTrackInput = {
		id: "t4",
		index: 0,
		name: "装飾",
		notes: [0, 48, 96, 144].map((s) => ({
			pitchUnits: u(86),
			startStep: s,
			durationSteps: 24,
		})),
		composeSlot: "sparkle",
		currentInstrument: "Music Box",
	};
	const sparkleRes = planOtomadize(
		[sparkleTrack],
		{
			genre: "cookie",
			source: "modern",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(7),
		},
		150,
	);
	assert.equal(sparkleRes.tracks[0].subRole, "sparkle");
	assert.ok(
		sparkleRes.tracks[0].preset.roles.includes("sparkle"),
		`sparkle トラックは sparkle 対応音源: ${sparkleRes.tracks[0].preset.id}`,
	);

	// 既に Inc_sf2_file のトラックは GM 楽器（80..83）を音色ヒントにしないこと
	const alreadyIncBass: OtomadizeTrackInput = {
		id: "bass",
		index: 0,
		name: "ベース",
		notes: [0, 48, 96, 144].map((s) => ({
			pitchUnits: u(38),
			startStep: s,
			durationSteps: 44,
		})),
		declaredRole: "bass",
		currentFont: "Inc_sf2_file",
		currentInstrument: "Lead 4 (chiff)", // UDK = 81 だが GM ヒントとしては無視されるべき
	};
	const incReRun = planOtomadize(
		[alreadyIncBass],
		{
			genre: "inmu",
			source: "inc",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(1),
		},
		140,
	);
	assert.equal(incReRun.tracks[0].preset.id, "Inc:83");
	assert.equal(incReRun.tracks[0].gmInstrument, GM_INSTRUMENT_NAMES[83]);

	// useCurrentInstrument=false のときは GM 楽器ヒントがサブ役割判定にも効かないこと
	const pianoMelody: OtomadizeTrackInput = {
		id: "melody",
		index: 0,
		name: "メロディー",
		notes: [0, 48, 96, 144].map((s, i) => ({
			pitchUnits: u(67 + i),
			startStep: s,
			durationSteps: 28,
		})),
		declaredRole: "melody",
		currentInstrument: "Acoustic Grand Piano",
	};
	const withGm = planOtomadize(
		[pianoMelody],
		{
			genre: "cookie",
			source: "modern",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(5),
		},
		140,
	);
	const withoutGm = planOtomadize(
		[pianoMelody],
		{
			genre: "cookie",
			source: "modern",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: false,
			rng: makeSeedRng(5),
		},
		140,
	);
	assert.equal(withGm.tracks[0].subRole, "lead_pluck");
	assert.equal(withoutGm.tracks[0].subRole, "lead_sustain");
	console.log("  OK  役割・音価・GM楽器・Inc再実行ガード");
}

// ---- 4. 得意音域への双方向オクターブ補正 ----
{
	// 非常に高い旋律（MIDI 90..95）→ 下方向（-1 または -2）に補正される
	const highMelody: OtomadizeTrackInput = {
		id: "t0",
		index: 0,
		name: "高音メロ",
		notes: [0, 24, 48, 72].map((s, i) => ({
			pitchUnits: u(90 + (i % 3) * 2),
			startStep: s,
			durationSteps: 20,
		})),
		declaredRole: "melody",
		currentInstrument: "Lead 1 (square)",
	};
	const highRes = planOtomadize(
		[highMelody],
		{
			genre: "inmu",
			source: "modern",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(11),
		},
		140,
	);
	assert.ok(
		highRes.tracks[0].octave < 0,
		`超高音メロディが下方補正される: ${highRes.tracks[0].octave}`,
	);

	// 低い位置に書かれたメロディ（MIDI 48..53）→ 上方向（+1 または +2）に補正される
	const lowMelody: OtomadizeTrackInput = {
		id: "t0",
		index: 0,
		name: "低音位置メロ",
		notes: [0, 24, 48, 72].map((s, i) => ({
			pitchUnits: u(48 + (i % 4)),
			startStep: s,
			durationSteps: 20,
		})),
		declaredRole: "melody",
		currentInstrument: "Lead 1 (square)",
	};
	const lowRes = planOtomadize(
		[lowMelody],
		{
			genre: "cookie",
			source: "modern",
			castPolicy: "classic",
			adjustOctave: true,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(11),
		},
		140,
	);
	assert.ok(
		lowRes.tracks[0].octave > 0,
		`低域に置かれたメロディが上方補正される: ${lowRes.tracks[0].octave}`,
	);

	// adjustOctave=false なら常に 0
	const noShiftRes = planOtomadize(
		[highMelody, lowMelody],
		{
			genre: "both",
			source: "all",
			castPolicy: "balanced",
			adjustOctave: false,
			adjustMix: true,
			useCurrentInstrument: true,
			rng: makeSeedRng(11),
		},
		140,
	);
	assert.ok(noShiftRes.tracks.every((t) => t.octave === 0));
	console.log("  OK  双方向オクターブ補正（上・下・OFF）");
}

// ---- 5. 音量・EQ・定位・ボーカル/空トラック除外・activeOnly ----
{
	const tracks = buildSampleTracks();
	tracks.push({
		id: "t4",
		index: 4,
		name: "UTAU歌",
		notes: [{ pitchUnits: u(67), startStep: 0, durationSteps: 48 }],
		isVocal: true,
	});
	tracks.push({
		id: "t5",
		index: 5,
		name: "空トラック",
		notes: [],
	});

	const baseOpts: OtomadizeOptions = {
		genre: "both",
		source: "all",
		castPolicy: "balanced",
		adjustOctave: true,
		adjustMix: true,
		useCurrentInstrument: true,
		rng: makeSeedRng(99),
	};
	const res = planOtomadize(tracks, baseOpts, 150);
	assert.equal(res.tracks.length, 4, "ボーカル・空トラックは対象外");
	const mel = res.tracks.find((t) => t.trackId === "melody");
	const bas = res.tracks.find((t) => t.trackId === "bass");
	const chd = res.tracks.find((t) => t.trackId === "chord");
	assert.ok(mel && bas && chd);
	assert.ok(
		chd.volume < mel.volume,
		`和音音量(${chd.volume}) < 主旋律音量(${mel.volume})`,
	);
	assert.equal(bas.pan, 64);
	assert.equal(bas.width, 100);
	assert.ok(bas.eqLow > 0 && bas.eqMid < 0 && bas.eqHigh < 0);

	// activeOnly
	const activeRes = planOtomadize(
		tracks,
		{ ...baseOpts, activeOnly: true, activeTrackId: "submelody" },
		150,
	);
	assert.equal(activeRes.tracks.length, 1);
	assert.equal(activeRes.tracks[0].trackId, "submelody");
	console.log("  OK  音量・EQ・定位・ボーカル除外・activeOnly");
}

// ---- 6. 自動作曲（composeSong + buildAdvancedLayers）との結合 ----
{
	const song = composeSong({
		random: seededRandom(2),
		template: "kaiwai_2go_lead",
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		baseKey: "any",
		scale: "auto",
	});
	const preset =
		INSTRUMENT_PRESETS[song.instrument] ?? INSTRUMENT_PRESETS.piano;
	const layers = buildAdvancedLayers(song, {
		stepsPerBar: STEPS_PER_BAR,
		edo: 12,
		preset,
	});
	const inputs: OtomadizeTrackInput[] = layers.map((l) => ({
		id: `t${l.index}`,
		index: l.index,
		name: `トラック${l.index + 1}`,
		notes: l.notes,
		composeSlot: l.slot ?? null,
		currentInstrument: l.slot ? preset[l.slot] : preset.melody,
	}));
	for (const genre of ["auto", "inmu", "cookie", "both"] as OtomadGenre[]) {
		const res = planOtomadize(
			inputs,
			{
				genre,
				source: "all",
				castPolicy: "balanced",
				adjustOctave: true,
				adjustMix: true,
				useCurrentInstrument: true,
				rng: makeSeedRng(77),
			},
			song.bpm,
		);
		assert.ok(
			res.tracks.length >= 4,
			`compose(${genre}): 非空トラック割り当て`,
		);
		for (const tp of res.tracks) {
			assert.ok(tp.octave >= -2 && tp.octave <= 2);
			assert.ok(tp.volume >= 1 && tp.volume <= 127);
			assert.ok(tp.eqLow >= -12 && tp.eqLow <= 12);
			assert.ok(tp.eqMid >= -12 && tp.eqMid <= 12);
			assert.ok(tp.eqHigh >= -12 && tp.eqHigh <= 12);
		}
		if (genre === "both") {
			const fams = new Set(res.tracks.map((t) => t.preset.family));
			assert.ok(fams.has("inmu") && fams.has("cookie"));
		}
	}
	console.log("  OK  自動作曲（buildAdvancedLayers）との結合");
}

console.log("✓ otomadize: すべて一致");
