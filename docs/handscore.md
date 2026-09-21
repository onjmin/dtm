# 手書き譜面（HandScore）の書き方

自動作曲マクロを使わずに曲を書くための入力形式。JSON を書いて
`npx tsx scripts/hand-compile.ts <score.json> <out.mml>` に通すと MML になる
（作業ディレクトリは `C:\_own\git\_users\onjmin\dtm`）。

## 記法（音の書き方）

1小節を1つの文字列で表す。トークンは空白区切り。

- `音度^オクターブ:長さ`
  - **音度** … 主音を 1 とした度数。`1 b2 2 b3 3 4 #4 b5 5 b6 6 b7 7` が使える。
    短調なら主要音は `1 b3 4 5 b7`。
  - **オクターブ** … 音名オクターブ（中央のドが `5`。C5 = 中央ド）。
    歌メロは 4〜5、ベースは 2〜3 に置くのが普通。
  - **長さ** … 16分音符いくつ分か。`4`=4分音符、`8`=2分音符、`16`=全音符、`2`=8分音符、`1`=16分音符、
    `6`=付点4分、`12`=付点2分。
- `休n` … n 個ぶんの16分休符。
- 1小節の合計は **16** になるようにする（合計が16を超えると次の小節へはみ出す。意図した繋留ならよいが、
  ふつうは16ちょうどに収める）。
- メロ無しの小節は空文字 `""`。

例（ハ長調、1小節目）: `"1^5:4 2^5:2 3^5:2 5^5:8"`
→ C5四分 → D5八分 → E5八分 → G5二分。

## JSON の形

```json
{
  "title": "曲名",
  "note": "狙いのメモ（人が読む用）",
  "bpm": 128,
  "key": "C",
  "instrument": "piano",
  "drum": "8beat",
  "chordPattern": "arpeggio",
  "sections": [
    { "kind": "intro", "bars": 4 },
    { "kind": "verse", "bars": 8 },
    { "kind": "prechorus", "bars": 4 },
    { "kind": "chorus", "bars": 8 }
  ],
  "chords": "C|G|Am|F|C|G|Am|F",
  "melody": ["", "", "1^5:4 ...", "..."],
  "submelody": ["..."],
  "bass": ["1^3:16", "5^2:16"]
}
```

- `key` … 主音。短調は `Am` のように `m` を付ける（`"Am"` なら主音 A）。
- `chords` … **実音**（移調済みの本当のコード名）で書く。`|` が小節区切り。
  1小節に2つ置くなら `C G|Am F` のように空白で分ける。
  **小節数は `melody` の要素数と合わせる。**
  使えるコード名は一般的な表記（`C` `Am` `F` `G7` `Dm7` `FM7` `Am7` `Csus4` `C/E` など）。
- `chordPattern` … `block`（白玉） / `arpeggio`（分散） / `arpeggio-fast` / `offbeat`（裏打ち） / `yatsume`（八分刻み） / `alternating` のいずれか。迷うなら `arpeggio`。
- `instrument` … `piano` `acoustic` `jazz_night` `synth_pop` `cyber_punk` `rock` `orchestra` `japanese_wa` `arabic_exotic` `fantasy_rpg` `ambient_cloud` `retro_game` のいずれか。迷うなら `piano`。
- `drum` … `4beat` `8beat` `16beat` `shuffle` `dance` `bossa` `disco` のいずれか。迷うなら `8beat`。
- `melody` `submelody` `bass` は**同じ長さの配列**（＝小節数）にする。`submelody` `bass` は省略可だが、
  ベースは入れたほうが曲になる。

## コンパイルと検算

```
cd C:\_own\git\_users\onjmin\dtm
npx tsx scripts/hand-compile.ts tmp/handscore/<名前>.json tmp/handscore/<名前>.mml
```

エラーが出たら記法を直してもう一度通すこと。**通るまでが仕事。**
通ったら、出力された MML の長さ（バイト数）が 500 以上あることを確認する
（極端に短いときは小節数を取り違えている）。

---

## 作曲エージェントへの指示文のひな形

この記法で曲を書かせるときの指示文。**下の制約が効いている**ことは実測で確かめてある
（この指示で書かれた曲は、自動作曲200曲を一次選抜した上位3曲を、覆面審査2パネルで完封した）。
`<>` の中だけ差し替えて使う。

```
あなたは作曲家です。自動作曲マクロを使わず、自分で1曲書いてください。

## 手順
1. docs/handscore.md を読んで記法を把握する。
2. 譜面 JSON を tmp/handscore/<名前>.json に書く。
3. npx tsx scripts/hand-compile.ts tmp/handscore/<名前>.json tmp/handscore/<名前>.mml
   エラーが出たら直して、通るまで繰り返す。

## お題
<明るく口ずさめる J-POP 風インスト。長調。BPM 120〜140。>
構成は intro 4小節 / verse 8小節 / prechorus 4小節 / chorus 8小節 の計24小節
（melody 配列は24要素）。

## 必ず守ること
- サビ冒頭2小節に「フック」を置く。狭い音域（5度以内）・跳躍少なめ・特徴のあるリズム。
  そのフックをサビ内で最低2回、形を変えて繰り返す。
- Aメロとサビをはっきり変える。音域だけでなく、音価と音の密度でも変える
  （例: Aメロ＝16分の早口、サビ＝3+3+2で伸ばす）。
- サビで曲の最高音に届かせ、最後は主音へ降りて解決する。
  最高音は曲中1箇所だけにし、prechorus の頂点はそれより低く抑える。
- 各小節の長さの合計は必ず16。
- bass は全小節に入れる。submelody を入れるならメロディと同じリズムで重ねない。
- コード進行は Aメロ・サビで違うものにする。小節数と chords の | の数を必ず合わせる。

## 重要
あなたは音を聴けません。「聴いて確かめた」とは書かないこと。構造で勝負してください。

## 出力
1. 狙いを150字程度で。
2. サビ冒頭2小節のフックを譜面のトークンそのままで引用し、なぜ口ずさめるのかを説明。
3. コンパイルが通ったこと（出力 MML のバイト数）を報告。
```

書けたら `npx tsx scripts/screen-handscore.ts <score.json>` に掛けて、自動作曲と同じ減点表で
検算する。減点が出たら指示文ではなく**譜面の側**を直させる。
