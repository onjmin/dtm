/**
 * VOICEVOX の歌唱 API で歌わせる（試作）。
 *
 * koe（UTAU音源）とは別の経路。ブラウザで合成するのではなく、VOICEVOX エンジン
 * （既定 `http://127.0.0.1:50021`）に楽譜を送って WAV を受け取る。
 *
 * 流れ: ノート＋音節 → {@link buildVoicevoxScore}（VOICEVOX の Score）
 *   → `/sing_frame_audio_query`（歌唱ティーチャーが音素長とピッチを決める）
 *   → `/frame_synthesis`（ずんだもん等の歌唱スタイルで鳴らす）→ WAV。
 *
 * VOICEVOX の楽譜はフレーム単位（24000Hz / 256 = 93.75 フレーム/秒）。
 * 秒で累積してから丸めるので、長い曲でも丸め誤差は溜まらない。
 */

import { units, unitsToMidiDetune } from "../audio/tuning";
import { sanitizeText } from "../safe-text";
import type { LyricSyllable, Note } from "../types";

/** VOICEVOX 楽譜のフレームレート。 */
export const VOICEVOX_FRAME_RATE = 24000 / 256;

/** 既定のエンジンURL（VOICEVOX アプリ／エンジン単体の既定ポート）。 */
export const VOICEVOX_DEFAULT_URL = "http://127.0.0.1:50021";

/**
 * 歌唱ティーチャー（波音リツ）のスタイルID。音素長とピッチを決める役で、
 * 声色は {@link synthesizeVoicevoxSong} の `singer` が決める。
 */
export const VOICEVOX_SING_TEACHER = 6000;

/** ブレス（`、`）で前の音の尻を削って差し込む休符の長さ（秒）。 */
const BREATH_SECONDS = 0.12;

export type VoicevoxScoreNote = {
	/** MIDI ノート番号。休符は null。 */
	key: number | null;
	frame_length: number;
	/** 1モーラのかな。休符は空文字。 */
	lyric: string;
};

export type VoicevoxScore = { notes: VoicevoxScoreNote[] };

export type BuildVoicevoxScoreOptions = {
	/** 歌うトラックのノート（並びは問わない）。 */
	notes: Note[];
	/** `normalizeLyrics` の結果。startStep 昇順のノートと index で 1:1。 */
	syllables: LyricSyllable[];
	bpm: number;
	/** 1拍あたりのステップ数（dtm の既定は 48）。 */
	stepsPerBeat?: number;
};

/** 楽譜の1音（秒で持ち、最後にフレームへ割る）。 */
export type TimedNote = {
	start: number;
	end: number;
	key: number | null;
	lyric: string;
};

/**
 * 音節1つを VOICEVOX の歌詞へ。歌わない音節は null（休符にする）。
 *
 * 継続（`ー`）の音節は `normalizeLyrics` が直前の母音のかなを焼き込んでいるので、
 * そのまま1モーラとして渡せる（同じ高さなら呼び出し側で前の音へ結合する）。
 * 語り（`「…」`）は歌唱 API では鳴らせないので休符にする。
 */
const lyricOf = (syl: LyricSyllable | undefined): string | null => {
	if (!syl) return "ら";
	if (syl.kind === "rest" || syl.kind === "speak") return null;
	return syl.kana;
};

/**
 * ノートと音節から VOICEVOX の楽譜を組み立てる。
 *
 * 単旋律しか歌えないので、和音・重なりは UST 書き出しと同じく先勝ちで1本へ潰す。
 * 先頭には必ず休符を置く（VOICEVOX の楽譜の決まり）。
 */
