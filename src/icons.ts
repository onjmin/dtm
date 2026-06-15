/**
 * インラインSVGアイコン。外部アイコンフォント(MDI等)への依存を避けるため、
 * 必要最小限のパスをライブラリ内に同梱する。
 */

type IconDef = { d: string; stroke?: boolean };

const ICONS: Record<string, IconDef> = {
	play: { d: "M8 5v14l11-7z" },
	pause: { d: "M6 5h4v14H6zm8 0h4v14h-4z" },
	stop: { d: "M6 6h12v12H6z" },
	record: { d: "M12 6a6 6 0 100 12 6 6 0 000-12z" },
	undo: { d: "M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6", stroke: true },
	redo: { d: "M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6", stroke: true },
	chevronUp: { d: "M5 15l7-7 7 7", stroke: true },
	chevronDown: { d: "M19 9l-7 7-7-7", stroke: true },
	chevronLeft: { d: "M15 19l-7-7 7-7", stroke: true },
	chevronRight: { d: "M9 5l7 7-7 7", stroke: true },
	first: { d: "M18 18l-6-6 6-6M11 18l-6-6 6-6", stroke: true },
	copy: {
		d: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z",
		stroke: true,
	},
};

/**
 * アイコン名からSVG文字列を生成する。
 */
export const icon = (name: keyof typeof ICONS | string, size = 20): string => {
	const def = ICONS[name];
	if (!def) return "";
	const paint = def.stroke
		? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
		: 'fill="currentColor"';
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${paint} aria-hidden="true"><path d="${def.d}"/></svg>`;
};

export type IconName = keyof typeof ICONS;
