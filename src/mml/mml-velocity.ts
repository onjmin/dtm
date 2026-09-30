/**
 * 音符ごとの強弱（v）の読み書き規則。書き出し・DAW の読み込み・再生専用プレイヤー・
 * MIDI 書き出し・和音分解が、ここを通して同じ意味で v を扱う。
 *
 * **意味の約束**（`docs/accomp-compose.md` §8.2）
 *
 * - 内部の `Note.velocity` は、**トラック音量 T に対する相対値**（100 = T）。
 * - MML の `v` は**実効値** = round(T × velocity / 100)。
 * - 最終的な音量は、DAW でもプレイヤーでも (T/100) × (velocity/127) ≒ v/127。
 *
 * 読み込みでは、トラックに書かれた v の列を {@link splitTrackVelocity} で
 * {音量 T, 相対 velocity} に分け、書き出しでは {@link effectiveVelocity} で v に戻す。
 * この往復は v を1つも変えない（証明は {@link splitTrackVelocity}）。
 *
 * **MML の記法上、直らないもの**
 *
 * - 和音は v を1つしか持てないので、構成音の最大値で代表させる（{@link chordVelocity}）。
 *   オクターブ重ね（重ねた声は ×0.7）も元の音と同じ位置の和音にまとまり、0.7 は消える。
 * - `headless-player`（`studio.play`）は v を相対化せずそのまま velocity に使う。
 *   音量は同じで、SoundFont の明るさだけが DAW と違う（以前からある差）。
 *
 * 依存なしの純関数だけを置く（Node の検査 `scripts/test/check-mml-velocity.ts` から直接読むため）。
 */

/** 未設定の velocity の既定値（`types.ts` の DEFAULT_VELOCITY と同じ。依存を持たないため再定義）。 */
const BASE_VELOCITY = 100;
const MAX_VELOCITY = 127;

const clampVelocity = (v: number): number =>
	Math.min(MAX_VELOCITY, Math.max(0, v));

/**
 * トラック音量 T と相対 velocity から、MML に書く v（実効値）を求める。0〜127 の整数。
 *
 * `effectiveVelocity(T)`（velocity 省略）は、その音量のトラックで既定の強さの音符が持つ v。
 */
export const effectiveVelocity = (
	trackVolume: number,
	velocity: number = BASE_VELOCITY,
): number => clampVelocity(Math.round((trackVolume * velocity) / 100));

/**
 * 和音（同じ位置で鳴る音符の組）を代表する相対 velocity。MML の和音は v を1つしか
 * 持てないので、構成音の最大値を採る（未設定は100）。
 */
export const chordVelocity = (
	notes: readonly { velocity?: number }[],
): number => {
	let max = Number.NEGATIVE_INFINITY;
	for (const n of notes) max = Math.max(max, n.velocity ?? BASE_VELOCITY);
	return Number.isFinite(max) ? max : BASE_VELOCITY;
};

export type TrackVelocitySplit = {
	/** トラック音量 T（0〜100）。 */
	volume: number;
	/** 入力と同じ並びの相対 velocity。 */
	velocities: number[];
};

/**
 * トラックに書かれた v（実効値）の列を、トラック音量 T と相対 velocity に分ける。
 *
 * - 列が空なら `{ volume: fallback, velocities: [] }`。
 * - T = min(100, 列の最大)。いちばん強い音が相対100になる（最大が100を超えるトラックは
 *   T = 100 で、velocity = v のまま。≤127）。
 * - T = 0（全部 v0）なら割り算を避けて、velocity はすべて100。
 *
 * **往復が正確な理由**: r = round(100v/T) = 100v/T + e（|e| ≤ 0.5）とおくと、
 * T·r/100 = v + T·e/100。T < 100 なら |T·e/100| < 0.5、T = 100 なら e = 0。
 * よって `effectiveVelocity(T, r)` は必ず v に戻る。
 */
export const splitTrackVelocity = (
	velocities: readonly number[],
	fallback: number,
): TrackVelocitySplit => {
	if (velocities.length === 0) return { volume: fallback, velocities: [] };
	let max = 0;
	for (const v of velocities) max = Math.max(max, v);
	const volume = Math.min(100, max);
	if (volume === 0) {
		return { volume: 0, velocities: velocities.map(() => BASE_VELOCITY) };
	}
	return {
		volume,
		velocities: velocities.map((v) => Math.round((100 * v) / volume)),
	};
};

export type PlacementVelocitySplit = {
	/**
	 * トラック → 音量 T。**v が1つも書かれていないトラックは入らない**（呼び出し側の今の音量を
	 * 保つ。そのトラックの音符はすべて v100＝相対100なので、音量を保てば鳴り方は従来と同じ）。
	 * 音符が無く v だけがあるトラックは、最後の v が入る。
	 */
	volumes: Map<number, number>;
	/** placements と同じ並びの相対 velocity。 */
	velocities: number[];
};

/**
 * MML を読んだ結果（`parseMML` の placements と trackVelocity）を、トラックごとに
 * {@link splitTrackVelocity} へ掛ける。DAW の読み込み（`daw.ts` の `loadMML`）が使う。
 */
export const splitPlacementVelocities = (
	placements: readonly { trackIndex: number; velocity: number }[],
	trackVelocity: ReadonlyMap<number, number>,
): PlacementVelocitySplit => {
	const byTrack = new Map<number, number[]>();
	for (let k = 0; k < placements.length; k++) {
		const list = byTrack.get(placements[k].trackIndex);
		if (list) list.push(k);
		else byTrack.set(placements[k].trackIndex, [k]);
	}
	const volumes = new Map<number, number>();
	const velocities: number[] = new Array(placements.length);
	for (const [track, indices] of byTrack) {
		const split = splitTrackVelocity(
			indices.map((k) => placements[k].velocity),
			BASE_VELOCITY,
		);
		indices.forEach((k, i) => {
			velocities[k] = split.velocities[i];
		});
		if (trackVelocity.has(track)) volumes.set(track, split.volume);
	}
	for (const [track, v] of trackVelocity) {
		if (!byTrack.has(track)) volumes.set(track, v);
	}
	return { volumes, velocities };
};

/**
 * 再生専用プレイヤー（`mml-player.ts`）の1トラック分の変換。プレイヤー全体の音量
 * `playerVolume`（0〜100）に T を掛けたものをトラック音量にし、音符には相対 velocity を持たせる。
 * 発音の音量は (playerVolume × T/100)/100 × velocity/127 ≒ playerVolume/100 × v/127。
 */
export const playerTrackVelocity = (
	playerVolume: number,
	velocities: readonly number[],
): TrackVelocitySplit => {
	const split = splitTrackVelocity(velocities, BASE_VELOCITY);
	return {
		volume: (playerVolume * split.volume) / 100,
		velocities: split.velocities,
	};
};

/**
 * トラック音量を音符の velocity へ焼き込む（和音分解モードの書き出し用）。
 * 焼き込んだ音符は音量100のトラックとして書き出すと、元と同じ v になる。
 */
export const bakeTrackVelocity = <N extends { velocity?: number }>(
	notes: readonly N[],
	trackVolume: number,
): N[] =>
	notes.map((n) => ({
		...n,
		velocity: effectiveVelocity(trackVolume, n.velocity),
	}));
