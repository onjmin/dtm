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

// サーバー起動
serve({ fetch: app.fetch, port: 40298 });

console.log("Server running at http://localhost:40298");
