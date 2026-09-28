/**
 * ガイドツアー（スポットライト型ウォークスルー）。
 *
 * 画面を暗幕で覆い、対象要素だけをくり抜いて吹き出しで説明する。
 * 「解説はあるのに、どこを触ればいいのか分からない」を解消するための導線で、
 * このライブラリが持つ大量の `dtm-infobtn`（個別の解説モーダル）への入口も兼ねる。
 *
 * 単体で使える純粋なDOMユーティリティにしてある。`mountDAW` に依存しないので、
 * 埋め込み側が自分のUIを指すステップを書いて呼ぶこともできる。
 *
 *   startTour({ steps: DAW_TOUR_STEPS, root: dawRoot });
 *
 * 暗幕は `document.body` 直下に置く。`.dtm-daw` の外に出るため、スタイル側で
 * `.dtm-tour` にもデザイントークンを供給している（styles.ts の共有セレクタ参照）。
 */

/** ツアーの1ステップ。 */
export type TourStep = {
	/**
	 * ハイライトする要素。CSSセレクタ（`root` の中を検索）か、要素を返す関数。
	 * 省略すると画面中央のカードだけを出す（導入・締めのステップ向け）。
	 *
	 * 解決できない・非表示（`display:none` や 0 サイズ）の場合、そのステップは
	 * 自動的に飛ばされる。機能を切って使う利用者（`features.midi: false` 等）でも
	 * 存在しないUIを指して固まらないようにするため。
	 */
	target?: string | (() => Element | null | undefined);
	/** 吹き出しの見出し。 */
	title: string;
	/** 吹き出しの本文。HTMLを書ける。 */
	body: string;
	/**
	 * 吹き出しを対象の上下どちらに出すか。既定 `"auto"`（入る方を選ぶ）。
	 * 対象が画面に対して大きすぎる場合は `"auto"` でも画面下部に固定される。
	 */
	placement?: "auto" | "top" | "bottom";
	/**
	 * 表示直前に呼ばれる。対象要素（解決できていれば）が渡る。
	 * `false` を返すとこのステップを飛ばす。
	 */
	before?: (target: Element | null) => boolean | undefined;
	/**
	 * 目的別の分岐。指定すると「次へ」の代わりに選択肢ボタンを並べ、
	 * 選ばれた枝のステップ列で以降を差し替える。
	 *
	 * 「カバーを作りたい」「自動作曲したい」「自分で打ち込みたい」のように
	 * 入口の目的がはっきり分かれる場合、全員に同じ順路を歩かせるより短く終わる。
	 */
	branches?: TourBranch[];
};

/** {@link TourStep.branches} の選択肢。 */
export type TourBranch = {
	/** ボタンの見出し。 */
	label: string;
	/** 見出しの下に添える補足（省略可）。 */
	hint?: string;
	/** この枝を選んだときに続けて表示するステップ列。 */
	steps: TourStep[];
	/**
	 * この枝を出してよいか（省略時は常に出す）。表示の直前に評価する。
	 *
	 * 個々のステップは対象が無ければ勝手に飛ぶが、枝そのものは飛ばせない。
	 * 機能を切っている利用者に「カバー曲を作りたい」を見せて、選んだ先が
	 * 全部飛んで空になる——という行き止まりを防ぐために要る。
	 */
	when?: (root: ParentNode) => boolean;
};

/**
 * `selector` に一致する要素が実際に表示されているか。
 * {@link TourBranch.when} に書く「この機能、そもそもこの画面にある？」の判定用。
 */
export const isTourTargetVisible = (
	root: ParentNode,
	selector: string,
): boolean => {
	const el = root.querySelector(selector);
	return !!el && isVisible(el);
};

/** 吹き出しの文言。日本語以外へ差し替えるためのフック。 */
export type TourLabels = {
	next: string;
	prev: string;
	skip: string;
	/** 最終ステップの「次へ」に使う文言。 */
	done: string;
	/** 進捗表示（1始まりの現在位置と総数）。 */
	progress: (current: number, total: number) => string;
};