export const buildVoicevoxScore = (
	options: BuildVoicevoxScoreOptions,
): VoicevoxScore => {
	const { notes, syllables, bpm, stepsPerBeat = 48 } = options;
	const secPerStep = 60 / bpm / stepsPerBeat;
	const sorted = [...notes]
		.map((note, index) => ({ note, syl: syllables[index] }))
		.sort((a, b) => a.note.startStep - b.note.startStep);

	const out: TimedNote[] = [];
	let cursor = 0;
	for (const { note, syl } of sorted) {
		const start = note.startStep * secPerStep;
		let end = (note.startStep + note.durationSteps) * secPerStep;
		if (start < cursor - 1e-9) continue; // 和音の下側・重なりは捨てる
		const lyric = lyricOf(syl);
		const { midi } = unitsToMidiDetune(note.pitchUnits);
		const prev = out[out.length - 1];
		if (lyric === null) {
			// 歌わない音は休符。直後の隙間と一緒にまとめて書く。
			cursor = end;
			continue;
		}
		if (
			syl?.kind === "tie" &&
			prev &&
			prev.key === midi &&
			Math.abs(prev.end - start) < 1e-9
		) {
			prev.end = end; // 同じ高さの継続は言い直さず伸ばす
		} else {
			out.push({ start, end, key: midi, lyric });
		}
		if (syl?.breathAfter) {
			const last = out[out.length - 1];
			const cut = Math.min(BREATH_SECONDS, (last.end - last.start) / 3);
			last.end -= cut;
			end = last.end;
		}
		cursor = end;
	}

	// 曲頭から歌い出す場合も、先頭の休符は最低限の長さを確保する。
	const frames = Math.max(
		8,
		Math.round((out[0]?.start ?? 0) * VOICEVOX_FRAME_RATE),
	);
	return timedToScore(out, frames, 8);
};

/**
 * 秒で並べた音を楽譜へ割る。先頭に `leadFrames` の休符、末尾に `tailFrames` の休符を置き、
 * 音の間の隙間も休符で埋める。先頭の休符の終わりが `out[0].start` に当たる。
 */
export const timedToScore = (
	out: TimedNote[],
	leadFrames: number,
	tailFrames: number,
): VoicevoxScore => {
	const origin = out[0]?.start ?? 0;
	const frames = (sec: number): number =>
		Math.round((sec - origin) * VOICEVOX_FRAME_RATE);
	const score: VoicevoxScoreNote[] = [
		{ key: null, frame_length: leadFrames, lyric: "" },
	];
	let at = origin;
	for (const n of out) {
		const gap = frames(n.start) - frames(at);
		if (gap > 0) {
			const last = score[score.length - 1];
			if (last.key === null) last.frame_length += gap;
			else score.push({ key: null, frame_length: gap, lyric: "" });
		}
		const length = frames(n.end) - frames(n.start);
		if (length > 0)
			score.push({ key: n.key, frame_length: length, lyric: n.lyric });
		at = n.end;
	}
	score.push({ key: null, frame_length: tailFrames, lyric: "" });
	return { notes: score };
};

// ─────────────────────────────────────────────────────────────
// DAW から歌わせる（フレーズ単位の合成）
// ─────────────────────────────────────────────────────────────

/**
 * DAW の歌詞トラックで選べる VOICEVOX の歌い手（モデル名 → 歌唱スタイル）。
 * モデル名は `vv_` で始める（koe 音源のキーワードと混ざらないように）。
 * スタイルIDは VOICEVOX 側で固定（0.26.0 の `/singers` で確かめた）。
 * `talk` は語り（`「…」`）を読み上げる同じキャラの話し声のスタイル（`/speakers` のノーマル）。
 */
export const VOICEVOX_SINGERS: Record<
	string,
	{ style: number; talk: number; name: string; terms: string }
> = {
	vv_zundamon: {
		talk: 3,
		style: 3003,
		name: "VOICEVOX:ずんだもん",
		terms: "https://voicevox.hiroshiba.jp/product/zundamon/",
	},
	vv_metan: {
		talk: 2,
		style: 3002,
		name: "VOICEVOX:四国めたん",
		terms: "https://voicevox.hiroshiba.jp/product/shikoku_metan/",
	},
	vv_tsumugi: {
		talk: 8,
		style: 3008,
		name: "VOICEVOX:春日部つむぎ",
		terms: "https://voicevox.hiroshiba.jp/product/kasukabe_tsumugi/",
	},
	vv_ritsu: {
		talk: 9,
		style: 3009,
		name: "VOICEVOX:波音リツ",
		terms: "https://voicevox.hiroshiba.jp/product/namine_ritsu/",
	},
};

/** VOICEVOX で歌うモデル名か。 */
export const isVoicevoxModel = (model: string): boolean =>
	Object.hasOwn(VOICEVOX_SINGERS, model.toLowerCase());

