# 音MAD・BB劇場の知識（docs/otomad/）

音MAD（台詞イントネーション作曲・2号式・文字PV）と BB劇場を作るための知識を、ここ1か所にまとめる。コードは `scripts/otomad/`、使い方は [scripts/otomad/README.md](../../scripts/otomad/README.md) と [scripts/speech-melody/README.md](../../scripts/speech-melody/README.md)。

## 作る前に読む順

1. [rules.md](rules.md) — 所有者の基準（軸・緩急・物語性・素材・安全の線・渡し方）。**毎回読む**
2. [genres/](genres/README.md) — 作る型の作法（BB劇場・2号式など）
3. [techniques/](techniques/README.md) — 使う技の一覧と、どの作品で効いたか
4. [works/](works/README.md) — 近い作品の台帳（狙い・評価）。[_template.md](works/_template.md) を写して新しい台帳を作る
5. 必要なら [research/](#research) の測定記録

## 置き場所

```
docs/otomad/
  README.md        ここ。読む順と目次、運用の決まり
  rules.md         所有者の基準。指摘で基準が変わったら直す
  bb-flow.md       BB素材を集めて、切り抜いて、動画に使う手順
  techniques/      使い回せる技を1つ1ファイル。どの作品で試して、効いたか
  genres/          型ごとの作法
  research/        日付つきの測定・調べ物の記録（後から直さない）
  works/           作品台帳。1作品1ファイル（手元だけ。git には一覧とひな形だけ）
```

| 書くこと | 置き場所 | 更新 |
|---|---|---|
| 守る基準（所有者の指摘） | `rules.md` | 指摘で変わったら直し、末尾の「改めた記録」に足す |
| 使い回せる技 | `techniques/` | 試すたびに「試した作品」へ足す。直したら本文を直す |
| 型（手本のジャンル）の作法 | `genres/` | 新しい型を試したら1ファイル足す |
| 測定・調べ物 | `research/` | 日付を書き、後から直さない。結論が変わったら新しい記録を足す |
| 作品ごとの狙い・作り・実測・評価 | `works/`（手元だけ） | 作る前に書き、評価をもらったら追記 |
| 手順（道具の動かし方） | `bb-flow.md`・`scripts/*/README.md` | 使い方が変わったら直す |

## 運用の決まり

- **試作を1本作るたびに** `works/` に1枚足す（作る前に狙い・軸・物語・緩急）。評価をもらったら日付つきで追記する。
- **評価をもらったら、その場で**効いた技・直した技を `techniques/` へ、変わった基準を `rules.md` へ書く。台帳は手元だけなので、台帳にしか無い知識は別の PC やクラウドのセッションから見えない。
- 記憶（memory・AGENTS.md）には要点と行き先だけを書き、中身はここに置く。
- **使い回すコード**（3D エンジン・抜き・効果音）は `scripts/otomad/lib/` へ出して git に入れる。`songs/` には作品ごとの台本と組み立てだけを残す。
- git に入れないもの: 素材・参考動画・書き出し（[rules.md](rules.md) の「安全の線」）、作品のスクリプト（`songs/`）、作品台帳（`works/*.md`）。台帳とスクリプトは別の PC へ丸ごと写す。

## research

| 記録 | 中身 |
|---|---|
| [speech-melody-method.md](research/speech-melody-method.md) | 台詞イントネーション作曲の作り方の実測と作者本人の手順（10-28） |
| [inmu-kousatsu.md](research/inmu-kousatsu.md) | 淫夢の素材としての考察（成り立ち・系統・扱わないもの） |
| [nigo-kousatsu.md](research/nigo-kousatsu.md) | 2号兄貴の作風の考察（曲の規則） |
| [nigo-mad-analysis.md](research/nigo-mad-analysis.md) | 2号兄貴の音MADの分析（声を楽器に・刻む・隠して落とす・音量、10-29） |
| [nigo-video-research.md](research/nigo-video-research.md) | 2号兄貴の作品一覧と映像の作り、OtomadMaker を使うか（10-30） |
| [otomad-video-research.md](research/otomad-video-research.md) | 音MADの映像の作り方（ネットの記事、10-31） |
| [inmu-cookie-staging.md](research/inmu-cookie-staging.md) | 淫夢・クッキー☆音MADの演出の引き出し、文字PV、講評の観点、dande3 の照合（10-31） |
| [bb-theater.md](research/bb-theater.md) | BB劇場の測定（割り方・型・物語性・バトルの撮り方、11-01） |
| [battle-inmu.md](research/battle-inmu.md) | バトル淫夢のヒット作の測定（格ゲーの枠・技ごとの BB・裏切り・決まり文句・肩すかし、11-01） |
| [noediyu.md](research/noediyu.md) | のえぢゆ（NEL姉貴・DIYUSI）の設定・台詞・BB素材・抜き方の注意（11-02） |
| [material-packs.md](research/material-packs.md) | 音MAD素材のスターターパックの一覧（[一覧の tsv](research/material-packs-list.tsv)、11-01） |
| [../research/kaiwai-lineages.md](../research/kaiwai-lineages.md) | 界隈曲の流派の実測（自動作曲と共用なので `docs/research/` に置く） |

## 移し替えの残り（手元の PC でやる）

`scripts/otomad/songs/` は git 管理外で、クラウドのセッションからは見えない。次は元の PC でやる。

- [ ] notes.md から作った台帳 12 本（quotes・samson5・plasti1・techno1・samson2go1r・dande1〜3・bb6〜9）は git から外したので、`git pull` しても手元には来ない。git の履歴から取り出して `works/` に置く（例: `git show 97d0cfd:docs/otomad/works/bb8.md > docs/otomad/works/bb8.md`）。
- [ ] `songs/*/notes-*.md`（33本）の中身を `works/` へ写す。台帳がある作品は「元のメモ」節を消し、無い作品は [works/README.md](works/README.md) の「まだ台帳に無い作品」から表へ移す。
- [ ] そのメモにしか無い技（3D カメラの作り方・字幕の消し方・レンズ割れなど）を `techniques/` へ写し、各ファイルの「手元のメモから写す」を消す。
- [ ] 所有者の評価を各台帳の「所有者の評価」へ写す。
- [ ] 他の作品が import している部品（bb8 の 3D エンジン・抜き・効果音など）を `scripts/otomad/lib/` へ出して git に入れ、`songs/` 側はそれを読むように直す。
