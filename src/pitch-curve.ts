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
	/**
	 * 直前区間から時間を掛けて滑る（`〜`）。false（`ー`）は素早く移る。
	 * どちらもピッチは連続に動く——違いは掛ける時間だけ（{@link glideMsForSegments}）。
	 */
	portamento: boolean;
};

/**
 * `ー` でのピッチ移動に掛ける時間 —— **隣接区間の短いほうに対する割合**。
 *
 * 固定msだと、短い音符では相対的に一瞬（＝段差）に、長いロングトーンではなおさら
 * 一瞬になる。伸ばした音の途中でピッチだけが瞬間移動すると、耳は「新しい音が
 * 始まった」と受け取る——`ー` は「言い直さない＝声が繋がっている」記号なのに
 * 言い直して聞こえてしまう。だから音価に比例させる。
 */
export const STEP_GLIDE_RATIO = 0.35;

/**
 * `〜`（ポルタメント）の割合。{@link STEP_GLIDE_RATIO} と同じ考え方で、区間の
 * 大半を掛けて滑る＝しゃくり・スラーになる。
 */
export const PORTAMENTO_RATIO = 0.8;

/**
 * `ー` のグライドの上限（ms）。
 *
 * 割合だけで伸ばすと、全音符のような長い音で半秒以上滑り続けてテルミンのように
 * 聞こえる。人が音程を変える動作そのものは音価に比例しないので、短い音符では
 * 割合が、長い音符ではこの上限が効くようにする。
 */
export const MAX_STEP_GLIDE_MS = 120;

/** `〜` のグライドの上限（ms）。ゆっくり滑る分だけ `ー` より長く取る。 */
export const MAX_PORTAMENTO_MS = 400;

/** グライドの最短長（ms）。区間が詰まっていてもこの長さは確保する。 */
const MIN_GLIDE_MS = 4;

/**
 * グライドが区間を食ってよい上限（隣接区間の短いほうに対する比）。
 *
 * グライドは境界を跨いで中央に置くので、これを超えると隣の切り替えと範囲が重なり、
 * 補間が区間を飛び越してピッチが暴れる。割合をいくら上げても壊れないための楔。
 */
const MAX_GLIDE_SPAN_RATIO = 0.9;

/** ピッチ(units) → 周波数(Hz)。A4 = 2139 units = 440Hz。 */
export const unitsToHz = (units: number): number =>
	440 * 2 ** ((units - 2139) / 372);

/** 3次スムーズステップ（0→1 を滑らかに補間する）。 */
const smoothstep = (u: number): number => u * u * (3 - 2 * u);

/**
 * 各区間の切り替えに掛けるグライド長（ms）を求める。`segments` と同じ長さの配列を返す。
 *
 * 「隣接区間の短いほう × 割合」（上限つき）。短いほうを見るのは、長い音から短い音へ
 * 入るところで滑り切れず、次の切り替えと範囲が重なるのを防ぐため。
 *
 * 最後の区間だけは「次の境界」が無いので、ノート全長 `totalMs` を終端として使う。
 * 未指定なら直前区間と同じ長さが続くと見なす。
 *
 * @param segments 2区間目以降のピッチ推移（`atSec` 昇順）
 * @param totalMs  ノートの全長（母音オンセットからのms）。省略可
 */
export const glideMsForSegments = (
	segments: PitchSegment[],
	totalMs?: number,
): number[] =>
	segments.map((seg, i) => {
		const atMs = seg.atSec * 1000;
		const prevMs = i === 0 ? 0 : segments[i - 1].atSec * 1000;
		const nextMs =
			i + 1 < segments.length
				? segments[i + 1].atSec * 1000
				: (totalMs ?? atMs + (atMs - prevMs));
		const span = Math.max(0, Math.min(atMs - prevMs, nextMs - atMs));
		const ratio = seg.portamento ? PORTAMENTO_RATIO : STEP_GLIDE_RATIO;
		const cap = seg.portamento ? MAX_PORTAMENTO_MS : MAX_STEP_GLIDE_MS;
		return Math.min(
			Math.max(MIN_GLIDE_MS, Math.min(span * ratio, cap)),
			span * MAX_GLIDE_SPAN_RATIO,
		);
	});

/** 内部表現: 事前に Hz・ms・実効グライド長へ畳んだ切り替え点。 */
type Keyframe = { hz: number; startMs: number; glideMs: number };

/**
 * 区間列を切り替え点列へ畳む。グライドは区間の境界を跨いで**中央**に置く——
 * 境界の手前から動き始めて向こうで着くのが、人の音程変化に一番近い。
 */
const toKeyframes = (
	segments: PitchSegment[],
	totalMs?: number,
): Keyframe[] => {
	const glides = glideMsForSegments(segments, totalMs);
	return segments.map((seg, i) => ({
		hz: unitsToHz(seg.pitch),
		startMs: Math.max(0, seg.atSec * 1000 - glides[i] / 2),
		glideMs: glides[i],
	}));
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
 * @param totalMs ノートの全長（ms）。最終区間のグライド長を決めるのに使う
 */
export const pitchCurveFor = (
	baseHz: number,
	segments: PitchSegment[] | undefined,
	preMs: number,
	vibrato: boolean,
	totalMs?: number,
): number | ((tMs: number) => number) => {
	const kf = segments?.length ? toKeyframes(segments, totalMs) : null;
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
