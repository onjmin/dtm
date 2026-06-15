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
	pen: {
		d: "M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75 1.84-1.83zM3 17.25V21h3.75L17.81 9.93l-3.75-3.75L3 17.25z",
	},
	eraser: {
		d: "M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 01-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z",
	},
	select: {
		d: "M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2M4 11v2M20 11v2M11 4h2M11 20h2",
		stroke: true,
	},
	settings: {
		d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
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
