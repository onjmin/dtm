/**
 * 楽器の「出口」を作る音作りブロック — ベース用のパラレル・サチュレーションと、
 * ギター用のキャビネットシミュレータ。どちらもトラックのチャンネルストリップの
 * 先頭（EQより前）へ差し込んで使う。
 *
 * ## なぜ要るのか
 *
 * サンプルを鳴らすだけの音源は「マイクで録った素の音」に相当する。実機のベースや
 * ギターは、そのあと必ずアンプ／キャビネット／コンプという**出口**を通ってから
 * 耳に届いている。市販の音源（Ample Bass、Shreddage 3 など）がリアルに聞こえる
 * 理由の大きな部分はサンプル数ではなくこの出口の再現で、Shreddage 3 は30種の
 * FXモジュールと30種のキャビネットIRを、Ample Bass はフレットバズ（Auto Buzz）と
 * 指ノイズを積んでいる。
 *
 * ## ベースにサチュレーションが要る理由（このライブラリ特有の事情）
 *
 * このライブラリはモバイルファーストで、実際の再生環境はスマホの内蔵スピーカーが
 * 主になる。ところが小型スピーカーは 150〜300Hz 以下をほとんど再生しない。
 * ベースの音域（A1〜A2 = 55〜110Hz）は**基音がまるごと出ない**ので、EQで低域を
 * 持ち上げても「出ない帯域を持ち上げている」だけで何も聞こえない。
 *
 * 対策は倍音を作ること。基音の整数倍音が 200〜2000Hz に並べば、脳は鳴っていない
 * 基音を補完して低い音として知覚する（missing fundamental / 残留効果）。歪みは
 * まさに倍音を作る処理なので、**低域を歪ませた成分を原音へ薄く混ぜる**と、低域を
 * 増やさずにベースが聞こえるようになる。原音と並列（パラレル）にするのは、
 * 直列で歪ませると低域そのものが潰れて逆に痩せるため。
 *
 * ## キャビネットIRを手続き的に作る理由
 *
 * `reverb.ts` と同じ方針で、外部のIRファイルを持たずに合成する。スピーカーの
 * インパルス応答は「直接音＋箱とコーンの共振がすぐ減衰する」形をしているので、
 * 減衰する正弦波（モード）の重ね合わせで十分それらしくなる。
 */

/** WaveShaperカーブの分解能。1024点あれば可聴帯域で段差は聞こえない。 */
const CURVE_SAMPLES = 1024;

/**
 * 1音の振幅エンベロープの型。**「どんな装置を通すか」（{@link InstrumentTone}）とは
 * 別軸**で、「音がどう始まってどう消えるか」を決める。
 *
 * - `bass` … 次の音までに必ず消す。締まった低音の条件。
 * - `pluck` … 撥弦・打弦・打撃（ピアノ／ギター／ハープ／ティンパニ／民族楽器）。
 *   **サンプル自身が減衰を持っている**ので、エンベロープ側では減衰させず
 *   （サステインをほぼ1に保つ）、離鍵後の尾ひれだけ短く切る。ここを下げると
 *   サンプルの減衰と二重に掛かって痩せる。
 * - `organ` … トーンホイール／パイプオルガン。**鍵を離した瞬間に止まる**のが
 *   この楽器の音の特徴で、余韻を残すとオルガンに聞こえなくなる。
 * - `sustain` … 弓・管・声。鳴らし続ける音。
 * - `pad` … シンセパッド／FX。ゆっくり立ち上がって長く残るのが役割。
 */
export type EnvKind = "bass" | "pluck" | "organ" | "sustain" | "pad";

/**
 * ベロシティ→音色（明るさ）の対応カーブ。
 *
 * - `default` … 線形。鍵盤・シンセなど。
 * - `bass` … 下限を大きく下げた対数。弱く弾いた音を確実に暗くして、ゴースト／
 *   デッドノートを表現できるようにする。
 * - `wind` … 金管・木管。**息の強さで音色が最も変わる**楽器群で、市販の管楽器音源
 *   （SWAM等の物理モデリング）が表現力の中心に据えているのもここ。弱奏で丸く、
 *   強奏で開くカーブにする。
 */
