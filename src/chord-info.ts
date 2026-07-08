/**
 * コード進行の書き方解説モーダルで表示するHTML。
 *
 * 編集UIと再生専用ビューの双方から参照されるため、
 * 循環参照を避けてここへ切り出している。
 * サンプル進行のボックスには `.dtm-modal-sample-copy-btn` / `.dtm-modal-sample-play-btn` を含み、
 * 表示側がイベントを接続して試聴・コピーを実現する。
 */
export const CHORD_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. 基本的な書き方と小節の区切り</h4>
  <p>小節を <code>|</code> (縦棒) または <code>→</code> で区切り、その中にコードネームを入力します。</p>
  <pre>例: | C | G | Am | Em |</pre>
  <p style="margin-top:4px; margin-bottom:12px;"><small>コード進行を自分で考えるのが難しいときは、コード進行の共有サイト（例: <a href="https://rechord.cc/scores" target="_blank" rel="noopener" style="color: var(--dtm-primary, #29adff); text-decoration: underline;">rechord.cc</a>）から好きな進行を探してコピペするのも手です。区切り文字（<code>|</code>）を合わせれば、そのまま使用できます。</small></p>

  <h4>2. 便利な制御文字</h4>
  <ul>
    <li><code>=</code> (継続): 直前のコードをそのまま次の拍まで伸ばします（タイ）。<br><small>例: <code>| C = | F G |</code> (Cを2拍伸ばし、前半1拍ずつF, G)</small></li>
    <li><code>%</code> (繰り返し): 直前のコードをもう一度繰り返します。<br><small>例: <code>| C % |</code> (1小節内でCを2回鳴らす)</small></li>
    <li><code>_</code> (休符): 伴奏を一時的に止めます（休符）。</li>
    <li><code>N</code> または <code>N.C.</code> (ノーコード): 伴奏を止めます。</li>
  </ul>

  <h4>3. 1小節に複数のコードを置く</h4>
  <p>コードネームのアルファベット(A〜G)の開始位置で自動的に分割されます。空白などで区切って並べて入力します。</p>
  <pre>例: | C G | Am Em | (1小節に2拍ずつコードを置く例)</pre>

  <h4>4. 代表的なコードネームの書き方</h4>
  <p>一般的な英語表記がそのまま使えます。シャープは <code>#</code>、フラットは <code>b</code> で入力します。</p>
  <ul>
    <li><b>三和音</b>: <code>C</code> (メジャー), <code>Cm</code> (マイナー), <code>Cdim</code> (ディミニッシュ), <code>Caug</code> または <code>C+</code> (オーグメント)</li>
    <li><b>四和音 (7th等)</b>: <code>CM7</code> または <code>Cmaj7</code>, <code>C7</code>, <code>Cm7</code>, <code>CmM7</code>, <code>Cdim7</code>, <code>Cm7b5</code> (ハーフディミニッシュ)</li>
    <li><b>テンション・その他</b>: <code>Cadd9</code>, <code>C9</code>, <code>Csus4</code>, <code>Csus2</code>, <code>C6</code>, <code>C69</code></li>
    <li><b>分数コード (ベース音指定)</b>: <code>C/E</code> (ベース音がEのCメジャー), <code>Dm7/G</code></li>
  </ul>

  <h4>5. セクション（見出し）を作る</h4>
  <p>行頭に <code>#</code> と見出しを入力すると、セクションが作成されて見た目の色が変わります。スクロール時の目印に便利です。</p>
  <pre>例:
# Intro
| C | G | Am | Em |
# Verse
| F | C | F | G |</pre>

  <h4>6. メタ情報（音色・メトロノーム）</h4>
  <p>行頭に以下の記述を置くことで、初期設定をカスタマイズできます。</p>
  <ul>
    <li><code># tone=guitar</code> : 初期音色をギターに設定 (他に <code>piano</code>, <code>strings</code> も対応)</li>
    <li><code># metronome</code> : メトロノームを初期状態でONにする</li>
  </ul>

  <h4 style="margin-top: 18px; border-top: 1px solid var(--dtm-border2); padding-top: 8px;">サンプル曲（試聴・コピー）</h4>

  <!-- サンプル1: 夜に駆ける -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">1. YOASOBI - 夜に駆ける (サビ風)</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-chords="# YOASOBI - 夜に駆ける\\n# tone=piano\\n| AbM7 | Bb | Gm7 | Cm7 |\\n| AbM7 | Bb | Gm7 | C |">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;"># YOASOBI - 夜に駆ける
# tone=piano
| AbM7 | Bb | Gm7 | Cm7 |
| AbM7 | Bb | Gm7 | C |</pre>
    <div class="dtm-modal-sample-desc">
      疾走感のあるピアノフレーズが特徴的な、同主調メジャーを絡めた人気の進行です。
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-chords="# YOASOBI - 夜に駆ける\\n# tone=piano\\n| AbM7 | Bb | Gm7 | Cm7 |\\n| AbM7 | Bb | Gm7 | C |">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>

  <!-- サンプル2: ただ君に晴れ -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">2. ヨルシカ - ただ君に晴れ (サビ風)</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-chords="# ヨルシカ - ただ君に晴れ\\n# tone=guitar\\n| D | E | C#m7 | F#m |\\n| D | E | C#m7 | F#m |">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;"># ヨルシカ - ただ君に晴れ
# tone=guitar
| D | E | C#m7 | F#m |
| D | E | C#m7 | F#m |</pre>
    <div class="dtm-modal-sample-desc">
      爽やかなアコースティックギターが映える、切なさのある王道進行ベースの展開です。
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-chords="# ヨルシカ - ただ君に晴れ\\n# tone=guitar\\n| D | E | C#m7 | F#m |\\n| D | E | C#m7 | F#m |">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>

  <!-- サンプル3: シャルル -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">3. バルーン - シャルル (サビ風)</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-chords="# バルーン - シャルル\\n# tone=strings\\n| DM7 | E7 | C#m7 | F#m7 |\\n| DM7 | E7 | C#m7 | F# |">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;"># バルーン - シャルル
# tone=strings
| DM7 | E7 | C#m7 | F#m7 |
| DM7 | E7 | C#m7 | F# |</pre>
    <div class="dtm-modal-sample-desc">
      ボカロ曲で絶大な人気を誇る、浮遊感がありエモーショナルなコード進行です。
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-chords="# バルーン - シャルル\\n# tone=strings\\n| DM7 | E7 | C#m7 | F#m7 |\\n| DM7 | E7 | C#m7 | F# |">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>
</div>
`;
