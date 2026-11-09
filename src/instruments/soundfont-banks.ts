/**
 * 旋律楽器の音源バンク（WebAudioFont の sf2 由来データ）。
 *
 * 楽器はずっと FluidR3 GM 固定だったので、同じ GM 楽器名でも質感を変えられなかった。
 * 配信元（https://surikov.github.io/webaudiofontdata/）には同じ GM 番号で鳴らせる
 * 別のバンクが並んでいるので、トラックごとに `#t<n>font=<バンク>` で選べるようにする。
 *
 * ファイル名は `PPPV_<バンク>.js`（PPP = GM プログラム3桁、V = バリエーション）。
 * 一覧は `sf2/list.txt`（{@link file://./sf/SoundFont_list.ts} が読む）。
 *
 * DOM に依存しない（`scripts/test/check-fx-font-drum.ts` が Node で検算する）。
 */

import {
	type BankedBank,
	type BankedPreset,
	NIJI_20171022_BANKS,
	NIJI_20171022_PRESETS,
	OTENKIAME_20200424_BANKS,
	OTENKIAME_20200424_PRESETS,
} from "./rainbow-presets";

/** 既定の音源バンク（これまで固定だったもの）。 */
export const DEFAULT_SOUNDFONT_BANK = "FluidR3_GM_sf2_file";

export type SoundFontBankInfo = {
	/** 配信元のファイル名に使われる正式名（例 `GeneralUserGS_sf2_file`）。 */
	name: string;
	/** MML に書く短縮名（例 `GeneralUserGS`）。書き出しはこちらを使う。 */
	short: string;
	/** 選択欄に出す名前。 */
	label: string;
	/**
	 * 配信元が surikov 以外のとき、`<PPPV>_<正式名>.js` を置いた場所（末尾 `/`）。
	 * script-src の CSP（scripts/misc/inject-csp.ts）が許す所に限る。
	 */
	baseUrl?: string;
	/**
	 * 持っている楽器（`PPPV`）。surikov の一覧（list.txt）に載らないバンクだけ書く。
	 * ここに無いプログラムは FluidR3 で鳴らす。
	 */
	programs?: readonly string[];
	/**
	 * キャラごとにバンクを分けた作り（レ淫棒）。GM の番号だけでは選べないので、
	 * トラックの値を `<名前>_<バンク>_<プログラム>`（例 `Niji_33_0`）にしてプリセットを決める。
	 * ファイルは `<バンク3桁><プログラム3桁>_<fileName>.js`。
	 */
	banked?: {
		fileName: string;
		/** バンクの名前（sf2 ごとの付け方）。 */
		banks: readonly BankedBank[];
		presets: readonly BankedPreset[];
	};
};

/** surikov の配信元（webaudiofontdata）の置き場所。 */
const SURIKOV_SOUND_URL = "https://surikov.github.io/webaudiofontdata/sound/";

/**
 * 選べる音源バンク。Inc 以外は、どれも GM 128 音色がバリエーション 0 で揃っている
 * （2026-09 時点の list.txt で確認）。
 */