export type BrightnessCurve = "default" | "bass" | "wind";

/**
 * GM楽器の「鳴らし方」。プログラム番号から引く（{@link playStyleForProgram}）。
 */
export type PlayStyle = {
	env: EnvKind;
	/**
	 * ロングトーンに自動ビブラート（ピッチLFO）を掛けてよいか。
	 *
	 * **奏者が発音中にピッチを連続的に動かせる楽器だけ true**。ピアノ・鉄琴・ハープ・
	 * オルガン・撥弦楽器は、鳴り始めたら物理的にピッチを変えられないので、掛けると
	 * 単に音痴に聞こえる。改修前は「ベース以外の全楽器」に掛かっていた。
	 * 和音で鳴らすことが前提の楽器（ギター・パッド）も、全声部が同位相で揺れて
	 * うねるため対象外にする。
	 */
	vibrato: boolean;
	brightness: BrightnessCurve;
};

/** 種別が判定できないときの既定。 */
export const DEFAULT_PLAY_STYLE: PlayStyle = {
	env: "sustain",
	vibrato: false,
	brightness: "default",
};

/**
 * GMプログラム番号 → 鳴らし方。GMの並びは同じ族が8個ずつ並んでいるが、
 * **族の中に例外が混ざっている**ので範囲だけで括ると事故る。実際に例外なのは
 * ピチカート(45)・ティンパニ(47)・オーケストラヒット(55)・ハープ(46)——
 * 弦楽器の族に居ながら減衰する楽器——と、民族楽器の族に居る
 * バグパイプ(109)・フィドル(110)・チャルメラ(111)（こちらは逆に持続する楽器）。
 */
export const playStyleForProgram = (program: number): PlayStyle => {
	const pluck: PlayStyle = {
		env: "pluck",
		vibrato: false,
		brightness: "default",
	};
	const bass: PlayStyle = { env: "bass", vibrato: false, brightness: "bass" };
	const organ: PlayStyle = {
		env: "organ",
		vibrato: false,
		brightness: "default",
	};
	const blown: PlayStyle = {
		env: "sustain",
		vibrato: true,
		brightness: "wind",
	};
	const bowed: PlayStyle = {
		env: "sustain",
		vibrato: true,
		brightness: "default",
	};
	const pad: PlayStyle = { env: "pad", vibrato: false, brightness: "default" };

	if (program <= 15) return pluck; // ピアノ・鉄琴系（打鍵・打撃）
	if (program <= 20) return organ; // ドローバー〜リードオルガン
	if (program <= 23) return bowed; // アコーディオン・ハーモニカ（奏者が揺らせる）
	if (program <= 31) return pluck; // ギター
	if (program <= 39) return bass; // ベース
	if (program <= 44) return bowed; // ヴァイオリン〜トレモロ弦
	if (program <= 47) return pluck; // ピチカート・ハープ・ティンパニ
	if (program === 55) return pluck; // オーケストラヒット
	if (program <= 54) return bowed; // 弦アンサンブル・合唱
	if (program <= 79) return blown; // 金管・木管・笛
	if (program <= 87) return bowed; // シンセリード（単音で揺らす前提）
	if (program <= 103) return pad; // シンセパッド・FX
	if (program <= 108) return pluck; // シタール〜カリンバ
	if (program <= 111) return blown; // バグパイプ・フィドル・チャルメラ
	if (program <= 119) return pluck; // 打楽器系
	return DEFAULT_PLAY_STYLE; // 効果音
};

/**
 * トラックへ挿す音作りの種別。GMプログラム番号から決める（{@link toneForProgram}）。
 *
 * - `bass` … パラレル・サチュレーション。
 * - `guitar-clean` … キャビネットのみ（クリーン系エレキ。歪ませない）。
 * - `guitar-drive` … 軽いドライブ＋キャビネット（オーバードライブ／ディストーション）。
 * - `acoustic` … 生の撥弦楽器。プレゼンス＋エアのEQだけ。
 * - `none` … 何も挿さない（鍵盤・管弦・シンセなど）。
 */
