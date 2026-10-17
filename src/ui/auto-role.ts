/**
 * 「おまかせマスタリング」の役割推定。ノート列だけから、そのトラックが
 * 主旋律／サブメロ／ベース／伴奏のどれかを決める（楽器名・音量・定位・EQ の既定値を引く鍵）。
 *
 * 推定が要るのは**役割が本当に不明な経路**（advanced モードで手入力・読み込みした曲、MIDI 取り込み）
 * だけで、simple モードはトラック ID が役割、作曲が置いた層は {@link roleOfSlot} でスロットから
 * 引く。推定式はここに閉じ、daw.ts は呼ぶだけにしてある（検算: `scripts/test/check-auto-role.ts`）。
 *
 * 2026-10-17 の実測（生成曲 40 本 × 全層）で、旧式は刻み（16分の4声和音）とアルペジオを
 * 「サブメロ」、パッド（単音の全音符）を「主旋律」と推定し、主旋律のほうを「サブメロ」にしていた
 * （主旋律 36/40 が外れ）。伴奏が主旋律と同じ音量で鳴る原因だったので、和音の**発音の割合**と
 * 音価で伴奏を先に拾い、主旋律は「鳴っている時間が十分ある単音トラックのうち最も高いもの」にした。
 */
import { UNITS_PER_SEMITONE } from "../audio/tuning";
import type { AutoRole, PresetSlot } from "../compose/advanced-layers";

/** ピアノロールのステップ解像度（1拍=48ステップ、他ファイルの STEPS_PER_BEAT と同じ）。 */
export const AUTO_ROLE_STEPS_PER_BEAT = 48;

/** ベース判定の音高しきい値。C3 (MIDI 48) を units で表したもの。 */
export const AUTO_ROLE_BASS_UNITS = 48 * UNITS_PER_SEMITONE;

/**
 * 刻み（ブロック和音のスタブ）とみなす、同時発音の発音点の割合。
 * 実測: 生成曲の刻み層は 1.00、アルペジオ・旋律は 0.00。境目に曲は無い。
 */
export const AUTO_ROLE_STAB_POLY_RATIO = 0.5;

/**
 * パッドとみなす単音の平均音価（全音符）。単音でこれだけ長い音が並ぶのは持続音の伴奏で、
 * 対旋律なら 2 拍前後（旧式のコメントが言う「音数が少なく音価が長い」）。
 */
export const AUTO_ROLE_PAD_MIN_DUR = AUTO_ROLE_STEPS_PER_BEAT * 4;

/**
 * 主旋律の候補に残す、鳴っている時間の下限（最も長く鳴っている単音トラックに対する比）。
 * サビだけのキラキラやオクターブ上の重ねは音高が主旋律より上に来るが、鳴っている時間は
 * 一部のセクションぶんしか無い。
 */
export const AUTO_ROLE_MELODY_MIN_SOUNDING_RATIO = 0.5;

/** 役割判定と音量計算の両方に使う、ノート列から算出した統計値。 */
export type AutoRoleStats = {
	avgPitch: number;
	avgDur: number;
	/** 同一 startStep の平均同時発音数（和音の厚み。単音のみなら 1）。 */
	avgPoly: number;
	maxPoly: number;
	/** 発音点のうち 2 音以上が同時に鳴る割合（0〜1）。 */
	polyOnsetRatio: number;
	/** 鳴っている時間の合計（ステップ。重なりは足し合わせたまま）。 */
	soundingSteps: number;
};

export const computeAutoRoleStats = (
	notes: readonly {
		pitchUnits: number;
		startStep: number;
		durationSteps: number;
	}[],
): AutoRoleStats => {
	const avgPitch = notes.reduce((s, n) => s + n.pitchUnits, 0) / notes.length;
	const soundingSteps = notes.reduce((s, n) => s + n.durationSteps, 0);
	const avgDur = soundingSteps / notes.length;

	const byStart = new Map<number, number>();
	for (const n of notes)
		byStart.set(n.startStep, (byStart.get(n.startStep) ?? 0) + 1);
	let maxPoly = 0;
	let polyOnsets = 0;
	for (const c of byStart.values()) {
		if (c > maxPoly) maxPoly = c;
		if (c >= 2) polyOnsets++;
	}
	const avgPoly = notes.length / byStart.size;
	const polyOnsetRatio = polyOnsets / byStart.size;

	return { avgPitch, avgDur, avgPoly, maxPoly, polyOnsetRatio, soundingSteps };
};

