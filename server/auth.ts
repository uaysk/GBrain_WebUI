import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Config } from "./config";

const COOKIE_NAME = "gbrain_session";

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

function isSecure(request: Request): boolean {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(request.url).protocol === "https:";
}

function loginPage(next: string, error: string | null = null): string {
  const escapedNext = next.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GBrain 3D Memory Map · Login</title><style>
  :root{color-scheme:dark;font-family:Inter,Pretendard,"Noto Sans KR",ui-sans-serif,system-ui,sans-serif;background:#080808;color:#fafafa}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:#080808}.card{width:min(100%,380px);border:1px solid #3f3f46;border-radius:12px;background:#111113;padding:28px}.eyebrow{margin:0 0 8px;color:#a1a1aa;font-size:12px;letter-spacing:.08em;text-transform:uppercase}h1{margin:0 0 8px;font-size:21px;font-weight:650}p{margin:0 0 24px;color:#a1a1aa;font-size:13px;line-height:1.55}label{display:block;margin-bottom:8px;color:#d4d4d8;font-size:12px}input{width:100%;height:42px;border:1px solid #52525b;border-radius:7px;background:#09090b;padding:0 12px;color:#fafafa;font:inherit;outline:none}input:focus{border-color:#a1a1aa;box-shadow:0 0 0 2px rgba(255,255,255,.12)}button{width:100%;height:42px;margin-top:14px;border:1px solid #71717a;border-radius:7px;background:#f4f4f5;color:#09090b;font:600 13px inherit;cursor:pointer}button:hover{background:#d4d4d8}.error{margin:0 0 14px;border:1px solid #7f1d1d;border-radius:6px;background:#1c0b0b;padding:9px 10px;color:#fecaca;font-size:12px}</style></head><body><main class="card"><p class="eyebrow">Private memory visualization</p><h1>GBrain 3D Memory Map</h1><p>계속하려면 접근 비밀번호를 입력하세요.</p>${error ? `<div class="error" role="alert">${error}</div>` : ""}<form method="post" action="/auth/login"><input type="hidden" name="next" value="${escapedNext}"><label for="password">비밀번호</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">로그인</button></form></main></body></html>`;
}

export class AuthService {
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly config: Config["auth"]) {}

  private signature(payload: string): string {
    return createHmac("sha256", this.config.sessionSecret).update(payload).digest("base64url");
  }

  private clientKey(request: Request): string {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  }

  private sessionCookie(request: Request, value: string, maxAge: number): string {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(request) ? "; Secure" : ""}`;
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

  loginPage(request: Request, headers: HeadersInit): Response {
    const next = safeNext(new URL(request.url).searchParams.get("next"));
    return new Response(loginPage(next), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async login(request: Request, headers: HeadersInit, originAllowed: boolean): Promise<Response> {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    if (Number(request.headers.get("content-length") ?? "0") > 4096) return new Response("Request too large", { status: 413, headers });
    const key = this.clientKey(request);
    const now = Date.now();
    const previous = this.attempts.get(key);
    const attempt = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + this.config.attemptWindowMinutes * 60_000 } : previous;
    if (attempt.count >= this.config.maxAttempts) {
      return new Response(loginPage("/", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요."), { status: 429, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(Math.ceil((attempt.resetAt - now) / 1000)) } });
    }
    const form = await request.formData();
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
    return new Response(null, { status: 303, headers: { ...headers, Location: next, "Set-Cookie": this.sessionCookie(request, token, maxAge), "Cache-Control": "no-store" } });
  }

  logout(request: Request, headers: HeadersInit, originAllowed: boolean): Response {
    if (!originAllowed) return new Response("Origin not allowed", { status: 403, headers });
    return new Response(null, { status: 303, headers: { ...headers, Location: "/auth/login", "Set-Cookie": this.sessionCookie(request, "", 0), "Cache-Control": "no-store" } });
  }
}
