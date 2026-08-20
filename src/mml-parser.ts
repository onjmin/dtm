/**
 * MML文字列を解析し、トラックごとのノート配置へ復元するローダ。
 *
 * 旧来 demo/index.html の `loadMML` をライブラリへ移植・整理したもの。
 * 実際のノート追加（MMLCore への反映）は呼び出し側で行う。
 *
 * 歌詞専用行（@@n model lyrics）は演奏ノートではないため常に取り除く。
 * `collectLyrics` 指定時は解析済みの歌詞トラック辞書も併せて返す。
 */

import { parseLyrics, stripCustomVocals, stripLyrics } from "./lyrics";
import type { LyricTrack } from "./types";
import { DEFAULT_STEPS_PER_BAR, MML_END_MARKER } from "./types";

const PITCH_MAP: Record<string, number> = {
	c: 0,
	d: 2,
	e: 4,
	f: 5,
	g: 7,
	a: 9,
	b: 11,
};

/**
 * 値を [lo, hi] にクリップする。範囲外の値でプレイヤーが暴走しないための保険。
 * 各コマンドの値の範囲（MIDI/一般的なMML準拠）:
 *   t テンポ 1-255、o オクターブ 0-8、l 音長 1-64。
 * 値を省略した場合のフォールバックは本アプリ慣習（o4 / 16分グリッド l16）に従う。
 * （v 音量・q ゲート・p パンは本パーサでは発音位置に影響しないため値を読み飛ばすのみ）
 */
const clamp = (value: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, value));

/**
 * 曲全体に効くトップレベル宣言（トラックとは1対1ではない）。
 * MMLの先頭などに `#inst=<プリセット> #drum=<パターン> #volume=<全体音量>` の形で埋め込む。
 * 他のMMLプレイヤーには無害（解析時に除去される）。
 */
export type MmlMeta = {
	/** 楽器プリセット名（INSTRUMENT_PRESETS のキー等。利用側が音源解決に使う） */
	instrument?: string;
	/** ドラムパターン名（DRUM_PATTERNS のキー） */
	drum?: string;
	/** ドラムフォント名 */
	drumFont?: string;
	/** 全体音量（0-100等） */
	volume?: number;
	/** ドラム音量（0-100等） */
	drumVolume?: number;
	/** マスタリバーブの掛かり具合 0-100（全トラック共通、`#reverb=` で埋め込む） */
	reverb?: number;
	/**
	 * マスタリバーブのDecay（残響の長さ）を10倍した整数（0.3〜4.0秒 → 3〜40）。
	 * `#reverbdecay=` で埋め込む。省略時は22（2.2秒）。
	 */
	reverbDecay?: number;
	/** マスタリバーブのPre Delay（ms、0〜150）。`#reverbpredelay=` で埋め込む。省略時は0。 */
	reverbPreDelay?: number;
	/** マスタディレイの掛かり具合 0-100（全トラック共通、`#delay=` で埋め込む） */
	delay?: number;
	/** マスタディレイの音価（"4"|"8"|"8d"|"16"）。`#delaydiv=` で埋め込む。省略時は"8"。 */
	delayDivision?: string;
	/**
	 * マスタバスのグルーコンプレッサー量 0-100（全トラック共通、`#mastercomp=` で埋め込む）。
	 * 省略時は0（オフ）。
	 */
	masterCompression?: number;
	/**
	 * 曲頭のフェードイン長を10倍した整数（秒 → 0〜100）。`#fadein=` で埋め込む。省略時は0。
	 */
	fadeIn?: number;
	/**
	 * 曲尾のフェードアウト長を10倍した整数（秒 → 0〜100）。`#fadeout=` で埋め込む。省略時は0。
	 */
	fadeOut?: number;
	/** DAWの動作モード（simple | advanced） */
	mode?: "simple" | "advanced";
	/**
	 * トラックごとの個別楽器名（GM楽器名）。`#t<n>inst=<名前>` で埋め込む。
	 * 省略されたトラックはプリセットが適用される。
	 */
	trackInstruments?: Record<number, string>;
	/**
	 * トラックごとのコンプレッサー（音圧強化）量 0-100。`#t<n>comp=<値>` で埋め込む。
	 * 省略されたトラックは0（実質無圧縮）。ボーカル・楽器どちらのトラックにも掛かる
	 * チャンネルストリップ共通のパラメータ（歌詞トラック固有の `r`/`g`/`h` とは別軸）。
	 */
	trackCompression?: Record<number, number>;
	/**
	 * トラックごとのステレオ幅 0-200。`#t<n>width=<値>` で埋め込む。省略時は100（原音のまま）。
	 */
	trackWidth?: Record<number, number>;
	/**
	 * トラックごとのマスタリバーブへのセンド量 0-100。`#t<n>rev=<値>` で埋め込む。
	 * 省略時は0（センドしない＝掛からない）。楽器・歌詞トラックどちらにも掛かる
	 * チャンネルストリップ共通のパラメータ（歌詞トラック固有の `vocalReverb`/`r`トークンとは別軸）。
	 */
	trackReverbSend?: Record<number, number>;
	/** トラックごとのEQ低域ゲイン -12〜+12dB。`#t<n>eqlo=<値>` で埋め込む。省略時は0（無変化）。 */
	trackEqLow?: Record<number, number>;
	/** トラックごとのEQ中域ゲイン -12〜+12dB。`#t<n>eqmid=<値>` で埋め込む。省略時は0（無変化）。 */
	trackEqMid?: Record<number, number>;
	/** トラックごとのEQ高域ゲイン -12〜+12dB。`#t<n>eqhi=<値>` で埋め込む。省略時は0（無変化）。 */
	trackEqHigh?: Record<number, number>;
	/**
	 * トラックごとのステレオ定位 0-127（64=中央）。`#t<n>pan=<値>` で埋め込む。省略時は64（中央）。
	 * 歌詞トラック固有の `p`（歌唱の定位）とは別軸で、楽器トラック自体の左右配置を決める。
	 */
	trackPan?: Record<number, number>;
	/**
	 * トラックごとのマスタディレイへのセンド量 0-100。`#t<n>dly=<値>` で埋め込む。
	 * 省略時は0（センドしない＝掛からない）。楽器・歌詞トラックどちらにも掛かる
	 * チャンネルストリップ共通のパラメータ（歌詞トラック固有の `vocalDelay`/`d`トークンとは別軸）。
	 */
	trackDelaySend?: Record<number, number>;
};

