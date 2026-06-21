/**
 * playSingingMML — 歌声付き（@@n 歌詞トラック）のヘッドレス MML 再生。【未実装スタブ】
 *
 * 楽器・ドラムのみの {@link playMML} とは別関数として切り出す。歌声は重い WORLD 再合成・
 * worker のホスティング・非同期プリロードを伴うため、軽量な playMML に混ぜず分離する方針。
 * 中身は実質「mountMmlPlayer の音響経路（sequencer + 内蔵synth + 歌声ストリーム配線）から
 * DOM を抜いたもの」になる予定。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 実装メモ / 懸念事項（実装する人へ）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ■ 全体の構成（実装方針）
 *   1. parseMML(mml, { collectLyrics: true }) で placements / lyrics / meta を取る。
 *   2. 楽器トラックは playMML と同じく seqTracks 化 → createSequencer + createSynth で再生。
 *   3. 歌声は createSingingVoices(ctx, destination, { voiceWorkerUrl }) を生成し、
 *      mml-player.ts の buildStreamTracks 相当で StreamVoiceTrack[] を構築。
 *   4. loadModels → warm を await（ここがローディング相当）。完了後に
 *      seq.start(0) と voices.startStream(tracks, seq.getStartTime()) を「同じアンカー」で開始。
 *      ※ 既存の正準実装は mml-player.ts の startWhenReady()。ほぼそのまま流用できる。
 *
 * ■ 非同期プリロードがあるため、この関数は Promise を返す（fire-and-forget にしない）。
 *   loadModels/warm の完了を待ってから resolve する。待機中に stop された場合は起動しない
 *   ガードが要る（mml-player.ts の `if (!playing || activePlayer !== instance) return;` 相当）。
 *
 * ■ worker URL は利用側がホストする（必須）。createSingingVoices の voiceWorkerUrl に渡す。
 *   省略時はメインスレッド合成にフォールバックするが、BGM 用途では worker 必須を推奨。
 *   あるいは既存の singingVoices インスタンスを注入できるようにする（createDtmStudio と同様）。
 *
 * ■【最大の懸念】シームレスループと歌声ストリームが噛み合わない
 *   - 今回 sequencer に入れたループは「先読みタイムラインを永久に再アーム」する方式
 *     （sequencer.ts の loopBase += loopLengthSec）。楽器はこれで継ぎ目なくループする。
 *   - 一方 startStream は【1セッション制】。startStream を呼び直すと streamSession が増えて
 *     前のループが中断される（lyrics.ts:1402 / 1421）。よって「次周を裏で先行スケジュール」は
 *     前周をキャンセルしてしまうため不可。
 *   - さらに先読みは STREAM_LOOKAHEAD_SEC = 1.5 秒（lyrics.ts:1276）。曲末ぎりぎりで
 *     startStream を再発行すると、まだ合成待ちだった末尾〜1.5秒の歌が毎周ドロップする。
 *   → 「境界で呼び直す」方式は継ぎ目が汚れる/歌が欠ける。採用しないこと。
 *
 * ■【推奨する解】startStream 自体をループ対応にする（lyrics.ts の小改修）
 *   sequencer.ts と同じ要領で、startStream({ loopLengthSec }) を受け取り、runTrack の
 *   items を一巡したら i=0 に戻して内部オフセットへ loopLengthSec を加算する。
 *   1セッションのまま先読みが途切れず、継ぎ目もドロップも出ない。loopLengthSec は楽器側
 *   （sequencer の loopLengthSec）と同一値を共有すれば、伴奏と歌が同周期で永久に揃う。
 *   ※ この改修が入るまでは loop:true を歌入りで使うとズレる。下のガード参照。
 *
 * ■ AudioContext / visibility は playMML と同じ方針（ctx 所有権で suspend 権限を分ける）。
 *   ただし注入 ctx + 注入 destination を createSingingVoices にもそのまま渡すこと
 *   （歌声と楽器を同じミキサーへ流す）。
 *
 * ■ stop/destroy では seq.stop() に加えて voices.stopStream()（+ 内部生成なら ctx.close）
 *   とモデルの後始末（reset）を忘れない。
 *
 * 関連: {@link playMML}（楽器のみ）, mml-player.ts（DOM版の正準実装）, lyrics.ts（歌声合成）。
 */

import type { MmlPlayback, PlayMmlOptions } from "./headless-player";
import type { SingingVoices } from "./lyrics";

export type PlaySingingMmlOptions = PlayMmlOptions & {
	/**
	 * 歌声合成 Worker（`voice-worker.js`）のURL。利用側がホストして渡す。
	 * 省略時はメインスレッド合成へフォールバック（BGM用途では worker 推奨）。
	 */
	voiceWorkerUrl?: string;
	/**
	 * 既存の歌唱合成ヘルパを注入する（createDtmStudio と同様の配線を流用したい場合）。
	 * 指定時は voiceWorkerUrl より優先し、内部で createSingingVoices しない。
	 */
	singingVoices?: SingingVoices;
};

/**
 * 歌声付き MML を画面なしで再生する。【未実装】
 *
 * @throws 現状は常に未実装エラーを投げる。実装方針は本ファイル冒頭の実装メモを参照。
 */
export const playSingingMML = (
	_mml: string,
	_options: PlaySingingMmlOptions = {},
): Promise<MmlPlayback> => {
	// TODO: 実装する。手順は本ファイル冒頭の「実装メモ / 懸念事項」を参照。
	//   1. parseMML(collectLyrics) → 楽器は playMML 同様に seq+synth、歌声は
	//      createSingingVoices + buildStreamTracks 相当で配線（mml-player.ts を流用）。
	//   2. loadModels → warm を await してから seq.start と startStream を同一アンカーで開始。
	//   3. loop:true のシームレス化には startStream のループ対応（lyrics.ts 改修）が前提。
	//      それが入るまで loop は歌だけ1周で尽きてズレる点に注意（暫定で警告 or 非対応扱い）。
	return Promise.reject(
		new Error(
			"playSingingMML is not implemented yet. See implementation notes at the top of headless-singing-player.ts.",
		),
	);
};