/** {@link startTour} のオプション。 */
export type TourOptions = {
	/** 表示するステップ列。空なら何もしない。 */
	steps: TourStep[];
	/**
	 * `target` にセレクタを書いたときの検索基点（既定 `document`）。
	 * DAWのルート要素を渡すと、同一ページに複数マウントしていても取り違えない。
	 */
	root?: ParentNode;
	/**
	 * 「もう見た」フラグの保存先キー（既定 `"dtm-tour-seen"`）。
	 * 最後まで進むか、スキップ／中断したときに記録する。`null` で記録しない。
	 */
	storageKey?: string | null;
	/** 文言の差し替え。 */
	labels?: Partial<TourLabels>;
	/** 終了時に呼ばれる。最後まで見たかどうかが渡る。 */
	onEnd?: (completed: boolean) => void;
};

/** {@link startTour} の戻り値。 */
export type TourInstance = {
	/** 次のステップへ。最終ステップでは終了する。 */
	next: () => void;
	/** 前のステップへ。 */
	prev: () => void;
	/** 中断して閉じる。 */
	stop: () => void;
	/** 表示中かどうか。 */
	isActive: () => boolean;
};

/** 「もう見た」フラグの既定の保存キー。 */
export const TOUR_STORAGE_KEY = "dtm-tour-seen";

/** ツアーを既に見たかどうか。初回だけ自動再生したいときの判定に使う。 */
export const hasSeenTour = (storageKey: string = TOUR_STORAGE_KEY): boolean => {
	try {
		return localStorage.getItem(storageKey) === "1";
	} catch {
		// プライベートモード等で localStorage が使えない環境。
		// 「見ていない」扱いにすると毎回自動再生されてしまうので、見た扱いにする。
		return true;
	}
};

/** 「もう見た」フラグを立てる。 */
export const markTourSeen = (storageKey: string = TOUR_STORAGE_KEY): void => {
	try {
		localStorage.setItem(storageKey, "1");
	} catch {}
};

/** 「もう見た」フラグを消す（ツアーをもう一度自動再生させたいとき用）。 */
export const clearTourSeen = (storageKey: string = TOUR_STORAGE_KEY): void => {
	try {
		localStorage.removeItem(storageKey);
	} catch {}
};

const DEFAULT_LABELS: TourLabels = {
	next: "次へ ▶",
	prev: "◀ 戻る",
	skip: "スキップ",
	done: "はじめる ▶",
	progress: (current, total) => `${current} / ${total}`,
};

/** 吹き出しの横幅（画面が狭いときは画面幅に合わせて縮む）。 */
const BUBBLE_WIDTH = 320;
/** 画面端・対象要素との最小の余白。 */
const MARGIN = 8;
/** くり抜きを対象より少し大きく取る量。 */
const SPOT_PAD = 6;

const isVisible = (el: Element): boolean => {
	// getClientRects() が空 = display:none か、閉じた <details> の中。
	// 0サイズの要素（dtm-hidden を当てた非表示パネル等）も対象外にする。
	const rect = el.getBoundingClientRect();
	return el.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
};

/**
 * 対象を包む閉じた `<details>` をすべて開く。開けたものを返すので、
 * ツアー終了時に元の開閉状態へ戻せる（パネルの開閉は localStorage に
 * 永続化されるため、ツアーが勝手に全部開いた状態を残さないようにする）。
 */
const openAncestorDetails = (el: Element): HTMLDetailsElement[] => {
	const opened: HTMLDetailsElement[] = [];
	let node: Element | null = el.parentElement;
	while (node) {
		if (node instanceof HTMLDetailsElement && !node.open) {
			node.open = true;
			opened.push(node);
		}
		node = node.parentElement;
	}
	return opened;
};

/**
 * ガイドツアーを開始する。既に別のツアーが動いていても、呼ぶ側で止める必要はない
 * （新しい方が古い方を閉じる）。
 */
