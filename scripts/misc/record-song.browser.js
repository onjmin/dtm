/**
 * 編集画面（demo/、`pnpm dev`）で読み込んだ曲を、**スピーカーへ出さずに**録音して小節ごとに測る。
 * ブラウザのコンソール（エージェントはブラウザの JavaScript 実行）へこのファイルの中身を貼って使う。手順は scripts/README.md。
 *
 *   __recordSong("full", 140)                  // 曲の長さ＋数秒。結果は window.__rec.full
 *   __recordVariant("lead", [0], false, 72)   // トラック 0 だけ・ドラム無しで録る（パート単体）
 *   window.__rec                               // { full: { status, sec, bars: [[小節, RMS, K特性, 2-6kHz, ピーク], ...] } }
 *
 * - **再生の前に必ず出力を切る**（`setSinkId({ type: "none" })`）。切れなかったら再生しない。処理と録音は実時間で進む。
 * - エージェントのブラウザ操作は 1 回 45 秒で切れるので、録音は非同期で始めて結果を window.__rec へ置き、別の呼び出しで取りに行く。
 * - 曲は `#g.…` で開いてから `location.reload()` する（同じページでハッシュだけ変えても読み直さない）。
 * - 値は dB。K 特性は 38 Hz ハイパス＋1.5 kHz 以上 +4 dB の棚で近似。マスタのリミッターで全体はほぼ一定になるので、
 *   パート間の比較は 2〜6 kHz 帯や「そのパートを抜いた版」との差で見る。
 */
(() => {
	const studio = window.studio;
	const daw = window.daw;
	if (!studio || !daw)
		throw new Error("編集画面（window.studio / window.daw）で実行してください");
	window.__rec = window.__rec ?? {};

	const mute = async () => {
		const ctx = studio.audioContext;
		if (typeof ctx.setSinkId !== "function")
			throw new Error(
				"setSinkId が無いブラウザでは出力を切れないので録音しない",
			);
		if (typeof ctx.sinkId !== "object" || ctx.sinkId?.type !== "none")
			await ctx.setSinkId({ type: "none" });
		if (typeof ctx.sinkId !== "object" || ctx.sinkId?.type !== "none")
			throw new Error("出力を切れなかったので録音しない");
		// 切り替えの瞬間に suspended になる
		if (ctx.state !== "running") await ctx.resume();
	};

	const analyze = async (blob) => {
		const buf = await studio.audioContext.decodeAudioData(
			await blob.arrayBuffer(),
		);
		const { sampleRate: sr, length: len } = buf;
		const render = async (chain) => {
			const oc = new OfflineAudioContext(buf.numberOfChannels, len, sr);
			const src = oc.createBufferSource();
			src.buffer = buf;
			chain(oc, src).connect(oc.destination);
			src.start();
			return oc.startRendering();
		};
		const biquad = (oc, type, freq, gain = 0) => {
			const f = oc.createBiquadFilter();
			f.type = type;
			f.frequency.value = freq;
			f.gain.value = gain;
			return f;
		};
		const k = await render((oc, src) => {
			const hp = biquad(oc, "highpass", 38);
			const shelf = biquad(oc, "highshelf", 1500, 4);
			src.connect(hp).connect(shelf);
			return shelf;
		});
		const band = await render((oc, src) => {
			const hp = biquad(oc, "highpass", 2000);
			const lp = biquad(oc, "lowpass", 6000);
			src.connect(hp).connect(lp);
			return lp;
		});
		const chans = (b) =>
			Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
		const [raw, kw, bd] = [chans(buf), chans(k), chans(band)];
		let onset = 0;
		outer: for (let i = 0; i < len; i++)
			for (const c of raw)
				if (Math.abs(c[i]) > 1e-3) {
					onset = i;
					break outer;
				}
		const db = (x) => (x > 0 ? +(10 * Math.log10(x)).toFixed(1) : -120);
		return { sr, len, onset, raw, kw, bd, db };
	};

	const perBar = ({ sr, len, onset, raw, kw, bd, db }, bpm) => {
		const barLen = Math.round((sr * 240) / bpm);
		const bars = [];
		for (let b = 0, s = onset; s < len; b++, s += barLen) {
			const e = Math.min(len, s + barLen);
			let r = 0,
				kk = 0,
				bb = 0,
				pk = 0,
				n = 0;
			for (let i = s; i < e; i++)
				for (let c = 0; c < raw.length; c++) {
					r += raw[c][i] ** 2;
					kk += kw[c][i] ** 2;
					bb += bd[c][i] ** 2;
					pk = Math.max(pk, Math.abs(raw[c][i]));
					n++;
				}
			bars.push([
				b + 1,
				db(r / n),
				db(kk / n),
				db(bb / n),
				+(20 * Math.log10(pk || 1e-6)).toFixed(1),
			]);
		}
		return {
			sec: +(len / sr).toFixed(1),
			onsetSec: +(onset / sr).toFixed(2),
			bars,
		};
	};

	const currentBpm = async () => {
		let m = await daw.getMML();
		if (m && typeof m === "object") m = m.full;
		// トラック行の先頭のテンポ（"@0 t145 v108 …"）。ヘッダの "#t0inst=" に当てない
		const bpm = Number(/^@\d+\s+t(\d+)/m.exec(m)?.[1]);
		if (!(bpm > 0)) throw new Error("MML からテンポを読めなかった");
		return bpm;
	};

	window.__recordSong = (label, seconds) => {
		window.__rec[label] = { status: "recording" };
		(async () => {
			try {
				await mute();
				const bpm = await currentBpm();
				studio.startWavRecording();
				await daw.play();
				await new Promise((r) => setTimeout(r, seconds * 1000));
				daw.stop();
				const blob = await studio.stopWavRecording();
				window.__rec[label] = { status: "analyzing" };
				window.__rec[label] = {
					status: "done",
					bpm,
					...perBar(await analyze(blob), bpm),
				};
			} catch (e) {
				daw.stop?.();
				window.__rec[label] = {
					status: "error",
					message: String(e?.stack ?? e),
				};
			}
		})();
		return `${label}: 録音を始めた（${seconds} 秒）`;
	};

	/** 今の曲からトラックを選んだ版を読み込んで録る。終わったら元の曲へ戻す。 */
	window.__recordVariant = (label, keepTracks, withDrums, seconds) => {
		window.__rec[label] = { status: "loading" };
		(async () => {
			const full = (await daw.getMML()).full;
			const [head, ...body] = full.split(";\n");
			const variant = [
				withDrums ? head : head.replace(/#drum=\S+/, "#drum=none"),
				...body.filter((p) => {
					const m = /^@(\d+) /.exec(p);
					return !m || keepTracks.includes(Number(m[1]));
				}),
			].join(";\n");
			await daw.loadMML(variant);
			await new Promise((r) => setTimeout(r, 1500));
			window.__recordSong(label, seconds);
			while (["recording", "analyzing"].includes(window.__rec[label].status))
				await new Promise((r) => setTimeout(r, 1000));
			await daw.loadMML(full);
		})();
		return `${label}: トラック ${keepTracks.join(",")}${withDrums ? "＋ドラム" : ""} で録音を始めた`;
	};
	return "__recordSong / __recordVariant を用意した（再生の前に出力を切る）";
})();
