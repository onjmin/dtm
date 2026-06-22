/**
 * MMLの書き方解説モーダルで表示するHTML。
 *
 * 編集UI（mountDAW）と再生専用ビュー（mountMmlPlayer）の双方から参照されるため、
 * 互いの循環参照を避けてここへ切り出している。サンプル曲のボックスには
 * `.dtm-modal-sample-copy-btn` / `.dtm-modal-sample-play-btn` を含み、
 * 表示側がイベントを接続して試聴・コピーを実現する。
 */
export const MML_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. 音符と休符</h4>
  <p><code>c</code>(ド) <code>d</code>(レ) <code>e</code>(ミ) <code>f</code>(ファ) <code>g</code>(ソ) <code>a</code>(ラ) <code>b</code>(シ) のアルファベットで表します。</p>
  <ul>
    <li>半音上げる: <code>c#</code> または <code>c+</code></li>
    <li>半音下げる: <code>d-</code></li>
    <li>休符: <code>r</code></li>
  </ul>

  <h4>2. 音の長さ</h4>
  <p>音名や休符の後に数値で指定します（例: <code>4</code> = 4分音符, <code>8</code> = 8分音符, <code>16</code> = 16分音符）。</p>
  <ul>
    <li><code>c4</code> : 4分音符のド</li>
    <li><code>r8</code> : 8分休符</li>
    <li><code>c4.</code> : 付点4分音符のド（長さを1.5倍に）</li>
    <li>数値を省略すると、<code>l</code> コマンドで設定されたデフォルト長（通常16分）になります。</li>
  </ul>

  <h4>3. オクターブ（音の高さ）</h4>
  <ul>
    <li><code>o4</code>, <code>o5</code> : 高さを直接指定（ふつうは o4 か o5）</li>
    <li><code>&gt;</code> : 1オクターブ上げる</li>
    <li><code>&lt;</code> : 1オクターブ下げる</li>
  </ul>

  <h4>4. テンポ</h4>
  <ul>
    <li><code>t120</code> : 曲の速さをBPM120に指定。※メロディ（@0）のテンポ指定が曲全体に反映されます。</li>
  </ul>

  <h4>5. 和音</h4>
  <p>音符を <code>[</code> と <code>]</code> で囲むと同時に発音します。</p>
  <pre>例: [ceg]4 （ド・ミ・ソを4分音符で同時に発音）</pre>

  <h4>6. トラックの区切り</h4>
  <p><code>;</code> または <code>@0</code>〜<code>@3</code> でトラックを切り替えます。</p>
  <ul>
    <li><code>@0</code>: メロディ</li>
    <li><code>@1</code>: サブメロ</li>
    <li><code>@2</code>: ベース</li>
    <li><code>@3</code>: 伴奏</li>
  </ul>

  <h4>7. 歌声・歌詞入力</h4>
  <p><code>@@&lt;トラック番号&gt; &lt;音源名&gt; &lt;歌詞&gt;</code> の形式で、音符と同期する歌詞を入力できます。</p>
  <pre>例: @@0 tsukuyomi どんぐりころころどんぐりこ</pre>
  <p style="margin-top:4px; margin-bottom:16px;"><small>（音源名は <code>tsukuyomi</code> や <code>klatt</code>, <code>roze</code> などの音声モデルを指定できます）</small></p>

  <h4 style="margin-top: 18px; border-top: 1px solid var(--dtm-border2); padding-top: 8px;">サンプル曲（試聴・コピー）</h4>

  <!-- サンプル1 -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">1. 基本のメロディ</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-mml="@0 t120 l8 o5 c d e f g a b > c">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;">@0 t120 l8 o5 c d e f g a b &gt; c</pre>
    <div class="dtm-modal-sample-desc">
      基本的なメロディの書き方（音名・長さ・オクターブとテンポ）。
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-mml="@0 t120 l8 o5 c d e f g a b > c">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>

  <!-- サンプル2 -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">2. 複数トラックと和音</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-mml="@0 t120 o5 c e g2 ; @3 o4 [ceg]2 [ceg]2">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;">@0 t120 o5 c e g2 ;
@3 o4 [ceg]2 [ceg]2</pre>
    <div class="dtm-modal-sample-desc">
      ; でトラック（上＝メロディ／下＝伴奏）を分け、[ceg] で和音を鳴らします。
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-mml="@0 t120 o5 c e g2 ; @3 o4 [ceg]2 [ceg]2">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>

  <!-- サンプル3 -->
  <div class="dtm-modal-sample-box">
    <div class="dtm-modal-sample-header">
      <span class="dtm-modal-sample-tag">3. 歌唱付き (どんぐりころころ)</span>
      <button class="dtm-btn dtm-btn--ghost dtm-btn--xs dtm-modal-sample-copy-btn" data-mml="@0 t120 v100 o4g8 g8 e8 e8 f8 e8 d8 c8 g8 g8 e8 e8 d4.; @@0 tsukuyomi どんぐりころころどんぐりこ;">📋 コピー</button>
    </div>
    <pre style="margin: 0; padding: 6px;">@0 t120 v100 o4g8 g8 e8 e8 f8 e8 d8 c8 g8 g8 e8 e8 d4.;
@@0 tsukuyomi どんぐりころころどんぐりこ;</pre>
    <div class="dtm-modal-sample-desc">
      @@0 tsukuyomi 歌詞... でメロディトラックに歌詞を同期させて歌わせます。※独自拡張
    </div>
    <div style="margin-top: 8px;">
      <button class="dtm-btn dtm-btn--primary dtm-btn--xs dtm-modal-sample-play-btn" data-mml="@0 t120 v100 o4g8 g8 e8 e8 f8 e8 d8 c8 g8 g8 e8 e8 d4.; @@0 tsukuyomi どんぐりころころどんぐりこ;">▶ 試聴</button>
    </div>
    <div class="dtm-modal-sample-player-container"></div>
  </div>
</div>
`;