export type InstrumentTone =
	| "bass"
	| "guitar-clean"
	| "guitar-drive"
	| "acoustic"
	| "none";

/**
 * GMプログラム番号 → 音作りの種別。
 *
 * アコースティックギター（24-25）にキャビネットを通さないのは、実機の信号経路として
 * 誤りだから——生ギターはマイクで録った音で、スピーカーを通っていない。同じ理由で
 * 「ボディの共鳴を足す」のもやらない（サンプルには既に実物の箱鳴りが入っている）。
 * 代わりに掛けるのはEQだけ——生ギターの録り音にプレゼンスとエアを足すのは、
 * ミックスで普通にやる処理で、無い装置を模擬するのとは違う。
 *
 * クリーン系エレキ（26-28, 31）はキャビだけ通す——実機のクリーントーンもアンプを
 * 鳴らした音なので、歪ませずに箱の色だけ足すのが正しい。
 */
export const toneForProgram = (program: number): InstrumentTone => {
	if (program >= 32 && program <= 39) return "bass";
	if (program === 29 || program === 30) return "guitar-drive";
	if (program === 26 || program === 27 || program === 28 || program === 31)
		return "guitar-clean";
	// アコギ（24-25）・ハープ（46）・シタール〜カリンバ（104-108）。
	if (program === 24 || program === 25 || program === 46) return "acoustic";
	if (program >= 104 && program <= 108) return "acoustic";
	return "none";
};

/**
 * ソフトクリップ（tanh）のWaveShaperカーブ。`drive` が大きいほど強く歪む。
 * 端点で ±1 に正規化してあるので、`drive` を上げても音量だけが上がることはない。
 */
export const createSaturationCurve = (drive: number): Float32Array => {
	const curve = new Float32Array(CURVE_SAMPLES);
	const k = Math.max(0.01, drive);
	const norm = Math.tanh(k);
	for (let i = 0; i < CURVE_SAMPLES; i++) {
		const x = (i / (CURVE_SAMPLES - 1)) * 2 - 1;
		curve[i] = Math.tanh(k * x) / norm;
	}
	return curve;
};

/**
 * WaveShaperのオーバーサンプリング設定。**必ず "none" を使う。**
 *
 * `"2x"` は Chromium で**128サンプル（44.1kHzで2.9ms）の遅延**を持つ（インパルスを
 * 通して実測）。`"4x"` は192サンプル。折り返し（エイリアス）は減るが、この遅延が
 * 2つの問題を起こす。
 *
 * 1. **パラレル接続が櫛形フィルタになる**。ベースのサチュレーションは原音と歪みを
 *    並列に足すので、片側だけ2.9ms遅れると 172Hz・517Hz…に打ち消しの谷ができる。
 *    実際、GM Electric Bass のノートを実測すると 200〜600Hz が **-8.1dB** 落ちていた
 *    ——**倍音を足すつもりで、一番大事な帯域を削っていた**。
 * 2. トラック間で位相がずれる。歪み段を通るトラックだけ2.9ms遅れるので、同じ音を
 *    重ねる編曲（オクターブ重ね等）で濁る。
 *
 * 入力側を先に帯域制限してあるので、"none" でも折り返しは実用上問題にならない。
 */
const OVERSAMPLE: OverSampleType = "none";

/** キャビネットIRの長さ（秒）。実測のギターキャビIRもおおむね20〜30ms。 */
const CAB_IMPULSE_SEC = 0.03;

/**
 * キャビネットのモード（共振）。`[周波数Hz, 振幅, 減衰時定数秒]`。
 * 100Hz付近が箱の共振、2kHz付近がコーンの分割振動で、この2つが
 * 「スピーカーを通した音」らしさの大半を担う。
 */
