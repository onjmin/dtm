/**
 * @credits rpgen3 https://rpgen3.github.io/soundfont/mjs/surikov/SoundFont.mjs (MIT)
 * https://github.com/surikov/webaudiofontdata/
 */
import { type InstrumentTone, toneForProgram } from "../amp-sim";
import { getScript } from "./import";

type Zone = {
	keyRangeLow: number;
	keyRangeHigh: number;
	sample?: string;
	file?: string;
	sampleRate: number;
	loopStart: number;
	loopEnd: number;
	coarseTune: number;
	fineTune: number;
	originalPitch: number;
	sustain: number;
	delay: number;
	buffer?: AudioBuffer;
	_param?: {
		playbackRate: number;
		max: number;
		src: { loop: boolean; loopStart?: number; loopEnd?: number };
	};
};

/**
 * エンベロープの型。**音作りの種別（{@link InstrumentTone}）とは別軸**で決める——
 * 「アンプを通すか」と「音がどう減衰するか」は本来無関係で、たとえばアコギと
 * ピアノは通す装置は違わない（どちらも素通し）が、どちらも撥弦・打弦で減衰する。
 *
 * - `bass` … 次の音までに必ず消す。締まった低音の条件。
 * - `pluck` … 撥弦・打弦・撥音（ピアノ／ギター／ハープ／民族楽器）。**サンプル自身が
 *   減衰を持っている**ので、エンベロープ側では減衰させず（サステインをほぼ1に保つ）、
 *   離鍵後の尾ひれだけ短く切る。ここを下げるとサンプルの減衰と二重に掛かって痩せる。
 * - `sustain` … 弓・管・オルガン・パッド。鳴らし続ける音なので余韻も長めに残す。
 */
type EnvKind = "bass" | "pluck" | "sustain";

/** 1音の振幅エンベロープ（アタックは全楽器共通なので持たない）。 */
type Envelope = {
	/** ピークからサステインまで落ちるのに掛ける秒数。 */
	decaySec: number;
	/** サステインの高さ（ピークに対する比）。 */
	sustain: number;
	/** ノートオフから消えるまでの秒数。 */
	releaseSec: number;
};

export class SoundFont {
	static fonts = new Map<string, SoundFont>();
	static ch = -1;

	// ── 振幅エンベロープ（AD-S-R）──
	// 旧実装は「5msで立ち上げて、音符の終わり+0.5秒に向けて直線でゼロへ落とす」
	// という1本のフェードだけだった。サステインが無いので、BPM132の4分音符なら
	// 音符の終わりで既に振幅52%（-5.6dB）まで落ちている。撥弦のサンプルはそれ自体が
	// 減衰するので**減衰が二重に掛かり**、とくにベースが痩せて聞こえる原因になっていた。
	// さらにリリースが全楽器一律0.5秒だったため、8分のベースだと尾ひれが次の2音に
	// 被って低域が濁っていた（実際の奏者は弾いたら止める）。
	// ここではアタック→ディケイ→サステイン→リリースの形にし、リリースは楽器の
	// ファミリごとに変える。
	/** アタック（無音からピークまで）秒。クリック防止の最小限。全楽器共通。 */
	static attackSec = 0.005;
	/** 減衰の型ごとのエンベロープ。 */
	static envelopes: Record<EnvKind, Envelope> = {
		bass: { decaySec: 0.06, sustain: 0.9, releaseSec: 0.12 },
		pluck: { decaySec: 0.1, sustain: 0.95, releaseSec: 0.18 },
		sustain: { decaySec: 0.15, sustain: 0.85, releaseSec: 0.35 },
	};

	// ── ヒューマナイズ（疑似ラウンドロビン）──
	// サンプルを複数持たない代わりに、発音のたびピッチと音量をごく僅かにランダムへ
	// ブレさせて「毎回寸分違わず同じ波形」という機械的な均一さを崩す。
	/** 発音ごとのピッチ微揺らぎ幅（セント、±この値の範囲で一様乱数）。 */
	static humanizeDetuneCents = 4;
	/** 発音ごとの音量微揺らぎ幅（比率、0.06 = ±6%の範囲で一様乱数）。 */
	static humanizeGainRatio = 0.06;

