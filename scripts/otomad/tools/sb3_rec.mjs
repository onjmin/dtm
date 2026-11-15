// 自作の Scratch 作品（.sb3）を、コマ落ちなしで動画に録る。
//   node scripts/otomad/tools/sb3_rec.mjs <作品.sb3> <出力.mp4> [--seconds 60] [--fps 30] [--size 1440x1080] [--flags 1] [--pad16x9] [--no-audio]
//
// しくみ: ヘッドレスの Edge で turbowarp.org を開き、DevTools の通信（CDP）で sb3 を読ませる。Scratch の時計
// （performance.now・Date.now）を差し替えて実行を止め、1コマずつ vm.runtime._step() を回して描いたコマを PNG で受け取る。
// 実時間に縛られないので、重い作品でも 30fps ちょうどで全コマ録れる。
// 音は鳴らさず、「音を鳴らす」の呼び出しを時刻つきで記録し、終わってから OfflineAudioContext で同じ時刻に並べて WAV にする
// （音量ブロックは反映、音の効果（ピッチ・パン）は未対応）。「終わるまで音を鳴らす」は記録した長さで待つ。
// --seconds を省くと、スクリプトが全部止まった時点（最長 600 秒）で終わる。--flags は緑の旗を押す回数（1秒おき）。
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, def) => {
	const i = argv.indexOf(`--${name}`);
	return i < 0 ? def : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const [sb3, out] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--pad16x9", "--no-audio"].includes(argv[i - 1])));
if (!sb3 || !out) {
	console.error("使い方: node scripts/otomad/tools/sb3_rec.mjs <作品.sb3> <出力.mp4> [--seconds N] [--fps 30] [--size 1440x1080] [--flags 1] [--pad16x9] [--no-audio]");
	process.exit(1);
}
const FPS = Number(opt("fps", 30));
const SECONDS = opt("seconds", null) == null ? null : Number(opt("seconds"));
const [W, H] = opt("size", "1440x1080").split("x").map(Number);
const FLAGS = Number(opt("flags", 1));
const PORT = 9300 + Math.floor(Math.random() * 500);
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const work = join(tmpdir(), `sb3rec-${process.pid}`);
mkdirSync(work, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = spawn(edge, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
	"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--enable-unsafe-swiftshader", `--user-data-dir=${join(work, "profile")}`, "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { browser.kill(); } catch {} };
process.on("exit", cleanup);

// ---- CDP ----
let wsUrl;
for (let i = 0; i < 100 && !wsUrl; i++) {
	try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page")?.webSocketDebuggerUrl; } catch {}
	if (!wsUrl) await sleep(200);
}
if (!wsUrl) throw new Error("Edge の DevTools に繋がらない");
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pend = new Map();
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
	const m = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (m.error) throw new Error(m.error.message);
	if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? JSON.stringify(m.result.exceptionDetails));
	return m.result.result.value;
};

await send("Page.enable");
await send("Page.navigate", { url: "https://turbowarp.org/" });
for (let i = 0; i < 150; i++) {
	await sleep(200);
	// ページが最初の作品（だんご）を読み終えてから差し替える。先に読むと後から重なって、両方の作品が動く
	try { if (await ev("typeof vm !== 'undefined' && !!vm.renderer && vm.runtime.targets.length > 0")) break; } catch {}
	if (i === 149) throw new Error("turbowarp.org の vm が出てこない");
}

// ---- 作品を読み、時計を差し替える ----
const b64 = readFileSync(resolve(sb3)).toString("base64");
await sleep(1500);
await ev(`(async () => {
	const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
	await vm.loadProject(bin.buffer);
	vm.start(); vm.runtime.stop && vm.runtime.stop();      // 自前でコマを回すので、ページの繰り返しは止める
	window.__vt = 1e6;
	performance.now = () => __vt; Date.now = () => __vt;
	const W = ${W}, H = ${H}, FPS = ${FPS};
	window.__events = []; window.__waits = [];
	const banks = new Set(vm.runtime.targets.map((t) => t.sprite.soundBank).filter(Boolean));
	for (const bank of banks) {
		bank.playSound = (target, soundId) => {
			const p = bank.soundPlayers[soundId];
			const dur = p && p.buffer ? p.buffer.duration : 0;
			__events.push({ t: (__vt - __t0) / 1000, kind: "play", target: target.id, soundId, volume: target.volume ?? 100 });
			return new Promise((res) => __waits.push({ at: __vt + dur * 1000, target: target.id, res }));
		};
		bank.stopAllSounds = (target) => {
			__events.push({ t: (__vt - __t0) / 1000, kind: "stop", target: target ? target.id : null });
			__waits = __waits.filter((w) => { if (!target || w.target === target.id) { w.res(); return false; } return true; });
		};
	}
	window.__tick = () => {
		__vt += 1000 / FPS;
		__waits = __waits.filter((w) => { if (w.at <= __vt) { w.res(); return false; } return true; });
		vm.runtime._step();
	};
	window.__frame = () => {
		vm.renderer.resize(W, H);
		vm.renderer.draw();
		return vm.renderer.canvas.toDataURL("image/png");
	};
	window.__t0 = __vt;
	return true;
})()`);

// 緑の旗（1秒おきに FLAGS 回）。押した最後の時刻を 0 秒として録る
for (let i = 0; i < FLAGS; i++) {
	await ev("vm.greenFlag(); __t0 = __vt; true");
	if (i < FLAGS - 1) await ev(`(() => { for (let k = 0; k < ${FPS}; k++) __tick(); return true; })()`);
}
await ev("__events = []; __t0 = __vt; true");

// ---- コマを録る ----
const vid = join(work, "video.mp4");
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
	...(flag("pad16x9") ? ["-vf", `pad=${Math.round((H * 16) / 9)}:${H}:(ow-iw)/2:0:black`] : []),
	"-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", vid], { stdio: ["pipe", "inherit", "inherit"] });