const CAB_MODES: [number, number, number][] = [
	[95, 0.18, 0.01],
	[180, 0.15, 0.008],
	[420, 0.16, 0.007],
	[1100, 0.16, 0.005],
	[2200, 0.22, 0.004],
	[3600, 0.12, 0.002],
];

/**
 * 共振部の「濃さ」。全サンプルの絶対値の合計（L1ノルム）をこの値に揃える。
 *
 * ここは**音量に直結する**ので触るときは注意が要る。畳み込みのゲインは
 * インパルス応答のL1ノルムで上から押さえられるので、直接音を 1.0 に固定して
 * 共振部のL1をこの値にしておけば、キャビ全体のゲインはおよそ `1 + CAB_COLOR`
 * を超えない。逆に**ピーク正規化（各サンプルの最大値で割る）はやってはいけない**
 * ——低域のモードは減衰が遅く同符号のサンプルが延々と続くので、ピークが1でも
 * 合計は数十倍になる。実測でチェーン全体のゲインが93倍になり、ギターが盛大に
 * 音割れした。
 */
const CAB_COLOR = 0.6;

/**
 * ギターキャビネットの疑似インパルス応答を合成する。
 * 先頭サンプルの直接音（＝全帯域を素通し）に、減衰する共振を薄く足したもの。
 * 共振部は直流成分を除いてから {@link CAB_COLOR} の量へ正規化する
 * （スピーカーは直流を再生できない＝実機のIRにも直流成分は無い）。
 * `ConvolverNode.normalize = false` と組み合わせて使う。
 */
export const createCabinetImpulse = (ctx: BaseAudioContext): AudioBuffer => {
	const rate = ctx.sampleRate;
	const length = Math.max(2, Math.floor(rate * CAB_IMPULSE_SEC));
	const impulse = ctx.createBuffer(1, length, rate);
	const data = impulse.getChannelData(0);
	for (let i = 1; i < length; i++) {
		const t = i / rate;
		let v = 0;
		for (const [freq, amp, tau] of CAB_MODES)
			v += amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * freq * t);
		data[i] = v;
	}
	// 直流成分を抜く。
	let mean = 0;
	for (let i = 1; i < length; i++) mean += data[i];
	mean /= length - 1;
	let l1 = 0;
	for (let i = 1; i < length; i++) {
		data[i] -= mean;
		l1 += Math.abs(data[i]);
	}
	// 共振部のL1を CAB_COLOR へ揃える。
	if (l1 > 0) {
		const scale = CAB_COLOR / l1;
		for (let i = 1; i < length; i++) data[i] *= scale;
	}
	data[0] = 1; // 直接音
	return impulse;
};

/**
 * チャンネルストリップへ差し込む音作り段。`input` へ繋ぎ、`output` から取り出す。
 * 差し替え（楽器変更）のたびに {@link ToneStage.dispose} で切り離す。
 */
export type ToneStage = {
	input: AudioNode;
	output: AudioNode;
	dispose: () => void;
};

/** ベースのパラレル歪みで、歪ませる帯域の下端・上端（Hz）。 */
const BASS_DRIVE_LOW_HZ = 110;
const BASS_DRIVE_HIGH_HZ = 2200;
/**
 * 歪んだ成分の混ぜ量と、その分だけ下げる原音の量。
 * ここは**倍音を増やすための処理であって、音量を上げるための処理ではない**。
 * 82Hzのノコギリ波で実測して、全体のRMSが +1.6dB に収まる配分にしてある
 * （この配分で 328Hz が +4.4dB、1.3kHz が +6.6dB、2kHz が +8.9dB 増える
 * ＝小型スピーカーで聞こえる帯域にだけ倍音が積み上がる）。
 */
const BASS_WET = 0.4;
const BASS_DRY = 0.8;
/** ベースの歪みの強さ。強くしすぎると音程感が消えるので、倍音が出る最小限に留める。 */
const BASS_DRIVE = 2.5;

