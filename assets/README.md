# assets/ は dtm の内蔵キャラ画像だけ

ここには、dtm のビルドに同梱するキャラのアイコン（`<名前>.png`、`src/voice/voice-images.ts` が読む）だけを置く。サブフォルダは作らない（`scripts/test/check-assets.ts` が落ちる）。

動画・MV に使ったドット絵や背景などの**素材は、ここではなく asset リポジトリ**に置く。

- 手元: `C:\_own\git\asset`（GitHub: onjmin/asset、origin の main へ push）
- 置き方はそのリポジトリの `CLAUDE.md`（作品ごとのフォルダ、`README.md`・`MAKING.md`・`src/`）。
