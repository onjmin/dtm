/**
 * 1件ずつしか処理できない相手（手元の歌声エンジン）へ頼む仕事の待ち行列。
 * 待っている仕事は `priority`（曲の中の開始秒）の小さい順、同じなら頼んだ順に出す。
 * 曲の頭に近いフレーズから出来上がるので、全体を待たずに鳴らし始められる。
 */
export type PriorityQueue = <T>(
	priority: number,
	task: () => Promise<T>,
) => Promise<T>;

export const createPriorityQueue = (): PriorityQueue => {
	type Pending = { priority: number; seq: number; run: () => Promise<void> };
	const pending: Pending[] = [];
	let seq = 0;
	let busy = false;
	const pump = (): void => {
		if (busy || pending.length === 0) return;
		pending.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
		const next = pending.shift() as Pending;
		busy = true;
		next.run().finally(() => {
			busy = false;
			pump();
		});
	};
	return <T>(priority: number, task: () => Promise<T>) =>
		new Promise<T>((resolve, reject) => {
			pending.push({
				priority: Number.isFinite(priority) ? priority : Number.MAX_VALUE,
				seq: seq++,
				run: () => task().then(resolve, reject),
			});
			pump();
		});
};
