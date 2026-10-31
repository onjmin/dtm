/**
 * NEUTRINO で歌わせる（試作）。
 *
 * koe・VOICEVOX とは別の経路。ブラウザから NEUTRINO を直接は動かせないので、利用者が
 * 公式から入れた NEUTRINO を手元で呼ぶ小さなサーバー（`scripts/misc/neutrino-server.ts`、
 * 既定 `http://127.0.0.1:50022`）に MusicXML を送って WAV を受け取る。dtm は NEUTRINO
 * 本体も歌声ライブラリも同梱しない（規約の解釈は docs/research/neutrino-terms.md）。
 *
 * フレーズの切り方は VOICEVOX と同じ（{@link buildVoicevoxPhrases}）。その楽譜（フレーム
 * 単位）を秒へ戻し、テンポ 60（4分音符＝1秒）の MusicXML に書く。
 */

import { sanitizeText } from "../safe-text";
import { normalizeExternalVoice } from "./voice-level";
import {
	buildVoicevoxPhrases,
	type TimedNote,
	timedToScore,
	VOICEVOX_FRAME_RATE,
	type VoicevoxScore,
	type VoicevoxScoreNote,
	type VoicevoxSourceNote,
} from "./voicevox-sing";

/** 既定のサーバーURL（VOICEVOX の 50021 の隣）。 */
export const NEUTRINO_DEFAULT_URL = "http://127.0.0.1:50022";

/** NEUTRINO の規約（歌い手を選んだときに出すリンク）。 */
export const NEUTRINO_TERMS_URL =
	"https://studio-neutrino.com/downloads/manual/EULA_NEUTRINO.pdf";

/** NEUTRINO の規約とは別に、キャラクター側の規約がある歌い手のリンク。 */
export type NeutrinoCharacterTerms = { label: string; url: string };

const KOTONOHA_TERMS: NeutrinoCharacterTerms = {
	label: "琴葉茜・葵（A.I.VOICE）",
	url: "https://aivoice.jp/character/kotonoha/",
};

/**
 * DAW の歌詞トラックで選べる NEUTRINO の歌い手（モデル名 → 歌声ライブラリ）。
 * モデル名は `nt_` で始める。`dir` は NEUTRINO の `model/` 以下のフォルダ名で、
 * 利用者がそのライブラリを入れていなければ鳴らない。`characterTerms` は、NEUTRINO の
 * 規約より厳しい条件がキャラクター側にある歌い手だけに付け、規約の表示で並べて出す。
 */
export const NEUTRINO_SINGERS: Record<
	string,
	{ dir: string; name: string; characterTerms?: NeutrinoCharacterTerms }
> = {
	nt_merrow: { dir: "MERROW", name: "NEUTRINO:めろう" },
	nt_nakumo: { dir: "NAKUMO", name: "NEUTRINO:ナクモ" },
	nt_reina: { dir: "REINA", name: "NEUTRINO:レイナ" },
	nt_soma: { dir: "SOMA", name: "NEUTRINO:ソウマ" },
	nt_runo: { dir: "RUNO", name: "NEUTRINO:ルノ" },
	// 琴葉茜・葵は別配布（株式会社エーアイの使用許諾契約書。商用・有償配布・同人活動は事前の問い合わせが要る）
	nt_akane: {
		dir: "AKANE",
		name: "NEUTRINO:琴葉茜",
		characterTerms: KOTONOHA_TERMS,
	},
	nt_aoi: {
		dir: "AOI",
		name: "NEUTRINO:琴葉葵",
		characterTerms: KOTONOHA_TERMS,
	},
};

/** NEUTRINO で歌うモデル名か。 */
export const isNeutrinoModel = (model: string): boolean =>
	Object.hasOwn(NEUTRINO_SINGERS, model.toLowerCase());

/** NEUTRINO の規約と並べて出す、キャラクター側の規約（無ければ undefined）。 */
export const neutrinoCharacterTerms = (
	model: string,
): NeutrinoCharacterTerms | undefined =>
	NEUTRINO_SINGERS[model.toLowerCase()]?.characterTerms;

/** MusicXML の4分音符あたりの分割数。テンポ 60 なので 1 分割 ≒ 1ms。 */
const DIVISIONS = 960;
/** 1小節（4/4）の分割数。 */
const MEASURE = DIVISIONS * 4;

const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

/** 1音の歌詞の長さの上限（1モーラのかななので、これより長いのは壊れた入力）。 */
const MAX_LYRIC_CHARS = 8;

