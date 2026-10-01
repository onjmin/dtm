/**
 * 2小節の歌メロ素材の型。公開の自動作曲は手書きの素材から組み立てたもの（compose.ts の
 * `SYNTH_PHRASES`）だけを使う。耳コピから抜いたフレーズ集（`compose-phrases.ts`）は他人の曲の
 * 断片なので git にもバンドルにも入れず、scripts/ の実験からだけ渡す。
 */
export type CorpusPhrase = {
	/** 音価。正が音、負が休符。合計は必ず384。 */
	rhythm: number[];
	/** 各音の音階度数。1音目を0とする相対値で、7度＝1オクターブ。 */
	degrees: number[];
	/** 引くときの重み。 */
	weight: number;
};
