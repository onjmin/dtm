const getAssetUrl = (name: string): string => {
	if (typeof window === "undefined") {
		return `https://raw.githubusercontent.com/onjmin/dtm/main/assets/${name}.png`;
	}
	// @ts-ignore
	if (window.DTM_ASSETS_BASE_URL) {
		// @ts-ignore
		return `${window.DTM_ASSETS_BASE_URL}${name}.png`;
	}
	const hostname = window.location.hostname;
	const isDev =
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "[::1]";
	if (isDev) {
		return `assets/${name}.png`;
	}
	return `https://raw.githubusercontent.com/onjmin/dtm/main/assets/${name}.png`;
};

export const VOICE_IMAGES: Record<string, string> = {
	puyuyu: getAssetUrl("puyuyu"),
	rino: getAssetUrl("rino"),
	roze: getAssetUrl("roze"),
	ruko: getAssetUrl("ruko"),
	shiyo: getAssetUrl("shiyo"),
	teto: getAssetUrl("teto"),
	tsukuyomi: getAssetUrl("tsukuyomi"),
};
