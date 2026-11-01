# docs

文書は質ごとに3つのフォルダに分ける。新しく書くときも、どれに当たるかで置き場所を決める。

| フォルダ | 中身 | 更新 |
| :--- | :--- | :--- |
| `design/` | 設計と引継ぎ。今どう作られているか、決まったこと、守る不変条件 | コードを変えたら合わせて直す |
| `guide/` | 使い方と手順。書式・API・道具の動かし方 | 使い方が変わったら直す |
| `research/` | 実測・調査・実験の記録。日付と、その時点で分かったこと・採った案・採らなかった案 | 原則として後から直さない。結論が変わったら新しい記録を足す |

音MAD・BB劇場の知識（基準・技・型・測定・作品台帳）は別に [`otomad/`](otomad/README.md) へまとめる。中の分け方は [otomad/README.md](otomad/README.md)。

GitHub Pages の公開物（typedoc と `demo/`）は CI が `docs/` を作り直して出すので、ここの .md は公開物に入らない。

## otomad/

- [otomad/README.md](otomad/README.md) — 音MAD・BB劇場の入口。**音MAD・BB劇場を作る前に読む**（基準 rules.md、技 techniques/、型 genres/、測定 research/、作品台帳 works/、BB素材の手順 bb-flow.md）

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
- [external-soundfont.md](guide/external-soundfont.md) — 外部のサウンドフォント（.sf2）をファイルか URL で読んで鳴らす

手元の歌声エンジン（試作）。**入れるときはまず local-engines-setup.md から。** 各エンジンのページは細かい話。

- [local-engines-setup.md](guide/local-engines-setup.md) — 手元の歌声エンジン（VOICEVOX・NEUTRINO・OpenUtau・Sinsy）を入れて鳴らすまでの手順と、`pnpm engines` でのまとめての起動
  - [voicevox-sing.md](guide/voicevox-sing.md) — VOICEVOX で歌わせる
  - [neutrino-sing.md](guide/neutrino-sing.md) — NEUTRINO で歌わせる（中継サーバーの起動と仕組み）
  - [openutau-sing.md](guide/openutau-sing.md) — OpenUtau（DiffSinger・ENUNU）で歌わせる（CLI の組み立てと歌い手の下ごしらえ）
  - [sinsy-sing.md](guide/sinsy-sing.md) — Sinsy で歌わせる（WSL の pysinsy を中継サーバーで呼ぶ）

## research/

- [kaiwai-lineages.md](research/kaiwai-lineages.md) — 界隈曲の流派（海鮮・2号兄貴・Speder2）の実測
- [game-bgm-toby-fox.md](research/game-bgm-toby-fox.md) — ゲームBGM: Toby Fox の戦闘曲の実測（2026-10-17）
- [transcription-eval.md](research/transcription-eval.md) — 自動採譜（耳コピ）の評価実験（2026-09-30）
- [singing-engines.md](research/singing-engines.md) — 歌声エンジンの調べ物（VOICEVOX・AI-MGRoid、2026-10-31）
- [neutrino-terms.md](research/neutrino-terms.md) — NEUTRINO の規約の解釈と、dtm から呼ぶときにやること・やらないこと（2026-10-31）
- [voice-model-training.md](research/voice-model-training.md) — 歌声のモデル（歌い手）を自分で作る方法（DiffSinger・ENUNU・Sinsy など。どれも未試行、2026-11-01）