/** フレーズ1つぶんの楽譜。 */
export type VoicevoxPhrase<N> = {
	/** フレーズ最初の音の開始（アンカーからの秒）。 */
	startSec: number;
	/**
	 * 合成された音声の頭から、最初の音の開始までの秒。子音はこの休符の中に
	 * 前倒しで置かれるので、`startSec - leadSec` から鳴らすと拍に合う。
	 */
	leadSec: number;
	score: VoicevoxScore;
	/** このフレーズに入った元の音（再生中の表示用）。 */
	notes: N[];
};

/** フレーズ頭の休符（子音を前倒しする余地）。 */
const PHRASE_LEAD_FRAMES = 24;
/** フレーズ尻の休符（語尾の減衰を切らない余地）。 */
const PHRASE_TAIL_FRAMES = 16;
/** これ以上の隙間があればフレーズを切る（秒）。 */
const PHRASE_SPLIT_GAP_SEC = 0.3;

/** 母音 → 伸ばすときのかな（継続のピッチ推移で言い直さずに歌う音）。 */
const VOWEL_KANA: Record<string, string> = {
	a: "あ",
	i: "い",
	u: "う",
	e: "え",
	o: "お",
	N: "ん",
};

/** {@link buildVoicevoxPhrases} が読む、歌声ストリームの音の形（lyrics.ts の StreamVoiceNote）。 */
export type VoicevoxSourceNote = {
	syllable: LyricSyllable;
	pitch: number;
	startSec: number;
	durationSec: number;
	pitchSegments?: { pitch: number; atSec: number }[];
	breath?: boolean;
	phraseStart?: boolean;
};

/**
 * 歌声ストリームの音を、休符・ブレス・語りで区切ったフレーズへまとめる。
 *
 * 曲まるごと1回で合成すると、編集やシークのたびに全部を作り直すことになる。
 * フレーズ単位なら楽譜が同じフレーズはキャッシュが効き、最初のフレーズが
 * できた時点で鳴らし始められる。
 */
export const buildVoicevoxPhrases = <N extends VoicevoxSourceNote>(
	notes: N[],
): VoicevoxPhrase<N>[] => {
	const phrases: VoicevoxPhrase<N>[] = [];
	let timed: TimedNote[] = [];
	let members: N[] = [];
	const flush = (): void => {
		if (timed.length === 0) return;
		phrases.push({
			startSec: timed[0].start,
			leadSec: PHRASE_LEAD_FRAMES / VOICEVOX_FRAME_RATE,
			score: timedToScore(timed, PHRASE_LEAD_FRAMES, PHRASE_TAIL_FRAMES),
			notes: members,
		});
		timed = [];
		members = [];
	};
	for (const note of notes) {
		const syl = note.syllable;
		// 時刻が NaN・Infinity の音は楽譜に入れない（フレーム数が壊れるため）。
		if (!Number.isFinite(note.startSec) || !Number.isFinite(note.durationSec))
			continue;
		// 休符・語りは歌わず、フレーズもそこで切る。
		if (syl.kind === "rest" || syl.kind === "speak") {
			flush();
			continue;
		}
		// 促音・無声は鳴らさない（隙間として残る）。
		if (syl.consonant === "Q" || syl.vowel === "") continue;
		const prev = timed[timed.length - 1];
		const start = note.startSec;
		const end = note.startSec + note.durationSec;
		if (prev && start < prev.end - 1e-6) continue; // 和音・重なりは先勝ち
		if (prev && (note.phraseStart || start - prev.end > PHRASE_SPLIT_GAP_SEC))
			flush();
		const key = (pitch: number): number => unitsToMidiDetune(units(pitch)).midi;
		// 結合できなかった継続（隙間なく続く同じ高さ）は前の音を伸ばす。
		if (
			syl.kind === "tie" &&
			prev &&
			prev.key === key(note.pitch) &&
			start - prev.end < 1e-3 &&
			!note.pitchSegments?.length
		) {
			prev.end = end;
			members.push(note);
			if (note.breath) flush();
			continue;
		}
		// 継続で結合された音は、高さが変わる所だけ母音で区切る（VOICEVOX の楽譜は
		// 1音1高さなので）。同じ高さの区間は1音のまま伸ばす。
		const segments = note.pitchSegments ?? [];
		let segStart = start;
		let segKey = key(note.pitch);
		let lyric = syl.kana;
		for (const seg of segments) {
			if (key(seg.pitch) === segKey) continue;
			const at = Math.min(end, start + seg.atSec);
			if (at > segStart)
				timed.push({ start: segStart, end: at, key: segKey, lyric });
			segStart = at;
			segKey = key(seg.pitch);
			lyric = VOWEL_KANA[syl.vowel] ?? lyric;
		}
		if (end > segStart)
			timed.push({ start: segStart, end, key: segKey, lyric });
		members.push(note);
		if (note.breath) flush();
	}
	flush();
	return phrases;
};

