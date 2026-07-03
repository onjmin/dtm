import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const app = new Hono();

// ルートで demo/index.html を配信
app.get("/", serveStatic({ root: "./demo" }));

// 埋め込み専用プレイヤー（YouTube の /embed 相当）
app.get("/embed.html", serveStatic({ path: "./demo/embed.html" }));

// ヘッドレスBGM再生デモページ
app.get("/bgm.html", serveStatic({ path: "./demo/bgm.html" }));

// dist 配信
app.get("/dist/*", serveStatic({ root: "./" }));

// assets 配信
app.get("/assets/*", serveStatic({ root: "./" }));

// CORS ヘッダ
app.use("*", (c, next) => {
	c.header("Access-Control-Allow-Origin", "*");
	return next();
});

// ── API プロキシ（picotune / rpgen）──
const API_ORIGIN = "https://rpgen-search.pages.dev";

app.get("/picotune/*", async (c) => {
	const path = c.req.path;
	const qs = c.req.raw.url.split("?").slice(1).join("?");
	const url = `${API_ORIGIN}${path}${qs ? `?${qs}` : ""}`;
	const headers: Record<string, string> = {};
	const apiKey = c.req.header("X-API-Key");
	if (apiKey) headers["X-API-Key"] = apiKey;
	try {
		const res = await fetch(url, { headers });
		const body = await res.arrayBuffer();
		return c.newResponse(body, res.status, {
			"Content-Type":
				res.headers.get("Content-Type") ?? "application/octet-stream",
			"Access-Control-Allow-Origin": "*",
		});
	} catch {
		return c.text("API proxy error", 502);
	}
});

app.get("/rpgen/*", async (c) => {
	const path = c.req.path;
	const qs = c.req.raw.url.split("?").slice(1).join("?");
	const url = `${API_ORIGIN}${path}${qs ? `?${qs}` : ""}`;
	const headers: Record<string, string> = {};
	const apiKey = c.req.header("X-API-Key");
	if (apiKey) headers["X-API-Key"] = apiKey;
	try {
		const res = await fetch(url, { headers });
		const body = await res.arrayBuffer();
		return c.newResponse(body, res.status, {
			"Content-Type":
				res.headers.get("Content-Type") ?? "application/octet-stream",
			"Access-Control-Allow-Origin": "*",
		});
	} catch {
		return c.text("API proxy error", 502);
	}
});

// サーバー起動
serve({ fetch: app.fetch, port: 40298 });

console.log("Server running at http://localhost:40298");