/** `#inst=...` `#drum=...` `#drumfont=...` `#volume=...` `#drumvolume=...` `#mode=...` 宣言にマッチする（値は英数・ハイフン・アンダースコア） */
const META_DIRECTIVE =
	/#(inst|drum|drumfont|volume|drumvolume|reverb|reverbdecay|reverbpredelay|delay|delaydiv|mastercomp|fadein|fadeout|mode)=([\w-]+)/gi;

/** `#t<n>inst=<GM楽器名>` にマッチする（値は`;` `#` 改行以外の任意文字） */
const TRACK_INST_DIRECTIVE = /#t(\d+)inst=([^#;\r\n]+)/gi;

/** `#t<n>comp=<0-100>` にマッチする（トラック単位コンプレッサー量） */
const TRACK_COMP_DIRECTIVE = /#t(\d+)comp=(\d+)/gi;

/** `#t<n>width=<0-200>` にマッチする（トラック単位ステレオ幅） */
const TRACK_WIDTH_DIRECTIVE = /#t(\d+)width=(\d+)/gi;

/** `#t<n>rev=<0-100>` にマッチする（トラック単位マスタリバーブセンド量） */
const TRACK_REVERBSEND_DIRECTIVE = /#t(\d+)rev=(\d+)/gi;

/** `#t<n>eqlo=<-12〜12>` にマッチする（トラック単位EQ低域、符号付き） */
const TRACK_EQLOW_DIRECTIVE = /#t(\d+)eqlo=(-?\d+)/gi;
/** `#t<n>eqmid=<-12〜12>` にマッチする（トラック単位EQ中域、符号付き） */
const TRACK_EQMID_DIRECTIVE = /#t(\d+)eqmid=(-?\d+)/gi;
/** `#t<n>eqhi=<-12〜12>` にマッチする（トラック単位EQ高域、符号付き） */
const TRACK_EQHIGH_DIRECTIVE = /#t(\d+)eqhi=(-?\d+)/gi;

