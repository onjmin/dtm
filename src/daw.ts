/**
 * mountDAW — 1関数でマウントできるモバイルファーストDAWコンポーネント（Layer 2）。
 *
 * 発音は注入フック（onPlayNote / onPlayDrum）へ委譲し、ライブラリ自体は音を出さない。
 * MIDI/コード解析も注入（parseMidi / parseChord / parseChords）。未注入なら該当UIを隠す。
 */

import { GM_INSTRUMENT_NAMES } from "./audio-config";
import { type ChordPlayerInstance, mountChordPlayer } from "./chord-player";
import { buildChordPlacements, type ChordPatternType } from "./chords";
import { buildUI } from "./daw-ui";
import type { DelayDivision } from "./delay";
import {
	DRUM_PATTERNS,
	getDrumPatternKeys,
	normalizeDrumPatterns,
	resolveDrumPattern,
} from "./drum-config";
import { icon } from "./icons";
import { INSTRUMENT_PRESETS } from "./instrument-presets";
import {
	isValidHttpUrl,
	KOE_VOICEBANK_LABELS,
	KOE_VOICEBANK_TERMS,
	KOE_VOICEBANKS,
	MAX_VOCAL_VOLUME,
	normalizeLyrics,
	panToStereo,
	parseCustomVocals,
	type StreamVoiceTrack,
	VOICE_IMAGE_KEY,
	vocalVolumeToGain,
} from "./lyrics";
import {
	applyHarmonicFilter,
	applyMonophonic,
	generateRandomPattern,
	shiftNotes,
	transposeNotes,
} from "./macros";
import {
	analyzeMidiTracks,
	buildDrumPatternJson,
	exportMIDI as exportMIDIBlob,
	extractMidiDrumPattern,
	extractMidiPlacements,
	extractMidiPlacementsByTrack,
	isPlausibleMidiTranscription,
} from "./midi-io";
import { MidiSearchClient } from "./midi-search";
import { decomposeToMonophonic, isChordHeavyTrack, MMLCore } from "./mml-core";
import { MML_INFO_HTML } from "./mml-info";
import { formatMmlMeta, parseMML } from "./mml-parser";
import { mountMmlPlayer } from "./mml-player";
import {
	drawGrid,
	drawNotes,
	drawSelectedNotes,
	getDrawOffset,
	getGridCanvas,
	getGridContext,
	getGridPosition,
	getHeaderCanvas,
	init,
	setBackgroundActive,
	setDrawOffset,
} from "./renderer";
import {
	DEFAULT_REVERB_DECAY_SEC,
	DEFAULT_REVERB_PREDELAY_MS,
	MAX_REVERB_DECAY_SEC,
	MAX_REVERB_PREDELAY_MS,
	MIN_REVERB_DECAY_SEC,
	MIN_REVERB_PREDELAY_MS,
} from "./reverb";
import { createSequencer, type Sequencer } from "./sequencer";
import { SONG_DRUM_PATTERNS } from "./song-drum-config";
import { injectStyles, showLoadingOverlay } from "./styles";
import type {
	CustomVocalDef,
	DawInstance,
	DawMode,
	DawOptions,
	DawViewState,
	LyricTrack,
	Note,
	OctaveUnisonMode,
	PlaybackState,
	RenderConfig,
	ToolMode,
	TrackConfig,
} from "./types";
import {
	DEFAULT_BPM,
	DEFAULT_GATE,
	DEFAULT_PAN,
	DEFAULT_VELOCITY,
	DEFAULT_VOCAL_VOLUME,
	MML_END_MARKER,
} from "./types";
import { FALLBACK_VOCAL_ICON, VOICE_IMAGES } from "./voice-images";

const CHORD_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. 基本の書き方</h4>
  <p>コード名（和音記号）を縦線 <code>|</code>、スペース、またはカンマで区切って入力します。縦線で区切ると1小節ごとの配置になります。</p>
  <pre>例: C | G | Am | F</pre>
  <p style="margin-top:4px;"><small>コード進行を自分で考えるのが難しいときは、コード進行の共有サイト（例: <a href="https://rechord.cc/scores" target="_blank" rel="noopener">rechord.cc</a>）から好きな進行を探してコピペするのも手です。区切り文字（<code>|</code> / スペース / カンマ）だけ上の形式に合わせれば、そのまま使えます。</small></p>

  <h4>2. 1小節に複数コードを入れる</h4>
  <p>小節の区切り（縦線 <code>|</code>）の中に、スペース区切りでコードを並べます。等間隔に配置されます。</p>
  <pre>例: C G | Am F</pre>
  <p style="margin-top:4px;"><small>（1小節目：前半C・後半G、2小節目：前半Am・後半F）</small></p>

  <h4>3. 対応コード名</h4>
  <ul>
    <li>メジャー / マイナー: <code>C</code>, <code>Dm</code>, <code>Am</code> など</li>
    <li>セブンス: <code>C7</code>, <code>Am7</code>, <code>FM7</code> など</li>
    <li>その他: <code>Csus4</code>, <code>Cdim</code>, <code>Caug</code>, <code>Cadd9</code> など</li>
  </ul>

  <h4>4. 演奏パターン</h4>
  <ul>
    <li><strong>ブロック</strong>: 和音の構成音をすべて同時に伸ばして演奏します。</li>
    <li><strong>アルペジオ</strong>: 和音の構成音を低い順に分散して演奏します。</li>
    <li><strong>アルペジオ（ジャラーン）</strong>: 素早くアルペジオを鳴らします。</li>
    <li><strong>裏打ち</strong>: 各拍の裏（8分裏）のタイミングでコードを刻みます。</li>
    <li><strong>ヤツメ穴</strong>: リズミカルなピコピコゲーム風の伴奏パターンです。</li>
    <li><strong>交互奏</strong>: ルート音（低音）とコード構成音（高音）を交互に刻みます。</li>
  </ul>
</div>
`;

const VIBRATO_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>ONにすると、一定の長さ（約0.35秒）以上の音符（ロングトーン）にだけ、自動でピッチが小刻みに揺れる歌唱表現（ビブラート）が掛かります。</p>
  <h4>短い音符に掛からない理由</h4>
  <p>1周期も揺れきらないうちに次の音へ移ってしまい、ビブラートというより単なる音程のブレとして不自然に聞こえるためです。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>ピッチを揺らす効果なので、声質そのものを変えるジェンダー/ブレシネスとは独立して組み合わせられます。速さ・深さは調整できません（歌として破綻しにくい控えめな量に固定）。曲や箇所ごとに掛けたい/掛けたくないがある場合は、トラックを分けて歌詞を書いてください。</p>
</div>
`;

/** オクターブユニゾンのMMLトークン（`w0`=none 省略可, `w1`=down, `w2`=up, `w3`=both）。 */
const OCTAVE_UNISON_TOKEN: Record<OctaveUnisonMode, string> = {
	none: "",
	down: "w1",
	up: "w2",
	both: "w3",
};

const OCTAVE_UNISON_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックの各音節に、もう1声を1オクターブ上/下/両方（控えめな音量）で同時に重ねて発音します。声に厚み・パワーを足す「オクターブユニゾン（ダブリング）」という定番のボーカル加工です。</p>
  <h4>下・上・両方の違い</h4>
  <p>「下」は声に重み・パワーを足す定番の使い方（ロック/EDMのバッキング等）。「上」は太さではなく煌びやかさ・可憐さを足す使い方（アニソン/ハモリ等）。「両方」は上下同時に重ねる特殊な効果で、キャラクター性を強く出したいときに。</p>
  <h4>使いどころ</h4>
  <p>サビの決めのフレーズ、ロボット的/ダークな質感の演出、ユニゾンハーモニーなどでよく使われます。曲全体に掛けっぱなしにすると常にくどい印象になりやすいので、トラックを分けて使いたい箇所だけに絞るのがおすすめです。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>重ねる声にも同じビブラート/ジェンダー/ブレシネス/リバーブ送り/ディレイ送りの設定がそのまま適用されます。音量比・音程差（1オクターブ固定）は調整できません。「両方」は合成が3倍走るため、音数の多いトラックではやや重くなります。</p>
</div>
`;

const GENDER_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>ピッチ（音の高さ）はそのままに、声の太さ/細さ（フォルマント＝声道の共鳴、年齢・性別感の印象）だけを動かします。50が無変化、50未満で低め/太め（大人びる）、50超で高め/細め（若く/明るく）に寄ります。</p>
  <h4>オクターブシフトとの違い</h4>
  <p>オクターブは音程そのものを上下させますが、ジェンダーは音程を変えずに声色だけを動かします。「高い声のまま大人びさせる」「低い声のまま若々しくする」といった、音程と声質を別々に調整したいときに使います。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>ブレシネスと組み合わせて声のキャラクターを作ります（例: 低め+息多めで渋い/大人っぽい印象、高め+息少なめで元気/若々しい印象）。koe音源（UTAU由来の.koe音源）限定の効果で、klatt（内蔵の簡易合成）では変化しません。</p>
</div>
`;

const BREATHINESS_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>息成分の量です。50が無変化、大きいほど息っぽく（ささやき寄り）、小さいほど芯のある声になります。</p>
  <h4>上げすぎるとどうなるか</h4>
  <p>ロングトーンで音程感が薄れて聞こえます（息の音がピッチ感を隠すため）。囁くようなバラード表現には効果的ですが、上げすぎるとメロディが伝わりにくくなります。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>自動ビブラートと組み合わせると、揺れながら息っぽい、よりエモーショナルな表現になりやすいです。koe音源（UTAU由来の.koe音源）限定の効果で、klatt（内蔵の簡易合成）では変化しません。</p>
</div>
`;

const TENSION_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>声の張り／押し出しの強さです。50が無変化、大きいほど張った・押した声（「こぶし」寄り、力強く歌わせる）になり、小さいほど脱力したリラックスした声になります。</p>
  <h4>ブレシネスとの違い</h4>
  <p>ブレシネスは息成分の量（芯のある声⇔息っぽい声）を動かしますが、テンションは声帯の締まり・押しの強さ（脱力⇔張った声）を動かします。テンションを上げるとサビの力強さ、下げると穏やかな囁きに寄せた歌わせ方になります。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>ブレシネスを下げつつテンションを上げると、より芯があり力強い歌声になります。逆にブレシネスを上げつつテンションを下げると、より脱力した息っぽい歌声になります。koe音源（UTAU由来の.koe音源）限定の効果で、klatt（内蔵の簡易合成）では変化しません。</p>
</div>
`;

const LYRIC_REVERB_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このボーカルトラックから、曲全体に掛かる「マスタリバーブ」へどれだけ音を送るかを決めます（0で送らない＝ドライ、100で目一杯送る）。</p>
  <h4>マスタの「リバーブ」つまみとの関係（重要）</h4>
  <p>トラック設定パネルにあるマスタの「リバーブ」つまみが0%だと、ここをいくら上げても無音のままです。「送り量（このトラックがどれだけ提供するか）」と「マスタの残響設定（実際にどんな響きが掛かるか）」の二段構えになっているためです。両方を確認してください。</p>
  <h4>掛けすぎるとどうなるか</h4>
  <p>残響で音が滲み、歌詞が聞き取りにくくなります。ドライなボーカルは「近い」「前に出る」印象、リバーブたっぷりのボーカルは「奥行きがある」「幻想的」な印象になります。表現したい距離感に合わせて調整してください。</p>
</div>
`;

const LYRIC_DELAY_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このボーカルトラックから、曲全体に掛かる「マスタディレイ」へどれだけ音を送るかを決めます（0で送らない、100で目一杯送る）。</p>
  <h4>マスタの「ディレイ」つまみとの関係（重要）</h4>
  <p>マスタの「ディレイ」つまみが0%だと、ここをいくら上げても無音のままです。リバーブ送りと同じ二段構えです。</p>
  <h4>使いどころ</h4>
  <p>曲全体にうっすら掛けるリバーブと違い、ディレイはハッキリ聞こえる繰り返しなので、Aメロは0%・サビの語尾だけ送り量を上げる、といったメリハリのある使い方が効果的です。バッキング全体に強く掛けるとリズムが濁ります。</p>
</div>
`;

const MASTER_REVERB_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>リバーブ（Mix）</h4>
  <p>曲全体に一律で掛かる残響（部屋鳴り・空間の響き）の量です。0%で完全にドライ（響きなし）、上げるほど広い空間で鳴っているような奥行きが出ます。掛けすぎるとミックス全体の輪郭がぼやけ、遠く・こもった印象になります。10〜30%程度が出発点の目安です。</p>
  <h4>Decay（残響の長さ）</h4>
  <p>リバーブが鳴り続ける長さです。長いほど広いホールのような空間の印象になり、短いと狭い部屋のような密着感になります。目安として、速い曲では0.6〜1.4秒、遅い曲・バラードでは1.8〜4.0秒程度がよく使われます。</p>
  <h4>Pre Delay（原音とリバーブの間隔）</h4>
  <p>原音が鳴ってから残響が立ち上がるまでの遅延です。0msだと原音と残響が同時に始まり音像がぼやけがちですが、少し（数十ms程度）入れると原音の輪郭・アタック感を保ったまま奥行きを足せます。特にボーカルで効果的です。</p>
  <h4>各トラックの「リバーブ送り」との関係（重要）</h4>
  <p>歌詞トラックにはそれぞれ「リバーブ送り」という個別のつまみがあり、そちらが0%のトラックはこのマスタの値をいくら上げても無音のままです。逆にこのマスタのMixが0%なら、どのトラックの送り量を上げても効果が出ません。「マスタ＝残響の質・量・タイミングそのもの」「トラック送り＝そのトラックをどれだけ混ぜるか」という二段構えです。楽器トラックには現状センド機能が無いため、常に一律で掛かります。</p>
</div>
`;

const MASTER_DELAY_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>離散したエコー（音の繰り返し）を付加します。曲のBPMに自動同期する音価（8分・付点8分など）を選んで使うのが基本で、無関係な秒数で鳴らすとリズムが崩れて聞こえます。</p>
  <h4>リバーブとの違い</h4>
  <p>リバーブは拡散した残響で空間全体に薄く掛けるのが基本ですが、ディレイはハッキリ聞こえる繰り返しなので「ここぞ」という場面（リードボーカルの語尾、ギターソロ、シンセのフレーズ等）にワンポイントで使うのが定番です。バッキング全体に強く掛けるとリズムが濁ります。</p>
  <h4>各トラックの「ディレイ送り」との関係</h4>
  <p>リバーブと同じ二段構えです。歌詞トラック個別の「ディレイ送り」が0%ならこのマスタの値を上げても無音、逆にこのマスタが0%ならどのトラックの送り量を上げても効果が出ません。</p>
</div>
`;

const FADE_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>曲の頭で音量0%から徐々に上げる「フェードイン」、曲の終わりで音量を0%まで徐々に下げる「フェードアウト」を設定します。0秒でフェードなしです。</p>
  <h4>いつ効くか</h4>
  <p>フェードインは曲の先頭（0小節目）から再生したときだけ掛かります。途中の小節から再生・シークした場合は掛かりません。フェードアウトは、今ノートが置かれている範囲の終端に向けて自動的に掛かります（ノートを足せば終端も伸びます）。</p>
  <h4>使いどころ</h4>
  <p>編集中はほとんど意識しませんが、書き出して人に聴かせる・配信する段になると、曲の出入りが唐突だと素人っぽく聞こえがちです。数秒のフェードを入れるだけで仕上がりの印象が変わります。</p>
</div>
`;

const TRANSPOSE_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>全トラックのノートを選んだ半音数だけ一括で移調します。歌詞トラックの歌声もノートのピッチに追従するため、ボーカルも一緒に移調されます。</p>
  <h4>使いどころ</h4>
  <p>「歌ってみたら音域が高すぎた/低すぎた」というときの調整定番です。ボーカルの声域に合わせて曲全体のキーを上げ下げできます。</p>
  <h4>注意</h4>
  <p>ノートデータを直接書き換える操作です（元に戻すには「元に戻す」ボタンを使ってください）。MIDIノート範囲（0-127）を超える音は範囲内にクランプされます。</p>
</div>
`;

const TRACK_EQ_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックの周波数帯域ごとの音量を調整します。低域・中域・高域の3バンド、それぞれ-12dB（削る）〜+12dB（持ち上げる）、0dBが無変化です。</p>
  <h4>使いどころ（帯域の棲み分け）</h4>
  <p>複数の音が同じ帯域で鳴っていると濁って聞こえます。例えば、ボーカルとリード楽器が中域でぶつかるなら片方の中域を軽く削る、ベースとバスドラムの低域がぶつかるなら片方だけ低域を削る、といった「帯域の交通整理」がEQの主な仕事です。</p>
  <h4>他の設定との兼ね合い（順序が重要）</h4>
  <p>このチャンネルストリップでは EQ → 音圧強化（コンプレッサー） → ステレオ幅 の順で処理されます。これは一般的なミックスの定石と同じです。不要な帯域（低域のこもり、耳障りな高域等）を先にEQで削ってからコンプレッサーを掛けると、コンプが本当に必要な音だけに反応するようになり、音圧強化の効きが良くなります。順序を変えることはできません。</p>
</div>
`;

const TRACK_COMPRESSION_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックにコンプレッサーを掛け、音量の大小差を縮めて「前に出る」「聞こえやすい」音にします。市販曲のマスタリングやミックスで定番の処理です。0で無圧縮、100に近づくほど強く圧縮されます。</p>
  <h4>掛けすぎるとどうなるか</h4>
  <p>強弱の表情（ダイナミクス）が失われて単調に聞こえます。ボーカルやリード楽器は控えめ（20〜40程度）、ドラムやベースはやや強め、が一般的な目安です。</p>
  <h4>他の設定との兼ね合い</h4>
  <p>マスタの「安全リミッター」（常時ON、[reverb]パネルの外側で自動的に働く保険）とは別物です。あちらは音割れを物理的に防ぐための最終防衛ラインで、常に控えめに動いています。こちらのコンプレッサーは音作り（表現）のための処理で、トラックごとに好きなだけ強く/弱く掛けられます。「おまかせマスタリング」は全トラック一律35%を当てるだけなので、ボーカルなど目立たせたいパートは後で個別に下げると輪郭が出やすくなります。</p>
</div>
`;

const TRACK_WIDTH_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>左右の広がりを調整します。100が原音のまま、0で完全モノラル（左右が同じ音）、100を超えると左右の違いが誇張されて広く聞こえます。</p>
  <h4>「定位（パン）」との違い</h4>
  <p>定位は「音をどこに置くか」（左寄り/中央/右寄り）、ステレオ幅は「その音自体がどれだけ広がって聞こえるか」で、役割が異なります。両方を強く使うと定位がぼやけて曖昧になりがちです。</p>
  <h4>広げすぎるとどうなるか</h4>
  <p>スマホのスピーカー1個など、モノラルに近い環境で再生すると音が薄く/位相が乱れて聞こえることがあります（左右の差分を誇張しているため、足し合わせると打ち消し合う成分が増える）。主旋律やボーカルは中央付近で狭め、パッドやシンセの装飾パートは広げる、というのがミックスの定石です。</p>
</div>
`;

const TRACK_PAN_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックを左右のどこに置くかを決めます。64が中央、0で左いっぱい、127で右いっぱいです。歌詞トラックの場合、ここは楽器としてのトラック全体の定位で、歌唱そのものの定位（下の「定位」欄・vocalPan）とは別に働き、両方が重なって最終的な位置になります。</p>
  <h4>「ステレオ幅」との違い</h4>
  <p>定位は「音をどこに置くか」（左寄り/中央/右寄り）、ステレオ幅は「その音自体がどれだけ広がって聞こえるか」で、役割が異なります。両方を強く使うと定位がぼやけて曖昧になりがちです。</p>
  <h4>ミックスの定石</h4>
  <p>主旋律・ボーカル・ベースなど曲の軸になるパートは中央付近に置き、ハモリ・カウンターメロディ・伴奏（コード/パッド）など彩りのパートを左右へ振り分けると、各パートの居場所が分かれて聞き取りやすくなります（特に低域は中央に集めるのが定石です — 左右に振ると位相干渉でモノラル再生時に低音が痩せることがあります）。</p>
</div>
`;

const TRACK_REVERBSEND_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックの音を、マスタリバーブ（[reverb]パネルのDecay/Pre Delay/Mix）へどれだけ送るかを 0-100% で決めます。0なら送らない＝このトラックにはリバーブが掛かりません。</p>
  <h4>「声だけリバーブ」を作るには</h4>
  <p>リバーブは全トラックへ一律で掛かるわけではなく、この送り量で個別に決まります。ボーカルのトラックだけ送り量を上げ、他の楽器トラックは0のままにすれば、声だけにリバーブを掛けられます。低域の楽器（ベース・キック等）は送らない、ボーカルやパッドは多めに送る、というのがミックスの定石です。</p>
  <h4>[reverb]パネルのMixとの関係</h4>
  <p>Mixは「送られてきた音をどれだけ返すか」という全体の返り量です。各トラックの送り量が0なら、Mixを上げても何も返ってきません。まずこのトラックの送り量を決めてから、Mixで全体の掛かり具合を微調整してください。</p>
</div>
`;

const TRACK_DELAYSEND_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>このトラックの音を、マスタディレイ（[delay]パネル）へどれだけ送るかを 0-100% で決めます。0なら送らない＝このトラックにはディレイが掛かりません。</p>
  <h4>「低域には掛けない」が定石</h4>
  <p>ディレイ（やまびこのような繰り返し）を低域に掛けると、繰り返しが重なってリズムが濁りやすいため、ベースなど低音パートは送らない（0のまま）のが定石です。リード楽器・ボーカルの語尾など、聞かせたいワンポイントだけに送るのが効果的です。</p>
  <h4>[delay]パネルのMixとの関係</h4>
  <p>[delay]パネルの掛かり具合が0%だと、ここをいくら上げても無音のままです。「送り量（このトラックがどれだけ提供するか）」と「マスタのディレイ設定（実際にどんな繰り返しが掛かるか）」の二段構えになっているためです。両方を確認してください。</p>
</div>
`;

const MASTER_COMP_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>何をする設定か</h4>
  <p>全トラックが合流した後（マスタリバーブ・マスタディレイの戻りも含む）にまとめて軽く掛ける、マスタバスの「グルー（接着剤）コンプレッサー」です。0%で無効、上げるほど各トラックの音量差が均され、バラバラに鳴っていたパートがひとまとまりの「バンド感」「一体感」を持って聞こえるようになります。</p>
  <h4>常時ONの「安全リミッター」との違い</h4>
  <p>音割れ検知バッジと連動する安全リミッターは、常にONで音割れを防ぐための保険です。こちらのグルーコンプは既定0（オフ）で、音を良くするための表現目的の処理です。掛かる順序はグルーコンプ→安全リミッターで、グルーコンプ通過後の信号を安全リミッター・音割れ検知メーターが監視します。</p>
  <h4>トラック単位の「音圧強化」との違い</h4>
  <p>各トラックの「音圧強化」（チャンネルストリップのコンプレッサー）は、そのトラック単体の粒立ちを揃えるためのものです。グルーコンプはそれとは別に、全トラックが混ざった後の「合奏」全体に対して掛かります。両方を強く掛けすぎるとダイナミクス（強弱の表情）が失われて単調になりやすいため、グルーコンプは控えめ（20〜40%程度）が出発点の目安です。</p>
</div>
`;

const AUTO_MASTER_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>おまかせマスタリングとは</h4>
  <p>市販曲でよく使われる値を目安に、以下をまとめて設定するボタンです。曲のBPMを見て一部の値を自動調整します。</p>
  <h4>ゲインステージング（実測ベースの音量調整）</h4>
  <p>再生している間、裏でマスタのピークレベル（音割れ検知バッジと同じ実測値）を継続的に収集しています。合計2秒以上の再生実績が溜まっていれば、「おまかせ」実行時にその実測ピークを目標ヘッドルーム（-6dBFS付近）に収まるよう逆算して、マスタ音量を自動調整します。</p>
  <p style="margin-top:4px;"><small>ノートのベロシティなど静的な情報だけでは、複数トラックが重なって実際にどれだけ音圧が積み上がるか（トラック単位の圧縮・EQ後の値も含む）は分かりません。実際に鳴らした音を測るのが最も確実なため、このボタンを押すたびに使うのではなく、ある程度編集して一度でも再生した後に押すと効果を発揮します。一度も再生していない・再生時間が短すぎる場合は判断材料が無いため、この項目はスキップされ他の値だけが適用されます。</small></p>
  <ul>
    <li>マスタバス グルーコンプレッサー: 25%（各トラックの頭を軽く均して一体感を出す、控えめな量）</li>
    <li>マスタリバーブ Mix: <strong>アレンジの密度（音の入っているトラック数）に応じて自動計算</strong>（2トラック以下で28%、8トラック以上で12%、その間は線形補間）</li>
    <li>マスタリバーブ Decay: <strong>現在のBPMに応じて自動計算</strong>（速い曲ほど短く0.9秒寄り、遅い曲ほど長く3.0秒寄り）</li>
    <li>マスタリバーブ Pre Delay: 20ms（原音の輪郭を保ったまま奥行きを足す定番値）</li>
    <li>フェードアウト: 未設定（0秒）のときだけ1.5秒を補う（曲の終わりをぶつ切りにしない）。既に0秒以外の値が設定済みなら上書きしない</li>
  </ul>
  <p style="margin-top:4px;"><small>マスタリバーブMixを密度で決めるのは、「音数の多い厚いアレンジに残響を重ねすぎると濁る、音数の少ない隙間の多い編成には残響で空間を埋めると心地よい」というミキシングの定石に基づきます。</small></p>
  <h4>楽器・音量・役割ごとのミックスの自動割り当て</h4>
  <p>歌詞のないトラックは、置かれているノートの音高・タイミング・和音の厚みから役割（メロディ/サブメロ/ベース/伴奏）を推定し、楽器・音量に加えて音圧強化・ステレオ幅・定位・リバーブ送り・ディレイ送り・EQをまとめて役割相応の値へ設定します。</p>
  <ul>
    <li><strong>低音域（C3未満）が中心</strong> → ベース。基準音量85（低いほど底上げ、最大+12）、音圧強化40%（粒立ちを揃える）、ステレオ幅100%（広げない）、定位は中央固定、リバーブ送り5%（濁り防止）、ディレイ送り0%（低域には掛けない）、EQ低域+2dB／高域-3dB。</li>
    <li><strong>和音（同時発音）が多く音価も長い</strong> → 伴奏（コード/パッド）。基準音量72（重なりの厚みぶんさらに下げる）、音圧強化25%（自然な強弱を残す）、ステレオ幅118%（空間を埋める）、定位は左右へ広めに振り分け、リバーブ送り22%、ディレイ送り0%、EQ低域-4dB（ベースの帯域を空ける）。</li>
    <li><strong>単音で音数が少なく音価が長い</strong> → サブメロ（オブリガート寄り）。基準音量92、音圧強化32%、定位は左右へやや振り分け、リバーブ送り15%（メロディの一歩後ろへ）、ディレイ送り8%、EQ低域-3dB／高域+1dB。</li>
    <li><strong>それ以外（単音で動きが多い）</strong> → メロディ。基準音量100、音圧強化35%、定位は中央固定、リバーブ送り12%（前に出す）、ディレイ送り15%（聞かせどころに薄く）、EQ低域-2dB／高域+2dB（抜け・プレゼンス）。</li>
  </ul>
  <p style="margin-top:4px;"><small>いずれも一般的なミキシングの経験則です。低域はモノラルに寄せる（ベースのステレオ幅・定位を中央固定にする）ことで位相干渉によるモノラル再生時の痩せを防ぎ、他パートはEQで低域を軽く削って周波数帯域をベースと住み分けます（frequency slotting）。曲の軸になるメロディ・ベースは中央、彩りのサブメロ・伴奏は左右へ散らして各パートの居場所を分けます（同じ役割のトラックが複数あるときは左右を交互に振り分けます）。ディレイは低域に掛けると繰り返しが重なりリズムが濁るため、ベース・伴奏には送りません（[delay]パネルの掛かり具合が既定0%＝オフなので、有効化するまでは無音）。楽器名は現在選択中の楽器プリセット（未選択ならグランドピアノ）から役割に対応するものを引きます。音の無いトラックは判定できないため対象外です。あくまで自動推定なので、意図と違う場合は各トラックの設定欄から個別に選び直してください。</small></p>
  <h4>メインボーカルの自動判定</h4>
  <p>歌詞のあるトラックが複数ある場合（ハモリ・コーラス・掛け声等）、発音時間が最も長いトラックを「メインボーカル」とみなし、他とは違う扱いにします。</p>
  <ul>
    <li>メインボーカル: 自動ビブラートON・声量を既定の1.1倍（前に出す）・音圧強化30%・ステレオ幅100%（狭め・中央寄りでクリアに）・EQ低域-3dB（ランブル/こもり除去）・EQ高域+2dB（抜け・プレゼンス）・ディレイ送り15%（語尾に軽いスラップ）・リバーブ送り25%・定位は中央固定</li>
    <li>それ以外のボーカル（ハモリ・コーラス等）: 自動ビブラートOFF・声量を既定の0.85倍を基準に、副ボーカルの本数が多いほどさらに絞る（重なって音圧が積み上がる分を等パワー則で相殺）・音圧強化25%・ステレオ幅120%（広げて「壁」のような厚みを出す）・EQ低域-3dB・EQ高域は無変化（明るくしすぎると前に出てしまうため）・ディレイ送り0%（掛けると輪郭がぼやけて団子になるため）・リバーブ送り45%（奥へ馴染ませる）・定位は左右へ交互に振ってダブリング感を出す</li>
  </ul>
  <p style="margin-top:4px;"><small>「前に出したい音は声量大きめ・狭め・リバーブ少なめ、奥に置きたい音は声量控えめ・広め・リバーブ多め」という定石に基づいています。EQの低域カットはボーカルでほぼ普遍的な定石（実質的なハイパスフィルタの代用）です。ビブラートをハモリ・コーラスへ掛けないのは、複数の声が同時に揺れると声ごとの位相・速さのズレで和音が「うねる」「濁る」ためで、合唱やストリングスのセクション奏法と同じく、ハモリ/コーラスはストレートトーンにして音程の軸を安定させる方が馴染みます。オクターブユニゾン（1オクターブ上/下を重ねて厚みを出す加工）はここでは自動適用しません — 声質を大きく変える演出目的の加工であり、曲によって合う/合わないが分かれる創作上の選択（バラードでは不自然になりやすい等）で、ミックスの是正とは性質が違うためです。使いたい場合は各ボーカルトラックの設定欄から個別に選んでください。「いい感じの初期値」を一括で当てるだけで、曲や好みに応じた微調整までは行いません。既存の設定は上書きされるので、気に入らなければ各スライダーから個別に戻してください。</small></p>
</div>
`;

