# BB素材を集めて、切り抜いて、動画に使う流れ

淫夢・クッキー☆などの BB素材（ブルーバック・グリーンバックの素材動画）を、エージェントが探して落とし、使う範囲を透過して、音MAD の動画（`scripts/otomad/songs/*/*_video.py`）に貼るまでの手順。道具は `scripts/otomad/tools/bb_fetch.py`。配られているスターターパックの一覧は [research/material-packs.md](research/material-packs.md)。

## 0. 置き場所

所有者が指定した素材フォルダ（`SPEECH_MATERIAL_DIR`、今は `D:\音MAD素材`）の下に、エージェント用のフォルダ `AI/` を作り、その中をジャンルで分ける。所有者が手で置いた素材（素材フォルダ直下の `淫夢/`・`クッキー☆/`・`エア本/`）には書き込まない。

```
D:\音MAD素材\                ← SPEECH_MATERIAL_DIR（所有者が指定）
  淫夢\ クッキー☆\ エア本\     ← 所有者が手で置いた素材。エージェントは読むだけ
  AI\                         ← OTOMAD_AI_DIR（既定 <SPEECH_MATERIAL_DIR>/AI）
    index.json                ← 集めた動画と切り抜きの一覧（ジャンル・題・URL・場所）
    淫夢\
      BB\sm28427080\          ← 1動画 = 1フォルダ
        source.mp4  info.json  sheet.png
        現場監督_ドッスン\    ← 切り抜き 1つ = 1フォルダ
          0001.png 0002.png …  meta.json  sheet.png
      パック\<パック名>\       ← 落としたスターターパックを展開したもの
    クッキー☆\  エア本\  その他\
```

- **置き場所はジャンルで分ける**。作品の中では混ぜてよいが、置き場所は混ぜない（作品ごとの寄せ集めフォルダや、混ぜたジャンルのフォルダを作らない）。
- ジャンルは動画のタグから決める（クッキー☆ → エア本 → 淫夢 → その他 の順に見る）。外れたら `get --genre クッキー☆` で渡す。ジャンルの一覧は `lib/paths.py` の `GENRES`。
- 場所は `.env` か環境変数で変える。`AI/` だけを別のドライブに置くなら `OTOMAD_AI_DIR=E:\otomad-ai`。
- クラウドのセッションでは、`SPEECH_MATERIAL_DIR=scratch/material` のように作業フォルダの下を指定する。クラウドのコンテナは使い捨てなので、セッションが終わると素材は消える（下の 7）。
- 素材は他の方の作品なので、git に入れず公開しない。

## 1. 探す

**落とす前に手元を探す。** 淫夢アルティメットスターターパックは、キャラごとに `一軍その１〜４/<名前>まとめ/<名前>素材/` に透過の立ち絵（茶碗の欠片兄貴式新素材、表情違いが大量）と BB動画がある。ファイル名の語で探すだけでは見落とすので、各「一軍」を開いてキャラのフォルダを見る（bb10 で野獣先輩を見落とした）。落とすのは手元に無いときだけ。

```bash
python -I scripts/otomad/tools/bb_fetch.py search 現場監督 BB素材 --check
```

- ニコニコの検索 API を再生数順に引く。`--check` を付けると、その環境から取れるか（「日本国内のみ」の制限が無いか）も見る。
- 語は「<人物> BB素材」「<人物> GB」「<人物> スターターパック」が当たりやすい。パックの中身をマイリストにしている場合（基本BB集 mylist/57249308 など）は、そこから ID を拾う。
- 2026-11-01 の時点では、クラウドから取れたのはニコニコの国内のみでない動画だけだった。YouTube はクラウドから取れなかった。

## 2. 落とす

```bash
python -I scripts/otomad/tools/bb_fetch.py get sm28427080
```

- `<AI>/<ジャンル>/BB/<id>/` に `source.mp4`（既定は 720p まで。`--height 360` で下げる）、`info.json`（題・URL・投稿者・投稿日・タグ・説明文）、`sheet.png`（全体を 20 コマ並べた一覧）を書き、`index.json` に足す。
- クラウドから取れない動画は、手元の PC で同じコマンドを流す。

## 3. 使う範囲を決める

`sheet.png` を見て、使う場面のおおよその秒を決める。細かく見るときは、その秒のコマを1枚書き出す。

