/**
 * AddMusicK（AMK）MML 出力ユーティリティ。
 *
 * AddMusicK はスーパーマリオワールドの改造ROM向けの音楽挿入ツールで、SNES の音源チップ
 * SPC700 の上で動く N-SPC 系サウンドドライバ用の MML 方言を読む。dtm の MML とは別系統で、
 * 次の制約に合わせて書き出す。
 *
 * - **チャンネルは `#0`〜`#7` の8本、各チャンネル単音。** 和音のトラックは声部に分けて
 *   複数チャンネルへ割り当てる。8本に収まらない声部は捨て、件数を結果で返す。
 * - **音域は o1c〜o6b。** 外れた音はオクターブ単位で内側へ寄せる。
 * - **12平均律のみ。** 31平均律などの音は最寄りの半音へ丸める。
 * - **テンポは BPM ではない。** `t` 1 あたり約 2.44 BPM（500Hz タイマー × t/256 ティック毎秒、
 *   4分音符 = 48 ティック）なので `t = BPM × 0.4096` で換算する。
 * - **音長は 4分音符 = 48 ティック。** dtm の 1 ステップ（4分音符 = 48 ステップ）とちょうど
 *   1:1 なので、ずれずに書ける。`4` `8.` のように書けない長さは `=N`（ティック直指定）にする。
 *
 * 音源メモリ（ARAM 64KB）が小さいので、同じ小節の繰り返しはラベル付きループ
 * `(n)[...]m` と呼び出し `(n)m` にまとめて短くする。小節ごとに `o` を書き直すので、
 * どの小節を切り出しても前の状態に依存しない（小節をまたぐ音は次の小節頭の `^` でつなぐ）。
 *
 * ドラム（dtm ではパターン名で持つ）・音色（SoundFont）・エフェクトは書き出さない。
 * `@` 番号は SMW 標準楽器の番号で、役割から既定を選ぶ（{@link AMK_DEFAULT_INSTRUMENTS}）。
 */

import { unitsToMidi } from "../audio/tuning";
import type { Note } from "../types";
import { DTM_VERSION } from "../version";

/** AMK のチャンネル数。 */
export const AMK_MAX_CHANNELS = 8;
/** AMK の全音符のティック数（4分音符 = 48）。 */
const WHOLE_TICKS = 192;
/** 書ける音域（MIDI ノート番号）。o1c〜o6b。 */
const AMK_MIDI_LOW = 24;
const AMK_MIDI_HIGH = 95;
/** これより短い小節はループにまとめても短くならないので、そのまま書く。 */
const MIN_LOOP_TEXT_LENGTH = 8;

/**
 * 役割 → SMW 標準楽器の `@` 番号。
 * melody: @9 Piano / submelody: @0 Flute / chord: @1 String / bass: @8 Acoustic Bass。
 * 曲に合わせて差し替えられるよう、オプションで上書きできる。
 */
export const AMK_DEFAULT_INSTRUMENTS: Record<string, number> = {
	melody: 9,
	submelody: 0,
	chord: 1,
	bass: 8,
};

export type AmkTrackInput = {
	notes: Note[];
	/** トラック音量 0-100。省略時 100。 */
	volume?: number;
	/** 役割（melody / submelody / chord / bass）。`@` 番号の既定を選ぶのに使う。 */
	role?: string;
	/** チャンネルのコメントに書く名前。 */
	name?: string;
	/** `@` 番号を直接指定する（役割より優先）。 */
	instrument?: number;
};

export type AmkExportOptions = {
	bpm?: number;
	/** 1小節のステップ数（4分音符 = 48）。ループ検出の単位にもなる。省略時 192。 */
	stepsPerBar?: number;
	/** 先頭から何小節まで書き出すか。0 は制限なし。 */
	barLimit?: number;
	/** `#spc` ブロックの曲名。省略時はブロックごと書かない。 */
	title?: string;
	/** 役割 → `@` 番号の上書き。 */
	instruments?: Partial<Record<string, number>>;
	/** 繰り返しをループにまとめるか。省略時 true。 */
	compress?: boolean;
};

export type AmkExportResult = {
	/** AMK にそのまま渡せる MML テキスト。 */
	text: string;
	/** 使ったチャンネル数（0-8）。 */
	channelCount: number;
	/** 8チャンネルに収まらず捨てた声部の数。 */
	droppedVoiceCount: number;
	/** 音域外でオクターブを寄せた音の数。 */
	octaveShiftedCount: number;
	/** 半音へ丸めた（微分音だった）音の数。 */
	roundedPitchCount: number;
	/** 書き出した `t` の値。 */
	tempo: number;
};

/** BPM を AMK の `t` 値へ換算する（1-255）。 */
export const bpmToAmkTempo = (bpm: number): number =>
	Math.max(1, Math.min(255, Math.round(bpm * 0.4096)));

const NOTE_NAMES = [
	"c",
	"c+",
	"d",
	"d+",
	"e",
	"f",
	"f+",
	"g",
	"g+",
	"a",
	"a+",
	"b",
] as const;

