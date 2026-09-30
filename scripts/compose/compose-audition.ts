/**
 * 作曲オーディション。**一次選抜（機械）→ 覆面審査（エージェント）** の前半を1コマンドで回す。
 *
 * 大量に引いて {@link file://./screen-compose.ts} の減点表で絞り、残った上位だけを
 * 覆面の譜面シートにして、審査エージェントへ渡す指示文まで書き出す。
 * 1曲あたり数千トークン掛かる審査に全候補を読ませないための道具。
 *
 * 手書きの曲（{@link file://../docs/handscore.md}）を `--hand` で混ぜると、
 * 自動作曲と**同じ書式・同じ物差し**で同じ土俵に並ぶ。どちらの出自かはシートに出ない。
 *
 *   npx tsx scripts/compose-audition.ts --count 200 --seed 5000 --top 6
 *   npx tsx scripts/compose-audition.ts --count 120 --top 4 --hand tmp/handscore/a.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fromAuto, fromHand, render } from "./blind-sheet";
import { composeOne } from "./compose-lab";
import { screen } from "./screen-compose";

const arg = (name: string, fallback: string): string => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const args = (name: string): string[] => {
	const out: string[] = [];
	for (let i = 0; i < process.argv.length; i++)
		if (process.argv[i] === `--${name}` && process.argv[i + 1])
			out.push(process.argv[i + 1]);
	return out;
};

const count = Number(arg("count", "200"));
const startSeed = Number(arg("seed", String((Math.random() * 1e6) | 0)));
const top = Number(arg("top", "6"));
const outDir = arg("out", "tmp/audition");
const handFiles = args("hand");

mkdirSync(outDir, { recursive: true });

// --- 一次選抜。ここで落とすぶんはエージェントに読ませない ---
console.log(`${count}曲を引いて選抜します（seed ${startSeed}〜）…`);
const rows = [];
for (let i = 0; i < count; i++) rows.push(screen(startSeed + i));
rows.sort((a, b) => b.score - a.score || b.machineScore - a.machineScore);
const picked = rows.slice(0, top);

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
type Entry = { label: string; origin: string; sheet: string };
const entries: Entry[] = [];

picked.forEach((r, i) => {
	const label = LABELS[i];
	entries.push({
		label,
		origin: `auto seed=${r.seed} 選抜点=${r.score.toFixed(2)}`,
		sheet: render(fromAuto(r.seed, label)),
	});
	writeFileSync(
		join(outDir, `song-${label}.mml`),
		composeOne(r.seed).mml,
		"utf8",
	);
});

handFiles.forEach((path, i) => {
	const label = LABELS[picked.length + i];
	entries.push({
		label,
		origin: `hand ${basename(path)}`,
		sheet: render(fromHand(path, label)),
	});
});

for (const e of entries)
	writeFileSync(join(outDir, `sheet-${e.label}.md`), e.sheet, "utf8");

// **対応表はシートと別ファイルにする。** 審査エージェントへ渡すのは sheet-*.md だけで、
// どれが機械でどれが手書きか・どの種かは見せない（先入観で順位が動く）。
writeFileSync(
	join(outDir, "mapping.json"),
	JSON.stringify(
		Object.fromEntries(entries.map((e) => [e.label, e.origin])),
		null,
		"\t",
	),
	"utf8",
);

const fileList = entries
	.map(
		(e) =>
			`${process.cwd()}\\${outDir.replace(/\//g, "\\")}\\sheet-${e.label}.md`,
	)
	.join("\n");

writeFileSync(
	join(outDir, "PROMPT.md"),
	`あなたは音楽レーベルのA&Rです。${entries.length}曲の譜面を読み、「SNSに投稿してバズる曲」としての順位を付けてください。

## 対象（すべて Read で読む）
${fileList}

## 記法
- \`bar12 [chorus] メロ: 1^5:4 休2 3^5:2 5^5:8\` = 12小節目（サビ）。\`音度^オクターブ:長さ\`、長さは16分音符いくつ分（4=4分、8=2分、16=全音符）。\`休n\`は休符。\`－\`はメロディ無し。
- 音度は主音を1とした度数。コードは実音表記、\`|\`が小節区切り。

## 採点（各5点満点。合計30点）
1. **フック** — サビ冒頭2小節が覚えやすいか（狭い音域・跳躍少・特徴的なリズム）、サビ内で再現されるか。
2. **対比** — Aメロとサビが、音域だけでなく**リズムと音の密度**でも違うか。
3. **山と解決** — サビで曲の最高音に届き、最後に主音へ落ちるか。頂点が1箇所に絞れているか。
4. **和声** — 進行が動いているか（同じコードが延々続かない）、メロの長い音・小節頭がコードトーンに着地するか。
5. **つかみ** — 冒頭から歌が始まるまでの秒数（BPMと小節数から計算せよ）、最初の4小節に聴き続ける理由があるか。
6. **完成度** — 歌えない跳躍・脈絡のない無音・調外音の乱用など、破綻が無いか。

## 禁止事項
- 音は**聴けません**。「聴いた」と書かないこと。必ず小節番号と音度を根拠にすること。
- 各曲がどうやって作られたか（人が書いたか機械が書いたか）を**推測しない・言及しない**。

## 出力（これだけを返す）
1. ${entries.length}曲×6項目の点数表（合計点つき）。
2. 1位と最下位について、それぞれ150字程度で理由。
3. 「1曲だけ投稿するなら」どれか、理由を1〜2文で。
`,
	"utf8",
);

console.log(
	`\n--- 一次選抜を通った ${entries.length} 曲（対応表は ${outDir}/mapping.json）---`,
);
for (const e of entries) console.log(`  ${e.label}: ${e.origin}`);
console.log(`
次にやること:
  1. ${outDir}/PROMPT.md の中身を、審査エージェント2人以上に渡す（多数決を取るため）
  2. 勝った曲の .mml を MML作曲エディタの「データをインポート」で開いて聴く
  3. 耳と審査がずれていたら、審査の観点か screen-compose.ts の減点表を直す`);
