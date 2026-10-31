/**
 * 2本目以降の同時再生音源（`#audio2=` 〜 `#audio8=`）の欄と再生。
 *
 * 1本目（`#audio=`。YouTube も読める）の仕組みはそのまま残し、ここは「外の歌声ソフトで
 * 作った歌の WAV」「別に録った伴奏」などを重ねるための追加の枠を受け持つ。
 * 読めるのは mp3 / wav 等のファイルと URL だけ（YouTube は1本目だけ）。
 *
 * 利用者の入力（URL・ファイル名）は DOM へ textContent / value でだけ入れ、HTML として
 * 組み立てない。URL は http / https だけ受ける。MML から来た URL は、共有リンクを開いた
 * だけで第三者の URL へ要求が飛ばないよう、最初の再生まで取りに行かない（1本目と同じ）。
 */

import { type BackingAudio, parseYoutubeId } from "../audio/backing-audio";
import {
	type ExtraAudioMeta,
	MAX_AUDIO_SOURCES,
	normalizeMediaUrl,
} from "../mml/mml-parser";
import { sanitizeText } from "../safe-text";

const DEFAULT_VOLUME = 80;
/** 読み込めるファイルの大きさの上限（デコードで全体をメモリに展開するため）。 */
const MAX_FILE_BYTES = 300 * 1024 * 1024;
/** ずれの範囲（秒）。MML に指数表記で書かれないよう、ここで絞る。 */
const MAX_OFFSET_SEC = 3600;

/** 追加の枠1本。 */
type Slot = {
	audio: BackingAudio;
	/** MML へ書ける身元。ファイル読み込みのときは空（受け取った相手は開けないため）。 */
	url: string;
	/** 開始のずれ（秒）。正なら音源が先（頭を飛ばす）、負なら打ち込みが先（後から入る）。 */
	offsetSec: number;
	volume: number;
	muted: boolean;
	/** MML から来て、まだ取りに行っていない。 */
	pending: boolean;
	row: HTMLElement;
	status: HTMLElement;
};

export type ExtraAudioPanel = {
	/** オーディオ同時再生の欄へ差し込む要素。 */
	el: HTMLElement;
	/** MML の `#audio2=` 〜 を読み込む（前の曲の枠は外す）。 */
	loadFromMeta: (extras: ExtraAudioMeta[] | undefined) => void;
	/** MML へ書き出す分（URL の枠だけ）。 */
	toMeta: () => ExtraAudioMeta[] | undefined;
	/** 再生の直前に、まだ取りに行っていない URL を読む。 */
	ensureLoaded: () => Promise<void>;
	/** 打ち込みの `fromSec` 秒の位置が `atTime` に鳴るよう、全部の枠を鳴らし始める。 */
	start: (fromSec: number, atTime: number) => void;
	stop: () => void;
	/** `fromSec` から再生したとき、いちばん長く鳴る枠があと何秒鳴るか。 */
	remainingSec: (fromSec: number) => number;
	destroy: () => void;
};

/**
 * URL として受けてよいか（http / https、YouTube 以外）。受けるときは、MML に書いても
 * 化けない形へそろえた URL（{@link normalizeMediaUrl}）を返す。以降はその URL だけを使う。
 */
export const checkExtraAudioUrl = (
	url: string,
): { ok: true; url: string } | { ok: false; reason: string } => {
	const normalized = normalizeMediaUrl(url);
	if (!normalized)
		return {
			ok: false,
			reason:
				"使えない URL です（http / https で、空白・; ・# などの記号を含まないもの）",
		};
	if (parseYoutubeId(normalized))
		return {
			ok: false,
			reason: "YouTube は1本目の音源だけで使えます",
		};
	return { ok: true, url: normalized };
};