/** ティック数を AMK の音長表記にする（全音符以下）。 */
const lengthToken = (ticks: number): string => {
	if (WHOLE_TICKS % ticks === 0) return String(WHOLE_TICKS / ticks);
	const base = (ticks * 2) / 3;
	if (Number.isInteger(base) && WHOLE_TICKS % base === 0) {
		return `${WHOLE_TICKS / base}.`;
	}
	return `=${ticks}`;
};

/** 任意長のティック数を `1^1^4` のように `^` でつないだ音長にする。 */
export const amkLength = (ticks: number): string => {
	const parts: string[] = [];
	let rest = ticks;
	while (rest > WHOLE_TICKS) {
		parts.push("1");
		rest -= WHOLE_TICKS;
	}
	parts.push(lengthToken(rest));
	return parts.join("^");
};

/**
 * 1トラックを、重ならない音の列（声部）に分ける。上の声部ほど高い音を取る。
 * 同じ開始位置・同じ高さの重複は 1 音にする。
 */
export const splitVoices = (notes: Note[], limitSteps: number): Note[][] => {
	const sorted = notes
		.filter((n) => n.durationSteps > 0 && n.startStep < limitSteps)
		.map((n) => ({
			...n,
			durationSteps: Math.min(n.durationSteps, limitSteps - n.startStep),
		}))
		.sort((a, b) => a.startStep - b.startStep || b.pitchUnits - a.pitchUnits);
	const voices: { notes: Note[]; end: number }[] = [];
	let prev: Note | undefined;
	for (const n of sorted) {
		if (
			prev &&
			prev.startStep === n.startStep &&
			prev.pitchUnits === n.pitchUnits
		) {
			continue;
		}
		prev = n;
		const voice = voices.find((v) => v.end <= n.startStep);
		if (voice) {
			voice.notes.push(n);
			voice.end = n.startStep + n.durationSteps;
		} else {
			voices.push({ notes: [n], end: n.startStep + n.durationSteps });
		}
	}
	return voices.map((v) => v.notes);
};

type PitchStats = { octaveShifted: number; rounded: number };

/** units → AMK で書ける MIDI ノート番号（音域内へ寄せ、半音へ丸める）。 */
const toAmkMidi = (pitchUnits: number, stats: PitchStats): number => {
	const exact = unitsToMidi(pitchUnits as Note["pitchUnits"]);
	let midi = Math.round(exact);
	if (Math.abs(exact - midi) > 1e-6) stats.rounded++;
	if (midi < AMK_MIDI_LOW || midi > AMK_MIDI_HIGH) stats.octaveShifted++;
	while (midi < AMK_MIDI_LOW) midi += 12;
	while (midi > AMK_MIDI_HIGH) midi -= 12;
	return midi;
};

/**
 * 1声部を小節ごとの MML 文字列にする。各小節は `o` から書き始めるので単独で成り立つ。
 * 小節をまたぐ音は小節線で切り、続きを次の小節頭の `^` で書く。
 */
const renderVoiceBars = (
	voice: Note[],
	barCount: number,
	stepsPerBar: number,
	stats: PitchStats,
): string[] => {
	const bars: string[] = [];
	let i = 0;
	for (let bar = 0; bar < barCount; bar++) {
		const barStart = bar * stepsPerBar;
		const barEnd = barStart + stepsPerBar;
		const out: string[] = [];
		let cursor = barStart;
		let octave = -1;
		// 前の小節から続いている音を含めるため、終わった音だけ読み飛ばす。
		while (
			i < voice.length &&
			voice[i].startStep + voice[i].durationSteps <= barStart
		) {
			i++;
		}
		for (let j = i; j < voice.length && voice[j].startStep < barEnd; j++) {
			const n = voice[j];
			const start = Math.max(n.startStep, barStart);
			const end = Math.min(n.startStep + n.durationSteps, barEnd);
			if (start > cursor) out.push(`r${amkLength(start - cursor)}`);
			if (n.startStep < barStart) {
				out.push(`^${amkLength(end - start)}`);
			} else {
				const midi = toAmkMidi(n.pitchUnits, stats);
				const o = Math.floor(midi / 12) - 1;
				if (octave === -1 || Math.abs(o - octave) > 1) out.push(`o${o}`);
				else if (o > octave) out.push(">");
				else if (o < octave) out.push("<");
				octave = o;
				out.push(`${NOTE_NAMES[midi % 12]}${amkLength(end - start)}`);
			}
			cursor = end;
		}
		if (cursor < barEnd) out.push(`r${amkLength(barEnd - cursor)}`);
		bars.push(out.join(""));
	}
	return bars;
};

type Run = { text: string; count: number };

/** 連続する同じ小節を 1 つにまとめる。 */
const toRuns = (bars: string[]): Run[] => {
	const runs: Run[] = [];
	for (const text of bars) {
		const last = runs[runs.length - 1];
		if (last && last.text === text) last.count++;
		else runs.push({ text, count: 1 });
	}
	return runs;
};

type Channel = {
	trackIndex: number;
	voiceIndex: number;
	voice: Note[];
	track: AmkTrackInput;
};

