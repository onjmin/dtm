# docs

文書は質ごとに3つのフォルダに分ける。新しく書くときも、どれに当たるかで置き場所を決める。

| フォルダ | 中身 | 更新 |
| :--- | :--- | :--- |
| `design/` | 設計と引継ぎ。今どう作られているか、決まったこと、守る不変条件 | コードを変えたら合わせて直す |
| `guide/` | 使い方と手順。書式・API・道具の動かし方 | 使い方が変わったら直す |
| `research/` | 実測・調査・実験の記録。日付と、その時点で分かったこと・採った案・採らなかった案 | 原則として後から直さない。結論が変わったら新しい記録を足す |

GitHub Pages の公開物（typedoc と `demo/`）は CI が `docs/` を作り直して出すので、ここの .md は公開物に入らない。

## design/

- [handover-compose.md](design/handover-compose.md) — 自動作曲の引継ぎ。**自動作曲の作業の前に読む**
- [accomp-compose.md](design/accomp-compose.md) — 伴奏主体モード（`composeAccomp`）の設計
- [accomp-style-engine.md](design/accomp-style-engine.md) — 伴奏主体モードのスタイルエンジンの設計
- [lyric-design.md](design/lyric-design.md) — 自動作曲の歌詞の設計
- [dataset-provenance.md](design/dataset-provenance.md) — 素材の出どころ台帳（`pnpm version` が版を書き込む）

## guide/

- [handscore.md](guide/handscore.md) — 手書き譜面（HandScore）の書き方
- [parseChord.md](guide/parseChord.md) — `parseChord` / `parseChords` の使い方
- [strata-compose.md](guide/strata-compose.md) — Strata に界隈曲を作らせる手順
- [voicevox-sing.md](guide/voicevox-sing.md) — VOICEVOX で歌わせる（試作）

## research/

- [kaiwai-lineages.md](research/kaiwai-lineages.md) — 界隈曲の流派（海鮮・2号兄貴・Speder2）の実測
- [game-bgm-toby-fox.md](research/game-bgm-toby-fox.md) — ゲームBGM: Toby Fox の戦闘曲の実測（2026-10-17）
- [transcription-eval.md](research/transcription-eval.md) — 自動採譜（耳コピ）の評価実験（2026-09-30）
- [singing-engines.md](research/singing-engines.md) — 歌声エンジンの調べ物（VOICEVOX・AI-MGRoid、2026-10-31）