export const startTour = (options: TourOptions): TourInstance => {
	// 分岐（{@link TourStep.branches}）で以降が差し替わるため再代入できるようにする。
	let steps: TourStep[] = options.steps ?? [];
	const root: ParentNode = options.root ?? document;
	const storageKey =
		options.storageKey === undefined ? TOUR_STORAGE_KEY : options.storageKey;
	const labels: TourLabels = { ...DEFAULT_LABELS, ...options.labels };

	if (steps.length === 0) {
		return {
			next: () => {},
			prev: () => {},
			stop: () => {},
			isActive: () => false,
		};
	}

	// 同時に2つ出さない。直前のツアーの暗幕が残っていたら片付ける。
	for (const stale of document.querySelectorAll(".dtm-tour")) stale.remove();

	const overlay = document.createElement("div");
	overlay.className = "dtm-tour";
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-modal", "true");
	overlay.innerHTML = `
<div class="dtm-tour-spot" data-tour="spot"></div>
<div class="dtm-tour-bubble" data-tour="bubble">
  <div class="dtm-tour-head">
    <span class="dtm-tour-progress" data-tour="progress"></span>
    <button type="button" class="dtm-tour-close" data-tour="close" aria-label="閉じる">&times;</button>
  </div>
  <div class="dtm-tour-title" data-tour="title"></div>
  <div class="dtm-tour-body" data-tour="body"></div>
  <div class="dtm-tour-foot">
    <button type="button" class="dtm-tour-btn dtm-tour-btn--ghost" data-tour="skip"></button>
    <span class="dtm-tour-spacer"></span>
    <button type="button" class="dtm-tour-btn dtm-tour-btn--ghost" data-tour="prev"></button>
    <button type="button" class="dtm-tour-btn dtm-tour-btn--primary" data-tour="next"></button>
  </div>
</div>`;

	const pick = <T extends HTMLElement>(name: string): T =>
		overlay.querySelector(`[data-tour="${name}"]`) as T;
	const spotEl = pick("spot");
	const bubbleEl = pick("bubble");
	const progressEl = pick("progress");
	const titleEl = pick("title");
	const bodyEl = pick("body");
	const skipBtn = pick<HTMLButtonElement>("skip");
	const prevBtn = pick<HTMLButtonElement>("prev");
	const nextBtn = pick<HTMLButtonElement>("next");
	const closeBtn = pick<HTMLButtonElement>("close");

	skipBtn.textContent = labels.skip;
	prevBtn.textContent = labels.prev;

	let index = 0;
	let active = true;
	let currentTarget: Element | null = null;
	/** ツアー中に開いた `<details>`。終了時に閉じ直す。 */
	const openedDetails = new Set<HTMLDetailsElement>();

	const resolveTarget = (step: TourStep): Element | null => {
		if (!step.target) return null;
		if (typeof step.target === "function") return step.target() ?? null;
		return root.querySelector(step.target);
	};

	/** 暗幕のくり抜きと吹き出しを、いまの対象の位置へ合わせる。 */
	const layout = (): void => {
		if (!active) return;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		if (!currentTarget) {
			// 対象なし（導入・締め）。くり抜きを畳んで画面中央にカードだけ出す。
			spotEl.style.opacity = "0";
			spotEl.style.width = "0px";
			spotEl.style.height = "0px";
			spotEl.style.left = `${vw / 2}px`;
			spotEl.style.top = `${vh / 2}px`;
			const w = Math.min(BUBBLE_WIDTH, vw - MARGIN * 2);
			bubbleEl.style.width = `${w}px`;
			bubbleEl.style.left = `${Math.round((vw - w) / 2)}px`;
			bubbleEl.style.top = `${Math.round(
				Math.max(MARGIN, (vh - bubbleEl.offsetHeight) / 2),
			)}px`;
			return;
		}

		const r = currentTarget.getBoundingClientRect();
		// 画面外へはみ出した分を切り詰める。くり抜きが画面外に伸びると、
		// 暗幕（box-shadow）の内側だけが妙に広く見えてしまう。
		const left = Math.max(0, r.left - SPOT_PAD);
		const top = Math.max(0, r.top - SPOT_PAD);
		const right = Math.min(vw, r.right + SPOT_PAD);
		const bottom = Math.min(vh, r.bottom + SPOT_PAD);
		spotEl.style.opacity = "1";
		spotEl.style.left = `${Math.round(left)}px`;
		spotEl.style.top = `${Math.round(top)}px`;
		spotEl.style.width = `${Math.round(Math.max(0, right - left))}px`;
		spotEl.style.height = `${Math.round(Math.max(0, bottom - top))}px`;

		const w = Math.min(BUBBLE_WIDTH, vw - MARGIN * 2);
		bubbleEl.style.width = `${w}px`;
		const h = bubbleEl.offsetHeight;

		const spaceBelow = vh - bottom - MARGIN;
		const spaceAbove = top - MARGIN;
		const placement = steps[index]?.placement ?? "auto";
		let wantBelow: boolean;
		if (placement === "top") wantBelow = false;
		else if (placement === "bottom") wantBelow = true;
		else wantBelow = spaceBelow >= h || spaceBelow >= spaceAbove;

		let bubbleTop: number;
		if (wantBelow && spaceBelow >= h) bubbleTop = bottom + MARGIN;
		else if (!wantBelow && spaceAbove >= h) bubbleTop = top - MARGIN - h;
		else {
			// 上下どちらにも入らない（対象が画面いっぱい等）。広い方の端に寄せる。
			bubbleTop = spaceBelow >= spaceAbove ? vh - h - MARGIN : MARGIN;
		}
		bubbleEl.style.top = `${Math.round(
			Math.min(Math.max(MARGIN, bubbleTop), Math.max(MARGIN, vh - h - MARGIN)),
		)}px`;

		const centered = r.left + r.width / 2 - w / 2;
		bubbleEl.style.left = `${Math.round(
			Math.min(Math.max(MARGIN, centered), Math.max(MARGIN, vw - w - MARGIN)),
		)}px`;
	};

	const onViewportChange = () => layout();

	const end = (completed: boolean): void => {
		if (!active) return;
		active = false;
		window.removeEventListener("resize", onViewportChange);
		window.removeEventListener("scroll", onViewportChange, true);
		document.removeEventListener("keydown", onKeyDown, true);
		// ツアーのために開いたパネルは閉じ直す（開閉状態は永続化されるため）。
		for (const d of openedDetails) d.open = false;
		openedDetails.clear();
		overlay.remove();
		if (storageKey) markTourSeen(storageKey);
		options.onEnd?.(completed);
	};

	/**
	 * `index` のステップを表示する。対象が見つからない・非表示・`before` が
	 * `false` を返した場合は `dir` の向きに読み飛ばす。
	 */
	const show = (dir: 1 | -1): void => {
		while (index >= 0 && index < steps.length) {
			const step = steps[index];
			let el = resolveTarget(step);

			// 閉じた <details> の中にある要素は、開くまで採寸できない。
			if (el) {
				for (const d of openAncestorDetails(el)) openedDetails.add(d);
			}

			if (step.before?.(el) === false) {
				index += dir;
				continue;
			}
			// before で対象が現れることがあるので引き直す。
			if (step.target && !el) el = resolveTarget(step);
			if (step.target && (!el || !isVisible(el))) {
				index += dir;
				continue;
			}

			currentTarget = el;
			titleEl.textContent = step.title;
			bodyEl.innerHTML = step.body;
			prevBtn.style.visibility = index === 0 ? "hidden" : "";

			// この画面に存在しない機能の枝は出さない（選んだ先が全部飛ぶ行き止まりになる）。
			const branches = step.branches?.filter((b) => b.when?.(root) !== false);
			if (branches?.length) {
				// 分岐ステップでは総数が未確定なので進捗を出さない。
				progressEl.textContent = "";
				nextBtn.style.display = "none";
				const wrap = document.createElement("div");
				wrap.className = "dtm-tour-branches";
				for (const branch of branches) {
					const btn = document.createElement("button");
					btn.type = "button";
					btn.className = "dtm-tour-branch";
					const label = document.createElement("span");
					label.className = "dtm-tour-branch-label";
					label.textContent = branch.label;
					btn.appendChild(label);
					if (branch.hint) {
						const hint = document.createElement("span");
						hint.className = "dtm-tour-branch-hint";
						hint.textContent = branch.hint;
						btn.appendChild(hint);
					}
					btn.addEventListener("click", () => {
						// この枝より後ろを丸ごと差し替える。戻って選び直せば上書きされる。
						steps = [...steps.slice(0, index + 1), ...branch.steps];
						next();
					});
					wrap.appendChild(btn);
				}
				bodyEl.appendChild(wrap);
			} else {
				progressEl.textContent = labels.progress(index + 1, steps.length);
				nextBtn.style.display = "";
				nextBtn.textContent =
					index === steps.length - 1 ? labels.done : labels.next;
			}

			if (el) {
				el.scrollIntoView({ block: "center", inline: "nearest" });
			}
			// スクロール反映後の座標で採寸する。
			requestAnimationFrame(() => {
				layout();
				// スムーススクロール中の測り損ねを拾い直す保険。
				requestAnimationFrame(layout);
			});
			return;
		}
		// 端まで読み飛ばした。前方向なら完走、後ろ方向なら先頭に留まる。
		if (dir === 1) {
			end(true);
		} else {
			index = 0;
			show(1);
		}
	};

	const next = (): void => {
		if (!active) return;
		if (index >= steps.length - 1) {
			end(true);
			return;
		}
		index += 1;
		show(1);
	};

	const prev = (): void => {
		if (!active || index === 0) return;
		index -= 1;
		show(-1);
	};

	function onKeyDown(e: KeyboardEvent): void {
		if (!active) return;
		if (e.key === "Escape") {
			e.preventDefault();
			end(false);
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			next();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			prev();
		}
	}

	nextBtn.addEventListener("click", next);
	prevBtn.addEventListener("click", prev);
	skipBtn.addEventListener("click", () => end(false));
	closeBtn.addEventListener("click", () => end(false));
	// 暗幕そのもののクリックでは進めない（ボタン以外は素通りさせない）。
	// 誤タップで飛ばされると「読む前に消えた」になり、ツアーの意味がなくなる。

	window.addEventListener("resize", onViewportChange);
	window.addEventListener("scroll", onViewportChange, true);
	document.addEventListener("keydown", onKeyDown, true);

	document.body.appendChild(overlay);
	show(1);
	nextBtn.focus({ preventScroll: true });

	return {
		next,
		prev,
		stop: () => end(false),
		isActive: () => active,
	};
};