const MIDI_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. MIDIファイルとは</h4>
  <p>「どの音を・いつ・どのくらいの長さで鳴らすか」を記録した、演奏データのファイル（拡張子 <code>.mid</code> / <code>.midi</code>）です。音そのものではなく楽譜に近いデータなので、読み込んでそのまま編集できます。</p>

  <h4>2. 読み込みのしかた</h4>
  <ul>
    <li>「ファイルを選択」から <code>.mid</code> ファイルを選びます。</li>
    <li>ファイル内のトラック一覧が出るので、取り込みたいトラックを選びます。</li>
    <li>「読込」を押すと反映されます。</li>
  </ul>

  <h4>3. モードによる取り込み方の違い</h4>
  <ul>
    <li><strong>初心者モード</strong>: 各トラックの特徴から、メロディー・サブメロ・ベース・伴奏の4つの役割に自動で振り分けられます。</li>
    <li><strong>上級者モード</strong>: MIDIのトラック構成がそのまま反映されます（1対1）。</li>
  </ul>

  <h4>4. MIDIファイルを手に入れる</h4>
  <p>手元にMIDIが無いときは、「<code>曲名 midi</code>」などで検索すれば、無料で配布しているサイトが見つかります。</p>
  <p style="margin-top:4px;"><small>みんながMIDIを投稿できる投稿型プラットフォーム: <a href="http://picotune.me/" target="_blank" rel="noopener">picotune.me</a>（いろんなジャンルのMIDIを無料ダウンロードできます。サイト上ではチップチューン風に再生されます）</small></p>
  <p style="margin-top:4px;"><small>※検索で見つかる配布サイトは、個人運営のものから権利的にグレーなものまで様々です。そのため、それらへの直接リンクは載せていません。利用の際は配布元や権利関係をご自身でご確認ください。</small></p>

  <h4>5. UST（UTAU）の歌詞を使う</h4>
  <p>UTAUのUSTファイルから歌詞だけを取り出して、歌わせることもできます。</p>
  <ul>
    <li>音符: UTAUなどでUSTをMIDIに書き出し、上の手順で読み込みます。</li>
    <li>歌詞: 下記サイトでUSTから歌詞テキストを抜き出し、MML/歌詞入力欄の <code>@@</code> 構文に貼り付けます。</li>
  </ul>
  <p style="margin-top:4px;"><small>歌詞の抽出: <a href="https://rpgen3.github.io/ust2txt/" target="_blank" rel="noopener">ust2txt</a></small></p>
</div>
`;

const KOE_INFO_HTML = `
<div class="dtm-modal-body-content">
  <h4>1. UTAU音源を .koe に変換する</h4>
  <p>UTAU用の音源（zip）をそのまま使うことはできません。下記の変換サイトで <code>.koe</code> 形式に変換してください。</p>
  <p style="margin-top:4px;"><small>変換サイト: <a href="https://onjmin.github.io/koe/demo/" target="_blank" rel="noopener">koe変換デモ（onjmin.github.io/koe/demo）</a></small></p>

  <h4>2. 変換した .koe をアップロードする</h4>
  <p>変換後の <code>.koe</code> ファイルは、誰でも直接ダウンロードできる形でネット上に置く必要があります（ローカルのファイルパスは使えません）。</p>
  <ul>
    <li><strong>Googleドライブ</strong>: アップロード後、共有設定を「リンクを知っている全員」に変更 → 共有リンクの<code>/d/</code>と<code>/view</code>の間のID（ファイルID）を controlled URL に組み込んで直接リンク化します（例: <code>https://drive.google.com/uc?export=download&id=ファイルID</code>）。</li>
    <li>その他、直接ダウンロードURLを発行できるホスティング（GitHub Pages、Cloudflare R2 など）でも構いません。</li>
  </ul>

  <h4>3. DTMで使う</h4>
  <ul>
    <li>歌唱モデルのプルダウンから「カスタム音声を追加…」を選びます。</li>
    <li>「音声URL」に手順2の直接リンクを貼り付けます。</li>
    <li>アイコン画像URLは任意です（省略可）。識別子はファイル名から自動生成されます。</li>
    <li>「追加」を押すとプルダウンに登録され、以降そのトラックで使えます。</li>
  </ul>
  <p style="margin-top:4px;color:var(--dtm-warn);"><small>※UTAU音源を <code>.koe</code> に変換してネット上に置く行為は、音源データの再加工・再配布にあたります。これが配布元の利用規約に反していないかは必ずご自身で確認し、その責任を負ってください。</small></p>
