import { extname, resolve, sep } from "node:path";
import type {
  GraphRebuildAccepted,
  GraphRebuildStatus,
  GraphResponse,
  GraphTimelineResponse,
  NodeDetailResponse,
} from "../shared/contracts";
import type { AuthService } from "./auth";
import type { Config } from "./config";
import {
  ControlActionError,
  type ControlActionService,
  parseControlActionIdempotencyKey,
  parseControlActionRequest,
} from "./control-actions";
import type { ControlCenterService } from "./control-center";
import { readBoundedUtf8Body, RequestBodyError } from "./request-body";
import { resolveRequestNetwork, type RequestConnection, type RequestNetwork } from "./request-network";

export interface GraphHttpService {
  readonly cached: GraphResponse | null;
  status(): Promise<boolean>;
  getGraph(): Promise<GraphResponse>;
  getSerializedGraph(): Promise<string>;
  getGraphHistory(): Promise<GraphTimelineResponse>;
  getNodeDetail(id: string): Promise<NodeDetailResponse | null>;
  getRebuildStatus(): GraphRebuildStatus;
  startRebuild(): GraphRebuildAccepted;
}

export interface HttpHandlerDependencies {
  config: Config;
  graph: GraphHttpService;
  auth: AuthService;
  controlCenter: Pick<ControlCenterService, "getOverview" | "getDreamRunDetail" | "invalidate">;
  controlActions: Pick<ControlActionService, "enabled" | "execute">;
  distPath?: string | null;
  environment?: string;
  now?: () => number;
}

export type HttpHandler = (request: Request, connection?: RequestConnection) => Promise<Response>;

export function securityHeaders(network: RequestNetwork): HeadersInit {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
  if (network.secure) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

function requestOrigin(request: Request, network: RequestNetwork): string {
  const url = new URL(request.url);
  url.protocol = network.secure ? "https:" : "http:";
  return url.origin;
}

function sameOrigin(request: Request, network: RequestNetwork, publicOrigin: string | null): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === requestOrigin(request, network) || origin === publicOrigin;
}

function loginOriginAllowed(request: Request, network: RequestNetwork, publicOrigin: string | null): boolean {
  return sameOrigin(request, network, publicOrigin) || request.headers.get("origin") === "null";
}

function controlActionOriginAllowed(request: Request, network: RequestNetwork, publicOrigin: string | null): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin !== (publicOrigin ?? requestOrigin(request, network))) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

function safeServerError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "<redacted>")
    : "Unknown error";
}

function staticCacheControl(pathname: string, contentType: string): string {
  if (contentType.startsWith("text/html") || extname(pathname).toLowerCase() === ".html") return "no-cache";
  return /(?:^|[-.])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

async function staticResponse(
  request: Request,
  distPath: string,
  headers: HeadersInit,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return new Response("Bad request", { status: 400, headers });
  }
  const root = resolve(distPath);
  const requestedPath = resolve(root, relativePath || "index.html");
  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    return new Response("Not found", { status: 404, headers });
  }

  let file = Bun.file(requestedPath);
  let pathname = relativePath || "index.html";
  if (!(await file.exists())) {
    if (extname(relativePath) || !request.headers.get("accept")?.includes("text/html")) return null;
    pathname = "index.html";
    file = Bun.file(resolve(root, pathname));
    if (!(await file.exists())) return null;
  }
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", file.type || (pathname.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream"));
  responseHeaders.set("Content-Length", String(file.size));
  responseHeaders.set("Cache-Control", staticCacheControl(pathname, responseHeaders.get("Content-Type") ?? ""));
  return new Response(request.method === "HEAD" ? null : file, { headers: responseHeaders });
}

