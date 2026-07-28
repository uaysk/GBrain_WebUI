import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { GraphService } from "./graph";
import { AuthService } from "./auth";
import { ControlCenterService } from "./control-center";
import {
  ControlActionError,
  ControlActionService,
  parseControlActionIdempotencyKey,
  parseControlActionRequest,
} from "./control-actions";

const config = loadConfig();
const sql = createDb(config);
const graph = new GraphService(sql, config);
await graph.initialize();
const auth = new AuthService(config.auth);
const controlCenter = new ControlCenterService(config.controlCenter, config.allowedSourceIds);
const controlActions = new ControlActionService(config.controlCenter, config.allowedSourceIds);
const dist = join(process.cwd(), "dist");
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

function controlActionOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const expectedOrigin = config.publicOrigin ?? new URL(request.url).origin;
  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

async function boundedRequestText(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new ControlActionError(400, "invalid_content_length", "요청 크기를 확인할 수 없습니다.");
    }
    if (parsedLength > maxBytes) {
      throw new ControlActionError(413, "request_too_large", "관리 요청 본문은 4KB를 초과할 수 없습니다.");
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ControlActionError(413, "request_too_large", "관리 요청 본문은 4KB를 초과할 수 없습니다.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ControlActionError(400, "invalid_encoding", "관리 요청은 UTF-8 JSON이어야 합니다.");
  }
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
        const connected = await graph.status().catch(() => false);
        return json(request, { connected, lastBuiltAt: graph.cached?.generatedAt ?? null, counts: graph.cached?.counts ?? null });
      }
      if (url.pathname === "/api/graph" && request.method === "GET") return json(request, await graph.getGraph());
      if (url.pathname === "/api/graph/history" && request.method === "GET") return json(request, await graph.getGraphHistory());
      if (url.pathname === "/api/graph/rebuild/status" && request.method === "GET") return json(request, graph.getRebuildStatus());
      if (url.pathname === "/api/control-center" && request.method === "GET") {
        return json(request, await controlCenter.getOverview(url.searchParams.get("refresh") === "1"));
      }
      if (url.pathname === "/api/control-center/csrf" && request.method === "GET") {
        if (!controlActions.enabled) return json(request, { error: "GBrain 관리 작업이 비활성화되어 있습니다.", code: "management_disabled" }, 403);
        const csrfToken = auth.csrfToken(request);
        if (!csrfToken) return json(request, { error: "Authentication required", code: "authentication_required" }, 401);
        return json(request, { csrfToken });
      }
      if (url.pathname === "/api/control-center/actions" && request.method === "POST") {
        try {
          if (!controlActions.enabled) {
            throw new ControlActionError(403, "management_disabled", "GBrain 관리 작업이 비활성화되어 있습니다.");
          }
          if (!controlActionOriginAllowed(request)) {
            throw new ControlActionError(403, "origin_not_allowed", "관리 요청의 출처를 확인할 수 없습니다.");
          }
          if (!auth.isValidCsrf(request, request.headers.get("x-gbrain-csrf"))) {
            throw new ControlActionError(403, "invalid_csrf", "관리 요청의 보안 토큰이 올바르지 않습니다.");
          }
          const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
          if (contentType !== "application/json") {
            throw new ControlActionError(415, "unsupported_media_type", "관리 요청은 application/json 형식이어야 합니다.");
          }
          const idempotencyKey = parseControlActionIdempotencyKey(request.headers.get("idempotency-key"));
          const actionRequest = parseControlActionRequest(await boundedRequestText(request, 4_096));
          const result = await controlActions.execute(
            actionRequest,
            idempotencyKey,
            auth.actorHash(request) ?? undefined,
          );
          controlCenter.invalidate();
          return json(request, result, 202);
        } catch (actionError) {
          if (actionError instanceof ControlActionError) {
            const headers: HeadersInit = actionError.retryAfterSeconds
              ? { "Retry-After": String(actionError.retryAfterSeconds) }
              : {};
            return json(request, { error: actionError.message, code: actionError.code }, actionError.status, headers);
          }
          return json(request, { error: "GBrain 관리 요청을 안전하게 확인할 수 없습니다.", code: "control_action_unavailable" }, 503);
        }
      }
      if (url.pathname === "/api/node-detail" && request.method === "GET") {
        const id = url.searchParams.get("id")?.trim();
        if (!id || id.length > 1024) return json(request, { error: "A valid node id is required" }, 400);
        const detail = await graph.getNodeDetail(id);
        return detail ? json(request, detail) : json(request, { error: "Node not found" }, 404);
      }
      if (url.pathname === "/api/graph/rebuild" && request.method === "POST") {
        if (!sameOrigin(request)) return json(request, { error: "Origin not allowed" }, 403);
        if (graph.getRebuildStatus().state === "running") return json(request, graph.startRebuild(), 202);
        const waitMs = config.rebuildMinIntervalSeconds * 1000 - (Date.now() - lastRebuildAt);
        if (waitMs > 0) return json(request, { error: "Rebuild rate limit exceeded" }, 429, { "Retry-After": String(Math.ceil(waitMs / 1000)) });
        lastRebuildAt = Date.now();
        return json(request, graph.startRebuild(), 202);
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
lastRebuildAt = Date.now();
graph.startRebuild();

async function shutdown() {
  await Promise.allSettled([sql.end(), controlActions.close()]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