</div>
`;

const BASE_STEP_WIDTH = 0.5;
const BASE_KEY_HEIGHT = 15;

/** シンプルモード（4トラック）— 役割別に自動分類してMIDIを読み込む */
export const TRACKS_SIMPLE: TrackConfig[] = [
	{
		id: "melody",
		name: "メロディー",
		color: [41, 173, 255],
		instrument: 0,
		volume: 100,
	},
	{
		id: "submelody",
		name: "サブメロ",
		color: [255, 119, 168],
		instrument: 1,
		volume: 95,
	},
	{
		id: "bass",
		name: "ベース",
		color: [0, 228, 54],
		instrument: 2,
		volume: 88,
	},
	{
		id: "chord",
		name: "伴奏",
		color: [255, 163, 0],
		instrument: 3,
		volume: 76,
	},
];

/**
 * advancedモード（15トラック）— MIDIトラックを1:1で扱う。
 * 採番はMML仕様に合わせてフラットな連番（@0〜@14 / TRACK 01〜15、欠番なし）。
 * MIDIの「ch10=ドラム」の慣習は内部モデルに持ち込まず、MIDI入出力の変換時にだけ扱う:
 * 出力は打楽器ch（内部 channel 9）を避けて割り当て（TRACK 10以降は ch11〜16 へ）、
 * 入力は channel 9 のドラムを除外する。ドラム自体は別系統の「ドラム設定」で編集する。
 */
export const TRACKS_ADVANCED: TrackConfig[] = [
	{
		id: "t0",
		name: "トラック1",
		color: [41, 173, 255],
		instrument: 0,
		volume: 100,
	},
	{
		id: "t1",
		name: "トラック2",
		color: [0, 228, 54],
		instrument: 1,
		volume: 100,
	},
	{
		id: "t2",
		name: "トラック3",
		color: [255, 119, 168],
		instrument: 2,
		volume: 100,
	},
	{
		id: "t3",
		name: "トラック4",
		color: [255, 163, 0],
		instrument: 3,
		volume: 100,
	},
	{
		id: "t4",
		name: "トラック5",
		color: [255, 236, 39],
		instrument: 4,
		volume: 100,
	},
	{
		id: "t5",
		name: "トラック6",
		color: [131, 118, 156],
		instrument: 5,
		volume: 100,
	},
	{
		id: "t6",
		name: "トラック7",
		color: [255, 0, 77],
		instrument: 6,
		volume: 100,
	},
	{
		id: "t7",
		name: "トラック8",
		color: [255, 204, 170],
		instrument: 7,
		volume: 100,
	},
	{
		id: "t8",
		name: "トラック9",
		color: [194, 195, 199],
		instrument: 8,
		volume: 100,
	},
	{
		id: "t9",
		name: "トラック10",
		color: [0, 135, 81],
		instrument: 9,
		volume: 100,
	},
	{
		id: "t10",
		name: "トラック11",
		color: [171, 82, 54],
		instrument: 10,
		volume: 100,
	},
	{
		id: "t11",
		name: "トラック12",
		color: [126, 37, 83],
		instrument: 11,
		volume: 100,
	},
	{
		id: "t12",
		name: "トラック13",
		color: [255, 241, 232],
		instrument: 12,
		volume: 100,
	},
	{
		id: "t13",
		name: "トラック14",
		color: [120, 200, 255],
		instrument: 13,
		volume: 100,
	},
	{
		id: "t14",
		name: "トラック15",
		color: [100, 255, 160],
		instrument: 14,
		volume: 100,
	},
];

const DEFAULT_TRACKS = TRACKS_SIMPLE;

/**
 * 内蔵モデルの静的リスト（klatt + koe音源）。
 * カスタムボーカルは mountDAW スコープ内で動的に追加する。
 */
const BASE_LYRIC_MODELS = ["klatt", ...Object.keys(KOE_VOICEBANKS)];

/** 内蔵モデルのカテゴリ定義（プルダウンの optgroup 表示用） */
const LYRIC_MODEL_CATEGORIES = [
	{
		label: "kusaプリセット",
		models: ["klatt", "tsukuyomi"],
	},
	{
		label: "おんJ",
		models: ["roze", "shiyo", "rino", "rino121", "uc"],
	},
	{
		label: "一般",
		models: ["teto", "rei", "ruko_male", "ruko_female"],
	},
	{
		label: "クッキー☆",
		models: ["mgroid", "motroid", "nynroid"],
	},
];

/** 内蔵モデルキーワード → プルダウン表示名 */
const BASE_LYRIC_MODEL_LABELS: Record<string, string> = {
	klatt: "軽量ロボ声",
	...KOE_VOICEBANK_LABELS,
};

/** モデルキーワードのUI表示名を返す（カスタムボーカル辞書を参照し、未登録はキーワードそのまま） */
const lyricModelLabel = (
	model: string,
	customMap: Map<string, CustomVocalDef>,
): string =>
	BASE_LYRIC_MODEL_LABELS[model] ?? customMap.get(model)?.label ?? model;

/**
 * 歌唱モデルプルダウンの「カスタム音声を追加…」選択肢のセンチネル値。
 * `+` はカスタムボーカルのキー文字集合（英数字+アンダースコア）に含まれないため、
 * MML 宣言由来のキーと衝突しない。
 */
const CUSTOM_VOCAL_ADD_VALUE = "+custom";

/** カスタムボーカルの識別子（キー）として許容する形式（MML `@@key` 宣言と同じ規則） */
const CUSTOM_VOCAL_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * 音声URLのファイル名から識別子候補を作る。
 * パーセントエンコーディングをデコードし、拡張子を除去、英数字以外は `_` に置換する。
 * 有効な識別子が作れない場合（デコード後に英数字が残らない等）は空文字を返す。
 */
const deriveCustomVocalKeyFromUrl = (url: string): string => {
	let name: string;
	try {
		const path = new URL(url).pathname;
		name = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
	} catch {
		return "";
	}
	name = name
		.replace(/\.[^.]*$/, "")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (name && /^[0-9]/.test(name)) name = `_${name}`;
	return CUSTOM_VOCAL_KEY_RE.test(name) ? name : "";
};

const clamp = (v: number, min: number, max: number): number =>
	Math.min(Math.max(v, min), max);

/**
 * 楽器名を GM_INSTRUMENT_NAMES の正規名に正規化する。
 * URLエンコーダ（customEncode）がスペースを除去するため、
 * "AcousticGrandPiano" → "Acoustic Grand Piano" のように逆引きして補正する。
 */
const normalizeInstrumentName = (name: string): string => {
	if (!name) return "";
	const stripped = name.replace(/\s+/g, "").toLowerCase();
	return (
		GM_INSTRUMENT_NAMES.find(
			(n) => n.replace(/\s+/g, "").toLowerCase() === stripped,
		) ?? name
	);
};

/** 演奏データから自動推定する役割。プリセット（{@link INSTRUMENT_PRESETS}）のキーと対応させる。 */
type AutoRole = "melody" | "submelody" | "bass" | "chord";

/** ピアノロールのステップ解像度（1拍=48ステップ、他ファイルのSTEPS_PER_BEATと同じ）。 */
const AUTO_ROLE_STEPS_PER_BEAT = 48;

/** 役割ごとの基準音量（ベロシティ、0-127）。TRACKS_SIMPLE の既定値に合わせた「前に出す順」の目安。 */
const AUTO_ROLE_BASE_VOLUME: Record<AutoRole, number> = {
	melody: 100,
	submelody: 92,
	bass: 85,
	chord: 72,
};

/** classifyTrackRole が役割判定と音量計算の両方に使う、ノート列から算出した統計値。 */
type AutoRoleStats = {
	avgPitch: number;
	avgDur: number;
	/** 同一startStepの平均同時発音数（和音の厚み。単音のみなら1）。 */
	avgPoly: number;
	maxPoly: number;
	notesPerBeat: number;
};

const computeAutoRoleStats = (
	notes: Pick<Note, "pitch" | "startStep" | "durationSteps">[],
): AutoRoleStats => {
	const avgPitch = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
	const avgDur = notes.reduce((s, n) => s + n.durationSteps, 0) / notes.length;

	// 同一startStepの同時発音数（和音の厚み）
	const byStart = new Map<number, number>();
	for (const n of notes)
		byStart.set(n.startStep, (byStart.get(n.startStep) ?? 0) + 1);
	let maxPoly = 0;
	for (const c of byStart.values()) if (c > maxPoly) maxPoly = c;
	const avgPoly = notes.length / byStart.size;

	// 単位時間あたりの音数（密度）。低いほど「動きの少ない」パート。
	const minStart = Math.min(...notes.map((n) => n.startStep));
	const maxEnd = Math.max(...notes.map((n) => n.startStep + n.durationSteps));
	const spanBeats = Math.max(1, (maxEnd - minStart) / AUTO_ROLE_STEPS_PER_BEAT);
	const notesPerBeat = notes.length / spanBeats;

	return { avgPitch, avgDur, avgPoly, maxPoly, notesPerBeat };
};

/**
 * ノート列（ピッチ・タイミング）から、このトラックの役割（メロディ/サブメロ/ベース/伴奏）を推定する。
 * 「おまかせ」で楽器・音量を自動選択するための判定ロジック。ノートが無いトラックは呼び出し側でスキップする。
 *
 * 判定基準（音楽的な経験則）:
 * - 平均音高が低い（C3未満）→ ベース
 * - 同時発音（和音）が多く、音価も長め → 伴奏（コード/パッド）
 * - 単音で音数が少なく音価が長い → サブメロ（オブリガート寄り）
 * - それ以外（単音で音数が多い・音高が高め）→ メロディ
 */
const classifyTrackRole = (stats: AutoRoleStats): AutoRole => {
	if (stats.avgPitch < 48) return "bass"; // C3未満 = 低音域
	if (stats.maxPoly >= 2 && stats.avgDur >= AUTO_ROLE_STEPS_PER_BEAT)
		return "chord";
	if (
		stats.notesPerBeat < 1.2 &&
		stats.avgDur >= AUTO_ROLE_STEPS_PER_BEAT * 1.5
	)
		return "submelody";
	return "melody";
};

/**
 * 役割の基準音量を、実際のノートの傾向に応じて微調整する（一般的なDTM/ミキシングの経験則）。
 *
 * - 和音（伴奏）は音を重ねるほど合成音圧が積み上がる。等パワー則（n音重ねると理論上√n倍）を
 *   控えめに適用し、和音の厚み（平均同時発音数）に応じて下げる。厚いパッドほど1音あたりは
 *   絞ったほうが、メロディを邪魔せず全体の音圧バランスが取れる。
 * - ベースは低域ほど等ラウドネス曲線（Fletcher-Munson）の影響で同じ音量でも聴感上小さく
 *   感じるため、音高が低いぶんだけ少し持ち上げて曲の土台としての存在感を保つ。
 */
const computeAutoRoleVolume = (
	role: AutoRole,
	stats: AutoRoleStats,
): number => {
	let vol = AUTO_ROLE_BASE_VOLUME[role];
	if (role === "chord" && stats.avgPoly > 1) {
		vol /= Math.sqrt(stats.avgPoly);
	} else if (role === "bass") {
		const depthSemitones = Math.max(0, 48 - stats.avgPitch); // C3からどれだけ低いか
		vol += Math.min(12, depthSemitones * 0.5);
	}
	return clamp(Math.round(vol), 1, 127);
};

/**
 * 役割ごとのチャンネルストリップ既定値（音圧強化・ステレオ幅・リバーブ送り・EQ低域/高域）。
 * いずれも一般的なミキシングの定石に基づく:
 *
 * - ベースはステレオ幅を広げない（低域を広げると位相干渉でモノラル再生時に痩せる・
 *   輪郭がぼやけるため「低域はモノラルに寄せる」が定石）。リバーブも掛けすぎると
 *   低域が濁る（マッド）ため控えめ。他パートより強めに圧縮し粒立ちを揃え、
 *   EQは低域を軽く持ち上げ・不要な高域を削ってスッキリさせる。
 * - 伴奏（コード/パッド）は空間を埋める役割なのでステレオ幅・リバーブを最も広く/多くする。
 *   反面、他パートの邪魔をしないよう圧縮は控えめ（自然な強弱を残す）にし、
 *   低域はベースの帯域を空けるためにEQで削る（帯域の住み分け＝周波数のすみ分け）。
 * - メロディ/サブメロは前に出したいぶんリバーブを控えめにし、EQの高域を少し持ち上げて
 *   抜け・明瞭感（プレゼンス）を足す。低域は少し削ってベースとぶつからないようにする。
 *   サブメロはメロディの一歩後ろに位置づけるため、圧縮を少し弱め・リバーブを少し多めにする。
 * - ディレイ送りは「低域には掛けない」が定石（繰り返しが重なってリズムが濁るため）。
 *   ベース・伴奏は0のままにし、聞かせどころになりやすいメロディ・サブメロにだけ薄く送る
 *   （マスタディレイ自体が既定0=オフのため、ユーザーがディレイを有効にしたときだけ効く）。
 */
const AUTO_ROLE_MIX: Record<
	AutoRole,
	{
		compression: number;
		width: number;
		reverbSend: number;
		delaySend: number;
		eqLow: number;
		eqHigh: number;
	}
> = {
	melody: {
		compression: 35,
		width: 115,
		reverbSend: 12,
		delaySend: 15,
		eqLow: -2,
		eqHigh: 2,
	},
	submelody: {
		compression: 32,
		width: 115,
		reverbSend: 15,
		delaySend: 8,
		eqLow: -3,
		eqHigh: 1,
	},
	chord: {
		compression: 25,
		width: 118,
		reverbSend: 22,
		delaySend: 0,
		eqLow: -4,
		eqHigh: 0,
	},
	bass: {
		compression: 40,
		width: 100,
		reverbSend: 5,
		delaySend: 0,
		eqLow: 2,
		eqHigh: -3,
	},
};

type TrackState = {
	config: TrackConfig;
	core: MMLCore;
	volume: number;
	savedChordInput: string;
	savedChordPattern: ChordPatternType;
	savedChordRoot: number;
	/** 歌詞（生のかな入力。空なら歌わない） */
	lyrics: string;
	/** 歌唱合成モデル名（既定 "klatt"） */
	lyricModel: string;
	/** 歌唱の声量 0-400（100=等倍、100超でブースト＝dB対数）。ノートvelocityとは独立した合成音声専用パラメータ。既定 {@link DEFAULT_VOCAL_VOLUME} */
	vocalVolume: number;
	/** 歌唱のゲートタイム 0-100（音価に対する発音長の割合）。既定100（レガート） */
	vocalGate: number;
	/** 歌唱のステレオ定位 0-127（0=左, 64=中央, 127=右）。既定64（中央） */
	vocalPan: number;
	/** 歌唱のオクターブシフト -2〜+2（音源の得意音域に合わせてピッチを上下）。既定0 */
	vocalOctave: number;
	/** 自動ビブラート ON/OFF。ONでも一定長以上のロングトーンにだけ適用される。既定false */
	vocalVibrato: boolean;
	/** このトラックのマスタリバーブへのセンド量 0-100。既定0（掛からない） */
	vocalReverb: number;
	/** このトラックのマスタディレイへのセンド量 0-100。既定0（掛からない） */
	vocalDelay: number;
	/** フォルマント/ジェンダーファクター 0-100。既定50（無変化）。koe音源限定 */
	vocalGender: number;
	/** ブレシネス（息成分）0-100。既定50（無変化）。koe音源限定 */
	vocalBreathiness: number;
	/** テンション（張り/力強さ）0-100。既定50（無変化）。koe音源限定 */
	vocalTension: number;
	/**
	 * オクターブユニゾン。もう1声、1オクターブ上/下/両方（控えめな音量）で重ねて発音する。
	 * 既定"none"（重ねない）。
	 */
	vocalOctaveUnison: OctaveUnisonMode;
	/** トラック個別の楽器名（GM楽器名）。空文字でプリセット適用 */
	trackInstrument: string;
	/**
	 * このトラックのコンプレッサー（音圧強化）量 0-100。既定0（無圧縮）。
	 * ボーカル・楽器を問わずトラック全体に掛かる（歌詞トラック固有のvocalGender等とは別軸）。
	 */
	trackCompression: number;
	/** このトラックのステレオ幅 0-200。既定100（原音のまま）。 */
	trackWidth: number;
	/**
	 * このトラックのマスタリバーブへのセンド量 0-100。既定0（掛からない）。
	 * ボーカル・楽器を問わずトラック全体に掛かる（歌詞トラック固有の vocalReverb とは別軸で、
	 * 両方とも同じマスタリバーブへ加算的に送られる）。
	 */
	trackReverbSend: number;
	/** このトラックのEQ低域（シェルフ）ゲイン -12〜+12dB。既定0（無変化）。 */
	trackEqLow: number;
	/** このトラックのEQ中域（ピーキング）ゲイン -12〜+12dB。既定0（無変化）。 */
	trackEqMid: number;
	/** このトラックのEQ高域（シェルフ）ゲイン -12〜+12dB。既定0（無変化）。 */
	trackEqHigh: number;
	/**
	 * このトラック自体のステレオ定位 0-127（0=左, 64=中央, 127=右）。既定64（中央）。
	 * 歌詞トラック固有の vocalPan（歌唱の定位）とは別軸で、楽器トラックにも掛かる。
	 */
	trackPan: number;
	/**
	 * このトラックのマスタディレイへのセンド量 0-100。既定0（掛からない）。
	 * ボーカル・楽器を問わずトラック全体に掛かる（歌詞トラック固有の vocalDelay とは別軸で、
	 * 両方とも同じマスタディレイへ加算的に送られる）。
	 */
	trackDelaySend: number;
};

/**
 * DAWコンポーネントをマウントする。
 */
export const mountDAW = (
	target: HTMLElement,
	options: DawOptions = {},
): DawInstance => {
	injectStyles();

	const getAudioTime = options.getAudioTime ?? (() => performance.now() / 1000);
	const trackConfigs = options.tracks ?? DEFAULT_TRACKS;
	// モードは明示指定が最優先。未指定なら後方互換でトラック数から推論する。
	// 以降の simple/advanced 分岐はすべてこの mode / isAdvanced を経由させ、
	// 「トラック数」や id "chord" といった暗黙シグナルへの相乗りをなくす。
	const mode: DawMode =
		options.mode ??
		(trackConfigs.length > TRACKS_SIMPLE.length ? "advanced" : "simple");
	const isAdvanced = mode === "advanced";
	const userPatterns = normalizeDrumPatterns(options.drumPatterns ?? {});

	const drumPatterns = {
		...DRUM_PATTERNS,
		...SONG_DRUM_PATTERNS,
		...userPatterns,
	};
	const showMidi = !!options.parseMidi;
	const showChord = !isAdvanced;
	const midiSearchClient = options.midiSearch
		? new MidiSearchClient(options.midiSearch)
		: undefined;
	const showMidiSearch = !!midiSearchClient?.enabled;

	const refs = buildUI(target, {
		tracks: trackConfigs,
		drumPatterns: Object.entries(drumPatterns).map(([key, def]) => ({
			value: key,
			label: def.label,
		})),
		defaultDrumPattern: drumPatterns.dance
			? "dance"
			: (Object.keys(drumPatterns)[0] ?? "none"),
		defaultBpm: options.defaultBpm ?? DEFAULT_BPM,
		showMidi,
		showChord,
		showMidiSearch,
	});
	refs.masterVolume.value = String(options.masterVolume ?? 50);
	refs.masterVolumeLabel.textContent = `${options.masterVolume ?? 50}%`;
	refs.masterComp.value = String(options.masterCompression ?? 0);
	refs.masterCompLabel.textContent = `${options.masterCompression ?? 0}%`;
	refs.reverbAmount.value = String(options.reverbAmount ?? 0);
	refs.reverbAmountLabel.textContent = `${options.reverbAmount ?? 0}%`;
	{
		const initDecay = options.reverbDecay ?? DEFAULT_REVERB_DECAY_SEC;
		const initPreDelay = options.reverbPreDelay ?? DEFAULT_REVERB_PREDELAY_MS;
		refs.reverbDecay.value = String(Math.round(initDecay * 10));
		refs.reverbDecayLabel.textContent = `${initDecay.toFixed(1)}s`;
		refs.reverbPreDelay.value = String(initPreDelay);
		refs.reverbPreDelayLabel.textContent = `${initPreDelay}ms`;
	}
	refs.delayAmount.value = String(options.delayAmount ?? 0);
	refs.delayAmountLabel.textContent = `${options.delayAmount ?? 0}%`;
	refs.delayDivision.value = options.delayDivision ?? "8";
	refs.fadeIn.value = String(options.fadeInSec ?? 0);
	refs.fadeInLabel.textContent = `${(options.fadeInSec ?? 0).toFixed(1)}s`;
	refs.fadeOut.value = String(options.fadeOutSec ?? 0);
	refs.fadeOutLabel.textContent = `${(options.fadeOutSec ?? 0).toFixed(1)}s`;
	refs.drumVolume.value = String(options.drumVolume ?? 80);
	refs.drumVolumeLabel.textContent = `${options.drumVolume ?? 80}%`;

	// --- 描画設定 ---
	const renderConfig: RenderConfig = {
		stepsPerBar: 192,
		keyCount: 128,
		pitchRangeStart: 0,
		keyHeight: BASE_KEY_HEIGHT,
		stepWidth: BASE_STEP_WIDTH * 2, // zoom100% 相当
	};

	// --- 状態 ---
	let zoomX = 100;
	let zoomY = 100;
	let bpm = options.defaultBpm ?? DEFAULT_BPM;
	let masterVolume = options.masterVolume ?? 50;
	options.singingVoices?.setVolume(masterVolume / 100);
	let reverbAmount = options.reverbAmount ?? 0;
	let reverbDecay = options.reverbDecay ?? DEFAULT_REVERB_DECAY_SEC;
	let reverbPreDelay = options.reverbPreDelay ?? DEFAULT_REVERB_PREDELAY_MS;
	let delayAmount = options.delayAmount ?? 0;
	let delayDivision: DelayDivision = options.delayDivision ?? "8";
	let masterCompression = options.masterCompression ?? 0;
	let fadeInSec = options.fadeInSec ?? 0;
	let fadeOutSec = options.fadeOutSec ?? 0;
	// 音割れ検知バッジの購読解除（wireEvents内で購読、destroyで解除するため外側で保持）
	let unsubscribeClip: (() => void) | undefined;
	// 実測ゲインステージング用の裏収集: 再生中だけ options.clipMeter のピークレベルを
	// 継続サンプリングし、観測された最大ピークと実再生時間を溜めておく。ノートの静的な
	// 音量情報だけでは「実際にどれだけ音圧が積み上がって鳴っているか」（複数トラックの
	// 重なり・圧縮後の値等）は分からないため、「おまかせ」実行時にこの実測データが
	// 十分溜まっていれば、それを元にマスタ音量（ゲインステージング）を自動調整する。
	let observedPeakMax = 0;
	let observedPlayMs = 0;
	let peakSampleRafId: number | null = null;
	let peakSampleLastTs = 0;
	/** これ未満の累計再生時間では実測データとして信頼しない（数音だけで判断しないため）。 */
	const PEAK_SAMPLE_MIN_PLAY_MS = 2000;
	const samplePeakTick = (ts: number): void => {
		if (peakSampleLastTs) observedPlayMs += ts - peakSampleLastTs;
		peakSampleLastTs = ts;
		const peak = options.clipMeter?.getPeakLevel() ?? 0;
		if (peak > observedPeakMax) observedPeakMax = peak;
		peakSampleRafId = requestAnimationFrame(samplePeakTick);
	};
	const startPeakSampling = (): void => {
		if (peakSampleRafId !== null || !options.clipMeter) return;
		peakSampleLastTs = 0;
		peakSampleRafId = requestAnimationFrame(samplePeakTick);
	};
	const stopPeakSampling = (): void => {
		if (peakSampleRafId !== null) cancelAnimationFrame(peakSampleRafId);
		peakSampleRafId = null;
		peakSampleLastTs = 0;
	};
	options.onReverbChange?.(reverbAmount);
	options.onReverbDecayChange?.(reverbDecay);
	options.onReverbPreDelayChange?.(reverbPreDelay);
	options.onDelayChange?.(delayAmount);
	options.onDelayDivisionChange?.(delayDivision);
	options.onMasterCompressionChange?.(masterCompression);
	let drumVolume = options.drumVolume ?? 80;
	let currentDrumPattern = refs.drumSelect.value;
	let currentDrumFont = options.drumFont ?? "FluidR3_GM_sf2_file:0";
	refs.drumFontSelect.value = currentDrumFont;
	// MML出力の先頭に埋め込む楽器プリセット名（トップレベル宣言。空なら宣言なし）
	let currentInstrument = "";
	let activeTrackId = options.initialActiveTrack ?? trackConfigs[0].id;
	// トラック切り替えでパネルを再構築しても開閉状態を維持するための「詳細設定」開閉フラグ
	let trackFxAdvancedOpen = false;
	let lyricAdvancedOpen = false;
	let activeToolMode: ToolMode = "pen";
	let currentInsertLength = 48;
	let snapGridSteps = 12;
	const gridLineSteps = 48;
	let currentOffsetX = 0;
	const _initPitch = options.initialScrollPitch ?? 48;
	let currentOffsetY =
		(renderConfig.keyCount - 1 - _initPitch) * renderConfig.keyHeight - 215;
	let playStartStep = 0;
	let isSolo = false;
	// loadMML で取り込んだ歌詞トラック（@@n）の同期コンダクタ。歌詞が無ければ空
	// 歌声ストリーミングが担当するトラックの添字集合（play時に確定）。
	// onPlayNote はここに含まれるトラックの楽器音を鳴らさない。
	let lyricTrackIndices = new Set<number>();
	let playbackState: PlaybackState = "stopped";
	let pausedPlayStep = 0;
	let currentPlayStep = 0;
	// トラックピル（タブ）DOM。再生中に発音の瞬間だけ点灯させるため trackId で引けるようにする。
	const trackPillEls = new Map<string, HTMLButtonElement>();
	// 発音タイミングに合わせて点灯・消灯を予約するタイマー。停止/一時停止/シークで全部キャンセルする。
	let soundTimers: ReturnType<typeof setTimeout>[] = [];
	const clearSoundTimers = (): void => {
		for (const t of soundTimers) clearTimeout(t);
		soundTimers = [];
		for (const el of trackPillEls.values())
			el.classList.remove("dtm-pill--sounding");
	};
	/** 発音予定時刻（e.when秒後）に合わせてタブを短く点灯させる。 */
	const flashTrackPill = (
		trackId: string,
		when: number,
		duration: number,
	): void => {
		const el = trackPillEls.get(trackId);
		if (!el) return;
		const litMs = Math.min(Math.max(duration * 1000, 60), 400);
		soundTimers.push(
			setTimeout(
				() => el.classList.add("dtm-pill--sounding"),
				Math.max(0, when * 1000),
			),
		);
		soundTimers.push(
			setTimeout(
				() => el.classList.remove("dtm-pill--sounding"),
				Math.max(0, when * 1000) + litMs,
			),
		);
	};
	// 初期化完了フラグ（MMLCore構築時の早期コールバックを抑止）
	let ready = false;
	let isLoading = false;

	/**
	 * カスタムボーカル辞書（key → CustomVocalDef）。
	 * DawOptions.customVocals で静的初期化し、loadMML で MML 宣言行が上書きする。
	 * UI（カスタム音声を追加…）からも登録される。
	 */
	const customVocalsMap = new Map<string, CustomVocalDef>();
	/** 辞書へ登録する（キーは小文字化。内蔵モデル名との衝突は無視して乗っ取りを防ぐ） */
	const registerCustomVocal = (def: CustomVocalDef): void => {
		const key = def.key.toLowerCase();
		if (BASE_LYRIC_MODELS.includes(key)) return;
		customVocalsMap.set(key, { ...def, key });
	};
	/** 辞書を DawOptions.customVocals の静的登録だけの状態へ戻す（loadMML の先頭で使う） */
	const resetCustomVocals = (): void => {
		customVocalsMap.clear();
		for (const d of options.customVocals ?? []) registerCustomVocal(d);
	};
	resetCustomVocals();
	/** UI追加用の空きキー（custom1, custom2, …）を採番する */
	const genCustomVocalKey = (): string => {
		let n = 1;
		while (customVocalsMap.has(`custom${n}`)) n++;
		return `custom${n}`;
	};

	// 選択・コピー
	let selectedNotes: Note[] = [];
	let selectionRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null = null;
	let copiedNotes: Note[] = [];

	// MMLCore は renderer.init() による g_config 設定後に生成する（generateMML が依存）。
	let trackStates: TrackState[] = [];
	// applyPatch 実行中は onNotesPatch を発火しない（エコーループ防止）。
	let suppressPatch = false;
	// onLyricsChange デバウンス用タイマー。
	let lyricsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	const fireLyricsChange = (t: TrackState): void => {
		if (!options.onLyricsChange) return;
		const trackId = t.config.id;
		const data: import("./types").LyricSyncData = {
			lyrics: t.lyrics,
			model: t.lyricModel,
			vocalVolume: t.vocalVolume,
			vocalGate: t.vocalGate,
			vocalPan: t.vocalPan,
			vocalOctave: t.vocalOctave,
			vocalVibrato: t.vocalVibrato,
			vocalReverb: t.vocalReverb,
			vocalDelay: t.vocalDelay,
			vocalGender: t.vocalGender,
			vocalBreathiness: t.vocalBreathiness,
			vocalTension: t.vocalTension,
			vocalOctaveUnison: t.vocalOctaveUnison,
		};
		if (lyricsDebounceTimer) clearTimeout(lyricsDebounceTimer);
		lyricsDebounceTimer = setTimeout(() => {
			options.onLyricsChange?.(trackId, data);
			lyricsDebounceTimer = null;
		}, 300);
	};
	// 目ミュート中のトラックID集合。
	const hiddenTracks = new Set<string>();
	// 音ミュート中のトラックID集合。
	const audioMutedTracks = new Set<string>();

	const createTrackStates = (): void => {
		trackStates = trackConfigs.map((config) => {
			let prevNotes: import("./types").Note[] = [];
			return {
				config,
				core: new MMLCore(
					{
						onMMLGenerated: () => {},
						onNotesChanged: (notes) => {
							if (!ready) return;
							if (!suppressPatch && options.onNotesPatch) {
								const prevByKey = new Map(
									prevNotes.map((n) => [`${n.startStep}_${n.pitch}`, n]),
								);
								const currByKey = new Map(
									notes.map((n) => [`${n.startStep}_${n.pitch}`, n]),
								);
								// added は「新規ノート」に加え「同一キー(startStep,pitch)のまま
								// durationSteps/velocity が変化したノート」も含める（リサイズ/ベロシティ同期）。
								// 受信側 applyPatch は同一キーがあれば upsert（上書き）する。
								const added = notes
									.filter((n) => {
										const prev = prevByKey.get(`${n.startStep}_${n.pitch}`);
										return (
											!prev ||
											prev.durationSteps !== n.durationSteps ||
											prev.velocity !== n.velocity
										);
									})
									.map((n) => ({
										startStep: n.startStep,
										pitch: n.pitch,
										durationSteps: n.durationSteps,
										velocity: n.velocity,
									}));
								const removed = prevNotes
									.filter((n) => !currByKey.has(`${n.startStep}_${n.pitch}`))
									.map((n) => ({ startStep: n.startStep, pitch: n.pitch }));
								if (added.length > 0 || removed.length > 0) {
									options.onNotesPatch(config.id, added, removed);
								}
							}
							// moveNote/resizeNote はノートオブジェクトをその場で書き換えるため、
							// 参照のシャローコピーだと次回差分時に旧状態が失われる。
							// 値コピーでスナップショットして移動・リサイズを確実に検出する。
							prevNotes = notes.map((n) => ({ ...n }));
							redrawAll();
							updateUndoRedo();
						},
					},
					config.volume,
				),
				volume: config.volume,
				savedChordInput: "",
				savedChordPattern: "block",
				savedChordRoot: 0,
				lyrics: "",
				lyricModel: "", // 既定は「なし」（歌わない）
				vocalVolume: DEFAULT_VOCAL_VOLUME,
				vocalGate: 100,
				vocalPan: 64,
				vocalOctave: 0,
				vocalVibrato: false,
				vocalReverb: 0,
				vocalDelay: 0,
				vocalGender: 50,
				vocalBreathiness: 50,
				vocalTension: 50,
				vocalOctaveUnison: "none",
				trackInstrument: "",
				trackCompression: 0,
				trackWidth: 100,
				trackReverbSend: 0,
				trackEqLow: 0,
				trackEqMid: 0,
				trackEqHigh: 0,
				trackPan: 64,
				trackDelaySend: 0,
			};
		});
	};

	// 各トラックの歌詞入力から歌詞トラック辞書を構築する（@@n の n = トラックの並び順）
	const buildLyricsMap = (): Map<number, LyricTrack> => {
		const map = new Map<number, LyricTrack>();
		trackStates.forEach((t, i) => {
			const model = t.lyricModel.trim();
			const text = t.lyrics.trim();
			if (!model || !text) return; // モデル「なし」または歌詞空なら歌わない
			const syllables = normalizeLyrics(text);
			if (syllables.length === 0) return;
			map.set(i, {
				trackId: i,
				model: model.toLowerCase(),
				volume: t.vocalVolume,
				gate: t.vocalGate,
				pan: t.vocalPan,
				octave: t.vocalOctave,
				vibrato: t.vocalVibrato,
				reverb: t.vocalReverb,
				delay: t.vocalDelay,
				gender: t.vocalGender,
				breathiness: t.vocalBreathiness,
				tension: t.vocalTension,
				octaveUnison: t.vocalOctaveUnison,
				syllables,
			});
		});
		return map;
	};

	const getActive = (): TrackState =>
		trackStates.find((t) => t.config.id === activeTrackId) ?? trackStates[0];

	let showModal: (title: string, bodyHTML: string) => void;

	// ============================================================
	// 描画
	// ============================================================
	/** 全トラックを通した最後のノートの終端ステップ（余白なし）。フェードアウトの終端計算に使う。 */
	const getSongEndStepExact = (): number => {
		let maxEndStep = 0;
		for (const t of trackStates) {
			for (const n of t.core.getNotes()) {
				const end = n.startStep + n.durationSteps;
				if (end > maxEndStep) maxEndStep = end;
			}
		}
		return maxEndStep;
	};

	const getMaxNoteStep = (): number => {
		const maxEndStep = getSongEndStepExact();
		if (maxEndStep === 0) {
			return renderConfig.stepsPerBar * 4;
		}
		const lastNoteMeasure = Math.floor(
			(maxEndStep - 1) / renderConfig.stepsPerBar,
		);
		return (lastNoteMeasure + 2) * renderConfig.stepsPerBar;
	};

	const getMaxOffsetX = (): number => {
		const canvas = getGridCanvas();
		const maxNoteStep = getMaxNoteStep();
		const totalContentWidth = maxNoteStep * renderConfig.stepWidth;
		return Math.max(0, totalContentWidth - canvas.width);
	};

	const getMaxOffsetY = (): number => {
		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		return Math.max(0, totalHeight - getGridCanvas().height);
	};

	const drawStartLine = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = playStartStep * renderConfig.stepWidth - currentOffsetX;
		if (x < -10 || x > canvas.width + 10) return;
		ctx.save();
		ctx.strokeStyle = "#ffec27";
		ctx.lineWidth = 2;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const drawPlayhead = (): void => {
		const ctx = getGridContext();
		const canvas = getGridCanvas();
		if (!ctx) return;
		const x = currentPlayStep * renderConfig.stepWidth - currentOffsetX;
		if (x < 0 || x > canvas.width) return;
		ctx.save();
		ctx.strokeStyle = "#ff004d";
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvas.height);
		ctx.stroke();
		ctx.restore();
	};

	const redrawAll = (): void => {
		drawGrid(gridLineSteps);
		for (const t of trackStates) {
			if (hiddenTracks.has(t.config.id)) continue;
			if (isSolo && t.config.id !== activeTrackId) continue;
			const [r, g, b] = t.config.color;
			const a = t.config.id === activeTrackId ? 1 : 0.3;
			drawNotes(t.core.getNotes(), [r, g, b, a]);
		}
		if (activeToolMode === "select" && selectionRect) {
			const ctx = getGridContext();
			ctx.save();
			ctx.strokeStyle = "#ffec27";
			ctx.lineWidth = 2;
			ctx.setLineDash([4, 4]);
			ctx.strokeRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.fillStyle = "rgba(255,236,39,0.08)";
			ctx.fillRect(
				selectionRect.x,
				selectionRect.y,
				selectionRect.width,
				selectionRect.height,
			);
			ctx.restore();
		}
		if (activeToolMode === "select" && selectedNotes.length > 0) {
			const ids = new Set(selectedNotes.map((n) => n.id));
			const active = getActive();
			drawSelectedNotes(active.core.getNotes(), ids, [
				...active.config.color,
				1,
			]);
		}
		drawStartLine();
		if (playbackState === "playing") drawPlayhead();
		updateScrollbars();
	};

	// ============================================================
	// スクロールバー
	// ============================================================
	const updateScrollbars = (): void => {
		const canvas = getGridCanvas();
		const maxOffsetX = getMaxOffsetX();
		const sbW = refs.hScroll.clientWidth;
		if (maxOffsetX <= 0) {
			refs.hScrollThumb.style.width = "100%";
			refs.hScrollThumb.style.left = "0";
		} else {
			const totalContentWidth = getMaxNoteStep() * renderConfig.stepWidth;
			const thumbW = Math.max(40, (canvas.width / totalContentWidth) * sbW);
			const ratio = currentOffsetX / maxOffsetX;
			refs.hScrollThumb.style.width = `${thumbW}px`;
			refs.hScrollThumb.style.left = `${clamp(ratio * (sbW - thumbW), 0, sbW - thumbW)}px`;
		}

		const totalHeight = renderConfig.keyCount * renderConfig.keyHeight;
		const sbH = refs.vScroll.clientHeight;
		if (totalHeight <= canvas.height) {
			refs.vScrollThumb.style.height = "100%";
			refs.vScrollThumb.style.top = "0";
		} else {
			const thumbH = Math.max(40, (canvas.height / totalHeight) * sbH);
			const maxOffset = getMaxOffsetY();
			const ratio = currentOffsetY / maxOffset;
			refs.vScrollThumb.style.height = `${thumbH}px`;
			refs.vScrollThumb.style.top = `${ratio * (sbH - thumbH)}px`;
		}
	};

	const initScrollbarDrag = (): void => {
		let draggingH = false;
		let draggingV = false;
		let hScrollWasPlaying = false;
		const finishHScroll = (): void => {
			if (!draggingH) return;
			draggingH = false;
			if (hScrollWasPlaying) {
				hScrollWasPlaying = false;
				const snappedStep = Math.max(
					0,
					Math.floor(currentOffsetX / renderConfig.stepWidth / snapGridSteps) *
						snapGridSteps,
				);
				// playStartStep は変えず、一時停止位置だけ更新して再開
				pausedPlayStep = snappedStep;
				currentPlayStep = snappedStep;
				void play();
			}
		};
		refs.hScroll.addEventListener("pointerdown", (e) => {
			draggingH = true;
			hScrollWasPlaying = playbackState === "playing";
			if (hScrollWasPlaying) pause();
			e.preventDefault();
			refs.hScroll.setPointerCapture(e.pointerId);
			moveH(e.clientX);
		});
		refs.vScroll.addEventListener("pointerdown", (e) => {
			draggingV = true;
			e.preventDefault();
			refs.vScroll.setPointerCapture(e.pointerId);
			moveV(e.clientY);
		});
		refs.hScroll.addEventListener("pointermove", (e) => {
			if (draggingH) moveH(e.clientX);
		});
		refs.vScroll.addEventListener("pointermove", (e) => {
			if (draggingV) moveV(e.clientY);
		});
		refs.hScroll.addEventListener("pointerup", finishHScroll);
		refs.vScroll.addEventListener("pointerup", () => {
			draggingV = false;
		});
		document.addEventListener("pointermove", (e) => {
			if (draggingH) moveH(e.clientX);
			if (draggingV) moveV(e.clientY);
		});
		document.addEventListener("pointerup", () => {
			finishHScroll();
			draggingV = false;
		});

		const moveH = (clientX: number): void => {
			const maxOffsetX = getMaxOffsetX();
			if (maxOffsetX <= 0) return;
			const rect = refs.hScroll.getBoundingClientRect();
			const thumbW = Number.parseFloat(refs.hScrollThumb.style.width) || 40;
			const x = clamp(clientX - rect.left - thumbW / 2, 0, rect.width - thumbW);
			const ratio = x / (rect.width - thumbW);
			currentOffsetX = clamp(ratio * maxOffsetX, 0, maxOffsetX);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
		const moveV = (clientY: number): void => {
			const maxOffset = getMaxOffsetY();
			if (maxOffset <= 0) return;
			const rect = refs.vScroll.getBoundingClientRect();
			const thumbH = Number.parseFloat(refs.vScrollThumb.style.height) || 40;
			const y = clamp(clientY - rect.top - thumbH / 2, 0, rect.height - thumbH);
			const ratio = y / (rect.height - thumbH);
			currentOffsetY = clamp(ratio * maxOffset, 0, maxOffset);
			setDrawOffset(currentOffsetX, currentOffsetY);
			redrawAll();
		};
	};

	// ============================================================
	// グリッド操作（ペン/選択/消しゴム）
	// ============================================================
	const resizeHandleWidth = 10;
	const TOUCH_HIT_MARGIN = 6;
	let suppressClick = false;
	let hasDragged = false;
	let dragState: null | {
		noteId: number;
		mode: "move" | "resize";
		dragOffsetStep: number;
		dragOffsetPitch: number;
		startStep: number;
		durationSteps: number;
		lastPreviewPitch: number;
	} = null;
	// 選択モードのドラッグ
	let isSelecting = false;
	let dragMode: "rect" | "move" = "rect";
	let selectionStart: {
		x: number;
		y: number;
		step: number;
		pitch: number;
	} | null = null;
	let selectedOriginal: { id: number; startStep: number; pitch: number }[] = [];
	let lastMultiPreviewPitch: number | null = null;

	// 範囲選択/ドラッグ中に画面外へ出た場合の自動スクロール
	const AUTO_SCROLL_MARGIN = 30; // 端からこの距離(px)以内でスクロール開始
	const AUTO_SCROLL_MAX_SPEED = 22; // 1フレームあたりの最大スクロール量(px)
	let autoScrollRAF: number | null = null;
	let lastMoveEvent: PointerEvent | null = null;

	const computeEdgeSpeed = (pos: number, size: number): number => {
		if (pos < AUTO_SCROLL_MARGIN) {
			const t = (AUTO_SCROLL_MARGIN - pos) / AUTO_SCROLL_MARGIN;
			return -Math.ceil(t * AUTO_SCROLL_MAX_SPEED);
		}
		if (pos > size - AUTO_SCROLL_MARGIN) {
			const t = (pos - (size - AUTO_SCROLL_MARGIN)) / AUTO_SCROLL_MARGIN;
			return Math.ceil(t * AUTO_SCROLL_MAX_SPEED);
		}
		return 0;
	};

	const stopAutoScroll = (): void => {
		if (autoScrollRAF !== null) {
			cancelAnimationFrame(autoScrollRAF);
			autoScrollRAF = null;
		}
		lastMoveEvent = null;
	};

	const autoScrollTick = (): void => {
		autoScrollRAF = null;
		if (!isSelecting || !lastMoveEvent) return;
		const canvas = getGridCanvas();
		const { x, y } = getGridPosition(lastMoveEvent);
		const dx = computeEdgeSpeed(x, canvas.width);
		const dy = computeEdgeSpeed(y, canvas.height);
		if (dx !== 0 || dy !== 0) {
			const maxOffsetX = getMaxOffsetX();
			const maxOffsetY = getMaxOffsetY();
			currentOffsetX = clamp(currentOffsetX + dx, 0, maxOffsetX);
			currentOffsetY = clamp(currentOffsetY + dy, 0, maxOffsetY);
			setDrawOffset(currentOffsetX, currentOffsetY);
			onPointerMove(lastMoveEvent);
		}
		if (isSelecting) {
			autoScrollRAF = requestAnimationFrame(autoScrollTick);
		}
	};

	const ensureAutoScroll = (event: PointerEvent): void => {
		lastMoveEvent = event;
		if (autoScrollRAF === null) {
			autoScrollRAF = requestAnimationFrame(autoScrollTick);
		}
	};

	const playPreview = (pitch: number): void => {
		if (isLoading) return;
		options.onResumeAudio?.();
		const active = getActive();
		dispatchNote(active.config.id, pitch, active.volume, 100, 0, 0.5);
	};

	const findActiveNoteAt = (x: number, y: number, margin = 0): Note | null => {
		const active = getActive();
		const { stepWidth, keyHeight, keyCount, pitchRangeStart } = renderConfig;
		const offset = getDrawOffset();
		for (const note of active.core.getNotes()) {
			const logicalX = note.startStep * stepWidth;
			const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
			const logicalY = yIndex * keyHeight;
			const w = note.durationSteps * stepWidth;
			const renderX = logicalX - offset.x;
			const renderY = logicalY - offset.y;
			if (
				x >= renderX - margin &&
				x <= renderX + w + margin &&
				y >= renderY - margin &&
				y <= renderY + keyHeight + margin
			)
				return note;
		}
		return null;
	};

	const hasNoteAt = (
		step: number,
		pitch: number,
		excludeId: number,
	): boolean => {
		const active = getActive();
		return active.core
			.getNotes()
			.some(
				(n) =>
					n.id !== excludeId &&
					n.pitch === pitch &&
					step >= n.startStep &&
					step < n.startStep + n.durationSteps,
			);
	};

	const snapToGrid = (duration: number): number =>
		Math.max(
			Math.round(duration / snapGridSteps) * snapGridSteps,
			snapGridSteps,
		);

	const isActiveLocked = (): boolean =>
		options.lockedTracks?.includes(getActive().config.id) ?? false;

	const onGridPointerDown = (event: PointerEvent): void => {
		event.preventDefault();
		options.onResumeAudio?.();
		const { x, y, step, pitch } = getGridPosition(event);
		const active = getActive();

		if (activeToolMode === "eraser") {
			if (isActiveLocked()) return;
			const note = findActiveNoteAt(x, y);
			if (note) active.core.deleteNoteById(note.id);
			return;
		}

		if (activeToolMode === "select") {
			if (selectedNotes.length > 0) {
				const clicked = findActiveNoteAt(x, y);
				if (clicked && selectedNotes.some((n) => n.id === clicked.id)) {
					selectedOriginal = selectedNotes.map((n) => ({
						id: n.id,
						startStep: n.startStep,
						pitch: n.pitch,
					}));
					isSelecting = true;
					dragMode = "move";
					selectionStart = { x, y, step, pitch };
					hasDragged = false;
					lastMultiPreviewPitch = null;
					return;
				}
				selectedNotes = [];
				selectionRect = null;
			}
			const clicked = findActiveNoteAt(x, y);
			if (clicked) {
				selectedNotes = [clicked];
				selectedOriginal = [
					{
						id: clicked.id,
						startStep: clicked.startStep,
						pitch: clicked.pitch,
					},
				];
				isSelecting = true;
				dragMode = "move";
			} else {
				selectedNotes = [];
				selectionRect = null;
				isSelecting = true;
				dragMode = "rect";
			}
			selectionStart = { x, y, step, pitch };
			hasDragged = false;
			return;
		}

		// pen
		hasDragged = false;
		// ピクセルレベルのヒット判定（タッチ操作用のマージン付き）
		const existing = findActiveNoteAt(x, y, TOUCH_HIT_MARGIN);
		if (existing) {
			playPreview(existing.pitch);
			const { stepWidth } = renderConfig;
			const offset = getDrawOffset();
			const renderX = existing.startStep * stepWidth - offset.x;
			const w = existing.durationSteps * stepWidth;
			if (x >= renderX + w - resizeHandleWidth && x <= renderX + w) {
				dragState = {
					noteId: existing.id,
					mode: "resize",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			} else {
				dragState = {
					noteId: existing.id,
					mode: "move",
					dragOffsetStep: step - existing.startStep,
					dragOffsetPitch: pitch - existing.pitch,
					startStep: existing.startStep,
					durationSteps: existing.durationSteps,
					lastPreviewPitch: existing.pitch,
				};
			}
			suppressClick = true;
			return;
		}

		if (isActiveLocked()) return;

		const snappedStep =
			Math.floor(step / currentInsertLength) * currentInsertLength;
		const newStart = snappedStep;
		const newEnd = newStart + currentInsertLength;
		const overlapping = active.core
			.getNotes()
			.some(
				(n) =>
					n.pitch === pitch &&
					newStart < n.startStep + n.durationSteps &&
					newEnd > n.startStep,
			);
		if (!overlapping) {
			active.core.addNote(snappedStep, pitch, {
				noteLengthSteps: currentInsertLength,
			});
			playPreview(pitch);
			const newNote = active.core
				.getNotes()
				.find((n) => n.startStep === snappedStep && n.pitch === pitch);
			if (newNote) {
				dragState = {
					noteId: newNote.id,
					mode: "move",
					dragOffsetStep: 0,
					dragOffsetPitch: 0,
					startStep: newNote.startStep,
					durationSteps: newNote.durationSteps,
					lastPreviewPitch: newNote.pitch,
				};
				hasDragged = true;
			}
			suppressClick = true;
		}
	};

	const onPointerMove = (event: PointerEvent): void => {
		const active = getActive();
		if (activeToolMode === "pen") {
			if (!dragState) return;
			const { step, pitch } = getGridPosition(event);
			hasDragged = true;
			if (dragState.mode === "move") {
				const nextStart = step - dragState.dragOffsetStep;
				const snappedStart =
					Math.round(nextStart / snapGridSteps) * snapGridSteps;
				const nextPitch = pitch - dragState.dragOffsetPitch;
				if (hasNoteAt(snappedStart, nextPitch, dragState.noteId)) return;
				active.core.moveNote(dragState.noteId, snappedStart, nextPitch);
				if (nextPitch !== dragState.lastPreviewPitch) {
					dragState.lastPreviewPitch = nextPitch;
					playPreview(nextPitch);
				}
				return;
			}
			const rawDuration = step - dragState.startStep + 1;
			const snapped = snapToGrid(rawDuration);
			active.core.resizeNote(dragState.noteId, snapped);
			dragState.durationSteps = snapped;
			currentInsertLength = snapped;
			redrawAll();
			return;
		}

		if (activeToolMode === "select" && isSelecting && selectionStart) {
			ensureAutoScroll(event);
			const { x, y, step, pitch } = getGridPosition(event);
			if (dragMode === "rect") {
				const rect = {
					x: Math.min(x, selectionStart.x),
					y: Math.min(y, selectionStart.y),
					width: Math.abs(x - selectionStart.x),
					height: Math.abs(y - selectionStart.y),
				};
				selectionRect = rect;
				const { stepWidth, keyHeight, keyCount, pitchRangeStart } =
					renderConfig;
				const offset = getDrawOffset();
				selectedNotes = active.core.getNotes().filter((note) => {
					const logicalX = note.startStep * stepWidth;
					const yIndex = keyCount - 1 - (note.pitch - pitchRangeStart);
					const logicalY = yIndex * keyHeight;
					const nx = logicalX - offset.x;
					const ny = logicalY - offset.y;
					const nw = note.durationSteps * stepWidth;
					// ノート全体が選択範囲内に完全に収まっている場合のみ選択対象とする
					return (
						nx >= rect.x &&
						nx + nw <= rect.x + rect.width &&
						ny >= rect.y &&
						ny + keyHeight <= rect.y + rect.height
					);
				});
				redrawAll();
			} else {
				const rawDeltaStep = step - selectionStart.step;
				const snappedDelta =
					Math.round(rawDeltaStep / snapGridSteps) * snapGridSteps;
				const deltaPitch = pitch - selectionStart.pitch;
				if (snappedDelta !== 0 || deltaPitch !== 0) {
					hasDragged = true;
					if (!active.core.isBatchOperation) active.core.beginBatch();
					for (const note of selectedNotes) {
						const orig = selectedOriginal.find((o) => o.id === note.id);
						if (!orig) continue;
						const newPitch = orig.pitch + deltaPitch;
						if (newPitch >= 0 && newPitch < 128)
							active.core.moveNote(
								note.id,
								orig.startStep + snappedDelta,
								newPitch,
							);
					}
					if (selectedNotes.length > 0) {
						const grab = selectedNotes[0];
						const orig = selectedOriginal.find((o) => o.id === grab.id);
						if (orig) {
							const newGrab = orig.pitch + deltaPitch;
							if (
								newGrab !== lastMultiPreviewPitch &&
								newGrab >= 0 &&
								newGrab < 128
							) {
								lastMultiPreviewPitch = newGrab;
								playPreview(newGrab);
							}
						}
					}
				}
				redrawAll();
			}
		}
	};

	const onPointerUp = (): void => {
		if (activeToolMode === "pen" && dragState) {
			if (hasDragged) {
				const active = getActive();
				if (dragState.mode === "move")
					active.core.moveNoteEnd(dragState.noteId);
				else active.core.resizeNoteEnd(dragState.noteId);
				suppressClick = true;
			}
			dragState = null;
			hasDragged = false;
		}
		if (activeToolMode === "select" && isSelecting) {
			if (hasDragged && dragMode === "move" && selectedNotes.length > 0) {
				getActive().core.endBatch();
			}
			isSelecting = false;
			selectionStart = null;
			hasDragged = false;
			lastMultiPreviewPitch = null;
			// 矩形選択の枠線は選択状態を示す補助線として残す（移動ドラッグ時や未選択時は消す）
			if (dragMode !== "rect" || selectedNotes.length === 0) {
				selectionRect = null;
			}
			selectedOriginal = [];
			stopAutoScroll();
			redrawAll();
		}
	};

	// ============================================================
	// ピアノロール背景画像（カスタム背景）
	// localStorage は同期API・文字列専用で容量も小さく GIF 等の大きいバイナリに不向きなため、
	// Blob をそのまま保存できる IndexedDB を使用する。
	// ============================================================
	const BG_DB_NAME = "dtm-daw-db";
	const BG_DB_STORE = "settings";
	const BG_DB_KEY = "piano-roll-bg";
	const BG_OPACITY_KEY = "dtm-piano-roll-bg-opacity";
	// リサイズ＋再圧縮の対象とする静止ラスター画像形式（GIF等アニメーション画像はここに含めない）
	const COMPRESSIBLE_IMAGE_TYPES = new Set([
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/bmp",
	]);

	const openBgDb = (): Promise<IDBDatabase> =>
		new Promise((resolve, reject) => {
			const req = indexedDB.open(BG_DB_NAME, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(BG_DB_STORE);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});

	const saveBgBlob = async (blob: Blob): Promise<void> => {
		const db = await openBgDb();
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(BG_DB_STORE, "readwrite");
				tx.objectStore(BG_DB_STORE).put(blob, BG_DB_KEY);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	};

	const loadBgBlob = async (): Promise<Blob | null> => {
		const db = await openBgDb();
		try {
			return await new Promise<Blob | null>((resolve, reject) => {
				const tx = db.transaction(BG_DB_STORE, "readonly");
				const req = tx.objectStore(BG_DB_STORE).get(BG_DB_KEY);
				req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
				req.onerror = () => reject(req.error);
			});
		} finally {
			db.close();
		}
	};

	const deleteBgBlob = async (): Promise<void> => {
		const db = await openBgDb();
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(BG_DB_STORE, "readwrite");
				tx.objectStore(BG_DB_STORE).delete(BG_DB_KEY);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	};

	const resizeImageToBlob = (
		img: HTMLImageElement,
		maxW: number,
		maxH: number,
	): Promise<Blob> => {
		const scale = Math.min(1, maxW / img.width, maxH / img.height);
		const width = Math.max(1, Math.round(img.width * scale));
		const height = Math.max(1, Math.round(img.height * scale));
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (ctx) ctx.drawImage(img, 0, 0, width, height);
		return new Promise((resolve, reject) => {
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
				"image/jpeg",
				0.7,
			);
		});
	};

	let currentBgObjectUrl: string | null = null;

	const applyBgOpacity = (opacityVal: number): void => {
		refs.rollContainer.style.setProperty(
			"--dtm-roll-bg-opacity",
			String(opacityVal / 100),
		);
		refs.bgOpacityInput.value = String(opacityVal);
	};

	const applyRollBackground = (blob: Blob | null): void => {
		if (currentBgObjectUrl) {
			URL.revokeObjectURL(currentBgObjectUrl);
			currentBgObjectUrl = null;
		}
		if (blob) {
			currentBgObjectUrl = URL.createObjectURL(blob);
			refs.rollContainer.style.setProperty(
				"--dtm-roll-bg-image",
				`url(${currentBgObjectUrl})`,
			);
			refs.bgOpacityRow.classList.remove("dtm-hidden");
		} else {
			refs.rollContainer.style.setProperty("--dtm-roll-bg-image", "none");
			refs.bgOpacityRow.classList.add("dtm-hidden");
		}
		refs.bgRemoveBtn.classList.toggle("dtm-hidden", !blob);
		setBackgroundActive(!!blob);
		redrawAll();
	};

	// ============================================================
	// Canvas セットアップ（リサイズ時に再構築）
	// ============================================================
	const setupCanvas = (): void => {
		const w = refs.rollContainer.clientWidth || 800;
		const h = refs.rollContainer.clientHeight || 450;
		init(refs.wrapper, w, h, renderConfig);

		const gridCanvas = getGridCanvas();
		gridCanvas.addEventListener("pointerdown", onGridPointerDown);
		gridCanvas.addEventListener("dblclick", (event) => {
			event.preventDefault();
			if (isActiveLocked()) return;
			const { step, pitch } = getGridPosition(event);
			const active = getActive();
			const note = active.core
				.getNotes()
				.find(
					(n) =>
						n.pitch === pitch &&
						step >= n.startStep &&
						step < n.startStep + n.durationSteps,
				);
			if (note) active.core.deleteNoteById(note.id);
		});
		gridCanvas.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				currentOffsetY = clamp(
					currentOffsetY + event.deltaY,
					0,
					getMaxOffsetY(),
				);
				currentOffsetX = clamp(
					currentOffsetX + event.deltaX,
					0,
					getMaxOffsetX(),
				);
				setDrawOffset(currentOffsetX, currentOffsetY);
				redrawAll();
			},
			{ passive: false },
		);
		// クリック＝再生開始位置 / ノート追加はpointerdownで処理済
		gridCanvas.addEventListener("click", () => {
			if (suppressClick) {
				suppressClick = false;
			}
		});

		const headerCanvas = getHeaderCanvas();
		headerCanvas.addEventListener("click", (event) => {
			if (playbackState === "playing") return;
			const rect = headerCanvas.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const step = Math.floor((x + currentOffsetX) / renderConfig.stepWidth);
			playStartStep = Math.max(
				0,
				Math.floor(step / snapGridSteps) * snapGridSteps,
			);
			if (playbackState === "paused") {
				playbackState = "stopped";
				updateTransport();
			}
			redrawAll();
		});

		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// ============================================================
	// ズーム
	// ============================================================
	const applyZoomX = (): void => {
		const canvas = getGridCanvas();
		const centerStep =
			(currentOffsetX + canvas.width / 2) / renderConfig.stepWidth;
		renderConfig.stepWidth = (BASE_STEP_WIDTH * (zoomX * 2)) / 100;
		refs.zoomXLabel.textContent = `${zoomX}%`;
		currentOffsetX = clamp(
			centerStep * renderConfig.stepWidth - canvas.width / 2,
			0,
			getMaxOffsetX(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};
	const applyZoomY = (): void => {
		const canvas = getGridCanvas();
		const centerKey =
			(currentOffsetY + canvas.height / 2) / renderConfig.keyHeight;
		renderConfig.keyHeight = (BASE_KEY_HEIGHT * zoomY) / 100;
		refs.zoomYLabel.textContent = `${zoomY}%`;
		currentOffsetY = clamp(
			centerKey * renderConfig.keyHeight - canvas.height / 2,
			0,
			getMaxOffsetY(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
		redrawAll();
	};

	// 永続化対象の表示・出力設定（ズーム / 和音分解）を収集・通知する
	const getViewState = (): DawViewState => ({
		zoomX,
		zoomY,
		decomposeChord: refs.decomposeChordToggle.checked,
		ignoreChordHeavy: refs.ignoreChordHeavyToggle.checked,
	});
	const notifyViewState = (): void =>
		options.onViewStateChange?.(getViewState());

	// ============================================================
	// 発音ディスパッチ（マスタ/ドラム音量を適用してフックへ）
	// ============================================================
	const dispatchNote = (
		trackId: string,
		pitch: number,
		trackVol: number,
		velocity: number,
		when: number,
		duration: number,
	): void => {
		const volume = (trackVol / 100) * (velocity / 127) * (masterVolume / 100);
		options.onPlayNote?.({ trackId, pitch, velocity, volume, when, duration });
	};

	// ============================================================
	// 再生
	// ============================================================
	const sequencer: Sequencer = createSequencer({
		getTracks: () =>
			trackStates.map((t) => ({
				id: t.config.id,
				volume: t.volume,
				notes: t.core.getNotes(),
			})),
		getBpm: () => bpm,
		getPlayStartStep: () => playStartStep,
		getDrumPattern: (currentBar) =>
			resolveDrumPattern(currentDrumPattern, drumPatterns, currentBar),
		getSoloTrackId: () => (isSolo ? activeTrackId : null),
		getAudioTime,
		onPlayNote: (e) => {
			// 音ミュート中のトラックはスキップ。
			if (audioMutedTracks.has(e.trackId)) return;
			// 歌詞トラックの発音は歌声ストリーミング（startStream）が担当するため、
			// 楽器音は鳴らさない。@@n の n は trackStates の並び順（@n）に対応づく。
			const idx = trackStates.findIndex((t) => t.config.id === e.trackId);
			if (idx >= 0 && lyricTrackIndices.has(idx) && options.singingVoices) {
				return;
			}
			flashTrackPill(e.trackId, e.when, e.duration);
			options.onPlayNote?.({ ...e, volume: e.volume * (masterVolume / 100) });
		},
		onPlayDrum: (e) => {
			const velocity = e.velocity * (drumVolume / 100) * (masterVolume / 100);
			options.onPlayDrum?.({ ...e, velocity });
		},
		onTick: (step) => {
			currentPlayStep = step;
			const canvas = getGridCanvas();
			const visibleSteps = canvas.width / renderConfig.stepWidth;
			const threshold =
				currentOffsetX / renderConfig.stepWidth + visibleSteps - 4;
			if (currentPlayStep > threshold) {
				const visibleBars = Math.round(visibleSteps / renderConfig.stepsPerBar);
				currentOffsetX = clamp(
					currentOffsetX +
						visibleBars * renderConfig.stepsPerBar * renderConfig.stepWidth,
					0,
					getMaxOffsetX(),
				);
				setDrawOffset(currentOffsetX, currentOffsetY);
			}
			redrawAll();
		},
		onEnd: (interrupted) => {
			if (interrupted) {
				playbackState = "paused";
				pausedPlayStep = currentPlayStep;
			} else {
				playbackState = "stopped";
				currentPlayStep = 0;
			}
			updateTransport();
			redrawAll();
		},
		stepsPerBar: renderConfig.stepsPerBar,
	});

	const play = async (): Promise<void> => {
		if (playbackState === "playing") return;
		// AudioContext の resume は非同期。suspended（currentTime 凍結）のまま
		// sequencer.start すると resume 完了の瞬間に先読み予約が一斉発音され、冒頭で
		// 「ピチュ」という潰れた音が鳴る。resume の完了を待ってからスケジュールを始める。
		await options.onResumeAudio?.();

		const fromStep =
			playbackState === "paused" ? pausedPlayStep : playStartStep;

		options.singingVoices?.reset();

		// 歌詞トラックを「絶対時刻ベースのストリーミング用」ノート列へ変換する。
		// fromStep より前のノートは切り落とし、startSec は fromStep 基準にする。
		const lyricMap = buildLyricsMap();
		lyricTrackIndices = new Set(lyricMap.keys());
		const secondsPerStep = 60 / bpm / 48; // STEPS_PER_BEAT = 48
		const streamTracks: StreamVoiceTrack[] = options.singingVoices
			? [...lyricMap.values()].map((lt) => {
					const trackState = trackStates[lt.trackId];
					const sorted = [...(trackState?.core.getNotes() ?? [])].sort(
						(a, b) => a.startStep - b.startStep,
					);
					const gate = (lt.gate ?? DEFAULT_GATE) / 100;
					const semis = (lt.octave ?? 0) * 12; // オクターブシフトを半音換算でピッチへ加算
					const count = Math.min(sorted.length, lt.syllables.length);
					const notes = [];
					for (let i = 0; i < count; i++) {
						const n = sorted[i];
						if (n.startStep < fromStep) continue;
						notes.push({
							syllable: lt.syllables[i],
							pitch: n.pitch + semis,
							startSec: (n.startStep - fromStep) * secondsPerStep,
							durationSec: n.durationSteps * secondsPerStep * gate,
						});
					}
					return {
						id: trackState?.config.id,
						model: lt.model,
						volume: vocalVolumeToGain(lt.volume ?? DEFAULT_VOCAL_VOLUME),
						pan: panToStereo(lt.pan ?? DEFAULT_PAN),
						vibrato: lt.vibrato,
						reverbSend: (lt.reverb ?? 0) / 100,
						delaySend: (lt.delay ?? 0) / 100,
						gender: (lt.gender ?? 50) / 100,
						breathiness: (lt.breathiness ?? 50) / 100,
						tension: (lt.tension ?? 50) / 100,
						octaveUnison: lt.octaveUnison,
						notes,
					};
				})
			: [];

		const voices = options.singingVoices;
		const streaming = !!voices && streamTracks.some((t) => t.notes.length > 0);
		if (streaming && voices) {
			// オーバーレイはピアノロール部分だけに被せる（操作パネルまで覆わない）
			const overlay = showLoadingOverlay(refs.rollContainer);
			setLoading(true);
			try {
				// カスタムボーカルの .koe URL をカタログへ流し込んでからロードする
				// （未登録だと catalog に無いキー扱いになり klatt へフォールバックしてしまう）
				if (customVocalsMap.size > 0) {
					voices.registerVoicebanks?.(
						Object.fromEntries(
							[...customVocalsMap].map(([k, d]) => [k, d.url]),
						),
					);
				}
				await voices.loadModels(streamTracks.map((t) => t.model));
				await voices.warm(streamTracks);
			} catch (err) {
				console.warn("[dtm] voice preload failed", err);
			} finally {
				overlay.remove();
				setLoading(false);
			}
		}

		if (playbackState !== "paused") {
			// 再生開始位置までスクロール
			const canvas = getGridCanvas();
			currentOffsetX = clamp(
				playStartStep * renderConfig.stepWidth - canvas.width * 0.5,
				0,
				getMaxOffsetX(),
			);
			setDrawOffset(currentOffsetX, currentOffsetY);
		}
		playbackState = "playing";
		sequencer.start(fromStep);
		startPeakSampling();

		// フェードイン/アウトのスケジュール。フェードインは曲頭（fromStep===0）から
		// 再生したときだけ、フェードアウトは現在のノート終端に向けて掛ける。
		{
			const anchor = sequencer.getStartTime();
			const secondsPerStepFade = 60 / bpm / 48;
			const params: import("./types").FadeScheduleParams = {};
			if (fadeInSec > 0 && fromStep === 0) {
				params.fadeInStartAt = anchor;
				params.fadeInEndAt = anchor + fadeInSec;
			}
			if (fadeOutSec > 0) {
				const endStep = getSongEndStepExact();
				const totalDurationSec = (endStep - fromStep) * secondsPerStepFade;
				if (totalDurationSec > 0) {
					const fadeOutEndAt = anchor + totalDurationSec;
					const earliestStart = params.fadeInEndAt ?? anchor;
					params.fadeOutEndAt = fadeOutEndAt;
					params.fadeOutStartAt = Math.max(
						fadeOutEndAt - fadeOutSec,
						earliestStart,
					);
				}
			}
			options.onScheduleFade?.(params);
		}

		// 楽器と同じアンカー（開始時刻）で歌声の先読みストリーミングを開始する。
		// ソロはライブ判定（楽器側＝シーケンサの getSoloTrackId と同じ基準）で渡す。
		if (streaming && voices) {
			voices.startStream(streamTracks, sequencer.getStartTime(), {
				isAudible: (t) => !isSolo || t.id === activeTrackId,
				onScheduled: (t, note, t0) => {
					if (!t.id) return;
					flashTrackPill(t.id, t0 - getAudioTime(), note.durationSec);
				},
			});
		}
		updateTransport();
	};
	const pause = (): void => {
		if (playbackState !== "playing") return;
		pausedPlayStep = currentPlayStep;
		sequencer.stop();
		options.singingVoices?.stopStream();
		clearSoundTimers();
		options.onScheduleFade?.(null);
		playbackState = "paused";
		stopPeakSampling();
		updateTransport();
	};
	// koe音源（歌唱モデル）変更時、再生中なら停止→再ロード→同じ位置から再開する。
	// play() が streamTracks を再構築し、loadModels で新モデルを取得してから
	// pausedPlayStep の続きを鳴らすため、楽器変更（applyPreset）と同じ挙動になる。
	const reloadVoicesForModel = (model: string): void => {
		const voices = options.singingVoices;
		if (!voices || !model || playbackState !== "playing") return;
		pause();
		void play();
	};
	const stop = (): void => {
		sequencer.stop();
		options.singingVoices?.stopStream();
		clearSoundTimers();
		options.onScheduleFade?.(null);
		playbackState = "stopped";
		currentPlayStep = 0;
		stopPeakSampling();
		updateTransport();
		redrawAll();
	};
	const togglePlay = (): void => {
		if (playbackState === "playing") stop();
		else play();
	};

	// ============================================================
	// UIコントロール
	// ============================================================
	const updateTransport = (): void => {
		const playing = playbackState === "playing";
		refs.playBtn.innerHTML = icon(playing ? "pause" : "play");
		refs.playBtn.classList.toggle("dtm-play--stop", playing);
	};

	const updateUndoRedo = (): void => {
		const core = getActive().core;
		refs.undoBtn.disabled = !core.canUndo();
		refs.redoBtn.disabled = !core.canRedo();
	};

	const updateTrackPanel = (): void => {
		// トラックピル（色分け・常時表示）
		refs.trackTabs.innerHTML = "";
		trackPillEls.clear();
		for (const [i, t] of trackStates.entries()) {
			const [r, g, b] = t.config.color;
			const btn = document.createElement("button");
			btn.className = `dtm-pill ${t.config.id === activeTrackId ? "dtm-pill--active" : ""}`;
			btn.style.setProperty("--dtm-pill-color", `rgb(${r},${g},${b})`);
			btn.title = t.config.name;
			btn.textContent = String(i + 1);
			btn.addEventListener("click", () => switchTrack(t.config.id));
			refs.trackTabs.appendChild(btn);
			trackPillEls.set(t.config.id, btn);
		}
		// ボディ
		const active = getActive();
		refs.trackBody.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">ベロシティ</span>
        <input type="range" class="dtm-range dtm-grow" data-dtm="track-vol" min="0" max="127" value="${active.volume}">
        <span class="dtm-label" data-dtm="track-vol-label">${active.volume}</span>
      </div>
      <details class="dtm-advanced" data-dtm="track-fx-advanced" ${trackFxAdvancedOpen ? "open" : ""}>
        <summary>詳細設定（EQ・音圧・ステレオ幅）</summary>
        <div class="dtm-row">
          <span class="dtm-label">EQ低域</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-eq-low" min="-12" max="12" step="1" aria-label="このトラックのEQ低域ゲイン（dB）">
          <span class="dtm-label" data-dtm="track-eq-low-label"></span>
          <button class="dtm-infobtn" data-dtm="track-eq-info" title="EQの解説">${icon("info", 12)}</button>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">EQ中域</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-eq-mid" min="-12" max="12" step="1" aria-label="このトラックのEQ中域ゲイン（dB）">
          <span class="dtm-label" data-dtm="track-eq-mid-label"></span>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">EQ高域</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-eq-high" min="-12" max="12" step="1" aria-label="このトラックのEQ高域ゲイン（dB）">
          <span class="dtm-label" data-dtm="track-eq-high-label"></span>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">音圧強化</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-comp" min="0" max="100" aria-label="このトラックのコンプレッサー量（音圧強化）">
          <span class="dtm-label" data-dtm="track-comp-label"></span>
          <button class="dtm-infobtn" data-dtm="track-comp-info" title="音圧強化の解説">${icon("info", 12)}</button>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">ステレオ幅</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-width" min="0" max="200" aria-label="このトラックのステレオ幅（100=原音、0=モノラル）">
          <span class="dtm-label" data-dtm="track-width-label"></span>
          <button class="dtm-infobtn" data-dtm="track-width-info" title="ステレオ幅の解説">${icon("info", 12)}</button>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">定位</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-pan" min="0" max="127" aria-label="このトラックの左右の定位（64=中央、0=左いっぱい、127=右いっぱい）">
          <span class="dtm-label" data-dtm="track-pan-label"></span>
          <button class="dtm-infobtn" data-dtm="track-pan-info" title="定位の解説">${icon("info", 12)}</button>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">リバーブ送り</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-reverb-send" min="0" max="100" aria-label="このトラックのマスタリバーブへの送り量（0=掛からない）">
          <span class="dtm-label" data-dtm="track-reverb-send-label"></span>
          <button class="dtm-infobtn" data-dtm="track-reverb-send-info" title="リバーブ送りの解説">${icon("info", 12)}</button>
        </div>
        <div class="dtm-row">
          <span class="dtm-label">ディレイ送り</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="track-delay-send" min="0" max="100" aria-label="このトラックのマスタディレイへの送り量（0=掛からない）">
          <span class="dtm-label" data-dtm="track-delay-send-label"></span>
          <button class="dtm-infobtn" data-dtm="track-delay-send-info" title="ディレイ送りの解説">${icon("info", 12)}</button>
        </div>
      </details>`;
		(
			refs.trackBody.querySelector(
				'[data-dtm="track-fx-advanced"]',
			) as HTMLDetailsElement
		).addEventListener("toggle", (e) => {
			trackFxAdvancedOpen = (e.target as HTMLDetailsElement).open;
		});
		const volInput = refs.trackBody.querySelector(
			'[data-dtm="track-vol"]',
		) as HTMLInputElement;
		const volLabel = refs.trackBody.querySelector(
			'[data-dtm="track-vol-label"]',
		) as HTMLElement;
		volInput.addEventListener("input", () => {
			active.volume = Number.parseInt(volInput.value, 10);
			active.core.setVolume(active.volume);
			volLabel.textContent = String(active.volume);
		});
		// 歌詞モデルが設定されているトラックはベロシティが再生に反映されない（声量が代わりに効く）ため、
		// 編集できないように見せる（実際に無効化して誤操作を防ぐ）。
		const syncVelocityDisabled = (): void => {
			volInput.disabled = !!active.lyricModel;
			volInput.title = active.lyricModel
				? "歌詞モードのときはベロシティが再生に反映されません（声量で調整してください）"
				: "";
		};
		syncVelocityDisabled();

		// トラック単位チャンネルストリップ（EQ・音圧強化・ステレオ幅）。ボーカル・楽器問わず
		// このトラックの発音全体に掛かる（歌詞トラック固有のジェンダー/ブレシネスとは別軸）。
		const trackEqLowInput = refs.trackBody.querySelector(
			'[data-dtm="track-eq-low"]',
		) as HTMLInputElement;
		const trackEqLowLabel = refs.trackBody.querySelector(
			'[data-dtm="track-eq-low-label"]',
		) as HTMLElement;
		const trackEqMidInput = refs.trackBody.querySelector(
			'[data-dtm="track-eq-mid"]',
		) as HTMLInputElement;
		const trackEqMidLabel = refs.trackBody.querySelector(
			'[data-dtm="track-eq-mid-label"]',
		) as HTMLElement;
		const trackEqHighInput = refs.trackBody.querySelector(
			'[data-dtm="track-eq-high"]',
		) as HTMLInputElement;
		const trackEqHighLabel = refs.trackBody.querySelector(
			'[data-dtm="track-eq-high-label"]',
		) as HTMLElement;
		const trackEqInfo = refs.trackBody.querySelector(
			'[data-dtm="track-eq-info"]',
		) as HTMLButtonElement;
		const fmtDb = (db: number): string => (db > 0 ? `+${db}dB` : `${db}dB`);
		trackEqLowInput.value = String(active.trackEqLow);
		trackEqLowLabel.textContent = fmtDb(active.trackEqLow);
		trackEqMidInput.value = String(active.trackEqMid);
		trackEqMidLabel.textContent = fmtDb(active.trackEqMid);
		trackEqHighInput.value = String(active.trackEqHigh);
		trackEqHighLabel.textContent = fmtDb(active.trackEqHigh);
		trackEqLowInput.addEventListener("input", () => {
			active.trackEqLow = Number.parseInt(trackEqLowInput.value, 10);
			trackEqLowLabel.textContent = fmtDb(active.trackEqLow);
			options.onTrackEqLowChange?.(active.config.id, active.trackEqLow);
		});
		trackEqMidInput.addEventListener("input", () => {
			active.trackEqMid = Number.parseInt(trackEqMidInput.value, 10);
			trackEqMidLabel.textContent = fmtDb(active.trackEqMid);
			options.onTrackEqMidChange?.(active.config.id, active.trackEqMid);
		});
		trackEqHighInput.addEventListener("input", () => {
			active.trackEqHigh = Number.parseInt(trackEqHighInput.value, 10);
			trackEqHighLabel.textContent = fmtDb(active.trackEqHigh);
			options.onTrackEqHighChange?.(active.config.id, active.trackEqHigh);
		});
		trackEqInfo.addEventListener("click", () => {
			showModal("EQ（イコライザー）の解説", TRACK_EQ_INFO_HTML);
		});

		const trackCompInput = refs.trackBody.querySelector(
			'[data-dtm="track-comp"]',
		) as HTMLInputElement;
		const trackCompLabel = refs.trackBody.querySelector(
			'[data-dtm="track-comp-label"]',
		) as HTMLElement;
		const trackWidthInput = refs.trackBody.querySelector(
			'[data-dtm="track-width"]',
		) as HTMLInputElement;
		const trackWidthLabel = refs.trackBody.querySelector(
			'[data-dtm="track-width-label"]',
		) as HTMLElement;
		const trackCompInfo = refs.trackBody.querySelector(
			'[data-dtm="track-comp-info"]',
		) as HTMLButtonElement;
		const trackWidthInfo = refs.trackBody.querySelector(
			'[data-dtm="track-width-info"]',
		) as HTMLButtonElement;
		trackCompInput.value = String(active.trackCompression);
		trackCompLabel.textContent = `${active.trackCompression}%`;
		trackWidthInput.value = String(active.trackWidth);
		trackWidthLabel.textContent = `${active.trackWidth}%`;
		trackCompInput.addEventListener("input", () => {
			active.trackCompression = Number.parseInt(trackCompInput.value, 10);
			trackCompLabel.textContent = `${active.trackCompression}%`;
			options.onTrackCompressionChange?.(
				active.config.id,
				active.trackCompression,
			);
		});
		trackWidthInput.addEventListener("input", () => {
			active.trackWidth = Number.parseInt(trackWidthInput.value, 10);
			trackWidthLabel.textContent = `${active.trackWidth}%`;
			options.onTrackWidthChange?.(active.config.id, active.trackWidth);
		});
		trackCompInfo.addEventListener("click", () => {
			showModal("音圧強化の解説", TRACK_COMPRESSION_INFO_HTML);
		});
		trackWidthInfo.addEventListener("click", () => {
			showModal("ステレオ幅の解説", TRACK_WIDTH_INFO_HTML);
		});

		const trackPanInput = refs.trackBody.querySelector(
			'[data-dtm="track-pan"]',
		) as HTMLInputElement;
		const trackPanLabel = refs.trackBody.querySelector(
			'[data-dtm="track-pan-label"]',
		) as HTMLElement;
		const trackPanInfo = refs.trackBody.querySelector(
			'[data-dtm="track-pan-info"]',
		) as HTMLButtonElement;
		const fmtTrackPan = (pan: number): string =>
			pan === 64 ? "C" : pan < 64 ? `L${64 - pan}` : `R${pan - 64}`;
		trackPanInput.value = String(active.trackPan);
		trackPanLabel.textContent = fmtTrackPan(active.trackPan);
		trackPanInput.addEventListener("input", () => {
			active.trackPan = Number.parseInt(trackPanInput.value, 10);
			trackPanLabel.textContent = fmtTrackPan(active.trackPan);
			options.onTrackPanChange?.(active.config.id, active.trackPan);
		});
		trackPanInfo.addEventListener("click", () => {
			showModal("定位の解説", TRACK_PAN_INFO_HTML);
		});

		const trackReverbSendInput = refs.trackBody.querySelector(
			'[data-dtm="track-reverb-send"]',
		) as HTMLInputElement;
		const trackReverbSendLabel = refs.trackBody.querySelector(
			'[data-dtm="track-reverb-send-label"]',
		) as HTMLElement;
		const trackReverbSendInfo = refs.trackBody.querySelector(
			'[data-dtm="track-reverb-send-info"]',
		) as HTMLButtonElement;
		trackReverbSendInput.value = String(active.trackReverbSend);
		trackReverbSendLabel.textContent = `${active.trackReverbSend}%`;
		trackReverbSendInput.addEventListener("input", () => {
			active.trackReverbSend = Number.parseInt(trackReverbSendInput.value, 10);
			trackReverbSendLabel.textContent = `${active.trackReverbSend}%`;
			options.onTrackReverbSendChange?.(
				active.config.id,
				active.trackReverbSend,
			);
		});
		trackReverbSendInfo.addEventListener("click", () => {
			showModal("リバーブ送りの解説", TRACK_REVERBSEND_INFO_HTML);
		});

		const trackDelaySendInput = refs.trackBody.querySelector(
			'[data-dtm="track-delay-send"]',
		) as HTMLInputElement;
		const trackDelaySendLabel = refs.trackBody.querySelector(
			'[data-dtm="track-delay-send-label"]',
		) as HTMLElement;
		const trackDelaySendInfo = refs.trackBody.querySelector(
			'[data-dtm="track-delay-send-info"]',
		) as HTMLButtonElement;
		trackDelaySendInput.value = String(active.trackDelaySend);
		trackDelaySendLabel.textContent = `${active.trackDelaySend}%`;
		trackDelaySendInput.addEventListener("input", () => {
			active.trackDelaySend = Number.parseInt(trackDelaySendInput.value, 10);
			trackDelaySendLabel.textContent = `${active.trackDelaySend}%`;
			options.onTrackDelaySendChange?.(active.config.id, active.trackDelaySend);
		});
		trackDelaySendInfo.addEventListener("click", () => {
			showModal("ディレイ送りの解説", TRACK_DELAYSEND_INFO_HTML);
		});

		// 楽器個別選択（デフォルト＝プリセット or GM楽器名指定）
		const instRow = document.createElement("div");
		instRow.className = "dtm-row";
		instRow.innerHTML = `<span class="dtm-label">楽器</span>`;
		const instSel = document.createElement("select");
		instSel.className = "dtm-select dtm-grow";
		const defaultOpt = document.createElement("option");
		defaultOpt.value = "";
		defaultOpt.textContent = "デフォルト（プリセット）";
		instSel.appendChild(defaultOpt);
		// GM楽器は8音色ごと16カテゴリに分類される
		const GM_GROUPS = [
			"ピアノ",
			"クロマティックパーカッション",
			"オルガン",
			"ギター",
			"ベース",
			"ストリングス",
			"アンサンブル",
			"ブラス",
			"リード（木管）",
			"パイプ",
			"シンセリード",
			"シンセパッド",
			"シンセエフェクト",
			"エスニック",
			"パーカッシブ",
			"サウンドエフェクト",
		];
		GM_GROUPS.forEach((groupName, gi) => {
			const grp = document.createElement("optgroup");
			grp.label = groupName;
			for (let j = 0; j < 8; j++) {
				const name = GM_INSTRUMENT_NAMES[gi * 8 + j];
				if (!name) break;
				const o = document.createElement("option");
				o.value = name;
				o.textContent = name;
				grp.appendChild(o);
			}
			instSel.appendChild(grp);
		});
		instSel.value = normalizeInstrumentName(active.trackInstrument);
		// 歌詞モデルが設定されているトラックは歌声が楽器音を置き換えるため、個別楽器を無効化する
		const syncInstDisabled = (): void => {
			instSel.disabled = !!active.lyricModel;
			instSel.title = active.lyricModel
				? "歌詞モードのときは楽器を個別指定できません"
				: "";
		};
		syncInstDisabled();
		instSel.addEventListener("change", () => {
			active.trackInstrument = instSel.value;
			const trackIndex = trackStates.indexOf(active);
			options.onTrackInstrumentChange?.(trackIndex, active.trackInstrument);
		});
		instRow.appendChild(instSel);
		refs.trackBody.appendChild(instRow);

		// 歌詞エディタ（全トラック共通）。歌唱モデルのプルダウン既定「なし」が無効状態を兼ねる。
		// モデルを選んだときだけ声量・歌詞欄を出す（使わないときは隠す）。@@n model[:声量] lyrics として往復。
		// simpleモードの伴奏(chord)トラックだけは歌詞欄を出さず、下の伴奏UIに置き換える。
		if (isAdvanced || active.config.id !== "chord") {
			const lyricDiv = document.createElement("div");
			lyricDiv.className = "dtm-row";
			lyricDiv.style.flexDirection = "column";
			lyricDiv.style.alignItems = "stretch";
			lyricDiv.innerHTML = `
      <div class="dtm-row">
        <span class="dtm-label">♪ UTAU</span>
        <select class="dtm-select" data-dtm="lyric-model" aria-label="歌唱モデル"></select>
        <img class="dtm-lyric-icon dtm-hidden" data-dtm="lyric-icon" width="20" height="20" alt="" draggable="false">
        <span class="dtm-label dtm-grow" data-dtm="lyric-count" style="text-align:right"></span>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="lyric-terms" style="font-size:10px;gap:4px;color:var(--dtm-warn)">
        <span>使用時には</span>
        <a data-dtm="lyric-terms-link" target="_blank" rel="noopener" style="color:var(--dtm-primary);text-decoration:underline"></a>
        <span>の利用規約に従ってください</span>
      </div>
      <div class="dtm-row dtm-hidden" data-dtm="lyric-custom" style="flex-direction:column;align-items:stretch;gap:4px">
        <div class="dtm-row" style="justify-content: space-between; align-items: center;">
          <a data-dtm="lyric-custom-conv-link" href="https://onjmin.github.io/koe/demo/" target="_blank" rel="noopener" style="font-size:11px;color:var(--dtm-primary);text-decoration:underline">UTAU音源(zip)を.koeに変換</a>
          <button class="dtm-btn dtm-btn--ghost dtm-btn--xs" data-dtm="lyric-custom-guide">使い方ガイド</button>
        </div>
        <input type="url" class="dtm-input" data-dtm="lyric-custom-src" placeholder="音声URL（https://〜.koe）" aria-label="カスタム音声（.koe）のURL">
        <input type="url" class="dtm-input" data-dtm="lyric-custom-icon" placeholder="アイコン画像URL（任意）" aria-label="カスタム音声のアイコン画像URL">
        <div class="dtm-row">
          <span class="dtm-label dtm-grow" data-dtm="lyric-custom-note" style="color:var(--dtm-warn)"></span>
          <button class="dtm-btn dtm-btn--primary" data-dtm="lyric-custom-apply">追加</button>
        </div>
      </div>
      <div class="dtm-row" data-dtm="lyric-body" style="flex-direction:column;align-items:stretch">
        <div class="dtm-row">
          <span class="dtm-label">声量</span>
          <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-vol" min="0" max="${MAX_VOCAL_VOLUME}" aria-label="歌唱の声量（100=等倍、100超でブースト、既定200）">
          <span class="dtm-label" data-dtm="lyric-vol-label"></span>
        </div>
        <details class="dtm-advanced" data-dtm="lyric-advanced" ${lyricAdvancedOpen ? "open" : ""}>
          <summary>詳細設定</summary>
          <div class="dtm-row">
            <span class="dtm-label">オクターブ</span>
            <select class="dtm-select" data-dtm="lyric-octave" aria-label="オクターブ（音源の得意音域に合わせる）" title="オクターブ">
              <option value="2">+2 oct</option>
              <option value="1">+1 oct</option>
              <option value="0">±0 oct</option>
              <option value="-1">-1 oct</option>
              <option value="-2">-2 oct</option>
            </select>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">定位</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-pan" min="0" max="127" aria-label="歌唱のステレオ定位（左右）">
            <span class="dtm-label" data-dtm="lyric-pan-label"></span>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">リバーブ送り</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-reverb" min="0" max="100" aria-label="このトラックからマスタリバーブへ送る量（マスタのリバーブつまみが0%だと無音）">
            <span class="dtm-label" data-dtm="lyric-reverb-label"></span>
            <button class="dtm-infobtn" data-dtm="lyric-reverb-info" title="リバーブ送りの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">ディレイ送り</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-delay" min="0" max="100" aria-label="このトラックからマスタディレイへ送る量（マスタのディレイつまみが0%だと無音）">
            <span class="dtm-label" data-dtm="lyric-delay-label"></span>
            <button class="dtm-infobtn" data-dtm="lyric-delay-info" title="ディレイ送りの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">ジェンダー</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-gender" min="0" max="100" aria-label="フォルマント/ジェンダーファクター（koe音源限定）">
            <span class="dtm-label" data-dtm="lyric-gender-label"></span>
            <button class="dtm-infobtn" data-dtm="lyric-gender-info" title="ジェンダーの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">ブレシネス</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-breathiness" min="0" max="100" aria-label="ブレシネス（息成分、koe音源限定）">
            <span class="dtm-label" data-dtm="lyric-breathiness-label"></span>
            <button class="dtm-infobtn" data-dtm="lyric-breathiness-info" title="ブレシネスの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">テンション</span>
            <input type="range" class="dtm-range dtm-grow" data-dtm="lyric-tension" min="0" max="100" aria-label="テンション（張り/力強さ、koe音源限定）">
            <span class="dtm-label" data-dtm="lyric-tension-label"></span>
            <button class="dtm-infobtn" data-dtm="lyric-tension-info" title="テンションの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label" style="display:inline-flex;align-items:center;gap:2px">
              <input type="checkbox" data-dtm="lyric-vibrato" aria-label="自動ビブラート">ビブラート
            </span>
            <button class="dtm-infobtn" data-dtm="lyric-vibrato-info" title="自動ビブラートの解説">${icon("info", 12)}</button>
          </div>
          <div class="dtm-row">
            <span class="dtm-label">オクターブユニゾン</span>
            <select class="dtm-select dtm-grow" data-dtm="lyric-octave-unison" aria-label="オクターブユニゾン（もう1声を上/下に重ねる）">
              <option value="none">なし</option>
              <option value="down">下 (-1oct)</option>
              <option value="up">上 (+1oct)</option>
              <option value="both">上下両方</option>
            </select>
            <button class="dtm-infobtn" data-dtm="lyric-octave-unison-info" title="オクターブユニゾンの解説">${icon("info", 12)}</button>
          </div>
        </details>
        <textarea class="dtm-textarea" data-dtm="lyric-input" rows="2" placeholder="ひらがな・カタカナで歌詞（例: どれみふぁそらしど）"></textarea>
      </div>`;
			refs.trackBody.appendChild(lyricDiv);
			(
				lyricDiv.querySelector(
					'[data-dtm="lyric-advanced"]',
				) as HTMLDetailsElement
			).addEventListener("toggle", (e) => {
				lyricAdvancedOpen = (e.target as HTMLDetailsElement).open;
			});
			const lyricModelSel = lyricDiv.querySelector(
				'[data-dtm="lyric-model"]',
			) as HTMLSelectElement;
			const lyricOctaveSel = lyricDiv.querySelector(
				'[data-dtm="lyric-octave"]',
			) as HTMLSelectElement;
			const lyricIcon = lyricDiv.querySelector(
				'[data-dtm="lyric-icon"]',
			) as HTMLImageElement;
			const lyricBody = lyricDiv.querySelector(
				'[data-dtm="lyric-body"]',
			) as HTMLElement;
			const lyricInput = lyricDiv.querySelector(
				'[data-dtm="lyric-input"]',
			) as HTMLTextAreaElement;
			const lyricCount = lyricDiv.querySelector(
				'[data-dtm="lyric-count"]',
			) as HTMLElement;
			const lyricVol = lyricDiv.querySelector(
				'[data-dtm="lyric-vol"]',
			) as HTMLInputElement;
			const lyricVolLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-vol-label"]',
			) as HTMLElement;
			const lyricPan = lyricDiv.querySelector(
				'[data-dtm="lyric-pan"]',
			) as HTMLInputElement;
			const lyricPanLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-pan-label"]',
			) as HTMLElement;
			const lyricReverb = lyricDiv.querySelector(
				'[data-dtm="lyric-reverb"]',
			) as HTMLInputElement;
			const lyricReverbLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-reverb-label"]',
			) as HTMLElement;
			const lyricReverbInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-reverb-info"]',
			) as HTMLButtonElement;
			lyricReverbInfo.addEventListener("click", () => {
				showModal("リバーブ送りの解説", LYRIC_REVERB_INFO_HTML);
			});
			const lyricDelay = lyricDiv.querySelector(
				'[data-dtm="lyric-delay"]',
			) as HTMLInputElement;
			const lyricDelayLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-delay-label"]',
			) as HTMLElement;
			const lyricDelayInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-delay-info"]',
			) as HTMLButtonElement;
			lyricDelayInfo.addEventListener("click", () => {
				showModal("ディレイ送りの解説", LYRIC_DELAY_INFO_HTML);
			});
			const lyricGender = lyricDiv.querySelector(
				'[data-dtm="lyric-gender"]',
			) as HTMLInputElement;
			const lyricGenderLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-gender-label"]',
			) as HTMLElement;
			const lyricGenderInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-gender-info"]',
			) as HTMLButtonElement;
			lyricGenderInfo.addEventListener("click", () => {
				showModal("ジェンダーの解説", GENDER_INFO_HTML);
			});
			const lyricBreathiness = lyricDiv.querySelector(
				'[data-dtm="lyric-breathiness"]',
			) as HTMLInputElement;
			const lyricBreathinessLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-breathiness-label"]',
			) as HTMLElement;
			const lyricBreathinessInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-breathiness-info"]',
			) as HTMLButtonElement;
			lyricBreathinessInfo.addEventListener("click", () => {
				showModal("ブレシネスの解説", BREATHINESS_INFO_HTML);
			});
			const lyricTension = lyricDiv.querySelector(
				'[data-dtm="lyric-tension"]',
			) as HTMLInputElement;
			const lyricTensionLabel = lyricDiv.querySelector(
				'[data-dtm="lyric-tension-label"]',
			) as HTMLElement;
			const lyricTensionInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-tension-info"]',
			) as HTMLButtonElement;
			lyricTensionInfo.addEventListener("click", () => {
				showModal("テンションの解説", TENSION_INFO_HTML);
			});
			const lyricVibrato = lyricDiv.querySelector(
				'[data-dtm="lyric-vibrato"]',
			) as HTMLInputElement;
			const lyricVibratoInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-vibrato-info"]',
			) as HTMLButtonElement;
			lyricVibratoInfo.addEventListener("click", () => {
				showModal("自動ビブラート解説", VIBRATO_INFO_HTML);
			});
			const lyricOctaveUnison = lyricDiv.querySelector(
				'[data-dtm="lyric-octave-unison"]',
			) as HTMLSelectElement;
			const lyricOctaveUnisonInfo = lyricDiv.querySelector(
				'[data-dtm="lyric-octave-unison-info"]',
			) as HTMLButtonElement;
			lyricOctaveUnisonInfo.addEventListener("click", () => {
				showModal("オクターブユニゾン解説", OCTAVE_UNISON_INFO_HTML);
			});
			const lyricTerms = lyricDiv.querySelector(
				'[data-dtm="lyric-terms"]',
			) as HTMLElement;
			const lyricTermsLink = lyricDiv.querySelector(
				'[data-dtm="lyric-terms-link"]',
			) as HTMLAnchorElement;
			const lyricCustom = lyricDiv.querySelector(
				'[data-dtm="lyric-custom"]',
			) as HTMLElement;
			const lyricCustomSrc = lyricDiv.querySelector(
				'[data-dtm="lyric-custom-src"]',
			) as HTMLInputElement;
			const lyricCustomIcon = lyricDiv.querySelector(
				'[data-dtm="lyric-custom-icon"]',
			) as HTMLInputElement;
			const lyricCustomGuide = lyricDiv.querySelector(
				'[data-dtm="lyric-custom-guide"]',
			) as HTMLButtonElement;
			const lyricCustomNote = lyricDiv.querySelector(
				'[data-dtm="lyric-custom-note"]',
			) as HTMLElement;
			const lyricCustomApply = lyricDiv.querySelector(
				'[data-dtm="lyric-custom-apply"]',
			) as HTMLButtonElement;
			// 定位ラベル: 64=C / 左寄りは L<量> / 右寄りは R<量>
			const fmtPan = (pan: number): string =>
				pan === 64 ? "C" : pan < 64 ? `L${64 - pan}` : `R${pan - 64}`;
			// 選択肢: なし(空＝無効、既定) + 既知モデル + 読込MML由来 of 非標準モデル（往復維持）
			const addOpt = (
				parent: HTMLElement,
				value: string,
				label: string,
			): void => {
				const o = document.createElement("option");
				o.value = value;
				o.textContent = label;
				parent.appendChild(o);
			};
			addOpt(lyricModelSel, "", "ボーカルなし");

			// カテゴリごとに optgroup を作成して追加
			for (const cat of LYRIC_MODEL_CATEGORIES) {
				const group = document.createElement("optgroup");
				group.label = cat.label;
				for (const m of cat.models) {
					addOpt(group, m, lyricModelLabel(m, customVocalsMap));
				}
				lyricModelSel.appendChild(group);
			}

			// カスタム音声の optgroup
			const customGroup = document.createElement("optgroup");
			customGroup.label = "カスタム音声";

			// カスタムボーカル（MML・DawOptions・UI追加で登録済みのもの）
			for (const [k, def] of customVocalsMap) {
				addOpt(customGroup, k, def.label ?? k);
			}
			// URL指定でカスタム音声を登録する入力エリアを開く選択肢
			addOpt(customGroup, CUSTOM_VOCAL_ADD_VALUE, "カスタム音声を追加…");

			// 上記どちらにも含まれない非標準モデル（往復維持用）
			if (
				active.lyricModel &&
				!BASE_LYRIC_MODELS.includes(active.lyricModel) &&
				!customVocalsMap.has(active.lyricModel)
			) {
				addOpt(
					customGroup,
					active.lyricModel,
					lyricModelLabel(active.lyricModel, customVocalsMap),
				);
			}

			lyricModelSel.appendChild(customGroup);
			lyricModelSel.value = active.lyricModel;
			lyricOctaveSel.value = String(active.vocalOctave);
			// 値はプロパティ経由で設定（HTML文字列に混ぜず、</textarea>等の混入を防ぐ）
			lyricInput.value = active.lyrics;
			lyricVol.value = String(active.vocalVolume);
			lyricVolLabel.textContent = String(active.vocalVolume);
			lyricPan.value = String(active.vocalPan);
			lyricPanLabel.textContent = fmtPan(active.vocalPan);
			lyricReverb.value = String(active.vocalReverb);
			lyricReverbLabel.textContent = `${active.vocalReverb}%`;
			lyricDelay.value = String(active.vocalDelay);
			lyricDelayLabel.textContent = `${active.vocalDelay}%`;
			lyricGender.value = String(active.vocalGender);
			lyricGenderLabel.textContent = `${active.vocalGender}`;
			lyricBreathiness.value = String(active.vocalBreathiness);
			lyricBreathinessLabel.textContent = `${active.vocalBreathiness}`;
			lyricTension.value = String(active.vocalTension);
			lyricTensionLabel.textContent = `${active.vocalTension}`;
			lyricVibrato.checked = active.vocalVibrato;
			lyricOctaveUnison.value = active.vocalOctaveUnison;
			const updateLyricCount = (): void => {
				const n = normalizeLyrics(lyricInput.value).length;
				lyricCount.textContent = active.lyricModel && n > 0 ? `${n}音節` : "";
			};
			const syncLyricTerms = (): void => {
				// カスタムボーカルには利用規約情報がないため非表示
				if (customVocalsMap.has(active.lyricModel)) {
					lyricTerms.classList.add("dtm-hidden");
					return;
				}
				const url = active.lyricModel
					? KOE_VOICEBANK_TERMS[active.lyricModel]
					: undefined;
				if (url) {
					const label = lyricModelLabel(active.lyricModel, customVocalsMap);
					lyricTermsLink.textContent = `${label}UTAU音源`;
					lyricTermsLink.href = url;
					lyricTerms.classList.remove("dtm-hidden");
				} else {
					lyricTerms.classList.add("dtm-hidden");
				}
			};
			const syncLyricIcon = (): void => {
				if (!active.lyricModel) {
					lyricIcon.removeAttribute("src");
					lyricIcon.classList.add("dtm-hidden");
					return;
				}
				// カスタムボーカルなら iconUrl を使う（空文字 = フォールバック）
				const customDef = customVocalsMap.get(active.lyricModel);
				if (customDef !== undefined) {
					const iconSrc = customDef.iconUrl || FALLBACK_VOCAL_ICON;
					lyricIcon.src = iconSrc;
					lyricIcon.classList.remove("dtm-hidden");
					// 画像ロードエラー時（URL は有効でも画像が不正等）もフォールバック
					lyricIcon.onerror = () => {
						lyricIcon.onerror = null;
						lyricIcon.src = FALLBACK_VOCAL_ICON;
					};
					return;
				}
				// 内蔵ボーカルの場合は VOICE_IMAGE_KEY → VOICE_IMAGES を参照
				lyricIcon.onerror = null;
				const imgKey = VOICE_IMAGE_KEY[active.lyricModel.toLowerCase()];
				const src = imgKey ? VOICE_IMAGES[imgKey] : undefined;
				if (src) {
					lyricIcon.src = src;
					lyricIcon.classList.remove("dtm-hidden");
				} else {
					lyricIcon.removeAttribute("src");
					lyricIcon.classList.add("dtm-hidden");
				}
			};
			const syncLyricVisibility = (): void => {
				// 声量・詳細設定（オクターブ/定位/ビブラート/リバーブ送り/ジェンダー/ブレシネス）・
				// 歌詞欄は歌うときだけ意味を持つので、モデル「なし」ではまとめて隠す
				// （lyricBody 1箇所で切り替えれば、中の項目を増やしても隠し忘れが起きない）。
				lyricBody.style.display = active.lyricModel ? "" : "none";
				updateLyricCount();
				syncLyricTerms();
				syncLyricIcon();
			};
			syncLyricVisibility();
			lyricModelSel.addEventListener("change", () => {
				if (lyricModelSel.value === CUSTOM_VOCAL_ADD_VALUE) {
					// モデルはまだ変えず、URL入力エリアだけ開く（「追加」で確定）
					// 直前に選択していたモデルのアイコン・利用規約が残らないよう隠す
					lyricCustomNote.textContent = "";
					lyricCustom.classList.remove("dtm-hidden");
					lyricIcon.removeAttribute("src");
					lyricIcon.classList.add("dtm-hidden");
					lyricTerms.classList.add("dtm-hidden");
					return;
				}
				lyricCustom.classList.add("dtm-hidden");
				active.lyricModel = lyricModelSel.value;
				syncLyricVisibility();
				syncInstDisabled();
				syncVelocityDisabled();
				fireLyricsChange(active);
				reloadVoicesForModel(active.lyricModel);
			});
			lyricCustomGuide.addEventListener("click", () => {
				showModal("カスタム音声(.koe)の使い方", KOE_INFO_HTML);
			});
			lyricCustomApply.addEventListener("click", () => {
				const src = lyricCustomSrc.value.trim();
				if (!isValidHttpUrl(src)) {
					lyricCustomNote.textContent =
						"音声URLが不正です（http/httpsのみ・2048文字まで）";
					return;
				}
				const iconRaw = lyricCustomIcon.value.trim();
				const iconUrl = isValidHttpUrl(iconRaw) ? iconRaw : "";
				// 同じ音声URLが登録済みならそのキーを使い回す（重複登録を防ぐ）
				const existing = [...customVocalsMap.values()].find(
					(d) => d.url === src,
				);
				let key: string;
				if (existing) {
					key = existing.key;
				} else {
					// 音声URLのファイル名から識別子を自動生成する（衝突時は連番を付与）
					const derived = deriveCustomVocalKeyFromUrl(src);
					if (derived && !BASE_LYRIC_MODELS.includes(derived)) {
						if (!customVocalsMap.has(derived)) {
							key = derived;
						} else {
							let n = 2;
							while (customVocalsMap.has(`${derived}${n}`)) n++;
							key = `${derived}${n}`;
						}
					} else {
						key = genCustomVocalKey();
					}
				}
				registerCustomVocal({
					key,
					iconUrl: iconUrl || (existing?.iconUrl ?? ""),
					url: src,
					label: existing?.label,
				});
				active.lyricModel = key;
				fireLyricsChange(active);
				// プルダウンへ新キーを反映し、選択状態でパネルを再描画する
				updateTrackPanel();
				reloadVoicesForModel(key);
			});
			lyricOctaveSel.addEventListener("change", () => {
				active.vocalOctave = Number.parseInt(lyricOctaveSel.value, 10);
				fireLyricsChange(active);
			});
			lyricVibrato.addEventListener("change", () => {
				active.vocalVibrato = lyricVibrato.checked;
				fireLyricsChange(active);
			});
			lyricOctaveUnison.addEventListener("change", () => {
				active.vocalOctaveUnison = lyricOctaveUnison.value as OctaveUnisonMode;
				fireLyricsChange(active);
			});
			lyricInput.addEventListener("input", () => {
				active.lyrics = lyricInput.value;
				updateLyricCount();
				fireLyricsChange(active);
			});
			lyricVol.addEventListener("input", () => {
				active.vocalVolume = Number.parseInt(lyricVol.value, 10);
				lyricVolLabel.textContent = lyricVol.value;
				fireLyricsChange(active);
			});
			lyricPan.addEventListener("input", () => {
				active.vocalPan = Number.parseInt(lyricPan.value, 10);
				lyricPanLabel.textContent = fmtPan(active.vocalPan);
				fireLyricsChange(active);
			});
			// モバイルでスライダーをちょうど中央に合わせるのは難しいため、ラベルタップで中央へ戻す
			lyricPanLabel.style.cursor = "pointer";
			lyricPanLabel.title = "タップで中央(C)へ";
			lyricPanLabel.addEventListener("click", () => {
				active.vocalPan = 64;
				lyricPan.value = "64";
				lyricPanLabel.textContent = fmtPan(64);
				fireLyricsChange(active);
			});
			lyricReverb.addEventListener("input", () => {
				active.vocalReverb = Number.parseInt(lyricReverb.value, 10);
				lyricReverbLabel.textContent = `${active.vocalReverb}%`;
				fireLyricsChange(active);
			});
			lyricDelay.addEventListener("input", () => {
				active.vocalDelay = Number.parseInt(lyricDelay.value, 10);
				lyricDelayLabel.textContent = `${active.vocalDelay}%`;
				fireLyricsChange(active);
			});
			lyricGender.addEventListener("input", () => {
				active.vocalGender = Number.parseInt(lyricGender.value, 10);
				lyricGenderLabel.textContent = `${active.vocalGender}`;
				fireLyricsChange(active);
			});
			lyricBreathiness.addEventListener("input", () => {
				active.vocalBreathiness = Number.parseInt(lyricBreathiness.value, 10);
				lyricBreathinessLabel.textContent = `${active.vocalBreathiness}`;
				fireLyricsChange(active);
			});
			lyricTension.addEventListener("input", () => {
				active.vocalTension = Number.parseInt(lyricTension.value, 10);
				lyricTensionLabel.textContent = `${active.vocalTension}`;
				fireLyricsChange(active);
			});
		}

		if (active.config.id === "chord" && showChord) {
			const div = document.createElement("div");
			div.className = "dtm-row";
			div.style.flexDirection = "column";
			div.style.alignItems = "stretch";
			div.innerHTML = `
        <div class="dtm-row" style="justify-content: space-between; align-items: center;">
          <div style="display: inline-flex; align-items: center; gap: 6px;">
            <span class="dtm-label">和音</span>
            <button class="dtm-infobtn" data-dtm="chord-info" title="コード進行の書き方解説">${icon("info", 12)}</button>
            ${
							showMidiSearch
								? `<button class="dtm-btn dtm-btn--ghost" data-dtm="chord-search" title="コード進行検索" style="min-height: 24px; min-width: auto; height: 24px; padding: 0 6px; font-size: 11px; display: inline-flex; align-items: center;">コード検索</button>`
								: ""
						}
          </div>
          <select class="dtm-select" data-dtm="chord-pattern">
            <option value="block">ブロック</option>
            <option value="arpeggio">アルペジオ</option>
            <option value="arpeggio-fast">アルペジオ（ジャラーン）</option>
            <option value="offbeat">裏打ち</option>
            <option value="yatsume">ヤツメ穴</option>
            <option value="alternating">交互奏</option>
          </select>
        </div>
        <div class="dtm-row">
          <textarea class="dtm-textarea dtm-grow" data-dtm="chord-input" placeholder="例: C|G|Am|Em|F|C|F|G">${active.savedChordInput}</textarea>
          <button class="dtm-btn dtm-btn--primary" data-dtm="chord-apply">適用</button>
        </div>`;
			refs.trackBody.appendChild(div);
			const patternSel = div.querySelector(
				'[data-dtm="chord-pattern"]',
			) as HTMLSelectElement;
			const input = div.querySelector(
				'[data-dtm="chord-input"]',
			) as HTMLTextAreaElement;
			patternSel.value = active.savedChordPattern;
			const save = (): void => {
				active.savedChordInput = input.value;
				active.savedChordPattern = patternSel.value as ChordPatternType;
			};
			patternSel.addEventListener("change", save);
			input.addEventListener("input", save);
			(
				div.querySelector('[data-dtm="chord-info"]') as HTMLButtonElement
			).addEventListener("click", () => {
				showModal("コード進行の自動入力解説", CHORD_INFO_HTML);
			});
			(
				div.querySelector('[data-dtm="chord-apply"]') as HTMLButtonElement
			).addEventListener("click", () => {
				save();
				applyChord();
			});
			const searchChordBtn = div.querySelector(
				'[data-dtm="chord-search"]',
			) as HTMLButtonElement | null;
			if (searchChordBtn) {
				searchChordBtn.addEventListener("click", () => {
					openChordSearchModal(input);
				});
			}
		}
	};

	const switchTrack = (id: string): void => {
		activeTrackId = id;
		updateTrackPanel();
		updateUndoRedo();
		redrawAll();
	};

	const setToolMode = (mode: ToolMode): void => {
		activeToolMode = mode;
		for (const [btn, m] of [
			[refs.toolPen, "pen"],
			[refs.toolSelect, "select"],
			[refs.toolEraser, "eraser"],
		] as [HTMLButtonElement, ToolMode][]) {
			btn.classList.toggle("dtm-segbtn--active", m === mode);
		}
		if (mode !== "select") {
			selectionRect = null;
			selectedNotes = [];
		}
		redrawAll();
	};

	// ============================================================
	// MML / MIDI / コード / マクロ
	// ============================================================
	const generateMML = (): {
		full: string;
		minified: string;
		ignoredCount: number;
		trackCount: number;
		barLimit: number;
	} => {
		const barLimitBars = Number(refs.barLimitSelect.value);
		const limitSteps =
			barLimitBars > 0 ? barLimitBars * renderConfig.stepsPerBar : Infinity;
		const clipNotes = (notes: ReturnType<MMLCore["getNotes"]>) =>
			limitSteps === Infinity
				? notes
				: notes.filter((n) => n.startStep < limitSteps);

		// トラック個別楽器（空＝デフォルト/プリセットは出力しない）
		const trackInstrumentsForMeta: Record<number, string> = {};
		const trackCompressionForMeta: Record<number, number> = {};
		const trackWidthForMeta: Record<number, number> = {};
		const trackReverbSendForMeta: Record<number, number> = {};
		const trackEqLowForMeta: Record<number, number> = {};
		const trackEqMidForMeta: Record<number, number> = {};
		const trackEqHighForMeta: Record<number, number> = {};
		const trackPanForMeta: Record<number, number> = {};
		const trackDelaySendForMeta: Record<number, number> = {};
		trackStates.forEach((t, i) => {
			if (t.trackInstrument) trackInstrumentsForMeta[i] = t.trackInstrument;
			if (t.trackCompression !== 0)
				trackCompressionForMeta[i] = t.trackCompression;
			if (t.trackWidth !== 100) trackWidthForMeta[i] = t.trackWidth;
			if (t.trackReverbSend !== 0)
				trackReverbSendForMeta[i] = t.trackReverbSend;
			if (t.trackEqLow !== 0) trackEqLowForMeta[i] = t.trackEqLow;
			if (t.trackEqMid !== 0) trackEqMidForMeta[i] = t.trackEqMid;
			if (t.trackEqHigh !== 0) trackEqHighForMeta[i] = t.trackEqHigh;
			if (t.trackPan !== 64) trackPanForMeta[i] = t.trackPan;
			if (t.trackDelaySend !== 0) trackDelaySendForMeta[i] = t.trackDelaySend;
		});
		const trackInstMeta =
			Object.keys(trackInstrumentsForMeta).length > 0
				? trackInstrumentsForMeta
				: undefined;
		const trackCompMeta =
			Object.keys(trackCompressionForMeta).length > 0
				? trackCompressionForMeta
				: undefined;
		const trackWidthMeta =
			Object.keys(trackWidthForMeta).length > 0 ? trackWidthForMeta : undefined;
		const trackReverbSendMeta =
			Object.keys(trackReverbSendForMeta).length > 0
				? trackReverbSendForMeta
				: undefined;
		const trackEqLowMeta =
			Object.keys(trackEqLowForMeta).length > 0 ? trackEqLowForMeta : undefined;
		const trackEqMidMeta =
			Object.keys(trackEqMidForMeta).length > 0 ? trackEqMidForMeta : undefined;
		const trackEqHighMeta =
			Object.keys(trackEqHighForMeta).length > 0
				? trackEqHighForMeta
				: undefined;
		const trackPanMeta =
			Object.keys(trackPanForMeta).length > 0 ? trackPanForMeta : undefined;
		const trackDelaySendMeta =
			Object.keys(trackDelaySendForMeta).length > 0
				? trackDelaySendForMeta
				: undefined;

		// トップレベル宣言（楽器プリセット・ドラムパターン・全体音量・リバーブ・モード）。
		// トラックとは1対1でなく曲全体に効く。既定/未設定（楽器=空, ドラム="none"）の項目は出力しない。
		const metaLineFull = formatMmlMeta(
			{
				instrument: currentInstrument || undefined,
				drum: currentDrumPattern !== "none" ? currentDrumPattern : undefined,
				volume: masterVolume,
				drumVolume: drumVolume,
				reverb: reverbAmount,
				reverbDecay: Math.round(reverbDecay * 10),
				reverbPreDelay: reverbPreDelay,
				delay: delayAmount,
				delayDivision: delayDivision,
				masterCompression: masterCompression,
				fadeIn: Math.round(fadeInSec * 10),
				fadeOut: Math.round(fadeOutSec * 10),
				mode: mode,
				trackInstruments: trackInstMeta,
				trackCompression: trackCompMeta,
				trackWidth: trackWidthMeta,
				trackReverbSend: trackReverbSendMeta,
				trackEqLow: trackEqLowMeta,
				trackEqMid: trackEqMidMeta,
				trackEqHigh: trackEqHighMeta,
				trackPan: trackPanMeta,
				trackDelaySend: trackDelaySendMeta,
			},
			" ",
		);
		const metaLineMini = formatMmlMeta(
			{
				instrument: currentInstrument || undefined,
				drum: currentDrumPattern !== "none" ? currentDrumPattern : undefined,
				volume: masterVolume,
				drumVolume: drumVolume,
				reverb: reverbAmount,
				reverbDecay: Math.round(reverbDecay * 10),
				reverbPreDelay: reverbPreDelay,
				delay: delayAmount,
				delayDivision: delayDivision,
				masterCompression: masterCompression,
				fadeIn: Math.round(fadeInSec * 10),
				fadeOut: Math.round(fadeOutSec * 10),
				mode: mode,
				trackInstruments: trackInstMeta,
				trackCompression: trackCompMeta,
				trackWidth: trackWidthMeta,
				trackReverbSend: trackReverbSendMeta,
				trackEqLow: trackEqLowMeta,
				trackEqMid: trackEqMidMeta,
				trackEqHigh: trackEqHighMeta,
				trackPan: trackPanMeta,
				trackDelaySend: trackDelaySendMeta,
			},
			"",
		);

		if (refs.decomposeChordToggle.checked) {
			const ignoreHeavy = refs.ignoreChordHeavyToggle.checked;
			const targetStates = ignoreHeavy
				? trackStates.filter((t) => !isChordHeavyTrack(t.core.getNotes()))
				: trackStates;
			const ignoredCount = trackStates.length - targetStates.length;
			const allNotes = clipNotes(
				targetStates.flatMap((t) => t.core.getNotes()),
			);
			const monoTracks = decomposeToMonophonic(allNotes);
			const refCore = trackStates[0].core;
			const decomposedFull = monoTracks.map(
				(notes, i) =>
					`@${i} ${refCore.getMMLFromNotes(notes, bpm, 100).trim()}`,
			);
			const decomposedMini = monoTracks.map(
				(notes, i) =>
					`@${i}${refCore.getMMLFromNotes(notes, bpm, 100).trim().replace(/\s+/g, "")}`,
			);
			const full = [metaLineFull, ...decomposedFull, MML_END_MARKER]
				.filter((s) => s.length > 0)
				.join(";\n");
			const minified = [metaLineMini, ...decomposedMini, MML_END_MARKER]
				.filter((s) => s.length > 0)
				.join(";");
			return {
				full,
				minified,
				ignoredCount,
				trackCount: monoTracks.length,
				barLimit: barLimitBars,
			};
		}
		const trackLines: string[] = [];
		const trackLinesMini: string[] = [];

		trackStates.forEach((t, i) => {
			const notes = clipNotes(t.core.getNotes());
			if (notes.length > 0) {
				const mml = t.core.getMMLFromNotes(notes, bpm, t.volume).trim();
				trackLines.push(`@${i} ${mml}`);
				trackLinesMini.push(`@${i}${mml.replace(/\s+/g, "")}`);
			}
		});

		// 歌詞行（@@n model [v声量] [qゲート] [p定位] [oオクターブ] lyrics）。スペースは仕様上の区切りなのでminifyでも残す。
		// 声量・ゲート・定位・オクターブは既定(声量=DEFAULT_VOCAL_VOLUME, ゲート=100, 定位=64, オクターブ=0)でないときだけ v/q/p/o トークンで付与する。
		const lyricLines = trackStates
			.map((t, i) => ({
				i,
				notes: clipNotes(t.core.getNotes()),
				text: t.lyrics.replace(/[\r\n]+/g, " ").trim(),
				model: t.lyricModel.trim(),
				vol: t.vocalVolume,
				gate: t.vocalGate,
				pan: t.vocalPan,
				oct: t.vocalOctave,
				vib: t.vocalVibrato,
				rev: t.vocalReverb,
				del: t.vocalDelay,
				gen: t.vocalGender,
				bre: t.vocalBreathiness,
				ten: t.vocalTension,
				uni: t.vocalOctaveUnison,
			}))
			.filter(
				(x) => x.model.length > 0 && x.text.length > 0 && x.notes.length > 0,
			)
			.map((x) => {
				const params = [
					x.vol === DEFAULT_VOCAL_VOLUME ? "" : `v${x.vol}`,
					x.gate === 100 ? "" : `q${x.gate}`,
					x.pan === 64 ? "" : `p${x.pan}`,
					x.oct === 0 ? "" : `o${x.oct}`,
					x.vib ? "b1" : "",
					x.rev === 0 ? "" : `r${x.rev}`,
					x.del === 0 ? "" : `e${x.del}`,
					x.gen === 50 ? "" : `g${x.gen}`,
					x.bre === 50 ? "" : `h${x.bre}`,
					x.ten === 50 ? "" : `t${x.ten}`,
					OCTAVE_UNISON_TOKEN[x.uni],
				]
					.filter((s) => s.length > 0)
					.join(" ");
				const head = params ? `${x.model} ${params}` : x.model;
				return `@@${x.i} ${head} ${x.text}`;
			});

		// 実際に使われているカスタムボーカルの宣言行（@@key icon_url koe_url）を収集する。
		// 使われていない（＝lyricLines に出ない）カスタムボーカルは出力しない（MML をクリーンに保つ）。
		const customVocalDecls: string[] = [];
		for (const [key, def] of customVocalsMap) {
			const isUsed = trackStates.some(
				(t) =>
					t.lyricModel.trim().toLowerCase() === key &&
					t.lyrics.trim().length > 0 &&
					clipNotes(t.core.getNotes()).length > 0,
			);
			if (!isUsed) continue;
			const iconPart = def.iconUrl || "-";
			customVocalDecls.push(`@@${key} ${iconPart} ${def.url}`);
		}

		const full = [
			metaLineFull,
			...customVocalDecls,
			...trackLines,
			...lyricLines,
			MML_END_MARKER,
		]
			.filter((s) => s.length > 0)
			.join(";\n");
		const minified = [
			metaLineMini,
			...customVocalDecls,
			...trackLinesMini,
			...lyricLines,
			MML_END_MARKER,
		]
			.filter((s) => s.length > 0)
			.join(";");
		return {
			full,
			minified,
			ignoredCount: 0,
			trackCount: trackLines.length,
			barLimit: barLimitBars,
		};
	};

	const showMML = (): void => {
		const { full, minified, ignoredCount, trackCount, barLimit } =
			generateMML();
		refs.outputFull.textContent = full;
		refs.outputMini.textContent = minified;
		const isDecompose = refs.decomposeChordToggle.checked;
		const modeLabel = isDecompose ? "和音分解" : "通常";
		const ignoredLabel =
			ignoredCount > 0 ? ` / 伴奏${ignoredCount}トラック除外` : "";
		const barLabel = barLimit > 0 ? ` / 〜${barLimit}小節` : "";
		refs.outputStatus.textContent = `[${modeLabel}] (${trackCount}トラック${ignoredLabel}${barLabel}) 通常: ${full.length}文字 / minify: ${minified.length}文字`;
		refs.outputContainer.classList.remove("dtm-hidden");
		updateUndoRedo();
	};

	const getFirstDetectedPitch = (): number | null => {
		let minStep = Number.MAX_SAFE_INTEGER;
		let candidateNotes: Note[] = [];
		for (const t of trackStates) {
			for (const note of t.core.getNotes()) {
				if (note.startStep < minStep) {
					minStep = note.startStep;
					candidateNotes = [note];
				} else if (note.startStep === minStep) {
					candidateNotes.push(note);
				}
			}
		}
		if (candidateNotes.length === 0) return null;
		const sum = candidateNotes.reduce((acc, note) => acc + note.pitch, 0);
		return Math.round(sum / candidateNotes.length);
	};

	const centerPitch = (pitch: number): void => {
		const canvas = getGridCanvas();
		const yIndex =
			renderConfig.keyCount - 1 - (pitch - renderConfig.pitchRangeStart);
		const logicalY = yIndex * renderConfig.keyHeight;
		currentOffsetY = clamp(
			logicalY - (canvas.height - renderConfig.keyHeight) / 2,
			0,
			getMaxOffsetY(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);
	};

	const clearAll = (): void => {
		for (const t of trackStates) {
			t.core.resetHistory();
			t.core.clearNotesWithoutHistory();
		}
		redrawAll();
	};

	const loadMML = (mml: string): void => {
		if (!mml) return;
		stop();
		const applyActiveOnly = refs.applyActiveOnly?.checked ?? false;
		const activeTrackIndex = trackStates.findIndex(
			(t) => t.config.id === activeTrackId,
		);

		if (applyActiveOnly) {
			const active = getActive();
			active.core.clearNotesWithoutHistory();
			active.core.setLoadMode(true);
		} else {
			clearAll();
			for (const t of trackStates) t.core.setLoadMode(true);
		}

		// カスタムボーカル辞書を静的登録（DawOptions.customVocals）だけへ戻してから、
		// このMMLの宣言行で上書きする（前に読んだ曲のカスタム音声を持ち越さない）
		if (!applyActiveOnly) {
			resetCustomVocals();
			for (const def of parseCustomVocals(mml)) registerCustomVocal(def);
		}

		const {
			placements,
			bpm: parsedBpm,
			lyrics,
			meta,
			mergedTrackCount,
			trackVelocity,
		} = parseMML(mml, {
			stepsPerBar: renderConfig.stepsPerBar,
			collectLyrics: true,
			// このDAWのトラック数を超えるチャンネルはベースへ畳み込む（従来挙動）
			clampTrackCount: trackStates.length,
		});
		// トップレベル宣言（楽器プリセット・ドラムパターン・全体音量）を復元する
		if (!applyActiveOnly) {
			if (meta.instrument && INSTRUMENT_PRESETS[meta.instrument]) {
				currentInstrument = meta.instrument;
				options.onInstrumentChange?.(meta.instrument);
			}
			if (meta.drumFont) {
				currentDrumFont = meta.drumFont;
				refs.drumFontSelect.value = meta.drumFont;
				options.onDrumFontChange?.(meta.drumFont);
			}
			if (meta.drum && drumPatterns[meta.drum]) {
				currentDrumPattern = meta.drum;
				refs.drumSelect.value = meta.drum;
				options.onDrumChange?.(meta.drum);
			}
			if (meta.volume !== undefined) {
				masterVolume = meta.volume;
				refs.masterVolume.value = String(meta.volume);
				refs.masterVolumeLabel.textContent = `${meta.volume}%`;
			}
			if (meta.drumVolume !== undefined) {
				drumVolume = meta.drumVolume;
				refs.drumVolume.value = String(meta.drumVolume);
				refs.drumVolumeLabel.textContent = `${drumVolume}%`;
			}
			if (meta.reverb !== undefined) {
				reverbAmount = meta.reverb;
				refs.reverbAmount.value = String(meta.reverb);
				refs.reverbAmountLabel.textContent = `${meta.reverb}%`;
				options.onReverbChange?.(meta.reverb);
			}
			if (meta.reverbDecay !== undefined) {
				reverbDecay = meta.reverbDecay / 10;
				refs.reverbDecay.value = String(meta.reverbDecay);
				refs.reverbDecayLabel.textContent = `${reverbDecay.toFixed(1)}s`;
				options.onReverbDecayChange?.(reverbDecay);
			}
			if (meta.reverbPreDelay !== undefined) {
				reverbPreDelay = meta.reverbPreDelay;
				refs.reverbPreDelay.value = String(meta.reverbPreDelay);
				refs.reverbPreDelayLabel.textContent = `${meta.reverbPreDelay}ms`;
				options.onReverbPreDelayChange?.(reverbPreDelay);
			}
			if (meta.delay !== undefined) {
				delayAmount = meta.delay;
				refs.delayAmount.value = String(meta.delay);
				refs.delayAmountLabel.textContent = `${meta.delay}%`;
				options.onDelayChange?.(meta.delay);
			}
			if (
				meta.delayDivision &&
				["4", "8", "8d", "16"].includes(meta.delayDivision)
			) {
				delayDivision = meta.delayDivision as DelayDivision;
				refs.delayDivision.value = delayDivision;
				options.onDelayDivisionChange?.(delayDivision);
			}
			if (meta.masterCompression !== undefined) {
				masterCompression = meta.masterCompression;
				refs.masterComp.value = String(meta.masterCompression);
				refs.masterCompLabel.textContent = `${meta.masterCompression}%`;
				options.onMasterCompressionChange?.(meta.masterCompression);
			}
			if (meta.fadeIn !== undefined) {
				fadeInSec = meta.fadeIn / 10;
				refs.fadeIn.value = String(fadeInSec);
				refs.fadeInLabel.textContent = `${fadeInSec.toFixed(1)}s`;
			}
			if (meta.fadeOut !== undefined) {
				fadeOutSec = meta.fadeOut / 10;
				refs.fadeOut.value = String(fadeOutSec);
				refs.fadeOutLabel.textContent = `${fadeOutSec.toFixed(1)}s`;
			}
		}
		// トラック個別楽器を復元する（URLエンコーダがスペースを除去するため正規化して復元）
		trackStates.forEach((t, i) => {
			if (applyActiveOnly && i !== activeTrackIndex) return;
			const name = normalizeInstrumentName(meta.trackInstruments?.[i] ?? "");
			if (t.trackInstrument !== name) {
				t.trackInstrument = name;
				options.onTrackInstrumentChange?.(i, name);
			}
		});
		// トラック個別の音圧強化・ステレオ幅を復元する
		trackStates.forEach((t, i) => {
			if (applyActiveOnly && i !== activeTrackIndex) return;
			const comp = meta.trackCompression?.[i] ?? 0;
			if (t.trackCompression !== comp) {
				t.trackCompression = comp;
				options.onTrackCompressionChange?.(t.config.id, comp);
			}
			const width = meta.trackWidth?.[i] ?? 100;
			if (t.trackWidth !== width) {
				t.trackWidth = width;
				options.onTrackWidthChange?.(t.config.id, width);
			}
			const reverbSend = meta.trackReverbSend?.[i] ?? 0;
			if (t.trackReverbSend !== reverbSend) {
				t.trackReverbSend = reverbSend;
				options.onTrackReverbSendChange?.(t.config.id, reverbSend);
			}
			const eqLow = meta.trackEqLow?.[i] ?? 0;
			if (t.trackEqLow !== eqLow) {
				t.trackEqLow = eqLow;
				options.onTrackEqLowChange?.(t.config.id, eqLow);
			}
			const eqMid = meta.trackEqMid?.[i] ?? 0;
			if (t.trackEqMid !== eqMid) {
				t.trackEqMid = eqMid;
				options.onTrackEqMidChange?.(t.config.id, eqMid);
			}
			const eqHigh = meta.trackEqHigh?.[i] ?? 0;
			if (t.trackEqHigh !== eqHigh) {
				t.trackEqHigh = eqHigh;
				options.onTrackEqHighChange?.(t.config.id, eqHigh);
			}
			const pan = meta.trackPan?.[i] ?? 64;
			if (t.trackPan !== pan) {
				t.trackPan = pan;
				options.onTrackPanChange?.(t.config.id, pan);
			}
			const delaySend = meta.trackDelaySend?.[i] ?? 0;
			if (t.trackDelaySend !== delaySend) {
				t.trackDelaySend = delaySend;
				options.onTrackDelaySendChange?.(t.config.id, delaySend);
			}
		});
		// トラックごとの v（ベロシティ）を復元する（GUIのベロシティスライダーに反映）
		trackStates.forEach((t, i) => {
			if (applyActiveOnly && i !== activeTrackIndex) return;
			const v = trackVelocity.get(i);
			if (v !== undefined && v !== t.volume) {
				t.volume = v;
				t.core.setVolume(v);
			}
		});

		// 歌詞トラック（@@n）を各トラックの歌詞入力へ復元する（編集UIに反映）。
		// 表示用かなは正規化済み音節を結合したもの（長音は母音かなに展開済み）。
		if (applyActiveOnly) {
			const active = getActive();
			active.lyrics = "";
			active.lyricModel = ""; // 既定は「なし」（歌わない）
			active.vocalVolume = DEFAULT_VOCAL_VOLUME;
			active.vocalGate = 100;
			active.vocalPan = 64;
			active.vocalOctave = 0;
			active.vocalVibrato = false;
			active.vocalReverb = 0;
			active.vocalDelay = 0;
			active.vocalGender = 50;
			active.vocalBreathiness = 50;
			active.vocalTension = 50;
			active.vocalOctaveUnison = "none";
		} else {
			for (const t of trackStates) {
				t.lyrics = "";
				t.lyricModel = ""; // 既定は「なし」（歌わない）
				t.vocalVolume = DEFAULT_VOCAL_VOLUME;
				t.vocalGate = 100;
				t.vocalPan = 64;
				t.vocalOctave = 0;
				t.vocalVibrato = false;
				t.vocalReverb = 0;
				t.vocalDelay = 0;
				t.vocalGender = 50;
				t.vocalBreathiness = 50;
				t.vocalTension = 50;
				t.vocalOctaveUnison = "none";
			}
		}
		lyrics?.forEach((lt) => {
			if (applyActiveOnly && lt.trackId !== activeTrackIndex) return;
			const t = trackStates[lt.trackId];
			if (!t) return;
			t.lyrics = lt.syllables.map((s) => s.kana).join("");
			t.lyricModel = lt.model;
			t.vocalVolume = lt.volume;
			t.vocalGate = lt.gate;
			t.vocalPan = lt.pan;
			t.vocalOctave = lt.octave ?? 0;
			t.vocalVibrato = lt.vibrato ?? false;
			t.vocalReverb = lt.reverb ?? 0;
			t.vocalDelay = lt.delay ?? 0;
			t.vocalGender = lt.gender ?? 50;
			t.vocalBreathiness = lt.breathiness ?? 50;
			t.vocalTension = lt.tension ?? 50;
			t.vocalTension = lt.tension ?? 50;
			t.vocalOctaveUnison = lt.octaveUnison ?? "none";
		});
		// 注意: p.velocity は generateMML がトラック全体に単一の v ヘッダーしか出力しないため、
		// そのトラックの「ベロシティ」スライダー値（上で trackVelocity から t.volume へ復元済み）が
		// 全ノートへ均一にコピーされたものに過ぎない。ここでも p.velocity をノート速度として使うと
		// 発音式 (trackVol/100)*(velocity/127) が同じ値を二重に掛け合わせてしまい、
		// スライダーが既定の100から離れるほど再生音量が二乗的に小さくなるバグになる。
		// そのため、MML読込直後のノート速度は既定値へ戻し、トラック音量側だけに反映させる。
		for (const p of placements) {
			if (applyActiveOnly && p.trackIndex !== activeTrackIndex) continue;
			const t = trackStates[p.trackIndex];
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
				velocity: DEFAULT_VELOCITY,
			});
		}
		if (!applyActiveOnly && parsedBpm) setBpm(parsedBpm);
		const targets = applyActiveOnly ? [getActive()] : trackStates;
		for (const t of targets) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		const firstPitch = getFirstDetectedPitch();
		if (firstPitch !== null) {
			centerPitch(firstPitch);
		} else {
			centerPitch(48);
		}
		redrawAll();
		updateTrackPanel(); // 読み込んだ歌詞を編集UIへ反映
		updateUndoRedo();
		// シンプルモードでは4トラックを超えるチャンネルが伴奏へ畳み込まれ合算される。
		// 起きたときだけ控えめにお知らせする（advancedモードは1:1なので出さない）。
		if (!isAdvanced && mergedTrackCount > 0) {
			refs.mmlLoadNote.textContent =
				"シンプルモードのため、一部のトラックを合算して読み込みました";
			refs.mmlLoadNote.classList.remove("dtm-hidden");
		} else {
			refs.mmlLoadNote.textContent = "";
			refs.mmlLoadNote.classList.add("dtm-hidden");
		}
	};

	const applyChord = (): void => {
		const active = getActive();
		const chordTrack = trackStates.find((t) => t.config.id === "chord");
		if (!chordTrack) return;
		const placements = buildChordPlacements({
			chordStr: active.savedChordInput,
			patternType: active.savedChordPattern,
			rootShift: active.savedChordRoot,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
		});
		chordTrack.core.clearNotesWithoutHistory();
		chordTrack.core.beginBatch();
		for (const p of placements) {
			chordTrack.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: Math.max(1, p.durationSteps),
				velocity: p.velocity,
			});
		}
		chordTrack.core.endBatch();
		chordTrack.core.addHistoryOnce();
		redrawAll();
	};

	const loadMIDI = async (bytes: Uint8Array): Promise<void> => {
		if (!options.parseMidi) return;
		const midi = await options.parseMidi(bytes);
		const analysis = analyzeMidiTracks(midi);
		const selected = analysis.filter((a) => a.selected).map((a) => a.index);
		applyMidiSelection(midi, selected);
	};

	const applyMidiSelection = (
		midi: unknown,
		selectedIndices: number[],
	): void => {
		stop();
		const applyActiveOnly = refs.applyActiveOnly?.checked ?? false;

		if (applyActiveOnly) {
			const active = getActive();
			active.core.clearNotesWithoutHistory();
			active.core.setLoadMode(true);
			active.lyrics = "";
			active.lyricModel = "";
			active.vocalVolume = DEFAULT_VOCAL_VOLUME;
			active.vocalGate = 100;
			active.vocalPan = 64;
			active.vocalOctave = 0;
			active.vocalVibrato = false;
			active.vocalReverb = 0;
			active.vocalDelay = 0;
			active.vocalGender = 50;
			active.vocalBreathiness = 50;
			active.vocalTension = 50;
			active.vocalOctaveUnison = "none";
		} else {
			clearAll();
			for (const t of trackStates) t.core.setLoadMode(true);
			// MIDI入力には歌詞情報がないので全トラックの歌詞を初期化する
			for (const t of trackStates) {
				t.lyrics = "";
				t.lyricModel = "";
				t.vocalVolume = DEFAULT_VOCAL_VOLUME;
				t.vocalGate = 100;
				t.vocalPan = 64;
				t.vocalOctave = 0;
				t.vocalVibrato = false;
				t.vocalReverb = 0;
				t.vocalDelay = 0;
				t.vocalGender = 50;
				t.vocalBreathiness = 50;
				t.vocalTension = 50;
				t.vocalOctaveUnison = "none";
			}
		}

		// advancedモードはMIDIトラックインデックスで1:1マッピング、simpleは役割別に自動分類
		const { placements, bpm: parsedBpm } = isAdvanced
			? extractMidiPlacementsByTrack(
					midi,
					selectedIndices,
					trackStates.map((t) => t.config.id),
				)
			: extractMidiPlacements(midi, selectedIndices);
		for (const p of placements) {
			if (applyActiveOnly && p.trackId !== activeTrackId) continue;
			const t = trackStates.find((ts) => ts.config.id === p.trackId);
			if (!t) continue;
			t.core.addNote(p.startStep, p.pitch, {
				noteLengthSteps: p.durationSteps,
				velocity: p.velocity,
			});
		}
		if (!applyActiveOnly) setBpm(Math.round(parsedBpm));
		const targets = applyActiveOnly ? [getActive()] : trackStates;
		for (const t of targets) {
			t.core.setLoadMode(false);
			t.core.addHistoryOnce();
		}
		playStartStep = 0;
		currentOffsetX = 0;
		const firstPitch = getFirstDetectedPitch();
		if (firstPitch !== null) {
			centerPitch(firstPitch);
		} else {
			centerPitch(48);
		}
		redrawAll();
		updateTrackPanel();
		updateUndoRedo();
	};

	const exportMIDI = (): Blob =>
		exportMIDIBlob({
			tracks: trackStates.map((t) => ({
				notes: t.core.getNotes(),
				volume: t.volume,
			})),
			getDrumPattern: (currentBar) =>
				resolveDrumPattern(currentDrumPattern, drumPatterns, currentBar),
			drumVolume,
			bpm,
			stepsPerBar: renderConfig.stepsPerBar,
		});

	const setBpm = (value: number): void => {
		bpm = value;
		refs.bpmInput.value = String(value);
		for (const t of trackStates) t.core.setTempo(value);
		options.onBpmChange?.(value);
	};

	// ============================================================
	// undo / redo / copy / paste
	// ============================================================
	let lastUndoTime = 0;
	const undo = (): void => {
		const now = Date.now();
		if (now - lastUndoTime < 100) return;
		lastUndoTime = now;
		getActive().core.undo();
		redrawAll();
		updateUndoRedo();
	};
	const redo = (): void => {
		getActive().core.redo();
		redrawAll();
		updateUndoRedo();
	};

	// ============================================================
	// イベント配線
	// ============================================================
	const overlayDuring = (fn: () => void): void => {
		refs.overlay.hidden = false;
		setLoading(true);

		// 固定位置のモーダルローディング表示を追加
		const globalOverlay = document.createElement("div");
		globalOverlay.className = "dtm-overlay";
		globalOverlay.style.position = "fixed";
		globalOverlay.style.zIndex = "99999";
		const spinner = document.createElement("div");
		spinner.className = "dtm-spinner";
		const fill = document.createElement("i");
		fill.className = "dtm-spinner-fill";
		spinner.appendChild(fill);
		globalOverlay.appendChild(spinner);
		const label = document.createElement("div");
		label.className = "dtm-loading-label";
		label.textContent = "処理中...";
		globalOverlay.appendChild(label);
		document.body.appendChild(globalOverlay);

		setTimeout(() => {
			try {
				fn();
			} finally {
				refs.overlay.hidden = true;
				setLoading(false);
				globalOverlay.remove();
			}
		}, 30);
	};

	// Promise で yes/no を返す確認ダイアログ（wireEvents/wireMidi の両方から使う）
	const showConfirmModal = (message: string): Promise<boolean> =>
		new Promise((resolve) => {
			const overlay = document.createElement("div");
			overlay.className = "dtm-modal-overlay";
			overlay.innerHTML = `
				<div class="dtm-modal">
					<div class="dtm-modal-header">
						<span class="dtm-modal-title">モードの確認</span>
					</div>
					<div class="dtm-modal-body"><p>${message}</p></div>
					<div class="dtm-confirm-footer">
						<button class="dtm-btn dtm-btn--ghost dtm-confirm-no">いいえ（このまま読み込む）</button>
						<button class="dtm-btn dtm-btn--primary dtm-confirm-yes">はい（上級者モードに切り替える）</button>
					</div>
				</div>`;
			const close = (result: boolean): void => {
				overlay.remove();
				resolve(result);
			};
			(
				overlay.querySelector(".dtm-confirm-yes") as HTMLElement
			).addEventListener("click", () => close(true));
			(
				overlay.querySelector(".dtm-confirm-no") as HTMLElement
			).addEventListener("click", () => close(false));
			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) close(false);
			});
			document.body.appendChild(overlay);
		});

	const wireEvents = (): void => {
		refs.playBtn.addEventListener("click", togglePlay);
		refs.playBtn.disabled = false;
		refs.prevBarBtn.addEventListener("click", () => {
			const targetStep = Math.max(
				0,
				(Math.floor((getCurrentPlayStep() - 1) / renderConfig.stepsPerBar) -
					1) *
					renderConfig.stepsPerBar,
			);
			jumpTo(targetStep);
		});
		refs.nextBarBtn.addEventListener("click", () => {
			const targetStep =
				Math.floor(getCurrentPlayStep() / renderConfig.stepsPerBar + 1) *
				renderConfig.stepsPerBar;
			jumpTo(targetStep);
		});

		refs.soloCheckbox.addEventListener("change", () => {
			isSolo = refs.soloCheckbox.checked;
			redrawAll();
		});

		// 音割れ検知バッジ。マスタの安全リミッター手前が閾値を超えたら表示し、
		// クリックで手動リセットできる（自動でも一定時間で消える）。
		unsubscribeClip = options.clipMeter?.onClipChange((clipping) => {
			refs.clipBadge.classList.toggle("dtm-hidden", !clipping);
		});
		refs.clipBadge.addEventListener("click", () => {
			options.clipMeter?.reset();
		});

		refs.toolPen.addEventListener("click", () => setToolMode("pen"));
		refs.toolSelect.addEventListener("click", () => setToolMode("select"));
		refs.toolEraser.addEventListener("click", () => setToolMode("eraser"));
		refs.undoBtn.addEventListener("click", undo);
		refs.redoBtn.addEventListener("click", redo);

		refs.noteLengthSelect.addEventListener("change", () => {
			snapGridSteps = Number.parseInt(refs.noteLengthSelect.value, 10);
			currentInsertLength = snapGridSteps;
			redrawAll();
		});
		refs.bpmInput.addEventListener("input", () => {
			setBpm(Number.parseInt(refs.bpmInput.value, 10) || 120);
		});

		refs.zoomXIn.addEventListener("click", () => {
			zoomX = Math.min(200, zoomX + 25);
			applyZoomX();
			notifyViewState();
		});
		refs.zoomXOut.addEventListener("click", () => {
			zoomX = Math.max(25, zoomX - 25);
			applyZoomX();
			notifyViewState();
		});
		refs.zoomYIn.addEventListener("click", () => {
			zoomY = Math.min(200, zoomY + 25);
			applyZoomY();
			notifyViewState();
		});
		refs.zoomYOut.addEventListener("click", () => {
			zoomY = Math.max(50, zoomY - 25);
			applyZoomY();
			notifyViewState();
		});

		refs.bgUploadBtn.addEventListener("click", () => refs.bgFileInput.click());
		refs.bgFileInput.addEventListener("change", () => {
			const file = refs.bgFileInput.files?.[0];
			refs.bgFileInput.value = "";
			if (!file) return;
			// 静止ラスター画像のみリサイズ＋再圧縮する（GIF等アニメーション画像は劣化・アニメ破壊を避けるため無加工で保存）
			if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
				saveBgBlob(file)
					.then(() => applyRollBackground(file))
					.catch(() => {});
				return;
			}
			const objectUrl = URL.createObjectURL(file);
			const img = new Image();
			img.onload = () => {
				URL.revokeObjectURL(objectUrl);
				const maxW = refs.rollContainer.clientWidth || 800;
				const maxH = refs.rollContainer.clientHeight || 450;
				resizeImageToBlob(img, maxW, maxH)
					.then((blob) =>
						saveBgBlob(blob).then(() => applyRollBackground(blob)),
					)
					.catch(() => {});
			};
			img.src = objectUrl;
		});
		refs.bgRemoveBtn.addEventListener("click", () => {
			deleteBgBlob()
				.catch(() => {})
				.finally(() => applyRollBackground(null));
		});
		refs.bgOpacityInput.addEventListener("input", () => {
			const opacityVal = Number.parseInt(refs.bgOpacityInput.value, 10);
			applyBgOpacity(opacityVal);
			try {
				localStorage.setItem(BG_OPACITY_KEY, String(opacityVal));
			} catch (_) {}
		});

		// 和音分解モード / 和音伴奏トラック無視のチェック状態変化を通知（永続化用）
		refs.decomposeChordToggle.addEventListener("change", notifyViewState);
		refs.ignoreChordHeavyToggle.addEventListener("change", notifyViewState);

		refs.masterVolume.addEventListener("input", () => {
			masterVolume = Number.parseInt(refs.masterVolume.value, 10) || 0;
			refs.masterVolumeLabel.textContent = `${masterVolume}%`;
			options.singingVoices?.setVolume(masterVolume / 100);
		});
		refs.masterComp.addEventListener("input", () => {
			masterCompression = Number.parseInt(refs.masterComp.value, 10) || 0;
			refs.masterCompLabel.textContent = `${masterCompression}%`;
			options.onMasterCompressionChange?.(masterCompression);
		});
		refs.masterCompInfoBtn.addEventListener("click", () => {
			showModal("グルーコンプの解説", MASTER_COMP_INFO_HTML);
		});
		refs.reverbAmount.addEventListener("input", () => {
			reverbAmount = Number.parseInt(refs.reverbAmount.value, 10) || 0;
			refs.reverbAmountLabel.textContent = `${reverbAmount}%`;
			options.onReverbChange?.(reverbAmount);
		});
		refs.reverbAmountInfoBtn.addEventListener("click", () => {
			showModal("マスタリバーブの解説", MASTER_REVERB_INFO_HTML);
		});
		refs.reverbDecay.addEventListener("input", () => {
			const raw = Number.parseInt(refs.reverbDecay.value, 10) || 22;
			reverbDecay = Math.max(
				MIN_REVERB_DECAY_SEC,
				Math.min(MAX_REVERB_DECAY_SEC, raw / 10),
			);
			refs.reverbDecayLabel.textContent = `${reverbDecay.toFixed(1)}s`;
			options.onReverbDecayChange?.(reverbDecay);
		});
		refs.reverbPreDelay.addEventListener("input", () => {
			reverbPreDelay = Number.parseInt(refs.reverbPreDelay.value, 10) || 0;
			refs.reverbPreDelayLabel.textContent = `${reverbPreDelay}ms`;
			options.onReverbPreDelayChange?.(reverbPreDelay);
		});
		refs.delayAmount.addEventListener("input", () => {
			delayAmount = Number.parseInt(refs.delayAmount.value, 10) || 0;
			refs.delayAmountLabel.textContent = `${delayAmount}%`;
			options.onDelayChange?.(delayAmount);
		});
		refs.delayDivision.addEventListener("change", () => {
			delayDivision = refs.delayDivision.value as DelayDivision;
			options.onDelayDivisionChange?.(delayDivision);
		});
		refs.delayAmountInfoBtn.addEventListener("click", () => {
			showModal("マスタディレイの解説", MASTER_DELAY_INFO_HTML);
		});
		refs.fadeIn.addEventListener("input", () => {
			fadeInSec = Number.parseFloat(refs.fadeIn.value) || 0;
			refs.fadeInLabel.textContent = `${fadeInSec.toFixed(1)}s`;
		});
		refs.fadeOut.addEventListener("input", () => {
			fadeOutSec = Number.parseFloat(refs.fadeOut.value) || 0;
			refs.fadeOutLabel.textContent = `${fadeOutSec.toFixed(1)}s`;
		});
		refs.fadeInfoBtn.addEventListener("click", () => {
			showModal("フェードイン/アウトの解説", FADE_INFO_HTML);
		});
		refs.autoMasterInfoBtn.addEventListener("click", () => {
			showModal("おまかせマスタリング解説", AUTO_MASTER_INFO_HTML);
		});
		refs.autoMasterBtn.addEventListener("click", () => {
			// ゲインステージング（実測ベース）: 静的なノート情報だけでは「実際にどれだけ音圧が
			// 積み上がって鳴っているか」（複数トラックの重なり・コンプ後の値等）は分からないため、
			// 裏で溜めておいた実測ピーク（{@link startPeakSampling}）が十分あるときだけ、それを
			// 目標ヘッドルームに収まるようマスタ音量へ逆算して反映する。一度も再生していない・
			// 再生時間が短すぎる場合は判断材料が無いので触らない（下手に動かす方が危険なため）。
			if (observedPlayMs >= PEAK_SAMPLE_MIN_PLAY_MS && observedPeakMax > 0) {
				// 目標ピーク -6dBFS（≒0.5）。編集中の音源としては、この程度のヘッドルームを
				// 残しておくと安全リミッターに頼りきりにならず、後段のマスタリング・書き出しでも
				// 音割れしにくい。
				const targetPeak = 0.5;
				const scale = targetPeak / observedPeakMax;
				const suggested = clamp(Math.round(masterVolume * scale), 10, 100);
				if (suggested !== masterVolume) {
					masterVolume = suggested;
					refs.masterVolume.value = String(masterVolume);
					refs.masterVolumeLabel.textContent = `${masterVolume}%`;
					options.singingVoices?.setVolume(masterVolume / 100);
				}
				// 使い切ったら次の編集セッション分の実測を溜め直す（古いデータで判断し続けない）。
				observedPeakMax = 0;
				observedPlayMs = 0;
			}

			// マスタバスのグルーコンプレッサー: 各トラックの頭を軽く均して一体感を出す、
			// 定番の「グルー」量（25%程度＝穏やかに掛かる程度）を既定にする。強く掛けすぎると
			// ダイナミクスが失われるため、あくまで控えめな値にとどめる。
			masterCompression = 25;
			refs.masterComp.value = "25";
			refs.masterCompLabel.textContent = "25%";
			options.onMasterCompressionChange?.(25);

			// マスタリバーブ（Mix・Decay・Pre Delay）
			// Mixはアレンジの密度（実際に音が入っているトラック数）で決める: 音数が多い厚い
			// アレンジほど残響を薄く（重ねすぎると濁るため）、音数が少ない隙間の多い編成ほど
			// 残響で空間を埋める、というミキシングの定石。2トラック以下で28%、8トラック以上で
			// 12%を目安に線形補間する。
			const activeTrackCount = trackStates.filter(
				(t) => t.core.getNotes().length > 0,
			).length;
			const densityT = clamp((activeTrackCount - 2) / (8 - 2), 0, 1);
			reverbAmount = Math.round(28 - densityT * (28 - 12));
			refs.reverbAmount.value = String(reverbAmount);
			refs.reverbAmountLabel.textContent = `${reverbAmount}%`;
			options.onReverbChange?.(reverbAmount);

			// Decayはテンポに応じて決める: 速い曲は短め(0.6〜1.4s目安)、遅い曲は長め(1.8〜4.0s目安)。
			// BPM60を「遅い曲寄りの上限」、BPM180を「速い曲寄りの下限」とみなし線形補間する。
			const bpmT = clamp((bpm - 60) / (180 - 60), 0, 1);
			reverbDecay = clamp(
				3.0 - bpmT * (3.0 - 0.9),
				MIN_REVERB_DECAY_SEC,
				MAX_REVERB_DECAY_SEC,
			);
			refs.reverbDecay.value = String(Math.round(reverbDecay * 10));
			refs.reverbDecayLabel.textContent = `${reverbDecay.toFixed(1)}s`;
			options.onReverbDecayChange?.(reverbDecay);

			// Pre Delayは原音の輪郭を保ったまま奥行きを足す定番の量（既定20ms）。
			reverbPreDelay = 20;
			refs.reverbPreDelay.value = "20";
			refs.reverbPreDelayLabel.textContent = "20ms";
			options.onReverbPreDelayChange?.(20);

			// フェードアウト: 曲の終わりをぶつ切りにしない、という仕上げの基本。0秒（未設定）の
			// ときだけ、控えめな1.5秒を補う（明示的に0秒へ変更済み＝あえて唐突に終わらせたい、
			// という意図の可能性があるため、それ以外の値は上書きしない）。フェードインは曲頭からの
			// 再生時にしか掛からず気付きにくい割に効果も薄いため、ここでは対象にしない。
			if (fadeOutSec === 0) {
				fadeOutSec = 1.5;
				refs.fadeOut.value = "1.5";
				refs.fadeOutLabel.textContent = "1.5s";
			}

			// メインボーカル判定: 歌詞のあるトラックのうち、発音時間（ノートの合計durationSteps）が
			// 最大のものを「メインボーカル」とみなす。ハモリ・コーラス・掛け声等の副トラックより
			// 前に出したいので、そちらだけリバーブを控えめ・音圧強化をやや強めにして明瞭さを出す
			// （「前に出したい→リバーブ少なめ」という定石。奥に置きたい副ボーカルは逆にリバーブ多め）。
			let mainVocalId: string | null = null;
			let mainVocalScore = -1;
			let nonMainVocalCount = 0;
			for (const t of trackStates) {
				if (!t.lyricModel) continue;
				const score = t.core
					.getNotes()
					.reduce((sum, n) => sum + n.durationSteps, 0);
				if (score > mainVocalScore) {
					mainVocalScore = score;
					mainVocalId = t.config.id;
				}
			}
			for (const t of trackStates) {
				if (t.lyricModel && t.config.id !== mainVocalId) nonMainVocalCount++;
			}

			// 楽器・音量の自動割り当て: 歌詞トラックを除く各トラックのノート（音高・タイミング・
			// 和音の厚み）から役割（メロディ/サブメロ/ベース/伴奏）を推定し、現在選択中の
			// 楽器プリセット（未選択ならピアノ）からその役割に合う楽器名を引いて個別設定する。
			// simpleモードは元々トラック＝役割が固定なので実質的に見た目は変わらないが、
			// advancedモード（15トラック1:1）ではここが唯一の「楽器を自動で当てる」経路になる。
			const autoPreset =
				INSTRUMENT_PRESETS[currentInstrument] ?? INSTRUMENT_PRESETS.piano;
			// 判定できた役割をトラックIDごとに控えておき、下のチャンネルストリップ調整
			// （圧縮・幅・リバーブ送り・EQ）でも使い回す。
			const roleByTrackId = new Map<string, AutoRole>();
			for (const t of trackStates) {
				if (t.lyricModel) continue; // 歌声トラックは楽器を持たない
				const notes = t.core.getNotes();
				if (notes.length === 0) continue; // 音が無いトラックは判定不能なのでそのまま
				const stats = computeAutoRoleStats(notes);
				const role = classifyTrackRole(stats);
				roleByTrackId.set(t.config.id, role);
				const instName = autoPreset[role];
				t.trackInstrument = instName;
				const trackIndex = trackStates.indexOf(t);
				options.onTrackInstrumentChange?.(trackIndex, instName);
				const vol = computeAutoRoleVolume(role, stats);
				t.volume = vol;
				t.core.setVolume(vol);
			}

			// 役割ごとのパン（左右定位）オフセット。中央からの±値で、同じ役割が複数
			// トラックある場合（advancedモード等）は配列を巡回して左右へ振り分ける。
			// メロディ・ベースは曲の軸になるパートなので中央に固定（低域は特に、左右へ
			// 振ると位相干渉でモノラル再生時に痩せるため中央が定石）。サブメロ・伴奏は
			// 左右へ散らして各パートの居場所を分け、聞き取りやすくする。
			const AUTO_PAN_OFFSETS: Record<AutoRole, number[]> = {
				melody: [0],
				bass: [0],
				submelody: [18, -18, 30, -30],
				chord: [36, -36, 48, -48],
			};
			const panRoleCounter = new Map<AutoRole, number>();
			let vocalSideCounter = 0;
			for (const t of trackStates) {
				const isMainVocal = !!t.lyricModel && t.config.id === mainVocalId;
				const role = roleByTrackId.get(t.config.id);
				const roleMix = role ? AUTO_ROLE_MIX[role] : undefined;
				// パン: 楽器トラックは役割ベース、歌詞トラックはメインボーカルを中央に固定し、
				// ハモリ/コーラス等の副ボーカルは左右へ軽く振ってダブリング感を出す定石。
				let pan = 64;
				if (t.lyricModel) {
					pan = isMainVocal
						? 64
						: clamp(64 + (vocalSideCounter++ % 2 === 0 ? 22 : -22), 0, 127);
				} else if (role) {
					const offsets = AUTO_PAN_OFFSETS[role];
					const n = panRoleCounter.get(role) ?? 0;
					panRoleCounter.set(role, n + 1);
					pan = clamp(64 + offsets[n % offsets.length], 0, 127);
				}
				t.trackPan = pan;
				options.onTrackPanChange?.(t.config.id, pan);
				// 音圧強化は役割ごとの定石値（{@link AUTO_ROLE_MIX}）を使う。歌詞のあるトラック
				// （ボーカル）は強く潰すと表情が失われるため控えめにし、メインボーカルだけは
				// 明瞭さを出すためやや強めに掛ける（一般的なミックスの目安に準拠）。
				const comp = t.lyricModel
					? isMainVocal
						? 30
						: 25
					: (roleMix?.compression ?? 35);
				// ステレオ幅: リードボーカルは狭め・中央寄りでクリアに（モノラル再生時の
				// 互換性も保つ）、バッキングコーラスは広げて「壁」のような厚みを出す、
				// というボーカルミックスの定石。楽器は役割ごとの定石値を使う。
				const width = t.lyricModel
					? isMainVocal
						? 100
						: 120
					: (roleMix?.width ?? 115);
				t.trackCompression = comp;
				t.trackWidth = width;
				options.onTrackCompressionChange?.(t.config.id, comp);
				options.onTrackWidthChange?.(t.config.id, width);
				// EQ（低域/高域）: 帯域の住み分け（frequency slotting）。
				if (t.lyricModel) {
					// ボーカルは低域（ランブル・近接効果によるこもり）を削るのがほぼ普遍的な定石
					// （実質的なハイパスフィルタの代用）。リードはさらに高域を少し持ち上げて
					// 抜け・明瞭感（プレゼンス/エア）を足すが、コーラスは持ち上げない
					// （明るさ＝前に出る印象になるため、奥に置きたいコーラスでは持ち上げすぎない）。
					t.trackEqLow = -3;
					t.trackEqHigh = isMainVocal ? 2 : 0;
					options.onTrackEqLowChange?.(t.config.id, t.trackEqLow);
					options.onTrackEqHighChange?.(t.config.id, t.trackEqHigh);
				} else {
					// 楽器: ベースは低域を少し持ち上げ・高域を削り、他パートは低域を削って
					// ベースの居場所を空け、メロディ系は高域を少し持ち上げて抜けを出す。
					// 役割不明時は無変化(0)のまま。
					const eqLow = roleMix?.eqLow ?? 0;
					const eqHigh = roleMix?.eqHigh ?? 0;
					t.trackEqLow = eqLow;
					t.trackEqHigh = eqHigh;
					options.onTrackEqLowChange?.(t.config.id, eqLow);
					options.onTrackEqHighChange?.(t.config.id, eqHigh);
				}
				// リバーブは声だけ／楽器だけ、と偏らせず全体に軽く馴染ませる。ボーカルは
				// vocalReverb（音節単位の専用センド）に任せ、ここでは楽器トラックだけ
				// 役割ごとの送り量（伴奏は多め・ベースは少なめ）で送る（0だと「おまかせ」で
				// Mixを上げても楽器に何も掛からず不自然なため）。
				if (!t.lyricModel) {
					const reverbSend = roleMix?.reverbSend ?? 15;
					t.trackReverbSend = reverbSend;
					options.onTrackReverbSendChange?.(t.config.id, reverbSend);
					// ディレイ送り: 低域には掛けない定石でベース・伴奏は0、メロディ/サブメロに
					// だけ薄く送る（マスタディレイが既定オフのため、有効化したときだけ効く）。
					const delaySend = roleMix?.delaySend ?? 0;
					t.trackDelaySend = delaySend;
					options.onTrackDelaySendChange?.(t.config.id, delaySend);
				}
				// 歌詞のあるトラックだけビブラート・声量・ディレイ・リバーブ送りを調整する。
				// メインボーカルは主旋律として一番前に出したいので声量を上げ気味に、
				// ハモリ・コーラス等の副ボーカルは奥へ引かせるため下げる（前に出したい音は
				// 大きく・くっきり、奥に置きたい音は小さく・リバーブ多め、という定石）。
				// 副ボーカルが複数（コーラスの厚み）あるほど、重なって音圧が積み上がる分
				// 1トラックあたりは絞る（伴奏の和音を等パワー則で絞ったのと同じ考え方）。
				if (t.lyricModel) {
					// ビブラートはメインボーカルだけ。複数の声へ同時に掛けると、声ごとに
					// 揺れの位相・速さが微妙にズレて和音が「うねる」「濁る」「音程が不安定に
					// 聞こえる」ため、合唱・ストリングスのセクション奏法と同じくハモリ/コーラス
					// はストレートトーン（揺らさない）にして音程の軸を安定させるのが定石。
					t.vocalVibrato = isMainVocal;
					t.vocalReverb = isMainVocal ? 25 : 45;
					// ディレイもメロディ役割の楽器と同じ考え方（低域・伴奏には送らない）で、
					// リードボーカルの語尾にだけ軽いスラップディレイを仕込んでおく定番技法。
					// コーラスに掛けると輪郭がぼやけて団子になるため送らない。
					t.vocalDelay = isMainVocal ? 15 : 0;
					t.vocalVolume = isMainVocal
						? Math.round(DEFAULT_VOCAL_VOLUME * 1.1)
						: clamp(
								Math.round(
									(DEFAULT_VOCAL_VOLUME * 0.85) /
										Math.sqrt(Math.max(1, nonMainVocalCount)),
								),
								60,
								MAX_VOCAL_VOLUME,
							);
					fireLyricsChange(t);
				}
			}
			updateTrackPanel();
		});
		refs.drumSelect.addEventListener("change", () => {
			currentDrumPattern = refs.drumSelect.value;
			options.onDrumChange?.(currentDrumPattern);
		});
		refs.drumFontSelect.addEventListener("change", () => {
			currentDrumFont = refs.drumFontSelect.value;
			options.onDrumFontChange?.(currentDrumFont);
		});
		refs.drumVolume.addEventListener("input", () => {
			drumVolume = Number.parseInt(refs.drumVolume.value, 10) || 0;
			refs.drumVolumeLabel.textContent = `${drumVolume}%`;
		});

		// マクロ
		refs.macroClear.addEventListener("click", () => {
			overlayDuring(() => {
				const active = getActive();
				active.core.beginBatch();
				active.core.clearNotesWithoutHistory();
				active.core.endBatch();
				active.core.saveHistory();
				redrawAll();
			});
		});
		refs.macroRandom.addEventListener("click", () => {
			overlayDuring(() => {
				generateRandomPattern(getActive().core, {
					stepsPerBar: renderConfig.stepsPerBar,
					startStep: playStartStep,
					pitchRangeStart: renderConfig.pitchRangeStart,
				});
				redrawAll();
			});
		});
		refs.macroHarmonic.addEventListener("click", () => {
			overlayDuring(() => {
				const chord = trackStates.find((t) => t.config.id === "chord");
				if (!chord || activeTrackId === "chord") return;
				applyHarmonicFilter(getActive().core, chord.core, {
					stepsPerBar: renderConfig.stepsPerBar,
				});
				redrawAll();
			});
		});
		refs.macroMono.addEventListener("click", () => {
			overlayDuring(() => {
				const chord = trackStates.find((t) => t.config.id === "chord");
				if (!chord || activeTrackId === "chord") return;
				applyMonophonic(getActive().core, chord.core, {
					stepsPerBar: renderConfig.stepsPerBar,
				});
				redrawAll();
			});
		});

		// 出力
		refs.generateMmlBtn.addEventListener("click", showMML);
		refs.exportMidiBtn.addEventListener("click", () => {
			const blob = exportMIDI();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = "dtm.mid";
			a.click();
			URL.revokeObjectURL(url);
		});
		if (options.onExportWav) {
			refs.exportWavBtn.classList.remove("dtm-hidden");
			refs.exportWavBtn.addEventListener("click", () => {
				void options.onExportWav?.();
			});
		}
		const copy = (text: string, btn: HTMLButtonElement): void => {
			navigator.clipboard?.writeText(text);
			btn.classList.add("dtm-btn--success");
			setTimeout(() => btn.classList.remove("dtm-btn--success"), 1200);
		};
		refs.copyFullBtn.addEventListener("click", () =>
			copy(refs.outputFull.textContent ?? "", refs.copyFullBtn),
		);
		refs.copyMiniBtn.addEventListener("click", () =>
			copy(refs.outputMini.textContent ?? "", refs.copyMiniBtn),
		);

		// MML/MIDI入力
		refs.mmlLoadBtn.addEventListener("click", async () => {
			const mml = refs.mmlInput.value;
			if (!isAdvanced && options.onRequestAdvancedMode) {
				const { mergedTrackCount, meta } = parseMML(mml, {
					stepsPerBar: renderConfig.stepsPerBar,
					clampTrackCount: trackStates.length,
				});
				if (mergedTrackCount > 0 || meta.mode === "advanced") {
					const confirmed = await showConfirmModal(
						"初心者モードで読み込むと、音が崩れる可能性があります。<br>上級者モードに切り替えますか？",
					);
					if (confirmed) {
						options.onRequestAdvancedMode(mml);
						return;
					}
				}
			}
			overlayDuring(() => loadMML(mml));
		});

		// サンプル再生用状態変数
		let activeSamplePlayer: import("./mml-player").MmlPlayerInstance | null =
			null;
		let activeSampleButton: HTMLButtonElement | null = null;

		const collapseActiveSample = (): void => {
			if (activeSamplePlayer) {
				activeSamplePlayer.stop();
				activeSamplePlayer.destroy();
				activeSamplePlayer = null;
			}
			if (activeSampleButton) {
				activeSampleButton.textContent = "▶ 試聴";
				activeSampleButton.classList.remove("dtm-btn--danger");
				activeSampleButton.classList.add("dtm-btn--primary");
				const box = activeSampleButton.closest(".dtm-modal-sample-box");
				const container = box?.querySelector(
					".dtm-modal-sample-player-container",
				);
				if (container) container.innerHTML = "";
				activeSampleButton = null;
			}
		};

		// 解説モーダル初期化とイベントハンドラ
		showModal = (title: string, bodyHTML: string): void => {
			collapseActiveSample();
			collapseSearchPreview();

			refs.modalTitle.textContent = title;
			refs.modalBody.innerHTML = bodyHTML;
			refs.modalOverlay.removeAttribute("hidden");

			// コピーボタンのイベント接続
			const copyBtns = refs.modalBody.querySelectorAll(
				".dtm-modal-sample-copy-btn",
			);
			for (const btn of copyBtns) {
				btn.addEventListener("click", () => {
					const mml = btn.getAttribute("data-mml") || "";
					navigator.clipboard.writeText(mml).then(() => {
						const originalText = btn.textContent;
						btn.textContent = "✓ コピー完了";
						btn.classList.add("dtm-btn--success");
						setTimeout(() => {
							btn.textContent = originalText;
							btn.classList.remove("dtm-btn--success");
						}, 1200);
					});
				});
			}

			// 試聴ボタンのイベント接続
			const playBtns = refs.modalBody.querySelectorAll(
				".dtm-modal-sample-play-btn",
			);
			for (const btn of playBtns) {
				const htmlBtn = btn as HTMLButtonElement;
				htmlBtn.addEventListener("click", () => {
					const sampleBox = htmlBtn.closest(".dtm-modal-sample-box");
					const container = sampleBox?.querySelector(
						".dtm-modal-sample-player-container",
					) as HTMLElement;
					const mml = htmlBtn.getAttribute("data-mml") || "";

					if (activeSampleButton === htmlBtn) {
						if (activeSamplePlayer?.isPlaying()) {
							activeSamplePlayer.stop();
						} else {
							stop(); // メインエディタの再生を停止
							if (activeSamplePlayer) {
								activeSamplePlayer.play();
								htmlBtn.textContent = "■ 停止";
								htmlBtn.classList.remove("dtm-btn--primary");
								htmlBtn.classList.add("dtm-btn--danger");
							}
						}
					} else {
						collapseActiveSample();
						stop(); // メインエディタの再生を停止

						activeSampleButton = htmlBtn;
						htmlBtn.textContent = "■ 停止";
						htmlBtn.classList.remove("dtm-btn--primary");
						htmlBtn.classList.add("dtm-btn--danger");

						if (container) {
							container.innerHTML = "";
							const player = mountMmlPlayer(container, mml, {
								onPlayNote: (e) => {
									if (options.onPlayNote) {
										const trackIndex = Number(e.trackId);
										const config = trackConfigs[trackIndex];
										const mappedTrackId = config ? config.id : e.trackId;
										options.onPlayNote({
											...e,
											trackId: mappedTrackId,
										});
									}
								},
								onPlayDrum: options.onPlayDrum,
								onResumeAudio: options.onResumeAudio,
								getAudioTime: options.getAudioTime,
								singingVoices: options.singingVoices,
								drumPatterns: options.drumPatterns,
								volume: masterVolume,
								_skipInfoModals: true,
								onStop: () => {
									if (activeSampleButton === htmlBtn) {
										htmlBtn.textContent = "▶ 試聴";
										htmlBtn.classList.remove("dtm-btn--danger");
										htmlBtn.classList.add("dtm-btn--primary");
									}
								},
							});
							activeSamplePlayer = player;
							player.play();
						}
					}
				});
			}
		};
		refs.modalClose.addEventListener("click", () => {
			collapseActiveSample();
			collapseSearchPreview();
			refs.modalOverlay.setAttribute("hidden", "");
		});
		refs.modalOverlay.addEventListener("click", (e) => {
			if (e.target === refs.modalOverlay) {
				collapseActiveSample();
				collapseSearchPreview();
				refs.modalOverlay.setAttribute("hidden", "");
			}
		});

		refs.mmlInfoBtn.addEventListener("click", () => {
			showModal("MMLの書き方解説", MML_INFO_HTML);
		});
		refs.midiInfoBtn.addEventListener("click", () => {
			showModal("MIDIの読み込み解説", MIDI_INFO_HTML);
		});
		refs.shiftApplyBtn.addEventListener("click", () =>
			overlayDuring(() => {
				shiftNotes(
					trackStates.map((t) => t.core),
					Number.parseInt(refs.shiftSelect.value, 10) || 0,
				);
				redrawAll();
			}),
		);
		refs.transposeApplyBtn.addEventListener("click", () =>
			overlayDuring(() => {
				transposeNotes(
					trackStates.map((t) => t.core),
					Number.parseInt(refs.transposeSelect.value, 10) || 0,
				);
				redrawAll();
				updateUndoRedo();
			}),
		);
		refs.transposeInfoBtn.addEventListener("click", () => {
			showModal("移調の解説", TRANSPOSE_INFO_HTML);
		});

		if (showMidi) wireMidi();
		if (showMidiSearch) wireMidiSearch();

		// キーボードショートカット
		document.addEventListener("keydown", onKeyDown);

		// 入力欄のキー伝搬抑制（動的追加要素にも対応するため委譲）
		refs.root.addEventListener("keydown", (e) => {
			const t = e.target as Element;
			if (t.tagName !== "TEXTAREA" && t.tagName !== "INPUT") return;
			const ke = e as KeyboardEvent;
			if (
				(ke.ctrlKey || ke.metaKey) &&
				["KeyZ", "KeyY", "KeyV", "KeyC", "KeyX"].includes(ke.code)
			)
				e.stopPropagation();
		});
	};

	let pendingMidi: unknown = null;
	let detectedTracks: ReturnType<typeof analyzeMidiTracks> = [];
	// MIDI選択時に自動抽出したドラム定義（ドラムJSON出力で現在の音源と併せて再生成する）
	let extractedMidiDrum: import("./song-drum-config").SongDrumPattern | null =
		null;
	// 抽出したドラムパターンを DAW に追加し、自動選択する
	const applyExtractedDrumPattern = (
		patternDef: import("./drum-config").DrumPatternDef,
	): void => {
		extractedMidiDrum =
			patternDef.pattern as import("./song-drum-config").SongDrumPattern;
		drumPatterns["_extracted_midi"] = patternDef;
		let option = refs.drumSelect.querySelector(
			`option[value="_extracted_midi"]`,
		) as HTMLOptionElement | null;
		if (!option) {
			option = document.createElement("option");
			option.value = "_extracted_midi";
			refs.drumSelect.appendChild(option);
		}
		option.textContent = patternDef.label;
		currentDrumPattern = "_extracted_midi";
		refs.drumSelect.value = "_extracted_midi";
		options.onDrumChange?.("_extracted_midi");
	};
	const wireMidi = (): void => {
		refs.midiInput.addEventListener("change", async () => {
			const file = refs.midiInput.files?.[0];
			if (!file || !options.parseMidi) return;
			refs.overlay.hidden = false;
			setLoading(true);
			const buffer = new Uint8Array(await file.arrayBuffer());
			pendingMidi = await options.parseMidi(buffer);
			detectedTracks = analyzeMidiTracks(pendingMidi);
			// MIDI選択時にドラムパターンを自動抽出し、自動選択する
			try {
				const { patternDef } = extractMidiDrumPattern(
					pendingMidi,
					currentDrumFont,
				);
				applyExtractedDrumPattern(patternDef);
			} catch (e) {
				console.error(e);
			}
			refs.midiTrackSelection.innerHTML = `<span class="dtm-label">トラック</span>`;
			detectedTracks.forEach((t, i) => {
				const btn = document.createElement("button");
				btn.className = `dtm-btn ${t.selected ? "dtm-btn--primary" : "dtm-btn--ghost"}`;
				btn.dataset.selected = String(t.selected);
				btn.textContent = `${t.name} (${t.noteCount})`;
				btn.addEventListener("click", () => {
					const on = btn.dataset.selected !== "true";
					btn.dataset.selected = String(on);
					btn.classList.toggle("dtm-btn--primary", on);
					btn.classList.toggle("dtm-btn--ghost", !on);
				});
				refs.midiTrackSelection.appendChild(btn);
				if (i === 0) refs.midiTrackSelection.dataset.ready = "1";
			});
			refs.midiTrackSelection.classList.remove("dtm-hidden");
			refs.overlay.hidden = true;
			setLoading(false);
		});
		refs.midiLoadBtn.addEventListener("click", async () => {
			if (!pendingMidi) return;
			const selected: number[] = [];
			const btns = refs.midiTrackSelection.querySelectorAll("button");
			btns.forEach((b, i) => {
				if ((b as HTMLElement).dataset.selected === "true")
					selected.push(detectedTracks[i].index);
			});
			if (selected.length === 0) return;
			if (
				!isAdvanced &&
				options.onRequestAdvancedMode &&
				selected.length > trackStates.length
			) {
				const confirmed = await showConfirmModal(
					"初心者モードで読み込むと、音が崩れる可能性があります。<br>上級者モードに切り替えますか？",
				);
				if (confirmed) {
					const midi = pendingMidi;
					const sel = selected.slice();
					options.onRequestAdvancedMode(undefined, (newDaw) => {
						newDaw.applyMidiParsed?.(midi, sel);
					});
					return;
				}
			}
			overlayDuring(() => applyMidiSelection(pendingMidi, selected));
		});
	};

	// 検索結果MIDIを試聴用MMLへ変換する（トラック分類はエディタと同じ規則を流用）
	const buildPreviewMml = (midi: unknown): string => {
		const analysis = analyzeMidiTracks(midi);
		const selected = analysis.filter((a) => a.selected).map((a) => a.index);
		const { placements, bpm: parsedBpm } = extractMidiPlacements(
			midi,
			selected,
		);
		const byTrack = new Map<string, typeof placements>();
		for (const p of placements) {
			if (!byTrack.has(p.trackId)) byTrack.set(p.trackId, []);
			byTrack.get(p.trackId)?.push(p);
		}
		const refCore = trackStates[0].core;
		const tempo = Math.round(parsedBpm) || bpm;
		const lines: string[] = [];
		let i = 0;
		for (const notes of byTrack.values()) {
			const asNotes = notes.map((p) => ({
				id: 0,
				startStep: p.startStep,
				durationSteps: p.durationSteps,
				pitch: p.pitch,
				velocity: p.velocity,
			}));
			const mml = refCore.getMMLFromNotes(asNotes, tempo, 100).trim();
			lines.push(`@${i} ${mml}`);
			i++;
		}
		return [...lines, MML_END_MARKER].join(";\n");
	};

	// MIDIを取得・パースし、AI採譜特有の破綻がないか検査してから返す。
	// 破綻していると判定した場合は例外を投げ、呼び出し側は「失敗」扱いにして試聴・読込を行わない。
	const fetchVerifiedMidi = async (fileName: string): Promise<unknown> => {
		if (!options.parseMidi || !midiSearchClient) {
			throw new Error("parseMidi/midiSearchClient not injected");
		}
		const midiBytes = await midiSearchClient.fetchMidi(fileName);
		const midi = await options.parseMidi(new Uint8Array(midiBytes));
		const analysis = analyzeMidiTracks(midi);
		const selected = analysis.filter((a) => a.selected).map((a) => a.index);
		if (!isPlausibleMidiTranscription(midi, selected)) {
			throw new Error("implausible MIDI transcription");
		}
		return midi;
	};

	let searchPreviewPlayer:
		| import("./mml-player").MmlPlayerInstance
		| ChordPlayerInstance
		| null = null;
	let searchPreviewBtn: HTMLButtonElement | null = null;
	const collapseSearchPreview = (): void => {
		if (searchPreviewPlayer) {
			searchPreviewPlayer.stop();
			searchPreviewPlayer.destroy();
			searchPreviewPlayer = null;
		}
		if (searchPreviewBtn) {
			searchPreviewBtn.textContent = "▶ 試聴";
			searchPreviewBtn.classList.remove("dtm-btn--danger");
			searchPreviewBtn.classList.add("dtm-btn--ghost");
			const container = searchPreviewBtn
				.closest(".dtm-modal-sample-box")
				?.querySelector(".dtm-modal-sample-player-container");
			if (container) container.innerHTML = "";
			searchPreviewBtn = null;
		}
	};

	/** MML検索キャッシュ（ページリロードまで保持） */
	let mmlSearchCache: {
		query: string;
		count: number;
		renderResults: (container: HTMLElement) => void;
	} | null = null;

	refs.drumJsonExportBtn.addEventListener("click", () => {
		if (!extractedMidiDrum) {
			alert("MIDIファイルを選択してください。");
			return;
		}
		const json = buildDrumPatternJson(extractedMidiDrum, currentDrumFont);
		refs.drumJsonOutput.classList.remove("dtm-hidden");
		refs.drumJsonText.textContent = json;
		refs.drumJsonStatus.textContent = `出力: ${json.length}文字`;
	});

	refs.drumJsonCopyBtn.addEventListener("click", () => {
		navigator.clipboard?.writeText(refs.drumJsonText.textContent ?? "");
		refs.drumJsonCopyBtn.classList.add("dtm-btn--success");
		setTimeout(
			() => refs.drumJsonCopyBtn.classList.remove("dtm-btn--success"),
			1200,
		);
	});

	/** コード進行検索キャッシュ（ページリロードまで保持） */
	let chordSearchCache: {
		query: string;
		count: number;
		renderResults: (container: HTMLElement) => void;
	} | null = null;

	const wireMidiSearch = (): void => {
		if (!midiSearchClient) return;
		refs.midiSearchOpenBtn.addEventListener("click", () => {
			showModal(
				"MML検索",
				`
				<div class="dtm-row" style="flex-wrap:nowrap">
					<input type="text" class="dtm-input dtm-grow" data-dtm="modal-midi-search-input" placeholder="曲名でMML検索" style="min-width:0">
					<button class="dtm-btn dtm-btn--primary" data-dtm="modal-midi-search-btn" style="flex-shrink:0">検索</button>
				</div>
				<div data-dtm="modal-midi-search-status" style="font-size:11px;color:rgba(255,255,255,0.5);min-height:1.4em"></div>
				<div class="dtm-row" data-dtm="modal-midi-search-results" style="flex-direction:column;align-items:stretch;gap:4px"></div>
				`,
			);
			const input = refs.modalBody.querySelector(
				'[data-dtm="modal-midi-search-input"]',
			) as HTMLInputElement;
			const searchBtn = refs.modalBody.querySelector(
				'[data-dtm="modal-midi-search-btn"]',
			) as HTMLButtonElement;
			const statusEl = refs.modalBody.querySelector(
				'[data-dtm="modal-midi-search-status"]',
			) as HTMLElement;
			const results = refs.modalBody.querySelector(
				'[data-dtm="modal-midi-search-results"]',
			) as HTMLElement;

			// キャッシュがあれば入力と結果を復元
			if (mmlSearchCache) {
				input.value = mmlSearchCache.query;
				statusEl.textContent = `「${mmlSearchCache.query}」の検索結果\u3000${mmlSearchCache.count}件のヒット`;
				mmlSearchCache.renderResults(results);
			}

			const runSearch = async (): Promise<void> => {
				const q = input.value.trim();
				if (!q) return;
				collapseSearchPreview();
				searchBtn.disabled = true;
				searchBtn.textContent = "検索中...";
				results.innerHTML = "";
				statusEl.textContent = "";
				try {
					const songs = await midiSearchClient.searchSongs({ title: q });
					if (songs.length === 0) {
						statusEl.textContent = `「${q}」の検索結果\u30000件のヒット`;
						results.innerHTML =
							'<span class="dtm-label" style="color:var(--dtm-warn)">見つかりませんでした</span>';
						mmlSearchCache = {
							query: q,
							count: 0,
							renderResults: (c) => {
								c.innerHTML =
									'<span class="dtm-label" style="color:var(--dtm-warn)">見つかりませんでした</span>';
							},
						};
						return;
					}
					statusEl.textContent = `「${q}」の検索結果\u3000${songs.length}件のヒット`;
					const renderMmlResults = (container: HTMLElement): void => {
						container.innerHTML = "";
						for (const song of songs) {
							const box = document.createElement("div");
							box.className = "dtm-modal-sample-box";
							const row = document.createElement("div");
							row.className = "dtm-row";
							row.style.cssText = "flex-wrap:nowrap;gap:4px;padding:2px 0";
							const label = document.createElement("span");
							label.className = "dtm-label";
							label.style.cssText =
								"flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
							label.textContent = `${song.title} - ${song.user}`;
							const previewBtn = document.createElement("button");
							previewBtn.className = "dtm-btn dtm-btn--ghost";
							previewBtn.style.cssText = "flex-shrink:0";
							previewBtn.textContent = "▶ 試聴";
							const loadBtn = document.createElement("button");
							loadBtn.className = "dtm-btn dtm-btn--primary";
							loadBtn.style.cssText = "flex-shrink:0";
							loadBtn.textContent = "読み込み";
							const playerContainer = document.createElement("div");
							playerContainer.className = "dtm-modal-sample-player-container";

							previewBtn.addEventListener("click", async () => {
								if (searchPreviewBtn === previewBtn) {
									if (searchPreviewPlayer?.isPlaying()) {
										searchPreviewPlayer.stop();
									} else {
										stop();
										previewBtn.textContent = "読込中...";
										try {
											const midi = await fetchVerifiedMidi(song.file);
											const mml = buildPreviewMml(midi);
											playerContainer.innerHTML = "";
											const player = mountMmlPlayer(playerContainer, mml, {
												onPlayNote: options.onPlayNote,
												onPlayDrum: options.onPlayDrum,
												onResumeAudio: options.onResumeAudio,
												getAudioTime: options.getAudioTime,
												singingVoices: options.singingVoices,
												drumPatterns: options.drumPatterns,
												volume: masterVolume,
												_skipInfoModals: true,
												onStop: () => {
													if (searchPreviewBtn === previewBtn) {
														previewBtn.textContent = "▶ 試聴";
														previewBtn.classList.remove("dtm-btn--danger");
														previewBtn.classList.add("dtm-btn--ghost");
													}
												},
											});
											searchPreviewPlayer = player;
											searchPreviewBtn = previewBtn;
											player.play();
											previewBtn.textContent = "■ 停止";
											previewBtn.classList.remove("dtm-btn--ghost");
											previewBtn.classList.add("dtm-btn--danger");
										} catch (e) {
											console.error("[dtm] MIDI preview failed", e);
											previewBtn.textContent = "失敗";
										}
									}
								} else {
									collapseSearchPreview();
									stop();
									previewBtn.textContent = "読込中...";
									try {
										const midi = await fetchVerifiedMidi(song.file);
										const mml = buildPreviewMml(midi);
										playerContainer.innerHTML = "";
										const player = mountMmlPlayer(playerContainer, mml, {
											onPlayNote: options.onPlayNote,
											onPlayDrum: options.onPlayDrum,
											onResumeAudio: options.onResumeAudio,
											getAudioTime: options.getAudioTime,
											singingVoices: options.singingVoices,
											drumPatterns: options.drumPatterns,
											volume: masterVolume,
											_skipInfoModals: true,
											onStop: () => {
												if (searchPreviewBtn === previewBtn) {
													previewBtn.textContent = "▶ 試聴";
													previewBtn.classList.remove("dtm-btn--danger");
													previewBtn.classList.add("dtm-btn--ghost");
												}
											},
										});
										searchPreviewPlayer = player;
										searchPreviewBtn = previewBtn;
										player.play();
										previewBtn.textContent = "■ 停止";
										previewBtn.classList.remove("dtm-btn--ghost");
										previewBtn.classList.add("dtm-btn--danger");
									} catch (e) {
										console.error("[dtm] MIDI preview failed", e);
										previewBtn.textContent = "失敗";
									}
								}
							});

							loadBtn.addEventListener("click", async () => {
								loadBtn.disabled = true;
								loadBtn.textContent = "読込中...";
								try {
									const pending = await fetchVerifiedMidi(song.file);
									const analysis = analyzeMidiTracks(pending);
									const sel = analysis
										.filter((a) => a.selected)
										.map((a) => a.index);
									collapseSearchPreview();
									overlayDuring(() => applyMidiSelection(pending, sel));
									refs.modalOverlay.setAttribute("hidden", "");
								} catch (e) {
									console.error("[dtm] MIDI fetch failed", e);
									loadBtn.textContent = "失敗";
								} finally {
									loadBtn.disabled = false;
								}
							});

							row.appendChild(label);
							row.appendChild(previewBtn);
							row.appendChild(loadBtn);
							box.appendChild(row);
							box.appendChild(playerContainer);
							container.appendChild(box);
						}
					};
					renderMmlResults(results);
					mmlSearchCache = {
						query: q,
						count: songs.length,
						renderResults: renderMmlResults,
					};
				} catch (e) {
					console.error("[dtm] MIDI search failed", e);
					results.innerHTML =
						'<span class="dtm-label" style="color:var(--dtm-warn)">検索に失敗しました</span>';
				} finally {
					searchBtn.disabled = false;
					searchBtn.textContent = "検索";
				}
			};
			searchBtn.addEventListener("click", () => void runSearch());
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") void runSearch();
			});
			input.focus();
		});
	};

	const openChordSearchModal = (chordTextArea: HTMLTextAreaElement): void => {
		if (!midiSearchClient) return;
		const active = trackStates.find((t) => t.config.id === activeTrackId);
		if (!active) return;

		showModal(
			"コード進行検索",
			`
			<div class="dtm-row" style="flex-wrap:nowrap">
				<input type="text" class="dtm-input dtm-grow" data-dtm="modal-chord-search-input" placeholder="曲名やコード進行で検索" style="min-width:0">
				<button class="dtm-btn dtm-btn--primary" data-dtm="modal-chord-search-btn" style="flex-shrink:0">検索</button>
			</div>
			<div data-dtm="modal-chord-search-status" style="font-size:11px;color:rgba(255,255,255,0.5);min-height:1.4em"></div>
			<div class="dtm-row" data-dtm="modal-chord-search-results" style="flex-direction:column;align-items:stretch;gap:4px"></div>
			`,
		);

		const input = refs.modalBody.querySelector(
			'[data-dtm="modal-chord-search-input"]',
		) as HTMLInputElement;
		const searchBtn = refs.modalBody.querySelector(
			'[data-dtm="modal-chord-search-btn"]',
		) as HTMLButtonElement;
		const statusEl = refs.modalBody.querySelector(
			'[data-dtm="modal-chord-search-status"]',
		) as HTMLElement;
		const results = refs.modalBody.querySelector(
			'[data-dtm="modal-chord-search-results"]',
		) as HTMLElement;

		// キャッシュがあれば入力と結果を復元
		if (chordSearchCache) {
			input.value = chordSearchCache.query;
			statusEl.textContent = `「${chordSearchCache.query}」の検索結果　${chordSearchCache.count}件のヒット`;
			chordSearchCache.renderResults(results);
		}

		const runSearch = async (): Promise<void> => {
			const q = input.value.trim();
			if (!q) return;
			collapseSearchPreview();
			searchBtn.disabled = true;
			searchBtn.textContent = "検索中...";
			results.innerHTML = "";
			statusEl.textContent = "";
			try {
				const scores = await midiSearchClient.searchRechord(q);
				if (scores.length === 0) {
					statusEl.textContent = `「${q}」の検索結果　0件のヒット`;
					results.innerHTML =
						'<span class="dtm-label" style="color:var(--dtm-warn)">見つかりませんでした</span>';
					chordSearchCache = {
						query: q,
						count: 0,
						renderResults: (c) => {
							c.innerHTML =
								'<span class="dtm-label" style="color:var(--dtm-warn)">見つかりませんでした</span>';
						},
					};
					return;
				}
				statusEl.textContent = `「${q}」の検索結果　${scores.length}件のヒット`;
				const renderChordResults = (container: HTMLElement): void => {
					container.innerHTML = "";
					for (const score of scores) {
						const box = document.createElement("div");
						box.className = "dtm-modal-sample-box";
						const row = document.createElement("div");
						row.className = "dtm-row";
						row.style.cssText = "flex-wrap:nowrap;gap:4px;padding:2px 0";
						const label = document.createElement("span");
						label.className = "dtm-label";
						label.style.cssText =
							"flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
						label.textContent = `${score.title}${score.user?.screen_name ? ` - ${score.user.screen_name}` : ""}`;

						const previewBtn = document.createElement("button");
						previewBtn.className = "dtm-btn dtm-btn--ghost";
						previewBtn.style.cssText = "flex-shrink:0";
						previewBtn.textContent = "▶ 試聴";

						const loadBtn = document.createElement("button");
						loadBtn.className = "dtm-btn dtm-btn--primary";
						loadBtn.style.cssText = "flex-shrink:0";
						loadBtn.textContent = "読み込み";

						const playerContainer = document.createElement("div");
						playerContainer.className = "dtm-modal-sample-player-container";

						previewBtn.addEventListener("click", async () => {
							if (searchPreviewBtn === previewBtn) {
								if (searchPreviewPlayer?.isPlaying()) {
									searchPreviewPlayer.stop();
								} else {
									stop();
									previewBtn.textContent = "再生中...";
									try {
										searchPreviewPlayer?.play();
										previewBtn.textContent = "■ 停止";
										previewBtn.classList.remove("dtm-btn--ghost");
										previewBtn.classList.add("dtm-btn--danger");
									} catch (e) {
										console.error("[dtm] Chord preview play failed", e);
										previewBtn.textContent = "失敗";
									}
								}
							} else {
								collapseSearchPreview();
								stop();
								previewBtn.textContent = "読込中...";
								try {
									playerContainer.innerHTML = "";
									const player = mountChordPlayer(
										playerContainer,
										score.content,
										{
											volume: masterVolume,
											bpm: score.bpm ?? bpm ?? 120,
											_skipInfoModals: true,
											onStop: () => {
												if (searchPreviewBtn === previewBtn) {
													previewBtn.textContent = "▶ 試聴";
													previewBtn.classList.remove("dtm-btn--danger");
													previewBtn.classList.add("dtm-btn--ghost");
												}
											},
										},
									);
									searchPreviewPlayer = player;
									searchPreviewBtn = previewBtn;
									player.play();
									previewBtn.textContent = "■ 停止";
									previewBtn.classList.remove("dtm-btn--ghost");
									previewBtn.classList.add("dtm-btn--danger");
								} catch (e) {
									console.error("[dtm] Chord preview mount failed", e);
									previewBtn.textContent = "失敗";
								}
							}
						});

						loadBtn.addEventListener("click", () => {
							collapseSearchPreview();
							chordTextArea.value = score.content;
							active.savedChordInput = score.content;
							if (score.bpm) {
								setBpm(score.bpm);
							}
							applyChord();
							refs.modalOverlay.setAttribute("hidden", "");
						});

						row.appendChild(label);
						row.appendChild(previewBtn);
						row.appendChild(loadBtn);
						box.appendChild(row);
						box.appendChild(playerContainer);
						container.appendChild(box);
					}
				};
				renderChordResults(results);
				chordSearchCache = {
					query: q,
					count: scores.length,
					renderResults: renderChordResults,
				};
			} catch (e) {
				console.error("[dtm] Chord search failed", e);
				results.innerHTML =
					'<span class="dtm-label" style="color:var(--dtm-warn)">検索に失敗しました</span>';
			} finally {
				searchBtn.disabled = false;
				searchBtn.textContent = "検索";
			}
		};

		searchBtn.addEventListener("click", () => void runSearch());
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") void runSearch();
		});
		input.focus();
	};

	const onKeyDown = (e: KeyboardEvent): void => {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.code === "KeyZ" && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") {
			e.preventDefault();
			redo();
		} else if (e.code === "KeyC" && selectedNotes.length > 0) {
			e.preventDefault();
			copiedNotes = [...selectedNotes];
		} else if (e.code === "KeyX" && selectedNotes.length > 0) {
			e.preventDefault();
			if (!isActiveLocked()) {
				copiedNotes = [...selectedNotes];
				const core = getActive().core;
				core.beginBatch();
				for (const n of selectedNotes) core.deleteNoteById(n.id);
				core.endBatch();
				selectedNotes = [];
			}
		} else if (e.code === "KeyV" && copiedNotes.length > 0) {
			e.preventDefault();
			if (isActiveLocked()) return;
			const core = getActive().core;
			const notes = core.getNotes();
			const minStart = Math.min(...copiedNotes.map((n) => n.startStep));
			core.beginBatch();
			for (const note of copiedNotes) {
				const newStart = playStartStep + (note.startStep - minStart);
				const newEnd = newStart + note.durationSteps;
				const overlap = notes.some(
					(ex) =>
						ex.pitch === note.pitch &&
						newStart < ex.startStep + ex.durationSteps &&
						newEnd > ex.startStep,
				);
				if (!overlap)
					core.addNote(newStart, note.pitch, {
						noteLengthSteps: note.durationSteps,
						velocity: note.velocity,
					});
			}
			core.endBatch();
			redrawAll();
		}
	};

	// ============================================================
	// 初期化
	// ============================================================
	setupCanvas(); // renderer.init() で g_config を設定
	createTrackStates(); // g_config 設定後に MMLCore を生成
	ready = true;
	initScrollbarDrag();
	wireEvents();
	setBpm(bpm);
	updateTrackPanel();
	updateTransport();
	updateUndoRedo();
	redrawAll();
	if (options.initialMML) loadMML(options.initialMML);

	// 背景不透明度の初期ロード
	let initialOpacity = 40;
	try {
		const storedOpacity = localStorage.getItem(BG_OPACITY_KEY);
		if (storedOpacity !== null) {
			initialOpacity = Number.parseInt(storedOpacity, 10);
			if (
				Number.isNaN(initialOpacity) ||
				initialOpacity < 0 ||
				initialOpacity > 100
			) {
				initialOpacity = 40;
			}
		}
	} catch (_) {}
	applyBgOpacity(initialOpacity);

	loadBgBlob()
		.then((blob) => {
			if (blob) applyRollBackground(blob);
		})
		.catch(() => {});

	// リサイズ対応（Canvas再構築）
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	const resizeObserver = new ResizeObserver(() => {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => setupCanvas(), 150);
	});
	resizeObserver.observe(refs.rollContainer);

	// document レベルのリスナ（pointermove/up）
	document.addEventListener("pointermove", onPointerMove);
	document.addEventListener("pointerup", onPointerUp);

	const setLoading = (loading: boolean): void => {
		isLoading = loading;
		refs.topbar.classList.toggle("is-loading", loading);
	};

	const getCurrentPlayStep = (): number => {
		if (playbackState === "playing") return currentPlayStep;
		if (playbackState === "paused") return pausedPlayStep;
		return playStartStep;
	};

	const jumpTo = async (step: number): Promise<void> => {
		const wasPlaying = playbackState === "playing";
		if (wasPlaying) {
			sequencer.stop();
			options.singingVoices?.stopStream();
			clearSoundTimers();
			playStartStep = step;
			pausedPlayStep = step;
			currentPlayStep = step;
			playbackState = "paused";
			await play();
		} else {
			forcePauseAt(step);
		}
	};

	const forcePauseAt = (step: number): void => {
		playStartStep = step;
		pausedPlayStep = step;
		currentPlayStep = step;
		playbackState = "paused";

		const canvas = getGridCanvas();
		currentOffsetX = clamp(
			step * renderConfig.stepWidth - canvas.width * 0.5,
			0,
			getMaxOffsetX(),
		);
		setDrawOffset(currentOffsetX, currentOffsetY);

		updateTransport();
		redrawAll();
	};

	// ============================================================
	// 公開API
	// ============================================================
	return {
		play,
		pause,
		stop,
		getMML: generateMML,
		setInstrument: (name: string) => {
			currentInstrument = name;
		},
		getDrum: () => currentDrumPattern,
		getUsedDrumKeys: () => getDrumPatternKeys(currentDrumPattern, drumPatterns),
		getDrumFont: () => currentDrumFont,
		setDrumFont: (fontId: string) => {
			currentDrumFont = fontId;
			refs.drumFontSelect.value = fontId;
			options.onDrumFontChange?.(fontId);
		},
		addDrumPattern: (
			name: string,
			pattern: import("./drum-config").DrumPatternDef,
		) => {
			drumPatterns[name] = pattern;
			let option = refs.drumSelect.querySelector(
				`option[value="${name}"]`,
			) as HTMLOptionElement | null;
			if (!option) {
				option = document.createElement("option");
				option.value = name;
				refs.drumSelect.appendChild(option);
			}
			option.textContent = pattern.label;
		},
		setDrum: (name: string) => {
			// "none"（ドラムなし）も有効な選択肢。それ以外は既知のパターンのみ受け付ける
			if (name !== "none" && !drumPatterns[name]) return;
			currentDrumPattern = name;
			refs.drumSelect.value = name;
			options.onDrumChange?.(name);
		},
		getViewState,
		setViewState: (state: Partial<DawViewState>) => {
			if (typeof state.zoomX === "number") {
				zoomX = clamp(state.zoomX, 25, 200);
				applyZoomX();
			}
			if (typeof state.zoomY === "number") {
				zoomY = clamp(state.zoomY, 50, 200);
				applyZoomY();
			}
			if (typeof state.decomposeChord === "boolean") {
				refs.decomposeChordToggle.checked = state.decomposeChord;
			}
			if (typeof state.ignoreChordHeavy === "boolean") {
				refs.ignoreChordHeavyToggle.checked = state.ignoreChordHeavy;
			}
		},
		loadMML,
		loadMIDI,
		applyMidiParsed: (midi: unknown, selectedIndices: number[]): void => {
			overlayDuring(() => applyMidiSelection(midi, selectedIndices));
		},
		exportMIDI,
		setBpm,
		getPlaybackState: () => playbackState,
		getCurrentPlayStep,
		forcePauseAt,
		setLoading,
		setMasterVolume: (volume: number) => {
			masterVolume = clamp(volume, 0, 100);
			refs.masterVolume.value = String(masterVolume);
			refs.masterVolumeLabel.textContent = `${masterVolume}%`;
			options.singingVoices?.setVolume(masterVolume / 100);
		},
		setVolume: (volume: number) => {
			masterVolume = clamp(volume, 0, 100);
			refs.masterVolume.value = String(masterVolume);
			refs.masterVolumeLabel.textContent = `${masterVolume}%`;
			options.singingVoices?.setVolume(masterVolume / 100);
		},
		setDrumVolume: (volume: number) => {
			drumVolume = clamp(volume, 0, 100);
			refs.drumVolume.value = String(drumVolume);
			refs.drumVolumeLabel.textContent = `${drumVolume}%`;
		},
		setReverbAmount: (amount: number) => {
			reverbAmount = clamp(amount, 0, 100);
			refs.reverbAmount.value = String(reverbAmount);
			refs.reverbAmountLabel.textContent = `${reverbAmount}%`;
			options.onReverbChange?.(reverbAmount);
		},
		setReverbDecay: (seconds: number) => {
			reverbDecay = Math.max(
				MIN_REVERB_DECAY_SEC,
				Math.min(MAX_REVERB_DECAY_SEC, seconds),
			);
			refs.reverbDecay.value = String(Math.round(reverbDecay * 10));
			refs.reverbDecayLabel.textContent = `${reverbDecay.toFixed(1)}s`;
			options.onReverbDecayChange?.(reverbDecay);
		},
		setReverbPreDelay: (ms: number) => {
			reverbPreDelay = Math.max(
				MIN_REVERB_PREDELAY_MS,
				Math.min(MAX_REVERB_PREDELAY_MS, ms),
			);
			refs.reverbPreDelay.value = String(reverbPreDelay);
			refs.reverbPreDelayLabel.textContent = `${reverbPreDelay}ms`;
			options.onReverbPreDelayChange?.(reverbPreDelay);
		},
		setDelayAmount: (amount: number) => {
			delayAmount = clamp(amount, 0, 100);
			refs.delayAmount.value = String(delayAmount);
			refs.delayAmountLabel.textContent = `${delayAmount}%`;
			options.onDelayChange?.(delayAmount);
		},
		applyPatch: (
			trackId: string,
			added: import("./types").NoteData[],
			removed: import("./types").NoteRemove[],
		): void => {
			const track = trackStates.find((t) => t.config.id === trackId);
			if (!track) return;
			suppressPatch = true;
			track.core.beginBatch();
			for (const n of added) {
				// upsert: 同一キー(startStep,pitch)が既にあれば一旦削除してから追加し、
				// durationSteps/velocity の変更（リサイズ等）を確実に反映する。
				const existing = track.core
					.getNotes()
					.find((e) => e.startStep === n.startStep && e.pitch === n.pitch);
				if (existing) track.core.deleteNoteById(existing.id);
				track.core.addNote(n.startStep, n.pitch, {
					noteLengthSteps: n.durationSteps,
					velocity: n.velocity,
				});
			}
			for (const r of removed) {
				const note = track.core
					.getNotes()
					.find((n) => n.startStep === r.startStep && n.pitch === r.pitch);
				if (note) track.core.deleteNoteById(note.id);
			}
			track.core.endBatch();
			suppressPatch = false;
			redrawAll();
		},
		setTrackVisible: (trackId: string, visible: boolean): void => {
			if (visible) hiddenTracks.delete(trackId);
			else hiddenTracks.add(trackId);
			redrawAll();
		},
		setTrackAudible: (trackId: string, audible: boolean): void => {
			if (audible) audioMutedTracks.delete(trackId);
			else audioMutedTracks.add(trackId);
		},
		applyLyrics: (
			trackId: string,
			data: import("./types").LyricSyncData,
		): void => {
			const t = trackStates.find((s) => s.config.id === trackId);
			if (!t) return;
			t.lyrics = data.lyrics;
			t.lyricModel = data.model;
			t.vocalVolume = data.vocalVolume;
			t.vocalGate = data.vocalGate;
			t.vocalPan = data.vocalPan;
			t.vocalOctave = data.vocalOctave;
			t.vocalVibrato = data.vocalVibrato ?? false;
			t.vocalReverb = data.vocalReverb ?? 0;
			t.vocalDelay = data.vocalDelay ?? 0;
			t.vocalGender = data.vocalGender ?? 50;
			t.vocalBreathiness = data.vocalBreathiness ?? 50;
			t.vocalTension = data.vocalTension ?? 50;
			t.vocalOctaveUnison = data.vocalOctaveUnison ?? "none";
		},
		applyTrackInstrument: (
			trackIndex: number,
			instrumentName: string,
		): void => {
			const t = trackStates[trackIndex];
			if (!t) return;
			const name = normalizeInstrumentName(instrumentName);
			t.trackInstrument = name;
			// アクティブトラックのパネルが表示中なら楽器プルダウンを更新
			if (t.config.id === activeTrackId) updateTrackPanel();
		},
		noteToCanvas: (step: number, pitch: number) => {
			const canvas = getGridCanvas();
			const x = step * renderConfig.stepWidth - currentOffsetX;
			const y =
				(renderConfig.keyCount - 1 - pitch) * renderConfig.keyHeight -
				currentOffsetY;
			const onScreen =
				x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height;
			let side: "left" | "right" | "top" | "bottom" | null = null;
			if (!onScreen) {
				if (x < 0) side = "left";
				else if (x > canvas.width) side = "right";
				else if (y < 0) side = "top";
				else side = "bottom";
			}
			return { x, y, onScreen, side };
		},
		destroy: () => {
			sequencer.stop();
			options.singingVoices?.stopStream();
			unsubscribeClip?.();
			stopPeakSampling();
			resizeObserver.disconnect();
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
			document.removeEventListener("keydown", onKeyDown);
			target.innerHTML = "";
		},
	};
};
