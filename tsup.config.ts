import { defineConfig } from "tsup";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		format: ["esm", "cjs"],
		globalName: "Dtm",
		dts: true,
		sourcemap: false,
		clean: true,
		target: "es2024",
		// @onjmin/koe をバンドルに同梱する。デモ（dist/index.mjs をブラウザ直読み）が
		// import 解決のためのimportmap無しで koe を使えるようにするため。
		noExternal: ["@onjmin/koe"],
	},
	{
		// 歌声合成Worker。classic Web Worker として importScripts で worldline.js を
		// 読むため、IIFE（非module）でビルドし koe を同梱する。dist/voice-worker.js を出力。
		entry: { "voice-worker": "src/voice-worker.ts" },
		format: ["iife"],
		platform: "browser",
		sourcemap: false,
		clean: false,
		target: "es2024",
		noExternal: ["@onjmin/koe"],
		outExtension: () => ({ js: ".js" }),
	},
]);
