/**
 * 楽器プリセットの音域チェック。
 *
 * 「Glockenspiel が金切り音で耳が痛い」という報告から作った。1つ直すのではなく、
 * **全プリセット×全スロット×編曲が掛けるオクターブ**を総当たりで測って、同じ形の
 * 事故がほかに無いかを見る。
 *
 * ## 何を測るか
 *
 * `compose.ts` が書くパートの実測音域（{@link PART_RANGES}）に、上級者モードの編曲が
 * 掛けるオクターブ（{@link ROLES}）を足して、**その楽器が実際に鳴らされる音域**を出す。
 * それを実物の楽器の音域（{@link GM_INSTRUMENT_RANGE}）と突き合わせる。
 *
 * ## 2種類の事故
 *
 * ## 何と突き合わせるか
 *
 * その楽器の**実用上限** ＝ 実物の音域の上限（{@link GM_INSTRUMENT_RANGE}）と、明るい
 * 音色を持続的に鳴らしてよい高さ（{@link GM_BRIGHT_CEILING}）の、厳しいほう。
 * 後者が要るのは、グロッケンのように「実物の音域には収まっているのに金切り音になる」
 * 組み合わせがあるため。
 *
 * `fitInstrumentOctave` が使うのと同じ基準なので、**この検査は実装の鏡**になる。
 * 自動でオクターブが下がる役は下がった後の位置で見るので、ここに残る警告は
 * 「下げても収まらない」＝音色の選び方そのものが外れている印。
 *
 * 下へはみ出す側は音が痛くならないので警告しない（サンプルは伸びるが、低く柔らかく鳴る）。
 */
import {
	fitInstrumentOctave,
	GM_BRIGHT_CEILING,
	GM_INSTRUMENT_RANGE,
	INSTRUMENT_PRESETS,
} from "../src/instrument-presets";

/**
 * `compose.ts` が書くパートの実測音域 `[p01, p99]`。
 * `scripts/` から `composeSong` を回して測った値（120曲）。両端1%を落としてあるのは、
 * 数音の外れ値で全プリセットが赤くなるのを避けるため。
 */
const PART_RANGES: Record<string, [number, number]> = {
	melody: [58, 84],
	submelody: [52, 78],
	bass: [29, 49],
	pad: [77, 93],
	solo: [58, 85],
	octaveLayer: [58, 85],
	chord: [45, 71],
};

/** 上級者モードの編曲が、どのパートをどのスロットへ、どのオクターブで置くか。 */
const ROLES: {
	track: string;
	part: keyof typeof PART_RANGES;
	slot: keyof (typeof INSTRUMENT_PRESETS)["piano"];
	/** 編曲が掛けうるオクターブ（複数ありうるものは全部見る）。 */
	octaves: number[];
	/** 曲の間じゅう鳴り続ける役か（＝高音楽器を置いてはいけない役か）。 */
	sustained: boolean;
	/**
	 * 編曲が {@link fitInstrumentOctave} で楽器の音域へ自動で合わせる役か。
	 * true の役は、はみ出しても実行時に下げられるので、合わせた後の位置で見る。
	 * ここに残る警告は「合わせようが無い」＝音色の選び方そのものが外れている印。
	 */
	autoFit?: boolean;
	/**
	 * 編曲が {@link fitInstrumentOctave} で楽器の音域へ自動で合わせる役か。
	 * true の役は、はみ出しても実行時に下げられるので警告しない——
	 * ここで警告すべきは「合わせようが無い」＝音色の選び方そのものが外れている役だけ。
	 */
	autoFit?: boolean;
}[] = [
	{
		track: "t0 主旋律",
		part: "melody",
		slot: "melody",
		octaves: [0],
		sustained: true,
	},
	{
		track: "t1 サビの重ね",
		part: "melody",
		slot: "chorusLead",
		octaves: [0, 1],
		sustained: true,
		autoFit: true,
	},
	{
		track: "t3 サブメロ",
		part: "submelody",
		slot: "submelody",
		octaves: [0],
		sustained: true,
	},
	{
		track: "t4 ベース",
		part: "bass",
		slot: "bass",
		octaves: [0],
		sustained: true,
	},
	{
		track: "t5 ベースの重ね",
		part: "bass",
		slot: "bass",
		octaves: [1],
		sustained: false,
		autoFit: true,
	},
	{
		track: "t6 パッド",
		part: "pad",
		slot: "chord",
		octaves: [0],
		sustained: true,
		autoFit: true,
	},
	{
		track: "t7-9 伴奏",
		part: "chord",
		slot: "chord",
		octaves: [0],
		sustained: true,
	},
	{
		track: "t10 ウワモノ",
		part: "chord",
		slot: "chord",
		octaves: [1],
		sustained: false,
		autoFit: true,
	},
	{
		track: "t13 オクターブ重ね",
		part: "octaveLayer",
		slot: "melody",
		octaves: [-1],
		sustained: false,
	},
	{
		track: "t14 間奏のソロ",
		part: "solo",
		slot: "solo",
		octaves: [0],
		sustained: true,
		autoFit: true,
	},
];