export const SOUNDFONT_BANKS: readonly SoundFontBankInfo[] = [
	{
		name: DEFAULT_SOUNDFONT_BANK,
		short: "FluidR3",
		label: "FluidR3 GM（既定）",
	},
	{
		name: "GeneralUserGS_sf2_file",
		short: "GeneralUserGS",
		label: "GeneralUser GS",
	},
	{ name: "Aspirin_sf2_file", short: "Aspirin", label: "Aspirin" },
	{
		name: "SoundBlasterOld_sf2",
		short: "SoundBlasterOld",
		label: "Sound Blaster（旧）",
	},
	{ name: "JCLive_sf2_file", short: "JCLive", label: "JCLive" },
	{ name: "Chaos_sf2_file", short: "Chaos", label: "Chaos" },
	{ name: "SBLive_sf2", short: "SBLive", label: "SB Live!" },
	// 淫ク☆サウンドフォント（onjmin/inc-sf2）。淫夢・クッキー☆の声から作ったシンセ4音色だけで、
	// 80 YMN・81 UDK・82 野獣・83 MUR。作り方は docs/otomad/techniques/voice-instrument.md。
	{
		name: "Inc_sf2_file",
		short: "Inc",
		label: "淫ク☆（80〜83 番だけ）",
		baseUrl: "https://onjmin.github.io/inc-sf2/sound/",
		programs: ["0800", "0810", "0820", "0830"],
	},
	// レ淫棒サウンドフォント（ほかの作者のもの。onjmin/inc-sf2 の作者ごとのフォルダに元の配布のまま置き、
	// WebAudioFont に書き出した）。プリセットはバンクとプログラムで選ぶ（`Niji_33_0` など）。
	{
		name: "Niji",
		short: "Niji",
		label: "レ淫棒（虹.）",
		baseUrl: "https://onjmin.github.io/inc-sf2/niji/20171022/sound/",
		banked: {
			fileName: "Rainbow_20171022",
			banks: NIJI_20171022_BANKS,
			presets: NIJI_20171022_PRESETS,
		},
	},
	{
		name: "Otenkiame",
		short: "Otenkiame",
		label: "レ淫棒2020（お天気雨）",
		baseUrl: "https://onjmin.github.io/inc-sf2/otenkiame/20200424/sound/",
		banked: {
			fileName: "RaInBow_20200424",
			banks: OTENKIAME_20200424_BANKS,
			presets: OTENKIAME_20200424_PRESETS,
		},
	},
];

/**
 * キャラごとにバンクを分けた音源（{@link SoundFontBankInfo.banked}）の値を分ける。
 * `Niji`・`Niji_33`・`Niji_33_1`（音源・バンク・プログラム）。書かれていない所は undefined。
 * そういう音源でない・番号が範囲外なら null。
 */
export const parseBankedFont = (
	value: string | null | undefined,
): {
	info: SoundFontBankInfo;
	bank: number | undefined;
	program: number | undefined;
} | null => {
	const m = /^([A-Za-z]+)(?:_(\d{1,3})(?:_(\d{1,3}))?)?$/.exec(
		(value ?? "").trim(),
	);
	if (!m) return null;
	const info = SOUNDFONT_BANKS.find(
		(b) => b.banked && b.name.toLowerCase() === m[1].toLowerCase(),
	);
	if (!info) return null;
	const bank = m[2] === undefined ? undefined : Number(m[2]);
	const program = m[3] === undefined ? undefined : Number(m[3]);
	if ((bank ?? 0) > 127 || (program ?? 0) > 127) return null;
	return { info, bank, program };
};

/** キャラごとにバンクを分けた音源の値を作る（`Niji` / `Niji_33` / `Niji_33_1`）。 */
export const bankedFontValue = (
	info: SoundFontBankInfo,
	bank?: number,
	program?: number,
): string =>
	bank === undefined
		? info.name
		: program === undefined
			? `${info.name}_${bank}`
			: `${info.name}_${bank}_${program}`;

/**
 * 鳴らすプリセットを決める。いつもその音源が持っているものから選ぶ（GM の別の楽器や FluidR3 へは落とさない）。
 * - バンク: 書かれたもの。無い・持っていないなら、いちばん小さいバンク。
 * - プログラム: 書かれたもの。無いならトラックの楽器の番号（GM）。そのバンクに無ければ、そのバンクの最初のもの。
 */
export const resolveBankedPreset = (
	info: SoundFontBankInfo,
	bank: number | undefined,
	program: number | undefined,
	gmProgram: number,
): BankedPreset | undefined => {
	const presets = info.banked?.presets ?? [];
	const inBank = (b: number) => presets.filter((p) => p.bank === b);
	const b =
		bank !== undefined && inBank(bank).length > 0
			? bank
			: Math.min(...presets.map((p) => p.bank));
	const list = inBank(b);
	return (
		list.find((p) => p.program === (program ?? gmProgram)) ??
		list.find((p) => p.program === gmProgram) ??
		list[0]
	);
};