/**
 * どの枝でも最後に付ける締め。ヘルプボタン＝再訪できる入口だと知らせる。
 * ヘルプボタンを出していない利用者の画面では自動的に飛ばされる。
 */
const CLOSING_STEP: TourStep = {
	target: '[data-dtm="help"]',
	title: "困ったらここ",
	body: `<p>この <b>「?」ボタン</b> から、このツアーをいつでもやり直せます。
別の目的のツアーも選び直せます。</p>
<p>画面のあちこちにある <b>ⓘ</b> は、その項目だけの詳しい解説です。</p>
<p>それでは、良い音楽を！</p>`,
};

/** 再生まわり。3つの枝すべてで要るので共通化する。 */
const PLAY_STEP: TourStep = {
	target: '[data-dtm="play"]',
	title: "聴いてみる",
	body: `<p>再生ボタンです。右の <b>BPM</b> で曲の速さを変えられます。</p>
<p><b>ソロ</b>にチェックを入れると、いま選んでいるトラックだけが鳴ります。
「このパートだけ確認したい」ときに使います。</p>`,
};

/** 書き出し・共有。 */
const EXPORT_STEP: TourStep = {
	target: '[data-dtm-acc="io-out"] > summary',
	title: "書き出す・共有する",
	body: `<p>作った曲は <b>MIDI</b> や <b>MML</b>（テキストの楽譜）として書き出せます。</p>
<p>MMLは短いテキストなので、そのままコピーして人に渡せます。</p>`,
};

