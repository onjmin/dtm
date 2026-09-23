/**
 * 内蔵の簡易square-wave synth + 合成ドラム音（synth-drums.ts）。
 *
 * もともと mml-player.ts の中にインラインで持っていたものを、DOM非依存の発音器として
 * 切り出したもの。これにより mountMmlPlayer（DOMビュー）と playMML（ヘッドレス）の双方が
 * 同じ発音ロジックを共有できる。
 *
 * 設計上、AudioContext と出力先ノードは「外から渡す」。これは利用側が自前のマスターGain /
 * ミキサーへルーティングしたり、SE と AudioContext を共有したりできるようにするため。
 */

import {
	createDrumKit,
	MIN_ATTACK_SEC,
	MIN_RELEASE_SEC,
	TAIL_RATIO,
} from "./synth-drums";
import { type Units, unitsToHz } from "./tuning";
import type { PlayDrumEvent, PlayNoteEvent } from "./types";

/**
 * ピッチ(units) → 周波数(Hz)。A4 = 2139 units = 440Hz 基準。
 * 単位は 1/372オクターブの整数（`tuning.ts` 参照）。12平均律・31平均律とも同じ式で鳴る。
 */
export const freqFromPitch = (pitchUnits: Units): number =>
	unitsToHz(pitchUnits);

export type Synth = {
	/** メロディックノートを発音する（PlayNoteEvent.when は ctx.currentTime からの相対秒） */
	playNote: (e: PlayNoteEvent) => void;
	/** ドラムノートを発音する（General MIDI のドラムキー番号で音色を分岐） */
	playDrum: (e: PlayDrumEvent) => void;
};

/** createSynth の音色設定。省略時は従来どおりの square 持続音。 */
export type SynthTone = {
	/** オシレータ波形。既定 "square" */
	wave?: OscillatorType;
	/** アタック秒（0 でも {@link MIN_ATTACK_SEC} だけは掛かる）。既定 0 */
	attack?: number;
	/** true でピアノ/ギター的な指数減衰（持続音でなく減衰音になる） */
	decay?: boolean;
	/** 波形ごとの聴感補正に使う音量倍率。既定 1 */
	gain?: number;
};

/**
 * AudioContext と出力先ノードを束ねた発音器を作る。
 * @param ctx 発音に使う AudioContext
 * @param destination 接続先（省略時は ctx.destination）。ゲーム側ミキサーへ繋ぐ用途。
 * @param tone 音色設定（波形・エンベロープ）。省略時は従来の square 持続音。
 */
export const createSynth = (
	ctx: AudioContext,
	destination: AudioNode = ctx.destination,
	tone: SynthTone = {},
): Synth => {
	const wave = tone.wave ?? "square";
	const attack = tone.attack ?? 0;
	const gainScale = tone.gain ?? 1;

	// 複数トラックが同時発音する際の合算クリッピングを防ぐ内部コンプレッサー。
	// 全オシレータ／ノイズはここへ繋ぎ、compressor → destination へ出力する。
	// 呼び出し側には見えない（API 変更なし）。
	const compressor = ctx.createDynamicsCompressor();
	compressor.threshold.value = -12; // dB: この水準を超えると圧縮開始
	compressor.knee.value = 6; // dB: ソフトニーで自然な圧縮感
	compressor.ratio.value = 8; // 8:1 で強めに抑制しクリップを防ぐ
	compressor.attack.value = 0.003; // 3ms: トランジェントを逃さず捕捉
	compressor.release.value = 0.15; // 150ms: 音符間で素早く回復
	compressor.connect(destination);

	const playNote = (e: PlayNoteEvent): void => {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = wave;
		osc.frequency.value = freqFromPitch(e.pitchUnits);
		const t0 = ctx.currentTime + e.when;
		const peak = Math.max(0.0001, 0.06 * e.volume * 1.5 * gainScale);
		// 指数減衰は 0 に到達できないので、到達点はピークからの比で決める。
		// 絶対値（旧: 0.001）だと音量の小さい音ほど「ピークに対して大きな段差」が残る。
		const tail = peak * TAIL_RATIO;
		// 消え際は最後だけ直線で 0 まで落とし、落とし切ってから停止する。
		// 振幅が残ったまま osc.stop() すると、その瞬間の値がそのまま段差＝プチノイズになる。
		const stopAt = t0 + e.duration + MIN_RELEASE_SEC;
		if (tone.decay) {
			// 減衰音（ピアノ/ギター系）: 立ち上がり後にノート長いっぱいで指数減衰
			gain.gain.setValueAtTime(0.0001, t0);
			gain.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.003, attack));
			gain.gain.exponentialRampToValueAtTime(tail, t0 + e.duration);
		} else {
			const releaseTime = Math.min(0.02, e.duration * 0.1);
			const sustainDuration = e.duration - releaseTime;
			// attack=0 でも最低限の立ち上がりを確保する。0 のまま無音→ピークへ飛ばすと
			// 発音の瞬間が段差になる（矩形波の角に紛れて気づきにくいが、同時発音数ぶん重なる）。
			const attackTime = Math.min(
				Math.max(attack, MIN_ATTACK_SEC),
				sustainDuration,
			);
			gain.gain.setValueAtTime(0.0001, t0);
			gain.gain.linearRampToValueAtTime(peak, t0 + attackTime);
			gain.gain.setValueAtTime(peak, t0 + sustainDuration);
			gain.gain.exponentialRampToValueAtTime(tail, t0 + e.duration);
		}
		gain.gain.linearRampToValueAtTime(0, stopAt);
		osc.connect(gain);
		// ステレオ定位（非対応環境では destination 直結）
		let panner: StereoPannerNode | null = null;
		if (typeof ctx.createStereoPanner === "function" && e.pan) {
			panner = ctx.createStereoPanner();
			panner.pan.value = Math.max(-1, Math.min(1, e.pan));
			gain.connect(panner);
			panner.connect(compressor);
		} else {
			gain.connect(compressor);
		}
		osc.start(t0);
		osc.stop(stopAt);

		osc.onended = () => {
			osc.disconnect();
			gain.disconnect();
			if (panner) panner.disconnect();
		};
	};

	const { playDrum } = createDrumKit(ctx, compressor);

	return { playNote, playDrum };
};