/** 歌詞を XML の文字データへ。使えない文字を落としてから `& < >` をエスケープする。 */
const escapeXml = (s: string): string =>
	sanitizeText(s, MAX_LYRIC_CHARS)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

const pitchXml = (midi: number): string => {
	const pc = ((midi % 12) + 12) % 12;
	const octave = Math.floor(midi / 12) - 1;
	const alter = ALTERS[pc] ? `<alter>${ALTERS[pc]}</alter>` : "";
	return `<pitch><step>${STEPS[pc]}</step>${alter}<octave>${octave}</octave></pitch>`;
};

/**
 * VOICEVOX 形式の楽譜（フレーム単位）を NEUTRINO 用の MusicXML にする。
 *
 * 長さは秒をそのまま分割数へ写す（テンポ 60）。小節をまたぐ音はタイで分ける。
 * 歌詞はタイの頭にだけ付ける。`keyShift` は半音単位の移調。
 */
/** これより短い音・休符は、隣の音へまとめる（フレーム数。5 フレーム ≒ 53ms）。 */
const MIN_FRAGMENT_FRAMES = 5;

/**
 * 楽譜のごく短い休符・音を、隣の音へまとめる。
 *
 * 音の長さの丸め（約 10ms 単位）や、継続の音の高さの変わり目で区切った所から、30ms 前後の
 * 音や 10〜20ms の休符のかけらが出る。ENUNU（の楽譜変換 utaupy）はこれを長さ 0 として扱い、
 * 0 で割って落ちる（2026-11-01 の切り分けで、音 29ms・休符 20ms 以下で落ち、
 * 音 40ms・休符 30ms 以上は通った）。耳ではほぼ分からない長さなので、
 * - 音と音の間の短い休符は、直前の音を伸ばして埋める。
 * - 短い音は、直前が音ならそこへ、そうでなければ直後の音へ足す。
 * 長さが NaN・Infinity・0 以下のものは捨てる（MusicXML に "NaN" を書かない）。
 * 先頭と末尾の休符はそのまま残す。
 */
export const absorbTinyFragments = (
	notes: VoicevoxScoreNote[],
): VoicevoxScoreNote[] => {
	const out: VoicevoxScoreNote[] = notes
		.filter((n) => Number.isFinite(n.frame_length) && n.frame_length > 0)
		.map((n) => ({ ...n }));
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 1; i < out.length - 1; i++) {
			const n = out[i];
			if (n.frame_length >= MIN_FRAGMENT_FRAMES) continue;
			const prev = out[i - 1];
			const next = out[i + 1];
			if (n.key === null) {
				// 音と音の間の短い休符だけを埋める
				if (prev.key === null || next.key === null) continue;
				prev.frame_length += n.frame_length;
			} else if (prev.key !== null) {
				prev.frame_length += n.frame_length;
			} else if (next.key !== null) {
				next.frame_length += n.frame_length;
			} else {
				continue; // 前後とも休符の短い音はそのまま
			}
			out.splice(i, 1);
			changed = true;
			break;
		}
	}
	return out;
};

export const scoreToNeutrinoMusicXml = (
	score: VoicevoxScore,
	keyShift = 0,
): string => {
	// フレームを分割数へ。丸めの誤差が溜まらないよう、累積の位置で割る。
	type Ev = { start: number; end: number; note: VoicevoxScoreNote };
	const events: Ev[] = [];
	let frames = 0;
	const at = (f: number): number =>
		Math.round((f / VOICEVOX_FRAME_RATE) * DIVISIONS);
	const shift = Number.isFinite(keyShift) ? Math.trunc(keyShift) : 0;
	for (const note of absorbTinyFragments(score.notes)) {
		const start = at(frames);
		frames += note.frame_length;
		const end = at(frames);
		if (end > start) events.push({ start, end, note });
	}
	const total = events.length ? events[events.length - 1].end : 0;
	const measureCount = Math.max(1, Math.ceil(total / MEASURE));

	const measures: string[] = [];
	for (let m = 0; m < measureCount; m++) {
		const mStart = m * MEASURE;
		const mEnd = mStart + MEASURE;
		const body: string[] = [];
		if (m === 0) {
			body.push(
				`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>0</fifths></key>` +
					"<time><beats>4</beats><beat-type>4</beat-type></time>" +
					"<clef><sign>G</sign><line>2</line></clef></attributes>",
				'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>' +
					'<per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>',
			);
		}
		let filled = mStart;
		for (const ev of events) {
			const s = Math.max(ev.start, mStart);
			const e = Math.min(ev.end, mEnd);
			if (e <= s) continue;
			filled = e;
			const dur = e - s;
			const midi =
				ev.note.key === null || !Number.isFinite(ev.note.key)
					? null
					: Math.max(0, Math.min(127, Math.round(ev.note.key + shift)));
			if (midi === null) {
				body.push(`<note><rest/><duration>${dur}</duration></note>`);
				continue;
			}
			const tieStart = ev.end > mEnd;
			const tieStop = ev.start < mStart;
			const ties =
				(tieStop ? '<tie type="stop"/>' : "") +
				(tieStart ? '<tie type="start"/>' : "");
			const tied =
				(tieStop ? '<tied type="stop"/>' : "") +
				(tieStart ? '<tied type="start"/>' : "");
			const lyric = tieStop
				? ""
				: `<lyric number="1"><syllabic>single</syllabic><text>${escapeXml(ev.note.lyric)}</text></lyric>`;
			body.push(
				`<note>${pitchXml(midi)}<duration>${dur}</duration>${ties}` +
					(tied ? `<notations>${tied}</notations>` : "") +
					`${lyric}</note>`,
			);
		}
		// 最後の小節の残りは休符で埋める。
		if (filled < mEnd)
			body.push(`<note><rest/><duration>${mEnd - filled}</duration></note>`);
		measures.push(`<measure number="${m + 1}">${body.join("")}</measure>`);
	}

	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
		'<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>' +
		`<part id="P1">${measures.join("")}</part></score-partwise>\n`
	);
};

