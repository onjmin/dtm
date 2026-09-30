import assert from "node:assert/strict";
import {
	applyStripSettings,
	STRIP_DEFAULTS,
	type StripSettings,
} from "../src/audio/channel-strip";

// 再生専用プレイヤー（studio.play 等）はチャンネルストリップを曲をまたいで使い回す。
// 曲に書かれていない項目が前の曲の値のまま残ると、同じMMLでも直前に鳴らした曲次第で
// 音量が変わる（#t0comp=30 の曲の後だとコンプが掛かったまま約 +3 dB）。
// applyStripSettings が、書かれていない項目を必ず既定値へ戻すことを確かめる。

console.log("● channel-strip defaults tests");

/** 最後に設定された値だけを覚える、音を出さないストリップ。 */
const fakeStrip = () => {
	const v: Required<StripSettings> = {
		compression: -1,
		width: -1,
		eqLow: -1,
		eqMid: -1,
		eqHigh: -1,
		reverbSend: -1,
		delaySend: -1,
		pan: -1,
	};
	return {
		v,
		setCompression: (x: number) => {
			v.compression = x;
		},
		setWidth: (x: number) => {
			v.width = x;
		},
		setEqLow: (x: number) => {
			v.eqLow = x;
		},
		setEqMid: (x: number) => {
			v.eqMid = x;
		},
		setEqHigh: (x: number) => {
			v.eqHigh = x;
		},
		setReverbSend: (x: number) => {
			v.reverbSend = x;
		},
		setDelaySend: (x: number) => {
			v.delaySend = x;
		},
		setPan: (x: number) => {
			v.pan = x;
		},
	};
};

const neutral: Required<StripSettings> = {
	compression: STRIP_DEFAULTS.compression,
	width: STRIP_DEFAULTS.width,
	eqLow: STRIP_DEFAULTS.eq,
	eqMid: STRIP_DEFAULTS.eq,
	eqHigh: STRIP_DEFAULTS.eq,
	reverbSend: STRIP_DEFAULTS.send,
	delaySend: STRIP_DEFAULTS.send,
	pan: STRIP_DEFAULTS.pan,
};

// 1. 曲が指定した値はそのまま入る
const strip = fakeStrip();
const heavy: Required<StripSettings> = {
	compression: 30,
	width: 115,
	eqLow: 3,
	eqMid: -2,
	eqHigh: 4,
	reverbSend: 20,
	delaySend: 10,
	pan: -0.5,
};
applyStripSettings(strip, heavy);
assert.deepEqual(strip.v, heavy, "指定した値がストリップへ入ること");

// 2. 次の曲が何も指定しなければ、前の曲の設定は残らず既定値へ戻る
applyStripSettings(strip, {});
assert.deepEqual(
	strip.v,
	neutral,
	"指定の無い項目は前の曲の値を残さず既定値へ戻ること",
);

// 3. 一部だけ指定した曲では、指定した項目以外が既定値になる
applyStripSettings(strip, heavy);
applyStripSettings(strip, { width: 120 });
assert.deepEqual(
	strip.v,
	{ ...neutral, width: 120 },
	"一部だけ指定したときも残りは既定値になること",
);

console.log("  ✓ all channel-strip defaults tests passed");