/** `#t<n>pan=<0-127>` にマッチする（トラック単位ステレオ定位） */
const TRACK_PAN_DIRECTIVE = /#t(\d+)pan=(\d+)/gi;

/** `#t<n>dly=<0-100>` にマッチする（トラック単位マスタディレイセンド量） */
const TRACK_DELAYSEND_DIRECTIVE = /#t(\d+)dly=(\d+)/gi;

/** MMLからトップレベル宣言を抽出する */
export const parseMmlMeta = (mml: string): MmlMeta => {
	const meta: MmlMeta = {};
	for (const m of mml.matchAll(META_DIRECTIVE)) {
		const key = m[1].toLowerCase();
		if (key === "inst") meta.instrument = m[2];
		else if (key === "drum") meta.drum = m[2];
		else if (key === "drumfont") meta.drumFont = m[2];
		else if (key === "volume") {
			const v = Number.parseInt(m[2], 10);
			if (!Number.isNaN(v)) meta.volume = v;
		} else if (key === "drumvolume") {
			const dv = Number.parseInt(m[2], 10);
			if (!Number.isNaN(dv)) meta.drumVolume = dv;
		} else if (key === "reverb") {
			const rv = Number.parseInt(m[2], 10);
			if (!Number.isNaN(rv)) meta.reverb = clamp(rv, 0, 100);
		} else if (key === "reverbdecay") {
			const rd = Number.parseInt(m[2], 10);
			if (!Number.isNaN(rd)) meta.reverbDecay = clamp(rd, 3, 40);
		} else if (key === "reverbpredelay") {
			const rp = Number.parseInt(m[2], 10);
			if (!Number.isNaN(rp)) meta.reverbPreDelay = clamp(rp, 0, 150);
		} else if (key === "delay") {
			const dv = Number.parseInt(m[2], 10);
			if (!Number.isNaN(dv)) meta.delay = clamp(dv, 0, 100);
		} else if (key === "delaydiv") {
			if (["4", "8", "8d", "16"].includes(m[2])) meta.delayDivision = m[2];
		} else if (key === "mastercomp") {
			const mc = Number.parseInt(m[2], 10);
			if (!Number.isNaN(mc)) meta.masterCompression = clamp(mc, 0, 100);
		} else if (key === "fadein") {
			const fi = Number.parseInt(m[2], 10);
			if (!Number.isNaN(fi)) meta.fadeIn = clamp(fi, 0, 100);
		} else if (key === "fadeout") {
			const fo = Number.parseInt(m[2], 10);
			if (!Number.isNaN(fo)) meta.fadeOut = clamp(fo, 0, 100);
		} else if (key === "mode") {
			if (m[2] === "simple" || m[2] === "advanced") {
				meta.mode = m[2];
			}
		}
	}
	for (const m of mml.matchAll(TRACK_INST_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const name = m[2].trim();
		if (!Number.isNaN(idx) && name) {
			meta.trackInstruments ??= {};
			meta.trackInstruments[idx] = name;
		}
	}
	for (const m of mml.matchAll(TRACK_COMP_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), 0, 100);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackCompression ??= {};
			meta.trackCompression[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_WIDTH_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), 0, 200);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackWidth ??= {};
			meta.trackWidth[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_REVERBSEND_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), 0, 100);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackReverbSend ??= {};
			meta.trackReverbSend[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_EQLOW_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), -12, 12);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackEqLow ??= {};
			meta.trackEqLow[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_EQMID_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), -12, 12);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackEqMid ??= {};
			meta.trackEqMid[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_EQHIGH_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), -12, 12);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackEqHigh ??= {};
			meta.trackEqHigh[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_PAN_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), 0, 127);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackPan ??= {};
			meta.trackPan[idx] = val;
		}
	}
	for (const m of mml.matchAll(TRACK_DELAYSEND_DIRECTIVE)) {
		const idx = Number.parseInt(m[1], 10);
		const val = clamp(Number.parseInt(m[2], 10), 0, 100);
		if (!Number.isNaN(idx) && !Number.isNaN(val)) {
			meta.trackDelaySend ??= {};
			meta.trackDelaySend[idx] = val;
		}
	}
	return meta;
};

