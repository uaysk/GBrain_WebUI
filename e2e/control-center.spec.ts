import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type {
  ControlActionRequest,
  ControlActionResult,
  ControlCenterResponse,
  ControlRun,
} from "../src/types";

const latestRun: ControlRun = {
  id: 501,
  name: "autopilot-cycle",
  label: "Dream · Source cycle",
  jobStatus: "completed",
  reportStatus: "warn",
  sourceId: "default",
  startedAt: "2026-07-26T02:00:00.000Z",
  finishedAt: "2026-07-26T02:03:42.000Z",
  durationMs: 222_000,
  partial: true,
  phases: [
    {
      name: "lint",
      label: "문서 검사",
      status: "ok",
      durationMs: 18_000,
      summary: "전체 문서의 구조와 frontmatter를 검사했습니다.",
      metrics: [{ key: "fixed", label: "수정", value: 4, tone: "good" }],
      warnings: [],
    },
    {
      name: "extract_facts",
      label: "Fact 색인",
      status: "warn",
      durationMs: 96_000,
      summary: "새 사실을 색인했고 검토가 필요한 항목을 분리했습니다.",
      metrics: [
        { key: "added", label: "추가", value: 31, tone: "good" },
        { key: "issues", label: "남은 문제", value: 2, tone: "warning" },
      ],
      warnings: ["두 항목은 근거가 부족해 자동 반영하지 않았습니다."],
    },
    {
      name: "embed",
      label: "Embedding 갱신",
      status: "ok",
      durationMs: 108_000,
      summary: "변경된 문서의 검색 벡터를 갱신했습니다.",
      metrics: [{ key: "pages_embedded", label: "Embedding 페이지", value: 23, tone: "good" }],
      warnings: [],
    },
  ],
  impacts: [
    { key: "pages_embedded", label: "Embedding 페이지", value: 23, tone: "good" },
    { key: "facts_consolidated", label: "통합된 Facts", value: 18, tone: "good" },
    { key: "orphans_found", label: "고립 페이지", value: 2, tone: "warning" },
  ],
  warnings: ["Fact 색인: 두 항목은 근거가 부족해 자동 반영하지 않았습니다."],
};

const controlFixture: ControlCenterResponse = {
  generatedAt: "2026-07-26T02:05:00.000Z",
  availability: { configured: true, connected: true, message: null },
  management: { enabled: true, confirmationRequired: true },
  version: "0.42.58.0",
  sources: [
    {
      id: "default",
      name: "Primary memory",
      syncEnabled: true,
      lastSyncAt: "2026-07-26T02:04:00.000Z",
      stalenessHours: 0.02,
      stalenessClass: "fresh",
      pages: 842,
      chunksTotal: 2_614,
      chunksUnembedded: 74,
      embeddingCoveragePct: 97.2,
      backfillQueued: 3,
      backfillActive: 1,
    },
    {
      id: "notes",
      name: "Imported notes",
      syncEnabled: true,
      lastSyncAt: "2026-07-25T18:00:00.000Z",
      stalenessHours: 8,
      stalenessClass: "aging",
      pages: 126,
      chunksTotal: 419,
      chunksUnembedded: 42,
      embeddingCoveragePct: 90,
      backfillQueued: 2,
      backfillActive: 0,
    },
  ],
  latestFullRun: latestRun,
  latestTargetedRun: {
    ...latestRun,
    id: 500,
    name: "autopilot-global-maintenance",
    label: "Dream · Global maintenance",
    sourceId: null,
    reportStatus: "ok",
    partial: false,
    startedAt: "2026-07-26T01:00:00.000Z",
    finishedAt: "2026-07-26T01:01:12.000Z",
    durationMs: 72_000,
    phases: latestRun.phases.slice(0, 2).map((phase) => ({ ...phase, status: "ok", warnings: [] })),
    warnings: [],
  },
  recentJobCounts: {
    sampleSize: 12,
    waiting: 2,
    waitingChildren: 0,
    paused: 0,
    active: 1,
    completed: 7,
    failed: 1,
    delayed: 1,
    dead: 0,
    cancelled: 0,
    unknown: 0,
  },
  jobs: [
    {
      id: 503,
      name: "embed-backfill",
      label: "Embedding 보강",
      queue: "maintenance",
      status: "active",
      sourceId: "default",
      createdAt: "2026-07-26T02:04:00.000Z",
      startedAt: "2026-07-26T02:04:02.000Z",
      finishedAt: null,
      durationMs: 0,
      attemptsMade: 1,
      maxAttempts: 3,
      error: null,
      progress: {
        phase: "embedding",
        message: "변경된 chunk를 순서대로 처리하고 있습니다.",
        completed: 72,
        total: 120,
        percent: 60,
      },
      run: null,
    },
    {
      id: 502,
      name: "sync",
      label: "소스 동기화",
      queue: "default",
      status: "delayed",
      sourceId: "notes",
      createdAt: "2026-07-26T02:03:00.000Z",
      startedAt: "2026-07-26T02:03:02.000Z",
      finishedAt: null,
      durationMs: 0,
      attemptsMade: 1,
      maxAttempts: 3,
      error: null,
      progress: null,
      run: null,
    },
    {
      id: 501,
      name: latestRun.name,
      label: latestRun.label,
      queue: "maintenance",
      status: "completed",
      sourceId: "default",
      createdAt: latestRun.startedAt,
      startedAt: latestRun.startedAt,
      finishedAt: latestRun.finishedAt,
      durationMs: latestRun.durationMs,
      attemptsMade: 1,
      maxAttempts: 3,
      error: null,
      progress: null,
      run: latestRun,
    },
  ],
};