	// ── ドラムの疑似ラウンドロビン ──
	// 市販のドラム音源（Steven Slate Drums 5 は最大24ベロシティレイヤー×各12テイク）が
	// 機械的に聞こえないのは、同じ強さの連打でも毎回**違う波形**が鳴るため。こちらは
	// 1キー1サンプルしか持てないので、代わりに1発ごとに「再生開始位置・音量・ピッチ・
	// 高域の傾き」をわずかにずらして、同一波形の連打であることを見えにくくする。
	// 開始位置をずらすのはアタックの立ち上がりの角度が毎回変わるからで、これが
	// 「別のテイク感」に一番効く。ただしずらしすぎるとアタックそのものを削るので数ms。
	/** 1発ごとの再生開始位置のずれ幅（秒、0〜この値の一様乱数）。 */
	static drumRoundRobinOffsetSec = 0.0025;
	/** 1発ごとの音量揺らぎ幅（比率）。メロディ楽器より少し広く取る。 */
	static drumHumanizeGainRatio = 0.09;
	/** 1発ごとのピッチ揺らぎ幅（セント）。太鼓の「大きさ」がわずかに変わって聞こえる。 */
	static drumHumanizeDetuneCents = 10;
	/** 1発ごとの音色の傾きを作るピーキングフィルタの中心周波数(Hz)と最大ゲイン(dB)。 */
	static drumTiltHz = 3000;
	static drumTiltMaxDb = 1.5;

	// ── ベロシティ→明るさ連動フィルタ ──
	// velocity は音量にしか効かず音色（明るさ）が変わらないのを補うため、
	// ローパスのカットオフを velocity に連動させる（弱いほど丸く、強いほど明るく）。
	// 連動元は必ず velocity であって volume ではない。volume には
	// 「トラック音量フェーダー×velocity」が既に畳み込まれている（sequencer.ts参照）ため、
	// volume を使うとフェーダーを下げただけで音色まで暗くなり、音量がゲインと音色へ
	// 二重に効いてしまう。音量フェーダーは音色を変えてはならない。
	/** velocity=0 のときのローパスカットオフ(Hz)。 */
	static brightnessMinHz = 2400;
	/** velocity=127 のときのローパスカットオフ(Hz)。サンプルの帯域を実質塞がない値。 */
	static brightnessMaxHz = 20000;
	/** ベロシティ→明るさフィルタのQ値。共鳴が付かないButterworth特性。 */
	static brightnessQ = Math.SQRT1_2;
	/**
	 * この明るさ比率以上ならフィルタ自体を挿入しない。最強ベロシティの音は改修前と
	 * 完全に同一の信号経路を通り、余計な音痩せや位相変化が起きないようにするため。
	 */
	static brightnessBypassAbove = 0.98;
	/**
	 * 1音ごとにカットオフを振る幅（比率）。ドラムと同じ狙いの疑似ラウンドロビンで、
	 * 同じ高さ・同じ強さの音を連打しても毎回わずかに音色が変わるようにする
	 * （市販音源が持つラウンドロビン——Shreddage 3 なら1音につきダウン/アップ各4本——
	 * の代わり。こちらはサンプルが1本しか無いので、鳴らし方の側で崩す）。
	 */
	static brightnessJitterRatio = 0.1;
	/**
	 * ベースだけは別のカーブを使う。既定の下限2400Hzでは velocity 44 でも
	 * カットオフが8.5kHzあり、**弱く弾いた音が暗くならない**——つまりゴーストノートや
	 * デッドノート（弦に触れて音程を殺した打点）が「ただ音量の小さい普通の音」に
	 * なってしまう。ベースは強弱で音色が最も変わる楽器なので、下限をぐっと下げ、
	 * さらに対数補間（`min * (max/min)^brightness`）にして弱い側の変化を大きくする。
	 */
	static bassBrightnessMinHz = 500;
	static bassBrightnessMaxHz = 14000;

