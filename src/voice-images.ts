// 内蔵キャラクター画像。assets/*.png をビルド時に base64 data URI 化して同梱する
// （tsup の dataurl ローダー）。外部URL依存・CORS・バージョンドリフトを回避するため。
import fallback from "../assets/404Chip.png";
import MGRoid from "../assets/MGRoid.png";
import MOTRoid from "../assets/MOTRoid.png";
import NYNRoid from "../assets/NYNRoid.png";
import puyuyu from "../assets/puyuyu.png";
import rei from "../assets/rei.png";
import rino from "../assets/rino.png";
import roze from "../assets/roze.png";
import ruko from "../assets/ruko.png";
import shiyo from "../assets/shiyo.png";
import teto from "../assets/teto.png";
import tsukuyomi from "../assets/tsukuyomi.png";

export const VOICE_IMAGES: Record<string, string> = {
	puyuyu,
	rino,
	roze,
	ruko,
	shiyo,
	teto,
	tsukuyomi,
	rei,
	MGRoid,
	MOTRoid,
	NYNRoid,
};

/**
 * カスタムボーカルアイコンの読み込み失敗時（URL不正・画像エラー・未指定）に
 * 使用するフォールバック画像（assets/404Chip.png の base64 data URI）。
 */
export const FALLBACK_VOCAL_ICON: string = fallback;
