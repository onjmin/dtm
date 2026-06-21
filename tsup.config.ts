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
		// assets/*.png をビルド時に base64 data URI 化してバンドルに同梱する。
		// ライブラリ利用者の手元に画像が確実に届き、実行時の外部URL依存をなくす。
		loader: { ".png": "dataurl" },
		// @onjmin/koe をバンドルに同梱する。デモ（dist/index.mjs をブラウザ直読み）が
		// import 解決のためのimportmap無しで koe を使えるようにするため。
		noExternal: ["@onjmin/koe", "@onjmin/chord-parser"],
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
		noExternal: ["@onjmin/koe", "@onjmin/chord-parser"],
		outExtension: () => ({ js: ".js" }),
	},
]);