	// ── ロングトーン用ビブラート(ピッチLFO) ──
	// 伸ばす音が完全に静止していると不自然に聞こえるため、一定長以上持続する
	// 音符にだけ、発音直後フェードインしつつ穏やかなピッチ揺れを掛ける。
	// 閾値・速さは歌声合成側の vibrato.ts (VIBRATO_MIN_SEC/VIBRATO_RATE_HZ) と
	// 同じ考え方だが、MIDI楽器はここでは独立した定数として持つ
	// （koeのCurveInput契約に縛られない汎用のWeb Audio LFOのため）。
	/** ロングトーン判定の最短秒数。これ未満の音符にはビブラートを掛けない。 */
	static longToneThresholdSec = 0.35;
	/** ロングトーンビブラートの速さ(Hz)。 */
	static vibratoRateHz = 5.5;
	/** ロングトーンビブラートの深さ(セント)。歌声用(±35セント)より控えめ。 */
	static vibratoDepthCents = 12;
	/** ロングトーンビブラートのフェードイン秒数。発音直後は素直な音程を保つ。 */
	static vibratoFadeSec = 0.2;

	static toURL(fontName: string): string {
		return `https://surikov.github.io/webaudiofontdata/sound/${fontName}.js`;
	}

	static async load({
		ctx,
		fontName,
		url,
		isDrum = false,
		pitchs,
	}: {
		ctx: AudioContext;
		fontName: string;
		url: string;
		isDrum?: boolean;
		pitchs?: number[];
	}): Promise<SoundFont> {
		if (!(fontName in window)) await getScript(url);
		if (!(fontName in window)) throw new Error("SoundFont is not found.");
		const { fonts } = SoundFont;
		if (!fonts.has(fontName)) {
			const zones = new Map<number, Zone>();
			let ch = -1;
			const win = window as unknown as Record<string, { zones: Zone[] }>;
			for (const [pitch, v] of await findZone(
				ctx,
				fontName,
				win[fontName].zones,
				pitchs,
			)) {
				if (!v.buffer) continue;
				const { numberOfChannels } = v.buffer;
				if (ch < numberOfChannels) ch = numberOfChannels;
				zones.set(Number(pitch), v);
			}
			if (SoundFont.ch < ch) SoundFont.ch = ch;
			fonts.set(
				fontName,
				new SoundFont(zones, ch, isDrum, toneOf(fontName), envKindOf(fontName)),
			);
		}
		const result = fonts.get(fontName);
		if (!result) throw new Error("SoundFont load failed.");
		return result;
	}

	constructor(
		private zones: Map<number, Zone>,
		public ch: number,
		public isDrum: boolean,
		/**
		 * この音源に合った音作りの種別（GMプログラム番号から判定）。エンベロープと
		 * ビブラートの要否をここで決めるほか、`studio.ts` がトラックの
		 * チャンネルストリップへ挿す段（ベースの歪み／ギターのキャビ）にも使う。
		 */
		public tone: InstrumentTone = "none",
		/** 減衰の型。エンベロープの選択に使う（{@link SoundFont.envelopes}）。 */
		public envKind: EnvKind = "sustain",
	) {}

