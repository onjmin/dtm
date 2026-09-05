/**
 * 生成した曲の「良さ」を測るための指標。
 *
 * ## なぜ分けたか
 *
 * 初期の受け入れ基準（音価のエントロピー・休符率・跳躍率・音域）は、**7項目のうち5つが
 * 順序非依存**だった。実際に16小節の順番をシャッフルして曲を破壊しても、
 *
 *   原曲     kinds:5 entropy:1.925 rest:0.039 range:15
 *   小節混ぜ kinds:5 entropy:1.925 rest:0.039 range:15
 *
 * と、ほぼ全部の値が動かず基準を通過する。残る2つ（最大跳躍・跳躍率）も隣接2音しか
 * 見ておらず、**小節をまたぐ構造を測る指標が1つも無かった**。80回引き直しても、
 * モチーフの配置・盛り上がりの位置・フレーズの呼応は評価対象外なので改善しようがない。
 *
 * この module は「順序に依存する指標」を足すためにある。指標は
 * {@link StructureFeatures}（コードを知らなくても測れる＝人間の曲から較正できる）と
 * {@link TensionFeatures}（和音が要る＝音楽理論から決める）に分けてあり、前者は
 * `scripts/calibrate-corpus.ts` が人間の曲から採った実測値
 * （{@link file://./compose-corpus.ts}）を目標値に使う。
 *
 * ## 単位
 *
 * MIDI取り込みの曲と生成物を**同じ関数で測る**ため、入力は units ではなく
 * 半音（{@link MetricNote.pitchSemi}）とステップで受ける。
 */

/** 測定対象の1音。MIDIから作るときも生成物から作るときも、この形へ落としてから測る。 */
export type MetricNote = {
	startStep: number;
	/** MIDIノート番号相当の半音。31平均律では小数になるが、指標の計算には影響しない。 */
	pitchSemi: number;
	durationSteps: number;
};

export type MetricOptions = {
	stepsPerBar: number;
	bars: number;
};

// ============================================================
// 小節の指紋（自己相似の計算に使う）
// ============================================================

/**
 * 1小節ぶんの指紋。**音高そのものは持たない**のが要点。
 *
 * 参考にした人間の曲13本を測ったところ、小節の音がそっくり一致する曲はほとんど無く
 * （音の一致率は 47〜100%、大半が100%＝全小節が別）、繰り返されているのは
 * **リズムと輪郭**だった。音高で比べると「同じ小節をコピペしただけ」に高得点を
 * 与えてしまうので、ここでは持たない。
 */
type BarSignature = {
	/** 小節内の発音位置（16分の格子インデックス）。 */
	onsets: Set<number>;
	/** 小節内の隣接音の向き（+1/0/-1）。 */
	contour: number[];
};

const barSignatures = (
	notes: MetricNote[],
	opts: MetricOptions,
): (BarSignature | null)[] => {
	const { stepsPerBar, bars } = opts;
	const grid = Math.max(1, stepsPerBar / 16);
	const out: (BarSignature | null)[] = [];
	for (let bar = 0; bar < bars; bar++) {
		const start = bar * stepsPerBar;
		const inBar = notes
			.filter((n) => n.startStep >= start && n.startStep < start + stepsPerBar)
			.sort((a, b) => a.startStep - b.startStep);
		if (inBar.length === 0) {
			out.push(null);
			continue;
		}
		const onsets = new Set(
			inBar.map((n) => Math.round((n.startStep - start) / grid)),
		);
		const contour: number[] = [];
		for (let i = 1; i < inBar.length; i++)
			contour.push(Math.sign(inBar[i].pitchSemi - inBar[i - 1].pitchSemi));
		out.push({ onsets, contour });
	}
	return out;
};

const jaccard = (a: Set<number>, b: Set<number>): number => {
	let inter = 0;
	for (const v of a) if (b.has(v)) inter++;
	const union = a.size + b.size - inter;
	return union === 0 ? 1 : inter / union;
};

/**
 * 輪郭の一致度。長さが違う場合は**長い方で割る**ので、音数の違いがそのまま減点になる
 * （「同じ形だが音数が倍」は別の小節として扱いたい）。
 */
const contourSimilarity = (a: number[], b: number[]): number => {
	const n = Math.max(a.length, b.length);
	if (n === 0) return 1;
	let agree = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++)
		if (a[i] === b[i]) agree++;
	return agree / n;
};