/**
 * ベース用パラレル・サチュレーション。
 * `原音（やや下げる）` と `低域だけを歪ませた成分` を並列に混ぜる。
 */
export const createBassSaturator = (ctx: AudioContext): ToneStage => {
	const input = ctx.createGain();
	const output = ctx.createGain();

	const dry = ctx.createGain();
	dry.gain.value = BASS_DRY;
	input.connect(dry).connect(output);

	// 歪ませる帯域を切り出す（サブ低域を歪ませると音程が濁るので下も切る）。
	const bandLow = ctx.createBiquadFilter();
	bandLow.type = "highpass";
	bandLow.frequency.value = BASS_DRIVE_LOW_HZ;
	const bandHigh = ctx.createBiquadFilter();
	bandHigh.type = "lowpass";
	bandHigh.frequency.value = BASS_DRIVE_HIGH_HZ;

	const shaper = ctx.createWaveShaper();
	shaper.curve = createSaturationCurve(BASS_DRIVE);
	shaper.oversample = OVERSAMPLE;

	// 歪みが作る高次倍音のうち、耳障りな上の方を落としてから混ぜる。
	const tame = ctx.createBiquadFilter();
	tame.type = "lowpass";
	tame.frequency.value = 3500;
	// 歪みで生じる直流成分を除く（そのまま混ぜるとヘッドルームを食う）。
	const dcBlock = ctx.createBiquadFilter();
	dcBlock.type = "highpass";
	dcBlock.frequency.value = 30;

	const wet = ctx.createGain();
	wet.gain.value = BASS_WET;
	input
		.connect(bandLow)
		.connect(bandHigh)
		.connect(shaper)
		.connect(tame)
		.connect(dcBlock)
		.connect(wet)
		.connect(output);

	return {
		input,
		output,
		dispose: () => {
			for (const n of [
				input,
				dry,
				bandLow,
				bandHigh,
				shaper,
				tame,
				dcBlock,
				wet,
				output,
			])
				n.disconnect();
		},
	};
};

/** ギターキャビネットの帯域。実機の12インチスピーカーもおおむねこの範囲しか出さない。 */
const CAB_LOW_HZ = 90;
const CAB_HIGH_HZ = 5000;
/** コーンの鳴きを模したプレゼンス。ここを持ち上げると「アンプらしさ」が出る。 */
const CAB_PRESENCE_HZ = 2200;
const CAB_PRESENCE_DB = 3;
/**
 * ドライブ段の歪みの強さ。GM音源の「Distortion Guitar」は既に歪んだ音を録った
 * サンプルなので、ここで足すのはアンプの飽和感だけでよく、強くすると二重に歪んで
 * ただ潰れた音になる。
 */
const GUITAR_DRIVE = 1.5;
/**
 * キャビ通過後の出力補正。
 *
 * キャビは**音色を作る段であって、音量を上げる段ではない**。エンベロープを
 * AD-S-R化してサステインが伸びたぶん、同じ曲でもギターのRMSは元より上がる。
 * ここを 1.0 のままにするとその上乗せがそのまま残り、マスタのリミッタを
 * 余計に働かせてしまうので、実測（同じMMLでギタートラックだけを鳴らして比較）で
 * 改修前と同じ音量に収まる値にしてある。
 */
const CAB_MAKEUP = 0.8;

/**
 * ギター用キャビネットシミュレータ。`drive` を立てるとアンプの歪み段も通す。
 * 信号の流れは実機と同じ順序（歪み → スピーカー）にしてある——順序を逆にすると
 * 「スピーカーで削れた後の音を歪ませる」ことになり、実機では起きない音になる。
 */