/** `/singers` の1人ぶん（必要な所だけ）。 */
type VoicevoxSinger = {
	name: string;
	styles: { name: string; id: number; type?: string }[];
};

/**
 * 名前（部分一致）から歌唱用スタイルのIDを探す。見つからなければ null。
 * 歌唱用は `type` が `frame_decode`（ティーチャーは `sing`）。
 */
export const findVoicevoxSinger = async (
	name: string,
	baseUrl = VOICEVOX_DEFAULT_URL,
): Promise<{ id: number; label: string } | null> => {
	const res = await fetch(`${baseUrl}/singers`);
	if (!res.ok) throw new Error(`VOICEVOX /singers: ${res.status}`);
	const singers = (await res.json()) as VoicevoxSinger[];
	for (const singer of singers) {
		if (!singer.name.includes(name)) continue;
		const style =
			singer.styles.find((s) => s.type === "frame_decode") ?? singer.styles[0];
		if (style)
			return { id: style.id, label: `${singer.name}（${style.name}）` };
	}
	return null;
};

export type SynthesizeVoicevoxSongOptions = {
	/** 声色のスタイルID（{@link findVoicevoxSinger} で引く）。 */
	singer: number;
	baseUrl?: string;
	/** 音素長とピッチを決めるティーチャー。既定 {@link VOICEVOX_SING_TEACHER}。 */
	teacher?: number;
	/** 半音単位の移調（声域に合わないときに）。 */
	keyShift?: number;
	/** 0-2 程度。既定 1。 */
	volumeScale?: number;
};

/** 楽譜を VOICEVOX で歌わせ、WAV のバイト列を返す。 */
export const synthesizeVoicevoxSong = async (
	score: VoicevoxScore,
	options: SynthesizeVoicevoxSongOptions,
): Promise<ArrayBuffer> => {
	const {
		singer,
		baseUrl = VOICEVOX_DEFAULT_URL,
		teacher = VOICEVOX_SING_TEACHER,
		keyShift = 0,
		volumeScale,
	} = options;
	if (!Number.isInteger(teacher) || !Number.isInteger(singer))
		throw new Error("VOICEVOX のスタイルIDが不正です");
	const shift = Number.isFinite(keyShift) ? Math.trunc(keyShift) : 0;
	// NaN・Infinity の長さや高さを JSON に入れない（JSON.stringify は null に化かす）。
	const shifted: VoicevoxScore = {
		notes: score.notes
			.filter((n) => Number.isFinite(n.frame_length) && n.frame_length > 0)
			.map((n) =>
				n.key === null || !Number.isFinite(n.key)
					? { ...n, key: null, lyric: "" }
					: { ...n, key: Math.max(0, Math.min(127, n.key + shift)) },
			),
	};
	const json = { "Content-Type": "application/json" };
	const queryRes = await fetch(
		`${baseUrl}/sing_frame_audio_query?speaker=${teacher}`,
		{ method: "POST", headers: json, body: JSON.stringify(shifted) },
	);
	if (!queryRes.ok)
		throw new Error(
			`VOICEVOX /sing_frame_audio_query: ${queryRes.status} ${await queryRes.text()}`,
		);
	const query = await queryRes.json();
	if (volumeScale !== undefined) query.volumeScale = volumeScale;
	const wavRes = await fetch(`${baseUrl}/frame_synthesis?speaker=${singer}`, {
		method: "POST",
		headers: json,
		body: JSON.stringify(query),
	});
	if (!wavRes.ok)
		throw new Error(
			`VOICEVOX /frame_synthesis: ${wavRes.status} ${await wavRes.text()}`,
		);
	return wavRes.arrayBuffer();
};

