/**
 * 内蔵の簡易square-wave synth + ノイズ系ドラム音。
 *
 * もともと mml-player.ts の中にインラインで持っていたものを、DOM非依存の発音器として
 * 切り出したもの。これにより mountMmlPlayer（DOMビュー）と playMML（ヘッドレス）の双方が
 * 同じ発音ロジックを共有できる。
 *
 * 設計上、AudioContext と出力先ノードは「外から渡す」。これは利用側が自前のマスターGain /
 * ミキサーへルーティングしたり、SE と AudioContext を共有したりできるようにするため。
 */

import { type Units, unitsToHz } from "./tuning";
import type { PlayDrumEvent, PlayNoteEvent } from "./types";

/**
 * ピッチ(units) → 周波数(Hz)。A4 = 2139 units = 440Hz 基準。
 * 単位は 1/372オクターブの整数（`tuning.ts` 参照）。12平均律・31平均律とも同じ式で鳴る。
 */
export const freqFromPitch = (pitchUnits: Units): number =>
	unitsToHz(pitchUnits);

// ── クリック（プチノイズ）対策の共通定数 ──
// 波形が1サンプルで飛ぶ（不連続になる）と、理論上あらゆる周波数を含むインパルスになり
// 「プチ」として聞こえる。無音→ピークの飛び／振幅を残したままの停止がその発生源なので、
// 立ち上がりと消え際に最低限の傾きを必ず入れる。

/** 立ち上がりに最低限確保する時間（秒）。1.5ms は聴感上ほぼ即時だが段差は消える。 */
const MIN_ATTACK_SEC = 0.0015;
/** 消え際に最低限確保する時間（秒）。ここで 0 まで落とし切ってから停止する。 */
const MIN_RELEASE_SEC = 0.004;
/** 指数減衰の到達点（ピークに対する比）。ここから直線で 0 へ繋ぐ。 */
const TAIL_RATIO = 0.001;

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

	// 簡易ドラム音。SoundFontを持たないため、キック/スネア/ハイハットを
	// オシレータ＋ノイズで近似する。pitch は General MIDI 準拠のドラムキー番号。
	const playDrum = (e: PlayDrumEvent): void => {
		const t0 = ctx.currentTime + e.when;
		const vol = Math.max(0.0001, Math.min(1, e.velocity));
		const isKick = e.pitch === 35 || e.pitch === 36;
		const isSnareLike = e.pitch === 38 || e.pitch === 39 || e.pitch === 40;
		if (isKick) {
			// キック: 低音サインのピッチダウン
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			const kickPeak = vol * 0.135;
			const kickDecayEnd = t0 + 0.18;
			const kickEnd = kickDecayEnd + MIN_RELEASE_SEC;
			osc.frequency.setValueAtTime(150, t0);
			osc.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
			g.gain.setValueAtTime(kickPeak, t0);
			g.gain.exponentialRampToValueAtTime(kickPeak * TAIL_RATIO, kickDecayEnd);
			// 旧実装は減衰後の振幅を保ったまま20ms鳴らして停止していた（＝停止点が段差）。
			g.gain.linearRampToValueAtTime(0, kickEnd);
			osc.connect(g).connect(compressor);
			osc.start(t0);
			osc.stop(kickEnd);
			osc.onended = () => {
				osc.disconnect();
				g.disconnect();
			};
			return;
		}
		// スネア/ハイハット/その他: ノイズバースト（スネアは帯域広め＋胴鳴り）
		const dur = isSnareLike ? 0.18 : 0.05;
		const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const filter = ctx.createBiquadFilter();
		filter.type = isSnareLike ? "bandpass" : "highpass";
		filter.frequency.value = isSnareLike ? 2000 : 8000;
		const g = ctx.createGain();
		const noisePeak = vol * (isSnareLike ? 0.105 : 0.06);
		// ノイズは最後のサンプルが乱数（=非ゼロ）なので、バッファの終わりまでに 0 へ
		// 落とし切らないと打ち切りの段差が残る。
		g.gain.setValueAtTime(noisePeak, t0);
		g.gain.exponentialRampToValueAtTime(
			noisePeak * TAIL_RATIO,
			t0 + dur - MIN_RELEASE_SEC,
		);
		g.gain.linearRampToValueAtTime(0, t0 + dur);
		src.connect(filter).connect(g).connect(compressor);
		src.start(t0);
		src.stop(t0 + dur);
		src.onended = () => {
			src.disconnect();
			filter.disconnect();
			g.disconnect();
		};
	};

	return { playNote, playDrum };
};
