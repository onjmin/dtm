/**
 * 再生専用プレイヤーまわりの3つの揃え直しを検算する。
 *
 * 1. **マスタリバーブ／ディレイ**（`#reverb=` `#reverbdecay=` `#reverbpredelay=` `#delay=`
 *    `#delaydiv=`）。エディタは読み込み時に反映するが、`studio.play` / `studio.mountPlayer` は
 *    読んでいなかったので、送り（`#t<n>rev=`）が効いているのに戻りが 0 で残響が鳴らなかった。
 *    再生側は `masterFxFromMeta` → `applyMasterFx` で流し込む。書かれていない項目は
 *    studio 生成時の既定値へ戻す（前の曲の値を持ち越さない）ことをここで確かめる。
 *    DAW の全体読み込みも同じ規則（`masterFxFromMeta` に DAW の初期値）で、書き出しは
 *    `masterFxToMeta`。リバーブ有りの曲のあとに無しの曲を読み込んで書き出しても
 *    `#reverb=` が付かないこと（前の曲の値が投稿に乗らないこと）を確かめる。
 * 2. **トラックごとの音源バンク**（`#t<n>font=`）。正式名・短縮名（大小文字無視）を受け、
 *    書き出しは短縮名、既定の FluidR3 は書かない。往復で消えないこと、宣言から音が
 *    生えないこと、配信元の一覧に無いときに FluidR3 へ落ちることを確かめる。
 * 3. **ドラム無し**（`#drum=none` と `#drum` 省略）。DAW の全体読み込みは両方を「なし」に
 *    する（既定のダンスを残さない）。書き出しは「なし」を `#drum=none` と明示する。
 *
 * DAW 本体（DOM・Canvas が要る）は Node で動かせないので、DAW が呼んでいる判定関数
 * （`drumPatternForFullLoad` / `trackSoundFontValue` / `masterFxFromMeta` / `masterFxToMeta`）と
 * 直列化（`formatMmlMeta`）を検算する。
 */

import Module from "node:module";

// `src/mml-parser.ts` は歌詞解析のために `src/lyrics.ts` を、その先で歌唱合成エンジン
// @onjmin/koe（ブラウザ専用）を読む。宣言の読み書きしか触らないので空のスタブへ。
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = (request, ...rest) =>
	request === "@onjmin/koe"
		? { VoiceBank: class {}, Worldline: class {}, leadInFromEntry: () => 0 }
		: load(request, ...rest);

const { formatMmlMeta, parseMML, parseMmlMeta } =
	require("../src/mml-parser") as typeof import("../src/mml-parser");
const {
	applyMasterFx,
	masterDynamicsFromMeta,
	masterFxFromMeta,
	masterFxToMeta,
} = require("../src/master-fx") as typeof import("../src/master-fx");
const {
	DEFAULT_SOUNDFONT_BANK,
	normalizeSoundFontBank,
	resolveSoundFontFile,
	soundFontBankShortName,
	trackSoundFontValue,
} =
	require("../src/soundfont-banks") as typeof import("../src/soundfont-banks");
const { DRUM_PATTERNS, drumPatternForFullLoad, NO_DRUM_PATTERN } =
	require("../src/drum-config") as typeof import("../src/drum-config");
type MasterFxSettings = import("../src/master-fx").MasterFxSettings;
type MasterDynamics = import("../src/master-fx").MasterDynamics;
type MasterFxTarget = import("../src/master-fx").MasterFxTarget;

let failed = 0;
const check = (label: string, got: unknown, expect: unknown): void => {
	const a = JSON.stringify(got);
	const b = JSON.stringify(expect);
	const ok = a === b;
	if (!ok) failed++;
	console.log(`  ${ok ? "OK  " : "NG  "}${label}`);
	if (!ok) {
		console.log(`        実際: ${a}`);
		console.log(`        期待: ${b}`);
	}
};

/** 発音を「トラック:開始/音高/長さ」の一覧へ畳む（宣言から音が生えていないかの比較用）。 */
const shape = (mml: string): string[] =>
	parseMML(mml).placements.map(
		(p) => `${p.trackIndex}:${p.startStep}/${p.pitchUnits}/${p.durationSteps}`,
	);

const BODY = "@0 t150 o5 l8 cdefgab>c;\n@2 o3 c2 g2;\n#end;";
// 比較の相手が空だと「音が生えない」が素通りで通ってしまうので、先に本文が読めていることを見る。
check("本文の音が読めている（比較の前提）", shape(BODY).length, 10);

