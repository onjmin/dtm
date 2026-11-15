# Scratch 文字PVの演出

- Scratch 製の界隈曲 PV に多い白黒の演出を、動画の書き出し（Python）で使えるようにした部品。手本は Scratch の文字PV（scratch.mit.edu/projects/1258224627）の project.json を読み、TurboWarp でコマを止めて確かめた。素材（絵・字・歌詞）は写していない。

## やり方

部品は `scripts/otomad/lib/scratch_fx.py`。見本の組み方は `scripts/otomad/tools/scratch_fx_demo.py`（界隈曲のフォルダと master.wav を渡すと、ドラムの打点と歌の1音1字から組む）。

```
python -I scripts/otomad/tools/scratch_fx_demo.py "tmp/songs/<曲>" tmp/<曲>/master.wav --bars 20 50
```

- 座標は Scratch の舞台と同じ（中心が原点・上が +y・縦 360）。Scratch 作品の数値をそのまま写せる。
- Scratch の毎コマの動きは 30fps の閉じた式にしてある。どの時刻から描いても同じ絵になる。
  - 寄せ: 毎コマ `x += (目標 - x) / k` → `approach()`。この作品は k = 2〜4.5。
  - 滑って止まる: 毎コマ v 進んで `v *= 5/6` → `drift()`。止まるまでに v × 6 進む。
  - 落ちる: `v -= 0.3`、最初に 0.5〜1.2 だけ跳ねる → `fall()`。
  - 消える: 透明度を毎コマ +5〜15% → `ghost()`。出る瞬間は 0.02 秒で4回ちらつく → `blink()`。

| 部品 | 見え方 |
|---|---|
| `BeatColumn`（左） | 拍ごとに満ちる箱の盤。箱1つ = 1拍、縦8行 = 2小節。列は2本で中央寄りがキック、外がスネア。4拍ごとに全部が1列外へずれ、3本目の隠し列（手本は透明度 100）へ入った箱は滑りながら薄れて消える。箱の中身は打った瞬間から1コマずつ白く満ちるドット絵（22×22）: キック＝滴が落ちて下から満ちる（7コマ）、2小節の最後の拍のキック＝左から塗り広がる（3＋10コマ）、スネア＝中心から十字に弾ける（6コマ）、サビのスネア＝風車のように回って満ちる（12コマ）。左の縦長の盤 |
| `BeatRow`（下） | 同じ盤の横長。`enter_from=左の盤` で、区間の頭に左の位置から箱ごとに少し遅れて滑ってくる（逆も同じ） |
| `LyricPV`（真ん中） | 枠のパーン・語ごとに滑り込む字・カメラ・崩れ落ち・右上の縦書きをまとめた文字PV。中心・大きさ・区間を渡す |
| 　`FramePop` | 中央の枠。サビの前に 0.15 秒ごと 12% ずつ5段縮み、サビ頭で 180° 回りながら元の大きさへ戻り、白く光って消える。サビの間だけ地を薄い灰色にする（LyricPV の中身。細かく組むときに直接使う） |
| 　`ScatterText` | 大きな字を枠の中へ置く。置いた瞬間に1方向へ滑って止まる。層ごとカメラで回す・寄る。枠の外は切る。サビの終わりに全部が白くなって崩れ落ちる（LyricPV の中身。細かく組むときに直接使う） |
| 　`VerticalLyrics` | 縦書きの歌詞を右から1行ずつ積む（LyricPV の中身。細かく組むときに直接使う） |
| `Subtitle` | サビ以外の下の1行字幕 |


### 3つの部品として使う

左の盤・下の盤・真ん中の文字PVは別々の部品で、どれも `draw(canvas, t)` と `spans`（出る区間）を持つ。要るものだけ作って `compose()` で重ねる。

