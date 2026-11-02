# 作品台帳（works/）

1作品1ファイル（`<作品ID>.md`）。**作る前に** [_template.md](_template.md) を写して狙い・軸・物語・緩急を書き、作ったら作り・実測を足し、所有者の評価をもらったら日付つきで追記する。

**台帳は手元だけに置く**（gitignore。git に入るのはこの説明とひな形だけ）。作品のスクリプト（`scripts/otomad/songs/`）と同じ扱いで、別の PC へは丸ごと写す。

そのぶん、**評価をもらったら、その場で**使い回せることを git に入る側へ移す。台帳にだけ残った知識は、別の PC やクラウドのセッションからは見えない。

- 効いた技・効かなかった技 → [techniques/](../techniques/README.md) の該当ファイルの「試した作品」
- 所有者の指摘で変わった基準 → [rules.md](../rules.md)（末尾の「改めた記録」にも1行）
- 型の作法 → [genres/](../genres/README.md)

作品の一覧は git に置かない。作品ごとに git の同じファイルへ1行足す運用は、複数の PC で作るとコンフリクトの元になるので、**新しい作品を作っても git に入るファイルには作品の行を足さない**。書き出した動画は `python -I scripts/otomad/tools/video_shelf.py` で `scratch/videos/index.html` に並び、台帳の本文と一緒に見返せる（[scripts/otomad/README.md](../../../scripts/otomad/README.md) の「作った動画を見返す」）。

## まだ台帳に無い作品

手元の `scripts/otomad/songs/*/notes-*.md` にだけメモがある作品。台帳へ写したらここから消す: inmu（v1〜v5・inmu_v3）、samson（samson2go1・samsonnigo1 ほか）、nigo、cookie、kaisen、hijikata、kary、cpr、eahon、bb1〜bb5。
