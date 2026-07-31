import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ControlCenterResponse } from "../src/api/types";

function configuredPassword(): string {
  const password = process.env.APP_AUTH_PASSWORD
    ?? readFileSync(".env", "utf8").match(/^APP_AUTH_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("APP_AUTH_PASSWORD is required for the live Control Center check");
  return password;
}

async function loginIfNeeded(page: Page): Promise<void> {
  const passwordInput = page.getByLabel("비밀번호");
  if (!(await passwordInput.isVisible())) return;
  await passwordInput.fill(configuredPassword());
  const loginResponse = page.waitForResponse((response) =>
    response.url().includes("/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: "로그인" }).click();
  expect((await loginResponse).status()).toBe(303);
}

test("renders live GBrain operations data without exposing a CLI or credential surface", async ({ page, context }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const browserMcpRequests: string[] = [];
  const browserAuthorizationRequests: string[] = [];
  const controlActionPosts: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.port === "3131" || url.pathname === "/mcp") browserMcpRequests.push(url.origin + url.pathname);
    if ("authorization" in request.headers()) browserAuthorizationRequests.push(url.origin + url.pathname);
    if (url.pathname === "/api/control-center/actions" && request.method() === "POST") {
      controlActionPosts.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  const apiResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/control-center"
    && response.request().method() === "GET"
    && response.status() === 200);
  const detailResponse = page.waitForResponse((response) =>
    /^\/api\/control-center\/dream-runs\/\d+$/.test(new URL(response.url()).pathname)
    && response.request().method() === "GET"
    && response.status() === 200);
  await page.goto("/control/", { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page);

  const response = await apiResponse;
  expect(response.headers()["cache-control"]).toContain("no-store");
  const payload = await response.json() as ControlCenterResponse;
  expect(payload.availability).toEqual({ configured: true, connected: true, message: null });
  expect(payload.management).toEqual({ enabled: true, confirmationRequired: true });
  expect(payload.version).toBeTruthy();
  expect(payload.sources.map((source) => source.id)).toEqual(["default"]);
  expect(payload.latestFullRun?.phases.length).toBeGreaterThan(0);
  expect(payload.latestTargetedRun).toBeTruthy();
  expect(payload.jobs.length).toBeGreaterThan(0);
  const forbiddenKeys = new Set(["data", "result", "logs", "error_text", "lock_token", "idempotency_key", "stacktrace"]);
  const leakedKeys: string[] = [];
  const inspectKeys = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(inspectKeys);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) leakedKeys.push(key);
      inspectKeys(child);
    }
  };
  inspectKeys(payload);
  const detailHttpResponse = await detailResponse;
  expect(detailHttpResponse.headers()["cache-control"]).toContain("no-store");
  const detailPayload = await detailHttpResponse.json() as unknown;
  inspectKeys(detailPayload);
  const serializedPayload = JSON.stringify([payload, detailPayload]);
  const leakedValues = [
    /gbrain_[0-9a-f]{32,}/i,
    /authorization/i,
    /postgres(?:ql)?:\/\//i,
    /\/home\//i,
    /GBRAIN_ADMIN_BOOTSTRAP_TOKEN/i,
  ].filter((pattern) => pattern.test(serializedPayload)).map(String);
  expect(leakedKeys).toEqual([]);
  expect(leakedValues).toEqual([]);

  const center = page.getByTestId("control-center");
  await expect(center).toBeVisible();
  await expect(page).toHaveTitle("GBrain Control Center");
  await expect(center).toContainText("Connected");
  await expect(center).toContainText(`GBrain ${payload.version}`);
  const dreamInspector = center.getByTestId("dream-inspector");
  await expect(dreamInspector).toBeVisible();
  await expect(dreamInspector.getByRole("list", { name: "Dream 실행 이력" })).toBeVisible();
  await dreamInspector.getByRole("tab", { name: "단계", exact: true }).click();
  await expect(dreamInspector.getByRole("list", { name: "Dream 단계" })).toBeVisible();
  await dreamInspector.getByRole("tab", { name: "영향 메모리", exact: true }).click();
  await expect(dreamInspector.getByText(/개 메모리 영향/)).toBeVisible();
  await expect(center.getByTestId("operations-inbox")).toBeVisible();
  await expect(center.getByText("운영 추세", { exact: true })).toBeVisible();
  await expect(center.getByTestId("control-job-filters")).toBeVisible();
  await expect(center.getByTestId("job-dependency-graph")).toBeVisible();
  await expect(center.locator("pre")).toHaveCount(0);
  await expect(center).not.toContainText("raw JSON");
  await expect(center).not.toContainText("$ gbrain");

  const quickDreamButton = center.getByRole("button", { name: "Quick Dream" });
  await expect(quickDreamButton).toBeEnabled();
  await quickDreamButton.click();
  const quickDreamDialog = page.getByRole("dialog", { name: "Quick Dream 실행" });
  await expect(quickDreamDialog).toBeVisible();
  await expect(quickDreamDialog).toContainText("실행 영향 미리보기");
  await expect(quickDreamDialog).toContainText("실제 dry-run 결과가 아닙니다");
  expect(controlActionPosts).toEqual([]);
  await quickDreamDialog.getByTestId("control-action-safe-cancel").click();
  await expect(quickDreamDialog).toBeHidden();
  expect(controlActionPosts).toEqual([]);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.httpOnly && cookie.sameSite === "Strict");
  expect(sessionCookie).toBeTruthy();
  if (new URL(page.url()).protocol === "https:") expect(sessionCookie?.secure).toBe(true);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => {
      const centerElement = document.querySelector<HTMLElement>('[data-testid="control-center"]');
      return {
        pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        centerX: centerElement ? centerElement.scrollWidth > centerElement.clientWidth : true,
      };
    });
    expect(overflow).toEqual({ pageX: false, centerX: false });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "/tmp/gbrain-control-center-live.png", fullPage: false });
  expect(browserMcpRequests).toEqual([]);
  expect(browserAuthorizationRequests).toEqual([]);
  expect(controlActionPosts).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