// ── 1. マスタリバーブ／ディレイ ──
console.log("■ #reverb= / #delay= の読み書き");
{
	const header =
		"#reverb=35 #reverbdecay=28 #reverbpredelay=40 #delay=20 #delaydiv=8d;";
	const meta = parseMmlMeta(header);
	check(
		"5つとも読める（decay は 0.1 秒単位の整数のまま）",
		[
			meta.reverb,
			meta.reverbDecay,
			meta.reverbPreDelay,
			meta.delay,
			meta.delayDivision,
		],
		[35, 28, 40, 20, "8d"],
	);
	check(
		"書き戻すと同じ宣言になる",
		formatMmlMeta(meta, " "),
		header.slice(0, -1),
	);
	check(
		"範囲外は丸める（reverb 0-100 / decay 3-40 / predelay 0-150）",
		(() => {
			const m = parseMmlMeta("#reverb=250 #reverbdecay=1 #reverbpredelay=999;");
			return [m.reverb, m.reverbDecay, m.reverbPreDelay];
		})(),
		[100, 3, 150],
	);
	check("宣言から音が生えない", shape(header + BODY), shape(BODY));
}

console.log("■ 再生時のマスタエフェクト（持ち越さない）");
{
	const defaults: MasterFxSettings = {
		reverbAmount: 0,
		reverbDecaySec: 2.2,
		reverbPreDelayMs: 0,
		delayAmount: 0,
		delayDivision: "8",
	};
	check(
		"曲の指定がそのまま入る（decay は秒へ）",
		masterFxFromMeta(
			parseMmlMeta(
				"#reverb=35 #reverbdecay=28 #reverbpredelay=40 #delay=20 #delaydiv=16",
			),
			defaults,
		),
		{
			reverbAmount: 35,
			reverbDecaySec: 2.8,
			reverbPreDelayMs: 40,
			delayAmount: 20,
			delayDivision: "16",
		},
	);
	check(
		"何も書いていない曲は既定値",
		masterFxFromMeta(parseMmlMeta(BODY), defaults),
		defaults,
	);
	check(
		"studio 生成時の既定値（reverbAmount 等のオプション）が既定になる",
		masterFxFromMeta({}, { ...defaults, reverbAmount: 12 }).reverbAmount,
		12,
	);

	// 共有のリバーブ／ディレイに、曲A→曲Bの順で流し込む。Bに書かれていない項目が
	// Aの値のまま残らないこと（チャンネルストリップの持ち越しと同じ種類の不具合）。
	const state: Record<string, unknown> = {};
	const target: MasterFxTarget = {
		setReverbAmount: (v) => {
			state.reverbAmount = v;
		},
		setReverbDecay: (v) => {
			state.reverbDecaySec = v;
		},
		setReverbPreDelay: (v) => {
			state.reverbPreDelayMs = v;
		},
		setDelayAmount: (v) => {
			state.delayAmount = v;
		},
		setDelayDivision: (v) => {
			state.delayDivision = v;
		},
		setDelayBpm: (v) => {
			state.bpm = v;
		},
	};
	applyMasterFx(
		target,
		masterFxFromMeta(
			parseMmlMeta("#reverb=60 #reverbdecay=35 #delay=30 #delaydiv=4"),
			defaults,
		),
		90,
	);
	check("曲A: 指定どおり", state, {
		reverbAmount: 60,
		reverbDecaySec: 3.5,
		reverbPreDelayMs: 0,
		delayAmount: 30,
		delayDivision: "4",
		bpm: 90,
	});
	applyMasterFx(target, masterFxFromMeta(parseMmlMeta(BODY), defaults), 150);
	check("曲B（指定なし）: 曲Aの値を持ち越さず既定へ戻る", state, {
		reverbAmount: 0,
		reverbDecaySec: 2.2,
		reverbPreDelayMs: 0,
		delayAmount: 0,
		delayDivision: "8",
		bpm: 150,
	});
}