async function loginIfNeeded(page: Page) {
  const passwordInput = page.getByLabel("비밀번호");
  if (!(await passwordInput.isVisible())) return;
  const password = process.env.APP_AUTH_PASSWORD
    ?? readFileSync(".env", "utf8").match(/^APP_AUTH_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("APP_AUTH_PASSWORD is required when testing a production server");
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForLoadState("networkidle");
}

test("visualizes Dream and job results without a CLI or raw JSON surface", async ({ page }) => {
  const consoleErrors: string[] = [];
  const actionRequests: ControlActionRequest[] = [];
  const actionRequestHeaders: Record<string, string>[] = [];
  let csrfRequestCount = 0;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("**/api/control-center**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/control-center" && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(controlFixture),
      });
      return;
    }

    if (pathname === "/api/control-center/csrf" && request.method() === "GET") {
      csrfRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "fixture-csrf-token" }),
      });
      return;
    }

    if (pathname === "/api/control-center/actions" && request.method() === "POST") {
      actionRequests.push(request.postDataJSON() as ControlActionRequest);
      actionRequestHeaders.push(request.headers());
      const result: ControlActionResult = {
        actionId: "fixture-action-1",
        action: "source-sync",
        outcome: "accepted",
        replayed: false,
        message: "Primary memory 동기화 작업이 안전하게 접수되었습니다.",
        generatedAt: "2026-07-26T02:06:00.000Z",
        job: {
          id: 604,
          name: "sync",
          label: "소스 동기화",
          status: "waiting",
          sourceId: "default",
          createdAt: "2026-07-26T02:06:00.000Z",
        },
      };
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
      return;
    }

    await route.fulfill({
      status: 405,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unexpected mocked Control Center request" }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/control/", { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page);

  const center = page.getByTestId("control-center");
  await expect(center).toBeVisible();
  await expect(page).toHaveTitle("GBrain Control Center");
  await expect(center).toContainText("Control Center");
  await expect(center).toContainText("97.2%");
  await expect(center).toContainText("Dream · Source cycle");
  await expect(center).toContainText("최근 12개 작업");
  await expect(center.getByRole("list", { name: "Dream 단계별 실행 결과" }).first()).toBeVisible();
  await expect(center.getByTestId("control-job-progress")).toBeVisible();
  await expect(center.getByTestId("operations-inbox")).toContainText("운영 인박스");
  await expect(center.getByText("운영 추세", { exact: true })).toBeVisible();
  await expect(center.getByTestId("control-job-filters")).toBeVisible();
  await expect(center.getByTestId("job-dependency-graph")).toBeVisible();
  await expect(center.locator("pre")).toHaveCount(0);
  await expect(center).not.toContainText("raw JSON");
  await expect(center).not.toContainText("$ gbrain");

  await center.getByText("Fact 색인").first().click();
  await expect(center).toContainText("새 사실을 색인했고 검토가 필요한 항목을 분리했습니다.");

  await center.getByRole("button", { name: "Primary memory 상세 보기" }).click();
  const sourceDrawer = page.getByTestId("source-detail-drawer");
  await expect(sourceDrawer).toBeVisible();
  await expect(sourceDrawer).toContainText("Embedding 추세");
  await expect(sourceDrawer).toContainText("추천 작업");
  await page.getByRole("button", { name: "Primary memory 상세 닫기" }).click();
  await expect(sourceDrawer).toBeHidden();

  await center.getByRole("button", { name: /최근 활동 열기/ }).click();
  const activityDrawer = page.getByTestId("activity-drawer");
  await expect(activityDrawer).toBeVisible();
  await expect(activityDrawer).toContainText("Embedding 보강");
  await page.getByRole("button", { name: "최근 활동 닫기" }).click();
  await expect(activityDrawer).toBeHidden();

  await page.keyboard.press("Control+k");
  const commandPalette = page.getByTestId("control-command-palette");
  await expect(commandPalette).toBeVisible();
  await commandPalette.getByRole("combobox").fill("#502");
  await expect(commandPalette).toContainText("#502");
  await page.keyboard.press("Escape");
  await expect(commandPalette).toBeHidden();

  await center.getByRole("button", { name: "Quick Dream" }).click();
  const quickDreamDialog = page.getByRole("dialog", { name: "Quick Dream 실행" });
  await expect(quickDreamDialog).toBeVisible();
  await expect(quickDreamDialog).toContainText("실행 영향 미리보기");
  await expect(quickDreamDialog).toContainText("추정치");
  await expect(quickDreamDialog).toContainText("실제 dry-run 결과가 아닙니다");
  expect(csrfRequestCount).toBe(0);
  expect(actionRequests).toHaveLength(0);
  await quickDreamDialog.getByTestId("control-action-safe-cancel").click();
  await expect(quickDreamDialog).toBeHidden();
  expect(csrfRequestCount).toBe(0);
  expect(actionRequests).toHaveLength(0);

  const jobs = center.getByRole("list", { name: "최근 GBrain 작업" });
  await jobs.getByRole("button").filter({ hasText: "#502" }).click();
  await center.getByRole("button", { name: "대기 작업 취소" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "작업 취소" });
  const cancelSubmit = cancelDialog.getByTestId("control-action-submit");
  const typedConfirmation = cancelDialog.getByTestId("control-action-confirmation");
  await expect(cancelDialog).toBeVisible();
  await expect(cancelSubmit).toBeDisabled();
  await typedConfirmation.fill("CANCEL #501");
  await expect(cancelSubmit).toBeDisabled();
  await typedConfirmation.fill("CANCEL #502");
  await expect(cancelSubmit).toBeEnabled();
  await cancelDialog.getByTestId("control-action-safe-cancel").click();
  await expect(cancelDialog).toBeHidden();
  expect(csrfRequestCount).toBe(0);
  expect(actionRequests).toHaveLength(0);

  await center.getByRole("button", { name: "Source 동기화" }).first().click();
  const syncDialog = page.getByRole("dialog", { name: "Source 동기화" });
  await expect(syncDialog).toBeVisible();
  expect(csrfRequestCount).toBe(0);
  expect(actionRequests).toHaveLength(0);
  await syncDialog.getByTestId("control-action-submit").click();

  const receipt = center.getByTestId("control-action-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("관리 작업 접수 완료");
  await expect(receipt).toContainText("Primary memory 동기화 작업이 안전하게 접수되었습니다.");
  await expect(receipt).toContainText("Job #604");
  await expect(receipt).toContainText("대기");
  await expect(receipt).toContainText("실행 전후 비교");
  expect(csrfRequestCount).toBe(1);
  expect(actionRequests).toEqual([{
    action: "source-sync",
    sourceId: "default",
    confirmation: "SYNC default",
  }]);
  expect(actionRequestHeaders).toHaveLength(1);
  expect(actionRequestHeaders[0]["x-gbrain-csrf"]).toBe("fixture-csrf-token");
  expect(actionRequestHeaders[0]["idempotency-key"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  expect(overflow).toEqual({ x: false, y: false });
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: "/tmp/gbrain-control-center.png", fullPage: false });

  await center.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect(center.getByText(/Guarded Control Center/)).toBeVisible();
  await page.screenshot({ path: "/tmp/gbrain-control-center-jobs.png", fullPage: false });

  for (const viewport of [{ width: 1280, height: 720 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const resizedOverflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      centerX: (() => {
        const element = document.querySelector<HTMLElement>('[data-testid="control-center"]');
        return element ? element.scrollWidth > element.clientWidth : true;
      })(),
    }));
    expect(resizedOverflow).toEqual({ x: false, y: false, centerX: false });
  }
});