/**
 * ① カバー曲を作りたい人向け。
 *
 * 原曲・カラオケ音源を鳴らしながら重ねて打ち込む導線。このアプリを選ぶ一番の理由に
 * なり得る機能なので、いきなりオーディオパネルまで連れて行く。
 */
const COVER_STEPS: TourStep[] = [
	{
		target: '[data-dtm="audio-panel"] > summary',
		title: "① ここに音源を読み込む",
		body: `<p><b>オーディオ同時再生</b>パネルです。原曲やカラオケ音源を、
打ち込みと<b>一緒に鳴らしながら</b>作業できます。</p>
<p>手持ちのファイルのほか、<b>mp3 / wav のURL</b> や <b>YouTubeのURL</b> もそのまま貼れます。</p>`,
	},
	{
		target: '[data-dtm="audio-offset"]',
		title: "② 頭を合わせる",
		body: `<p>音源と打ち込みの<b>始まりのズレ</b>を指定します。</p>
<ul>
<li>前奏が長い音源なら「<b>音源</b>が先、<b>6.2秒</b>後に打ち込み開始」</li>
<li>曲の途中から重ねたいなら「<b>打ち込み</b>が先」に切り替え</li>
</ul>
<p>音符は動きません。ズレるのは再生の開始時刻だけなので、<b>いつでも直せます</b>。</p>`,
	},
	{
		target: '[data-dtm="audio-start"]',
		title: "③ 必要な部分だけ切り出す",
		body: `<p>サビだけコピーしたいときは、音源の<b>使う範囲</b>を決めます。</p>
<p><code>0:12.500</code> のように分:秒.ミリ秒でも、<code>12.5</code> と秒だけでも書けます。
終了を空欄にすると最後まで鳴ります。</p>`,
	},
	{
		target: '[data-dtm="audio-mute"]',
		title: "④ 聴き比べる",
		body: `<p><b>ミュート</b>を入れると音源が止まり、<b>打ち込みだけ</b>を聴けます。</p>
<p>「原曲と重ねて確認 → ミュートして自分の音だけ確認」を往復するのが、
耳コピが一番はかどる使い方です。音量スライダーでバランスも取れます。</p>`,
	},
	{
		target: '[data-dtm="roll"]',
		title: "⑤ 重ねて打ち込む",
		body: `<p>あとは音源を鳴らしながら、この格子（<b>ピアノロール</b>）をタップして音符を置くだけ。</p>
<p><b>横</b>が時間、<b>縦</b>が音の高さ（上ほど高い）。もう一度押すと消え、
音符の端をドラッグすると長さが変わります。</p>`,
	},
	PLAY_STEP,
	EXPORT_STEP,
	CLOSING_STEP,
];