/** ベース・伴奏と決まるトラック（主旋律の候補から外す側）。 */
const fixedRole = (stats: AutoRoleStats): AutoRole | null => {
	// avgPitch は units（1/372オクターブ）。半音の数値と直接比べないこと。
	if (stats.avgPitch < AUTO_ROLE_BASS_UNITS) return "bass"; // C3未満 = 低音域
	// 白玉の和音（ブロックコード）
	if (stats.maxPoly >= 2 && stats.avgDur >= AUTO_ROLE_STEPS_PER_BEAT)
		return "chord";
	// 刻み: 短くても発音の半分以上が和音なら伴奏
	if (stats.polyOnsetRatio >= AUTO_ROLE_STAB_POLY_RATIO) return "chord";
	// パッド: 単音でも全音符が並ぶなら持続音の伴奏
	if (stats.avgDur >= AUTO_ROLE_PAD_MIN_DUR) return "chord";
	return null;
};

/**
 * ノート列（ピッチ・タイミング）から、このトラックの役割を推定する。ノートが無いトラックは
 * 呼び出し側でスキップする。
 *
 * - 平均音高が低い（C3未満）→ ベース
 * - 和音が多い（白玉の和音・刻み）か、単音でも全音符が並ぶ（パッド）→ 伴奏
 * - それ以外の単音は、主旋律に選ばれたトラックだけ主旋律、残りはサブメロ
 */
export const classifyTrackRole = (
	stats: AutoRoleStats,
	/**
	 * このトラックが {@link pickTopSingleVoice} で主旋律に選ばれたか。
	 *
	 * 主旋律と対旋律を分けるのは絶対的な密度ではなく**トラックどうしの関係**（どちらが上を
	 * 歌っているか）。密度と音価で定義すると密度の高いオブリガートを主旋律と取り違えるし、
	 * 生成側が判定式を満たすためにサブメロを「単音・低密度・長音価」でしか書けなくなる。
	 */
	isTopSingleVoice: boolean,
): AutoRole => fixedRole(stats) ?? (isTopSingleVoice ? "melody" : "submelody");

/**
 * 主旋律にするトラックを 1 本選ぶ。ベース・伴奏を除いた単音トラックのうち、
 * 鳴っている時間が最長のものの半分以上あるものの中で、平均音高が最も高いもの。
 * 候補が無ければ null（全部ベースと伴奏の曲）。
 */
export const pickTopSingleVoice = <K>(
	statsByTrack: ReadonlyMap<K, AutoRoleStats>,
): K | null => {
	const voices = [...statsByTrack].filter(([, st]) => fixedRole(st) === null);
	const longest = Math.max(0, ...voices.map(([, st]) => st.soundingSteps));
	let top: K | null = null;
	let topPitch = Number.NEGATIVE_INFINITY;
	for (const [id, st] of voices) {
		if (st.soundingSteps < longest * AUTO_ROLE_MELODY_MIN_SOUNDING_RATIO)
			continue;
		if (st.avgPitch > topPitch) {
			topPitch = st.avgPitch;
			top = id;
		}
	}
	return top;
};

/**
 * 作曲が置いた層のスロット → 役割。スロットは音色の引き出し（`INSTRUMENT_PRESETS[slot]`）で、
 * 役割は音量・定位・EQ の既定値の引き出し。作曲の層は役割が分かっているので推定しない。
 */
export const roleOfSlot = (slot: PresetSlot): AutoRole => {
	switch (slot) {
		case "melody":
			return "melody";
		case "submelody":
		case "chorusLead":
		case "solo":
			return "submelody";
		case "bass":
		case "bassAlt":
			return "bass";
		case "chord":
		case "chordAlt":
		case "sparkle":
		case "harmonyAlt":
			return "chord";
	}
};
