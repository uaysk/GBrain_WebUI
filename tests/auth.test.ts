import { expect, test } from "bun:test";
import { AuthService } from "../server/auth";

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
