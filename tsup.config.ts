import { defineConfig } from "tsup";

export default defineConfig({
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
});
