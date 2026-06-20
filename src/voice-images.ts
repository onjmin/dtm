// 内蔵キャラクター画像。assets/*.png をビルド時に base64 data URI 化して同梱する
// （tsup の dataurl ローダー）。外部URL依存・CORS・バージョンドリフトを回避するため。
import puyuyu from "../assets/puyuyu.png";
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
};
