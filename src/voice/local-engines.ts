/**
 * 手元で起動したエンジン（VOICEVOX・NEUTRINO・OpenUtau）で歌う声の扱い。
 *
 * どれも利用者の PC の 127.0.0.1 で動くエンジンを呼ぶので、公開サイトの聴き手には
 * 鳴らせない。音源の選択肢には、dtm のページを手元（localhost・127.0.0.1・file:）で
 * 開いたときだけ出す。MML に書かれた値は読み込み・書き出しで保つ（消さない）。
 */

import { isNeutrinoModel } from "./neutrino-sing";
import { isOpenUtauModel } from "./openutau-sing";
import { isSinsyModel } from "./sinsy-sing";
import { isVoicevoxModel } from "./voicevox-sing";

/** 手元のエンジンで歌うモデル名か（VOICEVOX・NEUTRINO・OpenUtau）。 */
export const isLocalEngineModel = (model: string): boolean =>
	isVoicevoxModel(model) ||
	isNeutrinoModel(model) ||
	isOpenUtauModel(model) ||
	isSinsyModel(model);

/** dtm のページを手元で開いているか（localhost・127.x・::1・file:）。 */
export const isLocalPage = (
	loc: { protocol: string; hostname: string } | undefined = typeof location ===
	"undefined"
		? undefined
		: location,
): boolean => {
	if (!loc) return false;
	if (loc.protocol === "file:") return true;
	const host = loc.hostname.replace(/^\[|\]$/g, "");
	// `127.` で始まる公開ドメイン（127.example.com など）は手元ではない。IPv4 は数字4つで見る。
	return (
		host === "localhost" ||
		host === "::1" ||
		/^127(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host)
	);
};