const maxFrames = Math.round((SECONDS ?? 600) * FPS);
let n = 0;
const BATCH = 8;
while (n < maxFrames) {
	const frames = await ev(`(() => { const a = []; for (let k = 0; k < ${Math.min(BATCH, maxFrames - n)}; k++) { __tick(); a.push(__frame()); } return { a, alive: vm.runtime.threads.length }; })()`);
	for (const d of frames.a) {
		if (!ff.stdin.write(Buffer.from(d.slice(d.indexOf(",") + 1), "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
	}
	n += frames.a.length;
	if (n % (FPS * 10) < BATCH) console.log(`${(n / FPS).toFixed(0)} 秒`);
	if (process.env.SB3REC_DEBUG) console.log(await ev("JSON.stringify(vm.runtime.targets.map((t) => [t.getName(), Math.round(t.x), Math.round(t.direction)]).concat([vm.runtime.threads.length, vm.runtime.ioDevices.clock.projectTimer()]))"));
	if (SECONDS == null && frames.alive === 0) break;
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
const dur = n / FPS;

// ---- 音: 記録した「鳴らす」を同じ時刻に並べて WAV にする ----
let wav = null;
if (!flag("no-audio")) {
	const len = await ev(`(async () => {
		const SR = 48000, dur = ${dur};
		const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
		const banks = new Set(vm.runtime.targets.map((t) => t.sprite.soundBank).filter(Boolean));
		const players = (id) => { for (const b of banks) if (b.soundPlayers[id]) return b.soundPlayers[id]; };
		const ev = __events;
		let count = 0;
		ev.forEach((e, i) => {
			if (e.kind !== "play") return;
			const p = players(e.soundId);
			if (!p || !p.buffer) return;
			// 同じ作品で同じ音をまた鳴らすと前の音は止まる。「全部の音を止める」でも止まる
			const next = ev.slice(i + 1).find((f) => (f.kind === "stop" && (f.target === null || f.target === e.target)) || (f.kind === "play" && f.soundId === e.soundId && f.target === e.target));
			const src = ctx.createBufferSource(); src.buffer = p.buffer;
			const g = ctx.createGain(); g.gain.value = e.volume / 100;
			src.connect(g).connect(ctx.destination);
			src.start(e.t); if (next) src.stop(next.t);
			count++;
		});
		const buf = await ctx.startRendering();
		const L = buf.getChannelData(0), R = buf.getChannelData(1), N = L.length;
		const out = new DataView(new ArrayBuffer(44 + N * 4));
		const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
		w(0, "RIFF"); out.setUint32(4, 36 + N * 4, true); w(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
		out.setUint32(24, SR, true); out.setUint32(28, SR * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, N * 4, true);
		for (let i = 0; i < N; i++) {
			out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
			out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
		}
		window.__wav = new Uint8Array(out.buffer);
		console.log("sounds", count);
		return __wav.length;
	})()`);
	const parts = [];
	const CH = 3 * 1024 * 1024;
	for (let o = 0; o < len; o += CH) {
		const s = await ev(`(() => { const a = __wav.subarray(${o}, ${o + CH}); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); })()`);
		parts.push(Buffer.from(s, "base64"));
	}
	wav = join(work, "audio.wav");
	writeFileSync(wav, Buffer.concat(parts));
	const evs = await ev("__events.length");
	console.log(`音の呼び出し ${evs} 回`);
	if (process.env.SB3REC_DEBUG) console.log(await ev("JSON.stringify(__events.map((e) => [e.kind, +e.t.toFixed(3)]).concat(Object.values(vm.runtime.targets[1].sprite.soundBank.soundPlayers).map((p) => p.buffer && p.buffer.duration)))"));
}

// ---- 合わせる ----
mkdirSync(resolve(out, ".."), { recursive: true });
await new Promise((r) => {
	const args = ["-v", "error", "-y", "-i", vid, ...(wav ? ["-i", wav, "-c:a", "aac", "-b:a", "256k", "-shortest"] : []), "-c:v", "copy", "-movflags", "+faststart", resolve(out)];
	spawn("ffmpeg", args, { stdio: "inherit" }).on("close", r);
});
console.log(`done ${basename(out)} ${n} コマ ${dur.toFixed(2)} 秒`);
cleanup();
ws.close();
await sleep(500);
try { rmSync(work, { recursive: true, force: true }); } catch {}
process.exit(0);