export type SynthesizeNeutrinoOptions = {
	/** 歌声ライブラリ（`model/` 以下のフォルダ名）。 */
	model: string;
	baseUrl?: string;
};

/** MusicXML を NEUTRINO のサーバーへ送り、WAV のバイト列を返す。 */
export const synthesizeNeutrino = async (
	musicXml: string,
	options: SynthesizeNeutrinoOptions,
): Promise<ArrayBuffer> => {
	const { model, baseUrl = NEUTRINO_DEFAULT_URL } = options;
	const res = await fetch(
		`${baseUrl}/sing?model=${encodeURIComponent(model)}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/xml" },
			body: musicXml,
		},
	);
	if (!res.ok)
		throw new Error(`${baseUrl}/sing: ${res.status} ${await res.text()}`);
	return res.arrayBuffer();
};

// ─────────────────────────────────────────────────────────────
// DAW から歌わせる（トラック1本を1回で合成し、フレーズに切って並べる）
// ─────────────────────────────────────────────────────────────

/** トラック頭の休符（子音を前倒しする余地。NEUTRINO は拍の少し前から子音を歌う）。 */
const TRACK_LEAD_SEC = 0.5;
/** トラック尻の休符（語尾の減衰を切らない余地）。 */
const TRACK_TAIL_SEC = 0.5;
/** フレーズの切り出しを、最初の音のこの秒数前から始める（子音の前倒しぶん）。 */
const SLICE_LEAD_SEC = 0.3;

/** {@link buildNeutrinoTrack} のフレーズ1つ。秒はすべてアンカー（曲頭）から。 */
export type NeutrinoPhrase<N> = {
	/** フレーズ最初の音の開始。 */
	startSec: number;
	/** 切り出しの頭から最初の音までの秒（`startSec - leadSec` から鳴らすと拍に合う）。 */
	leadSec: number;
	/** 合成した音声から切り出す範囲。隣のフレーズと重ならない。 */
	sliceStartSec: number;
	sliceEndSec: number;
	notes: N[];
};

/** {@link buildNeutrinoTrack} の結果。 */
export type NeutrinoTrack<N> = {
	/** トラック全体の楽譜（1回で合成する）。音の無いトラックは null。 */
	score: VoicevoxScore | null;
	/** 合成した音声の頭（0 秒）が、アンカーから何秒の所に当たるか。 */
	originSec: number;
	phrases: NeutrinoPhrase<N>[];
};

/**
 * 歌声ストリームの音から、トラック全体の楽譜とフレーズの切り出し範囲を作る。
 *
 * NEUTRINO は1回呼ぶたびに数秒の立ち上げがかかるので、フレーズごとではなくトラック全体を
 * 1回で合成する。フレーズの切り方は VOICEVOX と同じで、出来た音声をフレーズの範囲に
 * 切って並べる（シーク・ループ・途中から鳴らす処理を VOICEVOX と共通にするため）。
 */
export const buildNeutrinoTrack = <N extends VoicevoxSourceNote>(
	notes: N[],
): NeutrinoTrack<N> => {
	const phrases = buildVoicevoxPhrases(notes);
	const timed: TimedNote[] = [];
	const spans: { first: number; last: number; notes: N[] }[] = [];
	for (const p of phrases) {
		let t = p.startSec - p.leadSec;
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		for (const n of p.score.notes) {
			const d = n.frame_length / VOICEVOX_FRAME_RATE;
			if (n.key !== null) {
				timed.push({ start: t, end: t + d, key: n.key, lyric: n.lyric });
				first = Math.min(first, t);
				last = Math.max(last, t + d);
			}
			t += d;
		}
		if (first < last) spans.push({ first, last, notes: p.notes });
	}
	if (timed.length === 0) return { score: null, originSec: 0, phrases: [] };

	const leadFrames = Math.round(TRACK_LEAD_SEC * VOICEVOX_FRAME_RATE);
	const tailFrames = Math.round(TRACK_TAIL_SEC * VOICEVOX_FRAME_RATE);
	const score = timedToScore(timed, leadFrames, tailFrames);
	const originSec = timed[0].start - leadFrames / VOICEVOX_FRAME_RATE;
	const endSec = timed[timed.length - 1].end + TRACK_TAIL_SEC;

	// 切り出しの頭: 最初の音の少し前。ただし前のフレーズの最後の音より前には戻らない。
	const starts = spans.map((s, i) =>
		i === 0 ? originSec : Math.max(spans[i - 1].last, s.first - SLICE_LEAD_SEC),
	);
	return {
		score,
		originSec,
		phrases: spans.map((s, i) => ({
			startSec: s.first,
			leadSec: s.first - starts[i],
			sliceStartSec: starts[i],
			sliceEndSec: i + 1 < spans.length ? starts[i + 1] : endSec,
			notes: s.notes,
		})),
	};
};

/** 合成した音声から、アンカー基準の秒の範囲を切り出す。 */
export const sliceAudioBuffer = (
	ctx: BaseAudioContext,
	buffer: AudioBuffer,
	originSec: number,
	startSec: number,
	endSec: number,
): AudioBuffer | null => {
	const sr = buffer.sampleRate;
	const from = Math.max(0, Math.round((startSec - originSec) * sr));
	const to = Math.min(buffer.length, Math.round((endSec - originSec) * sr));
	if (to <= from) return null;
	const out = ctx.createBuffer(buffer.numberOfChannels, to - from, sr);
	for (let ch = 0; ch < buffer.numberOfChannels; ch++)
		out.copyToChannel(buffer.getChannelData(ch).subarray(from, to), ch);
	return out;
};

/** {@link createNeutrinoRenderer} の戻り値。 */
export type NeutrinoRenderer = {
	/**
	 * 楽譜を合成して AudioBuffer にする。同じ歌い手・同じ楽譜は1回だけ合成する。
	 * サーバーへは1件ずつ順に送る。失敗したら null（サーバー未起動・ライブラリ未導入など）。
	 */
	render: (model: string, score: VoicevoxScore) => Promise<AudioBuffer | null>;
};

/** ブラウザから NEUTRINO のサーバーを呼んで歌わせる係。 */
export const createNeutrinoRenderer = (
	ctx: BaseAudioContext,
	baseUrl: string = NEUTRINO_DEFAULT_URL,
	/** 警告に出すエンジン名と起動するスクリプト（OpenUtau の中継サーバーでも同じ係を使う）。 */
	engine: { label: string; script: string } = {
		label: "NEUTRINO",
		script: "scripts/misc/neutrino-server.ts",
	},
): NeutrinoRenderer => {
	const cache = new Map<string, Promise<AudioBuffer | null>>();
	let queue: Promise<unknown> = Promise.resolve();
	let warned = false;
	const render: NeutrinoRenderer["render"] = (model, score) => {
		const xml = scoreToNeutrinoMusicXml(score);
		const key = `${model}|${xml}`;
		const hit = cache.get(key);
		if (hit) return hit;
		const job = queue
			.catch(() => {})
			.then(() => synthesizeNeutrino(xml, { model, baseUrl }))
			.then((wav) => ctx.decodeAudioData(wav))
			// エンジン・歌い手ごとに違う素の大きさを、koe の声に近い大きさへそろえる
			.then(normalizeExternalVoice)
			.catch((err) => {
				if (!warned) {
					warned = true;
					console.warn(
						`[dtm] ${engine.label}（${baseUrl}）で歌えませんでした。${engine.script} を起動し、歌い手（${model}）を入れているか確かめてください`,
						err,
					);
				}
				cache.delete(key);
				return null;
			});
		queue = job;
		cache.set(key, job);
		return job;
	};
	return { render };
};
