# Strata に界隈曲を作らせる手順（一人で頼むとき）

自動作曲（界隈曲の流派テンプレート）の出力を土台に、Strata（このPCのローカル LLM）が seed を選び、小節を読み、
リードを書き直して1曲に仕上げる。Claude は要らない。会話を回すのは `scripts/compose/strata-compose.ts`
（Strata に道具を渡して「呼ぶ→結果を返す→次を決めさせる」を繰り返すエージェントループ）。

## 0. 先に知っておくこと

- 判断は Strata がする。スクリプトの道具は事実（小節ごとの和音・層・リードの音、こすれる場所の一覧）だけを返し、
  点数や合否は返さない（[handover-compose.md](handover-compose.md) §2: 点検の数値が目標になって曲が揃うので、作曲ハーネスは外した）。
- Strata は日本語の細かい処理が弱い（ガイドの実測で条件付き作詞 2/6）。歌は作らせず、インスト（2号兄貴・Speder2 の楽器版）に絞ってある。
- Strata は耳で聴けない。曲の良し悪しは最後にあなたが聴いて決める。
- 1回の作曲は 20〜60 分かかる（生成 50〜80 tok/s、文脈 64K）。

## 1. Strata を起動する

自分のターミナル（PowerShell）で:

```
strata launch --model iq2_xs --yes --no-tui
```

LM Studio でモデルを読み込んでいたら先に解除する。`curl.exe -s http://127.0.0.1:8080/health` で `"loaded": true` を確かめる。

## 2. 依頼する

リポジトリ（`C:\_own\git\dtm`）で:

```
npx tsx scripts/compose/strata-compose.ts new --title "界隈曲（Strata 作業名）"
```

- 依頼文を変えるなら `--request "…"`（既定は「自動作曲機能を土台に界隈曲を1曲作り、自分で品質を評価して納得できるところまで手を入れてから finish」）。
  例: `--request "Speder2 で、サビの主題がはっきりした曲を。"`
- 画面には Strata の思考（点）・発言・道具の呼び出しが流れる。止まったように見えても思考中のことが多い。
- `finish` を呼ぶか 80 回のやり取りで止まる。曲は棚 `tmp/songs/<日時> - Strata Qwen3.8-Flash-Next - <仮題>/` に置かれる。

| ファイル | 中身 |
|---|---|
| `song.mml` | 仕上がり。DAW に貼るか、`tmp/songs/index.html` の試聴リンクで開く |
| `steps.md` | 作曲の記録（選んだ seed・手直しごとの理由。Strata の `why` がそのまま入る） |
| `notes.md` | 末尾に Strata の自己評価（聴き所・弱い所・確かめていないこと） |
| `strata-log.md` | Strata の発言と道具の呼び出しの全記録 |
| `strata-session.json` | 会話と手直しの操作列（続き・作り直しに使う） |

## 3. 聴いて、直してほしい所を伝える

試聴は `tmp/songs/index.html` から（自分の部屋で鳴らしてよいのはあなたが聴くときだけ）。直してほしければ、同じ会話の続きに指示を足す:

```
npx tsx scripts/compose/strata-compose.ts continue "Strata 作業名" --say "サビ頭の2小節が平坦。主題を1オクターブ上で鳴らして。"
```

- 指示は「何小節目の何を、どうしたいか」で書くと通りやすい（例: 「21〜24小節のリードを、5〜8小節の主題を元に16分で走るように」）。
- 曖昧な感想（「なんか弱い」）だけだと、Strata は和音とのこすれを直す程度で終わりがち。
- **直す範囲を小節で限り、「それ以外は変えない」と書く。** 2026-10-25 の初回、「こする音を直して」とだけ頼んだら、Strata は
  走句全体を和音の音（F・C・B♭）の往復と同音の連打に書き換え、最高音 F6 を4連打した（旋律が痩せた）。
  「走句の音は変えない。27小節目の前半2拍の B5 だけ」と範囲を絞った指示はそのとおりに通った。
- 悪くなったら、前の稿へ戻せる。`strata-session.json` の `ops`（手直しの操作列）を戻したい件数で切り、`messages` も
  その指示の手前で切ってから `rebuild`（2026-10-25 は3稿目を捨てて2稿目へ戻した。捨てた稿は `*.draft3.*` に残した）。
- 自分で1音だけ直したいときは、DAW で直すより `ops` に `write_bar` を足して `rebuild` する方が、記録と再現が残る。
- 途中で止まった（`--max-turns に達した`）ときは `continue <曲> --say "続けて"`。

## 4. 評価を残す

```
npx tsx scripts/misc/song-shelf.ts verdict "Strata 作業名" --verdict 使う --note "サビが聴ける"
```

`使う／捨てる` と理由を一言。次に作る人（Strata・Claude）が棚の評価を読むので、理由が一番大事。

## 5. 困ったとき

| 症状 | 対処 |
|---|---|
| `Strata が応答しない` で止まる | 1 の起動をやり直す。ポートを変えたなら `$env:STRATA_URL = 'http://127.0.0.1:8081/v1'` |
| 同じ道具を延々呼ぶ・話すだけで進まない | Ctrl+C で止め、`continue <曲> --say "seed を1つに決めて、XX小節から読んで"` のように次の一手を具体的に言う |
| 道具がエラーを返す | Strata に返っているので、たいてい自分で直す。直らなければ `strata-log.md` の該当行を見る |
| song.mml を消した・手で操作列を直した | `npx tsx scripts/compose/strata-compose.ts rebuild <曲>`（seed から操作列を当て直す） |
| 曲を DAW で開いて自分で直したい | `song.mml` を DAW に貼る。以後は手の作業なので、棚の steps.md に `song-shelf.ts step` で一言残す |

## 道具の一覧（Strata に渡しているもの）

| 道具 | すること |
|---|---|
| `read_doc` | 流派の実測（[kaiwai-lineages.md](kaiwai-lineages.md)）と所有者の判断の記録（handover §2）を読む |
| `list_seeds` / `select_seed` | 流派テンプレートの seed を一覧し、1曲を土台に選ぶ |
| `read_bars` | 小節ごとに和音（実音）・鳴っている層・リードとベースの音を読む（主旋律の重ねは `t13(=t0)`、リードより上で鳴る伴奏は「リードより上」と印が付く）。seed を付ければ選ぶ前の候補も読める |
| `list_rubs` | リードが伴奏と半音でこする場所と、主旋律の重ねが t0 とずれた小節の一覧（件数ではなく場所）。`all` で16分の裏も見る |
| `double_lead` | 重ねの層（t1・t13 など）を範囲の中だけ主旋律の写しにする（リードを書き換えた後に揃える） |
| `write_bar` / `transpose` / `copy_bars` / `clear_bars` / `delete_bars` / `insert_bars` / `set_drum` / `set_volume` | 手直し。すべて操作列として残り、seed から当て直せる |
| `note` / `finish` | 作曲の記録に1段書く／書き出して棚に置く |

書き出しの MML は、アプリで同じ seed を作ったときの `getMML` と一致する（seed 103 で確かめた。差は `#ver=` だけ）。
