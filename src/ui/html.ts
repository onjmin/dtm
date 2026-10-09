/** テンプレート文字列で innerHTML を組むときに、文字列を本文・属性値どちらへ入れても安全にする。 */
export const escapeHtml = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