/**
 * ② とりあえず自動で曲が欲しい人向け。
 *
 * 最短で音が出るところまで連れて行く。細かい編集の話は一切しない
 * （必要になった人はヘルプから打ち込みツアーへ回れる）。
 */
const COMPOSE_STEPS: TourStep[] = [
	{
		target: '[data-dtm="macro-compose"]',
		title: "① まず押してみる",
		body: `<p><b>作曲</b>ボタンです。コード進行・メロディ・サブメロ・ベース・伴奏・ドラムまで、
<b>丸ごと自動で作ります</b>。</p>
<p>隣の <b>歌入り作曲</b> なら、メロディに歌詞を付けて<b>歌わせる</b>ところまでやります。</p>`,
	},
	{
		target: '[data-dtm="compose-template"]',
		title: "② 曲の構成を選ぶ",
		body: `<p>イントロ〜サビの並びをプリセットから選べます。</p>
<ul>
<li>まずは <b>1コーラス</b>（短め）が分かりやすいです</li>
<li><b>JPOP王道</b> / <b>ボカロ王道</b> はフルサイズの構成になります</li>
</ul>
<p>下のチェックボックスで、作る部分を自分で選ぶこともできます。</p>`,
	},
	{
		target: '[data-dtm="compose-key"]',
		title: "③ 曲の雰囲気を指定する",
		body: `<p>調（キー）を「<b>喜ばしい・陽気な曲</b>」「<b>物悲しい・哀愁の曲</b>」のような
<b>雰囲気</b>から選べます。</p>
<p>こだわりが無ければ <b>希望なし</b> のままでOK。押すたびに違う曲ができます。</p>`,
	},
	PLAY_STEP,
	{
		target: '[data-dtm="auto-master"]',
		title: "⑤ 仕上げも自動で",
		body: `<p><b>おまかせマスタリング</b>を押すと、各トラックの楽器・音量バランス・
音圧・ステレオ幅・残響までまとめて自動で整えます。</p>
<p>「作曲 → 再生 → おまかせマスタリング」だけで、ひととおり形になります。</p>`,
	},
	{
		target: '[data-dtm="roll"]',
		title: "⑥ 気に入らないところは直せる",
		body: `<p>自動で作った曲も、<b>ただの音符</b>としてここに置かれています。</p>
<p>タップすれば足せるし消せるので、<b>たたき台</b>として使って、
気になるところだけ手で直すのがおすすめです。</p>`,
	},
	EXPORT_STEP,
	CLOSING_STEP,
];

