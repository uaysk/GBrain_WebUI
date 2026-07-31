import { expect, test } from "@playwright/test";

test("restores node and community deep links across browser history and reload", async ({ page }) => {
  await page.goto("/?keep=1&view=2d", { waitUntil: "networkidle" });
  const graph = page.getByTestId("memory-graph");
  await expect(graph).toBeVisible();
  await expect(page.getByRole("region", { name: "Interactive Memory Map" })).toContainText("Control/Command+K");

  await page.keyboard.press("/");
  const search = page.getByRole("dialog", { name: "Memory Map 검색" });
  await expect(search).toBeVisible();
  await search.getByRole("combobox").fill("Atlas Workspace");
  await page.keyboard.press("Enter");
  await expect(graph).toHaveAttribute("data-selected-id", "demo::atlas-workspace");
  await expect(page).toHaveURL(/\?keep=1&view=2d&node=demo%3A%3Aatlas-workspace$/);

  await page.goBack();
  await expect(graph).toHaveAttribute("data-selected-id", "");
  await expect(page).toHaveURL(/\?keep=1&view=2d$/);
  await page.goForward();
  await expect(graph).toHaveAttribute("data-selected-id", "demo::atlas-workspace");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("memory-graph")).toHaveAttribute("data-selected-id", "demo::atlas-workspace");

  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gbrain-memory-map:explorer-state:v3") ?? "null")?.selectedId)).toBe("demo::atlas-workspace");
  await page.goto("/?community=atlas-launch&keep=1", { waitUntil: "networkidle" });
  await expect(page.getByTestId("memory-graph")).toHaveAttribute("data-selected-id", "");
  await expect(page.getByTestId("memory-graph")).toHaveAttribute("data-focused-community", "atlas-launch");
  await expect(page).toHaveURL(/\?community=atlas-launch&keep=1$/);

  await page.keyboard.press("Control+K");
  const longSearch = page.getByRole("dialog", { name: "Memory Map 검색" });
  const combobox = longSearch.getByRole("combobox");
  await combobox.fill("demo");
  await page.keyboard.press("End");
  const activeId = await combobox.getAttribute("aria-activedescendant");
  expect(activeId).toBeTruthy();
  await expect(page.locator(`[id="${activeId}"]`)).toBeInViewport();
  await page.keyboard.press("Escape");
});

test("keeps mobile sheets keyboard-reachable and discloses current content on historical frames", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("memory-graph")).toBeVisible();
  await expect(page.getByTestId("mobile-view-mode-toggle")).toBeVisible();
  await expect(page.getByTestId("view-mode-toggle")).toBeHidden();

  const menuTrigger = page.getByRole("button", { name: "추가 작업 열기" });
  await menuTrigger.click();
  const menu = page.getByRole("dialog", { name: "Map actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Map actions 닫기" }).click();
  await expect(menuTrigger).toBeFocused();

  await menuTrigger.click();
  const timelineButton = menu.getByRole("button", { name: "Timeline" });
  await expect(timelineButton).toBeEnabled();
  await timelineButton.click();
  const timelineSheet = page.getByRole("dialog", { name: "Memory timeline" });
  await expect(timelineSheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await timelineSheet.getByRole("button", { name: "이전 기록 시점" }).click();
  await expect(timelineSheet).toContainText("문서 본문은 현재 저장 내용입니다.");

  const changesSummary = timelineSheet.locator("summary");
  await expect(changesSummary).toBeVisible();
  expect(await changesSummary.evaluate((element) => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(44);
  await changesSummary.focus();
  await page.keyboard.press("Enter");
  await expect(timelineSheet.getByRole("list", { name: "생성 및 갱신된 페이지" })).toBeVisible();

  await page.keyboard.press("Control+K");
  const search = page.getByRole("dialog", { name: "Memory Map 검색" });
  await search.getByRole("combobox").fill("Atlas Workspace");
  await page.keyboard.press("Enter");
  const nodeSheet = page.getByRole("dialog", { name: "Atlas Workspace" });
  await expect(nodeSheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(nodeSheet.getByTestId("historical-current-content-note")).toContainText("현재 저장 내용");
  await page.keyboard.press("Escape");
  await expect(nodeSheet).toBeHidden();

  await menuTrigger.click();
  await menu.getByRole("button", { name: "Timeline" }).click();
  const reopenedTimelineSheet = page.getByRole("dialog", { name: "Memory timeline" });
  const timeline = reopenedTimelineSheet.getByTestId("graph-timeline");
  await timeline.getByRole("button", { name: "타임라인 재생" }).click();
  await expect(timeline).toHaveAttribute("data-playing", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(timeline).toHaveAttribute("data-playing", "false");
});
