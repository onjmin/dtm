import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import process, { loadEnvFile } from "node:process";

try {
	loadEnvFile();
} catch {}

const app = new Hono();

// ルートで demo/index.html を配信
app.get("/", serveStatic({ root: "./demo" }));

// 埋め込み専用プレイヤー（YouTube の /embed 相当）
app.get("/embed.html", serveStatic({ path: "./demo/embed.html" }));
app.get("/embed-chord.html", serveStatic({ path: "./demo/embed-chord.html" }));

// ヘッドレスBGM再生デモページ
app.get("/bgm.html", serveStatic({ path: "./demo/bgm.html" }));

// デモページ用のビルド済み CSS
app.get("/tailwind.css", serveStatic({ path: "./demo/tailwind.css" }));

// dist 配信
app.get("/dist/*", serveStatic({ root: "./" }));

// assets 配信
app.get("/assets/*", serveStatic({ root: "./" }));

// ── API プロキシ（picotune / rpgen / rechord）──
// .env の API_KEY を付けて中継するので、他サイトから読めないよう CORS はループバックの
// オリジンにだけ返す（デモ自身は同一オリジンなので CORS は要らない）。
const API_ORIGIN = "https://rpgen-search.pages.dev/api";
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const proxy = async (c: Context) => {
	const path = c.req.path;
	// API_ORIGIN の外（同じホストの別パス）へ出る `..` を拒否する
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		return c.text("Bad path", 400);
	}
	if (/(^|\/)\.\.?(\/|$)/.test(decoded)) return c.text("Bad path", 400);
	const qs = c.req.raw.url.split("?").slice(1).join("?");
	const url = `${API_ORIGIN}${path}${qs ? `?${qs}` : ""}`;
	const headers: Record<string, string> = {};
	const auth = process.env.API_KEY ?? c.req.header("Authorization");
	if (auth) {
		headers.Authorization = auth.startsWith("Bearer ")
			? auth
			: `Bearer ${auth}`;
	}
	const resHeaders: Record<string, string> = {};
	const origin = c.req.header("Origin");
	if (origin && LOOPBACK_ORIGIN.test(origin)) {
		resHeaders["Access-Control-Allow-Origin"] = origin;
		resHeaders.Vary = "Origin";
	}
	try {
		const res = await fetch(url, { headers });
		const body = await res.arrayBuffer();
		resHeaders["Content-Type"] =
			res.headers.get("Content-Type") ?? "application/octet-stream";
		return new Response(body, { status: res.status, headers: resHeaders });
	} catch {
		return c.text("API proxy error", 502);
	}
};

app.get("/picotune/*", proxy);
app.get("/rpgen/*", proxy);
app.get("/rechord/*", proxy);

// サーバー起動。ポートは PORT で上書きできる（既定は従来どおり40298）。
// 既定はループバックのみ。スマホ実機などから LAN 越しに開くときだけ HOST=0.0.0.0 を付ける
// （そのあいだは同じ LAN の誰でも API_KEY 付きプロキシを使える）。
const port = Number.parseInt(process.env.PORT ?? "", 10) || 40298;
const hostname = process.env.HOST || "127.0.0.1";
serve({ fetch: app.fetch, port, hostname });

console.log(
	`Server running at http://${hostname === "127.0.0.1" ? "localhost" : hostname}:${port}`,
);