/** MMLからトップレベル宣言を取り除く（ノート解析が誤解釈しないように） */
export const stripMmlMeta = (mml: string): string =>
	mml
		.replace(META_DIRECTIVE, "")
		.replace(TRACK_INST_DIRECTIVE, "")
		.replace(TRACK_COMP_DIRECTIVE, "")
		.replace(TRACK_WIDTH_DIRECTIVE, "")
		.replace(TRACK_REVERBSEND_DIRECTIVE, "")
		.replace(TRACK_EQLOW_DIRECTIVE, "")
		.replace(TRACK_EQMID_DIRECTIVE, "")
		.replace(TRACK_EQHIGH_DIRECTIVE, "")
		.replace(TRACK_PAN_DIRECTIVE, "")
		.replace(TRACK_DELAYSEND_DIRECTIVE, "");

/** メタ情報を `#inst=… #drum=… #volume=… #mode=…` のMML宣言文字列へ直列化する（空なら空文字） */
export const formatMmlMeta = (meta: MmlMeta, space = ""): string => {
	const parts: string[] = [];
	if (meta.instrument) parts.push(`#inst=${meta.instrument}`);
	if (meta.drum) parts.push(`#drum=${meta.drum}`);
	if (meta.drumFont) parts.push(`#drumfont=${meta.drumFont}`);
	if (meta.volume !== undefined) parts.push(`#volume=${meta.volume}`);
	if (meta.drumVolume !== undefined)
		parts.push(`#drumvolume=${meta.drumVolume}`);
	if (meta.reverb !== undefined && meta.reverb !== 0)
		parts.push(`#reverb=${meta.reverb}`);
	if (meta.reverbDecay !== undefined && meta.reverbDecay !== 22)
		parts.push(`#reverbdecay=${meta.reverbDecay}`);
	if (meta.reverbPreDelay !== undefined && meta.reverbPreDelay !== 0)
		parts.push(`#reverbpredelay=${meta.reverbPreDelay}`);
	if (meta.delay !== undefined && meta.delay !== 0)
		parts.push(`#delay=${meta.delay}`);
	if (meta.delayDivision && meta.delayDivision !== "8")
		parts.push(`#delaydiv=${meta.delayDivision}`);
	if (meta.masterCompression !== undefined && meta.masterCompression !== 0)
		parts.push(`#mastercomp=${meta.masterCompression}`);
	if (meta.fadeIn !== undefined && meta.fadeIn !== 0)
		parts.push(`#fadein=${meta.fadeIn}`);
	if (meta.fadeOut !== undefined && meta.fadeOut !== 0)
		parts.push(`#fadeout=${meta.fadeOut}`);
	if (meta.mode) parts.push(`#mode=${meta.mode}`);
	if (meta.trackInstruments) {
		for (const [idx, name] of Object.entries(meta.trackInstruments)) {
			if (name) parts.push(`#t${idx}inst=${name}`);
		}
	}
	if (meta.trackCompression) {
		for (const [idx, val] of Object.entries(meta.trackCompression)) {
			if (val !== 0) parts.push(`#t${idx}comp=${val}`);
		}
	}
	if (meta.trackWidth) {
		for (const [idx, val] of Object.entries(meta.trackWidth)) {
			if (val !== 100) parts.push(`#t${idx}width=${val}`);
		}
	}
	if (meta.trackReverbSend) {
		for (const [idx, val] of Object.entries(meta.trackReverbSend)) {
			if (val !== 0) parts.push(`#t${idx}rev=${val}`);
		}
	}
	if (meta.trackEqLow) {
		for (const [idx, val] of Object.entries(meta.trackEqLow)) {
			if (val !== 0) parts.push(`#t${idx}eqlo=${val}`);
		}
	}
	if (meta.trackEqMid) {
		for (const [idx, val] of Object.entries(meta.trackEqMid)) {
			if (val !== 0) parts.push(`#t${idx}eqmid=${val}`);
		}
	}
	if (meta.trackEqHigh) {
		for (const [idx, val] of Object.entries(meta.trackEqHigh)) {
			if (val !== 0) parts.push(`#t${idx}eqhi=${val}`);
		}
	}
	if (meta.trackPan) {
		for (const [idx, val] of Object.entries(meta.trackPan)) {
			if (val !== 64) parts.push(`#t${idx}pan=${val}`);
		}
	}
	if (meta.trackDelaySend) {
		for (const [idx, val] of Object.entries(meta.trackDelaySend)) {
			if (val !== 0) parts.push(`#t${idx}dly=${val}`);
		}
	}
	return parts.join(space);
};

