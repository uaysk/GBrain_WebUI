import { expect, test } from "bun:test";
import { AuthService, MAX_AUTH_IDENTITIES } from "../server/auth";
import { resolveRequestNetwork } from "../server/request-network";

const config = { password: "correct horse battery staple", sessionSecret: "a-session-secret-that-is-longer-than-thirty-two-characters", sessionHours: 12, maxAttempts: 5, attemptWindowMinutes: 15 };

test("auth service issues and verifies an HttpOnly strict session", async () => {
  const auth = new AuthService(config);
  const request = new Request("https://gd.uaysk.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://gd.uaysk.com", "X-Forwarded-Proto": "https" },
    body: new URLSearchParams({ password: config.password, next: "/api/graph" }),
  });
  const response = await auth.login(request, {}, true);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/api/graph");
  const setCookie = response.headers.get("set-cookie")!;
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Secure");
  const cookie = setCookie.split(";", 1)[0]!;
  const authenticated = new Request("https://gd.uaysk.com/", { headers: { Cookie: cookie } });
  expect(auth.isAuthenticated(authenticated)).toBe(true);
  expect(auth.isAuthenticated(new Request("https://gd.uaysk.com/", { headers: { Cookie: `${cookie}x` } }))).toBe(false);
  const csrf = auth.csrfToken(authenticated);
  expect(csrf).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(auth.isValidCsrf(authenticated, csrf)).toBe(true);
  expect(auth.isValidCsrf(authenticated, `${csrf}x`)).toBe(false);
  expect(auth.actorHash(authenticated)).toMatch(/^[a-f0-9]{24}$/);
});

test("CSRF tokens are session-bound and unavailable without a valid session", async () => {
  const auth = new AuthService(config);
  const login = async () => {
    const response = await auth.login(new Request("https://gd.uaysk.com/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://gd.uaysk.com" },
      body: new URLSearchParams({ password: config.password, next: "/" }),
    }), {}, true);
    return response.headers.get("set-cookie")!.split(";", 1)[0]!;
  };
  const firstRequest = new Request("https://gd.uaysk.com/", { headers: { Cookie: await login() } });
  const secondRequest = new Request("https://gd.uaysk.com/", { headers: { Cookie: await login() } });
  const firstToken = auth.csrfToken(firstRequest);
  const secondToken = auth.csrfToken(secondRequest);

  expect(firstToken).not.toBe(secondToken);
  expect(auth.isValidCsrf(firstRequest, secondToken)).toBe(false);
  expect(auth.csrfToken(new Request("https://gd.uaysk.com/"))).toBeNull();
  expect(auth.isValidCsrf(new Request("https://gd.uaysk.com/"), firstToken)).toBe(false);
});

test("auth service rejects wrong passwords and unsafe redirects", async () => {
  const auth = new AuthService(config);
  const request = new Request("http://127.0.0.1:3000/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "wrong password", next: "//evil.example" }),
  });
  const response = await auth.login(request, {}, true);
  expect(response.status).toBe(401);
  expect(await response.text()).toContain("비밀번호가 올바르지 않습니다.");
  expect(response.headers.get("set-cookie")).toBeNull();
});

function loginBody(size: number): string {
  const prefix = `password=${encodeURIComponent(config.password)}&next=%2F&padding=`;
  if (prefix.length > size) throw new Error("Requested login body is too small");
  return `${prefix}${"x".repeat(size - prefix.length)}`;
}

test("auth service enforces the streamed 4,096-byte boundary and URL-encoded UTF-8", async () => {
  const auth = new AuthService(config);
  const accepted = await auth.login(new Request("https://gd.uaysk.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginBody(4_096),
  }), {}, true);
  expect(accepted.status).toBe(303);

  const oversized = new Request("https://gd.uaysk.com/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": "4096",
    },
    body: new TextEncoder().encode(loginBody(4_097)),
  });
  expect((await auth.login(oversized, {}, true)).status).toBe(413);

  const invalidUtf8 = new Request("https://gd.uaysk.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new Uint8Array([0x70, 0x61, 0x73, 0x73, 0x77, 0x6f, 0x72, 0x64, 0x3d, 0xff]),
  });
  expect((await auth.login(invalidUtf8, {}, true)).status).toBe(400);
  expect((await auth.login(new Request("https://gd.uaysk.com/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }), {}, true)).status).toBe(415);
});

test("proxy trust is opt-in and consumes forwarded hops from the right", async () => {
  const request = new Request("http://internal/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": "198.51.100.7, 203.0.113.8",
      "X-Forwarded-Proto": "http, https",
    },
    body: new URLSearchParams({ password: "wrong" }),
  });
  expect(resolveRequestNetwork(request, { address: "10.0.0.2" }, 0)).toEqual({ clientIp: "10.0.0.2", secure: false });
  expect(resolveRequestNetwork(request, { address: "10.0.0.2" }, 1)).toEqual({ clientIp: "203.0.113.8", secure: true });
  expect(resolveRequestNetwork(request, { address: "10.0.0.2" }, 2)).toEqual({ clientIp: "198.51.100.7", secure: false });

  const guarded = new AuthService({ ...config, maxAttempts: 1 });
  const attempt = (forged: string) => guarded.login(new Request("http://internal/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": forged,
    },
    body: new URLSearchParams({ password: "wrong" }),
  }), {}, true, { clientIp: "10.0.0.2", secure: false });
  expect((await attempt("198.51.100.1")).status).toBe(401);
  expect((await attempt("198.51.100.2")).status).toBe(429);
});

test("auth attempt storage remains bounded to 10,000 identities", async () => {
  const auth = new AuthService({ ...config, maxAttempts: 100 });
  for (let index = 0; index < MAX_AUTH_IDENTITIES + 3; index += 1) {
    const request = new Request("http://internal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=wrong",
    });
    await auth.login(request, {}, true, { clientIp: `client-${index}`, secure: false });
  }
  expect(auth.attemptIdentityCount).toBe(MAX_AUTH_IDENTITIES);
});