/**
 * 語り（`「…」`）の本文を VOICEVOX の話し声で読み上げ、WAV のバイト列を返す。
 * 本文は漢字まじりのままエンジンに渡す（読みとアクセントはエンジンが決める）。
 */
/** 語り1つの本文の上限（文字数）。 */
const MAX_TALK_CHARS = 300;

export const synthesizeVoicevoxTalk = async (
	text: string,
	options: { speaker: number; baseUrl?: string },
): Promise<ArrayBuffer> => {
	const { speaker, baseUrl = VOICEVOX_DEFAULT_URL } = options;
	// 壊れたサロゲートで encodeURIComponent が投げない・長すぎる語りでエンジンを詰まらせないように。
	const safe = sanitizeText(text, MAX_TALK_CHARS);
	if (!safe) throw new Error("語りの本文が空です");
	if (!Number.isInteger(speaker) || speaker < 0)
		throw new Error(`VOICEVOX の話者IDが不正です: ${speaker}`);
	const queryRes = await fetch(
		`${baseUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(safe)}`,
		{ method: "POST" },
	);
	if (!queryRes.ok)
		throw new Error(
			`VOICEVOX /audio_query: ${queryRes.status} ${await queryRes.text()}`,
		);
	const query = await queryRes.json();
	const wavRes = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(query),
	});
	if (!wavRes.ok)
		throw new Error(
			`VOICEVOX /synthesis: ${wavRes.status} ${await wavRes.text()}`,
		);
	return wavRes.arrayBuffer();
};

/** {@link createVoicevoxRenderer} の戻り値。 */
export type VoicevoxRenderer = {
	/**
	 * 楽譜を合成して AudioBuffer にする。同じ歌い手・同じ楽譜は1回だけ合成する。
	 * エンジンへは1件ずつ順に送る（頼んだ順に出来上がるので、曲頭から埋まっていく）。
	 * 失敗したら null（エンジンが起動していない・歌えない歌詞など）。
	 */
	render: (style: number, score: VoicevoxScore) => Promise<AudioBuffer | null>;
	/** 語りを話し声で読み上げて AudioBuffer にする（同じ話者・同じ本文は1回だけ）。 */
	speak: (speaker: number, text: string) => Promise<AudioBuffer | null>;
};

/** ブラウザから VOICEVOX エンジンを呼んで歌わせる係。 */
export const createVoicevoxRenderer = (
	ctx: BaseAudioContext,
	baseUrl: string = VOICEVOX_DEFAULT_URL,
): VoicevoxRenderer => {
	const cache = new Map<string, Promise<AudioBuffer | null>>();
	let queue: Promise<unknown> = Promise.resolve();
	let warned = false;
	const enqueue = (
		key: string,
		synth: () => Promise<ArrayBuffer>,
	): Promise<AudioBuffer | null> => {
		const hit = cache.get(key);
		if (hit) return hit;
		const job = queue
			.catch(() => {})
			.then(synth)
			.then((wav) => ctx.decodeAudioData(wav))
			.catch((err) => {
				// エンジン未起動なら全フレーズが落ちるので、警告は1回だけ出す。
				if (!warned) {
					warned = true;
					console.warn(
						`[dtm] VOICEVOX（${baseUrl}）で歌えませんでした。エンジンが起動しているか確かめてください`,
						err,
					);
				}
				cache.delete(key); // 起動し直したら作り直せるように
				return null;
			});
		queue = job;
		cache.set(key, job);
		return job;
	};
	const render: VoicevoxRenderer["render"] = (style, score) =>
		enqueue(`${style}|${JSON.stringify(score.notes)}`, () =>
			synthesizeVoicevoxSong(score, { singer: style, baseUrl }),
		);
	const speak: VoicevoxRenderer["speak"] = (speaker, text) =>
		enqueue(`talk|${speaker}|${text}`, () =>
			synthesizeVoicevoxTalk(text, { speaker, baseUrl }),
		);
	return { render, speak };
};