export const createExtraAudioPanel = (options: {
	createAudio: () => BackingAudio;
	/** 再生中に音量・ずれを変えたとき、その場で合わせ直すための今の位置（秒）と時刻。 */
	getPlayingPosition: () => { fromSec: number; atTime: number } | null;
}): ExtraAudioPanel => {
	const slots: Slot[] = [];
	const el = document.createElement("div");
	el.className = "dtm-extra-audio";
	el.style.display = "flex";
	el.style.flexDirection = "column";
	el.style.gap = "6px";
	el.style.marginTop = "8px";
	el.style.paddingTop = "8px";
	el.style.borderTop = "1px dashed var(--dtm-border, #888)";

	const head = document.createElement("div");
	head.className = "dtm-row";
	const title = document.createElement("span");
	title.className = "dtm-label";
	title.textContent = "追加の音声（歌の WAV・別の伴奏など）";
	title.title =
		"外の歌声ソフトで作った歌や、別に録った伴奏を重ねます。mp3 / wav などのファイルか URL（YouTube は1本目だけ）";
	const spacer = document.createElement("span");
	spacer.className = "dtm-grow";
	const addBtn = document.createElement("button");
	addBtn.type = "button";
	addBtn.className = "dtm-btn dtm-btn--ghost";
	addBtn.textContent = "＋ 音声を追加";
	head.append(title, spacer, addBtn);
	const list = document.createElement("div");
	list.style.display = "flex";
	list.style.flexDirection = "column";
	list.style.gap = "6px";
	el.append(head, list);

	const updateAddButton = (): void => {
		addBtn.disabled = slots.length >= MAX_AUDIO_SOURCES - 1;
	};

	const setStatus = (slot: Slot, text: string, warn = false): void => {
		slot.status.textContent = text;
		slot.status.classList.toggle("dtm-hidden", text === "");
		slot.status.classList.toggle("dtm-audio-note--warn", warn);
	};

	const restartIfPlaying = (slot: Slot): void => {
		const pos = options.getPlayingPosition();
		if (!pos || !slot.audio.isLoaded()) return;
		startSlot(slot, pos.fromSec, pos.atTime);
	};

	const startSlot = (slot: Slot, fromSec: number, atTime: number): void => {
		if (!slot.audio.isLoaded()) return;
		slot.audio.start({ atTime, mediaSec: slot.offsetSec + fromSec });
	};

	const loadInto = async (slot: Slot, src: string | File): Promise<void> => {
		const fromFile = typeof src !== "string";
		setStatus(slot, "読み込み中…");
		try {
			const info = await slot.audio.load(src);
			slot.url = fromFile ? "" : src;
			slot.pending = false;
			slot.audio.setVolume(slot.volume);
			slot.audio.setMuted(slot.muted);
			const len = info.durationSec ? `、${info.durationSec.toFixed(1)}秒` : "";
			const note = info.routed
				? ""
				: "（この音源は録音・WAV書き出しに入りません）";
			setStatus(
				slot,
				`${fromFile ? "ファイル" : "URL"}: ${sanitizeText(info.label, 120)}${len}${fromFile ? "（ファイルは MML に書き出されません）" : ""}${note}`,
			);
		} catch (err) {
			slot.url = "";
			setStatus(
				slot,
				`読み込めませんでした: ${err instanceof Error ? err.message : String(err)}`,
				true,
			);
		}
	};

	const removeSlot = (slot: Slot): void => {
		slot.audio.destroy();
		slot.row.remove();
		slots.splice(slots.indexOf(slot), 1);
		updateAddButton();
	};

	const addSlot = (init?: ExtraAudioMeta): Slot | null => {
		if (slots.length >= MAX_AUDIO_SOURCES - 1) return null;
		const row = document.createElement("div");
		row.style.display = "flex";
		row.style.flexDirection = "column";
		row.style.gap = "4px";
		row.style.padding = "6px";
		row.style.border = "1px solid var(--dtm-border, #888)";

		const r1 = document.createElement("div");
		r1.className = "dtm-row";
		r1.style.flexWrap = "nowrap";
		const file = document.createElement("input");
		file.type = "file";
		file.className = "dtm-input dtm-grow";
		file.accept = "audio/*,.mp3,.wav,.ogg,.m4a,.flac";
		file.style.minWidth = "0";
		r1.append(file);

		const r2 = document.createElement("div");
		r2.className = "dtm-row";
		r2.style.flexWrap = "nowrap";
		const urlLabel = document.createElement("span");
		urlLabel.className = "dtm-label";
		urlLabel.textContent = "URL";
		const urlInput = document.createElement("input");
		urlInput.type = "url";
		urlInput.className = "dtm-input dtm-grow";
		urlInput.placeholder = "mp3 / wav の URL";
		urlInput.style.minWidth = "0";
		const urlBtn = document.createElement("button");
		urlBtn.type = "button";
		urlBtn.className = "dtm-btn dtm-btn--success";
		urlBtn.textContent = "読込";
		r2.append(urlLabel, urlInput, urlBtn);

		const status = document.createElement("p");
		status.className = "dtm-audio-note dtm-hidden";

		const r3 = document.createElement("div");
		r3.className = "dtm-row";
		r3.style.flexWrap = "wrap";
		const volLabel = document.createElement("span");
		volLabel.className = "dtm-label";
		volLabel.textContent = "音量";
		const vol = document.createElement("input");
		vol.type = "range";
		vol.className = "dtm-range dtm-grow";
		vol.min = "0";
		vol.max = "100";
		const volValue = document.createElement("span");
		volValue.className = "dtm-label";
		const muteLabel = document.createElement("label");
		muteLabel.className = "dtm-checkbox-label";
		const mute = document.createElement("input");
		mute.type = "checkbox";
		mute.className = "dtm-checkbox";
		muteLabel.append(mute, document.createTextNode(" ミュート"));
		r3.append(volLabel, vol, volValue, muteLabel);

		const r4 = document.createElement("div");
		r4.className = "dtm-row";
		r4.style.flexWrap = "wrap";
		const offLabel = document.createElement("span");
		offLabel.className = "dtm-label";
		offLabel.textContent = "ずれ（秒）";
		const off = document.createElement("input");
		off.type = "number";
		off.className = "dtm-input";
		off.step = "0.01";
		off.style.width = "88px";
		off.title =
			"0 なら打ち込みと同時に頭から鳴ります。正の数は音源の頭をその秒数飛ばし（音源が先）、負の数はその秒数あとから鳴らします（打ち込みが先）";
		const sp = document.createElement("span");
		sp.className = "dtm-grow";
		const removeBtn = document.createElement("button");
		removeBtn.type = "button";
		removeBtn.className = "dtm-btn dtm-btn--danger";
		removeBtn.textContent = "外す";
		r4.append(offLabel, off, sp, removeBtn);

		row.append(r1, r2, status, r3, r4);
		list.append(row);

		const slot: Slot = {
			audio: options.createAudio(),
			url: "",
			offsetSec: init?.offset ?? 0,
			volume: init?.volume ?? DEFAULT_VOLUME,
			muted: false,
			pending: false,
			row,
			status,
		};
		slots.push(slot);
		updateAddButton();

		vol.value = String(slot.volume);
		volValue.textContent = `${slot.volume}%`;
		off.value = String(slot.offsetSec);

		file.addEventListener("change", () => {
			const f = file.files?.[0];
			if (!f) return;
			// デコードはファイル全体をメモリに展開するので、大きすぎるものは読まない。
			if (f.size > MAX_FILE_BYTES) {
				setStatus(
					slot,
					`ファイルが大きすぎます（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB まで）`,
					true,
				);
				file.value = "";
				return;
			}
			urlInput.value = "";
			void loadInto(slot, f).then(() => restartIfPlaying(slot));
		});
		urlBtn.addEventListener("click", () => {
			const url = urlInput.value.trim();
			const check = checkExtraAudioUrl(url);
			if (!check.ok) {
				setStatus(slot, check.reason, true);
				return;
			}
			file.value = "";
			urlInput.value = check.url;
			void loadInto(slot, check.url).then(() => restartIfPlaying(slot));
		});
		vol.addEventListener("input", () => {
			const v = Number.parseInt(vol.value, 10);
			slot.volume = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 80;
			volValue.textContent = `${slot.volume}%`;
			slot.audio.setVolume(slot.volume);
		});
		mute.addEventListener("change", () => {
			slot.muted = mute.checked;
			slot.audio.setMuted(slot.muted);
		});
		off.addEventListener("change", () => {
			const v = Number.parseFloat(off.value);
			slot.offsetSec = Number.isFinite(v)
				? Math.max(-MAX_OFFSET_SEC, Math.min(MAX_OFFSET_SEC, v))
				: 0;
			off.value = String(slot.offsetSec);
			restartIfPlaying(slot);
		});
		removeBtn.addEventListener("click", () => removeSlot(slot));

		if (init?.url) {
			slot.url = init.url;
			slot.pending = true;
			urlInput.value = init.url;
			let host = init.url;
			try {
				host = new URL(init.url).host;
			} catch {
				// 表示だけなのでそのまま
			}
			setStatus(slot, `再生すると読み込みます（${host}）`);
		}
		return slot;
	};

	addBtn.addEventListener("click", () => {
		addSlot();
	});

	const clearAll = (): void => {
		for (const s of [...slots]) removeSlot(s);
	};

	return {
		el,
		loadFromMeta: (extras) => {
			clearAll();
			for (const e of (extras ?? []).slice(0, MAX_AUDIO_SOURCES - 1)) {
				const check = checkExtraAudioUrl(e.url);
				if (check.ok) addSlot({ ...e, url: check.url });
			}
		},
		toMeta: () => {
			const out = slots
				.filter((s) => s.url)
				.map((s) => ({
					url: s.url,
					offset: s.offsetSec || undefined,
					volume: s.volume,
				}));
			return out.length > 0 ? out : undefined;
		},
		ensureLoaded: async () => {
			await Promise.all(
				slots.filter((s) => s.pending && s.url).map((s) => loadInto(s, s.url)),
			);
		},
		start: (fromSec, atTime) => {
			for (const s of slots) startSlot(s, fromSec, atTime);
		},
		stop: () => {
			for (const s of slots) s.audio.stop();
		},
		remainingSec: (fromSec) =>
			slots.reduce((max, s) => {
				const d = s.audio.getLoaded()?.durationSec ?? 0;
				if (!d) return max;
				return Math.max(max, d - (s.offsetSec + fromSec));
			}, 0),
		destroy: clearAll,
	};
};