console.log("■ DAW の全体読み込み → 書き出し（持ち越さない）");
{
	// DAW の初期値（DawOptions の reverbAmount 等を省略したとき）。
	const dawDefaults: MasterFxSettings = {
		reverbAmount: 0,
		reverbDecaySec: 2.2,
		reverbPreDelayMs: 0,
		delayAmount: 0,
		delayDivision: "8",
	};
	// DAW の全体読み込みは masterFxFromMeta(meta, DAW の初期値) でスライダーを決め、
	// 書き出しは masterFxToMeta(今の値) を formatMmlMeta へ渡す。
	const fullLoad = (mml: string): MasterFxSettings =>
		masterFxFromMeta(parseMML(mml).meta, dawDefaults);
	const exportHeader = (fx: MasterFxSettings): string =>
		formatMmlMeta(masterFxToMeta(fx), " ");

	const withFx = `#reverb=60 #reverbdecay=35 #reverbpredelay=40 #delay=30 #delaydiv=4;\n${BODY}`;
	const afterA = fullLoad(withFx);
	check(
		"曲A（リバーブ有り）: 書き出しに同じ宣言が出る",
		exportHeader(afterA),
		"#reverb=60 #reverbdecay=35 #reverbpredelay=40 #delay=30 #delaydiv=4",
	);
	// 曲A のあとに曲B（リバーブ無し。0 は書き出しで省かれるので宣言が無い）を全体読み込み。
	// 読み込みは前の値（afterA）を参照しない＝書かれていない項目は初期値に戻る。
	const afterB = fullLoad(BODY);
	check("曲B（リバーブ無し）: 読み込み後は DAW の初期値", afterB, dawDefaults);
	check(
		"曲B（リバーブ無し）: 書き出しに #reverb / #delay が出ない",
		exportHeader(afterB),
		"",
	);
	check(
		"曲B は再生専用プレイヤーと同じ値で鳴る（既定が同じなら）",
		afterB,
		masterFxFromMeta(parseMmlMeta(BODY), dawDefaults),
	);
	check(
		"一部だけ書かれた曲: 書かれていない項目は初期値（前の曲の decay 3.5 を残さない）",
		fullLoad(`#reverb=25;\n${BODY}`),
		{ ...dawDefaults, reverbAmount: 25 },
	);
	check(
		"書き出し → 読み込み → 書き出しで変わらない",
		exportHeader(fullLoad(`${exportHeader(afterA)};\n${BODY}`)),
		exportHeader(afterA),
	);
	check(
		"decay は 0.1 秒単位へ丸めて書く",
		masterFxToMeta({ ...dawDefaults, reverbDecaySec: 2.84 }).reverbDecay,
		28,
	);
}

console.log(
	"■ DAW の全体読み込み: グルーコンプとフェード（持ち越さない。accomp-compose.md §9.5）",
);
{
	// DAW の初期値（DawOptions の masterCompression / fadeInSec / fadeOutSec を省略したとき）。
	const dawDefaults: MasterDynamics = {
		masterCompression: 0,
		fadeInSec: 0,
		fadeOutSec: 0,
	};
	const fullLoad = (mml: string): MasterDynamics =>
		masterDynamicsFromMeta(parseMML(mml).meta, dawDefaults);
	check(
		"曲の指定がそのまま入る（フェードは 0.1 秒単位 → 秒）",
		fullLoad(`#mastercomp=25 #fadein=5 #fadeout=15;\n${BODY}`),
		{ masterCompression: 25, fadeInSec: 0.5, fadeOutSec: 1.5 },
	);
	// 「おまかせ」の後（コンプ 25・フェードアウト 1.5 秒）に、0 を省いて書き出された曲を読み込む。
	// 読み込みは前の値を参照しない＝書かれていない項目は初期値に戻る。
	const exported = formatMmlMeta(
		{ masterCompression: 0, fadeIn: 0, fadeOut: 0, loop: true },
		" ",
	);
	check("0 は書き出しで省かれる（前提）", exported, "#loop=on");
	check(
		"何も書いていない曲は DAW の初期値（前の曲のコンプ・フェードを残さない）",
		fullLoad(`${exported};\n${BODY}`),
		dawDefaults,
	);
	check(
		"一部だけ書かれた曲: 書かれていない項目は初期値",
		fullLoad(`#fadeout=20;\n${BODY}`),
		{ ...dawDefaults, fadeOutSec: 2 },
	);
	check(
		"DAW の初期値（オプション）が既定になる",
		masterDynamicsFromMeta({}, { ...dawDefaults, masterCompression: 10 }),
		{ ...dawDefaults, masterCompression: 10 },
	);
}