export const createGuitarCabinet = (
	ctx: AudioContext,
	drive: boolean,
): ToneStage => {
	const input = ctx.createGain();
	const output = ctx.createGain();

	const nodes: AudioNode[] = [input, output];
	let head: AudioNode = input;
	if (drive) {
		const shaper = ctx.createWaveShaper();
		shaper.curve = createSaturationCurve(GUITAR_DRIVE);
		shaper.oversample = OVERSAMPLE;
		// tanh(k*x)/tanh(k) は小信号で k/tanh(k) 倍のゲインを持つ。その逆数を掛けて
		// 「小さい音は素通し・大きい音だけ潰れる」形にする（歪ませると音量まで
		// 上がる、という状態を避ける）。
		const comp = ctx.createGain();
		comp.gain.value = Math.tanh(GUITAR_DRIVE) / GUITAR_DRIVE;
		input.connect(shaper).connect(comp);
		nodes.push(shaper, comp);
		head = comp;
	}

	const low = ctx.createBiquadFilter();
	low.type = "highpass";
	low.frequency.value = CAB_LOW_HZ;
	const conv = ctx.createConvolver();
	conv.normalize = false; // IR側でピーク正規化済み
	conv.buffer = createCabinetImpulse(ctx);
	const high = ctx.createBiquadFilter();
	high.type = "lowpass";
	high.frequency.value = CAB_HIGH_HZ;
	const presence = ctx.createBiquadFilter();
	presence.type = "peaking";
	presence.frequency.value = CAB_PRESENCE_HZ;
	presence.Q.value = 1;
	presence.gain.value = CAB_PRESENCE_DB;
	const makeup = ctx.createGain();
	makeup.gain.value = CAB_MAKEUP;

	head
		.connect(low)
		.connect(conv)
		.connect(high)
		.connect(presence)
		.connect(makeup)
		.connect(output);
	nodes.push(low, conv, high, presence, makeup);

	return {
		input,
		output,
		dispose: () => {
			for (const n of nodes) n.disconnect();
		},
	};
};

/** 生の撥弦楽器に足すプレゼンス（弦の輪郭）とエア（空気感）。 */
const ACOUSTIC_PRESENCE_HZ = 3200;
const ACOUSTIC_PRESENCE_DB = 2.5;
const ACOUSTIC_AIR_HZ = 7000;
const ACOUSTIC_AIR_DB = 2;
/** 箱鳴りより下の、音楽的な意味を持たない低域を切る。 */
const ACOUSTIC_RUMBLE_HZ = 60;

/**
 * 生の撥弦楽器（アコギ・ハープ・琴など）向け。**装置は模擬しない**——サンプルは
 * 既に実物をマイクで録った音なので、足すべきものは「アンプ」でも「箱鳴り」でもなく、
 * ミックスで生ギターに掛けるのと同じEQだけ。
 */
export const createAcousticTone = (ctx: AudioContext): ToneStage => {
	const input = ctx.createGain();
	const output = ctx.createGain();
	const rumble = ctx.createBiquadFilter();
	rumble.type = "highpass";
	rumble.frequency.value = ACOUSTIC_RUMBLE_HZ;
	const presence = ctx.createBiquadFilter();
	presence.type = "peaking";
	presence.frequency.value = ACOUSTIC_PRESENCE_HZ;
	presence.Q.value = 0.9;
	presence.gain.value = ACOUSTIC_PRESENCE_DB;
	const air = ctx.createBiquadFilter();
	air.type = "highshelf";
	air.frequency.value = ACOUSTIC_AIR_HZ;
	air.gain.value = ACOUSTIC_AIR_DB;
	input.connect(rumble).connect(presence).connect(air).connect(output);
	return {
		input,
		output,
		dispose: () => {
			for (const n of [input, rumble, presence, air, output]) n.disconnect();
		},
	};
};

/** {@link InstrumentTone} に対応する音作り段を作る。`none` は null（素通し）。 */
export const createToneStage = (
	ctx: AudioContext,
	tone: InstrumentTone,
): ToneStage | null => {
	switch (tone) {
		case "bass":
			return createBassSaturator(ctx);
		case "guitar-clean":
			return createGuitarCabinet(ctx, false);
		case "guitar-drive":
			return createGuitarCabinet(ctx, true);
		case "acoustic":
			return createAcousticTone(ctx);
		default:
			return null;
	}
};