/**
 * 小節2つの似ている度合い。リズムを重く見るのは、上に書いたとおり人間の曲で
 * 実際に反復されているのがリズムの側だから。
 */
const barSimilarity = (a: BarSignature, b: BarSignature): number =>
	0.6 * jaccard(a.onsets, b.onsets) +
	0.4 * contourSimilarity(a.contour, b.contour);

// ============================================================
// 構造の指標（コードを知らなくても測れる ＝ 人間の曲から較正できる）
// ============================================================

export type StructureFeatures = {
	/**
	 * 自己相似プロファイル。lag 小節だけ離れた小節どうしの平均類似度。
	 *
	 * 良い曲は「lag4 と lag8 が高く、lag1 は低い」という山型になる——4小節・8小節の
	 * フレーズで同じ形が戻ってくる一方、隣り合う小節は違う形をしている、ということ。
	 * 平坦だと「全部同じ」か「全部バラバラ」のどちらかで、どちらも曲に聞こえない。
	 */
	sim1: number;
	sim2: number;
	sim4: number;
	sim8: number;
	/** フレーズの切れ目（2小節ごと）で息継ぎ（ロングトーンか休符）があった比率。 */
	phraseBreath: number;
	/** 最高音が現れる位置。曲頭が0、曲末が1。 */
	climaxPosition: number;
	/** 最高音の2半音以内まで達する「頂点」の数。1〜2なら単峰。 */
	climaxPeaks: number;
	/** メロディが鳴っていないステップに、サブメロの音が入っている比率（コール&レスポンス）。 */
	complementarity: number;
};

/** 自己相似プロファイル。小節が空（休符だけ）のペアは母数から外す。 */
const selfSimilarity = (sigs: (BarSignature | null)[], lag: number): number => {
	let sum = 0;
	let count = 0;
	for (let i = lag; i < sigs.length; i++) {
		const a = sigs[i];
		const b = sigs[i - lag];
		if (!a || !b) continue;
		sum += barSimilarity(a, b);
		count++;
	}
	return count === 0 ? 0 : sum / count;
};

/**
 * フレーズの切れ目で息継ぎがあるか。2小節ごとの区切り（2,4,6...小節目の末尾）で、
 * **ロングトーンで受けている**か**休符が空いている**かを見る。
 *
 * 初期実装はリズム型が必ず1小節ぶんで閉じていたため、この値が構造上ほぼ一定だった。
 * フレーズ単位の設計（タイ・弱起）を入れたときに、効いているかをここで検算する。
 */
const phraseBreath = (notes: MetricNote[], opts: MetricOptions): number => {
	const { stepsPerBar, bars } = opts;
	const quarter = stepsPerBar / 4;
	let ok = 0;
	let total = 0;
	for (let bar = 1; bar < bars; bar += 2) {
		const start = bar * stepsPerBar;
		const end = start + stepsPerBar;
		const inBar = notes
			.filter((n) => n.startStep >= start && n.startStep < end)
			.sort((a, b) => a.startStep - b.startStep);
		total++;
		if (inBar.length === 0) {
			ok++; // 小節まるごと休み＝最大の息継ぎ
			continue;
		}
		const last = inBar[inBar.length - 1];
		const tail = end - (last.startStep + last.durationSteps);
		if (last.durationSteps >= quarter * 2 || tail >= quarter / 2) ok++;
	}
	return total === 0 ? 0 : ok / total;
};

/**
 * クライマックスの位置と単峰性。
 *
 * 最高音の周辺（2半音以内）に達する箇所を、1小節以上離れていれば別の「頂点」として数える。
 * 頂点が1〜2個で、曲の後半（6〜8割あたり）に来るのが、聞かせどころのある曲の形。
 * 8個もあると「ずっと高いところで鳴っている」だけで、山が無い。
 */