console.log("■ #loop=on（DAW の書き出しは宣言の行の途中に置く）");
{
	// 再生専用プレイヤーは単独の `#loop=on` 行に加えて parseMML の meta.loop も読む（mml-player.ts）。
	// DAW の書き出しと accompToMml の書き方の両方で meta.loop が立つことを確かめる。
	check(
		"宣言の行の途中（DAW の書き出し）",
		parseMML(`#inst=retro_game #drum=none #loop=on #reverb=50;\n${BODY}`).meta
			.loop,
		true,
	);
	check(
		"単独の行（accompToMml）",
		parseMML(`#loop=on\n#inst=retro_game;\n${BODY}`).meta.loop,
		true,
	);
	check("#loop=off", parseMML(`#loop=off;\n${BODY}`).meta.loop, false);
	check("書かれていなければ未指定", parseMML(BODY).meta.loop, undefined);
	check(
		"宣言から音が生えない",
		shape(`#inst=retro_game #loop=on;\n${BODY}`),
		shape(BODY),
	);
}

// ── 2. 音源バンク ──
console.log("■ #t<n>font= の正規化");
check(
	"短縮名・正式名・大小文字違いを正式名へ",
	[
		"GeneralUserGS",
		"generaluserGS",
		"GeneralUserGS_sf2_file",
		"aspirin",
		"SoundBlasterOld",
		"jclive",
		"CHAOS",
		"SBLive",
		"fluidr3",
	].map((v) => normalizeSoundFontBank(v)),
	[
		"GeneralUserGS_sf2_file",
		"GeneralUserGS_sf2_file",
		"GeneralUserGS_sf2_file",
		"Aspirin_sf2_file",
		"SoundBlasterOld_sf2",
		"JCLive_sf2_file",
		"Chaos_sf2_file",
		"SBLive_sf2",
		DEFAULT_SOUNDFONT_BANK,
	],
);
check(
	"一覧に無いが名前として正しいものは保持（読み込み時に判断）",
	normalizeSoundFontBank("LesPaul_sf2_file"),
	"LesPaul_sf2_file",
);
check(
	"空・パスを含むものは受けない（URL の外へ出さない）",
	["", "  ", "../x", "a/b", "x.js", "a?b"].map((v) =>
		normalizeSoundFontBank(v),
	),
	[undefined, undefined, undefined, undefined, undefined, undefined],
);
check(
	"トラック設定の値: 既定・未指定は空文字",
	[
		trackSoundFontValue("FluidR3"),
		trackSoundFontValue(undefined),
		trackSoundFontValue("Chaos"),
	],
	["", "", "Chaos_sf2_file"],
);
check(
	"書き出しは短縮名",
	soundFontBankShortName("SoundBlasterOld_sf2"),
	"SoundBlasterOld",
);
check(
	"API から渡された不正な値・既定は書き出さない（本文に文字が漏れて音にならない）",
	formatMmlMeta({ trackFonts: { 0: "a/b", 1: "fluidr3", 2: "chaos" } }, " "),
	"#t2font=Chaos",
);

console.log("■ #t<n>font= の読み書き（往復）");
{
	const header =
		"#t0inst=Lead 1 (square) #t0font=GeneralUserGS #t1font=aspirin_sf2_file #t2font=FluidR3 #t3font=SBLive #t5font=LesPaul_sf2_file;";
	const meta = parseMmlMeta(header);
	check("正式名で読める（FluidR3 も明示なら残す）", meta.trackFonts, {
		0: "GeneralUserGS_sf2_file",
		1: "Aspirin_sf2_file",
		2: DEFAULT_SOUNDFONT_BANK,
		3: "SBLive_sf2",
		5: "LesPaul_sf2_file",
	});
	check("楽器名は font に食われない", meta.trackInstruments, {
		0: "Lead 1 (square)",
	});
	const out = formatMmlMeta(meta, " ");
	check(
		"書き出し: 短縮名・既定の FluidR3 は書かない",
		out,
		"#t0inst=Lead 1 (square) #t0font=GeneralUserGS #t1font=Aspirin #t3font=SBLive #t5font=LesPaul_sf2_file",
	);
	const again = parseMmlMeta(out);
	check(
		"読み戻しても同じバンク（FluidR3 は既定へ畳まれる）",
		again.trackFonts,
		{
			0: "GeneralUserGS_sf2_file",
			1: "Aspirin_sf2_file",
			3: "SBLive_sf2",
			5: "LesPaul_sf2_file",
		},
	);
	check(
		"2回目の書き出しは1回目と同じ（往復で変わらない）",
		formatMmlMeta(again, " "),
		out,
	);
	check("宣言から音が生えない", shape(header + BODY), shape(BODY));
	check(
		"1行（minify）でも剥がれる",
		shape(`${header}${BODY.replace(/\n/g, "")}`),
		shape(BODY),
	);
}