export type MMLNotePlacement = {
	/** 0:melody 1:submelody 2:bass 3:chord */
	trackIndex: number;
	startStep: number;
	pitch: number;
	durationSteps: number;
	/** v コマンドで指定されたベロシティ（0-127、既定100） */
	velocity: number;
};

/** 再生ビュー用の表示トークン（mountMmlPlayer のノート列ハイライトに使う） */
export type MMLDisplayToken = {
	/** 正規化済みのトークン文字列（小文字・空白除去） */
	text: string;
	/** 発音開始ステップ。制御トークン（o/l/</>）は直近の currentStep */
	startStep: number;
	/** 長さステップ。制御トークンは 0（ハイライト対象外） */
	durationSteps: number;
	type: "note" | "chord" | "rest" | "octave" | "shift" | "length" | "ctrl";
};

export type ParsedMML = {
	placements: MMLNotePlacement[];
	/** メロディトラックの t 指定から検出したBPM（無ければ null） */
	bpm: number | null;
	/**
	 * trackIndex → 表示トークン列。`collectTokens` 指定時のみ生成。
	 * placements と同一パスで構築するため発音位置と完全に同期する。
	 */
	tokenTracks?: Map<number, MMLDisplayToken[]>;
	/**
	 * 歌詞トラックID → 歌詞トラック。`collectLyrics` 指定時のみ生成。
	 * 演奏トラック（@n）の n と同じIDで対応づく。
	 */
	lyrics?: Map<number, LyricTrack>;
	/**
	 * 1つの取り込み先トラックへ2系統以上のソースチャンネル（@n）の発音が合算された
	 * トラック数。`clampTrackCount` による畳み込み等で発生する。0なら合算なし。
	 * シンプルモードで「複数トラックを合算した」旨を控えめに知らせる用途。
	 */
	mergedTrackCount: number;
	/**
	 * トラックごとに最後に指定された v（ベロシティ）コマンドの値。
	 * generateMML はトラック全体で単一の v をヘッダーに出力するため、
	 * 読込時はこの値をトラックの既定ベロシティ（GUIのスライダー）へ復元する。
	 */
	trackVelocity: Map<number, number>;
	/** トップレベル宣言（楽器プリセット・ドラムパターン）。常に返す（無ければ空オブジェクト） */
	meta: MmlMeta;
};

export type ParseMMLOptions = {
	/** 1小節あたりのステップ数。既定192 */
	stepsPerBar?: number;
	/** 再生ビュー用の表示トークン列も併せて返す。既定 false */
	collectTokens?: boolean;
	/** 歌詞トラック（@@n）の解析結果も併せて返す。既定 false */
	collectLyrics?: boolean;
	/**
	 * このトラック数以上のチャンネル（@n）をベース(index 2)へ畳み込む。
	 * 4トラックDAWの読込専用の都合。未指定なら畳み込まず実際の @n をそのまま使う
	 * （再生専用ビュー等、全トラックを忠実に表示したい用途の既定）。
	 */
	clampTrackCount?: number;
};

/**
 * MML文字列を解析してノート配置とBPMを返す。
 */