	play({
		ctx,
		destination,
		pitch = 60,
		volume = 1.0,
		velocity,
		detuneCents = 0,
		when = 0.0,
		duration = 1.0,
	}: {
		ctx?: AudioContext;
		destination?: AudioNode;
		pitch?: number;
		volume?: number;
		/**
		 * 元ノートのベロシティ 0-127。ベロシティ→明るさ連動にのみ使い、音量には影響しない
		 * （音量は volume が担う）。未指定なら最強打として扱いフィルタを挿入しないので、
		 * velocity を渡さない既存の呼び出し元は改修前と同じ信号経路のままになる。
		 */
		velocity?: number;
		/**
		 * ピッチの微調整（セント）。31平均律のように整数MIDIノート番号へ乗らない音高は、
		 * 最寄りのゾーンを鳴らして残差をここで補正する。31平均律での残差は最大±48.4セントで、
		 * detune の可動域に十分収まる。
		 */
		detuneCents?: number;
		when?: number;
		duration?: number;
	} = {}): void {
		ctx ??= new AudioContext();
		destination ??= ctx.destination;
		const { zones, isDrum } = this;
		if (!zones.has(pitch)) return;
		const zone = zones.get(pitch);
		if (!zone) return;
		const src = ctx.createBufferSource();
		const g = ctx.createGain();
		const _when = when + ctx.currentTime;
		const { buffer, _param } = zone;
		if (!buffer || !_param) return;
		src.buffer = buffer;
		src.playbackRate.setValueAtTime(_param.playbackRate, 0);
		Object.assign(src, _param.src);

		// ヒューマナイズ: 発音ごとにピッチと音量をごく僅かにランダムへブレさせる。
		// ドラムは1キー1サンプルで同じ波形の連打になりやすいため、揺らぎ幅を広く取り、
		// さらに再生開始位置もずらす（疑似ラウンドロビン）。
		const humanizeCents =
			(Math.random() * 2 - 1) *
			(isDrum
				? SoundFont.drumHumanizeDetuneCents
				: SoundFont.humanizeDetuneCents);
		const humanizeGainMul =
			1 +
			(Math.random() * 2 - 1) *
				(isDrum
					? SoundFont.drumHumanizeGainRatio
					: SoundFont.humanizeGainRatio);
		src.detune.setValueAtTime(humanizeCents + detuneCents, 0);
		const effectiveVolume = volume * humanizeGainMul;
		// 開始位置のずれ。長さもそのぶん縮むので、終端の計算にも同じ値を使う。
		const startOffsetSec = isDrum
			? Math.random() * SoundFont.drumRoundRobinOffsetSec
			: 0;

		// 音色を1発／1音ごとに変えるフィルタ。
		// - 楽器: ベロシティ→明るさ連動（弱いほど丸く、強いほど明るく）。連動元は
		//   velocity のみで、volume（＝トラック音量フェーダー込み）は使わない。
		//   velocity 未指定の呼び出し元は最強打扱いにしてフィルタを挿入しない。
		// - ドラム: 高域の傾きを1発ごとにわずかに振る（別テイクらしさ）。
		const brightness =
			velocity === undefined ? 1 : Math.max(0, Math.min(1, velocity / 127));
		const needsBrightness =
			!isDrum && brightness < SoundFont.brightnessBypassAbove;
		const filter =
			needsBrightness || isDrum ? ctx.createBiquadFilter() : undefined;
		if (filter && isDrum) {
			filter.type = "peaking";
			filter.frequency.setValueAtTime(SoundFont.drumTiltHz, 0);
			filter.Q.setValueAtTime(1, 0);
			filter.gain.setValueAtTime(
				(Math.random() * 2 - 1) * SoundFont.drumTiltMaxDb,
				0,
			);
		} else if (filter) {
			// ベースだけは下限を下げた対数カーブ。弱く弾いた音がきちんと暗くなる
			// （＝ゴースト／デッドノートが表現できる）ようにするため。
			const isBass = this.tone === "bass";
			const minHz = isBass
				? SoundFont.bassBrightnessMinHz
				: SoundFont.brightnessMinHz;
			const maxHz = isBass
				? SoundFont.bassBrightnessMaxHz
				: SoundFont.brightnessMaxHz;
			const base = isBass
				? minHz * (maxHz / minHz) ** brightness
				: minHz + (maxHz - minHz) * brightness;
			const jitter =
				1 + (Math.random() * 2 - 1) * SoundFont.brightnessJitterRatio;
			filter.type = "lowpass";
			filter.frequency.setValueAtTime(base * jitter, 0);
			filter.Q.setValueAtTime(SoundFont.brightnessQ, 0);
		}

		// ── 振幅エンベロープ（AD-S-R）──
		// Start with 0 volume at currentTime to avoid clicking on connection
		g.gain.setValueAtTime(0, ctx.currentTime);
		const startGainTime = Math.max(ctx.currentTime, _when);
		g.gain.setValueAtTime(0, startGainTime);

		const env =
			SoundFont.envelopes[this.envKind] ?? SoundFont.envelopes.sustain;
		// ループしないサンプルはバッファの終わりより先へは伸ばせない。
		const limit = src.loop
			? Number.POSITIVE_INFINITY
			: _when + _param.max - startOffsetSec;
		// 各点は「直前の点以降」かつ「サンプルの終わり以前」に収める。こうしないと
		// 短いサンプルでオートメーションの時刻が前後してエンベロープが壊れる。
		const attackEnd = Math.min(startGainTime + SoundFont.attackSec, limit);
		const decayEnd = Math.min(
			Math.max(attackEnd, attackEnd + env.decaySec),
			limit,
		);
		const noteOff = Math.min(Math.max(decayEnd, _when + duration), limit);
		const end = isDrum
			? _when + buffer.duration - startOffsetSec
			: Math.max(Math.min(noteOff + env.releaseSec, limit), noteOff + 0.001);

		if (!isDrum) {
			const sustainVolume = effectiveVolume * env.sustain;
			g.gain.linearRampToValueAtTime(effectiveVolume, attackEnd);
			g.gain.linearRampToValueAtTime(sustainVolume, decayEnd);
			g.gain.setValueAtTime(sustainVolume, noteOff);
			g.gain.linearRampToValueAtTime(0, end);
		} else {
			g.gain.linearRampToValueAtTime(effectiveVolume, attackEnd);
		}

		if (filter) src.connect(filter).connect(g);
		else src.connect(g);
		g.connect(destination);

		// ロングトーン用ビブラート: 歌モノ以外のMIDI楽器は伸ばす音が完全に静止していた
		// ため、一定長以上の音符にだけ発音直後フェードインしつつピッチLFOを掛ける。
		let vibratoOsc: OscillatorNode | undefined;
		let vibratoDepth: GainNode | undefined;
		// ベースは対象外。低い音のピッチが揺れると音程の芯がぼやけ、低域の輪郭が
		// 濁るだけで得が無い（実際のベーシストもロングトーンで常時ビブラートはしない）。
		if (
			!isDrum &&
			this.tone !== "bass" &&
			duration >= SoundFont.longToneThresholdSec
		) {
			vibratoOsc = ctx.createOscillator();
			vibratoOsc.type = "sine";
			vibratoOsc.frequency.setValueAtTime(SoundFont.vibratoRateHz, 0);
			vibratoDepth = ctx.createGain();
			vibratoDepth.gain.setValueAtTime(0, startGainTime);
			vibratoDepth.gain.linearRampToValueAtTime(
				SoundFont.vibratoDepthCents,
				startGainTime + SoundFont.vibratoFadeSec,
			);
			vibratoOsc.connect(vibratoDepth).connect(src.detune);
			vibratoOsc.start(_when);
			vibratoOsc.stop(end);
		}

		src.start(_when, startOffsetSec);
		src.stop(end);

		src.onended = () => {
			src.disconnect();
			filter?.disconnect();
			g.disconnect();
			vibratoOsc?.disconnect();
			vibratoDepth?.disconnect();
		};
	}
}