console.log("■ 音源バンクのファイル解決");
{
	// 配信元の一覧（list.txt）の一部を模したもの。
	const available = new Map<string, Set<string>>([
		["GeneralUserGS_sf2_file", new Set(["0330", "0331", "0332", "0000"])],
		["Aspirin_sf2_file", new Set(["0331", "0332"])],
		["Chaos_sf2_file", new Set(["0000"])],
	]);
	check(
		"既定バンクは楽器キーのまま",
		resolveSoundFontFile("0330", undefined, available),
		{ key: "0330", bank: DEFAULT_SOUNDFONT_BANK, fellBack: false },
	);
	check(
		"V=0 を優先",
		resolveSoundFontFile("0330", "GeneralUserGS", available),
		{ key: "0330", bank: "GeneralUserGS_sf2_file", fellBack: false },
	);
	check(
		"V=0 が無ければそのプログラムの最初のバリエーション",
		resolveSoundFontFile("0330", "Aspirin", available),
		{ key: "0331", bank: "Aspirin_sf2_file", fellBack: false },
	);
	check(
		"そのプログラムが無ければ FluidR3 へ落とす",
		resolveSoundFontFile("0330", "Chaos", available),
		{ key: "0330", bank: DEFAULT_SOUNDFONT_BANK, fellBack: true },
	);
	check(
		"一覧に無いバンクも FluidR3 へ落とす",
		resolveSoundFontFile("0330", "LesPaul_sf2_file", available),
		{ key: "0330", bank: DEFAULT_SOUNDFONT_BANK, fellBack: true },
	);
	check(
		"一覧を持たない（注入エンジン）ときは V=0 を仮定",
		resolveSoundFontFile("0330", "JCLive"),
		{ key: "0330", bank: "JCLive_sf2_file", fellBack: false },
	);
}

// ── 3. ドラム無し ──
console.log("■ #drum=none");
{
	check("#drum=none が読める", parseMmlMeta("#drum=none;").drum, "none");
	check(
		"書き出しは #drum=none と明示する",
		formatMmlMeta({ drum: NO_DRUM_PATTERN }, " "),
		"#drum=none",
	);
	check("宣言から音が生えない", shape(`#drum=none;${BODY}`), shape(BODY));

	const dict = DRUM_PATTERNS as Record<string, unknown>;
	check(
		"全体読み込み: #drum が無ければ「なし」",
		drumPatternForFullLoad(parseMmlMeta(BODY).drum, dict),
		"none",
	);
	check(
		"全体読み込み: #drum=none なら「なし」",
		drumPatternForFullLoad(parseMmlMeta(`#drum=none;${BODY}`).drum, dict),
		"none",
	);
	const known = Object.keys(DRUM_PATTERNS)[0];
	check(
		"全体読み込み: 辞書に在るパターンはそのまま",
		drumPatternForFullLoad(known, dict),
		known,
	);
	check(
		"全体読み込み: 辞書に無い名前は変えない（null）",
		drumPatternForFullLoad("no_such_pattern", dict),
		null,
	);
	check(
		"辞書に none という名前のパターンは無い（引いても鳴らない）",
		Object.hasOwn(DRUM_PATTERNS, NO_DRUM_PATTERN),
		false,
	);

	// DAW の書き出し → 読み込みの往復（DAW が formatMmlMeta に渡す値と、読み込みの判定）。
	const exported = formatMmlMeta(
		{ drum: NO_DRUM_PATTERN, trackFonts: { 1: "Chaos_sf2_file" } },
		" ",
	);
	const reloaded = parseMmlMeta(`${exported};${BODY}`);
	check(
		"DAW 往復: ドラム「なし」と音源バンクが残る",
		[
			drumPatternForFullLoad(reloaded.drum, dict),
			trackSoundFontValue(reloaded.trackFonts?.[1]),
			trackSoundFontValue(reloaded.trackFonts?.[0]),
		],
		["none", "Chaos_sf2_file", ""],
	);
}

if (failed > 0) {
	console.error(`\n✗ ${failed} 件失敗`);
	process.exit(1);
}
console.log("✓ マスタエフェクト・音源バンク・ドラム無し: すべて一致");