const climax = (
	notes: MetricNote[],
	opts: MetricOptions,
): { climaxPosition: number; climaxPeaks: number } => {
	if (notes.length === 0) return { climaxPosition: 0, climaxPeaks: 0 };
	const total = opts.bars * opts.stepsPerBar;
	const sorted = [...notes].sort((a, b) => a.startStep - b.startStep);
	const top = Math.max(...sorted.map((n) => n.pitchSemi));
	const first = sorted.find((n) => n.pitchSemi === top);
	let peaks = 0;
	let lastPeakStep = Number.NEGATIVE_INFINITY;
	for (const n of sorted) {
		if (n.pitchSemi < top - 2) continue;
		if (n.startStep - lastPeakStep < opts.stepsPerBar) continue;
		peaks++;
		lastPeakStep = n.startStep;
	}
	return {
		climaxPosition: first ? first.startStep / total : 0,
		climaxPeaks: peaks,
	};
};

/** ステップごとの「鳴っているか」のビット列。 */
const soundingMask = (notes: MetricNote[], total: number): Uint8Array => {
	const mask = new Uint8Array(total);
	for (const n of notes) {
		const end = Math.min(total, n.startStep + n.durationSteps);
		for (let s = Math.max(0, n.startStep); s < end; s++) mask[s] = 1;
	}
	return mask;
};

/**
 * コール&レスポンス。サブメロの**音の入り（オンセット）**のうち、メロディが休んで
 * いる瞬間に入るものの割合。
 *
 * 最初は「サブメロが鳴っているステップのうちメロディが休んでいる割合」で測っていたが、
 * それだと**伸ばしている音が一方的に不利になる**。メロディの隙間で入ってそのまま
 * 伸びるパッドや保続音は対旋律として正しい書き方なのに、伸びた分だけ重なりとして
 * 数えられ、書法を変えても値がほとんど動かなかった（実測 0.15 前後で頭打ち）。
 *
 * 測りたいのは「サブメロはメロディが息継ぎしたときに喋るか」なので、
 * **入りの瞬間だけ**を見る。持続の長さは {@link StructureFeatures.phraseBreath} や
 * 音価の指標が別に見ている。
 *
 * ハモリはメロディと同時に入るのが正しい書法なので、1を目指す指標ではない。
 */
export const complementarity = (
	melody: MetricNote[],
	submelody: MetricNote[],
	opts: MetricOptions,
): number => {
	const total = opts.bars * opts.stepsPerBar;
	if (submelody.length === 0) return 0;
	const mel = soundingMask(melody, total);
	let free = 0;
	for (const n of submelody) {
		const at = n.startStep;
		if (at < 0 || at >= total) continue;
		if (!mel[at]) free++;
	}
	return free / submelody.length;
};

export const structureFeatures = (
	melody: MetricNote[],
	submelody: MetricNote[],
	opts: MetricOptions,
): StructureFeatures => {
	const sigs = barSignatures(melody, opts);
	return {
		sim1: selfSimilarity(sigs, 1),
		sim2: selfSimilarity(sigs, 2),
		sim4: selfSimilarity(sigs, 4),
		sim8: selfSimilarity(sigs, 8),
		phraseBreath: phraseBreath(melody, opts),
		...climax(melody, opts),
		complementarity: complementarity(melody, submelody, opts),
	};
};

// ============================================================
// 密度（メロディの「速さ」）
// ============================================================

/**
 * メロディがどれくらい細かく動いているか。
 *
 * **これが無かったせいで、生成物は人間の曲のちょうど半分の速さで止まっていた。**
 * 参考曲を測ると 1小節あたり 9.3音（p25〜p75 で 4.4〜10.0）・音の 93% が8分以下
 * なのに対し、生成物は 4.4音・49% で、支配的な音価は4分音符だった。
 *
 * 既存の指標ではこの差が1つも見えない——音価エントロピーも種類数も**分布の散らばり**
 * しか見ておらず、「4分中心に散らばった曲」と「16分中心に散らばった曲」を区別しない。
 * 休符率も自己相似も同じ。結果、`groove: "sixteenth"` を50%の確率で引いていたのに、
 * 採点を通ると16分の曲は8%（60曲中5曲）まで落ちていた。
 *
 * メロディの速さは曲の性格そのものなので、採点項目として持つ。
 */
export type DensityFeatures = {
	/** 1小節あたりの音数。 */
	notesPerBar: number;
	/** 8分音符以下の短い音が占める比率。曲の「刻みの細かさ」。 */
	shortNoteRatio: number;
};