/**
 * 外部 SF2 の音源名（`ExtSF2`、バンクを決めるときは `ExtSF2_<バンク>`）。
 * バンクは .sf2 のプリセットのバンク番号（0〜127）。キャラごとにバンクを分けた .sf2
 * （レ淫棒など）で、GM の番号だけでは選べない楽器を選ぶのに使う。
 */
const EXTERNAL_SF2_PATTERN = /^extsf2(?:_(\d{1,3}))?$/i;

/** 外部 SF2 の音源名か（大小文字は問わない。バンクは 0〜127）。 */
export const isExternalSf2Bank = (bank: string | null | undefined): boolean =>
	externalSf2BankNumber(bank) !== null;

/**
 * 外部 SF2 の音源名からバンク番号を取り出す。バンクの指定が無い `ExtSF2` は undefined、
 * 外部 SF2 の音源名でない（バンクが範囲外も）ときは null。
 */
export const externalSf2BankNumber = (
	bank: string | null | undefined,
): number | undefined | null => {
	const m = EXTERNAL_SF2_PATTERN.exec((bank ?? "").trim());
	if (!m) return null;
	if (m[1] === undefined) return undefined;
	const n = Number(m[1]);
	return n <= 127 ? n : null;
};

/** 外部 SF2 の音源名を作る（バンクが無ければ `ExtSF2`）。 */
export const externalSf2BankValue = (bank?: number): string =>
	bank === undefined ? "ExtSF2" : `ExtSF2_${bank}`;

/**
 * 楽器のファイル名（拡張子なし。変数名は頭に `_tone_` を付けたもの）。
 * ふつうは `<PPPV>_<正式名>`、キャラごとにバンクを分けた音源は `<BBBPPP>_<fileName>`。
 */
export const soundFontFileName = (fileKey: string, bank: string): string => {
	const banked = parseBankedFont(bank)?.info.banked;
	return `${fileKey}_${banked ? banked.fileName : bank}`;
};

/** 楽器のファイル（`<PPPV>_<正式名>.js`）の URL。配信元はバンクごと（既定は surikov）。 */
export const soundFontFileUrl = (fileKey: string, bank: string): string => {
	const info =
		parseBankedFont(bank)?.info ?? SOUNDFONT_BANKS.find((b) => b.name === bank);
	return `${info?.baseUrl ?? SURIKOV_SOUND_URL}${soundFontFileName(fileKey, bank)}.js`;
};

/**
 * バンク名として受け付ける文字。値は配信元の URL
 * （`…/webaudiofontdata/sound/<PPPV>_<バンク>.js`）へそのまま入るので、`/` `.` `?` 等で
 * パスの外へ出られないよう英数・`_`・`-` に限る。
 */
const BANK_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * `#t<n>font=` の値を正式名へ正規化する。
 *
 * - 正式名・短縮名（大小文字無視）→ 正式名
 * - 一覧に無いが名前として正しいもの（`LesPaul_sf2_file` 等）→ そのまま
 *   （読み込み時に配信元の一覧に無ければ FluidR3 へ落とす）
 * - 空・名前として不正 → undefined
 */
export const normalizeSoundFontBank = (
	value: string | null | undefined,
): string | undefined => {
	const v = (value ?? "").trim();
	if (!v || !BANK_NAME_PATTERN.test(v)) return undefined;
	// 外部 SF2 は書き方をそろえる（`extsf2_33` → `ExtSF2_33`）。
	const ext = externalSf2BankNumber(v);
	if (ext !== null) return externalSf2BankValue(ext);
	const banked = parseBankedFont(v);
	if (banked) return bankedFontValue(banked.info, banked.bank, banked.program);
	const lower = v.toLowerCase();
	const known = SOUNDFONT_BANKS.find(
		(b) => b.name.toLowerCase() === lower || b.short.toLowerCase() === lower,
	);
	return known ? known.name : v;
};

/** 正式名 → MML に書く短縮名（一覧に無いバンクは受け取った名前のまま）。 */
export const soundFontBankShortName = (bank: string): string =>
	SOUNDFONT_BANKS.find((b) => b.name === bank)?.short ?? bank;