export function createHttpHandler(deps: HttpHandlerDependencies): HttpHandler {
  const now = deps.now ?? Date.now;
  let lastRebuildAt = now();

  return async (request, connection = { address: "unknown" }) => {
    const network = resolveRequestNetwork(request, connection, deps.config.trustProxyHops);
    const baseHeaders = securityHeaders(network);
    const json = (body: unknown, status = 200, extra: HeadersInit = {}) => Response.json(body, {
      status,
      headers: { ...baseHeaders, ...extra, "Cache-Control": "no-store" },
    });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/healthz" && (request.method === "GET" || request.method === "HEAD")) {
        return new Response(request.method === "HEAD" ? null : "ok", { headers: { ...baseHeaders, "Cache-Control": "no-store" } });
      }
      if (url.pathname === "/auth/login" && request.method === "GET") {
        if (deps.auth.isAuthenticated(request)) return new Response(null, { status: 303, headers: { ...baseHeaders, Location: "/" } });
        return deps.auth.loginPage(request, baseHeaders);
      }
      if (url.pathname === "/auth/login" && request.method === "POST") {
        return deps.auth.login(request, baseHeaders, loginOriginAllowed(request, network, deps.config.publicOrigin), network);
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        return deps.auth.logout(request, baseHeaders, sameOrigin(request, network, deps.config.publicOrigin), network);
      }
      if (!deps.auth.isAuthenticated(request)) {
        if (url.pathname.startsWith("/api/")) return json({ error: "Authentication required" }, 401);
        const next = `${url.pathname}${url.search}`;
        return new Response(null, {
          status: 303,
          headers: { ...baseHeaders, Location: `/auth/login?next=${encodeURIComponent(next)}`, "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/api/status" && request.method === "GET") {
        const connected = await deps.graph.status().catch(() => false);
        return json({ connected, lastBuiltAt: deps.graph.cached?.generatedAt ?? null, counts: deps.graph.cached?.counts ?? null });
      }
      if (url.pathname === "/api/graph" && request.method === "GET") {
        return new Response(await deps.graph.getSerializedGraph(), {
          headers: { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/api/graph/history" && request.method === "GET") return json(await deps.graph.getGraphHistory());
      if (url.pathname === "/api/graph/rebuild/status" && request.method === "GET") return json(deps.graph.getRebuildStatus());
      if (url.pathname === "/api/control-center" && request.method === "GET") {
        return json(await deps.controlCenter.getOverview(url.searchParams.get("refresh") === "1"));
      }
      const dreamRunMatch = url.pathname.match(/^\/api\/control-center\/dream-runs\/([^/]+)$/);
      if (dreamRunMatch && request.method === "GET") {
        const rawJobId = dreamRunMatch[1]!;
        if (!/^\d{1,16}$/.test(rawJobId)) {
          return json({ error: "A valid Dream job id is required", code: "invalid_job_id" }, 400);
        }
        const jobId = Number(rawJobId);
        if (!Number.isSafeInteger(jobId) || jobId <= 0) {
          return json({ error: "A valid Dream job id is required", code: "invalid_job_id" }, 400);
        }
        const lookup = deps.controlCenter.getDreamRunDetail(jobId);
        if (lookup.status === "ok") return json(lookup.detail);
        if (lookup.status === "not-found") {
          return json({ error: "Dream run not found", code: "dream_run_not_found" }, 404);
        }
        return json({ error: "Dream run detail is not available yet", code: "dream_run_unavailable" }, 503);
      }
      if (url.pathname === "/api/control-center/csrf" && request.method === "GET") {
        if (!deps.controlActions.enabled) return json({ error: "GBrain 관리 작업이 비활성화되어 있습니다.", code: "management_disabled" }, 403);
        const csrfToken = deps.auth.csrfToken(request);
        if (!csrfToken) return json({ error: "Authentication required", code: "authentication_required" }, 401);
        return json({ csrfToken });
      }
      if (url.pathname === "/api/control-center/actions" && request.method === "POST") {
        try {
          if (!deps.controlActions.enabled) {
            throw new ControlActionError(403, "management_disabled", "GBrain 관리 작업이 비활성화되어 있습니다.");
          }
          if (!controlActionOriginAllowed(request, network, deps.config.publicOrigin)) {
            throw new ControlActionError(403, "origin_not_allowed", "관리 요청의 출처를 확인할 수 없습니다.");
          }
          if (!deps.auth.isValidCsrf(request, request.headers.get("x-gbrain-csrf"))) {
            throw new ControlActionError(403, "invalid_csrf", "관리 요청의 보안 토큰이 올바르지 않습니다.");
          }
          const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
          if (contentType !== "application/json") {
            throw new ControlActionError(415, "unsupported_media_type", "관리 요청은 application/json 형식이어야 합니다.");
          }
          const idempotencyKey = parseControlActionIdempotencyKey(request.headers.get("idempotency-key"));
          let body: string;
          try {
            body = await readBoundedUtf8Body(request, 4_096);
          } catch (error) {
            if (!(error instanceof RequestBodyError)) throw error;
            throw new ControlActionError(
              error.status,
              error.status === 413 ? "request_too_large" : "invalid_encoding",
              error.status === 413 ? "관리 요청 본문은 4KB를 초과할 수 없습니다." : "관리 요청은 UTF-8 JSON이어야 합니다.",
            );
          }
          const actionRequest = parseControlActionRequest(body);
          const result = await deps.controlActions.execute(
            actionRequest,
            idempotencyKey,
            deps.auth.actorHash(request) ?? undefined,
          );
          deps.controlCenter.invalidate();
          return json(result, 202);
        } catch (actionError) {
          if (actionError instanceof ControlActionError) {
            const headers: HeadersInit = actionError.retryAfterSeconds
              ? { "Retry-After": String(actionError.retryAfterSeconds) }
              : {};
            return json({ error: actionError.message, code: actionError.code }, actionError.status, headers);
          }
          return json({ error: "GBrain 관리 요청을 안전하게 확인할 수 없습니다.", code: "control_action_unavailable" }, 503);
        }
      }
      if (url.pathname === "/api/node-detail" && request.method === "GET") {
        const id = url.searchParams.get("id")?.trim();
        if (!id || id.length > 1_024) return json({ error: "A valid node id is required" }, 400);
        const detail = await deps.graph.getNodeDetail(id);
        return detail ? json(detail) : json({ error: "Node not found" }, 404);
      }
      if (url.pathname === "/api/graph/rebuild" && request.method === "POST") {
        if (!sameOrigin(request, network, deps.config.publicOrigin)) return json({ error: "Origin not allowed" }, 403);
        if (deps.graph.getRebuildStatus().state === "running") return json(deps.graph.startRebuild(), 202);
        const waitMs = deps.config.rebuildMinIntervalSeconds * 1_000 - (now() - lastRebuildAt);
        if (waitMs > 0) return json({ error: "Rebuild rate limit exceeded" }, 429, { "Retry-After": String(Math.ceil(waitMs / 1_000)) });
        lastRebuildAt = now();
        return json(deps.graph.startRebuild(), 202);
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);

      if (deps.environment === "production" && deps.distPath) {
        const response = await staticResponse(request, deps.distPath, baseHeaders);
        if (response) return response;
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405, headers: { ...baseHeaders, Allow: "GET, HEAD" } });
        }
        return new Response("Not found", { status: 404, headers: baseHeaders });
      }
      return new Response("GBrain API server. Use the Vite dev server at http://127.0.0.1:5173", { status: 200, headers: baseHeaders });
    } catch (error) {
      console.error("Request failed:", safeServerError(error));
      return json({ error: "GBrain data is temporarily unavailable" }, 503);
    }
  };
}