const findZone = (
	ctx: AudioContext,
	fontName: string,
	zones: Zone[],
	pitchs: number[] = [],
): Promise<[number, Zone][]> => {
	if (!pitchs.length)
		for (const zone of zones) {
			const low = zone.keyRangeLow | 0,
				high = zone.keyRangeHigh | 0;
			if (low > high) continue;
			for (let i = low; i <= high; i++) pitchs.push(i);
		}
	const set = new Set(pitchs);
	const map = new Map<number, Zone>(pitchs.map((v) => [v, zones[0]]));
	for (let i = zones.length - 1; i >= 0; i--)
		for (const v of set) {
			const zone = zones[i];
			if (v < zone.keyRangeLow || v > zone.keyRangeHigh) continue;
			set.delete(v);
			map.set(v, { ...zone });
		}
	return Promise.all(
		[...map].map(async ([k, v]) => {
			await adjustZone(ctx, fontName, v);
			await addParam(v, k);
			return [k, v] as [number, Zone];
		}),
	);
};

/**
 * WebAudioFontのフォント名（例: `_tone_0330_FluidR3_GM_sf2_file`）から
 * GMプログラム番号を取り出す。取り出せなければ null。
 */
const programOf = (fontName: string): number | null => {
	const match = fontName.match(/_tone_(\d+)_/);
	if (!match) return null;
	return Math.floor(Number(match[1]) / 10);
};

/** フォント名 → 音作りの種別。取り出せなければ `none`。 */
const toneOf = (fontName: string): InstrumentTone => {
	const program = programOf(fontName);
	return program === null ? "none" : toneForProgram(program);
};

/** フォント名 → 減衰の型。取り出せなければ「鳴らし続ける音」として扱う。 */
const envKindOf = (fontName: string): EnvKind => {
	const program = programOf(fontName);
	if (program === null) return "sustain";
	// シンセベース（38-39）も含めてベースは同じ扱い（低域は短く切る）。
	if (32 <= program && program <= 39) return "bass";
	return isDecayProgram(program) ? "pluck" : "sustain";
};