/**
 * 実用上限をこれだけ超えるまでは許す（半音）。
 * `src/instrument-presets.ts` の `OCTAVE_FIT_TOLERANCE` と同じ値・同じ考え方。
 */
const TOLERANCE = 3;

/**
 * 承知のうえで残しているもの。**新しく増えた問題だけが目に入るように**、
 * 理由を書いて明示的に外す。理由が言えないものはここへ入れない。
 */
const ACCEPTED: Record<string, string> = {
	"orchestra/t0 主旋律":
		"フレンチホルンは上限F5。旋律の上位1%だけが超える。ホルンはこのプリセットの顔なので差し替えない",
	"japanese_wa/t0 主旋律":
		"琴は上限F5。旋律の上位1%だけが超える。琴を外すと和風プリセットが成立しない",
	"arabic_exotic/t0 主旋律":
		"シタールは上限G5。旋律の上位1%だけが超える。シタールを外すとエキゾチックが成立しない",
};

type Finding = { key: string; text: string };
const seen = new Set<string>();
const findings: Finding[] = [];
let checks = 0;
let fitted = 0;

for (const [presetKey, preset] of Object.entries(INSTRUMENT_PRESETS)) {
	for (const role of ROLES) {
		const name = preset[role.slot];
		const range = GM_INSTRUMENT_RANGE[name];
		if (!range) {
			findings.push({
				key: `${presetKey}/${role.track}`,
				text: `音域データ未登録: ${name}`,
			});
			continue;
		}
		// 実用上限＝実物の音域の上限と、明るい音色の「痛くならない上限」の厳しいほう。
		// `fitInstrumentOctave` が使っているのと同じ基準（＝この検査は実装の鏡）。
		const hi = Math.min(range[1], GM_BRIGHT_CEILING[name] ?? range[1]);
		for (const wanted of role.octaves) {
			checks++;
			const [pLo, pHi] = PART_RANGES[role.part];
			// 編曲が自動で合わせる役は、合わせた後の位置で見る。
			const oct = role.autoFit
				? fitInstrumentOctave([pLo, pHi], name, wanted)
				: wanted;
			if (oct !== wanted) fitted++;
			const sHi = pHi + oct * 12;
			const key = `${presetKey}/${role.track}`;
			if (sHi <= hi + TOLERANCE) continue;
			const id = `${key}:${oct}`;
			if (seen.has(id)) continue;
			seen.add(id);
			findings.push({
				key,
				text: `${presetKey.padEnd(13)} ${role.track.padEnd(18)} ${name} (実音 ${pLo + oct * 12}〜${sHi} / 実用上限 ${hi}${hi !== range[1] ? "＝明るさ上限" : ""})  ← 上へ ${sHi - hi} 半音`,
			});
		}
	}
}

const fresh = findings.filter((f) => !(f.key in ACCEPTED));
const known = findings.filter((f) => f.key in ACCEPTED);

console.log(
	`● 楽器の音域チェック（${checks}通り / 許容 ±${TOLERANCE}半音 / オクターブ補正が働いた ${fitted}件）`,
);
if (fresh.length === 0) console.log("  新しい問題はありません");
else {
	console.log(`
新しい問題: ${fresh.length}件`);
	for (const f of fresh) console.log(`  ${f.text}`);
}
console.log(`
既知（許容）: ${known.length}件`);
for (const f of known)
	console.log(`  ${f.text}
      理由: ${ACCEPTED[f.key]}`);
if (fresh.length > 0) process.exitCode = 1;
