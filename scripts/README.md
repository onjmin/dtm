# Scripts Directory

回帰テスト・曲の書き出しと棚・公開物のビルド補助だけを置く。一時的な測定は git 管理外の `scratch/` に使い捨てで書く。
代理指標でコーパスへ寄せる測定・点検の道具は削除した（git 履歴にある。理由は [docs/design/handover-compose.md](../docs/design/handover-compose.md) §2）。

耳コピ由来のデータ（`src/compose/compose-phrases.ts`・`compose-section-bank.ts`・`compose-skeletons.ts`）は git にもバンドルにも入れない。
`scripts/corpus/skeleton-data.ts` が手元にあれば読み、無ければ該当の検査は skip する。

## test/ — 回帰テスト

`pnpm test` が `package.json` に並べた `check-*.ts` を順に回す（最後に「全テスト成功！」）。黄金値・対照は `test/fixtures/`。
黄金値は意図しない変化の検出だけに使う。出力を意図して変えたときは取り直す。

| コマンド | 用途 |
| :--- | :--- |
| `npx tsx scripts/test/check-compose.ts --bless` | 自動作曲の黄金値の取り直し |
| `pnpm accomp:bless` | 伴奏主体モードの黄金値の取り直し |

## compose/ — 曲の書き出し

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `export-samples.ts` | 生成曲を .mid（伴奏主体モードは .mml）で書き出す。`--app-seed` と `--compose` でアプリの曲を再現 | `npx tsx scripts/compose/export-samples.ts --app-seed 3842857959 --compose style:fb.v1:any:0` |
| `strata-compose.ts` | Strata（ローカル LLM）に界隈曲を作らせて棚へ置く。手順は [docs/guide/strata-compose.md](../docs/guide/strata-compose.md) | `npx tsx scripts/compose/strata-compose.ts new` |
| `ore-names.ts` | インスト曲の名前（岩石・鉱石の英名）。`song-shelf.ts`・`strata-compose.ts` が使う | — |

## misc/ — 棚・共有 URL・リリース補助

| ファイル名 | 役割 | コマンド例 |
| :--- | :--- | :--- |
| `song-shelf.ts` | 作った曲の棚（`tmp/songs/`）。一覧 `tmp/songs/index.html`（ひな形 `song-shelf.html`）。下の手順 | `npx tsx scripts/misc/song-shelf.ts new --title 終末カタストロフ` |
| `mml-embed-url.ts` | .mml を公開デモの埋め込み URL と編集画面の URL にする（組み立ては `embed-url.ts`） | `npx tsx scripts/misc/mml-embed-url.ts tmp/a.mml --json tmp/urls.json` |
| `voicevox-sing.ts` | 歌詞付き MML の1トラックを VOICEVOX の歌唱 API で歌わせ、歌声だけを WAV に書き出す（試作。伴奏は入らない）。VOICEVOX エンジンを先に起動しておく | `npx tsx scripts/misc/voicevox-sing.ts tmp/a.mml --track 0 --singer ずんだもん --out scratch/voicevox/sing.wav` |
| `neutrino-server.ts` | 手元の NEUTRINO を dtm から呼ぶ中継サーバー（試作）。`nt_` の声で歌わせるときに起動しておく。[docs/guide/neutrino-sing.md](../docs/guide/neutrino-sing.md) | `npx tsx scripts/misc/neutrino-server.ts --neutrino C:/NEUTRINO` |
| `openutau-server.ts` | 手元の OpenUtau（CLI つき）を dtm から呼ぶ中継サーバー（試作）。`ou_` の声（DiffSinger など）で歌わせるときに起動しておく。[docs/guide/openutau-sing.md](../docs/guide/openutau-sing.md) | `npx tsx scripts/misc/openutau-server.ts --openutau C:/OpenUtau` |
| `local-engine-server.ts` | NEUTRINO・OpenUtau の中継サーバーの共通部品（口と、Host・Origin の確認など安全のための決まり） | — |
| `inject-csp.ts` | 公開デモの HTML へ CSP の `<meta>` を差し込む。gh-pages.yml が呼ぶ | `pnpm exec tsx scripts/misc/inject-csp.ts docs/demo/*.html` |
| `sync-version.ts` | `package.json` の版を `src/version.ts` 等へ写す（`pnpm version` が呼ぶ） | `pnpm patch` |
| `downscale-assets.py` | アセット画像を縮小する | `python scripts/misc/downscale-assets.py` |

## speech-melody/ — 台詞イントネーション作曲

音MAD素材の台詞を16分格子へ伸縮・ピッチ補正し、手書きの伴奏に載せる（Python＋DAW での録音）。素材は `SPEECH_MATERIAL_DIR` で外から渡す。手順は [speech-melody/README.md](speech-melody/README.md)、動画まで作る流れと緩急・物語性の決まりは同 §8、既存曲のカバーは同 §9。

## otomad/ — 音MAD制作（曲と動画）

台詞イントネーション作曲の作品の build・動画・測定・メモ。曲ごとの build が他の曲の build を部品として読む作業場。場所は `lib/paths.py`（`.env` の `SPEECH_MATERIAL_DIR`・`OTOMAD_WORK`）で決まる。別PCでの再開手順は [otomad/README.md](otomad/README.md)。

---

## 曲を作って残す手順

先に [docs/design/handover-compose.md](../docs/design/handover-compose.md) の §0・§2 と流派の実測 [docs/research/kaiwai-lineages.md](../docs/research/kaiwai-lineages.md)（ゲームBGMは [docs/research/game-bgm-toby-fox.md](../docs/research/game-bgm-toby-fox.md)）を読む。
フォルダは `tmp/songs/<日本時間> - <モデル名> - <タイトル>/`。手順は1段ずつ書きためる。

1. `song-shelf.ts new [--title <タイトル>] [--model <モデル名>]` — フォルダと `meta.json`・`steps.md`・`notes.md` のひな形を作る。
   インストは `--title` を省くと未使用の鉱石名が付く。歌ものは鉱石名を使わず、海の生物に関係する語を含む名前を自分で付ける。
2. 段ごとに `song-shelf.ts step <曲> --did <やったこと> --saw <見たもの> --why <判断と理由> --ref <参考資料との照合>`。
3. 概要は `notes.md`（設計／確かめたこと／確かめていないこと／所有者に訊くこと）。作業用スクリプトは `scratch/`。
4. `song-shelf.ts publish <曲> song.mml --origin "4,5,7=auto;0=hand;8=derived" --key Gm --summary <一言> --with build.ts`
5. 所有者の評価を受けたら `song-shelf.ts verdict <曲> --verdict 使う --note <理由>`。

- **エージェントは一覧や公開デモのプレイヤーで再生ボタンを押さない**（スピーカーから鳴る）。
- **チャットへ MML 埋め込みの長い URL を貼らない**。`tmp/songs/index.html` や `notes.md` へのリンクで案内する。
- 公開版に無い機能を使う MML は、試聴の前にデプロイする。`#ver=` は今の版（`src/version.ts`）にする。
- 自動作曲の曲から小節を借りるときは、借りる小節の和音名と設計表の和音名を照合する。
- 手で組んだ MML はおまかせマスタリングの役割推定に掛かるので、`#t<n>inst=`・音量・`#t<n>comp=` を自分で書く（`src/ui/daw.ts` の `AUTO_ROLE_MIX`）。
- アプリの曲を seed から書き出すときは `export-samples.ts --app-seed`。