/**
 * 複数トラックを AddMusicK の MML テキストにする。
 *
 * チャンネルは、まず各トラックの第1声部（一番上の声）、余れば第2声部以降の順に割り当てる。
 * 和音の多いトラックが旋律やベースのチャンネルを奪わないようにするため。
 */
export const exportAMK = (
	tracks: AmkTrackInput[],
	options?: AmkExportOptions,
): AmkExportResult => {
	const bpm = options?.bpm ?? 120;
	const stepsPerBar = options?.stepsPerBar ?? 192;
	const barLimit = options?.barLimit ?? 0;
	const compress = options?.compress ?? true;
	const limitSteps =
		barLimit > 0 ? barLimit * stepsPerBar : Number.POSITIVE_INFINITY;
	const instruments = { ...AMK_DEFAULT_INSTRUMENTS, ...options?.instruments };

	const voicesByTrack = tracks.map((t) => splitVoices(t.notes, limitSteps));
	const candidates: Channel[] = [];
	const maxVoices = Math.max(0, ...voicesByTrack.map((v) => v.length));
	for (let v = 0; v < maxVoices; v++) {
		voicesByTrack.forEach((voices, trackIndex) => {
			if (voices[v]) {
				candidates.push({
					trackIndex,
					voiceIndex: v,
					voice: voices[v],
					track: tracks[trackIndex],
				});
			}
		});
	}
	const channels = candidates
		.slice(0, AMK_MAX_CHANNELS)
		.sort((a, b) => a.trackIndex - b.trackIndex || a.voiceIndex - b.voiceIndex);
	const droppedVoiceCount = candidates.length - channels.length;

	const songEnd = Math.max(
		0,
		...channels.flatMap((c) =>
			c.voice.map((n) => n.startStep + n.durationSteps),
		),
	);
	const barCount = Math.ceil(songEnd / stepsPerBar);
	const tempo = bpmToAmkTempo(bpm);
	const stats: PitchStats = { octaveShifted: 0, rounded: 0 };

	const channelRuns = channels.map((c) =>
		toRuns(renderVoiceBars(c.voice, barCount, stepsPerBar, stats)),
	);

	// 曲全体で 2 回以上出てくる小節（の連続）にラベルを振る。ラベルは曲全体で共通なので、
	// 別のチャンネルの同じフレーズも同じラベルで呼べる。
	const occurrences = new Map<string, number>();
	for (const runs of channelRuns) {
		for (const r of runs) {
			occurrences.set(r.text, (occurrences.get(r.text) ?? 0) + 1);
		}
	}
	const labels = new Map<string, number>();
	let nextLabel = 1;

	const lines: string[] = [
		"#amk 2",
		"",
		`; Exported from @onjmin/dtm v${DTM_VERSION}`,
		`; ${Math.round(bpm)} BPM -> t${tempo} / @番号は SMW 標準楽器（曲に合わせて差し替えてください）`,
		"; ドラム・SoundFont 音色・エフェクトは書き出していません",
	];
	const title = options?.title?.replace(/"/g, "").trim();
	if (title) {
		lines.push("", "#spc", "{", `\t#title "${title}"`, "}");
	}

	channels.forEach((c, ch) => {
		const runs = channelRuns[ch];
		const role = c.track.role ?? "melody";
		const inst =
			c.track.instrument ?? instruments[role] ?? instruments.melody ?? 0;
		const vol = Math.max(
			0,
			Math.min(255, Math.round((c.track.volume ?? 100) * 2.2)),
		);
		const name = (c.track.name ?? `Track ${c.trackIndex + 1}`).replace(
			/[\r\n]/g,
			" ",
		);
		const voiceLabel = c.voiceIndex > 0 ? ` (声部${c.voiceIndex + 1})` : "";
		lines.push("", `; ${name}${voiceLabel}`);
		const head = `#${ch} ${ch === 0 ? `t${tempo} ` : ""}@${inst} v${vol} y10`;

		const body: string[] = [];
		for (const r of runs) {
			const loopable = compress && r.text.length >= MIN_LOOP_TEXT_LENGTH;
			const countSuffix = r.count > 1 ? String(r.count) : "";
			if (loopable && (occurrences.get(r.text) ?? 0) > 1) {
				const label = labels.get(r.text);
				if (label === undefined) {
					labels.set(r.text, nextLabel);
					body.push(`(${nextLabel})[${r.text}]${countSuffix}`);
					nextLabel++;
				} else {
					body.push(`(${label})${r.count}`);
				}
			} else if (compress && r.count > 1) {
				body.push(`[${r.text}]${r.count}`);
			} else {
				for (let k = 0; k < r.count; k++) body.push(r.text);
			}
		}
		lines.push(head);
		// 1 行に 4 つずつ並べて読みやすくする。
		for (let k = 0; k < body.length; k += 4) {
			lines.push(body.slice(k, k + 4).join(" "));
		}
	});

	if (channels.length === 0)
		lines.push("", "; (有効なノートデータがありません)");

	return {
		text: `${lines.join("\n")}\n`,
		channelCount: channels.length,
		droppedVoiceCount,
		octaveShiftedCount: stats.octaveShifted,
		roundedPitchCount: stats.rounded,
		tempo,
	};
};