/** ③ 自分で打ち込みたい人向け。道具の説明を厚めにする。 */
const SEQUENCE_STEPS: TourStep[] = [
	{
		target: '[data-dtm="roll"]',
		title: "① ここに音符を置く",
		body: `<p>この格子が<b>ピアノロール</b>です。</p>
<ul>
<li><b>横</b>が時間の流れ、<b>縦</b>が音の高さ（上ほど高い）</li>
<li>タップ／クリックで音符を置く、もう一度押すと消える</li>
<li>音符の端をドラッグすると長さを変えられる</li>
</ul>`,
	},
	{
		target: ".dtm-tooldock",
		title: "② 道具と音符の長さ",
		body: `<p>左から<b>ペン</b>（置く）・<b>選択</b>（まとめて動かす）・<b>消しゴム</b>。</p>
<p>右端のメニューで<b>置く音符の長さ</b>（4分・8分・16分…）を選びます。
間違えても<b>元に戻す</b>で何度でもやり直せます。</p>`,
	},
	{
		target: '[data-dtm="track-tabs"]',
		title: "③ パートを切り替える",
		body: `<p>メロディ・ベース・伴奏などの<b>トラック切り替えタブ</b>です。</p>
<p>選んだパートだけを編集でき、他のパートは背景にうっすら出ます。
重ね方を見ながら書けます。</p>`,
	},
	PLAY_STEP,
	{
		target: '[data-dtm-acc="global"] > summary',
		title: "⑤ 楽器・音量・響き",
		body: `<p>ここを開くと<b>楽器の選択</b>、音量、リバーブ（残響）、ループ再生などを調整できます。</p>
<p>音のバランスに迷ったら <b>おまかせマスタリング</b> が自動で整えてくれます。</p>`,
	},
	{
		target: '[data-dtm="macro-compose"]',
		title: "⑥ 手が止まったら",
		body: `<p>白紙がつらいときは <b>作曲</b> で丸ごと自動生成して、
たたき台から直していく手もあります。</p>
<p><b>MIDI / UST / MML 入力</b>パネルから、既存のMIDIファイルを読み込んで
続きを書くこともできます。</p>`,
	},
	EXPORT_STEP,
	CLOSING_STEP,
];

/**
 * `mountDAW` が組み立てるUIに対する既定のツアー。
 *
 * 入口で<b>目的</b>を尋ね、その枝だけを歩かせる。想定している層が
 *
 *   1. 音源に合わせてカバーを作りたい
 *   2. とりあえず自動で曲が欲しい
 *   3. 自分で打ち込みたい
 *
 * と目的からして分かれており、全員に同じ順路を歩かせると
 * 「自分に関係のない説明を我慢して読む時間」が大半になってしまうため。
 *
 * セレクタはすべて `data-dtm` 属性で書いてある。存在しないUI（機能を切っている、
 * 伴奏音源を注入していない等）を指すステップは自動的に飛ばされるので、
 * 利用側の構成に合わせて間引く必要はない。
 */
export const DAW_TOUR_STEPS: TourStep[] = [
	{
		title: "ようこそ！ 何をしてみたいですか？",
		body: `<p>ブラウザだけで曲が作れる、ピアノロール式のDAWです。
目的に合わせて<b>30秒</b>で案内します。</p>`,
		branches: [
			{
				label: "🎧 カバー曲を作りたい",
				hint: "原曲・カラオケ音源を鳴らしながら重ねる",
				steps: COVER_STEPS,
				// 伴奏音源の再生器が注入されていない構成ではパネルごと出ない。
				when: (root) => isTourTargetVisible(root, '[data-dtm="audio-panel"]'),
			},
			{
				label: "🎲 とりあえず曲を自動で作りたい",
				hint: "ボタン1つでフル構成の曲を生成する",
				steps: COMPOSE_STEPS,
			},
			{
				label: "🎹 自分で打ち込みたい",
				hint: "ピアノロールの使い方をひととおり",
				steps: SEQUENCE_STEPS,
			},
		],
	},
];

/** ヘルプから目的別ツアーを直接始めるための枝の一覧（`label` は表示用）。 */
export const DAW_TOUR_BRANCHES: Record<
	"cover" | "compose" | "sequence",
	{ label: string; steps: TourStep[] }
> = {
	cover: { label: "カバー曲を作る", steps: COVER_STEPS },
	compose: { label: "自動で曲を作る", steps: COMPOSE_STEPS },
	sequence: { label: "自分で打ち込む", steps: SEQUENCE_STEPS },
};