export const parseMML = (
	mml: string,
	options: ParseMMLOptions = {},
): ParsedMML => {
	const stepsPerBar = options.stepsPerBar ?? DEFAULT_STEPS_PER_BAR;
	const collectTokens = options.collectTokens ?? false;
	const collectLyrics = options.collectLyrics ?? false;
	const clampTrackCount = options.clampTrackCount;
	const placements: MMLNotePlacement[] = [];
	const tokenTracks: Map<number, MMLDisplayToken[]> = new Map();
	let bpm: number | null = null;

	if (!mml) {
		return {
			placements,
			bpm,
			tokenTracks: collectTokens ? tokenTracks : undefined,
			lyrics: collectLyrics ? new Map() : undefined,
			mergedTrackCount: 0,
			trackVelocity: new Map(),
			meta: {},
		};
	}

	// 0. カスタムボーカル宣言行（@@key icon_url koe_url）を除去する。
	//    宣言中の URL に含まれる "//" を行コメントと誤認すると、minify（1行）MML では
	//    そこから曲全体が削れてしまうため、コメント除去より前に必ず取り除く。
	//    宣言自体の解析は利用側（daw.ts の loadMML 等）が parseCustomVocals で行う。
	const noCustomVocals = stripCustomVocals(mml);

	// 1. コメント除去。歌詞行（@@n）の解析・除去は改行を畳み込む前に行う
	const noComments = noCustomVocals
		.replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント
		.replace(/\/\/.*$/gm, ""); // 行コメント

	// 2. トップレベル宣言（#inst= / #drum=）を抽出してから除去する
	const meta = parseMmlMeta(noComments);
	const noMeta = stripMmlMeta(noComments);

	const lyrics = collectLyrics ? parseLyrics(noMeta) : undefined;

	// 歌詞行を取り除いてから改行を畳み込む（@@n を演奏ノートと誤解釈しないため）
	const endMarkerBase = MML_END_MARKER.replace(/;+$/, "");
	const endRegex = new RegExp(`(?<![cdafgCDAFG])${endMarkerBase}\\b;?`, "gi");
	const fullMML = stripLyrics(noMeta)
		.replace(endRegex, "")
		.replace(/[\n\r]+/g, " ")
		.trim();

	// 3. @(\d+) で分割
	const parts = fullMML.split(/(@\d+)/).filter((p) => p.trim().length > 0);

	let trackIndex = 0; // 既定はmelody（畳み込み後の取り込み先）
	let sourceTrackIndex = 0; // 畳み込み前のソースチャンネル（@n の n）
	let octave = 4;
	let currentStep = 0;
	let baseLength = 16;
	let velocity = 100;

	// 取り込み先トラック → 発音を供給したソースチャンネル集合。
	// 1トラックに2系統以上集まれば「合算」されたとみなす（clamp畳み込み等）。
	const contributors = new Map<number, Set<number>>();
	// トラックごとに最後に指定された v の値（ノートが無くても復元できるようここで記録する）
	const trackVelocity = new Map<number, number>();
	const recordContributor = (): void => {
		let set = contributors.get(trackIndex);
		if (!set) {
			set = new Set();
			contributors.set(trackIndex, set);
		}
		set.add(sourceTrackIndex);
	};

	for (const rawPart of parts) {
		const part = rawPart.trim();

		// ヘッダー（@0,@1...）
		if (part.startsWith("@")) {
			let idx = Number.parseInt(part.substring(1), 10);
			sourceTrackIndex = idx;
			// clampTrackCount 指定時のみ、超過チャンネルを伴奏(clampTrackCount-1)へ畳み込む
			if (clampTrackCount !== undefined && idx >= clampTrackCount)
				idx = clampTrackCount - 1;
			trackIndex = idx;
			octave = 4;
			currentStep = 0;
			baseLength = 16;
			velocity = 100;
			continue;
		}

		const body = part.replace(/\s+/g, "").toLowerCase();
		let j = 0;

		const pushTok = (
			type: MMLDisplayToken["type"],
			start: number,
			dur: number,
			from: number,
		): void => {
			if (!collectTokens) return;
			let arr = tokenTracks.get(trackIndex);
			if (!arr) {
				arr = [];
				tokenTracks.set(trackIndex, arr);
			}
			arr.push({
				text: body.slice(from, j),
				startStep: start,
				durationSteps: dur,
				type,
			});
		};

		const parseLength = (): number => {
			let numStr = "";
			while (j < body.length && /\d/.test(body[j])) {
				numStr += body[j];
				j++;
			}
			const len = numStr
				? clamp(Number.parseInt(numStr, 10), 1, 64)
				: baseLength;
			let steps = Math.round(stepsPerBar / len);
			while (j < body.length && body[j] === ".") {
				steps = Math.round(steps * 1.5);
				j++;
			}
			return steps;
		};

		while (j < body.length) {
			const ch = body[j];
			const tokStart = j;

			if (ch === "o") {
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				// numStr が空（o単独）のときだけ既定4。"0" を falsy 扱いして
				// o0 を o4 に化けさせないよう、|| ではなく空判定でフォールバックする。
				octave = numStr ? clamp(Number.parseInt(numStr, 10), 0, 8) : 4;
				pushTok("octave", currentStep, 0, tokStart);
			} else if (ch === ">") {
				octave = Math.min(8, octave + 1);
				j++;
				pushTok("shift", currentStep, 0, tokStart);
			} else if (ch === "<") {
				octave = Math.max(0, octave - 1);
				j++;
				pushTok("shift", currentStep, 0, tokStart);
			} else if (ch === "l") {
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				baseLength = clamp(Number.parseInt(numStr, 10) || 16, 1, 64);
				pushTok("length", currentStep, 0, tokStart);
			} else if (ch === "r") {
				j++;
				const restStart = currentStep;
				const restSteps = parseLength();
				pushTok("rest", restStart, restSteps, tokStart);
				currentStep += restSteps;
			} else if (ch === "t" || ch === "v" || ch === "q" || ch === "p") {
				// 制御コマンドの数値を消費する。発音位置には影響しない。
				// t（テンポ）のみメロディトラックからBPMとして拾い、範囲をクリップする。
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				if (ch === "t" && numStr) {
					if (bpm === null) {
						bpm = clamp(Number.parseInt(numStr, 10), 1, 255);
					}
				} else if (ch === "v" && numStr) {
					velocity = clamp(Number.parseInt(numStr, 10), 0, 127);
					trackVelocity.set(trackIndex, velocity);
				}
				// 発音位置には影響しないが、再生専用UIがグレーアウト表示できるよう
				// トークンとして残す（durationSteps 0 でハイライト対象外）。
				pushTok("ctrl", currentStep, 0, tokStart);
			} else if (ch === "[") {
				// 和音
				j++;
				const chordNotes: number[] = [];
				const savedOctave = octave;
				while (j < body.length && body[j] !== "]") {
					const c = body[j];
					if (Object.hasOwn(PITCH_MAP, c)) {
						let pitch = PITCH_MAP[c];
						j++;
						if (j < body.length && (body[j] === "#" || body[j] === "+")) {
							pitch++;
							j++;
						} else if (j < body.length && body[j] === "-") {
							pitch--;
							j++;
						}
						chordNotes.push((octave + 1) * 12 + pitch);
					} else if (c === ">") {
						octave = Math.min(8, octave + 1);
						j++;
					} else if (c === "<") {
						octave = Math.max(0, octave - 1);
						j++;
					} else if (c === "o") {
						j++;
						let numStr = "";
						while (j < body.length && /\d/.test(body[j])) {
							numStr += body[j];
							j++;
						}
						// o0 を o4 に化けさせない（"0" は falsy なので || は使わない）
						octave = numStr ? clamp(Number.parseInt(numStr, 10), 0, 8) : 4;
					} else {
						j++;
					}
				}
				if (j < body.length && body[j] === "]") j++;
				const steps = parseLength();
				if (chordNotes.length > 0) recordContributor();
				for (const p of chordNotes) {
					placements.push({
						trackIndex,
						startStep: currentStep,
						pitch: p,
						durationSteps: Math.max(1, steps),
						velocity,
					});
				}
				pushTok("chord", currentStep, Math.max(1, steps), tokStart);
				currentStep += steps;
				octave = savedOctave;
			} else if (Object.hasOwn(PITCH_MAP, ch)) {
				// 単音
				let pitch = PITCH_MAP[ch];
				j++;
				if (j < body.length && (body[j] === "#" || body[j] === "+")) {
					pitch++;
					j++;
				} else if (j < body.length && body[j] === "-") {
					pitch--;
					j++;
				}
				const midiPitch = (octave + 1) * 12 + pitch;
				const steps = parseLength();
				recordContributor();
				placements.push({
					trackIndex,
					startStep: currentStep,
					pitch: midiPitch,
					durationSteps: Math.max(1, steps),
					velocity,
				});
				pushTok("note", currentStep, Math.max(1, steps), tokStart);
				currentStep += steps;
			} else {
				j++;
			}
		}
	}

	let mergedTrackCount = 0;
	for (const set of contributors.values()) {
		if (set.size >= 2) mergedTrackCount++;
	}

	return {
		placements,
		bpm,
		tokenTracks: collectTokens ? tokenTracks : undefined,
		lyrics,
		mergedTrackCount,
		trackVelocity,
		meta,
	};
};
