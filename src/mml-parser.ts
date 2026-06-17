/**
 * MML文字列を解析し、トラックごとのノート配置へ復元するローダ。
 *
 * 旧来 demo/index.html の `loadMML` をライブラリへ移植・整理したもの。
 * 実際のノート追加（MMLCore への反映）は呼び出し側で行う。
 *
 * 歌詞専用行（@@n model lyrics）は演奏ノートではないため常に取り除く。
 * `collectLyrics` 指定時は解析済みの歌詞トラック辞書も併せて返す。
 */

import { parseLyrics, stripLyrics } from "./lyrics";
import type { LyricTrack } from "./types";

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

export type MMLNotePlacement = {
	/** 0:melody 1:submelody 2:bass 3:chord */
	trackIndex: number;
	startStep: number;
	pitch: number;
	durationSteps: number;
};

/** 再生ビュー用の表示トークン（mountMmlPlayer のノート列ハイライトに使う） */
export type MMLDisplayToken = {
	/** 正規化済みのトークン文字列（小文字・空白除去） */
	text: string;
	/** 発音開始ステップ。制御トークン（o/l/</>）は直近の currentStep */
	startStep: number;
	/** 長さステップ。制御トークンは 0（ハイライト対象外） */
	durationSteps: number;
	type: "note" | "chord" | "rest" | "octave" | "shift" | "length";
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
	const stepsPerBar = options.stepsPerBar ?? 192;
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
		};
	}

	// 1. コメント除去。歌詞行（@@n）の解析・除去は改行を畳み込む前に行う
	const noComments = mml
		.replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント
		.replace(/\/\/.*$/gm, ""); // 行コメント

	const lyrics = collectLyrics ? parseLyrics(noComments) : undefined;

	// 歌詞行を取り除いてから改行を畳み込む（@@n を演奏ノートと誤解釈しないため）
	const fullMML = stripLyrics(noComments)
		.replace(/[\n\r]+/g, " ")
		.trim();

	// 2. @(\d+) で分割
	const parts = fullMML.split(/(@\d+)/).filter((p) => p.trim().length > 0);

	let trackIndex = 0; // 既定はmelody
	let octave = 4;
	let currentStep = 0;
	let baseLength = 16;

	for (const rawPart of parts) {
		const part = rawPart.trim();

		// ヘッダー（@0,@1...）
		if (part.startsWith("@")) {
			let idx = Number.parseInt(part.substring(1), 10);
			// clampTrackCount 指定時のみ、超過チャンネルをベース(2)へ畳み込む
			if (clampTrackCount !== undefined && idx >= clampTrackCount) idx = 2;
			trackIndex = idx;
			octave = 4;
			currentStep = 0;
			baseLength = 16;
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
				octave = clamp(Number.parseInt(numStr, 10) || 4, 0, 8);
				pushTok("octave", currentStep, 0, tokStart);
			} else if (ch === ">") {
				octave++;
				j++;
				pushTok("shift", currentStep, 0, tokStart);
			} else if (ch === "<") {
				octave--;
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
				if (ch === "t" && trackIndex === 0 && numStr) {
					bpm = clamp(Number.parseInt(numStr, 10), 1, 255);
				}
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
						octave++;
						j++;
					} else if (c === "<") {
						octave--;
						j++;
					} else if (c === "o") {
						j++;
						let numStr = "";
						while (j < body.length && /\d/.test(body[j])) {
							numStr += body[j];
							j++;
						}
						octave = clamp(Number.parseInt(numStr, 10) || 4, 0, 8);
					} else {
						j++;
					}
				}
				if (j < body.length && body[j] === "]") j++;
				const steps = parseLength();
				for (const p of chordNotes) {
					placements.push({
						trackIndex,
						startStep: currentStep,
						pitch: p,
						durationSteps: Math.max(1, steps),
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
				placements.push({
					trackIndex,
					startStep: currentStep,
					pitch: midiPitch,
					durationSteps: Math.max(1, steps),
				});
				pushTok("note", currentStep, Math.max(1, steps), tokStart);
				currentStep += steps;
			} else {
				j++;
			}
		}
	}

	return {
		placements,
		bpm,
		tokenTracks: collectTokens ? tokenTracks : undefined,
		lyrics,
	};
};
