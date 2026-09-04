/**
 * 継続記号（`ー` / `〜`）で結合したノート内のピッチ推移を、koe の `CurveInput`
 * （1フレームごとに評価される関数）へ変換する。
 *
 * メインスレッド（{@link file://./lyrics.ts} の local backend）とWorker
 * （{@link file://./voice-worker.ts}）の双方から使う純ロジックなのでここへ切り出す。
 * {@link file://./vibrato.ts} と同じ方針で、「何が歌唱表現か」を決めるのは dtm 側の責務。
 *
 * 副作用ゼロ・DOM非依存なので、Worker の別バンドルからも安全に import できる。
 */

import { vibratoRatio } from "./vibrato";

/**
 * 継続記号で結合されたノートの、2区間目以降のピッチ推移。
 * Worker へも postMessage で渡すため、素の JSON で表せる形にしてある。
 */
export type PitchSegment = {
	/** この区間のピッチ。単位は units（1/372オクターブの整数）。 */
	pitch: number;
	/** ノートの母音オンセットからの相対秒（区間の開始位置）。 */
	atSec: number;
	/** 直前区間から滑らかに繋ぐ（`〜`）。false なら階段状に切り替える（`ー`）。 */
	portamento: boolean;
};

/**
 * `ー`（階段）でのピッチ切り替えに掛ける時間（ms）。
 * 完全な不連続はボコーダ上で機械的に響くため、ごく短いグライドで繋ぐ。
 * 人が「音程が切り替わった」と感じる境界を保ちつつ、段差の耳障りさだけを取る長さ。
 */
export const STEP_GLIDE_MS = 15;

/**
 * `〜`（ポルタメント）でのピッチ切り替えに掛ける時間（ms）。
 * 歌唱のしゃくり・スラーとして自然に聞こえる範囲の中庸値。
 */
export const PORTAMENTO_MS = 70;

/** グライドの最短長（ms）。区間が詰まっていてもこの長さは確保する。 */
const MIN_GLIDE_MS = 4;

/** ピッチ(units) → 周波数(Hz)。A4 = 2139 units = 440Hz。 */
export const unitsToHz = (units: number): number =>
	440 * 2 ** ((units - 2139) / 372);

/** 3次スムーズステップ（0→1 を滑らかに補間する）。 */
const smoothstep = (u: number): number => u * u * (3 - 2 * u);

/** 内部表現: 事前に Hz・ms・実効グライド長へ畳んだ切り替え点。 */
type Keyframe = { hz: number; startMs: number; glideMs: number };

/**
 * 区間列を切り替え点列へ畳む。グライドは区間の境界を跨いで中央に置き、
 * 直前の区間長の半分を超えないよう詰める（短い区間で前後のグライドが重ならないように）。
 */
const toKeyframes = (segments: PitchSegment[]): Keyframe[] => {
	const kf: Keyframe[] = [];
	let prevAtMs = 0;
	for (const seg of segments) {
		const atMs = seg.atSec * 1000;
		const glideMs = Math.max(
			MIN_GLIDE_MS,
			Math.min(
				seg.portamento ? PORTAMENTO_MS : STEP_GLIDE_MS,
				(atMs - prevAtMs) * 0.5,
			),
		);
		kf.push({
			hz: unitsToHz(seg.pitch),
			startMs: Math.max(0, atMs - glideMs / 2),
			glideMs,
		});
		prevAtMs = atMs;
	}
	return kf;
};

/**
 * ノート内のピッチ曲線を返す（koe の `RenderNoteParams.pitch` へそのまま渡せる）。
 *
 * 引数が「基準ピッチ1つ + 区間なし + ビブラートOFF」なら定数を返すので、
 * 呼び出し側は分岐せずこの関数を通してよい。
 *
 * @param baseHz  先頭区間のピッチ（Hz）
 * @param segments 2区間目以降のピッチ推移（`atSec` 昇順）。空なら単一ピッチ
 * @param preMs   レンダリング先頭から母音オンセットまでの先行秒（ms）
 * @param vibrato 自動ビブラートを重ねるか（長さ判定は呼び出し側で済ませておく）
 */
export const pitchCurveFor = (
	baseHz: number,
	segments: PitchSegment[] | undefined,
	preMs: number,
	vibrato: boolean,
): number | ((tMs: number) => number) => {
	const kf = segments?.length ? toKeyframes(segments) : null;
	if (!kf && !vibrato) return baseHz;

	return (tMs: number): number => {
		// preMs 以前（子音・先行母音の重なり区間）は先頭ピッチのまま素直に保つ。
		const sinceOnset = tMs - preMs;
		let hz = baseHz;
		if (kf && sinceOnset > 0) {
			for (const k of kf) {
				if (sinceOnset >= k.startMs + k.glideMs) {
					hz = k.hz;
					continue;
				}
				if (sinceOnset <= k.startMs) break;
				// セント直線（=対数）で補間する。周波数の線形補間だと高音側が詰まる。
				const u = smoothstep((sinceOnset - k.startMs) / k.glideMs);
				hz = hz * (k.hz / hz) ** u;
				break;
			}
		}
		return vibrato ? hz * vibratoRatio(sinceOnset) : hz;
	};
};

/**
 * 区間列を丸ごと移調する（オクターブユニゾンで同じ音節を±1オクターブ重ねるとき用）。
 * 空・未指定ならそのまま undefined を返す。
 */
export const transposeSegments = (
	segments: PitchSegment[] | undefined,
	offsetUnits: number,
): PitchSegment[] | undefined => {
	if (!segments?.length || offsetUnits === 0) return segments;
	return segments.map((s) => ({ ...s, pitch: s.pitch + offsetUnits }));
};

/** キャッシュキー用に区間列を短い文字列へ畳む（同じ推移なら同じキーになる）。 */
export const segmentsCacheKey = (
	segments: PitchSegment[] | undefined,
): string =>
	segments?.length
		? `|s${segments
				.map(
					(s) =>
						`${s.pitch}@${Math.round(s.atSec * 100)}${s.portamento ? "~" : ""}`,
				)
				.join(",")}`
		: "";