export const densityFeatures = (
	notes: MetricNote[],
	opts: MetricOptions,
): DensityFeatures => {
	if (notes.length === 0) return { notesPerBar: 0, shortNoteRatio: 0 };
	const eighth = opts.stepsPerBar / 8;
	const short = notes.filter((n) => n.durationSteps <= eighth).length;
	return {
		notesPerBar: notes.length / Math.max(1, opts.bars),
		shortNoteRatio: short / notes.length,
	};
};

// ============================================================
// 緊張と解放（和音が要るので人間の曲からは較正できない）
// ============================================================

export type TensionFeatures = {
	/** B部（9〜12小節）がA部（1〜4小節）より緊張しているか。0〜1。 */
	rise: number;
	/** 終止（16小節目）で緊張が解けているか。0〜1。 */
	resolve: number;
};

/**
 * 小節ごとの緊張度から、曲の緊張カーブが「B部で上がって終止で解ける」形かを測る。
 *
 * `barTension` は各小節の不協和度（{@link file://./compose.ts} の `toneWeight` を
 * 音価で重み付けして集計したもの）。**この関数の存在意義は「1音ごとに使い捨てていた
 * 不協和度を時系列に積む」こと**で、材料は前からあった。
 */
export const tensionFeatures = (barTension: number[]): TensionFeatures => {
	if (barTension.length < 16) return { rise: 0, resolve: 0 };
	const mean = (xs: number[]): number =>
		xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
	const a = mean(barTension.slice(0, 4));
	const b = mean(barTension.slice(8, 12));
	const all = mean(barTension);
	const last = barTension[barTension.length - 1];
	// 差そのものではなく「上がっているか」を0〜1へ。0.5緊張ぶん上がれば満点。
	const rise = Math.max(0, Math.min(1, (b - a) / 0.5));
	// 終止が全体平均より低ければ解けている。
	const resolve = Math.max(0, Math.min(1, (all - last) / 0.4 + 0.5));
	return { rise, resolve };
};

// ============================================================
// 採点
// ============================================================

/**
 * 台形の当てはめ。`[idealLo, idealHi]` の内側なら1、`lo`/`hi` の外側で0、間は線形。
 *
 * **しきい値の合否ではなく連続値にする**のが要点。初期実装は全部を1つの真偽値へ
 * 潰していたので、「構造は良いのに休符率が0.09だったので捨てられた曲」が
 * 大量に発生していた。
 */
export const band = (
	v: number,
	lo: number,
	idealLo: number,
	idealHi: number,
	hi: number,
): number => {
	if (v <= lo || v >= hi) return 0;
	if (v >= idealLo && v <= idealHi) return 1;
	// コーパスによっては p05 と p25（p75 と p95）が一致し、坂の幅が0になりうる。
	// そのまま割ると NaN が採点へ混ざるので、幅が無いときは崖として扱う。
	if (v < idealLo) return idealLo === lo ? 0 : (v - lo) / (idealLo - lo);
	return hi === idealHi ? 0 : (hi - v) / (hi - idealHi);
};

/** 目標帯。`scripts/calibrate-corpus.ts` が人間の曲から採った値をこの形で出す。 */
export type Band = [lo: number, idealLo: number, idealHi: number, hi: number];

// ============================================================
// 曲どうしの距離（「どの曲も似ている」を潰すため）
// ============================================================

/**
 * 曲の特徴ベクトル。各成分はおおよそ 0〜1 に収まるよう正規化してある。
 * 直近に作った曲との距離を採点へ入れることで、**指標に最適化した結果として
 * 全曲が同じ統計値へ寄る**のを防ぐ。
 */
export const featureVector = (f: {
	entropy: number;
	restRatio: number;
	leapRatio: number;
	melodyRange: number;
	density: DensityFeatures;
	structure: StructureFeatures;
}): number[] => [
	f.entropy / 3,
	f.restRatio * 8,
	f.leapRatio * 2,
	f.melodyRange / 24,
	f.density.notesPerBar / 12,
	f.density.shortNoteRatio,
	f.structure.sim1,
	f.structure.sim2,
	f.structure.sim4,
	f.structure.sim8,
	f.structure.phraseBreath,
	f.structure.climaxPosition,
	f.structure.complementarity,
];

/** 特徴ベクトル間のユークリッド距離。 */
export const featureDistance = (a: number[], b: number[]): number => {
	let sum = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++)
		sum += (a[i] - b[i]) ** 2;
	return Math.sqrt(sum);
};
