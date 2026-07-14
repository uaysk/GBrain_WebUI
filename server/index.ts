import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { GraphService } from "./graph";
import { AuthService } from "./auth";

const config = loadConfig();
const sql = createDb(config);
const graph = new GraphService(sql, config);
const auth = new AuthService(config.auth);
const dist = join(import.meta.dir, "..", "dist");
let lastRebuildAt = 0;

function securityHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
  if (request.headers.get("x-forwarded-proto") === "https") headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

const json = (request: Request, body: unknown, status = 200, extra: HeadersInit = {}) => Response.json(body, { status, headers: { ...securityHeaders(request), ...extra, "Cache-Control": "no-store" } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin === config.publicOrigin;
}

function loginOriginAllowed(request: Request): boolean {
  return sameOrigin(request) || request.headers.get("origin") === "null";
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz" && request.method === "GET") return new Response("ok", { headers: { ...securityHeaders(request), "Cache-Control": "no-store" } });
      if (url.pathname === "/auth/login" && request.method === "GET") {
        if (auth.isAuthenticated(request)) return new Response(null, { status: 303, headers: { ...securityHeaders(request), Location: "/" } });
        return auth.loginPage(request, securityHeaders(request));
      }
      if (url.pathname === "/auth/login" && request.method === "POST") return auth.login(request, securityHeaders(request), loginOriginAllowed(request));
      if (url.pathname === "/auth/logout" && request.method === "POST") return auth.logout(request, securityHeaders(request), sameOrigin(request));
      if (!auth.isAuthenticated(request)) {
        if (url.pathname.startsWith("/api/")) return json(request, { error: "Authentication required" }, 401);
        const next = `${url.pathname}${url.search}`;
        return new Response(null, { status: 303, headers: { ...securityHeaders(request), Location: `/auth/login?next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" } });
      }
      if (url.pathname === "/api/status" && request.method === "GET") {
        const connected = await graph.status();
        return json(request, { connected, lastBuiltAt: graph.cached?.generatedAt ?? null, counts: graph.cached?.counts ?? null });
      }
      if (url.pathname === "/api/graph" && request.method === "GET") return json(request, await graph.getGraph());
      if (url.pathname === "/api/graph/rebuild" && request.method === "POST") {
        if (!sameOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
        const waitMs = config.rebuildMinIntervalSeconds * 1000 - (Date.now() - lastRebuildAt);
        if (waitMs > 0) return json(request, { error: "Rebuild rate limit exceeded" }, 429, { "Retry-After": String(Math.ceil(waitMs / 1000)) });
        lastRebuildAt = Date.now();
        return json(request, await graph.rebuild());
      }
      if (url.pathname.startsWith("/api/")) return json(request, { error: "Not found" }, 404);
      if (process.env.NODE_ENV === "production" && existsSync(dist)) {
        const path = url.pathname === "/" ? join(dist, "index.html") : join(dist, url.pathname);
        const file = Bun.file(path);
        if (await file.exists()) return new Response(file, { headers: { ...securityHeaders(request), "Cache-Control": url.pathname === "/" ? "no-cache" : "public, max-age=31536000, immutable" } });
        return new Response(Bun.file(join(dist, "index.html")), { headers: securityHeaders(request) });
      }
      return new Response("GBrain API server. Use the Vite dev server at http://127.0.0.1:5173", { status: 200 });
    } catch (error) {
      console.error("Request failed:", error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted>") : "Unknown error");
      return json(request, { error: "GBrain data is temporarily unavailable" }, 503);
    }
  },
});

console.log(`GBrain API listening on http://${server.hostname}:${server.port}`);

process.on("SIGINT", async () => { await sql.end(); process.exit(0); });
process.on("SIGTERM", async () => { await sql.end(); process.exit(0); });