```bash
ffmpeg -v error -ss 2.5 -i source.mp4 -frames:v 1 f.png
```

画像を見るたびに使用量が増えるので、確認は一覧 1 枚で済ませ、コマを1枚ずつ見るのは境目に迷ったときだけにする。

## 4. 切り抜いて透過する

```bash
python -I scripts/otomad/tools/bb_fetch.py key sm28427080 現場監督_ドッスン --ss 0 --to 5
```

- `<id>/<名前>/` に透過の連番 PNG（`0001.png`…）、`meta.json`（fps・コマ数・地の色・全コマの絵の外接矩形 `bbox`・元の大きさ）、`sheet.png`（市松の地に 10 コマ並べた確認用）を書く。
- 透過の仕組み: 地の色を画面の縁から推定し、色差（Cb・Cr）で抜く。明るさのむらに強い。縁を 1px 削ってぼかし、地の色のにじみ（青なら青の成分が他の 2 色を超える分）を消す。
- `sheet.png` を見て直す:

| 見えたこと | 直し方 |
|---|---|
| 地が残る | 地の色を `--color 0000FF` で渡す。`--tol` を上げる |
| 絵の中まで抜ける（青い服・緑の髪など） | `--tol` を下げる |
| 縁に地の色の線が残る | `--erode 2` |
| `bbox` が画面全体になる | 黒い頭出しや字幕のコマが入っている。`--ss`・`--to` で外す |
| コマ数が多すぎる | `--fps 15`（動画側の fps に合わせる） |

- 背景が単色でない実写の場面は、この道具では抜けない。人物を切り抜くモデルが要る（まだ試していない）。
- パックに透過済みの PNG が入っているときは、そちらを使えば 4 は要らない（CRN の正規化パックは大きさ・中心までそろっている）。

## 5. 動画に使う

`*_video.py` の中で、連番を時刻からコマ番号に直して読み、PIL の `alpha_composite` で貼る。

```python
import json
from pathlib import Path
from PIL import Image
from paths import AI

CUT = AI / "淫夢/BB/sm28427080/現場監督_ドッスン"
META = json.loads((CUT / "meta.json").read_text(encoding="utf-8"))
L, T, R, B = META["bbox"]  # 全コマの絵が収まる矩形。余白を切って軽くする

def bb_frame(t, loop=True):
    """切り抜きの頭からの秒 t のコマ（RGBA）。"""
    i = int(t * META["fps"])
    i = i % META["frames"] if loop else min(i, META["frames"] - 1)
    return Image.open(CUT / f"{i + 1:04d}.png").crop((L, T, R, B))

# 台詞の頭（placement.json の秒）から出す例
def draw(frame, t, t0, x, y, scale=1.0):
    if t < t0:
        return
    im = bb_frame(t - t0)
    if scale != 1.0:
        im = im.resize((int(im.width * scale), int(im.height * scale)))
    frame.alpha_composite(im, (x, y))
```

- 台詞の頭・拍に合わせるなら、`t0` に placement.json の秒を入れる。BB の動きを拍に合わせたいときは、`t` を拍の位相から作る（例: 1拍で1ループ → `t = (拍の位相) * META["frames"] / META["fps"]`）。
- 同じコマを何度も読むなら、`functools.lru_cache` で `bb_frame` を包む。multiprocessing で並べるときは、プロセスごとにキャッシュする。
- 1本の作品の中で淫夢とクッキー☆の素材を混ぜてよい。読むのはそれぞれのジャンルのフォルダからで、作品用に1か所へ寄せ集めない（[rules.md](rules.md) の「素材」）。

## 6. 確かめる

- 指定した秒のコマと、全体の一覧画像（ffmpeg の tile）で、絵の縁に地の色が残っていないか、台詞の頭に出ているかを見る。
- 確認は `FPS=15`、渡すのは 30fps（[rules.md](rules.md) の「確かめ方」と同じ）。

## 7. セッションをまたいで持ち越す

- クラウドのコンテナは使い捨てで、別のセッションでは消える。同じセッションでも、しばらく操作が無いと回収されて消える。
- 手元の PC で流すなら、`D:\音MAD素材\AI\` にそのまま残る。
- クラウドで集めたものを残すには、外の保管先（Cloudflare R2・Google Drive などを rclone で）へ上げる仕組みが要る（まだ無い）。それまでは、`index.json` の ID と区間をもとに、`get`・`key` で取り直す。
