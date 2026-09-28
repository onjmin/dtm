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
 * DOM に依存しない（`scripts/check-fx-font-drum.ts` が Node で検算する）。
 */

/** 既定の音源バンク（これまで固定だったもの）。 */
export const DEFAULT_SOUNDFONT_BANK = "FluidR3_GM_sf2_file";

export type SoundFontBankInfo = {
	/** 配信元のファイル名に使われる正式名（例 `GeneralUserGS_sf2_file`）。 */
	name: string;
	/** MML に書く短縮名（例 `GeneralUserGS`）。書き出しはこちらを使う。 */
	short: string;
	/** 選択欄に出す名前。 */
	label: string;
};

/**
 * 選べる音源バンク。どれも GM 128 音色がバリエーション 0 で揃っている
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
];

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
