/**
 * MML文字列を解析し、トラックごとのノート配置へ復元するローダ。
 *
 * 旧来 demo/index.html の `loadMML` をライブラリへ移植・整理したもの。
 * 実際のノート追加（MMLCore への反映）は呼び出し側で行う。
 */

const PITCH_MAP: Record<string, number> = {
	c: 0,
	d: 2,
	e: 4,
	f: 5,
	g: 7,
	a: 9,
	b: 11,
};

// @n → トラックインデックス（melody/submelody/bass/chord）。@4以上は bass(2) へ寄せる。
const TRACK_INDEX_COUNT = 4;

export type MMLNotePlacement = {
	/** 0:melody 1:submelody 2:bass 3:chord */
	trackIndex: number;
	startStep: number;
	pitch: number;
	durationSteps: number;
};

export type ParsedMML = {
	placements: MMLNotePlacement[];
	/** メロディトラックの t 指定から検出したBPM（無ければ null） */
	bpm: number | null;
};

export type ParseMMLOptions = {
	/** 1小節あたりのステップ数。既定192 */
	stepsPerBar?: number;
};

/**
 * MML文字列を解析してノート配置とBPMを返す。
 */
export const parseMML = (
	mml: string,
	options: ParseMMLOptions = {},
): ParsedMML => {
	const stepsPerBar = options.stepsPerBar ?? 192;
	const placements: MMLNotePlacement[] = [];
	let bpm: number | null = null;

	if (!mml) return { placements, bpm };

	// 1. コメント除去・改行畳み込み
	const fullMML = mml
		.replace(/\/\*[\s\S]*?\*\//g, "") // ブロックコメント
		.replace(/\/\/.*$/gm, "") // 行コメント
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
			if (idx >= TRACK_INDEX_COUNT) idx = 2; // @4以上はベースへ
			trackIndex = idx;
			octave = 4;
			currentStep = 0;
			baseLength = 16;
			continue;
		}

		const body = part.replace(/\s+/g, "").toLowerCase();
		let j = 0;

		const parseLength = (): number => {
			let numStr = "";
			while (j < body.length && /\d/.test(body[j])) {
				numStr += body[j];
				j++;
			}
			const len = numStr ? Number.parseInt(numStr, 10) : baseLength;
			let steps = Math.round(stepsPerBar / len);
			while (j < body.length && body[j] === ".") {
				steps = Math.round(steps * 1.5);
				j++;
			}
			return steps;
		};

		while (j < body.length) {
			const ch = body[j];

			if (ch === "o") {
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				octave = Number.parseInt(numStr, 10) || 4;
			} else if (ch === ">") {
				octave++;
				j++;
			} else if (ch === "<") {
				octave--;
				j++;
			} else if (ch === "l") {
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				baseLength = Number.parseInt(numStr, 10) || 16;
			} else if (ch === "r") {
				j++;
				currentStep += parseLength();
			} else if (ch === "t" || ch === "v" || ch === "q") {
				j++;
				let numStr = "";
				while (j < body.length && /\d/.test(body[j])) {
					numStr += body[j];
					j++;
				}
				if (ch === "t" && trackIndex === 0 && numStr) {
					bpm = Number.parseInt(numStr, 10);
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
						octave = Number.parseInt(numStr, 10) || 4;
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
				currentStep += steps;
			} else {
				j++;
			}
		}
	}

	return { placements, bpm };
};
