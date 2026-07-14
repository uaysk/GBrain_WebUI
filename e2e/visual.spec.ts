import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const sizes = [
  { width: 1280, height: 720 },
  { width: 1440, height: 1000 },
];

test("captures and validates the requested viewports", async ({ browser }) => {
  test.setTimeout(180_000);
  mkdirSync("screenshots", { recursive: true });
  const target = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const password = process.env.APP_AUTH_PASSWORD ?? readFileSync(".env", "utf8").match(/^APP_AUTH_PASSWORD=(.+)$/m)?.[1]?.trim();
  if (!password) throw new Error("APP_AUTH_PASSWORD is required for Playwright");
  const observe = (page: Awaited<ReturnType<typeof browser.newPage>>) => {
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText ?? "";
      if (request.url().includes("/api/node-detail?") && errorText.includes("ERR_ABORTED")) return;
      failedRequests.push(`${request.method()} ${request.url()} ${errorText}`);
    });
  };
  const visibleTooltipText = (page: Awaited<ReturnType<typeof browser.newPage>>) => page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".graph-tooltip");
    const root = content?.closest<HTMLElement>(".scene-tooltip, .float-tooltip-kap") ?? content?.parentElement;
    if (!content || !root) return "";
    const style = getComputedStyle(root);
    const bounds = root.getBoundingClientRect();
    const visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05
      && bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0
      && bounds.left < innerWidth && bounds.top < innerHeight;
    return visible ? content.textContent?.trim() ?? "" : "";
  });
  const login = async (page: Awaited<ReturnType<typeof browser.newPage>>) => {
    await page.goto(target, { waitUntil: "domcontentloaded" });
    const passwordInput = page.getByLabel("비밀번호");
    if (await passwordInput.isVisible()) {
      await passwordInput.fill(password);
      const loginResponse = page.waitForResponse((response) => response.url().includes("/auth/login") && response.request().method() === "POST");
      await page.getByRole("button", { name: "로그인" }).click();
      expect((await loginResponse).status()).toBe(303);
      await page.waitForLoadState("networkidle");
    }
  };
  const loginContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const loginPage = await loginContext.newPage(); observe(loginPage);
  await loginPage.goto(target, { waitUntil: "domcontentloaded" });
  await expect(loginPage.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect(loginPage.getByLabel("비밀번호")).toBeVisible();
  const loginSurfaces = await loginPage.locator("body, .card, input, button").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderWidth };
  }));
  expect(loginSurfaces.slice(1).every((surface) => surface.border === "0px")).toBe(true);
  expect(new Set(loginSurfaces.slice(0, 3).map((surface) => surface.background)).size).toBe(3);
  await loginPage.screenshot({ path: "screenshots/gbrain-memory-map-login.png" });
  await loginContext.close();
  const warmupContext = await browser.newContext({ viewport: { width: 960, height: 720 }, ignoreHTTPSErrors: true });
  const warmupPage = await warmupContext.newPage(); observe(warmupPage);
  await login(warmupPage);
  const sessionCookie = (await warmupContext.cookies()).find((cookie) => cookie.name === "gbrain_session");
  expect(sessionCookie).toMatchObject({ httpOnly: true, secure: target.startsWith("https://"), sameSite: "Strict" });
  await expect(warmupPage.getByTestId("memory-graph")).toBeVisible();
  await warmupPage.waitForTimeout(900);
  await warmupPage.screenshot({ path: "/tmp/gbrain-playwright-webgl-warmup.png" });
  await warmupContext.close();
  const degradedContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const degradedPage = await degradedContext.newPage();
  await degradedPage.route("**/api/graph/history", (route) => route.abort());
  await login(degradedPage);
  await expect(degradedPage.getByTestId("memory-graph")).toBeVisible();
  await expect(degradedPage.getByTestId("graph-timeline-error")).toBeVisible();
  await expect(degradedPage.getByTestId("graph-timeline")).toHaveCount(0);
  await degradedContext.close();
  for (const size of sizes) {
    const context = await browser.newContext({ viewport: size, ignoreHTTPSErrors: true });
    const page = await context.newPage(); observe(page);
    await login(page);
    await expect(page.getByTestId("db-status")).toContainText("DB connected");
    await expect(page.getByTestId("memory-graph")).toBeVisible();
    await expect(page.getByLabel("Graph legend")).toBeVisible();
    await expect(page.getByLabel("Graph legend")).toContainText("Concept");
    await expect(page.getByLabel("Graph legend")).toContainText("Project");
    await expect(page.getByLabel("Graph legend")).toContainText("Node size = chunks + total connections");
    await expect(page.getByTestId("layer-controls")).toBeVisible();
    await expect(page.getByTestId("generated-at")).toBeVisible();
    await expect(page.getByTestId("graph-timeline")).toBeVisible();
    await expect(page.getByTestId("graph-timeline-slider")).toBeVisible();
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
    expect(overflow).toEqual({ x: false, y: false });
    const panels = await page.locator('[aria-label="Graph legend"], [aria-label="Graph layers"]').evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }));
    expect(panels).toHaveLength(2);
    expect(panels[0]!.right).toBeLessThan(panels[1]!.left);
    expect(panels.every((panel) => panel.left >= 0 && panel.right <= size.width && panel.top >= 0 && panel.bottom <= size.height)).toBe(true);
    const timelineBounds = await page.getByTestId("graph-timeline").boundingBox();
    expect(timelineBounds).not.toBeNull();
    expect(timelineBounds!.x).toBeGreaterThanOrEqual(0);
    expect(timelineBounds!.x + timelineBounds!.width).toBeLessThanOrEqual(size.width);
    expect(timelineBounds!.y + timelineBounds!.height).toBeLessThanOrEqual(size.height);
    const chromeSurfaces = await page.locator("main, header, [aria-label='Graph legend'], [aria-label='Graph layers']").evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderWidth };
    }));
    expect(chromeSurfaces.slice(1).every((surface) => surface.border === "0px")).toBe(true);
    expect(new Set(chromeSurfaces.map((surface) => surface.background)).size).toBeGreaterThanOrEqual(3);
    const controlBorders = await page.locator("header button, [aria-label='Graph layers'] button").evaluateAll((elements) =>
      elements.map((element) => getComputedStyle(element).borderWidth));
    expect(controlBorders.every((border) => border === "0px")).toBe(true);
    await page.mouse.move(size.width - 24, size.height - 24);
    await page.waitForTimeout(120);
    const screenshotPath = `screenshots/gbrain-memory-map-${size.width}x${size.height}.png`;
    await page.screenshot({ path: screenshotPath });
    await page.waitForTimeout(180);
    await page.screenshot({ path: screenshotPath });
    await context.close();
  }
  const interactionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await interactionContext.newPage(); observe(page);
  await login(page);
  await page.waitForTimeout(1500);
  const memoryGraph = page.getByTestId("memory-graph");
  const viewModeToggle = page.getByTestId("view-mode-toggle");
  const timelineToggle = page.getByTestId("timeline-toggle");
  const timeline = page.getByTestId("graph-timeline");
  const timelineSlider = page.getByTestId("graph-timeline-slider");
  const currentFrameIndex = Number(await timeline.getAttribute("data-frame-index"));
  const timelineFrameCount = Number(await timeline.getAttribute("data-frame-count"));
  const currentNodeCount = Number(await timeline.getAttribute("data-visible-node-count"));
  const staticNodeCount = Number(await timeline.getAttribute("data-static-node-count"));
  expect(timelineFrameCount).toBeGreaterThan(1);
  expect(currentFrameIndex).toBe(timelineFrameCount - 1);
  expect(staticNodeCount).toBeGreaterThan(0);
  await expect(timelineToggle).toHaveAttribute("aria-pressed", "true");
  await timelineToggle.click();
  await expect(timelineToggle).toHaveAttribute("aria-pressed", "false");
  await expect(timeline).toHaveCount(0);
  await expect(memoryGraph).toHaveAttribute("data-history-changed-count", "0");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gbrain-memory-map:explorer-state:v2") ?? "null")?.timelineOn)).toBe(false);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-timeline-off.png" });
  await timelineToggle.click();
  await expect(timelineToggle).toHaveAttribute("aria-pressed", "true");
  await expect(timeline).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("gbrain-memory-map:explorer-state:v2") ?? "null")?.timelineOn)).toBe(true);
  await timelineSlider.fill("0");
  await expect(timeline).toHaveAttribute("data-frame-index", "0");
  await expect.poll(async () => Number(await timeline.getAttribute("data-visible-node-count"))).toBeGreaterThanOrEqual(staticNodeCount);
  expect(Number(await timeline.getAttribute("data-visible-node-count"))).toBeLessThan(currentNodeCount);
  expect(Number(await memoryGraph.getAttribute("data-history-changed-count"))).toBeGreaterThan(0);
  await page.waitForTimeout(240);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-timeline-past.png" });
  await page.getByRole("button", { name: "타임라인 재생" }).click();
  await expect(timeline).toHaveAttribute("data-playing", "true");
  await expect.poll(async () => Number(await timeline.getAttribute("data-frame-index")), { timeout: 3_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "타임라인 일시정지" }).click();
  await expect(timeline).toHaveAttribute("data-playing", "false");
  await page.screenshot({ path: "screenshots/gbrain-memory-map-timeline-playing.png" });
  await page.getByRole("button", { name: "현재 시점으로 이동" }).click();
  await expect(timeline).toHaveAttribute("data-frame-index", String(timelineFrameCount - 1));
  await expect(timeline).toHaveAttribute("data-visible-node-count", String(currentNodeCount));
  await page.waitForTimeout(320);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-legend-expanded.png" });
  await page.getByTestId("legend-toggle").click();
  await expect(page.getByTestId("legend-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("legend-content")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("gbrain-memory-map:legend-expanded"))).toBe("false");
  await page.screenshot({ path: "screenshots/gbrain-memory-map-legend-collapsed.png" });
  await page.getByTestId("legend-toggle").click();
  await expect(page.getByTestId("legend-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(memoryGraph).toHaveAttribute("data-view-mode", "3d");
  await expect(memoryGraph).toHaveAttribute("data-view-transitioning", "false");
  await expect.poll(async () => Number(await memoryGraph.getAttribute("data-scene-depth")), { timeout: 3_000 }).toBeGreaterThan(1);
  expect(Number(await memoryGraph.getAttribute("data-map-depth"))).toBeGreaterThan(1);
  const initialSpatialState = await memoryGraph.evaluate((element) => ({
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    nodeCount: Number(element.dataset.sceneNodeCount),
    nodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(initialSpatialState.coordinateMode).toBe("3d");
  expect(initialSpatialState.sceneDepth).toBeGreaterThan(1);
  expect(initialSpatialState.nodeCount).toBeGreaterThan(150);
  expect(initialSpatialState.nodePositionError).toBeLessThan(0.001);
  expect(initialSpatialState.haloCenterError).toBeLessThan(0.001);
  expect(initialSpatialState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(initialSpatialState.cameraX)).toBeGreaterThan(1);
  expect(Math.abs(initialSpatialState.cameraY)).toBeGreaterThan(1);

  // Measure a clean transition before taking the mid-morph WebGL screenshot,
  // because screenshot capture intentionally blocks requestAnimationFrame.
  await viewModeToggle.click();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(120);
  const cleanMorphPerformance = await memoryGraph.evaluate((element) => ({
    frames: Number(element.dataset.morphFrameCount),
    fps: Number(element.dataset.morphFps),
    wallDuration: Number(element.dataset.morphWallDuration),
    externalStalls: Number(element.dataset.morphExternalStalls),
    directNodes: Number(element.dataset.morphDirectNodeCount),
    nodesBatched: element.dataset.morphNodesBatched,
    semanticBatched: element.dataset.morphSemanticBatched,
    halosBatched: element.dataset.morphHalosBatched,
    explicitBatched: element.dataset.morphExplicitBatched,
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    sceneNodeCount: Number(element.dataset.sceneNodeCount),
    sceneNodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  writeFileSync("screenshots/morph-performance.json", `${JSON.stringify(cleanMorphPerformance, null, 2)}\n`);
  expect(cleanMorphPerformance.frames).toBeGreaterThan(20);
  expect(cleanMorphPerformance.fps).toBeGreaterThan(20);
  expect(cleanMorphPerformance.directNodes).toBeGreaterThan(150);
  expect(cleanMorphPerformance.nodesBatched).toBe("true");
  expect(cleanMorphPerformance.semanticBatched).toBe("true");
  expect(cleanMorphPerformance.halosBatched).toBe("true");
  expect(cleanMorphPerformance.explicitBatched).toBe("true");
  expect(cleanMorphPerformance.coordinateMode).toBe("2d");
  expect(cleanMorphPerformance.sceneDepth).toBeLessThan(0.001);
  expect(cleanMorphPerformance.sceneNodeCount).toBe(cleanMorphPerformance.directNodes);
  expect(cleanMorphPerformance.sceneNodePositionError).toBeLessThan(0.001);
  expect(cleanMorphPerformance.haloCenterError).toBeLessThan(0.001);
  expect(cleanMorphPerformance.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(cleanMorphPerformance.cameraX)).toBeLessThan(0.001);
  expect(Math.abs(cleanMorphPerformance.cameraY)).toBeLessThan(0.001);
  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(280);

  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 2D Memory Map" })).toBeVisible();
  await expect(viewModeToggle).toHaveAttribute("aria-label", "3D 맵으로 전환");
  await page.waitForTimeout(240);
  const morphState = await memoryGraph.evaluate((element) => ({
    transitioning: element.dataset.viewTransitioning,
    progress: Number(element.dataset.morphProgress),
    depth: Number(element.dataset.mapDepth),
  }));
  expect(morphState.transitioning).toBe("true");
  expect(morphState.progress).toBeGreaterThan(0);
  expect(morphState.progress).toBeLessThan(1);
  expect(morphState.depth).toBeGreaterThan(0);
  await memoryGraph.screenshot({ path: "screenshots/gbrain-memory-map-3d-to-2d-morph.png" });
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(450);
  const flatState = await memoryGraph.evaluate((element) => ({
    mode: element.dataset.viewMode,
    depth: Number(element.dataset.mapDepth),
    nodeGap: Number(element.dataset["2dMinNodeGap"]),
    communityGap: Number(element.dataset["2dMinCommunityGap"]),
    morphFrames: Number(element.dataset.morphFrameCount),
    morphFps: Number(element.dataset.morphFps),
    directNodes: Number(element.dataset.morphDirectNodeCount),
    explicitEdges: Number(element.dataset.morphExplicitEdgeCount),
    semanticEdges: Number(element.dataset.morphSemanticEdgeCount),
    nodesBatched: element.dataset.morphNodesBatched,
    semanticBatched: element.dataset.morphSemanticBatched,
    halosBatched: element.dataset.morphHalosBatched,
    explicitBatched: element.dataset.morphExplicitBatched,
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    sceneNodeCount: Number(element.dataset.sceneNodeCount),
    sceneNodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(flatState.mode).toBe("2d");
  expect(flatState.depth).toBeLessThan(0.001);
  expect(flatState.nodeGap).toBeGreaterThan(0.75);
  expect(flatState.communityGap).toBeGreaterThan(13.5);
  expect(flatState.directNodes).toBeGreaterThan(150);
  expect(flatState.explicitEdges).toBeGreaterThan(0);
  expect(flatState.semanticEdges).toBeGreaterThan(100);
  expect(flatState.nodesBatched).toBe("true");
  expect(flatState.semanticBatched).toBe("true");
  expect(flatState.halosBatched).toBe("true");
  expect(flatState.explicitBatched).toBe("true");
  expect(flatState.morphFrames).toBeGreaterThan(20);
  expect(flatState.coordinateMode).toBe("2d");
  expect(flatState.sceneDepth).toBeLessThan(0.001);
  expect(flatState.sceneNodeCount).toBe(flatState.directNodes);
  expect(flatState.sceneNodePositionError).toBeLessThan(0.001);
  expect(flatState.haloCenterError).toBeLessThan(0.001);
  expect(flatState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(flatState.cameraX)).toBeLessThan(0.001);
  expect(Math.abs(flatState.cameraY)).toBeLessThan(0.001);
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.waitForTimeout(620);
  await expect(memoryGraph).toHaveAttribute("data-view-mode", "2d");
  const cameraPosition = () => memoryGraph.evaluate((element) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    z: Number(element.dataset.cameraZ),
  }));
  const cameraDistance = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }) =>
    Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
  const overviewCamera = await cameraPosition();
  await expect(memoryGraph).toHaveAttribute("data-left-drag-action", "pan");
  await page.mouse.move(620, 430);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => cameraDistance(await cameraPosition(), overviewCamera), { timeout: 2_000 }).toBeGreaterThan(1);
  const pannedCamera = await cameraPosition();
  expect(Math.hypot(pannedCamera.x - overviewCamera.x, pannedCamera.y - overviewCamera.y)).toBeGreaterThan(1);
  expect(Math.abs(pannedCamera.z - overviewCamera.z)).toBeLessThan(1);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-2d-panned.png" });
  await page.getByRole("button", { name: "Fit graph" }).click();
  await expect.poll(async () => cameraDistance(await cameraPosition(), overviewCamera), { timeout: 2_000 }).toBeLessThan(0.75);
  const labelsInsideViewport = await page.locator("[data-group-label]").evaluateAll((elements) => elements.filter((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return Number(style.opacity) > 0.05 && bounds.width > 0 && bounds.height > 0
      && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
  }).length);
  expect(labelsInsideViewport).toBeGreaterThan(10);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-2d.png" });
  await page.waitForTimeout(180);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-2d.png" });
  const communityLabels = page.locator("[data-group-label]");
  await expect(communityLabels.first()).toBeVisible();
  await expect(communityLabels.filter({ hasText: "No retained relation" })).toHaveCount(0);
  const labelPresentation = await communityLabels.evaluateAll((elements) => elements.map((element) => {
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    return {
      left: html.dataset.labelLeft ?? "",
      top: html.dataset.labelTop ?? "",
      transform: html.style.transform,
      color: style.color,
      background: style.backgroundColor,
    };
  }));
  expect(labelPresentation.every((label) => Number.isInteger(Number.parseFloat(label.left)) && Number.isInteger(Number.parseFloat(label.top)))).toBe(true);
  expect(labelPresentation.every((label) => label.transform.replaceAll(" ", "") === `translate3d(${label.left}px,${label.top}px,0px)`)).toBe(true);
  expect(labelPresentation.every((label) => label.color === "rgba(255, 255, 255, 0.3)" && label.background === "rgba(0, 0, 0, 0.4)")).toBe(true);
  let haloTextRevealed = false;
  let haloHoverPoint: { x: number; y: number } | null = null;
  for (let y = 220; y <= 820 && !haloTextRevealed; y += 36) for (let x = 420; x <= 1080; x += 36) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(18);
    haloTextRevealed = await communityLabels.evaluateAll((elements) => elements.some((element) => getComputedStyle(element).color === "rgb(255, 255, 255)"));
    if (haloTextRevealed && await visibleTooltipText(page)) haloTextRevealed = false;
    if (haloTextRevealed) { haloHoverPoint = { x, y }; break; }
  }
  expect(haloTextRevealed).toBe(true);
  expect(haloHoverPoint).not.toBeNull();
  await page.mouse.move(haloHoverPoint!.x, haloHoverPoint!.y);
  await page.waitForTimeout(180);
  const focusedPresentation = await communityLabels.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  }));
  expect(focusedPresentation.filter((label) => label.color === "rgb(255, 255, 255)" && label.background === "rgba(0, 0, 0, 0.58)")).toHaveLength(1);
  expect(focusedPresentation.filter((label) => label.color === "rgba(255, 255, 255, 0.09)" && label.background === "rgba(0, 0, 0, 0.16)")).toHaveLength(focusedPresentation.length - 1);
  const hoverFocus = await page.getByTestId("memory-graph").evaluate((element) => ({ group: element.dataset.hoveredGroup, count: Number(element.dataset.hoverFocusCount) }));
  expect(hoverFocus.group).toMatch(/^group-/);
  expect(hoverFocus.count).toBeGreaterThan(0);
  await page.mouse.click(haloHoverPoint!.x, haloHoverPoint!.y);
  await expect(memoryGraph).toHaveAttribute("data-focused-community", /group-/);
  const communityNodeList = page.getByTestId("community-node-list");
  await expect(communityNodeList).toBeVisible();
  const expectedHaloMemberCount = Number(await memoryGraph.getAttribute("data-focused-community-member-count"));
  expect(expectedHaloMemberCount).toBeGreaterThan(0);
  await expect(communityNodeList.locator("[data-community-node]")).toHaveCount(expectedHaloMemberCount);
  await expect(communityNodeList).toContainText(`${expectedHaloMemberCount} nodes inside halo`);
  const [layerBounds, listBounds] = await Promise.all([
    page.getByTestId("layer-controls").boundingBox(),
    communityNodeList.boundingBox(),
  ]);
  expect(layerBounds).not.toBeNull();
  expect(listBounds).not.toBeNull();
  expect(listBounds!.y).toBeGreaterThanOrEqual(layerBounds!.y + layerBounds!.height);
  expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(1440);
  expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(1000);
  expect(await communityNodeList.evaluate((element) => getComputedStyle(element).borderWidth)).toBe("0px");
  await page.waitForTimeout(560);
  expect(cameraDistance(await cameraPosition(), overviewCamera)).toBeGreaterThan(1);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-community-focus.png" });
  await page.screenshot({ path: "screenshots/gbrain-memory-map-community-nodes.png" });
  await page.waitForTimeout(120);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-halo-hover.png" });
  await page.waitForTimeout(180);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-halo-hover.png" });
  await page.mouse.move(20, 20);
  await expect.poll(() => communityLabels.evaluateAll((elements) => elements.every((element) =>
    getComputedStyle(element).color === "rgba(255, 255, 255, 0.3)")), { timeout: 1_000 }).toBe(true);
  const firstCommunityNode = communityNodeList.locator("[data-community-node]").first();
  const communitySelectedNodeId = await firstCommunityNode.getAttribute("data-community-node");
  expect(communitySelectedNodeId).toBeTruthy();
  await firstCommunityNode.click();
  await expect(communityNodeList).toHaveCount(0);
  await expect(memoryGraph).toHaveAttribute("data-selected-id", communitySelectedNodeId!);
  const nodeContextPanel = page.getByTestId("node-context-panel");
  await expect(nodeContextPanel).toBeVisible();
  await expect(page.getByTestId("node-content")).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  await expect(page.getByTestId("compact-markdown-content")).toBeVisible();
  expect((await page.getByTestId("node-content").textContent())?.trim().length).toBeGreaterThan(20);
  expect(await page.getByTestId("related-node-list").locator("[data-related-node]").count()).toBeGreaterThan(0);
  const nodePanelBounds = await nodeContextPanel.boundingBox();
  expect(nodePanelBounds).not.toBeNull();
  expect(nodePanelBounds!.y).toBeGreaterThanOrEqual(layerBounds!.y + layerBounds!.height);
  expect(nodePanelBounds!.x + nodePanelBounds!.width).toBeLessThanOrEqual(1440);
  expect(nodePanelBounds!.y + nodePanelBounds!.height).toBeLessThanOrEqual(1000);
  expect(await nodeContextPanel.evaluate((element) => getComputedStyle(element).borderWidth)).toBe("0px");
  await page.screenshot({ path: "screenshots/gbrain-memory-map-halo-node-context.png" });
  await page.getByRole("button", { name: "Expand page content" }).click();
  const markdownDialog = page.getByTestId("markdown-page-dialog");
  await expect(markdownDialog).toBeVisible();
  await expect(page.getByTestId("expanded-markdown-content")).toBeVisible();
  expect(await page.getByTestId("expanded-markdown-content").locator("h1, h2, h3").count()).toBeGreaterThan(0);
  const markdownDialogBounds = await markdownDialog.boundingBox();
  expect(markdownDialogBounds).not.toBeNull();
  expect(markdownDialogBounds!.width).toBeGreaterThan(900);
  expect(markdownDialogBounds!.height).toBeGreaterThan(700);
  expect(await markdownDialog.evaluate((element) => getComputedStyle(element).borderWidth)).toBe("0px");
  await page.screenshot({ path: "screenshots/gbrain-memory-map-markdown-expanded.png" });
  await page.keyboard.press("Escape");
  await expect(markdownDialog).toHaveCount(0);
  await expect(nodeContextPanel).toBeVisible();
  await expect(memoryGraph).toHaveAttribute("data-selected-id", communitySelectedNodeId!);
  await page.locator("canvas").click({ position: { x: 5, y: 5 } });
  await expect(memoryGraph).toHaveAttribute("data-focused-community", "");
  await expect(memoryGraph).toHaveAttribute("data-selected-id", "");
  await expect(communityNodeList).toHaveCount(0);
  await expect(nodeContextPanel).toHaveCount(0);
  await expect.poll(async () => cameraDistance(await cameraPosition(), overviewCamera), { timeout: 2_000 }).toBeLessThan(0.75);
  await page.mouse.move(haloHoverPoint!.x, haloHoverPoint!.y);
  await page.waitForTimeout(120);
  await page.mouse.click(haloHoverPoint!.x, haloHoverPoint!.y);
  await expect(memoryGraph).toHaveAttribute("data-focused-community", /group-/);
  await expect(communityNodeList).toBeVisible();
  await expect.poll(async () => cameraDistance(await cameraPosition(), overviewCamera), { timeout: 2_000 }).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await expect(memoryGraph).toHaveAttribute("data-focused-community", "");
  await expect(communityNodeList).toHaveCount(0);
  await expect.poll(async () => cameraDistance(await cameraPosition(), overviewCamera), { timeout: 2_000 }).toBeLessThan(0.75);
  await viewModeToggle.click();
  await expect(page.getByRole("heading", { name: "GBrain 3D Memory Map" })).toBeVisible();
  await expect.poll(() => memoryGraph.getAttribute("data-view-transitioning"), { timeout: 3_000 }).toBe("false");
  await page.waitForTimeout(450);
  expect(Number(await memoryGraph.getAttribute("data-map-depth"))).toBeGreaterThan(1);
  const restoredSpatialState = await memoryGraph.evaluate((element) => ({
    coordinateMode: element.dataset.coordinateMode,
    sceneDepth: Number(element.dataset.sceneDepth),
    nodePositionError: Number(element.dataset.sceneNodePositionError),
    haloCenterError: Number(element.dataset.haloCenterError),
    haloContainmentError: Number(element.dataset.haloContainmentError),
    cameraX: Number(element.dataset.cameraX),
    cameraY: Number(element.dataset.cameraY),
  }));
  expect(restoredSpatialState.coordinateMode).toBe("3d");
  expect(restoredSpatialState.sceneDepth).toBeGreaterThan(1);
  expect(restoredSpatialState.nodePositionError).toBeLessThan(0.001);
  expect(restoredSpatialState.haloCenterError).toBeLessThan(0.001);
  expect(restoredSpatialState.haloContainmentError).toBeLessThan(0.001);
  expect(Math.abs(restoredSpatialState.cameraX)).toBeGreaterThan(1);
  expect(Math.abs(restoredSpatialState.cameraY)).toBeGreaterThan(1);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  let nodeTooltipPoint: { x: number; y: number } | null = null;
  const projectedNodePoints = await memoryGraph.evaluate((element) => JSON.parse(element.dataset.nodeHoverPoints ?? "[]") as Array<{ id: string; x: number; y: number }>);
  expect(projectedNodePoints.length).toBeGreaterThan(150);
  const clusterCenters = [
    ...projectedNodePoints.filter((point) => point.x > 370 && point.x < 1080 && point.y > 110 && point.y < 930),
    { x: 760, y: 585 }, { x: 610, y: 455 }, { x: 830, y: 650 }, { x: 700, y: 535 },
  ];
  const nodeOffsets = [0, 4, -4, 8, -8, 12, -12];
  for (const center of clusterCenters) {
    for (const dy of nodeOffsets) {
      for (const dx of nodeOffsets) {
        const point = { x: center.x + dx, y: center.y + dy };
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(62);
        const tooltip = await visibleTooltipText(page);
        if (tooltip.includes("Type ·") && tooltip.includes("Chunks ·")) { nodeTooltipPoint = point; break; }
      }
      if (nodeTooltipPoint) break;
    }
    if (nodeTooltipPoint) break;
  }
  expect(nodeTooltipPoint).not.toBeNull();
  await page.screenshot({ path: "screenshots/gbrain-memory-map-tooltip.png" });
  let edgeTooltipFound = false;
  const edgeHoverPoints = await memoryGraph.evaluate((element) => JSON.parse(element.dataset.edgeHoverPoints ?? "[]") as Array<{ x: number; y: number }>);
  expect(edgeHoverPoints.length).toBeGreaterThan(20);
  for (const point of edgeHoverPoints.filter((item) => item.x > 360 && item.x < 1080 && item.y > 100 && item.y < 930)) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(62);
    const tooltip = await visibleTooltipText(page);
    if (tooltip.includes("relation") && (tooltip.includes("Solid") || tooltip.includes("Dashed"))) { edgeTooltipFound = true; break; }
  }
  expect(edgeTooltipFound).toBe(true);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-edge-tooltip.png" });
  let selectedId: string | null = null;
  const selectionCenters = [nodeTooltipPoint!, ...clusterCenters];
  for (const center of selectionCenters) {
    for (const dy of nodeOffsets) {
      for (const dx of nodeOffsets) {
        const point = { x: center.x + dx, y: center.y + dy };
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(72);
        const tooltip = await visibleTooltipText(page);
        if (!tooltip.includes("Type ·") || !tooltip.includes("Chunks ·")) continue;
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(140);
        selectedId = await memoryGraph.getAttribute("data-selected-id");
        if (selectedId) break;
      }
      if (selectedId) break;
    }
    if (selectedId) break;
  }
  expect(selectedId).toBeTruthy();
  await expect(memoryGraph).toHaveAttribute("data-direction-arrows", "false");
  await expect(page.getByTestId("node-context-panel")).toBeVisible();
  await expect(page.getByTestId("node-content")).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  await expect(page.getByTestId("compact-markdown-content")).toBeVisible();
  expect((await page.getByTestId("node-content").textContent())?.trim().length).toBeGreaterThan(20);
  expect(await page.getByTestId("related-node-list").locator("[data-related-node]").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("selected-summary")).toContainText("Active neighbors");
  expect(await page.getByTestId("selected-summary").evaluate((element) => getComputedStyle(element).borderWidth)).toBe("0px");
  await expect(memoryGraph).not.toHaveAttribute("data-selected-id", "");
  await page.getByRole("button", { name: "Semantic", exact: true }).click();
  await page.getByRole("button", { name: "Explicit", exact: true }).click();
  await expect(memoryGraph).toHaveAttribute("data-active-edge-count", "0");
  await expect(memoryGraph).toHaveAttribute("data-active-neighbor-count", "1");
  await expect(page.getByTestId("related-node-list").locator("[data-related-node]")).toHaveCount(0);
  await expect(page.getByTestId("node-context-panel")).toContainText("No related nodes in active layers");
  await page.getByRole("button", { name: "Semantic", exact: true }).click();
  await page.getByRole("button", { name: "Explicit", exact: true }).click();
  await expect.poll(() => page.getByTestId("related-node-list").locator("[data-related-node]").count()).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "screenshots/gbrain-memory-map-selected.png" });
  await page.screenshot({ path: "screenshots/gbrain-memory-map-node-context.png" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("selected-summary")).toBeVisible();
  await expect(page.getByTestId("node-content")).toHaveAttribute("data-state", "ready", { timeout: 5_000 });
  await expect(page.getByTestId("memory-graph")).toHaveAttribute("data-selected-id", selectedId!);
  const persistedState = await page.evaluate(() => localStorage.getItem("gbrain-memory-map:explorer-state:v2"));
  expect(persistedState).toBeTruthy();
  await page.locator("canvas").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("selected-summary")).toHaveCount(0);
  await expect(page.getByTestId("node-context-panel")).toHaveCount(0);
  await page.evaluate((value) => localStorage.setItem("gbrain-memory-map:explorer-state:v2", value!), persistedState);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("selected-summary")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selected-summary")).toHaveCount(0);
  await expect(page.getByTestId("node-context-panel")).toHaveCount(0);
  await expect(page.getByTestId("memory-graph")).toHaveAttribute("data-selected-id", "");
  await page.waitForTimeout(560);
  await interactionContext.close();
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