/** 減衰する（＝鳴らしっぱなしにならない）楽器か。 */
const isDecayProgram = (program: number): boolean => {
	if (0 <= program && program <= 15) return true; // Pianos, Chromatic Percussion
	if (24 <= program && program <= 37) return true; // Guitars, Basses (Synth Bass 38, 39 are sustain)
	if (program === 46) return true; // Harp
	if (104 <= program && program <= 119) return true; // Ethnic, Percussive
	return false;
};

const isDecayInstrument = (fontName: string): boolean => {
	const program = programOf(fontName);
	return program === null ? false : isDecayProgram(program);
};

const adjustZone = async (
	ctx: AudioContext,
	fontName: string,
	zone: Zone,
): Promise<void> => {
	if (zone.buffer) return;
	zone.delay = 0;
	if (zone.sample) {
		const decoded = atob(zone.sample);
		zone.buffer = ctx.createBuffer(1, decoded.length / 2, zone.sampleRate);
		const a = zone.buffer.getChannelData(0);
		for (let i = 0; i < decoded.length / 2; i++) {
			let b1 = decoded.charCodeAt(i * 2),
				b2 = decoded.charCodeAt(i * 2 + 1);
			if (b1 < 0) b1 = 0x100 + b1;
			if (b2 < 0) b2 = 0x100 + b2;
			let n = b2 * 0x100 + b1;
			if (n >= 0x10000 / 2) n = n - 0x10000;
			a[i] = n / 0x10000;
		}
	} else if (zone.file) {
		const bytes = Uint8Array.from(atob(zone.file), (c) => c.charCodeAt(0));
		const buf = bytes.buffer;

		// macOS Safari はスリープ復帰後に AudioContext を "interrupted" 状態にする。
		// その状態で decodeAudioData を呼ぶと "null is not an object" エラーになるため、
		// interrupted のときだけ resume を試みる（"suspended" は autoplay 制限で resume が
		// ユーザー操作なしに完了しないため除外する）。
		if ((ctx.state as string) === "interrupted") {
			try {
				await ctx.resume();
			} catch {}
		}
		try {
			zone.buffer = await ctx.decodeAudioData(buf);
		} catch (e) {
			console.error(
				`[zone.file format] keyRange: ${zone.keyRangeLow}-${zone.keyRangeHigh} - Decode failed:`,
				e,
			);
			throw e;
		}
	}

	// ループ拡張ロジック（Safari等の超短周期ループバグ対策）
	// ループ範囲が30ms（0.03秒）未満の場合、ループ部分を自前で複製して引き伸ばす
	if (zone.buffer && zone.loopStart >= 1 && zone.loopStart < zone.loopEnd) {
		const loopLenSeconds = (zone.loopEnd - zone.loopStart) / zone.sampleRate;
		if (loopLenSeconds < 0.03) {
			const oldBuf = zone.buffer;
			const sampleRate = oldBuf.sampleRate;
			const rateRatio = sampleRate / zone.sampleRate;
			const loopStartFrame = Math.round(zone.loopStart * rateRatio);
			const loopEndFrame = Math.round(zone.loopEnd * rateRatio);
			const loopLengthFrame = loopEndFrame - loopStartFrame;

			if (loopLengthFrame > 0) {
				const minLoopLenFrame = Math.round(0.2 * sampleRate); // 0.2秒（200ms）を目標にする
				const repeatCount = Math.ceil(minLoopLenFrame / loopLengthFrame);
				const attackLength = Math.min(loopStartFrame, oldBuf.length);
				const releaseLength = Math.max(0, oldBuf.length - loopEndFrame);
				const newLength =
					attackLength + loopLengthFrame * repeatCount + releaseLength;
				let totalPeak = 0;
				let loopPeak = 0;
				// 全チャンネルを見てピークを取る（ch0だけだとステレオでピークが
				// 右chに寄っているサンプルの判定がずれるため）
				for (let ch = 0; ch < oldBuf.numberOfChannels; ch++) {
					const chData = oldBuf.getChannelData(ch);
					for (let i = 0; i < chData.length; i++) {
						const abs = Math.abs(chData[i]);
						if (abs > totalPeak) totalPeak = abs;
						if (i >= loopStartFrame && i < loopEndFrame) {
							if (abs > loopPeak) loopPeak = abs;
						}
					}
				}

				// ゲイン補正倍率の計算
				// 減衰系楽器（ピアノ・ギター・ベース等）はループ部分が静かいのが自然な
				// 場合も多いため、完全に補正を切るのではなく控えめな目標値に留める。
				// これにより「バグでたまたま無音に近いループ点を掴んだ」場合の
				// 過度な音量低下は緩和しつつ、自然な減衰感は大きく損なわない。
				const decay = isDecayInstrument(fontName);
				const targetRatio = decay ? 0.4 : 0.75;
				const maxMultiplier = decay ? 6.0 : 20.0;
				let gainMultiplier = 1.0;
				if (loopPeak > 0 && totalPeak > 0 && loopPeak < totalPeak * 0.8) {
					gainMultiplier = (totalPeak * targetRatio) / loopPeak;
					if (gainMultiplier > maxMultiplier) gainMultiplier = maxMultiplier; // 過剰増幅によるクリップ防止
				}

				try {
					const newBuf = ctx.createBuffer(
						oldBuf.numberOfChannels,
						newLength,
						sampleRate,
					);
					for (let ch = 0; ch < oldBuf.numberOfChannels; ch++) {
						const oldData = oldBuf.getChannelData(ch);
						const newData = newBuf.getChannelData(ch);

						// アタック部分をコピーしつつ、ゲイン補正倍率を 1.0 から gainMultiplier へ緩やかに遷移させる
						// これにより、アタック（等倍）からループ（ブースト）への切り替わりでのクリックノイズを完全に防止する
						for (let i = 0; i < attackLength; i++) {
							const ratio = attackLength > 1 ? i / (attackLength - 1) : 0;
							const m = 1.0 + (gainMultiplier - 1.0) * ratio;
							newData[i] = oldData[i] * m;
						}

						// ループ部分を複製して充填（ゲイン補正を適用）
						let offset = attackLength;
						const loopData = oldData.subarray(loopStartFrame, loopEndFrame);
						const normalizedLoopData = new Float32Array(loopLengthFrame);
						for (let i = 0; i < loopLengthFrame; i++) {
							normalizedLoopData[i] = loopData[i] * gainMultiplier;
						}

						for (let r = 0; r < repeatCount; r++) {
							newData.set(normalizedLoopData, offset);
							offset += loopLengthFrame;
						}

						// リリース部分をコピー（ゲイン補正を適用）
						if (releaseLength > 0 && loopEndFrame < oldBuf.length) {
							const releaseData = oldData.subarray(loopEndFrame);
							if (gainMultiplier !== 1.0) {
								const normalizedRelease = new Float32Array(releaseLength);
								for (let i = 0; i < releaseLength; i++) {
									normalizedRelease[i] = releaseData[i] * gainMultiplier;
								}
								newData.set(normalizedRelease, offset);
							} else {
								newData.set(releaseData, offset);
							}
						}
					}

					zone.buffer = newBuf;
					zone.loopEnd =
						zone.loopStart + (loopLengthFrame / rateRatio) * repeatCount;
				} catch (e) {
					console.warn(
						"[SoundFont.loopExtension] Failed to extend loop buffer:",
						e,
					);
				}
			}
		}
	}

	for (const [k, v] of [
		["loopStart", 0],
		["loopEnd", 0],
		["coarseTune", 0],
		["fineTune", 0],
		["originalPitch", 6000],
		["sampleRate", 44100],
		["sustain", 0],
	] as [keyof Zone, number][]) {
		if (Number.isNaN(Number(zone[k]))) (zone[k] as number) = v;
	}
};

const addParam = (zone: Zone, pitch: number): void => {
	const {
		originalPitch,
		loopStart,
		loopEnd,
		coarseTune,
		fineTune,
		sampleRate,
		delay,
		buffer,
	} = zone;
	const baseDetune = originalPitch - 100 * coarseTune - fineTune;
	const playbackRate = 2 ** ((100 * pitch - baseDetune) / 1200);
	const max = (buffer?.duration ?? 0) / playbackRate;
	const src: { loop: boolean; loopStart?: number; loopEnd?: number } = {
		loop: loopStart >= 1 && loopStart < loopEnd,
	};
	if (src.loop)
		[src.loopStart, src.loopEnd] = [loopStart, loopEnd].map(
			(v) => v / sampleRate + delay,
		);
	zone._param = { playbackRate, max, src };
};
