import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";
import { readUrlEncodedForm, RequestBodyError } from "./request-body";
import { directRequestNetwork, type RequestNetwork } from "./request-network";

const COOKIE_NAME = "gbrain_session";
export const MAX_AUTH_IDENTITIES = 10_000;

type Attempt = { count: number; resetAt: number };

function constantTimePasswordEqual(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function cookieValue(request: Request, name: string): string | null {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function loginPage(next: string, error: string | null = null): string {
  const escapedNext = next.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GBrain 3D Memory Map · Login</title><style>
  :root{color-scheme:dark;font-family:Inter,Pretendard,"Noto Sans KR",ui-sans-serif,system-ui,sans-serif;background:#080808;color:#fafafa}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:#080808}.card{width:min(100%,380px);border-radius:12px;background:#18181b;padding:28px}.eyebrow{margin:0 0 8px;color:#a1a1aa;font-size:12px;letter-spacing:.08em;text-transform:uppercase}h1{margin:0 0 8px;font-size:21px;font-weight:650}p{margin:0 0 24px;color:#a1a1aa;font-size:13px;line-height:1.55}label{display:block;margin-bottom:8px;color:#d4d4d8;font-size:12px}input{width:100%;height:42px;border:0;border-radius:7px;background:#27272a;padding:0 12px;color:#fafafa;font:inherit;outline:none}input:focus{background:#3f3f46}button{width:100%;height:42px;margin-top:14px;border:0;border-radius:7px;background:#f4f4f5;color:#09090b;font:600 13px inherit;cursor:pointer}button:hover,button:focus-visible{background:#d4d4d8;outline:none}.error{margin:0 0 14px;border-radius:6px;background:#450a0a;padding:9px 10px;color:#fecaca;font-size:12px}</style></head><body><main class="card"><p class="eyebrow">Private memory visualization</p><h1>GBrain 3D Memory Map</h1><p>계속하려면 접근 비밀번호를 입력하세요.</p>${error ? `<div class="error" role="alert">${error}</div>` : ""}<form method="post" action="/auth/login"><input type="hidden" name="next" value="${escapedNext}"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">로그인</button></form></main></body></html>`;
}

export class AuthService {
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly config: Config["auth"]) {}

  private signature(payload: string): string {
    return createHmac("sha256", this.config.sessionSecret).update(payload).digest("base64url");
  }

  get attemptIdentityCount(): number {
    return this.attempts.size;
  }

  private pruneAttempts(now: number): void {
    for (const [key, attempt] of this.attempts) {
      if (attempt.resetAt <= now) this.attempts.delete(key);
    }
    while (this.attempts.size >= MAX_AUTH_IDENTITIES) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.attempts.delete(oldest);
    }
  }

  private sessionCookie(secure: boolean, value: string, maxAge: number): string {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  isAuthenticated(request: Request): boolean {
    const token = cookieValue(request, COOKIE_NAME);
    if (!token) return false;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    const expected = this.signature(payload);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    const expiresAt = Number(payload.split(":", 1)[0]);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  csrfToken(request: Request): string | null {
    const session = cookieValue(request, COOKIE_NAME);
    if (!session || !this.isAuthenticated(request)) return null;
    return createHmac("sha256", this.config.sessionSecret)
      .update("gbrain-control-csrf\0")
      .update(session)
      .digest("base64url");
  }

  isValidCsrf(request: Request, submitted: string | null): boolean {
    const expected = this.csrfToken(request);
    if (!expected || !submitted) return false;
    const actualBuffer = Buffer.from(submitted);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  actorHash(request: Request): string | null {
    const session = cookieValue(request, COOKIE_NAME);
    if (!session || !this.isAuthenticated(request)) return null;
    return createHmac("sha256", this.config.sessionSecret)
      .update("gbrain-control-actor\0")
      .update(session)
      .digest("hex")
      .slice(0, 24);
  }

  loginPage(request: Request, headers: HeadersInit): Response {
    const next = safeNext(new URL(request.url).searchParams.get("next"));
    return new Response(loginPage(next), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async login(
    request: Request,
    headers: HeadersInit,
    originAllowed: boolean,
    network: RequestNetwork = directRequestNetwork(request),
  ): Promise<Response> {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    let form: URLSearchParams;
    try {
      form = await readUrlEncodedForm(request, 4_096);
    } catch (error) {
      if (error instanceof RequestBodyError) return new Response(error.message, { status: error.status, headers });
      throw error;
    }
    const key = network.clientIp;
    const now = Date.now();
    this.pruneAttempts(now);
    const previous = this.attempts.get(key);
    const attempt = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + this.config.attemptWindowMinutes * 60_000 } : previous;
    if (attempt.count >= this.config.maxAttempts) {
      return new Response(loginPage("/", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."), { status: 429, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(Math.ceil((attempt.resetAt - now) / 1000)) } });
    }
    const password = form.get("password");
    const next = safeNext(form.get("next"));
    if (typeof password !== "string" || !constantTimePasswordEqual(password, this.config.password)) {
      attempt.count += 1;
      this.attempts.set(key, attempt);
      return new Response(loginPage(next, "비밀번호가 올바르지 않습니다."), { status: 401, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    this.attempts.delete(key);
    const maxAge = Math.floor(this.config.sessionHours * 3600);
    const payload = `${Date.now() + maxAge * 1000}:${randomUUID()}`;
    const token = `${payload}.${this.signature(payload)}`;
    return new Response(null, { status: 303, headers: { ...headers, Location: next, "Set-Cookie": this.sessionCookie(network.secure, token, maxAge), "Cache-Control": "no-store" } });
  }

  logout(
    request: Request,
    headers: HeadersInit,
    originAllowed: boolean,
    network: RequestNetwork = directRequestNetwork(request),
  ): Response {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    return new Response(null, { status: 303, headers: { ...headers, Location: "/auth/login", "Set-Cookie": this.sessionCookie(network.secure, "", 0), "Cache-Control": "no-store" } });
  }
}