/**
 * トラック設定として持つ値（正式名）。既定（FluidR3）・未指定・名前として不正なものは空文字
 * （＝既定。DAW の選択欄の「既定」と同じ値）。
 */
export const trackSoundFontValue = (
	value: string | null | undefined,
): string => {
	const bank = normalizeSoundFontBank(value);
	return !bank || bank === DEFAULT_SOUNDFONT_BANK ? "" : bank;
};

export type SoundFontFile = {
	/** ファイル名の前半 `PPPV`。 */
	key: string;
	/** 実際に読むバンク（落としたときは FluidR3）。 */
	bank: string;
	/** 指定のバンクにそのプログラムが無く、FluidR3 へ落としたか。 */
	fellBack: boolean;
};

/**
 * 楽器キー（FluidR3 の `PPPV`、例 `0330`）と音源バンクから、実際に読むファイルを決める。
 *
 * - 既定バンク（未指定含む）→ 楽器キーのまま FluidR3。
 * - `available`（`SoundFont_list.tone`：バンク → `PPPV` の集合）があれば、
 *   同じプログラムの V=0 を優先し、無ければそのプログラムの最初のバリエーション。
 *   そのプログラム自体が無い（バンクごと無い場合も）なら FluidR3 へ落とす。
 * - `available` が無い（一覧を持たない注入エンジン）なら V=0 を仮定する
 *   （読み込みに失敗したら呼び出し側が FluidR3 へ落とす）。
 */
export const resolveSoundFontFile = (
	instrumentKey: string,
	bank: string | null | undefined,
	available?: ReadonlyMap<string, ReadonlySet<string>>,
): SoundFontFile => {
	const target = normalizeSoundFontBank(bank);
	if (!target || target === DEFAULT_SOUNDFONT_BANK) {
		return {
			key: instrumentKey,
			bank: DEFAULT_SOUNDFONT_BANK,
			fellBack: false,
		};
	}
	const program = instrumentKey.slice(0, 3);
	// 外部 SF2（`ExtSF2`・`ExtSF2_<バンク>`）は配信元の一覧に無い。プログラム番号だけ決め、
	// 無ければ読み込み側で落とす。
	if (isExternalSf2Bank(target))
		return { key: `${program}0`, bank: target, fellBack: false };
	// キャラごとにバンクを分けた音源（レ淫棒）は、その音源が持っているプリセットだけから選ぶ。
	const banked = parseBankedFont(target);
	if (banked) {
		const hit = resolveBankedPreset(
			banked.info,
			banked.bank,
			banked.program,
			Number(program),
		);
		if (hit)
			return {
				key: `${String(hit.bank).padStart(3, "0")}${String(hit.program).padStart(3, "0")}`,
				bank: target,
				fellBack: false,
			};
		return { key: instrumentKey, bank: DEFAULT_SOUNDFONT_BANK, fellBack: true };
	}
	// surikov の一覧に載らないバンク（Inc）は、自分で持っている楽器の一覧で決める。
	const own = SOUNDFONT_BANKS.find((b) => b.name === target)?.programs;
	if (own) {
		const hit = own.includes(`${program}0`)
			? `${program}0`
			: own.filter((id) => id.startsWith(program)).sort()[0];
		return hit
			? { key: hit, bank: target, fellBack: false }
			: { key: instrumentKey, bank: DEFAULT_SOUNDFONT_BANK, fellBack: true };
	}
	if (!available) return { key: `${program}0`, bank: target, fellBack: false };
	const ids = available.get(target);
	if (ids?.has(`${program}0`)) {
		return { key: `${program}0`, bank: target, fellBack: false };
	}
	const first = [...(ids ?? [])]
		.filter((id) => id.length === 4 && id.startsWith(program))
		.sort()[0];
	if (first) return { key: first, bank: target, fellBack: false };
	return { key: instrumentKey, bank: DEFAULT_SOUNDFONT_BANK, fellBack: true };
};