```python
import scratch_fx as fx
st = fx.Stage()
left = fx.BeatColumn(st, beats, spans=[(0, 56.9), (83.6, None)])           # サビ以外は左
bottom = fx.BeatRow(st, beats, spans=[(56.9, 83.6)], enter_from=left)      # サビは下へ組み替え
left.enter_from = bottom                                                   # サビ明けは左へ戻る
center = fx.LyricPV(st, words, spans=[(56.9, 85.3)], bar=1.78, center=(0, 20), size=120)
frame = fx.compose(st, [left, bottom, center], t)                         # 先が奥
```

- 見本の組み立ては `--parts left,bottom,center,subs` で部品を選べる（例: `--parts center` で文字PVだけ）。
- 位置は `BeatColumn(x=, top=)`・`BeatRow(x0=, y=)`・`LyricPV(center=, size=)`。他の動画（ドット絵の MV など）の上に1つだけ重ねてもよい。

- 見本の字の置き方: 1語ごとに枠の中を入れ替え、語の字を枠の中の格子（3列）へ並べる。止まる位置から逆算して出発点を決めるので、字は枠の外から滑り込んで格子で止まる。
- 打点は song.mml の `#drum` の固定パターン（src/instruments/drum-config.ts）から拍の頭のキック・スネアを読む。ミックスの帯域から読むと、スネアが歌に埋もれてほとんど拾えなかった。


## 自作の sb3 をそのまま録る

Scratch（TurboWarp）で作った自分の作品を、そのまま動画にする。`scripts/otomad/tools/sb3_rec.mjs`（追加のインストール不要。手元の Edge と ffmpeg を使う）。

```
node scripts/otomad/tools/sb3_rec.mjs 作品.sb3 tmp/出力.mp4 --seconds 120 [--fps 30] [--size 1440x1080] [--flags 1] [--pad16x9] [--no-audio]
```

- ヘッドレスの Edge で turbowarp.org を開き、DevTools の通信で sb3 を読ませる。Scratch の時計を差し替えて1コマずつ進めるので、重い作品でもコマ落ちしない（実時間より速くも遅くもなる）。
- 音は鳴らさず「鳴らす」の時刻を記録し、終わってから同じ時刻に並べて WAV にする。音量ブロックは効く。ピッチ・パンの効果は未対応。
- 0 秒は最後に緑の旗を押した時刻。手本のように「2回押す」作品は `--flags 2`。`--seconds` を省くと全部のスクリプトが止まった所で終わる。
- 曲に合わせるなら、音は旗で「鳴らす」1回にして、絵はタイマー（`sensing_timer`）で動かす。「終わるまで鳴らす」の後は数コマ（0.1 秒ほど）遅れて再開する（試験: 0.125 秒の音で 8 コマ）。
- 試験の作品: `python -I scratch/sb3/make_test_sb3.py start` → `scratch/sb3/test_start.sb3`（四角が回り、ピッを 0.53 秒おきに4回）。

## 試した作品

- エイがとなりにすわってくる（20〜50小節、B→サビ→間奏頭）: 見本として書き出した（tmp/scratch_fx_demo/）。評価待ち。

## はまりどころ

- sb3_rec: turbowarp.org は開くと最初の作品（だんご）を読む。読み終わる前に差し替えると両方が動いて重なる。読み終えてから差し替える。

- 手本の箱は3列ぶんあるが、3列目は透明で見えない送り出し用。見える幅は2列。列は中央から外へ送る（逆にすると流れが逆に見える）。
- 1列 = 1小節の履歴ではない。2列はキックとスネアのレーンで、行が拍。中身も静止した柄ではなくコマ送りで満ちる（ソースの「次のコスチュームにする」の繰り返しは1コマに1回進む）。

- 枠の地を消した後に落ちる字が黒のままだと黒地に溶けて見えない。落ちる間は白にする（`fall_color`）。
- 縦書きの歌詞は積みすぎると枠に重なる。`max_cols`（9行）を超えたら積み直す。
- Scratch 作品のコマを取るとき、ブラウザの裏では setInterval が間引かれて実時間で取れない。`performance.now` と `Date.now` を差し替えて `vm.runtime._step()` を自分で回すと、30fps ちょうどで全コマ取れる（緑の旗は `vm.start()` してから押す）。
