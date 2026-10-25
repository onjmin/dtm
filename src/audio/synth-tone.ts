/**
 * 内蔵シンセ（synth.ts）の音色を、トラックの楽器（GM プログラム番号）から決める。
 *
 * 内蔵シンセはオシレータ1本なので楽器そのものは再現しない。**波形・減衰の有無・アタック**の
 * 3つだけで「ベースは丸い・ピアノは減衰する・パッドはふわっと立ち上がる」程度の
 * 違いを付ける。音量は波形ごとに synth.ts の WAVE_LEVEL がそろえるので、ここでは決めない。
 *
 * 楽器の解決は DAW（studio.ts）と同じ順: `#t<n>inst=` → `#inst=` プリセットの役割の楽器。
 * どちらも無いトラックは undefined を返し、従来どおりの square 持続音で鳴る。
 */

import { INSTRUMENT_PRESETS } from "../instruments/instrument-presets";
import type { MmlMeta } from "../mml/mml-parser";
import { programOfInstrumentName } from "./audio-config";
import type { SynthTone } from "./synth";

/** GM プログラム番号(0-127) → 内蔵シンセの音色。区切りは amp-sim.ts の playStyleForProgram に合わせる。 */
export const synthToneForProgram = (program: number): SynthTone => {
	if (program <= 7) return { wave: "triangle", decay: true }; // ピアノ
	if (program <= 15) return { wave: "sine", decay: true }; // チェレスタ・鉄琴・マリンバ等
	if (program <= 20) return { wave: "square" }; // オルガン
	if (program <= 23) return { wave: "square", attack: 0.03 }; // アコーディオン・ハーモニカ
	if (program <= 28) return { wave: "sawtooth", decay: true }; // ギター（クリーン）
	if (program <= 31) return { wave: "sawtooth" }; // ギター（歪み・ハーモニクス）
	if (program <= 37) return { wave: "triangle", decay: true }; // 生・エレキベース
	if (program <= 39) return { wave: "sawtooth" }; // シンセベース
	if (program <= 44) return { wave: "sawtooth", attack: 0.06 }; // ヴァイオリン〜トレモロ弦
	if (program <= 47) return { wave: "triangle", decay: true }; // ピチカート・ハープ・ティンパニ
	if (program === 55) return { wave: "sawtooth", decay: true }; // オーケストラヒット
	if (program <= 54) return { wave: "sawtooth", attack: 0.08 }; // 弦アンサンブル・合唱
	if (program <= 63) return { wave: "sawtooth", attack: 0.02 }; // 金管
	if (program <= 71) return { wave: "square", attack: 0.02 }; // リード楽器（サックス・クラリネット等）
	if (program <= 79) return { wave: "sine", attack: 0.03 }; // 笛（フルート・リコーダー等）
	if (program === 80) return { wave: "square" }; // Lead 1 (square)
	if (program <= 87) return { wave: "sawtooth" }; // その他のシンセリード
	if (program <= 103) return { wave: "triangle", attack: 0.15 }; // シンセパッド・FX
	if (program <= 108) return { wave: "sawtooth", decay: true }; // シタール〜カリンバ
	if (program <= 111) return { wave: "square", attack: 0.03 }; // バグパイプ・フィドル・チャルメラ
	if (program <= 119) return { wave: "sine", decay: true }; // 打楽器系
	return {}; // 効果音（従来どおり）
};

/**
 * トラック番号(@n) → プリセットの役割。DAW（studio.ts の getRoleForTrackIndex）と同じ:
 * シンプルモードは 3 以上がすべて伴奏、上級者モードは 4 以上が役割なし（＝主旋律の楽器）。
 */
const roleForTrackIndex = (
	index: number,
	mode: MmlMeta["mode"],
): "melody" | "submelody" | "bass" | "chord" => {
	const roles = ["melody", "submelody", "bass", "chord"] as const;
	if (index < roles.length) return roles[index];
	return mode === "advanced" ? "melody" : "chord";
};

/** MML の宣言からトラックの内蔵シンセ音色を決める。楽器が決まらなければ undefined。 */
export const synthToneForTrack = (
	meta: Pick<MmlMeta, "instrument" | "trackInstruments" | "mode">,
	index: number,
): SynthTone | undefined => {
	const preset = meta.instrument
		? INSTRUMENT_PRESETS[meta.instrument]
		: undefined;
	const name =
		meta.trackInstruments?.[index] ??
		preset?.[roleForTrackIndex(index, meta.mode)];
	const program = name ? programOfInstrumentName(name) : null;
	return program === null ? undefined : synthToneForProgram(program);
};
