/**
 * SoundFont（FluidR3 GM）の楽器間レベル揃え（`SoundFont.levelGain`）を検算する。
 *
 * 代表の楽器について、読み込み時と同じ計算（`src/instruments/sf/level.ts`）で
 * ゾーン RMS の中央値と補正倍率を求め、補正後が目標 ±2 dB に入ることを確かめる。
 *
 * 配信元からフォントの .js を取り、ゾーンの MP3（base64）を ffmpeg で復号するので、
 * ネットワークと ffmpeg が要る。そのため `pnpm test` には入れていない。
 * 取ったフォントは OS の一時フォルダにキャッシュする。
 *
 *   npx tsx scripts/test/check-sf-level.ts        # 代表5楽器を検算
 *   npx tsx scripts/test/check-sf-level.ts --all  # GM 128 楽器の一覧（検算はしない）
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { playStyleForProgram } from "../../src/audio/amp-sim";
import {
	levelGain,
	loopGainMultiplier,
	median,
	toDb,
	zoneLevel,
} from "../../src/instruments/sf/level";
import { SoundFont } from "../../src/instruments/sf/SoundFont";

type RawZone = {
	keyRangeLow: number;
	keyRangeHigh: number;
	sampleRate: number;
	loopStart: number;
	loopEnd: number;
	file?: string;
	sample?: string;
};

const CACHE = path.join(os.tmpdir(), "dtm-sf-cache");
const SUFFIX = "_FluidR3_GM_sf2_file";

const fetchFont = async (program: number): Promise<RawZone[]> => {
	const name = `${String(program * 10).padStart(4, "0")}${SUFFIX}`;
	const file = path.join(CACHE, `${name}.js`);
	if (!fs.existsSync(file)) {
		const res = await fetch(SoundFont.toURL(name));
		if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
		fs.mkdirSync(CACHE, { recursive: true });
		fs.writeFileSync(file, await res.text());
	}
	const sandbox: Record<string, unknown> = { console: { log() {} } };
	vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
	return (sandbox[`_tone_${name}`] as { zones: RawZone[] }).zones;
};

/** SoundFont.ts の findZone と同じ選び方: 各キーは範囲を含む最後のゾーン。 */
const reachableZones = (zones: RawZone[]): RawZone[] => {
	const picked = new Set<RawZone>();
	for (let p = 0; p < 128; p++) {
		for (let i = zones.length - 1; i >= 0; i--) {
			const z = zones[i];
			if (p >= z.keyRangeLow && p <= z.keyRangeHigh) {
				picked.add(z);
				break;
			}
		}
	}
	return [...picked];
};

const decode = (zone: RawZone): Float32Array => {
	if (zone.sample) {
		const bin = Buffer.from(zone.sample, "base64");
		const out = new Float32Array(bin.length >> 1);
		for (let i = 0; i < out.length; i++)
			out[i] = bin.readInt16LE(i * 2) / 0x10000;
		return out;
	}
	const r = spawnSync(
		"ffmpeg",
		["-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1"].concat([
			"-ar",
			String(zone.sampleRate),
			"pipe:1",
		]),
		{ input: Buffer.from(zone.file ?? "", "base64"), maxBuffer: 1 << 28 },
	);
	if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
	const b = r.stdout;
	return new Float32Array(
		b.buffer.slice(b.byteOffset, b.byteOffset + b.length),
	);
};

/** adjustZone の短ループ引き伸ばしと同じゲイン補正を掛ける（ループの複製は RMS を変えない）。 */
const withLoopGain = (data: Float32Array, zone: RawZone, decay: boolean) => {
	const { loopStart, loopEnd, sampleRate } = zone;
	if (!(loopStart >= 1 && loopStart < loopEnd)) return data;
	if ((loopEnd - loopStart) / sampleRate >= 0.03) return data;
	const g = loopGainMultiplier([data], loopStart, loopEnd, decay);
	const attack = Math.min(loopStart, data.length);
	return data.map((v, i) =>
		i < attack
			? v * (1 + (g - 1) * (attack > 1 ? i / (attack - 1) : 0))
			: v * g,
	);
};

const measure = async (program: number) => {
	const env = playStyleForProgram(program).env;
	const decay = env === "pluck" || env === "bass";
	const levels = reachableZones(await fetchFont(program)).map((z) =>
		zoneLevel(
			[withLoopGain(decode(z), z, decay)],
			z.sampleRate,
			z.loopStart,
			z.loopEnd,
			decay,
		),
	);
	const rmsDbs = levels.map((l) => toDb(l.rms)).sort((a, b) => a - b);
	const gain = levelGain(levels, {
		targetDb: SoundFont.levelTargetDb,
		maxBoostDb: SoundFont.levelMaxBoostDb,
		maxCutDb: SoundFont.levelMaxCutDb,
		peakCeiling: SoundFont.levelPeakCeiling,
	});
	const mid = toDb(median(levels.map((l) => l.rms)));
	return {
		zones: levels.length,
		min: rmsDbs[0],
		max: rmsDbs.at(-1) ?? 0,
		mid,
		gainDb: toDb(gain),
	};
};

const fmt = (x: number) => x.toFixed(1).padStart(6);

const main = async () => {
	if (process.argv.includes("--all")) {
		console.log("prog  zones   min    mid    max   gain   after");
		for (let p = 0; p < 128; p++) {
			const m = await measure(p);
			console.log(
				`${String(p).padStart(4)} ${String(m.zones).padStart(6)}${fmt(m.min)} ${fmt(m.mid)} ${fmt(m.max)} ${fmt(m.gainDb)} ${fmt(m.mid + m.gainDb)}`,
			);
		}
		process.exit(0);
	}

	const CASES: [number, string][] = [
		[80, "Lead 1 (square)"],
		[81, "Lead 2 (sawtooth)"],
		[4, "Electric Piano 1"],
		[90, "Pad 3 (polysynth)"],
		[38, "Synth Bass 1"],
	];
	const TOL_DB = 2;
	let failed = 0;
	for (const [program, label] of CASES) {
		const m = await measure(program);
		const after = m.mid + m.gainDb;
		const ok = Math.abs(after - SoundFont.levelTargetDb) <= TOL_DB;
		if (!ok) failed++;
		console.log(
			`${ok ? "ok  " : "FAIL"} ${label.padEnd(20)} zones ${m.zones}  RMS ${fmt(m.min)}〜${fmt(m.max)} (中央 ${fmt(m.mid)})  補正 ${fmt(m.gainDb)} dB → ${fmt(after)} dB`,
		);
	}
	if (failed) {
		console.error(
			`${failed} 楽器が目標 ${SoundFont.levelTargetDb}±${TOL_DB} dB を外れた`,
		);
		process.exit(1);
	}
	console.log(
		`ok: 代表 ${CASES.length} 楽器が目標 ${SoundFont.levelTargetDb}±${TOL_DB} dB に入った`,
	);
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
